export interface ResponseCache {
  match: (key: Request) => Promise<Response | undefined>
  put: (key: Request, response: Response) => Promise<unknown>
}

interface ResponseCacheOptions {
  cache?: ResponseCache
  waitUntil: (promise: Promise<unknown>) => void
  buildId: string
  base?: string
}

const publicRoutes = /^(?:\/|\/(?:tags|links|rss\.xml|rss\.json|sitemap\.xml|site\.webmanifest)\/?|\/(?:posts|before|after|search|sitemap)\/[^/]+\/?)$/
const privateDirective = /(?:^|,)\s*(?:private|no-store|no-cache)(?:[\s=,]|$)/i

function isPublicRequest(request: Request, base: string): boolean {
  const url = new URL(request.url)
  const prefix = base.endsWith('/') ? base : `${base}/`
  const pathname = url.pathname === prefix.slice(0, -1)
    ? '/'
    : url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length - 1) : ''
  return (request.method === 'GET' || request.method === 'HEAD')
    && publicRoutes.test(pathname)
    && !['cookie', 'authorization', 'range', 'if-match', 'if-unmodified-since'].some(header => request.headers.has(header))
    && !privateDirective.test(request.headers.get('cache-control') ?? '')
    && !request.headers.get('pragma')?.includes('no-cache')
}

function isPublicResponse(response: Response): boolean {
  const control = response.headers.get('cache-control') ?? ''
  // This cache has a URL-only key. Do not cache any header-varying representation.
  return response.status === 200
    && !response.headers.has('set-cookie')
    && !response.headers.has('vary')
    && !privateDirective.test(control)
    && /(?:^|,)\s*public(?:\s|,|$)/i.test(control)
    && /(?:s-maxage|max-age)=[1-9]\d*/i.test(control)
}

function clientResponse(request: Request, response: Response, status: 'HIT' | 'MISS' | 'BYPASS'): Response {
  const headers = new Headers(response.headers)
  headers.set('X-Response-Cache', status)
  // If-None-Match requires weak comparison (RFC 9110 section 13.1.2): ignore W/.
  const etag = headers.get('etag')?.replace(/^W\//, '')
  const validators: string[] = request.headers.get('if-none-match')?.match(/(?:W\/)?"[^"]*"|\*/g) ?? []
  const notModified = response.status === 200 && etag
    && validators.some(value => value === '*' || value.replace(/^W\//, '') === etag)
  if (notModified) {
    headers.delete('content-length')
    return new Response(null, { status: 304, headers })
  }
  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export async function createContentEtag(body: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', body))
  const hash = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
  // Weak because the edge may change the content encoding after this handler.
  return `W/"${hash}"`
}

/** Runs outside Astro, after the adapter has appended all response cookies on misses. */
export async function withResponseCache(
  request: Request,
  render: () => Promise<Response>,
  { cache, waitUntil, buildId, base = '/' }: ResponseCacheOptions,
): Promise<Response> {
  if (!cache || !isPublicRequest(request, base)) {
    return render()
  }

  const url = new URL(request.url)
  // Keep host, path and the entire query (including channel, tag and search) isolated.
  // Each build gets a new namespace, so deployments cannot serve old HTML/assets.
  url.pathname = `/__bc_response_cache/${buildId}${url.pathname}`
  const key = new Request(url, { method: 'GET' })
  try {
    const cached = await cache.match(key)
    if (cached)
      return clientResponse(request, cached, 'HIT')
  }
  catch {
    // Cache API availability must not turn an otherwise renderable page into an error.
  }

  const response = await render()
  if (request.method !== 'GET' || !isPublicResponse(response)) {
    return clientResponse(request, response, 'BYPASS')
  }

  const headers = new Headers(response.headers)
  let body: BodyInit | null = response.body
  // Only cache misses pay for reading/hashing the body. A content validator remains
  // useful after eviction or TTL expiry when the rendered bytes have not changed.
  if (!headers.has('etag')) {
    const bytes = await response.arrayBuffer()
    headers.set('ETag', await createContentEtag(bytes))
    body = bytes
  }
  const stored = new Response(body, { status: response.status, headers })
  // Cache API does not implement stale-while-revalidate; use the route's explicit TTL.
  const cacheCopy = stored.clone()
  cacheCopy.headers.set('Cache-Control', headers.get('cache-control')!.replace(/,?\s*stale-while-revalidate=\d+/gi, ''))
  waitUntil(cache.put(key, cacheCopy).catch(() => {}))
  return clientResponse(request, stored, 'MISS')
}

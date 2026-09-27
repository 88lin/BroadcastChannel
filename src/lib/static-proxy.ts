const TARGET_WHITELIST = [
  't.me',
  'telegram.org',
  'telegram.me',
  'telegram.dog',
  'cdn-telegram.org',
  'telesco.pe',
  'yandex.ru',
]

const FORWARDED_REQUEST_HEADERS = new Set([
  'accept',
  'accept-language',
  'if-modified-since',
  'if-none-match',
  'if-range',
  'range',
  'user-agent',
])

const FORWARDED_RESPONSE_HEADERS = new Set([
  'accept-ranges',
  'cache-control',
  'content-length',
  'content-range',
  'content-type',
  'etag',
  'expires',
  'last-modified',
])
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const MAX_REDIRECTS = 5
const PASSIVE_MEDIA_TYPE = /^(?:image\/(?:avif|bmp|gif|jpeg|png|webp|x-icon|vnd\.microsoft\.icon)|audio\/[\w.+-]+|video\/[\w.+-]+)$/i

function secureHeaders(headers = new Headers()): Headers {
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Content-Security-Policy', 'default-src \'none\'; sandbox; base-uri \'none\'; form-action \'none\'')
  return headers
}

function proxyError(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: secureHeaders(new Headers({ 'Cache-Control': 'no-store' })),
  })
}

export function resolveStaticProxyTarget(rawTarget: string): URL {
  const normalizedTarget = rawTarget.startsWith('//') ? `https:${rawTarget}` : rawTarget
  return new URL(normalizedTarget)
}

export function isStaticProxyWhitelisted(target: URL): boolean {
  const isAllowedProtocol = target.protocol === 'http:' || target.protocol === 'https:'
  return isAllowedProtocol && !target.username && !target.password && !target.port
    && TARGET_WHITELIST.some(domain => target.hostname === domain || target.hostname.endsWith(`.${domain}`))
}

function getForwardedRequestHeaders(request: Request): Headers {
  const headers = new Headers({ 'Accept-Encoding': 'identity' })

  for (const [key, value] of request.headers.entries()) {
    if (FORWARDED_REQUEST_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value)
    }
  }

  return headers
}

export async function createStaticProxyResponse(request: Request, rawTarget: string): Promise<Response> {
  let target: URL

  try {
    target = resolveStaticProxyTarget(rawTarget)
  }
  catch {
    return proxyError('Invalid proxy target', 400)
  }

  if (!isStaticProxyWhitelisted(target)) {
    return proxyError('Proxy target not allowed', 403)
  }

  let response: Response
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    for (let redirects = 0; ; redirects += 1) {
      response = await fetch(target.toString(), {
        method: request.method === 'HEAD' ? 'HEAD' : 'GET',
        headers: getForwardedRequestHeaders(request),
        redirect: 'manual',
        signal: controller.signal,
      })
      if (!REDIRECT_STATUSES.has(response.status)) {
        break
      }

      const location = response.headers.get('location')
      await response.body?.cancel()
      if (!location || redirects >= MAX_REDIRECTS) {
        return proxyError('Invalid upstream redirect', 502)
      }
      target = new URL(location, target)
      if (!isStaticProxyWhitelisted(target)) {
        return proxyError('Proxy redirect target not allowed', 403)
      }
    }
  }
  catch {
    return proxyError('Upstream fetch failed', 502)
  }
  finally {
    // Bound header/redirect waits, while allowing large media bodies to keep streaming.
    clearTimeout(timeout)
  }

  const headers = secureHeaders()
  for (const [key, value] of response.headers) {
    if (FORWARDED_RESPONSE_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value)
    }
  }
  // Fetch may decompress the body, so its encoded byte length is no longer valid.
  if (response.headers.has('content-encoding')) {
    headers.delete('content-length')
  }

  const contentType = (headers.get('content-type') ?? '').split(';')[0].trim()
  if (response.status === 304) {
    // A 304 updates a cached response; do not overwrite its safe representation metadata.
    headers.delete('content-type')
    headers.delete('content-length')
  }
  else if (!PASSIVE_MEDIA_TYPE.test(contentType)) {
    headers.set('Content-Type', 'application/octet-stream')
    headers.set('Content-Disposition', 'attachment')
  }

  if (response.status === 200) {
    headers.set('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000')
  }

  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

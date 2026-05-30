const TARGET_WHITELIST = [
  't.me',
  'telegram.org',
  'telegram.me',
  'telegram.dog',
  'cdn-telegram.org',
  'telesco.pe',
  'yandex.ru',
]

export function resolveStaticProxyTarget(rawTarget: string): URL {
  const normalizedTarget = rawTarget.startsWith('//') ? `https:${rawTarget}` : rawTarget
  return new URL(normalizedTarget)
}

export function isStaticProxyWhitelisted(target: URL): boolean {
  return TARGET_WHITELIST.some(domain => target.hostname.endsWith(domain))
}

export async function createStaticProxyResponse(request: Request, rawTarget: string): Promise<Response> {
  const target = resolveStaticProxyTarget(rawTarget)

  if (!isStaticProxyWhitelisted(target)) {
    return new Response('Proxy target not allowed', { status: 403 })
  }

  const response = await fetch(target.toString(), request)
  const headers = new Headers(response.headers)

  if (response.status === 200) {
    headers.set('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000')
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

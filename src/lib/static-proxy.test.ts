import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStaticProxyResponse, isStaticProxyWhitelisted, resolveStaticProxyTarget } from './static-proxy'

describe('static proxy target handling', () => {
  it('accepts whitelisted Telegram CDN targets', () => {
    expect(isStaticProxyWhitelisted(new URL('https://cdn-telegram.org/a.png'))).toBe(true)
  })

  it('rejects lookalike domains', () => {
    expect(isStaticProxyWhitelisted(new URL('https://eviltelegram.org/a.png'))).toBe(false)
  })

  it('normalizes protocol-relative targets to HTTPS', () => {
    expect(resolveStaticProxyTarget('//cdn-telegram.org/a.png').toString()).toBe('https://cdn-telegram.org/a.png')
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('static proxy responses', () => {
  const assetUrl = 'https://cdn-telegram.org/a.png'
  const request = () => new Request('https://site.example/static/asset', {
    headers: { cookie: 'private=1', authorization: 'Bearer secret', range: 'bytes=0-9' },
  })

  it.each([
    'https://cdn-telegram.org.evil.example/a',
    'https://user:password@cdn-telegram.org/a',
    'https://cdn-telegram.org:8080/a',
    'file:///etc/passwd',
  ])('rejects unsafe targets without fetching: %s', async (target) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect((await createStaticProxyResponse(request(), target)).status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('follows relative and whitelisted redirects manually', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/next' } }))
      .mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: assetUrl } }))
      .mockResolvedValueOnce(new Response('image', { headers: { 'content-type': 'image/png' } }))
    vi.stubGlobal('fetch', fetchMock)
    const response = await createStaticProxyResponse(request(), 'https://t.me/start')
    expect(await response.text()).toBe('image')
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(['https://t.me/start', 'https://t.me/next', assetUrl])
    for (const [, options] of fetchMock.mock.calls) {
      expect(options.redirect).toBe('manual')
      expect(options.headers.get('range')).toBe('bytes=0-9')
      expect(options.headers.get('accept-encoding')).toBe('identity')
      expect(options.headers.has('cookie')).toBe(false)
      expect(options.headers.has('authorization')).toBe(false)
    }
  })

  it.each(['http://169.254.169.254/latest/meta-data/', 'http://127.0.0.1/', 'https://evil.example/', 'file:///etc/passwd'])('blocks redirect to %s', async (location) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location } }))
    vi.stubGlobal('fetch', fetchMock)
    const response = await createStaticProxyResponse(request(), 'https://yandex.ru/redirect')
    expect(response.status).toBe(403)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('stops redirect loops', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(null, { status: 302, headers: { location: '/loop' } })))
    expect((await createStaticProxyResponse(request(), assetUrl)).status).toBe(502)
    expect(fetch).toHaveBeenCalledTimes(6)
  })

  it.each(['text/html', 'application/xhtml+xml', 'image/svg+xml', 'text/javascript'])('isolates active content of type %s', async (contentType) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<script>alert(1)</script>', {
      headers: {
        'content-type': contentType,
        'set-cookie': 'session=attacker',
        'refresh': '0;url=https://evil.example',
        'access-control-allow-origin': '*',
        'link': '</evil.js>;rel=preload;as=script',
      },
    })))
    const response = await createStaticProxyResponse(request(), assetUrl)
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
    expect(response.headers.get('content-disposition')).toBe('attachment')
    expect(response.headers.get('content-security-policy')).toContain('sandbox')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    for (const header of ['set-cookie', 'refresh', 'access-control-allow-origin', 'link']) {
      expect(response.headers.has(header)).toBe(false)
    }
  })

  it('preserves range responses and validators for media', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('0123456789', {
      status: 206,
      headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-9/100', 'accept-ranges': 'bytes', 'etag': '"asset"' },
    })))
    const response = await createStaticProxyResponse(request(), assetUrl)
    expect(response.status).toBe(206)
    expect(response.headers.get('content-type')).toBe('video/mp4')
    expect(response.headers.get('content-range')).toBe('bytes 0-9/100')
    expect(response.headers.get('etag')).toBe('"asset"')
    expect(await response.text()).toBe('0123456789')
  })

  it('preserves bodyless conditional responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 304, headers: { etag: '"asset"' } })))
    const response = await createStaticProxyResponse(request(), assetUrl)
    expect(response.status).toBe(304)
    expect(response.body).toBeNull()
    expect(response.headers.has('content-type')).toBe(false)
    expect(response.headers.has('content-disposition')).toBe(false)
  })

  it('forwards If-Range so changed media is not spliced into cached bytes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('new video', { headers: { 'content-type': 'video/mp4' } }))
    vi.stubGlobal('fetch', fetchMock)
    const response = await createStaticProxyResponse(new Request('https://site.example/static/asset', {
      headers: { 'range': 'bytes=10-', 'if-range': '"old-version"' },
    }), assetUrl)
    expect(response.status).toBe(200)
    expect(fetchMock.mock.calls[0][1].headers.get('if-range')).toBe('"old-version"')
  })

  it('forwards HEAD and removes stale compressed lengths', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, {
      headers: { 'content-type': 'image/png', 'content-encoding': 'gzip', 'content-length': '100' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const response = await createStaticProxyResponse(new Request('https://site.example', { method: 'HEAD' }), assetUrl)
    expect(fetchMock.mock.calls[0][1].method).toBe('HEAD')
    expect(response.body).toBeNull()
    expect(response.headers.has('content-encoding')).toBe(false)
    expect(response.headers.has('content-length')).toBe(false)
  })

  it('returns a non-cacheable error on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))
    const response = await createStaticProxyResponse(request(), assetUrl)
    expect(response.status).toBe(502)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('allows a media body to keep streaming after the header timeout window', async () => {
    vi.useFakeTimers()
    // Node's native AbortSignal.timeout does not use fake timers.
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((delay) => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(), delay)
      return controller.signal
    })
    const fetchMock = vi.fn().mockImplementation(async (_url, { signal }) => new Response(new ReadableStream({
      start(controller) {
        signal.addEventListener('abort', () => controller.error(new Error('Media stream aborted')), { once: true })
        controller.enqueue(new TextEncoder().encode('first'))
        setTimeout(() => {
          if (!signal.aborted) {
            controller.enqueue(new TextEncoder().encode('last'))
            controller.close()
          }
        }, 20000)
      },
    }), { headers: { 'content-type': 'video/mp4' } }))
    vi.stubGlobal('fetch', fetchMock)
    const response = await createStaticProxyResponse(request(), assetUrl)
    const body = response.text().then(value => ({ value }), error => ({ error }))
    await vi.advanceTimersByTimeAsync(20000)
    expect(await body).toEqual({ value: 'firstlast' })
  })

  it('times out an upstream that never returns headers', async () => {
    vi.useFakeTimers()
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((delay) => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(), delay)
      return controller.signal
    })
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true })
    })))
    const pending = createStaticProxyResponse(request(), assetUrl)
    await vi.advanceTimersByTimeAsync(15001)
    expect((await pending).status).toBe(502)
  })
})

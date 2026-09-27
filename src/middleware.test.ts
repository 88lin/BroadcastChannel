import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('astro:middleware', () => ({
  defineMiddleware: <T>(handler: T): T => handler,
}))

const { isHtmlResponse, onRequest, shouldApplyDefaultCache } = await import('./middleware')
afterEach(() => vi.unstubAllEnvs())

describe('middleware response header helpers', () => {
  it('keeps channel and tag in feed links and legacy search rewrites', async () => {
    vi.stubEnv('CHANNEL', 'alpha,beta')
    const rewrite = vi.fn(async (_path: string) => new Response('<html></html>'))
    const context = { locals: {}, url: new URL('https://site.example/search/%23tag?channel=beta'), params: {}, rewrite } as unknown as Parameters<typeof onRequest>[0]
    await onRequest(context, async () => new Response(''))
    const feed = new URL(context.locals.RSS_URL, context.url.origin)
    expect(feed.searchParams.get('channel')).toBe('beta')
    expect(feed.searchParams.get('tag')).toBe('tag')
    const target = new URL(rewrite.mock.calls[0][0], context.url.origin)
    expect(target.searchParams.get('channel')).toBe('beta')
    expect(target.searchParams.get('q')).toBe('#tag')
  })

  it('rejects unknown channels before the route runs', async () => {
    vi.stubEnv('CHANNEL', 'alpha,beta')
    const next = vi.fn(async () => new Response(''))
    const context = { locals: {}, url: new URL('https://site.example/rss.xml?channel=unknown'), params: {} } as Parameters<typeof onRequest>[0]
    const response = await onRequest(context, next) as Response
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(next).not.toHaveBeenCalled()
  })

  it('adds nosniff without replacing proxy isolation or error cache policy', async () => {
    const upstream = new Response('Failed', {
      status: 502,
      headers: { 'Cache-Control': 'no-store', 'Content-Security-Policy': 'default-src \'none\'; sandbox' },
    })
    const context = { locals: {}, url: new URL('https://site.example/static/asset'), params: {} } as Parameters<typeof onRequest>[0]
    const response = await onRequest(context, async () => upstream) as Response
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-security-policy')).toContain('sandbox')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.has('speculation-rules')).toBe(false)
  })

  it('applies default cache to successful responses without cache headers', () => {
    expect(shouldApplyDefaultCache(new Response('', { status: 200 }))).toBe(true)
  })

  it('applies default cache to redirects without cache headers', () => {
    expect(shouldApplyDefaultCache(new Response('', { status: 302 }))).toBe(true)
  })

  it('does not apply default cache to not found responses', () => {
    expect(shouldApplyDefaultCache(new Response('', { status: 404 }))).toBe(false)
  })

  it('does not apply default cache to upstream error responses', () => {
    expect(shouldApplyDefaultCache(new Response('', { status: 502 }))).toBe(false)
  })

  it('does not replace existing cache headers', () => {
    expect(shouldApplyDefaultCache(new Response('', {
      headers: {
        'Cache-Control': 'private, max-age=0',
      },
      status: 200,
    }))).toBe(false)
  })

  it('detects HTML responses with charset parameters', () => {
    expect(isHtmlResponse(new Response('', {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    }))).toBe(true)
  })
})

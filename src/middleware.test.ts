import { describe, expect, it, vi } from 'vitest'

vi.mock('astro:middleware', () => ({
  defineMiddleware: <T>(handler: T): T => handler,
}))

const { isHtmlResponse, onRequest, shouldApplyDefaultCache } = await import('./middleware')

describe('middleware response header helpers', () => {
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

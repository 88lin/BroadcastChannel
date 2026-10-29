import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withResponseCache } from './response-cache'

const entries = new Map<string, Response>()
const writes: Promise<unknown>[] = []
const cache = {
  match: vi.fn(async (key: Request) => entries.get(key.url)?.clone()),
  put: vi.fn(async (key: Request, response: Response) => {
    entries.set(key.url, response)
  }),
}
const render = vi.fn(async () => new Response('public page', {
  headers: { 'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=60, s-maxage=1800' },
}))
const options = {
  cache,
  waitUntil: (promise: Promise<unknown>) => {
    writes.push(promise)
  },
  buildId: 'build-a',
}
const request = (path = '/', init?: RequestInit) => new Request(`https://site.example${path}`, init)

beforeEach(() => {
  entries.clear()
  writes.length = 0
  vi.clearAllMocks()
})

describe('cloudflare response cache', () => {
  it('skips the entire renderer on hits and retains security/response headers', async () => {
    const first = await withResponseCache(request(), render, options)
    await Promise.all(writes)
    const second = await withResponseCache(request(), render, options)
    expect(await second.text()).toBe('public page')
    expect(second.headers.get('X-Response-Cache')).toBe('HIT')
    expect(second.headers.get('etag')).toBe(first.headers.get('etag'))
    expect(render).toHaveBeenCalledTimes(1)
  })

  it.each(['/?channel=alpha', '/?channel=beta', '/rss.xml?tag=one', '/rss.xml?tag=two', '/search/result?q=one', '/before/cursor'])('keeps URL variants separate: %s', async (path) => {
    await withResponseCache(request(), render, options)
    await withResponseCache(request(path), render, options)
    expect(render).toHaveBeenCalledTimes(2)
  })

  it('isolates hosts and deployments', async () => {
    await withResponseCache(request(), render, options)
    await withResponseCache(new Request('https://other.example/'), render, options)
    await withResponseCache(request(), render, { ...options, buildId: 'build-b' })
    expect(render).toHaveBeenCalledTimes(3)
  })

  it('retains the content ETag across cache fills and changes it for different bytes', async () => {
    const first = await withResponseCache(request(), render, options)
    await Promise.all(writes)
    entries.clear()
    const revalidated = await withResponseCache(request('/', { headers: { 'If-None-Match': first.headers.get('etag')! } }), render, options)
    expect(revalidated.status).toBe(304)
    expect(revalidated.headers.get('etag')).toBe(first.headers.get('etag'))
    await Promise.all(writes)
    entries.clear()
    const changed = await withResponseCache(request(), async () => new Response('changed', {
      headers: { 'Cache-Control': 'public, max-age=60' },
    }), options)
    expect(changed.headers.get('etag')).not.toBe(first.headers.get('etag'))
  })

  it('weakly compares a client validator against an existing strong ETag', async () => {
    const response = await withResponseCache(request('/', { headers: { 'If-None-Match': 'W/"upstream"' } }), async () => new Response('body', {
      headers: { 'Cache-Control': 'public, max-age=60', 'ETag': '"upstream"' },
    }), options)
    expect(response.status).toBe(304)
    expect(response.headers.get('etag')).toBe('"upstream"')
  })

  it.each(['/blog', '/blog/'])('supports a deployment base of %s without caching outside it', async (base) => {
    await withResponseCache(request('/blog/'), render, { ...options, base })
    const hit = await withResponseCache(request('/blog/'), render, { ...options, base })
    expect(hit.headers.get('X-Response-Cache')).toBe('HIT')
    vi.clearAllMocks()
    await withResponseCache(request('/blogger/posts/12'), render, { ...options, base })
    expect(cache.match).not.toHaveBeenCalled()
    expect(cache.put).not.toHaveBeenCalled()
  })

  it.each([{ cookie: 'session=123' }, { authorization: 'Bearer private' }, { range: 'bytes=0-10' }, { 'cache-control': 'no-cache' }])('bypasses cache reads and writes for %j', async (headers) => {
    await withResponseCache(request(), render, options)
    vi.clearAllMocks()
    await withResponseCache(request('/', { headers }), render, options)
    expect(render).toHaveBeenCalledOnce()
    expect(cache.match).not.toHaveBeenCalled()
    expect(cache.put).not.toHaveBeenCalled()
  })

  it.each([
    { status: 404 },
    { status: 500 },
    { status: 302 },
    { headers: { 'Set-Cookie': 'session=private', 'Cache-Control': 'public, max-age=60' } },
    { headers: { 'Vary': 'Cookie', 'Cache-Control': 'public, max-age=60' } },
    { headers: { 'Cache-Control': 'private, max-age=60' } },
    { headers: { 'Cache-Control': 'no-store' } },
  ])('does not store unsafe responses: %j', async (init) => {
    await withResponseCache(request(), async () => new Response('body', init), options)
    expect(cache.put).not.toHaveBeenCalled()
  })

  it('supports conditional GET, weak comparison, lists, wildcard, and HEAD without rendering', async () => {
    const first = await withResponseCache(request(), render, options)
    const etag = first.headers.get('etag')!
    for (const value of [etag, etag.slice(2), `"other", ${etag}`, '*']) {
      const response = await withResponseCache(request('/', { headers: { 'If-None-Match': value } }), render, options)
      expect(response.status).toBe(304)
      expect(await response.text()).toBe('')
    }
    const head = await withResponseCache(request('/', { method: 'HEAD' }), render, options)
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
    const different = await withResponseCache(request('/', { headers: { 'If-None-Match': '"different"' } }), render, options)
    expect(await different.text()).toBe('public page')
    expect(render).toHaveBeenCalledTimes(1)
  })

  it('does not fill a cache from HEAD, POST or static proxy requests', async () => {
    await withResponseCache(request('/', { method: 'HEAD' }), render, options)
    await withResponseCache(request('/', { method: 'POST' }), render, options)
    await withResponseCache(request('/static/https://telegram.me/a.jpg'), render, options)
    expect(cache.put).not.toHaveBeenCalled()
  })

  it('falls back on cache failures and on runtimes without Cache API', async () => {
    cache.match.mockRejectedValueOnce(new Error('unavailable'))
    cache.put.mockRejectedValueOnce(new Error('quota'))
    expect((await withResponseCache(request(), render, options)).status).toBe(200)
    await Promise.all(writes)
    expect((await withResponseCache(request(), render, { ...options, cache: undefined })).status).toBe(200)
  })
})

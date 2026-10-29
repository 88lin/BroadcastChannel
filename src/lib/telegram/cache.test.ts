import { afterEach, describe, expect, it, vi } from 'vitest'
import { getCachedValue, setCacheValue } from './cache'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('bounded parsed cache', () => {
  it('shares and freezes nested data without serializing it', () => {
    const value = { posts: [{ content: '<pre>large content</pre>', tags: ['a'] }] }
    const stringify = vi.spyOn(JSON, 'stringify')
    setCacheValue('immutable', value)
    expect(getCachedValue('immutable')).toBe(value)
    expect(Object.isFrozen(value.posts[0].tags)).toBe(true)
    expect(stringify).not.toHaveBeenCalled()
  })

  it('does not retain entries larger than its memory budget', () => {
    const value = { content: 'x'.repeat(5 * 1024 * 1024) }
    setCacheValue('oversized', value)
    expect(getCachedValue('oversized')).toBeUndefined()
  })

  it('expires fresh data after five minutes and stale fallback after 24 hours', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1000)
    vi.resetModules()
    const api = await import('./cache')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const value = { posts: ['one'] }
    await api.loadCachedValue('expiry', async () => value)
    const fail = vi.fn(async () => {
      throw new Error('upstream')
    })
    clock.mockReturnValue(1000 + 6 * 60 * 1000)
    vi.advanceTimersByTime(6 * 60 * 1000)
    expect(api.getCachedValue('expiry')).toBeUndefined()
    expect(await api.loadCachedValue('expiry', fail)).toBe(value)
    expect(warn).toHaveBeenCalledOnce()
    clock.mockReturnValue(1000 + 25 * 60 * 60 * 1000)
    vi.advanceTimersByTime(25 * 60 * 60 * 1000)
    await expect(api.loadCachedValue('expiry', fail)).rejects.toThrow('upstream')
  })
})

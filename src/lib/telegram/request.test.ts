import { afterEach, describe, expect, it, vi } from 'vitest'
import { getTelegramRequestHeaders } from './request'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('telegram request headers', () => {
  it('uses deterministic headers without forwarding visitor or platform metadata', () => {
    const headers = getTelegramRequestHeaders()

    expect(headers).toMatchObject({
      'accept': 'text/html,application/xhtml+xml',
      'user-agent': 'BroadcastChannel/0.2.0',
    })

    expect(headers).not.toHaveProperty('cookie')
    expect(headers).not.toHaveProperty('authorization')
    expect(headers).not.toHaveProperty('x-forwarded-for')
    expect(headers).not.toHaveProperty('cf-connecting-ip')
    expect(headers).not.toHaveProperty('vercel-forwarded-for')
    expect(headers).not.toHaveProperty('referer')
  })
})

describe('channel title request deadline', () => {
  it('aborts a slow title request without retrying or joining a pending timeline request', async () => {
    vi.useFakeTimers()
    vi.resetModules()
    vi.stubEnv('CHANNEL', 'alpha,beta')
    const signals: AbortSignal[] = []
    const replies: ((response: Response) => void)[] = []
    const fetchMock = vi.fn((_url: unknown, options: RequestInit = {}) => new Promise<Response>((resolve, reject) => {
      replies.push(resolve)
      const signal = options.signal!
      signals.push(signal)
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { loadChannelDocument } = await import('./request')
    const { getChannelTitles, rememberChannelTitle } = await import('./channel-titles')
    const context = { request: new Request('https://site.example/?channel=beta') }
    rememberChannelTitle(context, 'beta', 'Selected channel')
    const timeline = loadChannelDocument(context, { channel: 'alpha' })
    await vi.advanceTimersByTimeAsync(0)
    const titles = getChannelTitles(context)
    let resolved = false
    void titles.then(() => {
      resolved = true
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(resolved).toBe(true)
    expect(await titles).toEqual({ alpha: 'alpha', beta: 'Selected channel' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(signals.map(signal => signal.aborted)).toEqual([false, true])
    replies[0](new Response('<div class="tgme_channel_info_header_title">Alpha title</div>'))
    await timeline
    expect(await getChannelTitles(context)).toEqual({ alpha: 'alpha', beta: 'Selected channel' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(31000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    fetchMock.mockResolvedValueOnce(new Response('<div class="tgme_channel_info_header_title">Recovered title</div>'))
    expect(await getChannelTitles(context)).toEqual({ alpha: 'Recovered title', beta: 'Selected channel' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

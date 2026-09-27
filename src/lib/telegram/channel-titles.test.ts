import * as cheerio from 'cheerio'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadChannelDocument } from './request'

vi.mock('./request', () => ({ loadChannelDocument: vi.fn() }))

let api: typeof import('./channel-titles')
const context = { request: new Request('https://site.example/') }
const loadDocument = vi.mocked(loadChannelDocument)

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.resetModules()
  vi.resetAllMocks()
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
  vi.stubEnv('CHANNEL', 'alpha,beta')
  vi.stubEnv('SITE_NAME', '聚合站点名称')
  vi.stubEnv('TELEGRAM_HOST', 'telegram.me')
  loadDocument.mockImplementation(async (_context, params = {}) => ({
    $: cheerio.load(`<div class="tgme_channel_info_header_title">${params.channel === 'alpha' ? '中文频道 &amp; 分享' : '学习笔记'}</div>`),
    channel: params.channel!,
    telegramHost: 'telegram.me',
    staticProxy: '',
  }))
  api = await import('./channel-titles')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('channel display names', () => {
  it('uses actual Unicode names instead of usernames or site branding', async () => {
    expect(await api.getChannelTitles(context)).toEqual({ alpha: '中文频道 & 分享', beta: '学习笔记' })
  })

  it('reuses names obtained while fetching posts and combines concurrent requests', async () => {
    api.rememberChannelTitle(context, 'alpha', '已有中文名称')
    expect(await api.getChannelTitle(context, 'alpha')).toBe('已有中文名称')
    expect(loadDocument).not.toHaveBeenCalled()
    expect(await Promise.all([api.getChannelTitle(context, 'beta'), api.getChannelTitle(context, 'BETA')]))
      .toEqual(['学习笔记', '学习笔记'])
    expect(loadDocument).toHaveBeenCalledTimes(1)
  })

  it('keeps a previous name during upstream failure and retries missing names', async () => {
    api.rememberChannelTitle(context, 'alpha', '已缓存的频道名')
    vi.advanceTimersByTime(6 * 60 * 1000)
    loadDocument.mockRejectedValue(new Error('Temporary upstream failure'))
    expect(await api.getChannelTitle(context, 'alpha')).toBe('已缓存的频道名')
    expect(await api.getChannelTitle(context, 'beta')).toBe('beta')
    loadDocument.mockResolvedValue({ $: cheerio.load('<div class="tgme_channel_info_header_title">恢复后的中文名</div>'), channel: 'beta', telegramHost: 'telegram.me', staticProxy: '' })
    vi.advanceTimersByTime(31 * 1000)
    expect(await api.getChannelTitle(context, 'beta')).toBe('恢复后的中文名')
  })

  it('does not fetch unconfigured channels or reuse names across Telegram hosts', async () => {
    await expect(api.getChannelTitle(context, 'unknown')).rejects.toThrow('Unknown channel')
    expect(loadDocument).not.toHaveBeenCalled()
    api.rememberChannelTitle(context, 'alpha', '旧站点的名称')
    vi.stubEnv('TELEGRAM_HOST', 'telegram.dog')
    expect(await api.getChannelTitle(context, 'alpha')).toBe('中文频道 & 分享')
    expect(loadDocument).toHaveBeenCalledTimes(1)
  })
})

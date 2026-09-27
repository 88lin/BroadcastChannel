import type { RequestContext } from './types'
import * as cheerio from 'cheerio'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadChannelDocument } from './request'

vi.mock('./request', () => ({ loadChannelDocument: vi.fn() }))

interface Entry { id: number, time: number, text?: string }
let entries: Record<string, Entry[]>
let api: typeof import('./index')
const context: RequestContext = { request: new Request('https://site.example/') }
const loadDocument = vi.mocked(loadChannelDocument)

function setupSources(count = 50) {
  entries = Object.fromEntries(['alpha', 'beta'].map((channel, index) => [channel, Array.from({ length: count }, (_, n) => ({ id: n + 1, time: (n + 1) * 2 + index }))]))
}

function htmlFor(channel: string, posts: Entry[]) {
  return `<div class="tgme_channel_info_header_title">${channel}</div>
    <div class="tgme_channel_info_description">Channel description</div>
    <div class="tgme_channel_history">${posts.map(post => `<div class="tgme_widget_message_wrap">
      <div class="tgme_widget_message" data-post="${channel}/${post.id}">
        <div class="tgme_widget_message_text">${post.text ?? `Post ${post.id}`}</div>
        <a class="tgme_widget_message_date"><time datetime="${new Date(1700000000000 + post.time * 1000).toISOString()}"></time></a>
      </div></div>`).join('')}</div>`
}

beforeEach(async () => {
  vi.resetModules()
  vi.resetAllMocks()
  for (const key of ['SITE_NAME', 'SITE_LOGO', 'SITE_DESCRIPTION', 'AD_KEYWORDS', 'FILTER_IMAGES', 'FILTER_FILES']) {
    vi.stubEnv(key, '')
  }
  vi.stubEnv('CHANNEL', 'alpha,beta')
  setupSources()
  loadDocument.mockImplementation(async (_context, params = {}) => {
    const channel = params.channel ?? 'alpha'
    let posts = entries[channel]
    if (params.id)
      posts = posts.filter(post => String(post.id) === params.id)
    else if (params.before)
      posts = posts.filter(post => post.id < Number(params.before))
    else if (params.after)
      posts = posts.filter(post => post.id > Number(params.after))
    return { $: cheerio.load(htmlFor(channel, posts.slice(-20))), channel, telegramHost: 'telegram.me', staticProxy: '' }
  })
  api = await import('./index')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('multi-channel timeline', () => {
  it('merges channels in descending time order with stable IDs', async () => {
    const { channel, pageSize } = await api.getTimelinePage(context)
    expect(pageSize).toBe(24)
    expect(channel.posts).toHaveLength(24)
    expect(channel.posts.slice(0, 4).map(post => post.id)).toEqual(['beta-50', '50', 'beta-49', '49'])
    expect(channel.timeline?.beforeCursor).toBeTruthy()
    expect(channel.timeline?.afterCursor).toBeUndefined()
  })

  it('walks every source page without duplicates or gaps and ends pagination', async () => {
    const ids: string[] = []
    let cursor = ''
    for (let page = 0; page < 10; page += 1) {
      const { channel } = await api.getTimelinePage(context, cursor)
      ids.push(...channel.posts.map(post => post.id))
      cursor = channel.timeline?.beforeCursor ?? ''
      if (!cursor)
        break
    }
    expect(ids).toHaveLength(100)
    expect(new Set(ids).size).toBe(100)
    expect(ids.slice(-4)).toEqual(['beta-2', '2', 'beta-1', '1'])
    expect(cursor).toBe('')
  })

  it('returns to the same preceding page', async () => {
    const first = (await api.getTimelinePage(context)).channel
    const second = (await api.getTimelinePage(context, first.timeline!.beforeCursor)).channel
    const third = (await api.getTimelinePage(context, second.timeline!.beforeCursor)).channel
    const previous = (await api.getTimelinePage(context, third.timeline!.afterCursor)).channel
    expect(previous.posts.map(post => post.id)).toEqual(second.posts.map(post => post.id))
    expect(api.isRootTimelineCursor(second.timeline!.afterCursor!)).toBe(true)
  })

  it.each([false, true])('keeps pagination stable when new posts arrive (one source dominates: %s)', async (dominantSource) => {
    if (dominantSource) {
      entries.beta.forEach(post => post.time += 1000)
    }
    let channel = (await api.getTimelinePage(context)).channel
    const ids = channel.posts.map(post => post.id)
    entries.alpha.push({ id: 51, time: 2000 })
    entries.beta.push({ id: 51, time: 2001 })
    for (let page = 0; channel.timeline?.beforeCursor && page < 10; page += 1) {
      channel = (await api.getTimelinePage(context, channel.timeline.beforeCursor)).channel
      ids.push(...channel.posts.map(post => post.id))
    }
    expect(ids).toHaveLength(100)
    expect(new Set(ids).size).toBe(100)
    expect(ids).not.toContain('51')
    expect(ids).not.toContain('beta-51')
  })

  it('breaks equal timestamps by channel order and numeric ID', async () => {
    setupSources(5)
    Object.values(entries).flat().forEach(post => post.time = 1)
    const { channel } = await api.getTimelinePage(context)
    expect(channel.posts.map(post => post.id)).toEqual(['5', '4', '3', '2', '1', 'beta-5', 'beta-4', 'beta-3', 'beta-2', 'beta-1'])
  })

  it.each([50, 38])('does not skip remaining posts when message %s is deleted between pages', async (deletedId) => {
    let channel = (await api.getTimelinePage(context)).channel
    const ids = channel.posts.map(post => post.id)
    entries.alpha = entries.alpha.filter(post => post.id !== deletedId)
    entries.beta = entries.beta.filter(post => post.id !== deletedId)
    const expected = new Set([
      ...ids,
      ...entries.alpha.map(post => String(post.id)),
      ...entries.beta.map(post => `beta-${post.id}`),
    ])
    for (let page = 0; channel.timeline?.beforeCursor && page < 10; page += 1) {
      channel = (await api.getTimelinePage(context, channel.timeline.beforeCursor)).channel
      ids.push(...channel.posts.map(post => post.id))
    }
    expect(ids).toHaveLength(expected.size)
    expect(new Set(ids)).toEqual(expected)
  })

  it('retains offset navigation when timestamp order differs from message ID order', async () => {
    setupSources(20)
    Object.values(entries).forEach((posts, index) => posts.forEach(post => post.time = 100 - post.id * 2 + index))
    const first = (await api.getTimelinePage(context)).channel
    const second = (await api.getTimelinePage(context, first.timeline!.beforeCursor)).channel
    const ids = [...first.posts, ...second.posts].map(post => post.id)
    expect(ids).toHaveLength(40)
    expect(new Set(ids).size).toBe(40)
    expect(first.posts.slice(0, 4).map(post => post.id)).toEqual(['beta-1', '1', 'beta-2', '2'])
  })

  it('fills pages across filtered source batches', async () => {
    vi.stubEnv('AD_KEYWORDS', 'advertisement')
    for (const posts of Object.values(entries)) {
      for (const post of posts) {
        if (post.id > 30)
          post.text = 'advertisement'
      }
    }
    const { channel } = await api.getTimelinePage(context)
    expect(channel.posts).toHaveLength(24)
    expect(channel.posts[0].id).toBe('beta-30')
    expect(channel.posts.every(post => !post.text.includes('advertisement'))).toBe(true)
  })

  it('continues when one channel is exhausted', async () => {
    entries.alpha = []
    const first = (await api.getTimelinePage(context)).channel
    const second = (await api.getTimelinePage(context, first.timeline!.beforeCursor)).channel
    expect(first.posts).toHaveLength(24)
    expect(second.posts).toHaveLength(24)
    expect(second.posts.every(post => post.id.startsWith('beta-'))).toBe(true)
    // One timeline load and one cached summary load; later pages reuse the summary.
    await api.getTimelinePage(context, second.timeline!.beforeCursor)
    expect(loadDocument.mock.calls.filter(([, params]) => params?.channel === 'alpha')).toHaveLength(2)
  })

  it('keeps primary channel branding after its posts are exhausted', async () => {
    entries.alpha = entries.alpha.slice(0, 2)
    entries.alpha.forEach(post => post.time += 1000)
    const first = (await api.getTimelinePage(context)).channel
    const second = (await api.getTimelinePage(context, first.timeline!.beforeCursor)).channel
    expect(second.title).toBe(first.title)
    expect(second.description).toBe(first.description)
  })

  it('keeps URLs bounded over deep pagination and retains a home link', async () => {
    setupSources(500)
    let channel = (await api.getTimelinePage(context)).channel
    for (let page = 0; page < 30; page += 1) {
      expect(channel.timeline!.beforeCursor!.length).toBeLessThanOrEqual(2048)
      channel = (await api.getTimelinePage(context, channel.timeline!.beforeCursor)).channel
    }
    for (let back = 0; back < 9; back += 1) {
      const cursor = channel.timeline!.afterCursor!
      expect(cursor).toBeTruthy()
      if (api.isRootTimelineCursor(cursor))
        return
      channel = (await api.getTimelinePage(context, cursor)).channel
    }
    throw new Error('No root link at the end of the retained history')
  })

  it('keeps sitemap cursors out of timeline navigation', async () => {
    const channel = await api.getChannelInfo(context)
    expect(channel.sitemapAfterCursor).toBe('50-50')
    expect(channel.timeline).toBeUndefined()
    expect(channel).not.toHaveProperty('beforeCursor')
    expect(channel).not.toHaveProperty('afterCursor')
    expect((await api.getChannelSummary(context)).timeline).toBeUndefined()
  })

  it('routes secondary post IDs back to the correct channel', async () => {
    expect((await api.getChannelPost(context, 'beta-12'))?.id).toBe('beta-12')
    expect(loadDocument).toHaveBeenLastCalledWith(context, { channel: 'beta', id: '12' })
    expect((await api.getChannelPost(context, '12'))?.id).toBe('12')
  })

  it('reuses the channel summary across separate article loads', async () => {
    const [first] = await Promise.all([api.getChannelSummary(context), api.getChannelPost(context, '12')])
    const [second] = await Promise.all([api.getChannelSummary(context), api.getChannelPost(context, '13')])
    expect(first).toEqual(second)
    const summaryCalls = loadDocument.mock.calls.filter(([, params]) => params?.channel === 'alpha' && !params.id)
    expect(summaryCalls).toHaveLength(1)
  })

  it('rejects incorrect channel counts before fetching', async () => {
    const cursor = btoa(JSON.stringify({ v: 2, s: [['', 0]], h: [] }))
    await expect(api.getTimelinePage(context, cursor)).rejects.toBeInstanceOf(api.InvalidTimelineCursorError)
    expect(loadDocument).not.toHaveBeenCalled()
  })

  it('propagates upstream failure instead of treating it as an invalid cursor', async () => {
    loadDocument.mockRejectedValue(new Error('upstream unavailable'))
    await expect(api.getTimelinePage(context)).rejects.toThrow('upstream unavailable')
  })

  it('serves stale data after a refresh failure and retries the next request', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1000)
    vi.resetModules()
    api = await import('./index')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const first = await api.getTimelinePage(context)
    clock.mockReturnValue(1000 + 6 * 60 * 1000)
    await vi.advanceTimersByTimeAsync(6 * 60 * 1000)
    loadDocument.mockRejectedValueOnce(new Error('temporary upstream failure'))
    const fallback = await api.getTimelinePage(context)
    expect(fallback.channel.posts).toEqual(first.channel.posts)
    expect(warn).toHaveBeenCalledWith('Serving stale cache after fetch failure', expect.any(Object))
    const previousCalls = loadDocument.mock.calls.length
    await api.getTimelinePage(context)
    expect(loadDocument.mock.calls.length).toBeGreaterThan(previousCalls)
    warn.mockRestore()
  })

  it('coalesces concurrent loads and isolates callers from cached mutations', async () => {
    const [first, second] = await Promise.all([api.getTimelinePage(context), api.getTimelinePage(context)])
    expect(loadDocument).toHaveBeenCalledTimes(2)
    first.channel.posts[0].title = 'Mutated'
    expect(second.channel.posts[0].title).not.toBe('Mutated')
    expect((await api.getTimelinePage(context)).channel.posts[0].title).not.toBe('Mutated')
  })

  it('stops when upstream repeats a page instead of looping forever', async () => {
    const original = loadDocument.getMockImplementation()!
    loadDocument.mockImplementation((ctx, params) => original(ctx, { ...params, before: '' }))
    const first = (await api.getTimelinePage(context)).channel
    await expect(api.getTimelinePage(context, first.timeline!.beforeCursor)).rejects.toThrow('Telegram pagination did not advance')
  })
})

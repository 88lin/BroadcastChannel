import type { APIContext } from 'astro'
import * as cheerio from 'cheerio'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadChannelDocument } from './request'

vi.mock('./request', () => ({ loadChannelDocument: vi.fn() }))

const loadDocument = vi.mocked(loadChannelDocument)
let filterRecent = false

function context(path: string, cursor = ''): APIContext {
  return { url: new URL(path, 'https://site.example'), params: { cursor }, locals: { SITE_URL: 'https://site.example/' } } as unknown as APIContext
}

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  filterRecent = false
  for (const key of ['AD_KEYWORDS', 'FILTER_IMAGES', 'FILTER_FILES']) {
    vi.stubEnv(key, '')
  }
  loadDocument.mockImplementation(async (_context, params = {}) => {
    const channel = params.channel ?? 'alpha'
    const ids = Array.from({ length: 25 }, (_, i) => i + 1).filter(id => !params.before || id < Number(params.before)).slice(-20)
    const html = `<div class="tgme_channel_history">${ids.map(id => `<div class="tgme_widget_message_wrap">
      <div class="tgme_widget_message" data-post="${channel}/${id}">
        <div class="tgme_widget_message_text">${filterRecent && id > 5 ? 'advertisement' : `Post ${id}`}</div>
        <a class="tgme_widget_message_date"><time datetime="2026-01-01T00:00:00Z"></time></a>
      </div></div>`).join('')}</div>`
    return { $: cheerio.load(html), channel, telegramHost: 'telegram.me', staticProxy: '' }
  })
})

afterEach(() => vi.unstubAllEnvs())

describe('sitemap routes', () => {
  it.each(['alpha', 'alpha,beta'])('includes every post, including each latest post, for %s', async (channels) => {
    vi.stubEnv('CHANNEL', channels)
    const { GET: getIndex } = await import('../../pages/sitemap.xml')
    const { GET: getPage } = await import('../../pages/sitemap/[cursor].xml')
    const index = await getIndex(context('/sitemap.xml'))
    const $index = cheerio.load(await index.text(), { xmlMode: true })
    const paths = $index('loc').map((i, node) => new URL($index(node).text()).pathname).get()
    const urls: string[] = []
    for (const path of paths) {
      const cursor = path.slice('/sitemap/'.length, -'.xml'.length)
      const response = await getPage(context(path, cursor))
      expect(response.status).toBe(200)
      const $ = cheerio.load(await response.text(), { xmlMode: true })
      urls.push(...$('loc').map((i, node) => $(node).text()).get())
    }
    expect(urls).toHaveLength(25 * channels.split(',').length)
    expect(new Set(urls).size).toBe(urls.length)
    expect(urls).toContain('https://site.example/posts/25')
    if (channels.includes(','))
      expect(urls).toContain('https://site.example/posts/beta-25')
  })

  it.each(['unknown-25', 'alpha-nope', 'alpha-0', 'alpha--1'])('rejects invalid sitemap cursor %s without fetching', async (cursor) => {
    vi.stubEnv('CHANNEL', 'alpha,beta')
    const { GET } = await import('../../pages/sitemap/[cursor].xml')
    const response = await GET(context(`/sitemap/${cursor}.xml`, cursor))
    expect(response.status).toBe(404)
    expect(loadDocument).not.toHaveBeenCalled()
  })

  it('keeps older pages discoverable when all recent posts are filtered', async () => {
    vi.stubEnv('CHANNEL', 'alpha')
    vi.stubEnv('AD_KEYWORDS', 'advertisement')
    filterRecent = true
    const { GET: getIndex } = await import('../../pages/sitemap.xml')
    const { GET: getPage } = await import('../../pages/sitemap/[cursor].xml')
    const index = await getIndex(context('/sitemap.xml'))
    expect(await index.text()).toContain('/sitemap/5.xml')
    const page = await getPage(context('/sitemap/5.xml', '5'))
    const $ = cheerio.load(await page.text(), { xmlMode: true })
    expect($('url')).toHaveLength(5)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { sanitizeContentHtml } from '../sanitize'
import { extractPost } from './parse'
import { getTelegramRequestHeaders } from './request'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('telegram request headers', () => {
  it('keeps post boundaries and safe code text with misnested formatting and missing paragraph end tags', async () => {
    vi.resetModules()
    const html = [17, 18].map(id => `<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="malformed/${id}">
      <div class="tgme_widget_message_text"><p>first<b>bold</p>tail</b><p>second
        <pre data-language="yaml">key: &lt;script&gt;<br>  enabled: true</pre>
        <img src="https://example.com/image" onerror="alert(1)"><script>alert(1)</script>
      </div><a class="tgme_widget_message_date"><time datetime="2026-01-01T00:00:00Z"></time></a>
    </div></div>`).join('')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(html)))
    const { loadChannelDocument } = await import('./request')
    const { $ } = await loadChannelDocument({ request: new Request('https://site.example/') }, { channel: 'malformed' })
    const posts = await Promise.all($('.tgme_widget_message_wrap').toArray().map(node => extractPost($, node, {
      channel: 'malformed',
      telegramHost: 'telegram.me',
      staticProxy: '',
    })))
    expect(posts.map(post => post.id)).toEqual(['17', '18'])
    for (const post of posts) {
      expect(post.text).toContain('firstboldtailsecond')
      expect(post.text).toContain('key: <script>\n  enabled: true')
      const clean = sanitizeContentHtml(post.content)
      expect(clean).toContain('language-yaml')
      expect(clean).toContain('&lt;script&gt;')
      expect(clean).not.toMatch(/<script|onerror/i)
    }
  })

  it('parses Telegram fragments with decoded entities, void elements and custom tags', async () => {
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<div class="message">中文 &amp; &lt;code&gt;<br><img src="https://example.com/a?x=1&amp;y=2"><tg-spoiler>hidden</tg-spoiler><pre>  a<br>  b</pre></div>')))
    const { loadChannelDocument } = await import('./request')
    const { $ } = await loadChannelDocument({ request: new Request('https://site.example/') }, { channel: 'parser-fixture' })
    expect($('.message').text()).toContain('中文 & <code>')
    expect($('img').attr('src')).toBe('https://example.com/a?x=1&y=2')
    expect($('tg-spoiler').text()).toBe('hidden')
    expect($('pre br')).toHaveLength(1)
    expect($('html, body')).toHaveLength(0)
  })

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

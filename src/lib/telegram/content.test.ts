import { load } from 'cheerio'
import { describe, expect, it } from 'vitest'
import { modifyHTMLContent } from './content'

describe('telegram HTML content', () => {
  it('preserves nested code text, entities and consecutive breaks without keeping markup', async () => {
    const $ = load('<div class="message"><pre>  &lt;item&gt;<span>a<br><b>b</b></span><!-- ignored --><br><br>  &amp; 中文</pre></div>')
    await modifyHTMLContent($, $('.message'))
    expect($('pre code').text()).toBe('  <item>a\nb\n\n  & 中文')
    expect($('pre br, pre span, pre b, pre item')).toHaveLength(0)
    expect($('pre').html()).toContain('&lt;item&gt;')
  })

  it('emits escaped code for client highlighting before JavaScript runs', async () => {
    const $ = load('<div class="message"><pre><code>&lt;script&gt;alert(1)&lt;/script&gt;<br>  key: &amp;value</code></pre></div>')
    await modifyHTMLContent($, $('.message'))
    expect($('pre code').text()).toBe('<script>alert(1)</script>\n  key: &value')
    expect($('pre script, pre span')).toHaveLength(0)
    expect($('pre').html()).toContain('&lt;script&gt;')
    expect($('pre code').attr('class')).toBe('language-auto')
  })

  it.each(['<pre><code class="language-yaml">key: true</code></pre>', '<pre data-language="yaml">key: true</pre>'])('preserves declared language metadata: %s', async (html) => {
    const $ = load(`<div class="message">${html}</div>`)
    await modifyHTMLContent($, $('.message'))
    expect($('pre code').attr('class')).toBe('language-yaml')
    expect($('pre code').text()).toBe('key: true')
  })

  it('preserves punctuation in C++ and C# language aliases', async () => {
    const $ = load('<div class="message"><pre class="language-c++">int a;</pre><pre class="language-c#">int b;</pre></div>')
    await modifyHTMLContent($, $('.message'))
    expect($('pre code').map((_, node) => $(node).attr('class')).get()).toEqual(['language-c++', 'language-c#'])
  })

  it('uses the configured Telegram host for custom emoji images', async () => {
    const $ = load('<div class="message"><tg-emoji emoji-id="123"></tg-emoji></div>')
    const content = $('.message')

    await modifyHTMLContent($, content, {
      telegramHost: 'telegram.dog',
      staticProxy: '/static/',
    })

    expect(content.find('img.tg-emoji').attr('src'))
      .toBe('/static/https://telegram.dog/i/emoji/123.webp')
  })
})

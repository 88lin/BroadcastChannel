import { load } from 'cheerio'
import { describe, expect, it } from 'vitest'
import { proxyStyleUrls } from './renderers/html'
import { normalizeSrcsetAttribute, normalizeUrlAttributes } from './url'

describe('telegram URL normalization', () => {
  it('normalizes root and nested URLs, srcset and styles around attribute-free code', () => {
    const $ = load('<div class="message" style="background-image:url(https://telegram.me/root?a=1&amp;amp;b=2)"><pre>a<br>b</pre><a href="?a=1&amp;amp;b=2">link</a><img src="https://telegram.me/a?a=1&amp;amp;b=2" srcset="/a?a=1&amp;amp;b=2 1x"><span style="background-image:url(https://telegram.me/nested?a=1&amp;amp;b=2)"></span></div>')
    const content = $('.message')
    normalizeUrlAttributes($, content)
    proxyStyleUrls($, content, '/static/')
    expect($('a').attr('href')).toBe('?a=1&b=2')
    expect($('img').attr('src')).toBe('https://telegram.me/a?a=1&b=2')
    expect($('img').attr('srcset')).toBe('/a?a=1&b=2 1x')
    expect(content.attr('style')).toBe('background-image:url(/static/https://telegram.me/root?a=1&b=2)')
    expect($('span').attr('style')).toBe('background-image:url(/static/https://telegram.me/nested?a=1&b=2)')
    expect($('pre').html()).toBe('a<br>b')
  })

  it('decodes entity references inside srcset candidates', () => {
    expect(normalizeSrcsetAttribute('https://cdn-telegram.org/a.webp?x=1&amp;y=2 1x, /b.webp?x=3&amp;y=4 2x'))
      .toBe('https://cdn-telegram.org/a.webp?x=1&y=2 1x, /b.webp?x=3&y=4 2x')
  })
})

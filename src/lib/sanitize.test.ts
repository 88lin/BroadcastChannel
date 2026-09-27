import { describe, expect, it } from 'vitest'
import { sanitizeContentHtml, sanitizeFeedHtml } from './sanitize'

describe('sanitizeContentHtml', () => {
  it('preserves allowed images, including images with the modal-img class', () => {
    const result = sanitizeContentHtml(`
      <p>
        <img src="ordinary.jpg" alt="Ordinary image" class="photo">
        <img src="modal.jpg" alt="Modal image" class="photo modal-img">
      </p>
    `)

    expect(result).toContain('src="ordinary.jpg"')
    expect(result).toContain('alt="Ordinary image"')
    expect(result).toContain('src="modal.jpg"')
    expect(result).toContain('class="photo modal-img"')
  })
})

describe('sanitizeFeedHtml', () => {
  it('removes modal images while preserving other allowed content', () => {
    const result = sanitizeFeedHtml(`
      <p>
        <strong>Allowed text</strong>
        <img src="ordinary.jpg" alt="Ordinary image" class="photo">
        <img src="modal.jpg" alt="Modal image" class="photo modal-img">
      </p>
    `)

    expect(result).toContain('<strong>Allowed text</strong>')
    expect(result).toContain('src="ordinary.jpg"')
    expect(result).not.toContain('src="modal.jpg"')
    expect(result).not.toContain('modal-img')
  })
})

describe.each([
  ['sanitizeContentHtml', sanitizeContentHtml],
  ['sanitizeFeedHtml', sanitizeFeedHtml],
])('%s safety', (_name, sanitize) => {
  it('scopes inline local tags without changing external links or weakening sanitization', () => {
    const html = '<a href="/search/result?q=%23AI">#AI</a><a href="https://example.com/search/result?q=test">External</a><a href="javascript:alert(1)" onclick="alert(1)">Unsafe</a>'
    const selected = sanitize(html, 'beta')
    expect(selected).toContain('href="/search/result?q=%23AI&amp;channel=beta"')
    expect(selected).toContain('href="https://example.com/search/result?q=test"')
    expect(selected).not.toContain('javascript:')
    expect(selected).not.toContain('onclick')
    expect(sanitize(html)).not.toContain('channel=')
  })

  it('removes scripts and dangerous attributes', () => {
    const result = sanitize(`
      <p onclick="alert('click')">
        <strong>Allowed text</strong>
        <a href="javascript:alert('link')">Link</a>
        <img src="ordinary.jpg" onerror="alert('image')">
        <script>alert('script')</script>
      </p>
    `)

    expect(result).toContain('<strong>Allowed text</strong>')
    expect(result).toContain('src="ordinary.jpg"')
    expect(result).not.toContain('<script')
    expect(result).not.toContain('javascript:')
    expect(result).not.toContain('onclick=')
    expect(result).not.toContain('onerror=')
    expect(result).not.toContain('alert(\'script\')')
  })

  it('preserves the semantic sticker fallback', () => {
    const result = sanitize('<span class="sticker-fallback" role="img" aria-label="Sticker unavailable">Sticker unavailable</span>')

    expect(result).toBe('<span class="sticker-fallback" role="img" aria-label="Sticker unavailable">Sticker unavailable</span>')
  })
})

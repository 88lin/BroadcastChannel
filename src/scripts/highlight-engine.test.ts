import { load } from 'cheerio'
import { describe, expect, it } from 'vitest'
import { highlightCode } from './highlight-engine'

describe('browser code highlighting engine', () => {
  it.each([
    ['yaml', 'proxies:\n  - name: example\n    port: 443'],
    ['json', '{"enabled": true, "port": 443}'],
    ['py', 'def hello():\n    print("hello")'],
    ['bash', 'echo "$HOME"'],
    ['c#', 'public class Example { int port = 443; }'],
  ])('highlights declared %s without changing code text', async (language, code) => {
    const result = await highlightCode(code, language)
    const $ = load(`<code>${result.html}</code>`)
    expect($('code .token').length).toBeGreaterThan(0)
    expect($('code').text()).toBe(code)
  })

  it('detects and highlights an unlabeled configuration block', async () => {
    const result = await highlightCode('proxies:\n  - name: example\n    server: example.com\n    port: 443')
    expect(result.html).toContain('class="token')
  })

  it('escapes markup inside code instead of creating active HTML', async () => {
    const code = '<script>alert(1)</script><img src=x onerror=alert(1)>'
    const result = await highlightCode(code, 'html')
    const $ = load(`<code>${result.html}</code>`)
    expect($('script, img')).toHaveLength(0)
    expect($('code').text()).toBe(code)
  })

  it.each(['text', 'unsupported-language', '__proto__'])('keeps %s as readable plain text', async (hint) => {
    expect(await highlightCode('content', hint)).toEqual({ language: 'text' })
  })

  it('leaves oversized code as plain text without building a token DOM', async () => {
    expect(await highlightCode('key: true\n'.repeat(10_001), 'yaml')).toEqual({ language: 'text' })
  })
})

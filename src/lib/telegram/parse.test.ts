import * as cheerio from 'cheerio'
import { describe, expect, it } from 'vitest'
import { extractPost } from './parse'

const options = { channel: 'beta', telegramHost: 'telegram.me', staticProxy: '', isMultiChannel: true, isPrimaryChannel: false }

function message(dataPost: string) {
  return cheerio.load(`<div class="tgme_widget_message" data-post="${dataPost}">
    <div class="tgme_widget_message_text">Hello <a href="?q=%23tag">#tag</a></div>
    <a class="tgme_widget_message_date"><time datetime="2026-01-01T00:00:00Z"></time></a>
  </div>`)
}

describe('telegram post IDs', () => {
  it('prefixes secondary channel IDs and rewrites tags', async () => {
    const post = await extractPost(message('Beta/123'), null, options)
    expect(post.id).toBe('beta-123')
    expect(post.tags).toEqual(['tag'])
    expect(post.content).toContain('/search/result?q=%23tag')
  })

  it('keeps primary and single-channel IDs compatible', async () => {
    expect((await extractPost(message('beta/123'), null, { ...options, isPrimaryChannel: true })).id).toBe('123')
    expect((await extractPost(message('beta/123'), null, { ...options, isMultiChannel: false })).id).toBe('123')
  })

  it.each(['', 'other/beta/123', 'other/123'])('does not manufacture IDs from missing or mismatched data-post: %s', async (dataPost) => {
    expect((await extractPost(message(dataPost), null, options)).id).toBe('')
  })
})

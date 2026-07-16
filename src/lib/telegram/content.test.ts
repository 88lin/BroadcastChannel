import { load } from 'cheerio'
import { describe, expect, it } from 'vitest'
import { modifyHTMLContent } from './content'

describe('telegram HTML content', () => {
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

import type { AnyNode, CheerioAPI } from 'cheerio'
import type { IndexedStaticProxyOptions, MessageSelection, StaticProxyOptions } from './types'
import { getCustomEmojiImage } from './emoji'
import { proxyStyleUrls } from './renderers/html'
import { normalizeUrlAttribute, normalizeUrlAttributes } from './url'

interface ModifyHTMLContentOptions extends IndexedStaticProxyOptions {
  telegramHost?: string
  normalizeUrls?: boolean
}

interface HydrateTgEmojiOptions extends StaticProxyOptions {
  telegramHost?: string
}

function getCodeText(node: AnyNode): string {
  if (node.type === 'text')
    return node.data
  if (node.type === 'tag' && node.name === 'br')
    return '\n'
  return 'children' in node ? node.children.map(getCodeText).join('') : ''
}

async function hydrateTgEmoji($: CheerioAPI, content: MessageSelection, options: HydrateTgEmojiOptions = {}): Promise<void> {
  const { telegramHost, staticProxy = '' } = options

  for (const emojiNode of content.find('tg-emoji').toArray()) {
    const emojiId = $(emojiNode).attr('emoji-id')
    const imageUrl = getCustomEmojiImage(emojiId, { telegramHost, staticProxy })

    if (imageUrl) {
      $(emojiNode).replaceWith(`<img class="tg-emoji" src="${imageUrl}" alt="" loading="lazy" width="20" height="20" />`)
    }
  }
}

export async function modifyHTMLContent($: CheerioAPI, content: MessageSelection, options: ModifyHTMLContentOptions = {}): Promise<MessageSelection> {
  const { index = 0, telegramHost, staticProxy = '', normalizeUrls = true } = options

  await hydrateTgEmoji($, content, { telegramHost, staticProxy })
  if (normalizeUrls) {
    normalizeUrlAttributes($, content)
  }
  proxyStyleUrls($, content, staticProxy)
  content.find('.emoji').removeAttr('style')

  for (const linkNode of content.find('a').toArray()) {
    const link = $(linkNode)
    const href = link.attr('href')

    if (href && normalizeUrls) {
      link.attr('href', normalizeUrlAttribute(href))
    }

    link.attr('title', link.text()).removeAttr('onclick')
  }

  for (const [blockquoteIndex, blockquoteNode] of content.find('blockquote[expandable]').toArray().entries()) {
    const innerHTML = $(blockquoteNode).html() ?? ''
    const expandId = `expand-${index}-${blockquoteIndex}`
    const expandContentId = `${expandId}-content`
    const expandable = `<div class="tg-expandable">
      <input type="checkbox" id="${expandId}" class="tg-expandable__checkbox" aria-label="Toggle hidden content" aria-controls="${expandContentId}">
      <div id="${expandContentId}" class="tg-expandable__content">${innerHTML}</div>
      <label for="${expandId}" class="tg-expandable__toggle"><span class="sr-only">Toggle hidden content</span></label>
    </div>`

    $(blockquoteNode).replaceWith(expandable)
  }

  for (const [spoilerIndex, spoilerNode] of content.find('tg-spoiler').toArray().entries()) {
    const spoiler = $(spoilerNode)
    const spoilerId = `spoiler-${index}-${spoilerIndex}`
    const spoilerInput = `<input type="checkbox" aria-label="Toggle spoiler" aria-controls="${spoilerId}" />`

    spoiler.attr('id', spoilerId).wrap('<label class="spoiler-button"></label>').before(spoilerInput)
  }

  for (const preNode of content.find('pre').toArray()) {
    const pre = $(preNode)
    const originalCode = pre.find('code').first()
    const classes = `${originalCode.attr('class') ?? ''} ${pre.attr('class') ?? ''}`
    const declared = classes.match(/\blang(?:uage)?-([\w+#-]+)/i)?.[1]
      ?? originalCode.attr('data-language') ?? pre.attr('data-language') ?? ''
    const language = /^[\w+#-]{1,32}$/.test(declared) ? declared.toLowerCase() : 'auto'
    // Preserve language hints for the browser worker, and escape code through .text().
    // Language detection and token generation never run in the server request path.
    // Read breaks without replacing/reparsing every <br> in long Telegram code blocks.
    const code = $('<code></code>').attr('class', `language-${language}`).text(getCodeText(preNode))
    pre.empty().append(code)
  }

  return content
}

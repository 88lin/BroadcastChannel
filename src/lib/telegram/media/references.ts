import type { CheerioAPI } from 'cheerio'
import type { MessageSelection, ReplyOptions } from '../types'
import { normalizeUrlAttribute } from '../url'

export function getReply($: CheerioAPI, message: MessageSelection, options: ReplyOptions): string {
  const channels = options.channels?.length ? options.channels : [options.channel]
  const { isMultiChannel } = options
  const reply = message.find('.tgme_widget_message_reply')

  reply.wrapInner('<small></small>').wrapInner('<blockquote></blockquote>')

  const href = reply.attr('href')
  if (href) {
    const replyUrl = new URL(normalizeUrlAttribute(href), 'https://t.me')
    const pathParts = replyUrl.pathname.split('/').filter(Boolean)

    if (pathParts.length >= 2) {
      const targetChannel = pathParts[0]
      const targetId = pathParts[1]

      if (channels.length > 0 && targetChannel === channels[0]) {
        reply.attr('href', `/posts/${targetId}`)
      }
      else if (isMultiChannel && channels.includes(targetChannel)) {
        reply.attr('href', `/posts/${targetChannel}-${targetId}`)
      }
      else {
        reply.attr('href', replyUrl.toString()).attr('target', '_blank').attr('rel', 'noopener')
      }
    }
    else {
      reply.attr('href', replyUrl.toString()).attr('target', '_blank').attr('rel', 'noopener')
    }
  }

  return $.html(reply)
}

export function getForwardedFrom($: CheerioAPI, message: MessageSelection): string {
  const forwardedFrom = message.find('.tgme_widget_message_forwarded_from')

  for (const linkNode of forwardedFrom.find('a').toArray()) {
    const link = $(linkNode)
    const href = link.attr('href')

    if (href) {
      link.attr('href', normalizeUrlAttribute(href)).attr('target', '_blank').attr('rel', 'noopener')
    }
  }

  return $.html(forwardedFrom)
}

import type { ChannelInfo, GetChannelInfoParams } from '../../types'
import type { RequestContext } from './types'
import { getBooleanEnv, getStaticProxy, getTelegramHost } from '../env'
import { loadCachedValue } from './cache'
import { rememberChannelTitle } from './channel-titles'
import { modifyHTMLContent } from './content'
import { extractPost } from './parse'
import { loadChannelDocument } from './request'
import { normalizeUrlAttribute } from './url'

/** Share parsed, unfiltered source batches between timeline, search, feed and sitemap. */
export function getParsedChannelPage(
  context: RequestContext,
  channels: string[],
  params: GetChannelInfoParams & { channel: string },
): Promise<ChannelInfo> {
  const { channel, before = '', after = '', q = '' } = params
  const key = JSON.stringify({
    scope: 'source-page',
    channels,
    channel,
    before,
    after,
    q,
    host: getTelegramHost(import.meta.env, context),
    proxy: getStaticProxy(import.meta.env, context),
    reactions: getBooleanEnv(import.meta.env, context, 'REACTIONS'),
  })
  return loadCachedValue(key, async () => {
    const { $, telegramHost, staticProxy, reactionsEnabled } = await loadChannelDocument(context, params)
    const title = $('.tgme_channel_info_header_title').text()
    rememberChannelTitle(context, channel, title)
    const avatar = $('.tgme_page_photo_image img').attr('src')
    const description = $('.tgme_channel_info_description')
    const descriptionText = description.text()
    const descriptionHTML = (await modifyHTMLContent($, description, { telegramHost, staticProxy })).html()
    const posts = (await Promise.all($('.tgme_channel_history .tgme_widget_message_wrap').toArray().map((node, index) => extractPost($, node, {
      channel,
      telegramHost,
      staticProxy,
      reactionsEnabled,
      index,
      isMultiChannel: channels.length > 1,
      isPrimaryChannel: channel === channels[0],
      allChannels: channels,
    })))).reverse()
    return {
      title,
      description: descriptionText,
      descriptionHTML,
      avatar: avatar ? normalizeUrlAttribute(avatar) : avatar,
      avatarNeedsProxy: true,
      posts,
    }
  }, false)
}

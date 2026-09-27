import type { APIContext } from 'astro'
import type { ChannelInfo, Post } from '../types'
import { getSelectedChannel, withChannel } from './channels'
import { sanitizeFeedHtml } from './sanitize'
import { getChannelInfo } from './telegram'

export interface FeedData {
  channel: ChannelInfo
  posts: Post[]
  siteUrl: URL
  tag: string | null
  title: string
  channelFilter?: string
}

export interface JsonFeedData {
  version: string
  title: string
  description: string
  home_page_url: string
  feed_url: string
  items: {
    id: string
    url: string
    title: string | undefined
    summary: string | undefined
    date_published: string
    tags: string[]
    content_html: string
  }[]
}

export function buildJsonFeed({ channel, posts, siteUrl, title, tag, channelFilter = '' }: FeedData): JsonFeedData {
  const feedUrl = new URL('rss.json', siteUrl)
  if (tag) {
    feedUrl.searchParams.set('tag', tag)
  }
  return {
    version: 'https://jsonfeed.org/version/1.1',
    title,
    description: channel.description,
    home_page_url: withChannel(siteUrl.toString(), channelFilter),
    feed_url: withChannel(feedUrl.toString(), channelFilter),
    items: posts.map((item) => {
      const itemUrl = new URL(`posts/${item.id}`, siteUrl).toString()

      return {
        id: itemUrl,
        url: itemUrl,
        title: item.title || undefined,
        summary: item.description,
        date_published: new Date(item.datetime).toISOString(),
        tags: item.tags,
        content_html: sanitizeFeedHtml(item.content, channelFilter),
      }
    }),
  }
}

export async function getFeedData(context: APIContext): Promise<FeedData> {
  const tag = context.url.searchParams.get('tag')
  const channelFilter = getSelectedChannel(context)
  const channel = await getChannelInfo(context, {
    q: tag ? `#${tag}` : '',
    channel: channelFilter,
  })
  const siteUrl = new URL(context.locals.SITE_URL, context.url.origin)
  siteUrl.search = ''

  return {
    channel,
    posts: channel.posts ?? [],
    siteUrl,
    tag,
    channelFilter,
    title: `${tag ? `${tag} | ` : ''}${channelFilter ? `@${channelFilter} | ` : ''}${channel.title}`,
  }
}

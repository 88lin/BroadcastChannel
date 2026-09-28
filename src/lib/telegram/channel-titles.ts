import type { RequestContext } from './types'
import { LRUCache } from 'lru-cache'
import { getConfiguredChannels, resolveSelectedChannel } from '../channels'
import { getTelegramHost } from '../env'
import { loadChannelDocument } from './request'

const titles = new LRUCache<string, string>({ max: 512, ttl: 5 * 60 * 1000 })
const staleTitles = new LRUCache<string, string>({ max: 512, ttl: 24 * 60 * 60 * 1000 })
const pending = new Map<string, Promise<string>>()

function titleKey(context: RequestContext, channel: string): string {
  return JSON.stringify([getTelegramHost(import.meta.env, context), channel.toLowerCase()])
}

/** Reuse the channel name from a document already fetched for the timeline. */
export function rememberChannelTitle(context: RequestContext, channel: string, title: string): void {
  const name = title.trim()
  if (!name)
    return
  const key = titleKey(context, channel)
  titles.set(key, name)
  staleTitles.set(key, name)
}

export async function getChannelTitle(context: RequestContext, channel: string): Promise<string> {
  const selected = resolveSelectedChannel(getConfiguredChannels(context), channel)
  if (!selected)
    return ''
  const key = titleKey(context, selected)
  const cached = titles.get(key)
  if (cached)
    return cached
  const existing = pending.get(key)
  if (existing)
    return existing

  const request = (async () => {
    try {
      // Names are optional metadata: abort promptly instead of blocking a working page.
      const { $ } = await loadChannelDocument(context, { channel: selected, timeout: 1000, retry: 0 })
      const title = $('.tgme_channel_info_header_title').text().trim()
      if (!title)
        throw new Error('Channel title unavailable')
      rememberChannelTitle(context, selected, title)
      return title
    }
    catch {
      // A missing name must not make a working timeline fail. Retry after a short TTL.
      const fallback = staleTitles.get(key) ?? selected
      titles.set(key, fallback, { ttl: 30 * 1000 })
      return fallback
    }
  })().finally(() => pending.delete(key))
  pending.set(key, request)
  return request
}

export async function getChannelTitles(context: RequestContext): Promise<Record<string, string>> {
  const channels = getConfiguredChannels(context)
  return Object.fromEntries(await Promise.all(channels.map(async channel => [channel, await getChannelTitle(context, channel)])))
}

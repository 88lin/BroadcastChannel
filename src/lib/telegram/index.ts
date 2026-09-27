import type { ChannelInfo, GetChannelInfoParams, Post, TimelinePage } from '../../types'
import type { TimelineCursorPayload, TimelineSourceCursor } from './timeline-cursor'
import type { RequestContext } from './types'
import { LRUCache } from 'lru-cache'
import { getConfiguredChannels, getSelectedChannel, resolveSelectedChannel } from '../channels'
import { getBooleanEnv, getEnv, parseCsvList } from '../env'
import { rememberChannelTitle } from './channel-titles'
import { modifyHTMLContent } from './content'
import { extractPost } from './parse'
import { loadChannelDocument } from './request'
import { decodeTimelineCursor, encodeTimelineCursor, InvalidTimelineCursorError } from './timeline-cursor'
import { normalizeUrlAttribute } from './url'

export { InvalidTimelineCursorError, isRootTimelineCursor } from './timeline-cursor'

type CacheValue = ChannelInfo | Post

interface PostFilterConfig {
  filterImages: boolean
  filterFiles: boolean
  adRegex: RegExp | null
}

interface TimelineSourcePage {
  posts: Post[]
  source: TimelineSourceCursor
  nextBefore: string
  exhausted: boolean
}

interface TimelineMergeState {
  page: TimelineSourcePage
  index: number
}

const FRESH_CACHE_TTL = 1000 * 60 * 5
const STALE_CACHE_TTL = 1000 * 60 * 60 * 24
const TIMELINE_PAGE_SIZE = 24
const cacheSizeEncoder = new TextEncoder()

// The budgets measure serialized UTF-8 bytes, not the total JavaScript heap footprint.
const cache = new LRUCache<string, CacheValue>({
  ttl: FRESH_CACHE_TTL,
  maxSize: 50 * 1024 * 1024,
})

const staleCache = new LRUCache<string, CacheValue>({
  ttl: STALE_CACHE_TTL,
  maxSize: 50 * 1024 * 1024,
})

const inFlightRequests = new Map<string, Promise<CacheValue | null>>()

function cloneCacheValue<T extends CacheValue>(value: T): T {
  return structuredClone(value)
}

function isChannelInfo(value: CacheValue): value is ChannelInfo {
  return 'posts' in value
}

function setCacheValue(key: string, value: CacheValue): void {
  const size = cacheSizeEncoder.encode(JSON.stringify(value)).byteLength
  cache.set(key, value, { size })
  staleCache.set(key, value, { size })
}

async function loadCachedValue<T extends CacheValue | null>(
  key: string,
  loadValue: () => Promise<T>,
): Promise<T> {
  const existingRequest = inFlightRequests.get(key) as Promise<T> | undefined
  if (existingRequest) {
    return existingRequest
  }

  const request = loadValue()
    .then((value) => {
      if (value) {
        setCacheValue(key, value)
      }
      return value
    })
    .catch((error) => {
      const staleValue = staleCache.get(key) as T | undefined
      if (staleValue) {
        console.warn('Serving stale cache after fetch failure', {
          key,
          error: error instanceof Error ? error.message : String(error),
        })
        return staleValue
      }
      throw error
    })
    .finally(() => {
      inFlightRequests.delete(key)
    })

  inFlightRequests.set(key, request)
  return request
}

function getOptionalStringEnv(context: RequestContext, name: string): string | undefined {
  const value = getEnv(import.meta.env, context, name)
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function getChannels(context: RequestContext): string[] {
  const channels = getConfiguredChannels(context)
  if (!channels.length) {
    throw new Error('Missing required env: CHANNEL')
  }
  return channels
}

function normalizeOptionalUrlAttribute(value: string | undefined): string | undefined {
  return value ? normalizeUrlAttribute(value) : value
}

function applySiteBranding(channel: ChannelInfo, context: RequestContext): ChannelInfo {
  const siteName = getOptionalStringEnv(context, 'SITE_NAME')
  const siteLogo = getOptionalStringEnv(context, 'SITE_LOGO')
  const siteDescription = getOptionalStringEnv(context, 'SITE_DESCRIPTION')

  return {
    ...channel,
    title: siteName ?? channel.title,
    description: siteDescription ?? channel.description,
    avatar: siteLogo ?? channel.avatar,
    avatarNeedsProxy: siteLogo ? false : channel.avatarNeedsProxy,
  }
}

export function isRenderablePost(post: Post | null | undefined): post is Post {
  return Boolean(post?.id && post.type === 'text' && post.content)
}

export async function getChannelPost(context: RequestContext, id: string): Promise<Post | null> {
  const channels = getChannels(context)
  const cacheKey = JSON.stringify({ scope: 'post', channels, id })
  const cachedResult = cache.get(cacheKey)

  if (cachedResult && !isChannelInfo(cachedResult)) {
    return cloneCacheValue(cachedResult)
  }

  const loadedPost = await loadCachedValue<Post | null>(cacheKey, async () => {
    const isMultiChannel = channels.length > 1
    let targetChannel = channels[0]
    let targetId = id

    if (isMultiChannel && id.includes('-')) {
      const parts = id.split('-')
      const potentialChannel = parts[0]
      const hasPrefixedId = parts.length > 1 && Boolean(parts.slice(1).join('-'))

      if (hasPrefixedId && channels.includes(potentialChannel)) {
        targetChannel = potentialChannel
        targetId = parts.slice(1).join('-')
      }
    }

    const isPrimaryChannel = targetChannel === channels[0]
    const { $, channel, telegramHost, staticProxy, reactionsEnabled } = await loadChannelDocument(context, {
      channel: targetChannel,
      id: targetId,
    })
    const post = await extractPost($, null, {
      channel,
      telegramHost,
      staticProxy,
      reactionsEnabled,
      isMultiChannel,
      isPrimaryChannel,
      allChannels: channels,
    })

    return isRenderablePost(post) ? post : null
  })

  return loadedPost ? cloneCacheValue(loadedPost) : null
}

export async function getChannelSummary(context: RequestContext): Promise<ChannelInfo> {
  const cacheKey = JSON.stringify({ scope: 'channel-summary', channels: getChannels(context) })
  const cachedResult = cache.get(cacheKey)

  if (cachedResult && isChannelInfo(cachedResult)) {
    return cloneCacheValue(cachedResult)
  }

  const siteName = getOptionalStringEnv(context, 'SITE_NAME')
  const siteLogo = getOptionalStringEnv(context, 'SITE_LOGO')
  const siteDescription = getOptionalStringEnv(context, 'SITE_DESCRIPTION')

  if (siteName && siteLogo && siteDescription) {
    const brandedChannel: ChannelInfo = {
      posts: [],
      title: siteName,
      description: siteDescription,
      descriptionHTML: siteDescription,
      avatar: siteLogo,
      avatarNeedsProxy: false,
    }

    setCacheValue(cacheKey, brandedChannel)
    return cloneCacheValue(brandedChannel)
  }

  const channel = await loadCachedValue<ChannelInfo>(cacheKey, async () => {
    const [primaryChannel] = getChannels(context)
    const { $, telegramHost, staticProxy } = await loadChannelDocument(context, { channel: primaryChannel })
    rememberChannelTitle(context, primaryChannel, $('.tgme_channel_info_header_title').text())
    const channelInfo: ChannelInfo = {
      posts: [],
      title: $('.tgme_channel_info_header_title').text(),
      description: $('.tgme_channel_info_description').text(),
      descriptionHTML: (await modifyHTMLContent($, $('.tgme_channel_info_description'), { telegramHost, staticProxy })).html(),
      avatar: normalizeOptionalUrlAttribute($('.tgme_page_photo_image img').attr('src')),
      avatarNeedsProxy: true,
    }

    return applySiteBranding(channelInfo, context)
  })

  return cloneCacheValue(channel)
}

function getPostFilterConfig(context: RequestContext): PostFilterConfig {
  const filterImages = Boolean(getBooleanEnv(import.meta.env, context, 'FILTER_IMAGES'))
  const filterFiles = Boolean(getBooleanEnv(import.meta.env, context, 'FILTER_FILES'))
  const adKeywords = parseCsvList(getEnv(import.meta.env, context, 'AD_KEYWORDS'))

  return {
    filterImages,
    filterFiles,
    adRegex: adKeywords.length > 0 ? new RegExp(adKeywords.join('|'), 'i') : null,
  }
}

function filterPosts(posts: Post[], filterConfig: PostFilterConfig): Post[] {
  const { filterImages, filterFiles, adRegex } = filterConfig

  return posts
    .filter(isRenderablePost)
    .filter((post) => {
      if (filterImages && post.hasImage)
        return false
      if (filterFiles && post.hasFile)
        return false
      if (adRegex && adRegex.test(post.text || ''))
        return false
      return true
    })
}

function getPostChannelIndex(id: string, channels: string[]): number {
  const separatorIndex = id.indexOf('-')

  if (separatorIndex > 0) {
    const channel = id.slice(0, separatorIndex)
    const index = channels.indexOf(channel)
    if (index > 0) {
      return index
    }
  }

  return 0
}

function getPostRawId(id: string, channels: string[]): string {
  const channelIndex = getPostChannelIndex(id, channels)
  if (channelIndex === 0) {
    return id
  }

  return id.slice(channels[channelIndex].length + 1)
}

function compareRawIdsDesc(a: string, b: string): number {
  const aNum = Number(a)
  const bNum = Number(b)
  const areNumeric = Number.isFinite(aNum) && Number.isFinite(bNum)

  if (areNumeric && aNum !== bNum) {
    return bNum - aNum
  }

  return b.localeCompare(a)
}

function compareTimelineEntries(
  a: Pick<Post, 'id' | 'datetime'>,
  b: Pick<Post, 'id' | 'datetime'>,
  channels: string[],
): number {
  const timeDiff = new Date(b.datetime).getTime() - new Date(a.datetime).getTime()
  if (timeDiff !== 0) {
    return timeDiff
  }

  const channelDiff = getPostChannelIndex(a.id, channels) - getPostChannelIndex(b.id, channels)
  if (channelDiff !== 0) {
    return channelDiff
  }

  return compareRawIdsDesc(getPostRawId(a.id, channels), getPostRawId(b.id, channels))
}

function getDefaultTimelineSources(channels: string[], selectedChannel = ''): TimelineSourceCursor[] {
  return channels.map(channel => ({
    before: selectedChannel && channel !== selectedChannel ? '0' : '',
    offset: 0,
  }))
}

async function getTimelineSourcePage(
  context: RequestContext,
  channelName: string,
  channelIndex: number,
  source: TimelineSourceCursor,
  channels: string[],
  filterConfig: PostFilterConfig,
  primaryChannelInfo: Partial<ChannelInfo>,
): Promise<TimelineSourcePage> {
  if (source.before === '0') {
    return {
      posts: [],
      source,
      nextBefore: '0',
      exhausted: true,
    }
  }

  let currentBefore = source.before
  let offsetToSkip = source.offset

  while (true) {
    const { $, channel, telegramHost, staticProxy, reactionsEnabled } = await loadChannelDocument(context, {
      channel: channelName,
      before: currentBefore,
    })

    rememberChannelTitle(context, channelName, $('.tgme_channel_info_header_title').text())
    if (channelIndex === 0 && !primaryChannelInfo.title) {
      primaryChannelInfo.title = $('.tgme_channel_info_header_title').text()
      primaryChannelInfo.description = $('.tgme_channel_info_description').text()
      primaryChannelInfo.descriptionHTML = (await modifyHTMLContent($, $('.tgme_channel_info_description'), { telegramHost, staticProxy })).html()
      primaryChannelInfo.avatar = normalizeOptionalUrlAttribute($('.tgme_page_photo_image img').attr('src'))
    }

    const postNodes = $('.tgme_channel_history .tgme_widget_message_wrap').toArray()
    const extractedPosts = (await Promise.all(
      postNodes.map((item, index) => extractPost($, item, {
        channel,
        telegramHost,
        staticProxy,
        index,
        reactionsEnabled,
        isMultiChannel: channels.length > 1,
        isPrimaryChannel: channelIndex === 0,
        allChannels: channels,
      })),
    )).reverse()

    const visiblePosts = filterPosts(extractedPosts, filterConfig).sort((a, b) => compareTimelineEntries(a, b, channels))
    const nextBefore = getPostRawId(extractedPosts.filter(post => post.id).at(-1)?.id ?? '', channels) || '0'
    const newestId = getPostRawId(extractedPosts.find(post => post.id)?.id ?? '', channels)

    if (currentBefore && newestId && Number(newestId) >= Number(currentBefore)) {
      throw new Error('Telegram pagination did not advance')
    }

    if (offsetToSkip < visiblePosts.length) {
      // Pin the first batch so later arrivals cannot shift an offset-based cursor.
      return {
        posts: visiblePosts.slice(offsetToSkip),
        source: {
          before: currentBefore || String(Number(newestId) + 1),
          offset: offsetToSkip,
        },
        nextBefore,
        exhausted: nextBefore === '0',
      }
    }

    if (nextBefore === '0') {
      return {
        posts: [],
        source: {
          before: currentBefore,
          offset: offsetToSkip,
        },
        nextBefore: '0',
        exhausted: true,
      }
    }

    offsetToSkip -= visiblePosts.length
    currentBefore = nextBefore
  }
}

export async function getTimelinePage(context: RequestContext, cursor = ''): Promise<TimelinePage> {
  const channels = getChannels(context)
  const selectedChannel = getSelectedChannel(context)
  const cacheKey = JSON.stringify({ scope: 'timeline', channels, selectedChannel, cursor })
  const cachedResult = cache.get(cacheKey)

  if (cachedResult && isChannelInfo(cachedResult)) {
    return {
      channel: cloneCacheValue(cachedResult),
      pageSize: TIMELINE_PAGE_SIZE,
    }
  }

  const brandedChannel = await loadCachedValue<ChannelInfo>(cacheKey, async () => {
    const filterConfig = getPostFilterConfig(context)
    const payload: TimelineCursorPayload = cursor ? decodeTimelineCursor(cursor) : { v: 2 }
    if (cursor && (payload.channel ?? '') !== selectedChannel) {
      throw new InvalidTimelineCursorError('Timeline cursor belongs to a different channel selection')
    }
    if (cursor && (!payload.sources || payload.sources.length !== channels.length)) {
      throw new InvalidTimelineCursorError('Invalid timeline cursor sources state')
    }

    if (cursor && (!payload.history || payload.history.some(entry => entry.length !== channels.length))) {
      throw new InvalidTimelineCursorError('Invalid timeline cursor history state')
    }

    const initialSources = getDefaultTimelineSources(channels, selectedChannel)
    const sources = payload.sources ?? initialSources
    const history = payload.history ?? []
    if (selectedChannel && [sources, ...history].some(entry => entry.some((source, index) =>
      channels[index] !== selectedChannel && (source.before !== '0' || source.offset !== 0),
    ))) {
      throw new InvalidTimelineCursorError('Timeline cursor contains an unselected source')
    }
    // Exhausted sources are not fetched again, but the site's identity still comes from the primary channel.
    const primaryChannelInfo: Partial<ChannelInfo> = sources[0].before === '0'
      ? await getChannelSummary(context)
      : {}
    const states: TimelineMergeState[] = (await Promise.all(
      channels.map(async (channelName, channelIndex) => ({
        page: await getTimelineSourcePage(
          context,
          channelName,
          channelIndex,
          sources[channelIndex],
          channels,
          filterConfig,
          primaryChannelInfo,
        ),
        index: 0,
      })),
    ))
    const posts: Post[] = []

    async function advanceState(channelIndex: number): Promise<void> {
      const state = states[channelIndex]

      while (state.index >= state.page.posts.length && !state.page.exhausted) {
        state.page = await getTimelineSourcePage(
          context,
          channels[channelIndex],
          channelIndex,
          {
            before: state.page.nextBefore,
            offset: 0,
          },
          channels,
          filterConfig,
          primaryChannelInfo,
        )
        state.index = 0
      }
    }

    await Promise.all(states.map((_state, index) => advanceState(index)))

    while (posts.length < TIMELINE_PAGE_SIZE) {
      let nextChannelIndex = -1
      let nextPost: Post | undefined

      for (let index = 0; index < states.length; index += 1) {
        const candidate = states[index].page.posts[states[index].index]
        if (!candidate) {
          continue
        }

        if (!nextPost || compareTimelineEntries(candidate, nextPost, channels) < 0) {
          nextPost = candidate
          nextChannelIndex = index
        }
      }

      if (nextChannelIndex === -1 || !nextPost) {
        break
      }

      posts.push(nextPost)
      states[nextChannelIndex].index += 1
      await advanceState(nextChannelIndex)
    }

    const nextSources = states.map((state) => {
      const remainingVisible = state.page.posts.length - state.index

      if (remainingVisible > 0) {
        const lastConsumed = state.page.posts[state.index - 1]
        const before = lastConsumed && getPostRawId(lastConsumed.id, channels)
        // ID boundaries survive deleted/filtered earlier messages. Retain offsets for non-monotonic source timestamps.
        if (before && state.page.posts.slice(state.index).every(post => compareRawIdsDesc(getPostRawId(post.id, channels), before) > 0)) {
          return { before, offset: 0 }
        }
        return {
          before: state.page.source.before,
          offset: state.page.source.offset + state.index,
        }
      }

      if (state.page.exhausted) {
        return {
          before: '0',
          offset: 0,
        }
      }

      return {
        before: state.page.nextBefore,
        offset: 0,
      }
    })

    const hasMoreBefore = states.some((state) => {
      const remainingVisible = state.page.posts.length - state.index
      return remainingVisible > 0 || !state.page.exhausted
    })
    const beforeCursor = hasMoreBefore
      ? encodeTimelineCursor({
          v: 2,
          channel: selectedChannel || undefined,
          sources: nextSources,
          history: history.concat([sources]),
        })
      : undefined
    // Keep recent back navigation bounded; the end of the retained window returns home.
    const previousSources = history.at(-1)
      ?? (sources.some((source, index) => source.before !== initialSources[index].before || source.offset !== 0) ? initialSources : undefined)
    const afterCursor = previousSources
      ? encodeTimelineCursor({
          v: 2,
          channel: selectedChannel || undefined,
          sources: previousSources,
          history: history.slice(0, -1),
        })
      : undefined
    const channel: ChannelInfo = {
      posts,
      title: primaryChannelInfo.title || '',
      description: primaryChannelInfo.description || '',
      descriptionHTML: primaryChannelInfo.descriptionHTML || null,
      avatar: primaryChannelInfo.avatar,
      avatarNeedsProxy: true,
      timeline: { beforeCursor, afterCursor },
    }

    return applySiteBranding(channel, context)
  })

  return {
    channel: cloneCacheValue(brandedChannel),
    pageSize: TIMELINE_PAGE_SIZE,
  }
}

export async function getChannelInfo(context: RequestContext, params: GetChannelInfoParams = {}): Promise<ChannelInfo> {
  const { before = '', after = '', q = '' } = params
  const channels = getChannels(context)
  const selectedChannel = resolveSelectedChannel(channels, params.channel)
  const cacheKey = JSON.stringify({ scope: 'channel', channels, selectedChannel, before, after, q })
  const cachedResult = cache.get(cacheKey)

  if (cachedResult && isChannelInfo(cachedResult)) {
    return cloneCacheValue(cachedResult)
  }

  const brandedChannelInfo = await loadCachedValue<ChannelInfo>(cacheKey, async () => {
    const isMultiChannel = channels.length > 1
    const beforeCursors = before ? before.split('-') : []
    const afterCursors = after ? after.split('-') : []
    const filterConfig = getPostFilterConfig(context)
    let allPosts: Post[] = []
    let primaryChannelInfo: Partial<ChannelInfo> = selectedChannel && selectedChannel !== channels[0]
      ? await getChannelSummary(context)
      : {}
    const nextAfterCursors: string[] = Array.from({ length: channels.length }).fill('0') as string[]

    const fetchPromises = channels.map(async (targetChannel, index) => {
      if (selectedChannel && targetChannel !== selectedChannel)
        return []
      const channelBefore = beforeCursors[index] || ''
      const channelAfter = afterCursors[index] || ''

      if ((before && channelBefore === '0') || (after && channelAfter === '0')) {
        if (index === 0) {
          primaryChannelInfo = {
            title: targetChannel,
            description: '',
            descriptionHTML: null,
            avatar: undefined,
          }
        }
        return []
      }

      const { $, channel, telegramHost, staticProxy, reactionsEnabled } = await loadChannelDocument(context, {
        channel: targetChannel,
        before: channelBefore,
        after: channelAfter,
        q,
      })

      rememberChannelTitle(context, targetChannel, $('.tgme_channel_info_header_title').text())
      if (index === 0) {
        primaryChannelInfo = {
          title: $('.tgme_channel_info_header_title').text(),
          description: $('.tgme_channel_info_description').text(),
          descriptionHTML: (await modifyHTMLContent($, $('.tgme_channel_info_description'), { telegramHost, staticProxy })).html(),
          avatar: normalizeOptionalUrlAttribute($('.tgme_page_photo_image img').attr('src')),
        }
      }

      const postNodes = $('.tgme_channel_history .tgme_widget_message_wrap').toArray()
      const extractedPosts = (await Promise.all(
        postNodes.map((item, postIndex) => extractPost($, item, {
          channel,
          telegramHost,
          staticProxy,
          index: postIndex,
          reactionsEnabled,
          isMultiChannel,
          isPrimaryChannel: index === 0,
          allChannels: channels,
        })),
      )).reverse()

      const rawAfterCursor = getPostRawId(extractedPosts.find(post => post.id)?.id ?? '', channels)

      nextAfterCursors[index] = rawAfterCursor

      return filterPosts(extractedPosts, filterConfig)
    })

    const results = await Promise.all(fetchPromises)
    for (const validPosts of results) {
      allPosts = allPosts.concat(validPosts)
    }

    allPosts.sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime())

    const channelInfo: ChannelInfo = {
      posts: allPosts,
      title: primaryChannelInfo.title || '',
      description: primaryChannelInfo.description || '',
      descriptionHTML: primaryChannelInfo.descriptionHTML || null,
      avatar: primaryChannelInfo.avatar,
      avatarNeedsProxy: true,
      sitemapAfterCursor: nextAfterCursors.join('-'),
    }

    return applySiteBranding(channelInfo, context)
  })

  return cloneCacheValue(brandedChannelInfo)
}

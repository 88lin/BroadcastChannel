import type { ChannelInfo, GetChannelInfoParams, Post, TimelinePage } from '../../types'
import type { RequestContext } from './types'
import { LRUCache } from 'lru-cache'
import { getBooleanEnv, getEnv, parseCsvList } from '../env'
import { modifyHTMLContent } from './content'
import { extractPost } from './parse'
import { loadChannelDocument } from './request'
import { normalizeUrlAttribute } from './url'

type CacheValue = ChannelInfo | Post

interface PostFilterConfig {
  filterImages: boolean
  filterFiles: boolean
  adRegex: RegExp | null
}

interface TimelineCursorPayload {
  v: 2
  sources?: TimelineSourceCursor[]
  history?: TimelineSourceCursor[][]
}

type CompactTimelineSourceCursor = [string, number]

interface CompactTimelineCursorPayload {
  v: 2
  s?: CompactTimelineSourceCursor[]
  h?: CompactTimelineSourceCursor[][]
}

interface TimelineSourceCursor {
  before: string
  offset: number
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
const PERCENT_ESCAPE_REGEX = /%([0-9A-F]{2})/g
const BASE64_PLUS_REGEX = /\+/g
const BASE64_SLASH_REGEX = /\//g
const BASE64_PADDING_REGEX = /=+$/g
const BASE64URL_DASH_REGEX = /-/g
const BASE64URL_UNDERSCORE_REGEX = /_/g

const cache = new LRUCache<string, CacheValue>({
  ttl: FRESH_CACHE_TTL,
  maxSize: 50 * 1024 * 1024,
  sizeCalculation: item => JSON.stringify(item).length,
})

const staleCache = new LRUCache<string, CacheValue>({
  ttl: STALE_CACHE_TTL,
  maxSize: 50 * 1024 * 1024,
  sizeCalculation: item => JSON.stringify(item).length,
})

const inFlightRequests = new Map<string, Promise<CacheValue | null>>()

function cloneCacheValue<T extends CacheValue>(value: T): T {
  return structuredClone(value)
}

function isChannelInfo(value: CacheValue): value is ChannelInfo {
  return 'posts' in value
}

function setCacheValue(key: string, value: CacheValue): void {
  cache.set(key, value)
  staleCache.set(key, value)
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

function getRequiredStringEnv(context: RequestContext, name: string): string {
  const value = getEnv(import.meta.env, context, name)
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing required env: ${name}`)
  }
  return value
}

function getOptionalStringEnv(context: RequestContext, name: string): string | undefined {
  const value = getEnv(import.meta.env, context, name)
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function getChannels(context: RequestContext): string[] {
  const channels = parseCsvList(getRequiredStringEnv(context, 'CHANNEL'))
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
  const cacheKey = JSON.stringify({ scope: 'post', id })
  const cachedResult = cache.get(cacheKey)

  if (cachedResult && !isChannelInfo(cachedResult)) {
    return cloneCacheValue(cachedResult)
  }

  const loadedPost = await loadCachedValue<Post | null>(cacheKey, async () => {
    const channels = getChannels(context)
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
  const cacheKey = JSON.stringify({ scope: 'channel-summary' })
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

function getDefaultTimelineSources(channels: string[]): TimelineSourceCursor[] {
  return channels.map(() => ({
    before: '',
    offset: 0,
  }))
}

function toCompactTimelineSourceCursor(source: TimelineSourceCursor): CompactTimelineSourceCursor {
  return [source.before, source.offset]
}

function fromCompactTimelineSourceCursor(source: CompactTimelineSourceCursor): TimelineSourceCursor {
  return {
    before: source[0],
    offset: source[1],
  }
}

function toBase64Url(value: string): string {
  const encoded = encodeURIComponent(value).replace(PERCENT_ESCAPE_REGEX, (_match, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
  return btoa(encoded)
    .replace(BASE64_PLUS_REGEX, '-')
    .replace(BASE64_SLASH_REGEX, '_')
    .replace(BASE64_PADDING_REGEX, '')
}

function fromBase64Url(value: string): string {
  const normalized = value
    .replace(BASE64URL_DASH_REGEX, '+')
    .replace(BASE64URL_UNDERSCORE_REGEX, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')

  const decoded = atob(normalized)
  const bytes = decoded.split('').map(char => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')
  return decodeURIComponent(bytes)
}

function encodeTimelineCursor(payload: TimelineCursorPayload): string {
  const compactPayload: CompactTimelineCursorPayload = {
    v: 2,
    s: payload.sources?.map(toCompactTimelineSourceCursor),
    h: payload.history?.map(entry => entry.map(toCompactTimelineSourceCursor)),
  }

  return toBase64Url(JSON.stringify(compactPayload))
}

function decodeTimelineCursor(cursor: string): TimelineCursorPayload {
  try {
    const payload = JSON.parse(fromBase64Url(cursor)) as CompactTimelineCursorPayload
    if (payload?.v !== 2) {
      throw new Error('Unsupported timeline cursor version')
    }

    if (!Array.isArray(payload.s)) {
      throw new TypeError('Invalid timeline sources payload')
    }

    if (!Array.isArray(payload.h)) {
      throw new TypeError('Invalid timeline history payload')
    }

    const isValidSourceCursor = (source: CompactTimelineSourceCursor | undefined): source is CompactTimelineSourceCursor => {
      return Array.isArray(source)
        && source.length === 2
        && typeof source[0] === 'string'
        && Number.isInteger(source[1])
        && source[1] >= 0
    }

    if (payload.s.some(source => !isValidSourceCursor(source))) {
      throw new Error('Invalid timeline source shape')
    }

    if (payload.h.some(entry => !Array.isArray(entry) || entry.some(source => !isValidSourceCursor(source)))) {
      throw new Error('Invalid timeline history entry')
    }

    return {
      v: 2,
      sources: payload.s.map(fromCompactTimelineSourceCursor),
      history: payload.h.map(entry => entry.map(fromCompactTimelineSourceCursor)),
    }
  }
  catch (error) {
    throw new Error(`Invalid timeline cursor: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

export function isRootTimelineCursor(cursor: string): boolean {
  const payload = decodeTimelineCursor(cursor)
  return (payload.history ?? []).length === 0
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

    const visiblePosts = filterPosts(extractedPosts, filterConfig)
    const nextBefore = extractedPosts.at(-1)?.id?.replace(`${channel}-`, '') || '0'

    if (offsetToSkip < visiblePosts.length) {
      return {
        posts: visiblePosts.slice(offsetToSkip),
        source: {
          before: currentBefore,
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
  const cacheKey = JSON.stringify({ scope: 'timeline', cursor })
  const cachedResult = cache.get(cacheKey)

  if (cachedResult && isChannelInfo(cachedResult)) {
    return {
      channel: cloneCacheValue(cachedResult),
      pageSize: TIMELINE_PAGE_SIZE,
    }
  }

  const brandedChannel = await loadCachedValue<ChannelInfo>(cacheKey, async () => {
    const channels = getChannels(context)
    const filterConfig = getPostFilterConfig(context)
    const payload: TimelineCursorPayload = cursor ? decodeTimelineCursor(cursor) : { v: 2 }
    if (cursor && (!payload.sources || payload.sources.length !== channels.length)) {
      throw new Error('Invalid timeline cursor sources state')
    }

    if (cursor && (!payload.history || payload.history.some(entry => entry.length !== channels.length))) {
      throw new Error('Invalid timeline cursor history state')
    }

    const sources = payload.sources ?? getDefaultTimelineSources(channels)
    const history = payload.history ?? []
    const primaryChannelInfo: Partial<ChannelInfo> = {
      title: '',
      description: '',
      descriptionHTML: null,
      avatar: undefined,
    }
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
          sources: nextSources,
          history: history.concat([sources]),
        })
      : undefined
    const previousSources = history.at(-1)
    const afterCursor = previousSources
      ? encodeTimelineCursor({
          v: 2,
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
      beforeCursor,
      afterCursor,
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
  const cacheKey = JSON.stringify({ scope: 'channel', before, after, q })
  const cachedResult = cache.get(cacheKey)

  if (cachedResult && isChannelInfo(cachedResult)) {
    return cloneCacheValue(cachedResult)
  }

  const brandedChannelInfo = await loadCachedValue<ChannelInfo>(cacheKey, async () => {
    const channels = getChannels(context)
    const isMultiChannel = channels.length > 1
    const beforeCursors = before ? before.split('-') : []
    const afterCursors = after ? after.split('-') : []
    const filterConfig = getPostFilterConfig(context)
    let allPosts: Post[] = []
    let primaryChannelInfo: Partial<ChannelInfo> = {}
    const nextBeforeCursors: string[] = Array.from({ length: channels.length }).fill('0') as string[]
    const nextAfterCursors: string[] = Array.from({ length: channels.length }).fill('0') as string[]

    const fetchPromises = channels.map(async (targetChannel, index) => {
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

      const rawBeforeCursor = extractedPosts.at(-1)?.id?.replace(`${channel}-`, '') ?? ''
      const rawAfterCursor = extractedPosts[0]?.id?.replace(`${channel}-`, '') ?? ''

      nextBeforeCursors[index] = rawBeforeCursor
      nextAfterCursors[index] = rawAfterCursor

      return filterPosts(extractedPosts, filterConfig)
    })

    const results = await Promise.all(fetchPromises)
    for (const validPosts of results) {
      allPosts = allPosts.concat(validPosts)
    }

    allPosts.sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime())

    const finalBeforeCursor = nextBeforeCursors.some(Boolean) ? nextBeforeCursors.map(cursor => cursor || '0').join('-') : undefined
    const finalAfterCursor = nextAfterCursors.some(Boolean) ? nextAfterCursors.map(cursor => cursor || '0').join('-') : undefined
    const channelInfo: ChannelInfo = {
      posts: allPosts,
      title: primaryChannelInfo.title || '',
      description: primaryChannelInfo.description || '',
      descriptionHTML: primaryChannelInfo.descriptionHTML || null,
      avatar: primaryChannelInfo.avatar,
      avatarNeedsProxy: true,
      beforeCursor: finalBeforeCursor,
      afterCursor: finalAfterCursor,
      sitemapAfterCursor: nextAfterCursors.join('-'),
    }

    return applySiteBranding(channelInfo, context)
  })

  return cloneCacheValue(brandedChannelInfo)
}

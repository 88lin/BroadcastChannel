import type { AnyNode, Cheerio, CheerioAPI } from 'cheerio'
import type { AstroEnvContext } from '../../types'

export type MessageSelection = Cheerio<AnyNode>
export type RequestContext = AstroEnvContext & { request: Request }

export interface StaticProxyOptions {
  staticProxy?: string
}

export interface IndexedStaticProxyOptions extends StaticProxyOptions {
  index?: number
}

export interface ReplyOptions {
  channel: string
  isMultiChannel?: boolean
  channels?: string[]
}

export interface MessageAssetOptions extends IndexedStaticProxyOptions {
  id?: string
  title?: string
}

export interface ExtractPostOptions {
  channel: string
  telegramHost: string
  staticProxy: string
  index?: number
  reactionsEnabled?: boolean
  isMultiChannel?: boolean
  isPrimaryChannel?: boolean
  allChannels?: string[]
}

export interface LoadedChannelDocument {
  $: CheerioAPI
  channel: string
  telegramHost: string
  staticProxy: string
  reactionsEnabled?: boolean
}

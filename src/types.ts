export interface Reaction {
  emoji: string
  emojiId?: string
  emojiImage?: string
  count: string
  isPaid: boolean
}

export interface Post {
  id: string
  title: string
  type: 'text' | 'service'
  datetime: string
  tags: string[]
  text: string
  description?: string
  content: string
  hasImage?: boolean
  hasFile?: boolean
  reactions: Reaction[]
}

export interface ChannelInfo {
  posts: Post[]
  title: string
  description: string
  descriptionHTML: string | null
  avatar: string | undefined
  avatarNeedsProxy?: boolean
  /** Optional SEO override injected by page routes */
  seo?: SeoMeta
  beforeCursor?: string
  afterCursor?: string
  sitemapAfterCursor?: string
}

export interface SeoMeta {
  title?: string
  text?: string
  noindex?: string | boolean
  nofollow?: string | boolean
}

/** Parameters accepted by getChannelInfo */
export interface GetChannelInfoParams {
  before?: string
  after?: string
  q?: string
}

export interface TimelinePage {
  channel: ChannelInfo
  pageSize: number
}

export interface AstroEnvContext {
  locals?: App.Locals & {
    /** Legacy Astro runtime env shape; Astro v6 Cloudflare exposes env elsewhere. */
    runtime?: {
      env?: Record<string, string | undefined>
    }
  }
  request?: Request
  url?: URL
}

export type EnvCapableAstro = AstroEnvContext

export interface NavItem {
  title: string
  href: string
}

export interface TagCloudItem {
  href: string
  label: string
  title?: string
  external?: boolean
}

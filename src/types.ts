export interface Reaction {
  readonly emoji: string
  readonly emojiId?: string
  readonly emojiImage?: string
  readonly count: string
  readonly isPaid: boolean
}

export interface Post {
  readonly id: string
  readonly title: string
  readonly type: 'text' | 'service'
  readonly datetime: string
  readonly tags: readonly string[]
  readonly text: string
  readonly description?: string
  readonly content: string
  readonly hasImage?: boolean
  readonly hasFile?: boolean
  readonly reactions: readonly Reaction[]
}

export interface ChannelInfo {
  readonly posts: readonly Post[]
  readonly title: string
  readonly description: string
  readonly descriptionHTML: string | null
  readonly avatar: string | undefined
  readonly avatarNeedsProxy?: boolean
  /** Optional SEO override injected by page routes */
  readonly seo?: SeoMeta
  /** Timeline navigation only; sitemap cursors use a separate format. */
  readonly timeline?: {
    readonly beforeCursor?: string
    readonly afterCursor?: string
  }
  readonly sitemapAfterCursor?: string
}

export interface SeoMeta {
  readonly title?: string
  readonly text?: string
  readonly noindex?: string | boolean
  readonly nofollow?: string | boolean
}

/** Parameters accepted by getChannelInfo */
export interface GetChannelInfoParams {
  before?: string
  after?: string
  q?: string
  /** Explicit selection for feeds/search; sitemap callers retain all sources. */
  channel?: string
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

import type { APIRoute } from 'astro'
import { getEnv, parseCsvList } from '../lib/env'
import { getSitemapUrl, resolveSiteUrl } from '../lib/seo'
import { getChannelInfo } from '../lib/telegram'

export const GET: APIRoute = async (Astro) => {
  const siteUrl = resolveSiteUrl(Astro.locals.SITE_URL, Astro.url.origin)
  const channel = await getChannelInfo(Astro)
  const posts = channel.posts || []
  const channels = parseCsvList(getEnv(import.meta.env, Astro, 'CHANNEL'))
  const isMultiChannel = channels.length > 1
  const pageSize = 20
  const pages: string[] = []

  if (isMultiChannel) {
    const maxIds: number[] = Array.from({ length: channels.length }).fill(0) as number[]
    if (channel.sitemapAfterCursor) {
      const topCursors = channel.sitemapAfterCursor.split('-')
      topCursors.forEach((cursor, index) => {
        maxIds[index] = Number(cursor)
      })
    }
    else {
      for (const post of posts) {
        if (post.id.includes('-')) {
          const parts = post.id.split('-')
          const channelIndex = channels.indexOf(parts[0])
          if (channelIndex > 0) {
            maxIds[channelIndex] = Math.max(maxIds[channelIndex], Number(parts[1]))
          }
        }
        else {
          maxIds[0] = Math.max(maxIds[0], Number(post.id))
        }
      }
    }

    for (let index = 0; index < channels.length; index += 1) {
      let count = maxIds[index]
      if (!Number.isFinite(count) || count <= 0)
        continue

      const channelName = channels[index]
      pages.push(`${channelName}-${count}`)

      while (count > pageSize) {
        count -= pageSize
        pages.push(`${channelName}-${count}`)
      }
    }
  }
  else {
    let count = Number(posts[0]?.id ?? 0)
    if (Number.isFinite(count) && count > 0) {
      pages.push(String(count))
      while (count > pageSize) {
        count -= pageSize
        pages.push(String(count))
      }
    }
  }

  const sitemaps = pages.map((page) => {
    return `
<sitemap>
  <loc>${getSitemapUrl(siteUrl, `sitemap/${page}.xml`)}</loc>
</sitemap>`
  })

  return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${sitemaps.join('')}
</sitemapindex>`, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'Content-Type': 'application/xml',
    },
  })
}

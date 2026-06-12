import type { APIRoute } from 'astro'
import { getEnv, parseCsvList } from '../../lib/env'
import { getSitemapUrl, resolveSiteUrl } from '../../lib/seo'
import { getChannelInfo } from '../../lib/telegram'

export const GET: APIRoute = async (Astro) => {
  const siteUrl = resolveSiteUrl(Astro.locals.SITE_URL, Astro.url.origin)
  const cursorParam = Astro.params.cursor || ''
  const channels = parseCsvList(getEnv(import.meta.env, Astro, 'CHANNEL'))
  const isMultiChannel = channels.length > 1
  let fetchBefore = cursorParam
  let sitemapChannel = ''

  if (isMultiChannel && cursorParam.includes('-')) {
    const lastDashIndex = cursorParam.lastIndexOf('-')
    if (lastDashIndex !== -1) {
      sitemapChannel = cursorParam.substring(0, lastDashIndex)
      const countValue = cursorParam.substring(lastDashIndex + 1)
      const channelIndex = channels.indexOf(sitemapChannel)

      if (channelIndex !== -1) {
        const cursors = Array.from({ length: channels.length }).fill('0') as string[]
        cursors[channelIndex] = countValue
        fetchBefore = cursors.join('-')
      }
    }
  }

  const channel = await getChannelInfo(Astro, {
    before: fetchBefore,
  })

  let posts = channel.posts || []
  if (isMultiChannel && sitemapChannel) {
    const isPrimaryChannel = channels.indexOf(sitemapChannel) === 0
    posts = posts.filter((post) => {
      if (isPrimaryChannel) {
        return !post.id.includes('-')
      }

      return post.id.startsWith(`${sitemapChannel}-`)
    })
  }

  const xmlUrls = posts.map(post => `
    <url>
      <loc>${getSitemapUrl(siteUrl, `posts/${post.id}`)}</loc>
      <lastmod>${new Date(post.datetime).toISOString()}</lastmod>
    </url>
  `).join('')

  return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${xmlUrls}
</urlset>`, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'Content-Type': 'application/xml',
    },
  })
}

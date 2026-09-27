import type { APIRoute } from 'astro'
import { getEnv, parseCsvList } from '../../lib/env'
import { getSitemapUrl, resolveSiteUrl } from '../../lib/seo'
import { getChannelInfo } from '../../lib/telegram'

export const GET: APIRoute = async (Astro) => {
  const siteUrl = resolveSiteUrl(Astro.locals.SITE_URL, Astro.url.origin)
  const cursorParam = Astro.params.cursor || ''
  const channels = parseCsvList(getEnv(import.meta.env, Astro, 'CHANNEL'))
  const isMultiChannel = channels.length > 1
  const separator = isMultiChannel ? cursorParam.lastIndexOf('-') : -1
  const sitemapChannel = isMultiChannel ? cursorParam.slice(0, separator) : channels[0]
  const countValue = cursorParam.slice(separator + 1)
  const count = Number(countValue)
  const channelIndex = channels.indexOf(sitemapChannel)
  if (channelIndex === -1 || !/^\d+$/.test(countValue) || count <= 0 || !Number.isSafeInteger(count + 1)) {
    return new Response('Invalid sitemap cursor', { status: 404 })
  }

  // Sitemap URLs name the inclusive upper ID; Telegram's before boundary is exclusive.
  const cursors = Array.from({ length: channels.length }).fill('0')
  cursors[channelIndex] = String(count + 1)
  const fetchBefore = cursors.join('-')

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

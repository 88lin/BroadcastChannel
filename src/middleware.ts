import { defineMiddleware } from 'astro:middleware'
import { getSelectedChannel, InvalidChannelError, withChannel } from './lib/channels'

function getEncodedTagSearchQuery(pathname: string): string {
  if (!pathname.startsWith('/search/%23')) {
    return ''
  }

  try {
    return decodeURIComponent(pathname.slice('/search/'.length))
  }
  catch {
    return ''
  }
}

export function isHtmlResponse(response: Response): boolean {
  return response.headers.get('content-type')?.includes('text/html') ?? false
}

export function shouldApplyDefaultCache(response: Response): boolean {
  return response.status >= 200 && response.status < 400 && !response.headers.has('Cache-Control')
}

export const onRequest = defineMiddleware(async (context, next) => {
  let selectedChannel = ''
  try {
    selectedChannel = getSelectedChannel(context)
  }
  catch (error) {
    if (!(error instanceof InvalidChannelError))
      throw error
    return new Response('未找到该频道，请返回首页选择已配置的频道。', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    })
  }
  context.locals.SITE_URL = `${import.meta.env.SITE ?? ''}${import.meta.env.BASE_URL}`
  context.locals.RSS_URL = withChannel(`${context.locals.SITE_URL}rss.xml`, selectedChannel)
  context.locals.RSS_PREFIX = selectedChannel ? `@${selectedChannel} | ` : ''

  const querySearch = context.url.searchParams.get('q') || ''
  const legacyTagSearch = getEncodedTagSearchQuery(context.url.pathname)
  const pathSearch = context.params.q || ''
  const searchQuery = querySearch || legacyTagSearch || pathSearch

  if (context.url.pathname.startsWith('/search') && searchQuery.startsWith('#')) {
    const tag = searchQuery.replace('#', '')
    context.locals.RSS_URL = withChannel(`${context.locals.SITE_URL}rss.xml?tag=${encodeURIComponent(tag)}`, selectedChannel)
    context.locals.RSS_PREFIX = `${tag} | ${context.locals.RSS_PREFIX}`
  }

  const response = legacyTagSearch
    ? await context.rewrite(withChannel(`/search/result?q=${encodeURIComponent(legacyTagSearch)}`, selectedChannel))
    : await next()

  if (!response.bodyUsed) {
    response.headers.set('X-Content-Type-Options', 'nosniff')
    if (isHtmlResponse(response)) {
      response.headers.set('Speculation-Rules', '"/rules/prefetch.json"')
    }

    if (shouldApplyDefaultCache(response)) {
      response.headers.set('Cache-Control', 'public, max-age=60, s-maxage=1800, stale-while-revalidate=86400')
    }
  }
  return response
})

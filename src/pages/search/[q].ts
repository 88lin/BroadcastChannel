import type { APIRoute } from 'astro'
import { getSelectedChannel } from '../../lib/channels'

export const GET: APIRoute = (context) => {
  const { params, url } = context
  if (!params.q) {
    return Response.redirect(new URL('/', url), 308)
  }

  const searchUrl = new URL('/search/result', url)
  searchUrl.searchParams.set('q', params.q)
  const selectedChannel = getSelectedChannel(context)
  if (selectedChannel)
    searchUrl.searchParams.set('channel', selectedChannel)

  return Response.redirect(searchUrl, 308)
}

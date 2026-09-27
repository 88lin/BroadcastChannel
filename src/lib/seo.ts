export function getAbsoluteSiteUrl(siteUrl: string, origin: string): string {
  return siteUrl.startsWith('http') ? siteUrl : new URL(siteUrl, origin).toString()
}

export function resolveSiteUrl(siteUrl: string, origin: string): URL {
  const resolvedSiteUrl = new URL(getAbsoluteSiteUrl(siteUrl, origin))
  resolvedSiteUrl.search = ''
  return resolvedSiteUrl
}

export function getSitemapUrl(baseUrl: URL, path: string): string {
  return new URL(path, baseUrl).toString()
}

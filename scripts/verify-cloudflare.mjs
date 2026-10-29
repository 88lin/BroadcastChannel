import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { extname, resolve, sep } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

// Use the exact Miniflare/workerd version shipped with the Cloudflare adapter.
const adapterRequire = createRequire(import.meta.resolve('@astrojs/cloudflare'))
const wranglerRequire = createRequire(adapterRequire.resolve('wrangler'))
const { Miniflare } = await import(pathToFileURL(wranglerRequire.resolve('miniflare')).href)
const dist = resolve('dist')
const workerRoot = resolve(dist, '_worker.js')
const workerFiles = (await readdir(workerRoot, { recursive: true })).filter(path => /\.(?:mjs|js)$/.test(path) && path !== 'index.js')
let upstreamRequests = 0
const code = 'proxies:<br>  - name: example<br>    server: example.com<br>    port: 443'
const snippets = [
  `<pre>${code}</pre>`,
  `<pre><code class="language-yaml">${code}</code></pre>`,
  '<pre data-language="json">{"enabled": true, "port": 443}</pre>',
  '<pre><code class="language-python">def hello():<br>    print("&lt;hello&gt;")</code></pre>',
]

function telegramHtml(url) {
  const parts = url.pathname.split('/').filter(Boolean)
  const channel = parts[0] === 's' ? parts[1] : parts[0]
  let ids = Array.from({ length: 50 }, (_, i) => i + 1)
  if (parts[0] !== 's')
    ids = ids.filter(id => String(id) === parts[1])
  if (url.searchParams.has('before'))
    ids = ids.filter(id => id < Number(url.searchParams.get('before')))
  if (url.searchParams.has('after'))
    ids = ids.filter(id => id > Number(url.searchParams.get('after')))
  return `<div class="tgme_channel_info_header_title">${channel} fixture</div>
    <div class="tgme_channel_info_description">Fixture description</div>
    <div class="tgme_channel_history">${ids.slice(-20).map(id => `<div class="tgme_widget_message_wrap">
      <div class="tgme_widget_message" data-post="${channel}/${id}">
        <div class="tgme_widget_message_text">${channel} post ${id}<a href="?q=%23fixture">#fixture</a>${snippets[id % snippets.length]}</div>
        <a class="tgme_widget_message_date"><time datetime="2026-01-01T00:${String(id).padStart(2, '0')}:00Z"></time></a>
      </div></div>`).join('')}</div>`
}

const mf = new Miniflare({
  modules: ['index.js', ...workerFiles].map(path => ({ type: 'ESModule', path: resolve(workerRoot, path) })),
  modulesRoot: workerRoot,
  compatibilityDate: process.env.CF_TEST_COMPATIBILITY_DATE || '2026-01-14',
  compatibilityFlags: ['nodejs_compat'],
  bindings: {
    CHANNEL: 'alpha,beta',
    TELEGRAM_HOST: 'telegram.me',
    STATIC_PROXY: '/static/',
    SITE_NAME: 'CPU fixture',
    SITE_LOGO: '/favicon.svg',
    SITE_DESCRIPTION: 'CPU fixture description',
    LOCALE: 'zh-CN',
    TIMEZONE: 'Asia/Shanghai',
    FILTER_IMAGES: '',
    FILTER_FILES: '',
    AD_KEYWORDS: '',
    HEADER_INJECT: '',
    FOOTER_INJECT: '',
    COMMENTS: '',
    REACTIONS: '',
    TAGS: 'fixture,config',
    LINKS: 'Example,https://example.com',
  },
  serviceBindings: {
    ASSETS: async (request) => {
      const path = resolve(dist, `.${new URL(request.url).pathname}`)
      if (!path.startsWith(`${dist}${sep}`))
        return new Response(null, { status: 404 })
      try {
        const contentType = { '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.xsl': 'text/xsl' }[extname(path)] ?? 'application/octet-stream'
        return new Response(await readFile(path), { headers: { 'Content-Type': contentType } })
      }
      catch { return new Response(null, { status: 404 }) }
    },
  },
  outboundService: async (request) => {
    upstreamRequests++
    const url = new URL(request.url)
    assert.equal(url.hostname, 'telegram.me', `Unexpected outbound request: ${url}`)
    if (url.pathname === '/fixture.png')
      return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } })
    return new Response(telegramHtml(url), { headers: { 'Content-Type': 'text/html' } })
  },
})

try {
  const origin = process.env.CF_TEST_SITE || 'https://clash.88lin.eu.org'
  const fetchPage = path => mf.dispatchFetch(new URL(path, origin).href, { redirect: 'manual' })
  const paths = ['/', '/?channel=beta', '/posts/12', '/posts/beta-12?channel=beta', '/tags?channel=beta', '/links?channel=beta', '/rss.xml', '/rss.json', '/sitemap.xml', '/search/result?q=%23fixture&channel=beta']
  const paginationPaths = []
  for (const path of paths) {
    const first = await fetchPage(path)
    assert.equal(first.status, 200, `${path}: ${await first.clone().text()}`)
    assert.equal(first.headers.get('X-Response-Cache'), 'MISS', path)
    const text = await first.text()
    if (path === '/') {
      assert.match(text, /language-auto/)
      assert.match(text, /language-yaml/)
      assert.match(text, /language-json/)
      assert.match(text, /language-python/)
      assert.match(text, /proxies:\n {2}- name: example/)
      assert.ok(text.includes(`rel="canonical" href="${origin}/"`), 'Unexpected canonical URL')
      assert.doesNotMatch(text, /class="token /, 'SSR sends escaped code; the browser worker adds tokens')
    }
    if (path === '/?channel=beta') {
      assert.match(text, /channel=beta/)
    }
    if (path === '/?channel=beta' || (paginationPaths.includes(path) && paginationPaths.length < 3)) {
      const direction = paginationPaths.length < 2 ? 'before' : 'after'
      const title = direction === 'before' ? 'Before' : 'After'
      const href = text.match(new RegExp(`<a[^>]+href="([^"]+)"[^>]+title="${title}"`))?.[1]
      assert.ok(href, `Missing ${direction} pagination link`)
      const target = new URL(href.replaceAll('&amp;', '&'), origin)
      const next = `${target.pathname}${target.search}`
      paginationPaths.push(next)
      paths.push(next)
    }
    if (path === '/rss.json')
      assert.equal(JSON.parse(text).items.length, 40)
    const calls = upstreamRequests
    let hit
    // waitUntil persists asynchronously; bounded polling waits for the cache fill.
    for (let attempt = 0; attempt < 20; attempt++) {
      hit = await fetchPage(path)
      if (hit.headers.get('X-Response-Cache') === 'HIT')
        break
      await hit.text()
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    assert.equal(hit.headers.get('X-Response-Cache'), 'HIT', path)
    assert.equal(await hit.text(), text)
    assert.equal(upstreamRequests, calls, `${path}: cache hit fetched Telegram`)
    // Undici otherwise adds Cache-Control: no-cache to conditional requests.
    const conditional = await mf.dispatchFetch(new URL(path, origin).href, { cache: 'force-cache', headers: { 'If-None-Match': hit.headers.get('etag') } })
    assert.equal(conditional.status, 304)
    assert.equal(await conditional.text(), '')
    console.info(`${path}: MISS -> HIT -> 304`)
  }
  const head = await mf.dispatchFetch(origin, { method: 'HEAD' })
  assert.equal(head.headers.get('X-Response-Cache'), 'HIT')
  assert.equal(await head.text(), '')
  for (const headers of [{ Cookie: 'session=private' }, { Authorization: 'Bearer private' }]) {
    const response = await mf.dispatchFetch(origin, { headers })
    assert.notEqual(response.headers.get('X-Response-Cache'), 'HIT')
    assert.match(response.headers.get('Cache-Control'), /private/)
    await response.text()
  }
  const invalid = await fetchPage('/?channel=unknown')
  assert.equal(invalid.status, 404)
  const invalidCursor = await fetchPage('/before/invalid?channel=beta')
  assert.equal(invalidCursor.status, 302)
  assert.equal(invalidCursor.headers.get('Location'), '/?channel=beta')
  const staticResponse = await fetchPage('/static/https://telegram.me/fixture.png')
  assert.equal(staticResponse.status, 200)
  assert.equal(staticResponse.headers.get('Content-Type'), 'image/png')
  assert.equal(staticResponse.headers.get('X-Content-Type-Options'), 'nosniff')
  assert.match(staticResponse.headers.get('Content-Security-Policy'), /sandbox/)
  console.info(`Cloudflare workerd verification passed; ${upstreamRequests} fixture upstream requests.`)
  if (process.argv.includes('--serve')) {
    console.info(`Fixture preview: ${await mf.ready}`)
    await new Promise(resolve => process.once('SIGINT', resolve))
  }
}
finally {
  await mf.dispose()
}

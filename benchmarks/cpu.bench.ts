import process from 'node:process'
import { load } from 'cheerio'
import { bench, describe } from 'vitest'
import { formatPostTime } from '../src/lib/post-ui'
import { createContentEtag, withResponseCache } from '../src/lib/response-cache'
import { sanitizeContentHtml } from '../src/lib/sanitize'
import { getCachedValue, setCacheValue } from '../src/lib/telegram/cache'
import { extractPost } from '../src/lib/telegram/parse'

// Deterministic code-heavy Telegram page: 24 posts, each with 80 three-line YAML entries.
// No network, Astro rendering, or Cloudflare CPU accounting is included.
const code = Array.from({ length: 80 }, (_, i) => `  - name: proxy-${i}\n    server: proxy-${i}.example.com\n    port: 443`).join('\n')
const html = `<div class="tgme_channel_history">${Array.from({ length: 24 }, (_, i) => `
  <div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="benchmark/${i + 1}">
    <div class="tgme_widget_message_text">Configuration ${i + 1}<pre>${code}</pre></div>
    <a class="tgme_widget_message_date"><time datetime="2026-01-01T00:00:00Z"></time></a>
  </div></div>`).join('')}</div>`

const htmlWithBreaks = html.replaceAll(code, code.replaceAll('\n', '<br>'))

async function parsePage(source = html) {
  const $ = load(source, { xml: { xmlMode: false } }, false)
  return Promise.all($('.tgme_widget_message_wrap').toArray().map((node, index) => extractPost($, node, {
    channel: 'benchmark',
    telegramHost: 'telegram.me',
    staticProxy: '',
    index,
  })))
}

const posts = await parsePage()
const encoder = new TextEncoder()
setCacheValue('benchmark-page', posts)
const request = new Request('https://benchmark.example/')
const cachedHtml = posts.map(post => post.content).join('')
const responseOptions = {
  cache: {
    match: async () => new Response(cachedHtml, { headers: { ETag: '"benchmark"' } }),
    put: async () => {},
  },
  waitUntil: () => {},
  buildId: 'benchmark',
}
const stages: Record<string, () => unknown> = {
  'cheerio.load (24 posts)': () => load(html, { xml: { xmlMode: false } }, false),
  'parse + transform (24 code posts)': parsePage,
  'parse + transform (code with br)': () => parsePage(htmlWithBreaks),
  'sanitize (24 posts)': () => posts.map(post => sanitizeContentHtml(post.content)),
  'Intl format (24 old posts)': () => posts.map(post => formatPostTime(post.datetime, 'Asia/Shanghai', 'zh-CN')),
  'JSON + UTF-8 size (24 posts)': () => encoder.encode(JSON.stringify(posts)).byteLength,
  'structuredClone (24 posts)': () => structuredClone(posts),
  'immutable parsed cache hit': () => getCachedValue('benchmark-page'),
  'ETag fill (read + SHA-256)': async () => createContentEtag(await new Response(cachedHtml).arrayBuffer()),
  'response hit (mock Cache API)': () => withResponseCache(request, async () => {
    throw new Error('Unexpected render')
  }, responseOptions),
}

// CPU deltas need batches on Windows, whose process counters have coarse resolution.
// Run serially on an otherwise idle machine; these are Node process CPU measurements.
const cpuResults = []
for (const [name, run] of Object.entries(stages)) {
  for (let i = 0; i < 5; i++) await run()
  const started = performance.now()
  for (let i = 0; i < 20; i++) await run()
  const iterations = Math.max(20, Math.min(2000, Math.ceil(150 / ((performance.now() - started) / 20))))
  const samples = []
  for (let batch = 0; batch < 5; batch++) {
    const start = process.cpuUsage()
    for (let i = 0; i < iterations; i++) await run()
    const cpu = process.cpuUsage(start)
    samples.push((cpu.user + cpu.system) / 1000 / iterations)
  }
  samples.sort((a, b) => a - b)
  cpuResults.push({ stage: name, medianBatchCpuMs: samples[2].toFixed(3) })
}
console.info(`Node ${process.version}; source ${encoder.encode(html).length} bytes; parsed ${encoder.encode(JSON.stringify(posts)).length} bytes`)
console.info(JSON.stringify(cpuResults, null, 2))

describe('telegram CPU stages (wall time; see process CPU batches above)', () => {
  for (const [name, run] of Object.entries(stages)) {
    bench(name, async () => {
      await run()
    }, { time: 300, iterations: 5 })
  }
})

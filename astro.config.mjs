import process from 'node:process'
import cloudflare from '@astrojs/cloudflare'
import netlify from '@astrojs/netlify'
import node from '@astrojs/node'
import vercel from '@astrojs/vercel'
import edgeone from '@edgeone/astro'
import tailwindcss from '@tailwindcss/vite'
import astroIcon from 'astro-icon'
import { defineConfig } from 'astro/config'
import { provider } from 'std-env'

const cloudflareAdapter = cloudflare()
const cloudflareProviders = new Set(['cloudflare', 'cloudflare_pages', 'cloudflare_workers'])

const providers = {
  vercel: vercel({
    isr: false,
    edgeMiddleware: false,
  }),
  cloudflare: cloudflareAdapter,
  cloudflare_pages: cloudflareAdapter,
  cloudflare_workers: cloudflareAdapter,
  netlify: netlify({
    cacheOnDemandPages: false,
    edgeMiddleware: false,
  }),
  node: node({
    mode: 'standalone',
  }),
  edgeone: edgeone(),
}

const adapterProvider = (process.env.HOME === '/dev/shm/home' && process.env.TMPDIR === '/dev/shm/tmp')
  ? 'edgeone'
  : process.env.SERVER_ADAPTER || provider
const isCloudflareAdapter = cloudflareProviders.has(adapterProvider)

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: providers[adapterProvider] || providers.node,
  integrations: [
    astroIcon(),
  ],
  vite: {
    plugins: [tailwindcss()],
    ssr: {
      noExternal: process.env.DOCKER ? !!process.env.DOCKER : undefined,
      external: [
        ...isCloudflareAdapter
          ? [
              'module',
              'url',
              'events',
              'worker_threads',
              'async_hooks',
              'util',
              'node:diagnostics_channel',
              'node:net',
              'node:tls',
              'node:worker_threads',
              'node:util',
              'node:fs',
              'node:path',
              'node:process',
              'node:buffer',
              'node:string_decoder',
              'node:readline',
              'node:events',
              'node:stream',
              'node:assert',
              'node:os',
              'node:crypto',
              'node:zlib',
              'node:http',
              'node:https',
              'node:url',
              'node:querystring',
              'node:child_process',
              'node:inspector',
            ]
          : [],
      ],
    },
  },
})

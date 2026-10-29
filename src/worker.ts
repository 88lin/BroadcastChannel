import type { SSRManifest } from 'astro'
import type { ResponseCache } from './lib/response-cache'
import { handle } from '@astrojs/cloudflare/handler'
import { App } from 'astro/app'
import { withResponseCache } from './lib/response-cache'

export function createExports(manifest: SSRManifest) {
  // Astro 5 selects incompatible Node async iterables under newer nodejs_compat.
  // Buffering avoids corrupted HTML, at the cost of miss TTFB and peak memory.
  const app = new App(manifest, false)
  const fetch = (request: Parameters<typeof handle>[2], env: Parameters<typeof handle>[3], context: Parameters<typeof handle>[4]) => withResponseCache(
    request as unknown as Request,
    () => handle(manifest, app, request, env, context),
    {
      cache: (globalThis.caches as unknown as { default?: ResponseCache })?.default,
      waitUntil: promise => context.waitUntil(promise),
      buildId: import.meta.env.RESPONSE_CACHE_BUILD_ID,
      base: import.meta.env.BASE_URL,
    },
  )
  return { default: { fetch } }
}

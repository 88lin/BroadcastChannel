import type { AstroEnvContext, NavItem } from '../types'

const PROCESS_GLOBAL_KEY = 'process'

interface ProcessLike {
  env?: Record<string, string | undefined>
}

function getProcessEnv(name: string): string | undefined {
  const globalScope = globalThis as typeof globalThis & Record<string, ProcessLike | undefined>
  return globalScope[PROCESS_GLOBAL_KEY]?.env?.[name]
}

/**
 * Reads an env variable from Vite's import.meta.env first, then falls back to
 * the Cloudflare/runtime env bindings exposed via Astro.locals.runtime.env,
 * then process.env as a last resort (covers Cloudflare Pages where Vite
 * static-replaces import.meta.env at build time and the runtime object may
 * not carry every binding).
 *
 * Boolean strings ("true" / "false") are normalized to actual booleans so
 * callers can use simple truthy checks.
 */
export function getEnv(
  env: Record<string, string | undefined>,
  Astro: AstroEnvContext,
  name: string,
): string | boolean | undefined {
  const value = env[name]
    ?? Astro.locals?.runtime?.env?.[name]
    ?? getProcessEnv(name)
  if (value === 'true')
    return true
  if (value === 'false')
    return false
  return value
}

export function getStringEnv(
  env: Record<string, string | undefined>,
  Astro: AstroEnvContext,
  name: string,
): string | undefined {
  const value = getEnv(env, Astro, name)
  return typeof value === 'string' ? value : undefined
}

export function getStaticProxy(
  env: Record<string, string | undefined>,
  Astro: AstroEnvContext,
): string {
  return getStringEnv(env, Astro, 'STATIC_PROXY') ?? '/static/'
}

export function getPodcastUrl(
  env: Record<string, string | undefined>,
  Astro: AstroEnvContext,
): string | undefined {
  return getStringEnv(env, Astro, 'PODCAST') ?? getStringEnv(env, Astro, 'PODCASRT')
}

export function isEnabled(value: string | boolean | undefined): boolean {
  return value === true || value === 'true' || value === '1'
}

export function getBooleanEnv(
  env: Record<string, string | undefined>,
  Astro: AstroEnvContext,
  name: string,
): boolean | undefined {
  const value = getEnv(env, Astro, name)
  return value === undefined ? undefined : isEnabled(value)
}

export function parseDelimitedItems(value: string | boolean | undefined = ''): NavItem[] {
  if (typeof value !== 'string') {
    return []
  }

  return value
    .split(';')
    .map(item => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [title = '', href = ''] = item.split(',').map(part => part.trim())
      return { title, href }
    })
    .filter(item => item.title.length > 0 && item.href.length > 0)
}

export function parseCsvList(value: string | boolean | undefined = ''): string[] {
  if (typeof value !== 'string') {
    return []
  }

  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

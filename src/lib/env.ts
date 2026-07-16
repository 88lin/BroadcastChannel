import type { AstroEnvContext, NavItem } from '../types'

const PROCESS_GLOBAL_KEY = 'process'

type Env = Record<string, string | undefined>

export const DEFAULT_TELEGRAM_HOST = 'telegram.me'

interface ProcessLike {
  env?: Env
}

function getProcessEnv(name: string): string | undefined {
  const globalScope = globalThis as typeof globalThis & Record<string, ProcessLike | undefined>
  return globalScope[PROCESS_GLOBAL_KEY]?.env?.[name]
}

function getRuntimeEnv(Astro: AstroEnvContext, name: string): string | undefined {
  try {
    return Astro.locals?.runtime?.env?.[name]
  }
  catch {
    return undefined
  }
}

/**
 * Runtime envs should win over Vite's build-time import.meta.env values.
 * Keep the legacy Astro runtime binding path for Cloudflare Pages SSR.
 *
 * Boolean strings ("true" / "false") are normalized to actual booleans so
 * callers can use simple truthy checks.
 */
export function getEnv(
  env: Env,
  Astro: AstroEnvContext,
  name: string,
): string | boolean | undefined {
  const value = getRuntimeEnv(Astro, name)
    ?? getProcessEnv(name)
    ?? env[name]
  if (value === 'true')
    return true
  if (value === 'false')
    return false
  return value
}

export function getStringEnv(
  env: Env,
  Astro: AstroEnvContext,
  name: string,
): string | undefined {
  const value = getEnv(env, Astro, name)
  return typeof value === 'string' ? value : undefined
}

export function getStaticProxy(
  env: Env,
  Astro: AstroEnvContext,
): string {
  return getStringEnv(env, Astro, 'STATIC_PROXY') ?? '/static/'
}

export function getTelegramHost(
  env: Env,
  Astro: AstroEnvContext,
): string {
  return getStringEnv(env, Astro, 'TELEGRAM_HOST') ?? DEFAULT_TELEGRAM_HOST
}

export function getPodcastUrl(
  env: Env,
  Astro: AstroEnvContext,
): string | undefined {
  return getStringEnv(env, Astro, 'PODCAST') ?? getStringEnv(env, Astro, 'PODCASRT')
}

export function isEnabled(value: string | boolean | undefined): boolean {
  return value === true || value === 'true' || value === '1'
}

export function getBooleanEnv(
  env: Env,
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

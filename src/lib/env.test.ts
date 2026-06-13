import type { AstroEnvContext } from '../types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getEnv, parseCsvList, parseDelimitedItems } from './env'

const astroContext: AstroEnvContext = {}

describe('getEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('prefers runtime env over import.meta.env', () => {
    const Astro = {
      locals: {
        runtime: {
          env: {
            TEST_ENV_PRIORITY: 'runtime-value',
          },
        },
      },
    } as unknown as AstroEnvContext

    expect(
      getEnv(
        { TEST_ENV_PRIORITY: 'import-value' },
        Astro,
        'TEST_ENV_PRIORITY',
      ),
    ).toBe('runtime-value')
  })

  it('prefers process.env over import.meta.env when runtime env is missing', () => {
    vi.stubEnv('TEST_ENV_PRIORITY', 'process-value')

    expect(
      getEnv(
        { TEST_ENV_PRIORITY: 'import-value' },
        astroContext,
        'TEST_ENV_PRIORITY',
      ),
    ).toBe('process-value')
  })

  it('falls back to import.meta.env when runtime and process env are missing', () => {
    expect(
      getEnv(
        { TEST_ENV_PRIORITY: 'import-value' },
        astroContext,
        'TEST_ENV_PRIORITY',
      ),
    ).toBe('import-value')
  })

  it('falls back when runtime env access throws', () => {
    const Astro = {
      locals: {
        get runtime() {
          throw new Error('removed')
        },
      },
    } as unknown as AstroEnvContext

    expect(getEnv({ CHANNEL: 'from-import-meta' }, Astro, 'CHANNEL')).toBe('from-import-meta')
  })
})

describe('env parsing helpers', () => {
  it('parses semicolon-delimited nav items and ignores empty entries', () => {
    expect(parseDelimitedItems('Home,/; ; Blog,/blog; Invalid; About,/about')).toEqual([
      { title: 'Home', href: '/' },
      { title: 'Blog', href: '/blog' },
      { title: 'About', href: '/about' },
    ])
  })

  it('parses comma-delimited lists and ignores empty entries', () => {
    expect(parseCsvList('alpha, , beta,, gamma ')).toEqual(['alpha', 'beta', 'gamma'])
  })
})

import type { AstroEnvContext } from '../types'
import { describe, expect, it } from 'vitest'
import { getEnv, parseCsvList, parseDelimitedItems } from './env'

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

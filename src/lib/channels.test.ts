import { afterEach, describe, expect, it, vi } from 'vitest'
import { getPostChannel, getSelectedChannel, InvalidChannelError, resolveSelectedChannel, withChannel } from './channels'

afterEach(() => vi.unstubAllEnvs())

describe('channel selection', () => {
  it('resolves configured names without accepting arbitrary Telegram targets', () => {
    expect(resolveSelectedChannel(['Alpha', 'beta'], ' alpha ')).toBe('Alpha')
    expect(resolveSelectedChannel(['Alpha', 'beta'], '')).toBe('')
    for (const value of ['unknown', 'alpha,beta', '../alpha', 'https://t.me/alpha']) {
      expect(() => resolveSelectedChannel(['Alpha', 'beta'], value)).toThrow(InvalidChannelError)
    }
  })

  it('reads the request URL and rejects ambiguous repeated selections', () => {
    vi.stubEnv('CHANNEL', 'alpha,beta')
    expect(getSelectedChannel({ request: new Request('https://site.example/?channel=BETA') })).toBe('beta')
    expect(() => getSelectedChannel({ url: new URL('https://site.example/?channel=alpha&channel=beta') })).toThrow(InvalidChannelError)
  })

  it('preserves other query parameters, fragments and deployment base paths', () => {
    const path = withChannel('/blog/search/result?q=%23C%2B%2B#results', 'beta')
    const url = new URL(path, 'https://site.example')
    expect(url.pathname).toBe('/blog/search/result')
    expect(url.searchParams.get('q')).toBe('#C++')
    expect(url.searchParams.get('channel')).toBe('beta')
    expect(url.hash).toBe('#results')
    expect(withChannel('https://site.example/blog/?channel=beta', '')).toBe('https://site.example/blog/')
  })

  it('maps stable primary and secondary post IDs to their original sources', () => {
    expect(getPostChannel('123', ['alpha', 'beta'])).toBe('alpha')
    expect(getPostChannel('beta-123', ['alpha', 'beta'])).toBe('beta')
  })

  it('matches the longest configured channel prefix for numeric post IDs', () => {
    const channels = ['primary', 'foo', 'foo-bar', 'foo-bar-baz']
    expect(getPostChannel('foo-bar-123', channels)).toBe('foo-bar')
    expect(getPostChannel('foo-bar-baz-456', channels)).toBe('foo-bar-baz')
    expect(getPostChannel('foo-123', channels)).toBe('foo')
    expect(getPostChannel('foo-bar-not-a-post-id', channels)).toBe('primary')
    expect(getPostChannel('foo-bar-', channels)).toBe('primary')
    expect(channels).toEqual(['primary', 'foo', 'foo-bar', 'foo-bar-baz'])
  })
})

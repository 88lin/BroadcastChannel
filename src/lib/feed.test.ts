import type { ChannelInfo, Post } from '../types'
import { describe, expect, it } from 'vitest'
import { buildJsonFeed } from './feed'

describe('json feed builder', () => {
  it('preserves channel and tag subscriptions without changing stable item URLs', () => {
    const feed = buildJsonFeed({
      channel: { posts: [], title: 'Site', description: '', descriptionHTML: null, avatar: undefined },
      posts: [{ id: 'beta-123', title: 'Post', type: 'text', datetime: '2026-01-02T03:04:05Z', tags: [], text: 'Text', content: '<p>Text</p>', reactions: [] }],
      siteUrl: new URL('https://site.example/blog/'),
      tag: 'C++',
      channelFilter: 'beta',
      title: 'Scoped feed',
    })
    expect(new URL(feed.feed_url).searchParams.get('channel')).toBe('beta')
    expect(new URL(feed.feed_url).searchParams.get('tag')).toBe('C++')
    expect(feed.home_page_url).toBe('https://site.example/blog/?channel=beta')
    expect(feed.items[0].url).toBe('https://site.example/blog/posts/beta-123')
    expect(feed.items[0].id).toBe(feed.items[0].url)
  })

  it('retains the selected tag in the subscription URL', () => {
    const feed = buildJsonFeed({
      channel: { posts: [], title: 'Channel', description: '', descriptionHTML: null, avatar: undefined },
      posts: [],
      siteUrl: new URL('https://example.com/blog/'),
      tag: 'C++ & 中文',
      title: 'Filtered feed',
    })
    const url = new URL(feed.feed_url)
    expect(url.pathname).toBe('/blog/rss.json')
    expect(url.searchParams.get('tag')).toBe('C++ & 中文')
  })

  it('emits JSON Feed 1.1 metadata and valid item fields', () => {
    const channel: ChannelInfo = {
      posts: [],
      title: 'Channel title',
      description: 'Channel description',
      descriptionHTML: null,
      avatar: undefined,
    }
    const posts: Post[] = [{
      id: '123',
      title: 'Post title',
      type: 'text',
      datetime: '2026-01-02T03:04:05.000Z',
      tags: ['tag'],
      text: 'Post text',
      description: 'Post summary',
      content: '<p>Hello</p><script>alert(1)</script>',
      reactions: [],
    }]

    const feed = buildJsonFeed({
      channel,
      posts,
      siteUrl: new URL('https://example.com/blog/'),
      tag: null,
      title: 'Feed title',
    })

    expect(feed).toMatchObject({
      version: 'https://jsonfeed.org/version/1.1',
      title: 'Feed title',
      home_page_url: 'https://example.com/blog/',
      feed_url: 'https://example.com/blog/rss.json',
    })
    expect(feed.items).toHaveLength(1)
    expect(feed.items[0]).toMatchObject({
      id: 'https://example.com/blog/posts/123',
      url: 'https://example.com/blog/posts/123',
      title: 'Post title',
      summary: 'Post summary',
      tags: ['tag'],
      content_html: '<p>Hello</p>',
    })
    expect(typeof feed.items[0]?.date_published).toBe('string')
  })
})

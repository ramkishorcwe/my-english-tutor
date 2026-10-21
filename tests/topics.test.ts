import { describe, expect, it, vi } from 'vitest';
import { loadNewsTopics, newsFeeds, parseNewsFeed } from '../src/lib/topics';
const now = Date.parse('2026-10-21T12:00:00Z');
const item = (
  title: string,
  url = 'https://www.bbc.com/news/articles/example',
  date = new Date(now).toUTCString(),
) =>
  `<item><title><![CDATA[${title}]]></title><link>${url}</link><pubDate>${date}</pubDate></item>`;
const rss = (items: string) => `<rss><channel>${items}</channel></rss>`;

describe('current discussion topics', () => {
  it('keeps recent attributed headlines and a practice topic that fits the session form', () => {
    const [topic] = parseNewsFeed(rss(item('Technology &amp; our future')), newsFeeds[0], now);
    expect(topic.title).toBe('Technology & our future');
    expect(topic.source).toBe('BBC News');
    expect(topic.practiceTopic.length).toBeLessThanOrEqual(240);
    expect(topic.practiceTopic).toContain('2026-10-21');
  });
  it('rejects stale, future, invalid, and unsafe source URLs rather than calling them current news', () => {
    const xml = rss(
      item('Old', undefined, 'Mon, 01 Jan 2024 00:00:00 GMT') +
        item('Future', undefined, 'Thu, 22 Oct 2026 12:00:00 GMT') +
        item('Unsafe', 'javascript:alert(1)') +
        item('Wrong host', 'https://bbc.com.evil.example/news') +
        item('No date', undefined, 'bad'),
    );
    expect(parseNewsFeed(xml, newsFeeds[0], now)).toEqual([]);
  });
  it('handles one unavailable feed, deduplicates stories, and preserves other categories', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(new Response(rss(item('A world story'))))
      .mockResolvedValueOnce(
        new Response(
          rss(
            item('Duplicate') + item('A discovery', 'https://www.bbc.com/news/articles/discovery'),
          ),
        ),
      );
    const result = await loadNewsTopics(fetcher, now);
    expect(result.unavailable).toBe(false);
    expect(result.topics.map((topic) => topic.title)).toEqual(['A world story', 'A discovery']);
  });
  it('returns an honest unavailable state when all feeds fail', async () => {
    const result = await loadNewsTopics(vi.fn().mockRejectedValue(new Error('offline')), now);
    expect(result).toMatchObject({ unavailable: true, topics: [] });
  });
  it('rejects DTD/entity declarations before parsing', () => {
    expect(
      parseNewsFeed('<!DOCTYPE rss [<!ENTITY x "bad">]>' + rss(item('Hello')), newsFeeds[0], now),
    ).toEqual([]);
  });
});

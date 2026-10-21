import { XMLParser } from 'fast-xml-parser';

export type NewsTopic = {
  id: string;
  title: string;
  category: string;
  source: string;
  url: string;
  publishedAt: string;
  question: string;
  practiceTopic: string;
};
export type TopicFeed = { topics: NewsTopic[]; fetchedAt: string; unavailable: boolean };

export const newsFeeds = [
  {
    category: 'Technology',
    url: 'https://feeds.bbci.co.uk/news/technology/rss.xml',
    question: 'How could this affect our everyday lives?',
  },
  {
    category: 'World',
    url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
    question: 'Why does this story matter to you?',
  },
  {
    category: 'Science',
    url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
    question: 'What could we learn from this news?',
  },
] as const;

const parser = new XMLParser({
  ignoreAttributes: true,
  processEntities: false,
  parseTagValue: false,
});
const plain = (value: unknown) =>
  typeof value === 'string'
    ? value
        .replace(/<[^>]*>/g, '')
        .replace(
          /&(amp|lt|gt|quot|apos);/g,
          (_, entity: string) =>
            ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[entity] || '',
        )
        .replace(/\s+/g, ' ')
        .trim()
    : '';

export function parseNewsFeed(
  xml: string,
  feed: (typeof newsFeeds)[number],
  now = Date.now(),
): NewsTopic[] {
  if (xml.length > 1_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) return [];
  const parsed = parser.parse(xml);
  const items = parsed?.rss?.channel?.item;
  if (!items) return [];
  return (Array.isArray(items) ? items : [items]).slice(0, 100).flatMap((item): NewsTopic[] => {
    const title = plain(item.title).slice(0, 180);
    const date = Date.parse(plain(item.pubDate));
    let url: URL;
    try {
      url = new URL(plain(item.link));
    } catch {
      return [];
    }
    if (
      url.protocol !== 'https:' ||
      !['bbc.com', 'www.bbc.com', 'bbc.co.uk', 'www.bbc.co.uk'].includes(url.hostname)
    )
      return [];
    if (!title || !Number.isFinite(date) || date < now - 72 * 3600000 || date > now + 3600000)
      return [];
    url.hash = '';
    const question = feed.question;
    return [
      {
        id: url.origin + url.pathname,
        title,
        category: feed.category,
        source: 'BBC News',
        url: url.toString(),
        publishedAt: new Date(date).toISOString(),
        question,
        practiceTopic:
          `News: ${title.slice(0, 145)} (BBC, ${new Date(date).toISOString().slice(0, 10)}). ${question}`.slice(
            0,
            240,
          ),
      },
    ];
  });
}

export async function loadNewsTopics(
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<TopicFeed> {
  const results = await Promise.allSettled(
    newsFeeds.map(async (feed) => {
      const response = await fetcher(feed.url, {
        next: { revalidate: 900 },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return [];
      return parseNewsFeed(await response.text(), feed, now)
        .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
        .slice(0, 3);
    }),
  );
  const seen = new Set<string>();
  const groups = results.map((r) => (r.status === 'fulfilled' ? r.value : []));
  const topics: NewsTopic[] = [];
  for (let row = 0; row < 2; row++)
    for (const group of groups) {
      const topic = group[row];
      if (topic && !seen.has(topic.id)) {
        topics.push(topic);
        seen.add(topic.id);
      }
    }
  return { topics, fetchedAt: new Date(now).toISOString(), unavailable: topics.length === 0 };
}

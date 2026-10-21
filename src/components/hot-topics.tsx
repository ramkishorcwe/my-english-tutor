'use client';
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Flame, RefreshCw } from 'lucide-react';
import type { NewsTopic, TopicFeed } from '@/lib/topics';

export function HotTopics({
  onSelect,
  activeTopic,
}: {
  onSelect: (topic: NewsTopic) => void;
  activeTopic: string;
}) {
  const [feed, setFeed] = useState<TopicFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('All');
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch('/api/topics', { signal });
      if (!response.ok) throw new Error('News feed unavailable');
      const next: TopicFeed = await response.json();
      if (!signal?.aborted) setFeed(next);
    } catch {
      if (!signal?.aborted) setFeed({ topics: [], fetchedAt: '', unavailable: true });
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const topics =
    feed?.topics.filter((topic) => category === 'All' || topic.category === category) || [];
  return (
    <section className="hot-topics" aria-labelledby="hot-topics-heading">
      <div className="section-heading">
        <div>
          <div className="eyebrow">
            <Flame size={15} /> IN THE NEWS
          </div>
          <h2 id="hot-topics-heading">Hot topics to discuss.</h2>
          <p>
            Recent headlines, your point of view. Pick a story and practise explaining what you
            think.
          </p>
        </div>
        <button
          className="button secondary"
          disabled={loading}
          onClick={() => void load()}
          aria-label="Refresh news topics"
        >
          <RefreshCw size={16} /> Refresh
        </button>
      </div>
      <div className="topic-filters" role="group" aria-label="News categories">
        {['All', 'Technology', 'World', 'Science'].map((value) => (
          <button
            key={value}
            className={category === value ? 'active' : ''}
            aria-pressed={category === value}
            onClick={() => setCategory(value)}
          >
            {value}
          </button>
        ))}
      </div>
      {loading ? (
        <p role="status" className="topics-status">
          Finding recent headlines…
        </p>
      ) : feed?.unavailable ? (
        <div className="topics-status" role="status">
          <p>
            Current headlines are unavailable right now. You can still choose a practice mode or
            type your own topic below.
          </p>
          <button className="text-link" onClick={() => void load()}>
            Try headlines again <ArrowRight size={15} />
          </button>
        </div>
      ) : topics.length ? (
        <div className="topic-grid">
          {topics.map((topic) => (
            <article
              key={topic.id}
              className={`topic-card ${activeTopic === topic.practiceTopic ? 'selected' : ''}`}
            >
              <div className="topic-meta">
                <span>{topic.category}</span>
                <time dateTime={topic.publishedAt}>
                  {new Date(topic.publishedAt).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    timeZone: 'UTC',
                  })}
                </time>
              </div>
              <h3>{topic.title}</h3>
              <p>{topic.question}</p>
              <div className="topic-actions">
                <a
                  href={topic.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Read on ${topic.source}: ${topic.title}`}
                >
                  {topic.source} ↗
                </a>
                <button
                  className="button secondary"
                  aria-pressed={activeTopic === topic.practiceTopic}
                  aria-label={`Discuss: ${topic.title}`}
                  onClick={() => onSelect(topic)}
                >
                  {activeTopic === topic.practiceTopic ? 'Topic selected' : 'Discuss this'}{' '}
                  <ArrowRight size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="topics-status">No recent headlines in this category. Try another category.</p>
      )}
      <p className="topics-note">
        Headlines published within the last 72 hours · Feed refreshes about every 15 minutes. Read
        the source for context; your coach helps you discuss ideas and opinions.
      </p>
      {feed?.topics.some((item) => item.practiceTopic === activeTopic) && (
        <p role="status" className="topic-selection-note">
          Topic added to “What’s on your mind?” below. You can edit it before starting.
        </p>
      )}
    </section>
  );
}

'use client';

import { useState } from 'react';
import { BookOpen, Search, X } from 'lucide-react';
import { everydayCategories, everydayWords } from '@/lib/everyday-vocabulary';
import { SpeakButton } from './pronunciation';

export function EverydayVocabularyPage() {
  const [categoryId, setCategoryId] = useState('routine');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(24);
  const search = query.trim().toLocaleLowerCase('en');
  const category = everydayCategories.find((item) => item.id === categoryId);
  const matches = everydayWords.filter(
    (entry) =>
      (categoryId === 'all' || entry.categoryId === categoryId) &&
      (!search ||
        `${entry.word} ${entry.meaning} ${entry.example} ${entry.categoryTitle}`
          .toLocaleLowerCase('en')
          .includes(search)),
  );
  function chooseCategory(id: string) {
    setCategoryId(id);
    setLimit(24);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">WORDS FOR YOUR EVERYDAY WORLD</div>
          <h1>Everyday vocabulary.</h1>
          <p>
            Explore {everydayWords.length} useful words and phrases in {everydayCategories.length}{' '}
            categories. Learn a meaning, hear it, then try your own sentence.
          </p>
        </div>
      </div>
      <section className="panel everyday-browse" aria-labelledby="vocabulary-categories">
        <div className="everyday-browse-heading">
          <BookOpen size={22} />
          <h2 id="vocabulary-categories">Choose a part of your day</h2>
        </div>
        <div className="everyday-categories" role="group" aria-label="Vocabulary categories">
          <button
            type="button"
            aria-pressed={categoryId === 'all'}
            onClick={() => chooseCategory('all')}
          >
            All categories <span>{everydayWords.length}</span>
          </button>
          {everydayCategories.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-pressed={categoryId === item.id}
              onClick={() => chooseCategory(item.id)}
            >
              {item.title} <span>{item.words.length}</span>
            </button>
          ))}
        </div>
        <label className="everyday-search" htmlFor="everyday-search">
          <span>Search everyday vocabulary</span>
          <div>
            <Search size={18} aria-hidden="true" />
            <input
              id="everyday-search"
              type="search"
              placeholder="Try ‘receipt’, ‘feelings’, or ‘commute’"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setCategoryId('all');
                setLimit(24);
              }}
            />
            {query && (
              <button
                type="button"
                className="icon-button"
                aria-label="Clear vocabulary search"
                onClick={() => {
                  setQuery('');
                  setLimit(24);
                }}
              >
                <X size={16} />
              </button>
            )}
          </div>
        </label>
      </section>
      <section className="everyday-library" aria-labelledby="everyday-results-heading">
        <div className="everyday-results-heading">
          <div>
            <h2 id="everyday-results-heading">{category?.title || 'All everyday words'}</h2>
            <p>{category?.description || 'Find words for the situations you meet every day.'}</p>
          </div>
          <p role="status">
            {matches.length} {matches.length === 1 ? 'word or phrase' : 'words and phrases'}
            {search ? ' found' : ''}
          </p>
        </div>
        {matches.length ? (
          <>
            <div className="everyday-grid">
              {matches.slice(0, limit).map((entry) => (
                <article
                  className="panel everyday-card"
                  key={`${entry.categoryId}:${entry.word}`}
                  aria-label={entry.word}
                >
                  <span className="everyday-category-label">{entry.categoryTitle}</span>
                  <h3>{entry.word}</h3>
                  <p className="everyday-meaning">{entry.meaning}</p>
                  <blockquote>{entry.example}</blockquote>
                  <div className="everyday-audio">
                    <SpeakButton text={entry.word} label="Hear word" />
                    <SpeakButton text={entry.example} label="Hear example" />
                  </div>
                </article>
              ))}
            </div>
            {matches.length > limit && (
              <div className="everyday-more">
                <p>
                  Showing {Math.min(limit, matches.length)} of {matches.length}
                </p>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setLimit((value) => value + 24)}
                >
                  Show more words
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="panel everyday-empty">
            <Search size={28} />
            <h3>No matching words yet</h3>
            <p>
              This is a curated starter collection. Try a shorter search or browse a different
              category.
            </p>
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setQuery('');
                chooseCategory('all');
              }}
            >
              Show all vocabulary
            </button>
          </div>
        )}
      </section>
    </>
  );
}

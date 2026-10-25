'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Check, Languages, Search, Trash2 } from 'lucide-react';
import { api, type AppData } from '@/lib/data';
import {
  dictionaryLanguages,
  preferredDictionaryLanguage,
  TRANSLATION_LIMIT,
  type DictionaryEntry,
} from '@/lib/dictionary';

export function TranslationTool({
  language,
  initialText = '',
  onSaved,
}: {
  language?: string;
  initialText?: string;
  onSaved?: () => void;
}) {
  const [text, setText] = useState(initialText);
  const [target, setTarget] = useState(preferredDictionaryLanguage(language));
  const [entry, setEntry] = useState<DictionaryEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(false);
  useEffect(() => {
    setText(initialText);
    setEntry(null);
    setError('');
  }, [initialText]);
  async function translate() {
    if (active.current || !text.trim()) return;
    active.current = true;
    setBusy(true);
    setError('');
    setEntry(null);
    try {
      const result = await api<{ entry: DictionaryEntry }>('dictionary', 'POST', {
        text: text.trim(),
        targetLanguage: target,
      });
      setEntry(result.entry);
      onSaved?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="translation-tool">
      <p>
        Translate a word, phrase, or message. Successful searches are saved privately in your
        dictionary.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void translate();
        }}
      >
        <label>
          Word, phrase, or text
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setEntry(null);
            }}
            maxLength={TRANSLATION_LIMIT}
            required
            disabled={busy}
            placeholder="For example: take the initiative"
          />
        </label>
        <div className="translation-actions">
          <label>
            Translate into
            <select
              value={target}
              disabled={busy}
              onChange={(e) => {
                setTarget(e.target.value as typeof target);
                setEntry(null);
              }}
            >
              {dictionaryLanguages.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>
          <button
            className="button primary"
            disabled={busy || !text.trim() || text.length > TRANSLATION_LIMIT}
            type="submit"
          >
            <Languages size={16} />
            {busy ? 'Translating and saving…' : 'Translate & save'}
          </button>
        </div>
        <p className="writing-note">
          {text.length.toLocaleString('en-IN')}/6,000 characters · Text is sent to Google Gemini for
          translation.
        </p>
      </form>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {entry && (
        <section className="translation-result" aria-label="Translation result">
          <p className="dictionary-saved" role="status">
            <Check size={15} />
            Saved to your personal dictionary
          </p>
          <TranslationContent entry={entry} />
          <Link className="text-link" href="/dictionary">
            Open my dictionary <ArrowRight size={14} />
          </Link>
        </section>
      )}
    </div>
  );
}
function TranslationContent({ entry }: { entry: DictionaryEntry }) {
  return (
    <>
      <div className="eyebrow">
        {entry.source_language} → {entry.target_language}
      </div>
      <p className="dictionary-translation" dir="auto">
        {entry.translation}
      </p>
      <h3>Meaning in English</h3>
      <p>{entry.meaning}</p>
      <h3>English example</h3>
      <p>{entry.example}</p>
    </>
  );
}
export function PersonalDictionaryPage({ data }: { data: AppData }) {
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const refresh = useCallback(() => {
    setPage(0);
    setRevision((n) => n + 1);
  }, []);
  useEffect(() => {
    if (!data.user) return;
    const request = ++generation.current;
    setBusy(true);
    setError('');
    void api<{ entries: DictionaryEntry[]; hasMore: boolean }>(
      `dictionary?q=${encodeURIComponent(search)}&page=${page}`,
    )
      .then((result) => {
        if (generation.current !== request) return;
        setEntries((previous) =>
          page === 0
            ? result.entries
            : [...previous, ...result.entries.filter((e) => !previous.some((p) => p.id === e.id))],
        );
        setHasMore(result.hasMore);
      })
      .catch((e) => {
        if (generation.current === request) setError(e.message);
      })
      .finally(() => {
        if (generation.current === request) setBusy(false);
      });
    return () => {
      generation.current++;
    };
  }, [data.user, search, page, revision]);
  async function remove(id: string) {
    try {
      await api(`dictionary?id=${encodeURIComponent(id)}`, 'DELETE');
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (!data.user)
    return (
      <section className="panel writing-intro">
        <BookOpen size={25} />
        <h1>Your words, always within reach.</h1>
        <p>Sign in to translate words and build your private personal dictionary.</p>
        <Link className="button primary" href="/signin">
          Sign in <ArrowRight size={16} />
        </Link>
      </section>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">SMALL WORDS, MORE CONFIDENCE</div>
          <h1>My dictionary.</h1>
          <p>Every word you look up becomes part of your English toolkit.</p>
        </div>
      </div>
      <section className="panel dictionary-lookup">
        <h2>
          <Languages size={23} />
          Translate & save
        </h2>
        <TranslationTool language={data.profile?.native_language} onSaved={refresh} />
      </section>
      <section className="dictionary-library" aria-labelledby="saved-words-heading">
        <h2 id="saved-words-heading">Your saved words and phrases</h2>
        <form
          className="dictionary-search"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(0);
            setSearch(query.trim());
            setRevision((n) => n + 1);
          }}
        >
          <label htmlFor="dictionary-search">Search your dictionary</label>
          <div>
            <input
              id="dictionary-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={120}
              placeholder="Find a word you looked up…"
            />
            <button className="button secondary" type="submit">
              <Search size={16} />
              Search
            </button>
          </div>
        </form>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        {busy && <p role="status">Loading your dictionary…</p>}
        {!busy && !error && !entries.length && (
          <p className="panel">
            {search
              ? 'No saved words match your search.'
              : 'Translate your first word above. It will be saved here automatically.'}
          </p>
        )}
        <div className="dictionary-grid">
          {entries.map((entry) => (
            <article className="panel dictionary-card" key={entry.id}>
              <div className="dictionary-card-heading">
                <h2 dir="auto">
                  {entry.term.length > 160 ? `${entry.term.slice(0, 150)}…` : entry.term}
                </h2>
                <button
                  className="icon-button"
                  aria-label={`Remove ${entry.term.slice(0, 60)} from dictionary`}
                  onClick={() => void remove(entry.id)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              {entry.term.length > 160 && (
                <details>
                  <summary>Read full text</summary>
                  <p dir="auto">{entry.term}</p>
                </details>
              )}
              <TranslationContent entry={entry} />
            </article>
          ))}
        </div>
        {hasMore && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => setPage((n) => n + 1)}
          >
            Load more saved words
          </button>
        )}
      </section>
    </>
  );
}

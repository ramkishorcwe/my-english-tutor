'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, MessagesSquare, Send, Sparkles } from 'lucide-react';
import { api, type AppData } from '@/lib/data';
import { TranslationTool } from './personal-dictionary';
import {
  writingHighlights,
  writingMessageSchema,
  WRITING_MESSAGE_LIMIT,
  type WritingChat,
  type WritingReview,
  type WritingThread,
} from '@/lib/writing';

export function WritingChatPage({ id, data }: { id?: string; data: AppData }) {
  const router = useRouter();
  const [topic, setTopic] = useState('');
  const [chats, setChats] = useState<WritingChat[]>([]);
  const [thread, setThread] = useState<WritingThread | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState('');
  const [retryRequest, setRetryRequest] = useState<{
    requestId: string;
    text: string | null;
  } | null>(null);
  const mounted = useRef(true);
  const attemptedOpening = useRef(false);
  const attemptedReview = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const translator = useRef<HTMLDetailsElement>(null);
  const [translationText, setTranslationText] = useState('');
  const inFlight = useRef(false);
  const draftKey = `speakbetter:writing:${data.user?.id}:${id}`;
  const pendingKey = `${draftKey}:pending`;
  const load = useCallback(async () => {
    if (!id || !data.user) return;
    const result = await api<WritingThread>(`chats/${id}`);
    if (mounted.current) setThread(result);
    return result;
  }, [id, data.user]);
  useEffect(() => {
    mounted.current = true;
    if (data.user) {
      if (id) {
        let savedRequest: { requestId: string; text: string | null } | null = null;
        try {
          setDraft(sessionStorage.getItem(draftKey) || '');
          const saved = sessionStorage.getItem(pendingKey);
          if (saved) {
            const parsed = writingMessageSchema.safeParse(JSON.parse(saved));
            if (parsed.success) savedRequest = parsed.data;
          }
          setRetryRequest(savedRequest);
        } catch {}
        void load()
          .then((result) => {
            if (!mounted.current || !result || !savedRequest) return;
            if (
              !result.pending &&
              (savedRequest.text === null
                ? result.turns.length > 0
                : result.turns.some((t) => t.id === savedRequest.requestId))
            ) {
              setRetryRequest(null);
              try {
                sessionStorage.removeItem(pendingKey);
              } catch {}
            }
          })
          .catch((e) => setError(e.message))
          .finally(() => setLoading(false));
      } else {
        void api<{ chats: WritingChat[] }>('chats')
          .then((r) => setChats(r.chats))
          .catch((e) => setError(e.message));
      }
    }
    return () => {
      mounted.current = false;
    };
  }, [id, data.user, load, draftKey, pendingKey]);
  useEffect(() => {
    if (thread?.chat.status === 'active')
      bottom.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [thread?.turns.length, busy, thread?.chat.status, retryRequest?.requestId]);
  async function create() {
    if (!data.user) {
      router.push('/signin');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await api<{ id: string }>('chats', 'POST', {
        topic: topic.trim() || 'Surprise me',
      });
      router.push(`/chat/${result.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function message(request: { requestId: string; text: string | null }) {
    if (!id || busy || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setRetryRequest(request);
    try {
      sessionStorage.setItem(pendingKey, JSON.stringify(request));
    } catch {}
    try {
      const result = await api<WritingThread>(`chats/${id}/message`, 'POST', request);
      if (!mounted.current) return;
      setThread(result);
      setRetryRequest(null);
      try {
        sessionStorage.removeItem(pendingKey);
      } catch {}
    } catch (e) {
      if (!mounted.current) return;
      setError((e as Error).message);
      setRetryRequest(request);
      try {
        const result = await load();
        if (!mounted.current) return;
        if (
          result &&
          !result.pending &&
          (request.text === null
            ? result.turns.length > 0
            : result.turns.some((t) => t.id === request.requestId))
        ) {
          setRetryRequest(null);
          sessionStorage.removeItem(pendingKey);
        }
      } catch {
        /* The pending request stays visible and can be retried with the same ID. */
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function send() {
    if (
      !draft.trim() ||
      busy ||
      inFlight.current ||
      thread?.pending ||
      retryRequest ||
      !thread?.turns.length ||
      thread.chat.status !== 'active' ||
      thread.turns.filter((t) => t.role === 'user').length >= 30
    )
      return;
    const text = draft.trim();
    setDraft('');
    try {
      sessionStorage.removeItem(draftKey);
    } catch {}
    void message({ requestId: crypto.randomUUID(), text });
    composer.current?.focus({ preventScroll: true });
  }
  async function review() {
    if (!id) return;
    setReviewing(true);
    setError('');
    try {
      const result = await api<WritingReview>(`chats/${id}/review`, 'POST', {});
      if (mounted.current)
        setThread((previous) =>
          previous ? { ...previous, chat: { ...previous.chat, review: result } } : previous,
        );
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setReviewing(false);
    }
  }
  useEffect(() => {
    if (
      thread?.chat.status === 'active' &&
      !thread.turns.length &&
      !thread.pending &&
      !retryRequest &&
      !attemptedOpening.current
    ) {
      attemptedOpening.current = true;
      void message({ requestId: thread.chat.id, text: null });
    }
    if (
      thread?.chat.status === 'ended' &&
      !thread.chat.review?.summary &&
      !attemptedReview.current
    ) {
      attemptedReview.current = true;
      void review();
    }
  }, [thread, retryRequest]);
  async function end() {
    if (!id) return;
    setBusy(true);
    setError('');
    try {
      await api(`chats/${id}/end`, 'POST', {});
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const pending = thread?.pending || retryRequest;
  const unsavedMessage =
    pending?.text && !thread?.turns.some((t) => t.id === pending.requestId) ? pending : null;
  const users = thread?.turns.filter((t) => t.role === 'user') || [];
  const userCount = users.length + (unsavedMessage ? 1 : 0);
  if (!data.user)
    return (
      <section className="panel writing-intro">
        <Sparkles size={24} />
        <h1>Find your words, one message at a time.</h1>
        <p>
          Chat with your AI tutor, then review your writing with highlighted corrections and clearer
          alternatives.
        </p>
        <Link className="button primary" href="/signin">
          Sign in to start chatting <ArrowRight size={16} />
        </Link>
      </section>
    );
  if (!id)
    return (
      <>
        <div className="page-heading">
          <div>
            <div className="eyebrow">A LITTLE ROOM FOR YOUR WORDS</div>
            <h1>Let’s get a conversation going.</h1>
            <p>
              Choose the roles. Chat naturally. Get a summary and writing corrections when you
              finish.
            </p>
          </div>
        </div>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        <div className="writing-start-layout">
          <section className="panel writing-intro">
            <span className="icon-box mint">
              <MessagesSquare size={24} />
            </span>
            <h2>Who would you like to practise with?</h2>
            <div className="writing-topics">
              {[
                { label: 'Surprise me', context: 'Surprise me' },
                {
                  label: 'Job interview',
                  context:
                    'You are a hiring manager. I am a job candidate. Help me practise a realistic job interview.',
                },
                {
                  label: 'Client meeting',
                  context:
                    'You are a client. I am a developer. We are discussing the requirements for your new website.',
                },
                {
                  label: 'Friendly chat',
                  context:
                    'You are a friend. We are catching up about our everyday lives and weekend plans.',
                },
              ].map(({ label, context }) => (
                <button
                  key={label}
                  className={`button secondary ${topic === context ? 'selected' : ''}`}
                  aria-pressed={topic === context}
                  onClick={() => setTopic(context)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label>
              Roles and situation (optional)
              <textarea
                value={topic}
                maxLength={240}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="For example: You are my manager. I want to practise asking for a promotion."
              />
            </label>
            <p className="writing-note">
              Say who the AI should play, who you are, and what you want to practise. You can also
              change the situation during your chat.
            </p>
            <button
              className="button primary"
              disabled={busy || topic.trim().length === 1}
              onClick={() => void create()}
            >
              {busy ? 'Starting your chat…' : 'Start writing chat'} <ArrowRight size={16} />
            </button>
            <p className="writing-note">
              No microphone needed. Up to 30 messages per chat. Your messages go to Google Gemini
              for replies and feedback, and are saved privately in Supabase.
            </p>
          </section>
          <section className="panel">
            <h2>Your writing conversations</h2>
            {chats.length ? (
              <ul className="writing-history">
                {chats.map((chat) => (
                  <li key={chat.id}>
                    <Link href={`/chat/${chat.id}`}>
                      <strong>{chat.topic}</strong>
                      <span>
                        {chat.status === 'active' ? 'Continue chatting' : 'Open writing review'} ·{' '}
                        {new Date(chat.created_at).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                        })}
                      </span>
                      <ArrowRight size={16} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p>Your saved chats and writing reviews will appear here.</p>
            )}
          </section>
        </div>
      </>
    );
  if (loading)
    return (
      <p role="status" className="loading-state">
        Opening your writing chat…
      </p>
    );
  if (!thread)
    return (
      <section className="panel">
        <h1>We couldn’t open this chat.</h1>
        <p role="alert">{error}</p>
        <Link href="/chat" className="button secondary">
          Your writing chats
        </Link>
      </section>
    );
  return (
    <>
      <div className="writing-chat-heading">
        <div>
          <Link className="text-link" href="/chat">
            ← Your writing chats
          </Link>
          <div className="eyebrow">WRITTEN PRACTICE · AI TUTOR</div>
          <h1>
            {thread.chat.topic === 'Surprise me'
              ? 'A conversation to find your flow.'
              : 'Your conversation practice.'}
          </h1>
          {thread.chat.topic !== 'Surprise me' && (
            <p className="writing-situation">{thread.chat.topic}</p>
          )}
          <p>
            {thread.chat.status === 'active'
              ? `${userCount} of 30 messages · Summary and corrections when you finish`
              : 'Chat saved · Your writing review'}
          </p>
        </div>
        {thread.chat.status === 'active' && (
          <button
            className="button secondary"
            disabled={busy || Boolean(pending) || !users.length}
            onClick={() => void end()}
          >
            End & review writing <Check size={16} />
          </button>
        )}
      </div>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {thread.chat.status === 'ended' && (
        <>
          {thread.chat.review ? (
            <>
              <WritingReviewPanel review={thread.chat.review} thread={thread} />
              {!thread.chat.review.summary && (
                <button
                  className="button secondary"
                  disabled={reviewing}
                  onClick={() => void review()}
                >
                  {reviewing ? 'Summarising your conversation…' : 'Generate conversation summary'}
                </button>
              )}
            </>
          ) : (
            <section className="panel writing-intro">
              <h2>Every message deserves a second look.</h2>
              <p>
                Your chat is saved. We review every message for grammar, spelling, punctuation, and
                phrasing.
              </p>
              <button className="button primary" disabled={reviewing} onClick={() => void review()}>
                {reviewing
                  ? 'Preparing your summary and corrections…'
                  : 'Generate or retry writing review'}{' '}
                <Sparkles size={16} />
              </button>
              <p className="writing-note">
                Completed review sections are saved, so a retry can continue where it left off.
              </p>
            </section>
          )}
        </>
      )}
      <details className="panel writing-translator" ref={translator}>
        <summary>Translate & save words to my dictionary</summary>
        <TranslationTool language={data.profile?.native_language} initialText={translationText} />
      </details>
      <section className="panel writing-conversation" aria-label="Written conversation">
        <h2>
          {thread.chat.status === 'ended' ? 'Your saved conversation' : 'You and your AI tutor'}
        </h2>
        <div
          className="writing-messages"
          role="log"
          aria-label="Chat messages"
          aria-live="polite"
          aria-relevant="additions"
        >
          {thread.turns.map((turn) => (
            <div key={turn.id} className={`writing-message ${turn.role}`}>
              <span>{turn.role === 'user' ? 'YOU' : 'AI TUTOR'}</span>
              <p>{turn.text}</p>
              <button
                className="text-link writing-translate-button"
                onClick={() => {
                  setTranslationText(turn.text);
                  if (translator.current) {
                    translator.current.open = true;
                    translator.current.scrollIntoView({ block: 'start', behavior: 'smooth' });
                  }
                }}
              >
                Translate message
              </button>
              {turn.role === 'user' && pending?.requestId === turn.id && (
                <small className="writing-message-status">
                  {busy ? 'Waiting for tutor…' : 'Tutor reply needs a retry'}
                </small>
              )}
            </div>
          ))}
          {unsavedMessage && (
            <div className="writing-message user">
              <span>YOU</span>
              <p>{unsavedMessage.text}</p>
              <small className="writing-message-status">
                {busy ? 'Sending…' : 'Send not confirmed · Retry below'}
              </small>
            </div>
          )}
          {busy && (
            <p role="status" className="writing-thinking">
              <span className="writing-typing-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              Your tutor is typing…
            </p>
          )}
          <div ref={bottom} />
        </div>
        {thread.chat.status === 'active' && (
          <>
            {pending && !busy && (
              <div className="writing-retry">
                <p>
                  The tutor’s reply needs another try. Your message is kept here; retrying won’t
                  send it twice.
                </p>
                <button className="button secondary" onClick={() => void message(pending)}>
                  Retry tutor reply
                </button>
              </div>
            )}
            {!thread.turns.length && !pending && !busy && (
              <button
                className="button secondary"
                onClick={() => void message({ requestId: thread.chat.id, text: null })}
              >
                Ask the tutor to begin
              </button>
            )}
            <form
              className="writing-composer"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <label htmlFor="writing-message">Your message</label>
              <textarea
                id="writing-message"
                ref={composer}
                value={draft}
                maxLength={WRITING_MESSAGE_LIMIT}
                placeholder="Take your time. Write what you think…"
                disabled={!thread.turns.length || userCount >= 30}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    send();
                  }
                }}
                onChange={(e) => {
                  setDraft(e.target.value);
                  try {
                    sessionStorage.setItem(draftKey, e.target.value);
                  } catch {}
                }}
              />
              <div>
                <span>
                  {draft.length.toLocaleString('en-IN')}/5,000 · Enter to send · Shift+Enter for a
                  new line
                </span>
                <button
                  className="button primary"
                  disabled={
                    busy ||
                    Boolean(pending) ||
                    !draft.trim() ||
                    !thread.turns.length ||
                    userCount >= 30
                  }
                  type="submit"
                >
                  Send message <Send size={16} />
                </button>
              </div>
            </form>
            {userCount >= 30 && (
              <p>
                You’ve reached the end of this chat. Choose End & review writing for your feedback.
              </p>
            )}
          </>
        )}
      </section>
      <p className="writing-note">
        AI feedback can miss mistakes. Suggestions preserve your intended meaning; optional style
        changes are labeled separately.
      </p>
    </>
  );
}

function WritingReviewPanel({ review, thread }: { review: WritingReview; thread: WritingThread }) {
  const errors = review.messages.reduce(
    (n, m) => n + m.corrections.filter((c) => c.kind === 'correction').length,
    0,
  );
  return (
    <section className="panel writing-review" aria-labelledby="writing-review-heading">
      <div className="eyebrow">
        <Sparkles size={15} /> YOUR WORDS, WITH A LITTLE MORE CLARITY
      </div>
      <h2 id="writing-review-heading">Your writing, reviewed.</h2>
      {review.summary && (
        <section className="writing-summary" aria-labelledby="writing-summary-heading">
          <h3 id="writing-summary-heading">Conversation summary</h3>
          <p>{review.summary}</p>
        </section>
      )}
      <p>
        {review.messages.length} {review.messages.length === 1 ? 'message' : 'messages'} reviewed ·{' '}
        {errors} suggested corrections. Highlighted text shows phrases to improve.
      </p>
      {review.messages.map((feedback, index) => {
        const turn = thread.turns.find((t) => t.id === feedback.turnId);
        if (!turn) return null;
        return (
          <article key={feedback.turnId} className="writing-feedback">
            <h3>Your message {index + 1}</h3>
            <p className="writing-original">
              {writingHighlights(turn.text, feedback).map((part, i) =>
                part.highlight ? (
                  <mark key={i}>{part.text}</mark>
                ) : (
                  <span key={i}>{part.text}</span>
                ),
              )}
            </p>
            {feedback.corrections.length ? (
              <>
                <span className="quote-label corrected">SUGGESTED VERSION</span>
                <p className="writing-corrected">{feedback.corrected}</p>
                <ul>
                  {feedback.corrections.map((correction, i) => (
                    <li key={i}>
                      <span className="pill">
                        {correction.kind === 'optional' ? 'Optional improvement' : 'Correction'}
                      </span>
                      <p>
                        <q>{correction.original}</q> <span aria-label="becomes">→</span>{' '}
                        <strong>{correction.corrected}</strong>
                      </p>
                      <p>{correction.explanation}</p>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="writing-clear">
                <Check size={15} /> No corrections identified in this message.
              </p>
            )}
          </article>
        );
      })}
      <Link className="button primary" href="/chat">
        Start another writing chat <ArrowRight size={16} />
      </Link>
    </section>
  );
}

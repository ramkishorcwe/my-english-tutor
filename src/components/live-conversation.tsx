'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowRight,
  AudioLines,
  Check,
  ChevronDown,
  Lightbulb,
  Mic,
  MicOff,
  Pause,
  RotateCcw,
  ShieldCheck,
  Square,
  Subtitles,
} from 'lucide-react';
import { GeminiVoiceProvider } from '@/lib/voice/gemini';
import type { VoiceProvider, VoiceState } from '@/lib/voice/provider';
import { api, type AppData, type PracticeSession } from '@/lib/data';
import { turnSchema, type Turn } from '@/lib/schema';

export function LiveConversation({
  id,
  data,
  refresh,
}: {
  id: string;
  data: AppData;
  refresh: () => Promise<void>;
}) {
  const router = useRouter();
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [state, setState] = useState<VoiceState>('idle');
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [muted, setMuted] = useState(false);
  const [captions, setCaptions] = useState(true);
  const [talking, setTalking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [level, setLevel] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [loading, setLoading] = useState(true);
  const [help, setHelp] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const provider = useRef<VoiceProvider | null>(null);
  const turnsRef = useRef<Turn[]>([]);
  const pending = useRef(new Map<string, Turn>());
  const saving = useRef<Promise<void> | null>(null);
  const ended = useRef(false);
  const unmounted = useRef(false);
  const hydrated = useRef(false);
  const key = `speakbetter:${data.user?.id}:${id}`;
  const saveLocal = useCallback(() => {
    try {
      if (!hydrated.current) return;
      if (ended.current) {
        sessionStorage.removeItem(key);
        return;
      }
      sessionStorage.setItem(key, JSON.stringify(turnsRef.current));
    } catch {
      /* Storage may be disabled; server autosave remains available. */
    }
  }, [key]);
  const save = useCallback(async () => {
    while (saving.current) await saving.current;
    if (!pending.current.size) return;
    const items = [...pending.current.values()].slice(0, 50);
    for (const t of items) pending.current.delete(t.id);
    const promise = api(`sessions/${id}/turns`, 'POST', items)
      .then(() => {
        if (!unmounted.current) setSaveError('');
      })
      .catch((e) => {
        for (const t of items) if (!pending.current.has(t.id)) pending.current.set(t.id, t);
        if (!unmounted.current)
          setSaveError(
            `Transcript sync paused: ${(e as Error).message} Your draft is retained in this tab.`,
          );
        throw e;
      });
    saving.current = promise;
    try {
      await promise;
    } finally {
      if (saving.current === promise) saving.current = null;
    }
  }, [id]);
  useEffect(() => {
    unmounted.current = false;
    let cancelled = false;
    async function load() {
      try {
        const result = await api<{ session: PracticeSession; turns: Turn[] }>(`sessions/${id}`);
        if (cancelled) return;
        setSession(result.session);
        if (result.session.status === 'ended') {
          router.replace(`/report/${id}`);
          return;
        }
        let recovered: Turn[] = [];
        try {
          recovered = turnSchema.array().parse(JSON.parse(sessionStorage.getItem(key) || '[]'));
        } catch {}
        const all = new Map(result.turns.map((t) => [t.id, t]));
        for (const t of recovered) {
          const old = all.get(t.id);
          if (!old || t.text.length > old.text.length) {
            all.set(t.id, t);
            pending.current.set(t.id, t);
          }
        }
        turnsRef.current = [...all.values()].sort((a, b) => a.sequence - b.sequence);
        hydrated.current = true;
        setTurns(turnsRef.current);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    const timer = setInterval(() => {
      if (!ended.current) void save().catch(() => {});
    }, 2000);
    const visibility = () => {
      if (document.visibilityState === 'hidden') saveLocal();
    };
    const signout = () => {
      ended.current = true;
      sessionStorage.removeItem(key);
      void provider.current?.stop();
    };
    window.addEventListener('speakbetter:signout', signout);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', saveLocal);
    return () => {
      cancelled = true;
      unmounted.current = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', saveLocal);
      window.removeEventListener('speakbetter:signout', signout);
      saveLocal();
      void provider.current?.stop();
    };
  }, [id, key, router, save, saveLocal]);
  useEffect(() => {
    if (!session) return;
    const tick = () =>
      setRemaining(
        Math.max(
          0,
          Math.ceil(
            (new Date(session.created_at).getTime() + session.duration * 60000 - Date.now()) / 1000,
          ),
        ),
      );
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [session]);
  async function start() {
    if (!session) return;
    setError('');
    setBusy(true);
    setMuted(false);
    setTalking(false);
    await provider.current?.stop();
    const instance = new GeminiVoiceProvider(
      id,
      session.input_mode === 'push-to-talk',
      turnsRef.current,
      {
        onState: (s) => {
          if (!unmounted.current) setState(s);
        },
        onError: (s) => {
          if (!unmounted.current) setError(s);
        },
        onLevel: (s) => {
          if (!unmounted.current) setLevel(s);
        },
        onTurn: (t) => {
          if (unmounted.current || ended.current) return;
          const all = new Map(turnsRef.current.map((x) => [x.id, x]));
          all.set(t.id, t);
          turnsRef.current = [...all.values()].sort((a, b) => a.sequence - b.sequence);
          pending.current.set(t.id, t);
          setTurns(turnsRef.current);
          saveLocal();
        },
      },
    );
    provider.current = instance;
    await instance.start();
    if (!unmounted.current) setBusy(false);
  }
  async function end() {
    setBusy(true);
    setError('');
    try {
      await provider.current?.stop();
      while (pending.current.size || saving.current) await save();
      await api(`sessions/${id}/end`, 'POST', {});
      ended.current = true;
      sessionStorage.removeItem(key);
      await refresh();
      router.push(`/report/${id}`);
    } catch (e) {
      setError(
        `Could not finish: ${(e as Error).message} Your transcript draft is retained. Please retry.`,
      );
      setBusy(false);
    }
  }
  const connected = !['idle', 'error', 'connecting', 'reconnecting'].includes(state);
  const push = session?.input_mode === 'push-to-talk';
  const labels: Record<VoiceState, string> = {
    idle: 'Your coach is ready when you are',
    connecting: 'Getting your coach ready…',
    listening: push && !talking ? 'Take your time. Press to speak.' : 'Listening. Take your time.',
    thinking: 'Your coach is thinking…',
    speaking: 'Your AI coach is speaking',
    reconnecting: 'Reconnecting your conversation…',
    error: 'Let’s get you connected again',
  };
  function press(value: boolean) {
    setTalking(value);
    provider.current?.setTalking(value);
  }
  if (loading)
    return (
      <div className="loading-state">
        <span className="spinner" />
        Preparing your conversation…
      </div>
    );
  if (!session)
    return (
      <div className="empty-state">
        <h2>We couldn’t open this conversation.</h2>
        <p role="alert">{error}</p>
        <Link href="/history" className="button secondary">
          Back to conversations
        </Link>
      </div>
    );
  return (
    <>
      <div className="live-top">
        <div>
          <div className="eyebrow">A LITTLE ROOM FOR YOUR VOICE</div>
          <h1>{session.topic}</h1>
          <p>
            {session.mode} · {session.difficulty} · {push ? 'Push-to-talk' : 'Hands-free'}
          </p>
        </div>
        <span className="session-timer">
          <span className="tiny-dot" />
          {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')} left
        </span>
      </div>
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      {saveError && (
        <div role="alert" className="alert">
          {saveError}
          <button className="text-link" onClick={() => save().catch(() => {})}>
            Retry sync
          </button>
        </div>
      )}
      <div className="live-layout">
        <section className={`live-stage ${state}`}>
          <div className="coach-label">
            <span className="tiny-dot" />
            SPEAKBETTER · YOUR AI COACH
          </div>
          <div className="live-orb-container" aria-hidden="true">
            <div className="live-ring ring-one" />
            <div className="live-ring ring-two" />
            <div className="live-orb" style={{ transform: `scale(${1 + level * 0.12})` }}>
              <AudioLines size={66} />
            </div>
          </div>
          <div className="live-status" role="status" aria-live="polite">
            <h2>{labels[state]}</h2>
            <p>
              {state === 'idle'
                ? 'A patient partner. No perfect sentences required.'
                : state === 'speaking'
                  ? 'You can interrupt whenever a thought comes to you.'
                  : state === 'reconnecting'
                    ? 'Your captured words stay safe while we reconnect.'
                    : push
                      ? 'Hold the microphone button to talk. Release when you’re ready.'
                      : 'Say what’s on your mind. Pauses are welcome here.'}
            </p>
          </div>
          <div className="voice-controls">
            <button
              className="control-button"
              title="Replay latest AI response"
              aria-label="Replay latest AI response"
              disabled={!connected}
              onClick={() => provider.current?.replay()}
            >
              <RotateCcw size={20} />
            </button>
            {connected ? (
              <button
                className={`mic-button ${muted ? 'muted' : ''} ${talking ? 'talking' : ''}`}
                aria-label={
                  push ? 'Hold to speak' : muted ? 'Unmute microphone' : 'Mute microphone'
                }
                aria-pressed={push ? talking : muted}
                onPointerDown={(e) => {
                  if (push) {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    press(true);
                  }
                }}
                onPointerUp={() => {
                  if (push) press(false);
                }}
                onPointerCancel={() => {
                  if (push) press(false);
                }}
                onKeyDown={(e) => {
                  if (push && (e.key === ' ' || e.key === 'Enter')) {
                    e.preventDefault();
                    if (!e.repeat) press(true);
                  }
                }}
                onKeyUp={(e) => {
                  if (push && (e.key === ' ' || e.key === 'Enter')) {
                    e.preventDefault();
                    press(false);
                  }
                }}
                onBlur={() => {
                  if (push) press(false);
                }}
                onClick={() => {
                  if (!push) {
                    provider.current?.setMuted(!muted);
                    setMuted(!muted);
                  }
                }}
              >
                {muted ? <MicOff size={30} /> : <Mic size={30} />}
              </button>
            ) : (
              <button
                className="mic-button"
                disabled={busy || remaining === 0}
                onClick={start}
                aria-label={state === 'error' ? 'Try microphone again' : 'Connect microphone'}
              >
                {busy ? <span className="spinner" /> : <Mic size={30} />}
              </button>
            )}
            <button
              className={`control-button ${captions ? 'enabled' : ''}`}
              title="Toggle captions"
              aria-label="Toggle live captions"
              aria-pressed={captions}
              onClick={() => setCaptions(!captions)}
            >
              <Subtitles size={22} />
            </button>
          </div>
          <span className="control-caption">
            {busy
              ? 'One moment…'
              : !connected
                ? 'Tap the microphone to begin'
                : push
                  ? 'Hold to speak · Space works too'
                  : muted
                    ? 'Microphone muted'
                    : 'Microphone on · Tap to mute'}
          </span>
          <div className="live-secondary-controls">
            {push && (
              <button
                className="text-link"
                disabled={!connected}
                onClick={() => {
                  provider.current?.setMuted(!muted);
                  setMuted(!muted);
                }}
              >
                {muted ? <Mic size={15} /> : <MicOff size={15} />} {muted ? 'Unmute' : 'Mute'}
              </button>
            )}
            <button
              className="text-link"
              disabled={!connected}
              onClick={() => provider.current?.interrupt()}
            >
              <Pause size={15} />
              Pause coach
            </button>
            <button className="text-link end-button" disabled={busy} onClick={end}>
              <Square size={12} />
              End & reflect
            </button>
          </div>
          <div className="live-privacy">
            <ShieldCheck size={14} />
            <span>Private transcript · No audio recordings saved</span>
          </div>
        </section>
        <aside className="live-aside">
          <section className="panel rescue-panel">
            <span className="eyebrow">
              <Lightbulb size={15} /> A LITTLE HELP, ANYTIME
            </span>
            <h3>Finding your words?</h3>
            <p>We’ve all been there. Your coach can help.</p>
            {[
              {
                label: 'Give me a hint',
                text: 'Give me a small hint to help me answer your last question.',
              },
              {
                label: 'Speak more slowly',
                text: 'Please speak more slowly and use shorter sentences.',
              },
              {
                label: 'Explain that',
                text: 'Please explain your last response in simpler language.',
              },
            ].map((h) => (
              <button
                key={h.label}
                className="rescue-button"
                disabled={!connected}
                onClick={() => provider.current?.sendText(h.text)}
              >
                {h.label}
                <ArrowRight size={15} />
              </button>
            ))}
            <button
              className="rescue-button"
              disabled={!connected}
              onClick={() => setShowHelp(!showHelp)}
            >
              Help me say this in English
              <ChevronDown size={15} />
            </button>
            {showHelp && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  provider.current?.sendText(`Help me express this in natural English: ${help}`);
                  setHelp('');
                  setShowHelp(false);
                }}
              >
                <label>
                  <span className="sr-only">What would you like to say?</span>
                  <textarea
                    value={help}
                    onChange={(e) => setHelp(e.target.value)}
                    placeholder="Use your own language…"
                    maxLength={500}
                  />
                </label>
                <button className="button secondary" disabled={!help.trim()}>
                  Help me find the words
                  <ArrowRight size={14} />
                </button>
              </form>
            )}
          </section>
          {captions && (
            <section className="panel live-captions">
              <div className="section-heading">
                <h3>Our conversation</h3>
                <span className="live-caption-label">
                  <span className="tiny-dot" />
                  Live captions
                </span>
              </div>
              <div
                className="caption-scroll"
                aria-label="Conversation captions"
                role="log"
                aria-live="off"
              >
                {turns.length ? (
                  turns.map((t) => (
                    <div className={`caption-turn ${t.role}`} key={t.id}>
                      <small>{t.role === 'user' ? 'YOU' : 'AI COACH'}</small>
                      <p>{t.text}</p>
                    </div>
                  ))
                ) : (
                  <p className="caption-placeholder">
                    Your words will appear here as the conversation unfolds. Captions can contain
                    transcription errors.
                  </p>
                )}
              </div>
              <div className="caption-sync">
                <Check size={13} />{' '}
                {saveError ? 'Draft retained in this tab' : 'Transcript syncs every 2 seconds'}
              </div>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}

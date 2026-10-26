'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  AudioLines,
  BookOpen,
  BriefcaseBusiness,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Clock,
  Coffee,
  Flame,
  Globe2,
  GraduationCap,
  Headphones,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  MessagesSquare,
  Mic,
  Plus,
  Presentation,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  User,
  X,
  type LucideIcon,
} from 'lucide-react';
import { browserDb, isConfigured } from '@/lib/supabase/client';
import { defaultProfile, type Profile, type Report, type Turn } from '@/lib/schema';
import {
  api,
  demoReport,
  demoTurns,
  emptyData,
  modes,
  sessionMinutes,
  type AppData,
  type PracticeSession,
  type Exercise,
  type Vocabulary,
} from '@/lib/data';
import { LiveConversation } from './live-conversation';
import { HotTopics } from './hot-topics';
import { PracticeReminder } from './practice-reminder';
import { WritingChatPage } from './writing-chat';
import { PersonalDictionaryPage } from './personal-dictionary';
import { disconnectReminderBrowser } from '@/lib/reminders';

const icons: Record<string, LucideIcon> = {
  messages: MessagesSquare,
  coffee: Coffee,
  briefcase: BriefcaseBusiness,
  globe: Globe2,
  user: User,
  book: BookOpen,
  presentation: Presentation,
  sparkles: Sparkles,
};
const navigation = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/practice', label: 'Start practicing', icon: AudioLines },
  { href: '/chat', label: 'Writing chat', icon: MessagesSquare },
  { href: '/dictionary', label: 'My dictionary', icon: BookOpen },
  { href: '/history', label: 'Conversations', icon: MessageCircle },
  { href: '/learn', label: 'My learning', icon: BookOpen },
  { href: '/progress', label: 'My progress', icon: TrendingUp },
];
function Brand() {
  return (
    <Link className="brand" href="/">
      <span className="brand-mark">
        <AudioLines size={23} />
      </span>
      SpeakBetter<span className="brand-dot">.</span>
    </Link>
  );
}
function IconBox({ icon: Icon, color = 'mint' }: { icon: LucideIcon; color?: string }) {
  return (
    <span className={`icon-box ${color}`}>
      <Icon size={23} strokeWidth={1.6} />
    </span>
  );
}
function Pill({ children }: { children: ReactNode }) {
  return <span className="pill">{children}</span>;
}
function Orb({ small = false }: { small?: boolean }) {
  return (
    <div className={`orb-scene ${small ? 'small' : ''}`} aria-hidden="true">
      <div className="orbit orbit-one" />
      <div className="orbit orbit-two" />
      <div className="orb">
        <AudioLines />
      </div>
      {!small && (
        <>
          <div className="floating-note note-one">
            <span className="tiny-dot" />A safe space to speak
          </div>
          <div className="floating-note note-two">
            <AudioLines size={17} />
            Your voice. More confident.
          </div>
          <span className="sparkle sp-one">✦</span>
          <span className="sparkle sp-two">✧</span>
        </>
      )}
    </div>
  );
}
function Empty({
  icon: Icon = MessageCircle,
  title,
  children,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Icon size={34} />
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function SpeakBetter() {
  const pathname = usePathname();
  const router = useRouter();
  const [data, setData] = useState<AppData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState(false);
  const refresh = useCallback(async () => {
    if (!isConfigured()) {
      setLoading(false);
      return;
    }
    try {
      setData(await api<AppData>('bootstrap'));
    } catch (e) {
      if (e instanceof Error && e.message !== 'Sign in to continue.') setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    setMenu(false);
    setError('');
  }, [pathname]);
  const demo = !data.user;
  const profile = data.profile ?? defaultProfile;
  const name = demo ? 'there' : profile.name.split(' ')[0];
  async function signOut() {
    await disconnectReminderBrowser().catch(() => {});
    await browserDb().auth.signOut();
    window.dispatchEvent(new Event('speakbetter:signout'));
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith('speakbetter:')) sessionStorage.removeItem(key);
    }
    setData(emptyData);
    router.push('/signin');
  }
  const standalone = ['/signin', '/onboarding', '/welcome'].includes(pathname);
  if (standalone)
    return (
      <div className="standalone">
        <header className="standalone-header">
          <Brand />
          <Link className="text-link" href="/">
            Explore the app <ArrowRight size={16} />
          </Link>
        </header>
        {pathname === '/signin' ? (
          <SignIn />
        ) : pathname === '/onboarding' ? (
          <Onboarding data={data} refresh={refresh} />
        ) : (
          <Welcome />
        )}
      </div>
    );
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      {menu && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        />
      )}
      <aside id="main-navigation" className={`sidebar ${menu ? 'open' : ''}`}>
        <Brand />
        <div className="workspace-label">YOUR PRACTICE, YOUR PACE</div>
        <nav aria-label="Main navigation">
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`nav-link ${(href === '/' ? pathname === '/' || pathname === '/dashboard' : pathname.startsWith(href)) ? 'active' : ''}`}
              aria-current={
                (href === '/' ? pathname === '/' : pathname.startsWith(href)) ? 'page' : undefined
              }
            >
              <Icon size={20} />
              {label}
              {href === '/practice' && (
                <span className="nav-plus">
                  <Plus size={14} />
                </span>
              )}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-encouragement">
            <span className="mini-spark">
              <Sparkles size={18} />
            </span>
            <h4>
              A little every day
              <br />
              goes a long way.
            </h4>
            <p>Your next breakthrough starts with a conversation.</p>
            <Link href="/practice">
              Let’s practice <ArrowRight size={15} />
            </Link>
          </div>
          <Link className={`nav-link ${pathname === '/settings' ? 'active' : ''}`} href="/settings">
            <Settings size={20} />
            Settings
          </Link>
          <div className="sidebar-profile">
            <span className="avatar">{demo ? 'Y' : profile.name.slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>{demo ? 'Your learning journey' : profile.name}</strong>
              <small>
                {demo ? 'Make yourself at home' : `${profile.level} · ${profile.style} coaching`}
              </small>
            </div>
            {demo ? (
              <Link href="/signin" aria-label="Sign in">
                <ChevronRight size={19} />
              </Link>
            ) : (
              <button onClick={signOut} className="icon-button" aria-label="Sign out">
                <LogOut size={17} />
              </button>
            )}
          </div>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMenu(true)}
              aria-label="Open navigation"
              aria-expanded={menu}
              aria-controls="main-navigation"
            >
              <Menu />
            </button>
            <span className="breadcrumb">
              My workspace <ChevronRight size={13} />
              <strong>
                {pathname === '/'
                  ? 'Overview'
                  : pathname.split('/')[1].replace(/^./, (c) => c.toUpperCase())}
              </strong>
            </span>
          </div>
          <div className="topbar-right">
            <span className="daily-target">
              <Target size={17} />
              <strong>{profile.daily_target} min</strong> daily goal
            </span>
            <span className="topbar-divider" />
            <Link
              href={demo ? '/signin' : '/settings'}
              className="avatar small-avatar"
              aria-label={demo ? 'Sign in' : 'Your profile'}
            >
              {demo ? 'Y' : profile.name.slice(0, 1).toUpperCase()}
            </Link>
          </div>
        </header>
        <main id="main" className="main-content">
          {demo && (
            <div className="demo-banner">
              <span>
                <span className="demo-tag">PREVIEW</span> You’re exploring a sample workspace. Sign
                in to make it yours.
              </span>
              <Link href="/signin">
                Get started <ArrowRight size={14} />
              </Link>
            </div>
          )}
          {error && (
            <div role="alert" className="alert">
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError('')}>
                <X size={18} />
              </button>
            </div>
          )}
          {loading ? (
            <div className="loading-state">
              <span className="spinner" />
              Getting your space ready…
            </div>
          ) : (
            <>
              {(pathname === '/' || pathname === '/dashboard') && (
                <Dashboard data={data} demo={demo} name={name} />
              )}
              {pathname === '/practice' && <Practice data={data} onError={setError} />}
              {pathname === '/dictionary' && (
                <PersonalDictionaryPage key={data.user?.id || 'guest'} data={data} />
              )}
              {(pathname === '/chat' || pathname.startsWith('/chat/')) && (
                <WritingChatPage
                  key={`${pathname}:${data.user?.id || 'guest'}`}
                  id={pathname.split('/')[2]}
                  data={data}
                />
              )}
              {pathname.startsWith('/practice/') && (
                <LiveConversation
                  key={pathname}
                  id={pathname.split('/')[2]}
                  data={data}
                  refresh={refresh}
                />
              )}
              {pathname === '/history' && (
                <History data={data} refresh={refresh} onError={setError} />
              )}
              {pathname.startsWith('/report/') && (
                <SessionReport key={pathname} id={pathname.split('/')[2]} refresh={refresh} />
              )}
              {pathname === '/learn' && (
                <Learning data={data} demo={demo} refresh={refresh} onError={setError} />
              )}
              {pathname === '/progress' && <Progress data={data} demo={demo} />}
              {pathname === '/settings' && (
                <SettingsPage data={data} refresh={refresh} onError={setError} />
              )}
              {![
                '/',
                '/dashboard',
                '/practice',
                '/chat',
                '/dictionary',
                '/history',
                '/learn',
                '/progress',
                '/settings',
              ].includes(pathname) &&
                !pathname.startsWith('/practice/') &&
                !pathname.startsWith('/chat/') &&
                !pathname.startsWith('/report/') && (
                  <Empty title="Let’s find your way back">
                    This page doesn’t exist.<Link href="/">Back to overview</Link>
                  </Empty>
                )}
            </>
          )}
          <footer className="page-footer">
            <span>
              <AudioLines size={13} /> A little practice. A more confident you.
            </span>
            <span>Made for your real-world voice.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}

function Dashboard({ data, demo, name }: { data: AppData; demo: boolean; name: string }) {
  const total = data.sessions.reduce((n, s) => n + sessionMinutes(s), 0);
  const completed = data.sessions.filter((s) => s.status === 'ended');
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ONE CONVERSATION CLOSER</div>
          <h1>
            Hello, {name}
            <span className="greeting-dot">.</span> Let’s find your voice.
          </h1>
          <p>You don’t need perfect English. You just need a place to practice.</p>
        </div>
        <span className="today-label">
          <span className="tiny-dot" />
          Your time to grow
        </span>
      </div>
      <section className="hero-card">
        <div className="hero-copy">
          <span className="hero-kicker">
            <span className="tiny-dot" /> YOUR AI ENGLISH COACH
          </span>
          <h2>
            Less overthinking.
            <br />
            More <em>speaking.</em>
          </h2>
          <p>
            A real conversation. A patient partner.
            <br />A little more confidence, every single day.
          </p>
          <Link href="/practice" className="button primary">
            Start a conversation <ArrowRight size={18} />
          </Link>
          <span className="hero-footnote">
            <Headphones size={14} /> Just you and your AI coach. No judgment.
          </span>
        </div>
        <Orb />
      </section>
      <div className="stats-grid">
        <Stat
          icon={Clock}
          color="mint"
          value={demo ? '128' : String(total)}
          unit="min"
          label="Time well spoken"
          note={demo ? 'Sample practice time' : 'Your total practice time'}
        />
        <Stat
          icon={MessagesSquare}
          color="lavender"
          value={demo ? '12' : String(completed.length)}
          label="Conversations started"
          note="Every conversation is a step forward"
        />
        <Stat
          icon={BookOpen}
          color="peach"
          value={demo ? '24' : String(data.vocabulary.length)}
          label="Phrases to make yours"
          note="A growing collection of useful words"
        />
        <Stat
          icon={Flame}
          color="cream"
          value={demo ? '5' : String(practiceStreak(data.sessions))}
          unit="days"
          label="Showing up for yourself"
          note={demo ? 'Sample practice streak' : 'Consecutive days of practice'}
        />
      </div>
      <section className="practice-section">
        <div className="section-heading">
          <div>
            <h2>What would you like to talk about?</h2>
            <p>Real-life conversations for the moments that matter.</p>
          </div>
          <Link href="/practice" className="text-link">
            Explore all topics <ArrowRight size={16} />
          </Link>
        </div>
        <div className="mode-grid">
          {modes.slice(0, 4).map((mode) => {
            const Icon = icons[mode.icon];
            return (
              <Link href={`/practice?mode=${mode.id}`} className="mode-card" key={mode.id}>
                <IconBox icon={Icon} color={mode.color} />
                <h3>{mode.name}</h3>
                <p>{mode.description}</p>
                <span className="mode-footer">
                  Let’s talk <ArrowRight size={15} />
                </span>
              </Link>
            );
          })}
        </div>
      </section>
      <div className="dashboard-bottom">
        <section className="panel week-panel">
          <div className="section-heading">
            <div>
              <h2>Little by little, you’re growing.</h2>
              <p>Your practice this week</p>
            </div>
            <Pill>
              <Activity size={13} />
              This week
            </Pill>
          </div>
          <WeekChart sessions={data.sessions} demo={demo} />
          <div className="chart-caption">
            <span className="tiny-dot" />
            Consistency matters more than perfection.
          </div>
        </section>
        <section className="panel continue-panel">
          <span className="eyebrow">
            <Sparkles size={14} /> YOUR NEXT SMALL STEP
          </span>
          <div className="next-step-icon">
            <BookOpen size={28} />
          </div>
          <h2>
            Good conversations
            <br />
            deserve a second look.
          </h2>
          <p>Turn your “I wish I’d said…” moments into phrases you’ll use next time.</p>
          <Link
            href={
              demo
                ? '/report/demo'
                : data.sessions.find((s) => s.report_status === 'ready')
                  ? `/report/${data.sessions.find((s) => s.report_status === 'ready')!.id}`
                  : '/learn'
            }
            className="text-link"
          >
            {demo ? 'Explore a sample report' : 'Continue your learning'} <ArrowRight size={16} />
          </Link>
        </section>
      </div>
    </>
  );
}
function Stat({
  icon,
  color,
  value,
  unit,
  label,
  note,
}: {
  icon: LucideIcon;
  color: string;
  value: string;
  unit?: string;
  label: string;
  note: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-top">
        <IconBox icon={icon} color={color} />
        <span className="stat-value">
          {value}
          <small>{unit}</small>
        </span>
      </div>
      <h3>{label}</h3>
      <p>{note}</p>
    </div>
  );
}
function practiceStreak(sessions: PracticeSession[]) {
  const days = new Set(
    sessions
      .filter((s) => s.status === 'ended')
      .map((s) => new Date(s.created_at).toLocaleDateString('en-CA')),
  );
  let streak = 0;
  const date = new Date();
  if (!days.has(date.toLocaleDateString('en-CA'))) date.setDate(date.getDate() - 1);
  while (days.has(date.toLocaleDateString('en-CA'))) {
    streak++;
    date.setDate(date.getDate() - 1);
  }
  return streak;
}
function WeekChart({ sessions, demo }: { sessions: PracticeSession[]; demo: boolean }) {
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - 6 + i);
    return d;
  });
  const values = demo
    ? [12, 18, 0, 24, 15, 20, 10]
    : dates.map((d) =>
        sessions
          .filter((s) => new Date(s.created_at).toDateString() === d.toDateString())
          .reduce((n, s) => n + sessionMinutes(s), 0),
      );
  const max = Math.max(30, ...values);
  return (
    <div
      className="week-chart"
      role="img"
      aria-label={`${demo ? 'Sample ' : ''}Practice minutes for the last seven days: ${values.join(', ')}`}
    >
      <div className="chart-y">
        <span>{max} min</span>
        <span>{Math.round(max / 2)}</span>
        <span>0</span>
      </div>
      <div className="chart-columns">
        {dates.map((d, i) => (
          <div className="chart-column" key={i}>
            <div className="bar-track">
              <div
                className={`chart-bar ${i === 6 ? 'current' : ''}`}
                style={{ height: `${Math.max(2, (values[i] / max) * 100)}%` }}
              >
                <span>{values[i]} min</span>
              </div>
            </div>
            <span>{d.toLocaleDateString('en-US', { weekday: 'short' })}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Practice({ data, onError }: { data: AppData; onError: (s: string) => void }) {
  const search = useSearchParams();
  const router = useRouter();
  const topicInput = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState(search.get('mode') || 'free');
  const [topic, setTopic] = useState(
    search.get('topic') ||
      (search.get('assessment') === '1'
        ? 'A short introductory speaking assessment: get to know me, my routine, and my goals. Any level guidance must be informal.'
        : ''),
  );
  const [duration, setDuration] = useState(search.get('assessment') === '1' ? 3 : 10);
  const [difficulty, setDifficulty] = useState('A little stretch');
  const [inputMode, setInputMode] = useState('hands-free');
  const [busy, setBusy] = useState(false);
  const selected = modes.find((m) => m.id === mode) ?? modes[0];
  async function start() {
    if (!data.user) {
      router.push('/signin');
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ id: string }>('sessions', 'POST', {
        topic: topic || selected.topic,
        mode: selected.name,
        duration,
        difficulty,
        input_mode: inputMode,
      });
      router.push(`/practice/${result.id}`);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="MAKE ROOM FOR YOUR VOICE"
        title="A conversation for every kind of day."
        description="Pick a starting point. Your AI coach will take it from there."
      />
      <HotTopics
        activeTopic={topic}
        onSelect={(item) => {
          setMode('custom');
          setTopic(item.practiceTopic);
          topicInput.current?.focus();
        }}
      />
      <Link className="writing-entry panel" href="/chat">
        <MessagesSquare size={23} />
        <div>
          <strong>Prefer to write? Chat with your AI tutor.</strong>
          <p>The tutor starts the conversation. Get highlighted corrections when you finish.</p>
        </div>
        <ArrowRight size={18} />
      </Link>
      <div className="practice-layout">
        <div className="mode-picker">
          {modes.map((m) => {
            const Icon = icons[m.icon];
            return (
              <button
                className={`mode-option ${mode === m.id ? 'selected' : ''}`}
                key={m.id}
                onClick={() => {
                  setMode(m.id);
                  setTopic('');
                }}
                aria-pressed={mode === m.id}
              >
                <IconBox icon={Icon} color={m.color} />
                <div>
                  <h3>{m.name}</h3>
                  <p>{m.description}</p>
                </div>
                <span className="radio-circle">{mode === m.id && <span />}</span>
              </button>
            );
          })}
        </div>
        <section className="panel session-setup">
          <div className="eyebrow">YOUR PRACTICE, YOUR WAY</div>
          <h2>Let’s set the scene.</h2>
          <label>
            What’s on your mind?
            <textarea
              ref={topicInput}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              maxLength={240}
              placeholder={selected.topic || 'e.g. Ordering lunch at a cafe in London'}
            />
          </label>
          <label>
            Make a little time
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              <option value={3}>3 minutes · A quick introduction</option>
              <option value={5}>5 minutes · A small step</option>
              <option value={10}>10 minutes · Find your flow</option>
              <option value={15}>15 minutes · Go a little deeper</option>
              <option value={20}>20 minutes · Settle into it</option>
            </select>
          </label>
          <label>
            Your comfort zone
            <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
              {['Comfortable', 'A little stretch', 'Challenge me'].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            How would you like to speak?
            <select value={inputMode} onChange={(e) => setInputMode(e.target.value)}>
              <option value="hands-free">Hands-free · Mic stays on (recommended)</option>
              <option value="push-to-talk">Push-to-talk · Hold the button for each turn</option>
            </select>
          </label>
          <p className="writing-note">
            Hands-free lets you start the microphone once and talk naturally. The coach detects when
            you finish and listens again after replying.
          </p>
          <div className="privacy-note">
            <ShieldCheck size={18} />
            <p>
              Your microphone audio is sent live to Google Gemini. Your transcript and report are
              saved privately in Supabase. Audio recordings are never retained by SpeakBetter.
            </p>
          </div>
          <button
            className="button primary full-width"
            disabled={busy || (mode === 'custom' && topic.trim().length < 2)}
            onClick={start}
          >
            {busy ? <span className="spinner" /> : <Mic size={18} />}{' '}
            {busy ? 'Preparing your conversation…' : 'Let’s start talking'}{' '}
            {!busy && <ArrowRight size={17} />}
          </button>
          <span className="setup-note">
            AI feedback is learning guidance, not an official assessment.
          </span>
        </section>
      </div>
    </>
  );
}
function PageHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </div>
  );
}

function History({
  data,
  refresh,
  onError,
}: {
  data: AppData;
  refresh: () => Promise<void>;
  onError: (s: string) => void;
}) {
  const [filter, setFilter] = useState('');
  async function remove(id: string) {
    if (!window.confirm('Delete this session, its transcript, report, vocabulary, and exercises?'))
      return;
    try {
      await api(`sessions/${id}`, 'DELETE');
      await refresh();
    } catch (e) {
      onError((e as Error).message);
    }
  }
  const sessions = data.sessions.filter((s) =>
    s.topic.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <>
      <PageHeading
        eyebrow="EVERY CONVERSATION COUNTS"
        title="Look how far your voice has taken you."
        description="Your conversations, reflections, and moments of progress — all in one place."
      />
      <div className="section-heading">
        <label className="search-label">
          <span className="sr-only">Search conversations</span>
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Find a conversation…"
          />
        </label>
        <Link href="/practice" className="button primary">
          <Plus size={16} />
          New conversation
        </Link>
      </div>
      {sessions.length ? (
        <div className="session-list">
          {sessions.map((s) => (
            <div key={s.id} className="session-row">
              <IconBox icon={MessagesSquare} />
              <div className="session-info">
                <h3>
                  <Link href={`/report/${s.id}`}>{s.topic}</Link>
                </h3>
                <p>
                  {new Date(s.created_at).toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}{' '}
                  · {s.mode} · {s.status === 'active' ? 'Unfinished' : `${sessionMinutes(s)} min`}
                </p>
              </div>
              <Pill>
                {s.report_status === 'ready'
                  ? 'Reflection ready'
                  : s.status === 'active'
                    ? 'In progress'
                    : s.report_status === 'failed'
                      ? 'Report needs retry'
                      : 'Awaiting reflection'}
              </Pill>
              <Link href={`/report/${s.id}`} className="icon-button" aria-label={`View ${s.topic}`}>
                <ArrowRight size={19} />
              </Link>
              <button
                className="icon-button"
                aria-label={`Delete ${s.topic}`}
                onClick={() => remove(s.id)}
              >
                <X size={17} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <Empty title={filter ? 'No matching conversations' : 'Your first conversation is waiting'}>
          Make a little time for your voice. Your saved sessions will appear here.
          <Link className="button secondary" href="/practice">
            Start practicing <ArrowRight size={16} />
          </Link>
        </Empty>
      )}
      {!data.user && (
        <Link className="sample-report-link" href="/report/demo">
          <BookOpen size={20} />
          <div>
            <strong>See what a reflection looks like</strong>
            <p>Explore a clearly labeled sample conversation report.</p>
          </div>
          <ArrowRight size={18} />
        </Link>
      )}
    </>
  );
}

function SessionReport({ id, refresh }: { id: string; refresh: () => Promise<void> }) {
  const autoRequested = useRef(false);
  const demo = id === 'demo';
  const [report, setReport] = useState<Report | null>(demo ? demoReport : null);
  const [turns, setTurns] = useState<Turn[]>(demo ? demoTurns : []);
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (demo) return;
    try {
      const result = await api<{ session: PracticeSession; turns: Turn[]; report: Report | null }>(
        `sessions/${id}`,
      );
      setSession(result.session);
      setTurns(result.turns);
      setReport(result.report);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id, demo]);
  useEffect(() => {
    void load();
  }, [load]);
  async function generate() {
    setBusy(true);
    setError('');
    try {
      if (session?.status === 'active') await api(`sessions/${id}/end`, 'POST', {});
      const r = await api<Report>(`sessions/${id}/report`, 'POST', {});
      setReport(r);
      await refresh();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (
      !demo &&
      session?.status === 'ended' &&
      session.report_status === 'pending' &&
      !report &&
      !autoRequested.current
    ) {
      autoRequested.current = true;
      void generate();
    }
  }, [demo, session, report]);
  if (loading)
    return (
      <div className="loading-state">
        <span className="spinner" />
        Opening your reflection…
      </div>
    );
  return (
    <>
      <div className="report-top">
        <Link href="/history" className="text-link">
          ← Your conversations
        </Link>
        {demo && <Pill>Sample report · Fictional conversation</Pill>}
      </div>
      <PageHeading
        eyebrow="PROGRESS STARTS WITH A LITTLE REFLECTION"
        title={session?.topic || 'A morning, a cafe, a conversation.'}
        description={
          demo
            ? 'A sample of the feedback you’ll get after speaking.'
            : `${session?.mode || 'Conversation'} · ${session ? sessionMinutes(session) : 0} minutes · Private to you`
        }
      />
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      {!report ? (
        <section className="panel report-pending">
          <Orb small />
          <h2>
            {session?.status === 'active'
              ? 'Ready to wrap up?'
              : 'Your words deserve a second look.'}
          </h2>
          <p>
            {turns.length
              ? 'Your transcript is saved. Generate a reflection grounded in what you actually said.'
              : 'No transcript has been captured yet. Start a conversation to get personalized feedback.'}
          </p>
          <button
            className="button primary"
            disabled={busy || !turns.some((t) => t.role === 'user')}
            onClick={generate}
          >
            {busy ? <span className="spinner" /> : <Sparkles size={17} />}{' '}
            {busy
              ? 'Reflecting on your conversation…'
              : session?.status === 'active'
                ? 'End session & generate report'
                : 'Generate or retry report'}
          </button>
          {session?.status === 'active' && (
            <>
              <Link className="text-link" href={`/practice/${id}`}>
                Return to practice <ArrowRight size={16} />
              </Link>
              <button
                className="button secondary"
                onClick={async () => {
                  try {
                    await api(`sessions/${id}/end`, 'POST', {});
                    await load();
                    await refresh();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                End without a report
              </button>
            </>
          )}
        </section>
      ) : (
        <div className="report-layout">
          <div className="report-main">
            <section className="panel report-summary">
              <span className="eyebrow">
                <Sparkles size={14} /> A MOMENT TO NOTICE YOUR PROGRESS
              </span>
              <h2>You made yourself understood.</h2>
              <p>{report.summary}</p>
              <div className="report-two-col">
                <div>
                  <h3>
                    <CheckCheck size={18} />
                    What worked well
                  </h3>
                  {[...report.successes, ...report.strengths].map((s, i) => (
                    <p className="check-item" key={i}>
                      <Check size={15} />
                      {s}
                    </p>
                  ))}
                </div>
                <div>
                  <h3>
                    <Target size={18} />
                    Your next small steps
                  </h3>
                  {report.priorities.map((p, i) => (
                    <p className="number-item" key={i}>
                      <span>{i + 1}</span>
                      {p}
                    </p>
                  ))}
                </div>
              </div>
            </section>
            <section className="panel">
              <h2>A little more clarity</h2>
              <p className="section-description">Useful grammar feedback, in your own words.</p>
              {report.grammar.length ? (
                report.grammar.map((g, i) => (
                  <details className="feedback-detail" key={i} open={i === 0}>
                    <summary>
                      <span>{g.corrected}</span>
                      <ChevronDown size={17} />
                    </summary>
                    <div className="feedback-body">
                      <span className="quote-label">
                        YOU SAID · TURN{' '}
                        {turns.find((t) => t.id === g.turnId)?.sequence !== undefined
                          ? turns.find((t) => t.id === g.turnId)!.sequence + 1
                          : '—'}
                      </span>
                      <blockquote>{g.original}</blockquote>
                      <span className="quote-label corrected">TRY THIS</span>
                      <blockquote className="corrected-quote">{g.corrected}</blockquote>
                      <p>{g.explanation}</p>
                      <div className="example">
                        <strong>Another example</strong>
                        <p>{g.example}</p>
                      </div>
                    </div>
                  </details>
                ))
              ) : (
                <p>No meaningful grammar corrections were identified in this session.</p>
              )}
            </section>
            <section className="panel">
              <h2>Make it sound like you</h2>
              <p className="section-description">
                Natural alternatives. Optional improvements are labeled.
              </p>
              {report.expressions.map((e, i) => (
                <div key={i} className="expression">
                  <Pill>{e.kind === 'optional' ? 'Optional improvement' : 'Correction'}</Pill>
                  <p>{e.original}</p>
                  <strong>
                    <ArrowDownLeft size={17} />
                    {e.alternative}
                  </strong>
                </div>
              ))}
            </section>
            <section className="panel">
              <h2>Words to take with you</h2>
              <div className="vocab-report-grid">
                {report.vocabulary.map((v, i) => (
                  <div key={i} className="vocab-report">
                    <h3>{v.phrase}</h3>
                    <p>{v.meaning}</p>
                    <em>“{v.example}”</em>
                    <p className="vocab-prompt">Try it: {v.prompt}</p>
                  </div>
                ))}
              </div>
            </section>
            <details className="panel transcript-panel">
              <summary>
                <span>
                  <MessagesSquare size={19} />
                  Your conversation transcript
                </span>
                <ChevronDown size={18} />
              </summary>
              <div className="transcript">
                {turns.map((t) => (
                  <div key={t.id} className={`transcript-turn ${t.role}`}>
                    <small>
                      {t.role === 'user' ? 'YOU' : 'AI COACH'} · TURN {t.sequence + 1}
                    </small>
                    <p>{t.text}</p>
                  </div>
                ))}
              </div>
            </details>
          </div>
          <aside className="report-aside">
            <section className="panel next-practice">
              <IconBox icon={GraduationCap} />
              <h2>Let’s make it stick.</h2>
              <p>Small exercises, inspired by this conversation.</p>
              {report.exercises.map((e, i) => (
                <div key={i} className="report-exercise">
                  <span>{i + 1}</span>
                  <p>{e.prompt}</p>
                </div>
              ))}
              <Link className="button primary full-width" href="/learn">
                Practice these moments <ArrowRight size={16} />
              </Link>
            </section>
            <section className="panel">
              <h3>Your little practice plan</h3>
              <p>{report.plan}</p>
              <h3>Next time, talk about…</h3>
              <p>{report.nextTopic}</p>
              <Link
                className="text-link"
                href={`/practice?mode=custom&topic=${encodeURIComponent(report.nextTopic)}`}
              >
                Keep the conversation going <ArrowRight size={16} />
              </Link>
            </section>
            <section className="panel evidence-note">
              <ShieldCheck size={20} />
              <h3>Honest, useful feedback</h3>
              <p>
                <strong>Speaking delivery: unavailable.</strong> Word-level speech timing was not
                captured. No rate, pause, or filler measurements are estimated.
              </p>
              <p>
                <strong>Pronunciation: unavailable.</strong> This report analyzes text. Reliable
                audio-based pronunciation assessment requires an optional specialist service.
              </p>
              <p>
                Your regional accent is part of your voice. Our focus is effective communication.
              </p>
            </section>
          </aside>
        </div>
      )}
    </>
  );
}

function Learning({
  data,
  demo,
  refresh,
  onError,
}: {
  data: AppData;
  demo: boolean;
  refresh: () => Promise<void>;
  onError: (s: string) => void;
}) {
  const [tab, setTab] = useState('exercises');
  const [demoDone, setDemoDone] = useState<string[]>([]);
  const exercises = demo
    ? demoReport.exercises.map((e, i) => ({
        ...e,
        id: `demo-${i}`,
        session_id: 'demo',
        completed: demoDone.includes(`demo-${i}`),
      }))
    : data.exercises;
  const vocabulary = demo
    ? demoReport.vocabulary.map((v, i) => ({
        ...v,
        id: `demo-v-${i}`,
        session_id: 'demo',
        reviewed: demoDone.includes(`demo-v-${i}`),
      }))
    : data.vocabulary;
  async function complete(kind: string, id: string, done: boolean) {
    if (demo) {
      setDemoDone((prev) => (done ? [...prev, id] : prev.filter((x) => x !== id)));
      return;
    }
    try {
      await api(`${kind}/${id}`, 'PATCH', { done });
      await refresh();
    } catch (e) {
      onError((e as Error).message);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="A LITTLE PRACTICE, A LITTLE MORE YOU"
        title="Turn good intentions into familiar words."
        description="Personalized exercises and useful phrases from your conversations."
      />
      {demo && (
        <p className="sample-caption">
          Sample exercises based on the fictional cafe conversation. Preview activity is not saved.
        </p>
      )}
      <div className="tabs" role="tablist" aria-label="Learning collections">
        <button role="tab" aria-selected={tab === 'exercises'} onClick={() => setTab('exercises')}>
          Your exercises <span>{exercises.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === 'vocabulary'}
          onClick={() => setTab('vocabulary')}
        >
          Saved phrases <span>{vocabulary.length}</span>
        </button>
      </div>
      {tab === 'exercises' ? (
        <div className="learning-grid">
          {exercises.length ? (
            exercises.map((e) => (
              <ExerciseCard
                key={e.id}
                exercise={e}
                onComplete={(done) => complete('exercises', e.id, done)}
              />
            ))
          ) : (
            <Empty icon={GraduationCap} title="Your next conversation will plant a seed">
              Your coach will turn useful corrections into focused exercises.
            </Empty>
          )}
        </div>
      ) : (
        <div className="learning-grid">
          {vocabulary.length ? (
            vocabulary.map((v) => (
              <VocabularyCard
                key={v.id}
                item={v}
                onReview={(done) => complete('vocabulary', v.id, done)}
              />
            ))
          ) : (
            <Empty icon={BookOpen} title="A collection that grows with you">
              Useful phrases will be saved here after your conversations.
            </Empty>
          )}
        </div>
      )}
    </>
  );
}
function ExerciseCard({
  exercise: e,
  onComplete,
}: {
  exercise: Exercise;
  onComplete: (done: boolean) => Promise<void>;
}) {
  const [answer, setAnswer] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <section className={`panel exercise-card ${e.completed ? 'completed' : ''}`}>
      <div className="section-heading">
        <Pill>{e.type.replaceAll('-', ' ')}</Pill>
        {e.completed && <CheckCheck size={19} />}
      </div>
      <h3>{e.prompt}</h3>
      {e.type === 'say-again' ? (
        <p>
          Read your corrected sentence aloud. This exercise is self-guided; audio is not recorded or
          scored.
        </p>
      ) : (
        <label>
          <span className="sr-only">Your answer</span>
          <textarea
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder="Make it your own…"
          />
        </label>
      )}
      {reveal && (
        <div className="answer-box">
          <small>{e.type === 'follow-up' ? 'ONE POSSIBLE ANSWER' : 'SUGGESTED ANSWER'}</small>
          <p>{e.answer}</p>
        </div>
      )}
      <div className="exercise-actions">
        <button className="text-link" onClick={() => setReveal(!reveal)}>
          {reveal ? 'Hide answer' : 'Show answer'}
          <ChevronDown size={15} />
        </button>
        <button
          className="button secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onComplete(!e.completed);
            } finally {
              setBusy(false);
            }
          }}
        >
          {e.completed ? 'Practice again' : 'I practiced this'}
          <Check size={16} />
        </button>
      </div>
    </section>
  );
}
function VocabularyCard({
  item: v,
  onReview,
}: {
  item: Vocabulary;
  onReview: (done: boolean) => Promise<void>;
}) {
  const [reveal, setReveal] = useState(false);
  return (
    <section className="panel vocabulary-card">
      <div className="section-heading">
        <IconBox icon={BookOpen} color="peach" />
        {v.reviewed && <Pill>Reviewed</Pill>}
      </div>
      <h2>{v.phrase}</h2>
      <button className="text-link" onClick={() => setReveal(!reveal)}>
        {reveal ? 'Hide meaning' : 'Recall the meaning'}
        <ChevronDown size={16} />
      </button>
      {reveal && (
        <>
          <p>{v.meaning}</p>
          <blockquote>{v.example}</blockquote>
          <p>{v.prompt}</p>
        </>
      )}
      <button className="button secondary full-width" onClick={() => onReview(!v.reviewed)}>
        {v.reviewed ? 'Review again' : 'I know this phrase'}
        <Check size={16} />
      </button>
    </section>
  );
}
function Progress({ data, demo }: { data: AppData; demo: boolean }) {
  const ended = data.sessions.filter((s) => s.status === 'ended');
  return (
    <>
      <PageHeading
        eyebrow="NOTICE THE SMALL WINS"
        title="You’re building more than a habit."
        description="Every minute you speak is a minute you invest in yourself."
      />
      <div className="stats-grid">
        <Stat
          icon={Clock}
          color="mint"
          value={demo ? '128' : String(ended.reduce((n, s) => n + sessionMinutes(s), 0))}
          unit="min"
          label="Practice time"
          note="Elapsed completed-session time"
        />
        <Stat
          icon={MessagesSquare}
          color="lavender"
          value={demo ? '12' : String(ended.length)}
          label="Conversations"
          note="Completed practice sessions"
        />
        <Stat
          icon={CheckCheck}
          color="peach"
          value={demo ? '8' : String(data.exercises.filter((e) => e.completed).length)}
          label="Exercises practiced"
          note="Marked complete by you"
        />
        <Stat
          icon={Flame}
          color="cream"
          value={demo ? '5' : String(practiceStreak(data.sessions))}
          unit="days"
          label="Practice streak"
          note="Consecutive practice days"
        />
      </div>
      <section className="panel">
        <h2>Your voice, showing up.</h2>
        <p className="section-description">Practice minutes over the last seven days</p>
        <WeekChart demo={demo} sessions={data.sessions} />
      </section>
      <section className="panel progress-focus">
        <IconBox icon={Target} />
        <div>
          <h2>Your current focus</h2>
          <p>
            {data.profile?.goal || 'Daily conversation'} · {data.profile?.daily_target || 15}{' '}
            minutes a day
          </p>
          <p>
            Your level ({data.profile?.level || 'B1'}) is self-assessed learning guidance. We don’t
            turn conversation text into an official language score.
          </p>
        </div>
        <Link href="/settings" className="text-link">
          Adjust your goals <ArrowRight size={16} />
        </Link>
      </section>
      <section className="panel">
        <h2>Patterns worth practicing</h2>
        <p className="section-description">
          Grammar patterns from your saved reports. Counts show how many recent sessions included
          each pattern.
        </p>
        {data.reports?.length ? (
          Object.entries(
            data.reports.reduce<Record<string, number>>((acc, r) => {
              for (const p of new Set(
                r.data.grammar.map((g) => (g.pattern || 'other').replaceAll('-', ' ')),
              ))
                acc[p] = (acc[p] || 0) + 1;
              return acc;
            }, {}),
          )
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([p, n]) => (
              <p className="pattern-row" key={p}>
                {p}
                <Pill>
                  {n} {n === 1 ? 'session' : 'sessions'}
                </Pill>
              </p>
            ))
        ) : (
          <p>
            {demo
              ? 'Sample focus: Use the past tense consistently when talking about yesterday.'
              : 'Your learning patterns will appear after your first report.'}
          </p>
        )}
      </section>
    </>
  );
}

function SettingsPage({
  data,
  refresh,
  onError,
}: {
  data: AppData;
  refresh: () => Promise<void>;
  onError: (s: string) => void;
}) {
  const [profile, setProfile] = useState(data.profile ?? defaultProfile);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const router = useRouter();
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!data.user) {
      router.push('/signin');
      return;
    }
    setBusy(true);
    try {
      await api('profile', 'POST', profile);
      await refresh();
      setSaved(true);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="THIS IS YOUR SPACE"
        title="A coach that feels right for you."
        description="A few preferences help us meet you where you are."
      />
      <form className="settings-layout" onSubmit={save}>
        <section className="panel">
          <h2>Your learning profile</h2>
          <ProfileFields value={profile} onChange={setProfile} />
          <button className="button primary" disabled={busy}>
            {busy ? 'Saving…' : saved ? 'Preferences saved' : 'Save preferences'}
            <Check size={17} />
          </button>
        </section>
        <div>
          <PracticeReminder userId={data.user?.id} />
          <section className="panel">
            <h2>Your coach</h2>
            <label>
              Coach voice
              <select
                value={profile.voice}
                onChange={(e) =>
                  setProfile({ ...profile, voice: e.target.value as Profile['voice'] })
                }
              >
                {['Kore', 'Puck', 'Aoede', 'Charon'].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label className="toggle-label">
              <span>
                <strong>In-conversation corrections</strong>
                <small>Brief corrections at natural pauses.</small>
              </span>
              <input
                type="checkbox"
                checked={profile.correction_mode}
                onChange={(e) => setProfile({ ...profile, correction_mode: e.target.checked })}
              />
            </label>
            <label className="toggle-label">
              <span>
                <strong>Personalized learning memory</strong>
                <small>
                  Use recent report priorities and phrases to shape future practice. Turn off to
                  exclude past learning.
                </small>
              </span>
              <input
                type="checkbox"
                checked={profile.memory_enabled}
                onChange={(e) => setProfile({ ...profile, memory_enabled: e.target.checked })}
              />
            </label>
          </section>
          <section className="panel privacy-panel">
            <ShieldCheck size={23} />
            <h2>Your words belong to you.</h2>
            <p>
              Microphone audio goes directly to Google Gemini for live conversation. Supabase stores
              your profile, transcripts, reports, exercises, and phrases. Transcript text is sent to
              Gemini separately for your report.
            </p>
            <p>
              <strong>Audio retention is off.</strong> SpeakBetter doesn’t store recordings. Replay
              audio lives only in the current tab’s memory. Provider processing follows your Google
              API account’s terms.
            </p>
            <p>
              Active transcript drafts are temporarily saved in this tab’s session storage for
              refresh recovery. They are cleared after a successful session ending or sign-out.
            </p>
            <p>
              Delete a conversation in History to remove its transcript, report, phrases, exercises,
              and learning context.
            </p>
          </section>
        </div>
      </form>
      <section className="panel danger-panel">
        <h3>Delete your account and all learning data</h3>
        <p>
          This permanently deletes your Supabase account and all related app records. Type DELETE to
          confirm.
        </p>
        <label>
          <span className="sr-only">Type DELETE</span>
          <input
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder="Type DELETE"
            autoComplete="off"
          />
        </label>
        <button
          className="button danger"
          disabled={confirmation !== 'DELETE' || !data.user || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api('account', 'DELETE');
              sessionStorage.clear();
              window.location.href = '/signin';
            } catch (e) {
              onError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          Delete account permanently
        </button>
      </section>
    </>
  );
}
function ProfileFields({ value: p, onChange }: { value: Profile; onChange: (p: Profile) => void }) {
  return (
    <div className="profile-fields">
      <label>
        What should we call you?
        <input
          required
          maxLength={60}
          value={p.name}
          onChange={(e) => onChange({ ...p, name: e.target.value })}
          placeholder="Your first name"
        />
      </label>
      <label>
        Your preferred explanation language
        <input
          required
          maxLength={60}
          value={p.native_language}
          onChange={(e) => onChange({ ...p, native_language: e.target.value })}
          placeholder="e.g. Hindi, Spanish"
        />
      </label>
      <div className="field-row">
        <label>
          Your English, as you see it
          <select
            value={p.level}
            onChange={(e) => onChange({ ...p, level: e.target.value as Profile['level'] })}
          >
            {['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map((v, i) => (
              <option key={v} value={v}>
                {v} ·{' '}
                {
                  [
                    'Starting out',
                    'Finding my feet',
                    'Getting comfortable',
                    'Confident in many situations',
                    'Advanced',
                    'Highly proficient',
                  ][i]
                }
              </option>
            ))}
          </select>
        </label>
        <label>
          Your daily target
          <select
            value={p.daily_target}
            onChange={(e) => onChange({ ...p, daily_target: Number(e.target.value) })}
          >
            {[5, 10, 15, 20, 30, 45, 60].map((v) => (
              <option key={v} value={v}>
                {v} minutes
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        What brings you here?
        <select
          value={p.goal}
          onChange={(e) => onChange({ ...p, goal: e.target.value as Profile['goal'] })}
        >
          {['Daily conversation', 'Work', 'Interviews', 'Travel', 'Presentations'].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      <label>
        A coaching style that suits you
        <select
          value={p.style}
          onChange={(e) => onChange({ ...p, style: e.target.value as Profile['style'] })}
        >
          {['Gentle', 'Balanced', 'Intensive'].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
function SignIn() {
  const search = useSearchParams();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<'email' | 'google' | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(
    search.get('error') === 'link'
      ? 'That sign-in link expired or could not be verified. Request a new link and open it in this browser.'
      : search.get('error') === 'oauth'
        ? 'Google sign-in was cancelled or could not be completed. Try again, or use an email link.'
        : search.get('error') === 'auth'
          ? 'We could not verify your sign-in. Try Google again, or request a new email link in this browser.'
          : '',
  );
  async function signInWithGoogle() {
    setError('');
    setMessage('');
    if (!isConfigured()) {
      setError(
        'Google sign-in needs Supabase configuration and an enabled Google provider. Follow the setup guide to connect your account.',
      );
      return;
    }
    setBusy('google');
    try {
      const { data, error } = await browserDb().auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
      if (!data.url)
        throw new Error('Google sign-in could not start. Try again or use an email link.');
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!isConfigured()) {
      setError(
        'Sign-in needs Supabase configuration. Add the values in .env.example, run the database migration, and restart the app.',
      );
      return;
    }
    setBusy('email');
    try {
      const { error } = await browserDb().auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
      setMessage(
        'Check your email for a secure sign-in link. Open it in this browser to continue.',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="auth-layout">
      <div className="auth-story">
        <span className="eyebrow">YOUR VOICE IS WORTH HEARING</span>
        <h1>
          A little practice.
          <br />A more <em>confident you.</em>
        </h1>
        <p>Your patient AI English coach is ready when you are.</p>
        <Orb />
        <p className="auth-caption">
          <ShieldCheck size={17} />
          Private practice. Personal progress.
        </p>
      </div>
      <section className="auth-card">
        <IconBox icon={MessagesSquare} />
        <h2>Make room for your voice.</h2>
        <p>Continue with Google or a secure email link. No password to remember.</p>
        <button
          type="button"
          className="button google-signin full-width"
          disabled={busy !== null}
          onClick={signInWithGoogle}
        >
          <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
            <path
              fill="#4285F4"
              d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.2h6.7c3.9-3.6 6-8.8 6-15.1Z"
            />
            <path
              fill="#34A853"
              d="M24 44c5.5 0 10.1-1.8 13.5-4.9l-6.7-5.2c-1.8 1.2-4.1 2-6.8 2-5.3 0-9.8-3.6-11.4-8.4H5.7v5.4A20.4 20.4 0 0 0 24 44Z"
            />
            <path
              fill="#FBBC05"
              d="M12.6 27.5a12.2 12.2 0 0 1 0-7V15H5.7a20.5 20.5 0 0 0 0 18l6.9-5.5Z"
            />
            <path
              fill="#EA4335"
              d="M24 12.1c3 0 5.6 1 7.7 3l5.8-5.8A19.6 19.6 0 0 0 24 4 20.4 20.4 0 0 0 5.7 15l6.9 5.5C14.2 15.7 18.7 12.1 24 12.1Z"
            />
          </svg>
          {busy === 'google' ? 'Opening Google…' : 'Continue with Google'}
        </button>
        <div className="auth-divider">
          <span>or use email</span>
        </div>
        <form onSubmit={submit}>
          <label>
            Your email address
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </label>
          <button className="button primary full-width" disabled={busy !== null}>
            {busy === 'email' ? 'Sending your link…' : 'Send me a sign-in link'}
            <ArrowRight size={18} />
          </button>
        </form>
        {message && (
          <div role="status" className="success-message">
            <Check size={18} />
            {message}
          </div>
        )}
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}
        <p className="fine-print">
          Your profile, transcripts, and learning feedback are saved privately. Practice audio is
          sent live to Google Gemini and is never retained by SpeakBetter.
        </p>
        <Link href="/" className="text-link">
          Take a look around first <ArrowRight size={15} />
        </Link>
      </section>
    </div>
  );
}
function Onboarding({ data, refresh }: { data: AppData; refresh: () => Promise<void> }) {
  const [profile, setProfile] = useState({ ...defaultProfile, name: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  async function save(quick = false, assessment = false) {
    setBusy(true);
    setError('');
    try {
      if (!data.user) {
        router.push('/signin');
        return;
      }
      await api('profile', 'POST', quick ? { ...defaultProfile, name: 'Learner' } : profile);
      await refresh();
      router.push(assessment ? '/practice?assessment=1' : '/');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="onboarding-card panel">
      <span className="eyebrow">LET’S START WHERE YOU ARE</span>
      <h1>Hello. Let’s make this yours.</h1>
      <p>A few details, a more personal coach. You can change these anytime.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <ProfileFields value={profile} onChange={setProfile} />
        <p className="fine-print">
          Your level is self-assessed, informal learning guidance. For a short introductory speaking
          practice, choose the 3-minute option after setup.
        </p>
        {error && (
          <div role="alert" className="alert">
            {error}
          </div>
        )}
        <button className="button primary full-width" disabled={busy}>
          Make myself at home <ArrowRight size={17} />
        </button>
        <button
          type="button"
          className="text-link onboarding-skip"
          disabled={busy}
          onClick={() => save(true)}
        >
          Start quickly with default preferences
        </button>
        <button
          type="button"
          className="text-link onboarding-skip"
          disabled={busy}
          onClick={() => save(true, true)}
        >
          Try a 3-minute introductory assessment
        </button>
      </form>
    </section>
  );
}
function Welcome() {
  return (
    <div className="welcome-page">
      <div className="eyebrow">FIND YOUR WORDS. FIND YOUR CONFIDENCE.</div>
      <h1>
        Your English has a voice.
        <br />
        Let’s help you <em>find it.</em>
      </h1>
      <p>
        Natural conversations with a patient AI coach.
        <br />
        Personal reflections that turn practice into progress.
      </p>
      <Link href="/signin" className="button primary">
        Start your speaking journey <ArrowRight size={18} />
      </Link>
      <Orb />
      <div className="welcome-features">
        {[
          { icon: Mic, title: 'Speak naturally', text: 'Real voice conversations, at your pace.' },
          {
            icon: BookOpen,
            title: 'Learn from your words',
            text: 'Thoughtful feedback on what you actually said.',
          },
          {
            icon: TrendingUp,
            title: 'Grow a little every day',
            text: 'Personal practice for real-life confidence.',
          },
        ].map(({ icon, title, text }) => (
          <div key={title}>
            <IconBox icon={icon} />
            <h3>{title}</h3>
            <p>{text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

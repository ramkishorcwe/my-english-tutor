'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell, Check } from 'lucide-react';
import { api } from '@/lib/data';
import { disconnectReminderBrowser, reminderDefaults, type ReminderState } from '@/lib/reminders';

function applicationKey(value: string) {
  const raw = atob(
    value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4),
  );
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export function PracticeReminder({ userId }: { userId?: string }) {
  const [settings, setSettings] = useState<ReminderState>({
    ...reminderDefaults,
    configured: false,
    publicKey: null,
    browsers: 0,
  });
  const [time, setTime] = useState(reminderDefaults.time);
  const [timeZone, setTimeZone] = useState(reminderDefaults.timeZone);
  const [supported, setSupported] = useState(false);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(userId));
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [zones, setZones] = useState(['Asia/Kolkata', 'UTC']);
  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const result = await api<ReminderState>('reminders');
      setSettings(result);
      setTime(result.time);
      setTimeZone(result.timeZone);
      setError('');
      if ('serviceWorker' in navigator && 'PushManager' in window) {
        const registration = await navigator.serviceWorker.getRegistration('/');
        setConnected(Boolean(await registration?.pushManager.getSubscription()));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [userId]);
  useEffect(() => {
    setSupported(
      'serviceWorker' in navigator &&
        'PushManager' in window &&
        'Notification' in window &&
        window.isSecureContext,
    );
    setZones([
      ...new Set([
        'Asia/Kolkata',
        Intl.DateTimeFormat().resolvedOptions().timeZone,
        'UTC',
        ...Intl.supportedValuesOf('timeZone'),
      ]),
    ]);
    void load();
  }, [load]);
  async function save(enable: boolean) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      let subscription: PushSubscription | null = null;
      if (enable) {
        if (!supported || !settings.publicKey)
          throw new Error(
            'Notifications are unavailable in this browser. Try Chrome, Edge, or Firefox; on iPhone, add SpeakBetter to your Home Screen first.',
          );
        const permission =
          Notification.permission === 'default'
            ? await Notification.requestPermission()
            : Notification.permission;
        if (permission !== 'granted')
          throw new Error(
            'Notifications are blocked or were not allowed. Open this site’s browser permissions, allow notifications, then try again.',
          );
        await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
        const registration = await navigator.serviceWorker.ready;
        subscription = await registration.pushManager.getSubscription();
        if (!subscription)
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: applicationKey(settings.publicKey),
          });
      }
      await api('reminders', 'POST', {
        time,
        timeZone,
        enabled: enable,
        ...(subscription ? { subscription: subscription.toJSON() } : {}),
      });
      await load();
      setMessage(
        enable
          ? 'Daily reminder saved. We’ll notify you at your chosen time.'
          : 'Daily reminders are turned off.',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) throw new Error('Enable reminders in this browser first.');
      await api('reminders/test', 'POST', { endpoint: subscription.endpoint });
      setMessage('Test notification sent. Check your device’s notifications.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel reminder-panel" aria-labelledby="reminder-heading">
      <div className="reminder-heading">
        <Bell size={22} />
        <h2 id="reminder-heading">Daily practice reminder</h2>
      </div>
      <p>A little nudge to make time for your English.</p>
      <div className="reminder-fields">
        <label>
          Reminder time
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <label>
          Time zone
          <select value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
            {[...new Set([timeZone, ...zones])].map((zone) => (
              <option key={zone} value={zone}>
                {zone === 'Asia/Kolkata' ? 'India · IST (Asia/Kolkata)' : zone.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!userId ? (
        <Link className="button secondary" href="/signin">
          Sign in to set a reminder
        </Link>
      ) : (
        <>
          {loading ? (
            <p role="status">Loading your reminder…</p>
          ) : (
            <>
              <p className="reminder-state">
                {settings.enabled
                  ? `Daily at ${new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' }).format(new Date(`2000-01-01T${settings.time}:00Z`))} · ${settings.timeZone}`
                  : 'Reminders are off.'}
              </p>
              {!supported && (
                <p>
                  Use a browser that supports notifications. On iPhone, add SpeakBetter to your Home
                  Screen first.
                </p>
              )}
              <div className="reminder-actions">
                <button
                  type="button"
                  className="button primary"
                  disabled={busy || !supported || !settings.configured || !time}
                  onClick={() => void save(true)}
                >
                  {busy
                    ? 'Saving…'
                    : settings.enabled && connected
                      ? 'Save reminder'
                      : 'Enable daily reminder'}{' '}
                  <Bell size={16} />
                </button>
                {settings.enabled && (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void save(false)}
                  >
                    Turn off
                  </button>
                )}
                {connected && (
                  <button
                    type="button"
                    className="text-link"
                    disabled={busy}
                    onClick={() => void test()}
                  >
                    Send test notification
                  </button>
                )}
                {connected && (
                  <button
                    type="button"
                    className="text-link"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await disconnectReminderBrowser();
                        await load();
                        setMessage('This browser is disconnected.');
                      } catch {
                        setError('Could not disconnect this browser. Please retry.');
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Disconnect this browser
                  </button>
                )}
              </div>
              {settings.enabled && !connected && (
                <p>
                  This browser is not connected yet. Enable notifications here to receive your
                  reminder.
                </p>
              )}
              {!settings.configured && (
                <p>Browser reminders are temporarily unavailable. Please try again later.</p>
              )}
            </>
          )}
        </>
      )}
      {error && (
        <p className="alert" role="alert">
          {error}{' '}
          <button type="button" className="text-link" onClick={() => void load()}>
            Try again
          </button>
        </p>
      )}
      {message && (
        <p className="reminder-success" role="status">
          <Check size={16} />
          {message}
        </p>
      )}
      <p className="reminder-note">
        Reminders can arrive with this tab closed. Your browser, device, and notification
        permissions must allow delivery. Signing out disconnects this browser.
      </p>
    </section>
  );
}

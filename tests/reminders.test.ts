import { describe, expect, it, vi } from 'vitest';
import { allowedPushEndpoint, reminderSchema } from '../src/lib/reminders';
import { dispatchReminders, type ReminderJob } from '../src/lib/reminder-dispatch';

describe('browser reminder boundaries', () => {
  it('accepts 7:30 PM IST and rejects invalid clocks or time zones', () => {
    expect(
      reminderSchema.safeParse({ time: '19:30', timeZone: 'Asia/Kolkata', enabled: true }).success,
    ).toBe(true);
    for (const time of ['24:30', '19:60', '7:30pm', ''])
      expect(
        reminderSchema.safeParse({ time, timeZone: 'Asia/Kolkata', enabled: true }).success,
      ).toBe(false);
    expect(
      reminderSchema.safeParse({ time: '19:30', timeZone: 'Unknown/Zone', enabled: true }).success,
    ).toBe(false);
  });
  it('only permits known HTTPS push providers, preventing authenticated SSRF', () => {
    expect(allowedPushEndpoint('https://fcm.googleapis.com/fcm/send/example')).toBe(true);
    for (const endpoint of [
      'http://fcm.googleapis.com/send',
      'https://127.0.0.1/private',
      'https://fcm.googleapis.com.evil.example/send',
      'https://user:pass@fcm.googleapis.com/send',
      'https://fcm.googleapis.com:444/send',
      'https://example.com/send',
    ])
      expect(allowedPushEndpoint(endpoint)).toBe(false);
  });
});
const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/example',
  keys: { p256dh: 'key', auth: 'auth' },
};
const job: ReminderJob = {
  user_id: 'alice',
  token: 'lease',
  local_date: '2026-10-21',
  subscriptions: [subscription],
};
describe('reminder delivery recovery', () => {
  it('marks a successful user/day complete only after sending', async () => {
    const complete = vi.fn(),
      send = vi.fn().mockResolvedValue({});
    expect(
      await dispatchReminders({ claim: async () => [job], send, complete, remove: vi.fn() }),
    ).toEqual({ processed: 1, sent: 1, failed: 0 });
    expect(complete).toHaveBeenCalledWith(job, true);
  });
  it('removes expired subscriptions and releases failed delivery for a later retry', async () => {
    const complete = vi.fn(),
      remove = vi.fn();
    await dispatchReminders({
      claim: async () => [job],
      send: vi.fn().mockRejectedValue({ statusCode: 410 }),
      complete,
      remove,
    });
    expect(remove).toHaveBeenCalledWith(job, subscription.endpoint);
    expect(complete).toHaveBeenCalledWith(job, false);
  });
  it('does not remove subscriptions during temporary outages', async () => {
    const remove = vi.fn(),
      complete = vi.fn();
    await dispatchReminders({
      claim: async () => [job],
      send: vi.fn().mockRejectedValue({ statusCode: 503 }),
      complete,
      remove,
    });
    expect(remove).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledWith(job, false);
  });
});

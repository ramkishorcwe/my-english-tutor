import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import webpush from 'web-push';
import { z } from 'zod';
import { adminDb, serverDb } from './supabase/server';
import { allowedPushEndpoint, type ReminderSubscription } from './reminders';

export class ReminderError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const reminderJson = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export function reminderFailure(error: unknown) {
  if (error instanceof ReminderError) return reminderJson({ error: error.message }, error.status);
  if (error instanceof z.ZodError)
    return reminderJson(
      { error: 'Check the reminder time, time zone, and browser subscription.' },
      400,
    );
  return reminderJson({ error: 'Reminders are temporarily unavailable. Please try again.' }, 503);
}
export async function reminderUser(request: Request) {
  if (request.method !== 'GET' && request.headers.get('origin') !== new URL(request.url).origin)
    throw new ReminderError('Request origin is not allowed.', 403);
  const db = await serverDb();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) throw new ReminderError('Sign in to set a reminder.', 401);
  const admin = adminDb();
  if (request.method !== 'GET') {
    const quota = await admin.rpc('consume_usage', {
      p_user: user.id,
      p_action: 'reminders',
      p_limit: 15,
      p_seconds: 60,
    });
    if (quota.error) throw new ReminderError('Reminder settings could not be loaded.', 503);
    if (!quota.data) throw new ReminderError('Please wait a minute before trying again.', 429);
  }
  return { user, admin };
}
export async function reminderBody(request: Request) {
  const text = await request.text();
  if (text.length > 10000) throw new ReminderError('Request is too large.', 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new ReminderError('Invalid request.');
  }
}
export function pushConfigured() {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY &&
    process.env.REMINDER_CRON_SECRET,
  );
}
export function cronAuthorized(header: string | null) {
  const secret = process.env.REMINDER_CRON_SECRET;
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`),
    actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export async function sendPracticePush(subscription: ReminderSubscription, test = false) {
  if (!pushConfigured()) throw new ReminderError('Browser reminders are not configured yet.', 503);
  if (!allowedPushEndpoint(subscription.endpoint))
    throw new ReminderError('Unsupported push service.');
  return webpush.sendNotification(
    subscription,
    JSON.stringify({
      title: test ? 'Your SpeakBetter reminder is ready' : 'Time for your English practice',
      body: test
        ? 'Notifications are working. We’ll remind you at your chosen time.'
        : 'Take a few minutes for your voice. Your English coach is ready.',
      tag: test ? 'speakbetter-test' : 'speakbetter-daily',
    }),
    {
      TTL: 900,
      timeout: 10000,
      urgency: 'normal',
      vapidDetails: {
        subject: process.env.VAPID_SUBJECT || 'https://my-english-tutor-wheat.vercel.app',
        publicKey: process.env.VAPID_PUBLIC_KEY!,
        privateKey: process.env.VAPID_PRIVATE_KEY!,
      },
    },
  );
}

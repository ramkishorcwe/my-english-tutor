import { z } from 'zod';

export const reminderDefaults = { time: '19:30', timeZone: 'Asia/Kolkata', enabled: false };
export const reminderSchema = z.object({
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timeZone: z
    .string()
    .min(1)
    .max(100)
    .refine((zone) => {
      if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)*$/.test(zone)) return false;
      try {
        new Intl.DateTimeFormat('en', { timeZone: zone });
        return true;
      } catch {
        return false;
      }
    }),
  enabled: z.boolean(),
});
export function allowedPushEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === '443') &&
      (['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].includes(
        url.hostname,
      ) ||
        url.hostname.endsWith('.notify.windows.com'))
    );
  } catch {
    return false;
  }
}
export const subscriptionSchema = z.object({
  endpoint: z.string().max(4096).refine(allowedPushEndpoint),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}=?$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}={0,2}$/),
  }),
});
export type ReminderSettings = z.infer<typeof reminderSchema>;
export type ReminderSubscription = z.infer<typeof subscriptionSchema>;
export type ReminderState = ReminderSettings & {
  configured: boolean;
  publicKey: string | null;
  browsers: number;
};

export async function disconnectReminderBrowser() {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  try {
    await fetch('/api/reminders', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
  } finally {
    await subscription.unsubscribe();
  }
}

import { z } from 'zod';
import { reminderDefaults, reminderSchema, subscriptionSchema } from '@/lib/reminders';
import {
  pushConfigured,
  reminderBody,
  ReminderError,
  reminderFailure,
  reminderJson,
  reminderUser,
} from '@/lib/reminder-server';

export async function GET(request: Request) {
  try {
    const { user, admin } = await reminderUser(request);
    const [settings, devices] = await Promise.all([
      admin
        .from('practice_reminders')
        .select('reminder_time,time_zone,enabled')
        .eq('user_id', user.id)
        .maybeSingle(),
      admin
        .from('push_subscriptions')
        .select('endpoint', { count: 'exact', head: true })
        .eq('user_id', user.id),
    ]);
    if (settings.error || devices.error)
      throw new ReminderError('Reminder setup is unavailable. Please try again later.', 503);
    return reminderJson({
      ...(settings.data
        ? {
            time: settings.data.reminder_time.slice(0, 5),
            timeZone: settings.data.time_zone,
            enabled: settings.data.enabled,
          }
        : reminderDefaults),
      configured: pushConfigured(),
      publicKey: process.env.VAPID_PUBLIC_KEY || null,
      browsers: devices.count || 0,
    });
  } catch (error) {
    return reminderFailure(error);
  }
}
export async function POST(request: Request) {
  try {
    const { user, admin } = await reminderUser(request);
    const body = await reminderBody(request);
    const settings = reminderSchema.parse(body);
    const subscription = body.subscription ? subscriptionSchema.parse(body.subscription) : null;
    if (settings.enabled && !pushConfigured())
      throw new ReminderError('Browser reminders are not configured yet.', 503);
    const result = await admin.rpc('save_practice_reminder', {
      p_user: user.id,
      p_time: settings.time,
      p_zone: settings.timeZone,
      p_enabled: settings.enabled,
      p_subscription: subscription,
    });
    if (result.error)
      throw new ReminderError(
        'Could not save the reminder. Check the time zone and connected browsers.',
        503,
      );
    return reminderJson({ ok: true });
  } catch (error) {
    return reminderFailure(error);
  }
}
export async function DELETE(request: Request) {
  try {
    const { user, admin } = await reminderUser(request);
    const body = z.object({ endpoint: z.string().max(4096) }).parse(await reminderBody(request));
    const result = await admin
      .from('push_subscriptions')
      .delete()
      .eq('user_id', user.id)
      .eq('endpoint', body.endpoint);
    if (result.error) throw new ReminderError('Could not disconnect this browser.', 503);
    return reminderJson({ ok: true });
  } catch (error) {
    return reminderFailure(error);
  }
}

import { z } from 'zod';
import {
  reminderBody,
  ReminderError,
  reminderFailure,
  reminderJson,
  reminderUser,
  sendPracticePush,
} from '@/lib/reminder-server';
export async function POST(request: Request) {
  try {
    const { user, admin } = await reminderUser(request);
    const { endpoint } = z
      .object({ endpoint: z.string().max(4096) })
      .parse(await reminderBody(request));
    const quota = await admin.rpc('consume_usage', {
      p_user: user.id,
      p_action: 'test-reminder',
      p_limit: 3,
      p_seconds: 60,
    });
    if (quota.error || !quota.data)
      throw new ReminderError('Wait a minute before sending another test.', 429);
    const result = await admin
      .from('push_subscriptions')
      .select('endpoint,p256dh,auth')
      .eq('user_id', user.id)
      .eq('endpoint', endpoint)
      .maybeSingle();
    if (result.error || !result.data)
      throw new ReminderError('Enable reminders in this browser first.', 404);
    await sendPracticePush(
      {
        endpoint: result.data.endpoint,
        keys: { p256dh: result.data.p256dh, auth: result.data.auth },
      },
      true,
    );
    return reminderJson({ ok: true });
  } catch (error) {
    return reminderFailure(error);
  }
}

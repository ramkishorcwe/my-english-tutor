import { adminDb } from '@/lib/supabase/server';
import {
  cronAuthorized,
  pushConfigured,
  reminderJson,
  sendPracticePush,
} from '@/lib/reminder-server';
import { dispatchReminders } from '@/lib/reminder-dispatch';
export const maxDuration = 60;
export async function POST(request: Request) {
  if (!cronAuthorized(request.headers.get('authorization')))
    return reminderJson({ error: 'Unauthorized.' }, 401);
  if (!pushConfigured()) return reminderJson({ error: 'Reminders are not configured.' }, 503);
  try {
    const db = adminDb();
    const result = await dispatchReminders({
      claim: async () => {
        const r = await db.rpc('claim_practice_reminders');
        if (r.error) throw new Error('claim failed');
        return r.data;
      },
      complete: async (job, sent) => {
        const r = await db.rpc('complete_practice_reminder', {
          p_user: job.user_id,
          p_token: job.token,
          p_date: job.local_date,
          p_sent: sent,
        });
        if (r.error) throw new Error('completion failed');
      },
      remove: async (job, endpoint) => {
        const r = await db
          .from('push_subscriptions')
          .delete()
          .eq('user_id', job.user_id)
          .eq('endpoint', endpoint);
        if (r.error) throw new Error('cleanup failed');
      },
      send: (subscription) => sendPracticePush(subscription),
    });
    return reminderJson(result);
  } catch {
    return reminderJson({ error: 'Reminder delivery is temporarily unavailable.' }, 503);
  }
}

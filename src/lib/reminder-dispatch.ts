import type { ReminderSubscription } from './reminders';
export type ReminderJob = {
  user_id: string;
  token: string;
  local_date: string;
  subscriptions: ReminderSubscription[];
};
export async function dispatchReminders(options: {
  claim: () => Promise<ReminderJob[]>;
  send: (subscription: ReminderSubscription) => Promise<unknown>;
  remove: (job: ReminderJob, endpoint: string) => Promise<void>;
  complete: (job: ReminderJob, sent: boolean) => Promise<void>;
}) {
  const jobs = await options.claim();
  let sent = 0,
    failed = 0;
  await Promise.all(
    jobs.map(async (job) => {
      const results = await Promise.all(
        job.subscriptions.map(async (subscription) => {
          try {
            await options.send(subscription);
            return true;
          } catch (error) {
            const status =
              error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : 0;
            if (status === 404 || status === 410) await options.remove(job, subscription.endpoint);
            return false;
          }
        }),
      );
      const delivered = results.some(Boolean);
      await options.complete(job, delivered);
      if (delivered) sent++;
      else failed++;
    }),
  );
  return { processed: jobs.length, sent, failed };
}

-- Run after 002_practice_reminders.sql. First create the encrypted Vault secret
-- named speakbetter_reminder_cron using the same value as REMINDER_CRON_SECRET.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.schedule('speakbetter-practice-reminders','* * * * *',$job$
 select net.http_post(
  url := 'https://my-english-tutor-wheat.vercel.app/api/reminders/dispatch',
  headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='speakbetter_reminder_cron')),
  body := '{}'::jsonb, timeout_milliseconds := 60000
 ) where exists (
  select 1 from public.practice_reminders r where r.enabled
  and public.practice_reminder_day(r.reminder_time,r.time_zone,r.last_sent_on,now()) is not null
  and (r.claim_until is null or r.claim_until<now())
  and exists(select 1 from public.push_subscriptions ps where ps.user_id=r.user_id)
 );
$job$);

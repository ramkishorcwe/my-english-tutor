create table public.practice_reminders (
 user_id uuid primary key references auth.users on delete cascade,
 reminder_time time not null default '19:30', time_zone text not null default 'Asia/Kolkata',
 enabled boolean not null default false, last_sent_on date,
 claim_token uuid, claim_until timestamptz
);
create table public.push_subscriptions (
 endpoint text primary key, user_id uuid not null references auth.users on delete cascade,
 p256dh text not null, auth text not null, created_at timestamptz not null default now()
);
create index push_subscriptions_user on public.push_subscriptions(user_id);
alter table public.practice_reminders enable row level security;
alter table public.push_subscriptions enable row level security;
revoke all on public.practice_reminders,public.push_subscriptions from anon,authenticated;
grant all on public.practice_reminders,public.push_subscriptions to service_role;

create function public.save_practice_reminder(p_user uuid,p_time text,p_zone text,p_enabled boolean,p_subscription jsonb default null)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from pg_timezone_names where name=p_zone) then raise exception 'Invalid time zone'; end if;
 if p_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Invalid reminder time';end if;
 perform pg_advisory_xact_lock(hashtext(p_user::text));
 if p_subscription is not null then
   if (select count(*) from push_subscriptions where user_id=p_user and endpoint<>p_subscription->>'endpoint')>=5 then raise exception 'Five browsers are already connected. Remove one before adding another.';end if;
   insert into push_subscriptions(endpoint,user_id,p256dh,auth)
   values(p_subscription->>'endpoint',p_user,p_subscription->'keys'->>'p256dh',p_subscription->'keys'->>'auth')
   on conflict(endpoint) do update set user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth;
 end if;
 if p_enabled and not exists(select 1 from push_subscriptions where user_id=p_user) then raise exception 'Connect a browser before enabling reminders';end if;
 insert into practice_reminders(user_id,reminder_time,time_zone,enabled) values(p_user,p_time::time,p_zone,p_enabled)
 on conflict(user_id) do update set reminder_time=excluded.reminder_time,time_zone=excluded.time_zone,enabled=excluded.enabled;
end;$$;

create function public.practice_reminder_day(p_time time,p_zone text,p_sent date,p_now timestamptz)
returns date language sql stable set search_path=public as $$
 with candidate as (
  select (p_now at time zone p_zone)::date - case when (p_now at time zone p_zone)::time<p_time then 1 else 0 end as day
 )
 select case when p_sent is distinct from day and p_now>=(day+p_time) at time zone p_zone
 and p_now<((day+p_time) at time zone p_zone)+interval '15 minutes' then day else null end from candidate;
$$;

create function public.claim_practice_reminders(p_now timestamptz default now())
returns table(user_id uuid,token uuid,local_date date,subscriptions jsonb)
language sql security definer set search_path=public as $$
 with due as (
  select r.user_id, d.day
  from practice_reminders r
  cross join lateral (select practice_reminder_day(r.reminder_time,r.time_zone,r.last_sent_on,p_now) as day) d
  where r.enabled and d.day is not null and (r.claim_until is null or r.claim_until<p_now)
  and exists(select 1 from push_subscriptions ps where ps.user_id=r.user_id)
  order by r.user_id limit 25 for update of r skip locked
 ), claimed as (
  update practice_reminders r set claim_token=gen_random_uuid(),claim_until=p_now+interval '2 minutes'
  from due where r.user_id=due.user_id returning r.user_id,r.claim_token,due.day
 )
 select c.user_id,c.claim_token,c.day,jsonb_agg(jsonb_build_object('endpoint',ps.endpoint,'keys',jsonb_build_object('p256dh',ps.p256dh,'auth',ps.auth)))
 from claimed c join push_subscriptions ps on ps.user_id=c.user_id group by c.user_id,c.claim_token,c.day;
$$;

create function public.complete_practice_reminder(p_user uuid,p_token uuid,p_date date,p_sent boolean)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 update practice_reminders set last_sent_on=case when p_sent then p_date else last_sent_on end,claim_token=null,claim_until=null
 where user_id=p_user and claim_token=p_token;
 return found;
end;$$;
revoke all on function public.practice_reminder_day(time,text,date,timestamptz),public.save_practice_reminder(uuid,text,text,boolean,jsonb),public.claim_practice_reminders(timestamptz),public.complete_practice_reminder(uuid,uuid,date,boolean) from public,anon,authenticated;
grant execute on function public.practice_reminder_day(time,text,date,timestamptz),public.save_practice_reminder(uuid,text,text,boolean,jsonb),public.claim_practice_reminders(timestamptz),public.complete_practice_reminder(uuid,uuid,date,boolean) to service_role;

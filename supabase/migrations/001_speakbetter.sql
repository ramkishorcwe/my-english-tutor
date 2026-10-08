-- Run once in Supabase SQL Editor. All service functions are server-only.
create table public.profiles (
 id uuid primary key references auth.users on delete cascade,
 name text not null, native_language text not null, level text not null,
 goal text not null, style text not null, daily_target int not null check(daily_target between 5 and 60),
 voice text not null default 'Kore', memory_enabled boolean not null default true,
 correction_mode boolean not null default false, created_at timestamptz not null default now()
);
create table public.sessions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade,
 topic text not null, mode text not null, difficulty text not null,
 duration int not null check(duration between 3 and 20), input_mode text not null,
 created_at timestamptz not null default now(), ended_at timestamptz,
 status text not null default 'active' check(status in ('active','ended')),
 report_status text not null default 'pending' check(report_status in ('pending','generating','ready','failed')),
 report_started_at timestamptz, report_lease uuid, report_attempts int not null default 0
);
create index sessions_user_date on public.sessions(user_id,created_at desc);
create unique index one_active_session on public.sessions(user_id) where status='active';
create table public.transcript_turns (
 id uuid primary key, session_id uuid not null references public.sessions on delete cascade,
 user_id uuid not null references auth.users on delete cascade, role text not null check(role in ('user','model')),
 text text not null check(length(text) between 1 and 12000), sequence int not null,
 unique(session_id,sequence)
);
create table public.reports (
 session_id uuid primary key references public.sessions on delete cascade,
 user_id uuid not null references auth.users on delete cascade, data jsonb not null,
 created_at timestamptz not null default now()
);
create table public.exercises (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade,
 session_id uuid not null references public.sessions on delete cascade,
 type text not null, prompt text not null, answer text not null, turn_id uuid not null,
 completed boolean not null default false, created_at timestamptz not null default now(),
 unique(session_id,prompt)
);
create table public.vocabulary (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade,
 session_id uuid not null references public.sessions on delete cascade,
 phrase text not null, meaning text not null, example text not null, prompt text not null,
 reviewed boolean not null default false, created_at timestamptz not null default now(), unique(session_id,phrase)
);
create table public.usage_buckets(user_id uuid references auth.users on delete cascade, action text, bucket bigint, count int not null default 1, primary key(user_id,action,bucket));

alter table public.profiles enable row level security;
alter table public.sessions enable row level security;
alter table public.transcript_turns enable row level security;
alter table public.reports enable row level security;
alter table public.exercises enable row level security;
alter table public.vocabulary enable row level security;
alter table public.usage_buckets enable row level security;
create policy own_profile_read on public.profiles for select to authenticated using(id=auth.uid());
create policy own_profile_insert on public.profiles for insert to authenticated with check(id=auth.uid());
create policy own_profile_update on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
create policy own_sessions on public.sessions for select to authenticated using(user_id=auth.uid());
create policy delete_session on public.sessions for delete to authenticated using(user_id=auth.uid());
create policy own_turns on public.transcript_turns for select to authenticated using(user_id=auth.uid());
create policy own_reports on public.reports for select to authenticated using(user_id=auth.uid());
create policy own_exercises on public.exercises for select to authenticated using(user_id=auth.uid());
create policy own_vocabulary on public.vocabulary for select to authenticated using(user_id=auth.uid());
-- Explicit grants prevent accidentally exposing future tables or write columns.
revoke all on public.sessions,public.transcript_turns,public.reports,public.exercises,public.vocabulary,public.usage_buckets from anon,authenticated;
grant select,delete on public.sessions to authenticated;
grant select on public.transcript_turns,public.reports,public.exercises,public.vocabulary to authenticated;
grant select,insert,update on public.profiles to authenticated;

create function public.consume_usage(p_user uuid,p_action text,p_limit int,p_seconds int) returns boolean language plpgsql security definer set search_path=public as $$
declare n int;
begin
 insert into usage_buckets(user_id,action,bucket) values(p_user,p_action,floor(extract(epoch from now())/p_seconds))
 on conflict(user_id,action,bucket) do update set count=usage_buckets.count+1 returning count into n;
 delete from usage_buckets where user_id=p_user and bucket < floor(extract(epoch from now())/p_seconds)-1000 and action=p_action;
 return n<=p_limit;
end;$$;
create function public.start_session(p_user uuid,p_data jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare sid uuid; allocated int;
begin
 perform pg_advisory_xact_lock(hashtext(p_user::text));
 update sessions set status='ended',ended_at=least(now(),created_at+make_interval(mins=>duration)) where user_id=p_user and status='active' and created_at+make_interval(mins=>duration)<now();
 if exists(select 1 from sessions where user_id=p_user and status='active') then raise exception 'Finish your active session from History first.'; end if;
 -- A separate ledger prevents deletion from resetting a user's quota.
 insert into usage_buckets(user_id,action,bucket,count) values(p_user,'daily-minutes',floor(extract(epoch from now())/86400),(p_data->>'duration')::int)
 on conflict(user_id,action,bucket) do update set count=usage_buckets.count+excluded.count returning count into allocated;
 if allocated>60 then raise exception 'Daily practice limit reached (60 minutes). Come back tomorrow.';end if;
 insert into sessions(user_id,topic,mode,difficulty,duration,input_mode) values(p_user,p_data->>'topic',p_data->>'mode',p_data->>'difficulty',(p_data->>'duration')::int,p_data->>'input_mode') returning id into sid;
 return sid;
end;$$;
create function public.save_turns(p_user uuid,p_session uuid,p_turns jsonb) returns void language plpgsql security definer set search_path=public as $$
declare s sessions;
begin
 select * into s from sessions where id=p_session and user_id=p_user for update;
 if s.id is null then raise exception 'Session not found';end if;
 if s.status<>'active' or now()>s.created_at+make_interval(mins=>s.duration)+interval '2 minutes' then raise exception 'Session has ended';end if;
 insert into transcript_turns(id,session_id,user_id,role,text,sequence)
 select (t->>'id')::uuid,p_session,p_user,t->>'role',t->>'text',(t->>'sequence')::int from jsonb_array_elements(p_turns) t
 on conflict(id) do update set text=excluded.text where transcript_turns.session_id=p_session and transcript_turns.user_id=p_user and transcript_turns.role=excluded.role and transcript_turns.sequence=excluded.sequence and length(excluded.text)>=length(transcript_turns.text);
 if (select count(*)>400 or coalesce(sum(length(text)),0)>80000 from transcript_turns where session_id=p_session) then raise exception 'Transcript size limit reached. End this session to generate your report.';end if;
end;$$;
create function public.finish_session(p_user uuid,p_session uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 update sessions set status='ended',ended_at=least(now(),created_at+make_interval(mins=>duration)) where id=p_session and user_id=p_user and status='active';
end;$$;
create function public.claim_report(p_user uuid,p_session uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare lease uuid:=gen_random_uuid();
begin
 update sessions set report_status='generating',report_started_at=now(),report_lease=lease,report_attempts=report_attempts+1
 where id=p_session and user_id=p_user and status='ended' and report_status<>'ready' and report_attempts<5
 and (report_status<>'generating' or report_started_at<now()-interval '3 minutes');
 if not found then return null;end if;return lease;
end;$$;
create function public.commit_report(p_user uuid,p_session uuid,p_lease uuid,p_report jsonb) returns boolean language plpgsql security definer set search_path=public as $$
begin
 perform 1 from sessions where id=p_session and user_id=p_user and report_lease=p_lease and report_status='generating' for update;
 if not found then return false;end if;
 insert into reports(session_id,user_id,data) values(p_session,p_user,p_report) on conflict do nothing;
 insert into exercises(user_id,session_id,type,prompt,answer,turn_id) select p_user,p_session,e->>'type',e->>'prompt',e->>'answer',(e->>'turnId')::uuid from jsonb_array_elements(p_report->'exercises') e on conflict do nothing;
 insert into vocabulary(user_id,session_id,phrase,meaning,example,prompt) select p_user,p_session,e->>'phrase',e->>'meaning',e->>'example',e->>'prompt' from jsonb_array_elements(p_report->'vocabulary') e on conflict do nothing;
 update sessions set report_status='ready' where id=p_session;return true;
end;$$;
revoke all on function public.consume_usage(uuid,text,int,int),public.start_session(uuid,jsonb),public.save_turns(uuid,uuid,jsonb),public.finish_session(uuid,uuid),public.claim_report(uuid,uuid),public.commit_report(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.consume_usage(uuid,text,int,int),public.start_session(uuid,jsonb),public.save_turns(uuid,uuid,jsonb),public.finish_session(uuid,uuid),public.claim_report(uuid,uuid),public.commit_report(uuid,uuid,uuid,jsonb) to service_role;
-- No audio bucket is created: retaining audio is deliberately disabled.

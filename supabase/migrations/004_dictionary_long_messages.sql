begin;
-- Private dictionary entries; successful searches are saved once per language.
create table public.personal_dictionary (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users on delete cascade,
 term text not null check(length(term) between 1 and 6000),
 term_key text not null check(length(term_key)=64),
 target_language text not null check(length(target_language) between 1 and 60),
 source_language text not null check(length(source_language) between 1 and 60),
 translation text not null check(length(translation) between 1 and 24000),
 meaning text not null check(length(meaning) between 1 and 1800),
 example text not null check(length(example) between 1 and 1200),
 created_at timestamptz not null default now(),
 last_searched_at timestamptz not null default now(),
 unique(user_id,term_key,target_language)
);
create index personal_dictionary_user_recent on public.personal_dictionary(user_id,last_searched_at desc);
alter table public.personal_dictionary enable row level security;
revoke all on public.personal_dictionary from anon,authenticated;
grant select on public.personal_dictionary to authenticated;
grant all on public.personal_dictionary to service_role;
create policy own_dictionary on public.personal_dictionary for select to authenticated using(user_id=auth.uid());

-- Raise learner messages to 5,000 characters while preserving reply leases and ownership.
create or replace function public.claim_writing_reply(p_user uuid,p_chat uuid,p_request uuid,p_text text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c writing_chats; r writing_chat_requests; token uuid:=gen_random_uuid(); n int;
begin
 select * into c from writing_chats where id=p_chat and user_id=p_user for update;
 if c.id is null then raise exception 'Chat not found';end if;
 if c.status<>'active' then raise exception 'This chat has ended';end if;
 select * into r from writing_chat_requests where chat_id=p_chat and request_id=p_request;
 if found then
  if r.input_text is distinct from p_text then raise exception 'Request does not match the saved message';end if;
  if r.complete then return jsonb_build_object('state','complete');end if;
 end if;
 if exists(select 1 from writing_chat_requests where chat_id=p_chat and not complete and lease_until>now()) then
  return jsonb_build_object('state','busy');
 end if;
 -- A failed message must be retried before another message is accepted.
 if exists(select 1 from writing_chat_requests where chat_id=p_chat and not complete and request_id<>p_request) then
  raise exception 'Retry the pending reply before sending a new message';
 end if;
 if r.request_id is null then
  select coalesce(max(sequence),-1)+1 into n from writing_chat_turns where chat_id=p_chat;
  if p_text is null then
   if n<>0 then raise exception 'The tutor already started this chat';end if;
  else
   if length(trim(p_text))<1 or length(p_text)>5000 then raise exception 'Write between 1 and 5000 characters';end if;
   if n=0 then raise exception 'Wait for the tutor to start';end if;
   if (select count(*) from writing_chat_turns where chat_id=p_chat and role='user')>=30 then raise exception 'This chat has reached 30 messages. End it to review your writing.';end if;
   if (select coalesce(sum(length(text)),0) from writing_chat_turns where chat_id=p_chat)>350000 then raise exception 'End this chat to review your writing';end if;
   insert into writing_chat_turns(id,chat_id,role,text,sequence) values(p_request,p_chat,'user',p_text,n);
  end if;
  insert into writing_chat_requests(chat_id,request_id,input_text,lease,lease_until)
  values(p_chat,p_request,p_text,token,now()+interval '90 seconds');
 else
  update writing_chat_requests set lease=token,lease_until=now()+interval '90 seconds' where chat_id=p_chat and request_id=p_request;
 end if;
 return jsonb_build_object('state','claimed','lease',token);
end;$$;


commit;

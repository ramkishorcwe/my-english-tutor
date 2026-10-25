-- Private written practice. Only verified server routes can write messages or AI reviews.
create table public.writing_chats (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade,
 topic text not null check(length(topic) between 2 and 240), created_at timestamptz not null default now(), ended_at timestamptz,
 status text not null default 'active' check(status in ('active','ended')),
 review jsonb, review_lease uuid, review_until timestamptz
);
create index writing_chats_user_date on public.writing_chats(user_id,created_at desc);
create table public.writing_chat_turns (
 id uuid primary key default gen_random_uuid(), chat_id uuid not null references public.writing_chats on delete cascade,
 role text not null check(role in ('user','model')), text text not null check(length(text) between 1 and 6000),
 sequence int not null, unique(chat_id,sequence)
);
create table public.writing_chat_requests (
 chat_id uuid not null references public.writing_chats on delete cascade, request_id uuid not null,
 input_text text, reply_id uuid not null default gen_random_uuid(), lease uuid, lease_until timestamptz,
 complete boolean not null default false, primary key(chat_id,request_id)
);
create table public.writing_review_batches (
 chat_id uuid not null references public.writing_chats on delete cascade, batch_key text not null,
 data jsonb not null, primary key(chat_id,batch_key)
);
alter table public.writing_chats enable row level security;
alter table public.writing_chat_turns enable row level security;
alter table public.writing_chat_requests enable row level security;
alter table public.writing_review_batches enable row level security;
revoke all on public.writing_chats,public.writing_chat_turns,public.writing_chat_requests,public.writing_review_batches from anon,authenticated;
grant all on public.writing_chats,public.writing_chat_turns,public.writing_chat_requests,public.writing_review_batches to service_role;

create function public.claim_writing_reply(p_user uuid,p_chat uuid,p_request uuid,p_text text)
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
   if length(trim(p_text))<1 or length(p_text)>2000 then raise exception 'Write between 1 and 2000 characters';end if;
   if n=0 then raise exception 'Wait for the tutor to start';end if;
   if (select count(*) from writing_chat_turns where chat_id=p_chat and role='user')>=30 then raise exception 'This chat has reached 30 messages. End it to review your writing.';end if;
   if (select coalesce(sum(length(text)),0) from writing_chat_turns where chat_id=p_chat)>70000 then raise exception 'End this chat to review your writing';end if;
   insert into writing_chat_turns(id,chat_id,role,text,sequence) values(p_request,p_chat,'user',p_text,n);
  end if;
  insert into writing_chat_requests(chat_id,request_id,input_text,lease,lease_until)
  values(p_chat,p_request,p_text,token,now()+interval '90 seconds');
 else
  update writing_chat_requests set lease=token,lease_until=now()+interval '90 seconds' where chat_id=p_chat and request_id=p_request;
 end if;
 return jsonb_build_object('state','claimed','lease',token);
end;$$;

create function public.complete_writing_reply(p_user uuid,p_chat uuid,p_request uuid,p_lease uuid,p_reply text)
returns boolean language plpgsql security definer set search_path=public as $$
declare r writing_chat_requests; n int;
begin
 perform 1 from writing_chats where id=p_chat and user_id=p_user and status='active' for update;
 if not found then return false;end if;
 select * into r from writing_chat_requests where chat_id=p_chat and request_id=p_request and lease=p_lease and not complete;
 if not found then return false;end if;
 if length(trim(p_reply))<1 or length(p_reply)>6000 then raise exception 'Invalid tutor reply';end if;
 select coalesce(max(sequence),-1)+1 into n from writing_chat_turns where chat_id=p_chat;
 insert into writing_chat_turns(id,chat_id,role,text,sequence) values(r.reply_id,p_chat,'model',p_reply,n);
 update writing_chat_requests set complete=true,lease=null,lease_until=null where chat_id=p_chat and request_id=p_request;
 return true;
end;$$;

create function public.end_writing_chat(p_user uuid,p_chat uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 perform 1 from writing_chats where id=p_chat and user_id=p_user for update;
 if not found then raise exception 'Chat not found';end if;
 if not exists(select 1 from writing_chat_turns where chat_id=p_chat and role='user') then raise exception 'Write a message before requesting a review';end if;
 update writing_chats set status='ended',ended_at=coalesce(ended_at,now()) where id=p_chat;
end;$$;

create function public.claim_writing_review(p_user uuid,p_chat uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare token uuid:=gen_random_uuid();
begin
 update writing_chats set review_lease=token,review_until=now()+interval '3 minutes'
 where id=p_chat and user_id=p_user and status='ended' and review is null and (review_until is null or review_until<now());
 if not found then return null;end if;return token;
end;$$;
revoke all on function public.claim_writing_reply(uuid,uuid,uuid,text),public.complete_writing_reply(uuid,uuid,uuid,uuid,text),public.end_writing_chat(uuid,uuid),public.claim_writing_review(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_writing_reply(uuid,uuid,uuid,text),public.complete_writing_reply(uuid,uuid,uuid,uuid,text),public.end_writing_chat(uuid,uuid),public.claim_writing_review(uuid,uuid) to service_role;

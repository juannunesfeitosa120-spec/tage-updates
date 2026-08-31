-- Chat de grupo e privado, presença, leitura, reações, anexos e retenção de 30 dias.

alter table public.taggi_member_preferences
  add column if not exists chat_retention_notice_seen boolean not null default false,
  add column if not exists chat_retention_notice_version integer not null default 1;

create table public.taggi_chat_conversations (
  id uuid primary key default extensions.gen_random_uuid(),
  group_id uuid not null references public.taggi_groups(id) on delete cascade,
  type text not null check (type in ('group','private')),
  title text,
  direct_key text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint taggi_chat_private_key_check check (
    (type='group' and direct_key is null) or
    (type='private' and direct_key is not null)
  )
);

create unique index taggi_chat_one_group_conversation_idx
  on public.taggi_chat_conversations (group_id) where type='group';
create unique index taggi_chat_private_pair_idx
  on public.taggi_chat_conversations (group_id,direct_key) where type='private';
create index taggi_chat_conversations_updated_idx
  on public.taggi_chat_conversations (group_id,updated_at desc);

create table public.taggi_chat_conversation_members (
  conversation_id uuid not null references public.taggi_chat_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id,user_id)
);
create index taggi_chat_members_user_idx on public.taggi_chat_conversation_members (user_id,conversation_id);

create table public.taggi_chat_messages (
  id uuid primary key default extensions.gen_random_uuid(),
  group_id uuid not null references public.taggi_groups(id) on delete cascade,
  conversation_id uuid not null references public.taggi_chat_conversations(id) on delete cascade,
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  message_type text not null default 'text' check (message_type in ('text','file','image')),
  content text not null default '',
  attachment_path text,
  attachment_name text,
  attachment_size bigint,
  attachment_mime text,
  reply_to_message_id uuid references public.taggi_chat_messages(id) on delete set null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  expires_at timestamptz not null default (now()+interval '30 days'),
  constraint taggi_chat_content_or_file check (
    char_length(trim(content)) between 1 and 5000 or attachment_path is not null
  ),
  constraint taggi_chat_attachment_size check (attachment_size is null or attachment_size between 0 and 26214400)
);
create index taggi_chat_messages_conversation_cursor_idx on public.taggi_chat_messages (conversation_id,created_at desc,id);
create index taggi_chat_messages_group_expiry_idx on public.taggi_chat_messages (group_id,expires_at);
create index taggi_chat_messages_sender_idx on public.taggi_chat_messages (sender_user_id,created_at desc);

create table public.taggi_chat_reactions (
  message_id uuid not null references public.taggi_chat_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id,user_id,emoji)
);

create table public.taggi_chat_reads (
  message_id uuid not null references public.taggi_chat_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id,user_id)
);
create index taggi_chat_reads_user_time_idx on public.taggi_chat_reads (user_id,read_at desc);

create table public.taggi_user_presence (
  group_id uuid not null references public.taggi_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  is_online boolean not null default true,
  last_seen timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (group_id,user_id)
);
create index taggi_user_presence_group_online_idx on public.taggi_user_presence (group_id,is_online,last_seen desc);

create table private_taggi.chat_file_cleanup_queue (
  id bigint generated always as identity primary key,
  bucket_id text not null default 'taggi-chat',
  object_path text not null unique,
  queued_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text
);

create table private_taggi.chat_retention_config (
  id boolean primary key default true check (id),
  secret_hash bytea not null,
  updated_at timestamptz not null default now()
);

create or replace function private_taggi.can_access_conversation(target_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists (
    select 1
    from public.taggi_chat_conversations c
    where c.id=target_conversation_id
      and (select private_taggi.is_active_member(c.group_id))
      and (
        c.type='group' or exists (
          select 1 from public.taggi_chat_conversation_members m
          where m.conversation_id=c.id and m.user_id=(select auth.uid())
        )
      )
  );
$$;

create or replace function private_taggi.ensure_group_chat()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  insert into public.taggi_chat_conversations (group_id,type,title,created_by)
  values (new.id,'group','Grupo',new.created_by)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists taggi_group_chat_create on public.taggi_groups;
create trigger taggi_group_chat_create after insert on public.taggi_groups
for each row execute function private_taggi.ensure_group_chat();

insert into public.taggi_chat_conversations (group_id,type,title,created_by)
select g.id,'group','Grupo',g.created_by from public.taggi_groups g
on conflict do nothing;

create or replace function private_taggi.prepare_chat_message()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare conversation_group_id uuid;
begin
  if (select auth.uid()) is null then raise exception using errcode='42501',message='Faça login para enviar mensagens.'; end if;
  select c.group_id into conversation_group_id from public.taggi_chat_conversations c where c.id=new.conversation_id;
  if conversation_group_id is null or not (select private_taggi.can_access_conversation(new.conversation_id)) then raise exception using errcode='42501',message='Conversa não autorizada.'; end if;
  new.group_id := conversation_group_id;
  new.sender_user_id := (select auth.uid());
  new.content := trim(coalesce(new.content,''));
  new.created_at := now();
  new.expires_at := now()+interval '30 days';
  if new.attachment_path is not null and (
    split_part(new.attachment_path,'/',1)<>conversation_group_id::text or
    split_part(new.attachment_path,'/',2)<>new.conversation_id::text or
    split_part(new.attachment_path,'/',3)<>(select auth.uid())::text
  ) then raise exception using errcode='22023',message='Caminho de anexo inválido.'; end if;
  if new.reply_to_message_id is not null and not exists(select 1 from public.taggi_chat_messages r where r.id=new.reply_to_message_id and r.conversation_id=new.conversation_id) then raise exception using errcode='22023',message='Mensagem respondida não pertence à conversa.'; end if;
  update public.taggi_chat_conversations set updated_at=now() where id=new.conversation_id;
  return new;
end;
$$;

create trigger taggi_chat_message_prepare before insert on public.taggi_chat_messages
for each row execute function private_taggi.prepare_chat_message();

create or replace function private_taggi.queue_chat_attachment_cleanup()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if old.attachment_path is not null then
    insert into private_taggi.chat_file_cleanup_queue (object_path)
    values (old.attachment_path) on conflict (object_path) do nothing;
  end if;
  return old;
end;
$$;

create trigger taggi_chat_attachment_cleanup after delete on public.taggi_chat_messages
for each row execute function private_taggi.queue_chat_attachment_cleanup();

create or replace function private_taggi.purge_expired_chat()
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare affected integer;
begin
  delete from public.taggi_chat_messages where expires_at<=now();
  get diagnostics affected=row_count;
  update public.taggi_user_presence set is_online=false,updated_at=now() where is_online and last_seen<now()-interval '3 minutes';
  return affected;
end;
$$;

create or replace function public.taggi_start_private_chat(p_group_id uuid,p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare caller_id uuid:=(select auth.uid()); pair_key text; result_id uuid;
begin
  if caller_id=p_other_user_id then raise exception using errcode='22023',message='Escolha outra pessoa.'; end if;
  if not (select private_taggi.is_active_member(p_group_id)) or not exists(select 1 from public.taggi_group_members m where m.group_id=p_group_id and m.user_id=p_other_user_id and m.status='active') then raise exception using errcode='42501',message='A pessoa não pertence à sua empresa.'; end if;
  pair_key:=least(caller_id::text,p_other_user_id::text)||':'||greatest(caller_id::text,p_other_user_id::text);
  insert into public.taggi_chat_conversations (group_id,type,title,direct_key,created_by)
  values (p_group_id,'private',null,pair_key,caller_id)
  on conflict (group_id,direct_key) where type='private' do update set updated_at=public.taggi_chat_conversations.updated_at
  returning id into result_id;
  insert into public.taggi_chat_conversation_members (conversation_id,user_id) values (result_id,caller_id),(result_id,p_other_user_id) on conflict do nothing;
  return result_id;
end;
$$;

create or replace function public.taggi_touch_chat_presence(p_group_id uuid,p_online boolean default true)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if not (select private_taggi.is_active_member(p_group_id)) then raise exception using errcode='42501',message='Empresa não autorizada.'; end if;
  insert into public.taggi_user_presence (group_id,user_id,is_online,last_seen,updated_at)
  values (p_group_id,(select auth.uid()),p_online,now(),now())
  on conflict (group_id,user_id) do update set is_online=excluded.is_online,last_seen=excluded.last_seen,updated_at=now();
end;
$$;

create or replace function public.taggi_acknowledge_chat_retention(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if not (select private_taggi.is_active_member(p_group_id)) then raise exception using errcode='42501',message='Empresa não autorizada.'; end if;
  update public.taggi_member_preferences set chat_retention_notice_seen=true,chat_retention_notice_version=1,updated_at=now()
  where group_id=p_group_id and user_id=(select auth.uid());
end;
$$;

create or replace function private_taggi.safe_uuid(raw_value text)
returns uuid
language plpgsql
immutable
set search_path=''
as $$
begin
  return raw_value::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

alter table public.taggi_chat_conversations enable row level security;
alter table public.taggi_chat_conversations force row level security;
alter table public.taggi_chat_conversation_members enable row level security;
alter table public.taggi_chat_conversation_members force row level security;
alter table public.taggi_chat_messages enable row level security;
alter table public.taggi_chat_messages force row level security;
alter table public.taggi_chat_reactions enable row level security;
alter table public.taggi_chat_reactions force row level security;
alter table public.taggi_chat_reads enable row level security;
alter table public.taggi_chat_reads force row level security;
alter table public.taggi_user_presence enable row level security;
alter table public.taggi_user_presence force row level security;
alter table private_taggi.chat_file_cleanup_queue enable row level security;
alter table private_taggi.chat_file_cleanup_queue force row level security;
alter table private_taggi.chat_retention_config enable row level security;
alter table private_taggi.chat_retention_config force row level security;

create policy taggi_chat_conversations_member_read on public.taggi_chat_conversations
for select to authenticated using ((select private_taggi.can_access_conversation(id)));

create policy taggi_chat_members_conversation_read on public.taggi_chat_conversation_members
for select to authenticated using ((select private_taggi.can_access_conversation(conversation_id)));

create policy taggi_chat_messages_conversation_read on public.taggi_chat_messages
for select to authenticated using ((select private_taggi.can_access_conversation(conversation_id)));
create policy taggi_chat_messages_conversation_insert on public.taggi_chat_messages
for insert to authenticated with check (
  sender_user_id=(select auth.uid()) and (select private_taggi.can_access_conversation(conversation_id))
);

create policy taggi_chat_reactions_conversation_read on public.taggi_chat_reactions
for select to authenticated using (exists(
  select 1 from public.taggi_chat_messages m
  where m.id=message_id and (select private_taggi.can_access_conversation(m.conversation_id))
));
create policy taggi_chat_reactions_own_insert on public.taggi_chat_reactions
for insert to authenticated with check (user_id=(select auth.uid()) and exists(
  select 1 from public.taggi_chat_messages m
  where m.id=message_id and (select private_taggi.can_access_conversation(m.conversation_id))
));
create policy taggi_chat_reactions_own_delete on public.taggi_chat_reactions
for delete to authenticated using (user_id=(select auth.uid()));

create policy taggi_chat_reads_conversation_read on public.taggi_chat_reads
for select to authenticated using (exists(
  select 1 from public.taggi_chat_messages m
  where m.id=message_id and (select private_taggi.can_access_conversation(m.conversation_id))
));
create policy taggi_chat_reads_own_insert on public.taggi_chat_reads
for insert to authenticated with check (user_id=(select auth.uid()) and exists(
  select 1 from public.taggi_chat_messages m
  where m.id=message_id and (select private_taggi.can_access_conversation(m.conversation_id))
));
create policy taggi_chat_reads_own_update on public.taggi_chat_reads
for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));

create policy taggi_presence_group_read on public.taggi_user_presence
for select to authenticated using ((select private_taggi.is_active_member(group_id)));

revoke all on public.taggi_chat_conversations,public.taggi_chat_conversation_members,
  public.taggi_chat_messages,public.taggi_chat_reactions,public.taggi_chat_reads,
  public.taggi_user_presence from public,anon,authenticated;
grant select on public.taggi_chat_conversations,public.taggi_chat_conversation_members,
  public.taggi_chat_messages,public.taggi_chat_reactions,public.taggi_chat_reads,
  public.taggi_user_presence to authenticated;
grant insert on public.taggi_chat_messages,public.taggi_chat_reactions,public.taggi_chat_reads to authenticated;
grant update on public.taggi_chat_reads to authenticated;
grant delete on public.taggi_chat_reactions to authenticated;
revoke all on private_taggi.chat_file_cleanup_queue,private_taggi.chat_retention_config from public,anon,authenticated;

revoke execute on function public.taggi_start_private_chat(uuid,uuid) from public,anon;
revoke execute on function public.taggi_touch_chat_presence(uuid,boolean) from public,anon;
revoke execute on function public.taggi_acknowledge_chat_retention(uuid) from public,anon;
grant execute on function public.taggi_start_private_chat(uuid,uuid) to authenticated;
grant execute on function public.taggi_touch_chat_presence(uuid,boolean) to authenticated;
grant execute on function public.taggi_acknowledge_chat_retention(uuid) to authenticated;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values (
  'taggi-chat','taggi-chat',false,26214400,
  array[
    'image/jpeg','image/png','image/webp','image/gif','application/pdf',
    'application/zip','application/x-zip-compressed','text/plain','text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists taggi_chat_files_read on storage.objects;
drop policy if exists taggi_chat_files_insert on storage.objects;
drop policy if exists taggi_chat_files_delete on storage.objects;

create policy taggi_chat_files_read on storage.objects
for select to authenticated using (
  bucket_id='taggi-chat' and
  split_part(name,'/',1) in (select m.group_id::text from public.taggi_group_members m where m.user_id=(select auth.uid()) and m.status='active') and
  (select private_taggi.can_access_conversation(private_taggi.safe_uuid(split_part(name,'/',2))))
);
create policy taggi_chat_files_insert on storage.objects
for insert to authenticated with check (
  bucket_id='taggi-chat' and
  split_part(name,'/',3)=(select auth.uid())::text and
  split_part(name,'/',1) in (select m.group_id::text from public.taggi_group_members m where m.user_id=(select auth.uid()) and m.status='active') and
  (select private_taggi.can_access_conversation(private_taggi.safe_uuid(split_part(name,'/',2))))
);
create policy taggi_chat_files_delete on storage.objects
for delete to authenticated using (
  bucket_id='taggi-chat' and split_part(name,'/',3)=(select auth.uid())::text
);

alter table public.taggi_chat_conversations replica identity full;
alter table public.taggi_chat_messages replica identity full;
alter table public.taggi_chat_reactions replica identity full;
alter table public.taggi_chat_reads replica identity full;
alter table public.taggi_user_presence replica identity full;
alter publication supabase_realtime add table public.taggi_chat_conversations;
alter publication supabase_realtime add table public.taggi_chat_messages;
alter publication supabase_realtime add table public.taggi_chat_reactions;
alter publication supabase_realtime add table public.taggi_chat_reads;
alter publication supabase_realtime add table public.taggi_user_presence;

select cron.schedule(
  'taggi-chat-retention-hourly',
  '17 * * * *',
  'select private_taggi.purge_expired_chat()'
);

do $$
declare raw_secret text;
begin
  if not exists(select 1 from vault.secrets where name='taggi_chat_retention_secret') then
    raw_secret:=encode(extensions.gen_random_bytes(32),'hex');
    perform vault.create_secret(raw_secret,'taggi_chat_retention_secret','Autenticação do limpador de anexos do chat.');
  else
    select decrypted_secret into raw_secret from vault.decrypted_secrets where name='taggi_chat_retention_secret' limit 1;
  end if;
  insert into private_taggi.chat_retention_config (id,secret_hash)
  values (true,extensions.digest(raw_secret,'sha256'))
  on conflict (id) do update set secret_hash=excluded.secret_hash,updated_at=now();
end;
$$;

create or replace function public.taggi_run_chat_retention(p_secret text)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare valid boolean; affected integer;
begin
  select c.secret_hash=extensions.digest(p_secret,'sha256') into valid
  from private_taggi.chat_retention_config c where c.id=true;
  if coalesce(valid,false)=false then raise exception using errcode='42501',message='Segredo de retenção inválido.'; end if;
  affected:=private_taggi.purge_expired_chat();
  return affected;
end;
$$;

revoke execute on function public.taggi_run_chat_retention(text) from public,anon,authenticated;
grant execute on function public.taggi_run_chat_retention(text) to service_role;
grant select,update,delete on private_taggi.chat_file_cleanup_queue to service_role;

begin;

-- EtiquetaFlow is intentionally preserved in place as an isolated legacy
-- system. The Taggi application never reads from or writes to ef_* objects.
-- Only the verified-empty first Taggi draft is replaced below.

drop function if exists public.taggi_create_group(text, text) cascade;
drop function if exists public.taggi_join_group(text, text) cascade;
drop table if exists public.taggi_messages cascade;
drop table if exists public.taggi_count_events cascade;
drop table if exists public.taggi_platforms cascade;
drop table if exists public.taggi_members cascade;
drop table if exists public.taggi_groups cascade;
drop schema if exists private_taggi cascade;

create extension if not exists pgcrypto;
create extension if not exists pg_cron;

create schema private_taggi;
revoke all on schema private_taggi from public, anon, authenticated;

create table public.taggi_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 2 and 80),
  email text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.taggi_groups (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 100),
  code text not null unique check (code ~ '^TG-[A-Z2-9]{5}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  creation_request_id uuid not null unique,
  status text not null default 'active' check (status in ('active', 'archived')),
  admin_password_configured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.taggi_group_members (
  id uuid primary key default extensions.gen_random_uuid(),
  group_id uuid not null references public.taggi_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 2 and 80),
  role text not null default 'employee' check (role in ('employee', 'administrative', 'manager')),
  status text not null default 'active' check (status in ('active', 'removed')),
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, user_id)
);

create table public.taggi_group_settings (
  group_id uuid primary key references public.taggi_groups(id) on delete cascade,
  admin_session_minutes integer not null default 30 check (admin_session_minutes between 5 and 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.taggi_member_preferences (
  group_id uuid not null references public.taggi_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  tutorial_completed_at timestamptz,
  tutorial_skipped boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table public.taggi_platforms (
  id uuid primary key default extensions.gen_random_uuid(),
  group_id uuid not null references public.taggi_groups(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 100),
  store text not null default 'Loja principal' check (char_length(trim(store)) between 2 and 100),
  initials text not null default 'T' check (char_length(trim(initials)) between 1 and 3),
  accent text not null default '#1684ff' check (accent ~ '^#[0-9A-Fa-f]{6}$'),
  brand_color text not null default '#1684ff' check (brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order integer not null default 0,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, id)
);

create unique index taggi_platforms_group_name_unique
  on public.taggi_platforms (group_id, lower(name))
  where status = 'active';

create table public.taggi_count_events (
  id uuid primary key default extensions.gen_random_uuid(),
  group_id uuid not null references public.taggi_groups(id) on delete cascade,
  platform_id uuid not null,
  work_date date not null default (timezone('America/Sao_Paulo', now()))::date,
  event_type text not null default 'launch'
    check (event_type in ('launch', 'occurrence', 'reset', 'adjustment', 'admin_adjustment')),
  delta integer not null check (delta <> 0),
  reason text check (reason is null or char_length(reason) <= 300),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_by_name text not null check (char_length(trim(created_by_name)) between 2 and 80),
  created_at timestamptz not null default now(),
  constraint taggi_count_events_platform_same_group_fkey
    foreign key (group_id, platform_id)
    references public.taggi_platforms(group_id, id)
    on delete restrict
);

create table public.taggi_messages (
  id uuid primary key default extensions.gen_random_uuid(),
  group_id uuid not null references public.taggi_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  display_name text not null check (char_length(trim(display_name)) between 2 and 80),
  body text not null check (char_length(trim(body)) between 1 and 1500),
  created_at timestamptz not null default now()
);

create table public.taggi_activity_log (
  id uuid primary key default extensions.gen_random_uuid(),
  group_id uuid not null references public.taggi_groups(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  display_name text not null check (char_length(trim(display_name)) between 2 and 80),
  activity_type text not null,
  summary text not null check (char_length(trim(summary)) between 2 and 300),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table private_taggi.admin_credentials (
  group_id uuid primary key references public.taggi_groups(id) on delete cascade,
  password_hash text not null,
  changed_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private_taggi.admin_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  group_id uuid not null references public.taggi_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash bytea not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index taggi_groups_created_by_idx on public.taggi_groups (created_by);
create index taggi_group_members_user_status_idx on public.taggi_group_members (user_id, status);
create index taggi_group_members_group_status_idx on public.taggi_group_members (group_id, status);
create index taggi_platforms_group_status_sort_idx on public.taggi_platforms (group_id, status, sort_order);
create index taggi_platforms_created_by_idx on public.taggi_platforms (created_by);
create index taggi_count_events_group_date_created_idx on public.taggi_count_events (group_id, work_date, created_at desc);
create index taggi_count_events_group_platform_date_idx on public.taggi_count_events (group_id, platform_id, work_date);
create index taggi_count_events_created_by_idx on public.taggi_count_events (created_by);
create index taggi_messages_group_created_idx on public.taggi_messages (group_id, created_at desc);
create index taggi_messages_user_idx on public.taggi_messages (user_id);
create index taggi_activity_group_created_idx on public.taggi_activity_log (group_id, created_at desc);
create index taggi_activity_user_idx on public.taggi_activity_log (user_id);
create index taggi_member_preferences_user_idx on public.taggi_member_preferences (user_id);
create index taggi_admin_sessions_lookup_idx on private_taggi.admin_sessions (group_id, user_id, expires_at)
  where revoked_at is null;
create index taggi_admin_credentials_changed_by_idx on private_taggi.admin_credentials (changed_by);
create index taggi_admin_sessions_user_idx on private_taggi.admin_sessions (user_id);

create or replace function private_taggi.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger taggi_profiles_updated_at before update on public.taggi_profiles
for each row execute function private_taggi.set_updated_at();
create trigger taggi_groups_updated_at before update on public.taggi_groups
for each row execute function private_taggi.set_updated_at();
create trigger taggi_group_members_updated_at before update on public.taggi_group_members
for each row execute function private_taggi.set_updated_at();
create trigger taggi_group_settings_updated_at before update on public.taggi_group_settings
for each row execute function private_taggi.set_updated_at();
create trigger taggi_member_preferences_updated_at before update on public.taggi_member_preferences
for each row execute function private_taggi.set_updated_at();
create trigger taggi_platforms_updated_at before update on public.taggi_platforms
for each row execute function private_taggi.set_updated_at();

create or replace function private_taggi.protect_platform_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id <> old.id or new.group_id <> old.group_id or new.created_by <> old.created_by then
    raise exception using errcode = '42501', message = 'A identidade da plataforma não pode ser alterada.';
  end if;
  return new;
end;
$$;

create trigger taggi_platform_identity before update on public.taggi_platforms
for each row execute function private_taggi.protect_platform_identity();

create or replace function private_taggi.is_active_member(target_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.taggi_group_members m
      where m.group_id = target_group_id
        and m.user_id = (select auth.uid())
        and m.status = 'active'
    );
$$;

create or replace function private_taggi.current_role_level(target_group_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(case m.role
    when 'manager' then 3
    when 'administrative' then 2
    when 'employee' then 1
    else 0 end), 0)
  from public.taggi_group_members m
  where m.group_id = target_group_id
    and m.user_id = (select auth.uid())
    and m.status = 'active';
$$;

create or replace function private_taggi.normalize_group_code(raw_code text)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  compact text := upper(regexp_replace(coalesce(raw_code, ''), '[^A-Z0-9]', '', 'g'));
begin
  if compact like 'TG%' then
    compact := substring(compact from 3);
  end if;
  if compact !~ '^[A-Z2-9]{5}$' then
    return null;
  end if;
  return 'TG-' || compact;
end;
$$;

create or replace function private_taggi.generate_group_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text;
  i integer;
begin
  loop
    candidate := 'TG-';
    for i in 1..5 loop
      candidate := candidate || substr(alphabet, 1 + (get_byte(extensions.gen_random_bytes(1), 0) % length(alphabet)), 1);
    end loop;
    exit when not exists (select 1 from public.taggi_groups g where g.code = candidate);
  end loop;
  return candidate;
end;
$$;

create or replace function private_taggi.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  fallback_name text;
begin
  fallback_name := coalesce(nullif(split_part(new.email, '@', 1), ''), 'Novo usuário');
  insert into public.taggi_profiles (user_id, display_name, email)
  values (new.id, fallback_name, coalesce(new.email, ''))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger taggi_auth_user_created
after insert on auth.users
for each row execute function private_taggi.handle_new_auth_user();

create or replace function private_taggi.set_count_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_name text;
begin
  select m.display_name into actor_name
  from public.taggi_group_members m
  where m.group_id = new.group_id
    and m.user_id = (select auth.uid())
    and m.status = 'active';
  if actor_name is null then
    raise exception using errcode = '42501', message = 'Você não pertence a esta empresa.';
  end if;
  new.created_by := (select auth.uid());
  new.created_by_name := actor_name;
  return new;
end;
$$;

create trigger taggi_count_actor before insert on public.taggi_count_events
for each row execute function private_taggi.set_count_actor();

create or replace function private_taggi.set_message_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_name text;
begin
  select m.display_name into actor_name
  from public.taggi_group_members m
  where m.group_id = new.group_id
    and m.user_id = (select auth.uid())
    and m.status = 'active';
  if actor_name is null then
    raise exception using errcode = '42501', message = 'Você não pertence a esta empresa.';
  end if;
  new.user_id := (select auth.uid());
  new.display_name := actor_name;
  return new;
end;
$$;

create trigger taggi_message_actor before insert on public.taggi_messages
for each row execute function private_taggi.set_message_actor();

create or replace function private_taggi.log_count_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  platform_name text;
  action_label text;
begin
  select p.name into platform_name
  from public.taggi_platforms p
  where p.group_id = new.group_id and p.id = new.platform_id;
  action_label := case new.event_type
    when 'launch' then 'registrou'
    when 'occurrence' then 'registrou uma ocorrência de'
    when 'reset' then 'zerou'
    when 'admin_adjustment' then 'corrigiu administrativamente'
    else 'ajustou' end;
  insert into public.taggi_activity_log (
    group_id, user_id, display_name, activity_type, summary, metadata, created_at
  ) values (
    new.group_id,
    new.created_by,
    new.created_by_name,
    'count_' || new.event_type,
    format('%s %s etiquetas em %s', new.created_by_name, action_label, platform_name),
    jsonb_build_object('event_id', new.id, 'platform_id', new.platform_id, 'delta', new.delta, 'reason', new.reason),
    new.created_at
  );
  return new;
end;
$$;

create trigger taggi_count_activity after insert on public.taggi_count_events
for each row execute function private_taggi.log_count_event();

create or replace function private_taggi.admin_session_valid(
  target_group_id uuid,
  target_session_id uuid,
  raw_token text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private_taggi.is_active_member(target_group_id))
    and exists (
      select 1
      from private_taggi.admin_sessions s
      where s.id = target_session_id
        and s.group_id = target_group_id
        and s.user_id = (select auth.uid())
        and s.revoked_at is null
        and s.expires_at > now()
        and s.token_hash = extensions.digest(raw_token, 'sha256')
    );
$$;

create or replace function public.taggi_find_group(p_group_code text)
returns table (group_code text, group_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select g.code, g.name
  from public.taggi_groups g
  where g.code = private_taggi.normalize_group_code(p_group_code)
    and g.status = 'active'
  limit 1;
$$;

create or replace function public.taggi_create_group(
  p_group_name text,
  p_display_name text,
  p_request_id uuid
)
returns table (
  group_id uuid,
  group_code text,
  group_name text,
  display_name text,
  member_role text,
  tutorial_completed_at timestamptz,
  admin_password_configured boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  new_group public.taggi_groups%rowtype;
  clean_name text := trim(p_group_name);
  clean_display_name text := trim(p_display_name);
  caller_email text;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'Faça login para criar uma empresa.';
  end if;
  if char_length(clean_name) not between 2 and 100 then
    raise exception using errcode = '22023', message = 'Informe um nome de empresa válido.';
  end if;
  if char_length(clean_display_name) not between 2 and 80 then
    raise exception using errcode = '22023', message = 'Informe o seu nome.';
  end if;

  select * into new_group
  from public.taggi_groups g
  where g.created_by = caller_id and g.creation_request_id = p_request_id;

  if new_group.id is null then
    insert into public.taggi_groups (name, code, created_by, creation_request_id)
    values (clean_name, private_taggi.generate_group_code(), caller_id, p_request_id)
    returning * into new_group;

    insert into public.taggi_group_members (group_id, user_id, display_name, role)
    values (new_group.id, caller_id, clean_display_name, 'manager');

    insert into public.taggi_group_settings (group_id) values (new_group.id);
    insert into public.taggi_member_preferences (group_id, user_id)
    values (new_group.id, caller_id);

    insert into public.taggi_platforms
      (group_id, name, store, initials, accent, brand_color, sort_order, created_by)
    values
      (new_group.id, 'Mercado Livre Flex', 'Loja Flex', 'ML', '#14e876', '#ffd600', 1, caller_id),
      (new_group.id, 'Shopee Direta', 'Loja Direta', 'S', '#ffca08', '#ff5b18', 2, caller_id),
      (new_group.id, 'Mercado Livre Coleta', 'Loja Coleta', 'ML', '#198cff', '#ffd600', 3, caller_id),
      (new_group.id, 'Shopee Coleta', 'Loja Coleta', 'S', '#ff3e7c', '#ff5b18', 4, caller_id),
      (new_group.id, 'Shein Coleta', 'Loja Coleta', 'S', '#e6edf3', '#080a0d', 5, caller_id);

    insert into public.taggi_activity_log
      (group_id, user_id, display_name, activity_type, summary)
    values
      (new_group.id, caller_id, clean_display_name, 'group_created', clean_display_name || ' criou a empresa.'),
      (new_group.id, caller_id, clean_display_name, 'member_joined', clean_display_name || ' entrou na equipe.');
  end if;

  select u.email into caller_email from auth.users u where u.id = caller_id;
  insert into public.taggi_profiles (user_id, display_name, email)
  values (caller_id, clean_display_name, coalesce(caller_email, ''))
  on conflict (user_id) do update
    set display_name = excluded.display_name,
        email = excluded.email,
        updated_at = now();

  return query
  select new_group.id, new_group.code, new_group.name, m.display_name, m.role,
         pref.tutorial_completed_at,
         new_group.admin_password_configured_at is not null
  from public.taggi_group_members m
  join public.taggi_member_preferences pref
    on pref.group_id = m.group_id and pref.user_id = m.user_id
  where m.group_id = new_group.id and m.user_id = caller_id;
end;
$$;

create or replace function public.taggi_join_group(
  p_group_code text,
  p_display_name text
)
returns table (
  group_id uuid,
  group_code text,
  group_name text,
  display_name text,
  member_role text,
  tutorial_completed_at timestamptz,
  admin_password_configured boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  found_group public.taggi_groups%rowtype;
  clean_display_name text := trim(p_display_name);
  caller_email text;
  was_active boolean := false;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'Faça login para entrar na equipe.';
  end if;
  if char_length(clean_display_name) not between 2 and 80 then
    raise exception using errcode = '22023', message = 'Informe o seu nome.';
  end if;
  select * into found_group
  from public.taggi_groups g
  where g.code = private_taggi.normalize_group_code(p_group_code)
    and g.status = 'active';
  if found_group.id is null then
    raise exception using errcode = 'P0002', message = 'Não encontramos nenhuma equipe com esse código.';
  end if;

  select exists (
    select 1 from public.taggi_group_members m
    where m.group_id = found_group.id and m.user_id = caller_id and m.status = 'active'
  ) into was_active;

  insert into public.taggi_group_members (group_id, user_id, display_name, role, status)
  values (found_group.id, caller_id, clean_display_name, 'employee', 'active')
  on conflict on constraint taggi_group_members_group_id_user_id_key do update
    set display_name = excluded.display_name,
        role = case when public.taggi_group_members.status = 'active'
                    then public.taggi_group_members.role else 'employee' end,
        status = 'active',
        last_seen_at = now(),
        updated_at = now();

  insert into public.taggi_member_preferences (group_id, user_id)
  values (found_group.id, caller_id)
  on conflict on constraint taggi_member_preferences_pkey do nothing;

  select u.email into caller_email from auth.users u where u.id = caller_id;
  insert into public.taggi_profiles (user_id, display_name, email)
  values (caller_id, clean_display_name, coalesce(caller_email, ''))
  on conflict (user_id) do update
    set display_name = excluded.display_name,
        email = excluded.email,
        updated_at = now();

  if not was_active then
    insert into public.taggi_activity_log
      (group_id, user_id, display_name, activity_type, summary)
    values (found_group.id, caller_id, clean_display_name, 'member_joined', clean_display_name || ' entrou na equipe.');
  end if;

  return query
  select found_group.id, found_group.code, found_group.name, m.display_name, m.role,
         pref.tutorial_completed_at,
         found_group.admin_password_configured_at is not null
  from public.taggi_group_members m
  join public.taggi_member_preferences pref
    on pref.group_id = m.group_id and pref.user_id = m.user_id
  where m.group_id = found_group.id and m.user_id = caller_id;
end;
$$;

create or replace function public.taggi_touch_presence(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.taggi_group_members
  set last_seen_at = now()
  where group_id = p_group_id
    and user_id = (select auth.uid())
    and status = 'active';
  if not found then
    raise exception using errcode = '42501', message = 'Você não pertence a esta empresa.';
  end if;
end;
$$;

create or replace function public.taggi_complete_tutorial(p_group_id uuid, p_skipped boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private_taggi.is_active_member(p_group_id)) then
    raise exception using errcode = '42501', message = 'Você não pertence a esta empresa.';
  end if;
  insert into public.taggi_member_preferences
    (group_id, user_id, tutorial_completed_at, tutorial_skipped)
  values (p_group_id, (select auth.uid()), now(), p_skipped)
  on conflict (group_id, user_id) do update
    set tutorial_completed_at = now(), tutorial_skipped = excluded.tutorial_skipped, updated_at = now();
end;
$$;

create or replace function public.taggi_update_member_role(
  p_group_id uuid,
  p_target_user_id uuid,
  p_new_role text,
  p_confirm_last_authority boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_level integer := (select private_taggi.current_role_level(p_group_id));
  target_role text;
  target_level integer;
  new_level integer;
  target_name text;
  authority_count integer;
begin
  new_level := case p_new_role when 'manager' then 3 when 'administrative' then 2 when 'employee' then 1 else 0 end;
  if caller_level < 2 or new_level = 0 then
    raise exception using errcode = '42501', message = 'Você não pode alterar este cargo.';
  end if;
  select m.role, m.display_name into target_role, target_name
  from public.taggi_group_members m
  where m.group_id = p_group_id and m.user_id = p_target_user_id and m.status = 'active'
  for update;
  if target_role is null then
    raise exception using errcode = 'P0002', message = 'Membro não encontrado.';
  end if;
  target_level := case target_role when 'manager' then 3 when 'administrative' then 2 else 1 end;

  if p_target_user_id = caller_id then
    if new_level > target_level then
      raise exception using errcode = '42501', message = 'Você não pode aumentar o próprio cargo.';
    end if;
  else
    if target_level > caller_level or new_level > caller_level then
      raise exception using errcode = '42501', message = 'Você não pode atribuir ou alterar um cargo acima do seu nível.';
    end if;
  end if;

  if p_target_user_id = caller_id and target_role in ('manager', 'administrative') and p_new_role = 'employee' then
    select count(*) into authority_count
    from public.taggi_group_members m
    where m.group_id = p_group_id and m.status = 'active' and m.role in ('manager', 'administrative');
    if authority_count = 1 and not p_confirm_last_authority then
      raise exception using errcode = 'P0001', message = 'last_authority_confirmation_required';
    end if;
  end if;

  update public.taggi_group_members
  set role = p_new_role
  where group_id = p_group_id and user_id = p_target_user_id;

  insert into public.taggi_activity_log
    (group_id, user_id, display_name, activity_type, summary, metadata)
  values (
    p_group_id, caller_id,
    (select display_name from public.taggi_group_members where group_id = p_group_id and user_id = caller_id),
    'member_role_changed',
    target_name || ' agora é ' || case p_new_role when 'employee' then 'Funcionário' when 'administrative' then 'Administrativo' else 'Gestor' end || '.',
    jsonb_build_object('target_user_id', p_target_user_id, 'old_role', target_role, 'new_role', p_new_role)
  );
  return p_new_role;
end;
$$;

create or replace function public.taggi_remove_member(p_group_id uuid, p_target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_level integer := (select private_taggi.current_role_level(p_group_id));
  target_role text;
  target_name text;
  target_level integer;
begin
  if caller_level < 2 or p_target_user_id = caller_id then
    raise exception using errcode = '42501', message = 'Você não pode remover este membro.';
  end if;
  select role, display_name into target_role, target_name
  from public.taggi_group_members
  where group_id = p_group_id and user_id = p_target_user_id and status = 'active'
  for update;
  target_level := case target_role when 'manager' then 3 when 'administrative' then 2 when 'employee' then 1 else 0 end;
  if target_level = 0 or target_level > caller_level then
    raise exception using errcode = '42501', message = 'Você não pode remover este membro.';
  end if;
  update public.taggi_group_members
  set status = 'removed', updated_at = now()
  where group_id = p_group_id and user_id = p_target_user_id;
  insert into public.taggi_activity_log
    (group_id, user_id, display_name, activity_type, summary, metadata)
  values (
    p_group_id, caller_id,
    (select display_name from public.taggi_group_members where group_id = p_group_id and user_id = caller_id),
    'member_removed', target_name || ' foi removido da equipe.',
    jsonb_build_object('target_user_id', p_target_user_id)
  );
end;
$$;

create or replace function public.taggi_set_initial_admin_password(p_group_id uuid, p_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
begin
  if (select private_taggi.current_role_level(p_group_id)) < 3 then
    raise exception using errcode = '42501', message = 'Somente um Gestor pode criar a senha inicial.';
  end if;
  if char_length(p_password) < 8 then
    raise exception using errcode = '22023', message = 'A senha deve possuir pelo menos 8 caracteres.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_group_id::text, 0));
  if exists (select 1 from private_taggi.admin_credentials c where c.group_id = p_group_id) then
    raise exception using errcode = '23505', message = 'A senha da Administração já foi criada.';
  end if;
  insert into private_taggi.admin_credentials (group_id, password_hash, changed_by)
  values (p_group_id, extensions.crypt(p_password, extensions.gen_salt('bf', 12)), caller_id);
  update public.taggi_groups set admin_password_configured_at = now() where id = p_group_id;
end;
$$;

create or replace function public.taggi_unlock_admin(p_group_id uuid, p_password text)
returns table (session_id uuid, session_token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  stored_hash text;
  raw_token text;
  new_session_id uuid := extensions.gen_random_uuid();
  new_expires_at timestamptz;
begin
  if not (select private_taggi.is_active_member(p_group_id)) then
    raise exception using errcode = '42501', message = 'Você não pertence a esta empresa.';
  end if;
  select c.password_hash into stored_hash
  from private_taggi.admin_credentials c where c.group_id = p_group_id;
  if stored_hash is null or extensions.crypt(p_password, stored_hash) <> stored_hash then
    raise exception using errcode = '28P01', message = 'Senha da Administração incorreta.';
  end if;
  raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  select now() + make_interval(mins => s.admin_session_minutes)
  into new_expires_at
  from public.taggi_group_settings s where s.group_id = p_group_id;
  insert into private_taggi.admin_sessions (id, group_id, user_id, token_hash, expires_at)
  values (new_session_id, p_group_id, caller_id, extensions.digest(raw_token, 'sha256'), new_expires_at);
  return query select new_session_id, raw_token, new_expires_at;
end;
$$;

create or replace function public.taggi_lock_admin(p_group_id uuid, p_session_id uuid, p_session_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private_taggi.admin_session_valid(p_group_id, p_session_id, p_session_token)) then
    raise exception using errcode = '42501', message = 'Sessão administrativa inválida.';
  end if;
  update private_taggi.admin_sessions set revoked_at = now() where id = p_session_id;
end;
$$;

create or replace function public.taggi_change_admin_password(
  p_group_id uuid,
  p_current_password text,
  p_new_password text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  stored_hash text;
begin
  if (select private_taggi.current_role_level(p_group_id)) < 2 then
    raise exception using errcode = '42501', message = 'Seu cargo não permite alterar esta senha.';
  end if;
  if char_length(p_new_password) < 8 then
    raise exception using errcode = '22023', message = 'A nova senha deve possuir pelo menos 8 caracteres.';
  end if;
  select c.password_hash into stored_hash
  from private_taggi.admin_credentials c where c.group_id = p_group_id for update;
  if stored_hash is null or extensions.crypt(p_current_password, stored_hash) <> stored_hash then
    raise exception using errcode = '28P01', message = 'Senha atual incorreta.';
  end if;
  update private_taggi.admin_credentials
  set password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf', 12)),
      changed_by = caller_id,
      updated_at = now()
  where group_id = p_group_id;
  update private_taggi.admin_sessions set revoked_at = now()
  where group_id = p_group_id and revoked_at is null;
  insert into public.taggi_activity_log
    (group_id, user_id, display_name, activity_type, summary)
  values (
    p_group_id, caller_id,
    (select display_name from public.taggi_group_members where group_id = p_group_id and user_id = caller_id),
    'admin_password_changed', 'A senha da Administração foi alterada.'
  );
end;
$$;

create or replace function public.taggi_admin_adjust_count(
  p_group_id uuid,
  p_platform_id uuid,
  p_delta integer,
  p_reason text,
  p_session_id uuid,
  p_session_token text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_event_id uuid;
begin
  if not (select private_taggi.admin_session_valid(p_group_id, p_session_id, p_session_token)) then
    raise exception using errcode = '42501', message = 'A Administração está bloqueada.';
  end if;
  if p_delta = 0 or char_length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception using errcode = '22023', message = 'Informe o ajuste e o motivo.';
  end if;
  insert into public.taggi_count_events (group_id, platform_id, event_type, delta, reason)
  values (p_group_id, p_platform_id, 'admin_adjustment', p_delta, trim(p_reason))
  returning id into new_event_id;
  return new_event_id;
end;
$$;

create or replace function private_taggi.purge_expired_history()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cutoff_date date := ((timezone('America/Sao_Paulo', now()))::date - interval '1 month')::date;
begin
  delete from public.taggi_activity_log
  where (timezone('America/Sao_Paulo', created_at))::date < cutoff_date;
  delete from public.taggi_count_events
  where work_date < cutoff_date;
  delete from private_taggi.admin_sessions
  where expires_at < now() - interval '1 day' or revoked_at < now() - interval '1 day';
end;
$$;

alter table public.taggi_profiles enable row level security;
alter table public.taggi_profiles force row level security;
alter table public.taggi_groups enable row level security;
alter table public.taggi_groups force row level security;
alter table public.taggi_group_members enable row level security;
alter table public.taggi_group_members force row level security;
alter table public.taggi_group_settings enable row level security;
alter table public.taggi_group_settings force row level security;
alter table public.taggi_member_preferences enable row level security;
alter table public.taggi_member_preferences force row level security;
alter table public.taggi_platforms enable row level security;
alter table public.taggi_platforms force row level security;
alter table public.taggi_count_events enable row level security;
alter table public.taggi_count_events force row level security;
alter table public.taggi_messages enable row level security;
alter table public.taggi_messages force row level security;
alter table public.taggi_activity_log enable row level security;
alter table public.taggi_activity_log force row level security;

create policy taggi_profiles_own_select on public.taggi_profiles
for select to authenticated using (user_id = (select auth.uid()));
create policy taggi_profiles_own_update on public.taggi_profiles
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy taggi_groups_member_select on public.taggi_groups
for select to authenticated using ((select private_taggi.is_active_member(id)));

create policy taggi_members_group_select on public.taggi_group_members
for select to authenticated using ((select private_taggi.is_active_member(group_id)));

create policy taggi_settings_group_select on public.taggi_group_settings
for select to authenticated using ((select private_taggi.is_active_member(group_id)));

create policy taggi_preferences_own_select on public.taggi_member_preferences
for select to authenticated
using (user_id = (select auth.uid()) and (select private_taggi.is_active_member(group_id)));

create policy taggi_platforms_member_select on public.taggi_platforms
for select to authenticated using ((select private_taggi.is_active_member(group_id)));
create policy taggi_platforms_member_insert on public.taggi_platforms
for insert to authenticated
with check ((select private_taggi.is_active_member(group_id)) and created_by = (select auth.uid()));
create policy taggi_platforms_member_update on public.taggi_platforms
for update to authenticated
using ((select private_taggi.is_active_member(group_id)))
with check ((select private_taggi.is_active_member(group_id)));
create policy taggi_platforms_member_delete on public.taggi_platforms
for delete to authenticated using ((select private_taggi.is_active_member(group_id)));

create policy taggi_count_events_member_select on public.taggi_count_events
for select to authenticated using ((select private_taggi.is_active_member(group_id)));
create policy taggi_count_events_member_insert on public.taggi_count_events
for insert to authenticated
with check ((select private_taggi.is_active_member(group_id)));

create policy taggi_messages_member_select on public.taggi_messages
for select to authenticated using ((select private_taggi.is_active_member(group_id)));
create policy taggi_messages_member_insert on public.taggi_messages
for insert to authenticated
with check ((select private_taggi.is_active_member(group_id)));

create policy taggi_activity_member_select on public.taggi_activity_log
for select to authenticated using ((select private_taggi.is_active_member(group_id)));

revoke all on public.taggi_profiles,
  public.taggi_groups,
  public.taggi_group_members,
  public.taggi_group_settings,
  public.taggi_member_preferences,
  public.taggi_platforms,
  public.taggi_count_events,
  public.taggi_messages,
  public.taggi_activity_log
from anon, authenticated;
grant select on public.taggi_profiles to authenticated;
grant update (display_name, avatar_url) on public.taggi_profiles to authenticated;
grant select on public.taggi_groups to authenticated;
grant select on public.taggi_group_members to authenticated;
grant select on public.taggi_group_settings to authenticated;
grant select on public.taggi_member_preferences to authenticated;
grant select, insert, update, delete on public.taggi_platforms to authenticated;
grant select, insert on public.taggi_count_events to authenticated;
grant select, insert on public.taggi_messages to authenticated;
grant select on public.taggi_activity_log to authenticated;

revoke execute on all functions in schema private_taggi from public, anon, authenticated;
grant execute on function private_taggi.is_active_member(uuid) to authenticated;
grant execute on function private_taggi.current_role_level(uuid) to authenticated;
revoke execute on function public.taggi_find_group(text) from public;
revoke execute on function public.taggi_create_group(text, text, uuid) from public, anon;
revoke execute on function public.taggi_join_group(text, text) from public, anon;
revoke execute on function public.taggi_touch_presence(uuid) from public, anon;
revoke execute on function public.taggi_complete_tutorial(uuid, boolean) from public, anon;
revoke execute on function public.taggi_update_member_role(uuid, uuid, text, boolean) from public, anon;
revoke execute on function public.taggi_remove_member(uuid, uuid) from public, anon;
revoke execute on function public.taggi_set_initial_admin_password(uuid, text) from public, anon;
revoke execute on function public.taggi_unlock_admin(uuid, text) from public, anon;
revoke execute on function public.taggi_lock_admin(uuid, uuid, text) from public, anon;
revoke execute on function public.taggi_change_admin_password(uuid, text, text) from public, anon;
revoke execute on function public.taggi_admin_adjust_count(uuid, uuid, integer, text, uuid, text) from public, anon;

grant execute on function public.taggi_find_group(text) to anon, authenticated;
grant execute on function public.taggi_create_group(text, text, uuid) to authenticated;
grant execute on function public.taggi_join_group(text, text) to authenticated;
grant execute on function public.taggi_touch_presence(uuid) to authenticated;
grant execute on function public.taggi_complete_tutorial(uuid, boolean) to authenticated;
grant execute on function public.taggi_update_member_role(uuid, uuid, text, boolean) to authenticated;
grant execute on function public.taggi_remove_member(uuid, uuid) to authenticated;
grant execute on function public.taggi_set_initial_admin_password(uuid, text) to authenticated;
grant execute on function public.taggi_unlock_admin(uuid, text) to authenticated;
grant execute on function public.taggi_lock_admin(uuid, uuid, text) to authenticated;
grant execute on function public.taggi_change_admin_password(uuid, text, text) to authenticated;
grant execute on function public.taggi_admin_adjust_count(uuid, uuid, integer, text, uuid, text) to authenticated;

alter table public.taggi_groups replica identity full;
alter table public.taggi_group_members replica identity full;
alter table public.taggi_platforms replica identity full;
alter table public.taggi_count_events replica identity full;
alter table public.taggi_messages replica identity full;
alter table public.taggi_activity_log replica identity full;

alter publication supabase_realtime add table
  public.taggi_groups,
  public.taggi_group_members,
  public.taggi_platforms,
  public.taggi_count_events,
  public.taggi_messages,
  public.taggi_activity_log;

select cron.schedule(
  'taggi-retention-daily',
  '15 6 * * *',
  'select private_taggi.purge_expired_history();'
);

commit;

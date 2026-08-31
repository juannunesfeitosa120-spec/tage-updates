begin;

alter table public.taggi_platforms
  add column if not exists logo_path text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'taggi_platforms_logo_path_length'
      and conrelid = 'public.taggi_platforms'::regclass
  ) then
    alter table public.taggi_platforms
      add constraint taggi_platforms_logo_path_length
      check (logo_path is null or char_length(logo_path) between 3 and 500);
  end if;
end $$;

create table public.taggi_platform_stores (
  id uuid primary key default extensions.gen_random_uuid(),
  group_id uuid not null,
  platform_id uuid not null,
  name text not null check (char_length(trim(name)) between 2 and 100),
  sort_order integer not null default 0,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, platform_id, id),
  constraint taggi_platform_stores_platform_same_group_fkey
    foreign key (group_id, platform_id)
    references public.taggi_platforms(group_id, id)
    on delete cascade
);

create unique index taggi_platform_stores_active_name_unique
  on public.taggi_platform_stores (group_id, platform_id, lower(name))
  where status = 'active';
create index taggi_platform_stores_group_platform_status_idx
  on public.taggi_platform_stores (group_id, platform_id, status, sort_order);
create index taggi_platform_stores_created_by_idx
  on public.taggi_platform_stores (created_by);

insert into public.taggi_platform_stores
  (group_id, platform_id, name, sort_order, created_by)
select p.group_id, p.id, p.store, 1, p.created_by
from public.taggi_platforms p
where not exists (
  select 1
  from public.taggi_platform_stores s
  where s.group_id = p.group_id
    and s.platform_id = p.id
);

alter table public.taggi_count_events
  add column if not exists store_id uuid;

update public.taggi_count_events e
set store_id = (
  select s.id
  from public.taggi_platform_stores s
  where s.group_id = e.group_id
    and s.platform_id = e.platform_id
  order by s.sort_order, s.created_at
  limit 1
)
where e.store_id is null;

alter table public.taggi_count_events
  alter column store_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'taggi_count_events_store_same_platform_fkey'
      and conrelid = 'public.taggi_count_events'::regclass
  ) then
    alter table public.taggi_count_events
      add constraint taggi_count_events_store_same_platform_fkey
      foreign key (group_id, platform_id, store_id)
      references public.taggi_platform_stores(group_id, platform_id, id)
      on delete restrict;
  end if;
end $$;

create index taggi_count_events_store_date_idx
  on public.taggi_count_events (store_id, work_date, created_at desc);

create table public.taggi_feedback (
  id uuid primary key default extensions.gen_random_uuid(),
  group_id uuid not null references public.taggi_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  display_name text not null check (char_length(trim(display_name)) between 2 and 80),
  category text not null check (category in ('sugestao', 'reclamacao', 'problema')),
  body text not null check (char_length(trim(body)) between 5 and 3000),
  status text not null default 'new' check (status in ('new', 'reviewing', 'resolved')),
  handled_by uuid references auth.users(id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);

create index taggi_feedback_group_status_created_idx
  on public.taggi_feedback (group_id, status, created_at desc);
create index taggi_feedback_user_created_idx
  on public.taggi_feedback (user_id, created_at desc);
create index taggi_feedback_handled_by_idx
  on public.taggi_feedback (handled_by)
  where handled_by is not null;

create trigger taggi_platform_stores_updated_at
before update on public.taggi_platform_stores
for each row execute function private_taggi.set_updated_at();

create or replace function private_taggi.enforce_single_company_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' and exists (
    select 1
    from public.taggi_group_members existing
    where existing.user_id = new.user_id
      and existing.group_id <> new.group_id
  ) then
    raise exception using
      errcode = '23505',
      message = 'Este e-mail já está associado a outra empresa. Cada conta pode pertencer a somente uma empresa.';
  end if;
  return new;
end;
$$;

drop trigger if exists taggi_single_company_membership on public.taggi_group_members;
create trigger taggi_single_company_membership
before insert or update of group_id, user_id, status
on public.taggi_group_members
for each row execute function private_taggi.enforce_single_company_membership();

create or replace function private_taggi.shares_active_group(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.taggi_group_members caller
      join public.taggi_group_members target
        on target.group_id = caller.group_id
       and target.status = 'active'
      where caller.user_id = (select auth.uid())
        and caller.status = 'active'
        and target.user_id = target_user_id
    );
$$;

create or replace function private_taggi.prepare_feedback()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_name text;
begin
  if caller_id is null
    or not (select private_taggi.is_active_member(new.group_id)) then
    raise exception using errcode = '42501', message = 'Você não pertence a esta empresa.';
  end if;
  select m.display_name into caller_name
  from public.taggi_group_members m
  where m.group_id = new.group_id
    and m.user_id = caller_id
    and m.status = 'active';
  new.user_id := caller_id;
  new.display_name := caller_name;
  new.body := trim(new.body);
  new.status := 'new';
  new.handled_by := null;
  new.handled_at := null;
  return new;
end;
$$;

create trigger taggi_feedback_prepare
before insert on public.taggi_feedback
for each row execute function private_taggi.prepare_feedback();

create or replace function private_taggi.validate_profile_avatar_path()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.avatar_url is distinct from old.avatar_url
    and new.avatar_url is not null
    and split_part(new.avatar_url, '/', 1) <> new.user_id::text then
    raise exception using errcode = '22023', message = 'Caminho de foto de perfil inválido.';
  end if;
  return new;
end;
$$;

create trigger taggi_profile_avatar_path
before update of avatar_url on public.taggi_profiles
for each row execute function private_taggi.validate_profile_avatar_path();

create or replace function private_taggi.validate_platform_logo_path()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.logo_path is not null
    and (
      split_part(new.logo_path, '/', 1) <> new.group_id::text
      or split_part(new.logo_path, '/', 2) <> new.id::text
    ) then
    raise exception using errcode = '22023', message = 'Caminho de logo inválido.';
  end if;
  return new;
end;
$$;

create trigger taggi_platform_logo_path
before insert or update of logo_path on public.taggi_platforms
for each row execute function private_taggi.validate_platform_logo_path();

alter table public.taggi_platform_stores enable row level security;
alter table public.taggi_platform_stores force row level security;
alter table public.taggi_feedback enable row level security;
alter table public.taggi_feedback force row level security;

create policy taggi_platform_stores_member_select
on public.taggi_platform_stores
for select to authenticated
using ((select private_taggi.is_active_member(group_id)));

create policy taggi_feedback_member_insert
on public.taggi_feedback
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (select private_taggi.is_active_member(group_id))
);

drop policy if exists taggi_profiles_group_select on public.taggi_profiles;
create policy taggi_profiles_group_select
on public.taggi_profiles
for select to authenticated
using ((select private_taggi.shares_active_group(user_id)));

revoke all on public.taggi_platform_stores, public.taggi_feedback
from anon, authenticated;
grant select on public.taggi_platform_stores to authenticated;
grant insert on public.taggi_feedback to authenticated;

revoke insert, update, delete on public.taggi_platforms from authenticated;
drop policy if exists taggi_platforms_authority_insert on public.taggi_platforms;
drop policy if exists taggi_platforms_authority_update on public.taggi_platforms;
drop policy if exists taggi_platforms_authority_delete on public.taggi_platforms;

revoke execute on function private_taggi.enforce_single_company_membership()
from public, anon, authenticated;
revoke execute on function private_taggi.prepare_feedback()
from public, anon, authenticated;
revoke execute on function private_taggi.validate_profile_avatar_path()
from public, anon, authenticated;
revoke execute on function private_taggi.validate_platform_logo_path()
from public, anon, authenticated;
revoke execute on function private_taggi.shares_active_group(uuid)
from public, anon;
grant usage on schema private_taggi to authenticated;
grant execute on function private_taggi.shares_active_group(uuid)
to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'taggi-avatars',
    'taggi-avatars',
    false,
    5242880,
    array['image/jpeg', 'image/png', 'image/webp']
  ),
  (
    'taggi-platform-logos',
    'taggi-platform-logos',
    false,
    5242880,
    array['image/jpeg', 'image/png', 'image/webp']
  )
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists taggi_avatar_select on storage.objects;
drop policy if exists taggi_avatar_insert on storage.objects;
drop policy if exists taggi_avatar_update on storage.objects;
drop policy if exists taggi_avatar_delete on storage.objects;
drop policy if exists taggi_platform_logo_select on storage.objects;
drop policy if exists taggi_platform_logo_insert on storage.objects;
drop policy if exists taggi_platform_logo_update on storage.objects;
drop policy if exists taggi_platform_logo_delete on storage.objects;

create policy taggi_avatar_select
on storage.objects for select to authenticated
using (
  bucket_id = 'taggi-avatars'
  and (storage.foldername(name))[1] ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (select private_taggi.shares_active_group(((storage.foldername(name))[1])::uuid))
);

create policy taggi_avatar_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'taggi-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy taggi_avatar_update
on storage.objects for update to authenticated
using (
  bucket_id = 'taggi-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'taggi-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy taggi_avatar_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'taggi-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy taggi_platform_logo_select
on storage.objects for select to authenticated
using (
  bucket_id = 'taggi-platform-logos'
  and (storage.foldername(name))[1] ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (select private_taggi.is_active_member(((storage.foldername(name))[1])::uuid))
);

create policy taggi_platform_logo_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'taggi-platform-logos'
  and (storage.foldername(name))[1] ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (select private_taggi.current_role_level(((storage.foldername(name))[1])::uuid)) >= 2
);

create policy taggi_platform_logo_update
on storage.objects for update to authenticated
using (
  bucket_id = 'taggi-platform-logos'
  and (storage.foldername(name))[1] ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (select private_taggi.current_role_level(((storage.foldername(name))[1])::uuid)) >= 2
)
with check (
  bucket_id = 'taggi-platform-logos'
  and (storage.foldername(name))[1] ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (select private_taggi.current_role_level(((storage.foldername(name))[1])::uuid)) >= 2
);

create policy taggi_platform_logo_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'taggi-platform-logos'
  and (storage.foldername(name))[1] ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (select private_taggi.current_role_level(((storage.foldername(name))[1])::uuid)) >= 2
);

create or replace function public.taggi_unlock_admin(
  p_group_id uuid,
  p_password text
)
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
  if (select private_taggi.current_role_level(p_group_id)) < 2 then
    raise exception using errcode = '42501', message = 'Somente Administrativos e Gestores podem acessar esta área.';
  end if;
  select c.password_hash into stored_hash
  from private_taggi.admin_credentials c
  where c.group_id = p_group_id;
  if stored_hash is null or extensions.crypt(p_password, stored_hash) <> stored_hash then
    raise exception using errcode = '28P01', message = 'Senha da Administração incorreta.';
  end if;
  raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  select now() + make_interval(mins => s.admin_session_minutes)
  into new_expires_at
  from public.taggi_group_settings s
  where s.group_id = p_group_id;
  insert into private_taggi.admin_sessions
    (id, group_id, user_id, token_hash, expires_at)
  values
    (new_session_id, p_group_id, caller_id, extensions.digest(raw_token, 'sha256'), new_expires_at);
  return query select new_session_id, raw_token, new_expires_at;
end;
$$;

create or replace function public.taggi_admin_create_platform(
  p_group_id uuid,
  p_name text,
  p_store_name text,
  p_accent text,
  p_session_id uuid,
  p_session_token text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  clean_name text := trim(p_name);
  clean_store text := trim(p_store_name);
  clean_accent text := lower(trim(p_accent));
  new_platform_id uuid;
  caller_name text;
begin
  if not (select private_taggi.admin_session_valid(p_group_id, p_session_id, p_session_token))
    or (select private_taggi.current_role_level(p_group_id)) < 2 then
    raise exception using errcode = '42501', message = 'Ação administrativa não autorizada.';
  end if;
  if char_length(clean_name) not between 2 and 100
    or char_length(clean_store) not between 2 and 100
    or clean_accent !~ '^#[0-9a-f]{6}$' then
    raise exception using errcode = '22023', message = 'Informe plataforma, primeira loja e cor válidas.';
  end if;

  insert into public.taggi_platforms
    (group_id, name, store, initials, accent, brand_color, sort_order, created_by)
  values (
    p_group_id,
    clean_name,
    clean_store,
    left(upper(regexp_replace(clean_name, '[^[:alnum:]]', '', 'g')), 2),
    clean_accent,
    clean_accent,
    coalesce((
      select max(p.sort_order) + 1
      from public.taggi_platforms p
      where p.group_id = p_group_id
    ), 1),
    caller_id
  )
  returning id into new_platform_id;

  insert into public.taggi_platform_stores
    (group_id, platform_id, name, sort_order, created_by)
  values (p_group_id, new_platform_id, clean_store, 1, caller_id);

  select m.display_name into caller_name
  from public.taggi_group_members m
  where m.group_id = p_group_id and m.user_id = caller_id;
  insert into public.taggi_activity_log
    (group_id, user_id, display_name, activity_type, summary, metadata)
  values (
    p_group_id,
    caller_id,
    caller_name,
    'platform_created',
    clean_name || ' foi adicionada.',
    jsonb_build_object('platform_id', new_platform_id)
  );

  return new_platform_id;
end;
$$;

create or replace function public.taggi_admin_update_platform(
  p_group_id uuid,
  p_platform_id uuid,
  p_name text,
  p_accent text,
  p_logo_path text,
  p_session_id uuid,
  p_session_token text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_name text := trim(p_name);
  clean_accent text := lower(trim(p_accent));
begin
  if not (select private_taggi.admin_session_valid(p_group_id, p_session_id, p_session_token))
    or (select private_taggi.current_role_level(p_group_id)) < 2 then
    raise exception using errcode = '42501', message = 'Ação administrativa não autorizada.';
  end if;
  if char_length(clean_name) not between 2 and 100
    or clean_accent !~ '^#[0-9a-f]{6}$'
    or (
      p_logo_path is not null
      and (
        split_part(p_logo_path, '/', 1) <> p_group_id::text
        or split_part(p_logo_path, '/', 2) <> p_platform_id::text
      )
    ) then
    raise exception using errcode = '22023', message = 'Configuração de plataforma inválida.';
  end if;
  update public.taggi_platforms
  set name = clean_name,
      initials = left(upper(regexp_replace(clean_name, '[^[:alnum:]]', '', 'g')), 2),
      accent = clean_accent,
      brand_color = clean_accent,
      logo_path = p_logo_path
  where id = p_platform_id
    and group_id = p_group_id
    and status = 'active';
  if not found then
    raise exception using errcode = 'P0002', message = 'Plataforma não encontrada.';
  end if;
end;
$$;

create or replace function public.taggi_admin_add_store(
  p_group_id uuid,
  p_platform_id uuid,
  p_name text,
  p_session_id uuid,
  p_session_token text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  clean_name text := trim(p_name);
  new_store_id uuid;
begin
  if not (select private_taggi.admin_session_valid(p_group_id, p_session_id, p_session_token))
    or (select private_taggi.current_role_level(p_group_id)) < 2 then
    raise exception using errcode = '42501', message = 'Ação administrativa não autorizada.';
  end if;
  if char_length(clean_name) not between 2 and 100 then
    raise exception using errcode = '22023', message = 'Informe um nome de loja válido.';
  end if;
  if not exists (
    select 1
    from public.taggi_platforms p
    where p.id = p_platform_id
      and p.group_id = p_group_id
      and p.status = 'active'
  ) then
    raise exception using errcode = 'P0002', message = 'Plataforma não encontrada.';
  end if;
  insert into public.taggi_platform_stores
    (group_id, platform_id, name, sort_order, created_by)
  values (
    p_group_id,
    p_platform_id,
    clean_name,
    coalesce((
      select max(s.sort_order) + 1
      from public.taggi_platform_stores s
      where s.group_id = p_group_id and s.platform_id = p_platform_id
    ), 1),
    caller_id
  )
  returning id into new_store_id;
  return new_store_id;
end;
$$;

create or replace function public.taggi_admin_archive_store(
  p_group_id uuid,
  p_store_id uuid,
  p_session_id uuid,
  p_session_token text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_platform_id uuid;
begin
  if not (select private_taggi.admin_session_valid(p_group_id, p_session_id, p_session_token))
    or (select private_taggi.current_role_level(p_group_id)) < 2 then
    raise exception using errcode = '42501', message = 'Ação administrativa não autorizada.';
  end if;
  select s.platform_id into target_platform_id
  from public.taggi_platform_stores s
  where s.id = p_store_id
    and s.group_id = p_group_id
    and s.status = 'active';
  if target_platform_id is null then
    raise exception using errcode = 'P0002', message = 'Loja não encontrada.';
  end if;
  if (
    select count(*)
    from public.taggi_platform_stores s
    where s.group_id = p_group_id
      and s.platform_id = target_platform_id
      and s.status = 'active'
  ) <= 1 then
    raise exception using errcode = '22023', message = 'A plataforma precisa manter pelo menos uma loja ativa.';
  end if;
  update public.taggi_platform_stores
  set status = 'archived'
  where id = p_store_id and group_id = p_group_id;
end;
$$;

create or replace function public.taggi_admin_list_feedbacks(
  p_group_id uuid,
  p_session_id uuid,
  p_session_token text
)
returns table (
  feedback_id uuid,
  category text,
  body text,
  feedback_status text,
  user_id uuid,
  display_name text,
  created_at timestamptz,
  handled_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private_taggi.admin_session_valid(p_group_id, p_session_id, p_session_token))
    or (select private_taggi.current_role_level(p_group_id)) < 2 then
    raise exception using errcode = '42501', message = 'Ação administrativa não autorizada.';
  end if;
  return query
  select f.id, f.category, f.body, f.status, f.user_id, f.display_name,
         f.created_at, f.handled_at
  from public.taggi_feedback f
  where f.group_id = p_group_id
  order by
    case f.status when 'new' then 1 when 'reviewing' then 2 else 3 end,
    f.created_at desc
  limit 200;
end;
$$;

create or replace function public.taggi_admin_set_feedback_status(
  p_group_id uuid,
  p_feedback_id uuid,
  p_status text,
  p_session_id uuid,
  p_session_token text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private_taggi.admin_session_valid(p_group_id, p_session_id, p_session_token))
    or (select private_taggi.current_role_level(p_group_id)) < 2 then
    raise exception using errcode = '42501', message = 'Ação administrativa não autorizada.';
  end if;
  if p_status not in ('new', 'reviewing', 'resolved') then
    raise exception using errcode = '22023', message = 'Status de feedback inválido.';
  end if;
  update public.taggi_feedback
  set status = p_status,
      handled_by = case when p_status = 'new' then null else (select auth.uid()) end,
      handled_at = case when p_status = 'new' then null else now() end
  where id = p_feedback_id and group_id = p_group_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Feedback não encontrado.';
  end if;
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
  chosen_store_id uuid;
begin
  if not (select private_taggi.admin_session_valid(p_group_id, p_session_id, p_session_token))
    or (select private_taggi.current_role_level(p_group_id)) < 2 then
    raise exception using errcode = '42501', message = 'A Administração está bloqueada.';
  end if;
  if p_delta = 0 or char_length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception using errcode = '22023', message = 'Informe o ajuste e o motivo.';
  end if;
  select s.id into chosen_store_id
  from public.taggi_platform_stores s
  where s.group_id = p_group_id
    and s.platform_id = p_platform_id
    and s.status = 'active'
  order by s.sort_order, s.created_at
  limit 1;
  if chosen_store_id is null then
    raise exception using errcode = 'P0002', message = 'A plataforma não possui loja ativa.';
  end if;
  insert into public.taggi_count_events
    (group_id, platform_id, store_id, event_type, delta, reason)
  values
    (p_group_id, p_platform_id, chosen_store_id, 'admin_adjustment', p_delta, trim(p_reason))
  returning id into new_event_id;
  return new_event_id;
end;
$$;

revoke execute on function public.taggi_admin_create_platform(uuid, text, text, text, uuid, text)
from public, anon;
revoke execute on function public.taggi_admin_update_platform(uuid, uuid, text, text, text, uuid, text)
from public, anon;
revoke execute on function public.taggi_admin_add_store(uuid, uuid, text, uuid, text)
from public, anon;
revoke execute on function public.taggi_admin_archive_store(uuid, uuid, uuid, text)
from public, anon;
revoke execute on function public.taggi_admin_list_feedbacks(uuid, uuid, text)
from public, anon;
revoke execute on function public.taggi_admin_set_feedback_status(uuid, uuid, text, uuid, text)
from public, anon;

grant execute on function public.taggi_admin_create_platform(uuid, text, text, text, uuid, text)
to authenticated;
grant execute on function public.taggi_admin_update_platform(uuid, uuid, text, text, text, uuid, text)
to authenticated;
grant execute on function public.taggi_admin_add_store(uuid, uuid, text, uuid, text)
to authenticated;
grant execute on function public.taggi_admin_archive_store(uuid, uuid, uuid, text)
to authenticated;
grant execute on function public.taggi_admin_list_feedbacks(uuid, uuid, text)
to authenticated;
grant execute on function public.taggi_admin_set_feedback_status(uuid, uuid, text, uuid, text)
to authenticated;

alter table public.taggi_platform_stores replica identity full;
alter table public.taggi_feedback replica identity full;
alter publication supabase_realtime add table
  public.taggi_platform_stores,
  public.taggi_feedback;

commit;

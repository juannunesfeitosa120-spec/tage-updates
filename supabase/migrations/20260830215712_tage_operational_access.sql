begin;

create table if not exists private_taggi.default_team_bootstrap_credentials (
  id boolean primary key default true check (id),
  password_hash text not null,
  updated_at timestamptz not null default now()
);

create table if not exists private_taggi.team_access_credentials (
  group_id uuid primary key references public.taggi_groups(id) on delete cascade,
  password_hash text not null,
  changed_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.taggi_system_settings (
  key text primary key,
  value jsonb not null,
  description text not null default '',
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.taggi_system_settings enable row level security;
alter table public.taggi_system_settings force row level security;

revoke all on table public.taggi_system_settings
from public, anon, authenticated;

revoke all on table
  private_taggi.default_team_bootstrap_credentials,
  private_taggi.team_access_credentials
from public, anon, authenticated;

insert into private_taggi.default_team_bootstrap_credentials
  (id, password_hash)
values
  (true, extensions.crypt('operacao', extensions.gen_salt('bf', 12)))
on conflict (id) do nothing;

-- The first operational login may create the one default team, but ordinary
-- anonymous users still cannot create companies through the public signup RPC.
create or replace function private_taggi.reject_anonymous_group_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false)
    and coalesce(
      pg_catalog.current_setting('tage.default_team_bootstrap', true),
      ''
    ) <> 'enabled' then
    raise exception using
      errcode = '42501',
      message = 'Entre com uma conta confirmada para criar uma empresa.';
  end if;
  return new;
end;
$$;

-- Automatic setup is intentionally limited to single-company installations.
-- Multi-company installations must select a team explicitly in this protected
-- owner setting before the simplified entry is enabled.
insert into public.taggi_system_settings (key, value, description)
select
  'default_team_group_id',
  to_jsonb(g.id::text),
  'Equipe usada pela entrada simplificada do aplicativo Tage.'
from public.taggi_groups g
where g.status = 'active'
  and (select count(*) from public.taggi_groups where status = 'active') = 1
limit 1
on conflict (key) do nothing;

insert into private_taggi.team_access_credentials (group_id, password_hash)
select
  g.id,
  extensions.crypt('operacao', extensions.gen_salt('bf', 12))
from public.taggi_groups g
join public.taggi_system_settings setting
  on setting.key = 'default_team_group_id'
 and g.id = (setting.value #>> '{}')::uuid
where g.status = 'active'
on conflict (group_id) do nothing;

insert into private_taggi.admin_credentials (group_id, password_hash, changed_by)
select
  g.id,
  extensions.crypt('admin123', extensions.gen_salt('bf', 12)),
  g.created_by
from public.taggi_groups g
join public.taggi_system_settings setting
  on setting.key = 'default_team_group_id'
 and g.id = (setting.value #>> '{}')::uuid
where g.status = 'active'
on conflict (group_id) do nothing;

update public.taggi_groups g
set admin_password_configured_at = coalesce(g.admin_password_configured_at, now())
where exists (
  select 1
  from private_taggi.admin_credentials credential
  where credential.group_id = g.id
)
and g.id = (
  select (setting.value #>> '{}')::uuid
  from public.taggi_system_settings setting
  where setting.key = 'default_team_group_id'
);

create or replace function public.taggi_join_default_team(
  p_display_name text,
  p_password text
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
  selected_group public.taggi_groups%rowtype;
  clean_display_name text := trim(p_display_name);
  stored_hash text;
  bootstrap_hash text;
  caller_email text;
  created_group_id uuid;
  was_active boolean := false;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'Não foi possível identificar este dispositivo.';
  end if;
  if char_length(clean_display_name) not between 2 and 80 then
    raise exception using errcode = '22023', message = 'Informe o seu nome na equipe.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('tage.default_team_bootstrap', 0)
  );

  select g.* into selected_group
  from public.taggi_groups g
  where g.id = (
    select (setting.value #>> '{}')::uuid
    from public.taggi_system_settings setting
    where setting.key = 'default_team_group_id'
  )
    and g.status = 'active';

  if selected_group.id is null then
    if exists (
      select 1 from public.taggi_groups group_record
      where group_record.status = 'active'
    ) then
      raise exception using
        errcode = 'P0002',
        message = 'A equipe padrão precisa ser selecionada pela Administração.';
    end if;

    select credential.password_hash into bootstrap_hash
    from private_taggi.default_team_bootstrap_credentials credential
    where credential.id = true;

    if bootstrap_hash is null
      or extensions.crypt(coalesce(p_password, ''), bootstrap_hash) <> bootstrap_hash then
      raise exception using errcode = '28P01', message = 'Senha da equipe incorreta.';
    end if;

    perform pg_catalog.set_config(
      'tage.default_team_bootstrap',
      'enabled',
      true
    );

    select created.group_id into created_group_id
    from public.taggi_create_group(
      'Tage',
      clean_display_name,
      extensions.gen_random_uuid()
    ) created;

    select group_record.* into selected_group
    from public.taggi_groups group_record
    where group_record.id = created_group_id
      and group_record.status = 'active';

    if selected_group.id is null then
      raise exception using
        errcode = 'P0002',
        message = 'Não foi possível iniciar a equipe Tage.';
    end if;

    insert into public.taggi_system_settings (key, value, description)
    values (
      'default_team_group_id',
      to_jsonb(selected_group.id::text),
      'Equipe usada pela entrada simplificada do aplicativo Tage.'
    )
    on conflict (key) do update
      set value = excluded.value,
          description = excluded.description,
          updated_at = now();

    insert into private_taggi.team_access_credentials
      (group_id, password_hash, changed_by)
    values
      (selected_group.id, bootstrap_hash, caller_id)
    on conflict (group_id) do nothing;

    insert into private_taggi.admin_credentials
      (group_id, password_hash, changed_by)
    values (
      selected_group.id,
      extensions.crypt('admin123', extensions.gen_salt('bf', 12)),
      caller_id
    )
    on conflict (group_id) do nothing;

    update public.taggi_groups
    set admin_password_configured_at = coalesce(
          admin_password_configured_at,
          now()
        ),
        updated_at = now()
    where id = selected_group.id;

    selected_group.admin_password_configured_at := now();
    stored_hash := bootstrap_hash;
    was_active := true;
  else
    select credential.password_hash into stored_hash
    from private_taggi.team_access_credentials credential
    where credential.group_id = selected_group.id;

    if stored_hash is null
      or extensions.crypt(coalesce(p_password, ''), stored_hash) <> stored_hash then
      raise exception using errcode = '28P01', message = 'Senha da equipe incorreta.';
    end if;

    select exists (
      select 1
      from public.taggi_group_members member
      where member.group_id = selected_group.id
        and member.user_id = caller_id
        and member.status = 'active'
    ) into was_active;
  end if;

  insert into public.taggi_group_members
    (group_id, user_id, display_name, role, status)
  values
    (selected_group.id, caller_id, clean_display_name, 'employee', 'active')
  on conflict on constraint taggi_group_members_group_id_user_id_key do update
    set display_name = excluded.display_name,
        role = case
          when public.taggi_group_members.status = 'active'
            then public.taggi_group_members.role
          else 'employee'
        end,
        status = 'active',
        last_seen_at = now(),
        updated_at = now();

  insert into public.taggi_member_preferences (group_id, user_id)
  values (selected_group.id, caller_id)
  on conflict on constraint taggi_member_preferences_pkey do nothing;

  select auth_user.email into caller_email
  from auth.users auth_user
  where auth_user.id = caller_id;

  insert into public.taggi_profiles (user_id, display_name, email)
  values (caller_id, clean_display_name, coalesce(caller_email, ''))
  on conflict (user_id) do update
    set display_name = excluded.display_name,
        email = excluded.email,
        updated_at = now();

  if not was_active then
    insert into public.taggi_activity_log
      (group_id, user_id, display_name, activity_type, summary)
    values (
      selected_group.id,
      caller_id,
      clean_display_name,
      'member_joined',
      clean_display_name || ' entrou na equipe.'
    );
  end if;

  return query
  select
    selected_group.id,
    selected_group.code,
    selected_group.name,
    member.display_name,
    member.role,
    preference.tutorial_completed_at,
    selected_group.admin_password_configured_at is not null
  from public.taggi_group_members member
  join public.taggi_member_preferences preference
    on preference.group_id = member.group_id
   and preference.user_id = member.user_id
  where member.group_id = selected_group.id
    and member.user_id = caller_id;
end;
$$;

revoke execute on function public.taggi_join_default_team(text, text)
from public, anon;
grant execute on function public.taggi_join_default_team(text, text)
to authenticated;

create or replace function public.taggi_update_member_role_via_admin(
  p_group_id uuid,
  p_target_user_id uuid,
  p_new_role text,
  p_session_id uuid,
  p_session_token text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  target_name text;
  target_role text;
  caller_name text;
begin
  if not (
    select private_taggi.admin_session_valid(
      p_group_id,
      p_session_id,
      p_session_token
    )
  ) then
    raise exception using errcode = '42501', message = 'A Administração está bloqueada.';
  end if;

  if p_new_role not in ('employee', 'administrative', 'manager') then
    raise exception using errcode = '22023', message = 'Cargo inválido.';
  end if;

  select member.display_name, member.role
  into target_name, target_role
  from public.taggi_group_members member
  where member.group_id = p_group_id
    and member.user_id = p_target_user_id
    and member.status = 'active'
  for update;

  if target_name is null then
    raise exception using errcode = 'P0002', message = 'Membro não encontrado.';
  end if;

  update public.taggi_group_members
  set role = p_new_role,
      updated_at = now()
  where group_id = p_group_id
    and user_id = p_target_user_id;

  select member.display_name into caller_name
  from public.taggi_group_members member
  where member.group_id = p_group_id
    and member.user_id = caller_id
    and member.status = 'active';

  insert into public.taggi_activity_log
    (group_id, user_id, display_name, activity_type, summary, metadata)
  values (
    p_group_id,
    caller_id,
    caller_name,
    'member_role_changed',
    target_name || ' agora é ' || case p_new_role
      when 'employee' then 'Funcionário'
      when 'administrative' then 'Administrativo'
      else 'Gestor'
    end || '.',
    jsonb_build_object(
      'target_user_id', p_target_user_id,
      'old_role', target_role,
      'new_role', p_new_role,
      'authorized_by_admin_session', true
    )
  );

  return p_new_role;
end;
$$;

revoke execute on function public.taggi_update_member_role_via_admin(
  uuid, uuid, text, uuid, text
) from public, anon;
grant execute on function public.taggi_update_member_role_via_admin(
  uuid, uuid, text, uuid, text
) to authenticated;

commit;

-- A Tage device identity can belong to multiple teams. Keep legacy email-account
-- restrictions in the existing triggers, and keep (group_id,user_id) uniqueness.
drop index if exists public.taggi_group_members_one_active_company_idx;

create or replace function private_taggi.enforce_one_active_company()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists(select 1 from auth.users u where u.id=new.user_id and u.is_anonymous) then
    return new;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tage.legacy-membership:'||new.user_id::text,0));
  if new.status='active' and exists(
    select 1 from public.taggi_group_members m
    where m.user_id=new.user_id and m.status='active' and m.group_id<>new.group_id
  ) then
    raise exception using errcode='23505',message='Cada conta pode participar de apenas uma empresa. Use outro e-mail para cadastrar ou entrar em outra empresa.';
  end if;
  return new;
end;
$$;

create or replace function private_taggi.enforce_single_company_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists(select 1 from auth.users u where u.id=new.user_id and u.is_anonymous) then
    return new;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tage.legacy-membership:'||new.user_id::text,0));
  if new.status='active' and exists(
    select 1 from public.taggi_group_members existing
    where existing.user_id=new.user_id and existing.group_id<>new.group_id
  ) then
    raise exception using errcode='23505',message='Este e-mail já está associado a outra empresa. Cada conta pode pertencer a somente uma empresa.';
  end if;
  return new;
end;
$$;

create or replace function public.taggi_create_team_secure(
  p_display_name text,
  p_team_name text,
  p_member_password text,
  p_admin_password text
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
  clean_display_name text := pg_catalog.btrim(coalesce(p_display_name, ''));
  clean_team_name text := pg_catalog.btrim(coalesce(p_team_name, ''));
  clean_username_key text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_display_name, '')));
  caller_email text;
  selected_group public.taggi_groups%rowtype;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'Não foi possível identificar este dispositivo.';
  end if;
  if char_length(clean_display_name) not between 2 and 80 then
    raise exception using errcode = '22023', message = 'Informe o seu nome na equipe.';
  end if;
  if char_length(clean_team_name) not between 2 and 100 then
    raise exception using errcode = '22023', message = 'Informe um nome válido para a equipe.';
  end if;
  if char_length(coalesce(p_member_password, '')) < 8 then
    raise exception using errcode = '22023', message = 'A senha pessoal precisa ter pelo menos 8 caracteres.';
  end if;
  if char_length(coalesce(p_admin_password, '')) < 8 then
    raise exception using errcode = '22023', message = 'A senha da Administração precisa ter pelo menos 8 caracteres.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('tage.team-create:' || caller_id::text, 0)
  );

  perform pg_catalog.set_config('tage.team_creation', 'enabled', true);

  insert into public.taggi_groups (
    name,
    code,
    created_by,
    creation_request_id,
    admin_password_configured_at
  )
  values (
    clean_team_name,
    private_taggi.generate_group_code(),
    caller_id,
    extensions.gen_random_uuid(),
    now()
  )
  returning * into selected_group;

  insert into public.taggi_group_members (
    group_id,
    user_id,
    display_name,
    role,
    status
  )
  values (
    selected_group.id,
    caller_id,
    clean_display_name,
    'manager',
    'active'
  );

  insert into public.taggi_group_settings (group_id)
  values (selected_group.id)
  on conflict on constraint taggi_group_settings_pkey do nothing;

  insert into public.taggi_member_preferences (group_id, user_id)
  values (selected_group.id, caller_id)
  on conflict on constraint taggi_member_preferences_pkey do nothing;

  insert into private_taggi.admin_credentials (group_id, password_hash, changed_by)
  values (
    selected_group.id,
    extensions.crypt(p_admin_password, extensions.gen_salt('bf', 12)),
    caller_id
  );

  insert into private_taggi.member_login_credentials (
    group_id,
    user_id,
    username_key,
    password_hash
  )
  values (
    selected_group.id,
    caller_id,
    clean_username_key,
    extensions.crypt(p_member_password, extensions.gen_salt('bf', 12))
  );

  select auth_user.email into caller_email
  from auth.users auth_user
  where auth_user.id = caller_id;

  insert into public.taggi_profiles (user_id, display_name, email)
  values (caller_id, clean_display_name, coalesce(caller_email, ''))
  on conflict (user_id) do update
    set display_name = excluded.display_name,
        email = excluded.email,
        updated_at = now();

  insert into public.taggi_activity_log (
    group_id,
    user_id,
    display_name,
    activity_type,
    summary
  )
  values
    (
      selected_group.id,
      caller_id,
      clean_display_name,
      'group_created',
      clean_display_name || ' criou a equipe.'
    ),
    (
      selected_group.id,
      caller_id,
      clean_display_name,
      'member_joined',
      clean_display_name || ' entrou na equipe.'
    );

  return query
  select
    selected_group.id,
    selected_group.code,
    selected_group.name,
    member.display_name,
    member.role,
    preference.tutorial_completed_at,
    true
  from public.taggi_group_members member
  join public.taggi_member_preferences preference
    on preference.group_id = member.group_id
   and preference.user_id = member.user_id
  where member.group_id = selected_group.id
    and member.user_id = caller_id
    and member.status = 'active';
end;
$$;

create or replace function public.taggi_join_team_secure(
  p_display_name text,
  p_team_code text,
  p_member_password text
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
  clean_display_name text := pg_catalog.btrim(coalesce(p_display_name, ''));
  clean_username_key text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_display_name, '')));
  selected_group public.taggi_groups%rowtype;
  existing_credential private_taggi.member_login_credentials%rowtype;
  caller_email text;
  was_active boolean := false;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'Não foi possível identificar este dispositivo.';
  end if;
  if char_length(clean_display_name) not between 2 and 80 then
    raise exception using errcode = '22023', message = 'Informe o seu nome na equipe.';
  end if;
  if char_length(coalesce(p_member_password, '')) < 8 then
    raise exception using errcode = '22023', message = 'A senha pessoal precisa ter pelo menos 8 caracteres.';
  end if;

  select team.* into selected_group
  from public.taggi_groups team
  where team.code = private_taggi.normalize_group_code(p_team_code)
    and team.status = 'active'
  limit 1;

  if selected_group.id is null then
    raise exception using errcode = 'P0002', message = 'Não encontramos uma equipe ativa com esse código.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'tage.team-login:' || selected_group.id::text || ':' || clean_username_key,
      0
    )
  );

  select credential.* into existing_credential
  from private_taggi.member_login_credentials credential
  where credential.group_id = selected_group.id
    and credential.username_key = clean_username_key
  limit 1;

  if existing_credential.user_id is not null then
    if existing_credential.user_id <> caller_id then
      raise exception using
        errcode = '42501',
        message = 'Este usuário já está vinculado a outro dispositivo. Use o computador onde o acesso foi salvo.';
    end if;
    if existing_credential.password_hash <> extensions.crypt(p_member_password, existing_credential.password_hash) then
      raise exception using errcode = '28P01', message = 'Nome ou senha pessoal incorretos.';
    end if;
  end if;

  select exists (
    select 1
    from public.taggi_group_members member
    where member.group_id = selected_group.id
      and member.user_id = caller_id
      and member.status = 'active'
  ) into was_active;

  if existing_credential.user_id is null and not was_active and exists (
    select 1
    from public.taggi_group_members member
    where member.group_id = selected_group.id
      and pg_catalog.lower(pg_catalog.btrim(member.display_name)) = clean_username_key
      and member.user_id <> caller_id
      and member.status = 'active'
  ) then
    raise exception using errcode = '23505', message = 'Este nome de usuário já está em uso nesta equipe.';
  end if;

  insert into public.taggi_group_members (
    group_id,
    user_id,
    display_name,
    role,
    status
  )
  values (
    selected_group.id,
    caller_id,
    clean_display_name,
    'employee',
    'active'
  )
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

  insert into private_taggi.member_login_credentials (
    group_id,
    user_id,
    username_key,
    password_hash
  )
  values (
    selected_group.id,
    caller_id,
    clean_username_key,
    extensions.crypt(p_member_password, extensions.gen_salt('bf', 12))
  )
  on conflict on constraint member_login_credentials_pkey do update
    set username_key = excluded.username_key,
        password_hash = case
          when private_taggi.member_login_credentials.password_hash = extensions.crypt(
            p_member_password,
            private_taggi.member_login_credentials.password_hash
          ) then private_taggi.member_login_credentials.password_hash
          else excluded.password_hash
        end,
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
    insert into public.taggi_activity_log (
      group_id,
      user_id,
      display_name,
      activity_type,
      summary
    )
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
    and member.user_id = caller_id
    and member.status = 'active';
end;
$$;


-- Delete only the explicitly confirmed team. Personal accounts/profiles are shared.
create or replace function private_taggi.delete_team(
  p_group_id uuid,
  p_session_id uuid,
  p_session_token text,
  p_admin_password text,
  p_confirmation_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  team_name text;
  stored_hash text;
  queued_files integer := 0;
begin
  if caller_id is null or not coalesce(
    private_taggi.admin_session_valid(p_group_id, p_session_id, p_session_token), false
  ) then
    raise exception using errcode = '42501', message = 'Autorize a Administração desta equipe antes de excluí-la.';
  end if;

  select team.name into team_name
  from public.taggi_groups team
  where team.id = p_group_id and team.status = 'active'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Equipe não encontrada ou já excluída.';
  end if;

  if pg_catalog.btrim(coalesce(p_confirmation_name, '')) <> team_name then
    raise exception using errcode = '22023', message = 'Digite exatamente o nome da equipe para confirmar.';
  end if;

  select credential.password_hash into stored_hash
  from private_taggi.admin_credentials credential
  where credential.group_id = p_group_id
  for update;
  if stored_hash is null or
    extensions.crypt(coalesce(p_admin_password, ''), stored_hash) <> stored_hash then
    raise exception using errcode = '28P01', message = 'Senha da Administração incorreta.';
  end if;

  -- Storage must be removed through the API, never by deleting storage metadata.
  -- The existing worker drains this durable queue every 15 minutes.
  insert into private_taggi.chat_file_cleanup_queue (bucket_id, object_path)
  select object.bucket_id, object.name
  from storage.objects object
  where object.bucket_id in ('taggi-chat', 'taggi-platform-logos')
    and object.name like p_group_id::text || '/%'
  on conflict (object_path) do nothing;
  get diagnostics queued_files = row_count;

  -- All operational children have cascading foreign keys; shared profiles do not.
  delete from public.taggi_groups where id = p_group_id;

  return pg_catalog.jsonb_build_object(
    'deleted_group_id', p_group_id,
    'queued_files', queued_files
  );
end;
$$;

revoke all on function private_taggi.delete_team(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function private_taggi.delete_team(uuid, uuid, text, text, text) to authenticated;

create or replace function public.taggi_delete_team(
  p_group_id uuid,
  p_session_id uuid,
  p_session_token text,
  p_admin_password text,
  p_confirmation_name text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private_taggi.delete_team(
    p_group_id, p_session_id, p_session_token, p_admin_password, p_confirmation_name
  );
$$;

revoke all on function public.taggi_delete_team(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.taggi_delete_team(uuid, uuid, text, text, text) to authenticated;

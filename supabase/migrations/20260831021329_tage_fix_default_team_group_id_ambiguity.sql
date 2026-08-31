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
    on conflict on constraint team_access_credentials_pkey do nothing;

    insert into private_taggi.admin_credentials
      (group_id, password_hash, changed_by)
    values (
      selected_group.id,
      extensions.crypt('admin123', extensions.gen_salt('bf', 12)),
      caller_id
    )
    on conflict on constraint admin_credentials_pkey do nothing;

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

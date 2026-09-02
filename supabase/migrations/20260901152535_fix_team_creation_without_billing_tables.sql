-- Team creation is part of the free Tage Beta flow and must not depend on the
-- optional owner billing schema, which is not installed in every deployment.
create or replace function public.taggi_create_team(
  p_display_name text,
  p_team_name text
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
  caller_email text;
  selected_group public.taggi_groups%rowtype;
begin
  if caller_id is null then
    raise exception using
      errcode = '42501',
      message = 'Não foi possível identificar este dispositivo.';
  end if;
  if char_length(clean_display_name) not between 2 and 80 then
    raise exception using
      errcode = '22023',
      message = 'Informe o seu nome na equipe.';
  end if;
  if char_length(clean_team_name) not between 2 and 100 then
    raise exception using
      errcode = '22023',
      message = 'Informe um nome válido para a equipe.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('tage.team-create:' || caller_id::text, 0)
  );

  select team.* into selected_group
  from public.taggi_group_members member
  join public.taggi_groups team on team.id = member.group_id
  where member.user_id = caller_id
    and member.status = 'active'
    and team.status = 'active'
  order by member.joined_at desc
  limit 1;

  if selected_group.id is null then
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

    insert into private_taggi.admin_credentials (
      group_id,
      password_hash,
      changed_by
    )
    values (
      selected_group.id,
      extensions.crypt('admin123', extensions.gen_salt('bf', 12)),
      caller_id
    )
    on conflict on constraint admin_credentials_pkey do update
      set password_hash = excluded.password_hash,
          changed_by = excluded.changed_by,
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
  elsif selected_group.created_by <> caller_id then
    raise exception using
      errcode = '23505',
      message = 'Você já participa de outra equipe.';
  end if;

  select auth_user.email into caller_email
  from auth.users auth_user
  where auth_user.id = caller_id;

  insert into public.taggi_profiles (user_id, display_name, email)
  values (caller_id, clean_display_name, coalesce(caller_email, ''))
  on conflict (user_id) do update
    set display_name = excluded.display_name,
        email = excluded.email,
        updated_at = now();

  update public.taggi_group_members
  set display_name = clean_display_name,
      last_seen_at = now(),
      updated_at = now()
  where group_id = selected_group.id
    and user_id = caller_id
    and status = 'active';

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

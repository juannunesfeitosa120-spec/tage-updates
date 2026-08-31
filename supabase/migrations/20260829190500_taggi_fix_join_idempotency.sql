begin;

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

revoke execute on function public.taggi_join_group(text, text) from public, anon;
grant execute on function public.taggi_join_group(text, text) to authenticated;

commit;

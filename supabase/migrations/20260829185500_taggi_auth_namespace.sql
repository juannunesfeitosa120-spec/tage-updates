begin;

create or replace function private_taggi.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  fallback_name text;
begin
  if coalesce(new.raw_user_meta_data ->> 'app', '') <> 'taggi' then
    return new;
  end if;
  fallback_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(split_part(new.email, '@', 1), ''),
    'Novo usuário'
  );
  insert into public.taggi_profiles (user_id, display_name, email)
  values (new.id, fallback_name, coalesce(new.email, ''))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create or replace function private_taggi.enforce_auth_namespace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  app_name text;
begin
  if caller_id is null then
    return new;
  end if;
  select u.raw_user_meta_data ->> 'app' into app_name
  from auth.users u
  where u.id = caller_id;
  if coalesce(app_name, '') <> 'taggi' then
    raise exception using errcode = '42501', message = 'Esta conta pertence a um sistema legado e não pode ser reutilizada no Taggi. Crie uma conta Taggi com outro e-mail.';
  end if;
  return new;
end;
$$;

create trigger taggi_group_auth_namespace
before insert on public.taggi_groups
for each row execute function private_taggi.enforce_auth_namespace();

create trigger taggi_membership_auth_namespace
before insert on public.taggi_group_members
for each row execute function private_taggi.enforce_auth_namespace();

revoke execute on function private_taggi.enforce_auth_namespace() from public, anon, authenticated;

commit;

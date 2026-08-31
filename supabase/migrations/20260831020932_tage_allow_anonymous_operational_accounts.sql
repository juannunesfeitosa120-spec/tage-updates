-- The operational login intentionally creates anonymous Supabase users.
-- Validate that server-owned Auth flag instead of user-editable metadata.
create or replace function private_taggi.enforce_auth_namespace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_is_anonymous boolean := false;
begin
  if caller_id is null then
    return new;
  end if;

  select coalesce(auth_user.is_anonymous, false)
  into caller_is_anonymous
  from auth.users auth_user
  where auth_user.id = caller_id;

  if not coalesce(caller_is_anonymous, false) then
    raise exception using
      errcode = '42501',
      message = 'Este acesso não pertence ao Tage. Entre novamente pelo aplicativo.';
  end if;

  return new;
end;
$$;

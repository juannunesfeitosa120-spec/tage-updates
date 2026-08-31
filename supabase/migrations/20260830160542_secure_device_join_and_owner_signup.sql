-- Anonymous users represent employee access tied to a device. They may join an
-- existing company with its code, but only a permanent, verified account can
-- create and own a company subscription.
create or replace function private_taggi.reject_anonymous_group_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) then
    raise exception using
      errcode = '42501',
      message = 'Entre com uma conta confirmada para criar uma empresa.';
  end if;
  return new;
end;
$$;

drop trigger if exists taggi_groups_permanent_owner_only
on public.taggi_groups;

create trigger taggi_groups_permanent_owner_only
before insert on public.taggi_groups
for each row
execute function private_taggi.reject_anonymous_group_owner();

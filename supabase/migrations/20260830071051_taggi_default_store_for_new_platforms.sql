begin;

create or replace function private_taggi.ensure_default_platform_store()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.taggi_platform_stores
    (group_id, platform_id, name, sort_order, created_by)
  select new.group_id, new.id, new.store, 1, new.created_by
  where not exists (
    select 1
    from public.taggi_platform_stores existing
    where existing.group_id = new.group_id
      and existing.platform_id = new.id
      and existing.status = 'active'
  )
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists taggi_platform_default_store on public.taggi_platforms;
create constraint trigger taggi_platform_default_store
after insert on public.taggi_platforms
deferrable initially deferred
for each row execute function private_taggi.ensure_default_platform_store();

revoke execute on function private_taggi.ensure_default_platform_store()
from public, anon, authenticated;

commit;

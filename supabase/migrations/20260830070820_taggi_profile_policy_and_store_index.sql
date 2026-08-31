begin;

create index taggi_count_events_group_platform_store_idx
  on public.taggi_count_events (group_id, platform_id, store_id);

drop policy if exists taggi_profiles_own_select on public.taggi_profiles;
drop policy if exists taggi_profiles_group_select on public.taggi_profiles;

create policy taggi_profiles_member_select
on public.taggi_profiles
for select to authenticated
using (
  user_id = (select auth.uid())
  or (select private_taggi.shares_active_group(user_id))
);

commit;

begin;

drop policy if exists taggi_platforms_member_insert on public.taggi_platforms;
drop policy if exists taggi_platforms_member_update on public.taggi_platforms;
drop policy if exists taggi_platforms_member_delete on public.taggi_platforms;

create policy taggi_platforms_authority_insert on public.taggi_platforms
for insert to authenticated
with check (
  (select private_taggi.current_role_level(group_id)) >= 2
  and created_by = (select auth.uid())
);

create policy taggi_platforms_authority_update on public.taggi_platforms
for update to authenticated
using ((select private_taggi.current_role_level(group_id)) >= 2)
with check ((select private_taggi.current_role_level(group_id)) >= 2);

create policy taggi_platforms_authority_delete on public.taggi_platforms
for delete to authenticated
using ((select private_taggi.current_role_level(group_id)) >= 2);

commit;

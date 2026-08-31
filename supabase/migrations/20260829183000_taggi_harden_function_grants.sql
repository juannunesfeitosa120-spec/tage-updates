begin;

revoke execute on function public.taggi_create_group(text, text, uuid) from anon;
revoke execute on function public.taggi_join_group(text, text) from anon;
revoke execute on function public.taggi_touch_presence(uuid) from anon;
revoke execute on function public.taggi_complete_tutorial(uuid, boolean) from anon;
revoke execute on function public.taggi_update_member_role(uuid, uuid, text, boolean) from anon;
revoke execute on function public.taggi_remove_member(uuid, uuid) from anon;
revoke execute on function public.taggi_set_initial_admin_password(uuid, text) from anon;
revoke execute on function public.taggi_unlock_admin(uuid, text) from anon;
revoke execute on function public.taggi_lock_admin(uuid, uuid, text) from anon;
revoke execute on function public.taggi_change_admin_password(uuid, text, text) from anon;
revoke execute on function public.taggi_admin_adjust_count(uuid, uuid, integer, text, uuid, text) from anon;

create index if not exists taggi_admin_credentials_changed_by_idx
  on private_taggi.admin_credentials (changed_by);
create index if not exists taggi_admin_sessions_user_idx
  on private_taggi.admin_sessions (user_id);

commit;

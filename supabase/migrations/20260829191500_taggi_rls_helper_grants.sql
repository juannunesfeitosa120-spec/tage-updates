begin;

grant execute on function private_taggi.is_active_member(uuid) to authenticated;
grant execute on function private_taggi.current_role_level(uuid) to authenticated;

commit;

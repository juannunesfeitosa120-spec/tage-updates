-- Qualify the update target because the RPC output also defines a group_id
-- variable, which otherwise conflicts with the table column in PL/pgSQL.
do $migration$
declare
  original_definition text;
  updated_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.taggi_create_team(text,text)'::regprocedure
  ) into original_definition;

  updated_definition := pg_catalog.replace(
    original_definition,
    E'  update public.taggi_group_members\n'
      || E'  set display_name = clean_display_name,\n'
      || E'      last_seen_at = now(),\n'
      || E'      updated_at = now()\n'
      || E'  where group_id = selected_group.id\n'
      || E'    and user_id = caller_id\n'
      || E'    and status = ''active'';',
    E'  update public.taggi_group_members as active_member\n'
      || E'  set display_name = clean_display_name,\n'
      || E'      last_seen_at = now(),\n'
      || E'      updated_at = now()\n'
      || E'  where active_member.group_id = selected_group.id\n'
      || E'    and active_member.user_id = caller_id\n'
      || E'    and active_member.status = ''active'';'
  );

  if updated_definition = original_definition then
    raise exception 'Não foi possível qualificar group_id em taggi_create_team.';
  end if;

  execute updated_definition;
end;
$migration$;

-- Profile updates must reach every active member so avatar changes appear on
-- all connected desktops without requiring a restart.
do $publication$
begin
  if not exists (
    select 1
    from pg_catalog.pg_publication_tables publication_table
    where publication_table.pubname = 'supabase_realtime'
      and publication_table.schemaname = 'public'
      and publication_table.tablename = 'taggi_profiles'
  ) then
    alter publication supabase_realtime add table public.taggi_profiles;
  end if;
end;
$publication$;

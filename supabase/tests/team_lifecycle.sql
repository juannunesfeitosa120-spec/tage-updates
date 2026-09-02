-- Transactional regression test. All temporary users/teams are rolled back.
begin;
do $test$
declare
  actor_a uuid := extensions.gen_random_uuid();
  actor_b uuid := extensions.gen_random_uuid();
  team_a record;
  team_b record;
  session_a record;
  session_b record;
  child record;
  remaining bigint;
  baseline bigint;
begin
  select count(*) into baseline from public.taggi_groups;
  insert into auth.users (id, aud, role, is_anonymous)
  values (actor_a, 'authenticated', 'authenticated', true),
         (actor_b, 'authenticated', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', actor_a::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',actor_a,'role','authenticated','is_anonymous',true)::text, true);

  select * into team_a from public.taggi_create_team_secure('Teste A','Lifecycle A','member-test-123','admin-test-123');
  select * into team_b from public.taggi_create_team_secure('Teste A','Lifecycle B','member-test-123','admin-test-456');
  if team_a.group_id = team_b.group_id or team_a.group_code = team_b.group_code then
    raise exception 'New teams must have distinct ids and codes';
  end if;
  if (select count(*) from public.taggi_group_members where user_id=actor_a) <> 2 then
    raise exception 'Creating a second team lost the original membership';
  end if;
  if exists(select 1 from public.taggi_platforms where group_id in (team_a.group_id,team_b.group_id))
    or exists(select 1 from public.taggi_count_events where group_id in (team_a.group_id,team_b.group_id))
    or exists(select 1 from public.taggi_inventory_products where group_id in (team_a.group_id,team_b.group_id)) then
    raise exception 'New team was not empty';
  end if;

  select * into session_a from public.taggi_unlock_admin(team_a.group_id,'admin-test-123');
  begin
    perform public.taggi_delete_team(team_b.group_id,session_a.session_id,session_a.session_token,'admin-test-456','Lifecycle B');
    raise exception 'Cross-team admin session was accepted';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.taggi_delete_team(team_a.group_id,session_a.session_id,session_a.session_token,'wrong-password','Lifecycle A');
    raise exception 'Wrong password was accepted';
  exception when sqlstate '28P01' then null;
  end;
  begin
    perform public.taggi_delete_team(team_a.group_id,session_a.session_id,session_a.session_token,'admin-test-123','Wrong team');
    raise exception 'Wrong confirmation name was accepted';
  exception when sqlstate '22023' then null;
  end;
  update private_taggi.admin_sessions set expires_at=now()-interval '1 minute' where id=session_a.session_id;
  begin
    perform public.taggi_delete_team(team_a.group_id,session_a.session_id,session_a.session_token,'admin-test-123','Lifecycle A');
    raise exception 'Expired authorization was accepted';
  exception when sqlstate '42501' then null;
  end;
  update private_taggi.admin_sessions set expires_at=now()+interval '10 minutes' where id=session_a.session_id;

  perform set_config('request.jwt.claim.sub',actor_b::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor_b,'role','authenticated','is_anonymous',true)::text,true);
  perform public.taggi_join_team_secure('Teste B',team_b.group_code,'member-test-789');
  begin
    perform public.taggi_delete_team(team_a.group_id,session_a.session_id,session_a.session_token,'admin-test-123','Lifecycle A');
    raise exception 'Non-member was allowed to delete a team';
  exception when sqlstate '42501' then null;
  end;
  execute 'set local role authenticated';
  select count(*) into remaining from public.taggi_groups where id=team_a.group_id;
  if remaining <> 0 then raise exception 'RLS exposed another team'; end if;
  execute 'reset role';

  perform set_config('request.jwt.claim.sub',actor_a::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor_a,'role','authenticated','is_anonymous',true)::text,true);
  execute 'set local role authenticated';
  perform public.taggi_delete_team(team_a.group_id,session_a.session_id,session_a.session_token,'admin-test-123','Lifecycle A');
  execute 'reset role';
  if exists(select 1 from public.taggi_groups where id=team_a.group_id) then
    raise exception 'Team was not deleted';
  end if;
  for child in select distinct conrelid::regclass as relation from pg_constraint where contype='f' and confrelid='public.taggi_groups'::regclass loop
    execute format('select count(*) from %s where group_id=$1',child.relation) into remaining using team_a.group_id;
    if remaining <> 0 then raise exception 'Orphan rows remain in %',child.relation; end if;
  end loop;
  if (select count(*) from public.taggi_group_members where group_id=team_b.group_id) <> 2 then
    raise exception 'Deleting one team affected another';
  end if;
  if not exists(select 1 from public.taggi_profiles where user_id=actor_a) then
    raise exception 'Shared profile was deleted';
  end if;
  if has_function_privilege('anon','public.taggi_delete_team(uuid,uuid,text,text,text)','EXECUTE')
    or has_function_privilege('anon','private_taggi.delete_team(uuid,uuid,text,text,text)','EXECUTE') then
    raise exception 'Anonymous database role can execute deletion';
  end if;

  -- Any active role still needs the correct administrative password/session.
  perform set_config('request.jwt.claim.sub',actor_b::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor_b,'role','authenticated','is_anonymous',true)::text,true);
  select * into session_b from public.taggi_unlock_admin(team_b.group_id,'admin-test-456');
  execute 'set local role authenticated';
  perform public.taggi_delete_team(team_b.group_id,session_b.session_id,session_b.session_token,'admin-test-456','Lifecycle B');
  execute 'reset role';
  if (select count(*) from public.taggi_groups) <> baseline then
    raise exception 'Fixture cleanup changed pre-existing teams';
  end if;
end;
$test$;
rollback;
select 'PASS: multi-team creation, empty initial state, admin authentication, confirmation, expired-session rejection, cross-team isolation, cascade cleanup and profile preservation' as result;

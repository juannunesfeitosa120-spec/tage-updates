begin;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'taggi.test.manager@example.invalid', extensions.crypt('TestPassword123!', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"app":"taggi","app_version":"v1","display_name":"Gestora Teste"}'::jsonb, now(), now()
  ),
  (
    '10000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'taggi.test.manager.b@example.invalid', extensions.crypt('TestPassword123!', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"app":"taggi","app_version":"v1","display_name":"Gestor B"}'::jsonb, now(), now()
  ),
  (
    '10000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
    'taggi.test.employee@example.invalid', extensions.crypt('TestPassword123!', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"app":"taggi","app_version":"v1","display_name":"Funcionário Teste"}'::jsonb, now(), now()
  );

create temporary table taggi_test_state (
  key text primary key,
  value text not null
);
grant select on taggi_test_state to authenticated;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

do $$
declare
  first_result record;
  retry_result record;
begin
  select * into first_result
  from public.taggi_create_group(
    'Empresa Teste A', 'Gestora Teste', '20000000-0000-4000-8000-000000000001'
  );
  select * into retry_result
  from public.taggi_create_group(
    'Empresa Teste A', 'Gestora Teste', '20000000-0000-4000-8000-000000000001'
  );
  if first_result.group_id <> retry_result.group_id then
    raise exception 'Falha de idempotência na criação de empresa.';
  end if;
  if first_result.group_code !~ '^TG-[A-Z2-9]{5}$' then
    raise exception 'Código público fora do formato esperado.';
  end if;
  insert into taggi_test_state values
    ('group_a', first_result.group_id::text),
    ('code_a', first_result.group_code);
end;
$$;

select public.taggi_set_initial_admin_password(
  (select value::uuid from taggi_test_state where key = 'group_a'),
  'AdminPassword123!'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

do $$
declare
  second_result record;
begin
  select * into second_result
  from public.taggi_create_group(
    'Empresa Teste B', 'Gestor B', '20000000-0000-4000-8000-000000000002'
  );
  insert into taggi_test_state values ('group_b', second_result.group_id::text);
end;
$$;

set constraints taggi_platform_default_store immediate;
set constraints taggi_platform_default_store deferred;

do $$
begin
  perform public.taggi_join_group(
    (select value from taggi_test_state where key = 'code_a'),
    'Gestor B'
  );
  raise exception 'Uma conta conseguiu entrar em uma segunda empresa.';
exception
  when unique_violation then null;
end;
$$;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);

do $$
declare
  joined_result record;
begin
  select * into joined_result
  from public.taggi_join_group(
    (select value from taggi_test_state where key = 'code_a'),
    'Funcionário Teste'
  );
  if joined_result.member_role <> 'employee' then
    raise exception 'Novo membro não recebeu o cargo Funcionário.';
  end if;
end;
$$;

do $$
begin
  perform public.taggi_update_member_role(
    (select value::uuid from taggi_test_state where key = 'group_a'),
    '10000000-0000-4000-8000-000000000003',
    'manager', false
  );
  raise exception 'Funcionário conseguiu promover a si próprio.';
exception
  when insufficient_privilege then null;
end;
$$;

do $$
begin
  perform public.taggi_unlock_admin(
    (select value::uuid from taggi_test_state where key = 'group_a'),
    'AdminPassword123!'
  );
  raise exception 'Funcionário conseguiu desbloquear a Administração.';
exception
  when insufficient_privilege then null;
end;
$$;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

do $$
declare
  unlocked record;
begin
  select * into unlocked
  from public.taggi_unlock_admin(
    (select value::uuid from taggi_test_state where key = 'group_a'),
    'AdminPassword123!'
  );
  if unlocked.session_id is null or unlocked.expires_at <= now() then
    raise exception 'Sessão administrativa temporária inválida.';
  end if;
  insert into taggi_test_state values
    ('admin_session_id', unlocked.session_id::text),
    ('admin_session_token', unlocked.session_token);
end;
$$;

do $$
begin
  perform public.taggi_unlock_admin(
    (select value::uuid from taggi_test_state where key = 'group_a'),
    'senha-incorreta'
  );
  raise exception 'Senha administrativa incorreta foi aceita.';
exception
  when invalid_password then null;
end;
$$;

insert into public.taggi_count_events (group_id, platform_id, store_id, event_type, delta)
select p.group_id, p.id, s.id, 'launch', 12
from public.taggi_platforms p
join public.taggi_platform_stores s
  on s.group_id = p.group_id and s.platform_id = p.id and s.status = 'active'
where p.group_id = (select value::uuid from taggi_test_state where key = 'group_a')
order by p.sort_order, s.sort_order
limit 1;

do $$
begin
  insert into public.taggi_count_events (group_id, platform_id, store_id, event_type, delta)
  select
    (select value::uuid from taggi_test_state where key = 'group_a'),
    p.id, s.id, 'launch', 1
  from public.taggi_platforms p
  join public.taggi_platform_stores s
    on s.group_id = p.group_id and s.platform_id = p.id and s.status = 'active'
  where p.group_id = (select value::uuid from taggi_test_state where key = 'group_b')
  limit 1;
  raise exception 'Foi possível usar uma plataforma de outra empresa.';
exception
  when foreign_key_violation then null;
end;
$$;

insert into public.taggi_feedback (group_id, category, body)
values (
  (select value::uuid from taggi_test_state where key = 'group_a'),
  'sugestao',
  'Adicionar um filtro por loja no painel.'
);

do $$
declare
  feedback_count integer;
begin
  select count(*) into feedback_count
  from public.taggi_admin_list_feedbacks(
    (select value::uuid from taggi_test_state where key = 'group_a'),
    (select value::uuid from taggi_test_state where key = 'admin_session_id'),
    (select value from taggi_test_state where key = 'admin_session_token')
  );
  if feedback_count <> 1 then
    raise exception 'A Administração não recebeu o feedback enviado.';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

do $$
begin
  if (select count(*) from public.taggi_groups) <> 1 then
    raise exception 'RLS permitiu que a Gestora A enxergasse outra empresa.';
  end if;
  if exists (
    select 1 from public.taggi_group_members
    where group_id = (select value::uuid from taggi_test_state where key = 'group_b')
  ) then
    raise exception 'RLS vazou membros de outra empresa.';
  end if;
end;
$$;

do $$
declare
  device record;
begin
  select * into device
  from public.taggi_touch_release_device(
    repeat('a', 64),
    '1.0.0',
    1,
    'healthy'
  );
  if device.channel <> 'stable' or not device.enabled then
    raise exception 'Novo dispositivo não iniciou com autorização Stable segura.';
  end if;
end;
$$;

do $$
begin
  update public.taggi_release_devices
  set channel = 'beta'
  where installation_id_hash = repeat('a', 64);
  raise exception 'Cliente conseguiu autorizar o próprio canal Beta.';
exception
  when insufficient_privilege then null;
end;
$$;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

select *
from public.taggi_touch_release_device(
  repeat('b', 64),
  '1.0.0',
  1,
  'running'
);

do $$
begin
  if (select count(*) from public.taggi_release_devices) <> 1 then
    raise exception 'RLS vazou telemetria técnica de outro usuário.';
  end if;
  if exists (
    select 1 from public.taggi_release_devices
    where installation_id_hash = repeat('a', 64)
  ) then
    raise exception 'RLS expôs identificador técnico de outro usuário.';
  end if;
end;
$$;

reset role;
rollback;

select 'passed' as result,
  'empresa única, lojas, feedbacks, cargos, senha administrativa, FK composta, canal Beta e isolamento RLS' as coverage;

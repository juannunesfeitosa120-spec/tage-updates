-- Team onboarding for authenticated anonymous Tage identities. The table
-- trigger remains closed to direct inserts and opens only inside the trusted
-- creation RPC transaction.
create or replace function private_taggi.reject_anonymous_group_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false)
    and coalesce(
      pg_catalog.current_setting('tage.default_team_bootstrap', true),
      ''
    ) <> 'enabled'
    and coalesce(
      pg_catalog.current_setting('tage.team_creation', true),
      ''
    ) <> 'enabled' then
    raise exception using
      errcode = '42501',
      message = 'Crie a equipe pelo fluxo protegido do aplicativo Tage.';
  end if;
  return new;
end;
$$;

create or replace function public.taggi_create_team(
  p_display_name text,
  p_team_name text
)
returns table (
  group_id uuid,
  group_code text,
  group_name text,
  display_name text,
  member_role text,
  tutorial_completed_at timestamptz,
  admin_password_configured boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  clean_display_name text := pg_catalog.btrim(coalesce(p_display_name, ''));
  clean_team_name text := pg_catalog.btrim(coalesce(p_team_name, ''));
  caller_email text;
  selected_group public.taggi_groups%rowtype;
begin
  if caller_id is null then
    raise exception using
      errcode = '42501',
      message = 'Não foi possível identificar este dispositivo.';
  end if;
  if char_length(clean_display_name) not between 2 and 80 then
    raise exception using
      errcode = '22023',
      message = 'Informe o seu nome na equipe.';
  end if;
  if char_length(clean_team_name) not between 2 and 100 then
    raise exception using
      errcode = '22023',
      message = 'Informe um nome válido para a equipe.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('tage.team-create:' || caller_id::text, 0)
  );

  select team.* into selected_group
  from public.taggi_group_members member
  join public.taggi_groups team on team.id = member.group_id
  where member.user_id = caller_id
    and member.status = 'active'
    and team.status = 'active'
  order by member.joined_at desc
  limit 1;

  if selected_group.id is null then
    perform pg_catalog.set_config('tage.team_creation', 'enabled', true);

    insert into public.taggi_groups (
      name,
      code,
      created_by,
      creation_request_id,
      admin_password_configured_at
    )
    values (
      clean_team_name,
      private_taggi.generate_group_code(),
      caller_id,
      extensions.gen_random_uuid(),
      now()
    )
    returning * into selected_group;

    insert into public.taggi_group_members (
      group_id,
      user_id,
      display_name,
      role,
      status
    )
    values (
      selected_group.id,
      caller_id,
      clean_display_name,
      'manager',
      'active'
    );

    insert into public.taggi_group_settings (group_id)
    values (selected_group.id)
    on conflict on constraint taggi_group_settings_pkey do nothing;

    insert into public.taggi_member_preferences (group_id, user_id)
    values (selected_group.id, caller_id)
    on conflict on constraint taggi_member_preferences_pkey do nothing;

    insert into private_taggi.admin_credentials (
      group_id,
      password_hash,
      changed_by
    )
    values (
      selected_group.id,
      extensions.crypt('admin123', extensions.gen_salt('bf', 12)),
      caller_id
    )
    on conflict on constraint admin_credentials_pkey do update
      set password_hash = excluded.password_hash,
          changed_by = excluded.changed_by,
          updated_at = now();

    insert into public.taggi_activity_log (
      group_id,
      user_id,
      display_name,
      activity_type,
      summary
    )
    values
      (
        selected_group.id,
        caller_id,
        clean_display_name,
        'group_created',
        clean_display_name || ' criou a equipe.'
      ),
      (
        selected_group.id,
        caller_id,
        clean_display_name,
        'member_joined',
        clean_display_name || ' entrou na equipe.'
      );
  elsif selected_group.created_by <> caller_id then
    raise exception using
      errcode = '23505',
      message = 'Você já participa de outra equipe.';
  end if;

  select auth_user.email into caller_email
  from auth.users auth_user
  where auth_user.id = caller_id;

  insert into public.taggi_profiles (user_id, display_name, email)
  values (caller_id, clean_display_name, coalesce(caller_email, ''))
  on conflict (user_id) do update
    set display_name = excluded.display_name,
        email = excluded.email,
        updated_at = now();

  update public.taggi_group_members as active_member
  set display_name = clean_display_name,
      last_seen_at = now(),
      updated_at = now()
  where active_member.group_id = selected_group.id
    and active_member.user_id = caller_id
    and active_member.status = 'active';

  return query
  select
    selected_group.id,
    selected_group.code,
    selected_group.name,
    member.display_name,
    member.role,
    preference.tutorial_completed_at,
    selected_group.admin_password_configured_at is not null
  from public.taggi_group_members member
  join public.taggi_member_preferences preference
    on preference.group_id = member.group_id
   and preference.user_id = member.user_id
  where member.group_id = selected_group.id
    and member.user_id = caller_id
    and member.status = 'active';
end;
$$;

create or replace function public.taggi_join_team_by_code(
  p_display_name text,
  p_team_code text
)
returns table (
  group_id uuid,
  group_code text,
  group_name text,
  display_name text,
  member_role text,
  tutorial_completed_at timestamptz,
  admin_password_configured boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  clean_display_name text := pg_catalog.btrim(coalesce(p_display_name, ''));
  selected_group public.taggi_groups%rowtype;
  existing_group_id uuid;
  caller_email text;
  was_active boolean := false;
begin
  if caller_id is null then
    raise exception using
      errcode = '42501',
      message = 'Não foi possível identificar este dispositivo.';
  end if;
  if char_length(clean_display_name) not between 2 and 80 then
    raise exception using
      errcode = '22023',
      message = 'Informe o seu nome na equipe.';
  end if;

  select team.* into selected_group
  from public.taggi_groups team
  where team.code = private_taggi.normalize_group_code(p_team_code)
    and team.status = 'active'
  limit 1;

  if selected_group.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Não encontramos uma equipe ativa com esse código.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('tage.team-join:' || caller_id::text, 0)
  );

  select member.group_id into existing_group_id
  from public.taggi_group_members member
  join public.taggi_groups team on team.id = member.group_id
  where member.user_id = caller_id
    and member.status = 'active'
    and team.status = 'active'
  limit 1;

  if existing_group_id is not null and existing_group_id <> selected_group.id then
    raise exception using
      errcode = '23505',
      message = 'Desconecte-se da equipe atual antes de entrar em outra.';
  end if;

  select exists (
    select 1
    from public.taggi_group_members member
    where member.group_id = selected_group.id
      and member.user_id = caller_id
      and member.status = 'active'
  ) into was_active;

  insert into public.taggi_group_members (
    group_id,
    user_id,
    display_name,
    role,
    status
  )
  values (
    selected_group.id,
    caller_id,
    clean_display_name,
    'employee',
    'active'
  )
  on conflict on constraint taggi_group_members_group_id_user_id_key do update
    set display_name = excluded.display_name,
        role = case
          when public.taggi_group_members.status = 'active'
            then public.taggi_group_members.role
          else 'employee'
        end,
        status = 'active',
        last_seen_at = now(),
        updated_at = now();

  insert into public.taggi_member_preferences (group_id, user_id)
  values (selected_group.id, caller_id)
  on conflict on constraint taggi_member_preferences_pkey do nothing;

  select auth_user.email into caller_email
  from auth.users auth_user
  where auth_user.id = caller_id;

  insert into public.taggi_profiles (user_id, display_name, email)
  values (caller_id, clean_display_name, coalesce(caller_email, ''))
  on conflict (user_id) do update
    set display_name = excluded.display_name,
        email = excluded.email,
        updated_at = now();

  if not was_active then
    insert into public.taggi_activity_log (
      group_id,
      user_id,
      display_name,
      activity_type,
      summary
    )
    values (
      selected_group.id,
      caller_id,
      clean_display_name,
      'member_joined',
      clean_display_name || ' entrou na equipe.'
    );
  end if;

  return query
  select
    selected_group.id,
    selected_group.code,
    selected_group.name,
    member.display_name,
    member.role,
    preference.tutorial_completed_at,
    selected_group.admin_password_configured_at is not null
  from public.taggi_group_members member
  join public.taggi_member_preferences preference
    on preference.group_id = member.group_id
   and preference.user_id = member.user_id
  where member.group_id = selected_group.id
    and member.user_id = caller_id
    and member.status = 'active';
end;
$$;

create or replace function public.taggi_current_team()
returns table (
  group_id uuid,
  group_code text,
  group_name text,
  display_name text,
  member_role text,
  tutorial_completed_at timestamptz,
  admin_password_configured boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    team.id,
    team.code,
    team.name,
    member.display_name,
    member.role,
    preference.tutorial_completed_at,
    team.admin_password_configured_at is not null
  from public.taggi_group_members member
  join public.taggi_groups team
    on team.id = member.group_id
   and team.status = 'active'
  join public.taggi_member_preferences preference
    on preference.group_id = member.group_id
   and preference.user_id = member.user_id
  where member.user_id = (select auth.uid())
    and member.status = 'active'
  order by member.joined_at desc
  limit 1;
$$;

revoke execute on function public.taggi_create_team(text, text)
from public, anon;
revoke execute on function public.taggi_join_team_by_code(text, text)
from public, anon;
revoke execute on function public.taggi_current_team()
from public, anon;
grant execute on function public.taggi_create_team(text, text)
to authenticated;
grant execute on function public.taggi_join_team_by_code(text, text)
to authenticated;
grant execute on function public.taggi_current_team()
to authenticated;

-- The Administration password creates the temporary authority. The member's
-- ordinary role must not be a second gate.
create or replace function public.taggi_unlock_admin(
  p_group_id uuid,
  p_password text
)
returns table (
  session_id uuid,
  session_token text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  stored_hash text;
  raw_token text;
  new_session_id uuid := extensions.gen_random_uuid();
  new_expires_at timestamptz;
begin
  if caller_id is null
    or not (select private_taggi.is_active_member(p_group_id)) then
    raise exception using
      errcode = '42501',
      message = 'Você não participa desta equipe.';
  end if;

  select credential.password_hash into stored_hash
  from private_taggi.admin_credentials credential
  where credential.group_id = p_group_id;

  if stored_hash is null
    or extensions.crypt(coalesce(p_password, ''), stored_hash) <> stored_hash then
    raise exception using
      errcode = '28P01',
      message = 'Senha da Administração incorreta.';
  end if;

  raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  select now() + pg_catalog.make_interval(mins => settings.admin_session_minutes)
  into new_expires_at
  from public.taggi_group_settings settings
  where settings.group_id = p_group_id;

  if new_expires_at is null then
    new_expires_at := now() + interval '30 minutes';
  end if;

  insert into private_taggi.admin_sessions (
    id,
    group_id,
    user_id,
    token_hash,
    expires_at
  )
  values (
    new_session_id,
    p_group_id,
    caller_id,
    extensions.digest(raw_token, 'sha256'),
    new_expires_at
  );

  return query select new_session_id, raw_token, new_expires_at;
end;
$$;

revoke execute on function public.taggi_unlock_admin(uuid, text)
from public, anon;
grant execute on function public.taggi_unlock_admin(uuid, text)
to authenticated;

-- Existing administrative RPCs already verify the short-lived session and
-- group. Remove only the redundant role comparison, preserving every session
-- and membership check in their original definitions.
do $migration$
declare
  target record;
  original_definition text;
  updated_definition text;
begin
  for target in
    select procedure.oid, procedure.proname
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname like 'taggi_admin_%'
      and procedure.prosrc like '%admin_session_valid%'
      and procedure.prosrc like '%current_role_level%'
  loop
    original_definition := pg_catalog.pg_get_functiondef(target.oid);
    updated_definition := pg_catalog.regexp_replace(
      original_definition,
      E'[[:space:]]+or[[:space:]]+\\(select[[:space:]]+private_taggi\\.current_role_level\\(p_group_id\\)\\)[[:space:]]*<[[:space:]]*2',
      '',
      'g'
    );

    if updated_definition = original_definition then
      raise exception 'Não foi possível remover a trava de cargo de %.', target.proname;
    end if;

    execute updated_definition;
  end loop;
end;
$migration$;

-- Inventory units and an append-only movement ledger support the redesigned
-- stock screen and keep every desktop synchronized from one source of truth.
alter table public.taggi_inventory_products
  add column if not exists unit text not null default 'un.';

alter table public.taggi_inventory_products
  drop constraint if exists taggi_inventory_products_unit_check;
alter table public.taggi_inventory_products
  add constraint taggi_inventory_products_unit_check
  check (char_length(pg_catalog.btrim(unit)) between 1 and 20);

create table if not exists public.taggi_inventory_movements (
  id uuid primary key default extensions.gen_random_uuid(),
  group_id uuid not null
    references public.taggi_groups(id) on delete cascade,
  product_id uuid not null
    references public.taggi_inventory_products(id) on delete restrict,
  product_name text not null,
  movement_type text not null
    check (movement_type in ('entry', 'withdrawal')),
  quantity integer not null check (quantity > 0),
  previous_quantity integer not null check (previous_quantity >= 0),
  new_quantity integer not null check (new_quantity >= 0),
  unit text not null default 'un.',
  responsible_user_id uuid
    references auth.users(id) on delete set null,
  responsible_name text not null,
  created_at timestamptz not null default now()
);

create index if not exists taggi_inventory_movements_group_created_idx
  on public.taggi_inventory_movements (group_id, created_at desc);
create index if not exists taggi_inventory_movements_product_idx
  on public.taggi_inventory_movements (product_id);
create index if not exists taggi_inventory_movements_responsible_idx
  on public.taggi_inventory_movements (responsible_user_id)
  where responsible_user_id is not null;

alter table public.taggi_inventory_movements enable row level security;

drop policy if exists taggi_inventory_movements_member_select
  on public.taggi_inventory_movements;
create policy taggi_inventory_movements_member_select
on public.taggi_inventory_movements
for select
to authenticated
using ((select private_taggi.is_active_member(group_id)));

revoke all on table public.taggi_inventory_movements from anon, authenticated;
grant select on table public.taggi_inventory_movements to authenticated;

do $publication$
begin
  if not exists (
    select 1
    from pg_catalog.pg_publication_tables publication_table
    where publication_table.pubname = 'supabase_realtime'
      and publication_table.schemaname = 'public'
      and publication_table.tablename = 'taggi_inventory_movements'
  ) then
    alter publication supabase_realtime
      add table public.taggi_inventory_movements;
  end if;
end;
$publication$;

create or replace function public.taggi_inventory_save_product(
  p_group_id uuid,
  p_product_id uuid,
  p_name text,
  p_initial_quantity integer,
  p_unit text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_id uuid;
  clean_unit text := pg_catalog.btrim(coalesce(p_unit, ''));
begin
  if char_length(clean_unit) not between 1 and 20 then
    raise exception using
      errcode = '22023',
      message = 'Informe uma unidade válida.';
  end if;

  result_id := public.taggi_inventory_save_product(
    p_group_id,
    p_product_id,
    p_name,
    p_initial_quantity
  );

  update public.taggi_inventory_products
  set unit = clean_unit,
      updated_at = now()
  where id = result_id
    and group_id = p_group_id;

  return result_id;
end;
$$;

create or replace function public.taggi_inventory_adjust_stock(
  p_group_id uuid,
  p_product_id uuid,
  p_quantity integer,
  p_kind text
)
returns table (
  previous_quantity integer,
  new_quantity integer,
  movement_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  product public.taggi_inventory_products%rowtype;
  actor_name text;
  next_quantity integer;
  new_movement_id uuid := extensions.gen_random_uuid();
  clean_kind text := lower(pg_catalog.btrim(coalesce(p_kind, '')));
begin
  if not (select private_taggi.is_active_member(p_group_id)) then
    raise exception using
      errcode = '42501',
      message = 'Empresa não autorizada.';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception using
      errcode = '22023',
      message = 'Informe uma quantidade maior que zero.';
  end if;
  if clean_kind not in ('entry', 'withdrawal') then
    raise exception using
      errcode = '22023',
      message = 'Tipo de movimentação inválido.';
  end if;

  select item.* into product
  from public.taggi_inventory_products item
  where item.id = p_product_id
    and item.group_id = p_group_id
    and item.status = 'active'
  for update;

  if product.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Produto não encontrado.';
  end if;

  next_quantity := case clean_kind
    when 'entry' then product.current_quantity + p_quantity
    else product.current_quantity - p_quantity
  end;

  if next_quantity < 0 then
    raise exception using
      errcode = '22023',
      message = 'Quantidade indisponível. Existem apenas ' ||
        product.current_quantity::text || ' unidades em estoque.';
  end if;

  actor_name := private_taggi.inventory_actor_name(p_group_id);

  update public.taggi_inventory_products
  set current_quantity = next_quantity,
      updated_at = now()
  where id = product.id;

  insert into public.taggi_inventory_movements (
    id,
    group_id,
    product_id,
    product_name,
    movement_type,
    quantity,
    previous_quantity,
    new_quantity,
    unit,
    responsible_user_id,
    responsible_name
  )
  values (
    new_movement_id,
    p_group_id,
    product.id,
    product.name,
    clean_kind,
    p_quantity,
    product.current_quantity,
    next_quantity,
    product.unit,
    (select auth.uid()),
    actor_name
  );

  if clean_kind = 'withdrawal' then
    insert into public.taggi_inventory_withdrawals (
      group_id,
      product_id,
      product_name,
      quantity,
      previous_quantity,
      new_quantity,
      responsible_user_id,
      responsible_name
    )
    values (
      p_group_id,
      product.id,
      product.name,
      p_quantity,
      product.current_quantity,
      next_quantity,
      (select auth.uid()),
      actor_name
    );
  end if;

  insert into public.taggi_activity_log (
    group_id,
    user_id,
    display_name,
    activity_type,
    summary,
    metadata
  )
  values (
    p_group_id,
    (select auth.uid()),
    actor_name,
    case clean_kind
      when 'entry' then 'inventory_entry'
      else 'inventory_withdrawal'
    end,
    actor_name || case clean_kind
      when 'entry' then ' registrou uma entrada em Insumos.'
      else ' registrou uma baixa em Insumos.'
    end,
    jsonb_build_object(
      'product_id', product.id,
      'product_name', product.name,
      'quantity', p_quantity,
      'previous_quantity', product.current_quantity,
      'new_quantity', next_quantity,
      'unit', product.unit
    )
  );

  return query
  select product.current_quantity, next_quantity, new_movement_id;
end;
$$;

create or replace function public.taggi_inventory_withdraw(
  p_group_id uuid,
  p_product_id uuid,
  p_quantity integer
)
returns table (
  previous_quantity integer,
  new_quantity integer
)
language sql
security definer
set search_path = ''
as $$
  select adjusted.previous_quantity, adjusted.new_quantity
  from public.taggi_inventory_adjust_stock(
    p_group_id,
    p_product_id,
    p_quantity,
    'withdrawal'
  ) adjusted;
$$;

revoke execute on function public.taggi_inventory_save_product(
  uuid, uuid, text, integer, text
) from public, anon;
revoke execute on function public.taggi_inventory_adjust_stock(
  uuid, uuid, integer, text
) from public, anon;
revoke execute on function public.taggi_inventory_withdraw(
  uuid, uuid, integer
) from public, anon;
grant execute on function public.taggi_inventory_save_product(
  uuid, uuid, text, integer, text
) to authenticated;
grant execute on function public.taggi_inventory_adjust_stock(
  uuid, uuid, integer, text
) to authenticated;
grant execute on function public.taggi_inventory_withdraw(
  uuid, uuid, integer
) to authenticated;

alter function public.taggi_inventory_snapshot(uuid)
  rename to taggi_inventory_snapshot_legacy_20260901;

revoke execute on function public.taggi_inventory_snapshot_legacy_20260901(uuid)
from public, anon, authenticated;

create function public.taggi_inventory_snapshot(p_group_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
  editing_session_id uuid;
  products jsonb;
  movements jsonb;
begin
  result := public.taggi_inventory_snapshot_legacy_20260901(p_group_id);
  editing_session_id := nullif(result #>> '{session,id}', '')::uuid;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', product.id,
        'name', product.name,
        'quantity', product.current_quantity,
        'status', product.status,
        'sortOrder', product.sort_order,
        'countedQuantity',
          coalesce(item.counted_quantity, product.current_quantity),
        'urgent', coalesce(item.urgent, false),
        'unit', product.unit,
        'updatedAt', product.updated_at
      )
      order by product.sort_order, product.created_at, product.id
    ),
    '[]'::jsonb
  ) into products
  from public.taggi_inventory_products product
  left join public.taggi_inventory_count_items item
    on item.session_id = editing_session_id
   and item.product_id = product.id
  where product.group_id = p_group_id
    and product.status = 'active';

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', movement.id,
        'type', movement.movement_type,
        'productId', movement.product_id,
        'productName', movement.product_name,
        'quantity', movement.quantity,
        'previousQuantity', movement.previous_quantity,
        'newQuantity', movement.new_quantity,
        'responsibleName', movement.responsible_name,
        'createdAt', movement.created_at,
        'unit', movement.unit
      )
      order by movement.created_at desc, movement.id desc
    ),
    '[]'::jsonb
  ) into movements
  from (
    select recent.*
    from public.taggi_inventory_movements recent
    where recent.group_id = p_group_id
    order by recent.created_at desc, recent.id desc
    limit 100
  ) movement;

  return jsonb_set(
    jsonb_set(result, '{products}', products, true),
    '{movements}',
    movements,
    true
  );
end;
$$;

revoke execute on function public.taggi_inventory_snapshot(uuid)
from public, anon;
grant execute on function public.taggi_inventory_snapshot(uuid)
to authenticated;

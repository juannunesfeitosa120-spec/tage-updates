-- Insumos persistentes e correções auditáveis de contagem.

drop trigger if exists taggi_platform_identity on public.taggi_platforms;

alter table public.taggi_count_events
  add column if not exists corrects_event_id uuid references public.taggi_count_events(id) on delete set null,
  add column if not exists metadata jsonb not null default '{}'::jsonb;
create index if not exists taggi_count_events_corrects_idx on public.taggi_count_events (corrects_event_id) where corrects_event_id is not null;

revoke insert on public.taggi_count_events from authenticated;
drop policy if exists taggi_count_events_member_insert on public.taggi_count_events;
revoke execute on function public.taggi_admin_adjust_count(uuid,uuid,integer,text,uuid,text) from authenticated;

create or replace function public.taggi_record_launch(p_group_id uuid,p_platform_id uuid,p_store_id uuid,p_quantity integer)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare result_id uuid;
begin
  if not (select private_taggi.is_active_member(p_group_id)) then raise exception using errcode='42501',message='Empresa não autorizada.'; end if;
  if p_quantity<=0 or p_quantity>1000000 then raise exception using errcode='22023',message='Quantidade inválida.'; end if;
  if not exists(select 1 from public.taggi_platform_stores s join public.taggi_platforms p on p.id=s.platform_id and p.group_id=s.group_id where s.id=p_store_id and s.platform_id=p_platform_id and s.group_id=p_group_id and s.status='active' and p.status='active') then raise exception using errcode='P0002',message='Plataforma ou loja não encontrada.'; end if;
  insert into public.taggi_count_events (group_id,platform_id,store_id,event_type,delta)
  values (p_group_id,p_platform_id,p_store_id,'launch',p_quantity) returning id into result_id;
  return result_id;
end;
$$;

create or replace function public.taggi_record_occurrence(p_group_id uuid,p_platform_id uuid,p_store_id uuid,p_quantity integer,p_reason text)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare result_id uuid; current_total integer;
begin
  if not (select private_taggi.is_active_member(p_group_id)) then raise exception using errcode='42501',message='Empresa não autorizada.'; end if;
  if p_quantity<=0 or char_length(trim(coalesce(p_reason,'')))<3 then raise exception using errcode='22023',message='Informe quantidade e motivo.'; end if;
  if not exists(select 1 from public.taggi_platform_stores s where s.id=p_store_id and s.platform_id=p_platform_id and s.group_id=p_group_id and s.status='active') then raise exception using errcode='P0002',message='Loja não encontrada.'; end if;
  select coalesce(sum(delta),0) into current_total from public.taggi_count_events where group_id=p_group_id and platform_id=p_platform_id and store_id=p_store_id and work_date=(timezone('America/Sao_Paulo',now()))::date;
  if current_total<p_quantity then raise exception using errcode='22023',message='A ocorrência não pode deixar a contagem negativa.'; end if;
  insert into public.taggi_count_events (group_id,platform_id,store_id,event_type,delta,reason)
  values (p_group_id,p_platform_id,p_store_id,'occurrence',-p_quantity,trim(p_reason)) returning id into result_id;
  return result_id;
end;
$$;

create or replace function public.taggi_admin_correct_history_event(
  p_group_id uuid,p_event_id uuid,p_new_delta integer,p_reason text,
  p_session_id uuid,p_session_token text
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare original public.taggi_count_events%rowtype; difference integer; result_id uuid;
begin
  if not (select private_taggi.admin_session_valid(p_group_id,p_session_id,p_session_token)) or (select private_taggi.current_role_level(p_group_id))<2 then raise exception using errcode='42501',message='A Administração está bloqueada.'; end if;
  if char_length(trim(coalesce(p_reason,'')))<3 then raise exception using errcode='22023',message='Informe o motivo da correção.'; end if;
  select * into original from public.taggi_count_events where id=p_event_id and group_id=p_group_id for update;
  if original.id is null then raise exception using errcode='P0002',message='Registro do histórico não encontrado.'; end if;
  if original.event_type in ('admin_correction','admin_reset') then raise exception using errcode='22023',message='Corrija o registro original, não uma correção anterior.'; end if;
  difference:=p_new_delta-original.delta;
  if difference=0 then raise exception using errcode='22023',message='O novo valor é igual ao valor atual.'; end if;
  insert into public.taggi_count_events (group_id,platform_id,store_id,work_date,event_type,delta,reason,corrects_event_id,metadata)
  values (p_group_id,original.platform_id,original.store_id,original.work_date,'admin_correction',difference,trim(p_reason),original.id,jsonb_build_object('previousDelta',original.delta,'correctedDelta',p_new_delta))
  returning id into result_id;
  return result_id;
end;
$$;

create or replace function public.taggi_admin_reset_daily_counts(
  p_group_id uuid,p_reason text,p_session_id uuid,p_session_token text
)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare affected integer;
begin
  if not (select private_taggi.admin_session_valid(p_group_id,p_session_id,p_session_token)) or (select private_taggi.current_role_level(p_group_id))<2 then raise exception using errcode='42501',message='A Administração está bloqueada.'; end if;
  if char_length(trim(coalesce(p_reason,'')))<3 then raise exception using errcode='22023',message='Informe o motivo da zeragem.'; end if;
  with totals as (
    select platform_id,store_id,sum(delta)::integer total
    from public.taggi_count_events
    where group_id=p_group_id and work_date=(timezone('America/Sao_Paulo',now()))::date
    group by platform_id,store_id having sum(delta)<>0
  ), inserted as (
    insert into public.taggi_count_events (group_id,platform_id,store_id,event_type,delta,reason,metadata)
    select p_group_id,platform_id,store_id,'admin_reset',-total,trim(p_reason),jsonb_build_object('previousTotal',total)
    from totals returning 1
  ) select count(*) into affected from inserted;
  return affected;
end;
$$;

revoke execute on function public.taggi_record_launch(uuid,uuid,uuid,integer) from public,anon;
revoke execute on function public.taggi_record_occurrence(uuid,uuid,uuid,integer,text) from public,anon;
revoke execute on function public.taggi_admin_correct_history_event(uuid,uuid,integer,text,uuid,text) from public,anon;
revoke execute on function public.taggi_admin_reset_daily_counts(uuid,text,uuid,text) from public,anon;
grant execute on function public.taggi_record_launch(uuid,uuid,uuid,integer) to authenticated;
grant execute on function public.taggi_record_occurrence(uuid,uuid,uuid,integer,text) to authenticated;
grant execute on function public.taggi_admin_correct_history_event(uuid,uuid,integer,text,uuid,text) to authenticated;
grant execute on function public.taggi_admin_reset_daily_counts(uuid,text,uuid,text) to authenticated;

create table public.taggi_inventory_products (
  id uuid primary key default extensions.gen_random_uuid(),
  group_id uuid not null references public.taggi_groups(id) on delete cascade,
  name text not null,
  current_quantity integer not null default 0 check (current_quantity>=0),
  status text not null default 'active' check (status in ('active','archived')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index taggi_inventory_products_active_name_idx on public.taggi_inventory_products (group_id,lower(name)) where status='active';
create index taggi_inventory_products_group_status_idx on public.taggi_inventory_products (group_id,status,name);

create table public.taggi_inventory_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  group_id uuid not null references public.taggi_groups(id) on delete cascade,
  status text not null default 'editing' check (status in ('editing','finalized','cancelled')),
  responsible_user_id uuid not null references auth.users(id),
  responsible_name text not null,
  created_at timestamptz not null default now(),
  finalized_at timestamptz
);
create unique index taggi_inventory_one_editing_idx on public.taggi_inventory_sessions (group_id) where status='editing';
create index taggi_inventory_sessions_group_created_idx on public.taggi_inventory_sessions (group_id,created_at desc);

create table public.taggi_inventory_count_items (
  id uuid primary key default extensions.gen_random_uuid(),
  session_id uuid not null references public.taggi_inventory_sessions(id) on delete cascade,
  product_id uuid not null references public.taggi_inventory_products(id),
  previous_quantity integer not null check (previous_quantity>=0),
  counted_quantity integer not null check (counted_quantity>=0),
  unique (session_id,product_id)
);
create index taggi_inventory_count_items_product_idx on public.taggi_inventory_count_items (product_id);

create table public.taggi_inventory_urgencies (
  id uuid primary key default extensions.gen_random_uuid(),
  group_id uuid not null references public.taggi_groups(id) on delete cascade,
  session_id uuid not null references public.taggi_inventory_sessions(id) on delete cascade,
  product_id uuid not null references public.taggi_inventory_products(id),
  product_name text not null,
  quantity_snapshot integer not null check (quantity_snapshot>=0),
  status text not null default 'open' check (status in ('open','ordered','resolved','dismissed')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  unique (session_id,product_id)
);
create index taggi_inventory_urgencies_group_status_idx on public.taggi_inventory_urgencies (group_id,status,created_at desc);

create table public.taggi_inventory_withdrawals (
  id uuid primary key default extensions.gen_random_uuid(),
  group_id uuid not null references public.taggi_groups(id) on delete cascade,
  product_id uuid not null references public.taggi_inventory_products(id),
  product_name text not null,
  quantity integer not null check (quantity>0),
  previous_quantity integer not null check (previous_quantity>=0),
  new_quantity integer not null check (new_quantity>=0),
  responsible_user_id uuid not null references auth.users(id),
  responsible_name text not null,
  created_at timestamptz not null default now()
);
create index taggi_inventory_withdrawals_group_created_idx on public.taggi_inventory_withdrawals (group_id,created_at desc);
create index taggi_inventory_withdrawals_product_idx on public.taggi_inventory_withdrawals (product_id,created_at desc);

create or replace function private_taggi.inventory_actor_name(p_group_id uuid)
returns text
language sql
stable
security definer
set search_path=''
as $$
  select m.display_name from public.taggi_group_members m
  where m.group_id=p_group_id and m.user_id=(select auth.uid()) and m.status='active' limit 1;
$$;

create or replace function public.taggi_inventory_snapshot(p_group_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare result jsonb;
begin
  if not (select private_taggi.is_active_member(p_group_id)) then raise exception using errcode='42501',message='Empresa não autorizada.'; end if;
  select jsonb_build_object(
    'products',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'quantity',p.current_quantity,'status',p.status) order by p.name) from public.taggi_inventory_products p where p.group_id=p_group_id and p.status='active'),'[]'::jsonb),
    'session',(select jsonb_build_object('id',s.id,'status',s.status,'responsibleName',s.responsible_name,'createdAt',s.created_at) from public.taggi_inventory_sessions s where s.group_id=p_group_id and s.status='editing' order by s.created_at desc limit 1),
    'urgencies',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'productId',u.product_id,'productName',u.product_name,'quantity',u.quantity_snapshot,'status',u.status,'createdAt',u.created_at) order by u.created_at desc) from public.taggi_inventory_urgencies u where u.group_id=p_group_id and u.status in ('open','ordered')),'[]'::jsonb),
    'withdrawals',coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'productId',w.product_id,'productName',w.product_name,'quantity',w.quantity,'previousQuantity',w.previous_quantity,'newQuantity',w.new_quantity,'responsibleName',w.responsible_name,'createdAt',w.created_at) order by w.created_at desc) from (select * from public.taggi_inventory_withdrawals x where x.group_id=p_group_id order by x.created_at desc limit 50) w),'[]'::jsonb),
    'lastFinalized',(select jsonb_build_object('id',s.id,'responsibleName',s.responsible_name,'finalizedAt',s.finalized_at,'items',coalesce((select jsonb_agg(jsonb_build_object('productId',i.product_id,'previousQuantity',i.previous_quantity,'countedQuantity',i.counted_quantity,'productName',p.name) order by p.name) from public.taggi_inventory_count_items i join public.taggi_inventory_products p on p.id=i.product_id where i.session_id=s.id),'[]'::jsonb)) from public.taggi_inventory_sessions s where s.group_id=p_group_id and s.status='finalized' order by s.finalized_at desc limit 1)
  ) into result;
  return result;
end;
$$;

create or replace function public.taggi_inventory_begin(p_group_id uuid)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare result_id uuid; actor_name text;
begin
  if not (select private_taggi.is_active_member(p_group_id)) then raise exception using errcode='42501',message='Empresa não autorizada.'; end if;
  select id into result_id from public.taggi_inventory_sessions where group_id=p_group_id and status='editing' limit 1;
  if result_id is null then
    actor_name:=private_taggi.inventory_actor_name(p_group_id);
    insert into public.taggi_inventory_sessions (group_id,responsible_user_id,responsible_name)
    values (p_group_id,(select auth.uid()),actor_name) returning id into result_id;
  end if;
  return result_id;
end;
$$;

create or replace function public.taggi_inventory_save_product(p_group_id uuid,p_product_id uuid,p_name text,p_initial_quantity integer default 0)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare result_id uuid:=coalesce(p_product_id,extensions.gen_random_uuid()); clean_name text:=trim(p_name);
begin
  if not (select private_taggi.is_active_member(p_group_id)) then raise exception using errcode='42501',message='Empresa não autorizada.'; end if;
  if char_length(clean_name) not between 2 and 120 or p_initial_quantity<0 then raise exception using errcode='22023',message='Produto ou quantidade inválidos.'; end if;
  if p_product_id is null then
    insert into public.taggi_inventory_products (id,group_id,name,current_quantity,created_by) values (result_id,p_group_id,clean_name,p_initial_quantity,(select auth.uid()));
  else
    update public.taggi_inventory_products set name=clean_name,updated_at=now() where id=p_product_id and group_id=p_group_id and status='active';
    if not found then raise exception using errcode='P0002',message='Produto não encontrado.'; end if;
  end if;
  return result_id;
end;
$$;

create or replace function public.taggi_inventory_archive_product(p_group_id uuid,p_product_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if not (select private_taggi.is_active_member(p_group_id)) then raise exception using errcode='42501',message='Empresa não autorizada.'; end if;
  update public.taggi_inventory_products set status='archived',updated_at=now() where id=p_product_id and group_id=p_group_id and status='active';
  if not found then raise exception using errcode='P0002',message='Produto não encontrado.'; end if;
end;
$$;

create or replace function public.taggi_inventory_finalize(p_group_id uuid,p_session_id uuid,p_items jsonb,p_urgent_product_ids uuid[] default '{}')
returns void
language plpgsql
security definer
set search_path=''
as $$
declare item record; actor_name text;
begin
  if not (select private_taggi.is_active_member(p_group_id)) then raise exception using errcode='42501',message='Empresa não autorizada.'; end if;
  if not exists(select 1 from public.taggi_inventory_sessions s where s.id=p_session_id and s.group_id=p_group_id and s.status='editing' for update) then raise exception using errcode='P0002',message='Insumo em edição não encontrado.'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception using errcode='22023',message='Informe a contagem dos produtos.'; end if;
  if exists(select 1 from jsonb_to_recordset(p_items) as x("productId" uuid,quantity integer) where quantity<0) then raise exception using errcode='22023',message='A quantidade não pode ser negativa.'; end if;
  if (select count(*) from jsonb_to_recordset(p_items) as x("productId" uuid,quantity integer))<>(select count(distinct "productId") from jsonb_to_recordset(p_items) as x("productId" uuid,quantity integer)) then raise exception using errcode='22023',message='Produto repetido na contagem.'; end if;
  perform 1 from public.taggi_inventory_products p where p.group_id=p_group_id and p.status='active' order by p.id for update;
  if exists(select 1 from jsonb_to_recordset(p_items) as x("productId" uuid,quantity integer) left join public.taggi_inventory_products p on p.id=x."productId" and p.group_id=p_group_id and p.status='active' where p.id is null) then raise exception using errcode='P0002',message='Um produto não foi encontrado.'; end if;
  for item in select x."productId" product_id,x.quantity from jsonb_to_recordset(p_items) as x("productId" uuid,quantity integer)
  loop
    insert into public.taggi_inventory_count_items (session_id,product_id,previous_quantity,counted_quantity)
    select p_session_id,p.id,p.current_quantity,item.quantity from public.taggi_inventory_products p where p.id=item.product_id;
    update public.taggi_inventory_products set current_quantity=item.quantity,updated_at=now() where id=item.product_id;
  end loop;
  insert into public.taggi_inventory_urgencies (group_id,session_id,product_id,product_name,quantity_snapshot,created_by)
  select p_group_id,p_session_id,p.id,p.name,p.current_quantity,(select auth.uid())
  from public.taggi_inventory_products p where p.group_id=p_group_id and p.id=any(coalesce(p_urgent_product_ids,'{}'::uuid[])) and p.status='active'
  on conflict (session_id,product_id) do nothing;
  actor_name:=private_taggi.inventory_actor_name(p_group_id);
  update public.taggi_inventory_sessions set status='finalized',responsible_user_id=(select auth.uid()),responsible_name=actor_name,finalized_at=now() where id=p_session_id;
end;
$$;

create or replace function public.taggi_inventory_withdraw(p_group_id uuid,p_product_id uuid,p_quantity integer)
returns table (previous_quantity integer,new_quantity integer)
language plpgsql
security definer
set search_path=''
as $$
declare product public.taggi_inventory_products%rowtype; actor_name text;
begin
  if not (select private_taggi.is_active_member(p_group_id)) then raise exception using errcode='42501',message='Empresa não autorizada.'; end if;
  if p_quantity<=0 then raise exception using errcode='22023',message='Informe uma quantidade maior que zero.'; end if;
  select * into product from public.taggi_inventory_products where id=p_product_id and group_id=p_group_id and status='active' for update;
  if product.id is null then raise exception using errcode='P0002',message='Produto não encontrado.'; end if;
  if product.current_quantity<p_quantity then raise exception using errcode='22023',message='A retirada é maior que o estoque disponível.'; end if;
  actor_name:=private_taggi.inventory_actor_name(p_group_id);
  update public.taggi_inventory_products set current_quantity=current_quantity-p_quantity,updated_at=now() where id=product.id;
  insert into public.taggi_inventory_withdrawals (group_id,product_id,product_name,quantity,previous_quantity,new_quantity,responsible_user_id,responsible_name)
  values (p_group_id,product.id,product.name,p_quantity,product.current_quantity,product.current_quantity-p_quantity,(select auth.uid()),actor_name);
  return query select product.current_quantity,product.current_quantity-p_quantity;
end;
$$;

create or replace function public.taggi_admin_set_inventory_urgency_status(p_group_id uuid,p_urgency_id uuid,p_status text,p_session_id uuid,p_session_token text)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if not (select private_taggi.admin_session_valid(p_group_id,p_session_id,p_session_token)) or (select private_taggi.current_role_level(p_group_id))<2 then raise exception using errcode='42501',message='A Administração está bloqueada.'; end if;
  if p_status not in ('open','ordered','resolved','dismissed') then raise exception using errcode='22023',message='Status inválido.'; end if;
  update public.taggi_inventory_urgencies set status=p_status,resolved_by=case when p_status in ('resolved','dismissed') then (select auth.uid()) else null end,resolved_at=case when p_status in ('resolved','dismissed') then now() else null end where id=p_urgency_id and group_id=p_group_id;
  if not found then raise exception using errcode='P0002',message='Urgência não encontrada.'; end if;
end;
$$;

alter table public.taggi_inventory_products enable row level security;
alter table public.taggi_inventory_products force row level security;
alter table public.taggi_inventory_sessions enable row level security;
alter table public.taggi_inventory_sessions force row level security;
alter table public.taggi_inventory_count_items enable row level security;
alter table public.taggi_inventory_count_items force row level security;
alter table public.taggi_inventory_urgencies enable row level security;
alter table public.taggi_inventory_urgencies force row level security;
alter table public.taggi_inventory_withdrawals enable row level security;
alter table public.taggi_inventory_withdrawals force row level security;

create policy taggi_inventory_products_member_read on public.taggi_inventory_products
for select to authenticated using ((select private_taggi.is_active_member(group_id)));
create policy taggi_inventory_sessions_member_read on public.taggi_inventory_sessions
for select to authenticated using ((select private_taggi.is_active_member(group_id)));
create policy taggi_inventory_items_member_read on public.taggi_inventory_count_items
for select to authenticated using (exists(select 1 from public.taggi_inventory_sessions s where s.id=session_id and (select private_taggi.is_active_member(s.group_id))));
create policy taggi_inventory_urgencies_member_read on public.taggi_inventory_urgencies
for select to authenticated using ((select private_taggi.is_active_member(group_id)));
create policy taggi_inventory_withdrawals_member_read on public.taggi_inventory_withdrawals
for select to authenticated using ((select private_taggi.is_active_member(group_id)));

revoke all on public.taggi_inventory_products,public.taggi_inventory_sessions,
  public.taggi_inventory_count_items,public.taggi_inventory_urgencies,
  public.taggi_inventory_withdrawals from public,anon,authenticated;
grant select on public.taggi_inventory_products,public.taggi_inventory_sessions,
  public.taggi_inventory_count_items,public.taggi_inventory_urgencies,
  public.taggi_inventory_withdrawals to authenticated;

revoke execute on function public.taggi_inventory_snapshot(uuid) from public,anon;
revoke execute on function public.taggi_inventory_begin(uuid) from public,anon;
revoke execute on function public.taggi_inventory_save_product(uuid,uuid,text,integer) from public,anon;
revoke execute on function public.taggi_inventory_archive_product(uuid,uuid) from public,anon;
revoke execute on function public.taggi_inventory_finalize(uuid,uuid,jsonb,uuid[]) from public,anon;
revoke execute on function public.taggi_inventory_withdraw(uuid,uuid,integer) from public,anon;
revoke execute on function public.taggi_admin_set_inventory_urgency_status(uuid,uuid,text,uuid,text) from public,anon;
grant execute on function public.taggi_inventory_snapshot(uuid) to authenticated;
grant execute on function public.taggi_inventory_begin(uuid) to authenticated;
grant execute on function public.taggi_inventory_save_product(uuid,uuid,text,integer) to authenticated;
grant execute on function public.taggi_inventory_archive_product(uuid,uuid) to authenticated;
grant execute on function public.taggi_inventory_finalize(uuid,uuid,jsonb,uuid[]) to authenticated;
grant execute on function public.taggi_inventory_withdraw(uuid,uuid,integer) to authenticated;
grant execute on function public.taggi_admin_set_inventory_urgency_status(uuid,uuid,text,uuid,text) to authenticated;

alter table public.taggi_inventory_products replica identity full;
alter table public.taggi_inventory_sessions replica identity full;
alter table public.taggi_inventory_urgencies replica identity full;
alter table public.taggi_inventory_withdrawals replica identity full;
alter publication supabase_realtime add table public.taggi_inventory_products;
alter publication supabase_realtime add table public.taggi_inventory_sessions;
alter publication supabase_realtime add table public.taggi_inventory_urgencies;
alter publication supabase_realtime add table public.taggi_inventory_withdrawals;

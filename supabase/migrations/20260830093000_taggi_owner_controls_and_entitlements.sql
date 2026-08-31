-- Owner controls, feedback taxonomy and server-side entitlement enforcement.

alter table public.taggi_feedback drop constraint if exists taggi_feedback_category_check;
update public.taggi_feedback set category='problema' where category='reclamacao';
alter table public.taggi_feedback add constraint taggi_feedback_category_check
check (category in ('sugestao','problema','elogio','interface','desempenho','cobranca','outro'));

alter table public.taggi_feedback drop constraint if exists taggi_feedback_status_check;
alter table public.taggi_feedback add constraint taggi_feedback_status_check
check (status in ('new','reviewing','planned','resolved','discarded'));

create or replace function private_taggi.group_entitled(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists (
    select 1
    from public.taggi_groups g
    join lateral (
      select s.status,s.current_period_end
      from public.taggi_subscriptions s
      where s.group_id=g.id
      order by s.created_at desc
      limit 1
    ) latest on true
    where g.id=p_group_id
      and g.status='active'
      and latest.status in ('trial','active','lifetime')
      and (latest.status='lifetime' or latest.current_period_end is null or latest.current_period_end>now())
  );
$$;

create or replace function private_taggi.enforce_group_entitlement()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare target_group_id uuid;
begin
  target_group_id := new.group_id;
  if (select auth.uid()) is not null and not (select private_taggi.group_entitled(target_group_id)) then
    raise exception using errcode='42501',message='A assinatura desta empresa não permite novas operações. Resgate uma licença ou regularize o plano.';
  end if;
  return new;
end;
$$;

drop trigger if exists taggi_count_events_entitlement on public.taggi_count_events;
create trigger taggi_count_events_entitlement before insert or update on public.taggi_count_events
for each row execute function private_taggi.enforce_group_entitlement();

drop trigger if exists taggi_chat_messages_entitlement on public.taggi_chat_messages;
create trigger taggi_chat_messages_entitlement before insert or update on public.taggi_chat_messages
for each row execute function private_taggi.enforce_group_entitlement();

drop trigger if exists taggi_inventory_products_entitlement on public.taggi_inventory_products;
create trigger taggi_inventory_products_entitlement before insert or update on public.taggi_inventory_products
for each row execute function private_taggi.enforce_group_entitlement();

drop trigger if exists taggi_inventory_sessions_entitlement on public.taggi_inventory_sessions;
create trigger taggi_inventory_sessions_entitlement before insert or update on public.taggi_inventory_sessions
for each row execute function private_taggi.enforce_group_entitlement();

drop trigger if exists taggi_inventory_count_items_entitlement on public.taggi_inventory_count_items;
create trigger taggi_inventory_count_items_entitlement before insert or update on public.taggi_inventory_count_items
for each row execute function private_taggi.enforce_group_entitlement();

drop trigger if exists taggi_inventory_urgencies_entitlement on public.taggi_inventory_urgencies;
create trigger taggi_inventory_urgencies_entitlement before insert or update on public.taggi_inventory_urgencies
for each row execute function private_taggi.enforce_group_entitlement();

drop trigger if exists taggi_inventory_withdrawals_entitlement on public.taggi_inventory_withdrawals;
create trigger taggi_inventory_withdrawals_entitlement before insert or update on public.taggi_inventory_withdrawals
for each row execute function private_taggi.enforce_group_entitlement();

create or replace function public.taggi_owner_set_company_subscription(
  p_group_id uuid,
  p_plan_id uuid,
  p_status text,
  p_valid_until timestamptz,
  p_session_id uuid,
  p_session_token text
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  selected_plan public.taggi_plans%rowtype;
  subscription_id uuid;
  normalized_status text := lower(trim(p_status));
begin
  if not (select private_taggi.owner_session_valid(p_session_id,p_session_token)) then
    raise exception using errcode='42501',message='Sessão Owner inválida.';
  end if;
  if normalized_status not in ('trial','active','past_due','expired','cancelled','lifetime') then
    raise exception using errcode='22023',message='Status de assinatura inválido.';
  end if;
  if not exists(select 1 from public.taggi_groups where id=p_group_id) then
    raise exception using errcode='P0002',message='Empresa não encontrada.';
  end if;
  select * into selected_plan from public.taggi_plans where id=p_plan_id;
  if selected_plan.id is null then raise exception using errcode='P0002',message='Plano não encontrado.'; end if;
  if normalized_status='lifetime' or selected_plan.period='lifetime' then
    normalized_status := 'lifetime';
    p_valid_until := null;
  elsif normalized_status in ('trial','active') and p_valid_until is null then
    p_valid_until := now()+case selected_plan.period
      when 'quarterly' then interval '3 months'
      when 'semiannual' then interval '6 months'
      when 'annual' then interval '1 year'
      else interval '1 month'
    end;
  end if;
  update public.taggi_subscriptions
  set status='cancelled',cancelled_at=now(),updated_at=now()
  where group_id=p_group_id and status in ('trial','active','past_due','lifetime');
  insert into public.taggi_subscriptions(group_id,plan_id,status,price_cents,started_at,current_period_end,next_billing_at,source)
  values(p_group_id,p_plan_id,normalized_status,selected_plan.price_cents,now(),p_valid_until,
    case when normalized_status='active' then p_valid_until else null end,'owner')
  returning id into subscription_id;
  perform private_taggi.write_owner_audit('company_subscription','company',p_group_id::text,
    jsonb_build_object('subscriptionId',subscription_id,'planId',p_plan_id,'status',normalized_status,'validUntil',p_valid_until));
  return subscription_id;
end;
$$;

create or replace function public.taggi_owner_save_version(
  p_version text,
  p_build_number bigint,
  p_channel text,
  p_status text,
  p_minimum_version text,
  p_release_notes text,
  p_download_url text,
  p_mandatory boolean,
  p_session_id uuid,
  p_session_token text
)
returns text
language plpgsql
security definer
set search_path=''
as $$
declare normalized_channel text:=lower(trim(p_channel)); normalized_status text:=upper(trim(p_status));
begin
  if not (select private_taggi.owner_session_valid(p_session_id,p_session_token)) then
    raise exception using errcode='42501',message='Sessão Owner inválida.';
  end if;
  if trim(p_version) !~ '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$' then raise exception using errcode='22023',message='Versão inválida.'; end if;
  if normalized_channel not in ('beta','stable') then raise exception using errcode='22023',message='Canal inválido.'; end if;
  if normalized_status not in ('DRAFT','BETA','STABLE','DEPRECATED','BLOCKED') then raise exception using errcode='22023',message='Status inválido.'; end if;
  insert into public.taggi_app_releases(version,build_number,channel,status,minimum_supported_version,release_notes,download_url,mandatory,published_at)
  values(trim(p_version),greatest(p_build_number,1),normalized_channel,normalized_status,nullif(trim(p_minimum_version),''),coalesce(p_release_notes,''),nullif(trim(p_download_url),''),coalesce(p_mandatory,false),case when normalized_status in ('BETA','STABLE') then now() else null end)
  on conflict(version) do update set build_number=excluded.build_number,channel=excluded.channel,status=excluded.status,
    minimum_supported_version=excluded.minimum_supported_version,release_notes=excluded.release_notes,download_url=excluded.download_url,
    mandatory=excluded.mandatory,published_at=excluded.published_at,updated_at=now();
  if normalized_status='STABLE' then
    update public.taggi_release_policy set latest_version=trim(p_version),stable_version=trim(p_version),minimum_supported_version=coalesce(nullif(trim(p_minimum_version),''),minimum_supported_version),updated_at=now() where id=true;
  elsif normalized_status='BETA' then
    update public.taggi_release_policy set latest_version=trim(p_version),beta_version=trim(p_version),minimum_supported_version=coalesce(nullif(trim(p_minimum_version),''),minimum_supported_version),updated_at=now() where id=true;
  end if;
  perform private_taggi.write_owner_audit('version_saved','app_version',trim(p_version),jsonb_build_object('channel',normalized_channel,'status',normalized_status,'mandatory',p_mandatory));
  return trim(p_version);
end;
$$;

create or replace function public.taggi_owner_update_setting(
  p_key text,
  p_value jsonb,
  p_session_id uuid,
  p_session_token text
)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if not (select private_taggi.owner_session_valid(p_session_id,p_session_token)) then raise exception using errcode='42501',message='Sessão Owner inválida.'; end if;
  update public.taggi_system_settings set value=p_value,updated_by=(select auth.uid()),updated_at=now() where key=p_key;
  if not found then raise exception using errcode='P0002',message='Configuração não encontrada.'; end if;
  perform private_taggi.write_owner_audit('setting_update','system_setting',p_key,jsonb_build_object('value',p_value));
end;
$$;

revoke all on function public.taggi_owner_set_company_subscription(uuid,uuid,text,timestamptz,uuid,text) from public,anon;
revoke all on function public.taggi_owner_save_version(text,bigint,text,text,text,text,text,boolean,uuid,text) from public,anon;
revoke all on function public.taggi_owner_update_setting(text,jsonb,uuid,text) from public,anon;
grant execute on function public.taggi_owner_set_company_subscription(uuid,uuid,text,timestamptz,uuid,text) to authenticated;
grant execute on function public.taggi_owner_save_version(text,bigint,text,text,text,text,text,boolean,uuid,text) to authenticated;
grant execute on function public.taggi_owner_update_setting(text,jsonb,uuid,text) to authenticated;

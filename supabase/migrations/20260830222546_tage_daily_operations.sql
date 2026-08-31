begin;

-- Preserve the complete label history. The old retention routine now removes
-- only expired privileged sessions.
create or replace function private_taggi.purge_expired_history()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private_taggi.admin_sessions
  where expires_at < now() - interval '1 day'
     or revoked_at < now() - interval '1 day';
end;
$$;

-- Corrections and administrative resets are immutable events too.
alter table public.taggi_count_events
  drop constraint if exists taggi_count_events_event_type_check;
alter table public.taggi_count_events
  add constraint taggi_count_events_event_type_check
  check (
    event_type in (
      'launch',
      'occurrence',
      'reset',
      'adjustment',
      'admin_adjustment',
      'admin_correction',
      'admin_reset'
    )
  );

create table public.taggi_daily_count_closures (
  id uuid primary key default extensions.gen_random_uuid(),
  group_id uuid not null references public.taggi_groups(id) on delete cascade,
  platform_id uuid not null,
  store_id uuid not null,
  work_date date not null,
  launch_total integer not null default 0,
  occurrence_total integer not null default 0,
  adjustment_total integer not null default 0,
  final_total integer not null default 0,
  event_count integer not null default 0 check (event_count >= 0),
  status text not null default 'confirmed' check (status = 'confirmed'),
  closed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, platform_id, store_id, work_date),
  constraint taggi_daily_closures_platform_fkey
    foreign key (group_id, platform_id)
    references public.taggi_platforms(group_id, id)
    on delete restrict,
  constraint taggi_daily_closures_store_fkey
    foreign key (group_id, platform_id, store_id)
    references public.taggi_platform_stores(group_id, platform_id, id)
    on delete restrict
);

create index taggi_daily_closures_group_month_idx
on public.taggi_daily_count_closures (group_id, work_date desc);

create index taggi_daily_closures_platform_month_idx
on public.taggi_daily_count_closures (
  group_id,
  platform_id,
  store_id,
  work_date desc
);

alter table public.taggi_daily_count_closures enable row level security;
alter table public.taggi_daily_count_closures force row level security;

create policy taggi_daily_closures_member_select
on public.taggi_daily_count_closures
for select
to authenticated
using ((select private_taggi.is_active_member(group_id)));

revoke all on public.taggi_daily_count_closures
from public, anon, authenticated;
grant select on public.taggi_daily_count_closures to authenticated;

create or replace function private_taggi.close_operational_day(
  p_work_date date,
  p_group_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
begin
  if p_work_date is null
    or p_work_date >= (pg_catalog.timezone('America/Sao_Paulo', now()))::date then
    raise exception using
      errcode = '22023',
      message = 'O fechamento só pode confirmar um dia já encerrado.';
  end if;

  insert into public.taggi_daily_count_closures (
    group_id,
    platform_id,
    store_id,
    work_date,
    launch_total,
    occurrence_total,
    adjustment_total,
    final_total,
    event_count,
    status,
    closed_at,
    updated_at
  )
  select
    event.group_id,
    event.platform_id,
    event.store_id,
    event.work_date,
    coalesce(sum(event.delta) filter (
      where event.event_type = 'launch'
    ), 0)::integer,
    coalesce(sum(event.delta) filter (
      where event.event_type = 'occurrence'
    ), 0)::integer,
    coalesce(sum(event.delta) filter (
      where event.event_type not in ('launch', 'occurrence')
    ), 0)::integer,
    coalesce(sum(event.delta), 0)::integer,
    count(*)::integer,
    'confirmed',
    now(),
    now()
  from public.taggi_count_events event
  where event.work_date = p_work_date
    and (p_group_id is null or event.group_id = p_group_id)
  group by
    event.group_id,
    event.platform_id,
    event.store_id,
    event.work_date
  on conflict (group_id, platform_id, store_id, work_date) do update
    set launch_total = excluded.launch_total,
        occurrence_total = excluded.occurrence_total,
        adjustment_total = excluded.adjustment_total,
        final_total = excluded.final_total,
        event_count = excluded.event_count,
        status = 'confirmed',
        closed_at = excluded.closed_at,
        updated_at = now();

  get diagnostics affected = row_count;
  return affected;
end;
$$;

create or replace function private_taggi.refresh_closed_count_day()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.work_date <
    (pg_catalog.timezone('America/Sao_Paulo', now()))::date then
    perform private_taggi.close_operational_day(
      new.work_date,
      new.group_id
    );
  end if;
  return new;
end;
$$;

create trigger taggi_refresh_closed_count_day
after insert on public.taggi_count_events
for each row execute function private_taggi.refresh_closed_count_day();

create or replace view public.taggi_monthly_count_history
with (security_invoker = true)
as
select
  closure.group_id,
  date_trunc('month', closure.work_date::timestamp)::date as month_start,
  closure.platform_id,
  closure.store_id,
  sum(closure.launch_total)::bigint as launch_total,
  sum(closure.occurrence_total)::bigint as occurrence_total,
  sum(closure.adjustment_total)::bigint as adjustment_total,
  sum(closure.final_total)::bigint as final_total,
  sum(closure.event_count)::bigint as event_count,
  count(distinct closure.work_date)::integer as closed_days,
  max(closure.closed_at) as last_closed_at
from public.taggi_daily_count_closures closure
group by
  closure.group_id,
  date_trunc('month', closure.work_date::timestamp)::date,
  closure.platform_id,
  closure.store_id;

revoke all on public.taggi_monthly_count_history
from public, anon, authenticated;
grant select on public.taggi_monthly_count_history to authenticated;

-- Every message expires at the next São Paulo midnight. The exact midnight
-- job performs the cleanup; the existing hourly job remains a safe fallback.
create or replace function private_taggi.prepare_chat_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  conversation_group_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception using
      errcode = '42501',
      message = 'Faça login para enviar mensagens.';
  end if;

  select conversation.group_id into conversation_group_id
  from public.taggi_chat_conversations conversation
  where conversation.id = new.conversation_id;

  if conversation_group_id is null
    or not (select private_taggi.can_access_conversation(new.conversation_id)) then
    raise exception using
      errcode = '42501',
      message = 'Conversa não autorizada.';
  end if;

  new.group_id := conversation_group_id;
  new.sender_user_id := (select auth.uid());
  new.content := trim(coalesce(new.content, ''));
  new.created_at := now();
  new.expires_at := (
    (
      (pg_catalog.timezone('America/Sao_Paulo', now()))::date + 1
    )::timestamp at time zone 'America/Sao_Paulo'
  );

  if new.attachment_path is not null and (
    split_part(new.attachment_path, '/', 1) <> conversation_group_id::text
    or split_part(new.attachment_path, '/', 2) <> new.conversation_id::text
    or split_part(new.attachment_path, '/', 3) <> (select auth.uid())::text
  ) then
    raise exception using
      errcode = '22023',
      message = 'Caminho de anexo inválido.';
  end if;

  if new.reply_to_message_id is not null and not exists (
    select 1
    from public.taggi_chat_messages reply
    where reply.id = new.reply_to_message_id
      and reply.conversation_id = new.conversation_id
  ) then
    raise exception using
      errcode = '22023',
      message = 'Mensagem respondida não pertence à conversa.';
  end if;

  update public.taggi_chat_conversations
  set updated_at = now()
  where id = new.conversation_id;

  return new;
end;
$$;

create or replace function private_taggi.purge_previous_chat_day()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  local_today date;
  day_start timestamptz;
  modern_affected integer;
  legacy_affected integer;
begin
  local_today := (pg_catalog.timezone(
    'America/Sao_Paulo',
    now()
  ))::date;
  day_start := local_today::timestamp at time zone 'America/Sao_Paulo';

  delete from public.taggi_chat_messages
  where created_at < day_start;
  get diagnostics modern_affected = row_count;

  delete from public.taggi_messages
  where created_at < day_start;
  get diagnostics legacy_affected = row_count;

  update public.taggi_user_presence
  set is_online = false,
      updated_at = now()
  where is_online
    and last_seen < now() - interval '3 minutes';

  return modern_affected + legacy_affected;
end;
$$;

create or replace function private_taggi.run_daily_midnight_operations()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  local_yesterday date;
  closed_rows integer;
  deleted_messages integer;
begin
  local_yesterday := (
    pg_catalog.timezone('America/Sao_Paulo', now())
  )::date - 1;

  closed_rows := private_taggi.close_operational_day(local_yesterday);
  deleted_messages := private_taggi.purge_previous_chat_day();
  perform private_taggi.purge_expired_history();

  return jsonb_build_object(
    'work_date', local_yesterday,
    'closed_rows', closed_rows,
    'deleted_messages', deleted_messages,
    'completed_at', now()
  );
end;
$$;

revoke execute on function private_taggi.close_operational_day(date, uuid)
from public, anon, authenticated;
revoke execute on function private_taggi.refresh_closed_count_day()
from public, anon, authenticated;
revoke execute on function private_taggi.purge_previous_chat_day()
from public, anon, authenticated;
revoke execute on function private_taggi.run_daily_midnight_operations()
from public, anon, authenticated;

alter table public.taggi_daily_count_closures replica identity full;
alter publication supabase_realtime
add table public.taggi_daily_count_closures;

select cron.schedule(
  'tage-daily-midnight-operations',
  '0 3 * * *',
  'select private_taggi.run_daily_midnight_operations();'
);

commit;

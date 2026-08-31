-- Companies created before billing was introduced did not receive a trial.
-- Backfill only groups that have never had any subscription, preserving all
-- existing commercial history and owner-granted access.
do $$
declare
  trial_plan_id uuid;
  trial_days integer;
begin
  select p.id
  into trial_plan_id
  from public.taggi_plans p
  where p.period = 'trial'
    and p.status = 'active'
  order by p.created_at
  limit 1;

  if trial_plan_id is null then
    raise exception 'O plano de teste ativo não foi encontrado.';
  end if;

  trial_days := coalesce(
    (
      select (s.value #>> '{}')::integer
      from public.taggi_system_settings s
      where s.key = 'trial_days'
    ),
    14
  );

  insert into public.taggi_subscriptions (
    group_id,
    plan_id,
    status,
    price_cents,
    current_period_end,
    next_billing_at,
    source
  )
  select
    g.id,
    trial_plan_id,
    'trial',
    0,
    now() + make_interval(days => trial_days),
    null,
    'legacy_trial_backfill'
  from public.taggi_groups g
  where g.status = 'active'
    and not exists (
      select 1
      from public.taggi_subscriptions existing
      where existing.group_id = g.id
    );
end;
$$;

-- Taggi Owner, planos, assinaturas, licenças e controles globais.
-- Funções administrativas usam SECURITY DEFINER e uma sessão Owner separada.

alter table public.taggi_profiles
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists blocked_at timestamptz,
  add column if not exists blocked_reason text;

alter table public.taggi_groups
  add column if not exists blocked_at timestamptz,
  add column if not exists blocked_reason text;

alter table public.taggi_feedback
  add column if not exists app_version text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.taggi_app_releases
  add column if not exists download_url text,
  add column if not exists mandatory boolean not null default false;

alter table public.taggi_member_preferences
  add column if not exists chat_retention_notice_seen boolean not null default false,
  add column if not exists chat_retention_notice_version integer not null default 1;

create table if not exists private_taggi.owner_email_allowlist (
  email text primary key,
  created_at timestamptz not null default now(),
  constraint taggi_owner_allowlist_email_lower check (email = lower(email))
);

create table if not exists private_taggi.system_owners (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default true,
  granted_at timestamptz not null default now(),
  last_access_at timestamptz
);

create table if not exists private_taggi.owner_credentials (
  user_id uuid primary key references private_taggi.system_owners(user_id) on delete cascade,
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists private_taggi.owner_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references private_taggi.system_owners(user_id) on delete cascade,
  token_hash bytea not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists taggi_owner_sessions_user_expiry_idx
  on private_taggi.owner_sessions (user_id, expires_at desc)
  where revoked_at is null;

insert into private_taggi.owner_email_allowlist (email)
values ('juannunesfeitosa120@gmail.com')
on conflict (email) do nothing;

create or replace function private_taggi.grant_allowlisted_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email_confirmed_at is not null
     and exists (
       select 1 from private_taggi.owner_email_allowlist a
       where a.email = lower(new.email)
     ) then
    insert into private_taggi.system_owners (user_id)
    values (new.id)
    on conflict (user_id) do update set active = true;
  end if;
  return new;
end;
$$;

drop trigger if exists taggi_grant_allowlisted_owner on auth.users;
create trigger taggi_grant_allowlisted_owner
after insert or update of email_confirmed_at, email on auth.users
for each row execute function private_taggi.grant_allowlisted_owner();

insert into private_taggi.system_owners (user_id)
select u.id
from auth.users u
join private_taggi.owner_email_allowlist a on a.email = lower(u.email)
where u.email_confirmed_at is not null
on conflict (user_id) do update set active = true;

create or replace function private_taggi.is_system_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from private_taggi.system_owners o
    join auth.users u on u.id = o.user_id
    where o.user_id = (select auth.uid())
      and o.active
      and u.email_confirmed_at is not null
  );
$$;

create or replace function private_taggi.owner_session_valid(
  target_session_id uuid,
  raw_token text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private_taggi.is_system_owner())
    and exists (
      select 1
      from private_taggi.owner_sessions s
      where s.id = target_session_id
        and s.user_id = (select auth.uid())
        and s.revoked_at is null
        and s.expires_at > now()
        and s.token_hash = extensions.digest(raw_token, 'sha256')
    );
$$;

create table if not exists public.taggi_plans (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  price_cents integer not null default 0 check (price_cents >= 0),
  period text not null check (period in ('monthly','quarterly','semiannual','annual','lifetime','promotional','trial')),
  features jsonb not null default '[]'::jsonb,
  user_limit integer check (user_limit is null or user_limit > 0),
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists taggi_plans_name_unique on public.taggi_plans (lower(name));
create index if not exists taggi_plans_status_period_idx on public.taggi_plans (status, period);

create table if not exists public.taggi_subscriptions (
  id uuid primary key default extensions.gen_random_uuid(),
  group_id uuid not null references public.taggi_groups(id) on delete cascade,
  plan_id uuid not null references public.taggi_plans(id),
  status text not null check (status in ('trial','active','past_due','expired','cancelled','lifetime')),
  price_cents integer not null default 0 check (price_cents >= 0),
  started_at timestamptz not null default now(),
  current_period_end timestamptz,
  next_billing_at timestamptz,
  cancelled_at timestamptz,
  payment_method text,
  source text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists taggi_subscriptions_one_current_group_idx
  on public.taggi_subscriptions (group_id)
  where status in ('trial','active','past_due','lifetime');
create index if not exists taggi_subscriptions_status_end_idx
  on public.taggi_subscriptions (status, current_period_end);
create index if not exists taggi_subscriptions_plan_idx on public.taggi_subscriptions (plan_id);

create table if not exists public.taggi_payments (
  id uuid primary key default extensions.gen_random_uuid(),
  group_id uuid not null references public.taggi_groups(id) on delete cascade,
  subscription_id uuid references public.taggi_subscriptions(id) on delete set null,
  amount_cents integer not null check (amount_cents >= 0),
  status text not null check (status in ('pending','paid','failed','refunded','cancelled')),
  method text,
  provider text not null default 'manual',
  provider_reference text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists taggi_payments_group_created_idx on public.taggi_payments (group_id, created_at desc);
create index if not exists taggi_payments_status_created_idx on public.taggi_payments (status, created_at desc);

create table if not exists public.taggi_licenses (
  id uuid primary key default extensions.gen_random_uuid(),
  code_hash bytea not null unique,
  code_hint text not null,
  license_type text not null check (license_type in ('monthly','quarterly','annual','lifetime','promotional','partnership','trial')),
  plan_id uuid not null references public.taggi_plans(id),
  target_scope text not null check (target_scope in ('account','company')),
  beneficiary_user_id uuid references auth.users(id) on delete set null,
  beneficiary_group_id uuid references public.taggi_groups(id) on delete set null,
  max_uses integer not null default 1 check (max_uses > 0),
  uses_count integer not null default 0 check (uses_count >= 0),
  duration_days integer check (duration_days is null or duration_days > 0),
  expires_at timestamptz,
  status text not null default 'unused' check (status in ('unused','partially_used','redeemed','expired','revoked')),
  note text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists taggi_licenses_status_expiry_idx on public.taggi_licenses (status, expires_at);
create index if not exists taggi_licenses_plan_idx on public.taggi_licenses (plan_id);

create table if not exists public.taggi_license_redemptions (
  id uuid primary key default extensions.gen_random_uuid(),
  license_id uuid not null references public.taggi_licenses(id),
  user_id uuid not null references auth.users(id),
  group_id uuid not null references public.taggi_groups(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  unique (license_id, user_id, group_id)
);

create index if not exists taggi_license_redemptions_group_idx on public.taggi_license_redemptions (group_id, redeemed_at desc);
create index if not exists taggi_license_redemptions_user_idx on public.taggi_license_redemptions (user_id, redeemed_at desc);

create table if not exists public.taggi_owner_audit_logs (
  id bigint generated always as identity primary key,
  owner_user_id uuid not null references auth.users(id),
  action text not null,
  target_type text not null,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);

create index if not exists taggi_owner_audit_action_created_idx on public.taggi_owner_audit_logs (action, created_at desc);
create index if not exists taggi_owner_audit_target_idx on public.taggi_owner_audit_logs (target_type, target_id, created_at desc);

create table if not exists public.taggi_system_settings (
  key text primary key,
  value jsonb not null,
  description text not null default '',
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

insert into public.taggi_system_settings (key, value, description)
values
  ('maintenance_enabled', 'false', 'Bloqueia temporariamente o uso do aplicativo.'),
  ('registrations_enabled', 'true', 'Permite novos cadastros.'),
  ('trial_days', '14', 'Duração padrão do período de teste.'),
  ('default_member_limit', '25', 'Limite padrão de membros por empresa.'),
  ('global_message', '""', 'Mensagem global exibida aos usuários.'),
  ('support_contact', '""', 'Contato oficial de suporte.'),
  ('download_page', '""', 'Página oficial para download.'),
  ('payments_status', '"not_configured"', 'Estado atual da integração de pagamentos.')
on conflict (key) do nothing;

insert into public.taggi_plans (name, price_cents, period, features, user_limit, status)
values
  ('Teste', 0, 'trial', '["Contagens", "Histórico", "Chat", "Insumos"]', 25, 'active'),
  ('Mensal', 0, 'monthly', '["Recursos completos"]', 25, 'inactive'),
  ('Trimestral', 0, 'quarterly', '["Recursos completos"]', 25, 'inactive'),
  ('Semestral', 0, 'semiannual', '["Recursos completos"]', 25, 'inactive'),
  ('Anual', 0, 'annual', '["Recursos completos"]', 25, 'inactive'),
  ('Vitalício', 0, 'lifetime', '["Acesso vitalício"]', null, 'active'),
  ('Promocional', 0, 'promotional', '["Benefício promocional"]', 25, 'inactive')
on conflict do nothing;

alter table public.taggi_plans enable row level security;
alter table public.taggi_plans force row level security;
alter table public.taggi_subscriptions enable row level security;
alter table public.taggi_subscriptions force row level security;
alter table public.taggi_payments enable row level security;
alter table public.taggi_payments force row level security;
alter table public.taggi_licenses enable row level security;
alter table public.taggi_licenses force row level security;
alter table public.taggi_license_redemptions enable row level security;
alter table public.taggi_license_redemptions force row level security;
alter table public.taggi_owner_audit_logs enable row level security;
alter table public.taggi_owner_audit_logs force row level security;
alter table public.taggi_system_settings enable row level security;
alter table public.taggi_system_settings force row level security;

drop policy if exists taggi_plans_authenticated_read on public.taggi_plans;
create policy taggi_plans_authenticated_read on public.taggi_plans
for select to authenticated using (status = 'active');

drop policy if exists taggi_subscriptions_member_read on public.taggi_subscriptions;
create policy taggi_subscriptions_member_read on public.taggi_subscriptions
for select to authenticated using ((select private_taggi.is_active_member(group_id)));

drop policy if exists taggi_license_redemptions_own_read on public.taggi_license_redemptions;
create policy taggi_license_redemptions_own_read on public.taggi_license_redemptions
for select to authenticated using (user_id = (select auth.uid()));

revoke all on private_taggi.owner_email_allowlist, private_taggi.system_owners,
  private_taggi.owner_credentials, private_taggi.owner_sessions from public, anon, authenticated;
revoke all on public.taggi_plans, public.taggi_subscriptions, public.taggi_payments,
  public.taggi_licenses, public.taggi_license_redemptions, public.taggi_owner_audit_logs,
  public.taggi_system_settings from public, anon, authenticated;
grant select on public.taggi_plans, public.taggi_subscriptions, public.taggi_license_redemptions to authenticated;

create or replace function private_taggi.is_active_member(target_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.taggi_group_members m
    join public.taggi_groups g on g.id = m.group_id
    join public.taggi_profiles p on p.user_id = m.user_id
    where m.group_id = target_group_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and g.status = 'active'
      and g.blocked_at is null
      and p.blocked_at is null
  );
$$;

create or replace function private_taggi.write_owner_audit(
  p_action text,
  p_target_type text,
  p_target_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.taggi_owner_audit_logs
    (owner_user_id, action, target_type, target_id, metadata)
  values
    ((select auth.uid()), p_action, p_target_type, p_target_id, coalesce(p_metadata, '{}'::jsonb));
$$;

create or replace function public.taggi_owner_access_status()
returns table (is_owner boolean, password_configured boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select private_taggi.is_system_owner()),
    exists (
      select 1 from private_taggi.owner_credentials c
      where c.user_id = (select auth.uid())
    );
$$;

create or replace function public.taggi_owner_setup_password(p_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private_taggi.is_system_owner()) then
    raise exception using errcode = '42501', message = 'Acesso Owner não autorizado.';
  end if;
  if char_length(p_password) < 10 then
    raise exception using errcode = '22023', message = 'Use uma senha Owner com pelo menos 10 caracteres.';
  end if;
  if exists (select 1 from private_taggi.owner_credentials where user_id = (select auth.uid())) then
    raise exception using errcode = '42501', message = 'A senha Owner já foi configurada.';
  end if;
  insert into private_taggi.owner_credentials (user_id, password_hash)
  values ((select auth.uid()), extensions.crypt(p_password, extensions.gen_salt('bf', 12)));
  perform private_taggi.write_owner_audit('owner_password_configured', 'system_owner', (select auth.uid())::text);
end;
$$;

create or replace function public.taggi_owner_unlock(p_password text)
returns table (session_id uuid, session_token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_hash text;
  raw_token text;
  new_session_id uuid := extensions.gen_random_uuid();
  new_expires_at timestamptz := now() + interval '30 minutes';
begin
  if not (select private_taggi.is_system_owner()) then
    raise exception using errcode = '42501', message = 'Acesso Owner não autorizado.';
  end if;
  select c.password_hash into stored_hash
  from private_taggi.owner_credentials c
  where c.user_id = (select auth.uid());
  if stored_hash is null or extensions.crypt(p_password, stored_hash) <> stored_hash then
    raise exception using errcode = '28P01', message = 'Senha Owner incorreta.';
  end if;
  raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  update private_taggi.owner_sessions
  set revoked_at = now()
  where user_id = (select auth.uid()) and revoked_at is null;
  insert into private_taggi.owner_sessions (id, user_id, token_hash, expires_at)
  values (new_session_id, (select auth.uid()), extensions.digest(raw_token, 'sha256'), new_expires_at);
  update private_taggi.system_owners set last_access_at = now() where user_id = (select auth.uid());
  perform private_taggi.write_owner_audit('owner_session_opened', 'system_owner', (select auth.uid())::text);
  return query select new_session_id, raw_token, new_expires_at;
end;
$$;

create or replace function public.taggi_owner_lock(p_session_id uuid, p_session_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private_taggi.owner_session_valid(p_session_id, p_session_token)) then
    raise exception using errcode = '42501', message = 'Sessão Owner inválida.';
  end if;
  update private_taggi.owner_sessions set revoked_at = now()
  where id = p_session_id and user_id = (select auth.uid());
end;
$$;

create or replace function public.taggi_owner_dashboard(p_session_id uuid, p_session_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if not (select private_taggi.owner_session_valid(p_session_id, p_session_token)) then
    raise exception using errcode = '42501', message = 'Sessão Owner inválida.';
  end if;
  select jsonb_build_object(
    'users', (select count(*) from public.taggi_profiles),
    'companies', (select count(*) from public.taggi_groups),
    'activeSubscriptions', (select count(*) from public.taggi_subscriptions where status = 'active'),
    'cancelledSubscriptions', (select count(*) from public.taggi_subscriptions where status = 'cancelled'),
    'trials', (select count(*) from public.taggi_subscriptions where status = 'trial' and (current_period_end is null or current_period_end > now())),
    'lifetime', (select count(*) from public.taggi_subscriptions where status = 'lifetime'),
    'newUsers', (select count(*) from public.taggi_profiles where created_at >= now() - interval '30 days'),
    'newCompanies', (select count(*) from public.taggi_groups where created_at >= now() - interval '30 days'),
    'mrrCents', coalesce((select sum(price_cents) from public.taggi_subscriptions where status = 'active' and next_billing_at is not null), 0),
    'pendingFeedbacks', (select count(*) from public.taggi_feedback where status in ('new','reviewing','planned')),
    'systemStatus', case when coalesce((select (value #>> '{}')::boolean from public.taggi_system_settings where key = 'maintenance_enabled'), false) then 'maintenance' else 'operational' end,
    'growth', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d.day_value, 'users', coalesce(u.total, 0), 'companies', coalesce(g.total, 0)) order by d.day_value), '[]'::jsonb)
      from (select generate_series(current_date - 29, current_date, interval '1 day')::date as day_value) d
      left join (select created_at::date as day_value, count(*) as total from public.taggi_profiles where created_at >= current_date - 29 group by created_at::date) u on u.day_value = d.day_value
      left join (select created_at::date as day_value, count(*) as total from public.taggi_groups where created_at >= current_date - 29 group by created_at::date) g on g.day_value = d.day_value
    )
  ) into result;
  return result;
end;
$$;

create or replace function public.taggi_owner_list(
  p_resource text,
  p_search text,
  p_status text,
  p_offset integer,
  p_limit integer,
  p_session_id uuid,
  p_session_token text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q text := '%' || lower(trim(coalesce(p_search, ''))) || '%';
  safe_offset integer := greatest(coalesce(p_offset, 0), 0);
  safe_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  result jsonb;
begin
  if not (select private_taggi.owner_session_valid(p_session_id, p_session_token)) then
    raise exception using errcode = '42501', message = 'Sessão Owner inválida.';
  end if;

  if p_resource = 'companies' then
    with rows as (
      select g.id, g.name, g.code, g.status, g.created_at, g.updated_at,
        p.display_name owner_name, p.email owner_email,
        (select count(*) from public.taggi_group_members m where m.group_id = g.id and m.status = 'active') members,
        s.status subscription_status, pl.name plan_name, s.current_period_end
      from public.taggi_groups g
      left join public.taggi_profiles p on p.user_id = g.created_by
      left join lateral (select * from public.taggi_subscriptions x where x.group_id = g.id order by x.created_at desc limit 1) s on true
      left join public.taggi_plans pl on pl.id = s.plan_id
      where (q = '%%' or lower(g.name) like q or lower(g.code) like q or lower(coalesce(p.email,'')) like q)
        and (coalesce(p_status,'') = '' or g.status = p_status or s.status = p_status)
    ), page as (select * from rows order by created_at desc offset safe_offset limit safe_limit)
    select jsonb_build_object('total',(select count(*) from rows),'items',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb)) into result;
  elsif p_resource = 'users' then
    with rows as (
      select p.user_id id, p.display_name, p.email, p.created_at, p.last_seen_at,
        case when p.blocked_at is null then 'active' else 'blocked' end status,
        m.role, g.id group_id, g.name company_name, g.code group_code,
        s.status subscription_status, pl.name plan_name
      from public.taggi_profiles p
      left join lateral (select * from public.taggi_group_members x where x.user_id = p.user_id and x.status = 'active' order by x.joined_at desc limit 1) m on true
      left join public.taggi_groups g on g.id = m.group_id
      left join lateral (select * from public.taggi_subscriptions x where x.group_id = g.id order by x.created_at desc limit 1) s on true
      left join public.taggi_plans pl on pl.id = s.plan_id
      where (q = '%%' or lower(p.display_name) like q or lower(p.email) like q or lower(coalesce(g.name,'')) like q or lower(coalesce(g.code,'')) like q or p.user_id::text like q)
        and (coalesce(p_status,'') = '' or (p_status = 'active' and p.blocked_at is null) or (p_status = 'blocked' and p.blocked_at is not null))
    ), page as (select * from rows order by created_at desc offset safe_offset limit safe_limit)
    select jsonb_build_object('total',(select count(*) from rows),'items',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb)) into result;
  elsif p_resource = 'plans' then
    with rows as (select * from public.taggi_plans where (q='%%' or lower(name) like q) and (coalesce(p_status,'')='' or status=p_status)),
    page as (select * from rows order by created_at desc offset safe_offset limit safe_limit)
    select jsonb_build_object('total',(select count(*) from rows),'items',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb)) into result;
  elsif p_resource = 'subscriptions' then
    with rows as (
      select s.*, g.name company_name, g.code group_code, p.name plan_name
      from public.taggi_subscriptions s join public.taggi_groups g on g.id=s.group_id join public.taggi_plans p on p.id=s.plan_id
      where (q='%%' or lower(g.name) like q or lower(g.code) like q or lower(p.name) like q) and (coalesce(p_status,'')='' or s.status=p_status)
    ), page as (select * from rows order by created_at desc offset safe_offset limit safe_limit)
    select jsonb_build_object('total',(select count(*) from rows),'items',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb)) into result;
  elsif p_resource = 'licenses' then
    with rows as (
      select l.id,l.code_hint,l.license_type,l.target_scope,l.max_uses,l.uses_count,l.duration_days,l.expires_at,l.status,l.note,l.created_at,l.revoked_at,p.name plan_name
      from public.taggi_licenses l join public.taggi_plans p on p.id=l.plan_id
      where (q='%%' or lower(l.code_hint) like q or lower(coalesce(l.note,'')) like q or lower(p.name) like q) and (coalesce(p_status,'')='' or l.status=p_status)
    ), page as (select * from rows order by created_at desc offset safe_offset limit safe_limit)
    select jsonb_build_object('total',(select count(*) from rows),'items',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb)) into result;
  elsif p_resource = 'feedbacks' then
    with rows as (
      select f.id,f.category,f.body,f.status,f.display_name,f.app_version,f.created_at,f.updated_at,g.name company_name,p.email
      from public.taggi_feedback f join public.taggi_groups g on g.id=f.group_id left join public.taggi_profiles p on p.user_id=f.user_id
      where (q='%%' or lower(f.body) like q or lower(f.display_name) like q or lower(g.name) like q or lower(coalesce(p.email,'')) like q) and (coalesce(p_status,'')='' or f.status=p_status)
    ), page as (select * from rows order by created_at desc offset safe_offset limit safe_limit)
    select jsonb_build_object('total',(select count(*) from rows),'items',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb)) into result;
  elsif p_resource = 'logs' then
    with rows as (
      select l.*,p.display_name owner_name,p.email owner_email from public.taggi_owner_audit_logs l left join public.taggi_profiles p on p.user_id=l.owner_user_id
      where q='%%' or lower(l.action) like q or lower(l.target_type) like q or lower(coalesce(l.target_id,'')) like q
    ), page as (select * from rows order by created_at desc offset safe_offset limit safe_limit)
    select jsonb_build_object('total',(select count(*) from rows),'items',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb)) into result;
  elsif p_resource = 'versions' then
    with rows as (select * from public.taggi_app_releases where q='%%' or lower(version) like q or lower(channel) like q or lower(status) like q),
    page as (select * from rows order by created_at desc offset safe_offset limit safe_limit)
    select jsonb_build_object('total',(select count(*) from rows),'items',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb)) into result;
  elsif p_resource = 'settings' then
    select jsonb_build_object('total',count(*),'items',coalesce(jsonb_agg(to_jsonb(s) order by key),'[]'::jsonb)) into result from public.taggi_system_settings s;
  elsif p_resource = 'payments' then
    with rows as (select p.*,g.name company_name,g.code group_code from public.taggi_payments p join public.taggi_groups g on g.id=p.group_id where (q='%%' or lower(g.name) like q or lower(g.code) like q or lower(coalesce(p.provider_reference,'')) like q) and (coalesce(p_status,'')='' or p.status=p_status)),
    page as (select * from rows order by created_at desc offset safe_offset limit safe_limit)
    select jsonb_build_object('total',(select count(*) from rows),'items',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb)) into result;
  else
    raise exception using errcode = '22023', message = 'Recurso Owner inválido.';
  end if;
  return result;
end;
$$;

create or replace function public.taggi_owner_action(
  p_action text,
  p_target_id uuid,
  p_payload jsonb,
  p_session_id uuid,
  p_session_token text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare target_type text;
begin
  if not (select private_taggi.owner_session_valid(p_session_id, p_session_token)) then
    raise exception using errcode = '42501', message = 'Sessão Owner inválida.';
  end if;
  if p_action = 'block_user' then
    update public.taggi_profiles set blocked_at=now(),blocked_reason=left(coalesce(p_payload->>'reason','Bloqueado pelo Owner'),500) where user_id=p_target_id;
    target_type := 'user';
  elsif p_action = 'unblock_user' then
    update public.taggi_profiles set blocked_at=null,blocked_reason=null where user_id=p_target_id;
    target_type := 'user';
  elsif p_action = 'block_company' then
    update public.taggi_groups set status='blocked',blocked_at=now(),blocked_reason=left(coalesce(p_payload->>'reason','Bloqueada pelo Owner'),500) where id=p_target_id;
    target_type := 'company';
  elsif p_action = 'unblock_company' then
    update public.taggi_groups set status='active',blocked_at=null,blocked_reason=null where id=p_target_id;
    target_type := 'company';
  elsif p_action = 'feedback_status' then
    if coalesce(p_payload->>'status','') not in ('new','reviewing','planned','resolved','discarded') then raise exception using errcode='22023',message='Status inválido.'; end if;
    update public.taggi_feedback set status=p_payload->>'status',handled_by=(select auth.uid()),handled_at=now(),updated_at=now() where id=p_target_id;
    target_type := 'feedback';
  elsif p_action = 'plan_status' then
    if coalesce(p_payload->>'status','') not in ('active','inactive') then raise exception using errcode='22023',message='Status inválido.'; end if;
    update public.taggi_plans set status=p_payload->>'status',updated_at=now() where id=p_target_id;
    target_type := 'plan';
  elsif p_action = 'subscription_status' then
    if coalesce(p_payload->>'status','') not in ('trial','active','past_due','expired','cancelled','lifetime') then raise exception using errcode='22023',message='Status inválido.'; end if;
    update public.taggi_subscriptions set status=p_payload->>'status',cancelled_at=case when p_payload->>'status'='cancelled' then now() else cancelled_at end,updated_at=now() where id=p_target_id;
    target_type := 'subscription';
  elsif p_action = 'setting_update' then
    update public.taggi_system_settings set value=coalesce(p_payload->'value','null'::jsonb),updated_by=(select auth.uid()),updated_at=now() where key=p_payload->>'key';
    target_type := 'system_setting';
  else
    raise exception using errcode = '22023', message = 'Ação Owner inválida.';
  end if;
  if not found then raise exception using errcode='P0002',message='Registro não encontrado.'; end if;
  perform private_taggi.write_owner_audit(p_action,target_type,p_target_id::text,coalesce(p_payload,'{}'::jsonb));
end;
$$;

create or replace function public.taggi_owner_save_plan(
  p_plan_id uuid,
  p_name text,
  p_price_cents integer,
  p_period text,
  p_features jsonb,
  p_user_limit integer,
  p_status text,
  p_session_id uuid,
  p_session_token text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare result_id uuid := coalesce(p_plan_id, extensions.gen_random_uuid());
begin
  if not (select private_taggi.owner_session_valid(p_session_id,p_session_token)) then raise exception using errcode='42501',message='Sessão Owner inválida.'; end if;
  if char_length(trim(p_name))<2 or p_price_cents<0 or p_period not in ('monthly','quarterly','semiannual','annual','lifetime','promotional','trial') or p_status not in ('active','inactive') then raise exception using errcode='22023',message='Dados do plano inválidos.'; end if;
  insert into public.taggi_plans (id,name,price_cents,period,features,user_limit,status)
  values (result_id,trim(p_name),p_price_cents,p_period,coalesce(p_features,'[]'::jsonb),p_user_limit,p_status)
  on conflict (id) do update set name=excluded.name,price_cents=excluded.price_cents,period=excluded.period,features=excluded.features,user_limit=excluded.user_limit,status=excluded.status,updated_at=now();
  perform private_taggi.write_owner_audit(case when p_plan_id is null then 'plan_created' else 'plan_updated' end,'plan',result_id::text);
  return result_id;
end;
$$;

create or replace function public.taggi_owner_generate_license(
  p_license_type text,
  p_plan_id uuid,
  p_target_scope text,
  p_max_uses integer,
  p_duration_days integer,
  p_expires_at timestamptz,
  p_note text,
  p_beneficiary_user_id uuid,
  p_beneficiary_group_id uuid,
  p_session_id uuid,
  p_session_token text
)
returns table (license_id uuid, license_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  raw_code text;
  new_id uuid := extensions.gen_random_uuid();
  prefix text;
begin
  if not (select private_taggi.owner_session_valid(p_session_id,p_session_token)) then raise exception using errcode='42501',message='Sessão Owner inválida.'; end if;
  if p_license_type not in ('monthly','quarterly','annual','lifetime','promotional','partnership','trial') or p_target_scope not in ('account','company') or p_max_uses < 1 then raise exception using errcode='22023',message='Configuração de licença inválida.'; end if;
  if not exists(select 1 from public.taggi_plans where id=p_plan_id) then raise exception using errcode='P0002',message='Plano não encontrado.'; end if;
  prefix := case when p_license_type='lifetime' then 'LIFE' else 'KEY' end;
  raw_code := 'TAGGI-'||prefix||'-'||upper(substr(encode(extensions.gen_random_bytes(6),'hex'),1,4))||'-'||upper(substr(encode(extensions.gen_random_bytes(6),'hex'),1,4));
  insert into public.taggi_licenses (id,code_hash,code_hint,license_type,plan_id,target_scope,beneficiary_user_id,beneficiary_group_id,max_uses,duration_days,expires_at,note,created_by)
  values (new_id,extensions.digest(upper(raw_code),'sha256'),left(raw_code,10)||'••••-'||right(raw_code,4),p_license_type,p_plan_id,p_target_scope,p_beneficiary_user_id,p_beneficiary_group_id,p_max_uses,p_duration_days,p_expires_at,left(trim(coalesce(p_note,'')),1000),(select auth.uid()));
  perform private_taggi.write_owner_audit('license_created','license',new_id::text,jsonb_build_object('type',p_license_type,'scope',p_target_scope,'maxUses',p_max_uses));
  return query select new_id,raw_code;
end;
$$;

create or replace function public.taggi_owner_revoke_license(p_license_id uuid,p_session_id uuid,p_session_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private_taggi.owner_session_valid(p_session_id,p_session_token)) then raise exception using errcode='42501',message='Sessão Owner inválida.'; end if;
  update public.taggi_licenses set status='revoked',revoked_at=now() where id=p_license_id and status<>'revoked';
  if not found then raise exception using errcode='P0002',message='Licença não encontrada ou já revogada.'; end if;
  perform private_taggi.write_owner_audit('license_revoked','license',p_license_id::text);
end;
$$;

create or replace function public.taggi_redeem_license(p_group_id uuid,p_code text)
returns table (plan_name text, subscription_status text, valid_until timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  lic public.taggi_licenses%rowtype;
  target_plan public.taggi_plans%rowtype;
  next_status text;
  next_end timestamptz;
begin
  if not (select private_taggi.is_active_member(p_group_id)) then raise exception using errcode='42501',message='Você não pertence a esta empresa.'; end if;
  select * into lic from public.taggi_licenses where code_hash=extensions.digest(upper(trim(p_code)),'sha256') for update;
  if lic.id is null then raise exception using errcode='P0002',message='Código de licença inválido.'; end if;
  if lic.status in ('revoked','expired','redeemed') or (lic.expires_at is not null and lic.expires_at<=now()) or lic.uses_count>=lic.max_uses then raise exception using errcode='22023',message='Esta licença não está disponível.'; end if;
  if lic.beneficiary_user_id is not null and lic.beneficiary_user_id<>(select auth.uid()) then raise exception using errcode='42501',message='Esta licença pertence a outra conta.'; end if;
  if lic.beneficiary_group_id is not null and lic.beneficiary_group_id<>p_group_id then raise exception using errcode='42501',message='Esta licença pertence a outra empresa.'; end if;
  select * into target_plan from public.taggi_plans where id=lic.plan_id;
  next_status := case when lic.license_type='lifetime' or target_plan.period='lifetime' then 'lifetime' else 'active' end;
  next_end := case when next_status='lifetime' then null else now()+make_interval(days=>coalesce(lic.duration_days,case lic.license_type when 'monthly' then 30 when 'quarterly' then 90 when 'annual' then 365 else 30 end)) end;
  update public.taggi_subscriptions set status='cancelled',cancelled_at=now(),updated_at=now() where group_id=p_group_id and status in ('trial','active','past_due','lifetime');
  insert into public.taggi_subscriptions (group_id,plan_id,status,price_cents,started_at,current_period_end,next_billing_at,source)
  values (p_group_id,lic.plan_id,next_status,0,now(),next_end,null,'license');
  insert into public.taggi_license_redemptions (license_id,user_id,group_id) values (lic.id,(select auth.uid()),p_group_id);
  update public.taggi_licenses set uses_count=uses_count+1,status=case when uses_count+1>=max_uses then 'redeemed' else 'partially_used' end where id=lic.id;
  return query select target_plan.name,next_status,next_end;
end;
$$;

create or replace function public.taggi_entitlement(p_group_id uuid)
returns table (allowed boolean, subscription_status text, plan_name text, valid_until timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select private_taggi.is_active_member(p_group_id)) and s.status in ('trial','active','lifetime') and (s.current_period_end is null or s.current_period_end>now()),
    coalesce(s.status,'expired'),
    coalesce(p.name,'Sem plano'),
    s.current_period_end
  from (select 1) seed
  left join lateral (select * from public.taggi_subscriptions x where x.group_id=p_group_id order by x.created_at desc limit 1) s on true
  left join public.taggi_plans p on p.id=s.plan_id;
$$;

-- Empresas novas começam vazias e recebem apenas um período de teste.
create or replace function public.taggi_create_group(
  p_group_name text,
  p_display_name text,
  p_request_id uuid
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
  new_group public.taggi_groups%rowtype;
  clean_name text := trim(p_group_name);
  clean_display_name text := trim(p_display_name);
  caller_email text;
  trial_plan_id uuid;
  trial_days integer;
begin
  if caller_id is null then raise exception using errcode='42501',message='Faça login para criar uma empresa.'; end if;
  if char_length(clean_name) not between 2 and 100 then raise exception using errcode='22023',message='Informe um nome de empresa válido.'; end if;
  if char_length(clean_display_name) not between 2 and 80 then raise exception using errcode='22023',message='Informe o seu nome.'; end if;
  if coalesce((select (value #>> '{}')::boolean from public.taggi_system_settings where key='registrations_enabled'),true)=false then raise exception using errcode='42501',message='Novos cadastros estão temporariamente pausados.'; end if;
  select * into new_group from public.taggi_groups g where g.created_by=caller_id and g.creation_request_id=p_request_id;
  if new_group.id is null then
    insert into public.taggi_groups (name,code,created_by,creation_request_id) values (clean_name,private_taggi.generate_group_code(),caller_id,p_request_id) returning * into new_group;
    insert into public.taggi_group_members (group_id,user_id,display_name,role) values (new_group.id,caller_id,clean_display_name,'manager');
    insert into public.taggi_group_settings (group_id) values (new_group.id);
    insert into public.taggi_member_preferences (group_id,user_id) values (new_group.id,caller_id);
    select id into trial_plan_id from public.taggi_plans where period='trial' and status='active' order by created_at limit 1;
    trial_days := coalesce((select (value #>> '{}')::integer from public.taggi_system_settings where key='trial_days'),14);
    insert into public.taggi_subscriptions (group_id,plan_id,status,price_cents,current_period_end,source) values (new_group.id,trial_plan_id,'trial',0,now()+make_interval(days=>trial_days),'signup');
    insert into public.taggi_activity_log (group_id,user_id,display_name,activity_type,summary) values
      (new_group.id,caller_id,clean_display_name,'group_created',clean_display_name||' criou a empresa.'),
      (new_group.id,caller_id,clean_display_name,'member_joined',clean_display_name||' entrou na equipe.');
  end if;
  select u.email into caller_email from auth.users u where u.id=caller_id;
  insert into public.taggi_profiles (user_id,display_name,email) values (caller_id,clean_display_name,coalesce(caller_email,''))
  on conflict (user_id) do update set display_name=excluded.display_name,email=excluded.email,updated_at=now();
  return query select new_group.id,new_group.code,new_group.name,m.display_name,m.role,pref.tutorial_completed_at,new_group.admin_password_configured_at is not null
  from public.taggi_group_members m join public.taggi_member_preferences pref on pref.group_id=m.group_id and pref.user_id=m.user_id
  where m.group_id=new_group.id and m.user_id=caller_id;
end;
$$;

create or replace function public.taggi_touch_presence(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private_taggi.is_active_member(p_group_id)) then raise exception using errcode='42501',message='Você não pertence a esta empresa.'; end if;
  update public.taggi_group_members set last_seen_at=now() where group_id=p_group_id and user_id=(select auth.uid()) and status='active';
  update public.taggi_profiles set last_seen_at=now() where user_id=(select auth.uid());
end;
$$;

-- Feedbacks pertencem ao Owner, não à Administração da empresa.
drop trigger if exists taggi_feedback_updated_at on public.taggi_feedback;
create trigger taggi_feedback_updated_at before update on public.taggi_feedback
for each row execute function private_taggi.set_updated_at();
revoke execute on function public.taggi_admin_list_feedbacks(uuid,uuid,text) from authenticated;
revoke execute on function public.taggi_admin_set_feedback_status(uuid,uuid,text,uuid,text) from authenticated;

revoke execute on function public.taggi_owner_access_status() from public, anon;
revoke execute on function public.taggi_owner_setup_password(text) from public, anon;
revoke execute on function public.taggi_owner_unlock(text) from public, anon;
revoke execute on function public.taggi_owner_lock(uuid,text) from public, anon;
revoke execute on function public.taggi_owner_dashboard(uuid,text) from public, anon;
revoke execute on function public.taggi_owner_list(text,text,text,integer,integer,uuid,text) from public, anon;
revoke execute on function public.taggi_owner_action(text,uuid,jsonb,uuid,text) from public, anon;
revoke execute on function public.taggi_owner_save_plan(uuid,text,integer,text,jsonb,integer,text,uuid,text) from public, anon;
revoke execute on function public.taggi_owner_generate_license(text,uuid,text,integer,integer,timestamptz,text,uuid,uuid,uuid,text) from public, anon;
revoke execute on function public.taggi_owner_revoke_license(uuid,uuid,text) from public, anon;
revoke execute on function public.taggi_redeem_license(uuid,text) from public, anon;
revoke execute on function public.taggi_entitlement(uuid) from public, anon;

grant execute on function public.taggi_owner_access_status() to authenticated;
grant execute on function public.taggi_owner_setup_password(text) to authenticated;
grant execute on function public.taggi_owner_unlock(text) to authenticated;
grant execute on function public.taggi_owner_lock(uuid,text) to authenticated;
grant execute on function public.taggi_owner_dashboard(uuid,text) to authenticated;
grant execute on function public.taggi_owner_list(text,text,text,integer,integer,uuid,text) to authenticated;
grant execute on function public.taggi_owner_action(text,uuid,jsonb,uuid,text) to authenticated;
grant execute on function public.taggi_owner_save_plan(uuid,text,integer,text,jsonb,integer,text,uuid,text) to authenticated;
grant execute on function public.taggi_owner_generate_license(text,uuid,text,integer,integer,timestamptz,text,uuid,uuid,uuid,text) to authenticated;
grant execute on function public.taggi_owner_revoke_license(uuid,uuid,text) to authenticated;
grant execute on function public.taggi_redeem_license(uuid,text) to authenticated;
grant execute on function public.taggi_entitlement(uuid) to authenticated;

alter table private_taggi.admin_credentials enable row level security;
alter table private_taggi.admin_credentials force row level security;
alter table private_taggi.admin_sessions enable row level security;
alter table private_taggi.admin_sessions force row level security;
alter table private_taggi.owner_email_allowlist enable row level security;
alter table private_taggi.owner_email_allowlist force row level security;
alter table private_taggi.system_owners enable row level security;
alter table private_taggi.system_owners force row level security;
alter table private_taggi.owner_credentials enable row level security;
alter table private_taggi.owner_credentials force row level security;
alter table private_taggi.owner_sessions enable row level security;
alter table private_taggi.owner_sessions force row level security;

-- Taggi desktop release control.
-- This migration is additive and backwards compatible with Taggi 1.0.0.

create table public.taggi_app_releases (
  version text primary key,
  build_number bigint not null check (build_number > 0),
  channel text not null check (channel in ('beta', 'stable')),
  status text not null check (
    status in ('DRAFT', 'BETA', 'STABLE', 'DEPRECATED', 'BLOCKED')
  ),
  rollout_percentage smallint not null default 100
    check (rollout_percentage between 0 and 100),
  minimum_supported_version text,
  release_notes text not null default '',
  source_commit text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint taggi_app_releases_version_format check (
    version ~ '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'
  ),
  constraint taggi_app_releases_minimum_version_format check (
    minimum_supported_version is null
    or minimum_supported_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'
  )
);

create table public.taggi_release_policy (
  id boolean primary key default true check (id),
  latest_version text not null,
  stable_version text not null,
  beta_version text,
  minimum_supported_version text not null,
  blocked_versions text[] not null default '{}',
  default_rollout_percentage smallint not null default 100
    check (default_rollout_percentage between 0 and 100),
  updated_at timestamptz not null default now(),
  constraint taggi_release_policy_latest_format check (
    latest_version ~ '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'
  ),
  constraint taggi_release_policy_stable_format check (
    stable_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'
  ),
  constraint taggi_release_policy_beta_format check (
    beta_version is null
    or beta_version ~ '^[0-9]+\.[0-9]+\.[0-9]+-beta\.[0-9]+$'
  ),
  constraint taggi_release_policy_minimum_format check (
    minimum_supported_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'
  )
);

create table public.taggi_release_devices (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  installation_id_hash text not null,
  channel text not null default 'stable' check (channel in ('beta', 'stable')),
  enabled boolean not null default true,
  app_version text not null,
  build_number bigint not null check (build_number > 0),
  last_health_status text not null default 'unknown'
    check (last_health_status in ('unknown', 'running', 'healthy', 'error')),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint taggi_release_devices_installation_hash_format check (
    installation_id_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint taggi_release_devices_app_version_format check (
    app_version ~ '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'
  ),
  constraint taggi_release_devices_user_installation_key unique (
    user_id,
    installation_id_hash
  )
);

create index taggi_app_releases_channel_status_published_idx
  on public.taggi_app_releases (channel, status, published_at desc);
create index taggi_release_devices_user_id_idx
  on public.taggi_release_devices (user_id);
create index taggi_release_devices_channel_enabled_seen_idx
  on public.taggi_release_devices (channel, enabled, last_seen_at desc);

create trigger taggi_app_releases_updated_at
before update on public.taggi_app_releases
for each row execute function private_taggi.set_updated_at();

create trigger taggi_release_policy_updated_at
before update on public.taggi_release_policy
for each row execute function private_taggi.set_updated_at();

create trigger taggi_release_devices_updated_at
before update on public.taggi_release_devices
for each row execute function private_taggi.set_updated_at();

insert into public.taggi_release_policy (
  id,
  latest_version,
  stable_version,
  minimum_supported_version
)
values (true, '1.0.0', '1.0.0', '1.0.0');

insert into public.taggi_app_releases (
  version,
  build_number,
  channel,
  status,
  minimum_supported_version,
  release_notes
)
values (
  '1.0.0',
  1,
  'stable',
  'DRAFT',
  '1.0.0',
  'Versão inicial existente antes da ativação do updater.'
);

alter table public.taggi_app_releases enable row level security;
alter table public.taggi_release_policy enable row level security;
alter table public.taggi_release_devices enable row level security;

create policy taggi_app_releases_authenticated_read
on public.taggi_app_releases
for select
to authenticated
using (true);

create policy taggi_release_policy_authenticated_read
on public.taggi_release_policy
for select
to authenticated
using (true);

create policy taggi_release_devices_own_read
on public.taggi_release_devices
for select
to authenticated
using ((select auth.uid()) = user_id);

create or replace function private_taggi.touch_release_device(
  p_installation_hash text,
  p_app_version text,
  p_build_number bigint,
  p_health_status text
)
returns table(channel text, enabled boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_installation_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid installation identifier' using errcode = '22023';
  end if;
  if p_app_version !~ '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$' then
    raise exception 'invalid application version' using errcode = '22023';
  end if;
  if p_build_number is null or p_build_number < 1 then
    raise exception 'invalid build number' using errcode = '22023';
  end if;
  if p_health_status not in ('unknown', 'running', 'healthy', 'error') then
    raise exception 'invalid health status' using errcode = '22023';
  end if;

  insert into public.taggi_release_devices (
    user_id,
    installation_id_hash,
    app_version,
    build_number,
    last_health_status,
    last_seen_at
  )
  values (
    v_user_id,
    p_installation_hash,
    p_app_version,
    p_build_number,
    p_health_status,
    now()
  )
  on conflict on constraint taggi_release_devices_user_installation_key
  do update set
    app_version = excluded.app_version,
    build_number = excluded.build_number,
    last_health_status = excluded.last_health_status,
    last_seen_at = excluded.last_seen_at;

  return query
  select device.channel, device.enabled
  from public.taggi_release_devices as device
  where device.user_id = v_user_id
    and device.installation_id_hash = p_installation_hash;
end;
$$;

create or replace function public.taggi_touch_release_device(
  p_installation_hash text,
  p_app_version text,
  p_build_number bigint,
  p_health_status text default 'running'
)
returns table(channel text, enabled boolean)
language sql
security invoker
set search_path = ''
as $$
  select *
  from private_taggi.touch_release_device(
    p_installation_hash,
    p_app_version,
    p_build_number,
    p_health_status
  );
$$;

revoke all on table public.taggi_app_releases from public, anon, authenticated;
revoke all on table public.taggi_release_policy from public, anon, authenticated;
revoke all on table public.taggi_release_devices from public, anon, authenticated;

grant select on table public.taggi_app_releases to authenticated;
grant select on table public.taggi_release_policy to authenticated;
grant select on table public.taggi_release_devices to authenticated;

grant select, insert, update on table public.taggi_app_releases to service_role;
grant select, update on table public.taggi_release_policy to service_role;
grant select, update on table public.taggi_release_devices to service_role;

revoke execute on function private_taggi.touch_release_device(
  text,
  text,
  bigint,
  text
) from public, anon, authenticated;
revoke execute on function public.taggi_touch_release_device(
  text,
  text,
  bigint,
  text
) from public, anon;

grant usage on schema private_taggi to authenticated;
grant execute on function private_taggi.touch_release_device(
  text,
  text,
  bigint,
  text
) to authenticated;
grant execute on function public.taggi_touch_release_device(
  text,
  text,
  bigint,
  text
) to authenticated;

comment on table public.taggi_release_devices is
  'Minimal technical telemetry: hashed installation id, app version, channel and last activity. No company content is stored.';
comment on table public.taggi_release_policy is
  'Singleton policy used for minimum supported version and emergency release blocking.';

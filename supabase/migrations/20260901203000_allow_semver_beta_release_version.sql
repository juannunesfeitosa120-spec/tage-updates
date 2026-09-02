-- The desktop beta channel currently uses regular semantic versions such as 1.1.2.
-- Keep release policy validation aligned with the versions produced by the app.

alter table public.taggi_release_policy
  drop constraint if exists taggi_release_policy_beta_format;

alter table public.taggi_release_policy
  add constraint taggi_release_policy_beta_format check (
    beta_version is null
    or beta_version ~ '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'
  );

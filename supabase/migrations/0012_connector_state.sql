-- Connector identity, navigation, activation, and health are authoritative server
-- state. Authenticated users retain shared read/delete access but may no longer
-- create or mutate company rows directly.
alter table public.companies
  add column careers_url text,
  add column source_key text,
  add column site_token text,
  add column activation_state text,
  add column activation_successes integer not null default 0,
  add column last_verified_at timestamptz,
  add column last_error_code text,
  add column last_observation_count integer;

update public.companies
set
  careers_url = case ats_type
    when 'greenhouse' then 'https://job-boards.greenhouse.io/' || board_token
    when 'lever' then 'https://' || case when region = 'eu' then 'jobs.eu.lever.co/' else 'jobs.lever.co/' end || board_token
    when 'ashby' then 'https://jobs.ashbyhq.com/' || board_token
  end,
  source_key = ats_type || ':' || coalesce(region, 'global') || ':' || board_token,
  activation_state = 'active',
  last_verified_at = coalesce(last_success_at, created_at),
  last_observation_count = null;

alter table public.companies
  alter column careers_url set not null,
  alter column source_key set not null,
  alter column activation_state set not null,
  alter column activation_state set default 'experimental',
  add constraint companies_careers_url_https_check check (
    length(careers_url) between 9 and 2048
    and careers_url ~ '^https://[^/[:space:]@]+(?:/[^[:space:]]*)?$'
  ),
  add constraint companies_source_key_length_check check (length(source_key) between 5 and 512),
  add constraint companies_activation_state_check check (
    activation_state in ('experimental', 'active', 'disabled')
  ),
  add constraint companies_activation_successes_check check (
    activation_successes between 0 and 3
  ),
  add constraint companies_last_error_code_check check (
    last_error_code is null or length(last_error_code) between 1 and 64
  ),
  add constraint companies_last_observation_count_check check (
    last_observation_count is null or last_observation_count >= 0
  ),
  add constraint companies_source_key_key unique (source_key);

drop policy if exists "companies_insert_shared" on public.companies;
drop policy if exists "companies_update_shared" on public.companies;
revoke insert, update on table public.companies from authenticated;
grant select, delete on table public.companies to authenticated;

create index companies_active_last_polled_at_idx
  on public.companies using btree (last_polled_at)
  where activation_state = 'active';

create or replace function public.claim_due_companies(batch_size integer default 10)
returns setof public.companies
language sql
security invoker
set search_path = ''
as $$
  with due as (
    select id
    from public.companies
    where activation_state = 'active'
      and (
        last_polled_at is null
        or last_polled_at < now() - interval '9 minutes'
      )
    order by last_polled_at asc nulls first
    limit batch_size
    for update skip locked
  )
  update public.companies c
  set last_polled_at = now()
  from due
  where c.id = due.id
  returning c.*;
$$;

revoke execute on function public.claim_due_companies(integer) from public, anon, authenticated;
grant execute on function public.claim_due_companies(integer) to service_role;

do $$
begin
  if exists (
    select 1 from public.companies
    where activation_state <> 'active'
      or careers_url is null
      or source_key is null
  ) then
    raise exception 'connector-state backfill failed';
  end if;
end;
$$;

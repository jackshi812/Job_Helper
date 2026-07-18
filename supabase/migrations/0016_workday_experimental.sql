begin;

-- Workday is executable only for the fixed Capital One wd12 identity. The
-- provider remains Experimental even after three accepted observation windows.
alter table public.companies
  drop constraint companies_region_check,
  add constraint companies_region_check check (
    region is null
    or (ats_type = 'lever' and region = 'eu')
    or (ats_type = 'workday' and region = 'wd12')
  ),
  drop constraint companies_ats_type_check,
  add constraint companies_ats_type_check check (
    ats_type in ('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'recruitee', 'workday')
  ),
  add constraint companies_workday_identity_check check (
    ats_type <> 'workday'
    or (
      board_token = 'capitalone'
      and region = 'wd12'
      and site_token = 'Capital_One'
      and source_key = 'workday:wd12:capitalone:Capital_One'
      and activation_state = 'experimental'
    )
  );

alter table public.jobs
  drop constraint jobs_source_check,
  add constraint jobs_source_check check (
    source in ('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'recruitee', 'adzuna', 'workday')
  );

-- Scheduled claims are explicitly closed to the five stable direct providers.
-- Workday cannot become claimable even if future application code drifts.
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
      and ats_type in ('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'recruitee')
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

-- Compare the final closed database sets transactionally. Adzuna is the sole
-- jobs-only aggregator exception and is intentionally absent from companies.
do $$
declare
  expected_company_sources text[] := array[
    'ashby', 'greenhouse', 'lever', 'recruitee', 'smartrecruiters', 'workday'
  ];
  expected_job_sources text[] := array[
    'adzuna', 'ashby', 'greenhouse', 'lever', 'recruitee', 'smartrecruiters', 'workday'
  ];
  actual_company_sources text[];
  actual_job_sources text[];
  company_definition text;
  job_definition text;
begin
  select pg_get_constraintdef(c.oid)
  into company_definition
  from pg_catalog.pg_constraint as c
  where c.conrelid = 'public.companies'::regclass
    and c.conname = 'companies_ats_type_check';

  select pg_get_constraintdef(c.oid)
  into job_definition
  from pg_catalog.pg_constraint as c
  where c.conrelid = 'public.jobs'::regclass
    and c.conname = 'jobs_source_check';

  select array_agg(value[1] order by value[1])
  into actual_company_sources
  from regexp_matches(company_definition, '''([^'']+)''', 'g') as matches(value);

  select array_agg(value[1] order by value[1])
  into actual_job_sources
  from regexp_matches(job_definition, '''([^'']+)''', 'g') as matches(value);

  if actual_company_sources is distinct from expected_company_sources then
    raise exception 'company connector constraint parity failed: %', actual_company_sources;
  end if;
  if actual_job_sources is distinct from expected_job_sources then
    raise exception 'job source constraint parity failed: %', actual_job_sources;
  end if;
  if expected_job_sources is distinct from (
    select array_agg(source order by source)
    from unnest(expected_company_sources || array['adzuna']) as valueset(source)
  ) then
    raise exception 'Adzuna jobs-only exception parity failed';
  end if;
  if not exists (
    select 1
    from public.source_coverage_catalog
    where company_name = 'Capital One'
      and provider = 'Workday'
      and disposition = 'experimental'
      and source_key = 'workday:wd12:capitalone:Capital_One'
  ) then
    raise exception 'Capital One catalog identity parity failed';
  end if;
end;
$$;

comment on constraint companies_workday_identity_check on public.companies is
  'Only Plan 07 real-user verify-board may create/reconcile the Capital One Workday row; it remains Experimental and unclaimable.';
comment on constraint jobs_source_check on public.jobs is
  'Workday is reserved for strict source parity. Phase 02.1 expects zero Workday job rows while Capital One is Experimental and unclaimable.';

commit;

begin;

-- Paylocity is executable only for the exact reviewed public-board identity.
-- The separate Job Feed V2 key remains server-owned application configuration
-- and is deliberately not persisted in public.companies.
alter table public.companies
  drop constraint companies_ats_type_check,
  add constraint companies_ats_type_check check (
    ats_type in ('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'recruitee', 'workday', 'paylocity')
  ),
  add constraint companies_paylocity_identity_check check (
    ats_type <> 'paylocity'
    or (
      board_token = 'd6628b21-949b-4400-a3d0-c9082bbf3eb1'
      and region is null
      and site_token is null
      and source_key = 'paylocity:global:d6628b21-949b-4400-a3d0-c9082bbf3eb1'
      and activation_state in ('experimental', 'active')
    )
  );

alter table public.jobs
  drop constraint jobs_source_check,
  add constraint jobs_source_check check (
    source in ('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'recruitee', 'adzuna', 'workday', 'paylocity')
  );

alter table public.connector_observations
  drop constraint connector_observations_provider_check,
  add constraint connector_observations_provider_check check (
    provider in ('smartrecruiters', 'recruitee', 'workday', 'paylocity')
  );

revoke all on table public.connector_observations from public, anon, authenticated;
grant select, insert, update, delete on table public.connector_observations to service_role;

-- Rebuild the latest activation RPC with Paylocity added only to the closed
-- provider and stable-promotion sets. Database time, row locking, replay and
-- same-window rejection, and the three-row cap remain unchanged.
create or replace function public.record_connector_observation(
  p_company_id uuid,
  p_observation_id uuid,
  p_completeness text,
  p_credible_for_closure boolean,
  p_job_count integer,
  p_expected_count integer,
  p_warning_count integer,
  p_evidence_digest text
)
returns table (
  accepted boolean,
  reason text,
  progress integer,
  window_start timestamptz,
  next_eligible_at timestamptz,
  result_activation_state text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
  v_window_interval interval;
  v_window_start timestamptz;
  v_next_eligible_at timestamptz;
  v_provider text;
  v_activation_state text;
  v_persisted_progress integer;
  v_progress integer;
begin
  if p_company_id is null
    or p_observation_id is null
    or p_completeness is null
    or p_completeness <> 'complete'
    or p_credible_for_closure is not true
    or p_job_count is null
    or p_expected_count is null
    or p_job_count < 0
    or p_expected_count < 0
    or p_job_count <> p_expected_count
    or p_warning_count is null
    or p_warning_count <> 0
    or p_evidence_digest is null
    or length(p_evidence_digest) not between 16 and 128
  then
    return query select false, 'ineligible_evidence'::text, null::integer,
      null::timestamptz, null::timestamptz, null::text;
    return;
  end if;

  v_now := clock_timestamp();
  set local lock_timeout = '500ms';

  begin
    select
      c.ats_type,
      c.activation_state,
      c.activation_successes
    into
      v_provider,
      v_activation_state,
      v_persisted_progress
    from public.companies as c
    where c.id = p_company_id
    for update;
  exception
    when lock_not_available or query_canceled then
      return query select false, 'retryable_lock_contention'::text, null::integer,
        null::timestamptz, null::timestamptz, null::text;
      return;
  end;

  if not found then
    return query select false, 'ineligible_company'::text, 0,
      null::timestamptz, null::timestamptz, null::text;
    return;
  end if;

  if v_provider not in ('smartrecruiters', 'recruitee', 'workday', 'paylocity')
    or v_activation_state not in ('experimental', 'active')
  then
    return query select false, 'ineligible_company'::text,
      least(greatest(v_persisted_progress, 0), 3), null::timestamptz,
      null::timestamptz, v_activation_state;
    return;
  end if;

  if v_provider = 'paylocity' and p_job_count <= 0 then
    return query select false, 'ineligible_evidence'::text,
      least(greatest(v_persisted_progress, 0), 3), null::timestamptz,
      null::timestamptz, v_activation_state;
    return;
  end if;

  v_window_interval := case
    when v_provider = 'workday' then interval '30 minutes'
    else interval '10 minutes'
  end;
  v_window_start := date_bin(
    v_window_interval,
    v_now,
    timestamptz '2000-01-01 00:00:00+00'
  );
  v_next_eligible_at := v_window_start + v_window_interval;

  if v_persisted_progress >= 3 then
    return query select false, 'progress_complete'::text, 3, v_window_start,
      v_next_eligible_at, v_activation_state;
    return;
  end if;

  if exists (
    select 1
    from public.connector_observations as o
    where o.observation_id = p_observation_id
  ) then
    return query select false, 'replay'::text, v_persisted_progress,
      v_window_start, v_next_eligible_at, v_activation_state;
    return;
  end if;

  if exists (
    select 1
    from public.connector_observations as o
    where o.company_id = p_company_id
      and o.eligibility_window_start = v_window_start
  ) then
    return query select false, 'same_window'::text, v_persisted_progress,
      v_window_start, v_next_eligible_at, v_activation_state;
    return;
  end if;

  insert into public.connector_observations (
    observation_id,
    company_id,
    provider,
    observed_at,
    eligibility_window_start,
    completeness,
    credible_for_closure,
    job_count,
    expected_count,
    warning_count,
    evidence_digest
  ) values (
    p_observation_id,
    p_company_id,
    v_provider,
    v_now,
    v_window_start,
    p_completeness,
    p_credible_for_closure,
    p_job_count,
    p_expected_count,
    p_warning_count,
    p_evidence_digest
  );

  select count(*)::integer
  into v_progress
  from public.connector_observations as o
  where o.company_id = p_company_id;

  if v_progress > 3 then
    raise exception 'connector observation cap violated';
  end if;

  update public.companies as c
  set
    activation_successes = v_progress,
    activation_state = case
      when v_progress = 3
        and c.ats_type in ('smartrecruiters', 'recruitee', 'paylocity')
      then 'active'
      else c.activation_state
    end,
    last_verified_at = v_now,
    last_observation_count = p_job_count,
    last_error = null,
    last_error_code = null
  where c.id = p_company_id
  returning c.activation_state into v_activation_state;

  return query select true, 'accepted'::text, v_progress, v_window_start,
    v_next_eligible_at, v_activation_state;
exception
  when unique_violation then
    return query select false, 'replay_or_same_window'::text,
      least(greatest(coalesce(v_persisted_progress, 0), 0), 3),
      v_window_start, v_next_eligible_at, v_activation_state;
end;
$$;

revoke execute on function public.record_connector_observation(
  uuid, uuid, text, boolean, integer, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.record_connector_observation(
  uuid, uuid, text, boolean, integer, integer, integer, text
) to service_role;

-- Preserve migration 0028's final scheduling frontier. Paylocity joins the
-- stable branch; Workday remains a separate byte-specific Capital One tuple.
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
        ats_type in ('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'recruitee', 'paylocity')
        or (
          ats_type = 'workday'
          and source_key = 'workday:wd12:capitalone:Capital_One'
          and board_token = 'capitalone'
          and region = 'wd12'
          and site_token = 'Capital_One'
        )
      )
      and (
        last_polled_at is null
        or last_polled_at < now() - interval '9 minutes'
      )
    order by last_polled_at asc nulls first
    limit batch_size
    for update skip locked
  )
  update public.companies as c
  set last_polled_at = now()
  from due
  where c.id = due.id
  returning c.*;
$$;

revoke execute on function public.claim_due_companies(integer)
  from public, anon, authenticated;
grant execute on function public.claim_due_companies(integer) to service_role;

-- Transactional parity checks fail the migration if a refreshed definition
-- silently widens a provider set or migration 0028's Capital One objects are
-- absent or drifted.
do $$
declare
  expected_company_sources text[] := array[
    'ashby', 'greenhouse', 'lever', 'paylocity', 'recruitee', 'smartrecruiters', 'workday'
  ];
  expected_job_sources text[] := array[
    'adzuna', 'ashby', 'greenhouse', 'lever', 'paylocity', 'recruitee', 'smartrecruiters', 'workday'
  ];
  expected_observation_providers text[] := array[
    'paylocity', 'recruitee', 'smartrecruiters', 'workday'
  ];
  actual_company_sources text[];
  actual_job_sources text[];
  actual_observation_providers text[];
  company_definition text;
  job_definition text;
  observation_definition text;
  paylocity_definition text;
  workday_definition text;
  capital_one_promotion_definition text;
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

  select pg_get_constraintdef(c.oid)
  into observation_definition
  from pg_catalog.pg_constraint as c
  where c.conrelid = 'public.connector_observations'::regclass
    and c.conname = 'connector_observations_provider_check';

  select array_agg(value[1] order by value[1])
  into actual_company_sources
  from regexp_matches(company_definition, '''([^'']+)''', 'g') as matches(value);

  select array_agg(value[1] order by value[1])
  into actual_job_sources
  from regexp_matches(job_definition, '''([^'']+)''', 'g') as matches(value);

  select array_agg(value[1] order by value[1])
  into actual_observation_providers
  from regexp_matches(observation_definition, '''([^'']+)''', 'g') as matches(value);

  if actual_company_sources is distinct from expected_company_sources then
    raise exception 'company connector constraint parity failed: %', actual_company_sources;
  end if;
  if actual_job_sources is distinct from expected_job_sources then
    raise exception 'job source constraint parity failed: %', actual_job_sources;
  end if;
  if actual_observation_providers is distinct from expected_observation_providers then
    raise exception 'observation provider constraint parity failed: %', actual_observation_providers;
  end if;

  select pg_get_constraintdef(c.oid)
  into paylocity_definition
  from pg_catalog.pg_constraint as c
  where c.conrelid = 'public.companies'::regclass
    and c.conname = 'companies_paylocity_identity_check';

  if paylocity_definition is null
    or position('d6628b21-949b-4400-a3d0-c9082bbf3eb1' in paylocity_definition) = 0
    or position('paylocity:global:d6628b21-949b-4400-a3d0-c9082bbf3eb1' in paylocity_definition) = 0
  then
    raise exception 'Paylocity identity constraint parity failed';
  end if;

  select pg_get_constraintdef(c.oid)
  into workday_definition
  from pg_catalog.pg_constraint as c
  where c.conrelid = 'public.companies'::regclass
    and c.conname = 'companies_workday_identity_check';

  if workday_definition is null
    or position('workday:wd12:capitalone:Capital_One' in workday_definition) = 0
    or position('capitalone' in workday_definition) = 0
    or position('wd12' in workday_definition) = 0
    or position('Capital_One' in workday_definition) = 0
  then
    raise exception 'Capital One identity constraint parity failed';
  end if;

  select pg_get_functiondef(p.oid)
  into capital_one_promotion_definition
  from pg_catalog.pg_proc as p
  join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'promote_capital_one_after_observation';

  if capital_one_promotion_definition is null
    or position('workday:wd12:capitalone:Capital_One' in capital_one_promotion_definition) = 0
    or position('warning_count = 0' in capital_one_promotion_definition) = 0
    or position('job_count = o.expected_count' in capital_one_promotion_definition) = 0
  then
    raise exception 'Capital One promotion function parity failed';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger as t
    where t.tgrelid = 'public.connector_observations'::regclass
      and t.tgname = 'promote_capital_one_after_observation'
      and not t.tgisinternal
  ) then
    raise exception 'Capital One promotion trigger parity failed';
  end if;
end;
$$;

comment on constraint companies_paylocity_identity_check on public.companies is
  'Only paylocity:global:d6628b21-949b-4400-a3d0-c9082bbf3eb1 may be Experimental or Active.';
comment on function public.claim_due_companies(integer) is
  'Claims active stable connectors including exact Paylocity plus the separately pinned Capital One Workday source.';

commit;

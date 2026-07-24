begin;

-- Generalize the Workday admission surface from the single Capital One identity
-- (migrations 0016/0028) to a fixed two-entry allowlist that additionally admits
-- Fidelity (board_token fmr, region wd1, site FidelityCareers). This migration is
-- forward-only: it relaxes constraints via ALTER ... DROP/ADD CONSTRAINT and
-- rebuilds RPCs via CREATE OR REPLACE only. It never edits a deployed migration
-- file (0013/0016/0028/0029/0034) and never seeds companies.
--
-- Capital One's tuple, catalog row, promotion trigger, and source key remain
-- byte-identical; Fidelity is an allowlist ADDITION, not a replacement. Unlike
-- 0028, this migration deliberately omits the zero-pre-existing-workday-jobs
-- guard: Capital One is already live in production and that guard would abort
-- (A5). Arbitrary Workday tenants remain rejected at the database tier.

-- (1) Relax the region check to admit any wd-numbered Workday region (wd1 for
-- Fidelity, wd12 for Capital One) while still rejecting arbitrary regions and
-- preserving the lever-eu and null cases. (2) Relax the Workday identity check
-- to a two-tuple allowlist.
alter table public.companies
  drop constraint companies_region_check,
  add constraint companies_region_check check (
    region is null
    or (ats_type = 'lever' and region = 'eu')
    or (ats_type = 'workday' and region ~ '^wd\d+$')
  ),
  drop constraint companies_workday_identity_check,
  add constraint companies_workday_identity_check check (
    ats_type <> 'workday'
    or (
      board_token = 'capitalone'
      and region = 'wd12'
      and site_token = 'Capital_One'
      and source_key = 'workday:wd12:capitalone:Capital_One'
      and activation_state in ('experimental', 'active')
    )
    or (
      board_token = 'fmr'
      and region = 'wd1'
      and site_token = 'FidelityCareers'
      and source_key = 'workday:wd1:fmr:FidelityCareers'
      and activation_state in ('experimental', 'active')
    )
  );

-- (3) Wire admitted Workday tenants into the shared 3-window auto-promotion by
-- adding 'workday' to the RPC stable-promotion set. Rebuild the latest RPC from
-- migration 0029 verbatim except for that one addition: database-time windowing,
-- row locking, replay/same-window rejection, the three-row cap, and the Paylocity
-- job_count guard are all unchanged. The dedicated Capital One promotion trigger
-- from 0028 is intentionally left in place and NOT redefined here, so Capital
-- One's path is unchanged (its RPC promotion is now redundant but idempotent —
-- both paths converge on 'active').
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
        and c.ats_type in ('smartrecruiters', 'recruitee', 'paylocity', 'workday')
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

-- (4) Widen the scheduling frontier so both admitted Workday identities become
-- claimable once active. The workday disjunct now admits the exact allowlist by
-- source key (Capital One + Fidelity); no other Workday tenant is claimable even
-- if application code drifts. Stable providers keep their flat allowlist.
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
          and source_key in (
            'workday:wd12:capitalone:Capital_One',
            'workday:wd1:fmr:FidelityCareers'
          )
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

-- (5) UPDATE (never INSERT) the existing Fidelity catalog row from
-- unsupported_with_reason (0013 L176-184) to experimental. INSERT would violate
-- both the UNIQUE company_name constraint and truthful_disposition_check; the
-- experimental disposition requires a non-null source_key and a null reason.
update public.source_coverage_catalog
set
  disposition = 'experimental',
  source_key = 'workday:wd1:fmr:FidelityCareers',
  unsupported_reason = null,
  provider = 'Workday',
  careers_url = 'https://wd1.myworkdaysite.com/en-US/recruiting/fmr/FidelityCareers',
  access_evidence = 'The public Workday CXS endpoint returned a reconciled category-scoped listing; the contract remains undocumented.',
  verified_at = date '2026-07-24'
where company_name = 'Fidelity';

-- (6) Transactional parity checks: fail the migration if the Capital One tuple is
-- no longer admitted, if Fidelity is not admitted, if the region check does not
-- admit wd-numbered Workday regions, or if either catalog row drifted from its
-- pinned experimental identity.
do $$
declare
  identity_definition text;
  region_definition text;
begin
  select pg_get_constraintdef(c.oid)
  into identity_definition
  from pg_catalog.pg_constraint as c
  where c.conrelid = 'public.companies'::regclass
    and c.conname = 'companies_workday_identity_check';

  if identity_definition is null
    or position('workday:wd12:capitalone:Capital_One' in identity_definition) = 0
    or position('capitalone' in identity_definition) = 0
    or position('wd12' in identity_definition) = 0
    or position('Capital_One' in identity_definition) = 0
    or position('workday:wd1:fmr:FidelityCareers' in identity_definition) = 0
    or position('fmr' in identity_definition) = 0
    or position('FidelityCareers' in identity_definition) = 0
  then
    raise exception 'Workday identity allowlist parity failed: %', identity_definition;
  end if;

  select pg_get_constraintdef(c.oid)
  into region_definition
  from pg_catalog.pg_constraint as c
  where c.conrelid = 'public.companies'::regclass
    and c.conname = 'companies_region_check';

  if region_definition is null
    or position('wd' in region_definition) = 0
  then
    raise exception 'Region check parity failed: %', region_definition;
  end if;

  -- Capital One catalog row must remain pinned experimental (byte-identical).
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

  -- Fidelity catalog row must now be experimental with its source key and no reason.
  if not exists (
    select 1
    from public.source_coverage_catalog
    where company_name = 'Fidelity'
      and provider = 'Workday'
      and disposition = 'experimental'
      and source_key = 'workday:wd1:fmr:FidelityCareers'
      and unsupported_reason is null
  ) then
    raise exception 'Fidelity catalog experimental parity failed';
  end if;
end;
$$;

comment on constraint companies_workday_identity_check on public.companies is
  'Two-entry Workday allowlist: workday:wd12:capitalone:Capital_One and workday:wd1:fmr:FidelityCareers may be Experimental or Active; no other Workday identity is admitted.';
comment on function public.claim_due_companies(integer) is
  'Claims active stable connectors plus the exact active Capital One and Fidelity Workday sources; the Workday importer is selective and never closes on absence.';

commit;

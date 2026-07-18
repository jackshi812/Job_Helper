-- Accepted activation evidence is intentionally bounded to three rows per
-- company. Database time owns eligibility; callers cannot supply timestamps or
-- directly choose activation state.
create table public.connector_observations (
  observation_id uuid primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  provider text not null check (
    provider in ('smartrecruiters', 'recruitee', 'workday')
  ),
  observed_at timestamptz not null default clock_timestamp(),
  eligibility_window_start timestamptz not null,
  completeness text not null check (
    completeness in ('complete', 'partial', 'unknown')
  ),
  credible_for_closure boolean not null,
  job_count integer not null check (job_count >= 0),
  expected_count integer not null check (expected_count >= 0),
  warning_count integer not null check (warning_count >= 0),
  evidence_digest text not null check (length(evidence_digest) between 16 and 128),
  unique (company_id, eligibility_window_start)
);

alter table public.connector_observations enable row level security;
revoke all on table public.connector_observations from public, anon, authenticated;
grant select, insert, update, delete on table public.connector_observations to service_role;

create index connector_observations_company_window_idx
  on public.connector_observations using btree (company_id, eligibility_window_start);

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
  -- Reject malformed or non-credible evidence before waiting for a company
  -- lock. Provider/state eligibility is checked after loading the server row.
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
    return query select false, 'ineligible_evidence'::text, null::integer, null::timestamptz,
      null::timestamptz, null::text;
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
    return query select false, 'ineligible_company'::text, 0, null::timestamptz,
      null::timestamptz, null::text;
    return;
  end if;

  if v_provider not in ('smartrecruiters', 'recruitee', 'workday')
    or v_activation_state not in ('experimental', 'active')
  then
    return query select false, 'ineligible_company'::text,
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

  -- This provider-independent cap must remain before any ledger insert. It
  -- prevents a fourth Workday row just as strictly as a fourth stable-provider
  -- row and keeps the company/UI counter equal to the accepted ledger count.
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
        and c.ats_type in ('smartrecruiters', 'recruitee')
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
    -- Constraints are the concurrency backstop. The company-row lock normally
    -- makes this branch reachable only for a globally replayed observation ID.
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

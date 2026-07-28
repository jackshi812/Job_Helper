begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Migration 0048 replaced the shared observation RPC while verify-board still
-- stages the exact reviewed Paylocity board. Restore only that closed identity
-- and its original ten-minute activation window; every later experimental
-- connector retains the existing one-minute contract.
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
  v_now timestamptz := clock_timestamp();
  v_window_interval interval;
  v_window_start timestamptz;
  v_next_eligible_at timestamptz;
  v_company public.companies%rowtype;
  v_progress integer;
begin
  if p_company_id is null or p_observation_id is null
    or p_completeness <> 'complete'
    or p_credible_for_closure is not true
    or p_job_count is null or p_job_count <= 0
    or p_expected_count is null or p_job_count <> p_expected_count
    or p_warning_count is null or p_warning_count <> 0
    or p_evidence_digest is null
    or p_evidence_digest !~ '^[0-9a-f]{64}$'
  then
    return query select false, 'ineligible_evidence'::text, null::integer,
      null::timestamptz, null::timestamptz, null::text;
    return;
  end if;

  set local lock_timeout = '500ms';
  begin
    select company.* into v_company
    from public.companies as company
    where company.id = p_company_id
    for update;
  exception
    when lock_not_available or query_canceled then
      return query select false, 'retryable_lock_contention'::text, null::integer,
        null::timestamptz, null::timestamptz, null::text;
      return;
  end;

  if not found
    or v_company.activation_state <> 'experimental'
    or not (
      (
        v_company.ats_type = 'workday'
        and v_company.source_key in (
          'workday:wd5:ms:External',
          'workday:wd1:ghr:Lateral-US',
          'workday:wd1:blackrock:BlackRock_Professional',
          'workday:wd3:barclays:External_Career_Site_Barclays'
        )
      )
      or (
        v_company.ats_type = 'oracle_recruiting'
        and v_company.source_key = 'oracle:jpmc:CX_1001'
      )
      or (
        v_company.ats_type = 'goldman_higher'
        and v_company.source_key = 'goldman_higher:roles'
      )
      or (
        v_company.ats_type = 'paylocity'
        and v_company.source_key =
          'paylocity:global:d6628b21-949b-4400-a3d0-c9082bbf3eb1'
        and v_company.board_token = 'd6628b21-949b-4400-a3d0-c9082bbf3eb1'
        and v_company.region is null
        and v_company.site_token is null
      )
    )
  then
    return query select false, 'ineligible_company'::text,
      coalesce(v_company.activation_successes, 0), null::timestamptz,
      null::timestamptz, v_company.activation_state;
    return;
  end if;

  v_window_interval := case
    when v_company.ats_type = 'paylocity' then interval '10 minutes'
    else interval '1 minute'
  end;
  v_window_start := date_bin(
    v_window_interval, v_now, timestamptz '2000-01-01 00:00:00+00'
  );
  v_next_eligible_at := v_window_start + v_window_interval;
  if v_company.activation_successes >= 3 then
    return query select false, 'progress_complete'::text, 3,
      v_window_start, v_next_eligible_at, v_company.activation_state;
    return;
  end if;
  if exists (
    select 1 from public.connector_observations
    where observation_id = p_observation_id
  ) then
    return query select false, 'replay'::text, v_company.activation_successes,
      v_window_start, v_next_eligible_at, v_company.activation_state;
    return;
  end if;
  if exists (
    select 1 from public.connector_observations
    where company_id = p_company_id
      and eligibility_window_start = v_window_start
  ) then
    return query select false, 'same_window'::text, v_company.activation_successes,
      v_window_start, v_next_eligible_at, v_company.activation_state;
    return;
  end if;

  insert into public.connector_observations (
    observation_id, company_id, provider, observed_at,
    eligibility_window_start, completeness, credible_for_closure, job_count,
    expected_count, warning_count, evidence_digest
  ) values (
    p_observation_id, p_company_id, v_company.ats_type, v_now,
    v_window_start, p_completeness, p_credible_for_closure, p_job_count,
    p_expected_count, p_warning_count, p_evidence_digest
  );
  select count(*)::integer into v_progress
  from public.connector_observations
  where company_id = p_company_id;
  if v_progress > 3 then raise exception 'connector observation cap violated'; end if;

  update public.companies as company
  set activation_successes = v_progress,
      activation_state = case when v_progress = 3 then 'active'
        else company.activation_state end,
      next_poll_at = case
        when v_progress = 3 then v_now
          + (abs(pg_catalog.hashtextextended(company.source_key, 0)) % 5)
            * interval '1 minute'
        else v_next_eligible_at
      end,
      last_verified_at = v_now,
      last_observation_count = p_job_count,
      last_error = null,
      last_error_code = null
  where company.id = p_company_id
  returning company.activation_state into v_company.activation_state;

  return query select true, 'accepted'::text, v_progress,
    v_window_start, v_next_eligible_at, v_company.activation_state;
exception
  when unique_violation then
    return query select false, 'replay_or_same_window'::text,
      least(greatest(coalesce(v_company.activation_successes, 0), 0), 3),
      v_window_start, v_next_eligible_at, v_company.activation_state;
end;
$$;

revoke execute on function public.record_connector_observation(
  uuid, uuid, text, boolean, integer, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.record_connector_observation(
  uuid, uuid, text, boolean, integer, integer, integer, text
) to service_role;

commit;

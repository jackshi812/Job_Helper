-- Forward-only repair for the Phase 03.8 one-use hosted verifier.
-- Migration 0040 is immutable release evidence; this migration only replaces
-- its verifier RPCs with alias-qualified table references.

do $$
begin
  if (
    select count(*)
    from public.phase_03_8_verifier_runs as verifier_run
    where verifier_run.run_id =
        '03850000-0000-4000-8000-000000000501'::uuid
      and verifier_run.release_manifest_id =
        '03850000-0000-4000-8000-000000000005'::uuid
      and verifier_run.state = 'armed'
      and verifier_run.started_at is null
      and verifier_run.expires_at is null
      and verifier_run.exercise_calls = 0
      and verifier_run.max_exercise_calls = 12
  ) <> 1 then
    raise exception using errcode = '55000',
      message = 'phase 03.8 verifier is not pristine and armed';
  end if;

  if exists (
    select 1
    from public.phase_03_8_verifier_fixtures as verifier_fixture
    where verifier_fixture.run_id =
      '03850000-0000-4000-8000-000000000501'::uuid
  ) or exists (
    select 1
    from public.companies as verifier_company
    where verifier_company.id in (
      '03850000-0000-4000-8000-000000000511'::uuid,
      '03850000-0000-4000-8000-000000000521'::uuid,
      '03850000-0000-4000-8000-000000000531'::uuid
    )
      or verifier_company.source_key in (
        'phase03_8_verifier:eightfold_fixture',
        'phase03_8_verifier:oracle_fixture',
        'phase03_8_verifier:goldman_fixture'
      )
  ) or exists (
    select 1
    from public.jobs as verifier_job
    where verifier_job.id in (
      '03850000-0000-4000-8000-000000000512'::uuid,
      '03850000-0000-4000-8000-000000000522'::uuid,
      '03850000-0000-4000-8000-000000000532'::uuid
    )
      or verifier_job.external_id like 'phase03_8_verifier:%'
  ) or exists (
    select 1
    from public.connector_observations as verifier_observation
    where verifier_observation.observation_id in (
      '03850000-0000-4000-8000-000000000513'::uuid,
      '03850000-0000-4000-8000-000000000523'::uuid,
      '03850000-0000-4000-8000-000000000533'::uuid
    )
  ) then
    raise exception using errcode = '23505',
      message = 'phase 03.8 verifier fixture collision';
  end if;
end;
$$;

create or replace function public.begin_phase_03_8_verifier_run(
  p_run_id uuid
)
returns table (
  started boolean,
  expires_at timestamptz,
  exercise_calls integer,
  fixture_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_expires_at timestamptz;
  v_fixture_count integer;
begin
  if p_run_id is distinct from
    '03850000-0000-4000-8000-000000000501'::uuid
  then
    raise exception using errcode = '22023',
      message = 'unknown verifier run';
  end if;

  update public.phase_03_8_verifier_runs as verifier_run
  set state = 'running',
      started_at = v_now,
      expires_at = v_now + interval '20 minutes'
  where verifier_run.run_id = p_run_id
    and verifier_run.release_manifest_id =
      '03850000-0000-4000-8000-000000000005'::uuid
    and verifier_run.state = 'armed'
    and verifier_run.started_at is null
    and verifier_run.expires_at is null
    and verifier_run.exercise_calls = 0
  returning verifier_run.expires_at
  into v_expires_at;
  if not found then
    raise exception using errcode = '55000',
      message = 'verifier run is not armed';
  end if;

  if exists (
    select 1 from public.companies as verifier_company
    where verifier_company.id in (
      '03850000-0000-4000-8000-000000000511'::uuid,
      '03850000-0000-4000-8000-000000000521'::uuid,
      '03850000-0000-4000-8000-000000000531'::uuid
    )
      or verifier_company.source_key in (
        'phase03_8_verifier:eightfold_fixture',
        'phase03_8_verifier:oracle_fixture',
        'phase03_8_verifier:goldman_fixture'
      )
  ) or exists (
    select 1 from public.jobs as verifier_job
    where verifier_job.id in (
      '03850000-0000-4000-8000-000000000512'::uuid,
      '03850000-0000-4000-8000-000000000522'::uuid,
      '03850000-0000-4000-8000-000000000532'::uuid
    )
      or verifier_job.external_id like 'phase03_8_verifier:%'
  ) then
    raise exception using errcode = '23505',
      message = 'verifier fixture collision';
  end if;

  insert into public.companies (
    id, name, ats_type, board_token, region, careers_url, source_key,
    site_token, activation_state, activation_successes, next_poll_at,
    last_verified_at, last_success_at, consecutive_failures,
    last_error, last_error_code, last_observation_count
  ) values
    (
      '03850000-0000-4000-8000-000000000511'::uuid,
      'Phase 03.8 Verifier Eightfold', 'greenhouse',
      'phase03-8-verifier-eightfold', null,
      'https://example.invalid/phase03-8/eightfold',
      'phase03_8_verifier:eightfold_fixture', null,
      'active', 3, 'infinity'::timestamptz, v_now, v_now, 0,
      null, null, 1
    ),
    (
      '03850000-0000-4000-8000-000000000521'::uuid,
      'Phase 03.8 Verifier Oracle', 'greenhouse',
      'phase03-8-verifier-oracle', null,
      'https://example.invalid/phase03-8/oracle',
      'phase03_8_verifier:oracle_fixture', null,
      'active', 3, 'infinity'::timestamptz, v_now, v_now, 0,
      null, null, 1
    ),
    (
      '03850000-0000-4000-8000-000000000531'::uuid,
      'Phase 03.8 Verifier Goldman', 'greenhouse',
      'phase03-8-verifier-goldman', null,
      'https://example.invalid/phase03-8/goldman',
      'phase03_8_verifier:goldman_fixture', null,
      'active', 3, 'infinity'::timestamptz, v_now, v_now, 0,
      null, null, 1
    );

  insert into public.jobs (
    id, company_id, source, external_id, title, location, absolute_url,
    posted_at, description_text, snapshot_partial, fingerprint, status,
    first_seen_at, last_seen_at, closed_at
  ) values
    (
      '03850000-0000-4000-8000-000000000512'::uuid,
      '03850000-0000-4000-8000-000000000511'::uuid,
      'greenhouse', 'phase03_8_verifier:eightfold_fixture',
      'Phase 03.8 Verifier Eightfold Job', 'Chicago, IL',
      'https://example.invalid/phase03-8/eightfold/job',
      v_now, 'Disposable lifecycle verifier row.', false,
      'phase03_8_verifier:eightfold_fixture', 'open', v_now, v_now, null
    ),
    (
      '03850000-0000-4000-8000-000000000522'::uuid,
      '03850000-0000-4000-8000-000000000521'::uuid,
      'greenhouse', 'phase03_8_verifier:oracle_fixture',
      'Phase 03.8 Verifier Oracle Job', 'Chicago, IL',
      'https://example.invalid/phase03-8/oracle/job',
      v_now, 'Disposable lifecycle verifier row.', false,
      'phase03_8_verifier:oracle_fixture', 'open', v_now, v_now, null
    ),
    (
      '03850000-0000-4000-8000-000000000532'::uuid,
      '03850000-0000-4000-8000-000000000531'::uuid,
      'greenhouse', 'phase03_8_verifier:goldman_fixture',
      'Phase 03.8 Verifier Goldman Job', 'Chicago, IL',
      'https://example.invalid/phase03-8/goldman/job',
      v_now, 'Disposable lifecycle verifier row.', false,
      'phase03_8_verifier:goldman_fixture', 'open', v_now, v_now, null
    );

  insert into public.phase_03_8_verifier_fixtures (
    run_id, fixture_key, company_id, job_id, observation_id
  ) values
    (
      p_run_id, 'eightfold_fixture',
      '03850000-0000-4000-8000-000000000511'::uuid,
      '03850000-0000-4000-8000-000000000512'::uuid,
      '03850000-0000-4000-8000-000000000513'::uuid
    ),
    (
      p_run_id, 'oracle_fixture',
      '03850000-0000-4000-8000-000000000521'::uuid,
      '03850000-0000-4000-8000-000000000522'::uuid,
      '03850000-0000-4000-8000-000000000523'::uuid
    ),
    (
      p_run_id, 'goldman_fixture',
      '03850000-0000-4000-8000-000000000531'::uuid,
      '03850000-0000-4000-8000-000000000532'::uuid,
      '03850000-0000-4000-8000-000000000533'::uuid
    );

  select count(*)::integer into v_fixture_count
  from public.phase_03_8_verifier_fixtures as verifier_fixture
  where verifier_fixture.run_id = p_run_id;
  if v_fixture_count <> 3 then
    raise exception 'verifier fixture seed count mismatch';
  end if;

  return query select true, v_expires_at, 0, v_fixture_count;
end;
$$;

create or replace function public.exercise_phase_03_8_verifier_fault(
  p_run_id uuid,
  p_fixture text,
  p_fault text,
  p_expected_version integer
)
returns table (
  fixture_key text,
  fixture_version integer,
  fault text,
  job_status text,
  activation_state text,
  consecutive_failures integer,
  last_error_code text,
  last_success_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.phase_03_8_verifier_runs%rowtype;
  v_fixture public.phase_03_8_verifier_fixtures%rowtype;
  v_company public.companies%rowtype;
  v_job_status text;
  v_company_count integer;
begin
  if p_run_id is distinct from
      '03850000-0000-4000-8000-000000000501'::uuid
    or p_fixture not in (
      'eightfold_fixture', 'oracle_fixture', 'goldman_fixture'
    )
    or p_fault not in (
      'incomplete_observation', 'provider_schema_error',
      'provider_timeout', 'clean_recovery'
    )
    or p_expected_version is null
    or p_expected_version < 0
    or p_expected_version > 12
  then
    raise exception using errcode = '22023',
      message = 'invalid fixed verifier fault request';
  end if;

  select verifier_run.* into v_run
  from public.phase_03_8_verifier_runs as verifier_run
  where verifier_run.run_id = p_run_id
  for update;
  if not found
    or v_run.state <> 'running'
    or not (v_run.expires_at > clock_timestamp())
    or v_run.exercise_calls >= v_run.max_exercise_calls
  then
    raise exception using errcode = '55000',
      message = 'verifier authority unavailable';
  end if;

  select verifier_fixture.* into v_fixture
  from public.phase_03_8_verifier_fixtures as verifier_fixture
  where verifier_fixture.run_id = p_run_id
    and verifier_fixture.fixture_key = p_fixture
    and verifier_fixture.fixture_version = p_expected_version
  for update;
  if not found then
    raise exception using errcode = '40001',
      message = 'stale or unknown verifier fixture';
  end if;

  select verifier_job.status into v_job_status
  from public.jobs as verifier_job
  where verifier_job.id = v_fixture.job_id
    and verifier_job.company_id = v_fixture.company_id
  for update;
  if not found or v_job_status <> 'open' then
    raise exception 'owned verifier job is not open';
  end if;

  if p_fault = 'clean_recovery' then
    update public.companies as verifier_company
    set activation_state = 'active',
        last_success_at = clock_timestamp(),
        consecutive_failures = 0,
        last_error = null,
        last_error_code = null,
        last_observation_count = 1,
        next_poll_at = 'infinity'::timestamptz
    where verifier_company.id = v_fixture.company_id
      and verifier_company.source_key =
        'phase03_8_verifier:' || p_fixture;
    get diagnostics v_company_count = row_count;
    update public.pipeline_heartbeat as verifier_heartbeat
    set last_success_at = clock_timestamp()
    where verifier_heartbeat.id = true;
  else
    update public.companies as verifier_company
    set activation_state = 'active',
        consecutive_failures =
          verifier_company.consecutive_failures + 1,
        last_error = p_fault,
        last_error_code = p_fault,
        last_observation_count = 0,
        next_poll_at = 'infinity'::timestamptz
    where verifier_company.id = v_fixture.company_id
      and verifier_company.source_key =
        'phase03_8_verifier:' || p_fixture;
    get diagnostics v_company_count = row_count;
  end if;
  if v_company_count <> 1 then
    raise exception 'owned verifier company mismatch';
  end if;

  update public.phase_03_8_verifier_fixtures as verifier_fixture
  set fixture_version = verifier_fixture.fixture_version + 1,
      last_fault = p_fault
  where verifier_fixture.run_id = p_run_id
    and verifier_fixture.fixture_key = p_fixture
    and verifier_fixture.fixture_version = p_expected_version
  returning verifier_fixture.* into v_fixture;
  if not found then
    raise exception using errcode = '40001',
      message = 'verifier fixture version changed';
  end if;

  update public.phase_03_8_verifier_runs as verifier_run
  set exercise_calls = verifier_run.exercise_calls + 1
  where verifier_run.run_id = p_run_id
    and verifier_run.state = 'running'
    and verifier_run.exercise_calls < verifier_run.max_exercise_calls;
  if not found then
    raise exception 'verifier call budget exhausted';
  end if;

  select verifier_company.* into v_company
  from public.companies as verifier_company
  where verifier_company.id = v_fixture.company_id;
  select verifier_job.status into v_job_status
  from public.jobs as verifier_job
  where verifier_job.id = v_fixture.job_id;
  if v_job_status <> 'open' then
    raise exception 'verifier fault closed an owned job';
  end if;

  return query select
    v_fixture.fixture_key,
    v_fixture.fixture_version,
    p_fault,
    v_job_status,
    v_company.activation_state,
    v_company.consecutive_failures,
    v_company.last_error_code,
    v_company.last_success_at;
end;
$$;

create or replace function public.finish_phase_03_8_verifier_run(
  p_run_id uuid,
  p_eightfold_expected_version integer,
  p_oracle_expected_version integer,
  p_goldman_expected_version integer
)
returns table (
  consumed boolean,
  release_manifest_id uuid,
  run_id uuid,
  exercise_calls integer,
  deleted_fixtures integer,
  remaining_rows integer,
  grants_revoked boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.phase_03_8_verifier_runs%rowtype;
  v_fixture_count integer;
  v_job_count integer;
  v_company_count integer;
  v_remaining integer;
  v_company_ids uuid[];
  v_job_ids uuid[];
  v_manifest_id uuid;
  v_calls integer;
begin
  if p_run_id is distinct from
    '03850000-0000-4000-8000-000000000501'::uuid
  then
    raise exception using errcode = '22023',
      message = 'unknown verifier run';
  end if;

  select verifier_run.* into v_run
  from public.phase_03_8_verifier_runs as verifier_run
  where verifier_run.run_id = p_run_id
  for update;
  if not found or v_run.state <> 'running' then
    raise exception using errcode = '55000',
      message = 'verifier run is not running';
  end if;

  if not exists (
    select 1
    from public.phase_03_8_verifier_fixtures as verifier_fixture
    where verifier_fixture.run_id = p_run_id
    group by verifier_fixture.run_id
    having count(*) = 3
      and bool_and(
        (verifier_fixture.fixture_key = 'eightfold_fixture'
          and verifier_fixture.fixture_version =
            p_eightfold_expected_version)
        or (verifier_fixture.fixture_key = 'oracle_fixture'
          and verifier_fixture.fixture_version =
            p_oracle_expected_version)
        or (verifier_fixture.fixture_key = 'goldman_fixture'
          and verifier_fixture.fixture_version =
            p_goldman_expected_version)
      )
  ) then
    raise exception using errcode = '40001',
      message = 'verifier finish version mismatch';
  end if;

  select
    array_agg(verifier_fixture.company_id
      order by verifier_fixture.fixture_key),
    array_agg(verifier_fixture.job_id
      order by verifier_fixture.fixture_key)
  into v_company_ids, v_job_ids
  from public.phase_03_8_verifier_fixtures as verifier_fixture
  where verifier_fixture.run_id = p_run_id;

  delete from public.connector_observations as observation
  using public.phase_03_8_verifier_fixtures as fixture
  where fixture.run_id = p_run_id
    and observation.company_id = fixture.company_id
    and observation.observation_id = fixture.observation_id;

  delete from public.jobs as job
  using public.phase_03_8_verifier_fixtures as fixture
  where fixture.run_id = p_run_id
    and job.id = fixture.job_id
    and job.company_id = fixture.company_id
    and job.status = 'open'
    and job.external_id = 'phase03_8_verifier:' || fixture.fixture_key;
  get diagnostics v_job_count = row_count;
  if v_job_count <> 3 then
    raise exception 'verifier owned job cleanup mismatch';
  end if;

  update public.phase_03_8_verifier_runs as verifier_run
  set state = 'consumed'
  where verifier_run.run_id = p_run_id
    and verifier_run.state = 'running'
  returning verifier_run.release_manifest_id,
    verifier_run.exercise_calls
  into v_manifest_id, v_calls;
  if not found then
    raise exception 'verifier latch consume failed';
  end if;

  delete from public.phase_03_8_verifier_fixtures as verifier_fixture
  where verifier_fixture.run_id = p_run_id;
  get diagnostics v_fixture_count = row_count;
  if v_fixture_count <> 3 then
    raise exception 'verifier ownership cleanup mismatch';
  end if;

  delete from public.companies as verifier_company
  where verifier_company.id = any(v_company_ids)
    and verifier_company.source_key like 'phase03_8_verifier:%';
  get diagnostics v_company_count = row_count;
  if v_company_count <> 3 then
    raise exception 'verifier owned company cleanup mismatch';
  end if;

  revoke execute on function public.begin_phase_03_8_verifier_run(uuid)
    from service_role;
  revoke execute on function public.exercise_phase_03_8_verifier_fault(
    uuid, text, text, integer
  ) from service_role;
  revoke execute on function public.finish_phase_03_8_verifier_run(
    uuid, integer, integer, integer
  ) from service_role;

  delete from public.phase_03_8_verifier_runs as verifier_run
  where verifier_run.run_id = p_run_id
    and verifier_run.state = 'consumed';
  if not found then
    raise exception 'consumed verifier run cleanup mismatch';
  end if;

  select
    (select count(*) from public.phase_03_8_verifier_runs as verifier_run
      where verifier_run.run_id = p_run_id)
    + (select count(*)
      from public.phase_03_8_verifier_fixtures as verifier_fixture
      where verifier_fixture.run_id = p_run_id)
    + (select count(*) from public.companies as verifier_company
      where verifier_company.id = any(v_company_ids))
    + (select count(*) from public.jobs as verifier_job
      where verifier_job.id = any(v_job_ids))
  into v_remaining;
  if v_remaining <> 0 then
    raise exception 'verifier residue remains';
  end if;

  return query select
    true, v_manifest_id, p_run_id, v_calls, v_fixture_count, v_remaining, true;
end;
$$;

revoke execute on function public.begin_phase_03_8_verifier_run(uuid)
  from public, anon, authenticated;
revoke execute on function public.exercise_phase_03_8_verifier_fault(
  uuid, text, text, integer
) from public, anon, authenticated;
revoke execute on function public.finish_phase_03_8_verifier_run(
  uuid, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.begin_phase_03_8_verifier_run(uuid)
  to service_role;
grant execute on function public.exercise_phase_03_8_verifier_fault(
  uuid, text, text, integer
) to service_role;
grant execute on function public.finish_phase_03_8_verifier_run(
  uuid, integer, integer, integer
) to service_role;

-- Forward-only repair for the Phase 03.8 one-use verifier cleanup order.
-- Migrations 0040 and 0041 are immutable. This migration replaces only the
-- finish RPC so ownership rows are deleted before their RESTRICT-owned jobs.

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

  -- The fixture rows own the disposable job/company IDs through RESTRICT FKs.
  -- Delete ownership first, then delete only the three literal owned tuples.
  delete from public.phase_03_8_verifier_fixtures as verifier_fixture
  where verifier_fixture.run_id = p_run_id;
  get diagnostics v_fixture_count = row_count;
  if v_fixture_count <> 3 then
    raise exception 'verifier ownership cleanup mismatch';
  end if;

  delete from public.jobs as verifier_job
  where (
    verifier_job.id,
    verifier_job.company_id,
    verifier_job.external_id
  ) in (
    (
      '03850000-0000-4000-8000-000000000512'::uuid,
      '03850000-0000-4000-8000-000000000511'::uuid,
      'phase03_8_verifier:eightfold_fixture'
    ),
    (
      '03850000-0000-4000-8000-000000000522'::uuid,
      '03850000-0000-4000-8000-000000000521'::uuid,
      'phase03_8_verifier:oracle_fixture'
    ),
    (
      '03850000-0000-4000-8000-000000000532'::uuid,
      '03850000-0000-4000-8000-000000000531'::uuid,
      'phase03_8_verifier:goldman_fixture'
    )
  )
    and verifier_job.status = 'open'
    and verifier_job.id = any(v_job_ids);
  get diagnostics v_job_count = row_count;
  if v_job_count <> 3 then
    raise exception 'verifier owned job cleanup mismatch';
  end if;

  delete from public.companies as verifier_company
  where verifier_company.id = any(v_company_ids)
    and (
      verifier_company.id,
      verifier_company.source_key
    ) in (
      (
        '03850000-0000-4000-8000-000000000511'::uuid,
        'phase03_8_verifier:eightfold_fixture'
      ),
      (
        '03850000-0000-4000-8000-000000000521'::uuid,
        'phase03_8_verifier:oracle_fixture'
      ),
      (
        '03850000-0000-4000-8000-000000000531'::uuid,
        'phase03_8_verifier:goldman_fixture'
      )
    );
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

revoke execute on function public.finish_phase_03_8_verifier_run(
  uuid, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.finish_phase_03_8_verifier_run(
  uuid, integer, integer, integer
) to service_role;

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select extensions.plan(44);

-- These fixed UUIDs and provider identities are unmistakably synthetic. The
-- runner executes this file twice against the same disposable database; these
-- first assertions therefore also prove the prior invocation rolled back.
select extensions.is(
  (select count(*)::integer from auth.users
   where id in (
     '05100000-0000-4000-8000-000000000001'::uuid,
     '05100000-0000-4000-8000-000000000002'::uuid
   )),
  0,
  'synthetic auth fixtures do not survive a prior invocation'
);
select extensions.is(
  (select count(*)::integer from public.jobs
   where id in (
     '05100000-0000-4000-8000-000000000101'::uuid,
     '05100000-0000-4000-8000-000000000102'::uuid,
     '05100000-0000-4000-8000-000000000103'::uuid
   )),
  0,
  'synthetic job fixtures do not survive a prior invocation'
);
select extensions.is(
  (select count(*)::integer from public.user_job_dismissals
   where user_id in (
     '05100000-0000-4000-8000-000000000001'::uuid,
     '05100000-0000-4000-8000-000000000002'::uuid
   )),
  0,
  'synthetic dismissal fixtures do not survive a prior invocation'
);

-- Live catalog and ACL assertions for the effective service boundary.
select extensions.ok(
  to_regprocedure('public.enqueue_deterministic_new_jobs(integer)') is not null,
  'enqueue signature exists'
);
select extensions.is(
  (select procedure.pronargdefaults::integer
   from pg_catalog.pg_proc as procedure
   where procedure.oid =
     'public.enqueue_deterministic_new_jobs(integer)'::regprocedure),
  1,
  'enqueue keeps one default argument'
);
select extensions.is(
  (select pg_catalog.pg_get_userbyid(procedure.proowner)
   from pg_catalog.pg_proc as procedure
   where procedure.oid =
     'public.enqueue_deterministic_new_jobs(integer)'::regprocedure),
  'postgres',
  'enqueue remains postgres-owned'
);
select extensions.is(
  (select procedure.prosecdef
   from pg_catalog.pg_proc as procedure
   where procedure.oid =
     'public.enqueue_deterministic_new_jobs(integer)'::regprocedure),
  true,
  'enqueue remains SECURITY DEFINER'
);
select extensions.ok(
  (select 'search_path=""' = any(coalesce(procedure.proconfig, '{}'::text[]))
   from pg_catalog.pg_proc as procedure
   where procedure.oid =
     'public.enqueue_deterministic_new_jobs(integer)'::regprocedure),
  'enqueue keeps an empty search path'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.enqueue_deterministic_new_jobs(integer)',
    'EXECUTE'
  ),
  'service_role can execute enqueue'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.enqueue_deterministic_new_jobs(integer)',
    'EXECUTE'
  ),
  'anon cannot execute enqueue'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.enqueue_deterministic_new_jobs(integer)',
    'EXECUTE'
  ),
  'authenticated cannot execute enqueue'
);
select extensions.ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )
    ) as privilege
    where procedure.oid =
      'public.enqueue_deterministic_new_jobs(integer)'::regprocedure
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ),
  'PUBLIC has no enqueue EXECUTE ACL'
);
select extensions.ok(
  exists (
    select 1
    from information_schema.routine_privileges as privilege
    where privilege.specific_schema = 'public'
      and privilege.routine_name = 'enqueue_deterministic_new_jobs'
      and privilege.grantee = 'service_role'
      and privilege.privilege_type = 'EXECUTE'
  ),
  'information_schema exposes the service_role EXECUTE grant'
);
select extensions.ok(
  not exists (
    select 1
    from information_schema.routine_privileges as privilege
    where privilege.specific_schema = 'public'
      and privilege.routine_name = 'enqueue_deterministic_new_jobs'
      and lower(privilege.grantee) in ('public', 'anon', 'authenticated')
      and privilege.privilege_type = 'EXECUTE'
  ),
  'information_schema exposes no browser-role EXECUTE grant'
);

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change
)
values
  (
    '00000000-0000-0000-0000-000000000000'::uuid,
    '05100000-0000-4000-8000-000000000001'::uuid,
    'authenticated',
    'authenticated',
    'phase-051-owner-a@example.invalid',
    'synthetic-not-a-login',
    clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp(),
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000'::uuid,
    '05100000-0000-4000-8000-000000000002'::uuid,
    'authenticated',
    'authenticated',
    'phase-051-owner-b@example.invalid',
    'synthetic-not-a-login',
    clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp(),
    '',
    '',
    '',
    ''
  );

insert into public.preferences (user_id)
values
  ('05100000-0000-4000-8000-000000000001'::uuid),
  ('05100000-0000-4000-8000-000000000002'::uuid);

insert into public.jobs (
  id,
  source,
  external_id,
  title,
  location,
  absolute_url,
  fingerprint,
  status,
  first_seen_at,
  last_seen_at
)
values
  (
    '05100000-0000-4000-8000-000000000101'::uuid,
    'greenhouse',
    'phase-051-baseline',
    'Synthetic Baseline Role',
    'Chicago, IL',
    'https://example.invalid/phase-051-baseline',
    'phase-051-baseline-fingerprint',
    'open',
    clock_timestamp(),
    clock_timestamp()
  ),
  (
    '05100000-0000-4000-8000-000000000102'::uuid,
    'greenhouse',
    'phase-051-dismissed-open',
    'Synthetic Dismissed Role',
    'Chicago, IL',
    'https://example.invalid/phase-051-dismissed-open',
    'phase-051-dismissed-fingerprint',
    'open',
    clock_timestamp(),
    clock_timestamp()
  );

insert into public.user_jobs (
  id,
  user_id,
  job_id,
  status,
  deterministic_revision,
  deterministic_eligible,
  deterministic_score,
  deterministic_tier,
  deterministic_breakdown,
  deterministic_ranked_at,
  deterministic_evaluation_time
)
values
  (
    '05100000-0000-4000-8000-000000000401'::uuid,
    '05100000-0000-4000-8000-000000000001'::uuid,
    '05100000-0000-4000-8000-000000000101'::uuid,
    'scored', 1, true, 80, 'Strong',
    '[
      {"key":"title","earned":1,"possible":1,"evidence":[]},
      {"key":"location","earned":1,"possible":1,"evidence":[]},
      {"key":"keywords","earned":1,"possible":1,"evidence":[]},
      {"key":"experience","earned":1,"possible":1,"evidence":[]},
      {"key":"recency","earned":1,"possible":1,"evidence":[]},
      {"key":"watchlist","earned":1,"possible":1,"evidence":[]}
    ]'::jsonb,
    clock_timestamp(), clock_timestamp()
  ),
  (
    '05100000-0000-4000-8000-000000000402'::uuid,
    '05100000-0000-4000-8000-000000000002'::uuid,
    '05100000-0000-4000-8000-000000000101'::uuid,
    'scored', 1, true, 80, 'Strong',
    '[
      {"key":"title","earned":1,"possible":1,"evidence":[]},
      {"key":"location","earned":1,"possible":1,"evidence":[]},
      {"key":"keywords","earned":1,"possible":1,"evidence":[]},
      {"key":"experience","earned":1,"possible":1,"evidence":[]},
      {"key":"recency","earned":1,"possible":1,"evidence":[]},
      {"key":"watchlist","earned":1,"possible":1,"evidence":[]}
    ]'::jsonb,
    clock_timestamp(), clock_timestamp()
  ),
  (
    '05100000-0000-4000-8000-000000000403'::uuid,
    '05100000-0000-4000-8000-000000000002'::uuid,
    '05100000-0000-4000-8000-000000000102'::uuid,
    'scored', 1, true, 80, 'Strong',
    '[
      {"key":"title","earned":1,"possible":1,"evidence":[]},
      {"key":"location","earned":1,"possible":1,"evidence":[]},
      {"key":"keywords","earned":1,"possible":1,"evidence":[]},
      {"key":"experience","earned":1,"possible":1,"evidence":[]},
      {"key":"recency","earned":1,"possible":1,"evidence":[]},
      {"key":"watchlist","earned":1,"possible":1,"evidence":[]}
    ]'::jsonb,
    clock_timestamp(), clock_timestamp()
  );

insert into public.deterministic_ranking_runs (
  id,
  user_id,
  revision,
  run_kind,
  captured_titles,
  captured_locations,
  captured_include_keywords,
  captured_exclude_keywords,
  captured_title_exclude_keywords,
  captured_max_required_experience,
  captured_rubric,
  captured_good_threshold,
  captured_strong_threshold,
  evaluation_time,
  expected_job_count,
  status,
  completed_at
)
values
  (
    '05100000-0000-4000-8000-000000000201'::uuid,
    '05100000-0000-4000-8000-000000000001'::uuid,
    1, 'preferences', '{}', '{}', '{}', '{}', '{}', null,
    '{
      "strictTitle":30,"weakTitle":20,"preferredLocation":10,
      "recency":10,"watchlist":10,"experience":20,
      "includeKeywordSteps":{"one":3,"two":5,"three":10,"four":15,"fivePlus":20}
    }'::jsonb,
    50, 75, clock_timestamp(), 1, 'completed', clock_timestamp()
  ),
  (
    '05100000-0000-4000-8000-000000000202'::uuid,
    '05100000-0000-4000-8000-000000000002'::uuid,
    1, 'preferences', '{}', '{}', '{}', '{}', '{}', null,
    '{
      "strictTitle":30,"weakTitle":20,"preferredLocation":10,
      "recency":10,"watchlist":10,"experience":20,
      "includeKeywordSteps":{"one":3,"two":5,"three":10,"four":15,"fivePlus":20}
    }'::jsonb,
    50, 75, clock_timestamp(), 2, 'completed', clock_timestamp()
  );

insert into public.deterministic_ranking_items (
  id,
  run_id,
  user_id,
  user_job_id,
  job_id,
  revision,
  status,
  attempts,
  deterministic_eligible,
  deterministic_score,
  deterministic_tier,
  deterministic_breakdown,
  completed_at
)
values
  (
    '05100000-0000-4000-8000-000000000301'::uuid,
    '05100000-0000-4000-8000-000000000201'::uuid,
    '05100000-0000-4000-8000-000000000001'::uuid,
    '05100000-0000-4000-8000-000000000401'::uuid,
    '05100000-0000-4000-8000-000000000101'::uuid,
    1, 'completed', 1, true, 80, 'Strong',
    '[
      {"key":"title","earned":1,"possible":1,"evidence":[]},
      {"key":"location","earned":1,"possible":1,"evidence":[]},
      {"key":"keywords","earned":1,"possible":1,"evidence":[]},
      {"key":"experience","earned":1,"possible":1,"evidence":[]},
      {"key":"recency","earned":1,"possible":1,"evidence":[]},
      {"key":"watchlist","earned":1,"possible":1,"evidence":[]}
    ]'::jsonb,
    clock_timestamp()
  ),
  (
    '05100000-0000-4000-8000-000000000302'::uuid,
    '05100000-0000-4000-8000-000000000202'::uuid,
    '05100000-0000-4000-8000-000000000002'::uuid,
    '05100000-0000-4000-8000-000000000402'::uuid,
    '05100000-0000-4000-8000-000000000101'::uuid,
    1, 'completed', 1, true, 80, 'Strong',
    '[
      {"key":"title","earned":1,"possible":1,"evidence":[]},
      {"key":"location","earned":1,"possible":1,"evidence":[]},
      {"key":"keywords","earned":1,"possible":1,"evidence":[]},
      {"key":"experience","earned":1,"possible":1,"evidence":[]},
      {"key":"recency","earned":1,"possible":1,"evidence":[]},
      {"key":"watchlist","earned":1,"possible":1,"evidence":[]}
    ]'::jsonb,
    clock_timestamp()
  ),
  (
    '05100000-0000-4000-8000-000000000303'::uuid,
    '05100000-0000-4000-8000-000000000202'::uuid,
    '05100000-0000-4000-8000-000000000002'::uuid,
    '05100000-0000-4000-8000-000000000403'::uuid,
    '05100000-0000-4000-8000-000000000102'::uuid,
    1, 'completed', 1, true, 80, 'Strong',
    '[
      {"key":"title","earned":1,"possible":1,"evidence":[]},
      {"key":"location","earned":1,"possible":1,"evidence":[]},
      {"key":"keywords","earned":1,"possible":1,"evidence":[]},
      {"key":"experience","earned":1,"possible":1,"evidence":[]},
      {"key":"recency","earned":1,"possible":1,"evidence":[]},
      {"key":"watchlist","earned":1,"possible":1,"evidence":[]}
    ]'::jsonb,
    clock_timestamp()
  );

insert into public.deterministic_ranking_state (
  user_id,
  active_revision,
  desired_revision,
  status,
  active_run_id,
  building_run_id,
  error_code,
  retry_available,
  updated_at
)
values
  (
    '05100000-0000-4000-8000-000000000001'::uuid,
    1, 1, 'idle',
    '05100000-0000-4000-8000-000000000201'::uuid,
    null, null, false, clock_timestamp()
  ),
  (
    '05100000-0000-4000-8000-000000000002'::uuid,
    1, 1, 'idle',
    '05100000-0000-4000-8000-000000000202'::uuid,
    null, null, false, clock_timestamp()
  );

insert into public.user_job_dismissals (user_id, source, external_id)
values (
  '05100000-0000-4000-8000-000000000001'::uuid,
  'greenhouse',
  'phase-051-dismissed-open'
);

create temp table phase_051_pre_counts on commit drop as
select
  (select count(*)::integer
   from public.deterministic_ranking_runs
   where user_id in (
     '05100000-0000-4000-8000-000000000001'::uuid,
     '05100000-0000-4000-8000-000000000002'::uuid
   )) as run_count,
  (select count(*)::integer
   from public.deterministic_ranking_items
   where user_id in (
     '05100000-0000-4000-8000-000000000001'::uuid,
     '05100000-0000-4000-8000-000000000002'::uuid
   )) as item_count;

set local role service_role;
create temp table phase_051_tombstone_call_1 on commit drop as
select * from public.enqueue_deterministic_new_jobs(25);
reset role;

set local role service_role;
create temp table phase_051_tombstone_call_2 on commit drop as
select * from public.enqueue_deterministic_new_jobs(25);
reset role;

select extensions.is(
  (select initialized_count from phase_051_tombstone_call_1), 0,
  'tombstone-only first enqueue initializes no run'
);
select extensions.is(
  (select seeded_count from phase_051_tombstone_call_1), 0,
  'tombstone-only first enqueue seeds no item'
);
select extensions.is(
  (select initialized_count from phase_051_tombstone_call_2), 0,
  'tombstone-only repeated enqueue initializes no run'
);
select extensions.is(
  (select seeded_count from phase_051_tombstone_call_2), 0,
  'tombstone-only repeated enqueue seeds no item'
);
select extensions.is(
  (select count(*)::integer
   from public.deterministic_ranking_runs
   where user_id in (
     '05100000-0000-4000-8000-000000000001'::uuid,
     '05100000-0000-4000-8000-000000000002'::uuid
   )),
  (select run_count from phase_051_pre_counts),
  'tombstone-only calls leave run count unchanged'
);
select extensions.is(
  (select count(*)::integer
   from public.deterministic_ranking_items
   where user_id in (
     '05100000-0000-4000-8000-000000000001'::uuid,
     '05100000-0000-4000-8000-000000000002'::uuid
   )),
  (select item_count from phase_051_pre_counts),
  'tombstone-only calls leave item count unchanged'
);
select extensions.is(
  (select count(*)::integer
   from public.deterministic_ranking_state
   where user_id in (
     '05100000-0000-4000-8000-000000000001'::uuid,
     '05100000-0000-4000-8000-000000000002'::uuid
   ) and status = 'idle' and building_run_id is null),
  2,
  'tombstone-only calls leave both owners idle'
);

-- Add one genuine arrival. Owner A has an exact matching tombstone. Owner B
-- has only cross-owner/different-source/different-external-id tombstones.
insert into public.jobs (
  id,
  source,
  external_id,
  title,
  location,
  absolute_url,
  fingerprint,
  status,
  first_seen_at,
  last_seen_at
)
values (
  '05100000-0000-4000-8000-000000000103'::uuid,
  'greenhouse',
  'phase-051-genuine-arrival',
  'Synthetic Genuine Arrival',
  'Chicago, IL',
  'https://example.invalid/phase-051-genuine-arrival',
  'phase-051-genuine-fingerprint',
  'open',
  clock_timestamp(),
  clock_timestamp()
);

insert into public.user_job_dismissals (user_id, source, external_id)
values
  (
    '05100000-0000-4000-8000-000000000001'::uuid,
    'greenhouse',
    'phase-051-genuine-arrival'
  ),
  (
    '05100000-0000-4000-8000-000000000002'::uuid,
    'lever',
    'phase-051-genuine-arrival'
  ),
  (
    '05100000-0000-4000-8000-000000000002'::uuid,
    'greenhouse',
    'phase-051-different-external-id'
  );

set local role service_role;
create temp table phase_051_genuine_call on commit drop as
select * from public.enqueue_deterministic_new_jobs(25);
reset role;

create temp table phase_051_new_run on commit drop as
select state.building_run_id as run_id
from public.deterministic_ranking_state as state
where state.user_id = '05100000-0000-4000-8000-000000000002'::uuid;

select extensions.is(
  (select initialized_count from phase_051_genuine_call), 1,
  'one genuine arrival initializes exactly one owner run'
);
select extensions.is(
  (select seeded_count from phase_051_genuine_call), 3,
  'the genuine run seeds the complete three-job owner snapshot'
);
select extensions.is(
  (select count(*)::integer
   from public.deterministic_ranking_runs
   where user_id in (
     '05100000-0000-4000-8000-000000000001'::uuid,
     '05100000-0000-4000-8000-000000000002'::uuid
   ) and run_kind = 'new_job'),
  1,
  'only one new_job run exists'
);
select extensions.is(
  (select count(*)::integer
   from public.deterministic_ranking_runs
   where user_id = '05100000-0000-4000-8000-000000000001'::uuid
     and run_kind = 'new_job'),
  0,
  'the exact matching owner tombstone suppresses qualification'
);
select extensions.is(
  (select count(*)::integer
   from public.deterministic_ranking_runs
   where user_id = '05100000-0000-4000-8000-000000000002'::uuid
     and run_kind = 'new_job'),
  1,
  'different identity tombstones do not suppress the affected owner'
);
select extensions.is(
  (select expected_job_count
   from public.deterministic_ranking_runs
   where id = (select run_id from phase_051_new_run)),
  3,
  'the genuine run retains full-snapshot expected count'
);
select extensions.is(
  (select count(*)::integer
   from public.deterministic_ranking_items
   where run_id = (select run_id from phase_051_new_run)),
  3,
  'the genuine run retains full-snapshot item construction'
);
select extensions.is(
  (select count(*)::integer
   from public.user_job_dismissals
   where (
     user_id = '05100000-0000-4000-8000-000000000001'::uuid
     and source = 'greenhouse'
     and external_id = 'phase-051-genuine-arrival'
   ) or (
     user_id = '05100000-0000-4000-8000-000000000002'::uuid
     and source = 'lever'
     and external_id = 'phase-051-genuine-arrival'
   ) or (
     user_id = '05100000-0000-4000-8000-000000000002'::uuid
     and source = 'greenhouse'
     and external_id = 'phase-051-different-external-id'
   )),
  3,
  'identity-isolation tombstones are present exactly as arranged'
);
select extensions.is(
  (select count(*)::integer
   from public.user_jobs
   where user_id = '05100000-0000-4000-8000-000000000002'::uuid
     and job_id = '05100000-0000-4000-8000-000000000103'::uuid),
  1,
  'different-source and different-external-id tombstones allow projection seed'
);
select extensions.is(
  (select count(*)::integer
   from public.user_jobs
   where user_id = '05100000-0000-4000-8000-000000000001'::uuid
     and job_id = '05100000-0000-4000-8000-000000000103'::uuid),
  0,
  'matching owner/source/external_id prevents projection seed'
);
select extensions.ok(
  (select state.status = 'building'
      and state.active_run_id = '05100000-0000-4000-8000-000000000202'::uuid
      and state.building_run_id = (select run_id from phase_051_new_run)
   from public.deterministic_ranking_state as state
   where state.user_id = '05100000-0000-4000-8000-000000000002'::uuid),
  'enqueue leaves the previous snapshot active while the new run builds'
);
select extensions.is(
  (select deterministic_revision
   from public.user_jobs
   where user_id = '05100000-0000-4000-8000-000000000002'::uuid
     and job_id = '05100000-0000-4000-8000-000000000103'::uuid),
  null::bigint,
  'the genuine arrival is not published before finalization'
);
select extensions.is(
  (select status
   from public.deterministic_ranking_state
   where user_id = '05100000-0000-4000-8000-000000000001'::uuid),
  'idle',
  'the tombstone-only owner remains idle during the genuine run'
);

update public.deterministic_ranking_items
set status = 'completed',
    attempts = 1,
    deterministic_eligible = true,
    deterministic_score = 80,
    deterministic_tier = 'Strong',
    deterministic_breakdown = '[
      {"key":"title","earned":1,"possible":1,"evidence":[]},
      {"key":"location","earned":1,"possible":1,"evidence":[]},
      {"key":"keywords","earned":1,"possible":1,"evidence":[]},
      {"key":"experience","earned":1,"possible":1,"evidence":[]},
      {"key":"recency","earned":1,"possible":1,"evidence":[]},
      {"key":"watchlist","earned":1,"possible":1,"evidence":[]}
    ]'::jsonb,
    completed_at = clock_timestamp()
where run_id = (select run_id from phase_051_new_run);

grant select on phase_051_new_run to service_role;
set local role service_role;
create temp table phase_051_finalize on commit drop as
select *
from public.finalize_deterministic_ranking_run(
  (select run_id from phase_051_new_run)
);
reset role;

select extensions.is(
  (select status from phase_051_finalize), 'completed',
  'the real migration-0052 finalizer completes the synthetic run'
);
select extensions.is(
  (select seeded_count from phase_051_finalize), 0,
  'the complete snapshot needs no finalizer-time seed'
);
select extensions.is(
  (select published from phase_051_finalize), true,
  'the real finalizer publishes atomically'
);
select extensions.ok(
  (select state.status = 'idle'
      and state.active_run_id = (select run_id from phase_051_new_run)
      and state.building_run_id is null
   from public.deterministic_ranking_state as state
   where state.user_id = '05100000-0000-4000-8000-000000000002'::uuid),
  'publication switches the active run and returns the owner to idle'
);
select extensions.is(
  (select count(*)::integer
   from public.user_jobs
   where user_id = '05100000-0000-4000-8000-000000000002'::uuid
     and deterministic_revision = 1
     and deterministic_eligible is true
     and deterministic_score = 80
     and deterministic_tier = 'Strong'),
  3,
  'publication promotes the complete full snapshot together'
);
select extensions.is(
  (select count(*)::integer
   from public.deterministic_ranking_items
   where run_id = (select run_id from phase_051_new_run)
     and status = 'completed'),
  3,
  'all genuine-run items are complete at publication'
);

set local role service_role;
create temp table phase_051_post_publication_call on commit drop as
select * from public.enqueue_deterministic_new_jobs(25);
reset role;

select extensions.is(
  (select initialized_count from phase_051_post_publication_call), 0,
  'post-publication enqueue initializes no extra run'
);
select extensions.is(
  (select seeded_count from phase_051_post_publication_call), 0,
  'post-publication enqueue seeds no extra item'
);
select extensions.is(
  (select count(*)::integer
   from public.deterministic_ranking_runs
   where user_id in (
     '05100000-0000-4000-8000-000000000001'::uuid,
     '05100000-0000-4000-8000-000000000002'::uuid
   ) and run_kind = 'new_job'),
  1,
  'post-publication enqueue leaves exactly one genuine new_job run'
);
select extensions.is(
  (select count(*)::integer
   from public.deterministic_ranking_items
   where user_id in (
     '05100000-0000-4000-8000-000000000001'::uuid,
     '05100000-0000-4000-8000-000000000002'::uuid
   )),
  6,
  'post-publication enqueue leaves item history unchanged'
);

select * from extensions.finish();
rollback;

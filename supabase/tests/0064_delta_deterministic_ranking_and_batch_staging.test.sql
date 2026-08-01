begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.no_plan();

select extensions.is(
  (select count(*)::integer
   from public.deterministic_ranking_job_changes
   where user_id in (
     '05100000-0000-4000-8000-000000006401'::uuid,
     '05100000-0000-4000-8000-000000006402'::uuid
   )),
  0,
  'delta fixtures do not survive a prior pgTAP invocation'
);

select extensions.ok(
  to_regclass('public.deterministic_ranking_job_changes') is not null,
  'private changed-job queue exists'
);
select extensions.ok(
  to_regprocedure('public.stage_deterministic_ranking_results(jsonb)') is not null,
  'set-based staging RPC exists'
);
select extensions.is(
  (select count(*)::integer
   from pg_catalog.pg_constraint as constraint_row
   where constraint_row.conname =
     'deterministic_ranking_items_job_input_revision_valid'
     and constraint_row.conrelid =
       'public.deterministic_ranking_items'::regclass),
  1,
  'ranking-item revision check exists by exact table and constraint identity'
);
select extensions.is(
  (select constraint_row.convalidated
   from pg_catalog.pg_constraint as constraint_row
   where constraint_row.conname =
     'deterministic_ranking_items_job_input_revision_valid'
     and constraint_row.conrelid =
       'public.deterministic_ranking_items'::regclass),
  false,
  'ranking-item revision check begins with historical validation deferred'
);
select extensions.is(
  (select count(*)::integer
   from pg_catalog.pg_constraint as constraint_row
   where constraint_row.conname = 'jobs_deterministic_input_revision_valid'
     and constraint_row.conrelid = 'public.jobs'::regclass),
  1,
  'jobs revision check exists by exact table and constraint identity'
);
select extensions.is(
  (select constraint_row.convalidated
   from pg_catalog.pg_constraint as constraint_row
   where constraint_row.conname = 'jobs_deterministic_input_revision_valid'
     and constraint_row.conrelid = 'public.jobs'::regclass),
  true,
  'jobs revision check remains immediately validated'
);
select extensions.ok(
  (select procedure.prosecdef
   from pg_catalog.pg_proc as procedure
   where procedure.oid =
     'public.stage_deterministic_ranking_results(jsonb)'::regprocedure),
  'set-based staging RPC is SECURITY DEFINER'
);
select extensions.ok(
  (select 'search_path=""' = any(coalesce(procedure.proconfig, '{}'::text[]))
   from pg_catalog.pg_proc as procedure
   where procedure.oid =
     'public.stage_deterministic_ranking_results(jsonb)'::regprocedure),
  'set-based staging RPC has an empty search path'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.stage_deterministic_ranking_results(jsonb)',
    'EXECUTE'
  ),
  'service_role can execute set-based staging'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.stage_deterministic_ranking_results(jsonb)',
    'EXECUTE'
  ),
  'authenticated cannot execute set-based staging'
);
select extensions.ok(
  not pg_catalog.has_table_privilege(
    'authenticated',
    'public.deterministic_ranking_job_changes',
    'SELECT'
  ),
  'authenticated cannot read the changed-job queue'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values
  (
    '00000000-0000-0000-0000-000000000000'::uuid,
    '05100000-0000-4000-8000-000000006401'::uuid,
    'authenticated', 'authenticated', 'delta-owner-a@example.invalid',
    'synthetic-not-a-login', clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    clock_timestamp(), clock_timestamp(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000'::uuid,
    '05100000-0000-4000-8000-000000006402'::uuid,
    'authenticated', 'authenticated', 'delta-owner-b@example.invalid',
    'synthetic-not-a-login', clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    clock_timestamp(), clock_timestamp(), '', '', '', ''
  );

insert into public.preferences (user_id)
values
  ('05100000-0000-4000-8000-000000006401'::uuid),
  ('05100000-0000-4000-8000-000000006402'::uuid);

insert into public.deterministic_ranking_runs (
  id, user_id, revision, run_kind, captured_titles, captured_locations,
  captured_include_keywords, captured_exclude_keywords,
  captured_title_exclude_keywords, captured_max_required_experience,
  captured_rubric, captured_good_threshold, captured_strong_threshold,
  evaluation_time, expected_job_count, status, completed_at
)
values
  (
    '05100000-0000-4000-8000-000000006411'::uuid,
    '05100000-0000-4000-8000-000000006401'::uuid,
    1, 'preferences', '{}', '{}', '{}', '{}', '{}', null,
    '{
      "strictTitle":30,"weakTitle":20,"preferredLocation":10,
      "recency":10,"watchlist":10,"experience":20,
      "includeKeywordSteps":{"one":3,"two":5,"three":10,"four":15,"fivePlus":20}
    }'::jsonb,
    50, 75, clock_timestamp(), 0, 'completed', clock_timestamp()
  ),
  (
    '05100000-0000-4000-8000-000000006412'::uuid,
    '05100000-0000-4000-8000-000000006402'::uuid,
    1, 'preferences', '{}', '{}', '{}', '{}', '{}', null,
    '{
      "strictTitle":30,"weakTitle":20,"preferredLocation":10,
      "recency":10,"watchlist":10,"experience":20,
      "includeKeywordSteps":{"one":3,"two":5,"three":10,"four":15,"fivePlus":20}
    }'::jsonb,
    50, 75, clock_timestamp(), 0, 'completed', clock_timestamp()
  );

insert into public.deterministic_ranking_state (
  user_id, active_revision, desired_revision, status, active_run_id,
  building_run_id
)
values
  (
    '05100000-0000-4000-8000-000000006401'::uuid,
    1, 1, 'idle', '05100000-0000-4000-8000-000000006411'::uuid, null
  ),
  (
    '05100000-0000-4000-8000-000000006402'::uuid,
    1, 1, 'idle', '05100000-0000-4000-8000-000000006412'::uuid, null
  );

select extensions.is(
  (select initialized_count
   from public.enqueue_deterministic_new_jobs(25)),
  0,
  'empty maintenance tick initializes no run'
);
select extensions.is(
  (select count(*)::integer
   from public.deterministic_ranking_job_changes
   where user_id in (
     '05100000-0000-4000-8000-000000006401'::uuid,
     '05100000-0000-4000-8000-000000006402'::uuid
   )),
  0,
  'migration install and empty ticks do not backfill the catalog queue'
);

insert into public.jobs (
  id, source, external_id, title, location, description_text, absolute_url,
  fingerprint, status, first_seen_at, last_seen_at
)
values
  (
    '05100000-0000-4000-8000-000000006421'::uuid,
    'greenhouse', 'delta-job-1', 'Delta Role One', 'Chicago, IL',
    'First delta fixture', 'https://example.invalid/delta-job-1',
    'delta-job-1-fingerprint', 'open', clock_timestamp(), clock_timestamp()
  ),
  (
    '05100000-0000-4000-8000-000000006422'::uuid,
    'greenhouse', 'delta-job-2', 'Delta Role Two', 'Chicago, IL',
    'Second delta fixture', 'https://example.invalid/delta-job-2',
    'delta-job-2-fingerprint', 'open', clock_timestamp(), clock_timestamp()
  );

select extensions.is(
  (select count(*)::integer
   from public.deterministic_ranking_job_changes
   where job_id in (
     '05100000-0000-4000-8000-000000006421'::uuid,
     '05100000-0000-4000-8000-000000006422'::uuid
   )),
  4,
  'two inserted jobs for two initialized owners create exactly N times M work'
);

update public.jobs
set absolute_url = 'https://example.invalid/delta-job-1?unrelated=1'
where id = '05100000-0000-4000-8000-000000006421'::uuid;

select extensions.is(
  (select sum(captured_job_revision)::integer
   from public.deterministic_ranking_job_changes
   where job_id = '05100000-0000-4000-8000-000000006421'::uuid),
  2,
  'updating an unrelated job column creates no new ranking revision'
);

update public.jobs
set title = 'Delta Role One Changed'
where id = '05100000-0000-4000-8000-000000006421'::uuid;

select extensions.is(
  (select count(*)::integer
   from public.deterministic_ranking_job_changes
   where job_id = '05100000-0000-4000-8000-000000006421'::uuid
     and captured_job_revision = 2),
  2,
  'one relevant update replaces exactly one queued row per initialized owner'
);

insert into public.user_job_dismissals (user_id, source, external_id)
values (
  '05100000-0000-4000-8000-000000006401'::uuid,
  'greenhouse',
  'delta-job-2'
);

select extensions.is(
  (select seeded_count from public.enqueue_deterministic_new_jobs(25)),
  3,
  'enqueue seeds only nondismissed queued owner-job memberships'
);
select extensions.is(
  (select count(*)::integer
   from public.deterministic_ranking_items as item
   join public.deterministic_ranking_runs as run on run.id = item.run_id
   where run.run_kind = 'new_job'
     and item.user_id = '05100000-0000-4000-8000-000000006401'::uuid
     and item.job_id = '05100000-0000-4000-8000-000000006422'::uuid),
  0,
  'dismissed owner/source/external_id identity is absent from run items'
);

select extensions.is(
  (select count(*)::integer
   from public.deterministic_ranking_runs
   where run_kind = 'new_job'
     and user_id in (
       '05100000-0000-4000-8000-000000006401'::uuid,
       '05100000-0000-4000-8000-000000006402'::uuid
     )),
  2,
  'one delta run is created per selected owner'
);

select extensions.throws_ok(
  $$update public.deterministic_ranking_items
    set job_input_revision = -1
    where id = (
      select item.id
      from public.deterministic_ranking_items as item
      join public.deterministic_ranking_runs as run on run.id = item.run_id
      where run.run_kind = 'new_job'
      order by item.id
      limit 1
    )$$,
  '23514',
  'new row for relation "deterministic_ranking_items" violates check constraint "deterministic_ranking_items_job_input_revision_valid"',
  'unvalidated ranking-item check rejects a negative update by exact constraint name'
);

update public.deterministic_ranking_items
set status = 'claimed', attempts = 1, claimed_at = clock_timestamp(),
    claimed_revision = revision
where run_id in (
  select id from public.deterministic_ranking_runs
  where run_kind = 'new_job'
    and user_id in (
      '05100000-0000-4000-8000-000000006401'::uuid,
      '05100000-0000-4000-8000-000000006402'::uuid
    )
);

select extensions.throws_ok(
  $$select public.stage_deterministic_ranking_results(
    jsonb_build_array(
      jsonb_build_object(
        'item_id', item.id,
        'revision', item.revision,
        'job_input_revision', job.deterministic_input_revision,
        'eligible', true,
        'score', 80,
        'tier', 'Strong',
        'breakdown', '[
          {"key":"title","earned":1,"possible":1,"evidence":[]},
          {"key":"location","earned":1,"possible":1,"evidence":[]},
          {"key":"keywords","earned":1,"possible":1,"evidence":[]},
          {"key":"experience","earned":1,"possible":1,"evidence":[]},
          {"key":"recency","earned":1,"possible":1,"evidence":[]},
          {"key":"watchlist","earned":1,"possible":1,"evidence":[]}
        ]'::jsonb,
        'filter_code', null,
        'filter_detail', null,
        'best_fit_resume_id', null,
        'runner_up_resume_id', null,
        'error_code', null
      ),
      jsonb_build_object(
        'item_id', item.id,
        'revision', item.revision,
        'job_input_revision', job.deterministic_input_revision,
        'eligible', true,
        'score', 80,
        'tier', 'Strong',
        'breakdown', '[]'::jsonb,
        'filter_code', null,
        'filter_detail', null,
        'best_fit_resume_id', null,
        'runner_up_resume_id', null,
        'error_code', null
      )
    )
  )
  from public.deterministic_ranking_items as item
  join public.jobs as job on job.id = item.job_id
  where item.status = 'claimed'
  limit 1$$,
  'duplicate_ranking_stage_item',
  'one invalid duplicate member rejects the entire batch'
);
select extensions.is(
  (select count(*)::integer
   from public.deterministic_ranking_items
   where status = 'completed'
     and user_id in (
       '05100000-0000-4000-8000-000000006401'::uuid,
       '05100000-0000-4000-8000-000000006402'::uuid
     )),
  0,
  'rejected batch stages no records'
);

select extensions.is(
  public.stage_deterministic_ranking_results((
    select jsonb_agg(jsonb_build_object(
      'item_id', item.id,
      'revision', item.revision,
      'job_input_revision', job.deterministic_input_revision,
      'eligible', true,
      'score', 80,
      'tier', 'Strong',
      'breakdown', '[
        {"key":"title","earned":1,"possible":1,"evidence":[]},
        {"key":"location","earned":1,"possible":1,"evidence":[]},
        {"key":"keywords","earned":1,"possible":1,"evidence":[]},
        {"key":"experience","earned":1,"possible":1,"evidence":[]},
        {"key":"recency","earned":1,"possible":1,"evidence":[]},
        {"key":"watchlist","earned":1,"possible":1,"evidence":[]}
      ]'::jsonb,
      'filter_code', null,
      'filter_detail', null,
      'best_fit_resume_id', null,
      'runner_up_resume_id', null,
      'error_code', null
    ) order by item.id)
    from public.deterministic_ranking_items as item
    join public.jobs as job on job.id = item.job_id
    where item.status = 'claimed'
      and item.user_id in (
        '05100000-0000-4000-8000-000000006401'::uuid,
        '05100000-0000-4000-8000-000000006402'::uuid
      )
  )),
  3,
  'one set-based call stages the complete claimed membership'
);

select extensions.is(
  (select (public.finalize_deterministic_ranking_run(id)).published
   from public.deterministic_ranking_runs
   where run_kind = 'new_job'
     and user_id = '05100000-0000-4000-8000-000000006401'::uuid),
  true,
  'complete owner A delta publishes atomically'
);
select extensions.is(
  (select (public.finalize_deterministic_ranking_run(id)).published
   from public.deterministic_ranking_runs
   where run_kind = 'new_job'
     and user_id = '05100000-0000-4000-8000-000000006402'::uuid),
  true,
  'complete owner B delta publishes atomically'
);
select extensions.is(
  (select count(*)::integer
   from public.user_jobs as user_job
   join public.jobs as job on job.id = user_job.job_id
   where user_job.user_id = '05100000-0000-4000-8000-000000006401'::uuid
     and job.source = 'greenhouse'
     and job.external_id = 'delta-job-2'
     and user_job.deterministic_revision is not null),
  0,
  'dismissed identity is absent from publication'
);
select extensions.is(
  (select count(*)::integer
   from public.deterministic_ranking_job_changes
   where user_id in (
     '05100000-0000-4000-8000-000000006401'::uuid,
     '05100000-0000-4000-8000-000000006402'::uuid
   )),
  1,
  'finalization removes only published matching queue revisions'
);
select extensions.is(
  (select initialized_count from public.enqueue_deterministic_new_jobs(25)),
  0,
  'repeated tick with only a dismissed queued identity creates no run'
);

insert into public.jobs (
  id, source, external_id, title, absolute_url, fingerprint, status,
  first_seen_at, last_seen_at
)
select
  ('05200000-0000-4000-8000-' || lpad(sequence::text, 12, '0'))::uuid,
  'greenhouse',
  'delta-backlog-' || sequence,
  'Delta Backlog Role ' || sequence,
  'https://example.invalid/delta-backlog-' || sequence,
  'delta-backlog-fingerprint-' || sequence,
  'open', clock_timestamp(), clock_timestamp()
from generate_series(1, 30) as sequence;

select extensions.is(
  (select seeded_count from public.enqueue_deterministic_new_jobs(25)),
  25,
  'one enqueue call seeds at most 25 owner-job rows'
);
select extensions.is(
  (select count(*)::integer
   from public.deterministic_ranking_items as item
   join public.deterministic_ranking_runs as run on run.id = item.run_id
   where run.run_kind = 'new_job'
     and run.status = 'building'),
  25,
  'hard enqueue bound is reflected in exact run membership'
);
select extensions.ok(
  (select count(*)
   from public.deterministic_ranking_job_changes as change
   join public.jobs as job on job.id = change.job_id
   join public.deterministic_ranking_state as state
     on state.user_id = change.user_id
   where job.external_id like 'delta-backlog-%'
     and state.status = 'idle') >= 25,
  'eligible backlog remains for the next natural tick'
);

-- Fail one delta run and prove authenticated retry copies only its membership.
update public.deterministic_ranking_items as item
set status = 'claimed', attempts = 1, claimed_at = clock_timestamp(),
    claimed_revision = item.revision
from public.deterministic_ranking_runs as run
where run.id = item.run_id
  and run.run_kind = 'new_job'
  and run.status = 'building';

select extensions.is(
  public.stage_deterministic_ranking_results((
    select jsonb_agg(jsonb_build_object(
      'item_id', item.id,
      'revision', item.revision,
      'job_input_revision', job.deterministic_input_revision,
      'eligible', case when row_number = 1 then null else true end,
      'score', case when row_number = 1 then null else 80 end,
      'tier', case when row_number = 1 then null else 'Strong' end,
      'breakdown', case when row_number = 1 then null else '[
        {"key":"title","earned":1,"possible":1,"evidence":[]},
        {"key":"location","earned":1,"possible":1,"evidence":[]},
        {"key":"keywords","earned":1,"possible":1,"evidence":[]},
        {"key":"experience","earned":1,"possible":1,"evidence":[]},
        {"key":"recency","earned":1,"possible":1,"evidence":[]},
        {"key":"watchlist","earned":1,"possible":1,"evidence":[]}
      ]'::jsonb end,
      'filter_code', null,
      'filter_detail', null,
      'best_fit_resume_id', null,
      'runner_up_resume_id', null,
      'error_code', case when row_number = 1 then 'ranking_item_failed' else null end
    ) order by item.id)
    from (
      select item.*, row_number() over (order by item.id) as row_number
      from public.deterministic_ranking_items as item
      join public.deterministic_ranking_runs as run on run.id = item.run_id
      where run.run_kind = 'new_job'
        and run.status = 'building'
    ) as item
    join public.jobs as job on job.id = item.job_id
  )),
  25,
  'evaluator failure is committed as one record in the same atomic batch'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', run.user_id, 'role', 'authenticated')::text,
  true
)
from public.deterministic_ranking_runs as run
where run.run_kind = 'new_job'
  and run.status = 'failed'
limit 1;

with retried as materialized (
  select run_id
  from public.retry_deterministic_ranking_run()
)
select set_config(
  'phase_05_1.delta_retry_run_id',
  (select retried.run_id::text from retried),
  true
);

select extensions.is(
  (select retry.expected_job_count
   from public.deterministic_ranking_runs as retry
   where retry.id = current_setting(
     'phase_05_1.delta_retry_run_id',
     true
   )::uuid),
  25,
  'failed delta retry preserves only the original bounded membership'
);
select extensions.is(
  (select count(*)::integer
   from public.deterministic_ranking_items as retry_item
   join public.deterministic_ranking_runs as retry
     on retry.id = retry_item.run_id
   where retry.id = current_setting(
     'phase_05_1.delta_retry_run_id',
     true
   )::uuid),
  25,
  'delta retry item count equals its failed source run'
);
select extensions.ok(
  not exists (
    select 1
    from public.deterministic_ranking_items as retry_item
    join public.deterministic_ranking_runs as retry
      on retry.id = retry_item.run_id
    join public.deterministic_ranking_items as source_item
      on source_item.run_id = retry.retry_of_run_id
      and source_item.job_id = retry_item.job_id
    where retry.run_kind = 'retry'
      and retry_item.job_input_revision is distinct from
        source_item.job_input_revision
  ),
  'delta retry preserves captured job-input revisions'
);

select * from extensions.finish();
rollback;

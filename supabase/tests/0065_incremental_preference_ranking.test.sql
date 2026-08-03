begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.no_plan();

select extensions.ok(
  to_regprocedure('public.enqueue_deterministic_preference_refreshes(integer)') is not null,
  'bounded preference refresh maintenance exists'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.enqueue_deterministic_preference_refreshes(integer)',
    'EXECUTE'
  ),
  'authenticated users cannot execute preference maintenance'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.enqueue_deterministic_preference_refreshes(integer)',
    'EXECUTE'
  ),
  'service role can execute preference maintenance'
);
select extensions.ok(
  public.deterministic_title_concepts_match('Finance Analyst', 'finance'),
  'finance matches a related title'
);
select extensions.ok(
  not public.deterministic_title_concepts_match('Software Engineer', 'finance'),
  'finance does not match an unrelated title'
);
select extensions.ok(
  public.deterministic_title_concepts_match('Product Manager', 'PM'),
  'selection mirrors configured title acronym expansion'
);
select extensions.ok(
  public.deterministic_title_concepts_match('Investments Analyst', 'investment'),
  'selection mirrors conservative title inflection matching'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values (
  '00000000-0000-0000-0000-000000000000'::uuid,
  '06500000-0000-4000-8000-000000000001'::uuid,
  'authenticated', 'authenticated', 'preference-delta@example.invalid',
  'synthetic-not-a-login', clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  clock_timestamp(), clock_timestamp(), '', '', '', ''
);

insert into public.preferences (
  user_id, titles, ranking_rubric, ranking_good_threshold,
  ranking_strong_threshold, desired_ranking_revision
)
values (
  '06500000-0000-4000-8000-000000000001'::uuid,
  array['Equity Research'],
  '{
    "strictTitle":30,"weakTitle":20,"preferredLocation":10,
    "recency":10,"watchlist":10,"experience":20,
    "includeKeywordSteps":{"one":3,"two":5,"three":10,"four":15,"fivePlus":20}
  }'::jsonb,
  50, 75, 1
);

insert into public.deterministic_ranking_runs (
  id, user_id, revision, run_kind,
  captured_titles, captured_locations, captured_include_keywords,
  captured_exclude_keywords, captured_title_exclude_keywords,
  captured_max_required_experience, captured_rubric,
  captured_good_threshold, captured_strong_threshold,
  evaluation_time, expected_job_count, status, completed_at
)
values (
  '06500000-0000-4000-8000-000000000011'::uuid,
  '06500000-0000-4000-8000-000000000001'::uuid,
  1, 'preferences', array['Equity Research'], '{}', '{}', '{}', '{}', null,
  '{
    "strictTitle":30,"weakTitle":20,"preferredLocation":10,
    "recency":10,"watchlist":10,"experience":20,
    "includeKeywordSteps":{"one":3,"two":5,"three":10,"four":15,"fivePlus":20}
  }'::jsonb,
  50, 75, clock_timestamp(), 2, 'completed', clock_timestamp()
);

insert into public.deterministic_ranking_state (
  user_id, active_revision, desired_revision, status, active_run_id
)
values (
  '06500000-0000-4000-8000-000000000001'::uuid,
  1, 1, 'idle', '06500000-0000-4000-8000-000000000011'::uuid
);

insert into public.jobs (
  id, source, external_id, title, location, description_text, absolute_url,
  fingerprint, status, first_seen_at, last_seen_at
)
values
  (
    '06500000-0000-4000-8000-000000000021'::uuid,
    'greenhouse', 'pref-finance', 'Finance Analyst', 'Chicago, IL',
    'Finance fixture', 'https://example.invalid/pref-finance',
    'pref-finance-fingerprint', 'open', clock_timestamp(), clock_timestamp()
  ),
  (
    '06500000-0000-4000-8000-000000000022'::uuid,
    'greenhouse', 'pref-software', 'Software Engineer', 'Chicago, IL',
    'Software fixture', 'https://example.invalid/pref-software',
    'pref-software-fingerprint', 'open', clock_timestamp(), clock_timestamp()
  );

delete from public.deterministic_ranking_job_changes
where user_id = '06500000-0000-4000-8000-000000000001'::uuid;

insert into public.user_jobs (
  user_id, job_id, deterministic_revision, deterministic_eligible,
  deterministic_score, deterministic_tier, deterministic_breakdown,
  deterministic_ranked_at, deterministic_evaluation_time
)
select
  '06500000-0000-4000-8000-000000000001'::uuid,
  job.id, 1, true, 80, 'Strong',
  '[
    {"key":"title","earned":30,"possible":30,"evidence":[]},
    {"key":"location","earned":10,"possible":10,"evidence":[]},
    {"key":"recency","earned":10,"possible":10,"evidence":[]},
    {"key":"watchlist","earned":0,"possible":10,"evidence":[]},
    {"key":"experience","earned":10,"possible":20,"evidence":[]},
    {"key":"keywords","earned":20,"possible":20,"evidence":[]}
  ]'::jsonb,
  clock_timestamp(), clock_timestamp()
from public.jobs as job
where job.id in (
  '06500000-0000-4000-8000-000000000021'::uuid,
  '06500000-0000-4000-8000-000000000022'::uuid
);

select set_config(
  'request.jwt.claims',
  '{"sub":"06500000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

with saved as materialized (
  select * from public.save_preferences_and_start_ranking(
    array['Equity Research', 'finance'], '{}', '{}', '{}', '{}', null,
    '{
      "strictTitle":30,"weakTitle":20,"preferredLocation":10,
      "recency":10,"watchlist":10,"experience":20,
      "includeKeywordSteps":{"one":3,"two":5,"three":10,"four":15,"fivePlus":20}
    }'::jsonb,
    50, 75
  )
)
select set_config('test.preference_run', saved.run_id::text, true)
from saved;

select extensions.is(
  (select seeded_count from public.save_preferences_and_start_ranking(
    array['Equity Research', 'finance'], '{}', '{}', '{}', '{}', null,
    '{
      "strictTitle":30,"weakTitle":20,"preferredLocation":10,
      "recency":10,"watchlist":10,"experience":20,
      "includeKeywordSteps":{"one":3,"two":5,"three":10,"four":15,"fivePlus":20}
    }'::jsonb,
    50, 75
  )),
  0,
  'repeated identical save coalesces with no synchronous seeds'
);
select extensions.is(
  (select count(*)::integer
   from public.deterministic_ranking_items
   where run_id = current_setting('test.preference_run')::uuid),
  0,
  'Save creates no synchronous ranking items'
);
select extensions.is(
  (select selection_mode
   from public.deterministic_ranking_runs
   where id = current_setting('test.preference_run')::uuid),
  'added_titles',
  'appended finance title selects additive mode'
);
select extensions.is(
  (select selection_titles
   from public.deterministic_ranking_runs
   where id = current_setting('test.preference_run')::uuid),
  array['finance'],
  'only the added title is stored for selection'
);
select extensions.is(
  (select active_revision
   from public.deterministic_ranking_state
   where user_id = '06500000-0000-4000-8000-000000000001'::uuid),
  1::bigint,
  'published revision remains visible while selection builds'
);
select extensions.is(
  (select count(*)::integer
   from public.user_jobs
   where user_id = '06500000-0000-4000-8000-000000000001'::uuid
     and deterministic_revision = 1),
  2,
  'both prior Dashboard rows remain at the active revision during Save'
);

select * from public.enqueue_deterministic_new_jobs(25);

select extensions.is(
  (select count(*)::integer
   from public.deterministic_ranking_items
   where run_id = current_setting('test.preference_run')::uuid),
  1,
  'asynchronous additive selection creates one related ranking item'
);
select extensions.is(
  (select job_id
   from public.deterministic_ranking_items
   where run_id = current_setting('test.preference_run')::uuid),
  '06500000-0000-4000-8000-000000000021'::uuid,
  'finance selection excludes the unrelated software job'
);

update public.deterministic_ranking_items
set status = 'completed',
    deterministic_eligible = true,
    deterministic_score = 85,
    deterministic_tier = 'Strong',
    deterministic_breakdown = '[
      {"key":"title","earned":30,"possible":30,"evidence":[]},
      {"key":"location","earned":10,"possible":10,"evidence":[]},
      {"key":"recency","earned":10,"possible":10,"evidence":[]},
      {"key":"watchlist","earned":0,"possible":10,"evidence":[]},
      {"key":"experience","earned":15,"possible":20,"evidence":[]},
      {"key":"keywords","earned":20,"possible":20,"evidence":[]}
    ]'::jsonb,
    completed_at = clock_timestamp()
where run_id = current_setting('test.preference_run')::uuid;

select extensions.ok(
  (select published
   from public.finalize_deterministic_ranking_run(
     current_setting('test.preference_run')::uuid
   )),
  'complete additive run publishes atomically'
);
select extensions.is(
  (select active_revision
   from public.deterministic_ranking_state
   where user_id = '06500000-0000-4000-8000-000000000001'::uuid),
  2::bigint,
  'publication advances the active revision only after completion'
);
select extensions.is(
  (select count(*)::integer
   from public.user_jobs
   where user_id = '06500000-0000-4000-8000-000000000001'::uuid
     and deterministic_revision = 2),
  2,
  'publication carries the unaffected software row forward'
);

with saved as materialized (
  select * from public.save_preferences_and_start_ranking(
    array['Equity Research', 'finance', 'bank'], '{}', '{}', '{}', '{}', null,
    '{
      "strictTitle":30,"weakTitle":20,"preferredLocation":10,
      "recency":10,"watchlist":10,"experience":20,
      "includeKeywordSteps":{"one":3,"two":5,"three":10,"four":15,"fivePlus":20}
    }'::jsonb,
    50, 75
  )
)
select set_config('test.superseded_run', saved.run_id::text, true)
from saved;

with saved as materialized (
  select * from public.save_preferences_and_start_ranking(
    array['Equity Research', 'finance', 'energy'], '{}', '{}', '{}', '{}', null,
    '{
      "strictTitle":30,"weakTitle":20,"preferredLocation":10,
      "recency":10,"watchlist":10,"experience":20,
      "includeKeywordSteps":{"one":3,"two":5,"three":10,"four":15,"fivePlus":20}
    }'::jsonb,
    50, 75
  )
)
select set_config('test.latest_run', saved.run_id::text, true)
from saved;

select extensions.is(
  (select status from public.deterministic_ranking_runs
   where id = current_setting('test.superseded_run')::uuid),
  'stale',
  'a newer save stales the superseded run'
);
select extensions.is(
  (select selection_titles from public.deterministic_ranking_runs
   where id = current_setting('test.latest_run')::uuid),
  array['energy'],
  'superseding save compares against active titles, not unfinished desired titles'
);

with saved as materialized (
  select * from public.save_preferences_and_start_ranking(
    array['Equity Research'], '{}', '{}', '{}', '{}', null,
    '{
      "strictTitle":30,"weakTitle":20,"preferredLocation":10,
      "recency":10,"watchlist":10,"experience":20,
      "includeKeywordSteps":{"one":3,"two":5,"three":10,"four":15,"fivePlus":20}
    }'::jsonb,
    50, 75
  )
)
select set_config('test.global_run', saved.run_id::text, true)
from saved;

select extensions.is(
  (select selection_mode from public.deterministic_ranking_runs
   where id = current_setting('test.global_run')::uuid),
  'all_open',
  'title removal uses the bounded all-candidate fallback'
);
select extensions.is(
  (select count(*)::integer from public.deterministic_ranking_items
   where run_id = current_setting('test.global_run')::uuid),
  0,
  'global fallback also performs no synchronous Save fan-out'
);

select * from public.enqueue_deterministic_new_jobs(25);

select extensions.is(
  (select count(*)::integer from public.deterministic_ranking_items
   where run_id = current_setting('test.global_run')::uuid),
  2,
  'bounded asynchronous global fallback materializes every open candidate'
);

select * from extensions.finish();
rollback;

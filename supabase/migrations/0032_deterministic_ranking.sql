-- Phase 03.4: additive deterministic ranking data plane.
--
-- The AI-era columns remain physically intact for rollback and forensics. New
-- results build in run-scoped staging and become browser-visible only when one
-- locked transaction promotes a complete current open-job universe.

create or replace function public.is_valid_ranking_text_array(
  value text[],
  maximum_items integer default 50
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select value is not null
    and maximum_items between 0 and 50
    and cardinality(value) <= maximum_items
    and array_position(value, null) is null
    and octet_length(array_to_json(value)::text) <= 4096
    and not exists (
      select 1
      from unnest(value) as entry
      where entry <> btrim(entry)
        or char_length(entry) not between 1 and 200
        or entry ~ '[[:cntrl:]]'
    );
$$;

revoke execute on function public.is_valid_ranking_text_array(text[], integer)
  from public, anon, authenticated;

create or replace function public.is_valid_ranking_rubric(value jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select jsonb_typeof(value) = 'object'
    and (
      select array_agg(key order by key)
      from jsonb_object_keys(value) as key
    ) = array[
      'experience',
      'includeKeywordSteps',
      'preferredLocation',
      'recency',
      'strictTitle',
      'watchlist',
      'weakTitle'
    ]::text[]
    and jsonb_typeof(value -> 'includeKeywordSteps') = 'object'
    and (
      select array_agg(key order by key)
      from jsonb_object_keys(value -> 'includeKeywordSteps') as key
    ) = array['fivePlus', 'four', 'one', 'three', 'two']::text[]
    and jsonb_path_match(
      value,
      '$.strictTitle.type() == "number" &&
       $.weakTitle.type() == "number" &&
       $.preferredLocation.type() == "number" &&
       $.recency.type() == "number" &&
       $.watchlist.type() == "number" &&
       $.experience.type() == "number" &&
       $.includeKeywordSteps.one.type() == "number" &&
       $.includeKeywordSteps.two.type() == "number" &&
       $.includeKeywordSteps.three.type() == "number" &&
       $.includeKeywordSteps.four.type() == "number" &&
       $.includeKeywordSteps.fivePlus.type() == "number"'
    )
    and (value ->> 'strictTitle')::numeric between 0 and 100
    and (value ->> 'strictTitle')::numeric = trunc((value ->> 'strictTitle')::numeric)
    and (value ->> 'weakTitle')::numeric between 0 and 100
    and (value ->> 'weakTitle')::numeric = trunc((value ->> 'weakTitle')::numeric)
    and (value ->> 'preferredLocation')::numeric between 0 and 100
    and (value ->> 'preferredLocation')::numeric =
      trunc((value ->> 'preferredLocation')::numeric)
    and (value ->> 'recency')::numeric between 0 and 100
    and (value ->> 'recency')::numeric = trunc((value ->> 'recency')::numeric)
    and (value ->> 'watchlist')::numeric between 0 and 100
    and (value ->> 'watchlist')::numeric = trunc((value ->> 'watchlist')::numeric)
    and (value ->> 'experience')::numeric between 0 and 100
    and (value ->> 'experience')::numeric = trunc((value ->> 'experience')::numeric)
    and (value #>> '{includeKeywordSteps,one}')::numeric between 0 and 100
    and (value #>> '{includeKeywordSteps,one}')::numeric =
      trunc((value #>> '{includeKeywordSteps,one}')::numeric)
    and (value #>> '{includeKeywordSteps,two}')::numeric between 0 and 100
    and (value #>> '{includeKeywordSteps,two}')::numeric =
      trunc((value #>> '{includeKeywordSteps,two}')::numeric)
    and (value #>> '{includeKeywordSteps,three}')::numeric between 0 and 100
    and (value #>> '{includeKeywordSteps,three}')::numeric =
      trunc((value #>> '{includeKeywordSteps,three}')::numeric)
    and (value #>> '{includeKeywordSteps,four}')::numeric between 0 and 100
    and (value #>> '{includeKeywordSteps,four}')::numeric =
      trunc((value #>> '{includeKeywordSteps,four}')::numeric)
    and (value #>> '{includeKeywordSteps,fivePlus}')::numeric between 0 and 100
    and (value #>> '{includeKeywordSteps,fivePlus}')::numeric =
      trunc((value #>> '{includeKeywordSteps,fivePlus}')::numeric)
    and (value ->> 'weakTitle')::integer <= (value ->> 'strictTitle')::integer
    and (value #>> '{includeKeywordSteps,one}')::integer
      <= (value #>> '{includeKeywordSteps,two}')::integer
    and (value #>> '{includeKeywordSteps,two}')::integer
      <= (value #>> '{includeKeywordSteps,three}')::integer
    and (value #>> '{includeKeywordSteps,three}')::integer
      <= (value #>> '{includeKeywordSteps,four}')::integer
    and (value #>> '{includeKeywordSteps,four}')::integer
      <= (value #>> '{includeKeywordSteps,fivePlus}')::integer
    and (value ->> 'strictTitle')::integer
      + (value ->> 'preferredLocation')::integer
      + (value ->> 'recency')::integer
      + (value ->> 'watchlist')::integer
      + (value ->> 'experience')::integer
      + (value #>> '{includeKeywordSteps,fivePlus}')::integer = 100;
$$;

revoke execute on function public.is_valid_ranking_rubric(jsonb)
  from public, anon, authenticated;

create or replace function public.is_valid_ranking_breakdown(value jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select jsonb_typeof(value) = 'array'
    and jsonb_array_length(value) = 6
    and (
      select array_agg(row_value ->> 'key' order by row_value ->> 'key')
      from jsonb_array_elements(value) as row_value
    ) = array[
      'experience', 'keywords', 'location', 'recency', 'title', 'watchlist'
    ]::text[]
    and not exists (
      select 1
      from jsonb_array_elements(value) as row_value
      where jsonb_typeof(row_value) <> 'object'
        or (
          select array_agg(key order by key)
          from jsonb_object_keys(row_value) as key
        ) <> array['earned', 'evidence', 'key', 'possible']::text[]
        or jsonb_typeof(row_value -> 'earned') <> 'number'
        or jsonb_typeof(row_value -> 'possible') <> 'number'
        or (row_value ->> 'earned')::numeric <> trunc((row_value ->> 'earned')::numeric)
        or (row_value ->> 'possible')::numeric <> trunc((row_value ->> 'possible')::numeric)
        or (row_value ->> 'earned')::integer not between 0 and 100
        or (row_value ->> 'possible')::integer not between 0 and 100
        or (row_value ->> 'earned')::integer > (row_value ->> 'possible')::integer
        or jsonb_typeof(row_value -> 'evidence') <> 'array'
        or jsonb_array_length(row_value -> 'evidence') > 50
        or octet_length((row_value -> 'evidence')::text) > 4096
        or exists (
          select 1
          from jsonb_array_elements(row_value -> 'evidence') as evidence
          where jsonb_typeof(evidence) <> 'string'
            or char_length(evidence #>> '{}') > 160
            or evidence #>> '{}' ~ '[[:cntrl:]]'
        )
    );
$$;

revoke execute on function public.is_valid_ranking_breakdown(jsonb)
  from public, anon, authenticated;

alter table public.preferences
  add column ranking_rubric jsonb not null default
    '{
      "strictTitle": 30,
      "weakTitle": 20,
      "preferredLocation": 10,
      "recency": 10,
      "watchlist": 10,
      "experience": 20,
      "includeKeywordSteps": {
        "one": 3,
        "two": 5,
        "three": 10,
        "four": 15,
        "fivePlus": 20
      }
    }'::jsonb,
  add column ranking_good_threshold integer not null default 50,
  add column ranking_strong_threshold integer not null default 75,
  add column desired_ranking_revision bigint not null default 0,
  add constraint preferences_ranking_rubric_valid
    check (public.is_valid_ranking_rubric(ranking_rubric)),
  add constraint preferences_ranking_thresholds_valid
    check (
      ranking_good_threshold > 0
      and ranking_good_threshold < ranking_strong_threshold
      and ranking_strong_threshold <= 100
    ),
  add constraint preferences_desired_ranking_revision_valid
    check (desired_ranking_revision >= 0),
  add constraint preferences_titles_deterministic_bounds
    check (public.is_valid_ranking_text_array(titles, 50)),
  add constraint preferences_locations_deterministic_bounds
    check (public.is_valid_ranking_text_array(locations, 50)),
  add constraint preferences_include_keywords_deterministic_bounds
    check (public.is_valid_ranking_text_array(include_keywords, 50)),
  add constraint preferences_exclude_keywords_deterministic_bounds
    check (public.is_valid_ranking_text_array(exclude_keywords, 50)),
  add constraint preferences_title_exclusions_deterministic_bounds
    check (public.is_valid_ranking_text_array(title_exclude_keywords, 50));

-- Preserve rolling compatibility for the old browser without allowing direct
-- writes to the rubric or revision. Plan 03 switches preference saves to the
-- authenticated transaction below.
revoke insert, update on table public.preferences from authenticated;
grant insert (
  user_id,
  titles,
  locations,
  include_keywords,
  exclude_keywords,
  title_exclude_keywords,
  max_required_experience,
  updated_at
) on table public.preferences to authenticated;
grant update (
  titles,
  locations,
  include_keywords,
  exclude_keywords,
  title_exclude_keywords,
  max_required_experience,
  updated_at
) on table public.preferences to authenticated;

create table public.deterministic_ranking_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  active_revision bigint not null default 0 check (active_revision >= 0),
  desired_revision bigint not null default 0
    check (desired_revision >= active_revision),
  status text not null default 'idle'
    check (status in ('idle', 'building', 'failed')),
  active_run_id uuid,
  building_run_id uuid,
  error_code text check (
    error_code is null
    or (
      char_length(error_code) between 1 and 80
      and error_code = btrim(error_code)
      and error_code ~ '^[a-z0-9_]+$'
    )
  ),
  retry_available boolean not null default false,
  route_refresh_requested_at timestamptz,
  updated_at timestamptz not null default clock_timestamp()
);

create table public.deterministic_ranking_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  revision bigint not null check (revision > 0),
  run_kind text not null check (
    run_kind in ('initial', 'preferences', 'retry', 'new_job', 'recency', 'route')
  ),
  is_initial boolean not null default false,
  retry_of_run_id uuid references public.deterministic_ranking_runs (id)
    on delete restrict,
  captured_titles text[] not null,
  captured_locations text[] not null,
  captured_include_keywords text[] not null,
  captured_exclude_keywords text[] not null,
  captured_title_exclude_keywords text[] not null,
  captured_max_required_experience integer check (
    captured_max_required_experience is null
    or captured_max_required_experience between 0 and 20
  ),
  captured_rubric jsonb not null
    check (public.is_valid_ranking_rubric(captured_rubric)),
  captured_good_threshold integer not null,
  captured_strong_threshold integer not null,
  evaluation_time timestamptz not null,
  expected_job_count integer not null default 0 check (expected_job_count >= 0),
  status text not null default 'building'
    check (status in ('building', 'completed', 'failed', 'stale')),
  error_code text check (
    error_code is null
    or (
      char_length(error_code) between 1 and 80
      and error_code = btrim(error_code)
      and error_code ~ '^[a-z0-9_]+$'
    )
  ),
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  check (is_initial = (run_kind = 'initial')),
  check (captured_good_threshold > 0),
  check (captured_good_threshold < captured_strong_threshold),
  check (captured_strong_threshold <= 100),
  check (public.is_valid_ranking_text_array(captured_titles, 50)),
  check (public.is_valid_ranking_text_array(captured_locations, 50)),
  check (public.is_valid_ranking_text_array(captured_include_keywords, 50)),
  check (public.is_valid_ranking_text_array(captured_exclude_keywords, 50)),
  check (public.is_valid_ranking_text_array(captured_title_exclude_keywords, 50))
);

create unique index deterministic_ranking_runs_initial_unique
  on public.deterministic_ranking_runs (user_id)
  where is_initial;
create unique index deterministic_ranking_runs_retry_unique
  on public.deterministic_ranking_runs (retry_of_run_id)
  where retry_of_run_id is not null;
create unique index deterministic_ranking_runs_preference_revision_unique
  on public.deterministic_ranking_runs (user_id, revision)
  where run_kind in ('initial', 'preferences');
create index deterministic_ranking_runs_user_created_idx
  on public.deterministic_ranking_runs (user_id, created_at desc);

alter table public.deterministic_ranking_state
  add constraint deterministic_ranking_state_active_run_fk
    foreign key (active_run_id)
    references public.deterministic_ranking_runs (id) on delete set null,
  add constraint deterministic_ranking_state_building_run_fk
    foreign key (building_run_id)
    references public.deterministic_ranking_runs (id) on delete set null;

create table public.deterministic_ranking_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.deterministic_ranking_runs (id)
    on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  user_job_id uuid not null references public.user_jobs (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  revision bigint not null check (revision > 0),
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts between 0 and 3),
  claimed_at timestamptz,
  claimed_revision bigint check (claimed_revision is null or claimed_revision > 0),
  deterministic_eligible boolean,
  deterministic_score integer check (
    deterministic_score is null or deterministic_score between 0 and 100
  ),
  deterministic_tier text check (
    deterministic_tier is null
    or deterministic_tier in ('Strong', 'Good', 'Weak')
  ),
  deterministic_breakdown jsonb check (
    deterministic_breakdown is null
    or public.is_valid_ranking_breakdown(deterministic_breakdown)
  ),
  deterministic_filter_code text check (
    deterministic_filter_code is null
    or deterministic_filter_code in (
      'excluded_title_keyword',
      'excluded_keyword',
      'outside_us',
      'title_non_overlap'
    )
  ),
  deterministic_filter_detail text check (
    deterministic_filter_detail is null
    or (
      char_length(deterministic_filter_detail) <= 160
      and deterministic_filter_detail !~ '[[:cntrl:]]'
    )
  ),
  deterministic_best_fit_resume_id uuid references public.resumes (id)
    on delete set null,
  deterministic_runner_up_resume_id uuid references public.resumes (id)
    on delete set null,
  error_code text check (
    error_code is null
    or (
      char_length(error_code) between 1 and 80
      and error_code = btrim(error_code)
      and error_code ~ '^[a-z0-9_]+$'
    )
  ),
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (run_id, user_job_id),
  check (
    status <> 'completed'
    or (
      deterministic_eligible is not null
      and deterministic_breakdown is not null
      and (
        (
          deterministic_eligible
          and deterministic_score is not null
          and deterministic_tier is not null
          and deterministic_filter_code is null
          and deterministic_filter_detail is null
        )
        or (
          not deterministic_eligible
          and deterministic_score is null
          and deterministic_tier is null
          and deterministic_filter_code is not null
        )
      )
    )
  )
);

create index deterministic_ranking_items_claim_idx
  on public.deterministic_ranking_items (status, claimed_at, created_at)
  where status in ('pending', 'claimed');
create index deterministic_ranking_items_run_idx
  on public.deterministic_ranking_items (run_id, status);

alter table public.user_jobs
  add column deterministic_revision bigint
    check (deterministic_revision is null or deterministic_revision > 0),
  add column deterministic_eligible boolean,
  add column deterministic_score integer
    check (deterministic_score is null or deterministic_score between 0 and 100),
  add column deterministic_tier text
    check (
      deterministic_tier is null
      or deterministic_tier in ('Strong', 'Good', 'Weak')
    ),
  add column deterministic_breakdown jsonb
    check (
      deterministic_breakdown is null
      or public.is_valid_ranking_breakdown(deterministic_breakdown)
    ),
  add column deterministic_filter_code text
    check (
      deterministic_filter_code is null
      or deterministic_filter_code in (
        'excluded_title_keyword',
        'excluded_keyword',
        'outside_us',
        'title_non_overlap'
      )
    ),
  add column deterministic_filter_detail text
    check (
      deterministic_filter_detail is null
      or (
        char_length(deterministic_filter_detail) <= 160
        and deterministic_filter_detail !~ '[[:cntrl:]]'
      )
    ),
  add column deterministic_ranked_at timestamptz,
  add column deterministic_evaluation_time timestamptz,
  add column deterministic_best_fit_resume_id uuid
    references public.resumes (id) on delete set null,
  add column deterministic_runner_up_resume_id uuid
    references public.resumes (id) on delete set null,
  add constraint user_jobs_deterministic_result_closed check (
    deterministic_revision is null
    or (
      deterministic_eligible is not null
      and deterministic_breakdown is not null
      and deterministic_ranked_at is not null
      and deterministic_evaluation_time is not null
      and (
        (
          deterministic_eligible
          and deterministic_score is not null
          and deterministic_tier is not null
          and deterministic_filter_code is null
          and deterministic_filter_detail is null
        )
        or (
          not deterministic_eligible
          and deterministic_score is null
          and deterministic_tier is null
          and deterministic_filter_code is not null
        )
      )
    )
  );

create index user_jobs_deterministic_feed_idx
  on public.user_jobs (user_id, deterministic_tier, deterministic_score desc)
  where deterministic_revision is not null and deterministic_eligible;

alter table public.deterministic_ranking_state enable row level security;
alter table public.deterministic_ranking_runs enable row level security;
alter table public.deterministic_ranking_items enable row level security;

revoke all on table public.deterministic_ranking_state
  from public, anon, authenticated;
revoke all on table public.deterministic_ranking_runs
  from public, anon, authenticated;
revoke all on table public.deterministic_ranking_items from public, anon, authenticated;
grant select on table public.deterministic_ranking_state to authenticated;
grant select on table public.deterministic_ranking_runs to authenticated;

create policy "deterministic_ranking_state_select_own"
  on public.deterministic_ranking_state
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "deterministic_ranking_runs_select_own"
  on public.deterministic_ranking_runs
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- Reassert service-only active result columns. Authenticated users retain only
-- lifecycle writes even after the ALTER TABLE additions.
revoke all on table public.user_jobs from anon, authenticated;
grant select on table public.user_jobs to authenticated;
grant update (seen_at, dismissed_at) on table public.user_jobs to authenticated;

create or replace function public.save_preferences_and_start_ranking(
  p_titles text[],
  p_locations text[],
  p_include_keywords text[],
  p_exclude_keywords text[],
  p_title_exclude_keywords text[],
  p_max_required_experience integer,
  p_ranking_rubric jsonb,
  p_good_threshold integer,
  p_strong_threshold integer
)
returns table (run_id uuid, revision bigint, seeded_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
  next_revision bigint;
  new_run_id uuid;
  seeded integer;
  evaluation_at timestamptz := clock_timestamp();
begin
  if owner_id is null then
    raise exception 'authentication_required';
  end if;
  if not public.is_valid_ranking_rubric(p_ranking_rubric) then
    raise exception 'invalid_ranking_rubric';
  end if;
  if p_good_threshold <= 0
    or p_good_threshold >= p_strong_threshold
    or p_strong_threshold > 100 then
    raise exception 'invalid_ranking_thresholds';
  end if;
  if not public.is_valid_ranking_text_array(p_titles, 50)
    or not public.is_valid_ranking_text_array(p_locations, 50)
    or not public.is_valid_ranking_text_array(p_include_keywords, 50)
    or not public.is_valid_ranking_text_array(p_exclude_keywords, 50)
    or not public.is_valid_ranking_text_array(p_title_exclude_keywords, 50)
    or (
      p_max_required_experience is not null
      and p_max_required_experience not between 0 and 20
    ) then
    raise exception 'invalid_ranking_preferences';
  end if;

  insert into public.preferences as preferences (
    user_id,
    titles,
    locations,
    include_keywords,
    exclude_keywords,
    title_exclude_keywords,
    max_required_experience,
    ranking_rubric,
    ranking_good_threshold,
    ranking_strong_threshold,
    desired_ranking_revision,
    updated_at
  ) values (
    owner_id,
    p_titles,
    p_locations,
    p_include_keywords,
    p_exclude_keywords,
    p_title_exclude_keywords,
    p_max_required_experience,
    p_ranking_rubric,
    p_good_threshold,
    p_strong_threshold,
    1,
    evaluation_at
  )
  on conflict (user_id) do update
  set titles = excluded.titles,
      locations = excluded.locations,
      include_keywords = excluded.include_keywords,
      exclude_keywords = excluded.exclude_keywords,
      title_exclude_keywords = excluded.title_exclude_keywords,
      max_required_experience = excluded.max_required_experience,
      ranking_rubric = excluded.ranking_rubric,
      ranking_good_threshold = excluded.ranking_good_threshold,
      ranking_strong_threshold = excluded.ranking_strong_threshold,
      desired_ranking_revision = preferences.desired_ranking_revision + 1,
      updated_at = excluded.updated_at
  returning desired_ranking_revision into next_revision;

  update public.deterministic_ranking_runs as run
  set status = 'stale',
      completed_at = evaluation_at
  where run.user_id = owner_id
    and run.status = 'building';

  insert into public.user_jobs (user_id, job_id)
  select owner_id, job.id
  from public.jobs as job
  where job.status = 'open'
  on conflict (user_id, job_id) do nothing;

  insert into public.deterministic_ranking_runs (
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
    expected_job_count
  )
  select
    owner_id,
    next_revision,
    'preferences',
    p_titles,
    p_locations,
    p_include_keywords,
    p_exclude_keywords,
    p_title_exclude_keywords,
    p_max_required_experience,
    p_ranking_rubric,
    p_good_threshold,
    p_strong_threshold,
    evaluation_at,
    count(*)::integer
  from public.user_jobs as user_job
  join public.jobs as job on job.id = user_job.job_id
  where user_job.user_id = owner_id
    and job.status = 'open'
  returning id into new_run_id;

  insert into public.deterministic_ranking_items (
    run_id, user_id, user_job_id, job_id, revision
  )
  select new_run_id, owner_id, user_job.id, user_job.job_id, next_revision
  from public.user_jobs as user_job
  join public.jobs as job on job.id = user_job.job_id
  where user_job.user_id = owner_id
    and job.status = 'open'
  on conflict (run_id, user_job_id) do nothing;
  get diagnostics seeded = row_count;

  insert into public.deterministic_ranking_state as state (
    user_id,
    active_revision,
    desired_revision,
    status,
    building_run_id,
    error_code,
    retry_available,
    updated_at
  ) values (
    owner_id,
    0,
    next_revision,
    'building',
    new_run_id,
    null,
    false,
    evaluation_at
  )
  on conflict (user_id) do update
  set desired_revision = excluded.desired_revision,
      status = 'building',
      building_run_id = excluded.building_run_id,
      error_code = null,
      retry_available = false,
      updated_at = excluded.updated_at;

  return query select new_run_id, next_revision, seeded;
end;
$$;

revoke execute on function public.save_preferences_and_start_ranking(
  text[], text[], text[], text[], text[], integer, jsonb, integer, integer
) from public, anon;
grant execute on function public.save_preferences_and_start_ranking(
  text[], text[], text[], text[], text[], integer, jsonb, integer, integer
) to authenticated;

create or replace function public.get_deterministic_ranking_state()
returns table (
  active_revision bigint,
  desired_revision bigint,
  status text,
  error_code text,
  retry_available boolean,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    state.active_revision,
    state.desired_revision,
    state.status,
    state.error_code,
    state.retry_available,
    state.updated_at
  from public.deterministic_ranking_state as state
  where state.user_id = (select auth.uid());
$$;

revoke execute on function public.get_deterministic_ranking_state()
  from public, anon;
grant execute on function public.get_deterministic_ranking_state()
  to authenticated;

create or replace function public.retry_deterministic_ranking_run()
returns table (run_id uuid, revision bigint, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
  failed_run public.deterministic_ranking_runs%rowtype;
  retry_run_id uuid;
  inserted boolean := false;
begin
  if owner_id is null then
    raise exception 'authentication_required';
  end if;

  select run.* into failed_run
  from public.deterministic_ranking_state as state
  join public.deterministic_ranking_runs as run
    on run.id = state.building_run_id
  where state.user_id = owner_id
    and state.status = 'failed'
    and state.retry_available
    and run.status = 'failed'
  for update of state, run;

  if not found then
    raise exception 'ranking_retry_unavailable';
  end if;

  insert into public.deterministic_ranking_runs (
    user_id,
    revision,
    run_kind,
    retry_of_run_id,
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
    expected_job_count
  ) values (
    owner_id,
    failed_run.revision,
    'retry',
    failed_run.id,
    failed_run.captured_titles,
    failed_run.captured_locations,
    failed_run.captured_include_keywords,
    failed_run.captured_exclude_keywords,
    failed_run.captured_title_exclude_keywords,
    failed_run.captured_max_required_experience,
    failed_run.captured_rubric,
    failed_run.captured_good_threshold,
    failed_run.captured_strong_threshold,
    failed_run.evaluation_time,
    failed_run.expected_job_count
  )
  on conflict (retry_of_run_id) where retry_of_run_id is not null do nothing
  returning id into retry_run_id;

  if retry_run_id is null then
    select run.id into retry_run_id
    from public.deterministic_ranking_runs as run
    where run.retry_of_run_id = failed_run.id;
  else
    inserted := true;
    insert into public.deterministic_ranking_items (
      run_id, user_id, user_job_id, job_id, revision
    )
    select
      retry_run_id,
      item.user_id,
      item.user_job_id,
      item.job_id,
      item.revision
    from public.deterministic_ranking_items as item
    where item.run_id = failed_run.id
    on conflict (run_id, user_job_id) do nothing;

    update public.deterministic_ranking_state as state
    set status = 'building',
        building_run_id = retry_run_id,
        error_code = null,
        retry_available = false,
        updated_at = clock_timestamp()
    where state.user_id = owner_id;
  end if;

  return query select retry_run_id, failed_run.revision, inserted;
end;
$$;

revoke execute on function public.retry_deterministic_ranking_run()
  from public, anon;
grant execute on function public.retry_deterministic_ranking_run()
  to authenticated;

create or replace function public.claim_deterministic_ranking_work(
  batch_size integer default 12
)
returns table (
  item_id uuid,
  run_id uuid,
  user_id uuid,
  user_job_id uuid,
  job_id uuid,
  revision bigint,
  evaluation_time timestamptz,
  captured_titles text[],
  captured_locations text[],
  captured_include_keywords text[],
  captured_exclude_keywords text[],
  captured_title_exclude_keywords text[],
  captured_max_required_experience integer,
  captured_rubric jsonb,
  captured_good_threshold integer,
  captured_strong_threshold integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if batch_size < 1 or batch_size > 25 then
    raise exception 'invalid_ranking_claim_batch';
  end if;

  return query
  with claimable as (
    select item.id
    from public.deterministic_ranking_items as item
    join public.deterministic_ranking_runs as run on run.id = item.run_id
    join public.deterministic_ranking_state as state
      on state.user_id = run.user_id
      and state.building_run_id = run.id
    where run.status = 'building'
      and item.attempts < 3
      and (
        item.status = 'pending'
        or (
          item.status = 'claimed'
          and item.claimed_at < clock_timestamp() - interval '5 minutes'
        )
      )
    order by item.created_at, item.id
    limit batch_size
    for update of item skip locked
  ),
  claimed as (
    update public.deterministic_ranking_items as item
    set status = 'claimed',
        attempts = item.attempts + 1,
        claimed_at = clock_timestamp(),
        claimed_revision = item.revision,
        error_code = null
    from claimable
    where item.id = claimable.id
    returning item.*
  )
  select
    claimed.id,
    claimed.run_id,
    claimed.user_id,
    claimed.user_job_id,
    claimed.job_id,
    claimed.revision,
    run.evaluation_time,
    run.captured_titles,
    run.captured_locations,
    run.captured_include_keywords,
    run.captured_exclude_keywords,
    run.captured_title_exclude_keywords,
    run.captured_max_required_experience,
    run.captured_rubric,
    run.captured_good_threshold,
    run.captured_strong_threshold
  from claimed
  join public.deterministic_ranking_runs as run on run.id = claimed.run_id;
end;
$$;

revoke execute on function public.claim_deterministic_ranking_work(integer)
  from public, anon, authenticated;
grant execute on function public.claim_deterministic_ranking_work(integer)
  to service_role;

create or replace function public.stage_deterministic_ranking_result(
  p_item_id uuid,
  p_revision bigint,
  p_eligible boolean,
  p_score integer,
  p_tier text,
  p_breakdown jsonb,
  p_filter_code text,
  p_filter_detail text,
  p_best_fit_resume_id uuid,
  p_runner_up_resume_id uuid,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  staged public.deterministic_ranking_items%rowtype;
  owning_run public.deterministic_ranking_runs%rowtype;
begin
  select item.* into staged
  from public.deterministic_ranking_items as item
  where item.id = p_item_id
  for update;

  if not found
    or staged.status <> 'claimed'
    or staged.claimed_revision <> p_revision
    or staged.revision <> p_revision then
    return false;
  end if;

  select run.* into owning_run
  from public.deterministic_ranking_runs as run
  where run.id = staged.run_id
  for update;

  if owning_run.status <> 'building'
    or owning_run.revision <> p_revision then
    return false;
  end if;

  if p_error_code is not null then
    if char_length(p_error_code) not between 1 and 80
      or p_error_code <> btrim(p_error_code)
      or p_error_code !~ '^[a-z0-9_]+$' then
      raise exception 'invalid_ranking_error';
    end if;

    update public.deterministic_ranking_items as item
    set status = 'failed',
        error_code = p_error_code,
        claimed_at = null,
        completed_at = clock_timestamp()
    where item.id = p_item_id;

    update public.deterministic_ranking_runs as run
    set status = 'failed',
        error_code = p_error_code,
        completed_at = clock_timestamp()
    where run.id = staged.run_id
      and run.status = 'building';

    update public.deterministic_ranking_state as state
    set status = 'failed',
        error_code = p_error_code,
        retry_available = owning_run.retry_of_run_id is null,
        updated_at = clock_timestamp()
    where state.user_id = staged.user_id
      and state.building_run_id = staged.run_id;
    return true;
  end if;

  if p_eligible is null
    or not public.is_valid_ranking_breakdown(p_breakdown)
    or (
      p_eligible
      and (
        p_score not between 0 and 100
        or p_tier not in ('Strong', 'Good', 'Weak')
        or p_filter_code is not null
        or p_filter_detail is not null
      )
    )
    or (
      not p_eligible
      and (
        p_score is not null
        or p_tier is not null
        or p_filter_code not in (
          'excluded_title_keyword',
          'excluded_keyword',
          'outside_us',
          'title_non_overlap'
        )
      )
    )
    or (
      p_filter_detail is not null
      and (
        char_length(p_filter_detail) > 160
        or p_filter_detail ~ '[[:cntrl:]]'
      )
    ) then
    raise exception 'invalid_ranking_result';
  end if;

  if p_best_fit_resume_id is not null and not exists (
    select 1 from public.resumes as resume
    where resume.id = p_best_fit_resume_id
      and resume.user_id = staged.user_id
  ) then
    raise exception 'invalid_ranking_resume';
  end if;
  if p_runner_up_resume_id is not null and not exists (
    select 1 from public.resumes as resume
    where resume.id = p_runner_up_resume_id
      and resume.user_id = staged.user_id
  ) then
    raise exception 'invalid_ranking_resume';
  end if;

  update public.deterministic_ranking_items as item
  set status = 'completed',
      deterministic_eligible = p_eligible,
      deterministic_score = p_score,
      deterministic_tier = p_tier,
      deterministic_breakdown = p_breakdown,
      deterministic_filter_code = p_filter_code,
      deterministic_filter_detail = p_filter_detail,
      deterministic_best_fit_resume_id = p_best_fit_resume_id,
      deterministic_runner_up_resume_id = p_runner_up_resume_id,
      error_code = null,
      claimed_at = null,
      completed_at = clock_timestamp()
  where item.id = p_item_id;
  return true;
end;
$$;

revoke execute on function public.stage_deterministic_ranking_result(
  uuid, bigint, boolean, integer, text, jsonb, text, text, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.stage_deterministic_ranking_result(
  uuid, bigint, boolean, integer, text, jsonb, text, text, uuid, uuid, text
) to service_role;

create or replace function public.finalize_deterministic_ranking_run(
  p_run_id uuid
)
returns table (status text, seeded_count integer, published boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.deterministic_ranking_runs%rowtype;
  state public.deterministic_ranking_state%rowtype;
  seeded integer := 0;
  open_count integer;
begin
  select ranking_state.* into state
  from public.deterministic_ranking_state as ranking_state
  join public.deterministic_ranking_runs as candidate
    on candidate.user_id = ranking_state.user_id
  where candidate.id = p_run_id
  for update of ranking_state;

  select candidate.* into run
  from public.deterministic_ranking_runs as candidate
  where candidate.id = p_run_id
  for update;

  if not found then
    raise exception 'ranking_run_not_found';
  end if;

  if run.status = 'failed' then
    update public.deterministic_ranking_state as ranking_state
    set status = 'failed',
        error_code = coalesce(run.error_code, 'ranking_item_failed'),
        retry_available = run.retry_of_run_id is null,
        updated_at = clock_timestamp()
    where ranking_state.user_id = run.user_id
      and ranking_state.building_run_id = run.id;
    return query select 'failed'::text, 0, false;
    return;
  end if;

  if run.status <> 'building'
    or state.building_run_id is distinct from run.id
    or state.desired_revision <> run.revision then
    update public.deterministic_ranking_runs as candidate
    set status = 'stale',
        completed_at = coalesce(candidate.completed_at, clock_timestamp())
    where candidate.id = run.id
      and candidate.status = 'building';
    return query select 'stale'::text, 0, false;
    return;
  end if;

  insert into public.user_jobs (user_id, job_id)
  select run.user_id, job.id
  from public.jobs as job
  where job.status = 'open'
  on conflict (user_id, job_id) do nothing;

  insert into public.deterministic_ranking_items (
    run_id, user_id, user_job_id, job_id, revision
  )
  select run.id, run.user_id, user_job.id, user_job.job_id, run.revision
  from public.user_jobs as user_job
  join public.jobs as job on job.id = user_job.job_id
  where user_job.user_id = run.user_id
    and job.status = 'open'
  on conflict (run_id, user_job_id) do nothing;
  get diagnostics seeded = row_count;

  select count(*)::integer into open_count
  from public.user_jobs as user_job
  join public.jobs as job on job.id = user_job.job_id
  where user_job.user_id = run.user_id
    and job.status = 'open';

  update public.deterministic_ranking_runs as candidate
  set expected_job_count = open_count
  where candidate.id = run.id;

  if seeded > 0 then
    return query select 'building'::text, seeded, false;
    return;
  end if;

  if exists (
    select 1
    from public.deterministic_ranking_items as item
    where item.run_id = run.id
      and item.status = 'failed'
  ) then
    update public.deterministic_ranking_runs as candidate
    set status = 'failed',
        error_code = coalesce(candidate.error_code, 'ranking_item_failed'),
        completed_at = clock_timestamp()
    where candidate.id = run.id;
    update public.deterministic_ranking_state as ranking_state
    set status = 'failed',
        error_code = 'ranking_item_failed',
        retry_available = run.retry_of_run_id is null,
        updated_at = clock_timestamp()
    where ranking_state.user_id = run.user_id
      and ranking_state.building_run_id = run.id;
    return query select 'failed'::text, 0, false;
    return;
  end if;

  if exists (
    select 1
    from public.deterministic_ranking_items as item
    where item.run_id = run.id
      and item.status <> 'completed'
  ) then
    return query select 'building'::text, 0, false;
    return;
  end if;

  update public.user_jobs as user_job
  set deterministic_revision = run.revision,
      deterministic_eligible = item.deterministic_eligible,
      deterministic_score = item.deterministic_score,
      deterministic_tier = item.deterministic_tier,
      deterministic_breakdown = item.deterministic_breakdown,
      deterministic_filter_code = item.deterministic_filter_code,
      deterministic_filter_detail = item.deterministic_filter_detail,
      deterministic_ranked_at = clock_timestamp(),
      deterministic_evaluation_time = run.evaluation_time,
      deterministic_best_fit_resume_id = item.deterministic_best_fit_resume_id,
      deterministic_runner_up_resume_id = item.deterministic_runner_up_resume_id
  from public.deterministic_ranking_items as item
  where item.run_id = run.id
    and item.user_job_id = user_job.id
    and item.status = 'completed';

  update public.deterministic_ranking_state as ranking_state
  set active_revision = run.revision,
      desired_revision = run.revision,
      status = 'idle',
      active_run_id = run.id,
      building_run_id = null,
      error_code = null,
      retry_available = false,
      route_refresh_requested_at = null,
      updated_at = clock_timestamp()
  where ranking_state.user_id = run.user_id
    and ranking_state.building_run_id = run.id;

  update public.deterministic_ranking_runs as candidate
  set status = 'completed',
      completed_at = clock_timestamp()
  where candidate.id = run.id;

  return query select 'completed'::text, 0, true;
end;
$$;

revoke execute on function public.finalize_deterministic_ranking_run(uuid)
  from public, anon, authenticated;
grant execute on function public.finalize_deterministic_ranking_run(uuid)
  to service_role;

create or replace function public.request_deterministic_route_refresh()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
  changed integer;
begin
  if owner_id is null then
    raise exception 'authentication_required';
  end if;
  update public.deterministic_ranking_state as state
  set route_refresh_requested_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where state.user_id = owner_id;
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

revoke execute on function public.request_deterministic_route_refresh()
  from public, anon;
grant execute on function public.request_deterministic_route_refresh()
  to authenticated;

create or replace function public.request_deterministic_route_refresh_for_user(
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  if p_user_id is null then
    raise exception 'invalid_ranking_owner';
  end if;
  update public.deterministic_ranking_state as state
  set route_refresh_requested_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where state.user_id = p_user_id;
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

revoke execute on function public.request_deterministic_route_refresh_for_user(uuid)
  from public, anon, authenticated;
grant execute on function public.request_deterministic_route_refresh_for_user(uuid)
  to service_role;

create or replace function public.enqueue_deterministic_new_jobs(
  batch_size integer default 25
)
returns table (initialized_count integer, seeded_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_state public.deterministic_ranking_state%rowtype;
  source_run public.deterministic_ranking_runs%rowtype;
  new_run_id uuid;
  initialized integer := 0;
  seeded integer := 0;
  added integer;
begin
  if batch_size < 1 or batch_size > 25 then
    raise exception 'invalid_ranking_enqueue_batch';
  end if;
  for owner_state in
    select state.*
    from public.deterministic_ranking_state as state
    where state.status = 'idle'
      and state.active_revision > 0
      and exists (
        select 1
        from public.jobs as job
        where job.status = 'open'
          and not exists (
            select 1
            from public.user_jobs as user_job
            where user_job.user_id = state.user_id
              and user_job.job_id = job.id
              and user_job.deterministic_revision = state.active_revision
          )
      )
    order by state.updated_at, state.user_id
    limit batch_size
    for update skip locked
  loop
    select run.* into source_run
    from public.deterministic_ranking_runs as run
    where run.id = owner_state.active_run_id
      and run.status = 'completed';
    if not found then
      continue;
    end if;

    insert into public.user_jobs (user_id, job_id)
    select owner_state.user_id, job.id
    from public.jobs as job
    where job.status = 'open'
    on conflict (user_id, job_id) do nothing;

    insert into public.deterministic_ranking_runs (
      user_id, revision, run_kind,
      captured_titles, captured_locations, captured_include_keywords,
      captured_exclude_keywords, captured_title_exclude_keywords,
      captured_max_required_experience, captured_rubric,
      captured_good_threshold, captured_strong_threshold,
      evaluation_time, expected_job_count
    )
    select
      source_run.user_id, source_run.revision, 'new_job',
      source_run.captured_titles, source_run.captured_locations,
      source_run.captured_include_keywords, source_run.captured_exclude_keywords,
      source_run.captured_title_exclude_keywords,
      source_run.captured_max_required_experience, source_run.captured_rubric,
      source_run.captured_good_threshold, source_run.captured_strong_threshold,
      clock_timestamp(), count(*)::integer
    from public.user_jobs as user_job
    join public.jobs as job on job.id = user_job.job_id
    where user_job.user_id = source_run.user_id
      and job.status = 'open'
    returning id into new_run_id;

    insert into public.deterministic_ranking_items (
      run_id, user_id, user_job_id, job_id, revision
    )
    select new_run_id, source_run.user_id, user_job.id, user_job.job_id,
      source_run.revision
    from public.user_jobs as user_job
    join public.jobs as job on job.id = user_job.job_id
    where user_job.user_id = source_run.user_id
      and job.status = 'open'
    on conflict (run_id, user_job_id) do nothing;
    get diagnostics added = row_count;
    seeded := seeded + added;
    initialized := initialized + 1;

    update public.deterministic_ranking_state as state
    set status = 'building',
        building_run_id = new_run_id,
        error_code = null,
        retry_available = false,
        updated_at = clock_timestamp()
    where state.user_id = source_run.user_id;
    if added = 0 then
      perform public.finalize_deterministic_ranking_run(new_run_id);
    end if;
  end loop;
  return query select initialized, seeded;
end;
$$;

revoke execute on function public.enqueue_deterministic_new_jobs(integer)
  from public, anon, authenticated;
grant execute on function public.enqueue_deterministic_new_jobs(integer)
  to service_role;

create or replace function public.enqueue_deterministic_recency_refresh(
  batch_size integer default 25
)
returns table (initialized_count integer, seeded_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_state public.deterministic_ranking_state%rowtype;
  source_run public.deterministic_ranking_runs%rowtype;
  new_run_id uuid;
  initialized integer := 0;
  seeded integer := 0;
  added integer;
begin
  if batch_size < 1 or batch_size > 25 then
    raise exception 'invalid_ranking_enqueue_batch';
  end if;
  for owner_state in
    select state.*
    from public.deterministic_ranking_state as state
    where state.status = 'idle'
      and state.active_revision > 0
      and exists (
        select 1
        from public.user_jobs as user_job
        join public.jobs as job on job.id = user_job.job_id
        where user_job.user_id = state.user_id
          and job.status = 'open'
          and user_job.deterministic_revision = state.active_revision
          and job.posted_at is not null
          and job.posted_at + interval '24 hours' <= clock_timestamp()
          and user_job.deterministic_evaluation_time
            < job.posted_at + interval '24 hours'
      )
    order by state.updated_at, state.user_id
    limit batch_size
    for update skip locked
  loop
    select run.* into source_run
    from public.deterministic_ranking_runs as run
    where run.id = owner_state.active_run_id
      and run.status = 'completed';
    if not found then
      continue;
    end if;

    insert into public.deterministic_ranking_runs (
      user_id, revision, run_kind,
      captured_titles, captured_locations, captured_include_keywords,
      captured_exclude_keywords, captured_title_exclude_keywords,
      captured_max_required_experience, captured_rubric,
      captured_good_threshold, captured_strong_threshold,
      evaluation_time, expected_job_count
    )
    select
      source_run.user_id, source_run.revision, 'recency',
      source_run.captured_titles, source_run.captured_locations,
      source_run.captured_include_keywords, source_run.captured_exclude_keywords,
      source_run.captured_title_exclude_keywords,
      source_run.captured_max_required_experience, source_run.captured_rubric,
      source_run.captured_good_threshold, source_run.captured_strong_threshold,
      clock_timestamp(), count(*)::integer
    from public.user_jobs as user_job
    join public.jobs as job on job.id = user_job.job_id
    where user_job.user_id = source_run.user_id
      and job.status = 'open'
    returning id into new_run_id;

    insert into public.deterministic_ranking_items (
      run_id, user_id, user_job_id, job_id, revision
    )
    select new_run_id, source_run.user_id, user_job.id, user_job.job_id,
      source_run.revision
    from public.user_jobs as user_job
    join public.jobs as job on job.id = user_job.job_id
    where user_job.user_id = source_run.user_id
      and job.status = 'open'
    on conflict (run_id, user_job_id) do nothing;
    get diagnostics added = row_count;
    seeded := seeded + added;
    initialized := initialized + 1;
    update public.deterministic_ranking_state as state
    set status = 'building',
        building_run_id = new_run_id,
        updated_at = clock_timestamp()
    where state.user_id = source_run.user_id;
    if added = 0 then
      perform public.finalize_deterministic_ranking_run(new_run_id);
    end if;
  end loop;
  return query select initialized, seeded;
end;
$$;

revoke execute on function public.enqueue_deterministic_recency_refresh(integer)
  from public, anon, authenticated;
grant execute on function public.enqueue_deterministic_recency_refresh(integer)
  to service_role;

create or replace function public.enqueue_deterministic_route_refreshes(
  batch_size integer default 25
)
returns table (initialized_count integer, seeded_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_state public.deterministic_ranking_state%rowtype;
  source_run public.deterministic_ranking_runs%rowtype;
  new_run_id uuid;
  initialized integer := 0;
  seeded integer := 0;
  added integer;
begin
  if batch_size < 1 or batch_size > 25 then
    raise exception 'invalid_ranking_enqueue_batch';
  end if;
  for owner_state in
    select state.*
    from public.deterministic_ranking_state as state
    where state.status = 'idle'
      and state.active_revision > 0
      and state.route_refresh_requested_at is not null
    order by state.route_refresh_requested_at, state.user_id
    limit batch_size
    for update skip locked
  loop
    select run.* into source_run
    from public.deterministic_ranking_runs as run
    where run.id = owner_state.active_run_id
      and run.status = 'completed';
    if not found then
      continue;
    end if;
    insert into public.deterministic_ranking_runs (
      user_id, revision, run_kind,
      captured_titles, captured_locations, captured_include_keywords,
      captured_exclude_keywords, captured_title_exclude_keywords,
      captured_max_required_experience, captured_rubric,
      captured_good_threshold, captured_strong_threshold,
      evaluation_time, expected_job_count
    )
    select
      source_run.user_id, source_run.revision, 'route',
      source_run.captured_titles, source_run.captured_locations,
      source_run.captured_include_keywords, source_run.captured_exclude_keywords,
      source_run.captured_title_exclude_keywords,
      source_run.captured_max_required_experience, source_run.captured_rubric,
      source_run.captured_good_threshold, source_run.captured_strong_threshold,
      source_run.evaluation_time, count(*)::integer
    from public.user_jobs as user_job
    join public.jobs as job on job.id = user_job.job_id
    where user_job.user_id = source_run.user_id
      and job.status = 'open'
    returning id into new_run_id;

    insert into public.deterministic_ranking_items (
      run_id, user_id, user_job_id, job_id, revision
    )
    select new_run_id, source_run.user_id, user_job.id, user_job.job_id,
      source_run.revision
    from public.user_jobs as user_job
    join public.jobs as job on job.id = user_job.job_id
    where user_job.user_id = source_run.user_id
      and job.status = 'open'
    on conflict (run_id, user_job_id) do nothing;
    get diagnostics added = row_count;
    seeded := seeded + added;
    initialized := initialized + 1;
    update public.deterministic_ranking_state as state
    set status = 'building',
        building_run_id = new_run_id,
        route_refresh_requested_at = null,
        updated_at = clock_timestamp()
    where state.user_id = source_run.user_id;
    if added = 0 then
      perform public.finalize_deterministic_ranking_run(new_run_id);
    end if;
  end loop;
  return query select initialized, seeded;
end;
$$;

revoke execute on function public.enqueue_deterministic_route_refreshes(integer)
  from public, anon, authenticated;
grant execute on function public.enqueue_deterministic_route_refreshes(integer)
  to service_role;

create or replace function public.initialize_deterministic_ranking_backfill(
  batch_size integer default 25
)
returns table (
  initialized_count integer,
  seeded_count integer,
  remaining_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_record record;
  preference_record public.preferences%rowtype;
  initial_run_id uuid;
  next_revision bigint;
  initialized integer := 0;
  seeded integer := 0;
  added integer;
  remaining integer;
begin
  if batch_size < 1 or batch_size > 25 then
    raise exception 'invalid_ranking_backfill_batch';
  end if;

  for owner_record in
    select user_account.id
    from auth.users as user_account
    where user_account.id in (
      select preference_owner.user_id from public.preferences as preference_owner
      union
      select job_owner.user_id from public.user_jobs as job_owner
    )
      and not exists (
        select 1
        from public.deterministic_ranking_runs as existing
        where existing.user_id = user_account.id
          and existing.is_initial
      )
    order by user_account.id
    limit batch_size
    for update skip locked
  loop
    insert into public.preferences (user_id)
    values (owner_record.id)
    on conflict (user_id) do nothing;

    select preference.* into preference_record
    from public.preferences as preference
    where preference.user_id = owner_record.id
    for update;

    next_revision := greatest(preference_record.desired_ranking_revision, 0) + 1;
    update public.preferences as preference
    set desired_ranking_revision = next_revision,
        updated_at = clock_timestamp()
    where preference.user_id = owner_record.id;

    insert into public.user_jobs (user_id, job_id)
    select owner_record.id, job.id
    from public.jobs as job
    where job.status = 'open'
    on conflict (user_id, job_id) do nothing;

    initial_run_id := null;
    insert into public.deterministic_ranking_runs (
      user_id, revision, run_kind, is_initial,
      captured_titles, captured_locations, captured_include_keywords,
      captured_exclude_keywords, captured_title_exclude_keywords,
      captured_max_required_experience, captured_rubric,
      captured_good_threshold, captured_strong_threshold,
      evaluation_time, expected_job_count
    )
    select
      owner_record.id, next_revision, 'initial', true,
      preference_record.titles, preference_record.locations,
      preference_record.include_keywords, preference_record.exclude_keywords,
      preference_record.title_exclude_keywords,
      preference_record.max_required_experience,
      preference_record.ranking_rubric,
      preference_record.ranking_good_threshold,
      preference_record.ranking_strong_threshold,
      clock_timestamp(), count(*)::integer
    from public.user_jobs as user_job
    join public.jobs as job on job.id = user_job.job_id
    where user_job.user_id = owner_record.id
      and job.status = 'open'
    on conflict (user_id) where is_initial do nothing
    returning id into initial_run_id;

    if initial_run_id is null then
      continue;
    end if;
    initialized := initialized + 1;

    insert into public.deterministic_ranking_items (
      run_id, user_id, user_job_id, job_id, revision
    )
    select initial_run_id, owner_record.id, user_job.id, user_job.job_id,
      next_revision
    from public.user_jobs as user_job
    join public.jobs as job on job.id = user_job.job_id
    where user_job.user_id = owner_record.id
      and job.status = 'open'
    on conflict (run_id, user_job_id) do nothing;
    get diagnostics added = row_count;
    seeded := seeded + added;

    insert into public.deterministic_ranking_state as state (
      user_id, active_revision, desired_revision, status, building_run_id,
      error_code, retry_available, updated_at
    ) values (
      owner_record.id, 0, next_revision, 'building', initial_run_id,
      null, false, clock_timestamp()
    )
    on conflict (user_id) do update
    set desired_revision = excluded.desired_revision,
        status = 'building',
        building_run_id = excluded.building_run_id,
        error_code = null,
        retry_available = false,
        updated_at = excluded.updated_at;

    -- Zero-job owners use the same locked finalizer and receive one complete
    -- active revision without inventing a synthetic item or publication path.
    if added = 0 then
      perform public.finalize_deterministic_ranking_run(initial_run_id);
    end if;
  end loop;

  select count(*)::integer into remaining
  from auth.users as user_account
  where user_account.id in (
    select preference_owner.user_id from public.preferences as preference_owner
    union
    select job_owner.user_id from public.user_jobs as job_owner
  )
    and not exists (
      select 1
      from public.deterministic_ranking_runs as existing
      where existing.user_id = user_account.id
        and existing.is_initial
    );

  return query select initialized, seeded, remaining;
end;
$$;

alter function public.initialize_deterministic_ranking_backfill(integer)
  owner to postgres;
revoke execute on function public.initialize_deterministic_ranking_backfill(integer)
  from public, anon, authenticated;
grant execute on function public.initialize_deterministic_ranking_backfill(integer)
  to service_role;

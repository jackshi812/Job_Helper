begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.deterministic_ranking_runs
  add column selection_mode text not null default 'eager'
    check (selection_mode in ('eager', 'all_open', 'added_titles')),
  add column selection_titles text[] not null default '{}'
    check (public.is_valid_ranking_text_array(selection_titles, 50)),
  add column selection_cursor uuid,
  add column selection_complete boolean not null default true,
  add constraint deterministic_ranking_runs_selection_shape check (
    (selection_mode = 'eager'
      and cardinality(selection_titles) = 0
      and selection_complete)
    or (selection_mode = 'all_open'
      and cardinality(selection_titles) = 0)
    or (selection_mode = 'added_titles'
      and cardinality(selection_titles) between 1 and 50)
  );

create or replace function public.deterministic_title_concepts(value text)
returns text[]
language plpgsql
immutable
strict
parallel safe
set search_path = ''
as $$
declare
  normalized text;
  token text;
  concepts text[] := '{}';
begin
  normalized := pg_catalog.btrim(pg_catalog.regexp_replace(
    pg_catalog.regexp_replace(
      pg_catalog.regexp_replace(pg_catalog.lower(value), '\([^)]*\)', ' ', 'g'),
      '[^a-z0-9 ]',
      ' ',
      'g'
    ),
    '[[:space:]]+',
    ' ',
    'g'
  ));
  if normalized = '' then return concepts; end if;

  foreach token in array pg_catalog.string_to_array(normalized, ' ')
  loop
    if token = any(array['of', 'the', 'and', 'a', 'an', 'for', 'to', 'in']) then
      continue;
    end if;
    concepts := concepts || case token
      when 'quant' then array['quantitative']
      when 'sr' then array['senior']
      when 'jr' then array['junior']
      when 'ml' then array['machine', 'learning']
      when 'swe' then array['software', 'engineer']
      when 'ds' then array['data', 'scientist']
      when 'eng' then array['engineer']
      when 'engr' then array['engineer']
      when 'mgr' then array['manager']
      when 'ba' then array['business', 'analyst']
      when 'pm' then array['product', 'manager']
      else array[token]
    end;
  end loop;
  return concepts;
end;
$$;

create or replace function public.deterministic_title_variants(token text)
returns text[]
language plpgsql
immutable
strict
parallel safe
set search_path = ''
as $$
declare
  variants text[] := array[token];
  base text;
begin
  if pg_catalog.right(token, 3) = 'ies' then
    base := pg_catalog.left(token, -3);
    if char_length(base) >= 3 then variants := variants || (base || 'y'); end if;
  end if;
  if pg_catalog.right(token, 1) = 's' then
    base := pg_catalog.left(token, -1);
    if char_length(base) >= 4 and pg_catalog.right(base, 2) <> 'ss' then
      variants := variants || base;
    end if;
  end if;
  if pg_catalog.right(token, 2) = 'er' then
    base := pg_catalog.left(token, -2);
    if char_length(base) >= 6 then variants := variants || base; end if;
  end if;
  if pg_catalog.right(token, 3) = 'ing' then
    base := pg_catalog.left(token, -3);
    if char_length(base) >= 6 then variants := variants || base; end if;
  end if;
  return variants;
end;
$$;

create or replace function public.deterministic_title_concepts_match(
  job_title text,
  preferred_title text
)
returns boolean
language plpgsql
immutable
strict
parallel safe
set search_path = ''
as $$
declare
  job_concepts text[] := public.deterministic_title_concepts(job_title);
  preferred_concepts text[] := public.deterministic_title_concepts(preferred_title);
  job_concept text;
  preferred_concept text;
  job_variants text[] := '{}';
  preferred_variants text[];
begin
  if cardinality(preferred_concepts) = 0 then return false; end if;
  foreach job_concept in array job_concepts loop
    job_variants := job_variants || public.deterministic_title_variants(job_concept);
  end loop;
  foreach preferred_concept in array preferred_concepts loop
    preferred_variants := public.deterministic_title_variants(preferred_concept);
    if not (preferred_variants && job_variants) then return false; end if;
  end loop;
  return true;
end;
$$;

revoke execute on function public.deterministic_title_concepts(text)
  from public, anon, authenticated;
revoke execute on function public.deterministic_title_variants(text)
  from public, anon, authenticated;
revoke execute on function public.deterministic_title_concepts_match(text, text)
  from public, anon, authenticated;

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
  prior_preferences public.preferences%rowtype;
  owner_state public.deterministic_ranking_state%rowtype;
  active_run public.deterministic_ranking_runs%rowtype;
  current_run public.deterministic_ranking_runs%rowtype;
  prior_preferences_found boolean := false;
  owner_state_found boolean := false;
  payload_matches_prior boolean := false;
  payload_matches_active boolean := false;
  next_revision bigint;
  new_run_id uuid;
  response_run_id uuid;
  response_revision bigint;
  superseded_run_id uuid;
  selection_kind text := 'all_open';
  added_titles text[] := '{}';
  evaluation_at timestamptz := clock_timestamp();
begin
  if owner_id is null then raise exception 'authentication_required'; end if;
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(owner_id::text, 0)
  );

  select preference.* into prior_preferences
  from public.preferences as preference
  where preference.user_id = owner_id
  for update;
  prior_preferences_found := found;

  select state.* into owner_state
  from public.deterministic_ranking_state as state
  where state.user_id = owner_id
  for update;
  owner_state_found := found;

  if owner_state_found and owner_state.active_run_id is not null then
    select candidate.* into active_run
    from public.deterministic_ranking_runs as candidate
    where candidate.id = owner_state.active_run_id
      and candidate.user_id = owner_id
      and candidate.status = 'completed';
  end if;

  payload_matches_prior := prior_preferences_found
    and prior_preferences.titles is not distinct from p_titles
    and prior_preferences.locations is not distinct from p_locations
    and prior_preferences.include_keywords is not distinct from p_include_keywords
    and prior_preferences.exclude_keywords is not distinct from p_exclude_keywords
    and prior_preferences.title_exclude_keywords
      is not distinct from p_title_exclude_keywords
    and prior_preferences.max_required_experience
      is not distinct from p_max_required_experience
    and prior_preferences.ranking_rubric is not distinct from p_ranking_rubric
    and prior_preferences.ranking_good_threshold
      is not distinct from p_good_threshold
    and prior_preferences.ranking_strong_threshold
      is not distinct from p_strong_threshold;

  if payload_matches_prior
    and owner_state_found
    and owner_state.status in ('idle', 'building')
    and (owner_state.active_revision > 0 or owner_state.building_run_id is not null)
  then
    response_run_id := coalesce(
      owner_state.building_run_id,
      owner_state.active_run_id
    );
    select candidate.revision into response_revision
    from public.deterministic_ranking_runs as candidate
    where candidate.id = response_run_id;
    return query select response_run_id, response_revision, 0;
    return;
  end if;

  payload_matches_active := active_run.id is not null
    and active_run.captured_titles is not distinct from p_titles
    and active_run.captured_locations is not distinct from p_locations
    and active_run.captured_include_keywords is not distinct from p_include_keywords
    and active_run.captured_exclude_keywords is not distinct from p_exclude_keywords
    and active_run.captured_title_exclude_keywords
      is not distinct from p_title_exclude_keywords
    and active_run.captured_max_required_experience
      is not distinct from p_max_required_experience
    and active_run.captured_rubric is not distinct from p_ranking_rubric
    and active_run.captured_good_threshold is not distinct from p_good_threshold
    and active_run.captured_strong_threshold is not distinct from p_strong_threshold;

  if active_run.id is not null
    and not payload_matches_active
    and active_run.captured_locations is not distinct from p_locations
    and active_run.captured_include_keywords is not distinct from p_include_keywords
    and active_run.captured_exclude_keywords is not distinct from p_exclude_keywords
    and active_run.captured_title_exclude_keywords
      is not distinct from p_title_exclude_keywords
    and active_run.captured_max_required_experience
      is not distinct from p_max_required_experience
    and active_run.captured_rubric is not distinct from p_ranking_rubric
    and active_run.captured_good_threshold is not distinct from p_good_threshold
    and active_run.captured_strong_threshold is not distinct from p_strong_threshold
    and cardinality(p_titles) > cardinality(active_run.captured_titles)
    and active_run.captured_titles = coalesce(
      p_titles[1:cardinality(active_run.captured_titles)],
      '{}'::text[]
    )
  then
    selection_kind := 'added_titles';
    added_titles := p_titles[
      cardinality(active_run.captured_titles) + 1:cardinality(p_titles)
    ];
  end if;

  insert into public.preferences as preference (
    user_id, titles, locations, include_keywords, exclude_keywords,
    title_exclude_keywords, max_required_experience, ranking_rubric,
    ranking_good_threshold, ranking_strong_threshold,
    desired_ranking_revision, updated_at
  ) values (
    owner_id, p_titles, p_locations, p_include_keywords, p_exclude_keywords,
    p_title_exclude_keywords, p_max_required_experience, p_ranking_rubric,
    p_good_threshold, p_strong_threshold, 1, evaluation_at
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
      desired_ranking_revision = preference.desired_ranking_revision + 1,
      updated_at = excluded.updated_at
  returning desired_ranking_revision into next_revision;

  superseded_run_id := case
    when owner_state_found then owner_state.building_run_id
    else null
  end;
  if superseded_run_id is not null then
    update public.deterministic_ranking_items as item
    set status = 'superseded',
        error_code = null,
        claimed_at = null,
        completed_at = evaluation_at
    where item.run_id = superseded_run_id
      and item.user_id = owner_id
      and item.status in ('pending', 'claimed');

    update public.deterministic_ranking_runs as candidate
    set status = 'stale',
        completed_at = coalesce(candidate.completed_at, evaluation_at)
    where candidate.id = superseded_run_id
      and candidate.user_id = owner_id
      and candidate.status = 'building';
  end if;

  if payload_matches_active then
    update public.deterministic_ranking_state as state
    set desired_revision = state.active_revision,
        status = 'idle',
        building_run_id = null,
        error_code = null,
        retry_available = false,
        updated_at = evaluation_at
    where state.user_id = owner_id;
    return query select active_run.id, active_run.revision, 0;
    return;
  end if;

  insert into public.deterministic_ranking_runs (
    user_id, revision, run_kind,
    captured_titles, captured_locations, captured_include_keywords,
    captured_exclude_keywords, captured_title_exclude_keywords,
    captured_max_required_experience, captured_rubric,
    captured_good_threshold, captured_strong_threshold,
    evaluation_time, expected_job_count,
    selection_mode, selection_titles, selection_cursor, selection_complete
  ) values (
    owner_id, next_revision, 'preferences',
    p_titles, p_locations, p_include_keywords,
    p_exclude_keywords, p_title_exclude_keywords,
    p_max_required_experience, p_ranking_rubric,
    p_good_threshold, p_strong_threshold,
    evaluation_at, 0,
    selection_kind, added_titles, null, false
  )
  returning id into new_run_id;

  insert into public.deterministic_ranking_state as state (
    user_id, active_revision, desired_revision, status,
    building_run_id, error_code, retry_available, updated_at
  ) values (
    owner_id, 0, next_revision, 'building',
    new_run_id, null, false, evaluation_at
  )
  on conflict (user_id) do update
  set desired_revision = excluded.desired_revision,
      status = 'building',
      building_run_id = excluded.building_run_id,
      error_code = null,
      retry_available = false,
      updated_at = excluded.updated_at;

  return query select new_run_id, next_revision, 0;
end;
$$;

alter function public.enqueue_deterministic_new_jobs(integer)
  rename to enqueue_deterministic_job_changes;

create or replace function public.enqueue_deterministic_preference_refreshes(
  batch_size integer default 25
)
returns table (initialized_count integer, seeded_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_state public.deterministic_ranking_state%rowtype;
  preference_run public.deterministic_ranking_runs%rowtype;
  scanned_job_ids uuid[];
  affected_job_ids uuid[];
  scanned_count integer := 0;
  added integer := 0;
  scan_limit integer := batch_size * 10;
  scan_finished boolean := false;
begin
  if batch_size < 1 or batch_size > 25 then
    raise exception 'invalid_ranking_enqueue_batch';
  end if;

  select state.* into owner_state
  from public.deterministic_ranking_state as state
  join public.deterministic_ranking_runs as candidate
    on candidate.id = state.building_run_id
    and candidate.user_id = state.user_id
  where state.status = 'building'
    and candidate.status = 'building'
    and candidate.selection_mode in ('all_open', 'added_titles')
    and not candidate.selection_complete
  order by state.updated_at, state.user_id
  limit 1
  for update of state skip locked;

  if not found then return query select 0, 0; return; end if;

  select candidate.* into preference_run
  from public.deterministic_ranking_runs as candidate
  where candidate.id = owner_state.building_run_id
    and candidate.user_id = owner_state.user_id
    and candidate.status = 'building'
  for update;
  if not found then return query select 0, 0; return; end if;

  select pg_catalog.array_agg(batch.id order by batch.id)
  into scanned_job_ids
  from (
    select job.id
    from public.jobs as job
    where job.status = 'open'
      and (
        preference_run.selection_cursor is null
        or job.id > preference_run.selection_cursor
      )
    order by job.id
    limit scan_limit
  ) as batch;
  scanned_count := coalesce(cardinality(scanned_job_ids), 0);
  scan_finished := scanned_count < scan_limit;

  if scanned_count > 0 then
    select pg_catalog.array_agg(job.id order by job.id)
    into affected_job_ids
    from public.jobs as job
    where job.id = any(scanned_job_ids)
      and job.status = 'open'
      and not exists (
        select 1
        from public.user_job_dismissals as dismissal
        where dismissal.user_id = owner_state.user_id
          and dismissal.source = job.source
          and dismissal.external_id = job.external_id
      )
      and (
        preference_run.selection_mode = 'all_open'
        or exists (
          select 1
          from unnest(preference_run.selection_titles) as added_title
          where public.deterministic_title_concepts_match(
            job.title,
            added_title
          )
        )
      );
  end if;

  if coalesce(cardinality(affected_job_ids), 0) > 0 then
    insert into public.user_jobs (user_id, job_id)
    select owner_state.user_id, job.id
    from public.jobs as job
    where job.id = any(affected_job_ids)
      and job.status = 'open'
      and not exists (
        select 1
        from public.user_job_dismissals as dismissal
        where dismissal.user_id = owner_state.user_id
          and dismissal.source = job.source
          and dismissal.external_id = job.external_id
      )
    on conflict (user_id, job_id) do nothing;

    insert into public.deterministic_ranking_items (
      run_id, user_id, user_job_id, job_id, revision, job_input_revision
    )
    select
      preference_run.id,
      owner_state.user_id,
      user_job.id,
      user_job.job_id,
      preference_run.revision,
      job.deterministic_input_revision
    from public.user_jobs as user_job
    join public.jobs as job on job.id = user_job.job_id
    where user_job.user_id = owner_state.user_id
      and user_job.job_id = any(affected_job_ids)
      and job.status = 'open'
      and not exists (
        select 1
        from public.user_job_dismissals as dismissal
        where dismissal.user_id = owner_state.user_id
          and dismissal.source = job.source
          and dismissal.external_id = job.external_id
      )
    on conflict on constraint
      deterministic_ranking_items_run_id_user_job_id_key
    do nothing;
    get diagnostics added = row_count;
  end if;

  update public.deterministic_ranking_runs as candidate
  set expected_job_count = candidate.expected_job_count + added,
      selection_cursor = case
        when scanned_count = 0 then candidate.selection_cursor
        else scanned_job_ids[scanned_count]
      end,
      selection_complete = scan_finished
  where candidate.id = preference_run.id
    and candidate.status = 'building';

  return query select 1, added;
end;
$$;

create or replace function public.enqueue_deterministic_new_jobs(
  batch_size integer default 25
)
returns table (initialized_count integer, seeded_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  initialized integer;
  seeded integer;
begin
  if batch_size < 1 or batch_size > 25 then
    raise exception 'invalid_ranking_enqueue_batch';
  end if;

  select refresh.initialized_count, refresh.seeded_count
  into initialized, seeded
  from public.enqueue_deterministic_preference_refreshes(batch_size) as refresh;
  if initialized > 0 then
    return query select initialized, seeded;
    return;
  end if;

  return query
  select changes.initialized_count, changes.seeded_count
  from public.enqueue_deterministic_job_changes(batch_size) as changes;
end;
$$;

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
  if owner_id is null then raise exception 'authentication_required'; end if;

  select candidate.* into failed_run
  from public.deterministic_ranking_state as state
  join public.deterministic_ranking_runs as candidate
    on candidate.id = state.building_run_id
  where state.user_id = owner_id
    and state.status = 'failed'
    and state.retry_available
    and candidate.status = 'failed'
  for update of state, candidate;
  if not found then raise exception 'ranking_retry_unavailable'; end if;

  insert into public.deterministic_ranking_runs (
    user_id, revision, run_kind, retry_of_run_id,
    captured_titles, captured_locations, captured_include_keywords,
    captured_exclude_keywords, captured_title_exclude_keywords,
    captured_max_required_experience, captured_rubric,
    captured_good_threshold, captured_strong_threshold,
    evaluation_time, expected_job_count,
    selection_mode, selection_titles, selection_cursor, selection_complete
  ) values (
    owner_id, failed_run.revision, 'retry', failed_run.id,
    failed_run.captured_titles, failed_run.captured_locations,
    failed_run.captured_include_keywords,
    failed_run.captured_exclude_keywords,
    failed_run.captured_title_exclude_keywords,
    failed_run.captured_max_required_experience, failed_run.captured_rubric,
    failed_run.captured_good_threshold, failed_run.captured_strong_threshold,
    failed_run.evaluation_time, failed_run.expected_job_count,
    failed_run.selection_mode, failed_run.selection_titles,
    failed_run.selection_cursor, failed_run.selection_complete
  )
  on conflict (retry_of_run_id) where retry_of_run_id is not null do nothing
  returning id into retry_run_id;

  if retry_run_id is null then
    select candidate.id into retry_run_id
    from public.deterministic_ranking_runs as candidate
    where candidate.retry_of_run_id = failed_run.id;
  else
    inserted := true;
    insert into public.deterministic_ranking_items (
      run_id, user_id, user_job_id, job_id, revision, job_input_revision
    )
    select
      retry_run_id, item.user_id, item.user_job_id, item.job_id,
      item.revision, item.job_input_revision
    from public.deterministic_ranking_items as item
    where item.run_id = failed_run.id
    on conflict on constraint
      deterministic_ranking_items_run_id_user_job_id_key
    do nothing;

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
  source_run public.deterministic_ranking_runs%rowtype;
  state public.deterministic_ranking_state%rowtype;
  is_delta_run boolean := false;
  is_bounded_preference_run boolean := false;
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
  if not found then raise exception 'ranking_run_not_found'; end if;

  source_run := run;
  if run.run_kind = 'retry' and run.retry_of_run_id is not null then
    select candidate.* into source_run
    from public.deterministic_ranking_runs as candidate
    where candidate.id = run.retry_of_run_id;
  end if;
  is_delta_run := source_run.run_kind = 'new_job';
  is_bounded_preference_run := source_run.run_kind = 'preferences'
    and run.selection_mode in ('all_open', 'added_titles');

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
    where candidate.id = run.id and candidate.status = 'building';
    return query select 'stale'::text, 0, false;
    return;
  end if;

  if is_bounded_preference_run and not run.selection_complete then
    return query select 'building'::text, 0, false;
    return;
  end if;

  if not is_delta_run and not is_bounded_preference_run then
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
    where user_job.user_id = run.user_id and job.status = 'open'
    on conflict (run_id, user_job_id) do nothing;
    get diagnostics seeded = row_count;

    select count(*)::integer into open_count
    from public.user_jobs as user_job
    join public.jobs as job on job.id = user_job.job_id
    where user_job.user_id = run.user_id and job.status = 'open';

    update public.deterministic_ranking_runs as candidate
    set expected_job_count = open_count
    where candidate.id = run.id;

    if seeded > 0 then
      return query select 'building'::text, seeded, false;
      return;
    end if;
  end if;

  if exists (
    select 1 from public.deterministic_ranking_items as item
    where item.run_id = run.id and item.status = 'failed'
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
    select 1 from public.deterministic_ranking_items as item
    where item.run_id = run.id and item.status <> 'completed'
  ) then
    return query select 'building'::text, 0, false;
    return;
  end if;

  if is_bounded_preference_run then
    update public.user_jobs as user_job
    set deterministic_revision = run.revision
    from public.jobs as job
    where user_job.user_id = run.user_id
      and user_job.job_id = job.id
      and job.status = 'open'
      and user_job.deterministic_revision = state.active_revision
      and not exists (
        select 1
        from public.user_job_dismissals as dismissal
        where dismissal.user_id = run.user_id
          and dismissal.source = job.source
          and dismissal.external_id = job.external_id
      );
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
      deterministic_evaluation_time = run.evaluation_time
  from public.deterministic_ranking_items as item
  join public.jobs as job on job.id = item.job_id
  where item.run_id = run.id
    and item.user_job_id = user_job.id
    and item.status = 'completed'
    and not exists (
      select 1
      from public.user_job_dismissals as dismissal
      where dismissal.user_id = item.user_id
        and dismissal.source = job.source
        and dismissal.external_id = job.external_id
    );

  if is_delta_run or is_bounded_preference_run then
    delete from public.deterministic_ranking_job_changes as change
    using public.deterministic_ranking_items as item,
          public.jobs as job
    where item.run_id = run.id
      and item.status = 'completed'
      and item.user_id = change.user_id
      and item.job_id = change.job_id
      and item.job_id = job.id
      and change.captured_job_revision = item.job_input_revision
      and not exists (
        select 1
        from public.user_job_dismissals as dismissal
        where dismissal.user_id = item.user_id
          and dismissal.source = job.source
          and dismissal.external_id = job.external_id
      );
  end if;

  update public.deterministic_ranking_state as ranking_state
  set active_revision = run.revision,
      desired_revision = run.revision,
      status = 'idle',
      active_run_id = run.id,
      building_run_id = null,
      error_code = null,
      retry_available = false,
      updated_at = clock_timestamp()
  where ranking_state.user_id = run.user_id
    and ranking_state.building_run_id = run.id;

  update public.deterministic_ranking_runs as candidate
  set status = 'completed', completed_at = clock_timestamp()
  where candidate.id = run.id;

  return query select 'completed'::text, 0, true;
end;
$$;

alter function public.deterministic_title_concepts(text) owner to postgres;
alter function public.deterministic_title_variants(text) owner to postgres;
alter function public.deterministic_title_concepts_match(text, text)
  owner to postgres;
alter function public.save_preferences_and_start_ranking(
  text[], text[], text[], text[], text[], integer, jsonb, integer, integer
) owner to postgres;
alter function public.enqueue_deterministic_job_changes(integer)
  owner to postgres;
alter function public.enqueue_deterministic_preference_refreshes(integer)
  owner to postgres;
alter function public.enqueue_deterministic_new_jobs(integer)
  owner to postgres;
alter function public.retry_deterministic_ranking_run() owner to postgres;
alter function public.finalize_deterministic_ranking_run(uuid)
  owner to postgres;

revoke execute on function public.save_preferences_and_start_ranking(
  text[], text[], text[], text[], text[], integer, jsonb, integer, integer
) from public, anon;
grant execute on function public.save_preferences_and_start_ranking(
  text[], text[], text[], text[], text[], integer, jsonb, integer, integer
) to authenticated;

revoke execute on function public.enqueue_deterministic_job_changes(integer)
  from public, anon, authenticated;
grant execute on function public.enqueue_deterministic_job_changes(integer)
  to service_role;
revoke execute on function public.enqueue_deterministic_preference_refreshes(integer)
  from public, anon, authenticated;
grant execute on function public.enqueue_deterministic_preference_refreshes(integer)
  to service_role;
revoke execute on function public.enqueue_deterministic_new_jobs(integer)
  from public, anon, authenticated;
grant execute on function public.enqueue_deterministic_new_jobs(integer)
  to service_role;

revoke execute on function public.retry_deterministic_ranking_run()
  from public, anon;
grant execute on function public.retry_deterministic_ranking_run()
  to authenticated;
revoke execute on function public.finalize_deterministic_ranking_run(uuid)
  from public, anon, authenticated;
grant execute on function public.finalize_deterministic_ranking_run(uuid)
  to service_role;

commit;

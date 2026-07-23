-- Forward-only deterministic ranking protocol gap closure.
-- Keeps 0032 immutable while repairing terminal leases, supersession, route
-- refresh acknowledgment, and transactional resume refresh signaling.

alter table public.deterministic_ranking_items
  drop constraint if exists deterministic_ranking_items_status_check;

alter table public.deterministic_ranking_items
  add constraint deterministic_ranking_items_status_check
  check (status in ('pending', 'claimed', 'completed', 'failed', 'superseded'));

create or replace function public.reap_expired_deterministic_ranking_leases(
  batch_size integer default 25
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  reaped integer := 0;
begin
  if batch_size < 1 or batch_size > 25 then
    raise exception 'invalid_ranking_reap_batch';
  end if;

  with expired as (
    select item.id
    from public.deterministic_ranking_items as item
    join public.deterministic_ranking_runs as run
      on run.id = item.run_id
    join public.deterministic_ranking_state as state
      on state.user_id = run.user_id
      and state.building_run_id = run.id
    where item.status = 'claimed'
      and item.attempts >= 3
      and item.claimed_at < clock_timestamp() - interval '5 minutes'
      and run.status = 'building'
      and state.status = 'building'
    order by item.claimed_at, item.id
    limit batch_size
    for update of item skip locked
  ),
  marked as (
    update public.deterministic_ranking_items as item
    set status = 'failed',
        error_code = 'ranking_lease_exhausted',
        claimed_at = null,
        completed_at = clock_timestamp()
    from expired
    where item.id = expired.id
    returning item.run_id
  ),
  failed_runs as (
    update public.deterministic_ranking_runs as run
    set status = 'failed',
        error_code = 'ranking_lease_exhausted',
        completed_at = clock_timestamp()
    where run.id in (select marked.run_id from marked)
      and run.status = 'building'
    returning run.id, run.user_id, run.retry_of_run_id
  ),
  failed_states as (
    update public.deterministic_ranking_state as state
    set status = 'failed',
        error_code = 'ranking_lease_exhausted',
        retry_available = failed_run.retry_of_run_id is null,
        updated_at = clock_timestamp()
    from failed_runs as failed_run
    where state.user_id = failed_run.user_id
      and state.building_run_id = failed_run.id
      and state.status = 'building'
    returning state.user_id
  )
  select count(*)::integer into reaped
  from marked;

  return reaped;
end;
$$;

revoke execute on function public.reap_expired_deterministic_ranking_leases(integer)
  from public, anon, authenticated;
grant execute on function public.reap_expired_deterministic_ranking_leases(integer)
  to service_role;

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
  superseded_run_id uuid;
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

  -- Serialize even a user's first save, before a state row exists. The
  -- owner-scoped state lock then coordinates with claims/finalization.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(owner_id::text, 0)
  );
  select state.building_run_id into superseded_run_id
  from public.deterministic_ranking_state as state
  where state.user_id = owner_id
  for update of state;

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

  if superseded_run_id is not null then
    update public.deterministic_ranking_items as item
    set status = 'superseded',
        error_code = null,
        claimed_at = null,
        completed_at = evaluation_at
    where item.run_id = superseded_run_id
      and item.user_id = owner_id
      and item.status in ('pending', 'claimed');

    update public.deterministic_ranking_runs as run
    set status = 'stale',
        completed_at = evaluation_at
    where run.id = superseded_run_id
      and run.user_id = owner_id
      and run.status = 'building';
  end if;

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
  on conflict on constraint
    deterministic_ranking_items_run_id_user_job_id_key
  do nothing;
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

  perform public.reap_expired_deterministic_ranking_leases(batch_size);

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
  observed_route_refresh_requested_at timestamptz;
  initialized integer := 0;
  seeded integer := 0;
  added integer;
  acknowledged integer;
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
    observed_route_refresh_requested_at :=
      owner_state.route_refresh_requested_at;

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

    update public.deterministic_ranking_state as state
    set status = 'building',
        building_run_id = new_run_id,
        route_refresh_requested_at = null,
        updated_at = clock_timestamp()
    where state.user_id = source_run.user_id
      and state.status = 'idle'
      and state.route_refresh_requested_at =
        observed_route_refresh_requested_at;
    get diagnostics acknowledged = row_count;

    if acknowledged = 0 then
      update public.deterministic_ranking_items as item
      set status = 'superseded',
          completed_at = clock_timestamp()
      where item.run_id = new_run_id
        and item.status in ('pending', 'claimed');
      update public.deterministic_ranking_runs as run
      set status = 'stale',
          completed_at = clock_timestamp()
      where run.id = new_run_id;
      continue;
    end if;

    seeded := seeded + added;
    initialized := initialized + 1;
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

create or replace function public.signal_deterministic_route_refresh_from_resume()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := coalesce(new.user_id, old.user_id);
begin
  if owner_id is not null then
    update public.deterministic_ranking_state as state
    set route_refresh_requested_at = clock_timestamp(),
        updated_at = clock_timestamp()
    where state.user_id = owner_id;
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.signal_deterministic_route_refresh_from_resume()
  from public, anon, authenticated;

drop trigger if exists resumes_signal_deterministic_route_refresh
  on public.resumes;
create trigger resumes_signal_deterministic_route_refresh
after insert or delete on public.resumes
for each row execute function
  public.signal_deterministic_route_refresh_from_resume();

alter function public.reap_expired_deterministic_ranking_leases(integer)
  owner to postgres;
alter function public.save_preferences_and_start_ranking(
  text[], text[], text[], text[], text[], integer, jsonb, integer, integer
) owner to postgres;
alter function public.claim_deterministic_ranking_work(integer)
  owner to postgres;
alter function public.stage_deterministic_ranking_result(
  uuid, bigint, boolean, integer, text, jsonb, text, text, uuid, uuid, text
) owner to postgres;
alter function public.finalize_deterministic_ranking_run(uuid)
  owner to postgres;
alter function public.enqueue_deterministic_route_refreshes(integer)
  owner to postgres;
alter function public.signal_deterministic_route_refresh_from_resume()
  owner to postgres;

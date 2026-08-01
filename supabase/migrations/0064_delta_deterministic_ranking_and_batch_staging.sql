begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.jobs
  add column deterministic_input_revision bigint not null default 0,
  add constraint jobs_deterministic_input_revision_valid
    check (deterministic_input_revision >= 0);

alter table public.deterministic_ranking_items
  add column job_input_revision bigint,
  add constraint deterministic_ranking_items_job_input_revision_valid
    check (job_input_revision is null or job_input_revision >= 0) not valid;

create table public.deterministic_ranking_job_changes (
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid not null references public.jobs (id)
    on delete cascade deferrable initially deferred,
  captured_job_revision bigint not null check (captured_job_revision > 0),
  queued_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, job_id)
);

create index deterministic_ranking_job_changes_bounded_idx
  on public.deterministic_ranking_job_changes (queued_at, user_id, job_id);

alter table public.deterministic_ranking_job_changes enable row level security;
revoke all on table public.deterministic_ranking_job_changes
  from public, anon, authenticated;

create or replace function public.capture_deterministic_ranking_job_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ranking_input_changed boolean := tg_op = 'INSERT';
begin
  if tg_op = 'UPDATE' then
    ranking_input_changed :=
      old.title is distinct from new.title
      or old.location is distinct from new.location
      or old.description_text is distinct from new.description_text
      or old.posted_at is distinct from new.posted_at
      or old.company_id is distinct from new.company_id
      or old.status is distinct from new.status
      or old.source is distinct from new.source
      or old.external_id is distinct from new.external_id;
  end if;

  if not ranking_input_changed then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.deterministic_input_revision := 1;
  else
    new.deterministic_input_revision :=
      old.deterministic_input_revision + 1;
  end if;

  insert into public.deterministic_ranking_job_changes as queued_change (
    user_id, job_id, captured_job_revision, queued_at, updated_at
  )
  select
    state.user_id,
    new.id,
    new.deterministic_input_revision,
    clock_timestamp(),
    clock_timestamp()
  from public.deterministic_ranking_state as state
  where state.active_revision > 0
    and state.active_run_id is not null
  on conflict (user_id, job_id) do update
  set captured_job_revision = greatest(
        queued_change.captured_job_revision,
        excluded.captured_job_revision
      ),
      queued_at = case
        when excluded.captured_job_revision
          > queued_change.captured_job_revision
        then excluded.queued_at
        else queued_change.queued_at
      end,
      updated_at = excluded.updated_at;

  return new;
end;
$$;

revoke all on function public.capture_deterministic_ranking_job_change()
  from public, anon, authenticated;

create trigger jobs_capture_deterministic_ranking_change
before insert or update of
  title,
  location,
  description_text,
  posted_at,
  company_id,
  status,
  source,
  external_id
on public.jobs
for each row execute function public.capture_deterministic_ranking_job_change();

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
  selected_job_ids uuid[];
  qualified_job_ids uuid[];
  remaining integer := batch_size;
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
      and state.active_run_id is not null
      and exists (
        select 1
        from public.deterministic_ranking_job_changes as change
        join public.jobs as job on job.id = change.job_id
        where change.user_id = state.user_id
          and change.captured_job_revision = job.deterministic_input_revision
          and job.status = 'open'
          and not exists (
            select 1
            from public.user_job_dismissals as dismissal
            where dismissal.user_id = state.user_id
              and dismissal.source = job.source
              and dismissal.external_id = job.external_id
          )
      )
    order by state.updated_at, state.user_id
    for update of state skip locked
  loop
    exit when remaining = 0;

    select array_agg(selected.job_id order by selected.queued_at, selected.job_id)
    into selected_job_ids
    from (
      select change.job_id, change.queued_at
      from public.deterministic_ranking_job_changes as change
      join public.jobs as job on job.id = change.job_id
      where change.user_id = owner_state.user_id
        and change.captured_job_revision = job.deterministic_input_revision
        and job.status = 'open'
        and not exists (
          select 1
          from public.user_job_dismissals as dismissal
          where dismissal.user_id = owner_state.user_id
            and dismissal.source = job.source
            and dismissal.external_id = job.external_id
        )
      order by change.queued_at, change.job_id
      limit remaining
      for update of change skip locked
    ) as selected;

    if coalesce(cardinality(selected_job_ids), 0) = 0 then
      continue;
    end if;

    -- Recheck lifecycle and permanent provider-identity tombstones after the
    -- queue rows have been selected and locked.
    select array_agg(job.id order by job.id)
    into qualified_job_ids
    from public.jobs as job
    where job.id = any(selected_job_ids)
      and job.status = 'open'
      and not exists (
        select 1
        from public.user_job_dismissals as dismissal
        where dismissal.user_id = owner_state.user_id
          and dismissal.source = job.source
          and dismissal.external_id = job.external_id
      );

    if coalesce(cardinality(qualified_job_ids), 0) = 0 then
      continue;
    end if;

    select run.* into source_run
    from public.deterministic_ranking_runs as run
    where run.id = owner_state.active_run_id
      and run.user_id = owner_state.user_id
      and run.status = 'completed';
    if not found then
      continue;
    end if;

    insert into public.user_jobs (user_id, job_id)
    select owner_state.user_id, job.id
    from public.jobs as job
    where job.id = any(qualified_job_ids)
      and job.status = 'open'
      and not exists (
        select 1
        from public.user_job_dismissals as dismissal
        where dismissal.user_id = owner_state.user_id
          and dismissal.source = job.source
          and dismissal.external_id = job.external_id
      )
    on conflict (user_id, job_id) do nothing;

    insert into public.deterministic_ranking_runs (
      user_id, revision, run_kind,
      captured_titles, captured_locations, captured_include_keywords,
      captured_exclude_keywords, captured_title_exclude_keywords,
      captured_max_required_experience, captured_rubric,
      captured_good_threshold, captured_strong_threshold,
      evaluation_time, expected_job_count
    ) values (
      source_run.user_id, source_run.revision, 'new_job',
      source_run.captured_titles, source_run.captured_locations,
      source_run.captured_include_keywords,
      source_run.captured_exclude_keywords,
      source_run.captured_title_exclude_keywords,
      source_run.captured_max_required_experience, source_run.captured_rubric,
      source_run.captured_good_threshold, source_run.captured_strong_threshold,
      clock_timestamp(), cardinality(qualified_job_ids)
    )
    returning id into new_run_id;

    insert into public.deterministic_ranking_items (
      run_id, user_id, user_job_id, job_id, revision, job_input_revision
    )
    select
      new_run_id,
      source_run.user_id,
      user_job.id,
      user_job.job_id,
      source_run.revision,
      change.captured_job_revision
    from public.user_jobs as user_job
    join public.deterministic_ranking_job_changes as change
      on change.user_id = user_job.user_id
      and change.job_id = user_job.job_id
    join public.jobs as job on job.id = user_job.job_id
    where user_job.user_id = source_run.user_id
      and user_job.job_id = any(qualified_job_ids)
      and change.captured_job_revision = job.deterministic_input_revision
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

    if added <> cardinality(qualified_job_ids) then
      raise exception 'delta_ranking_seed_incomplete';
    end if;

    update public.deterministic_ranking_state as state
    set status = 'building',
        building_run_id = new_run_id,
        error_code = null,
        retry_available = false,
        updated_at = clock_timestamp()
    where state.user_id = source_run.user_id
      and state.status = 'idle';

    if not found then
      raise exception 'delta_ranking_state_conflict';
    end if;

    initialized := initialized + 1;
    seeded := seeded + added;
    remaining := remaining - added;
  end loop;

  return query select initialized, seeded;
end;
$$;

create or replace function public.stage_deterministic_ranking_results(
  p_results jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  payload_count integer;
  staged_count integer;
begin
  if jsonb_typeof(p_results) <> 'array'
    or jsonb_array_length(p_results) not between 1 and 25 then
    raise exception 'invalid_ranking_stage_batch';
  end if;
  payload_count := jsonb_array_length(p_results);

  if exists (
    select 1
    from jsonb_array_elements(p_results) as payload
    where jsonb_typeof(payload) <> 'object'
      or (
        select array_agg(key order by key)
        from jsonb_object_keys(payload) as key
      ) <> array[
        'best_fit_resume_id',
        'breakdown',
        'eligible',
        'error_code',
        'filter_code',
        'filter_detail',
        'item_id',
        'job_input_revision',
        'revision',
        'runner_up_resume_id',
        'score',
        'tier'
      ]::text[]
      or jsonb_typeof(payload -> 'item_id') <> 'string'
      or (payload ->> 'item_id') !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or jsonb_typeof(payload -> 'revision') <> 'number'
      or (payload ->> 'revision')::numeric
        <> trunc((payload ->> 'revision')::numeric)
      or (payload ->> 'revision')::bigint <= 0
      or jsonb_typeof(payload -> 'job_input_revision') <> 'number'
      or (payload ->> 'job_input_revision')::numeric
        <> trunc((payload ->> 'job_input_revision')::numeric)
      or (payload ->> 'job_input_revision')::bigint < 0
      or jsonb_typeof(payload -> 'eligible') not in ('boolean', 'null')
      or jsonb_typeof(payload -> 'score') not in ('number', 'null')
      or jsonb_typeof(payload -> 'tier') not in ('string', 'null')
      or jsonb_typeof(payload -> 'breakdown') not in ('array', 'null')
      or jsonb_typeof(payload -> 'filter_code') not in ('string', 'null')
      or jsonb_typeof(payload -> 'filter_detail') not in ('string', 'null')
      or jsonb_typeof(payload -> 'best_fit_resume_id') not in ('string', 'null')
      or jsonb_typeof(payload -> 'runner_up_resume_id') not in ('string', 'null')
      or jsonb_typeof(payload -> 'error_code') not in ('string', 'null')
  ) then
    raise exception 'invalid_ranking_stage_record';
  end if;

  if (
    select count(distinct payload ->> 'item_id')
    from jsonb_array_elements(p_results) as payload
  ) <> payload_count then
    raise exception 'duplicate_ranking_stage_item';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_results) as payload(
      item_id uuid,
      revision bigint,
      job_input_revision bigint,
      eligible boolean,
      score integer,
      tier text,
      breakdown jsonb,
      filter_code text,
      filter_detail text,
      best_fit_resume_id uuid,
      runner_up_resume_id uuid,
      error_code text
    )
    where (
      payload.error_code is not null
      and (
        char_length(payload.error_code) not between 1 and 80
        or payload.error_code <> btrim(payload.error_code)
        or payload.error_code !~ '^[a-z0-9_]+$'
        or payload.eligible is not null
        or payload.score is not null
        or payload.tier is not null
        or payload.breakdown is not null
        or payload.filter_code is not null
        or payload.filter_detail is not null
        or payload.best_fit_resume_id is not null
        or payload.runner_up_resume_id is not null
      )
    ) or (
      payload.error_code is null
      and (
        payload.eligible is null
        or not public.is_valid_ranking_breakdown(payload.breakdown)
        or (
          payload.eligible
          and (
            payload.score not between 0 and 100
            or payload.tier not in ('Strong', 'Good', 'Weak')
            or payload.filter_code is not null
            or payload.filter_detail is not null
          )
        )
        or (
          not payload.eligible
          and (
            payload.score is not null
            or payload.tier is not null
            or payload.filter_code not in (
              'excluded_title_keyword',
              'excluded_keyword',
              'outside_us',
              'title_non_overlap'
            )
          )
        )
        or (
          payload.filter_detail is not null
          and (
            char_length(payload.filter_detail) > 160
            or payload.filter_detail ~ '[[:cntrl:]]'
          )
        )
        or (
          payload.best_fit_resume_id is not null
          and payload.runner_up_resume_id = payload.best_fit_resume_id
        )
      )
    )
  ) then
    raise exception 'invalid_ranking_result';
  end if;

  if (
    select count(*)
    from jsonb_to_recordset(p_results) as payload(
      item_id uuid,
      revision bigint,
      job_input_revision bigint,
      eligible boolean,
      score integer,
      tier text,
      breakdown jsonb,
      filter_code text,
      filter_detail text,
      best_fit_resume_id uuid,
      runner_up_resume_id uuid,
      error_code text
    )
    join public.deterministic_ranking_items as item
      on item.id = payload.item_id
    join public.deterministic_ranking_runs as run
      on run.id = item.run_id
    join public.deterministic_ranking_state as state
      on state.user_id = item.user_id
      and state.building_run_id = run.id
    join public.jobs as job on job.id = item.job_id
    where item.status = 'claimed'
      and item.claimed_revision = payload.revision
      and item.revision = payload.revision
      and run.status = 'building'
      and run.revision = payload.revision
      and state.status = 'building'
      and payload.job_input_revision <= job.deterministic_input_revision
      and (
        item.job_input_revision is null
        or payload.job_input_revision >= item.job_input_revision
      )
  ) <> payload_count then
    raise exception 'ranking_stage_stale';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_results) as payload(
      item_id uuid,
      revision bigint,
      job_input_revision bigint,
      eligible boolean,
      score integer,
      tier text,
      breakdown jsonb,
      filter_code text,
      filter_detail text,
      best_fit_resume_id uuid,
      runner_up_resume_id uuid,
      error_code text
    )
    join public.deterministic_ranking_items as item
      on item.id = payload.item_id
    left join public.resumes as best_fit
      on best_fit.id = payload.best_fit_resume_id
      and best_fit.user_id = item.user_id
    left join public.resumes as runner_up
      on runner_up.id = payload.runner_up_resume_id
      and runner_up.user_id = item.user_id
    where (payload.best_fit_resume_id is not null and best_fit.id is null)
      or (payload.runner_up_resume_id is not null and runner_up.id is null)
  ) then
    raise exception 'invalid_ranking_resume';
  end if;

  update public.deterministic_ranking_items as item
  set status = case
        when payload.error_code is null then 'completed'
        else 'failed'
      end,
      job_input_revision = payload.job_input_revision,
      deterministic_eligible = payload.eligible,
      deterministic_score = payload.score,
      deterministic_tier = payload.tier,
      deterministic_breakdown = payload.breakdown,
      deterministic_filter_code = payload.filter_code,
      deterministic_filter_detail = payload.filter_detail,
      deterministic_best_fit_resume_id = payload.best_fit_resume_id,
      deterministic_runner_up_resume_id = payload.runner_up_resume_id,
      error_code = payload.error_code,
      claimed_at = null,
      completed_at = clock_timestamp()
  from jsonb_to_recordset(p_results) as payload(
    item_id uuid,
    revision bigint,
    job_input_revision bigint,
    eligible boolean,
    score integer,
    tier text,
    breakdown jsonb,
    filter_code text,
    filter_detail text,
    best_fit_resume_id uuid,
    runner_up_resume_id uuid,
    error_code text
  )
  where item.id = payload.item_id
    and item.status = 'claimed'
    and item.claimed_revision = payload.revision
    and item.revision = payload.revision;
  get diagnostics staged_count = row_count;

  if staged_count <> payload_count then
    raise exception 'ranking_stage_incomplete';
  end if;

  with failed_runs as (
    select distinct item.run_id, item.user_id, payload.error_code
    from jsonb_to_recordset(p_results) as payload(
      item_id uuid,
      revision bigint,
      job_input_revision bigint,
      eligible boolean,
      score integer,
      tier text,
      breakdown jsonb,
      filter_code text,
      filter_detail text,
      best_fit_resume_id uuid,
      runner_up_resume_id uuid,
      error_code text
    )
    join public.deterministic_ranking_items as item
      on item.id = payload.item_id
    where payload.error_code is not null
  ),
  marked_runs as (
    update public.deterministic_ranking_runs as run
    set status = 'failed',
        error_code = failed_run.error_code,
        completed_at = clock_timestamp()
    from failed_runs as failed_run
    where run.id = failed_run.run_id
      and run.status = 'building'
    returning run.id, run.user_id, run.retry_of_run_id, run.error_code
  )
  update public.deterministic_ranking_state as state
  set status = 'failed',
      error_code = marked_run.error_code,
      retry_available = marked_run.retry_of_run_id is null,
      updated_at = clock_timestamp()
  from marked_runs as marked_run
  where state.user_id = marked_run.user_id
    and state.building_run_id = marked_run.id;

  return staged_count;
end;
$$;

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
  evaluated_job_revision bigint;
begin
  select job.deterministic_input_revision
  into evaluated_job_revision
  from public.deterministic_ranking_items as item
  join public.jobs as job on job.id = item.job_id
  where item.id = p_item_id;

  if not found then
    return false;
  end if;

  return public.stage_deterministic_ranking_results(
    jsonb_build_array(jsonb_build_object(
      'item_id', p_item_id,
      'revision', p_revision,
      'job_input_revision', evaluated_job_revision,
      'eligible', p_eligible,
      'score', p_score,
      'tier', p_tier,
      'breakdown', p_breakdown,
      'filter_code', p_filter_code,
      'filter_detail', p_filter_detail,
      'best_fit_resume_id', p_best_fit_resume_id,
      'runner_up_resume_id', p_runner_up_resume_id,
      'error_code', p_error_code
    ))
  ) = 1;
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
    user_id, revision, run_kind, retry_of_run_id,
    captured_titles, captured_locations, captured_include_keywords,
    captured_exclude_keywords, captured_title_exclude_keywords,
    captured_max_required_experience, captured_rubric,
    captured_good_threshold, captured_strong_threshold,
    evaluation_time, expected_job_count
  ) values (
    owner_id, failed_run.revision, 'retry', failed_run.id,
    failed_run.captured_titles, failed_run.captured_locations,
    failed_run.captured_include_keywords,
    failed_run.captured_exclude_keywords,
    failed_run.captured_title_exclude_keywords,
    failed_run.captured_max_required_experience, failed_run.captured_rubric,
    failed_run.captured_good_threshold, failed_run.captured_strong_threshold,
    failed_run.evaluation_time, failed_run.expected_job_count
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
      run_id, user_id, user_job_id, job_id, revision, job_input_revision
    )
    select
      retry_run_id,
      item.user_id,
      item.user_job_id,
      item.job_id,
      item.revision,
      item.job_input_revision
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
  state public.deterministic_ranking_state%rowtype;
  source_run_kind text;
  is_delta_run boolean := false;
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

  source_run_kind := run.run_kind;
  if run.run_kind = 'retry' and run.retry_of_run_id is not null then
    select source_run.run_kind into source_run_kind
    from public.deterministic_ranking_runs as source_run
    where source_run.id = run.retry_of_run_id;
  end if;
  is_delta_run := run.run_kind = 'new_job'
    or source_run_kind = 'new_job';

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

  if not is_delta_run then
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

  if is_delta_run then
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

alter function public.capture_deterministic_ranking_job_change()
  owner to postgres;
alter function public.enqueue_deterministic_new_jobs(integer)
  owner to postgres;
alter function public.stage_deterministic_ranking_results(jsonb)
  owner to postgres;
alter function public.stage_deterministic_ranking_result(
  uuid, bigint, boolean, integer, text, jsonb, text, text, uuid, uuid, text
) owner to postgres;
alter function public.retry_deterministic_ranking_run()
  owner to postgres;
alter function public.finalize_deterministic_ranking_run(uuid)
  owner to postgres;

revoke execute on function public.enqueue_deterministic_new_jobs(integer)
  from public, anon, authenticated;
grant execute on function public.enqueue_deterministic_new_jobs(integer)
  to service_role;

revoke execute on function public.stage_deterministic_ranking_results(jsonb)
  from public, anon, authenticated;
grant execute on function public.stage_deterministic_ranking_results(jsonb)
  to service_role;

revoke execute on function public.stage_deterministic_ranking_result(
  uuid, bigint, boolean, integer, text, jsonb, text, text, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.stage_deterministic_ranking_result(
  uuid, bigint, boolean, integer, text, jsonb, text, text, uuid, uuid, text
) to service_role;

revoke execute on function public.retry_deterministic_ranking_run()
  from public, anon;
grant execute on function public.retry_deterministic_ranking_run()
  to authenticated;

revoke execute on function public.finalize_deterministic_ranking_run(uuid)
  from public, anon, authenticated;
grant execute on function public.finalize_deterministic_ranking_run(uuid)
  to service_role;

commit;

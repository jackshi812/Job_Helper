-- Decouple inexpensive resume routing from deterministic ranking publication.

alter table public.deterministic_ranking_state
  add column resume_route_revision bigint not null default 1
    check (resume_route_revision > 0);

alter table public.user_jobs
  add column resume_route_revision bigint not null default 0
    check (resume_route_revision >= 0),
  add column resume_routed_at timestamptz;

update public.deterministic_ranking_state
set route_refresh_requested_at = null
where route_refresh_requested_at is not null;

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
  if owner_id is null then raise exception 'authentication_required'; end if;
  update public.deterministic_ranking_state as state
  set resume_route_revision = state.resume_route_revision + 1,
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
declare changed integer;
begin
  if p_user_id is null then raise exception 'invalid_ranking_owner'; end if;
  update public.deterministic_ranking_state as state
  set resume_route_revision = state.resume_route_revision + 1,
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

create or replace function public.enqueue_deterministic_route_refreshes(
  batch_size integer default 25
)
returns table (initialized_count integer, seeded_count integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if batch_size < 1 or batch_size > 25 then
    raise exception 'invalid_ranking_enqueue_batch';
  end if;
  return query select 0, 0;
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
declare owner_id uuid := coalesce(new.user_id, old.user_id);
begin
  if owner_id is not null then
    update public.deterministic_ranking_state as state
    set resume_route_revision = state.resume_route_revision + 1,
        updated_at = clock_timestamp()
    where state.user_id = owner_id;
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function public.signal_deterministic_route_refresh_from_resume()
  from public, anon, authenticated;

create or replace function public.signal_resume_route_from_ready_extract()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status is distinct from 'ready' and new.status = 'ready' then
    update public.deterministic_ranking_state as state
    set resume_route_revision = state.resume_route_revision + 1,
        updated_at = clock_timestamp()
    where state.user_id = new.user_id;
  end if;
  return new;
end;
$$;
revoke all on function public.signal_resume_route_from_ready_extract()
  from public, anon, authenticated;

drop trigger if exists resume_extracts_signal_resume_route on public.resume_extracts;
create trigger resume_extracts_signal_resume_route
after update of status, keywords on public.resume_extracts
for each row execute function public.signal_resume_route_from_ready_extract();

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
  if not found then raise exception 'ranking_run_not_found'; end if;

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
  set status = 'completed', completed_at = clock_timestamp()
  where candidate.id = run.id;
  return query select 'completed'::text, 0, true;
end;
$$;
revoke execute on function public.finalize_deterministic_ranking_run(uuid)
  from public, anon, authenticated;
grant execute on function public.finalize_deterministic_ranking_run(uuid)
  to service_role;

create or replace function public.publish_resume_route_page(
  p_user_id uuid,
  p_expected_revision bigint,
  p_routes jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_revision bigint;
  route_count integer;
  updated_count integer;
begin
  if p_user_id is null or p_expected_revision is null then
    raise exception 'invalid_resume_route_request';
  end if;
  if jsonb_typeof(p_routes) <> 'array'
    or jsonb_array_length(p_routes) not between 1 and 200 then
    raise exception 'invalid_resume_route_page';
  end if;

  select state.resume_route_revision into current_revision
  from public.deterministic_ranking_state as state
  where state.user_id = p_user_id
  for update;
  if not found then raise exception 'resume_route_state_not_found'; end if;
  if current_revision <> p_expected_revision then
    raise exception 'resume_route_revision_conflict';
  end if;

  select count(*)::integer into route_count from jsonb_array_elements(p_routes);
  if exists (
    select 1
    from jsonb_array_elements(p_routes) as route
    where jsonb_typeof(route) <> 'object'
      or (
        select array_agg(key order by key)
        from jsonb_object_keys(route) as key
      ) <> array[
        'best_fit_resume_id', 'runner_up_resume_id', 'user_job_id'
      ]::text[]
      or jsonb_typeof(route -> 'user_job_id') <> 'string'
      or (route ->> 'user_job_id') !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or jsonb_typeof(route -> 'best_fit_resume_id') not in ('string', 'null')
      or jsonb_typeof(route -> 'runner_up_resume_id') not in ('string', 'null')
      or (
        jsonb_typeof(route -> 'best_fit_resume_id') = 'string'
        and (route ->> 'best_fit_resume_id') !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
      or (
        jsonb_typeof(route -> 'runner_up_resume_id') = 'string'
        and (route ->> 'runner_up_resume_id') !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
      or (
        route ->> 'best_fit_resume_id' is not null
        and route ->> 'runner_up_resume_id' is not null
        and route ->> 'best_fit_resume_id' =
          route ->> 'runner_up_resume_id'
      )
  ) then
    raise exception 'invalid_resume_route_record';
  end if;
  if (
    select count(distinct (route ->> 'user_job_id'))
    from jsonb_array_elements(p_routes) as route
  ) <> route_count then
    raise exception 'duplicate_resume_route_job';
  end if;

  if (
    select count(*)
    from public.user_jobs as user_job
    join jsonb_array_elements(p_routes) as route
      on user_job.id = (route ->> 'user_job_id')::uuid
    where user_job.user_id = p_user_id
  ) <> route_count then
    raise exception 'resume_route_job_not_owned';
  end if;

  if exists (
    select 1
    from (
      select nullif(route ->> 'best_fit_resume_id', '')::uuid as resume_id
      from jsonb_array_elements(p_routes) as route
      union all
      select nullif(route ->> 'runner_up_resume_id', '')::uuid
      from jsonb_array_elements(p_routes) as route
    ) as requested
    left join public.resumes as resume
      on resume.id = requested.resume_id and resume.user_id = p_user_id
    left join public.resume_extracts as extract
      on extract.resume_id = requested.resume_id
      and extract.user_id = p_user_id
      and extract.status = 'ready'
    where requested.resume_id is not null
      and (resume.id is null or extract.resume_id is null)
  ) then
    raise exception 'resume_route_resume_not_ready';
  end if;

  update public.user_jobs as user_job
  set deterministic_best_fit_resume_id =
        nullif(route.best_fit_resume_id, '')::uuid,
      deterministic_runner_up_resume_id =
        nullif(route.runner_up_resume_id, '')::uuid,
      resume_route_revision = current_revision,
      resume_routed_at = clock_timestamp()
  from jsonb_to_recordset(p_routes) as route(
    user_job_id text,
    best_fit_resume_id text,
    runner_up_resume_id text
  )
  where user_job.id = route.user_job_id::uuid
    and user_job.user_id = p_user_id;
  get diagnostics updated_count = row_count;
  if updated_count <> route_count then
    raise exception 'resume_route_publish_incomplete';
  end if;
  return updated_count;
end;
$$;
revoke execute on function public.publish_resume_route_page(uuid, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.publish_resume_route_page(uuid, bigint, jsonb)
  to service_role;

-- Preserve the exact 0048 feed contract behind a same-signature wrapper and
-- attach only the two independent resume-routing revisions.
alter function public.dashboard_feed_page(
  text, text, text[], text[], text, jsonb, integer
) rename to dashboard_feed_page_v0048;

create function public.dashboard_feed_page(
  p_lifecycle text,
  p_order text,
  p_tiers text[],
  p_hidden_company_keys text[],
  p_query_signature text,
  p_cursor jsonb default null,
  p_limit integer default 200
)
returns table (row_data jsonb, cursor_data jsonb, has_more boolean)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'invalid_dashboard_limit';
  end if;
  return query
  select
    page.row_data || jsonb_build_object(
      'resume_route_revision', user_job.resume_route_revision,
      'current_resume_route_revision', ranking_state.resume_route_revision
    ),
    page.cursor_data,
    page.has_more
  from public.dashboard_feed_page_v0048(
    p_lifecycle, p_order, p_tiers, p_hidden_company_keys,
    p_query_signature, p_cursor, p_limit
  ) with ordinality as page(row_data, cursor_data, has_more, page_position)
  join public.user_jobs as user_job
    on user_job.id = (page.row_data ->> 'id')::uuid
  join public.deterministic_ranking_state as ranking_state
    on ranking_state.user_id = user_job.user_id
  where user_job.user_id = (select auth.uid())
  order by page.page_position;
end;
$$;
revoke execute on function public.dashboard_feed_page(
  text, text, text[], text[], text, jsonb, integer
) from public, anon;
grant execute on function public.dashboard_feed_page(
  text, text, text[], text[], text, jsonb, integer
) to authenticated;

alter function public.request_deterministic_route_refresh() owner to postgres;
alter function public.request_deterministic_route_refresh_for_user(uuid)
  owner to postgres;
alter function public.enqueue_deterministic_route_refreshes(integer)
  owner to postgres;
alter function public.signal_deterministic_route_refresh_from_resume()
  owner to postgres;
alter function public.signal_resume_route_from_ready_extract()
  owner to postgres;
alter function public.finalize_deterministic_ranking_run(uuid)
  owner to postgres;
alter function public.publish_resume_route_page(uuid, bigint, jsonb)
  owner to postgres;
alter function public.dashboard_feed_page(
  text, text, text[], text[], text, jsonb, integer
) owner to postgres;

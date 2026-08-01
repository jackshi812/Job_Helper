begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

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
          and not exists (
            select 1
            from public.user_job_dismissals as dismissal
            where dismissal.user_id = state.user_id
              and dismissal.source = job.source
              and dismissal.external_id = job.external_id
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

alter function public.enqueue_deterministic_new_jobs(integer)
  owner to postgres;
revoke execute on function public.enqueue_deterministic_new_jobs(integer)
  from public, anon, authenticated;
grant execute on function public.enqueue_deterministic_new_jobs(integer)
  to service_role;

commit;

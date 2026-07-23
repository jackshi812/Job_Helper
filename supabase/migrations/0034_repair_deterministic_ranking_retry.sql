-- Forward-only repair for the authenticated deterministic-ranking retry RPC.
--
-- Migration 0032 originally used an inferred ON CONFLICT target whose bare
-- `run_id` identifier collides with the function's RETURNS TABLE output
-- variable under PL/pgSQL. PostgreSQL therefore rejected every real retry with
-- 42702 before it could activate the replacement run.

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

revoke execute on function public.retry_deterministic_ranking_run()
  from public, anon;
grant execute on function public.retry_deterministic_ranking_run()
  to authenticated;

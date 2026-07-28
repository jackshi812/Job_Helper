begin;

-- AUTH-03 scope decision (owner accepted 2026-07-28):
-- companies and raw provider jobs are shared system data for the two invited
-- accounts. Preferences, resumes, ranking state/results, dismissals, and
-- tracker records remain private owner data.
--
-- Scan the complete owner feed until the requested number of in-scope rows is
-- found. Source and tracker filters therefore run before the outward page
-- boundary instead of leaving a misleading empty Watchlist page.
create function public.dashboard_feed_page_v2(
  p_lifecycle text,
  p_order text,
  p_tiers text[],
  p_hidden_company_keys text[],
  p_query_signature text,
  p_source_scope text,
  p_cursor jsonb default null,
  p_limit integer default 200
)
returns table (row_data jsonb, cursor_data jsonb, has_more boolean)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
  scan_cursor jsonb := p_cursor;
  candidate record;
  accepted_rows jsonb[] := array[]::jsonb[];
  accepted_cursors jsonb[] := array[]::jsonb[];
  accepted_count integer := 0;
  target_count integer;
  base_has_more boolean := true;
  base_row_seen boolean;
begin
  if owner_id is null then
    raise exception 'authentication_required';
  end if;
  if p_source_scope is null
    or p_source_scope not in ('watchlist', 'all')
  then
    raise exception 'invalid_dashboard_source_scope';
  end if;
  if p_limit is null or p_limit not between 1 and 200 then
    raise exception 'invalid_dashboard_limit';
  end if;

  target_count := p_limit + 1;

  while accepted_count < target_count and base_has_more loop
    base_row_seen := false;
    base_has_more := false;

    for candidate in
      select page.row_data, page.cursor_data, page.has_more
      from public.dashboard_feed_page_v0052(
        p_lifecycle,
        p_order,
        p_tiers,
        p_hidden_company_keys,
        p_query_signature,
        scan_cursor,
        200
      ) as page
    loop
      base_row_seen := true;
      scan_cursor := candidate.cursor_data;
      base_has_more := candidate.has_more;

      if (
        p_source_scope = 'all'
        or candidate.row_data #> '{jobs,companies}' <> 'null'::jsonb
      )
      and (
        p_lifecycle <> 'active'
        or not exists (
          select 1
          from public.applications as application
          join public.user_jobs as user_job
            on user_job.id = (candidate.row_data ->> 'id')::uuid
          where application.user_id = owner_id
            and application.origin = 'system'
            and application.source_job_id = user_job.job_id
        )
      )
      then
        accepted_rows := array_append(accepted_rows, candidate.row_data);
        accepted_cursors := array_append(
          accepted_cursors,
          candidate.cursor_data
        );
        accepted_count := accepted_count + 1;
        exit when accepted_count >= target_count;
      end if;
    end loop;

    exit when not base_row_seen;
  end loop;

  return query
  select
    accepted_rows[result.index],
    accepted_cursors[result.index],
    accepted_count > p_limit
  from generate_series(
    1,
    least(accepted_count, p_limit)
  ) as result(index);
end;
$$;

revoke all on function public.dashboard_feed_page_v2(
  text, text, text[], text[], text, text, jsonb, integer
) from public, anon, authenticated;
grant execute on function public.dashboard_feed_page_v2(
  text, text, text[], text[], text, text, jsonb, integer
) to authenticated;
alter function public.dashboard_feed_page_v2(
  text, text, text[], text[], text, text, jsonb, integer
) owner to postgres;

-- Company choices use the same source boundary over the complete result set,
-- independent of feed pagination.
create function public.dashboard_company_options_v2(
  p_lifecycle text,
  p_tiers text[],
  p_source_scope text
)
returns table (
  company_key text,
  company_name text,
  matching_count bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
begin
  if owner_id is null then
    raise exception 'authentication_required';
  end if;
  if p_lifecycle not in ('active', 'applied', 'dismissed') then
    raise exception 'invalid_dashboard_lifecycle';
  end if;
  if p_source_scope is null
    or p_source_scope not in ('watchlist', 'all')
  then
    raise exception 'invalid_dashboard_source_scope';
  end if;
  if p_tiers is null
    or cardinality(p_tiers) not between 1 and 3
    or array_position(p_tiers, null) is not null
    or exists (
      select 1
      from unnest(p_tiers) as tier
      where tier not in ('Strong', 'Good', 'Weak')
    )
  then
    raise exception 'invalid_dashboard_tiers';
  end if;

  return query
  select
    lower(regexp_replace(coalesce(
      nullif(btrim(company.name), ''),
      nullif(btrim(job.source_company_name), '')
    ), '[[:space:]]+', ' ', 'g')) as company_key,
    min(coalesce(
      nullif(btrim(company.name), ''),
      nullif(btrim(job.source_company_name), '')
    )) as company_name,
    count(*) as matching_count
  from public.user_jobs as user_job
  join public.jobs as job on job.id = user_job.job_id
  left join public.companies as company on company.id = job.company_id
  join public.deterministic_ranking_state as ranking_state
    on ranking_state.user_id = user_job.user_id
    and ranking_state.active_revision = user_job.deterministic_revision
  where user_job.user_id = owner_id
    and job.status = 'open'
    and (
      p_lifecycle <> 'active'
      or job.source <> 'goldman_higher'
      or (
        job.posted_at is not null
        and job.posted_at >= clock_timestamp() - interval '168 hours'
      )
    )
    and user_job.deterministic_eligible is true
    and user_job.deterministic_revision is not null
    and user_job.deterministic_score is not null
    and user_job.deterministic_tier is not null
    and user_job.deterministic_tier = any(p_tiers)
    and (p_source_scope = 'all' or company.id is not null)
    and (
      p_lifecycle = 'active'
      and user_job.applied_at is null
      and user_job.dismissed_at is null
      and not exists (
        select 1
        from public.applications as application
        where application.user_id = owner_id
          and application.origin = 'system'
          and application.source_job_id = user_job.job_id
      )
      or p_lifecycle = 'applied'
      and user_job.applied_at is not null
      and user_job.dismissed_at is null
      or p_lifecycle = 'dismissed'
      and user_job.dismissed_at is not null
      and user_job.applied_at is null
    )
    and coalesce(
      nullif(btrim(company.name), ''),
      nullif(btrim(job.source_company_name), '')
    ) is not null
  group by 1
  order by min(coalesce(
    nullif(btrim(company.name), ''),
    nullif(btrim(job.source_company_name), '')
  )), 1;
end;
$$;

revoke all on function public.dashboard_company_options_v2(text, text[], text)
  from public, anon, authenticated;
grant execute on function public.dashboard_company_options_v2(text, text[], text)
  to authenticated;
alter function public.dashboard_company_options_v2(text, text[], text)
  owner to postgres;

-- AUTH-04: delete every current personal job-data record while deliberately
-- retaining the auth account/profile and shared companies/raw job pool.
create or replace function public.delete_my_data()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
begin
  if owner_id is null then
    raise exception 'authentication_required';
  end if;

  -- The 0055 final-event trigger permits the FK cascade only after the parent
  -- application is gone. Delete the parent and let the composite FK cascade
  -- remove its complete event timeline.
  delete from public.applications
  where user_id = owner_id;

  delete from public.user_job_dismissals
  where user_id = owner_id;

  delete from public.deterministic_ranking_state
  where user_id = owner_id;

  delete from public.deterministic_ranking_items
  where user_id = owner_id;

  update public.deterministic_ranking_runs
  set retry_of_run_id = null
  where user_id = owner_id
    and retry_of_run_id is not null;

  delete from public.deterministic_ranking_runs
  where user_id = owner_id;

  delete from public.ai_usage
  where user_id = owner_id;

  delete from public.resume_extracts
  where user_id = owner_id;

  delete from public.resumes
  where user_id = owner_id;

  delete from public.preferences
  where user_id = owner_id;

  delete from public.user_jobs
  where user_id = owner_id;
end;
$$;

revoke all on function public.delete_my_data()
  from public, anon, authenticated;
grant execute on function public.delete_my_data()
  to authenticated;
alter function public.delete_my_data() owner to postgres;

comment on function public.dashboard_feed_page_v2(
  text, text, text[], text[], text, text, jsonb, integer
) is
  'Owner-scoped keyset feed with tracker and shared-source scope applied before the outward page boundary.';
comment on function public.dashboard_company_options_v2(text, text[], text) is
  'Owner-scoped complete company options under the requested shared-source scope.';
comment on function public.delete_my_data() is
  'Deletes all personal job data for auth.uid(); retains login/profile and shared companies/raw jobs.';

commit;

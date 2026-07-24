begin;

-- Phase 03.6 Plan 02: exact U.S.-scoped Workday admission plus a
-- server-authoritative, per-user Dashboard lifecycle queue. This migration is
-- intentionally local-only until the separately approved release plan.

alter table public.companies
  drop constraint companies_workday_identity_check,
  add constraint companies_workday_identity_check check (
    ats_type <> 'workday'
    or (
      (
        board_token = 'capitalone'
        and region = 'wd12'
        and site_token = 'Capital_One'
        and source_key = 'workday:wd12:capitalone:Capital_One'
        and activation_state in ('experimental', 'active')
      )
      or (
        board_token = 'fmr'
        and region = 'wd1'
        and site_token = 'FidelityCareers'
        and source_key = 'workday:wd1:fmr:FidelityCareers'
        and activation_state in ('experimental', 'active')
      )
      or (
        board_token = 'nasdaq'
        and region = 'wd1'
        and site_token = 'Global_External_Site'
        and source_key = 'workday:wd1:nasdaq:Global_External_Site'
        and activation_state in ('experimental', 'active')
      )
      or (
        board_token = 'spgi'
        and region = 'wd5'
        and site_token = 'SPGI_Careers'
        and source_key = 'workday:wd5:spgi:SPGI_Careers'
        and activation_state in ('experimental', 'active')
      )
      or (
        board_token = 'morningstar'
        and region = 'wd5'
        and site_token = 'morningstar'
        and source_key = 'workday:wd5:morningstar:morningstar'
        and activation_state in ('experimental', 'active')
      )
      or (
        board_token = 'statestreet'
        and region = 'wd1'
        and site_token = 'Global'
        and source_key = 'workday:wd1:statestreet:Global'
        and activation_state in ('experimental', 'active')
      )
    ) is true
  );

-- Exercise the installed CHECK in subtransactions. PostgreSQL CHECK accepts
-- NULL, so both nullable components and fully non-null lookalikes are probed.
do $$
declare
  probe_suffix text := gen_random_uuid()::text;
begin
  begin
    update public.companies
    set region = null
    where source_key = 'workday:wd12:capitalone:Capital_One';

    if not found then
      insert into public.companies (
        name, ats_type, board_token, region, site_token, careers_url,
        source_key, activation_state
      ) values (
        'Migration 0037 null-region probe', 'workday', 'capitalone', null,
        'Capital_One', 'https://capitalone.wd12.myworkdayjobs.com/Capital_One',
        'workday:wd12:capitalone:Capital_One', 'active'
      );
    end if;
    raise exception 'NULL Workday region unexpectedly passed companies_workday_identity_check';
  exception
    when check_violation then
      null;
  end;

  begin
    update public.companies
    set site_token = null
    where source_key = 'workday:wd1:fmr:FidelityCareers';

    if not found then
      insert into public.companies (
        name, ats_type, board_token, region, site_token, careers_url,
        source_key, activation_state
      ) values (
        'Migration 0037 null-site probe', 'workday', 'fmr', 'wd1', null,
        'https://wd1.myworkdaysite.com/en-US/recruiting/fmr/FidelityCareers',
        'workday:wd1:fmr:FidelityCareers', 'active'
      );
    end if;
    raise exception 'NULL Workday site_token unexpectedly passed companies_workday_identity_check';
  exception
    when check_violation then
      null;
  end;

  begin
    insert into public.companies (
      name, ats_type, board_token, region, site_token, careers_url,
      source_key, activation_state
    ) values (
      'Migration 0037 unknown-tuple probe', 'workday',
      'migration-probe-' || probe_suffix, 'wd99', 'Unknown_Site',
      'https://migration-probe.wd99.myworkdayjobs.com/Unknown_Site',
      'workday:wd99:migration-probe-' || probe_suffix || ':Unknown_Site',
      'active'
    );
    raise exception 'unknown Workday tuple unexpectedly passed companies_workday_identity_check';
  exception
    when check_violation then
      null;
  end;

  begin
    insert into public.companies (
      name, ats_type, board_token, region, site_token, careers_url,
      source_key, activation_state
    ) values (
      'Migration 0037 lookalike probe', 'workday', 'Nasdaq', 'wd1',
      'Global_External_Site',
      'https://nasdaq.wd1.myworkdayjobs.com/Global_External_Site',
      'workday:wd1:nasdaq:Global_External_Site', 'active'
    );
    raise exception 'lookalike Workday tuple unexpectedly passed companies_workday_identity_check';
  exception
    when check_violation then
      null;
  end;
end;
$$;

-- Catalog rows are navigation/evidence only. They do not seed public.companies
-- and therefore cannot bypass live verification or the observation windows.
insert into public.source_coverage_catalog (
  company_name,
  provider,
  careers_url,
  disposition,
  source_key,
  unsupported_reason,
  access_evidence,
  verified_at
)
values
  (
    'Nasdaq',
    'Workday',
    'https://nasdaq.wd1.myworkdayjobs.com/Global_External_Site',
    'experimental',
    'workday:wd1:nasdaq:Global_External_Site',
    null,
    'Read-only evidence: the exact public Workday CXS identity returned a complete U.S.-scoped listing; live verification remains required before company admission.',
    date '2026-07-24'
  ),
  (
    'S&P Global',
    'Workday',
    'https://spgi.wd5.myworkdayjobs.com/SPGI_Careers',
    'experimental',
    'workday:wd5:spgi:SPGI_Careers',
    null,
    'Read-only evidence: the exact public Workday CXS identity returned a complete U.S.-scoped listing; live verification remains required before company admission.',
    date '2026-07-24'
  ),
  (
    'Morningstar',
    'Workday',
    'https://morningstar.wd5.myworkdayjobs.com/morningstar',
    'experimental',
    'workday:wd5:morningstar:morningstar',
    null,
    'Read-only evidence: the exact public Workday CXS identity returned a complete nested-country U.S.-scoped listing; live verification remains required before company admission.',
    date '2026-07-24'
  ),
  (
    'State Street',
    'Workday',
    'https://statestreet.wd1.myworkdayjobs.com/Global',
    'experimental',
    'workday:wd1:statestreet:Global',
    null,
    'Read-only evidence: the exact public Workday CXS identity returned a complete U.S.-scoped listing; live verification remains required before company admission.',
    date '2026-07-24'
  )
on conflict (company_name) do update
set
  provider = excluded.provider,
  careers_url = excluded.careers_url,
  disposition = excluded.disposition,
  source_key = excluded.source_key,
  unsupported_reason = excluded.unsupported_reason,
  access_evidence = excluded.access_evidence,
  verified_at = excluded.verified_at;

alter table public.user_jobs
  add column applied_at timestamptz,
  add constraint user_jobs_lifecycle_mutual_exclusion check (
    applied_at is null or dismissed_at is null
  );

create index user_jobs_active_newest_cursor_idx
  on public.user_jobs (user_id, id desc)
  where applied_at is null
    and dismissed_at is null
    and deterministic_revision is not null
    and deterministic_eligible;
create index user_jobs_active_score_cursor_idx
  on public.user_jobs (user_id, deterministic_score, id desc)
  where applied_at is null
    and dismissed_at is null
    and deterministic_revision is not null
    and deterministic_eligible;
create index user_jobs_applied_cursor_idx
  on public.user_jobs (user_id, applied_at desc, id desc)
  where applied_at is not null;
create index user_jobs_dismissed_cursor_idx
  on public.user_jobs (user_id, dismissed_at desc, id desc)
  where dismissed_at is not null;

alter table public.user_jobs enable row level security;
revoke all on table public.user_jobs from anon, authenticated;
grant select on table public.user_jobs to authenticated;
grant update (seen_at, dismissed_at, applied_at) on public.user_jobs to authenticated;

-- Recreate the own-row policies so the installed authorization contract is
-- explicit in this forward migration, independent of prior policy drift.
drop policy if exists "user_jobs_select_own" on public.user_jobs;
create policy "user_jobs_select_own" on public.user_jobs
  for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "user_jobs_update_own" on public.user_jobs;
create policy "user_jobs_update_own" on public.user_jobs
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Rebuild the latest observation contract without changing its three distinct,
-- server-timed windows or its service-role-only execution boundary.
create or replace function public.record_connector_observation(
  p_company_id uuid,
  p_observation_id uuid,
  p_completeness text,
  p_credible_for_closure boolean,
  p_job_count integer,
  p_expected_count integer,
  p_warning_count integer,
  p_evidence_digest text
)
returns table (
  accepted boolean,
  reason text,
  progress integer,
  window_start timestamptz,
  next_eligible_at timestamptz,
  result_activation_state text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
  v_window_interval interval;
  v_window_start timestamptz;
  v_next_eligible_at timestamptz;
  v_provider text;
  v_activation_state text;
  v_persisted_progress integer;
  v_progress integer;
begin
  if p_company_id is null
    or p_observation_id is null
    or p_completeness is null
    or p_completeness <> 'complete'
    or p_credible_for_closure is not true
    or p_job_count is null
    or p_expected_count is null
    or p_job_count < 0
    or p_expected_count < 0
    or p_job_count <> p_expected_count
    or p_warning_count is null
    or p_warning_count <> 0
    or p_evidence_digest is null
    or length(p_evidence_digest) not between 16 and 128
  then
    return query select false, 'ineligible_evidence'::text, null::integer,
      null::timestamptz, null::timestamptz, null::text;
    return;
  end if;

  v_now := clock_timestamp();
  set local lock_timeout = '500ms';

  begin
    select c.ats_type, c.activation_state, c.activation_successes
    into v_provider, v_activation_state, v_persisted_progress
    from public.companies as c
    where c.id = p_company_id
    for update;
  exception
    when lock_not_available or query_canceled then
      return query select false, 'retryable_lock_contention'::text, null::integer,
        null::timestamptz, null::timestamptz, null::text;
      return;
  end;

  if not found then
    return query select false, 'ineligible_company'::text, 0,
      null::timestamptz, null::timestamptz, null::text;
    return;
  end if;

  if v_provider not in ('smartrecruiters', 'recruitee', 'workday', 'paylocity')
    or v_activation_state not in ('experimental', 'active')
  then
    return query select false, 'ineligible_company'::text,
      least(greatest(v_persisted_progress, 0), 3), null::timestamptz,
      null::timestamptz, v_activation_state;
    return;
  end if;

  if v_provider = 'paylocity' and p_job_count <= 0 then
    return query select false, 'ineligible_evidence'::text,
      least(greatest(v_persisted_progress, 0), 3), null::timestamptz,
      null::timestamptz, v_activation_state;
    return;
  end if;

  v_window_interval := case
    when v_provider = 'workday' then interval '30 minutes'
    else interval '10 minutes'
  end;
  v_window_start := date_bin(
    v_window_interval,
    v_now,
    timestamptz '2000-01-01 00:00:00+00'
  );
  v_next_eligible_at := v_window_start + v_window_interval;

  if v_persisted_progress >= 3 then
    return query select false, 'progress_complete'::text, 3, v_window_start,
      v_next_eligible_at, v_activation_state;
    return;
  end if;

  if exists (
    select 1 from public.connector_observations as observation
    where observation.observation_id = p_observation_id
  ) then
    return query select false, 'replay'::text, v_persisted_progress,
      v_window_start, v_next_eligible_at, v_activation_state;
    return;
  end if;

  if exists (
    select 1 from public.connector_observations as observation
    where observation.company_id = p_company_id
      and observation.eligibility_window_start = v_window_start
  ) then
    return query select false, 'same_window'::text, v_persisted_progress,
      v_window_start, v_next_eligible_at, v_activation_state;
    return;
  end if;

  insert into public.connector_observations (
    observation_id, company_id, provider, observed_at,
    eligibility_window_start, completeness, credible_for_closure, job_count,
    expected_count, warning_count, evidence_digest
  ) values (
    p_observation_id, p_company_id, v_provider, v_now, v_window_start,
    p_completeness, p_credible_for_closure, p_job_count, p_expected_count,
    p_warning_count, p_evidence_digest
  );

  select count(*)::integer into v_progress
  from public.connector_observations as observation
  where observation.company_id = p_company_id;

  if v_progress > 3 then
    raise exception 'connector observation cap violated';
  end if;

  update public.companies as company
  set
    activation_successes = v_progress,
    activation_state = case
      when v_progress = 3
        and company.ats_type in (
          'smartrecruiters', 'recruitee', 'paylocity', 'workday'
        )
      then 'active'
      else company.activation_state
    end,
    last_verified_at = v_now,
    last_observation_count = p_job_count,
    last_error = null,
    last_error_code = null
  where company.id = p_company_id
  returning company.activation_state into v_activation_state;

  return query select true, 'accepted'::text, v_progress, v_window_start,
    v_next_eligible_at, v_activation_state;
exception
  when unique_violation then
    return query select false, 'replay_or_same_window'::text,
      least(greatest(coalesce(v_persisted_progress, 0), 0), 3),
      v_window_start, v_next_eligible_at, v_activation_state;
end;
$$;

revoke execute on function public.record_connector_observation(
  uuid, uuid, text, boolean, integer, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.record_connector_observation(
  uuid, uuid, text, boolean, integer, integer, integer, text
) to service_role;

create or replace function public.claim_due_companies(batch_size integer default 10)
returns setof public.companies
language sql
security invoker
set search_path = ''
as $$
  with due as (
    select id
    from public.companies
    where activation_state = 'active'
      and (
        ats_type in (
          'greenhouse', 'lever', 'ashby', 'smartrecruiters', 'recruitee',
          'paylocity'
        )
        or (
          ats_type = 'workday'
          and source_key in (
            'workday:wd12:capitalone:Capital_One',
            'workday:wd1:fmr:FidelityCareers',
            'workday:wd1:nasdaq:Global_External_Site',
            'workday:wd5:spgi:SPGI_Careers',
            'workday:wd5:morningstar:morningstar',
            'workday:wd1:statestreet:Global'
          )
        )
      )
      and (
        last_polled_at is null
        or last_polled_at < now() - interval '9 minutes'
      )
    order by last_polled_at asc nulls first
    limit batch_size
    for update skip locked
  )
  update public.companies as company
  set last_polled_at = now()
  from due
  where company.id = due.id
  returning company.*;
$$;

revoke execute on function public.claim_due_companies(integer)
  from public, anon, authenticated;
grant execute on function public.claim_due_companies(integer) to service_role;

create or replace function public.dashboard_feed_page(
  p_lifecycle text,
  p_order text,
  p_tiers text[],
  p_hidden_company_keys text[],
  p_query_signature text,
  p_cursor jsonb default null,
  p_limit integer default 200
)
returns table (
  row_data jsonb,
  cursor_data jsonb,
  has_more boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  cursor_id uuid;
  cursor_posted_at timestamptz;
  cursor_first_seen_at timestamptz;
  cursor_score integer;
  cursor_lifecycle_at timestamptz;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication_required';
  end if;
  if p_lifecycle not in ('active', 'applied', 'dismissed') then
    raise exception 'invalid_dashboard_lifecycle';
  end if;
  if p_order not in ('newest', 'score_desc', 'score_asc')
    or (p_lifecycle <> 'active' and p_order <> 'newest')
  then
    raise exception 'invalid_dashboard_order';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'invalid_dashboard_limit';
  end if;
  if p_query_signature is null
    or char_length(p_query_signature) not between 1 and 512
    or p_query_signature ~ '[[:cntrl:]]'
  then
    raise exception 'invalid_dashboard_query_signature';
  end if;
  if p_tiers is null
    or cardinality(p_tiers) not between 1 and 3
    or array_position(p_tiers, null) is not null
    or exists (
      select 1 from unnest(p_tiers) as tier
      where tier not in ('Strong', 'Good', 'Weak')
    )
    or cardinality(p_tiers) <> (
      select count(distinct tier) from unnest(p_tiers) as tier
    )
  then
    raise exception 'invalid_dashboard_tiers';
  end if;
  if p_hidden_company_keys is null
    or cardinality(p_hidden_company_keys) > 200
    or array_position(p_hidden_company_keys, null) is not null
    or exists (
      select 1 from unnest(p_hidden_company_keys) as company_key
      where company_key <> lower(btrim(company_key))
        or char_length(company_key) not between 1 and 200
        or company_key ~ '[[:cntrl:]]'
    )
  then
    raise exception 'invalid_dashboard_company_keys';
  end if;

  if p_cursor is not null then
    if jsonb_typeof(p_cursor) <> 'object'
      or (
        select array_agg(key order by key)
        from jsonb_object_keys(p_cursor) as key
      ) <> array[
        'first_seen_at', 'id', 'lifecycle', 'lifecycle_at', 'order',
        'posted_at', 'score', 'signature', 'v'
      ]::text[]
      or jsonb_typeof(p_cursor -> 'v') <> 'number'
      or (p_cursor ->> 'v')::integer <> 1
      or jsonb_typeof(p_cursor -> 'id') <> 'string'
      or (p_cursor ->> 'id') !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or jsonb_typeof(p_cursor -> 'lifecycle') <> 'string'
      or jsonb_typeof(p_cursor -> 'order') <> 'string'
      or jsonb_typeof(p_cursor -> 'signature') <> 'string'
      or jsonb_typeof(p_cursor -> 'posted_at') not in ('string', 'null')
      or jsonb_typeof(p_cursor -> 'first_seen_at') not in ('string', 'null')
      or jsonb_typeof(p_cursor -> 'score') not in ('number', 'null')
      or jsonb_typeof(p_cursor -> 'lifecycle_at') not in ('string', 'null')
      or (
        jsonb_typeof(p_cursor -> 'score') = 'number'
        and (
          (p_cursor ->> 'score')::numeric <> trunc((p_cursor ->> 'score')::numeric)
          or (p_cursor ->> 'score')::integer not between 0 and 100
        )
      )
    then
      raise exception 'invalid_dashboard_cursor';
    end if;
    if p_cursor ->> 'lifecycle' <> p_lifecycle
      or p_cursor ->> 'order' <> p_order
      or p_cursor ->> 'signature' <> p_query_signature
    then
      raise exception 'dashboard_cursor_signature_mismatch';
    end if;

    cursor_id := (p_cursor ->> 'id')::uuid;
    cursor_posted_at := (p_cursor ->> 'posted_at')::timestamptz;
    cursor_first_seen_at := (p_cursor ->> 'first_seen_at')::timestamptz;
    cursor_score := (p_cursor ->> 'score')::integer;
    cursor_lifecycle_at := (p_cursor ->> 'lifecycle_at')::timestamptz;

    if (p_lifecycle = 'active' and (
        cursor_posted_at is null
        or cursor_first_seen_at is null
        or (p_order <> 'newest' and cursor_score is null)
      ))
      or (p_lifecycle <> 'active' and cursor_lifecycle_at is null)
    then
      raise exception 'invalid_dashboard_cursor';
    end if;
  end if;

  return query
  with candidates as (
    select
      user_job,
      job,
      company,
      coalesce(
        nullif(btrim(company.name), ''),
        nullif(btrim(job.source_company_name), '')
      ) as company_label,
      lower(regexp_replace(coalesce(
        nullif(btrim(company.name), ''),
        nullif(btrim(job.source_company_name), '')
      ), '[[:space:]]+', ' ', 'g')) as company_key
    from public.user_jobs as user_job
    join public.jobs as job on job.id = user_job.job_id
    left join public.companies as company on company.id = job.company_id
    join public.deterministic_ranking_state as ranking_state
      on ranking_state.user_id = user_job.user_id
      and ranking_state.active_revision = user_job.deterministic_revision
    where user_job.user_id = (select auth.uid())
      and job.status = 'open'
      and user_job.deterministic_eligible is true
      and user_job.deterministic_revision is not null
      and user_job.deterministic_score is not null
      and user_job.deterministic_tier is not null
      and user_job.deterministic_tier = any(p_tiers)
      and (
        p_lifecycle = 'active'
        and user_job.applied_at is null
        and user_job.dismissed_at is null
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
      and not (
        lower(regexp_replace(coalesce(
          nullif(btrim(company.name), ''),
          nullif(btrim(job.source_company_name), '')
        ), '[[:space:]]+', ' ', 'g')) = any(p_hidden_company_keys)
      )
      and (
        p_cursor is null
        or (
          p_lifecycle = 'applied'
          and (
            user_job.applied_at < cursor_lifecycle_at
            or (
              user_job.applied_at = cursor_lifecycle_at
              and user_job.id < cursor_id
            )
          )
        )
        or (
          p_lifecycle = 'dismissed'
          and (
            user_job.dismissed_at < cursor_lifecycle_at
            or (
              user_job.dismissed_at = cursor_lifecycle_at
              and user_job.id < cursor_id
            )
          )
        )
        or (
          p_lifecycle = 'active'
          and p_order = 'newest'
          and (
            coalesce(job.posted_at, '-infinity'::timestamptz) < cursor_posted_at
            or (
              coalesce(job.posted_at, '-infinity'::timestamptz) = cursor_posted_at
              and job.first_seen_at < cursor_first_seen_at
            )
            or (
              coalesce(job.posted_at, '-infinity'::timestamptz) = cursor_posted_at
              and job.first_seen_at = cursor_first_seen_at
              and user_job.id < cursor_id
            )
          )
        )
        or (
          p_lifecycle = 'active'
          and p_order = 'score_desc'
          and (
            user_job.deterministic_score < cursor_score
            or (
              user_job.deterministic_score = cursor_score
              and coalesce(job.posted_at, '-infinity'::timestamptz)
                < cursor_posted_at
            )
            or (
              user_job.deterministic_score = cursor_score
              and coalesce(job.posted_at, '-infinity'::timestamptz)
                = cursor_posted_at
              and job.first_seen_at < cursor_first_seen_at
            )
            or (
              user_job.deterministic_score = cursor_score
              and coalesce(job.posted_at, '-infinity'::timestamptz)
                = cursor_posted_at
              and job.first_seen_at = cursor_first_seen_at
              and user_job.id < cursor_id
            )
          )
        )
        or (
          p_lifecycle = 'active'
          and p_order = 'score_asc'
          and (
            user_job.deterministic_score > cursor_score
            or (
              user_job.deterministic_score = cursor_score
              and coalesce(job.posted_at, '-infinity'::timestamptz)
                < cursor_posted_at
            )
            or (
              user_job.deterministic_score = cursor_score
              and coalesce(job.posted_at, '-infinity'::timestamptz)
                = cursor_posted_at
              and job.first_seen_at < cursor_first_seen_at
            )
            or (
              user_job.deterministic_score = cursor_score
              and coalesce(job.posted_at, '-infinity'::timestamptz)
                = cursor_posted_at
              and job.first_seen_at = cursor_first_seen_at
              and user_job.id < cursor_id
            )
          )
        )
      )
  ),
  page_window as (
    select
      candidate.*,
      row_number() over (
        order by
          case when p_lifecycle = 'applied'
            then candidate.user_job.applied_at end desc nulls last,
          case when p_lifecycle = 'dismissed'
            then candidate.user_job.dismissed_at end desc nulls last,
          case when p_lifecycle = 'active' and p_order = 'score_desc'
            then candidate.user_job.deterministic_score end desc nulls last,
          case when p_lifecycle = 'active' and p_order = 'score_asc'
            then candidate.user_job.deterministic_score end asc nulls last,
          case when p_lifecycle = 'active'
            then candidate.job.posted_at end desc nulls last,
          case when p_lifecycle = 'active'
            then candidate.job.first_seen_at end desc,
          candidate.user_job.id desc
      ) as page_position
    from candidates as candidate
    order by
      case when p_lifecycle = 'applied'
        then candidate.user_job.applied_at end desc nulls last,
      case when p_lifecycle = 'dismissed'
        then candidate.user_job.dismissed_at end desc nulls last,
      case when p_lifecycle = 'active' and p_order = 'score_desc'
        then candidate.user_job.deterministic_score end desc nulls last,
      case when p_lifecycle = 'active' and p_order = 'score_asc'
        then candidate.user_job.deterministic_score end asc nulls last,
      case when p_lifecycle = 'active'
        then candidate.job.posted_at end desc nulls last,
      case when p_lifecycle = 'active'
        then candidate.job.first_seen_at end desc,
      candidate.user_job.id desc
    limit p_limit + 1
  ),
  continuation as (
    select exists (
      select 1 from page_window where page_position = p_limit + 1
    ) as has_more
  )
  select
    jsonb_build_object(
      'id', page.user_job.id,
      'deterministic_revision', page.user_job.deterministic_revision,
      'deterministic_eligible', page.user_job.deterministic_eligible,
      'deterministic_score', page.user_job.deterministic_score,
      'deterministic_tier', page.user_job.deterministic_tier,
      'deterministic_breakdown', page.user_job.deterministic_breakdown,
      'deterministic_filter_code', page.user_job.deterministic_filter_code,
      'deterministic_filter_detail', page.user_job.deterministic_filter_detail,
      'deterministic_ranked_at', page.user_job.deterministic_ranked_at,
      'deterministic_best_fit_resume_id',
        page.user_job.deterministic_best_fit_resume_id,
      'deterministic_runner_up_resume_id',
        page.user_job.deterministic_runner_up_resume_id,
      'seen_at', page.user_job.seen_at,
      'dismissed_at', page.user_job.dismissed_at,
      'applied_at', page.user_job.applied_at,
      'jobs', jsonb_build_object(
        'id', page.job.id,
        'title', page.job.title,
        'location', page.job.location,
        'absolute_url', page.job.absolute_url,
        'posted_at', page.job.posted_at,
        'first_seen_at', page.job.first_seen_at,
        'status', page.job.status,
        'source_company_name', page.job.source_company_name,
        'companies', case when page.company.id is null then null else
          jsonb_build_object('name', page.company.name)
        end
      )
    ),
    jsonb_build_object(
      'v', 1,
      'lifecycle', p_lifecycle,
      'order', p_order,
      'signature', p_query_signature,
      'id', page.user_job.id,
      'posted_at', case when p_lifecycle = 'active'
        then coalesce(page.job.posted_at, '-infinity'::timestamptz)
        else null end,
      'first_seen_at', case when p_lifecycle = 'active'
        then page.job.first_seen_at else null end,
      'score', case when p_lifecycle = 'active'
        then page.user_job.deterministic_score else null end,
      'lifecycle_at', case
        when p_lifecycle = 'applied' then page.user_job.applied_at
        when p_lifecycle = 'dismissed' then page.user_job.dismissed_at
        else null end
    ),
    continuation.has_more
  from page_window as page
  cross join continuation
  where page.page_position <= p_limit
  order by page.page_position;

  -- Lifecycle-specific order contracts:
  -- p_lifecycle = 'applied': user_job.applied_at DESC, user_job.id DESC
  -- p_lifecycle = 'dismissed': user_job.dismissed_at DESC, user_job.id DESC
  -- p_order = 'score_desc': user_job.deterministic_score DESC, user_job.id DESC
  -- p_order = 'score_asc': user_job.deterministic_score ASC, user_job.id DESC
  -- p_order = 'newest': job.posted_at DESC NULLS LAST,
  --   job.first_seen_at DESC, user_job.id DESC
end;
$$;

revoke execute on function public.dashboard_feed_page(
  text, text, text[], text[], text, jsonb, integer
) from public, anon;
grant execute on function public.dashboard_feed_page(
  text, text, text[], text[], text, jsonb, integer
) to authenticated;

create or replace function public.dashboard_company_options(
  p_lifecycle text,
  p_tiers text[]
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
begin
  if (select auth.uid()) is null then
    raise exception 'authentication_required';
  end if;
  if p_lifecycle not in ('active', 'applied', 'dismissed') then
    raise exception 'invalid_dashboard_lifecycle';
  end if;
  if p_tiers is null
    or cardinality(p_tiers) not between 1 and 3
    or array_position(p_tiers, null) is not null
    or exists (
      select 1 from unnest(p_tiers) as tier
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
  where user_job.user_id = (select auth.uid())
    and job.status = 'open'
    and user_job.deterministic_eligible is true
    and user_job.deterministic_revision is not null
    and user_job.deterministic_score is not null
    and user_job.deterministic_tier is not null
    and user_job.deterministic_tier = any(p_tiers)
    and (
      p_lifecycle = 'active'
      and user_job.applied_at is null
      and user_job.dismissed_at is null
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

revoke execute on function public.dashboard_company_options(text, text[])
  from public, anon;
grant execute on function public.dashboard_company_options(text, text[])
  to authenticated;

-- Fail the transaction if the exact registry/claim/catalog or user-write
-- boundary drifted while this migration was assembled.
do $$
declare
  identity_definition text;
  granted_columns text[];
begin
  select pg_get_constraintdef(constraint_row.oid)
  into identity_definition
  from pg_catalog.pg_constraint as constraint_row
  where constraint_row.conrelid = 'public.companies'::regclass
    and constraint_row.conname = 'companies_workday_identity_check';

  if identity_definition is null
    or position('workday:wd12:capitalone:Capital_One' in identity_definition) = 0
    or position('workday:wd1:fmr:FidelityCareers' in identity_definition) = 0
    or position('workday:wd1:nasdaq:Global_External_Site' in identity_definition) = 0
    or position('workday:wd5:spgi:SPGI_Careers' in identity_definition) = 0
    or position('workday:wd5:morningstar:morningstar' in identity_definition) = 0
    or position('workday:wd1:statestreet:Global' in identity_definition) = 0
  then
    raise exception 'Workday identity parity failed: %', identity_definition;
  end if;

  if exists (
    select 1
    from (
      values
        ('Nasdaq', 'workday:wd1:nasdaq:Global_External_Site'),
        ('S&P Global', 'workday:wd5:spgi:SPGI_Careers'),
        ('Morningstar', 'workday:wd5:morningstar:morningstar'),
        ('State Street', 'workday:wd1:statestreet:Global')
    ) as expected(company_name, source_key)
    left join public.source_coverage_catalog as catalog
      on catalog.company_name = expected.company_name
      and catalog.source_key = expected.source_key
      and catalog.provider = 'Workday'
      and catalog.disposition = 'experimental'
      and catalog.unsupported_reason is null
    where catalog.id is null
  ) then
    raise exception 'Workday source catalog parity failed';
  end if;

  select array_agg(column_name order by column_name)
  into granted_columns
  from information_schema.column_privileges
  where table_schema = 'public'
    and table_name = 'user_jobs'
    and grantee = 'authenticated'
    and privilege_type = 'UPDATE';

  if granted_columns is distinct from
    array['applied_at', 'dismissed_at', 'seen_at']::text[]
  then
    raise exception 'user_jobs authenticated UPDATE grant parity failed: %',
      granted_columns;
  end if;
end;
$$;

comment on constraint companies_workday_identity_check on public.companies is
  'Exact six-entry Workday allowlist; nullable or lookalike identity tuples fail closed.';
comment on constraint user_jobs_lifecycle_mutual_exclusion on public.user_jobs is
  'Applied and dismissed are mutually exclusive per-user lifecycle states.';
comment on function public.dashboard_feed_page(
  text, text, text[], text[], text, jsonb, integer
) is
  'Authenticated RLS-scoped keyset page; filters before a bounded 200-row limit and returns one-row continuation evidence.';
comment on function public.dashboard_company_options(text, text[]) is
  'Authenticated RLS-scoped company options over the complete lifecycle/tier scope before pagination.';

commit;

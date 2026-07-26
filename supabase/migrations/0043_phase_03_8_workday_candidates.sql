begin;

-- Phase 03.8 Plan 06 is a local-only forward amendment. Migrations 0040 and
-- 0041 are deployed and immutable; pending migration 0042 remains byte-exact.
-- This migration admits no source from fixture or migration bytes.

create temporary table phase_03_8_protected_workday_0043_before
on commit drop as
select
  id, name, ats_type, board_token, region, site_token, careers_url, source_key,
  activation_state, activation_successes, next_poll_at, last_polled_at,
  last_success_at, consecutive_failures, last_error, last_error_code
from public.companies
where source_key in (
  'workday:wd12:capitalone:Capital_One',
  'workday:wd1:fmr:FidelityCareers'
);

-- Citi and Wells Fargo are removed from the catalog only. Refuse the migration
-- if either name has acquired any company, job, observation, or terminal
-- authority; operational or historical rows are never deleted by this change.
do $$
begin
  if exists (
    select 1
    from public.companies as company
    where company.name in ('Citi', 'Wells Fargo')
       or company.careers_url in (
         'https://jobs.citi.com/search-jobs',
         'https://www.wellsfargojobs.com/en/jobs/'
       )
  ) or exists (
    select 1
    from public.jobs as job
    join public.companies as company on company.id = job.company_id
    where company.name in ('Citi', 'Wells Fargo')
  ) or exists (
    select 1
    from public.connector_observations as observation
    join public.companies as company on company.id = observation.company_id
    where company.name in ('Citi', 'Wells Fargo')
  ) or exists (
    select 1
    from public.branded_connector_terminal_evidence as terminal
    where terminal.source_key in (
      'radancy:citi',
      'radancy:wells-fargo'
    )
  ) then
    raise exception 'Citi/Wells Fargo catalog removal blocked by operational authority';
  end if;
end;
$$;

delete from public.source_coverage_catalog
where company_name in ('Citi', 'Wells Fargo');

do $$
begin
  if exists (
    select 1
    from public.source_coverage_catalog
    where company_name in ('Citi', 'Wells Fargo')
  ) then
    raise exception 'Citi/Wells Fargo catalog rows still present';
  end if;
end;
$$;

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
      or (
        name = 'Morgan Stanley'
        and board_token = 'ms'
        and region = 'wd5'
        and site_token = 'External'
        and careers_url = 'https://ms.wd5.myworkdayjobs.com/en-US/External'
        and source_key = 'workday:wd5:ms:External'
        and activation_state in ('experimental', 'active')
      )
      or (
        name = 'Bank of America'
        and board_token = 'ghr'
        and region = 'wd1'
        and site_token = 'Lateral-US'
        and careers_url = 'https://ghr.wd1.myworkdayjobs.com/en-US/Lateral-US'
        and source_key = 'workday:wd1:ghr:Lateral-US'
        and activation_state in ('experimental', 'active')
      )
      or (
        name = 'BlackRock'
        and board_token = 'blackrock'
        and region = 'wd1'
        and site_token = 'BlackRock_Professional'
        and careers_url =
          'https://blackrock.wd1.myworkdayjobs.com/en-US/BlackRock_Professional'
        and source_key = 'workday:wd1:blackrock:BlackRock_Professional'
        and activation_state in ('experimental', 'active')
      )
      or (
        name = 'Barclays'
        and board_token = 'barclays'
        and region = 'wd3'
        and site_token = 'External_Career_Site_Barclays'
        and careers_url =
          'https://barclays.wd3.myworkdayjobs.com/en-US/External_Career_Site_Barclays'
        and source_key =
          'workday:wd3:barclays:External_Career_Site_Barclays'
        and activation_state in ('experimental', 'active')
      )
    ) is true
  );

create table public.workday_connector_terminal_evidence (
  source_key text not null,
  evidence_digest text primary key,
  outcome text not null check (
    outcome in ('admit_experimental', 'unsupported')
  ),
  reason text,
  recorded_at timestamptz not null default clock_timestamp(),
  constraint workday_terminal_source_check check (
    source_key in (
      'workday:wd5:ms:External',
      'workday:wd1:ghr:Lateral-US',
      'workday:wd1:blackrock:BlackRock_Professional',
      'workday:wd3:barclays:External_Career_Site_Barclays'
    )
  ),
  constraint workday_terminal_digest_check check (
    evidence_digest ~ '^[0-9a-f]{64}$'
  ),
  constraint workday_terminal_reason_check check (
    (
      outcome = 'admit_experimental'
      and reason is null
    )
    or (
      outcome = 'unsupported'
      and reason in (
        'pending_current_live_contract_proof',
        'country_filter_unverified',
        'whole_site_us_scope_unproven',
        'foreign_detail_detected',
        'detail_scope_incomplete',
        'pagination_incomplete',
        'count_mismatch',
        'provider_timeout',
        'provider_schema_error',
        'positive_job_count_missing'
      )
    )
  )
);

alter table public.workday_connector_terminal_evidence enable row level security;
revoke all on table public.workday_connector_terminal_evidence
  from public, anon, authenticated;
grant select, insert on table public.workday_connector_terminal_evidence
  to service_role;

insert into public.source_coverage_catalog (
  company_name, careers_url, provider, access_evidence, disposition,
  verified_at, unsupported_reason, source_key
)
values
  (
    'Morgan Stanley',
    'https://ms.wd5.myworkdayjobs.com/en-US/External',
    'Workday',
    'Exact flat United States facet and authoritative detail proof remain pending.',
    'unsupported_with_reason', date '2026-07-26',
    'pending_current_live_contract_proof', null
  ),
  (
    'Bank of America',
    'https://ghr.wd1.myworkdayjobs.com/en-US/Lateral-US',
    'Workday',
    'Complete whole-site authoritative United States detail proof remains pending.',
    'unsupported_with_reason', date '2026-07-26',
    'pending_current_live_contract_proof', null
  ),
  (
    'BlackRock',
    'https://blackrock.wd1.myworkdayjobs.com/en-US/BlackRock_Professional',
    'Workday',
    'Exact identity is known but no safe country contract is authorized.',
    'unsupported_with_reason', date '2026-07-26',
    'pending_current_live_contract_proof', null
  ),
  (
    'Barclays',
    'https://barclays.wd3.myworkdayjobs.com/en-US/External_Career_Site_Barclays',
    'Workday',
    'Exact identity is known but no safe country contract is authorized.',
    'unsupported_with_reason', date '2026-07-26',
    'pending_current_live_contract_proof', null
  ),
  (
    'UBS',
    'https://jobs.ubs.com/TGnewUI/Search/Home/HomeWithPreLoad?PageType=JobDetails&partnerid=25008&siteid=5012',
    'IBM BrassRing',
    'The structured endpoint requires a prohibited HTML bootstrap session.',
    'unsupported_with_reason', date '2026-07-26',
    'structured_endpoint_requires_html_bootstrap_session', null
  ),
  (
    'Charles Schwab',
    'https://www.schwabjobs.com/job-search-results/',
    'iCIMS / Radancy',
    'The primary Radancy results require prohibited HTML parsing.',
    'unsupported_with_reason', date '2026-07-26',
    'radancy_results_require_html_parsing', null
  )
on conflict (company_name) do update
set careers_url = excluded.careers_url,
    provider = excluded.provider,
    access_evidence = excluded.access_evidence,
    disposition = excluded.disposition,
    verified_at = excluded.verified_at,
    unsupported_reason = excluded.unsupported_reason,
    source_key = excluded.source_key;

-- Goldman Sachs and JPMorgan Chase retain the exact hosted terminal/catalog
-- evidence produced by 0040 and any later live terminalization. They are not
-- rewritten to make the superseded branded probes disappear.
do $$
begin
  if exists (
    select 1
    from public.source_coverage_catalog
    where company_name in ('Goldman Sachs', 'JPMorgan Chase')
      and (
        disposition <> 'unsupported_with_reason'
        or unsupported_reason is null
        or source_key is not null
      )
  ) or (
    select count(*)
    from public.source_coverage_catalog
    where company_name in ('Goldman Sachs', 'JPMorgan Chase')
  ) <> 2 then
    raise exception 'Goldman Sachs/JPMorgan Chase Unsupported evidence drifted';
  end if;
end;
$$;

-- The old branded terminal RPC remains historical but loses mutation
-- authority. Branded providers are excluded from every replacement observation
-- and claim allowlist below.
revoke execute on function public.finalize_branded_connector_candidate(
  text, text, text, text
) from service_role;

create or replace function public.finalize_workday_connector_candidate(
  p_source_key text,
  p_outcome text,
  p_reason text,
  p_evidence_digest text
)
returns table (
  accepted boolean,
  reason text,
  result_activation_state text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_name text;
  v_tenant text;
  v_region text;
  v_site text;
  v_careers_url text;
  v_existing public.companies%rowtype;
begin
  if p_source_key = 'workday:wd5:ms:External' then
    v_company_name := 'Morgan Stanley';
    v_tenant := 'ms';
    v_region := 'wd5';
    v_site := 'External';
    v_careers_url := 'https://ms.wd5.myworkdayjobs.com/en-US/External';
  elsif p_source_key = 'workday:wd1:ghr:Lateral-US' then
    v_company_name := 'Bank of America';
    v_tenant := 'ghr';
    v_region := 'wd1';
    v_site := 'Lateral-US';
    v_careers_url :=
      'https://ghr.wd1.myworkdayjobs.com/en-US/Lateral-US';
  elsif p_source_key =
    'workday:wd1:blackrock:BlackRock_Professional' then
    v_company_name := 'BlackRock';
    v_tenant := 'blackrock';
    v_region := 'wd1';
    v_site := 'BlackRock_Professional';
    v_careers_url :=
      'https://blackrock.wd1.myworkdayjobs.com/en-US/BlackRock_Professional';
  elsif p_source_key =
    'workday:wd3:barclays:External_Career_Site_Barclays' then
    v_company_name := 'Barclays';
    v_tenant := 'barclays';
    v_region := 'wd3';
    v_site := 'External_Career_Site_Barclays';
    v_careers_url :=
      'https://barclays.wd3.myworkdayjobs.com/en-US/External_Career_Site_Barclays';
  else
    return query select false, 'unknown_exact_source'::text, null::text;
    return;
  end if;

  if p_outcome not in ('admit_experimental', 'unsupported')
    or p_evidence_digest is null
    or p_evidence_digest !~ '^[0-9a-f]{64}$'
  then
    return query select false, 'invalid_terminal_evidence'::text, null::text;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('phase-03.8-workday:' || p_source_key, 0)
  );

  if exists (
    select 1
    from public.workday_connector_terminal_evidence
    where evidence_digest = p_evidence_digest
  ) then
    return query select false, 'replayed_evidence'::text, null::text;
    return;
  end if;

  select company.* into v_existing
  from public.companies as company
  where company.source_key = p_source_key
     or (
       company.name = v_company_name
       and company.ats_type = 'workday'
     )
  for update;

  if found and v_existing.activation_state = 'active' then
    return query select false, 'already_active'::text, 'active'::text;
    return;
  end if;
  if found and v_existing.activation_state = 'disabled' then
    return query select false, 'disabled_source'::text, 'disabled'::text;
    return;
  end if;

  if p_outcome = 'admit_experimental' then
    if p_reason is not null then
      return query select false, 'invalid_positive_reason'::text, null::text;
      return;
    end if;

    insert into public.workday_connector_terminal_evidence (
      source_key, evidence_digest, outcome, reason
    ) values (p_source_key, p_evidence_digest, p_outcome, null);

    update public.source_coverage_catalog
    set disposition = 'experimental',
        unsupported_reason = null,
        source_key = p_source_key,
        access_evidence =
          'Exact U.S. Workday proof accepted; three clean server-timed observations remain required.',
        verified_at = current_date
    where company_name = v_company_name
      and careers_url = v_careers_url;
    if not found then
      raise exception 'exact Workday catalog candidate missing';
    end if;

    insert into public.companies (
      name, ats_type, board_token, region, site_token, careers_url, source_key,
      activation_state, activation_successes, next_poll_at,
      last_verified_at, last_error, last_error_code, last_observation_count
    ) values (
      v_company_name, 'workday', v_tenant, v_region, v_site, v_careers_url,
      p_source_key, 'experimental', 0, clock_timestamp(),
      clock_timestamp(), null, null, null
    );

    return query select
      true, 'admitted_experimental'::text, 'experimental'::text;
    return;
  end if;

  if p_reason not in (
    'pending_current_live_contract_proof',
    'country_filter_unverified',
    'whole_site_us_scope_unproven',
    'foreign_detail_detected',
    'detail_scope_incomplete',
    'pagination_incomplete',
    'count_mismatch',
    'provider_timeout',
    'provider_schema_error',
    'positive_job_count_missing'
  ) then
    return query select false, 'invalid_unsupported_reason'::text, null::text;
    return;
  end if;

  insert into public.workday_connector_terminal_evidence (
    source_key, evidence_digest, outcome, reason
  ) values (p_source_key, p_evidence_digest, p_outcome, p_reason);

  delete from public.connector_observations as observation
  where observation.company_id in (
    select company.id
    from public.companies as company
    where company.source_key = p_source_key
      and company.activation_state = 'experimental'
  );
  delete from public.companies as company
  where company.source_key = p_source_key
    and company.activation_state = 'experimental';

  update public.source_coverage_catalog
  set disposition = 'unsupported_with_reason',
      unsupported_reason = p_reason,
      source_key = null,
      access_evidence =
        'Exact Workday proof finished Unsupported; no operational authority remains.',
      verified_at = current_date
  where company_name = v_company_name
    and careers_url = v_careers_url;
  if not found then
    raise exception 'exact Workday catalog candidate missing';
  end if;

  return query select
    true, 'recorded_unsupported'::text, 'disabled'::text;
end;
$$;

revoke execute on function public.finalize_workday_connector_candidate(
  text, text, text, text
) from public, anon, authenticated;
grant execute on function public.finalize_workday_connector_candidate(
  text, text, text, text
) to service_role;

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
  v_now timestamptz := clock_timestamp();
  v_window_interval interval := interval '1 minute';
  v_window_start timestamptz;
  v_next_eligible_at timestamptz;
  v_company public.companies%rowtype;
  v_progress integer;
begin
  if p_company_id is null
    or p_observation_id is null
    or p_completeness <> 'complete'
    or p_credible_for_closure is not true
    or p_job_count is null
    or p_job_count <= 0
    or p_expected_count is null
    or p_job_count <> p_expected_count
    or p_warning_count is null
    or p_warning_count <> 0
    or p_evidence_digest is null
    or p_evidence_digest !~ '^[0-9a-f]{64}$'
  then
    return query select
      false, 'ineligible_evidence'::text, null::integer,
      null::timestamptz, null::timestamptz, null::text;
    return;
  end if;

  set local lock_timeout = '500ms';
  begin
    select company.* into v_company
    from public.companies as company
    where company.id = p_company_id
    for update;
  exception
    when lock_not_available or query_canceled then
      return query select
        false, 'retryable_lock_contention'::text, null::integer,
        null::timestamptz, null::timestamptz, null::text;
      return;
  end;

  if not found
    or v_company.activation_state <> 'experimental'
    or v_company.ats_type <> 'workday'
    or v_company.source_key not in (
      'workday:wd5:ms:External',
      'workday:wd1:ghr:Lateral-US',
      'workday:wd1:blackrock:BlackRock_Professional',
      'workday:wd3:barclays:External_Career_Site_Barclays'
    )
  then
    return query select
      false, 'ineligible_company'::text,
      coalesce(v_company.activation_successes, 0),
      null::timestamptz, null::timestamptz, v_company.activation_state;
    return;
  end if;

  v_window_start := date_bin(
    v_window_interval, v_now, timestamptz '2000-01-01 00:00:00+00'
  );
  v_next_eligible_at := v_window_start + v_window_interval;

  if v_company.activation_successes >= 3 then
    return query select
      false, 'progress_complete'::text, 3,
      v_window_start, v_next_eligible_at, v_company.activation_state;
    return;
  end if;
  if exists (
    select 1
    from public.connector_observations
    where observation_id = p_observation_id
  ) then
    return query select
      false, 'replay'::text, v_company.activation_successes,
      v_window_start, v_next_eligible_at, v_company.activation_state;
    return;
  end if;
  if exists (
    select 1
    from public.connector_observations
    where company_id = p_company_id
      and eligibility_window_start = v_window_start
  ) then
    return query select
      false, 'same_window'::text, v_company.activation_successes,
      v_window_start, v_next_eligible_at, v_company.activation_state;
    return;
  end if;

  insert into public.connector_observations (
    observation_id, company_id, provider, observed_at,
    eligibility_window_start, completeness, credible_for_closure, job_count,
    expected_count, warning_count, evidence_digest
  ) values (
    p_observation_id, p_company_id, 'workday', v_now,
    v_window_start, p_completeness, p_credible_for_closure, p_job_count,
    p_expected_count, p_warning_count, p_evidence_digest
  );

  select count(*)::integer into v_progress
  from public.connector_observations
  where company_id = p_company_id;
  if v_progress > 3 then
    raise exception 'connector observation cap violated';
  end if;

  update public.companies as company
  set activation_successes = v_progress,
      activation_state = case
        when v_progress = 3 then 'active'
        else company.activation_state
      end,
      next_poll_at = case
        when v_progress = 3
        then v_now
          + (abs(pg_catalog.hashtextextended(company.source_key, 0)) % 5)
            * interval '1 minute'
        else v_next_eligible_at
      end,
      last_verified_at = v_now,
      last_observation_count = p_job_count,
      last_error = null,
      last_error_code = null
  where company.id = p_company_id
  returning company.activation_state into v_company.activation_state;

  return query select
    true, 'accepted'::text, v_progress,
    v_window_start, v_next_eligible_at, v_company.activation_state;
exception
  when unique_violation then
    return query select
      false, 'replay_or_same_window'::text,
      least(greatest(coalesce(v_company.activation_successes, 0), 0), 3),
      v_window_start, v_next_eligible_at, v_company.activation_state;
end;
$$;

revoke execute on function public.record_connector_observation(
  uuid, uuid, text, boolean, integer, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.record_connector_observation(
  uuid, uuid, text, boolean, integer, integer, integer, text
) to service_role;

create or replace function public.claim_due_experimental_connectors(
  batch_size integer default 3
)
returns setof public.companies
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  return query
  with due as (
    select id
    from public.companies
    where activation_state = 'experimental'
      and ats_type = 'workday'
      and source_key in (
        'workday:wd5:ms:External',
        'workday:wd1:ghr:Lateral-US',
        'workday:wd1:blackrock:BlackRock_Professional',
        'workday:wd3:barclays:External_Career_Site_Barclays'
      )
      and coalesce(next_poll_at, v_now) <= v_now
    order by next_poll_at asc nulls first, source_key
    limit greatest(1, least(coalesce(batch_size, 3), 3))
    for update skip locked
  )
  update public.companies as company
  set next_poll_at = v_now + interval '1 minute'
  from due
  where company.id = due.id
  returning company.*;
end;
$$;

revoke execute on function public.claim_due_experimental_connectors(integer)
  from public, anon, authenticated;
grant execute on function public.claim_due_experimental_connectors(integer)
  to service_role;

create or replace function public.claim_due_companies(
  batch_size integer default 10
)
returns setof public.companies
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  return query
  with due as (
    select id
    from public.companies
    where activation_state = 'active'
      and (
        ats_type in (
          'greenhouse', 'lever', 'ashby', 'smartrecruiters',
          'recruitee', 'paylocity'
        )
        or (
          ats_type = 'workday'
          and source_key in (
            'workday:wd12:capitalone:Capital_One',
            'workday:wd1:fmr:FidelityCareers',
            'workday:wd1:nasdaq:Global_External_Site',
            'workday:wd5:spgi:SPGI_Careers',
            'workday:wd5:morningstar:morningstar',
            'workday:wd1:statestreet:Global',
            'workday:wd5:ms:External',
            'workday:wd1:ghr:Lateral-US',
            'workday:wd1:blackrock:BlackRock_Professional',
            'workday:wd3:barclays:External_Career_Site_Barclays'
          )
        )
      )
      and coalesce(
        next_poll_at,
        last_polled_at,
        '-infinity'::timestamptz
      ) <= v_now
    order by coalesce(next_poll_at, last_polled_at) asc nulls first, source_key
    limit greatest(1, least(coalesce(batch_size, 10), 10))
    for update skip locked
  )
  update public.companies as company
  set last_polled_at = v_now,
      next_poll_at = v_now + interval '10 minutes'
  from due
  where company.id = due.id
  returning company.*;
end;
$$;

revoke execute on function public.claim_due_companies(integer)
  from public, anon, authenticated;
grant execute on function public.claim_due_companies(integer)
  to service_role;

do $$
begin
  if exists (
    select 1
    from public.companies
    where source_key in (
      'workday:wd5:ms:External',
      'workday:wd1:ghr:Lateral-US',
      'workday:wd1:blackrock:BlackRock_Professional',
      'workday:wd3:barclays:External_Career_Site_Barclays'
    )
  ) then
    raise exception 'migration application must not pre-admit Workday candidates';
  end if;

  if (
    select count(*)
    from public.source_coverage_catalog
    where company_name in (
      'Morgan Stanley', 'Goldman Sachs', 'JPMorgan Chase',
      'Bank of America', 'BlackRock', 'UBS', 'Barclays', 'Charles Schwab'
    )
  ) <> 8 then
    raise exception 'Phase 03.8 revised eight-target catalog parity failed';
  end if;

  if (
    select count(*)
    from public.phase_03_8_verifier_runs
    where run_id = '03850000-0000-4000-8000-000000000501'::uuid
      and release_manifest_id =
        '03850000-0000-4000-8000-000000000005'::uuid
      and state = 'armed'
      and started_at is null
      and expires_at is null
      and exercise_calls = 0
      and max_exercise_calls = 12
  ) <> 1 or exists (
    select 1
    from public.phase_03_8_verifier_fixtures
    where run_id = '03850000-0000-4000-8000-000000000501'::uuid
  ) then
    raise exception 'phase 03.8 verifier is not pristine and armed';
  end if;

  if (
    select count(*)
    from phase_03_8_protected_workday_0043_before
  ) <> 2 then
    raise exception 'Capital One/Fidelity protected identity parity failed';
  end if;

  if exists (
    select 1
    from phase_03_8_protected_workday_0043_before as before_row
    full join (
      select
        id, name, ats_type, board_token, region, site_token, careers_url,
        source_key, activation_state, activation_successes, next_poll_at,
        last_polled_at, last_success_at, consecutive_failures, last_error,
        last_error_code
      from public.companies
      where source_key in (
        'workday:wd12:capitalone:Capital_One',
        'workday:wd1:fmr:FidelityCareers'
      )
    ) as after_row using (id)
    where before_row.id is null
      or after_row.id is null
      or before_row.name is distinct from after_row.name
      or before_row.ats_type is distinct from after_row.ats_type
      or before_row.board_token is distinct from after_row.board_token
      or before_row.region is distinct from after_row.region
      or before_row.site_token is distinct from after_row.site_token
      or before_row.careers_url is distinct from after_row.careers_url
      or before_row.source_key is distinct from after_row.source_key
      or before_row.activation_state is distinct from after_row.activation_state
      or before_row.activation_successes is distinct from
        after_row.activation_successes
      or before_row.next_poll_at is distinct from after_row.next_poll_at
      or before_row.last_polled_at is distinct from after_row.last_polled_at
      or before_row.last_success_at is distinct from after_row.last_success_at
      or before_row.consecutive_failures is distinct from
        after_row.consecutive_failures
      or before_row.last_error is distinct from after_row.last_error
      or before_row.last_error_code is distinct from after_row.last_error_code
  ) then
    raise exception 'Capital One/Fidelity protected identity parity failed';
  end if;

  if exists (
    select 1
    from public.companies
    where source_key in (
      'workday:wd12:capitalone:Capital_One',
      'workday:wd1:fmr:FidelityCareers'
    )
      and activation_state <> 'active'
  ) then
    raise exception 'Capital One/Fidelity Active parity failed';
  end if;
end;
$$;

comment on table public.workday_connector_terminal_evidence is
  'Replay-safe exact Phase 03.8 Workday candidate terminal evidence.';
comment on function public.finalize_workday_connector_candidate(
  text, text, text, text
) is
  'Service-role-only exact Workday candidate admission or bounded Unsupported terminalization.';

commit;

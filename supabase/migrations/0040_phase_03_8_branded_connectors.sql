begin;

-- Phase 03.8 Plan 04 is intentionally local-only until the approval-gated
-- rollout. Migration application records truthful Unsupported evidence and
-- never admits a branded candidate from migration or fixture bytes.

create extension if not exists pgcrypto with schema extensions;

create temporary table phase_03_8_protected_workday_before on commit drop as
select
  id, name, ats_type, board_token, region, site_token, careers_url, source_key,
  activation_state, activation_successes
from public.companies
where source_key in (
  'workday:wd12:capitalone:Capital_One',
  'workday:wd1:fmr:FidelityCareers'
);

alter table public.companies
  drop constraint companies_ats_type_check,
  add constraint companies_ats_type_check check (
    ats_type in (
      'greenhouse', 'lever', 'ashby', 'smartrecruiters', 'recruitee',
      'workday', 'paylocity', 'eightfold', 'oracle_recruiting',
      'goldman_higher'
    )
  ),
  add column if not exists next_poll_at timestamptz,
  add constraint companies_branded_identity_check check (
    ats_type not in ('eightfold', 'oracle_recruiting', 'goldman_higher')
    or (
      (
        ats_type = 'eightfold'
        and name = 'Morgan Stanley'
        and board_token = 'eightfold:morganstanley'
        and region is null
        and site_token is null
        and careers_url = 'https://www.morganstanley.com/careers/career-opportunities-search/'
        and source_key = 'eightfold:morganstanley'
      )
      or (
        ats_type = 'oracle_recruiting'
        and name = 'JPMorgan Chase'
        and board_token = 'oracle:jpmc:CX_1001'
        and region is null
        and site_token is null
        and careers_url = 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/requisitions'
        and source_key = 'oracle:jpmc:CX_1001'
      )
      or (
        ats_type = 'goldman_higher'
        and name = 'Goldman Sachs'
        and board_token = 'goldman_higher:roles'
        and region is null
        and site_token is null
        and careers_url = 'https://higher.gs.com/roles'
        and source_key = 'goldman_higher:roles'
      )
    ) is true
  );

alter table public.jobs
  drop constraint jobs_source_check,
  add constraint jobs_source_check check (
    source in (
      'greenhouse', 'lever', 'ashby', 'smartrecruiters', 'recruitee',
      'adzuna', 'workday', 'paylocity', 'eightfold',
      'oracle_recruiting', 'goldman_higher'
    )
  ),
  add column scope_evidence jsonb,
  add constraint jobs_scope_evidence_check check (
    (
      source not in ('eightfold', 'oracle_recruiting', 'goldman_higher')
      and scope_evidence is null
    )
    or (
      source in ('eightfold', 'oracle_recruiting', 'goldman_higher')
      and jsonb_typeof(scope_evidence) = 'object'
      and scope_evidence ?& array[
        'sourceKey', 'providerCategoryLabel', 'matchedTerm',
        'detailCountryCode', 'externalIdDigest'
      ]
      and scope_evidence - array[
        'sourceKey', 'providerCategoryLabel', 'matchedTerm',
        'detailCountryCode', 'externalIdDigest'
      ] = '{}'::jsonb
      and scope_evidence ->> 'sourceKey' in (
        'eightfold:morganstanley',
        'oracle:jpmc:CX_1001',
        'goldman_higher:roles'
      )
      and scope_evidence ->> 'sourceKey' = case source
        when 'eightfold' then 'eightfold:morganstanley'
        when 'oracle_recruiting' then 'oracle:jpmc:CX_1001'
        when 'goldman_higher' then 'goldman_higher:roles'
      end
      and length(scope_evidence ->> 'providerCategoryLabel') between 1 and 160
      and scope_evidence ->> 'matchedTerm' in (
        'Data', 'Technology', 'Finance', 'Investment',
        'Research', 'Risk', 'Capital Markets'
      )
      and scope_evidence ->> 'detailCountryCode' = 'US'
      and scope_evidence ->> 'externalIdDigest' ~ '^[0-9a-f]{64}$'
      and scope_evidence ->> 'externalIdDigest' = pg_catalog.encode(
        extensions.digest(
          convert_to(
            concat(
              '[',
              to_json(scope_evidence ->> 'sourceKey')::text, ',',
              to_json(external_id)::text, ',',
              to_json(scope_evidence ->> 'providerCategoryLabel')::text, ',',
              to_json(scope_evidence ->> 'matchedTerm')::text, ',',
              to_json('US'::text)::text,
              ']'
            ),
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      )
    )
  );

alter table public.connector_observations
  drop constraint connector_observations_provider_check,
  add constraint connector_observations_provider_check check (
    provider in (
      'smartrecruiters', 'recruitee', 'workday', 'paylocity',
      'eightfold', 'oracle_recruiting', 'goldman_higher'
    )
  );

revoke all on table public.connector_observations from public, anon, authenticated;
grant select, insert, update, delete on table public.connector_observations to service_role;

create table public.branded_connector_terminal_evidence (
  source_key text not null,
  evidence_digest text primary key,
  outcome text not null check (outcome in ('admit_experimental', 'unsupported')),
  reason text,
  recorded_at timestamptz not null default clock_timestamp(),
  constraint branded_terminal_source_check check (
    source_key in (
      'eightfold:morganstanley',
      'oracle:jpmc:CX_1001',
      'goldman_higher:roles'
    )
  ),
  constraint branded_terminal_digest_check check (
    evidence_digest ~ '^[0-9a-f]{64}$'
  ),
  constraint branded_terminal_reason_check check (
    (
      outcome = 'admit_experimental'
      and reason is null
    )
    or (
      outcome = 'unsupported'
      and reason in (
        'pending_current_live_contract_proof',
        'provider_timeout',
        'provider_schema_error',
        'category_evidence_missing',
        'scope_evidence_incomplete',
        'positive_job_count_missing',
        'pagination_incomplete',
        'count_mismatch'
      )
    )
  )
);

alter table public.branded_connector_terminal_evidence enable row level security;
revoke all on table public.branded_connector_terminal_evidence
  from public, anon, authenticated;
grant select, insert on table public.branded_connector_terminal_evidence
  to service_role;

insert into public.source_coverage_catalog (
  company_name, careers_url, provider, access_evidence, disposition,
  verified_at, unsupported_reason, source_key
)
values
  (
    'Morgan Stanley',
    'https://www.morganstanley.com/careers/career-opportunities-search/',
    'Eightfold',
    'Current anonymous structured contract is implemented but remains untrusted until exact hosted live proof terminalizes it.',
    'unsupported_with_reason', date '2026-07-25',
    'pending_current_live_contract_proof', null
  ),
  (
    'JPMorgan Chase',
    'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/requisitions',
    'Oracle Recruiting Cloud',
    'Current anonymous structured contract is implemented but remains untrusted until exact hosted live proof terminalizes it.',
    'unsupported_with_reason', date '2026-07-25',
    'pending_current_live_contract_proof', null
  ),
  (
    'Goldman Sachs',
    'https://higher.gs.com/roles',
    'Goldman Higher',
    'Current anonymous structured contract is implemented but remains untrusted until exact hosted live proof terminalizes it.',
    'unsupported_with_reason', date '2026-07-25',
    'pending_current_live_contract_proof', null
  ),
  (
    'Bank of America',
    'https://careers.bankofamerica.com/en-us/job-search',
    'Branded/custom AEM',
    'The primary portal exposes HTML only and no stable anonymous structured machine contract.',
    'unsupported_with_reason', date '2026-07-25',
    'primary_portal_html_only_no_structured_machine_contract', null
  ),
  (
    'Citi',
    'https://jobs.citi.com/search-jobs',
    'Radancy/TalentBrew',
    'The primary Radancy results require prohibited HTML parsing.',
    'unsupported_with_reason', date '2026-07-25',
    'radancy_results_require_html_parsing', null
  ),
  (
    'BlackRock',
    'https://careers.blackrock.com/search-jobs',
    'Radancy/TalentBrew',
    'The primary Radancy results require prohibited HTML parsing.',
    'unsupported_with_reason', date '2026-07-25',
    'radancy_results_require_html_parsing', null
  ),
  (
    'Wells Fargo',
    'https://www.wellsfargojobs.com/en/jobs/',
    'Branded/custom',
    'The primary portal presents a managed challenge and no bypass is permitted.',
    'unsupported_with_reason', date '2026-07-25',
    'primary_portal_managed_challenge_no_bypass', null
  ),
  (
    'UBS',
    'https://jobs.ubs.com/TGnewUI/Search/Home/HomeWithPreLoad?PageType=JobDetails&partnerid=25008&siteid=5012',
    'Oracle Taleo',
    'The structured endpoint requires a browser HTML bootstrap session.',
    'unsupported_with_reason', date '2026-07-25',
    'structured_endpoint_requires_html_bootstrap_session', null
  ),
  (
    'Barclays',
    'https://search.jobs.barclays/en/search-jobs',
    'Radancy/TalentBrew',
    'The primary Radancy results require prohibited HTML parsing.',
    'unsupported_with_reason', date '2026-07-25',
    'radancy_results_require_html_parsing', null
  ),
  (
    'Charles Schwab',
    'https://www.schwabjobs.com/job-search-results/',
    'iCIMS / Radancy',
    'The primary Radancy results require prohibited HTML parsing.',
    'unsupported_with_reason', date '2026-07-25',
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

do $$
declare
  frozen_count integer;
begin
  select count(*) into frozen_count
  from public.source_coverage_catalog
  where company_name in (
    'Morgan Stanley', 'Goldman Sachs', 'JPMorgan Chase', 'Bank of America',
    'Citi', 'BlackRock', 'Wells Fargo', 'UBS', 'Barclays', 'Charles Schwab'
  );
  if frozen_count <> 10 then
    raise exception 'Phase 03.8 frozen roster parity failed';
  end if;
  if exists (
    select 1 from public.companies
    where source_key in (
      'eightfold:morganstanley',
      'oracle:jpmc:CX_1001',
      'goldman_higher:roles'
    )
  ) then
    raise exception 'migration application must not pre-admit branded candidates';
  end if;
end;
$$;

create or replace function public.finalize_branded_connector_candidate(
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
  v_provider text;
  v_careers_url text;
  v_existing public.companies%rowtype;
begin
  if p_source_key = 'eightfold:morganstanley' then
    v_company_name := 'Morgan Stanley';
    v_provider := 'eightfold';
    v_careers_url := 'https://www.morganstanley.com/careers/career-opportunities-search/';
  elsif p_source_key = 'oracle:jpmc:CX_1001' then
    v_company_name := 'JPMorgan Chase';
    v_provider := 'oracle_recruiting';
    v_careers_url := 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/requisitions';
  elsif p_source_key = 'goldman_higher:roles' then
    v_company_name := 'Goldman Sachs';
    v_provider := 'goldman_higher';
    v_careers_url := 'https://higher.gs.com/roles';
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
    pg_catalog.hashtextextended('phase-03.8:' || p_source_key, 0)
  );

  if exists (
    select 1 from public.branded_connector_terminal_evidence
    where evidence_digest = p_evidence_digest
  ) then
    return query select false, 'replayed_evidence'::text, null::text;
    return;
  end if;

  select * into v_existing
  from public.companies
  where source_key = p_source_key
     or (
       name = v_company_name
       and ats_type in ('eightfold', 'oracle_recruiting', 'goldman_higher')
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

    insert into public.branded_connector_terminal_evidence (
      source_key, evidence_digest, outcome, reason
    ) values (p_source_key, p_evidence_digest, p_outcome, null);

    update public.source_coverage_catalog
    set disposition = 'experimental',
        unsupported_reason = null,
        source_key = p_source_key,
        access_evidence = 'Current exact hosted live proof accepted; three clean server-timed observations remain required.',
        verified_at = current_date
    where company_name = v_company_name
      and careers_url = v_careers_url;
    if not found then
      raise exception 'exact catalog candidate missing';
    end if;

    insert into public.companies (
      name, ats_type, board_token, region, site_token, careers_url, source_key,
      activation_state, activation_successes, next_poll_at,
      last_verified_at, last_error, last_error_code, last_observation_count
    ) values (
      v_company_name, v_provider, p_source_key, null, null, v_careers_url,
      p_source_key, 'experimental', 0, clock_timestamp(),
      clock_timestamp(), null, null, null
    );

    return query select true, 'admitted_experimental'::text, 'experimental'::text;
    return;
  end if;

  if p_reason not in (
    'pending_current_live_contract_proof',
    'provider_timeout',
    'provider_schema_error',
    'category_evidence_missing',
    'scope_evidence_incomplete',
    'positive_job_count_missing',
    'pagination_incomplete',
    'count_mismatch'
  ) then
    return query select false, 'invalid_unsupported_reason'::text, null::text;
    return;
  end if;

  insert into public.branded_connector_terminal_evidence (
    source_key, evidence_digest, outcome, reason
  ) values (p_source_key, p_evidence_digest, p_outcome, p_reason);

  delete from public.connector_observations
  where company_id in (
    select id from public.companies where source_key = p_source_key
  );
  delete from public.companies
  where source_key = p_source_key
    and activation_state = 'experimental';

  update public.source_coverage_catalog
  set disposition = 'unsupported_with_reason',
      unsupported_reason = p_reason,
      source_key = null,
      access_evidence = 'Current exact hosted proof finished Unsupported; no operational authority remains.',
      verified_at = current_date
  where company_name = v_company_name
    and careers_url = v_careers_url;
  if not found then
    raise exception 'exact catalog candidate missing';
  end if;

  return query select true, 'recorded_unsupported'::text, 'disabled'::text;
end;
$$;

revoke execute on function public.finalize_branded_connector_candidate(text, text, text, text) from public, anon, authenticated;
grant execute on function public.finalize_branded_connector_candidate(text, text, text, text) to service_role;

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
  v_window_interval interval;
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
    return query select false, 'ineligible_evidence'::text, null::integer,
      null::timestamptz, null::timestamptz, null::text;
    return;
  end if;

  set local lock_timeout = '500ms';
  begin
    select * into v_company
    from public.companies as c
    where c.id = p_company_id
    for update;
  exception
    when lock_not_available or query_canceled then
      return query select false, 'retryable_lock_contention'::text, null::integer,
        null::timestamptz, null::timestamptz, null::text;
      return;
  end;

  if not found
    or v_company.activation_state <> 'experimental'
    or (v_company.ats_type, v_company.source_key) not in (
      ('eightfold', 'eightfold:morganstanley'),
      ('oracle_recruiting', 'oracle:jpmc:CX_1001'),
      ('goldman_higher', 'goldman_higher:roles')
    )
  then
    return query select false, 'ineligible_company'::text,
      coalesce(v_company.activation_successes, 0), null::timestamptz,
      null::timestamptz, v_company.activation_state;
    return;
  end if;

  v_window_interval := interval '1 minute';
  v_window_start := date_bin(
    v_window_interval, v_now, timestamptz '2000-01-01 00:00:00+00'
  );
  v_next_eligible_at := v_window_start + v_window_interval;

  if v_company.activation_successes >= 3 then
    return query select false, 'progress_complete'::text, 3,
      v_window_start, v_next_eligible_at, v_company.activation_state;
    return;
  end if;
  if exists (
    select 1 from public.connector_observations
    where observation_id = p_observation_id
  ) then
    return query select false, 'replay'::text, v_company.activation_successes,
      v_window_start, v_next_eligible_at, v_company.activation_state;
    return;
  end if;
  if exists (
    select 1 from public.connector_observations
    where company_id = p_company_id
      and eligibility_window_start = v_window_start
  ) then
    return query select false, 'same_window'::text, v_company.activation_successes,
      v_window_start, v_next_eligible_at, v_company.activation_state;
    return;
  end if;

  insert into public.connector_observations (
    observation_id, company_id, provider, observed_at,
    eligibility_window_start, completeness, credible_for_closure, job_count,
    expected_count, warning_count, evidence_digest
  ) values (
    p_observation_id, p_company_id, v_company.ats_type, v_now,
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
      activation_state = case when v_progress = 3 then 'active'
                              else company.activation_state end,
      next_poll_at = case
        when v_progress = 3
        then v_now + (abs(hashtextextended(company.source_key, 0)) % 5) * interval '1 minute'
        else v_next_eligible_at
      end,
      last_verified_at = v_now,
      last_observation_count = p_job_count,
      last_error = null,
      last_error_code = null
  where company.id = p_company_id
  returning company.activation_state into v_company.activation_state;

  return query select true, 'accepted'::text, v_progress,
    v_window_start, v_next_eligible_at, v_company.activation_state;
exception
  when unique_violation then
    return query select false, 'replay_or_same_window'::text,
      least(greatest(coalesce(v_company.activation_successes, 0), 0), 3),
      v_window_start, v_next_eligible_at, v_company.activation_state;
end;
$$;

revoke execute on function public.record_connector_observation(uuid, uuid, text, boolean, integer, integer, integer, text) from public, anon, authenticated;
grant execute on function public.record_connector_observation(uuid, uuid, text, boolean, integer, integer, integer, text) to service_role;

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
      and (ats_type, source_key) in (
        ('eightfold', 'eightfold:morganstanley'),
        ('oracle_recruiting', 'oracle:jpmc:CX_1001'),
        ('goldman_higher', 'goldman_higher:roles')
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

revoke execute on function public.claim_due_experimental_connectors(integer) from public, anon, authenticated;
grant execute on function public.claim_due_experimental_connectors(integer) to service_role;

create or replace function public.claim_due_companies(batch_size integer default 10)
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
            'workday:wd1:statestreet:Global'
          )
        )
        or (ats_type, source_key) in (
          ('eightfold', 'eightfold:morganstanley'),
          ('oracle_recruiting', 'oracle:jpmc:CX_1001'),
          ('goldman_higher', 'goldman_higher:roles')
        )
      )
      and coalesce(next_poll_at, last_polled_at, '-infinity'::timestamptz) <= v_now
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

revoke execute on function public.claim_due_companies(integer) from public, anon, authenticated;
grant execute on function public.claim_due_companies(integer) to service_role;

-- The hosted verifier authority is a single compile-time release latch. It is
-- deliberately incapable of selecting a provider, network coordinate, real
-- company, or real job. Only these exact disposable identities can be seeded.
create table public.phase_03_8_verifier_runs (
  run_id uuid primary key,
  release_manifest_id uuid not null,
  state text not null default 'armed' check (
    state in ('armed', 'running', 'consumed')
  ),
  created_at timestamptz not null default clock_timestamp(),
  started_at timestamptz,
  expires_at timestamptz,
  exercise_calls integer not null default 0 check (
    exercise_calls between 0 and 12
  ),
  max_exercise_calls integer not null default 12 check (
    max_exercise_calls = 12
  ),
  constraint phase_03_8_verifier_run_identity_check check (
    run_id = '03850000-0000-4000-8000-000000000501'::uuid
    and release_manifest_id = '03850000-0000-4000-8000-000000000005'::uuid
  ),
  constraint phase_03_8_verifier_run_time_check check (
    (
      state = 'armed'
      and started_at is null
      and expires_at is null
    )
    or (
      state in ('running', 'consumed')
      and started_at is not null
      and expires_at is not null
      and expires_at > started_at
      and expires_at <= started_at + interval '20 minutes'
    )
  )
);

create table public.phase_03_8_verifier_fixtures (
  run_id uuid not null,
  fixture_key text not null check (
    fixture_key in (
      'eightfold_fixture', 'oracle_fixture', 'goldman_fixture'
    )
  ),
  company_id uuid not null,
  job_id uuid not null,
  observation_id uuid not null,
  fixture_version integer not null default 0 check (
    fixture_version between 0 and 12
  ),
  last_fault text check (
    last_fault is null
    or last_fault in (
      'incomplete_observation', 'provider_schema_error',
      'provider_timeout', 'clean_recovery'
    )
  ),
  primary key (run_id, fixture_key),
  unique (company_id),
  unique (job_id),
  unique (observation_id),
  constraint phase_03_8_verifier_fixture_run_fk
    foreign key (run_id)
    references public.phase_03_8_verifier_runs(run_id)
    on delete restrict,
  constraint phase_03_8_verifier_fixture_company_fk
    foreign key (company_id)
    references public.companies(id)
    on delete restrict
    deferrable initially deferred,
  constraint phase_03_8_verifier_fixture_job_fk
    foreign key (job_id)
    references public.jobs(id)
    on delete restrict
    deferrable initially deferred,
  constraint phase_03_8_verifier_fixture_literal_ids_check check (
    (
      fixture_key = 'eightfold_fixture'
      and company_id = '03850000-0000-4000-8000-000000000511'::uuid
      and job_id = '03850000-0000-4000-8000-000000000512'::uuid
      and observation_id = '03850000-0000-4000-8000-000000000513'::uuid
    )
    or (
      fixture_key = 'oracle_fixture'
      and company_id = '03850000-0000-4000-8000-000000000521'::uuid
      and job_id = '03850000-0000-4000-8000-000000000522'::uuid
      and observation_id = '03850000-0000-4000-8000-000000000523'::uuid
    )
    or (
      fixture_key = 'goldman_fixture'
      and company_id = '03850000-0000-4000-8000-000000000531'::uuid
      and job_id = '03850000-0000-4000-8000-000000000532'::uuid
      and observation_id = '03850000-0000-4000-8000-000000000533'::uuid
    )
  )
);

alter table public.phase_03_8_verifier_runs enable row level security;
alter table public.phase_03_8_verifier_fixtures enable row level security;
revoke all on table public.phase_03_8_verifier_runs
  from public, anon, authenticated, service_role;
revoke all on table public.phase_03_8_verifier_fixtures
  from public, anon, authenticated, service_role;

insert into public.phase_03_8_verifier_runs (
  run_id, release_manifest_id, state
) values (
  '03850000-0000-4000-8000-000000000501'::uuid,
  '03850000-0000-4000-8000-000000000005'::uuid,
  'armed'
);

create or replace function public.begin_phase_03_8_verifier_run(
  p_run_id uuid
)
returns table (
  started boolean,
  expires_at timestamptz,
  exercise_calls integer,
  fixture_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_expires_at timestamptz;
  v_fixture_count integer;
begin
  if p_run_id is distinct from
    '03850000-0000-4000-8000-000000000501'::uuid
  then
    raise exception using errcode = '22023',
      message = 'unknown verifier run';
  end if;

  update public.phase_03_8_verifier_runs
  set state = 'running',
      started_at = v_now,
      expires_at = v_now + interval '20 minutes'
  where run_id = p_run_id
    and release_manifest_id =
      '03850000-0000-4000-8000-000000000005'::uuid
    and state = 'armed'
    and started_at is null
    and expires_at is null
    and exercise_calls = 0
  returning phase_03_8_verifier_runs.expires_at
  into v_expires_at;
  if not found then
    raise exception using errcode = '55000',
      message = 'verifier run is not armed';
  end if;

  if exists (
    select 1 from public.companies
    where id in (
      '03850000-0000-4000-8000-000000000511'::uuid,
      '03850000-0000-4000-8000-000000000521'::uuid,
      '03850000-0000-4000-8000-000000000531'::uuid
    )
      or source_key in (
        'phase03_8_verifier:eightfold_fixture',
        'phase03_8_verifier:oracle_fixture',
        'phase03_8_verifier:goldman_fixture'
      )
  ) or exists (
    select 1 from public.jobs
    where id in (
      '03850000-0000-4000-8000-000000000512'::uuid,
      '03850000-0000-4000-8000-000000000522'::uuid,
      '03850000-0000-4000-8000-000000000532'::uuid
    )
      or external_id like 'phase03_8_verifier:%'
  ) then
    raise exception using errcode = '23505',
      message = 'verifier fixture collision';
  end if;

  insert into public.companies (
    id, name, ats_type, board_token, region, careers_url, source_key,
    site_token, activation_state, activation_successes, next_poll_at,
    last_verified_at, last_success_at, consecutive_failures,
    last_error, last_error_code, last_observation_count
  ) values
    (
      '03850000-0000-4000-8000-000000000511'::uuid,
      'Phase 03.8 Verifier Eightfold', 'greenhouse',
      'phase03-8-verifier-eightfold', null,
      'https://example.invalid/phase03-8/eightfold',
      'phase03_8_verifier:eightfold_fixture', null,
      'active', 3, 'infinity'::timestamptz, v_now, v_now, 0,
      null, null, 1
    ),
    (
      '03850000-0000-4000-8000-000000000521'::uuid,
      'Phase 03.8 Verifier Oracle', 'greenhouse',
      'phase03-8-verifier-oracle', null,
      'https://example.invalid/phase03-8/oracle',
      'phase03_8_verifier:oracle_fixture', null,
      'active', 3, 'infinity'::timestamptz, v_now, v_now, 0,
      null, null, 1
    ),
    (
      '03850000-0000-4000-8000-000000000531'::uuid,
      'Phase 03.8 Verifier Goldman', 'greenhouse',
      'phase03-8-verifier-goldman', null,
      'https://example.invalid/phase03-8/goldman',
      'phase03_8_verifier:goldman_fixture', null,
      'active', 3, 'infinity'::timestamptz, v_now, v_now, 0,
      null, null, 1
    );

  insert into public.jobs (
    id, company_id, source, external_id, title, location, absolute_url,
    posted_at, description_text, snapshot_partial, fingerprint, status,
    first_seen_at, last_seen_at, closed_at
  ) values
    (
      '03850000-0000-4000-8000-000000000512'::uuid,
      '03850000-0000-4000-8000-000000000511'::uuid,
      'greenhouse', 'phase03_8_verifier:eightfold_fixture',
      'Phase 03.8 Verifier Eightfold Job', 'Chicago, IL',
      'https://example.invalid/phase03-8/eightfold/job',
      v_now, 'Disposable lifecycle verifier row.', false,
      'phase03_8_verifier:eightfold_fixture', 'open', v_now, v_now, null
    ),
    (
      '03850000-0000-4000-8000-000000000522'::uuid,
      '03850000-0000-4000-8000-000000000521'::uuid,
      'greenhouse', 'phase03_8_verifier:oracle_fixture',
      'Phase 03.8 Verifier Oracle Job', 'Chicago, IL',
      'https://example.invalid/phase03-8/oracle/job',
      v_now, 'Disposable lifecycle verifier row.', false,
      'phase03_8_verifier:oracle_fixture', 'open', v_now, v_now, null
    ),
    (
      '03850000-0000-4000-8000-000000000532'::uuid,
      '03850000-0000-4000-8000-000000000531'::uuid,
      'greenhouse', 'phase03_8_verifier:goldman_fixture',
      'Phase 03.8 Verifier Goldman Job', 'Chicago, IL',
      'https://example.invalid/phase03-8/goldman/job',
      v_now, 'Disposable lifecycle verifier row.', false,
      'phase03_8_verifier:goldman_fixture', 'open', v_now, v_now, null
    );

  insert into public.phase_03_8_verifier_fixtures (
    run_id, fixture_key, company_id, job_id, observation_id
  ) values
    (
      p_run_id, 'eightfold_fixture',
      '03850000-0000-4000-8000-000000000511'::uuid,
      '03850000-0000-4000-8000-000000000512'::uuid,
      '03850000-0000-4000-8000-000000000513'::uuid
    ),
    (
      p_run_id, 'oracle_fixture',
      '03850000-0000-4000-8000-000000000521'::uuid,
      '03850000-0000-4000-8000-000000000522'::uuid,
      '03850000-0000-4000-8000-000000000523'::uuid
    ),
    (
      p_run_id, 'goldman_fixture',
      '03850000-0000-4000-8000-000000000531'::uuid,
      '03850000-0000-4000-8000-000000000532'::uuid,
      '03850000-0000-4000-8000-000000000533'::uuid
    );

  select count(*)::integer into v_fixture_count
  from public.phase_03_8_verifier_fixtures
  where run_id = p_run_id;
  if v_fixture_count <> 3 then
    raise exception 'verifier fixture seed count mismatch';
  end if;

  return query select true, v_expires_at, 0, v_fixture_count;
end;
$$;

create or replace function public.exercise_phase_03_8_verifier_fault(
  p_run_id uuid,
  p_fixture text,
  p_fault text,
  p_expected_version integer
)
returns table (
  fixture_key text,
  fixture_version integer,
  fault text,
  job_status text,
  activation_state text,
  consecutive_failures integer,
  last_error_code text,
  last_success_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.phase_03_8_verifier_runs%rowtype;
  v_fixture public.phase_03_8_verifier_fixtures%rowtype;
  v_company public.companies%rowtype;
  v_job_status text;
  v_company_count integer;
begin
  if p_run_id is distinct from
      '03850000-0000-4000-8000-000000000501'::uuid
    or p_fixture not in (
      'eightfold_fixture', 'oracle_fixture', 'goldman_fixture'
    )
    or p_fault not in (
      'incomplete_observation', 'provider_schema_error',
      'provider_timeout', 'clean_recovery'
    )
    or p_expected_version is null
    or p_expected_version < 0
    or p_expected_version > 12
  then
    raise exception using errcode = '22023',
      message = 'invalid fixed verifier fault request';
  end if;

  select * into v_run
  from public.phase_03_8_verifier_runs
  where run_id = p_run_id
  for update;
  if not found
    or v_run.state <> 'running'
    or not (v_run.expires_at > clock_timestamp())
    or v_run.exercise_calls >= v_run.max_exercise_calls
  then
    raise exception using errcode = '55000',
      message = 'verifier authority unavailable';
  end if;

  select * into v_fixture
  from public.phase_03_8_verifier_fixtures
  where run_id = p_run_id
    and fixture_key = p_fixture
    and fixture_version = p_expected_version
  for update;
  if not found then
    raise exception using errcode = '40001',
      message = 'stale or unknown verifier fixture';
  end if;

  select status into v_job_status
  from public.jobs
  where id = v_fixture.job_id
    and company_id = v_fixture.company_id
  for update;
  if not found or v_job_status <> 'open' then
    raise exception 'owned verifier job is not open';
  end if;

  if p_fault = 'clean_recovery' then
    update public.companies
    set activation_state = 'active',
        last_success_at = clock_timestamp(),
        consecutive_failures = 0,
        last_error = null,
        last_error_code = null,
        last_observation_count = 1,
        next_poll_at = 'infinity'::timestamptz
    where id = v_fixture.company_id
      and source_key = 'phase03_8_verifier:' || p_fixture;
    get diagnostics v_company_count = row_count;
    update public.pipeline_heartbeat
    set last_success_at = clock_timestamp()
    where id = true;
  else
    update public.companies
    set activation_state = 'active',
        consecutive_failures = consecutive_failures + 1,
        last_error = p_fault,
        last_error_code = p_fault,
        last_observation_count = 0,
        next_poll_at = 'infinity'::timestamptz
    where id = v_fixture.company_id
      and source_key = 'phase03_8_verifier:' || p_fixture;
    get diagnostics v_company_count = row_count;
  end if;
  if v_company_count <> 1 then
    raise exception 'owned verifier company mismatch';
  end if;

  update public.phase_03_8_verifier_fixtures
  set fixture_version = fixture_version + 1,
      last_fault = p_fault
  where run_id = p_run_id
    and fixture_key = p_fixture
    and fixture_version = p_expected_version
  returning * into v_fixture;
  if not found then
    raise exception using errcode = '40001',
      message = 'verifier fixture version changed';
  end if;

  update public.phase_03_8_verifier_runs
  set exercise_calls = exercise_calls + 1
  where run_id = p_run_id
    and state = 'running'
    and exercise_calls < max_exercise_calls;
  if not found then
    raise exception 'verifier call budget exhausted';
  end if;

  select * into v_company
  from public.companies
  where id = v_fixture.company_id;
  select status into v_job_status
  from public.jobs
  where id = v_fixture.job_id;
  if v_job_status <> 'open' then
    raise exception 'verifier fault closed an owned job';
  end if;

  return query select
    v_fixture.fixture_key,
    v_fixture.fixture_version,
    p_fault,
    v_job_status,
    v_company.activation_state,
    v_company.consecutive_failures,
    v_company.last_error_code,
    v_company.last_success_at;
end;
$$;

create or replace function public.finish_phase_03_8_verifier_run(
  p_run_id uuid,
  p_eightfold_expected_version integer,
  p_oracle_expected_version integer,
  p_goldman_expected_version integer
)
returns table (
  consumed boolean,
  release_manifest_id uuid,
  run_id uuid,
  exercise_calls integer,
  deleted_fixtures integer,
  remaining_rows integer,
  grants_revoked boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.phase_03_8_verifier_runs%rowtype;
  v_fixture_count integer;
  v_job_count integer;
  v_company_count integer;
  v_remaining integer;
  v_company_ids uuid[];
  v_job_ids uuid[];
  v_manifest_id uuid;
  v_calls integer;
begin
  if p_run_id is distinct from
    '03850000-0000-4000-8000-000000000501'::uuid
  then
    raise exception using errcode = '22023',
      message = 'unknown verifier run';
  end if;

  select * into v_run
  from public.phase_03_8_verifier_runs
  where phase_03_8_verifier_runs.run_id = p_run_id
  for update;
  if not found or v_run.state <> 'running' then
    raise exception using errcode = '55000',
      message = 'verifier run is not running';
  end if;

  if not exists (
    select 1
    from public.phase_03_8_verifier_fixtures
    where run_id = p_run_id
    group by run_id
    having count(*) = 3
      and bool_and(
        (fixture_key = 'eightfold_fixture'
          and fixture_version = p_eightfold_expected_version)
        or (fixture_key = 'oracle_fixture'
          and fixture_version = p_oracle_expected_version)
        or (fixture_key = 'goldman_fixture'
          and fixture_version = p_goldman_expected_version)
      )
  ) then
    raise exception using errcode = '40001',
      message = 'verifier finish version mismatch';
  end if;

  select
    array_agg(company_id order by fixture_key),
    array_agg(job_id order by fixture_key)
  into v_company_ids, v_job_ids
  from public.phase_03_8_verifier_fixtures
  where run_id = p_run_id;

  delete from public.connector_observations as observation
  using public.phase_03_8_verifier_fixtures as fixture
  where fixture.run_id = p_run_id
    and observation.company_id = fixture.company_id
    and observation.observation_id = fixture.observation_id;

  delete from public.jobs as job
  using public.phase_03_8_verifier_fixtures as fixture
  where fixture.run_id = p_run_id
    and job.id = fixture.job_id
    and job.company_id = fixture.company_id
    and job.status = 'open'
    and job.external_id = 'phase03_8_verifier:' || fixture.fixture_key;
  get diagnostics v_job_count = row_count;
  if v_job_count <> 3 then
    raise exception 'verifier owned job cleanup mismatch';
  end if;

  update public.phase_03_8_verifier_runs
  set state = 'consumed'
  where phase_03_8_verifier_runs.run_id = p_run_id
    and state = 'running'
  returning phase_03_8_verifier_runs.release_manifest_id,
    phase_03_8_verifier_runs.exercise_calls
  into v_manifest_id, v_calls;
  if not found then
    raise exception 'verifier latch consume failed';
  end if;

  delete from public.phase_03_8_verifier_fixtures
  where run_id = p_run_id;
  get diagnostics v_fixture_count = row_count;
  if v_fixture_count <> 3 then
    raise exception 'verifier ownership cleanup mismatch';
  end if;

  delete from public.companies
  where id = any(v_company_ids)
    and source_key like 'phase03_8_verifier:%';
  get diagnostics v_company_count = row_count;
  if v_company_count <> 3 then
    raise exception 'verifier owned company cleanup mismatch';
  end if;

  revoke execute on function public.begin_phase_03_8_verifier_run(uuid)
    from service_role;
  revoke execute on function public.exercise_phase_03_8_verifier_fault(
    uuid, text, text, integer
  ) from service_role;
  revoke execute on function public.finish_phase_03_8_verifier_run(
    uuid, integer, integer, integer
  ) from service_role;

  delete from public.phase_03_8_verifier_runs
  where phase_03_8_verifier_runs.run_id = p_run_id
    and state = 'consumed';
  if not found then
    raise exception 'consumed verifier run cleanup mismatch';
  end if;

  select
    (select count(*) from public.phase_03_8_verifier_runs
      where phase_03_8_verifier_runs.run_id = p_run_id)
    + (select count(*) from public.phase_03_8_verifier_fixtures
      where phase_03_8_verifier_fixtures.run_id = p_run_id)
    + (select count(*) from public.companies
      where id = any(v_company_ids))
    + (select count(*) from public.jobs
      where id = any(v_job_ids))
  into v_remaining;
  if v_remaining <> 0 then
    raise exception 'verifier residue remains';
  end if;

  return query select
    true, v_manifest_id, p_run_id, v_calls, v_fixture_count, v_remaining, true;
end;
$$;

revoke execute on function public.begin_phase_03_8_verifier_run(uuid)
  from public, anon, authenticated;
revoke execute on function public.exercise_phase_03_8_verifier_fault(
  uuid, text, text, integer
) from public, anon, authenticated;
revoke execute on function public.finish_phase_03_8_verifier_run(
  uuid, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.begin_phase_03_8_verifier_run(uuid)
  to service_role;
grant execute on function public.exercise_phase_03_8_verifier_fault(
  uuid, text, text, integer
) to service_role;
grant execute on function public.finish_phase_03_8_verifier_run(
  uuid, integer, integer, integer
) to service_role;

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid)
from cron.job
where jobname in ('poll-tick-every-minute', 'observe-connectors-every-minute');

select cron.schedule(
  'poll-tick-every-minute',
  '* * * * *',
  $cron$
  select net.http_post(
    url := (
      select decrypted_secret from vault.decrypted_secrets
      where name = 'project_url'
    ) || '/functions/v1/poll-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'cron_secret'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);

select cron.schedule(
  'observe-connectors-every-minute',
  '* * * * *',
  $cron$
  select net.http_post(
    url := (
      select decrypted_secret from vault.decrypted_secrets
      where name = 'project_url'
    ) || '/functions/v1/observe-connectors',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'cron_secret'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);

do $$
begin
  if (select count(*) from phase_03_8_protected_workday_before) <> 2 then
    raise exception 'Capital One/Fidelity protected identity parity failed';
  end if;

  if exists (
    select 1
    from phase_03_8_protected_workday_before as before_row
    full join (
      select
        id, name, ats_type, board_token, region, site_token, careers_url,
        source_key, activation_state, activation_successes
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
      or before_row.activation_successes is distinct from after_row.activation_successes
  ) then
    raise exception 'Capital One/Fidelity protected identity parity failed';
  end if;

  if exists (
    select 1 from public.companies
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

comment on column public.jobs.scope_evidence is
  'Bounded exact source/category/matched-term/US/external-ID digest provenance; no raw provider payload or credential material.';
comment on function public.claim_due_companies(integer) is
  'Active-only due claim. SQL owns the exact ten-minute cadence; poll-tick stops new application work at its 120-second reserve.';

commit;

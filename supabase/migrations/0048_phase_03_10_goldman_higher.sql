begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- This release remains local until the separately approved exact-release
-- rollout. Only the frozen Goldman catalog/company identity changes here.
update public.source_coverage_catalog
set careers_url = 'https://higher.gs.com/results',
    access_evidence =
      'Exact two-population Higher scope uses page/count, detail, category, country, posting-date, and Oracle Apply evidence.',
    verified_at = current_date
where company_name = 'Goldman Sachs'
  and provider = 'Goldman Higher'
  and careers_url = 'https://higher.gs.com/roles';

update public.companies
set careers_url = 'https://higher.gs.com/results'
where name = 'Goldman Sachs'
  and ats_type = 'goldman_higher'
  and board_token = 'goldman_higher:roles'
  and region is null
  and site_token is null
  and careers_url = 'https://higher.gs.com/roles'
  and source_key = 'goldman_higher:roles';

alter table public.companies
  drop constraint companies_branded_identity_check,
  add constraint companies_branded_identity_check check (
    ats_type not in ('eightfold', 'oracle_recruiting', 'goldman_higher')
    or (
      (
        ats_type = 'eightfold'
        and name = 'Morgan Stanley'
        and board_token = 'eightfold:morganstanley'
        and region is null
        and site_token is null
        and careers_url =
          'https://www.morganstanley.com/careers/career-opportunities-search/'
        and source_key = 'eightfold:morganstanley'
      )
      or (
        ats_type = 'oracle_recruiting'
        and name = 'JPMorgan Chase'
        and board_token = 'oracle:jpmc:CX_1001'
        and region is null
        and site_token is null
        and careers_url =
          'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs'
        and source_key = 'oracle:jpmc:CX_1001'
      )
      or (
        ats_type = 'goldman_higher'
        and name = 'Goldman Sachs'
        and board_token = 'goldman_higher:roles'
        and region is null
        and site_token is null
        and careers_url = 'https://higher.gs.com/results'
        and source_key = 'goldman_higher:roles'
      )
    ) is true
  );

alter table public.jobs
  drop constraint jobs_scope_evidence_check,
  add constraint jobs_scope_evidence_check check (
    (
      source not in ('workday', 'eightfold', 'oracle_recruiting', 'goldman_higher')
      and scope_evidence is null
    )
    or (source = 'workday' and scope_evidence is null)
    or (
      source = 'workday'
      and jsonb_typeof(scope_evidence) = 'object'
      and scope_evidence ?& array[
        'sourceKey', 'detailCountryCode', 'selectionMode', 'recentDays',
        'titleKeywords', 'providerFacetLabels'
      ]
      and scope_evidence - array[
        'sourceKey', 'detailCountryCode', 'selectionMode', 'recentDays',
        'titleKeywords', 'providerFacetLabels'
      ] = '{}'::jsonb
      and scope_evidence ->> 'sourceKey' in (
        'workday:wd5:ms:External',
        'workday:wd1:ghr:Lateral-US',
        'workday:wd1:blackrock:BlackRock_Professional',
        'workday:wd3:barclays:External_Career_Site_Barclays'
      )
      and scope_evidence ->> 'detailCountryCode' = 'US'
      and scope_evidence ->> 'selectionMode' = 'recent_exact_us'
      and scope_evidence -> 'recentDays' = '7'::jsonb
      and (
        (
          scope_evidence ->> 'sourceKey' = 'workday:wd1:ghr:Lateral-US'
          and scope_evidence -> 'titleKeywords' =
            '["finance", "analytics", "data", "research"]'::jsonb
          and scope_evidence -> 'providerFacetLabels' = '[]'::jsonb
        )
        or (
          scope_evidence ->> 'sourceKey' =
            'workday:wd3:barclays:External_Career_Site_Barclays'
          and scope_evidence -> 'titleKeywords' = '[]'::jsonb
          and scope_evidence -> 'providerFacetLabels' =
            '["Data & Analytics", "Finance", "Investment Banking", "Research", "Risk", "Technology"]'::jsonb
        )
        or (
          scope_evidence ->> 'sourceKey' in (
            'workday:wd5:ms:External',
            'workday:wd1:blackrock:BlackRock_Professional'
          )
          and scope_evidence -> 'titleKeywords' = '[]'::jsonb
          and scope_evidence -> 'providerFacetLabels' = '[]'::jsonb
        )
      )
    )
    or (
      source in ('eightfold', 'oracle_recruiting')
      and jsonb_typeof(scope_evidence) = 'object'
      and scope_evidence ?& array[
        'sourceKey', 'providerCategoryLabel', 'matchedTerm',
        'detailCountryCode', 'externalIdDigest'
      ]
      and scope_evidence - array[
        'sourceKey', 'providerCategoryLabel', 'matchedTerm',
        'detailCountryCode', 'externalIdDigest'
      ] = '{}'::jsonb
      and scope_evidence ->> 'sourceKey' = case source
        when 'eightfold' then 'eightfold:morganstanley'
        when 'oracle_recruiting' then 'oracle:jpmc:CX_1001'
      end
      and length(scope_evidence ->> 'providerCategoryLabel') between 1 and 160
      and scope_evidence ->> 'detailCountryCode' = 'US'
      and (
        (
          source = 'oracle_recruiting'
          and (
            scope_evidence ->> 'providerCategoryLabel',
            scope_evidence ->> 'matchedTerm'
          ) in (
            ('finance', 'Finance'),
            ('data analytics', 'Data'),
            ('risk', 'Risk'),
            ('product investment mgmt', 'Investment'),
            ('strategy development', 'Strategy'),
            ('program analysts associate', 'Program Analysts')
          )
        )
        or (
          source = 'eightfold'
          and scope_evidence ->> 'matchedTerm' in (
            'Data', 'Technology', 'Finance', 'Investment',
            'Research', 'Risk', 'Capital Markets'
          )
        )
      )
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
    or (
      source = 'goldman_higher'
      and jsonb_typeof(scope_evidence) = 'object'
      and scope_evidence ?& array[
        'sourceKey', 'selectionMode', 'recentHours', 'providerSourceId',
        'providerCategoryField', 'providerCategoryLabel', 'matchedTerm',
        'detailCountryCode', 'postedAt', 'recruitingType', 'externalIdDigest'
      ]
      and scope_evidence - array[
        'sourceKey', 'selectionMode', 'recentHours', 'providerSourceId',
        'providerCategoryField', 'providerCategoryLabel', 'matchedTerm',
        'detailCountryCode', 'postedAt', 'recruitingType', 'externalIdDigest'
      ] = '{}'::jsonb
      and scope_evidence ->> 'sourceKey' = 'goldman_higher:roles'
      and scope_evidence ->> 'selectionMode' =
        'recent_exact_us_provider_category'
      and scope_evidence -> 'recentHours' = '168'::jsonb
      and scope_evidence ->> 'providerSourceId' ~ '^[0-9]{1,256}$'
      and scope_evidence ->> 'providerCategoryField' in (
        'jobFunction', 'division'
      )
      and length(scope_evidence ->> 'providerCategoryLabel') between 1 and 160
      and scope_evidence ->> 'matchedTerm' in (
        'Data', 'Technology', 'Finance', 'Investment',
        'Research', 'Risk', 'Capital Markets'
      )
      and scope_evidence ->> 'detailCountryCode' = 'US'
      and scope_evidence ->> 'postedAt' ~
        '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
      and posted_at = (scope_evidence ->> 'postedAt')::timestamptz
      and scope_evidence ->> 'recruitingType' in (
        'GS_EARLY_CAREER', 'GS_MID_CAREER'
      )
      and scope_evidence ->> 'externalIdDigest' ~ '^[0-9a-f]{64}$'
      and scope_evidence ->> 'externalIdDigest' = pg_catalog.encode(
        extensions.digest(
          convert_to(
            concat(
              '[',
              to_json(scope_evidence ->> 'sourceKey')::text, ',',
              to_json(external_id)::text, ',',
              to_json(scope_evidence ->> 'selectionMode')::text, ',',
              to_json(168)::text, ',',
              to_json(scope_evidence ->> 'providerSourceId')::text, ',',
              to_json(scope_evidence ->> 'providerCategoryField')::text, ',',
              to_json(scope_evidence ->> 'providerCategoryLabel')::text, ',',
              to_json(scope_evidence ->> 'matchedTerm')::text, ',',
              to_json('US'::text)::text, ',',
              to_json(scope_evidence ->> 'postedAt')::text, ',',
              to_json(scope_evidence ->> 'recruitingType')::text,
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

alter table public.branded_connector_terminal_evidence
  drop constraint branded_terminal_reason_check,
  add constraint branded_terminal_reason_check check (
    (outcome = 'admit_experimental' and reason is null)
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
        'count_mismatch',
        'country_filter_unverified',
        'title_facet_unverified',
        'posting_date_facet_unverified',
        'posting_date_ineligible',
        'family_evidence_missing',
        'detail_scope_incomplete',
        'navigation_identity_unverified',
        'higher_contract_unverified',
        'population_evidence_missing',
        'country_evidence_missing',
        'application_evidence_missing',
        'job_cap_exceeded'
      )
    )
  );

create or replace function public.finalize_goldman_higher_candidate(
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
  v_url constant text := 'https://higher.gs.com/results';
  v_existing public.companies%rowtype;
begin
  if p_source_key <> 'goldman_higher:roles' then
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
    pg_catalog.hashtextextended('phase-03.10-goldman:' || p_source_key, 0)
  );
  if exists (
    select 1 from public.branded_connector_terminal_evidence
    where evidence_digest = p_evidence_digest
  ) then
    return query select false, 'replayed_evidence'::text, null::text;
    return;
  end if;

  select company.* into v_existing
  from public.companies as company
  where company.source_key = p_source_key
     or (company.name = 'Goldman Sachs' and company.ats_type = 'goldman_higher')
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
    if found then
      return query select false, 'already_experimental'::text,
        v_existing.activation_state;
      return;
    end if;
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
        verified_at = current_date
    where company_name = 'Goldman Sachs'
      and careers_url = v_url;
    if not found then raise exception 'exact Goldman catalog candidate missing'; end if;
    insert into public.companies (
      name, ats_type, board_token, region, site_token, careers_url, source_key,
      activation_state, activation_successes, next_poll_at,
      last_verified_at, last_error, last_error_code, last_observation_count
    ) values (
      'Goldman Sachs', 'goldman_higher', p_source_key, null, null, v_url,
      p_source_key, 'experimental', 0, clock_timestamp(),
      clock_timestamp(), null, null, null
    );
    return query select true, 'admitted_experimental'::text, 'experimental'::text;
    return;
  end if;

  if p_reason not in (
    'navigation_identity_unverified', 'higher_contract_unverified',
    'posting_date_ineligible', 'population_evidence_missing',
    'category_evidence_missing', 'country_evidence_missing',
    'application_evidence_missing', 'pagination_incomplete', 'count_mismatch',
    'detail_scope_incomplete', 'job_cap_exceeded', 'provider_timeout',
    'positive_job_count_missing'
  ) then
    return query select false, 'invalid_unsupported_reason'::text, null::text;
    return;
  end if;
  insert into public.branded_connector_terminal_evidence (
    source_key, evidence_digest, outcome, reason
  ) values (p_source_key, p_evidence_digest, p_outcome, p_reason);
  delete from public.connector_observations
  where company_id in (
    select id from public.companies
    where source_key = p_source_key and activation_state = 'experimental'
  );
  delete from public.companies
  where source_key = p_source_key and activation_state = 'experimental';
  update public.source_coverage_catalog
  set disposition = 'unsupported_with_reason',
      unsupported_reason = p_reason,
      source_key = null,
      verified_at = current_date
  where company_name = 'Goldman Sachs'
    and careers_url = v_url;
  if not found then raise exception 'exact Goldman catalog candidate missing'; end if;
  return query select true, 'recorded_unsupported'::text, 'disabled'::text;
end;
$$;

revoke execute on function public.finalize_goldman_higher_candidate(
  text, text, text, text
) from public, anon, authenticated;
grant execute on function public.finalize_goldman_higher_candidate(
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
  if p_company_id is null or p_observation_id is null
    or p_completeness <> 'complete'
    or p_credible_for_closure is not true
    or p_job_count is null or p_job_count <= 0
    or p_expected_count is null or p_job_count <> p_expected_count
    or p_warning_count is null or p_warning_count <> 0
    or p_evidence_digest is null
    or p_evidence_digest !~ '^[0-9a-f]{64}$'
  then
    return query select false, 'ineligible_evidence'::text, null::integer,
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
      return query select false, 'retryable_lock_contention'::text, null::integer,
        null::timestamptz, null::timestamptz, null::text;
      return;
  end;

  if not found
    or v_company.activation_state <> 'experimental'
    or not (
      (
        v_company.ats_type = 'workday'
        and v_company.source_key in (
          'workday:wd5:ms:External',
          'workday:wd1:ghr:Lateral-US',
          'workday:wd1:blackrock:BlackRock_Professional',
          'workday:wd3:barclays:External_Career_Site_Barclays'
        )
      )
      or (
        v_company.ats_type = 'oracle_recruiting'
        and v_company.source_key = 'oracle:jpmc:CX_1001'
      )
      or (
        v_company.ats_type = 'goldman_higher'
        and v_company.source_key = 'goldman_higher:roles'
      )
    )
  then
    return query select false, 'ineligible_company'::text,
      coalesce(v_company.activation_successes, 0), null::timestamptz,
      null::timestamptz, v_company.activation_state;
    return;
  end if;

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
  if v_progress > 3 then raise exception 'connector observation cap violated'; end if;

  update public.companies as company
  set activation_successes = v_progress,
      activation_state = case when v_progress = 3 then 'active'
        else company.activation_state end,
      next_poll_at = case
        when v_progress = 3 then v_now
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

  return query select true, 'accepted'::text, v_progress,
    v_window_start, v_next_eligible_at, v_company.activation_state;
exception
  when unique_violation then
    return query select false, 'replay_or_same_window'::text,
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
      and (
        (
          ats_type = 'workday'
          and source_key in (
            'workday:wd5:ms:External',
            'workday:wd1:ghr:Lateral-US',
            'workday:wd1:blackrock:BlackRock_Professional',
            'workday:wd3:barclays:External_Career_Site_Barclays'
          )
        )
        or (
          ats_type = 'oracle_recruiting'
          and source_key = 'oracle:jpmc:CX_1001'
        )
        or (
          ats_type = 'goldman_higher'
          and source_key = 'goldman_higher:roles'
        )
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
        or (
          ats_type = 'oracle_recruiting'
          and source_key = 'oracle:jpmc:CX_1001'
        )
        or (
          ats_type = 'goldman_higher'
          and source_key = 'goldman_higher:roles'
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

revoke execute on function public.claim_due_companies(integer)
  from public, anon, authenticated;
grant execute on function public.claim_due_companies(integer)
  to service_role;

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
            then (candidate.user_job).applied_at end desc nulls last,
          case when p_lifecycle = 'dismissed'
            then (candidate.user_job).dismissed_at end desc nulls last,
          case when p_lifecycle = 'active' and p_order = 'score_desc'
            then (candidate.user_job).deterministic_score end desc nulls last,
          case when p_lifecycle = 'active' and p_order = 'score_asc'
            then (candidate.user_job).deterministic_score end asc nulls last,
          case when p_lifecycle = 'active'
            then (candidate.job).posted_at end desc nulls last,
          case when p_lifecycle = 'active'
            then (candidate.job).first_seen_at end desc,
          (candidate.user_job).id desc
      ) as page_position
    from candidates as candidate
    order by
      case when p_lifecycle = 'applied'
        then (candidate.user_job).applied_at end desc nulls last,
      case when p_lifecycle = 'dismissed'
        then (candidate.user_job).dismissed_at end desc nulls last,
      case when p_lifecycle = 'active' and p_order = 'score_desc'
        then (candidate.user_job).deterministic_score end desc nulls last,
      case when p_lifecycle = 'active' and p_order = 'score_asc'
        then (candidate.user_job).deterministic_score end asc nulls last,
      case when p_lifecycle = 'active'
        then (candidate.job).posted_at end desc nulls last,
      case when p_lifecycle = 'active'
        then (candidate.job).first_seen_at end desc,
      (candidate.user_job).id desc
    limit p_limit + 1
  ),
  continuation as (
    select exists (
      select 1 from page_window where page_position = p_limit + 1
    ) as has_more
  )
  select
    jsonb_build_object(
      'id', (page.user_job).id,
      'deterministic_revision', (page.user_job).deterministic_revision,
      'deterministic_eligible', (page.user_job).deterministic_eligible,
      'deterministic_score', (page.user_job).deterministic_score,
      'deterministic_tier', (page.user_job).deterministic_tier,
      'deterministic_breakdown', (page.user_job).deterministic_breakdown,
      'deterministic_filter_code', (page.user_job).deterministic_filter_code,
      'deterministic_filter_detail', (page.user_job).deterministic_filter_detail,
      'deterministic_ranked_at', (page.user_job).deterministic_ranked_at,
      'deterministic_best_fit_resume_id',
        (page.user_job).deterministic_best_fit_resume_id,
      'deterministic_runner_up_resume_id',
        (page.user_job).deterministic_runner_up_resume_id,
      'seen_at', (page.user_job).seen_at,
      'dismissed_at', (page.user_job).dismissed_at,
      'applied_at', (page.user_job).applied_at,
      'jobs', jsonb_build_object(
        'id', (page.job).id,
        'title', (page.job).title,
        'location', (page.job).location,
        'absolute_url', (page.job).absolute_url,
        'posted_at', (page.job).posted_at,
        'first_seen_at', (page.job).first_seen_at,
        'status', (page.job).status,
        'source_company_name', (page.job).source_company_name,
        'companies', case when (page.company).id is null then null else
          jsonb_build_object('name', (page.company).name)
        end
      )
    ),
    jsonb_build_object(
      'v', 1,
      'lifecycle', p_lifecycle,
      'order', p_order,
      'signature', p_query_signature,
      'id', (page.user_job).id,
      'posted_at', case when p_lifecycle = 'active'
        then coalesce((page.job).posted_at, '-infinity'::timestamptz)
        else null end,
      'first_seen_at', case when p_lifecycle = 'active'
        then (page.job).first_seen_at else null end,
      'score', case when p_lifecycle = 'active'
        then (page.user_job).deterministic_score else null end,
      'lifecycle_at', case
        when p_lifecycle = 'applied' then (page.user_job).applied_at
        when p_lifecycle = 'dismissed' then (page.user_job).dismissed_at
        else null end
    ),
    continuation.has_more
  from page_window as page
  cross join continuation
  where page.page_position <= p_limit
  order by page.page_position;
end;
$$;

revoke execute on function public.dashboard_feed_page(
  text, text, text[], text[], text, jsonb, integer
) from public, anon;
grant execute on function public.dashboard_feed_page(
  text, text, text[], text[], text, jsonb, integer
) to authenticated;

comment on constraint jobs_scope_evidence_check on public.jobs is
  'Preserves existing source evidence and requires exact Goldman Higher source, category, country, freshness, population, and digest proof.';
comment on function public.finalize_goldman_higher_candidate(
  text, text, text, text
) is
  'Replay-safe service-role-only Goldman Higher admission or precise Unsupported terminalization.';
comment on function public.dashboard_feed_page(
  text, text, text[], text[], text, jsonb, integer
) is
  'Authenticated RLS-scoped keyset page; aged Goldman rows remain provider-open and are hidden only from Active.';

-- Bound job storage while keeping dismissal private to the acting user.
--
-- A dismissal removes the user's heavy user_jobs projection immediately. A
-- compact provider-identity tombstone survives shared job deletion so the same
-- provider job cannot be recreated for that user by scoring or ranking seeds.
-- Shared jobs remain available to other users.
create table public.user_job_dismissals (
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null,
  external_id text not null,
  dismissed_at timestamptz not null default clock_timestamp(),
  primary key (user_id, source, external_id)
);

alter table public.user_job_dismissals enable row level security;
revoke all on table public.user_job_dismissals from public, anon, authenticated;

-- Preserve existing user intent, then remove the old full projections.
insert into public.user_job_dismissals (
  user_id,
  source,
  external_id,
  dismissed_at
)
select
  user_job.user_id,
  job.source,
  job.external_id,
  user_job.dismissed_at
from public.user_jobs as user_job
join public.jobs as job on job.id = user_job.job_id
where user_job.dismissed_at is not null
on conflict (user_id, source, external_id) do update
set dismissed_at = least(
  public.user_job_dismissals.dismissed_at,
  excluded.dismissed_at
);

delete from public.user_jobs
where dismissed_at is not null;

create function public.prevent_dismissed_user_job_reinsert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.jobs as job
    join public.user_job_dismissals as dismissal
      on dismissal.user_id = new.user_id
     and dismissal.source = job.source
     and dismissal.external_id = job.external_id
    where job.id = new.job_id
  ) then
    return null;
  end if;

  return new;
end;
$$;

revoke execute on function public.prevent_dismissed_user_job_reinsert()
  from public, anon, authenticated;

create trigger prevent_dismissed_user_job_reinsert
before insert on public.user_jobs
for each row execute function public.prevent_dismissed_user_job_reinsert();

create function public.dismiss_job_permanently(p_user_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
  dismissed_source text;
  dismissed_external_id text;
begin
  if owner_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select job.source, job.external_id
  into dismissed_source, dismissed_external_id
  from public.user_jobs as user_job
  join public.jobs as job on job.id = user_job.job_id
  where user_job.id = p_user_job_id
    and user_job.user_id = owner_id
  for update of user_job;

  if not found then
    return false;
  end if;

  insert into public.user_job_dismissals (user_id, source, external_id)
  values (owner_id, dismissed_source, dismissed_external_id)
  on conflict (user_id, source, external_id) do nothing;

  delete from public.user_jobs
  where id = p_user_job_id
    and user_id = owner_id;

  return found;
end;
$$;

revoke execute on function public.dismiss_job_permanently(uuid)
  from public, anon;
grant execute on function public.dismiss_job_permanently(uuid)
  to authenticated;

-- Closed jobs are permanently removed seven days after closure only when no
-- user has marked the job applied. Foreign keys cascade their remaining
-- user_jobs and ranking projections.
create function public.purge_closed_unapplied_jobs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  delete from public.jobs as job
  where job.status = 'closed'
    and job.closed_at is not null
    and job.closed_at <= clock_timestamp() - interval '7 days'
    and not exists (
      select 1
      from public.user_jobs as user_job
      where user_job.job_id = job.id
        and user_job.applied_at is not null
    );

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke execute on function public.purge_closed_unapplied_jobs()
  from public, anon, authenticated;
grant execute on function public.purge_closed_unapplied_jobs()
  to service_role;

create extension if not exists pg_cron;

select cron.unschedule(jobid)
from cron.job
where jobname = 'purge-closed-unapplied-jobs-daily';

select cron.schedule(
  'purge-closed-unapplied-jobs-daily',
  '17 4 * * *',
  $cron$select public.purge_closed_unapplied_jobs();$cron$
);

commit;

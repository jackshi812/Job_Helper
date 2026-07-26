begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

update public.source_coverage_catalog
set careers_url =
      'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs',
    access_evidence =
      'Exact U.S. six-family Oracle scope uses title, location, posting-date, detail, and rolling-window evidence.',
    verified_at = current_date
where company_name = 'JPMorgan Chase'
  and provider = 'Oracle Recruiting';

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
      and scope_evidence ->> 'sourceKey' = case source
        when 'eightfold' then 'eightfold:morganstanley'
        when 'oracle_recruiting' then 'oracle:jpmc:CX_1001'
        when 'goldman_higher' then 'goldman_higher:roles'
      end
      and length(scope_evidence ->> 'providerCategoryLabel') between 1 and 160
      and scope_evidence ->> 'detailCountryCode' = 'US'
      and (
        (
          source = 'oracle_recruiting'
          and (scope_evidence ->> 'providerCategoryLabel', scope_evidence ->> 'matchedTerm') in (
            ('finance', 'Finance'),
            ('data analytics', 'Data'),
            ('risk', 'Risk'),
            ('product investment mgmt', 'Investment'),
            ('strategy development', 'Strategy'),
            ('program analysts associate', 'Program Analysts')
          )
        )
        or (
          source in ('eightfold', 'goldman_higher')
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
  );

create or replace function public.finalize_jpmorgan_oracle_candidate(
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
  v_url constant text :=
    'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs';
  v_existing public.companies%rowtype;
begin
  if p_source_key <> 'oracle:jpmc:CX_1001' then
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
    pg_catalog.hashtextextended('phase-03.9-jpmorgan:' || p_source_key, 0)
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
     or (company.name = 'JPMorgan Chase' and company.ats_type = 'oracle_recruiting')
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
        verified_at = current_date
    where company_name = 'JPMorgan Chase'
      and careers_url = v_url;
    if not found then raise exception 'exact JPMorgan catalog candidate missing'; end if;
    insert into public.companies (
      name, ats_type, board_token, region, site_token, careers_url, source_key,
      activation_state, activation_successes, next_poll_at,
      last_verified_at, last_error, last_error_code, last_observation_count
    ) values (
      'JPMorgan Chase', 'oracle_recruiting', p_source_key, null, null, v_url,
      p_source_key, 'experimental', 0, clock_timestamp(),
      clock_timestamp(), null, null, null
    );
    return query select true, 'admitted_experimental'::text, 'experimental'::text;
    return;
  end if;

  if p_reason not in (
    'pending_current_live_contract_proof', 'country_filter_unverified',
    'title_facet_unverified', 'posting_date_facet_unverified',
    'posting_date_ineligible', 'family_evidence_missing',
    'scope_evidence_incomplete', 'detail_scope_incomplete',
    'pagination_incomplete', 'count_mismatch', 'provider_timeout',
    'provider_schema_error', 'positive_job_count_missing'
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
  where company_name = 'JPMorgan Chase'
    and careers_url = v_url;
  if not found then raise exception 'exact JPMorgan catalog candidate missing'; end if;
  return query select true, 'recorded_unsupported'::text, 'disabled'::text;
end;
$$;

revoke execute on function public.finalize_jpmorgan_oracle_candidate(
  text, text, text, text
) from public, anon, authenticated;
grant execute on function public.finalize_jpmorgan_oracle_candidate(
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

comment on constraint jobs_scope_evidence_check on public.jobs is
  'Preserves existing sources and admits exactly six JPMorgan Oracle family/evidence pairs.';
comment on function public.finalize_jpmorgan_oracle_candidate(
  text, text, text, text
) is
  'Replay-safe service-role-only JPMorgan Oracle admission or precise Unsupported terminalization.';

commit;

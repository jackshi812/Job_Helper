begin;

-- Phase 06 Release Wave 1 admits ten exact, publicly proven Workday CXS
-- identities as system-managed Experimental companies. No row becomes Active
-- here: three distinct complete, positive, warning-free observation windows are
-- still required through record_connector_observation.

-- Fail before changing authority if any Wave 1 identity already exists. The
-- immediately preceding owner-approved read-only freshness proof established
-- this exact absence at deployed head 0068.
do $$
begin
  if exists (
    select 1
    from public.companies
    where source_key in (
      'workday:wd3:bmo:External',
      'workday:wd1:pimco:pimco-careers',
      'workday:wd5:visa:Visa',
      'workday:wd5:athene:Apollo_Careers',
      'workday:wd1:invesco:IVZ',
      'workday:wd1:mastercard:CorporateCareers',
      'workday:wd1:ntrs:northerntrust',
      'workday:wd5:vanguard:vanguard_external',
      'workday:wd5:workday:Workday',
      'workday:wd5:nvidia:NVIDIAExternalCareerSite'
    )
  ) then
    raise exception
      'migration application must not find pre-existing Wave 1 companies';
  end if;
end;
$$;

-- Durable ownership defaults to user-managed and can be set true only by the
-- service-role terminalization path below.
alter table public.companies
  add column system_managed boolean not null default false;

drop policy if exists "companies_delete_shared" on public.companies;
drop policy if exists "companies_delete_user_managed" on public.companies;
create policy "companies_delete_user_managed" on public.companies
  for delete to authenticated
  using (system_managed is false);

-- Preserve all fourteen prior Workday tuples and add the seven not already in
-- source authority. Visa, PIMCO, and Invesco were already frozen candidates.
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
        and careers_url =
          'https://ghr.wd1.myworkdayjobs.com/en-US/Lateral-US'
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
      or (
        name = 'Visa'
        and board_token = 'visa'
        and region = 'wd5'
        and site_token = 'Visa'
        and careers_url = 'https://visa.wd5.myworkdayjobs.com/Visa'
        and source_key = 'workday:wd5:visa:Visa'
        and activation_state in ('experimental', 'active')
      )
      or (
        name = 'PIMCO'
        and board_token = 'pimco'
        and region = 'wd1'
        and site_token = 'pimco-careers'
        and careers_url =
          'https://pimco.wd1.myworkdayjobs.com/pimco-careers'
        and source_key = 'workday:wd1:pimco:pimco-careers'
        and activation_state in ('experimental', 'active')
      )
      or (
        name = 'T. Rowe Price'
        and board_token = 'troweprice'
        and region = 'wd5'
        and site_token = 'TRowePrice'
        and careers_url =
          'https://troweprice.wd5.myworkdayjobs.com/TRowePrice'
        and source_key = 'workday:wd5:troweprice:TRowePrice'
        and activation_state in ('experimental', 'active')
      )
      or (
        name = 'Invesco'
        and board_token = 'invesco'
        and region = 'wd1'
        and site_token = 'IVZ'
        and careers_url = 'https://invesco.wd1.myworkdayjobs.com/IVZ'
        and source_key = 'workday:wd1:invesco:IVZ'
        and activation_state in ('experimental', 'active')
      )
      or (
        name = 'BMO'
        and board_token = 'bmo'
        and region = 'wd3'
        and site_token = 'External'
        and careers_url = 'https://bmo.wd3.myworkdayjobs.com/External'
        and source_key = 'workday:wd3:bmo:External'
        and activation_state in ('experimental', 'active')
      )
      or (
        name = 'Apollo Global Management'
        and board_token = 'athene'
        and region = 'wd5'
        and site_token = 'Apollo_Careers'
        and careers_url =
          'https://athene.wd5.myworkdayjobs.com/Apollo_Careers'
        and source_key = 'workday:wd5:athene:Apollo_Careers'
        and activation_state in ('experimental', 'active')
      )
      or (
        name = 'Mastercard'
        and board_token = 'mastercard'
        and region = 'wd1'
        and site_token = 'CorporateCareers'
        and careers_url =
          'https://mastercard.wd1.myworkdayjobs.com/CorporateCareers'
        and source_key = 'workday:wd1:mastercard:CorporateCareers'
        and activation_state in ('experimental', 'active')
      )
      or (
        name = 'Northern Trust'
        and board_token = 'ntrs'
        and region = 'wd1'
        and site_token = 'northerntrust'
        and careers_url =
          'https://ntrs.wd1.myworkdayjobs.com/northerntrust'
        and source_key = 'workday:wd1:ntrs:northerntrust'
        and activation_state in ('experimental', 'active')
      )
      or (
        name = 'Vanguard'
        and board_token = 'vanguard'
        and region = 'wd5'
        and site_token = 'vanguard_external'
        and careers_url =
          'https://vanguard.wd5.myworkdayjobs.com/vanguard_external'
        and source_key = 'workday:wd5:vanguard:vanguard_external'
        and activation_state in ('experimental', 'active')
      )
      or (
        name = 'Workday'
        and board_token = 'workday'
        and region = 'wd5'
        and site_token = 'Workday'
        and careers_url = 'https://workday.wd5.myworkdayjobs.com/Workday'
        and source_key = 'workday:wd5:workday:Workday'
        and activation_state in ('experimental', 'active')
      )
      or (
        name = 'NVIDIA'
        and board_token = 'nvidia'
        and region = 'wd5'
        and site_token = 'NVIDIAExternalCareerSite'
        and careers_url =
          'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite'
        and source_key = 'workday:wd5:nvidia:NVIDIAExternalCareerSite'
        and activation_state in ('experimental', 'active')
      )
    ) is true
  );

-- Terminal evidence retains every prior candidate and adds seven new keys.
alter table public.workday_connector_terminal_evidence
  drop constraint workday_terminal_source_check,
  add constraint workday_terminal_source_check check (
    source_key in (
      'workday:wd5:ms:External',
      'workday:wd1:ghr:Lateral-US',
      'workday:wd1:blackrock:BlackRock_Professional',
      'workday:wd3:barclays:External_Career_Site_Barclays',
      'workday:wd5:visa:Visa',
      'workday:wd1:pimco:pimco-careers',
      'workday:wd5:troweprice:TRowePrice',
      'workday:wd1:invesco:IVZ',
      'workday:wd3:bmo:External',
      'workday:wd5:athene:Apollo_Careers',
      'workday:wd1:mastercard:CorporateCareers',
      'workday:wd1:ntrs:northerntrust',
      'workday:wd5:vanguard:vanguard_external',
      'workday:wd5:workday:Workday',
      'workday:wd5:nvidia:NVIDIAExternalCareerSite'
    )
  ),
  drop constraint workday_terminal_reason_check,
  add constraint workday_terminal_reason_check check (
    (
      outcome = 'admit_experimental'
      and reason is null
    )
    or (
      outcome = 'unsupported'
      and reason in (
        'pending_current_live_contract_proof',
        'pending_phase_06_wave_1_release',
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
  );

-- Freeze all ten release candidates as pending before exact terminalization.
insert into public.source_coverage_catalog (
  company_name, careers_url, provider, access_evidence, disposition,
  verified_at, unsupported_reason, source_key
)
values
  ('BMO', 'https://bmo.wd3.myworkdayjobs.com/External', 'Workday',
   'Phase 06 Wave 1 exact anonymous list/detail contract proven.',
   'unsupported_with_reason', date '2026-08-05',
   'pending_phase_06_wave_1_release', null),
  ('PIMCO', 'https://pimco.wd1.myworkdayjobs.com/pimco-careers', 'Workday',
   'Phase 06 Wave 1 exact anonymous list/detail contract proven.',
   'unsupported_with_reason', date '2026-08-05',
   'pending_phase_06_wave_1_release', null),
  ('Visa', 'https://visa.wd5.myworkdayjobs.com/Visa', 'Workday',
   'Phase 06 Wave 1 exact anonymous list/detail contract proven.',
   'unsupported_with_reason', date '2026-08-05',
   'pending_phase_06_wave_1_release', null),
  ('Apollo Global Management',
   'https://athene.wd5.myworkdayjobs.com/Apollo_Careers', 'Workday',
   'Phase 06 Wave 1 exact anonymous list/detail contract proven.',
   'unsupported_with_reason', date '2026-08-05',
   'pending_phase_06_wave_1_release', null),
  ('Invesco', 'https://invesco.wd1.myworkdayjobs.com/IVZ', 'Workday',
   'Phase 06 Wave 1 exact anonymous list/detail contract proven.',
   'unsupported_with_reason', date '2026-08-05',
   'pending_phase_06_wave_1_release', null),
  ('Mastercard', 'https://mastercard.wd1.myworkdayjobs.com/CorporateCareers',
   'Workday', 'Phase 06 Wave 1 exact anonymous list/detail contract proven.',
   'unsupported_with_reason', date '2026-08-05',
   'pending_phase_06_wave_1_release', null),
  ('Northern Trust', 'https://ntrs.wd1.myworkdayjobs.com/northerntrust',
   'Workday', 'Phase 06 Wave 1 exact anonymous list/detail contract proven.',
   'unsupported_with_reason', date '2026-08-05',
   'pending_phase_06_wave_1_release', null),
  ('Vanguard', 'https://vanguard.wd5.myworkdayjobs.com/vanguard_external',
   'Workday', 'Phase 06 Wave 1 exact anonymous list/detail contract proven.',
   'unsupported_with_reason', date '2026-08-05',
   'pending_phase_06_wave_1_release', null),
  ('Workday', 'https://workday.wd5.myworkdayjobs.com/Workday', 'Workday',
   'Phase 06 Wave 1 exact anonymous list/detail contract proven.',
   'unsupported_with_reason', date '2026-08-05',
   'pending_phase_06_wave_1_release', null),
  ('NVIDIA', 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite',
   'Workday', 'Phase 06 Wave 1 exact anonymous list/detail contract proven.',
   'unsupported_with_reason', date '2026-08-05',
   'pending_phase_06_wave_1_release', null)
on conflict (company_name) do update
set careers_url = excluded.careers_url,
    provider = excluded.provider,
    access_evidence = excluded.access_evidence,
    disposition = excluded.disposition,
    verified_at = excluded.verified_at,
    unsupported_reason = excluded.unsupported_reason,
    source_key = excluded.source_key;

-- Replay-safe, service-role-only terminalization. The mapping is exact and
-- server owned; caller-provided URL or tenant material is never accepted.
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
  select exact.company_name, exact.tenant, exact.region, exact.site,
         exact.careers_url
  into v_company_name, v_tenant, v_region, v_site, v_careers_url
  from (
    values
      ('workday:wd5:ms:External', 'Morgan Stanley', 'ms', 'wd5', 'External',
       'https://ms.wd5.myworkdayjobs.com/en-US/External'),
      ('workday:wd1:ghr:Lateral-US', 'Bank of America', 'ghr', 'wd1',
       'Lateral-US', 'https://ghr.wd1.myworkdayjobs.com/en-US/Lateral-US'),
      ('workday:wd1:blackrock:BlackRock_Professional', 'BlackRock',
       'blackrock', 'wd1', 'BlackRock_Professional',
       'https://blackrock.wd1.myworkdayjobs.com/en-US/BlackRock_Professional'),
      ('workday:wd3:barclays:External_Career_Site_Barclays', 'Barclays',
       'barclays', 'wd3', 'External_Career_Site_Barclays',
       'https://barclays.wd3.myworkdayjobs.com/en-US/External_Career_Site_Barclays'),
      ('workday:wd5:visa:Visa', 'Visa', 'visa', 'wd5', 'Visa',
       'https://visa.wd5.myworkdayjobs.com/Visa'),
      ('workday:wd1:pimco:pimco-careers', 'PIMCO', 'pimco', 'wd1',
       'pimco-careers', 'https://pimco.wd1.myworkdayjobs.com/pimco-careers'),
      ('workday:wd5:troweprice:TRowePrice', 'T. Rowe Price', 'troweprice',
       'wd5', 'TRowePrice',
       'https://troweprice.wd5.myworkdayjobs.com/TRowePrice'),
      ('workday:wd1:invesco:IVZ', 'Invesco', 'invesco', 'wd1', 'IVZ',
       'https://invesco.wd1.myworkdayjobs.com/IVZ'),
      ('workday:wd3:bmo:External', 'BMO', 'bmo', 'wd3', 'External',
       'https://bmo.wd3.myworkdayjobs.com/External'),
      ('workday:wd5:athene:Apollo_Careers', 'Apollo Global Management',
       'athene', 'wd5', 'Apollo_Careers',
       'https://athene.wd5.myworkdayjobs.com/Apollo_Careers'),
      ('workday:wd1:mastercard:CorporateCareers', 'Mastercard', 'mastercard',
       'wd1', 'CorporateCareers',
       'https://mastercard.wd1.myworkdayjobs.com/CorporateCareers'),
      ('workday:wd1:ntrs:northerntrust', 'Northern Trust', 'ntrs', 'wd1',
       'northerntrust', 'https://ntrs.wd1.myworkdayjobs.com/northerntrust'),
      ('workday:wd5:vanguard:vanguard_external', 'Vanguard', 'vanguard',
       'wd5', 'vanguard_external',
       'https://vanguard.wd5.myworkdayjobs.com/vanguard_external'),
      ('workday:wd5:workday:Workday', 'Workday', 'workday', 'wd5', 'Workday',
       'https://workday.wd5.myworkdayjobs.com/Workday'),
      ('workday:wd5:nvidia:NVIDIAExternalCareerSite', 'NVIDIA', 'nvidia',
       'wd5', 'NVIDIAExternalCareerSite',
       'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite')
  ) as exact(source_key, company_name, tenant, region, site, careers_url)
  where exact.source_key = p_source_key;

  if not found then
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
    pg_catalog.hashtextextended('phase-06-workday:' || p_source_key, 0)
  );
  if exists (
    select 1 from public.workday_connector_terminal_evidence
    where evidence_digest = p_evidence_digest
  ) then
    return query select false, 'replayed_evidence'::text, null::text;
    return;
  end if;

  select company.* into v_existing
  from public.companies as company
  where company.source_key = p_source_key
     or (company.name = v_company_name and company.ats_type = 'workday')
  for update;
  if found and v_existing.activation_state = 'active' then
    return query select false, 'already_active'::text, 'active'::text;
    return;
  end if;
  if found and v_existing.activation_state = 'experimental' then
    return query select false, 'already_experimental'::text,
      'experimental'::text;
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
    set disposition = 'experimental', unsupported_reason = null,
        source_key = p_source_key,
        access_evidence =
          'Exact Phase 06 U.S. Workday proof accepted; three clean observations remain required.',
        verified_at = current_date
    where company_name = v_company_name and careers_url = v_careers_url;
    if not found then raise exception 'exact Workday catalog candidate missing'; end if;

    insert into public.companies (
      name, ats_type, board_token, region, site_token, careers_url, source_key,
      activation_state, activation_successes, next_poll_at, last_verified_at,
      last_error, last_error_code, last_observation_count, system_managed
    ) values (
      v_company_name, 'workday', v_tenant, v_region, v_site, v_careers_url,
      p_source_key, 'experimental', 0, clock_timestamp(), clock_timestamp(),
      null, null, null, true
    );
    return query select true, 'admitted_experimental'::text,
      'experimental'::text;
    return;
  end if;

  if p_reason not in (
    'pending_current_live_contract_proof',
    'pending_phase_06_wave_1_release',
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
    select company.id from public.companies as company
    where company.source_key = p_source_key
      and company.activation_state = 'experimental'
  );
  delete from public.companies as company
  where company.source_key = p_source_key
    and company.activation_state = 'experimental';
  update public.source_coverage_catalog
  set disposition = 'unsupported_with_reason', unsupported_reason = p_reason,
      source_key = null,
      access_evidence =
        'Exact Workday proof finished Unsupported; no operational authority remains.',
      verified_at = current_date
  where company_name = v_company_name and careers_url = v_careers_url;
  if not found then raise exception 'exact Workday catalog candidate missing'; end if;
  return query select true, 'recorded_unsupported'::text, 'disabled'::text;
end;
$$;

revoke execute on function public.finalize_workday_connector_candidate(
  text, text, text, text
) from public, anon, authenticated;
grant execute on function public.finalize_workday_connector_candidate(
  text, text, text, text
) to service_role;

-- Observation authority remains identical except for the expanded exact-source
-- allowlist. Positive evidence must be complete, equal-count, and warning-free.
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
      return query select false, 'retryable_lock_contention'::text,
        null::integer, null::timestamptz, null::timestamptz, null::text;
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
          'workday:wd3:barclays:External_Career_Site_Barclays',
          'workday:wd5:visa:Visa',
          'workday:wd1:pimco:pimco-careers',
          'workday:wd5:troweprice:TRowePrice',
          'workday:wd1:invesco:IVZ',
          'workday:wd3:bmo:External',
          'workday:wd5:athene:Apollo_Careers',
          'workday:wd1:mastercard:CorporateCareers',
          'workday:wd1:ntrs:northerntrust',
          'workday:wd5:vanguard:vanguard_external',
          'workday:wd5:workday:Workday',
          'workday:wd5:nvidia:NVIDIAExternalCareerSite'
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
      or (
        v_company.ats_type = 'paylocity'
        and v_company.source_key =
          'paylocity:global:d6628b21-949b-4400-a3d0-c9082bbf3eb1'
        and v_company.board_token = 'd6628b21-949b-4400-a3d0-c9082bbf3eb1'
        and v_company.region is null
        and v_company.site_token is null
      )
    )
  then
    return query select false, 'ineligible_company'::text,
      coalesce(v_company.activation_successes, 0), null::timestamptz,
      null::timestamptz, v_company.activation_state;
    return;
  end if;

  v_window_interval := case
    when v_company.ats_type = 'paylocity' then interval '10 minutes'
    else interval '1 minute'
  end;
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
    return query select false, 'same_window'::text,
      v_company.activation_successes, v_window_start, v_next_eligible_at,
      v_company.activation_state;
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
      activation_state = case
        when v_progress = 3 then 'active' else company.activation_state end,
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
            'workday:wd3:barclays:External_Career_Site_Barclays',
            'workday:wd5:visa:Visa',
            'workday:wd1:pimco:pimco-careers',
            'workday:wd5:troweprice:TRowePrice',
            'workday:wd1:invesco:IVZ',
            'workday:wd3:bmo:External',
            'workday:wd5:athene:Apollo_Careers',
            'workday:wd1:mastercard:CorporateCareers',
            'workday:wd1:ntrs:northerntrust',
            'workday:wd5:vanguard:vanguard_external',
            'workday:wd5:workday:Workday',
            'workday:wd5:nvidia:NVIDIAExternalCareerSite'
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
            'workday:wd3:barclays:External_Career_Site_Barclays',
            'workday:wd5:visa:Visa',
            'workday:wd1:pimco:pimco-careers',
            'workday:wd5:troweprice:TRowePrice',
            'workday:wd1:invesco:IVZ',
            'workday:wd3:bmo:External',
            'workday:wd5:athene:Apollo_Careers',
            'workday:wd1:mastercard:CorporateCareers',
            'workday:wd1:ntrs:northerntrust',
            'workday:wd5:vanguard:vanguard_external',
            'workday:wd5:workday:Workday',
            'workday:wd5:nvidia:NVIDIAExternalCareerSite'
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
      and coalesce(next_poll_at, last_polled_at, '-infinity'::timestamptz)
        <= v_now
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

-- Admit exactly the ten sealed targets as Experimental through the same
-- terminalization RPC that remains available for independently proven reserves.
do $$
declare
  v_result record;
begin
  select * into v_result from public.finalize_workday_connector_candidate(
    'workday:wd3:bmo:External', 'admit_experimental', null,
    'dc3f1ccd82680ff4a8e885a5a2e70dbb4e7ab76c9bfe1eb51087f4ddf48f4f47'
  );
  if v_result.accepted is not true then raise exception 'BMO admission failed'; end if;

  select * into v_result from public.finalize_workday_connector_candidate(
    'workday:wd1:pimco:pimco-careers', 'admit_experimental', null,
    '02336a1d7521e5bf856922cbed9ffbe93652016f959d4f0c7480cb0686b276d1'
  );
  if v_result.accepted is not true then raise exception 'PIMCO admission failed'; end if;

  select * into v_result from public.finalize_workday_connector_candidate(
    'workday:wd5:visa:Visa', 'admit_experimental', null,
    '59fbdd341a39a512b40ba408d8c0957eeb943d4fb8c2562c5c31da0d476454f6'
  );
  if v_result.accepted is not true then raise exception 'Visa admission failed'; end if;

  select * into v_result from public.finalize_workday_connector_candidate(
    'workday:wd5:athene:Apollo_Careers', 'admit_experimental', null,
    'b06381a0adb7a1aea47f3f37d830be827f87785789f24ed667f65648fa93d607'
  );
  if v_result.accepted is not true then
    raise exception 'Apollo Global Management admission failed';
  end if;

  select * into v_result from public.finalize_workday_connector_candidate(
    'workday:wd1:invesco:IVZ', 'admit_experimental', null,
    '029a39bba457794854ec068f3ceb1a87658ade94be14854aa9dcf1ce6f06d86c'
  );
  if v_result.accepted is not true then raise exception 'Invesco admission failed'; end if;

  select * into v_result from public.finalize_workday_connector_candidate(
    'workday:wd1:mastercard:CorporateCareers', 'admit_experimental', null,
    '3ff74a6ccd5c766776ca3e67c1dbc1796af15fdff6fd60a97149816839b3bfaa'
  );
  if v_result.accepted is not true then
    raise exception 'Mastercard admission failed';
  end if;

  select * into v_result from public.finalize_workday_connector_candidate(
    'workday:wd1:ntrs:northerntrust', 'admit_experimental', null,
    '60c7b23649b5e47cafd4c14d30174c11382f05692dcbbe8765d41eaa9c100e02'
  );
  if v_result.accepted is not true then
    raise exception 'Northern Trust admission failed';
  end if;

  select * into v_result from public.finalize_workday_connector_candidate(
    'workday:wd5:vanguard:vanguard_external', 'admit_experimental', null,
    '31d704c887b2c9b276923d1050d38160a11d0db6376d09dc91d8ca453900bed7'
  );
  if v_result.accepted is not true then raise exception 'Vanguard admission failed'; end if;

  select * into v_result from public.finalize_workday_connector_candidate(
    'workday:wd5:workday:Workday', 'admit_experimental', null,
    '571885659f76ca3d23b21362ab2bcc1adec9127b31a6f540cc416a1c70cb5822'
  );
  if v_result.accepted is not true then raise exception 'Workday admission failed'; end if;

  select * into v_result from public.finalize_workday_connector_candidate(
    'workday:wd5:nvidia:NVIDIAExternalCareerSite',
    'admit_experimental', null,
    '1c0c6e4763a0ebd3cce3dc5e830339ae56bed7bd214dd57bd4f2c5c25d6e2d90'
  );
  if v_result.accepted is not true then raise exception 'NVIDIA admission failed'; end if;
end;
$$;

-- End assertions make replay, partial admission, direct Active state, and
-- ownership drift fail the transaction atomically.
do $$
begin
  if (
    select count(*)
    from public.companies
    where source_key in (
      'workday:wd3:bmo:External',
      'workday:wd1:pimco:pimco-careers',
      'workday:wd5:visa:Visa',
      'workday:wd5:athene:Apollo_Careers',
      'workday:wd1:invesco:IVZ',
      'workday:wd1:mastercard:CorporateCareers',
      'workday:wd1:ntrs:northerntrust',
      'workday:wd5:vanguard:vanguard_external',
      'workday:wd5:workday:Workday',
      'workday:wd5:nvidia:NVIDIAExternalCareerSite'
    )
      and activation_state = 'experimental'
      and activation_successes = 0
      and system_managed is true
  ) <> 10 then
    raise exception
      'Phase 06 Wave 1 Experimental managed admission parity failed';
  end if;

  if exists (
    select 1 from public.companies
    where source_key in (
      'workday:wd3:bmo:External',
      'workday:wd1:pimco:pimco-careers',
      'workday:wd5:visa:Visa',
      'workday:wd5:athene:Apollo_Careers',
      'workday:wd1:invesco:IVZ',
      'workday:wd1:mastercard:CorporateCareers',
      'workday:wd1:ntrs:northerntrust',
      'workday:wd5:vanguard:vanguard_external',
      'workday:wd5:workday:Workday',
      'workday:wd5:nvidia:NVIDIAExternalCareerSite'
    ) and activation_state = 'active'
  ) then
    raise exception 'Phase 06 Wave 1 direct Active admission forbidden';
  end if;

  if (
    select count(*)
    from public.source_coverage_catalog
    where company_name in (
      'BMO', 'PIMCO', 'Visa', 'Apollo Global Management', 'Invesco',
      'Mastercard', 'Northern Trust', 'Vanguard', 'Workday', 'NVIDIA'
    ) and disposition = 'experimental' and source_key is not null
  ) <> 10 then
    raise exception 'Phase 06 Wave 1 catalog parity failed';
  end if;
end;
$$;

comment on column public.companies.system_managed is
  'True only for exact service-role-managed connector admissions; protected from authenticated individual deletion.';
comment on constraint workday_terminal_source_check
  on public.workday_connector_terminal_evidence is
  'Exact Workday candidate source keys admitted to terminal evidence.';

commit;

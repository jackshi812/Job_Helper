begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
begin
  if (
    select count(*)
    from public.source_coverage_catalog
    where company_name = 'JPMorgan Chase'
      and provider = 'Oracle Recruiting Cloud'
      and careers_url =
        'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/requisitions'
      and disposition = 'unsupported_with_reason'
      and unsupported_reason = 'pending_current_live_contract_proof'
      and source_key is null
  ) <> 1 then
    raise exception 'exact pre-repair JPMorgan catalog row missing';
  end if;

  if exists (
    select 1
    from public.companies
    where source_key = 'oracle:jpmc:CX_1001'
       or (name = 'JPMorgan Chase' and ats_type = 'oracle_recruiting')
  ) or exists (
    select 1
    from public.branded_connector_terminal_evidence
    where source_key = 'oracle:jpmc:CX_1001'
      and outcome = 'admit_experimental'
  ) then
    raise exception 'JPMorgan admission state changed before catalog repair';
  end if;
end;
$$;

update public.source_coverage_catalog
set careers_url =
      'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs',
    access_evidence =
      'Exact U.S. six-family Oracle scope uses title, location, posting-date, detail, and rolling-window evidence.',
    verified_at = current_date
where company_name = 'JPMorgan Chase'
  and provider = 'Oracle Recruiting Cloud'
  and careers_url =
    'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/requisitions'
  and disposition = 'unsupported_with_reason'
  and unsupported_reason = 'pending_current_live_contract_proof'
  and source_key is null;

do $$
begin
  if (
    select count(*)
    from public.source_coverage_catalog
    where company_name = 'JPMorgan Chase'
      and provider = 'Oracle Recruiting Cloud'
      and careers_url =
        'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs'
      and disposition = 'unsupported_with_reason'
      and unsupported_reason = 'pending_current_live_contract_proof'
      and source_key is null
  ) <> 1 then
    raise exception 'exact post-repair JPMorgan catalog row missing';
  end if;
end;
$$;

commit;

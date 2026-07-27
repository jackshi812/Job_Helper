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
        'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs'
      and disposition = 'unsupported_with_reason'
      and unsupported_reason = 'scope_evidence_incomplete'
      and source_key is null
  ) <> 1 then
    raise exception 'exact JPMorgan catalog state missing before identity repair';
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
    raise exception 'JPMorgan admission state changed before identity repair';
  end if;
end;
$$;

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
        and careers_url = 'https://higher.gs.com/roles'
        and source_key = 'goldman_higher:roles'
      )
    ) is true
  );

do $$
declare
  v_definition text;
begin
  select pg_catalog.pg_get_constraintdef(oid)
  into v_definition
  from pg_catalog.pg_constraint
  where conrelid = 'public.companies'::regclass
    and conname = 'companies_branded_identity_check';

  if v_definition is null
    or v_definition not like '%oracle:jpmc:CX_1001%'
    or v_definition not like '%/sites/CX_1001/jobs%'
    or v_definition not like '%eightfold:morganstanley%'
    or v_definition not like '%goldman_higher:roles%'
  then
    raise exception 'branded company identity constraint repair failed';
  end if;
end;
$$;

comment on constraint companies_branded_identity_check on public.companies is
  'Exact branded identities; JPMorgan Oracle canonical public path is /jobs.';

commit;

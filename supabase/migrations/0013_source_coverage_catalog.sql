-- The finance source-coverage catalog is read-only evidence for authenticated
-- users. It cannot enter company claims or connector dispatch on its own.
create table public.source_coverage_catalog (
  id uuid primary key default gen_random_uuid(),
  company_name text not null unique,
  careers_url text not null,
  provider text not null,
  access_evidence text not null,
  disposition text not null,
  verified_at date not null,
  unsupported_reason text,
  source_key text unique,
  constraint source_coverage_catalog_company_name_check check (
    length(company_name) between 1 and 120
  ),
  constraint source_coverage_catalog_careers_url_check check (
    length(careers_url) between 9 and 2048
    and careers_url ~ '^https://[^/[:space:]@]+(?:/[^[:space:]]*)?$'
  ),
  constraint source_coverage_catalog_provider_check check (
    length(provider) between 1 and 120
  ),
  constraint source_coverage_catalog_access_evidence_check check (
    length(access_evidence) between 1 and 500
  ),
  constraint source_coverage_catalog_disposition_check check (
    disposition in ('experimental', 'unsupported_with_reason')
  ),
  constraint source_coverage_catalog_reason_check check (
    unsupported_reason is null or length(unsupported_reason) between 1 and 160
  ),
  constraint source_coverage_catalog_source_key_check check (
    source_key is null or length(source_key) between 5 and 512
  ),
  constraint source_coverage_catalog_truthful_disposition_check check (
    (
      disposition = 'unsupported_with_reason'
      and unsupported_reason is not null
      and source_key is null
    )
    or (
      disposition = 'experimental'
      and unsupported_reason is null
      and source_key is not null
    )
  )
);

comment on column public.source_coverage_catalog.source_key is
  'Plan 06 shared constant contract; Capital One is workday:wd12:capitalone:Capital_One and must not be re-derived from display data.';

alter table public.source_coverage_catalog enable row level security;

revoke all on table public.source_coverage_catalog from public, anon, authenticated;
grant select on table public.source_coverage_catalog to authenticated;
grant all on table public.source_coverage_catalog to service_role;

create policy "source_coverage_catalog_select_authenticated"
  on public.source_coverage_catalog
  for select
  to authenticated
  using (true);

insert into public.source_coverage_catalog (
  company_name,
  careers_url,
  provider,
  access_evidence,
  disposition,
  verified_at,
  unsupported_reason,
  source_key
)
values
  (
    'Morgan Stanley',
    'https://www.morganstanley.com/careers/career-opportunities-search/',
    'Eightfold',
    'Official machine API requires OAuth credentials; the public PCS listing contract was not proven.',
    'unsupported_with_reason',
    date '2026-07-17',
    'Public API requires employer credentials',
    null
  ),
  (
    'Goldman Sachs',
    'https://higher.gs.com/roles',
    'Branded/custom',
    'No stable public listing contract was established for the branded careers site.',
    'unsupported_with_reason',
    date '2026-07-17',
    'No stable public feed',
    null
  ),
  (
    'JPMorgan Chase',
    'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/requisitions',
    'Oracle Recruiting Cloud',
    'The candidate requisition endpoint is documented for Oracle internal use.',
    'unsupported_with_reason',
    date '2026-07-17',
    'Public API requires employer credentials',
    null
  ),
  (
    'Bank of America',
    'https://careers.bankofamerica.com/en-us/job-search',
    'Branded/custom AEM',
    'Mixed provider links were observed, but no single documented anonymous listing contract was established.',
    'unsupported_with_reason',
    date '2026-07-17',
    'No stable public feed',
    null
  ),
  (
    'Citi',
    'https://jobs.citi.com/search-jobs',
    'Radancy/TalentBrew',
    'The branded search was public, but no documented public listing API was established.',
    'unsupported_with_reason',
    date '2026-07-17',
    'No stable public feed',
    null
  ),
  (
    'BlackRock',
    'https://careers.blackrock.com/search-jobs',
    'Radancy/TalentBrew',
    'The branded search was public, but no documented public listing API was established.',
    'unsupported_with_reason',
    date '2026-07-17',
    'No stable public feed',
    null
  ),
  (
    'Wells Fargo',
    'https://www.wellsfargojobs.com/en/jobs/',
    'Branded/custom',
    'A direct automation probe reached a Cloudflare challenge; no bypass was attempted.',
    'unsupported_with_reason',
    date '2026-07-17',
    'Automated access is blocked',
    null
  ),
  (
    'UBS',
    'https://jobs.ubs.com/TGnewUI/Search/Home/HomeWithPreLoad?PageType=JobDetails&partnerid=25008&siteid=5012',
    'Oracle Taleo',
    'The public Taleo URL was WAF-limited and no supported anonymous machine API was proven.',
    'unsupported_with_reason',
    date '2026-07-17',
    'No stable public feed',
    null
  ),
  (
    'Barclays',
    'https://search.jobs.barclays/en/search-jobs',
    'Radancy/TalentBrew',
    'The branded search was public, but no documented public listing API was established.',
    'unsupported_with_reason',
    date '2026-07-17',
    'No stable public feed',
    null
  ),
  (
    'Capital One',
    'https://www.capitalonecareers.com/search-jobs',
    'Workday',
    'The allowlisted candidate CXS endpoint returned a reconciled public listing; the contract remains undocumented.',
    'experimental',
    date '2026-07-17',
    null,
    'workday:wd12:capitalone:Capital_One'
  ),
  (
    'Fidelity',
    'https://jobs.fidelity.com/en/jobs/',
    'Branded/custom',
    'A direct automation probe reached a Cloudflare challenge; no bypass was attempted.',
    'unsupported_with_reason',
    date '2026-07-17',
    'Automated access is blocked',
    null
  ),
  (
    'Charles Schwab',
    'https://www.schwabjobs.com/job-search-results/',
    'iCIMS / Radancy',
    'The official iCIMS machine API requires Basic authentication.',
    'unsupported_with_reason',
    date '2026-07-17',
    'Public API requires employer credentials',
    null
  );

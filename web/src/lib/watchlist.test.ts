import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UNSUPPORTED_URL_MESSAGE } from '../../../supabase/functions/_shared/detect'
import sourceCoverageCatalogMigration from '../../../supabase/migrations/0013_source_coverage_catalog.sql?raw'
import {
  activationPresentation,
  addCompany,
  COMPANY_COLUMNS,
  deriveHealth,
  healthPresentation,
  listCompanies,
  mergeCoverageRows,
  safeCareersUrl,
  SOURCE_COVERAGE_CATALOG_COLUMNS,
  type SourceCoverageCatalogRecord,
  type CompanyRecord,
} from './watchlist'
import { supabase } from './supabase'

vi.mock('./supabase', () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    from: vi.fn(),
  },
}))

const now = new Date('2026-07-16T12:00:00.000Z')

function company(overrides: Partial<CompanyRecord> = {}): CompanyRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Acme',
    ats_type: 'greenhouse',
    board_token: 'acme',
    region: null,
    careers_url: 'https://job-boards.greenhouse.io/acme',
    source_key: 'greenhouse:global:acme',
    site_token: null,
    activation_state: 'active',
    activation_successes: 0,
    last_verified_at: now.toISOString(),
    last_error_code: null,
    last_observation_count: 3,
    last_polled_at: now.toISOString(),
    last_success_at: new Date(now.getTime() - 10 * 60_000).toISOString(),
    consecutive_failures: 0,
    last_error: null,
    created_at: now.toISOString(),
    ...overrides,
  }
}

const CAPITAL_ONE_SOURCE_KEY = 'workday:wd12:capitalone:Capital_One'

const financeCatalog: SourceCoverageCatalogRecord[] = [
  {
    id: 'catalog-morgan-stanley',
    company_name: 'Morgan Stanley',
    careers_url: 'https://www.morganstanley.com/careers/career-opportunities-search/',
    provider: 'Eightfold',
    access_evidence: 'Official machine API requires OAuth credentials.',
    disposition: 'unsupported_with_reason',
    verified_at: '2026-07-17',
    unsupported_reason: 'Public API requires employer credentials',
    source_key: null,
  },
  {
    id: 'catalog-goldman-sachs',
    company_name: 'Goldman Sachs',
    careers_url: 'https://higher.gs.com/roles',
    provider: 'Branded/custom',
    access_evidence: 'No stable public listing contract was established.',
    disposition: 'unsupported_with_reason',
    verified_at: '2026-07-17',
    unsupported_reason: 'No stable public feed',
    source_key: null,
  },
  {
    id: 'catalog-jpmorgan-chase',
    company_name: 'JPMorgan Chase',
    careers_url: 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/requisitions',
    provider: 'Oracle Recruiting Cloud',
    access_evidence: 'Candidate requisition API is marked Oracle-internal.',
    disposition: 'unsupported_with_reason',
    verified_at: '2026-07-17',
    unsupported_reason: 'Public API requires employer credentials',
    source_key: null,
  },
  {
    id: 'catalog-bank-of-america',
    company_name: 'Bank of America',
    careers_url: 'https://careers.bankofamerica.com/en-us/job-search',
    provider: 'Branded/custom AEM',
    access_evidence: 'No single documented anonymous source contract was established.',
    disposition: 'unsupported_with_reason',
    verified_at: '2026-07-17',
    unsupported_reason: 'No stable public feed',
    source_key: null,
  },
  {
    id: 'catalog-citi',
    company_name: 'Citi',
    careers_url: 'https://jobs.citi.com/search-jobs',
    provider: 'Radancy/TalentBrew',
    access_evidence: 'No documented public listing API was established.',
    disposition: 'unsupported_with_reason',
    verified_at: '2026-07-17',
    unsupported_reason: 'No stable public feed',
    source_key: null,
  },
  {
    id: 'catalog-blackrock',
    company_name: 'BlackRock',
    careers_url: 'https://careers.blackrock.com/search-jobs',
    provider: 'Radancy/TalentBrew',
    access_evidence: 'No documented public listing API was established.',
    disposition: 'unsupported_with_reason',
    verified_at: '2026-07-17',
    unsupported_reason: 'No stable public feed',
    source_key: null,
  },
  {
    id: 'catalog-wells-fargo',
    company_name: 'Wells Fargo',
    careers_url: 'https://www.wellsfargojobs.com/en/jobs/',
    provider: 'Branded/custom',
    access_evidence: 'Direct automation reached a Cloudflare challenge.',
    disposition: 'unsupported_with_reason',
    verified_at: '2026-07-17',
    unsupported_reason: 'Automated access is blocked',
    source_key: null,
  },
  {
    id: 'catalog-ubs',
    company_name: 'UBS',
    careers_url: 'https://jobs.ubs.com/TGnewUI/Search/Home/HomeWithPreLoad?PageType=JobDetails&partnerid=25008&siteid=5012',
    provider: 'Oracle Taleo',
    access_evidence: 'No supported anonymous machine API was established.',
    disposition: 'unsupported_with_reason',
    verified_at: '2026-07-17',
    unsupported_reason: 'No stable public feed',
    source_key: null,
  },
  {
    id: 'catalog-barclays',
    company_name: 'Barclays',
    careers_url: 'https://search.jobs.barclays/en/search-jobs',
    provider: 'Radancy/TalentBrew',
    access_evidence: 'No documented public listing API was established.',
    disposition: 'unsupported_with_reason',
    verified_at: '2026-07-17',
    unsupported_reason: 'No stable public feed',
    source_key: null,
  },
  {
    id: 'catalog-capital-one',
    company_name: 'Capital One',
    careers_url: 'https://www.capitalonecareers.com/search-jobs',
    provider: 'Workday',
    access_evidence: 'Allowlisted candidate CXS endpoint returned a reconciled public listing.',
    disposition: 'experimental',
    verified_at: '2026-07-17',
    unsupported_reason: null,
    source_key: CAPITAL_ONE_SOURCE_KEY,
  },
  {
    id: 'catalog-fidelity',
    company_name: 'Fidelity',
    careers_url: 'https://jobs.fidelity.com/en/jobs/',
    provider: 'Branded/custom',
    access_evidence: 'Direct automation reached a Cloudflare challenge.',
    disposition: 'unsupported_with_reason',
    verified_at: '2026-07-17',
    unsupported_reason: 'Automated access is blocked',
    source_key: null,
  },
  {
    id: 'catalog-charles-schwab',
    company_name: 'Charles Schwab',
    careers_url: 'https://www.schwabjobs.com/job-search-results/',
    provider: 'iCIMS / Radancy',
    access_evidence: 'The official iCIMS machine API requires Basic authentication.',
    disposition: 'unsupported_with_reason',
    verified_at: '2026-07-17',
    unsupported_reason: 'Public API requires employer credentials',
    source_key: null,
  },
]

describe('finance coverage presentation', () => {
  afterEach(() => {
    vi.mocked(supabase.from).mockReset()
  })

  it('enumerates the complete fixed finance set with canonical provider evidence', () => {
    expect(financeCatalog.map((entry) => entry.company_name)).toEqual([
      'Morgan Stanley',
      'Goldman Sachs',
      'JPMorgan Chase',
      'Bank of America',
      'Citi',
      'BlackRock',
      'Wells Fargo',
      'UBS',
      'Barclays',
      'Capital One',
      'Fidelity',
      'Charles Schwab',
    ])
    expect(financeCatalog.every((entry) => entry.careers_url && entry.provider && entry.access_evidence)).toBe(true)
    expect(financeCatalog.find((entry) => entry.company_name === 'Capital One')?.source_key)
      .toBe('workday:wd12:capitalone:Capital_One')
  })

  it('pins the evidence seeds, read-only policy, and Capital One identity in migration 0013', () => {
    for (const entry of financeCatalog) {
      expect(sourceCoverageCatalogMigration).toContain(`'${entry.company_name}'`)
      expect(sourceCoverageCatalogMigration).toContain(`'${entry.careers_url}'`)
      expect(sourceCoverageCatalogMigration).toContain(`'${entry.provider}'`)
    }
    expect(sourceCoverageCatalogMigration).toContain("'workday:wd12:capitalone:Capital_One'")
    expect(sourceCoverageCatalogMigration).toContain('revoke all on table public.source_coverage_catalog from public, anon, authenticated')
    expect(sourceCoverageCatalogMigration).toContain('grant select on table public.source_coverage_catalog to authenticated')
    expect(sourceCoverageCatalogMigration).toContain("disposition in ('experimental', 'unsupported_with_reason')")
  })

  it('loads company progress and catalog evidence without querying the observation ledger', async () => {
    const capitalOne = company({
      id: 'company-capital-one',
      ats_type: 'workday',
      region: 'wd12',
      source_key: CAPITAL_ONE_SOURCE_KEY,
      site_token: 'Capital_One',
      activation_state: 'experimental',
      activation_successes: 2,
    })
    vi.mocked(supabase.from).mockImplementation(((table: string) => ({
      select: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue(table === 'companies'
          ? { data: [capitalOne], error: null }
          : { data: financeCatalog, error: null }),
      }),
    })) as never)

    const rows = await listCompanies()

    expect(supabase.from).toHaveBeenCalledWith('companies')
    expect(supabase.from).toHaveBeenCalledWith('source_coverage_catalog')
    expect(supabase.from).not.toHaveBeenCalledWith('connector_observations')
    expect(SOURCE_COVERAGE_CATALOG_COLUMNS).toContain('access_evidence')
    expect(rows.find((row) => row.name === 'Capital One')?.activation_successes).toBe(2)
  })

  it.each([
    ['https://jobs.example.com/search', 'https://jobs.example.com/search'],
    ['http://jobs.example.com/search', null],
    ['javascript:alert(1)', null],
    ['not a URL', null],
    ['', null],
    [null, null],
  ])('turns %s into a safe canonical link or Unavailable', (value, expected) => {
    expect(safeCareersUrl(value)).toBe(expected)
  })

  it('reconciles Capital One once by the pinned source key and leaves unsupported evidence non-operational', () => {
    const capitalOne = company({
      id: 'company-capital-one',
      name: 'Capital One connector',
      ats_type: 'workday',
      board_token: 'capitalone',
      region: 'wd12',
      careers_url: 'https://capitalone.wd12.myworkdayjobs.com/Capital_One',
      source_key: CAPITAL_ONE_SOURCE_KEY,
      site_token: 'Capital_One',
      activation_state: 'experimental',
      activation_successes: 2,
    })

    const rows = mergeCoverageRows([capitalOne], financeCatalog)
    expect(rows).toHaveLength(12)
    expect(rows.filter((row) => row.name === 'Capital One')).toHaveLength(1)
    expect(rows.find((row) => row.name === 'Capital One')).toMatchObject({
      company_id: 'company-capital-one',
      careers_url: 'https://www.capitalonecareers.com/search-jobs',
      source_key: CAPITAL_ONE_SOURCE_KEY,
      provider: 'Workday',
      activation_state: 'experimental',
      activation_successes: 2,
    })

    const unsupported = rows.filter((row) => row.disposition === 'unsupported_with_reason')
    expect(unsupported).toHaveLength(11)
    expect(unsupported.every((row) => (
      row.company_id === null
      && row.source_key === null
      && row.activation_state === 'disabled'
      && row.health_state === 'unsupported'
      && row.scheduled === false
      && row.monitored === false
    ))).toBe(true)
  })

  it('keeps activation independent from health and reads experimental progress from companies', () => {
    const experimental = mergeCoverageRows([
      company({
        ats_type: 'workday',
        region: 'wd12',
        source_key: CAPITAL_ONE_SOURCE_KEY,
        activation_state: 'experimental',
        activation_successes: 2,
        consecutive_failures: 1,
        last_error_code: 'timeout',
      }),
    ], financeCatalog).find((row) => row.name === 'Capital One')!

    expect(activationPresentation(experimental)).toEqual({
      label: 'Experimental',
      details: ['2 of 3 checks passed', 'Scheduled polling off'],
    })
    expect(healthPresentation(experimental)).toEqual({
      label: 'Degraded',
      detail: 'Timed out while syncing.',
      retention: 'Last-known jobs retained.',
    })

    const unsupported = mergeCoverageRows([], financeCatalog)[0]
    expect(activationPresentation(unsupported)).toEqual({
      label: 'Disabled',
      details: ['Scheduled polling off'],
    })
    expect(healthPresentation(unsupported)).toEqual({
      label: 'Unsupported',
      detail: 'Public API requires employer credentials',
      retention: 'Not monitored',
    })
  })

  it.each([
    ['timeout', 'Timed out while syncing.'],
    ['http_403', 'Access blocked by source.'],
    ['malformed_response', 'Source response changed.'],
    ['detail_failure', 'Source returned an incomplete job list.'],
    ['implausibly_empty', 'Unexpected empty result.'],
    ['provider_secret=https://jobs.example/?token=unsafe', 'Latest sync could not be completed.'],
  ])('translates %s into bounded approved degraded copy', (last_error_code, detail) => {
    const operational = mergeCoverageRows([
      company({
        source_key: 'greenhouse:global:acme',
        consecutive_failures: 1,
        last_error: 'https://jobs.example/?token=unsafe',
        last_error_code,
      }),
    ], [])[0]

    expect(healthPresentation(operational)).toEqual({
      label: 'Degraded',
      detail,
      retention: 'Last-known jobs retained.',
    })
    expect(JSON.stringify(healthPresentation(operational))).not.toMatch(/token=unsafe/)
  })
})

describe('deriveHealth', () => {
  it('is OK after two failures when the last success is fresh', () => {
    expect(deriveHealth(company({ consecutive_failures: 2 }), now)).toBe('ok')
  })

  it('is failing at three consecutive failures even when the last success is fresh', () => {
    expect(deriveHealth(company({ consecutive_failures: 3 }), now)).toBe('failing')
  })

  it('is OK 29 minutes after the last successful poll', () => {
    const last_success_at = new Date(now.getTime() - 29 * 60_000).toISOString()
    expect(deriveHealth(company({ last_success_at }), now)).toBe('ok')
  })

  it('is stale 31 minutes after the last successful poll', () => {
    const last_success_at = new Date(now.getTime() - 31 * 60_000).toISOString()
    expect(deriveHealth(company({ last_success_at }), now)).toBe('stale')
  })

  it('is stale when the board has never succeeded', () => {
    expect(deriveHealth(company({ last_success_at: null }), now)).toBe('stale')
  })
})

describe('addCompany', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects an unsupported URL before making a network call', async () => {
    await expect(addCompany('https://careers.example.com/jobs')).rejects.toThrow(
      UNSUPPORTED_URL_MESSAGE,
    )
    expect(supabase.functions.invoke).not.toHaveBeenCalled()
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('surfaces the verification message without inserting when the board is rejected', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: {
        ok: false,
        reason: 'not_found',
        message: 'Check the address and try again.',
      },
      error: null,
    } as never)

    await expect(addCompany('https://boards.greenhouse.io/not-real')).rejects.toThrow(
      'Check the address and try again.',
    )
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('returns the server-written company without a browser insert', async () => {
    const saved = company()
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: { ok: true, company: saved, already_watched: false },
      error: null,
    } as never)

    await expect(addCompany('https://job-boards.greenhouse.io/acme')).resolves.toEqual(saved)

    expect(supabase.functions.invoke).toHaveBeenCalledWith('verify-board', {
      body: { url: 'https://job-boards.greenhouse.io/acme' },
    })
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('keeps duplicate adds friendly without attempting an operational overwrite', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: {
        ok: false,
        reason: 'already_watched',
        message: 'Acme is already on the watchlist.',
      },
      error: null,
    } as never)

    await expect(addCompany('https://job-boards.greenhouse.io/acme')).rejects.toThrow(
      'Acme is already on the watchlist.',
    )
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('selects the canonical link and authoritative connector-state columns', () => {
    expect(COMPANY_COLUMNS).toContain('careers_url')
    expect(COMPANY_COLUMNS).toContain('source_key')
    expect(COMPANY_COLUMNS).toContain('activation_state')
    expect(COMPANY_COLUMNS).toContain('activation_successes')
    expect(COMPANY_COLUMNS).toContain('last_verified_at')
    expect(COMPANY_COLUMNS).toContain('last_error_code')
    expect(COMPANY_COLUMNS).toContain('last_observation_count')
  })
})

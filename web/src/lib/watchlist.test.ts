import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UNSUPPORTED_URL_MESSAGE } from '../../../supabase/functions/_shared/detect'
import sourceCoverageCatalogMigration from '../../../supabase/migrations/0013_source_coverage_catalog.sql?raw'
import brandedConnectorMigration from '../../../supabase/migrations/0040_phase_03_8_branded_connectors.sql?raw'
import workdayCandidateMigration from '../../../supabase/migrations/0043_phase_03_8_workday_candidates.sql?raw'
import {
  activationPresentation,
  addCompany,
  COLLAPSED_COMPANIES_STORAGE_KEY,
  COMPANY_COLUMNS,
  deriveHealth,
  healthPresentation,
  listCompanies,
  loadCollapsedCompanyKeys,
  mergeCoverageRows,
  groupWatchlistRows,
  REMOVE_COMPANY_TIMEOUT_MESSAGE,
  REMOVE_COMPANY_TIMEOUT_MS,
  removeCompany,
  safeCareersUrl,
  saveCollapsedCompanyKeys,
  SOURCE_COVERAGE_CATALOG_COLUMNS,
  type SourceCoverageCatalogRecord,
  type CompanyRecord,
  type WatchlistRow,
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
const FIDELITY_SOURCE_KEY = 'workday:wd1:fmr:FidelityCareers'
const MORGAN_STANLEY_SOURCE_KEY = 'workday:wd5:ms:External'

const financeCatalog: SourceCoverageCatalogRecord[] = [
  {
    id: 'catalog-morgan-stanley',
    company_name: 'Morgan Stanley',
    careers_url: 'https://ms.wd5.myworkdayjobs.com/en-US/External',
    provider: 'Workday',
    access_evidence: 'Current exact hosted live proof remains pending.',
    disposition: 'unsupported_with_reason',
    verified_at: '2026-07-25',
    unsupported_reason: 'pending_current_live_contract_proof',
    source_key: null,
  },
  {
    id: 'catalog-goldman-sachs',
    company_name: 'Goldman Sachs',
    careers_url: 'https://higher.gs.com/roles',
    provider: 'Goldman Higher',
    access_evidence: 'Current exact hosted live proof remains pending.',
    disposition: 'unsupported_with_reason',
    verified_at: '2026-07-25',
    unsupported_reason: 'pending_current_live_contract_proof',
    source_key: null,
  },
  {
    id: 'catalog-jpmorgan-chase',
    company_name: 'JPMorgan Chase',
    careers_url: 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/requisitions',
    provider: 'Oracle Recruiting Cloud',
    access_evidence: 'Current exact hosted live proof remains pending.',
    disposition: 'unsupported_with_reason',
    verified_at: '2026-07-25',
    unsupported_reason: 'pending_current_live_contract_proof',
    source_key: null,
  },
  {
    id: 'catalog-bank-of-america',
    company_name: 'Bank of America',
    careers_url: 'https://ghr.wd1.myworkdayjobs.com/en-US/Lateral-US',
    provider: 'Workday',
    access_evidence: 'Exact whole-site U.S. detail proof remains pending.',
    disposition: 'unsupported_with_reason',
    verified_at: '2026-07-26',
    unsupported_reason: 'pending_current_live_contract_proof',
    source_key: null,
  },
  {
    id: 'catalog-blackrock',
    company_name: 'BlackRock',
    careers_url: 'https://blackrock.wd1.myworkdayjobs.com/en-US/BlackRock_Professional',
    provider: 'Workday',
    access_evidence: 'No exact safe country contract has been proven.',
    disposition: 'unsupported_with_reason',
    verified_at: '2026-07-26',
    unsupported_reason: 'pending_current_live_contract_proof',
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
    unsupported_reason: 'structured_endpoint_requires_html_bootstrap_session',
    source_key: null,
  },
  {
    id: 'catalog-barclays',
    company_name: 'Barclays',
    careers_url: 'https://barclays.wd3.myworkdayjobs.com/en-US/External_Career_Site_Barclays',
    provider: 'Workday',
    access_evidence: 'No exact safe country contract has been proven.',
    disposition: 'unsupported_with_reason',
    verified_at: '2026-07-26',
    unsupported_reason: 'pending_current_live_contract_proof',
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
    provider: 'Workday',
    access_evidence: 'The exact public Workday source is already Active.',
    disposition: 'experimental',
    verified_at: '2026-07-24',
    unsupported_reason: null,
    source_key: FIDELITY_SOURCE_KEY,
  },
  {
    id: 'catalog-charles-schwab',
    company_name: 'Charles Schwab',
    careers_url: 'https://www.schwabjobs.com/job-search-results/',
    provider: 'iCIMS / Radancy',
    access_evidence: 'The official iCIMS machine API requires Basic authentication.',
    disposition: 'unsupported_with_reason',
    verified_at: '2026-07-17',
    unsupported_reason: 'radancy_results_require_html_parsing',
    source_key: null,
  },
]

describe('watchlist row grouping', () => {
  it('collects collapsed companies in a separate group without changing row order', () => {
    const rows = mergeCoverageRows([
      company({ id: 'company-alpha', name: 'Alpha', source_key: 'greenhouse:global:alpha' }),
      company({ id: 'company-beta', name: 'Beta', source_key: 'greenhouse:global:beta' }),
      company({ id: 'company-gamma', name: 'Gamma', source_key: 'greenhouse:global:gamma' }),
    ], [])

    const grouped = groupWatchlistRows(rows, new Set([rows[0].key, rows[2].key]))

    expect(grouped.visible.map((row) => row.name)).toEqual(['Beta'])
    expect(grouped.other.map((row) => row.name)).toEqual(['Alpha', 'Gamma'])
    expect(rows.map((row) => row.name)).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('persists and restores collapsed company keys', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    }

    saveCollapsedCompanyKeys(new Set(['company:beta', 'company:alpha']), storage)

    expect(values.get(COLLAPSED_COMPANIES_STORAGE_KEY)).toBe(
      '["company:alpha","company:beta"]',
    )
    expect([...loadCollapsedCompanyKeys(storage)]).toEqual(['company:alpha', 'company:beta'])

    saveCollapsedCompanyKeys(new Set(), storage)
    expect(values.has(COLLAPSED_COMPANIES_STORAGE_KEY)).toBe(false)
  })

  it('ignores malformed or unavailable collapsed-company storage', () => {
    const malformedStorage = {
      getItem: () => '{not-json',
      setItem: () => undefined,
      removeItem: () => undefined,
    }
    const unavailableStorage = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    }

    expect(loadCollapsedCompanyKeys(malformedStorage)).toEqual(new Set())
    expect(loadCollapsedCompanyKeys(unavailableStorage)).toEqual(new Set())
    expect(() => saveCollapsedCompanyKeys(new Set(['company:alpha']), unavailableStorage))
      .not.toThrow()
  })
})

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
      'BlackRock',
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

  it('pins current evidence seeds while preserving the read-only catalog policy', () => {
    for (const entry of financeCatalog) {
      const owningMigration = ['Capital One', 'Fidelity'].includes(entry.company_name)
        ? sourceCoverageCatalogMigration
        : ['Goldman Sachs', 'JPMorgan Chase'].includes(entry.company_name)
          ? brandedConnectorMigration
          : workdayCandidateMigration
      expect(owningMigration).toContain(`'${entry.company_name}'`)
      expect(owningMigration).toContain(`'${entry.careers_url}'`)
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
    expect(rows).toHaveLength(10)
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
    expect(unsupported).toHaveLength(8)
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
      details: [
        'Workday filter: Analysis and Finance roles posted in the last 7 days; U.S. only; required experience below 3 years (job title does not exclude a role).',
      ],
    })
    expect(activationPresentation({ ...experimental, activation_state: 'active' })).toEqual({
      label: 'Active',
      details: [
        'Workday filter: Analysis and Finance roles posted in the last 7 days; U.S. only; required experience below 3 years (job title does not exclude a role).',
      ],
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
      detail: 'pending_current_live_contract_proof',
      retention: 'Not monitored',
    })
  })

  it('merges a positively terminalized Workday candidate once through Experimental and Active', () => {
    const admittedCatalog = financeCatalog.map((entry) => (
      entry.company_name === 'Morgan Stanley'
        ? {
            ...entry,
            disposition: 'experimental' as const,
            unsupported_reason: null,
            source_key: MORGAN_STANLEY_SOURCE_KEY,
          }
        : entry
    ))
    const experimental = company({
      id: 'company-morgan-stanley',
      name: 'Morgan Stanley',
      ats_type: 'workday',
      board_token: 'ms',
      region: 'wd5',
      site_token: 'External',
      careers_url: 'https://ms.wd5.myworkdayjobs.com/en-US/External',
      source_key: MORGAN_STANLEY_SOURCE_KEY,
      activation_state: 'experimental',
      activation_successes: 0,
      last_success_at: null,
    })

    const rows = mergeCoverageRows([experimental], admittedCatalog)
    const morganRows = rows.filter((row) => row.name === 'Morgan Stanley')
    expect(rows).toHaveLength(10)
    expect(morganRows).toHaveLength(1)
    expect(morganRows[0]).toMatchObject({
      company_id: 'company-morgan-stanley',
      source_key: MORGAN_STANLEY_SOURCE_KEY,
      activation_state: 'experimental',
      activation_successes: 0,
      scheduled: false,
      monitored: true,
    })
    expect(activationPresentation(morganRows[0])).toEqual({
      label: 'Experimental',
      details: ['0 of 3 checks passed', 'Scheduled polling off'],
    })
    expect(mergeCoverageRows([
      { ...experimental, activation_state: 'active', activation_successes: 3 },
    ], admittedCatalog).find((row) => row.name === 'Morgan Stanley')).toMatchObject({
      activation_state: 'active',
      scheduled: true,
      monitored: true,
    })
  })

  it('keeps all four non-candidates exact and protects Active Capital One and Fidelity', () => {
    const capitalOne = company({
      id: 'company-capital-one',
      name: 'Capital One',
      ats_type: 'workday',
      board_token: 'capitalone',
      region: 'wd12',
      site_token: 'Capital_One',
      source_key: CAPITAL_ONE_SOURCE_KEY,
      activation_state: 'active',
    })
    const fidelity = company({
      id: 'company-fidelity',
      name: 'Fidelity',
      ats_type: 'workday',
      board_token: 'fmr',
      region: 'wd1',
      site_token: 'FidelityCareers',
      careers_url: 'https://wd1.myworkdaysite.com/en-US/recruiting/fmr/FidelityCareers',
      source_key: FIDELITY_SOURCE_KEY,
      activation_state: 'active',
    })
    const rows = mergeCoverageRows([capitalOne, fidelity], financeCatalog)
    const negativeNames = [
      'Goldman Sachs',
      'JPMorgan Chase',
      'UBS',
      'Charles Schwab',
    ]
    expect(rows.filter((row) => negativeNames.includes(row.name))).toHaveLength(4)
    expect(rows.filter((row) => negativeNames.includes(row.name)).every((row) => (
      row.company_id === null
      && row.source_key === null
      && row.health_state === 'unsupported'
      && row.scheduled === false
      && row.monitored === false
    ))).toBe(true)
    for (const name of ['Capital One', 'Fidelity']) {
      expect(rows.find((row) => row.name === name)).toMatchObject({
        provider: 'Workday',
        activation_state: 'active',
        scheduled: true,
        monitored: true,
      })
    }
  })

  it('uses successful Experimental verification evidence without enabling scheduling', () => {
    const lastVerifiedAt = '2026-07-17T16:30:00.000Z'
    const experimental = mergeCoverageRows([
      company({
        ats_type: 'workday',
        region: 'wd12',
        source_key: CAPITAL_ONE_SOURCE_KEY,
        site_token: 'Capital_One',
        activation_state: 'experimental',
        activation_successes: 3,
        last_success_at: null,
        last_verified_at: lastVerifiedAt,
        consecutive_failures: 0,
        last_error_code: null,
      }),
    ], financeCatalog).find((row) => row.name === 'Capital One')!

    expect(experimental).toMatchObject({
      activation_state: 'experimental',
      activation_successes: 3,
      health_state: 'ok',
      last_success_at: lastVerifiedAt,
      scheduled: false,
    })
    expect(activationPresentation(experimental)).toEqual({
      label: 'Experimental',
      details: [
        'Workday filter: Analysis and Finance roles posted in the last 7 days; U.S. only; required experience below 3 years (job title does not exclude a role).',
      ],
    })
    expect(healthPresentation(experimental)).toEqual({
      label: 'OK',
      detail: null,
      retention: null,
    })
  })

  it('shows a Fidelity filter note keyed on the Fidelity source key and reuses existing badges', () => {
    const fidelity: WatchlistRow = {
      key: 'company-fidelity',
      company_id: '22222222-2222-4222-8222-222222222222',
      catalog_id: 'catalog-fidelity',
      name: 'Fidelity',
      careers_url: 'https://wd1.myworkdaysite.com/en-US/recruiting/fmr/FidelityCareers',
      source_key: FIDELITY_SOURCE_KEY,
      provider: 'Workday',
      access_evidence: null,
      disposition: 'experimental',
      activation_state: 'experimental',
      activation_successes: 1,
      health_state: 'ok',
      last_success_at: now.toISOString(),
      last_error_code: null,
      unsupported_reason: null,
      created_at: now.toISOString(),
      scheduled: false,
      monitored: true,
    }

    const fidelityNote =
      'Workday filter: excludes Sales, Customer Service, and Sales Support roles; required experience is applied by the dashboard filters, not the connector.'

    expect(activationPresentation(fidelity)).toEqual({
      label: 'Experimental',
      details: [fidelityNote],
    })
    expect(activationPresentation({ ...fidelity, activation_state: 'active' })).toEqual({
      label: 'Active',
      details: [fidelityNote],
    })
    // Capital One note must stay byte-identical (not shared with Fidelity).
    expect(fidelityNote).not.toContain('Analysis and Finance')
    // Reuses existing health presentation — no new badge logic.
    expect(healthPresentation(fidelity)).toEqual({
      label: 'OK',
      detail: null,
      retention: null,
    })
  })

  it.each([
    [{ consecutive_failures: 1 }, 'Latest sync could not be completed.'],
    [{ last_error_code: 'timeout' }, 'Timed out while syncing.'],
  ])('keeps failed Experimental verification degraded for %o', (failure, detail) => {
    const experimental = mergeCoverageRows([
      company({
        ats_type: 'workday',
        region: 'wd12',
        source_key: CAPITAL_ONE_SOURCE_KEY,
        activation_state: 'experimental',
        activation_successes: 3,
        last_success_at: null,
        last_verified_at: '2026-07-17T16:30:00.000Z',
        ...failure,
      }),
    ], financeCatalog).find((row) => row.name === 'Capital One')!

    expect(experimental).toMatchObject({
      health_state: 'degraded',
      last_success_at: null,
      scheduled: false,
    })
    expect(healthPresentation(experimental)).toEqual({
      label: 'Degraded',
      detail,
      retention: 'Last-known jobs retained.',
    })
  })

  it.each([
    ['timeout', 'Timed out while syncing.'],
    ['provider_timeout', 'Timed out while syncing.'],
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

describe('removeCompany', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function deleteBuilder(result: Promise<{ error: unknown }>) {
    const abortSignal = vi.fn().mockReturnValue(result)
    const eq = vi.fn().mockReturnValue({ abortSignal })
    const deleteCompany = vi.fn().mockReturnValue({ eq })
    vi.mocked(supabase.from).mockReturnValue({ delete: deleteCompany } as never)
    return { abortSignal, deleteCompany, eq }
  }

  it('aborts a never-resolving deletion at the bounded deadline', async () => {
    const pending = new Promise<{ error: unknown }>(() => {})
    const { abortSignal, deleteCompany, eq } = deleteBuilder(pending)

    const removal = removeCompany('company-acme')
    const signal = abortSignal.mock.calls[0]?.[0] as AbortSignal

    expect(supabase.from).toHaveBeenCalledWith('companies')
    expect(deleteCompany).toHaveBeenCalledOnce()
    expect(eq).toHaveBeenCalledWith('id', 'company-acme')
    expect(signal.aborted).toBe(false)

    const timeoutResult = expect(removal).rejects.toThrow(REMOVE_COMPANY_TIMEOUT_MESSAGE)
    await vi.advanceTimersByTimeAsync(REMOVE_COMPANY_TIMEOUT_MS)

    await timeoutResult
    expect(signal.aborted).toBe(true)
  })

  it('allows a fresh retry after timeout without reporting a late false success', async () => {
    let finishFirst!: (value: { error: unknown }) => void
    const firstRequest = new Promise<{ error: unknown }>((resolve) => {
      finishFirst = resolve
    })
    const secondRequest = Promise.resolve({ error: null })
    const abortSignals: AbortSignal[] = []
    let attempt = 0
    vi.mocked(supabase.from).mockImplementation((() => ({
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          abortSignal: vi.fn((signal: AbortSignal) => {
            abortSignals.push(signal)
            attempt += 1
            return attempt === 1 ? firstRequest : secondRequest
          }),
        }),
      }),
    })) as never)
    const lateSuccess = vi.fn()
    const timeoutFailure = vi.fn()

    const firstRemoval = removeCompany('company-acme')
    void firstRemoval.then(lateSuccess, timeoutFailure)
    const timeoutResult = expect(firstRemoval).rejects.toThrow(REMOVE_COMPANY_TIMEOUT_MESSAGE)
    await vi.advanceTimersByTimeAsync(REMOVE_COMPANY_TIMEOUT_MS)
    await timeoutResult

    await expect(removeCompany('company-acme')).resolves.toBeUndefined()
    finishFirst({ error: null })
    await Promise.resolve()

    expect(abortSignals).toHaveLength(2)
    expect(abortSignals[0].aborted).toBe(true)
    expect(abortSignals[1].aborted).toBe(false)
    expect(timeoutFailure).toHaveBeenCalledOnce()
    expect(lateSuccess).not.toHaveBeenCalled()
  })
})

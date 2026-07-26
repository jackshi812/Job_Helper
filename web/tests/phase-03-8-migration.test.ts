import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(fileURLToPath(new URL(
  '../../supabase/migrations/0040_phase_03_8_branded_connectors.sql',
  import.meta.url,
)), 'utf8')

const candidates = [
  {
    companyName: 'Morgan Stanley',
    provider: 'eightfold',
    sourceKey: 'eightfold:morganstanley',
    publicUrl: 'https://www.morganstanley.com/careers/career-opportunities-search/',
  },
  {
    companyName: 'JPMorgan Chase',
    provider: 'oracle_recruiting',
    sourceKey: 'oracle:jpmc:CX_1001',
    publicUrl:
      'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/requisitions',
  },
  {
    companyName: 'Goldman Sachs',
    provider: 'goldman_higher',
    sourceKey: 'goldman_higher:roles',
    publicUrl: 'https://higher.gs.com/roles',
  },
]

const negativeReasons = new Map([
  ['Bank of America', 'primary_portal_html_only_no_structured_machine_contract'],
  ['Citi', 'radancy_results_require_html_parsing'],
  ['BlackRock', 'radancy_results_require_html_parsing'],
  ['Wells Fargo', 'primary_portal_managed_challenge_no_bypass'],
  ['UBS', 'structured_endpoint_requires_html_bootstrap_session'],
  ['Barclays', 'radancy_results_require_html_parsing'],
  ['Charles Schwab', 'radancy_results_require_html_parsing'],
])

const protectedSourceKeys = [
  'workday:wd12:capitalone:Capital_One',
  'workday:wd1:fmr:FidelityCareers',
] as const

type ProtectedWorkdayRow = {
  id: string
  name: string
  source_key: string
  activation_state: string
}

const protectedBefore: ProtectedWorkdayRow[] = [
  {
    id: 'capital-one',
    name: 'Capital One',
    source_key: protectedSourceKeys[0],
    activation_state: 'active',
  },
  {
    id: 'fidelity',
    name: 'Fidelity',
    source_key: protectedSourceKeys[1],
    activation_state: 'active',
  },
]

function protectedParityWouldFail(
  migrationSql: string,
  beforeRows: ProtectedWorkdayRow[],
  productionRows: ProtectedWorkdayRow[],
) {
  const scopesAfterSide = /full join\s*\(\s*select[\s\S]*?from public\.companies[\s\S]*?where source_key in\s*\([\s\S]*?workday:wd12:capitalone:Capital_One[\s\S]*?workday:wd1:fmr:FidelityCareers[\s\S]*?\)\s*\)\s*as after_row using \(id\)/i
    .test(migrationSql)
  const afterRows = scopesAfterSide
    ? productionRows.filter((row) => protectedSourceKeys.includes(
        row.source_key as typeof protectedSourceKeys[number],
      ))
    : productionRows
  const beforeById = new Map(beforeRows.map((row) => [row.id, row]))
  const afterById = new Map(afterRows.map((row) => [row.id, row]))
  const ids = new Set([...beforeById.keys(), ...afterById.keys()])

  return beforeRows.length !== protectedSourceKeys.length || [...ids].some((id) => {
    const beforeRow = beforeById.get(id)
    const afterRow = afterById.get(id)
    return beforeRow === undefined
      || afterRow === undefined
      || beforeRow.name !== afterRow.name
      || beforeRow.source_key !== afterRow.source_key
      || beforeRow.activation_state !== afterRow.activation_state
  })
}

describe('migration 0040 exact catalog and identity parity', () => {
  it('contains exactly the three frozen candidate tuples and leaves them pending proof', () => {
    expect(candidates).toEqual([
      {
        companyName: 'Morgan Stanley',
        provider: 'eightfold',
        sourceKey: 'eightfold:morganstanley',
        publicUrl: 'https://www.morganstanley.com/careers/career-opportunities-search/',
      },
      {
        companyName: 'JPMorgan Chase',
        provider: 'oracle_recruiting',
        sourceKey: 'oracle:jpmc:CX_1001',
        publicUrl:
          'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/requisitions',
      },
      {
        companyName: 'Goldman Sachs',
        provider: 'goldman_higher',
        sourceKey: 'goldman_higher:roles',
        publicUrl: 'https://higher.gs.com/roles',
      },
    ])
    for (const candidate of candidates) {
      expect(sql).toContain(`'${candidate.companyName}'`)
      expect(sql).toContain(`'${candidate.sourceKey}'`)
      expect(sql).toContain(`'${candidate.publicUrl}'`)
    }
    expect(sql.match(/'pending_current_live_contract_proof', null/g)).toHaveLength(3)
    expect(sql).toMatch(/migration application must not pre-admit branded candidates/i)
  })

  it('pins all seven terminal negative reasons with no operational source authority', () => {
    for (const [companyName, reason] of negativeReasons) {
      const row = new RegExp(
        `'${companyName}'[\\s\\S]{0,700}'unsupported_with_reason'[\\s\\S]{0,100}'${reason}', null`,
      )
      expect(sql).toMatch(row)
    }
  })

  it('binds every branded scope object to its row source and external id digest', () => {
    expect(sql).toMatch(
      /create extension if not exists pgcrypto with schema extensions/i,
    )
    expect(sql).toMatch(
      /scope_evidence\s*-\s*array\[[\s\S]*'externalIdDigest'[\s\S]*\]\s*=\s*'\{\}'::jsonb/i,
    )
    expect(sql).toMatch(/scope_evidence\s*->>\s*'detailCountryCode'\s*=\s*'US'/i)
    expect(sql).toMatch(
      /scope_evidence\s*->>\s*'sourceKey'\s*=\s*case\s+source/i,
    )
    expect(sql).toMatch(
      /scope_evidence\s*->>\s*'externalIdDigest'\s*=\s*pg_catalog\.encode\(\s*extensions\.digest\(/i,
    )
    expect(sql).toMatch(/external_id/i)
    expect(sql).not.toMatch(
      /scope_evidence\s*->>\s*'(?:credential|cookie|payload)'/i,
    )
  })

  it('preserves protected Workday rows, RLS, grants, and forward-only schema history', () => {
    expect(sql).toContain('phase_03_8_protected_workday_before')
    expect(sql).toContain("'workday:wd12:capitalone:Capital_One'")
    expect(sql).toContain("'workday:wd1:fmr:FidelityCareers'")
    expect(sql).toMatch(/Capital One\/Fidelity protected identity parity failed/)
    expect(sql).toMatch(/enable row level security/i)
    expect(sql).not.toMatch(/\bdrop table\b/i)
    expect(sql).not.toMatch(/\btruncate\b/i)
    const verifierAuthority = sql.indexOf(
      'create table public.phase_03_8_verifier_runs',
    )
    expect(verifierAuthority).toBeGreaterThan(0)
    expect(sql.slice(0, verifierAuthority)).not.toMatch(
      /\bdelete from public\.jobs\b/i,
    )
  })

  it('scopes protected parity to Capital One and Fidelity without weakening drift detection', () => {
    const unrelatedProductionCompany: ProtectedWorkdayRow = {
      id: 'unrelated-greenhouse-company',
      name: 'Unrelated Production Company',
      source_key: 'greenhouse:unrelated-production-company',
      activation_state: 'active',
    }
    const productionRoster = [...protectedBefore, unrelatedProductionCompany]

    expect(protectedParityWouldFail(sql, protectedBefore, productionRoster)).toBe(false)
    expect(protectedParityWouldFail(
      sql,
      protectedBefore,
      productionRoster.filter((row) => row.id !== 'capital-one'),
    )).toBe(true)
    expect(protectedParityWouldFail(sql, protectedBefore, productionRoster.map((row) => (
      row.id === 'fidelity' ? { ...row, name: 'Fidelity drifted' } : row
    )))).toBe(true)
    expect(protectedParityWouldFail(sql, protectedBefore.slice(1), productionRoster)).toBe(true)
  })
})

describe('migration 0040 one-use hosted verifier authority', () => {
  const releaseManifestId = '03850000-0000-4000-8000-000000000005'
  const runId = '03850000-0000-4000-8000-000000000501'
  const fixtureKeys = [
    'eightfold_fixture',
    'oracle_fixture',
    'goldman_fixture',
  ]
  const faultValues = [
    'incomplete_observation',
    'provider_schema_error',
    'provider_timeout',
    'clean_recovery',
  ]

  it('seeds one immutable armed run and literal fixture identity inventory', () => {
    expect(sql).toContain('create table public.phase_03_8_verifier_runs')
    expect(sql).toContain('create table public.phase_03_8_verifier_fixtures')
    expect(sql).toContain(`'${releaseManifestId}'::uuid`)
    expect(sql).toContain(`'${runId}'::uuid`)
    expect(sql).toMatch(/state\s+text\s+not null[\s\S]*'armed'[\s\S]*'running'[\s\S]*'consumed'/i)
    expect(sql).toMatch(/max_exercise_calls[\s\S]*default 12[\s\S]*check[\s\S]*=\s*12/i)
    expect(sql).toMatch(/interval '20 minutes'/i)
    for (const fixture of fixtureKeys) expect(sql).toContain(`'${fixture}'`)
    expect(sql).toMatch(/03850000-0000-4000-8000-00000000051[1-3]/)
    expect(sql).toMatch(/03850000-0000-4000-8000-00000000052[1-3]/)
    expect(sql).toMatch(/03850000-0000-4000-8000-00000000053[1-3]/)
  })

  it('exposes only fixed-enum, expected-version lifecycle fault inputs', () => {
    const exerciseSignature = sql.match(
      /create or replace function public\.exercise_phase_03_8_verifier_fault\(([\s\S]*?)\)\s*returns/i,
    )?.[1] ?? ''
    expect(exerciseSignature).toMatch(/p_run_id uuid/i)
    expect(exerciseSignature).toMatch(/p_fixture text/i)
    expect(exerciseSignature).toMatch(/p_fault text/i)
    expect(exerciseSignature).toMatch(/p_expected_version integer/i)
    expect(exerciseSignature).not.toMatch(
      /company|job|url|host|path|provider|source|network|destination/i,
    )
    for (const fault of faultValues) expect(sql).toContain(`'${fault}'`)
    expect(sql).toMatch(/exercise_calls\s*<\s*max_exercise_calls/i)
    expect(sql).toMatch(/expires_at\s*>\s*clock_timestamp\(\)/i)
    expect(sql).toMatch(/fixture_version\s*=\s*fixture_version\s*\+\s*1/i)
    expect(sql).toMatch(/where[\s\S]*fixture_version\s*=\s*p_expected_version/i)
  })

  it('keeps every injected fault on an owned open job and restores healthy state', () => {
    expect(sql).toMatch(/status\s*=\s*'open'/i)
    expect(sql).toMatch(/consecutive_failures\s*=\s*[\s\S]*\+\s*1/i)
    expect(sql).toMatch(/last_error_code\s*=\s*p_fault/i)
    expect(sql).toMatch(/if p_fault = 'clean_recovery'/i)
    expect(sql).toMatch(/last_success_at\s*=\s*clock_timestamp\(\)/i)
    expect(sql).toMatch(/consecutive_failures\s*=\s*0/i)
    expect(sql).toMatch(/last_error_code\s*=\s*null/i)
    expect(sql).not.toMatch(
      /exercise_phase_03_8_verifier_fault\([^)]*(?:url|host|provider|source|company_id|job_id)/i,
    )
  })

  it('CAS-cleans exact owned rows, consumes the latch, and revokes itself', () => {
    expect(sql).toMatch(
      /create or replace function public\.finish_phase_03_8_verifier_run\([\s\S]*p_eightfold_expected_version[\s\S]*p_oracle_expected_version[\s\S]*p_goldman_expected_version/i,
    )
    expect(sql).toMatch(
      /delete from public\.jobs[\s\S]*using public\.phase_03_8_verifier_fixtures/i,
    )
    expect(sql).toMatch(/delete from public\.phase_03_8_verifier_fixtures/i)
    expect(sql).toMatch(/delete from public\.companies/i)
    expect(sql).toMatch(/state\s*=\s*'consumed'/i)
    expect(sql).toMatch(/delete from public\.phase_03_8_verifier_runs/i)
    for (const routine of [
      'begin_phase_03_8_verifier_run',
      'exercise_phase_03_8_verifier_fault',
      'finish_phase_03_8_verifier_run',
    ]) {
      expect(sql).toMatch(new RegExp(
        `revoke execute on function public\\.${routine}[\\s\\S]*from public, anon, authenticated`,
        'i',
      ))
      expect(sql).toMatch(new RegExp(
        `grant execute on function public\\.${routine}[\\s\\S]*to service_role`,
        'i',
      ))
      expect(sql).toMatch(new RegExp(
        `revoke execute on function public\\.${routine}[\\s\\S]*from service_role`,
        'i',
      ))
    }
  })

  it('has no reset, rearm, caller-selected insert, or real-row cleanup authority', () => {
    expect(sql).not.toMatch(/\breset_phase_03_8_verifier\b/i)
    expect(sql).not.toMatch(/\brearm_phase_03_8_verifier\b/i)
    expect(sql).toMatch(
      /insert into public\.phase_03_8_verifier_runs[\s\S]{0,500}\bvalues\b/i,
    )
    expect(sql).toMatch(/begin_phase_03_8_verifier_run[\s\S]*state\s*=\s*'armed'/i)
    expect(sql).toMatch(/phase_03_8_verifier_fixtures[\s\S]*foreign key/i)
    expect(sql).toMatch(/security definer[\s\S]*set search_path = ''/i)
  })
})

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BRANDED_IDENTITIES,
} from '../../supabase/functions/_shared/branded-identities'

const sql = readFileSync(fileURLToPath(new URL(
  '../../supabase/migrations/0040_phase_03_8_branded_connectors.sql',
  import.meta.url,
)), 'utf8')

const candidates = Object.values(BRANDED_IDENTITIES).map((identity) => ({
  companyName: identity.companyName,
  provider: identity.provider,
  sourceKey: identity.sourceKey,
  publicUrl: identity.publicUrl,
}))

const negativeReasons = new Map([
  ['Bank of America', 'primary_portal_html_only_no_structured_machine_contract'],
  ['Citi', 'radancy_results_require_html_parsing'],
  ['BlackRock', 'radancy_results_require_html_parsing'],
  ['Wells Fargo', 'primary_portal_managed_challenge_no_bypass'],
  ['UBS', 'structured_endpoint_requires_html_bootstrap_session'],
  ['Barclays', 'radancy_results_require_html_parsing'],
  ['Charles Schwab', 'radancy_results_require_html_parsing'],
])

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
      /scope_evidence\s*-\s*array\[[\s\S]*'externalIdDigest'[\s\S]*\]\s*=\s*'\{\}'::jsonb/i,
    )
    expect(sql).toMatch(/scope_evidence\s*->>\s*'detailCountryCode'\s*=\s*'US'/i)
    expect(sql).toMatch(
      /scope_evidence\s*->>\s*'sourceKey'\s*=\s*case\s+source/i,
    )
    expect(sql).toMatch(
      /scope_evidence\s*->>\s*'externalIdDigest'\s*=\s*encode\(\s*digest\(/i,
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
    expect(sql).not.toMatch(/\bdelete from public\.jobs\b/i)
  })
})

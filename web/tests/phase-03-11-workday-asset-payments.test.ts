import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  resolveWorkdayIdentity,
  UNITED_STATES_WORKDAY_FACET_ID,
  WORKDAY_IDENTITIES,
  type WorkdayIdentity,
} from '../../supabase/functions/_shared/workday-identities'

const migration0043Path = fileURLToPath(new URL(
  '../../supabase/migrations/0043_phase_03_8_workday_candidates.sql',
  import.meta.url,
))
const migration0062Path = fileURLToPath(new URL(
  '../../supabase/migrations/0062_phase_03_11_asset_manager_payments_workday.sql',
  import.meta.url,
))
const migration0043 = readFileSync(migration0043Path, 'utf8')
const migration0062 = readFileSync(migration0062Path, 'utf8')

/**
 * Every tuple below was verified against the live CXS list endpoint and against
 * one live detail response. `countryFacet` records whether the board publishes a
 * country facet at all: Visa and PIMCO nest one under `locationMainGroup`, while
 * T. Rowe Price and Invesco expose only a flat city list.
 */
const candidates = [
  {
    company: 'Visa',
    tenant: 'visa',
    region: 'wd5',
    site: 'Visa',
    sourceKey: 'workday:wd5:visa:Visa',
    publicUrl: 'https://visa.wd5.myworkdayjobs.com/Visa',
    countryFacet: true,
    selective: true,
  },
  {
    company: 'PIMCO',
    tenant: 'pimco',
    region: 'wd1',
    site: 'pimco-careers',
    sourceKey: 'workday:wd1:pimco:pimco-careers',
    publicUrl: 'https://pimco.wd1.myworkdayjobs.com/pimco-careers',
    countryFacet: true,
    selective: true,
  },
  {
    company: 'T. Rowe Price',
    tenant: 'troweprice',
    region: 'wd5',
    site: 'TRowePrice',
    sourceKey: 'workday:wd5:troweprice:TRowePrice',
    publicUrl: 'https://troweprice.wd5.myworkdayjobs.com/TRowePrice',
    countryFacet: false,
    selective: true,
  },
  {
    company: 'Invesco',
    tenant: 'invesco',
    region: 'wd1',
    site: 'IVZ',
    sourceKey: 'workday:wd1:invesco:IVZ',
    publicUrl: 'https://invesco.wd1.myworkdayjobs.com/IVZ',
    countryFacet: false,
    selective: true,
  },
] as const

const deployedKeys = [
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
] as const

function rebuiltFunction(name: string): string {
  return migration0062.match(
    new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\n\\$\\$;`, 'i'),
  )?.[0] ?? ''
}

describe('Phase 03.11 asset manager and payments Workday identities', () => {
  it('admits exactly four new frozen identities and leaves the ten deployed ones intact', () => {
    expect(Object.keys(WORKDAY_IDENTITIES)).toHaveLength(14)
    expect(Object.isFrozen(WORKDAY_IDENTITIES)).toBe(true)
    for (const key of deployedKeys) {
      expect(WORKDAY_IDENTITIES[key as keyof typeof WORKDAY_IDENTITIES]).toBeDefined()
    }
    expect(WORKDAY_IDENTITIES['workday:wd12:capitalone:Capital_One'])
      .toMatchObject({
        cxsRoot:
          'https://capitalone.wd12.myworkdayjobs.com/wday/cxs/capitalone/Capital_One',
        keptFacetIds: {
          Analysis: 'a12c70bf789e105802e9caf800542991',
          Finance: 'a12c70bf789e105802e9de2c3b5f29a3',
        },
      })
  })

  it('resolves each new tuple only on an exact four-field match', () => {
    for (const candidate of candidates) {
      const identity = resolveWorkdayIdentity(
        candidate.tenant,
        candidate.region,
        candidate.site,
        'jobs',
      )
      expect(identity).toMatchObject({
        companyName: candidate.company,
        tenant: candidate.tenant,
        region: candidate.region,
        site: candidate.site,
        sourceKey: candidate.sourceKey,
        publicBoard: candidate.publicUrl,
        hostForm: 'jobs',
        applyCapitalOneEligibility: false,
      })
      expect(Object.isFrozen(identity)).toBe(true)
      expect(identity?.cxsRoot).toBe(
        `https://${candidate.tenant}.${candidate.region}.myworkdayjobs.com`
        + `/wday/cxs/${candidate.tenant}/${candidate.site}`,
      )
      expect(resolveWorkdayIdentity(
        candidate.tenant,
        candidate.region,
        candidate.site,
        'site',
      )).toBeNull()
      expect(resolveWorkdayIdentity(
        candidate.tenant,
        candidate.region,
        `${candidate.site}X`,
        'jobs',
      )).toBeNull()
    }
  })

  it('carries a country contract matched to what each board actually publishes', () => {
    for (const candidate of candidates) {
      const identity =
        WORKDAY_IDENTITIES[candidate.sourceKey] as WorkdayIdentity
      if (candidate.countryFacet) {
        expect(identity.countryScope).toMatchObject({
          descriptor: 'United States of America',
          id: UNITED_STATES_WORKDAY_FACET_ID,
          facetParameter: 'locationCountry',
        })
        expect(identity.countryScope?.route)
          .toEqual(['locationMainGroup', 'locationCountry'])
        expect(Object.isFrozen(identity.countryScope?.route)).toBe(true)
      } else {
        // No country facet exists on these boards, so none may be fabricated.
        expect(identity.countryScope).toBeUndefined()
        expect(identity.selectiveRecentUsScope).toBeDefined()
      }
      expect(identity.wholeSiteUsScope).toBeUndefined()
      expect(identity.unsupportedCountryContract).toBeUndefined()
      // Every candidate needs a selective scope. It is what admits the identity
      // to the experimental observation path at all, and its 199-detail ceiling
      // is what keeps hydration from tripping the adapter's 60-detail default
      // and reporting a permanently partial, never-credible observation.
      expect(candidate.selective).toBe(true)
      expect(identity.selectiveRecentUsScope).toMatchObject({
        recentDays: 7,
        maxPages: 100,
        maxListings: 2_000,
        maxDetails: 199,
      })
      // Facet scoping alone is not trusted where a country facet exists: every
      // retained row must also prove the United States in its detail.
      expect(identity.requireDetailCountryProof)
        .toBe(candidate.countryFacet ? true : undefined)
    }
  })
})

describe('migration 0062 Phase 03.11 Workday candidate admission', () => {
  it('is one forward transaction that leaves deployed migration 0043 untouched', () => {
    expect(createHash('sha256').update(migration0043).digest('hex'))
      .toBe('bdcf0ec8d22bea99fef367f48fdc0d1ec56a5c74181b954c75807391091cb246')
    expect(migration0062.trimStart()).toMatch(/^begin;/i)
    expect(migration0062.trimEnd()).toMatch(/commit;$/i)
    expect(migration0062).not.toMatch(/\bdrop table\b|\btruncate\b/i)
    expect(migration0062).not.toMatch(/delete from public\.jobs\b/i)
    // The only company deletion is the inherited Unsupported terminalization
    // path, which is confined to the RPC and to experimental rows.
    const finalize = rebuiltFunction('finalize_workday_connector_candidate')
    const outsideFinalize = migration0062.replace(finalize, '')
    expect(outsideFinalize).not.toMatch(/delete from public\.companies\b/i)
    expect(finalize).toMatch(
      /delete from public\.companies as company[\s\S]{0,200}activation_state = 'experimental'/i,
    )
  })

  it('extends the identity allowlist without disturbing the ten deployed tuples', () => {
    const constraint = migration0062.match(
      /add constraint companies_workday_identity_check[\s\S]*?\n  \);/i,
    )?.[0] ?? ''
    expect(constraint).not.toBe('')
    for (const key of deployedKeys) expect(constraint).toContain(`'${key}'`)
    for (const candidate of candidates) {
      expect(constraint).toContain(`name = '${candidate.company}'`)
      expect(constraint).toContain(`'${candidate.sourceKey}'`)
      expect(constraint).toContain(`'${candidate.publicUrl}'`)
      expect(constraint).toContain(`board_token = '${candidate.tenant}'`)
      expect(constraint).toContain(`site_token = '${candidate.site}'`)
    }
    // The disjunction stays wrapped in `is true` so a NULL column can never
    // satisfy the check.
    expect(constraint).toMatch(/\) is true\n {2}\);$/)
  })

  it('admits the new keys into terminal evidence and every claim allowlist', () => {
    const terminalCheck = migration0062.match(
      /add constraint workday_terminal_source_check[\s\S]*?\n  \);/i,
    )?.[0] ?? ''
    const surfaces = [
      terminalCheck,
      rebuiltFunction('finalize_workday_connector_candidate'),
      rebuiltFunction('record_connector_observation'),
      rebuiltFunction('claim_due_experimental_connectors'),
      rebuiltFunction('claim_due_companies'),
    ]
    for (const surface of surfaces) {
      expect(surface).not.toBe('')
      for (const candidate of candidates) {
        expect(surface).toContain(`'${candidate.sourceKey}'`)
      }
      // The four 0043 candidates keep their authority in every rebuilt surface.
      expect(surface).toContain("'workday:wd5:ms:External'")
      expect(surface).toContain("'workday:wd3:barclays:External_Career_Site_Barclays'")
    }
    const activeClaim = rebuiltFunction('claim_due_companies')
    for (const key of deployedKeys) expect(activeClaim).toContain(`'${key}'`)
    const finalize = rebuiltFunction('finalize_workday_connector_candidate')
    expect(finalize).toMatch(/security definer[\s\S]*set search_path = ''/i)
    expect(finalize).toMatch(/pg_advisory_xact_lock/i)
    expect(finalize).toMatch(/replayed_evidence/i)
    expect(finalize).toContain("'unknown_exact_source'")
    for (const candidate of candidates) {
      expect(finalize).toContain(`v_company_name := '${candidate.company}';`)
    }
  })

  it('catalogs the four candidates as pending and pre-admits nothing', () => {
    for (const candidate of candidates) {
      expect(migration0062).toContain(`'${candidate.company}',`)
    }
    expect(migration0062.match(/'pending_current_live_contract_proof'/g)?.length)
      .toBeGreaterThanOrEqual(4)
    expect(migration0062).toMatch(
      /migration application must not pre-admit Workday candidates/i,
    )
    expect(migration0062).toMatch(/Phase 03\.11 candidate catalog parity failed/i)
    expect(migration0062).toMatch(/Capital One\/Fidelity Active parity failed/i)
  })

  it('keeps every RPC service-role only', () => {
    for (const fn of [
      'finalize_workday_connector_candidate',
      'record_connector_observation',
      'claim_due_experimental_connectors',
      'claim_due_companies',
    ]) {
      expect(migration0062).toMatch(
        new RegExp(
          `revoke execute on function public\\.${fn}[\\s\\S]*?from public, anon, authenticated`,
          'i',
        ),
      )
      expect(migration0062).toMatch(
        new RegExp(
          `grant execute on function public\\.${fn}[\\s\\S]*?to service_role`,
          'i',
        ),
      )
    }
  })
})

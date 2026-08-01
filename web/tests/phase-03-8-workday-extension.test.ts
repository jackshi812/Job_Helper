import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  WORKDAY_IDENTITIES,
} from '../../supabase/functions/_shared/workday-identities'

const migration0042Path = fileURLToPath(new URL(
  '../../supabase/migrations/0042_phase_03_8_verifier_finish_fk_order.sql',
  import.meta.url,
))
const migration0043Path = fileURLToPath(new URL(
  '../../supabase/migrations/0043_phase_03_8_workday_candidates.sql',
  import.meta.url,
))
const migration0042 = readFileSync(migration0042Path, 'utf8')
const migration0043 = readFileSync(migration0043Path, 'utf8')

const candidates = [
  {
    company: 'Morgan Stanley',
    tenant: 'ms',
    region: 'wd5',
    site: 'External',
    sourceKey: 'workday:wd5:ms:External',
    publicUrl: 'https://ms.wd5.myworkdayjobs.com/en-US/External',
  },
  {
    company: 'Bank of America',
    tenant: 'ghr',
    region: 'wd1',
    site: 'Lateral-US',
    sourceKey: 'workday:wd1:ghr:Lateral-US',
    publicUrl: 'https://ghr.wd1.myworkdayjobs.com/en-US/Lateral-US',
  },
  {
    company: 'BlackRock',
    tenant: 'blackrock',
    region: 'wd1',
    site: 'BlackRock_Professional',
    sourceKey: 'workday:wd1:blackrock:BlackRock_Professional',
    publicUrl:
      'https://blackrock.wd1.myworkdayjobs.com/en-US/BlackRock_Professional',
  },
  {
    company: 'Barclays',
    tenant: 'barclays',
    region: 'wd3',
    site: 'External_Career_Site_Barclays',
    sourceKey:
      'workday:wd3:barclays:External_Career_Site_Barclays',
    publicUrl:
      'https://barclays.wd3.myworkdayjobs.com/en-US/External_Career_Site_Barclays',
  },
] as const

const protectedKeys = [
  'workday:wd12:capitalone:Capital_One',
  'workday:wd1:fmr:FidelityCareers',
] as const

describe('migration 0043 Phase 03.8 Workday amendment', () => {
  it('keeps 0042 byte-identical and adds one forward transaction only', () => {
    expect(createHash('sha256').update(migration0042).digest('hex'))
      .toBe('132b8a1cc4360edd49f50b79a2dfee6ca3e3bf3d3d8c3974cb74fe06f8195eb5')
    expect(migration0043.trimStart()).toMatch(/^begin;/i)
    expect(migration0043.trimEnd()).toMatch(/commit;$/i)
    expect(migration0043).not.toMatch(/\bdrop table\b|\btruncate\b/i)
    expect(migration0043).not.toContain('0040_phase_03_8_branded_connectors')
    expect(migration0043).not.toContain('0041_phase_03_8_verifier_rpc_qualification')
  })

  it('keeps registry, Workday constraint, terminal, observation, and claims in exact parity', () => {
    expect(Object.keys(WORKDAY_IDENTITIES)).toHaveLength(14)
    for (const candidate of candidates) {
      expect(WORKDAY_IDENTITIES[candidate.sourceKey]).toMatchObject({
        companyName: candidate.company,
        tenant: candidate.tenant,
        region: candidate.region,
        site: candidate.site,
        sourceKey: candidate.sourceKey,
        publicBoard: candidate.publicUrl,
      })
      expect(migration0043).toContain(`'${candidate.sourceKey}'`)
      expect(migration0043).toContain(`'${candidate.publicUrl}'`)
    }
    const identityConstraint = migration0043.match(
      /add constraint companies_workday_identity_check[\s\S]*?\n  \);/i,
    )?.[0] ?? ''
    const observation = migration0043.match(
      /create or replace function public\.record_connector_observation[\s\S]*?\$\$;/i,
    )?.[0] ?? ''
    const experimentalClaim = migration0043.match(
      /create or replace function public\.claim_due_experimental_connectors[\s\S]*?\$\$;/i,
    )?.[0] ?? ''
    const activeClaim = migration0043.match(
      /create or replace function public\.claim_due_companies[\s\S]*?\$\$;/i,
    )?.[0] ?? ''
    const terminal = migration0043.match(
      /create or replace function public\.finalize_workday_connector_candidate[\s\S]*?\$\$;/i,
    )?.[0] ?? ''
    for (const candidate of candidates) {
      for (const surface of [
        identityConstraint,
        observation,
        experimentalClaim,
        activeClaim,
        terminal,
      ]) expect(surface).toContain(`'${candidate.sourceKey}'`)
    }
  })

  it('removes only Citi and Wells Fargo after exact zero-authority assertions', () => {
    expect(migration0043).toMatch(
      /if exists \([\s\S]*public\.companies[\s\S]*Citi[\s\S]*Wells Fargo[\s\S]*raise exception[\s\S]*catalog removal blocked/i,
    )
    expect(migration0043).toMatch(
      /delete from public\.source_coverage_catalog[\s\S]*company_name in \('Citi', 'Wells Fargo'\)/i,
    )
    const catalogRemovalSurface = migration0043.slice(
      0,
      migration0043.indexOf(
        'create or replace function public.finalize_workday_connector_candidate',
      ),
    )
    expect(catalogRemovalSurface).not.toMatch(
      /delete from public\.(?:companies|jobs|connector_observations|branded_connector_terminal_evidence)/i,
    )
    expect(migration0043).toMatch(
      /source_coverage_catalog[\s\S]*company_name in \('Citi', 'Wells Fargo'\)[\s\S]*raise exception[\s\S]*still present/i,
    )
  })

  it('keeps four non-candidates Unsupported and four Workday candidates pending', () => {
    for (const company of [
      'Goldman Sachs',
      'JPMorgan Chase',
      'UBS',
      'Charles Schwab',
    ]) {
      expect(migration0043).toContain(`'${company}'`)
    }
    expect(migration0043).toContain(
      "'structured_endpoint_requires_html_bootstrap_session'",
    )
    expect(migration0043).toContain("'radancy_results_require_html_parsing'")
    expect(migration0043.match(/'pending_current_live_contract_proof'/g)?.length)
      .toBeGreaterThanOrEqual(4)
    expect(migration0043).toMatch(
      /migration application must not pre-admit Workday candidates/i,
    )
  })

  it('uses service-role-only exact replay-safe terminalization and bounded reasons', () => {
    const terminal = migration0043.match(
      /create or replace function public\.finalize_workday_connector_candidate[\s\S]*?\$\$;/i,
    )?.[0] ?? ''
    expect(terminal).toMatch(/security definer[\s\S]*set search_path = ''/i)
    expect(terminal).toMatch(/pg_advisory_xact_lock/i)
    expect(terminal).toMatch(/replayed_evidence/i)
    expect(terminal).toMatch(/already_active|disabled_source/i)
    for (const reason of [
      'country_filter_unverified',
      'whole_site_us_scope_unproven',
      'foreign_detail_detected',
      'detail_scope_incomplete',
      'pagination_incomplete',
      'count_mismatch',
      'provider_timeout',
      'provider_schema_error',
    ]) expect(terminal).toContain(`'${reason}'`)
    expect(migration0043).toMatch(
      /revoke execute on function public\.finalize_workday_connector_candidate[\s\S]*from public, anon, authenticated/i,
    )
    expect(migration0043).toMatch(
      /grant execute on function public\.finalize_workday_connector_candidate[\s\S]*to service_role/i,
    )
  })

  it('preserves Capital One and Fidelity exact rows and active claim membership', () => {
    for (const key of protectedKeys) {
      expect(migration0043).toContain(`'${key}'`)
    }
    expect(migration0043).toContain('phase_03_8_protected_workday_0043_before')
    expect(migration0043).toMatch(
      /Capital One\/Fidelity protected identity parity failed/i,
    )
    expect(migration0043).toMatch(/Capital One\/Fidelity Active parity failed/i)
  })
})

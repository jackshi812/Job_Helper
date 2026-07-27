import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(fileURLToPath(new URL(
  '../../supabase/migrations/0045_phase_03_9_jpmorgan_oracle.sql',
  import.meta.url,
)), 'utf8')
const catalogRepairSql = readFileSync(fileURLToPath(new URL(
  '../../supabase/migrations/0046_phase_03_9_jpmorgan_catalog_repair.sql',
  import.meta.url,
)), 'utf8')

const exactSource = 'oracle:jpmc:CX_1001'
const protectedWorkdaySources = [
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
]

describe('Phase 03.9 forward-only JPMorgan Oracle migration', () => {
  it('updates only the exact canonical catalog identity', () => {
    expect(sql).toContain(
      'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs',
    )
    expect(sql).toMatch(/where company_name = 'JPMorgan Chase'[\s\S]*provider = 'Oracle Recruiting'/)
    expect(sql).not.toMatch(/update public\.source_coverage_catalog[\s\S]{0,300}company_name = 'Goldman Sachs'/)
  })

  it('admits exactly the six normalized JPMorgan family/term pairs', () => {
    for (const pair of [
      "('finance', 'Finance')",
      "('data analytics', 'Data')",
      "('risk', 'Risk')",
      "('product investment mgmt', 'Investment')",
      "('strategy development', 'Strategy')",
      "('program analysts associate', 'Program Analysts')",
    ]) expect(sql).toContain(pair)
    expect(sql).toMatch(/source = 'oracle_recruiting'[\s\S]*oracle:jpmc:CX_1001/)
    expect(sql).toMatch(/source in \('eightfold', 'goldman_higher'\)[\s\S]*'Capital Markets'/)
  })

  it('creates a replay-safe JPMorgan-only service-role terminal boundary', () => {
    expect(sql).toContain('finalize_jpmorgan_oracle_candidate')
    expect(sql).toContain(`p_source_key <> '${exactSource}'`)
    expect(sql).toContain('replayed_evidence')
    expect(sql).toContain('disabled_source')
    expect(sql).toContain('admit_experimental')
    expect(sql).toContain('unsupported')
    expect(sql).toMatch(/revoke execute on function public\.finalize_jpmorgan_oracle_candidate[\s\S]*from public, anon, authenticated/)
    expect(sql).toMatch(/grant execute on function public\.finalize_jpmorgan_oracle_candidate[\s\S]*to service_role/)
    expect(sql).not.toMatch(/grant execute on function public\.finalize_branded_connector_candidate/)
  })

  it('preserves Workday claims and adds only exact JPMorgan Oracle authority', () => {
    for (const source of protectedWorkdaySources) expect(sql).toContain(source)
    expect(sql.match(new RegExp(exactSource.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))?.length)
      .toBeGreaterThanOrEqual(5)
    expect(sql).not.toMatch(/ats_type = 'eightfold'[\s\S]{0,100}claim_due/)
    expect(sql).not.toMatch(/ats_type = 'goldman_higher'[\s\S]{0,100}claim_due/)
  })

  it('retains locks, replay windows, caps, stagger, and service-role RPC ACLs', () => {
    expect(sql).toContain("set local lock_timeout = '500ms'")
    expect(sql).toContain('for update')
    expect(sql).toContain('for update skip locked')
    expect(sql).toContain("'same_window'")
    expect(sql).toContain('if v_progress > 3')
    expect(sql).toContain("interval '1 minute'")
    expect(sql).toContain("interval '10 minutes'")
    for (const fn of [
      'record_connector_observation',
      'claim_due_experimental_connectors',
      'claim_due_companies',
    ]) {
      expect(sql).toContain(`grant execute on function public.${fn}`)
      expect(sql).toMatch(new RegExp(
        `revoke execute on function public\\.${fn}[\\s\\S]*?from public, anon, authenticated`,
      ))
    }
  })

  it('does not mutate deployed migrations 0040 through 0044', () => {
    expect(sql).not.toMatch(/\b(drop|alter|update|delete|insert into)\s+supabase_migrations\./i)
    expect(sql.trimStart().startsWith('begin;')).toBe(true)
    expect(sql.trimEnd().endsWith('commit;')).toBe(true)
  })
})

describe('Phase 03.9 JPMorgan catalog forward repair', () => {
  it('updates only the exact preserved Oracle Recruiting Cloud row', () => {
    expect(catalogRepairSql).toContain(
      "provider = 'Oracle Recruiting Cloud'",
    )
    expect(catalogRepairSql).toContain(
      "unsupported_reason = 'pending_current_live_contract_proof'",
    )
    expect(catalogRepairSql).toContain('/sites/CX_1001/requisitions')
    expect(catalogRepairSql).toContain('/sites/CX_1001/jobs')
    expect(catalogRepairSql).toMatch(
      /select count\(\*\)[\s\S]+<> 1[\s\S]+exact pre-repair JPMorgan catalog row missing/,
    )
  })

  it('fails closed after any JPMorgan operational admission', () => {
    expect(catalogRepairSql).toMatch(
      /from public\.companies[\s\S]+source_key = 'oracle:jpmc:CX_1001'/,
    )
    expect(catalogRepairSql).toMatch(
      /from public\.branded_connector_terminal_evidence[\s\S]+outcome = 'admit_experimental'/,
    )
    expect(catalogRepairSql).not.toMatch(
      /delete from public\.(companies|jobs|connector_observations)/,
    )
  })
})

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migrationPath = fileURLToPath(new URL(
  '../../supabase/migrations/0069_phase_06_wave_1.sql',
  import.meta.url,
))
const migration = readFileSync(migrationPath, 'utf8')
const rlsProbe = readFileSync(fileURLToPath(new URL(
  '../../scripts/verify-rls.ts',
  import.meta.url,
)), 'utf8')

const targets = [
  ['BMO', 'bmo', 'wd3', 'External', 'workday:wd3:bmo:External'],
  ['PIMCO', 'pimco', 'wd1', 'pimco-careers', 'workday:wd1:pimco:pimco-careers'],
  ['Visa', 'visa', 'wd5', 'Visa', 'workday:wd5:visa:Visa'],
  ['Apollo Global Management', 'athene', 'wd5', 'Apollo_Careers', 'workday:wd5:athene:Apollo_Careers'],
  ['Invesco', 'invesco', 'wd1', 'IVZ', 'workday:wd1:invesco:IVZ'],
  ['Mastercard', 'mastercard', 'wd1', 'CorporateCareers', 'workday:wd1:mastercard:CorporateCareers'],
  ['Northern Trust', 'ntrs', 'wd1', 'northerntrust', 'workday:wd1:ntrs:northerntrust'],
  ['Vanguard', 'vanguard', 'wd5', 'vanguard_external', 'workday:wd5:vanguard:vanguard_external'],
  ['Workday', 'workday', 'wd5', 'Workday', 'workday:wd5:workday:Workday'],
  ['NVIDIA', 'nvidia', 'wd5', 'NVIDIAExternalCareerSite', 'workday:wd5:nvidia:NVIDIAExternalCareerSite'],
] as const

function rebuiltFunction(name: string): string {
  return migration.match(
    new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\n\\$\\$;`, 'i'),
  )?.[0] ?? ''
}

describe('migration 0069 Phase 06 Wave 1 authority', () => {
  it('is one forward transaction with no destructive or direct Active admission path', () => {
    expect(migration.trimStart()).toMatch(/^begin;/i)
    expect(migration.trimEnd()).toMatch(/commit;$/i)
    expect(migration).not.toMatch(/\bdrop table\b|\btruncate\b/i)
    expect(migration).not.toMatch(/delete from public\.jobs\b/i)
    expect(migration).not.toMatch(
      /insert into public\.companies[\s\S]{0,1200}'active'/i,
    )
    expect(migration).toMatch(
      /migration application must not find pre-existing Wave 1 companies/i,
    )
  })

  it('adds durable ownership with authenticated protected-delete denial and a user control', () => {
    expect(migration).toMatch(
      /add column(?: if not exists)? system_managed boolean not null default false/i,
    )
    expect(migration).toMatch(
      /drop policy if exists "companies_delete_shared" on public\.companies/i,
    )
    expect(migration).toMatch(
      /create policy "companies_delete_user_managed" on public\.companies[\s\S]*for delete to authenticated[\s\S]*using \(system_managed is false\)/i,
    )
    expect(migration).not.toMatch(
      /create policy "companies_delete_user_managed"[\s\S]*using \(true\)/i,
    )
    expect(rlsProbe).toMatch(/const clientA = createProbeClient/)
    expect(rlsProbe).toMatch(/const clientB = createProbeClient/)
  })

  it('binds all ten exact tuples across catalog, terminalization, and both claim lanes', () => {
    const surfaces = [
      migration.match(/add constraint companies_workday_identity_check[\s\S]*?\n  \);/i)?.[0] ?? '',
      migration.match(/add constraint workday_terminal_source_check[\s\S]*?\n  \);/i)?.[0] ?? '',
      rebuiltFunction('finalize_workday_connector_candidate'),
      rebuiltFunction('record_connector_observation'),
      rebuiltFunction('claim_due_experimental_connectors'),
      rebuiltFunction('claim_due_companies'),
    ]
    for (const surface of surfaces) expect(surface).not.toBe('')

    for (const [company, tenant, region, site, sourceKey] of targets) {
      expect(migration).toContain(`'${company}',`)
      expect(migration).toContain(`board_token = '${tenant}'`)
      expect(migration).toContain(`region = '${region}'`)
      expect(migration).toContain(`site_token = '${site}'`)
      for (const surface of surfaces) expect(surface).toContain(`'${sourceKey}'`)
    }
    expect(migration.match(/'pending_phase_06_wave_1_release'/g)?.length)
      .toBeGreaterThanOrEqual(10)
  })

  it('admits exactly ten Experimental managed rows through replay-safe service-role terminalization', () => {
    const finalize = rebuiltFunction('finalize_workday_connector_candidate')
    expect(finalize).toMatch(/security definer[\s\S]*set search_path = ''/i)
    expect(finalize).toMatch(/pg_advisory_xact_lock/i)
    expect(finalize).toContain("'replayed_evidence'")
    expect(finalize).toMatch(
      /insert into public\.companies[\s\S]*system_managed[\s\S]*'experimental'[\s\S]*true/i,
    )
    expect(migration.match(/finalize_workday_connector_candidate\(/g)?.length)
      .toBeGreaterThanOrEqual(11)
    expect(migration).toMatch(
      /Phase 06 Wave 1 Experimental managed admission parity failed/i,
    )
    expect(migration).toMatch(
      /count\(\*\)[\s\S]{0,500}activation_state = 'experimental'[\s\S]{0,200}system_managed is true[\s\S]{0,200}<> 10/i,
    )
  })

  it('requires three distinct complete positive warning-free observations before Active', () => {
    const observation = rebuiltFunction('record_connector_observation')
    expect(observation).toMatch(/p_completeness <> 'complete'/)
    expect(observation).toMatch(/p_credible_for_closure is not true/)
    expect(observation).toMatch(/p_job_count is null or p_job_count <= 0/)
    expect(observation).toMatch(/p_expected_count is null or p_job_count <> p_expected_count/)
    expect(observation).toMatch(/p_warning_count is null or p_warning_count <> 0/)
    expect(observation).toMatch(/eligibility_window_start = v_window_start/)
    expect(observation).toMatch(/when v_progress = 3 then 'active'/)
    expect(observation).not.toMatch(/activation_state\s*=\s*'active'/)
  })

  it('keeps all rebuilt RPCs service-role only with empty search paths', () => {
    for (const name of [
      'finalize_workday_connector_candidate',
      'record_connector_observation',
      'claim_due_experimental_connectors',
      'claim_due_companies',
    ]) {
      expect(rebuiltFunction(name)).toMatch(/set search_path = ''/i)
      expect(migration).toMatch(new RegExp(
        `revoke execute on function public\\.${name}[\\s\\S]*?from public, anon, authenticated`,
        'i',
      ))
      expect(migration).toMatch(new RegExp(
        `grant execute on function public\\.${name}[\\s\\S]*?to service_role`,
        'i',
      ))
    }
  })
})

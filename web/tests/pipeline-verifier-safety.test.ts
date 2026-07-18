import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const verifierPath = fileURLToPath(new URL('../../scripts/verify-pipeline.ts', import.meta.url))
const source = readFileSync(verifierPath, 'utf8')

describe('pipeline reopen verifier ownership contract', () => {
  it('pins probe 15 to the bounded PlanetScale Greenhouse fixture', () => {
    expect(source).toContain("const PIPELINE_REOPEN_PROBE_PREFIX = 'phase-02.1-reopen-probe-'")
    expect(source).toContain("const PIPELINE_REOPEN_BOARD_TOKEN = 'planetscale'")
    expect(source).toContain("const PIPELINE_REOPEN_SOURCE_KEY = 'greenhouse:global:planetscale'")
    expect(source).toContain('const PIPELINE_REOPEN_MAX_JOBS = 25')
    expect(source).toContain('https://boards-api.greenhouse.io/v1/boards/${PIPELINE_REOPEN_BOARD_TOKEN}/jobs')
  })

  it('never selects, closes, or force-restores a pre-existing seed job', () => {
    expect(source).not.toContain('reopenCandidate')
    expect(source).not.toContain('reopenProbeRestore')
    expect(source).not.toMatch(/\.in\('company_id', seedIds\)[\s\S]{0,240}\.eq\('status', 'open'\)[\s\S]{0,160}\.limit\(1\)/)
    expect(source).not.toMatch(/update\(\{ status: 'open', closed_at: null, last_seen_at:/)
  })

  it('requires collision preflight, deployed polling, bounded observation, and exact cleanup', () => {
    expect(source).toContain('assertReopenFixtureAvailable')
    expect(source).toContain('drainDueCompanies')
    expect(source).toContain('snapshotRealJobs')
    expect(source).toContain('assertRealJobsUnchanged')
    expect(source).toContain('await postTick(environment.url, environment.cronSecret)')
    expect(source).toMatch(/for \(let attempt = 0; attempt < PIPELINE_REOPEN_OBSERVATION_ATTEMPTS;/)
    expect(source).toMatch(/\.delete\(\)\s*\.eq\('company_id', fixture\.companyId\)/)
    expect(source).toMatch(/\.delete\(\)\s*\.eq\('id', fixture\.companyId\)/)
    expect(source).toContain('assertReopenFixtureRemoved')
  })

  it('keeps production lifecycle execution behind the active connector registry', () => {
    expect(source).not.toContain("from '../supabase/functions/_shared/lifecycle.ts'")
    expect(source).not.toContain('planCompanySync(')
    expect(source).toContain("activation_state: 'active'")
    expect(source).toContain("ats_type: 'greenhouse'")
  })
})

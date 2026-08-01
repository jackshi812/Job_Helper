import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../..', import.meta.url))
const scoringInputPath = `${root}/supabase/functions/_shared/scoring-input.ts`
const migrationPath = `${root}/supabase/migrations/0025_scoring_freshness.sql`
const budgetMigrationPath = `${root}/supabase/migrations/0027_score_budget_after_free_work.sql`
const workerPath = `${root}/supabase/functions/score-tick/index.ts`
const deterministicWorkerPath =
  `${root}/supabase/functions/_shared/deterministic-worker.ts`
const verifierPath = `${root}/scripts/verify-scoring.ts`
const notificationMigrationPath = `${root}/supabase/migrations/0024_remove_notifications.sql`
const dashboardFilterMigrationPath = `${root}/supabase/migrations/0031_dashboard_filter_refinements.sql`

function read(path: string) {
  return readFileSync(path, 'utf8')
}

function readWorkerBundle() {
  return `${read(workerPath)}\n${read(deterministicWorkerPath)}`
}

async function loadScoringInput() {
  expect(existsSync(scoringInputPath), 'scoring-input module must be implemented').toBe(true)
  if (!existsSync(scoringInputPath)) return null
  return import('../../supabase/functions/_shared/scoring-input')
}

function semanticInput() {
  return {
    preferences: {
      titles: ['Equity Research'],
      locations: ['Chicago'],
      includeKeywords: ['Valuation'],
      excludeKeywords: ['Senior'],
      titleExcludeKeywords: ['president', 'PhD'],
    },
    job: {
      title: 'Equity Research Analyst',
      location: 'Chicago, IL',
      descriptionText: 'Build valuation models.',
    },
    routedResumeId: '11111111-1111-4111-8111-111111111111',
    extraction: {
      textContent: 'Finance resume text',
      keywords: ['Valuation', 'Excel'],
      model: 'gpt-5.4-nano',
      extractedAt: '2026-07-20T00:00:00.000Z',
    },
    scoringModel: 'gpt-5.4-nano',
    promptRevision: 'score-v1',
    filterRevision: 'filter-v4',
  }
}

interface ModelRow {
  id: string
  open: boolean
  desired: number
  attempts: number
  needsRefilter: boolean
  claimedRevision: number | null
}

class MaintenanceClaimModel {
  rows = new Map<string, ModelRow>()
  latch: { runId: string; ids: [string, string]; expiresAt: number } | null = null

  add(id: string) {
    this.rows.set(id, {
      id,
      open: true,
      desired: 0,
      attempts: 0,
      needsRefilter: true,
      claimedRevision: null,
    })
  }

  begin(runId: string, first: string, second: string, expiresAt: number) {
    if (first === second || !this.rows.has(first) || !this.rows.has(second)) throw new Error('invalid fixtures')
    this.latch = { runId, ids: [first, second], expiresAt }
  }

  signal() {
    for (const row of this.rows.values()) {
      if (!row.open) continue
      row.desired += 1
      row.attempts = 0
      row.needsRefilter = true
      row.claimedRevision = null
    }
  }

  claim(runId: string | null, now: number): string[] {
    const active = this.latch && this.latch.expiresAt > now ? this.latch : null
    if (active && active.runId !== runId) return []
    if (!active && runId !== null) return []
    const allowed = active ? new Set(active.ids) : null
    const claimed: string[] = []
    for (const row of this.rows.values()) {
      if (allowed && !allowed.has(row.id)) continue
      if (!row.needsRefilter || row.attempts >= 5 || row.claimedRevision !== null) continue
      row.attempts += 1
      row.claimedRevision = row.desired
      claimed.push(row.id)
    }
    return claimed
  }

  publish(id: string, capturedRevision: number) {
    return this.rows.get(id)?.desired === capturedRevision
  }

  end(runId: string) {
    if (this.latch?.runId === runId) this.latch = null
  }
}

describe('semantic scoring input freshness', () => {
  it('keeps deterministic ranking source independent of resume routing', () => {
    const worker = read(deterministicWorkerPath)
    expect(worker).not.toMatch(/routeResume|resume_extracts|ResumeExtractInput/)
    expect(worker).toContain('best_fit_resume_id: null')
    expect(worker).toContain('runner_up_resume_id: null')
  })

  it('loads an explicit scoring-input module instead of treating its absence as infrastructure failure', async () => {
    const module = await loadScoringInput()
    expect(module).toMatchObject({
      SCORING_INPUT_VERSION: expect.any(String),
      jobSnapshotDigest: expect.any(Function),
      resumeExtractionDigest: expect.any(Function),
      scoringInputHash: expect.any(Function),
      shouldRescore: expect.any(Function),
    })
  })

  it('hashes every semantic preference job extraction routing model prompt filter and version input', async () => {
    const module = await loadScoringInput()
    if (!module) return
    const base = semanticInput()
    const baseHash = await module.scoringInputHash(base)
    const variants = [
      { ...base, preferences: { ...base.preferences, titles: ['Credit Research'] } },
      { ...base, preferences: { ...base.preferences, locations: ['New York'] } },
      { ...base, preferences: { ...base.preferences, includeKeywords: ['Python'] } },
      { ...base, preferences: { ...base.preferences, excludeKeywords: ['Director'] } },
      { ...base, preferences: { ...base.preferences, titleExcludeKeywords: ['director'] } },
      { ...base, job: { ...base.job, title: 'Equity Research Associate' } },
      { ...base, job: { ...base.job, location: 'New York, NY' } },
      { ...base, job: { ...base.job, descriptionText: 'Cover regional banks.' } },
      { ...base, routedResumeId: '22222222-2222-4222-8222-222222222222' },
      { ...base, extraction: { ...base.extraction, textContent: 'Changed resume' } },
      { ...base, extraction: { ...base.extraction, keywords: ['Bloomberg'] } },
      { ...base, extraction: { ...base.extraction, model: 'extract-v2' } },
      { ...base, extraction: { ...base.extraction, extractedAt: '2026-07-21T00:00:00.000Z' } },
      { ...base, scoringModel: 'gpt-5.6-luna' },
      { ...base, promptRevision: 'score-v2' },
      { ...base, filterRevision: 'filter-v3' },
      { ...base, scoringInputVersion: 'scoring-input-v999' },
    ]

    for (const variant of variants) {
      expect(await module.scoringInputHash(variant)).not.toBe(baseHash)
    }
  })

  it('canonicalizes order and case semantic no-ops while equality alone permits reuse', async () => {
    const module = await loadScoringInput()
    if (!module) return
    const base = semanticInput()
    const equivalent = {
      ...base,
      preferences: {
        titles: ['  equity research  '],
        locations: ['CHICAGO'],
        includeKeywords: ['valuation'],
        excludeKeywords: ['senior'],
        titleExcludeKeywords: ['ＰｈＤ', 'PRESIDENT', 'phd'],
      },
      extraction: { ...base.extraction, keywords: ['excel', 'VALUATION'] },
    }
    const baseHash = await module.scoringInputHash(base)
    const equivalentHash = await module.scoringInputHash(equivalent)
    expect(equivalentHash).toBe(baseHash)
    expect(module.shouldRescore(null, baseHash)).toBe(true)
    expect(module.shouldRescore('legacy', baseHash)).toBe(true)
    expect(module.shouldRescore(baseHash, baseHash)).toBe(false)
  })
})

describe('migration 0025 scoring freshness contract', () => {
  it('advances all applicable open rows and resets retry claim and error state', () => {
    expect(existsSync(migrationPath), 'migration 0025 must exist').toBe(true)
    if (!existsSync(migrationPath)) return
    const sql = read(migrationPath)
    expect(sql).toMatch(/desired_input_revision\s+bigint\s+not null\s+default\s+0/i)
    expect(sql).toMatch(/desired_input_revision\s*=\s*desired_input_revision\s*\+\s*1/i)
    expect(sql).toMatch(/attempts\s*=\s*0/i)
    expect(sql).toMatch(/claimed_at\s*=\s*null/i)
    expect(sql).toMatch(/error_code\s*=\s*null/i)
    expect(sql).toMatch(/j\.status\s*=\s*'open'/i)
    expect(sql).not.toMatch(/interval\s*'7 days'/i)
  })

  it('retains revision CAS schema while the containment worker performs no terminal writes', () => {
    expect(existsSync(migrationPath), 'migration 0025 must exist').toBe(true)
    if (!existsSync(migrationPath)) return
    const sql = read(migrationPath)
    const worker = read(workerPath)
    expect(sql).toMatch(/claimed_input_revision\s+bigint/i)
    expect(sql).toMatch(/claimed_input_revision\s*=\s*uj\.desired_input_revision/i)
    expect(worker).not.toMatch(/\.eq\('desired_input_revision'/)
    expect(worker).not.toMatch(/\.select\('id'\)|\.maybeSingle\(\)/)
    expect(worker).not.toMatch(/\.update\(|\.insert\(|\.upsert\(/)

    const row = { desired: 8 }
    const captured = 7
    for (const terminal of ['filtered', 'reused', 'scored', 'failed']) {
      expect(row.desired === captured, terminal).toBe(false)
    }
  })

  it('enforces a short-lived service-only exactly-two-fixture maintenance latch', () => {
    expect(existsSync(migrationPath), 'migration 0025 must exist').toBe(true)
    if (!existsSync(migrationPath)) return
    const sql = read(migrationPath)
    expect(sql).toMatch(/create table public\.scoring_verification_maintenance/i)
    expect(sql).toMatch(/fixture_user_job_id_1\s+uuid/i)
    expect(sql).toMatch(/fixture_user_job_id_2\s+uuid/i)
    expect(sql).toMatch(/fixture_user_job_id_1\s*<>\s*fixture_user_job_id_2/i)
    expect(sql).toMatch(/begin_scoring_verification/i)
    expect(sql).toMatch(/end_scoring_verification/i)
    expect(sql).toMatch(/expires_at/i)
    expect(sql).toMatch(/verification_run_id\s+uuid\s+default\s+null/i)
    expect(sql).toMatch(/for update skip locked/i)
    expect(sql).toMatch(/revoke all on table public\.scoring_verification_maintenance from public, anon, authenticated/i)
    expect(sql).toMatch(/grant execute on function public\.begin_scoring_verification[\s\S]*to service_role/i)
  })

  it('models late signals no-id mismatch exact concurrent end and expiry claim boundaries', () => {
    expect(existsSync(migrationPath), 'migration 0025 must exist').toBe(true)
    if (!existsSync(migrationPath)) return
    const sql = read(migrationPath)
    expect(sql).toMatch(/delete from public\.scoring_verification_maintenance[\s\S]*expires_at\s*<=\s*now\(\)/i)
    expect(sql).toMatch(/verification_run_id\s+uuid\s+default\s+null/i)
    expect(sql).toMatch(/active\.run_id\s*<>\s*requested_run_id/i)
    expect(sql).toMatch(/uj\.id\s+in\s*\(active\.fixture_user_job_id_1,\s*active\.fixture_user_job_id_2\)/i)
    expect(sql).toMatch(/requested_run_id\s+is\s+not\s+null[\s\S]*return/i)
    expect(sql).toMatch(/limit\s+batch_size[\s\S]*for update skip locked/i)

    const model = new MaintenanceClaimModel()
    model.add('fixture-positive')
    model.add('fixture-negative')
    model.begin('exact-run', 'fixture-positive', 'fixture-negative', 100)
    model.add('late-job')
    model.signal() // authenticated preference signal
    model.signal() // ready-extraction reroute signal

    expect(model.claim(null, 10)).toEqual([])
    expect(model.claim('mismatched-run', 10)).toEqual([])
    const exactClaim = model.claim('exact-run', 10)
    expect(new Set(exactClaim)).toEqual(new Set(['fixture-positive', 'fixture-negative']))
    expect(model.claim('exact-run', 10)).toEqual([]) // concurrent SKIP LOCKED equivalent
    expect(exactClaim).not.toContain('late-job')

    const captured = model.rows.get('fixture-positive')!.claimedRevision!
    model.signal()
    expect(model.publish('fixture-positive', captured)).toBe(false)

    model.end('exact-run')
    expect(model.claim(null, 20)).toContain('late-job')

    const expired = new MaintenanceClaimModel()
    expired.add('one')
    expired.add('two')
    expired.add('ordinary')
    expired.begin('expired-run', 'one', 'two', 30)
    expect(expired.claim(null, 31)).toContain('ordinary')
    expect(expired.claim('expired-run', 31)).toEqual([])
  })

  it('keeps pipeline fields service-owned and notification runtime absent', () => {
    expect(existsSync(migrationPath), 'migration 0025 must exist').toBe(true)
    if (!existsSync(migrationPath)) return
    const sql = read(migrationPath)
    const notificationSql = read(notificationMigrationPath)
    expect(sql).toMatch(/revoke update \(scoring_input_hash, desired_input_revision, claimed_input_revision\)/i)
    expect(sql).not.toMatch(/notification|push_subscription|notify_tick/i)
    expect(notificationSql).toMatch(/drop table if exists public\.notifications/i)
  })
})

describe('migration 0031 dashboard filter refinement contract', () => {
  it('adds the seeded bounded title exclusion preference without removing legacy compatibility', () => {
    expect(existsSync(dashboardFilterMigrationPath), 'migration 0031 must exist').toBe(true)
    if (!existsSync(dashboardFilterMigrationPath)) return

    const sql = read(dashboardFilterMigrationPath)
    expect(sql).toMatch(/alter table public\.preferences\s+add column title_exclude_keywords text\[\] not null/i)
    expect(sql).toMatch(/default array\['president',\s*'PhD'\]::text\[\]/i)
    expect(sql).toMatch(/check \(cardinality\(title_exclude_keywords\) <= 50\)/i)
    expect(sql).toMatch(/octet_length\(array_to_json\(title_exclude_keywords\)::text\) <= 4096/i)
    expect(sql).toMatch(/array_position\(title_exclude_keywords,\s*null\) is null/i)
    expect(sql.match(/add column/gi)).toHaveLength(1)
    expect(sql).not.toMatch(/drop column\s+(?:if exists\s+)?max_required_experience/i)
  })

  it('admits the new bounded reason while retaining the rolling legacy reason', () => {
    expect(existsSync(dashboardFilterMigrationPath), 'migration 0031 must exist').toBe(true)
    if (!existsSync(dashboardFilterMigrationPath)) return

    const sql = read(dashboardFilterMigrationPath)
    expect(sql).toMatch(/drop constraint if exists user_jobs_filter_reason_check/i)
    expect(sql).toMatch(/add constraint user_jobs_filter_reason_check/i)
    for (const reason of [
      'excluded_title_keyword',
      'excluded_keyword',
      'wrong_location',
      'title_non_overlap',
      'experience_above_max',
    ]) {
      expect(sql).toContain(`'${reason}'`)
    }
    expect(sql).not.toMatch(/\b(?:create|alter|drop)\s+policy\b|\bgrant\b|\bcron\b|\bprovider\b/i)
    expect(sql).not.toMatch(/\bupdate\s+public\.preferences\b/i)
  })
})

describe('score-tick deterministic worker and preserved migration evidence contract', () => {
  it('leaves historical input hashing intact while using only the deterministic evaluator', () => {
    const worker = readWorkerBundle()
    const scoringInput = read(scoringInputPath)

    expect(scoringInput).toMatch(/titleExcludeKeywords:\s*canonicalArray\(input\.preferences\.titleExcludeKeywords\)/)
    expect(worker).not.toMatch(
      /scoringInputHash|SCORING_FILTER_REVISION|experience_above_max/,
    )
    expect(worker).toContain('evaluateDeterministicRanking({')
    expect(worker).not.toContain('routeResume(')
  })

  it('keeps the hosted verifier compatible with new and legacy rows and exact preference restore', () => {
    const verifier = read(verifierPath)
    expect(verifier).toContain("'excluded_title_keyword'")
    expect(verifier).toContain("'experience_above_max'")
    expect(verifier).toMatch(/title_exclude_keywords:\s*string\[\]\s*\|\s*null/)
    expect(verifier).toContain(".select('titles, locations, include_keywords, exclude_keywords, title_exclude_keywords')")
    expect(verifier).toMatch(/title_exclude_keywords:\s*prefRow\?\.title_exclude_keywords\s*\?\?\s*null/)
    expect(verifier).toMatch(/title_exclude_keywords:\s*\[newestJob\.title as string\]/)
  })

  it('preserves method and cron auth before creating the service client', () => {
    const worker = read(workerPath)
    const method = worker.indexOf("request.method !== 'POST'")
    const auth = worker.indexOf("request.headers.get('x-cron-secret')")
    const client = worker.indexOf("requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY')")
    expect(method).toBeGreaterThanOrEqual(0)
    expect(auth).toBeGreaterThan(method)
    expect(client).toBeGreaterThan(auth)
    expect(worker).not.toContain('x-scoring-verification-run-id')
    expect(worker).not.toContain('claim_scoring_work')
  })

  it('has no provider, legacy hashing, or source-specific bypass', () => {
    const worker = readWorkerBundle()
    expect(worker).not.toMatch(/job\.(source|provider)|claimed\.(source|provider)|source\s*===|provider\s*===/i)
    expect(worker).not.toMatch(/cheapFilter|scoringInputHash|generateStructured/)
    expect(worker).not.toMatch(
      /OPENAI_API_KEY|OPENAI_SCORING_MODEL|generateStructured|apiKey\s*:/,
    )
  })

  it('claims only deterministic work and never reserves or accounts paid scoring', () => {
    const worker = readWorkerBundle()
    expect(worker).not.toMatch(/claim_scoring_work|reserve_score_request|purpose\s*:\s*['"]score['"]/)
    expect(worker).toContain("'claim_deterministic_ranking_work'")
    expect(worker).toContain("'stage_deterministic_ranking_results'")
    expect(worker).toContain("'finalize_deterministic_ranking_run'")
    expect(worker).not.toMatch(/\.update\(|\.insert\(|\.upsert\(/)
    expect(worker).toContain('automatic_ai_scoring: false')
  })

  it('serializes exact-cap reservations and defers only paid rows until UTC rollover', () => {
    expect(existsSync(budgetMigrationPath), 'migration 0027 must exist').toBe(true)
    if (!existsSync(budgetMigrationPath)) return
    const sql = read(budgetMigrationPath)

    expect(sql).toMatch(/add column score_deferred_until timestamptz/i)
    expect(sql).toMatch(/create table public\.score_request_budget/i)
    expect(sql).toMatch(/create or replace function public\.reserve_score_request\s*\(/i)
    expect(sql).toMatch(/for update/i)
    expect(sql).toMatch(/select count\(\*\)[\s\S]*from public\.ai_usage[\s\S]*purpose = 'score'/i)
    expect(sql).toMatch(/greatest\(current_count, observed_usage\)/i)
    expect(sql).toMatch(/current_count\s*>=\s*p_daily_cap[\s\S]*select false/i)
    expect(sql).toMatch(/score_deferred_until is null[\s\S]*score_deferred_until <= now\(\)/i)
    expect(sql).toMatch(/order by \(uj\.status = 'scored' and coalesce\(uj\.score, 0\) >= 50\) desc/i)
    expect(sql.match(/score_deferred_until\s*=\s*null/gi)?.length).toBeGreaterThanOrEqual(2)
    expect(sql).toMatch(/grant execute on function public\.reserve_score_request\(integer\) to service_role/i)
  })

  it('does not read any paid-score cap configuration', () => {
    const worker = readWorkerBundle()
    expect(worker).not.toMatch(
      /TEMPORARY_DAILY_SCORE_CAP|AI_DAILY_SCORE_CAP|effectiveDailyScoreCap|PRO_RESCORE_ENABLED/,
    )
  })
})

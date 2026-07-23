import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../..', import.meta.url))
const scoreTickPath = `${root}/supabase/functions/score-tick/index.ts`
const extractResumePath = `${root}/supabase/functions/extract-resume/index.ts`

function read(path: string) {
  return readFileSync(path, 'utf8')
}

describe('score-tick automatic AI containment source contract', () => {
  it('preserves POST and cron-secret authorization before the successful response', () => {
    const worker = read(scoreTickPath)
    const method = worker.indexOf("request.method !== 'POST'")
    const cronSecret = worker.indexOf("Deno.env.get('CRON_SECRET')")
    const header = worker.indexOf("request.headers.get('x-cron-secret')")
    const success = worker.indexOf("status: 'contained'")

    expect(method).toBeGreaterThanOrEqual(0)
    expect(cronSecret).toBeGreaterThan(method)
    expect(header).toBeGreaterThan(cronSecret)
    expect(success).toBeGreaterThan(header)
    expect(worker).toContain("Response.json({ error: 'Method not allowed' }, { status: 405 })")
    expect(worker).toContain("Response.json({ error: 'Unauthorized' }, { status: 401 })")
  })

  it('has no provider, paid reservation, score accounting, or user-data mutation capability', () => {
    const worker = read(scoreTickPath)

    for (const forbidden of [
      /_shared\/openai/i,
      /OPENAI_API_KEY/,
      /OPENAI_SCORING_MODEL/,
      /generateStructured/,
      /reserve_score_request/,
      /purpose\s*:\s*['"]score['"]/,
      /claim_scoring_work/,
      /mark_recent_jobs_for_refilter/,
      /mark_user_jobs_for_reroute/,
      /PRO_RESCORE_ENABLED/,
      /AI_DAILY_SCORE_CAP/,
      /\.from\(['"](?:user_jobs|ai_usage|score_request_budget)['"]\)/,
      /\.update\(/,
      /\.insert\(/,
      /\.upsert\(/,
      /\.rpc\(/,
    ]) {
      expect(worker).not.toMatch(forbidden)
    }
  })

  it('returns a bounded containment result without claiming legacy work', () => {
    const worker = read(scoreTickPath)

    expect(worker).toContain("status: 'contained'")
    expect(worker).toContain('automatic_job_scoring: false')
    expect(worker).toContain('mutations: 0')
    expect(worker).not.toMatch(/claimed|filtered|scored|budget_deferred|failed/)
  })
})

describe('resume extraction remains an explicitly separate allowed AI boundary', () => {
  it('retains extraction-only provider use and extraction-purpose accounting', () => {
    const extractor = read(extractResumePath)

    expect(extractor).toContain("from '../_shared/openai.ts'")
    expect(extractor).toContain("requiredEnvironment('OPENAI_API_KEY')")
    expect(extractor).toContain('generateStructured({')
    expect(extractor).toContain("purpose: 'extract'")
    expect(extractor).not.toMatch(/purpose\s*:\s*['"]score['"]/)
    expect(extractor).not.toContain('reserve_score_request')
  })
})

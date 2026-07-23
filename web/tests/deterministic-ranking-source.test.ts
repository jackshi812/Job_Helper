import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../..', import.meta.url))
const scoreTickPath = `${root}/supabase/functions/score-tick/index.ts`
const extractResumePath = `${root}/supabase/functions/extract-resume/index.ts`

function read(path: string) {
  return readFileSync(path, 'utf8')
}

describe('score-tick deterministic worker source contract', () => {
  it('preserves POST and cron-secret authorization before privileged work', () => {
    const worker = read(scoreTickPath)
    const method = worker.indexOf("request.method !== 'POST'")
    const cronSecret = worker.indexOf("Deno.env.get('CRON_SECRET')")
    const header = worker.indexOf("request.headers.get('x-cron-secret')")
    const client = worker.indexOf("requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY')")

    expect(method).toBeGreaterThanOrEqual(0)
    expect(cronSecret).toBeGreaterThan(method)
    expect(header).toBeGreaterThan(cronSecret)
    expect(client).toBeGreaterThan(header)
    expect(worker).toContain("Response.json({ error: 'Method not allowed' }, { status: 405 })")
    expect(worker).toContain("Response.json({ error: 'Unauthorized' }, { status: 401 })")
  })

  it('has no provider, paid reservation, or score accounting capability', () => {
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
      /initialize_deterministic_ranking_backfill/,
      /PRO_RESCORE_ENABLED/,
      /AI_DAILY_SCORE_CAP/,
      /\.from\(['"](?:ai_usage|score_request_budget)['"]\)/,
    ]) {
      expect(worker).not.toMatch(forbidden)
    }
  })

  it('runs bounded maintenance, claims once, stages every terminal item, and finalizes touched runs', () => {
    const worker = read(scoreTickPath)

    expect(worker).toContain("'enqueue_deterministic_new_jobs'")
    expect(worker).toContain("'enqueue_deterministic_recency_refresh'")
    expect(worker).toContain("'enqueue_deterministic_route_refreshes'")
    expect(worker).toContain("'claim_deterministic_ranking_work'")
    expect(worker).toContain("'stage_deterministic_ranking_result'")
    expect(worker).toContain("'finalize_deterministic_ranking_run'")
    expect(worker.match(/claim_deterministic_ranking_work/g)).toHaveLength(1)
    expect(worker).toMatch(/CLAIM_BATCH_SIZE\s*=\s*12/)
    expect(worker).toMatch(/MAX_CONCURRENCY\s*=\s*4/)
    expect(worker).toContain('Promise.allSettled')
  })

  it('evaluates only captured run inputs and routes resumes separately', () => {
    const worker = read(scoreTickPath)
    const evaluationCall = worker.slice(
      worker.indexOf('evaluateDeterministicRanking({'),
      worker.indexOf('const routing = routeResume('),
    )

    expect(worker).toContain('evaluateDeterministicRanking({')
    expect(worker).toContain('evaluationTime: row.evaluation_time')
    expect(worker).toContain('rubric: row.captured_rubric')
    expect(worker).toContain('good: row.captured_good_threshold')
    expect(worker).toContain('strong: row.captured_strong_threshold')
    expect(worker).toContain('routeResume(')
    expect(evaluationCall).not.toMatch(
      /routeResume|extractsByUser|resumeId|text_content/,
    )
  })

  it('bounds diagnostic output without logging job or resume content', () => {
    const worker = read(scoreTickPath)

    expect(worker).toContain("return 'ranking_item_failed'")
    expect(worker).not.toMatch(
      /console\.(?:log|error)\([^)]*(?:description|text_content|captured_|keywords)/,
    )
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

  it('signals only the free deterministic route refresh after extraction', () => {
    const extractor = read(extractResumePath)

    expect(extractor).toContain("'request_deterministic_route_refresh_for_user'")
    expect(extractor).not.toContain("'mark_user_jobs_for_reroute'")
    expect(extractor).not.toContain("'initialize_deterministic_ranking_backfill'")
  })
})

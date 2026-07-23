import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.110.7'
import {
  evaluateDeterministicRanking,
  type RankingRubric,
} from '../_shared/deterministic-ranking.ts'
import {
  routeResume,
  type ResumeExtractInput,
} from '../_shared/routing.ts'

// Free deterministic ranking worker. The every-minute scheduler and its
// x-cron-secret boundary remain unchanged, but this source has no provider,
// request-budget, or score-purpose accounting capability.
const CLAIM_BATCH_SIZE = 25
const MAX_CONCURRENCY = 25
const MAINTENANCE_BATCH_SIZE = 25
const MAX_ITEMS_PER_INVOCATION = 5_000
const MAX_INVOCATION_MS = 45_000

interface ClaimedRankingRow {
  item_id: string
  run_id: string
  user_id: string
  user_job_id: string
  job_id: string
  revision: number
  evaluation_time: string
  captured_titles: string[]
  captured_locations: string[]
  captured_include_keywords: string[]
  captured_exclude_keywords: string[]
  captured_title_exclude_keywords: string[]
  captured_max_required_experience: number | null
  captured_rubric: RankingRubric
  captured_good_threshold: number
  captured_strong_threshold: number
}

interface RankingJobRow {
  id: string
  title: string
  location: string | null
  description_text: string | null
  posted_at: string | null
  company_id: string | null
}

interface ResumeExtractRow {
  resume_id: string
  user_id: string
  keywords: unknown
}

interface ResumeRow {
  id: string
  filename: string
}

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function diagnosticCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/invalid_ranking_(?:rubric|thresholds|input|result|resume)/.test(message)) {
    return 'invalid_ranking_input'
  }
  if (/timeout|timed out|abort/i.test(message)) return 'ranking_timeout'
  return 'ranking_item_failed'
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

async function runMaintenance(admin: SupabaseClient): Promise<void> {
  for (const rpc of [
    'enqueue_deterministic_new_jobs',
    'enqueue_deterministic_recency_refresh',
    'enqueue_deterministic_route_refreshes',
  ] as const) {
    const { error } = await admin.rpc(rpc, {
      batch_size: MAINTENANCE_BATCH_SIZE,
    })
    if (error) throw error
  }
}

async function claimWork(
  admin: SupabaseClient,
): Promise<ClaimedRankingRow[]> {
  const { data, error } = await admin.rpc(
    'claim_deterministic_ranking_work',
    { batch_size: CLAIM_BATCH_SIZE },
  )
  if (error) throw error
  return (data ?? []) as ClaimedRankingRow[]
}

async function stageFailure(
  admin: SupabaseClient,
  row: ClaimedRankingRow,
  error: unknown,
): Promise<void> {
  const { error: stageError } = await admin.rpc(
    'stage_deterministic_ranking_result',
    {
      p_item_id: row.item_id,
      p_revision: row.revision,
      p_eligible: null,
      p_score: null,
      p_tier: null,
      p_breakdown: null,
      p_filter_code: null,
      p_filter_detail: null,
      p_best_fit_resume_id: null,
      p_runner_up_resume_id: null,
      p_error_code: diagnosticCode(error),
    },
  )
  if (stageError) throw stageError
}

async function processRow(
  admin: SupabaseClient,
  row: ClaimedRankingRow,
  jobs: Map<string, RankingJobRow>,
  extractsByUser: Map<string, ResumeExtractInput[]>,
): Promise<boolean> {
  try {
    const job = jobs.get(row.job_id)
    if (!job) throw new Error('ranking_job_missing')

    // Score authority consumes only the immutable run capture plus shared job
    // facts. Resume text and resume keywords are intentionally absent.
    const result = evaluateDeterministicRanking({
      job: {
        title: job.title,
        location: job.location,
        descriptionText: job.description_text ?? '',
        postedAt: job.posted_at,
        companyId: job.company_id,
      },
      preferences: {
        titles: row.captured_titles,
        locations: row.captured_locations,
        includeKeywords: row.captured_include_keywords,
        excludeKeywords: row.captured_exclude_keywords,
        titleExcludeKeywords: row.captured_title_exclude_keywords,
        maxRequiredExperience: row.captured_max_required_experience,
      },
      evaluationTime: row.evaluation_time,
      rubric: row.captured_rubric,
      thresholds: {
        good: row.captured_good_threshold,
        strong: row.captured_strong_threshold,
      },
    })

    // Best-fit routing is a separate free local calculation and never feeds the
    // deterministic score or hard-filter result.
    const routing = routeResume(
      `${job.title}\n${job.description_text ?? ''}`,
      extractsByUser.get(row.user_id) ?? [],
    )

    const { data: staged, error: stageError } = await admin.rpc(
      'stage_deterministic_ranking_result',
      {
        p_item_id: row.item_id,
        p_revision: row.revision,
        p_eligible: result.eligible,
        p_score: result.score,
        p_tier: result.tier,
        p_breakdown: result.breakdown,
        p_filter_code: result.filterReason,
        p_filter_detail: result.filterDetail,
        p_best_fit_resume_id: routing?.resumeId ?? null,
        p_runner_up_resume_id: routing?.runnerUpResumeId ?? null,
        p_error_code: null,
      },
    )
    if (stageError) throw stageError
    if (staged !== true) throw new Error('ranking_stage_stale')
    return true
  } catch (error) {
    await stageFailure(admin, row, error)
    return false
  }
}

async function loadJobs(
  admin: SupabaseClient,
  rows: ClaimedRankingRow[],
): Promise<Map<string, RankingJobRow>> {
  const ids = [...new Set(rows.map((row) => row.job_id))]
  const jobs = new Map<string, RankingJobRow>()
  if (ids.length === 0) return jobs

  const { data, error } = await admin
    .from('jobs')
    .select('id, title, location, description_text, posted_at, company_id')
    .in('id', ids)
  if (error) throw error
  for (const job of (data ?? []) as RankingJobRow[]) jobs.set(job.id, job)
  return jobs
}

async function loadResumeExtracts(
  admin: SupabaseClient,
  rows: ClaimedRankingRow[],
  byUser: Map<string, ResumeExtractInput[]>,
  loadedOwnerIds: Set<string>,
): Promise<void> {
  const ownerIds = [...new Set(
    rows.map((row) => row.user_id).filter((id) => !loadedOwnerIds.has(id)),
  )]
  if (ownerIds.length === 0) return

  const { data: extractData, error: extractError } = await admin
    .from('resume_extracts')
    .select('resume_id, user_id, keywords')
    .in('user_id', ownerIds)
    .eq('status', 'ready')
  if (extractError) throw extractError
  const extracts = (extractData ?? []) as ResumeExtractRow[]
  for (const ownerId of ownerIds) loadedOwnerIds.add(ownerId)
  if (extracts.length === 0) return

  const { data: resumeData, error: resumeError } = await admin
    .from('resumes')
    .select('id, filename')
    .in('id', extracts.map((extract) => extract.resume_id))
  if (resumeError) throw resumeError
  const filenames = new Map(
    ((resumeData ?? []) as ResumeRow[]).map((resume) => [
      resume.id,
      resume.filename,
    ]),
  )

  for (const extract of extracts) {
    const filename = filenames.get(extract.resume_id)
    if (!filename) continue
    const ownerExtracts = byUser.get(extract.user_id) ?? []
    ownerExtracts.push({
      resumeId: extract.resume_id,
      filename,
      keywords: stringArray(extract.keywords),
    })
    byUser.set(extract.user_id, ownerExtracts)
  }
}

async function processBatch(
  admin: SupabaseClient,
  rows: ClaimedRankingRow[],
  extractsByUser: Map<string, ResumeExtractInput[]>,
  loadedExtractOwnerIds: Set<string>,
): Promise<number> {
  const jobs = await loadJobs(admin, rows)
  await loadResumeExtracts(
    admin,
    rows,
    extractsByUser,
    loadedExtractOwnerIds,
  )
  const results: PromiseSettledResult<boolean>[] = []
  for (let offset = 0; offset < rows.length; offset += MAX_CONCURRENCY) {
    const chunk = rows.slice(offset, offset + MAX_CONCURRENCY)
    results.push(
      ...await Promise.allSettled(
        chunk.map((row) => processRow(admin, row, jobs, extractsByUser)),
      ),
    )
  }
  return results.filter(
    (result) => result.status === 'fulfilled' && result.value,
  ).length
}

async function finalizeRuns(
  admin: SupabaseClient,
  runIds: Set<string>,
): Promise<number> {
  let finalized = 0
  for (const runId of runIds) {
    const { data, error } = await admin.rpc(
      'finalize_deterministic_ranking_run',
      { p_run_id: runId },
    )
    if (error) throw error
    const result = Array.isArray(data) ? data[0] : data
    if (result?.published === true) finalized += 1
  }
  return finalized
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret || request.headers.get('x-cron-secret') !== cronSecret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const admin = createClient(
      requiredEnvironment('SUPABASE_URL'),
      requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY'),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      },
    )

    const startedAt = performance.now()
    let maintenanceRan = false
    let rows = await claimWork(admin)
    // Existing work always drains first. In particular, an owner that becomes
    // idle cannot start another full recency snapshot while an older owner run
    // is still pending. Maintenance is attempted only once after an empty
    // initial claim and is never repeated mid-drain.
    if (rows.length === 0) {
      await runMaintenance(admin)
      maintenanceRan = true
      rows = await claimWork(admin)
    }

    let claimed = 0
    let completed = 0
    let batches = 0
    const touchedRunIds = new Set<string>()
    const extractsByUser = new Map<string, ResumeExtractInput[]>()
    const loadedExtractOwnerIds = new Set<string>()
    while (rows.length > 0) {
      for (const row of rows) touchedRunIds.add(row.run_id)
      claimed += rows.length
      completed += await processBatch(
        admin,
        rows,
        extractsByUser,
        loadedExtractOwnerIds,
      )
      batches += 1

      if (
        claimed >= MAX_ITEMS_PER_INVOCATION ||
        performance.now() - startedAt >= MAX_INVOCATION_MS
      ) break
      rows = await claimWork(admin)
    }

    // Publication remains an all-or-nothing database operation. Finalizing
    // only after this invocation's terminal staging also avoids one finalizer
    // round-trip per 25-item batch.
    const finalized = await finalizeRuns(admin, touchedRunIds)
    const saturated = claimed >= MAX_ITEMS_PER_INVOCATION ||
      performance.now() - startedAt >= MAX_INVOCATION_MS
    return Response.json({
      claimed,
      completed,
      failed: claimed - completed,
      finalized,
      batches,
      maintenance_ran: maintenanceRan,
      saturated,
      automatic_ai_scoring: false,
    })
  } catch (error) {
    console.error('score-tick failed', diagnosticCode(error))
    return Response.json(
      { error: 'Deterministic ranking tick failed' },
      { status: 500 },
    )
  }
})

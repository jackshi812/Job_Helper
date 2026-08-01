import {
  evaluateDeterministicRanking,
  type RankingRubric,
} from './deterministic-ranking.ts'

export const CLAIM_BATCH_SIZE = 25
export const MAX_CONCURRENCY = 25
export const MAINTENANCE_BATCH_SIZE = 25
export const MAX_ITEMS_PER_INVOCATION = 250
export const MAX_INVOCATION_MS = 45_000
export const RESPONSE_CLEANUP_MARGIN_MS = 1_000
export const RECOVERY_RUN_SCAN_LIMIT = 25

interface OperationResult<T = unknown> {
  data: T | null
  error: unknown
}

export interface AbortableOperation<T = unknown>
  extends PromiseLike<OperationResult<T>> {
  abortSignal(signal: AbortSignal): AbortableOperation<T>
  select(...args: unknown[]): AbortableOperation<T>
  in(...args: unknown[]): AbortableOperation<T>
  eq(...args: unknown[]): AbortableOperation<T>
  not(...args: unknown[]): AbortableOperation<T>
  order(...args: unknown[]): AbortableOperation<T>
  limit(...args: unknown[]): AbortableOperation<T>
}

export interface DeterministicWorkerClient {
  rpc(
    name: string,
    args?: Record<string, unknown>,
  ): AbortableOperation
  from(name: string): AbortableOperation
}

export interface DeterministicWorkerOptions {
  client: DeterministicWorkerClient
  now?: () => number
  scheduleTimeout?: (callback: () => void, delayMs: number) => unknown
  cancelTimeout?: (handle: unknown) => void
  maxInvocationMs?: number
  cleanupMarginMs?: number
}

export interface DeterministicWorkerResult {
  claimed: number
  completed: number
  failed: number
  finalized: number
  batches: number
  maintenance_ran: boolean
  recovery_scanned: number
  recovery_attempted: number
  recovery_finalized: number
  saturated: boolean
  automatic_ai_scoring: false
}

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
  deterministic_input_revision: number
}

interface StagedRankingResult {
  item_id: string
  revision: number
  job_input_revision: number
  eligible: boolean | null
  score: number | null
  tier: string | null
  breakdown: unknown
  filter_code: string | null
  filter_detail: string | null
  best_fit_resume_id: null
  runner_up_resume_id: null
  error_code: string | null
}

interface BuildingRankingStateRow {
  building_run_id: string | null
}

interface FinalizeResult {
  status?: string
  published?: boolean
}

interface DeadlineContext {
  signal: AbortSignal
  now: () => number
  deadlineAt: number
}

export class DeterministicWorkerDeadlineError extends Error {
  constructor() {
    super('deterministic_worker_deadline')
    this.name = 'DeterministicWorkerDeadlineError'
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof DeterministicWorkerDeadlineError ||
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && /abort|deadline|timed out|timeout/i.test(error.message))
}

function assertWithinDeadline(context: DeadlineContext): void {
  if (context.signal.aborted || context.now() >= context.deadlineAt) {
    throw new DeterministicWorkerDeadlineError()
  }
}

async function awaitOperation<T>(
  operation: AbortableOperation<T>,
  context: DeadlineContext,
): Promise<OperationResult<T>> {
  assertWithinDeadline(context)
  try {
    return await operation.abortSignal(context.signal)
  } catch (error) {
    if (context.signal.aborted || isAbort(error)) {
      throw new DeterministicWorkerDeadlineError()
    }
    throw error
  }
}

function diagnosticCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/invalid_ranking_(?:rubric|thresholds|input|result|resume)/.test(message)) {
    return 'invalid_ranking_input'
  }
  if (/timeout|timed out|abort|deadline/i.test(message)) return 'ranking_timeout'
  return 'ranking_item_failed'
}

async function runMaintenance(
  client: DeterministicWorkerClient,
  context: DeadlineContext,
): Promise<void> {
  const { error } = await awaitOperation(
    client.rpc('enqueue_deterministic_new_jobs', {
      batch_size: MAINTENANCE_BATCH_SIZE,
    }),
    context,
  )
  if (error) throw error
}

async function claimWork(
  client: DeterministicWorkerClient,
  context: DeadlineContext,
): Promise<ClaimedRankingRow[]> {
  const { data, error } = await awaitOperation(
    client.rpc('claim_deterministic_ranking_work', {
      batch_size: CLAIM_BATCH_SIZE,
    }),
    context,
  )
  if (error) throw error
  return (data ?? []) as ClaimedRankingRow[]
}

function processRow(
  row: ClaimedRankingRow,
  jobs: Map<string, RankingJobRow>,
  context: DeadlineContext,
): StagedRankingResult {
  const job = jobs.get(row.job_id)
  try {
    assertWithinDeadline(context)
    if (!job) throw new Error('ranking_job_missing')

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
    return {
      item_id: row.item_id,
      revision: row.revision,
      job_input_revision: job.deterministic_input_revision,
      eligible: result.eligible,
      score: result.score,
      tier: result.tier,
      breakdown: result.breakdown,
      filter_code: result.filterReason,
      filter_detail: result.filterDetail,
      best_fit_resume_id: null,
      runner_up_resume_id: null,
      error_code: null,
    }
  } catch (error) {
    if (context.signal.aborted || isAbort(error)) {
      throw new DeterministicWorkerDeadlineError()
    }
    return {
      item_id: row.item_id,
      revision: row.revision,
      job_input_revision: job?.deterministic_input_revision ?? 0,
      eligible: null,
      score: null,
      tier: null,
      breakdown: null,
      filter_code: null,
      filter_detail: null,
      best_fit_resume_id: null,
      runner_up_resume_id: null,
      error_code: diagnosticCode(error),
    }
  }
}

async function loadJobs(
  client: DeterministicWorkerClient,
  rows: ClaimedRankingRow[],
  context: DeadlineContext,
): Promise<Map<string, RankingJobRow>> {
  const ids = [...new Set(rows.map((row) => row.job_id))]
  const jobs = new Map<string, RankingJobRow>()
  if (ids.length === 0) return jobs

  const operation = client
    .from('jobs')
    .select('id, title, location, description_text, posted_at, company_id, deterministic_input_revision')
    .in('id', ids)
  const { data, error } = await awaitOperation(operation, context)
  if (error) throw error
  for (const job of (data ?? []) as RankingJobRow[]) jobs.set(job.id, job)
  return jobs
}

async function processBatch(
  client: DeterministicWorkerClient,
  rows: ClaimedRankingRow[],
  context: DeadlineContext,
): Promise<number> {
  const jobs = await loadJobs(client, rows, context)
  const settled: PromiseSettledResult<StagedRankingResult>[] = []
  for (let offset = 0; offset < rows.length; offset += MAX_CONCURRENCY) {
    assertWithinDeadline(context)
    const chunk = rows.slice(offset, offset + MAX_CONCURRENCY)
    settled.push(
      ...await Promise.allSettled(
        chunk.map((row) =>
          Promise.resolve().then(() => processRow(row, jobs, context))
        ),
      ),
    )
    if (context.signal.aborted) throw new DeterministicWorkerDeadlineError()
    const rejected = settled.find((result) => result.status === 'rejected')
    if (rejected?.status === 'rejected') throw rejected.reason
  }

  const records = settled.map((result) => {
    if (result.status === 'rejected') throw result.reason
    return result.value
  })
  const { data: staged, error: stageError } = await awaitOperation(
    client.rpc('stage_deterministic_ranking_results', { p_results: records }),
    context,
  )
  if (stageError) throw stageError
  if (staged !== rows.length) throw new Error('ranking_stage_incomplete')

  return records.filter((record) => record.error_code === null).length
}

async function finalizeRuns(
  client: DeterministicWorkerClient,
  runIds: Set<string>,
  context: DeadlineContext,
): Promise<number> {
  let finalized = 0
  for (const runId of runIds) {
    const { data, error } = await awaitOperation(
      client.rpc('finalize_deterministic_ranking_run', { p_run_id: runId }),
      context,
    )
    if (error) throw error
    const result = Array.isArray(data) ? data[0] : data
    if ((result as FinalizeResult | null)?.published === true) finalized += 1
  }
  return finalized
}

async function recoverOrphanedRuns(
  client: DeterministicWorkerClient,
  context: DeadlineContext,
): Promise<{ scanned: number; attempted: number; finalized: number }> {
  const operation = client
    .from('deterministic_ranking_state')
    .select('building_run_id')
    .eq('status', 'building')
    .not('building_run_id', 'is', null)
    .order('updated_at', { ascending: true })
    .limit(RECOVERY_RUN_SCAN_LIMIT)
  const { data, error } = await awaitOperation(operation, context)
  if (error) throw error

  const runIds = [...new Set(
    ((data ?? []) as BuildingRankingStateRow[])
      .map((row) => row.building_run_id)
      .filter((runId): runId is string => typeof runId === 'string'),
  )]
  let attempted = 0
  let finalized = 0
  for (const runId of runIds) {
    assertWithinDeadline(context)
    const { data: finalizedData, error: finalizeError } = await awaitOperation(
      client.rpc('finalize_deterministic_ranking_run', { p_run_id: runId }),
      context,
    )
    if (finalizeError) throw finalizeError
    attempted += 1
    const result = (
      Array.isArray(finalizedData) ? finalizedData[0] : finalizedData
    ) as FinalizeResult | null
    if (result?.published === true) finalized += 1
  }
  return { scanned: runIds.length, attempted, finalized }
}

export async function runDeterministicWorker(
  options: DeterministicWorkerOptions,
): Promise<DeterministicWorkerResult> {
  const now = options.now ?? (() => performance.now())
  const scheduleTimeout = options.scheduleTimeout ??
    ((callback, delayMs) => globalThis.setTimeout(callback, delayMs))
  const cancelTimeout = options.cancelTimeout ??
    ((handle) => globalThis.clearTimeout(handle as number))
  const maxInvocationMs = options.maxInvocationMs ?? MAX_INVOCATION_MS
  const cleanupMarginMs =
    options.cleanupMarginMs ?? RESPONSE_CLEANUP_MARGIN_MS
  if (
    !Number.isFinite(maxInvocationMs) ||
    !Number.isFinite(cleanupMarginMs) ||
    maxInvocationMs <= 0 ||
    cleanupMarginMs < 0 ||
    cleanupMarginMs >= maxInvocationMs
  ) {
    throw new Error('invalid_deterministic_worker_deadline')
  }

  const startedAt = now()
  const deadlineAt = startedAt + maxInvocationMs - cleanupMarginMs
  const controller = new AbortController()
  const timeout = scheduleTimeout(
    () => controller.abort(new DeterministicWorkerDeadlineError()),
    Math.max(0, deadlineAt - now()),
  )
  const context: DeadlineContext = {
    signal: controller.signal,
    now,
    deadlineAt,
  }

  try {
    let maintenanceRan = false
    let recovery = { scanned: 0, attempted: 0, finalized: 0 }
    let rows = await claimWork(options.client, context)
    if (rows.length === 0) {
      recovery = await recoverOrphanedRuns(options.client, context)
      rows = await claimWork(options.client, context)
      if (rows.length === 0) {
        assertWithinDeadline(context)
        await runMaintenance(options.client, context)
        maintenanceRan = true
        rows = await claimWork(options.client, context)
      }
    }

    let claimed = 0
    let completed = 0
    let batches = 0
    const touchedRunIds = new Set<string>()
    while (rows.length > 0) {
      for (const row of rows) touchedRunIds.add(row.run_id)
      claimed += rows.length
      completed += await processBatch(
        options.client,
        rows,
        context,
      )
      batches += 1
      if (claimed >= MAX_ITEMS_PER_INVOCATION) break
      assertWithinDeadline(context)
      rows = await claimWork(options.client, context)
    }

    const finalized = recovery.finalized +
      await finalizeRuns(options.client, touchedRunIds, context)
    const saturated = claimed >= MAX_ITEMS_PER_INVOCATION ||
      now() >= deadlineAt
    return {
      claimed,
      completed,
      failed: claimed - completed,
      finalized,
      batches,
      maintenance_ran: maintenanceRan,
      recovery_scanned: recovery.scanned,
      recovery_attempted: recovery.attempted,
      recovery_finalized: recovery.finalized,
      saturated,
      automatic_ai_scoring: false,
    }
  } finally {
    cancelTimeout(timeout)
  }
}

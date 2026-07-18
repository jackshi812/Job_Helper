import {
  type NormalizedJob,
  type PollObservation,
} from './adapters/types.ts'

export interface ExistingJobRow {
  id: string
  source: string
  external_id: string
  fingerprint: string
  status: 'open' | 'closed'
  last_seen_at: string
}

export interface CompanySyncPlan {
  seenOpenIds: string[]
  reopenIds: string[]
  newJobs: NormalizedJob[]
  closeIds: string[]
}

export type ExactJobReturnAction = 'insert' | 'refresh' | 'reopen'

export interface ObservationHealthUpdate {
  last_success_at: string | null
  consecutive_failures: number
  last_error: string | null
}

export function exactJobReturnAction(
  existing: Pick<ExistingJobRow, 'status'> | undefined,
): ExactJobReturnAction {
  if (!existing) return 'insert'
  return existing.status === 'closed' ? 'reopen' : 'refresh'
}

const DEFAULT_CLOSE_GRACE_MS = 35 * 60_000

export function isCredibleCompleteObservation(observation: PollObservation) {
  return observation.completeness === 'complete'
    && observation.credibleForClosure
    && Number.isInteger(observation.pageCount)
    && observation.pageCount > 0
    && observation.warnings.length === 0
    && (observation.expectedCount === undefined
      || observation.expectedCount === observation.jobs.length)
}

function boundedWarning(warnings: string[]) {
  const warning = warnings.find((value) => /^[a-z][a-z0-9_]{0,79}$/.test(value))
  return warning ?? 'source_observation_failed'
}

export function observationHealthUpdate(
  observation: PollObservation,
  previousSuccessAt: string | null,
  previousFailures: number,
  observedAt: string,
): ObservationHealthUpdate {
  if (isCredibleCompleteObservation(observation)) {
    return {
      last_success_at: observedAt,
      consecutive_failures: 0,
      last_error: null,
    }
  }

  return {
    last_success_at: previousSuccessAt,
    consecutive_failures: Math.max(0, previousFailures) + 1,
    last_error: boundedWarning(observation.warnings),
  }
}

export function planCompanySync(
  existing: ExistingJobRow[],
  observation: PollObservation,
  nowIso: string,
  graceMs = DEFAULT_CLOSE_GRACE_MS,
): CompanySyncPlan {
  const returned = observation.jobs
  const exactRows = new Map(
    existing.map((job) => [`${job.source}|${job.external_id}`, job]),
  )
  const seenOpenIds: string[] = []
  const reopenIds: string[] = []
  const newJobs: NormalizedJob[] = []

  for (const job of returned) {
    const exactRow = exactRows.get(`${job.source}|${job.externalId}`)
    if (!exactRow) {
      newJobs.push(job)
      continue
    }
    if (exactRow.status === 'closed') {
      reopenIds.push(exactRow.id)
    } else {
      seenOpenIds.push(exactRow.id)
    }
  }

  const seenIds = new Set([...seenOpenIds, ...reopenIds])
  const cutoff = Date.parse(nowIso) - graceMs
  const closeIds = returned.length === 0 || !isCredibleCompleteObservation(observation)
    ? []
    : existing
      .filter((job) => (
        job.status === 'open'
        && !seenIds.has(job.id)
        && Date.parse(job.last_seen_at) < cutoff
      ))
      .map((job) => job.id)

  return { seenOpenIds, reopenIds, newJobs, closeIds }
}

export function shouldAdvanceSuccessHeartbeat(claimed: number, succeeded: number) {
  return claimed === 0 || succeeded > 0
}

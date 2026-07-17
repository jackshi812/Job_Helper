import { type NormalizedJob } from './adapters/types.ts'

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

const DEFAULT_CLOSE_GRACE_MS = 35 * 60_000

export function planCompanySync(
  existing: ExistingJobRow[],
  returned: NormalizedJob[],
  nowIso: string,
  graceMs = DEFAULT_CLOSE_GRACE_MS,
): CompanySyncPlan {
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
  const closeIds = returned.length === 0
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

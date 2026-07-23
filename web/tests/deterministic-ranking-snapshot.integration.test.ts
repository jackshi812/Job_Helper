import { describe, expect, it } from 'vitest'

type Status = 'idle' | 'building' | 'failed'
type ItemStatus = 'pending' | 'completed' | 'failed'

interface ActiveRow {
  jobId: string
  revision: number | null
  score: number | null
  tier: 'Strong' | 'Good' | 'Weak' | null
}

interface Item {
  jobId: string
  status: ItemStatus
  score: number | null
  tier: ActiveRow['tier']
}

interface Snapshot {
  activeRevision: number
  desiredRevision: number
  status: Status
  active: ActiveRow[]
  items: Item[]
  retryCreated: boolean
}

function finalize(snapshot: Snapshot, openJobIds: string[]): Snapshot {
  const captured = new Set(snapshot.items.map((item) => item.jobId))
  const missing = openJobIds.filter((jobId) => !captured.has(jobId))
  if (missing.length > 0) {
    return {
      ...snapshot,
      items: [
        ...snapshot.items,
        ...missing.map((jobId): Item => ({
          jobId,
          status: 'pending',
          score: null,
          tier: null,
        })),
      ],
    }
  }
  if (snapshot.items.some((item) => item.status === 'failed')) {
    return { ...snapshot, status: 'failed' }
  }
  if (snapshot.items.some((item) => item.status !== 'completed')) return snapshot

  const nextRows = snapshot.items.map(
    (item): ActiveRow => ({
      jobId: item.jobId,
      revision: snapshot.desiredRevision,
      score: item.score,
      tier: item.tier,
    }),
  )
  return {
    ...snapshot,
    activeRevision: snapshot.desiredRevision,
    status: 'idle',
    active: nextRows,
  }
}

function retry(snapshot: Snapshot): Snapshot {
  if (snapshot.status !== 'failed' || snapshot.retryCreated) return snapshot
  return {
    ...snapshot,
    status: 'building',
    retryCreated: true,
    items: snapshot.items.map((item) => ({
      ...item,
      status: 'pending',
      score: null,
      tier: null,
    })),
  }
}

const oldActive: ActiveRow[] = [
  { jobId: 'job-a', revision: 7, score: 61, tier: 'Good' },
  { jobId: 'job-b', revision: 7, score: 82, tier: 'Strong' },
]

function building(items: Item[]): Snapshot {
  return {
    activeRevision: 7,
    desiredRevision: 8,
    status: 'building',
    active: structuredClone(oldActive),
    items,
    retryCreated: false,
  }
}

describe('deterministic snapshot publication model', () => {
  it('keeps the previous bytes through pending and partial completion', () => {
    const pending = building([
      { jobId: 'job-a', status: 'completed', score: 70, tier: 'Good' },
      { jobId: 'job-b', status: 'pending', score: null, tier: null },
    ])
    expect(finalize(pending, ['job-a', 'job-b']).active).toEqual(oldActive)
    expect(finalize(pending, ['job-a', 'job-b']).activeRevision).toBe(7)
  })

  it('keeps active bytes on failure and creates at most one retry', () => {
    const failed = finalize(
      building([
        { jobId: 'job-a', status: 'completed', score: 70, tier: 'Good' },
        { jobId: 'job-b', status: 'failed', score: null, tier: null },
      ]),
      ['job-a', 'job-b'],
    )
    expect(failed.status).toBe('failed')
    expect(failed.active).toEqual(oldActive)

    const first = retry(failed)
    const duplicate = retry(first)
    expect(first.status).toBe('building')
    expect(duplicate).toEqual(first)
  })

  it('seeds a concurrently opened job instead of publishing an incomplete universe', () => {
    const readyBeforeConcurrentJob = building([
      { jobId: 'job-a', status: 'completed', score: 70, tier: 'Good' },
      { jobId: 'job-b', status: 'completed', score: 90, tier: 'Strong' },
    ])
    const notPublished = finalize(readyBeforeConcurrentJob, [
      'job-a',
      'job-b',
      'job-c',
    ])
    expect(notPublished.active).toEqual(oldActive)
    expect(notPublished.activeRevision).toBe(7)
    expect(notPublished.items).toContainEqual({
      jobId: 'job-c',
      status: 'pending',
      score: null,
      tier: null,
    })
  })

  it('switches every active row and the state revision together only when complete', () => {
    const complete = finalize(
      building([
        { jobId: 'job-a', status: 'completed', score: 70, tier: 'Good' },
        { jobId: 'job-b', status: 'completed', score: 90, tier: 'Strong' },
      ]),
      ['job-a', 'job-b'],
    )
    expect(complete.activeRevision).toBe(8)
    expect(complete.status).toBe('idle')
    expect(complete.active).toEqual([
      { jobId: 'job-a', revision: 8, score: 70, tier: 'Good' },
      { jobId: 'job-b', revision: 8, score: 90, tier: 'Strong' },
    ])
  })

  it('keeps a new job invisible until it has a committed deterministic result', () => {
    const duringAdmission = building([
      { jobId: 'job-a', status: 'completed', score: 70, tier: 'Good' },
      { jobId: 'job-b', status: 'completed', score: 90, tier: 'Strong' },
      { jobId: 'job-c', status: 'pending', score: null, tier: null },
    ])
    expect(
      duringAdmission.active.filter((row) => row.revision !== null).map((row) => row.jobId),
    ).toEqual(['job-a', 'job-b'])

    const admitted = finalize(
      {
        ...duringAdmission,
        items: duringAdmission.items.map((item) =>
          item.jobId === 'job-c'
            ? { ...item, status: 'completed', score: 55, tier: 'Good' }
            : item
        ),
      },
      ['job-a', 'job-b', 'job-c'],
    )
    expect(admitted.active.map((row) => row.jobId)).toContain('job-c')
  })
})

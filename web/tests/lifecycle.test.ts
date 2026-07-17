import { describe, expect, it } from 'vitest'
import {
  exactJobReturnAction,
  planCompanySync,
  shouldAdvanceSuccessHeartbeat,
} from '../../supabase/functions/_shared/lifecycle.ts'
import { type NormalizedJob } from '../../supabase/functions/_shared/adapters/types.ts'

const nowIso = '2026-07-17T17:00:00.000Z'

function returnedJob(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    source: 'greenhouse',
    externalId: '123',
    title: 'Software Engineer',
    location: 'Chicago, IL',
    absoluteUrl: 'https://example.com/jobs/123',
    postedAt: '2026-07-17T16:00:00.000Z',
    descriptionHtml: '<p>Build reliable systems.</p>',
    descriptionText: 'Build reliable systems.',
    snapshotPartial: false,
    companyName: 'Example',
    ...overrides,
  }
}

describe('exactJobReturnAction', () => {
  it('reopens a returned closed exact-ID snapshot without replacing it', () => {
    expect(exactJobReturnAction(existingJob({ status: 'closed' }))).toBe('reopen')
  })

  it('refreshes an open exact-ID snapshot and inserts only a missing ID', () => {
    expect(exactJobReturnAction(existingJob())).toBe('refresh')
    expect(exactJobReturnAction(undefined)).toBe('insert')
  })
})

function existingJob(
  overrides: Partial<{
    id: string
    source: string
    external_id: string
    fingerprint: string
    status: 'open' | 'closed'
    last_seen_at: string
  }> = {},
) {
  return {
    id: 'job-1',
    source: 'greenhouse',
    external_id: '123',
    fingerprint: 'example|software engineer|chicago',
    status: 'open' as const,
    last_seen_at: '2026-07-17T16:50:00.000Z',
    ...overrides,
  }
}

describe('planCompanySync', () => {
  it('reopens a returned closed exact-ID job without creating or closing it', () => {
    const plan = planCompanySync(
      [existingJob({ status: 'closed', last_seen_at: '2026-07-17T16:20:00.000Z' })],
      [returnedJob()],
      nowIso,
    )

    expect(plan.reopenIds).toEqual(['job-1'])
    expect(plan.seenOpenIds).toEqual([])
    expect(plan.newJobs).toEqual([])
    expect(plan.closeIds).toEqual([])
  })

  it('classifies an open exact-ID match as seen', () => {
    const plan = planCompanySync([existingJob()], [returnedJob()], nowIso)

    expect(plan.seenOpenIds).toEqual(['job-1'])
    expect(plan.reopenIds).toEqual([])
    expect(plan.newJobs).toEqual([])
  })

  it('keeps a genuinely new returned job untouched', () => {
    const job = returnedJob({ externalId: 'new-456' })

    expect(planCompanySync([existingJob()], [job], nowIso).newJobs).toEqual([job])
  })

  it('closes an open job missing beyond the disappearance grace period', () => {
    const missing = existingJob({
      external_id: 'missing',
      last_seen_at: '2026-07-17T16:24:00.000Z',
    })

    expect(planCompanySync([missing], [returnedJob()], nowIso).closeIds).toEqual(['job-1'])
  })

  it('keeps a missing open job inside the close grace period', () => {
    const missing = existingJob({
      external_id: 'missing',
      last_seen_at: '2026-07-17T16:50:00.000Z',
    })

    expect(planCompanySync([missing], [returnedJob()], nowIso).closeIds).toEqual([])
  })

  it('closes nothing after an empty poll', () => {
    const missing = existingJob({ last_seen_at: '2026-07-17T16:00:00.000Z' })

    expect(planCompanySync([missing], [], nowIso).closeIds).toEqual([])
  })

  it('never classifies an absent closed row as a close candidate', () => {
    const closed = existingJob({
      status: 'closed',
      external_id: 'missing',
      last_seen_at: '2026-07-17T16:00:00.000Z',
    })

    const plan = planCompanySync([closed], [returnedJob()], nowIso)
    expect(plan.closeIds).toEqual([])
    expect(plan.seenOpenIds).toEqual([])
    expect(plan.reopenIds).toEqual([])
  })
})

describe('shouldAdvanceSuccessHeartbeat', () => {
  it('treats a no-work tick as successful', () => {
    expect(shouldAdvanceSuccessHeartbeat(0, 0)).toBe(true)
  })

  it('keeps the heartbeat stale when every claimed company fails', () => {
    expect(shouldAdvanceSuccessHeartbeat(3, 0)).toBe(false)
  })

  it('advances the heartbeat after a partial success', () => {
    expect(shouldAdvanceSuccessHeartbeat(3, 1)).toBe(true)
  })
})

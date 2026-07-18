import { describe, expect, it } from 'vitest'
import {
  exactJobReturnAction,
  fingerprintRepostLifecycleUpdate,
  observationHealthUpdate,
  planCompanySync,
  shouldAdvanceSuccessHeartbeat,
} from '../../supabase/functions/_shared/lifecycle.ts'
import {
  type NormalizedJob,
  type PollObservation,
} from '../../supabase/functions/_shared/adapters/types.ts'

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

function observation(
  overrides: Partial<PollObservation> = {},
): PollObservation {
  return {
    jobs: [returnedJob()],
    completeness: 'complete',
    credibleForClosure: true,
    pageCount: 1,
    expectedCount: 1,
    warnings: [],
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

describe('fingerprintRepostLifecycleUpdate', () => {
  it('preserves first-sight identity through external-ID oscillation', () => {
    const original = {
      id: 'job-1',
      company_id: 'company-1',
      source: 'greenhouse',
      external_id: 'provider-original',
      title: 'Software Engineer',
      location: 'Chicago, IL',
      absolute_url: 'https://example.com/jobs/provider-original',
      posted_at: '2026-07-17T16:00:00.000Z',
      description_html: '<p>Build reliable systems.</p>',
      description_text: 'Build reliable systems.',
      snapshot_partial: false,
      fingerprint: 'example|software engineer|chicago',
      status: 'open',
      first_seen_at: '2026-07-17T16:05:00.000Z',
      last_seen_at: '2026-07-17T16:50:00.000Z',
      closed_at: null,
    }
    let stored = original

    for (const [externalId, seenAt] of [
      ['provider-repost-a', '2026-07-17T17:00:00.000Z'],
      ['provider-repost-b', '2026-07-17T17:05:00.000Z'],
      ['provider-original', '2026-07-17T17:10:00.000Z'],
    ] as const) {
      const returned = returnedJob({ externalId })
      expect(returned.externalId).not.toBe(stored.external_id)

      stored = {
        ...stored,
        ...fingerprintRepostLifecycleUpdate(seenAt),
      }

      expect(stored).toEqual({ ...original, last_seen_at: seenAt })
    }
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
      observation(),
      nowIso,
    )

    expect(plan.reopenIds).toEqual(['job-1'])
    expect(plan.seenOpenIds).toEqual([])
    expect(plan.newJobs).toEqual([])
    expect(plan.closeIds).toEqual([])
  })

  it('classifies an open exact-ID match as seen', () => {
    const plan = planCompanySync([existingJob()], observation(), nowIso)

    expect(plan.seenOpenIds).toEqual(['job-1'])
    expect(plan.reopenIds).toEqual([])
    expect(plan.newJobs).toEqual([])
  })

  it('keeps a genuinely new returned job untouched', () => {
    const job = returnedJob({ externalId: 'new-456' })

    expect(planCompanySync(
      [existingJob()],
      observation({ jobs: [job] }),
      nowIso,
    ).newJobs).toEqual([job])
  })

  it('closes an open job missing beyond the disappearance grace period', () => {
    const missing = existingJob({
      external_id: 'missing',
      last_seen_at: '2026-07-17T16:24:00.000Z',
    })

    expect(planCompanySync([missing], observation(), nowIso).closeIds).toEqual(['job-1'])
  })

  it('keeps a missing open job inside the close grace period', () => {
    const missing = existingJob({
      external_id: 'missing',
      last_seen_at: '2026-07-17T16:50:00.000Z',
    })

    expect(planCompanySync([missing], observation(), nowIso).closeIds).toEqual([])
  })

  it('closes nothing after an empty poll', () => {
    const missing = existingJob({ last_seen_at: '2026-07-17T16:00:00.000Z' })

    expect(planCompanySync(
      [missing],
      observation({ jobs: [], expectedCount: 0 }),
      nowIso,
    ).closeIds).toEqual([])
  })

  it('never classifies an absent closed row as a close candidate', () => {
    const closed = existingJob({
      status: 'closed',
      external_id: 'missing',
      last_seen_at: '2026-07-17T16:00:00.000Z',
    })

    const plan = planCompanySync([closed], observation(), nowIso)
    expect(plan.closeIds).toEqual([])
    expect(plan.seenOpenIds).toEqual([])
    expect(plan.reopenIds).toEqual([])
  })

  it.each([
    ['partial page', 'partial', false, ['partial_page']],
    ['unknown response', 'unknown', false, ['unknown_response']],
    ['malformed response', 'unknown', false, ['malformed_response']],
    ['WAF HTML', 'unknown', false, ['waf_html']],
    ['rate limit', 'unknown', false, ['http_429']],
    ['timeout', 'unknown', false, ['timeout']],
    ['detail failure', 'partial', false, ['detail_failure']],
    ['count mismatch', 'partial', false, ['count_mismatch']],
    ['implausibly empty', 'unknown', false, ['implausibly_empty']],
  ] as const)(
    'never closes jobs after a %s observation',
    (_label, completeness, credibleForClosure, warnings) => {
      const missing = existingJob({
        external_id: 'missing',
        last_seen_at: '2026-07-17T16:00:00.000Z',
      })

      const plan = planCompanySync(
        [missing],
        observation({ completeness, credibleForClosure, warnings: [...warnings] }),
        nowIso,
      )

      expect(plan.closeIds).toEqual([])
    },
  )

  it('ingests safe rows from a partial observation without advancing source success', () => {
    const partial = observation({
      completeness: 'partial',
      credibleForClosure: false,
      warnings: ['detail_failure'],
    })
    const previousSuccess = '2026-07-17T16:30:00.000Z'

    expect(planCompanySync([], partial, nowIso).newJobs).toEqual(partial.jobs)
    expect(observationHealthUpdate(partial, previousSuccess, 2, nowIso)).toEqual({
      last_success_at: previousSuccess,
      consecutive_failures: 3,
      last_error: 'detail_failure',
    })
  })

  it('fails closed when complete provider counts do not reconcile', () => {
    const missing = existingJob({
      external_id: 'missing',
      last_seen_at: '2026-07-17T16:00:00.000Z',
    })
    const mismatched = observation({ expectedCount: 2 })

    expect(planCompanySync([missing], mismatched, nowIso).closeIds).toEqual([])
    expect(observationHealthUpdate(mismatched, nowIso, 0, nowIso).last_error)
      .toBe('source_observation_failed')
  })

  it('persists only bounded stable diagnostics from untrusted warnings', () => {
    const unsafe = observation({
      completeness: 'unknown',
      credibleForClosure: false,
      warnings: [
        'https://applicant.example/jobs/123?token=secret',
        '<html>response body</html>',
      ],
    })

    const update = observationHealthUpdate(unsafe, null, 0, nowIso)
    expect(update.last_error).toBe('source_observation_failed')
    expect(JSON.stringify(update)).not.toMatch(/secret|applicant|html|response body/i)
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

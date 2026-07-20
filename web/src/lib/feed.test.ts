import { describe, expect, it } from 'vitest'
import {
  companyName,
  defaultVisible,
  filteredReasonLabel,
  relativePostedTime,
  safeApplyUrl,
  scoreFreshnessLabel,
  tierPresentation,
  type FeedRow,
} from './feed'

// Pure mappers only — feed.ts imports ./supabase, mocked to an empty object so
// the query/mutation helpers stay out of these unit tests (pipeline.test.ts idiom).
import { vi } from 'vitest'
vi.mock('./supabase', () => ({ supabase: {} }))

function feedRow(overrides: Partial<FeedRow> = {}): FeedRow {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    status: 'scored',
    filter_reason: null,
    filter_detail: null,
    score: 82,
    tier: 'Strong',
    reasons: ['strong skill overlap'],
    routed_resume_id: null,
    runner_up_resume_id: null,
    scored_at: '2026-07-19T00:00:00.000Z',
    needs_refilter: false,
    score_deferred_until: null,
    seen_at: null,
    dismissed_at: null,
    jobs: {
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Data Scientist',
      location: 'Remote',
      absolute_url: 'https://boards.greenhouse.io/acme/jobs/1',
      posted_at: '2026-07-18T00:00:00.000Z',
      first_seen_at: '2026-07-18T01:00:00.000Z',
      status: 'open',
      source_company_name: null,
      companies: { name: 'Acme' },
    },
    ...overrides,
  }
}

describe('tierPresentation', () => {
  it('maps Strong tier at and above 75 to the emerald badge', () => {
    expect(tierPresentation(82)).toEqual({ label: 'Strong', badge: 'emerald' })
    expect(tierPresentation(75)).toEqual({ label: 'Strong', badge: 'emerald' })
    expect(tierPresentation(100)).toEqual({ label: 'Strong', badge: 'emerald' })
  })

  it('maps Good tier 50..74 to the neutral badge', () => {
    expect(tierPresentation(74)).toEqual({ label: 'Good', badge: 'neutral' })
    expect(tierPresentation(60)).toEqual({ label: 'Good', badge: 'neutral' })
    expect(tierPresentation(50)).toEqual({ label: 'Good', badge: 'neutral' })
  })

  it('maps Weak tier below 50 to a plain label with no badge fill', () => {
    expect(tierPresentation(49)).toEqual({ label: 'Weak', badge: null })
    expect(tierPresentation(30)).toEqual({ label: 'Weak', badge: null })
    expect(tierPresentation(0)).toEqual({ label: 'Weak', badge: null })
  })

  it('treats a null score as Weak with no badge', () => {
    expect(tierPresentation(null)).toEqual({ label: 'Weak', badge: null })
  })
})

describe('filteredReasonLabel', () => {
  it('renders an excluded keyword with its detail', () => {
    expect(
      filteredReasonLabel({ filter_reason: 'excluded_keyword', filter_detail: 'staff' }),
    ).toBe('excluded keyword: staff')
  })

  it('renders a bare excluded-keyword code when no detail is present', () => {
    expect(
      filteredReasonLabel({ filter_reason: 'excluded_keyword', filter_detail: null }),
    ).toBe('excluded keyword')
  })

  it('renders location and title mismatches', () => {
    expect(filteredReasonLabel({ filter_reason: 'wrong_location', filter_detail: null })).toBe(
      'location mismatch',
    )
    expect(filteredReasonLabel({ filter_reason: 'title_non_overlap', filter_detail: null })).toBe(
      'title mismatch',
    )
  })

  it('returns null when there is no filter reason', () => {
    expect(filteredReasonLabel({ filter_reason: null, filter_detail: null })).toBeNull()
  })
})

describe('defaultVisible', () => {
  it('shows scored rows with score >= 50 that are not dismissed', () => {
    expect(defaultVisible(feedRow({ status: 'scored', score: 50 }))).toBe(true)
    expect(defaultVisible(feedRow({ status: 'scored', score: 82 }))).toBe(true)
  })

  it('hides Weak scored rows below 50', () => {
    expect(defaultVisible(feedRow({ status: 'scored', score: 49, tier: 'Weak' }))).toBe(false)
  })

  it('hides filtered rows', () => {
    expect(
      defaultVisible(feedRow({ status: 'filtered', score: null, filter_reason: 'excluded_keyword' })),
    ).toBe(false)
  })

  it('hides dismissed rows even when they scored well', () => {
    expect(
      defaultVisible(feedRow({ status: 'scored', score: 90, dismissed_at: '2026-07-19T00:00:00.000Z' })),
    ).toBe(false)
  })
})

describe('focused feed freshness gap', () => {
  it('shows only previously scored strong/good stale rows with an updating label', () => {
    expect(defaultVisible(feedRow({ status: 'scored', score: 50 }))).toBe(true)
    expect(defaultVisible(feedRow({ status: 'scored', score: 100 }))).toBe(true)

    expect(defaultVisible(feedRow({ status: 'pending', score: null }))).toBe(false)
    expect(defaultVisible(feedRow({ status: 'failed', score: null }))).toBe(false)
    expect(defaultVisible(feedRow({ status: 'filtered', score: null }))).toBe(false)
    expect(defaultVisible(feedRow({ status: 'scored', score: 49, tier: 'Weak' }))).toBe(false)
    const staleScored = feedRow({
      status: 'scored',
      score: 75,
      needs_refilter: true,
      score_deferred_until: '2026-07-21T00:00:00.000Z',
    })
    expect(defaultVisible(staleScored)).toBe(true)
    expect(scoreFreshnessLabel(staleScored)).toBe('Updating')
    expect(defaultVisible(feedRow({ status: 'scored', score: 75, needs_refilter: true })))
      .toBe(false)
    expect(scoreFreshnessLabel(feedRow({
      status: 'pending',
      score: null,
      needs_refilter: true,
      score_deferred_until: '2026-07-21T00:00:00.000Z',
    })))
      .toBeNull()
    expect(
      defaultVisible(feedRow({
        status: 'scored',
        score: 75,
        dismissed_at: '2026-07-20T00:00:00.000Z',
      })),
    ).toBe(false)
    expect(defaultVisible(feedRow({
      jobs: { ...feedRow().jobs!, status: 'closed' },
    }))).toBe(false)
    expect(defaultVisible(feedRow({ jobs: null }))).toBe(false)
  })
})

describe('companyName', () => {
  it('reads the embedded company name pulled through the jobs FK', () => {
    expect(companyName(feedRow())).toBe('Acme')
  })

  it('falls back to null when the company FK is unset', () => {
    expect(
      companyName(feedRow({ jobs: { ...feedRow().jobs!, companies: null } })),
    ).toBeNull()
    expect(companyName(feedRow({ jobs: null }))).toBeNull()
  })
})

describe('relativePostedTime', () => {
  it('prefers the posted timestamp', () => {
    expect(relativePostedTime(feedRow())).toBe('2026-07-18T00:00:00.000Z')
  })

  it('falls back to first_seen_at when posted_at is null', () => {
    expect(
      relativePostedTime(feedRow({ jobs: { ...feedRow().jobs!, posted_at: null } })),
    ).toBe('2026-07-18T01:00:00.000Z')
  })

  it('returns null when the job is missing', () => {
    expect(relativePostedTime(feedRow({ jobs: null }))).toBeNull()
  })
})

describe('safeApplyUrl', () => {
  it('passes through https apply links', () => {
    expect(safeApplyUrl('https://boards.greenhouse.io/acme/jobs/1')).toBe(
      'https://boards.greenhouse.io/acme/jobs/1',
    )
  })

  it('rejects non-https and credentialed URLs', () => {
    expect(safeApplyUrl('http://example.com')).toBeNull()
    expect(safeApplyUrl('javascript:alert(1)')).toBeNull()
    expect(safeApplyUrl('https://user:pass@example.com')).toBeNull()
    expect(safeApplyUrl(null)).toBeNull()
  })
})

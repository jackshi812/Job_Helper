import { describe, expect, it } from 'vitest'
import {
  companyName,
  deterministicVisible,
  FEED_DETAIL_COLUMNS,
  FEED_LIST_COLUMNS,
  relativePostedTime,
  safeApplyUrl,
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
    deterministic_revision: 4,
    deterministic_eligible: true,
    deterministic_score: 82,
    deterministic_tier: 'Strong',
    deterministic_breakdown: [
      { key: 'title', earned: 30, possible: 30, evidence: ['Strict title match'] },
      { key: 'location', earned: 10, possible: 10, evidence: ['Chicago'] },
      { key: 'recency', earned: 10, possible: 10, evidence: ['Posted within 24 hours'] },
      { key: 'watchlist', earned: 10, possible: 10, evidence: ['Acme'] },
      { key: 'experience', earned: 20, possible: 20, evidence: ['1 year below 3'] },
      { key: 'keywords', earned: 2, possible: 20, evidence: ['valuation'] },
    ],
    deterministic_filter_code: null,
    deterministic_filter_detail: null,
    deterministic_ranked_at: '2026-07-23T00:00:00.000Z',
    deterministic_best_fit_resume_id: null,
    deterministic_runner_up_resume_id: null,
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
  it('maps the stored Strong tier to the emerald badge', () => {
    expect(tierPresentation('Strong')).toEqual({ label: 'Strong', badge: 'emerald' })
  })

  it('maps the stored Good tier to the neutral badge', () => {
    expect(tierPresentation('Good')).toEqual({ label: 'Good', badge: 'neutral' })
  })

  it('maps the stored Weak tier to a plain label with no badge fill', () => {
    expect(tierPresentation('Weak')).toEqual({ label: 'Weak', badge: null })
  })

  it('does not synthesize Weak from a missing stored tier', () => {
    expect(tierPresentation(null)).toBeNull()
  })
})

describe('deterministic feed projection', () => {
  it('selects deterministic result fields and no active AI-era fields', () => {
    for (const columns of [FEED_LIST_COLUMNS, FEED_DETAIL_COLUMNS]) {
      expect(columns).toContain('deterministic_revision')
      expect(columns).toContain('deterministic_eligible')
      expect(columns).toContain('deterministic_score')
      expect(columns).toContain('deterministic_tier')
      expect(columns).toContain('deterministic_breakdown')
      expect(columns).toContain('deterministic_ranked_at')
      expect(columns).toContain('deterministic_best_fit_resume_id')
      expect(columns).not.toMatch(/(^|, )score(,|$)/)
      expect(columns).not.toMatch(/(^|, )tier(,|$)/)
      expect(columns).not.toContain('reasons')
      expect(columns).not.toContain('gaps')
      expect(columns).not.toContain('covered')
      expect(columns).not.toContain('needs_refilter')
      expect(columns).not.toContain('score_deferred_until')
      expect(columns).not.toContain('scored_at')
    }
  })

  it('shows only complete eligible deterministic rows', () => {
    expect(deterministicVisible(feedRow())).toBe(true)
    expect(deterministicVisible(feedRow({ deterministic_revision: null }))).toBe(false)
    expect(deterministicVisible(feedRow({ deterministic_eligible: null }))).toBe(false)
    expect(deterministicVisible(feedRow({ deterministic_eligible: false }))).toBe(false)
    expect(deterministicVisible(feedRow({ deterministic_score: null }))).toBe(false)
    expect(deterministicVisible(feedRow({ deterministic_tier: null }))).toBe(false)
    expect(deterministicVisible(feedRow({
      jobs: { ...feedRow().jobs!, status: 'closed' },
    }))).toBe(false)
    expect(deterministicVisible(feedRow({ jobs: null }))).toBe(false)
  })

  it('leaves dismissal as a separate Dashboard state dimension', () => {
    expect(deterministicVisible(feedRow({
      dismissed_at: '2026-07-20T00:00:00.000Z',
    }))).toBe(true)
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

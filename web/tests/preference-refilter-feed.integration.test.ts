import { describe, expect, it } from 'vitest'
import { cheapFilter } from '../../supabase/functions/_shared/filters'
import { preferenceVisible, scoreFreshnessLabel, type FeedRow } from '../src/lib/feed'

function row(title: string, overrides: Partial<FeedRow> = {}): FeedRow {
  return {
    id: `user-job-${title}`,
    status: 'scored',
    filter_reason: null,
    filter_detail: null,
    score: 82,
    tier: 'Strong',
    reasons: ['old preference reason'],
    routed_resume_id: null,
    runner_up_resume_id: null,
    scored_at: '2026-07-19T00:00:00.000Z',
    needs_refilter: false,
    score_deferred_until: null,
    seen_at: null,
    dismissed_at: null,
    jobs: {
      id: `job-${title}`,
      title,
      location: 'Chicago, IL',
      absolute_url: 'https://example.com/jobs/1',
      posted_at: '2026-07-19T00:00:00.000Z',
      first_seen_at: '2026-07-19T00:00:00.000Z',
      status: 'open',
      source_company_name: 'Example Capital',
      companies: null,
    },
    ...overrides,
  }
}

describe('preference refilter feed gap', () => {
  it('keeps a previously scored match visible but truthfully updating after a capped preference save', () => {
    const dailyScoreUsage = 200
    const dailyScoreCap = 200
    const stale = row('Research Data Analyst', {
      needs_refilter: true,
      score_deferred_until: '2026-07-21T00:00:00.000Z',
    })
    const newlyEligible = row('Equity Research Associate', {
      status: 'pending',
      score: null,
      tier: null,
      reasons: null,
      scored_at: null,
      needs_refilter: true,
      score_deferred_until: '2026-07-21T00:00:00.000Z',
    })

    expect(dailyScoreUsage).toBe(dailyScoreCap)
    expect(preferenceVisible(stale)).toBe(true)
    expect(scoreFreshnessLabel(stale)).toBe('Updating')
    expect(preferenceVisible(newlyEligible)).toBe(true)
    expect(scoreFreshnessLabel(newlyEligible)).toBeNull()

    const preferences = {
      titles: ['Equity Research'],
      locations: [],
      includeKeywords: [],
      excludeKeywords: [],
      titleExcludeKeywords: ['president', 'PhD'],
    }
    const staleOutcome = cheapFilter(
      { title: stale.jobs!.title, location: stale.jobs!.location, descriptionText: '' },
      preferences,
    )
    const current = row('Equity Research Analyst', {
      score: 74,
      tier: 'Good',
      reasons: ['Current title and valuation experience align.'],
    })
    const currentOutcome = cheapFilter(
      { title: current.jobs!.title, location: current.jobs!.location, descriptionText: '' },
      preferences,
    )

    expect(staleOutcome).toMatchObject({ pass: false, reason: 'title_non_overlap' })
    expect(currentOutcome.pass).toBe(true)

    const converged = [
      row('Research Data Analyst', {
        status: 'filtered',
        filter_reason: 'title_non_overlap',
        filter_detail: 'research data analyst',
        score: null,
        tier: null,
        reasons: null,
      }),
      current,
    ]
    expect(converged.filter(preferenceVisible).map((entry) => entry.jobs?.title)).toEqual([
      'Equity Research Analyst',
    ])
  })

  it('converges title exclusions without broadening PhD to doctoral or restoring an explicit empty list', () => {
    const preferences = {
      titles: [],
      locations: [],
      includeKeywords: [],
      excludeKeywords: [],
      titleExcludeKeywords: ['president', 'PhD'],
    }
    for (const title of ['Vice President', 'Senior Vice-President', 'Economist (Ph.D.)', 'Ph D Researcher']) {
      expect(cheapFilter({ title, location: null, descriptionText: '' }, preferences)).toMatchObject({
        pass: false,
        reason: 'excluded_title_keyword',
      })
    }
    expect(
      cheapFilter({ title: 'Doctoral Researcher', location: null, descriptionText: '' }, preferences).pass,
    ).toBe(true)
    expect(
      cheapFilter(
        { title: 'Vice President', location: null, descriptionText: '' },
        { ...preferences, titleExcludeKeywords: [] },
      ).pass,
    ).toBe(true)

    const updating = row('Vice President', {
      needs_refilter: true,
      score_deferred_until: '2026-07-23T00:00:00.000Z',
    })
    expect(preferenceVisible(updating)).toBe(true)
    expect(scoreFreshnessLabel(updating)).toBe('Updating')
    const converged = row('Vice President', {
      status: 'filtered',
      filter_reason: 'excluded_title_keyword',
      filter_detail: 'president',
      score: null,
      tier: null,
      reasons: null,
      needs_refilter: false,
    })
    expect(preferenceVisible(converged)).toBe(false)
  })
})

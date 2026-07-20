import { describe, expect, it } from 'vitest'
import { cheapFilter } from '../../supabase/functions/_shared/filters'
import { defaultVisible, type FeedRow } from '../src/lib/feed'

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
  it('hides stale shared-token roles and converges on fresh matches', () => {
    const stale = row('Research Data Analyst', { needs_refilter: true })

    expect(defaultVisible(stale)).toBe(false)

    const preferences = {
      titles: ['Equity Research'],
      locations: [],
      includeKeywords: [],
      excludeKeywords: [],
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
    expect(converged.filter(defaultVisible).map((entry) => entry.jobs?.title)).toEqual([
      'Equity Research Analyst',
    ])
  })
})

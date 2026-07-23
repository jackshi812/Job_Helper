import { describe, expect, it } from 'vitest'
import { deterministicVisible, type FeedRow } from '../src/lib/feed'

function row(title: string, overrides: Partial<FeedRow> = {}): FeedRow {
  return {
    id: `user-job-${title}`,
    deterministic_revision: 3,
    deterministic_eligible: true,
    deterministic_score: 82,
    deterministic_tier: 'Strong',
    deterministic_breakdown: [],
    deterministic_filter_code: null,
    deterministic_filter_detail: null,
    deterministic_ranked_at: '2026-07-19T00:00:00.000Z',
    deterministic_best_fit_resume_id: null,
    deterministic_runner_up_resume_id: null,
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

describe('atomic deterministic feed replacement', () => {
  it('keeps the complete active snapshot during building and swaps once after completion', () => {
    const oldFeed = [
      row('Research Data Analyst'),
      row('Equity Research Associate', {
        deterministic_score: 61,
        deterministic_tier: 'Good',
      }),
    ]
    const buildingState = {
      activeRevision: 3,
      desiredRevision: 4,
      status: 'building' as const,
    }
    const stagedRows = [
      row('Equity Research Associate', {
        deterministic_revision: null,
        deterministic_eligible: null,
        deterministic_score: null,
        deterministic_tier: null,
      }),
    ]

    expect(buildingState.activeRevision).toBe(3)
    expect(buildingState.desiredRevision).toBe(4)
    expect(oldFeed.filter(deterministicVisible).map((entry) => entry.jobs?.title)).toEqual([
      'Research Data Analyst',
      'Equity Research Associate',
    ])
    expect(stagedRows.filter(deterministicVisible)).toEqual([])

    const completedState = {
      activeRevision: 4,
      desiredRevision: 4,
      status: 'idle' as const,
    }
    const replacementFeed = [
      row('Equity Research Associate', {
        deterministic_revision: 4,
        deterministic_score: 88,
        deterministic_tier: 'Strong',
      }),
    ]
    expect(completedState.activeRevision).toBe(completedState.desiredRevision)
    expect(replacementFeed.filter(deterministicVisible).map((entry) => entry.jobs?.title)).toEqual([
      'Equity Research Associate',
    ])
  })

  it('keeps the prior feed unchanged when the captured revision fails', () => {
    const prior = [row('Equity Research Analyst')]
    const failed = {
      activeRevision: 3,
      desiredRevision: 4,
      status: 'failed' as const,
      retryAvailable: true,
    }

    expect(failed.activeRevision).toBe(3)
    expect(failed.retryAvailable).toBe(true)
    expect(prior.filter(deterministicVisible)).toEqual(prior)
  })
})

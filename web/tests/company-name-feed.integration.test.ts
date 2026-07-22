import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  companyName,
  listFeed,
  preferenceVisible,
  type FeedRow,
} from '../src/lib/feed'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  limit: vi.fn(),
  or: vi.fn(),
  order: vi.fn(),
  select: vi.fn(),
}))

vi.mock('../src/lib/supabase', () => ({
  supabase: { from: mocks.from },
}))

function providerRow(
  id: string,
  score: number,
  companies: FeedRow['jobs'] extends infer _T ? { name: string | null } | null : never,
  sourceCompanyName: string | null,
): FeedRow {
  return {
    id: `user-${id}`,
    status: 'scored',
    filter_reason: null,
    filter_detail: null,
    score,
    tier: score >= 75 ? 'Strong' : 'Good',
    reasons: ['source-agnostic match'],
    routed_resume_id: null,
    runner_up_resume_id: null,
    scored_at: '2026-07-20T00:00:00.000Z',
    needs_refilter: false,
    score_deferred_until: null,
    seen_at: null,
    dismissed_at: null,
    jobs: {
      id,
      title: id,
      location: 'Chicago, IL',
      absolute_url: `https://example.com/${id}`,
      posted_at: '2026-07-20T00:00:00.000Z',
      first_seen_at: '2026-07-20T00:00:00.000Z',
      status: 'open',
      source_company_name: sourceCompanyName,
      companies,
    },
  }
}

describe('truthful company feed gap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.from.mockReturnValue({ select: mocks.select })
    mocks.select.mockReturnValue({ or: mocks.or })
    mocks.or.mockReturnValue({ order: mocks.order })
    mocks.order.mockReturnValue({ limit: mocks.limit })
  })

  it('maps Adzuna Greenhouse and Ashby names without fabrication', async () => {
    const fixtures = [
      providerRow('Adzuna Equity Research', 70, null, '  Source Capital  '),
      providerRow('Greenhouse Equity Research', 91, { name: 'Greenhouse Bank' }, null),
      providerRow('Ashby Equity Research', 82, { name: '  Ashby Partners  ' }, 'Ignored Source'),
      providerRow('Identity-less Equity Research', 99, null, '   '),
    ]
    mocks.limit.mockResolvedValue({ data: fixtures, error: null })

    const returned = await listFeed()
    const ranked = [...returned].sort((left, right) => (right.score ?? -1) - (left.score ?? -1))

    expect(ranked.map((entry) => [entry.jobs?.title, companyName(entry)])).toEqual([
      ['Greenhouse Equity Research', 'Greenhouse Bank'],
      ['Ashby Equity Research', 'Ashby Partners'],
      ['Adzuna Equity Research', 'Source Capital'],
    ])
    expect(ranked.every(preferenceVisible)).toBe(true)
    expect(ranked.some((entry) => companyName(entry) === 'Unknown')).toBe(false)
    expect(mocks.select).toHaveBeenCalledWith(expect.stringContaining('source_company_name'))
  })

  it('returns only current preference-pass candidates while Dashboard tiers own score visibility', async () => {
    const filtered = providerRow('Filtered mismatch', 0, { name: 'Filtered Co' }, null)
    filtered.status = 'filtered'
    filtered.score = null
    filtered.tier = null
    const weak = providerRow('Preference pass weak score', 42, { name: 'Weak Co' }, null)
    weak.tier = 'Weak'
    const pendingScore = providerRow('Preference pass awaiting score', 0, { name: 'Pending Co' }, null)
    pendingScore.status = 'pending'
    pendingScore.score = null
    pendingScore.tier = null
    pendingScore.needs_refilter = true
    pendingScore.score_deferred_until = '2026-07-21T00:00:00.000Z'
    const strong = providerRow('Strong match', 84, { name: 'Strong Co' }, null)

    mocks.limit.mockResolvedValue({ data: [filtered, weak, pendingScore, strong], error: null })

    const returned = await listFeed()

    expect(returned.filter(preferenceVisible).map((row) => row.id)).toEqual([
      weak.id,
      pendingScore.id,
      strong.id,
    ])
    expect(mocks.or).toHaveBeenCalledWith(
      'status.eq.scored,status.eq.failed,score_deferred_until.not.is.null',
    )
    expect(mocks.order).toHaveBeenCalledWith('jobs(posted_at)', {
      ascending: false,
      nullsFirst: false,
    })
  })
})

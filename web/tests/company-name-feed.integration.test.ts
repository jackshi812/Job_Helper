import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  companyName,
  deterministicVisible,
  listFeed,
  type FeedRow,
} from '../src/lib/feed'

const mocks = vi.hoisted(() => ({
  eq: vi.fn(),
  from: vi.fn(),
  limit: vi.fn(),
  not: vi.fn(),
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
    deterministic_revision: 4,
    deterministic_eligible: true,
    deterministic_score: score,
    deterministic_tier: score >= 75 ? 'Strong' : 'Good',
    deterministic_breakdown: [],
    deterministic_filter_code: null,
    deterministic_filter_detail: null,
    deterministic_ranked_at: '2026-07-23T00:00:00.000Z',
    deterministic_best_fit_resume_id: null,
    deterministic_runner_up_resume_id: null,
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
    const chain = {
      eq: mocks.eq,
      limit: mocks.limit,
      not: mocks.not,
      order: mocks.order,
      select: mocks.select,
    }
    mocks.from.mockReturnValue(chain)
    mocks.select.mockReturnValue(chain)
    mocks.eq.mockReturnValue(chain)
    mocks.not.mockReturnValue(chain)
    mocks.order.mockReturnValue(chain)
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
    const ranked = [...returned].sort(
      (left, right) =>
        (right.deterministic_score ?? -1) - (left.deterministic_score ?? -1),
    )

    expect(ranked.map((entry) => [entry.jobs?.title, companyName(entry)])).toEqual([
      ['Greenhouse Equity Research', 'Greenhouse Bank'],
      ['Ashby Equity Research', 'Ashby Partners'],
      ['Adzuna Equity Research', 'Source Capital'],
    ])
    expect(ranked.every(deterministicVisible)).toBe(true)
    expect(ranked.some((entry) => companyName(entry) === 'Unknown')).toBe(false)
    expect(mocks.select).toHaveBeenCalledWith(expect.stringContaining('source_company_name'))
  })

  it('returns only complete eligible rows while stored tiers own visibility', async () => {
    const filtered = providerRow('Filtered mismatch', 0, { name: 'Filtered Co' }, null)
    filtered.deterministic_eligible = false
    filtered.deterministic_score = null
    filtered.deterministic_tier = null
    const weak = providerRow('Preference pass weak score', 42, { name: 'Weak Co' }, null)
    weak.deterministic_tier = 'Weak'
    const pendingScore = providerRow('Preference pass awaiting score', 0, { name: 'Pending Co' }, null)
    pendingScore.deterministic_revision = null
    pendingScore.deterministic_eligible = null
    pendingScore.deterministic_score = null
    pendingScore.deterministic_tier = null
    const strong = providerRow('Strong match', 84, { name: 'Strong Co' }, null)

    mocks.limit.mockResolvedValue({ data: [filtered, weak, pendingScore, strong], error: null })

    const returned = await listFeed()

    expect(returned.filter(deterministicVisible).map((row) => row.id)).toEqual([
      weak.id,
      strong.id,
    ])
    expect(mocks.eq).toHaveBeenCalledWith('deterministic_eligible', true)
    expect(mocks.not).toHaveBeenCalledWith('deterministic_revision', 'is', null)
    expect(mocks.not).toHaveBeenCalledWith('deterministic_score', 'is', null)
    expect(mocks.not).toHaveBeenCalledWith('deterministic_tier', 'is', null)
    expect(mocks.order).toHaveBeenCalledWith('jobs(posted_at)', {
      ascending: false,
      nullsFirst: false,
    })
  })
})

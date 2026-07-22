import { describe, expect, it, vi } from 'vitest'
import type { FeedRow, Tier } from './feed'
import {
  ALL_SCORE_TIERS,
  copyHiddenCompanyKeys,
  dashboardCompanyOptions,
  filterDashboardRows,
  normalizedCompanyKey,
  resetHiddenCompanyKeys,
  searchCompanyOptions,
  toggleHiddenCompanyKey,
  toggleScoreTier,
} from './dashboard'

vi.mock('./supabase', () => ({ supabase: {} }))

function feedRow(company: string, score: number, overrides: Partial<FeedRow> = {}): FeedRow {
  return {
    id: `${company}-${score}`,
    status: 'scored',
    filter_reason: null,
    filter_detail: null,
    score,
    tier: score >= 75 ? 'Strong' : score >= 50 ? 'Good' : 'Weak',
    reasons: [],
    routed_resume_id: null,
    runner_up_resume_id: null,
    scored_at: '2026-07-22T00:00:00.000Z',
    needs_refilter: false,
    score_deferred_until: null,
    seen_at: null,
    dismissed_at: null,
    jobs: {
      id: `job-${company}-${score}`,
      title: 'Analyst',
      location: 'Chicago',
      absolute_url: 'https://example.com/job',
      posted_at: '2026-07-22T00:00:00.000Z',
      first_seen_at: '2026-07-22T00:00:00.000Z',
      status: 'open',
      source_company_name: null,
      companies: { name: company },
    },
    ...overrides,
  }
}

const allTiers = new Set<Tier>(ALL_SCORE_TIERS)

describe('Dashboard company options', () => {
  it('derives only truthful normalized feed companies in case-insensitive order', () => {
    const rows = [
      feedRow('Walmart', 80),
      feedRow(' accenture ', 60),
      feedRow('Accenture', 45),
      feedRow('ignored', 70, { jobs: null }),
    ]
    expect(dashboardCompanyOptions(rows)).toEqual([
      { key: 'accenture', label: 'accenture' },
      { key: 'walmart', label: 'Walmart' },
    ])
  })

  it('searches options case-insensitively without creating arbitrary companies', () => {
    const options = dashboardCompanyOptions([feedRow('RADaR Analytics', 80), feedRow('PwC', 60)])
    expect(searchCompanyOptions(options, 'radar')).toEqual([
      { key: 'radar analytics', label: 'RADaR Analytics' },
    ])
    expect(searchCompanyOptions(options, 'New company')).toEqual([])
  })
})

describe('Dashboard staged filters', () => {
  it('starts with all tiers and no hidden companies', () => {
    expect([...allTiers]).toEqual(['Strong', 'Good', 'Weak'])
    expect(resetHiddenCompanyKeys().size).toBe(0)
  })

  it('copies, toggles, resets, and applies hidden-company drafts immutably', () => {
    const applied = new Set(['accenture'])
    const draft = copyHiddenCompanyKeys(applied)
    const changed = toggleHiddenCompanyKey(draft, 'walmart')
    expect([...applied]).toEqual(['accenture'])
    expect([...changed]).toEqual(['accenture', 'walmart'])
    expect(resetHiddenCompanyKeys().size).toBe(0)
  })

  it('shows a newly refreshed company by default because only hidden keys are stored', () => {
    const hidden = new Set([normalizedCompanyKey('Acme')])
    const rows = filterDashboardRows([feedRow('Acme', 80), feedRow('NewCo', 60)], {
      viewAll: false,
      showDismissed: false,
      appliedHiddenKeys: hidden,
      selectedTiers: allTiers,
    })
    expect(rows.map((row) => row.jobs?.companies?.name)).toEqual(['NewCo'])
  })

  it('keeps Weak visible by default and composes company and tier filters with AND', () => {
    const rows = [feedRow('Acme', 85), feedRow('Acme', 40), feedRow('Walmart', 60)]
    expect(filterDashboardRows(rows, {
      viewAll: false,
      showDismissed: false,
      appliedHiddenKeys: new Set(),
      selectedTiers: allTiers,
    })).toHaveLength(3)

    expect(filterDashboardRows(rows, {
      viewAll: false,
      showDismissed: false,
      appliedHiddenKeys: new Set(['acme']),
      selectedTiers: new Set<Tier>(['Good']),
    }).map((row) => row.id)).toEqual(['Walmart-60'])
  })

  it('allows zero selected tiers and toggles without mutating the input', () => {
    const selected = new Set<Tier>(['Weak'])
    const empty = toggleScoreTier(selected, 'Weak')
    expect([...selected]).toEqual(['Weak'])
    expect(empty.size).toBe(0)
    expect(filterDashboardRows([feedRow('Acme', 40)], {
      viewAll: false,
      showDismissed: false,
      appliedHiddenKeys: new Set(),
      selectedTiers: empty,
    })).toEqual([])
  })
})

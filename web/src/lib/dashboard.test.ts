import { describe, expect, it, vi } from 'vitest'
import dashboardSource from './dashboard.ts?raw'
import type { FeedRow, Tier } from './feed'
import {
  ALL_SCORE_TIERS,
  areAllCurrentCompaniesCleared,
  areAllCurrentCompaniesSelected,
  clearAllCompanies,
  copyHiddenCompanyKeys,
  dashboardCompanyOptions,
  filterDashboardRows,
  normalizedCompanyKey,
  resetHiddenCompanyKeys,
  searchCompanyOptions,
  scoreTierSummary,
  selectAllCompanies,
  toggleHiddenCompanyKey,
  toggleScoreTier,
} from './dashboard'
import {
  DASHBOARD_COLUMNS,
  DASHBOARD_COLUMN_STORAGE_KEY,
  clampDashboardColumnWidth,
  dashboardTableWidth,
  defaultDashboardColumnWidths,
  hydrateDashboardColumnWidths,
  persistDashboardColumnWidths,
  reduceDashboardColumnWidth,
  type DashboardColumnStorage,
} from './dashboardColumns'

vi.mock('./supabase', () => ({ supabase: {} }))

function feedRow(company: string, score: number, overrides: Partial<FeedRow> = {}): FeedRow {
  return {
    id: `${company}-${score}`,
    deterministic_revision: 4,
    deterministic_eligible: true,
    deterministic_score: score,
    deterministic_tier: score >= 75 ? 'Strong' : score >= 50 ? 'Good' : 'Weak',
    deterministic_breakdown: [],
    deterministic_filter_code: null,
    deterministic_filter_detail: null,
    deterministic_ranked_at: '2026-07-22T00:00:00.000Z',
    deterministic_best_fit_resume_id: null,
    deterministic_runner_up_resume_id: null,
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
    const options = dashboardCompanyOptions([
      feedRow('RADaR Analytics', 80),
      feedRow('PwC', 60),
      feedRow('IKEA', 70),
    ])
    expect(searchCompanyOptions(options, 'radar')).toEqual([
      { key: 'radar analytics', label: 'RADaR Analytics' },
    ])
    expect(normalizedCompanyKey('IKEA')).toBe('ikea')
    expect(dashboardSource).not.toContain('toLocaleLowerCase')
    expect(searchCompanyOptions(options, 'ikea')).toEqual([
      { key: 'ikea', label: 'IKEA' },
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

  it('clears and selects the complete current company list with fresh hidden-key sets', () => {
    const options = dashboardCompanyOptions([
      feedRow('Acme', 80),
      feedRow('Walmart', 60),
      feedRow('PwC', 40),
    ])
    const searched = searchCompanyOptions(options, 'acme')
    const previous = new Set(['stale-company'])

    const cleared = clearAllCompanies(options)
    const selected = selectAllCompanies()

    expect(searched.map((option) => option.key)).toEqual(['acme'])
    expect([...cleared]).toEqual(['acme', 'pwc', 'walmart'])
    expect(cleared).not.toBe(previous)
    expect(selected).not.toBe(previous)
    expect(selected.size).toBe(0)
    expect([...previous]).toEqual(['stale-company'])
    expect(options.map((option) => option.key)).toEqual(['acme', 'pwc', 'walmart'])
  })

  it('computes bulk disabled states from current option keys and tolerates stale keys', () => {
    const options = dashboardCompanyOptions([
      feedRow('Acme', 80),
      feedRow('Walmart', 60),
    ])

    expect(areAllCurrentCompaniesCleared(options, new Set(['acme', 'walmart']))).toBe(true)
    expect(areAllCurrentCompaniesCleared(options, new Set(['acme', 'stale-company']))).toBe(false)
    expect(areAllCurrentCompaniesSelected(options, new Set(['stale-company']))).toBe(true)
    expect(areAllCurrentCompaniesSelected(options, new Set(['acme', 'stale-company']))).toBe(false)
    expect(areAllCurrentCompaniesCleared([], new Set(['stale-company']))).toBe(true)
    expect(areAllCurrentCompaniesSelected([], new Set(['stale-company']))).toBe(true)
  })

  it('summarizes all, none, and partial score-tier selections exactly', () => {
    expect(scoreTierSummary(new Set<Tier>(ALL_SCORE_TIERS))).toBe('Score tiers: All')
    expect(scoreTierSummary(new Set<Tier>())).toBe('Score tiers: None')
    expect(scoreTierSummary(new Set<Tier>(['Strong']))).toBe('Score tiers: 1 selected')
    expect(scoreTierSummary(new Set<Tier>(['Strong', 'Weak']))).toBe(
      'Score tiers: 2 selected',
    )
  })

  it('shows a newly refreshed company by default because only hidden keys are stored', () => {
    const hidden = new Set([normalizedCompanyKey('Acme')])
    const rows = filterDashboardRows([feedRow('Acme', 80), feedRow('NewCo', 60)], {
      showDismissed: false,
      appliedHiddenKeys: hidden,
      selectedTiers: allTiers,
    })
    expect(rows.map((row) => row.jobs?.companies?.name)).toEqual(['NewCo'])
  })

  it('uses one preference-pass scope and composes company and tier filters with AND', () => {
    const rows = [
      feedRow('Acme', 85),
      feedRow('Acme', 40),
      feedRow('Walmart', 60),
    ]
    expect(filterDashboardRows(rows, {
      showDismissed: false,
      appliedHiddenKeys: new Set(),
      selectedTiers: allTiers,
    }).map((row) => row.id)).toEqual([
      'Acme-85',
      'Acme-40',
      'Walmart-60',
    ])

    expect(filterDashboardRows(rows, {
      showDismissed: false,
      appliedHiddenKeys: new Set(['acme']),
      selectedTiers: new Set<Tier>(['Good']),
    }).map((row) => row.id)).toEqual(['Walmart-60'])

    expect(filterDashboardRows(rows, {
      showDismissed: false,
      appliedHiddenKeys: new Set(),
      selectedTiers: new Set<Tier>(['Strong', 'Good']),
    }).map((row) => row.id)).toEqual(['Acme-85', 'Walmart-60'])
  })

  it('excludes rows outside the authorized current preference-pass feed contract', () => {
    const rows = [
      feedRow('Acme', 80, {
        id: 'unknown',
        deterministic_revision: null,
        deterministic_eligible: null,
        deterministic_score: null,
        deterministic_tier: null,
      }),
      feedRow('Acme', 80, { id: 'filtered', deterministic_eligible: false }),
      feedRow('Acme', 80, {
        id: 'closed',
        jobs: { ...feedRow('Acme', 80).jobs!, status: 'closed' },
      }),
      feedRow('Acme', 80, { id: 'pending-score', deterministic_score: null }),
      feedRow('Acme', 80, { id: 'pending-tier', deterministic_tier: null }),
      feedRow('Acme', 80, { id: 'identityless', jobs: null }),
    ]
    expect(filterDashboardRows(rows, {
      showDismissed: false,
      appliedHiddenKeys: new Set(),
      selectedTiers: allTiers,
    })).toEqual([])
  })

  it('keeps dismissed state separate while preserving company and tier filters', () => {
    const dismissedWeak = feedRow('Acme', 40, {
      id: 'dismissed-weak',
      dismissed_at: '2026-07-22T02:00:00.000Z',
    })
    expect(filterDashboardRows([dismissedWeak, feedRow('Walmart', 80)], {
      showDismissed: true,
      appliedHiddenKeys: new Set(),
      selectedTiers: allTiers,
    }).map((row) => row.id)).toEqual(['dismissed-weak'])
    expect(filterDashboardRows([dismissedWeak], {
      showDismissed: true,
      appliedHiddenKeys: new Set(['acme']),
      selectedTiers: allTiers,
    })).toEqual([])
  })

  it('allows zero selected tiers and toggles without mutating the input', () => {
    const selected = new Set<Tier>(['Weak'])
    const empty = toggleScoreTier(selected, 'Weak')
    expect([...selected]).toEqual(['Weak'])
    expect(empty.size).toBe(0)
    expect(filterDashboardRows([feedRow('Acme', 40)], {
      showDismissed: false,
      appliedHiddenKeys: new Set(),
      selectedTiers: empty,
    })).toEqual([])
  })
})

describe('Dashboard column widths', () => {
  function memoryStorage(initial: string | null = null): DashboardColumnStorage & { value: string | null } {
    return {
      value: initial,
      getItem(key) {
        expect(key).toBe(DASHBOARD_COLUMN_STORAGE_KEY)
        return this.value
      },
      setItem(key, value) {
        expect(key).toBe(DASHBOARD_COLUMN_STORAGE_KEY)
        this.value = value
      },
    }
  }

  it('defines the exact nine-column default model and total table width', () => {
    const defaults = defaultDashboardColumnWidths()
    expect(DASHBOARD_COLUMNS.map((column) => column.id)).toEqual([
      'new', 'job', 'company', 'location', 'score', 'bestFit', 'posted', 'apply', 'action',
    ])
    expect(defaults).toEqual({
      new: 80,
      job: 280,
      company: 200,
      location: 200,
      score: 180,
      bestFit: 220,
      posted: 132,
      apply: 96,
      action: 120,
    })
    expect(dashboardTableWidth(defaults)).toBe(1508)
  })

  it('hydrates valid known values and ignores unknown keys', () => {
    const storage = memoryStorage(JSON.stringify({
      version: 1,
      widths: { job: 340, score: 220, invented: 999 },
    }))
    expect(hydrateDashboardColumnWidths(storage)).toMatchObject({ job: 340, score: 220 })
    expect(hydrateDashboardColumnWidths(storage)).not.toHaveProperty('invented')
  })

  it.each([
    ['malformed JSON', '{'],
    ['wrong version', JSON.stringify({ version: 2, widths: { job: 340 } })],
    ['non-finite width', JSON.stringify({ version: 1, widths: { job: null } })],
    ['below-minimum width', JSON.stringify({ version: 1, widths: { job: 10 } })],
    ['above-maximum width', JSON.stringify({ version: 1, widths: { job: 900 } })],
  ])('falls back to defaults for %s', (_label, raw) => {
    expect(hydrateDashboardColumnWidths(memoryStorage(raw)).job).toBe(280)
  })

  it('falls back silently when storage access is denied', () => {
    const denied: DashboardColumnStorage = {
      getItem() { throw new DOMException('Denied', 'SecurityError') },
      setItem() { throw new DOMException('Denied', 'SecurityError') },
    }
    expect(hydrateDashboardColumnWidths(denied)).toEqual(defaultDashboardColumnWidths())
    expect(() => persistDashboardColumnWidths(defaultDashboardColumnWidths(), denied)).not.toThrow()
  })

  it('persists only the version and all nine clamped width values', () => {
    const storage = memoryStorage()
    const widths = { ...defaultDashboardColumnWidths(), job: 999, score: Number.NaN }
    persistDashboardColumnWidths(widths, storage)
    const payload = JSON.parse(storage.value ?? '{}')
    expect(Object.keys(payload).sort()).toEqual(['version', 'widths'])
    expect(payload.version).toBe(1)
    expect(Object.keys(payload.widths)).toEqual(DASHBOARD_COLUMNS.map((column) => column.id))
    expect(payload.widths.job).toBe(520)
    expect(payload.widths.score).toBe(180)
  })

  it('clamps pointer widths and supports every keyboard increment', () => {
    expect(clampDashboardColumnWidth('job', 100)).toBe(220)
    expect(clampDashboardColumnWidth('job', 900)).toBe(520)
    expect(reduceDashboardColumnWidth('job', 280, 'ArrowLeft')).toBe(272)
    expect(reduceDashboardColumnWidth('job', 280, 'ArrowRight')).toBe(288)
    expect(reduceDashboardColumnWidth('job', 280, 'ArrowLeft', true)).toBe(256)
    expect(reduceDashboardColumnWidth('job', 280, 'ArrowRight', true)).toBe(304)
    expect(reduceDashboardColumnWidth('job', 280, 'Home')).toBe(220)
    expect(reduceDashboardColumnWidth('job', 280, 'End')).toBe(520)
    expect(reduceDashboardColumnWidth('job', 280, 'Enter')).toBe(280)
  })
})

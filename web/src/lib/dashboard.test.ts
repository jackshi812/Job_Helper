import { describe, expect, it, vi } from 'vitest'
import dashboardSource from './dashboard.ts?raw'
import type { FeedRow, Tier } from './feed'
import {
  ALL_SCORE_TIERS,
  appendDashboardFeedPage,
  areAllCurrentCompaniesCleared,
  areAllCurrentCompaniesSelected,
  backfillDashboardFeedPage,
  buildDashboardFeedQuery,
  clearAllCompanies,
  copyHiddenCompanyKeys,
  dashboardCompanyOptions,
  dashboardFeedQueryKey,
  dashboardLifecycleCopy,
  dashboardLifecycleTimestamp,
  dashboardScoreSortAvailable,
  dashboardSourceRows,
  dashboardWatchlistCompanyOptions,
  isWatchlistJob,
  lifecycleViewFromToggles,
  normalizedCompanyKey,
  removeDashboardFeedRow,
  resetDashboardFeedQuery,
  resetHiddenCompanyKeys,
  restoreDashboardFeedRow,
  searchCompanyOptions,
  scoreTierSummary,
  selectAllCompanies,
  toggleDashboardLifecycle,
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
    applied_at: null,
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
  it('separates watched jobs by normalized company relationship without guessing from names', () => {
    const watched = feedRow('Acme', 80)
    const external = feedRow('External Co', 70, {
      jobs: {
        id: 'job-external',
        title: 'Analyst',
        location: 'Chicago',
        absolute_url: 'https://example.com/external',
        posted_at: '2026-07-22T00:00:00.000Z',
        first_seen_at: '2026-07-22T00:00:00.000Z',
        status: 'open',
        source_company_name: 'External Co',
        companies: null,
      },
    })

    expect(isWatchlistJob(watched)).toBe(true)
    expect(isWatchlistJob(external)).toBe(false)
    expect(dashboardSourceRows([watched, external], 'watchlist')).toEqual([watched])
    expect(dashboardSourceRows([watched, external], 'all')).toEqual([watched, external])
  })

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

  it('keeps the watchlist option source separate from external loaded rows', () => {
    const watched = feedRow('Acme', 80)
    const external = feedRow('External Co', 70, {
      jobs: {
        id: 'job-external',
        title: 'Analyst',
        location: 'Chicago',
        absolute_url: 'https://example.com/external',
        posted_at: '2026-07-22T00:00:00.000Z',
        first_seen_at: '2026-07-22T00:00:00.000Z',
        status: 'open',
        source_company_name: 'External Co',
        companies: null,
      },
    })

    expect(dashboardWatchlistCompanyOptions([watched, external])).toEqual([
      { key: 'acme', label: 'Acme' },
    ])
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

  it('recovers after Clear all is applied, reopened, and followed by Select all', () => {
    const loadedRows = [
      feedRow('Acme', 80),
      feedRow('Walmart', 60),
      feedRow('External Co', 70, {
        jobs: {
          id: 'job-external',
          title: 'Analyst',
          location: 'Chicago',
          absolute_url: 'https://example.com/external',
          posted_at: '2026-07-22T00:00:00.000Z',
          first_seen_at: '2026-07-22T00:00:00.000Z',
          status: 'open',
          source_company_name: 'External Co',
          companies: null,
        },
      }),
    ]
    const options = dashboardWatchlistCompanyOptions(loadedRows)
    const searched = searchCompanyOptions(options, 'acme')

    expect(searched.map(({ key }) => key)).toEqual(['acme'])

    const clearedDraft = clearAllCompanies(options)
    const appliedAfterClear = copyHiddenCompanyKeys(clearedDraft)
    expect([...appliedAfterClear]).toEqual(['acme', 'walmart'])
    expect(areAllCurrentCompaniesCleared(options, appliedAfterClear)).toBe(true)
    expect(options.filter(({ key }) => !appliedAfterClear.has(key))).toEqual([])
    expect(dashboardWatchlistCompanyOptions(loadedRows)).toEqual(options)

    const reopenedDraft = copyHiddenCompanyKeys(appliedAfterClear)
    expect(areAllCurrentCompaniesSelected(options, reopenedDraft)).toBe(false)

    const refreshedOptions = dashboardWatchlistCompanyOptions([
      ...loadedRows,
      feedRow('NewCo', 75),
    ])
    expect(refreshedOptions.map(({ key }) => key)).toEqual(['acme', 'newco', 'walmart'])
    expect(reopenedDraft.has('newco')).toBe(false)

    const selectedDraft = selectAllCompanies()
    const appliedAfterSelect = copyHiddenCompanyKeys(selectedDraft)
    expect(areAllCurrentCompaniesSelected(refreshedOptions, appliedAfterSelect)).toBe(true)
    expect(buildDashboardFeedQuery({
      lifecycle: 'active',
      activeOrder: 'newest',
      appliedHiddenKeys: appliedAfterSelect,
      selectedTiers: allTiers,
    }).hiddenCompanyKeys).toEqual([])
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
    const query = buildDashboardFeedQuery({
      lifecycle: 'active',
      activeOrder: 'newest',
      appliedHiddenKeys: new Set([normalizedCompanyKey('Acme')]),
      selectedTiers: allTiers,
    })
    expect(query.hiddenCompanyKeys).toEqual(['acme'])
    expect(query.hiddenCompanyKeys).not.toContain('newco')
  })

  it('feeds company and tier filters to the complete server query with AND semantics', () => {
    expect(buildDashboardFeedQuery({
      lifecycle: 'active',
      activeOrder: 'score_desc',
      appliedHiddenKeys: new Set(['walmart', 'acme']),
      selectedTiers: new Set<Tier>(['Good', 'Strong']),
    })).toEqual({
      lifecycle: 'active',
      order: 'score_desc',
      hiddenCompanyKeys: ['acme', 'walmart'],
      tiers: ['Strong', 'Good'],
    })
  })

  it('allows zero selected tiers and toggles without mutating the input', () => {
    const selected = new Set<Tier>(['Weak'])
    const empty = toggleScoreTier(selected, 'Weak')
    expect([...selected]).toEqual(['Weak'])
    expect(empty.size).toBe(0)
    expect(buildDashboardFeedQuery({
      lifecycle: 'active',
      activeOrder: 'newest',
      appliedHiddenKeys: new Set(),
      selectedTiers: empty,
    }).tiers).toEqual([])
  })
})

describe('Dashboard lifecycle state', () => {
  it('defaults both toggles to Active and keeps them mutually exclusive', () => {
    expect(lifecycleViewFromToggles(false, false)).toBe('active')
    expect(lifecycleViewFromToggles(true, false)).toBe('applied')
    expect(lifecycleViewFromToggles(false, true)).toBe('dismissed')
    expect(lifecycleViewFromToggles(true, true)).toBe('active')

    expect(toggleDashboardLifecycle('active', 'applied')).toBe('applied')
    expect(toggleDashboardLifecycle('applied', 'applied')).toBe('active')
    expect(toggleDashboardLifecycle('dismissed', 'applied')).toBe('applied')
    expect(toggleDashboardLifecycle('active', 'dismissed')).toBe('dismissed')
    expect(toggleDashboardLifecycle('dismissed', 'dismissed')).toBe('active')
    expect(toggleDashboardLifecycle('applied', 'dismissed')).toBe('dismissed')
  })

  it('returns exact lifecycle copy, nouns, empty states, and time labels', () => {
    expect(dashboardLifecycleCopy('active')).toEqual({
      description: 'New postings ranked against your preferences, newest first.',
      resultNoun: 'active jobs',
      timeLabel: 'Posted',
      emptyHeading: 'No matches yet',
      emptyBody: 'New matches will appear here after your jobs are ranked.',
    })
    expect(dashboardLifecycleCopy('applied')).toEqual({
      description: "Jobs you've marked applied, newest applied first.",
      resultNoun: 'applied jobs',
      timeLabel: 'Applied',
      emptyHeading: 'No applied jobs yet',
      emptyBody: 'Jobs you mark applied will appear here.',
    })
    expect(dashboardLifecycleCopy('dismissed')).toEqual({
      description: "Jobs you've dismissed, newest dismissed first.",
      resultNoun: 'dismissed jobs',
      timeLabel: 'Dismissed',
      emptyHeading: 'No dismissed jobs',
      emptyBody: 'Jobs you dismiss will appear here.',
    })
  })

  it('selects truthful lifecycle timestamps and permits Score sort only in Active', () => {
    const row = feedRow('Acme', 80, {
      applied_at: '2026-07-23T03:00:00.000Z',
      dismissed_at: '2026-07-24T04:00:00.000Z',
    })
    expect(dashboardLifecycleTimestamp(row, 'active')).toBe('2026-07-22T00:00:00.000Z')
    expect(dashboardLifecycleTimestamp(row, 'applied')).toBe('2026-07-23T03:00:00.000Z')
    expect(dashboardLifecycleTimestamp(row, 'dismissed')).toBe('2026-07-24T04:00:00.000Z')
    expect(dashboardScoreSortAvailable('active')).toBe(true)
    expect(dashboardScoreSortAvailable('applied')).toBe(false)
    expect(dashboardScoreSortAvailable('dismissed')).toBe(false)
  })

  it('retains filters, resets the cursor, fixes review ordering, and restores Active Score sort', () => {
    const active = buildDashboardFeedQuery({
      lifecycle: 'active',
      activeOrder: 'score_asc',
      appliedHiddenKeys: new Set(['acme']),
      selectedTiers: new Set<Tier>(['Strong', 'Weak']),
    })
    const applied = resetDashboardFeedQuery(active, 'applied', 'score_asc')
    expect(applied).toEqual({
      query: {
        lifecycle: 'applied',
        order: 'newest',
        hiddenCompanyKeys: ['acme'],
        tiers: ['Strong', 'Weak'],
      },
      cursor: null,
    })
    expect(resetDashboardFeedQuery(applied.query, 'active', 'score_asc').query.order)
      .toBe('score_asc')
    expect(dashboardFeedQueryKey(active)).not.toEqual(dashboardFeedQueryKey(applied.query))
  })
})

describe('Dashboard paging state', () => {
  const emptyPage = {
    rows: [] as FeedRow[],
    nextCursor: null,
    hasMore: false,
    caughtUp: true,
  }

  it('appends stable cursor pages without duplicates or prior-row reordering', () => {
    const first = feedRow('First', 90, { id: 'first' })
    const duplicate = feedRow('Duplicate', 80, { id: 'duplicate' })
    const next = feedRow('Next', 70, { id: 'next' })
    const current = {
      rows: [first, duplicate],
      nextCursor: 'cursor-1',
      hasMore: true,
      caughtUp: false,
    }
    const incoming = {
      rows: [duplicate, next, next],
      nextCursor: null,
      hasMore: false,
      caughtUp: true,
    }
    expect(appendDashboardFeedPage(current, incoming)).toEqual({
      rows: [first, duplicate, next],
      nextCursor: null,
      hasMore: false,
      caughtUp: true,
      appendedCount: 1,
    })
  })

  it('removes and restores an exact optimistic snapshot at its original position', () => {
    const first = feedRow('First', 90, { id: 'first' })
    const target = feedRow('Target', 80, { id: 'target' })
    const last = feedRow('Last', 70, { id: 'last' })
    const page = { ...emptyPage, rows: [first, target, last], caughtUp: false, hasMore: true }
    const removed = removeDashboardFeedRow(page, 'target')
    expect(removed.page.rows.map(({ id }) => id)).toEqual(['first', 'last'])
    expect(removed.snapshot).toEqual({ row: target, index: 1 })
    expect(restoreDashboardFeedRow(removed.page, removed.snapshot).rows)
      .toEqual([first, target, last])
  })

  it('backfills one eligible row defensively and truthfully marks exhaustion', () => {
    const current = {
      ...emptyPage,
      rows: [feedRow('First', 90, { id: 'first' })],
      nextCursor: 'cursor-1',
      hasMore: true,
      caughtUp: false,
    }
    const replacement = feedRow('Next', 80, { id: 'next' })
    expect(backfillDashboardFeedPage(current, {
      rows: [replacement],
      nextCursor: null,
      hasMore: false,
      caughtUp: true,
    })).toEqual({
      rows: [current.rows[0], replacement],
      nextCursor: null,
      hasMore: false,
      caughtUp: true,
      appendedCount: 1,
    })
    expect(backfillDashboardFeedPage(current, emptyPage)).toMatchObject({
      rows: current.rows,
      nextCursor: null,
      hasMore: false,
      caughtUp: true,
      appendedCount: 0,
    })
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

  it('defines the exact eight-column model without a best-fit resume column', () => {
    const defaults = defaultDashboardColumnWidths()
    expect(DASHBOARD_COLUMNS.map((column) => column.id)).toEqual([
      'new', 'job', 'company', 'location', 'score', 'posted', 'apply', 'action',
    ])
    expect(defaults).toEqual({
      new: 80,
      job: 280,
      company: 200,
      location: 200,
      score: 180,
      posted: 132,
      apply: 96,
      action: 228,
    })
    expect(dashboardTableWidth(defaults)).toBe(1396)
    expect(DASHBOARD_COLUMNS.find(({ id }) => id === 'action')).toMatchObject({
      defaultWidth: 228,
      minWidth: 208,
      maxWidth: 280,
    })
  })

  it('hydrates valid known values and ignores unknown keys', () => {
    const storage = memoryStorage(JSON.stringify({
      version: 2,
      widths: { job: 340, score: 220, invented: 999 },
    }))
    expect(hydrateDashboardColumnWidths(storage)).toMatchObject({ job: 340, score: 220 })
    expect(hydrateDashboardColumnWidths(storage)).not.toHaveProperty('invented')
  })

  it('rejects the legacy 120px Action width under the explicit v2 storage policy', () => {
    const legacy = memoryStorage(JSON.stringify({
      version: 1,
      widths: { action: 120 },
    }))
    expect(hydrateDashboardColumnWidths(legacy).action).toBe(228)
  })

  it.each([
    ['malformed JSON', '{'],
    ['legacy version', JSON.stringify({ version: 1, widths: { action: 120 } })],
    ['wrong version', JSON.stringify({ version: 3, widths: { job: 340 } })],
    ['non-finite width', JSON.stringify({ version: 2, widths: { job: null } })],
    ['below-minimum width', JSON.stringify({ version: 2, widths: { job: 10 } })],
    ['above-maximum width', JSON.stringify({ version: 2, widths: { job: 900 } })],
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

  it('persists only the version and all eight clamped width values', () => {
    const storage = memoryStorage()
    const widths = { ...defaultDashboardColumnWidths(), job: 999, score: Number.NaN }
    persistDashboardColumnWidths(widths, storage)
    const payload = JSON.parse(storage.value ?? '{}')
    expect(Object.keys(payload).sort()).toEqual(['version', 'widths'])
    expect(payload.version).toBe(2)
    expect(Object.keys(payload.widths)).toEqual(DASHBOARD_COLUMNS.map((column) => column.id))
    expect(payload.widths.job).toBe(520)
    expect(payload.widths.score).toBe(180)
    expect(payload.widths.action).toBe(228)
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

import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { FeedRow } from '../lib/feed'
import type { DashboardAppliedApplication } from '../lib/tracker'
import dashboardSource from './Dashboard.tsx?raw'
import resizeHandleSource from '../components/ColumnResizeHandle.tsx?raw'
import {
  DASHBOARD_COLUMN_STORAGE_KEY,
  DASHBOARD_COLUMNS,
  claimColumnResize,
  defaultDashboardColumnWidths,
  hydrateDashboardColumnWidths,
  keyboardResizeWidth,
  persistDashboardColumnWidths,
  releaseColumnResize,
  settleColumnResize,
  type ColumnResizeCoordinator,
  type DashboardColumnStorage,
} from '../lib/dashboardColumns'
import { Dashboard } from './Dashboard'

const row: FeedRow = {
  id: 'user-job-1',
  deterministic_revision: 4,
  deterministic_eligible: true,
  deterministic_score: 42,
  deterministic_tier: 'Weak',
  deterministic_breakdown: [],
  deterministic_filter_code: null,
  deterministic_filter_detail: null,
  deterministic_ranked_at: '2026-07-22T00:00:00.000Z',
  deterministic_best_fit_resume_id: null,
  deterministic_runner_up_resume_id: null,
  resume_route_revision: 1,
  current_resume_route_revision: 2,
  seen_at: null,
  dismissed_at: null,
  applied_at: null,
  jobs: {
    id: 'job-1',
    title: 'Analyst',
    location: 'Chicago, IL',
    absolute_url: 'https://example.com/jobs/1',
    posted_at: '2026-07-22T00:00:00.000Z',
    first_seen_at: '2026-07-22T00:00:00.000Z',
    status: 'open',
    source_company_name: null,
    companies: { name: 'Acme' },
  },
}

const externalRow: FeedRow = {
  ...row,
  id: 'user-job-external',
  deterministic_best_fit_resume_id:
    '22222222-2222-4222-8222-222222222222',
  deterministic_runner_up_resume_id:
    '33333333-3333-4333-8333-333333333333',
  resume_route_revision: 2,
  current_resume_route_revision: 2,
  jobs: {
    ...row.jobs!,
    id: 'job-external',
    title: 'External Analyst',
    source_company_name: 'External Co',
    companies: null,
  },
}

const appliedApplication: DashboardAppliedApplication = {
  applicationId: '11111111-1111-4111-8111-111111111111',
  company: 'Acme',
  title: 'Analyst',
  location: 'Chicago, IL',
  applyUrl: 'https://example.com/jobs/1',
  appliedOn: '2026-07-20',
  currentStage: 'interview',
  currentStageDate: '2026-07-28',
}

vi.mock('../lib/supabase', () => ({ supabase: {} }))

vi.mock('react-router', () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useInfiniteQuery: () => ({
    data: {
      pages: [{
        rows: [row, externalRow],
        nextCursor: 'cursor-1',
        hasMore: true,
        caughtUp: false,
      }],
      pageParams: [null],
    },
    error: null,
    isPending: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }),
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
    if (queryKey[0] === 'preferences') {
      return { data: {}, error: null, isPending: false }
    }
    if (queryKey[0] === 'dashboard-companies') {
      return { data: [{ key: 'acme', label: 'Acme', count: 1 }], error: null, isPending: false }
    }
    if (queryKey[0] === 'ranking-state') {
      return {
        data: {
          activeRevision: 4,
          desiredRevision: 4,
          status: 'idle',
          errorCode: null,
          retryAvailable: false,
          updatedAt: '2026-07-23T00:00:00.000Z',
        },
        error: null,
        isPending: false,
      }
    }
    if (queryKey[0] === 'resumes') {
      return {
        data: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            filename: 'Finance.pdf',
          },
          {
            id: '33333333-3333-4333-8333-333333333333',
            filename: 'Research.pdf',
          },
        ],
        error: null,
        isPending: false,
      }
    }
    if (queryKey[0] === 'dashboard-applied-applications') {
      return { data: [appliedApplication], error: null, isPending: false, refetch: vi.fn() }
    }
    return { data: [], error: null, isPending: false }
  },
  useQueryClient: () => ({
    cancelQueries: vi.fn(),
    getQueriesData: vi.fn(() => []),
    getQueryData: vi.fn(),
    invalidateQueries: vi.fn(),
    refetchQueries: vi.fn(),
    setQueriesData: vi.fn(),
    setQueryData: vi.fn(),
  }),
}))

describe('Dashboard precision controls', () => {
  it('renders Active by default with exclusive lifecycle controls and truthful count copy', () => {
    const markup = renderToStaticMarkup(<Dashboard />)

    expect(markup).not.toContain('All jobs')
    expect(markup).toContain('>Watchlist Jobs</h1>')
    expect(markup).toContain('role="group"')
    expect(markup).toContain('aria-label="Lifecycle view"')
    expect(markup).toMatch(/aria-pressed="false"[^>]*>Show applied<\/button>/)
    expect(markup).not.toContain('Show dismissed')
    expect(markup).toContain(
      'New postings from watched companies ranked against your preferences, newest first.',
    )
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('>Companies</button>')
    expect(markup).toContain('aria-controls="dashboard-score-tier-popover"')
    expect(markup).toContain('Score tiers: All')
    expect(markup).not.toMatch(/aria-pressed="true"[^>]*>Strong<\/button>/)
    expect(markup).not.toMatch(/aria-pressed="true"[^>]*>Good<\/button>/)
    expect(markup).not.toMatch(/aria-pressed="true"[^>]*>Weak<\/button>/)
    expect(markup).toContain('1 active jobs shown')
    expect(markup).toContain('Analyst')
    expect(markup).not.toContain('External Analyst')
  })

  it('preserves the combined feed as the secondary All Jobs view', () => {
    const markup = renderToStaticMarkup(<Dashboard scope="all" />)

    expect(markup).toContain('>All Jobs</h1>')
    expect(markup).toContain('New postings ranked against your preferences, newest first.')
    expect(markup).toContain('2 active jobs shown')
    expect(markup).toContain('Analyst')
    expect(markup).toContain('External Analyst')
  })

  it('keys the server-authoritative paged query by lifecycle, filters, and Active order', () => {
    expect(dashboardSource).not.toContain('viewAll')
    expect(dashboardSource).not.toContain('setViewAll')
    expect(dashboardSource).not.toContain('filterDashboardRows')
    expect(dashboardSource).not.toContain('listFeed,')
    expect(dashboardSource).toContain('useInfiniteQuery')
    expect(dashboardSource).toContain('dashboardFeedQueryKey(feedRequest)')
    expect(dashboardSource).toContain('listFeedPage(feedRequest, pageParam)')
    expect(dashboardSource).toContain('listDashboardCompanyOptions(feedRequest)')
    expect(dashboardSource).toContain("scope === 'watchlist'")
    expect(dashboardSource).toContain('dashboardSourceRows(allRows, scope)')
    expect(dashboardSource).toContain('appliedHiddenKeys')
    expect(dashboardSource).toContain('selectedTiers')
  })

  it('renders Location without restoring a Dashboard reason column', () => {
    const markup = renderToStaticMarkup(<Dashboard />)
    const table = markup.match(/<table[\s\S]*<\/table>/)?.[0] ?? ''

    expect(table).toContain('>Location<div role="separator"')
    expect(table).toContain('Chicago, IL')
    expect(table).not.toContain('Match reason')
  })

  it('uses a separate ranking-state query and preserves the feed through updates and failure', () => {
    expect(dashboardSource).toContain("queryKey: ['ranking-state']")
    expect(dashboardSource).toContain('getDeterministicRankingState')
    expect(dashboardSource).toContain("status === 'building'")
    expect(dashboardSource).toContain('Updating rankings…')
    expect(dashboardSource).toContain(
      'Your current results stay visible until the full update is ready.',
    )
    expect(dashboardSource).toContain(
      'Rankings couldn’t update. Your previous results are still shown.',
    )
    expect(dashboardSource).toContain('Retry update')
    expect(dashboardSource).toContain('Retrying…')
    expect(dashboardSource).toContain('onError: () =>')
    expect(dashboardSource).toContain('Couldn’t retry this ranking update.')
    expect(dashboardSource).toContain('id="ranking-retry-error"')
    expect(dashboardSource).toContain('aria-describedby={retryError')
    expect(dashboardSource).toContain('aria-live="assertive"')
    expect(dashboardSource).toContain(
      'Retry limit reached. Save preferences again to start a new update.',
    )
    expect(dashboardSource).toContain('Rankings updated.')
    expect(dashboardSource).toContain("refetchQueries({ queryKey: ['dashboard-feed'] })")
    expect(dashboardSource).not.toContain('scoreFreshnessLabel')
  })

  it('renders stored deterministic score, tier, and routing fields without browser derivation', () => {
    expect(dashboardSource).toContain('row.deterministic_score')
    expect(dashboardSource).toContain('row.deterministic_tier')
    expect(dashboardSource).toContain('row.deterministic_best_fit_resume_id')
    expect(dashboardSource).toContain('resumeRouteIsCurrent(row)')
    expect(dashboardSource).toContain('<TierBadge tier={row.deterministic_tier}')
    expect(dashboardSource).not.toContain('tierPresentation(row.score)')
    expect(dashboardSource).not.toContain('row.score')
    expect(dashboardSource).not.toContain('row.routed_resume_id')
  })

  it('hides a stale route without hiding its deterministic score', () => {
    const markup = renderToStaticMarkup(<Dashboard />)
    expect(markup).toContain('>42</span>')
    expect(markup).not.toContain('Best fit:')
  })

  it('renders current winner and runner-up labels', () => {
    const markup = renderToStaticMarkup(<Dashboard scope="all" />)
    expect(markup).toContain('Best fit: Finance.pdf')
    expect(markup).toContain('also fits Research.pdf')
  })

  it('pins staged full-list company actions, escape, and exact filter-empty copy', () => {
    expect(dashboardSource).toContain('Search companies')
    expect(dashboardSource).toContain('Search current companies')
    expect(dashboardSource).toContain('Show results')
    expect(dashboardSource).toContain('Clear all')
    expect(dashboardSource).toContain('Select all')
    expect(dashboardSource).not.toContain('>Reset<')
    expect(dashboardSource).toContain('clearAllCompanies(companyOptions)')
    expect(dashboardSource).not.toContain('clearAllCompanies(searchedCompanyOptions)')
    expect(dashboardSource).toContain('selectAllCompanies()')
    expect(dashboardSource).toContain('areAllCurrentCompaniesCleared(')
    expect(dashboardSource).toContain('areAllCurrentCompaniesSelected(')
    expect(dashboardSource).toContain("event.key === 'Escape'")
    expect(dashboardSource).toContain('No jobs match these filters')
    expect(dashboardSource).toContain(
      'Select more companies or score tiers, or use Select all in Companies.',
    )
    expect(dashboardSource).toContain('No companies in the current feed.')
    expect(dashboardSource).toContain('No current companies match your search.')
    expect(dashboardSource).not.toContain('localStorage')
    expect(dashboardSource).not.toContain('savePreferences')
  })

  it('keeps Apply navigation separate from accessible lifecycle actions with no dialog', () => {
    const markup = renderToStaticMarkup(<Dashboard />)
    expect(markup).toContain('aria-label="Apply to Analyst in a new tab"')
    expect(markup).toContain('aria-label="Mark Analyst applied"')
    expect(markup).toContain('>Mark Applied</button>')
    expect(markup).toContain('aria-label="Dismiss Analyst"')
    expect(markup).toContain('>Dismiss</button>')
    expect(dashboardSource).toContain('mutationFn: markJobApplied')
    expect(dashboardSource).toContain('mutationFn: dismissJob')
    expect(dashboardSource).not.toContain('undoJobApplied')
    expect(dashboardSource).not.toContain('Undo applied')
    expect(dashboardSource).not.toContain('Save to tracker')
    expect(dashboardSource).not.toContain('mutationFn: undismissJob')
    expect(dashboardSource).toContain('Dismissed ${context.title} permanently.')
    expect(dashboardSource).not.toMatch(/onClick=\{[^}]*markJobApplied[^}]*\}[\s\S]*Apply/)
    expect(dashboardSource).not.toContain('<dialog')
    expect(dashboardSource).not.toContain('ConfirmDialog')
  })

  it('pins exact optimistic rollback, focus recovery, durable invalidation, and backfill failure isolation', () => {
    expect(dashboardSource).toContain('getQueryData<DashboardInfiniteData>(feedKey)')
    expect(dashboardSource).toContain('setQueryData<DashboardInfiniteData>(feedKey')
    expect(dashboardSource).toContain('previous')
    expect(dashboardSource).toContain('removeRowFromInfiniteData')
    expect(dashboardSource).toContain('if (index >= 0) focusAfterRemoval')
    expect(dashboardSource).toContain('focusAfterRemoval')
    expect(dashboardSource).toContain('tableRegionRef.current?.focus()')
    expect(dashboardSource).toContain('const lifecycleMutationPending =')
    expect(dashboardSource).toContain('role="status"')
    expect(dashboardSource).toContain('aria-live="polite"')
    expect(dashboardSource).toContain(
      '`${context.title} marked applied and added to Tracker.`',
    )
    expect(dashboardSource).toContain(
      "queryKey: ['tracker-application', applicationId]",
    )
    expect(dashboardSource).toContain(
      "queryKey: ['dashboard-applied-applications']",
    )
    expect(dashboardSource).toContain("queryKey: ['tracker-applications']")
    expect(dashboardSource).toContain('backfillDashboardFeedRow')
    expect(dashboardSource).toContain('Couldn’t load the next job. Your current results are still shown.')
    expect(dashboardSource).toContain('Couldn’t mark this job as applied. It remains in Active. Try again.')
  })

  it('pins explicit 200-row continuation, retained-row retries, dedupe, and truthful exhaustion', () => {
    expect(dashboardSource).toContain('fetchNextPage')
    expect(dashboardSource).toContain('cancelRefetch: false')
    expect(dashboardSource).toContain('isFetchingNextPage')
    expect(dashboardSource).toContain('Loading more…')
    expect(dashboardSource).toContain('Load more')
    expect(dashboardSource).toContain("You're all caught up")
    expect(dashboardSource).toContain('Couldn’t load more jobs. Your current results are still shown.')
    expect(dashboardSource).toContain('more jobs loaded.')
    expect(dashboardSource).toContain('mergeDashboardFeedPages')
    expect(dashboardSource).toContain('feedEnabled && !feedQuery.data ? feedQuery.error : null')
    expect(dashboardSource).not.toContain('IntersectionObserver')
    expect(dashboardSource).not.toMatch(/Page \{?\d/)
    expect(dashboardSource).not.toContain('pageNumber')
  })

  it('renders Active lifecycle time semantically and keeps review sorting out of applied history', () => {
    expect(dashboardSource).toContain('dashboardLifecycleTimestamp(row, lifecycle)')
    expect(dashboardSource).toContain('dateTime={timestamp}')
    expect(dashboardSource).toContain('{lifecycleCopy.timeLabel}')
    expect(dashboardSource).toContain("lifecycle === 'active'")
    expect(dashboardSource).toContain('ariaSort={scoreAriaSort}')
    expect(dashboardSource).toContain("const scoreAriaSort = lifecycle === 'active'")
    expect(dashboardSource).not.toContain('Undo applied')
    expect(dashboardSource).not.toContain('Restore')
  })

  it('loads tracker-backed applied history and pins the exact eight-field contract', () => {
    expect(appliedApplication).toEqual({
      applicationId: '11111111-1111-4111-8111-111111111111',
      company: 'Acme',
      title: 'Analyst',
      location: 'Chicago, IL',
      applyUrl: 'https://example.com/jobs/1',
      appliedOn: '2026-07-20',
      currentStage: 'interview',
      currentStageDate: '2026-07-28',
    })
    expect(dashboardSource).toContain('listDashboardAppliedApplications')
    expect(dashboardSource).toContain("queryKey: ['dashboard-applied-applications']")
    expect(dashboardSource).toContain("enabled: lifecycle === 'applied'")
    expect(dashboardSource).toContain('application.appliedOn')
    expect(dashboardSource).not.toContain('application.currentStageDate}</time>')
    expect(dashboardSource).not.toMatch(/appliedOn\s*:\s*application\.currentStageDate/)
  })

  it('renders exactly seven applied snapshot columns and the shared stage treatment', () => {
    const appliedTableSource = dashboardSource.match(
      /function AppliedApplicationsTable[\s\S]*?\n}\n\ninterface DashboardProps/,
    )?.[0] ?? ''

    for (const header of [
      'Position',
      'Company',
      'Location',
      'Applied date',
      'Current stage',
      'Apply link',
      'Tracker link',
    ]) {
      expect(appliedTableSource).toContain(`>${header}</th>`)
    }
    expect(appliedTableSource.match(/scope="col"/g)).toHaveLength(7)
    expect(appliedTableSource).toContain('TRACKER_STAGE_PRESENTATION')
    expect(appliedTableSource).toContain('application.currentStage')
    expect(appliedTableSource).toContain('View in Tracker')
    expect(appliedTableSource).toContain(
      '`/tracker?application=${encodeURIComponent(application.applicationId)}`',
    )
    expect(appliedTableSource).not.toContain('deterministic_score')
    expect(appliedTableSource).not.toContain('deterministic_tier')
    expect(appliedTableSource).not.toContain('bestFit')
    expect(appliedTableSource).not.toContain('jobs.status')
  })

  it('uses one native score checkbox group with immediate zero-to-three tier state', () => {
    expect(dashboardSource).toContain('scoreTierSummary(selectedTiers)')
    expect(dashboardSource).toContain('id="dashboard-score-tier-popover"')
    expect(dashboardSource).toContain('<fieldset')
    expect(dashboardSource).toContain('<legend')
    expect(dashboardSource).toContain('type="checkbox"')
    expect(dashboardSource).toContain('ALL_SCORE_TIERS.map((tier)')
    expect(dashboardSource).toContain('toggleScoreTier(current, tier)')
    expect(dashboardSource).toContain('min-w-[220px]')
    expect(dashboardSource).toContain('min-h-11')
    expect(dashboardSource).not.toContain('aria-pressed={selected}')
  })

  it('pins mutual exclusion, escape focus return, and outside-pointer listener cleanup', () => {
    expect(dashboardSource).toContain('setScoreTierPopoverOpen(false)')
    expect(dashboardSource).toContain('setCompanyPanelOpen(false)')
    expect(dashboardSource).toContain('scoreTierTriggerRef.current?.focus()')
    expect(dashboardSource).toContain('firstScoreTierCheckboxRef.current?.focus()')
    expect(dashboardSource).toContain("document.addEventListener('pointerdown'")
    expect(dashboardSource).toContain("document.removeEventListener('pointerdown'")
    expect(dashboardSource).toContain('scoreTierPopoverRef.current?.contains(target)')
    expect(dashboardSource).toContain('scoreTierTriggerRef.current?.contains(target)')
  })

  it('renders fixed colgroup widths and accessible separators except after Action', () => {
    const markup = renderToStaticMarkup(<Dashboard />)
    const separators = markup.match(/role="separator"/g) ?? []

    expect(markup).toContain('<col style="width:80px"/>')
    expect(markup).toContain('<col style="width:280px"/>')
    expect(markup).toContain('<col style="width:228px"/>')
    expect(markup).toContain('style="min-width:1616px"')
    expect(separators).toHaveLength(8)
    expect(markup).toContain('aria-label="Resize New column"')
    expect(markup).toContain('aria-label="Resize Score column"')
    expect(markup).not.toContain('aria-label="Resize Action column"')
    expect(markup).toContain('aria-orientation="vertical"')
    expect(markup).toContain('aria-valuemin="150"')
    expect(markup).toContain('aria-valuemax="260"')
    expect(markup).toContain('aria-valuenow="180"')
    expect(dashboardSource).toContain('useState(loadDashboardColumnWidths)')
    expect(dashboardSource).not.toContain('resetDashboardColumn')
  })

  it('keeps Score sorting separate from resizing and preserves responsive scrolling', () => {
    const markup = renderToStaticMarkup(<Dashboard />)
    const scoreHeader = markup.match(/<th[^>]*aria-sort="none"[\s\S]*?<\/th>/)?.[0] ?? ''

    expect(scoreHeader).toContain('<button type="button"')
    expect(scoreHeader).toContain('Score')
    expect(scoreHeader).toContain('aria-label="Resize Score column"')
    expect(markup).toContain('overflow-x-auto')
    expect(markup).toContain('tabindex="0"')
    expect(markup).toContain('Job matches; scroll horizontally to view all columns')
    expect(resizeHandleSource).toContain('event.stopPropagation()')
  })

  it('pins pointer capture, cancellation cleanup, keyboard resize, and coarse hit areas', () => {
    expect(resizeHandleSource).toContain('setPointerCapture')
    expect(resizeHandleSource).toContain('releasePointerCapture')
    expect(resizeHandleSource).toContain('event.button')
    expect(resizeHandleSource).toContain('claimColumnResize(coordinator, column.id')
    expect(resizeHandleSource).toContain('onPointerCancel')
    expect(resizeHandleSource).toContain('settleColumnResize(drag.startWidth, drag.latestWidth, commit)')
    expect(resizeHandleSource).toContain('coordinator.activeColumnId !== null')
    expect(resizeHandleSource).toContain("document.body.style.userSelect = 'none'")
    expect(resizeHandleSource).toContain('document.body.style.userSelect = drag.previousUserSelect')
    expect(resizeHandleSource).toContain('document.body.style.cursor = drag.previousCursor')
    expect(resizeHandleSource).toContain('[@media(pointer:coarse)]:w-11')
  })

  it('rejects right-click and coordinates one pointer drag across all column handles', () => {
    const coordinator: ColumnResizeCoordinator = { activeColumnId: null }

    expect(claimColumnResize(coordinator, 'job', true, 2)).toBe(false)
    expect(coordinator.activeColumnId).toBeNull()
    expect(claimColumnResize(coordinator, 'job', true, 0)).toBe(true)
    expect(claimColumnResize(coordinator, 'company', true, 0)).toBe(false)
    expect(coordinator.activeColumnId).toBe('job')
    const companyColumn = DASHBOARD_COLUMNS.find((column) => column.id === 'company')!
    expect(
      keyboardResizeWidth(
        companyColumn,
        companyColumn.defaultWidth,
        'ArrowRight',
        false,
        coordinator.activeColumnId !== null,
      ),
    ).toBeNull()

    releaseColumnResize(coordinator, 'company')
    expect(coordinator.activeColumnId).toBe('job')
    releaseColumnResize(coordinator, 'job')
    expect(coordinator.activeColumnId).toBeNull()
    expect(claimColumnResize(coordinator, 'company', true, 0)).toBe(true)
  })

  it('keeps rendered and persisted widths aligned when a dragged handle receives a resize key then cancels', () => {
    const storage: DashboardColumnStorage & { value: string | null } = {
      value: null,
      getItem(key) {
        expect(key).toBe(DASHBOARD_COLUMN_STORAGE_KEY)
        return this.value
      },
      setItem(key, value) {
        expect(key).toBe(DASHBOARD_COLUMN_STORAGE_KEY)
        this.value = value
      },
    }
    const jobColumn = DASHBOARD_COLUMNS.find((column) => column.id === 'job')!
    const widths = defaultDashboardColumnWidths()
    persistDashboardColumnWidths(widths, storage)

    const pointerStartWidth = widths.job
    const pointerLatestWidth = 340
    let renderedWidth = pointerLatestWidth
    const keyboardWidth = keyboardResizeWidth(
      jobColumn,
      renderedWidth,
      'ArrowRight',
      false,
      true,
    )
    if (keyboardWidth !== null) {
      renderedWidth = keyboardWidth
      widths.job = keyboardWidth
      persistDashboardColumnWidths(widths, storage)
    }

    const cancelled = settleColumnResize(pointerStartWidth, pointerLatestWidth, false)
    renderedWidth = cancelled.width
    if (cancelled.persist) {
      widths.job = cancelled.width
      persistDashboardColumnWidths(widths, storage)
    }

    expect(keyboardWidth).toBeNull()
    expect(cancelled).toEqual({ width: pointerStartWidth, persist: false })
    expect(renderedWidth).toBe(hydrateDashboardColumnWidths(storage).job)
  })
})

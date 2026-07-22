import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { FeedRow } from '../lib/feed'
import dashboardSource from './Dashboard.tsx?raw'
import jobDetailSource from './JobDetail.tsx?raw'
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
  status: 'scored',
  filter_reason: null,
  filter_detail: null,
  score: 42,
  tier: 'Weak',
  reasons: ['Entry-level scope'],
  routed_resume_id: null,
  runner_up_resume_id: null,
  scored_at: '2026-07-22T00:00:00.000Z',
  needs_refilter: false,
  score_deferred_until: null,
  seen_at: null,
  dismissed_at: null,
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

vi.mock('../lib/supabase', () => ({ supabase: {} }))

vi.mock('react-router', () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === 'feed') {
      return { data: [row], error: null, isPending: false, refetch: vi.fn() }
    }
    if (queryKey[0] === 'preferences') {
      return { data: {}, error: null, isPending: false }
    }
    return { data: [], error: null, isPending: false }
  },
  useQueryClient: () => ({
    cancelQueries: vi.fn(),
    getQueryData: vi.fn(),
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
  }),
}))

describe('Dashboard precision controls', () => {
  it('shows every score tier selected and keeps Weak rows reachable on first render', () => {
    const markup = renderToStaticMarkup(<Dashboard />)

    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('>Companies</button>')
    expect(markup).toMatch(/aria-pressed="true"[^>]*>Strong<\/button>/)
    expect(markup).toMatch(/aria-pressed="true"[^>]*>Good<\/button>/)
    expect(markup).toMatch(/aria-pressed="true"[^>]*>Weak<\/button>/)
    expect(markup).toContain('1 jobs shown')
    expect(markup).toContain('Analyst')
  })

  it('renders Location in the list and preserves Match reasons only on detail', () => {
    const markup = renderToStaticMarkup(<Dashboard />)
    const table = markup.match(/<table[\s\S]*<\/table>/)?.[0] ?? ''

    expect(table).toContain('>Location<div role="separator"')
    expect(table).toContain('Chicago, IL')
    expect(table).not.toContain('Match reason')
    expect(jobDetailSource).toContain('Match reasons')
  })

  it('pins staged company search, apply, reset, escape, and filter-empty copy', () => {
    expect(dashboardSource).toContain('Search companies')
    expect(dashboardSource).toContain('Search current companies')
    expect(dashboardSource).toContain('Show results')
    expect(dashboardSource).toContain('Reset')
    expect(dashboardSource).toContain("event.key === 'Escape'")
    expect(dashboardSource).toContain('No jobs match these filters')
    expect(dashboardSource).toContain('No current companies match your search.')
    expect(dashboardSource).not.toContain('localStorage')
    expect(dashboardSource).not.toContain('savePreferences')
  })

  it('renders fixed colgroup widths and accessible separators except after Action', () => {
    const markup = renderToStaticMarkup(<Dashboard />)
    const separators = markup.match(/role="separator"/g) ?? []

    expect(markup).toContain('<col style="width:80px"/>')
    expect(markup).toContain('<col style="width:280px"/>')
    expect(markup).toContain('<col style="width:120px"/>')
    expect(markup).toContain('style="min-width:1508px"')
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
    expect(resizeHandleSource).toContain('activeDrag.current !== null')
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

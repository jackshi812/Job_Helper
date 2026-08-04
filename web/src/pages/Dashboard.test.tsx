import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InfiniteData } from '@tanstack/react-query'
import {
  encodeDashboardFeedCursor,
  type DashboardFeedCursor,
  type DashboardFeedPage,
  type DashboardFeedQuery,
  type FeedRow,
} from '../lib/feed'
import type { DashboardAppliedApplication } from '../lib/tracker'
import { dashboardFeedQueryKey } from '../lib/dashboard'
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
import {
  Dashboard,
  createDashboardHeadRefreshCoordinator,
  filterDashboardInfiniteDataRows,
  filterDismissedFeedRows,
  refreshDashboardFeedHead,
  replaceDashboardFeedHead,
  retryDashboardFeed,
  restoreDismissedRowInInfiniteData,
} from './Dashboard'

const supabaseRpc = vi.hoisted(() => vi.fn())
const reactQueryHarness = vi.hoisted(() => ({
  mutationOptions: new Map<string, unknown>(),
  feedRefetch: vi.fn(),
  queryClient: {
    cancelQueries: vi.fn(),
    getQueriesData: vi.fn(),
    getQueryData: vi.fn(),
    invalidateQueries: vi.fn(),
    refetchQueries: vi.fn(),
    setQueriesData: vi.fn(),
    setQueryData: vi.fn(),
  },
}))

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

const secondRow: FeedRow = {
  ...row,
  id: 'user-job-2',
  jobs: {
    ...row.jobs!,
    id: 'job-2',
    title: 'Associate',
    absolute_url: 'https://example.com/jobs/2',
  },
}

const thirdRow: FeedRow = {
  ...row,
  id: 'user-job-3',
  jobs: {
    ...row.jobs!,
    id: 'job-3',
    title: 'Senior Analyst',
    absolute_url: 'https://example.com/jobs/3',
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
  hasWatchedCompany: true,
}

const externalAppliedApplication: DashboardAppliedApplication = {
  ...appliedApplication,
  applicationId: '22222222-2222-4222-8222-222222222222',
  company: 'External Co',
  title: 'External Applied Analyst',
  applyUrl: 'https://example.com/jobs/external',
  hasWatchedCompany: false,
}

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: supabaseRpc,
  },
}))

vi.mock('react-router', () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: (options: { mutationFn: { name?: string } }) => {
    reactQueryHarness.mutationOptions.set(options.mutationFn.name ?? 'anonymous', options)
    return {
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      isError: false,
    }
  },
  useInfiniteQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
    const scopedRows = queryKey[3] === 'watchlist' ? [row] : [row, externalRow]
    return {
      data: {
        pages: [{
          rows: scopedRows,
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
      refetch: reactQueryHarness.feedRefetch,
    }
  },
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
    if (queryKey[0] === 'dashboard-applied-applications') {
      return {
        data: [appliedApplication, externalAppliedApplication],
        error: null,
        isPending: false,
        refetch: vi.fn(),
      }
    }
    return { data: [], error: null, isPending: false }
  },
  useQueryClient: () => reactQueryHarness.queryClient,
}))

type DashboardData = InfiniteData<DashboardFeedPage, string | null>

interface DismissMutationOptions {
  onMutate: (rowId: string) => unknown
  onError: (error: Error, rowId: string, context: unknown) => void
  onSuccess: (data: void, rowId: string, context: unknown) => unknown
  onSettled?: () => unknown
}

interface MarkAppliedMutationOptions {
  onMutate: (rowId: string) => Promise<unknown>
  onError: (error: Error, rowId: string, context: unknown) => void
  onSuccess: (applicationId: string, rowId: string, context: unknown) => unknown
}

function dashboardData(pages: FeedRow[][]): DashboardData {
  return {
    pages: pages.map((rows, index) => ({
      rows,
      nextCursor: index === pages.length - 1 ? 'cursor-next' : `cursor-${index + 1}`,
      hasMore: true,
      caughtUp: false,
    })),
    pageParams: pages.map((_rows, index) => index === 0 ? null : `cursor-${index}`),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function dismissMutationOptions(scope: 'all' | 'watchlist' = 'all'): DismissMutationOptions {
  renderToStaticMarkup(<Dashboard scope={scope} />)
  const options = reactQueryHarness.mutationOptions.get('dismissJob')
  if (!options) throw new Error('dismiss mutation options were not captured')
  return options as DismissMutationOptions
}

function markAppliedMutationOptions(
  scope: 'all' | 'watchlist' = 'all',
): MarkAppliedMutationOptions {
  renderToStaticMarkup(<Dashboard scope={scope} />)
  const options = reactQueryHarness.mutationOptions.get('markJobApplied')
  if (!options) throw new Error('mark applied mutation options were not captured')
  return options as MarkAppliedMutationOptions
}

beforeEach(() => {
  supabaseRpc.mockReset()
  supabaseRpc.mockResolvedValue({ data: [], error: null })
  reactQueryHarness.mutationOptions.clear()
  reactQueryHarness.feedRefetch.mockReset()
  reactQueryHarness.feedRefetch.mockResolvedValue({ isError: false })
  for (const mock of Object.values(reactQueryHarness.queryClient)) mock.mockReset()
  reactQueryHarness.queryClient.cancelQueries.mockResolvedValue(undefined)
  reactQueryHarness.queryClient.getQueriesData.mockReturnValue([])
  reactQueryHarness.queryClient.invalidateQueries.mockResolvedValue(undefined)
  reactQueryHarness.queryClient.refetchQueries.mockResolvedValue(undefined)
})

describe('Dashboard refresh paths', () => {
  it.each(['interval', 'focus', 'ranking'])(
    '%s refresh requests and replaces only the cached head',
    async () => {
      const original = dashboardData([[row], [secondRow], [thirdRow]])
      const nextHead = {
        ...original.pages[0],
        rows: [{ ...row, deterministic_score: 99 }],
      }
      let cache: DashboardData | undefined = original
      const loadHead = vi.fn().mockResolvedValue(nextHead)
      const setData = vi.fn((
        updater: (current: DashboardData | undefined) => DashboardData | undefined,
      ) => {
        cache = updater(cache)
      })

      await refreshDashboardFeedHead(loadHead, setData)

      expect(loadHead).toHaveBeenCalledTimes(1)
      expect(cache?.pages[0]).toBe(nextHead)
      expect(cache?.pages[1]).toBe(original.pages[1])
      expect(cache?.pages[2]).toBe(original.pages[2])
      expect(cache?.pageParams).toBe(original.pageParams)
      expect(reactQueryHarness.feedRefetch).not.toHaveBeenCalled()
    },
  )

  it('retains the complete cache when a background head request fails', async () => {
    const original = dashboardData([[row], [secondRow], [thirdRow]])
    const setData = vi.fn()

    await expect(refreshDashboardFeedHead(
      vi.fn().mockRejectedValue(new Error('offline')),
      setData,
    )).resolves.toBeUndefined()

    expect(setData).not.toHaveBeenCalled()
    expect(replaceDashboardFeedHead(undefined, original.pages[0])).toBeUndefined()
  })

  it('preserves a committed seen timestamp when an older head response settles later', async () => {
    const original = dashboardData([[row], [secondRow]])
    const staleHead = deferred<DashboardFeedPage>()
    const seenAt = '2026-08-04T03:30:00.000Z'
    let cache: DashboardData | undefined = original
    const refresh = refreshDashboardFeedHead(
      () => staleHead.promise,
      (updater) => {
        cache = updater(cache)
      },
    )

    cache = {
      ...original,
      pages: [{
        ...original.pages[0],
        rows: [{ ...row, seen_at: seenAt }],
      }, ...original.pages.slice(1)],
    }
    staleHead.resolve({
      ...original.pages[0],
      rows: [{ ...row, deterministic_score: 99, seen_at: null }],
    })
    await refresh

    expect(cache?.pages[0].rows[0]).toEqual(expect.objectContaining({
      deterministic_score: 99,
      id: row.id,
      seen_at: seenAt,
    }))
    expect(cache?.pages[1]).toBe(original.pages[1])
  })

  it('accepts only the newest head generation and filters pending or applied rows', async () => {
    const original = dashboardData([[row], [secondRow], [thirdRow]])
    const interval = deferred<DashboardFeedPage>()
    const focus = deferred<DashboardFeedPage>()
    const ranking = deferred<DashboardFeedPage>()
    const coordinator = createDashboardHeadRefreshCoordinator()
    const excludedIds = new Set<string>([secondRow.id])
    let cache: DashboardData | undefined = original
    const setData = (
      updater: (current: DashboardData | undefined) => DashboardData | undefined,
    ) => {
      cache = updater(cache)
    }
    const options = {
      coordinator,
      feedIdentity: 'active-watchlist',
      excludedIds: () => excludedIds,
    }
    const intervalRefresh = refreshDashboardFeedHead(
      () => interval.promise,
      setData,
      options,
    )
    const focusRefresh = refreshDashboardFeedHead(() => focus.promise, setData, options)
    const rankingRefresh = refreshDashboardFeedHead(() => ranking.promise, setData, options)

    ranking.resolve({ ...original.pages[0], rows: [secondRow, thirdRow] })
    await rankingRefresh
    focus.resolve({ ...original.pages[0], rows: [{ ...row, deterministic_score: 70 }] })
    interval.resolve({ ...original.pages[0], rows: [{ ...row, deterministic_score: 60 }] })
    await Promise.all([intervalRefresh, focusRefresh])

    expect(cache?.pages[0].rows).toEqual([thirdRow])
    expect(cache?.pages.slice(1)).toEqual(original.pages.slice(1))
  })

  it('manual Retry invokes the full infinite-query refetch only', async () => {
    const refetch = vi.fn().mockResolvedValue({ isError: false })
    const headRefresh = vi.fn()

    await retryDashboardFeed(refetch)

    expect(refetch).toHaveBeenCalledTimes(1)
    expect(headRefresh).not.toHaveBeenCalled()
  })

  it('disables default interval/focus refetch and wires all automatic triggers to the head loader', () => {
    expect(dashboardSource).toContain('refetchOnWindowFocus: false')
    expect(dashboardSource).not.toContain('refetchInterval: 60_000')
    expect(dashboardSource).toContain('window.setInterval')
    expect(dashboardSource).toContain("window.addEventListener('focus'")
    expect(dashboardSource).toContain('void refreshFeedHead()')
    expect(dashboardSource).not.toContain("refetchQueries({ queryKey: ['dashboard-feed'] })")
  })
})

describe('Dashboard dismissal transaction', () => {
  it('removes the exact card synchronously before unresolved query cancellation', () => {
    let cache = dashboardData([[row, secondRow], [thirdRow]])
    let releaseCancellation!: () => void
    const cancellation = new Promise<void>((resolve) => {
      releaseCancellation = resolve
    })
    reactQueryHarness.queryClient.getQueryData.mockImplementation(() => cache)
    reactQueryHarness.queryClient.setQueryData.mockImplementation(
      (_key, updater: (current: DashboardData) => DashboardData) => {
        cache = updater(cache)
      },
    )
    reactQueryHarness.queryClient.cancelQueries.mockReturnValue(cancellation)
    const mutation = dismissMutationOptions()

    const startedAt = performance.now()
    const context = mutation.onMutate(secondRow.id) as Record<string, unknown>
    const elapsed = performance.now() - startedAt

    expect(context).not.toBeInstanceOf(Promise)
    expect(elapsed).toBeLessThan(100)
    expect(cache.pages.flatMap(({ rows }) => rows.map(({ id }) => id))).toEqual([
      row.id,
      thirdRow.id,
    ])
    expect(context).toMatchObject({
      removedRow: secondRow,
      pageIndex: 0,
      rowIndex: 1,
      title: 'Associate',
      continuationCursor: 'cursor-next',
      nextFocusId: thirdRow.id,
      previousFocusId: row.id,
    })
    expect(
      reactQueryHarness.queryClient.setQueryData.mock.invocationCallOrder[0],
    ).toBeLessThan(
      reactQueryHarness.queryClient.cancelQueries.mock.invocationCallOrder[0],
    )

    releaseCancellation()
  })

  it('rolls back only the failed card while preserving concurrent cache changes', () => {
    let cache = dashboardData([[row, secondRow], [thirdRow]])
    reactQueryHarness.queryClient.getQueryData.mockImplementation(() => cache)
    reactQueryHarness.queryClient.setQueryData.mockImplementation(
      (_key, updater: (current: DashboardData) => DashboardData) => {
        cache = updater(cache)
      },
    )
    const mutation = dismissMutationOptions()
    const context = mutation.onMutate(secondRow.id)
    const concurrentRow = {
      ...thirdRow,
      id: 'user-job-concurrent',
      jobs: { ...thirdRow.jobs!, id: 'job-concurrent', title: 'Concurrent role' },
    }
    cache = {
      ...cache,
      pages: cache.pages.map((page, index) => index === 1
        ? { ...page, rows: [...page.rows, concurrentRow] }
        : page),
    }

    mutation.onError(new Error('rpc failed'), secondRow.id, context)

    expect(cache.pages[0].rows.map(({ id }) => id)).toEqual([row.id, secondRow.id])
    expect(cache.pages[1].rows.map(({ id }) => id)).toEqual([
      thirdRow.id,
      concurrentRow.id,
    ])
    expect(
      cache.pages.flatMap(({ rows }) => rows).filter(({ id }) => id === secondRow.id),
    ).toHaveLength(1)
  })

  it('restores into the nearest surviving page and keeps session-excluded IDs hidden', () => {
    const original = dashboardData([[row], [secondRow, thirdRow]])
    const context = {
      removedRow: secondRow,
      pageIndex: 1,
      rowIndex: 0,
      title: 'Associate',
      continuationCursor: 'cursor-next',
      nextFocusId: thirdRow.id,
      previousFocusId: row.id,
    }
    const current = dashboardData([[row, thirdRow]])

    const restored = restoreDismissedRowInInfiniteData(current, context)

    expect(original.pages[1].rows[0]).toBe(secondRow)
    expect(restored?.pages[0].rows.map(({ id }) => id)).toEqual([
      secondRow.id,
      row.id,
      thirdRow.id,
    ])
    expect(filterDismissedFeedRows(restored!.pages[0].rows, new Set([secondRow.id])))
      .toEqual([row, thirdRow])
  })

  it('scopes pending state and restored focus to Dismiss without gating other controls', () => {
    expect(dashboardSource).toContain('dismissPendingIds.has(row.id)')
    expect(dashboardSource).toContain('markAppliedPendingIds.has(row.id)')
    expect(dashboardSource).not.toContain('const lifecycleMutationPending =')
    expect(dashboardSource).toContain('dismissActionRefs.current.set(row.id, node)')
    expect(dashboardSource).toContain('restoredDismissFocusIdRef')
    expect(dashboardSource).toContain('Couldn’t dismiss ${context.title}.')
  })
})

describe('Dashboard dismissal settlement', () => {
  it('settles at RPC success while watchlist refill and invalidation remain unresolved', async () => {
    let resolveRefill!: () => void
    const refill = new Promise<void>((resolve) => {
      resolveRefill = resolve
    })
    let resolveInvalidation!: () => void
    const invalidation = new Promise<void>((resolve) => {
      resolveInvalidation = resolve
    })
    reactQueryHarness.queryClient.refetchQueries.mockReturnValue(refill)
    reactQueryHarness.queryClient.invalidateQueries.mockReturnValue(invalidation)
    const mutation = dismissMutationOptions('watchlist')
    const feedRequest: DashboardFeedQuery = {
      lifecycle: 'active',
      order: 'newest',
      sourceScope: 'watchlist',
      tiers: ['Strong', 'Good', 'Weak'],
      hiddenCompanyKeys: [],
    }
    const context = {
      removedRow: row,
      pageIndex: 0,
      rowIndex: 0,
      title: 'Analyst',
      continuationCursor: 'cursor-next',
      nextFocusId: secondRow.id,
      previousFocusId: null,
      feedKey: dashboardFeedQueryKey(feedRequest),
      feedRequest,
      lifecycle: 'active',
      scope: 'watchlist',
    }

    const result = mutation.onSuccess(undefined, row.id, context)
    const refillStartedBeforeRelease =
      reactQueryHarness.queryClient.refetchQueries.mock.calls.length === 1
    const invalidationStartedBeforeRelease =
      reactQueryHarness.queryClient.invalidateQueries.mock.calls.some(([options]) =>
        (options as { refetchType?: string }).refetchType === 'inactive')

    resolveRefill()
    resolveInvalidation()
    if (result instanceof Promise) await result

    expect(result).toBeUndefined()
    expect(refillStartedBeforeRelease).toBe(true)
    expect(invalidationStartedBeforeRelease).toBe(true)
  })

  it('launches durable success state before detached work and removes dismiss onSettled', () => {
    const dismissSource = dashboardSource.match(
      /const dismissMutation = useMutation\([\s\S]*?\n  const markAppliedMutation/,
    )?.[0] ?? ''
    const pendingClear = dismissSource.indexOf('setDismissPendingIds')
    const announcement = dismissSource.indexOf('setQueueAnnouncement')
    const detachedRefill = dismissSource.indexOf('void refillVisibleQueue')

    expect(dismissSource).toContain('onSuccess: (_data, id, context) =>')
    expect(dismissSource).not.toContain('onSuccess: async')
    expect(dismissSource).not.toContain('onSettled:')
    expect(pendingClear).toBeGreaterThanOrEqual(0)
    expect(announcement).toBeGreaterThan(pendingClear)
    expect(detachedRefill).toBeGreaterThan(announcement)
  })

  it('keeps refill failures retryable only in their originating feed', () => {
    expect(dashboardSource).toContain("scope: 'all'")
    expect(dashboardSource).toContain("scope: 'watchlist'")
    expect(dashboardSource).toContain(
      'The job remains dismissed and your current results remain usable.',
    )
    expect(dashboardSource).toContain(
      'void refillVisibleQueue(visibleBackfillFailure.retry)',
    )
    expect(dashboardSource).toContain(
      'backfillFailures.get(feedKeyIdentity(feedKey))',
    )
    expect(dashboardSource).toContain('setBackfillFailures((current) => {')
    expect(dashboardSource).toContain('next.delete(targetIdentity)')
    expect(dashboardSource).toContain('next.set(targetIdentity, {')
  })
})

describe('Dashboard Mark Applied settlement', () => {
  it('restores the failed row in place and keeps the existing error copy', async () => {
    const original = dashboardData([[row, secondRow], [thirdRow]])
    let cache = original
    reactQueryHarness.queryClient.getQueryData.mockImplementation(() => cache)
    reactQueryHarness.queryClient.setQueryData.mockImplementation(
      (_key, value: DashboardData | ((current: DashboardData) => DashboardData)) => {
        cache = typeof value === 'function' ? value(cache) : value
      },
    )
    const mutation = markAppliedMutationOptions()

    const context = await mutation.onMutate(secondRow.id)
    expect(cache.pages.flatMap(({ rows }) => rows)).not.toContain(secondRow)

    mutation.onError(new Error('rpc failed'), secondRow.id, context)

    expect(cache).toStrictEqual(original)
    expect(cache).not.toBe(original)
    expect(dashboardSource).toContain(
      'Couldn’t mark this job as applied. It remains in Active. Try again.',
    )
  })

  it('keeps a successful concurrent removal and unrelated cache additions when another row fails', async () => {
    let cache = dashboardData([[row, secondRow], [thirdRow]])
    cache.pages[1] = { ...cache.pages[1], nextCursor: null, hasMore: false, caughtUp: true }
    reactQueryHarness.queryClient.getQueryData.mockImplementation(() => cache)
    reactQueryHarness.queryClient.setQueryData.mockImplementation(
      (_key, value: DashboardData | ((current: DashboardData) => DashboardData)) => {
        cache = typeof value === 'function' ? value(cache) : value
      },
    )
    const mutation = markAppliedMutationOptions()
    const firstContext = await mutation.onMutate(row.id)
    const secondContext = await mutation.onMutate(secondRow.id)
    const concurrentRow = {
      ...thirdRow,
      id: 'user-job-concurrent-applied',
      jobs: { ...thirdRow.jobs!, id: 'job-concurrent-applied', title: 'Concurrent role' },
    }
    cache = {
      ...cache,
      pages: cache.pages.map((page, index) => index === 1
        ? { ...page, rows: [...page.rows, concurrentRow] }
        : page),
    }

    mutation.onSuccess(
      '11111111-1111-4111-8111-111111111111',
      secondRow.id,
      secondContext,
    )
    mutation.onError(new Error('first failed'), row.id, firstContext)

    expect(cache.pages.flatMap(({ rows }) => rows.map(({ id }) => id))).toEqual([
      row.id,
      thirdRow.id,
      concurrentRow.id,
    ])
  })

  it.each(['all', 'watchlist'] as const)(
    'settles immediately with at most one cursor backfill for %s scope',
    async (scope) => {
      const original = dashboardData([[row], [secondRow], [thirdRow]])
      const feedRequest: DashboardFeedQuery = {
        lifecycle: 'active',
        order: 'newest',
        sourceScope: scope,
        tiers: ['Strong', 'Good', 'Weak'],
        hiddenCompanyKeys: [],
      }
      const continuation: DashboardFeedCursor = {
        v: 1,
        lifecycle: 'active',
        order: 'newest',
        signature: 'ignored-by-encoder',
        id: '00000000-0000-4000-8000-000000000000',
        posted_at: '2026-07-22T00:00:00.000Z',
        first_seen_at: '2026-07-22T00:00:00.000Z',
        score: 42,
        lifecycle_at: null,
      }
      const encodedCursor = encodeDashboardFeedCursor(continuation, feedRequest)
      original.pages[2] = { ...original.pages[2], nextCursor: encodedCursor }
      let cache = original
      reactQueryHarness.queryClient.getQueryData.mockImplementation(() => cache)
      reactQueryHarness.queryClient.setQueryData.mockImplementation(
        (_key, value: DashboardData | ((current: DashboardData) => DashboardData)) => {
          cache = typeof value === 'function' ? value(cache) : value
        },
      )
      reactQueryHarness.queryClient.invalidateQueries.mockReturnValue(
        new Promise<void>(() => undefined),
      )
      const mutation = markAppliedMutationOptions(scope)
      const context = await mutation.onMutate(row.id)
      expect(context).toMatchObject({ continuationCursor: encodedCursor })

      const result = mutation.onSuccess(
        '11111111-1111-4111-8111-111111111111',
        row.id,
        context,
      )

      expect(result).toBeUndefined()
      expect(supabaseRpc).toHaveBeenCalledTimes(1)
      expect(supabaseRpc).toHaveBeenCalledWith(
        'dashboard_feed_page_v2',
        expect.objectContaining({
          p_cursor: expect.objectContaining({ id: continuation.id }),
          p_limit: 1,
          p_source_scope: scope,
        }),
      )
      expect(
        reactQueryHarness.queryClient.invalidateQueries.mock.calls.some(([options]) =>
          (options as { queryKey?: readonly unknown[] }).queryKey?.length !== 1
          && (options as { queryKey?: readonly unknown[] }).queryKey?.[0] === 'dashboard-feed'),
      ).toBe(false)
      expect(dashboardSource).toContain("refetchType: 'inactive'")
    },
  )

  it('adds row-local pending state before the optimistic cache removal', () => {
    const markAppliedSource = dashboardSource.match(
      /const markAppliedMutation = useMutation\([\s\S]*?\n  const companyOptions/,
    )?.[0] ?? ''

    expect(markAppliedSource.indexOf('setMarkAppliedPendingIds')).toBeLessThan(
      markAppliedSource.indexOf('snapshotAndRemove(captureLifecycleTarget(), id)'),
    )
    expect(markAppliedSource).toContain('next.delete(id)')
    expect(dashboardSource).toContain('disabled={markAppliedPendingIds.has(row.id)}')
  })
})

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
    expect(dashboardSource).toContain('sourceScope: scope')
    expect(dashboardSource).toContain("scope === 'watchlist'")
    expect(dashboardSource).toContain('filterDismissedFeedRows(allRows, hiddenLifecycleIds)')
    expect(dashboardSource).toContain('markAppliedExcludedIds')
    expect(dashboardSource).not.toContain('dashboardSourceRows(allRows, scope)')
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
    expect(dashboardSource).toContain('void refreshFeedHead()')
    expect(dashboardSource).not.toContain('scoreFreshnessLabel')
  })

  it('renders stored deterministic score and tier without resume routing UI', () => {
    expect(dashboardSource).toContain('row.deterministic_score')
    expect(dashboardSource).toContain('row.deterministic_tier')
    expect(dashboardSource).not.toContain('row.deterministic_best_fit_resume_id')
    expect(dashboardSource).not.toContain('resumeRouteIsCurrent(row)')
    expect(dashboardSource).not.toContain("queryKey: ['resumes']")
    expect(dashboardSource).not.toContain('listResumes')
    expect(dashboardSource).not.toContain('resumeLabel')
    expect(dashboardSource).toContain('<TierBadge tier={row.deterministic_tier}')
    expect(dashboardSource).not.toContain('tierPresentation(row.score)')
    expect(dashboardSource).not.toContain('row.score')
    expect(dashboardSource).not.toContain('row.routed_resume_id')
  })

  it('shows deterministic score without any best-fit resume labels', () => {
    const markup = renderToStaticMarkup(<Dashboard />)
    expect(markup).toContain('>42</span>')
    expect(markup).not.toContain('Best fit:')
  })

  it('does not render current winner or runner-up labels', () => {
    const markup = renderToStaticMarkup(<Dashboard scope="all" />)
    expect(markup).not.toContain('Best fit:')
    expect(markup).not.toContain('also fits')
    expect(DASHBOARD_COLUMNS.map(({ id }) => id)).not.toContain('bestFit')
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

  it('keeps Apply navigation separate from lifecycle actions and deletion confirmation', () => {
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
    expect(dashboardSource).toContain('ConfirmDialog')
    expect(dashboardSource).toContain('deleteTrackerApplication')
    expect(dashboardSource).toContain('confirmLabel="Delete application"')
    expect(dashboardSource).toContain('will not return to Active')
  })

  it('pins exact optimistic rollback, focus recovery, durable invalidation, and backfill failure isolation', () => {
    expect(dashboardSource).toContain(
      'getQueryData<DashboardInfiniteData>(target.feedKey)',
    )
    expect(dashboardSource).toContain('setQueryData<DashboardInfiniteData>(')
    expect(dashboardSource).toContain('removeRowFromInfiniteData')
    expect(dashboardSource).toContain('if (context.rowIndex >= 0)')
    expect(dashboardSource).toContain('restoreDismissedRowInInfiniteData(current, context)')
    expect(dashboardSource).toContain('focusAfterRemoval')
    expect(dashboardSource).toContain('tableRegionRef.current?.focus()')
    expect(dashboardSource).toContain('markAppliedPendingIds.has(row.id)')
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
    const markAppliedSource = dashboardSource.match(
      /const markAppliedMutation = useMutation\([\s\S]*?\n  const companyOptions/,
    )?.[0] ?? ''
    expect(markAppliedSource).not.toContain('onSuccess: async')
    expect(markAppliedSource).not.toContain('onSettled:')
    expect(markAppliedSource).not.toContain('queryKey: feedKey')
    expect(markAppliedSource).toContain('void refillVisibleQueue')
  })

  it('filters lifecycle exclusions from every cached page without changing cursors', () => {
    const original = dashboardData([[row, secondRow], [thirdRow]])

    const filtered = filterDashboardInfiniteDataRows(
      original,
      new Set([secondRow.id, thirdRow.id]),
    )

    expect(filtered?.pages.flatMap(({ rows }) => rows.map(({ id }) => id))).toEqual([row.id])
    expect(filtered?.pageParams).toBe(original.pageParams)
    expect(filtered?.pages.map(({ nextCursor }) => nextCursor)).toEqual(
      original.pages.map(({ nextCursor }) => nextCursor),
    )
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

  it('loads tracker-backed applied history and pins normalized membership', () => {
    expect(appliedApplication).toEqual({
      applicationId: '11111111-1111-4111-8111-111111111111',
      company: 'Acme',
      title: 'Analyst',
      location: 'Chicago, IL',
      applyUrl: 'https://example.com/jobs/1',
      appliedOn: '2026-07-20',
      currentStage: 'interview',
      currentStageDate: '2026-07-28',
      hasWatchedCompany: true,
    })
    expect(dashboardSource).toContain('listDashboardAppliedApplications')
    expect(dashboardSource).toContain('dashboardAppliedSourceRows')
    expect(dashboardSource).toContain("queryKey: ['dashboard-applied-applications']")
    expect(dashboardSource).toContain("enabled: lifecycle === 'applied'")
    expect(dashboardSource).toContain('application.appliedOn')
    expect(dashboardSource).not.toContain('application.currentStageDate}</time>')
    expect(dashboardSource).not.toMatch(/appliedOn\s*:\s*application\.currentStageDate/)
  })

  it('renders watched applied rows only by default and both rows in All Jobs', () => {
    const watchlistMarkup = renderToStaticMarkup(
      <Dashboard initialLifecycle="applied" />,
    )
    const allJobsMarkup = renderToStaticMarkup(
      <Dashboard scope="all" initialLifecycle="applied" />,
    )

    expect(watchlistMarkup).toContain('1 applied jobs shown')
    expect(watchlistMarkup).toContain('Analyst')
    expect(watchlistMarkup).not.toContain('External Applied Analyst')
    expect(allJobsMarkup).toContain('2 applied jobs shown')
    expect(allJobsMarkup).toContain('Analyst')
    expect(allJobsMarkup).toContain('External Applied Analyst')
  })

  it('renders eight applied snapshot/action columns and the shared stage treatment', () => {
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
      'Action',
    ]) {
      expect(appliedTableSource).toContain(`>${header}</th>`)
    }
    expect(appliedTableSource.match(/scope="col"/g)).toHaveLength(8)
    expect(appliedTableSource).toContain('TRACKER_STAGE_PRESENTATION')
    expect(appliedTableSource).toContain('application.currentStage')
    expect(appliedTableSource).toContain('View in Tracker')
    expect(appliedTableSource).toContain(
      '`/tracker?application=${encodeURIComponent(application.applicationId)}`',
    )
    expect(appliedTableSource).toContain('onRequestDelete(application)')
    expect(appliedTableSource).toMatch(/>\s*Delete\s*<\/button>/)
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
    expect(markup).toContain('style="min-width:1396px"')
    expect(separators).toHaveLength(7)
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

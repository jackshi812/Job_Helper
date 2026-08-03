import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import { Link } from 'react-router'
import {
  backfillDashboardFeedRow,
  companyName,
  dismissJob,
  listDashboardCompanyOptions,
  listFeedPage,
  markJobApplied,
  mergeDashboardFeedPages,
  safeApplyUrl,
  tierPresentation,
  type DashboardFeedOrder,
  type DashboardFeedPage,
  type FeedRow,
  type LifecycleView,
  type Tier,
} from '../lib/feed'
import {
  ALL_SCORE_TIERS,
  areAllCurrentCompaniesCleared,
  areAllCurrentCompaniesSelected,
  buildDashboardFeedQuery,
  clearAllCompanies,
  copyHiddenCompanyKeys,
  dashboardAppliedSourceRows,
  dashboardFeedQueryKey,
  dashboardLifecycleCopy,
  dashboardLifecycleTimestamp,
  searchCompanyOptions,
  scoreTierSummary,
  selectAllCompanies,
  toggleDashboardLifecycle,
  toggleHiddenCompanyKey,
  toggleScoreTier,
  type DashboardSourceScope,
} from '../lib/dashboard'
import {
  deleteTrackerApplication,
  listDashboardAppliedApplications,
  TRACKER_STAGE_PRESENTATION,
  type DashboardAppliedApplication,
} from '../lib/tracker'
import {
  getDeterministicRankingState,
  loadPreferences,
  retryDeterministicRankingRun,
} from '../lib/preferences'
import { ColumnResizeHandle } from '../components/ColumnResizeHandle'
import { ConfirmDialog } from '../components/ConfirmDialog'
import {
  DASHBOARD_COLUMNS,
  clampDashboardColumnWidth,
  dashboardTableWidth,
  loadDashboardColumnWidths,
  persistDashboardColumnWidths,
  type ColumnResizeCoordinator,
  type DashboardColumn,
  type DashboardColumnId,
  type DashboardColumnWidths,
} from '../lib/dashboardColumns'

const fullDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})
const relativeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const appliedDateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

const tierBadgeStyles = {
  emerald:
    'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400',
  neutral:
    'border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400',
} as const

const newBadgeStyle =
  'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300'

function relativeTime(timestamp: string) {
  const parsed = new Date(timestamp)
  if (!Number.isFinite(parsed.getTime())) return 'at an unknown time'

  const elapsedSeconds = Math.round((parsed.getTime() - Date.now()) / 1000)
  if (Math.abs(elapsedSeconds) < 60) return relativeFormatter.format(elapsedSeconds, 'second')
  const elapsedMinutes = Math.round(elapsedSeconds / 60)
  if (Math.abs(elapsedMinutes) < 60) return relativeFormatter.format(elapsedMinutes, 'minute')
  const elapsedHours = Math.round(elapsedMinutes / 60)
  if (Math.abs(elapsedHours) < 24) return relativeFormatter.format(elapsedHours, 'hour')
  return relativeFormatter.format(Math.round(elapsedHours / 24), 'day')
}

function TierBadge({ tier }: { tier: Tier | null }) {
  const presentation = tierPresentation(tier)
  if (!presentation) return null
  if (presentation.badge === null) {
    return <span className="text-xs font-semibold text-zinc-500">{presentation.label}</span>
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tierBadgeStyles[presentation.badge]}`}
    >
      {presentation.label}
    </span>
  )
}

function LifecycleTime({ row, lifecycle }: { row: FeedRow; lifecycle: LifecycleView }) {
  const timestamp = dashboardLifecycleTimestamp(row, lifecycle)
  if (!timestamp || !Number.isFinite(new Date(timestamp).getTime())) {
    return <span className="text-zinc-500">—</span>
  }
  const fullDate = fullDateFormatter.format(new Date(timestamp))
  return (
    <time dateTime={timestamp} title={fullDate} className="text-zinc-600 dark:text-zinc-400">
      {relativeTime(timestamp)}
    </time>
  )
}

type DashboardInfiniteData = InfiniteData<DashboardFeedPage, string | null>

export interface DashboardHeadRefreshCoordinator {
  feedIdentity: string | null
  generation: number
}

export function createDashboardHeadRefreshCoordinator(): DashboardHeadRefreshCoordinator {
  return { feedIdentity: null, generation: 0 }
}

export function replaceDashboardFeedHead(
  data: DashboardInfiniteData | undefined,
  head: DashboardFeedPage,
): DashboardInfiniteData | undefined {
  if (!data || data.pages.length === 0) return data
  return {
    ...data,
    pages: [head, ...data.pages.slice(1)],
  }
}

export async function refreshDashboardFeedHead(
  loadHead: () => Promise<DashboardFeedPage>,
  setData: (
    updater: (current: DashboardInfiniteData | undefined) => DashboardInfiniteData | undefined,
  ) => void,
  options?: {
    coordinator?: DashboardHeadRefreshCoordinator
    feedIdentity?: string
    excludedIds?: () => ReadonlySet<string>
  },
): Promise<void> {
  const coordinator = options?.coordinator
  const feedIdentity = options?.feedIdentity ?? 'default'
  if (coordinator && coordinator.feedIdentity !== feedIdentity) {
    coordinator.feedIdentity = feedIdentity
    coordinator.generation += 1
  }
  const generation = coordinator ? ++coordinator.generation : 0
  try {
    const head = await loadHead()
    if (
      coordinator
      && (
        coordinator.feedIdentity !== feedIdentity
        || coordinator.generation !== generation
      )
    ) return
    const excludedIds = options?.excludedIds?.() ?? new Set<string>()
    const visibleHead = excludedIds.size === 0
      ? head
      : { ...head, rows: head.rows.filter(({ id }) => !excludedIds.has(id)) }
    setData((current) => replaceDashboardFeedHead(current, visibleHead))
  } catch {
    // Background refresh failures retain every currently rendered page.
  }
}

export function retryDashboardFeed<T>(refetch: () => Promise<T>): Promise<T> {
  return refetch()
}

interface LifecycleMutationContext {
  removedRow: FeedRow | null
  pageIndex: number
  rowIndex: number
  title: string
  continuationCursor: string | null
  nextFocusId: string | null
  previousFocusId: string | null
}

export interface DismissalMutationContext {
  removedRow: FeedRow | null
  pageIndex: number
  rowIndex: number
  title: string
  continuationCursor: string | null
  nextFocusId: string | null
  previousFocusId: string | null
}

type BackfillRetry =
  | {
    scope: 'all'
    cursor: string
    dismissalCommitted: boolean
  }
  | {
    scope: 'watchlist'
    cursor?: string
    dismissalCommitted: boolean
  }

const EMPTY_DASHBOARD_PAGE: DashboardFeedPage = {
  rows: [],
  nextCursor: null,
  hasMore: false,
  caughtUp: true,
}

function mergedInfinitePage(data: DashboardInfiniteData | undefined): DashboardFeedPage {
  return (data?.pages ?? []).reduce(
    (current, page) => mergeDashboardFeedPages(current, page),
    EMPTY_DASHBOARD_PAGE,
  )
}

function removeRowFromInfiniteData(
  data: DashboardInfiniteData | undefined,
  rowId: string,
): DashboardInfiniteData | undefined {
  if (!data) return data
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      rows: page.rows.filter(({ id }) => id !== rowId),
    })),
  }
}

function captureDismissalContext(
  data: DashboardInfiniteData | undefined,
  rowId: string,
): DismissalMutationContext {
  const pageIndex = data?.pages.findIndex((page) =>
    page.rows.some(({ id }) => id === rowId)) ?? -1
  const rowIndex = pageIndex >= 0
    ? data?.pages[pageIndex].rows.findIndex(({ id }) => id === rowId) ?? -1
    : -1
  const removedRow = pageIndex >= 0 && rowIndex >= 0
    ? data?.pages[pageIndex].rows[rowIndex] ?? null
    : null
  const currentRows = mergedInfinitePage(data).rows
  const mergedIndex = currentRows.findIndex(({ id }) => id === rowId)

  return {
    removedRow,
    pageIndex,
    rowIndex,
    title: removedRow?.jobs?.title ?? 'Untitled role',
    continuationCursor: data?.pages.at(-1)?.nextCursor ?? null,
    nextFocusId: mergedIndex >= 0 ? currentRows[mergedIndex + 1]?.id ?? null : null,
    previousFocusId: mergedIndex > 0 ? currentRows[mergedIndex - 1]?.id ?? null : null,
  }
}

export function restoreDismissedRowInInfiniteData(
  data: DashboardInfiniteData | undefined,
  context: DismissalMutationContext,
): DashboardInfiniteData | undefined {
  if (!data || !context.removedRow) return data
  if (data.pages.some((page) => page.rows.some(({ id }) => id === context.removedRow?.id))) {
    return data
  }

  if (data.pages.length === 0) {
    return {
      ...data,
      pages: [{
        ...EMPTY_DASHBOARD_PAGE,
        rows: [context.removedRow],
        nextCursor: context.continuationCursor,
        hasMore: context.continuationCursor !== null,
        caughtUp: context.continuationCursor === null,
      }],
      pageParams: [null],
    }
  }

  const targetPageIndex = Math.min(
    Math.max(context.pageIndex, 0),
    data.pages.length - 1,
  )
  return {
    ...data,
    pages: data.pages.map((page, index) => {
      if (index !== targetPageIndex) return page
      const insertAt = Math.min(Math.max(context.rowIndex, 0), page.rows.length)
      return {
        ...page,
        rows: [
          ...page.rows.slice(0, insertAt),
          context.removedRow as FeedRow,
          ...page.rows.slice(insertAt),
        ],
      }
    }),
  }
}

export function filterDismissedFeedRows(
  rows: readonly FeedRow[],
  dismissedIds: ReadonlySet<string>,
): FeedRow[] {
  return rows.filter(({ id }) => !dismissedIds.has(id))
}

function appendBackfillPage(
  data: DashboardInfiniteData | undefined,
  page: DashboardFeedPage,
  cursor: string,
): DashboardInfiniteData | undefined {
  if (!data) return data
  if (page.rows.length === 0) {
    const pages = [...data.pages]
    const last = pages.at(-1)
    if (last) pages[pages.length - 1] = { ...last, ...page, rows: last.rows }
    return { ...data, pages }
  }
  const existingIds = new Set(mergedInfinitePage(data).rows.map(({ id }) => id))
  const rows = page.rows.filter(({ id }) => !existingIds.has(id))
  return {
    pages: [...data.pages, { ...page, rows }],
    pageParams: [...data.pageParams, cursor],
  }
}

const filterButtonBase =
  'min-h-9 rounded-md border px-3 py-1.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 [@media(pointer:coarse)]:min-h-11 dark:focus-visible:outline-zinc-100'
const filterInactive =
  'border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'
const filterActive =
  'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'

interface DashboardHeaderCellProps {
  column: DashboardColumn
  widths: DashboardColumnWidths
  resizeCoordinator: ColumnResizeCoordinator
  onWidthChange: (columnId: DashboardColumnId, width: number) => void
  onWidthCommit: (columnId: DashboardColumnId, width: number) => void
  children: ReactNode
  ariaSort?: 'ascending' | 'descending' | 'none'
  isLast?: boolean
  alignRight?: boolean
}

function DashboardHeaderCell({
  column,
  widths,
  resizeCoordinator,
  onWidthChange,
  onWidthCommit,
  children,
  ariaSort,
  isLast = false,
  alignRight = false,
}: DashboardHeaderCellProps) {
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={`relative px-4 py-2.5 ${alignRight ? 'text-right' : ''}`}
    >
      {children}
      {!isLast ? (
        <ColumnResizeHandle
          column={column}
          width={widths[column.id]}
          coordinator={resizeCoordinator}
          onWidthChange={(width) => onWidthChange(column.id, width)}
          onWidthCommit={(width) => onWidthCommit(column.id, width)}
        />
      ) : null}
    </th>
  )
}

interface AppliedApplicationsTableProps {
  applications: readonly DashboardAppliedApplication[]
  onRequestDelete: (application: DashboardAppliedApplication) => void
}

function AppliedApplicationsTable({
  applications,
  onRequestDelete,
}: AppliedApplicationsTableProps) {
  return (
    <table className="w-full table-fixed border-collapse text-left text-sm">
      <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold tracking-wide text-zinc-600 uppercase dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
        <tr>
          <th scope="col" className="px-4 py-2.5">Position</th>
          <th scope="col" className="px-4 py-2.5">Company</th>
          <th scope="col" className="px-4 py-2.5">Location</th>
          <th scope="col" className="px-4 py-2.5">Applied date</th>
          <th scope="col" className="px-4 py-2.5">Current stage</th>
          <th scope="col" className="px-4 py-2.5">Apply link</th>
          <th scope="col" className="px-4 py-2.5">Tracker link</th>
          <th scope="col" className="px-4 py-2.5 text-right">Action</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {applications.map((application) => {
          const presentation = TRACKER_STAGE_PRESENTATION[application.currentStage]
          const [year, month, day] = application.appliedOn.split('-').map(Number)
          const appliedDate = new Date(year, month - 1, day)
          return (
            <tr
              key={application.applicationId}
              className="hover:bg-zinc-50 focus-within:bg-zinc-50 dark:hover:bg-zinc-800/50 dark:focus-within:bg-zinc-800/50"
            >
              <td className="px-4 py-3 font-semibold">{application.title}</td>
              <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                {application.company}
              </td>
              <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                {application.location ?? '—'}
              </td>
              <td className="px-4 py-3">
                <time
                  dateTime={application.appliedOn}
                  className="text-zinc-600 dark:text-zinc-400"
                >
                  {appliedDateFormatter.format(appliedDate)}
                </time>
              </td>
              <td className="px-4 py-3">
                <span
                  className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${presentation.badgeClass}`}
                >
                  {presentation.label}
                </span>
              </td>
              <td className="px-4 py-3">
                {application.applyUrl ? (
                  <a
                    href={application.applyUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Apply to ${application.title} in a new tab`}
                    className="inline-flex min-h-11 items-center gap-1 underline underline-offset-4"
                  >
                    Apply <span aria-hidden="true">↗</span>
                  </a>
                ) : (
                  <span className="text-zinc-500">—</span>
                )}
              </td>
              <td className="px-4 py-3">
                <Link
                  to={`/tracker?application=${encodeURIComponent(application.applicationId)}`}
                  className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
                >
                  View in Tracker
                </Link>
              </td>
              <td className="px-4 py-3 text-right">
                <button
                  type="button"
                  onClick={() => onRequestDelete(application)}
                  className="min-h-11 rounded-md px-2 text-xs font-semibold text-red-700 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-red-700 dark:text-red-400"
                >
                  Delete
                </button>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

interface DashboardProps {
  scope?: DashboardSourceScope
  initialLifecycle?: LifecycleView
}

export function Dashboard({
  scope = 'watchlist',
  initialLifecycle = 'active',
}: DashboardProps) {
  const queryClient = useQueryClient()
  const [lifecycle, setLifecycle] = useState<LifecycleView>(initialLifecycle)
  const [sortByScore, setSortByScore] = useState(false)
  const [scoreAscending, setScoreAscending] = useState(false)
  const [companyPanelOpen, setCompanyPanelOpen] = useState(false)
  const [scoreTierPopoverOpen, setScoreTierPopoverOpen] = useState(false)
  const [companySearch, setCompanySearch] = useState('')
  const [appliedHiddenKeys, setAppliedHiddenKeys] = useState<Set<string>>(() => new Set())
  const [draftHiddenKeys, setDraftHiddenKeys] = useState<Set<string>>(() => new Set())
  const [selectedTiers, setSelectedTiers] = useState(() => new Set(ALL_SCORE_TIERS))
  const [rankingAnnouncement, setRankingAnnouncement] = useState('')
  const [retryError, setRetryError] = useState('')
  const [lifecycleError, setLifecycleError] = useState('')
  const [dismissPendingIds, setDismissPendingIds] = useState<Set<string>>(() => new Set())
  const [markAppliedPendingIds, setMarkAppliedPendingIds] =
    useState<Set<string>>(() => new Set())
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set())
  const [queueAnnouncement, setQueueAnnouncement] = useState('')
  const [loadMoreError, setLoadMoreError] = useState('')
  const [backfillError, setBackfillError] = useState('')
  const [backfillRetry, setBackfillRetry] = useState<BackfillRetry | null>(null)
  const [deleteCandidate, setDeleteCandidate] =
    useState<DashboardAppliedApplication | null>(null)
  const [columnWidths, setColumnWidths] = useState(loadDashboardColumnWidths)
  const columnWidthsRef = useRef(columnWidths)
  const resizeCoordinator = useRef<ColumnResizeCoordinator>({ activeColumnId: null })
  const companyTriggerRef = useRef<HTMLButtonElement>(null)
  const scoreTierTriggerRef = useRef<HTMLButtonElement>(null)
  const scoreTierPopoverRef = useRef<HTMLDivElement>(null)
  const firstScoreTierCheckboxRef = useRef<HTMLInputElement>(null)
  const observedActiveRevisionRef = useRef<number | null>(null)
  const tableRegionRef = useRef<HTMLDivElement>(null)
  const actionRefs = useRef(new Map<string, HTMLButtonElement>())
  const dismissActionRefs = useRef(new Map<string, HTMLButtonElement>())
  const restoredDismissFocusIdRef = useRef<string | null>(null)
  const headRefreshCoordinatorRef = useRef(createDashboardHeadRefreshCoordinator())
  const markAppliedExcludedIdsRef = useRef(new Set<string>())

  useEffect(() => {
    if (!scoreTierPopoverOpen) return

    queueMicrotask(() => firstScoreTierCheckboxRef.current?.focus())

    function handleOutsidePointerDown(event: globalThis.PointerEvent) {
      const target = event.target
      if (!(target instanceof Node)) return
      if (
        scoreTierPopoverRef.current?.contains(target)
        || scoreTierTriggerRef.current?.contains(target)
      ) return
      setScoreTierPopoverOpen(false)
    }

    document.addEventListener('pointerdown', handleOutsidePointerDown)
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown)
  }, [scoreTierPopoverOpen])

  const activeOrder: DashboardFeedOrder = sortByScore
    ? (scoreAscending ? 'score_asc' : 'score_desc')
    : 'newest'
  const feedRequest = useMemo(
    () => buildDashboardFeedQuery({
      lifecycle,
      activeOrder,
      sourceScope: scope,
      appliedHiddenKeys,
      selectedTiers,
    }),
    [lifecycle, activeOrder, scope, appliedHiddenKeys, selectedTiers],
  )
  const feedKey = useMemo(() => dashboardFeedQueryKey(feedRequest), [feedRequest])
  const feedIdentity = JSON.stringify([scope, ...feedKey])
  const feedEnabled = selectedTiers.size > 0 && lifecycle !== 'applied'
  const feedQuery = useInfiniteQuery<
    DashboardFeedPage,
    Error,
    DashboardInfiniteData,
    ReturnType<typeof dashboardFeedQueryKey>,
    string | null
  >({
    queryKey: feedKey,
    queryFn: ({ pageParam }) => listFeedPage(feedRequest, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: feedEnabled,
    refetchOnWindowFocus: false,
  })
  const refreshFeedHead = useCallback(
    () => refreshDashboardFeedHead(
      () => listFeedPage(feedRequest, null),
      (updater) => queryClient.setQueryData<DashboardInfiniteData>(feedKey, updater),
      {
        coordinator: headRefreshCoordinatorRef.current,
        feedIdentity,
        excludedIds: () => markAppliedExcludedIdsRef.current,
      },
    ),
    [feedIdentity, feedKey, feedRequest, queryClient],
  )

  useEffect(() => {
    if (!feedEnabled) return
    const intervalId = window.setInterval(() => {
      void refreshFeedHead()
    }, 60_000)
    const handleFocus = () => {
      void refreshFeedHead()
    }
    window.addEventListener('focus', handleFocus)
    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', handleFocus)
    }
  }, [feedEnabled, refreshFeedHead])
  const companyOptionsQuery = useQuery({
    queryKey: ['dashboard-companies', scope, lifecycle, [...feedRequest.tiers]],
    queryFn: () => listDashboardCompanyOptions(feedRequest),
    enabled: feedEnabled,
  })
  const rankingStateQuery = useQuery({
    queryKey: ['ranking-state'],
    queryFn: getDeterministicRankingState,
    refetchInterval: (query) =>
      query.state.data?.status === 'building' ? 2_000 : false,
  })
  const preferencesQuery = useQuery({ queryKey: ['preferences'], queryFn: loadPreferences })
  const appliedApplicationsQuery = useQuery({
    queryKey: ['dashboard-applied-applications'],
    queryFn: listDashboardAppliedApplications,
    enabled: lifecycle === 'applied',
  })
  const deleteApplicationMutation = useMutation({
    mutationFn: deleteTrackerApplication,
    retry: false,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['dashboard-applied-applications'],
        }),
        queryClient.invalidateQueries({ queryKey: ['tracker-applications'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-feed'] }),
      ])
      setQueueAnnouncement(
        `${deleteCandidate?.title ?? 'Application'} deleted from Tracker.`,
      )
      setDeleteCandidate(null)
    },
  })

  useEffect(() => {
    setLifecycleError('')
    setLoadMoreError('')
    setBackfillError('')
    setBackfillRetry(null)
  }, [feedIdentity])

  useEffect(() => {
    const state = rankingStateQuery.data
    if (!state) return
    if (observedActiveRevisionRef.current === null) {
      observedActiveRevisionRef.current = state.activeRevision
      return
    }
    if (state.activeRevision <= observedActiveRevisionRef.current) return

    observedActiveRevisionRef.current = state.activeRevision
    setRankingAnnouncement('Rankings updated.')
    void refreshFeedHead()
  }, [rankingStateQuery.data, refreshFeedHead])

  const retryRankingMutation = useMutation({
    mutationFn: retryDeterministicRankingRun,
    onMutate: () => {
      setRetryError('')
    },
    onSuccess: async () => {
      setRetryError('')
      setRankingAnnouncement('')
      await queryClient.invalidateQueries({ queryKey: ['ranking-state'] })
    },
    onError: () => {
      setRetryError(
        'Couldn’t retry this ranking update. Your previous results are still shown. Please try once more.',
      )
    },
  })

  const allRows = useMemo(
    () => mergedInfinitePage(feedQuery.data).rows,
    [feedQuery.data],
  )
  const rows = useMemo(
    () => filterDismissedFeedRows(allRows, dismissedIds),
    [allRows, dismissedIds],
  )
  const appliedApplications = useMemo(
    () => dashboardAppliedSourceRows(
      appliedApplicationsQuery.data ?? [],
      scope,
    ),
    [appliedApplicationsQuery.data, scope],
  )
  const finalPage = feedQuery.data?.pages.at(-1) ?? EMPTY_DASHBOARD_PAGE

  function focusAfterRemoval(
    nextFocusId: string | null,
    previousFocusId: string | null,
  ) {
    queueMicrotask(() => {
      if (nextFocusId && actionRefs.current.get(nextFocusId)) {
        actionRefs.current.get(nextFocusId)?.focus()
        return
      }
      if (previousFocusId && actionRefs.current.get(previousFocusId)) {
        actionRefs.current.get(previousFocusId)?.focus()
        return
      }
      tableRegionRef.current?.focus()
    })
  }

  useEffect(() => {
    const restoredId = restoredDismissFocusIdRef.current
    if (!restoredId) return
    queueMicrotask(() => {
      const dismissButton = dismissActionRefs.current.get(restoredId)
      if (!dismissButton) return
      restoredDismissFocusIdRef.current = null
      dismissButton.focus()
    })
  }, [lifecycleError, rows])

  function snapshotAndRemoveDismissal(rowId: string): DismissalMutationContext {
    setLifecycleError('')
    const current = queryClient.getQueryData<DashboardInfiniteData>(feedKey)
    const context = captureDismissalContext(current, rowId)
    setDismissPendingIds((pendingIds) => new Set(pendingIds).add(rowId))
    setDismissedIds((excludedIds) => new Set(excludedIds).add(rowId))
    queryClient.setQueryData<DashboardInfiniteData>(
      feedKey,
      (cached) => removeRowFromInfiniteData(cached, rowId),
    )
    if (context.rowIndex >= 0) {
      focusAfterRemoval(context.nextFocusId, context.previousFocusId)
    }
    void queryClient.cancelQueries({ queryKey: feedKey })
    return context
  }

  async function snapshotAndRemove(rowId: string): Promise<LifecycleMutationContext> {
    setLifecycleError('')
    await queryClient.cancelQueries({ queryKey: feedKey })
    const current = queryClient.getQueryData<DashboardInfiniteData>(feedKey)
    const context = captureDismissalContext(current, rowId)
    queryClient.setQueryData<DashboardInfiniteData>(
      feedKey,
      (cached) => removeRowFromInfiniteData(cached, rowId),
    )
    if (context.rowIndex >= 0) {
      focusAfterRemoval(context.nextFocusId, context.previousFocusId)
    }
    return context
  }

  function refillRequest(
    cursor: string | null,
    dismissalCommitted: boolean,
  ): BackfillRetry | null {
    if (scope === 'all') {
      return cursor === null ? null : { scope: 'all', cursor, dismissalCommitted }
    }
    return { scope: 'watchlist', dismissalCommitted }
  }

  function appliedRefillRequest(cursor: string | null): BackfillRetry | null {
    return cursor === null
      ? null
      : { scope, cursor, dismissalCommitted: false }
  }

  async function refillVisibleQueue(retry: BackfillRetry | null) {
    setBackfillError('')
    setBackfillRetry(null)
    if (!retry) return
    try {
      if (retry.scope === 'all' || retry.cursor !== undefined) {
        const cursor = retry.cursor
        if (cursor === undefined) return
        const page = await backfillDashboardFeedRow(feedRequest, cursor)
        queryClient.setQueryData<DashboardInfiniteData>(
          feedKey,
          (current) => appendBackfillPage(current, page, cursor),
        )
      } else {
        const result = await feedQuery.refetch()
        if (result.isError) throw result.error ?? new Error('dashboard_refill_failed')
      }
    } catch {
      setBackfillError(retry.dismissalCommitted
        ? 'Couldn’t refresh the queue. The job remains dismissed and your current results remain usable.'
        : 'Couldn’t load the next job. Your current results are still shown.')
      setBackfillRetry(retry)
    }
  }

  const dismissMutation = useMutation({
    mutationFn: dismissJob,
    onMutate: snapshotAndRemoveDismissal,
    onError: (_error, id, context) => {
      restoredDismissFocusIdRef.current = id
      setDismissPendingIds((pendingIds) => {
        const next = new Set(pendingIds)
        next.delete(id)
        return next
      })
      setDismissedIds((excludedIds) => {
        const next = new Set(excludedIds)
        next.delete(id)
        return next
      })
      if (!context) {
        setLifecycleError('Couldn’t dismiss this job. It remains in Active. Try again.')
        return
      }
      queryClient.setQueryData<DashboardInfiniteData>(
        feedKey,
        (current) => restoreDismissedRowInInfiniteData(current, context),
      )
      setLifecycleError(
        `Couldn’t dismiss ${context.title}. It remains in Active. Try again.`,
      )
    },
    onSuccess: (_data, id, context) => {
      setDismissPendingIds((pendingIds) => {
        const next = new Set(pendingIds)
        next.delete(id)
        return next
      })
      if (!context) {
        setQueueAnnouncement('Job dismissed permanently.')
        void queryClient.invalidateQueries({
          queryKey: ['dashboard-feed'],
          refetchType: 'inactive',
        }).catch(() => undefined)
        return
      }
      setQueueAnnouncement(`Dismissed ${context.title} permanently.`)
      if (lifecycle === 'active') {
        void refillVisibleQueue(
          refillRequest(context.continuationCursor, true),
        )
      }
      void queryClient.invalidateQueries({
        queryKey: ['dashboard-feed'],
        refetchType: 'inactive',
      }).catch(() => undefined)
    },
  })

  const markAppliedMutation = useMutation({
    mutationFn: markJobApplied,
    onMutate: (id) => {
      markAppliedExcludedIdsRef.current.add(id)
      setMarkAppliedPendingIds((pendingIds) => new Set(pendingIds).add(id))
      return snapshotAndRemove(id)
    },
    onError: (_error, id, context) => {
      markAppliedExcludedIdsRef.current.delete(id)
      setMarkAppliedPendingIds((pendingIds) => {
        const next = new Set(pendingIds)
        next.delete(id)
        return next
      })
      if (context) {
        queryClient.setQueryData<DashboardInfiniteData>(
          feedKey,
          (current) => restoreDismissedRowInInfiniteData(current, context),
        )
      }
      setLifecycleError(
        'Couldn’t mark this job as applied. It remains in Active. Try again.',
      )
    },
    onSuccess: (applicationId, id, context) => {
      setMarkAppliedPendingIds((pendingIds) => {
        const next = new Set(pendingIds)
        next.delete(id)
        return next
      })
      setQueueAnnouncement(`${context.title} marked applied and added to Tracker.`)
      void refillVisibleQueue(appliedRefillRequest(context.continuationCursor))
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tracker-applications'] }),
        queryClient.invalidateQueries({
          queryKey: ['tracker-application', applicationId],
        }),
        queryClient.invalidateQueries({
          queryKey: ['dashboard-applied-applications'],
        }),
        queryClient.invalidateQueries({
          queryKey: ['dashboard-feed'],
          predicate: (query) => JSON.stringify(query.queryKey) !== JSON.stringify(feedKey),
          refetchType: 'inactive',
        }),
      ]).catch(() => undefined)
    },
  })

  const companyOptions = useMemo(
    () => companyOptionsQuery.data ?? [],
    [companyOptionsQuery.data],
  )
  const searchedCompanyOptions = useMemo(
    () => searchCompanyOptions(companyOptions, companySearch),
    [companyOptions, companySearch],
  )

  function openCompanyPanel() {
    setScoreTierPopoverOpen(false)
    setDraftHiddenKeys(copyHiddenCompanyKeys(appliedHiddenKeys))
    setCompanySearch('')
    setCompanyPanelOpen(true)
  }

  function closeCompanyPanel() {
    setCompanyPanelOpen(false)
    setCompanySearch('')
    queueMicrotask(() => companyTriggerRef.current?.focus())
  }

  function applyCompanyDraft() {
    setAppliedHiddenKeys(copyHiddenCompanyKeys(draftHiddenKeys))
    closeCompanyPanel()
  }

  function openScoreTierPopover() {
    setCompanyPanelOpen(false)
    setCompanySearch('')
    setScoreTierPopoverOpen(true)
  }

  function closeScoreTierPopover(returnFocus: boolean) {
    setScoreTierPopoverOpen(false)
    if (returnFocus) queueMicrotask(() => scoreTierTriggerRef.current?.focus())
  }

  const visibleCompanyCount = companyOptions.filter(
    (option) => !appliedHiddenKeys.has(option.key),
  ).length
  const companyFilterNarrowed = !areAllCurrentCompaniesSelected(
    companyOptions,
    appliedHiddenKeys,
  )
  const filtersNarrowed = companyFilterNarrowed || selectedTiers.size < ALL_SCORE_TIERS.length
  const scoreSummary = scoreTierSummary(selectedTiers)
  const scoreFilterNarrowed = selectedTiers.size < ALL_SCORE_TIERS.length
  const clearAllDisabled = areAllCurrentCompaniesCleared(companyOptions, draftHiddenKeys)
  const selectAllDisabled = areAllCurrentCompaniesSelected(companyOptions, draftHiddenKeys)

  function toggleScoreSort() {
    if (lifecycle !== 'active') return
    if (!sortByScore) {
      setSortByScore(true)
      setScoreAscending(false)
      return
    }
    setScoreAscending((ascending) => !ascending)
  }

  async function loadMore() {
    if (feedQuery.isFetchingNextPage || !feedQuery.hasNextPage) return
    setLoadMoreError('')
    const previousCount = rows.length
    const result = await feedQuery.fetchNextPage({ cancelRefetch: false })
    if (result.isFetchNextPageError || result.error) {
      setLoadMoreError('Couldn’t load more jobs. Your current results are still shown.')
      return
    }
    const total = mergedInfinitePage(result.data).rows.length
    const appended = Math.max(0, total - previousCount)
    setQueueAnnouncement(
      `${appended} more jobs loaded. ${total} ${lifecycle} jobs shown.`,
    )
  }

  const lifecycleCopy = dashboardLifecycleCopy(lifecycle)
  const pageTitle = scope === 'watchlist' ? 'Watchlist Jobs' : 'All Jobs'
  const pageDescription = scope === 'watchlist' && lifecycle === 'active'
    ? 'New postings from watched companies ranked against your preferences, newest first.'
    : lifecycleCopy.description
  const scoreAriaSort = lifecycle === 'active' && sortByScore
    ? (scoreAscending ? 'ascending' : 'descending')
    : 'none'
  const hasPreferences = preferencesQuery.data !== null && preferencesQuery.data !== undefined
  const rankingState = rankingStateQuery.data
  const tableWidth = dashboardTableWidth(columnWidths)
  const feedLoading = feedEnabled && feedQuery.isPending
  const feedError = feedEnabled && !feedQuery.data ? feedQuery.error : null
  const caughtUp = !feedLoading
    && !feedError
    && (!feedQuery.hasNextPage || finalPage.caughtUp)

  function updateColumnWidth(columnId: DashboardColumnId, width: number) {
    const next = {
      ...columnWidthsRef.current,
      [columnId]: clampDashboardColumnWidth(columnId, width),
    }
    columnWidthsRef.current = next
    setColumnWidths(next)
  }

  function commitColumnWidth(columnId: DashboardColumnId, width: number) {
    const next = {
      ...columnWidthsRef.current,
      [columnId]: clampDashboardColumnWidth(columnId, width),
    }
    columnWidthsRef.current = next
    setColumnWidths(next)
    persistDashboardColumnWidths(next)
  }

  return (
    <section>
      <h1 className="text-xl font-semibold tracking-tight">{pageTitle}</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        {pageDescription}
      </p>

      <div
        role="group"
        aria-label="Lifecycle view"
        className="mt-6 flex flex-wrap gap-2"
      >
        <button
          type="button"
          aria-pressed={lifecycle === 'applied'}
          onClick={() => setLifecycle((current) =>
            toggleDashboardLifecycle(current, 'applied'))}
          className={`${filterButtonBase} ${
            lifecycle === 'applied' ? filterActive : filterInactive
          }`}
        >
          Show applied
        </button>
      </div>

      <div className="relative mt-4 flex flex-wrap gap-3">
        <button
          ref={companyTriggerRef}
          type="button"
          aria-expanded={companyPanelOpen}
          aria-controls="dashboard-company-panel"
          onClick={() => (companyPanelOpen ? closeCompanyPanel() : openCompanyPanel())}
          className={`${filterButtonBase} ${filterInactive}`}
        >
          {companyFilterNarrowed ? `Companies (${visibleCompanyCount} selected)` : 'Companies'}
        </button>
        <div className="relative">
          <button
            ref={scoreTierTriggerRef}
            type="button"
            aria-expanded={scoreTierPopoverOpen}
            aria-controls="dashboard-score-tier-popover"
            onClick={() => (
              scoreTierPopoverOpen
                ? closeScoreTierPopover(true)
                : openScoreTierPopover()
            )}
            className={`${filterButtonBase} ${scoreFilterNarrowed ? filterActive : filterInactive}`}
          >
            {scoreSummary}
            <span aria-hidden="true" className="ml-2">▾</span>
          </button>
          {scoreTierPopoverOpen ? (
            <div
              ref={scoreTierPopoverRef}
              id="dashboard-score-tier-popover"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  event.stopPropagation()
                  closeScoreTierPopover(true)
                }
              }}
              className="absolute top-full left-0 z-20 mt-2 min-w-[220px] max-w-[calc(100vw-2rem)] rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
            >
              <fieldset>
                <legend className="px-1 text-sm font-semibold">Score tiers</legend>
                <div className="mt-2 grid">
                  {ALL_SCORE_TIERS.map((tier) => (
                    <label
                      key={tier}
                      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-1 text-sm focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-zinc-900 dark:focus-within:outline-zinc-100"
                    >
                      <input
                        ref={tier === ALL_SCORE_TIERS[0] ? firstScoreTierCheckboxRef : undefined}
                        type="checkbox"
                        checked={selectedTiers.has(tier)}
                        onChange={() => setSelectedTiers((current) =>
                          toggleScoreTier(current, tier))}
                        className="size-6 rounded border-zinc-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-zinc-100"
                      />
                      <span>{tier}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          ) : null}
        </div>
      </div>

      {companyPanelOpen ? (
        <section
          id="dashboard-company-panel"
          aria-labelledby="dashboard-company-heading"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              closeCompanyPanel()
            }
          }}
          className="mt-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <h2 id="dashboard-company-heading" className="text-base font-semibold">
            Filter companies
          </h2>
          <label htmlFor="dashboard-company-search" className="mt-4 block text-sm font-medium">
            Search companies
          </label>
          <input
            id="dashboard-company-search"
            type="search"
            value={companySearch}
            onChange={(event) => setCompanySearch(event.target.value)}
            placeholder="Search current companies"
            className="mt-2 min-h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/30 dark:border-zinc-700 dark:bg-zinc-950"
          />
          <fieldset className="mt-3 max-h-80 overflow-y-auto" aria-label="Current companies">
            {companyOptions.length === 0 ? (
              <p className="py-3 text-sm text-zinc-600 dark:text-zinc-400">
                No companies in the current feed.
              </p>
            ) : searchedCompanyOptions.length === 0 ? (
              <p className="py-3 text-sm text-zinc-600 dark:text-zinc-400">
                No current companies match your search.
              </p>
            ) : (
              searchedCompanyOptions.map((option) => (
                <label
                  key={option.key}
                  className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-zinc-100 py-2 text-sm last:border-b-0 dark:border-zinc-800"
                >
                  <input
                    type="checkbox"
                    checked={!draftHiddenKeys.has(option.key)}
                    onChange={() => setDraftHiddenKeys((current) =>
                      toggleHiddenCompanyKey(current, option.key))}
                    className="size-6 rounded border-zinc-400"
                  />
                  <span>{option.label}</span>
                </label>
              ))
            )}
          </fieldset>
          <div className="sticky bottom-0 mt-4 flex flex-wrap items-center gap-3 border-t border-zinc-200 bg-white pt-4 dark:border-zinc-800 dark:bg-zinc-900">
            <button
              type="button"
              disabled={clearAllDisabled}
              onClick={() => setDraftHiddenKeys(clearAllCompanies(companyOptions))}
              className={`${filterButtonBase} ${filterInactive} disabled:opacity-50`}
            >
              Clear all
            </button>
            <button
              type="button"
              disabled={selectAllDisabled}
              onClick={() => setDraftHiddenKeys(selectAllCompanies())}
              className={`${filterButtonBase} ${filterInactive} disabled:opacity-50`}
            >
              Select all
            </button>
            <span aria-hidden="true" className="flex-1" />
            <button
              type="button"
              onClick={applyCompanyDraft}
              className={`${filterButtonBase} ${filterActive}`}
            >
              Show results
            </button>
          </div>
        </section>
      ) : null}

      {rankingState?.status === 'building' ? (
        <div
          role="status"
          aria-live="polite"
          className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          <h2 className="text-base font-semibold">Updating rankings…</h2>
          <p className="mt-1 text-sm">
            Your current results stay visible until the full update is ready.
          </p>
        </div>
      ) : rankingState?.status === 'failed' ? (
        <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            Rankings couldn’t update. Your previous results are still shown.
          </p>
          {rankingState.errorCode ? (
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
              Update error: {rankingState.errorCode.slice(0, 80).replaceAll('_', ' ')}.
            </p>
          ) : null}
          {rankingState.retryAvailable ? (
            <>
              <button
                type="button"
                disabled={retryRankingMutation.isPending}
                aria-describedby={retryError ? 'ranking-retry-error' : undefined}
                onClick={() => retryRankingMutation.mutate()}
                className={`mt-3 min-h-9 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-semibold hover:bg-zinc-100 disabled:cursor-wait disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800 ${filterInactive}`}
              >
                {retryRankingMutation.isPending ? 'Retrying…' : 'Retry update'}
              </button>
              {retryError ? (
                <p
                  id="ranking-retry-error"
                  role="alert"
                  aria-live="assertive"
                  className="mt-2 text-sm text-red-700 dark:text-red-400"
                >
                  {retryError}
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Retry limit reached. Save preferences again to start a new update.
            </p>
          )}
        </div>
      ) : null}

      <p aria-live="polite" className="sr-only">
        {rankingAnnouncement || queueAnnouncement}
      </p>

      {lifecycleError ? (
        <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-400">
          {lifecycleError}
        </p>
      ) : null}

      {lifecycle === 'applied'
        && !appliedApplicationsQuery.isPending
        && !appliedApplicationsQuery.error ? (
        <p role="status" aria-live="polite" className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
          {appliedApplications.length} applied jobs shown
        </p>
      ) : lifecycle !== 'applied' && !feedLoading && !feedError ? (
        <p role="status" aria-live="polite" className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
          {rows.length} {lifecycleCopy.resultNoun} shown
        </p>
      ) : null}

      <div
        ref={tableRegionRef}
        role="region"
        aria-label="Job matches; scroll horizontally to view all columns"
        tabIndex={0}
        className="mt-8 overflow-x-auto rounded-lg border border-zinc-200 bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:focus-visible:outline-zinc-100"
      >
        {lifecycle === 'applied' ? (
          appliedApplicationsQuery.isPending ? (
            <p role="status" className="p-4 text-sm text-zinc-600 dark:text-zinc-400">
              Loading applied jobs…
            </p>
          ) : appliedApplicationsQuery.error ? (
            <div className="p-4">
              <p role="alert" className="text-sm text-red-700 dark:text-red-400">
                Couldn’t load applied jobs. Check your connection and retry.
              </p>
              <button
                type="button"
                aria-label="Retry loading applied jobs"
                onClick={() => void appliedApplicationsQuery.refetch()}
                className={`mt-3 ${filterButtonBase} ${filterInactive}`}
              >
                Retry
              </button>
            </div>
          ) : appliedApplications.length === 0 ? (
            <div className="p-4">
              <h2 className="text-base font-semibold">No applied jobs yet</h2>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Jobs you mark applied will appear here.
              </p>
            </div>
          ) : (
            <AppliedApplicationsTable
              applications={appliedApplications}
              onRequestDelete={(application) => {
                deleteApplicationMutation.reset()
                setDeleteCandidate(application)
              }}
            />
          )
        ) : feedLoading ? (
          <p className="p-4 text-sm text-zinc-600 dark:text-zinc-400">Loading…</p>
        ) : feedError ? (
          <div className="p-4">
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              Couldn’t load your matches. Check your connection and retry.
            </p>
            <button
              type="button"
              onClick={() => void retryDashboardFeed(feedQuery.refetch)}
              className="mt-3 min-h-9 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-semibold hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:focus-visible:outline-zinc-100"
            >
              Retry
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="p-4">
            {filtersNarrowed ? (
              <>
                <h2 className="text-base font-semibold">No jobs match these filters</h2>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  Select more companies or score tiers, or use Select all in Companies.
                </p>
              </>
            ) : lifecycle === 'active' ? (
              <>
                <h2 className="text-base font-semibold">
                  {scope === 'watchlist' ? 'No watchlist matches yet' : 'No matches yet'}
                </h2>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  {scope === 'watchlist'
                    ? 'New postings from watched companies appear here after they are ranked.'
                    : 'New postings are ranked against your preferences within minutes of discovery.'}
                  Set your preferences to start matching.
                  {!hasPreferences ? (
                    <>
                      {' '}
                      <Link
                        to="/preferences"
                        className="text-zinc-900 underline decoration-1 underline-offset-4 hover:decoration-2 dark:text-zinc-100"
                      >
                        Set your preferences
                      </Link>
                      .
                    </>
                  ) : null}
                </p>
              </>
            ) : (
              <>
                <h2 className="text-base font-semibold">{lifecycleCopy.emptyHeading}</h2>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  {lifecycleCopy.emptyBody}
                </p>
              </>
            )}
          </div>
        ) : (
          <table
            className="w-full table-fixed border-collapse text-left text-sm"
            style={{ minWidth: `${tableWidth}px` }}
          >
            <colgroup>
              {DASHBOARD_COLUMNS.map((column) => (
                <col key={column.id} style={{ width: `${columnWidths[column.id]}px` }} />
              ))}
            </colgroup>
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold tracking-wide text-zinc-600 uppercase dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
              <tr>
                {DASHBOARD_COLUMNS.slice(0, 4).map((column) => (
                  <DashboardHeaderCell
                    key={column.id}
                    column={column}
                    widths={columnWidths}
                    resizeCoordinator={resizeCoordinator.current}
                    onWidthChange={updateColumnWidth}
                    onWidthCommit={commitColumnWidth}
                  >
                    {column.label}
                  </DashboardHeaderCell>
                ))}
                <DashboardHeaderCell
                  column={DASHBOARD_COLUMNS[4]}
                  widths={columnWidths}
                  resizeCoordinator={resizeCoordinator.current}
                  onWidthChange={updateColumnWidth}
                  onWidthCommit={commitColumnWidth}
                  ariaSort={scoreAriaSort}
                >
                  {lifecycle === 'active' ? (
                    <button
                      type="button"
                      onClick={toggleScoreSort}
                      className="inline-flex items-center gap-1 rounded-sm uppercase focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-zinc-100"
                    >
                      Score
                      <span aria-hidden="true">
                        {sortByScore ? (scoreAscending ? '↑' : '↓') : '↕'}
                      </span>
                    </button>
                  ) : (
                    'Score'
                  )}
                </DashboardHeaderCell>
                <DashboardHeaderCell
                  column={DASHBOARD_COLUMNS[5]}
                  widths={columnWidths}
                  resizeCoordinator={resizeCoordinator.current}
                  onWidthChange={updateColumnWidth}
                  onWidthCommit={commitColumnWidth}
                >
                  {lifecycleCopy.timeLabel}
                </DashboardHeaderCell>
                <DashboardHeaderCell
                  column={DASHBOARD_COLUMNS[6]}
                  widths={columnWidths}
                  resizeCoordinator={resizeCoordinator.current}
                  onWidthChange={updateColumnWidth}
                  onWidthCommit={commitColumnWidth}
                >
                  Apply
                </DashboardHeaderCell>
                <DashboardHeaderCell
                  column={DASHBOARD_COLUMNS[7]}
                  widths={columnWidths}
                  resizeCoordinator={resizeCoordinator.current}
                  onWidthChange={updateColumnWidth}
                  onWidthCommit={commitColumnWidth}
                  isLast
                  alignRight
                >
                  Action
                </DashboardHeaderCell>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {rows.map((row) => {
                const applyUrl = safeApplyUrl(row.jobs?.absolute_url)
                const jobTitle = row.jobs?.title ?? 'Untitled role'
                const company = companyName(row)
                return (
                  <tr
                    key={row.id}
                    className="hover:bg-zinc-50 focus-within:bg-zinc-50 dark:hover:bg-zinc-800/50 dark:focus-within:bg-zinc-800/50"
                  >
                    <td className="px-4 py-3">
                      {row.seen_at === null ? (
                        <span
                          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${newBadgeStyle}`}
                        >
                          New
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        to={`/jobs/${row.id}`}
                        title={jobTitle}
                        className="line-clamp-2 text-zinc-900 underline decoration-1 underline-offset-4 hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:text-zinc-100 dark:focus-visible:outline-zinc-100"
                      >
                        {jobTitle}
                      </Link>
                    </td>
                    <td
                      title={company ?? undefined}
                      className="truncate px-4 py-3 whitespace-nowrap text-zinc-600 dark:text-zinc-400"
                    >
                      {company ?? '—'}
                    </td>
                    <td
                      title={row.jobs?.location ?? undefined}
                      className="truncate px-4 py-3 whitespace-nowrap text-zinc-600 dark:text-zinc-400"
                    >
                      {row.jobs?.location ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      {row.deterministic_score !== null ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold">
                            {row.deterministic_score}
                          </span>
                          <TierBadge tier={row.deterministic_tier} />
                        </div>
                      ) : (
                        <span className="text-zinc-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <LifecycleTime row={row} lifecycle={lifecycle} />
                    </td>
                    <td className="px-4 py-3">
                      {applyUrl ? (
                        <a
                          href={applyUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Apply to ${jobTitle} in a new tab`}
                          className="inline-flex min-h-9 items-center gap-1 rounded-sm text-zinc-900 underline decoration-1 underline-offset-4 hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:text-zinc-100 dark:focus-visible:outline-zinc-100"
                        >
                          Apply <span aria-hidden="true">↗</span>
                        </a>
                      ) : (
                        <span className="text-zinc-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-2">
                        {lifecycle === 'active' ? (
                          <>
                            <button
                              ref={(node) => {
                                if (node) actionRefs.current.set(row.id, node)
                                else actionRefs.current.delete(row.id)
                              }}
                              type="button"
                              disabled={markAppliedPendingIds.has(row.id)}
                              aria-label={`Mark ${jobTitle} applied`}
                              onClick={() => markAppliedMutation.mutate(row.id)}
                              className="min-h-9 rounded-md border border-zinc-900 bg-zinc-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:cursor-wait disabled:opacity-60 [@media(pointer:coarse)]:min-h-11 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 dark:focus-visible:outline-zinc-100"
                            >
                              Mark Applied
                            </button>
                            <button
                              ref={(node) => {
                                if (node) dismissActionRefs.current.set(row.id, node)
                                else dismissActionRefs.current.delete(row.id)
                              }}
                              type="button"
                              disabled={dismissPendingIds.has(row.id)}
                              aria-label={`Dismiss ${jobTitle}`}
                              onClick={() => dismissMutation.mutate(row.id)}
                              className="min-h-9 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-semibold hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:cursor-wait disabled:opacity-60 [@media(pointer:coarse)]:min-h-11 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:focus-visible:outline-zinc-100"
                            >
                              Dismiss
                            </button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {lifecycle !== 'applied' ? (
      <div className="mt-4 grid justify-items-center gap-2">
        {backfillError ? (
          <div className="text-center">
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {backfillError}
            </p>
            <button
              type="button"
              onClick={() => {
                if (backfillRetry) void refillVisibleQueue(backfillRetry)
              }}
              className={`mt-2 ${filterButtonBase} ${filterInactive}`}
            >
              Retry
            </button>
          </div>
        ) : null}
        {loadMoreError ? (
          <div className="text-center">
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {loadMoreError}
            </p>
            <button
              type="button"
              disabled={feedQuery.isFetchingNextPage}
              onClick={() => void loadMore()}
              className={`mt-2 ${filterButtonBase} ${filterInactive} disabled:cursor-wait disabled:opacity-60`}
            >
              Retry
            </button>
          </div>
        ) : null}
        <button
          type="button"
          disabled={feedQuery.isFetchingNextPage || !feedQuery.hasNextPage}
          onClick={() => void loadMore()}
          className={`${filterButtonBase} ${filterInactive} disabled:cursor-not-allowed disabled:opacity-50`}
        >
          {feedQuery.isFetchingNextPage ? 'Loading more…' : 'Load more'}
        </button>
        {caughtUp ? (
          <p role="status" aria-live="polite" className="text-sm text-zinc-600 dark:text-zinc-400">
            You're all caught up
          </p>
        ) : null}
      </div>
      ) : null}
      {deleteCandidate ? (
        <ConfirmDialog
          title="Delete application?"
          message={`Delete ${deleteCandidate.title} at ${deleteCandidate.company} and its timeline? The job stays marked applied and will not return to Active.`}
          confirmLabel="Delete application"
          cancelLabel="Keep application"
          pendingLabel="Deleting…"
          initialFocus="cancel"
          errorMessage={deleteApplicationMutation.isError
            ? 'Couldn’t delete this application. Check your connection and retry.'
            : undefined}
          onConfirm={() =>
            deleteApplicationMutation.mutateAsync(deleteCandidate.applicationId)}
          onCancel={() => {
            deleteApplicationMutation.reset()
            setDeleteCandidate(null)
          }}
        />
      ) : null}
    </section>
  )
}

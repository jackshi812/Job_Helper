import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import {
  companyName,
  dismissJob,
  listFeed,
  relativePostedTime,
  safeApplyUrl,
  tierPresentation,
  undismissJob,
  type FeedRow,
  type Tier,
} from '../lib/feed'
import {
  ALL_SCORE_TIERS,
  areAllCurrentCompaniesCleared,
  areAllCurrentCompaniesSelected,
  clearAllCompanies,
  copyHiddenCompanyKeys,
  dashboardCompanyOptions,
  filterDashboardRows,
  searchCompanyOptions,
  scoreTierSummary,
  selectAllCompanies,
  toggleHiddenCompanyKey,
  toggleScoreTier,
} from '../lib/dashboard'
import { listResumes, resumeLabel } from '../lib/resumes'
import {
  getDeterministicRankingState,
  loadPreferences,
  retryDeterministicRankingRun,
} from '../lib/preferences'
import { ColumnResizeHandle } from '../components/ColumnResizeHandle'
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

function PostedTime({ row }: { row: FeedRow }) {
  const timestamp = relativePostedTime(row)
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

export function Dashboard() {
  const queryClient = useQueryClient()
  const [showDismissed, setShowDismissed] = useState(false)
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
  const [columnWidths, setColumnWidths] = useState(loadDashboardColumnWidths)
  const columnWidthsRef = useRef(columnWidths)
  const resizeCoordinator = useRef<ColumnResizeCoordinator>({ activeColumnId: null })
  const companyTriggerRef = useRef<HTMLButtonElement>(null)
  const scoreTierTriggerRef = useRef<HTMLButtonElement>(null)
  const scoreTierPopoverRef = useRef<HTMLDivElement>(null)
  const firstScoreTierCheckboxRef = useRef<HTMLInputElement>(null)
  const observedActiveRevisionRef = useRef<number | null>(null)

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

  const feedQuery = useQuery({
    queryKey: ['feed'],
    queryFn: listFeed,
    refetchInterval: 60_000,
  })
  const rankingStateQuery = useQuery({
    queryKey: ['ranking-state'],
    queryFn: getDeterministicRankingState,
    refetchInterval: (query) =>
      query.state.data?.status === 'building' ? 2_000 : false,
  })
  const resumesQuery = useQuery({ queryKey: ['resumes'], queryFn: listResumes })
  const preferencesQuery = useQuery({ queryKey: ['preferences'], queryFn: loadPreferences })

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
    void queryClient.refetchQueries({ queryKey: ['feed'], exact: true })
  }, [queryClient, rankingStateQuery.data])

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

  const resumeNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const resume of resumesQuery.data ?? []) map.set(resume.id, resumeLabel(resume))
    return map
  }, [resumesQuery.data])

  const dismissMutation = useMutation({
    mutationFn: dismissJob,
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: ['feed'] })
      const previous = queryClient.getQueryData<FeedRow[]>(['feed'])
      queryClient.setQueryData<FeedRow[]>(['feed'], (rows) =>
        (rows ?? []).map((row) =>
          row.id === id ? { ...row, dismissed_at: new Date().toISOString() } : row,
        ),
      )
      return { previous }
    },
    onError: (_error, _id, context) => {
      if (context?.previous) queryClient.setQueryData(['feed'], context.previous)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['feed'] }),
  })

  const restoreMutation = useMutation({
    mutationFn: undismissJob,
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: ['feed'] })
      const previous = queryClient.getQueryData<FeedRow[]>(['feed'])
      queryClient.setQueryData<FeedRow[]>(['feed'], (rows) =>
        (rows ?? []).map((row) => (row.id === id ? { ...row, dismissed_at: null } : row)),
      )
      return { previous }
    },
    onError: (_error, _id, context) => {
      if (context?.previous) queryClient.setQueryData(['feed'], context.previous)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['feed'] }),
  })

  const companyOptions = useMemo(
    () => dashboardCompanyOptions(feedQuery.data ?? []),
    [feedQuery.data],
  )
  const searchedCompanyOptions = useMemo(
    () => searchCompanyOptions(companyOptions, companySearch),
    [companyOptions, companySearch],
  )

  const rows = useMemo(() => {
    const all = feedQuery.data ?? []
    const filtered = filterDashboardRows(all, {
      showDismissed,
      appliedHiddenKeys,
      selectedTiers,
    })
    const sorted = [...filtered]
    sorted.sort((a, b) => {
      if (sortByScore) {
        const sa = a.deterministic_score ?? -1
        const sb = b.deterministic_score ?? -1
        return scoreAscending ? sa - sb : sb - sa
      }
      const ta = relativePostedTime(a)
      const tb = relativePostedTime(b)
      return (tb ? Date.parse(tb) : 0) - (ta ? Date.parse(ta) : 0)
    })
    return sorted
  }, [
    feedQuery.data,
    showDismissed,
    appliedHiddenKeys,
    selectedTiers,
    sortByScore,
    scoreAscending,
  ])

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
    if (!sortByScore) {
      setSortByScore(true)
      setScoreAscending(false)
      return
    }
    setScoreAscending((ascending) => !ascending)
  }

  const scoreAriaSort = sortByScore ? (scoreAscending ? 'ascending' : 'descending') : 'none'
  const hasPreferences = preferencesQuery.data !== null && preferencesQuery.data !== undefined
  const rankingState = rankingStateQuery.data
  const tableWidth = dashboardTableWidth(columnWidths)

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
      <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        New postings ranked against your preferences, newest first.
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          aria-pressed={showDismissed}
          onClick={() => setShowDismissed((value) => !value)}
          className={`${filterButtonBase} ${showDismissed ? filterActive : filterInactive}`}
        >
          Show dismissed
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
        {rankingAnnouncement}
      </p>

      {!feedQuery.isPending && !feedQuery.error ? (
        <p role="status" aria-live="polite" className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
          {rows.length} jobs shown
        </p>
      ) : null}

      <div
        role="region"
        aria-label="Job matches; scroll horizontally to view all columns"
        tabIndex={0}
        className="mt-8 overflow-x-auto rounded-lg border border-zinc-200 bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:focus-visible:outline-zinc-100"
      >
        {feedQuery.isPending ? (
          <p className="p-4 text-sm text-zinc-600 dark:text-zinc-400">Loading…</p>
        ) : feedQuery.error ? (
          <div className="p-4">
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              Couldn’t load your matches. Check your connection and retry.
            </p>
            <button
              type="button"
              onClick={() => feedQuery.refetch()}
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
            ) : (
              <>
                <h2 className="text-base font-semibold">No matches yet</h2>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  New postings are ranked against your preferences within minutes of discovery.
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
                </DashboardHeaderCell>
                {DASHBOARD_COLUMNS.slice(5, 8).map((column) => (
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
                  column={DASHBOARD_COLUMNS[8]}
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
                const bestFit = row.deterministic_best_fit_resume_id
                  ? resumeNames.get(row.deterministic_best_fit_resume_id)
                  : undefined
                const runnerUp = row.deterministic_runner_up_resume_id
                  ? resumeNames.get(row.deterministic_runner_up_resume_id)
                  : undefined
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
                      {bestFit ? (
                        <div className="grid gap-1.5">
                          <span className="inline-flex w-fit items-center rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-0.5 text-xs font-semibold text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
                            Best fit: {bestFit}
                          </span>
                          {runnerUp ? (
                            <span className="text-xs text-zinc-500">also fits {runnerUp}</span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-zinc-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <PostedTime row={row} />
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
                      <div className="flex justify-end">
                        {row.dismissed_at !== null ? (
                          <button
                            type="button"
                            aria-label={`Restore ${jobTitle}`}
                            onClick={() => restoreMutation.mutate(row.id)}
                            className="min-h-9 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-semibold hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:focus-visible:outline-zinc-100"
                          >
                            Restore
                          </button>
                        ) : (
                          <button
                            type="button"
                            aria-label={`Dismiss ${jobTitle}`}
                            onClick={() => dismissMutation.mutate(row.id)}
                            className="min-h-9 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-semibold hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:focus-visible:outline-zinc-100"
                          >
                            Dismiss
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}

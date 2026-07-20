import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import {
  companyName,
  defaultVisible,
  dismissJob,
  filteredReasonLabel,
  listFeed,
  relativePostedTime,
  safeApplyUrl,
  scoreFreshnessLabel,
  tierPresentation,
  undismissJob,
  type FeedRow,
} from '../lib/feed'
import { listResumes, resumeLabel } from '../lib/resumes'
import { loadPreferences } from '../lib/preferences'

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

function TierBadge({ score }: { score: number | null }) {
  const presentation = tierPresentation(score)
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

export function Dashboard() {
  const queryClient = useQueryClient()
  const [viewAll, setViewAll] = useState(false)
  const [showDismissed, setShowDismissed] = useState(false)
  const [sortByScore, setSortByScore] = useState(false)
  const [scoreAscending, setScoreAscending] = useState(false)

  const feedQuery = useQuery({
    queryKey: ['feed'],
    queryFn: listFeed,
    refetchInterval: 60_000,
  })
  const resumesQuery = useQuery({ queryKey: ['resumes'], queryFn: listResumes })
  const preferencesQuery = useQuery({ queryKey: ['preferences'], queryFn: loadPreferences })

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

  const rows = useMemo(() => {
    const all = feedQuery.data ?? []
    const filtered = all.filter((row) => {
      if (showDismissed) return row.dismissed_at !== null
      if (row.dismissed_at !== null) return false
      if (viewAll) return true
      return defaultVisible(row)
    })
    const sorted = [...filtered]
    sorted.sort((a, b) => {
      if (sortByScore) {
        const sa = a.score ?? -1
        const sb = b.score ?? -1
        return scoreAscending ? sa - sb : sb - sa
      }
      const ta = relativePostedTime(a)
      const tb = relativePostedTime(b)
      return (tb ? Date.parse(tb) : 0) - (ta ? Date.parse(ta) : 0)
    })
    return sorted
  }, [feedQuery.data, showDismissed, viewAll, sortByScore, scoreAscending])

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

  return (
    <section>
      <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        New postings scored against your resumes and preferences, newest first.
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          aria-pressed={viewAll}
          onClick={() => setViewAll((value) => !value)}
          className={`${filterButtonBase} ${viewAll ? filterActive : filterInactive}`}
        >
          All jobs
        </button>
        <button
          type="button"
          aria-pressed={showDismissed}
          onClick={() => setShowDismissed((value) => !value)}
          className={`${filterButtonBase} ${showDismissed ? filterActive : filterInactive}`}
        >
          Show dismissed
        </button>
      </div>

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
            <h2 className="text-base font-semibold">No matches yet</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              New postings are scored against your resumes and preferences within minutes of
              discovery. Set your preferences to start matching.
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
          </div>
        ) : (
          <table className="w-full min-w-[72rem] border-collapse text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold tracking-wide text-zinc-600 uppercase dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
              <tr>
                <th scope="col" className="px-4 py-2.5">New</th>
                <th scope="col" className="px-4 py-2.5">Job</th>
                <th scope="col" className="px-4 py-2.5">Company</th>
                <th scope="col" className="px-4 py-2.5" aria-sort={scoreAriaSort}>
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
                </th>
                <th scope="col" className="px-4 py-2.5">Match reason</th>
                <th scope="col" className="px-4 py-2.5">Best fit</th>
                <th scope="col" className="px-4 py-2.5">Posted</th>
                <th scope="col" className="px-4 py-2.5">Apply</th>
                <th scope="col" className="px-4 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {rows.map((row) => {
                const isFiltered = row.status === 'filtered'
                const applyUrl = safeApplyUrl(row.jobs?.absolute_url)
                const jobTitle = row.jobs?.title ?? 'Untitled role'
                const company = companyName(row)
                const bestFit = row.routed_resume_id ? resumeNames.get(row.routed_resume_id) : undefined
                const runnerUp = row.runner_up_resume_id
                  ? resumeNames.get(row.runner_up_resume_id)
                  : undefined
                const firstReason = row.reasons?.[0]
                const filteredLabel = filteredReasonLabel(row)
                const freshnessLabel = scoreFreshnessLabel(row)
                return (
                  <tr
                    key={row.id}
                    className={`hover:bg-zinc-50 focus-within:bg-zinc-50 dark:hover:bg-zinc-800/50 dark:focus-within:bg-zinc-800/50 ${isFiltered ? 'text-zinc-500' : ''}`}
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
                    <td className="max-w-64 px-4 py-3">
                      <Link
                        to={`/jobs/${row.id}`}
                        className="text-zinc-900 underline decoration-1 underline-offset-4 hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:text-zinc-100 dark:focus-visible:outline-zinc-100"
                      >
                        {jobTitle}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{company ?? '—'}</td>
                    <td className="px-4 py-3">
                      {isFiltered ? (
                        <span className="text-xs">{filteredLabel ?? '—'}</span>
                      ) : row.score !== null ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold">{row.score}</span>
                          <TierBadge score={row.score} />
                          {freshnessLabel ? (
                            <span
                              title="Score and match details are from previous inputs; an update is pending."
                              className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
                            >
                              {freshnessLabel}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-zinc-500">—</span>
                      )}
                    </td>
                    <td className="max-w-72 px-4 py-3">
                      {isFiltered ? (
                        <span className="text-xs">{filteredLabel ?? '—'}</span>
                      ) : freshnessLabel ? (
                        <span className="text-xs text-amber-800 dark:text-amber-300">
                          Updating match details…
                        </span>
                      ) : firstReason ? (
                        <span className="line-clamp-2 text-xs">{firstReason}</span>
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

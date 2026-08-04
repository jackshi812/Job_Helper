import { useEffect, useMemo } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import DOMPurify from 'dompurify'
import {
  companyName,
  getFeedJob,
  markSeen,
  relativePostedTime,
  safeApplyUrl,
  tierPresentation,
  type DashboardFeedPage,
  type FeedRow,
  type RankingCategory,
  type Tier,
} from '../lib/feed'

const relativeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

const BREAKDOWN_ROWS: { key: RankingCategory; label: string }[] = [
  { key: 'title', label: 'Title match' },
  { key: 'location', label: 'Preferred location' },
  { key: 'recency', label: 'Posted within 24 hours' },
  { key: 'watchlist', label: 'Watchlist source' },
  { key: 'experience', label: 'Required experience' },
  { key: 'keywords', label: 'Description keywords' },
]

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
  const classes =
    presentation.badge === 'emerald'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400'
      : 'border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${classes}`}
    >
      {presentation.label}
    </span>
  )
}

function patchDashboardFeedSeen(
  data: InfiniteData<DashboardFeedPage, string | null> | undefined,
  jobId: string,
  seenAt: string,
): InfiniteData<DashboardFeedPage, string | null> | undefined {
  if (!data) return data
  let changed = false
  const pages = data.pages.map((page) => {
    let pageChanged = false
    const rows = page.rows.map((feedRow) => {
      if (feedRow.id !== jobId || feedRow.seen_at === seenAt) return feedRow
      pageChanged = true
      return { ...feedRow, seen_at: seenAt }
    })
    if (!pageChanged) return page
    changed = true
    return { ...page, rows }
  })
  return changed ? { ...data, pages } : data
}

function RankingBreakdown({ feedRow }: { feedRow: FeedRow }) {
  const byCategory = new Map(
    (feedRow.deterministic_breakdown ?? []).map((row) => [row.key, row]),
  )

  return (
    <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-base font-semibold">Ranking breakdown</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-[640px] w-full border-collapse text-left text-sm">
          <caption className="sr-only">Deterministic ranking breakdown</caption>
          <thead className="border-b border-zinc-200 text-xs font-semibold tracking-wide text-zinc-600 uppercase dark:border-zinc-800 dark:text-zinc-400">
            <tr>
              <th scope="col">Category</th>
              <th scope="col">Points</th>
              <th scope="col">Evidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {BREAKDOWN_ROWS.map(({ key, label }) => {
              const row = byCategory.get(key)
              return (
                <tr key={key}>
                  <th scope="row" className="py-3 pr-4 font-medium">
                    {label}
                  </th>
                  <td
                    aria-label={row ? `${row.earned} of ${row.possible} points` : undefined}
                    className="py-3 pr-4 whitespace-nowrap tabular-nums"
                  >
                    {row ? `${row.earned} / ${row.possible}` : '—'}
                  </td>
                  <td className="py-3 text-zinc-600 break-words dark:text-zinc-400">
                    {row && row.evidence.length > 0 ? row.evidence.join(', ') : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="border-t-2 border-zinc-300 font-semibold dark:border-zinc-700">
            <tr>
              <th scope="row" className="py-3 pr-4">Total</th>
              <td
                aria-label={`${feedRow.deterministic_score ?? 0} of 100 points`}
                className="py-3 pr-4 whitespace-nowrap tabular-nums"
              >
                {feedRow.deterministic_score ?? 0} / 100
              </td>
              <td className="py-3">{feedRow.deterministic_tier ?? '—'}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}

export function JobDetail() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()

  const jobQuery = useQuery({
    queryKey: ['job', id],
    queryFn: () => getFeedJob(id as string),
    enabled: Boolean(id),
  })

  const seenMutation = useMutation({
    mutationFn: markSeen,
    onSuccess: (_result, seenId) => {
      const seenAt = new Date().toISOString()
      queryClient.setQueryData<FeedRow>(['job', seenId], (current) => (
        current?.id === seenId ? { ...current, seen_at: seenAt } : current
      ))
      queryClient.setQueriesData<InfiniteData<DashboardFeedPage, string | null>>(
        { queryKey: ['dashboard-feed'] },
        (current) => patchDashboardFeedSeen(current, seenId, seenAt),
      )
    },
  })

  // Mark seen the first time the detail loads for an unseen row (UI-SPEC New-badge
  // lifecycle: cleared when the detail opens, not on feed render). markSeen is
  // itself conditional (.is('seen_at', null)) so this fires at most one write.
  const row = jobQuery.data
  const unseen = row?.seen_at === null
  const descriptionHtml = row?.jobs?.description_html ?? null
  const sanitizedDescription = useMemo(
    () => descriptionHtml
      ? DOMPurify.sanitize(descriptionHtml, { FORBID_TAGS: ['style', 'form'] })
      : null,
    [descriptionHtml],
  )
  useEffect(() => {
    if (row && unseen && id && !seenMutation.isPending) {
      seenMutation.mutate(id)
    }
    // Only re-run when the loaded row's seen state or id changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id, unseen, id])

  if (jobQuery.isPending) {
    return <p className="p-4 text-sm text-zinc-600 dark:text-zinc-400">Loading…</p>
  }
  if (jobQuery.error || !row) {
    return (
      <section>
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          Couldn’t load this job. Check your connection and retry.
        </p>
        <Link
          to="/"
          className="mt-3 inline-block text-sm text-zinc-900 underline decoration-1 underline-offset-4 dark:text-zinc-100"
        >
          Back to matches
        </Link>
      </section>
    )
  }

  const job = row.jobs
  const jobTitle = job?.title ?? 'Untitled role'
  const company = companyName(row)
  const applyUrl = safeApplyUrl(job?.absolute_url)
  const postedTimestamp = relativePostedTime(row)
  return (
    <section>
      <Link
        to="/"
        className="text-sm text-zinc-600 underline decoration-1 underline-offset-4 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        ← Back to matches
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{jobTitle}</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {[company ?? '—', job?.location ?? '—', postedTimestamp ? relativeTime(postedTimestamp) : undefined]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <div className="mt-2 flex items-center gap-2">
            {row.deterministic_score !== null ? (
              <span className="text-sm font-semibold">{row.deterministic_score}</span>
            ) : null}
            <TierBadge tier={row.deterministic_tier} />
            {row.deterministic_ranked_at ? (
              <span className="text-xs text-zinc-500">
                ranked {relativeTime(row.deterministic_ranked_at)}
              </span>
            ) : null}
          </div>
        </div>
        {applyUrl ? (
          <a
            href={applyUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Apply to ${jobTitle} in a new tab`}
            className="inline-flex min-h-9 items-center gap-1 rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 [@media(pointer:coarse)]:min-h-11 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white dark:focus-visible:outline-zinc-100"
          >
            Apply <span aria-hidden="true">↗</span>
          </a>
        ) : null}
      </div>

      <RankingBreakdown feedRow={row} />

      <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-base font-semibold">Job description</h2>
        {sanitizedDescription !== null ? (
          <div
            className="mt-3 max-w-none text-sm [&_a]:underline [&_h1]:text-base [&_h2]:text-base [&_h3]:text-base [&_li]:my-1 [&_ul]:list-disc [&_ul]:pl-5"
            // The raw description_html never reaches the DOM unsanitized: DOMPurify
            // strips scripts/handlers and, per config, style/form tags (T-3-15).
            dangerouslySetInnerHTML={{ __html: sanitizedDescription }}
          />
        ) : job?.description_text ? (
          <pre className="mt-3 font-sans whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
            {job.description_text}
          </pre>
        ) : (
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            No description snapshot is available for this posting.
          </p>
        )}
      </section>
    </section>
  )
}

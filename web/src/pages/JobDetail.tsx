import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import DOMPurify from 'dompurify'
import {
  companyName,
  getFeedJob,
  markSeen,
  relativePostedTime,
  safeApplyUrl,
  tierPresentation,
  type FeedRow,
  type GapGroups,
} from '../lib/feed'
import { listResumes } from '../lib/resumes'

const relativeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

const GAP_GROUPS: { key: keyof GapGroups; label: string }[] = [
  { key: 'skills', label: 'Skills' },
  { key: 'tools', label: 'Tools' },
  { key: 'certs', label: 'Certs' },
  { key: 'domain', label: 'Domain' },
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

function TierBadge({ score }: { score: number | null }) {
  const presentation = tierPresentation(score)
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

function Chip({ label, tone }: { label: string; tone: 'neutral' | 'emerald' }) {
  const classes =
    tone === 'emerald'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400'
      : 'border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400'
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${classes}`}
    >
      {label}
    </span>
  )
}

function GapPanel({ row, resumeName }: { row: FeedRow; resumeName: string }) {
  const gaps = row.gaps ?? {}
  const covered = row.covered ?? []
  const hasGaps = GAP_GROUPS.some((group) => (gaps[group.key]?.length ?? 0) > 0)

  return (
    <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-base font-semibold">Gaps vs your {resumeName} resume — advisory only</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Keywords in the posting, grouped by category, that are missing from the routed resume.
        Advisory only — it never changes your resume.
      </p>
      {hasGaps ? (
        <div className="mt-4 grid gap-4">
          {GAP_GROUPS.map((group) => {
            const items = gaps[group.key] ?? []
            if (items.length === 0) return null
            return (
              <div key={group.key} className="grid gap-1.5">
                <span className="text-xs font-semibold tracking-wide text-zinc-600 uppercase dark:text-zinc-400">
                  {group.label}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {items.map((item) => (
                    <Chip key={`${group.key}-${item}`} label={item} tone="neutral" />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
          No gaps found against your {resumeName} resume.
        </p>
      )}
      {covered.length > 0 ? (
        <div className="mt-4 grid gap-1.5">
          <span className="text-xs font-semibold tracking-wide text-zinc-600 uppercase dark:text-zinc-400">
            Covered
          </span>
          <div className="flex flex-wrap gap-1.5">
            {covered.map((item) => (
              <Chip key={`covered-${item}`} label={item} tone="emerald" />
            ))}
          </div>
        </div>
      ) : null}
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
  const resumesQuery = useQuery({ queryKey: ['resumes'], queryFn: listResumes })

  const seenMutation = useMutation({
    mutationFn: markSeen,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['feed'] })
      await queryClient.invalidateQueries({ queryKey: ['job', id] })
    },
  })

  // Mark seen the first time the detail loads for an unseen row (UI-SPEC New-badge
  // lifecycle: cleared when the detail opens, not on feed render). markSeen is
  // itself conditional (.is('seen_at', null)) so this fires at most one write.
  const row = jobQuery.data
  const unseen = row?.seen_at === null
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
  const resumeName = row.routed_resume_id
    ? resumesQuery.data?.find((resume) => resume.id === row.routed_resume_id)?.filename ?? 'routed'
    : 'routed'
  const sanitizedDescription = job?.description_html
    ? DOMPurify.sanitize(job.description_html, { FORBID_TAGS: ['style', 'form'] })
    : null

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
            {[company ?? '—', job?.location ?? undefined, postedTimestamp ? relativeTime(postedTimestamp) : undefined]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <div className="mt-2 flex items-center gap-2">
            {row.score !== null ? (
              <span className="text-sm font-semibold">{row.score}</span>
            ) : null}
            <TierBadge score={row.score} />
            {row.scored_at ? (
              <span className="text-xs text-zinc-500">scored {relativeTime(row.scored_at)}</span>
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

      <GapPanel row={row} resumeName={resumeName} />

      <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-base font-semibold">Match reasons</h2>
        {row.reasons && row.reasons.length > 0 ? (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
            {row.reasons.slice(0, 5).map((reason, index) => (
              <li key={`${index}-${reason}`}>{reason}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            No match reasons recorded yet.
          </p>
        )}
      </section>

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

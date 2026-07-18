import { useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ConfirmDialog } from '../components/ConfirmDialog'
import {
  activationPresentation,
  addCompany,
  healthPresentation,
  listCompanies,
  removeCompany,
  safeCareersUrl,
  type WatchlistRow,
} from '../lib/watchlist'

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })
const fullDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})
const relativeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

const activationStyles = {
  Active: 'border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  Experimental: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
  Disabled: 'border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400',
} as const

const healthStyles = {
  OK: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400',
  Degraded: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
  Unsupported: 'border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400',
} as const

function boundedErrorMessage(error: unknown) {
  const fallback = 'Something went wrong. Please try again.'
  if (!(error instanceof Error)) return fallback
  const message = error.message.trim()
  if (!message || /https?:|token|secret|stack|<html/i.test(message)) return fallback
  return message.slice(0, 120)
}

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

function StatusBadge({
  label,
  classes,
}: {
  label: string
  classes: string
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold ${classes}`}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  )
}

function CareersLink({ row }: { row: WatchlistRow }) {
  const safeUrl = safeCareersUrl(row.careers_url)
  if (!safeUrl) {
    return <span className="text-zinc-500 dark:text-zinc-500">Unavailable</span>
  }

  return (
    <a
      href={safeUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${row.name} jobs in a new tab`}
      className="inline-flex min-h-9 items-center gap-1 rounded-sm text-zinc-900 underline decoration-1 underline-offset-4 hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:text-zinc-100 dark:focus-visible:outline-zinc-100"
    >
      Open jobs <span aria-hidden="true">↗</span>
    </a>
  )
}

function ActivationBadge({ row }: { row: WatchlistRow }) {
  const presentation = activationPresentation(row)
  return (
    <div className="grid gap-1.5">
      <div><StatusBadge label={presentation.label} classes={activationStyles[presentation.label]} /></div>
      {presentation.details.map((detail) => (
        <span key={detail} className="text-xs leading-[1.4] text-zinc-600 dark:text-zinc-400">
          {detail}
        </span>
      ))}
    </div>
  )
}

function LastSuccess({ timestamp }: { timestamp: string | null }) {
  if (!timestamp || !Number.isFinite(new Date(timestamp).getTime())) {
    return <span>No successful sync yet</span>
  }
  const fullDate = fullDateFormatter.format(new Date(timestamp))
  return (
    <span>
      Last success{' '}
      <time dateTime={timestamp} title={fullDate} aria-label={`Last success ${fullDate}`}>
        {relativeTime(timestamp)}
      </time>
    </span>
  )
}

function HealthStatus({ row }: { row: WatchlistRow }) {
  const presentation = healthPresentation(row)
  return (
    <div className="grid max-w-[17rem] gap-1.5">
      <div><StatusBadge label={presentation.label} classes={healthStyles[presentation.label]} /></div>
      {presentation.label !== 'Unsupported' ? (
        <span className="text-xs leading-[1.4] text-zinc-600 dark:text-zinc-400">
          <LastSuccess timestamp={row.last_success_at} />
        </span>
      ) : null}
      {presentation.detail ? (
        <span className="line-clamp-2 text-xs leading-[1.4] text-zinc-600 dark:text-zinc-400">
          {presentation.detail}
        </span>
      ) : null}
      {presentation.retention ? (
        <span className="text-xs leading-[1.4] text-zinc-600 dark:text-zinc-400">
          {presentation.retention}
        </span>
      ) : null}
    </div>
  )
}

export function Watchlist() {
  const queryClient = useQueryClient()
  const urlInput = useRef<HTMLInputElement>(null)
  const [companyToRemove, setCompanyToRemove] = useState<WatchlistRow | null>(null)

  const companiesQuery = useQuery({
    queryKey: ['watchlist'],
    queryFn: listCompanies,
    refetchInterval: 60_000,
  })
  const addMutation = useMutation({
    mutationFn: addCompany,
    onSuccess: async () => {
      if (urlInput.current) urlInput.current.value = ''
      await queryClient.invalidateQueries({ queryKey: ['watchlist'] })
    },
  })
  const removeMutation = useMutation({
    mutationFn: removeCompany,
    onSuccess: async () => {
      setCompanyToRemove(null)
      await queryClient.invalidateQueries({ queryKey: ['watchlist'] })
    },
  })

  function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const url = urlInput.current?.value.trim()
    if (!url) return
    addMutation.reset()
    addMutation.mutate(url)
  }

  return (
    <section>
      <h1 className="text-xl font-semibold tracking-tight">Watchlist</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Companies and career sites tracked for new postings. Monitoring state and source health are shown separately.
      </p>

      <form onSubmit={handleAdd} className="mt-6 flex flex-wrap items-end gap-3">
        <label className="grid gap-1.5 text-sm font-semibold max-sm:w-full">
          Careers page URL
          <input
            ref={urlInput}
            type="url"
            placeholder="https://boards.greenhouse.io/company"
            required
            disabled={addMutation.isPending}
            className="w-80 max-w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:cursor-wait disabled:opacity-60 max-sm:w-full dark:border-zinc-700 dark:bg-zinc-900 dark:focus-visible:outline-zinc-100"
          />
        </label>
        <button
          type="submit"
          disabled={addMutation.isPending}
          className="min-h-9 rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:cursor-wait disabled:opacity-60 [@media(pointer:coarse)]:min-h-11 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white dark:focus-visible:outline-zinc-100"
        >
          {addMutation.isPending ? 'Verifying…' : 'Add company'}
        </button>
      </form>

      {addMutation.error ? (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">
          Couldn’t add this company. Check that the URL is public and supported, then try again.
        </p>
      ) : null}
      {removeMutation.error ? (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">
          Remove failed: {boundedErrorMessage(removeMutation.error)}
        </p>
      ) : null}

      <div
        role="region"
        aria-label="Watchlist; scroll horizontally to view all columns"
        tabIndex={0}
        className="mt-8 overflow-x-auto rounded-lg border border-zinc-200 bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:focus-visible:outline-zinc-100"
      >
        {companiesQuery.isPending ? (
          <p className="p-4 text-sm text-zinc-600 dark:text-zinc-400">Loading watchlist…</p>
        ) : companiesQuery.error ? (
          <p role="alert" className="p-4 text-sm text-red-700 dark:text-red-400">
            Unable to load the watchlist. Refresh the page to try again.
          </p>
        ) : companiesQuery.data.length === 0 ? (
          <div className="p-4">
            <h2 className="text-base font-semibold">No companies watched yet</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Paste a public careers or job-search URL above. Supported sources are verified before monitoring begins.
            </p>
          </div>
        ) : (
          <table className="w-full min-w-[68rem] border-collapse text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold tracking-wide text-zinc-600 uppercase dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
              <tr>
                <th scope="col" className="px-4 py-2.5">Company</th>
                <th scope="col" className="px-4 py-2.5">Link</th>
                <th scope="col" className="px-4 py-2.5">Source</th>
                <th scope="col" className="px-4 py-2.5">Activation</th>
                <th scope="col" className="px-4 py-2.5">Health</th>
                <th scope="col" className="px-4 py-2.5">Added</th>
                <th scope="col" className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {companiesQuery.data.map((row) => (
                <tr key={row.key} className="hover:bg-zinc-50 focus-within:bg-zinc-50 dark:hover:bg-zinc-800/50 dark:focus-within:bg-zinc-800/50">
                  <td className="max-w-48 truncate px-4 py-3 font-semibold" title={row.name}>{row.name}</td>
                  <td className="px-4 py-3"><CareersLink row={row} /></td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{row.provider}</td>
                  <td className="px-4 py-3"><ActivationBadge row={row} /></td>
                  <td className="px-4 py-3"><HealthStatus row={row} /></td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                    {row.created_at ? dateFormatter.format(new Date(row.created_at)) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      {row.company_id ? (
                        <button
                          type="button"
                          aria-label={`Remove ${row.name}`}
                          onClick={() => {
                            removeMutation.reset()
                            setCompanyToRemove(row)
                          }}
                          className="min-h-9 rounded-md border border-red-300 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950 dark:focus-visible:outline-red-400"
                        >
                          Remove
                        </button>
                      ) : (
                        <span aria-label="No action available" className="text-zinc-400">—</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {companyToRemove?.company_id ? (
        <ConfirmDialog
          title={`Remove ${companyToRemove.name}?`}
          message="Polling stops immediately. Jobs already captured stay in the system."
          confirmLabel="Remove company"
          cancelLabel="Keep company"
          pendingLabel="Removing…"
          initialFocus="cancel"
          onCancel={() => setCompanyToRemove(null)}
          onConfirm={() => removeMutation.mutateAsync(companyToRemove.company_id!)}
        />
      ) : null}
    </section>
  )
}

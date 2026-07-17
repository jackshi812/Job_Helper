import { useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ConfirmDialog } from '../components/ConfirmDialog'
import {
  addCompany,
  deriveHealth,
  listCompanies,
  removeCompany,
  type CompanyRecord,
  type HealthStatus,
} from '../lib/watchlist'

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })
const relativeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

const healthStyles: Record<HealthStatus, { label: string; classes: string; dot: string }> = {
  ok: {
    label: 'OK',
    classes: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400',
    dot: 'bg-emerald-500',
  },
  failing: {
    label: 'Failing',
    classes: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400',
    dot: 'bg-red-500',
  },
  stale: {
    label: 'Stale',
    classes: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400',
    dot: 'bg-amber-500',
  },
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

function relativeTime(timestamp: string) {
  const elapsedSeconds = Math.round((new Date(timestamp).getTime() - Date.now()) / 1000)
  if (Math.abs(elapsedSeconds) < 60) return relativeFormatter.format(elapsedSeconds, 'second')

  const elapsedMinutes = Math.round(elapsedSeconds / 60)
  if (Math.abs(elapsedMinutes) < 60) return relativeFormatter.format(elapsedMinutes, 'minute')

  const elapsedHours = Math.round(elapsedMinutes / 60)
  if (Math.abs(elapsedHours) < 24) return relativeFormatter.format(elapsedHours, 'hour')
  return relativeFormatter.format(Math.round(elapsedHours / 24), 'day')
}

function HealthBadge({ company }: { company: CompanyRecord }) {
  const style = healthStyles[deriveHealth(company)]
  const title = company.last_success_at
    ? `Last successful poll: ${relativeTime(company.last_success_at)}`
    : 'No successful poll yet'

  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${style.classes}`}
    >
      <span aria-hidden="true" className={`size-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  )
}

export function Watchlist() {
  const queryClient = useQueryClient()
  const urlInput = useRef<HTMLInputElement>(null)
  const [companyToRemove, setCompanyToRemove] = useState<CompanyRecord | null>(null)

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
        Companies polled every few minutes for new postings. Shared between both users.
      </p>

      <form onSubmit={handleAdd} className="mt-6 flex flex-wrap items-end gap-3">
        <label className="grid gap-1.5 text-sm font-medium">
          Careers page URL
          <input
            ref={urlInput}
            type="url"
            placeholder="https://boards.greenhouse.io/company"
            required
            disabled={addMutation.isPending}
            className="w-80 max-w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm disabled:cursor-wait disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <button
          type="submit"
          disabled={addMutation.isPending}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-wait disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          {addMutation.isPending ? 'Verifying…' : 'Add company'}
        </button>
      </form>

      {addMutation.error ? (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">
          {errorMessage(addMutation.error)}
        </p>
      ) : null}
      {removeMutation.error ? (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">
          Remove failed: {errorMessage(removeMutation.error)}
        </p>
      ) : null}

      <div className="mt-8 overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        {companiesQuery.isPending ? (
          <p className="p-4 text-sm text-zinc-600 dark:text-zinc-400">Loading watchlist…</p>
        ) : companiesQuery.error ? (
          <p role="alert" className="p-4 text-sm text-red-700 dark:text-red-400">
            Unable to load the watchlist: {errorMessage(companiesQuery.error)}
          </p>
        ) : companiesQuery.data.length === 0 ? (
          <div className="p-4">
            <h2 className="text-base font-semibold">No companies watched yet</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Paste a careers page URL above to start monitoring. Works with Greenhouse, Lever, and Ashby job boards.
            </p>
          </div>
        ) : (
          <table className="w-full min-w-2xl border-collapse text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-medium tracking-wide text-zinc-600 uppercase dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
              <tr>
                <th scope="col" className="px-4 py-2.5">Company</th>
                <th scope="col" className="px-4 py-2.5">Source</th>
                <th scope="col" className="px-4 py-2.5">Health</th>
                <th scope="col" className="px-4 py-2.5">Added</th>
                <th scope="col" className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {companiesQuery.data.map((company) => (
                <tr key={company.id}>
                  <td className="max-w-sm truncate px-4 py-3 font-medium">{company.name}</td>
                  <td className="px-4 py-3 text-zinc-600 capitalize dark:text-zinc-400">{company.ats_type}</td>
                  <td className="px-4 py-3"><HealthBadge company={company} /></td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                    {dateFormatter.format(new Date(company.created_at))}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          removeMutation.reset()
                          setCompanyToRemove(company)
                        }}
                        className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {companyToRemove ? (
        <ConfirmDialog
          title={`Remove ${companyToRemove.name}?`}
          message="Polling stops immediately. Jobs already captured stay in the system."
          confirmLabel="Remove company"
          onCancel={() => setCompanyToRemove(null)}
          onConfirm={() => removeMutation.mutateAsync(companyToRemove.id)}
        />
      ) : null}
    </section>
  )
}

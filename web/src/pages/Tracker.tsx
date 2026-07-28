import { useQuery } from '@tanstack/react-query'
import {
  listTrackerApplications,
  TRACKER_STAGES,
  type TrackerStage,
} from '../lib/tracker'

const stageStyles: Record<TrackerStage, string> = {
  ready_to_apply:
    'border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300',
  applied:
    'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300',
  outreach_sent:
    'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-900 dark:bg-cyan-950 dark:text-cyan-300',
  interview:
    'border-lime-200 bg-lime-50 text-lime-800 dark:border-lime-900 dark:bg-lime-950 dark:text-lime-300',
  offer:
    'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
  rejected:
    'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300',
}

const stageLabels = new Map(TRACKER_STAGES.map(({ slug, label }) => [slug, label]))

export function Tracker() {
  const applicationsQuery = useQuery({
    queryKey: ['tracker-applications'],
    queryFn: () => listTrackerApplications(),
  })

  return (
    <section>
      <h1 className="text-xl font-semibold tracking-tight">Tracker</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Track applications, update stages, and keep every follow-up in one place.
      </p>

      <div
        role="region"
        aria-label="Applications; scroll horizontally to view all columns"
        tabIndex={0}
        className="mt-8 overflow-x-auto rounded-lg border border-zinc-200 bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:focus-visible:outline-zinc-100"
      >
        {applicationsQuery.isPending ? (
          <p className="p-4 text-sm text-zinc-600 dark:text-zinc-400">
            Loading applications…
          </p>
        ) : applicationsQuery.error ? (
          <div className="p-4">
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              Couldn’t load your applications. Check your connection and retry.
            </p>
            <button
              type="button"
              onClick={() => void applicationsQuery.refetch()}
              className="mt-3 min-h-9 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-semibold hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:focus-visible:outline-zinc-100"
            >
              Retry
            </button>
          </div>
        ) : applicationsQuery.data?.length ? (
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead className="sticky top-0 border-b border-zinc-200 bg-zinc-50 text-xs font-semibold tracking-wide text-zinc-600 uppercase dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
              <tr>
                <th scope="col" className="px-4 py-2">Company</th>
                <th scope="col" className="px-4 py-2">Position</th>
                <th scope="col" className="px-4 py-2">Stage</th>
                <th scope="col" className="px-4 py-2">Stage date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {applicationsQuery.data.map((application) => (
                <tr
                  key={application.id}
                  className="min-h-11 hover:bg-zinc-50 focus-within:bg-zinc-50 dark:hover:bg-zinc-800/50 dark:focus-within:bg-zinc-800/50"
                >
                  <td className="border-l-4 border-blue-400 px-4 py-3 dark:border-blue-700">
                    {application.company}
                  </td>
                  <td className="px-4 py-3 font-semibold">{application.title}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${stageStyles[application.currentStage]}`}
                    >
                      {stageLabels.get(application.currentStage)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                    <time dateTime={application.currentStageDate}>
                      {application.currentStageDate}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-8">
            <h2 className="text-base font-semibold">No applications yet</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Mark a Dashboard job applied to add its saved snapshot here.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { NavLink, Outlet, useNavigate } from 'react-router'
import { fetchHeartbeat } from '../lib/pipeline'
import { supabase } from '../lib/supabase'

const STALE_AFTER_MS = 30 * 60_000
const heartbeatTimeFormatter = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' })

function staleHeartbeatMessage(lastSuccessAt: string | null) {
  if (!lastSuccessAt) {
    return "Job monitoring hasn't run yet — new postings may be missed."
  }

  return `Job monitoring hasn't run since ${heartbeatTimeFormatter.format(new Date(lastSuccessAt))} — new postings may be missed.`
}

const navigation = [
  { label: 'Dashboard', to: '/' },
  { label: 'Watchlist', to: '/watchlist' },
  { label: 'Resumes', to: '/resumes' },
  { label: 'Tracker', to: '/tracker' },
  { label: 'Settings', to: '/settings' },
]

export function Shell() {
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState('')
  const heartbeatQuery = useQuery({
    queryKey: ['pipeline_heartbeat'],
    queryFn: fetchHeartbeat,
    refetchInterval: 60_000,
  })
  const lastSuccessAt = heartbeatQuery.data?.last_success_at ?? null
  const lastSuccessTime = lastSuccessAt ? new Date(lastSuccessAt).getTime() : Number.NaN
  const heartbeatIsStale = heartbeatQuery.data !== undefined
    && (!Number.isFinite(lastSuccessTime) || Date.now() - lastSuccessTime > STALE_AFTER_MS)

  async function handleSignOut() {
    setSigningOut(true)
    setError('')
    const { error: signOutError } = await supabase.auth.signOut()
    setSigningOut(false)

    if (signOutError) {
      setError('Unable to sign out. Please try again.')
      return
    }

    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen bg-slate-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3 sm:px-6">
          <span className="mr-auto text-sm font-semibold tracking-tight">Job Copilot</span>
          <nav aria-label="Primary" className="order-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
            {navigation.map(({ label, to }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors ${
                    isActive
                      ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                      : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white'
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 disabled:cursor-wait disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
        {error ? (
          <p role="alert" className="mx-auto max-w-6xl px-4 pb-3 text-sm text-red-700 sm:px-6 dark:text-red-400">
            {error}
          </p>
        ) : null}
      </header>
      {heartbeatIsStale ? (
        <div className="border-b border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          <p role="status" className="mx-auto max-w-6xl px-4 py-2 text-sm sm:px-6">
            {staleHeartbeatMessage(lastSuccessAt)}
          </p>
        </div>
      ) : null}
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  )
}

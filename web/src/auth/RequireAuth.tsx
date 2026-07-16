import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useSession } from './AuthProvider'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useSession()
  const location = useLocation()

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 text-sm text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
        Loading…
      </main>
    )
  }

  // This route guard is only navigation UX; Supabase RLS is the security boundary.
  if (!session) return <Navigate to="/login" replace state={{ from: location }} />

  return children
}

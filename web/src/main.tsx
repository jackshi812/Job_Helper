import { Component, lazy, StrictMode, Suspense, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router'
import './index.css'
import { AuthProvider } from './auth/AuthProvider'
import { RequireAuth } from './auth/RequireAuth'
import { Shell } from './components/Shell'
import { createAppQueryClient } from './lib/queryClient'

const Dashboard = lazy(() => import('./pages/Dashboard').then((module) => ({
  default: module.Dashboard,
})))
const JobDetail = lazy(() => import('./pages/JobDetail').then((module) => ({
  default: module.JobDetail,
})))
const Login = lazy(() => import('./pages/Login').then((module) => ({
  default: module.Login,
})))
const Preferences = lazy(() => import('./pages/Preferences').then((module) => ({
  default: module.Preferences,
})))
const ResetPassword = lazy(() => import('./pages/ResetPassword').then((module) => ({
  default: module.ResetPassword,
})))
const Resumes = lazy(() => import('./pages/Resumes').then((module) => ({
  default: module.Resumes,
})))
const Settings = lazy(() => import('./pages/Settings').then((module) => ({
  default: module.Settings,
})))
const Tracker = lazy(() => import('./pages/Tracker').then((module) => ({
  default: module.Tracker,
})))
const Watchlist = lazy(() => import('./pages/Watchlist').then((module) => ({
  default: module.Watchlist,
})))

const queryClient = createAppQueryClient()

interface RouteLoadBoundaryProps {
  children: ReactNode
}

interface RouteLoadBoundaryState {
  failed: boolean
}

export class RouteLoadBoundary extends Component<
  RouteLoadBoundaryProps,
  RouteLoadBoundaryState
> {
  state: RouteLoadBoundaryState = { failed: false }

  static getDerivedStateFromError(): RouteLoadBoundaryState {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="grid min-h-screen place-items-center p-6">
          <section className="max-w-md rounded-lg border border-zinc-200 p-6 text-center dark:border-zinc-800">
            <h1 className="text-lg font-semibold">This page couldn’t load</h1>
            <p role="alert" className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Check your connection, then reload the page to try again.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 min-h-11 rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              Reload page
            </button>
          </section>
        </main>
      )
    }
    return this.props.children
  }
}

// Remove the retired notification worker and its browser-side subscription for
// users who enabled push before the feature was removed. Permission itself is a
// browser setting and cannot be reset programmatically.
async function removeLegacyNotificationWorker() {
  if (!('serviceWorker' in navigator)) return

  const registrations = await navigator.serviceWorker.getRegistrations()
  const legacyRegistrations = registrations.filter((registration) =>
    [registration.active, registration.waiting, registration.installing].some(
      (worker) => worker && new URL(worker.scriptURL).pathname === '/sw.js',
    ),
  )

  await Promise.all(
    legacyRegistrations.map(async (registration) => {
      const subscription = await registration.pushManager.getSubscription()
      await subscription?.unsubscribe()
      await registration.unregister()
    }),
  )
}

void removeLegacyNotificationWorker().catch(() => {
  // Hosted cleanup also deletes every server-side subscription, so a local
  // browser cleanup failure cannot restore delivery.
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <RouteLoadBoundary>
            <Suspense
              fallback={(
                <p role="status" aria-live="polite" className="p-4 text-sm">
                  Loading…
                </p>
              )}
            >
              <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route
                element={
                  <RequireAuth>
                    <Shell />
                  </RequireAuth>
                }
              >
                <Route index element={<Dashboard scope="watchlist" />} />
                <Route path="all-jobs" element={<Dashboard scope="all" />} />
                <Route path="jobs/:id" element={<JobDetail />} />
                <Route path="preferences" element={<Preferences />} />
                <Route path="watchlist" element={<Watchlist />} />
                <Route path="resumes" element={<Resumes />} />
                <Route path="tracker" element={<Tracker />} />
                <Route path="settings" element={<Settings />} />
              </Route>
              </Routes>
            </Suspense>
          </RouteLoadBoundary>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)

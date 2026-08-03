import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router'
import './index.css'
import { AuthProvider } from './auth/AuthProvider'
import { RequireAuth } from './auth/RequireAuth'
import { Shell } from './components/Shell'

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

const queryClient = new QueryClient()

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
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)

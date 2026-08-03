import { describe, expect, it } from 'vitest'
import mainSource from './main.tsx?raw'

const routePages = [
  'Dashboard',
  'JobDetail',
  'Login',
  'Preferences',
  'ResetPassword',
  'Resumes',
  'Settings',
  'Tracker',
  'Watchlist',
] as const

describe('application route loading', () => {
  it('loads every page module through a named-export lazy boundary', () => {
    for (const page of routePages) {
      expect(mainSource).not.toMatch(
        new RegExp(`import\\s+\\{\\s*${page}\\s*\\}\\s+from\\s+['\"]\\./pages/${page}['\"]`),
      )
      expect(mainSource).toMatch(
        new RegExp(`lazy\\(\\(\\) => import\\(['\"]\\./pages/${page}['\"]\\)`),
      )
      expect(mainSource).toContain(`default: module.${page}`)
    }
  })

  it('keeps providers, auth guards, Shell, and legacy cleanup eager', () => {
    expect(mainSource).toContain("import { AuthProvider } from './auth/AuthProvider'")
    expect(mainSource).toContain("import { RequireAuth } from './auth/RequireAuth'")
    expect(mainSource).toContain("import { Shell } from './components/Shell'")
    expect(mainSource).toContain('<QueryClientProvider client={queryClient}>')
    expect(mainSource).toContain('<BrowserRouter>')
    expect(mainSource).toContain('<AuthProvider>')
    expect(mainSource).toContain('<RequireAuth>')
    expect(mainSource).toContain('<Shell />')
    expect(mainSource).toContain('void removeLegacyNotificationWorker().catch')
  })

  it('preserves every route and Dashboard scope behind one accessible fallback', () => {
    expect(mainSource).toContain('<Route path="/login" element={<Login />} />')
    expect(mainSource).toContain('<Route path="/reset-password" element={<ResetPassword />} />')
    expect(mainSource).toContain('<Route index element={<Dashboard scope="watchlist" />} />')
    expect(mainSource).toContain('<Route path="all-jobs" element={<Dashboard scope="all" />} />')
    for (const route of [
      'jobs/:id',
      'preferences',
      'watchlist',
      'resumes',
      'tracker',
      'settings',
    ]) {
      expect(mainSource).toContain(`<Route path="${route}"`)
    }
    expect(mainSource.match(/<Suspense/g)).toHaveLength(1)
    expect(mainSource.match(/<\/Suspense>/g)).toHaveLength(1)
    expect(mainSource).toContain('role="status"')
    expect(mainSource).toContain('aria-live="polite"')
    expect(mainSource).toContain('Loading…')
  })
})

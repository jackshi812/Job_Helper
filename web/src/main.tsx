import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router'
import './index.css'
import { AuthProvider } from './auth/AuthProvider'
import { RequireAuth } from './auth/RequireAuth'
import { Shell } from './components/Shell'
import { Dashboard } from './pages/Dashboard'
import { Login } from './pages/Login'
import { Preferences } from './pages/Preferences'
import { ResetPassword } from './pages/ResetPassword'
import { Resumes } from './pages/Resumes'
import { Settings } from './pages/Settings'
import { Tracker } from './pages/Tracker'
import { Watchlist } from './pages/Watchlist'

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
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
              <Route index element={<Dashboard />} />
              <Route path="preferences" element={<Preferences />} />
              <Route path="watchlist" element={<Watchlist />} />
              <Route path="resumes" element={<Resumes />} />
              <Route path="tracker" element={<Tracker />} />
              <Route path="settings" element={<Settings />} />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)

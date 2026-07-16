import { createClient } from '@supabase/supabase-js'
import { inspectRecoveryCallback } from '../auth/recovery'

export const initialRecoveryCallback = typeof window === 'undefined'
  ? { kind: 'none', diagnostic: null } as const
  : inspectRecoveryCallback(window.location.href)

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const supabase = createClient(supabaseUrl, supabasePublishableKey)

// Verify a password without disturbing the active session. Uses a short-lived
// isolated client (no persistence, no token refresh) so a wrong password cannot
// mutate the real session and a correct one does not fire the app's auth listener.
// This is the code-level reauthentication guarantee for password changes — it does
// not depend on the server-side `security_update_password_require_reauthentication`
// flag (which is off on this project).
export async function reauthenticate(email: string, password: string) {
  const isolated = createClient(supabaseUrl, supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await isolated.auth.signInWithPassword({ email, password })
  return { error }
}

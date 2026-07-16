import { createClient } from '@supabase/supabase-js'
import { inspectRecoveryCallback } from '../auth/recovery'

export const initialRecoveryCallback = typeof window === 'undefined'
  ? { kind: 'none', diagnostic: null } as const
  : inspectRecoveryCallback(window.location.href)

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
)

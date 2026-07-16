import type { Session } from '@supabase/supabase-js'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useNavigate } from 'react-router'
import { initialRecoveryCallback, supabase } from '../lib/supabase'
import type { RecoveryDiagnostic, RecoveryStatus } from './recovery'

type AuthContextValue = {
  session: Session | null
  loading: boolean
  recoveryStatus: RecoveryStatus
  recoveryDiagnostic: RecoveryDiagnostic
  completePasswordRecovery: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [passwordRecovery, setPasswordRecovery] = useState(false)
  const [recoveryStatus, setRecoveryStatus] = useState<RecoveryStatus>(() => {
    if (initialRecoveryCallback.kind === 'pending') return 'checking'
    if (initialRecoveryCallback.kind === 'error') return 'invalid'
    return 'idle'
  })
  const [recoveryDiagnostic, setRecoveryDiagnostic] = useState<RecoveryDiagnostic>(
    initialRecoveryCallback.diagnostic,
  )

  useEffect(() => {
    let active = true

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setLoading(false)
    })

    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      // Keep this callback synchronous: awaiting other Supabase calls here can deadlock.
      setSession(nextSession)
      setLoading(false)
      if (event === 'PASSWORD_RECOVERY') {
        if (nextSession) {
          setRecoveryStatus('ready')
          setRecoveryDiagnostic(null)
          setPasswordRecovery(true)
        } else {
          setRecoveryStatus('invalid')
          setRecoveryDiagnostic('session_missing')
        }
      } else if (event === 'SIGNED_OUT') {
        setRecoveryStatus('idle')
        setRecoveryDiagnostic(null)
      }
    })

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (initialRecoveryCallback.kind === 'error') {
      console.warn('[password-recovery] callback rejected', {
        classification: initialRecoveryCallback.diagnostic,
      })
    }
  }, [])

  useEffect(() => {
    if (recoveryStatus !== 'checking') return

    const timeout = window.setTimeout(() => {
      setRecoveryStatus((current) => current === 'checking' ? 'invalid' : current)
      setRecoveryDiagnostic((current) => current ?? 'session_timeout')
      console.warn('[password-recovery] session confirmation timed out', {
        classification: 'session_timeout',
      })
    }, 10_000)

    return () => window.clearTimeout(timeout)
  }, [recoveryStatus])

  useEffect(() => {
    if (!passwordRecovery) return
    navigate('/reset-password', { replace: true })
    setPasswordRecovery(false)
  }, [navigate, passwordRecovery])

  const completePasswordRecovery = useCallback(() => {
    setRecoveryStatus('idle')
    setRecoveryDiagnostic(null)
  }, [])

  const value = useMemo(
    () => ({
      session,
      loading,
      recoveryStatus,
      recoveryDiagnostic,
      completePasswordRecovery,
    }),
    [completePasswordRecovery, loading, recoveryDiagnostic, recoveryStatus, session],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useSession() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useSession must be used within AuthProvider')
  return context
}

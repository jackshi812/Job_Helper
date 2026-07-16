import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { useSession } from '../auth/AuthProvider'
import { classifyPasswordUpdateError } from '../auth/recovery'
import { supabase } from '../lib/supabase'

export function ResetPassword() {
  const navigate = useNavigate()
  const { completePasswordRecovery, recoveryStatus } = useSession()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sessionInvalid, setSessionInvalid] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })

      if (updateError) {
        const classification = classifyPasswordUpdateError(updateError)
        console.warn('[password-recovery] password update rejected', {
          classification,
          code: updateError.code ?? 'unknown',
          status: updateError.status ?? null,
        })

        if (classification === 'session_invalid') {
          setSessionInvalid(true)
          return
        }
        if (classification === 'weak_password') {
          setError('Choose a stronger password and try again.')
          return
        }
        if (classification === 'same_password') {
          setError('Choose a password you have not used for this account.')
          return
        }
        if (classification === 'rate_limited') {
          setError('Too many attempts. Wait a moment and try again.')
          return
        }

        setError('Unable to update password. Try again or request a new reset link.')
        return
      }

      completePasswordRecovery()
      navigate('/', { replace: true })
    } catch {
      console.warn('[password-recovery] password update failed', {
        classification: 'network_or_unknown',
      })
      setError('Unable to update password. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  const effectiveRecoveryStatus = sessionInvalid ? 'invalid' : recoveryStatus

  if (effectiveRecoveryStatus === 'checking') {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 px-4 dark:bg-zinc-950">
        <section className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">Checking reset link</h1>
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">Confirming that this password-reset link is valid…</p>
        </section>
      </main>
    )
  }

  if (effectiveRecoveryStatus !== 'ready') {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 px-4 dark:bg-zinc-950">
        <section className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">Reset link unavailable</h1>
          <p role="alert" className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            This password-reset link is invalid or expired. Request a new link from the sign-in page.
          </p>
          <Link
            to="/login"
            className="mt-5 inline-block text-sm font-medium text-zinc-700 underline underline-offset-4 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white"
          >
            Return to sign in
          </Link>
        </section>
      </main>
    )
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4 dark:bg-zinc-950">
      <section className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="mb-6 text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">Set a new password</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            New password
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1.5 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-950 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-500 dark:focus:ring-zinc-800"
            />
          </label>
          {error ? (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-wait disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            {busy ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </section>
    </main>
  )
}

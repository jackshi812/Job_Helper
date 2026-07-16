import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { useSession } from '../auth/AuthProvider'
import {
  PasswordRecoveryError,
  resetPasswordFromConfirmedSession,
  resetPasswordWithOtp,
  type PasswordRecoveryFailure,
} from '../auth/passwordRecovery'

function recoveryErrorMessage(classification: PasswordRecoveryFailure) {
  if (classification === 'otp_invalid_or_expired' || classification === 'otp_rejected') {
    return 'That verification code is invalid or expired. Request a new code and try again.'
  }
  if (classification === 'otp_rate_limited' || classification === 'rate_limited') {
    return 'Too many attempts. Wait a moment and try again.'
  }
  if (classification === 'weak_password') {
    return 'Choose a stronger password and try again.'
  }
  if (classification === 'same_password') {
    return 'Choose a password you have not used for this account.'
  }
  if (classification === 'sign_out_failed') {
    return 'Password updated, but automatic sign-out failed. Close this tab before signing in again.'
  }
  return 'Unable to update password. Request a new code and try again.'
}

export function ResetPassword() {
  const navigate = useNavigate()
  const { completePasswordRecovery, recoveryStatus } = useSession()
  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [sessionInvalid, setSessionInvalid] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')

    try {
      if (recoveryStatus === 'ready' && !sessionInvalid) {
        await resetPasswordFromConfirmedSession(password)
      } else {
        await resetPasswordWithOtp({ email, token, password })
      }

      setEmail('')
      setToken('')
      setPassword('')
      completePasswordRecovery()
      setCompleted(true)
    } catch (caught) {
      const classification = caught instanceof PasswordRecoveryError
        ? caught.classification
        : 'update_rejected'
      console.warn('[password-recovery] password update failed', {
        classification,
      })

      if (classification === 'sign_out_failed') {
        setEmail('')
        setToken('')
        setPassword('')
        completePasswordRecovery()
        setCompleted(true)
      }
      if (classification === 'session_invalid') setSessionInvalid(true)
      setError(recoveryErrorMessage(classification))
    } finally {
      setBusy(false)
    }
  }

  const effectiveRecoveryStatus = sessionInvalid ? 'invalid' : recoveryStatus

  if (completed) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 px-4 dark:bg-zinc-950">
        <section className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">Password updated</h1>
          <p role="status" className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            {error || 'Your password was changed and this recovery session was signed out.'}
          </p>
          <button
            type="button"
            onClick={() => navigate('/login', { replace: true })}
            className="mt-5 text-sm font-medium text-zinc-700 underline underline-offset-4 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white"
          >
            Sign in with the new password
          </button>
        </section>
      </main>
    )
  }

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

  if (effectiveRecoveryStatus === 'invalid') {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 px-4 dark:bg-zinc-950">
        <section className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">Reset link unavailable</h1>
          <p role="alert" className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            This password-reset link is invalid or expired. Request a new code from the sign-in page.
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
        <h1 className="mb-2 text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">Set a new password</h1>
        {effectiveRecoveryStatus === 'ready' ? null : (
          <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
            Enter the email address and six-digit code from your password-reset email.
          </p>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          {effectiveRecoveryStatus === 'ready' ? null : (
            <>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Email
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="mt-1.5 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-950 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-500 dark:focus:ring-zinc-800"
                />
              </label>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Verification code
                <input
                  type="text"
                  name="recovery-code"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  value={token}
                  onChange={(event) => setToken(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="mt-1.5 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono tracking-[0.3em] text-zinc-950 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-500 dark:focus:ring-zinc-800"
                />
              </label>
            </>
          )}
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
            {busy
              ? 'Updating…'
              : effectiveRecoveryStatus === 'ready'
                ? 'Update password'
                : 'Verify code and update password'}
          </button>
        </form>
      </section>
    </main>
  )
}

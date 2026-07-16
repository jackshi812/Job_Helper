import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { requestPasswordRecoveryEmail } from '../auth/passwordRecovery'
import { supabase } from '../lib/supabase'

const genericError = 'Unable to complete request. Check your details and try again.'

export function Login() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMessage('')

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)

    if (error) {
      setMessage(genericError)
      return
    }

    navigate('/', { replace: true })
  }

  async function handleForgotPassword() {
    setBusy(true)
    setMessage('')

    if (!email) {
      setBusy(false)
      setMessage(genericError)
      return
    }

    try {
      await requestPasswordRecoveryEmail(
        email,
        `${window.location.origin}/reset-password`,
      )
      navigate('/reset-password')
    } catch {
      setMessage(genericError)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4 dark:bg-zinc-950">
      <section className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="mb-6 text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">Job Copilot</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
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
            Password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1.5 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-950 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-500 dark:focus:ring-zinc-800"
            />
          </label>
          {message ? (
            <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">
              {message}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-wait disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            {busy ? 'Please wait…' : 'Sign in'}
          </button>
          <button
            type="button"
            onClick={handleForgotPassword}
            disabled={busy}
            className="text-sm text-zinc-600 underline-offset-4 hover:text-zinc-950 hover:underline disabled:opacity-60 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            Forgot password?
          </button>
        </form>
      </section>
    </main>
  )
}

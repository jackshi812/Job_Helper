/* oxlint-disable react/only-export-components -- exported actions are covered by security behavior tests */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from '../auth/AuthProvider'
import {
  DELETE_CONFIRMATION_TEXT,
  TypeToConfirmDialog,
} from '../components/TypeToConfirmDialog'
import { reauthenticate, supabase } from '../lib/supabase'
import { loadPreferences, savePreferences } from '../lib/preferences'
import {
  disablePushOnThisDevice,
  enablePushOnThisDevice,
  getPushStatus,
  type PushStatus,
} from '../lib/push'

const STORAGE_PAGE_SIZE = 1000
const STORAGE_REMOVE_BATCH_SIZE = 100

const DEFAULT_THRESHOLD = 75
const DEFAULT_DIGEST_TIME = '08:00'

// The three bounded reasons push.ts throws, interpolated into the UI-SPEC copy.
const PUSH_ERROR_REASONS = [
  'permission denied',
  'browser unsupported',
  'subscription failed',
] as const

// Clamp the instant-push threshold to a 0–100 integer (D-07). Non-finite input
// falls back to the default so a broken control never persists NaN.
export function clampThreshold(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_THRESHOLD
  return Math.min(100, Math.max(0, Math.round(value)))
}

// Map an enable-push failure to the UI-SPEC error copy, interpolating the bounded
// reason. Anything that is not one of the three known reasons is reported as
// 'subscription failed' so the user never sees a raw/unbounded error string.
export function pushErrorMessage(error: unknown): string {
  const reason =
    error instanceof Error && (PUSH_ERROR_REASONS as readonly string[]).includes(error.message)
      ? error.message
      : 'subscription failed'
  return `Push couldn't be enabled (${reason}). Email digests still work.`
}

// Native <input type="time"> wants HH:MM; the DB may return HH:MM:SS.
function toTimeInput(value: string | null | undefined): string {
  if (!value) return ''
  return value.slice(0, 5)
}

export interface NotificationSettingsInput {
  notify_threshold: number
  quiet_start: string | null
  quiet_end: string | null
  digest_time: string
  timezone: string
}

// Persist ONLY the notification-tuning fields. The caller's existing filter
// arrays (titles/locations/include/exclude) are loaded first and spread back
// verbatim so a notification save never overwrites matching preferences — the
// upsert touches threshold/quiet-hours/digest/timezone only (D-21, NOTF-03).
export async function saveNotificationSettings(input: NotificationSettingsInput): Promise<void> {
  const existing = await loadPreferences()
  await savePreferences({
    titles: existing?.titles ?? [],
    locations: existing?.locations ?? [],
    include_keywords: existing?.include_keywords ?? [],
    exclude_keywords: existing?.exclude_keywords ?? [],
    notify_threshold: clampThreshold(input.notify_threshold),
    quiet_start: input.quiet_start,
    quiet_end: input.quiet_end,
    digest_time: input.digest_time,
    timezone: input.timezone,
  })
}

export async function changePassword(
  email: string,
  currentPassword: string,
  newPassword: string,
) {
  // Reauthenticate in code: the server-side current_password enforcement flag is
  // off on this project, so verify the current password ourselves before updating.
  const { error: reauthError } = await reauthenticate(email, currentPassword)
  if (reauthError) throw reauthError

  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw error
}

async function listAllResumePaths(userId: string) {
  const bucket = supabase.storage.from('resumes')
  const paths: string[] = []

  for (let offset = 0; ; offset += STORAGE_PAGE_SIZE) {
    const { data, error } = await bucket.list(userId, {
      limit: STORAGE_PAGE_SIZE,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    })

    if (error) throw error

    const files = data ?? []
    paths.push(...files.map((file) => `${userId}/${file.name}`))
    if (files.length < STORAGE_PAGE_SIZE) break
  }

  return paths
}

export async function deleteAllMyData(userId: string) {
  const bucket = supabase.storage.from('resumes')
  const paths = await listAllResumePaths(userId)
  let removedCount = 0

  for (let index = 0; index < paths.length; index += STORAGE_REMOVE_BATCH_SIZE) {
    const batch = paths.slice(index, index + STORAGE_REMOVE_BATCH_SIZE)
    const { data: removed, error } = await bucket.remove(batch)

    if (error || removed?.length !== batch.length) {
      throw new Error('storage delete incomplete')
    }
    removedCount += removed.length
  }

  if (removedCount !== paths.length) {
    throw new Error('storage delete incomplete')
  }

  const { error: rpcError } = await supabase.rpc('delete_my_data')
  if (rpcError) throw rpcError
}

export function Settings() {
  const { session } = useSession()
  const queryClient = useQueryClient()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [passwordPending, setPasswordPending] = useState(false)
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD)
  const [quietStart, setQuietStart] = useState('')
  const [quietEnd, setQuietEnd] = useState('')
  const [digestTime, setDigestTime] = useState(DEFAULT_DIGEST_TIME)
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [notifPending, setNotifPending] = useState(false)
  const [notifMessage, setNotifMessage] = useState<string | null>(null)
  const [notifError, setNotifError] = useState<string | null>(null)

  const [pushStatus, setPushStatus] = useState<PushStatus | null>(null)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushError, setPushError] = useState<string | null>(null)

  const hydrated = useRef(false)
  const prefsQuery = useQuery({ queryKey: ['preferences'], queryFn: loadPreferences })

  // Hydrate the form once from the stored preference row. Only-once (hydrated ref)
  // so a post-save query invalidation never clobbers in-progress edits.
  useEffect(() => {
    if (hydrated.current || !prefsQuery.isSuccess) return
    hydrated.current = true
    const prefs = prefsQuery.data
    if (!prefs) return
    setThreshold(prefs.notify_threshold ?? DEFAULT_THRESHOLD)
    setQuietStart(toTimeInput(prefs.quiet_start))
    setQuietEnd(toTimeInput(prefs.quiet_end))
    setDigestTime(toTimeInput(prefs.digest_time) || DEFAULT_DIGEST_TIME)
    if (prefs.timezone) setTimezone(prefs.timezone)
  }, [prefsQuery.isSuccess, prefsQuery.data])

  // Re-subscribe health check on mount (RESEARCH Pitfall 3): a dead subscription
  // surfaces the push-disabled notice.
  useEffect(() => {
    let active = true
    getPushStatus()
      .then((status) => {
        if (active) setPushStatus(status)
      })
      .catch(() => {
        if (active) setPushStatus(null)
      })
    return () => {
      active = false
    }
  }, [])

  async function handleSaveNotifications(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setNotifPending(true)
    setNotifMessage(null)
    setNotifError(null)

    try {
      await saveNotificationSettings({
        notify_threshold: threshold,
        quiet_start: quietStart || null,
        quiet_end: quietEnd || null,
        digest_time: digestTime,
        timezone,
      })
      await queryClient.invalidateQueries({ queryKey: ['preferences'] })
      setNotifMessage('Notification settings saved.')
    } catch {
      setNotifError('Couldn’t save notification settings. Your changes are still in the form — retry.')
    } finally {
      setNotifPending(false)
    }
  }

  // MUST call enablePushOnThisDevice INSIDE this click handler: a permission
  // request outside a user gesture is auto-denied (RESEARCH deprecated-patterns).
  async function handleEnablePush() {
    setPushBusy(true)
    setPushError(null)
    try {
      await enablePushOnThisDevice()
      setPushStatus(await getPushStatus())
    } catch (error) {
      setPushError(pushErrorMessage(error))
    } finally {
      setPushBusy(false)
    }
  }

  async function handleDisablePush() {
    setPushBusy(true)
    setPushError(null)
    try {
      await disablePushOnThisDevice()
      setPushStatus('disabled')
    } catch {
      setPushError('Couldn’t disable push on this device. Try again.')
    } finally {
      setPushBusy(false)
    }
  }

  async function handlePasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPasswordPending(true)
    setPasswordMessage(null)
    setPasswordError(null)

    try {
      const email = session?.user.email
      if (!email) throw new Error('You must be signed in')
      await changePassword(email, currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setPasswordMessage('Password updated. Use the new password the next time you sign in.')
    } catch {
      setPasswordError('Could not update your password. Check your current password and try again.')
    } finally {
      setPasswordPending(false)
    }
  }

  async function handleDeleteAll() {
    if (!session?.user.id) throw new Error('You must be signed in')

    setDeleteMessage(null)
    setDeleteError(null)

    try {
      await deleteAllMyData(session.user.id)
      await queryClient.invalidateQueries({ queryKey: ['resumes'] })
      setShowDeleteDialog(false)
      setDeleteMessage('All of your resume data was permanently deleted.')
    } catch (error) {
      setDeleteError(
        error instanceof Error && error.message === 'storage delete incomplete'
          ? 'Could not finish deleting your files. Database records were kept so you can retry.'
          : 'Could not delete all of your data. Please try again.',
      )
      throw error
    }
  }

  return (
    <section className="max-w-2xl">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>

      <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-base font-semibold">Change password</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Confirm your current password before choosing a new one.
        </p>
        <form onSubmit={handlePasswordChange} className="mt-4 space-y-4">
          <label className="block text-sm font-medium">
            Current password
            <input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
              required
              disabled={passwordPending}
              className="mt-1.5 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <label className="block text-sm font-medium">
            New password
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
              disabled={passwordPending}
              className="mt-1.5 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950"
            />
            <span className="mt-1 block text-xs font-normal text-zinc-500">At least 8 characters.</span>
          </label>
          {passwordMessage && <p className="text-sm text-emerald-700 dark:text-emerald-400">{passwordMessage}</p>}
          {passwordError && <p className="text-sm text-red-700 dark:text-red-400">{passwordError}</p>}
          <button
            type="submit"
            disabled={passwordPending}
            className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-wait disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            {passwordPending ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </section>

      <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-base font-semibold">Notifications</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Tune when strong matches push instantly and when the daily digest sends.
        </p>

        <form onSubmit={handleSaveNotifications} className="mt-4 space-y-5">
          <div className="grid gap-1.5">
            <label htmlFor="notify-threshold" className="text-sm font-medium">
              Instant-push threshold
            </label>
            <div className="flex items-center gap-3">
              <input
                id="notify-threshold"
                type="range"
                min={0}
                max={100}
                value={threshold}
                onChange={(event) => setThreshold(clampThreshold(Number(event.target.value)))}
                disabled={notifPending}
                className="w-full accent-zinc-900 dark:accent-zinc-100"
              />
              <span className="w-8 text-right text-sm font-semibold tabular-nums">{threshold}</span>
            </div>
            <span className="text-xs text-zinc-500">
              Only matches scoring at or above this fire an instant push. Everything else waits for the digest.
            </span>
          </div>

          <fieldset className="grid gap-1.5">
            <legend className="text-sm font-medium">Quiet hours</legend>
            <div className="flex flex-wrap items-center gap-3">
              <label className="grid gap-1 text-xs text-zinc-500">
                Start
                <input
                  type="time"
                  value={quietStart}
                  onChange={(event) => setQuietStart(event.target.value)}
                  disabled={notifPending}
                  className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950"
                />
              </label>
              <label className="grid gap-1 text-xs text-zinc-500">
                End
                <input
                  type="time"
                  value={quietEnd}
                  onChange={(event) => setQuietEnd(event.target.value)}
                  disabled={notifPending}
                  className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950"
                />
              </label>
            </div>
            <span className="text-xs text-zinc-500">
              Strong matches during quiet hours queue and fire as one push when the window ends. Clear both to disable.
            </span>
          </fieldset>

          <div className="grid gap-1.5">
            <label htmlFor="digest-time" className="text-sm font-medium">
              Digest send time
            </label>
            <input
              id="digest-time"
              type="time"
              value={digestTime}
              onChange={(event) => setDigestTime(event.target.value)}
              disabled={notifPending}
              className="w-fit rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950"
            />
            <span className="text-xs text-zinc-500">Times use your timezone: {timezone}</span>
          </div>

          {notifMessage && <p className="text-sm text-emerald-700 dark:text-emerald-400">{notifMessage}</p>}
          {notifError && <p className="text-sm text-red-700 dark:text-red-400">{notifError}</p>}

          <button
            type="submit"
            disabled={notifPending}
            className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-wait disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            {notifPending ? 'Saving…' : 'Save notification settings'}
          </button>
        </form>

        <div className="mt-6 border-t border-zinc-200 pt-5 dark:border-zinc-800">
          <h3 className="text-sm font-medium">Desktop push</h3>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Enable push on each device where you want instant strong-match alerts.
          </p>

          {pushStatus === 'enabled' && (
            <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">Push enabled on this device</p>
          )}
          {pushStatus === 'dead-subscription' && (
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
              Push is disabled on this device. Strong matches fall back to email.
            </p>
          )}
          {pushStatus === 'unsupported' && (
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
              This browser doesn’t support desktop push.
            </p>
          )}
          {pushError && <p className="mt-3 text-sm text-red-700 dark:text-red-400">{pushError}</p>}

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleEnablePush}
              disabled={pushBusy || pushStatus === 'unsupported'}
              className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-wait disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              {pushBusy ? 'Working…' : 'Enable push on this device'}
            </button>
            {pushStatus === 'enabled' && (
              <button
                type="button"
                onClick={handleDisablePush}
                disabled={pushBusy}
                className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 disabled:cursor-wait disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Disable push
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-red-300 bg-red-50 p-5 dark:border-red-900 dark:bg-red-950/30">
        <h2 className="text-base font-semibold text-red-900 dark:text-red-200">Danger zone</h2>
        <p className="mt-1 text-sm text-red-800 dark:text-red-300">
          Permanently remove every resume file and database record you own. This cannot be undone.
        </p>
        {deleteMessage && <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">{deleteMessage}</p>}
        {deleteError && <p className="mt-3 text-sm text-red-700 dark:text-red-400">{deleteError}</p>}
        <button
          type="button"
          onClick={() => {
            setDeleteError(null)
            setDeleteMessage(null)
            setShowDeleteDialog(true)
          }}
          className="mt-4 rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800"
        >
          Delete all my data
        </button>
      </section>

      {showDeleteDialog && (
        <TypeToConfirmDialog
          requiredText={DELETE_CONFIRMATION_TEXT}
          title="Delete all my data?"
          warning="Every resume file and database record you own will be permanently deleted. This action cannot be undone."
          onConfirm={handleDeleteAll}
          onCancel={() => setShowDeleteDialog(false)}
        />
      )}
    </section>
  )
}

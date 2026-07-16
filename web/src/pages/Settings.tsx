/* oxlint-disable react/only-export-components -- exported actions are covered by security behavior tests */
import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSession } from '../auth/AuthProvider'
import {
  DELETE_CONFIRMATION_TEXT,
  TypeToConfirmDialog,
} from '../components/TypeToConfirmDialog'
import { supabase } from '../lib/supabase'

const STORAGE_PAGE_SIZE = 1000
const STORAGE_REMOVE_BATCH_SIZE = 100

export async function changePassword(currentPassword: string, newPassword: string) {
  const { error } = await supabase.auth.updateUser({
    current_password: currentPassword,
    password: newPassword,
  })

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

  async function handlePasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPasswordPending(true)
    setPasswordMessage(null)
    setPasswordError(null)

    try {
      await changePassword(currentPassword, newPassword)
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

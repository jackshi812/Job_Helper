/* oxlint-disable react/only-export-components -- exported matcher is covered by security behavior tests */
import { useEffect, useId, useState } from 'react'

interface TypeToConfirmDialogProps {
  requiredText: string
  title: string
  warning: string
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

export const DELETE_CONFIRMATION_TEXT = 'DELETE'

export function matchesRequiredText(value: string, requiredText: string) {
  return value === requiredText
}

export function TypeToConfirmDialog({
  requiredText,
  title,
  warning,
  onConfirm,
  onCancel,
}: TypeToConfirmDialogProps) {
  const titleId = useId()
  const inputId = useId()
  const [confirmation, setConfirmation] = useState('')
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !confirming) onCancel()
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [confirming, onCancel])

  async function handleConfirm() {
    if (!matchesRequiredText(confirmation, requiredText)) return

    setConfirming(true)
    try {
      await onConfirm()
    } catch {
      // The parent action owns and renders the actionable error message.
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      >
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{warning}</p>
        <label htmlFor={inputId} className="mt-4 block text-sm font-medium">
          Type <span className="font-mono">{requiredText}</span> to continue
        </label>
        <input
          id={inputId}
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          autoComplete="off"
          autoFocus
          disabled={confirming}
          className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-red-600 focus:ring-2 focus:ring-red-600/20 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={confirming}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={confirming || !matchesRequiredText(confirmation, requiredText)}
            className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {confirming ? 'Deleting…' : 'Delete all my data'}
          </button>
        </div>
      </section>
    </div>
  )
}

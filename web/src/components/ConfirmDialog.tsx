import { useEffect, useId, useRef, useState } from 'react'

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel: string
  cancelLabel?: string
  pendingLabel?: string
  initialFocus?: 'cancel' | 'confirm'
  errorMessage?: string
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  pendingLabel = 'Deleting…',
  initialFocus = 'confirm',
  errorMessage,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId()
  const messageId = useId()
  const errorId = useId()
  const [confirming, setConfirming] = useState(false)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const confirmButton = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLElement>(null)
  const origin = useRef<HTMLElement | null>(null)

  useEffect(() => {
    origin.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const initialButton = initialFocus === 'cancel' ? cancelButton.current : confirmButton.current
    initialButton?.focus()

    return () => {
      origin.current?.focus()
    }
  }, [initialFocus])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !confirming) {
        event.preventDefault()
        onCancel()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = [cancelButton.current, confirmButton.current]
        .filter((button): button is HTMLButtonElement => button !== null && !button.disabled)
      if (focusable.length === 0) {
        event.preventDefault()
        return
      }

      const currentIndex = focusable.indexOf(document.activeElement as HTMLButtonElement)
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
        : (currentIndex === focusable.length - 1 ? 0 : currentIndex + 1)
      event.preventDefault()
      focusable[nextIndex].focus()
    }

    const dialogElement = dialog.current
    dialogElement?.addEventListener('keydown', handleKeyDown)
    return () => dialogElement?.removeEventListener('keydown', handleKeyDown)
  }, [confirming, onCancel])

  async function handleConfirm() {
    setConfirming(true)
    try {
      await onConfirm()
    } catch {
      // The parent mutation owns and renders the actionable error message.
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4" role="presentation">
      <section
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${messageId}${errorMessage ? ` ${errorId}` : ''}`}
        className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      >
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        <p id={messageId} className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{message}</p>
        {errorMessage ? (
          <p id={errorId} role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">
            Remove failed: {errorMessage}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelButton}
            type="button"
            onClick={onCancel}
            disabled={confirming}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmButton}
            type="button"
            onClick={handleConfirm}
            disabled={confirming}
            className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:cursor-wait disabled:opacity-60"
          >
            {confirming ? pendingLabel : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}

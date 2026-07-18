import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import watchlistSource from '../pages/Watchlist.tsx?raw'
import { ConfirmDialog } from './ConfirmDialog'
import confirmDialogSource from './ConfirmDialog.tsx?raw'

function renderDialog(errorMessage?: string) {
  return renderToStaticMarkup(createElement(ConfirmDialog, {
    title: 'Remove Acme?',
    message: 'Polling stops immediately.',
    confirmLabel: 'Remove company',
    cancelLabel: 'Keep company',
    pendingLabel: 'Removing…',
    initialFocus: 'cancel',
    errorMessage,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  }))
}

describe('ConfirmDialog error contract', () => {
  it('links a removal failure alert inside the active dialog description', () => {
    const markup = renderDialog('Please try again.')
    const describedBy = markup.match(/aria-describedby="([^"]+)"/)?.[1].split(' ') ?? []
    const alert = markup.match(/<p id="([^"]+)" role="alert"[^>]*>Remove failed: Please try again\.<\/p>/)

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(describedBy).toHaveLength(2)
    expect(alert?.[1]).toBe(describedBy[1])
    expect(markup.indexOf('role="alert"')).toBeLessThan(markup.indexOf('</section>'))
  })

  it('keeps the optional error absent for existing Resume confirmations', () => {
    const markup = renderDialog()
    const describedBy = markup.match(/aria-describedby="([^"]+)"/)?.[1].split(' ') ?? []

    expect(describedBy).toHaveLength(1)
    expect(markup).not.toContain('role="alert"')
  })

  it('re-enables retry and cancel after rejection and wires only bounded Watchlist errors', () => {
    expect(confirmDialogSource).toContain('} finally {\n      setConfirming(false)')
    expect(confirmDialogSource.match(/disabled=\{confirming\}/g)).toHaveLength(2)
    expect(watchlistSource).toContain(
      'errorMessage={removeMutation.error ? boundedErrorMessage(removeMutation.error) : undefined}',
    )
  })
})

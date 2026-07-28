import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { REMOVE_COMPANY_TIMEOUT_MESSAGE } from '../lib/watchlist'
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

  it('shows a timed-out removal with retry and Keep company restored', () => {
    const markup = renderDialog(REMOVE_COMPANY_TIMEOUT_MESSAGE)
    const cancelButton = markup.match(/<button[^>]*>Keep company<\/button>/)?.[0]
    const retryButton = markup.match(/<button[^>]*>Remove company<\/button>/)?.[0]

    expect(markup).toContain(`Remove failed: ${REMOVE_COMPANY_TIMEOUT_MESSAGE}`)
    expect(cancelButton).toBeDefined()
    expect(retryButton).toBeDefined()
    expect(cancelButton).not.toContain('disabled=""')
    expect(retryButton).not.toContain('disabled=""')
  })

  it('re-enables retry and cancel after rejection and wires only bounded Watchlist errors', () => {
    expect(confirmDialogSource).toContain('} finally {\n      setConfirming(false)')
    expect(confirmDialogSource.match(/disabled=\{confirming\}/g)).toHaveLength(2)
    expect(confirmDialogSource).toContain('onClick={onCancel}')
    expect(confirmDialogSource).toContain('onClick={handleConfirm}')
    expect(watchlistSource).toContain(
      'errorMessage={removeMutation.error ? boundedErrorMessage(removeMutation.error) : undefined}',
    )
    expect(watchlistSource).toContain(
      'onCancel={() => setCompanyToRemove(null)}',
    )
    expect(watchlistSource).toContain(
      'onConfirm={() => removeMutation.mutateAsync(companyToRemove.company_id!)}',
    )
  })
})

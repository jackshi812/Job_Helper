import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResetPassword } from './ResetPassword'

const mocks = vi.hoisted(() => ({
  recovery: { status: 'invalid' as 'idle' | 'checking' | 'ready' | 'invalid' },
  updateUser: vi.fn(),
}))

vi.mock('../auth/AuthProvider', () => ({
  useSession: () => ({
    loading: false,
    completePasswordRecovery: vi.fn(),
    recoveryDiagnostic: null,
    recoveryStatus: mocks.recovery.status,
    session: null,
  }),
}))

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { updateUser: mocks.updateUser } },
}))

function renderPage() {
  return renderToStaticMarkup(
    <MemoryRouter>
      <ResetPassword />
    </MemoryRouter>,
  )
}

describe('ResetPassword recovery gate', () => {
  beforeEach(() => {
    mocks.recovery.status = 'invalid'
    mocks.updateUser.mockReset()
  })

  it('does not show the password form without a confirmed recovery session', () => {
    const markup = renderPage()

    expect(markup).toContain('invalid or expired')
    expect(markup).not.toContain('Update password')
  })

  it('shows the password form only after recovery is confirmed', () => {
    mocks.recovery.status = 'ready'

    expect(renderPage()).toContain('Update password')
  })

  it('shows a non-actionable progress state while the callback is being checked', () => {
    mocks.recovery.status = 'checking'

    const markup = renderPage()
    expect(markup).toContain('Checking reset link')
    expect(markup).not.toContain('Update password')
  })
})

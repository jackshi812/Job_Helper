import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  requestPasswordRecoveryEmail,
  resetPasswordFromConfirmedSession,
  resetPasswordWithOtp,
} from './passwordRecovery'
import { supabase } from '../lib/supabase'

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      signOut: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updateUser: vi.fn(),
      verifyOtp: vi.fn(),
    },
  },
}))

const auth = supabase.auth as unknown as {
  signOut: ReturnType<typeof vi.fn>
  resetPasswordForEmail: ReturnType<typeof vi.fn>
  updateUser: ReturnType<typeof vi.fn>
  verifyOtp: ReturnType<typeof vi.fn>
}

describe('resetPasswordWithOtp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('verifies the recovery OTP before updating the password and clearing the session', async () => {
    const calls: string[] = []
    auth.verifyOtp.mockImplementation(async () => {
      calls.push('verify')
      return { data: { session: { access_token: 'test-session' } }, error: null }
    })
    auth.updateUser.mockImplementation(async () => {
      calls.push('update')
      return { data: {}, error: null }
    })
    auth.signOut.mockImplementation(async () => {
      calls.push('signout')
      return { error: null }
    })

    await resetPasswordWithOtp({
      email: 'person@example.com',
      token: '123456',
      password: 'new-password',
    })

    expect(calls).toEqual(['verify', 'update', 'signout'])
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      email: 'person@example.com',
      token: '123456',
      type: 'recovery',
    })
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'new-password' })
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('requests recovery without placing email or token in the redirect URL', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null })

    await requestPasswordRecoveryEmail(
      'person@example.com',
      'https://app.example/reset-password',
    )

    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('person@example.com', {
      redirectTo: 'https://app.example/reset-password',
    })
  })

  it('does not update the password when the OTP is invalid or expired', async () => {
    auth.verifyOtp.mockResolvedValue({
      data: { session: null },
      error: { code: 'otp_expired', status: 403 },
    })

    await expect(resetPasswordWithOtp({
      email: 'person@example.com',
      token: '000000',
      password: 'new-password',
    })).rejects.toMatchObject({
      classification: 'otp_invalid_or_expired',
    })

    expect(auth.updateUser).not.toHaveBeenCalled()
    expect(auth.signOut).not.toHaveBeenCalled()
  })

  it('does not sign out when the password update is rejected', async () => {
    auth.verifyOtp.mockResolvedValue({
      data: { session: { access_token: 'test-session' } },
      error: null,
    })
    auth.updateUser.mockResolvedValue({
      data: { user: null },
      error: { code: 'weak_password', status: 422 },
    })

    await expect(resetPasswordWithOtp({
      email: 'person@example.com',
      token: '123456',
      password: 'weakpass',
    })).rejects.toMatchObject({
      classification: 'weak_password',
    })

    expect(auth.signOut).not.toHaveBeenCalled()
  })

  it('keeps confirmed link recovery compatible without asking for another OTP', async () => {
    auth.updateUser.mockResolvedValue({ data: {}, error: null })
    auth.signOut.mockResolvedValue({ error: null })

    await resetPasswordFromConfirmedSession('new-password')

    expect(auth.verifyOtp).not.toHaveBeenCalled()
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'new-password' })
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })
})

import { describe, expect, it } from 'vitest'
import { classifyPasswordUpdateError, inspectRecoveryCallback } from './recovery'

describe('inspectRecoveryCallback', () => {
  it('recognizes an implicit password-recovery callback', () => {
    expect(inspectRecoveryCallback(
      'https://app.example/reset-password#access_token=redacted&refresh_token=redacted&type=recovery',
    )).toEqual({ kind: 'pending', diagnostic: null })
  })

  it('classifies an expired callback without retaining its description', () => {
    expect(inspectRecoveryCallback(
      'https://app.example/reset-password#error=access_denied&error_code=otp_expired&error_description=sensitive',
    )).toEqual({ kind: 'error', diagnostic: 'callback_expired' })
  })

  it('does not treat a direct reset route as a valid callback', () => {
    expect(inspectRecoveryCallback('https://app.example/reset-password')).toEqual({
      kind: 'none',
      diagnostic: null,
    })
  })
})

describe('classifyPasswordUpdateError', () => {
  it('separates missing recovery sessions from password validation errors', () => {
    expect(classifyPasswordUpdateError({ code: 'session_not_found', status: 400 })).toBe('session_invalid')
    expect(classifyPasswordUpdateError({ code: 'weak_password', status: 422 })).toBe('weak_password')
  })

  it('uses a non-sensitive fallback for unknown failures', () => {
    expect(classifyPasswordUpdateError({ code: 'unexpected', status: 500 })).toBe('update_rejected')
  })
})

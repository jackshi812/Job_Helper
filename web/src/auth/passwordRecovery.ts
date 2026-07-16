import { supabase } from '../lib/supabase'
import { classifyPasswordUpdateError, type PasswordUpdateFailure } from './recovery'

type AuthErrorLike = {
  code?: string
  status?: number
}

export type PasswordRecoveryFailure =
  | PasswordUpdateFailure
  | 'otp_invalid_or_expired'
  | 'otp_rate_limited'
  | 'otp_rejected'
  | 'request_rate_limited'
  | 'request_rejected'
  | 'sign_out_failed'

export class PasswordRecoveryError extends Error {
  readonly classification: PasswordRecoveryFailure

  constructor(classification: PasswordRecoveryFailure) {
    super(classification)
    this.name = 'PasswordRecoveryError'
    this.classification = classification
  }
}

function classifyOtpError(error: AuthErrorLike): PasswordRecoveryFailure {
  if (
    error.code === 'otp_expired'
    || error.code === 'token_expired'
    || error.code === 'bad_code_verifier'
    || error.status === 403
  ) {
    return 'otp_invalid_or_expired'
  }
  if (error.code === 'over_request_rate_limit' || error.status === 429) {
    return 'otp_rate_limited'
  }
  return 'otp_rejected'
}

function classifyRequestError(error: AuthErrorLike): PasswordRecoveryFailure {
  return error.code === 'over_request_rate_limit' || error.status === 429
    ? 'request_rate_limited'
    : 'request_rejected'
}

async function updatePasswordAndClearSession(password: string) {
  const { error: updateError } = await supabase.auth.updateUser({ password })
  if (updateError) {
    throw new PasswordRecoveryError(classifyPasswordUpdateError(updateError))
  }

  const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' })
  if (signOutError) throw new PasswordRecoveryError('sign_out_failed')
}

export async function requestPasswordRecoveryEmail(email: string, redirectTo: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
  if (error) throw new PasswordRecoveryError(classifyRequestError(error))
}

export async function resetPasswordWithOtp({
  email,
  token,
  password,
}: {
  email: string
  token: string
  password: string
}) {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: 'recovery',
  })

  if (error) throw new PasswordRecoveryError(classifyOtpError(error))
  if (!data.session) throw new PasswordRecoveryError('session_invalid')

  await updatePasswordAndClearSession(password)
}

export async function resetPasswordFromConfirmedSession(password: string) {
  await updatePasswordAndClearSession(password)
}

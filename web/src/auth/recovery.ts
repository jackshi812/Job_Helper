export type RecoveryStatus = 'idle' | 'checking' | 'ready' | 'invalid'

export type RecoveryDiagnostic =
  | 'callback_expired'
  | 'callback_rejected'
  | 'session_missing'
  | 'session_timeout'
  | null

export type RecoveryCallbackHint =
  | { kind: 'none'; diagnostic: null }
  | { kind: 'pending'; diagnostic: null }
  | { kind: 'error'; diagnostic: Exclude<RecoveryDiagnostic, null> }

type PasswordUpdateError = {
  code?: string
  status?: number
}

export type PasswordUpdateFailure =
  | 'session_invalid'
  | 'weak_password'
  | 'same_password'
  | 'rate_limited'
  | 'update_rejected'

const expiredCallbackCodes = new Set([
  'otp_expired',
  'token_expired',
  'flow_state_expired',
  'bad_code_verifier',
])

function mergedCallbackParams(url: URL) {
  const params = new URLSearchParams(url.search)
  const hashParams = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash)

  for (const [key, value] of hashParams) {
    if (!params.has(key)) params.set(key, value)
  }

  return params
}

export function inspectRecoveryCallback(href: string): RecoveryCallbackHint {
  const params = mergedCallbackParams(new URL(href))
  const errorCode = params.get('error_code')

  if (params.has('error') || params.has('error_description') || errorCode) {
    return {
      kind: 'error',
      diagnostic: errorCode && expiredCallbackCodes.has(errorCode)
        ? 'callback_expired'
        : 'callback_rejected',
    }
  }

  const isRecovery = params.get('type') === 'recovery'
  const hasCallbackCredential = params.has('access_token') || params.has('code')

  return isRecovery && hasCallbackCredential
    ? { kind: 'pending', diagnostic: null }
    : { kind: 'none', diagnostic: null }
}

export function classifyPasswordUpdateError(error: PasswordUpdateError): PasswordUpdateFailure {
  if (error.code === 'session_not_found' || error.code === 'bad_jwt' || error.status === 401) {
    return 'session_invalid'
  }
  if (error.code === 'weak_password') return 'weak_password'
  if (error.code === 'same_password') return 'same_password'
  if (error.code === 'over_request_rate_limit' || error.status === 429) return 'rate_limited'
  return 'update_rejected'
}

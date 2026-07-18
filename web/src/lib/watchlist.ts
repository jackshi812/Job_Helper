import {
  detectAts,
  UNSUPPORTED_URL_MESSAGE,
} from '../../../supabase/functions/_shared/detect'
import { supabase } from './supabase'

export const COMPANY_COLUMNS =
  'id, name, ats_type, board_token, region, careers_url, source_key, site_token, activation_state, activation_successes, last_verified_at, last_polled_at, last_success_at, consecutive_failures, last_error, last_error_code, last_observation_count, created_at'

export interface CompanyRecord {
  id: string
  name: string
  ats_type: 'greenhouse' | 'lever' | 'ashby'
  board_token: string
  region: 'eu' | null
  careers_url: string
  source_key: string
  site_token: string | null
  activation_state: 'experimental' | 'active' | 'disabled'
  activation_successes: number
  last_verified_at: string | null
  last_polled_at: string | null
  last_success_at: string | null
  consecutive_failures: number
  last_error: string | null
  last_error_code: string | null
  last_observation_count: number | null
  created_at: string
}

export type HealthStatus = 'ok' | 'failing' | 'stale'

export type VerifyBoardResponse =
  | {
      ok: true
      company: CompanyRecord
      already_watched: false
    }
  | {
      ok: false
      reason: 'unsupported' | 'not_found' | 'already_watched' | 'unauthorized' | 'forbidden' | 'error'
      message: string
    }

export async function listCompanies(): Promise<CompanyRecord[]> {
  const { data, error } = await supabase
    .from('companies')
    .select(COMPANY_COLUMNS)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as CompanyRecord[]
}

export async function addCompany(url: string): Promise<CompanyRecord> {
  if (detectAts(url).ats === 'unsupported') throw new Error(UNSUPPORTED_URL_MESSAGE)

  const { data: verificationData, error: verificationError } =
    await supabase.functions.invoke('verify-board', { body: { url } })
  const verification = verificationData as VerifyBoardResponse | null

  if (verificationError) {
    const context = (verificationError as { context?: Response }).context
    if (context) {
      let message: string | null = null
      try {
        const response = await context.clone().json() as { message?: unknown }
        message = typeof response.message === 'string' ? response.message : null
      } catch { /* retain the original invocation error */ }
      if (message) throw new Error(message)
    }
    throw verificationError
  }
  if (!verification?.ok) {
    throw new Error(verification?.message ?? 'Unable to verify this job board. Please try again.')
  }

  return verification.company
}

export async function removeCompany(id: string): Promise<void> {
  const { error } = await supabase.from('companies').delete().eq('id', id)
  if (error) throw error
}

export function deriveHealth(company: CompanyRecord, now = new Date()): HealthStatus {
  if (company.consecutive_failures >= 3) return 'failing'
  if (!company.last_success_at) return 'stale'

  const lastSuccess = new Date(company.last_success_at).getTime()
  if (!Number.isFinite(lastSuccess) || now.getTime() - lastSuccess > 30 * 60_000) return 'stale'
  return 'ok'
}

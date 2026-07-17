import {
  detectAts,
  UNSUPPORTED_URL_MESSAGE,
} from '../../../supabase/functions/_shared/detect'
import { supabase } from './supabase'

export const COMPANY_COLUMNS =
  'id, name, ats_type, board_token, region, last_polled_at, last_success_at, consecutive_failures, last_error, created_at'

export interface CompanyRecord {
  id: string
  name: string
  ats_type: 'greenhouse' | 'lever' | 'ashby'
  board_token: string
  region: 'eu' | null
  last_polled_at: string | null
  last_success_at: string | null
  consecutive_failures: number
  last_error: string | null
  created_at: string
}

export type HealthStatus = 'ok' | 'failing' | 'stale'

export type VerifyBoardResponse =
  | {
      ok: true
      ats: CompanyRecord['ats_type']
      board_token: string
      region: CompanyRecord['region']
      company_name: string
      job_count: number
    }
  | {
      ok: false
      reason: 'unsupported' | 'not_found' | 'error'
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

  if (verificationError) throw verificationError
  if (!verification?.ok) {
    throw new Error(verification?.message ?? 'Unable to verify this job board. Please try again.')
  }

  const { data, error } = await supabase
    .from('companies')
    .insert({
      name: verification.company_name,
      ats_type: verification.ats,
      board_token: verification.board_token,
      region: verification.region,
    })
    .select(COMPANY_COLUMNS)
    .single()

  if (error) {
    if ('code' in error && error.code === '23505') {
      throw new Error(`${verification.company_name} is already on the watchlist.`)
    }
    throw error
  }

  return data as CompanyRecord
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

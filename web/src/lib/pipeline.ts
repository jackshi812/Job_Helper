import { supabase } from './supabase'

const HEARTBEAT_COLUMNS = 'last_tick_at, last_success_at, discovery_status'
const STALE_AFTER_MS = 30 * 60_000
const heartbeatTimeFormatter = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' })

export interface HeartbeatRow {
  last_tick_at: string | null
  last_success_at: string | null
  discovery_status: 'ok' | 'degraded' | 'failed' | null
}

export interface HeartbeatBanner {
  show: boolean
  message: string
}

export function staleHeartbeatMessage(lastSuccessAt: string | null) {
  if (!lastSuccessAt) {
    return "Job monitoring hasn't run yet — new postings may be missed."
  }

  return `Job monitoring hasn't run since ${heartbeatTimeFormatter.format(new Date(lastSuccessAt))} — new postings may be missed.`
}

export function deriveHeartbeatBanner(
  row: HeartbeatRow | null | undefined,
  isError: boolean,
  nowMs: number,
): HeartbeatBanner {
  if (isError) {
    return {
      show: true,
      message: 'Job monitoring status is unavailable — health cannot be confirmed.',
    }
  }

  if (row === undefined) return { show: false, message: '' }

  const lastSuccessTime = row?.last_success_at
    ? new Date(row.last_success_at).getTime()
    : Number.NaN
  const isStale = !Number.isFinite(lastSuccessTime)
    || nowMs - lastSuccessTime > STALE_AFTER_MS

  if (isStale) {
    return {
      show: true,
      message: staleHeartbeatMessage(row?.last_success_at ?? null),
    }
  }

  if (row?.discovery_status === 'failed') {
    return {
      show: true,
      message: 'Aggregator discovery is failing — new aggregator postings may be missed.',
    }
  }

  return { show: false, message: '' }
}

export async function fetchHeartbeat(): Promise<HeartbeatRow | null> {
  const { data, error } = await supabase
    .from('pipeline_heartbeat')
    .select(HEARTBEAT_COLUMNS)
    .eq('id', true)
    .maybeSingle()

  if (error) throw error
  return data as HeartbeatRow | null
}

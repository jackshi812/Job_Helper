import { supabase } from './supabase'
import {
  assessDiscoveryFreshness,
  type DiscoveryFreshnessReason,
} from '../../../supabase/functions/_shared/discovery-health'

const HEARTBEAT_COLUMNS = 'last_tick_at, last_success_at, last_discovery_at, last_discovery_success_at, discovery_status'
const STALE_AFTER_MS = 30 * 60_000
const heartbeatTimeFormatter = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' })

export interface HeartbeatRow {
  last_tick_at: string | null
  last_success_at: string | null
  last_discovery_at: string | null
  last_discovery_success_at: string | null
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

export function staleDiscoveryMessage(reason: DiscoveryFreshnessReason) {
  if (reason === 'missing-completion') {
    return "Aggregator discovery hasn't completed yet — new aggregator postings may be missed."
  }

  if (reason === 'missing-success') {
    return "Aggregator discovery hasn't completed successfully yet — new aggregator postings may be missed."
  }

  if (reason === 'stale-success') {
    return "Aggregator discovery hasn't succeeded on schedule — new aggregator postings may be missed."
  }

  return 'Aggregator discovery missed its latest scheduled run — new aggregator postings may be missed.'
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

  if (row) {
    const discoveryFreshness = assessDiscoveryFreshness(row, new Date(nowMs))
    if (!discoveryFreshness.fresh) {
      return {
        show: true,
        message: staleDiscoveryMessage(discoveryFreshness.reason),
      }
    }
  }

  if (row?.discovery_status === 'degraded') {
    return {
      show: true,
      message: 'Aggregator discovery is degraded — some new aggregator postings may be delayed.',
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

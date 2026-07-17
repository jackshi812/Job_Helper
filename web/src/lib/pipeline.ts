import { supabase } from './supabase'

const HEARTBEAT_COLUMNS = 'last_tick_at, last_success_at'

export interface HeartbeatRow {
  last_tick_at: string | null
  last_success_at: string | null
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

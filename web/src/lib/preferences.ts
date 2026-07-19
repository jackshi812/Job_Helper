import { supabase } from './supabase'

export const PREFERENCE_COLUMNS =
  'user_id, titles, locations, include_keywords, exclude_keywords, notify_threshold, quiet_start, quiet_end, digest_time, timezone, updated_at'

export interface PreferencesRecord {
  user_id: string
  titles: string[]
  locations: string[]
  include_keywords: string[]
  exclude_keywords: string[]
  notify_threshold: number
  quiet_start: string | null
  quiet_end: string | null
  digest_time: string
  timezone: string
  updated_at: string
}

export interface SavePreferencesInput {
  titles: string[]
  locations: string[]
  include_keywords: string[]
  exclude_keywords: string[]
  notify_threshold?: number
  quiet_start?: string | null
  quiet_end?: string | null
  digest_time?: string
  timezone?: string
}

// Split a raw text input into normalized chips: comma-separated, trimmed,
// de-duplicated, empties dropped. Pure so it is unit-tested directly.
export function parseChips(raw: string): string[] {
  const seen = new Set<string>()
  const chips: string[] = []
  for (const part of raw.split(',')) {
    const value = part.trim()
    if (value.length === 0 || seen.has(value)) continue
    seen.add(value)
    chips.push(value)
  }
  return chips
}

export async function loadPreferences(): Promise<PreferencesRecord | null> {
  const { data, error } = await supabase
    .from('preferences')
    .select(PREFERENCE_COLUMNS)
    .maybeSingle()

  if (error) throw error
  return (data as PreferencesRecord | null) ?? null
}

// Upsert the caller's single preference row. user_id is omitted deliberately: the
// migration defaults it to auth.uid() and the insert/update RLS `with check` binds
// the row to the caller, so the upsert conflicts on the user_id primary key the DB
// default populates (03-REVIEWS: preference upsert ownership).
export async function savePreferences(input: SavePreferencesInput): Promise<void> {
  const { error } = await supabase
    .from('preferences')
    .upsert(
      { ...input, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )

  if (error) throw error

  // D-04 retroactive feedback / D-10 rescore window: flag the caller's recent
  // jobs for refilter so tuning preferences re-runs cheap filters and rescores
  // only real changes (the worker owns the rescore-economy decision). Scoped to
  // auth.uid() and a 7-day window inside the RPC (Settings.tsx rpc precedent).
  const { error: rpcError } = await supabase.rpc('mark_recent_jobs_for_refilter')
  if (rpcError) throw rpcError
}

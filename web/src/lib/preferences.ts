import { supabase } from './supabase'

export const PREFERENCE_COLUMNS =
  'user_id, titles, locations, include_keywords, exclude_keywords, title_exclude_keywords, updated_at'

export const DEFAULT_TITLE_EXCLUSIONS = ['president', 'PhD'] as const

const MAX_TITLE_EXCLUSION_ENTRIES = 50
const MAX_TITLE_EXCLUSION_BYTES = 4096

export interface PreferencesRecord {
  user_id: string
  titles: string[]
  locations: string[]
  include_keywords: string[]
  exclude_keywords: string[]
  title_exclude_keywords: string[]
  updated_at: string
}

export interface SavePreferencesInput {
  titles: string[]
  locations: string[]
  include_keywords: string[]
  exclude_keywords: string[]
  title_exclude_keywords: string[]
}

export function chipComparisonKey(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase()
}

// Split a raw text input into normalized chips: comma-separated, trimmed,
// de-duplicated, empties dropped. Pure so it is unit-tested directly.
export function parseChips(raw: string): string[] {
  const seen = new Set<string>()
  const chips: string[] = []
  for (const part of raw.split(',')) {
    const value = part.trim()
    const comparisonKey = chipComparisonKey(value)
    if (comparisonKey.length === 0 || seen.has(comparisonKey)) continue
    seen.add(comparisonKey)
    chips.push(value)
  }
  return chips
}

export function validateTitleExclusions(values: readonly string[]): void {
  if (values.length > MAX_TITLE_EXCLUSION_ENTRIES) {
    throw new Error('Title exclusions can contain at most 50 entries.')
  }

  const encodedBytes = new TextEncoder().encode(JSON.stringify(values)).byteLength
  if (encodedBytes > MAX_TITLE_EXCLUSION_BYTES) {
    throw new Error('Title exclusions must be 4,096 bytes or less.')
  }
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
  validateTitleExclusions(input.title_exclude_keywords)

  const { error } = await supabase
    .from('preferences')
    .upsert(
      { ...input, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )

  if (error) throw error

  // Flag every caller-owned open job for refilter so preference changes re-run
  // cheap filters and only semantically changed inputs are rescored. The RPC is
  // scoped to auth.uid(); its historical name is retained for compatibility.
  const { error: rpcError } = await supabase.rpc('mark_recent_jobs_for_refilter')
  if (rpcError) throw rpcError
}

import { supabase } from './supabase'

// Feed data layer over the per-user user_jobs projection (Plan 03, migration
// 0019) joined to the shared jobs pool and, through jobs.company_id, to
// companies. Architecture copied from watchlist.ts: exported column constants,
// snake_case typed records matching the DB exactly, pure presentation mappers
// (unit-tested), then thin throw-on-error query/mutation helpers. RLS on
// user_jobs scopes every read/write to the current user (D-16 per-user state).

// Two column sets so the list query never over-fetches untrusted JD bodies:
// list rows never render description_html/description_text, so those live only
// in FEED_DETAIL_COLUMNS (Codex feed-query concern — bandwidth + XSS surface).
//
// Company name is NOT a column on jobs (public.jobs has only company_id uuid FK
// to public.companies — Codex F5). It is pulled through the FK by nesting
// companies(name) inside the embedded jobs(...) via PostgREST resource embedding.
export const FEED_LIST_COLUMNS =
  'id, deterministic_revision, deterministic_eligible, deterministic_score, ' +
  'deterministic_tier, deterministic_breakdown, deterministic_filter_code, ' +
  'deterministic_filter_detail, deterministic_ranked_at, ' +
  'deterministic_best_fit_resume_id, deterministic_runner_up_resume_id, ' +
  'seen_at, dismissed_at, ' +
  'jobs ( id, title, location, absolute_url, posted_at, first_seen_at, status, ' +
  'source_company_name, companies ( name ) )'

export const FEED_DETAIL_COLUMNS =
  'id, deterministic_revision, deterministic_eligible, deterministic_score, ' +
  'deterministic_tier, deterministic_breakdown, deterministic_filter_code, ' +
  'deterministic_filter_detail, deterministic_ranked_at, ' +
  'deterministic_best_fit_resume_id, deterministic_runner_up_resume_id, ' +
  'seen_at, dismissed_at, ' +
  'jobs ( id, title, location, absolute_url, posted_at, first_seen_at, status, ' +
  'source_company_name, description_html, description_text, companies ( name ) )'

export type DeterministicFilterCode =
  | 'excluded_title_keyword'
  | 'excluded_keyword'
  | 'outside_us'
  | 'title_non_overlap'
export type Tier = 'Strong' | 'Good' | 'Weak'
export type RankingCategory =
  | 'title'
  | 'location'
  | 'recency'
  | 'watchlist'
  | 'experience'
  | 'keywords'

export interface RankingBreakdownRow {
  key: RankingCategory
  earned: number
  possible: number
  evidence: string[]
}

export interface FeedCompany {
  name: string | null
}

export interface FeedJob {
  id: string
  title: string
  location: string | null
  absolute_url: string
  posted_at: string | null
  first_seen_at: string
  status: string
  source_company_name: string | null
  companies: FeedCompany | null
  // Detail-only (FEED_DETAIL_COLUMNS): the only place JD bodies are fetched.
  description_html?: string | null
  description_text?: string | null
}

export interface FeedRow {
  id: string
  deterministic_revision: number | null
  deterministic_eligible: boolean | null
  deterministic_score: number | null
  deterministic_tier: Tier | null
  deterministic_breakdown: RankingBreakdownRow[] | null
  deterministic_filter_code: DeterministicFilterCode | null
  deterministic_filter_detail: string | null
  deterministic_ranked_at: string | null
  deterministic_best_fit_resume_id: string | null
  deterministic_runner_up_resume_id: string | null
  seen_at: string | null
  dismissed_at: string | null
  jobs: FeedJob | null
}

export interface TierPresentation {
  label: Tier
  badge: 'emerald' | 'neutral' | null
}

// Pure mappers — no supabase import needed, unit-tested directly.

export function tierPresentation(tier: Tier | null): TierPresentation | null {
  if (tier === 'Strong') return { label: 'Strong', badge: 'emerald' }
  if (tier === 'Good') return { label: 'Good', badge: 'neutral' }
  if (tier === 'Weak') return { label: 'Weak', badge: null }
  return null
}

// Only an atomically promoted, complete, eligible deterministic result can
// enter the active browser feed. Null/pending/ineligible rows never become Weak.
export function deterministicVisible(row: FeedRow): boolean {
  if (row.jobs?.status !== 'open') return false
  return row.deterministic_revision !== null
    && row.deterministic_eligible === true
    && row.deterministic_score !== null
    && row.deterministic_tier !== null
}

function nonblankName(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

// Prefer normalized company ownership, then the bounded source-provided name.
// Missing identity remains null: callers never invent a provider/company label.
export function companyName(row: FeedRow): string | null {
  const normalized = nonblankName(row.jobs?.companies?.name)
  if (normalized) return normalized

  const sourceProvided = nonblankName(row.jobs?.source_company_name)
  return sourceProvided && sourceProvided.length <= 200 ? sourceProvided : null
}

// The timestamp to render as a relative posted-time: prefer the job's posted_at,
// fall back to first_seen_at (RESEARCH), null when the job is missing.
export function relativePostedTime(row: FeedRow): string | null {
  if (!row.jobs) return null
  return row.jobs.posted_at ?? row.jobs.first_seen_at ?? null
}

// https-only apply-link guard (copied from watchlist.ts safeCareersUrl): rejects
// non-https schemes and embedded credentials (T-3-16 javascript:/data: URLs).
export function safeApplyUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null
    return parsed.href
  } catch {
    return null
  }
}

// Queries — throw on error, cast, return typed rows (watchlist.ts idiom).

// RLS-scoped to the current user. Query only atomically promoted eligible
// deterministic rows. Parent ordering uses PostgREST's to-one jobs(posted_at)
// syntax; referencedTable/foreignTable would sort only the embedded job object.
export async function listFeed(): Promise<FeedRow[]> {
  const { data, error } = await supabase
    .from('user_jobs')
    .select(FEED_LIST_COLUMNS)
    .eq('deterministic_eligible', true)
    .not('deterministic_revision', 'is', null)
    .not('deterministic_score', 'is', null)
    .not('deterministic_tier', 'is', null)
    .order('jobs(posted_at)', { ascending: false, nullsFirst: false })
    .limit(200)

  if (error) throw error
  const rows = (data ?? []) as unknown as FeedRow[]
  return rows.filter((row) => companyName(row) !== null && deterministicVisible(row))
}

// The only place JD bodies (description_html/description_text) are fetched.
export async function getFeedJob(userJobId: string): Promise<FeedRow> {
  const { data, error } = await supabase
    .from('user_jobs')
    .select(FEED_DETAIL_COLUMNS)
    .eq('id', userJobId)
    .single()

  if (error) throw error
  const row = data as unknown as FeedRow
  if (!deterministicVisible(row)) throw new Error('deterministic_job_not_visible')
  return row
}

// Mutations — only seen_at/dismissed_at are grant-writable (Plan 03 column
// grants); every helper throws on error.

// Conditional: chain .is('seen_at', null) so a detail re-mount never rewrites an
// existing timestamp (Codex markSeen concern) — the New badge clears once.
export async function markSeen(userJobId: string): Promise<void> {
  const { error } = await supabase
    .from('user_jobs')
    .update({ seen_at: new Date().toISOString() })
    .eq('id', userJobId)
    .is('seen_at', null)

  if (error) throw error
}

export async function dismissJob(userJobId: string): Promise<void> {
  const { error } = await supabase
    .from('user_jobs')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('id', userJobId)

  if (error) throw error
}

export async function undismissJob(userJobId: string): Promise<void> {
  const { error } = await supabase
    .from('user_jobs')
    .update({ dismissed_at: null })
    .eq('id', userJobId)

  if (error) throw error
}

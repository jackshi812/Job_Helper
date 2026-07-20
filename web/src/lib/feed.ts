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
  'id, status, filter_reason, filter_detail, score, tier, reasons, ' +
  'matched_include_keywords, routed_resume_id, runner_up_resume_id, scored_at, ' +
  'needs_refilter, score_deferred_until, seen_at, dismissed_at, ' +
  'jobs ( id, title, location, absolute_url, posted_at, first_seen_at, status, ' +
  'source_company_name, companies ( name ) )'

export const FEED_DETAIL_COLUMNS =
  'id, status, filter_reason, filter_detail, score, tier, reasons, gaps, covered, ' +
  'matched_include_keywords, routed_resume_id, runner_up_resume_id, scored_at, ' +
  'needs_refilter, score_deferred_until, seen_at, dismissed_at, ' +
  'jobs ( id, title, location, absolute_url, posted_at, first_seen_at, status, ' +
  'source_company_name, description_html, description_text, companies ( name ) )'

export type FeedStatus = 'pending' | 'filtered' | 'scored' | 'failed'
export type FilterReason = 'excluded_keyword' | 'wrong_location' | 'title_non_overlap'
export type Tier = 'Strong' | 'Good' | 'Weak'

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

export interface GapGroups {
  skills?: string[]
  tools?: string[]
  certs?: string[]
  domain?: string[]
}

export interface FeedRow {
  id: string
  status: FeedStatus
  filter_reason: FilterReason | null
  filter_detail: string | null
  score: number | null
  tier: Tier | null
  reasons: string[] | null
  matched_include_keywords?: string[] | null
  routed_resume_id: string | null
  runner_up_resume_id: string | null
  scored_at: string | null
  needs_refilter: boolean
  score_deferred_until: string | null
  seen_at: string | null
  dismissed_at: string | null
  jobs: FeedJob | null
  // Detail-only (FEED_DETAIL_COLUMNS).
  gaps?: GapGroups | null
  covered?: string[] | null
}

export interface TierPresentation {
  label: Tier
  badge: 'emerald' | 'neutral' | null
}

// Pure mappers — no supabase import needed, unit-tested directly.

// D-07 tiers re-derived from the clamped score: Strong >=75 (emerald fill),
// Good 50..74 (neutral fill), Weak <50 (plain text, no badge fill — UI-SPEC).
export function tierPresentation(score: number | null): TierPresentation {
  if (score !== null && score >= 75) return { label: 'Strong', badge: 'emerald' }
  if (score !== null && score >= 50) return { label: 'Good', badge: 'neutral' }
  return { label: 'Weak', badge: null }
}

const FILTER_REASON_LABELS: Record<FilterReason, string> = {
  excluded_keyword: 'excluded keyword',
  wrong_location: 'location mismatch',
  title_non_overlap: 'title mismatch',
}

// D-04 filtered-reason copy (UI-SPEC): excluded keyword carries its detail term;
// location/title mismatches are fixed strings. Returns null for unfiltered rows.
export function filteredReasonLabel(
  row: Pick<FeedRow, 'filter_reason' | 'filter_detail'>,
): string | null {
  if (!row.filter_reason) return null
  const base = FILTER_REASON_LABELS[row.filter_reason]
  if (row.filter_reason === 'excluded_keyword' && row.filter_detail) {
    return `${base}: ${row.filter_detail}`
  }
  return base
}

// D-15/D-16 default view: scored rows for open jobs scoring >=50 (Strong+Good)
// that are not dismissed. A previously scored row awaiting refilter remains
// useful but must be rendered with scoreFreshnessLabel so it is never presented
// as current. Pending rows without an existing score remain hidden.
export function defaultVisible(row: FeedRow): boolean {
  return row.status === 'scored'
    && (row.score ?? 0) >= 50
    && row.dismissed_at === null
    && (!row.needs_refilter || row.score_deferred_until !== null)
    && row.jobs?.status === 'open'
}

export function scoreFreshnessLabel(
  row: Pick<FeedRow, 'status' | 'score' | 'needs_refilter' | 'score_deferred_until'>,
): 'Updating' | null {
  return row.status === 'scored'
      && row.score !== null
      && row.needs_refilter
      && row.score_deferred_until !== null
    ? 'Updating'
    : null
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

// Newest-first, RLS-scoped to the current user. Ordering is on the embedded
// jobs.posted_at (a plain .order on user_jobs would error — posted_at lives on
// the embedded jobs row). Bounded to a recent 200-row window (Codex LOW).
export async function listFeed(): Promise<FeedRow[]> {
  const { data, error } = await supabase
    .from('user_jobs')
    .select(FEED_LIST_COLUMNS)
    .order('posted_at', { foreignTable: 'jobs', ascending: false })
    .limit(200)

  if (error) throw error
  const rows = (data ?? []) as unknown as FeedRow[]
  return rows.filter((row) => companyName(row) !== null)
}

// The only place JD bodies (description_html/description_text) are fetched.
export async function getFeedJob(userJobId: string): Promise<FeedRow> {
  const { data, error } = await supabase
    .from('user_jobs')
    .select(FEED_DETAIL_COLUMNS)
    .eq('id', userJobId)
    .single()

  if (error) throw error
  return data as unknown as FeedRow
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

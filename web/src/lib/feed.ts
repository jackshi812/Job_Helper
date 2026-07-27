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
  'seen_at, dismissed_at, applied_at, ' +
  'jobs!inner ( id, title, location, absolute_url, posted_at, first_seen_at, status, ' +
  'source_company_name, companies ( name ) )'

export const FEED_DETAIL_COLUMNS =
  'id, deterministic_revision, deterministic_eligible, deterministic_score, ' +
  'deterministic_tier, deterministic_breakdown, deterministic_filter_code, ' +
  'deterministic_filter_detail, deterministic_ranked_at, ' +
  'deterministic_best_fit_resume_id, deterministic_runner_up_resume_id, ' +
  'seen_at, dismissed_at, applied_at, ' +
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
  applied_at: string | null
  jobs: FeedJob | null
}

export type LifecycleView = 'active' | 'applied' | 'dismissed'
export type DashboardFeedOrder = 'newest' | 'score_desc' | 'score_asc'

export interface DashboardFeedQuery {
  lifecycle: LifecycleView
  order: DashboardFeedOrder
  tiers: readonly Tier[]
  hiddenCompanyKeys: readonly string[]
}

export interface DashboardFeedCursor {
  v: 1
  lifecycle: LifecycleView
  order: DashboardFeedOrder
  signature: string
  id: string
  posted_at: string | null
  first_seen_at: string | null
  score: number | null
  lifecycle_at: string | null
}

export interface DashboardFeedPage {
  rows: FeedRow[]
  nextCursor: string | null
  hasMore: boolean
  caughtUp: boolean
}

export interface DashboardCompanyOption {
  key: string
  label: string
  count: number
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

const DASHBOARD_PAGE_SIZE = 200
const MAX_CURSOR_LENGTH = 4096
const MAX_HIDDEN_COMPANIES = 200
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const CURSOR_KEYS = [
  'first_seen_at',
  'id',
  'lifecycle',
  'lifecycle_at',
  'order',
  'posted_at',
  'score',
  'signature',
  'v',
] as const
const TIER_ORDER: readonly Tier[] = ['Strong', 'Good', 'Weak']

interface NormalizedDashboardFeedQuery {
  lifecycle: LifecycleView
  order: DashboardFeedOrder
  tiers: Tier[]
  hiddenCompanyKeys: string[]
}

interface DashboardFeedRpcRow {
  row_data: unknown
  cursor_data: unknown
  has_more: unknown
}

interface DashboardCompanyOptionRpcRow {
  company_key: unknown
  company_name: unknown
  matching_count: unknown
}

function invalidCursor(): never {
  throw new Error('invalid_dashboard_cursor')
}

function normalizedCompanyKey(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase()
}

function normalizeDashboardFeedQuery(
  query: DashboardFeedQuery,
): NormalizedDashboardFeedQuery {
  if (!['active', 'applied', 'dismissed'].includes(query.lifecycle)) {
    throw new Error('invalid_dashboard_lifecycle')
  }
  if (
    !['newest', 'score_desc', 'score_asc'].includes(query.order)
    || (query.lifecycle !== 'active' && query.order !== 'newest')
  ) {
    throw new Error('invalid_dashboard_order')
  }

  const tierSet = new Set(query.tiers)
  if (
    tierSet.size !== query.tiers.length
    || tierSet.size < 1
    || tierSet.size > TIER_ORDER.length
    || [...tierSet].some((tier) => !TIER_ORDER.includes(tier))
  ) {
    throw new Error('invalid_dashboard_tiers')
  }

  if (query.hiddenCompanyKeys.length > MAX_HIDDEN_COMPANIES) {
    throw new Error('invalid_dashboard_company_keys')
  }
  const hiddenCompanyKeys = query.hiddenCompanyKeys.map((value) => {
    if (typeof value !== 'string') throw new Error('invalid_dashboard_company_keys')
    const normalized = normalizedCompanyKey(value)
    if (
      !normalized
      || normalized.length > 200
      || /[\u0000-\u001f\u007f]/u.test(normalized)
    ) {
      throw new Error('invalid_dashboard_company_keys')
    }
    return normalized
  })
  if (new Set(hiddenCompanyKeys).size !== hiddenCompanyKeys.length) {
    throw new Error('invalid_dashboard_company_keys')
  }

  return {
    lifecycle: query.lifecycle,
    order: query.order,
    tiers: TIER_ORDER.filter((tier) => tierSet.has(tier)),
    hiddenCompanyKeys: [...hiddenCompanyKeys].sort(),
  }
}

function dashboardQuerySignature(query: NormalizedDashboardFeedQuery): string {
  const canonical = JSON.stringify([
    query.lifecycle,
    query.order,
    query.tiers,
    query.hiddenCompanyKeys,
  ])
  let hash = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(canonical)) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0')
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/u, '')
}

function decodeBase64Url(value: string): string {
  if (
    value.length < 1
    || value.length > MAX_CURSOR_LENGTH
    || !/^[A-Za-z0-9_-]+$/u.test(value)
  ) invalidCursor()

  try {
    const standard = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = standard.padEnd(Math.ceil(standard.length / 4) * 4, '=')
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return invalidCursor()
  }
}

function isCanonicalTimestamp(value: unknown, allowNegativeInfinity = false): value is string {
  if (allowNegativeInfinity && value === '-infinity') return true
  if (typeof value !== 'string') return false
  const time = new Date(value)
  return Number.isFinite(time.getTime())
    && /(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
}

function validateCursorShape(value: unknown): DashboardFeedCursor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidCursor()
  const record = value as Record<string, unknown>
  if (
    JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(CURSOR_KEYS)
    || record.v !== 1
    || !['active', 'applied', 'dismissed'].includes(String(record.lifecycle))
    || !['newest', 'score_desc', 'score_asc'].includes(String(record.order))
    || typeof record.signature !== 'string'
    || !/^[0-9a-f]{16}$/u.test(record.signature)
    || typeof record.id !== 'string'
    || !UUID_PATTERN.test(record.id)
  ) invalidCursor()

  const lifecycle = record.lifecycle as LifecycleView
  const order = record.order as DashboardFeedOrder
  const scoreIsValid = record.score === null
    || (
      typeof record.score === 'number'
      && Number.isInteger(record.score)
      && record.score >= 0
      && record.score <= 100
    )
  if (!scoreIsValid) invalidCursor()

  if (lifecycle === 'active') {
    if (
      !isCanonicalTimestamp(record.posted_at, true)
      || !isCanonicalTimestamp(record.first_seen_at)
      || typeof record.score !== 'number'
      || record.lifecycle_at !== null
    ) invalidCursor()
  } else if (
    order !== 'newest'
    || record.posted_at !== null
    || record.first_seen_at !== null
    || record.score !== null
    || !isCanonicalTimestamp(record.lifecycle_at)
  ) {
    invalidCursor()
  }

  return {
    v: 1,
    lifecycle,
    order,
    signature: record.signature as string,
    id: record.id,
    posted_at: record.posted_at as string | null,
    first_seen_at: record.first_seen_at as string | null,
    score: record.score as number | null,
    lifecycle_at: record.lifecycle_at as string | null,
  }
}

export function encodeDashboardFeedCursor(
  cursor: DashboardFeedCursor,
  query: DashboardFeedQuery,
): string {
  const normalizedQuery = normalizeDashboardFeedQuery(query)
  const validated = validateCursorShape({
    ...cursor,
    signature: /^[0-9a-f]{16}$/u.test(cursor.signature)
      ? cursor.signature
      : '0000000000000000',
  })
  if (
    validated.lifecycle !== normalizedQuery.lifecycle
    || validated.order !== normalizedQuery.order
  ) {
    throw new Error('dashboard_cursor_signature_mismatch')
  }

  const canonical: DashboardFeedCursor = {
    v: 1,
    lifecycle: normalizedQuery.lifecycle,
    order: normalizedQuery.order,
    signature: dashboardQuerySignature(normalizedQuery),
    id: validated.id,
    posted_at: validated.posted_at,
    first_seen_at: validated.first_seen_at,
    score: validated.score,
    lifecycle_at: validated.lifecycle_at,
  }
  const encoded = encodeBase64Url(JSON.stringify(canonical))
  if (encoded.length > MAX_CURSOR_LENGTH) invalidCursor()
  return encoded
}

export function decodeDashboardFeedCursor(
  encoded: string,
  query: DashboardFeedQuery,
): DashboardFeedCursor {
  const normalizedQuery = normalizeDashboardFeedQuery(query)
  let parsed: unknown
  try {
    parsed = JSON.parse(decodeBase64Url(encoded))
  } catch {
    return invalidCursor()
  }
  const cursor = validateCursorShape(parsed)
  if (encodeBase64Url(JSON.stringify(cursor)) !== encoded) invalidCursor()
  if (
    cursor.lifecycle !== normalizedQuery.lifecycle
    || cursor.order !== normalizedQuery.order
    || cursor.signature !== dashboardQuerySignature(normalizedQuery)
  ) {
    throw new Error('dashboard_cursor_signature_mismatch')
  }
  return cursor
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
    .eq('jobs.status', 'open')
    .order('jobs(posted_at)', { ascending: false, nullsFirst: false })
    .limit(200)

  if (error) throw error
  const rows = (data ?? []) as unknown as FeedRow[]
  return rows.filter((row) => companyName(row) !== null && deterministicVisible(row))
}

function dashboardFeedRpcArgs(
  query: DashboardFeedQuery,
  encodedCursor: string | null,
  limit: number,
) {
  const normalizedQuery = normalizeDashboardFeedQuery(query)
  const cursor = encodedCursor === null
    ? null
    : decodeDashboardFeedCursor(encodedCursor, normalizedQuery)
  return {
    normalizedQuery,
    args: {
      p_lifecycle: normalizedQuery.lifecycle,
      p_order: normalizedQuery.order,
      p_tiers: normalizedQuery.tiers,
      p_hidden_company_keys: normalizedQuery.hiddenCompanyKeys,
      p_query_signature: dashboardQuerySignature(normalizedQuery),
      p_cursor: cursor,
      p_limit: limit,
    },
  }
}

function parseFeedRow(value: unknown): FeedRow {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || typeof (value as { id?: unknown }).id !== 'string'
  ) {
    throw new Error('invalid_dashboard_feed_response')
  }
  return value as FeedRow
}

async function requestDashboardFeedPage(
  query: DashboardFeedQuery,
  encodedCursor: string | null,
  limit: number,
): Promise<DashboardFeedPage> {
  const { normalizedQuery, args } = dashboardFeedRpcArgs(query, encodedCursor, limit)
  const { data, error } = await supabase.rpc('dashboard_feed_page', args)
  if (error) throw error
  if (!Array.isArray(data) || data.length > limit) {
    throw new Error('invalid_dashboard_feed_response')
  }
  if (data.length === 0) {
    return { rows: [], nextCursor: null, hasMore: false, caughtUp: true }
  }

  const parsed = data.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('invalid_dashboard_feed_response')
    }
    const rpcRow = value as DashboardFeedRpcRow
    if (typeof rpcRow.has_more !== 'boolean') {
      throw new Error('invalid_dashboard_feed_response')
    }
    return {
      row: parseFeedRow(rpcRow.row_data),
      cursor: validateCursorShape(rpcRow.cursor_data),
      hasMore: rpcRow.has_more,
    }
  })
  const hasMore = parsed[0].hasMore
  if (parsed.some((entry) => entry.hasMore !== hasMore)) {
    throw new Error('invalid_dashboard_feed_response')
  }

  const lastCursor = parsed.at(-1)?.cursor
  if (!lastCursor) throw new Error('invalid_dashboard_feed_response')
  const expectedSignature = dashboardQuerySignature(normalizedQuery)
  if (
    lastCursor.lifecycle !== normalizedQuery.lifecycle
    || lastCursor.order !== normalizedQuery.order
    || lastCursor.signature !== expectedSignature
  ) {
    throw new Error('dashboard_cursor_signature_mismatch')
  }

  return {
    rows: parsed.map(({ row }) => row),
    nextCursor: hasMore
      ? encodeDashboardFeedCursor(lastCursor, normalizedQuery)
      : null,
    hasMore,
    caughtUp: !hasMore,
  }
}

export function listFeedPage(
  query: DashboardFeedQuery,
  cursor: string | null = null,
): Promise<DashboardFeedPage> {
  return requestDashboardFeedPage(query, cursor, DASHBOARD_PAGE_SIZE)
}

export function backfillDashboardFeedRow(
  query: DashboardFeedQuery,
  cursor: string | null = null,
): Promise<DashboardFeedPage> {
  return requestDashboardFeedPage(query, cursor, 1)
}

export async function listDashboardCompanyOptions(
  query: DashboardFeedQuery,
): Promise<DashboardCompanyOption[]> {
  const normalizedQuery = normalizeDashboardFeedQuery(query)
  const { data, error } = await supabase.rpc('dashboard_company_options', {
    p_lifecycle: normalizedQuery.lifecycle,
    p_tiers: normalizedQuery.tiers,
  })
  if (error) throw error
  if (!Array.isArray(data)) throw new Error('invalid_dashboard_company_options')

  return data.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('invalid_dashboard_company_options')
    }
    const row = value as DashboardCompanyOptionRpcRow
    const count = typeof row.matching_count === 'number'
      ? row.matching_count
      : Number(row.matching_count)
    if (
      typeof row.company_key !== 'string'
      || normalizedCompanyKey(row.company_key) !== row.company_key
      || typeof row.company_name !== 'string'
      || !row.company_name.trim()
      || !Number.isSafeInteger(count)
      || count < 0
    ) {
      throw new Error('invalid_dashboard_company_options')
    }
    return {
      key: row.company_key,
      label: row.company_name,
      count,
    }
  })
}

export function mergeDashboardFeedPages(
  current: DashboardFeedPage,
  incoming: DashboardFeedPage,
): DashboardFeedPage {
  const seen = new Set(current.rows.map(({ id }) => id))
  const rows = [...current.rows]
  for (const row of incoming.rows) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    rows.push(row)
  }
  return {
    rows,
    nextCursor: incoming.nextCursor,
    hasMore: incoming.hasMore,
    caughtUp: incoming.caughtUp,
  }
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

// Mutations. Dismissal is an authenticated RPC because it atomically records a
// compact provider-identity tombstone and permanently removes only this user's
// heavy projection. It never deletes the shared jobs row.

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
  const { data, error } = await supabase.rpc('dismiss_job_permanently', {
    p_user_job_id: userJobId,
  })

  if (error) throw error
  if (data !== true) throw new Error('user_job_not_found')
}

export async function markJobApplied(userJobId: string): Promise<void> {
  const { error } = await supabase
    .from('user_jobs')
    .update({
      applied_at: new Date().toISOString(),
      dismissed_at: null,
    })
    .eq('id', userJobId)

  if (error) throw error
}

export async function undoJobApplied(userJobId: string): Promise<void> {
  const { error } = await supabase
    .from('user_jobs')
    .update({ applied_at: null })
    .eq('id', userJobId)

  if (error) throw error
}

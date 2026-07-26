import {
  resolveBrandedIdentity,
  type BrandedFacetIdentity,
  type OracleRecruitingBrandedIdentity,
} from '../branded-identities.ts'
import {
  BoundedPoolDeadlineError,
  runBoundedPool,
} from '../bounded-pool.ts'
import {
  createBrandedScopeEvidence,
} from './scope.ts'
import type {
  BrandedObservationScopeEvidence,
  NormalizedJob,
  PollObservation,
} from './types.ts'

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export interface OracleRecruitingAdapterOptions {
  pageSize?: number
  maxPages?: number
  maxJobs?: number
  maxBytes?: number
  maxDetailRequests?: number
  detailConcurrency?: number
  totalDurationMs?: number
  now?: () => number
  wallClockNow?: () => number
}

interface OracleRequisition {
  id: string
  title: string
  location: string
  familyLabel: string
  titleFacet: BrandedFacetIdentity
  postedAt: string
}

interface SliceEvidence {
  readonly titleFacet: BrandedFacetIdentity
  readonly expected: number
  readonly fetched: number
  readonly pages: number
}

interface InvocationBudget {
  readonly deadline: number
  readonly now: () => number
}

class ProviderError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

const REQUEST_TIMEOUT_MS = 15_000
const MAX_DESCRIPTION_LENGTH = 200_000
const textEncoder = new TextEncoder()

function incomplete(
  jobs: NormalizedJob[],
  warning: string,
  expectedCount?: number,
  pageCount = 0,
): PollObservation {
  return {
    jobs,
    completeness: jobs.length > 0 ? 'partial' : 'unknown',
    credibleForClosure: false,
    allowMissingClosure: false,
    pageCount,
    ...(expectedCount === undefined ? {} : { expectedCount }),
    warnings: [warning.slice(0, 64)],
  }
}

function remainingDuration(budget: InvocationBudget): number {
  return budget.deadline - budget.now()
}

function requireRemainingDuration(budget: InvocationBudget): number {
  const remaining = remainingDuration(budget)
  if (!Number.isFinite(remaining) || remaining <= 0) {
    throw new ProviderError('deadline_exceeded')
  }
  return remaining
}

async function requestJson(
  url: URL,
  fetchImpl: FetchLike,
  maxBytes: number,
  budget: InvocationBudget,
  parentSignal?: AbortSignal,
): Promise<unknown> {
  const remaining = requireRemainingDuration(budget)
  const timeout = AbortSignal.timeout(
    Math.max(1, Math.ceil(Math.min(REQUEST_TIMEOUT_MS, remaining))),
  )
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      signal: parentSignal
        ? AbortSignal.any([parentSignal, timeout])
        : timeout,
      headers: { accept: 'application/json' },
    })
  } catch {
    if (remainingDuration(budget) <= 0 || parentSignal?.aborted) {
      throw new ProviderError('deadline_exceeded')
    }
    throw new ProviderError('network_error')
  }

  if (response.redirected) throw new ProviderError('redirect_rejected')
  if (!response.ok) {
    throw new ProviderError(
      response.status === 429 ? 'http_429' : `provider_http_${response.status}`,
    )
  }
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new ProviderError('invalid_content_type')
  }
  const declaredBytes = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
    throw new ProviderError('payload_too_large')
  }
  const text = await response.text()
  if (textEncoder.encode(text).byteLength > maxBytes) {
    throw new ProviderError('payload_too_large')
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new ProviderError('malformed_response')
  }
}

function boundedString(value: unknown, maxLength: number): string | null {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= maxLength
    && !/[\p{Cc}\p{Cf}]/u.test(value)
    ? value.trim()
    : null
}

function stableId(value: unknown): string | null {
  if (
    (typeof value !== 'string' && typeof value !== 'number')
    || String(value).length > 256
  ) return null
  const id = String(value).trim()
  return id && /^[0-9]+$/.test(id) ? id : null
}

function normalizedLabel(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US')
    .replace(/\s+/gu, ' ').trim()
}

function sameFacetId(value: unknown, expected: string): boolean {
  return (typeof value === 'number' || typeof value === 'string')
    && String(value) === expected
}

function exactFacet(
  values: unknown,
  expected: BrandedFacetIdentity,
  expectedTotal: number,
): boolean {
  if (!Array.isArray(values)) return false
  const matches = values.filter((entry) =>
    entry
    && typeof entry === 'object'
    && sameFacetId((entry as Record<string, unknown>).Id, expected.id)
  )
  if (matches.length !== 1) return false
  const match = matches[0] as Record<string, unknown>
  return normalizedLabel(String(match.Name ?? ''))
      === normalizedLabel(expected.expectedLabel)
    && match.TotalCount === expectedTotal
}

function parsePostedDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    return undefined
  }
  return new Date(value).toISOString()
}

function isRecentPosting(
  postedAt: string,
  wallClockNow: number,
  recentDays: number,
): boolean {
  if (!Number.isFinite(wallClockNow)) return false
  const parsed = Date.parse(postedAt)
  if (!Number.isFinite(parsed)) return false
  const now = new Date(wallClockNow)
  const cutoff = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - (recentDays - 1),
  )
  return parsed >= cutoff && parsed <= wallClockNow + 5 * 60 * 1_000
}

function parseRequisition(
  value: unknown,
  facet: BrandedFacetIdentity,
  wallClockNow: number,
  recentDays: number,
): OracleRequisition | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const id = stableId(raw.Id)
  const title = boundedString(raw.Title, 512)
  const location = boundedString(raw.PrimaryLocation, 1_024)
  const listCountry = boundedString(raw.PrimaryLocationCountry, 8)
  const familyLabel = boundedString(raw.JobFunction, 160)
  const postedAt = parsePostedDate(raw.PostedDate)
  if (
    !id
    || !title
    || !location
    || listCountry !== 'US'
    || !familyLabel
    || normalizedLabel(familyLabel) !== normalizedLabel(facet.expectedLabel)
    || !postedAt
    || !isRecentPosting(postedAt, wallClockNow, recentDays)
  ) return null
  return {
    id,
    title,
    location,
    familyLabel,
    titleFacet: facet,
    postedAt,
  }
}

function finderValue(values: Readonly<Record<string, string>>): string {
  const [name, ...parts] = Object.entries(values)
  return `${name[1]};${parts.map(([key, value]) => `${key}=${value}`).join(',')}`
}

function listUrl(
  identity: OracleRecruitingBrandedIdentity,
  facet: BrandedFacetIdentity,
  offset: number,
  pageSize: number,
): URL {
  const url = new URL(identity.listPath, identity.origin)
  url.searchParams.set('onlyData', 'true')
  url.searchParams.set('expand', 'requisitionList')
  url.searchParams.set('finder', finderValue({
    finder: 'findReqs',
    siteNumber: identity.siteNumber,
    limit: String(pageSize),
    offset: String(offset),
    selectedLocationsFacet: identity.countryFacet.id,
    selectedTitlesFacet: facet.id,
    selectedPostingDatesFacet: identity.postingDateFacet.id,
  }))
  return url
}

function detailUrl(
  identity: OracleRecruitingBrandedIdentity,
  id: string,
): URL {
  const url = new URL(identity.detailPath, identity.origin)
  url.searchParams.set('onlyData', 'true')
  url.searchParams.set('expand', 'all')
  url.searchParams.set('finder', finderValue({
    finder: 'ById',
    Id: `"${id}"`,
    siteNumber: identity.siteNumber,
  }))
  return url
}

function parseSlicePage(
  payload: unknown,
  identity: OracleRecruitingBrandedIdentity,
  facet: BrandedFacetIdentity,
  requestedOffset: number,
  pageSize: number,
  wallClockNow: number,
  priorExpected?: number,
): {
  expected: number
  requisitions: OracleRequisition[]
} {
  if (!payload || typeof payload !== 'object') {
    throw new ProviderError('provider_schema_invalid')
  }
  const outer = payload as Record<string, unknown>
  if (
    outer.count !== 1
    || outer.hasMore !== false
    || !Array.isArray(outer.items)
    || outer.items.length !== 1
    || !outer.items[0]
    || typeof outer.items[0] !== 'object'
  ) throw new ProviderError('provider_schema_invalid')

  const page = outer.items[0] as Record<string, unknown>
  if (
    page.SiteNumber !== identity.siteNumber
    || page.SelectedLocationsFacet !== identity.countryFacet.id
    || page.SelectedTitlesFacet !== facet.id
    || page.SelectedPostingDatesFacet !== identity.postingDateFacet.id
    || !Number.isInteger(page.Offset)
    || page.Offset !== requestedOffset
  ) {
    throw new ProviderError(
      page.Offset !== requestedOffset
        ? 'slice_offset_mismatch'
        : 'slice_identity_mismatch',
    )
  }
  if (!Number.isInteger(page.Limit) || page.Limit !== pageSize) {
    throw new ProviderError('slice_limit_mismatch')
  }
  if (
    !Number.isInteger(page.TotalJobsCount)
    || (page.TotalJobsCount as number) < 0
    || !Array.isArray(page.requisitionList)
    || page.requisitionList.length > pageSize
  ) throw new ProviderError('provider_schema_invalid')

  const expected = page.TotalJobsCount as number
  if (priorExpected !== undefined && expected !== priorExpected) {
    throw new ProviderError('slice_count_mismatch')
  }
  if (
    !exactFacet(page.titlesFacet, facet, expected)
    || !exactFacet(page.locationsFacet, identity.countryFacet, expected)
    || !exactFacet(page.postingDatesFacet, identity.postingDateFacet, expected)
  ) throw new ProviderError('facet_label_mismatch')

  const parsed = page.requisitionList.map((value) =>
    parseRequisition(
      value,
      facet,
      wallClockNow,
      identity.postingDateFacet.recentDays,
    )
  )
  if (parsed.some((requisition) => requisition === null)) {
    throw new ProviderError('provider_schema_invalid')
  }
  return {
    expected,
    requisitions: parsed as OracleRequisition[],
  }
}

function oracleDescription(raw: Record<string, unknown>): string | null {
  const fields = [
    raw.ExternalDescriptionStr,
    raw.ExternalResponsibilitiesStr,
    raw.ExternalQualificationsStr,
    raw.ShortDescriptionStr,
  ]
    .map((value) => boundedString(value, MAX_DESCRIPTION_LENGTH))
    .filter((value): value is string => value !== null)
  if (fields.length === 0) return null
  const combined = fields.join('\n')
  return combined.length <= MAX_DESCRIPTION_LENGTH ? combined : null
}

function htmlToText(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

async function normalizeDetail(
  payload: unknown,
  listed: OracleRequisition,
  identity: OracleRecruitingBrandedIdentity,
  wallClockNow: number,
): Promise<NormalizedJob> {
  if (!payload || typeof payload !== 'object') {
    throw new ProviderError('provider_schema_invalid')
  }
  const outer = payload as Record<string, unknown>
  if (
    outer.count !== 1
    || outer.hasMore !== false
    || !Array.isArray(outer.items)
    || outer.items.length !== 1
    || !outer.items[0]
    || typeof outer.items[0] !== 'object'
  ) throw new ProviderError('provider_schema_invalid')
  const raw = outer.items[0] as Record<string, unknown>
  if (stableId(raw.Id) !== listed.id) {
    throw new ProviderError('detail_id_mismatch')
  }
  if (raw.PrimaryLocationCountry !== 'US') {
    throw new ProviderError('detail_country_ineligible')
  }
  const detailFamily = boundedString(raw.JobFunction, 160)
  if (
    !detailFamily
    || normalizedLabel(detailFamily) !== normalizedLabel(listed.familyLabel)
  ) {
    throw new ProviderError('detail_category_ineligible')
  }
  const descriptionHtml = oracleDescription(raw)
  if (!descriptionHtml) throw new ProviderError('detail_evidence_missing')
  const detailTitle = boundedString(raw.Title, 512)
  const detailLocation = boundedString(raw.PrimaryLocation, 1_024)
  if (
    !detailTitle
    || !detailLocation
    || detailTitle !== listed.title
    || detailLocation !== listed.location
  ) {
    throw new ProviderError('detail_evidence_missing')
  }
  const detailPostedAt = parsePostedDate(raw.ExternalPostedStartDate)
  if (
    !detailPostedAt
    || !isRecentPosting(
      detailPostedAt,
      wallClockNow,
      identity.postingDateFacet.recentDays,
    )
  ) {
    throw new ProviderError('detail_posting_date_ineligible')
  }

  const scopeEvidence = await createBrandedScopeEvidence({
    sourceKey: identity.sourceKey,
    externalId: listed.id,
    providerCategoryLabel: listed.familyLabel,
    detailCountryCode: 'US',
  })
  return {
    source: 'oracle_recruiting',
    externalId: listed.id,
    title: detailTitle,
    location: detailLocation,
    absoluteUrl:
      `${identity.origin}/hcmUI/CandidateExperience/en/sites/${identity.siteNumber}/job/${listed.id}`,
    postedAt: detailPostedAt,
    descriptionHtml,
    descriptionText: htmlToText(descriptionHtml),
    snapshotPartial: false,
    companyName: identity.companyName,
    scopeEvidence,
  }
}

async function sha256Hex(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    textEncoder.encode(JSON.stringify(value)),
  )
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function aggregateEvidence(
  identity: OracleRecruitingBrandedIdentity,
  slices: readonly SliceEvidence[],
  jobs: readonly NormalizedJob[],
): Promise<BrandedObservationScopeEvidence> {
  return Object.freeze({
    sourceKey: identity.sourceKey,
    sliceDigests: Object.freeze(await Promise.all(slices.map((slice) =>
      sha256Hex([
        identity.sourceKey,
        slice.titleFacet.id,
        slice.titleFacet.expectedLabel,
        identity.countryFacet.id,
        identity.postingDateFacet.id,
        identity.postingDateFacet.expectedLabel,
        slice.expected,
        slice.fetched,
        slice.pages,
      ])
    ))),
    categoryDigest: await sha256Hex(
      jobs.map((job) => job.scopeEvidence?.providerCategoryLabel),
    ),
    countryDigest: await sha256Hex(
      jobs.map((job) => job.scopeEvidence?.detailCountryCode),
    ),
  })
}

function errorCode(error: unknown): string {
  return error instanceof ProviderError ? error.code : 'provider_error'
}

export async function pollJpmorganOracleRecruiting(
  identity: OracleRecruitingBrandedIdentity,
  fetchImpl: FetchLike = fetch,
  options: OracleRecruitingAdapterOptions = {},
): Promise<PollObservation> {
  if (
    !identity
    || identity.provider !== 'oracle_recruiting'
    || resolveBrandedIdentity(identity.sourceKey) !== identity
  ) return incomplete([], 'invalid_identity')

  const pageSize = Math.min(
    Math.max(Math.floor(options.pageSize ?? identity.transport.pageSize), 1),
    identity.transport.pageSize,
  )
  const maxPages = Math.min(
    Math.max(Math.floor(options.maxPages ?? identity.transport.maxPages), 1),
    identity.transport.maxPages,
  )
  const maxJobs = Math.min(
    Math.max(Math.floor(options.maxJobs ?? identity.transport.maxJobs), 1),
    identity.transport.maxJobs,
  )
  const maxBytes = Math.min(
    Math.max(Math.floor(options.maxBytes ?? identity.transport.maxBytes), 1),
    identity.transport.maxBytes,
  )
  const maxDetailRequests = Math.min(
    Math.max(
      Math.floor(
        options.maxDetailRequests ?? identity.transport.maxDetailRequests,
      ),
      0,
    ),
    identity.transport.maxDetailRequests,
  )
  const detailConcurrency = Math.min(
    Math.max(
      Math.floor(
        options.detailConcurrency ?? identity.transport.detailConcurrency,
      ),
      1,
    ),
    identity.transport.detailConcurrency,
  )
  const totalDurationMs = Math.min(
    Math.max(
      options.totalDurationMs ?? identity.transport.stopSchedulingAfterMs,
      1,
    ),
    identity.transport.stopSchedulingAfterMs,
  )
  const now = options.now ?? (() => performance.now())
  const wallClockNow = (options.wallClockNow ?? Date.now)()
  const startedAt = now()
  if (!Number.isFinite(startedAt) || !Number.isFinite(wallClockNow)) {
    return incomplete([], 'invalid_clock')
  }
  const budget: InvocationBudget = {
    deadline: startedAt + totalDurationMs,
    now,
  }

  const union = new Map<string, OracleRequisition>()
  const slices: SliceEvidence[] = []
  let totalPages = 0

  for (const facet of identity.titleFacets) {
    const slice: OracleRequisition[] = []
    const sliceIds = new Set<string>()
    let expected: number | undefined
    let slicePages = 0

    while (slice.length < (expected ?? Number.POSITIVE_INFINITY)) {
      if (slicePages >= maxPages || totalPages >= maxPages) {
        return incomplete([], 'page_cap_exceeded', union.size, totalPages)
      }
      let page: { expected: number; requisitions: OracleRequisition[] }
      try {
        const payload = await requestJson(
          listUrl(identity, facet, slice.length, pageSize),
          fetchImpl,
          maxBytes,
          budget,
        )
        page = parseSlicePage(
          payload,
          identity,
          facet,
          slice.length,
          pageSize,
          wallClockNow,
          expected,
        )
      } catch (error) {
        return incomplete([], errorCode(error), union.size, totalPages)
      }
      if (expected === undefined) expected = page.expected
      if (expected > maxJobs) {
        return incomplete([], 'job_cap_exceeded', union.size, totalPages + 1)
      }
      for (const requisition of page.requisitions) {
        if (sliceIds.has(requisition.id)) {
          return incomplete([], 'duplicate_id', union.size, totalPages + 1)
        }
        sliceIds.add(requisition.id)
        slice.push(requisition)
      }
      slicePages += 1
      totalPages += 1
      if (slice.length > expected) {
        return incomplete([], 'slice_count_mismatch', union.size, totalPages)
      }
      if (slice.length < expected && page.requisitions.length === 0) {
        return incomplete([], 'slice_count_mismatch', union.size, totalPages)
      }
    }

    if (expected === undefined || slice.length !== expected) {
      return incomplete([], 'slice_count_mismatch', union.size, totalPages)
    }
    slices.push({
      titleFacet: facet,
      expected,
      fetched: slice.length,
      pages: slicePages,
    })
    for (const requisition of slice) {
      const existing = union.get(requisition.id)
      if (
        existing
        && (
          existing.title !== requisition.title
          || existing.location !== requisition.location
          || existing.familyLabel !== requisition.familyLabel
          || existing.postedAt !== requisition.postedAt
        )
      ) return incomplete([], 'cross_slice_id_drift', union.size, totalPages)
      if (!existing) union.set(requisition.id, requisition)
    }
    if (union.size > maxJobs) {
      return incomplete([], 'job_cap_exceeded', union.size, totalPages)
    }
  }

  const requisitions = [...union.values()]
  if (requisitions.length === 0) {
    return incomplete([], 'zero_eligible_jobs', 0, totalPages)
  }
  if (remainingDuration(budget) <= 0) {
    return incomplete([], 'deadline_exceeded', requisitions.length, totalPages)
  }

  const scheduled = requisitions.slice(0, maxDetailRequests)
  const jobs: NormalizedJob[] = []
  let outcomes: PromiseSettledResult<NormalizedJob>[]
  try {
    outcomes = await runBoundedPool(
      scheduled,
      async (listed, _index, signal) => {
        const payload = await requestJson(
          detailUrl(identity, listed.id),
          fetchImpl,
          maxBytes,
          budget,
          signal,
        )
        return normalizeDetail(payload, listed, identity, wallClockNow)
      },
      {
        concurrency: detailConcurrency,
        deadlineMs: Math.max(1, remainingDuration(budget)),
        now,
      },
    )
  } catch (error) {
    if (error instanceof BoundedPoolDeadlineError) {
      for (const settled of error.outcomes) {
        if (settled.outcome.status === 'fulfilled') {
          jobs.push(settled.outcome.value as NormalizedJob)
        }
      }
      return incomplete(jobs, 'deadline_exceeded', requisitions.length, totalPages)
    }
    return incomplete(jobs, errorCode(error), requisitions.length, totalPages)
  }

  for (const outcome of outcomes) {
    if (outcome.status === 'fulfilled') jobs.push(outcome.value)
  }
  const failed = outcomes.find((outcome) => outcome.status === 'rejected')
  if (failed?.status === 'rejected') {
    return incomplete(
      jobs,
      errorCode(failed.reason),
      requisitions.length,
      totalPages,
    )
  }
  if (scheduled.length !== requisitions.length) {
    return incomplete(
      jobs,
      'detail_cap_exceeded',
      requisitions.length,
      totalPages,
    )
  }

  return {
    jobs,
    completeness: 'complete',
    credibleForClosure: true,
    allowMissingClosure: false,
    pageCount: totalPages,
    expectedCount: jobs.length,
    warnings: [],
    scopeEvidence: await aggregateEvidence(identity, slices, jobs),
  }
}

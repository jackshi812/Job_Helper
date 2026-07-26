import {
  resolveBrandedIdentity,
  type EightfoldBrandedIdentity,
} from '../branded-identities.ts'
import {
  BoundedPoolDeadlineError,
  runBoundedPool,
} from '../bounded-pool.ts'
import {
  createBrandedScopeEvidence,
  matchesAllowedProviderCategory,
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

export interface EightfoldAdapterOptions {
  pageSize?: number
  maxPages?: number
  maxJobs?: number
  maxBytes?: number
  maxDetailRequests?: number
  detailConcurrency?: number
  totalDurationMs?: number
  now?: () => number
}

interface EightfoldPosition {
  id: string
  name: string
  locations: string[]
  businessArea: string
  createdAt: number | null
  canonicalPositionUrl: string
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
const MAX_TITLE_LENGTH = 512
const MAX_DESCRIPTION_LENGTH = 200_000
const textEncoder = new TextEncoder()

function boundedWarning(value: string): string {
  return value.slice(0, 64)
}

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
    warnings: [boundedWarning(warning)],
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

function requestSignal(
  remaining: number,
  parentSignal?: AbortSignal,
): AbortSignal {
  const timeout = AbortSignal.timeout(
    Math.max(1, Math.ceil(Math.min(REQUEST_TIMEOUT_MS, remaining))),
  )
  return parentSignal ? AbortSignal.any([parentSignal, timeout]) : timeout
}

async function requestJson(
  url: URL,
  fetchImpl: FetchLike,
  maxBytes: number,
  budget: InvocationBudget,
  parentSignal?: AbortSignal,
): Promise<unknown> {
  const remaining = requireRemainingDuration(budget)
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      signal: requestSignal(remaining, parentSignal),
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

function boundedString(
  value: unknown,
  maxLength: number,
): string | null {
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
  return id && /^[A-Za-z0-9._:-]+$/.test(id) ? id : null
}

function exactProviderUrl(
  value: unknown,
  identity: EightfoldBrandedIdentity,
  expectedPathPrefix: string,
): string | null {
  if (typeof value !== 'string' || value.length > 2_048) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && !url.port
      && url.origin === identity.origin
      && url.pathname.startsWith(expectedPathPrefix)
      ? url.toString()
      : null
  } catch {
    return null
  }
}

function parsePosition(
  value: unknown,
  identity: EightfoldBrandedIdentity,
): EightfoldPosition | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const id = stableId(raw.id)
  const name = boundedString(raw.name, MAX_TITLE_LENGTH)
  const businessArea = boundedString(raw.business_area, 160)
  const locations = Array.isArray(raw.locations)
    ? raw.locations.map((location) => boundedString(location, 512))
    : []
  const canonicalPositionUrl = exactProviderUrl(
    raw.canonicalPositionUrl,
    identity,
    '/careers/job/',
  )
  if (
    !id
    || !name
    || !businessArea
    || !canonicalPositionUrl
    || locations.length === 0
    || locations.some((location) => location === null)
  ) return null

  const createdAt = raw.t_create === undefined || raw.t_create === null
    ? null
    : typeof raw.t_create === 'number'
      && Number.isFinite(raw.t_create)
      && raw.t_create >= 0
      ? raw.t_create
      : Number.NaN
  if (Number.isNaN(createdAt)) return null

  return {
    id,
    name,
    locations: locations as string[],
    businessArea,
    createdAt,
    canonicalPositionUrl,
  }
}

function validSearchEnvelope(
  payload: unknown,
  identity: EightfoldBrandedIdentity,
): payload is {
  count: number
  positions: unknown[]
  query: { domain: string; location: string }
} {
  if (!payload || typeof payload !== 'object') return false
  const raw = payload as Record<string, unknown>
  if (
    !Number.isInteger(raw.count)
    || (raw.count as number) < 0
    || !Array.isArray(raw.positions)
    || !raw.query
    || typeof raw.query !== 'object'
  ) return false
  const query = raw.query as Record<string, unknown>
  return query.domain === identity.domain
    && query.location === identity.countryValue
}

function htmlToText(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function detailCountryCode(
  locations: unknown,
): 'US' | null {
  if (!Array.isArray(locations)) return null
  for (const location of locations) {
    if (
      location
      && typeof location === 'object'
      && (location as Record<string, unknown>).country_code === 'US'
    ) return 'US'
  }
  return null
}

async function normalizeDetail(
  payload: unknown,
  listed: EightfoldPosition,
  identity: EightfoldBrandedIdentity,
): Promise<NormalizedJob> {
  if (!payload || typeof payload !== 'object') {
    throw new ProviderError('provider_schema_invalid')
  }
  const raw = payload as Record<string, unknown>
  const id = stableId(raw.id)
  if (id !== listed.id) throw new ProviderError('detail_id_mismatch')
  const descriptionHtml = boundedString(
    raw.job_description,
    MAX_DESCRIPTION_LENGTH,
  )
  const applyUrl = exactProviderUrl(raw.apply_url, identity, '/careers/')
  if (!descriptionHtml || !applyUrl) {
    throw new ProviderError('detail_evidence_missing')
  }
  const countryCode = detailCountryCode(raw.locations)
  if (!countryCode) throw new ProviderError('detail_country_ineligible')

  const scopeEvidence = await createBrandedScopeEvidence({
    sourceKey: identity.sourceKey,
    externalId: listed.id,
    providerCategoryLabel: listed.businessArea,
    detailCountryCode: countryCode,
  })

  return {
    source: 'eightfold',
    externalId: listed.id,
    title: listed.name,
    location: listed.locations.join('; '),
    absoluteUrl: listed.canonicalPositionUrl,
    postedAt: listed.createdAt === null
      ? null
      : new Date(listed.createdAt * 1_000).toISOString(),
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

async function observationEvidence(
  identity: EightfoldBrandedIdentity,
  rawExpected: number,
  rawFetched: number,
  pageCount: number,
  jobs: NormalizedJob[],
): Promise<BrandedObservationScopeEvidence> {
  const labels = jobs.map((job) => job.scopeEvidence?.providerCategoryLabel)
  return Object.freeze({
    sourceKey: identity.sourceKey,
    sliceDigests: Object.freeze([
      await sha256Hex([
        identity.sourceKey,
        identity.countryFacet.id,
        identity.countryFacet.expectedLabel,
        rawExpected,
        rawFetched,
        pageCount,
      ]),
    ]),
    categoryDigest: await sha256Hex(labels),
    countryDigest: await sha256Hex(
      jobs.map((job) => job.scopeEvidence?.detailCountryCode),
    ),
  })
}

function errorCode(reason: unknown): string {
  return reason instanceof ProviderError ? reason.code : 'provider_error'
}

export async function pollMorganStanleyEightfold(
  identity: EightfoldBrandedIdentity,
  fetchImpl: FetchLike = fetch,
  options: EightfoldAdapterOptions = {},
): Promise<PollObservation> {
  if (
    !identity
    || identity.provider !== 'eightfold'
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
  const startedAt = now()
  if (!Number.isFinite(startedAt)) return incomplete([], 'invalid_clock')
  const budget: InvocationBudget = {
    deadline: startedAt + totalDurationMs,
    now,
  }

  const positions: EightfoldPosition[] = []
  const seenIds = new Set<string>()
  let expectedCount: number | undefined
  let pageCount = 0

  while (positions.length < (expectedCount ?? Number.POSITIVE_INFINITY)) {
    if (pageCount >= maxPages) {
      return incomplete([], 'page_cap_exceeded', expectedCount, pageCount)
    }
    const url = new URL(identity.searchPath, identity.origin)
    url.searchParams.set('domain', identity.domain)
    url.searchParams.set('location', identity.countryValue)
    url.searchParams.set('start', String(positions.length))
    url.searchParams.set('num', String(pageSize))

    let payload: unknown
    try {
      payload = await requestJson(url, fetchImpl, maxBytes, budget)
    } catch (error) {
      return incomplete([], errorCode(error), expectedCount, pageCount)
    }
    if (!validSearchEnvelope(payload, identity)) {
      return incomplete([], 'provider_schema_invalid', expectedCount, pageCount)
    }
    if (expectedCount === undefined) expectedCount = payload.count
    if (payload.count !== expectedCount) {
      return incomplete([], 'count_mismatch', expectedCount, pageCount + 1)
    }
    if (expectedCount > maxJobs) {
      return incomplete([], 'job_cap_exceeded', expectedCount, pageCount + 1)
    }
    if (payload.positions.length > pageSize) {
      return incomplete([], 'provider_schema_invalid', expectedCount, pageCount + 1)
    }

    const parsed = payload.positions.map((position) =>
      parsePosition(position, identity)
    )
    if (parsed.some((position) => position === null)) {
      const hasMissingCategory = payload.positions.some((position) =>
        position
        && typeof position === 'object'
        && !boundedString(
          (position as Record<string, unknown>).business_area,
          160,
        )
      )
      return incomplete(
        [],
        hasMissingCategory
          ? 'category_evidence_missing'
          : 'provider_schema_invalid',
        expectedCount,
        pageCount + 1,
      )
    }

    for (const position of parsed as EightfoldPosition[]) {
      if (seenIds.has(position.id)) {
        return incomplete([], 'duplicate_id', expectedCount, pageCount + 1)
      }
      seenIds.add(position.id)
      positions.push(position)
    }
    pageCount += 1
    if (positions.length > expectedCount) {
      return incomplete([], 'count_mismatch', expectedCount, pageCount)
    }
    if (
      positions.length < expectedCount
      && payload.positions.length === 0
    ) return incomplete([], 'count_mismatch', expectedCount, pageCount)
  }

  if (expectedCount === undefined || positions.length !== expectedCount) {
    return incomplete([], 'count_mismatch', expectedCount, pageCount)
  }

  const eligible = positions.filter((position) =>
    matchesAllowedProviderCategory(position.businessArea)
  )
  if (eligible.length === 0) {
    return incomplete([], 'zero_eligible_jobs', 0, pageCount)
  }
  const scheduled = eligible.slice(0, maxDetailRequests)
  const jobs: NormalizedJob[] = []
  if (remainingDuration(budget) <= 0) {
    return incomplete([], 'deadline_exceeded', eligible.length, pageCount)
  }

  let outcomes: PromiseSettledResult<NormalizedJob>[]
  try {
    outcomes = await runBoundedPool(
      scheduled,
      async (position, _index, signal) => {
        const url = new URL(identity.detailPath, identity.origin)
        url.searchParams.set('domain', identity.domain)
        url.searchParams.set('pid', position.id)
        const payload = await requestJson(
          url,
          fetchImpl,
          maxBytes,
          budget,
          signal,
        )
        return normalizeDetail(payload, position, identity)
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
      return incomplete(jobs, 'deadline_exceeded', eligible.length, pageCount)
    }
    return incomplete(jobs, errorCode(error), eligible.length, pageCount)
  }

  for (const outcome of outcomes) {
    if (outcome.status === 'fulfilled') jobs.push(outcome.value)
  }
  const failed = outcomes.find((outcome) => outcome.status === 'rejected')
  if (failed?.status === 'rejected') {
    return incomplete(jobs, errorCode(failed.reason), eligible.length, pageCount)
  }
  if (scheduled.length !== eligible.length) {
    return incomplete(jobs, 'detail_cap_exceeded', eligible.length, pageCount)
  }

  const scopeEvidence = await observationEvidence(
    identity,
    expectedCount,
    positions.length,
    pageCount,
    jobs,
  )
  return {
    jobs,
    completeness: 'complete',
    credibleForClosure: true,
    allowMissingClosure: true,
    pageCount,
    expectedCount: jobs.length,
    warnings: [],
    scopeEvidence,
  }
}

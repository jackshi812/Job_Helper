import {
  resolveBrandedIdentity,
  type GoldmanHigherBrandedIdentity,
} from '../branded-identities.ts'
import {
  BoundedPoolDeadlineError,
  runBoundedPool,
} from '../bounded-pool.ts'
import {
  createBrandedScopeEvidence,
  findAllowedBrandedCategoryTerm,
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

export interface GoldmanHigherAdapterOptions {
  pageSize?: number
  maxPages?: number
  maxJobs?: number
  maxBytes?: number
  maxDetailRequests?: number
  detailConcurrency?: number
  totalDurationMs?: number
  now?: () => number
}

interface HigherLocation {
  primary: boolean
  state: string | null
  country: string
  city: string | null
}

interface HigherRole {
  roleId: string
  sourceId: string
  title: string
  categoryLabel: string
  categoryTerm: string
  locations: HigherLocation[]
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
const HIGHER_PUBLIC_ORIGIN = 'https://higher.gs.com'
const GOLDMAN_APPLY_HOST = 'hdpc.fa.us2.oraclecloud.com'
const textEncoder = new TextEncoder()

const GET_ROLES_QUERY = `query GetRoles($searchQueryInput: RoleSearchQueryInput!) {
  roleSearch(searchQueryInput: $searchQueryInput) {
    totalCount
    items {
      roleId
      corporateTitle
      jobTitle
      jobFunction
      locations {
        primary
        state
        country
        city
      }
      status
      division
      skills
      jobType {
        code
        description
      }
      externalSource {
        sourceId
      }
    }
  }
}`

const GET_ROLE_BY_ID_QUERY = `query GetRoleById(
  $externalSourceId: String!
  $externalSourceFetch: Boolean
) {
  role(
    externalSourceId: $externalSourceId
    externalSourceFetch: $externalSourceFetch
  ) {
    roleId
    corporateTitle
    jobTitle
    jobFunction
    locations {
      primary
      state
      country
      city
    }
    division
    descriptionHtml
    jobType {
      code
      description
    }
    skillset
    compensation {
      minSalary
      maxSalary
      currency
    }
    applyActive
    status
    externalSource {
      externalApplicationUrl
      applyInExternalSource
      sourceId
      secondarySourceId
    }
  }
}`

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

async function requestGraphql(
  identity: GoldmanHigherBrandedIdentity,
  operationName: string,
  query: string,
  variables: Record<string, unknown>,
  fetchImpl: FetchLike,
  maxBytes: number,
  budget: InvocationBudget,
  parentSignal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const remaining = requireRemainingDuration(budget)
  const timeout = AbortSignal.timeout(
    Math.max(1, Math.ceil(Math.min(REQUEST_TIMEOUT_MS, remaining))),
  )
  let response: Response
  try {
    response = await fetchImpl(
      new URL(identity.graphqlPath, identity.origin),
      {
        method: 'POST',
        redirect: 'error',
        signal: parentSignal
          ? AbortSignal.any([parentSignal, timeout])
          : timeout,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ operationName, variables, query }),
      },
    )
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
  let payload: unknown
  try {
    payload = JSON.parse(text) as unknown
  } catch {
    throw new ProviderError('malformed_response')
  }
  if (!payload || typeof payload !== 'object') {
    throw new ProviderError('provider_schema_invalid')
  }
  const envelope = payload as Record<string, unknown>
  if (
    'errors' in envelope
    && (!Array.isArray(envelope.errors) || envelope.errors.length > 0)
  ) throw new ProviderError('graphql_error')
  return envelope
}

function boundedString(
  value: unknown,
  maxLength: number,
  allowEmpty = false,
): string | null {
  if (
    typeof value !== 'string'
    || value.length > maxLength
    || /[\p{Cc}\p{Cf}]/u.test(value)
  ) return null
  const normalized = value.trim()
  return normalized || allowEmpty ? normalized : null
}

function stableRoleId(value: unknown): string | null {
  const id = boundedString(value, 256)
  return id && /^[A-Za-z0-9_-]+$/.test(id) ? id : null
}

function stableSourceId(value: unknown): string | null {
  const id = boundedString(value, 256)
  return id && /^[A-Za-z0-9_-]+$/.test(id) ? id : null
}

function parseLocations(value: unknown): HigherLocation[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    return null
  }
  const parsed: HigherLocation[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null
    const raw = entry as Record<string, unknown>
    const country = boundedString(raw.country, 128)
    const state = raw.state === null || raw.state === undefined
      ? null
      : boundedString(raw.state, 128)
    const city = raw.city === null || raw.city === undefined
      ? null
      : boundedString(raw.city, 128)
    if (
      !country
      || (raw.state !== null && raw.state !== undefined && state === null)
      || (raw.city !== null && raw.city !== undefined && city === null)
      || typeof raw.primary !== 'boolean'
    ) return null
    parsed.push({ primary: raw.primary, state, country, city })
  }
  return parsed
}

function trustedCategory(
  raw: Record<string, unknown>,
): {
  label: string | null
  term: string | null
  missing: boolean
} {
  const labels: string[] = []
  for (const field of ['jobFunction', 'division'] as const) {
    const value = boundedString(raw[field], 160, true)
    if (value === null) return { label: null, term: null, missing: true }
    if (value) labels.push(value)
  }
  if (labels.length === 0) return { label: null, term: null, missing: true }
  for (const label of labels) {
    const term = findAllowedBrandedCategoryTerm(label)
    if (term) return { label, term, missing: false }
  }
  return { label: null, term: null, missing: false }
}

function parseListRole(
  value: unknown,
): {
  role: HigherRole | null
  categoryMissing: boolean
  eligible: boolean
} {
  if (!value || typeof value !== 'object') {
    throw new ProviderError('provider_schema_invalid')
  }
  const raw = value as Record<string, unknown>
  const roleId = stableRoleId(raw.roleId)
  const title = boundedString(raw.jobTitle, 512)
  const status = boundedString(raw.status, 64)
  const locations = parseLocations(raw.locations)
  if (
    !roleId
    || !title
    || status !== 'POSTED'
    || !locations
    || !raw.externalSource
    || typeof raw.externalSource !== 'object'
  ) throw new ProviderError('provider_schema_invalid')
  const sourceId = stableSourceId(
    (raw.externalSource as Record<string, unknown>).sourceId,
  )
  if (!sourceId) throw new ProviderError('provider_schema_invalid')

  const hasUsLocation = locations.some((location) =>
    location.country === 'United States'
  )
  if (!hasUsLocation) {
    return { role: null, categoryMissing: false, eligible: false }
  }
  const category = trustedCategory(raw)
  if (category.missing) {
    return { role: null, categoryMissing: true, eligible: false }
  }
  if (!category.label || !category.term) {
    return { role: null, categoryMissing: false, eligible: false }
  }
  return {
    role: {
      roleId,
      sourceId,
      title,
      categoryLabel: category.label,
      categoryTerm: category.term,
      locations,
    },
    categoryMissing: false,
    eligible: true,
  }
}

function parseListEnvelope(
  envelope: Record<string, unknown>,
  priorExpected?: number,
): {
  expected: number
  items: unknown[]
} {
  if (!envelope.data || typeof envelope.data !== 'object') {
    throw new ProviderError('provider_schema_invalid')
  }
  const roleSearch = (envelope.data as Record<string, unknown>).roleSearch
  if (!roleSearch || typeof roleSearch !== 'object') {
    throw new ProviderError('provider_schema_invalid')
  }
  const raw = roleSearch as Record<string, unknown>
  if (
    !Number.isInteger(raw.totalCount)
    || (raw.totalCount as number) < 0
    || !Array.isArray(raw.items)
  ) throw new ProviderError('provider_schema_invalid')
  const expected = raw.totalCount as number
  if (priorExpected !== undefined && expected !== priorExpected) {
    throw new ProviderError('count_mismatch')
  }
  return { expected, items: raw.items }
}

function formattedLocation(locations: readonly HigherLocation[]): string {
  const location = locations.find((candidate) =>
    candidate.primary && candidate.country === 'United States'
  ) ?? locations.find((candidate) => candidate.country === 'United States')
  if (!location) return ''
  return [location.city, location.state, location.country]
    .filter((part): part is string => Boolean(part))
    .join(', ')
}

function safeApplyUrl(value: unknown, sourceId: string): string | null {
  if (typeof value !== 'string' || value.length > 2_048) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && url.hostname === GOLDMAN_APPLY_HOST
      && !url.username
      && !url.password
      && !url.port
      && !url.hash
      && url.pathname.startsWith(
        '/hcmUI/CandidateExperience/en/sites/',
      )
      && url.pathname.includes(`/job/${encodeURIComponent(sourceId)}/apply/`)
      ? url.toString()
      : null
  } catch {
    return null
  }
}

function htmlToText(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

async function normalizeDetail(
  envelope: Record<string, unknown>,
  listed: HigherRole,
  identity: GoldmanHigherBrandedIdentity,
): Promise<NormalizedJob> {
  if (!envelope.data || typeof envelope.data !== 'object') {
    throw new ProviderError('provider_schema_invalid')
  }
  const role = (envelope.data as Record<string, unknown>).role
  if (!role || typeof role !== 'object') {
    throw new ProviderError('provider_schema_invalid')
  }
  const raw = role as Record<string, unknown>
  if (stableRoleId(raw.roleId) !== listed.roleId) {
    throw new ProviderError('detail_id_mismatch')
  }
  const title = boundedString(raw.jobTitle, 512)
  const descriptionHtml = boundedString(
    raw.descriptionHtml,
    MAX_DESCRIPTION_LENGTH,
  )
  const locations = parseLocations(raw.locations)
  if (!locations?.some((location) => location.country === 'United States')) {
    throw new ProviderError('detail_country_ineligible')
  }
  const detailCategory = trustedCategory(raw)
  if (
    detailCategory.missing
    || !detailCategory.label
    || detailCategory.term !== listed.categoryTerm
  ) throw new ProviderError('detail_category_ineligible')
  if (
    !title
    || !descriptionHtml
    || raw.applyActive !== true
    || raw.status !== 'POSTED'
    || !raw.externalSource
    || typeof raw.externalSource !== 'object'
  ) throw new ProviderError('detail_evidence_missing')
  const externalSource = raw.externalSource as Record<string, unknown>
  if (stableSourceId(externalSource.sourceId) !== listed.sourceId) {
    throw new ProviderError('detail_id_mismatch')
  }
  if (
    externalSource.applyInExternalSource !== true
    || !safeApplyUrl(
      externalSource.externalApplicationUrl,
      listed.sourceId,
    )
  ) throw new ProviderError('detail_evidence_missing')

  const scopeEvidence = await createBrandedScopeEvidence({
    sourceKey: identity.sourceKey,
    externalId: listed.roleId,
    providerCategoryLabel: listed.categoryLabel,
    detailCountryCode: 'US',
  })
  return {
    source: 'goldman_higher',
    externalId: listed.roleId,
    title,
    location: formattedLocation(locations),
    absoluteUrl:
      `${HIGHER_PUBLIC_ORIGIN}/roles/${encodeURIComponent(listed.roleId)}`,
    postedAt: null,
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
  identity: GoldmanHigherBrandedIdentity,
  rawExpected: number,
  pageCount: number,
  jobs: readonly NormalizedJob[],
): Promise<BrandedObservationScopeEvidence> {
  return Object.freeze({
    sourceKey: identity.sourceKey,
    sliceDigests: Object.freeze([
      await sha256Hex([
        identity.sourceKey,
        identity.listOperation,
        rawExpected,
        pageCount,
      ]),
    ]),
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

export async function pollGoldmanHigher(
  identity: GoldmanHigherBrandedIdentity,
  fetchImpl: FetchLike = fetch,
  options: GoldmanHigherAdapterOptions = {},
): Promise<PollObservation> {
  if (
    !identity
    || identity.provider !== 'goldman_higher'
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

  const eligible: HigherRole[] = []
  const seenRoleIds = new Set<string>()
  const seenSourceIds = new Set<string>()
  let rawFetched = 0
  let expectedCount: number | undefined
  let pageCount = 0
  let categoryEvidenceMissing = false

  while (rawFetched < (expectedCount ?? Number.POSITIVE_INFINITY)) {
    if (pageCount >= maxPages) {
      return incomplete([], 'page_cap_exceeded', eligible.length, pageCount)
    }
    let page: { expected: number; items: unknown[] }
    try {
      const envelope = await requestGraphql(
        identity,
        identity.listOperation,
        GET_ROLES_QUERY,
        {
          searchQueryInput: {
            page: { pageSize, pageNumber: pageCount },
            filters: [],
            experiences: ['EARLY_CAREER', 'PROFESSIONAL'],
            searchTerm: '',
          },
        },
        fetchImpl,
        maxBytes,
        budget,
      )
      page = parseListEnvelope(envelope, expectedCount)
    } catch (error) {
      return incomplete([], errorCode(error), eligible.length, pageCount)
    }
    if (expectedCount === undefined) expectedCount = page.expected
    if (expectedCount > maxJobs) {
      return incomplete([], 'job_cap_exceeded', eligible.length, pageCount + 1)
    }
    if (page.items.length > pageSize) {
      return incomplete([], 'provider_schema_invalid', eligible.length, pageCount + 1)
    }

    for (const item of page.items) {
      let parsed: ReturnType<typeof parseListRole>
      try {
        parsed = parseListRole(item)
      } catch (error) {
        return incomplete([], errorCode(error), eligible.length, pageCount + 1)
      }
      const raw = item as Record<string, unknown>
      const roleId = stableRoleId(raw.roleId)
      const externalSource = raw.externalSource as Record<string, unknown>
      const sourceId = stableSourceId(externalSource.sourceId)
      if (!roleId || !sourceId) {
        return incomplete([], 'provider_schema_invalid', eligible.length, pageCount + 1)
      }
      if (seenRoleIds.has(roleId)) {
        return incomplete([], 'duplicate_id', eligible.length, pageCount + 1)
      }
      if (seenSourceIds.has(sourceId)) {
        return incomplete([], 'duplicate_source_id', eligible.length, pageCount + 1)
      }
      seenRoleIds.add(roleId)
      seenSourceIds.add(sourceId)
      categoryEvidenceMissing ||= parsed.categoryMissing
      if (parsed.eligible && parsed.role) eligible.push(parsed.role)
    }
    rawFetched += page.items.length
    pageCount += 1
    if (rawFetched > expectedCount) {
      return incomplete([], 'count_mismatch', eligible.length, pageCount)
    }
    if (rawFetched < expectedCount && page.items.length === 0) {
      return incomplete([], 'count_mismatch', eligible.length, pageCount)
    }
  }

  if (expectedCount === undefined || rawFetched !== expectedCount) {
    return incomplete([], 'count_mismatch', eligible.length, pageCount)
  }
  if (categoryEvidenceMissing) {
    return incomplete([], 'category_evidence_missing', 0, pageCount)
  }
  if (eligible.length === 0) {
    return incomplete([], 'zero_eligible_jobs', 0, pageCount)
  }
  if (remainingDuration(budget) <= 0) {
    return incomplete([], 'deadline_exceeded', eligible.length, pageCount)
  }

  const scheduled = eligible.slice(0, maxDetailRequests)
  const jobs: NormalizedJob[] = []
  let outcomes: PromiseSettledResult<NormalizedJob>[]
  try {
    outcomes = await runBoundedPool(
      scheduled,
      async (listed, _index, signal) => {
        const envelope = await requestGraphql(
          identity,
          identity.detailOperation,
          GET_ROLE_BY_ID_QUERY,
          {
            externalSourceId: listed.sourceId,
            externalSourceFetch: true,
          },
          fetchImpl,
          maxBytes,
          budget,
          signal,
        )
        return normalizeDetail(envelope, listed, identity)
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

  return {
    jobs,
    completeness: 'complete',
    credibleForClosure: true,
    allowMissingClosure: true,
    pageCount,
    expectedCount: jobs.length,
    warnings: [],
    scopeEvidence: await aggregateEvidence(
      identity,
      expectedCount,
      pageCount,
      jobs,
    ),
  }
}

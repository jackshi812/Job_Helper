import {
  resolveBrandedIdentity,
  type GoldmanHigherBrandedIdentity,
} from '../branded-identities.ts'
import {
  BoundedPoolDeadlineError,
  runBoundedPool,
} from '../bounded-pool.ts'
import {
  createGoldmanHigherScopeEvidence,
  findAllowedBrandedCategoryTerm,
} from './scope.ts'
import type {
  GoldmanHigherNormalizedJob,
  GoldmanHigherObservationScopeEvidence,
  GoldmanHigherRecruitingType,
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
  wallClockNow?: () => number
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
  categoryField: 'jobFunction' | 'division'
  categoryLabel: string
  categoryTerm:
    | 'Data'
    | 'Technology'
    | 'Finance'
    | 'Investment'
    | 'Research'
    | 'Risk'
    | 'Capital Markets'
  locations: HigherLocation[]
  selectedLocation: HigherLocation
  postedAt: string
}

type GoldmanExperience = 'EARLY_CAREER' | 'PROFESSIONAL'

interface SliceEvidence {
  readonly experience: GoldmanExperience
  readonly expected: number
  readonly fetched: number
  readonly pages: number
  readonly pageSize: number
}

interface InvocationBudget {
  readonly deadline: number
  readonly now: () => number
}

class ProviderError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.code = code
  }
}

const REQUEST_TIMEOUT_MS = 15_000
const MAX_DESCRIPTION_LENGTH = 200_000
const textEncoder = new TextEncoder()
const RECENT_HOURS = 168
const GOLDMAN_EXPERIENCES = Object.freeze([
  'EARLY_CAREER',
  'PROFESSIONAL',
] as const)

const GET_ROLES_QUERY = `query GetRoles($searchQueryInput: RoleSearchQueryInput!) {
  roleSearch(searchQueryInput: $searchQueryInput) {
    page {
      pageSize
      pageNumber
      hasNext
    }
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
      externalJobStatus
      startDate
      division
      skills
      jobType {
        code
        description
      }
      externalSource {
        sourceId
        externalSourceType
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
    startDate
    recruitingType
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
    externalJobStatus
    externalSource {
      externalApplicationUrl
      applyInExternalSource
      sourceId
      secondarySourceId
      externalSourceType
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
  return id && /^[0-9]+$/.test(id) ? id : null
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

function normalizedLabel(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US')
    .replace(/\s+/gu, ' ').trim()
}

function trustedCategory(raw: Record<string, unknown>): {
  field: 'jobFunction' | 'division' | null
  label: string | null
  term: HigherRole['categoryTerm'] | null
  missing: boolean
} {
  for (const field of ['jobFunction', 'division'] as const) {
    const value = boundedString(raw[field], 160, true)
    if (value === null) {
      return { field: null, label: null, term: null, missing: true }
    }
    if (!value) continue
    const term = findAllowedBrandedCategoryTerm(value)
    if (term) {
      return {
        field,
        label: normalizedLabel(value),
        term,
        missing: false,
      }
    }
  }
  const missing = ['jobFunction', 'division'].every((field) =>
    boundedString(raw[field], 160, true) === ''
  )
  return { field: null, label: null, term: null, missing }
}

function canonicalPostedAt(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function isRecentPosting(postedAt: string, wallClockNow: number): boolean {
  const parsed = Date.parse(postedAt)
  return Number.isFinite(parsed)
    && parsed >= wallClockNow - RECENT_HOURS * 60 * 60 * 1_000
    && parsed <= wallClockNow
}

function selectedUsLocation(
  locations: readonly HigherLocation[],
): HigherLocation | null {
  return locations.find((location) =>
    location.primary && location.country === 'United States'
  ) ?? locations.find((location) => location.country === 'United States') ?? null
}

function parseListRole(
  value: unknown,
  wallClockNow: number,
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
  const externalJobStatus = boundedString(raw.externalJobStatus, 64)
  const locations = parseLocations(raw.locations)
  if (
    !roleId
    || !title
    || status !== 'POSTED'
    || externalJobStatus !== 'POSTED'
    || !locations
    || !raw.externalSource
    || typeof raw.externalSource !== 'object'
  ) throw new ProviderError('provider_schema_invalid')
  const sourceId = stableSourceId(
    (raw.externalSource as Record<string, unknown>).sourceId,
  )
  const externalSourceType = boundedString(
    (raw.externalSource as Record<string, unknown>).externalSourceType,
    64,
  )
  if (!sourceId || externalSourceType !== 'ORACLE') {
    throw new ProviderError('provider_schema_invalid')
  }
  const postedAt = canonicalPostedAt(raw.startDate)
  if (!postedAt || !isRecentPosting(postedAt, wallClockNow)) {
    throw new ProviderError('posting_date_ineligible')
  }

  const selectedLocation = selectedUsLocation(locations)
  if (!selectedLocation) {
    return { role: null, categoryMissing: false, eligible: false }
  }
  const category = trustedCategory(raw)
  if (category.missing) {
    return { role: null, categoryMissing: true, eligible: false }
  }
  if (!category.field || !category.label || !category.term) {
    return { role: null, categoryMissing: false, eligible: false }
  }
  return {
    role: {
      roleId,
      sourceId,
      title,
      categoryField: category.field,
      categoryLabel: category.label,
      categoryTerm: category.term,
      locations,
      selectedLocation,
      postedAt,
    },
    categoryMissing: false,
    eligible: true,
  }
}

function parseListEnvelope(
  envelope: Record<string, unknown>,
  requestedPageNumber: number,
  requestedPageSize: number,
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
  if (!raw.page || typeof raw.page !== 'object') {
    throw new ProviderError('provider_schema_invalid')
  }
  const page = raw.page as Record<string, unknown>
  if (page.pageNumber !== requestedPageNumber) {
    throw new ProviderError('page_number_mismatch')
  }
  if (page.pageSize !== requestedPageSize) {
    throw new ProviderError('page_size_mismatch')
  }
  const fetchedThrough = requestedPageNumber * requestedPageSize
    + raw.items.length
  if (
    typeof page.hasNext !== 'boolean'
    || page.hasNext !== (fetchedThrough < expected)
  ) {
    throw new ProviderError('page_metadata_mismatch')
  }
  return { expected, items: raw.items }
}

function formattedLocation(locations: readonly HigherLocation[]): string {
  const location = selectedUsLocation(locations)
  if (!location) return ''
  return [location.city, location.state, location.country]
    .filter((part): part is string => Boolean(part))
    .join(', ')
}

function safeGoldmanApplyUrl(
  value: unknown,
  sourceId: string,
  identity: GoldmanHigherBrandedIdentity,
): string | null {
  if (typeof value !== 'string' || value.length > 2_048) return null
  try {
    const url = new URL(value)
    const expectedPath =
      `${identity.applyPathPrefix}${sourceId}${identity.applyPathSuffix}`
    return url.protocol === 'https:'
      && url.hostname === identity.applyHost
      && !url.username
      && !url.password
      && !url.port
      && !url.search
      && !url.hash
      && url.pathname === expectedPath
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
  wallClockNow: number,
): Promise<GoldmanHigherNormalizedJob> {
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
  const detailLocation = locations && selectedUsLocation(locations)
  if (!detailLocation) {
    throw new ProviderError('detail_country_ineligible')
  }
  const detailCategory = trustedCategory(raw)
  if (
    detailCategory.missing
    || detailCategory.field !== listed.categoryField
    || !detailCategory.label
    || detailCategory.label !== listed.categoryLabel
    || detailCategory.term !== listed.categoryTerm
  ) throw new ProviderError('detail_category_ineligible')
  const detailPostedAt = canonicalPostedAt(raw.startDate)
  if (
    !detailPostedAt
    || !isRecentPosting(detailPostedAt, wallClockNow)
    || detailPostedAt !== listed.postedAt
  ) throw new ProviderError('detail_posting_date_mismatch')
  const recruitingType = boundedString(raw.recruitingType, 64)
  if (
    recruitingType !== 'GS_EARLY_CAREER'
    && recruitingType !== 'GS_MID_CAREER'
  ) throw new ProviderError('detail_population_ineligible')
  if (
    !title
    || !descriptionHtml
    || title !== listed.title
    || JSON.stringify(detailLocation) !== JSON.stringify(listed.selectedLocation)
    || raw.applyActive !== true
    || raw.status !== 'POSTED'
    || raw.externalJobStatus !== 'POSTED'
    || !raw.externalSource
    || typeof raw.externalSource !== 'object'
  ) throw new ProviderError('detail_evidence_missing')
  const externalSource = raw.externalSource as Record<string, unknown>
  if (stableSourceId(externalSource.sourceId) !== listed.sourceId) {
    throw new ProviderError('detail_id_mismatch')
  }
  const absoluteUrl = safeGoldmanApplyUrl(
    externalSource.externalApplicationUrl,
    listed.sourceId,
    identity,
  )
  if (
    externalSource.applyInExternalSource !== true
    || externalSource.externalSourceType !== 'ORACLE'
    || !absoluteUrl
  ) throw new ProviderError('detail_evidence_missing')

  const scopeEvidence = await createGoldmanHigherScopeEvidence({
    sourceKey: identity.sourceKey,
    externalId: listed.roleId,
    selectionMode: 'recent_exact_us_provider_category',
    recentHours: RECENT_HOURS,
    providerSourceId: listed.sourceId,
    providerCategoryField: listed.categoryField,
    providerCategoryLabel: listed.categoryLabel,
    detailCountryCode: 'US',
    postedAt: detailPostedAt,
    recruitingType: recruitingType as GoldmanHigherRecruitingType,
  })
  return {
    source: 'goldman_higher',
    externalId: listed.roleId,
    title,
    location: formattedLocation(locations),
    absoluteUrl,
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
  identity: GoldmanHigherBrandedIdentity,
  slices: readonly SliceEvidence[],
  jobs: readonly GoldmanHigherNormalizedJob[],
): Promise<GoldmanHigherObservationScopeEvidence> {
  const sortedJobs = [...jobs].sort((left, right) =>
    left.externalId.localeCompare(right.externalId)
  )
  const sliceDigests = await Promise.all(slices.map((slice) =>
    sha256Hex([
      identity.sourceKey,
      slice.experience,
      slice.expected,
      slice.fetched,
      slice.pages,
      slice.pageSize,
    ])
  ))
  if (sliceDigests.length !== 2) throw new ProviderError('slice_evidence_invalid')
  return Object.freeze({
    sourceKey: identity.sourceKey,
    selectionMode: 'recent_exact_us_provider_category',
    recentHours: RECENT_HOURS,
    sliceDigests: Object.freeze(sliceDigests) as readonly [string, string],
    jobDigest: await sha256Hex(
      sortedJobs.map((job) => [job.externalId, job.scopeEvidence.externalIdDigest]),
    ),
    categoryDigest: await sha256Hex(
      sortedJobs.map((job) => [
        job.externalId,
        job.scopeEvidence.providerCategoryField,
        job.scopeEvidence.providerCategoryLabel,
        job.scopeEvidence.matchedTerm,
      ]),
    ),
    countryDigest: await sha256Hex(
      sortedJobs.map((job) => [
        job.externalId,
        job.scopeEvidence.detailCountryCode,
      ]),
    ),
    freshnessDigest: await sha256Hex(
      sortedJobs.map((job) => [
        job.externalId,
        job.scopeEvidence.postedAt,
        job.scopeEvidence.recentHours,
      ]),
    ),
    applicationDigest: await sha256Hex(
      sortedJobs.map((job) => [
        job.externalId,
        job.scopeEvidence.providerSourceId,
        job.absoluteUrl,
      ]),
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
  const wallClockNow = (options.wallClockNow ?? Date.now)()
  const startedAt = now()
  if (!Number.isFinite(startedAt) || !Number.isFinite(wallClockNow)) {
    return incomplete([], 'invalid_clock')
  }
  const budget: InvocationBudget = {
    deadline: startedAt + totalDurationMs,
    now,
  }

  const unionByRoleId = new Map<string, HigherRole>()
  const unionBySourceId = new Map<string, HigherRole>()
  const slices: SliceEvidence[] = []
  let pageCount = 0
  let rawRoleCount = 0
  let categoryEvidenceMissing = false

  for (const experience of GOLDMAN_EXPERIENCES) {
    const sliceRoles: HigherRole[] = []
    const sliceRoleIds = new Set<string>()
    const sliceSourceIds = new Set<string>()
    let expected: number | undefined
    let slicePages = 0
    let rawFetched = 0

    while (rawFetched < (expected ?? Number.POSITIVE_INFINITY)) {
      if (slicePages >= maxPages || pageCount >= maxPages) {
        return incomplete([], 'page_cap_exceeded', unionByRoleId.size, pageCount)
      }
      let page: { expected: number; items: unknown[] }
      try {
        const envelope = await requestGraphql(
          identity,
          identity.listOperation,
          GET_ROLES_QUERY,
          {
            searchQueryInput: {
              page: { pageSize, pageNumber: slicePages },
              filters: [],
              experiences: [experience],
              searchTerm: '',
            },
          },
          fetchImpl,
          maxBytes,
          budget,
        )
        page = parseListEnvelope(
          envelope,
          slicePages,
          pageSize,
          expected,
        )
      } catch (error) {
        return incomplete([], errorCode(error), unionByRoleId.size, pageCount)
      }
      if (expected === undefined) expected = page.expected
      if ((expected ?? 0) > maxJobs) {
        return incomplete([], 'job_cap_exceeded', unionByRoleId.size, pageCount + 1)
      }
      if (page.items.length > pageSize) {
        return incomplete(
          [],
          'provider_schema_invalid',
          unionByRoleId.size,
          pageCount + 1,
        )
      }

      for (const item of page.items) {
        let parsed: ReturnType<typeof parseListRole>
        try {
          parsed = parseListRole(item, wallClockNow)
        } catch (error) {
          return incomplete(
            [],
            errorCode(error),
            unionByRoleId.size,
            pageCount + 1,
          )
        }
        const raw = item as Record<string, unknown>
        const roleId = stableRoleId(raw.roleId)
        const externalSource = raw.externalSource as Record<string, unknown>
        const sourceId = stableSourceId(externalSource.sourceId)
        if (!roleId || !sourceId) {
          return incomplete(
            [],
            'provider_schema_invalid',
            unionByRoleId.size,
            pageCount + 1,
          )
        }
        if (sliceRoleIds.has(roleId)) {
          return incomplete([], 'duplicate_id', unionByRoleId.size, pageCount + 1)
        }
        if (sliceSourceIds.has(sourceId)) {
          return incomplete(
            [],
            'duplicate_source_id',
            unionByRoleId.size,
            pageCount + 1,
          )
        }
        sliceRoleIds.add(roleId)
        sliceSourceIds.add(sourceId)
        categoryEvidenceMissing ||= parsed.categoryMissing
        if (parsed.eligible && parsed.role) sliceRoles.push(parsed.role)
      }
      rawFetched += page.items.length
      slicePages += 1
      pageCount += 1
      if (rawFetched > (expected ?? 0)) {
        return incomplete([], 'count_mismatch', unionByRoleId.size, pageCount)
      }
      if (rawFetched < (expected ?? 0) && page.items.length === 0) {
        return incomplete([], 'count_mismatch', unionByRoleId.size, pageCount)
      }
    }

    if (expected === undefined || rawFetched !== expected) {
      return incomplete([], 'count_mismatch', unionByRoleId.size, pageCount)
    }
    slices.push({
      experience,
      expected,
      fetched: rawFetched,
      pages: slicePages,
      pageSize,
    })
    rawRoleCount += rawFetched
    if (rawRoleCount > maxJobs) {
      return incomplete([], 'job_cap_exceeded', unionByRoleId.size, pageCount)
    }
    for (const role of sliceRoles) {
      const roleMatch = unionByRoleId.get(role.roleId)
      const sourceMatch = unionBySourceId.get(role.sourceId)
      if (
        (roleMatch && JSON.stringify(roleMatch) !== JSON.stringify(role))
        || (sourceMatch && sourceMatch.roleId !== role.roleId)
      ) {
        return incomplete([], 'cross_slice_id_drift', unionByRoleId.size, pageCount)
      }
      if (!roleMatch) unionByRoleId.set(role.roleId, role)
      if (!sourceMatch) unionBySourceId.set(role.sourceId, role)
      if (unionByRoleId.size > maxJobs) {
        return incomplete([], 'job_cap_exceeded', unionByRoleId.size, pageCount)
      }
    }
  }

  if (categoryEvidenceMissing) {
    return incomplete([], 'category_evidence_missing', 0, pageCount)
  }
  const eligible = [...unionByRoleId.values()]
  if (eligible.length === 0) {
    return incomplete([], 'zero_eligible_jobs', 0, pageCount)
  }
  if (remainingDuration(budget) <= 0) {
    return incomplete([], 'deadline_exceeded', eligible.length, pageCount)
  }

  const scheduled = eligible.slice(0, maxDetailRequests)
  const jobs: GoldmanHigherNormalizedJob[] = []
  let outcomes: PromiseSettledResult<GoldmanHigherNormalizedJob>[]
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
        return normalizeDetail(
          envelope,
          listed,
          identity,
          wallClockNow,
        )
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
          jobs.push(settled.outcome.value as GoldmanHigherNormalizedJob)
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
    allowMissingClosure: false,
    pageCount,
    expectedCount: jobs.length,
    warnings: [],
    scopeEvidence: await aggregateEvidence(identity, slices, jobs),
  }
}

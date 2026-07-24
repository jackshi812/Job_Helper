import { type NormalizedJob, type PollObservation } from './types.ts'
import {
  CAPITAL_ONE_WORKDAY_IDENTITY,
  CAPITAL_ONE_WORKDAY_SOURCE_KEY,
  type WorkdayIdentity,
} from '../workday-identities.ts'

export { CAPITAL_ONE_WORKDAY_SOURCE_KEY }
export { type WorkdayIdentity }

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

interface WorkdayOptions {
  pageSize?: number
  maxPages?: number
  maxJobs?: number
  maxDetails?: number
  maxBytes?: number
}

interface WorkdayRecentOptions {
  knownIds?: Set<string>
  recentDays?: number
  maxPages?: number
  maxListings?: number
  maxDetails?: number
  maxBytes?: number
  nowMs?: number
}

interface WorkdayListPosting {
  title: string
  externalPath: string
  locationsText?: string | null
  postedOn?: string | null
  bulletFields?: unknown
}

interface WorkdayDetail {
  jobPostingInfo: {
    id: string
    title: string
    jobDescription: string
    location?: string | null
    postedOn?: string | null
    startDate?: string | null
    jobReqId?: string | null
    country?: { descriptor?: string | null } | null
    jobRequisitionLocation?: {
      country?: {
        descriptor?: string | null
        alpha2Code?: string | null
      } | null
    } | null
  }
}

const DEFAULT_PAGE_SIZE = 20
const DEFAULT_MAX_PAGES = 100
const DEFAULT_MAX_JOBS = 2_000
const DEFAULT_MAX_DETAILS = 2_000
const DEFAULT_MAX_BYTES = 2_000_000
const MAX_STRING = 500_000
const MAX_REQUISITION_IDENTIFIER = 256
const RECENT_PAGE_SIZE = 20
const DEFAULT_RECENT_DAYS = 7
const DEFAULT_RECENT_MAX_PAGES = 30
const DEFAULT_RECENT_MAX_LISTINGS = 600
const DEFAULT_RECENT_MAX_DETAILS = 60

class ProviderError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

function stringValue(value: unknown, maxLength = MAX_STRING) {
  return typeof value === 'string' && value.length <= maxLength ? value : null
}

function htmlToText(value: string) {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function htmlToSectionText(value: string) {
  return value
    .replace(/&#43;|&plus;/gi, '+')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, ' ')
    .replace(/<\/?(?:p|li|ul|ol|div|br|h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n+/g, '\n')
    .trim()
}

function requiredExperienceMinimums(descriptionHtml: string) {
  const text = htmlToSectionText(descriptionHtml)
  const requiredStart = /\b(?:basic|required|minimum) qualifications?\b/i.exec(text)
  if (!requiredStart) return []
  const afterStart = text.slice(requiredStart.index + requiredStart[0].length)
  const preferredStart = /\b(?:preferred qualifications?|nice to have|desired qualifications?)\b/i.exec(afterStart)
  const requiredSection = preferredStart
    ? afterStart.slice(0, preferredStart.index)
    : afterStart
  const minimums: number[] = []
  const years = /\b(\d{1,2})(?:\s*(?:-|–|to)\s*(\d{1,2}))?\s*(?:\+|plus)?\s+years?\b/gi
  for (const match of requiredSection.matchAll(years)) {
    minimums.push(Number(match[1]))
  }
  return minimums
}

export function isEntryLevelWorkdayDetail(detail: WorkdayDetail) {
  return requiredExperienceMinimums(detail.jobPostingInfo.jobDescription)
    .every((minimum) => minimum < 3)
}

function isUnitedStatesDetail(detail: WorkdayDetail) {
  const country = detail.jobPostingInfo.jobRequisitionLocation?.country
  if (country?.alpha2Code?.toUpperCase() === 'US') return true
  const descriptor = country?.descriptor ?? detail.jobPostingInfo.country?.descriptor
  return /^(?:united states|united states of america|usa)$/i.test(descriptor?.trim() ?? '')
}

function postedAgeDays(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return null
  if (normalized === 'posted today') return 0
  if (normalized === 'posted yesterday') return 1
  const match = normalized.match(/^posted (\d+) days? ago$/)
  return match ? Number(match[1]) : null
}

function recentStartDate(value: string | null | undefined, nowMs: number, recentDays: number) {
  if (!value) return false
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return false
  const now = new Date(nowMs)
  const cutoff = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - recentDays,
  )
  return parsed >= cutoff && parsed <= nowMs
}

function legacyListExternalId(externalPath: string) {
  return externalPath.match(/_(R[0-9A-Za-z]+)(?:-\d+)?$/)?.[1] ?? null
}

function safeRequisitionIdentifier(value: unknown) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_REQUISITION_IDENTIFIER
    || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
  ) return null
  return value
}

function singleBulletIdentifier(value: unknown) {
  if (!Array.isArray(value) || value.length !== 1) return null
  return safeRequisitionIdentifier(value[0])
}

function listExternalId(posting: WorkdayListPosting) {
  const legacy = legacyListExternalId(posting.externalPath)
  if (legacy) return legacy

  const identifier = singleBulletIdentifier(posting.bulletFields)
  if (!identifier) throw new ProviderError('provider_identity_drift')
  if (posting.externalPath.endsWith(`_${identifier}`)) return identifier

  const marker = `_${identifier}-`
  const markerIndex = posting.externalPath.lastIndexOf(marker)
  const numericSuffix = markerIndex < 0
    ? ''
    : posting.externalPath.slice(markerIndex + marker.length)
  if (/^[1-9]\d*$/.test(numericSuffix)) return identifier
  throw new ProviderError('provider_identity_drift')
}

function normalizedPostedAt(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return null
  return new Date(value).toISOString()
}

function safeDetailPath(value: unknown, identity: WorkdayIdentity) {
  if (
    typeof value !== 'string'
    || value.length < 6
    || value.length > 2_048
    || !value.startsWith('/job/')
    || value.includes('\\')
    || value.includes('?')
    || value.includes('#')
    || /%(?:2f|5c)/i.test(value)
  ) return null

  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return null
  }
  if (decoded.split('/').some((segment) => segment === '..' || segment === '.')) {
    return null
  }

  const publicUrl = new URL(value, identity.origin)
  const detailUrl = new URL(`${identity.cxsRoot}${value}`)
  if (
    publicUrl.origin !== identity.origin
    || detailUrl.origin !== identity.origin
    || publicUrl.username
    || publicUrl.password
    || publicUrl.port
  ) return null

  return {
    path: value,
    publicUrl: `${identity.publicBoard}${value}`,
    detailUrl: detailUrl.toString(),
  }
}

function parseListPosting(value: unknown, identity: WorkdayIdentity): WorkdayListPosting | null {
  if (!value || typeof value !== 'object') return null
  const posting = value as Record<string, unknown>
  const title = stringValue(posting.title, 512)
  const path = safeDetailPath(posting.externalPath, identity)
  if (!title?.trim() || !path) return null
  if (
    posting.locationsText !== undefined
    && posting.locationsText !== null
    && stringValue(posting.locationsText, 1_024) === null
  ) return null
  if (
    posting.postedOn !== undefined
    && posting.postedOn !== null
    && stringValue(posting.postedOn, 256) === null
  ) return null
  return posting as unknown as WorkdayListPosting
}

function equivalentListPosting(
  left: WorkdayListPosting,
  right: WorkdayListPosting,
) {
  return left.externalPath === right.externalPath
    && left.title === right.title
    && left.locationsText === right.locationsText
    && left.postedOn === right.postedOn
}

function parseListingTombstone(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const fields = value as Record<string, unknown>
  if (
    Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(fields).length !== 1
    || !Object.prototype.hasOwnProperty.call(fields, 'bulletFields')
    || !Array.isArray(fields.bulletFields)
    || fields.bulletFields.length !== 1
  ) return null
  return singleBulletIdentifier(fields.bulletFields)
}

function listingRequisitionIdentifier(externalPath: string) {
  return externalPath.match(/_([A-Za-z0-9][A-Za-z0-9._-]*)$/)?.[1] ?? null
}

function parseDetail(value: unknown): WorkdayDetail | null {
  if (!value || typeof value !== 'object') return null
  const info = (value as Record<string, unknown>).jobPostingInfo
  if (!info || typeof info !== 'object') return null
  const fields = info as Record<string, unknown>
  const id = stringValue(fields.id, 256)
  const title = stringValue(fields.title, 512)
  const description = stringValue(fields.jobDescription)
  if (!id?.trim() || !title?.trim() || !description) return null
  if (
    fields.location !== undefined
    && fields.location !== null
    && stringValue(fields.location, 1_024) === null
  ) return null
  if (
    fields.postedOn !== undefined
    && fields.postedOn !== null
    && stringValue(fields.postedOn, 256) === null
  ) return null
  if (
    fields.startDate !== undefined
    && fields.startDate !== null
    && stringValue(fields.startDate, 64) === null
  ) return null
  if (
    fields.jobReqId !== undefined
    && fields.jobReqId !== null
    && stringValue(fields.jobReqId, 256) === null
  ) return null
  return value as WorkdayDetail
}

export function mapWorkdayDetail(
  detail: WorkdayDetail,
  externalPath: string,
  identity: WorkdayIdentity = CAPITAL_ONE_WORKDAY_IDENTITY,
): NormalizedJob {
  const safePath = safeDetailPath(externalPath, identity)
  if (!safePath) throw new ProviderError('unsafe_detail_path')
  const info = detail.jobPostingInfo
  return Object.freeze({
    source: 'workday',
    externalId: info.id.trim(),
    title: info.title.trim(),
    location: info.location?.trim() || null,
    absoluteUrl: safePath.publicUrl,
    postedAt: normalizedPostedAt(info.postedOn),
    descriptionHtml: info.jobDescription,
    descriptionText: htmlToText(info.jobDescription),
    snapshotPartial: false,
    companyName: identity.companyName,
  })
}

async function requestJson(
  url: string,
  fetchImpl: FetchLike,
  maxBytes: number,
  init: RequestInit,
): Promise<unknown> {
  let response: Response
  try {
    response = await fetchImpl(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...init.headers,
      },
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new ProviderError('provider_timeout')
    }
    throw new ProviderError('network_error')
  }

  if (response.status === 429) throw new ProviderError('http_429')
  if (!response.ok) throw new ProviderError(`provider_http_${response.status}`)
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new ProviderError('invalid_content_type')
  }
  const declaredBytes = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
    throw new ProviderError('payload_too_large')
  }
  const text = await response.text()
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new ProviderError('payload_too_large')
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new ProviderError('malformed_response')
  }
}

function incomplete(
  jobs: NormalizedJob[],
  warning: string,
  expectedCount?: number,
  pageCount = 0,
): PollObservation {
  return {
    jobs: Object.freeze([...jobs]) as NormalizedJob[],
    completeness: jobs.length > 0 ? 'partial' : 'unknown',
    credibleForClosure: false,
    pageCount,
    ...(expectedCount === undefined ? {} : { expectedCount }),
    warnings: [warning.slice(0, 64)],
  }
}

export async function pollWorkday(
  fetchImpl: FetchLike = fetch,
  options: WorkdayOptions = {},
  identity: WorkdayIdentity = CAPITAL_ONE_WORKDAY_IDENTITY,
): Promise<PollObservation> {
  const listUrl = `${identity.cxsRoot}/jobs`
  const pageSize = Math.min(Math.max(options.pageSize ?? DEFAULT_PAGE_SIZE, 1), 20)
  const maxPages = Math.min(options.maxPages ?? DEFAULT_MAX_PAGES, DEFAULT_MAX_PAGES)
  const maxJobs = Math.min(options.maxJobs ?? DEFAULT_MAX_JOBS, DEFAULT_MAX_JOBS)
  const maxDetails = Math.min(options.maxDetails ?? DEFAULT_MAX_DETAILS, DEFAULT_MAX_DETAILS)
  const maxBytes = Math.min(options.maxBytes ?? DEFAULT_MAX_BYTES, DEFAULT_MAX_BYTES)
  const postings: WorkdayListPosting[] = []
  let expectedCount: number | undefined
  let pageCount = 0

  while (pageCount < maxPages) {
    let payload: unknown
    try {
      payload = await requestJson(listUrl, fetchImpl, maxBytes, {
        method: 'POST',
        body: JSON.stringify({
          appliedFacets: {},
          limit: pageSize,
          offset: postings.length,
          searchText: '',
        }),
      })
    } catch (error) {
      return incomplete(
        [],
        error instanceof ProviderError ? error.code : 'provider_error',
        expectedCount,
        pageCount,
      )
    }

    if (!payload || typeof payload !== 'object') {
      return incomplete([], 'provider_schema_invalid', expectedCount, pageCount)
    }
    const page = payload as Record<string, unknown>
    if (!Number.isInteger(page.total) || (page.total as number) < 0 || !Array.isArray(page.jobPostings)) {
      return incomplete([], 'provider_schema_invalid', expectedCount, pageCount)
    }
    const pageTotal = page.total as number
    if (expectedCount === undefined) expectedCount = pageTotal
    if (pageTotal !== expectedCount) {
      return incomplete([], 'count_mismatch', expectedCount, pageCount + 1)
    }
    if (expectedCount > maxJobs) {
      return incomplete([], 'job_cap_exceeded', expectedCount, pageCount + 1)
    }
    if (expectedCount > maxDetails) {
      return incomplete([], 'detail_cap_exceeded', expectedCount, pageCount + 1)
    }

    const parsed = page.jobPostings.map((posting) => parseListPosting(posting, identity))
    const valid = parsed.filter((posting): posting is WorkdayListPosting => posting !== null)
    pageCount += 1
    if (valid.length !== page.jobPostings.length) {
      const unsafePath = page.jobPostings.some((posting) => (
        posting
        && typeof posting === 'object'
        && 'externalPath' in posting
        && !safeDetailPath((posting as { externalPath: unknown }).externalPath, identity)
      ))
      return incomplete([], unsafePath ? 'unsafe_detail_path' : 'provider_schema_invalid', expectedCount, pageCount)
    }
    postings.push(...valid)
    if (postings.length > maxJobs) {
      return incomplete([], 'job_cap_exceeded', expectedCount, pageCount)
    }
    if (postings.length >= expectedCount) break
    if (page.jobPostings.length === 0) {
      return incomplete([], 'count_mismatch', expectedCount, pageCount)
    }
  }

  if (expectedCount === undefined) return incomplete([], 'provider_schema_invalid')
  if (expectedCount === 0) {
    return incomplete([], 'implausible_empty', expectedCount, pageCount)
  }
  if (postings.length !== expectedCount) {
    return incomplete(
      [],
      pageCount >= maxPages ? 'page_cap_exceeded' : 'count_mismatch',
      expectedCount,
      pageCount,
    )
  }
  if (new Set(postings.map((posting) => posting.externalPath)).size !== postings.length) {
    return incomplete([], 'count_mismatch', expectedCount, pageCount)
  }

  const jobs: NormalizedJob[] = []
  for (const posting of postings) {
    const path = safeDetailPath(posting.externalPath, identity)
    if (!path) return incomplete(jobs, 'unsafe_detail_path', expectedCount, pageCount)
    let payload: unknown
    try {
      payload = await requestJson(path.detailUrl, fetchImpl, maxBytes, { method: 'GET' })
    } catch (error) {
      return incomplete(
        jobs,
        error instanceof ProviderError ? error.code : 'provider_error',
        expectedCount,
        pageCount,
      )
    }
    const detail = parseDetail(payload)
    if (!detail || detail.jobPostingInfo.title.trim() !== posting.title.trim()) {
      return incomplete(jobs, 'provider_schema_invalid', expectedCount, pageCount)
    }
    jobs.push(mapWorkdayDetail(detail, path.path, identity))
  }

  return {
    jobs: Object.freeze([...jobs]) as NormalizedJob[],
    completeness: 'complete',
    credibleForClosure: true,
    pageCount,
    expectedCount,
    warnings: [],
  }
}

function mapRecentListPosting(
  posting: WorkdayListPosting,
  nowMs: number,
  identity: WorkdayIdentity,
): NormalizedJob {
  const path = safeDetailPath(posting.externalPath, identity)
  if (!path) throw new ProviderError('unsafe_detail_path')
  const ageDays = postedAgeDays(posting.postedOn)
  return Object.freeze({
    source: 'workday',
    externalId: listExternalId(posting),
    title: posting.title.trim(),
    location: posting.locationsText?.trim() || null,
    absoluteUrl: path.publicUrl,
    postedAt: ageDays === null
      ? null
      : new Date(nowMs - ageDays * 24 * 60 * 60 * 1_000).toISOString(),
    descriptionHtml: null,
    descriptionText: null,
    snapshotPartial: true,
    companyName: identity.companyName,
  })
}

function mapRecentDetail(
  detail: WorkdayDetail,
  posting: WorkdayListPosting,
  identity: WorkdayIdentity,
): NormalizedJob {
  const path = safeDetailPath(posting.externalPath, identity)
  if (!path) throw new ProviderError('unsafe_detail_path')
  const info = detail.jobPostingInfo
  const externalId = listExternalId(posting)
  const detailExternalId = info.jobReqId?.trim()
  const requiresDetailIdentity = legacyListExternalId(posting.externalPath) === null
  if (
    (requiresDetailIdentity && detailExternalId !== externalId)
    || (!requiresDetailIdentity && detailExternalId && detailExternalId !== externalId)
  ) {
    throw new ProviderError('provider_identity_drift')
  }
  return Object.freeze({
    source: 'workday',
    externalId,
    title: info.title.trim(),
    location: info.location?.trim() || null,
    absoluteUrl: path.publicUrl,
    postedAt: normalizedPostedAt(info.startDate) ?? normalizedPostedAt(info.postedOn),
    descriptionHtml: info.jobDescription,
    descriptionText: htmlToText(info.jobDescription),
    snapshotPartial: false,
    companyName: identity.companyName,
  })
}

/**
 * Discover the inclusion facet IDs to apply for an exclusion-scoped tenant
 * (Fidelity). Workday facets are inclusion-only, so exclusion of the named
 * jobFamilyGroup families is realized by applying the IDs of every OTHER family.
 * The IDs are read live from the facets array (they differ per tenant and can
 * drift), and the observation fails closed unless every named excluded family is
 * present and kept+excluded counts reconcile to the provider total.
 */
async function discoverKeptFacetIds(
  identity: WorkdayIdentity,
  listUrl: string,
  fetchImpl: FetchLike,
  maxBytes: number,
): Promise<{ ids: string[] } | { warning: string }> {
  const excluded = new Set(identity.excludedJobFamilyGroups ?? [])
  let payload: unknown
  try {
    payload = await requestJson(listUrl, fetchImpl, maxBytes, {
      method: 'POST',
      body: JSON.stringify({
        appliedFacets: {},
        limit: RECENT_PAGE_SIZE,
        offset: 0,
        searchText: '',
      }),
    })
  } catch (error) {
    return { warning: error instanceof ProviderError ? error.code : 'provider_error' }
  }
  if (!payload || typeof payload !== 'object') return { warning: 'provider_schema_invalid' }
  const page = payload as Record<string, unknown>
  if (!Number.isInteger(page.total) || (page.total as number) < 0) {
    return { warning: 'provider_schema_invalid' }
  }
  const total = page.total as number
  if (total === 0) return { warning: 'implausible_empty' }

  const facets = Array.isArray(page.facets) ? page.facets : []
  const familyFacet = facets.find((facet) => (
    facet
    && typeof facet === 'object'
    && (facet as { facetParameter?: unknown }).facetParameter === 'jobFamilyGroup'
  )) as { values?: unknown } | undefined
  const rawValues = Array.isArray(familyFacet?.values) ? familyFacet.values : []
  const values = rawValues.map((value) => {
    if (!value || typeof value !== 'object') return null
    const descriptor = stringValue((value as { descriptor?: unknown }).descriptor, 256)
    const id = stringValue((value as { id?: unknown }).id, 256)
    const count = (value as { count?: unknown }).count
    if (!descriptor?.trim() || !id?.trim() || !Number.isInteger(count)) return null
    return { descriptor, id, count: count as number }
  })
  if (values.length === 0 || values.some((value) => value === null)) {
    return { warning: 'category_filter_unverified' }
  }
  const clean = values as { descriptor: string; id: string; count: number }[]
  // Every named excluded family must actually appear, else exclusion is unproven.
  const present = new Set(clean.map((value) => value.descriptor))
  for (const family of excluded) {
    if (!present.has(family)) return { warning: 'category_filter_unverified' }
  }
  const summed = clean.reduce<number>((sum, value) => sum + value.count, 0)
  const kept = clean.filter((value) => !excluded.has(value.descriptor))
  if (summed !== total || kept.length === 0) {
    return { warning: 'category_filter_unverified' }
  }
  return { ids: kept.map((value) => value.id) }
}

/**
 * Intentionally selective Workday recent importer, parameterized over a resolved
 * WorkdayIdentity. It scans only the newest category-scoped listing window,
 * performs detail requests for recent candidates, keeps U.S. roles whose stated
 * required experience is under three years regardless of title, and never treats
 * absence from this selection as proof that a provider job closed.
 *
 * Category scoping is identity-driven: an identity carrying `keptFacetIds`
 * (Capital One) applies those IDs verbatim and reconciles their counts on page 0;
 * an identity carrying `excludedJobFamilyGroups` (Fidelity) discovers the kept
 * families' IDs live and reconciles kept+excluded counts before scanning.
 */
export async function pollWorkdayRecent(
  identity: WorkdayIdentity,
  fetchImpl: FetchLike = fetch,
  options: WorkdayRecentOptions = {},
): Promise<PollObservation> {
  const listUrl = `${identity.cxsRoot}/jobs`
  const recentDays = Math.min(Math.max(options.recentDays ?? DEFAULT_RECENT_DAYS, 1), 7)
  const maxPages = Math.min(options.maxPages ?? DEFAULT_RECENT_MAX_PAGES, DEFAULT_RECENT_MAX_PAGES)
  const maxListings = Math.min(
    options.maxListings ?? DEFAULT_RECENT_MAX_LISTINGS,
    DEFAULT_RECENT_MAX_LISTINGS,
  )
  const maxDetails = Math.min(
    options.maxDetails ?? DEFAULT_RECENT_MAX_DETAILS,
    DEFAULT_RECENT_MAX_DETAILS,
  )
  const maxBytes = Math.min(options.maxBytes ?? DEFAULT_MAX_BYTES, DEFAULT_MAX_BYTES)
  const nowMs = options.nowMs ?? Date.now()
  const knownIds = options.knownIds ?? new Set<string>()

  // Resolve the inclusion facet IDs to apply on every list page.
  let appliedFacetIds: string[]
  if (identity.keptFacetIds) {
    appliedFacetIds = Object.values(identity.keptFacetIds)
  } else if (identity.excludedJobFamilyGroups) {
    const discovered = await discoverKeptFacetIds(identity, listUrl, fetchImpl, maxBytes)
    if ('warning' in discovered) return incomplete([], discovered.warning, undefined, 1)
    appliedFacetIds = discovered.ids
  } else {
    // A recent poll with no category scoping cannot prove the filter applied.
    return incomplete([], 'category_filter_unverified', undefined, 0)
  }

  const candidates: WorkdayListPosting[] = []
  const seenPaths = new Set<string>()
  const seenTombstones = new Set<string>()
  const seenListingIdentifiers = new Set<string>()
  let providerTotal: number | undefined
  let rawCount = 0
  let pageCount = 0
  let reachedOlderPage = false

  while (pageCount < maxPages && rawCount < maxListings) {
    let payload: unknown
    try {
      payload = await requestJson(listUrl, fetchImpl, maxBytes, {
        method: 'POST',
        body: JSON.stringify({
          appliedFacets: {
            jobFamilyGroup: appliedFacetIds,
          },
          limit: RECENT_PAGE_SIZE,
          offset: rawCount,
          searchText: '',
        }),
      })
    } catch (error) {
      return incomplete(
        [],
        error instanceof ProviderError ? error.code : 'provider_error',
        undefined,
        pageCount,
      )
    }

    if (!payload || typeof payload !== 'object') {
      return incomplete([], 'provider_schema_invalid', undefined, pageCount)
    }
    const page = payload as Record<string, unknown>
    if (!Number.isInteger(page.total) || (page.total as number) < 0 || !Array.isArray(page.jobPostings)) {
      return incomplete([], 'provider_schema_invalid', undefined, pageCount)
    }
    const pageTotal = page.total as number
    if (providerTotal === undefined) providerTotal = pageTotal
    const laterPageTotalSentinel = pageCount > 0
      && pageTotal === 0
      && page.jobPostings.length > 0
    if (providerTotal !== pageTotal && !laterPageTotalSentinel) {
      return incomplete([], 'count_mismatch', undefined, pageCount + 1)
    }
    if (providerTotal === 0) {
      return incomplete([], 'implausible_empty', 0, pageCount + 1)
    }
    if (pageCount === 0 && identity.keptFacetIds) {
      const facets = Array.isArray(page.facets) ? page.facets : []
      const categoryFacet = facets.find((facet) => (
        facet
        && typeof facet === 'object'
        && (facet as { facetParameter?: unknown }).facetParameter === 'jobFamilyGroup'
      )) as { values?: unknown } | undefined
      const values = Array.isArray(categoryFacet?.values) ? categoryFacet.values : []
      const verifiedCounts = Object.entries(identity.keptFacetIds).map(([descriptor, id]) => {
        const value = values.find((candidate) => (
          candidate
          && typeof candidate === 'object'
          && (candidate as { descriptor?: unknown }).descriptor === descriptor
          && (candidate as { id?: unknown }).id === id
        )) as { count?: unknown } | undefined
        return Number.isInteger(value?.count) ? value.count as number : null
      })
      if (
        verifiedCounts.some((count) => count === null)
        || verifiedCounts.reduce<number>((sum, count) => sum + (count ?? 0), 0) !== providerTotal
      ) {
        return incomplete([], 'category_filter_unverified', undefined, pageCount + 1)
      }
    }

    if (rawCount + page.jobPostings.length > providerTotal) {
      return incomplete([], 'count_mismatch', undefined, pageCount + 1)
    }

    const postings: WorkdayListPosting[] = []
    const tombstones: string[] = []
    for (const entry of page.jobPostings) {
      const posting = parseListPosting(entry, identity)
      if (posting) {
        postings.push(posting)
        continue
      }
      const tombstone = parseListingTombstone(entry)
      if (tombstone) {
        tombstones.push(tombstone)
        continue
      }
      return incomplete([], 'provider_schema_invalid', undefined, pageCount + 1)
    }

    pageCount += 1
    for (const posting of postings) {
      if (seenPaths.has(posting.externalPath)) {
        return incomplete([], 'count_mismatch', undefined, pageCount)
      }
      const identifier = listingRequisitionIdentifier(posting.externalPath)
      if (identifier && seenTombstones.has(identifier)) {
        return incomplete([], 'count_mismatch', undefined, pageCount)
      }
      seenPaths.add(posting.externalPath)
      if (identifier) seenListingIdentifiers.add(identifier)
      const age = postedAgeDays(posting.postedOn)
      if (age === null || age <= recentDays) candidates.push(posting)
    }
    for (const identifier of tombstones) {
      if (
        seenTombstones.has(identifier)
        || seenListingIdentifiers.has(identifier)
      ) {
        return incomplete([], 'count_mismatch', undefined, pageCount)
      }
      seenTombstones.add(identifier)
    }
    rawCount += page.jobPostings.length

    reachedOlderPage = postings.length > 0
      && postings.every((posting) => {
        const age = postedAgeDays(posting.postedOn)
        return age !== null && age > recentDays
      })
    if (page.jobPostings.length === 0 && rawCount < providerTotal) {
      return incomplete([], 'count_mismatch', undefined, pageCount)
    }
    if (reachedOlderPage || rawCount >= providerTotal) break
  }

  if (
    !reachedOlderPage
    && rawCount < (providerTotal ?? 0)
    && (rawCount >= maxListings || pageCount >= maxPages)
  ) {
    return incomplete([], 'recent_window_cap_exceeded', undefined, pageCount)
  }

  const jobs: NormalizedJob[] = []
  let details = 0
  for (const posting of candidates) {
    const externalId = listExternalId(posting)
    if (knownIds.has(externalId)) {
      jobs.push(mapRecentListPosting(posting, nowMs, identity))
      continue
    }
    if (details >= maxDetails) {
      return {
        jobs: Object.freeze([...jobs]) as NormalizedJob[],
        completeness: 'partial',
        credibleForClosure: false,
        allowMissingClosure: false,
        pageCount,
        expectedCount: candidates.length,
        warnings: ['detail_cap_exceeded'],
      }
    }
    const path = safeDetailPath(posting.externalPath, identity)
    if (!path) return incomplete(jobs, 'unsafe_detail_path', candidates.length, pageCount)
    let payload: unknown
    try {
      details += 1
      payload = await requestJson(path.detailUrl, fetchImpl, maxBytes, { method: 'GET' })
    } catch (error) {
      return incomplete(
        jobs,
        error instanceof ProviderError ? error.code : 'provider_error',
        candidates.length,
        pageCount,
      )
    }
    const detail = parseDetail(payload)
    if (!detail || detail.jobPostingInfo.title.trim() !== posting.title.trim()) {
      return incomplete(jobs, 'provider_schema_invalid', candidates.length, pageCount)
    }
    if (
      !recentStartDate(detail.jobPostingInfo.startDate, nowMs, recentDays)
      || !isUnitedStatesDetail(detail)
      || !isEntryLevelWorkdayDetail(detail)
    ) continue
    jobs.push(mapRecentDetail(detail, posting, identity))
  }

  return {
    jobs: Object.freeze([...jobs]) as NormalizedJob[],
    completeness: 'complete',
    credibleForClosure: true,
    allowMissingClosure: false,
    pageCount,
    expectedCount: jobs.length,
    warnings: [],
  }
}

/**
 * Thin backward-compatible wrapper: the exact frozen Capital One recent importer,
 * delegating to the identity-parameterized pollWorkdayRecent so untouched callers
 * (connectors.ts) stay byte-behavior-identical this wave.
 */
export async function pollCapitalOneRecent(
  fetchImpl: FetchLike = fetch,
  options: WorkdayRecentOptions,
): Promise<PollObservation> {
  return pollWorkdayRecent(CAPITAL_ONE_WORKDAY_IDENTITY, fetchImpl, options)
}

export async function verifyWorkdayListing(
  fetchImpl: FetchLike = fetch,
  options: WorkdayOptions = {},
  identity: WorkdayIdentity = CAPITAL_ONE_WORKDAY_IDENTITY,
) {
  const listUrl = `${identity.cxsRoot}/jobs`
  const pageSize = Math.min(Math.max(options.pageSize ?? DEFAULT_PAGE_SIZE, 1), 20)
  const maxPages = Math.min(options.maxPages ?? DEFAULT_MAX_PAGES, DEFAULT_MAX_PAGES)
  const maxJobs = Math.min(options.maxJobs ?? DEFAULT_MAX_JOBS, DEFAULT_MAX_JOBS)
  const seenPaths = new Map<string, WorkdayListPosting>()
  const seenTombstones = new Set<string>()
  const seenListingIdentifiers = new Set<string>()
  let expectedCount: number | undefined
  let rawCount = 0
  let pageCount = 0

  while (pageCount < maxPages) {
    const payload = await requestJson(listUrl, fetchImpl, options.maxBytes ?? DEFAULT_MAX_BYTES, {
      method: 'POST',
      body: JSON.stringify({
        appliedFacets: {},
        limit: pageSize,
        offset: rawCount,
        searchText: '',
      }),
    })
    if (!payload || typeof payload !== 'object') throw new ProviderError('provider_schema_invalid')
    const page = payload as Record<string, unknown>
    if (!Number.isInteger(page.total) || (page.total as number) < 0 || !Array.isArray(page.jobPostings)) {
      throw new ProviderError('provider_schema_invalid')
    }
    const pageTotal = page.total as number
    if (expectedCount === undefined) expectedCount = pageTotal
    if (expectedCount > maxJobs) throw new ProviderError('job_cap_exceeded')

    const laterPageTotalSentinel = pageCount > 0
      && pageTotal === 0
      && page.jobPostings.length > 0
    if (pageTotal !== expectedCount && !laterPageTotalSentinel) {
      throw new ProviderError('count_mismatch')
    }
    if (rawCount + page.jobPostings.length > expectedCount) {
      throw new ProviderError('count_mismatch')
    }

    const pagePostings: WorkdayListPosting[] = []
    const pageTombstones: string[] = []
    for (const entry of page.jobPostings) {
      const posting = parseListPosting(entry, identity)
      if (posting) {
        pagePostings.push(posting)
        continue
      }
      const tombstone = parseListingTombstone(entry)
      if (tombstone) {
        pageTombstones.push(tombstone)
        continue
      }
      const unsafePath = entry
        && typeof entry === 'object'
        && 'externalPath' in entry
        && !safeDetailPath((entry as { externalPath: unknown }).externalPath, identity)
      throw new ProviderError(unsafePath ? 'unsafe_detail_path' : 'provider_schema_invalid')
    }

    pageCount += 1
    for (const posting of pagePostings) {
      const identifier = listingRequisitionIdentifier(posting.externalPath)
      if (identifier && seenTombstones.has(identifier)) throw new ProviderError('count_mismatch')
      const prior = seenPaths.get(posting.externalPath)
      if (prior && !equivalentListPosting(prior, posting)) {
        throw new ProviderError('count_mismatch')
      }
      seenPaths.set(posting.externalPath, posting)
      if (identifier) seenListingIdentifiers.add(identifier)
    }
    for (const identifier of pageTombstones) {
      if (
        seenTombstones.has(identifier)
        || seenListingIdentifiers.has(identifier)
      ) throw new ProviderError('count_mismatch')
      seenTombstones.add(identifier)
    }
    rawCount += page.jobPostings.length
    if (rawCount >= expectedCount) break
    if (page.jobPostings.length === 0) throw new ProviderError('count_mismatch')
  }

  if (expectedCount === undefined) throw new ProviderError('provider_schema_invalid')
  if (expectedCount === 0) throw new ProviderError('implausible_empty')
  if (rawCount !== expectedCount) {
    throw new ProviderError(pageCount >= maxPages ? 'page_cap_exceeded' : 'count_mismatch')
  }
  return { jobCount: expectedCount, pageCount }
}

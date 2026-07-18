import { type NormalizedJob, type PollObservation } from './types.ts'

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

interface WorkdayOptions {
  pageSize?: number
  maxPages?: number
  maxJobs?: number
  maxDetails?: number
  maxBytes?: number
}

interface WorkdayListPosting {
  title: string
  externalPath: string
  locationsText?: string | null
  postedOn?: string | null
}

interface WorkdayDetail {
  jobPostingInfo: {
    id: string
    title: string
    jobDescription: string
    location?: string | null
    postedOn?: string | null
  }
}

export const CAPITAL_ONE_WORKDAY_SOURCE_KEY = 'workday:wd12:capitalone:Capital_One'

const TENANT = 'capitalone'
const REGION = 'wd12'
const SITE = 'Capital_One'
const PUBLIC_ORIGIN = `https://${TENANT}.${REGION}.myworkdayjobs.com`
const PUBLIC_BOARD = `${PUBLIC_ORIGIN}/${SITE}`
const CXS_ROOT = `${PUBLIC_ORIGIN}/wday/cxs/${TENANT}/${SITE}`
const LIST_URL = `${CXS_ROOT}/jobs`
const DEFAULT_PAGE_SIZE = 20
const DEFAULT_MAX_PAGES = 100
const DEFAULT_MAX_JOBS = 2_000
const DEFAULT_MAX_DETAILS = 2_000
const DEFAULT_MAX_BYTES = 2_000_000
const MAX_STRING = 500_000

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

function normalizedPostedAt(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return null
  return new Date(value).toISOString()
}

function safeDetailPath(value: unknown) {
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

  const publicUrl = new URL(value, PUBLIC_ORIGIN)
  const detailUrl = new URL(`${CXS_ROOT}${value}`)
  if (
    publicUrl.origin !== PUBLIC_ORIGIN
    || detailUrl.origin !== PUBLIC_ORIGIN
    || publicUrl.username
    || publicUrl.password
    || publicUrl.port
  ) return null

  return {
    path: value,
    publicUrl: `${PUBLIC_BOARD}${value}`,
    detailUrl: detailUrl.toString(),
  }
}

function parseListPosting(value: unknown): WorkdayListPosting | null {
  if (!value || typeof value !== 'object') return null
  const posting = value as Record<string, unknown>
  const title = stringValue(posting.title, 512)
  const path = safeDetailPath(posting.externalPath)
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
  return value as WorkdayDetail
}

export function mapWorkdayDetail(
  detail: WorkdayDetail,
  externalPath: string,
): NormalizedJob {
  const safePath = safeDetailPath(externalPath)
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
    companyName: 'Capital One',
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
): Promise<PollObservation> {
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
      payload = await requestJson(LIST_URL, fetchImpl, maxBytes, {
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

    const parsed = page.jobPostings.map(parseListPosting)
    const valid = parsed.filter((posting): posting is WorkdayListPosting => posting !== null)
    pageCount += 1
    if (valid.length !== page.jobPostings.length) {
      const unsafePath = page.jobPostings.some((posting) => (
        posting
        && typeof posting === 'object'
        && 'externalPath' in posting
        && !safeDetailPath((posting as { externalPath: unknown }).externalPath)
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
    const path = safeDetailPath(posting.externalPath)
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
    jobs.push(mapWorkdayDetail(detail, path.path))
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

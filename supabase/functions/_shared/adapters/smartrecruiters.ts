import { type NormalizedJob, type PollObservation } from './types.ts'

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

interface SmartRecruitersOptions {
  pageSize?: number
  maxPages?: number
  maxJobs?: number
  maxBytes?: number
}

interface SmartRecruitersPosting {
  id: string
  name: string
  releasedDate?: string | null
  ref: string
  location?: {
    city?: string | null
    region?: string | null
    country?: string | null
  } | null
  company?: { name?: string | null } | null
  jobAd?: {
    sections?: {
      jobDescription?: { text?: string | null } | null
    } | null
  } | null
}

const STRICT_SLUG = /^[A-Za-z0-9_-]+$/
const DEFAULT_PAGE_SIZE = 100
const DEFAULT_MAX_PAGES = 20
const DEFAULT_MAX_JOBS = 1_000
const DEFAULT_MAX_BYTES = 2_000_000
const MAX_RETRY_DELAY_MS = 100

class ProviderError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

function safeHttpsUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 2_048) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.toString()
      : null
  } catch {
    return null
  }
}

function stringValue(value: unknown, maxLength = 10_000) {
  return typeof value === 'string' && value.length <= maxLength ? value : null
}

function parsePosting(value: unknown): SmartRecruitersPosting | null {
  if (!value || typeof value !== 'object') return null
  const posting = value as Record<string, unknown>
  const id = stringValue(posting.id, 256)
  const name = stringValue(posting.name, 512)
  const ref = safeHttpsUrl(posting.ref)
  if (!id || !name?.trim() || !ref) return null
  if (
    posting.releasedDate !== undefined
    && posting.releasedDate !== null
    && (
      typeof posting.releasedDate !== 'string'
      || !Number.isFinite(Date.parse(posting.releasedDate))
    )
  ) return null

  return posting as unknown as SmartRecruitersPosting
}

function htmlToText(value: string) {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

export function mapSmartRecruitersPosting(
  posting: SmartRecruitersPosting,
): NormalizedJob {
  const location = [
    posting.location?.city,
    posting.location?.region,
    posting.location?.country,
  ].filter((part): part is string => Boolean(part?.trim())).join(', ') || null
  const descriptionHtml = posting.jobAd?.sections?.jobDescription?.text ?? null

  return {
    source: 'smartrecruiters',
    externalId: posting.id,
    title: posting.name.trim(),
    location,
    absoluteUrl: posting.ref,
    postedAt: posting.releasedDate
      ? new Date(posting.releasedDate).toISOString()
      : null,
    descriptionHtml,
    descriptionText: descriptionHtml ? htmlToText(descriptionHtml) : null,
    snapshotPartial: descriptionHtml === null,
    companyName: posting.company?.name?.trim() || null,
  }
}

function retryDelay(response: Response) {
  const header = response.headers.get('retry-after')
  if (!header) return 0
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, MAX_RETRY_DELAY_MS)
  }
  const dateDelay = Date.parse(header) - Date.now()
  return Number.isFinite(dateDelay)
    ? Math.max(0, Math.min(dateDelay, MAX_RETRY_DELAY_MS))
    : 0
}

async function requestJson(
  url: string,
  fetchImpl: FetchLike,
  maxBytes: number,
): Promise<unknown> {
  let response: Response | undefined
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetchImpl(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
        headers: { accept: 'application/json' },
      })
    } catch {
      throw new ProviderError('network_error')
    }
    if (response.status !== 429 && response.status < 500) break
    if (attempt === 0) {
      const delay = retryDelay(response)
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  if (!response) throw new ProviderError('network_error')
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
    jobs,
    completeness: jobs.length > 0 ? 'partial' : 'unknown',
    credibleForClosure: false,
    pageCount,
    ...(expectedCount === undefined ? {} : { expectedCount }),
    warnings: [warning.slice(0, 64)],
  }
}

export async function pollSmartRecruiters(
  companySlug: string,
  fetchImpl: FetchLike = fetch,
  options: SmartRecruitersOptions = {},
): Promise<PollObservation> {
  if (!STRICT_SLUG.test(companySlug)) return incomplete([], 'invalid_identity')

  const pageSize = Math.min(Math.max(options.pageSize ?? DEFAULT_PAGE_SIZE, 1), 100)
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES
  const maxJobs = options.maxJobs ?? DEFAULT_MAX_JOBS
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const jobs: NormalizedJob[] = []
  const postings: SmartRecruitersPosting[] = []
  let expectedCount: number | undefined
  let offset = 0
  let pageCount = 0

  while (pageCount < maxPages) {
    const url = new URL(
      `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(companySlug)}/postings`,
    )
    url.searchParams.set('limit', String(pageSize))
    url.searchParams.set('offset', String(offset))

    let payload: unknown
    try {
      payload = await requestJson(url.toString(), fetchImpl, maxBytes)
    } catch (error) {
      return incomplete(
        jobs,
        error instanceof ProviderError ? error.code : 'provider_error',
        expectedCount,
        pageCount,
      )
    }

    if (!payload || typeof payload !== 'object') {
      return incomplete(jobs, 'provider_schema_invalid', expectedCount, pageCount)
    }
    const page = payload as Record<string, unknown>
    if (!Number.isInteger(page.totalFound) || (page.totalFound as number) < 0 || !Array.isArray(page.content)) {
      return incomplete(jobs, 'provider_schema_invalid', expectedCount, pageCount)
    }
    const pageTotal = page.totalFound as number
    if (expectedCount === undefined) expectedCount = pageTotal
    if (pageTotal !== expectedCount) {
      return incomplete(jobs, 'count_mismatch', expectedCount, pageCount + 1)
    }
    if (expectedCount > maxJobs) {
      return incomplete([], 'job_cap_exceeded', expectedCount, pageCount + 1)
    }

    const parsed = page.content.map(parsePosting)
    const valid = parsed.filter((posting): posting is SmartRecruitersPosting => posting !== null)
    postings.push(...valid)
    jobs.push(...valid.map(mapSmartRecruitersPosting))
    pageCount += 1
    if (valid.length !== page.content.length) {
      return incomplete(jobs, 'provider_schema_invalid', expectedCount, pageCount)
    }
    if (jobs.length > maxJobs) {
      return incomplete([], 'job_cap_exceeded', expectedCount, pageCount)
    }
    if (jobs.length >= expectedCount) break
    if (page.content.length === 0) {
      return incomplete(jobs, 'count_mismatch', expectedCount, pageCount)
    }
    offset += page.content.length
  }

  if (expectedCount === undefined) return incomplete([], 'provider_schema_invalid')
  if (jobs.length !== expectedCount) {
    return incomplete(
      jobs,
      pageCount >= maxPages ? 'page_cap_exceeded' : 'count_mismatch',
      expectedCount,
      pageCount,
    )
  }
  if (new Set(jobs.map((job) => job.externalId)).size !== jobs.length) {
    return incomplete(jobs, 'count_mismatch', expectedCount, pageCount)
  }

  for (let index = 0; index < postings.length; index += 2) {
    const detailIndexes = [index, index + 1].filter((detailIndex) => (
      detailIndex < postings.length && jobs[detailIndex].snapshotPartial
    ))
    try {
      await Promise.all(detailIndexes.map(async (detailIndex) => {
        const listed = postings[detailIndex]
        const detailUrl = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(companySlug)}/postings/${encodeURIComponent(listed.id)}`
        const detailPayload = await requestJson(detailUrl, fetchImpl, maxBytes)
        const detail = parsePosting(detailPayload)
        if (!detail || detail.id !== listed.id || !detail.jobAd?.sections?.jobDescription?.text) {
          throw new ProviderError('provider_schema_invalid')
        }
        postings[detailIndex] = detail
        jobs[detailIndex] = mapSmartRecruitersPosting(detail)
      }))
    } catch (error) {
      return incomplete(
        jobs,
        error instanceof ProviderError ? error.code : 'provider_error',
        expectedCount,
        pageCount,
      )
    }
  }

  return {
    jobs,
    completeness: 'complete',
    credibleForClosure: true,
    pageCount,
    expectedCount,
    warnings: [],
  }
}

import { type NormalizedJob, type PollObservation } from './types.ts'

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

interface RecruiteeOffer {
  id: string | number
  title: string
  careers_url: string
  location?: string | null
  created_at?: string | null
  description?: string | null
}

const STRICT_SLUG = /^[A-Za-z0-9_-]+$/
const MAX_BYTES = 2_000_000
const MAX_JOBS = 1_000
const MAX_RETRY_DELAY_MS = 100

class ProviderError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

function htmlToText(value: string) {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
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

function parseOffer(value: unknown): RecruiteeOffer | null {
  if (!value || typeof value !== 'object') return null
  const offer = value as Record<string, unknown>
  if (
    (typeof offer.id !== 'string' && typeof offer.id !== 'number')
    || !String(offer.id)
    || typeof offer.title !== 'string'
    || !offer.title.trim()
    || !safeHttpsUrl(offer.careers_url)
  ) return null
  if (offer.description !== undefined && offer.description !== null && typeof offer.description !== 'string') return null
  if (
    offer.created_at !== undefined
    && offer.created_at !== null
    && (
      typeof offer.created_at !== 'string'
      || !Number.isFinite(Date.parse(offer.created_at))
    )
  ) return null
  return offer as unknown as RecruiteeOffer
}

export function mapRecruiteeOffer(offer: RecruiteeOffer): NormalizedJob {
  const descriptionHtml = offer.description ?? null
  return {
    source: 'recruitee',
    externalId: String(offer.id),
    title: offer.title.trim(),
    location: offer.location?.trim() || null,
    absoluteUrl: offer.careers_url,
    postedAt: offer.created_at ? new Date(offer.created_at).toISOString() : null,
    descriptionHtml,
    descriptionText: descriptionHtml ? htmlToText(descriptionHtml) : null,
    snapshotPartial: descriptionHtml === null,
    companyName: null,
  }
}

function retryDelay(response: Response) {
  const seconds = Number(response.headers.get('retry-after'))
  return Number.isFinite(seconds) && seconds >= 0
    ? Math.min(seconds * 1_000, MAX_RETRY_DELAY_MS)
    : 0
}

async function fetchPayload(url: string, fetchImpl: FetchLike): Promise<unknown> {
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
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_BYTES) {
    throw new ProviderError('payload_too_large')
  }
  const text = await response.text()
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES) {
    throw new ProviderError('payload_too_large')
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new ProviderError('malformed_response')
  }
}

function failed(
  code: string,
  jobs: NormalizedJob[] = [],
  expectedCount?: number,
): PollObservation {
  return {
    jobs,
    completeness: jobs.length > 0 ? 'partial' : 'unknown',
    credibleForClosure: false,
    pageCount: jobs.length > 0 ? 1 : 0,
    ...(expectedCount === undefined ? {} : { expectedCount }),
    warnings: [code.slice(0, 64)],
  }
}

export async function pollRecruitee(
  tenant: string,
  fetchImpl: FetchLike = fetch,
): Promise<PollObservation> {
  if (!STRICT_SLUG.test(tenant)) return failed('invalid_identity')
  const url = `https://${tenant.toLowerCase()}.recruitee.com/api/offers/`
  let payload: unknown
  try {
    payload = await fetchPayload(url, fetchImpl)
  } catch (error) {
    return failed(error instanceof ProviderError ? error.code : 'provider_error')
  }
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { offers?: unknown }).offers)) {
    return failed('provider_schema_invalid')
  }
  const offers = (payload as { offers: unknown[] }).offers
  if (offers.length > MAX_JOBS) return failed('job_cap_exceeded')
  const parsed = offers.map(parseOffer)
  const valid = parsed.filter((offer): offer is RecruiteeOffer => offer !== null)
  const jobs = valid.map(mapRecruiteeOffer)
  if (valid.length !== offers.length) {
    return failed('provider_schema_invalid', jobs, offers.length)
  }
  if (new Set(jobs.map((job) => job.externalId)).size !== jobs.length) {
    return failed('count_mismatch')
  }
  return {
    jobs,
    completeness: 'complete',
    credibleForClosure: true,
    pageCount: 1,
    expectedCount: jobs.length,
    warnings: [],
  }
}

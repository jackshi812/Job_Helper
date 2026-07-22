import {
  type PaylocityIdentity,
  resolvePaylocityIdentity,
} from '../provider-identities.ts'
import { type NormalizedJob, type PollObservation } from './types.ts'

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface PaylocityJobPayload {
  jobId: string | number
  jobTitle: string
  companyName?: string | null
  location?: string | null
  description: string
  requirements?: string | null
  jobUrl: string
  applyUrl?: string | null
  listUrl: string
  publishedDate?: string | null
  createdUtc?: string | null
}

const MAX_BYTES = 2_000_000
const MAX_JOBS = 1_000
const MAX_TEXT = 512
const MAX_HTML = 500_000
const MAX_URL = 2_048
const DECIMAL_ID = /^[1-9]\d*$/
const PAYLOCITY_HOST = 'recruiting.paylocity.com'

class ProviderError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

type ParsedJob =
  | { ok: true; job: PaylocityJobPayload }
  | { ok: false; code: 'identity_drift' | 'provider_schema_invalid' }

function boundedString(value: unknown, maxLength: number, allowBlank = false) {
  return typeof value === 'string'
    && value.length <= maxLength
    && (allowBlank || value.trim().length > 0)
}

function decimalId(value: unknown) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null
  }
  return typeof value === 'string' && DECIMAL_ID.test(value) ? value : null
}

function parseDate(value: unknown) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || !value || !Number.isFinite(Date.parse(value))) return undefined
  return new Date(value).toISOString()
}

function safePaylocityUrl(value: unknown) {
  if (!boundedString(value, MAX_URL)) return null
  try {
    const url = new URL(value as string)
    return url.protocol === 'https:'
      && url.hostname === PAYLOCITY_HOST
      && !url.username
      && !url.password
      && !url.port
      && !url.hash
      ? url.toString()
      : null
  } catch {
    return null
  }
}

function validListUrl(value: unknown, identity: PaylocityIdentity) {
  const safeUrl = safePaylocityUrl(value)
  return safeUrl !== null && safeUrl === identity.canonicalUrl
}

function normalizedIdentity(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function parseJob(value: unknown, identity: PaylocityIdentity): ParsedJob {
  if (!value || typeof value !== 'object') {
    return { ok: false, code: 'provider_schema_invalid' }
  }
  const job = value as Record<string, unknown>
  const jobTitle = job.jobTitle ?? job.title
  const location = job.location ?? (
    job.jobLocation && typeof job.jobLocation === 'object'
      ? (job.jobLocation as Record<string, unknown>).name
      : undefined
  )
  const jobUrlValue = job.jobUrl ?? job.displayUrl
  if (
    (job.companyName !== undefined
      && job.companyName !== null
      && (!boundedString(job.companyName, MAX_TEXT)
        || normalizedIdentity(job.companyName as string) !== identity.displayName))
    || !validListUrl(job.listUrl, identity)
  ) return { ok: false, code: 'identity_drift' }

  const id = decimalId(job.jobId)
  const publishedDate = parseDate(job.publishedDate)
  const createdUtc = parseDate(job.createdUtc)
  const jobUrl = safePaylocityUrl(jobUrlValue)
  const applyUrl = job.applyUrl === undefined || job.applyUrl === null
    ? null
    : safePaylocityUrl(job.applyUrl)
  if (
    !id
    || !boundedString(jobTitle, MAX_TEXT)
    || (location !== undefined && location !== null
      && !boundedString(location, MAX_TEXT, true))
    || !boundedString(job.description, MAX_HTML)
    || (job.requirements !== undefined && job.requirements !== null
      && !boundedString(job.requirements, MAX_HTML, true))
    || !jobUrl
    || (job.applyUrl !== undefined && job.applyUrl !== null && !applyUrl)
    || publishedDate === undefined
    || createdUtc === undefined
    || (publishedDate === null && createdUtc === null)
  ) return { ok: false, code: 'provider_schema_invalid' }

  return {
    ok: true,
    job: {
      jobId: id,
      jobTitle: jobTitle as string,
      companyName: job.companyName as string | null | undefined,
      location: location as string | null | undefined,
      description: job.description as string,
      requirements: job.requirements as string | null | undefined,
      jobUrl,
      applyUrl,
      listUrl: identity.canonicalUrl,
      publishedDate,
      createdUtc,
    },
  }
}

function htmlToText(value: string) {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

export function mapPaylocityJob(job: PaylocityJobPayload): NormalizedJob {
  const descriptionHtml = [job.description, job.requirements]
    .filter((value): value is string => Boolean(value?.trim()))
    .join('\n')
  const postedAt = job.publishedDate ?? job.createdUtc ?? null
  return {
    source: 'paylocity',
    externalId: String(job.jobId),
    title: job.jobTitle.trim(),
    location: job.location?.trim() || null,
    absoluteUrl: job.jobUrl,
    postedAt: postedAt ? new Date(postedAt).toISOString() : null,
    descriptionHtml,
    descriptionText: htmlToText(descriptionHtml),
    snapshotPartial: false,
    companyName: job.companyName?.trim() || null,
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

async function fetchPayload(identity: PaylocityIdentity, fetchImpl: FetchLike) {
  let response: Response
  try {
    response = await fetchImpl(
      `https://${PAYLOCITY_HOST}/recruiting/v2/api/feed/jobs/${identity.feedKey}`,
      {
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
        headers: { accept: 'application/json' },
      },
    )
  } catch {
    throw new ProviderError('network_error')
  }
  if (response.status !== 200) throw new ProviderError(`provider_http_${response.status}`)
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

export async function pollPaylocity(
  boardUuid: string,
  fetchImpl: FetchLike = fetch,
): Promise<PollObservation> {
  const identity = resolvePaylocityIdentity(boardUuid)
  if (!identity) return failed('invalid_identity')

  let payload: unknown
  try {
    payload = await fetchPayload(identity, fetchImpl)
  } catch (error) {
    return failed(error instanceof ProviderError ? error.code : 'provider_error')
  }
  if (!payload || typeof payload !== 'object') return failed('provider_schema_invalid')

  const root = payload as Record<string, unknown>
  if (!boundedString(root.displayName, MAX_TEXT) || !Array.isArray(root.jobs)) {
    return failed('provider_schema_invalid')
  }
  if (normalizedIdentity(root.displayName as string) !== identity.displayName) {
    return failed('identity_drift')
  }
  if (root.jobs.length === 0) return failed('implausible_empty')
  if (root.jobs.length > MAX_JOBS) return failed('job_cap_exceeded')

  const parsed = root.jobs.map((value) => parseJob(value, identity))
  const valid = parsed.filter((result): result is Extract<ParsedJob, { ok: true }> => result.ok)
  const firstFailure = parsed.find((result): result is Extract<ParsedJob, { ok: false }> => !result.ok)
  const unique = new Map<string, PaylocityJobPayload>()
  for (const result of valid) unique.set(String(result.job.jobId), result.job)
  const jobs = [...unique.values()].map(mapPaylocityJob)

  if (firstFailure) return failed(firstFailure.code, jobs, root.jobs.length)
  if (unique.size !== valid.length) return failed('duplicate_job_id', jobs, root.jobs.length)
  return {
    jobs,
    completeness: 'complete',
    credibleForClosure: true,
    pageCount: 1,
    expectedCount: root.jobs.length,
    warnings: [],
  }
}

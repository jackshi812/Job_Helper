import { pollAshby } from './adapters/ashby.ts'
import { pollGreenhouse } from './adapters/greenhouse.ts'
import { pollLever } from './adapters/lever.ts'
import { type PollObservation } from './adapters/types.ts'
import { buildEndpoint, type DetectResult } from './detect.ts'

export type ProviderId = 'greenhouse' | 'lever' | 'ashby'
export type SupportedDetection = Exclude<DetectResult, { ats: 'unsupported' }>

export interface PollConnectorCompany {
  ats_type: string
  board_token: string
  region: 'eu' | null
}

export interface ConnectorVerification {
  ats: ProviderId
  boardToken: string
  region: 'eu' | null
  companyName: string
  jobCount: number
  careersUrl: string
  sourceKey: string
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

interface ProviderConnector {
  verify: (detected: SupportedDetection, fetchImpl: FetchLike) => Promise<ConnectorVerification>
  poll: (company: PollConnectorCompany, knownIds: Set<string>) => Promise<PollObservation>
}

function canonicalCareersUrl(detected: SupportedDetection) {
  const slug = encodeURIComponent(detected.slug)
  if (detected.ats === 'greenhouse') return `https://job-boards.greenhouse.io/${slug}`
  if (detected.ats === 'lever') {
    const host = detected.region === 'eu' ? 'jobs.eu.lever.co' : 'jobs.lever.co'
    return `https://${host}/${slug}`
  }
  return `https://jobs.ashbyhq.com/${slug}`
}

function deterministicSourceKey(detected: SupportedDetection) {
  return `${detected.ats}:${detected.region ?? 'global'}:${detected.slug}`
}

function verification(
  detected: SupportedDetection,
  companyName: string,
  jobCount: number,
): ConnectorVerification {
  return {
    ats: detected.ats,
    boardToken: detected.slug,
    region: detected.region ?? null,
    companyName: companyName.trim() || detected.slug,
    jobCount,
    careersUrl: canonicalCareersUrl(detected),
    sourceKey: deterministicSourceKey(detected),
  }
}

async function fetchVerificationPayload(detected: SupportedDetection, fetchImpl: FetchLike) {
  const response = await fetchImpl(buildEndpoint(detected), { redirect: 'error' })
  if (!response.ok) throw new Error(`provider_http_${response.status}`)
  return response.json() as Promise<unknown>
}

async function verifyGreenhouse(detected: SupportedDetection, fetchImpl: FetchLike) {
  const payload = await fetchVerificationPayload(detected, fetchImpl) as {
    jobs?: Array<{ company_name?: unknown }>
  }
  if (!Array.isArray(payload.jobs)) throw new Error('provider_schema_invalid')
  const companyName = typeof payload.jobs[0]?.company_name === 'string'
    ? payload.jobs[0].company_name
    : detected.slug
  return verification(detected, companyName, payload.jobs.length)
}

async function verifyLever(detected: SupportedDetection, fetchImpl: FetchLike) {
  const payload = await fetchVerificationPayload(detected, fetchImpl)
  if (!Array.isArray(payload)) throw new Error('provider_schema_invalid')
  return verification(detected, detected.slug, payload.length)
}

async function verifyAshby(detected: SupportedDetection, fetchImpl: FetchLike) {
  const payload = await fetchVerificationPayload(detected, fetchImpl) as {
    jobs?: Array<{ isListed?: unknown }>
  }
  if (!Array.isArray(payload.jobs)) throw new Error('provider_schema_invalid')
  const count = payload.jobs.filter((job) => job?.isListed === true).length
  return verification(detected, detected.slug, count)
}

function complete(jobs: PollObservation['jobs']): PollObservation {
  return {
    jobs,
    completeness: 'complete',
    credibleForClosure: true,
    pageCount: 1,
    expectedCount: jobs.length,
    warnings: [],
  }
}

export const providerRegistry = {
  greenhouse: {
    verify: verifyGreenhouse,
    poll: async (company, knownIds) => complete(
      await pollGreenhouse(company.board_token, knownIds),
    ),
  },
  lever: {
    verify: verifyLever,
    poll: async (company) => complete(
      await pollLever(company.board_token, company.region ?? undefined),
    ),
  },
  ashby: {
    verify: verifyAshby,
    poll: async (company) => complete(await pollAshby(company.board_token)),
  },
} satisfies Record<ProviderId, ProviderConnector>

export async function verifyConnector(
  detected: SupportedDetection,
  fetchImpl: FetchLike,
): Promise<ConnectorVerification> {
  return providerRegistry[detected.ats].verify(detected, fetchImpl)
}

export async function pollConnector(
  company: PollConnectorCompany,
  knownIds: Set<string>,
): Promise<PollObservation> {
  if (!(company.ats_type in providerRegistry)) {
    throw new Error(`unsupported_provider:${company.ats_type}`)
  }
  return providerRegistry[company.ats_type as ProviderId].poll(company, knownIds)
}

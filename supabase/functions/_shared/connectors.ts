import { pollAshby } from './adapters/ashby.ts'
import { pollGreenhouse } from './adapters/greenhouse.ts'
import { pollLever } from './adapters/lever.ts'
import { pollRecruitee } from './adapters/recruitee.ts'
import { pollSmartRecruiters } from './adapters/smartrecruiters.ts'
import {
  CAPITAL_ONE_WORKDAY_SOURCE_KEY,
  pollCapitalOneRecent,
  verifyWorkdayListing,
} from './adapters/workday.ts'
import { type PollObservation } from './adapters/types.ts'
import { buildEndpoint, type DetectResult } from './detect.ts'

export type ProviderId =
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'smartrecruiters'
  | 'recruitee'
  | 'workday'
export type SupportedDetection = Exclude<DetectResult, { ats: 'unsupported' }>

export interface PollConnectorCompany {
  ats_type: string
  board_token: string
  region: 'eu' | 'wd12' | null
  site_token?: string | null
  source_key?: string
  activation_state: string
}

export interface ConnectorVerification {
  ats: ProviderId
  boardToken: string
  region: 'eu' | 'wd12' | null
  siteToken: string | null
  companyName: string
  jobCount: number
  careersUrl: string
  sourceKey: string
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface ProviderConnector {
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
  if (detected.ats === 'ashby') return `https://jobs.ashbyhq.com/${slug}`
  if (detected.ats === 'smartrecruiters') {
    return `https://jobs.smartrecruiters.com/${slug}`
  }
  if (detected.ats === 'workday') {
    return 'https://capitalone.wd12.myworkdayjobs.com/Capital_One'
  }
  return `https://${detected.slug.toLowerCase()}.recruitee.com`
}

function deterministicSourceKey(detected: SupportedDetection) {
  if (detected.ats === 'workday') return CAPITAL_ONE_WORKDAY_SOURCE_KEY
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
    siteToken: detected.ats === 'workday' ? detected.site : null,
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

async function verifySmartRecruiters(
  detected: SupportedDetection,
  fetchImpl: FetchLike,
) {
  const observation = await pollSmartRecruiters(detected.slug, fetchImpl)
  if (observation.completeness !== 'complete') {
    throw new Error(observation.warnings[0] ?? 'provider_observation_failed')
  }
  const companyName = observation.jobs[0]?.companyName ?? detected.slug
  return verification(detected, companyName, observation.jobs.length)
}

async function verifyRecruitee(
  detected: SupportedDetection,
  fetchImpl: FetchLike,
) {
  const observation = await pollRecruitee(detected.slug, fetchImpl)
  if (observation.completeness !== 'complete') {
    throw new Error(observation.warnings[0] ?? 'provider_observation_failed')
  }
  return verification(detected, detected.slug, observation.jobs.length)
}

async function verifyWorkday(
  detected: SupportedDetection,
  fetchImpl: FetchLike,
) {
  if (
    detected.ats !== 'workday'
    || detected.slug !== 'capitalone'
    || detected.region !== 'wd12'
    || detected.site !== 'Capital_One'
  ) throw new Error('invalid_identity')
  const listing = await verifyWorkdayListing(fetchImpl)
  return verification(detected, 'Capital One', listing.jobCount)
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
  smartrecruiters: {
    verify: verifySmartRecruiters,
    poll: async (company) => pollSmartRecruiters(company.board_token),
  },
  recruitee: {
    verify: verifyRecruitee,
    poll: async (company) => pollRecruitee(company.board_token),
  },
  workday: {
    verify: verifyWorkday,
    poll: async (_company, knownIds) => pollCapitalOneRecent(fetch, { knownIds }),
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
  if (company.activation_state !== 'active') {
    throw new Error(`inactive_connector:${company.activation_state}`)
  }
  if (!Object.prototype.hasOwnProperty.call(providerRegistry, company.ats_type)) {
    throw new Error(`unsupported_provider:${company.ats_type}`)
  }
  if (company.ats_type === 'workday') {
    if (
      company.board_token !== 'capitalone'
      || company.region !== 'wd12'
      || company.site_token !== 'Capital_One'
      || company.source_key !== CAPITAL_ONE_WORKDAY_SOURCE_KEY
    ) throw new Error('inactive_connector:workday_identity_not_allowed')
  }
  return providerRegistry[company.ats_type as ProviderId].poll(company, knownIds)
}

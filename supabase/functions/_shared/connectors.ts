import { pollAshby } from './adapters/ashby.ts'
import { pollMorganStanleyEightfold } from './adapters/eightfold.ts'
import { pollGoldmanHigher } from './adapters/goldman-higher.ts'
import { pollGreenhouse } from './adapters/greenhouse.ts'
import { pollLever } from './adapters/lever.ts'
import { pollJpmorganOracleRecruiting } from './adapters/oracle-recruiting.ts'
import { pollPaylocity } from './adapters/paylocity.ts'
import { pollRecruitee } from './adapters/recruitee.ts'
import { pollSmartRecruiters } from './adapters/smartrecruiters.ts'
import {
  pollWorkdayRecent,
  verifyWorkdayListing,
} from './adapters/workday.ts'
import {
  resolveWorkdayIdentity,
  WORKDAY_IDENTITIES,
  type WorkdayIdentity,
} from './workday-identities.ts'
import { type PollObservation } from './adapters/types.ts'
import { buildEndpoint, type DetectResult } from './detect.ts'
import { resolvePaylocityIdentity } from './provider-identities.ts'
import {
  resolveBrandedIdentity,
  type BrandedIdentity,
} from './branded-identities.ts'

export type ProviderId =
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'paylocity'
  | 'smartrecruiters'
  | 'recruitee'
  | 'workday'
  | 'eightfold'
  | 'oracle_recruiting'
  | 'goldman_higher'
export type SupportedDetection = Exclude<DetectResult, { ats: 'unsupported' }>

export interface PollConnectorCompany {
  ats_type: string
  board_token: string
  region: string | null
  site_token?: string | null
  source_key?: string
  activation_state: string
}

export interface ConnectorVerification {
  ats: ProviderId
  boardToken: string
  region: string | null
  siteToken: string | null
  companyName: string
  jobCount: number
  careersUrl: string
  sourceKey: string
  scopeEvidence?: PollObservation['scopeEvidence']
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface ProviderConnector {
  verify: (detected: SupportedDetection, fetchImpl: FetchLike) => Promise<ConnectorVerification>
  poll: (
    company: PollConnectorCompany,
    knownIds: Set<string>,
    fetchImpl?: FetchLike,
  ) => Promise<PollObservation>
}

// Reconstruct the full frozen identity (origin/hostForm/cxsRoot) from the
// persisted source key. No hostForm DB column and no region-implies-hostForm
// inference — the source key IS the exact admitted tuple (A1 disambiguation).
function workdayIdentityForCompany(company: PollConnectorCompany): WorkdayIdentity | undefined {
  const key = company.source_key ?? ''
  return (WORKDAY_IDENTITIES as Record<string, WorkdayIdentity | undefined>)[key]
}

// Resolve the admitted identity for a detected Workday tuple; fail closed.
function workdayIdentityForDetection(detected: SupportedDetection): WorkdayIdentity {
  if (detected.ats !== 'workday') throw new Error('invalid_identity')
  const identity = resolveWorkdayIdentity(
    detected.slug,
    detected.region,
    detected.site,
    detected.hostForm,
  )
  if (!identity) throw new Error('invalid_identity')
  return identity
}

function brandedIdentityForDetection(detected: SupportedDetection): BrandedIdentity {
  if (
    detected.ats !== 'eightfold'
    && detected.ats !== 'oracle_recruiting'
    && detected.ats !== 'goldman_higher'
  ) throw new Error('invalid_identity')
  const identity = resolveBrandedIdentity(detected.slug)
  if (!identity || identity.provider !== detected.ats) throw new Error('invalid_identity')
  return identity
}

function brandedIdentityForCompany(company: PollConnectorCompany): BrandedIdentity | null {
  const identity = resolveBrandedIdentity(company.source_key ?? '')
  if (
    !identity
    || company.ats_type !== identity.provider
    || company.board_token !== identity.sourceKey
    || company.region !== null
    || company.site_token !== null
  ) return null
  return identity
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
  if (detected.ats === 'paylocity') {
    const identity = resolvePaylocityIdentity(detected.slug)
    if (!identity) throw new Error('invalid_identity')
    return identity.canonicalUrl
  }
  if (detected.ats === 'workday') {
    return workdayIdentityForDetection(detected).publicBoard
  }
  if (
    detected.ats === 'eightfold'
    || detected.ats === 'oracle_recruiting'
    || detected.ats === 'goldman_higher'
  ) {
    return brandedIdentityForDetection(detected).publicUrl
  }
  return `https://${detected.slug.toLowerCase()}.recruitee.com`
}

function deterministicSourceKey(detected: SupportedDetection) {
  if (detected.ats === 'workday') return workdayIdentityForDetection(detected).sourceKey
  if (detected.ats === 'paylocity') {
    const identity = resolvePaylocityIdentity(detected.slug)
    if (!identity) throw new Error('invalid_identity')
    return identity.sourceKey
  }
  if (
    detected.ats === 'eightfold'
    || detected.ats === 'oracle_recruiting'
    || detected.ats === 'goldman_higher'
  ) {
    return brandedIdentityForDetection(detected).sourceKey
  }
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

async function verifyPaylocity(
  detected: SupportedDetection,
  fetchImpl: FetchLike,
) {
  if (detected.ats !== 'paylocity') throw new Error('invalid_identity')
  const identity = resolvePaylocityIdentity(detected.slug)
  if (!identity) throw new Error('invalid_identity')
  const observation = await pollPaylocity(identity.boardUuid, fetchImpl)
  if (
    observation.completeness !== 'complete'
    || !observation.credibleForClosure
    || observation.warnings.length !== 0
    || observation.jobs.length === 0
    || observation.expectedCount !== observation.jobs.length
  ) {
    throw new Error(observation.warnings[0] ?? 'provider_observation_failed')
  }
  return verification(detected, identity.displayName, observation.jobs.length)
}

async function verifyWorkday(
  detected: SupportedDetection,
  fetchImpl: FetchLike,
) {
  const identity = workdayIdentityForDetection(detected)
  const listing = await verifyWorkdayListing(fetchImpl, {}, identity)
  return verification(detected, identity.companyName ?? detected.slug, listing.jobCount)
}

function requireCompleteBrandedObservation(observation: PollObservation): PollObservation {
  if (
    observation.completeness !== 'complete'
    || !observation.credibleForClosure
    || observation.warnings.length !== 0
    || observation.jobs.length === 0
    || observation.expectedCount !== observation.jobs.length
    || !observation.scopeEvidence
  ) {
    throw new Error(observation.warnings[0] ?? 'provider_observation_failed')
  }
  return observation
}

async function pollBrandedIdentity(
  identity: BrandedIdentity,
  fetchImpl: FetchLike,
): Promise<PollObservation> {
  if (identity.provider === 'eightfold') {
    return pollMorganStanleyEightfold(identity, fetchImpl)
  }
  if (identity.provider === 'oracle_recruiting') {
    return pollJpmorganOracleRecruiting(identity, fetchImpl)
  }
  return pollGoldmanHigher(identity, fetchImpl)
}

async function verifyBranded(
  detected: SupportedDetection,
  fetchImpl: FetchLike,
): Promise<ConnectorVerification> {
  const identity = brandedIdentityForDetection(detected)
  const observation = requireCompleteBrandedObservation(
    await pollBrandedIdentity(identity, fetchImpl),
  )
  return {
    ...verification(detected, identity.companyName, observation.jobs.length),
    scopeEvidence: observation.scopeEvidence,
  }
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
  paylocity: {
    verify: verifyPaylocity,
    poll: async (company) => pollPaylocity(company.board_token),
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
    poll: async (company, knownIds, fetchImpl = fetch) => {
      // The persisted source key reconstructs the full identity (origin/hostForm/
      // cxsRoot) — the CXS origin is never re-derived from region.
      const identity = workdayIdentityForCompany(company)
      if (!identity) throw new Error('invalid_identity')
      return pollWorkdayRecent(identity, fetchImpl, { knownIds })
    },
  },
  eightfold: {
    verify: verifyBranded,
    poll: async (company, _knownIds, fetchImpl = fetch) => {
      const identity = brandedIdentityForCompany(company)
      if (!identity || identity.provider !== 'eightfold') throw new Error('invalid_identity')
      return pollMorganStanleyEightfold(identity, fetchImpl)
    },
  },
  oracle_recruiting: {
    verify: verifyBranded,
    poll: async (company, _knownIds, fetchImpl = fetch) => {
      const identity = brandedIdentityForCompany(company)
      if (!identity || identity.provider !== 'oracle_recruiting') throw new Error('invalid_identity')
      return pollJpmorganOracleRecruiting(identity, fetchImpl)
    },
  },
  goldman_higher: {
    verify: verifyBranded,
    poll: async (company, _knownIds, fetchImpl = fetch) => {
      const identity = brandedIdentityForCompany(company)
      if (!identity || identity.provider !== 'goldman_higher') throw new Error('invalid_identity')
      return pollGoldmanHigher(identity, fetchImpl)
    },
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
    // Allowlist check via the registry: the persisted source key must resolve to
    // an admitted identity and its board_token/region/site must match that tuple.
    const identity = workdayIdentityForCompany(company)
    if (
      !identity
      || company.board_token !== identity.tenant
      || company.region !== identity.region
      || company.site_token !== identity.site
    ) throw new Error('inactive_connector:workday_identity_not_allowed')
  }
  if (company.ats_type === 'paylocity') {
    const identity = resolvePaylocityIdentity(company.board_token)
    if (
      !identity
      || company.source_key !== identity.sourceKey
      || company.region !== null
      || company.site_token !== null
    ) throw new Error('inactive_connector:paylocity_identity_not_allowed')
  }
  if (
    company.ats_type === 'eightfold'
    || company.ats_type === 'oracle_recruiting'
    || company.ats_type === 'goldman_higher'
  ) {
    if (!brandedIdentityForCompany(company)) {
      throw new Error('inactive_connector:branded_identity_not_allowed')
    }
  }
  return providerRegistry[company.ats_type as ProviderId].poll(company, knownIds)
}

export async function observeConnector(
  company: PollConnectorCompany,
  fetchImpl: FetchLike = fetch,
): Promise<PollObservation> {
  if (company.activation_state !== 'experimental') {
    throw new Error(`inactive_observation_connector:${company.activation_state}`)
  }
  if (company.ats_type === 'workday') {
    const identity = workdayIdentityForCompany(company)
    const phase038Candidate = identity?.requireDetailCountryProof
      || identity?.wholeSiteUsScope
      || identity?.unsupportedCountryContract
    if (
      !identity
      || !phase038Candidate
      || company.board_token !== identity.tenant
      || company.region !== identity.region
      || company.site_token !== identity.site
    ) {
      throw new Error('inactive_observation_connector:identity_not_allowed')
    }
    return providerRegistry.workday.poll(company, new Set(), fetchImpl)
  }
  const identity = brandedIdentityForCompany(company)
  if (!identity) {
    throw new Error('inactive_observation_connector:identity_not_allowed')
  }
  return providerRegistry[identity.provider].poll(company, new Set(), fetchImpl)
}

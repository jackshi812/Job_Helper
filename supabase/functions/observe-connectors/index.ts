import type { PollObservation } from '../_shared/adapters/types.ts'
import {
  DEFAULT_BRANDED_COMPANY_CONCURRENCY,
  DEFAULT_BRANDED_STOP_SCHEDULING_MS,
  BoundedPoolDeadlineError,
  runBoundedPool,
} from '../_shared/bounded-pool.ts'
import {
  observeConnector,
  type PollConnectorCompany,
} from '../_shared/connectors.ts'

const EXPERIMENTAL_CLAIM_BATCH_SIZE = 3
const SHA256_HEX = /^[a-f0-9]{64}$/

interface ExperimentalCompany extends PollConnectorCompany {
  id: string
  name: string
  source_key: string
  consecutive_failures: number
}

interface RpcResult {
  data: unknown
  error: null | { message?: string }
}

interface CompanyUpdate {
  eq: (
    column: string,
    value: unknown,
  ) => Promise<{ error: RpcResult['error'] }>
}

interface ServiceClient {
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<RpcResult>
  from: (table: 'companies') => {
    update: (value: Record<string, unknown>) => CompanyUpdate
  }
}

interface ObserveConnectorsDependencies {
  getCronSecret: () => string | undefined
  createServiceClient: () => ServiceClient
  observeCompany?: (company: ExperimentalCompany) => Promise<PollObservation>
  digestEvidence?: (value: string) => Promise<string>
  randomUUID?: () => string
}

function boundedCode(error: unknown): string {
  const value = error instanceof Error ? error.message : ''
  return /^[a-z0-9_]{1,64}$/.test(value)
    ? value
    : 'experimental_observation_failed'
}

const GOLDMAN_CATEGORY_TERMS = new Set([
  'Data',
  'Technology',
  'Finance',
  'Investment',
  'Research',
  'Risk',
  'Capital Markets',
])

async function goldmanAggregateMatchesJobs(
  observation: PollObservation,
): Promise<boolean> {
  const aggregate = observation.scopeEvidence
  if (
    aggregate?.sourceKey !== 'goldman_higher:roles'
    || !('selectionMode' in aggregate)
    || aggregate.selectionMode !== 'recent_exact_us_provider_category'
    || aggregate.recentHours !== 168
    || aggregate.sliceDigests.length !== 2
    || !aggregate.sliceDigests.every((digest) => SHA256_HEX.test(digest))
    || !SHA256_HEX.test(aggregate.jobDigest)
    || !SHA256_HEX.test(aggregate.categoryDigest)
    || !SHA256_HEX.test(aggregate.countryDigest)
    || !SHA256_HEX.test(aggregate.freshnessDigest)
    || !SHA256_HEX.test(aggregate.applicationDigest)
  ) return false

  const jobs = [...observation.jobs].sort((left, right) =>
    left.externalId.localeCompare(right.externalId)
  )
  if (!jobs.every((job) => {
    const evidence = job.scopeEvidence
    return job.source === 'goldman_higher'
      && job.postedAt !== null
      && evidence !== undefined
      && 'selectionMode' in evidence
      && evidence.sourceKey === 'goldman_higher:roles'
      && evidence.selectionMode === 'recent_exact_us_provider_category'
      && evidence.recentHours === 168
      && /^[0-9]+$/.test(evidence.providerSourceId)
      && (
        evidence.providerCategoryField === 'jobFunction'
        || evidence.providerCategoryField === 'division'
      )
      && evidence.providerCategoryLabel.length > 0
      && GOLDMAN_CATEGORY_TERMS.has(evidence.matchedTerm)
      && evidence.detailCountryCode === 'US'
      && job.postedAt === evidence.postedAt
      && (
        evidence.recruitingType === 'GS_EARLY_CAREER'
        || evidence.recruitingType === 'GS_MID_CAREER'
      )
      && SHA256_HEX.test(evidence.externalIdDigest)
  })) return false

  const digest = async (value: unknown) => sha256Hex(JSON.stringify(value))
  return aggregate.jobDigest === await digest(
    jobs.map((job) => [
      job.externalId,
      job.scopeEvidence && 'externalIdDigest' in job.scopeEvidence
        ? job.scopeEvidence.externalIdDigest
        : null,
    ]),
  )
    && aggregate.categoryDigest === await digest(
      jobs.map((job) => {
        const evidence = job.scopeEvidence!
        return [
          job.externalId,
          'providerCategoryField' in evidence
            ? evidence.providerCategoryField
            : null,
          evidence.providerCategoryLabel,
          evidence.matchedTerm,
        ]
      }),
    )
    && aggregate.countryDigest === await digest(
      jobs.map((job) => [
        job.externalId,
        job.scopeEvidence?.detailCountryCode,
      ]),
    )
    && aggregate.freshnessDigest === await digest(
      jobs.map((job) => {
        const evidence = job.scopeEvidence!
        return [
          job.externalId,
          'postedAt' in evidence ? evidence.postedAt : null,
          'recentHours' in evidence ? evidence.recentHours : null,
        ]
      }),
    )
    && aggregate.applicationDigest === await digest(
      jobs.map((job) => {
        const evidence = job.scopeEvidence!
        return [
          job.externalId,
          'providerSourceId' in evidence ? evidence.providerSourceId : null,
          job.absoluteUrl,
        ]
      }),
    )
}

async function isPositiveCompleteEvidence(
  company: ExperimentalCompany,
  observation: PollObservation,
): Promise<boolean> {
  if (company.ats_type === 'workday') {
    return observation.completeness === 'complete'
      && observation.credibleForClosure
      && observation.allowMissingClosure === false
      && observation.warnings.length === 0
      && observation.jobs.length > 0
      && observation.expectedCount === observation.jobs.length
      && observation.jobs.every((job) => {
        const evidence = job.scopeEvidence
        return job.source === 'workday'
          && evidence !== undefined
          && 'selectionMode' in evidence
          && evidence.sourceKey === company.source_key
          && evidence.detailCountryCode === 'US'
          && evidence.selectionMode === 'recent_exact_us'
          && evidence.recentDays === 7
          && evidence.titleKeywords.length <= 16
          && evidence.providerFacetLabels.length <= 16
      })
  }

  if (company.ats_type === 'goldman_higher') {
    return observation.completeness === 'complete'
      && observation.credibleForClosure
      && observation.allowMissingClosure === false
      && observation.warnings.length === 0
      && observation.jobs.length > 0
      && observation.expectedCount === observation.jobs.length
      && await goldmanAggregateMatchesJobs(observation)
  }

  const aggregate = observation.scopeEvidence
  return observation.completeness === 'complete'
    && observation.credibleForClosure
    && (
      company.ats_type !== 'oracle_recruiting'
      || observation.allowMissingClosure === false
    )
    && observation.warnings.length === 0
    && observation.jobs.length > 0
    && observation.expectedCount === observation.jobs.length
    && aggregate?.sourceKey === company.source_key
    && aggregate.sliceDigests.length > 0
    && aggregate.sliceDigests.length <= 100
    && aggregate.sliceDigests.every((digest) => SHA256_HEX.test(digest))
    && SHA256_HEX.test(aggregate.categoryDigest)
    && SHA256_HEX.test(aggregate.countryDigest)
    && observation.jobs.every((job) => (
      job.source === company.ats_type
      && job.scopeEvidence?.sourceKey === company.source_key
      && job.scopeEvidence.detailCountryCode === 'US'
      && 'externalIdDigest' in job.scopeEvidence
      && SHA256_HEX.test(job.scopeEvidence.externalIdDigest)
    ))
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')
}

function evidenceInput(
  company: ExperimentalCompany,
  observation: PollObservation,
): string {
  if (
    company.ats_type === 'goldman_higher'
    && observation.scopeEvidence
    && 'selectionMode' in observation.scopeEvidence
  ) {
    return JSON.stringify([
      company.source_key,
      observation.jobs.length,
      observation.expectedCount,
      observation.scopeEvidence.sliceDigests,
      observation.scopeEvidence.jobDigest,
      observation.scopeEvidence.categoryDigest,
      observation.scopeEvidence.countryDigest,
      observation.scopeEvidence.freshnessDigest,
      observation.scopeEvidence.applicationDigest,
    ])
  }
  return JSON.stringify([
    company.source_key,
    observation.jobs.length,
    observation.scopeEvidence?.sliceDigests,
    observation.scopeEvidence?.categoryDigest,
    observation.scopeEvidence?.countryDigest,
    observation.jobs.map((job) => {
      const evidence = job.scopeEvidence
      return evidence && 'selectionMode' in evidence
        ? [
            job.externalId,
            evidence.selectionMode,
            evidence.recentDays,
            evidence.titleKeywords,
            evidence.providerFacetLabels,
          ]
        : [
            job.externalId,
            evidence?.matchedTerm,
            evidence?.externalIdDigest,
          ]
    }),
  ])
}

async function recordObservation(
  service: ServiceClient,
  dependencies: ObserveConnectorsDependencies,
  company: ExperimentalCompany,
): Promise<void> {
  const observation = await (
    dependencies.observeCompany
      ?? ((candidate) => observeConnector(candidate))
  )(company)
  if (!(await isPositiveCompleteEvidence(company, observation))) {
    throw new Error(observation.warnings[0] ?? 'ineligible_observation')
  }

  const digest = await (
    dependencies.digestEvidence ?? sha256Hex
  )(evidenceInput(company, observation))
  if (!SHA256_HEX.test(digest)) throw new Error('invalid_evidence_digest')

  const { error } = await service.rpc('record_connector_observation', {
    p_company_id: company.id,
    p_observation_id: (
      dependencies.randomUUID ?? (() => crypto.randomUUID())
    )(),
    p_completeness: 'complete',
    p_credible_for_closure: true,
    p_job_count: observation.jobs.length,
    p_expected_count: observation.jobs.length,
    p_warning_count: 0,
    p_evidence_digest: digest,
  })
  if (error) throw new Error('observation_rpc_failed')
}

async function recordDegradedHealth(
  service: ServiceClient,
  company: ExperimentalCompany,
  reason: unknown,
): Promise<void> {
  const code = boundedCode(reason)
  const { error } = await service
    .from('companies')
    .update({
      consecutive_failures: (company.consecutive_failures ?? 0) + 1,
      last_error: code,
      last_error_code: code,
    })
    .eq('id', company.id)
  if (error) throw new Error('observation_health_update_failed')
}

function deadlineOutcomes(
  companies: readonly ExperimentalCompany[],
  error: BoundedPoolDeadlineError,
): PromiseSettledResult<void>[] {
  const outcomes = companies.map<PromiseSettledResult<void>>(() => ({
    status: 'rejected',
    reason: new Error(error.code),
  }))
  for (const settled of error.outcomes) {
    outcomes[settled.index] = settled.outcome as PromiseSettledResult<void>
  }
  return outcomes
}

export function createObserveConnectorsHandler(
  dependencies: ObserveConnectorsDependencies,
) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 })
    }

    const cronSecret = dependencies.getCronSecret()
    if (!cronSecret || request.headers.get('x-cron-secret') !== cronSecret) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
      const service = dependencies.createServiceClient()
      const { data, error } = await service.rpc(
        'claim_due_experimental_connectors',
        { batch_size: EXPERIMENTAL_CLAIM_BATCH_SIZE },
      )
      if (error) throw new Error('experimental_claim_failed')
      const companies = (data ?? []) as ExperimentalCompany[]

      let settled: PromiseSettledResult<void>[]
      try {
        settled = await runBoundedPool(
          companies,
          async (company) => recordObservation(service, dependencies, company),
          {
            concurrency: DEFAULT_BRANDED_COMPANY_CONCURRENCY,
            deadlineMs: DEFAULT_BRANDED_STOP_SCHEDULING_MS,
          },
        )
      } catch (poolError) {
        if (!(poolError instanceof BoundedPoolDeadlineError)) throw poolError
        settled = deadlineOutcomes(companies, poolError)
      }

      let recorded = 0
      let degraded = 0
      for (const [index, result] of settled.entries()) {
        if (result.status === 'fulfilled') {
          recorded += 1
          continue
        }
        degraded += 1
        try {
          await recordDegradedHealth(service, companies[index], result.reason)
        } catch {
          console.error(
            `observe-connectors health update ${companies[index].id} failed`,
          )
        }
      }

      return Response.json({
        claimed: companies.length,
        recorded,
        degraded,
      })
    } catch (error) {
      console.error('observe-connectors failed', boundedCode(error))
      return Response.json(
        { error: 'Experimental observation failed' },
        { status: 500 },
      )
    }
  }
}

type DenoRuntime = {
  env: { get: (name: string) => string | undefined }
  serve: (handler: (request: Request) => Promise<Response>) => void
}

function requiredEnvironment(runtime: DenoRuntime, name: string): string {
  const value = runtime.env.get(name)
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

async function startDenoServer(runtime: DenoRuntime): Promise<void> {
  const { createClient } = await import(
    /* @vite-ignore */ 'npm:@supabase/supabase-js@2.110.7'
  )
  runtime.serve(createObserveConnectorsHandler({
    getCronSecret: () => runtime.env.get('CRON_SECRET'),
    createServiceClient: () => createClient(
      requiredEnvironment(runtime, 'SUPABASE_URL'),
      requiredEnvironment(runtime, 'SUPABASE_SERVICE_ROLE_KEY'),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      },
    ) as unknown as ServiceClient,
  }))
}

const runtime = (
  globalThis as typeof globalThis & { Deno?: DenoRuntime }
).Deno
if (runtime) void startDenoServer(runtime)

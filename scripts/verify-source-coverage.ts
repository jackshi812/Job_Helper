import { createHmac, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { createClient, type SupabaseClient } from '../web/node_modules/@supabase/supabase-js/dist/index.mjs'

const AUTH_STAGE_HEADER = 'x-job-copilot-auth-stage'
const FETCH_COUNT_HEADER = 'x-job-copilot-provider-fetch-count'
const HANDLER_STAGES = new Set(['rejected', 'authenticated', 'verified'])
const PROBE_PREFIX = 'phase-02.1-source-probe-'
const PROBE_TTL_MS = 2 * 60 * 60 * 1_000
const CAPITAL_ONE_SOURCE_KEY = 'workday:wd12:capitalone:Capital_One'

const requiredResumeEnvironment = [
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_JWT_SECRET',
  'CRON_SECRET',
  'USER1_EMAIL',
  'SEED_PASSWORD_1',
] as const

type Provider = 'smartrecruiters' | 'recruitee' | 'workday'

interface FinanceCatalogDefinition {
  company_name: string
  careers_url: string
  provider: string
  disposition: 'experimental' | 'unsupported_with_reason'
  source_key: string | null
}

export const FINANCE_CATALOG: readonly FinanceCatalogDefinition[] = [
  { company_name: 'Morgan Stanley', careers_url: 'https://www.morganstanley.com/careers/career-opportunities-search/', provider: 'Eightfold', disposition: 'unsupported_with_reason', source_key: null },
  { company_name: 'Goldman Sachs', careers_url: 'https://higher.gs.com/roles', provider: 'Branded/custom', disposition: 'unsupported_with_reason', source_key: null },
  { company_name: 'JPMorgan Chase', careers_url: 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/requisitions', provider: 'Oracle Recruiting Cloud', disposition: 'unsupported_with_reason', source_key: null },
  { company_name: 'Bank of America', careers_url: 'https://careers.bankofamerica.com/en-us/job-search', provider: 'Branded/custom AEM', disposition: 'unsupported_with_reason', source_key: null },
  { company_name: 'Citi', careers_url: 'https://jobs.citi.com/search-jobs', provider: 'Radancy/TalentBrew', disposition: 'unsupported_with_reason', source_key: null },
  { company_name: 'BlackRock', careers_url: 'https://careers.blackrock.com/search-jobs', provider: 'Radancy/TalentBrew', disposition: 'unsupported_with_reason', source_key: null },
  { company_name: 'Wells Fargo', careers_url: 'https://www.wellsfargojobs.com/en/jobs/', provider: 'Branded/custom', disposition: 'unsupported_with_reason', source_key: null },
  { company_name: 'UBS', careers_url: 'https://jobs.ubs.com/TGnewUI/Search/Home/HomeWithPreLoad?PageType=JobDetails&partnerid=25008&siteid=5012', provider: 'Oracle Taleo', disposition: 'unsupported_with_reason', source_key: null },
  { company_name: 'Barclays', careers_url: 'https://search.jobs.barclays/en/search-jobs', provider: 'Radancy/TalentBrew', disposition: 'unsupported_with_reason', source_key: null },
  { company_name: 'Capital One', careers_url: 'https://www.capitalonecareers.com/search-jobs', provider: 'Workday', disposition: 'experimental', source_key: CAPITAL_ONE_SOURCE_KEY },
  { company_name: 'Fidelity', careers_url: 'https://jobs.fidelity.com/en/jobs/', provider: 'Branded/custom', disposition: 'unsupported_with_reason', source_key: null },
  { company_name: 'Charles Schwab', careers_url: 'https://www.schwabjobs.com/job-search-results/', provider: 'iCIMS / Radancy', disposition: 'unsupported_with_reason', source_key: null },
] as const

const connectorDefinitions = [
  {
    provider: 'smartrecruiters',
    sourceKey: 'smartrecruiters:global:smartrecruiters',
    url: 'https://jobs.smartrecruiters.com/smartrecruiters',
    windowMinutes: 10,
    finalState: 'active',
  },
  {
    provider: 'recruitee',
    sourceKey: 'recruitee:global:uturn',
    url: 'https://uturn.recruitee.com',
    windowMinutes: 10,
    finalState: 'active',
  },
  {
    provider: 'workday',
    sourceKey: CAPITAL_ONE_SOURCE_KEY,
    url: 'https://capitalone.wd12.myworkdayjobs.com/Capital_One',
    windowMinutes: 30,
    finalState: 'experimental',
  },
] as const satisfies ReadonlyArray<{
  provider: Provider
  sourceKey: string
  url: string
  windowMinutes: number
  finalState: 'active' | 'experimental'
}>

interface ProbeResult {
  ok: boolean
  label: string
}

interface ResumeEnvironment {
  url: string
  publishableKey: string
  secretKey: string
  jwtSecret: string
  cronSecret: string
  user: { email: string; password: string }
}

interface CompanyRow {
  id: string
  name: string
  ats_type: string
  board_token: string
  source_key: string
  activation_state: string
  activation_successes: number
  last_verified_at: string | null
  last_polled_at: string | null
  last_success_at: string | null
  consecutive_failures: number
  last_error_code: string | null
  created_at: string
}

interface CatalogRow extends FinanceCatalogDefinition {
  id: string
  access_evidence: string
  unsupported_reason: string | null
  verified_at: string
}

interface ObservationRow {
  observation_id: string
  company_id: string
  provider: Provider
  eligibility_window_start: string
  evidence_digest: string
}

interface ActivationResult {
  accepted: boolean
  reason: string
  progress: number | null
  window_start: string | null
  next_eligible_at: string | null
  result_activation_state: string | null
}

interface VerifyResponse {
  status: number
  stage: string | null
  fetchCount: number | null
  body: {
    ok?: boolean
    reason?: string
    code?: string | number
    message?: string
    company?: CompanyRow
    activation?: ActivationResult
    already_watched?: boolean
  }
}

class ProbeAccumulator {
  readonly failures: string[] = []

  check(condition: unknown, label: string) {
    if (condition) {
      console.log(`PASS: ${label}`)
      return
    }
    console.error(`FAIL: ${label}`)
    this.failures.push(label)
  }

  finish() {
    if (this.failures.length > 0) {
      throw new Error(`${this.failures.length} source-coverage probe(s) failed`)
    }
  }
}

function createProbeClient(url: string, key: string) {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
}

function resumeEnvironment(): ResumeEnvironment {
  for (const name of requiredResumeEnvironment) {
    if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`)
  }
  return {
    url: process.env.SUPABASE_URL!,
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY!,
    secretKey: process.env.SUPABASE_SECRET_KEY!,
    jwtSecret: process.env.SUPABASE_JWT_SECRET!,
    cronSecret: process.env.CRON_SECRET!,
    user: { email: process.env.USER1_EMAIL!, password: process.env.SEED_PASSWORD_1! },
  }
}

function base64Url(value: string | Uint8Array) {
  return Buffer.from(value).toString('base64url')
}

function expiredUserJwt(environment: ResumeEnvironment, userId: string) {
  const now = Math.floor(Date.now() / 1_000)
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = base64Url(JSON.stringify({
    aud: 'authenticated',
    exp: now - 300,
    iat: now - 600,
    iss: `${environment.url}/auth/v1`,
    role: 'authenticated',
    sub: userId,
  }))
  const signature = createHmac('sha256', environment.jwtSecret)
    .update(`${header}.${payload}`)
    .digest()
  return `${header}.${payload}.${base64Url(signature)}`
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

async function readJson(response: Response) {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) return {}
  try {
    const parsed = await response.json()
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

async function rawVerify(
  environment: ResumeEnvironment,
  bearer: string,
  url: string,
  correlationId: string,
): Promise<VerifyResponse> {
  const response = await fetch(`${environment.url}/functions/v1/verify-board`, {
    method: 'POST',
    headers: {
      apikey: environment.publishableKey,
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
      'x-job-copilot-correlation-id': correlationId,
    },
    body: JSON.stringify({ url }),
  })
  const stage = response.headers.get(AUTH_STAGE_HEADER)
  const rawFetchCount = response.headers.get(FETCH_COUNT_HEADER)
  const parsedFetchCount = rawFetchCount === null ? null : Number(rawFetchCount)
  return {
    status: response.status,
    stage,
    fetchCount: Number.isInteger(parsedFetchCount) ? parsedFetchCount : null,
    body: await readJson(response) as VerifyResponse['body'],
  }
}

async function loadCompany(admin: SupabaseClient, sourceKey: string) {
  const { data, error } = await admin
    .from('companies')
    .select('id, name, ats_type, board_token, source_key, activation_state, activation_successes, last_verified_at, last_polled_at, last_success_at, consecutive_failures, last_error_code, created_at')
    .eq('source_key', sourceKey)
    .maybeSingle()
  if (error) throw error
  return data as CompanyRow | null
}

async function loadObservations(admin: SupabaseClient, companyId: string) {
  const { data, error } = await admin
    .from('connector_observations')
    .select('observation_id, company_id, provider, eligibility_window_start, evidence_digest')
    .eq('company_id', companyId)
    .order('eligibility_window_start', { ascending: true })
  if (error) throw error
  return (data ?? []) as ObservationRow[]
}

async function mutationBaseline(admin: SupabaseClient) {
  const [{ data: companies, error: companiesError }, observations, jobs] = await Promise.all([
    admin.from('companies').select('id, source_key, activation_state, activation_successes, last_verified_at, last_polled_at, consecutive_failures, last_error_code').order('id'),
    admin.from('connector_observations').select('*', { count: 'exact', head: true }),
    admin.from('jobs').select('*', { count: 'exact', head: true }),
  ])
  if (companiesError) throw companiesError
  if (observations.error) throw observations.error
  if (jobs.error) throw jobs.error
  return stableJson({ companies, observationCount: observations.count ?? 0, jobCount: jobs.count ?? 0 })
}

async function verifyAuthorizationMatrix(
  environment: ResumeEnvironment,
  admin: SupabaseClient,
  accessToken: string,
  userId: string,
  probes: ProbeAccumulator,
) {
  const safeUrl = 'https://boards.greenhouse.io/stripe'
  const baseline = await mutationBaseline(admin)
  const cases = [
    { name: 'anon-key', token: environment.publishableKey, expected: 'handler' },
    { name: 'service-role', token: environment.secretKey, expected: 'handler' },
    { name: 'malformed', token: `malformed.${randomUUID()}.token`, expected: 'gateway' },
    { name: 'expired', token: expiredUserJwt(environment, userId), expected: 'gateway' },
  ] as const

  for (const invalid of cases) {
    const correlationId = `phase-02.1-auth-${invalid.name}-${randomUUID()}`
    const result = await rawVerify(environment, invalid.token, safeUrl, correlationId)
    probes.check(result.status === 401 || result.status === 403, `authorization ${invalid.name}: HTTP 401/403`)
    if (invalid.expected === 'handler') {
      probes.check(
        result.stage === 'rejected' && result.fetchCount === 0,
        `authorization ${invalid.name}: handler rejected before provider fetch`,
      )
    } else {
      probes.check(
        result.stage === null &&
          result.fetchCount === null &&
          !HANDLER_STAGES.has(result.stage ?? '') &&
          (result.body.code !== undefined || typeof result.body.message === 'string'),
        `authorization ${invalid.name}: gateway rejected without handler-entry headers`,
      )
    }
    probes.check(
      await mutationBaseline(admin) === baseline,
      `authorization ${invalid.name}: RPC/ledger/company/job baselines unchanged`,
    )
  }

  const positive = await rawVerify(
    environment,
    accessToken,
    safeUrl,
    `phase-02.1-auth-user-${randomUUID()}`,
  )
  probes.check(
    (positive.status === 200 || positive.status === 409) &&
      positive.stage === 'verified' &&
      positive.fetchCount === 1 &&
      (
        (positive.body.ok === true && positive.body.company?.source_key === 'greenhouse:global:stripe') ||
        (positive.body.ok === false && positive.body.reason === 'already_watched')
      ),
    'authorization real user: exactly one controlled provider fetch reaches verified stage',
  )
}

async function verifyCatalogMatrix(admin: SupabaseClient, probes: ProbeAccumulator) {
  const { data, error } = await admin
    .from('source_coverage_catalog')
    .select('id, company_name, careers_url, provider, access_evidence, disposition, verified_at, unsupported_reason, source_key')
    .in('company_name', FINANCE_CATALOG.map((entry) => entry.company_name))
  if (error) throw error
  const catalog = (data ?? []) as CatalogRow[]
  probes.check(catalog.length === FINANCE_CATALOG.length, 'catalog matrix: all twelve finance companies exist')
  for (const expected of FINANCE_CATALOG) {
    const actual = catalog.find((entry) => entry.company_name === expected.company_name)
    probes.check(
      Boolean(actual) &&
        actual!.careers_url === expected.careers_url &&
        actual!.provider === expected.provider &&
        actual!.disposition === expected.disposition &&
        actual!.source_key === expected.source_key &&
        Boolean(actual!.access_evidence) &&
        (expected.disposition === 'experimental'
          ? actual!.unsupported_reason === null
          : Boolean(actual!.unsupported_reason)),
      `catalog matrix: ${expected.company_name} canonical evidence is exact`,
    )
  }

  const unsupportedSourceKeys = catalog
    .filter((entry) => entry.disposition === 'unsupported_with_reason')
    .map((entry) => entry.source_key)
  probes.check(
    unsupportedSourceKeys.every((sourceKey) => sourceKey === null),
    'catalog matrix: unsupported rows have no claimable source key',
  )
  return catalog
}

async function cleanStaleProbes(admin: SupabaseClient, probes: ProbeAccumulator) {
  const cutoff = new Date(Date.now() - PROBE_TTL_MS).toISOString()
  const { data: staleCompanies, error } = await admin
    .from('companies')
    .select('id, source_key, created_at')
    .like('source_key', `recruitee:global:${PROBE_PREFIX}%`)
    .lt('created_at', cutoff)
  if (error) throw error
  const ids = (staleCompanies ?? []).map((row) => row.id)
  if (ids.length > 0) {
    const { error: staleJobError } = await admin
      .from('jobs')
      .delete()
      .in('company_id', ids)
      .like('external_id', `${PROBE_PREFIX}%`)
    if (staleJobError) throw staleJobError
    const { error: staleCompanyError } = await admin
      .from('companies')
      .delete()
      .in('id', ids)
      .like('source_key', `recruitee:global:${PROBE_PREFIX}%`)
      .lt('created_at', cutoff)
    if (staleCompanyError) throw staleCompanyError
  }
  probes.check(true, `stale cleanup: exact-prefix probes older than two hours removed (${ids.length})`)
}

function nextWindowFromObservations(observations: ObservationRow[], minutes: number) {
  const last = observations.at(-1)
  if (!last) return null
  return new Date(new Date(last.eligibility_window_start).getTime() + minutes * 60_000)
}

async function invokeConnector(
  environment: ResumeEnvironment,
  accessToken: string,
  definition: typeof connectorDefinitions[number],
) {
  return rawVerify(
    environment,
    accessToken,
    definition.url,
    `phase-02.1-${definition.provider}-${randomUUID()}`,
  )
}

async function stageSmartRecruitersFallback(admin: SupabaseClient) {
  const companyName = 'SmartRecruiters (platform representative)'
  const { data: before, error: beforeError } = await admin
    .from('source_coverage_catalog')
    .select('*')
    .eq('company_name', companyName)
    .maybeSingle()
  if (beforeError) throw beforeError
  const row = {
    company_name: companyName,
    careers_url: 'https://jobs.smartrecruiters.com/smartrecruiters',
    provider: 'SmartRecruiters',
    access_evidence: 'Hosted verification found anonymous provider access unavailable or prohibited; no bypass was attempted.',
    disposition: 'unsupported_with_reason',
    verified_at: new Date().toISOString().slice(0, 10),
    unsupported_reason: 'Anonymous provider access unavailable',
    source_key: null,
  }
  const { data: staged, error: stageError } = await admin
    .from('source_coverage_catalog')
    .upsert(row, { onConflict: 'company_name' })
    .select('*')
    .single()
  if (stageError) throw stageError
  return {
    staged: staged as CatalogRow,
    async restore() {
      if (before) {
        const { error } = await admin.from('source_coverage_catalog').upsert(before, { onConflict: 'company_name' })
        if (error) throw error
      } else {
        const { error } = await admin.from('source_coverage_catalog').delete().eq('id', staged.id)
        if (error) throw error
      }
    },
  }
}

async function activationConsistency(
  admin: SupabaseClient,
  definition: typeof connectorDefinitions[number],
  probes: ProbeAccumulator,
) {
  const company = await loadCompany(admin, definition.sourceKey)
  if (!company) return { company: null, observations: [] as ObservationRow[] }
  const observations = await loadObservations(admin, company.id)
  const mapperProgress = Math.min(3, Math.max(0, company.activation_successes))
  probes.check(
    observations.length === company.activation_successes && mapperProgress === observations.length,
    `${definition.provider}: ledger, company, RPC-visible, and Watchlist mapper progress agree`,
  )
  probes.check(
    new Set(observations.map((entry) => entry.eligibility_window_start)).size === observations.length,
    `${definition.provider}: every accepted observation has a distinct server window`,
  )
  if (company.activation_successes === 3) {
    probes.check(
      company.activation_state === definition.finalState,
      `${definition.provider}: terminal activation state remains ${definition.finalState}`,
    )
  }
  return { company, observations }
}

async function activationRpc(
  admin: SupabaseClient,
  companyId: string,
  observationId: string = randomUUID(),
  digest = 'phase02_1_hosted_evidence_digest',
) {
  const startedAt = Date.now()
  const { data, error } = await admin.rpc('record_connector_observation', {
    p_company_id: companyId,
    p_observation_id: observationId,
    p_completeness: 'complete',
    p_credible_for_closure: true,
    p_job_count: 1,
    p_expected_count: 1,
    p_warning_count: 0,
    p_evidence_digest: digest,
  })
  if (error) throw error
  const row = (Array.isArray(data) ? data[0] : data) as ActivationResult
  return { row, elapsedMs: Date.now() - startedAt }
}

async function verifyReplayAndContention(
  admin: SupabaseClient,
  company: CompanyRow,
  observations: ObservationRow[],
  probes: ProbeAccumulator,
) {
  const accepted = observations.at(-1)
  if (!accepted) return
  const before = stableJson({ company, count: observations.length })
  const replay = await activationRpc(admin, company.id, accepted.observation_id, accepted.evidence_digest)
  probes.check(
    !replay.row.accepted && ['replay', 'same_window', 'progress_complete'].includes(replay.row.reason),
    `${company.ats_type}: accepted observation replay is rejected`,
  )

  const concurrent = await Promise.all([
    activationRpc(admin, company.id),
    activationRpc(admin, company.id),
  ])
  probes.check(
    concurrent.every((result) => result.elapsedMs < 3_000) &&
      concurrent.every((result) => !result.row.accepted || result.row.reason === 'accepted') &&
      concurrent.filter((result) => result.row.accepted).length <= 1,
    `${company.ats_type}: concurrent calls terminate within lock budget with at most one acceptance`,
  )
  const afterCompany = await loadCompany(admin, company.source_key)
  const afterObservations = await loadObservations(admin, company.id)
  probes.check(
    before === stableJson({ company: afterCompany, count: afterObservations.length }) ||
      afterObservations.length === observations.length + 1,
    `${company.ats_type}: replay/contention preserves atomic progress`,
  )
}

async function verifyWorkdayCap(
  admin: SupabaseClient,
  company: CompanyRow,
  observations: ObservationRow[],
  probes: ProbeAccumulator,
) {
  if (company.activation_successes !== 3 || observations.length !== 3) return false
  const nextDistinctWindow = nextWindowFromObservations(observations, 30)
  if (!nextDistinctWindow || Date.now() < nextDistinctWindow.getTime()) return false
  const jobCount = await admin
    .from('jobs')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', company.id)
    .eq('source', 'workday')
  if (jobCount.error) throw jobCount.error
  const before = stableJson({ company, observations, jobs: jobCount.count ?? 0 })
  const fourth = await activationRpc(admin, company.id)
  probes.check(
    !fourth.row.accepted && fourth.row.reason === 'progress_complete' && fourth.row.progress === 3,
    'workday: fourth distinct server-window call is rejected at progress three',
  )
  const afterCompany = await loadCompany(admin, CAPITAL_ONE_SOURCE_KEY)
  const afterObservations = await loadObservations(admin, company.id)
  const afterJobs = await admin
    .from('jobs')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', company.id)
    .eq('source', 'workday')
  if (afterJobs.error) throw afterJobs.error
  probes.check(
    before === stableJson({ company: afterCompany, observations: afterObservations, jobs: afterJobs.count ?? 0 }) &&
      afterCompany?.activation_state === 'experimental',
    'workday: fourth window changes no ledger/company/UI/last-verified/job state',
  )
  return true
}

async function proveWorkdayUnclaimable(
  admin: SupabaseClient,
  workdayCompanyId: string,
  probes: ProbeAccumulator,
) {
  const { data: baseline, error: baselineError } = await admin
    .from('companies')
    .select('id, last_polled_at')
  if (baselineError) throw baselineError
  const baselineById = new Map((baseline ?? []).map((row) => [row.id, row.last_polled_at]))
  let claimed: Array<{ id: string; last_polled_at: string | null }> = []
  try {
    const result = await admin.rpc('claim_due_companies', { batch_size: 100 })
    if (result.error) throw result.error
    claimed = (result.data ?? []) as typeof claimed
    probes.check(
      !claimed.some((entry) => entry.id === workdayCompanyId),
      'workday: service-role claim RPC cannot claim Experimental Capital One',
    )
  } finally {
    // claim_due_companies necessarily advances returned rows. Restore only the
    // exact value this invocation wrote; if cron has already advanced a row
    // again, the equality guard preserves that newer concurrent timestamp.
    for (const row of claimed) {
      const previous = baselineById.get(row.id)
      if (previous === undefined) continue
      let restore = admin.from('companies').update({ last_polled_at: previous }).eq('id', row.id)
      if (row.last_polled_at === null) restore = restore.is('last_polled_at', null)
      else restore = restore.eq('last_polled_at', row.last_polled_at)
      const { error } = await restore
      if (error) throw error
    }
  }
}

async function controlledFailureProbe(
  environment: ResumeEnvironment,
  admin: SupabaseClient,
  probes: ProbeAccumulator,
) {
  const marker = `${PROBE_PREFIX}${Date.now()}-${randomUUID()}`
  let companyId: string | null = null
  const { data: heartbeatBefore, error: heartbeatBeforeError } = await admin
    .from('pipeline_heartbeat')
    .select('last_tick_at, last_success_at')
    .eq('id', true)
    .single()
  if (heartbeatBeforeError) throw heartbeatBeforeError
  try {
    const { data: company, error: companyError } = await admin
      .from('companies')
      .insert({
        name: marker,
        ats_type: 'recruitee',
        board_token: marker,
        region: null,
        careers_url: `https://${marker}.recruitee.com`,
        source_key: `recruitee:global:${marker}`,
        activation_state: 'active',
        last_polled_at: null,
        last_success_at: null,
      })
      .select('id, consecutive_failures, last_success_at')
      .single()
    if (companyError) throw companyError
    companyId = company.id
    const sentinelExternalId = `${PROBE_PREFIX}${randomUUID()}`
    const { error: sentinelError } = await admin.from('jobs').insert({
      company_id: companyId,
      source: 'recruitee',
      external_id: sentinelExternalId,
      title: 'Phase 02.1 closure sentinel',
      absolute_url: 'https://example.invalid/phase-02-1-sentinel',
      fingerprint: `${PROBE_PREFIX}${randomUUID()}`,
      status: 'open',
    })
    if (sentinelError) throw sentinelError
    const { error: dueError } = await admin.from('companies').update({ last_polled_at: null }).eq('id', companyId)
    if (dueError) throw dueError

    const response = await fetch(`${environment.url}/functions/v1/poll-tick`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cron-secret': environment.cronSecret },
      body: '{}',
    })
    if (!response.ok) throw new Error(`controlled poll-tick returned HTTP ${response.status}`)
    const { data: after, error: afterError } = await admin
      .from('companies')
      .select('last_polled_at, last_success_at, consecutive_failures, last_error_code')
      .eq('id', companyId)
      .single()
    if (afterError) throw afterError
    const { data: sentinel, error: sentinelReadError } = await admin
      .from('jobs')
      .select('status')
      .eq('company_id', companyId)
      .eq('external_id', sentinelExternalId)
      .single()
    if (sentinelReadError) throw sentinelReadError
    probes.check(
      Boolean(after.last_polled_at) &&
        after.consecutive_failures > company.consecutive_failures &&
        after.last_success_at === company.last_success_at &&
        Boolean(after.last_error_code),
      'controlled failure: direct invocation or live cron records bounded degradation',
    )
    probes.check(sentinel.status === 'open', 'controlled failure: sentinel remains open and closure is skipped')
  } finally {
    if (companyId) {
      await admin.from('jobs').delete().eq('company_id', companyId).like('external_id', `${PROBE_PREFIX}%`)
      await admin.from('companies').delete().eq('id', companyId).like('source_key', `recruitee:global:${PROBE_PREFIX}%`)
    }
  }

  const healthy = await fetch(`${environment.url}/functions/v1/poll-tick`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cron-secret': environment.cronSecret },
    body: '{}',
  })
  probes.check(healthy.ok, 'controlled failure: healthy recovery tick is accepted after fixture removal')
  const { data: heartbeatAfter, error: heartbeatAfterError } = await admin
    .from('pipeline_heartbeat')
    .select('last_tick_at, last_success_at')
    .eq('id', true)
    .single()
  if (heartbeatAfterError) throw heartbeatAfterError
  probes.check(
    new Date(heartbeatAfter.last_tick_at).getTime() >= new Date(heartbeatBefore.last_tick_at).getTime() &&
      Boolean(heartbeatAfter.last_success_at) &&
      (
        !heartbeatBefore.last_success_at ||
        new Date(heartbeatAfter.last_success_at).getTime() >=
          new Date(heartbeatBefore.last_success_at).getTime()
      ),
    'controlled failure: heartbeat recovers without overwriting a newer concurrent value',
  )
  const { count: orphanCompanies, error: orphanCompanyError } = await admin
    .from('companies')
    .select('*', { count: 'exact', head: true })
    .like('source_key', `recruitee:global:${PROBE_PREFIX}%`)
  if (orphanCompanyError) throw orphanCompanyError
  const { count: orphanJobs, error: orphanJobError } = await admin
    .from('jobs')
    .select('*', { count: 'exact', head: true })
    .like('external_id', `${PROBE_PREFIX}%`)
  if (orphanJobError) throw orphanJobError
  probes.check((orphanCompanies ?? 0) === 0 && (orphanJobs ?? 0) === 0, 'controlled failure: no marked fixtures remain')
}

async function dryRun() {
  const probes = new ProbeAccumulator()
  probes.check(FINANCE_CATALOG.length === 12, 'dry-run: finance matrix has exactly twelve companies')
  probes.check(
    new Set(FINANCE_CATALOG.map((entry) => entry.company_name)).size === 12,
    'dry-run: finance company names are unique',
  )
  for (const entry of FINANCE_CATALOG) {
    const url = new URL(entry.careers_url)
    probes.check(
      url.protocol === 'https:' && !url.username && !url.password,
      `dry-run: ${entry.company_name} has a safe canonical HTTPS URL`,
    )
    probes.check(
      (entry.disposition === 'experimental' && entry.source_key === CAPITAL_ONE_SOURCE_KEY) ||
        (entry.disposition === 'unsupported_with_reason' && entry.source_key === null),
      `dry-run: ${entry.company_name} disposition cannot become claimable`,
    )
  }
  probes.check(
    connectorDefinitions.length === 3 &&
      connectorDefinitions.every((entry) => [10, 30].includes(entry.windowMinutes)) &&
      connectorDefinitions.find((entry) => entry.provider === 'workday')?.finalState === 'experimental',
    'dry-run: activation probes define bounded public and Workday windows',
  )
  probes.check(
    PROBE_PREFIX.startsWith('phase-02.1-') && PROBE_TTL_MS === 7_200_000,
    'dry-run: disposable fixture cleanup is exact-prefix and two-hour bounded',
  )

  const [watchlistSource, pipelineSource, activationSql, workdaySql, catalogSql, mapperSource, connectorsSource] = await Promise.all([
    readFile(new URL('./verify-watchlist.ts', import.meta.url), 'utf8'),
    readFile(new URL('./verify-pipeline.ts', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/0015_activation_windows.sql', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/0016_workday_experimental.sql', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/0013_source_coverage_catalog.sql', import.meta.url), 'utf8'),
    readFile(new URL('../web/src/lib/watchlist.ts', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/functions/_shared/connectors.ts', import.meta.url), 'utf8'),
  ])
  probes.check(
    ![...watchlistSource.matchAll(/(?:clientA|clientB)\s*\.from\('companies'\)\s*\.(?:insert|update)/g)].length &&
      ![...pipelineSource.matchAll(/userClient\s*\.from\('companies'\)\s*\.(?:insert|update)/g)].length,
    'dry-run: authenticated legacy clients contain no company insert/update/restore path',
  )
  probes.check(
    watchlistSource.includes('disposableAdmin') && watchlistSource.includes('phase-02.1-watchlist-probe-') &&
      pipelineSource.includes('verified.company.id'),
    'dry-run: legacy verifiers use scoped disposable ownership and verify-board persisted seeds',
  )
  probes.check(
    activationSql.includes("set local lock_timeout = '500ms'") &&
      activationSql.includes("v_persisted_progress >= 3") &&
      !/p_(?:observed_at|window_start|timestamp)/.test(activationSql),
    'dry-run: activation RPC is server-time, contention-bounded, and capped before insert',
  )
  probes.check(
    workdaySql.includes("ats_type in ('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'recruitee')") &&
      workdaySql.includes(CAPITAL_ONE_SOURCE_KEY),
    'dry-run: Workday remains outside scheduled claims with exact identity',
  )
  probes.check(
    !connectorsSource.toLowerCase().includes('successfactors') &&
      !workdaySql.toLowerCase().includes('successfactors') &&
      !activationSql.toLowerCase().includes('successfactors'),
    'dry-run: SuccessFactors remains documentation-only and absent from dispatch/claims',
  )
  probes.check(
    FINANCE_CATALOG.every((entry) => catalogSql.includes(`'${entry.company_name.replaceAll("'", "''")}'`)),
    'dry-run: script matrix matches all twelve migration seeds',
  )
  probes.check(
    mapperSource.includes('Math.min(3, Math.max(0, company.activation_successes))') &&
      mapperSource.includes('monitored: false'),
    'dry-run: Watchlist mapper consumes bounded company progress and keeps catalog-only rows unmonitored',
  )
  probes.finish()
  console.log('COMPLETE mode=dry-run network_calls=0 database_calls=0')
}

async function resume() {
  const environment = resumeEnvironment()
  const probes = new ProbeAccumulator()
  const admin = createProbeClient(environment.url, environment.secretKey)
  const user = createProbeClient(environment.url, environment.publishableKey)
  const { data: auth, error: authError } = await user.auth.signInWithPassword(environment.user)
  if (authError || !auth.user || !auth.session?.access_token) {
    throw authError ?? new Error('Real-user authentication failed')
  }

  let smartRecruitersFallback: Awaited<ReturnType<typeof stageSmartRecruitersFallback>> | null = null
  let retainSmartRecruitersFallback = false
  let smartRecruitersUnsupported = false
  const pending: Array<{ provider: Provider; next_eligible_at: string }> = []
  try {
    await cleanStaleProbes(admin, probes)
    await verifyCatalogMatrix(admin, probes)
    await verifyAuthorizationMatrix(
      environment,
      admin,
      auth.session.access_token,
      auth.user.id,
      probes,
    )

    for (const definition of connectorDefinitions) {
      const before = await activationConsistency(admin, definition, probes)
      if (before.company?.activation_successes === 3) continue
      const nextWindow = nextWindowFromObservations(before.observations, definition.windowMinutes)
      if (nextWindow && Date.now() < nextWindow.getTime()) {
        pending.push({ provider: definition.provider, next_eligible_at: nextWindow.toISOString() })
        continue
      }

      const response = await invokeConnector(environment, auth.session.access_token, definition)
      if (!response.body.ok) {
        if (definition.provider === 'smartrecruiters') {
          smartRecruitersFallback = await stageSmartRecruitersFallback(admin)
          const staged = smartRecruitersFallback.staged
          const company = await loadCompany(admin, definition.sourceKey)
          probes.check(
            staged.disposition === 'unsupported_with_reason' &&
              staged.source_key === null &&
              company === null,
            'smartrecruiters fallback: bounded catalog evidence is unclaimable and Not monitored',
          )
          smartRecruitersUnsupported = true
          continue
        }
        if (definition.provider === 'recruitee') {
          console.log('DECISION_REQUIRED provider=recruitee representative=uturn options=replacement|unsupported')
          throw new Error('Pinned UTURN Recruitee representative is unavailable; explicit D-04 decision required')
        }
        throw new Error(`${definition.provider} verification failed`)
      }
      probes.check(
        response.stage === 'verified' && (response.fetchCount ?? 0) > 0,
        `${definition.provider}: real-user verify-board reached the provider wrapper`,
      )
      const after = await activationConsistency(admin, definition, probes)
      probes.check(
        Boolean(after.company) && after.company!.activation_successes <= 3,
        `${definition.provider}: at most one current server window was persisted`,
      )
      if (response.body.activation?.next_eligible_at && after.company!.activation_successes < 3) {
        pending.push({
          provider: definition.provider,
          next_eligible_at: response.body.activation.next_eligible_at,
        })
      }
      if (after.company && after.observations.length > 0) {
        await verifyReplayAndContention(admin, after.company, after.observations, probes)
      }
    }

    const workday = await activationConsistency(admin, connectorDefinitions[2], probes)
    let workdayCapVerified = false
    if (workday.company) {
      const workdayJobs = await admin
        .from('jobs')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', workday.company.id)
        .eq('source', 'workday')
      if (workdayJobs.error) throw workdayJobs.error
      await proveWorkdayUnclaimable(admin, workday.company.id, probes)
      probes.check(
        workday.company.activation_state === 'experimental' &&
          (workdayJobs.count ?? 0) === 0,
        'workday: Capital One remains Experimental, unclaimable, and has zero Workday jobs',
      )
      workdayCapVerified = await verifyWorkdayCap(admin, workday.company, workday.observations, probes)
      if (workday.company.activation_successes === 3 && !workdayCapVerified) {
        const next = nextWindowFromObservations(workday.observations, 30)
        if (next) pending.push({ provider: 'workday', next_eligible_at: next.toISOString() })
      }
    }

    const connectorStates = await Promise.all(
      connectorDefinitions.map((definition) => activationConsistency(admin, definition, probes)),
    )
    const publicComplete = connectorStates
      .filter((state, index) => connectorDefinitions[index].provider !== 'workday')
      .every((state, index) =>
        state.company?.activation_successes === 3 ||
        (connectorDefinitions[index].provider === 'smartrecruiters' && smartRecruitersUnsupported),
      )
    const workdayComplete = workday.company?.activation_successes === 3 && workdayCapVerified

    if (publicComplete && workdayComplete) {
      await controlledFailureProbe(environment, admin, probes)
      retainSmartRecruitersFallback = true
      probes.finish()
      console.log('COMPLETE mode=resume connectors=verified idempotent=true')
      return
    }

    probes.finish()
    const next = pending
      .sort((left, right) => left.next_eligible_at.localeCompare(right.next_eligible_at))[0]
    console.log(
      next
        ? `PENDING provider=${next.provider} next_eligible_at=${next.next_eligible_at}`
        : 'PENDING next_eligible_at=unknown',
    )
  } finally {
    if (smartRecruitersFallback && !retainSmartRecruitersFallback) {
      await smartRecruitersFallback.restore()
    }
    await user.auth.signOut()
  }
}

export async function run(argv = process.argv.slice(2)) {
  const dryRunRequested = argv.includes('--dry-run')
  const resumeRequested = argv.includes('--resume')
  if (dryRunRequested === resumeRequested) {
    throw new Error('Choose exactly one mode: --dry-run or --resume')
  }
  if (dryRunRequested) return dryRun()
  return resume()
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  try {
    await run()
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Source coverage verification failed')
    process.exitCode = 1
  }
}

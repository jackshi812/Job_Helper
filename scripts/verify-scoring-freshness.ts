import { pathToFileURL } from 'node:url'
import { createClient } from '../web/node_modules/@supabase/supabase-js/dist/index.mjs'

const SCORE_CRON_NAME = 'score-tick-every-minute'
const FIXTURE_TTL_SECONDS = 120
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CRON_FIELDS = [
  'jobid',
  'jobname',
  'schedule',
  'command',
  'nodename',
  'nodeport',
  'database',
  'username',
  'active',
] as const

export const FAILURE_INJECTION_STAGES = Object.freeze([
  'validate_environment',
  'snapshot_cron',
  'pause_cron',
  'read_paused_cron',
  'prove_quiescent',
  'preseed_current_pairs',
  'snapshot_data',
  'create_fixtures',
  'begin_latch',
  'signal_preferences',
  'protect_nonfixtures',
  'inject_late_job',
  'inject_late_preference',
  'inject_late_reroute',
  'prove_authenticated_write_denial',
  'claim_no_id',
  'claim_mismatched_id',
  'snapshot_usage',
  'invoke_tick',
  'assert_outcomes',
  'end_latch',
  'restore_data',
  'delete_tracked_fixtures',
  'assert_zero_residue',
  'restore_cron',
  'read_restored_cron',
])

interface CronSnapshot {
  jobid: number
  jobname: string
  schedule: string
  command: string
  nodename: string
  nodeport: number
  database: string
  username: string
  active: boolean
}

interface LatchState {
  runId: string
  fixtureIds: readonly string[]
  expiresAt: number
}

interface FreshnessAdapters {
  makeRunId(): string
  makeMismatchedRunId(): string
  validateEnvironment(): Promise<void>
  snapshotCron(): Promise<CronSnapshot>
  pauseCron(snapshot: CronSnapshot): Promise<void>
  readCron(): Promise<CronSnapshot>
  proveQuiescent(): Promise<void>
  preseedCurrentPairs(): Promise<string[]>
  snapshotData(): Promise<unknown>
  createFixtures(): Promise<string[]>
  beginLatch(
    runId: string,
    fixtureIds: readonly string[],
    ttlSeconds: number,
  ): Promise<{ runId: string; expiresAt: string }>
  signalPreferences(): Promise<void>
  protectNonfixtures(fixtureIds: readonly string[]): Promise<void>
  injectLateJob(): Promise<void>
  injectLatePreferenceSignal(): Promise<void>
  injectLateReroute(): Promise<void>
  proveAuthenticatedWritesDenied(fixtureId: string): Promise<void>
  claim(runId: string | null): Promise<unknown[]>
  snapshotUsage(): Promise<unknown>
  invokeTick(runId: string): Promise<Record<string, unknown>>
  assertOutcomes(
    fixtureIds: readonly string[],
    tickResponse: Record<string, unknown>,
    usageSnapshot: unknown,
  ): Promise<void>
  endLatch(runId: string): Promise<boolean>
  restoreData(snapshot: unknown): Promise<void>
  deleteTrackedFixtures(seedIds: readonly string[], fixtureIds: readonly string[]): Promise<void>
  assertZeroResidue(): Promise<void>
  restoreCron(snapshot: CronSnapshot): Promise<void>
  readRestoredCron(): Promise<CronSnapshot>
}

interface FreshnessResult {
  runId: string
  fixtureUserJobIds: string[]
  tickInvocations: 1
  noIdClaimed: 0
  mismatchedIdClaimed: 0
}

interface PaginatedRows<T> {
  rows: T[]
  count: number | null
}

const SNAPSHOT_PAGE_SIZE = 1_000

export async function collectPaginatedRows<T>(
  fetchPage: (from: number, to: number) => Promise<PaginatedRows<T>>,
  pageSize = SNAPSHOT_PAGE_SIZE,
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error('snapshot page size must be a positive integer')
  }

  const first = await fetchPage(0, pageSize - 1)
  if (!Number.isInteger(first.count) || (first.count ?? -1) < 0) {
    throw new Error('paginated snapshot count is unavailable')
  }
  const total = first.count as number
  const expectedFirstLength = Math.min(pageSize, total)
  if (first.rows.length !== expectedFirstLength) {
    throw new Error('paginated snapshot first page was truncated')
  }

  const rows = [...first.rows]
  const pageCount = Math.ceil(total / pageSize)
  for (let page = 1; page < pageCount; page += 1) {
    const from = page * pageSize
    const to = Math.min(from + pageSize - 1, total - 1)
    const next = await fetchPage(from, to)
    if (next.count !== total) throw new Error('paginated snapshot count changed during read')
    if (next.rows.length !== to - from + 1) {
      throw new Error(`paginated snapshot page ${page + 1} was truncated`)
    }
    rows.push(...next.rows)
  }

  if (rows.length !== total) throw new Error('paginated snapshot was incomplete')
  return rows
}

export function claimForLatch(
  latch: LatchState | null,
  runId: string | null,
  now: number,
): string[] {
  if (!latch || latch.expiresAt <= now || runId !== latch.runId) return []
  return [...latch.fixtureIds]
}

function exactIds(actual: unknown, expected: readonly string[], label: string) {
  if (!Array.isArray(actual) || actual.some((value) => typeof value !== 'string')) {
    throw new Error(`${label} did not return a bounded id array`)
  }
  const left = [...actual].sort()
  const right = [...expected].sort()
  if (left.length !== right.length || left.some((value, index) => value !== right[index])) {
    throw new Error(`${label} returned an unexpected claim set`)
  }
}

function assertCronPaused(actual: CronSnapshot, snapshot: CronSnapshot) {
  for (const field of CRON_FIELDS) {
    const expected = field === 'active' ? false : snapshot[field]
    if (actual[field] !== expected) throw new Error(`score cron pause mismatch: ${field}`)
  }
}

function assertCronRestored(actual: CronSnapshot, snapshot: CronSnapshot) {
  for (const field of CRON_FIELDS) {
    if (actual[field] !== snapshot[field]) throw new Error(`score cron restoration mismatch: ${field}`)
  }
}

function cleanupFailure(primary: unknown, cleanupErrors: unknown[]) {
  const messages = cleanupErrors.map((error) =>
    error instanceof Error ? error.message : String(error),
  )
  if (primary) {
    const message = primary instanceof Error ? primary.message : String(primary)
    return new Error(messages.length > 0 ? `${message}; cleanup failed: ${messages.join('; ')}` : message)
  }
  return new Error(`cleanup failed: ${messages.join('; ')}`)
}

export async function runFreshnessVerification(
  adapters: FreshnessAdapters,
): Promise<FreshnessResult> {
  let cronSnapshot: CronSnapshot | null = null
  let cronRestoreRequired = false
  let dataSnapshot: unknown = null
  let runId: string | null = null
  let latchEndRequired = false
  let seedIds: string[] = []
  let fixtureIds: string[] = []
  let primaryError: unknown = null
  let result: FreshnessResult | null = null

  try {
    await adapters.validateEnvironment()
    cronSnapshot = await adapters.snapshotCron()
    cronRestoreRequired = true
    await adapters.pauseCron(cronSnapshot)
    assertCronPaused(await adapters.readCron(), cronSnapshot)
    await adapters.proveQuiescent()

    seedIds = await adapters.preseedCurrentPairs()
    dataSnapshot = await adapters.snapshotData()
    fixtureIds = await adapters.createFixtures()
    if (fixtureIds.length !== 2 || new Set(fixtureIds).size !== 2) {
      throw new Error('verifier must create exactly two distinct fixture user_jobs')
    }
    if (!fixtureIds.every((id) => UUID_PATTERN.test(id))) {
      throw new Error('fixture user_job id is malformed')
    }

    runId = adapters.makeRunId().toLowerCase()
    const mismatchedRunId = adapters.makeMismatchedRunId().toLowerCase()
    if (!UUID_PATTERN.test(runId) || !UUID_PATTERN.test(mismatchedRunId) || runId === mismatchedRunId) {
      throw new Error('verification run ids are invalid')
    }

    latchEndRequired = true
    const latch = await adapters.beginLatch(runId, fixtureIds, FIXTURE_TTL_SECONDS)
    if (latch.runId.toLowerCase() !== runId || !Number.isFinite(Date.parse(latch.expiresAt))) {
      throw new Error('maintenance latch acknowledgement is invalid')
    }

    await adapters.signalPreferences()
    await adapters.protectNonfixtures(fixtureIds)
    await adapters.injectLateJob()
    await adapters.injectLatePreferenceSignal()
    await adapters.injectLateReroute()
    await adapters.proveAuthenticatedWritesDenied(fixtureIds[0])

    const noIdClaim = await adapters.claim(null)
    if (noIdClaim.length !== 0) throw new Error('ordinary no-id claim escaped active latch')
    const mismatchedClaim = await adapters.claim(mismatchedRunId)
    if (mismatchedClaim.length !== 0) throw new Error('mismatched claim escaped active latch')

    const usageSnapshot = await adapters.snapshotUsage()
    let tickInvocations = 0
    tickInvocations += 1
    if (tickInvocations !== 1) throw new Error('score-tick invocation guard failed')
    const tickResponse = await adapters.invokeTick(runId)
    if (tickInvocations !== 1) throw new Error('score-tick invoked more than once')
    if (tickResponse.claimed !== 2) throw new Error('score-tick did not claim exactly two fixtures')
    exactIds(tickResponse.verification_claimed_ids, fixtureIds, 'score-tick')
    await adapters.assertOutcomes(fixtureIds, tickResponse, usageSnapshot)

    result = {
      runId,
      fixtureUserJobIds: [...fixtureIds],
      tickInvocations: 1,
      noIdClaimed: 0,
      mismatchedIdClaimed: 0,
    }
  } catch (error) {
    primaryError = error
  }

  const cleanupErrors: unknown[] = []
  if (latchEndRequired && runId) {
    try {
      await adapters.endLatch(runId)
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  if (dataSnapshot !== null) {
    try {
      await adapters.restoreData(dataSnapshot)
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  try {
    await adapters.deleteTrackedFixtures(seedIds, fixtureIds)
  } catch (error) {
    cleanupErrors.push(error)
  }
  try {
    await adapters.assertZeroResidue()
  } catch (error) {
    cleanupErrors.push(error)
  }
  if (cronRestoreRequired && cronSnapshot) {
    try {
      await adapters.restoreCron(cronSnapshot)
    } catch (error) {
      cleanupErrors.push(error)
    }
    try {
      assertCronRestored(await adapters.readRestoredCron(), cronSnapshot)
    } catch (error) {
      cleanupErrors.push(error)
    }
  }

  if (primaryError || cleanupErrors.length > 0) throw cleanupFailure(primaryError, cleanupErrors)
  if (!result) throw new Error('verification produced no result')
  return result
}

const REQUIRED_ENVIRONMENT = [
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_PROJECT_REF',
  'CRON_SECRET',
  'SCORING_VERIFIER_EMAIL',
  'SCORING_VERIFIER_PASSWORD',
] as const

type RequiredEnvironmentName = (typeof REQUIRED_ENVIRONMENT)[number]
type ProductionEnvironment = Record<RequiredEnvironmentName, string>

function loadEnvironment(): ProductionEnvironment {
  const values = Object.create(null) as ProductionEnvironment
  for (const name of REQUIRED_ENVIRONMENT) {
    const value = process.env[name]
    if (!value) throw new Error(`Missing required environment variable: ${name}`)
    values[name] = value
  }
  return values
}

export function assertDedicatedVerifierUser(
  user: { email?: string | null; app_metadata?: Record<string, unknown> | null },
  expectedEmail: string,
) {
  if (user.email?.trim().toLowerCase() !== expectedEmail.trim().toLowerCase()) {
    throw new Error('dedicated scoring verifier email mismatch')
  }
  if (user.app_metadata?.scoring_verifier !== true) {
    throw new Error('dedicated scoring verifier account marker is missing')
  }
}

function assertUuid(value: string, label: string) {
  if (!UUID_PATTERN.test(value)) throw new Error(`${label} is not a UUID`)
}

function sqlUuid(value: string) {
  assertUuid(value, 'SQL UUID')
  return `'${value.toLowerCase()}'::uuid`
}

function sqlText(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

export function buildCronActiveSql(jobId: number, active: boolean) {
  if (!Number.isInteger(jobId) || jobId < 1) throw new Error('cron job id is invalid')
  if (typeof active !== 'boolean') throw new Error('cron active state is invalid')
  return `select cron.alter_job(job_id := ${jobId}, active := ${active ? 'true' : 'false'}) as altered`
}

function cronFromRow(row: Record<string, unknown>): CronSnapshot {
  const cron = Object.fromEntries(CRON_FIELDS.map((field) => [field, row[field]])) as unknown as CronSnapshot
  if (
    typeof cron.jobid !== 'number' ||
    typeof cron.jobname !== 'string' ||
    typeof cron.schedule !== 'string' ||
    typeof cron.command !== 'string' ||
    typeof cron.nodename !== 'string' ||
    typeof cron.nodeport !== 'number' ||
    typeof cron.database !== 'string' ||
    typeof cron.username !== 'string' ||
    typeof cron.active !== 'boolean'
  ) {
    throw new Error('score cron inventory is malformed')
  }
  return cron
}

export function createProductionAdapters(env: ProductionEnvironment): FreshnessAdapters {
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
  const user = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
  let targetUserId: string | null = null
  let trackedJobIds: string[] = []
  let trackedUserJobIds: string[] = []
  let trackedRunId: string | null = null
  let lateJobId: string | null = null

  async function managementSql(query: string) {
    const response = await fetch(
      `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      },
    )
    if (!response.ok) throw new Error(`Management SQL returned HTTP ${response.status}`)
    const payload = await response.json()
    if (!Array.isArray(payload)) throw new Error('Management SQL response is malformed')
    return payload as Record<string, unknown>[]
  }

  async function readUniqueCron() {
    const rows = await managementSql(
      `select jobid, jobname, schedule, command, nodename, nodeport, database, username, active
       from cron.job where jobname = ${sqlText(SCORE_CRON_NAME)} order by jobid`,
    )
    if (rows.length !== 1) throw new Error(`expected one score cron row, found ${rows.length}`)
    return cronFromRow(rows[0])
  }

  async function restoreRows(rows: Record<string, unknown>[]) {
    for (const row of rows) {
      if (!targetUserId || row.user_id !== targetUserId) {
        throw new Error('refusing to restore a non-verifier user_job')
      }
      const { id, user_id: _userId, job_id: _jobId, ...values } = row
      const { error } = await admin.from('user_jobs').update(values).eq('id', id)
      if (error) throw new Error(`user_jobs restore failed: ${error.message}`)
    }
  }

  return {
    makeRunId: () => crypto.randomUUID(),
    makeMismatchedRunId: () => crypto.randomUUID(),
    async validateEnvironment() {
      const { data, error } = await user.auth.signInWithPassword({
        email: env.SCORING_VERIFIER_EMAIL,
        password: env.SCORING_VERIFIER_PASSWORD,
      })
      if (error || !data.user) throw new Error('Target user authentication failed')
      assertDedicatedVerifierUser(data.user, env.SCORING_VERIFIER_EMAIL)
      targetUserId = data.user.id
      const { count, error: extractError } = await admin
        .from('resume_extracts')
        .select('resume_id', { count: 'exact', head: true })
        .eq('user_id', targetUserId)
        .eq('status', 'ready')
      if (extractError || (count ?? 0) < 1) throw new Error('Target user has no ready resume extract')
    },
    snapshotCron: readUniqueCron,
    async pauseCron(snapshot) {
      const rows = await managementSql(buildCronActiveSql(snapshot.jobid, false))
      if (rows.length !== 1) throw new Error('cron.alter_job pause was unavailable')
    },
    readCron: readUniqueCron,
    async proveQuiescent() {
      const rows = await managementSql(
        `select count(*)::integer as in_flight from public.user_jobs
         where claimed_at is not null and claimed_at >= now() - interval '5 minutes'`,
      )
      if (rows.length !== 1 || rows[0].in_flight !== 0) {
        throw new Error('score work quiescence is unprovable')
      }
    },
    async preseedCurrentPairs() {
      const rows = await managementSql(
        `with inserted as (
           insert into public.user_jobs (user_id, job_id)
           select u.id, j.id from auth.users as u cross join public.jobs as j
           where j.status = 'open'
             and not exists (
               select 1 from public.user_jobs as uj
               where uj.user_id = u.id and uj.job_id = j.id
             )
           on conflict (user_id, job_id) do nothing
           returning id
         ) select id from inserted order by id`,
      )
      const ids = rows.map((row) => String(row.id))
      ids.forEach((id) => assertUuid(id, 'preseed user_job id'))
      return ids
    },
    async snapshotData() {
      if (!targetUserId) throw new Error('target user is unavailable')
      const rows = await collectPaginatedRows(async (from, to) => {
        const { data, error, count } = await admin
          .from('user_jobs')
          .select('*', { count: 'exact' })
          .eq('user_id', targetUserId)
          .order('id')
          .range(from, to)
        if (error) throw new Error(`user_jobs snapshot failed: ${error.message}`)
        return { rows: data ?? [], count }
      })
      const { data: preferences, error: preferencesError } = await admin
        .from('preferences')
        .select('*')
        .eq('user_id', targetUserId)
        .maybeSingle()
      if (preferencesError) throw new Error(`preferences snapshot failed: ${preferencesError.message}`)
      return { rows, preferences, targetUserId }
    },
    async createFixtures() {
      if (!targetUserId) throw new Error('target user is unavailable')
      const jobIds = [crypto.randomUUID(), crypto.randomUUID()]
      const userJobIds = [crypto.randomUUID(), crypto.randomUUID()]
      const externalIds = jobIds.map((id) => `verify-${id}`)
      const { count, error: collisionError } = await admin
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('source', 'adzuna')
        .in('external_id', externalIds)
      if (collisionError || count !== 0) throw new Error('fixture collision check failed')
      const jobs = [
        {
          id: jobIds[0], source: 'adzuna', external_id: externalIds[0],
          title: 'Equity Research Analyst', location: 'Chicago, IL',
          absolute_url: `https://example.invalid/jobs/${jobIds[0]}`,
          description_text: 'Entry level equity research financial modeling valuation.',
          fingerprint: `verify-${jobIds[0]}`, source_company_name: 'Verification Positive',
        },
        {
          id: jobIds[1], source: 'adzuna', external_id: externalIds[1],
          title: 'Research Data Analyst', location: 'Chicago, IL',
          absolute_url: `https://example.invalid/jobs/${jobIds[1]}`,
          description_text: 'Data pipelines reporting and business intelligence.',
          fingerprint: `verify-${jobIds[1]}`, source_company_name: 'Verification Negative',
        },
      ]
      trackedJobIds = [...jobIds]
      const { error: jobError } = await admin.from('jobs').insert(jobs)
      if (jobError) throw new Error(`fixture jobs insert failed: ${jobError.message}`)
      trackedUserJobIds = [...userJobIds]
      const { error: userJobError } = await admin.from('user_jobs').insert(
        userJobIds.map((id, index) => ({ id, user_id: targetUserId, job_id: jobIds[index] })),
      )
      if (userJobError) throw new Error(`fixture user_jobs insert failed: ${userJobError.message}`)
      return userJobIds
    },
    async beginLatch(runId, fixtureIds, ttlSeconds) {
      trackedRunId = runId
      const { data, error } = await admin.rpc('begin_scoring_verification', {
        p_run_id: runId,
        p_fixture_user_job_id_1: fixtureIds[0],
        p_fixture_user_job_id_2: fixtureIds[1],
        p_ttl_seconds: ttlSeconds,
      })
      if (error || !Array.isArray(data) || data.length !== 1) {
        throw new Error(`maintenance latch begin failed: ${error?.message ?? 'invalid response'}`)
      }
      return { runId: String(data[0].run_id), expiresAt: String(data[0].expires_at) }
    },
    async signalPreferences() {
      if (!targetUserId) throw new Error('target user is unavailable')
      const { error: upsertError } = await user.from('preferences').upsert(
        {
          user_id: targetUserId,
          titles: ['Equity Research'],
          locations: ['Chicago'],
          include_keywords: ['valuation'],
          exclude_keywords: [],
        },
        { onConflict: 'user_id' },
      )
      if (upsertError) throw new Error(`preference signal setup failed: ${upsertError.message}`)
      const { error: signalError } = await user.rpc('mark_recent_jobs_for_refilter')
      if (signalError) throw new Error(`preference signal failed: ${signalError.message}`)
    },
    async protectNonfixtures(fixtureIds) {
      if (!targetUserId) throw new Error('target user is unavailable')
      const { error } = await admin
        .from('user_jobs')
        .update({ attempts: 5, needs_refilter: false, claimed_at: null, claimed_input_revision: null })
        .eq('user_id', targetUserId)
        .neq('id', fixtureIds[0])
        .neq('id', fixtureIds[1])
      if (error) throw new Error(`nonfixture protection failed: ${error.message}`)
    },
    async injectLateJob() {
      const id = crypto.randomUUID()
      const externalId = `verify-late-${id}`
      const { count, error: collisionError } = await admin
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('source', 'adzuna')
        .eq('external_id', externalId)
      if (collisionError || count !== 0) throw new Error('late-job collision check failed')
      lateJobId = id
      trackedJobIds.push(id)
      const { error } = await admin.from('jobs').insert({
        id,
        source: 'adzuna',
        external_id: externalId,
        title: 'Late Equity Research Analyst',
        location: 'Chicago, IL',
        absolute_url: `https://example.invalid/jobs/${id}`,
        description_text: 'Late latch isolation fixture.',
        fingerprint: `verify-late-${id}`,
        source_company_name: 'Verification Late',
      })
      if (error) throw new Error(`late job insert failed: ${error.message}`)
    },
    async injectLatePreferenceSignal() {
      const { error: updateError } = await user
        .from('preferences')
        .update({ include_keywords: ['valuation', 'late-signal'] })
        .eq('user_id', targetUserId)
      if (updateError) throw new Error(`late preference update failed: ${updateError.message}`)
      const { error: signalError } = await user.rpc('mark_recent_jobs_for_refilter')
      if (signalError) throw new Error(`late preference signal failed: ${signalError.message}`)
    },
    async injectLateReroute() {
      const { error } = await admin.rpc('mark_user_jobs_for_reroute', { p_user_id: targetUserId })
      if (error) throw new Error(`late reroute signal failed: ${error.message}`)
    },
    async proveAuthenticatedWritesDenied(fixtureId) {
      const forbidden = [
        { scoring_input_hash: 'forbidden' },
        { desired_input_revision: 999 },
        { claimed_input_revision: 999 },
      ]
      for (const values of forbidden) {
        const { error } = await user.from('user_jobs').update(values).eq('id', fixtureId)
        if (!error) throw new Error('authenticated scoring-field write was unexpectedly allowed')
      }
      const { error: latchWriteError } = await user
        .from('scoring_verification_maintenance')
        .update({ expires_at: new Date(0).toISOString() })
        .eq('run_id', trackedRunId)
      if (!latchWriteError) throw new Error('authenticated latch write was unexpectedly allowed')
      const { error: latchRpcError } = await user.rpc('end_scoring_verification', {
        p_run_id: trackedRunId,
      })
      if (!latchRpcError) throw new Error('authenticated latch RPC was unexpectedly allowed')
    },
    async claim(runId) {
      const { data, error } = await admin.rpc('claim_scoring_work', {
        batch_size: 12,
        verification_run_id: runId,
      })
      if (error) throw new Error(`direct isolation claim failed: ${error.message}`)
      return data ?? []
    },
    async snapshotUsage() {
      const { data, error, count } = await admin
        .from('ai_usage')
        .select('id, user_id, purpose, model, prompt_tokens, output_tokens, occurred_at', {
          count: 'exact',
        })
        .eq('purpose', 'score')
        .order('id')
      if (error || count !== (data?.length ?? 0)) throw new Error('score usage snapshot failed')
      return data ?? []
    },
    async invokeTick(runId) {
      const response = await fetch(`${env.SUPABASE_URL}/functions/v1/score-tick`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-cron-secret': env.CRON_SECRET,
          'x-scoring-verification-run-id': runId,
        },
        body: '{}',
      })
      if (!response.ok) throw new Error(`score-tick returned HTTP ${response.status}`)
      return await response.json() as Record<string, unknown>
    },
    async assertOutcomes(fixtureIds, _tickResponse, usageSnapshot) {
      const { data, error } = await admin
        .from('user_jobs')
        .select('id, status, score, filter_reason, desired_input_revision, claimed_input_revision, scoring_input_hash')
        .in('id', fixtureIds)
      if (error || data?.length !== 2) throw new Error('fixture outcome read failed')
      const positive = data.find((row) => row.id === fixtureIds[0])
      const negative = data.find((row) => row.id === fixtureIds[1])
      if (
        positive?.status !== 'scored' ||
        typeof positive.score !== 'number' ||
        !positive.scoring_input_hash ||
        positive.claimed_input_revision !== null
      ) {
        throw new Error('positive fixture was not freshly scored at its claimed revision')
      }
      if (negative?.status !== 'filtered' || negative.filter_reason !== 'title_non_overlap') {
        throw new Error('negative fixture did not filter free')
      }
      if (!lateJobId || !targetUserId) throw new Error('late-event tracking is unavailable')
      const { count: lateSeedCount, error: lateSeedError } = await admin
        .from('user_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('job_id', lateJobId)
      if (lateSeedError || lateSeedCount !== 0) throw new Error('late job escaped latch through normal seeding')

      const beforeRows = usageSnapshot as Array<{ id: string }>
      const beforeIds = new Set(beforeRows.map((row) => row.id))
      const { data: usageAfter, error: usageError, count: usageCount } = await admin
        .from('ai_usage')
        .select('id, user_id, purpose, model, prompt_tokens, output_tokens, occurred_at', {
          count: 'exact',
        })
        .eq('purpose', 'score')
        .order('id')
      if (usageError || usageCount !== (usageAfter?.length ?? 0)) {
        throw new Error('post-tick score usage snapshot failed')
      }
      const delta = (usageAfter ?? []).filter((row) => !beforeIds.has(row.id))
      if (delta.length !== 1 || delta[0].user_id !== targetUserId) {
        throw new Error('score usage delta was not exactly one target-owned row')
      }
    },
    async endLatch(runId) {
      const { data, error } = await admin.rpc('end_scoring_verification', { p_run_id: runId })
      if (error) throw new Error(`maintenance latch end failed: ${error.message}`)
      return data === true
    },
    async restoreData(snapshot) {
      const typed = snapshot as {
        rows: Record<string, unknown>[]
        preferences: Record<string, unknown> | null
        targetUserId: string
      }
      await restoreRows(typed.rows)
      if (typed.preferences) {
        const { error } = await admin.from('preferences').upsert(typed.preferences, { onConflict: 'user_id' })
        if (error) throw new Error(`preferences restore failed: ${error.message}`)
      } else {
        const { error } = await admin.from('preferences').delete().eq('user_id', typed.targetUserId)
        if (error) throw new Error(`temporary preferences delete failed: ${error.message}`)
      }
    },
    async deleteTrackedFixtures(seedIds, fixtureIds) {
      const userJobIds = [...new Set([...seedIds, ...fixtureIds, ...trackedUserJobIds])]
      if (userJobIds.length > 0) {
        const { error } = await admin.from('user_jobs').delete().in('id', userJobIds)
        if (error) throw new Error(`tracked user_jobs delete failed: ${error.message}`)
      }
      if (trackedJobIds.length > 0) {
        const { error } = await admin.from('jobs').delete().in('id', trackedJobIds)
        if (error) throw new Error(`tracked jobs delete failed: ${error.message}`)
      }
    },
    async assertZeroResidue() {
      const checks: Array<PromiseLike<{ count: number | null; error: { message: string } | null }>> = []
      if (trackedUserJobIds.length > 0) {
        checks.push(admin.from('user_jobs').select('id', { count: 'exact', head: true }).in('id', trackedUserJobIds))
      }
      if (trackedJobIds.length > 0) {
        checks.push(admin.from('jobs').select('id', { count: 'exact', head: true }).in('id', trackedJobIds))
      }
      if (trackedRunId) {
        checks.push(admin.from('scoring_verification_maintenance').select('run_id', { count: 'exact', head: true }).eq('run_id', trackedRunId))
      }
      const results = await Promise.all(checks)
      if (results.some((item) => item.error || item.count !== 0)) throw new Error('verification residue remains')
    },
    async restoreCron(snapshot) {
      const rows = await managementSql(buildCronActiveSql(snapshot.jobid, snapshot.active))
      if (rows.length !== 1) throw new Error('cron.alter_job restoration was unavailable')
    },
    readRestoredCron: readUniqueCron,
  }
}

export async function runProductionFreshnessVerification() {
  const env = loadEnvironment()
  const result = await runFreshnessVerification(createProductionAdapters(env))
  console.log(JSON.stringify({
    status: 'pass',
    run_id: result.runId,
    fixture_user_job_ids: result.fixtureUserJobIds,
    tick_invocations: result.tickInvocations,
    no_id_claimed: result.noIdClaimed,
    mismatched_id_claimed: result.mismatchedIdClaimed,
  }))
}

function usage() {
  return [
    'Usage:',
    '  node --env-file=scripts/.env --experimental-strip-types scripts/verify-scoring-freshness.ts',
    '  node --experimental-strip-types scripts/verify-scoring-freshness.ts --help',
    '',
    'This command is production-mutating and must run only under the separate paid-proof approval.',
  ].join('\n')
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(usage())
  } else {
    runProductionFreshnessVerification().catch((error) => {
      console.error(error instanceof Error ? error.message : 'Scoring freshness verification failed')
      process.exitCode = 1
    })
  }
}

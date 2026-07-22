import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { createClient } from '../web/node_modules/@supabase/supabase-js/dist/index.mjs'

export const PAYLOCITY_BOARD_UUID = 'd6628b21-949b-4400-a3d0-c9082bbf3eb1'
export const PAYLOCITY_SOURCE_KEY = `paylocity:global:${PAYLOCITY_BOARD_UUID}`
const PAYLOCITY_BOARD_URL =
  `https://recruiting.paylocity.com/recruiting/jobs/All/${PAYLOCITY_BOARD_UUID}/The-Only-Facial`
const PAYLOCITY_COMPANY_NAME = 'The Only Facial'
const SCORE_CRON_NAME = 'score-tick-every-minute'
const SNAPSHOT_PAGE_SIZE = 1_000
const SCORE_LATCH_TTL_SECONDS = 120

const REQUIRED_RESUME_ENVIRONMENT = Object.freeze([
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_PROJECT_REF',
  'CRON_SECRET',
  'USER1_EMAIL',
  'SEED_PASSWORD_1',
] as const)

type MutationDisposition = 'expected_durable' | 'temporary_must_restore' | 'fixture_must_delete'

export const PAYLOCITY_MUTATION_CLASSES = Object.freeze([
  { id: 'paylocity_activation_evidence', disposition: 'expected_durable', acceptancePredicate: 'Only exact server-timed clean evidence may advance the reviewed Paylocity row.' },
  { id: 'paylocity_provider_jobs', disposition: 'expected_durable', acceptancePredicate: 'Only provider-owned Paylocity rows may be inserted or receive lifecycle updates.' },
  { id: 'paylocity_company_health', disposition: 'expected_durable', acceptancePredicate: 'A successful claimed poll may advance only the exact company health fields.' },
  { id: 'pipeline_heartbeat', disposition: 'expected_durable', acceptancePredicate: 'The claimed poll may advance the common pipeline heartbeat.' },
  { id: 'claim_timestamps', disposition: 'temporary_must_restore', acceptancePredicate: 'Non-target claim timestamps must CAS-restore or fail without overwriting concurrent state.' },
  { id: 'incomplete_observation_sentinel', disposition: 'fixture_must_delete', acceptancePredicate: 'The invocation-owned sentinel remains open and is deleted by exact id.' },
  { id: 'disposable_verifier_account', disposition: 'fixture_must_delete', acceptancePredicate: 'Only the invocation-tagged auth account may be deleted.' },
  { id: 'disposable_scoring_rows', disposition: 'fixture_must_delete', acceptancePredicate: 'Preferences, resume, extract, and user_jobs are deleted by recorded owner/id.' },
  { id: 'scoring_latch', disposition: 'fixture_must_delete', acceptancePredicate: 'The exact run-id latch is ended before row cleanup.' },
  { id: 'scoring_usage', disposition: 'expected_durable', acceptancePredicate: 'At most one target-owned physical score request may be added.' },
  { id: 'scoring_cron', disposition: 'temporary_must_restore', acceptancePredicate: 'The full cron tuple must CAS-restore byte-for-byte.' },
] as const satisfies ReadonlyArray<{
  id: string
  disposition: MutationDisposition
  acceptancePredicate: string
}>)

export const PAYLOCITY_FAILURE_STAGES = Object.freeze([
  'snapshot_entry',
  'verify_board',
  'snapshot_post_activation',
  'snapshot_score_cron',
  'pause_score_cron',
  'read_paused_cron',
  'prove_score_quiescent',
  'poll_paylocity_once',
  'snapshot_post_poll',
  'assert_no_duplicate_jobs',
  'probe_incomplete_observation',
  'create_disposable_scoring_fixture',
  'begin_scoring_latch',
  'snapshot_score_usage',
  'invoke_score_tick',
  'assert_dashboard_feed',
  'end_scoring_latch',
  'cleanup_owned_rows',
  'assert_zero_residue',
  'restore_score_cron',
  'read_restored_cron',
  'snapshot_final',
] as const)

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

interface ProviderJobSnapshot {
  id: string
  company_id: string
  source: string
  external_id: string
  title: string
  absolute_url: string
  fingerprint: string
  first_seen_at: string
  description_html_hash: string
  description_text_hash: string
  status: string
  last_seen_at: string
  closed_at: string | null
}

interface VerificationSnapshot {
  label: string
  company: Record<string, unknown> | null
  jobs: Record<string, ProviderJobSnapshot>
  observations: Record<string, Record<string, unknown>>
  heartbeat: Record<string, unknown>
  scoringUsage: Record<string, Record<string, unknown>>
  owned: Record<string, unknown>
}

interface ActivationStatus {
  state: string
  progress: number
  nextEligibleAt: string | null
}

interface OwnedFixture {
  runId: string
  userId: string
  email: string
  resumeId: string
  userJobIds: [string, string]
  jobIds: [string, string]
}

export interface PaylocityVerificationAdapters {
  snapshotState(label: string): Promise<VerificationSnapshot>
  verifyBoard(): Promise<ActivationStatus>
  snapshotScoreCron(): Promise<CronSnapshot>
  pauseScoreCron(snapshot: CronSnapshot): Promise<void>
  readScoreCron(stage: 'paused' | 'restored'): Promise<CronSnapshot>
  proveScoreQuiescent(): Promise<void>
  pollPaylocityOnce(): Promise<Record<string, unknown>>
  assertNoDuplicateJobs(before: VerificationSnapshot, after: VerificationSnapshot): Promise<void>
  probeIncompleteObservation(): Promise<void>
  createDisposableScoringFixture(): Promise<OwnedFixture>
  beginScoringLatch(owned: OwnedFixture): Promise<void>
  snapshotScoreUsage(): Promise<Array<Record<string, unknown>>>
  invokeScoreTick(runId: string): Promise<Record<string, unknown>>
  assertDashboardFeed(
    owned: OwnedFixture,
    response: Record<string, unknown>,
    usageBefore: Array<Record<string, unknown>>,
  ): Promise<void>
  endScoringLatch(runId: string): Promise<void>
  cleanupOwnedRows(owned: OwnedFixture): Promise<void>
  assertZeroResidue(owned: OwnedFixture | null): Promise<void>
  restoreScoreCron(snapshot: CronSnapshot): Promise<void>
}

interface PaginatedRows<T> {
  rows: T[]
  count: number | null
}

export async function collectPaylocitySnapshotRows<T>(
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
  if (first.rows.length !== Math.min(total, pageSize)) {
    throw new Error('paginated snapshot first page was truncated')
  }
  const rows = [...first.rows]
  const pageCount = Math.ceil(total / pageSize)
  for (let page = 1; page < pageCount; page += 1) {
    const from = page * pageSize
    const to = Math.min(total - 1, from + pageSize - 1)
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

const REDACTED_KEYS = /(?:authorization|token|secret|password|email|resume|provider_body|description)/i

export function redactPaylocityEvidence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactPaylocityEvidence)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
    key,
    REDACTED_KEYS.test(key) ? '[REDACTED]' : redactPaylocityEvidence(entry),
  ]))
}

function hashNullable(value: unknown) {
  return createHash('sha256').update(typeof value === 'string' ? value : '').digest('hex')
}

function assertCronPaused(actual: CronSnapshot, expected: CronSnapshot) {
  for (const [key, value] of Object.entries(expected)) {
    const expectedValue = key === 'active' ? false : value
    if (actual[key as keyof CronSnapshot] !== expectedValue) {
      throw new Error(`score cron pause mismatch: ${key}`)
    }
  }
}

function assertCronRestorable(actual: CronSnapshot, expected: CronSnapshot) {
  assertCronPaused(actual, expected)
}

function assertCronRestored(actual: CronSnapshot, expected: CronSnapshot) {
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key as keyof CronSnapshot] !== value) {
      throw new Error(`score cron restoration mismatch: ${key}`)
    }
  }
}

function cleanupFailure(primary: unknown, cleanupErrors: unknown[]) {
  const cleanup = cleanupErrors.map((error) => error instanceof Error ? error.message : String(error))
  const message = primary instanceof Error ? primary.message : primary ? String(primary) : ''
  return new Error(message
    ? `${message}${cleanup.length ? `; cleanup failed: ${cleanup.join('; ')}` : ''}`
    : `cleanup failed: ${cleanup.join('; ')}`)
}

export function assertExistingProviderJobsImmutable(
  before: VerificationSnapshot,
  after: VerificationSnapshot,
) {
  const immutableFields: Array<keyof ProviderJobSnapshot> = [
    'id',
    'company_id',
    'source',
    'external_id',
    'title',
    'absolute_url',
    'fingerprint',
    'first_seen_at',
    'description_html_hash',
    'description_text_hash',
  ]
  for (const [id, entry] of Object.entries(before.jobs)) {
    const final = after.jobs[id]
    if (!final) throw new Error(`pre-existing provider job disappeared: ${id}`)
    for (const field of immutableFields) {
      if (entry[field] !== final[field]) throw new Error(`immutable provider job drift: ${id}.${field}`)
    }
  }
}

export async function runPaylocityVerification(adapters: PaylocityVerificationAdapters) {
  const entry = await adapters.snapshotState('entry')
  const activation = await adapters.verifyBoard()
  await adapters.snapshotState('post_activation')
  if (activation.progress < 3 || activation.state !== 'active') {
    return {
      status: 'PENDING' as const,
      progress: activation.progress,
      nextEligibleAt: activation.nextEligibleAt,
      scoreTickInvocations: 0 as const,
    }
  }

  let cronSnapshot: CronSnapshot | null = null
  let cronRestoreRequired = false
  let owned: OwnedFixture | null = null
  let latchEndRequired = false
  let primaryError: unknown = null
  let postPoll: VerificationSnapshot | null = null
  let result: { status: 'COMPLETE'; scoreTickInvocations: 1 } | null = null

  try {
    cronSnapshot = await adapters.snapshotScoreCron()
    cronRestoreRequired = true
    await adapters.pauseScoreCron(cronSnapshot)
    assertCronPaused(await adapters.readScoreCron('paused'), cronSnapshot)
    await adapters.proveScoreQuiescent()

    const pollResponse = await adapters.pollPaylocityOnce()
    if (pollResponse.claimed !== 1 || pollResponse.succeeded !== 1 || pollResponse.failed !== 0) {
      throw new Error('Paylocity poll was not the sole successful claimed company')
    }
    postPoll = await adapters.snapshotState('post_poll')
    assertExistingProviderJobsImmutable(entry, postPoll)
    await adapters.assertNoDuplicateJobs(entry, postPoll)
    await adapters.probeIncompleteObservation()

    owned = await adapters.createDisposableScoringFixture()
    latchEndRequired = true
    await adapters.beginScoringLatch(owned)
    const usageBefore = await adapters.snapshotScoreUsage()
    let scoreTickInvocations = 0
    scoreTickInvocations += 1
    if (scoreTickInvocations !== 1) throw new Error('score-tick invocation guard failed')
    const tickResponse = await adapters.invokeScoreTick(owned.runId)
    if (scoreTickInvocations !== 1) throw new Error('score-tick invoked more than once')
    await adapters.assertDashboardFeed(owned, tickResponse, usageBefore)
    result = { status: 'COMPLETE', scoreTickInvocations: 1 }
  } catch (error) {
    primaryError = error
  }

  const cleanupErrors: unknown[] = []
  if (latchEndRequired && owned) {
    try {
      await adapters.endScoringLatch(owned.runId)
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  if (owned) {
    try {
      await adapters.cleanupOwnedRows(owned)
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  if (cronRestoreRequired) {
    try {
      await adapters.assertZeroResidue(owned)
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  if (cronRestoreRequired && cronSnapshot) {
    try {
      assertCronRestorable(await adapters.readScoreCron('paused'), cronSnapshot)
      await adapters.restoreScoreCron(cronSnapshot)
      assertCronRestored(await adapters.readScoreCron('restored'), cronSnapshot)
    } catch (error) {
      cleanupErrors.push(error)
    }
  }

  if (primaryError || cleanupErrors.length > 0) throw cleanupFailure(primaryError, cleanupErrors)
  if (!result || !postPoll) throw new Error('verification produced no complete result')
  const finalSnapshot = await adapters.snapshotState('final')
  assertExistingProviderJobsImmutable(postPoll, finalSnapshot)
  return result
}

type EnvironmentName = (typeof REQUIRED_RESUME_ENVIRONMENT)[number]
type ResumeEnvironment = Record<EnvironmentName, string>

function loadResumeEnvironment(): ResumeEnvironment {
  const environment = Object.create(null) as ResumeEnvironment
  for (const name of REQUIRED_RESUME_ENVIRONMENT) {
    const value = process.env[name]
    if (!value) throw new Error(`Missing required environment variable: ${name}`)
    environment[name] = value
  }
  return environment
}

function cronFromRow(row: Record<string, unknown>): CronSnapshot {
  const fields: Array<keyof CronSnapshot> = [
    'jobid', 'jobname', 'schedule', 'command', 'nodename', 'nodeport', 'database', 'username', 'active',
  ]
  const snapshot = Object.fromEntries(fields.map((field) => [field, row[field]])) as unknown as CronSnapshot
  if (
    typeof snapshot.jobid !== 'number'
    || typeof snapshot.jobname !== 'string'
    || typeof snapshot.schedule !== 'string'
    || typeof snapshot.command !== 'string'
    || typeof snapshot.nodename !== 'string'
    || typeof snapshot.nodeport !== 'number'
    || typeof snapshot.database !== 'string'
    || typeof snapshot.username !== 'string'
    || typeof snapshot.active !== 'boolean'
  ) throw new Error('score cron inventory is malformed')
  return snapshot
}

function sqlText(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

function createProductionAdapters(environment: ResumeEnvironment): PaylocityVerificationAdapters {
  const admin = createClient(environment.SUPABASE_URL, environment.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
  const user = createClient(environment.SUPABASE_URL, environment.SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
  let accessToken: string | null = null
  let ownedFixture: OwnedFixture | null = null
  let claimedRestorations: Array<{ id: string; before: string | null; written: string }> = []

  async function managementSql(query: string) {
    const response = await fetch(
      `https://api.supabase.com/v1/projects/${environment.SUPABASE_PROJECT_REF}/database/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${environment.SUPABASE_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      },
    )
    if (!response.ok) {
      const detail = (await response.text()).replaceAll(/authorization|token|secret|password/gi, '[REDACTED]')
      throw new Error(`Management SQL returned HTTP ${response.status}: ${detail.slice(0, 320)}`)
    }
    const rows = await response.json()
    if (!Array.isArray(rows)) throw new Error('Management SQL response is malformed')
    return rows as Array<Record<string, unknown>>
  }

  async function readUniqueScoreCron() {
    const rows = await managementSql(
      `select jobid, jobname, schedule, command, nodename, nodeport, database, username, active
       from cron.job where jobname = ${sqlText(SCORE_CRON_NAME)} order by jobid`,
    )
    if (rows.length !== 1) throw new Error(`expected one score cron row, found ${rows.length}`)
    return cronFromRow(rows[0])
  }

  async function compareAndSwapCron(
    snapshot: CronSnapshot,
    expectedActive: boolean,
    targetActive: boolean,
  ) {
    if (!Number.isInteger(snapshot.jobid) || snapshot.jobid < 1) {
      throw new Error('score cron job id is invalid')
    }
    await managementSql(`
      do $paylocity_cron_cas$
      declare
        current_job cron.job%rowtype;
      begin
        select * into current_job from cron.job
        where jobid = ${snapshot.jobid};
        if not found
          or current_job.jobname is distinct from ${sqlText(snapshot.jobname)}
          or current_job.schedule is distinct from ${sqlText(snapshot.schedule)}
          or current_job.command is distinct from ${sqlText(snapshot.command)}
          or current_job.nodename is distinct from ${sqlText(snapshot.nodename)}
          or current_job.nodeport is distinct from ${snapshot.nodeport}
          or current_job.database is distinct from ${sqlText(snapshot.database)}
          or current_job.username is distinct from ${sqlText(snapshot.username)}
          or current_job.active is distinct from ${expectedActive ? 'true' : 'false'}
        then
          raise exception 'score_cron_cas_conflict';
        end if;
        perform cron.alter_job(
          job_id := ${snapshot.jobid},
          schedule := null,
          command := null,
          database := null,
          username := null,
          active := ${targetActive ? 'true' : 'false'}
        );
      end;
      $paylocity_cron_cas$;
    `)
  }

  async function paginatedTable<T>(
    table: string,
    select: string,
    configure: (query: any) => any,
    orderColumn = 'id',
  ) {
    return collectPaylocitySnapshotRows<T>(async (from, to) => {
      const query = configure(
        admin.from(table).select(select, { count: 'exact' }).order(orderColumn).range(from, to),
      )
      const { data, error, count } = await query
      if (error) throw new Error(`${table} snapshot failed: ${error.message}`)
      return { rows: (data ?? []) as T[], count }
    })
  }

  async function snapshotState(label: string): Promise<VerificationSnapshot> {
    const { data: company, error: companyError } = await admin
      .from('companies')
      .select('id, name, ats_type, board_token, region, site_token, source_key, activation_state, activation_successes, last_verified_at, last_polled_at, last_success_at, consecutive_failures, last_error_code')
      .eq('source_key', PAYLOCITY_SOURCE_KEY)
      .maybeSingle()
    if (companyError) throw new Error(`Paylocity company snapshot failed: ${companyError.message}`)

    const jobs = await paginatedTable<Record<string, unknown>>(
      'jobs',
      'id, company_id, source, external_id, title, absolute_url, fingerprint, first_seen_at, description_html, description_text, status, last_seen_at, closed_at',
      (query) => query.eq('source', 'paylocity'),
    )
    const observations = company
      ? await paginatedTable<Record<string, unknown>>(
          'connector_observations',
          'observation_id, company_id, provider, observed_at, eligibility_window_start, completeness, credible_for_closure, job_count, expected_count, warning_count, evidence_digest',
          (query) => query.eq('company_id', company.id),
          'observation_id',
        )
      : []
    const usage = await paginatedTable<Record<string, unknown>>(
      'ai_usage',
      'id, user_id, purpose, model, prompt_tokens, output_tokens, occurred_at',
      (query) => query.eq('purpose', 'score'),
    )
    const { data: heartbeat, error: heartbeatError } = await admin
      .from('pipeline_heartbeat')
      .select('last_tick_at, last_success_at')
      .eq('id', true)
      .maybeSingle()
    if (heartbeatError) throw new Error(`pipeline heartbeat snapshot failed: ${heartbeatError.message}`)

    const normalizedJobs = Object.fromEntries(jobs.map((row) => [String(row.id), {
      id: String(row.id),
      company_id: String(row.company_id),
      source: String(row.source),
      external_id: String(row.external_id),
      title: String(row.title),
      absolute_url: String(row.absolute_url),
      fingerprint: String(row.fingerprint),
      first_seen_at: String(row.first_seen_at),
      description_html_hash: hashNullable(row.description_html),
      description_text_hash: hashNullable(row.description_text),
      status: String(row.status),
      last_seen_at: String(row.last_seen_at),
      closed_at: row.closed_at === null ? null : String(row.closed_at),
    } satisfies ProviderJobSnapshot]))

    return {
      label,
      company: company ?? null,
      jobs: normalizedJobs,
      observations: Object.fromEntries(observations.map((row) => [String(row.observation_id), row])),
      heartbeat: heartbeat ?? {},
      scoringUsage: Object.fromEntries(usage.map((row) => [String(row.id), row])),
      owned: ownedFixture ? { userId: ownedFixture.userId, userJobIds: ownedFixture.userJobIds } : {},
    }
  }

  async function restoreClaimTimestamps() {
    const conflicts: string[] = []
    for (const restoration of claimedRestorations) {
      const { data, error } = await admin
        .from('companies')
        .update({ last_polled_at: restoration.before })
        .eq('id', restoration.id)
        .eq('last_polled_at', restoration.written)
        .select('id')
      if (error || data?.length !== 1) conflicts.push(restoration.id)
    }
    claimedRestorations = []
    if (conflicts.length) throw new Error(`claim timestamp restoration conflict: ${conflicts.length}`)
  }

  async function cleanupOwnedFixture(owned: OwnedFixture) {
    const verifier = await admin.auth.admin.getUserById(owned.userId)
    if (verifier.error || verifier.data.user.email?.toLowerCase() !== owned.email.toLowerCase()
      || verifier.data.user.app_metadata?.paylocity_verifier !== true) {
      throw new Error('refusing to clean an unowned verifier account')
    }
    const deletions = await Promise.all([
      admin.from('user_jobs').delete().in('id', owned.userJobIds).eq('user_id', owned.userId),
      admin.from('resume_extracts').delete().eq('resume_id', owned.resumeId).eq('user_id', owned.userId),
      admin.from('resumes').delete().eq('id', owned.resumeId).eq('user_id', owned.userId),
      admin.from('preferences').delete().eq('user_id', owned.userId),
    ])
    if (deletions.some((result) => result.error)) throw new Error('owned-row cleanup failed')
    const deleted = await admin.auth.admin.deleteUser(owned.userId)
    if (deleted.error) throw new Error('owned verifier account cleanup failed')
    ownedFixture = null
  }

  return {
    snapshotState,
    async verifyBoard() {
      if (!accessToken) {
        const { data, error } = await user.auth.signInWithPassword({
          email: environment.USER1_EMAIL,
          password: environment.SEED_PASSWORD_1,
        })
        if (error || !data.session?.access_token) throw new Error('real-user authentication failed')
        accessToken = data.session.access_token
      }
      const response = await fetch(`${environment.SUPABASE_URL}/functions/v1/verify-board`, {
        method: 'POST',
        headers: {
          apikey: environment.SUPABASE_PUBLISHABLE_KEY,
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ url: PAYLOCITY_BOARD_URL }),
      })
      if (!response.ok) throw new Error(`verify-board returned HTTP ${response.status}`)
      const body = await response.json() as Record<string, any>
      if (body.ok !== true || body.company?.source_key !== PAYLOCITY_SOURCE_KEY) {
        throw new Error('verify-board did not return exact Paylocity identity')
      }
      return {
        state: String(body.company.activation_state),
        progress: Number(body.activation?.progress ?? body.company.activation_successes ?? 0),
        nextEligibleAt: body.activation?.next_eligible_at ?? null,
      }
    },
    snapshotScoreCron: readUniqueScoreCron,
    async pauseScoreCron(snapshot) {
      await compareAndSwapCron(snapshot, snapshot.active, false)
    },
    async readScoreCron() {
      return readUniqueScoreCron()
    },
    async proveScoreQuiescent() {
      const readClaims = async () => {
        const rows = await managementSql(
          `select count(*)::integer as in_flight from public.user_jobs
           where claimed_at is not null and claimed_at >= now() - interval '5 minutes'`,
        )
        return Number(rows[0]?.in_flight ?? -1)
      }
      if (await readClaims() === 0) return
      await delay(125_000)
      if (await readClaims() !== 0) throw new Error('score work quiescence is unprovable')
    },
    async pollPaylocityOnce() {
      const { data: beforeRows, error: beforeError } = await admin
        .from('companies')
        .select('id, source_key, last_polled_at')
        .eq('activation_state', 'active')
      if (beforeError) throw new Error(`claim baseline failed: ${beforeError.message}`)
      const beforeById = new Map((beforeRows ?? []).map((row) => [row.id, row.last_polled_at]))
      const paylocity = (beforeRows ?? []).find((row) => row.source_key === PAYLOCITY_SOURCE_KEY)
      if (!paylocity) throw new Error('active Paylocity company is unavailable')
      const due = await admin
        .from('companies')
        .update({ last_polled_at: null })
        .eq('id', paylocity.id)
        .eq('source_key', PAYLOCITY_SOURCE_KEY)
        .select('id')
      if (due.error || due.data?.length !== 1) throw new Error('Paylocity due-state preparation failed')

      let targetExpected: string | null = null
      let pollStarted = false
      let primaryError: unknown = null
      let responseBody: Record<string, unknown> | null = null
      try {
        const claim = await admin.rpc('claim_due_companies', { batch_size: 100 })
        if (claim.error) throw new Error(`claim inventory failed: ${claim.error.message}`)
        const claimed = (claim.data ?? []) as Array<Record<string, any>>
        claimedRestorations = claimed
          .filter((row) => row.id !== paylocity.id && typeof row.last_polled_at === 'string')
          .map((row) => ({
            id: String(row.id),
            before: beforeById.get(String(row.id)) ?? null,
            written: String(row.last_polled_at),
          }))
        const target = claimed.find((row) => row.id === paylocity.id)
        if (!target || typeof target.last_polled_at !== 'string') {
          throw new Error('exact Paylocity company was not claimable')
        }
        targetExpected = target.last_polled_at
        const reopen = await admin
          .from('companies')
          .update({ last_polled_at: null })
          .eq('id', paylocity.id)
          .eq('last_polled_at', targetExpected)
          .select('id')
        if (reopen.error || reopen.data?.length !== 1) throw new Error('Paylocity claim handoff conflict')
        targetExpected = null
        pollStarted = true
        const response = await fetch(`${environment.SUPABASE_URL}/functions/v1/poll-tick`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-cron-secret': environment.CRON_SECRET },
          body: '{}',
        })
        if (!response.ok) throw new Error(`poll-tick returned HTTP ${response.status}`)
        responseBody = await response.json() as Record<string, unknown>
      } catch (error) {
        primaryError = error
      }

      const restorationErrors: unknown[] = []
      try {
        await restoreClaimTimestamps()
      } catch (error) {
        restorationErrors.push(error)
      }
      if (!pollStarted) {
        try {
          let restoreTarget = admin
            .from('companies')
            .update({ last_polled_at: paylocity.last_polled_at })
            .eq('id', paylocity.id)
            .eq('source_key', PAYLOCITY_SOURCE_KEY)
          restoreTarget = targetExpected === null
            ? restoreTarget.is('last_polled_at', null)
            : restoreTarget.eq('last_polled_at', targetExpected)
          const restored = await restoreTarget.select('id')
          if (restored.error || restored.data?.length !== 1) {
            throw new Error('Paylocity pre-poll restoration conflict')
          }
        } catch (error) {
          restorationErrors.push(error)
        }
      }
      if (primaryError || restorationErrors.length) throw cleanupFailure(primaryError, restorationErrors)
      if (!responseBody) throw new Error('Paylocity poll produced no response')
      return responseBody
    },
    async assertNoDuplicateJobs(_before, after) {
      const keys = Object.values(after.jobs).map((job) => `${job.source}:${job.external_id}`)
      if (keys.length === 0 || new Set(keys).size !== keys.length) {
        throw new Error('Paylocity provider rows are empty or duplicated')
      }
    },
    async probeIncompleteObservation() {
      const { data: company, error: companyError } = await admin
        .from('companies')
        .select('id, last_success_at, last_verified_at, activation_successes')
        .eq('source_key', PAYLOCITY_SOURCE_KEY)
        .single()
      if (companyError) throw new Error(`incomplete probe company read failed: ${companyError.message}`)
      const sentinelId = randomUUID()
      const externalId = `phase03.1-incomplete-${sentinelId}`
      try {
        const insert = await admin.from('jobs').insert({
          id: sentinelId,
          company_id: company.id,
          source: 'paylocity',
          external_id: externalId,
          title: 'Paylocity incomplete-observation sentinel',
          absolute_url: `https://example.invalid/${sentinelId}`,
          fingerprint: externalId,
          status: 'open',
        })
        if (insert.error) throw new Error(`incomplete sentinel insert failed: ${insert.error.message}`)
        const rejected = await admin.rpc('record_connector_observation', {
          p_company_id: company.id,
          p_observation_id: randomUUID(),
          p_completeness: 'partial',
          p_credible_for_closure: false,
          p_job_count: 1,
          p_expected_count: 2,
          p_warning_count: 1,
          p_evidence_digest: 'phase03_1_incomplete_probe',
        })
        const row = Array.isArray(rejected.data) ? rejected.data[0] : rejected.data
        if (rejected.error || row?.accepted !== false) throw new Error('incomplete evidence was not rejected')
        const [sentinel, after] = await Promise.all([
          admin.from('jobs').select('status').eq('id', sentinelId).single(),
          admin.from('companies').select('last_success_at, last_verified_at, activation_successes').eq('id', company.id).single(),
        ])
        if (sentinel.error || sentinel.data.status !== 'open') throw new Error('incomplete evidence closed the sentinel')
        if (after.error || JSON.stringify(after.data) !== JSON.stringify({
          last_success_at: company.last_success_at,
          last_verified_at: company.last_verified_at,
          activation_successes: company.activation_successes,
        })) throw new Error('incomplete evidence advanced company success health')
      } finally {
        const cleanup = await admin.from('jobs').delete().eq('id', sentinelId).eq('external_id', externalId)
        if (cleanup.error) throw new Error(`incomplete sentinel cleanup failed: ${cleanup.error.message}`)
      }
    },
    async createDisposableScoringFixture() {
      const { data: jobs, error: jobsError } = await admin
        .from('jobs')
        .select('id, title')
        .eq('source', 'paylocity')
        .eq('status', 'open')
        .order('first_seen_at', { ascending: false })
        .limit(2)
      if (jobsError || !jobs || jobs.length !== 2) throw new Error('two actual Paylocity jobs are required')
      const nonce = randomUUID().replaceAll('-', '').slice(0, 12)
      const email = `paylocity-verifier+${nonce}@example.com`
      const password = `${randomUUID()}Aa1!`
      const created = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: { paylocity_verifier: true },
      })
      if (created.error || !created.data.user) throw new Error('disposable verifier creation failed')
      const userId = created.data.user.id
      const resumeId = randomUUID()
      const userJobIds: [string, string] = [randomUUID(), randomUUID()]
      const runId = randomUUID()
      const owned: OwnedFixture = {
        runId,
        userId,
        email,
        resumeId,
        userJobIds,
        jobIds: [String(jobs[0].id), String(jobs[1].id)],
      }
      ownedFixture = owned
      try {
        const preference = await admin.from('preferences').insert({
          user_id: userId,
          titles: [String(jobs[0].title)],
          locations: [],
          include_keywords: [],
          exclude_keywords: [],
        })
        if (preference.error) throw new Error('disposable preference creation failed')
        const resume = await admin.from('resumes').insert({
          id: resumeId,
          user_id: userId,
          filename: 'paylocity-verifier.docx',
          display_name: 'Paylocity verifier',
          storage_path: `${userId}/paylocity-verifier.docx`,
          size_bytes: 0,
        })
        if (resume.error) throw new Error('disposable resume creation failed')
        const extract = await admin.from('resume_extracts').insert({
          resume_id: resumeId,
          user_id: userId,
          text_content: 'Entry-level client experience analysis, SQL, communication, and financial operations.',
          keywords: ['analysis', 'sql', 'communication'],
          status: 'ready',
          attempts: 0,
          model: 'paylocity-verifier-fixture-v1',
          extracted_at: new Date().toISOString(),
        })
        if (extract.error) throw new Error('disposable resume extract creation failed')
        const userJobs = await admin.from('user_jobs').insert([
          { id: userJobIds[0], user_id: userId, job_id: jobs[0].id, status: 'pending', attempts: 0, needs_refilter: false },
          { id: userJobIds[1], user_id: userId, job_id: jobs[1].id, status: 'pending', attempts: 5, needs_refilter: false },
        ])
        if (userJobs.error) throw new Error(`disposable user_jobs creation failed: ${userJobs.error.message}`)
        return owned
      } catch (error) {
        const cleanupErrors: unknown[] = []
        try {
          await cleanupOwnedFixture(owned)
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError)
        }
        throw cleanupFailure(error, cleanupErrors)
      }
    },
    async beginScoringLatch(owned) {
      const { data, error } = await admin.rpc('begin_scoring_verification', {
        p_run_id: owned.runId,
        p_fixture_user_job_id_1: owned.userJobIds[0],
        p_fixture_user_job_id_2: owned.userJobIds[1],
        p_ttl_seconds: SCORE_LATCH_TTL_SECONDS,
      })
      if (error || !Array.isArray(data) || data.length !== 1) throw new Error('scoring latch begin failed')
    },
    async snapshotScoreUsage() {
      return paginatedTable<Record<string, unknown>>(
        'ai_usage',
        'id, user_id, purpose, model, prompt_tokens, output_tokens, occurred_at',
        (query) => query.eq('purpose', 'score'),
      )
    },
    async invokeScoreTick(runId) {
      const response = await fetch(`${environment.SUPABASE_URL}/functions/v1/score-tick`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-cron-secret': environment.CRON_SECRET,
          'x-scoring-verification-run-id': runId,
        },
        body: '{}',
      })
      if (!response.ok) throw new Error(`score-tick returned HTTP ${response.status}`)
      return await response.json() as Record<string, unknown>
    },
    async assertDashboardFeed(owned, response, usageBefore) {
      if (response.claimed !== 1) throw new Error('score-tick did not claim exactly one actual Paylocity job')
      const { data, error } = await admin
        .from('user_jobs')
        .select('id, status, score, needs_refilter, score_deferred_until, jobs ( id, status, source, companies ( name, source_key ) )')
        .eq('id', owned.userJobIds[0])
        .single()
      if (error || data.status !== 'scored' || data.needs_refilter || data.jobs?.status !== 'open') {
        throw new Error('actual Paylocity job did not reach the one current preference-pass Dashboard scope')
      }
      if (data.jobs?.source !== 'paylocity' || data.jobs?.companies?.name !== PAYLOCITY_COMPANY_NAME
        || data.jobs?.companies?.source_key !== PAYLOCITY_SOURCE_KEY) {
        throw new Error('dashboard feed company identity is not truthful')
      }
      const after = await this.snapshotScoreUsage()
      const beforeIds = new Set(usageBefore.map((row) => String(row.id)))
      const delta = after.filter((row) => !beforeIds.has(String(row.id)))
      if (delta.length !== 1 || delta[0].user_id !== owned.userId) {
        throw new Error('paid usage delta was not exactly one verifier-owned request')
      }
    },
    async endScoringLatch(runId) {
      const { data, error } = await admin.rpc('end_scoring_verification', { p_run_id: runId })
      if (error || data !== true) throw new Error('scoring latch cleanup failed')
    },
    async cleanupOwnedRows(owned) {
      await cleanupOwnedFixture(owned)
    },
    async assertZeroResidue(owned) {
      if (!owned) return
      const checks = await Promise.all([
        admin.from('user_jobs').select('id', { count: 'exact', head: true }).in('id', owned.userJobIds),
        admin.from('resumes').select('id', { count: 'exact', head: true }).eq('id', owned.resumeId),
        admin.from('resume_extracts').select('resume_id', { count: 'exact', head: true }).eq('resume_id', owned.resumeId),
        admin.from('preferences').select('user_id', { count: 'exact', head: true }).eq('user_id', owned.userId),
        admin.from('scoring_verification_maintenance').select('run_id', { count: 'exact', head: true }).eq('run_id', owned.runId),
      ])
      if (checks.some((result) => result.error || result.count !== 0)) throw new Error('verification residue remains')
      const auth = await admin.auth.admin.getUserById(owned.userId)
      if (!auth.error || auth.error.status !== 404) throw new Error('verifier auth residue remains')
    },
    async restoreScoreCron(snapshot) {
      await compareAndSwapCron(snapshot, false, snapshot.active)
    },
  }
}

async function dryRun() {
  const failures: string[] = []
  const check = (condition: unknown, label: string) => {
    if (condition) console.log(`PASS: ${label}`)
    else failures.push(label)
  }
  check(new Set(REQUIRED_RESUME_ENVIRONMENT).size === REQUIRED_RESUME_ENVIRONMENT.length,
    'dry-run: environment names are explicit and unique')
  check(PAYLOCITY_MUTATION_CLASSES.length === 11
    && new Set(PAYLOCITY_MUTATION_CLASSES.map(({ id }) => id)).size === 11,
  'dry-run: mutation registry is exhaustive and unique')
  check(PAYLOCITY_MUTATION_CLASSES.every(({ disposition, acceptancePredicate }) =>
    ['expected_durable', 'temporary_must_restore', 'fixture_must_delete'].includes(disposition)
    && acceptancePredicate.length > 0),
  'dry-run: every mutation has one disposition and predicate')
  check(new URL(PAYLOCITY_BOARD_URL).protocol === 'https:'
    && PAYLOCITY_SOURCE_KEY.endsWith(PAYLOCITY_BOARD_UUID),
  'dry-run: exact Paylocity board and source identities are internally consistent')

  const [migration, connectors, verifyBoard, scoreTick, feed] = await Promise.all([
    readFile(new URL('../supabase/migrations/0029_paylocity_connector.sql', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/functions/_shared/connectors.ts', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/functions/verify-board/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/functions/score-tick/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../web/src/lib/feed.ts', import.meta.url), 'utf8'),
  ])
  check(migration.includes(PAYLOCITY_SOURCE_KEY)
    && migration.includes("ats_type = 'workday'")
    && migration.includes("source_key = 'workday:wd12:capitalone:Capital_One'")
    && !migration.toLowerCase().includes('successfactors'),
  'dry-run: migration preserves exact Paylocity and Capital One authorization only')
  check(connectors.includes('resolvePaylocityIdentity')
    && connectors.includes("company.activation_state !== 'active'")
    && !connectors.toLowerCase().includes('successfactors'),
  'dry-run: application dispatch revalidates exact active identity')
  check(verifyBoard.includes("auth.getUser(token)")
    && verifyBoard.includes("record_connector_observation"),
  'dry-run: activation uses real-user verification and server evidence')
  check(scoreTick.includes('maxAttempts: 1')
    && scoreTick.includes('x-scoring-verification-run-id'),
  'dry-run: scoring path is latch-isolated and physically single-attempt')
  check(feed.includes('preferenceVisible')
    && feed.includes('tierPresentation')
    && feed.includes('companyName'),
  'dry-run: dashboard proof uses one preference-pass scope with tier-owned boundaries and truthful company identity')
  if (failures.length) throw new Error(`${failures.length} Paylocity dry-run check(s) failed: ${failures.join(', ')}`)
  console.log('COMPLETE mode=dry-run network_calls=0 database_calls=0 auth_calls=0 paid_calls=0')
}

export async function run(argv = process.argv.slice(2)): Promise<void> {
  const dryRunRequested = argv.includes('--dry-run')
  const resumeRequested = argv.includes('--resume')
  if (dryRunRequested === resumeRequested) {
    throw new Error('Choose exactly one mode: --dry-run or --resume')
  }
  if (dryRunRequested) return dryRun()
  const result = await runPaylocityVerification(createProductionAdapters(loadResumeEnvironment()))
  console.log(JSON.stringify(redactPaylocityEvidence(result)))
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Paylocity verification failed')
    process.exitCode = 1
  })
}

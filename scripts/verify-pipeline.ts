import { createHash, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createClient } from '../web/node_modules/@supabase/supabase-js/dist/index.mjs'

const PIPELINE_REOPEN_PROBE_PREFIX = 'phase-02.1-reopen-probe-'
const PIPELINE_REOPEN_BOARD_TOKEN = 'planetscale'
const PIPELINE_REOPEN_SOURCE_KEY = 'greenhouse:global:planetscale'
const PIPELINE_REOPEN_MAX_JOBS = 25
const PIPELINE_REOPEN_DRAIN_ATTEMPTS = 20
const PIPELINE_REOPEN_OBSERVATION_ATTEMPTS = 12
const PIPELINE_REOPEN_OBSERVATION_DELAY_MS = 1_000
const PIPELINE_JOB_PAGE_SIZE = 1_000
const PIPELINE_JOB_COLUMNS = [
  'id',
  'company_id',
  'source',
  'external_id',
  'title',
  'location',
  'absolute_url',
  'posted_at',
  'description_html',
  'description_text',
  'snapshot_partial',
  'fingerprint',
  'status',
  'first_seen_at',
  'last_seen_at',
  'closed_at',
].join(', ')

export const PIPELINE_EVIDENCE_BEGIN = '---BEGIN PIPELINE EVIDENCE ENVELOPE---'
export const PIPELINE_EVIDENCE_END = '---END PIPELINE EVIDENCE ENVELOPE---'

export type PipelineMutationDisposition =
  | 'expected_durable'
  | 'temporary_must_restore'
  | 'fixture_must_delete'

export type PipelineMutationClassId =
  | 'optional_seed_creation'
  | 'seed_poll_timestamps'
  | 'provider_job_lifecycle'
  | 'provider_company_health'
  | 'pipeline_heartbeat'
  | 'discovery_sweep_primary'
  | 'adzuna_quota_and_jobs'
  | 'concurrent_claim_timestamps'
  | 'all_active_no_work_timestamps'
  | 'denied_rls_insert_cleanup'
  | 'planetscale_reopen_fixture'
  | 'discovery_sweep_health'
  | 'discovery_heartbeat'

export interface PipelineMutationClassDefinition {
  id: PipelineMutationClassId
  disposition: PipelineMutationDisposition
  acceptancePredicate: string
}

export const PIPELINE_MUTATION_CLASSES: readonly PipelineMutationClassDefinition[] = [
  {
    id: 'optional_seed_creation',
    disposition: 'expected_durable',
    acceptancePredicate: 'Only exact Stripe, Palantir, and Ramp identities may be added.',
  },
  {
    id: 'seed_poll_timestamps',
    disposition: 'expected_durable',
    acceptancePredicate: 'Seed/forced polls may advance polling timestamps after named calls.',
  },
  {
    id: 'provider_job_lifecycle',
    disposition: 'expected_durable',
    acceptancePredicate: 'Provider jobs may insert or change lifecycle fields; immutable fields never drift.',
  },
  {
    id: 'provider_company_health',
    disposition: 'expected_durable',
    acceptancePredicate: 'Named provider polls may update bounded company health fields.',
  },
  {
    id: 'pipeline_heartbeat',
    disposition: 'expected_durable',
    acceptancePredicate: 'Named poll ticks may advance pipeline tick/success timestamps.',
  },
  {
    id: 'discovery_sweep_primary',
    disposition: 'expected_durable',
    acceptancePredicate: 'The first named discovery response must reconcile to its persisted effects.',
  },
  {
    id: 'adzuna_quota_and_jobs',
    disposition: 'expected_durable',
    acceptancePredicate: 'Adzuna counters and legitimate job lifecycle effects are durable and attributed.',
  },
  {
    id: 'concurrent_claim_timestamps',
    disposition: 'temporary_must_restore',
    acceptancePredicate: 'Every claimed timestamp is CAS-restored or a conflict fails without overwrite.',
  },
  {
    id: 'all_active_no_work_timestamps',
    disposition: 'temporary_must_restore',
    acceptancePredicate: 'All-active overrides are CAS-restored or a conflict fails without overwrite.',
  },
  {
    id: 'denied_rls_insert_cleanup',
    disposition: 'fixture_must_delete',
    acceptancePredicate: 'The denied row never persists; an unexpectedly returned row is deleted by ID.',
  },
  {
    id: 'planetscale_reopen_fixture',
    disposition: 'fixture_must_delete',
    acceptancePredicate: 'Owned company, marker, source key, and returned job IDs have zero residue.',
  },
  {
    id: 'discovery_sweep_health',
    disposition: 'expected_durable',
    acceptancePredicate: 'The second named discovery response reconciles to its persisted health effects.',
  },
  {
    id: 'discovery_heartbeat',
    disposition: 'expected_durable',
    acceptancePredicate: 'Discovery timestamps/status advance only with the named discovery responses.',
  },
] as const

export interface PipelineFixtureResidue {
  reopenMarkers: number
  reopenSourceKeys: number
  reopenReturnedJobs: number
  deniedRlsRows: number
}

export interface PipelineEvidenceSnapshot {
  capturedAt: string
  label?: string
  seedIdentities: Record<string, Record<string, unknown>>
  activeCompanies: Record<string, Record<string, unknown>>
  jobs: Record<string, Record<string, unknown>>
  pipelineHeartbeat: Record<string, unknown>
  fixtureResidue: PipelineFixtureResidue
}

export interface PipelineFieldDiff {
  path: string
  before?: unknown
  after?: unknown
}

export interface PipelineRestorationResult {
  id: string
  restored: boolean
  conflict: boolean
  expected?: unknown
  observed?: unknown
}

export interface PipelineMutationRecord {
  mutationClass: PipelineMutationClassId
  disposition: PipelineMutationDisposition
  acceptancePredicate: string
  status: 'executed' | 'not_applicable'
  beforeAt: string
  observedAt?: string
  afterAt: string
  identifiers: string[]
  observedDiffs: PipelineFieldDiff[]
  finalDiffs: PipelineFieldDiff[]
  responseSummary?: Record<string, unknown>
  restorationResults: PipelineRestorationResult[]
  residueCounts?: Partial<PipelineFixtureResidue>
}

export interface PipelineEvidenceEnvelope {
  invocationId: string
  command: string
  entry: PipelineEvidenceSnapshot
  postDrain: PipelineEvidenceSnapshot | null
  final: PipelineEvidenceSnapshot | null
  records: PipelineMutationRecord[]
  allowedDurableDiffs: string[]
  restorationConflicts: string[]
  residueCounts: PipelineFixtureResidue
  immutableDrift: string[]
  unexplainedDiffs: string[]
  redactionFailures: string[]
  completedAllProbes: boolean
  success: boolean
}

const PIPELINE_IMMUTABLE_JOB_FIELDS = new Set([
  'source',
  'external_id',
  'title',
  'location',
  'absolute_url',
  'posted_at',
  'description_html_hash',
  'description_text_hash',
  'snapshot_partial',
  'fingerprint',
  'first_seen_at',
])

const PIPELINE_SECRET_KEYS = /^(?:authorization|cookie|password|service(?:_|)key|secret(?:_|)key|publishable(?:_|)key|cron(?:_|)secret|heartbeat(?:_|)secret|access(?:_|)token|refresh(?:_|)token)$/i

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export function redactPipelineEvidence(value: unknown, key = ''): unknown {
  if (PIPELINE_SECRET_KEYS.test(key)) return '[REDACTED]'
  if (typeof value === 'string') {
    const configuredSecrets = [
      process.env.SUPABASE_PUBLISHABLE_KEY,
      process.env.SUPABASE_SECRET_KEY,
      process.env.CRON_SECRET,
      process.env.HEARTBEAT_SECRET,
      process.env.SEED_PASSWORD_1,
    ].filter((secret): secret is string => Boolean(secret && secret.length >= 4))
    if (configuredSecrets.some((secret) => value.includes(secret))) return '[REDACTED]'
    if (value.length > 512) return { redacted: 'sha256', sha256: sha256(value), length: value.length }
    return value
  }
  if (Array.isArray(value)) return value.map((item) => redactPipelineEvidence(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
        childKey,
        redactPipelineEvidence(childValue, childKey),
      ]),
    )
  }
  return value
}

function diffPipelineValues(before: unknown, after: unknown, path = ''): PipelineFieldDiff[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return []
  const beforeObject = before && typeof before === 'object' && !Array.isArray(before)
  const afterObject = after && typeof after === 'object' && !Array.isArray(after)
  if (beforeObject || afterObject) {
    const beforeRecord = beforeObject ? before as Record<string, unknown> : {}
    const afterRecord = afterObject ? after as Record<string, unknown> : {}
    const keys = [...new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])].sort()
    return keys.flatMap((childKey) =>
      diffPipelineValues(
        beforeRecord[childKey],
        afterRecord[childKey],
        path ? `${path}.${childKey}` : childKey,
      )
    )
  }
  return [{ path, before, after }]
}

function mutationDefinition(mutationClass: PipelineMutationClassId) {
  const definition = PIPELINE_MUTATION_CLASSES.find(({ id }) => id === mutationClass)
  if (!definition) throw new Error(`Unregistered pipeline mutation class: ${mutationClass}`)
  return definition
}

export function createPipelineEvidenceEnvelope(
  invocationId: string,
  command: string,
  entry: PipelineEvidenceSnapshot,
): PipelineEvidenceEnvelope {
  return {
    invocationId,
    command,
    entry,
    postDrain: null,
    final: null,
    records: [],
    allowedDurableDiffs: [],
    restorationConflicts: [],
    residueCounts: { ...entry.fixtureResidue },
    immutableDrift: [],
    unexplainedDiffs: [],
    redactionFailures: [],
    completedAllProbes: false,
    success: false,
  }
}

export function journalPipelineMutation(
  envelope: PipelineEvidenceEnvelope,
  mutationClass: PipelineMutationClassId,
  before: PipelineEvidenceSnapshot,
  after: PipelineEvidenceSnapshot,
  details: {
    identifiers?: string[]
    observed?: PipelineEvidenceSnapshot
    responseSummary?: Record<string, unknown>
    restorationResults?: PipelineRestorationResult[]
    residueCounts?: Partial<PipelineFixtureResidue>
    status?: 'executed' | 'not_applicable'
  } = {},
) {
  const definition = mutationDefinition(mutationClass)
  envelope.records.push({
    mutationClass,
    disposition: definition.disposition,
    acceptancePredicate: definition.acceptancePredicate,
    status: details.status ?? 'executed',
    beforeAt: before.capturedAt,
    observedAt: details.observed?.capturedAt,
    afterAt: after.capturedAt,
    identifiers: details.identifiers ?? [],
    observedDiffs: diffPipelineValues(before, details.observed ?? after),
    finalDiffs: diffPipelineValues(before, after),
    responseSummary: details.responseSummary,
    restorationResults: details.restorationResults ?? [],
    residueCounts: details.residueCounts,
  })
}

function isImmutableJobDrift(diff: PipelineFieldDiff, entry: PipelineEvidenceSnapshot) {
  const match = /^jobs\.([^.]+)\.([^.]+)$/.exec(diff.path)
  return Boolean(match && entry.jobs[match[1]] && PIPELINE_IMMUTABLE_JOB_FIELDS.has(match[2]))
}

function diffLeaf(diff: PipelineFieldDiff) {
  return diff.path.split('.').at(-1) ?? ''
}

function diffEntityId(diff: PipelineFieldDiff, root: string) {
  const match = new RegExp(`^${root}\\.([^.]+)\\.`).exec(diff.path)
  return match?.[1]
}

const PIPELINE_COMPLETE_JOB_FIELDS = [
  'id',
  'company_id',
  'source',
  'external_id',
  'title',
  'location',
  'absolute_url',
  'posted_at',
  'description_html_hash',
  'description_text_hash',
  'snapshot_partial',
  'fingerprint',
  'status',
  'first_seen_at',
  'last_seen_at',
  'closed_at',
] as const

function hasObservedProviderActivity(record: PipelineMutationRecord) {
  const summary = record.responseSummary ?? {}
  const operation = typeof summary.operation === 'string' ? summary.operation : ''
  return (Array.isArray(summary.responses) && summary.responses.length > 0) ||
    (typeof summary.claimed === 'number' && summary.claimed > 0) ||
    (typeof summary.succeeded === 'number' && summary.succeeded > 0) ||
    ['bounded_due_work_drain', 'scheduled_cron_poll_observation'].includes(operation)
}

function isAttributedNewProviderJob(
  record: PipelineMutationRecord,
  jobId: string,
  entry: PipelineEvidenceSnapshot,
  final: PipelineEvidenceSnapshot,
) {
  if (entry.jobs[jobId]) return false
  const job = final.jobs[jobId]
  if (!job || !PIPELINE_COMPLETE_JOB_FIELDS.every((field) => field in job)) return false
  if (
    typeof job.company_id !== 'string' ||
    typeof job.source !== 'string' ||
    typeof job.external_id !== 'string' || job.external_id.length === 0 ||
    typeof job.title !== 'string' || job.title.length === 0 ||
    typeof job.absolute_url !== 'string' || job.absolute_url.length === 0 ||
    typeof job.fingerprint !== 'string' || job.fingerprint.length === 0 ||
    typeof job.first_seen_at !== 'string'
  ) return false

  const company = final.activeCompanies[job.company_id]
  if (
    !company ||
    company.id !== job.company_id ||
    company.activation_state !== 'active' ||
    company.ats_type !== job.source
  ) return false

  const firstSeenAt = Date.parse(job.first_seen_at)
  const beforeAt = Date.parse(record.beforeAt)
  const afterAt = Date.parse(record.afterAt)
  return Number.isFinite(firstSeenAt) &&
    Number.isFinite(beforeAt) &&
    Number.isFinite(afterAt) &&
    firstSeenAt >= beforeAt &&
    firstSeenAt <= afterAt &&
    hasObservedProviderActivity(record)
}

function isAllowedObservedDiff(
  record: PipelineMutationRecord,
  diff: PipelineFieldDiff,
  entry: PipelineEvidenceSnapshot,
  final: PipelineEvidenceSnapshot,
) {
  if (diff.path === 'capturedAt' || diff.path === 'label') return true
  const leaf = diffLeaf(diff)
  const companyId = diffEntityId(diff, 'activeCompanies') ?? diffEntityId(diff, 'seedIdentities')
  const jobId = diffEntityId(diff, 'jobs')
  const finalJob = jobId ? final.jobs[jobId] : undefined
  const attributedNewJob = Boolean(
    jobId && isAttributedNewProviderJob(record, jobId, entry, final),
  )
  switch (record.mutationClass) {
    case 'optional_seed_creation': {
      if (!companyId) return false
      const company = final.seedIdentities[companyId] ?? final.activeCompanies[companyId]
      return Boolean(company && seedBoards.some((seed) =>
        seed.source === company.ats_type && seed.boardToken === company.board_token
      ))
    }
    case 'seed_poll_timestamps':
      return Boolean(companyId && leaf === 'last_polled_at')
    case 'provider_job_lifecycle':
      return Boolean(
        jobId && finalJob?.source !== 'adzuna' &&
          (attributedNewJob || ['company_id', 'status', 'last_seen_at', 'closed_at'].includes(leaf)),
      )
    case 'provider_company_health':
      return Boolean(companyId && [
        'last_polled_at',
        'last_success_at',
        'consecutive_failures',
        'last_error',
        'last_error_code',
        'last_observation_count',
      ].includes(leaf))
    case 'pipeline_heartbeat':
      return ['pipelineHeartbeat.last_tick_at', 'pipelineHeartbeat.last_success_at'].includes(diff.path)
    case 'discovery_sweep_primary':
    case 'discovery_sweep_health':
      return false
    case 'adzuna_quota_and_jobs':
      return Boolean(
        ['pipelineHeartbeat.adzuna_requests_today', 'pipelineHeartbeat.adzuna_budget_date'].includes(
          diff.path,
        ) ||
          (jobId && finalJob?.source === 'adzuna' &&
            (!entry.jobs[jobId] || ['company_id', 'status', 'last_seen_at', 'closed_at'].includes(leaf))),
      )
    case 'discovery_heartbeat':
      return [
        'pipelineHeartbeat.last_discovery_at',
        'pipelineHeartbeat.last_discovery_success_at',
        'pipelineHeartbeat.discovery_status',
        'pipelineHeartbeat.last_discovery_slot',
      ].includes(diff.path)
    case 'concurrent_claim_timestamps':
    case 'all_active_no_work_timestamps':
      return Boolean(companyId && leaf === 'last_polled_at')
    case 'denied_rls_insert_cleanup':
    case 'planetscale_reopen_fixture':
      return true
  }
}

export function finalizePipelineEvidenceEnvelope(
  envelope: PipelineEvidenceEnvelope,
  final: PipelineEvidenceSnapshot,
) {
  envelope.final = final
  const missingMutationClasses = PIPELINE_MUTATION_CLASSES
    .filter((definition) =>
      !envelope.records.some(({ mutationClass }) => mutationClass === definition.id)
    )
    .map(({ id }) => id)
  for (const definition of PIPELINE_MUTATION_CLASSES) {
    if (!envelope.records.some(({ mutationClass }) => mutationClass === definition.id)) {
      journalPipelineMutation(envelope, definition.id, final, final, { status: 'not_applicable' })
    }
  }

  const finalDiffs = diffPipelineValues(envelope.entry, final)
    .filter(({ path }) => path !== 'capturedAt' && path !== 'label')
  const allowedObservedPaths = new Set(
    envelope.records.flatMap((record) =>
      record.observedDiffs
        .filter((diff) => isAllowedObservedDiff(record, diff, envelope.entry, final))
        .map(({ path }) => path)
    ),
  )
  const durablePaths = new Set(
    envelope.records
      .filter(({ disposition, status }) => disposition === 'expected_durable' && status === 'executed')
      .flatMap((record) => record.observedDiffs
        .filter((diff) => isAllowedObservedDiff(record, diff, envelope.entry, final))
        .map(({ path }) => path)),
  )
  envelope.allowedDurableDiffs = [...new Set(finalDiffs
    .filter(({ path }) => durablePaths.has(path))
    .map(({ path }) => path))].sort()
  envelope.restorationConflicts = [...new Set(envelope.records
    .flatMap(({ restorationResults }) => restorationResults)
    .filter(({ restored, conflict }) => !restored || conflict)
    .map(({ id }) => id))].sort()
  envelope.residueCounts = envelope.records.reduce<PipelineFixtureResidue>(
    (residue, record) => ({
      reopenMarkers: Math.max(residue.reopenMarkers, record.residueCounts?.reopenMarkers ?? 0),
      reopenSourceKeys: Math.max(residue.reopenSourceKeys, record.residueCounts?.reopenSourceKeys ?? 0),
      reopenReturnedJobs: Math.max(
        residue.reopenReturnedJobs,
        record.residueCounts?.reopenReturnedJobs ?? 0,
      ),
      deniedRlsRows: Math.max(residue.deniedRlsRows, record.residueCounts?.deniedRlsRows ?? 0),
    }),
    { ...final.fixtureResidue },
  )
  envelope.immutableDrift = [...new Set([
    ...finalDiffs,
    ...envelope.records.flatMap(({ observedDiffs }) => observedDiffs),
  ]
    .filter((diff) => isImmutableJobDrift(diff, envelope.entry))
    .map(({ path }) => path))].sort()
  const unexplainedObservedDiffs = envelope.records
    .flatMap(({ observedDiffs }) => observedDiffs)
    .filter(({ path }) => path !== 'capturedAt' && path !== 'label' && !allowedObservedPaths.has(path))
    .map(({ path }) => path)
  envelope.unexplainedDiffs = [...new Set([
    ...finalDiffs.filter(({ path }) => !durablePaths.has(path)).map(({ path }) => path),
    ...unexplainedObservedDiffs,
    ...(envelope.completedAllProbes
      ? missingMutationClasses.map((mutationClass) => `registry.${mutationClass}.missing`)
      : []),
  ])].sort()
  const redactedJson = JSON.stringify(redactPipelineEvidence(envelope))
  const forbiddenValues = [
    process.env.SUPABASE_PUBLISHABLE_KEY,
    process.env.SUPABASE_SECRET_KEY,
    process.env.CRON_SECRET,
    process.env.HEARTBEAT_SECRET,
    process.env.SEED_PASSWORD_1,
  ].filter((value): value is string => Boolean(value && value.length >= 4))
  envelope.redactionFailures = forbiddenValues.filter((value) => redactedJson.includes(value))
  envelope.success =
    envelope.restorationConflicts.length === 0 &&
    Object.values(envelope.residueCounts).every((count) => count === 0) &&
    envelope.immutableDrift.length === 0 &&
    envelope.unexplainedDiffs.length === 0 &&
    envelope.redactionFailures.length === 0
  return envelope
}

interface GreenhouseFixtureJob {
  id: number
  title: string
  absolute_url: string
  first_published?: string | null
  location?: { name?: string | null } | null
}

interface ReopenFixtureState {
  marker: string
  companyId: string | null
  jobId: string | null
  externalIds: string[]
}

const required = [
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'CRON_SECRET',
  'HEARTBEAT_SECRET',
  'USER1_EMAIL',
  'SEED_PASSWORD_1',
] as const

const seedBoards = [
  {
    label: 'Stripe',
    url: 'https://boards.greenhouse.io/stripe',
    source: 'greenhouse',
    boardToken: 'stripe',
  },
  {
    label: 'Palantir',
    url: 'https://jobs.lever.co/palantir',
    source: 'lever',
    boardToken: 'palantir',
  },
  {
    label: 'Ramp',
    url: 'https://jobs.ashbyhq.com/ramp',
    source: 'ashby',
    boardToken: 'ramp',
  },
] as const

function requiredEnvironment() {
  for (const name of required) {
    if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`)
  }
  return {
    url: process.env.SUPABASE_URL!,
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY!,
    secretKey: process.env.SUPABASE_SECRET_KEY!,
    cronSecret: process.env.CRON_SECRET!,
    heartbeatSecret: process.env.HEARTBEAT_SECRET!,
    user: {
      email: process.env.USER1_EMAIL!,
      password: process.env.SEED_PASSWORD_1!,
    },
  }
}

function client(url: string, key: string) {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
}

function recordsById(rows: Record<string, unknown>[]) {
  return Object.fromEntries(rows.map((row) => [String(row.id), row]))
}

export async function collectPipelineJobRows<T extends { id: unknown }>(
  loadPage: (
    afterId: string | null,
    limit: number,
  ) => Promise<{ data: T[] | null; error: unknown }>,
  pageSize = PIPELINE_JOB_PAGE_SIZE,
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error('Pipeline job snapshot page size must be a positive integer')
  }

  const rows: T[] = []
  let afterId: string | null = null
  while (true) {
    const { data, error } = await loadPage(afterId, pageSize)
    if (error) throw error
    const page = data ?? []
    if (page.length > pageSize) {
      throw new Error('Pipeline job snapshot page exceeded its requested limit')
    }

    let previousId = afterId
    for (const row of page) {
      if (typeof row.id !== 'string' || row.id.length === 0) {
        throw new Error('Pipeline job snapshot encountered a missing job ID')
      }
      if (previousId !== null && row.id <= previousId) {
        throw new Error('Pipeline job snapshot pages must be strictly ordered by job ID')
      }
      previousId = row.id
      rows.push(row)
    }

    if (page.length < pageSize) return rows
    afterId = previousId
  }
}

async function selectAllPipelineJobs(admin: ReturnType<typeof client>) {
  return collectPipelineJobRows<Record<string, unknown>>(async (afterId, limit) => {
    let query = admin
      .from('jobs')
      .select(PIPELINE_JOB_COLUMNS)
      .order('id', { ascending: true })
    if (afterId !== null) query = query.gt('id', afterId)
    const { data, error } = await query.limit(limit)
    return { data: data as Record<string, unknown>[] | null, error }
  })
}

export async function capturePipelineEvidenceSnapshot(
  admin: ReturnType<typeof client>,
  label: string,
  fixture?: ReopenFixtureState,
  deniedRlsExternalId?: string,
): Promise<PipelineEvidenceSnapshot> {
  const [companiesResult, jobRowsResult, heartbeatResult] = await Promise.all([
    admin.from('companies').select([
      'id',
      'name',
      'ats_type',
      'board_token',
      'region',
      'site_token',
      'source_key',
      'careers_url',
      'activation_state',
      'activation_successes',
      'last_verified_at',
      'last_polled_at',
      'last_success_at',
      'consecutive_failures',
      'last_error',
      'last_error_code',
      'last_observation_count',
    ].join(', ')).order('id', { ascending: true }),
    selectAllPipelineJobs(admin),
    admin.from('pipeline_heartbeat').select('*').eq('id', true).single(),
  ])
  if (companiesResult.error) throw companiesResult.error
  if (heartbeatResult.error) throw heartbeatResult.error

  const companyRows = (companiesResult.data ?? []) as Record<string, unknown>[]
  const jobRows = jobRowsResult.map((row) => ({
    ...row,
    description_html_hash: typeof row.description_html === 'string'
      ? sha256(row.description_html)
      : null,
    description_text_hash: typeof row.description_text === 'string'
      ? sha256(row.description_text)
      : null,
    description_html: undefined,
    description_text: undefined,
  }))
  const seedRows = companyRows.filter((company) =>
    seedBoards.some((board) =>
      board.source === company.ats_type && board.boardToken === company.board_token
    )
  )
  const activeRows = companyRows.filter((company) => company.activation_state === 'active')

  const returnedJobsQuery = fixture?.externalIds.length
    ? admin.from('jobs').select('*', { count: 'exact', head: true })
      .eq('source', 'greenhouse').in('external_id', fixture.externalIds)
    : admin.from('jobs').select('*', { count: 'exact', head: true })
      .like('fingerprint', `${PIPELINE_REOPEN_PROBE_PREFIX}%`)
  const deniedRowsQuery = deniedRlsExternalId
    ? admin.from('jobs').select('*', { count: 'exact', head: true })
      .eq('external_id', deniedRlsExternalId)
    : admin.from('jobs').select('*', { count: 'exact', head: true })
      .like('external_id', 'rls-probe-%')
  const [markerResult, sourceResult, returnedJobsResult, deniedRowsResult] = await Promise.all([
    admin.from('companies').select('*', { count: 'exact', head: true })
      .like('name', `${PIPELINE_REOPEN_PROBE_PREFIX}%`),
    admin.from('companies').select('*', { count: 'exact', head: true })
      .eq('source_key', PIPELINE_REOPEN_SOURCE_KEY),
    returnedJobsQuery,
    deniedRowsQuery,
  ])
  if (markerResult.error) throw markerResult.error
  if (sourceResult.error) throw sourceResult.error
  if (returnedJobsResult.error) throw returnedJobsResult.error
  if (deniedRowsResult.error) throw deniedRowsResult.error

  return {
    capturedAt: new Date().toISOString(),
    seedIdentities: recordsById(seedRows),
    activeCompanies: recordsById(activeRows),
    jobs: recordsById(jobRows),
    pipelineHeartbeat: heartbeatResult.data as Record<string, unknown>,
    fixtureResidue: {
      reopenMarkers: markerResult.count ?? 0,
      reopenSourceKeys: sourceResult.count ?? 0,
      reopenReturnedJobs: returnedJobsResult.count ?? 0,
      deniedRlsRows: deniedRowsResult.count ?? 0,
    },
    label,
  } as PipelineEvidenceSnapshot
}

function assert(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${label}`)
  console.log(`PASS: ${label}`)
}

async function restoreCompanyPollTimestampCas(
  admin: ReturnType<typeof client>,
  id: string,
  expectedCurrent: string,
  previous: string | null,
): Promise<PipelineRestorationResult> {
  const { data, error } = await admin
    .from('companies')
    .update({ last_polled_at: previous })
    .eq('id', id)
    .eq('last_polled_at', expectedCurrent)
    .select('id, last_polled_at')
  if (error) throw error
  if ((data?.length ?? 0) === 1) {
    return { id, restored: true, conflict: false, expected: previous, observed: previous }
  }
  const { data: current, error: currentError } = await admin
    .from('companies')
    .select('last_polled_at')
    .eq('id', id)
    .single()
  if (currentError) throw currentError
  return {
    id,
    restored: false,
    conflict: true,
    expected: expectedCurrent,
    observed: current.last_polled_at,
  }
}

async function postTick(url: string, cronSecret?: string) {
  const response = await fetch(`${url}/functions/v1/poll-tick`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cronSecret ? { 'x-cron-secret': cronSecret } : {}),
    },
    body: '{}',
  })
  return response
}

async function postDiscoverySweep(url: string, cronSecret: string) {
  return fetch(`${url}/functions/v1/discovery-sweep`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-cron-secret': cronSecret,
    },
    body: '{}',
  })
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function normalizedProviderDate(value: string | null | undefined) {
  return value ? new Date(value).toISOString() : null
}

async function fetchReopenFixtureJobs() {
  const response = await fetch(
    `https://boards-api.greenhouse.io/v1/boards/${PIPELINE_REOPEN_BOARD_TOKEN}/jobs`,
  )
  if (!response.ok) throw new Error(`PlanetScale fixture board returned HTTP ${response.status}`)
  const payload = await response.json() as { jobs?: GreenhouseFixtureJob[] }
  if (!Array.isArray(payload.jobs)) throw new Error('PlanetScale fixture board schema drifted')
  if (payload.jobs.length === 0 || payload.jobs.length > PIPELINE_REOPEN_MAX_JOBS) {
    throw new Error(
      `PlanetScale fixture board must contain 1-${PIPELINE_REOPEN_MAX_JOBS} jobs; received ${payload.jobs.length}`,
    )
  }
  const externalIds = payload.jobs.map((job) => String(job.id))
  if (new Set(externalIds).size !== externalIds.length) {
    throw new Error('PlanetScale fixture board returned duplicate job IDs')
  }
  return { jobs: payload.jobs, externalIds }
}

async function assertReopenFixtureAvailable(
  admin: ReturnType<typeof client>,
  externalIds: string[],
) {
  const [sourceKey, identity, jobs] = await Promise.all([
    admin.from('companies').select('id').eq('source_key', PIPELINE_REOPEN_SOURCE_KEY),
    admin.from('companies').select('id')
      .eq('ats_type', 'greenhouse')
      .eq('board_token', PIPELINE_REOPEN_BOARD_TOKEN),
    admin.from('jobs').select('id').eq('source', 'greenhouse').in('external_id', externalIds),
  ])
  if (sourceKey.error) throw sourceKey.error
  if (identity.error) throw identity.error
  if (jobs.error) throw jobs.error
  if ((sourceKey.data?.length ?? 0) > 0 || (identity.data?.length ?? 0) > 0) {
    throw new Error('PlanetScale fixture company identity already exists; refusing writes')
  }
  if ((jobs.data?.length ?? 0) > 0) {
    throw new Error('PlanetScale fixture job ID collides with a pre-existing row; refusing writes')
  }
}

async function drainDueCompanies(
  url: string,
  cronSecret: string,
) {
  const responses: Array<Record<string, unknown>> = []
  for (let attempt = 0; attempt < PIPELINE_REOPEN_DRAIN_ATTEMPTS; attempt += 1) {
    const response = await postTick(url, cronSecret)
    if (!response.ok) throw new Error(`pre-fixture poll-tick returned HTTP ${response.status}`)
    const body = await response.json() as Record<string, unknown> & { claimed?: number }
    responses.push({ attempt: attempt + 1, httpStatus: response.status, ...body })
    if (body.claimed === 0) return responses
  }
  throw new Error('Active company drain exceeded its bounded attempt budget')
}

async function snapshotRealJobs(admin: ReturnType<typeof client>) {
  return selectAllPipelineJobs(admin)
}

async function assertRealJobsUnchanged(
  admin: ReturnType<typeof client>,
  baseline: Awaited<ReturnType<typeof snapshotRealJobs>>,
) {
  const current = await snapshotRealJobs(admin)
  assert(
    JSON.stringify(current) === JSON.stringify(baseline),
    'probe 15: every pre-existing job matches the post-drain baseline',
  )
}

async function cleanupReopenFixture(
  admin: ReturnType<typeof client>,
  fixture: ReopenFixtureState,
) {
  if (fixture.companyId) {
    const { error: jobError } = await admin.from('jobs').delete()
      .eq('company_id', fixture.companyId)
      .eq('source', 'greenhouse')
      .in('external_id', fixture.externalIds)
    if (jobError) throw jobError
    const { error: companyError } = await admin.from('companies').delete()
      .eq('id', fixture.companyId)
      .eq('source_key', PIPELINE_REOPEN_SOURCE_KEY)
      .eq('name', fixture.marker)
    if (companyError) throw companyError
  }
}

async function assertReopenFixtureRemoved(
  admin: ReturnType<typeof client>,
  fixture: ReopenFixtureState,
) {
  const [markerCompanies, sourceCompanies, returnedJobs] = await Promise.all([
    admin.from('companies').select('*', { count: 'exact', head: true }).eq('name', fixture.marker),
    admin.from('companies').select('*', { count: 'exact', head: true })
      .eq('source_key', PIPELINE_REOPEN_SOURCE_KEY),
    admin.from('jobs').select('*', { count: 'exact', head: true })
      .eq('source', 'greenhouse')
      .in('external_id', fixture.externalIds),
  ])
  if (markerCompanies.error) throw markerCompanies.error
  if (sourceCompanies.error) throw sourceCompanies.error
  if (returnedJobs.error) throw returnedJobs.error
  assert(
    (markerCompanies.count ?? 0) === 0 &&
      (sourceCompanies.count ?? 0) === 0 &&
      (returnedJobs.count ?? 0) === 0,
    'probe 15: no marked company or returned-ID fixture row remains',
  )
}

function immutableFixtureSnapshot(row: Record<string, unknown>) {
  const { status: _status, closed_at: _closedAt, last_seen_at: _lastSeenAt, ...immutable } = row
  return immutable
}

async function runReopenFixtureProbe(
  admin: ReturnType<typeof client>,
  url: string,
  cronSecret: string,
  evidence: PipelineEvidenceEnvelope,
) {
  const fixtureBoard = await fetchReopenFixtureJobs()
  await assertReopenFixtureAvailable(admin, fixtureBoard.externalIds)
  const beforeDrain = await capturePipelineEvidenceSnapshot(admin, 'before_post_drain')
  const drainResponses = await drainDueCompanies(url, cronSecret)
  const postDrain = await capturePipelineEvidenceSnapshot(admin, 'post_drain')
  evidence.postDrain = postDrain
  for (const mutationClass of [
    'seed_poll_timestamps',
    'provider_job_lifecycle',
    'provider_company_health',
    'pipeline_heartbeat',
  ] as const) {
    journalPipelineMutation(evidence, mutationClass, beforeDrain, postDrain, {
      responseSummary: {
        operation: 'bounded_due_work_drain',
        maxAttempts: PIPELINE_REOPEN_DRAIN_ATTEMPTS,
        responses: drainResponses,
      },
    })
  }
  const realJobBaseline = await snapshotRealJobs(admin)
  const marker = `${PIPELINE_REOPEN_PROBE_PREFIX}${Date.now()}-${randomUUID()}`
  const fixture: ReopenFixtureState = {
    marker,
    companyId: null,
    jobId: null,
    externalIds: fixtureBoard.externalIds,
  }
  let observedFixture = postDrain
  let reopenResponseSummary: Record<string, unknown> = { status: 'not_called' }

  try {
    const { data: company, error: companyError } = await admin.from('companies').insert({
      name: marker,
      ats_type: 'greenhouse',
      board_token: PIPELINE_REOPEN_BOARD_TOKEN,
      region: null,
      careers_url: 'https://job-boards.greenhouse.io/planetscale',
      source_key: PIPELINE_REOPEN_SOURCE_KEY,
      activation_state: 'active',
      last_polled_at: null,
      last_success_at: null,
    }).select('id').single()
    if (companyError) throw companyError
    fixture.companyId = company.id

    const providerJob = fixtureBoard.jobs[0]
    const firstSeenAt = new Date(Date.now() - 60 * 60_000).toISOString()
    const closedAt = new Date(Date.now() - 40 * 60_000).toISOString()
    const { data: job, error: jobError } = await admin.from('jobs').insert({
      company_id: fixture.companyId,
      source: 'greenhouse',
      external_id: String(providerJob.id),
      title: providerJob.title.trim(),
      location: providerJob.location?.name?.trim() || null,
      absolute_url: providerJob.absolute_url,
      posted_at: normalizedProviderDate(providerJob.first_published),
      description_html: null,
      description_text: null,
      snapshot_partial: false,
      fingerprint: `${PIPELINE_REOPEN_PROBE_PREFIX}${randomUUID()}`,
      status: 'closed',
      first_seen_at: firstSeenAt,
      last_seen_at: firstSeenAt,
      closed_at: closedAt,
    }).select(PIPELINE_JOB_COLUMNS).single()
    if (jobError) throw jobError
    fixture.jobId = job.id
    const immutableBefore = immutableFixtureSnapshot(job as Record<string, unknown>)
    const lastSeenBefore = new Date(job.last_seen_at).getTime()

    const reopenResponse = await postTick(url, cronSecret)
    if (!reopenResponse.ok) {
      throw new Error(`reopen fixture poll-tick returned HTTP ${reopenResponse.status}`)
    }
    const reopenBody = await reopenResponse.json() as Record<string, unknown>
    reopenResponseSummary = { httpStatus: reopenResponse.status, ...reopenBody }

    let reopenedJob: Record<string, unknown> | null = null
    for (let attempt = 0; attempt < PIPELINE_REOPEN_OBSERVATION_ATTEMPTS; attempt += 1) {
      const { data: observed, error: observedError } = await admin.from('jobs')
        .select(PIPELINE_JOB_COLUMNS)
        .eq('id', fixture.jobId)
        .single()
      if (observedError) throw observedError
      if (
        observed.status === 'open' &&
        observed.closed_at === null &&
        new Date(observed.last_seen_at).getTime() > lastSeenBefore
      ) {
        reopenedJob = observed as Record<string, unknown>
        break
      }
      await sleep(PIPELINE_REOPEN_OBSERVATION_DELAY_MS)
    }
    assert(Boolean(reopenedJob), 'probe 15: deployed poll-tick reopens the owned exact-ID fixture')
    assert(
      JSON.stringify(immutableFixtureSnapshot(reopenedJob!)) === JSON.stringify(immutableBefore),
      'probe 15: reopen preserves every immutable first-sight field',
    )
    observedFixture = await capturePipelineEvidenceSnapshot(
      admin,
      'planetscale_fixture_observed',
      fixture,
    )
  } finally {
    await cleanupReopenFixture(admin, fixture)
    await assertReopenFixtureRemoved(admin, fixture)
    await assertRealJobsUnchanged(admin, realJobBaseline)
    const afterFixture = await capturePipelineEvidenceSnapshot(
      admin,
      'planetscale_fixture_cleaned',
      fixture,
    )
    journalPipelineMutation(evidence, 'planetscale_reopen_fixture', postDrain, afterFixture, {
      identifiers: [fixture.marker, PIPELINE_REOPEN_SOURCE_KEY, ...fixture.externalIds],
      observed: observedFixture,
      residueCounts: afterFixture.fixtureResidue,
      responseSummary: {
        companyId: fixture.companyId,
        jobId: fixture.jobId,
        returnedJobCount: fixture.externalIds.length,
        pollTick: reopenResponseSummary,
      },
    })
  }
}

async function ensureSeeds(
  admin: ReturnType<typeof client>,
  userClient: ReturnType<typeof client>,
) {
  for (const board of seedBoards) {
    const { data: existing, error: lookupError } = await admin
      .from('companies')
      .select('id')
      .eq('ats_type', board.source)
      .eq('board_token', board.boardToken)
      .maybeSingle()
    if (lookupError) throw lookupError
    if (existing) continue

    const { data: rawVerified, error: verifyError } = await userClient.functions.invoke('verify-board', {
      body: { url: board.url },
    })
    const verified = rawVerified as null | {
      ok?: boolean
      company?: { id?: string }
    }
    if (verifyError || !verified?.ok || !verified.company?.id) {
      throw verifyError ?? new Error(`${board.label} board verification failed`)
    }

    const { data: persisted, error: persistedError } = await admin
      .from('companies')
      .select('id, ats_type, board_token')
      .eq('id', verified.company.id)
      .single()
    if (
      persistedError ||
      persisted?.ats_type !== board.source ||
      persisted?.board_token !== board.boardToken
    ) {
      throw persistedError ?? new Error(`${board.label} persisted seed identity drifted`)
    }
  }
}

export async function runPipelineVerification() {
  const environment = requiredEnvironment()
  const admin = client(environment.url, environment.secretKey)
  const userClient = client(environment.url, environment.publishableKey)
  const { data: auth, error: authError } = await userClient.auth.signInWithPassword(environment.user)
  if (authError || !auth.user) throw authError ?? new Error('Verification user authentication failed')

  const invocationId = randomUUID()
  const entry = await capturePipelineEvidenceSnapshot(admin, 'entry')
  const evidence = createPipelineEvidenceEnvelope(
    invocationId,
    'node --env-file=scripts/.env --experimental-strip-types scripts/verify-pipeline.ts',
    entry,
  )
  let lastSnapshot = entry
  const captureDurableMutation = async (
    label: string,
    mutationClasses: readonly PipelineMutationClassId[],
    details: { identifiers?: string[]; responseSummary?: Record<string, unknown> } = {},
  ) => {
    const after = await capturePipelineEvidenceSnapshot(admin, label)
    for (const mutationClass of mutationClasses) {
      journalPipelineMutation(evidence, mutationClass, lastSnapshot, after, details)
    }
    lastSnapshot = after
    return after
  }

  let unexpectedProbeId: string | undefined
  let executionFailure: unknown
  try {
    await ensureSeeds(admin, userClient)
    await captureDurableMutation('after_optional_seed_creation', ['optional_seed_creation'], {
      identifiers: seedBoards.map(({ source, boardToken }) => `${source}:${boardToken}`),
      responseSummary: { acceptedSeeds: seedBoards.length },
    })
    const { data: companyRows, error: companiesError } = await admin
      .from('companies')
      .select('id, name, ats_type, board_token, last_polled_at, last_success_at, consecutive_failures')
      .in('board_token', seedBoards.map((board) => board.boardToken))
    if (companiesError) throw companiesError
    const companies = (companyRows ?? []).filter((company) =>
      seedBoards.some(
        (board) => board.source === company.ats_type && board.boardToken === company.board_token,
      ),
    )
    assert(
      seedBoards.every((board) =>
        companies.some(
          (company) =>
            company.ats_type === board.source && company.board_token === board.boardToken,
        ),
      ),
      'probe 1: Stripe, Palantir, and Ramp seed companies exist',
    )

    const seedIds = companies.map((company) => company.id)
    const { count: seedJobCountBefore, error: seedJobCountBeforeError } = await admin
      .from('jobs')
      .select('*', { count: 'exact', head: true })
      .in('company_id', seedIds)
    if (seedJobCountBeforeError) throw seedJobCountBeforeError
    if (seedIds.length !== seedBoards.length) {
      throw new Error('Seed identity snapshot is incomplete; refusing destructive probes')
    }
    await admin.from('companies').update({ last_polled_at: null }).in('id', seedIds)
    let polledCompanies: typeof companies = []
    const seedPollResponses: Array<Record<string, unknown>> = []
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await postTick(environment.url, environment.cronSecret)
      if (!response.ok) throw new Error(`poll-tick returned HTTP ${response.status}`)
      const responseBody = await response.json() as Record<string, unknown>
      seedPollResponses.push({ attempt: attempt + 1, httpStatus: response.status, ...responseBody })
      const { data: refreshed, error: refreshError } = await admin
        .from('companies')
        .select('id, name, ats_type, board_token, last_polled_at, last_success_at, consecutive_failures')
        .in('id', seedIds)
      if (refreshError) throw refreshError
      polledCompanies = refreshed
      if (refreshed.every((company) => company.last_polled_at)) break
    }
    assert(
      polledCompanies.length === seedIds.length && polledCompanies.every((company) => company.last_polled_at),
      'probe 2: poll-tick claimed and polled all three seeded companies',
    )

    const { data: jobs, error: jobsError } = await admin
      .from('jobs')
      .select('source, description_html, description_text, fingerprint, snapshot_partial, status')
      .in('company_id', seedIds)
      .eq('status', 'open')
    if (jobsError) throw jobsError
    assert(
      seedBoards.every((board) => jobs?.some((job) => job.source === board.source)) &&
        jobs?.every((job) =>
          Boolean(job.description_html && job.description_text && job.fingerprint) &&
          job.snapshot_partial === false && job.status === 'open'),
      'probe 3: all ATS sources have open jobs with complete first-sight snapshots',
    )
    await captureDurableMutation('after_seed_polling', [
      'seed_poll_timestamps',
      'provider_job_lifecycle',
      'provider_company_health',
      'pipeline_heartbeat',
    ], {
      identifiers: seedIds,
      responseSummary: { probes: [2, 3], responses: seedPollResponses },
    })

    const forcedCompany = polledCompanies[0]
    const { data: jobsBefore, error: beforeError } = await admin
      .from('jobs')
      .select('source, external_id')
      .eq('company_id', forcedCompany.id)
      .order('source', { ascending: true })
      .order('external_id', { ascending: true })
    if (beforeError) throw beforeError
    const identitiesBefore = (jobsBefore ?? []).map(
      (job) => `${job.source}|${job.external_id}`,
    )
    const { error: forceError } = await admin
      .from('companies')
      .update({ last_polled_at: null })
      .eq('id', forcedCompany.id)
    if (forceError) throw forceError
    const repeat = await postTick(environment.url, environment.cronSecret)
    if (!repeat.ok) throw new Error(`repeat poll-tick returned HTTP ${repeat.status}`)
    const repeatBody = await repeat.json() as Record<string, unknown>
    const { data: jobsAfter, error: afterError } = await admin
      .from('jobs')
      .select('source, external_id')
      .eq('company_id', forcedCompany.id)
      .order('source', { ascending: true })
      .order('external_id', { ascending: true })
    if (afterError) throw afterError
    const identitiesAfter = (jobsAfter ?? []).map(
      (job) => `${job.source}|${job.external_id}`,
    )
    assert(
      identitiesBefore.length > 0 &&
        identitiesAfter.length === new Set(identitiesAfter).size &&
        JSON.stringify(identitiesBefore) === JSON.stringify(identitiesAfter),
      'probe 4: repeated polling preserves exactly one row per forced-company job identity',
    )
    await captureDurableMutation('after_forced_company_poll', [
      'seed_poll_timestamps',
      'provider_job_lifecycle',
      'provider_company_health',
      'pipeline_heartbeat',
    ], {
      identifiers: [forcedCompany.id],
      responseSummary: { httpStatus: repeat.status, probe: 4, ...repeatBody },
    })

    const { data: heartbeat, error: heartbeatError } = await admin
      .from('pipeline_heartbeat')
      .select('last_tick_at, last_success_at')
      .eq('id', true)
      .single()
    if (heartbeatError) throw heartbeatError
    const freshnessCutoff = Date.now() - 5 * 60_000
    assert(
      new Date(heartbeat.last_tick_at).getTime() >= freshnessCutoff &&
        new Date(heartbeat.last_success_at).getTime() >= freshnessCutoff,
      'probe 5: pipeline tick and success heartbeat timestamps are fresh',
    )

    const { data: health, error: healthError } = await admin
      .from('companies')
      .select('last_success_at, consecutive_failures')
      .in('id', seedIds)
    if (healthError) throw healthError
    assert(
      health?.length === seedIds.length &&
        health.every((company) => company.last_success_at && company.consecutive_failures === 0),
      'probe 6: all seeded companies report successful healthy polls',
    )

    const [missingSecret, wrongSecret] = await Promise.all([
      postTick(environment.url),
      postTick(environment.url, 'definitely-wrong-secret'),
    ])
    assert(
      missingSecret.status === 401 && wrongSecret.status === 401,
      'probe 7: missing or incorrect cron secret is rejected with HTTP 401',
    )

    const externalId = `rls-probe-${Date.now()}`
    const beforeRlsProbe = lastSnapshot
    const { data: forbiddenRows, error: forbiddenError } = await userClient
      .from('jobs')
      .insert({
        source: 'greenhouse',
        external_id: externalId,
        title: 'RLS probe',
        absolute_url: 'https://example.invalid/rls-probe',
        fingerprint: externalId,
      })
      .select('id')
    unexpectedProbeId = forbiddenRows?.[0]?.id
    if (unexpectedProbeId) {
      const { error: cleanupError } = await admin.from('jobs').delete().eq('id', unexpectedProbeId)
      if (cleanupError) throw cleanupError
    }
    const afterRlsProbe = await capturePipelineEvidenceSnapshot(
      admin,
      'after_denied_rls_cleanup',
      undefined,
      externalId,
    )
    journalPipelineMutation(evidence, 'denied_rls_insert_cleanup', beforeRlsProbe, afterRlsProbe, {
      identifiers: [externalId, ...(unexpectedProbeId ? [unexpectedProbeId] : [])],
      responseSummary: {
        rejected: Boolean(forbiddenError) || forbiddenRows?.length === 0,
        unexpectedlyReturnedRows: forbiddenRows?.length ?? 0,
      },
      residueCounts: afterRlsProbe.fixtureResidue,
    })
    lastSnapshot = afterRlsProbe
    assert(
      Boolean(forbiddenError) || forbiddenRows?.length === 0,
      'probe 8: authenticated publishable-key client cannot insert jobs',
    )

    const { data: heartbeatBeforeProbe, error: heartbeatBeforeProbeError } = await admin
      .from('pipeline_heartbeat')
      .select('last_tick_at, last_success_at, adzuna_requests_today, adzuna_budget_date')
      .eq('id', true)
      .single()
    if (heartbeatBeforeProbeError) throw heartbeatBeforeProbeError

    const heartbeatFresh = Boolean(
      heartbeatBeforeProbe.last_success_at &&
        Date.now() - new Date(heartbeatBeforeProbe.last_success_at).getTime() < 30 * 60_000,
    )
    const [heartbeatWithoutSecret, heartbeatWithSecret] = await Promise.all([
      fetch(`${environment.url}/functions/v1/heartbeat`),
      fetch(
        `${environment.url}/functions/v1/heartbeat?k=${encodeURIComponent(environment.heartbeatSecret)}`,
      ),
    ])
    assert(
      heartbeatWithoutSecret.status === 401 &&
        heartbeatWithSecret.status === (heartbeatFresh ? 200 : 503),
      'probe 9: heartbeat is secret-gated and matches pipeline freshness',
    )

    const discoveryResponse = await postDiscoverySweep(environment.url, environment.cronSecret)
    const discoveryBody = await discoveryResponse.json() as {
      skipped?: string
      requestsToday?: number
      inserted?: number
      refreshed?: number
      duplicates?: number
      failedQueries?: number
    }
    const today = new Date().toISOString().slice(0, 10)
    const requestsBefore = heartbeatBeforeProbe.adzuna_budget_date === today
      ? heartbeatBeforeProbe.adzuna_requests_today
      : 0
    const discoveredRows =
      (discoveryBody.inserted ?? 0) +
      (discoveryBody.refreshed ?? 0) +
      (discoveryBody.duplicates ?? 0)
    assert(
      discoveryResponse.status === 200 &&
        !discoveryBody.skipped &&
        discoveryBody.failedQueries === 0 &&
        (discoveryBody.requestsToday ?? 0) > requestsBefore,
      'probe 10: credentialed discovery sweep spends budget and completes every seed query',
    )
    console.log(
      discoveredRows > 0
        ? `PASS: probe 10 detail: ${discoveredRows} fresh result(s) were inserted, refreshed, or deduplicated`
        : 'PASS: probe 10 detail: seed queries legitimately returned zero fresh results',
    )

    const { data: openJobs, error: openJobsError } = await admin
      .from('jobs')
      .select('source, fingerprint, snapshot_partial')
      .eq('status', 'open')
    if (openJobsError) throw openJobsError
    const openAdzunaJobs = (openJobs ?? []).filter((job) => job.source === 'adzuna')
    assert(
      discoveredRows === 0 ||
        (openAdzunaJobs.length > 0 && openAdzunaJobs.every((job) => job.snapshot_partial === true)),
      'probe 10: returned Adzuna results persist only as partial snapshots',
    )
    const nonAdzunaFingerprints = new Set(
      (openJobs ?? [])
        .filter((job) => job.source !== 'adzuna')
        .map((job) => job.fingerprint),
    )
    assert(
      openAdzunaJobs.every((job) => !nonAdzunaFingerprints.has(job.fingerprint)),
      'probe 11: no open Adzuna job duplicates an open non-Adzuna fingerprint',
    )
    await captureDurableMutation('after_primary_discovery_sweep', [
      'discovery_sweep_primary',
      'adzuna_quota_and_jobs',
      'discovery_heartbeat',
    ], {
      responseSummary: {
        status: discoveryResponse.status,
        requestsToday: discoveryBody.requestsToday,
        inserted: discoveryBody.inserted ?? 0,
        refreshed: discoveryBody.refreshed ?? 0,
        duplicates: discoveryBody.duplicates ?? 0,
        failedQueries: discoveryBody.failedQueries ?? 0,
      },
    })

    const cronBaseline = new Date(heartbeatBeforeProbe.last_tick_at).getTime()
    let cronAdvancedAt = cronBaseline
    const cronDeadline = Date.now() + 100_000
    while (Date.now() < cronDeadline && cronAdvancedAt <= cronBaseline) {
      await sleep(5_000)
      const { data: cronHeartbeat, error: cronHeartbeatError } = await admin
        .from('pipeline_heartbeat')
        .select('last_tick_at')
        .eq('id', true)
        .single()
      if (cronHeartbeatError) throw cronHeartbeatError
      cronAdvancedAt = new Date(cronHeartbeat.last_tick_at).getTime()
    }
    assert(
      cronAdvancedAt > cronBaseline && cronAdvancedAt >= Date.now() - 3 * 60_000,
      'probe 12: pg_cron advances pipeline heartbeat without a manual tick during the probe window',
    )
    await captureDurableMutation('after_cron_heartbeat_observation', [
      'seed_poll_timestamps',
      'provider_job_lifecycle',
      'provider_company_health',
      'pipeline_heartbeat',
    ], {
      responseSummary: {
        probe: 12,
        operation: 'scheduled_cron_poll_observation',
        baseline: cronBaseline,
        advancedAt: cronAdvancedAt,
      },
    })

    const beforeClaimReset = lastSnapshot
    const { error: resetClaimsError } = await admin
      .from('companies')
      .update({ last_polled_at: null })
      .in('id', seedIds)
    if (resetClaimsError) throw resetClaimsError
    const afterClaimReset = await capturePipelineEvidenceSnapshot(admin, 'after_claim_seed_reset')
    journalPipelineMutation(evidence, 'seed_poll_timestamps', beforeClaimReset, afterClaimReset, {
      identifiers: seedIds,
      responseSummary: { operation: 'prepare_concurrent_claim_probe' },
    })
    lastSnapshot = afterClaimReset
    const { data: claimBaselineRows, error: claimBaselineError } = await admin
      .from('companies')
      .select('id, last_polled_at')
    if (claimBaselineError) throw claimBaselineError
    const claimBaseline = new Map(
      (claimBaselineRows ?? []).map((row) => [row.id, row.last_polled_at]),
    )
    const concurrentClaims = await Promise.all(
      Array.from({ length: 4 }, () =>
        admin.rpc('claim_due_companies', { batch_size: 2 }),
      ),
    )
    const claimedIdBatches = concurrentClaims.map(({ data, error }) => {
      if (error) throw error
      return (data ?? []).map((company: { id: string }) => company.id)
    })
    const allClaimedIds = claimedIdBatches.flat()
    const uniqueClaimedIds = new Set(allClaimedIds)
    assert(
      uniqueClaimedIds.size === allClaimedIds.length,
      'probe 13: concurrent claim_due_companies calls return disjoint company batches',
    )
    const claimsObserved = await capturePipelineEvidenceSnapshot(admin, 'concurrent_claims_observed')
    const claimRestorationResults: PipelineRestorationResult[] = []
    for (const result of concurrentClaims) {
      for (const row of result.data ?? []) {
        const previous = claimBaseline.get(row.id)
        if (previous === undefined) continue
        claimRestorationResults.push(await restoreCompanyPollTimestampCas(
          admin,
          row.id,
          row.last_polled_at,
          previous,
        ))
      }
    }
    const claimsRestored = await capturePipelineEvidenceSnapshot(admin, 'concurrent_claims_restored')
    journalPipelineMutation(
      evidence,
      'concurrent_claim_timestamps',
      afterClaimReset,
      claimsRestored,
      {
        identifiers: [...uniqueClaimedIds],
        observed: claimsObserved,
        restorationResults: claimRestorationResults,
        responseSummary: { rpcCalls: concurrentClaims.length, claimedIds: allClaimedIds.length },
      },
    )
    lastSnapshot = claimsRestored
    assert(
      claimRestorationResults.every(({ restored, conflict }) => restored && !conflict),
      'probe 13: every temporary claim timestamp is CAS-restored without conflict',
    )

    const now = new Date().toISOString()
    const beforeNoWorkProbe = lastSnapshot
    const { data: activeRows, error: activeRowsError } = await admin
      .from('companies')
      .select('id, last_polled_at')
      .eq('activation_state', 'active')
    if (activeRowsError) throw activeRowsError
    const activeIds = (activeRows ?? []).map((row) => row.id)
    const { data: noWorkBaseline, error: noWorkBaselineError } = await admin
      .from('pipeline_heartbeat')
      .select('last_success_at')
      .eq('id', true)
      .single()
    if (noWorkBaselineError) throw noWorkBaselineError
    let noWorkObserved = beforeNoWorkProbe
    const noWorkRestorationResults: PipelineRestorationResult[] = []
    try {
      const { error: makeAllCurrentError } = await admin
        .from('companies')
        .update({ last_polled_at: now })
        .in('id', activeIds)
      if (makeAllCurrentError) throw makeAllCurrentError
      const noWorkResponse = await postTick(environment.url, environment.cronSecret)
      const noWorkBody = await noWorkResponse.json() as { claimed?: number }
      const { data: noWorkAfter, error: noWorkAfterError } = await admin
        .from('pipeline_heartbeat')
        .select('last_success_at')
        .eq('id', true)
        .single()
      if (noWorkAfterError) throw noWorkAfterError
      const noWorkBaselineMs = noWorkBaseline.last_success_at
        ? new Date(noWorkBaseline.last_success_at).getTime()
        : null
      const noWorkAfterMs = noWorkAfter.last_success_at
        ? new Date(noWorkAfter.last_success_at).getTime()
        : null
      assert(
        noWorkResponse.ok &&
          noWorkBody.claimed === 0 &&
          noWorkAfterMs !== null &&
          (noWorkBaselineMs === null || noWorkAfterMs > noWorkBaselineMs),
        'probe 14: a successful no-work tick advances last_success_at',
      )
      noWorkObserved = await capturePipelineEvidenceSnapshot(admin, 'all_active_no_work_observed')
    } finally {
      for (const row of activeRows ?? []) {
        noWorkRestorationResults.push(await restoreCompanyPollTimestampCas(
          admin,
          row.id,
          now,
          row.last_polled_at,
        ))
      }
    }

    const afterNoWorkProbe = await capturePipelineEvidenceSnapshot(admin, 'all_active_no_work_restored')
    journalPipelineMutation(
      evidence,
      'all_active_no_work_timestamps',
      beforeNoWorkProbe,
      afterNoWorkProbe,
      {
        identifiers: activeIds,
        observed: noWorkObserved,
        restorationResults: noWorkRestorationResults,
        responseSummary: { probe: 14, activeCompanyCount: activeIds.length },
      },
    )
    journalPipelineMutation(
      evidence,
      'pipeline_heartbeat',
      beforeNoWorkProbe,
      afterNoWorkProbe,
      { responseSummary: { probe: 14, claimed: 0 } },
    )
    lastSnapshot = afterNoWorkProbe
    assert(
      noWorkRestorationResults.every(({ restored, conflict }) => restored && !conflict),
      'probe 14: every all-active timestamp override is CAS-restored without conflict',
    )

    await runReopenFixtureProbe(admin, environment.url, environment.cronSecret, evidence)
    lastSnapshot = await capturePipelineEvidenceSnapshot(admin, 'after_planetscale_probe')

    const discoveryHealthResponse = await postDiscoverySweep(
      environment.url,
      environment.cronSecret,
    )
    const discoveryHealthBody = await discoveryHealthResponse.json() as {
      skipped?: string
      discoveryStatus?: 'ok' | 'degraded' | 'failed'
    }
    const discoverySkipped = discoveryHealthBody.skipped === 'budget' ||
      discoveryHealthBody.skipped === 'missing adzuna credentials'
    const validDiscoveryStatus = discoveryHealthBody.discoveryStatus === 'ok' ||
      discoveryHealthBody.discoveryStatus === 'degraded' ||
      discoveryHealthBody.discoveryStatus === 'failed'
    let discoveryHeartbeatPersisted = true
    if (!discoverySkipped) {
      const { data: discoveryHeartbeat, error: discoveryHeartbeatError } = await admin
        .from('pipeline_heartbeat')
        .select('last_discovery_at, discovery_status')
        .eq('id', true)
        .single()
      if (discoveryHeartbeatError) throw discoveryHeartbeatError
      discoveryHeartbeatPersisted = Boolean(
        discoveryHeartbeat.last_discovery_at &&
          discoveryHeartbeat.discovery_status === discoveryHealthBody.discoveryStatus,
      )
    }
    assert(
      (discoverySkipped || validDiscoveryStatus) && discoveryHeartbeatPersisted,
      'probe 16: discovery sweep surfaces health state in its response and heartbeat row',
    )
    await captureDurableMutation('after_discovery_health_sweep', [
      'discovery_sweep_health',
      'adzuna_quota_and_jobs',
      'discovery_heartbeat',
    ], {
      responseSummary: {
        status: discoveryHealthResponse.status,
        skipped: discoveryHealthBody.skipped ?? null,
        discoveryStatus: discoveryHealthBody.discoveryStatus ?? null,
      },
    })

    const { data: seedIdentityAfter, error: seedIdentityAfterError } = await admin
      .from('companies')
      .select('id, ats_type, board_token')
      .in('id', seedIds)
    if (seedIdentityAfterError) throw seedIdentityAfterError
    const { count: seedJobCountAfter, error: seedJobCountAfterError } = await admin
      .from('jobs')
      .select('*', { count: 'exact', head: true })
      .in('company_id', seedIds)
    if (seedJobCountAfterError) throw seedJobCountAfterError
    assert(
      seedIdentityAfter?.length === seedIds.length &&
        seedBoards.every((board) => seedIdentityAfter.some((row) =>
          row.ats_type === board.source && row.board_token === board.boardToken
        )) &&
        (seedJobCountAfter ?? 0) >= (seedJobCountBefore ?? 0),
      'probe 17: seed identities and linked job count survive every pipeline probe',
    )
    evidence.completedAllProbes = true
  } catch (error) {
    executionFailure = error
  } finally {
    try {
      if (unexpectedProbeId) {
        const { error: cleanupError } = await admin.from('jobs').delete().eq('id', unexpectedProbeId)
        if (cleanupError) throw cleanupError
      }
      const final = await capturePipelineEvidenceSnapshot(admin, 'final')
      const finalized = finalizePipelineEvidenceEnvelope(evidence, final)
      const redactedEnvelope = redactPipelineEvidence(finalized)
      console.log(PIPELINE_EVIDENCE_BEGIN)
      console.log(JSON.stringify(redactedEnvelope, null, 2))
      console.log(PIPELINE_EVIDENCE_END)
      if (!finalized.success && !executionFailure) {
        executionFailure = new Error(
          `Pipeline evidence reconciliation failed: ${[
            ...finalized.unexplainedDiffs,
            ...finalized.restorationConflicts,
            ...finalized.immutableDrift,
          ].join(', ') || 'residue or redaction gate'}`,
        )
      }
    } catch (error) {
      executionFailure ??= error
    }
    await userClient.auth.signOut()
  }
  if (executionFailure) throw executionFailure
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  try {
    await runPipelineVerification()
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Pipeline verification failed')
    process.exitCode = 1
  }
}

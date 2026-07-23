#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const SHA40 = /^[0-9a-f]{40}$/
const SHA256 = /^[0-9a-f]{64}$/
const NONNEGATIVE_INTEGER = /^(?:0|[1-9][0-9]*)$/
const POSITIVE_INTEGER = /^[1-9][0-9]*$/
const MIGRATION_INVENTORY = /^\d{4}(?:,\d{4})*$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
const PROJECT_REF = 'fjcsvajkkztvlrpdplwx'
const SCORE_TICK_ID = 'ae6c147f-c3a8-417e-8057-d4105ac9aed5'
const EXTRACT_RESUME_ID = '9358db1a-95fc-49bc-a684-b98fb8eceff9'
const MAX_INITIALIZER_BATCH = 25
const MAX_WORKER_TICKS = 2_000
const WORKER_SCHEDULER_INTERVAL_MS = 60_000
const WORKER_LEASE_POLL_MS = 5_000
const MAX_WORKER_IDLE_POLLS = 120

const PREFLIGHT_SCHEMA = Object.freeze({
  evidence_mode: 'preflight',
  project_ref: new RegExp(`^${PROJECT_REF}$`),
  local_migrations: MIGRATION_INVENTORY,
  remote_migrations: MIGRATION_INVENTORY,
  migration_0032_sha256: SHA256,
  migration_0032_remote_name: /^deterministic_ranking$/,
  migration_0032_remote_statement_count: POSITIVE_INTEGER,
  score_tick_deployment_id: new RegExp(`^${SCORE_TICK_ID}$`),
  score_tick_version: POSITIVE_INTEGER,
  score_tick_status: /^ACTIVE$/,
  score_tick_verify_jwt: /^false$/,
  score_tick_index_sha256: SHA256,
  score_tick_bundle_manifest_sha256: SHA256,
  extract_resume_deployment_id: new RegExp(`^${EXTRACT_RESUME_ID}$`),
  extract_resume_version: POSITIVE_INTEGER,
  extract_resume_status: /^ACTIVE$/,
  extract_resume_verify_jwt: /^false$/,
  extract_resume_index_sha256: SHA256,
  extract_resume_bundle_manifest_sha256: SHA256,
  verifier_sha256: SHA256,
  verifier_test_sha256: SHA256,
  web_asset_path: /^\/assets\/[A-Za-z0-9._-]+\.js$/,
  web_asset_sha256: SHA256,
  initializer_owner: /^postgres$/,
  initializer_security_definer: /^true$/,
  initializer_search_path: /^empty$/,
  initializer_execute_roles: /^postgres,service_role$/,
  initializer_max_batch: /^25$/,
  initializer_initial_unique: /^true$/,
  initializer_ordinary_queue: /^true$/,
  worker_claim_batch_size: /^25$/,
  worker_max_concurrency: /^25$/,
  worker_max_items_per_invocation: /^5000$/,
  worker_max_invocation_ms: /^45000$/,
  worker_scheduler_interval_ms: /^60000$/,
  worker_drain_before_maintenance: /^true$/,
  worker_recovery_run_scan_limit: /^25$/,
  worker_recovery_before_maintenance: /^true$/,
  real_user_count: NONNEGATIVE_INTEGER,
  open_job_count: NONNEGATIVE_INTEGER,
  eligible_owner_count: NONNEGATIVE_INTEGER,
  deterministic_state_count: NONNEGATIVE_INTEGER,
  deterministic_run_count: NONNEGATIVE_INTEGER,
  deterministic_item_count: NONNEGATIVE_INTEGER,
  deterministic_initial_run_count: NONNEGATIVE_INTEGER,
  score_usage_row_count: NONNEGATIVE_INTEGER,
  score_usage_prompt_tokens: NONNEGATIVE_INTEGER,
  score_usage_output_tokens: NONNEGATIVE_INTEGER,
  score_budget_date: ISO_DATE,
  score_budget_requests_today: NONNEGATIVE_INTEGER,
  score_budget_updated_at: ISO_TIMESTAMP,
  cost_baseline_sha256: SHA256,
  controlled_failure_transition: 'pass',
  pending_new_job_transition: 'pass',
  recency_expiry_transition: 'pass',
  worker_liveness_transition: 'pass',
  worker_crash_recovery_transition: 'pass',
  retry_transition: 'pass',
  atomic_preference_transition: 'pass',
  full_tests: 'pass',
  production_build: 'pass',
  lint: 'pass',
  outward_mutations: '0',
})

const POST_RELEASE_SCHEMA = Object.freeze({
  evidence_mode: 'post_release',
  approved_git_sha: SHA40,
  approved_inventory_sha256: SHA256,
  project_ref: new RegExp(`^${PROJECT_REF}$`),
  local_migrations: MIGRATION_INVENTORY,
  remote_migrations: MIGRATION_INVENTORY,
  migration_0032_sha256: SHA256,
  score_tick_deployment_id: new RegExp(`^${SCORE_TICK_ID}$`),
  score_tick_version: POSITIVE_INTEGER,
  score_tick_status: /^ACTIVE$/,
  score_tick_verify_jwt: /^false$/,
  score_tick_index_sha256: SHA256,
  score_tick_bundle_manifest_sha256: SHA256,
  worker_claim_batch_size: /^25$/,
  worker_max_concurrency: /^25$/,
  worker_max_items_per_invocation: /^5000$/,
  worker_max_invocation_ms: /^45000$/,
  worker_scheduler_interval_ms: /^60000$/,
  worker_drain_before_maintenance: /^true$/,
  worker_recovery_run_scan_limit: /^25$/,
  worker_recovery_before_maintenance: /^true$/,
  real_user_count: NONNEGATIVE_INTEGER,
  open_job_count: NONNEGATIVE_INTEGER,
  eligible_owner_count: NONNEGATIVE_INTEGER,
  active_revision_owner_count: NONNEGATIVE_INTEGER,
  complete_active_owner_count: NONNEGATIVE_INTEGER,
  duplicate_active_revision_owner_count: NONNEGATIVE_INTEGER,
  incomplete_active_owner_count: NONNEGATIVE_INTEGER,
  visible_missing_deterministic_count: NONNEGATIVE_INTEGER,
  visible_mixed_revision_count: NONNEGATIVE_INTEGER,
  nonterminal_open_item_count: NONNEGATIVE_INTEGER,
  score_usage_row_count_before: NONNEGATIVE_INTEGER,
  score_usage_row_count_after: NONNEGATIVE_INTEGER,
  score_usage_prompt_tokens_before: NONNEGATIVE_INTEGER,
  score_usage_prompt_tokens_after: NONNEGATIVE_INTEGER,
  score_usage_output_tokens_before: NONNEGATIVE_INTEGER,
  score_usage_output_tokens_after: NONNEGATIVE_INTEGER,
  score_budget_date_before: ISO_DATE,
  score_budget_date_after: ISO_DATE,
  score_budget_requests_before: NONNEGATIVE_INTEGER,
  score_budget_requests_after: NONNEGATIVE_INTEGER,
  score_budget_updated_at_before: ISO_TIMESTAMP,
  score_budget_updated_at_after: ISO_TIMESTAMP,
  cloudflare_deployment_id: /\S/,
  cloudflare_environment: /^production$/,
  cloudflare_status: /^success$/,
  cloudflare_branch: /^main$/,
  cloudflare_git_sha: SHA40,
  cloudflare_url: /^https:\/\/[^\s/]+\.pages\.dev$/,
  asset_path: /^\/assets\/[A-Za-z0-9._-]+\.js$/,
  local_asset_sha256: SHA256,
  live_asset_sha256: SHA256,
  signed_in_uat: /^pass$/,
  outward_mutations_outside_approval: /^0$/,
})

function evidencePayload(text) {
  const start = '<!-- evidence:start -->'
  const end = '<!-- evidence:end -->'
  const startIndex = text.indexOf(start)
  const endIndex = text.indexOf(end)
  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    throw new Error('evidence markers are missing or malformed')
  }
  if (text.indexOf(start, startIndex + start.length) >= 0 ||
      text.indexOf(end, endIndex + end.length) >= 0) {
    throw new Error('duplicate evidence markers')
  }
  return text.slice(startIndex + start.length, endIndex)
}

function parseEvidence(text) {
  const fields = Object.create(null)
  const lines = evidencePayload(text).split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line) continue
    const match = /^([a-z][a-z0-9_]*):\s*(\S(?:.*\S)?)$/.exec(line)
    if (!match) throw new Error(`malformed evidence line ${index + 1}`)
    const [, key, value] = match
    if (Object.hasOwn(fields, key)) throw new Error(`duplicate field: ${key}`)
    fields[key] = value
  }
  return fields
}

function requireSchema(fields, schema) {
  const allowed = new Set(Object.keys(schema))
  for (const key of Object.keys(fields)) {
    if (!allowed.has(key)) throw new Error(`unknown field: ${key}`)
  }
  for (const [key, expected] of Object.entries(schema)) {
    if (!Object.hasOwn(fields, key)) throw new Error(`missing field: ${key}`)
    const value = fields[key]
    if (typeof expected === 'string') {
      if (value !== expected) throw new Error(`${key} must equal ${expected}`)
    } else if (!expected.test(value)) {
      throw new Error(`${key} is malformed`)
    }
  }
}

export function validateEvidenceText(mode, text) {
  const schema = mode === 'preflight'
    ? PREFLIGHT_SCHEMA
    : mode === 'post-release'
      ? POST_RELEASE_SCHEMA
      : null
  if (!schema) throw new Error('mode must be preflight or post-release')
  const fields = parseEvidence(text)
  requireSchema(fields, schema)
  return { mode, fields: Object.freeze({ ...fields }) }
}

function count(fields, key) {
  const result = Number(fields[key])
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error(`${key} is not a safe nonnegative integer`)
  }
  return result
}

function exact(actual, expected, label) {
  if (String(actual) !== String(expected)) throw new Error(`${label} mismatch`)
}

function exactValue(actual, expected, label) {
  if (String(actual) !== expected) throw new Error(`${label} must equal ${expected}`)
}

function zero(fields, key, label = key) {
  if (count(fields, key) !== 0) throw new Error(`${label} must equal 0`)
}

function asInventory(value) {
  return typeof value === 'string' ? value.split(',') : [...value]
}

function verifyMigrationInventory(fields, probes) {
  const local = asInventory(probes.localMigrations)
  const remote = asInventory(probes.remoteMigrations)
  const expectedLocal = asInventory(fields.local_migrations)
  const expectedRemote = asInventory(fields.remote_migrations)
  if (local.length !== expectedLocal.length ||
      local.some((entry, index) => entry !== expectedLocal[index])) {
    throw new Error('local migration inventory mismatch')
  }
  if (remote.length !== expectedRemote.length ||
      remote.some((entry, index) => entry !== expectedRemote[index])) {
    throw new Error('remote migration inventory mismatch')
  }
  exact(fields.local_migrations, fields.remote_migrations, 'local/remote migration parity')
  if (local.at(-1) !== '0032' || local.filter((entry) => entry === '0032').length !== 1) {
    throw new Error('migration 0032 must be the unique inventory tail')
  }
  exact(probes.migration0032Sha256, fields.migration_0032_sha256, 'migration 0032 SHA-256')
}

function verifyFunction(fields, prefix, probe) {
  exactValue(
    probe.provenance,
    'hosted-download',
    `${prefix.replaceAll('_', '-')} source provenance`,
  )
  exact(probe.id, fields[`${prefix}_deployment_id`], `${prefix.replaceAll('_', '-')} deployment ID`)
  exact(probe.version, fields[`${prefix}_version`], `${prefix.replaceAll('_', '-')} version`)
  exactValue(probe.status, 'ACTIVE', `${prefix.replaceAll('_', '-')} status`)
  exact(String(probe.verifyJwt), fields[`${prefix}_verify_jwt`], `${prefix.replaceAll('_', '-')} verify_jwt`)
  exact(probe.indexSha256, fields[`${prefix}_index_sha256`], `${prefix.replaceAll('_', '-')} index SHA-256`)
  exact(
    probe.bundleManifestSha256,
    fields[`${prefix}_bundle_manifest_sha256`],
    `${prefix.replaceAll('_', '-')} bundle manifest SHA-256`,
  )
}

function numericSourceConstant(source, name) {
  const match = new RegExp(`const\\s+${name}\\s*=\\s*([0-9][0-9_]*)`).exec(source)
  if (!match) throw new Error(`score-tick ${name} is missing`)
  const value = Number(match[1].replaceAll('_', ''))
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`score-tick ${name} is malformed`)
  }
  return value
}

export function inspectWorkerLivenessSource(source, schedule = {}) {
  const initialClaim = source.indexOf('let rows = await claimWork(admin)')
  const recovery = source.indexOf(
    'recovery = await recoverOrphanedRuns(admin, startedAt)',
  )
  const maintenance = source.indexOf('await runMaintenance(admin)')
  const drainLoop = source.indexOf('while (rows.length > 0)')
  const claimCalls = source.match(/claimWork\(admin\)/g)?.length ?? 0
  const maintenanceCalls = source.match(/await runMaintenance\(admin\)/g)?.length ?? 0
  const recoveryCalls = source.match(
    /await recoverOrphanedRuns\(admin, startedAt\)/g,
  )?.length ?? 0
  if (initialClaim < 0 || recovery < 0 || maintenance < 0 || drainLoop < 0 ||
      initialClaim > recovery || recovery > maintenance ||
      maintenance > drainLoop || claimCalls !== 4 ||
      recoveryCalls !== 1 || maintenanceCalls !== 1) {
    throw new Error('score-tick does not drain existing work before bounded maintenance')
  }

  const result = {
    claimBatchSize: numericSourceConstant(source, 'CLAIM_BATCH_SIZE'),
    maxConcurrency: numericSourceConstant(source, 'MAX_CONCURRENCY'),
    maxItemsPerInvocation: numericSourceConstant(source, 'MAX_ITEMS_PER_INVOCATION'),
    maxInvocationMs: numericSourceConstant(source, 'MAX_INVOCATION_MS'),
    recoveryRunScanLimit: numericSourceConstant(source, 'RECOVERY_RUN_SCAN_LIMIT'),
    schedulerIntervalMs: Number(schedule.intervalMs),
    drainBeforeMaintenance: true,
    recoveryBeforeMaintenance: true,
  }
  if (result.claimBatchSize !== 25 ||
      result.maxConcurrency !== 25 ||
      result.maxItemsPerInvocation !== 5_000 ||
      result.maxInvocationMs !== 45_000 ||
      result.recoveryRunScanLimit !== 25) {
    throw new Error('score-tick liveness bounds drifted')
  }
  if (schedule.count !== 1 || schedule.active !== true ||
      schedule.expression !== '* * * * *' ||
      result.schedulerIntervalMs !== WORKER_SCHEDULER_INTERVAL_MS) {
    throw new Error('score-tick scheduler liveness contract drifted')
  }
  if (result.maxInvocationMs >= result.schedulerIntervalMs) {
    throw new Error('score-tick invocation bound overlaps the ordinary scheduler cadence')
  }
  return Object.freeze(result)
}

function verifyWorkerLiveness(fields, worker, counts) {
  for (const [probeKey, fieldKey, label] of [
    ['claimBatchSize', 'worker_claim_batch_size', 'worker claim batch size'],
    ['maxConcurrency', 'worker_max_concurrency', 'worker maximum concurrency'],
    ['maxItemsPerInvocation', 'worker_max_items_per_invocation', 'worker item bound'],
    ['maxInvocationMs', 'worker_max_invocation_ms', 'worker time bound'],
    ['schedulerIntervalMs', 'worker_scheduler_interval_ms', 'worker scheduler interval'],
    ['drainBeforeMaintenance', 'worker_drain_before_maintenance', 'worker drain ordering'],
    ['recoveryRunScanLimit', 'worker_recovery_run_scan_limit', 'worker recovery scan bound'],
    [
      'recoveryBeforeMaintenance',
      'worker_recovery_before_maintenance',
      'worker recovery ordering',
    ],
  ]) exact(worker[probeKey], fields[fieldKey], label)
  const completeUniverse = Number(counts.realUsers) * Number(counts.openJobs)
  if (!Number.isSafeInteger(completeUniverse) ||
      worker.maxItemsPerInvocation < completeUniverse) {
    throw new Error('worker item bound does not cover the approved owner/job universe')
  }
}

export function verifyPreflightEvidence(fields, probes) {
  requireSchema(fields, PREFLIGHT_SCHEMA)
  exact(probes.projectRef, fields.project_ref, 'project reference')
  verifyMigrationInventory(fields, probes)
  exact(probes.migration0032RemoteName, fields.migration_0032_remote_name, 'migration 0032 name')
  exact(
    probes.migration0032RemoteStatementCount,
    fields.migration_0032_remote_statement_count,
    'migration 0032 statement count',
  )
  verifyFunction(fields, 'score_tick', probes.scoreTick)
  verifyFunction(fields, 'extract_resume', probes.extractResume)
  exact(probes.verifierSha256, fields.verifier_sha256, 'verifier SHA-256')
  exact(probes.verifierTestSha256, fields.verifier_test_sha256, 'verifier test SHA-256')
  exact(probes.webAsset.path, fields.web_asset_path, 'web asset path')
  exact(probes.webAsset.sha256, fields.web_asset_sha256, 'web asset SHA-256')
  assertInitializerAuthority(probes.initializer)
  exact(probes.initializer.owner, fields.initializer_owner, 'initializer owner evidence')
  exact(
    String(probes.initializer.securityDefiner),
    fields.initializer_security_definer,
    'initializer SECURITY DEFINER evidence',
  )
  exact(
    probes.initializer.searchPath === '' ? 'empty' : probes.initializer.searchPath,
    fields.initializer_search_path,
    'initializer search_path evidence',
  )
  exact(
    [...probes.initializer.executeRoles].sort().join(','),
    fields.initializer_execute_roles,
    'initializer execute roles evidence',
  )
  exact(probes.initializer.maxBatch, fields.initializer_max_batch, 'initializer max batch evidence')
  exact(
    String(probes.initializer.initialUnique),
    fields.initializer_initial_unique,
    'initializer uniqueness evidence',
  )
  exact(
    String(probes.initializer.ordinaryQueue),
    fields.initializer_ordinary_queue,
    'initializer ordinary queue evidence',
  )
  verifyWorkerLiveness(fields, probes.worker, probes.counts)

  exact(probes.counts.realUsers, fields.real_user_count, 'real user count')
  exact(probes.counts.openJobs, fields.open_job_count, 'open job count')
  exact(probes.counts.eligibleOwners, fields.eligible_owner_count, 'eligible owner count')
  exact(probes.counts.states, fields.deterministic_state_count, 'deterministic state count')
  exact(probes.counts.runs, fields.deterministic_run_count, 'deterministic run count')
  exact(probes.counts.items, fields.deterministic_item_count, 'deterministic item count')
  exact(probes.counts.initialRuns, fields.deterministic_initial_run_count, 'initial run count')
  if (probes.counts.realUsers !== probes.counts.eligibleOwners) {
    throw new Error('initializer owner universe does not cover every real user')
  }
  for (const key of [
    'deterministic_state_count',
    'deterministic_run_count',
    'deterministic_item_count',
    'deterministic_initial_run_count',
  ]) zero(fields, key)

  exact(probes.cost.usageRows, fields.score_usage_row_count, 'score usage row count')
  exact(probes.cost.promptTokens, fields.score_usage_prompt_tokens, 'score usage prompt tokens')
  exact(probes.cost.outputTokens, fields.score_usage_output_tokens, 'score usage output tokens')
  exact(probes.cost.budgetDate, fields.score_budget_date, 'score budget date')
  exact(probes.cost.requestsToday, fields.score_budget_requests_today, 'score budget requests')
  exact(probes.cost.updatedAt, fields.score_budget_updated_at, 'score budget update timestamp')
  exact(probes.cost.sha256, fields.cost_baseline_sha256, 'cost baseline SHA-256')

  for (const key of [
    'controlled_failure_transition',
    'pending_new_job_transition',
    'recency_expiry_transition',
    'worker_liveness_transition',
    'worker_crash_recovery_transition',
    'retry_transition',
    'atomic_preference_transition',
    'full_tests',
    'production_build',
    'lint',
  ]) exactValue(fields[key], 'pass', key)
  zero(fields, 'outward_mutations')
  return Object.freeze({
    ownerCount: probes.counts.realUsers,
    openJobCount: probes.counts.openJobs,
    costBaselineSha256: probes.cost.sha256,
  })
}

function verifyCostInvariance(fields) {
  for (const [before, after, label] of [
    ['score_usage_row_count_before', 'score_usage_row_count_after', 'score usage row count'],
    ['score_usage_prompt_tokens_before', 'score_usage_prompt_tokens_after', 'score usage prompt tokens'],
    ['score_usage_output_tokens_before', 'score_usage_output_tokens_after', 'score usage output tokens'],
    ['score_budget_date_before', 'score_budget_date_after', 'score budget date'],
    ['score_budget_requests_before', 'score_budget_requests_after', 'score budget requests'],
    ['score_budget_updated_at_before', 'score_budget_updated_at_after', 'score budget update timestamp'],
  ]) exact(fields[after], fields[before], `${label} changed`)
}

export function verifyPostReleaseEvidence(fields, probes) {
  requireSchema(fields, POST_RELEASE_SCHEMA)
  zero(fields, 'duplicate_active_revision_owner_count', 'duplicate active owners')
  zero(fields, 'incomplete_active_owner_count', 'incomplete active owners')
  zero(fields, 'visible_missing_deterministic_count', 'visible missing deterministic rows')
  zero(fields, 'visible_mixed_revision_count', 'visible mixed revisions')
  zero(fields, 'nonterminal_open_item_count', 'nonterminal open items')
  verifyCostInvariance(fields)
  exact(probes.localGitSha, fields.approved_git_sha, 'local Git SHA')
  exact(probes.originGitSha, fields.approved_git_sha, 'origin/main Git SHA')
  exact(probes.inventorySha256, fields.approved_inventory_sha256, 'approved inventory SHA-256')
  exact(probes.projectRef, fields.project_ref, 'project reference')
  verifyMigrationInventory(fields, probes)
  verifyFunction(fields, 'score_tick', probes.scoreTick)
  verifyWorkerLiveness(fields, probes.worker, probes.counts)
  exact(probes.costAfter.usageRows, fields.score_usage_row_count_after, 'live score usage row count')
  exact(
    probes.costAfter.promptTokens,
    fields.score_usage_prompt_tokens_after,
    'live score usage prompt tokens',
  )
  exact(
    probes.costAfter.outputTokens,
    fields.score_usage_output_tokens_after,
    'live score usage output tokens',
  )
  exact(probes.costAfter.budgetDate, fields.score_budget_date_after, 'live score budget date')
  exact(
    probes.costAfter.requestsToday,
    fields.score_budget_requests_after,
    'live score budget requests',
  )
  exact(
    probes.costAfter.updatedAt,
    fields.score_budget_updated_at_after,
    'live score budget update timestamp',
  )

  const mappings = [
    ['realUsers', 'real_user_count', 'real user count'],
    ['openJobs', 'open_job_count', 'open job count'],
    ['eligibleOwners', 'eligible_owner_count', 'eligible owner count'],
    ['activeOwners', 'active_revision_owner_count', 'active owner count'],
    ['completeActiveOwners', 'complete_active_owner_count', 'complete active owner count'],
    ['duplicateActiveOwners', 'duplicate_active_revision_owner_count', 'duplicate active owner count'],
    ['incompleteActiveOwners', 'incomplete_active_owner_count', 'incomplete active owner count'],
    ['visibleMissingDeterministic', 'visible_missing_deterministic_count', 'visible missing deterministic count'],
    ['visibleMixedRevision', 'visible_mixed_revision_count', 'visible mixed revision count'],
    ['nonterminalOpenItems', 'nonterminal_open_item_count', 'nonterminal open item count'],
  ]
  for (const [probeKey, fieldKey, label] of mappings) {
    exact(probes.counts[probeKey], fields[fieldKey], label)
  }
  if (count(fields, 'active_revision_owner_count') !== count(fields, 'real_user_count') ||
      count(fields, 'complete_active_owner_count') !== count(fields, 'real_user_count')) {
    throw new Error('every real user must have one complete active revision')
  }

  exact(probes.cloudflare.id, fields.cloudflare_deployment_id, 'Cloudflare deployment ID')
  exactValue(probes.cloudflare.environment, 'production', 'Cloudflare environment')
  exactValue(probes.cloudflare.status, 'success', 'Cloudflare status')
  exactValue(probes.cloudflare.branch, 'main', 'Cloudflare branch')
  exact(probes.cloudflare.gitSha, fields.approved_git_sha, 'Cloudflare Git SHA')
  exact(fields.cloudflare_git_sha, fields.approved_git_sha, 'evidence Cloudflare Git SHA')
  exact(probes.cloudflare.url, fields.cloudflare_url, 'Cloudflare immutable URL')
  if (fields.local_asset_sha256 !== fields.live_asset_sha256) {
    throw new Error('evidence asset hashes must match')
  }
  exact(probes.asset.path, fields.asset_path, 'asset path')
  exact(probes.asset.localSha256, fields.local_asset_sha256, 'local asset SHA-256')
  exact(probes.asset.liveSha256, fields.live_asset_sha256, 'live asset SHA-256')
  exactValue(fields.signed_in_uat, 'pass', 'signed_in_uat')
  zero(fields, 'outward_mutations_outside_approval')
  return Object.freeze({ approvedGitSha: fields.approved_git_sha })
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    ).join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function stableCostHash(cost) {
  return sha256(canonicalJson({
    usageRows: Number(cost.usageRows),
    promptTokens: Number(cost.promptTokens),
    outputTokens: Number(cost.outputTokens),
    budgetDate: String(cost.budgetDate),
    requestsToday: Number(cost.requestsToday),
    updatedAt: String(cost.updatedAt),
  }))
}

function requireApproval(approval) {
  if (!SHA40.test(approval.approvedSha ?? '')) throw new Error('approved SHA is required')
  if (!SHA256.test(approval.approvedInventorySha256 ?? '')) {
    throw new Error('approved inventory SHA-256 is required')
  }
  if (!Number.isSafeInteger(approval.approvedOwnerCount) || approval.approvedOwnerCount < 0) {
    throw new Error('approved owner count is required')
  }
  if (!Number.isSafeInteger(approval.approvedOpenJobCount) || approval.approvedOpenJobCount < 0) {
    throw new Error('approved open job count is required')
  }
  if (!SHA256.test(approval.approvedCostBaselineSha256 ?? '')) {
    throw new Error('approved cost baseline SHA-256 is required')
  }
}

export function assertInitializerAuthority(authority) {
  exactValue(authority.owner, 'postgres', 'initializer owner')
  if (authority.securityDefiner !== true) throw new Error('initializer must be SECURITY DEFINER')
  exactValue(authority.searchPath, '', 'initializer search_path')
  const roles = [...(authority.executeRoles ?? [])].sort()
  if (roles.length !== 2 || roles[0] !== 'postgres' || roles[1] !== 'service_role') {
    throw new Error('initializer execute grants must be postgres and service_role only')
  }
  if (authority.maxBatch !== MAX_INITIALIZER_BATCH) {
    throw new Error('initializer batch bound must equal 25')
  }
  if (authority.initialUnique !== true) throw new Error('initializer initial-owner uniqueness is missing')
  if (authority.ordinaryQueue !== true) throw new Error('initializer bypasses the ordinary queue')
  return true
}

function initializerResponse(value) {
  const fields = ['initialized_count', 'seeded_count', 'remaining_count']
  if (!value || typeof value !== 'object' || fields.some(
    (key) => !Number.isSafeInteger(value[key]) || value[key] < 0,
  )) {
    throw new Error('initializer response is malformed')
  }
  if (value.initialized_count > MAX_INITIALIZER_BATCH) {
    throw new Error('initializer response exceeds 25-owner bound')
  }
  return value
}

function assertQueueState(state) {
  for (const key of ['pending', 'claimed', 'failed', 'duplicateOwners']) {
    if (!Number.isSafeInteger(state?.[key]) || state[key] < 0) {
      throw new Error('ranking queue state is malformed')
    }
  }
  if (state.duplicateOwners !== 0) throw new Error('duplicate initial owner runs')
  if (state.failed !== 0) throw new Error('initial ranking item failed')
}

export function summarizeActiveCoverageRows(rows) {
  if (!Array.isArray(rows)) throw new Error('active coverage response is malformed')

  const summary = {
    remainingUsers: 0,
    activeOwners: 0,
    completeActiveOwners: 0,
    duplicateActiveOwners: 0,
    incompleteActiveOwners: 0,
    visibleMissingDeterministic: 0,
    visibleMixedRevision: 0,
    nonterminalOpenItems: 0,
  }
  const integerFields = [
    'active_owner_ready',
    'active_revision',
    'current_open_jobs',
    'exact_current_open_results',
    'missing_current_open_results',
    'duplicate_current_open_results',
    'visible_missing_deterministic',
    'visible_mixed_revision',
    'nonterminal_active_items',
    'nonterminal_open_items',
    'failed_active_items',
    'mixed_active_items',
    'surplus_open_items',
    'invalid_closed_surplus_items',
    'historical_closed_completed_items',
    'initial_run_count',
  ]

  for (const row of rows) {
    if (!row || typeof row !== 'object') throw new Error('active coverage row is malformed')
    const values = Object.fromEntries(integerFields.map(
      (key) => [key, rowInteger(row, key, `active coverage ${key}`)],
    ))
    const active = values.active_revision > 0
    const duplicate = values.duplicate_current_open_results > 0 ||
      values.surplus_open_items > 0 ||
      values.initial_run_count > 1
    const complete = values.active_owner_ready === 1 &&
      values.initial_run_count === 1 &&
      values.exact_current_open_results === values.current_open_jobs &&
      values.missing_current_open_results === 0 &&
      values.duplicate_current_open_results === 0 &&
      values.visible_missing_deterministic === 0 &&
      values.visible_mixed_revision === 0 &&
      values.nonterminal_active_items === 0 &&
      values.failed_active_items === 0 &&
      values.mixed_active_items === 0 &&
      values.surplus_open_items === 0 &&
      values.invalid_closed_surplus_items === 0

    summary.remainingUsers += active ? 0 : 1
    summary.activeOwners += active ? 1 : 0
    summary.completeActiveOwners += complete ? 1 : 0
    summary.duplicateActiveOwners += duplicate ? 1 : 0
    summary.incompleteActiveOwners += complete ? 0 : 1
    summary.visibleMissingDeterministic += values.visible_missing_deterministic
    summary.visibleMixedRevision += values.visible_mixed_revision
    summary.nonterminalOpenItems += values.nonterminal_open_items
  }

  for (const [key, value] of Object.entries(summary)) {
    if (!Number.isSafeInteger(value)) throw new Error(`active coverage ${key} exceeds safe range`)
  }
  return summary
}

function assertFinalState(state, approvedOwnerCount) {
  for (const key of [
    'remainingUsers',
    'activeOwners',
    'completeActiveOwners',
    'duplicateActiveOwners',
    'incompleteActiveOwners',
    'visibleMissingDeterministic',
    'visibleMixedRevision',
    'nonterminalOpenItems',
  ]) {
    if (!Number.isSafeInteger(state?.[key]) || state[key] < 0) {
      throw new Error('final ranking state is malformed')
    }
  }
  if (state.remainingUsers !== 0) throw new Error('backfill owners remain')
  if (state.activeOwners !== approvedOwnerCount ||
      state.completeActiveOwners !== approvedOwnerCount) {
    throw new Error('not every approved owner has one complete active revision')
  }
  if (state.duplicateActiveOwners !== 0) throw new Error('duplicate initial owner runs')
  if (state.incompleteActiveOwners !== 0) throw new Error('incomplete active owners remain')
  if (state.visibleMissingDeterministic !== 0) {
    throw new Error('visible eligible rows are missing deterministic results')
  }
  if (state.visibleMixedRevision !== 0) throw new Error('visible mixed revisions remain')
  if (state.nonterminalOpenItems !== 0) throw new Error('nonterminal open items remain')
}

function isTerminalOrphanRecoveryState(state, approvedOwnerCount) {
  for (const key of [
    'remainingUsers',
    'activeOwners',
    'completeActiveOwners',
    'duplicateActiveOwners',
    'incompleteActiveOwners',
    'visibleMissingDeterministic',
    'visibleMixedRevision',
    'nonterminalOpenItems',
  ]) {
    if (!Number.isSafeInteger(state?.[key]) || state[key] < 0) {
      throw new Error('final ranking state is malformed')
    }
  }
  return state.remainingUsers === 0 &&
    state.activeOwners === approvedOwnerCount &&
    state.completeActiveOwners < approvedOwnerCount &&
    state.incompleteActiveOwners > 0 &&
    state.duplicateActiveOwners === 0 &&
    state.visibleMissingDeterministic === 0 &&
    state.visibleMixedRevision === 0 &&
    state.nonterminalOpenItems === 0
}

export async function runApprovedBackfill(approval, adapters) {
  requireApproval(approval)
  const live = await adapters.preflight()
  exact(live.gitSha, approval.approvedSha, 'approved SHA')
  exact(live.inventorySha256, approval.approvedInventorySha256, 'approved inventory')
  exact(live.ownerCount, approval.approvedOwnerCount, 'approved owner count')
  exact(live.openJobCount, approval.approvedOpenJobCount, 'approved open job count')
  exact(
    live.costBaselineSha256,
    approval.approvedCostBaselineSha256,
    'approved cost baseline',
  )
  assertInitializerAuthority(await adapters.authority())
  exact(
    await adapters.costBaseline(),
    approval.approvedCostBaselineSha256,
    'score-purpose cost baseline',
  )

  let initializedOwners = 0
  let seededItems = 0
  let workerTicks = 0
  let remainingUsers = approval.approvedOwnerCount
  const maxBatches = Math.ceil(approval.approvedOwnerCount / MAX_INITIALIZER_BATCH) + 1
  async function tickOnce() {
    if (workerTicks >= MAX_WORKER_TICKS) {
      throw new Error('worker drain exceeded safety bound')
    }
    const tick = await adapters.tick()
    if (!tick || !Number.isSafeInteger(tick.claimed) || tick.claimed < 0 ||
        !Number.isSafeInteger(tick.failed) || tick.failed < 0) {
      throw new Error('worker response is malformed')
    }
    if (tick.failed !== 0) throw new Error('worker reported failed ranking items')
    workerTicks += 1
    exact(
      await adapters.costBaseline(),
      approval.approvedCostBaselineSha256,
      'score-purpose cost baseline changed',
    )
    return tick
  }
  async function drainQueue(queue) {
    let current = queue
    let idlePolls = 0
    while (current.pending + current.claimed > 0) {
      const tick = await tickOnce()
      current = await adapters.queueState()
      assertQueueState(current)
      if (
        current.pending + current.claimed > 0 &&
        tick.claimed === 0
      ) {
        idlePolls += 1
        if (idlePolls > MAX_WORKER_IDLE_POLLS) {
          throw new Error('worker lease recovery exceeded safety bound')
        }
        if (typeof adapters.wait === 'function') {
          await adapters.wait(WORKER_LEASE_POLL_MS)
        }
      } else {
        idlePolls = 0
      }
    }
    return current
  }

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const result = initializerResponse(await adapters.initialize(MAX_INITIALIZER_BATCH))
    initializedOwners += result.initialized_count
    seededItems += result.seeded_count
    remainingUsers = result.remaining_count
    if (result.initialized_count === 0 && remainingUsers > 0) {
      throw new Error('initializer made no progress')
    }

    let queue = await adapters.queueState()
    assertQueueState(queue)
    queue = await drainQueue(queue)
    if (remainingUsers === 0) break
  }

  if (remainingUsers !== 0) throw new Error('initializer did not reach zero remaining users')
  let finalState = await adapters.finalState()
  if (isTerminalOrphanRecoveryState(finalState, approval.approvedOwnerCount)) {
    await tickOnce()
    const queue = await adapters.queueState()
    assertQueueState(queue)
    await drainQueue(queue)
    finalState = await adapters.finalState()
  }
  assertFinalState(finalState, approval.approvedOwnerCount)
  exact(
    await adapters.costBaseline(),
    approval.approvedCostBaselineSha256,
    'score-purpose cost baseline',
  )
  return Object.freeze({ initializedOwners, seededItems, workerTicks, remainingUsers })
}

export function verifyAutomaticEntryPoints(sources) {
  const forbiddenScoreTick = [
    /\bopenai\b/i,
    /createOpenAIProvider|generateStructured|responses\.create/,
    /reserve_score_request|score_request_budget|ai_usage/,
    /purpose\s*[:=]\s*['"]score['"]/,
  ]
  if (forbiddenScoreTick.some((pattern) => pattern.test(sources.scoreTick ?? ''))) {
    throw new Error('score-tick exposes forbidden automatic scoring capability')
  }
  for (const required of [
    /x-cron-secret/,
    /claim_deterministic_ranking_work/,
    /stage_deterministic_ranking_result/,
    /finalize_deterministic_ranking_run/,
  ]) {
    if (!required.test(sources.scoreTick ?? '')) {
      throw new Error('score-tick deterministic queue contract is incomplete')
    }
  }
  const extract = sources.extractResume ?? ''
  if (!/purpose\s*[:=]\s*['"]extract['"]/.test(extract) ||
      !/request_deterministic_route_refresh(?:_for_user)?/.test(extract) ||
      /purpose\s*[:=]\s*['"]score['"]|evaluateDeterministicRanking|reserve_score_request/.test(extract)) {
    throw new Error('extract-resume is not extraction-only')
  }
  if (!/save_preferences_and_start_ranking/.test(sources.preferenceSave ?? '')) {
    throw new Error('preference save does not start deterministic ranking')
  }
  if (!/retry_deterministic_ranking_run/.test(sources.retry ?? '')) {
    throw new Error('retry does not use the deterministic run protocol')
  }
  for (const required of [
    /enqueue_deterministic_new_jobs/,
    /enqueue_deterministic_recency_refresh/,
    /enqueue_deterministic_route_refreshes/,
  ]) {
    if (!required.test(sources.maintenance ?? '')) {
      throw new Error('deterministic maintenance entry points are incomplete')
    }
  }
  return true
}

async function command(cwd, executable, args, options = {}) {
  const result = await execFile(executable, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    env: process.env,
    ...options,
  })
  return result.stdout.trim()
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

async function managementSql(query) {
  const token = requiredEnvironment('SUPABASE_ACCESS_TOKEN')
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    },
  )
  if (!response.ok) throw new Error(`Management SQL returned HTTP ${response.status}`)
  const payload = await response.json()
  if (!Array.isArray(payload)) throw new Error('Management SQL response is malformed')
  return payload
}

async function relativeImportGraph(root, entry) {
  const visited = new Set()
  async function visit(path) {
    const absolute = resolve(root, path)
    const key = relative(root, absolute)
    if (visited.has(key)) return
    visited.add(key)
    const source = await readFile(absolute, 'utf8')
    for (const match of source.matchAll(
      /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)['"](\.\.?\/[^'"]+)['"]/g,
    )) {
      let target = resolve(dirname(absolute), match[1])
      if (!/\.[cm]?[jt]sx?$/.test(target)) target += '.ts'
      await visit(relative(root, target))
    }
  }
  await visit(entry)
  return [...visited].sort()
}

async function bundleManifest(root, entry) {
  const paths = await relativeImportGraph(root, entry)
  const entries = []
  for (const path of paths) {
    entries.push({ path, sha256: sha256(await readFile(join(root, path))) })
  }
  return { paths, sha256: sha256(canonicalJson(entries)) }
}

async function localMigrationInventory(root) {
  return (await readdir(join(root, 'supabase/migrations')))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .map((name) => name.slice(0, 4))
    .sort()
}

async function remoteMigrationInventory() {
  const rows = await managementSql(`
    select version::text
    from supabase_migrations.schema_migrations
    order by version
  `)
  if (!rows.every((entry) => /^\d{4}$/.test(String(entry.version)))) {
    throw new Error('migration inventory response is malformed')
  }
  return rows.map((entry) => String(entry.version))
}

async function functionInventory() {
  const token = requiredEnvironment('SUPABASE_ACCESS_TOKEN')
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/functions`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`function inventory API returned HTTP ${response.status}`)
  const functions = await response.json()
  if (!Array.isArray(functions)) throw new Error('function inventory response is malformed')
  return functions
}

function oneRow(rows, label) {
  if (rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object') {
    throw new Error(`${label} query did not return exactly one row`)
  }
  return rows[0]
}

function rowInteger(row, key, label = key) {
  const value = Number(row[key])
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is malformed`)
  return value
}

async function liveCountAndCostProbe() {
  const rows = await managementSql(`
    with eligible_owners as (
      select user_id from public.preferences
      union
      select user_id from public.user_jobs
    ),
    score_usage as (
      select count(*)::integer as usage_rows,
             coalesce(sum(prompt_tokens), 0)::bigint as prompt_tokens,
             coalesce(sum(output_tokens), 0)::bigint as output_tokens
      from public.ai_usage where purpose = 'score'
    )
    select
      (select count(*)::integer from auth.users) as real_users,
      (select count(*)::integer from public.jobs where status = 'open') as open_jobs,
      (select count(*)::integer from eligible_owners) as eligible_owners,
      (select count(*)::integer from public.deterministic_ranking_state) as states,
      (select count(*)::integer from public.deterministic_ranking_runs) as runs,
      (select count(*)::integer from public.deterministic_ranking_items) as items,
      (select count(*)::integer from public.deterministic_ranking_runs where is_initial) as initial_runs,
      score_usage.usage_rows,
      score_usage.prompt_tokens,
      score_usage.output_tokens,
      budget.budget_date::text as budget_date,
      budget.requests_today,
      to_char(budget.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as budget_updated_at
    from score_usage
    cross join public.score_request_budget as budget
    where budget.singleton = true
  `)
  const row = oneRow(rows, 'count/cost')
  const cost = {
    usageRows: rowInteger(row, 'usage_rows'),
    promptTokens: rowInteger(row, 'prompt_tokens'),
    outputTokens: rowInteger(row, 'output_tokens'),
    budgetDate: String(row.budget_date),
    requestsToday: rowInteger(row, 'requests_today'),
    updatedAt: String(row.budget_updated_at),
  }
  return {
    counts: {
      realUsers: rowInteger(row, 'real_users'),
      openJobs: rowInteger(row, 'open_jobs'),
      eligibleOwners: rowInteger(row, 'eligible_owners'),
      states: rowInteger(row, 'states'),
      runs: rowInteger(row, 'runs'),
      items: rowInteger(row, 'items'),
      initialRuns: rowInteger(row, 'initial_runs'),
    },
    cost: { ...cost, sha256: stableCostHash(cost) },
  }
}

async function migration32Probe() {
  const row = oneRow(await managementSql(`
    select version::text, name, coalesce(array_length(statements, 1), 0)::integer as statement_count
    from supabase_migrations.schema_migrations where version = '0032'
  `), 'migration 0032')
  return { name: String(row.name), statementCount: rowInteger(row, 'statement_count') }
}

async function scoreTickScheduleProbe() {
  const rows = await managementSql(`
    select schedule, active
    from cron.job
    where jobname = 'score-tick-every-minute'
  `)
  if (rows.length !== 1 || typeof rows[0]?.schedule !== 'string' ||
      typeof rows[0]?.active !== 'boolean') {
    throw new Error('score-tick scheduler identity is missing or non-unique')
  }
  return {
    count: rows.length,
    expression: rows[0].schedule,
    active: rows[0].active,
    intervalMs: rows[0].schedule === '* * * * *'
      ? WORKER_SCHEDULER_INTERVAL_MS
      : 0,
  }
}

function functionMetadata(functions, slug) {
  if (!Array.isArray(functions)) {
    throw new Error(`${slug} function metadata is malformed`)
  }
  const found = functions.filter((entry) => entry.slug === slug)
  if (found.length !== 1) throw new Error(`${slug} function metadata is not unique`)
  const metadata = {
    id: String(found[0].id ?? ''),
    version: Number(found[0].version),
    status: String(found[0].status ?? ''),
    verifyJwt: found[0].verify_jwt,
  }
  if (!metadata.id ||
      !Number.isSafeInteger(metadata.version) ||
      metadata.version < 1 ||
      !metadata.status ||
      typeof metadata.verifyJwt !== 'boolean') {
    throw new Error(`${slug} function metadata is malformed`)
  }
  return Object.freeze(metadata)
}

function exactFunctionMetadata(before, after, slug) {
  for (const key of ['id', 'version', 'status', 'verifyJwt']) {
    if (before[key] !== after[key]) {
      throw new Error(`${slug} hosted function metadata changed during download`)
    }
  }
}

function exactBundleFiles(actual, expected, slug) {
  if (!Array.isArray(expected) ||
      actual.length !== expected.length ||
      actual.some((path, index) => path !== expected[index])) {
    throw new Error(`${slug} hosted bundle file inventory mismatch`)
  }
}

export async function functionProbe(root, slug, approved, adapters = {}) {
  if (!['score-tick', 'extract-resume'].includes(slug)) {
    throw new Error('hosted function slug is not approved')
  }
  if (!SHA256.test(approved?.indexSha256 ?? '') ||
      !SHA256.test(approved?.bundleManifestSha256 ?? '') ||
      !Array.isArray(approved?.bundleFiles)) {
    throw new Error(`${slug} approved local function inventory is malformed`)
  }

  const fetchMetadata = adapters.fetchMetadata ?? functionInventory
  const runCommand = adapters.runCommand ?? command
  let before
  try {
    before = functionMetadata(await fetchMetadata(), slug)
  } catch {
    throw new Error(`${slug} hosted function metadata is unavailable`)
  }

  const downloadRoot = await mkdtemp(join(tmpdir(), `job-copilot-${slug}-`))
  try {
    const executable = join(root, 'web/node_modules/.bin/supabase')
    try {
      await runCommand(
        downloadRoot,
        executable,
        [
          'functions',
          'download',
          slug,
          '--project-ref',
          PROJECT_REF,
          '--use-api',
        ],
        {
          timeout: 30_000,
          maxBuffer: 512 * 1024,
          env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' },
        },
      )
    } catch {
      throw new Error(`${slug} hosted source download failed`)
    }

    let after
    try {
      after = functionMetadata(await fetchMetadata(), slug)
    } catch {
      throw new Error(`${slug} hosted function metadata is unavailable after download`)
    }
    exactFunctionMetadata(before, after, slug)

    const entry = `supabase/functions/${slug}/index.ts`
    let remoteBundle
    let remoteIndexSha256
    try {
      remoteBundle = await bundleManifest(downloadRoot, entry)
      exactBundleFiles(remoteBundle.paths, approved.bundleFiles, slug)
      remoteIndexSha256 = sha256(await readFile(join(downloadRoot, entry)))
    } catch (error) {
      if (error instanceof Error && error.message.includes('bundle file inventory mismatch')) {
        throw error
      }
      throw new Error(`${slug} hosted source inventory failed`)
    }
    exact(remoteIndexSha256, approved.indexSha256, `${slug} hosted index SHA-256`)
    exact(
      remoteBundle.sha256,
      approved.bundleManifestSha256,
      `${slug} hosted bundle manifest SHA-256`,
    )
    return Object.freeze({
      ...before,
      provenance: 'hosted-download',
      indexSha256: remoteIndexSha256,
      bundleManifestSha256: remoteBundle.sha256,
    })
  } finally {
    await rm(downloadRoot, { recursive: true, force: true })
  }
}

export async function collectLocalInventory(root) {
  const scoreTickEntry = 'supabase/functions/score-tick/index.ts'
  const extractResumeEntry = 'supabase/functions/extract-resume/index.ts'
  const scoreBundle = await bundleManifest(root, scoreTickEntry)
  const extractBundle = await bundleManifest(root, extractResumeEntry)
  const indexHtml = await readFile(join(root, 'web/dist/index.html'), 'utf8')
  const webAssetPath = /(?:src|href)="(\/assets\/[A-Za-z0-9._-]+\.js)"/
    .exec(indexHtml)?.[1]
  if (!webAssetPath) throw new Error('built web JavaScript asset is missing')
  const inventory = {
    gitSha: await command(root, 'git', ['rev-parse', 'HEAD']),
    migration0032Sha256: sha256(await readFile(
      join(root, 'supabase/migrations/0032_deterministic_ranking.sql'),
    )),
    scoreTickIndexSha256: sha256(await readFile(join(root, scoreTickEntry))),
    scoreTickBundleManifestSha256: scoreBundle.sha256,
    scoreTickBundleFiles: scoreBundle.paths,
    extractResumeIndexSha256: sha256(await readFile(join(root, extractResumeEntry))),
    extractResumeBundleManifestSha256: extractBundle.sha256,
    extractResumeBundleFiles: extractBundle.paths,
    verifierSha256: sha256(await readFile(join(root, 'scripts/verify-phase-03-4-release.mjs'))),
    verifierTestSha256: sha256(
      await readFile(join(root, 'scripts/verify-phase-03-4-release.test.mjs')),
    ),
    webAssetPath,
    webAssetSha256: sha256(await readFile(join(root, 'web/dist', webAssetPath))),
  }
  return Object.freeze({
    ...inventory,
    inventorySha256: sha256(canonicalJson(inventory)),
  })
}

export async function collectLivePreflightProbes(root) {
  const local = await collectLocalInventory(root)
  const scoreTickSource = await readFile(
    join(root, 'supabase/functions/score-tick/index.ts'),
    'utf8',
  )
  const [
    remoteMigrations,
    migration32,
    countCost,
    initializer,
    schedule,
  ] = await Promise.all([
    remoteMigrationInventory(),
    migration32Probe(),
    liveCountAndCostProbe(),
    initializerAuthorityProbe(),
    scoreTickScheduleProbe(),
  ])
  const localMigrations = await localMigrationInventory(root)
  const scoreTick = await functionProbe(root, 'score-tick', {
    indexSha256: local.scoreTickIndexSha256,
    bundleManifestSha256: local.scoreTickBundleManifestSha256,
    bundleFiles: local.scoreTickBundleFiles,
  })
  const extractResume = await functionProbe(root, 'extract-resume', {
    indexSha256: local.extractResumeIndexSha256,
    bundleManifestSha256: local.extractResumeBundleManifestSha256,
    bundleFiles: local.extractResumeBundleFiles,
  })
  return {
    projectRef: PROJECT_REF,
    localMigrations,
    remoteMigrations,
    migration0032Sha256: local.migration0032Sha256,
    migration0032RemoteName: migration32.name,
    migration0032RemoteStatementCount: migration32.statementCount,
    scoreTick,
    extractResume,
    verifierSha256: local.verifierSha256,
    verifierTestSha256: local.verifierTestSha256,
    webAsset: { path: local.webAssetPath, sha256: local.webAssetSha256 },
    initializer,
    worker: inspectWorkerLivenessSource(scoreTickSource, schedule),
    ...countCost,
    inventorySha256: local.inventorySha256,
    gitSha: local.gitSha,
  }
}

async function liveSourceProbe(root) {
  const [scoreTick, extractResume, preferenceSave, migration] = await Promise.all([
    readFile(join(root, 'supabase/functions/score-tick/index.ts'), 'utf8'),
    readFile(join(root, 'supabase/functions/extract-resume/index.ts'), 'utf8'),
    readFile(join(root, 'web/src/lib/preferences.ts'), 'utf8'),
    readFile(join(root, 'supabase/migrations/0032_deterministic_ranking.sql'), 'utf8'),
  ])
  return verifyAutomaticEntryPoints({
    scoreTick,
    extractResume,
    preferenceSave,
    retry: preferenceSave,
    maintenance: `${scoreTick}\n${migration}`,
  })
}

async function fetchJson(url, token) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) throw new Error(`API request failed: ${response.status}`)
  const body = await response.json()
  if (body.success === false) throw new Error('API response reported failure')
  return body
}

function cloudflareStatus(deployment) {
  return deployment.latest_stage?.status ?? deployment.stages?.deploy?.status ?? deployment.status
}

async function cloudflareAccountId(root, token, approvedGitSha) {
  const accounts = await fetchJson('https://api.cloudflare.com/client/v4/accounts', token)
  if (Array.isArray(accounts.result) && accounts.result.length === 1 && accounts.result[0]?.id) {
    return accounts.result[0].id
  }
  const remote = await command(root, 'git', ['remote', 'get-url', 'origin'])
  const repository = /github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/.exec(remote)
  if (!repository) throw new Error('origin GitHub repository is malformed')
  const checkOutput = await command(root, 'gh', [
    'api', `repos/${repository[1]}/${repository[2]}/commits/${approvedGitSha}/check-runs`,
  ])
  const checks = JSON.parse(checkOutput).check_runs?.filter(
    (check) => check.name === 'Cloudflare Pages',
  )
  if (!Array.isArray(checks) || checks.length !== 1 || checks[0].conclusion !== 'success') {
    throw new Error('exact-SHA Cloudflare Pages check is not uniquely successful')
  }
  const accountId = /dash\.cloudflare\.com\/\?to=\/([0-9a-f]{32})\/pages\//
    .exec(checks[0].details_url)?.[1]
  if (!accountId) throw new Error('Cloudflare account ID is missing from exact-SHA metadata')
  return accountId
}

async function liveCloudflareProbe(root, fields) {
  const token = requiredEnvironment('CLOUDFLARE_API_TOKEN')
  const accountId = await cloudflareAccountId(root, token, fields.approved_git_sha)
  const deployments = await fetchJson(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/job-helper/deployments`,
    token,
  )
  const matches = deployments.result?.filter(
    (deployment) => deployment.id === fields.cloudflare_deployment_id,
  )
  if (!Array.isArray(matches) || matches.length !== 1) {
    throw new Error('Cloudflare deployment identity is missing or non-unique')
  }
  const match = matches[0]
  return {
    id: match.id,
    environment: match.environment,
    status: cloudflareStatus(match),
    branch: match.deployment_trigger?.metadata?.branch,
    gitSha: match.deployment_trigger?.metadata?.commit_hash,
    url: match.url,
  }
}

async function liveAssetProbe(root, fields) {
  const local = await readFile(join(root, 'web/dist', fields.asset_path))
  const response = await fetch(`${fields.cloudflare_url}${fields.asset_path}`)
  if (!response.ok) throw new Error(`immutable asset request failed: ${response.status}`)
  const remote = Buffer.from(await response.arrayBuffer())
  return {
    path: fields.asset_path,
    localSha256: sha256(local),
    liveSha256: sha256(remote),
  }
}

export async function collectLivePostReleaseProbes(root, fields) {
  const local = await collectLocalInventory(root)
  const scoreTickSource = await readFile(
    join(root, 'supabase/functions/score-tick/index.ts'),
    'utf8',
  )
  const [
    remoteMigrations,
    countCost,
    finalState,
    cloudflare,
    asset,
    originGitSha,
    schedule,
  ] = await Promise.all([
    remoteMigrationInventory(),
    liveCountAndCostProbe(),
    collectLiveActiveCoverage(),
    liveCloudflareProbe(root, fields),
    liveAssetProbe(root, fields),
    command(root, 'git', ['rev-parse', 'origin/main']),
    scoreTickScheduleProbe(),
  ])
  const scoreTick = await functionProbe(root, 'score-tick', {
    indexSha256: local.scoreTickIndexSha256,
    bundleManifestSha256: local.scoreTickBundleManifestSha256,
    bundleFiles: local.scoreTickBundleFiles,
  })
  return {
    localGitSha: local.gitSha,
    originGitSha,
    inventorySha256: local.inventorySha256,
    projectRef: PROJECT_REF,
    localMigrations: await localMigrationInventory(root),
    remoteMigrations,
    migration0032Sha256: local.migration0032Sha256,
    scoreTick,
    worker: inspectWorkerLivenessSource(scoreTickSource, schedule),
    counts: {
      realUsers: countCost.counts.realUsers,
      openJobs: countCost.counts.openJobs,
      eligibleOwners: countCost.counts.eligibleOwners,
      activeOwners: finalState.activeOwners,
      completeActiveOwners: finalState.completeActiveOwners,
      duplicateActiveOwners: finalState.duplicateActiveOwners,
      incompleteActiveOwners: finalState.incompleteActiveOwners,
      visibleMissingDeterministic: finalState.visibleMissingDeterministic,
      visibleMixedRevision: finalState.visibleMixedRevision,
      nonterminalOpenItems: finalState.nonterminalOpenItems,
    },
    costAfter: countCost.cost,
    cloudflare,
    asset,
  }
}

export async function initializerAuthorityProbe() {
  const row = oneRow(await managementSql(`
    with target as (
      select p.oid, p.proowner, p.prosecdef, p.proconfig, p.proacl
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'initialize_deterministic_ranking_backfill'
        and pg_get_function_identity_arguments(p.oid) = 'batch_size integer'
    ),
    grants as (
      select coalesce(
        array_agg(distinct
          case when acl.grantee = 0 then 'public' else pg_get_userbyid(acl.grantee) end
          order by case when acl.grantee = 0 then 'public' else pg_get_userbyid(acl.grantee) end
        ) filter (where acl.privilege_type = 'EXECUTE'),
        array[]::text[]
      ) as roles
      from target t
      cross join lateral aclexplode(
        coalesce(t.proacl, acldefault('f', t.proowner))
      ) acl
    )
    select pg_get_userbyid(target.proowner) as owner,
           target.prosecdef as security_definer,
           coalesce((
             select replace(setting, 'search_path=', '')
             from unnest(target.proconfig) setting
             where setting like 'search_path=%'
           ), '') as search_path,
           grants.roles,
           exists (
             select 1 from pg_indexes
             where schemaname = 'public'
               and indexname = 'deterministic_ranking_runs_initial_unique'
           ) as initial_unique,
           position('claim_deterministic_ranking_work' in pg_get_functiondef(target.oid)) = 0
             and position('deterministic_ranking_items' in pg_get_functiondef(target.oid)) > 0
             as ordinary_queue
    from target cross join grants
  `), 'initializer authority')
  return {
    owner: String(row.owner),
    securityDefiner: row.security_definer === true,
    searchPath: ['""', "''"].includes(String(row.search_path)) ? '' : String(row.search_path),
    executeRoles: Array.isArray(row.roles)
      ? row.roles.map(String)
      : /^\{[^{}]*\}$/.test(String(row.roles))
        ? String(row.roles).slice(1, -1).split(',').filter(Boolean)
        : [],
    maxBatch: MAX_INITIALIZER_BATCH,
    initialUnique: row.initial_unique === true,
    ordinaryQueue: row.ordinary_queue === true,
  }
}

async function restRpc(name, body) {
  const url = requiredEnvironment('SUPABASE_URL')
  const serviceKey = requiredEnvironment('SUPABASE_SECRET_KEY')
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`${name} API request failed: ${response.status}`)
  return response.json()
}

export async function collectLiveQueueState() {
  const row = oneRow(await managementSql(`
    select
      count(*) filter (where status = 'pending')::integer as pending,
      count(*) filter (where status = 'claimed')::integer as claimed,
      count(*) filter (where status = 'failed')::integer as failed,
      (
        select count(*)::integer from (
          select user_id from public.deterministic_ranking_runs
          where is_initial group by user_id having count(*) > 1
        ) duplicates
      ) as duplicate_owners
    from public.deterministic_ranking_items
  `), 'queue state')
  return {
    pending: rowInteger(row, 'pending'),
    claimed: rowInteger(row, 'claimed'),
    failed: rowInteger(row, 'failed'),
    duplicateOwners: rowInteger(row, 'duplicate_owners'),
  }
}

async function invokeWorker() {
  const url = requiredEnvironment('SUPABASE_URL')
  const secret = requiredEnvironment('CRON_SECRET')
  const response = await fetch(`${url}/functions/v1/score-tick`, {
    method: 'POST',
    headers: { 'x-cron-secret': secret },
  })
  if (!response.ok) throw new Error(`score-tick API request failed: ${response.status}`)
  const body = await response.json()
  if (!body || !Number.isSafeInteger(body.claimed) || !Number.isSafeInteger(body.failed)) {
    throw new Error('score-tick response is malformed')
  }
  return body
}

export async function collectLiveActiveCoverage() {
  const rows = await managementSql(`
    with eligible_owners as (
      select user_id from public.preferences
      union
      select user_id from public.user_jobs
    ),
    active_owner as (
      select owner.user_id,
             coalesce(state.active_revision, 0) as active_revision,
             state.desired_revision,
             state.active_run_id,
             state.status as state_status,
             run.user_id as run_user_id,
             run.revision as run_revision,
             run.status as run_status,
             (
               select count(*)::integer
               from public.deterministic_ranking_runs initial_run
               where initial_run.user_id = owner.user_id
                 and initial_run.is_initial
             ) as initial_run_count
      from eligible_owners owner
      left join public.deterministic_ranking_state state on state.user_id = owner.user_id
      left join public.deterministic_ranking_runs run on run.id = state.active_run_id
    ),
    current_open_coverage as (
      select
        owner.user_id,
        owner.active_revision,
        job.id as job_id,
        user_job.id as user_job_id,
        user_job.deterministic_revision,
        user_job.deterministic_eligible,
        user_job.deterministic_score,
        user_job.deterministic_tier,
        user_job.deterministic_breakdown,
        count(item.id)::integer as active_item_count,
        count(item.id) filter (
          where item.status = 'completed'
            and item.revision = owner.active_revision
            and item.user_id = owner.user_id
            and item.user_job_id = user_job.id
        )::integer as exact_completed_result_count,
        count(item.id) filter (
          where item.revision is distinct from owner.active_revision
            or item.user_id is distinct from owner.user_id
            or item.user_job_id is distinct from user_job.id
        )::integer as mixed_item_count
      from active_owner owner
      cross join public.jobs job
      left join public.user_jobs user_job
        on user_job.user_id = owner.user_id
       and user_job.job_id = job.id
      left join public.deterministic_ranking_items item
        on item.run_id = owner.active_run_id
       and item.job_id = job.id
      where job.status = 'open'
      group by
        owner.user_id,
        owner.active_revision,
        job.id,
        user_job.id,
        user_job.deterministic_revision,
        user_job.deterministic_eligible,
        user_job.deterministic_score,
        user_job.deterministic_tier,
        user_job.deterministic_breakdown
    ),
    current_open_health as (
      select
        coverage.user_id,
        count(*)::integer as current_open_jobs,
        count(*) filter (
          where coverage.active_item_count = 1
            and coverage.exact_completed_result_count = 1
        )::integer as exact_current_open_results,
        count(*) filter (
          where coverage.exact_completed_result_count = 0
        )::integer as missing_current_open_results,
        count(*) filter (
          where coverage.active_item_count > 1
            or coverage.exact_completed_result_count > 1
        )::integer as duplicate_current_open_results,
        count(*) filter (
          where coverage.user_job_id is null
            or coverage.exact_completed_result_count <> 1
            or coverage.deterministic_eligible is null
            or (
              coverage.deterministic_eligible
              and (
                coverage.deterministic_score is null
                or coverage.deterministic_tier is null
                or coverage.deterministic_breakdown is null
              )
            )
        )::integer as visible_missing_deterministic,
        count(*) filter (
          where coverage.user_job_id is not null
            and (
              coverage.deterministic_revision is distinct from coverage.active_revision
              or coverage.mixed_item_count > 0
            )
        )::integer as visible_mixed_revision
      from current_open_coverage coverage
      group by coverage.user_id
    ),
    active_item_health as (
      select
        owner.user_id,
        count(item.id) filter (
          where item.status <> 'completed'
        )::integer as nonterminal_active_items,
        count(item.id) filter (
          where job.status = 'open' and item.status <> 'completed'
        )::integer as nonterminal_open_items,
        count(item.id) filter (
          where item.status = 'failed'
        )::integer as failed_active_items,
        count(item.id) filter (
          where item.revision is distinct from owner.active_revision
            or item.user_id is distinct from owner.user_id
            or user_job.user_id is distinct from owner.user_id
            or user_job.job_id is distinct from item.job_id
        )::integer as mixed_active_items,
        count(item.id) filter (
          where job.status = 'open'
            and (
              user_job.id is null
              or user_job.user_id is distinct from owner.user_id
              or user_job.job_id is distinct from item.job_id
            )
        )::integer as surplus_open_items,
        count(item.id) filter (
          where job.status is distinct from 'open'
            and (
              item.status <> 'completed'
              or item.revision is distinct from owner.active_revision
              or item.user_id is distinct from owner.user_id
              or user_job.user_id is distinct from owner.user_id
              or user_job.job_id is distinct from item.job_id
            )
        )::integer as invalid_closed_surplus_items,
        count(item.id) filter (
          where job.status is distinct from 'open'
            and item.status = 'completed'
            and item.revision = owner.active_revision
            and item.user_id = owner.user_id
            and user_job.user_id = owner.user_id
            and user_job.job_id = item.job_id
        )::integer as historical_closed_completed_items
      from active_owner owner
      left join public.deterministic_ranking_items item
        on item.run_id = owner.active_run_id
      left join public.jobs job on job.id = item.job_id
      left join public.user_jobs user_job on user_job.id = item.user_job_id
      group by owner.user_id
    )
    select
      case when
        owner.active_revision > 0
        and owner.desired_revision = owner.active_revision
        and owner.state_status = 'idle'
        and owner.active_run_id is not null
        and owner.run_user_id = owner.user_id
        and owner.run_revision = owner.active_revision
        and owner.run_status = 'completed'
      then 1 else 0 end::integer as active_owner_ready,
      owner.active_revision::bigint,
      coalesce(current_health.current_open_jobs, 0)::integer as current_open_jobs,
      coalesce(current_health.exact_current_open_results, 0)::integer
        as exact_current_open_results,
      coalesce(current_health.missing_current_open_results, 0)::integer
        as missing_current_open_results,
      coalesce(current_health.duplicate_current_open_results, 0)::integer
        as duplicate_current_open_results,
      coalesce(current_health.visible_missing_deterministic, 0)::integer
        as visible_missing_deterministic,
      coalesce(current_health.visible_mixed_revision, 0)::integer
        as visible_mixed_revision,
      coalesce(item_health.nonterminal_active_items, 0)::integer
        as nonterminal_active_items,
      coalesce(item_health.nonterminal_open_items, 0)::integer
        as nonterminal_open_items,
      coalesce(item_health.failed_active_items, 0)::integer as failed_active_items,
      coalesce(item_health.mixed_active_items, 0)::integer as mixed_active_items,
      coalesce(item_health.surplus_open_items, 0)::integer as surplus_open_items,
      coalesce(item_health.invalid_closed_surplus_items, 0)::integer
        as invalid_closed_surplus_items,
      coalesce(item_health.historical_closed_completed_items, 0)::integer
        as historical_closed_completed_items,
      owner.initial_run_count::integer
    from active_owner owner
    left join current_open_health current_health on current_health.user_id = owner.user_id
    left join active_item_health item_health on item_health.user_id = owner.user_id
    order by owner.user_id
  `)
  return summarizeActiveCoverageRows(rows)
}

async function liveBackfillAdapters(root) {
  return {
    async preflight() {
      const probes = await collectLivePreflightProbes(root)
      return {
        gitSha: probes.gitSha,
        inventorySha256: probes.inventorySha256,
        ownerCount: probes.counts.realUsers,
        openJobCount: probes.counts.openJobs,
        costBaselineSha256: probes.cost.sha256,
      }
    },
    authority: initializerAuthorityProbe,
    async initialize(batchSize) {
      const body = await restRpc('initialize_deterministic_ranking_backfill', {
        batch_size: batchSize,
      })
      if (!Array.isArray(body) || body.length !== 1) {
        throw new Error('initializer response is malformed')
      }
      return body[0]
    },
    queueState: collectLiveQueueState,
    tick: invokeWorker,
    async costBaseline() {
      return (await liveCountAndCostProbe()).cost.sha256
    },
    async wait(milliseconds) {
      await new Promise((resolve) => setTimeout(resolve, milliseconds))
    },
    finalState: collectLiveActiveCoverage,
  }
}

function parseIntegerOption(value, name) {
  if (!NONNEGATIVE_INTEGER.test(value ?? '')) throw new Error(`${name} is malformed`)
  return Number(value)
}

function option(argv, name) {
  const index = argv.indexOf(name)
  if (index < 0 || index === argv.length - 1) throw new Error(`${name} is required`)
  return argv[index + 1]
}

function usage() {
  return [
    'Usage:',
    '  node scripts/verify-phase-03-4-release.mjs --inventory',
    '  node scripts/verify-phase-03-4-release.mjs --preflight PATH',
    '  node scripts/verify-phase-03-4-release.mjs --initialize-backfill \\',
    '    --approved-sha SHA --approved-inventory-sha256 SHA256 \\',
    '    --approved-owner-count N --approved-open-job-count N \\',
    '    --approved-cost-baseline-sha256 SHA256',
    '  node scripts/verify-phase-03-4-release.mjs --post-release PATH',
  ].join('\n')
}

async function main(argv) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(usage())
    return
  }
  if (argv.length === 1 && argv[0] === '--inventory') {
    console.log(JSON.stringify(await collectLocalInventory(root), null, 2))
    return
  }
  if (argv.length === 2 && argv[0] === '--preflight') {
    const parsed = validateEvidenceText('preflight', await readFile(resolve(argv[1]), 'utf8'))
    await liveSourceProbe(root)
    const probes = await collectLivePreflightProbes(root)
    verifyPreflightEvidence(parsed.fields, probes)
    console.log('PASS: Phase 03.4 preflight is exact, contained, read-only, and cost-bound')
    return
  }
  if (argv[0] === '--initialize-backfill') {
    const approval = {
      approvedSha: option(argv, '--approved-sha'),
      approvedInventorySha256: option(argv, '--approved-inventory-sha256'),
      approvedOwnerCount: parseIntegerOption(
        option(argv, '--approved-owner-count'),
        '--approved-owner-count',
      ),
      approvedOpenJobCount: parseIntegerOption(
        option(argv, '--approved-open-job-count'),
        '--approved-open-job-count',
      ),
      approvedCostBaselineSha256: option(argv, '--approved-cost-baseline-sha256'),
    }
    const result = await runApprovedBackfill(approval, await liveBackfillAdapters(root))
    console.log(JSON.stringify(result))
    return
  }
  if (argv.length === 2 && argv[0] === '--post-release') {
    const parsed = validateEvidenceText('post-release', await readFile(resolve(argv[1]), 'utf8'))
    await liveSourceProbe(root)
    const probes = await collectLivePostReleaseProbes(root, parsed.fields)
    verifyPostReleaseEvidence(parsed.fields, probes)
    console.log('PASS: Phase 03.4 post-release evidence is exact, complete, no-mix, and cost-invariant')
    return
  }
  throw new Error(usage())
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : 'Phase 03.4 release verification failed')
    process.exitCode = 1
  })
}

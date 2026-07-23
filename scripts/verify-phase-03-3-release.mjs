#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const SHA40 = /^[0-9a-f]{40}$/
const SHA256 = /^[0-9a-f]{64}$/
const POSITIVE_INTEGER = /^[1-9][0-9]*$/
const NONNEGATIVE_INTEGER = /^(?:0|[1-9][0-9]*)$/
const MIGRATION_INVENTORY = /^\d{4}(?:,\d{4})*$/

const IDENTITY_SCHEMA = Object.freeze({
  evidence_mode: 'identity',
  approved_git_sha: SHA40,
  project_ref: /^fjcsvajkkztvlrpdplwx$/,
  local_migrations: MIGRATION_INVENTORY,
  remote_migrations: MIGRATION_INVENTORY,
  migration_0031_sha256: SHA256,
  score_tick_previous_deployment_id: /\S/,
  score_tick_previous_version: POSITIVE_INTEGER,
  score_tick_deployment_id: /\S/,
  score_tick_version: POSITIVE_INTEGER,
  score_tick_status: /^ACTIVE$/,
  score_tick_verify_jwt: /^false$/,
  score_tick_filter_revision: /^filter-v4$/,
  cloudflare_previous_deployment_id: /\S/,
  cloudflare_deployment_id: /\S/,
  cloudflare_environment: /^production$/,
  cloudflare_status: /^success$/,
  cloudflare_branch: /^main$/,
  cloudflare_git_sha: SHA40,
  cloudflare_url: /^https:\/\/[^\s/]+\.pages\.dev$/,
  asset_path: /^\/assets\/[A-Za-z0-9._-]+\.js$/,
  local_asset_sha256: SHA256,
  live_asset_sha256: SHA256,
})

const POST_RELEASE_ONLY_SCHEMA = Object.freeze({
  owner_open_rows_before: NONNEGATIVE_INTEGER,
  reservations_before: NONNEGATIVE_INTEGER,
  deployed_daily_cap: POSITIVE_INTEGER,
  uat_paid_reservation_ceiling: NONNEGATIVE_INTEGER,
  preference_save_count: NONNEGATIVE_INTEGER,
  reservations_after: NONNEGATIVE_INTEGER,
  owner_score_usage_before: NONNEGATIVE_INTEGER,
  owner_score_usage_after: NONNEGATIVE_INTEGER,
  other_score_usage_before: NONNEGATIVE_INTEGER,
  other_score_usage_after: NONNEGATIVE_INTEGER,
  owner_revision_sum_before: NONNEGATIVE_INTEGER,
  owner_revision_sum_after_empty_save: NONNEGATIVE_INTEGER,
  owner_revision_sum_after_restore_save: NONNEGATIVE_INTEGER,
  empty_save_affected_rows: NONNEGATIVE_INTEGER,
  restore_save_affected_rows: NONNEGATIVE_INTEGER,
  owner_unconverged_after_empty_save: NONNEGATIVE_INTEGER,
  owner_unconverged_after_restore_save: NONNEGATIVE_INTEGER,
  preference_snapshot_sha256_before: SHA256,
  preference_snapshot_sha256_after: SHA256,
  preferences_restored_exactly: /^true$/,
  unauthorized_manual_score_tick_invocations: /^0$/,
  unauthorized_scoring_verifier_runs: /^0$/,
  unauthorized_fixture_rows: /^0$/,
  unauthorized_direct_openai_calls: /^0$/,
  unauthorized_global_requeues: /^0$/,
  unauthorized_scheduler_mutations: /^0$/,
  unauthorized_budget_mutations: /^0$/,
})

const POST_RELEASE_SCHEMA = Object.freeze({
  ...IDENTITY_SCHEMA,
  evidence_mode: 'post_release',
  ...POST_RELEASE_ONLY_SCHEMA,
})

function parseEvidence(text) {
  const fields = Object.create(null)
  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line || line.startsWith('#') || line.startsWith('<!--') || line === '---') continue
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
  const schema = mode === 'identity'
    ? IDENTITY_SCHEMA
    : mode === 'post-release'
      ? POST_RELEASE_SCHEMA
      : null
  if (!schema) throw new Error('mode must be identity or post-release')
  const fields = parseEvidence(text)
  requireSchema(fields, schema)
  return { mode, fields: Object.freeze({ ...fields }) }
}

function asInventory(value) {
  return typeof value === 'string' ? value.split(',') : [...value]
}

function requireEqual(actual, expected, label) {
  if (String(actual) !== String(expected)) throw new Error(`${label} mismatch`)
}

function requireExactValue(value, expected, label) {
  if (String(value) !== expected) throw new Error(`${label} must equal ${expected}`)
}

function requireMigration31Order(inventory, label) {
  const indexes = inventory.flatMap((migration, index) => migration === '0031' ? [index] : [])
  if (indexes.length !== 1 || indexes[0] === 0 || inventory[indexes[0] - 1] !== '0030') {
    throw new Error(`${label} migration 0031 must occur exactly once immediately after 0030`)
  }
}

function requireInventory(actual, expectedText, label) {
  const expected = asInventory(expectedText)
  requireMigration31Order(expected, label)
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(`${label} migration inventory mismatch`)
  }
  requireMigration31Order(actual, label)
}

function resolveProbes(probeSource) {
  return typeof probeSource === 'function' ? probeSource() : probeSource
}

export function verifyIdentityEvidence(fields, probeSource) {
  const probes = resolveProbes(probeSource)
  requireEqual(probes.localGitSha, fields.approved_git_sha, 'local Git SHA')
  requireEqual(probes.originGitSha, fields.approved_git_sha, 'origin/main Git SHA')
  requireInventory(asInventory(probes.localMigrations), fields.local_migrations, 'local')
  requireInventory(asInventory(probes.remoteMigrations), fields.remote_migrations, 'remote')
  requireEqual(fields.local_migrations, fields.remote_migrations, 'local/remote migration parity')
  requireEqual(probes.migration0031Sha256, fields.migration_0031_sha256, 'migration 0031 SHA-256')

  // Supabase keeps a stable function UUID across deployments. Freshness is the
  // monotonically advancing hosted version plus the exact filter-v4 source,
  // not an invented expectation that the UUID changes.
  if (Number(fields.score_tick_version) <= Number(fields.score_tick_previous_version)) {
    throw new Error('score-tick version did not advance')
  }
  requireEqual(probes.scoreTick.id, fields.score_tick_deployment_id, 'score-tick deployment ID')
  requireEqual(probes.scoreTick.version, fields.score_tick_version, 'score-tick version')
  requireEqual(probes.scoreTick.status, fields.score_tick_status, 'score-tick status')
  requireEqual(String(probes.scoreTick.verifyJwt), fields.score_tick_verify_jwt, 'score-tick verify_jwt')
  requireExactValue(probes.scoreTick.filterRevision, 'filter-v4', 'score-tick filter revision')
  requireExactValue(fields.score_tick_filter_revision, 'filter-v4', 'evidence score-tick filter revision')

  if (fields.cloudflare_deployment_id === fields.cloudflare_previous_deployment_id) {
    throw new Error('Cloudflare deployment identity is stale')
  }
  requireEqual(probes.cloudflare.id, fields.cloudflare_deployment_id, 'Cloudflare deployment ID')
  requireExactValue(probes.cloudflare.environment, 'production', 'Cloudflare environment')
  requireExactValue(probes.cloudflare.status, 'success', 'Cloudflare status')
  requireExactValue(probes.cloudflare.branch, 'main', 'Cloudflare branch')
  requireEqual(probes.cloudflare.gitSha, fields.approved_git_sha, 'Cloudflare Git SHA')
  requireEqual(fields.cloudflare_git_sha, fields.approved_git_sha, 'evidence Cloudflare Git SHA')
  requireEqual(probes.cloudflare.url, fields.cloudflare_url, 'Cloudflare immutable URL')

  if (fields.local_asset_sha256 !== fields.live_asset_sha256) {
    throw new Error('evidence asset hashes must match')
  }
  requireEqual(probes.asset.path, fields.asset_path, 'asset path')
  requireEqual(probes.asset.localSha256, fields.local_asset_sha256, 'local asset SHA-256')
  requireEqual(probes.asset.liveSha256, fields.live_asset_sha256, 'live asset SHA-256')
  requireEqual(probes.asset.localSha256, probes.asset.liveSha256, 'local/live asset SHA-256')
  return Object.freeze({ approvedGitSha: fields.approved_git_sha })
}

function toCount(fields, key) {
  const value = Number(fields[key])
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${key} is not a safe counter`)
  return value
}

function requireZero(fields, key) {
  if (toCount(fields, key) !== 0) throw new Error(`${key} must equal 0`)
}

export function verifyPostReleaseEvidence(fields, probeSource) {
  verifyIdentityEvidence(fields, probeSource)
  const openRows = toCount(fields, 'owner_open_rows_before')
  const reservationsBefore = toCount(fields, 'reservations_before')
  const dailyCap = toCount(fields, 'deployed_daily_cap')
  const ceiling = Math.min(10 * openRows, Math.max(0, dailyCap - reservationsBefore))
  if (toCount(fields, 'uat_paid_reservation_ceiling') !== ceiling) {
    throw new Error('uat_paid_reservation_ceiling must equal min(10 × N, max(0, C - R))')
  }
  if (toCount(fields, 'preference_save_count') !== 2) {
    throw new Error('preference_save_count must equal 2')
  }

  const reservationDelta = toCount(fields, 'reservations_after') - reservationsBefore
  if (reservationDelta < 0 || reservationDelta > ceiling) {
    throw new Error('reservation delta exceeds approved ceiling')
  }
  const ownerUsageDelta = toCount(fields, 'owner_score_usage_after') -
    toCount(fields, 'owner_score_usage_before')
  if (ownerUsageDelta < 0 || ownerUsageDelta > ceiling) {
    throw new Error('owner usage delta exceeds approved ceiling')
  }
  if (toCount(fields, 'other_score_usage_after') !== toCount(fields, 'other_score_usage_before')) {
    throw new Error('other-user score usage changed')
  }

  const revisionBefore = toCount(fields, 'owner_revision_sum_before')
  const revisionAfterEmpty = toCount(fields, 'owner_revision_sum_after_empty_save')
  const revisionAfterRestore = toCount(fields, 'owner_revision_sum_after_restore_save')
  const emptyAffected = toCount(fields, 'empty_save_affected_rows')
  const restoreAffected = toCount(fields, 'restore_save_affected_rows')
  if (emptyAffected !== openRows || revisionAfterEmpty - revisionBefore !== emptyAffected) {
    throw new Error('empty-save revision delta mismatch')
  }
  if (restoreAffected !== openRows || revisionAfterRestore - revisionAfterEmpty !== restoreAffected) {
    throw new Error('restoration revision delta mismatch')
  }
  if (toCount(fields, 'owner_unconverged_after_empty_save') !== 0) {
    throw new Error('owner rows did not converge after empty save')
  }
  if (toCount(fields, 'owner_unconverged_after_restore_save') !== 0) {
    throw new Error('owner rows did not converge after restoration')
  }
  requireEqual(
    fields.preference_snapshot_sha256_after,
    fields.preference_snapshot_sha256_before,
    'preference snapshot hash',
  )
  requireExactValue(fields.preferences_restored_exactly, 'true', 'preferences_restored_exactly')

  for (const key of [
    'unauthorized_manual_score_tick_invocations',
    'unauthorized_scoring_verifier_runs',
    'unauthorized_fixture_rows',
    'unauthorized_direct_openai_calls',
    'unauthorized_global_requeues',
    'unauthorized_scheduler_mutations',
    'unauthorized_budget_mutations',
  ]) requireZero(fields, key)

  return Object.freeze({ ceiling, reservationDelta, ownerUsageDelta })
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

async function command(cwd, executable, args, options = {}) {
  const result = await execFile(executable, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
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

  // This Pages token is project-scoped and intentionally cannot list accounts.
  // The successful exact-SHA GitHub check contains Cloudflare's account-scoped
  // dashboard URL; derive the ID from that read-only, commit-bound metadata.
  const remote = await command(root, 'git', ['remote', 'get-url', 'origin'])
  const repository = /github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/.exec(remote)
  if (!repository) throw new Error('origin GitHub repository is malformed')
  const checkOutput = await command(root, 'gh', [
    'api', `repos/${repository[1]}/${repository[2]}/commits/${approvedGitSha}/check-runs`,
  ])
  const checks = JSON.parse(checkOutput).check_runs?.filter((check) => check.name === 'Cloudflare Pages')
  if (!Array.isArray(checks) || checks.length !== 1 || checks[0].conclusion !== 'success') {
    throw new Error('exact-SHA Cloudflare Pages check is not uniquely successful')
  }
  const accountId = /dash\.cloudflare\.com\/\?to=\/([0-9a-f]{32})\/pages\//
    .exec(checks[0].details_url)?.[1]
  if (!accountId) throw new Error('Cloudflare account ID is missing from the exact-SHA check')
  return accountId
}

async function liveCloudflareProbe(root, fields) {
  const token = requiredEnvironment('CLOUDFLARE_API_TOKEN')
  const accountId = await cloudflareAccountId(root, token, fields.approved_git_sha)
  const deployments = await fetchJson(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/job-helper/deployments`,
    token,
  )
  const match = deployments.result?.find((deployment) => deployment.id === fields.cloudflare_deployment_id)
  if (!match) throw new Error('Cloudflare deployment was not found')
  return {
    id: match.id,
    environment: match.environment,
    status: cloudflareStatus(match),
    branch: match.deployment_trigger?.metadata?.branch,
    gitSha: match.deployment_trigger?.metadata?.commit_hash,
    url: match.url,
  }
}

async function liveSupabaseProbe(root, fields) {
  requiredEnvironment('SUPABASE_ACCESS_TOKEN')
  const cli = join(root, 'web/node_modules/.bin/supabase')
  const migrationOutput = await command(root, cli, ['migration', 'list', '--linked'])
  const migrationDocument = JSON.parse(migrationOutput)
  const remoteMigrations = migrationDocument.migrations
    .filter((entry) => entry.remote)
    .map((entry) => String(entry.remote))
  const functionsOutput = await command(root, cli, [
    'functions', 'list', '--project-ref', fields.project_ref, '-o', 'json',
  ])
  const functions = JSON.parse(functionsOutput)
  const scoreTick = functions.find((entry) => entry.slug === 'score-tick')
  if (!scoreTick) throw new Error('score-tick function metadata is missing')
  const scoreSource = await readFile(join(root, 'supabase/functions/score-tick/index.ts'), 'utf8')
  const revision = /SCORING_FILTER_REVISION\s*=\s*['"]([^'"]+)['"]/.exec(scoreSource)?.[1]
  if (!scoreSource.includes("request.headers.get('x-cron-secret')")) {
    throw new Error('score-tick cron-secret guard is missing')
  }
  return {
    remoteMigrations,
    scoreTick: {
      id: scoreTick.id,
      version: String(scoreTick.version),
      status: scoreTick.status,
      verifyJwt: scoreTick.verify_jwt,
      filterRevision: revision,
    },
  }
}

async function liveAssetProbe(root, fields) {
  const localPath = join(root, 'web/dist', fields.asset_path)
  const local = await readFile(localPath)
  const response = await fetch(`${fields.cloudflare_url}${fields.asset_path}`)
  if (!response.ok) throw new Error(`immutable asset request failed: ${response.status}`)
  const live = Buffer.from(await response.arrayBuffer())
  return { path: fields.asset_path, localSha256: sha256(local), liveSha256: sha256(live) }
}

async function liveProbes(root, fields) {
  const migrationDirectory = join(root, 'supabase/migrations')
  const localMigrations = (await readdir(migrationDirectory))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .map((name) => name.slice(0, 4))
    .sort()
  const migration0031 = await readFile(join(migrationDirectory, '0031_dashboard_filter_refinements.sql'))
  const supabase = await liveSupabaseProbe(root, fields)
  return {
    localGitSha: await command(root, 'git', ['rev-parse', 'HEAD']),
    originGitSha: await command(root, 'git', ['rev-parse', 'origin/main']),
    localMigrations,
    remoteMigrations: supabase.remoteMigrations,
    migration0031Sha256: sha256(migration0031),
    scoreTick: supabase.scoreTick,
    cloudflare: await liveCloudflareProbe(root, fields),
    asset: await liveAssetProbe(root, fields),
  }
}

function usage() {
  return [
    'Usage:',
    '  node scripts/verify-phase-03-3-release.mjs --identity PATH',
    '  node scripts/verify-phase-03-3-release.mjs --post-release PATH',
  ].join('\n')
}

async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(usage())
    return
  }
  if (argv.length !== 2 || !['--identity', '--post-release'].includes(argv[0])) {
    throw new Error(usage())
  }
  const mode = argv[0] === '--identity' ? 'identity' : 'post-release'
  const evidencePath = resolve(argv[1])
  const parsed = validateEvidenceText(mode, await readFile(evidencePath, 'utf8'))
  const scriptDirectory = dirname(fileURLToPath(import.meta.url))
  const root = resolve(scriptDirectory, '..')
  const probes = await liveProbes(root, parsed.fields)
  const result = mode === 'identity'
    ? verifyIdentityEvidence(parsed.fields, probes)
    : verifyPostReleaseEvidence(parsed.fields, probes)
  console.log(`PASS: Phase 03.3 ${mode} evidence is fail-closed and exact`)
  return result
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : 'Phase 03.3 release verification failed')
    process.exitCode = 1
  })
}

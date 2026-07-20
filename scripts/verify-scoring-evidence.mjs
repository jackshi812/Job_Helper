#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const SHA40 = /^[0-9a-f]{40}$/
const SHA256 = /^[0-9a-f]{64}$/
const NONNEGATIVE_INTEGER = /^(?:0|[1-9][0-9]*)$/

const ROLLOUT_REQUIRED = {
  evidence_mode: 'rollout',
  local_git_sha: SHA40,
  origin_git_sha: SHA40,
  migration_head: '0025',
  migration_0025_applied: 'true',
  score_tick_deployment_id: /\S/,
  score_tick_version: /\S/,
  cloudflare_deployment_id: /\S/,
  cloudflare_url: /^https:\/\/\S+$/,
  cloudflare_status: 'success',
  asset_url: /^\/assets\/\S+$/,
  asset_sha256: SHA256,
  latch_table_present: 'true',
  begin_function_present: 'true',
  end_function_present: 'true',
  claim_function_present: 'true',
  maintenance_max_ttl_seconds: '300',
  maintenance_service_role_only: 'true',
  notification_runtime_absent: 'true',
  notification_schema_absent: 'true',
  notification_secrets_absent: 'true',
  notification_client_absent: 'true',
  notification_ui_absent: 'true',
  local_safety_command: /\S/,
  local_safety_result: 'pass',
  paid_verifier_runs: '0',
  manual_score_tick_invocations: '0',
  maintenance_runs_started: '0',
  openai_calls_by_plan_03_10: '0',
}

const PAID_REQUIRED = {
  ...ROLLOUT_REQUIRED,
  evidence_mode: 'paid',
  rollout_local_git_sha: SHA40,
  rollout_origin_git_sha: SHA40,
  rollout_migration_head: '0025',
  rollout_score_tick_deployment_id: /\S/,
  rollout_cloudflare_deployment_id: /\S/,
  rollout_asset_sha256: SHA256,
  paid_verifier_runs: '1',
  score_tick_invocations: '1',
  fixture_user_jobs: '2',
  late_job_isolated: 'true',
  late_preference_isolated: 'true',
  late_reroute_isolated: 'true',
  no_id_claimed: '0',
  mismatched_id_claimed: '0',
  authenticated_writes_denied: 'true',
  positive_fixture_outcome: 'scored',
  negative_fixture_outcome: 'filtered',
  owned_global_usage_delta: '1',
  other_global_usage_delta: '0',
  maintenance_runs_started: '1',
  rows_restored_exactly: 'true',
  preferences_restored_exactly: 'true',
  latch_released_or_expired: 'true',
  cron_restored_exactly: 'true',
  residue_count: '0',
  openai_calls_by_plan_03_10: '0',
  openai_calls_by_plan_03_11: '1',
}

function parseEvidence(text) {
  const fields = Object.create(null)
  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]
    const line = raw.trim()
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

function requireSame(fields, left, right, label) {
  if (fields[left] !== fields[right]) throw new Error(`${label} mismatch`)
}

export function validateEvidenceText(mode, text) {
  if (mode !== 'rollout' && mode !== 'paid') throw new Error('mode must be rollout or paid')
  const fields = parseEvidence(text)
  requireSchema(fields, mode === 'rollout' ? ROLLOUT_REQUIRED : PAID_REQUIRED)
  requireSame(fields, 'local_git_sha', 'origin_git_sha', 'local/origin git SHA')

  for (const key of [
    'paid_verifier_runs',
    'manual_score_tick_invocations',
    'maintenance_runs_started',
    'openai_calls_by_plan_03_10',
    'openai_calls_by_plan_03_11',
    'score_tick_invocations',
    'fixture_user_jobs',
    'no_id_claimed',
    'mismatched_id_claimed',
    'owned_global_usage_delta',
    'other_global_usage_delta',
    'residue_count',
  ]) {
    if (Object.hasOwn(fields, key) && !NONNEGATIVE_INTEGER.test(fields[key])) {
      throw new Error(`${key} is malformed`)
    }
  }

  if (mode === 'paid') {
    requireSame(fields, 'rollout_local_git_sha', 'local_git_sha', 'rollout local git SHA')
    requireSame(fields, 'rollout_origin_git_sha', 'origin_git_sha', 'rollout origin git SHA')
    requireSame(fields, 'rollout_migration_head', 'migration_head', 'rollout migration head')
    requireSame(
      fields,
      'rollout_score_tick_deployment_id',
      'score_tick_deployment_id',
      'rollout score-tick deployment',
    )
    requireSame(
      fields,
      'rollout_cloudflare_deployment_id',
      'cloudflare_deployment_id',
      'rollout Cloudflare deployment',
    )
    requireSame(fields, 'rollout_asset_sha256', 'asset_sha256', 'rollout asset SHA')
  }

  return { mode, fields: Object.freeze({ ...fields }) }
}

export async function validateEvidenceFile(mode, filePath) {
  return validateEvidenceText(mode, await readFile(filePath, 'utf8'))
}

function usage() {
  return [
    'Usage:',
    '  node scripts/verify-scoring-evidence.mjs --rollout PATH',
    '  node scripts/verify-scoring-evidence.mjs --paid PATH',
  ].join('\n')
}

async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(usage())
    return
  }
  if (argv.length !== 2 || !['--rollout', '--paid'].includes(argv[0])) {
    throw new Error(usage())
  }
  const mode = argv[0] === '--rollout' ? 'rollout' : 'paid'
  const result = await validateEvidenceFile(mode, argv[1])
  console.log(`PASS: ${result.mode} scoring evidence is complete and internally consistent`)
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : 'Evidence validation failed')
    process.exitCode = 1
  })
}

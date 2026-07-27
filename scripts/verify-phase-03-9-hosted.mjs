#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  DEFAULT_MANIFEST,
  RELEASE_MANIFEST_ID,
  validateManifest,
} from './run-phase-03-9-rollout.mjs'

const DEFAULT_OUTPUT =
  '.planning/phases/03.9-jpmorgan-chase-selective-oracle-monitoring/03.9-01-HOSTED-VERIFICATION.json'

export function evaluateHostedSnapshot(manifest, snapshot) {
  const checks = {
    migration_0045: snapshot.remote_migrations?.includes('0045') === true,
    repair_migrations: ['0046', '0047'].every(
      (version) => snapshot.remote_migrations?.includes(version) === true,
    ),
    function_parity: ['observe-connectors', 'poll-tick'].every(
      (slug) => snapshot.functions?.[slug]?.status === 'ACTIVE'
        && snapshot.functions[slug].verify_jwt === manifest.functions[slug].verify_jwt,
    ),
    exact_catalog: snapshot.catalog?.source_key === manifest.source_key
      && snapshot.catalog?.careers_url === manifest.public_url,
    activation: snapshot.company?.source_key === manifest.source_key
      && snapshot.company?.activation_state === 'active'
      && snapshot.company?.activation_successes === 3,
    natural_poll: snapshot.company?.last_success_at != null
      && snapshot.company?.last_polled_at != null
      && snapshot.company?.last_error_code == null,
    eligible_job: Number(snapshot.eligible_job_count) > 0,
    closure_disabled: Number(snapshot.absence_closed_count) === 0,
    protected_sources: snapshot.protected_sources_unchanged === true,
    zero_residue: Number(snapshot.verifier_residue_count) === 0,
  }
  const status = Object.values(checks).every(Boolean)
    ? 'PASS'
    : snapshot.company?.activation_state === 'unsupported'
      ? 'UNSUPPORTED'
      : 'PENDING'
  return {
    schema_version: 1,
    phase: '03.9',
    release_manifest_id: RELEASE_MANIFEST_ID,
    status,
    checks: Object.fromEntries(Object.entries(checks).map(
      ([key, passed]) => [key, { status: passed ? 'PASS' : 'PENDING' }],
    )),
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonical(value[key])}`,
    ).join(',')}}`
  }
  return JSON.stringify(value)
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message)
}

export function assertHostedRecord(manifest, record) {
  requireCondition(record.schema_version === 1 && record.phase === '03.9',
    'hosted verification version/phase drift')
  requireCondition(record.release_manifest_id === manifest.release_manifest_id,
    'hosted verification release drift')
  requireCondition(record.status === 'PASS',
    'hosted verification is not PASS')
  requireCondition(
    Object.keys(record.checks ?? {}).length > 0
      && Object.values(record.checks).every((check) => check.status === 'PASS'),
    'hosted verification contains a non-PASS check',
  )
  requireCondition(
    record.evidence?.source_key === manifest.source_key
      && record.evidence?.careers_url === manifest.public_url,
    'hosted verification source identity drift',
  )
  return record
}

export function uatApprovalPayload(manifest, record) {
  return {
    schema_version: record.schema_version,
    phase: record.phase,
    release_manifest_id: record.release_manifest_id,
    source_key: record.source_key,
    hosted_verification_sha256: record.hosted_verification_sha256,
    rollout_verification_sha256: record.rollout_verification_sha256,
    owner_browser_required: record.owner_browser_required,
    codex_browser_used: record.codex_browser_used,
    expected_watchlist: record.expected_watchlist,
    expected_job: record.expected_job,
  }
}

export function exactUatApproval(manifest, record) {
  const payloadHash = sha256(canonical(uatApprovalPayload(manifest, record)))
  return [
    'approve Phase 03.9 JPMorgan UAT',
    manifest.release_manifest_id,
    payloadHash,
  ].join(' ')
}

export function assertUatRecord(manifest, record) {
  requireCondition(record.schema_version === 1 && record.phase === '03.9',
    'UAT version/phase drift')
  requireCondition(record.release_manifest_id === manifest.release_manifest_id,
    'UAT release drift')
  requireCondition(record.source_key === manifest.source_key,
    'UAT source identity drift')
  requireCondition(record.owner_browser_required === true,
    'UAT must require the owner browser')
  requireCondition(record.codex_browser_used === false,
    'Codex browser use is forbidden for this UAT')
  requireCondition(record.expected_watchlist?.activation_state === 'active'
    && record.expected_watchlist?.activation_successes === 3
    && record.expected_watchlist?.careers_url === manifest.public_url,
  'UAT Watchlist expectation drift')
  requireCondition(Number(record.expected_job?.eligible_job_count) > 0
    && record.expected_job?.source_key === manifest.source_key
    && record.expected_job?.apply_url?.startsWith('https://') === true,
  'UAT job expectation drift')
  const requiredApproval = exactUatApproval(manifest, record)
  requireCondition(record.required_approval === requiredApproval,
    'UAT approval payload drift')
  if (record.status === 'PASS') {
    requireCondition(record.owner_attestation === requiredApproval,
      'UAT PASS requires the literal owner approval')
  } else {
    requireCondition(record.status === 'PENDING_OWNER_BROWSER',
      'UAT has an invalid non-PASS state')
    requireCondition(record.owner_attestation == null,
      'pending UAT cannot contain an owner attestation')
  }
  return { status: record.status, required_approval: requiredApproval }
}

function parseArgs(argv) {
  const result = {
    mode: 'snapshot',
    manifest: DEFAULT_MANIFEST,
    snapshot: null,
    output: DEFAULT_OUTPUT,
    record: null,
  }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--manifest') result.manifest = argv[++index]
    else if (argv[index] === '--snapshot') result.snapshot = argv[++index]
    else if (argv[index] === '--output') result.output = argv[++index]
    else if (argv[index] === '--assert-hosted') {
      result.mode = 'assert-hosted'
      result.record = argv[++index]
    } else if (argv[index] === '--assert-uat') {
      result.mode = 'assert-uat'
      result.record = argv[++index]
    }
    else throw new Error(`unknown argument: ${argv[index]}`)
  }
  return result
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const manifestBytes = await readFile(resolve(args.manifest))
  const manifest = JSON.parse(manifestBytes)
  await validateManifest(manifest, manifestBytes)
  if (args.mode === 'assert-hosted') {
    const record = JSON.parse(await readFile(resolve(args.record), 'utf8'))
    const result = assertHostedRecord(manifest, record)
    process.stdout.write(`${JSON.stringify({
      status: result.status,
      release_manifest_id: result.release_manifest_id,
    }, null, 2)}\n`)
    return
  }
  if (args.mode === 'assert-uat') {
    const record = JSON.parse(await readFile(resolve(args.record), 'utf8'))
    const result = assertUatRecord(manifest, record)
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    if (result.status !== 'PASS') process.exitCode = 2
    return
  }
  const snapshot = args.snapshot
    ? JSON.parse(await readFile(resolve(args.snapshot), 'utf8'))
    : {}
  const result = evaluateHostedSnapshot(manifest, snapshot)
  await writeFile(resolve(args.output), `${JSON.stringify(result, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}

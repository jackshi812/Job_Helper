#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_MANIFEST,
  validateManifest,
} from './run-phase-03-10-rollout.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_OUTPUT =
  '.planning/phases/03.10-goldman-sachs-selective-higher-monitoring/03.10-01-HOSTED-VERIFICATION.json'
const SOURCE_KEY = 'goldman_higher:roles'
const PUBLIC_URL = 'https://higher.gs.com/results'
const HASH = /^[a-f0-9]{64}$/
const SOURCE_COMMIT = /^[a-f0-9]{40}$/
const RECENT_HOURS = 168
const FUNCTION_SLUGS = Object.freeze([
  'verify-board',
  'observe-connectors',
  'poll-tick',
])
const CATEGORY_TERMS = new Set([
  'Data',
  'Technology',
  'Finance',
  'Investment',
  'Research',
  'Risk',
  'Capital Markets',
])
const RECRUITING_TYPES = new Set([
  'GS_EARLY_CAREER',
  'GS_MID_CAREER',
])
const CLEANUP_EXITS = Object.freeze([
  'success',
  'unsupported',
  'error',
  'timeout',
  'assertion_failure',
  'artifact_write_failure',
])
const REDACTION_SURFACES = Object.freeze([
  'errors',
  'logs',
  'json',
  'markdown',
  'nested_causes',
])
const UNSUPPORTED_REASONS = new Set([
  'navigation_identity_unverified',
  'higher_contract_unverified',
  'posting_date_ineligible',
  'population_evidence_missing',
  'category_evidence_missing',
  'country_evidence_missing',
  'application_evidence_missing',
  'pagination_incomplete',
  'count_mismatch',
  'detail_scope_incomplete',
  'job_cap_exceeded',
  'provider_timeout',
  'positive_job_count_missing',
])

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

function exactApplyUrl(value, sourceId) {
  if (
    typeof value !== 'string'
    || typeof sourceId !== 'string'
    || !/^[0-9]{1,256}$/.test(sourceId)
  ) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && url.hostname === 'hdpc.fa.us2.oraclecloud.com'
      && !url.username
      && !url.password
      && !url.port
      && !url.search
      && !url.hash
      && url.pathname ===
        `/hcmUI/CandidateExperience/en/sites/LateralHiring/job/${sourceId}/apply/email`
  } catch {
    return false
  }
}

function qualifyingJob(job) {
  const observedAt = Date.parse(String(job?.observed_at ?? ''))
  const postedAt = Date.parse(String(job?.posted_at ?? ''))
  return job?.source === 'goldman_higher'
    && job.source_key === SOURCE_KEY
    && typeof job.external_id === 'string'
    && job.external_id.length > 0
    && Number.isFinite(observedAt)
    && Number.isFinite(postedAt)
    && postedAt >= observedAt - RECENT_HOURS * 60 * 60 * 1_000
    && postedAt <= observedAt
    && job.country_code === 'US'
    && ['jobFunction', 'division'].includes(job.category_field)
    && typeof job.category_label === 'string'
    && job.category_label.length > 0
    && CATEGORY_TERMS.has(job.matched_term)
    && RECRUITING_TYPES.has(job.recruiting_type)
    && typeof job.description_text === 'string'
    && job.description_text.trim().length > 0
    && job.snapshot_partial === false
    && exactApplyUrl(job.absolute_url, job.provider_source_id)
    && job.apply_reachable === true
    && job.scope_evidence_matches === true
}

function exactRelease(manifest, snapshot) {
  return snapshot.release?.release_manifest_id === manifest.release_manifest_id
    && HASH.test(snapshot.release?.manifest_file_sha256 ?? '')
    && snapshot.release?.source_commit === manifest.source_commit
    && SOURCE_COMMIT.test(snapshot.release?.source_commit ?? '')
    && snapshot.release?.web_commit_sha === manifest.web_deployment?.commit_sha
    && snapshot.release?.web_asset_sha256
      === manifest.web_deployment?.asset_sha256
}

function exactMigration(manifest, snapshot) {
  return snapshot.migration?.version === '0048'
    && snapshot.migration?.path === manifest.migration?.path
    && snapshot.migration?.sha256 === manifest.migration?.sha256
    && snapshot.migration?.status === 'APPLIED'
    && snapshot.migration?.history_exact === true
}

function exactFunctions(manifest, snapshot) {
  return FUNCTION_SLUGS.every((slug) => {
    const expected = manifest.functions?.[slug]
    const actual = snapshot.functions?.[slug]
    return actual?.status === 'ACTIVE'
      && actual.version === expected?.version
      && actual.verify_jwt === expected?.verify_jwt
      && actual.entry_sha256 === expected?.entry_sha256
      && actual.bundle_sha256 === expected?.bundle_sha256
  })
}

function preciseUnsupported(snapshot) {
  return snapshot.terminal?.outcome === 'unsupported'
    && UNSUPPORTED_REASONS.has(snapshot.terminal?.reason)
    && snapshot.terminal?.operational_authority === false
    && snapshot.catalog?.company_name === 'Goldman Sachs'
    && snapshot.catalog?.provider === 'Goldman Higher'
    && snapshot.catalog?.careers_url === PUBLIC_URL
    && snapshot.catalog?.disposition === 'unsupported_with_reason'
    && snapshot.catalog?.source_key == null
    && snapshot.company == null
}

function exactIdentity(snapshot, unsupported) {
  if (unsupported) return preciseUnsupported(snapshot)
  return snapshot.catalog?.company_name === 'Goldman Sachs'
    && snapshot.catalog?.provider === 'Goldman Higher'
    && snapshot.catalog?.careers_url === PUBLIC_URL
    && snapshot.catalog?.source_key === SOURCE_KEY
    && snapshot.company?.name === 'Goldman Sachs'
    && snapshot.company?.ats_type === 'goldman_higher'
    && snapshot.company?.board_token === SOURCE_KEY
    && snapshot.company?.region === null
    && snapshot.company?.site_token === null
    && snapshot.company?.careers_url === PUBLIC_URL
    && snapshot.company?.source_key === SOURCE_KEY
}

function activationWindows(snapshot) {
  const rows = snapshot.activation?.observations
  if (!Array.isArray(rows) || rows.length !== 3) return false
  const windows = rows.map((row) => row?.window)
  return windows.every((value) => Number.isFinite(Date.parse(String(value))))
    && new Set(windows).size === 3
    && rows.every((row) =>
      Number.isFinite(Date.parse(String(row?.observed_at)))
    )
    && snapshot.company?.activation_state === 'active'
    && snapshot.company?.activation_successes === 3
}

function cleanupEveryExit(snapshot) {
  return CLEANUP_EXITS.every((name) => snapshot.cleanup?.exits?.[name] === true)
}

function secretRedaction(snapshot) {
  return REDACTION_SURFACES.every(
    (name) => snapshot.redaction?.[name] === true,
  ) && Number(snapshot.redaction?.credential_leak_count) === 0
}

function checkRecords(checks) {
  return Object.fromEntries(
    Object.entries(checks).map(([name, passed]) => [
      name,
      { status: passed ? 'PASS' : 'PENDING' },
    ]),
  )
}

export function evaluateHostedSnapshot(manifest, snapshot) {
  const unsupported = preciseUnsupported(snapshot)
  const activeTerminal = snapshot.terminal?.outcome === 'admit_experimental'
    && snapshot.terminal?.reason == null
    && snapshot.terminal?.operational_authority === true
  const jobs = Array.isArray(snapshot.qualifying_jobs)
    ? snapshot.qualifying_jobs
    : []
  const checks = {
    exact_release: exactRelease(manifest, snapshot),
    migration_0048: exactMigration(manifest, snapshot),
    function_parity: exactFunctions(manifest, snapshot),
    exact_identity: exactIdentity(snapshot, unsupported),
    service_role_acl: snapshot.acl?.service_role_execute === true
      && snapshot.acl?.public_execute === false
      && snapshot.acl?.anon_execute === false
      && snapshot.acl?.authenticated_execute === false,
    activation_windows: activationWindows(snapshot),
    replay_same_window: snapshot.activation?.replay_rejected === true
      && snapshot.activation?.same_window_rejected === true,
    no_fourth_invocation:
      Number(snapshot.activation?.fourth_invocation_count) === 0,
    natural_poll: snapshot.natural_poll?.scheduler_owned === true
      && snapshot.natural_poll?.observed_after_activation === true
      && snapshot.natural_poll?.release_identity_matches === true
      && snapshot.natural_poll?.healthy === true
      && snapshot.company?.last_polled_at != null
      && snapshot.company?.last_success_at != null
      && snapshot.company?.last_error_code == null,
    qualifying_job: Number(snapshot.eligible_job_count) > 0
      && jobs.length > 0
      && jobs.every(qualifyingJob),
    closure_disabled: snapshot.closure?.allow_missing_closure === false
      && Number(snapshot.closure?.absence_closed_count) === 0,
    feed_aging: snapshot.feed_aging?.active_visible === false
      && snapshot.feed_aging?.provider_status === 'open'
      && snapshot.feed_aging?.closed_at === null
      && snapshot.feed_aging?.applied_visible === true
      && snapshot.feed_aging?.dismissed_visible === true,
    protected_sources:
      snapshot.isolation?.protected_sources_unchanged === true
      && snapshot.isolation?.protected_provider_lifecycle_unchanged === true,
    user_data: snapshot.isolation?.user_data_unchanged === true,
    cleanup_every_exit: cleanupEveryExit(snapshot),
    zero_residue: Number(snapshot.cleanup?.verifier_residue_count) === 0,
    secret_redaction: secretRedaction(snapshot),
    unsupported_no_authority: unsupported
      ? snapshot.terminal?.operational_authority === false
        && snapshot.company == null
        && Number(snapshot.eligible_job_count) === 0
      : true,
    monitored_source: activeTerminal
      && snapshot.company?.activation_state === 'active'
      && Number(snapshot.eligible_job_count) > 0,
  }
  const activePass = activeTerminal && Object.values(checks).every(Boolean)
  const unsupportedRequired = [
    'exact_release',
    'migration_0048',
    'function_parity',
    'exact_identity',
    'service_role_acl',
    'replay_same_window',
    'no_fourth_invocation',
    'protected_sources',
    'user_data',
    'cleanup_every_exit',
    'zero_residue',
    'secret_redaction',
    'unsupported_no_authority',
  ]
  const unsupportedPass = unsupported
    && unsupportedRequired.every((name) => checks[name] === true)
  return {
    schema_version: 1,
    phase: '03.10',
    release_manifest_id: manifest.release_manifest_id,
    status: activePass ? 'PASS' : unsupportedPass ? 'UNSUPPORTED' : 'PENDING',
    terminal_kind: activePass
      ? 'ACTIVE'
      : unsupportedPass
        ? 'UNSUPPORTED'
        : 'PENDING',
    checks: checkRecords(checks),
    evidence: {
      source_key: manifest.source_key,
      careers_url: manifest.public_url,
      terminal: snapshot.terminal ?? null,
      release: snapshot.release ?? null,
      migration: snapshot.migration ?? null,
      functions: snapshot.functions ?? null,
      sample_job: jobs[0] ?? null,
    },
  }
}

const UNSUPPORTED_REQUIRED_CHECKS = Object.freeze([
  'exact_release',
  'migration_0048',
  'function_parity',
  'exact_identity',
  'service_role_acl',
  'replay_same_window',
  'no_fourth_invocation',
  'protected_sources',
  'user_data',
  'cleanup_every_exit',
  'zero_residue',
  'secret_redaction',
  'unsupported_no_authority',
])

export function assertHostedRecord(manifest, record) {
  try {
    requireCondition(
      record.schema_version === 1 && record.phase === '03.10',
      'version/phase drift',
    )
    requireCondition(
      record.release_manifest_id === manifest.release_manifest_id,
      'release drift',
    )
    requireCondition(
      record.evidence?.source_key === manifest.source_key
        && record.evidence?.careers_url === manifest.public_url,
      'source identity drift',
    )
    if (record.status === 'PASS') {
      requireCondition(record.terminal_kind === 'ACTIVE', 'terminal is not Active')
      requireCondition(
        Object.keys(record.checks ?? {}).length > 0
          && Object.values(record.checks).every(
            (check) => check.status === 'PASS',
          ),
        'contains a non-PASS check',
      )
    } else if (record.status === 'UNSUPPORTED') {
      requireCondition(
        record.terminal_kind === 'UNSUPPORTED'
          && record.evidence?.terminal?.outcome === 'unsupported'
          && UNSUPPORTED_REASONS.has(record.evidence?.terminal?.reason)
          && record.evidence?.terminal?.operational_authority === false,
        'Unsupported terminal is not precise',
      )
      requireCondition(
        UNSUPPORTED_REQUIRED_CHECKS.every(
          (name) => record.checks?.[name]?.status === 'PASS',
        ),
        'Unsupported safety check is not PASS',
      )
    } else {
      throw new Error('status is neither PASS nor precise Unsupported')
    }
    return record
  } catch (error) {
    throw new Error(
      `hosted verification rejected: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

export function assertRolloutRecord(manifest, record) {
  try {
    requireCondition(
      record.schema_version === 1 && record.phase === '03.10',
      'version/phase drift',
    )
    requireCondition(
      record.release_manifest_id === manifest.release_manifest_id
        && record.source_key === manifest.source_key,
      'release/source drift',
    )
    requireCondition(
      record.release?.source_commit === manifest.source_commit
        && record.release?.web_commit_sha === manifest.web_deployment?.commit_sha
        && record.release?.web_asset_sha256
          === manifest.web_deployment?.asset_sha256
        && HASH.test(record.release?.manifest_file_sha256 ?? ''),
      'release parity failed',
    )
    requireCondition(
      record.protected_sources_unchanged === true
        && record.cleanup?.every_exit === true
        && Number(record.cleanup?.verifier_residue_count) === 0
        && Number(record.redaction?.credential_leak_count) === 0,
      'isolation, cleanup, or redaction failed',
    )
    if (record.status === 'PASS') {
      requireCondition(
        record.terminal?.outcome === 'admit_experimental'
          && record.terminal?.operational_authority === true,
        'Active terminal failed',
      )
    } else if (record.status === 'UNSUPPORTED') {
      requireCondition(
        record.terminal?.outcome === 'unsupported'
          && UNSUPPORTED_REASONS.has(record.terminal?.reason)
          && record.terminal?.operational_authority === false,
        'Unsupported terminal failed',
      )
    } else {
      throw new Error('status is neither PASS nor precise Unsupported')
    }
    return record
  } catch (error) {
    throw new Error(
      `rollout verification rejected: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

export function uatApprovalPayload(manifest, record) {
  return {
    schema_version: record.schema_version,
    phase: record.phase,
    release_manifest_id: record.release_manifest_id,
    manifest_file_sha256: record.manifest_file_sha256,
    hosted_verification_sha256: record.hosted_verification_sha256,
    rollout_verification_sha256: record.rollout_verification_sha256,
    source_key: record.source_key,
    migration: record.migration,
    functions: record.functions,
    web: record.web,
    observed: record.observed,
    expected_watchlist: record.expected_watchlist,
    expected_job: record.expected_job,
    cleanup: record.cleanup,
    owner_browser_required: record.owner_browser_required,
    codex_browser_used: record.codex_browser_used,
    manifest_source_commit: manifest.source_commit,
  }
}

export function exactUatApproval(manifest, record) {
  return [
    'approve Phase 03.10 Goldman Sachs owner-browser UAT',
    manifest.release_manifest_id,
    sha256(canonical(uatApprovalPayload(manifest, record))),
  ].join(' ')
}

function exactUatRuntime(manifest, record) {
  return record.migration?.version === '0048'
    && record.migration?.sha256 === manifest.migration?.sha256
    && FUNCTION_SLUGS.every((slug) =>
      record.functions?.[slug]?.version === manifest.functions?.[slug]?.version
      && record.functions?.[slug]?.bundle_sha256
        === manifest.functions?.[slug]?.bundle_sha256
    )
    && record.web?.commit_sha === manifest.web_deployment?.commit_sha
    && record.web?.asset_sha256 === manifest.web_deployment?.asset_sha256
}

export function assertUatRecord(manifest, record) {
  requireCondition(
    record.schema_version === 1 && record.phase === '03.10',
    'UAT version/phase drift',
  )
  requireCondition(
    record.release_manifest_id === manifest.release_manifest_id
      && record.source_key === manifest.source_key,
    'UAT release/source drift',
  )
  requireCondition(
    HASH.test(record.manifest_file_sha256 ?? '')
      && HASH.test(record.hosted_verification_sha256 ?? '')
      && HASH.test(record.rollout_verification_sha256 ?? ''),
    'UAT evidence hash missing',
  )
  requireCondition(exactUatRuntime(manifest, record), 'UAT runtime identity drift')
  requireCondition(
    record.observed?.activation_state === 'active'
      && record.observed?.activation_successes === 3
      && Number.isFinite(
        Date.parse(String(record.observed?.natural_poll_at ?? '')),
      ),
    'UAT activation/natural-poll evidence drift',
  )
  requireCondition(
    record.expected_watchlist?.company_name === 'Goldman Sachs'
      && record.expected_watchlist?.careers_url === manifest.public_url
      && record.expected_watchlist?.activation_state === 'active'
      && record.expected_watchlist?.activation_successes === 3,
    'UAT Watchlist expectation drift',
  )
  requireCondition(
    qualifyingJob(record.expected_job),
    'UAT qualifying-job expectation drift',
  )
  requireCondition(
    record.cleanup?.every_exit === true
      && Number(record.cleanup?.verifier_residue_count) === 0,
    'UAT cleanup expectation drift',
  )
  requireCondition(
    record.owner_browser_required === true,
    'UAT must require the owner browser',
  )
  requireCondition(
    record.codex_browser_used === false,
    'Codex browser use is forbidden for this UAT',
  )
  const requiredApproval = exactUatApproval(manifest, record)
  requireCondition(
    record.required_approval === requiredApproval,
    'UAT approval payload drift',
  )
  if (record.status === 'PASS') {
    requireCondition(
      record.owner_attestation === requiredApproval,
      'UAT PASS requires the exact owner signal',
    )
  } else {
    requireCondition(
      record.status === 'PENDING_OWNER_BROWSER',
      'UAT has an invalid non-PASS state',
    )
    requireCondition(
      record.owner_attestation == null,
      'pending UAT cannot contain an owner attestation',
    )
  }
  return { status: record.status, required_approval: requiredApproval }
}

function parseArgs(argv) {
  const result = {
    mode: 'evaluate',
    manifest: DEFAULT_MANIFEST,
    snapshot: null,
    output: DEFAULT_OUTPUT,
    record: null,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--manifest') result.manifest = argv[++index]
    else if (argument === '--snapshot') result.snapshot = argv[++index]
    else if (argument === '--output') result.output = argv[++index]
    else if (argument === '--assert-hosted') {
      result.mode = 'assert-hosted'
      result.record = argv[++index]
    } else if (argument === '--assert-rollout') {
      result.mode = 'assert-rollout'
      result.record = argv[++index]
    } else if (argument === '--assert-uat') {
      result.mode = 'assert-uat'
      result.record = argv[++index]
    } else throw new Error(`unknown argument: ${argument}`)
  }
  requireCondition(result.manifest, '--manifest requires a path')
  if (result.mode === 'evaluate') {
    requireCondition(result.snapshot, '--snapshot requires a path')
    requireCondition(result.output, '--output requires a path')
  } else {
    requireCondition(result.record, `${result.mode} requires a record path`)
  }
  return result
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const manifestBytes = await readFile(resolve(ROOT, args.manifest))
  const manifest = JSON.parse(manifestBytes)
  await validateManifest(manifest, manifestBytes)
  if (args.mode === 'evaluate') {
    const snapshot = JSON.parse(await readFile(resolve(ROOT, args.snapshot), 'utf8'))
    const result = evaluateHostedSnapshot(manifest, snapshot)
    await writeFile(
      resolve(ROOT, args.output),
      `${JSON.stringify(result, null, 2)}\n`,
    )
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    if (result.status === 'PENDING') process.exitCode = 2
    return
  }
  const record = JSON.parse(await readFile(resolve(ROOT, args.record), 'utf8'))
  const result = args.mode === 'assert-hosted'
    ? assertHostedRecord(manifest, record)
    : args.mode === 'assert-rollout'
      ? assertRolloutRecord(manifest, record)
      : assertUatRecord(manifest, record)
  process.stdout.write(`${JSON.stringify({
    status: result.status,
    release_manifest_id: record.release_manifest_id,
  }, null, 2)}\n`)
  if (args.mode === 'assert-uat' && result.status !== 'PASS') {
    process.exitCode = 2
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  })
}

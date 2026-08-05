#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type JsonRecord = Record<string, unknown>

const PHASE = '06'
const HASH = /^[a-f0-9]{64}$/u
const COMMIT = /^[a-f0-9]{40}$/u
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u
const MIGRATIONS = new Map([
  [1, 'supabase/migrations/0069_phase_06_wave_1.sql'],
  [2, 'supabase/migrations/0070_phase_06_wave_2.sql'],
  [3, 'supabase/migrations/0071_phase_06_wave_3.sql'],
  [4, 'supabase/migrations/0072_phase_06_wave_4.sql'],
  [5, 'supabase/migrations/0073_phase_06_wave_5.sql'],
])
const MIXES = new Map([
  [1, [8, 2]],
  [2, [6, 4]],
  [3, [4, 6]],
  [4, [2, 8]],
  [5, [0, 10]],
])
const FUNCTION_SETTINGS = new Map([
  ['verify-board', true],
  ['observe-connectors', false],
  ['poll-tick', false],
])
const REQUIRED_EXCLUSIONS = new Set([
  'outreach',
  'provider_requests',
  'manual_worker_invocation',
  'schedule_mutation',
  'migration_retry',
  'rollback_cleanup',
])
const FAILURE_STAGES = new Set([
  'pre_schema',
  'schema',
  'functions',
  'rls',
  'web',
  'activation',
  'natural_poll',
  'isolation',
  'receipt',
])
const FAILURE_CODES = new Set([
  'precondition_drift',
  'schema_action_failed',
  'schema_action_ambiguous',
  'function_action_failed',
  'function_action_ambiguous',
  'rls_delete_denial_failed',
  'user_managed_delete_failed',
  'web_action_failed',
  'web_action_ambiguous',
  'activation_incomplete',
  'natural_claim_missing',
  'positive_job_missing',
  'source_degraded',
  'identity_drift',
  'isolation_failed',
  'receipt_invalid',
])
const CANDIDATE_EXCLUSION_CODES = new Set([
  'baseline_active',
  'prior_wave_collision',
  'self_service',
  'non_workday',
  'unsafe_contract',
  'html_only',
  'session_required',
  'waf_blocked',
  'identity_collision',
  'unbounded_contract',
  'redirecting_contract',
  'zero_postings',
  'duplicate_candidate',
])
const CONDITIONAL_TEXT = /(?:\bif\b|conditional|discover(?:ed|y)?|later|pending|tbd|todo|unknown|placeholder)/iu
const MAX_BASELINE_ROWS = 2_000
const MAX_RESERVES = 100
const MAX_EXCLUSIONS = 500
const MAX_ARTIFACT_FILES = 200
const MAX_JSON_BYTES = 5_000_000

export class GateError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'GateError'
    this.code = code
  }
}

function fail(code: string): never {
  throw new GateError(code)
}

function requireGate(condition: unknown, code: string): asserts condition {
  if (!condition) fail(code)
}

function record(value: unknown, code: string): JsonRecord {
  requireGate(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    code,
  )
  return value as JsonRecord
}

function exactKeys(
  value: JsonRecord,
  required: readonly string[],
  code: string,
): void {
  const actual = Object.keys(value).sort()
  const expected = [...required].sort()
  requireGate(canonicalJson(actual) === canonicalJson(expected), code)
}

function stringValue(
  value: unknown,
  code: string,
  maxLength = 512,
): string {
  requireGate(
    typeof value === 'string'
      && value.length > 0
      && value.length <= maxLength
      && value.trim() === value
      && !/[\u0000-\u001f\u007f]/u.test(value),
    code,
  )
  return value
}

function normalizedName(value: unknown, code: string): string {
  const result = stringValue(value, code, 200)
  requireGate(result === result.toLowerCase(), code)
  return result
}

function hashValue(value: unknown, code: string): string {
  const result = stringValue(value, code, 64)
  requireGate(HASH.test(result) && !/^([a-f0-9])\1{63}$/u.test(result), code)
  return result
}

function uuidValue(value: unknown, code: string): string {
  const result = stringValue(value, code, 36)
  requireGate(UUID.test(result), code)
  return result
}

function timestamp(value: unknown, code: string): string {
  const result = stringValue(value, code, 32)
  const milliseconds = Date.parse(result)
  requireGate(
    Number.isFinite(milliseconds)
      && new Date(milliseconds).toISOString() === result,
    code,
  )
  return result
}

function nullableTimestamp(value: unknown, code: string): string | null {
  return value === null ? null : timestamp(value, code)
}

function httpsUrl(value: unknown, code: string): string {
  const result = stringValue(value, code, 2_048)
  try {
    const url = new URL(result)
    requireGate(
      url.protocol === 'https:'
        && !url.username
        && !url.password
        && !url.port
        && !url.hash,
      code,
    )
  } catch {
    fail(code)
  }
  return result
}

function noDuplicates(values: readonly string[], code: string): void {
  requireGate(new Set(values).size === values.length, code)
}

function artifactPath(value: unknown, code: string): string {
  const path = stringValue(value, code, 512)
  requireGate(
    !path.startsWith('/')
      && !path.includes('\\')
      && !path.split('/').includes('..')
      && (path.startsWith('supabase/') || path.startsWith('web/'))
      && !CONDITIONAL_TEXT.test(path),
    code,
  )
  return path
}

function validateArtifactFile(value: unknown): JsonRecord {
  const file = record(value, 'manifest_artifact_file_invalid')
  exactKeys(
    file,
    ['path', 'sha256'],
    'manifest_artifact_file_fields_invalid',
  )
  artifactPath(file.path, 'manifest_artifact_path_invalid')
  hashValue(file.sha256, 'manifest_artifact_file_digest_invalid')
  return file
}

function validateArtifactFiles(value: unknown): JsonRecord[] {
  requireGate(
    Array.isArray(value)
      && value.length > 0
      && value.length <= MAX_ARTIFACT_FILES,
    'manifest_artifact_files_invalid',
  )
  const files = value.map(validateArtifactFile)
  const paths = files.map((entry) => String(entry.path))
  noDuplicates(paths, 'manifest_artifact_path_duplicate')
  requireGate(
    canonicalJson(paths)
      === canonicalJson([...paths].sort((left, right) => left.localeCompare(right))),
    'manifest_artifact_files_not_sorted',
  )
  return files
}

function sortedCopy<T>(values: readonly T[], compare: (a: T, b: T) => number): T[] {
  return [...values].sort(compare)
}

export function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`
  }
  if (typeof value === 'object') {
    const item = value as JsonRecord
    return `{${Object.keys(item).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(item[key])}`
    ).join(',')}}`
  }
  if (
    typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
  ) {
    return JSON.stringify(value)
  }
  fail('non_json_value')
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function digest(value: unknown): string {
  return sha256Hex(canonicalJson(value))
}

function withoutField(value: JsonRecord, field: string): JsonRecord {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== field),
  )
}

function validateSelfHash(
  value: JsonRecord,
  field: string,
  code: string,
): string {
  const actual = hashValue(value[field], code)
  requireGate(actual === digest(withoutField(value, field)), code)
  return actual
}

function validateBaselineRow(value: unknown): JsonRecord {
  const row = record(value, 'baseline_row_invalid')
  exactKeys(row, [
    'id',
    'normalized_name',
    'ats_type',
    'source_key',
    'activation_state',
    'last_success_at',
    'watchlist_self_service_admissible',
  ], 'baseline_row_fields_invalid')
  uuidValue(row.id, 'baseline_company_id_invalid')
  normalizedName(row.normalized_name, 'baseline_name_invalid')
  stringValue(row.ats_type, 'baseline_provider_invalid', 64)
  stringValue(row.source_key, 'baseline_source_key_invalid', 512)
  requireGate(row.activation_state === 'active', 'baseline_not_active')
  nullableTimestamp(row.last_success_at, 'baseline_last_success_invalid')
  requireGate(
    typeof row.watchlist_self_service_admissible === 'boolean',
    'baseline_self_service_classification_invalid',
  )
  return row
}

export function validateBaseline(value: unknown): JsonRecord {
  const baseline = record(value, 'baseline_invalid')
  exactKeys(baseline, [
    'schema_version',
    'phase',
    'status',
    'captured_at',
    'source_commit',
    'deployed_migration_head',
    'active_supported_companies',
    'active_supported_count',
    'normalized_identity_digest',
    'baseline_evidence_sha256',
  ], 'baseline_fields_invalid')
  requireGate(
    baseline.schema_version === 1
      && baseline.phase === PHASE
      && baseline.status === 'CAPTURED',
    'baseline_envelope_invalid',
  )
  timestamp(baseline.captured_at, 'baseline_capture_time_invalid')
  requireGate(
    typeof baseline.source_commit === 'string'
      && COMMIT.test(baseline.source_commit),
    'baseline_source_commit_invalid',
  )
  requireGate(
    typeof baseline.deployed_migration_head === 'string'
      && /^[0-9]{4}$/u.test(baseline.deployed_migration_head),
    'baseline_migration_head_invalid',
  )
  requireGate(
    Array.isArray(baseline.active_supported_companies)
      && baseline.active_supported_companies.length <= MAX_BASELINE_ROWS,
    'baseline_rows_invalid',
  )
  const rows = baseline.active_supported_companies.map(validateBaselineRow)
  const sorted = sortedCopy(rows, (left, right) =>
    String(left.ats_type).localeCompare(String(right.ats_type))
      || String(left.source_key).localeCompare(String(right.source_key))
      || String(left.id).localeCompare(String(right.id)))
  requireGate(canonicalJson(rows) === canonicalJson(sorted), 'baseline_not_sorted')
  noDuplicates(rows.map((row) => String(row.id)), 'baseline_duplicate_id')
  noDuplicates(
    rows.map((row) => String(row.source_key)),
    'baseline_duplicate_source',
  )
  noDuplicates(
    rows.map((row) => String(row.normalized_name)),
    'baseline_duplicate_name',
  )
  requireGate(
    baseline.active_supported_count === rows.length,
    'baseline_count_invalid',
  )
  requireGate(
    hashValue(
      baseline.normalized_identity_digest,
      'baseline_identity_digest_invalid',
    ) === digest(rows),
    'baseline_identity_digest_invalid',
  )
  validateSelfHash(
    baseline,
    'baseline_evidence_sha256',
    'baseline_evidence_digest_invalid',
  )
  return baseline
}

function validateImplementation(
  value: unknown,
  wave: number,
): JsonRecord {
  const implementation = record(value, 'candidate_implementation_invalid')
  exactKeys(implementation, [
    'identity_module',
    'identity_exports',
    'adapter_module',
    'adapter_exports',
    'registry_module',
    'registry_symbol',
    'observation_module',
    'observation_branch',
    'migration_path',
    'test_paths',
  ], 'candidate_implementation_fields_invalid')
  requireGate(
    implementation.identity_module
      === 'supabase/functions/_shared/workday-identities.ts'
      && canonicalJson(implementation.identity_exports)
        === canonicalJson(['WORKDAY_IDENTITIES', 'resolveWorkdayIdentity'])
      && implementation.adapter_module
        === 'supabase/functions/_shared/adapters/workday.ts'
      && canonicalJson(implementation.adapter_exports)
        === canonicalJson(['pollWorkdayRecent', 'verifyWorkdayListing'])
      && implementation.registry_module
        === 'supabase/functions/_shared/connectors.ts'
      && implementation.registry_symbol === 'providerRegistry.workday'
      && implementation.observation_module
        === 'supabase/functions/observe-connectors/index.ts'
      && implementation.observation_branch === 'workday'
      && implementation.migration_path === MIGRATIONS.get(wave)
      && canonicalJson(implementation.test_paths) === canonicalJson([
        'web/tests/phase-06-workday-identities.test.ts',
        'web/tests/phase-06-wave-migrations.test.ts',
      ]),
    'candidate_implementation_contract_invalid',
  )
  for (const entry of Object.values(implementation).flat(2)) {
    if (typeof entry === 'string') {
      requireGate(!CONDITIONAL_TEXT.test(entry), 'candidate_conditional_value')
    }
  }
  return implementation
}

function validateTarget(value: unknown, wave: number): JsonRecord {
  const target = record(value, 'candidate_target_invalid')
  exactKeys(target, [
    'normalized_name',
    'portfolio_class',
    'official_careers_url',
    'provider',
    'provider_id',
    'mode',
    'source_key',
    'tenant',
    'region',
    'site',
    'host_form',
    'baseline_absent',
    'prior_waves_absent',
    'self_service_excluded',
    'positive_posting_proven',
    'anonymous_https_contract',
    'implementation',
    'identity_evidence_sha256',
  ], 'candidate_target_fields_invalid')
  normalizedName(target.normalized_name, 'candidate_name_invalid')
  requireGate(
    target.portfolio_class === 'finance'
      || target.portfolio_class === 'tech_data',
    'candidate_portfolio_class_invalid',
  )
  httpsUrl(target.official_careers_url, 'candidate_careers_url_invalid')
  requireGate(
    target.provider === 'workday'
      && target.provider_id === 'workday'
      && target.mode === 'reuse',
    'candidate_not_workday_reuse',
  )
  for (const field of ['source_key', 'tenant', 'region', 'site', 'host_form']) {
    const item = stringValue(target[field], `candidate_${field}_invalid`, 512)
    requireGate(!CONDITIONAL_TEXT.test(item), 'candidate_conditional_value')
  }
  requireGate(
    String(target.source_key).startsWith('workday:'),
    'candidate_source_key_invalid',
  )
  requireGate(
    target.baseline_absent === true
      && target.prior_waves_absent === true
      && target.self_service_excluded === true
      && target.positive_posting_proven === true
      && target.anonymous_https_contract === true,
    'candidate_eligibility_invalid',
  )
  validateImplementation(target.implementation, wave)
  hashValue(target.identity_evidence_sha256, 'candidate_identity_digest_invalid')
  return target
}

function validateExclusion(value: unknown): JsonRecord {
  const exclusion = record(value, 'candidate_exclusion_invalid')
  exactKeys(exclusion, [
    'normalized_name',
    'portfolio_class',
    'code',
  ], 'candidate_exclusion_fields_invalid')
  normalizedName(exclusion.normalized_name, 'candidate_exclusion_name_invalid')
  requireGate(
    exclusion.portfolio_class === 'finance'
      || exclusion.portfolio_class === 'tech_data',
    'candidate_exclusion_class_invalid',
  )
  requireGate(
    typeof exclusion.code === 'string'
      && CANDIDATE_EXCLUSION_CODES.has(exclusion.code),
    'candidate_exclusion_code_invalid',
  )
  return exclusion
}

function validatePriorReceiptReference(
  wave: number,
  baselineDigest: string,
  priorReceipt: unknown,
): JsonRecord | null {
  if (wave === 1) {
    requireGate(priorReceipt === null, 'unexpected_prior_receipt')
    return null
  }
  const prior = record(priorReceipt, 'prior_receipt_missing')
  requireGate(
    prior.schema_version === 1
      && prior.phase === PHASE
      && prior.wave === wave - 1
      && prior.status === 'PASS'
      && prior.baseline_evidence_sha256 === baselineDigest,
    'prior_receipt_not_canonical_pass',
  )
  validateSelfHash(prior, 'wave_evidence_sha256', 'prior_receipt_digest_invalid')
  requireGate(
    Array.isArray(prior.companies) && prior.companies.length === 10,
    'prior_receipt_companies_invalid',
  )
  requireGate(
    Array.isArray(prior.cumulative_identities)
      && prior.cumulative_identities.length === (wave - 1) * 10,
    'prior_receipt_cumulative_identities_invalid',
  )
  prior.cumulative_identities.map(validateCumulativeIdentity)
  return prior
}

export function validateCandidateSet({
  wave,
  baseline: baselineValue,
  candidates: candidateValue,
  priorReceipt: priorValue = null,
}: {
  wave: number
  baseline: unknown
  candidates: unknown
  priorReceipt?: unknown
}): JsonRecord {
  requireGate(MIXES.has(wave), 'wave_invalid')
  const baseline = validateBaseline(baselineValue)
  const candidates = record(candidateValue, 'candidates_invalid')
  exactKeys(candidates, [
    'schema_version',
    'phase',
    'wave',
    'status',
    'baseline_evidence_sha256',
    'prior_wave_receipt_sha256',
    'implementation_targets',
    'reserves',
    'exclusions',
    'candidate_evidence_sha256',
  ], 'candidate_fields_invalid')
  requireGate(
    candidates.schema_version === 1
      && candidates.phase === PHASE
      && candidates.wave === wave
      && candidates.status === 'SEALED'
      && candidates.baseline_evidence_sha256
        === baseline.baseline_evidence_sha256,
    'candidate_envelope_invalid',
  )
  const prior = validatePriorReceiptReference(
    wave,
    String(baseline.baseline_evidence_sha256),
    priorValue,
  )
  requireGate(
    candidates.prior_wave_receipt_sha256
      === (prior?.wave_evidence_sha256 ?? null),
    'candidate_prior_digest_invalid',
  )
  requireGate(
    Array.isArray(candidates.implementation_targets)
      && candidates.implementation_targets.length === 10,
    'candidate_count_invalid',
  )
  requireGate(
    Array.isArray(candidates.reserves)
      && candidates.reserves.length > 0
      && candidates.reserves.length <= MAX_RESERVES,
    'candidate_reserves_invalid',
  )
  requireGate(
    Array.isArray(candidates.exclusions)
      && candidates.exclusions.length > 0
      && candidates.exclusions.length <= MAX_EXCLUSIONS,
    'candidate_exclusions_invalid',
  )
  const targets = candidates.implementation_targets.map((entry) =>
    validateTarget(entry, wave))
  const reserves = candidates.reserves.map((entry) =>
    validateTarget(entry, wave))
  candidates.exclusions.map(validateExclusion)
  const all = [...targets, ...reserves]
  noDuplicates(
    all.map((entry) => String(entry.normalized_name)),
    'candidate_duplicate_name',
  )
  noDuplicates(
    all.map((entry) => String(entry.source_key)),
    'candidate_duplicate_source',
  )
  const [finance, techData] = MIXES.get(wave)!
  requireGate(
    targets.filter((entry) => entry.portfolio_class === 'finance').length
      === finance
      && targets.filter((entry) => entry.portfolio_class === 'tech_data').length
        === techData,
    'candidate_wave_mix_invalid',
  )
  requireGate(
    (finance === 0 || reserves.some((entry) =>
      entry.portfolio_class === 'finance'))
      && (techData === 0 || reserves.some((entry) =>
        entry.portfolio_class === 'tech_data')),
    'candidate_reserve_mix_invalid',
  )
  const baselineRows = baseline.active_supported_companies as JsonRecord[]
  const baselineNames = new Set(
    baselineRows.map((entry) => String(entry.normalized_name)),
  )
  const baselineSources = new Set(
    baselineRows.map((entry) => String(entry.source_key)),
  )
  for (const entry of all) {
    requireGate(
      !baselineNames.has(String(entry.normalized_name))
        && !baselineSources.has(String(entry.source_key)),
      'candidate_baseline_collision',
    )
  }
  if (prior) {
    const priorCompanies = prior.cumulative_identities as JsonRecord[]
    const priorNames = new Set(
      priorCompanies.map((entry) => String(entry.normalized_name)),
    )
    const priorSources = new Set(
      priorCompanies.map((entry) => String(entry.source_key)),
    )
    for (const entry of all) {
      requireGate(
        !priorNames.has(String(entry.normalized_name))
          && !priorSources.has(String(entry.source_key)),
        'candidate_prior_collision',
      )
    }
  }
  validateSelfHash(
    candidates,
    'candidate_evidence_sha256',
    'candidate_evidence_digest_invalid',
  )
  return candidates
}

function validateFunctionArtifact(value: unknown): JsonRecord {
  const item = record(value, 'manifest_function_invalid')
  exactKeys(item, [
    'slug',
    'bundle_files',
    'bundle_sha256',
    'verify_jwt',
    'expected_deployment_identity',
  ], 'manifest_function_fields_invalid')
  const slug = stringValue(item.slug, 'manifest_function_slug_invalid', 64)
  requireGate(FUNCTION_SETTINGS.has(slug), 'manifest_function_slug_invalid')
  const bundleFiles = validateArtifactFiles(item.bundle_files)
  requireGate(
    hashValue(item.bundle_sha256, 'manifest_function_digest_invalid')
      === digest(bundleFiles),
    'manifest_function_digest_invalid',
  )
  requireGate(
    item.verify_jwt === FUNCTION_SETTINGS.get(slug),
    'manifest_function_jwt_invalid',
  )
  stringValue(
    item.expected_deployment_identity,
    'manifest_function_identity_invalid',
    256,
  )
  return item
}

function validateAction(value: unknown): JsonRecord {
  const item = record(value, 'manifest_action_invalid')
  exactKeys(item, [
    'id',
    'command',
    'max_attempts',
    'expected_identity',
  ], 'manifest_action_fields_invalid')
  stringValue(item.id, 'manifest_action_id_invalid', 64)
  const command = stringValue(item.command, 'manifest_action_command_invalid', 512)
  requireGate(!/[\r\n;&|`$]/u.test(command), 'manifest_action_command_invalid')
  requireGate(item.max_attempts === 1, 'manifest_action_attempts_invalid')
  stringValue(item.expected_identity, 'manifest_action_identity_invalid', 256)
  return item
}

function expectedActions(wave: number): string[] {
  return [
    'schema_push',
    'deploy_verify_board',
    'deploy_observe_connectors',
    'deploy_poll_tick',
    ...(wave === 1 ? ['deploy_web'] : []),
  ]
}

export function exactReleaseApproval(manifestValue: unknown): string {
  const manifest = record(manifestValue, 'manifest_invalid')
  requireGate(
    Number.isInteger(manifest.wave) && MIXES.has(Number(manifest.wave)),
    'manifest_wave_invalid',
  )
  const manifestDigest = hashValue(
    manifest.release_manifest_sha256,
    'manifest_digest_invalid',
  )
  return `APPROVE PHASE 06 WAVE ${manifest.wave} RELEASE ${manifestDigest}`
}

export function validateReleaseManifest({
  wave,
  baseline: baselineValue,
  candidates: candidateValue,
  manifest: manifestValue,
  priorReceipt: priorValue = null,
}: {
  wave: number
  baseline: unknown
  candidates: unknown
  manifest: unknown
  priorReceipt?: unknown
}): { manifest: JsonRecord; approval: string } {
  const baseline = validateBaseline(baselineValue)
  const candidates = validateCandidateSet({
    wave,
    baseline,
    candidates: candidateValue,
    priorReceipt: priorValue,
  })
  const prior = wave === 1 ? null : record(priorValue, 'prior_receipt_missing')
  const manifest = record(manifestValue, 'manifest_invalid')
  exactKeys(manifest, [
    'schema_version',
    'phase',
    'wave',
    'status',
    'release_manifest_id',
    'source_commit',
    'baseline_evidence_sha256',
    'candidate_evidence_sha256',
    'prior_wave_receipt_sha256',
    'artifacts',
    'exclusions',
    'remote_preconditions',
    'actions',
    'release_manifest_sha256',
  ], 'manifest_fields_invalid')
  requireGate(
    manifest.schema_version === 1
      && manifest.phase === PHASE
      && manifest.wave === wave
      && manifest.status === 'SEALED'
      && manifest.baseline_evidence_sha256
        === baseline.baseline_evidence_sha256
      && manifest.candidate_evidence_sha256
        === candidates.candidate_evidence_sha256
      && manifest.prior_wave_receipt_sha256
        === (prior?.wave_evidence_sha256 ?? null),
    'manifest_envelope_invalid',
  )
  uuidValue(manifest.release_manifest_id, 'manifest_id_invalid')
  requireGate(
    typeof manifest.source_commit === 'string'
      && COMMIT.test(manifest.source_commit),
    'manifest_source_commit_invalid',
  )
  const artifacts = record(manifest.artifacts, 'manifest_artifacts_invalid')
  exactKeys(
    artifacts,
    ['migration', 'functions', 'web'],
    'manifest_artifact_fields_invalid',
  )
  const migration = record(artifacts.migration, 'manifest_migration_invalid')
  exactKeys(
    migration,
    ['path', 'sha256'],
    'manifest_migration_fields_invalid',
  )
  requireGate(
    migration.path === MIGRATIONS.get(wave),
    'manifest_migration_path_invalid',
  )
  hashValue(migration.sha256, 'manifest_migration_digest_invalid')
  requireGate(
    Array.isArray(artifacts.functions) && artifacts.functions.length === 3,
    'manifest_functions_invalid',
  )
  const functions = artifacts.functions.map(validateFunctionArtifact)
  requireGate(
    canonicalJson(functions.map((entry) => entry.slug))
      === canonicalJson([...FUNCTION_SETTINGS.keys()]),
    'manifest_function_inventory_invalid',
  )
  if (wave === 1) {
    const web = record(artifacts.web, 'manifest_web_missing')
    exactKeys(web, [
      'source_files',
      'source_sha256',
      'build_path',
      'build_sha256',
      'expected_deployment_identity',
    ], 'manifest_web_fields_invalid')
    const sourceFiles = validateArtifactFiles(web.source_files)
    requireGate(
      hashValue(web.source_sha256, 'manifest_web_source_digest_invalid')
        === digest(sourceFiles),
      'manifest_web_source_digest_invalid',
    )
    artifactPath(web.build_path, 'manifest_web_build_path_invalid')
    hashValue(web.build_sha256, 'manifest_web_build_digest_invalid')
    stringValue(
      web.expected_deployment_identity,
      'manifest_web_identity_invalid',
      256,
    )
  } else {
    requireGate(artifacts.web === null, 'manifest_unexpected_web_artifact')
  }
  requireGate(
    Array.isArray(manifest.exclusions)
      && manifest.exclusions.length === REQUIRED_EXCLUSIONS.size
      && canonicalJson(new Set(manifest.exclusions).size)
        === canonicalJson(REQUIRED_EXCLUSIONS.size)
      && manifest.exclusions.every((entry) =>
        typeof entry === 'string' && REQUIRED_EXCLUSIONS.has(entry)
      ),
    'manifest_exclusions_invalid',
  )
  const preconditions = record(
    manifest.remote_preconditions,
    'manifest_preconditions_invalid',
  )
  exactKeys(preconditions, [
    'project_ref',
    'deployed_migration_head',
    'source_commit',
  ], 'manifest_precondition_fields_invalid')
  requireGate(
    typeof preconditions.project_ref === 'string'
      && /^[a-z0-9]{20}$/u.test(preconditions.project_ref)
      && preconditions.deployed_migration_head
        === String(67 + wave).padStart(4, '0')
      && preconditions.source_commit === manifest.source_commit,
    'manifest_precondition_values_invalid',
  )
  requireGate(Array.isArray(manifest.actions), 'manifest_actions_invalid')
  const actions = manifest.actions.map(validateAction)
  requireGate(
    canonicalJson(actions.map((entry) => entry.id))
      === canonicalJson(expectedActions(wave)),
    'manifest_action_inventory_invalid',
  )
  const commands = new Map(actions.map((entry) => [entry.id, entry.command]))
  requireGate(
    String(commands.get('schema_push')).startsWith('supabase db push ')
      && commands.get('deploy_verify_board')
        === 'supabase functions deploy verify-board'
      && commands.get('deploy_observe_connectors')
        === 'supabase functions deploy observe-connectors --no-verify-jwt'
      && commands.get('deploy_poll_tick')
        === 'supabase functions deploy poll-tick --no-verify-jwt'
      && (wave !== 1 || commands.get('deploy_web') === 'git push origin HEAD:main'),
    'manifest_action_command_invalid',
  )
  for (const target of candidates.implementation_targets as JsonRecord[]) {
    const implementation = target.implementation as JsonRecord
    requireGate(
      implementation.migration_path === migration.path,
      'manifest_candidate_migration_mismatch',
    )
  }
  validateSelfHash(
    manifest,
    'release_manifest_sha256',
    'manifest_digest_invalid',
  )
  return { manifest, approval: exactReleaseApproval(manifest) }
}

function validateCompanyReceipt(value: unknown, wave: number): JsonRecord {
  const company = record(value, 'receipt_company_invalid')
  exactKeys(company, [
    'company_id',
    'normalized_name',
    'portfolio_class',
    'wave',
    'source_key',
    'provider',
    'official_careers_url',
    'baseline_absent',
    'self_service_excluded',
    'identity_evidence_sha256',
    'activation_state',
    'activation_successes',
    'activation_observation_ids',
    'scheduler_claimed_at',
    'last_success_at',
    'last_error_code',
    'persisted_job_id',
    'persisted_job_source',
    'persisted_job_external_id',
    'persisted_job_url',
    'persisted_job_observed_at',
    'system_managed',
    'company_evidence_sha256',
  ], 'receipt_company_fields_invalid')
  uuidValue(company.company_id, 'receipt_company_id_invalid')
  normalizedName(company.normalized_name, 'receipt_company_name_invalid')
  requireGate(
    company.portfolio_class === 'finance'
      || company.portfolio_class === 'tech_data',
    'receipt_company_class_invalid',
  )
  requireGate(company.wave === wave, 'receipt_company_wave_invalid')
  requireGate(
    company.provider === 'workday'
      && company.persisted_job_source === 'workday'
      && typeof company.source_key === 'string'
      && company.source_key.startsWith('workday:'),
    'receipt_company_source_invalid',
  )
  httpsUrl(company.official_careers_url, 'receipt_company_url_invalid')
  requireGate(
    company.baseline_absent === true
      && company.self_service_excluded === true,
    'receipt_company_exclusion_invalid',
  )
  hashValue(
    company.identity_evidence_sha256,
    'receipt_company_identity_digest_invalid',
  )
  requireGate(
    company.activation_state === 'active'
      && company.activation_successes === 3,
    'receipt_company_activation_invalid',
  )
  requireGate(
    Array.isArray(company.activation_observation_ids)
      && company.activation_observation_ids.length === 3,
    'receipt_company_observations_invalid',
  )
  const observations = company.activation_observation_ids.map((entry) =>
    uuidValue(entry, 'receipt_company_observation_id_invalid'))
  noDuplicates(observations, 'receipt_company_observation_duplicate')
  const claimedAt = timestamp(
    company.scheduler_claimed_at,
    'receipt_company_claim_invalid',
  )
  const successAt = timestamp(
    company.last_success_at,
    'receipt_company_success_invalid',
  )
  requireGate(
    Date.parse(successAt) >= Date.parse(claimedAt)
      && company.last_error_code === null,
    'receipt_company_health_invalid',
  )
  uuidValue(company.persisted_job_id, 'receipt_company_job_id_invalid')
  stringValue(
    company.persisted_job_external_id,
    'receipt_company_job_external_id_invalid',
    512,
  )
  httpsUrl(company.persisted_job_url, 'receipt_company_job_url_invalid')
  const observedAt = timestamp(
    company.persisted_job_observed_at,
    'receipt_company_job_time_invalid',
  )
  requireGate(
    Date.parse(observedAt) >= Date.parse(claimedAt),
    'receipt_company_job_time_invalid',
  )
  requireGate(company.system_managed === true, 'receipt_company_not_managed')
  validateSelfHash(
    company,
    'company_evidence_sha256',
    'receipt_company_digest_invalid',
  )
  return company
}

function cumulativeIdentity(company: JsonRecord): JsonRecord {
  return {
    company_id: company.company_id,
    normalized_name: company.normalized_name,
    provider: company.provider,
    source_key: company.source_key,
    portfolio_class: company.portfolio_class,
    company_evidence_sha256: company.company_evidence_sha256,
  }
}

function validateCumulativeIdentity(value: unknown): JsonRecord {
  const identity = record(value, 'receipt_cumulative_identity_invalid')
  exactKeys(identity, [
    'company_id',
    'normalized_name',
    'provider',
    'source_key',
    'portfolio_class',
    'company_evidence_sha256',
  ], 'receipt_cumulative_identity_fields_invalid')
  uuidValue(identity.company_id, 'receipt_cumulative_company_id_invalid')
  normalizedName(
    identity.normalized_name,
    'receipt_cumulative_name_invalid',
  )
  requireGate(
    identity.provider === 'workday'
      && typeof identity.source_key === 'string'
      && identity.source_key.startsWith('workday:'),
    'receipt_cumulative_source_invalid',
  )
  requireGate(
    identity.portfolio_class === 'finance'
      || identity.portfolio_class === 'tech_data',
    'receipt_cumulative_class_invalid',
  )
  hashValue(
    identity.company_evidence_sha256,
    'receipt_cumulative_digest_invalid',
  )
  return identity
}

function validateRemoteHeads(
  value: unknown,
  manifest: JsonRecord,
): JsonRecord {
  const heads = record(value, 'receipt_remote_heads_invalid')
  exactKeys(heads, [
    'deployed_migration_head',
    'function_deployments',
    'web_deployment',
  ], 'receipt_remote_head_fields_invalid')
  requireGate(
    typeof heads.deployed_migration_head === 'string'
      && /^[0-9]{4}$/u.test(heads.deployed_migration_head),
    'receipt_remote_migration_head_invalid',
  )
  const deployments = record(
    heads.function_deployments,
    'receipt_function_deployments_invalid',
  )
  const functions = (manifest.artifacts as JsonRecord).functions as JsonRecord[]
  const allowed = new Map(functions.map((entry) => [
    String(entry.slug),
    String(entry.expected_deployment_identity),
  ]))
  for (const [slug, identity] of Object.entries(deployments)) {
    requireGate(
      allowed.has(slug) && identity === allowed.get(slug),
      'receipt_function_deployment_invalid',
    )
  }
  requireGate(
    heads.web_deployment === null
      || heads.web_deployment
        === ((manifest.artifacts as JsonRecord).web as JsonRecord | null)
          ?.expected_deployment_identity,
    'receipt_web_deployment_invalid',
  )
  return heads
}

function validateActionHistory(
  attemptedValue: unknown,
  deployedValue: unknown,
  manifest: JsonRecord,
): { attempted: string[]; deployed: string[] } {
  requireGate(
    Array.isArray(attemptedValue) && Array.isArray(deployedValue),
    'receipt_action_history_invalid',
  )
  const allowed = (manifest.actions as JsonRecord[]).map((entry) =>
    String(entry.id))
  const attempted = attemptedValue.map((entry) =>
    stringValue(entry, 'receipt_attempted_action_invalid', 64))
  const deployed = deployedValue.map((entry) =>
    stringValue(entry, 'receipt_deployed_action_invalid', 64))
  noDuplicates(attempted, 'receipt_attempted_action_duplicate')
  noDuplicates(deployed, 'receipt_deployed_action_duplicate')
  requireGate(
    attempted.every((entry) => allowed.includes(entry))
      && deployed.every((entry) => attempted.includes(entry))
      && canonicalJson(attempted)
        === canonicalJson(allowed.filter((entry) => attempted.includes(entry)))
      && canonicalJson(deployed)
        === canonicalJson(allowed.filter((entry) => deployed.includes(entry))),
    'receipt_action_identity_invalid',
  )
  return { attempted, deployed }
}

function receiptBaseChecks(
  receipt: JsonRecord,
  wave: number,
  baseline: JsonRecord,
  candidates: JsonRecord,
  manifest: JsonRecord,
  prior: JsonRecord | null,
): void {
  requireGate(
    receipt.schema_version === 1
      && receipt.phase === PHASE
      && receipt.wave === wave
      && (receipt.status === 'PASS' || receipt.status === 'FAILED')
      && receipt.release_manifest_sha256
        === manifest.release_manifest_sha256
      && receipt.candidate_evidence_sha256
        === candidates.candidate_evidence_sha256
      && receipt.baseline_evidence_sha256
        === baseline.baseline_evidence_sha256
      && receipt.source_commit === manifest.source_commit
      && receipt.migration_file_sha256
        === (manifest.artifacts as JsonRecord & {
          migration: JsonRecord
        }).migration.sha256
      && receipt.prior_wave_receipt_sha256
        === (prior?.wave_evidence_sha256 ?? null),
    'receipt_release_binding_invalid',
  )
}

export function validateWaveReceipt({
  wave,
  baseline: baselineValue,
  candidates: candidateValue,
  manifest: manifestValue,
  receipt: receiptValue,
  priorReceipt: priorValue = null,
}: {
  wave: number
  baseline: unknown
  candidates: unknown
  manifest: unknown
  receipt: unknown
  priorReceipt?: unknown
}): JsonRecord {
  const baseline = validateBaseline(baselineValue)
  const candidates = validateCandidateSet({
    wave,
    baseline,
    candidates: candidateValue,
    priorReceipt: priorValue,
  })
  const manifest = validateReleaseManifest({
    wave,
    baseline,
    candidates,
    manifest: manifestValue,
    priorReceipt: priorValue,
  }).manifest
  const prior = wave === 1 ? null : record(priorValue, 'prior_receipt_missing')
  const receipt = record(receiptValue, 'receipt_invalid')
  receiptBaseChecks(receipt, wave, baseline, candidates, manifest, prior)
  if (receipt.status === 'PASS') {
    exactKeys(receipt, [
      'schema_version',
      'phase',
      'wave',
      'status',
      'release_manifest_sha256',
      'candidate_evidence_sha256',
      'baseline_evidence_sha256',
      'source_commit',
      'migration_file_sha256',
      'prior_wave_receipt_sha256',
      'companies',
      'cumulative_identities',
      'wave_finance_count',
      'wave_tech_data_count',
      'cumulative_finance_count',
      'cumulative_tech_data_count',
      'isolation_status',
      'watchlist_status',
      'authenticated_delete_status',
      'attempted_actions',
      'deployed_actions',
      'remote_heads',
      'completed_at',
      'wave_evidence_sha256',
    ], 'pass_receipt_fields_invalid')
    requireGate(
      Array.isArray(receipt.companies) && receipt.companies.length === 10,
      'pass_receipt_company_count_invalid',
    )
    const companies = receipt.companies.map((entry) =>
      validateCompanyReceipt(entry, wave))
    noDuplicates(
      companies.map((entry) => String(entry.company_id)),
      'pass_receipt_company_id_duplicate',
    )
    noDuplicates(
      companies.map((entry) => String(entry.normalized_name)),
      'pass_receipt_company_name_duplicate',
    )
    noDuplicates(
      companies.map((entry) => String(entry.source_key)),
      'pass_receipt_company_source_duplicate',
    )
    noDuplicates(
      companies.map((entry) => String(entry.company_evidence_sha256)),
      'pass_receipt_company_evidence_duplicate',
    )
    requireGate(
      Array.isArray(receipt.cumulative_identities)
        && receipt.cumulative_identities.length === wave * 10,
      'pass_receipt_cumulative_identities_invalid',
    )
    const cumulative = receipt.cumulative_identities.map(
      validateCumulativeIdentity,
    )
    const expectedCumulative = [
      ...((prior?.cumulative_identities as JsonRecord[] | undefined) ?? []),
      ...companies.map(cumulativeIdentity),
    ]
    requireGate(
      canonicalJson(cumulative) === canonicalJson(expectedCumulative),
      'pass_receipt_cumulative_chain_invalid',
    )
    noDuplicates(
      cumulative.map((entry) => String(entry.company_id)),
      'pass_receipt_cumulative_company_duplicate',
    )
    noDuplicates(
      cumulative.map((entry) => String(entry.source_key)),
      'pass_receipt_cumulative_source_duplicate',
    )
    const targets = candidates.implementation_targets as JsonRecord[]
    const targetBySource = new Map(targets.map((entry) => [
      String(entry.source_key),
      entry,
    ]))
    for (const company of companies) {
      const target = targetBySource.get(String(company.source_key))
      requireGate(
        target
          && company.normalized_name === target.normalized_name
          && company.portfolio_class === target.portfolio_class
          && company.official_careers_url === target.official_careers_url
          && company.identity_evidence_sha256
            === target.identity_evidence_sha256,
        'pass_receipt_candidate_mismatch',
      )
    }
    const finance = companies.filter((entry) =>
      entry.portfolio_class === 'finance').length
    const techData = companies.length - finance
    requireGate(
      receipt.wave_finance_count === finance
        && receipt.wave_tech_data_count === techData
        && receipt.cumulative_finance_count
          === Number(prior?.cumulative_finance_count ?? 0) + finance
        && receipt.cumulative_tech_data_count
          === Number(prior?.cumulative_tech_data_count ?? 0) + techData,
      'pass_receipt_arithmetic_invalid',
    )
    requireGate(
      receipt.isolation_status === 'PASS'
        && receipt.watchlist_status === 'PASS'
        && receipt.authenticated_delete_status === 'PASS',
      'pass_receipt_gate_status_invalid',
    )
    const history = validateActionHistory(
      receipt.attempted_actions,
      receipt.deployed_actions,
      manifest,
    )
    requireGate(
      canonicalJson(history.attempted)
        === canonicalJson(expectedActions(wave))
        && canonicalJson(history.deployed)
          === canonicalJson(expectedActions(wave)),
      'pass_receipt_actions_incomplete',
    )
    validateRemoteHeads(receipt.remote_heads, manifest)
    timestamp(receipt.completed_at, 'pass_receipt_completed_at_invalid')
  } else {
    exactKeys(receipt, [
      'schema_version',
      'phase',
      'wave',
      'status',
      'release_manifest_sha256',
      'candidate_evidence_sha256',
      'baseline_evidence_sha256',
      'source_commit',
      'migration_file_sha256',
      'prior_wave_receipt_sha256',
      'failure',
      'attempted_actions',
      'deployed_actions',
      'remote_heads',
      'failed_at',
      'wave_evidence_sha256',
    ], 'failed_receipt_fields_invalid')
    const failure = record(receipt.failure, 'failed_receipt_failure_invalid')
    exactKeys(failure, [
      'stage',
      'code',
      'affected_identity',
    ], 'failed_receipt_failure_fields_invalid')
    requireGate(
      typeof failure.stage === 'string'
        && FAILURE_STAGES.has(failure.stage)
        && typeof failure.code === 'string'
        && FAILURE_CODES.has(failure.code)
        && (
          failure.affected_identity === null
          || (
            typeof failure.affected_identity === 'string'
            && failure.affected_identity.length > 0
            && failure.affected_identity.length <= 512
          )
        ),
      'failed_receipt_failure_code_invalid',
    )
    validateActionHistory(
      receipt.attempted_actions,
      receipt.deployed_actions,
      manifest,
    )
    validateRemoteHeads(receipt.remote_heads, manifest)
    timestamp(receipt.failed_at, 'failed_receipt_time_invalid')
  }
  validateSelfHash(
    receipt,
    'wave_evidence_sha256',
    'receipt_evidence_digest_invalid',
  )
  return receipt
}

function validateAggregateCompany(value: unknown, wave: number): JsonRecord {
  return validateCompanyReceipt(value, wave)
}

function validateAggregateReceipt(
  value: unknown,
  wave: number,
  baselineDigest: string,
  prior: JsonRecord | null,
): JsonRecord {
  const receipt = record(value, 'aggregate_receipt_invalid')
  requireGate(
    receipt.schema_version === 1
      && receipt.phase === PHASE
      && receipt.wave === wave
      && receipt.status === 'PASS'
      && receipt.baseline_evidence_sha256 === baselineDigest
      && receipt.prior_wave_receipt_sha256
        === (prior?.wave_evidence_sha256 ?? null),
    'aggregate_receipt_chain_invalid',
  )
  requireGate(
    Array.isArray(receipt.companies) && receipt.companies.length === 10,
    'aggregate_receipt_company_count_invalid',
  )
  const companies = receipt.companies.map((entry) =>
    validateAggregateCompany(entry, wave))
  requireGate(
    Array.isArray(receipt.cumulative_identities)
      && receipt.cumulative_identities.length === wave * 10,
    'aggregate_cumulative_identities_invalid',
  )
  const cumulative = receipt.cumulative_identities.map(
    validateCumulativeIdentity,
  )
  requireGate(
    canonicalJson(cumulative) === canonicalJson([
      ...((prior?.cumulative_identities as JsonRecord[] | undefined) ?? []),
      ...companies.map(cumulativeIdentity),
    ]),
    'aggregate_cumulative_chain_invalid',
  )
  const finance = companies.filter((entry) =>
    entry.portfolio_class === 'finance').length
  const techData = companies.length - finance
  const expectedMix = MIXES.get(wave)!
  requireGate(
    receipt.wave_finance_count === finance
      && receipt.wave_tech_data_count === techData
      && finance === expectedMix[0]
      && techData === expectedMix[1]
      && receipt.cumulative_finance_count
        === Number(prior?.cumulative_finance_count ?? 0) + finance
      && receipt.cumulative_tech_data_count
        === Number(prior?.cumulative_tech_data_count ?? 0) + techData
      && receipt.isolation_status === 'PASS'
      && receipt.watchlist_status === 'PASS'
      && receipt.authenticated_delete_status === 'PASS',
    'aggregate_receipt_arithmetic_invalid',
  )
  validateSelfHash(
    receipt,
    'wave_evidence_sha256',
    'aggregate_receipt_digest_invalid',
  )
  return receipt
}

export function aggregateReceipts({
  baseline: baselineValue,
  receipts: receiptValues,
  expectWaves,
  expectTotal,
  expectFinance,
  expectTechData,
}: {
  baseline: unknown
  receipts: unknown[]
  expectWaves: number
  expectTotal: number
  expectFinance: number
  expectTechData: number
}): JsonRecord {
  const baseline = validateBaseline(baselineValue)
  requireGate(
    expectWaves === 5
      && expectTotal === 50
      && expectFinance === 20
      && expectTechData === 30
      && Array.isArray(receiptValues)
      && receiptValues.length === expectWaves,
    'aggregate_expectations_invalid',
  )
  const receipts: JsonRecord[] = []
  let prior: JsonRecord | null = null
  for (let wave = 1; wave <= expectWaves; wave += 1) {
    const receipt = validateAggregateReceipt(
      receiptValues[wave - 1],
      wave,
      String(baseline.baseline_evidence_sha256),
      prior,
    )
    receipts.push(receipt)
    prior = receipt
  }
  const companies = receipts.flatMap((receipt) =>
    receipt.companies as JsonRecord[])
  noDuplicates(
    companies.map((entry) => String(entry.company_id)),
    'aggregate_company_id_duplicate',
  )
  noDuplicates(
    companies.map((entry) => String(entry.source_key)),
    'aggregate_source_key_duplicate',
  )
  noDuplicates(
    companies.map((entry) =>
      `${entry.provider}|${entry.normalized_name}`),
    'aggregate_normalized_identity_duplicate',
  )
  noDuplicates(
    companies.map((entry) => String(entry.company_evidence_sha256)),
    'aggregate_company_evidence_duplicate',
  )
  const finance = companies.filter((entry) =>
    entry.portfolio_class === 'finance').length
  const techData = companies.length - finance
  requireGate(
    companies.length === expectTotal
      && finance === expectFinance
      && techData === expectTechData
      && prior?.cumulative_finance_count === expectFinance
      && prior?.cumulative_tech_data_count === expectTechData,
    'aggregate_final_arithmetic_invalid',
  )
  const result: JsonRecord = {
    schema_version: 1,
    phase: PHASE,
    status: 'PASS',
    baseline_evidence_sha256: baseline.baseline_evidence_sha256,
    ordered_wave_receipt_sha256s: receipts.map((receipt) =>
      receipt.wave_evidence_sha256),
    wave_count: receipts.length,
    total_company_count: companies.length,
    finance_count: finance,
    tech_data_count: techData,
  }
  result.aggregate_evidence_sha256 = digest(result)
  return result
}

const FORWARD_PLAN = '07'
const FORWARD_MITIGATION = 'MITIGATION_ALTERNATE_SERVER_SIDE_BUNDLER'
const FORWARD_MITIGATION_TOKEN = 'USE-API-MITIGATION'
const FORWARD_DOCKER_STATUS = 'NOT_RUN_NO_NONPRODUCTION_ENTRYPOINT'
const FORWARD_PROJECT_REF = 'fjcsvajkkztvlrpdplwx'
const FORWARD_REMOTE_URL = 'https://github.com/jackshi812/Job_Helper.git'
const FORWARD_CLI =
  '/Users/jackshi/Desktop/Job_Copilot/web/node_modules/.bin/supabase'
const FORWARD_PHASE_DIR =
  '.planning/phases/06-non-self-service-employer-connector-expansion-add-and-activa'
const FORWARD_PREFLIGHT_PATH =
  `${FORWARD_PHASE_DIR}/06-WAVE-1-FORWARD-REPAIR-PREFLIGHT.json`
const FORWARD_ATTEMPT_PATHS = [1, 2, 3, 4].map((order) =>
  `${FORWARD_PHASE_DIR}/06-WAVE-1-FORWARD-REPAIR-ACTION-0${order}-ATTEMPT.json`)
const FORWARD_ALLOWLIST = [
  'scripts/run-phase-06-wave-gate.test.mjs',
  'scripts/run-phase-06-wave-gate.ts',
  'supabase/functions/_shared/workday-identities.ts',
  'supabase/migrations/0069_phase_06_wave_1.sql',
  'web/src/lib/watchlist.test.ts',
  'web/src/lib/watchlist.ts',
  'web/src/pages/Watchlist.test.tsx',
  'web/src/pages/Watchlist.tsx',
  'web/tests/paylocity-activation-frontier.test.ts',
  'web/tests/phase-03-11-workday-asset-payments.test.ts',
  'web/tests/phase-03-8-workday-extension.test.ts',
  'web/tests/phase-06-wave-migrations.test.ts',
  'web/tests/phase-06-workday-identities.test.ts',
  'web/tests/workday-connector.integration.test.ts',
]
const FORWARD_EXCLUSIONS = [
  'company_substitution',
  'provider_redesign',
  'generic_connector',
  'manual_worker_invocation',
  'schedule_mutation',
  'outreach_mutation',
  'research_rework',
  'schema_change',
  'migration_rerun',
  'production_effect_outside_manifest',
]
const FORWARD_DECISIONS = Array.from(
  { length: 11 },
  (_, index) => `D-${String(index + 1).padStart(2, '0')}`,
)
const PREDECESSOR_DIGESTS = {
  manifest_file:
    '245c874d78e5607da1a437e1f94e38fc496c935951c21b7478d12b4a594e8296',
  manifest_semantic:
    'dad1791e1358f4e36ec8001f8e3a1f36ee6ca7f2c0fd82e0be5541803ed45e4c',
  receipt_file:
    'fae7e21e737bfd2ddbd92dcb3fe523777c43bfea94946da6a83c9b6dc6bc0c53',
  receipt_evidence:
    '00af33bef93338b6d7c6135d58001c05eb9335891bbc3d99569df9686b715132',
  migration:
    '7ef2e35b0722db9f396e11ae5361583462e3f943db1957fbf01c319fe740632c',
} as const

function commitValue(value: unknown, code: string): string {
  const result = stringValue(value, code, 40)
  requireGate(COMMIT.test(result), code)
  return result
}

function absolutePath(value: unknown, code: string): string {
  const result = stringValue(value, code, 2_048)
  requireGate(
    result.startsWith('/')
      && !result.includes('..')
      && !/[<>]/u.test(result)
      && !CONDITIONAL_TEXT.test(result),
    code,
  )
  return result
}

function evidencePath(value: unknown, code: string): string {
  const result = stringValue(value, code, 2_048)
  requireGate(
    !result.includes('\\')
      && !result.split('/').includes('..')
      && !/[<>]/u.test(result)
      && !CONDITIONAL_TEXT.test(result),
    code,
  )
  return result
}

function exactStringArray(
  value: unknown,
  expected: readonly string[],
  code: string,
): string[] {
  requireGate(Array.isArray(value), code)
  const result = value.map((entry) => stringValue(entry, code, 512))
  requireGate(canonicalJson(result) === canonicalJson(expected), code)
  return result
}

function validateForwardPredecessor(value: unknown): JsonRecord {
  const predecessor = record(value, 'forward_predecessor_invalid')
  exactKeys(predecessor, [
    'manifest_path',
    'manifest_file_sha256',
    'manifest_semantic_sha256',
    'receipt_path',
    'receipt_file_sha256',
    'receipt_evidence_sha256',
    'receipt_status',
    'completed_schema_identity',
    'migration_path',
    'migration_sha256',
    'remote_migration_head',
  ], 'forward_predecessor_fields_invalid')
  requireGate(
    predecessor.manifest_path
      === `${FORWARD_PHASE_DIR}/06-WAVE-1-RELEASE-MANIFEST.json`
      && predecessor.manifest_file_sha256 === PREDECESSOR_DIGESTS.manifest_file
      && predecessor.manifest_semantic_sha256
        === PREDECESSOR_DIGESTS.manifest_semantic
      && predecessor.receipt_path
        === `${FORWARD_PHASE_DIR}/06-WAVE-1-RECEIPT.json`
      && predecessor.receipt_file_sha256 === PREDECESSOR_DIGESTS.receipt_file
      && predecessor.receipt_evidence_sha256
        === PREDECESSOR_DIGESTS.receipt_evidence
      && predecessor.receipt_status === 'FAILED'
      && predecessor.completed_schema_identity
        === `migration:0069:sha256:${PREDECESSOR_DIGESTS.migration}`
      && predecessor.migration_path === MIGRATIONS.get(1)
      && predecessor.migration_sha256 === PREDECESSOR_DIGESTS.migration
      && predecessor.remote_migration_head === '0069',
    'forward_predecessor_drift',
  )
  return predecessor
}

function validateForwardCompany(value: unknown): JsonRecord {
  const company = record(value, 'forward_company_invalid')
  exactKeys(company, [
    'normalized_name',
    'portfolio_class',
    'source_key',
  ], 'forward_company_fields_invalid')
  normalizedName(company.normalized_name, 'forward_company_name_invalid')
  requireGate(
    company.portfolio_class === 'finance'
      || company.portfolio_class === 'tech_data',
    'forward_company_class_invalid',
  )
  const sourceKey = stringValue(
    company.source_key,
    'forward_company_source_invalid',
  )
  requireGate(sourceKey.startsWith('workday:'), 'forward_company_source_invalid')
  return company
}

function validateForwardCompanies(value: unknown): JsonRecord[] {
  requireGate(Array.isArray(value) && value.length === 10, 'forward_companies_invalid')
  const companies = value.map(validateForwardCompany)
  noDuplicates(
    companies.map((entry) => String(entry.normalized_name)),
    'forward_company_name_duplicate',
  )
  noDuplicates(
    companies.map((entry) => String(entry.source_key)),
    'forward_company_source_duplicate',
  )
  requireGate(
    companies.filter((entry) => entry.portfolio_class === 'finance').length === 8
      && companies.filter((entry) => entry.portfolio_class === 'tech_data').length
        === 2,
    'forward_company_mix_invalid',
  )
  return companies
}

function validateForwardSourceCandidate(value: unknown): JsonRecord {
  const candidate = record(value, 'forward_candidate_invalid')
  exactKeys(candidate, [
    'origin_remote_url',
    'origin_main_parent_sha',
    'candidate_parent_sha',
    'candidate_commit_sha',
    'candidate_tree_sha',
    'candidate_created_at',
    'candidate_worktree',
    'reconstructed_commits',
    'reconstruction_allowlist',
    'changed_paths',
    'planning_evidence_paths',
    'is_ancestor',
    'single_parent_path',
    'no_merge_commits',
    'source_closures',
  ], 'forward_candidate_fields_invalid')
  requireGate(
    candidate.origin_remote_url === FORWARD_REMOTE_URL,
    'forward_candidate_remote_invalid',
  )
  const parent = commitValue(
    candidate.origin_main_parent_sha,
    'forward_candidate_parent_invalid',
  )
  requireGate(
    commitValue(candidate.candidate_parent_sha, 'forward_candidate_parent_invalid')
      === parent,
    'forward_candidate_parent_invalid',
  )
  const candidateCommit = commitValue(
    candidate.candidate_commit_sha,
    'forward_candidate_commit_invalid',
  )
  requireGate(candidateCommit !== parent, 'forward_candidate_commit_invalid')
  commitValue(candidate.candidate_tree_sha, 'forward_candidate_tree_invalid')
  timestamp(candidate.candidate_created_at, 'forward_candidate_time_invalid')
  const worktree = absolutePath(
    candidate.candidate_worktree,
    'forward_candidate_worktree_invalid',
  )
  requireGate(
    worktree.startsWith('/private/tmp/')
      && !worktree.includes('/.planning/'),
    'forward_candidate_worktree_invalid',
  )
  requireGate(
    Array.isArray(candidate.reconstructed_commits)
      && candidate.reconstructed_commits.length === 8,
    'forward_candidate_reconstruction_invalid',
  )
  const reconstructed = candidate.reconstructed_commits.map((entry) =>
    commitValue(entry, 'forward_candidate_reconstruction_invalid'))
  noDuplicates(reconstructed, 'forward_candidate_reconstruction_duplicate')
  exactStringArray(
    candidate.reconstruction_allowlist,
    FORWARD_ALLOWLIST,
    'forward_candidate_allowlist_invalid',
  )
  requireGate(
    Array.isArray(candidate.changed_paths) && candidate.changed_paths.length > 0,
    'forward_candidate_paths_invalid',
  )
  const paths = candidate.changed_paths.map((entry) =>
    stringValue(entry, 'forward_candidate_path_invalid', 512))
  noDuplicates(paths, 'forward_candidate_path_duplicate')
  requireGate(
    canonicalJson(paths)
      === canonicalJson([...paths].sort((left, right) => left.localeCompare(right)))
      && paths.every((entry) => FORWARD_ALLOWLIST.includes(entry)),
    'forward_candidate_path_invalid',
  )
  requireGate(
    paths.includes('scripts/run-phase-06-wave-gate.ts')
      && paths.includes('scripts/run-phase-06-wave-gate.test.mjs')
      && paths.includes('supabase/migrations/0069_phase_06_wave_1.sql')
      && paths.includes('supabase/functions/_shared/workday-identities.ts'),
    'forward_candidate_required_path_missing',
  )
  requireGate(
    Array.isArray(candidate.planning_evidence_paths)
      && candidate.planning_evidence_paths.length === 0
      && candidate.is_ancestor === true
      && candidate.single_parent_path === true
      && candidate.no_merge_commits === true,
    'forward_candidate_ancestry_invalid',
  )
  const closures = record(
    candidate.source_closures,
    'forward_source_closures_invalid',
  )
  exactKeys(
    closures,
    ['verify-board', 'observe-connectors', 'poll-tick'],
    'forward_source_closure_fields_invalid',
  )
  for (const value of Object.values(closures)) {
    hashValue(value, 'forward_source_closure_invalid')
  }
  return candidate
}

export function validateForwardPreflight(value: unknown): JsonRecord {
  const preflight = record(value, 'forward_preflight_invalid')
  exactKeys(preflight, [
    'schema_version',
    'phase',
    'plan',
    'wave',
    'status',
    'created_at',
    'production_attempt_count',
    'production_effects',
    'immutable_predecessor',
    'source_candidate',
    'dirty_worktree',
    'verification',
    'cli_capability',
    'remote_project',
    'scope',
    'preflight_evidence_sha256',
  ], 'forward_preflight_fields_invalid')
  requireGate(
    preflight.schema_version === 2
      && preflight.phase === PHASE
      && preflight.plan === FORWARD_PLAN
      && preflight.wave === 1
      && preflight.status === 'PASS'
      && preflight.production_attempt_count === 0
      && Array.isArray(preflight.production_effects)
      && preflight.production_effects.length === 0,
    'forward_preflight_envelope_invalid',
  )
  timestamp(preflight.created_at, 'forward_preflight_time_invalid')
  validateForwardPredecessor(preflight.immutable_predecessor)
  const candidate = validateForwardSourceCandidate(preflight.source_candidate)
  requireGate(
    Date.parse(String(candidate.candidate_created_at))
      <= Date.parse(String(preflight.created_at)),
    'forward_preflight_candidate_time_invalid',
  )
  const dirty = record(preflight.dirty_worktree, 'forward_dirty_worktree_invalid')
  exactKeys(dirty, [
    'before_status_sha256',
    'after_status_sha256',
    'protected_entries_sha256',
    'protected_entries',
    'unrelated_bytes_unchanged',
  ], 'forward_dirty_worktree_fields_invalid')
  hashValue(dirty.before_status_sha256, 'forward_dirty_before_invalid')
  hashValue(dirty.after_status_sha256, 'forward_dirty_after_invalid')
  requireGate(
    Array.isArray(dirty.protected_entries)
      && dirty.protected_entries.length > 0
      && dirty.protected_entries.length <= 100,
    'forward_dirty_entries_invalid',
  )
  const protectedEntries = dirty.protected_entries.map((entry) => {
    const protectedEntry = record(entry, 'forward_dirty_entry_invalid')
    exactKeys(protectedEntry, [
      'status',
      'path',
      'mode',
      'sha256',
    ], 'forward_dirty_entry_fields_invalid')
    requireGate(
      protectedEntry.status === 'tracked_modified'
        || protectedEntry.status === 'untracked',
      'forward_dirty_entry_status_invalid',
    )
    const path = evidencePath(
      protectedEntry.path,
      'forward_dirty_entry_path_invalid',
    )
    requireGate(!path.startsWith('/'), 'forward_dirty_entry_path_invalid')
    requireGate(
      typeof protectedEntry.mode === 'string'
        && /^[0-7]{3,4}$/u.test(protectedEntry.mode),
      'forward_dirty_entry_mode_invalid',
    )
    hashValue(protectedEntry.sha256, 'forward_dirty_entry_digest_invalid')
    return protectedEntry
  })
  noDuplicates(
    protectedEntries.map((entry) => String(entry.path)),
    'forward_dirty_entry_path_duplicate',
  )
  requireGate(
    canonicalJson(protectedEntries)
      === canonicalJson([...protectedEntries].sort((left, right) =>
        String(left.path) < String(right.path)
          ? -1
          : String(left.path) > String(right.path) ? 1 : 0)),
    'forward_dirty_entries_not_sorted',
  )
  requireGate(
    dirty.protected_entries_sha256 === digest(protectedEntries),
    'forward_dirty_entries_invalid',
  )
  requireGate(
    dirty.unrelated_bytes_unchanged === true,
    'forward_dirty_worktree_drift',
  )
  const verification = record(preflight.verification, 'forward_verification_invalid')
  exactKeys(verification, [
    'focused_runner_tests_sha256',
    'affected_web_tests_sha256',
    'full_web_tests_sha256',
    'typecheck_sha256',
    'production_build_sha256',
    'all_passed',
  ], 'forward_verification_fields_invalid')
  for (const field of [
    'focused_runner_tests_sha256',
    'affected_web_tests_sha256',
    'full_web_tests_sha256',
    'typecheck_sha256',
    'production_build_sha256',
  ]) {
    hashValue(verification[field], 'forward_verification_digest_invalid')
  }
  requireGate(verification.all_passed === true, 'forward_verification_failed')
  const cli = record(preflight.cli_capability, 'forward_cli_invalid')
  exactKeys(cli, [
    'executable',
    'executable_sha256',
    'package_sha256',
    'version',
    'version_output_sha256',
    'functions_help_sha256',
    'deploy_help_sha256',
    'serve_help_sha256',
    'docker_deploy_stage_reproduction',
    'causal_repair_claim',
    'use_api',
    'supabase_temp_dependency',
    'candidate_node_modules_required',
  ], 'forward_cli_fields_invalid')
  requireGate(
    cli.executable === FORWARD_CLI && cli.version === '2.109.1',
    'forward_cli_identity_invalid',
  )
  for (const field of [
    'executable_sha256',
    'package_sha256',
    'version_output_sha256',
    'functions_help_sha256',
    'deploy_help_sha256',
    'serve_help_sha256',
  ]) {
    hashValue(cli[field], 'forward_cli_digest_invalid')
  }
  const docker = record(
    cli.docker_deploy_stage_reproduction,
    'forward_docker_evidence_invalid',
  )
  exactKeys(docker, [
    'status',
    'functions_serve_equivalent',
  ], 'forward_docker_evidence_fields_invalid')
  const useApi = record(cli.use_api, 'forward_use_api_invalid')
  exactKeys(useApi, ['supported', 'classification'], 'forward_use_api_fields_invalid')
  requireGate(
    docker.status === FORWARD_DOCKER_STATUS
      && docker.functions_serve_equivalent === false
      && cli.causal_repair_claim === false
      && useApi.supported === true
      && useApi.classification === FORWARD_MITIGATION
      && cli.supabase_temp_dependency === false
      && cli.candidate_node_modules_required === false,
    'forward_bundler_classification_invalid',
  )
  const remote = record(preflight.remote_project, 'forward_remote_project_invalid')
  exactKeys(remote, [
    'project_ref',
    'inspected_without_mutation',
  ], 'forward_remote_project_fields_invalid')
  requireGate(
    remote.project_ref === FORWARD_PROJECT_REF
      && remote.inspected_without_mutation === true,
    'forward_remote_project_invalid',
  )
  const scope = record(preflight.scope, 'forward_scope_invalid')
  exactKeys(scope, [
    'decisions',
    'canonical_companies',
    'exclusions',
  ], 'forward_scope_fields_invalid')
  exactStringArray(scope.decisions, FORWARD_DECISIONS, 'forward_decisions_invalid')
  validateForwardCompanies(scope.canonical_companies)
  exactStringArray(scope.exclusions, FORWARD_EXCLUSIONS, 'forward_exclusions_invalid')
  validateSelfHash(
    preflight,
    'preflight_evidence_sha256',
    'forward_preflight_digest_invalid',
  )
  return preflight
}

function expectedForwardActionId(repairUuid: string, order: number): string {
  const suffixes = [
    'deploy_verify_board_api',
    'deploy_observe_connectors_api',
    'deploy_poll_tick_api',
    'push_candidate_main',
  ]
  return `forward_${repairUuid}_${suffixes[order - 1]}`
}

function validateForwardAction(
  value: unknown,
  order: number,
  manifest: JsonRecord,
): JsonRecord {
  const action = record(value, 'forward_action_invalid')
  exactKeys(action, [
    'id',
    'order',
    'max_attempts',
    'attempt_record_path',
    'executable',
    'argv',
    'cwd',
    'workdir',
    'project_ref',
    'function_name',
    'jwt_mode',
    'expected_source_closure_sha256',
    'expected_deployment_identity',
    'preconditions',
  ], 'forward_action_fields_invalid')
  const repairUuid = String(manifest.repair_uuid)
  const candidate = manifest.candidate as JsonRecord
  const worktree = String(candidate.candidate_worktree)
  requireGate(
    action.id === expectedForwardActionId(repairUuid, order)
      && action.order === order
      && action.max_attempts === 1
      && action.attempt_record_path === FORWARD_ATTEMPT_PATHS[order - 1]
      && action.cwd === worktree
      && action.workdir === worktree,
    'forward_action_binding_invalid',
  )
  hashValue(
    action.expected_source_closure_sha256,
    'forward_action_source_closure_invalid',
  )
  stringValue(
    action.expected_deployment_identity,
    'forward_action_deployment_identity_invalid',
  )
  requireGate(Array.isArray(action.argv), 'forward_action_argv_invalid')
  const argv = action.argv.map((entry) =>
    stringValue(entry, 'forward_action_argv_invalid', 2_048))
  requireGate(
    argv.every((entry) => !/[\r\n;&|`$<>]/u.test(entry)),
    'forward_action_argv_invalid',
  )
  if (order <= 3) {
    const functions = ['verify-board', 'observe-connectors', 'poll-tick']
    const functionName = functions[order - 1]
    const expectedArgv = [
      'functions',
      'deploy',
      functionName,
      '--project-ref',
      FORWARD_PROJECT_REF,
      '--use-api',
      '--workdir',
      worktree,
      ...(order === 1 ? [] : ['--no-verify-jwt']),
    ]
    const closures = candidate.source_closures as JsonRecord
    requireGate(
      action.executable === FORWARD_CLI
        && canonicalJson(argv) === canonicalJson(expectedArgv)
        && action.project_ref === FORWARD_PROJECT_REF
        && action.function_name === functionName
        && action.jwt_mode
          === (order === 1 ? 'VERIFY_ENABLED' : 'VERIFY_DISABLED')
        && action.expected_source_closure_sha256 === closures[functionName]
        && action.expected_deployment_identity
          === `function:${functionName}:sha256:${closures[functionName]}`,
      'forward_function_action_invalid',
    )
    exactStringArray(
      action.preconditions,
      ['sealed_bytes_unchanged', 'remote_migration_head_0069'],
      'forward_function_preconditions_invalid',
    )
  } else {
    requireGate(
      action.executable === '/usr/bin/git'
        && canonicalJson(argv) === canonicalJson([
          'push',
          'origin',
          `${candidate.candidate_commit_sha}:refs/heads/main`,
        ])
        && action.project_ref === null
        && action.function_name === null
        && action.jwt_mode === 'NOT_APPLICABLE'
        && action.expected_deployment_identity
          === `web:${candidate.candidate_commit_sha}`,
      'forward_push_action_invalid',
    )
    exactStringArray(action.preconditions, [
      'fetch_origin_main',
      'remote_head_equals_manifest_parent',
      'candidate_descends_from_fresh_remote',
      'non_force_exact_refspec',
    ], 'forward_push_preconditions_invalid')
  }
  return action
}

export function validateForwardManifest({
  manifest: manifestValue,
  preflight: preflightValue,
}: {
  manifest: unknown
  preflight: unknown
}): JsonRecord {
  const preflight = validateForwardPreflight(preflightValue)
  const manifest = record(manifestValue, 'forward_manifest_invalid')
  exactKeys(manifest, [
    'schema_version',
    'phase',
    'plan',
    'wave',
    'status',
    'repair_uuid',
    'sealed_at',
    'predecessor',
    'preflight',
    'candidate',
    'runner_sha256',
    'test_sha256',
    'cli',
    'remote',
    'mitigation',
    'canonical_companies',
    'actions',
    'exclusions',
    'manifest_semantic_sha256',
  ], 'forward_manifest_fields_invalid')
  requireGate(
    manifest.schema_version === 2
      && manifest.phase === PHASE
      && manifest.plan === FORWARD_PLAN
      && manifest.wave === 1
      && manifest.status === 'SEALED',
    'forward_manifest_envelope_invalid',
  )
  uuidValue(manifest.repair_uuid, 'forward_manifest_repair_uuid_invalid')
  const sealedAt = timestamp(manifest.sealed_at, 'forward_manifest_time_invalid')
  const predecessor = validateForwardPredecessor(manifest.predecessor)
  requireGate(
    canonicalJson(predecessor)
      === canonicalJson(preflight.immutable_predecessor),
    'forward_manifest_predecessor_mismatch',
  )
  const preflightRef = record(manifest.preflight, 'forward_manifest_preflight_invalid')
  exactKeys(preflightRef, [
    'path',
    'file_sha256',
    'evidence_sha256',
  ], 'forward_manifest_preflight_fields_invalid')
  evidencePath(preflightRef.path, 'forward_manifest_preflight_path_invalid')
  hashValue(preflightRef.file_sha256, 'forward_manifest_preflight_file_invalid')
  requireGate(
    preflightRef.evidence_sha256 === preflight.preflight_evidence_sha256,
    'forward_manifest_preflight_evidence_invalid',
  )
  const candidate = record(manifest.candidate, 'forward_manifest_candidate_invalid')
  exactKeys(candidate, [
    'origin_main_parent_sha',
    'candidate_commit_sha',
    'candidate_tree_sha',
    'candidate_created_at',
    'candidate_worktree',
    'changed_paths',
    'source_closures',
  ], 'forward_manifest_candidate_fields_invalid')
  const sourceCandidate = preflight.source_candidate as JsonRecord
  for (const field of [
    'origin_main_parent_sha',
    'candidate_commit_sha',
    'candidate_tree_sha',
    'candidate_created_at',
    'candidate_worktree',
    'changed_paths',
    'source_closures',
  ]) {
    requireGate(
      canonicalJson(candidate[field]) === canonicalJson(sourceCandidate[field]),
      'forward_manifest_candidate_mismatch',
    )
  }
  requireGate(
    Date.parse(String(candidate.candidate_created_at)) < Date.parse(sealedAt),
    'forward_manifest_candidate_after_seal',
  )
  hashValue(manifest.runner_sha256, 'forward_manifest_runner_digest_invalid')
  hashValue(manifest.test_sha256, 'forward_manifest_test_digest_invalid')
  const cli = record(manifest.cli, 'forward_manifest_cli_invalid')
  exactKeys(cli, [
    'executable',
    'executable_sha256',
    'package_sha256',
    'version',
    'deploy_help_sha256',
  ], 'forward_manifest_cli_fields_invalid')
  const preflightCli = preflight.cli_capability as JsonRecord
  requireGate(
    cli.executable === preflightCli.executable
      && cli.executable_sha256 === preflightCli.executable_sha256
      && cli.package_sha256 === preflightCli.package_sha256
      && cli.version === '2.109.1'
      && cli.deploy_help_sha256 === preflightCli.deploy_help_sha256,
    'forward_manifest_cli_mismatch',
  )
  const remote = record(manifest.remote, 'forward_manifest_remote_invalid')
  exactKeys(remote, [
    'name',
    'url',
    'project_ref',
    'expected_main_sha',
  ], 'forward_manifest_remote_fields_invalid')
  requireGate(
    remote.name === 'origin'
      && remote.url === FORWARD_REMOTE_URL
      && remote.project_ref === FORWARD_PROJECT_REF
      && remote.expected_main_sha === candidate.origin_main_parent_sha,
    'forward_manifest_remote_invalid',
  )
  const mitigation = record(manifest.mitigation, 'forward_manifest_mitigation_invalid')
  exactKeys(mitigation, [
    'token',
    'classification',
    'docker_deploy_stage_reproduction',
    'causal_repair_claim',
  ], 'forward_manifest_mitigation_fields_invalid')
  requireGate(
    mitigation.token === FORWARD_MITIGATION_TOKEN
      && mitigation.classification === FORWARD_MITIGATION
      && mitigation.docker_deploy_stage_reproduction === FORWARD_DOCKER_STATUS
      && mitigation.causal_repair_claim === false,
    'forward_manifest_mitigation_invalid',
  )
  const companies = validateForwardCompanies(manifest.canonical_companies)
  requireGate(
    canonicalJson(companies)
      === canonicalJson((preflight.scope as JsonRecord).canonical_companies),
    'forward_manifest_company_mismatch',
  )
  requireGate(Array.isArray(manifest.actions) && manifest.actions.length === 4,
    'forward_manifest_actions_invalid')
  const actions = manifest.actions.map((entry, index) =>
    validateForwardAction(entry, index + 1, manifest))
  noDuplicates(actions.map((entry) => String(entry.id)), 'forward_action_id_duplicate')
  exactStringArray(
    manifest.exclusions,
    FORWARD_EXCLUSIONS,
    'forward_manifest_exclusions_invalid',
  )
  validateSelfHash(
    manifest,
    'manifest_semantic_sha256',
    'forward_manifest_digest_invalid',
  )
  return manifest
}

export function forwardApprovalChallenge(
  manifestValue: unknown,
  manifestFileSha256Value: unknown,
): string {
  const manifest = record(manifestValue, 'forward_manifest_invalid')
  const manifestFileSha256 = hashValue(
    manifestFileSha256Value,
    'forward_manifest_file_digest_invalid',
  )
  requireGate(
    manifest.schema_version === 2
      && manifest.phase === PHASE
      && manifest.plan === FORWARD_PLAN
      && manifest.wave === 1
      && manifest.mitigation !== null
      && (manifest.mitigation as JsonRecord).token === FORWARD_MITIGATION_TOKEN,
    'forward_approval_manifest_invalid',
  )
  const candidate = record(manifest.candidate, 'forward_manifest_candidate_invalid')
  const candidateCommit = commitValue(
    candidate.candidate_commit_sha,
    'forward_candidate_commit_invalid',
  )
  return `APPROVE PHASE 06 WAVE 1 FORWARD REPAIR ${manifestFileSha256} CANDIDATE ${candidateCommit} ${FORWARD_MITIGATION_TOKEN}`
}

export function validateForwardApproval({
  manifest,
  manifestFileSha256,
  approval,
}: {
  manifest: unknown
  manifestFileSha256: unknown
  approval: unknown
}): string {
  const actual = stringValue(approval, 'forward_approval_invalid', 512)
  requireGate(
    actual === forwardApprovalChallenge(manifest, manifestFileSha256),
    'forward_approval_invalid',
  )
  return actual
}

export function validateForwardAttempt({
  attempt: attemptValue,
  manifest: manifestValue,
  manifestFileSha256: manifestFileSha256Value,
  actionOrder,
}: {
  attempt: unknown
  manifest: unknown
  manifestFileSha256: unknown
  actionOrder: number
}): JsonRecord {
  const manifest = record(manifestValue, 'forward_manifest_invalid')
  const manifestFileSha256 = hashValue(
    manifestFileSha256Value,
    'forward_manifest_file_digest_invalid',
  )
  requireGate(
    Number.isInteger(actionOrder)
      && actionOrder >= 1
      && actionOrder <= 4
      && Array.isArray(manifest.actions)
      && manifest.actions.length === 4,
    'forward_attempt_order_invalid',
  )
  const action = record(
    manifest.actions[actionOrder - 1],
    'forward_attempt_action_invalid',
  )
  const candidate = record(manifest.candidate, 'forward_manifest_candidate_invalid')
  const attempt = record(attemptValue, 'forward_attempt_invalid')
  exactKeys(attempt, [
    'schema_version',
    'phase',
    'plan',
    'repair_uuid',
    'action_id',
    'action_order',
    'manifest_file_sha256',
    'manifest_semantic_sha256',
    'candidate_commit_sha',
    'candidate_tree_sha',
    'executable',
    'argv',
    'cwd',
    'attempt_started_at',
    'attempt_evidence_sha256',
  ], 'forward_attempt_fields_invalid')
  requireGate(
    attempt.schema_version === 2
      && attempt.phase === PHASE
      && attempt.plan === FORWARD_PLAN
      && attempt.repair_uuid === manifest.repair_uuid
      && attempt.action_id === action.id
      && attempt.action_order === actionOrder
      && attempt.manifest_file_sha256 === manifestFileSha256
      && attempt.manifest_semantic_sha256 === manifest.manifest_semantic_sha256
      && attempt.candidate_commit_sha === candidate.candidate_commit_sha
      && attempt.candidate_tree_sha === candidate.candidate_tree_sha
      && attempt.executable === action.executable
      && canonicalJson(attempt.argv) === canonicalJson(action.argv)
      && attempt.cwd === action.cwd,
    'forward_attempt_binding_invalid',
  )
  const startedAt = timestamp(
    attempt.attempt_started_at,
    'forward_attempt_time_invalid',
  )
  requireGate(
    Date.parse(startedAt) >= Date.parse(String(manifest.sealed_at)),
    'forward_attempt_before_seal',
  )
  validateSelfHash(
    attempt,
    'attempt_evidence_sha256',
    'forward_attempt_digest_invalid',
  )
  return attempt
}

function validateForwardCompanyProof(
  value: unknown,
  expected: JsonRecord,
): JsonRecord {
  const proof = record(value, 'forward_company_proof_invalid')
  exactKeys(proof, [
    'normalized_name',
    'portfolio_class',
    'source_key',
    'activation_state',
    'naturally_scheduled',
    'persisted_real_job_id',
    'company_evidence_sha256',
  ], 'forward_company_proof_fields_invalid')
  requireGate(
    proof.normalized_name === expected.normalized_name
      && proof.portfolio_class === expected.portfolio_class
      && proof.source_key === expected.source_key
      && proof.activation_state === 'active'
      && proof.naturally_scheduled === true,
    'forward_company_proof_mismatch',
  )
  uuidValue(proof.persisted_real_job_id, 'forward_company_job_invalid')
  hashValue(proof.company_evidence_sha256, 'forward_company_proof_digest_invalid')
  return proof
}

function validateForwardGates(value: unknown, passRequired: boolean): JsonRecord {
  const gates = record(value, 'forward_receipt_gates_invalid')
  exactKeys(gates, [
    'exact_candidate_deployed',
    'authorization_rls',
    'company_isolation',
    'watchlist_fidelity',
    'outreach_unchanged',
    'provider_scope_unchanged',
    'schedules_unchanged',
    'migration_history_unchanged',
    'asvs_l1_high_severity',
  ], 'forward_receipt_gate_fields_invalid')
  requireGate(
    gates.outreach_unchanged === true
      && gates.provider_scope_unchanged === true
      && gates.schedules_unchanged === true
      && gates.migration_history_unchanged === true,
    'forward_receipt_scope_drift',
  )
  if (passRequired) {
    requireGate(
      gates.exact_candidate_deployed === true
        && gates.authorization_rls === 'PASS'
        && gates.company_isolation === 'PASS'
        && gates.watchlist_fidelity === 'PASS'
        && gates.asvs_l1_high_severity === 'PASS',
      'forward_receipt_gate_failed',
    )
  }
  return gates
}

export function validateForwardReceipt({
  receipt: receiptValue,
  predecessorReceipt: predecessorReceiptValue,
  manifest: manifestValue,
  manifestFileSha256: manifestFileSha256Value,
}: {
  receipt: unknown
  predecessorReceipt: unknown
  manifest: unknown
  manifestFileSha256: unknown
}): JsonRecord {
  const manifest = record(manifestValue, 'forward_manifest_invalid')
  const manifestFileSha256 = hashValue(
    manifestFileSha256Value,
    'forward_manifest_file_digest_invalid',
  )
  const predecessorReceipt = record(
    predecessorReceiptValue,
    'forward_predecessor_receipt_invalid',
  )
  requireGate(
    predecessorReceipt.status === 'FAILED'
      && canonicalJson(predecessorReceipt.deployed_actions)
        === canonicalJson(['schema_push'])
      && predecessorReceipt.migration_file_sha256 === PREDECESSOR_DIGESTS.migration
      && predecessorReceipt.wave_evidence_sha256
        === PREDECESSOR_DIGESTS.receipt_evidence,
    'forward_predecessor_schema_proof_invalid',
  )
  const receipt = record(receiptValue, 'forward_receipt_invalid')
  exactKeys(receipt, [
    'schema_version',
    'phase',
    'plan',
    'wave',
    'status',
    'repair_uuid',
    'manifest_path',
    'manifest_file_sha256',
    'manifest_semantic_sha256',
    'predecessor_receipt_path',
    'predecessor_receipt_file_sha256',
    'predecessor_receipt_evidence_sha256',
    'inherited_schema_identity',
    'candidate_commit_sha',
    'candidate_tree_sha',
    'approval',
    'approval_verified_at',
    'attempts',
    'attempted_action_ids',
    'deployed_action_ids',
    'action_results',
    'canonical_company_evidence',
    'gates',
    'production_effects',
    'unauthorized_effect_count',
    'failure',
    'completed_at',
    'forward_evidence_sha256',
  ], 'forward_receipt_fields_invalid')
  const candidate = record(manifest.candidate, 'forward_manifest_candidate_invalid')
  const predecessor = validateForwardPredecessor(manifest.predecessor)
  requireGate(
    receipt.schema_version === 2
      && receipt.phase === PHASE
      && receipt.plan === FORWARD_PLAN
      && receipt.wave === 1
      && (receipt.status === 'PASS' || receipt.status === 'FAILED')
      && receipt.repair_uuid === manifest.repair_uuid
      && receipt.manifest_path
        === `${FORWARD_PHASE_DIR}/06-WAVE-1-FORWARD-REPAIR-RELEASE-MANIFEST.json`
      && receipt.manifest_file_sha256 === manifestFileSha256
      && receipt.manifest_semantic_sha256 === manifest.manifest_semantic_sha256
      && receipt.predecessor_receipt_path === predecessor.receipt_path
      && receipt.predecessor_receipt_file_sha256
        === predecessor.receipt_file_sha256
      && receipt.predecessor_receipt_evidence_sha256
        === predecessor.receipt_evidence_sha256
      && receipt.inherited_schema_identity
        === predecessor.completed_schema_identity
      && receipt.candidate_commit_sha === candidate.candidate_commit_sha
      && receipt.candidate_tree_sha === candidate.candidate_tree_sha
      && receipt.unauthorized_effect_count === 0,
    'forward_receipt_binding_invalid',
  )
  validateForwardApproval({
    manifest,
    manifestFileSha256,
    approval: receipt.approval,
  })
  timestamp(receipt.approval_verified_at, 'forward_receipt_approval_time_invalid')
  timestamp(receipt.completed_at, 'forward_receipt_completion_time_invalid')
  requireGate(
    Array.isArray(receipt.attempted_action_ids)
      && Array.isArray(receipt.deployed_action_ids)
      && Array.isArray(receipt.attempts)
      && Array.isArray(receipt.action_results)
      && Array.isArray(receipt.production_effects),
    'forward_receipt_action_history_invalid',
  )
  const actionIds = (manifest.actions as JsonRecord[]).map((entry) => String(entry.id))
  const attempted = receipt.attempted_action_ids.map((entry) =>
    stringValue(entry, 'forward_receipt_attempted_action_invalid', 128))
  const deployed = receipt.deployed_action_ids.map((entry) =>
    stringValue(entry, 'forward_receipt_deployed_action_invalid', 128))
  requireGate(
    attempted.length > 0
      && canonicalJson(attempted) === canonicalJson(actionIds.slice(0, attempted.length))
      && canonicalJson(deployed) === canonicalJson(attempted.slice(0, deployed.length))
      && canonicalJson(receipt.production_effects) === canonicalJson(deployed)
      && receipt.attempts.length === attempted.length
      && receipt.action_results.length === attempted.length,
    'forward_receipt_action_history_invalid',
  )
  for (const [index, attempt] of receipt.attempts.entries()) {
    validateForwardAttempt({
      attempt,
      manifest,
      manifestFileSha256,
      actionOrder: index + 1,
    })
  }
  const results = receipt.action_results.map((entry, index) => {
    const result = record(entry, 'forward_action_result_invalid')
    exactKeys(result, [
      'action_id',
      'status',
      'output_sha256',
      'proof_sha256',
    ], 'forward_action_result_fields_invalid')
    requireGate(
      result.action_id === attempted[index]
        && (result.status === 'PASS' || result.status === 'FAILED'),
      'forward_action_result_invalid',
    )
    hashValue(result.output_sha256, 'forward_action_output_digest_invalid')
    hashValue(result.proof_sha256, 'forward_action_proof_digest_invalid')
    return result
  })
  const pass = receipt.status === 'PASS'
  validateForwardGates(receipt.gates, pass)
  if (pass) {
    requireGate(
      canonicalJson(attempted) === canonicalJson(actionIds)
        && canonicalJson(deployed) === canonicalJson(actionIds)
        && results.every((entry) => entry.status === 'PASS')
        && receipt.failure === null,
      'forward_pass_actions_incomplete',
    )
    requireGate(
      Array.isArray(receipt.canonical_company_evidence)
        && receipt.canonical_company_evidence.length === 10,
      'forward_canonical_evidence_invalid',
    )
    const expectedCompanies = manifest.canonical_companies as JsonRecord[]
    receipt.canonical_company_evidence.map((entry, index) =>
      validateForwardCompanyProof(entry, expectedCompanies[index]))
  } else {
    requireGate(
      results.at(-1)?.status === 'FAILED'
        && receipt.failure !== null
        && Array.isArray(receipt.canonical_company_evidence),
      'forward_failed_receipt_invalid',
    )
    const failure = record(receipt.failure, 'forward_failure_invalid')
    exactKeys(failure, [
      'boundary',
      'code',
      'affected_action_id',
    ], 'forward_failure_fields_invalid')
    stringValue(failure.boundary, 'forward_failure_boundary_invalid')
    stringValue(failure.code, 'forward_failure_code_invalid')
    requireGate(
      failure.affected_action_id === attempted.at(-1),
      'forward_failure_action_invalid',
    )
  }
  validateSelfHash(
    receipt,
    'forward_evidence_sha256',
    'forward_receipt_digest_invalid',
  )
  return receipt
}

export function canonicalForwardProof(
  receiptValue: unknown,
  expect: number,
): { status: 'PASS'; count: number; evidence_sha256: string } {
  const receipt = record(receiptValue, 'forward_receipt_invalid')
  requireGate(
    expect === 10
      && receipt.status === 'PASS'
      && Array.isArray(receipt.canonical_company_evidence)
      && receipt.canonical_company_evidence.length === expect,
    'forward_canonical_proof_invalid',
  )
  const rows = receipt.canonical_company_evidence as JsonRecord[]
  noDuplicates(
    rows.map((entry) => String(entry.normalized_name)),
    'forward_canonical_name_duplicate',
  )
  noDuplicates(
    rows.map((entry) => String(entry.source_key)),
    'forward_canonical_source_duplicate',
  )
  requireGate(
    rows.every((entry) =>
      entry.activation_state === 'active'
      && entry.naturally_scheduled === true
      && typeof entry.persisted_real_job_id === 'string'
      && UUID.test(entry.persisted_real_job_id)),
    'forward_canonical_company_invalid',
  )
  return {
    status: 'PASS',
    count: rows.length,
    evidence_sha256: digest(rows),
  }
}

export function effectiveWave1({
  predecessorReceipt: predecessorReceiptValue,
  forwardReceipt: forwardReceiptValue,
}: {
  predecessorReceipt: unknown
  forwardReceipt: unknown
}): JsonRecord {
  const predecessor = record(
    predecessorReceiptValue,
    'effective_predecessor_invalid',
  )
  const forward = record(forwardReceiptValue, 'effective_forward_invalid')
  requireGate(
    predecessor.status === 'FAILED'
      && canonicalJson(predecessor.deployed_actions)
        === canonicalJson(['schema_push'])
      && predecessor.migration_file_sha256 === PREDECESSOR_DIGESTS.migration
      && predecessor.wave_evidence_sha256 === PREDECESSOR_DIGESTS.receipt_evidence
      && forward.status === 'PASS'
      && forward.predecessor_receipt_evidence_sha256
        === PREDECESSOR_DIGESTS.receipt_evidence
      && forward.inherited_schema_identity
        === `migration:0069:sha256:${PREDECESSOR_DIGESTS.migration}`
      && forward.unauthorized_effect_count === 0,
    'effective_wave_1_not_pass',
  )
  const canonical = canonicalForwardProof(forward, 10)
  return {
    schema_version: 2,
    phase: PHASE,
    wave: 1,
    status: 'PASS',
    predecessor_evidence_sha256: PREDECESSOR_DIGESTS.receipt_evidence,
    forward_evidence_sha256: forward.forward_evidence_sha256,
    candidate_commit_sha: forward.candidate_commit_sha,
    canonical_count: canonical.count,
    effective_evidence_sha256: digest({
      predecessor: PREDECESSOR_DIGESTS.receipt_evidence,
      forward: forward.forward_evidence_sha256,
      candidate: forward.candidate_commit_sha,
      canonical: canonical.evidence_sha256,
    }),
  }
}

async function readJsonWithBytes(
  path: string,
): Promise<{ value: unknown; bytes: Uint8Array }> {
  const bytes = await readFile(resolve(path))
  requireGate(bytes.byteLength <= MAX_JSON_BYTES, 'json_file_too_large')
  try {
    return { value: JSON.parse(Buffer.from(bytes).toString('utf8')), bytes }
  } catch {
    fail('json_parse_failed')
  }
}

async function runForwardMode(argv: readonly string[]): Promise<boolean> {
  const mode = argv[0]
  const forwardModes = new Set([
    '--validate-forward-preflight',
    '--validate-forward-manifest',
    '--print-forward-approval-challenge',
    '--validate-forward-approval',
    '--validate-forward-attempt',
    '--validate-forward-receipt',
    '--effective-wave-1',
    '--canonical-proof',
  ])
  if (!mode || !forwardModes.has(mode)) return false
  const firstPath = argv[1]
  requireGate(firstPath !== undefined && !firstPath.startsWith('--'), 'argument_missing')
  if (mode === '--validate-forward-preflight') {
    requireGate(argv.length === 2, 'unknown_argument')
    const { value } = await readJsonWithBytes(firstPath)
    process.stdout.write(
      `PHASE_06_GATE_RESULT=${canonicalJson(validateForwardPreflight(value))}\n`,
    )
    return true
  }
  if (mode === '--effective-wave-1') {
    requireGate(argv.length === 3, 'argument_missing')
    const predecessor = (await readJsonWithBytes(firstPath)).value
    const forward = (await readJsonWithBytes(argv[2])).value
    process.stdout.write(
      `PHASE_06_GATE_RESULT=${canonicalJson(effectiveWave1({
        predecessorReceipt: predecessor,
        forwardReceipt: forward,
      }))}\n`,
    )
    return true
  }
  if (mode === '--canonical-proof') {
    requireGate(argv[2] === '--expect' && argv[3] !== undefined, 'argument_missing')
    const receipt = (await readJsonWithBytes(firstPath)).value
    const proof = canonicalForwardProof(
      receipt,
      parsePositiveInteger(argv[3], 'forward_canonical_expect_invalid'),
    )
    process.stdout.write(`PHASE_06_GATE_RESULT=${canonicalJson(proof)}\n`)
    return true
  }
  const manifestRead = await readJsonWithBytes(firstPath)
  const manifest = record(manifestRead.value, 'forward_manifest_invalid')
  const manifestFileSha256 = sha256Hex(manifestRead.bytes)
  if (mode === '--print-forward-approval-challenge') {
    requireGate(argv.length === 2, 'unknown_argument')
    process.stdout.write(`${forwardApprovalChallenge(manifest, manifestFileSha256)}\n`)
    return true
  }
  if (mode === '--validate-forward-approval') {
    requireGate(argv.length === 3, 'argument_missing')
    const approval = (await readFile(resolve(argv[2]), 'utf8')).trimEnd()
    process.stdout.write(`${validateForwardApproval({
      manifest,
      manifestFileSha256,
      approval,
    })}\n`)
    return true
  }
  if (mode === '--validate-forward-attempt') {
    requireGate(argv[2] === '--manifest' && argv[3] !== undefined, 'argument_missing')
    requireGate(argv[4] === '--action-order' && argv[5] !== undefined, 'argument_missing')
    const attempt = manifest
    const linkedManifestRead = await readJsonWithBytes(argv[3])
    const linkedManifest = linkedManifestRead.value
    const result = validateForwardAttempt({
      attempt,
      manifest: linkedManifest,
      manifestFileSha256: sha256Hex(linkedManifestRead.bytes),
      actionOrder: parsePositiveInteger(argv[5], 'forward_attempt_order_invalid'),
    })
    process.stdout.write(`PHASE_06_GATE_RESULT=${canonicalJson(result)}\n`)
    return true
  }
  if (mode === '--validate-forward-receipt') {
    const receipt = manifest
    const receiptRecord = record(receipt, 'forward_receipt_invalid')
    const linkedManifestRead = await readJsonWithBytes(
      String(receiptRecord.manifest_path),
    )
    const predecessor = (await readJsonWithBytes(
      String(receiptRecord.predecessor_receipt_path),
    )).value
    const result = validateForwardReceipt({
      receipt,
      predecessorReceipt: predecessor,
      manifest: linkedManifestRead.value,
      manifestFileSha256: sha256Hex(linkedManifestRead.bytes),
    })
    process.stdout.write(`PHASE_06_GATE_RESULT=${canonicalJson(result)}\n`)
    return true
  }
  const preflightRef = record(manifest.preflight, 'forward_manifest_preflight_invalid')
  const preflightRead = await readJsonWithBytes(String(preflightRef.path))
  requireGate(
    sha256Hex(preflightRead.bytes) === preflightRef.file_sha256,
    'forward_manifest_preflight_file_invalid',
  )
  const result = validateForwardManifest({
    manifest,
    preflight: preflightRead.value,
  })
  process.stdout.write(`PHASE_06_GATE_RESULT=${canonicalJson(result)}\n`)
  return true
}

interface Arguments {
  mode:
    | 'help'
    | 'validate-baseline'
    | 'validate-candidates'
    | 'validate-manifest'
    | 'verify-receipt'
    | 'aggregate-receipts'
  wave: number | null
  baseline: string | null
  candidates: string | null
  manifest: string | null
  receipt: string | null
  priorReceipt: string | null
  receiptPaths: string[]
  expectWaves: number | null
  expectTotal: number | null
  expectFinance: number | null
  expectTechData: number | null
}

function argumentValue(argv: readonly string[], index: number): string {
  const value = argv[index + 1]
  requireGate(value !== undefined && !value.startsWith('--'), 'argument_missing')
  return value
}

function parsePositiveInteger(value: string, code: string): number {
  requireGate(/^[1-9][0-9]*$/u.test(value), code)
  return Number(value)
}

function parseArguments(argv: readonly string[]): Arguments {
  const result: Arguments = {
    mode: 'help',
    wave: null,
    baseline: null,
    candidates: null,
    manifest: null,
    receipt: null,
    priorReceipt: null,
    receiptPaths: [],
    expectWaves: null,
    expectTotal: null,
    expectFinance: null,
    expectTechData: null,
  }
  let modeSeen = false
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help') {
      result.mode = 'help'
    } else if (
      argument === '--validate-baseline'
      || argument === '--validate-candidates'
      || argument === '--validate-manifest'
      || argument === '--verify-receipt'
    ) {
      requireGate(!modeSeen, 'multiple_modes')
      modeSeen = true
      result.mode = argument.slice(2) as Arguments['mode']
    } else if (argument === '--aggregate-receipts') {
      requireGate(!modeSeen, 'multiple_modes')
      modeSeen = true
      result.mode = 'aggregate-receipts'
      result.receiptPaths = argumentValue(argv, index).split(',')
      requireGate(
        result.receiptPaths.every((entry) => entry.length > 0),
        'aggregate_receipt_paths_invalid',
      )
      index += 1
    } else if (argument === '--wave') {
      result.wave = parsePositiveInteger(
        argumentValue(argv, index),
        'wave_invalid',
      )
      index += 1
    } else if (argument === '--baseline') {
      result.baseline = argumentValue(argv, index)
      index += 1
    } else if (argument === '--candidates') {
      result.candidates = argumentValue(argv, index)
      index += 1
    } else if (argument === '--manifest') {
      result.manifest = argumentValue(argv, index)
      index += 1
    } else if (argument === '--receipt') {
      result.receipt = argumentValue(argv, index)
      index += 1
    } else if (argument === '--prior-receipt') {
      result.priorReceipt = argumentValue(argv, index)
      index += 1
    } else if (argument === '--expect-waves') {
      result.expectWaves = parsePositiveInteger(
        argumentValue(argv, index),
        'aggregate_expectations_invalid',
      )
      index += 1
    } else if (argument === '--expect-total') {
      result.expectTotal = parsePositiveInteger(
        argumentValue(argv, index),
        'aggregate_expectations_invalid',
      )
      index += 1
    } else if (argument === '--expect-finance') {
      result.expectFinance = parsePositiveInteger(
        argumentValue(argv, index),
        'aggregate_expectations_invalid',
      )
      index += 1
    } else if (argument === '--expect-tech-data') {
      result.expectTechData = parsePositiveInteger(
        argumentValue(argv, index),
        'aggregate_expectations_invalid',
      )
      index += 1
    } else {
      fail('unknown_argument')
    }
  }
  return result
}

async function readJson(path: string | null, code: string): Promise<unknown> {
  requireGate(path !== null, code)
  const bytes = await readFile(resolve(path))
  requireGate(bytes.byteLength <= MAX_JSON_BYTES, 'json_file_too_large')
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch {
    fail('json_parse_failed')
  }
}

async function verifyArtifactFileBytes(file: JsonRecord): Promise<void> {
  try {
    const bytes = await readFile(resolve(String(file.path)))
    requireGate(
      sha256Hex(bytes) === file.sha256,
      'manifest_artifact_bytes_mismatch',
    )
  } catch (error) {
    if (error instanceof GateError) throw error
    fail('manifest_artifact_unreadable')
  }
}

async function verifyLocalManifestArtifacts(manifest: JsonRecord): Promise<void> {
  const artifacts = manifest.artifacts as JsonRecord
  const migration = artifacts.migration as JsonRecord
  await verifyArtifactFileBytes(migration)
  for (const item of artifacts.functions as JsonRecord[]) {
    for (const file of item.bundle_files as JsonRecord[]) {
      await verifyArtifactFileBytes(file)
    }
  }
  if (artifacts.web) {
    const web = artifacts.web as JsonRecord
    for (const file of web.source_files as JsonRecord[]) {
      await verifyArtifactFileBytes(file)
    }
    await verifyArtifactFileBytes({
      path: web.build_path,
      sha256: web.build_sha256,
    })
  }
}

function usage(): string {
  return [
    'Phase 6 evidence-only local gate runner',
    '',
    'Modes:',
    '  --validate-forward-preflight PATH',
    '  --validate-forward-manifest PATH',
    '  --print-forward-approval-challenge PATH',
    '  --validate-forward-approval MANIFEST_PATH APPROVAL_FILE',
    '  --validate-forward-attempt ATTEMPT_PATH --manifest MANIFEST_PATH --action-order N',
    '  --validate-forward-receipt PATH',
    '  --effective-wave-1 PREDECESSOR_RECEIPT_PATH FORWARD_RECEIPT_PATH',
    '  --canonical-proof FORWARD_RECEIPT_PATH --expect 10',
    '  --validate-baseline --baseline PATH',
    '  --validate-candidates --wave N --baseline PATH --candidates PATH [--prior-receipt PATH]',
    '  --validate-manifest --wave N --baseline PATH --candidates PATH --manifest PATH [--prior-receipt PATH]',
    '  --verify-receipt --wave N --baseline PATH --candidates PATH --manifest PATH --receipt PATH [--prior-receipt PATH]',
    '  --aggregate-receipts PATH1,...,PATH5 --baseline PATH --expect-waves 5 --expect-total 50 --expect-finance 20 --expect-tech-data 30',
    '',
  ].join('\n')
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (await runForwardMode(argv)) return
  const args = parseArguments(argv)
  if (args.mode === 'help') {
    process.stdout.write(usage())
    return
  }
  const baseline = await readJson(args.baseline, 'baseline_path_required')
  let result: JsonRecord
  if (args.mode === 'validate-baseline') {
    result = validateBaseline(baseline)
  } else if (args.mode === 'aggregate-receipts') {
    const receipts = await Promise.all(
      args.receiptPaths.map((path) => readJson(path, 'receipt_path_required')),
    )
    result = aggregateReceipts({
      baseline,
      receipts,
      expectWaves: args.expectWaves ?? 0,
      expectTotal: args.expectTotal ?? 0,
      expectFinance: args.expectFinance ?? 0,
      expectTechData: args.expectTechData ?? 0,
    })
  } else {
    requireGate(args.wave !== null && MIXES.has(args.wave), 'wave_required')
    const candidates = await readJson(
      args.candidates,
      'candidates_path_required',
    )
    const priorReceipt = args.priorReceipt
      ? await readJson(args.priorReceipt, 'prior_receipt_path_required')
      : null
    if (args.mode === 'validate-candidates') {
      result = validateCandidateSet({
        wave: args.wave,
        baseline,
        candidates,
        priorReceipt,
      })
    } else {
      const manifest = await readJson(args.manifest, 'manifest_path_required')
      if (args.mode === 'validate-manifest') {
        const validated = validateReleaseManifest({
          wave: args.wave,
          baseline,
          candidates,
          manifest,
          priorReceipt,
        })
        await verifyLocalManifestArtifacts(validated.manifest)
        result = validated.manifest
      } else {
        const receipt = await readJson(args.receipt, 'receipt_path_required')
        const validatedManifest = validateReleaseManifest({
          wave: args.wave,
          baseline,
          candidates,
          manifest,
          priorReceipt,
        }).manifest
        await verifyLocalManifestArtifacts(validatedManifest)
        result = validateWaveReceipt({
          wave: args.wave,
          baseline,
          candidates,
          manifest,
          receipt,
          priorReceipt,
        })
      }
    }
  }
  process.stdout.write(`PHASE_06_GATE_RESULT=${canonicalJson(result)}\n`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const code = error instanceof GateError ? error.code : 'unexpected_failure'
    process.stderr.write(`PHASE_06_GATE_FAILURE=${code}\n`)
    process.exitCode = 1
  })
}

#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SUPABASE_CLI = resolve(ROOT, 'web/node_modules/.bin/supabase')
const HASH = /^[a-f0-9]{64}$/
const GIT_OBJECT = /^[a-f0-9]{40,64}$/
const SOURCE_COMMIT = /^[a-f0-9]{40}$/
const UUID_V4 =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/
const VALIDATION_CONTEXT = Symbol('phase-03-10-validation-context')

export const PHASE_DIR =
  '.planning/phases/03.10-goldman-sachs-selective-higher-monitoring'
export const DEFAULT_MANIFEST =
  `${PHASE_DIR}/03.10-01-RELEASE-MANIFEST.json`
export const PROJECT_REF = 'fjcsvajkkztvlrpdplwx'
export const SOURCE_KEY = 'goldman_higher:roles'
export const PUBLIC_URL = 'https://higher.gs.com/results'
export const MIGRATION_PATH =
  'supabase/migrations/0049_phase_03_10_goldman_30_day.sql'

export const PRIVILEGED_EXECUTABLE_PATHS = Object.freeze([
  'scripts/run-phase-03-10-activation.ts',
  'scripts/run-phase-03-10-rollout.mjs',
  'scripts/verify-phase-03-10-hosted.mjs',
])

export const SAFETY_TEST_PATHS = Object.freeze([
  'scripts/run-phase-03-10-activation.test.mjs',
  'scripts/run-phase-03-10-rollout.test.mjs',
  'scripts/verify-job-retention.test.mjs',
  'scripts/verify-phase-03-10-hosted.test.mjs',
  'web/tests/branded-adapters.test.ts',
  'web/tests/branded-connectors.integration.test.ts',
  'web/tests/branded-identities.test.ts',
  'web/tests/branded-scope.test.ts',
  'web/tests/lifecycle.test.ts',
  'web/tests/observe-connectors.test.ts',
  'web/tests/phase-03-10-migration.test.ts',
  'web/tests/poll-tick.test.ts',
])

export const APPROVED_ACTIONS = Object.freeze([
  'db_push_0049',
  'deploy_verify-board',
  'deploy_observe-connectors',
  'deploy_poll-tick',
  'zero_mutation_live_probe',
  'positive_or_unsupported_terminal',
  'observe_up_to_three_windows_no_fourth',
  'natural_scheduler_poll',
  'persisted_job_feed_aging_isolation_checks',
  'cleanup_every_exit',
  'owner_browser_uat',
])

const FUNCTION_SLUGS = Object.freeze([
  'verify-board',
  'observe-connectors',
  'poll-tick',
])
const FUNCTION_JWT = Object.freeze({
  'verify-board': true,
  'observe-connectors': false,
  'poll-tick': false,
})
const CATEGORY_TERMS = Object.freeze([
  'Data',
  'Technology',
  'Finance',
  'Investment',
  'Research',
  'Risk',
  'Capital Markets',
])
const SCHEDULER_EXCLUDED_FIELDS = Object.freeze([
  'companies.consecutive_failures',
  'companies.last_error',
  'companies.last_error_code',
  'companies.last_observation_count',
  'companies.last_polled_at',
  'companies.last_success_at',
  'companies.next_poll_at',
  'pipeline_heartbeat.last_success_at',
  'pipeline_heartbeat.last_tick_at',
])
const CLEANUP_EXITS = Object.freeze([
  'success',
  'unsupported',
  'error',
  'timeout',
  'assertion_failure',
  'artifact_write_failure',
])
const SERVICE_ROLE_FUNCTIONS = Object.freeze([
  'finalize_goldman_higher_candidate',
  'record_connector_observation',
  'claim_due_experimental_connectors',
  'claim_due_companies',
])
const DENIED_ROLES = Object.freeze(['public', 'anon', 'authenticated'])
const SECRET_ENVIRONMENT_VARIABLES = Object.freeze([
  'CRON_SECRET',
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_SERVICE_ROLE_KEY',
])
const REDACTED_OUTPUTS = Object.freeze([
  'errors',
  'logs',
  'json',
  'markdown',
  'nested_causes',
])
const UAT_CHECKS = Object.freeze([
  'watchlist_identity',
  'active_or_unsupported_outcome',
  'qualifying_job_detail',
  'working_apply_link',
])
const MUTABLE_ARTIFACT_CONTRACTS = Object.freeze({
  [`${PHASE_DIR}/03.10-01-ROLLOUT-VERIFICATION.json`]: Object.freeze({
    writer: 'scripts/run-phase-03-10-activation.ts',
    initialStatus: 'PENDING',
    transitions: Object.freeze(['PENDING', 'PASS', 'UNSUPPORTED']),
  }),
  [`${PHASE_DIR}/03.10-01-ROLLOUT-EVIDENCE.md`]: Object.freeze({
    writer: 'scripts/run-phase-03-10-activation.ts',
    initialStatus: 'PENDING',
    transitions: Object.freeze(['PENDING', 'PASS', 'UNSUPPORTED']),
  }),
  [`${PHASE_DIR}/03.10-01-HOSTED-VERIFICATION.json`]: Object.freeze({
    writer: 'scripts/verify-phase-03-10-hosted.mjs',
    initialStatus: 'PENDING',
    transitions: Object.freeze(['PENDING', 'PASS', 'UNSUPPORTED']),
  }),
  [`${PHASE_DIR}/03.10-UAT.md`]: Object.freeze({
    writer: 'scripts/verify-phase-03-10-hosted.mjs',
    initialStatus: 'PENDING_OWNER_BROWSER',
    transitions: Object.freeze([
      'PENDING_OWNER_BROWSER',
      'PASS',
      'UNSUPPORTED',
    ]),
  }),
  [`${PHASE_DIR}/03.10-UAT.json`]: Object.freeze({
    writer: 'scripts/verify-phase-03-10-hosted.mjs',
    initialStatus: 'PENDING_OWNER_BROWSER',
    transitions: Object.freeze([
      'PENDING_OWNER_BROWSER',
      'PASS',
      'UNSUPPORTED',
    ]),
  }),
})

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function canonical(value) {
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

function exactKeys(value, expected, label) {
  requireCondition(
    value && typeof value === 'object' && !Array.isArray(value),
    `${label} must be an object`,
  )
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  requireCondition(
    canonical(actual) === canonical(wanted),
    `${label} field inventory drift`,
  )
}

function exactArray(value, expected, label) {
  requireCondition(
    Array.isArray(value) && canonical(value) === canonical(expected),
    `${label} inventory drift`,
  )
}

function sortedUniqueStrings(value, label) {
  requireCondition(
    Array.isArray(value)
      && value.length > 0
      && value.every((entry) => typeof entry === 'string' && entry.length > 0),
    `${label} must be a non-empty string array`,
  )
  exactArray(value, [...new Set(value)].sort(), label)
}

function requireHash(value, label) {
  requireCondition(typeof value === 'string' && HASH.test(value), `${label} drift`)
}

function requirePath(value, label) {
  requireCondition(
    typeof value === 'string' && SAFE_PATH.test(value),
    `${label} path drift`,
  )
}

function parseManifestBytes(manifest, manifestBytes) {
  let parsed
  try {
    parsed = JSON.parse(manifestBytes)
  } catch {
    throw new Error('manifest bytes are not valid JSON')
  }
  requireCondition(
    canonical(parsed) === canonical(manifest),
    'manifest bytes do not match supplied object',
  )
}

async function defaultGit(root, args, options = {}) {
  const { stdout } = await execFile('git', args, {
    cwd: root,
    encoding: options.encoding ?? 'utf8',
    maxBuffer: 20_000_000,
  })
  return stdout
}

async function gitText(git, root, args) {
  const value = await git(root, args, { encoding: 'utf8' })
  return String(value).trim()
}

async function gitBytes(git, root, args) {
  const value = await git(root, args, { encoding: 'buffer' })
  return Buffer.isBuffer(value) ? value : Buffer.from(value)
}

function validateSourceEntryShape(entry, label) {
  exactKeys(entry, ['path', 'git_object', 'sha256'], label)
  requirePath(entry.path, label)
  requireCondition(
    typeof entry.git_object === 'string' && GIT_OBJECT.test(entry.git_object),
    `${label} Git object drift`,
  )
  requireHash(entry.sha256, `${label} SHA-256`)
}

async function validateSourceEntry(
  entry,
  sourceCommit,
  root,
  git,
  { current = true, label = entry.path } = {},
) {
  validateSourceEntryShape(entry, label)
  const object = await gitText(git, root, [
    'rev-parse',
    `${sourceCommit}:${entry.path}`,
  ])
  requireCondition(object === entry.git_object, `${label} Git object drift`)
  const committedBytes = await gitBytes(git, root, [
    'show',
    `${sourceCommit}:${entry.path}`,
  ])
  requireCondition(
    sha256(committedBytes) === entry.sha256,
    `${label} committed hash drift`,
  )
  if (current) {
    let currentBytes
    try {
      currentBytes = await readFile(resolve(root, entry.path))
    } catch {
      throw new Error(`${label} current file missing`)
    }
    requireCondition(
      sha256(currentBytes) === entry.sha256,
      `${label} current hash drift`,
    )
  }
}

function validateTopLevel(manifest) {
  exactKeys(manifest, [
    'schema_version',
    'phase',
    'created_at',
    'release_manifest_id',
    'project_ref',
    'source_key',
    'public_url',
    'source_commit',
    'source_commit_object',
    'hosted_baseline',
    'migration',
    'functions',
    'privileged_executables',
    'safety_tests',
    'immutable_source',
    'mutable_artifacts',
    'web_deployment',
    'scope',
    'terminal',
    'protected_snapshot',
    'cleanup',
    'acl',
    'redaction',
    'uat',
    'approval_contract',
    'approved_actions',
  ], 'manifest')
  requireCondition(
    manifest.schema_version === 1 && manifest.phase === '03.10',
    'manifest version/phase drift',
  )
  requireCondition(
    typeof manifest.created_at === 'string'
      && new Date(manifest.created_at).toISOString() === manifest.created_at,
    'manifest creation time drift',
  )
  requireCondition(
    typeof manifest.release_manifest_id === 'string'
      && UUID_V4.test(manifest.release_manifest_id),
    'release manifest ID drift',
  )
  requireCondition(manifest.project_ref === PROJECT_REF, 'target project drift')
  requireCondition(manifest.source_key === SOURCE_KEY, 'source identity drift')
  requireCondition(manifest.public_url === PUBLIC_URL, 'public target drift')
  requireCondition(
    typeof manifest.source_commit === 'string'
      && SOURCE_COMMIT.test(manifest.source_commit),
    'source commit drift',
  )
  requireCondition(
    manifest.source_commit_object === manifest.source_commit,
    'source commit object drift',
  )
}

function validateHostedBaseline(value) {
  exactKeys(value, [
    'first_migration',
    'last_migration',
    'migration_count',
    'catalog_fingerprint',
    'company_fingerprint',
    'terminal_fingerprint',
  ], 'hosted baseline')
  requireCondition(
    value.first_migration === '0001'
      && value.last_migration === '0048'
      && value.migration_count === 48,
    'hosted baseline drift',
  )
  for (const field of [
    'catalog_fingerprint',
    'company_fingerprint',
    'terminal_fingerprint',
  ]) requireHash(value[field], `hosted baseline ${field}`)
}

function validateFunctions(functions, immutableByPath) {
  exactKeys(functions, FUNCTION_SLUGS, 'function')
  for (const slug of FUNCTION_SLUGS) {
    const entry = functions[slug]
    exactKeys(entry, [
      'entry_path',
      'entry_git_object',
      'entry_sha256',
      'bundle_files',
      'bundle_sha256',
      'verify_jwt',
    ], `${slug} function`)
    const expectedEntry = `supabase/functions/${slug}/index.ts`
    requireCondition(entry.entry_path === expectedEntry, `${slug} entry path drift`)
    requireCondition(
      entry.verify_jwt === FUNCTION_JWT[slug],
      `${slug} JWT setting drift`,
    )
    sortedUniqueStrings(entry.bundle_files, `${slug} bundle`)
    requireCondition(
      entry.bundle_files.includes(entry.entry_path),
      `${slug} bundle omits its entry`,
    )
    requireCondition(
      entry.bundle_files.every((path) =>
        path.startsWith('supabase/functions/') && SAFE_PATH.test(path)
      ),
      `${slug} bundle path drift`,
    )
    for (const path of entry.bundle_files) {
      requireCondition(
        immutableByPath.has(path),
        `${slug} bundle file is not immutable`,
      )
    }
    const sourceEntry = immutableByPath.get(entry.entry_path)
    requireCondition(
      entry.entry_git_object === sourceEntry.git_object,
      `${slug} entry Git object drift`,
    )
    requireCondition(
      entry.entry_sha256 === sourceEntry.sha256,
      `${slug} entry hash drift`,
    )
    requireHash(entry.bundle_sha256, `${slug} bundle hash`)
    const bundleHash = sha256(canonical(
      entry.bundle_files.map((path) => [
        path,
        immutableByPath.get(path).sha256,
      ]),
    ))
    requireCondition(
      bundleHash === entry.bundle_sha256,
      `${slug} bundle hash drift`,
    )
  }
}

function validateImmutableInventories(manifest) {
  requireCondition(Array.isArray(manifest.immutable_source), 'immutable source missing')
  const paths = manifest.immutable_source.map((entry) => entry?.path)
  exactArray(paths, [...new Set(paths)].sort(), 'immutable source')
  const immutableByPath = new Map()
  for (const entry of manifest.immutable_source) {
    validateSourceEntryShape(entry, `immutable source ${entry?.path ?? ''}`)
    immutableByPath.set(entry.path, entry)
  }

  const validateExactCategory = (entries, expectedPaths, label) => {
    requireCondition(Array.isArray(entries), `${label} missing`)
    exactArray(entries.map((entry) => entry?.path), expectedPaths, label)
    for (const entry of entries) {
      validateSourceEntryShape(entry, `${label} ${entry?.path ?? ''}`)
      requireCondition(
        canonical(entry) === canonical(immutableByPath.get(entry.path)),
        `${label} source entry drift`,
      )
    }
  }
  validateExactCategory(
    manifest.privileged_executables,
    PRIVILEGED_EXECUTABLE_PATHS,
    'privileged executable',
  )
  validateExactCategory(manifest.safety_tests, SAFETY_TEST_PATHS, 'safety test')

  exactKeys(manifest.migration, [
    'version',
    'path',
    'git_object',
    'sha256',
  ], 'migration')
  requireCondition(
    manifest.migration.version === '0049'
      && manifest.migration.path === MIGRATION_PATH,
    'migration identity drift',
  )
  const migrationSource = immutableByPath.get(MIGRATION_PATH)
  requireCondition(
    migrationSource
      && manifest.migration.git_object === migrationSource.git_object
      && manifest.migration.sha256 === migrationSource.sha256,
    'migration source entry drift',
  )

  validateFunctions(manifest.functions, immutableByPath)
  const expectedPaths = new Set([
    ...PRIVILEGED_EXECUTABLE_PATHS,
    ...SAFETY_TEST_PATHS,
    MIGRATION_PATH,
    ...FUNCTION_SLUGS.flatMap((slug) => manifest.functions[slug].bundle_files),
  ])
  exactArray(paths, [...expectedPaths].sort(), 'immutable source coverage')
  return immutableByPath
}

function validateMutableArtifacts(entries) {
  requireCondition(Array.isArray(entries), 'mutable artifact inventory missing')
  const expectedPaths = Object.keys(MUTABLE_ARTIFACT_CONTRACTS).sort()
  exactArray(entries.map((entry) => entry?.path), expectedPaths, 'mutable artifact')
  for (const entry of entries) {
    exactKeys(entry, [
      'path',
      'git_object',
      'initial_sha256',
      'initial_status',
      'allowed_writer',
      'allowed_transitions',
    ], `mutable artifact ${entry?.path ?? ''}`)
    requirePath(entry.path, 'mutable artifact')
    requireCondition(GIT_OBJECT.test(entry.git_object), 'mutable artifact Git object drift')
    requireHash(entry.initial_sha256, 'mutable artifact initial SHA-256')
    const expected = MUTABLE_ARTIFACT_CONTRACTS[entry.path]
    requireCondition(expected, 'unexpected mutable artifact')
    requireCondition(
      entry.allowed_writer === expected.writer
        && entry.initial_status === expected.initialStatus,
      'mutable artifact writer/status drift',
    )
    exactArray(
      entry.allowed_transitions,
      expected.transitions,
      'mutable artifact transition',
    )
  }
}

function validateWebDeployment(value) {
  exactKeys(value, [
    'unchanged',
    'source_commit',
    'deployment_id',
    'asset_sha256',
  ], 'web deployment')
  requireCondition(
    value.unchanged === true
      && typeof value.source_commit === 'string'
      && SOURCE_COMMIT.test(value.source_commit)
      && typeof value.deployment_id === 'string'
      && value.deployment_id.length > 0,
    'web deployment identity drift',
  )
  requireHash(value.asset_sha256, 'web deployment asset')
}

function validateScope(value) {
  exactKeys(value, [
    'country',
    'recent_hours',
    'populations',
    'category_terms',
    'allow_missing_closure',
  ], 'scope')
  requireCondition(
    value.country === 'US'
      && value.recent_hours === 720
      && value.allow_missing_closure === false,
    'selective scope drift',
  )
  exactArray(value.populations, ['EARLY_CAREER', 'PROFESSIONAL'], 'population')
  exactArray(value.category_terms, CATEGORY_TERMS, 'category term')
}

function validateTerminal(value) {
  exactKeys(value, [
    'outcomes',
    'exactly_one',
    'max_accepted_observations',
    'fourth_invocation_allowed',
    'later_scheduler_owned_natural_poll',
    'qualifying_persisted_role_required_for_positive',
  ], 'terminal')
  exactArray(value.outcomes, ['positive', 'unsupported'], 'terminal outcome')
  requireCondition(
    value.exactly_one === true
      && value.max_accepted_observations === 3
      && value.fourth_invocation_allowed === false
      && value.later_scheduler_owned_natural_poll === true
      && value.qualifying_persisted_role_required_for_positive === true,
    'terminal/observation contract drift',
  )
}

function validateProtectedSnapshot(value) {
  exactKeys(value, [
    'scope_complete',
    'protected_sources',
    'source_count',
    'catalog_fingerprint',
    'company_fingerprint',
    'job_fingerprint',
    'user_fingerprint',
    'cron_fingerprint',
    'function_fingerprint',
    'scheduler_excluded_fields',
  ], 'protected snapshot')
  sortedUniqueStrings(value.protected_sources, 'protected source')
  requireCondition(
    value.scope_complete === true
      && value.source_count === value.protected_sources.length
      && value.protected_sources.includes('eightfold:morganstanley')
      && value.protected_sources.includes('oracle:jpmc:CX_1001')
      && value.protected_sources.some((source) => source.startsWith('workday:')),
    'protected snapshot scope drift',
  )
  for (const field of [
    'catalog_fingerprint',
    'company_fingerprint',
    'job_fingerprint',
    'user_fingerprint',
    'cron_fingerprint',
    'function_fingerprint',
  ]) requireHash(value[field], `protected snapshot ${field}`)
  exactArray(
    value.scheduler_excluded_fields,
    SCHEDULER_EXCLUDED_FIELDS,
    'scheduler exclusion',
  )
}

function validateCleanup(value) {
  exactKeys(value, [
    'namespace',
    'verifier_ids',
    'on_exit',
    'zero_residue_required',
  ], 'cleanup')
  requireCondition(
    value.namespace === 'phase-03-10-goldman-verifier'
      && value.zero_residue_required === true,
    'cleanup namespace/residue drift',
  )
  requireCondition(
    Array.isArray(value.verifier_ids)
      && value.verifier_ids.length > 0
      && value.verifier_ids.every((id) => UUID_V4.test(id))
      && new Set(value.verifier_ids).size === value.verifier_ids.length,
    'cleanup verifier ID drift',
  )
  exactArray(value.on_exit, CLEANUP_EXITS, 'cleanup exit')
}

function validateAcl(value) {
  exactKeys(value, ['service_role_only', 'denied_roles'], 'ACL')
  exactArray(value.service_role_only, SERVICE_ROLE_FUNCTIONS, 'service-role ACL')
  exactArray(value.denied_roles, DENIED_ROLES, 'denied-role ACL')
}

function validateRedaction(value) {
  exactKeys(value, [
    'credentials_source',
    'recursive',
    'secret_environment_variables',
    'outputs',
  ], 'redaction')
  requireCondition(
    value.credentials_source === 'environment_only' && value.recursive === true,
    'credential redaction contract drift',
  )
  exactArray(
    value.secret_environment_variables,
    SECRET_ENVIRONMENT_VARIABLES,
    'credential environment',
  )
  exactArray(value.outputs, REDACTED_OUTPUTS, 'redacted output')
}

function validateUat(value) {
  exactKeys(value, [
    'status',
    'owner_browser_required',
    'codex_browser_used',
    'owner_attestation',
    'checks',
  ], 'UAT')
  requireCondition(
    value.status === 'PENDING_OWNER_BROWSER'
      && value.owner_browser_required === true
      && value.codex_browser_used === false
      && value.owner_attestation === null,
    'owner-browser UAT contract drift',
  )
  exactArray(value.checks, UAT_CHECKS, 'UAT check')
}

function validateApprovalContract(value) {
  exactKeys(value, [
    'algorithm',
    'release_prefix',
    'uat_prefix',
    'production_release',
  ], 'approval contract')
  requireCondition(
    value.algorithm === 'sha256'
      && value.release_prefix === 'approve Phase 03.10 Goldman rollout'
      && value.uat_prefix === 'approve Phase 03.10 Goldman UAT'
      && typeof value.production_release === 'boolean',
    'approval contract drift',
  )
}

function releaseApprovalPayload(manifest, hashes) {
  return {
    schema_version: manifest.schema_version,
    phase: manifest.phase,
    release_manifest_id: manifest.release_manifest_id,
    manifest_file_sha256: hashes.manifest_file_sha256,
    source_commit: manifest.source_commit,
    source_commit_object: manifest.source_commit_object,
    project_ref: manifest.project_ref,
    source_key: manifest.source_key,
    public_url: manifest.public_url,
    hosted_baseline: manifest.hosted_baseline,
    migration: manifest.migration,
    functions: Object.fromEntries(FUNCTION_SLUGS.map((slug) => [
      slug,
      {
        entry_sha256: manifest.functions[slug].entry_sha256,
        bundle_sha256: manifest.functions[slug].bundle_sha256,
        verify_jwt: manifest.functions[slug].verify_jwt,
      },
    ])),
    privileged_executables: manifest.privileged_executables,
    safety_tests: manifest.safety_tests,
    immutable_source_sha256: sha256(canonical(manifest.immutable_source)),
    mutable_artifact_templates_sha256:
      sha256(canonical(manifest.mutable_artifacts)),
    web_deployment: manifest.web_deployment,
    scope: manifest.scope,
    terminal: manifest.terminal,
    protected_snapshot: manifest.protected_snapshot,
    cleanup: manifest.cleanup,
    acl: manifest.acl,
    redaction: manifest.redaction,
    uat: manifest.uat,
    approved_actions: manifest.approved_actions,
  }
}

export async function validateManifest(
  manifest,
  manifestBytes,
  options = {},
) {
  const root = resolve(options.root ?? ROOT)
  const git = options.git ?? defaultGit
  parseManifestBytes(manifest, manifestBytes)
  validateTopLevel(manifest)
  validateHostedBaseline(manifest.hosted_baseline)
  const immutableByPath = validateImmutableInventories(manifest)
  validateMutableArtifacts(manifest.mutable_artifacts)
  validateWebDeployment(manifest.web_deployment)
  validateScope(manifest.scope)
  validateTerminal(manifest.terminal)
  validateProtectedSnapshot(manifest.protected_snapshot)
  validateCleanup(manifest.cleanup)
  validateAcl(manifest.acl)
  validateRedaction(manifest.redaction)
  validateUat(manifest.uat)
  validateApprovalContract(manifest.approval_contract)
  exactArray(manifest.approved_actions, APPROVED_ACTIONS, 'approved action')

  const resolvedCommit = await gitText(git, root, [
    'rev-parse',
    `${manifest.source_commit}^{commit}`,
  ])
  requireCondition(
    resolvedCommit === manifest.source_commit_object,
    'source commit object drift',
  )
  for (const entry of immutableByPath.values()) {
    await validateSourceEntry(entry, manifest.source_commit, root, git)
  }
  for (const entry of manifest.mutable_artifacts) {
    await validateSourceEntry(
      {
        path: entry.path,
        git_object: entry.git_object,
        sha256: entry.initial_sha256,
      },
      manifest.source_commit,
      root,
      git,
      { current: false, label: `mutable artifact ${entry.path}` },
    )
  }

  const hashes = {
    manifest_file_sha256: sha256(manifestBytes),
    migration_sha256: manifest.migration.sha256,
    function_bundle_sha256: Object.fromEntries(
      FUNCTION_SLUGS.map((slug) => [
        slug,
        manifest.functions[slug].bundle_sha256,
      ]),
    ),
    privileged_executable_inventory_sha256:
      sha256(canonical(manifest.privileged_executables)),
    safety_test_inventory_sha256: sha256(canonical(manifest.safety_tests)),
  }
  hashes.release_approval_payload_sha256 = sha256(
    canonical(releaseApprovalPayload(manifest, hashes)),
  )
  Object.defineProperty(hashes, VALIDATION_CONTEXT, {
    enumerable: false,
    value: {
      manifestBytes: Buffer.from(manifestBytes),
      root,
      git,
    },
  })
  return Object.freeze(hashes)
}

export function exactApproval(manifest, hashes) {
  requireHash(hashes?.manifest_file_sha256, 'approval manifest hash')
  requireHash(
    hashes?.release_approval_payload_sha256,
    'approval payload hash',
  )
  return [
    manifest.approval_contract.release_prefix,
    manifest.release_manifest_id,
    hashes.manifest_file_sha256,
    hashes.release_approval_payload_sha256,
  ].join(' ')
}

export function dryRunPlan(manifest, hashes) {
  requireCondition(
    hashes?.[VALIDATION_CONTEXT],
    'dry run requires fresh manifest validation',
  )
  return {
    status: 'PENDING_EXPLICIT_APPROVAL',
    production_fixture: manifest.approval_contract.production_release,
    release_manifest_id: manifest.release_manifest_id,
    source_key: manifest.source_key,
    source_commit: manifest.source_commit,
    project_ref: manifest.project_ref,
    hosted_baseline: manifest.hosted_baseline,
    actions: manifest.approved_actions,
    required_approval: exactApproval(manifest, hashes),
  }
}

async function runSupabase(args, execution) {
  return execFile(SUPABASE_CLI, args, {
    cwd: execution.cwd,
    env: execution.env,
    maxBuffer: 10_000_000,
  })
}

function requireAppliedMigration0048(stdout) {
  let parsed
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new Error('hosted migration history is not valid JSON')
  }
  const migrations = parsed?.migrations
  requireCondition(Array.isArray(migrations), 'hosted migration history missing')
  const appliedBaseline = migrations.slice(0, 48)
  requireCondition(
    migrations.length === 49
      && appliedBaseline.every((migration, index) => {
        const version = String(index + 1).padStart(4, '0')
        return migration?.local === version && migration?.remote === version
      })
      && migrations[48]?.local === '0049'
      && migrations[48]?.remote === '',
    'hosted migration 0048 is not the exact applied baseline',
  )
}

function requireAppliedMigration0049(stdout) {
  let parsed
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new Error('hosted migration history is not valid JSON')
  }
  const migrations = parsed?.migrations
  requireCondition(Array.isArray(migrations), 'hosted migration history missing')
  requireCondition(
    migrations.length === 49
      && migrations.every((migration, index) => {
        const version = String(index + 1).padStart(4, '0')
        return migration?.local === version && migration?.remote === version
      }),
    'hosted migration 0049 is not the exact applied release',
  )
}

export async function executeRelease(
  manifest,
  approval,
  hashes,
  run = runSupabase,
  options = {},
) {
  requireCondition(
    approval === exactApproval(manifest, hashes),
    'execution requires the exact manifest-derived approval string',
  )
  const prior = hashes?.[VALIDATION_CONTEXT]
  requireCondition(prior, 'execution requires fresh manifest validation')
  const validationOptions = {
    root: options.root ?? prior.root,
    git: options.git ?? prior.git,
  }
  const revalidated = await validateManifest(
    manifest,
    prior.manifestBytes,
    validationOptions,
  )
  requireCondition(
    revalidated.manifest_file_sha256 === hashes.manifest_file_sha256
      && revalidated.release_approval_payload_sha256
        === hashes.release_approval_payload_sha256,
    'execution validation drift',
  )
  const environment = options.environment ?? process.env
  requireCondition(
    typeof environment.SUPABASE_ACCESS_TOKEN === 'string'
      && environment.SUPABASE_ACCESS_TOKEN.length > 0,
    'SUPABASE_ACCESS_TOKEN is required through the environment',
  )
  const execution = {
    cwd: validationOptions.root,
    env: {
      ...environment,
      // The CLI otherwise writes ~/.supabase/telemetry.json while exiting.
      // Production runners execute with a read-only home, so that bookkeeping
      // can turn a successful API operation into a false deployment failure.
      SUPABASE_TELEMETRY_DISABLED: '1',
    },
  }

  const migrationHistory = await run(['migration', 'list', '--linked'], execution)
  requireAppliedMigration0048(migrationHistory.stdout)
  await run(['db', 'push', '--linked', '--yes'], execution)
  const appliedHistory = await run(['migration', 'list', '--linked'], execution)
  requireAppliedMigration0049(appliedHistory.stdout)
  for (const slug of FUNCTION_SLUGS) {
    const entry = manifest.functions[slug]
    const args = [
      'functions',
      'deploy',
      slug,
      '--project-ref',
      manifest.project_ref,
      '--use-api',
    ]
    if (!entry.verify_jwt) args.push('--no-verify-jwt')
    await run(args, execution)
  }
  return {
    status: 'DEPLOYED_PENDING_ACTIVATION',
    release_manifest_id: manifest.release_manifest_id,
    source_key: manifest.source_key,
  }
}

function parseArgs(argv) {
  const result = {
    mode: 'dry-run',
    manifest: DEFAULT_MANIFEST,
    approval: null,
  }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--dry-run') result.mode = 'dry-run'
    else if (argv[index] === '--manifest') result.manifest = argv[++index]
    else if (argv[index] === '--approve') {
      result.mode = 'execute'
      result.approval = argv[++index]
    } else throw new Error(`unknown argument: ${argv[index]}`)
  }
  requireCondition(
    typeof result.manifest === 'string' && result.manifest.length > 0,
    '--manifest requires a path',
  )
  if (result.mode === 'execute') {
    requireCondition(
      typeof result.approval === 'string' && result.approval.length > 0,
      '--approve requires the exact signal',
    )
  }
  return result
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const manifestPath = resolve(ROOT, args.manifest)
  const manifestBytes = await readFile(manifestPath)
  const manifest = JSON.parse(manifestBytes)
  const hashes = await validateManifest(manifest, manifestBytes)
  const result = args.mode === 'dry-run'
    ? dryRunPlan(manifest, hashes)
    : await executeRelease(manifest, args.approval, hashes)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  })
}

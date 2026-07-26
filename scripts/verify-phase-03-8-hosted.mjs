#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

const SHA40 = /^[0-9a-f]{40}$/
const SHA256 = /^[0-9a-f]{64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const ISO_SECOND = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
const IMMUTABLE_PAGES_URL = /^https:\/\/[0-9a-f-]+\.job-helper-qs9\.pages\.dev$/

const RELEASE_MANIFEST_ID = '03850000-0000-4000-8000-000000000005'
const VERIFIER_RUN_ID = '03850000-0000-4000-8000-000000000501'
const FIXTURE_KEYS = Object.freeze([
  'eightfold_fixture',
  'oracle_fixture',
  'goldman_fixture',
])
const FAULTS = Object.freeze([
  'incomplete_observation',
  'provider_schema_error',
  'provider_timeout',
  'clean_recovery',
])
const FAMILY_KEYS = Object.freeze([
  'eightfold',
  'oracle_recruiting',
  'goldman_higher',
])
const FROZEN_COMPANIES = Object.freeze([
  'Morgan Stanley',
  'Goldman Sachs',
  'JPMorgan Chase',
  'Bank of America',
  'Citi',
  'BlackRock',
  'Wells Fargo',
  'UBS',
  'Barclays',
  'Charles Schwab',
])
const SOURCE_KEYS = Object.freeze([
  'eightfold:morganstanley',
  'oracle:jpmc:CX_1001',
  'goldman_higher:roles',
])
const PROTECTED_SOURCE_KEYS = Object.freeze([
  'workday:wd12:capitalone:Capital_One',
  'workday:wd1:fmr:FidelityCareers',
])

const ROOT_KEYS = Object.freeze([
  'schema_version',
  'phase',
  'created_at',
  'release_manifest_id',
  'accepted_production_source',
  'candidate',
  'migration',
  'functions',
  'web',
  'targets',
  'candidates',
  'catalog',
  'protected_sources',
  'verifier',
  'cadence',
  'approved_actions',
  'baselines',
  'exclusions',
])
const CANDIDATE_KEYS = Object.freeze([
  'git_sha',
  'commit_object_sha256',
  'parent_sha',
  'worktree_path',
  'changed_files',
])
const MIGRATION_KEYS = Object.freeze(['path', 'sha256', 'proposed'])
const FUNCTION_KEYS = Object.freeze([
  'entry_path',
  'entry_sha256',
  'bundle_manifest_sha256',
  'bundle_files',
  'verify_jwt',
  'current_hosted',
])
const HOSTED_FUNCTION_KEYS = Object.freeze([
  'id',
  'version',
  'status',
  'verify_jwt',
])
const WEB_KEYS = Object.freeze([
  'deployment_id',
  'immutable_url',
  'git_sha',
  'asset_path',
  'asset_sha256',
  'asset_bytes',
])
const TARGET_KEYS = Object.freeze(['supabase', 'cloudflare'])
const SUPABASE_KEYS = Object.freeze([
  'project_ref',
  'project_name',
  'remote_migrations',
])
const CLOUDFLARE_KEYS = Object.freeze([
  'account_id',
  'project',
  'production_branch',
  'production_domain',
])
const CANDIDATE_IDENTITY_KEYS = Object.freeze([
  'company',
  'family',
  'source_key',
  'public_url',
  'initial_disposition',
  'initial_reason',
])
const CATALOG_KEYS = Object.freeze(['initial', 'terminal'])
const CATALOG_ROW_KEYS = Object.freeze([
  'company',
  'disposition',
  'reason',
  'source_key',
  'scheduled',
  'monitored',
])
const PROTECTED_SOURCE_KEYS_SCHEMA = Object.freeze([
  'source_key',
  'company',
  'fingerprint_sha256',
])
const VERIFIER_KEYS = Object.freeze([
  'script_sha256',
  'run_id',
  'faults',
  'fixtures',
  'limits',
])
const FIXTURE_KEYS_SCHEMA = Object.freeze([
  'key',
  'company_id',
  'job_id',
  'observation_id',
  'initial_version',
])
const LIMIT_KEYS = Object.freeze([
  'expires_minutes',
  'exercise_calls',
  'companies',
  'jobs',
  'observations',
  'provider_requests',
  'rows',
  'deadline_ms',
  'active_latency_ms',
])
const CADENCE_KEYS = Object.freeze([
  'active_minutes',
  'cron_minutes',
  'initial_stagger_minutes',
  'stop_scheduling_ms',
])
const BASELINE_KEYS = Object.freeze([
  'captured_at',
  'authenticated',
  'dry_run',
  'catalog_sha256',
  'companies_sha256',
  'observations_sha256',
  'jobs_sha256',
  'health_sha256',
  'scheduler_sha256',
  'rls_sha256',
  'grants_sha256',
])
const DRY_RUN_KEYS = Object.freeze([
  'status',
  'command',
  'proposed',
  'output_sha256',
])
const FAILED_PUSH_STATE_KEYS = Object.freeze([
  'remote_migrations',
  'migration_0040_recorded',
  'next_poll_at_exists',
  'scope_evidence_exists',
  'branded_terminal_table_exists',
  'verifier_runs_table_exists',
  'verifier_fixtures_table_exists',
  'finalize_rpc_exists',
  'experimental_claim_rpc_exists',
  'begin_rpc_exists',
  'exercise_rpc_exists',
  'finish_rpc_exists',
  'companies_constraint_branded',
  'jobs_constraint_branded',
  'observations_constraint_branded',
  'candidate_company_rows',
  'observe_cron_rows',
])

const REQUIRED_HOSTED_CHECKS = Object.freeze([
  'release_identity',
  'migration_parity',
  'verify_board_bundle',
  'observe_connectors_bundle',
  'poll_tick_bundle',
  'web_identity',
  'catalog_initial_matrix',
  'candidate_pending_state',
  'negative_target_matrix',
  'terminal_positive_branch',
  'terminal_negative_branch',
  'scope_provenance',
  'service_role_grants',
  'claim_separation',
  'cadence_and_cron',
  'cron_secret_rejection',
  'identity_rejection_before_fetch',
  'protected_sources_unchanged',
  'verifier_armed',
  'verifier_zero_fixtures',
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

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (canonical(actual) !== canonical(expected)) {
    throw new Error(`${label} keys mismatch`)
  }
}

function requireString(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`${label} is malformed`)
  }
}

function requireInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} is outside its finite bound`)
  }
}

function secretScan(value, path = 'manifest') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => secretScan(entry, `${path}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, entry] of Object.entries(value)) {
    if (/(?:password|secret|token|authorization|service_role|anon_key|publishable_key)/i.test(key)) {
      throw new Error(`${path}.${key} may contain a secret`)
    }
    if (typeof entry === 'string' && (
      /\bBearer\s+[A-Za-z0-9._~-]{8,}/i.test(entry)
      || /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(entry)
      || /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{12,}/.test(entry)
    )) {
      throw new Error(`${path}.${key} contains unredacted credentials`)
    }
    secretScan(entry, `${path}.${key}`)
  }
}

function validateCatalogRows(rows, label) {
  if (!Array.isArray(rows) || rows.length !== 10) {
    throw new Error(`${label} must contain exactly ten frozen companies`)
  }
  for (const row of rows) {
    exactKeys(row, CATALOG_ROW_KEYS, `${label} row`)
    if (!FROZEN_COMPANIES.includes(row.company)) {
      throw new Error(`${label} contains a non-frozen company`)
    }
    if (!['unsupported_with_reason', 'experimental', 'active'].includes(row.disposition)) {
      throw new Error(`${label} contains an invalid disposition`)
    }
    if (typeof row.scheduled !== 'boolean' || typeof row.monitored !== 'boolean') {
      throw new Error(`${label} scheduling flags are malformed`)
    }
    if (row.disposition === 'unsupported_with_reason') {
      if (typeof row.reason !== 'string' || row.reason.length < 3
        || row.source_key !== null || row.scheduled || row.monitored) {
        throw new Error(`${label} Unsupported row is not fail-closed`)
      }
    }
  }
  const names = rows.map(({ company }) => company).sort()
  if (canonical(names) !== canonical([...FROZEN_COMPANIES].sort())) {
    throw new Error(`${label} frozen roster drift`)
  }
}

function validateManifest(manifest) {
  exactKeys(manifest, ROOT_KEYS, 'manifest')
  if (manifest.schema_version !== 1 || manifest.phase !== '03.8') {
    throw new Error('manifest version/phase mismatch')
  }
  requireString(manifest.created_at, ISO_SECOND, 'created_at')
  if (manifest.release_manifest_id !== RELEASE_MANIFEST_ID) {
    throw new Error('release manifest ID drift')
  }
  requireString(manifest.accepted_production_source, SHA40, 'accepted production source')

  exactKeys(manifest.candidate, CANDIDATE_KEYS, 'candidate')
  requireString(manifest.candidate.git_sha, SHA40, 'candidate git SHA')
  requireString(manifest.candidate.commit_object_sha256, SHA256, 'candidate commit object')
  requireString(manifest.candidate.parent_sha, SHA40, 'candidate parent SHA')
  if (manifest.candidate.parent_sha !== manifest.accepted_production_source) {
    throw new Error('candidate is not a direct child of accepted production source')
  }
  if (typeof manifest.candidate.worktree_path !== 'string'
    || !manifest.candidate.worktree_path.startsWith('/private/tmp/')) {
    throw new Error('candidate worktree path is not an isolated release root')
  }
  if (!Array.isArray(manifest.candidate.changed_files)
    || manifest.candidate.changed_files.length < 1
    || manifest.candidate.changed_files.some((path) => (
      typeof path !== 'string'
      || path.startsWith('.planning/')
      || path === '.DS_Store'
      || path === 'scripts/agent-dashboard.mjs'
      || path === 'scripts/agent-dashboard.test.mjs'
      || path === 'web/zh'
      || path.startsWith('web/zh/')
    ))) {
    throw new Error('candidate contains planning, unrelated, or empty source inventory')
  }

  exactKeys(manifest.migration, MIGRATION_KEYS, 'migration')
  if (manifest.migration.path !== 'supabase/migrations/0040_phase_03_8_branded_connectors.sql'
    || canonical(manifest.migration.proposed) !== canonical(['0040'])) {
    throw new Error('migration inventory must propose only 0040')
  }
  requireString(manifest.migration.sha256, SHA256, 'migration SHA-256')

  exactKeys(
    manifest.functions,
    ['verify-board', 'observe-connectors', 'poll-tick'],
    'functions',
  )
  for (const [slug, entry] of Object.entries(manifest.functions)) {
    exactKeys(entry, FUNCTION_KEYS, `functions.${slug}`)
    requireString(entry.entry_sha256, SHA256, `${slug} entry SHA-256`)
    requireString(entry.bundle_manifest_sha256, SHA256, `${slug} bundle SHA-256`)
    if (!Array.isArray(entry.bundle_files) || entry.bundle_files.length < 1) {
      throw new Error(`${slug} bundle inventory is empty`)
    }
    for (const file of entry.bundle_files) {
      exactKeys(file, ['path', 'sha256'], `${slug} bundle file`)
      requireString(file.sha256, SHA256, `${slug} bundle file hash`)
    }
    if (slug === 'observe-connectors') {
      if (entry.current_hosted !== null) {
        throw new Error('observe-connectors must record its absent hosted baseline')
      }
    } else {
      exactKeys(entry.current_hosted, HOSTED_FUNCTION_KEYS, `${slug} hosted identity`)
      requireString(entry.current_hosted.id, UUID, `${slug} hosted ID`)
      requireInteger(entry.current_hosted.version, 1, 100_000, `${slug} version`)
      if (entry.current_hosted.status !== 'ACTIVE'
        || entry.current_hosted.verify_jwt !== entry.verify_jwt) {
        throw new Error(`${slug} hosted identity/JWT mismatch`)
      }
    }
  }
  if (manifest.functions['verify-board'].verify_jwt !== true
    || manifest.functions['observe-connectors'].verify_jwt !== false
    || manifest.functions['poll-tick'].verify_jwt !== false) {
    throw new Error('function JWT settings drift')
  }

  exactKeys(manifest.web, WEB_KEYS, 'web')
  requireString(manifest.web.deployment_id, UUID, 'web deployment ID')
  requireString(manifest.web.immutable_url, IMMUTABLE_PAGES_URL, 'immutable web URL')
  requireString(manifest.web.git_sha, SHA40, 'web git SHA')
  requireString(manifest.web.asset_path, /^\/assets\/[A-Za-z0-9._-]+\.js$/, 'web asset path')
  requireString(manifest.web.asset_sha256, SHA256, 'web asset SHA-256')
  requireInteger(manifest.web.asset_bytes, 1, 2_000_000, 'web asset bytes')

  exactKeys(manifest.targets, TARGET_KEYS, 'targets')
  exactKeys(manifest.targets.supabase, SUPABASE_KEYS, 'Supabase target')
  requireString(manifest.targets.supabase.project_ref, /^[a-z]{20}$/, 'Supabase project ref')
  if (!Array.isArray(manifest.targets.supabase.remote_migrations)
    || manifest.targets.supabase.remote_migrations.at(-1) !== '0039') {
    throw new Error('remote migration baseline must end at 0039')
  }
  exactKeys(manifest.targets.cloudflare, CLOUDFLARE_KEYS, 'Cloudflare target')
  if (manifest.targets.cloudflare.project !== 'job-helper'
    || manifest.targets.cloudflare.production_branch !== 'main'
    || manifest.targets.cloudflare.production_domain !== 'job-helper-qs9.pages.dev') {
    throw new Error('Cloudflare target drift')
  }

  if (!Array.isArray(manifest.candidates) || manifest.candidates.length !== 3) {
    throw new Error('candidate identity inventory must contain exactly three rows')
  }
  for (const candidate of manifest.candidates) {
    exactKeys(candidate, CANDIDATE_IDENTITY_KEYS, 'candidate identity')
    if (!FROZEN_COMPANIES.includes(candidate.company)
      || !FAMILY_KEYS.includes(candidate.family)
      || !SOURCE_KEYS.includes(candidate.source_key)
      || !candidate.public_url.startsWith('https://')
      || candidate.initial_disposition !== 'unsupported_with_reason'
      || candidate.initial_reason !== 'pending_current_live_contract_proof') {
      throw new Error('candidate identity is not frozen pending proof')
    }
  }
  if (canonical(manifest.candidates.map(({ source_key }) => source_key).sort())
    !== canonical([...SOURCE_KEYS].sort())) {
    throw new Error('candidate source-key inventory drift')
  }

  exactKeys(manifest.catalog, CATALOG_KEYS, 'catalog')
  validateCatalogRows(manifest.catalog.initial, 'catalog.initial')
  validateCatalogRows(manifest.catalog.terminal, 'catalog.terminal')

  if (!Array.isArray(manifest.protected_sources)
    || manifest.protected_sources.length !== 2) {
    throw new Error('protected source inventory must contain exactly two rows')
  }
  for (const source of manifest.protected_sources) {
    exactKeys(source, PROTECTED_SOURCE_KEYS_SCHEMA, 'protected source')
    requireString(source.fingerprint_sha256, SHA256, 'protected source fingerprint')
  }
  if (canonical(manifest.protected_sources.map(({ source_key }) => source_key).sort())
    !== canonical([...PROTECTED_SOURCE_KEYS].sort())) {
    throw new Error('protected source-key inventory drift')
  }

  exactKeys(manifest.verifier, VERIFIER_KEYS, 'verifier')
  requireString(manifest.verifier.script_sha256, SHA256, 'verifier script hash')
  if (manifest.verifier.run_id !== VERIFIER_RUN_ID
    || canonical(manifest.verifier.faults) !== canonical(FAULTS)) {
    throw new Error('verifier run/fault inventory drift')
  }
  if (!Array.isArray(manifest.verifier.fixtures)
    || manifest.verifier.fixtures.length !== 3) {
    throw new Error('verifier fixture inventory must contain exactly three rows')
  }
  for (const fixture of manifest.verifier.fixtures) {
    exactKeys(fixture, FIXTURE_KEYS_SCHEMA, 'verifier fixture')
    if (!FIXTURE_KEYS.includes(fixture.key) || fixture.initial_version !== 0) {
      throw new Error('verifier fixture identity/version drift')
    }
    for (const key of ['company_id', 'job_id', 'observation_id']) {
      requireString(fixture[key], UUID, `fixture ${key}`)
    }
  }
  if (new Set(manifest.verifier.fixtures.flatMap(
    ({ company_id, job_id, observation_id }) => [company_id, job_id, observation_id],
  )).size !== 9) {
    throw new Error('verifier fixture UUIDs are not unique')
  }
  exactKeys(manifest.verifier.limits, LIMIT_KEYS, 'verifier limits')
  const limits = manifest.verifier.limits
  requireInteger(limits.expires_minutes, 1, 20, 'verifier expiry')
  requireInteger(limits.exercise_calls, 1, 12, 'verifier call budget')
  if (limits.expires_minutes !== 20 || limits.exercise_calls !== 12
    || limits.companies !== 3 || limits.jobs !== 3
    || limits.observations < 0 || limits.observations > 12
    || limits.provider_requests < 1 || limits.provider_requests > 500
    || limits.rows < 1 || limits.rows > 5_000
    || limits.deadline_ms < 1 || limits.deadline_ms > 1_200_000
    || limits.active_latency_ms !== 900_000) {
    throw new Error('verifier limits exceed the approved finite scope')
  }

  exactKeys(manifest.cadence, CADENCE_KEYS, 'cadence')
  if (manifest.cadence.active_minutes !== 10
    || manifest.cadence.cron_minutes !== 1
    || manifest.cadence.initial_stagger_minutes !== 4
    || manifest.cadence.stop_scheduling_ms !== 120_000) {
    throw new Error('cadence contract drift')
  }
  if (!Array.isArray(manifest.approved_actions)
    || canonical(manifest.approved_actions) !== canonical([
      'supabase_db_push_linked_0040',
      'deploy_verify_board',
      'deploy_observe_connectors',
      'deploy_poll_tick',
      'assert_hosted_parity',
      'rollout_exact_eightfold',
      'rollout_exact_oracle_recruiting',
      'rollout_exact_goldman_higher',
      'exercise_fixed_disposable_faults',
      'finish_and_revoke_verifier',
    ])) {
    throw new Error('approved production action inventory drift')
  }

  exactKeys(manifest.baselines, BASELINE_KEYS, 'baselines')
  requireString(manifest.baselines.captured_at, ISO_SECOND, 'baseline capture time')
  if (manifest.baselines.authenticated !== true) {
    throw new Error('baseline was not collected through authenticated linked access')
  }
  exactKeys(manifest.baselines.dry_run, DRY_RUN_KEYS, 'dry-run baseline')
  if (manifest.baselines.dry_run.command
      !== 'web/node_modules/.bin/supabase db push --linked --dry-run'
    || canonical(manifest.baselines.dry_run.proposed) !== canonical(['0040'])) {
    throw new Error('dry-run did not propose only 0040')
  }
  if (!['PENDING_EXPLICIT_EGRESS_APPROVAL', 'PASS'].includes(
    manifest.baselines.dry_run.status,
  )) {
    throw new Error('dry-run status is invalid')
  }
  for (const key of [
    'catalog_sha256',
    'companies_sha256',
    'observations_sha256',
    'jobs_sha256',
    'health_sha256',
    'scheduler_sha256',
    'rls_sha256',
    'grants_sha256',
  ]) requireString(manifest.baselines[key], SHA256, `baseline ${key}`)
  if (manifest.baselines.dry_run.status === 'PASS') {
    requireString(manifest.baselines.dry_run.output_sha256, SHA256, 'dry-run output')
  } else if (manifest.baselines.dry_run.output_sha256 !== null) {
    throw new Error('pending dry-run cannot claim an output hash')
  }

  if (!Array.isArray(manifest.exclusions)
    || ![
      '.planning',
      '.DS_Store',
      'scripts/agent-dashboard.mjs',
      'scripts/agent-dashboard.test.mjs',
      'web/zh',
      'secondary_portals',
      'provider_credentials',
    ].every((entry) => manifest.exclusions.includes(entry))) {
    throw new Error('release exclusion inventory is incomplete')
  }

  secretScan(manifest)
  return manifest
}

async function command(cwd, executable, args) {
  const result = await execFile(executable, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' },
  })
  return `${result.stdout}\n${result.stderr}`.trim()
}

async function commandBytes(cwd, executable, args) {
  const result = await execFile(executable, args, {
    cwd,
    encoding: null,
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' },
  })
  return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout)
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
    entries.push({ path, sha256: sha256(await readFile(resolve(root, path))) })
  }
  return Object.freeze({
    entries,
    sha256: sha256(Buffer.from(canonical(entries))),
  })
}

async function assertLocalCandidate(manifest) {
  const root = manifest.candidate.worktree_path
  const gitSha = await command(root, 'git', ['rev-parse', 'HEAD'])
  const parent = await command(root, 'git', ['rev-parse', 'HEAD^'])
  if (gitSha !== manifest.candidate.git_sha
    || parent !== manifest.candidate.parent_sha) {
    throw new Error('source-only candidate HEAD/parent drift')
  }
  const status = await command(root, 'git', ['status', '--porcelain'])
  if (status) throw new Error('source-only candidate worktree is not clean')
  const commit = await commandBytes(root, 'git', ['cat-file', 'commit', gitSha])
  if (sha256(commit) !== manifest.candidate.commit_object_sha256) {
    throw new Error('source-only candidate commit object drift')
  }
  const changed = (await command(root, 'git', [
    'diff-tree', '--no-commit-id', '--name-only', '-r', gitSha,
  ])).split(/\r?\n/).filter(Boolean)
  if (canonical(changed) !== canonical(manifest.candidate.changed_files)) {
    throw new Error('source-only candidate path inventory drift')
  }
  if (sha256(await readFile(resolve(root, manifest.migration.path)))
    !== manifest.migration.sha256) {
    throw new Error('migration 0040 checksum drift')
  }
  for (const [slug, entry] of Object.entries(manifest.functions)) {
    const bundle = await bundleManifest(root, entry.entry_path)
    if (bundle.sha256 !== entry.bundle_manifest_sha256
      || canonical(bundle.entries) !== canonical(entry.bundle_files)
      || bundle.entries.find(({ path }) => path === entry.entry_path)?.sha256
        !== entry.entry_sha256) {
      throw new Error(`${slug} transitive source bundle drift`)
    }
  }
}

function manifestObjectSha256(manifest) {
  return sha256(Buffer.from(JSON.stringify(manifest)))
}

async function runPreflight(manifestPath) {
  const manifest = validateManifest(JSON.parse(await readFile(manifestPath, 'utf8')))
  if (manifest.baselines.dry_run.status !== 'PASS') {
    throw new Error('Supabase dry-run requires explicit egress approval before preflight')
  }
  const scriptHash = sha256(await readFile(fileURLToPath(import.meta.url)))
  if (scriptHash !== manifest.verifier.script_sha256) {
    throw new Error('hosted verifier script checksum drift')
  }
  await assertLocalCandidate(manifest)
  return Object.freeze({
    status: 'READY_FOR_OWNER_APPROVAL',
    release_manifest_id: manifest.release_manifest_id,
    manifest_object_sha256: manifestObjectSha256(manifest),
    source_commit: manifest.candidate.git_sha,
    migration: {
      path: manifest.migration.path,
      sha256: manifest.migration.sha256,
      proposed: manifest.migration.proposed,
    },
    functions: Object.fromEntries(Object.entries(manifest.functions).map(
      ([slug, entry]) => [slug, {
        entry_sha256: entry.entry_sha256,
        bundle_manifest_sha256: entry.bundle_manifest_sha256,
        verify_jwt: entry.verify_jwt,
      }],
    )),
    supabase_project_ref: manifest.targets.supabase.project_ref,
    web: manifest.web,
    verifier: {
      run_id: manifest.verifier.run_id,
      fixtures: manifest.verifier.fixtures,
      faults: manifest.verifier.faults,
      limits: manifest.verifier.limits,
    },
    approved_actions: manifest.approved_actions,
  })
}

function validateExerciseRequest(manifest, request, state, now = Date.now()) {
  if (request.run_id !== manifest.verifier.run_id
    || !FIXTURE_KEYS.includes(request.fixture)
    || !FAULTS.includes(request.fault)
    || !Number.isSafeInteger(request.expected_version)
    || request.expected_version !== state.fixture_version
    || state.run_id !== request.run_id
    || state.fixture !== request.fixture
    || state.exercise_calls >= manifest.verifier.limits.exercise_calls) {
    throw new Error('invalid, unknown, exhausted, or stale verifier exercise')
  }
  const expiry = Date.parse(state.expires_at)
  if (!Number.isFinite(expiry) || expiry <= now) {
    throw new Error('verifier exercise authority expired')
  }
}

async function guardedExercise(manifest, request, state, mutate) {
  validateManifest(manifest)
  validateExerciseRequest(manifest, request, state)
  return mutate()
}

function validateTimestampChain(chain, maximumMs = 900_000) {
  exactKeys(
    chain,
    ['due_at', 'claimed_at', 'completed_at', 'feed_visible_at'],
    'timestamp chain',
  )
  const values = [
    chain.due_at,
    chain.claimed_at,
    chain.completed_at,
    chain.feed_visible_at,
  ].map((value) => Date.parse(value))
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error('timestamp chain contains an invalid timestamp')
  }
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] < values[index - 1]) {
      throw new Error('timestamp chain is out of order')
    }
  }
  if (values.at(-1) - values[0] > maximumMs) {
    throw new Error('timestamp chain exceeds its finite latency bound')
  }
  return chain
}

function requirePassMap(checks, required, label) {
  exactKeys(checks, required, label)
  for (const name of required) {
    if (!checks[name] || checks[name].status !== 'PASS') {
      throw new Error(`${label}.${name} is not PASS`)
    }
  }
}

function assertHostedEvidence(evidence, manifest) {
  validateManifest(manifest)
  exactKeys(evidence, [
    'schema_version',
    'phase',
    'status',
    'manifest_sha256',
    'generated_at',
    'checks',
    'family_rollout',
    'verifier_authority',
    'cleanup',
    'uat',
  ], 'hosted evidence')
  if (evidence.schema_version !== 1 || evidence.phase !== '03.8'
    || evidence.status !== 'PASS'
    || evidence.manifest_sha256 !== manifestObjectSha256(manifest)) {
    throw new Error('hosted evidence is not exact-release PASS')
  }
  requirePassMap(evidence.checks, REQUIRED_HOSTED_CHECKS, 'hosted checks')
  exactKeys(evidence.family_rollout, FAMILY_KEYS, 'family rollout')
  for (const family of FAMILY_KEYS) {
    if (evidence.family_rollout[family]?.status !== 'PENDING') {
      throw new Error(`${family} rollout must remain PENDING after initial parity`)
    }
  }
  if (evidence.verifier_authority?.status !== 'ARMED'
    || evidence.verifier_authority.run_id !== manifest.verifier.run_id
    || evidence.verifier_authority.fixture_rows !== 0
    || evidence.verifier_authority.company_rows !== 0
    || evidence.verifier_authority.job_rows !== 0
    || evidence.cleanup?.status !== 'PENDING'
    || evidence.uat?.status !== 'PENDING') {
    throw new Error('hosted evidence consumed authority or fabricated later proof')
  }
  return evidence
}

function requireTerminalVerifierState(state) {
  exactKeys(state, [
    'run_rows',
    'fixture_rows',
    'company_rows',
    'job_rows',
    'observation_rows',
    'authority_state',
    'begin_execute',
    'exercise_execute',
    'finish_execute',
    'post_finish_denied',
  ], 'terminal verifier state')
  for (const key of [
    'run_rows',
    'fixture_rows',
    'company_rows',
    'job_rows',
    'observation_rows',
  ]) {
    if (state[key] !== 0) throw new Error(`terminal verifier ${key} residue remains`)
  }
  if (state.authority_state !== 'consumed'
    || state.begin_execute !== false
    || state.exercise_execute !== false
    || state.finish_execute !== false
    || state.post_finish_denied !== true) {
    throw new Error('verifier authority is not irreversibly consumed/revoked')
  }
  return state
}

function assertRolloutEvidence(rollout, manifest, options = {}) {
  validateManifest(manifest)
  exactKeys(rollout, [
    'status',
    'manifest_sha256',
    'families',
    'fault_recovery',
    'cleanup',
  ], 'rollout evidence')
  if (rollout.status !== 'PASS'
    || rollout.manifest_sha256 !== manifestObjectSha256(manifest)) {
    throw new Error('rollout is not exact-release PASS')
  }
  exactKeys(rollout.families, FAMILY_KEYS, 'rollout families')
  const requested = options.family ? [options.family] : FAMILY_KEYS
  for (const family of requested) {
    if (!FAMILY_KEYS.includes(family)
      || rollout.families[family]?.status !== 'PASS') {
      throw new Error(`${family} rollout is not PASS`)
    }
    const timestamps = rollout.families[family]?.timestamps
    if (timestamps) validateTimestampChain(
      timestamps,
      options.maxActiveLatencyMs ?? 900_000,
    )
  }
  if (options.requireFaultRecovery
    && rollout.fault_recovery?.status !== 'PASS') {
    throw new Error('fixed disposable-row fault/recovery proof is not PASS')
  }
  if (rollout.cleanup?.status !== 'PASS') {
    throw new Error('rollout cleanup is not PASS')
  }
  requireTerminalVerifierState(rollout.cleanup.terminal)
  return rollout
}

function assertUatEvidence(uat, manifest, { template = false } = {}) {
  validateManifest(manifest)
  if (!uat || typeof uat !== 'object' || Array.isArray(uat)) {
    throw new Error('UAT evidence must be a structured object')
  }
  if (uat.manifest_sha256 !== manifestObjectSha256(manifest)) {
    throw new Error('UAT release identity drift')
  }
  if (template) {
    if (uat.status !== 'PENDING' || uat.approval_signal !== null) {
      throw new Error('UAT template is prefilled')
    }
  } else if (uat.status !== 'PASS'
    || uat.approval_signal !== 'approve deployed Phase 03.8 UAT') {
    throw new Error('UAT is not owner-approved PASS')
  }
  return uat
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

async function httpJson(url, {
  token,
  apikey,
  method = 'GET',
  body,
  expected = [200],
} = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(apikey ? { apikey } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let payload = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      throw new Error(`non-JSON response from ${new URL(url).pathname}`)
    }
  }
  if (!expected.includes(response.status)) {
    throw new Error(`HTTP ${response.status} from ${new URL(url).pathname}`)
  }
  return payload
}

async function managementSql(manifest, query) {
  const token = requiredEnvironment('SUPABASE_ACCESS_TOKEN')
  const projectRef = manifest.targets.supabase.project_ref
  const payload = await httpJson(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    { token, method: 'POST', body: { query }, expected: [200, 201] },
  )
  if (!Array.isArray(payload)) throw new Error('management SQL response is malformed')
  return payload
}

function assertFailedPushCleanState(state, manifest) {
  validateManifest(manifest)
  exactKeys(state, FAILED_PUSH_STATE_KEYS, 'failed-push hosted state')
  if (canonical(state.remote_migrations)
    !== canonical(manifest.targets.supabase.remote_migrations)) {
    throw new Error('failed push changed the hosted migration history')
  }
  for (const key of FAILED_PUSH_STATE_KEYS.slice(1, -2)) {
    if (state[key] !== false) {
      throw new Error(`failed push left partial 0040 residue: ${key}`)
    }
  }
  if (state.candidate_company_rows !== 0 || state.observe_cron_rows !== 0) {
    throw new Error('failed push left partial 0040 row or scheduler residue')
  }
  return state
}

async function runFailedPushCleanCheck(manifest) {
  const rows = await managementSql(manifest, `
    select
      (
        select coalesce(
          jsonb_agg(version::text order by version),
          '[]'::jsonb
        )
        from supabase_migrations.schema_migrations
      ) as remote_migrations,
      exists (
        select 1 from supabase_migrations.schema_migrations
        where version::text = '0040'
      ) as migration_0040_recorded,
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'companies'
          and column_name = 'next_poll_at'
      ) as next_poll_at_exists,
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'jobs'
          and column_name = 'scope_evidence'
      ) as scope_evidence_exists,
      to_regclass('public.branded_connector_terminal_evidence') is not null
        as branded_terminal_table_exists,
      to_regclass('public.phase_03_8_verifier_runs') is not null
        as verifier_runs_table_exists,
      to_regclass('public.phase_03_8_verifier_fixtures') is not null
        as verifier_fixtures_table_exists,
      to_regprocedure(
        'public.finalize_branded_connector_candidate(text,text,text,text)'
      ) is not null as finalize_rpc_exists,
      to_regprocedure(
        'public.claim_due_experimental_connectors(integer)'
      ) is not null as experimental_claim_rpc_exists,
      to_regprocedure(
        'public.begin_phase_03_8_verifier_run(uuid)'
      ) is not null as begin_rpc_exists,
      to_regprocedure(
        'public.exercise_phase_03_8_verifier_fault(uuid,text,text,integer)'
      ) is not null as exercise_rpc_exists,
      to_regprocedure(
        'public.finish_phase_03_8_verifier_run(uuid,integer,integer,integer)'
      ) is not null as finish_rpc_exists,
      exists (
        select 1
        from pg_catalog.pg_constraint as constraint_row
        where constraint_row.conname = 'companies_ats_type_check'
          and pg_catalog.pg_get_constraintdef(constraint_row.oid)
            ~ 'eightfold|oracle_recruiting|goldman_higher'
      ) as companies_constraint_branded,
      exists (
        select 1
        from pg_catalog.pg_constraint as constraint_row
        where constraint_row.conname = 'jobs_source_check'
          and pg_catalog.pg_get_constraintdef(constraint_row.oid)
            ~ 'eightfold|oracle_recruiting|goldman_higher'
      ) as jobs_constraint_branded,
      exists (
        select 1
        from pg_catalog.pg_constraint as constraint_row
        where constraint_row.conname = 'connector_observations_provider_check'
          and pg_catalog.pg_get_constraintdef(constraint_row.oid)
            ~ 'eightfold|oracle_recruiting|goldman_higher'
      ) as observations_constraint_branded,
      (
        select count(*)::integer
        from public.companies
        where source_key in (
          'eightfold:morganstanley',
          'oracle:jpmc:CX_1001',
          'goldman_higher:roles'
        )
      ) as candidate_company_rows,
      (
        select count(*)::integer
        from cron.job
        where jobname = 'observe-connectors-every-minute'
      ) as observe_cron_rows
  `)
  if (rows.length !== 1) {
    throw new Error('failed-push hosted state query returned an invalid row count')
  }
  return assertFailedPushCleanState(rows[0], manifest)
}

async function recheckHostedRelease(manifest) {
  const rows = await managementSql(manifest, `
    select version::text
    from supabase_migrations.schema_migrations
    order by version
  `)
  const versions = rows.map(({ version }) => version)
  const allowed = [
    ...manifest.targets.supabase.remote_migrations,
    ...manifest.migration.proposed,
  ]
  if (canonical(versions) !== canonical(allowed)
    && canonical(versions) !== canonical(manifest.targets.supabase.remote_migrations)) {
    throw new Error('hosted migration identity drift')
  }
  return versions
}

async function runFamilyRollout(family, manifest) {
  if (!FAMILY_KEYS.includes(family)) throw new Error('unknown rollout family')
  const approval = process.env.PHASE_03_8_EXACT_APPROVAL
  if (approval !== 'approve exact Phase 03.8 release') {
    throw new Error('fresh exact Phase 03.8 approval is required')
  }
  await assertLocalCandidate(manifest)
  await recheckHostedRelease(manifest)
  throw new Error(
    'rollout-family is approval-gated and must be invoked by Plan 06 with its hosted evidence output path',
  )
}

function option(argv, name) {
  const index = argv.indexOf(name)
  return index === -1 ? undefined : argv[index + 1]
}

function has(argv, name) {
  return argv.includes(name)
}

function usage() {
  return [
    'Usage:',
    '  node scripts/verify-phase-03-8-hosted.mjs --preflight --manifest PATH',
    '  node scripts/verify-phase-03-8-hosted.mjs --assert-failed-push-clean --manifest PATH',
    '  node scripts/verify-phase-03-8-hosted.mjs --assert-hosted PATH --manifest PATH',
    '  node scripts/verify-phase-03-8-hosted.mjs --rollout-family FAMILY --manifest PATH',
    '  node scripts/verify-phase-03-8-hosted.mjs --assert-rollout PATH --family FAMILY --max-active-latency-ms 900000 --manifest PATH',
    '  node scripts/verify-phase-03-8-hosted.mjs --assert-rollout PATH --all-families --require-fault-recovery --require-verifier-disabled --rollout PATH',
    '  node scripts/verify-phase-03-8-hosted.mjs --assert-uat-template PATH --manifest PATH',
    '  node scripts/verify-phase-03-8-hosted.mjs --assert-uat PATH --manifest PATH',
  ].join('\n')
}

async function main(argv) {
  const manifestPath = option(argv, '--manifest')
  if (!manifestPath) throw new Error(usage())
  const manifest = validateManifest(JSON.parse(
    await readFile(resolve(manifestPath), 'utf8'),
  ))
  if (has(argv, '--preflight')) {
    console.log(JSON.stringify(await runPreflight(resolve(manifestPath)), null, 2))
    return
  }
  if (has(argv, '--assert-failed-push-clean')) {
    console.log(JSON.stringify(await runFailedPushCleanCheck(manifest), null, 2))
    return
  }
  if (has(argv, '--assert-hosted')) {
    const evidence = JSON.parse(await readFile(resolve(option(argv, '--assert-hosted')), 'utf8'))
    assertHostedEvidence(evidence, manifest)
    return
  }
  if (has(argv, '--rollout-family')) {
    await runFamilyRollout(option(argv, '--rollout-family'), manifest)
    return
  }
  if (has(argv, '--assert-rollout')) {
    const evidence = JSON.parse(await readFile(resolve(option(argv, '--assert-rollout')), 'utf8'))
    assertRolloutEvidence(evidence, manifest, {
      family: option(argv, '--family'),
      maxActiveLatencyMs: Number(option(argv, '--max-active-latency-ms') ?? 900_000),
      requireFaultRecovery: has(argv, '--require-fault-recovery'),
      requireVerifierDisabled: has(argv, '--require-verifier-disabled'),
    })
    return
  }
  if (has(argv, '--assert-uat-template') || has(argv, '--assert-uat')) {
    const flag = has(argv, '--assert-uat-template') ? '--assert-uat-template' : '--assert-uat'
    const uat = JSON.parse(await readFile(resolve(option(argv, flag)), 'utf8'))
    assertUatEvidence(uat, manifest, { template: flag === '--assert-uat-template' })
    return
  }
  throw new Error(usage())
}

const direct = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (direct) {
  main(process.argv.slice(2)).catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`verify-phase-03-8-hosted: ${message.slice(0, 800)}`)
    process.exitCode = 1
  })
}

export {
  FAULTS,
  FAMILY_KEYS,
  FIXTURE_KEYS,
  REQUIRED_HOSTED_CHECKS,
  assertFailedPushCleanState,
  assertHostedEvidence,
  assertLocalCandidate,
  assertRolloutEvidence,
  assertUatEvidence,
  bundleManifest,
  canonical,
  guardedExercise,
  manifestObjectSha256,
  requireTerminalVerifierState,
  runFailedPushCleanCheck,
  runPreflight,
  secretScan,
  sha256,
  validateExerciseRequest,
  validateManifest,
  validateTimestampChain,
}

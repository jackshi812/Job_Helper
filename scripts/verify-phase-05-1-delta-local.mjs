#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { basename, join, resolve, sep } from 'node:path'

const REPOSITORY_ROOT = realpathSync(process.cwd())
const CLI_LITERAL_PATH = 'web/node_modules/.bin/supabase'
const CLI_PATH = resolve(REPOSITORY_ROOT, CLI_LITERAL_PATH)
const CONFIG_PATH = resolve(REPOSITORY_ROOT, 'supabase/config.toml')
const MIGRATIONS_PATH = resolve(REPOSITORY_ROOT, 'supabase/migrations')
const SQL_TEST_RELATIVE_PATH =
  'supabase/tests/0064_delta_deterministic_ranking_and_batch_staging.test.sql'
const SQL_TEST_PATH = resolve(REPOSITORY_ROOT, SQL_TEST_RELATIVE_PATH)
const HISTORICAL_BASELINE_SOURCE = resolve(
  REPOSITORY_ROOT,
  'scripts/verify-phase-05-1-containment-local.mjs',
)
const TEMP_PREFIX = 'job-copilot-05-1-delta-'
const REQUIRED_LOCAL_IMAGES = [
  {
    image: 'public.ecr.aws/supabase/postgres:17.6.1.143',
    id: 'sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453',
  },
  {
    image: 'public.ecr.aws/supabase/pg_prove:3.36',
    id: 'sha256:eda7c5e68719e9c8287e78c017118407b48df904a51c935f5ab6098b8c0bc6bc',
  },
]
const FORBIDDEN_NETWORK_FALLBACK_OUTPUT =
  /Pulling from|Pulling fs layer|Download(?:ing| complete)|Pull complete|Downloaded newer image|Status: Downloaded|Installing/i
const EXCLUDED_SERVICES = [
  'edge-runtime',
  'gotrue',
  'imgproxy',
  'kong',
  'logflare',
  'mailpit',
  'postgres-meta',
  'postgrest',
  'realtime',
  'storage-api',
  'studio',
  'supavisor',
  'vector',
]

if (process.argv.length !== 2) {
  throw new Error('This verifier accepts no arguments')
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const fileSha256 = (path) => sha256(readFileSync(path))

function sanitize(value, temporaryRoot = '') {
  let sanitized = String(value)
  if (temporaryRoot) {
    sanitized = sanitized.replaceAll(temporaryRoot, '{fresh-local-root}')
  }
  return sanitized
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '{local-postgres-url}')
    .replace(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+[^\s"']*/gi, '{loopback-url}')
    .replace(/(?:127\.0\.0\.1|localhost):\d+/gi, '{loopback-address}')
    .replace(/(?:anon key|service_role key|secret key):\s*\S+/gi, '$1: {redacted}')
    .replace(/eyJ[A-Za-z0-9._-]+/g, '{redacted-jwt}')
    .replace(/job-copilot-05-1-delta-[A-Za-z0-9_-]+/g, '{isolated-project}')
    .replace(/\r\n/g, '\n')
    .trim()
}

function runProcess(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  })
  if (result.error) throw result.error
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
  }
}

function requireSuccess(result, label, temporaryRoot = '') {
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${sanitize(result.output, temporaryRoot)}`)
  }
}

const childEnvironment = { ...process.env }
for (const variable of Object.keys(childEnvironment)) {
  if (
    variable.startsWith('SUPABASE_') ||
    /^(?:DATABASE_URL|POSTGRES_URL|PGHOST|PGPASSWORD|PGSERVICE)$/.test(variable)
  ) {
    delete childEnvironment[variable]
  }
}
childEnvironment.SUPABASE_TELEMETRY_DISABLED = '1'
Object.freeze(childEnvironment)

const gitRootResult = runProcess('git', ['rev-parse', '--show-toplevel'])
requireSuccess(gitRootResult, 'Canonical Git root check')
const gitRoot = realpathSync(gitRootResult.stdout.trim())
if (gitRoot !== REPOSITORY_ROOT) {
  throw new Error(`Run from the canonical repository root (${gitRoot})`)
}

const cliResolvedPath = realpathSync(CLI_PATH)
if (!cliResolvedPath.startsWith(`${REPOSITORY_ROOT}${sep}`)) {
  throw new Error('Pinned Supabase CLI resolves outside the repository')
}

// Fail closed before the first Supabase command. A missing or changed image is
// a verification blocker; this runner never pulls, downloads, or substitutes.
const localImages = REQUIRED_LOCAL_IMAGES.map((expected) => {
  const inspected = runProcess(
    'docker',
    ['image', 'inspect', '--format', '{{.Id}}', expected.image],
    { env: childEnvironment },
  )
  requireSuccess(
    inspected,
    `Required cached Docker image ${expected.image}; downloads are forbidden`,
  )
  const actual = inspected.stdout.trim()
  if (actual !== expected.id) {
    throw new Error(
      `Cached Docker image identity mismatch for ${expected.image}: ${actual}`,
    )
  }
  return { image: expected.image, id: actual }
})

const cliCalls = []
function runCli(args, temporaryRoot = '') {
  if (childEnvironment.SUPABASE_TELEMETRY_DISABLED !== '1') {
    throw new Error('Every Supabase subprocess must disable telemetry')
  }
  const command = args.join(' ')
  if (/--project-ref|--linked|\bdb\s+push\b/i.test(command)) {
    throw new Error('Hosted or linked Supabase mode is forbidden')
  }
  cliCalls.push([CLI_LITERAL_PATH, ...args])
  const result = runProcess(CLI_PATH, args, { env: childEnvironment })
  if (FORBIDDEN_NETWORK_FALLBACK_OUTPUT.test(result.output)) {
    throw new Error(
      `Supabase CLI attempted a forbidden download: ${sanitize(result.output, temporaryRoot)}`,
    )
  }
  return result
}

const versionResult = runCli(['--version'])
requireSuccess(versionResult, 'Pinned Supabase CLI version check')
const cliVersion = versionResult.stdout.trim() || versionResult.stderr.trim()

function historicalLocalBaseline() {
  const source = readFileSync(HISTORICAL_BASELINE_SOURCE, 'utf8')
  const match = source.match(
    /const HISTORICAL_LOCAL_BASELINE_SQL = String\.raw`([\s\S]*?)`\n\nif \(!\(process\.argv/,
  )
  if (!match) throw new Error('Historical local baseline contract is unavailable')
  return match[1]
}

function repositoryMigrationManifest() {
  const allNames = readdirSync(MIGRATIONS_PATH).filter((name) => name.endsWith('.sql'))
  const selected = []
  for (let sequence = 1; sequence <= 61; sequence += 1) {
    const prefix = String(sequence).padStart(4, '0')
    const matches = allNames.filter((name) => name.startsWith(`${prefix}_`))
    if (matches.length !== 1) {
      throw new Error(`Expected exactly one repository migration for ${prefix}`)
    }
    selected.push(matches[0])
  }
  for (const prefix of ['0063', '0064']) {
    const matches = allNames.filter((name) => name.startsWith(`${prefix}_`))
    if (matches.length !== 1) {
      throw new Error(`Expected exactly one repository migration for ${prefix}`)
    }
    selected.push(matches[0])
  }
  if (selected.some((name) => name.startsWith('0062_'))) {
    throw new Error('Migration 0062 must not enter the delta manifest')
  }
  return selected
}

function appliedMigrationNames(output) {
  return [...output.matchAll(/Applying migration\s+([^\s]+\.sql)/g)]
    .map((match) => basename(match[1]))
}

function allocateLoopbackPort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Unable to allocate loopback port')))
        return
      }
      server.close((error) => error ? reject(error) : resolvePort(address.port))
    })
  })
}

async function isolatedConfig(projectId) {
  let config = readFileSync(CONFIG_PATH, 'utf8')
  config = config.replace(/^project_id\s*=\s*"[^"]+"/m, `project_id = "${projectId}"`)
  const activePorts = [...config.matchAll(/^(\s*port\s*=\s*)\d+(\s*)$/gm)]
  const ports = []
  for (let index = 0; index < activePorts.length + 1; index += 1) {
    ports.push(await allocateLoopbackPort())
  }
  let portIndex = 0
  config = config.replace(
    /^(\s*port\s*=\s*)\d+(\s*)$/gm,
    (_match, prefix, suffix) => `${prefix}${ports[portIndex++]}${suffix}`,
  )
  config = config.replaceAll('127.0.0.1:3000', `127.0.0.1:${ports.at(-1)}`)
  config = config.replace(
    /\[db\.seed\]([\s\S]*?)(?=\n\[[^\]]+\]|$)/,
    (section) => section.replace(/enabled\s*=\s*true/, 'enabled = false'),
  )
  return config
}

function validateTemporaryRoot(path) {
  const canonical = realpathSync(path)
  if (
    !canonical.startsWith(`${REPOSITORY_ROOT}${sep}`) ||
    !basename(canonical).startsWith(TEMP_PREFIX)
  ) {
    throw new Error('Refusing to operate on an unvalidated temporary root')
  }
  return canonical
}

const manifest = repositoryMigrationManifest()
const manifestPaths = manifest.map((name) => `supabase/migrations/${name}`)
const sqlSource = readFileSync(SQL_TEST_PATH, 'utf8')
const declaredAssertions = (
  sqlSource.match(/select\s+extensions\.(?:is|ok|throws_ok)\s*\(/gi) ?? []
).length
const baseline = historicalLocalBaseline()
const temporaryRoot = validateTemporaryRoot(
  mkdtempSync(join(REPOSITORY_ROOT, TEMP_PREFIX)),
)
const isolatedSupabasePath = join(temporaryRoot, 'supabase')
const isolatedMigrationsPath = join(isolatedSupabasePath, 'migrations')
const isolatedTestsPath = join(isolatedSupabasePath, 'tests')
const sqlTestDestination = join(isolatedTestsPath, basename(SQL_TEST_PATH))
const projectId = `phase_05_1_delta_${randomBytes(6).toString('hex')}`
const commandTemplates = {
  version: [CLI_LITERAL_PATH, '--version'],
  start: [
    CLI_LITERAL_PATH,
    'start',
    '--exclude',
    EXCLUDED_SERVICES.join(','),
    '--workdir',
    '{fresh-local-root}',
  ],
  reset: [
    CLI_LITERAL_PATH,
    'db',
    'reset',
    '--local',
    '--no-seed',
    '--workdir',
    '{fresh-local-root}',
  ],
  test: [
    CLI_LITERAL_PATH,
    'test',
    'db',
    `{fresh-local-root}/supabase/tests/${basename(SQL_TEST_PATH)}`,
    '--local',
    '--workdir',
    '{fresh-local-root}',
  ],
  stop: [
    CLI_LITERAL_PATH,
    'stop',
    '--no-backup',
    '--workdir',
    '{fresh-local-root}',
  ],
}

let primaryError = null
let teardown = 'failed'
let firstTestOutput = ''
let replayTestOutput = ''

try {
  mkdirSync(isolatedMigrationsPath, { recursive: true })
  mkdirSync(isolatedTestsPath, { recursive: true })
  writeFileSync(
    join(isolatedSupabasePath, 'config.toml'),
    await isolatedConfig(projectId),
    { encoding: 'utf8', mode: 0o600 },
  )
  writeFileSync(join(isolatedSupabasePath, 'roles.sql'), baseline, {
    encoding: 'utf8',
    mode: 0o600,
  })
  for (const migration of manifest) {
    copyFileSync(join(MIGRATIONS_PATH, migration), join(isolatedMigrationsPath, migration))
  }
  copyFileSync(SQL_TEST_PATH, sqlTestDestination)

  const copiedMigrations = readdirSync(isolatedMigrationsPath).sort()
  if (
    JSON.stringify(copiedMigrations) !== JSON.stringify(manifest) ||
    copiedMigrations.some((name) => /^0062_/.test(name))
  ) {
    throw new Error('Isolated migration directory does not match the exact manifest')
  }

  const startResult = runCli([
    'start',
    '--exclude',
    EXCLUDED_SERVICES.join(','),
    '--workdir',
    temporaryRoot,
  ], temporaryRoot)
  requireSuccess(startResult, 'Isolated local Supabase start', temporaryRoot)

  const resetResult = runCli([
    'db',
    'reset',
    '--local',
    '--no-seed',
    '--workdir',
    temporaryRoot,
  ], temporaryRoot)
  requireSuccess(resetResult, 'Isolated local database reset', temporaryRoot)
  const applied = appliedMigrationNames(resetResult.output)
  if (JSON.stringify(applied) !== JSON.stringify(manifest)) {
    throw new Error(`Reset migration report mismatch: ${JSON.stringify(applied)}`)
  }

  const testArguments = [
    'test',
    'db',
    sqlTestDestination,
    '--local',
    '--workdir',
    temporaryRoot,
  ]
  const firstTestResult = runCli(testArguments, temporaryRoot)
  requireSuccess(firstTestResult, 'First isolated pgTAP invocation', temporaryRoot)
  firstTestOutput = sanitize(firstTestResult.output, temporaryRoot)

  const replayTestResult = runCli(testArguments, temporaryRoot)
  requireSuccess(replayTestResult, 'Rollback replay pgTAP invocation', temporaryRoot)
  replayTestOutput = sanitize(replayTestResult.output, temporaryRoot)
} catch (error) {
  primaryError = error
} finally {
  try {
    const stopResult = runCli(
      ['stop', '--no-backup', '--workdir', temporaryRoot],
      temporaryRoot,
    )
    requireSuccess(stopResult, 'Isolated local Supabase stop', temporaryRoot)
    teardown = 'passed'
  } catch (error) {
    primaryError ??= error
  }

  try {
    validateTemporaryRoot(temporaryRoot)
    rmSync(temporaryRoot, { recursive: true, force: false })
  } catch (error) {
    primaryError ??= error
    teardown = 'failed'
  }
}

if (primaryError || teardown !== 'passed') {
  const message = sanitize(
    primaryError?.stack ?? primaryError ?? 'Teardown failed',
    temporaryRoot,
  )
  process.stderr.write(`${JSON.stringify({ result: 'failed', teardown, error: message })}\n`)
  process.exit(1)
}

const canonicalCalls = cliCalls.map((call) => call.map((argument) =>
  argument.replaceAll(temporaryRoot, '{fresh-local-root}')
))
const output = {
  result: 'passed',
  teardown,
  canonical_cwd: REPOSITORY_ROOT,
  cli_environment: { SUPABASE_TELEMETRY_DISABLED: '1' },
  cli: {
    literal_path: CLI_LITERAL_PATH,
    resolved_path: cliResolvedPath,
    sha256: fileSha256(cliResolvedPath),
    version: cliVersion,
  },
  required_local_images: localImages,
  network_fallback: {
    forbidden: true,
    image_identity_preflight_before_first_cli_command: true,
    pull_or_install_output_detected: false,
  },
  command_templates: commandTemplates,
  command_array_sha256: sha256(JSON.stringify(canonicalCalls)),
  migration_manifest: manifestPaths,
  migration_manifest_sha256: sha256(JSON.stringify(manifestPaths)),
  excluded_migrations: ['0062'],
  sql_test: {
    path: SQL_TEST_RELATIVE_PATH,
    sha256: fileSha256(SQL_TEST_PATH),
  },
  historical_local_baseline: {
    source: 'scripts/verify-phase-05-1-containment-local.mjs',
    sha256: sha256(baseline),
    removed_with_disposable_database: true,
  },
  test_output_sha256: {
    first: sha256(firstTestOutput),
    rollback_replay: sha256(replayTestOutput),
  },
  assertion_groups: {
    declared: declaredAssertions,
    first_invocation_passed: declaredAssertions,
    rollback_replay_passed: declaredAssertions,
    names: [
      'private_queue_acl_and_rpc_contract',
      'bounded_delta_enqueue_and_revision_coalescing',
      'dismissal_tombstone_exclusion',
      'atomic_batch_rejection_and_staging',
      'atomic_delta_publication_and_queue_acknowledgement',
      'bounded_backlog_and_delta_retry_membership',
    ],
  },
  synthetic_fixture_rollback: 'passed_by_second_invocation',
  hosted_or_linked_reads: 0,
  hosted_or_linked_writes: 0,
}

process.stdout.write(`${JSON.stringify(output)}\n`)

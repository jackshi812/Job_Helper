#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto'
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
import { basename, dirname, join, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'

const REPOSITORY_ROOT = realpathSync(process.cwd())
const CLI_LITERAL_PATH = 'web/node_modules/.bin/supabase'
const CLI_PATH = resolve(REPOSITORY_ROOT, CLI_LITERAL_PATH)
const CONFIG_PATH = resolve(REPOSITORY_ROOT, 'supabase/config.toml')
const MIGRATIONS_PATH = resolve(REPOSITORY_ROOT, 'supabase/migrations')
const SQL_TEST_RELATIVE_PATH =
  'supabase/tests/0063_dismissal_tombstone_ranking_containment.test.sql'
const SQL_TEST_PATH = resolve(REPOSITORY_ROOT, SQL_TEST_RELATIVE_PATH)
const TEMP_PREFIX = '.job-copilot-05-1-containment-'
const REQUIRED_LOCAL_IMAGES = [
  'public.ecr.aws/supabase/postgres:17.6.1.143',
  'public.ecr.aws/supabase/pg_prove:3.36',
]
const FORBIDDEN_NETWORK_FALLBACK_OUTPUT =
  /Pulling from|Pulling fs layer|Download(?:ing| complete)|Pull complete|Downloaded newer image|Status: Downloaded|Installing/i
const EXPECTED_RED_ASSERTION =
  'tombstone-only first enqueue initializes no run'
const EXPECTED_RED_OUTPUT_SHA256 =
  '110c40173def3b31f12a86047f32f95e93dd78a3a648292752b4da195acfa987'
const EXPECT_RED = process.argv.length === 3 && process.argv[2] === '--expect-red'

// Migrations 0016/0028 intentionally delegated creation and activation of the
// two Workday company rows to earlier hosted verification plans. Later deployed
// migrations assert those rows as prerequisites, so a brand-new local database
// needs a synthetic equivalent while replaying the immutable migration chain.
// Supabase loads roles.sql before migrations; this event trigger inserts only
// those public connector identities after migration 0035 admits both tuples.
// It is dormant thereafter, contains no owner/job/ranking data, and disappears
// with the disposable database.
const HISTORICAL_LOCAL_BASELINE_SQL = String.raw`
create or replace function public.phase_051_seed_historical_connector_prerequisites()
returns event_trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  identity_definition text;
begin
  if to_regclass('public.companies') is null then
    return;
  end if;

  select pg_catalog.pg_get_constraintdef(constraint_row.oid)
  into identity_definition
  from pg_catalog.pg_constraint as constraint_row
  where constraint_row.conrelid = 'public.companies'::regclass
    and constraint_row.conname = 'companies_workday_identity_check';

  if identity_definition is null
    or position('workday:wd1:fmr:FidelityCareers' in identity_definition) = 0
  then
    return;
  end if;

  insert into public.companies (
    name, ats_type, board_token, region, site_token, careers_url, source_key,
    activation_state, activation_successes
  ) values
    (
      'Capital One', 'workday', 'capitalone', 'wd12', 'Capital_One',
      'https://capitalone.wd12.myworkdayjobs.com/Capital_One',
      'workday:wd12:capitalone:Capital_One', 'active', 3
    ),
    (
      'Fidelity', 'workday', 'fmr', 'wd1', 'FidelityCareers',
      'https://wd1.myworkdaysite.com/en-US/recruiting/fmr/FidelityCareers',
      'workday:wd1:fmr:FidelityCareers', 'active', 3
    )
  on conflict (source_key) do nothing;

  if to_regclass('public.branded_connector_terminal_evidence') is not null then
    -- Migrations 0046 and 0049 follow separately approved local/hosted probes
    -- and therefore assert the terminal Unsupported catalog states those probes
    -- produced. Reproduce only those public catalog outcomes for a fresh replay.
    update public.source_coverage_catalog
    set unsupported_reason = 'scope_evidence_incomplete'
    where company_name = 'JPMorgan Chase'
      and provider = 'Oracle Recruiting Cloud'
      and careers_url =
        'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/requisitions'
      and disposition = 'unsupported_with_reason'
      and source_key is null;

    update public.source_coverage_catalog
    set unsupported_reason = 'posting_date_ineligible'
    where company_name = 'Goldman Sachs'
      and provider = 'Goldman Higher'
      and careers_url = 'https://higher.gs.com/roles'
      and disposition = 'unsupported_with_reason'
      and source_key is null;
  end if;

  if to_regclass('public.applications') is not null
    and to_regclass('public.deterministic_ranking_items') is not null
    and (
      to_regprocedure('public.dashboard_applied_applications()') is null
      or position(
        'when application.apply_url ~' in pg_catalog.pg_get_functiondef(
          to_regprocedure('public.dashboard_applied_applications()')
        )
      ) = 0
    )
  then
    -- Migration 0055 removes one audited tracker-verification contamination
    -- row and deliberately aborts unless every fixed identity is exact. Supply
    -- the smallest synthetic residue that satisfies those guards; 0055 itself
    -- closes and deletes the company/job/projection/item again.
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token,
      email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000'::uuid,
      '05100000-0000-4000-8000-000000009001'::uuid,
      'authenticated', 'authenticated',
      'phase-051-historical-baseline@example.invalid',
      'synthetic-not-a-login', clock_timestamp(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      clock_timestamp(), clock_timestamp(), '', '', '', ''
    ) on conflict (id) do nothing;

    insert into public.companies (
      id, name, ats_type, board_token, region, careers_url, source_key,
      activation_state, activation_successes
    ) values (
      '04020000-0000-4000-8000-000000000010'::uuid,
      'Phase 04 Tracker Fixture Company', 'greenhouse',
      'phase-04-tracker-0053-proof-v1', null,
      'https://job-boards.greenhouse.io/phase-04-tracker-0053-proof-v1',
      'greenhouse:global:phase-04-tracker-0053-proof-v1', 'active', 0
    ) on conflict (id) do nothing;

    insert into public.jobs (
      id, company_id, source, external_id, title, absolute_url, fingerprint,
      status, first_seen_at, last_seen_at
    ) values (
      '04020000-0000-4000-8000-000000000020'::uuid,
      '04020000-0000-4000-8000-000000000010'::uuid,
      'greenhouse', 'phase-04-tracker-0053-job',
      'Phase 04 Tracker Fixture Job',
      'https://job-boards.greenhouse.io/phase-04-tracker-0053-proof-v1/jobs/1',
      'fd330e93bd57729fbd5c07a3d0ec8400f32b54ae7b8636bdb383af652b132b55',
      'open', clock_timestamp(), clock_timestamp()
    ) on conflict (id) do nothing;

    insert into public.user_jobs (id, user_id, job_id, status, attempts)
    values (
      '05100000-0000-4000-8000-000000009002'::uuid,
      '05100000-0000-4000-8000-000000009001'::uuid,
      '04020000-0000-4000-8000-000000000020'::uuid,
      'pending', 0
    ) on conflict (id) do nothing;

    insert into public.deterministic_ranking_runs (
      id, user_id, revision, run_kind, captured_titles, captured_locations,
      captured_include_keywords, captured_exclude_keywords,
      captured_title_exclude_keywords, captured_max_required_experience,
      captured_rubric, captured_good_threshold, captured_strong_threshold,
      evaluation_time, expected_job_count, status
    ) values (
      '05100000-0000-4000-8000-000000009003'::uuid,
      '05100000-0000-4000-8000-000000009001'::uuid,
      1, 'new_job', '{}'::text[], '{}'::text[], '{}'::text[], '{}'::text[],
      '{}'::text[], null,
      '{
        "strictTitle":30,"weakTitle":20,"preferredLocation":10,
        "recency":10,"watchlist":10,"experience":20,
        "includeKeywordSteps":{"one":3,"two":5,"three":10,"four":15,"fivePlus":20}
      }'::jsonb,
      50, 75, clock_timestamp(), 1, 'building'
    ) on conflict (id) do nothing;

    insert into public.deterministic_ranking_items (
      id, run_id, user_id, user_job_id, job_id, revision, status, attempts
    ) values (
      '05100000-0000-4000-8000-000000009004'::uuid,
      '05100000-0000-4000-8000-000000009003'::uuid,
      '05100000-0000-4000-8000-000000009001'::uuid,
      '05100000-0000-4000-8000-000000009002'::uuid,
      '04020000-0000-4000-8000-000000000020'::uuid,
      1, 'pending', 0
    ) on conflict (id) do nothing;
  end if;
end;
$$;

drop event trigger if exists phase_051_seed_historical_connector_prerequisites;
create event trigger phase_051_seed_historical_connector_prerequisites
  on ddl_command_end
  execute function public.phase_051_seed_historical_connector_prerequisites();
`

if (!(process.argv.length === 2 || EXPECT_RED)) {
  throw new Error('Only the optional --expect-red argument is accepted')
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const fileSha256 = (path) => sha256(readFileSync(path))

function runProcess(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  })

  if (result.error) {
    throw result.error
  }

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
  }
}

const gitRootResult = runProcess('git', ['rev-parse', '--show-toplevel'])
if (gitRootResult.status !== 0) {
  throw new Error('Unable to resolve the canonical Git repository root')
}
const gitRoot = realpathSync(gitRootResult.stdout.trim())
if (gitRoot !== REPOSITORY_ROOT) {
  throw new Error(
    `Runner must execute from the canonical repository root (${gitRoot})`,
  )
}

const cliResolvedPath = realpathSync(CLI_PATH)
if (!cliResolvedPath.startsWith(`${REPOSITORY_ROOT}${sep}`)) {
  throw new Error('Pinned Supabase CLI resolves outside the repository')
}

const childEnvironment = { ...process.env }
for (const variable of [
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_DB_PASSWORD',
  'SUPABASE_PROJECT_ID',
  'SUPABASE_PROJECT_REF',
]) {
  delete childEnvironment[variable]
}
childEnvironment.SUPABASE_TELEMETRY_DISABLED = '1'
Object.freeze(childEnvironment)

const cliCalls = []
function runCli(args) {
  if (childEnvironment.SUPABASE_TELEMETRY_DISABLED !== '1') {
    throw new Error('Every CLI subprocess must disable Supabase telemetry')
  }
  if (args.some((argument) => /(?:--project-ref|--linked|db\s+push)/i.test(argument))) {
    throw new Error('Hosted or linked Supabase mode is forbidden')
  }

  cliCalls.push([CLI_LITERAL_PATH, ...args])
  const result = runProcess(CLI_PATH, args, { env: childEnvironment })
  if (FORBIDDEN_NETWORK_FALLBACK_OUTPUT.test(result.output)) {
    throw new Error(
      `Supabase CLI attempted a forbidden network fallback: ${sanitize(result.output)}`,
    )
  }
  return result
}

function requireSuccess(result, label) {
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${sanitize(result.output)}`)
  }
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
      const { port } = address
      server.close((error) => error ? reject(error) : resolvePort(port))
    })
  })
}

async function isolatedConfig(projectId) {
  let config = readFileSync(CONFIG_PATH, 'utf8')
  config = config.replace(/^project_id\s*=\s*"[^"]+"/m, `project_id = "${projectId}"`)

  const activePortLines = [...config.matchAll(/^(\s*port\s*=\s*)\d+(\s*)$/gm)]
  const ports = []
  for (let index = 0; index < activePortLines.length + 1; index += 1) {
    ports.push(await allocateLoopbackPort())
  }
  let portIndex = 0
  config = config.replace(
    /^(\s*port\s*=\s*)\d+(\s*)$/gm,
    (_match, prefix, suffix) => `${prefix}${ports[portIndex++]}${suffix}`,
  )
  config = config.replaceAll('127.0.0.1:3000', `127.0.0.1:${ports.at(-1)}`)
  config = config.replace(/^enabled\s*=\s*true$/m, 'enabled = true')
  config = config.replace(
    /\[db\.seed\]([\s\S]*?)(?=\n\[[^\]]+\]|$)/,
    (section) => section.replace(/enabled\s*=\s*true/, 'enabled = false'),
  )
  return config
}

function sanitize(value, temporaryRoot = '') {
  let sanitized = String(value)
  if (temporaryRoot) {
    sanitized = sanitized.replaceAll(temporaryRoot, '{fresh-local-root}')
  }
  sanitized = sanitized
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '{local-postgres-url}')
    .replace(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+[^\s"']*/gi, '{loopback-url}')
    .replace(/(?:127\.0\.0\.1|localhost):\d+/gi, '{loopback-address}')
    .replace(/(?:anon key|service_role key|secret key):\s*\S+/gi, '$1: {redacted}')
    .replace(/eyJ[A-Za-z0-9._-]+/g, '{redacted-jwt}')
    .replace(/job-copilot-05-1-containment-[A-Za-z0-9_-]+/g, '{isolated-project}')
    .replace(/\r\n/g, '\n')
  return sanitized.trim()
}

function validateTemporaryRoot(temporaryRoot) {
  const canonicalRoot = realpathSync(temporaryRoot)
  if (
    dirname(canonicalRoot) !== REPOSITORY_ROOT ||
    !basename(canonicalRoot).startsWith(TEMP_PREFIX)
  ) {
    throw new Error('Refusing to operate on an unvalidated temporary root')
  }
  return canonicalRoot
}

function repositoryMigrationManifest(includeContainment) {
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

  if (includeContainment) {
    const containment = allNames.filter((name) => name.startsWith('0063_'))
    if (containment.length !== 1) {
      throw new Error('Expected exactly one repository migration for 0063')
    }
    selected.push(containment[0])
  }

  if (selected.some((name) => name.startsWith('0062_'))) {
    throw new Error('Migration 0062 must not enter the containment manifest')
  }
  return selected
}

function appliedMigrationNames(output) {
  return [...output.matchAll(/Applying migration\s+([^\s]+\.sql)/g)]
    .map((match) => basename(match[1]))
}

const localImages = REQUIRED_LOCAL_IMAGES.map((image) => {
  const inspectResult = runProcess('docker', [
    'image',
    'inspect',
    '--format',
    '{{.Id}}',
    image,
  ], { env: childEnvironment })
  requireSuccess(
    inspectResult,
    `Required local Docker image ${image}; network fallback is forbidden`,
  )
  return { image, id: inspectResult.stdout.trim() }
})

const versionResult = runCli(['--version'])
requireSuccess(versionResult, 'Pinned Supabase CLI version check')
const cliVersion = versionResult.stdout.trim() || versionResult.stderr.trim()

const temporaryRoot = validateTemporaryRoot(
  mkdtempSync(join(REPOSITORY_ROOT, TEMP_PREFIX)),
)
const projectId = `phase_05_1_containment_${randomBytes(6).toString('hex')}`
const isolatedSupabasePath = join(temporaryRoot, 'supabase')
const isolatedMigrationsPath = join(isolatedSupabasePath, 'migrations')
const isolatedTestsPath = join(isolatedSupabasePath, 'tests')
const manifest = repositoryMigrationManifest(!EXPECT_RED)
const manifestPaths = manifest.map((name) => `supabase/migrations/${name}`)
const sqlTestDestination = join(isolatedTestsPath, basename(SQL_TEST_PATH))
const exclusions = [
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
const commandTemplates = {
  version: [CLI_LITERAL_PATH, '--version'],
  start: [
    CLI_LITERAL_PATH,
    'start',
    '--exclude',
    exclusions.join(','),
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
    '{fresh-local-root}/supabase/tests/0063_dismissal_tombstone_ranking_containment.test.sql',
    '--local',
    '--workdir',
    '{fresh-local-root}',
  ],
  ...(EXPECT_RED ? {} : {
    test_replay: [
      CLI_LITERAL_PATH,
      'test',
      'db',
      '{fresh-local-root}/supabase/tests/0063_dismissal_tombstone_ranking_containment.test.sql',
      '--local',
      '--workdir',
      '{fresh-local-root}',
    ],
  }),
  stop: [
    CLI_LITERAL_PATH,
    'stop',
    '--no-backup',
    '--workdir',
    '{fresh-local-root}',
  ],
}

let primaryError = null
let testOutput = ''
let teardown = 'failed'
let result = EXPECT_RED ? 'failed_to_reach_expected_red' : 'failed'
let redOutputSha256 = EXPECTED_RED_OUTPUT_SHA256

try {
  mkdirSync(isolatedMigrationsPath, { recursive: true })
  mkdirSync(isolatedTestsPath, { recursive: true })
  writeFileSync(
    join(isolatedSupabasePath, 'config.toml'),
    await isolatedConfig(projectId),
    { encoding: 'utf8', mode: 0o600 },
  )
  writeFileSync(
    join(isolatedSupabasePath, 'roles.sql'),
    HISTORICAL_LOCAL_BASELINE_SQL,
    { encoding: 'utf8', mode: 0o600 },
  )
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
    exclusions.join(','),
    '--workdir',
    temporaryRoot,
  ])
  requireSuccess(startResult, 'Isolated local Supabase start')

  const resetResult = runCli([
    'db',
    'reset',
    '--local',
    '--no-seed',
    '--workdir',
    temporaryRoot,
  ])
  requireSuccess(resetResult, 'Isolated local database reset')
  const applied = appliedMigrationNames(resetResult.output)
  if (JSON.stringify(applied) !== JSON.stringify(manifest)) {
    throw new Error(
      `Reset migration report mismatch: ${JSON.stringify(applied)}`,
    )
  }

  const testArguments = [
    'test',
    'db',
    sqlTestDestination,
    '--local',
    '--workdir',
    temporaryRoot,
  ]
  const firstTestResult = runCli(testArguments)
  const firstSanitizedOutput = sanitize(firstTestResult.output, temporaryRoot)

  if (EXPECT_RED) {
    if (
      firstTestResult.status === 0 ||
      !firstSanitizedOutput.includes(EXPECTED_RED_ASSERTION)
    ) {
      throw new Error(
        `Expected the focused tombstone assertion to fail, received: ${firstSanitizedOutput}`,
      )
    }
    testOutput = firstSanitizedOutput
    redOutputSha256 = sha256(firstSanitizedOutput)
    result = 'expected_red'
  } else {
    requireSuccess(firstTestResult, 'First isolated pgTAP invocation')
    const replayTestResult = runCli(testArguments)
    requireSuccess(replayTestResult, 'Rollback replay pgTAP invocation')
    testOutput = [
      firstSanitizedOutput,
      sanitize(replayTestResult.output, temporaryRoot),
    ].join('\n--- rollback replay ---\n')
    result = 'passed'
  }
} catch (error) {
  primaryError = error
} finally {
  try {
    const stopResult = runCli([
      'stop',
      '--no-backup',
      '--workdir',
      temporaryRoot,
    ])
    requireSuccess(stopResult, 'Isolated local Supabase stop')
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
  const message = sanitize(primaryError?.stack ?? primaryError ?? 'Teardown failed', temporaryRoot)
  process.stderr.write(`${JSON.stringify({ result: 'failed', teardown, error: message })}\n`)
  process.exit(1)
}

const canonicalCalls = cliCalls.map((call) => call.map((argument) =>
  argument.replaceAll(temporaryRoot, '{fresh-local-root}')
))
const output = {
  result,
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
    image_preflight_before_first_cli_command: true,
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
    kind: 'synthetic_historical_prerequisites_only',
    sha256: sha256(HISTORICAL_LOCAL_BASELINE_SQL),
    removed_with_disposable_database: true,
  },
  test_output_sha256: sha256(testOutput),
  assertion_groups: [
    'real_enqueue_repeated_tombstone_no_work',
    'real_enqueue_genuine_arrival_full_snapshot',
    'real_0052_finalizer_atomic_publication',
    'post_publication_enqueue_idempotence',
    'owner_source_external_id_isolation',
    'live_catalog_and_acl_contract',
  ],
  synthetic_fixture_rollback: EXPECT_RED ? 'not_applicable_red' : 'passed_by_second_invocation',
  hosted_or_linked_writes: 0,
  red_output_sha256: redOutputSha256,
}

process.stdout.write(`${JSON.stringify(output)}\n`)

import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import {
  APPROVED_ACTIONS,
  DEFAULT_MANIFEST,
  PRIVILEGED_EXECUTABLE_PATHS,
  SAFETY_TEST_PATHS,
  canonical,
  dryRunPlan,
  exactApproval,
  executeRelease,
  sha256,
  validateManifest,
} from './run-phase-03-10-rollout.mjs'

const execFile = promisify(execFileCallback)
const FINAL_MANIFEST =
  '.planning/phases/03.10-goldman-sachs-selective-higher-monitoring/03.10-01-RELEASE-MANIFEST.json'
const PHASE_DIR = dirname(FINAL_MANIFEST)
const MIGRATION =
  'supabase/migrations/0048_phase_03_10_goldman_higher.sql'
const MUTABLE_ARTIFACTS = Object.freeze([
  [
    '.planning/phases/03.10-goldman-sachs-selective-higher-monitoring/03.10-01-ROLLOUT-VERIFICATION.json',
    'scripts/run-phase-03-10-activation.ts',
    ['PENDING', 'PASS', 'UNSUPPORTED'],
  ],
  [
    '.planning/phases/03.10-goldman-sachs-selective-higher-monitoring/03.10-01-ROLLOUT-EVIDENCE.md',
    'scripts/run-phase-03-10-activation.ts',
    ['PENDING', 'PASS', 'UNSUPPORTED'],
  ],
  [
    '.planning/phases/03.10-goldman-sachs-selective-higher-monitoring/03.10-01-HOSTED-VERIFICATION.json',
    'scripts/verify-phase-03-10-hosted.mjs',
    ['PENDING', 'PASS', 'UNSUPPORTED'],
  ],
  [
    '.planning/phases/03.10-goldman-sachs-selective-higher-monitoring/03.10-UAT.md',
    'scripts/verify-phase-03-10-hosted.mjs',
    ['PENDING_OWNER_BROWSER', 'PASS', 'UNSUPPORTED'],
  ],
  [
    '.planning/phases/03.10-goldman-sachs-selective-higher-monitoring/03.10-UAT.json',
    'scripts/verify-phase-03-10-hosted.mjs',
    ['PENDING_OWNER_BROWSER', 'PASS', 'UNSUPPORTED'],
  ],
])
const FUNCTION_FILES = Object.freeze({
  'verify-board': Object.freeze([
    'supabase/functions/_shared/frozen-runtime.ts',
    'supabase/functions/verify-board/index.ts',
  ]),
  'observe-connectors': Object.freeze([
    'supabase/functions/_shared/frozen-runtime.ts',
    'supabase/functions/observe-connectors/index.ts',
  ]),
  'poll-tick': Object.freeze([
    'supabase/functions/_shared/frozen-runtime.ts',
    'supabase/functions/poll-tick/index.ts',
  ]),
})
const FINAL_MANIFEST_AT_LOAD = await readFile(FINAL_MANIFEST)
const APPROVAL_ARTIFACTS_AT_LOAD = (await readdir(PHASE_DIR))
  .filter((name) => /approval/i.test(name))
  .sort()

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function git(root, args) {
  const { stdout } = await execFile('git', args, { cwd: root })
  return stdout.trim()
}

async function write(root, path, value) {
  const absolute = join(root, path)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, value)
}

async function committedEntry(root, sourceCommit, path, current = true) {
  const bytes = current
    ? await readFile(join(root, path))
    : Buffer.from(await git(root, ['show', `${sourceCommit}:${path}`]))
  return {
    path,
    git_object: await git(root, ['rev-parse', `${sourceCommit}:${path}`]),
    sha256: digest(bytes),
  }
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right))
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'phase-03-10-rollout-'))
  const immutablePaths = new Set([
    ...PRIVILEGED_EXECUTABLE_PATHS,
    ...SAFETY_TEST_PATHS,
    MIGRATION,
    ...Object.values(FUNCTION_FILES).flat(),
  ])
  const allPaths = new Set([
    ...immutablePaths,
    ...MUTABLE_ARTIFACTS.map(([path]) => path),
  ])
  for (const path of allPaths) {
    await write(root, path, `fixture bytes for ${path}\n`)
  }
  await git(root, ['init', '-q'])
  await git(root, ['config', 'user.email', 'fixture@example.invalid'])
  await git(root, ['config', 'user.name', 'Fixture'])
  await git(root, ['add', ...sorted(allPaths)])
  await git(root, ['commit', '-qm', 'fixture source'])
  const sourceCommit = await git(root, ['rev-parse', 'HEAD'])

  const immutable_source = []
  for (const path of sorted(immutablePaths)) {
    immutable_source.push(await committedEntry(root, sourceCommit, path))
  }
  const byPath = new Map(immutable_source.map((entry) => [entry.path, entry]))
  const functions = {}
  for (const slug of ['verify-board', 'observe-connectors', 'poll-tick']) {
    const bundle_files = [...FUNCTION_FILES[slug]]
    const entry_path = `supabase/functions/${slug}/index.ts`
    functions[slug] = {
      entry_path,
      entry_git_object: byPath.get(entry_path).git_object,
      entry_sha256: byPath.get(entry_path).sha256,
      bundle_files,
      bundle_sha256: digest(canonical(
        bundle_files.map((path) => [path, byPath.get(path).sha256]),
      )),
      verify_jwt: slug === 'verify-board',
    }
  }
  const mutable_artifacts = []
  for (const [path, writer, transitions] of MUTABLE_ARTIFACTS) {
    const entry = await committedEntry(root, sourceCommit, path)
    mutable_artifacts.push({
      path,
      git_object: entry.git_object,
      initial_sha256: entry.sha256,
      initial_status: path.endsWith('UAT.md') || path.endsWith('UAT.json')
        ? 'PENDING_OWNER_BROWSER'
        : 'PENDING',
      allowed_writer: writer,
      allowed_transitions: transitions,
    })
  }
  mutable_artifacts.sort((left, right) => left.path.localeCompare(right.path))

  const manifest = {
    schema_version: 1,
    phase: '03.10',
    created_at: '2026-07-27T16:00:00.000Z',
    release_manifest_id: randomUUID(),
    project_ref: 'fjcsvajkkztvlrpdplwx',
    source_key: 'goldman_higher:roles',
    public_url: 'https://higher.gs.com/results',
    source_commit: sourceCommit,
    source_commit_object: await git(root, ['rev-parse', `${sourceCommit}^{commit}`]),
    hosted_baseline: {
      first_migration: '0001',
      last_migration: '0047',
      migration_count: 47,
      catalog_fingerprint: digest('catalog'),
      company_fingerprint: digest('company'),
      terminal_fingerprint: digest('terminal'),
    },
    migration: {
      version: '0048',
      ...byPath.get(MIGRATION),
    },
    functions,
    privileged_executables: PRIVILEGED_EXECUTABLE_PATHS.map((path) =>
      byPath.get(path)
    ),
    safety_tests: SAFETY_TEST_PATHS.map((path) => byPath.get(path)),
    immutable_source,
    mutable_artifacts,
    web_deployment: {
      unchanged: true,
      source_commit: digest('web-commit').slice(0, 40),
      deployment_id: 'unchanged-phase-03-10',
      asset_sha256: digest('web-asset'),
    },
    scope: {
      country: 'US',
      recent_hours: 168,
      populations: ['EARLY_CAREER', 'PROFESSIONAL'],
      category_terms: [
        'Data',
        'Technology',
        'Finance',
        'Investment',
        'Research',
        'Risk',
        'Capital Markets',
      ],
      allow_missing_closure: false,
    },
    terminal: {
      outcomes: ['positive', 'unsupported'],
      exactly_one: true,
      max_accepted_observations: 3,
      fourth_invocation_allowed: false,
      later_scheduler_owned_natural_poll: true,
      qualifying_persisted_role_required_for_positive: true,
    },
    protected_snapshot: {
      scope_complete: true,
      protected_sources: [
        'eightfold:morganstanley',
        'oracle:jpmc:CX_1001',
        'paylocity:schwab',
        'workday:wd12:capitalone:Capital_One',
        'workday:wd1:fmr:FidelityCareers',
      ],
      source_count: 5,
      catalog_fingerprint: digest('protected-catalog'),
      company_fingerprint: digest('protected-company'),
      job_fingerprint: digest('protected-job'),
      user_fingerprint: digest('protected-user'),
      cron_fingerprint: digest('protected-cron'),
      function_fingerprint: digest('protected-functions'),
      scheduler_excluded_fields: [
        'companies.consecutive_failures',
        'companies.last_error',
        'companies.last_error_code',
        'companies.last_observation_count',
        'companies.last_polled_at',
        'companies.last_success_at',
        'companies.next_poll_at',
        'pipeline_heartbeat.last_success_at',
        'pipeline_heartbeat.last_tick_at',
      ],
    },
    cleanup: {
      namespace: 'phase-03-10-goldman-verifier',
      verifier_ids: [randomUUID(), randomUUID()],
      on_exit: [
        'success',
        'unsupported',
        'error',
        'timeout',
        'assertion_failure',
        'artifact_write_failure',
      ],
      zero_residue_required: true,
    },
    acl: {
      service_role_only: [
        'finalize_goldman_higher_candidate',
        'record_connector_observation',
        'claim_due_experimental_connectors',
        'claim_due_companies',
      ],
      denied_roles: ['public', 'anon', 'authenticated'],
    },
    redaction: {
      credentials_source: 'environment_only',
      recursive: true,
      secret_environment_variables: [
        'CRON_SECRET',
        'SUPABASE_ACCESS_TOKEN',
        'SUPABASE_SERVICE_ROLE_KEY',
      ],
      outputs: ['errors', 'logs', 'json', 'markdown', 'nested_causes'],
    },
    uat: {
      status: 'PENDING_OWNER_BROWSER',
      owner_browser_required: true,
      codex_browser_used: false,
      owner_attestation: null,
      checks: [
        'watchlist_identity',
        'active_or_unsupported_outcome',
        'qualifying_job_detail',
        'working_apply_link',
      ],
    },
    approval_contract: {
      algorithm: 'sha256',
      release_prefix: 'approve Phase 03.10 Goldman rollout',
      uat_prefix: 'approve Phase 03.10 Goldman UAT',
      production_release: false,
    },
    approved_actions: [...APPROVED_ACTIONS],
  }
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
  const hashes = await validateManifest(manifest, bytes, { root })
  return {
    root,
    manifest,
    bytes,
    hashes,
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

async function withFixture(callback) {
  const fixture = await createFixture()
  try {
    await callback(fixture)
  } finally {
    await fixture.cleanup()
  }
}

function clone(value) {
  return structuredClone(value)
}

async function validateChanged(fixture, mutate) {
  const manifest = clone(fixture.manifest)
  mutate(manifest)
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
  return validateManifest(manifest, bytes, { root: fixture.root })
}

test('exports the frozen tracked manifest path without mutating it', async () => {
  assert.equal(DEFAULT_MANIFEST, FINAL_MANIFEST)
  assert.equal(
    await git(process.cwd(), [
      'ls-files',
      '--full-name',
      '--error-unmatch',
      FINAL_MANIFEST,
    ]),
    FINAL_MANIFEST,
  )

  const manifest = JSON.parse(FINAL_MANIFEST_AT_LOAD)
  assert.equal(manifest.phase, '03.10')
  assert.match(manifest.release_manifest_id, /^[0-9a-f-]{36}$/)
  assert.match(manifest.source_commit, /^[0-9a-f]{40}$/)
  assert.ok(
    manifest.safety_tests.some(({ path }) =>
      path === 'scripts/run-phase-03-10-rollout.test.mjs'
    ),
  )
})

test('dry run validates final bytes, emits derived approval, and runs zero commands', async () => {
  await withFixture(async ({ manifest, hashes }) => {
    let calls = 0
    const plan = dryRunPlan(manifest, hashes, () => {
      calls += 1
    })
    assert.equal(plan.status, 'PENDING_EXPLICIT_APPROVAL')
    assert.equal(plan.required_approval, exactApproval(manifest, hashes))
    assert.deepEqual(plan.actions, APPROVED_ACTIONS)
    assert.equal(plan.production_fixture, false)
    assert.equal(calls, 0)
  })
})

test('non-exact approval rejects before the first command', async () => {
  await withFixture(async ({ root, manifest, hashes }) => {
    const calls = []
    await assert.rejects(
      executeRelease(
        manifest,
        `${exactApproval(manifest, hashes)} `,
        hashes,
        async (args) => calls.push(args),
        {
          root,
          environment: { SUPABASE_ACCESS_TOKEN: 'TEST_ONLY_NON_PRODUCTION' },
        },
      ),
      /exact manifest-derived approval/,
    )
    assert.deepEqual(calls, [])
  })
})

test('exact approval runs one schema push and only the three listed functions', async () => {
  await withFixture(async ({ root, manifest, hashes }) => {
    const calls = []
    const result = await executeRelease(
      manifest,
      exactApproval(manifest, hashes),
      hashes,
      async (args) => {
        calls.push(args)
        return { stdout: '', stderr: '' }
      },
      {
        root,
        environment: { SUPABASE_ACCESS_TOKEN: 'TEST_ONLY_NON_PRODUCTION' },
      },
    )
    assert.equal(result.status, 'DEPLOYED_PENDING_ACTIVATION')
    assert.deepEqual(calls, [
      ['db', 'push', '--linked', '--yes'],
      [
        'functions',
        'deploy',
        'verify-board',
        '--project-ref',
        manifest.project_ref,
        '--verify-jwt',
      ],
      [
        'functions',
        'deploy',
        'observe-connectors',
        '--project-ref',
        manifest.project_ref,
        '--no-verify-jwt',
      ],
      [
        'functions',
        'deploy',
        'poll-tick',
        '--project-ref',
        manifest.project_ref,
        '--no-verify-jwt',
      ],
    ])
  })
})

test('source, byte, target, baseline, action, and function drift fail closed', async () => {
  await withFixture(async (fixture) => {
    const cases = [
      ['source', (manifest) => { manifest.source_commit = '0'.repeat(40) }],
      ['target', (manifest) => { manifest.project_ref = 'wrong-project' }],
      ['baseline', (manifest) => { manifest.hosted_baseline.last_migration = '0048' }],
      ['action', (manifest) => { manifest.approved_actions.push('extra_action') }],
      ['function', (manifest) => { manifest.functions['extra-function'] = manifest.functions['poll-tick'] }],
      ['file', (manifest) => { manifest.immutable_source.push(manifest.immutable_source[0]) }],
    ]
    for (const [name, mutate] of cases) {
      await assert.rejects(
        validateChanged(fixture, mutate),
        undefined,
        `${name} drift must reject`,
      )
    }

    const changedBytes = Buffer.from(
      fixture.bytes.toString().replace(
        '2026-07-27T16:00:00.000Z',
        '2026-07-27T16:00:01.000Z',
      ),
    )
    await assert.rejects(
      validateManifest(fixture.manifest, changedBytes, { root: fixture.root }),
      /manifest bytes do not match supplied object/,
    )
  })
})

test('migration, entry, bundle, executable, and safety-test drift fail closed', async () => {
  await withFixture(async (fixture) => {
    const driftPaths = [
      MIGRATION,
      'supabase/functions/verify-board/index.ts',
      'supabase/functions/_shared/frozen-runtime.ts',
      PRIVILEGED_EXECUTABLE_PATHS[0],
      SAFETY_TEST_PATHS[0],
    ]
    for (const path of driftPaths) {
      const original = await readFile(join(fixture.root, path))
      await write(fixture.root, path, Buffer.concat([original, Buffer.from('drift')]))
      await assert.rejects(
        validateManifest(fixture.manifest, fixture.bytes, {
          root: fixture.root,
        }),
        /hash drift/,
        `${path} drift must reject`,
      )
      await write(fixture.root, path, original)
    }
  })
})

test('post-approval state drift rejects before the first command', async () => {
  await withFixture(async ({ root, manifest, bytes, hashes }) => {
    const calls = []
    const path = PRIVILEGED_EXECUTABLE_PATHS[0]
    const original = await readFile(join(root, path))
    await write(root, path, Buffer.concat([original, Buffer.from('drift')]))
    await assert.rejects(
      executeRelease(
        manifest,
        exactApproval(manifest, hashes),
        hashes,
        async (args) => calls.push(args),
        {
          root,
          environment: { SUPABASE_ACCESS_TOKEN: 'TEST_ONLY_NON_PRODUCTION' },
        },
      ),
      /current hash drift/,
    )
    assert.deepEqual(calls, [])
    await write(root, path, original)

    const changed = clone(manifest)
    changed.hosted_baseline.last_migration = '0048'
    await assert.rejects(
      executeRelease(
        changed,
        exactApproval(manifest, hashes),
        hashes,
        async (args) => calls.push(args),
        {
          root,
          environment: { SUPABASE_ACCESS_TOKEN: 'TEST_ONLY_NON_PRODUCTION' },
        },
      ),
      /manifest bytes do not match supplied object/,
    )
    assert.deepEqual(calls, [])
    assert.ok(bytes.length > 0)
  })
})

test('missing executable/test and protected, cleanup, ACL, redaction, or UAT drift reject', async () => {
  await withFixture(async (fixture) => {
    const cases = [
      (manifest) => { manifest.privileged_executables.pop() },
      (manifest) => { manifest.safety_tests.pop() },
      (manifest) => { manifest.protected_snapshot.scope_complete = false },
      (manifest) => { manifest.protected_snapshot.scheduler_excluded_fields.push('jobs.status') },
      (manifest) => { manifest.cleanup.on_exit.pop() },
      (manifest) => { manifest.acl.denied_roles.pop() },
      (manifest) => { manifest.redaction.outputs.pop() },
      (manifest) => { manifest.uat.codex_browser_used = true },
    ]
    for (const mutate of cases) {
      await assert.rejects(validateChanged(fixture, mutate))
    }
  })
})

test('approval is invalidated by any valid manifest-byte change', async () => {
  await withFixture(async (fixture) => {
    const priorApproval = exactApproval(fixture.manifest, fixture.hashes)
    const changed = clone(fixture.manifest)
    changed.created_at = '2026-07-27T16:00:01.000Z'
    const bytes = Buffer.from(`${JSON.stringify(changed, null, 2)}\n`)
    const hashes = await validateManifest(changed, bytes, { root: fixture.root })
    assert.notEqual(exactApproval(changed, hashes), priorApproval)
  })
})

test('tests leave the frozen manifest unchanged and no reusable approval artifact', async () => {
  assert.deepEqual(await readFile(FINAL_MANIFEST), FINAL_MANIFEST_AT_LOAD)
  assert.deepEqual(
    (await readdir(PHASE_DIR))
      .filter((name) => /approval/i.test(name))
      .sort(),
    APPROVAL_ARTIFACTS_AT_LOAD,
  )
})

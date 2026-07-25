import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  assertUnrelatedSnapshotUnchanged,
  cleanupFixtures,
  deleteSubjectsExactly,
  commandBytes,
  expectedHostedMigrationVersions,
  fixtureIds,
  fixtureSql,
  formatVerificationError,
  pageBody,
  passCheck,
  requirePassChecks,
  sha256,
  uuidV5,
  validateManifest,
  verifyBoardFailureMessage,
  waitForFixtureWindow,
} from './verify-phase-03-6-hosted.mjs'

const manifestPath = new URL(
  '../.planning/phases/03.6-us-only-workday-expansion-nasdaq-s-p-global-morningstar-stat/03.6-04-RELEASE-MANIFEST.json',
  import.meta.url,
)

test('manifest stays strict and exact-release bound', async () => {
  const manifest = validateManifest(JSON.parse(await readFile(manifestPath, 'utf8')))
  assert.equal(manifest.candidate.git_sha, '0e24023b09771144e3b6c3374cdbc7d65ea0c947')
  assert.equal(manifest.sources.length, 4)
  assert.equal(manifest.verifier.subject_count, 2)
  assert.equal(manifest.verifier.fixture_ceilings.jobs, 405)
  assert.equal(manifest.verifier.fixture_ceilings.user_jobs, 810)
})

test('lifecycle grant inventory expects exact hosted parity after one migration', async () => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const validated = validateManifest(manifest)
  assert.deepEqual(validated.migration.proposed, ['0039'])
  assert.equal(validated.targets.supabase.remote_migrations.at(-1), '0038')
  assert.deepEqual(expectedHostedMigrationVersions(validated), [
    ...validated.targets.supabase.remote_migrations,
    '0039',
  ])
})

test('fixture creation waits for a bounded post-maintenance server window', async () => {
  const calls = []
  const seconds = [58, 10]
  const result = await waitForFixtureWindow(
    { targets: { supabase: { project_ref: 'exact-project' } } },
    {
      sql: async (projectRef, statement) => {
        calls.push({ projectRef, statement })
        return [{ server_second: seconds.shift() }]
      },
      sleep: async (ms) => calls.push({ sleep: ms }),
    },
  )
  assert.deepEqual(result, { server_second: 10, attempt: 2 })
  assert.equal(calls[0].projectRef, 'exact-project')
  assert.match(calls[0].statement, /clock_timestamp/)
  assert.deepEqual(calls[1], { sleep: 12_000 })
})

test('binary command output preserves raw trailing commit-object bytes', async () => {
  const output = await commandBytes(process.cwd(), process.execPath, [
    '-e',
    'process.stdout.write(Buffer.from([65, 10]))',
  ])
  assert.ok(Buffer.isBuffer(output))
  assert.deepEqual([...output], [65, 10])
  assert.equal(
    sha256(output),
    sha256(Buffer.from([65, 10])),
  )
  assert.notEqual(sha256(output), sha256(output.toString('utf8').trim()))
})

test('UUID-v5 fixture ranges are deterministic, unique, and versioned', async () => {
  const manifest = validateManifest(JSON.parse(await readFile(manifestPath, 'utf8')))
  const ids = fixtureIds(manifest)
  assert.equal(ids.jobs.length, 405)
  assert.equal(ids.userJobs.flat().length, 810)
  assert.equal(new Set([...ids.jobs, ...ids.userJobs.flat()]).size, 1_215)
  assert.match(ids.jobs[0], /^[0-9a-f-]{14}5[0-9a-f-]{21}$/)
  assert.equal(
    ids.jobs[0],
    uuidV5(manifest.verifier.fixture_namespace_uuid, 'job:000'),
  )
})

test('fixture SQL is exact-owner tagged and ceiling bounded', async () => {
  const manifest = validateManifest(JSON.parse(await readFile(manifestPath, 'utf8')))
  const ids = fixtureIds(manifest)
  const subjects = [
    { id: '11111111-1111-4111-8111-111111111111' },
    { id: '22222222-2222-4222-8222-222222222222' },
  ]
  const sql = fixtureSql(manifest, subjects, ids)
  assert.ok(sql.includes(manifest.verifier.run_namespace))
  assert.ok(sql.includes(ids.jobs.at(-1)))
  assert.ok(sql.includes(ids.userJobs[1].at(-1)))
  assert.equal((sql.match(/Phase 03\.6 Queue Fixture/g) ?? []).length, 405)
  assert.equal((sql.match(/::jsonb/g) ?? []).length, 810)
  assert.equal(sha256(sql), sha256(fixtureSql(manifest, subjects, ids)))
})

test('page requests retain exact query signature and finite limits', () => {
  const first = pageBody('run:active:newest')
  assert.equal(first.p_limit, 200)
  assert.equal(first.p_cursor, null)
  assert.deepEqual(first.p_tiers, ['Strong', 'Good', 'Weak'])
  const backfill = pageBody('run:active:newest', { v: 1 }, 1)
  assert.equal(backfill.p_limit, 1)
  assert.deepEqual(backfill.p_cursor, { v: 1 })
})

test('PASS evidence requires every named check and exact cleanup counts', () => {
  const names = [
    'release_identity',
    'migration_parity',
    'verify_board_bundle',
    'poll_tick_bundle',
    'web_asset',
    'four_source_scope',
    'source_activation_isolation',
    'closure_safety',
    'existing_source_regressions',
    'two_user_rls',
    'lifecycle_mutual_exclusion',
    'shared_jobs_unchanged',
    'page_one_200',
    'page_two_200',
    'cursor_stability',
    'cursor_rejection',
    'single_row_backfill',
    'backfill_retry',
    'final_partial_caught_up',
    'fixture_cleanup',
  ]
  const document = {
    status: 'PASS',
    checks: Object.fromEntries(names.map((name) => [name, { status: 'PASS' }])),
    counts: { subjects: 2, page_one: 200, page_two: 200, remaining_fixtures: 0 },
  }
  assert.doesNotThrow(() => requirePassChecks(document))
  document.checks.fixture_cleanup.status = 'FAIL'
  assert.throws(() => requirePassChecks(document), /fixture_cleanup is not PASS/)
})

test('PASS wrapper cannot be overwritten by hosted ACTIVE metadata', () => {
  assert.deepEqual(
    passCheck({ status: 'ACTIVE', version: 27 }),
    { status: 'PASS', hosted_status: 'ACTIVE', version: 27 },
  )
})

test('AggregateError diagnostics are bounded, cause-aware, and secret-redacted', () => {
  const token = 'eyJhbGciOiJIUzI1NiJ9.secret-signature.payload'
  const error = new AggregateError([
    new Error(`provider failed with authorization: Bearer ${token}`),
    new Error(`cleanup rejected {"access_token":"${token}"}`),
  ], 'hosted verification and guarded cleanup both failed')
  const detail = formatVerificationError(error)
  assert.match(detail, /hosted verification and guarded cleanup both failed/)
  assert.match(detail, /provider failed/)
  assert.match(detail, /cleanup rejected/)
  assert.ok(!detail.includes(token))
  assert.ok(detail.length <= 1_200)
})

test('verify-board failure diagnostics identify bounded stage and reason without secrets', () => {
  assert.equal(
    verifyBoardFailureMessage('S&P Global', 'authenticated', 'error'),
    'S&P Global exact live verification failed closed (stage=authenticated, reason=error)',
  )
  const unsafe = verifyBoardFailureMessage(
    `Nasdaq\n${'x'.repeat(200)}`,
    'Bearer secret-token',
    'access_token=secret-token',
  )
  assert.ok(!unsafe.includes('secret-token'))
  assert.ok(!unsafe.includes('\n'))
  assert.ok(unsafe.length <= 160)
})

test('snapshot comparison is skipped when release identity failed before baseline', () => {
  assert.equal(assertUnrelatedSnapshotUnchanged(undefined, undefined), null)
  assert.deepEqual(
    assertUnrelatedSnapshotUnchanged(
      { sha256: 'a'.repeat(64) },
      { sha256: 'a'.repeat(64) },
    ),
    { before: 'a'.repeat(64), after: 'a'.repeat(64) },
  )
  assert.throws(
    () => assertUnrelatedSnapshotUnchanged(
      { sha256: 'a'.repeat(64) },
      { sha256: 'b'.repeat(64) },
    ),
    /unrelated production snapshot changed/,
  )
})

test('exact-subject deletion retries are bounded and continue in reverse order', async () => {
  const first = { id: '11111111-1111-4111-8111-111111111111' }
  const second = { id: '22222222-2222-4222-8222-222222222222' }
  const calls = []
  const attempts = new Map()
  const results = await deleteSubjectsExactly([first, second], {
    deleteSubject: async (subject) => {
      calls.push(subject.id)
      const attempt = (attempts.get(subject.id) ?? 0) + 1
      attempts.set(subject.id, attempt)
      if (subject.id === second.id || attempt === 1) throw new Error('delete failed')
    },
    sleep: async () => {},
  })
  assert.deepEqual(calls, [second.id, second.id, second.id, first.id, first.id])
  assert.deepEqual(
    results.map(({ id, attempts: count, status }) => ({ id, attempts: count, status })),
    [
      { id: second.id, attempts: 3, status: 'failed' },
      { id: first.id, attempts: 2, status: 'deleted' },
    ],
  )
})

test('guarded cleanup continues exact SQL cleanup after auth deletion exhausts retries', async () => {
  const subject = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'phase-03-6-exact+subject-1@example.invalid',
  }
  const sqlCalls = []
  let deletes = 0
  const result = await cleanupFixtures(
    {
      targets: { supabase: { project_ref: 'exact-project' } },
      verifier: {
        run_namespace: 'phase-03-6-exact',
        subjects: [{ label: 'subject-1', email: subject.email }],
      },
    },
    [subject],
    {
      jobs: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
      userJobs: [['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']],
    },
    {
      deleteSubject: async () => {
        deletes += 1
        throw new Error('authorization: Bearer never-print-this')
      },
      sleep: async () => {},
      sql: async (projectRef, statement) => {
        sqlCalls.push({ projectRef, statement })
        if (sqlCalls.length === 2) {
          return [{ id: subject.id, email: subject.email }]
        }
        return sqlCalls.length < 3
          ? []
          : [{ users: 0, jobs: 0, user_jobs: 0, ranking_states: 0 }]
      },
    },
  )
  assert.equal(deletes, 3)
  assert.equal(sqlCalls.length, 3)
  assert.ok(sqlCalls.every(({ projectRef }) => projectRef === 'exact-project'))
  assert.match(sqlCalls[0].statement, /update public\.jobs/)
  assert.match(sqlCalls[0].statement, /delete from public\.deterministic_ranking_items/)
  assert.match(sqlCalls[0].statement, /aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/)
  assert.match(sqlCalls[1].statement, /11111111-1111-4111-8111-111111111111/)
  assert.match(sqlCalls[1].statement, /phase-03-6-exact\+subject-1@example\.invalid/)
  assert.match(sqlCalls[2].statement, /phase-03-6-exact/)
  assert.equal(result.subjectDeletions[0].status, 'deleted_sql_fallback')
  assert.deepEqual(result.residue, {
    users: 0,
    jobs: 0,
    user_jobs: 0,
    ranking_states: 0,
  })
})

test('management SQL subject fallback requires the exact returned UUID and email', async () => {
  const subject = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'phase-03-6-exact+subject-1@example.invalid',
  }
  const sqlCalls = []
  await assert.rejects(
    cleanupFixtures(
      {
        targets: { supabase: { project_ref: 'exact-project' } },
        verifier: {
          run_namespace: 'phase-03-6-exact',
          subjects: [{ label: 'subject-1', email: subject.email }],
        },
      },
      [subject],
      {
        jobs: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
        userJobs: [['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']],
      },
      {
        deleteSubject: async () => {
          throw new Error('bad_jwt')
        },
        sleep: async () => {},
        sql: async (_projectRef, statement) => {
          sqlCalls.push(statement)
          if (sqlCalls.length === 2) {
            return [{ id: subject.id, email: 'wrong@example.invalid' }]
          }
          return sqlCalls.length < 3
            ? []
            : [{ users: 0, jobs: 0, user_jobs: 0, ranking_states: 0 }]
        },
      },
    ),
    (error) => (
      error instanceof AggregateError
      && /guarded cleanup failed/.test(error.message)
    ),
  )
  assert.equal(sqlCalls.length, 3)
  assert.match(sqlCalls[0], /delete from public\.jobs/)
  assert.match(sqlCalls[1], /11111111-1111-4111-8111-111111111111/)
  assert.match(sqlCalls[2], /select count\(\*\)::integer from auth\.users/)
})

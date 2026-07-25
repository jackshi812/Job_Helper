import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  fixtureIds,
  fixtureSql,
  pageBody,
  requirePassChecks,
  sha256,
  uuidV5,
  validateManifest,
} from './verify-phase-03-6-hosted.mjs'

const manifestPath = new URL(
  '../.planning/phases/03.6-us-only-workday-expansion-nasdaq-s-p-global-morningstar-stat/03.6-04-RELEASE-MANIFEST.json',
  import.meta.url,
)

test('manifest stays strict and exact-release bound', async () => {
  const manifest = validateManifest(JSON.parse(await readFile(manifestPath, 'utf8')))
  assert.equal(manifest.candidate.git_sha, '9a8a11457b4e7b2113a51ed2e39698393ed877fe')
  assert.equal(manifest.sources.length, 4)
  assert.equal(manifest.verifier.subject_count, 2)
  assert.equal(manifest.verifier.fixture_ceilings.jobs, 405)
  assert.equal(manifest.verifier.fixture_ceilings.user_jobs, 810)
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

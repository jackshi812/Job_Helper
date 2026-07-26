import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  REQUIRED_HOSTED_CHECKS,
  assertHostedEvidence,
  assertRolloutEvidence,
  canonical,
  guardedExercise,
  requireTerminalVerifierState,
  sha256,
  validateManifest,
  validateTimestampChain,
} from './verify-phase-03-8-hosted.mjs'

const manifestPath = new URL(
  '../.planning/phases/03.8-monitor-and-poll-the-branded-banking-companies-currently-on-/03.8-05-RELEASE-MANIFEST.json',
  import.meta.url,
)

async function manifestFixture() {
  return JSON.parse(await readFile(manifestPath, 'utf8'))
}

function clone(value) {
  return structuredClone(value)
}

test('the exact checked-in release manifest is schema-valid and secret-free', async () => {
  const manifest = await manifestFixture()
  assert.equal(validateManifest(manifest), manifest)
  assert.equal(manifest.phase, '03.8')
  assert.equal(manifest.release_manifest_id, '03850000-0000-4000-8000-000000000005')
  assert.equal(manifest.verifier.run_id, '03850000-0000-4000-8000-000000000501')
  assert.equal(manifest.verifier.fixtures.length, 3)
  assert.deepEqual(
    manifest.verifier.faults,
    [
      'incomplete_observation',
      'provider_schema_error',
      'provider_timeout',
      'clean_recovery',
    ],
  )
})

test('manifest validation rejects missing/extra keys, secrets, aliases, drift, and unbounded scope', async () => {
  const cases = []
  const missing = clone(await manifestFixture())
  delete missing.functions
  cases.push(missing)
  const extra = clone(await manifestFixture())
  extra.unapproved = true
  cases.push(extra)
  const secret = clone(await manifestFixture())
  secret.targets.supabase.service_role_key = 'never'
  cases.push(secret)
  const alias = clone(await manifestFixture())
  alias.web.immutable_url = 'https://job-helper-qs9.pages.dev'
  cases.push(alias)
  const mutableCommit = clone(await manifestFixture())
  mutableCommit.candidate.git_sha = 'main'
  cases.push(mutableCommit)
  const tooLong = clone(await manifestFixture())
  tooLong.verifier.limits.expires_minutes = 21
  cases.push(tooLong)
  const tooManyCalls = clone(await manifestFixture())
  tooManyCalls.verifier.limits.exercise_calls = 13
  cases.push(tooManyCalls)
  const rosterDrift = clone(await manifestFixture())
  rosterDrift.catalog.initial.pop()
  cases.push(rosterDrift)
  const nonFrozen = clone(await manifestFixture())
  nonFrozen.candidates[0].company = 'Example Bank'
  cases.push(nonFrozen)

  for (const candidate of cases) {
    assert.throws(() => validateManifest(candidate))
  }
})

test('unknown run/fixture/fault and stale versions fail before mutation', async () => {
  const manifest = await manifestFixture()
  const state = {
    run_id: manifest.verifier.run_id,
    fixture: 'eightfold_fixture',
    fixture_version: 2,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    exercise_calls: 1,
  }
  const invalid = [
    { ...state, run_id: '00000000-0000-4000-8000-000000000000' },
    { ...state, fixture: 'real_company' },
    { ...state, fault: 'fetch_url' },
    { ...state, expected_version: 1 },
  ]

  for (const request of invalid) {
    let mutations = 0
    await assert.rejects(() => guardedExercise(
      manifest,
      {
        run_id: request.run_id,
        fixture: request.fixture,
        fault: request.fault ?? 'provider_timeout',
        expected_version: request.expected_version ?? 2,
      },
      state,
      async () => { mutations += 1 },
    ))
    assert.equal(mutations, 0)
  }
})

test('a valid fixed fault performs exactly one delegated mutation', async () => {
  const manifest = await manifestFixture()
  const state = {
    run_id: manifest.verifier.run_id,
    fixture: 'eightfold_fixture',
    fixture_version: 2,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    exercise_calls: 1,
  }
  let mutations = 0
  const result = await guardedExercise(
    manifest,
    {
      run_id: state.run_id,
      fixture: state.fixture,
      fault: 'clean_recovery',
      expected_version: 2,
    },
    state,
    async () => {
      mutations += 1
      return { fixture_version: 3, job_status: 'open', health: 'healthy' }
    },
  )
  assert.equal(mutations, 1)
  assert.equal(result.fixture_version, 3)
})

test('hosted evidence cannot pass from arbitrary nonempty or prefilled sections', async () => {
  const manifest = await manifestFixture()
  assert.throws(() => assertHostedEvidence({ status: 'PASS' }, manifest))
  const evidence = {
    schema_version: 1,
    phase: '03.8',
    status: 'PASS',
    manifest_sha256: sha256(Buffer.from(JSON.stringify(manifest))),
    generated_at: '2026-07-26T03:00:00Z',
    checks: Object.fromEntries(REQUIRED_HOSTED_CHECKS.map((name) => [
      name,
      { status: 'PENDING' },
    ])),
    family_rollout: {
      eightfold: { status: 'PENDING' },
      oracle_recruiting: { status: 'PENDING' },
      goldman_higher: { status: 'PENDING' },
    },
    verifier_authority: { status: 'ARMED' },
    cleanup: { status: 'PENDING' },
    uat: { status: 'PENDING' },
  }
  assert.throws(() => assertHostedEvidence(evidence, manifest))
})

test('timestamp chains reject reordering and more than fifteen minutes', () => {
  const due = '2026-07-26T03:00:00Z'
  assert.doesNotThrow(() => validateTimestampChain({
    due_at: due,
    claimed_at: '2026-07-26T03:01:00Z',
    completed_at: '2026-07-26T03:05:00Z',
    feed_visible_at: '2026-07-26T03:14:59Z',
  }, 900_000))
  assert.throws(() => validateTimestampChain({
    due_at: due,
    claimed_at: '2026-07-26T02:59:59Z',
    completed_at: '2026-07-26T03:05:00Z',
    feed_visible_at: '2026-07-26T03:10:00Z',
  }, 900_000))
  assert.throws(() => validateTimestampChain({
    due_at: due,
    claimed_at: '2026-07-26T03:01:00Z',
    completed_at: '2026-07-26T03:05:00Z',
    feed_visible_at: '2026-07-26T03:15:01Z',
  }, 900_000))
})

test('rollout PASS requires cleanup success, consumed authority, zero residue, and no grants', async () => {
  const manifest = await manifestFixture()
  const terminal = {
    run_rows: 0,
    fixture_rows: 0,
    company_rows: 0,
    job_rows: 0,
    observation_rows: 0,
    authority_state: 'consumed',
    begin_execute: false,
    exercise_execute: false,
    finish_execute: false,
    post_finish_denied: true,
  }
  assert.doesNotThrow(() => requireTerminalVerifierState(terminal))
  for (const [key, value] of [
    ['run_rows', 1],
    ['fixture_rows', 1],
    ['company_rows', 1],
    ['job_rows', 1],
    ['observation_rows', 1],
    ['begin_execute', true],
    ['exercise_execute', true],
    ['finish_execute', true],
    ['post_finish_denied', false],
  ]) {
    assert.throws(() => requireTerminalVerifierState({ ...terminal, [key]: value }))
  }

  const rollout = {
    status: 'PASS',
    manifest_sha256: sha256(Buffer.from(JSON.stringify(manifest))),
    families: {
      eightfold: { status: 'PASS' },
      oracle_recruiting: { status: 'PASS' },
      goldman_higher: { status: 'PASS' },
    },
    fault_recovery: { status: 'PASS' },
    cleanup: { status: 'PASS', terminal },
  }
  assert.doesNotThrow(() => assertRolloutEvidence(rollout, manifest))
  assert.throws(() => assertRolloutEvidence({
    ...rollout,
    cleanup: { status: 'FAIL', terminal },
  }, manifest))
})

test('canonical serialization is stable for manifest approval binding', () => {
  assert.equal(
    canonical({ b: 2, a: [{ z: true, y: null }] }),
    '{"a":[{"y":null,"z":true}],"b":2}',
  )
})

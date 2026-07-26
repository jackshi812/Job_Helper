import assert from 'node:assert/strict'
import test from 'node:test'

import { FAMILY_ORDER } from './run-phase-03-8-rollout.mjs'
import {
  assertSelectiveHostedIdentity,
  exactSelectiveApproval,
  executeSelectiveRollout,
} from './run-phase-03-8-selective-rollout.mjs'

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

function manifest() {
  return {
    schema_version: 1,
    phase: '03.8',
    release_manifest_id: '03850000-0000-4000-8000-000000000007',
    project_ref: 'fjcsvajkkztvlrpdplwx',
    accepted_production_source: 'a'.repeat(40),
    candidate: {
      git_sha: 'b'.repeat(40),
      commit_object_sha256: 'c'.repeat(64),
      worktree_path: '/private/tmp/candidate',
      changed_files: [],
    },
    migrations: Array.from(
      { length: 43 },
      (_, index) => String(index + 1).padStart(4, '0'),
    ),
    functions: Object.fromEntries([
      ['verify-board', true],
      ['observe-connectors', false],
      ['poll-tick', false],
    ].map(([slug, verifyJwt], index) => [slug, {
      entry_path: `supabase/functions/${slug}/index.ts`,
      entry_sha256: String(index + 1).repeat(64),
      bundle_manifest_sha256: String(index + 4).repeat(64),
      hosted_baseline: {
        id: `03850000-0000-4000-8000-00000000000${index + 1}`,
        version: index + 1,
        verify_jwt: verifyJwt,
      },
    }])),
    verifier: {
      fixtures: Array.from({ length: 3 }, (_, index) => ({
        company_id: `03850000-0000-4000-8000-0000000005${index + 1}1`,
        job_id: `03850000-0000-4000-8000-0000000005${index + 1}2`,
        observation_id: `03850000-0000-4000-8000-0000000005${index + 1}3`,
      })),
    },
    families: FAMILY_ORDER.map((family) => family.sourceKey),
  }
}

function harness(startKinds = {}) {
  const finalized = []
  const consumed = []
  const ops = {
    assertConsumedVerifier: async () => {
      consumed.push(true)
      return terminal
    },
    inspectCandidateStart: async (family) => ({
      family: family.family,
      source_key: family.sourceKey,
      kind: startKinds[family.key] ?? 'terminal_unsupported',
      evidence_digest: '8'.repeat(64),
    }),
    finalizeCandidate: async (input) => {
      finalized.push(input)
      return { accepted: true }
    },
    awaitTerminalFamily: async ({ family }) => ({
      family: family.family,
      source_key: family.sourceKey,
      status: 'PASS',
      outcome: 'active',
      activation_successes: 3,
      eligible_job_count: 5,
      natural_poll: true,
      timestamps: {
        activated_at: '2026-07-26T17:00:00.000Z',
        due_at: '2026-07-26T17:01:00.000Z',
        claimed_at: '2026-07-26T17:01:01.000Z',
        completed_at: '2026-07-26T17:02:00.000Z',
        feed_visible_at: '2026-07-26T17:02:01.000Z',
      },
    }),
    assertFinalRollout: async (_manifest, families, consumedState) => {
      assert.equal(Object.keys(families).length, 4)
      assert.deepEqual(consumedState, terminal)
      return { status: 'PASS', terminal: consumedState }
    },
  }
  return { ops, finalized, consumed }
}

function positiveProbe(family) {
  return {
    positive: true,
    reason: null,
    evidence: {
      family: family.family,
      source_key: family.sourceKey,
      evidence_digest: '9'.repeat(64),
    },
  }
}

test('approval binds manifest, source commit, and all three bundles', () => {
  const value = manifest()
  assert.equal(exactSelectiveApproval(value, 'f'.repeat(64)), [
    'approve Phase 03.8 selective rollout',
    value.release_manifest_id,
    'f'.repeat(64),
    value.candidate.git_sha,
    ...Object.values(value.functions).map(
      (entry) => entry.bundle_manifest_sha256,
    ),
  ].join(' '))
})

test('postdeploy identity increments only functions selected by the manifest', async () => {
  const value = manifest()
  value.functions['verify-board'].deploy_increment = 0
  value.functions['observe-connectors'].deploy_increment = 1
  value.functions['poll-tick'].deploy_increment = 0
  const inventory = Object.entries(value.functions).map(([slug, entry]) => ({
    slug,
    id: entry.hosted_baseline.id,
    status: 'ACTIVE',
    verify_jwt: entry.hosted_baseline.verify_jwt,
    version: entry.hosted_baseline.version + entry.deploy_increment,
  }))
  await assert.doesNotReject(assertSelectiveHostedIdentity({
    manifest: value,
    ops: { query: async () => [{ migrations: value.migrations }] },
    accessToken: 'unused',
    stage: 'postdeploy',
    inventory,
  }))
})

test('terminal Unsupported candidates are independently re-admitted and monitored', async () => {
  const h = harness()
  const result = await executeSelectiveRollout({
    manifest: manifest(),
    ops: h.ops,
    probe: positiveProbe,
    now: () => Date.parse('2026-07-26T17:00:00.000Z'),
    nonce: (() => {
      let value = 0
      return () => `nonce-${value++}`
    })(),
  })
  assert.equal(result.status, 'PASS')
  assert.equal(h.finalized.length, 4)
  assert.equal(new Set(h.finalized.map((item) => item.evidenceDigest)).size, 4)
  assert.ok(h.finalized.every(
    (item) => item.outcome === 'admit_experimental' && item.reason === null,
  ))
  assert.equal(h.consumed.length, 2)
})

test('active and experimental resumes do not repeat terminal mutation', async () => {
  const h = harness({
    morgan_stanley: 'active',
    bank_of_america: 'experimental',
  })
  await executeSelectiveRollout({
    manifest: manifest(),
    ops: h.ops,
    probe: positiveProbe,
    now: () => Date.parse('2026-07-26T17:00:00.000Z'),
  })
  assert.deepEqual(
    h.finalized.map((item) => item.sourceKey).sort(),
    FAMILY_ORDER.slice(2).map((family) => family.sourceKey).sort(),
  )
})

test('one negative probe fails the rollout without re-admitting that company', async () => {
  const h = harness()
  const failedKey = FAMILY_ORDER[1].sourceKey
  await assert.rejects(executeSelectiveRollout({
    manifest: manifest(),
    ops: h.ops,
    probe: async (family) => (
      family.sourceKey === failedKey
        ? { positive: false, reason: 'zero_eligible_jobs', evidence: {} }
        : positiveProbe(family)
    ),
    now: () => Date.parse('2026-07-26T17:00:00.000Z'),
  }), /Bank of America: Bank of America selective probe failed/)
  assert.ok(!h.finalized.some((item) => item.sourceKey === failedKey))
})

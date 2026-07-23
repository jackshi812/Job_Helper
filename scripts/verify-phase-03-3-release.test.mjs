import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  validateEvidenceText,
  verifyIdentityEvidence,
  verifyPostReleaseEvidence,
} from './verify-phase-03-3-release.mjs'

const RELEASE_SHA = 'a'.repeat(40)
const MIGRATION_SHA = 'b'.repeat(64)
const ASSET_SHA = 'c'.repeat(64)
const LOCAL_MIGRATIONS = Array.from({ length: 31 }, (_, index) =>
  String(index + 1).padStart(4, '0'),
)

function identity(overrides = {}) {
  return {
    evidence_mode: 'identity',
    approved_git_sha: RELEASE_SHA,
    project_ref: 'fjcsvajkkztvlrpdplwx',
    local_migrations: LOCAL_MIGRATIONS.join(','),
    remote_migrations: LOCAL_MIGRATIONS.join(','),
    migration_0031_sha256: MIGRATION_SHA,
    score_tick_deployment_id: 'score-tick-filter-v4',
    score_tick_version: '9',
    score_tick_status: 'ACTIVE',
    score_tick_verify_jwt: 'false',
    score_tick_filter_revision: 'filter-v4',
    cloudflare_deployment_id: 'deployment-filter-v4',
    cloudflare_environment: 'production',
    cloudflare_status: 'success',
    cloudflare_branch: 'main',
    cloudflare_git_sha: RELEASE_SHA,
    cloudflare_url: 'https://deployment-filter-v4.job-helper-qs9.pages.dev',
    asset_path: '/assets/index-filter-v4.js',
    local_asset_sha256: ASSET_SHA,
    live_asset_sha256: ASSET_SHA,
    ...overrides,
  }
}

function postRelease(overrides = {}) {
  return {
    ...identity(),
    evidence_mode: 'post_release',
    owner_open_rows_before: '3',
    reservations_before: '41',
    deployed_daily_cap: '200',
    uat_paid_reservation_ceiling: '30',
    preference_save_count: '2',
    reservations_after: '43',
    owner_score_usage_before: '11',
    owner_score_usage_after: '13',
    other_score_usage_before: '7',
    other_score_usage_after: '7',
    owner_revision_sum_before: '101',
    owner_revision_sum_after_empty_save: '104',
    owner_revision_sum_after_restore_save: '107',
    empty_save_affected_rows: '3',
    restore_save_affected_rows: '3',
    owner_unconverged_after_empty_save: '0',
    owner_unconverged_after_restore_save: '0',
    preference_snapshot_sha256_before: 'd'.repeat(64),
    preference_snapshot_sha256_after: 'd'.repeat(64),
    preferences_restored_exactly: 'true',
    unauthorized_manual_score_tick_invocations: '0',
    unauthorized_scoring_verifier_runs: '0',
    unauthorized_fixture_rows: '0',
    unauthorized_direct_openai_calls: '0',
    unauthorized_global_requeues: '0',
    unauthorized_scheduler_mutations: '0',
    unauthorized_budget_mutations: '0',
    ...overrides,
  }
}

function evidenceText(fields) {
  return Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join('\n')
}

function probes(overrides = {}) {
  return {
    localGitSha: RELEASE_SHA,
    originGitSha: RELEASE_SHA,
    localMigrations: LOCAL_MIGRATIONS,
    remoteMigrations: LOCAL_MIGRATIONS,
    migration0031Sha256: MIGRATION_SHA,
    scoreTick: {
      id: 'score-tick-filter-v4',
      version: '9',
      status: 'ACTIVE',
      verifyJwt: false,
      filterRevision: 'filter-v4',
    },
    cloudflare: {
      id: 'deployment-filter-v4',
      environment: 'production',
      status: 'success',
      branch: 'main',
      gitSha: RELEASE_SHA,
      url: 'https://deployment-filter-v4.job-helper-qs9.pages.dev',
    },
    asset: {
      path: '/assets/index-filter-v4.js',
      localSha256: ASSET_SHA,
      liveSha256: ASSET_SHA,
    },
    ...overrides,
  }
}

test('identity evidence accepts exact migration, function, Git, Cloudflare, and asset identity', () => {
  const parsed = validateEvidenceText('identity', evidenceText(identity()))
  assert.equal(parsed.fields.approved_git_sha, RELEASE_SHA)
  assert.doesNotThrow(() => verifyIdentityEvidence(parsed.fields, probes()))
})

test('parser rejects missing, duplicate, malformed, and unknown evidence', () => {
  const missing = identity()
  delete missing.asset_path
  assert.throws(
    () => validateEvidenceText('identity', evidenceText(missing)),
    /missing field: asset_path/,
  )
  assert.throws(
    () => validateEvidenceText('identity', `${evidenceText(identity())}\nasset_path: /again.js`),
    /duplicate field: asset_path/,
  )
  assert.throws(
    () => validateEvidenceText('identity', evidenceText(identity({ approved_git_sha: 'stale' }))),
    /approved_git_sha is malformed/,
  )
  assert.throws(
    () => validateEvidenceText('identity', evidenceText(identity({ surprise: 'true' }))),
    /unknown field: surprise/,
  )
  assert.throws(
    () => validateEvidenceText('identity', `${evidenceText(identity())}\nnot evidence`),
    /malformed evidence line/,
  )
})

test('identity rejects wrong migration order, duplicates, parity drift, or checksum drift', () => {
  const wrongOrder = [...LOCAL_MIGRATIONS]
  wrongOrder.splice(29, 2, '0031', '0030')
  assert.throws(
    () => verifyIdentityEvidence(identity(), probes({ localMigrations: wrongOrder })),
    /local migration inventory mismatch/,
  )
  assert.throws(
    () =>
      verifyIdentityEvidence(
        identity({ local_migrations: `${LOCAL_MIGRATIONS.join(',')},0031` }),
        probes(),
      ),
    /local migration 0031 must occur exactly once immediately after 0030/,
  )
  assert.throws(
    () => verifyIdentityEvidence(identity(), probes({ remoteMigrations: LOCAL_MIGRATIONS.slice(0, -1) })),
    /remote migration inventory mismatch/,
  )
  assert.throws(
    () => verifyIdentityEvidence(identity(), probes({ migration0031Sha256: 'e'.repeat(64) })),
    /migration 0031 SHA-256 mismatch/,
  )
})

test('identity rejects stale function identity and weakened authorization posture', () => {
  assert.throws(
    () =>
      verifyIdentityEvidence(
        identity(),
        probes({ scoreTick: { ...probes().scoreTick, id: 'old-deployment' } }),
      ),
    /score-tick deployment ID mismatch/,
  )
  assert.throws(
    () =>
      verifyIdentityEvidence(
        identity(),
        probes({ scoreTick: { ...probes().scoreTick, filterRevision: 'filter-v3' } }),
      ),
    /score-tick filter revision must equal filter-v4/,
  )
  assert.throws(
    () =>
      verifyIdentityEvidence(
        identity(),
        probes({ scoreTick: { ...probes().scoreTick, verifyJwt: true } }),
      ),
    /score-tick verify_jwt mismatch/,
  )
})

test('identity rejects local or origin SHA drift', () => {
  assert.throws(
    () => verifyIdentityEvidence(identity(), probes({ localGitSha: 'f'.repeat(40) })),
    /local Git SHA mismatch/,
  )
  assert.throws(
    () => verifyIdentityEvidence(identity(), probes({ originGitSha: 'f'.repeat(40) })),
    /origin\/main Git SHA mismatch/,
  )
})

test('identity rejects non-production, failed, off-main, or wrong-SHA Cloudflare metadata', () => {
  for (const [field, value, expected] of [
    ['environment', 'preview', /Cloudflare environment must equal production/],
    ['status', 'failure', /Cloudflare status must equal success/],
    ['branch', 'release', /Cloudflare branch must equal main/],
    ['gitSha', 'f'.repeat(40), /Cloudflare Git SHA mismatch/],
  ]) {
    assert.throws(
      () =>
        verifyIdentityEvidence(
          identity(),
          probes({ cloudflare: { ...probes().cloudflare, [field]: value } }),
        ),
      expected,
    )
  }
})

test('identity rejects local, evidence, or live immutable asset mismatch', () => {
  assert.throws(
    () =>
      verifyIdentityEvidence(
        identity(),
        probes({ asset: { ...probes().asset, liveSha256: 'e'.repeat(64) } }),
      ),
    /live asset SHA-256 mismatch/,
  )
  assert.throws(
    () =>
      verifyIdentityEvidence(
        identity({ live_asset_sha256: 'e'.repeat(64) }),
        probes(),
      ),
    /evidence asset hashes must match/,
  )
})

test('post-release accepts exactly two saves, computed B, convergence, and exact restoration', () => {
  const parsed = validateEvidenceText('post-release', evidenceText(postRelease()))
  assert.doesNotThrow(() => verifyPostReleaseEvidence(parsed.fields, probes()))
})

test('post-release rejects missing counters, wrong save count, and wrong numeric B', () => {
  const missing = postRelease()
  delete missing.reservations_before
  assert.throws(
    () => validateEvidenceText('post-release', evidenceText(missing)),
    /missing field: reservations_before/,
  )
  assert.throws(
    () => verifyPostReleaseEvidence(postRelease({ preference_save_count: '1' }), probes()),
    /preference_save_count must equal 2/,
  )
  assert.throws(
    () =>
      verifyPostReleaseEvidence(
        postRelease({ uat_paid_reservation_ceiling: '29' }),
        probes(),
      ),
    /uat_paid_reservation_ceiling must equal min\(10 × N, max\(0, C - R\)\)/,
  )
})

test('post-release rejects reservation or owner usage above the approved ceiling', () => {
  assert.throws(
    () => verifyPostReleaseEvidence(postRelease({ reservations_after: '72' }), probes()),
    /reservation delta exceeds approved ceiling/,
  )
  assert.throws(
    () => verifyPostReleaseEvidence(postRelease({ owner_score_usage_after: '42' }), probes()),
    /owner usage delta exceeds approved ceiling/,
  )
})

test('post-release rejects concurrent other-user usage, unconverged rows, or restoration drift', () => {
  assert.throws(
    () => verifyPostReleaseEvidence(postRelease({ other_score_usage_after: '8' }), probes()),
    /other-user score usage changed/,
  )
  assert.throws(
    () =>
      verifyPostReleaseEvidence(
        postRelease({ owner_unconverged_after_restore_save: '1' }),
        probes(),
      ),
    /owner rows did not converge after restoration/,
  )
  assert.throws(
    () =>
      verifyPostReleaseEvidence(
        postRelease({ preference_snapshot_sha256_after: 'e'.repeat(64) }),
        probes(),
      ),
    /preference snapshot hash mismatch/,
  )
})

test('post-release rejects non-monotonic revision accounting and unauthorized effects', () => {
  assert.throws(
    () =>
      verifyPostReleaseEvidence(
        postRelease({ owner_revision_sum_after_restore_save: '106' }),
        probes(),
      ),
    /restoration revision delta mismatch/,
  )
  assert.throws(
    () =>
      verifyPostReleaseEvidence(
        postRelease({ unauthorized_manual_score_tick_invocations: '1' }),
        probes(),
      ),
    /unauthorized_manual_score_tick_invocations must equal 0/,
  )
})

test('probe command, API, credential, parse, and file errors propagate', () => {
  const credentialError = new Error('cloudflare credential unavailable')
  assert.throws(() => verifyIdentityEvidence(identity(), () => { throw credentialError }), credentialError)
})

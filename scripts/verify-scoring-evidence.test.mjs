import assert from 'node:assert/strict'
import { test } from 'node:test'

import { validateEvidenceText } from './verify-scoring-evidence.mjs'

const SHA = 'a'.repeat(40)
const ASSET_SHA = 'b'.repeat(64)

function rollout(overrides = {}) {
  return {
    evidence_mode: 'rollout',
    local_git_sha: SHA,
    origin_git_sha: SHA,
    migration_head: '0025',
    migration_0025_applied: 'true',
    score_tick_deployment_id: 'score-tick-v25',
    score_tick_version: '25',
    cloudflare_deployment_id: 'deployment-25',
    cloudflare_url: 'https://job-helper.example.pages.dev',
    cloudflare_status: 'success',
    asset_url: '/assets/index-release.js',
    asset_sha256: ASSET_SHA,
    latch_table_present: 'true',
    begin_function_present: 'true',
    end_function_present: 'true',
    claim_function_present: 'true',
    maintenance_max_ttl_seconds: '300',
    maintenance_service_role_only: 'true',
    notification_runtime_absent: 'true',
    notification_schema_absent: 'true',
    notification_secrets_absent: 'true',
    notification_client_absent: 'true',
    notification_ui_absent: 'true',
    local_safety_command: 'node --experimental-strip-types --test freshness evidence',
    local_safety_result: 'pass',
    paid_verifier_runs: '0',
    manual_score_tick_invocations: '0',
    maintenance_runs_started: '0',
    openai_calls_by_plan_03_10: '0',
    ...overrides,
  }
}

function paid(overrides = {}) {
  return {
    ...rollout(),
    evidence_mode: 'paid',
    rollout_local_git_sha: SHA,
    rollout_origin_git_sha: SHA,
    rollout_migration_head: '0025',
    rollout_score_tick_deployment_id: 'score-tick-v25',
    rollout_cloudflare_deployment_id: 'deployment-25',
    rollout_asset_sha256: ASSET_SHA,
    paid_verifier_runs: '1',
    score_tick_invocations: '1',
    fixture_user_jobs: '2',
    late_job_isolated: 'true',
    late_preference_isolated: 'true',
    late_reroute_isolated: 'true',
    no_id_claimed: '0',
    mismatched_id_claimed: '0',
    authenticated_writes_denied: 'true',
    positive_fixture_outcome: 'scored',
    negative_fixture_outcome: 'filtered',
    owned_global_usage_delta: '1',
    other_global_usage_delta: '0',
    rows_restored_exactly: 'true',
    preferences_restored_exactly: 'true',
    latch_released_or_expired: 'true',
    cron_restored_exactly: 'true',
    residue_count: '0',
    openai_calls_by_plan_03_10: '1',
    ...overrides,
  }
}

function evidenceText(fields) {
  return Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join('\n')
}

test('rollout mode accepts exact release identity, latch inventory, absence, and zero effects', () => {
  const result = validateEvidenceText('rollout', evidenceText(rollout()))
  assert.equal(result.mode, 'rollout')
  assert.equal(result.fields.local_git_sha, SHA)
})

test('rollout mode rejects missing, duplicate, malformed, or contradictory fields', () => {
  const missing = rollout()
  delete missing.asset_sha256
  assert.throws(() => validateEvidenceText('rollout', evidenceText(missing)), /missing field: asset_sha256/)

  assert.throws(
    () => validateEvidenceText('rollout', `${evidenceText(rollout())}\nasset_sha256: ${ASSET_SHA}`),
    /duplicate field: asset_sha256/,
  )
  assert.throws(
    () => validateEvidenceText('rollout', evidenceText(rollout({ local_git_sha: 'not-a-sha' }))),
    /local_git_sha/,
  )
  assert.throws(
    () => validateEvidenceText('rollout', evidenceText(rollout({ origin_git_sha: 'c'.repeat(40) }))),
    /local\/origin git SHA mismatch/,
  )
  assert.throws(
    () => validateEvidenceText('rollout', evidenceText(rollout({ paid_verifier_runs: '1' }))),
    /paid_verifier_runs must equal 0/,
  )
})

test('paid mode requires one exact invocation, two fixtures, isolation, restoration, and one owned delta', () => {
  const result = validateEvidenceText('paid', evidenceText(paid()))
  assert.equal(result.mode, 'paid')
  assert.equal(result.fields.score_tick_invocations, '1')
})

test('paid mode rejects release mismatch and proof contradictions', () => {
  assert.throws(
    () => validateEvidenceText('paid', evidenceText(paid({ rollout_asset_sha256: 'c'.repeat(64) }))),
    /rollout asset SHA mismatch/,
  )
  assert.throws(
    () => validateEvidenceText('paid', evidenceText(paid({ score_tick_invocations: '2' }))),
    /score_tick_invocations must equal 1/,
  )
  assert.throws(
    () => validateEvidenceText('paid', evidenceText(paid({ other_global_usage_delta: '1' }))),
    /other_global_usage_delta must equal 0/,
  )
  assert.throws(
    () => validateEvidenceText('paid', evidenceText(paid({ cron_restored_exactly: 'false' }))),
    /cron_restored_exactly must equal true/,
  )
})

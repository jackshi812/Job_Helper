import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  assertHostedRecord,
  assertRolloutRecord,
  assertUatRecord,
  evaluateHostedSnapshot,
  exactUatApproval,
  uatApprovalPayload,
} from './verify-phase-03-10-hosted.mjs'

const SHA = (digit) => digit.repeat(64)
const RELEASE_ID = '31000000-0000-4000-8000-000000000004'
const SOURCE_KEY = 'goldman_higher:roles'
const PUBLIC_URL = 'https://higher.gs.com/results'
const APPLY_URL =
  'https://hdpc.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/LateralHiring/job/180084/apply/email'

const manifest = {
  schema_version: 1,
  phase: '03.10',
  release_manifest_id: RELEASE_ID,
  source_key: SOURCE_KEY,
  public_url: PUBLIC_URL,
  source_commit: '1'.repeat(40),
  migration: {
    path: 'supabase/migrations/0048_phase_03_10_goldman_higher.sql',
    version: '0048',
    sha256: SHA('2'),
  },
  functions: {
    'verify-board': {
      version: 51,
      verify_jwt: true,
      entry_sha256: SHA('3'),
      bundle_sha256: SHA('4'),
    },
    'observe-connectors': {
      version: 52,
      verify_jwt: false,
      entry_sha256: SHA('5'),
      bundle_sha256: SHA('6'),
    },
    'poll-tick': {
      version: 53,
      verify_jwt: false,
      entry_sha256: SHA('7'),
      bundle_sha256: SHA('8'),
    },
  },
  web_deployment: {
    commit_sha: '1'.repeat(40),
    asset_sha256: SHA('9'),
  },
}

function qualifyingJob(overrides = {}) {
  return {
    source: 'goldman_higher',
    source_key: SOURCE_KEY,
    external_id: '180084_GS_MID_CAREER',
    provider_source_id: '180084',
    posted_at: '2026-07-25T16:00:00.000Z',
    observed_at: '2026-07-27T16:00:00.000Z',
    country_code: 'US',
    category_field: 'division',
    category_label: 'global investment research division',
    matched_term: 'Investment',
    recruiting_type: 'GS_MID_CAREER',
    description_text: 'Complete provider-owned role detail.',
    snapshot_partial: false,
    absolute_url: APPLY_URL,
    apply_reachable: true,
    scope_evidence_matches: true,
    ...overrides,
  }
}

function passingSnapshot() {
  return {
    release: {
      release_manifest_id: RELEASE_ID,
      manifest_file_sha256: SHA('a'),
      source_commit: manifest.source_commit,
      web_commit_sha: manifest.web_deployment.commit_sha,
      web_asset_sha256: manifest.web_deployment.asset_sha256,
    },
    migration: {
      version: '0048',
      path: manifest.migration.path,
      sha256: manifest.migration.sha256,
      status: 'APPLIED',
      history_exact: true,
    },
    functions: Object.fromEntries(
      Object.entries(manifest.functions).map(([slug, expected]) => [
        slug,
        {
          status: 'ACTIVE',
          version: expected.version,
          verify_jwt: expected.verify_jwt,
          entry_sha256: expected.entry_sha256,
          bundle_sha256: expected.bundle_sha256,
        },
      ]),
    ),
    catalog: {
      company_name: 'Goldman Sachs',
      provider: 'Goldman Higher',
      careers_url: PUBLIC_URL,
      source_key: SOURCE_KEY,
      disposition: 'experimental',
    },
    company: {
      name: 'Goldman Sachs',
      ats_type: 'goldman_higher',
      board_token: SOURCE_KEY,
      region: null,
      site_token: null,
      careers_url: PUBLIC_URL,
      source_key: SOURCE_KEY,
      activation_state: 'active',
      activation_successes: 3,
      last_polled_at: '2026-07-27T16:04:00.000Z',
      last_success_at: '2026-07-27T16:04:01.000Z',
      last_error_code: null,
    },
    acl: {
      service_role_execute: true,
      public_execute: false,
      anon_execute: false,
      authenticated_execute: false,
    },
    activation: {
      observations: [
        {
          window: '2026-07-27T16:00:00.000Z',
          observed_at: '2026-07-27T16:00:01.000Z',
        },
        {
          window: '2026-07-27T16:01:00.000Z',
          observed_at: '2026-07-27T16:01:01.000Z',
        },
        {
          window: '2026-07-27T16:02:00.000Z',
          observed_at: '2026-07-27T16:02:01.000Z',
        },
      ],
      replay_rejected: true,
      same_window_rejected: true,
      fourth_invocation_count: 0,
    },
    natural_poll: {
      scheduler_owned: true,
      observed_after_activation: true,
      release_identity_matches: true,
      healthy: true,
    },
    eligible_job_count: 1,
    qualifying_jobs: [qualifyingJob()],
    closure: {
      allow_missing_closure: false,
      absence_closed_count: 0,
    },
    feed_aging: {
      active_visible: false,
      provider_status: 'open',
      closed_at: null,
      applied_visible: true,
      dismissed_visible: true,
    },
    isolation: {
      protected_sources_unchanged: true,
      protected_provider_lifecycle_unchanged: true,
      user_data_unchanged: true,
    },
    cleanup: {
      exits: {
        success: true,
        unsupported: true,
        error: true,
        timeout: true,
        assertion_failure: true,
        artifact_write_failure: true,
      },
      verifier_residue_count: 0,
    },
    redaction: {
      errors: true,
      logs: true,
      json: true,
      markdown: true,
      nested_causes: true,
      credential_leak_count: 0,
    },
    terminal: {
      outcome: 'admit_experimental',
      reason: null,
      operational_authority: true,
    },
  }
}

test('reports exact Active PASS only when every independent hosted check passes', () => {
  const record = evaluateHostedSnapshot(manifest, passingSnapshot())
  assert.equal(record.status, 'PASS')
  assert.equal(record.terminal_kind, 'ACTIVE')
  assert.ok(Object.values(record.checks).every((check) => check.status === 'PASS'))
  assert.equal(assertHostedRecord(manifest, record).status, 'PASS')
})

const negativeCases = [
  ['migration history/hash', (value) => {
    value.migration.sha256 = SHA('0')
  }, 'migration_0048'],
  ['function version', (value) => {
    value.functions['poll-tick'].version = 999
  }, 'function_parity'],
  ['service-role ACL', (value) => {
    value.acl.authenticated_execute = true
  }, 'service_role_acl'],
  ['catalog identity', (value) => {
    value.catalog.careers_url = 'https://higher.gs.com/roles'
  }, 'exact_identity'],
  ['fewer than three windows', (value) => {
    value.activation.observations.pop()
  }, 'activation_windows'],
  ['more than three windows', (value) => {
    value.activation.observations.push({
      window: '2026-07-27T16:03:00.000Z',
      observed_at: '2026-07-27T16:03:01.000Z',
    })
  }, 'activation_windows'],
  ['fourth invocation', (value) => {
    value.activation.fourth_invocation_count = 1
  }, 'no_fourth_invocation'],
  ['missing later natural poll', (value) => {
    value.natural_poll.observed_after_activation = false
  }, 'natural_poll'],
  ['missing startDate', (value) => {
    value.qualifying_jobs[0].posted_at = null
  }, 'qualifying_job'],
  ['stale startDate', (value) => {
    value.qualifying_jobs[0].posted_at = '2026-07-19T15:59:59.999Z'
  }, 'qualifying_job'],
  ['wrong source', (value) => {
    value.qualifying_jobs[0].source = 'oracle_recruiting'
  }, 'qualifying_job'],
  ['wrong country', (value) => {
    value.qualifying_jobs[0].country_code = 'CA'
  }, 'qualifying_job'],
  ['wrong category field', (value) => {
    value.qualifying_jobs[0].category_field = 'title'
  }, 'qualifying_job'],
  ['wrong category label', (value) => {
    value.qualifying_jobs[0].category_label = ''
  }, 'qualifying_job'],
  ['wrong category term', (value) => {
    value.qualifying_jobs[0].matched_term = 'Legal'
  }, 'qualifying_job'],
  ['wrong population', (value) => {
    value.qualifying_jobs[0].recruiting_type = 'INTERNAL_MOBILITY'
  }, 'qualifying_job'],
  ['nonexact Apply URL', (value) => {
    value.qualifying_jobs[0].absolute_url = `${APPLY_URL}/extra`
  }, 'qualifying_job'],
  ['partial description', (value) => {
    value.qualifying_jobs[0].snapshot_partial = true
  }, 'qualifying_job'],
  ['closure enabled', (value) => {
    value.closure.allow_missing_closure = true
  }, 'closure_disabled'],
  ['absence-closed row', (value) => {
    value.closure.absence_closed_count = 1
  }, 'closure_disabled'],
  ['aged Active visibility', (value) => {
    value.feed_aging.active_visible = true
  }, 'feed_aging'],
  ['provider lifecycle mutation', (value) => {
    value.feed_aging.provider_status = 'closed'
  }, 'feed_aging'],
  ['sibling drift', (value) => {
    value.isolation.protected_sources_unchanged = false
  }, 'protected_sources'],
  ['user drift', (value) => {
    value.isolation.user_data_unchanged = false
  }, 'user_data'],
  ['missing cleanup-on-failure', (value) => {
    value.cleanup.exits.timeout = false
  }, 'cleanup_every_exit'],
  ['residue', (value) => {
    value.cleanup.verifier_residue_count = 1
  }, 'zero_residue'],
  ['credential leakage', (value) => {
    value.redaction.credential_leak_count = 1
  }, 'secret_redaction'],
  ['release drift', (value) => {
    value.release.web_asset_sha256 = SHA('0')
  }, 'exact_release'],
]

for (const [name, mutate, failedCheck] of negativeCases) {
  test(`${name} independently blocks hosted PASS`, () => {
    const snapshot = passingSnapshot()
    mutate(snapshot)
    const record = evaluateHostedSnapshot(manifest, snapshot)
    assert.notEqual(record.status, 'PASS')
    assert.equal(record.checks[failedCheck].status, 'PENDING')
    assert.throws(
      () => assertHostedRecord(manifest, record),
      /hosted verification/,
    )
  })
}

test('precise Unsupported remains explicit, isolated, cleaned, and non-monitored', () => {
  const snapshot = passingSnapshot()
  snapshot.catalog.disposition = 'unsupported_with_reason'
  snapshot.catalog.source_key = null
  snapshot.company = null
  snapshot.activation = {
    observations: [],
    replay_rejected: true,
    same_window_rejected: true,
    fourth_invocation_count: 0,
  }
  snapshot.natural_poll = {
    scheduler_owned: false,
    observed_after_activation: false,
    release_identity_matches: true,
    healthy: false,
  }
  snapshot.eligible_job_count = 0
  snapshot.qualifying_jobs = []
  snapshot.terminal = {
    outcome: 'unsupported',
    reason: 'positive_job_count_missing',
    operational_authority: false,
  }
  const record = evaluateHostedSnapshot(manifest, snapshot)
  assert.equal(record.status, 'UNSUPPORTED')
  assert.equal(record.terminal_kind, 'UNSUPPORTED')
  assert.equal(record.checks.monitored_source.status, 'PENDING')
  assert.equal(assertHostedRecord(manifest, record).status, 'UNSUPPORTED')
})

function passingRollout() {
  return {
    schema_version: 1,
    phase: '03.10',
    release_manifest_id: RELEASE_ID,
    source_key: SOURCE_KEY,
    status: 'PASS',
    release: {
      manifest_file_sha256: SHA('a'),
      source_commit: manifest.source_commit,
      web_commit_sha: manifest.web_deployment.commit_sha,
      web_asset_sha256: manifest.web_deployment.asset_sha256,
    },
    terminal: { outcome: 'admit_experimental', operational_authority: true },
    protected_sources_unchanged: true,
    cleanup: { every_exit: true, verifier_residue_count: 0 },
    redaction: { credential_leak_count: 0 },
  }
}

test('rollout assertion accepts only complete exact PASS or precise Unsupported', () => {
  assert.equal(assertRolloutRecord(manifest, passingRollout()).status, 'PASS')
  const unsupported = passingRollout()
  unsupported.status = 'UNSUPPORTED'
  unsupported.terminal = {
    outcome: 'unsupported',
    reason: 'higher_contract_unverified',
    operational_authority: false,
  }
  assert.equal(assertRolloutRecord(manifest, unsupported).status, 'UNSUPPORTED')
  const pending = passingRollout()
  pending.status = 'PENDING'
  assert.throws(() => assertRolloutRecord(manifest, pending), /rollout/)
})

function pendingUat() {
  const record = {
    schema_version: 1,
    phase: '03.10',
    release_manifest_id: RELEASE_ID,
    manifest_file_sha256: SHA('a'),
    hosted_verification_sha256: SHA('b'),
    rollout_verification_sha256: SHA('c'),
    source_key: SOURCE_KEY,
    migration: {
      version: '0048',
      sha256: manifest.migration.sha256,
    },
    functions: Object.fromEntries(
      Object.entries(manifest.functions).map(([slug, value]) => [
        slug,
        {
          version: value.version,
          bundle_sha256: value.bundle_sha256,
        },
      ]),
    ),
    web: {
      commit_sha: manifest.web_deployment.commit_sha,
      asset_sha256: manifest.web_deployment.asset_sha256,
    },
    observed: {
      activation_state: 'active',
      activation_successes: 3,
      natural_poll_at: '2026-07-27T16:04:01.000Z',
    },
    expected_watchlist: {
      company_name: 'Goldman Sachs',
      careers_url: PUBLIC_URL,
      activation_state: 'active',
      activation_successes: 3,
    },
    expected_job: qualifyingJob(),
    cleanup: {
      every_exit: true,
      verifier_residue_count: 0,
    },
    owner_browser_required: true,
    codex_browser_used: false,
    status: 'PENDING_OWNER_BROWSER',
    owner_attestation: null,
  }
  record.required_approval = exactUatApproval(manifest, record)
  return record
}

test('UAT payload binds release, evidence, source, runtime, job, and cleanup', () => {
  const record = pendingUat()
  const payload = uatApprovalPayload(manifest, record)
  assert.equal(payload.manifest_file_sha256, record.manifest_file_sha256)
  assert.equal(
    payload.hosted_verification_sha256,
    record.hosted_verification_sha256,
  )
  assert.equal(
    payload.rollout_verification_sha256,
    record.rollout_verification_sha256,
  )
  assert.equal(payload.expected_job.absolute_url, APPLY_URL)
  assert.equal(assertUatRecord(manifest, record).status, 'PENDING_OWNER_BROWSER')
})

test('UAT PASS requires the exact owner signal and forbids Codex browser use', () => {
  const record = pendingUat()
  record.status = 'PASS'
  assert.throws(() => assertUatRecord(manifest, record), /exact owner signal/)
  record.owner_attestation = record.required_approval
  assert.equal(assertUatRecord(manifest, record).status, 'PASS')

  const codex = pendingUat()
  codex.codex_browser_used = true
  codex.required_approval = exactUatApproval(manifest, codex)
  assert.throws(() => assertUatRecord(manifest, codex), /Codex browser/)
})

test('fabricated or reused UAT signals fail after any bound field changes', () => {
  for (const mutate of [
    (value) => {
      value.hosted_verification_sha256 = SHA('0')
    },
    (value) => {
      value.rollout_verification_sha256 = SHA('0')
    },
    (value) => {
      value.expected_job.external_id = 'different'
    },
    (value) => {
      value.observed.natural_poll_at = '2026-07-27T15:00:00.000Z'
    },
    (value) => {
      value.cleanup.verifier_residue_count = 1
    },
  ]) {
    const record = pendingUat()
    const stale = record.required_approval
    mutate(record)
    record.status = 'PASS'
    record.owner_attestation = stale
    assert.throws(() => assertUatRecord(manifest, record))
  }
})

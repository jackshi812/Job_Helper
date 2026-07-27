import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertHostedRecord,
  assertUatRecord,
  evaluateHostedSnapshot,
  exactUatApproval,
} from './verify-phase-03-9-hosted.mjs'

const manifest = {
  functions: {
    'observe-connectors': { verify_jwt: false },
    'poll-tick': { verify_jwt: false },
  },
  source_key: 'oracle:jpmc:CX_1001',
  public_url:
    'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs',
}

function passingSnapshot() {
  return {
    remote_migrations: ['0045', '0046', '0047'],
    functions: {
      'observe-connectors': { status: 'ACTIVE', verify_jwt: false },
      'poll-tick': { status: 'ACTIVE', verify_jwt: false },
    },
    catalog: {
      source_key: manifest.source_key,
      careers_url: manifest.public_url,
    },
    company: {
      source_key: manifest.source_key,
      activation_state: 'active',
      activation_successes: 3,
      last_success_at: '2026-07-26T23:00:00Z',
      last_polled_at: '2026-07-26T23:00:00Z',
      last_error_code: null,
    },
    eligible_job_count: 1,
    absence_closed_count: 0,
    protected_sources_unchanged: true,
    verifier_residue_count: 0,
  }
}

test('reports exact PASS only when every hosted truth passes', () => {
  const result = evaluateHostedSnapshot(manifest, passingSnapshot())
  assert.equal(result.status, 'PASS')
  assert.ok(Object.values(result.checks).every((check) => check.status === 'PASS'))
})

test('reports PENDING for incomplete activation or cleanup', () => {
  const snapshot = passingSnapshot()
  snapshot.company.activation_successes = 2
  snapshot.verifier_residue_count = 1
  const result = evaluateHostedSnapshot(manifest, snapshot)
  assert.equal(result.status, 'PENDING')
  assert.equal(result.checks.activation.status, 'PENDING')
  assert.equal(result.checks.zero_residue.status, 'PENDING')
})

test('reports precise Unsupported terminal state', () => {
  const snapshot = passingSnapshot()
  snapshot.company.activation_state = 'unsupported'
  const result = evaluateHostedSnapshot(manifest, snapshot)
  assert.equal(result.status, 'UNSUPPORTED')
})

test('asserts a release-bound hosted PASS record', () => {
  const record = evaluateHostedSnapshot(manifest, passingSnapshot())
  record.release_manifest_id = '03900000-0000-4000-8000-000000000004'
  record.evidence = {
    source_key: manifest.source_key,
    careers_url: manifest.public_url,
  }
  const finalManifest = {
    ...manifest,
    release_manifest_id: record.release_manifest_id,
  }
  assert.equal(assertHostedRecord(finalManifest, record).status, 'PASS')
})

function pendingUat() {
  const finalManifest = {
    ...manifest,
    release_manifest_id: '03900000-0000-4000-8000-000000000004',
  }
  const record = {
    schema_version: 1,
    phase: '03.9',
    release_manifest_id: finalManifest.release_manifest_id,
    source_key: manifest.source_key,
    hosted_verification_sha256: 'a'.repeat(64),
    rollout_verification_sha256: 'b'.repeat(64),
    owner_browser_required: true,
    codex_browser_used: false,
    expected_watchlist: {
      activation_state: 'active',
      activation_successes: 3,
      careers_url: manifest.public_url,
    },
    expected_job: {
      eligible_job_count: 113,
      source_key: manifest.source_key,
      apply_url: `${manifest.public_url}/210774113`,
    },
    status: 'PENDING_OWNER_BROWSER',
    owner_attestation: null,
  }
  record.required_approval = exactUatApproval(finalManifest, record)
  return { finalManifest, record }
}

test('prints a stable exact approval for pending owner-browser UAT', () => {
  const { finalManifest, record } = pendingUat()
  const result = assertUatRecord(finalManifest, record)
  assert.equal(result.status, 'PENDING_OWNER_BROWSER')
  assert.equal(result.required_approval, record.required_approval)
})

test('rejects a fabricated UAT PASS without the literal owner signal', () => {
  const { finalManifest, record } = pendingUat()
  record.status = 'PASS'
  assert.throws(
    () => assertUatRecord(finalManifest, record),
    /literal owner approval/,
  )
  record.owner_attestation = record.required_approval
  assert.equal(assertUatRecord(finalManifest, record).status, 'PASS')
})

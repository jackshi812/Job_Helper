import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateHostedSnapshot } from './verify-phase-03-9-hosted.mjs'

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
    remote_migrations: ['0045'],
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

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  GOLDMAN_SOURCE_KEY,
  createActivationController,
  exactProbe,
  normalizeUnsupportedRolloutRecord,
  protectedSnapshotsEqual,
  redactSecrets,
} from './run-phase-03-10-activation.ts'

const SECRET = 'synthetic-service-role-secret-non-production'
const NOW = Date.parse('2026-07-27T16:00:00.000Z')

test('production Goldman adapter imports under the strip-only activation runtime', async () => {
  const adapter = await import(
    '../supabase/functions/_shared/adapters/goldman-higher.ts'
  )
  assert.equal(typeof adapter.pollGoldmanHigher, 'function')
})

test('Unsupported rollout normalization binds release, zero authority, cleanup, and redaction', () => {
  const result = normalizeUnsupportedRolloutRecord({
    manifest: {
      release_manifest_id: 'release-id',
      source_commit: 'a'.repeat(40),
      web_deployment: {
        source_commit: 'b'.repeat(40),
        asset_sha256: 'c'.repeat(64),
      },
    },
    hashes: { manifest_file_sha256: 'd'.repeat(64) },
    record: {
      schema_version: 1,
      phase: '03.10',
      release_manifest_id: 'release-id',
      source_key: GOLDMAN_SOURCE_KEY,
      status: 'UNSUPPORTED',
      unsupported_reason: 'posting_date_ineligible',
      terminal: {
        accepted: true,
        reason: 'recorded_unsupported',
        result_activation_state: 'disabled',
      },
      protected_sources_unchanged: true,
    },
  })
  assert.deepEqual(result.terminal, {
    outcome: 'unsupported',
    reason: 'posting_date_ineligible',
    operational_authority: false,
    accepted: true,
    rpc_reason: 'recorded_unsupported',
    result_activation_state: 'disabled',
  })
  assert.equal(result.release.manifest_file_sha256, 'd'.repeat(64))
  assert.equal(result.release.web_commit_sha, 'b'.repeat(40))
  assert.equal(result.cleanup.every_exit, true)
  assert.equal(result.cleanup.verifier_residue_count, 0)
  assert.equal(result.redaction.credential_leak_count, 0)
})

function qualifyingJob(overrides = {}) {
  return {
    source: 'goldman_higher',
    externalId: '180084_GS_MID_CAREER',
    title: 'Research Analyst',
    location: 'New York, NY, United States',
    absoluteUrl:
      'https://hdpc.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/LateralHiring/job/180084/apply/email',
    postedAt: '2026-07-25T16:00:00.000Z',
    descriptionText: 'A complete provider-owned role description.',
    snapshotPartial: false,
    scopeEvidence: {
      sourceKey: GOLDMAN_SOURCE_KEY,
      selectionMode: 'recent_exact_us_provider_category',
      recentHours: 720,
      providerSourceId: '180084',
      providerCategoryField: 'division',
      providerCategoryLabel: 'global investment research division',
      matchedTerm: 'Investment',
      detailCountryCode: 'US',
      postedAt: '2026-07-25T16:00:00.000Z',
      recruitingType: 'GS_MID_CAREER',
      externalIdDigest: 'a'.repeat(64),
    },
    ...overrides,
  }
}

function completeObservation(overrides = {}) {
  const jobs = overrides.jobs ?? [qualifyingJob()]
  return {
    jobs,
    completeness: 'complete',
    credibleForClosure: true,
    allowMissingClosure: false,
    pageCount: 2,
    expectedCount: jobs.length,
    warnings: [],
    scopeEvidence: {
      sourceKey: GOLDMAN_SOURCE_KEY,
      selectionMode: 'recent_exact_us_provider_category',
      recentHours: 720,
      sliceDigests: ['b'.repeat(64), 'c'.repeat(64)],
      jobDigest: 'd'.repeat(64),
      categoryDigest: 'e'.repeat(64),
      countryDigest: 'f'.repeat(64),
      freshnessDigest: '1'.repeat(64),
      applicationDigest: '2'.repeat(64),
    },
    ...overrides,
  }
}

function protectedSnapshot(overrides = {}) {
  return {
    companies: [{ source_key: 'oracle:jpmc:CX_1001', last_polled_at: 'before' }],
    public_sources: [{ source_key: 'greenhouse:example' }],
    workday_sources: [{ source_key: 'workday:wd1:fmr:FidelityCareers' }],
    catalog: [{ company_name: 'JPMorgan Chase', disposition: 'active' }],
    jobs: [{ source: 'oracle_recruiting', count: 41 }],
    users: [{ user_id: 'owner', row_count: 12, digest: 'owner-digest' }],
    cron: [{ jobname: 'poll-tick', active: true }],
    functions: [{ slug: 'poll-tick', version: 41 }],
    ...overrides,
  }
}

function activeState(sequence = 3) {
  const observations = Array.from({ length: sequence }, (_, index) => ({
    observation_id: `00000000-0000-4000-8000-00000000000${index + 1}`,
    eligibility_window_start: `2026-07-27T16:0${index}:00.000Z`,
    observed_at: `2026-07-27T16:0${index}:01.000Z`,
    evidence_digest: `${index + 3}`.repeat(64),
  }))
  return {
    company: {
      id: '10000000-0000-4000-8000-000000000001',
      source_key: GOLDMAN_SOURCE_KEY,
      activation_state: sequence === 3 ? 'active' : 'experimental',
      activation_successes: sequence,
      last_error_code: null,
    },
    observations,
    replay_check: { status: 'PASS', reason: 'replay' },
    same_window_check: { status: 'PASS', reason: 'same_window' },
  }
}

function naturalPollState() {
  return {
    ...activeState(3),
    company: {
      ...activeState(3).company,
      last_polled_at: '2026-07-27T16:04:00.000Z',
      last_success_at: '2026-07-27T16:04:01.000Z',
      last_error_code: null,
    },
    open_job_count: 1,
    absence_closed_count: 0,
    persisted_jobs: [qualifyingJob()],
    feed_aging: {
      active_visible: false,
      provider_status: 'open',
      closed_at: null,
      applied_visible: true,
      dismissed_visible: true,
    },
    scheduler_owned: true,
    release_identity_matches: true,
  }
}

function harness({
  observation = completeObservation(),
  states = [activeState(1), activeState(2), activeState(3), naturalPollState()],
  failAt = null,
  protectedAfter = protectedSnapshot({
    companies: [{ source_key: 'oracle:jpmc:CX_1001', last_polled_at: 'after' }],
  }),
  residue = 0,
} = {}) {
  const calls = []
  let stateIndex = 0
  const artifacts = []
  const logs = []
  const manifest = {
    phase: '03.10',
    release_manifest_id: 'synthetic-manifest-non-production',
    source_key: GOLDMAN_SOURCE_KEY,
  }
  const hashes = {
    manifest_file_sha256: '3'.repeat(64),
    release_approval_payload_sha256: '4'.repeat(64),
  }
  const approval = 'synthetic exact approval non-production'
  const readOnly = {
    async probe() {
      calls.push('read-only:probe')
      if (failAt === 'probe') throw new Error(`probe ${SECRET}`)
      return observation
    },
    async checkApply() {
      calls.push('read-only:apply')
      return true
    },
  }
  const privileged = {
    async snapshotProtected() {
      calls.push('privileged:snapshot')
      const snapshotCalls = calls.filter((value) => value === 'privileged:snapshot')
      return snapshotCalls.length === 1 ? protectedSnapshot() : protectedAfter
    },
    async finalizeTerminal(input) {
      calls.push(`privileged:terminal:${input.outcome}`)
      if (failAt === 'terminal') throw new Error(`terminal ${SECRET}`)
      return {
        accepted: true,
        reason: input.outcome === 'admit_experimental'
          ? 'admitted_experimental'
          : 'recorded_unsupported',
        result_activation_state:
          input.outcome === 'admit_experimental' ? 'experimental' : 'disabled',
      }
    },
    async readSchedulerStatus() {
      calls.push('privileged:scheduler-read')
      if (failAt === 'scheduler') throw new Error(`scheduler ${SECRET}`)
      return states[Math.min(stateIndex++, states.length - 1)]
    },
    async assertUnsupportedNoAuthority() {
      calls.push('privileged:unsupported-no-authority')
      return true
    },
    async cleanup() {
      calls.push('privileged:cleanup')
      if (failAt === 'cleanup') throw new Error(`cleanup ${SECRET}`)
    },
    async residueCount() {
      calls.push('privileged:residue')
      return residue
    },
  }
  return {
    calls,
    artifacts,
    logs,
    manifest,
    manifestBytes: Buffer.from(JSON.stringify(manifest)),
    hashes,
    approval,
    controller: createActivationController({
      validateManifest: async () => {
        calls.push('validate')
        return hashes
      },
      exactApproval: () => approval,
      createReadOnlyClient: async () => {
        calls.push('create-read-only')
        return readOnly
      },
      createPrivilegedClient: async () => {
        calls.push('create-privileged')
        return privileged
      },
      now: () => NOW,
      monotonicNow: (() => {
        let value = 0
        return () => value += 10
      })(),
      sleep: async () => calls.push('sleep'),
      logger: (entry) => logs.push(entry),
      writeArtifact: async (path, value) => {
        calls.push(`write:${path}`)
        if (failAt === 'artifact') throw new Error(`artifact ${SECRET}`)
        artifacts.push([path, value])
      },
      secrets: [SECRET],
      maxWaitIterations: 8,
    }),
  }
}

test('exactProbe accepts only complete qualifying D-19 evidence', async () => {
  const result = await exactProbe({
    observation: completeObservation(),
    now: NOW,
    checkApply: async () => true,
  })
  assert.equal(result.job_count, 1)
  assert.equal(result.slice_count, 2)
  assert.equal(result.sample_job.source, 'goldman_higher')
  assert.match(result.evidence_digest, /^[a-f0-9]{64}$/)

  const staleJob = qualifyingJob({
    postedAt: '2026-06-27T15:59:59.999Z',
  })
  staleJob.scopeEvidence = {
    ...staleJob.scopeEvidence,
    postedAt: staleJob.postedAt,
  }
  await assert.rejects(
    exactProbe({
      observation: completeObservation({
        jobs: [staleJob],
      }),
      now: NOW,
      checkApply: async () => true,
    }),
    /posting_date_ineligible/,
  )
})

test('probe-only uses read-only dependencies and performs zero mutation or writes', async () => {
  const fixture = harness()
  const result = await fixture.controller.probeOnly()
  assert.equal(result.status, 'PASS')
  assert.deepEqual(fixture.calls, [
    'create-read-only',
    'read-only:probe',
    'read-only:apply',
  ])
  assert.deepEqual(fixture.artifacts, [])
})

test('approval drift rejects before privileged construction', async () => {
  const fixture = harness()
  await assert.rejects(
    fixture.controller.execute({
      manifest: fixture.manifest,
      manifestBytes: fixture.manifestBytes,
      approval: 'wrong',
      outputPath: 'out.json',
      evidencePath: 'out.md',
    }),
    /exact manifest-derived approval/,
  )
  assert.equal(fixture.calls.includes('create-privileged'), false)
})

test('positive proof admits once, accepts at most three scheduler windows, and waits for a later natural poll', async () => {
  const fixture = harness()
  const result = await fixture.controller.execute({
    manifest: fixture.manifest,
    manifestBytes: fixture.manifestBytes,
    approval: fixture.approval,
    outputPath: 'out.json',
    evidencePath: 'out.md',
  })
  assert.equal(result.status, 'PASS')
  assert.equal(result.activation.observations.length, 3)
  assert.equal(result.natural_poll.scheduler_owned, true)
  assert.equal(fixture.calls.filter((call) =>
    call === 'privileged:scheduler-read').length, 4)
  assert.equal(fixture.calls.some((call) =>
    call.includes('observe') || call.includes('poll-invoke')), false)
  assert.equal(fixture.calls.filter((call) =>
    call === 'privileged:cleanup').length, 1)
  assert.equal(fixture.calls.filter((call) =>
    call === 'privileged:residue').length, 1)
})

test('active resume validates approval first and never replays the terminal', async () => {
  const fixture = harness({
    states: [activeState(3), naturalPollState()],
  })
  await assert.rejects(
    fixture.controller.resumeActive({
      manifest: fixture.manifest,
      manifestBytes: fixture.manifestBytes,
      approval: 'wrong',
      outputPath: 'out.json',
      evidencePath: 'out.md',
    }),
    /exact manifest-derived approval/,
  )
  assert.equal(fixture.calls.includes('create-privileged'), false)

  const result = await fixture.controller.resumeActive({
    manifest: fixture.manifest,
    manifestBytes: fixture.manifestBytes,
    approval: fixture.approval,
    outputPath: 'out.json',
    evidencePath: 'out.md',
  })
  assert.equal(result.status, 'PASS')
  assert.equal(result.terminal.outcome, 'admit_experimental')
  assert.equal(result.terminal.resumed, true)
  assert.equal(
    fixture.calls.some((call) => call.startsWith('privileged:terminal:')),
    false,
  )
  assert.equal(
    fixture.calls.filter((call) => call === 'privileged:scheduler-read').length,
    2,
  )
  assert.equal(fixture.calls.includes('privileged:cleanup'), true)
  assert.equal(fixture.calls.includes('privileged:residue'), true)
})

test('active resume accepts equivalent PostgreSQL timestamptz serialization', async () => {
  const natural = naturalPollState()
  natural.persisted_jobs[0] = qualifyingJob({
    postedAt: '2026-07-25T16:00:00+00:00',
  })
  const fixture = harness({
    states: [activeState(3), natural],
  })
  const result = await fixture.controller.resumeActive({
    manifest: fixture.manifest,
    manifestBytes: fixture.manifestBytes,
    approval: fixture.approval,
    outputPath: 'out.json',
    evidencePath: 'out.md',
  })
  assert.equal(result.status, 'PASS')
  assert.equal(result.natural_poll.open_job_count, 1)
})

test('active resume requires exact Active 3/3 state and cleans up on failure', async () => {
  const fixture = harness({ states: [activeState(2)] })
  await assert.rejects(
    fixture.controller.resumeActive({
      manifest: fixture.manifest,
      manifestBytes: fixture.manifestBytes,
      approval: fixture.approval,
      outputPath: 'out.json',
      evidencePath: 'out.md',
    }),
    /active_resume_state_invalid/,
  )
  assert.equal(
    fixture.calls.some((call) => call.startsWith('privileged:terminal:')),
    false,
  )
  assert.equal(fixture.calls.includes('privileged:cleanup'), true)
  assert.equal(fixture.calls.includes('privileged:residue'), true)
})

test('active resume waits for a later healthy natural poll and redacts failures', async () => {
  const fixture = harness({
    states: [activeState(3)],
  })
  await assert.rejects(
    fixture.controller.resumeActive({
      manifest: fixture.manifest,
      manifestBytes: fixture.manifestBytes,
      approval: fixture.approval,
      outputPath: 'out.json',
      evidencePath: 'out.md',
    }),
    /natural_poll_timeout/,
  )
  assert.equal(fixture.calls.includes('privileged:cleanup'), true)
  const serialized = JSON.stringify({
    artifacts: fixture.artifacts,
    logs: fixture.logs,
  })
  assert.equal(serialized.includes(SECRET), false)
})

test('incomplete proof takes only precise Unsupported with zero authority', async () => {
  const fixture = harness({
    observation: completeObservation({
      completeness: 'unknown',
      credibleForClosure: false,
      expectedCount: 0,
      jobs: [],
      warnings: ['zero_eligible_jobs'],
    }),
  })
  const result = await fixture.controller.execute({
    manifest: fixture.manifest,
    manifestBytes: fixture.manifestBytes,
    approval: fixture.approval,
    outputPath: 'out.json',
    evidencePath: 'out.md',
  })
  assert.equal(result.status, 'UNSUPPORTED')
  assert.equal(result.unsupported_reason, 'positive_job_count_missing')
  assert.equal(
    fixture.calls.filter((call) =>
      call === 'privileged:terminal:unsupported').length,
    1,
  )
  assert.equal(
    fixture.calls.some((call) =>
      call === 'privileged:terminal:admit_experimental'),
    false,
  )
  assert.equal(
    fixture.calls.includes('privileged:unsupported-no-authority'),
    true,
  )
  assert.equal(fixture.calls.includes('privileged:cleanup'), true)
  assert.equal(fixture.calls.includes('privileged:residue'), true)
})

test('protected comparison ignores only enumerated scheduler-owned fields', () => {
  assert.equal(
    protectedSnapshotsEqual(
      protectedSnapshot(),
      protectedSnapshot({
        companies: [{
          source_key: 'oracle:jpmc:CX_1001',
          last_polled_at: 'ordinary scheduler drift',
        }],
      }),
    ),
    true,
  )
  assert.equal(
    protectedSnapshotsEqual(
      protectedSnapshot(),
      protectedSnapshot({
        users: [{ user_id: 'owner', row_count: 13, digest: 'drift' }],
      }),
    ),
    false,
  )
})

for (const failAt of [
  'probe',
  'terminal',
  'scheduler',
  'artifact',
  'cleanup',
]) {
  test(`cleanup, zero residue, and recursive redaction hold on ${failAt} failure`, async () => {
    const fixture = harness({ failAt })
    await assert.rejects(
      fixture.controller.execute({
        manifest: fixture.manifest,
        manifestBytes: fixture.manifestBytes,
        approval: fixture.approval,
        outputPath: 'out.json',
        evidencePath: 'out.md',
      }),
    )
    assert.equal(fixture.calls.includes('privileged:cleanup'), true)
    assert.equal(fixture.calls.includes('privileged:residue'), true)
    const serialized = JSON.stringify({
      calls: fixture.calls,
      artifacts: fixture.artifacts,
      logs: fixture.logs,
    })
    assert.equal(serialized.includes(SECRET), false)
  })
}

test('cleanup and zero residue run on timeout and assertion exits', async () => {
  const timeout = harness({ states: [activeState(1)] })
  await assert.rejects(
    timeout.controller.execute({
      manifest: timeout.manifest,
      manifestBytes: timeout.manifestBytes,
      approval: timeout.approval,
      outputPath: 'out.json',
      evidencePath: 'out.md',
    }),
    /activation_timeout/,
  )
  assert.equal(timeout.calls.includes('privileged:cleanup'), true)
  assert.equal(timeout.calls.includes('privileged:residue'), true)

  const invalid = activeState(1)
  invalid.company.source_key = 'oracle:jpmc:CX_1001'
  const assertion = harness({ states: [invalid] })
  await assert.rejects(
    assertion.controller.execute({
      manifest: assertion.manifest,
      manifestBytes: assertion.manifestBytes,
      approval: assertion.approval,
      outputPath: 'out.json',
      evidencePath: 'out.md',
    }),
    /activation_window_evidence_invalid/,
  )
  assert.equal(assertion.calls.includes('privileged:cleanup'), true)
  assert.equal(assertion.calls.includes('privileged:residue'), true)
})

test('residue and protected user drift fail closed after cleanup', async () => {
  const drift = harness({
    protectedAfter: protectedSnapshot({
      users: [{ user_id: 'owner', row_count: 99, digest: 'drift' }],
    }),
  })
  await assert.rejects(
    drift.controller.execute({
      manifest: drift.manifest,
      manifestBytes: drift.manifestBytes,
      approval: drift.approval,
      outputPath: 'out.json',
      evidencePath: 'out.md',
    }),
    /protected snapshot drift/,
  )
  const residue = harness({ residue: 1 })
  await assert.rejects(
    residue.controller.execute({
      manifest: residue.manifest,
      manifestBytes: residue.manifestBytes,
      approval: residue.approval,
      outputPath: 'out.json',
      evidencePath: 'out.md',
    }),
    /verifier residue/,
  )
})

test('redactSecrets recursively removes credentials from errors and nested causes', () => {
  const error = new Error(`outer ${SECRET}`, {
    cause: new Error(`inner ${SECRET}`),
  })
  const redacted = redactSecrets({ error, markdown: `# ${SECRET}` }, [SECRET])
  const serialized = JSON.stringify(redacted)
  assert.equal(serialized.includes(SECRET), false)
  assert.match(serialized, /\[credential-redacted\]/)
})

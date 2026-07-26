import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

import {
  ACTIVE_LATENCY_MS,
  FAMILY_ORDER,
  ManagementSqlOps,
  PLAN_05_HOSTED_SHA256,
  PROVIDER_REQUEST_LIMIT,
  RELEASE_MANIFEST_FILE_SHA256,
  RELEASE_MANIFEST_OBJECT_SHA256,
  RELEASE_SOURCE_COMMIT,
  assertFamilyOrder,
  assertRolloutEvidence,
  canonical,
  classifyProbe,
  createBoundedFetch,
  createDryRunPlan,
  exactApproval,
  executeRollout,
  exerciseVerifierFinally,
  mapUnsupportedReason,
  registerTypeScriptTranspileHook,
  sanitizeProbeEvidence,
  sha256,
  validateIdentityFiles,
  validateTimestampChain,
} from './run-phase-03-8-rollout.mjs'

const phaseDir =
  '.planning/phases/03.8-monitor-and-poll-the-branded-banking-companies-currently-on-'
const manifestPath = `${phaseDir}/03.8-05-RELEASE-MANIFEST.json`
const hostedPath = `${phaseDir}/03.8-05-HOSTED-VERIFICATION.json`

function timestamps(start = Date.parse('2026-07-26T18:00:00Z')) {
  return {
    activated_at: new Date(start).toISOString(),
    due_at: new Date(start + 10_000).toISOString(),
    claimed_at: new Date(start + 40_000).toISOString(),
    completed_at: new Date(start + 80_000).toISOString(),
    feed_visible_at: new Date(start + 90_000).toISOString(),
  }
}

function completeObservation(family) {
  return {
    completeness: 'complete',
    credibleForClosure: true,
    allowMissingClosure: true,
    jobs: [{
      externalId: 'safe-id',
      source: family.family,
      scopeEvidence: {
        sourceKey: family.sourceKey,
        providerCategoryLabel: 'Risk',
        matchedTerm: 'Risk',
        detailCountryCode: 'US',
        externalIdDigest: 'a'.repeat(64),
      },
    }],
    pageCount: 1,
    expectedCount: 1,
    warnings: [],
    scopeEvidence: {
      sourceKey: family.sourceKey,
      sliceDigests: ['b'.repeat(64)],
      categoryDigest: 'c'.repeat(64),
      countryDigest: 'd'.repeat(64),
    },
  }
}

test('identity gates bind the literal manifest, canonical object, hosted PASS, and source commit',
  async () => {
    const [manifestBytes, hostedBytes] = await Promise.all([
      readFile(manifestPath),
      readFile(hostedPath),
    ])
    assert.equal(sha256(manifestBytes), RELEASE_MANIFEST_FILE_SHA256)
    assert.equal(sha256(JSON.stringify(JSON.parse(manifestBytes))),
      RELEASE_MANIFEST_OBJECT_SHA256)
    assert.equal(sha256(hostedBytes), PLAN_05_HOSTED_SHA256)
    assert.equal(validateIdentityFiles({
      manifestBytes,
      hostedBytes,
      sourceCommit: RELEASE_SOURCE_COMMIT,
    }).hosted.status, 'PASS')
    assert.throws(() => validateIdentityFiles({
      manifestBytes,
      hostedBytes,
      sourceCommit: '0'.repeat(40),
    }), /source worktree/)
    const changed = Buffer.from(`${hostedBytes.toString().trim()} `)
    assert.throws(() => validateIdentityFiles({
      manifestBytes,
      hostedBytes: changed,
      sourceCommit: RELEASE_SOURCE_COMMIT,
    }), /hosted evidence hash drift/)
  })

test('dry run is inert and publishes the exact approval identity', async () => {
  const manifest = JSON.parse(await readFile(manifestPath))
  const plan = createDryRunPlan(manifest)
  assert.equal(plan.mode, 'DRY_RUN_NO_NETWORK_NO_MUTATION')
  assert.equal(plan.required_approval, exactApproval())
  assert.deepEqual(plan.family_order.map((item) => item.family),
    FAMILY_ORDER.map((item) => item.family))
})

test('family order is strict', () => {
  assert.equal(assertFamilyOrder(FAMILY_ORDER), FAMILY_ORDER)
  assert.throws(() => assertFamilyOrder([...FAMILY_ORDER].reverse()),
    /provider family order/)
})

test('unsupported reason mapping is exact and unknown reasons fail closed', () => {
  assert.equal(mapUnsupportedReason('deadline_exceeded'), 'provider_timeout')
  assert.equal(mapUnsupportedReason('category_evidence_missing'),
    'category_evidence_missing')
  assert.equal(mapUnsupportedReason('slice_count_mismatch'), 'count_mismatch')
  assert.throws(() => mapUnsupportedReason('some_new_provider_message'),
    /unmapped provider reason/)
})

test('timestamp chain enforces ordering, cron lateness, reserve, and latency', () => {
  assert.deepEqual(validateTimestampChain(timestamps()), timestamps())
  assert.throws(() => validateTimestampChain({
    ...timestamps(),
    claimed_at: '2026-07-26T18:02:00.000Z',
  }), /cron interval|ordered/)
  const late = timestamps()
  late.feed_visible_at = new Date(
    Date.parse(late.activated_at) + ACTIVE_LATENCY_MS + 1,
  ).toISOString()
  assert.throws(() => validateTimestampChain(late), /15 minutes/)
})

test('bounded fetch rejects request 301 and unapproved coordinates', async () => {
  let clock = 0
  const identity = {
    provider: 'eightfold',
    host: 'morganstanley.eightfold.ai',
    searchPath: '/api/pcsx/search',
    detailPath: '/api/pcsx/position_details',
  }
  const bounded = createBoundedFetch(
    identity,
    async () => new Response('{}'),
    () => clock,
  )
  await assert.rejects(
    bounded.fetch('https://evil.example/api/pcsx/search'),
    /unapproved network coordinate/,
  )
  const fresh = createBoundedFetch(
    identity,
    async () => new Response('{}'),
    () => clock,
  )
  for (let index = 0; index < PROVIDER_REQUEST_LIMIT; index += 1) {
    await fresh.fetch('https://morganstanley.eightfold.ai/api/pcsx/search')
  }
  await assert.rejects(
    fresh.fetch('https://morganstanley.eightfold.ai/api/pcsx/search'),
    /request limit/,
  )
  const timed = createBoundedFetch(
    identity,
    async () => new Response('{}'),
    () => clock,
  )
  clock = 120_001
  await assert.rejects(
    timed.fetch('https://morganstanley.eightfold.ai/api/pcsx/search'),
    /deadline/,
  )
})

test('synchronous TypeScript hook imports all three pinned adapter modules',
  async () => {
    registerTypeScriptTranspileHook(resolve('.'))
    const adapterRoot = resolve('supabase/functions/_shared/adapters')
    const [eightfold, oracle, goldman] = await Promise.all([
      import(pathToFileURL(resolve(adapterRoot, 'eightfold.ts'))),
      import(pathToFileURL(resolve(adapterRoot, 'oracle-recruiting.ts'))),
      import(pathToFileURL(resolve(adapterRoot, 'goldman-higher.ts'))),
    ])
    assert.equal(typeof eightfold.pollMorganStanleyEightfold, 'function')
    assert.equal(typeof oracle.pollJpmorganOracleRecruiting, 'function')
    assert.equal(typeof goldman.pollGoldmanHigher, 'function')
  })

test('probe evidence is bounded, sanitized, schema-shaped, and classifies positive',
  () => {
    const family = FAMILY_ORDER[0]
    const observation = completeObservation(family)
    observation.jobs[0].externalId =
      'https://example.test authorization=Bearer-super-secret'
    const evidence = sanitizeProbeEvidence(family, observation, 2, 25)
    assert.equal(evidence.schema_version, 1)
    assert.match(evidence.evidence_digest, /^[0-9a-f]{64}$/)
    assert.doesNotMatch(JSON.stringify(evidence), /Bearer-super-secret/)
    assert.equal(classifyProbe(family, completeObservation(family), 2, 25).positive,
      true)
    assert.equal(classifyProbe(family, {
      ...completeObservation(family),
      allowMissingClosure: false,
      warnings: ['scope_evidence_incomplete'],
    }, 2, 25).positive, false)
    assert.equal(classifyProbe(family, {
      ...completeObservation(family),
      expectedCount: 2,
      warnings: ['count_mismatch'],
    }, 2, 25).reason, 'count_mismatch')
    assert.equal(classifyProbe(family, {
      ...completeObservation(family),
      completeness: 'unknown',
      jobs: [],
      warnings: ['zero_eligible_jobs'],
    }, 2, 25).reason, 'positive_job_count_missing')
  })

function verifierOps({ failExercise = false } = {}) {
  const calls = []
  return {
    calls,
    async beginVerifier() {
      calls.push('begin')
      return {
        started: true,
        expires_at: new Date(Date.now() + 19 * 60_000).toISOString(),
        exercise_calls: 0,
        fixture_count: 3,
      }
    },
    async exerciseVerifier({ fixture, fault, expectedVersion }) {
      calls.push(`${fixture}:${fault}:${expectedVersion}`)
      if (failExercise && fixture === 'oracle_fixture'
        && fault === 'provider_schema_error') {
        throw new Error('injected exercise failure')
      }
      return {
        fixture_key: fixture,
        fixture_version: expectedVersion + 1,
        fault,
        job_status: 'open',
        activation_state: 'active',
        consecutive_failures: fault === 'clean_recovery' ? 0 : 1,
      }
    },
    async finishVerifier() {
      calls.push('finish')
      return {
        consumed: true,
        release_manifest_id: '03850000-0000-4000-8000-000000000005',
        run_id: '03850000-0000-4000-8000-000000000501',
        exercise_calls: 6,
        deleted_fixtures: 3,
        remaining_rows: 0,
        grants_revoked: true,
      }
    },
    async assertVerifierTerminal() {
      calls.push('terminal')
      return {
        run_rows: 0,
        fixture_rows: 0,
        company_rows: 0,
        job_rows: 0,
        observation_rows: 0,
        begin_execute: false,
        exercise_execute: false,
        finish_execute: false,
        post_finish_denied: true,
      }
    },
  }
}

test('verifier always finishes and asserts terminal cleanup after injected failure',
  async () => {
    const ops = verifierOps({ failExercise: true })
    await assert.rejects(
      exerciseVerifierFinally(ops, {
        release_manifest_id: '03850000-0000-4000-8000-000000000005',
      }),
      /injected exercise failure/,
    )
    assert.ok(ops.calls.includes('finish'))
    assert.equal(ops.calls.at(-1), 'terminal')
  })

test('rollout invokes terminal RPC only after each probe and runs verifier in finally',
  async () => {
    const events = []
    const verification = verifierOps()
    const ops = {
      ...verification,
      async assertReleaseIdentity() {
        events.push('identity')
      },
      async assertCandidatePending(family) {
        events.push(`pending:${family.family}`)
        return true
      },
      async finalizeCandidate({ sourceKey }) {
        events.push(`finalize:${sourceKey}`)
        return { accepted: true }
      },
      async awaitTerminalFamily({ family }) {
        events.push(`terminal:${family.family}`)
        return {
          family: family.family,
          source_key: family.sourceKey,
          status: 'PASS',
          outcome: 'active',
          activation_successes: 3,
          eligible_job_count: 1,
          natural_poll: true,
          timestamps: timestamps(),
        }
      },
      async assertFinalRollout() {
        return {
          status: 'PASS',
          catalog_rows: 10,
          protected_rows: 2,
          terminal: {
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
          },
        }
      },
    }
    const result = await executeRollout({
      manifest: {
        release_manifest_id: '03850000-0000-4000-8000-000000000005',
      },
      ops,
      probe: async (family) => {
        events.push(`probe:${family.family}`)
        return classifyProbe(family, completeObservation(family), 2, 25)
      },
    })
    assert.equal(result.status, 'PASS')
    assert.equal(result.hosted_evidence_sha256, PLAN_05_HOSTED_SHA256)
    Object.assign(result.fault_recovery, {
      real_company_sha256: '1'.repeat(64),
      real_job_sha256: '2'.repeat(64),
      real_companies_unchanged: true,
      real_jobs_unchanged: true,
      heartbeat_advanced: true,
      sibling_isolation: true,
    })
    assert.equal(assertRolloutEvidence(result, {
      release_manifest_id: '03850000-0000-4000-8000-000000000005',
    }).status, 'PASS')
    assert.throws(() => assertRolloutEvidence({
      ...result,
      unexpected: true,
    }, {
      release_manifest_id: '03850000-0000-4000-8000-000000000005',
    }), /keys are not exact/)
    const drifted = structuredClone(result)
    drifted.families.eightfold.probe.source_key = 'eightfold:drift'
    assert.throws(() => assertRolloutEvidence(drifted, {
      release_manifest_id: '03850000-0000-4000-8000-000000000005',
    }), /probe binding failed/)
    for (const family of FAMILY_ORDER) {
      assert.ok(events.indexOf(`probe:${family.family}`)
        < events.indexOf(`finalize:${family.sourceKey}`))
    }
    assert.deepEqual(
      events.filter((event) => event.startsWith('probe:')),
      FAMILY_ORDER.map((family) => `probe:${family.family}`),
    )
    assert.ok(verification.calls.includes('finish'))
  })

test('family error does not consume one-use verifier authority', async () => {
  const verification = verifierOps()
  const ops = {
    ...verification,
    async assertReleaseIdentity() {},
    async assertCandidatePending() {
      return false
    },
  }
  await assert.rejects(executeRollout({
    manifest: {
      release_manifest_id: '03850000-0000-4000-8000-000000000005',
    },
    ops,
    probe: async () => {
      throw new Error('probe must not run')
    },
  }), /not pristine pending/)
  assert.equal(verification.calls.length, 0)
})

test('ambiguous verifier response confirms cleanup but fails evidence closed',
  async () => {
    let terminalChecked = false
    await assert.rejects(exerciseVerifierFinally({
      async runVerifierTransaction() {
        throw new Error('response parsing failed after commit')
      },
      async assertVerifierTerminal() {
        terminalChecked = true
        return {
          run_rows: 0,
          fixture_rows: 0,
          company_rows: 0,
          job_rows: 0,
          observation_rows: 0,
          begin_execute: false,
          exercise_execute: false,
          finish_execute: false,
          post_finish_denied: true,
        }
      },
    }, {}), /cleanup is confirmed but rollout evidence is not provable/)
    assert.equal(terminalChecked, true)
  })

test('management SQL uses access-token API and leaves a final SELECT after commit',
  async () => {
    const queries = []
    const ops = new ManagementSqlOps({
      projectRef: 'fjcsvajkkztvlrpdplwx',
      accessToken: 'management-access-token-value',
      hosted: { status: 'PASS' },
      fetchImpl: async (url, init) => {
        queries.push({ url, init, query: JSON.parse(init.body).query })
        return new Response(JSON.stringify([{
          accepted: true,
          reason: 'recorded_unsupported',
          result_activation_state: 'disabled',
        }]), { status: 200 })
      },
    })
    const result = await ops.finalizeCandidate({
      sourceKey: 'eightfold:morganstanley',
      outcome: 'unsupported',
      reason: 'provider_timeout',
      evidenceDigest: 'a'.repeat(64),
    })
    assert.equal(result.accepted, true)
    assert.match(queries[0].url, /\/database\/query$/)
    assert.equal(queries[0].init.headers.authorization,
      'Bearer management-access-token-value')
    assert.match(queries[0].query,
      /set local role service_role[\s\S]+commit;[\s\S]+select \* from phase_03_8_finalize_result;/i)
    assert.doesNotMatch(queries[0].query, /drop table if exists/i)
  })

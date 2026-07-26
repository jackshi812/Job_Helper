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
  VERIFIER_REPAIR_PATH,
  VERIFIER_REPAIR_SHA256,
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
const repairPath = VERIFIER_REPAIR_PATH

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
    const [manifestBytes, hostedBytes, repairBytes] = await Promise.all([
      readFile(manifestPath),
      readFile(hostedPath),
      readFile(repairPath),
    ])
    assert.equal(sha256(manifestBytes), RELEASE_MANIFEST_FILE_SHA256)
    assert.equal(sha256(JSON.stringify(JSON.parse(manifestBytes))),
      RELEASE_MANIFEST_OBJECT_SHA256)
    assert.equal(sha256(hostedBytes), PLAN_05_HOSTED_SHA256)
    assert.equal(sha256(repairBytes), VERIFIER_REPAIR_SHA256)
    assert.equal(validateIdentityFiles({
      manifestBytes,
      hostedBytes,
      repairBytes,
      sourceCommit: RELEASE_SOURCE_COMMIT,
    }).hosted.status, 'PASS')
    assert.throws(() => validateIdentityFiles({
      manifestBytes,
      hostedBytes,
      repairBytes,
      sourceCommit: '0'.repeat(40),
    }), /source worktree/)
    const changed = Buffer.from(`${hostedBytes.toString().trim()} `)
    assert.throws(() => validateIdentityFiles({
      manifestBytes,
      hostedBytes: changed,
      repairBytes,
      sourceCommit: RELEASE_SOURCE_COMMIT,
    }), /hosted evidence hash drift/)
    assert.throws(() => validateIdentityFiles({
      manifestBytes,
      hostedBytes,
      repairBytes: Buffer.from(`${repairBytes.toString().trim()} `),
      sourceCommit: RELEASE_SOURCE_COMMIT,
    }), /forward verifier repair hash drift/)
  })

test('0041 is a forward-only, qualified, transaction-safe verifier repair',
  async () => {
    const [original, repair] = await Promise.all([
      readFile('supabase/migrations/0040_phase_03_8_branded_connectors.sql',
        'utf8'),
      readFile(repairPath, 'utf8'),
    ])
    assert.equal(sha256(original),
      '09ff62efcd82a13a4b5b4fbd06ea643f01f837196d1260e1d0d1f744601ce21f')
    assert.equal(sha256(repair), VERIFIER_REPAIR_SHA256)
    assert.equal(
      [...repair.matchAll(/create or replace function public\.(?:begin|exercise|finish)_phase_03_8_verifier_(?:run|fault)\(/g)].length,
      3,
    )
    assert.equal([...repair.matchAll(/\nsecurity definer\nset search_path = ''/g)].length,
      3)
    assert.match(repair,
      /verifier_run\.state = 'armed'[\s\S]+verifier_run\.started_at is null[\s\S]+verifier_run\.expires_at is null[\s\S]+verifier_run\.exercise_calls = 0[\s\S]+verifier_run\.max_exercise_calls = 12/)
    assert.match(repair,
      /verifier_fixture\.run_id =[\s\S]+verifier_company\.source_key in[\s\S]+verifier_job\.external_id like[\s\S]+verifier_observation\.observation_id in/)

    const forbiddenUnqualified = [
      /\bwhere run_id\b/i,
      /\band expires_at\b/i,
      /\band exercise_calls\b/i,
      /\band fixture_key\b/i,
      /\band fixture_version\b/i,
      /\band state\b/i,
      /\bselect status into\b/i,
      /\barray_agg\(company_id\b/i,
      /\barray_agg\(job_id\b/i,
      /\bwhere id =\b/i,
      /\bwhere source_key\b/i,
      /\breturning phase_03_8_verifier_runs\./i,
      /\bconsecutive_failures = consecutive_failures \+ 1\b/i,
      /\bexercise_calls = exercise_calls \+ 1\b/i,
      /\bfixture_version = fixture_version \+ 1\b/i,
    ]
    for (const pattern of forbiddenUnqualified) {
      assert.doesNotMatch(repair, pattern)
    }
    for (const qualified of [
      'verifier_run.expires_at',
      'verifier_run.exercise_calls',
      'verifier_fixture.fixture_key',
      'verifier_fixture.fixture_version',
      'verifier_job.status',
      'verifier_company.consecutive_failures',
      'v_company.activation_state',
      'v_company.last_error_code',
      'v_company.last_success_at',
    ]) {
      assert.ok(repair.includes(qualified), `${qualified} must remain qualified`)
    }

    const preconditionAt = repair.indexOf('do $$')
    const beginAt = repair.indexOf(
      'create or replace function public.begin_phase_03_8_verifier_run')
    const exerciseAt = repair.indexOf(
      'create or replace function public.exercise_phase_03_8_verifier_fault')
    const finishAt = repair.indexOf(
      'create or replace function public.finish_phase_03_8_verifier_run')
    const grantAt = repair.lastIndexOf(
      'grant execute on function public.begin_phase_03_8_verifier_run')
    assert.ok(preconditionAt >= 0 && preconditionAt < beginAt
      && beginAt < exerciseAt && exerciseAt < finishAt && finishAt < grantAt)
    assert.match(repair,
      /for update;[\s\S]+verifier_fixture\.fixture_version = p_expected_version[\s\S]+returning verifier_fixture\.\* into v_fixture/)
    assert.match(repair,
      /set state = 'consumed'[\s\S]+revoke execute on function public\.begin_phase_03_8_verifier_run[\s\S]+delete from public\.phase_03_8_verifier_runs as verifier_run[\s\S]+verifier residue remains/)
    assert.match(repair,
      /revoke execute on function public\.finish_phase_03_8_verifier_run\([\s\S]+from public, anon, authenticated;[\s\S]+grant execute on function public\.finish_phase_03_8_verifier_run\([\s\S]+to service_role;/)
  })

test('dry run is inert and publishes the exact approval identity', async () => {
  const manifest = JSON.parse(await readFile(manifestPath))
  const plan = createDryRunPlan(manifest)
  assert.equal(plan.mode, 'DRY_RUN_NO_NETWORK_NO_MUTATION')
  assert.equal(plan.required_approval, exactApproval())
  assert.equal(plan.verifier_repair_path, VERIFIER_REPAIR_PATH)
  assert.equal(plan.verifier_repair_sha256, VERIFIER_REPAIR_SHA256)
  assert.ok(exactApproval().endsWith(VERIFIER_REPAIR_SHA256))
  assert.deepEqual(plan.family_order.map((item) => item.family),
    FAMILY_ORDER.map((item) => item.family))
})

test('hosted identity fails closed when migration 0041 is absent', async () => {
  const ops = new ManagementSqlOps({
    projectRef: 'fjcsvajkkztvlrpdplwx',
    accessToken: 'management-access-token-value',
    hosted: { status: 'PASS' },
    fetchImpl: async () => new Response(JSON.stringify([{
      migrations: Array.from(
        { length: 40 },
        (_, index) => String(index + 1).padStart(4, '0'),
      ),
      armed_runs: 1,
      finalize_execute: true,
      exact_cron_rows: 2,
    }]), { status: 200 }),
  })
  ops.assertRemoteRuntimeIdentity = async () => true
  await assert.rejects(ops.assertReleaseIdentity({
    release_manifest_id: '03850000-0000-4000-8000-000000000005',
  }, PLAN_05_HOSTED_SHA256), /hosted release\/verifier identity drift/)
})

test('family order is strict', () => {
  assert.equal(assertFamilyOrder(FAMILY_ORDER), FAMILY_ORDER)
  assert.throws(() => assertFamilyOrder([...FAMILY_ORDER].reverse()),
    /provider family order/)
})

test('unsupported reason mapping is exact and unknown reasons fail closed', () => {
  const expectedReasons = {
    provider_timeout: [
      'provider_timeout',
      'deadline_exceeded',
      'fetch_failed',
      'network_error',
      'http_429',
    ],
    provider_schema_error: [
      'http_status',
      'invalid_json',
      'response_too_large',
      'provider_error',
      'provider_schema_error',
      'provider_schema_invalid',
      'invalid_identity',
      'invalid_clock',
      'redirect_rejected',
      'invalid_content_type',
      'payload_too_large',
      'malformed_response',
      'graphql_error',
      'detail_id_mismatch',
      'facet_label_mismatch',
      'slice_limit_mismatch',
      'slice_identity_mismatch',
      'slice_offset_mismatch',
      'cross_slice_id_drift',
    ],
    category_evidence_missing: ['category_evidence_missing'],
    scope_evidence_incomplete: [
      'scope_evidence_incomplete',
      'scope_evidence_invalid',
      'detail_evidence_missing',
      'detail_country_ineligible',
      'detail_category_ineligible',
    ],
    positive_job_count_missing: [
      'zero_eligible_jobs',
      'positive_job_count_missing',
    ],
    pagination_incomplete: [
      'page_cap_exceeded',
      'detail_cap_exceeded',
      'pagination_incomplete',
    ],
    count_mismatch: [
      'count_mismatch',
      'slice_count_mismatch',
      'duplicate_id',
      'duplicate_source_id',
      'job_cap_exceeded',
    ],
  }
  for (const [reason, codes] of Object.entries(expectedReasons)) {
    for (const code of codes) {
      assert.equal(mapUnsupportedReason(code), reason, code)
    }
  }
  for (const status of ['200', '400', '404', '500', '503']) {
    assert.equal(mapUnsupportedReason(`http_${status}`), 'provider_schema_error')
  }
  assert.equal(mapUnsupportedReason('http_429'), 'provider_timeout')
  assert.throws(() => mapUnsupportedReason('some_new_provider_message'),
    /unmapped provider reason/)
  assert.throws(() => mapUnsupportedReason('http_not_a_status'),
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
      async inspectCandidateStart(family) {
        events.push(`pending:${family.family}`)
        return {
          family: family.family,
          source_key: family.sourceKey,
          kind: 'pending',
        }
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
    assert.equal(result.verifier_repair_path, VERIFIER_REPAIR_PATH)
    assert.equal(result.verifier_repair_sha256, VERIFIER_REPAIR_SHA256)
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
    async inspectCandidateStart(family) {
      return {
        family: family.family,
        source_key: family.sourceKey,
        kind: 'ambiguous',
      }
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
  }), /candidate start state is invalid/)
  assert.equal(verification.calls.length, 0)
})

test('terminal Unsupported Morgan resumes safely and later probe failure stays partial',
  async () => {
    const events = []
    const verification = verifierOps()
    const ops = {
      ...verification,
      async assertReleaseIdentity() {
        events.push('identity')
      },
      async inspectCandidateStart(family) {
        events.push(`start:${family.family}`)
        if (family.family === 'eightfold') {
          return {
            family: family.family,
            source_key: family.sourceKey,
            kind: 'terminal_unsupported',
            reason: 'provider_schema_error',
            operational_rows: 0,
            evidence_rows: 1,
            positive_evidence_rows: 0,
            activation_successes: null,
            observation_rows: 0,
          }
        }
        return {
          family: family.family,
          source_key: family.sourceKey,
          kind: 'pending',
        }
      },
      async finalizeCandidate({ sourceKey, outcome, evidenceDigest }) {
        events.push(`finalize:${sourceKey}:${outcome}:${evidenceDigest}`)
        return { accepted: true }
      },
      async awaitTerminalFamily({ family }) {
        events.push(`terminal:${family.family}`)
        return {
          family: family.family,
          source_key: family.sourceKey,
          status: 'PASS',
          outcome: 'unsupported',
          reason: 'scope_evidence_incomplete',
          scheduled: false,
          monitored: false,
          operational_rows: 0,
        }
      },
    }
    await assert.rejects(executeRollout({
      manifest: {
        release_manifest_id: '03850000-0000-4000-8000-000000000005',
      },
      ops,
      nonce: () => 'resume-attempt-1',
      probe: async (family) => {
        events.push(`probe:${family.family}`)
        if (family.family === 'oracle_recruiting') {
          throw new Error('injected Oracle detail failure')
        }
        return classifyProbe(family, {
          ...completeObservation(family),
          completeness: 'unknown',
          credibleForClosure: false,
          allowMissingClosure: false,
          jobs: [],
          expectedCount: 0,
          warnings: ['detail_evidence_missing'],
        }, 2, 25)
      },
    }), /injected Oracle detail failure/)
    assert.ok(events.includes('start:eightfold'))
    assert.ok(events.includes('probe:eightfold'))
    assert.ok(events.some((event) =>
      event.startsWith('finalize:eightfold:morganstanley:unsupported:')))
    assert.ok(events.includes('terminal:eightfold'))
    assert.ok(events.includes('start:oracle_recruiting'))
    assert.ok(events.includes('probe:oracle_recruiting'))
    assert.equal(events.some((event) => event.includes('goldman_higher')), false)
    assert.equal(verification.calls.length, 0)
  })

test('Active resume re-probes and refuses downgrade on negative live evidence',
  async () => {
    let finalized = false
    const verification = verifierOps()
    await assert.rejects(executeRollout({
      manifest: {
        release_manifest_id: '03850000-0000-4000-8000-000000000005',
      },
      ops: {
        ...verification,
        async assertReleaseIdentity() {},
        async inspectCandidateStart(family) {
          return {
            family: family.family,
            source_key: family.sourceKey,
            kind: 'active',
            operational_rows: 1,
            evidence_rows: 1,
            positive_evidence_rows: 1,
            activation_successes: 3,
            observation_rows: 3,
          }
        },
        async finalizeCandidate() {
          finalized = true
          return { accepted: true }
        },
      },
      probe: async (family) => classifyProbe(family, {
        ...completeObservation(family),
        completeness: 'unknown',
        credibleForClosure: false,
        allowMissingClosure: false,
        jobs: [],
        expectedCount: 0,
        warnings: ['detail_evidence_missing'],
      }, 2, 25),
    }), /refusing mutation/)
    assert.equal(finalized, false)
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

test('verifier SQL scopes service role to RPC inserts, never direct verifier tables',
  async () => {
    let verifierSql = ''
    const ops = new ManagementSqlOps({
      projectRef: 'fjcsvajkkztvlrpdplwx',
      accessToken: 'management-access-token-value',
      hosted: { status: 'PASS' },
      fetchImpl: async (_url, init) => {
        verifierSql = JSON.parse(init.body).query
        return new Response(JSON.stringify([{
          consumed: true,
          release_manifest_id: '03850000-0000-4000-8000-000000000005',
          run_id: '03850000-0000-4000-8000-000000000501',
          exercise_calls: 6,
          deleted_fixtures: 3,
          remaining_rows: 0,
          grants_revoked: true,
          transition_rows: 6,
          real_company_sha256: '1'.repeat(64),
          real_job_sha256: '2'.repeat(64),
          real_companies_unchanged: true,
          real_jobs_unchanged: true,
          heartbeat_advanced: true,
          sibling_isolation: true,
          begin_denied: true,
          exercise_denied: true,
          finish_denied: true,
        }]), { status: 200 })
      },
    })
    assert.equal((await ops.runVerifierTransaction({
      release_manifest_id: '03850000-0000-4000-8000-000000000005',
    })).status, 'PASS')
    const scoped = []
    const lines = verifierSql.split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].trim() !== 'set local role service_role;') continue
      const body = []
      index += 1
      while (index < lines.length && lines[index].trim() !== 'reset role;') {
        body.push(lines[index])
        index += 1
      }
      scoped.push(body.join('\n'))
    }
    assert.equal(scoped.length, 8)
    for (const body of scoped) {
      assert.match(body, /insert into phase_03_8_runner_/i)
      assert.match(body,
        /public\.(?:begin|exercise|finish)_phase_03_8_verifier_/i)
      assert.doesNotMatch(body,
        /(?:from|update|delete from|join)\s+public\.phase_03_8_verifier_(?:runs|fixtures)/i)
    }
    assert.match(verifierSql,
      /grant insert, select on phase_03_8_runner_results to service_role/i)
    assert.match(verifierSql,
      /set local role anon;[\s\S]+anon verifier begin was callable[\s\S]+reset role;/i)
    assert.match(verifierSql,
      /set local role authenticated;[\s\S]+authenticated verifier finish was callable[\s\S]+reset role;/i)
    assert.match(verifierSql,
      /update public\.phase_03_8_verifier_runs[\s\S]+execute 'set local role service_role'/i)
    assert.match(verifierSql,
      /set expires_at = started_at \+ interval '1 microsecond'/i)
    assert.doesNotMatch(verifierSql,
      /set expires_at = clock_timestamp\(\) - interval '1 second'/i)
  })

test('management SQL errors include bounded diagnostics with credentials redacted',
  async () => {
    const token = 'management-access-token-value-that-must-not-leak'
    const ops = new ManagementSqlOps({
      projectRef: 'fjcsvajkkztvlrpdplwx',
      accessToken: token,
      hosted: { status: 'PASS' },
      fetchImpl: async () => new Response(
        `Authorization: Bearer ${token} ${'provider detail '.repeat(100)}`,
        { status: 400 },
      ),
    })
    await assert.rejects(ops.query('select broken'), (error) => {
      assert.match(error.message, /management SQL returned HTTP 400:/)
      assert.doesNotMatch(error.message, new RegExp(token))
      assert.ok(error.message.length < 600)
      return true
    })
  })

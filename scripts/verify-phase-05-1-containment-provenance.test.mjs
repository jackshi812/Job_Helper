import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

import {
  ALLOWED_PROVIDER_REQUESTS,
  CURRENT_BASELINE_COLLECTION_LIMITS,
  CURRENT_BASELINE_COLLECTION_REQUESTS,
  CURRENT_BASELINE_IMMUTABLE_BINDINGS,
  HISTORICAL_MUTATION_CHANNELS,
  IMMUTABLE_ANCHORS,
  PLAN_03_BOUNDARY,
  PROBE_LIMITS,
  ZERO_EFFECT_KEYS,
  acceptCurrentBaselineCollectionAuthorization,
  acceptHistoricalAuthorization,
  assertAuthorizedCurrentBaselineCollectionRecord,
  assertCurrentBaselineCollectionRequestRecord,
  assertProvenanceRecord,
  assertRequestRecord,
  buildPendingHistoricalRequest,
  canonical,
  classifyHistoricalRecovery,
  exactCurrentBaselineSignal,
  exactCurrentBaselineCollectionSignal,
  exactHistoricalSignal,
  executeAuthorizedHistoricalProbe,
  prepareFallbackAfterHistoricalFailure,
  prepareCurrentBaselineCollectionRequest,
  recordHistoricalFailure,
  sanitizeFailure,
  sealCurrentBaseline,
  sha256,
  validateProbeBudget,
  validateProviderRequest,
  validateReadOnlySql,
  verifyImmutableAnchors,
} from './verify-phase-05-1-containment-provenance.mjs'

const HASH = (digit) => digit.repeat(64)
const COMMIT = (digit) => digit.repeat(40)
const PROJECT_REF = 'fjcsvajkkztvlrpdplwx'

function fixtureAnchors() {
  const entries = [
    ['plan_02', '2', 'approval-v2\nscore_tick_window_started_at_utc: 2026-07-31T15:18:09.718Z\nscore_tick_window_ended_at_utc: 2026-08-01T15:18:09.718Z\nscore_tick_status: ACTIVE\nscore_tick_version: 16\nscore_tick_identity_sha256: 7c44495fb80ddf0caf48ac0a0210e7afe56967fb6e3c8b999078c57156d7dc20\nscore_tick_attribute_contract: {"deployment_id":true,"function_id":true,"response.status_code":true,"version":true}\nscore_tick_deployment_query_sha256: 0cd1388e768f5dabcad01ef1442a6ecabd7df152d1e72a4995b663d50399d438\nscore_tick_logs_query_sha256: 6ebfc0bdbf0634e0d396a558ab1f2415197fa22ea1bea7676a99e38b839f7697\nscore_tick_logs_output_sha256: 2ba411fb65a542bf4b349967e3a81b2528d107e12467c05bf677821f8b8f90d5\n'],
    ['plan_03_preflight', '3', 'preflight\n'],
    ['plan_03_deployment', '4', [
      'deployment',
      'target_supabase_project_ref: fjcsvajkkztvlrpdplwx',
      `source_commit: ${CURRENT_BASELINE_IMMUTABLE_BINDINGS.source_commit}`,
      `source_tree: ${CURRENT_BASELINE_IMMUTABLE_BINDINGS.source_tree}`,
      `migration_sha256: ${CURRENT_BASELINE_IMMUTABLE_BINDINGS.containment_migration_sha256}`,
      `post_0063_function_definition_sha256_observed: ${CURRENT_BASELINE_IMMUTABLE_BINDINGS.containment_function_definition_sha256}`,
      `post_0063_function_security_sha256_observed: ${CURRENT_BASELINE_IMMUTABLE_BINDINGS.containment_function_security_sha256}`,
      'remote_0063_count: 1',
      'remote_0062_count: 0',
      '',
    ].join('\n')],
    ['plan_03_summary', '5', 'summary\n'],
    ['blocked_plan_04', '6', '{"status":"fail"}\n'],
  ]
  return Object.fromEntries(entries.map(([name, digit, text]) => [name, {
    commit: COMMIT(digit),
    path: `.planning/${name}`,
    blob: COMMIT(String((Number(digit) + 5) % 10)),
    sha256: sha256(Buffer.from(text)),
    bytes: Buffer.from(text),
  }]))
}

function fakeGit(anchors, mutations = {}) {
  const calls = []
  const byCommitPath = new Map(Object.values(anchors).map((anchor) => [
    `${anchor.commit}:${anchor.path}`,
    anchor,
  ]))
  const byBlob = new Map(Object.values(anchors).map((anchor) => [anchor.blob, anchor]))
  const run = async (args) => {
    calls.push([...args])
    if (mutations.throwOn?.(args)) throw new Error('git fixture failure')
    if (args[0] === 'cat-file' && args[1] === '-e') return Buffer.alloc(0)
    if (args[0] === 'rev-parse') {
      const anchor = byCommitPath.get(args[1])
      if (!anchor) throw new Error('unknown commit:path')
      return Buffer.from(`${mutations.blobFor?.(anchor) ?? anchor.blob}\n`)
    }
    if (args[0] === 'cat-file' && args[1] === '-p') {
      const anchor = byBlob.get(args[2])
      if (!anchor) throw new Error('unknown blob')
      return mutations.bytesFor?.(anchor) ?? anchor.bytes
    }
    throw new Error(`unexpected git argv: ${args.join(' ')}`)
  }
  return { run, calls }
}

function historicalEvidence(overrides = {}) {
  const functionId = 'process-only-function-id'
  const deploymentId = 'process-only-deployment-id'
  const command = 'process-only-cron-command'
  const before = {
    observed_at: '2026-08-01T16:39:09.000Z',
    function_id: functionId,
    deployment_id: deploymentId,
    version: 16,
    status: 'ACTIVE',
    verify_jwt: false,
  }
  const after = { ...before, observed_at: '2026-08-01T16:39:18.000Z' }
  const schedulerBefore = {
    observed_at: '2026-08-01T16:39:09.000Z',
    jobname: 'score-tick-every-minute',
    schedule: '* * * * *',
    command,
    active: true,
  }
  const schedulerAfter = {
    ...schedulerBefore,
    observed_at: '2026-08-01T16:39:18.000Z',
  }
  return {
    official_contract: {
      official_contract_sha256: HASH('a'),
      independently_immutable: true,
      retention_complete: true,
      retained_from: '2026-08-01T00:00:00.000Z',
      retained_through: '2026-08-02T00:00:00.000Z',
      pagination_complete: true,
      terminal_page_token_observed: true,
      field_semantics_complete: true,
      mutation_channels: [...HISTORICAL_MUTATION_CHANNELS],
    },
    edge: {
      before: [before],
      after: [after],
      deployment_events: [],
      pages: 2,
      result_sha256: HASH('b'),
    },
    scheduler: {
      before: [schedulerBefore],
      after: [schedulerAfter],
      mutation_events: [],
      pages: 2,
      result_sha256: HASH('c'),
    },
    request_count: 5,
    page_count: 4,
    response_bytes: 10_000,
    elapsed_ms: 1_000,
    ...overrides,
  }
}

function currentSnapshot(overrides = {}) {
  return {
    observed_at: '2026-08-01T18:00:00.000Z',
    project_ref_sha256: CURRENT_BASELINE_IMMUTABLE_BINDINGS.project_ref_sha256,
    migration_inventory_sha256:
      CURRENT_BASELINE_IMMUTABLE_BINDINGS.migration_inventory_sha256,
    migration_0063_count: 1,
    migration_0062_count: 0,
    containment_function_definition_sha256:
      CURRENT_BASELINE_IMMUTABLE_BINDINGS.containment_function_definition_sha256,
    containment_function_security_sha256:
      CURRENT_BASELINE_IMMUTABLE_BINDINGS.containment_function_security_sha256,
    score_tick_function_id_sha256: HASH('5'),
    score_tick_deployment_id_sha256: HASH('6'),
    score_tick_function_version: 16,
    score_tick_status: 'ACTIVE',
    score_tick_verify_jwt: false,
    score_tick_runtime_tuple_sha256: HASH('7'),
    scheduler_identity_sha256: HASH('8'),
    scheduler_active: true,
    ...overrides,
  }
}

function jsonResponse(value, { status = 200 } = {}) {
  const bytes = Buffer.from(JSON.stringify(value))
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => bytes,
  }
}

function authorizedProbeFixture() {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), method: options.method })
    if (String(url).endsWith('/functions')) {
      return jsonResponse([{
        slug: 'score-tick',
        id: 'process-only-function-id',
        deployment_id: 'process-only-deployment-id',
        version: 16,
        status: 'ACTIVE',
        verify_jwt: false,
      }])
    }
    if (String(url).includes('/analytics/endpoints/logs')) {
      return jsonResponse([{ bounded_count: 2 }])
    }
    return jsonResponse([{
      migration_inventory_sha256:
        CURRENT_BASELINE_IMMUTABLE_BINDINGS.migration_inventory_sha256,
      migration_0063_count: 1,
      migration_0062_count: 0,
      containment_function_definition_sha256:
        CURRENT_BASELINE_IMMUTABLE_BINDINGS.containment_function_definition_sha256,
      containment_function_security_sha256:
        CURRENT_BASELINE_IMMUTABLE_BINDINGS.containment_function_security_sha256,
      scheduler_job_count: 1,
      scheduler_active_count: 1,
      scheduler_identity_sha256: HASH('4'),
    }])
  }
  return { calls, fetchImpl }
}

async function historicalIrrecoverableFixture() {
  const anchors = fixtureAnchors()
  const pending = await buildPendingHistoricalRequest({
    git: fakeGit(anchors).run,
    anchors,
  })
  const accepted = acceptHistoricalAuthorization(
    pending,
    pending.historical_probe_authorization.required_signal_sha256,
  )
  return recordHistoricalFailure(accepted, 'historical_transport_failure', {
    request_count: 6,
    page_count: 2,
    response_bytes: 0,
    elapsed_ms: 0,
  })
}

test('production immutable anchor constants are fixed and complete', () => {
  assert.deepEqual(Object.keys(IMMUTABLE_ANCHORS), [
    'plan_02',
    'plan_03_preflight',
    'plan_03_deployment',
    'plan_03_summary',
    'blocked_plan_04',
  ])
  assert.deepEqual(PLAN_03_BOUNDARY, {
    before: '2026-08-01T16:39:10.434Z',
    after: '2026-08-01T16:39:16.746Z',
  })
  for (const anchor of Object.values(IMMUTABLE_ANCHORS)) {
    assert.match(anchor.commit, /^[0-9a-f]{40}$/)
    assert.match(anchor.blob, /^[0-9a-f]{40}$/)
    assert.match(anchor.sha256, /^[0-9a-f]{64}$/)
    assert.ok(anchor.path.startsWith('.planning/'))
  }
})

test('anchor verifier resolves exact commit:path blobs and raw-byte hashes', async () => {
  const anchors = fixtureAnchors()
  const git = fakeGit(anchors)
  const result = await verifyImmutableAnchors({ git: git.run, anchors })
  assert.equal(result.plan_02.sha256, anchors.plan_02.sha256)
  assert.equal(result.plan_03_deployment.blob, anchors.plan_03_deployment.blob)
  assert.equal(git.calls.some((args) => args.includes('HEAD')), false)
})

test('missing commit, wrong path/blob/SHA, and changed bytes fail independently', async () => {
  const anchors = fixtureAnchors()
  const cases = [
    { throwOn: (args) => args[0] === 'cat-file' && args[1] === '-e' },
    { throwOn: (args) => args[0] === 'rev-parse' },
    { blobFor: () => COMMIT('f') },
    { bytesFor: () => Buffer.from('changed\n') },
  ]
  for (const mutation of cases) {
    await assert.rejects(
      verifyImmutableAnchors({ git: fakeGit(anchors, mutation).run, anchors }),
      /anchor_/,
    )
  }

  const wrongSha = structuredClone(anchors)
  wrongSha.plan_03_summary.sha256 = HASH('f')
  await assert.rejects(
    verifyImmutableAnchors({ git: fakeGit(anchors).run, anchors: wrongSha }),
    /anchor_/,
  )
})

test('retroactively inserted Plan 03 runtime keys stop before provider dependency', async () => {
  const anchors = fixtureAnchors()
  let providerCalls = 0
  const git = fakeGit(anchors, {
    bytesFor: (anchor) => anchor === anchors.plan_03_deployment
      ? Buffer.from('score_tick_function_id: forged\n')
      : anchor.bytes,
  })
  await assert.rejects(
    verifyImmutableAnchors({
      git: git.run,
      anchors,
      afterAnchors: async () => { providerCalls += 1 },
    }),
    /plan_03_runtime_key_present/,
  )
  assert.equal(providerCalls, 0)
})

test('malformed Plan 02 corroboration fails without decoding the opaque digest', async () => {
  const anchors = fixtureAnchors()
  anchors.plan_02.bytes = Buffer.from('score_tick_version: 16\n')
  anchors.plan_02.sha256 = sha256(anchors.plan_02.bytes)
  await assert.rejects(
    verifyImmutableAnchors({ git: fakeGit(anchors).run, anchors }),
    /plan_02_corroboration_invalid/,
  )
})

test('provider allowlist is literal and SQL remains aggregate SELECT/CTE-only', () => {
  assert.deepEqual(ALLOWED_PROVIDER_REQUESTS, [
    ['GET', '/v1/projects/{ref}/functions'],
    ['GET', '/v1/projects/{ref}/analytics/endpoints/logs'],
    ['POST', '/v1/projects/{ref}/database/query'],
  ])
  assert.doesNotThrow(() => validateReadOnlySql(
    'with x as (select count(*) as count from public.jobs) select max(count) as count from x',
  ))
  for (const sql of [
    'select * from public.jobs',
    'select id from public.jobs',
    'update public.jobs set status = \'closed\'',
    'with x as (delete from public.jobs returning *) select count(*) from x',
    'select public.enqueue_deterministic_new_jobs(25)',
    'select count(*) from public.jobs; select 1',
  ]) assert.throws(() => validateReadOnlySql(sql), /read_only/)

  for (const [method, path] of [
    ['POST', '/v1/projects/{ref}/functions/score-tick'],
    ['PATCH', '/v1/projects/{ref}/functions'],
    ['POST', '/v1/projects/{ref}/database/migrations'],
    ['DELETE', '/v1/projects/{ref}/database/query'],
    ['GET', '/v1/projects/{ref}/*'],
  ]) {
    assert.throws(() => validateProviderRequest({ method, path }), /provider_request/)
  }
})

test('provider requests enforce query/body shapes and finite bounds', () => {
  assert.doesNotThrow(() => validateProviderRequest({
    method: 'GET',
    path: '/v1/projects/{ref}/functions',
    query: {},
  }))
  assert.doesNotThrow(() => validateProviderRequest({
    method: 'POST',
    path: '/v1/projects/{ref}/database/query',
    query: {},
    body: { query: 'select count(*) as count from public.jobs' },
  }))
  assert.throws(() => validateProviderRequest({
    method: 'GET',
    path: '/v1/projects/{ref}/functions',
    query: { unbounded: 'true' },
  }), /provider_request/)
  assert.throws(() => validateProviderRequest({
    method: 'POST',
    path: '/v1/projects/{ref}/database/query',
    query: {},
    body: { query: 'select count(*) from public.jobs', extra: true },
  }), /provider_request/)

  assert.ok(PROBE_LIMITS.max_requests > 0)
  assert.ok(PROBE_LIMITS.max_pages > 0)
  assert.ok(PROBE_LIMITS.max_response_bytes > 0)
  assert.ok(PROBE_LIMITS.timeout_ms > 0)
  assert.doesNotThrow(() => validateProbeBudget({
    request_count: PROBE_LIMITS.max_requests,
    page_count: PROBE_LIMITS.max_pages,
    response_bytes: PROBE_LIMITS.max_response_bytes,
    elapsed_ms: PROBE_LIMITS.timeout_ms,
  }))
  for (const key of ['request_count', 'page_count', 'response_bytes', 'elapsed_ms']) {
    const values = {
      request_count: PROBE_LIMITS.max_requests,
      page_count: PROBE_LIMITS.max_pages,
      response_bytes: PROBE_LIMITS.max_response_bytes,
      elapsed_ms: PROBE_LIMITS.timeout_ms,
    }
    values[key] += 1
    assert.throws(() => validateProbeBudget(values), /historical_probe_bound_exceeded/)
  }
})

test('complete immutable Edge and scheduler chains recover one hash-only runtime', () => {
  const classified = classifyHistoricalRecovery(historicalEvidence())
  assert.equal(classified.status, 'historical_recovered')
  assert.equal(classified.historical_deployment_identity_recovered, true)
  assert.equal(classified.runtime.score_tick_function_version, 16)
  assert.match(classified.runtime.score_tick_function_id_sha256, /^[0-9a-f]{64}$/)
  assert.match(classified.runtime.score_tick_deployment_id_sha256, /^[0-9a-f]{64}$/)
  assert.match(classified.runtime.scheduler_identity_sha256, /^[0-9a-f]{64}$/)
  assert.equal(JSON.stringify(classified).includes('process-only'), false)
})

test('current snapshots can never be presented as historical evidence', () => {
  const evidence = historicalEvidence({ source_kind: 'current_snapshot' })
  const result = classifyHistoricalRecovery(evidence)
  assert.equal(result.status, 'historical_irrecoverable')
  assert.deepEqual(result.reasons, ['historical_current_state_substitution'])
})

test('historical contract, retention, pagination, and mutation coverage fail distinctly', () => {
  const cases = [
    [(value) => { value.official_contract.independently_immutable = false }, 'historical_provider_contract_unverified'],
    [(value) => { value.official_contract.retention_complete = false }, 'historical_retention_incomplete'],
    [(value) => { value.official_contract.retained_from = '2026-08-01T16:39:11.000Z' }, 'historical_retention_incomplete'],
    [(value) => { value.official_contract.pagination_complete = false }, 'historical_pagination_incomplete'],
    [(value) => { value.official_contract.terminal_page_token_observed = false }, 'historical_pagination_incomplete'],
    [(value) => { value.official_contract.mutation_channels.pop() }, 'historical_mutation_channel_coverage_incomplete'],
  ]
  for (const [mutate, reason] of cases) {
    const value = historicalEvidence()
    mutate(value)
    const result = classifyHistoricalRecovery(value)
    assert.equal(result.status, 'historical_irrecoverable')
    assert.deepEqual(result.reasons, [reason])
  }
})

test('no-match, duplicate/mixed Edge tuple, event, and boundary gaps fail distinctly', () => {
  const cases = [
    [(value) => { value.edge.before = [] }, 'historical_edge_no_match'],
    [(value) => { value.edge.after.push(structuredClone(value.edge.after[0])) }, 'historical_edge_ambiguous'],
    [(value) => { value.edge.after[0].deployment_id = 'different' }, 'historical_edge_mixed_tuple'],
    [(value) => { value.edge.deployment_events.push({ type: 'deploy' }) }, 'historical_edge_deployment_event_present'],
    [(value) => { value.edge.before[0].observed_at = PLAN_03_BOUNDARY.after }, 'historical_edge_boundary_gap'],
  ]
  for (const [mutate, reason] of cases) {
    const value = historicalEvidence()
    mutate(value)
    assert.deepEqual(classifyHistoricalRecovery(value).reasons, [reason])
  }
})

test('scheduler no-match, ambiguity, drift, mutation, inactive state, and gap fail distinctly', () => {
  const cases = [
    [(value) => { value.scheduler.before = [] }, 'historical_scheduler_no_match'],
    [(value) => { value.scheduler.after.push(structuredClone(value.scheduler.after[0])) }, 'historical_scheduler_ambiguous'],
    [(value) => { value.scheduler.after[0].command = 'different' }, 'historical_scheduler_mixed_tuple'],
    [(value) => { value.scheduler.mutation_events.push({ type: 'sql' }) }, 'historical_scheduler_mutation_present'],
    [(value) => { value.scheduler.after[0].active = false }, 'historical_scheduler_inactive'],
    [(value) => { value.scheduler.after[0].observed_at = PLAN_03_BOUNDARY.before }, 'historical_scheduler_boundary_gap'],
  ]
  for (const [mutate, reason] of cases) {
    const value = historicalEvidence()
    mutate(value)
    assert.deepEqual(classifyHistoricalRecovery(value).reasons, [reason])
  }
})

test('transport, parser, timeout, and bound failures are sanitized and never pass', () => {
  for (const reason of [
    'historical_transport_failure',
    'historical_response_parse_failure',
    'historical_probe_timeout',
  ]) {
    const result = classifyHistoricalRecovery({ failure_reason: reason })
    assert.equal(result.status, 'historical_irrecoverable')
    assert.deepEqual(result.reasons, [reason])
  }
  const over = historicalEvidence({ request_count: PROBE_LIMITS.max_requests + 1 })
  assert.deepEqual(classifyHistoricalRecovery(over).reasons, ['historical_probe_bound_exceeded'])

  const failure = sanitizeFailure('historical_transport_failure', {
    access_token: 'sbp_secret',
    response_body: 'private',
    function_id: 'raw-id',
  })
  assert.deepEqual(failure, { status: 'historical_irrecoverable', reasons: ['historical_transport_failure'] })
})

test('pending request is canonical, hash-bound, zero-effect, and not pass provenance', async () => {
  const anchors = fixtureAnchors()
  const request = await buildPendingHistoricalRequest({
    git: fakeGit(anchors).run,
    anchors,
  })
  assert.equal(request.status, 'pending_historical_authorization')
  assert.equal(request.provenance_mode, null)
  assert.equal(request.historical_deployment_identity_recovered, false)
  assert.equal(request.later_deployment_authorized, false)
  assert.ok(Object.values(request.zero_effect_scope).every((value) => value === 0))
  assert.deepEqual(assertRequestRecord(request, { skipGit: true }), request)
  assert.throws(() => assertProvenanceRecord(request), /record_not_pass/)
  const payload = request.historical_probe_authorization.payload
  assert.equal(
    request.historical_probe_authorization.payload_sha256,
    sha256(canonical(payload)),
  )
  assert.equal(
    request.historical_probe_authorization.required_signal_sha256,
    sha256(exactHistoricalSignal(request)),
  )
})

test('request exact schemas reject extras, changed bounds, nonzero effects, and authority', async () => {
  const anchors = fixtureAnchors()
  const original = await buildPendingHistoricalRequest({ git: fakeGit(anchors).run, anchors })
  for (const mutate of [
    (value) => { value.extra = true },
    (value) => { value.historical_probe_authorization.payload.limits.max_pages += 1 },
    (value) => { value.zero_effect_scope.scheduler_mutations = 1 },
    (value) => { value.later_deployment_authorized = true },
    (value) => { value.historical_deployment_identity_recovered = true },
  ]) {
    const value = structuredClone(original)
    mutate(value)
    assert.throws(() => assertRequestRecord(value, { skipGit: true }), /request_/)
  }
})

test('pass modes are mutually exclusive and historical irrecoverable is non-consumable', async () => {
  const anchors = fixtureAnchors()
  const pending = await buildPendingHistoricalRequest({ git: fakeGit(anchors).run, anchors })
  const recovered = structuredClone(pending)
  recovered.status = 'pass'
  recovered.provenance_mode = 'historical_recovered'
  recovered.historical_deployment_identity_recovered = true
  recovered.runtime = classifyHistoricalRecovery(historicalEvidence()).runtime
  recovered.historical_recovery = classifyHistoricalRecovery(historicalEvidence()).historical_recovery
  recovered.historical_probe_authorization.status = 'authorized_and_completed'
  recovered.reasons = []
  assert.deepEqual(assertProvenanceRecord(recovered), recovered)

  const mixed = structuredClone(recovered)
  mixed.current_baseline = currentSnapshot()
  assert.throws(() => assertProvenanceRecord(mixed), /mode_schema_invalid/)

  const irrecoverable = structuredClone(pending)
  irrecoverable.status = 'historical_irrecoverable'
  irrecoverable.provenance_mode = 'historical_irrecoverable'
  irrecoverable.historical_recovery = {
    status: 'historical_irrecoverable',
    reasons: ['historical_retention_incomplete'],
    proof_sha256: HASH('d'),
  }
  irrecoverable.reasons = ['historical_retention_incomplete']
  assert.throws(() => assertProvenanceRecord(irrecoverable), /record_not_pass/)
})

test('current baseline sealing requires separate exact owner signal and no drift', async () => {
  const anchors = fixtureAnchors()
  const pending = await buildPendingHistoricalRequest({ git: fakeGit(anchors).run, anchors })
  pending.status = 'pending_current_baseline_authorization'
  pending.provenance_mode = 'historical_irrecoverable'
  pending.historical_recovery = {
    status: 'historical_irrecoverable',
    reasons: ['historical_retention_incomplete'],
    proof_sha256: HASH('d'),
  }
  pending.current_baseline = currentSnapshot()
  pending.owner_checkpoint = {
    status: 'pending',
    payload_serialization: 'canonical_json_sorted_keys_v1',
    payload_sha256: '',
    required_signal_sha256: '',
    accepted_signal_sha256: null,
  }
  const payload = {
    anchors: pending.anchors,
    historical_recovery: pending.historical_recovery,
    current_baseline_collection_authorization: null,
    current_baseline: pending.current_baseline,
    window_seconds: 86_400,
    zero_effect_scope: pending.zero_effect_scope,
    later_deployment_authorized: false,
  }
  pending.owner_checkpoint.payload_sha256 = sha256(canonical(payload))
  pending.owner_checkpoint.required_signal_sha256 = sha256(exactCurrentBaselineSignal(pending))
  const signal = exactCurrentBaselineSignal(pending)

  assert.throws(() => sealCurrentBaseline(pending, 'generic yes', currentSnapshot()), /owner_signal_invalid/)
  assert.throws(() => sealCurrentBaseline(pending, signal, currentSnapshot({ scheduler_identity_sha256: HASH('e') })), /current_baseline_drift/)
  const sealed = sealCurrentBaseline(pending, signal, currentSnapshot())
  assert.equal(sealed.status, 'pass')
  assert.equal(sealed.provenance_mode, 'current_baseline_redesign')
  assert.equal(sealed.historical_deployment_identity_recovered, false)
  assert.equal(sealed.owner_checkpoint.accepted_signal_sha256, sha256(signal))
  assert.equal(JSON.stringify(sealed).includes(signal), false)
  assert.deepEqual(assertProvenanceRecord(sealed), sealed)
})

test('raw identities, credentials, commands, bodies, rows, logs, and owner signal text never persist', async () => {
  const anchors = fixtureAnchors()
  const request = await buildPendingHistoricalRequest({ git: fakeGit(anchors).run, anchors })
  const serialized = JSON.stringify(request)
  for (const forbidden of [
    'SUPABASE_ACCESS_TOKEN',
    'sbp_',
    'process-only-function-id',
    'process-only-deployment-id',
    'process-only-cron-command',
    'response_body',
    'raw_rows',
    'owner_signal',
  ]) assert.equal(serialized.includes(forbidden), false)
  assert.deepEqual(Object.keys(request.zero_effect_scope), [...ZERO_EFFECT_KEYS])
})

test('offline CLI prepares and asserts a request without credentials or network output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'containment-provenance-test-'))
  try {
    const output = join(root, 'request.json')
    const cleanEnv = { ...process.env }
    delete cleanEnv.SUPABASE_ACCESS_TOKEN
    const prepared = spawnSync(process.execPath, [
      'scripts/verify-phase-05-1-containment-provenance.mjs',
      '--prepare-historical-request',
      '--output',
      output,
    ], { encoding: 'utf8', env: cleanEnv })
    assert.equal(prepared.status, 0, prepared.stderr)
    const record = JSON.parse(await readFile(output, 'utf8'))
    assert.equal(record.status, 'pending_historical_authorization')

    const asserted = spawnSync(process.execPath, [
      'scripts/verify-phase-05-1-containment-provenance.mjs',
      '--assert-request',
      output,
    ], { encoding: 'utf8', env: cleanEnv })
    assert.equal(asserted.status, 0, asserted.stderr)
    assert.match(asserted.stdout, /payload_sha256/)
    assert.match(asserted.stdout, /authorize Plan 05\.1-13 historical read-only probe/)
    assert.doesNotMatch(`${asserted.stdout}${asserted.stderr}`, /sbp_|Bearer|raw-id/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('canonical serialization sorts object keys and preserves array order', () => {
  assert.equal(canonical({ b: 2, a: [3, { d: 4, c: 5 }] }),
    '{"a":[3,{"c":5,"d":4}],"b":2}')
})

test('authorized probe validates the exact owner signal before credentials or transport', async () => {
  const anchors = fixtureAnchors()
  const pending = await buildPendingHistoricalRequest({
    git: fakeGit(anchors).run,
    anchors,
  })
  let credentialLoads = 0
  let providerCalls = 0
  await assert.rejects(executeAuthorizedHistoricalProbe({
    record: pending,
    ownerSignal: 'generic approval',
    verifyAnchors: async () => {},
    loadProjectRef: async () => PROJECT_REF,
    loadAccessToken: () => {
      credentialLoads += 1
      return 'process-only-token'
    },
    fetchImpl: async () => {
      providerCalls += 1
      return jsonResponse([])
    },
  }), /historical_probe_not_authorized/)
  assert.equal(credentialLoads, 0)
  assert.equal(providerCalls, 0)
})

test('accepted authorization persists only the verified signal hash', async () => {
  const anchors = fixtureAnchors()
  const pending = await buildPendingHistoricalRequest({
    git: fakeGit(anchors).run,
    anchors,
  })
  assert.throws(() => acceptHistoricalAuthorization(pending, HASH('f')),
    /historical_probe_not_authorized/)
  const accepted = acceptHistoricalAuthorization(
    pending,
    pending.historical_probe_authorization.required_signal_sha256,
  )
  assert.equal(accepted.status, 'historical_probe_authorized')
  assert.equal(accepted.historical_probe_authorization.status, 'accepted')
  assert.equal(accepted.historical_probe_authorization.accepted_signal_sha256,
    pending.historical_probe_authorization.required_signal_sha256)
  assert.equal(JSON.stringify(accepted).includes(exactHistoricalSignal(pending)), false)
})

test('authorized probe is bounded, allowlisted, hash-only, and stops at fallback approval', async () => {
  const anchors = fixtureAnchors()
  const pending = await buildPendingHistoricalRequest({
    git: fakeGit(anchors).run,
    anchors,
  })
  pending.status = 'historical_probe_authorized'
  pending.historical_probe_authorization.status = 'accepted'
  pending.historical_probe_authorization.accepted_signal_sha256 =
    pending.historical_probe_authorization.required_signal_sha256
  pending.reasons = []
  const fixture = authorizedProbeFixture()
  const prepared = await executeAuthorizedHistoricalProbe({
    record: pending,
    ownerSignal: null,
    verifyAnchors: async () => {},
    loadProjectRef: async () => PROJECT_REF,
    loadAccessToken: () => 'process-only-token',
    fetchImpl: fixture.fetchImpl,
    now: () => new Date('2026-08-01T18:45:00.000Z'),
  })

  assert.equal(prepared.status, 'pending_current_baseline_authorization')
  assert.equal(prepared.provenance_mode, 'historical_irrecoverable')
  assert.equal(prepared.historical_deployment_identity_recovered, false)
  assert.deepEqual(prepared.historical_recovery.reasons,
    ['historical_mutation_channel_coverage_incomplete'])
  assert.equal(prepared.historical_probe_authorization.status, 'authorized_and_completed')
  assert.equal(
    prepared.historical_probe_authorization.accepted_signal_sha256,
    pending.historical_probe_authorization.required_signal_sha256,
  )
  assert.equal(prepared.current_baseline.observed_at, '2026-08-01T18:45:00.000Z')
  assert.equal(prepared.current_baseline.migration_0063_count, 1)
  assert.equal(prepared.current_baseline.migration_0062_count, 0)
  assert.match(prepared.owner_checkpoint.payload_sha256, /^[0-9a-f]{64}$/)
  assert.equal(fixture.calls.length, 3)
  assert.deepEqual(fixture.calls.map(({ method }) => method), ['GET', 'GET', 'POST'])
  assert.ok(fixture.calls.every(({ url }) => url.startsWith(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/`,
  )))
  const serialized = JSON.stringify(prepared)
  for (const forbidden of [
    'process-only-function-id',
    'process-only-deployment-id',
    'process-only-token',
    PROJECT_REF,
  ]) assert.equal(serialized.includes(forbidden), false)
  assert.ok(Object.values(prepared.zero_effect_scope).every((value) => value === 0))
  assert.equal(prepared.later_deployment_authorized, false)
})

test('terminal historical failure uses only the final two reads for fallback preparation', async () => {
  const anchors = fixtureAnchors()
  const accepted = await buildPendingHistoricalRequest({
    git: fakeGit(anchors).run,
    anchors,
  })
  accepted.status = 'historical_probe_authorized'
  accepted.historical_probe_authorization.status = 'accepted'
  accepted.historical_probe_authorization.accepted_signal_sha256 =
    accepted.historical_probe_authorization.required_signal_sha256
  accepted.reasons = []
  const fixture = authorizedProbeFixture()
  const prepared = await prepareFallbackAfterHistoricalFailure({
    record: accepted,
    reason: 'historical_transport_failure',
    initialBudget: { request_count: 4, page_count: 2, response_bytes: 0 },
    verifyAnchors: async () => {},
    loadProjectRef: async () => PROJECT_REF,
    loadAccessToken: () => 'process-only-token',
    fetchImpl: fixture.fetchImpl,
    now: () => new Date('2026-08-01T18:50:00.000Z'),
  })
  assert.equal(fixture.calls.length, 2)
  assert.deepEqual(fixture.calls.map(({ method }) => method), ['GET', 'POST'])
  assert.equal(prepared.status, 'pending_current_baseline_authorization')
  assert.deepEqual(prepared.historical_recovery.reasons,
    ['historical_transport_failure'])
  assert.match(prepared.owner_checkpoint.payload_sha256, /^[0-9a-f]{64}$/)
})

test('exhausted probe seals a sanitized irrecoverable record without fallback adoption', async () => {
  const anchors = fixtureAnchors()
  const accepted = await buildPendingHistoricalRequest({
    git: fakeGit(anchors).run,
    anchors,
  })
  accepted.status = 'historical_probe_authorized'
  accepted.historical_probe_authorization.status = 'accepted'
  accepted.historical_probe_authorization.accepted_signal_sha256 =
    accepted.historical_probe_authorization.required_signal_sha256
  accepted.reasons = []
  const failed = recordHistoricalFailure(accepted, 'historical_transport_failure', {
    request_count: 6,
    page_count: 2,
    response_bytes: 0,
    elapsed_ms: 0,
  })
  assert.equal(failed.status, 'historical_irrecoverable')
  assert.equal(failed.provenance_mode, 'historical_irrecoverable')
  assert.equal(failed.current_baseline, null)
  assert.equal(failed.owner_checkpoint, null)
  assert.deepEqual(failed.reasons, ['historical_transport_failure'])
  assert.match(failed.historical_recovery.proof_sha256, /^[0-9a-f]{64}$/)
  assert.ok(Object.values(failed.zero_effect_scope).every((value) => value === 0))
})

test('historical irrecoverability prepares one exact bounded current-baseline collection request', async () => {
  const failed = await historicalIrrecoverableFixture()
  const historicalProof = failed.historical_recovery.proof_sha256
  const historicalAuthorization =
    failed.historical_probe_authorization.accepted_signal_sha256
  const prepared = prepareCurrentBaselineCollectionRequest(failed)

  assert.equal(prepared.status, 'pending_current_baseline_collection_authorization')
  assert.equal(prepared.provenance_mode, 'historical_irrecoverable')
  assert.equal(prepared.historical_deployment_identity_recovered, false)
  assert.equal(prepared.historical_recovery.proof_sha256, historicalProof)
  assert.equal(prepared.historical_probe_authorization.accepted_signal_sha256,
    historicalAuthorization)
  assert.equal(prepared.current_baseline, null)
  assert.equal(prepared.runtime, null)
  assert.equal(prepared.owner_checkpoint, null)
  assert.equal(prepared.later_deployment_authorized, false)

  const authorization = prepared.current_baseline_collection_authorization
  const payload = authorization.payload
  assert.deepEqual(payload.provider_allowlist,
    CURRENT_BASELINE_COLLECTION_REQUESTS.map(([method, path]) => ({ method, path })))
  assert.deepEqual(payload.limits, CURRENT_BASELINE_COLLECTION_LIMITS)
  assert.deepEqual(payload.immutable_source_bindings,
    CURRENT_BASELINE_IMMUTABLE_BINDINGS)
  assert.equal(payload.snapshot_contract.exact_snapshot_count, 2)
  assert.equal(payload.snapshot_contract.canonical_pre_post_equality_required, true)
  assert.equal(payload.retained_observation_contract.window_seconds, 86_400)
  assert.ok(payload.explicit_exclusions.includes('plan_04_action'))
  assert.ok(Object.values(payload.zero_effect_scope).every((value) => value === 0))
  assert.equal(authorization.payload_sha256, sha256(canonical(payload)))
  assert.equal(authorization.required_signal_sha256,
    sha256(exactCurrentBaselineCollectionSignal(prepared)))
  assert.deepEqual(assertCurrentBaselineCollectionRequestRecord(prepared), prepared)
  assert.deepEqual(assertRequestRecord(prepared), prepared)
  assert.throws(() => assertProvenanceRecord(prepared), /record_not_pass/)

  const serialized = JSON.stringify(prepared)
  for (const forbidden of [PROJECT_REF, 'process-only-function-id', 'process-only-deployment-id']) {
    assert.equal(serialized.includes(forbidden), false)
  }
})

test('current-baseline collection authorization rejects generic or drifted payloads', async () => {
  const prepared = prepareCurrentBaselineCollectionRequest(
    await historicalIrrecoverableFixture(),
  )
  assert.throws(() => acceptCurrentBaselineCollectionAuthorization(prepared, HASH('f')),
    /current_baseline_collection_not_authorized/)
  for (const mutate of [
    (value) => { value.current_baseline_collection_authorization.payload.limits.max_requests += 1 },
    (value) => { value.current_baseline_collection_authorization.payload.provider_allowlist.push({ method: 'GET', path: '/v1/projects/{ref}/analytics/endpoints/logs' }) },
    (value) => { value.current_baseline_collection_authorization.payload.historical_deployment_identity_recovered = true },
    (value) => { value.current_baseline_collection_authorization.payload.zero_effect_scope.scheduler_mutations = 1 },
    (value) => { value.current_baseline_collection_authorization.payload.explicit_exclusions.pop() },
  ]) {
    const drifted = structuredClone(prepared)
    mutate(drifted)
    assert.throws(() => assertCurrentBaselineCollectionRequestRecord(drifted),
      /current_baseline_collection_request_authorization_invalid/)
  }

  const accepted = acceptCurrentBaselineCollectionAuthorization(
    prepared,
    prepared.current_baseline_collection_authorization.required_signal_sha256,
  )
  assert.equal(accepted.status, 'current_baseline_collection_authorized')
  assert.deepEqual(assertAuthorizedCurrentBaselineCollectionRecord(accepted), accepted)
  assert.equal(JSON.stringify(accepted).includes(
    exactCurrentBaselineCollectionSignal(prepared)), false)
})

test('offline CLI prepares and asserts current-baseline collection without credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'current-baseline-request-test-'))
  try {
    const source = join(root, 'irrecoverable.json')
    const output = join(root, 'request.json')
    await writeFile(source, `${canonical(await historicalIrrecoverableFixture())}\n`)
    const cleanEnv = { ...process.env }
    delete cleanEnv.SUPABASE_ACCESS_TOKEN
    const prepared = spawnSync(process.execPath, [
      'scripts/verify-phase-05-1-containment-provenance.mjs',
      '--prepare-current-baseline-collection-request',
      '--record',
      source,
      '--output',
      output,
    ], { encoding: 'utf8', env: cleanEnv })
    assert.equal(prepared.status, 0, prepared.stderr)
    assert.match(prepared.stdout, /current baseline read-only collection/)

    const asserted = spawnSync(process.execPath, [
      'scripts/verify-phase-05-1-containment-provenance.mjs',
      '--assert-request',
      output,
    ], { encoding: 'utf8', env: cleanEnv })
    assert.equal(asserted.status, 0, asserted.stderr)
    const record = JSON.parse(await readFile(output, 'utf8'))
    assert.equal(record.status, 'pending_current_baseline_collection_authorization')
    assert.doesNotMatch(`${prepared.stdout}${prepared.stderr}${asserted.stdout}${asserted.stderr}`,
      /sbp_|Bearer|fjcsvajkkztvlrpdplwx|process-only/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('authorized current-baseline collection uses exactly two reads and stops at redesign decision', async () => {
  const provenance = await import('./verify-phase-05-1-containment-provenance.mjs')
  assert.equal(typeof provenance.executeAuthorizedCurrentBaselineCollection, 'function')

  const pending = prepareCurrentBaselineCollectionRequest(
    await historicalIrrecoverableFixture(),
  )
  const fixture = authorizedProbeFixture()
  let credentialLoads = 0

  await assert.rejects(provenance.executeAuthorizedCurrentBaselineCollection({
    record: pending,
    verifyAnchors: async () => {},
    loadProjectRef: async () => PROJECT_REF,
    loadAccessToken: () => {
      credentialLoads += 1
      return 'process-only-token'
    },
    fetchImpl: fixture.fetchImpl,
  }), /current_baseline_collection_authorized/)
  assert.equal(credentialLoads, 0)
  assert.equal(fixture.calls.length, 0)

  const accepted = acceptCurrentBaselineCollectionAuthorization(
    pending,
    pending.current_baseline_collection_authorization.required_signal_sha256,
  )
  const prepared = await provenance.executeAuthorizedCurrentBaselineCollection({
    record: accepted,
    verifyAnchors: async () => {},
    loadProjectRef: async () => PROJECT_REF,
    loadAccessToken: () => {
      credentialLoads += 1
      return 'process-only-token'
    },
    fetchImpl: fixture.fetchImpl,
    now: () => new Date('2026-08-01T19:30:00.000Z'),
  })

  assert.equal(credentialLoads, 1)
  assert.equal(fixture.calls.length, 2)
  assert.deepEqual(fixture.calls.map(({ method }) => method), ['GET', 'POST'])
  assert.equal(prepared.status, 'pending_current_baseline_authorization')
  assert.equal(prepared.provenance_mode, 'historical_irrecoverable')
  assert.equal(prepared.historical_deployment_identity_recovered, false)
  assert.equal(prepared.current_baseline.observed_at, '2026-08-01T19:30:00.000Z')
  assert.equal(prepared.current_baseline.migration_0063_count, 1)
  assert.equal(prepared.current_baseline.migration_0062_count, 0)
  assert.equal(prepared.current_baseline_collection_authorization.status, 'accepted')
  assert.match(prepared.owner_checkpoint.payload_sha256, /^[0-9a-f]{64}$/)
  assert.match(prepared.owner_checkpoint.required_signal_sha256, /^[0-9a-f]{64}$/)
  assert.equal(prepared.owner_checkpoint.accepted_signal_sha256, null)
  assert.equal(prepared.later_deployment_authorized, false)
  assert.ok(Object.values(prepared.zero_effect_scope).every((value) => value === 0))
  const serialized = JSON.stringify(prepared)
  for (const forbidden of [
    'process-only-function-id',
    'process-only-deployment-id',
    'process-only-token',
    PROJECT_REF,
  ]) assert.equal(serialized.includes(forbidden), false)

  const failed = provenance.recordCurrentBaselineCollectionFailure(accepted)
  assert.equal(failed.status, 'current_baseline_collection_failed')
  assert.equal(failed.current_baseline_collection_authorization.status,
    'completed_failed_first_snapshot_envelope_retired')
  assert.deepEqual(failed.reasons,
    ['current_baseline_collection_transport_failure'])
  assert.deepEqual(provenance.assertCurrentBaselineCollectionFailedRecord(failed), failed)
  await assert.rejects(provenance.executeAuthorizedCurrentBaselineCollection({
    record: failed,
    verifyAnchors: async () => {},
    loadAccessToken: () => {
      credentialLoads += 1
      return 'process-only-token'
    },
  }), /current_baseline_collection_authorized/)
  assert.equal(credentialLoads, 1)
})

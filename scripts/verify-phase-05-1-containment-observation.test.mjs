import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

import {
  ALLOWED_MANAGEMENT_REQUESTS,
  DATABASE_OBSERVATION_SQL,
  assertNoSensitiveContent,
  assertObservationRecord,
  buildEvidenceRecord,
  evaluateObservation,
  nearestRankLatency,
  nextWholeUtcMinute,
  validateManagementRequest,
  validateReadOnlySql,
} from './verify-phase-05-1-containment-observation.mjs'

const SHA = (digit) => digit.repeat(64)
const COMMIT = (digit) => digit.repeat(40)
const STARTED_AT = '2026-08-01T17:00:00.000Z'
const ENDED_AT = '2026-08-02T17:00:00.000Z'

function identitySnapshot(overrides = {}) {
  return {
    linked_project_ref_sha256: SHA('1'),
    migration_inventory_sha256: SHA('2'),
    containment_function_definition_sha256: SHA('3'),
    containment_function_security_sha256: SHA('4'),
    score_tick_function_identity_sha256: SHA('5'),
    scheduler_identity_sha256: SHA('6'),
    ...overrides,
  }
}

function passingInput(overrides = {}) {
  const startIdentity = identitySnapshot()
  return {
    window: {
      started_at: STARTED_AT,
      ended_at: ENDED_AT,
      deployment_completed_at: '2026-08-01T16:39:16.746Z',
    },
    identity: {
      source_commit: COMMIT('a'),
      source_tree: COMMIT('b'),
      containment_migration_sha256: SHA('c'),
      deployed_migration_version: '0063',
      deployment_record_sha256: SHA('d'),
      deployment_summary_sha256: SHA('e'),
      start: startIdentity,
      end: structuredClone(startIdentity),
    },
    logs: {
      attribute_keys: [
        'deployment_id',
        'function_id',
        'response.status_code',
        'version',
      ],
      rows: [
        { status_code: 200, count: 1426 },
        { status_code: 500, count: 14 },
      ],
    },
    database: {
      failed_ranking_state_count: 0,
      phantom_new_job_runs: 0,
      minute_cadence_growth_detected: false,
      uncorrelated_item_growth_minutes: 0,
      maximum_consecutive_uncorrelated_growth_minutes: 0,
      genuine_arrivals: 4,
      genuine_arrivals_enqueued: 4,
      genuine_arrivals_published: 4,
      genuine_arrivals_absorbed_by_existing_building_run: 1,
      publication_latencies_ms: [60_000, 90_000, 120_000, 180_000],
    },
    query_hashes: {
      readiness: SHA('7'),
      identity: SHA('8'),
      logs: SHA('9'),
      database: SHA('a'),
    },
    zero_effect_scope: {
      manual_worker_invocations: 0,
      queue_or_run_writes: 0,
      lease_or_ranking_state_writes: 0,
      ranking_history_deletes: 0,
      scheduler_mutations: 0,
      function_deployments: 0,
      web_deployments: 0,
      vacuum_or_maintenance_commands: 0,
      schema_or_configuration_mutations: 0,
    },
    ...overrides,
  }
}

test('exact 24-hour, success-rate, and schedule-coverage boundaries pass', () => {
  const result = evaluateObservation(passingInput())
  assert.equal(result.status, 'pass')
  assert.equal(result.window.duration_seconds, 86_400)
  assert.equal(result.metrics.minute_schedule_opportunities, 1_440)
  assert.equal(result.metrics.minimum_required_score_tick_total, 1_426)
  assert.equal(result.metrics.score_tick_total, 1_440)
  assert.equal(result.metrics.score_tick_success, 1_426)
  assert.equal(result.metrics.score_tick_success_rate, 1426 / 1440)
})

test('one second short, one success short, and one schedule opportunity short fail closed', () => {
  const shortWindow = passingInput()
  shortWindow.window.ended_at = '2026-08-02T16:59:59.000Z'
  assert.equal(evaluateObservation(shortWindow).status, 'fail')

  const shortSuccess = passingInput()
  shortSuccess.logs.rows = [
    { status_code: 200, count: 1425 },
    { status_code: 500, count: 15 },
  ]
  assert.equal(evaluateObservation(shortSuccess).status, 'fail')

  const shortCoverage = passingInput()
  shortCoverage.logs.rows = [
    { status_code: 200, count: 1425 },
  ]
  assert.equal(evaluateObservation(shortCoverage).status, 'fail')
})

test('window must start after deployment and remain identity-stable', () => {
  const early = passingInput()
  early.window.started_at = '2026-08-01T16:39:00.000Z'
  early.window.ended_at = '2026-08-02T16:39:00.000Z'
  assert.equal(evaluateObservation(early).status, 'fail')

  const drifted = passingInput()
  drifted.identity.end.scheduler_identity_sha256 = SHA('f')
  assert.equal(evaluateObservation(drifted).status, 'fail')

  const shifted = passingInput()
  shifted.window.armed_started_at = '2026-08-01T17:01:00.000Z'
  assert.equal(evaluateObservation(shifted).status, 'fail')
})

test('next whole UTC minute is strictly later and deterministic', () => {
  assert.equal(
    nextWholeUtcMinute('2026-08-01T16:39:16.746Z'),
    '2026-08-01T16:40:00.000Z',
  )
  assert.equal(
    nextWholeUtcMinute('2026-08-01T16:40:00.000Z'),
    '2026-08-01T16:41:00.000Z',
  )
})

test('missing or duplicate log coverage and HTTP 546 independently fail', () => {
  const missingKey = passingInput()
  missingKey.logs.attribute_keys.pop()
  assert.equal(evaluateObservation(missingKey).status, 'fail')

  const unknownKey = passingInput()
  unknownKey.logs.attribute_keys.push('event_message')
  assert.equal(evaluateObservation(unknownKey).status, 'fail')

  const duplicate = passingInput()
  duplicate.logs.rows.push({ status_code: 200, count: 1 })
  assert.equal(evaluateObservation(duplicate).status, 'fail')

  const resourceFailure = passingInput()
  resourceFailure.logs.rows.push({ status_code: 546, count: 1 })
  assert.equal(evaluateObservation(resourceFailure).status, 'fail')
})

test('phantom runs, cadence growth, missing arrivals, and incomplete publication fail', () => {
  for (const mutate of [
    (value) => { value.database.phantom_new_job_runs = 1 },
    (value) => { value.database.minute_cadence_growth_detected = true },
    (value) => { value.database.uncorrelated_item_growth_minutes = 1 },
    (value) => { value.database.genuine_arrivals = 0 },
    (value) => { value.database.genuine_arrivals_enqueued = 1 },
    (value) => { value.database.genuine_arrivals_published = 1 },
    (value) => { value.database.failed_ranking_state_count = 1 },
  ]) {
    const input = passingInput()
    mutate(input)
    assert.equal(evaluateObservation(input).status, 'fail')
  }
})

test('a natural arrival absorbed by an existing building run remains legitimate', () => {
  const input = passingInput()
  input.database.genuine_arrivals = 1
  input.database.genuine_arrivals_enqueued = 1
  input.database.genuine_arrivals_published = 1
  input.database.genuine_arrivals_absorbed_by_existing_building_run = 1
  input.database.publication_latencies_ms = [60_000]
  assert.equal(evaluateObservation(input).status, 'pass')
})

test('database aggregate SQL excludes tombstones and correlates existing building runs', () => {
  validateReadOnlySql(DATABASE_OBSERVATION_SQL)
  assert.match(DATABASE_OBSERVATION_SQL, /user_job_dismissals/i)
  assert.match(DATABASE_OBSERVATION_SQL, /first_seen_at/i)
  assert.match(DATABASE_OBSERVATION_SQL, /existing_building/i)
  assert.match(DATABASE_OBSERVATION_SQL, /run_kind\s*=\s*'new_job'/i)
  assert.match(DATABASE_OBSERVATION_SQL, /date_trunc\(\s*'minute'/i)
  assert.doesNotMatch(DATABASE_OBSERVATION_SQL, /select\s+[^;]*(?:job|run|item)\.id\s*(?:,|from)/i)
})

test('nearest-rank latency uses aggregate milliseconds only', () => {
  assert.deepEqual(nearestRankLatency([100, 200, 300, 400]), {
    sample_count: 4,
    p50_ms: 200,
    p95_ms: 400,
    max_ms: 400,
  })
  assert.deepEqual(nearestRankLatency([123]), {
    sample_count: 1,
    p50_ms: 123,
    p95_ms: 123,
    max_ms: 123,
  })
  assert.throws(() => nearestRankLatency([]), /latency/i)
  assert.throws(() => nearestRankLatency([1, -1]), /latency/i)
})

test('management transport permits exactly three read-only endpoint shapes', () => {
  assert.deepEqual(ALLOWED_MANAGEMENT_REQUESTS, [
    ['GET', '/v1/projects/{ref}/functions'],
    ['GET', '/v1/projects/{ref}/analytics/endpoints/logs'],
    ['POST', '/v1/projects/{ref}/database/query'],
  ])
  for (const [method, path] of ALLOWED_MANAGEMENT_REQUESTS) {
    assert.doesNotThrow(() => validateManagementRequest(method, path))
  }
  for (const [method, path] of [
    ['POST', '/v1/projects/{ref}/functions/score-tick'],
    ['PATCH', '/v1/projects/{ref}/config'],
    ['POST', '/v1/projects/{ref}/database/migrations'],
    ['DELETE', '/v1/projects/{ref}/database/query'],
  ]) {
    assert.throws(() => validateManagementRequest(method, path), /read-only/i)
  }
})

test('SQL allowlist accepts aggregate SELECT/CTE and rejects effects or function calls', () => {
  assert.doesNotThrow(() => validateReadOnlySql(
    'with sample as (select count(*) as value from public.jobs) select max(value) from sample',
  ))
  for (const sql of [
    'update public.jobs set status = \'closed\'',
    'with changed as (delete from public.jobs returning *) select count(*) from changed',
    'select public.enqueue_deterministic_new_jobs(25)',
    'call public.some_procedure()',
    'set statement_timeout = 5000',
    'vacuum analyze public.jobs',
    'select * from public.jobs; select 1',
    'select id from public.jobs',
  ]) {
    assert.throws(() => validateReadOnlySql(sql), /read-only|aggregate/i)
  }
})

test('successful evidence is exact, aggregate-only, and offline-assertable', () => {
  const evaluation = evaluateObservation(passingInput())
  const record = buildEvidenceRecord(evaluation)
  assert.equal(record.schema_version, 1)
  assert.equal(record.status, 'pass')
  assert.equal(record.identity.source_commit, COMMIT('a'))
  assert.equal(record.identity.containment_migration_sha256, SHA('c'))
  assert.equal(record.identity.deployed_migration_version, '0063')
  assert.equal(record.later_deployment_authorized, false)
  assert.equal(record.redaction.aggregate_only, true)
  assert.deepEqual(assertObservationRecord(record), record)
  assert.doesNotThrow(() => assertNoSensitiveContent(record))
})

test('secret, URL, UUID, row identifier, payload, and log-shaped output is rejected', () => {
  for (const unsafe of [
    { access_token: 'sbp_example_secret_value' },
    { database_url: 'postgresql://example.invalid/private' },
    { user_id: '00000000-0000-4000-8000-000000000001' },
    { job_id: '00000000-0000-4000-8000-000000000002' },
    { title: 'Private job title' },
    { description: 'Private job description' },
    { payload: { count: 1 } },
    { logs: [{ status: 200 }] },
    { event_message: 'private runtime content' },
  ]) {
    assert.throws(() => assertNoSensitiveContent(unsafe), /sensitive/i)
  }
})

test('offline CLI assertion needs no credential and rejects malformed or failed records', async () => {
  const root = await mkdtemp(join(tmpdir(), 'containment-observation-test-'))
  try {
    const passPath = join(root, 'pass.json')
    const failPath = join(root, 'fail.json')
    const pass = buildEvidenceRecord(evaluateObservation(passingInput()))
    const fail = structuredClone(pass)
    fail.status = 'fail'
    await writeFile(passPath, `${JSON.stringify(pass)}\n`)
    await writeFile(failPath, `${JSON.stringify(fail)}\n`)

    const cleanEnv = { ...process.env }
    delete cleanEnv.SUPABASE_ACCESS_TOKEN
    const accepted = spawnSync(process.execPath, [
      'scripts/verify-phase-05-1-containment-observation.mjs',
      '--assert-record',
      passPath,
    ], { encoding: 'utf8', env: cleanEnv })
    assert.equal(accepted.status, 0, accepted.stderr)
    assert.doesNotMatch(accepted.stdout, /source_commit|metrics|identity/i)

    const rejected = spawnSync(process.execPath, [
      'scripts/verify-phase-05-1-containment-observation.mjs',
      '--assert-record',
      failPath,
    ], { encoding: 'utf8', env: cleanEnv })
    assert.notEqual(rejected.status, 0)
    assert.doesNotMatch(rejected.stderr, /sbp_|postgresql:\/\//i)
    assert.doesNotMatch(await readFile(failPath, 'utf8'), /sbp_|postgresql:\/\//i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

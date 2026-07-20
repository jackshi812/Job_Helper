import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  FAILURE_INJECTION_STAGES,
  claimForLatch,
  collectPaginatedRows,
  runFreshnessVerification,
} from './verify-scoring-freshness.ts'

const RUN_ID = '10000000-0000-4000-8000-000000000001'
const MISMATCHED_RUN_ID = '20000000-0000-4000-8000-000000000002'
const FIXTURE_IDS = [
  '30000000-0000-4000-8000-000000000003',
  '40000000-0000-4000-8000-000000000004',
]

const ORIGINAL_CRON = Object.freeze({
  jobid: 19,
  jobname: 'score-tick-every-minute',
  schedule: '* * * * *',
  command: 'select net.http_post(...)',
  nodename: 'localhost',
  nodeport: 5432,
  database: 'postgres',
  username: 'postgres',
  active: true,
})

function fakeAdapters({ failAt = null, expireBeforeTick = false } = {}) {
  const state = {
    events: [],
    cron: { ...ORIGINAL_CRON },
    fixtureIds: [],
    residue: new Set(),
    latch: null,
    tickCalls: 0,
    directClaims: [],
    matchingDirectClaims: 0,
    restoredData: false,
    restoredPreferences: false,
    usageSnapshot: null,
    lateEvents: { job: false, preference: false, reroute: false },
  }

  function step(name, result) {
    state.events.push(name)
    if (name === failAt) throw new Error(`injected:${name}`)
    return typeof result === 'function' ? result() : result
  }

  const adapters = {
    makeRunId: () => RUN_ID,
    makeMismatchedRunId: () => MISMATCHED_RUN_ID,
    async validateEnvironment() {
      return step('validate_environment')
    },
    async snapshotCron() {
      return step('snapshot_cron', { ...ORIGINAL_CRON })
    },
    async pauseCron(snapshot) {
      return step('pause_cron', () => {
        assert.deepEqual(snapshot, ORIGINAL_CRON)
        state.cron.active = false
      })
    },
    async readCron() {
      return step('read_paused_cron', { ...state.cron })
    },
    async proveQuiescent() {
      return step('prove_quiescent')
    },
    async preseedCurrentPairs() {
      return step('preseed_current_pairs', ['seed-a'])
    },
    async snapshotData() {
      return step('snapshot_data', { rows: [{ id: 'existing-a' }], preferences: { titles: ['Old'] } })
    },
    async createFixtures() {
      return step('create_fixtures', () => {
        state.fixtureIds = [...FIXTURE_IDS]
        for (const id of FIXTURE_IDS) state.residue.add(id)
        return [...FIXTURE_IDS]
      })
    },
    async beginLatch(runId, fixtureIds, ttlSeconds) {
      return step('begin_latch', () => {
        assert.equal(runId, RUN_ID)
        assert.deepEqual(fixtureIds, FIXTURE_IDS)
        assert.ok(ttlSeconds >= 15 && ttlSeconds < 300)
        state.latch = {
          runId,
          fixtureIds: [...fixtureIds],
          expiresAt: expireBeforeTick ? 0 : Date.now() + ttlSeconds * 1_000,
        }
        return { runId, expiresAt: new Date(state.latch.expiresAt).toISOString() }
      })
    },
    async signalPreferences() {
      return step('signal_preferences')
    },
    async protectNonfixtures() {
      return step('protect_nonfixtures')
    },
    async injectLateJob() {
      return step('inject_late_job', () => {
        state.lateEvents.job = true
        state.residue.add('late-job')
      })
    },
    async injectLatePreferenceSignal() {
      return step('inject_late_preference', () => {
        state.lateEvents.preference = true
      })
    },
    async injectLateReroute() {
      return step('inject_late_reroute', () => {
        state.lateEvents.reroute = true
      })
    },
    async proveAuthenticatedWritesDenied() {
      return step('prove_authenticated_write_denial')
    },
    async claim(runId) {
      return step(runId === null ? 'claim_no_id' : 'claim_mismatched_id', () => {
        state.directClaims.push(runId)
        if (runId === RUN_ID) state.matchingDirectClaims += 1
        return claimForLatch(state.latch, runId, Date.now())
      })
    },
    async snapshotUsage() {
      return step('snapshot_usage', () => {
        state.usageSnapshot = { scoreRows: 11, promptTokens: 101, outputTokens: 22 }
        return state.usageSnapshot
      })
    },
    async invokeTick(runId) {
      return step('invoke_tick', () => {
        state.tickCalls += 1
        assert.equal(runId, RUN_ID)
        const claimed = claimForLatch(state.latch, runId, Date.now())
        return { claimed: claimed.length, verification_claimed_ids: claimed }
      })
    },
    async assertOutcomes() {
      return step('assert_outcomes')
    },
    async endLatch(runId) {
      state.events.push('end_latch')
      if (runId === RUN_ID) state.latch = null
      if (failAt === 'end_latch') throw new Error('injected:end_latch')
      return true
    },
    async restoreData(snapshot) {
      state.events.push('restore_data')
      assert.ok(snapshot)
      state.restoredData = true
      state.restoredPreferences = true
      if (failAt === 'restore_data') throw new Error('injected:restore_data')
    },
    async deleteTrackedFixtures() {
      state.events.push('delete_tracked_fixtures')
      state.residue.clear()
      if (failAt === 'delete_tracked_fixtures') throw new Error('injected:delete_tracked_fixtures')
    },
    async assertZeroResidue() {
      state.events.push('assert_zero_residue')
      assert.equal(state.residue.size, 0)
      if (failAt === 'assert_zero_residue') throw new Error('injected:assert_zero_residue')
    },
    async restoreCron(snapshot) {
      state.events.push('restore_cron')
      state.cron = { ...snapshot }
      if (failAt === 'restore_cron') throw new Error('injected:restore_cron')
    },
    async readRestoredCron() {
      state.events.push('read_restored_cron')
      if (failAt === 'read_restored_cron') throw new Error('injected:read_restored_cron')
      return { ...state.cron }
    },
  }

  return { adapters, state }
}

function before(events, first, second) {
  assert.ok(events.indexOf(first) >= 0, `missing ${first}`)
  assert.ok(events.indexOf(second) >= 0, `missing ${second}`)
  assert.ok(events.indexOf(first) < events.indexOf(second), `${first} must precede ${second}`)
}

test('success uses latch isolation and the sole matching claim is the one tick adapter call', async () => {
  const { adapters, state } = fakeAdapters()
  const originalFetch = globalThis.fetch
  let networkCalls = 0
  globalThis.fetch = async () => {
    networkCalls += 1
    throw new Error('real network is forbidden in unit tests')
  }
  let result
  try {
    result = await runFreshnessVerification(adapters)
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(networkCalls, 0)
  assert.deepEqual(result.fixtureUserJobIds, FIXTURE_IDS)
  assert.equal(state.fixtureIds.length, 2)
  assert.equal(state.tickCalls, 1)
  assert.equal(state.matchingDirectClaims, 0)
  assert.deepEqual(state.directClaims, [null, MISMATCHED_RUN_ID])
  assert.deepEqual(state.lateEvents, { job: true, preference: true, reroute: true })
  before(state.events, 'pause_cron', 'preseed_current_pairs')
  before(state.events, 'read_paused_cron', 'preseed_current_pairs')
  before(state.events, 'prove_quiescent', 'preseed_current_pairs')
  before(state.events, 'begin_latch', 'signal_preferences')
  before(state.events, 'signal_preferences', 'protect_nonfixtures')
  before(state.events, 'inject_late_reroute', 'claim_no_id')
  before(state.events, 'claim_mismatched_id', 'invoke_tick')
  before(state.events, 'end_latch', 'restore_data')
  before(state.events, 'restore_data', 'delete_tracked_fixtures')
  before(state.events, 'assert_zero_residue', 'restore_cron')
  assert.equal(state.events.at(-1), 'read_restored_cron')
  assert.deepEqual(state.cron, ORIGINAL_CRON)
  assert.equal(state.latch, null)
  assert.equal(state.residue.size, 0)
})

test('all declared setup/runtime failures continue nested cleanup and restore cron last', async () => {
  for (const failAt of FAILURE_INJECTION_STAGES) {
    const { adapters, state } = fakeAdapters({ failAt })
    await assert.rejects(runFreshnessVerification(adapters), /injected:|cleanup failed/)

    const pauseIndex = state.events.indexOf('pause_cron')
    const mutationIndex = state.events.indexOf('preseed_current_pairs')
    if (mutationIndex >= 0) assert.ok(pauseIndex >= 0 && pauseIndex < mutationIndex, failAt)
    if (mutationIndex >= 0) {
      assert.ok(state.events.indexOf('read_paused_cron') < mutationIndex, failAt)
      assert.ok(state.events.indexOf('prove_quiescent') < mutationIndex, failAt)
    }
    if (pauseIndex >= 0 && failAt !== 'pause_cron') {
      assert.ok(state.events.includes('restore_cron'), `${failAt}: cron restore not attempted`)
      assert.ok(
        state.events.indexOf('restore_cron') > state.events.indexOf('assert_zero_residue'),
        `${failAt}: cron was not restored last`,
      )
    }
    if (state.events.includes('begin_latch') && failAt !== 'begin_latch') {
      assert.ok(state.events.includes('end_latch'), `${failAt}: latch end not attempted`)
    }
    if (state.events.includes('snapshot_data') && failAt !== 'snapshot_data') {
      assert.ok(state.events.includes('restore_data'), `${failAt}: data restore not attempted`)
    }
  }
})

test('expired latch admits neither ordinary nor matching verification claims', () => {
  const latch = { runId: RUN_ID, fixtureIds: FIXTURE_IDS, expiresAt: 100 }
  assert.deepEqual(claimForLatch(latch, null, 101), [])
  assert.deepEqual(claimForLatch(latch, RUN_ID, 101), [])
  assert.deepEqual(claimForLatch(latch, MISMATCHED_RUN_ID, 99), [])
  assert.deepEqual(claimForLatch(latch, RUN_ID, 99), FIXTURE_IDS)
})

test('snapshot pagination reads all rows beyond one hosted response page', async () => {
  const hostedRows = Array.from({ length: 2_992 }, (_, index) => ({
    id: `row-${String(index).padStart(4, '0')}`,
  }))
  const ranges = []

  const rows = await collectPaginatedRows(async (from, to) => {
    ranges.push([from, to])
    return {
      rows: hostedRows.slice(from, to + 1),
      count: hostedRows.length,
    }
  })

  assert.equal(rows.length, 2_992)
  assert.deepEqual(rows, hostedRows)
  assert.deepEqual(ranges, [
    [0, 999],
    [1_000, 1_999],
    [2_000, 2_991],
  ])
})

test('tick failure is never retried and cleanup still releases the latch', async () => {
  const { adapters, state } = fakeAdapters({ failAt: 'invoke_tick' })
  await assert.rejects(runFreshnessVerification(adapters), /injected:invoke_tick/)
  assert.equal(state.events.filter((event) => event === 'invoke_tick').length, 1)
  assert.equal(state.events.filter((event) => event === 'end_latch').length, 1)
  assert.deepEqual(state.cron, ORIGINAL_CRON)
})

test('source is import-safe and contains no retry, poll, or legacy-verifier fallback', async () => {
  const source = await readFile(new URL('./verify-scoring-freshness.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /setInterval\s*\(/)
  assert.doesNotMatch(source, /setTimeout\s*\(/)
  assert.doesNotMatch(source, /verify-scoring\.ts/)
  assert.doesNotMatch(source, /for\s*\([^)]*(?:attempt|retry)/i)
  assert.doesNotMatch(source, /while\s*\(/)
  assert.match(source, /pathToFileURL/)
})

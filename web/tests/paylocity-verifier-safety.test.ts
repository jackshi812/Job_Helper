import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  PAYLOCITY_BOARD_UUID,
  PAYLOCITY_FAILURE_STAGES,
  PAYLOCITY_MUTATION_CLASSES,
  PAYLOCITY_SOURCE_KEY,
  collectPaylocitySnapshotRows,
  redactPaylocityEvidence,
  run,
  runPaylocityVerification,
  type PaylocityVerificationAdapters,
} from '../../scripts/verify-paylocity.ts'

const source = readFileSync(
  fileURLToPath(new URL('../../scripts/verify-paylocity.ts', import.meta.url)),
  'utf8',
)

const CRON = Object.freeze({
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

function fakeAdapters(options: { pending?: boolean; failAt?: string | null } = {}) {
  const events: string[] = []
  const state = {
    cron: { ...CRON },
    scoreCalls: 0,
    residue: new Set<string>(),
    latch: false,
  }
  const step = <T>(name: string, value: T): T => {
    events.push(name)
    if (options.failAt === name) throw new Error(`injected:${name}`)
    return value
  }
  const adapters: PaylocityVerificationAdapters = {
    async snapshotState(label: string) {
      return step(`snapshot_${label}`, {
        label,
        company: { source_key: PAYLOCITY_SOURCE_KEY },
        jobs: {},
        observations: {},
        heartbeat: {},
        scoringUsage: {},
        owned: {},
      })
    },
    async verifyBoard() {
      return step('verify_board', options.pending
        ? { state: 'experimental', progress: 1, nextEligibleAt: '2026-07-22T04:00:00Z' }
        : { state: 'active', progress: 3, nextEligibleAt: null })
    },
    async snapshotScoreCron() {
      return step('snapshot_score_cron', { ...CRON })
    },
    async pauseScoreCron() {
      step('pause_score_cron', undefined)
      state.cron.active = false
    },
    async readScoreCron(stage: 'paused' | 'restored') {
      return step(`read_${stage}_cron`, { ...state.cron })
    },
    async proveScoreQuiescent() {
      step('prove_score_quiescent', undefined)
    },
    async pollPaylocityOnce() {
      return step('poll_paylocity_once', { claimed: 1, succeeded: 1, failed: 0 })
    },
    async assertNoDuplicateJobs() {
      step('assert_no_duplicate_jobs', undefined)
    },
    async probeIncompleteObservation() {
      step('probe_incomplete_observation', undefined)
    },
    async createDisposableScoringFixture() {
      return step('create_disposable_scoring_fixture', () => {
        state.residue.add('owned-user')
        return { runId: '10000000-0000-4000-8000-000000000001', userJobIds: ['a', 'b'] }
      })
    },
    async beginScoringLatch() {
      step('begin_scoring_latch', undefined)
      state.latch = true
    },
    async snapshotScoreUsage() {
      return step('snapshot_score_usage', [{ id: 'before' }])
    },
    async invokeScoreTick() {
      state.scoreCalls += 1
      return step('invoke_score_tick', { claimed: 1 })
    },
    async assertDashboardFeed() {
      step('assert_dashboard_feed', undefined)
    },
    async endScoringLatch() {
      events.push('end_scoring_latch')
      state.latch = false
      if (options.failAt === 'end_scoring_latch') throw new Error('injected:end_scoring_latch')
    },
    async cleanupOwnedRows() {
      events.push('cleanup_owned_rows')
      state.residue.clear()
      if (options.failAt === 'cleanup_owned_rows') throw new Error('injected:cleanup_owned_rows')
    },
    async assertZeroResidue() {
      events.push('assert_zero_residue')
      if (state.residue.size !== 0) throw new Error('residue remains')
      if (options.failAt === 'assert_zero_residue') throw new Error('injected:assert_zero_residue')
    },
    async restoreScoreCron() {
      events.push('restore_score_cron')
      state.cron = { ...CRON }
      if (options.failAt === 'restore_score_cron') throw new Error('injected:restore_score_cron')
    },
  }
  return { adapters, events, state }
}

describe('Paylocity verifier dry-run and mode boundary', () => {
  it('performs zero network, database, auth, cron, and paid calls in dry-run mode', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network forbidden'))
    const logs: string[] = []
    const logSpy = vi.spyOn(console, 'log').mockImplementation((value) => logs.push(String(value)))
    try {
      await run(['--dry-run'])
    } finally {
      fetchSpy.mockRestore()
      logSpy.mockRestore()
    }
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(logs.at(-1)).toBe('COMPLETE mode=dry-run network_calls=0 database_calls=0 auth_calls=0 paid_calls=0')
  })

  it('requires exactly one explicit command mode', async () => {
    await expect(run([])).rejects.toThrow('Choose exactly one mode')
    await expect(run(['--dry-run', '--resume'])).rejects.toThrow('Choose exactly one mode')
  })
})

describe('Paylocity verifier resumability and cleanup', () => {
  it('exits PENDING after one real-user window without polling or scoring', async () => {
    const { adapters, events, state } = fakeAdapters({ pending: true })
    await expect(runPaylocityVerification(adapters)).resolves.toMatchObject({
      status: 'PENDING',
      progress: 1,
      nextEligibleAt: '2026-07-22T04:00:00Z',
    })
    expect(events).toEqual(['snapshot_entry', 'verify_board', 'snapshot_post_activation'])
    expect(state.scoreCalls).toBe(0)
  })

  it('uses one paid tick and restores owned state before restoring cron', async () => {
    const { adapters, events, state } = fakeAdapters()
    await expect(runPaylocityVerification(adapters)).resolves.toMatchObject({
      status: 'COMPLETE',
      scoreTickInvocations: 1,
    })
    expect(state.scoreCalls).toBe(1)
    expect(state.latch).toBe(false)
    expect(state.residue.size).toBe(0)
    expect(events.indexOf('snapshot_entry')).toBeLessThan(events.indexOf('verify_board'))
    expect(events.indexOf('read_paused_cron')).toBeLessThan(events.indexOf('poll_paylocity_once'))
    expect(events.indexOf('probe_incomplete_observation')).toBeLessThan(events.indexOf('create_disposable_scoring_fixture'))
    expect(events.filter((event) => event === 'invoke_score_tick')).toHaveLength(1)
    expect(events.indexOf('end_scoring_latch')).toBeLessThan(events.indexOf('cleanup_owned_rows'))
    expect(events.indexOf('assert_zero_residue')).toBeLessThan(events.indexOf('restore_score_cron'))
    expect(events.at(-1)).toBe('snapshot_final')
  })

  it('attempts nested cleanup and CAS-safe cron restoration after every declared failure', async () => {
    for (const failAt of PAYLOCITY_FAILURE_STAGES) {
      const { adapters, events } = fakeAdapters({ failAt })
      await expect(runPaylocityVerification(adapters)).rejects.toThrow(/injected:|cleanup failed/)
      if (events.includes('pause_score_cron')
        && failAt !== 'pause_score_cron'
        && failAt !== 'read_paused_cron') {
        expect(events).toContain('restore_score_cron')
        expect(events.indexOf('assert_zero_residue')).toBeLessThan(events.indexOf('restore_score_cron'))
      }
      if (events.includes('begin_scoring_latch') && failAt !== 'begin_scoring_latch') {
        expect(events).toContain('end_scoring_latch')
      }
      if (events.includes('create_disposable_scoring_fixture') && failAt !== 'create_disposable_scoring_fixture') {
        expect(events).toContain('cleanup_owned_rows')
      }
    }
  })
})

describe('Paylocity verifier static safety contract', () => {
  it('pins exact identity and classifies every mutation', () => {
    expect(PAYLOCITY_BOARD_UUID).toBe('d6628b21-949b-4400-a3d0-c9082bbf3eb1')
    expect(PAYLOCITY_SOURCE_KEY).toBe(`paylocity:global:${PAYLOCITY_BOARD_UUID}`)
    expect(PAYLOCITY_MUTATION_CLASSES.map(({ id }) => id)).toEqual([
      'paylocity_activation_evidence',
      'paylocity_provider_jobs',
      'paylocity_company_health',
      'pipeline_heartbeat',
      'claim_timestamps',
      'incomplete_observation_sentinel',
      'disposable_verifier_account',
      'disposable_scoring_rows',
      'scoring_latch',
      'scoring_usage',
      'scoring_cron',
    ])
    expect(PAYLOCITY_MUTATION_CLASSES.every(({ disposition, acceptancePredicate }) =>
      ['expected_durable', 'temporary_must_restore', 'fixture_must_delete'].includes(disposition)
      && acceptancePredicate.length > 0
    )).toBe(true)
    expect(PAYLOCITY_FAILURE_STAGES).toEqual([
      'snapshot_entry',
      'verify_board',
      'snapshot_post_activation',
      'snapshot_score_cron',
      'pause_score_cron',
      'read_paused_cron',
      'prove_score_quiescent',
      'poll_paylocity_once',
      'snapshot_post_poll',
      'assert_no_duplicate_jobs',
      'probe_incomplete_observation',
      'create_disposable_scoring_fixture',
      'begin_scoring_latch',
      'snapshot_score_usage',
      'invoke_score_tick',
      'assert_dashboard_feed',
      'end_scoring_latch',
      'cleanup_owned_rows',
      'assert_zero_residue',
      'restore_score_cron',
      'read_restored_cron',
      'snapshot_final',
    ])
  })

  it('paginates complete snapshots beyond the hosted response limit', async () => {
    const hosted = Array.from({ length: 2_105 }, (_, index) => ({ id: String(index) }))
    const ranges: Array<[number, number]> = []
    const rows = await collectPaylocitySnapshotRows(async (from, to) => {
      ranges.push([from, to])
      return { rows: hosted.slice(from, to + 1), count: hosted.length }
    })
    expect(rows).toEqual(hosted)
    expect(ranges).toEqual([[0, 999], [1_000, 1_999], [2_000, 2_104]])
  })

  it('redacts secrets, resume text, provider bodies, and personal data', () => {
    expect(redactPaylocityEvidence({
      authorization: 'Bearer secret',
      resume_text: 'private resume',
      provider_body: '<html>untrusted</html>',
      email: 'person@example.com',
      safe_count: 3,
    })).toEqual({
      authorization: '[REDACTED]',
      resume_text: '[REDACTED]',
      provider_body: '[REDACTED]',
      email: '[REDACTED]',
      safe_count: 3,
    })
  })

  it('uses exact ownership, immutable job, feed, one-call, and cron CAS gates', () => {
    expect(source).toContain("app_metadata: { paylocity_verifier: true }")
    expect(source).toContain("admin.auth.admin.deleteUser(owned.userId)")
    expect(source).toContain('assertExistingProviderJobsImmutable')
    expect(source).toContain(".eq('source', 'paylocity')")
    expect(source).toContain(".eq('source_key', PAYLOCITY_SOURCE_KEY)")
    expect(source).toContain(".from('user_jobs')")
    expect(source).toContain("'ai_usage'")
    expect(source).toContain('scoreTickInvocations += 1')
    expect(source).toContain("if (scoreTickInvocations !== 1)")
    expect(source).toContain('assertCronPaused')
    expect(source).toContain('assertCronRestorable')
    expect(source).toContain('assertCronRestored')
    expect(source).not.toMatch(/USER1_EMAIL.*deleteUser|SEED_PASSWORD_1.*deleteUser/)
    expect(source).not.toMatch(/console\.(?:log|error)\([^\n]*(?:token|secret|resume_text|provider_body)/i)
  })
})

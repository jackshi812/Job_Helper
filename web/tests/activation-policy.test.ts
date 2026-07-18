import { describe, expect, it } from 'vitest'
import migrationSql from '../../supabase/migrations/0015_activation_windows.sql?raw'

type Provider = 'smartrecruiters' | 'recruitee' | 'workday'

interface MirrorState {
  progress: number
  activationState: 'experimental' | 'active'
  observationIds: Set<string>
  windowStarts: Set<number>
}

interface MirrorResult extends MirrorState {
  accepted: boolean
  windowStart: number
  nextEligibleAt: number
  reason: 'accepted' | 'replay' | 'same_window' | 'ineligible' | 'progress_complete'
}

interface MirrorEvidence {
  provider: Provider
  observationId: string
  nowMs: number
  completeness?: 'complete' | 'partial' | 'unknown'
  credibleForClosure?: boolean
  jobCount?: number
  expectedCount?: number
  warningCount?: number
  activationState?: 'experimental' | 'active' | 'disabled'
}

function emptyState(): MirrorState {
  return {
    progress: 0,
    activationState: 'experimental',
    observationIds: new Set(),
    windowStarts: new Set(),
  }
}

// Local pure-contract mirror only. PostgreSQL clock, row-lock, and constraint
// behavior is intentionally deferred to the blocking hosted proof in Plan 07.
function mirrorObservation(state: MirrorState, evidence: MirrorEvidence): MirrorResult {
  const windowMinutes = evidence.provider === 'workday' ? 30 : 10
  const windowMs = windowMinutes * 60_000
  const windowStart = Math.floor(evidence.nowMs / windowMs) * windowMs
  const nextEligibleAt = windowStart + windowMs
  const snapshot = {
    progress: state.progress,
    activationState: state.activationState,
    observationIds: new Set(state.observationIds),
    windowStarts: new Set(state.windowStarts),
  }
  const result = (reason: MirrorResult['reason']): MirrorResult => ({
    ...snapshot,
    accepted: reason === 'accepted',
    windowStart,
    nextEligibleAt,
    reason,
  })

  if (state.progress >= 3) return result('progress_complete')
  if (state.observationIds.has(evidence.observationId)) return result('replay')
  if (state.windowStarts.has(windowStart)) return result('same_window')

  const eligible = evidence.activationState !== 'disabled'
    && evidence.completeness === 'complete'
    && evidence.credibleForClosure === true
    && evidence.warningCount === 0
    && evidence.jobCount !== undefined
    && evidence.expectedCount !== undefined
    && evidence.jobCount === evidence.expectedCount
  if (!eligible) return result('ineligible')

  snapshot.observationIds.add(evidence.observationId)
  snapshot.windowStarts.add(windowStart)
  snapshot.progress += 1
  if (
    snapshot.progress === 3
    && (evidence.provider === 'smartrecruiters' || evidence.provider === 'recruitee')
  ) {
    snapshot.activationState = 'active'
  }
  return {
    ...snapshot,
    accepted: true,
    windowStart,
    nextEligibleAt,
    reason: 'accepted',
  }
}

function eligibleEvidence(
  provider: Provider,
  observationId: string,
  nowMs: number,
): MirrorEvidence {
  return {
    provider,
    observationId,
    nowMs,
    completeness: 'complete',
    credibleForClosure: true,
    jobCount: 2,
    expectedCount: 2,
    warningCount: 0,
    activationState: 'experimental',
  }
}

function sqlIndex(pattern: RegExp) {
  const match = migrationSql.match(pattern)
  expect(match, `Expected migration SQL to match ${pattern}`).not.toBeNull()
  return match?.index ?? -1
}

describe('local structural proof for record_connector_observation SQL', () => {
  it('declares a server-time-only service-role RPC and no caller timestamp', () => {
    expect(migrationSql).toMatch(/create or replace function public\.record_connector_observation\s*\(/i)
    expect(migrationSql).not.toMatch(/p_(?:observed_at|window_start|timestamp|now)\b/i)
    expect(migrationSql).toMatch(/clock_timestamp\(\)/i)
    expect(migrationSql).toMatch(/security definer/i)
    expect(migrationSql).toMatch(/set search_path\s*=\s*''/i)
    expect(migrationSql).toMatch(/revoke execute on function public\.record_connector_observation[\s\S]*from public, anon, authenticated/i)
    expect(migrationSql).toMatch(/grant execute on function public\.record_connector_observation[\s\S]*to service_role/i)
  })

  it('stores bounded accepted evidence with replay and same-window constraints', () => {
    expect(migrationSql).toMatch(/create table public\.connector_observations/i)
    expect(migrationSql).toMatch(/observation_id\s+uuid\s+(?:primary key|not null)/i)
    expect(migrationSql).toMatch(/observed_at\s+timestamptz\s+not null\s+default\s+clock_timestamp\(\)/i)
    expect(migrationSql).toMatch(/unique\s*\(\s*company_id\s*,\s*eligibility_window_start\s*\)/i)
    expect(migrationSql).toMatch(/unique\s*\(\s*observation_id\s*\)|observation_id\s+uuid\s+primary key/i)
    expect(migrationSql).toMatch(/warning_count\s+integer/i)
    expect(migrationSql).toMatch(/evidence_digest\s+text/i)
    expect(migrationSql).toMatch(/revoke all on table public\.connector_observations from public, anon, authenticated/i)
  })

  it('uses bounded contention and locks only after validating inputs', () => {
    expect(migrationSql).toMatch(/set local lock_timeout\s*=\s*'[^']*(?:ms|second)/i)
    expect(migrationSql).toMatch(/for update/i)
    expect(migrationSql).toMatch(/lock_(?:timeout|not_available)|55P03/i)
    expect(migrationSql).toMatch(/retryable/i)
    expect(migrationSql).not.toMatch(/https?:\/\//i)

    const validation = sqlIndex(/p_completeness\s*<>\s*'complete'/i)
    const lock = sqlIndex(/select[\s\S]*from public\.companies[\s\S]*for update/i)
    expect(validation).toBeLessThan(lock)
  })

  it('rejects persisted progress at three before every provider ledger insert', () => {
    const progressGuard = sqlIndex(/activation_successes\s*>=\s*3/i)
    const insert = sqlIndex(/insert into public\.connector_observations/i)
    expect(progressGuard).toBeLessThan(insert)
    expect(migrationSql).toMatch(/progress_complete/i)
    expect(migrationSql).toMatch(/ats_type\s+in\s*\(\s*'smartrecruiters'\s*,\s*'recruitee'\s*,\s*'workday'\s*\)/i)
  })

  it('returns persisted progress plus server window boundaries and promotes only stable public providers', () => {
    expect(migrationSql).toMatch(/returns table\s*\([\s\S]*progress\s+integer[\s\S]*window_start\s+timestamptz[\s\S]*next_eligible_at\s+timestamptz/i)
    expect(migrationSql).toMatch(/activation_successes\s*=\s*[a-z_]+\.progress/i)
    expect(migrationSql).toMatch(/last_verified_at\s*=/i)
    expect(migrationSql).toMatch(/last_observation_count\s*=/i)
    expect(migrationSql).toMatch(/ats_type\s+in\s*\(\s*'smartrecruiters'\s*,\s*'recruitee'\s*\)/i)
    expect(migrationSql).not.toMatch(/ats_type\s+in\s*\([^)]*'workday'[^)]*\)[\s\S]{0,160}activation_state\s*=\s*'active'/i)
  })
})

describe('local pure-contract mirror for activation windows', () => {
  it('counts three calls in one ten-minute window once and returns the future boundary', () => {
    const first = mirrorObservation(emptyState(), eligibleEvidence('smartrecruiters', 'obs-1', 60_000))
    const second = mirrorObservation(first, eligibleEvidence('smartrecruiters', 'obs-2', 2 * 60_000))
    const third = mirrorObservation(second, eligibleEvidence('smartrecruiters', 'obs-3', 9 * 60_000))

    expect(first).toMatchObject({ accepted: true, progress: 1, windowStart: 0, nextEligibleAt: 600_000 })
    expect(second).toMatchObject({ accepted: false, reason: 'same_window', progress: 1, nextEligibleAt: 600_000 })
    expect(third).toMatchObject({ accepted: false, reason: 'same_window', progress: 1 })
    expect(third.windowStarts.size).toBe(1)
  })

  it('rejects replay independently from same-window and cross-window acceptance', () => {
    const first = mirrorObservation(emptyState(), eligibleEvidence('recruitee', 'obs-1', 0))
    const replay = mirrorObservation(first, eligibleEvidence('recruitee', 'obs-1', 10 * 60_000))
    const crossWindow = mirrorObservation(first, eligibleEvidence('recruitee', 'obs-2', 10 * 60_000))

    expect(replay).toMatchObject({ accepted: false, reason: 'replay', progress: 1 })
    expect(crossWindow).toMatchObject({ accepted: true, progress: 2, windowStart: 600_000 })
  })

  it.each([
    ['partial', { completeness: 'partial' }],
    ['unknown', { completeness: 'unknown' }],
    ['non-credible', { credibleForClosure: false }],
    ['warning-bearing', { warningCount: 1 }],
    ['count-inconsistent', { expectedCount: 3 }],
    ['disabled', { activationState: 'disabled' }],
  ] as const)('rejects %s evidence without ledger or company progress mutation', (_name, override) => {
    const result = mirrorObservation(emptyState(), {
      ...eligibleEvidence('smartrecruiters', 'obs-1', 0),
      ...override,
    } as MirrorEvidence)

    expect(result).toMatchObject({ accepted: false, reason: 'ineligible', progress: 0 })
    expect(result.observationIds.size).toBe(0)
    expect(result.windowStarts.size).toBe(0)
  })

  it.each(['smartrecruiters', 'recruitee'] as const)(
    'promotes %s only after three separate eligible windows',
    (provider) => {
      const one = mirrorObservation(emptyState(), eligibleEvidence(provider, 'obs-1', 0))
      const two = mirrorObservation(one, eligibleEvidence(provider, 'obs-2', 10 * 60_000))
      const three = mirrorObservation(two, eligibleEvidence(provider, 'obs-3', 20 * 60_000))
      expect(one.activationState).toBe('experimental')
      expect(two.activationState).toBe('experimental')
      expect(three).toMatchObject({ accepted: true, progress: 3, activationState: 'active' })
    },
  )

  it('lets Workday reach exactly three thirty-minute windows but rejects the fourth with no mutation', () => {
    const one = mirrorObservation(emptyState(), eligibleEvidence('workday', 'obs-1', 0))
    const two = mirrorObservation(one, eligibleEvidence('workday', 'obs-2', 30 * 60_000))
    const three = mirrorObservation(two, eligibleEvidence('workday', 'obs-3', 60 * 60_000))
    const four = mirrorObservation(three, eligibleEvidence('workday', 'obs-4', 90 * 60_000))

    expect(three).toMatchObject({ accepted: true, progress: 3, activationState: 'experimental' })
    expect(four).toMatchObject({ accepted: false, reason: 'progress_complete', progress: 3, activationState: 'experimental' })
    expect(four.observationIds).toEqual(three.observationIds)
    expect(four.windowStarts).toEqual(three.windowStarts)
  })

  it.each(['smartrecruiters', 'recruitee'] as const)(
    'rejects a fourth %s window after promotion with no post-cap mutation',
    (provider) => {
      const one = mirrorObservation(emptyState(), eligibleEvidence(provider, 'obs-1', 0))
      const two = mirrorObservation(one, eligibleEvidence(provider, 'obs-2', 10 * 60_000))
      const three = mirrorObservation(two, eligibleEvidence(provider, 'obs-3', 20 * 60_000))
      const four = mirrorObservation(three, eligibleEvidence(provider, 'obs-4', 30 * 60_000))
      expect(four).toMatchObject({ accepted: false, reason: 'progress_complete', progress: 3, activationState: 'active' })
      expect(four.observationIds).toEqual(three.observationIds)
      expect(four.windowStarts).toEqual(three.windowStarts)
    },
  )
})

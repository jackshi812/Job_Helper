import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  ADZUNA_EFFECTIVE_DAILY_CUTOFF,
  assessDiscoveryFreshness,
  chicagoDiscoverySlot,
  distinctSeedQueries,
  latestDueDiscoverySlot,
  summarizeDiscovery,
} from '../../supabase/functions/_shared/discovery-health'

const atomicMigration = readFileSync(
  new URL('../../supabase/migrations/0010_atomic_discovery_reservations.sql', import.meta.url),
  'utf8',
)
const lockThenClockMigration = readFileSync(
  new URL('../../supabase/migrations/0011_lock_before_quota_clock.sql', import.meta.url),
  'utf8',
)
const sweepSource = readFileSync(
  new URL('../../supabase/functions/discovery-sweep/index.ts', import.meta.url),
  'utf8',
)

describe('Chicago discovery cadence', () => {
  it('runs every 30 minutes from 06:00 through 11:30 Chicago time', () => {
    expect(chicagoDiscoverySlot(new Date('2026-07-17T11:00:00Z'))).toBe('2026-07-17T06:00')
    expect(chicagoDiscoverySlot(new Date('2026-07-17T16:30:00Z'))).toBe('2026-07-17T11:30')
  })

  it('runs every two hours outside the morning window', () => {
    expect(chicagoDiscoverySlot(new Date('2026-07-17T17:00:00Z'))).toBe('2026-07-17T12:00')
    expect(chicagoDiscoverySlot(new Date('2026-07-17T18:00:00Z'))).toBeNull()
    expect(chicagoDiscoverySlot(new Date('2026-07-17T19:00:00Z'))).toBe('2026-07-17T14:00')
  })

  it('uses Chicago local time across daylight-saving changes', () => {
    expect(chicagoDiscoverySlot(new Date('2026-01-17T12:00:00Z'))).toBe('2026-01-17T06:00')
    expect(chicagoDiscoverySlot(new Date('2026-07-17T11:00:00Z'))).toBe('2026-07-17T06:00')
  })

  it('reserves quota headroom beneath weekly and monthly limits', () => {
    expect(ADZUNA_EFFECTIVE_DAILY_CUTOFF).toBe(75)
    expect(ADZUNA_EFFECTIVE_DAILY_CUTOFF * 7).toBeLessThan(1_000)
    expect(ADZUNA_EFFECTIVE_DAILY_CUTOFF * 30).toBeLessThan(2_500)
  })
})

describe('discovery freshness', () => {
  it('allows the morning slot its full grace period before requiring it', () => {
    const previousRun = '2026-07-17T09:01:00.000Z' // 04:01 Chicago

    expect(assessDiscoveryFreshness({
      last_discovery_at: previousRun,
      last_discovery_success_at: previousRun,
    }, new Date('2026-07-17T11:14:59.000Z')).fresh).toBe(true)

    expect(assessDiscoveryFreshness({
      last_discovery_at: previousRun,
      last_discovery_success_at: previousRun,
    }, new Date('2026-07-17T11:15:00.000Z'))).toMatchObject({
      fresh: false,
      reason: 'stale-completion',
      expectedAfter: '2026-07-17T11:00:00.000Z',
    })
  })

  it('requires the next off-hours slot only after its grace period', () => {
    const noonRun = '2026-07-17T17:02:00.000Z'

    expect(latestDueDiscoverySlot(new Date('2026-07-17T19:14:59.000Z')).toISOString())
      .toBe('2026-07-17T17:00:00.000Z')
    expect(latestDueDiscoverySlot(new Date('2026-07-17T19:15:00.000Z')).toISOString())
      .toBe('2026-07-17T19:00:00.000Z')
    expect(assessDiscoveryFreshness({
      last_discovery_at: noonRun,
      last_discovery_success_at: noonRun,
    }, new Date('2026-07-17T19:15:00.000Z')).reason).toBe('stale-completion')
  })

  it('distinguishes missing completion and success timestamps', () => {
    const now = new Date('2026-07-17T12:00:00.000Z')

    expect(assessDiscoveryFreshness({
      last_discovery_at: null,
      last_discovery_success_at: null,
    }, now).reason).toBe('missing-completion')
    expect(assessDiscoveryFreshness({
      last_discovery_at: '2026-07-17T11:35:00.000Z',
      last_discovery_success_at: null,
    }, now).reason).toBe('missing-success')
  })

  it('resolves due slots in Chicago local time across DST seasons', () => {
    expect(latestDueDiscoverySlot(new Date('2026-01-17T12:45:00.000Z')).toISOString())
      .toBe('2026-01-17T12:30:00.000Z')
    expect(latestDueDiscoverySlot(new Date('2026-07-17T11:45:00.000Z')).toISOString())
      .toBe('2026-07-17T11:30:00.000Z')
  })
})

describe('summarizeDiscovery', () => {
  it('fails loudly when every attempted query fails', () => {
    expect(summarizeDiscovery(3, 0)).toEqual({
      status: 'failed',
      httpStatus: 503,
    })
  })

  it('reports degraded health when only some queries succeed', () => {
    expect(summarizeDiscovery(3, 1)).toEqual({
      status: 'degraded',
      httpStatus: 200,
    })
  })

  it('reports healthy discovery when every query succeeds', () => {
    expect(summarizeDiscovery(3, 3)).toEqual({
      status: 'ok',
      httpStatus: 200,
    })
  })

  it('reports degraded health when quota skips configured queries after success', () => {
    expect(summarizeDiscovery(2, 2, 1)).toEqual({
      status: 'degraded',
      httpStatus: 200,
    })
  })

  it('keeps all-attempted-failed as failed even when quota skips queries', () => {
    expect(summarizeDiscovery(2, 0, 1)).toEqual({
      status: 'failed',
      httpStatus: 503,
    })
  })

  it('treats a sweep with no enabled queries as healthy no-work', () => {
    expect(summarizeDiscovery(0, 0)).toEqual({
      status: 'ok',
      httpStatus: 200,
    })
  })
})

describe('distinctSeedQueries', () => {
  it('dedupes normalized query pairs while preserving first-seen values', () => {
    expect(distinctSeedQueries([
      { what: 'software engineer', where_loc: 'Chicago, IL' },
      { what: 'Software Engineer', where_loc: ' chicago, il ' },
      { what: 'data engineer', where_loc: 'Chicago, IL' },
    ])).toEqual([
      { what: 'software engineer', where_loc: 'Chicago, IL' },
      { what: 'data engineer', where_loc: 'Chicago, IL' },
    ])
  })
})

describe('atomic discovery admission', () => {
  it('serializes slot admission and quota reservation on the heartbeat row', () => {
    expect(atomicMigration).toContain('function public.admit_discovery_slot')
    expect(atomicMigration).toContain('p_slot <= current_slot')
    expect(atomicMigration.match(/for update;/g)).toHaveLength(2)
    expect(atomicMigration).toContain("clock_timestamp() at time zone 'UTC'")
    expect(atomicMigration).toContain('grant execute on function public.reserve_adzuna_request')
    expect(atomicMigration).toContain('to service_role')
  })

  it('reads the UTC quota date only after acquiring the heartbeat lock', () => {
    const lockAt = lockThenClockMigration.indexOf('for update;')
    const clockAt = lockThenClockMigration.indexOf(
      "utc_today := (clock_timestamp() at time zone 'UTC')::date;",
    )
    expect(lockThenClockMigration).toContain('function public.reserve_adzuna_request')
    expect(lockAt).toBeGreaterThan(-1)
    expect(clockAt).toBeGreaterThan(lockAt)
  })

  it('reserves quota immediately before each Adzuna request', () => {
    const reserveAt = sweepSource.indexOf('await reserveAdzunaRequest(admin)')
    const fetchAt = sweepSource.indexOf('const response = await fetch(', reserveAt)
    expect(reserveAt).toBeGreaterThan(-1)
    expect(fetchAt).toBeGreaterThan(reserveAt)
    expect(sweepSource.slice(reserveAt, fetchAt)).not.toContain('continue')
  })

  it('persists failed health when Adzuna credentials are missing', () => {
    expect(sweepSource).toContain("discovery_status: 'failed'")
    expect(sweepSource).toContain("{ error: 'Missing Adzuna credentials', discoveryStatus: 'failed' }")
  })

  it('reopens exact-ID Adzuna rows without updating first-sight snapshot fields', () => {
    const exactBranch = sweepSource.slice(
      sweepSource.indexOf("if (exactAction !== 'insert'"),
      sweepSource.indexOf('if (existing) {'),
    )
    expect(exactBranch).toContain("status: 'open'")
    expect(exactBranch).toContain('closed_at: null')
    expect(exactBranch).toContain('last_seen_at: seenAt')
    expect(exactBranch).not.toContain('title:')
    expect(exactBranch).not.toContain('absolute_url:')
    expect(exactBranch).not.toContain('description_text:')

    const ageOutBranch = sweepSource.slice(
      sweepSource.indexOf(".update({ status: 'closed'"),
      sweepSource.indexOf(".select('id')", sweepSource.indexOf(".update({ status: 'closed'")),
    )
    expect(ageOutBranch).toContain(".lt('last_seen_at', cutoff)")
    expect(ageOutBranch).not.toContain('first_seen_at')
  })

  it('materializes seeds and reports quota-skipped query count', () => {
    expect(sweepSource).toContain('const seeds = distinctSeedQueries(')
    expect(sweepSource).toContain('const skippedQueries = Math.max(0, seeds.length - attempted)')
    expect(sweepSource).toContain('summarizeDiscovery(attempted, succeeded, skippedQueries)')
  })
})

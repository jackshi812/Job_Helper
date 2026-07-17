export interface DiscoveryHealth {
  status: 'ok' | 'degraded' | 'failed'
  httpStatus: 200 | 503
}

export interface DiscoverySeedQuery {
  what: string
  where_loc: string
}

export const ADZUNA_DAILY_CUTOFF = 240
export const ADZUNA_WEEKLY_LIMIT = 1_000
export const ADZUNA_MONTHLY_LIMIT = 2_500

// Reserve ten percent of the weekly/monthly allowance for exceptional manual
// probes and retries. A daily allocation derived from the longer windows makes
// those quotas enforceable with the existing UTC-day request ledger.
export const ADZUNA_EFFECTIVE_DAILY_CUTOFF = Math.min(
  ADZUNA_DAILY_CUTOFF,
  Math.floor((ADZUNA_WEEKLY_LIMIT * 0.9) / 7),
  Math.floor((ADZUNA_MONTHLY_LIMIT * 0.9) / 30),
)

export const DISCOVERY_GRACE_MS = 15 * 60_000

export interface DiscoveryHeartbeatTimestamps {
  last_discovery_at: string | null
  last_discovery_success_at: string | null
}

export type DiscoveryFreshnessReason =
  | 'fresh'
  | 'missing-completion'
  | 'missing-success'
  | 'stale-completion'
  | 'stale-success'

export interface DiscoveryFreshness {
  fresh: boolean
  reason: DiscoveryFreshnessReason
  expectedAfter: string
}

const chicagoParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** Returns the accepted Chicago-local discovery slot, or null when this tick is gated. */
export function chicagoDiscoverySlot(date: Date): string | null {
  const parts = Object.fromEntries(
    chicagoParts.formatToParts(date).map((part) => [part.type, part.value]),
  )
  const hour = Number(parts.hour)
  const minute = Number(parts.minute)
  const isMorning = hour >= 6 && hour < 12
  const minuteSlot = minute < 30 ? 0 : 30

  if (!isMorning && (hour % 2 !== 0 || minuteSlot !== 0)) return null

  return `${parts.year}-${parts.month}-${parts.day}T${String(hour).padStart(2, '0')}:${String(minuteSlot).padStart(2, '0')}`
}

/**
 * Finds the most recent discovery slot whose grace period has elapsed.
 * Scanning UTC half-hours and applying the Chicago-local gate keeps spring and
 * fall DST transitions aligned with the same rule used by discovery-sweep.
 */
export function latestDueDiscoverySlot(
  now: Date,
  graceMs = DISCOVERY_GRACE_MS,
): Date {
  const cursor = new Date(now.getTime() - graceMs)
  cursor.setUTCSeconds(0, 0)
  cursor.setUTCMinutes(cursor.getUTCMinutes() < 30 ? 0 : 30)

  // The longest cadence gap is two hours; two days is a defensive upper bound.
  for (let attempt = 0; attempt < 96; attempt += 1) {
    if (chicagoDiscoverySlot(cursor) !== null) return new Date(cursor)
    cursor.setUTCMinutes(cursor.getUTCMinutes() - 30)
  }

  throw new Error('Unable to resolve a due discovery slot')
}

export function assessDiscoveryFreshness(
  heartbeat: DiscoveryHeartbeatTimestamps,
  now: Date,
  graceMs = DISCOVERY_GRACE_MS,
): DiscoveryFreshness {
  const expectedAfter = latestDueDiscoverySlot(now, graceMs)
  const expectedMs = expectedAfter.getTime()
  const completionMs = heartbeat.last_discovery_at
    ? new Date(heartbeat.last_discovery_at).getTime()
    : Number.NaN
  const successMs = heartbeat.last_discovery_success_at
    ? new Date(heartbeat.last_discovery_success_at).getTime()
    : Number.NaN

  if (!Number.isFinite(completionMs)) {
    return {
      fresh: false,
      reason: 'missing-completion',
      expectedAfter: expectedAfter.toISOString(),
    }
  }

  if (!Number.isFinite(successMs)) {
    return {
      fresh: false,
      reason: 'missing-success',
      expectedAfter: expectedAfter.toISOString(),
    }
  }

  if (completionMs < expectedMs) {
    return {
      fresh: false,
      reason: 'stale-completion',
      expectedAfter: expectedAfter.toISOString(),
    }
  }

  if (successMs < expectedMs) {
    return {
      fresh: false,
      reason: 'stale-success',
      expectedAfter: expectedAfter.toISOString(),
    }
  }

  return {
    fresh: true,
    reason: 'fresh',
    expectedAfter: expectedAfter.toISOString(),
  }
}

export function summarizeDiscovery(
  attempted: number,
  succeeded: number,
  skipped = 0,
): DiscoveryHealth {
  if (attempted > 0 && succeeded === 0) {
    return { status: 'failed', httpStatus: 503 }
  }

  if (succeeded < attempted || skipped > 0) {
    return { status: 'degraded', httpStatus: 200 }
  }

  return { status: 'ok', httpStatus: 200 }
}

export function distinctSeedQueries(
  seeds: DiscoverySeedQuery[],
): DiscoverySeedQuery[] {
  const seen = new Set<string>()

  return seeds.filter((seed) => {
    const key = `${seed.what.trim().toLowerCase()}\u0000${seed.where_loc.trim().toLowerCase()}`
    if (seen.has(key)) return false

    seen.add(key)
    return true
  })
}

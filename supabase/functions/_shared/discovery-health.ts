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

export function summarizeDiscovery(
  attempted: number,
  succeeded: number,
): DiscoveryHealth {
  if (attempted > 0 && succeeded === 0) {
    return { status: 'failed', httpStatus: 503 }
  }

  if (succeeded < attempted) {
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

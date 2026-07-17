export interface DiscoveryHealth {
  status: 'ok' | 'degraded' | 'failed'
  httpStatus: 200 | 503
}

export interface DiscoverySeedQuery {
  what: string
  where_loc: string
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

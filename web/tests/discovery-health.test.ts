import { describe, expect, it } from 'vitest'
import {
  ADZUNA_EFFECTIVE_DAILY_CUTOFF,
  chicagoDiscoverySlot,
  distinctSeedQueries,
  summarizeDiscovery,
} from '../../supabase/functions/_shared/discovery-health'

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

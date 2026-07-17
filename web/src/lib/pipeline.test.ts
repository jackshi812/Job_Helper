import { describe, expect, it, vi } from 'vitest'
import { deriveHeartbeatBanner, type HeartbeatRow } from './pipeline'

vi.mock('./supabase', () => ({ supabase: {} }))

const nowMs = new Date('2026-07-17T12:00:00.000Z').getTime()

function heartbeat(overrides: Partial<HeartbeatRow> = {}): HeartbeatRow {
  return {
    last_tick_at: new Date(nowMs - 60_000).toISOString(),
    last_success_at: new Date(nowMs - 5 * 60_000).toISOString(),
    last_discovery_at: new Date(nowMs - 5 * 60_000).toISOString(),
    last_discovery_success_at: new Date(nowMs - 5 * 60_000).toISOString(),
    discovery_status: 'ok',
    ...overrides,
  }
}

describe('deriveHeartbeatBanner', () => {
  it('warns when the last successful poll is stale', () => {
    const banner = deriveHeartbeatBanner(heartbeat({
      last_success_at: new Date(nowMs - 31 * 60_000).toISOString(),
    }), false, nowMs)

    expect(banner.show).toBe(true)
    expect(banner.message).toContain("hasn't run since")
  })

  it('stays hidden when polling and discovery are healthy', () => {
    expect(deriveHeartbeatBanner(heartbeat(), false, nowMs)).toEqual({
      show: false,
      message: '',
    })
  })

  it('warns when fresh polling reports failed discovery', () => {
    const banner = deriveHeartbeatBanner(
      heartbeat({ discovery_status: 'failed' }),
      false,
      nowMs,
    )

    expect(banner.show).toBe(true)
    expect(banner.message).toContain('Aggregator discovery is failing')
  })

  it('warns when discovery has never completed', () => {
    const banner = deriveHeartbeatBanner(
      heartbeat({
        last_discovery_at: null,
        last_discovery_success_at: null,
      }),
      false,
      nowMs,
    )

    expect(banner.show).toBe(true)
    expect(banner.message).toContain("hasn't completed yet")
  })

  it('warns when discovery is degraded despite fresh timestamps', () => {
    const banner = deriveHeartbeatBanner(
      heartbeat({ discovery_status: 'degraded' }),
      false,
      nowMs,
    )

    expect(banner.show).toBe(true)
    expect(banner.message).toContain('discovery is degraded')
  })

  it('prioritizes stale polling over discovery warnings', () => {
    const banner = deriveHeartbeatBanner(
      heartbeat({
        last_success_at: new Date(nowMs - 31 * 60_000).toISOString(),
        last_discovery_at: null,
        last_discovery_success_at: null,
        discovery_status: 'degraded',
      }),
      false,
      nowMs,
    )

    expect(banner.message).toContain("Job monitoring hasn't run since")
  })

  it('prioritizes a failed discovery status over stale discovery timestamps', () => {
    const banner = deriveHeartbeatBanner(
      heartbeat({
        last_discovery_at: null,
        last_discovery_success_at: null,
        discovery_status: 'failed',
      }),
      false,
      nowMs,
    )

    expect(banner.message).toContain('Aggregator discovery is failing')
  })

  it('warns when monitoring health cannot be queried', () => {
    const banner = deriveHeartbeatBanner(undefined, true, nowMs)

    expect(banner.show).toBe(true)
    expect(banner.message).toContain('status is unavailable')
  })

  it('stays hidden while the first health query is loading', () => {
    expect(deriveHeartbeatBanner(undefined, false, nowMs)).toEqual({
      show: false,
      message: '',
    })
  })
})

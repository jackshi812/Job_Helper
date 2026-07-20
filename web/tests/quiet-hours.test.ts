import { describe, expect, it } from 'vitest'
import {
  digestDue,
  quietHoursState,
  userLocalDate,
  userLocalMinutes,
} from '../../supabase/functions/_shared/quiet-hours'

const CHICAGO = 'America/Chicago'

// All fixtures use exact UTC ISO instants whose Chicago wall-clock time was
// verified against Intl.DateTimeFormat (CST = UTC-6, CDT = UTC-5). The DST
// transition dates in 2026 are spring-forward 2026-03-08 (02:00 CST -> 03:00 CDT)
// and fall-back 2026-11-01 (02:00 CDT -> 01:00 CST).

describe('userLocalMinutes', () => {
  it('returns minutes-since-midnight in the user zone (not UTC)', () => {
    // 2026-07-15T13:00:00Z == 08:00 Chicago (CDT).
    expect(userLocalMinutes(CHICAGO, '2026-07-15T13:00:00Z')).toBe(480)
  })

  it('reads the local wall-clock across a UTC-midnight rollover', () => {
    // 2026-07-16T04:30:00Z == 23:30 Chicago on the prior local day.
    expect(userLocalMinutes(CHICAGO, '2026-07-16T04:30:00Z')).toBe(23 * 60 + 30)
  })
})

describe('userLocalDate', () => {
  it('returns the local YYYY-MM-DD, not the UTC date', () => {
    // 2026-07-16T04:30:00Z is 2026-07-16 in UTC but 2026-07-15 in Chicago.
    expect(userLocalDate(CHICAGO, '2026-07-16T04:30:00Z')).toBe('2026-07-15')
  })

  it('holds the local date when UTC has already rolled over (fall-back)', () => {
    // 2026-11-02T04:00:00Z == 22:00 Chicago on 2026-11-01 (CST).
    expect(userLocalDate(CHICAGO, '2026-11-02T04:00:00Z')).toBe('2026-11-01')
  })
})

describe('quietHoursState (midnight-wrapping 22:00-07:00)', () => {
  const prefs = { quietStart: '22:00', quietEnd: '07:00', timezone: CHICAGO }

  it('is quiet at 23:30 local (inside the wrapping window)', () => {
    expect(quietHoursState(prefs, '2026-07-16T04:30:00Z')).toEqual({ inQuietWindow: true })
  })

  it('is not quiet at 08:00 local (outside the window)', () => {
    expect(quietHoursState(prefs, '2026-07-15T13:00:00Z')).toEqual({ inQuietWindow: false })
  })

  it('null quietStart disables quiet hours', () => {
    expect(
      quietHoursState({ quietStart: null, quietEnd: '07:00', timezone: CHICAGO }, '2026-07-16T04:30:00Z'),
    ).toEqual({ inQuietWindow: false })
  })

  it('null quietEnd disables quiet hours', () => {
    expect(
      quietHoursState({ quietStart: '22:00', quietEnd: null, timezone: CHICAGO }, '2026-07-16T04:30:00Z'),
    ).toEqual({ inQuietWindow: false })
  })

  // DST spring-forward: anchored to local wall-clock, not UTC offset.
  it('DST spring-forward: 06:59 local is still quiet', () => {
    // 2026-03-08T11:59:00Z == 06:59 Chicago (post spring-forward CDT).
    expect(quietHoursState(prefs, '2026-03-08T11:59:00Z')).toEqual({ inQuietWindow: true })
  })

  it('DST spring-forward: 07:00 local is not quiet (exclusive end)', () => {
    // 2026-03-08T12:00:00Z == 07:00 Chicago.
    expect(quietHoursState(prefs, '2026-03-08T12:00:00Z')).toEqual({ inQuietWindow: false })
  })

  // DST fall-back: same wall-clock anchoring the other direction.
  it('DST fall-back: 06:59 local is still quiet', () => {
    // 2026-11-01T12:59:00Z == 06:59 Chicago (post fall-back CST).
    expect(quietHoursState(prefs, '2026-11-01T12:59:00Z')).toEqual({ inQuietWindow: true })
  })

  it('DST fall-back: 22:00 local is quiet (inclusive start)', () => {
    // 2026-11-02T04:00:00Z == 22:00 Chicago on 2026-11-01 (CST).
    expect(quietHoursState(prefs, '2026-11-02T04:00:00Z')).toEqual({ inQuietWindow: true })
  })
})

describe('quietHoursState (non-wrapping 09:00-17:00)', () => {
  const prefs = { quietStart: '09:00', quietEnd: '17:00', timezone: CHICAGO }

  it('is quiet at 09:00 local (inclusive start)', () => {
    // 2026-07-15T14:00:00Z == 09:00 Chicago (CDT).
    expect(quietHoursState(prefs, '2026-07-15T14:00:00Z')).toEqual({ inQuietWindow: true })
  })

  it('is not quiet at 17:00 local (exclusive end)', () => {
    // 2026-07-15T22:00:00Z == 17:00 Chicago (CDT).
    expect(quietHoursState(prefs, '2026-07-15T22:00:00Z')).toEqual({ inQuietWindow: false })
  })
})

describe('digestDue', () => {
  it('is due at 08:05 local when not yet sent today', () => {
    // 2026-07-15T13:05:00Z == 08:05 Chicago; digest at 08:00; last sent yesterday.
    expect(
      digestDue(
        { digestTime: '08:00', timezone: CHICAGO, lastDigestDate: '2026-07-14' },
        '2026-07-15T13:05:00Z',
      ),
    ).toBe(true)
  })

  it('is not due when already sent today', () => {
    expect(
      digestDue(
        { digestTime: '08:00', timezone: CHICAGO, lastDigestDate: '2026-07-15' },
        '2026-07-15T13:05:00Z',
      ),
    ).toBe(false)
  })

  it('is not due before the digest time', () => {
    // 2026-07-15T12:00:00Z == 07:00 Chicago, before 08:00.
    expect(
      digestDue(
        { digestTime: '08:00', timezone: CHICAGO, lastDigestDate: null },
        '2026-07-15T12:00:00Z',
      ),
    ).toBe(false)
  })

  it('is due when never sent (null lastDigestDate) and time reached', () => {
    expect(
      digestDue(
        { digestTime: '08:00', timezone: CHICAGO, lastDigestDate: null },
        '2026-07-15T13:05:00Z',
      ),
    ).toBe(true)
  })

  // Regression: Postgres `time` columns serialize through PostgREST WITH seconds
  // ("08:00:00"). The HH:MM-only parser silently disabled every digest in prod.
  it('accepts the HH:MM:SS form Postgres returns for a time column', () => {
    expect(
      digestDue(
        { digestTime: '08:00:00', timezone: CHICAGO, lastDigestDate: null },
        '2026-07-15T13:05:00Z',
      ),
    ).toBe(true)
  })

  it('is not due before an HH:MM:SS digest time', () => {
    // 07:00 Chicago, before 08:00:00.
    expect(
      digestDue(
        { digestTime: '08:00:00', timezone: CHICAGO, lastDigestDate: null },
        '2026-07-15T12:00:00Z',
      ),
    ).toBe(false)
  })

  it('treats midnight "00:00:00" as a valid (always-reached) digest time', () => {
    expect(
      digestDue(
        { digestTime: '00:00:00', timezone: 'UTC', lastDigestDate: null },
        '2026-07-15T23:40:00Z',
      ),
    ).toBe(true)
  })
})

describe('quietHoursState with HH:MM:SS (Postgres time serialization)', () => {
  it('evaluates a wrapping 22:00:00-07:00:00 window the same as 22:00-07:00', () => {
    // 2026-07-16T04:30:00Z == 23:30 Chicago -> inside the window.
    expect(
      quietHoursState(
        { quietStart: '22:00:00', quietEnd: '07:00:00', timezone: CHICAGO },
        '2026-07-16T04:30:00Z',
      ).inQuietWindow,
    ).toBe(true)
  })
})

// Pure, DST-safe user-local time math for the notification dispatcher (D-19
// quiet hours, D-20 daily digest). No Deno globals — this module is imported by
// both notify-tick (Deno) AND Vitest (Node), so it must stay runtime-neutral.
//
// The one hard rule (RESEARCH Pitfall 4): NEVER do UTC-offset arithmetic. All
// wall-clock conversion goes through Intl.DateTimeFormat with the user's IANA
// timezone, which is DST-correct for free. A "22:00-07:00" quiet window stays
// anchored to local wall-clock across both DST transitions.

export interface QuietHoursPrefs {
  quietStart: string | null
  quietEnd: string | null
  timezone: string
}

export interface DigestPrefs {
  digestTime: string
  timezone: string
  lastDigestDate: string | null
}

// Parse an "HH:MM" string to minutes-since-midnight. Returns null for malformed
// input so callers can treat "no valid window" as "no quiet hours".
function parseHhMm(value: string | null): number | null {
  if (!value) return null
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return hours * 60 + minutes
}

// Minutes-since-midnight in the user's timezone for a given UTC instant.
// hourCycle 'h23' guarantees 00-23 (avoids the en-US "24:00" midnight quirk).
export function userLocalMinutes(timezone: string, nowIso: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(nowIso))
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0') % 24
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0')
  return hour * 60 + minute
}

// The user-local YYYY-MM-DD for a given UTC instant — the digest-dedup key.
export function userLocalDate(timezone: string, nowIso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(nowIso))
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000'
  const month = parts.find((part) => part.type === 'month')?.value ?? '01'
  const day = parts.find((part) => part.type === 'day')?.value ?? '01'
  return `${year}-${month}-${day}`
}

// D-19 quiet-window state. A window with no configured start OR end is disabled.
// Non-wrapping (start < end): quiet on [start, end) — inclusive start, exclusive
// end. Midnight-wrapping (start > end, e.g. 22:00-07:00): quiet when now >= start
// OR now < end. start == end is treated as an empty (disabled) window.
export function quietHoursState(
  prefs: QuietHoursPrefs,
  nowIso: string,
): { inQuietWindow: boolean } {
  const start = parseHhMm(prefs.quietStart)
  const end = parseHhMm(prefs.quietEnd)
  if (start === null || end === null || start === end) {
    return { inQuietWindow: false }
  }
  const now = userLocalMinutes(prefs.timezone, nowIso)
  const inQuietWindow =
    start < end ? now >= start && now < end : now >= start || now < end
  return { inQuietWindow }
}

// D-20 digest gate: due when local time has reached digest_time AND a digest has
// not already been sent on today's local date. Malformed digest_time never fires.
export function digestDue(prefs: DigestPrefs, nowIso: string): boolean {
  const digestMinutes = parseHhMm(prefs.digestTime)
  if (digestMinutes === null) return false
  const now = userLocalMinutes(prefs.timezone, nowIso)
  if (now < digestMinutes) return false
  const today = userLocalDate(prefs.timezone, nowIso)
  return prefs.lastDigestDate !== today
}

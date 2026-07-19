// Pure resume-routing module (D-06) with tier mapping (D-07). No I/O, no Deno
// globals, and no registry-prefixed import specifiers, so web/tests can import it
// cross-repo (the dedup.ts / filters.ts precedent). routeResume picks the
// best-fit resume for a job by keyword overlap and, on a near-tie, surfaces a
// runner-up (D-06 "near-ties pick top overlap and show runner-up"). Routing never
// blocks scoring: even all-zero overlap returns a deterministic pick — the AI
// judges real relevance against the routed resume.

export interface ResumeExtractInput {
  resumeId: string
  filename: string
  keywords: string[]
}

export interface RoutingResult {
  resumeId: string
  runnerUpResumeId: string | null
  hitCounts: Record<string, number>
}

// Mirrors the dedup.ts / filters.ts normalize philosophy: lowercase, strip
// parentheticals, non-alphanumeric -> space, collapse whitespace.
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(value: string): string[] {
  const normalized = normalize(value)
  return normalized.length === 0 ? [] : normalized.split(' ')
}

// Whole-word / contiguous-phrase membership so a single-word keyword matches only
// a whole token and a multi-word keyword matches only a contiguous token run
// (prevents e.g. `r` matching inside `react`). Same shape as filters.ts.
function containsTokenSequence(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0) return false
  if (needle.length === 1) return haystack.includes(needle[0])
  for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    let match = true
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        match = false
        break
      }
    }
    if (match) return true
  }
  return false
}

// Count distinct keywords (deduped by normalized form) whose normalized token
// sequence appears in the job text.
function countHits(jobTokens: string[], keywords: string[]): number {
  const seen = new Set<string>()
  let hits = 0
  for (const keyword of keywords) {
    const needle = tokenize(keyword)
    if (needle.length === 0) continue
    const key = needle.join(' ')
    if (seen.has(key)) continue
    seen.add(key)
    if (containsTokenSequence(jobTokens, needle)) hits += 1
  }
  return hits
}

// D-06 keyword-overlap routing. Returns null only when there are no extracts
// (the caller marks no_resume_extract). Sorts by hit count desc, then filename
// asc for a stable, deterministic winner even on all-zero overlap. A runner-up is
// reported only on a near-tie: the top-two gap is within max(2, ceil(top*0.15))
// and the runner-up itself has at least one hit (Claude-discretion tie-break per
// CONTEXT — an all-zero runner-up is not a meaningful alternative).
export function routeResume(
  jobText: string,
  extracts: ResumeExtractInput[],
): RoutingResult | null {
  if (extracts.length === 0) return null

  const jobTokens = tokenize(jobText)
  const hitCounts: Record<string, number> = {}
  const ranked = extracts
    .map((extract) => {
      const count = countHits(jobTokens, extract.keywords)
      hitCounts[extract.resumeId] = count
      return { extract, count }
    })
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count
      return a.extract.filename < b.extract.filename ? -1 : 1
    })

  const top = ranked[0]
  const second = ranked[1]

  let runnerUpResumeId: string | null = null
  if (second) {
    const tolerance = Math.max(2, Math.ceil(top.count * 0.15))
    if (second.count > 0 && top.count - second.count <= tolerance) {
      runnerUpResumeId = second.extract.resumeId
    }
  }

  return { resumeId: top.extract.resumeId, runnerUpResumeId, hitCounts }
}

// D-07 exact tier boundaries: Strong >= 75, Good >= 50, else Weak.
export function tierFor(score: number): 'Strong' | 'Good' | 'Weak' {
  if (score >= 75) return 'Strong'
  if (score >= 50) return 'Good'
  return 'Weak'
}

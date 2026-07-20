// Pure cheap-filter module (D-01/D-02/D-03). No I/O, no runtime globals, and no
// registry-prefixed import specifiers, so web/tests can import it cross-repo (the
// dedup.ts / lifecycle.ts precedent). cheapFilter gates every AI dollar: discards
// only on a hard exclude-keyword hit, a clear location mismatch, or clear title
// non-overlap — and returns one of exactly three bounded reason codes (D-04).

export type FilterOutcome =
  | { pass: true; matchedIncludeKeywords: string[] }
  | {
      pass: false
      reason: 'excluded_keyword' | 'wrong_location' | 'title_non_overlap'
      detail: string
    }

export interface FilterJobInput {
  title: string
  location: string | null
  descriptionText: string
}

export interface FilterPreferences {
  titles: string[]
  locations: string[]
  includeKeywords: string[]
  excludeKeywords: string[]
}

// D-01 named pairs plus a few Claude-discretion extensions. Keys are canonical
// short forms; values are the expanded forms (may be multi-word). Expansion is
// applied bidirectionally at the token level for title overlap only — exclude
// keywords are NEVER expanded through synonyms (exclusions are literal, D-02).
export const SYNONYMS: Record<string, string[]> = {
  quant: ['quantitative'],
  sr: ['senior'],
  jr: ['junior'],
  ml: ['machine learning'],
  swe: ['software engineer'],
  ds: ['data scientist'],
  eng: ['engineer'],
  engr: ['engineer'],
  mgr: ['manager'],
  ba: ['business analyst'],
  pm: ['product manager'],
}

const TITLE_STOPWORDS = new Set(['of', 'the', 'and', 'a', 'an', 'for', 'to', 'in'])

// Mirrors the dedup.ts normalize philosophy: lowercase, strip parentheticals,
// non-alphanumeric -> space, collapse whitespace.
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

// Whole-word / contiguous-phrase membership. A single-word needle matches only
// when it equals a whole token; a multi-word needle matches only when its token
// sequence appears contiguously in the haystack. Prevents short excludes like
// `c`, `go`, `staff` from firing inside `cloud`, `category`, `staffing`.
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

// Token-level bidirectional synonym index. Each token of a synonym key is linked
// to each token of every value form and vice-versa. A multi-word configured form
// therefore lets one abbreviation satisfy each of its concepts (for example,
// `ds` satisfies both `data` and `scientist`) without making unrelated shared
// words sufficient for an entire preferred title.
const SYNONYM_INDEX: Map<string, Set<string>> = (() => {
  const index = new Map<string, Set<string>>()
  const link = (a: string, b: string) => {
    if (!index.has(a)) index.set(a, new Set())
    index.get(a)!.add(b)
  }
  for (const [key, values] of Object.entries(SYNONYMS)) {
    const keyTokens = key.split(' ')
    for (const value of values) {
      const valueTokens = value.split(' ')
      for (const kt of keyTokens) {
        for (const vt of valueTokens) {
          link(kt, vt)
          link(vt, kt)
        }
      }
    }
  }
  return index
})()

// Conservative one-step variants only. Variants are derived from the original
// token and never fed back through this function, so there is no recursive
// stemming or broad fuzzy match.
function inflectionVariants(token: string): Set<string> {
  const variants = new Set([token])
  if (token.endsWith('ies')) {
    const stem = token.slice(0, -3)
    if (stem.length >= 3) variants.add(`${stem}y`)
  }
  if (token.endsWith('s')) {
    const base = token.slice(0, -1)
    if (base.length >= 4 && !base.endsWith('ss')) variants.add(base)
  }
  if (token.endsWith('er')) {
    const base = token.slice(0, -2)
    if (base.length >= 6) variants.add(base)
  }
  if (token.endsWith('ing')) {
    const base = token.slice(0, -3)
    if (base.length >= 6) variants.add(base)
  }
  return variants
}

function titleConceptVariants(token: string): Set<string> {
  const expanded = inflectionVariants(token)
  for (const variant of [...expanded]) {
    const synonyms = SYNONYM_INDEX.get(variant)
    if (synonyms) for (const synonym of synonyms) expanded.add(synonym)
  }
  return expanded
}

function significantTitleConcepts(value: string): string[] {
  return tokenize(value).filter((token) => !TITLE_STOPWORDS.has(token))
}

function expandedJobTitleConcepts(value: string): Set<string> {
  const expanded = new Set<string>()
  for (const token of significantTitleConcepts(value)) {
    for (const variant of titleConceptVariants(token)) expanded.add(variant)
  }
  return expanded
}

export function cheapFilter(job: FilterJobInput, prefs: FilterPreferences): FilterOutcome {
  const titleTokens = tokenize(job.title)
  const locationTokens = tokenize(job.location ?? '')
  const descriptionTokens = tokenize(job.descriptionText)

  // 1. Exclude keywords (hard discard, checked first) — literal, never synonym-expanded.
  const excludeHaystack = [...titleTokens, ...descriptionTokens]
  for (const keyword of prefs.excludeKeywords) {
    const needle = tokenize(keyword)
    if (containsTokenSequence(excludeHaystack, needle)) {
      return { pass: false, reason: 'excluded_keyword', detail: needle.join(' ') }
    }
  }

  // 2. Location leniency — pass on empty prefs, blank job location, any remote
  // mention, or a preferred-location token sequence appearing in the job location.
  if (prefs.locations.length > 0 && locationTokens.length > 0) {
    const remoteHaystack = [...titleTokens, ...locationTokens, ...descriptionTokens]
    const isRemote = remoteHaystack.includes('remote')
    const matchesPreferred = prefs.locations.some((loc) =>
      containsTokenSequence(locationTokens, tokenize(loc)),
    )
    if (!isRemote && !matchesPreferred) {
      return { pass: false, reason: 'wrong_location', detail: normalize(job.location ?? '') }
    }
  }

  // 3. Title intent — pass on empty prefs.titles, otherwise at least one
  // preferred title must have every significant concept represented in the job
  // title by identity, a configured synonym, or one conservative inflection.
  // Word order is irrelevant and extra job-title suffixes are allowed.
  if (prefs.titles.length > 0) {
    const jobTitleConcepts = expandedJobTitleConcepts(job.title)
    const overlaps = prefs.titles.some((prefTitle) => {
      const preferredConcepts = significantTitleConcepts(prefTitle)
      return preferredConcepts.length === 0 || preferredConcepts.every((concept) => {
        for (const variant of titleConceptVariants(concept)) {
          if (jobTitleConcepts.has(variant)) return true
        }
        return false
      })
    })
    if (!overlaps) {
      return { pass: false, reason: 'title_non_overlap', detail: normalize(job.title) }
    }
  }

  // Passed all gates. Report matched include keywords (soft signal for scoring, D-02).
  const includeHaystack = [...titleTokens, ...descriptionTokens]
  const matchedIncludeKeywords = prefs.includeKeywords.filter((keyword) =>
    containsTokenSequence(includeHaystack, tokenize(keyword)),
  )
  return { pass: true, matchedIncludeKeywords }
}

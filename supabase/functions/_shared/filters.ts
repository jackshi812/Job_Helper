// Pure cheap-filter module (D-01/D-02/D-03). No I/O, no runtime globals, and no
// registry-prefixed import specifiers, so web/tests can import it cross-repo (the
// dedup.ts / lifecycle.ts precedent). cheapFilter gates every AI dollar: discards
// only on a hard exclude-keyword hit, a clear location mismatch, or clear title
// non-overlap — and returns one of exactly three bounded reason codes (D-04).

export type FilterOutcome =
  | { pass: true; matchedIncludeKeywords: string[] }
  | {
      pass: false
      reason: 'excluded_keyword' | 'wrong_location' | 'title_non_overlap' | 'experience_above_max'
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
  maxRequiredExperience?: number | null
}

const OPTIONAL_EXPERIENCE_SIGNAL = /\b(?:preferred|preferably|desired|bonus|optional|nice(?:[\s-]+)to(?:[\s-]+)have)\b|\b(?:is|would\s+be|considered)\s+(?:an?\s+)?plus\b/i
const REQUIRED_EXPERIENCE_SIGNAL = /\b(?:requires?|required|requirement|minimum(?:\s+of)?|at\s+least|must\s+have|need(?:ed)?|basic\s+qualifications?|minimum\s+qualifications?)\b/i
const EXPERIENCE_YEARS = /\b(\d{1,2})\s*(?:(?:-|to)\s*(\d{1,2})\s*)?(\+|plus)?\s*years?\b/gi
const LEADING_EXPERIENCE_TERM = /^\s*(?:of\s+)?(?:(?:professional|relevant|related|industry|work)\s+)?experience\b/i
const LEADING_EXPERIENCE_DOMAIN = /^\s+in\s+(?!total\b|duration\b)[a-z][a-z0-9&/+.-]*(?:\s+[a-z][a-z0-9&/+.-]*){0,2}\b/i
const LEADING_OPTIONAL_SIGNAL = /^\s*(?::|,|-)?\s*(?:is\s+)?(?:preferred|preferably|desired|a\s+bonus|optional|nice(?:[\s-]+)to(?:[\s-]+)have|would\s+be\s+(?:an?\s+)?plus|considered\s+(?:an?\s+)?plus)\b/i
const LEADING_REQUIRED_SIGNAL = /^\s*(?::|,|-)?\s*(?:is\s+)?(?:required|a\s+requirement|minimum|at\s+least|must\s+have|needed)\b/i
const EXPERIENCE_CONTEXT_RADIUS = 96

function experienceClauses(text: string): string[] {
  return text
    .split(/(?:[.!?;\n\r•●▪]+|,\s+|\s+(?:and|or)\s+)/i)
    .map((clause) => clause.trim())
    .filter(Boolean)
}

function lastSignalIndex(text: string, signal: RegExp): number {
  const matches = text.matchAll(new RegExp(signal.source, `${signal.flags.replace('g', '')}g`))
  let lastIndex = -1
  for (const match of matches) lastIndex = match.index
  return lastIndex
}

function parseMandatoryExperienceMinima(clause: string): number[] {
  const minima: number[] = []

  for (const match of clause.matchAll(EXPERIENCE_YEARS)) {
    const lowerBound = Number(match[1])
    if (!Number.isFinite(lowerBound) || match.index === undefined) continue

    const prefix = clause.slice(
      Math.max(0, match.index - EXPERIENCE_CONTEXT_RADIUS),
      match.index,
    )
    const suffix = clause.slice(
      match.index + match[0].length,
      match.index + match[0].length + EXPERIENCE_CONTEXT_RADIUS,
    )
    const requiredBefore = lastSignalIndex(prefix, REQUIRED_EXPERIENCE_SIGNAL)
    const optionalBefore = lastSignalIndex(prefix, OPTIONAL_EXPERIENCE_SIGNAL)
    const experienceTerm = suffix.match(LEADING_EXPERIENCE_TERM)
    const experienceDomain = suffix.match(LEADING_EXPERIENCE_DOMAIN)
    const suffixAfterExperience = experienceTerm ? suffix.slice(experienceTerm[0].length) : suffix
    const requiredAfter = LEADING_REQUIRED_SIGNAL.test(suffixAfterExperience)
    const optionalAfter = LEADING_OPTIONAL_SIGNAL.test(suffixAfterExperience)
    const hasRequiredBefore = requiredBefore >= 0 && requiredBefore > optionalBefore
    const hasOptionalBefore = optionalBefore >= 0 && optionalBefore > requiredBefore
    const isExperienceCandidate = Boolean(
      hasRequiredBefore || requiredAfter || experienceTerm || experienceDomain,
    )
    const isOptionalCandidate = optionalAfter || (hasOptionalBefore && !requiredAfter)

    if (isExperienceCandidate && !isOptionalCandidate) minima.push(lowerBound)
  }

  return minima
}

export function experienceMinimumRequired(description: string): number | null {
  const text = description.normalize('NFKC').replace(/[–—−]/g, '-').replace(/\u00a0/g, ' ')
  const mandatoryMinima = experienceClauses(text).flatMap(parseMandatoryExperienceMinima)
  return mandatoryMinima.length > 0 ? Math.max(...mandatoryMinima) : null
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

  if (prefs.maxRequiredExperience != null) {
    const minimum = experienceMinimumRequired(job.descriptionText)
    if (minimum !== null && minimum > prefs.maxRequiredExperience) {
      return { pass: false, reason: 'experience_above_max', detail: String(minimum) }
    }
  }

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

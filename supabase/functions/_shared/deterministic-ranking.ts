import {
  cheapFilter,
  containsNormalizedPhrase,
  experienceMinimumRequired,
  normalizedFilterTokens,
  titleConceptsMatch,
} from './filters.ts'

export type RankingTier = 'Strong' | 'Good' | 'Weak'
export type RankingCategory =
  | 'title'
  | 'location'
  | 'recency'
  | 'watchlist'
  | 'experience'
  | 'keywords'
export type RankingFilterReason =
  | 'excluded_title_keyword'
  | 'excluded_keyword'
  | 'outside_us'
  | 'title_non_overlap'

export interface RankingBreakdownRow {
  key: RankingCategory
  earned: number
  possible: number
  evidence: string[]
}

export interface RankingRubric {
  strictTitle: number
  weakTitle: number
  preferredLocation: number
  recency: number
  watchlist: number
  experience: number
  includeKeywordSteps: {
    one: number
    two: number
    three: number
    four: number
    fivePlus: number
  }
}

export interface RankingThresholds {
  good: number
  strong: number
}

export interface DeterministicRankingJob {
  title: string
  location: string | null
  descriptionText: string
  postedAt: string | null
  companyId: string | null
}

export interface DeterministicRankingPreferences {
  titles: string[]
  locations: string[]
  includeKeywords: string[]
  excludeKeywords: string[]
  titleExcludeKeywords: string[]
  maxRequiredExperience: number | null
}

export interface DeterministicRankingInput {
  job: DeterministicRankingJob
  preferences: DeterministicRankingPreferences
  evaluationTime: string
  rubric?: RankingRubric
  thresholds?: RankingThresholds
}

export interface DeterministicResult {
  eligible: boolean
  score: number | null
  tier: RankingTier | null
  filterReason: RankingFilterReason | null
  filterDetail: string | null
  breakdown: RankingBreakdownRow[]
}

export const DEFAULT_RANKING_RUBRIC: RankingRubric = Object.freeze({
  strictTitle: 30,
  weakTitle: 20,
  preferredLocation: 10,
  recency: 10,
  watchlist: 10,
  experience: 20,
  includeKeywordSteps: Object.freeze({
    one: 3,
    two: 5,
    three: 10,
    four: 15,
    fivePlus: 20,
  }),
})

export const DEFAULT_RANKING_THRESHOLDS: RankingThresholds = Object.freeze({
  good: 50,
  strong: 75,
})

const RUBRIC_KEYS = [
  'experience',
  'includeKeywordSteps',
  'preferredLocation',
  'recency',
  'strictTitle',
  'watchlist',
  'weakTitle',
] as const
const KEYWORD_STEP_KEYS = ['fivePlus', 'four', 'one', 'three', 'two'] as const
const THRESHOLD_KEYS = ['good', 'strong'] as const
const MAX_EVIDENCE_CODE_POINTS = 160
const PRECEDING_24_HOURS_MS = 24 * 60 * 60 * 1_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
}

function boundedInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 100
}

function validRubric(value: unknown): value is RankingRubric {
  if (!isRecord(value) || !hasExactKeys(value, RUBRIC_KEYS)) return false
  if (!isRecord(value.includeKeywordSteps) ||
      !hasExactKeys(value.includeKeywordSteps, KEYWORD_STEP_KEYS)) return false

  const categoryValues = [
    value.strictTitle,
    value.weakTitle,
    value.preferredLocation,
    value.recency,
    value.watchlist,
    value.experience,
  ]
  const steps = [
    value.includeKeywordSteps.one,
    value.includeKeywordSteps.two,
    value.includeKeywordSteps.three,
    value.includeKeywordSteps.four,
    value.includeKeywordSteps.fivePlus,
  ]
  if (![...categoryValues, ...steps].every(boundedInteger)) return false

  const rubric = value as unknown as RankingRubric
  if (rubric.weakTitle > rubric.strictTitle) return false
  if (
    rubric.strictTitle +
      rubric.preferredLocation +
      rubric.recency +
      rubric.watchlist +
      rubric.experience +
      rubric.includeKeywordSteps.fivePlus !==
    100
  ) return false
  for (let index = 1; index < steps.length; index += 1) {
    if (Number(steps[index]) < Number(steps[index - 1])) return false
  }
  return steps.every((step) => Number(step) <= rubric.includeKeywordSteps.fivePlus)
}

function validThresholds(value: unknown): value is RankingThresholds {
  if (!isRecord(value) || !hasExactKeys(value, THRESHOLD_KEYS)) return false
  if (!boundedInteger(value.good) || !boundedInteger(value.strong)) return false
  return value.good > 0 && value.good < value.strong && value.strong <= 100
}

export function validateRankingRubric(
  rubric: unknown,
  thresholds: unknown = DEFAULT_RANKING_THRESHOLDS,
): void {
  if (!validRubric(rubric)) throw new Error('invalid_ranking_rubric')
  if (!validThresholds(thresholds)) throw new Error('invalid_ranking_thresholds')
}

function boundedEvidence(value: string): string {
  const normalized = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return [...normalized].slice(0, MAX_EVIDENCE_CODE_POINTS).join('')
}

function phraseMatch(value: string, candidates: readonly string[]): string | null {
  for (const candidate of candidates) {
    if (containsNormalizedPhrase(value, candidate)) return candidate
  }
  return null
}

const US_STATE_NAMES = [
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado',
  'connecticut', 'delaware', 'florida', 'georgia', 'hawaii', 'idaho',
  'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana',
  'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota',
  'mississippi', 'missouri', 'montana', 'nebraska', 'nevada',
  'new hampshire', 'new jersey', 'new mexico', 'new york',
  'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon',
  'pennsylvania', 'rhode island', 'south carolina', 'south dakota',
  'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington',
  'west virginia', 'wisconsin', 'wyoming', 'district of columbia',
] as const
const US_STATE_ABBREVIATIONS = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
])
const EXPLICIT_US_PHRASES = [
  'united states of america',
  'united states',
  'u s a',
  'usa',
  'u s',
  'us',
] as const
const EXPLICIT_FOREIGN_PHRASES = [
  'united kingdom', 'great britain', 'uk', 'england', 'scotland', 'wales',
  'northern ireland', 'canada', 'mexico', 'australia', 'new zealand',
  'india', 'china', 'japan', 'singapore', 'hong kong', 'germany', 'france',
  'spain', 'italy', 'ireland', 'netherlands', 'belgium', 'switzerland',
  'austria', 'sweden', 'norway', 'denmark', 'finland', 'poland', 'portugal',
  'brazil', 'argentina', 'chile', 'colombia', 'south africa', 'israel',
  'united arab emirates', 'saudi arabia', 'philippines', 'malaysia',
  'indonesia', 'thailand', 'vietnam', 'south korea', 'taiwan',
  'ontario', 'quebec', 'british columbia', 'alberta',
] as const

function explicitStateAbbreviation(location: string): boolean {
  const delimitedSegments = location
    .split(/[,/|]/)
    .map((segment) => segment.trim().toUpperCase())
  if (delimitedSegments.some((segment) => US_STATE_ABBREVIATIONS.has(segment))) return true

  const uppercaseTokens = location.match(/\b[A-Z]{2}\b/g) ?? []
  return uppercaseTokens.some((token) => US_STATE_ABBREVIATIONS.has(token))
}

export function classifyUsLocation(
  location: string | null,
): 'us' | 'outside_us' | 'unknown' {
  if (!location || normalizedFilterTokens(location).length === 0) return 'unknown'
  if (phraseMatch(location, EXPLICIT_FOREIGN_PHRASES)) return 'outside_us'
  if (
    phraseMatch(location, EXPLICIT_US_PHRASES) ||
    phraseMatch(location, US_STATE_NAMES) ||
    explicitStateAbbreviation(location)
  ) return 'us'
  return 'unknown'
}

export function evaluateTitleMatch(
  jobTitle: string,
  configuredTitles: readonly string[],
): { kind: 'strict' | 'weak' | null; matchedTitle: string | null } {
  for (const configuredTitle of configuredTitles) {
    if (
      normalizedFilterTokens(configuredTitle).length > 0 &&
      containsNormalizedPhrase(jobTitle, configuredTitle)
    ) {
      return { kind: 'strict', matchedTitle: configuredTitle }
    }
  }
  for (const configuredTitle of configuredTitles) {
    if (titleConceptsMatch(jobTitle, configuredTitle)) {
      return { kind: 'weak', matchedTitle: configuredTitle }
    }
  }
  return { kind: null, matchedTitle: null }
}

function emptyBreakdown(rubric: RankingRubric): RankingBreakdownRow[] {
  return [
    { key: 'title', earned: 0, possible: rubric.strictTitle, evidence: [] },
    {
      key: 'location',
      earned: 0,
      possible: rubric.preferredLocation,
      evidence: [],
    },
    { key: 'recency', earned: 0, possible: rubric.recency, evidence: [] },
    { key: 'watchlist', earned: 0, possible: rubric.watchlist, evidence: [] },
    { key: 'experience', earned: 0, possible: rubric.experience, evidence: [] },
    {
      key: 'keywords',
      earned: 0,
      possible: rubric.includeKeywordSteps.fivePlus,
      evidence: [],
    },
  ]
}

function ineligibleResult(
  rubric: RankingRubric,
  filterReason: RankingFilterReason,
  filterDetail: string,
): DeterministicResult {
  return {
    eligible: false,
    score: null,
    tier: null,
    filterReason,
    filterDetail: boundedEvidence(filterDetail),
    breakdown: emptyBreakdown(rubric),
  }
}

function includeKeywordPoints(
  count: number,
  rubric: RankingRubric,
): number {
  if (count >= 5) return rubric.includeKeywordSteps.fivePlus
  if (count === 4) return rubric.includeKeywordSteps.four
  if (count === 3) return rubric.includeKeywordSteps.three
  if (count === 2) return rubric.includeKeywordSteps.two
  if (count === 1) return rubric.includeKeywordSteps.one
  return 0
}

function uniqueMatches(haystack: string, candidates: readonly string[]): string[] {
  const seen = new Set<string>()
  const matched: string[] = []
  for (const candidate of candidates) {
    const key = normalizedFilterTokens(candidate).join(' ')
    if (!key || seen.has(key)) continue
    seen.add(key)
    if (containsNormalizedPhrase(haystack, candidate)) matched.push(candidate)
  }
  return matched
}

function tierFor(score: number, thresholds: RankingThresholds): RankingTier {
  if (score >= thresholds.strong) return 'Strong'
  if (score >= thresholds.good) return 'Good'
  return 'Weak'
}

export function evaluateDeterministicRanking(
  input: DeterministicRankingInput,
): DeterministicResult {
  const rubric = input.rubric ?? DEFAULT_RANKING_RUBRIC
  const thresholds = input.thresholds ?? DEFAULT_RANKING_THRESHOLDS
  validateRankingRubric(rubric, thresholds)

  const evaluationTimeMs = Date.parse(input.evaluationTime)
  if (!Number.isFinite(evaluationTimeMs)) throw new Error('invalid_ranking_input')

  const hardFilter = cheapFilter(
    {
      title: input.job.title,
      location: input.job.location,
      descriptionText: input.job.descriptionText,
    },
    {
      titles: input.preferences.titles,
      locations: [],
      includeKeywords: [],
      excludeKeywords: input.preferences.excludeKeywords,
      titleExcludeKeywords: input.preferences.titleExcludeKeywords,
    },
  )
  if (!hardFilter.pass) {
    const reason = hardFilter.reason === 'wrong_location'
      ? 'outside_us'
      : hardFilter.reason
    return ineligibleResult(
      rubric,
      reason,
      reason === 'title_non_overlap' ? 'no configured title match' : hardFilter.detail,
    )
  }

  const titleMatch = evaluateTitleMatch(input.job.title, input.preferences.titles)
  if (titleMatch.kind === null || titleMatch.matchedTitle === null) {
    return ineligibleResult(rubric, 'title_non_overlap', 'no configured title match')
  }

  if (classifyUsLocation(input.job.location) === 'outside_us') {
    return ineligibleResult(rubric, 'outside_us', 'explicit foreign location')
  }

  const breakdown = emptyBreakdown(rubric)
  const titleRow = breakdown[0]
  titleRow.earned = titleMatch.kind === 'strict' ? rubric.strictTitle : rubric.weakTitle
  titleRow.evidence = [
    boundedEvidence(`${titleMatch.kind} title: ${titleMatch.matchedTitle}`),
  ]

  const locationMatch = phraseMatch(input.job.location ?? '', input.preferences.locations)
  const locationRow = breakdown[1]
  if (locationMatch !== null) {
    locationRow.earned = rubric.preferredLocation
    locationRow.evidence = [boundedEvidence(`preferred location: ${locationMatch}`)]
  }

  const postedAtMs = input.job.postedAt === null ? Number.NaN : Date.parse(input.job.postedAt)
  const ageMs = evaluationTimeMs - postedAtMs
  const recencyRow = breakdown[2]
  if (
    Number.isFinite(postedAtMs) &&
    ageMs >= 0 &&
    ageMs < PRECEDING_24_HOURS_MS
  ) {
    recencyRow.earned = rubric.recency
    recencyRow.evidence = [
      boundedEvidence(`posted within 24 hours: ${new Date(postedAtMs).toISOString()}`),
    ]
  }

  const watchlistRow = breakdown[3]
  if (input.job.companyId !== null) {
    watchlistRow.earned = rubric.watchlist
    watchlistRow.evidence = ['watchlist company source']
  }

  const requiredMinimum = experienceMinimumRequired(input.job.descriptionText)
  const configuredMaximum = input.preferences.maxRequiredExperience
  const experienceRow = breakdown[4]
  if (
    requiredMinimum !== null &&
    configuredMaximum !== null &&
    Number.isInteger(configuredMaximum) &&
    configuredMaximum >= 0 &&
    requiredMinimum < configuredMaximum
  ) {
    experienceRow.earned = rubric.experience
    experienceRow.evidence = [
      `required minimum: ${requiredMinimum} years; configured maximum: ${configuredMaximum}`,
    ]
  }

  const matchedKeywords = uniqueMatches(
    input.job.descriptionText,
    input.preferences.includeKeywords,
  )
  const keywordRow = breakdown[5]
  keywordRow.earned = includeKeywordPoints(matchedKeywords.length, rubric)
  keywordRow.evidence = matchedKeywords.map((keyword) =>
    boundedEvidence(`description keyword: ${keyword}`)
  )

  const score = breakdown.reduce((total, row) => total + row.earned, 0)
  return {
    eligible: true,
    score,
    tier: tierFor(score, thresholds),
    filterReason: null,
    filterDetail: null,
    breakdown,
  }
}

import { supabase } from './supabase'

export const PREFERENCE_COLUMNS =
  'user_id, titles, locations, include_keywords, exclude_keywords, title_exclude_keywords, max_required_experience, ranking_rubric, ranking_good_threshold, ranking_strong_threshold, updated_at'

export const DEFAULT_TITLE_EXCLUSIONS = ['president', 'PhD'] as const
export const DEFAULT_RANKING_RUBRIC: RankingRubric = {
  strictTitle: 30,
  weakTitle: 20,
  preferredLocation: 10,
  recency: 10,
  watchlist: 10,
  experience: 20,
  includeKeywordSteps: {
    one: 3,
    two: 5,
    three: 10,
    four: 15,
    fivePlus: 20,
  },
}
export const DEFAULT_GOOD_THRESHOLD = 50
export const DEFAULT_STRONG_THRESHOLD = 75

const MAX_PREFERENCE_TEXT_ARRAY_ENTRIES = 50
const MAX_PREFERENCE_TEXT_ARRAY_BYTES = 4096
const MAX_PREFERENCE_TEXT_ENTRY_CHARACTERS = 200

export type PreferenceTextArrayField =
  | 'titles'
  | 'title_exclude_keywords'
  | 'locations'
  | 'include_keywords'
  | 'exclude_keywords'

const PREFERENCE_TEXT_ARRAY_FIELDS: ReadonlyArray<{
  field: PreferenceTextArrayField
  inputId: string
  label: string
}> = [
  { field: 'titles', inputId: 'pref-titles', label: 'Target titles' },
  {
    field: 'title_exclude_keywords',
    inputId: 'pref-title-exclude',
    label: 'Exclude title keywords',
  },
  { field: 'locations', inputId: 'pref-locations', label: 'Locations' },
  { field: 'include_keywords', inputId: 'pref-include', label: 'Include keywords' },
  { field: 'exclude_keywords', inputId: 'pref-exclude', label: 'Exclude keywords' },
]

export interface PreferenceTextArrayValidation {
  valid: boolean
  field: PreferenceTextArrayField
  inputId: string
  errorId: string
  message: string | null
}

export interface PreferenceTextArraysValidation {
  valid: boolean
  fieldErrors: Record<string, string>
  firstInvalidField: string | null
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

export interface PreferencesRecord {
  user_id: string
  titles: string[]
  locations: string[]
  include_keywords: string[]
  exclude_keywords: string[]
  title_exclude_keywords: string[]
  max_required_experience: number | null
  ranking_rubric: RankingRubric
  ranking_good_threshold: number
  ranking_strong_threshold: number
  updated_at: string
}

export interface SavePreferencesInput {
  titles: string[]
  locations: string[]
  include_keywords: string[]
  exclude_keywords: string[]
  title_exclude_keywords: string[]
  max_required_experience: number | null
  ranking_rubric: RankingRubric
  ranking_good_threshold: number
  ranking_strong_threshold: number
}

export interface SavePreferencesResult {
  runId: string
  revision: number
  seededCount: number
}

export type RankingStatus = 'idle' | 'building' | 'failed'

export interface RankingState {
  activeRevision: number
  desiredRevision: number
  status: RankingStatus
  errorCode: string | null
  retryAvailable: boolean
  updatedAt: string | null
}

export interface RetryRankingResult {
  runId: string
  revision: number
  created: boolean
}

export interface RankingFormValues {
  maxRequiredExperience: string
  rubric: {
    strictTitle: string
    weakTitle: string
    preferredLocation: string
    recency: string
    watchlist: string
    experience: string
    includeKeywordSteps: {
      one: string
      two: string
      three: string
      four: string
      fivePlus: string
    }
  }
  goodThreshold: string
  strongThreshold: string
}

interface ParsedRankingForm {
  maxRequiredExperience: number | null
  rubric: RankingRubric
  goodThreshold: number
  strongThreshold: number
}

export interface RankingFormValidation {
  valid: boolean
  fieldErrors: Record<string, string>
  firstInvalidField: string | null
  value: ParsedRankingForm | null
}

export function chipComparisonKey(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase()
}

// Split a raw text input into normalized chips: comma-separated, trimmed,
// de-duplicated, empties dropped. Pure so it is unit-tested directly.
export function parseChips(raw: string): string[] {
  const seen = new Set<string>()
  const chips: string[] = []
  for (const part of raw.split(',')) {
    const value = part.trim()
    const comparisonKey = chipComparisonKey(value)
    if (comparisonKey.length === 0 || seen.has(comparisonKey)) continue
    seen.add(comparisonKey)
    chips.push(value)
  }
  return chips
}

export function validatePreferenceTextArray(
  field: PreferenceTextArrayField,
  values: readonly string[],
): PreferenceTextArrayValidation {
  const definition = PREFERENCE_TEXT_ARRAY_FIELDS.find((candidate) => candidate.field === field)!
  const result = (message: string | null): PreferenceTextArrayValidation => ({
    valid: message === null,
    field,
    inputId: definition.inputId,
    errorId: `${definition.inputId}-error`,
    message,
  })

  if (!Array.isArray(values) || values.length > MAX_PREFERENCE_TEXT_ARRAY_ENTRIES) {
    return result(`${definition.label} can contain at most 50 entries.`)
  }

  const encodedBytes = new TextEncoder().encode(JSON.stringify(values)).byteLength
  if (encodedBytes > MAX_PREFERENCE_TEXT_ARRAY_BYTES) {
    return result(`${definition.label} must be 4,096 bytes or less.`)
  }

  for (const entry of values) {
    if (typeof entry !== 'string' || entry.length === 0 || entry.trim() !== entry) {
      return result(`${definition.label} entries cannot be blank or have surrounding whitespace.`)
    }
    if (Array.from(entry).length > MAX_PREFERENCE_TEXT_ENTRY_CHARACTERS) {
      return result(`${definition.label} entries must be 200 characters or less.`)
    }
    if (/[\u0000-\u001f\u007f-\u009f]/u.test(entry)) {
      return result(`${definition.label} entries cannot contain control characters.`)
    }
  }

  return result(null)
}

export function validatePreferenceTextArrays(
  values: Pick<
    SavePreferencesInput,
    | 'titles'
    | 'title_exclude_keywords'
    | 'locations'
    | 'include_keywords'
    | 'exclude_keywords'
  >,
): PreferenceTextArraysValidation {
  const fieldErrors: Record<string, string> = {}
  let firstInvalidField: string | null = null

  for (const definition of PREFERENCE_TEXT_ARRAY_FIELDS) {
    const validation = validatePreferenceTextArray(definition.field, values[definition.field])
    if (validation.valid || validation.message === null) continue
    fieldErrors[validation.inputId] = validation.message
    firstInvalidField ??= validation.inputId
  }

  return {
    valid: firstInvalidField === null,
    fieldErrors,
    firstInvalidField,
  }
}

function assertValidPreferenceTextArrays(input: SavePreferencesInput): void {
  const validation = validatePreferenceTextArrays(input)
  if (!validation.valid && validation.firstInvalidField) {
    throw new Error(validation.fieldErrors[validation.firstInvalidField])
  }
}

const POINT_MESSAGE = 'Enter a whole number from 0 to 100.'
const MAX_EXPERIENCE_MESSAGE = 'Enter a whole number from 0 to 20, or leave blank.'
const WEAK_TITLE_MESSAGE = 'Weak title points cannot exceed strict title points.'
const KEYWORD_ORDER_MESSAGE =
  'Keyword points must stay the same or increase as matches increase.'
const KEYWORD_MAX_MESSAGE = 'Keyword steps cannot exceed the 5+ match maximum.'
const THRESHOLD_MESSAGE =
  'Use whole-number thresholds where 0 < Good < Strong ≤ 100.'

function parseWholeNumber(value: string, maximum: number): number | null {
  if (!/^(0|[1-9]\d*)$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : null
}

export function rankingRubricToForm(rubric: RankingRubric): RankingFormValues['rubric'] {
  return {
    strictTitle: String(rubric.strictTitle),
    weakTitle: String(rubric.weakTitle),
    preferredLocation: String(rubric.preferredLocation),
    recency: String(rubric.recency),
    watchlist: String(rubric.watchlist),
    experience: String(rubric.experience),
    includeKeywordSteps: {
      one: String(rubric.includeKeywordSteps.one),
      two: String(rubric.includeKeywordSteps.two),
      three: String(rubric.includeKeywordSteps.three),
      four: String(rubric.includeKeywordSteps.four),
      fivePlus: String(rubric.includeKeywordSteps.fivePlus),
    },
  }
}

export function validateRankingForm(input: RankingFormValues): RankingFormValidation {
  const fieldErrors: Record<string, string> = {}
  const maximumExperience = input.maxRequiredExperience === ''
    ? null
    : parseWholeNumber(input.maxRequiredExperience, 20)

  if (input.maxRequiredExperience !== '' && maximumExperience === null) {
    fieldErrors['pref-max-experience'] = MAX_EXPERIENCE_MESSAGE
  }

  const pointEntries = [
    ['ranking-strict-title', input.rubric.strictTitle],
    ['ranking-weak-title', input.rubric.weakTitle],
    ['ranking-preferred-location', input.rubric.preferredLocation],
    ['ranking-recency', input.rubric.recency],
    ['ranking-watchlist', input.rubric.watchlist],
    ['ranking-experience', input.rubric.experience],
    ['ranking-keyword-one', input.rubric.includeKeywordSteps.one],
    ['ranking-keyword-two', input.rubric.includeKeywordSteps.two],
    ['ranking-keyword-three', input.rubric.includeKeywordSteps.three],
    ['ranking-keyword-four', input.rubric.includeKeywordSteps.four],
    ['ranking-keyword-five-plus', input.rubric.includeKeywordSteps.fivePlus],
  ] as const

  const parsedPoints = new Map<string, number>()
  for (const [id, raw] of pointEntries) {
    const parsed = parseWholeNumber(raw, 100)
    if (parsed === null) fieldErrors[id] = POINT_MESSAGE
    else parsedPoints.set(id, parsed)
  }

  const goodThreshold = parseWholeNumber(input.goodThreshold, 100)
  const strongThreshold = parseWholeNumber(input.strongThreshold, 100)
  const thresholdsValid = goodThreshold !== null
    && strongThreshold !== null
    && goodThreshold > 0
    && goodThreshold < strongThreshold
  if (!thresholdsValid) {
    fieldErrors['ranking-good-threshold'] = THRESHOLD_MESSAGE
    fieldErrors['ranking-strong-threshold'] = THRESHOLD_MESSAGE
  }

  if (parsedPoints.size === pointEntries.length) {
    const strictTitle = parsedPoints.get('ranking-strict-title')!
    const weakTitle = parsedPoints.get('ranking-weak-title')!
    const preferredLocation = parsedPoints.get('ranking-preferred-location')!
    const recency = parsedPoints.get('ranking-recency')!
    const watchlist = parsedPoints.get('ranking-watchlist')!
    const experience = parsedPoints.get('ranking-experience')!
    const keywordSteps = [
      parsedPoints.get('ranking-keyword-one')!,
      parsedPoints.get('ranking-keyword-two')!,
      parsedPoints.get('ranking-keyword-three')!,
      parsedPoints.get('ranking-keyword-four')!,
      parsedPoints.get('ranking-keyword-five-plus')!,
    ]

    if (weakTitle > strictTitle) {
      fieldErrors['ranking-weak-title'] = WEAK_TITLE_MESSAGE
    }

    const total =
      strictTitle + preferredLocation + recency + watchlist + experience + keywordSteps[4]
    if (total !== 100) {
      fieldErrors['ranking-total'] =
        `Category maximums must total 100 points. Current total: ${total}.`
    }

    if (keywordSteps.some((value, index) => index > 0 && value < keywordSteps[index - 1])) {
      fieldErrors['ranking-keyword-steps'] = KEYWORD_ORDER_MESSAGE
    } else if (keywordSteps.slice(0, -1).some((value) => value > keywordSteps[4])) {
      fieldErrors['ranking-keyword-steps'] = KEYWORD_MAX_MESSAGE
    }
  }

  const fieldOrder = [
    'pref-max-experience',
    'ranking-strict-title',
    'ranking-weak-title',
    'ranking-preferred-location',
    'ranking-recency',
    'ranking-watchlist',
    'ranking-experience',
    'ranking-keyword-one',
    'ranking-keyword-two',
    'ranking-keyword-three',
    'ranking-keyword-four',
    'ranking-keyword-five-plus',
    'ranking-keyword-steps',
    'ranking-total',
    'ranking-good-threshold',
    'ranking-strong-threshold',
  ]
  const firstInvalidField = fieldOrder.find((id) => fieldErrors[id]) ?? null
  if (firstInvalidField !== null) {
    return { valid: false, fieldErrors, firstInvalidField, value: null }
  }

  return {
    valid: true,
    fieldErrors,
    firstInvalidField: null,
    value: {
      maxRequiredExperience: maximumExperience,
      rubric: {
        strictTitle: parsedPoints.get('ranking-strict-title')!,
        weakTitle: parsedPoints.get('ranking-weak-title')!,
        preferredLocation: parsedPoints.get('ranking-preferred-location')!,
        recency: parsedPoints.get('ranking-recency')!,
        watchlist: parsedPoints.get('ranking-watchlist')!,
        experience: parsedPoints.get('ranking-experience')!,
        includeKeywordSteps: {
          one: parsedPoints.get('ranking-keyword-one')!,
          two: parsedPoints.get('ranking-keyword-two')!,
          three: parsedPoints.get('ranking-keyword-three')!,
          four: parsedPoints.get('ranking-keyword-four')!,
          fivePlus: parsedPoints.get('ranking-keyword-five-plus')!,
        },
      },
      goodThreshold: goodThreshold!,
      strongThreshold: strongThreshold!,
    },
  }
}

export async function loadPreferences(): Promise<PreferencesRecord | null> {
  const { data, error } = await supabase
    .from('preferences')
    .select(PREFERENCE_COLUMNS)
    .maybeSingle()

  if (error) throw error
  return (data as PreferencesRecord | null) ?? null
}

export async function savePreferences(
  input: SavePreferencesInput,
): Promise<SavePreferencesResult> {
  assertValidPreferenceTextArrays(input)

  const { data, error } = await supabase.rpc('save_preferences_and_start_ranking', {
    p_titles: input.titles,
    p_locations: input.locations,
    p_include_keywords: input.include_keywords,
    p_exclude_keywords: input.exclude_keywords,
    p_title_exclude_keywords: input.title_exclude_keywords,
    p_max_required_experience: input.max_required_experience,
    p_ranking_rubric: input.ranking_rubric,
    p_good_threshold: input.ranking_good_threshold,
    p_strong_threshold: input.ranking_strong_threshold,
  })
  if (error) throw error
  const result = data?.[0]
  if (!result) throw new Error('ranking_save_missing_result')
  return {
    runId: result.run_id,
    revision: Number(result.revision),
    seededCount: result.seeded_count,
  }
}

export async function getDeterministicRankingState(): Promise<RankingState> {
  const { data, error } = await supabase.rpc('get_deterministic_ranking_state')
  if (error) throw error
  const state = data?.[0]
  if (!state) {
    return {
      activeRevision: 0,
      desiredRevision: 0,
      status: 'idle',
      errorCode: null,
      retryAvailable: false,
      updatedAt: null,
    }
  }
  return {
    activeRevision: Number(state.active_revision),
    desiredRevision: Number(state.desired_revision),
    status: state.status as RankingStatus,
    errorCode: state.error_code,
    retryAvailable: state.retry_available,
    updatedAt: state.updated_at,
  }
}

export async function retryDeterministicRankingRun(): Promise<RetryRankingResult> {
  const { data, error } = await supabase.rpc('retry_deterministic_ranking_run')
  if (error) throw error
  const result = data?.[0]
  if (!result) throw new Error('ranking_retry_missing_result')
  return {
    runId: result.run_id,
    revision: Number(result.revision),
    created: result.created,
  }
}

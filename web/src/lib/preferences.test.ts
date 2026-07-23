import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_RANKING_RUBRIC,
  DEFAULT_TITLE_EXCLUSIONS,
  PREFERENCE_COLUMNS,
  chipComparisonKey,
  getDeterministicRankingState,
  parseChips,
  retryDeterministicRankingRun,
  savePreferences,
  validateRankingForm,
  validateTitleExclusions,
} from './preferences'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('./supabase', () => ({
  supabase: {
    from: mocks.from,
    rpc: mocks.rpc,
  },
}))

const input = {
  titles: ['Equity Research'],
  locations: ['Chicago'],
  include_keywords: ['valuation'],
  exclude_keywords: ['senior'],
  title_exclude_keywords: ['president', 'PhD'],
  max_required_experience: null,
  ranking_rubric: {
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
  },
  ranking_good_threshold: 50,
  ranking_strong_threshold: 75,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.rpc.mockResolvedValue({
    data: [{ run_id: 'run-1', revision: 4, seeded_count: 12 }],
    error: null,
  })
})

describe('parseChips', () => {
  it('splits on commas and trims each chip', () => {
    expect(parseChips('data scientist, chicago , remote')).toEqual([
      'data scientist',
      'chicago',
      'remote',
    ])
  })

  it('drops empty segments and surrounding blanks', () => {
    expect(parseChips('a,,b, ,c')).toEqual(['a', 'b', 'c'])
  })

  it('de-duplicates case and NFKC-equivalent chips while preserving first spelling', () => {
    expect(parseChips('PhD, phd, ＰｈＤ, SQL')).toEqual(['PhD', 'SQL'])
    expect(chipComparisonKey('  ＰｈＤ  ')).toBe('phd')
  })

  it('returns an empty array for a blank string', () => {
    expect(parseChips('   ')).toEqual([])
  })
})

describe('title exclusion contract', () => {
  it('projects the complete deterministic preference record', () => {
    expect(PREFERENCE_COLUMNS).toBe(
      'user_id, titles, locations, include_keywords, exclude_keywords, title_exclude_keywords, max_required_experience, ranking_rubric, ranking_good_threshold, ranking_strong_threshold, updated_at',
    )
    expect(PREFERENCE_COLUMNS).toContain('max_required_experience')
    expect(PREFERENCE_COLUMNS).toContain('ranking_rubric')
    expect(DEFAULT_TITLE_EXCLUSIONS).toEqual(['president', 'PhD'])
    expect(DEFAULT_RANKING_RUBRIC).toEqual(input.ranking_rubric)
  })

  it('accepts explicit empty, 50 entries, and exactly 4,096 encoded bytes', () => {
    expect(() => validateTitleExclusions([])).not.toThrow()
    expect(() =>
      validateTitleExclusions(Array.from({ length: 50 }, (_, index) => `term-${index}`)),
    ).not.toThrow()
    expect(new TextEncoder().encode(JSON.stringify(['a'.repeat(4092)])).byteLength).toBe(4096)
    expect(() => validateTitleExclusions(['a'.repeat(4092)])).not.toThrow()
  })

  it('rejects a 51st entry and 4,097 encoded bytes with bounded value-free errors', () => {
    expect(() =>
      validateTitleExclusions(Array.from({ length: 51 }, (_, index) => `term-${index}`)),
    ).toThrow('Title exclusions can contain at most 50 entries.')

    const oversized = 'z'.repeat(4093)
    expect(new TextEncoder().encode(JSON.stringify([oversized])).byteLength).toBe(4097)
    expect(() => validateTitleExclusions([oversized])).toThrow(
      'Title exclusions must be 4,096 bytes or less.',
    )
    try {
      validateTitleExclusions([oversized])
    } catch (error) {
      expect(String(error)).not.toContain(oversized)
    }
  })
})

describe('deterministic ranking preference validation', () => {
  const validForm = {
    maxRequiredExperience: '',
    rubric: {
      strictTitle: '30',
      weakTitle: '20',
      preferredLocation: '10',
      recency: '10',
      watchlist: '10',
      experience: '20',
      includeKeywordSteps: {
        one: '3',
        two: '5',
        three: '10',
        four: '15',
        fivePlus: '20',
      },
    },
    goodThreshold: '50',
    strongThreshold: '75',
  }

  it('accepts exact defaults and a blank optional maximum experience', () => {
    expect(validateRankingForm(validForm)).toEqual({
      valid: true,
      fieldErrors: {},
      firstInvalidField: null,
      value: {
        maxRequiredExperience: null,
        rubric: DEFAULT_RANKING_RUBRIC,
        goodThreshold: 50,
        strongThreshold: 75,
      },
    })
  })

  it.each([
    ['invalid maximum', { maxRequiredExperience: '2.5' }, 'pref-max-experience'],
    ['invalid point', { rubric: { ...validForm.rubric, strictTitle: '' } }, 'ranking-strict-title'],
    [
      'weak over strict',
      { rubric: { ...validForm.rubric, strictTitle: '19', weakTitle: '20' } },
      'ranking-weak-title',
    ],
    [
      'non-100 total',
      { rubric: { ...validForm.rubric, preferredLocation: '9' } },
      'ranking-total',
    ],
    [
      'decreasing keyword steps',
      {
        rubric: {
          ...validForm.rubric,
          includeKeywordSteps: { ...validForm.rubric.includeKeywordSteps, three: '4' },
        },
      },
      'ranking-keyword-steps',
    ],
    [
      'keyword step over maximum',
      {
        rubric: {
          ...validForm.rubric,
          includeKeywordSteps: { ...validForm.rubric.includeKeywordSteps, one: '21' },
        },
      },
      'ranking-keyword-steps',
    ],
    ['invalid thresholds', { goodThreshold: '75' }, 'ranking-good-threshold'],
  ])('rejects %s and identifies the first invalid control', (_label, overrides, firstInvalidField) => {
    const result = validateRankingForm({
      ...validForm,
      ...overrides,
      rubric: 'rubric' in overrides
        ? overrides.rubric as typeof validForm.rubric
        : validForm.rubric,
    })

    expect(result.valid).toBe(false)
    expect(result.firstInvalidField).toBe(firstInvalidField)
    expect(result.value).toBeNull()
  })
})

describe('deterministic ranking RPC contract', () => {
  it('persists every value and starts ranking through one owner-scoped RPC', async () => {
    await expect(savePreferences(input)).resolves.toEqual({
      runId: 'run-1',
      revision: 4,
      seededCount: 12,
    })

    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('save_preferences_and_start_ranking', {
      p_titles: input.titles,
      p_locations: input.locations,
      p_include_keywords: input.include_keywords,
      p_exclude_keywords: input.exclude_keywords,
      p_title_exclude_keywords: input.title_exclude_keywords,
      p_max_required_experience: null,
      p_ranking_rubric: input.ranking_rubric,
      p_good_threshold: 50,
      p_strong_threshold: 75,
    })
  })

  it('preserves an explicit empty title exclusion array through the atomic RPC', async () => {
    await savePreferences({ ...input, title_exclude_keywords: [] })

    expect(mocks.rpc).toHaveBeenCalledWith(
      'save_preferences_and_start_ranking',
      expect.objectContaining({ p_title_exclude_keywords: [] }),
    )
  })

  it('accepts the exact title-exclusion byte boundary before the atomic RPC', async () => {
    await savePreferences({ ...input, title_exclude_keywords: ['a'.repeat(4092)] })

    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['51 entries', Array.from({ length: 51 }, (_, index) => `term-${index}`)],
    ['4,097 bytes', ['z'.repeat(4093)]],
  ])('rejects %s before remote work', async (_label, values) => {
    await expect(savePreferences({ ...input, title_exclude_keywords: values })).rejects.toThrow(
      /^Title exclusions /,
    )

    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('rejects boundedly when the atomic save fails', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error('save failed') })

    await expect(savePreferences(input)).rejects.toThrow('save failed')
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it('loads owner-scoped ranking state and normalizes a missing row to idle', async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: [{
          active_revision: 3,
          desired_revision: 4,
          status: 'building',
          error_code: null,
          retry_available: false,
          updated_at: '2026-07-23T00:00:00.000Z',
        }],
        error: null,
      })
      .mockResolvedValueOnce({ data: [], error: null })

    await expect(getDeterministicRankingState()).resolves.toEqual({
      activeRevision: 3,
      desiredRevision: 4,
      status: 'building',
      errorCode: null,
      retryAvailable: false,
      updatedAt: '2026-07-23T00:00:00.000Z',
    })
    await expect(getDeterministicRankingState()).resolves.toEqual({
      activeRevision: 0,
      desiredRevision: 0,
      status: 'idle',
      errorCode: null,
      retryAvailable: false,
      updatedAt: null,
    })
  })

  it('retries only through the server-authoritative owner RPC', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ run_id: 'retry-1', revision: 4, created: true }],
      error: null,
    })

    await expect(retryDeterministicRankingRun()).resolves.toEqual({
      runId: 'retry-1',
      revision: 4,
      created: true,
    })
    expect(mocks.rpc).toHaveBeenCalledWith('retry_deterministic_ranking_run')
  })
})

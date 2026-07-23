import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RANKING_RUBRIC,
  DEFAULT_RANKING_THRESHOLDS,
  classifyUsLocation,
  evaluateDeterministicRanking,
  evaluateTitleMatch,
  validateRankingRubric,
  type DeterministicRankingInput,
  type RankingRubric,
} from '../../supabase/functions/_shared/deterministic-ranking'
import { experienceMinimumRequired } from '../../supabase/functions/_shared/filters'

const evaluationTime = '2026-07-23T05:00:00.000Z'

function input(
  overrides: Partial<DeterministicRankingInput> = {},
): DeterministicRankingInput {
  return {
    job: {
      title: 'Data Scientist',
      location: 'Chicago, IL, United States',
      descriptionText:
        'Minimum 2 years of experience required. Python, SQL, Tableau, risk modeling, and finance.',
      postedAt: '2026-07-22T17:00:00.000Z',
      companyId: '11111111-1111-4111-8111-111111111111',
    },
    preferences: {
      titles: ['Data Scientist'],
      locations: ['Chicago'],
      includeKeywords: ['python', 'sql', 'tableau', 'risk modeling', 'finance'],
      excludeKeywords: [],
      titleExcludeKeywords: [],
      maxRequiredExperience: 3,
    },
    evaluationTime,
    ...overrides,
  }
}

describe('deterministic ranking defaults and validation', () => {
  it('defines the exact owner-approved 100-point rubric and thresholds', () => {
    expect(DEFAULT_RANKING_RUBRIC).toEqual({
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
    })
    expect(DEFAULT_RANKING_THRESHOLDS).toEqual({ good: 50, strong: 75 })
    expect(() =>
      validateRankingRubric(DEFAULT_RANKING_RUBRIC, DEFAULT_RANKING_THRESHOLDS),
    ).not.toThrow()
  })

  it.each([
    [
      'unknown key',
      { ...DEFAULT_RANKING_RUBRIC, surprise: 1 },
      DEFAULT_RANKING_THRESHOLDS,
    ],
    [
      'noninteger',
      { ...DEFAULT_RANKING_RUBRIC, recency: 9.5 },
      DEFAULT_RANKING_THRESHOLDS,
    ],
    [
      'wrong maximum',
      { ...DEFAULT_RANKING_RUBRIC, recency: 9 },
      DEFAULT_RANKING_THRESHOLDS,
    ],
    [
      'weak above strict',
      { ...DEFAULT_RANKING_RUBRIC, weakTitle: 31 },
      DEFAULT_RANKING_THRESHOLDS,
    ],
    [
      'descending keyword steps',
      {
        ...DEFAULT_RANKING_RUBRIC,
        includeKeywordSteps: {
          ...DEFAULT_RANKING_RUBRIC.includeKeywordSteps,
          three: 4,
        },
      },
      DEFAULT_RANKING_THRESHOLDS,
    ],
    [
      'keyword step above category maximum',
      {
        ...DEFAULT_RANKING_RUBRIC,
        includeKeywordSteps: {
          ...DEFAULT_RANKING_RUBRIC.includeKeywordSteps,
          four: 21,
        },
      },
      DEFAULT_RANKING_THRESHOLDS,
    ],
    ['bad threshold order', DEFAULT_RANKING_RUBRIC, { good: 75, strong: 75 }],
    ['unknown threshold key', DEFAULT_RANKING_RUBRIC, { good: 50, strong: 75, extra: 1 }],
  ])('rejects %s with a bounded validation code', (_label, rubric, thresholds) => {
    expect(() =>
      validateRankingRubric(rubric as RankingRubric, thresholds),
    ).toThrowError(/^invalid_ranking_(?:rubric|thresholds)$/)
  })
})

describe('title matching and hard filters', () => {
  it('gives strict normalized phrase precedence over weak concepts', () => {
    expect(evaluateTitleMatch('Senior DATA-scientist (Risk)', ['Data Scientist'])).toEqual({
      kind: 'strict',
      matchedTitle: 'Data Scientist',
    })
  })

  it('requires all significant concepts for a weak synonymous/inflected match', () => {
    expect(evaluateTitleMatch('Research Analyst - Equities', ['Equity Research'])).toEqual({
      kind: 'weak',
      matchedTitle: 'Equity Research',
    })
    expect(evaluateTitleMatch('Research Data Analyst', ['Equity Research'])).toEqual({
      kind: null,
      matchedTitle: null,
    })
  })

  it.each([
    ['Vice President, Data Science', ['president'], [], 'excluded_title_keyword'],
    ['Data Scientist', [], ['security clearance'], 'excluded_keyword'],
    ['Registered Nurse', [], [], 'title_non_overlap'],
  ])('applies %s hard-filter case', (title, titleExclusions, exclusions, reason) => {
    const result = evaluateDeterministicRanking(input({
      job: {
        ...input().job,
        title,
        descriptionText: `${input().job.descriptionText} Security clearance.`,
      },
      preferences: {
        ...input().preferences,
        titleExcludeKeywords: titleExclusions,
        excludeKeywords: exclusions,
      },
    }))
    expect(result).toMatchObject({ eligible: false, score: null, tier: null, filterReason: reason })
    expect(result.breakdown).toHaveLength(6)
  })
})

describe('United States eligibility', () => {
  it.each([
    ['Chicago, IL', 'us'],
    ['Remote - United States', 'us'],
    ['New York, NY, USA', 'us'],
    ['', 'unknown'],
    [null, 'unknown'],
    ['Remote', 'unknown'],
    ['London', 'unknown'],
    ['London, UK', 'outside_us'],
    ['Remote - Canada', 'outside_us'],
    ['Toronto, Ontario, Canada', 'outside_us'],
  ] as const)('classifies %s as %s', (location, expected) => {
    expect(classifyUsLocation(location)).toBe(expected)
  })

  it('rejects only explicit foreign locations', () => {
    for (const location of [null, '', 'Remote', 'London']) {
      expect(evaluateDeterministicRanking(input({
        job: { ...input().job, location },
      })).eligible).toBe(true)
    }
    expect(evaluateDeterministicRanking(input({
      job: { ...input().job, location: 'London, UK' },
    }))).toMatchObject({ eligible: false, filterReason: 'outside_us' })
  })
})

describe('experience signal', () => {
  it.each([
    ['Minimum 2 years of experience required.', 2],
    ['Requires 3-5 years of relevant experience.', 3],
    ['4+ years in risk modeling.', 4],
    ['2 years preferred.', null],
    ['Experience is a plus.', null],
    ['We value relevant experience.', null],
  ])('parses %s as %s', (description, expected) => {
    expect(experienceMinimumRequired(description)).toBe(expected)
  })

  it('awards experience only for an explicit required minimum strictly below max', () => {
    const points = (descriptionText: string, maxRequiredExperience: number | null) => {
      const result = evaluateDeterministicRanking(input({
        job: { ...input().job, descriptionText },
        preferences: {
          ...input().preferences,
          includeKeywords: [],
          maxRequiredExperience,
        },
      }))
      return result.breakdown.find((row) => row.key === 'experience')?.earned
    }
    expect(points('Minimum 2 years of experience required.', 3)).toBe(20)
    expect(points('Minimum 3 years of experience required.', 3)).toBe(0)
    expect(points('Minimum 4 years of experience required.', 3)).toBe(0)
    expect(points('2 years preferred.', 3)).toBe(0)
    expect(points('Minimum 2 years of experience required.', null)).toBe(0)
  })
})

describe('score categories, tiers, and reproducibility', () => {
  it('earns the complete 100 points with a six-row bounded evidence breakdown', () => {
    const result = evaluateDeterministicRanking(input())
    expect(result).toMatchObject({
      eligible: true,
      score: 100,
      tier: 'Strong',
      filterReason: null,
      filterDetail: null,
    })
    expect(result.breakdown.map((row) => [row.key, row.earned, row.possible])).toEqual([
      ['title', 30, 30],
      ['location', 10, 10],
      ['recency', 10, 10],
      ['watchlist', 10, 10],
      ['experience', 20, 20],
      ['keywords', 20, 20],
    ])
    for (const row of result.breakdown) {
      for (const evidence of row.evidence) expect([...evidence].length).toBeLessThanOrEqual(160)
    }
  })

  it('counts unique description-only keyword matches on the editable ladder', () => {
    const scoreKeywords = (includeKeywords: string[], descriptionText: string) => {
      const result = evaluateDeterministicRanking(input({
        job: {
          ...input().job,
          title: 'Data Scientist Python',
          descriptionText,
        },
        preferences: {
          ...input().preferences,
          includeKeywords,
          maxRequiredExperience: null,
          locations: [],
        },
      }))
      return result.breakdown.find((row) => row.key === 'keywords')
    }

    expect(scoreKeywords(['python'], 'No named tools.')).toMatchObject({ earned: 0 })
    expect(scoreKeywords(['python', 'PYTHON'], 'Python and python.')).toMatchObject({ earned: 3 })
    expect(scoreKeywords(['python', 'sql'], 'Python and SQL.')).toMatchObject({ earned: 5 })
    expect(scoreKeywords(['python', 'sql', 'tableau'], 'Python SQL Tableau.')).toMatchObject({
      earned: 10,
    })
    expect(
      scoreKeywords(
        ['python', 'sql', 'tableau', 'finance', 'risk'],
        'Python SQL Tableau finance risk.',
      ),
    ).toMatchObject({ earned: 20 })
  })

  it('uses company_id for watchlist and a strict preceding-24-hour boundary', () => {
    const atBoundary = evaluateDeterministicRanking(input({
      job: {
        ...input().job,
        postedAt: '2026-07-22T05:00:00.000Z',
        companyId: null,
      },
    }))
    expect(atBoundary.breakdown.find((row) => row.key === 'recency')?.earned).toBe(0)
    expect(atBoundary.breakdown.find((row) => row.key === 'watchlist')?.earned).toBe(0)

    const inside = evaluateDeterministicRanking(input({
      job: {
        ...input().job,
        postedAt: '2026-07-22T05:00:00.001Z',
      },
    }))
    expect(inside.breakdown.find((row) => row.key === 'recency')?.earned).toBe(10)
  })

  it('hits Strong, Good, and Weak boundaries from stored thresholds', () => {
    const strong = evaluateDeterministicRanking(input({
      job: { ...input().job, descriptionText: 'Python SQL Tableau finance.' },
      preferences: {
        ...input().preferences,
        maxRequiredExperience: null,
        includeKeywords: ['python', 'sql', 'tableau', 'finance'],
      },
    }))
    expect(strong.score).toBe(75)
    expect(strong.tier).toBe('Strong')

    const good = evaluateDeterministicRanking(input({
      job: {
        ...input().job,
        location: null,
        descriptionText: 'Python SQL Tableau finance risk.',
        postedAt: null,
        companyId: null,
      },
      preferences: {
        ...input().preferences,
        locations: [],
        maxRequiredExperience: null,
      },
    }))
    expect(good.score).toBe(50)
    expect(good.tier).toBe('Good')

    const weak = evaluateDeterministicRanking(input({
      job: {
        ...input().job,
        location: null,
        descriptionText: '',
        postedAt: null,
        companyId: null,
      },
      preferences: {
        ...input().preferences,
        locations: [],
        includeKeywords: [],
        maxRequiredExperience: null,
      },
    }))
    expect(weak.score).toBe(30)
    expect(weak.tier).toBe('Weak')
  })

  it('is byte-reproducible for identical captured inputs and evaluation time', () => {
    expect(JSON.stringify(evaluateDeterministicRanking(input()))).toBe(
      JSON.stringify(evaluateDeterministicRanking(input())),
    )
  })
})

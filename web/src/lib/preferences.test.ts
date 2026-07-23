import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_TITLE_EXCLUSIONS,
  PREFERENCE_COLUMNS,
  chipComparisonKey,
  parseChips,
  savePreferences,
  validateTitleExclusions,
} from './preferences'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  upsert: vi.fn(),
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
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.from.mockReturnValue({ upsert: mocks.upsert })
  mocks.upsert.mockResolvedValue({ error: null })
  mocks.rpc.mockResolvedValue({ error: null })
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
  it('projects the persisted title exclusion array without the retired experience field', () => {
    expect(PREFERENCE_COLUMNS).toBe(
      'user_id, titles, locations, include_keywords, exclude_keywords, title_exclude_keywords, updated_at',
    )
    expect(PREFERENCE_COLUMNS).not.toContain('max_required_experience')
    expect(DEFAULT_TITLE_EXCLUSIONS).toEqual(['president', 'PhD'])
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

describe('savePreferences revision signal', () => {
  it('awaits the preference upsert before requesting a refilter revision', async () => {
    await savePreferences(input)

    expect(mocks.from).toHaveBeenCalledWith('preferences')
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining(input),
      { onConflict: 'user_id' },
    )
    expect(mocks.rpc).toHaveBeenCalledWith('mark_recent_jobs_for_refilter')
    expect(mocks.upsert.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.rpc.mock.invocationCallOrder[0],
    )
  })

  it('preserves an explicit empty title exclusion array through upsert and refilter', async () => {
    await savePreferences({ ...input, title_exclude_keywords: [] })

    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ title_exclude_keywords: [] }),
      { onConflict: 'user_id' },
    )
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it('accepts the exact byte boundary before upsert and refilter', async () => {
    await savePreferences({ ...input, title_exclude_keywords: ['a'.repeat(4092)] })

    expect(mocks.upsert).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['51 entries', Array.from({ length: 51 }, (_, index) => `term-${index}`)],
    ['4,097 bytes', ['z'.repeat(4093)]],
  ])('rejects %s before upsert or refilter', async (_label, values) => {
    await expect(savePreferences({ ...input, title_exclude_keywords: values })).rejects.toThrow(
      /^Title exclusions /,
    )

    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.upsert).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('does not signal or resolve when the upsert fails', async () => {
    mocks.upsert.mockResolvedValue({ error: new Error('upsert failed') })

    await expect(savePreferences(input)).rejects.toThrow('upsert failed')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('rejects when the refilter revision signal fails', async () => {
    mocks.rpc.mockResolvedValue({ error: new Error('signal failed') })

    await expect(savePreferences(input)).rejects.toThrow('signal failed')
  })
})

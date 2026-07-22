import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseChips, savePreferences } from './preferences'

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
  max_required_experience: null,
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

  it('de-duplicates repeated chips, preserving first order', () => {
    expect(parseChips('python, python, sql')).toEqual(['python', 'sql'])
  })

  it('returns an empty array for a blank string', () => {
    expect(parseChips('   ')).toEqual([])
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

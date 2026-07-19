import { describe, expect, it, vi } from 'vitest'
import { parseChips } from './preferences'

vi.mock('./supabase', () => ({ supabase: {} }))

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

import { describe, expect, it } from 'vitest'
import {
  cheapFilter,
  SYNONYMS,
  type FilterJobInput,
  type FilterPreferences,
} from '../../supabase/functions/_shared/filters'

function job(overrides: Partial<FilterJobInput> = {}): FilterJobInput {
  return {
    title: 'Data Scientist',
    location: 'Chicago, IL',
    descriptionText: 'We are hiring a data scientist to build models.',
    ...overrides,
  }
}

function prefs(overrides: Partial<FilterPreferences> = {}): FilterPreferences {
  return {
    titles: [],
    locations: [],
    includeKeywords: [],
    excludeKeywords: [],
    ...overrides,
  }
}

describe('cheapFilter — exclude keywords (D-02, word boundary)', () => {
  it('hard-discards on a whole-word exclude hit in the title', () => {
    const result = cheapFilter(
      job({ title: 'Staff Engineer' }),
      prefs({ excludeKeywords: ['staff'] }),
    )
    expect(result).toEqual({ pass: false, reason: 'excluded_keyword', detail: 'staff' })
  })

  it('does not false-positive a single-letter exclude inside a longer token', () => {
    expect(
      cheapFilter(job({ title: 'Cloud Architect' }), prefs({ excludeKeywords: ['c'] })).pass,
    ).toBe(true)
  })

  it('does not false-positive "go" inside "category"', () => {
    expect(
      cheapFilter(job({ title: 'Category Manager' }), prefs({ excludeKeywords: ['go'] })).pass,
    ).toBe(true)
  })

  it('does not false-positive "staff" inside "staffing"', () => {
    expect(
      cheapFilter(job({ title: 'Staffing Coordinator' }), prefs({ excludeKeywords: ['staff'] }))
        .pass,
    ).toBe(true)
  })

  it('discards on a whole-word "go" hit', () => {
    const result = cheapFilter(
      job({ title: 'Go Developer' }),
      prefs({ excludeKeywords: ['go'] }),
    )
    expect(result).toEqual({ pass: false, reason: 'excluded_keyword', detail: 'go' })
  })

  it('discards on a contiguous multi-word exclude phrase in the JD', () => {
    const result = cheapFilter(
      job({
        title: 'Platform Engineer',
        descriptionText: 'Own the machine learning platform end to end.',
      }),
      prefs({ excludeKeywords: ['machine learning'], titles: ['engineer'] }),
    )
    expect(result).toEqual({
      pass: false,
      reason: 'excluded_keyword',
      detail: 'machine learning',
    })
  })
})

describe('cheapFilter — include keywords never discard (D-02)', () => {
  it('passes even when an include keyword is absent from the JD', () => {
    const result = cheapFilter(
      job({ title: 'Data Scientist', descriptionText: 'build dashboards' }),
      prefs({ includeKeywords: ['python'], titles: ['data scientist'] }),
    )
    expect(result.pass).toBe(true)
  })

  it('reports matched include keywords on pass without discarding', () => {
    const result = cheapFilter(
      job({
        title: 'Data Scientist',
        descriptionText: 'Strong python and sql skills required.',
      }),
      prefs({ includeKeywords: ['python', 'rust'], titles: ['data scientist'] }),
    )
    expect(result.pass).toBe(true)
    if (result.pass) {
      expect(result.matchedIncludeKeywords).toContain('python')
      expect(result.matchedIncludeKeywords).not.toContain('rust')
    }
  })
})

describe('cheapFilter — title overlap (D-01)', () => {
  it('matches through a known synonym pair', () => {
    const result = cheapFilter(
      job({ title: 'Quant Researcher', location: null, descriptionText: '' }),
      prefs({ titles: ['Quantitative Researcher'] }),
    )
    expect(result.pass).toBe(true)
  })

  it('discards on clear title non-overlap', () => {
    const result = cheapFilter(
      job({ title: 'Registered Nurse', location: null, descriptionText: '' }),
      prefs({ titles: ['data scientist'] }),
    )
    expect(result.pass).toBe(false)
    if (!result.pass) expect(result.reason).toBe('title_non_overlap')
  })

  it('passes the title check when prefs.titles is empty', () => {
    const result = cheapFilter(
      job({ title: 'Registered Nurse', location: null, descriptionText: '' }),
      prefs({ titles: [] }),
    )
    expect(result.pass).toBe(true)
  })
})

describe('cheapFilter — location leniency (D-03)', () => {
  it('passes when the job location contains a preferred location', () => {
    const result = cheapFilter(
      job({ title: 'Data Scientist', location: 'Chicago, IL' }),
      prefs({ titles: ['data scientist'], locations: ['chicago'] }),
    )
    expect(result.pass).toBe(true)
  })

  it('passes a remote posting regardless of preferred locations', () => {
    const result = cheapFilter(
      job({ title: 'Data Scientist', location: 'Remote - US' }),
      prefs({ titles: ['data scientist'], locations: ['chicago'] }),
    )
    expect(result.pass).toBe(true)
  })

  it('passes when the job location is blank/null (AI judges later)', () => {
    const result = cheapFilter(
      job({ title: 'Data Scientist', location: null }),
      prefs({ titles: ['data scientist'], locations: ['chicago'] }),
    )
    expect(result.pass).toBe(true)
  })

  it('discards a clear location mismatch with no remote mention', () => {
    const result = cheapFilter(
      job({
        title: 'Data Scientist',
        location: 'London, UK',
        descriptionText: 'on-site role in our london office',
      }),
      prefs({ titles: ['data scientist'], locations: ['chicago'] }),
    )
    expect(result.pass).toBe(false)
    if (!result.pass) expect(result.reason).toBe('wrong_location')
  })
})

describe('cheapFilter — check order (D-04)', () => {
  it('reports excluded_keyword before wrong_location when both apply', () => {
    const result = cheapFilter(
      job({
        title: 'Staff Data Scientist',
        location: 'London, UK',
        descriptionText: 'on-site role',
      }),
      prefs({
        titles: ['data scientist'],
        locations: ['chicago'],
        excludeKeywords: ['staff'],
      }),
    )
    expect(result.pass).toBe(false)
    if (!result.pass) expect(result.reason).toBe('excluded_keyword')
  })
})

describe('SYNONYMS table (D-01)', () => {
  it('seeds the named synonym pairs', () => {
    expect(SYNONYMS.quant).toContain('quantitative')
    expect(SYNONYMS.sr).toContain('senior')
    expect(SYNONYMS.jr).toContain('junior')
    expect(SYNONYMS.ml).toContain('machine learning')
    expect(SYNONYMS.swe).toContain('software engineer')
    expect(SYNONYMS.ds).toContain('data scientist')
    expect(SYNONYMS.mgr).toContain('manager')
  })
})

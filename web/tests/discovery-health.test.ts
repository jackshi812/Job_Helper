import { describe, expect, it } from 'vitest'
import {
  distinctSeedQueries,
  summarizeDiscovery,
} from '../../supabase/functions/_shared/discovery-health'

describe('summarizeDiscovery', () => {
  it('fails loudly when every attempted query fails', () => {
    expect(summarizeDiscovery(3, 0)).toEqual({
      status: 'failed',
      httpStatus: 503,
    })
  })

  it('reports degraded health when only some queries succeed', () => {
    expect(summarizeDiscovery(3, 1)).toEqual({
      status: 'degraded',
      httpStatus: 200,
    })
  })

  it('reports healthy discovery when every query succeeds', () => {
    expect(summarizeDiscovery(3, 3)).toEqual({
      status: 'ok',
      httpStatus: 200,
    })
  })

  it('treats a sweep with no enabled queries as healthy no-work', () => {
    expect(summarizeDiscovery(0, 0)).toEqual({
      status: 'ok',
      httpStatus: 200,
    })
  })
})

describe('distinctSeedQueries', () => {
  it('dedupes normalized query pairs while preserving first-seen values', () => {
    expect(distinctSeedQueries([
      { what: 'software engineer', where_loc: 'Chicago, IL' },
      { what: 'Software Engineer', where_loc: ' chicago, il ' },
      { what: 'data engineer', where_loc: 'Chicago, IL' },
    ])).toEqual([
      { what: 'software engineer', where_loc: 'Chicago, IL' },
      { what: 'data engineer', where_loc: 'Chicago, IL' },
    ])
  })
})

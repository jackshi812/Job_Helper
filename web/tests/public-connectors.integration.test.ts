import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  pollConnector,
  providerRegistry,
} from '../../supabase/functions/_shared/connectors.ts'
import { detectAts } from '../../supabase/functions/_shared/detect.ts'
import {
  pollSmartRecruiters,
} from '../../supabase/functions/_shared/adapters/smartrecruiters.ts'
import {
  pollRecruitee,
} from '../../supabase/functions/_shared/adapters/recruitee.ts'
import migrationSql from '../../supabase/migrations/0014_public_connectors.sql?raw'
import normalizedTypesSource from '../../supabase/functions/_shared/adapters/types.ts?raw'

const smartPosting = {
  id: 'sr-101',
  name: 'Platform Engineer',
  releasedDate: '2026-07-17T12:00:00Z',
  ref: 'https://jobs.smartrecruiters.com/SmartRecruiters/743999-sr-101',
  location: { city: 'Chicago', region: 'Illinois', country: 'US' },
  company: { name: 'SmartRecruiters' },
  jobAd: { sections: { jobDescription: { text: '<p>Build hiring software.</p>' } } },
}

const recruiteeOffer = {
  id: 202,
  title: 'Security Engineer',
  careers_url: 'https://uturn.recruitee.com/o/security-engineer',
  location: 'Remote',
  created_at: '2026-07-17T12:00:00Z',
  description: '<p>Protect customer systems.</p>',
}

function jsonResponse(payload: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json', ...init.headers },
    ...init,
  })
}

describe('public connector detection journey', () => {
  it.each([
    ['https://jobs.smartrecruiters.com/SmartRecruiters', { ats: 'smartrecruiters', slug: 'SmartRecruiters' }],
    ['https://uturn.recruitee.com', { ats: 'recruitee', slug: 'uturn' }],
  ])('detects the exact approved board %s', (url, expected) => {
    expect(detectAts(url)).toEqual(expected)
  })

  it.each([
    'http://jobs.smartrecruiters.com/SmartRecruiters',
    'https://user:password@jobs.smartrecruiters.com/SmartRecruiters',
    'https://jobs.smartrecruiters.com:444/SmartRecruiters',
    'https://jobs.smartrecruiters.com.evil.example/SmartRecruiters',
    'https://jobs.smartrecruiters.com/SmartRecruiters/jobs',
    'https://jobs.smartrecruiters.com/Smart%2FRecruiters',
    'http://uturn.recruitee.com',
    'https://user:password@uturn.recruitee.com',
    'https://uturn.recruitee.com:444',
    'https://uturn.recruitee.com.evil.example',
    'https://nested.uturn.recruitee.com',
    'https://uturn.recruitee.com/jobs',
  ])('rejects unsafe board identity %s before network access', (url) => {
    expect(detectAts(url)).toEqual({ ats: 'unsupported' })
  })
})

describe('SmartRecruiters bounded observation', () => {
  it('reconciles offset pages and totalFound into credible closure evidence', async () => {
    const second = { ...smartPosting, id: 'sr-102', name: 'Data Engineer' }
    const providerFetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ totalFound: 2, content: [smartPosting] }))
      .mockResolvedValueOnce(jsonResponse({ totalFound: 2, content: [second] }))

    const observation = await pollSmartRecruiters('SmartRecruiters', providerFetch, {
      pageSize: 1,
    })

    expect(providerFetch).toHaveBeenNthCalledWith(1, expect.stringContaining('limit=1&offset=0'), expect.any(Object))
    expect(providerFetch).toHaveBeenNthCalledWith(2, expect.stringContaining('limit=1&offset=1'), expect.any(Object))
    expect(observation).toMatchObject({
      completeness: 'complete',
      credibleForClosure: true,
      expectedCount: 2,
      pageCount: 2,
      jobs: [
        { source: 'smartrecruiters', externalId: 'sr-101' },
        { source: 'smartrecruiters', externalId: 'sr-102' },
      ],
      warnings: [],
    })
  })

  it.each([
    ['rate limit', () => new Response('', { status: 429, headers: { 'retry-after': '9999' } }), 'http_429'],
    ['WAF HTML', () => new Response('<html>challenge</html>', { headers: { 'content-type': 'text/html' } }), 'invalid_content_type'],
    ['malformed JSON', () => new Response('{', { headers: { 'content-type': 'application/json' } }), 'malformed_response'],
    ['oversized payload', () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '99999999' } }), 'payload_too_large'],
  ])('makes %s closure-ineligible with a bounded warning', async (_name, response, warning) => {
    const observation = await pollSmartRecruiters('SmartRecruiters', vi.fn().mockResolvedValue(response()))
    expect(observation).toMatchObject({
      completeness: 'unknown',
      credibleForClosure: false,
      jobs: [],
      warnings: [warning],
    })
    expect(observation.warnings.join('')).not.toContain('challenge')
  })

  it('retains safe rows but degrades a count mismatch', async () => {
    const providerFetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ totalFound: 2, content: [smartPosting] }))
      .mockResolvedValueOnce(jsonResponse({ totalFound: 2, content: [] }))
    const observation = await pollSmartRecruiters(
      'SmartRecruiters',
      providerFetch,
      { pageSize: 100 },
    )

    expect(observation).toMatchObject({
      completeness: 'partial',
      credibleForClosure: false,
      expectedCount: 2,
      jobs: [{ externalId: 'sr-101' }],
      warnings: ['count_mismatch'],
    })
  })

  it('retains a safe list row but denies closure when required detail fails', async () => {
    const listed = { ...smartPosting, jobAd: undefined }
    const providerFetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ totalFound: 1, content: [listed] }))
      .mockResolvedValue(new Response('', { status: 503, headers: { 'content-type': 'application/json' } }))

    const observation = await pollSmartRecruiters('SmartRecruiters', providerFetch)

    expect(providerFetch).toHaveBeenCalledTimes(3)
    expect(observation).toMatchObject({
      completeness: 'partial',
      credibleForClosure: false,
      expectedCount: 1,
      jobs: [{ externalId: 'sr-101', snapshotPartial: true }],
      warnings: ['provider_http_503'],
    })
  })
})

describe('Recruitee bounded observation', () => {
  it('validates the documented offers wrapper and records', async () => {
    const observation = await pollRecruitee(
      'uturn',
      vi.fn().mockResolvedValue(jsonResponse({ offers: [recruiteeOffer] })),
    )

    expect(observation).toMatchObject({
      completeness: 'complete',
      credibleForClosure: true,
      expectedCount: 1,
      pageCount: 1,
      jobs: [{ source: 'recruitee', externalId: '202' }],
      warnings: [],
    })
  })

  it.each([
    [{ offers: 'wrong' }, 'provider_schema_invalid'],
    [{ offers: [{ ...recruiteeOffer, careers_url: 'javascript:alert(1)' }] }, 'provider_schema_invalid'],
    [{ offers: Array.from({ length: 1001 }, (_, id) => ({ ...recruiteeOffer, id })) }, 'job_cap_exceeded'],
  ])('fails malformed or capped payloads closed', async (payload, warning) => {
    const observation = await pollRecruitee(
      'uturn',
      vi.fn().mockResolvedValue(jsonResponse(payload)),
    )
    expect(observation).toMatchObject({
      credibleForClosure: false,
      jobs: [],
      warnings: [warning],
    })
  })

  it('preserves safe rows when another record is malformed', async () => {
    const observation = await pollRecruitee(
      'uturn',
      vi.fn().mockResolvedValue(jsonResponse({
        offers: [recruiteeOffer, { ...recruiteeOffer, id: 'bad', careers_url: 'http://unsafe.example' }],
      })),
    )
    expect(observation).toMatchObject({
      completeness: 'partial',
      credibleForClosure: false,
      expectedCount: 2,
      jobs: [{ externalId: '202' }],
      warnings: ['provider_schema_invalid'],
    })
  })
})

describe('closed registry dispatch for public connectors', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps provider registry parity exhaustive', () => {
    expect(Object.keys(providerRegistry).sort()).toEqual([
      'ashby',
      'greenhouse',
      'lever',
      'recruitee',
      'smartrecruiters',
    ])
  })

  it('keeps normalized sources and database constraints in parity', () => {
    const executable = ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'recruitee']
    for (const provider of executable) {
      expect(normalizedTypesSource).toContain(`| '${provider}'`)
      expect(migrationSql).toContain(`'${provider}'`)
    }
    expect(migrationSql).toContain("source in ('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'recruitee', 'adzuna')")
    expect(migrationSql).toContain("ats_type in ('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'recruitee')")
    expect(migrationSql).toContain("source = 'recruitee'")
    expect(migrationSql).toContain("source = 'smartrecruiters'")
    expect(migrationSql).not.toMatch(/workday|oracle|icims|successfactors|eightfold/i)
  })

  it.each([
    ['smartrecruiters', 'SmartRecruiters', { totalFound: 1, content: [smartPosting] }, 'api.smartrecruiters.com'],
    ['recruitee', 'uturn', { offers: [recruiteeOffer] }, 'uturn.recruitee.com'],
  ] as const)('dispatches active %s only to its exact adapter', async (ats_type, board_token, payload, host) => {
    const providerFetch = vi.fn().mockResolvedValue(jsonResponse(payload))
    vi.stubGlobal('fetch', providerFetch)

    const observation = await pollConnector({
      ats_type,
      board_token,
      region: null,
      activation_state: 'active',
    }, new Set())

    expect(providerFetch).toHaveBeenCalled()
    expect(String(providerFetch.mock.calls[0][0])).toContain(host)
    expect(observation.jobs[0]?.source).toBe(ats_type)
  })

  it.each([
    ['unknown-provider', 'active', 'unsupported_provider:unknown-provider'],
    ['smartrecruiters', 'experimental', 'inactive_connector:experimental'],
  ])('rejects %s/%s before provider access', async (ats_type, activation_state, error) => {
    const providerFetch = vi.fn()
    vi.stubGlobal('fetch', providerFetch)
    await expect(pollConnector({
      ats_type,
      board_token: 'example',
      region: null,
      activation_state,
    }, new Set())).rejects.toThrow(error)
    expect(providerFetch).not.toHaveBeenCalled()
  })
})

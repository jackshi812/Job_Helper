import { describe, expect, it, vi } from 'vitest'
import {
  EIGHTFOLD_MORGAN_STANLEY_SOURCE_KEY,
  resolveBrandedIdentity,
  type EightfoldBrandedIdentity,
} from '../../supabase/functions/_shared/branded-identities'
import {
  pollMorganStanleyEightfold,
} from '../../supabase/functions/_shared/adapters/eightfold'

const jsonResponse = (
  payload: unknown,
  init: ResponseInit = {},
) => new Response(JSON.stringify(payload), {
  status: 200,
  ...init,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    ...init.headers,
  },
})

const eightfoldIdentity = resolveBrandedIdentity(
  EIGHTFOLD_MORGAN_STANLEY_SOURCE_KEY,
) as EightfoldBrandedIdentity

const eightfoldPosition = (
  id: string,
  businessArea = 'Technology',
) => ({
  id,
  name: `Platform Engineer ${id}`,
  locations: ['New York, New York, United States of America'],
  business_area: businessArea,
  t_create: 1_783_530_120,
  canonicalPositionUrl:
    `https://morganstanley.eightfold.ai/careers/job/${id}`,
})

const eightfoldDetail = (
  id: string,
  countryCode = 'US',
) => ({
  id,
  name: `Platform Engineer ${id}`,
  job_description: `<p>Build reliable data platforms for role ${id}.</p>`,
  locations: [{
    city: 'New York',
    state: 'New York',
    country: 'United States of America',
    country_code: countryCode,
  }],
  apply_url: `https://morganstanley.eightfold.ai/careers/apply/${id}`,
})

function eightfoldFetch(
  positions = [
    eightfoldPosition('ms-1', 'Data & Analytics'),
    eightfoldPosition('ms-2', 'Capital Markets Technology'),
  ],
) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input))
    if (url.pathname === '/api/pcsx/search') {
      const start = Number(url.searchParams.get('start'))
      const num = Number(url.searchParams.get('num'))
      return jsonResponse({
        count: positions.length,
        positions: positions.slice(start, start + num),
        query: {
          domain: 'morganstanley.com',
          location: 'United States of America',
        },
      })
    }
    return jsonResponse(eightfoldDetail(url.searchParams.get('pid') ?? ''))
  })
}

describe('Morgan Stanley Eightfold adapter', () => {
  it('reconciles every page and emits complete immutable U.S. scope evidence', async () => {
    const providerFetch = eightfoldFetch()
    const observation = await pollMorganStanleyEightfold(
      eightfoldIdentity,
      providerFetch,
      { pageSize: 1, now: () => 0 },
    )

    expect(observation).toMatchObject({
      completeness: 'complete',
      credibleForClosure: true,
      allowMissingClosure: true,
      expectedCount: 2,
      pageCount: 2,
      warnings: [],
      jobs: [
        {
          source: 'eightfold',
          externalId: 'ms-1',
          title: 'Platform Engineer ms-1',
          companyName: 'Morgan Stanley',
          snapshotPartial: false,
          scopeEvidence: {
            sourceKey: EIGHTFOLD_MORGAN_STANLEY_SOURCE_KEY,
            providerCategoryLabel: 'data analytics',
            matchedTerm: 'Data',
            detailCountryCode: 'US',
            externalIdDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
          },
        },
        {
          source: 'eightfold',
          externalId: 'ms-2',
          scopeEvidence: {
            matchedTerm: 'Capital Markets',
          },
        },
      ],
      scopeEvidence: {
        sourceKey: EIGHTFOLD_MORGAN_STANLEY_SOURCE_KEY,
        sliceDigests: [expect.stringMatching(/^[a-f0-9]{64}$/)],
        categoryDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        countryDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    })
    expect(Object.isFrozen(observation.scopeEvidence)).toBe(true)
    expect(providerFetch).toHaveBeenCalledTimes(4)

    const requests = providerFetch.mock.calls.map(([input, init]) => ({
      url: new URL(String(input)),
      init,
    }))
    for (const request of requests) {
      expect(request.url.origin).toBe(eightfoldIdentity.origin)
      expect(request.init).toMatchObject({
        method: 'GET',
        redirect: 'error',
        headers: { accept: 'application/json' },
      })
    }
    const listRequests = requests.filter(({ url }) =>
      url.pathname === eightfoldIdentity.searchPath
    )
    expect(listRequests.map(({ url }) => url.searchParams.get('start'))).toEqual([
      '0',
      '1',
    ])
    expect(listRequests.every(({ url }) =>
      url.searchParams.get('domain') === eightfoldIdentity.domain
      && url.searchParams.get('location') === eightfoldIdentity.countryValue
    )).toBe(true)
  })

  it('rejects a reconstructed or drifted identity before network access', async () => {
    const providerFetch = vi.fn()
    const drifted = {
      ...eightfoldIdentity,
      origin: 'https://attacker.example',
    } as EightfoldBrandedIdentity

    const observation = await pollMorganStanleyEightfold(
      drifted,
      providerFetch,
    )

    expect(providerFetch).not.toHaveBeenCalled()
    expect(observation).toMatchObject({
      jobs: [],
      completeness: 'unknown',
      credibleForClosure: false,
      allowMissingClosure: false,
      warnings: ['invalid_identity'],
    })
  })

  it.each([
    [
      'non-JSON content',
      async () => new Response('<html>challenge</html>', {
        headers: { 'content-type': 'text/html' },
      }),
      'invalid_content_type',
    ],
    [
      'redirect rejection',
      async () => {
        throw new TypeError('redirect mode is set to error')
      },
      'network_error',
    ],
    [
      'malformed JSON',
      async () => new Response('{', {
        headers: { 'content-type': 'application/json' },
      }),
      'malformed_response',
    ],
    [
      'declared byte cap',
      async () => jsonResponse({}, {
        headers: {
          'content-type': 'application/json',
          'content-length': '1000',
        },
      }),
      'payload_too_large',
    ],
  ])('fails closed on %s with bounded transport evidence', async (
    _name,
    providerFetch,
    warning,
  ) => {
    const observation = await pollMorganStanleyEightfold(
      eightfoldIdentity,
      providerFetch,
      { maxBytes: 64, now: () => 0 },
    )

    expect(observation).toMatchObject({
      jobs: [],
      completeness: 'unknown',
      credibleForClosure: false,
      allowMissingClosure: false,
      warnings: [warning],
    })
    expect(JSON.stringify(observation)).not.toContain('challenge')
    expect(observation.warnings[0].length).toBeLessThanOrEqual(64)
  })

  it.each([
    [
      'count drift',
      async (input: string | URL | Request) => {
        const url = new URL(String(input))
        const start = Number(url.searchParams.get('start'))
        return jsonResponse({
          count: start === 0 ? 2 : 3,
          positions: [eightfoldPosition(start === 0 ? 'ms-1' : 'ms-2')],
          query: {
            domain: 'morganstanley.com',
            location: 'United States of America',
          },
        })
      },
      { pageSize: 1 },
      'count_mismatch',
    ],
    [
      'repeated stable ID',
      async () => jsonResponse({
        count: 2,
        positions: [
          eightfoldPosition('ms-1'),
          eightfoldPosition('ms-1'),
        ],
        query: {
          domain: 'morganstanley.com',
          location: 'United States of America',
        },
      }),
      {},
      'duplicate_id',
    ],
    [
      'missing provider category',
      async () => jsonResponse({
        count: 1,
        positions: [{ ...eightfoldPosition('ms-1'), business_area: '' }],
        query: {
          domain: 'morganstanley.com',
          location: 'United States of America',
        },
      }),
      {},
      'category_evidence_missing',
    ],
    [
      'page cap',
      async (input: string | URL | Request) => {
        const url = new URL(String(input))
        return jsonResponse({
          count: 2,
          positions: [eightfoldPosition(
            url.searchParams.get('start') === '0' ? 'ms-1' : 'ms-2',
          )],
          query: {
            domain: 'morganstanley.com',
            location: 'United States of America',
          },
        })
      },
      { pageSize: 1, maxPages: 1 },
      'page_cap_exceeded',
    ],
    [
      'job cap',
      async () => jsonResponse({
        count: 2,
        positions: [
          eightfoldPosition('ms-1'),
          eightfoldPosition('ms-2'),
        ],
        query: {
          domain: 'morganstanley.com',
          location: 'United States of America',
        },
      }),
      { maxJobs: 1 },
      'job_cap_exceeded',
    ],
  ])('makes %s closure-ineligible', async (
    _name,
    providerFetch,
    options,
    warning,
  ) => {
    const observation = await pollMorganStanleyEightfold(
      eightfoldIdentity,
      providerFetch,
      { ...options, now: () => 0 },
    )
    expect(observation).toMatchObject({
      credibleForClosure: false,
      allowMissingClosure: false,
      warnings: [warning],
    })
  })

  it.each([
    ['missing detail country', eightfoldDetail('ms-1', 'GB'), 'detail_country_ineligible'],
    ['missing usable detail', { ...eightfoldDetail('ms-1'), job_description: '' }, 'detail_evidence_missing'],
    ['detail ID drift', eightfoldDetail('ms-other'), 'detail_id_mismatch'],
  ])('retains no unproven job for %s', async (_name, detail, warning) => {
    const providerFetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname === eightfoldIdentity.searchPath) {
        return jsonResponse({
          count: 1,
          positions: [eightfoldPosition('ms-1', 'Risk')],
          query: {
            domain: 'morganstanley.com',
            location: 'United States of America',
          },
        })
      }
      return jsonResponse(detail)
    })
    const observation = await pollMorganStanleyEightfold(
      eightfoldIdentity,
      providerFetch,
      { now: () => 0 },
    )
    expect(observation).toMatchObject({
      jobs: [],
      credibleForClosure: false,
      allowMissingClosure: false,
      warnings: [warning],
    })
  })

  it('enforces detail and deadline caps without scheduling another fetch', async () => {
    let nowMs = 0
    const providerFetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname === eightfoldIdentity.searchPath) {
        nowMs = 100
        return jsonResponse({
          count: 2,
          positions: [
            eightfoldPosition('ms-1', 'Risk'),
            eightfoldPosition('ms-2', 'Finance'),
          ],
          query: {
            domain: 'morganstanley.com',
            location: 'United States of America',
          },
        })
      }
      return jsonResponse(eightfoldDetail(url.searchParams.get('pid') ?? ''))
    })

    const deadline = await pollMorganStanleyEightfold(
      eightfoldIdentity,
      providerFetch,
      { totalDurationMs: 50, now: () => nowMs },
    )
    expect(providerFetch).toHaveBeenCalledTimes(1)
    expect(deadline.warnings).toEqual(['deadline_exceeded'])

    nowMs = 0
    providerFetch.mockClear()
    const detailCap = await pollMorganStanleyEightfold(
      eightfoldIdentity,
      providerFetch,
      { maxDetailRequests: 1, now: () => nowMs },
    )
    expect(providerFetch).toHaveBeenCalledTimes(2)
    expect(detailCap.warnings).toEqual(['detail_cap_exceeded'])
    expect(detailCap.allowMissingClosure).toBe(false)
  })

  it('treats a complete but zero-eligible scope as non-admissible', async () => {
    const observation = await pollMorganStanleyEightfold(
      eightfoldIdentity,
      eightfoldFetch([eightfoldPosition('ms-1', 'Human Resources')]),
      { now: () => 0 },
    )

    expect(observation).toMatchObject({
      jobs: [],
      completeness: 'unknown',
      credibleForClosure: false,
      allowMissingClosure: false,
      expectedCount: 0,
      warnings: ['zero_eligible_jobs'],
    })
  })
})

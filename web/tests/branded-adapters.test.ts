import { describe, expect, it, vi } from 'vitest'
import {
  EIGHTFOLD_MORGAN_STANLEY_SOURCE_KEY,
  ORACLE_JPMC_SOURCE_KEY,
  resolveBrandedIdentity,
  type EightfoldBrandedIdentity,
  type OracleRecruitingBrandedIdentity,
} from '../../supabase/functions/_shared/branded-identities'
import {
  pollMorganStanleyEightfold,
} from '../../supabase/functions/_shared/adapters/eightfold'
import {
  pollJpmorganOracleRecruiting,
} from '../../supabase/functions/_shared/adapters/oracle-recruiting'

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

const oracleIdentity = resolveBrandedIdentity(
  ORACLE_JPMC_SOURCE_KEY,
) as OracleRecruitingBrandedIdentity

const oracleRequisition = (
  id: string,
  jobFamily = 'Credit Risk',
) => ({
  Id: id,
  Title: `Risk Analyst ${id}`,
  PostedDate: '2026-07-23',
  PrimaryLocationCountry: 'US',
  PrimaryLocation: 'New York, NY, United States',
  JobFamily: jobFamily,
  JobFunction: 'Risk',
  ShortDescriptionStr: `Manage risk for ${id}.`,
})

const oracleDetail = (
  id: string,
  overrides: Record<string, unknown> = {},
) => ({
  Id: id,
  Title: `Risk Analyst ${id}`,
  PrimaryLocation: 'New York, NY, United States',
  PrimaryLocationCountry: 'US',
  JobFunction: 'Risk',
  Category: 'Credit Risk',
  ExternalDescriptionStr: `<p>Analyze portfolio risk for ${id}.</p>`,
  ExternalResponsibilitiesStr: '<p>Build durable controls.</p>',
  ExternalQualificationsStr: '<p>Financial risk experience.</p>',
  ExternalPostedStartDate: '2026-07-23',
  secondaryLocations: [],
  ...overrides,
})

function oracleFinder(url: URL): Record<string, string> {
  const finder = url.searchParams.get('finder') ?? ''
  const [name, values = ''] = finder.split(';', 2)
  return Object.fromEntries([
    ['finder', name],
    ...values.split(',').map((part) => {
      const separator = part.indexOf('=')
      return [
        part.slice(0, separator),
        part.slice(separator + 1).replace(/^"|"$/g, ''),
      ]
    }),
  ])
}

function oracleListEnvelope(
  requisitions: unknown[],
  offset: number,
  total = requisitions.length,
  overrides: Record<string, unknown> = {},
) {
  const category = oracleIdentity.categoryFacets[0]
  return {
    count: 1,
    hasMore: false,
    limit: 200,
    offset: 0,
    items: [{
      SiteNumber: oracleIdentity.siteNumber,
      Offset: offset,
      Limit: 1,
      TotalJobsCount: total,
      SelectedLocationsFacet: oracleIdentity.countryFacet.id,
      SelectedCategoriesFacet: category.id,
      categoriesFacet: [{
        Id: Number(category.id),
        Name: category.expectedLabel,
        TotalCount: total,
      }],
      locationsFacet: [{
        Id: Number(oracleIdentity.countryFacet.id),
        Name: oracleIdentity.countryFacet.expectedLabel,
        TotalCount: total,
      }],
      requisitionList: requisitions,
      ...overrides,
    }],
  }
}

function oracleFetch(
  requisitions = [
    oracleRequisition('210000001'),
    oracleRequisition('210000002'),
  ],
) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input))
    const finder = oracleFinder(url)
    if (finder.finder === 'findReqs') {
      const offset = Number(finder.offset)
      return jsonResponse(oracleListEnvelope(
        requisitions.slice(offset, offset + Number(finder.limit)),
        offset,
        requisitions.length,
      ))
    }
    return jsonResponse({
      count: 1,
      hasMore: false,
      limit: 499,
      offset: 0,
      items: [oracleDetail(finder.Id)],
    })
  })
}

describe('JPMorgan Oracle Recruiting adapter', () => {
  it('reconciles the exact fixed facet slice before normalizing its stable-ID union', async () => {
    const providerFetch = oracleFetch()
    const observation = await pollJpmorganOracleRecruiting(
      oracleIdentity,
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
          source: 'oracle_recruiting',
          externalId: '210000001',
          title: 'Risk Analyst 210000001',
          location: 'New York, NY, United States',
          companyName: 'JPMorgan Chase',
          snapshotPartial: false,
          scopeEvidence: {
            sourceKey: ORACLE_JPMC_SOURCE_KEY,
            providerCategoryLabel: 'credit risk',
            matchedTerm: 'Risk',
            detailCountryCode: 'US',
          },
        },
        {
          source: 'oracle_recruiting',
          externalId: '210000002',
        },
      ],
      scopeEvidence: {
        sourceKey: ORACLE_JPMC_SOURCE_KEY,
        sliceDigests: [expect.stringMatching(/^[a-f0-9]{64}$/)],
        categoryDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        countryDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    })

    const requests = providerFetch.mock.calls.map(([input, init]) => ({
      url: new URL(String(input)),
      init,
    }))
    expect(requests).toHaveLength(4)
    expect(requests.every(({ url }) => url.origin === oracleIdentity.origin)).toBe(true)
    expect(requests.every(({ init }) => Boolean(init))).toBe(true)
    expect(requests.every(({ init }) =>
      init?.redirect === 'error'
      && init?.method === 'GET'
      && new Headers(init.headers).get('accept') === 'application/json'
    )).toBe(true)

    const lists = requests.filter(({ url }) =>
      oracleFinder(url).finder === 'findReqs'
    )
    expect(lists.map(({ url }) => oracleFinder(url).offset)).toEqual(['0', '1'])
    for (const { url } of lists) {
      const finder = oracleFinder(url)
      expect(url.pathname).toBe(oracleIdentity.listPath)
      expect(url.searchParams.get('expand')).toBe('requisitionList')
      expect(url.searchParams.get('onlyData')).toBe('true')
      expect(finder).toMatchObject({
        finder: 'findReqs',
        siteNumber: oracleIdentity.siteNumber,
        limit: '1',
        selectedLocationsFacet: oracleIdentity.countryFacet.id,
        selectedCategoriesFacet: oracleIdentity.categoryFacets[0].id,
      })
    }
  })

  it('accepts no caller-selected site, host, facet, path, or finder fragment', async () => {
    const providerFetch = vi.fn()
    const drifted = {
      ...oracleIdentity,
      siteNumber: 'CX_1002',
      origin: 'https://attacker.example',
      categoryFacets: [{
        id: 'attacker-facet',
        expectedLabel: 'Risk',
      }],
    } as unknown as OracleRecruitingBrandedIdentity

    const observation = await pollJpmorganOracleRecruiting(
      drifted,
      providerFetch,
    )

    expect(providerFetch).not.toHaveBeenCalled()
    expect(observation.warnings).toEqual(['invalid_identity'])
    expect(pollJpmorganOracleRecruiting.length).toBeLessThanOrEqual(3)
  })

  it.each([
    [
      'slice count drift',
      async (input: string | URL | Request) => {
        const url = new URL(String(input))
        const finder = oracleFinder(url)
        const offset = Number(finder.offset)
        return jsonResponse(oracleListEnvelope(
          [oracleRequisition(offset === 0 ? '210000001' : '210000002')],
          offset,
          offset === 0 ? 2 : 3,
        ))
      },
      { pageSize: 1 },
      'slice_count_mismatch',
    ],
    [
      'slice offset drift',
      async () => jsonResponse(oracleListEnvelope(
        [oracleRequisition('210000001')],
        5,
        1,
      )),
      {},
      'slice_offset_mismatch',
    ],
    [
      'facet label drift',
      async () => jsonResponse(oracleListEnvelope(
        [oracleRequisition('210000001')],
        0,
        1,
        {
          categoriesFacet: [{
            Id: Number(oracleIdentity.categoryFacets[0].id),
            Name: 'General Operations',
            TotalCount: 1,
          }],
        },
      )),
      {},
      'facet_label_mismatch',
    ],
    [
      'duplicate stable ID in one slice',
      async () => jsonResponse(oracleListEnvelope(
        [
          oracleRequisition('210000001'),
          oracleRequisition('210000001'),
        ],
        0,
        2,
      )),
      {},
      'duplicate_id',
    ],
    [
      'page cap',
      async () => jsonResponse(oracleListEnvelope(
        [oracleRequisition('210000001')],
        0,
        2,
      )),
      { pageSize: 1, maxPages: 1 },
      'page_cap_exceeded',
    ],
    [
      'job cap',
      async () => jsonResponse(oracleListEnvelope(
        [oracleRequisition('210000001')],
        0,
        2,
      )),
      { maxJobs: 1 },
      'job_cap_exceeded',
    ],
  ])('keeps the whole observation closure-ineligible on %s', async (
    _name,
    providerFetch,
    options,
    warning,
  ) => {
    const observation = await pollJpmorganOracleRecruiting(
      oracleIdentity,
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
    [
      'missing detail country',
      { PrimaryLocationCountry: null },
      'detail_country_ineligible',
    ],
    [
      'detail category mismatch',
      { JobFunction: 'Operations', Category: 'Operations' },
      'detail_category_ineligible',
    ],
    [
      'missing usable content',
      {
        ExternalDescriptionStr: '',
        ExternalResponsibilitiesStr: '',
        ExternalQualificationsStr: '',
      },
      'detail_evidence_missing',
    ],
    [
      'detail ID drift',
      { Id: '210000999' },
      'detail_id_mismatch',
    ],
  ])('rejects %s as unproven detail evidence', async (
    _name,
    overrides,
    warning,
  ) => {
    const providerFetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      const finder = oracleFinder(url)
      return finder.finder === 'findReqs'
        ? jsonResponse(oracleListEnvelope(
          [oracleRequisition('210000001')],
          0,
          1,
        ))
        : jsonResponse({
          count: 1,
          hasMore: false,
          limit: 499,
          offset: 0,
          items: [oracleDetail('210000001', overrides)],
        })
    })
    const observation = await pollJpmorganOracleRecruiting(
      oracleIdentity,
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

  it('bounds detail requests and rejects empty slices without activation evidence', async () => {
    const capped = await pollJpmorganOracleRecruiting(
      oracleIdentity,
      oracleFetch(),
      { maxDetailRequests: 1, now: () => 0 },
    )
    expect(capped.warnings).toEqual(['detail_cap_exceeded'])
    expect(capped.allowMissingClosure).toBe(false)

    const empty = await pollJpmorganOracleRecruiting(
      oracleIdentity,
      async () => jsonResponse(oracleListEnvelope([], 0, 0)),
      { now: () => 0 },
    )
    expect(empty).toMatchObject({
      jobs: [],
      completeness: 'unknown',
      credibleForClosure: false,
      allowMissingClosure: false,
      expectedCount: 0,
      warnings: ['zero_eligible_jobs'],
    })
  })
})

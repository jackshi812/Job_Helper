import { describe, expect, it, vi } from 'vitest'
import {
  EIGHTFOLD_MORGAN_STANLEY_SOURCE_KEY,
  GOLDMAN_HIGHER_SOURCE_KEY,
  ORACLE_JPMC_SOURCE_KEY,
  resolveBrandedIdentity,
  type EightfoldBrandedIdentity,
  type GoldmanHigherBrandedIdentity,
  type OracleRecruitingBrandedIdentity,
} from '../../supabase/functions/_shared/branded-identities'
import {
  pollMorganStanleyEightfold,
} from '../../supabase/functions/_shared/adapters/eightfold'
import {
  pollJpmorganOracleRecruiting,
} from '../../supabase/functions/_shared/adapters/oracle-recruiting'
import {
  pollGoldmanHigher,
} from '../../supabase/functions/_shared/adapters/goldman-higher'

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

const ORACLE_NOW = Date.parse('2026-07-26T12:00:00.000Z')

const oracleRequisition = (
  id: string,
  jobFunction = 'Risk',
  postedDate: unknown = '2026-07-23',
) => ({
  Id: id,
  Title: `${jobFunction} Analyst ${id}`,
  PostedDate: postedDate,
  PrimaryLocationCountry: 'US',
  PrimaryLocation: 'New York, NY, United States',
  JobFamily: 'Professional',
  JobFunction: jobFunction,
  ShortDescriptionStr: `Manage risk for ${id}.`,
})

const oracleDetail = (
  id: string,
  jobFunction = 'Risk',
  overrides: Record<string, unknown> = {},
) => ({
  Id: id,
  Title: `${jobFunction} Analyst ${id}`,
  PrimaryLocation: 'New York, NY, United States',
  PrimaryLocationCountry: 'US',
  JobFunction: jobFunction,
  Category: 'Professional',
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
  titleFacet = oracleIdentity.titleFacets[0],
) {
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
      SelectedTitlesFacet: titleFacet.id,
      SelectedPostingDatesFacet: oracleIdentity.postingDateFacet.id,
      titlesFacet: [{
        Id: titleFacet.id,
        Name: titleFacet.expectedLabel,
        TotalCount: total,
      }],
      locationsFacet: [{
        Id: Number(oracleIdentity.countryFacet.id),
        Name: oracleIdentity.countryFacet.expectedLabel,
        TotalCount: total,
      }],
      postingDatesFacet: [{
        Id: oracleIdentity.postingDateFacet.id,
        Name: oracleIdentity.postingDateFacet.expectedLabel,
        TotalCount: total,
      }],
      requisitionList: requisitions,
      ...overrides,
    }],
  }
}

function oracleFetch(detailOverrides: Record<string, unknown> = {}) {
  const byId = new Map(oracleIdentity.titleFacets.map((facet, index) => [
    String(210000001 + index),
    facet,
  ]))
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input))
    const finder = oracleFinder(url)
    if (finder.finder === 'findReqs') {
      const facet = oracleIdentity.titleFacets.find(
        (candidate) => candidate.id === finder.selectedTitlesFacet,
      ) ?? oracleIdentity.titleFacets[0]
      const index = oracleIdentity.titleFacets.indexOf(facet)
      const requisitions = [
        oracleRequisition(String(210000001 + index), facet.expectedLabel),
      ]
      const offset = Number(finder.offset)
      return jsonResponse(oracleListEnvelope(
        requisitions.slice(offset, offset + Number(finder.limit)),
        offset,
        requisitions.length,
        { Limit: Number(finder.limit) },
        facet,
      ))
    }
    const facet = byId.get(finder.Id) ?? oracleIdentity.titleFacets[0]
    return jsonResponse({
      count: 1,
      hasMore: false,
      limit: 499,
      offset: 0,
      items: [oracleDetail(finder.Id, facet.expectedLabel, detailOverrides)],
    })
  })
}

describe('JPMorgan Oracle Recruiting adapter', () => {
  it('reconciles the exact fixed facet slice before normalizing its stable-ID union', async () => {
    const providerFetch = oracleFetch()
    const observation = await pollJpmorganOracleRecruiting(
      oracleIdentity,
      providerFetch,
      { pageSize: 1, now: () => 0, wallClockNow: () => ORACLE_NOW },
    )

    expect(observation).toMatchObject({
      completeness: 'complete',
      credibleForClosure: true,
      allowMissingClosure: false,
      expectedCount: 6,
      pageCount: 6,
      warnings: [],
      scopeEvidence: {
        sourceKey: ORACLE_JPMC_SOURCE_KEY,
        sliceDigests: Array.from(
          { length: 6 },
          () => expect.stringMatching(/^[a-f0-9]{64}$/),
        ),
        categoryDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        countryDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    })
    expect(observation.jobs).toHaveLength(6)
    expect(observation.jobs[0]).toMatchObject({
      source: 'oracle_recruiting',
      externalId: '210000001',
      title: 'Finance Analyst 210000001',
      location: 'New York, NY, United States',
      companyName: 'JPMorgan Chase',
      snapshotPartial: false,
      scopeEvidence: {
        sourceKey: ORACLE_JPMC_SOURCE_KEY,
        providerCategoryLabel: 'finance',
        matchedTerm: 'Finance',
        detailCountryCode: 'US',
      },
    })

    const requests = providerFetch.mock.calls.map(([input, init]) => ({
      url: new URL(String(input)),
      init,
    }))
    expect(requests).toHaveLength(12)
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
    expect(lists.map(({ url }) => oracleFinder(url).offset)).toEqual(
      Array.from({ length: 6 }, () => '0'),
    )
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
        selectedPostingDatesFacet: oracleIdentity.postingDateFacet.id,
      })
      expect(oracleIdentity.titleFacets.map((facet) => facet.id)).toContain(
        finder.selectedTitlesFacet,
      )
    }
  })

  it('removes Oracle byte-order marks without weakening description validation', async () => {
    const observation = await pollJpmorganOracleRecruiting(
      oracleIdentity,
      oracleFetch({
        ExternalDescriptionStr:
          '<p>Analyze portfolio \uFEFFrisk without hidden content.</p>',
        ShortDescriptionStr: '\uFEFF<p>Finance role.</p>',
      }),
      { pageSize: 1, now: () => 0, wallClockNow: () => ORACLE_NOW },
    )

    expect(observation).toMatchObject({
      completeness: 'complete',
      credibleForClosure: true,
      allowMissingClosure: false,
      expectedCount: 6,
      warnings: [],
    })
    expect(observation.jobs).toHaveLength(6)
    expect(observation.jobs.every((job) =>
      !job.descriptionHtml?.includes('\uFEFF')
      && !job.descriptionText?.includes('\uFEFF')
    )).toBe(true)
  })

  it('accepts no caller-selected site, host, facet, path, or finder fragment', async () => {
    const providerFetch = vi.fn()
    const drifted = {
      ...oracleIdentity,
      siteNumber: 'CX_1002',
      origin: 'https://attacker.example',
      titleFacets: [{
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
          [oracleRequisition(
            offset === 0 ? '210000001' : '210000002',
            'Finance',
          )],
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
        [oracleRequisition('210000001', 'Finance')],
        5,
        1,
      )),
      {},
      'slice_offset_mismatch',
    ],
    [
      'facet label drift',
      async () => jsonResponse(oracleListEnvelope(
        [oracleRequisition('210000001', 'Finance')],
        0,
        1,
        {
          titlesFacet: [{
            Id: oracleIdentity.titleFacets[0].id,
            Name: 'General Operations',
            TotalCount: 1,
          }],
        },
      )),
      { pageSize: 1 },
      'facet_label_mismatch',
    ],
    [
      'duplicate stable ID in one slice',
      async () => jsonResponse(oracleListEnvelope(
        [
          oracleRequisition('210000001', 'Finance'),
          oracleRequisition('210000001', 'Finance'),
        ],
        0,
        2,
        { Limit: 2 },
      )),
      { pageSize: 2 },
      'duplicate_id',
    ],
    [
      'page cap',
      async () => jsonResponse(oracleListEnvelope(
        [oracleRequisition('210000001', 'Finance')],
        0,
        2,
      )),
      { pageSize: 1, maxPages: 1 },
      'page_cap_exceeded',
    ],
    [
      'job cap',
      async () => jsonResponse(oracleListEnvelope(
        [oracleRequisition('210000001', 'Finance')],
        0,
        2,
      )),
      { pageSize: 1, maxJobs: 1 },
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
      { ...options, now: () => 0, wallClockNow: () => ORACLE_NOW },
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
    const providerFetch = oracleFetch(overrides)
    const observation = await pollJpmorganOracleRecruiting(
      oracleIdentity,
      providerFetch,
      { pageSize: 1, now: () => 0, wallClockNow: () => ORACLE_NOW },
    )
    expect(observation).toMatchObject({
      jobs: [],
      credibleForClosure: false,
      allowMissingClosure: false,
      warnings: [warning],
    })
  })

  it.each([
    ['stale list date', '2026-07-19', 'provider_schema_invalid'],
    ['future list date', '2026-07-27', 'provider_schema_invalid'],
    ['malformed list date', 'not-a-date', 'provider_schema_invalid'],
    ['missing list date', null, 'provider_schema_invalid'],
  ])('rejects %s before detail hydration', async (
    _name,
    postedDate,
    warning,
  ) => {
    const observation = await pollJpmorganOracleRecruiting(
      oracleIdentity,
      async () => jsonResponse(oracleListEnvelope(
        [oracleRequisition('210000001', 'Finance', postedDate)],
        0,
        1,
      )),
      { pageSize: 1, now: () => 0, wallClockNow: () => ORACLE_NOW },
    )
    expect(observation).toMatchObject({
      credibleForClosure: false,
      allowMissingClosure: false,
      warnings: [warning],
    })
  })

  it.each([
    ['stale detail date', { ExternalPostedStartDate: '2026-07-19' }, 'detail_posting_date_ineligible'],
    ['future detail date', { ExternalPostedStartDate: '2026-07-27' }, 'detail_posting_date_ineligible'],
    ['malformed detail date', { ExternalPostedStartDate: 'not-a-date' }, 'detail_posting_date_ineligible'],
    ['detail title drift', { Title: 'Different title' }, 'detail_evidence_missing'],
    ['detail location drift', { PrimaryLocation: 'Chicago, IL, United States' }, 'detail_evidence_missing'],
  ])('rejects %s with closure disabled', async (_name, overrides, warning) => {
    const observation = await pollJpmorganOracleRecruiting(
      oracleIdentity,
      oracleFetch(overrides),
      { pageSize: 1, now: () => 0, wallClockNow: () => ORACLE_NOW },
    )
    expect(observation).toMatchObject({
      credibleForClosure: false,
      allowMissingClosure: false,
      warnings: [warning],
    })
  })

  it.each([
    ['selected title drift', { SelectedTitlesFacet: 'RSK' }, 'slice_identity_mismatch'],
    ['selected date drift', { SelectedPostingDatesFacet: '30' }, 'slice_identity_mismatch'],
    [
      'posting facet label drift',
      {
        postingDatesFacet: [{
          Id: oracleIdentity.postingDateFacet.id,
          Name: 'Less than 30 days',
          TotalCount: 1,
        }],
      },
      'facet_label_mismatch',
    ],
  ])('rejects %s', async (_name, overrides, warning) => {
    const observation = await pollJpmorganOracleRecruiting(
      oracleIdentity,
      async () => jsonResponse(oracleListEnvelope(
        [oracleRequisition('210000001', 'Finance')],
        0,
        1,
        overrides,
      )),
      { pageSize: 1, now: () => 0, wallClockNow: () => ORACLE_NOW },
    )
    expect(observation.warnings).toEqual([warning])
    expect(observation.allowMissingClosure).toBe(false)
  })

  it('rejects duplicate IDs whose family drifts across slices', async () => {
    const observation = await pollJpmorganOracleRecruiting(
      oracleIdentity,
      async (input) => {
        const finder = oracleFinder(new URL(String(input)))
        const facet = oracleIdentity.titleFacets.find(
          (candidate) => candidate.id === finder.selectedTitlesFacet,
        ) ?? oracleIdentity.titleFacets[0]
        return jsonResponse(oracleListEnvelope(
          [oracleRequisition('210000001', facet.expectedLabel)],
          0,
          1,
          {},
          facet,
        ))
      },
      { pageSize: 1, now: () => 0, wallClockNow: () => ORACLE_NOW },
    )
    expect(observation.warnings).toEqual(['cross_slice_id_drift'])
    expect(observation.allowMissingClosure).toBe(false)
  })

  it('bounds detail requests and rejects empty slices without activation evidence', async () => {
    const capped = await pollJpmorganOracleRecruiting(
      oracleIdentity,
      oracleFetch(),
      { maxDetailRequests: 1, now: () => 0, wallClockNow: () => ORACLE_NOW },
    )
    expect(capped.warnings).toEqual(['detail_cap_exceeded'])
    expect(capped.allowMissingClosure).toBe(false)

    const empty = await pollJpmorganOracleRecruiting(
      oracleIdentity,
      async (input) => {
        const finder = oracleFinder(new URL(String(input)))
        const facet = oracleIdentity.titleFacets.find(
          (candidate) => candidate.id === finder.selectedTitlesFacet,
        ) ?? oracleIdentity.titleFacets[0]
        return jsonResponse(oracleListEnvelope([], 0, 0, {}, facet))
      },
      { pageSize: 1, now: () => 0, wallClockNow: () => ORACLE_NOW },
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

const goldmanIdentity = resolveBrandedIdentity(
  GOLDMAN_HIGHER_SOURCE_KEY,
) as GoldmanHigherBrandedIdentity
const GOLDMAN_NOW = Date.parse('2026-07-27T12:00:00.000Z')
const GOLDMAN_BOUNDARY = '2026-06-27T12:00:00.000Z'

const goldmanRole = (
  roleId: string,
  sourceId: string,
  jobFunction = 'Credit Risk',
  division = 'Risk Division',
  country = 'United States',
  startDate: unknown = '2026-07-24T12:00:00.000Z',
) => ({
  roleId,
  corporateTitle: 'Associate',
  jobTitle: `Risk Engineer ${roleId}`,
  jobFunction,
  locations: [{
    primary: true,
    state: 'NY',
    country,
    city: 'New York',
  }],
  status: 'POSTED',
  externalJobStatus: 'POSTED',
  startDate,
  division,
  skills: ['Risk systems'],
  jobType: null,
  externalSource: { sourceId, externalSourceType: 'ORACLE' },
})

const goldmanDetail = (
  roleId: string,
  sourceId: string,
  overrides: Record<string, unknown> = {},
) => ({
  roleId,
  corporateTitle: 'Associate',
  jobTitle: `Risk Engineer ${roleId}`,
  jobFunction: 'Credit Risk',
  locations: [{
    primary: true,
    state: 'NY',
    country: 'United States',
    city: 'New York',
  }],
  division: 'Risk Division',
  descriptionHtml: `<p>Build risk technology for ${roleId}.</p>`,
  startDate: '2026-07-24T12:00:00.000Z',
  recruitingType: 'GS_MID_CAREER',
  jobType: null,
  skillset: ['Risk systems'],
  compensation: null,
  applyActive: true,
  status: 'POSTED',
  externalJobStatus: 'POSTED',
  externalSource: {
    externalApplicationUrl:
      `https://hdpc.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/LateralHiring/job/${sourceId}/apply/email`,
    applyInExternalSource: true,
    sourceId,
    secondarySourceId: `secondary-${sourceId}`,
    externalSourceType: 'ORACLE',
  },
  ...overrides,
})

interface GraphqlRequest {
  operationName: string
  query: string
  variables: Record<string, unknown>
}

async function graphqlBody(init?: RequestInit): Promise<GraphqlRequest> {
  return JSON.parse(String(init?.body)) as GraphqlRequest
}

function goldmanListEnvelope(
  items: unknown[],
  pageNumber: number,
  pageSize: number,
  totalCount = items.length,
  overrides: Record<string, unknown> = {},
) {
  return {
    data: {
      roleSearch: {
        page: {
          pageSize,
          pageNumber,
          hasNext: pageNumber * pageSize + items.length < totalCount,
        },
        totalCount,
        items,
        ...overrides,
      },
    },
  }
}

function goldmanFetch(
  slices: Record<'EARLY_CAREER' | 'PROFESSIONAL', ReturnType<typeof goldmanRole>[]> = {
    EARLY_CAREER: [
      goldmanRole(
        'gs-role-1',
        '177001',
        'Credit Risk',
        'Risk Division',
        'United States',
        '2026-07-24T12:00:00.000Z',
      ),
    ],
    PROFESSIONAL: [
      goldmanRole(
        'gs-role-2',
        '177002',
        'Technology',
        'Engineering Division',
        'United States',
        '2026-07-25T12:00:00.000Z',
      ),
    ],
  },
) {
  return vi.fn(async (
    _input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const request = await graphqlBody(init)
    if (request.operationName === 'GetRoles') {
      const input = request.variables.searchQueryInput as {
        page: { pageNumber: number; pageSize: number }
        experiences: ['EARLY_CAREER'] | ['PROFESSIONAL']
      }
      const roles = slices[input.experiences[0]]
      const start = input.page.pageNumber * input.page.pageSize
      const items = roles.slice(start, start + input.page.pageSize)
      return jsonResponse({
        data: {
          roleSearch: {
            page: {
              pageSize: input.page.pageSize,
              pageNumber: input.page.pageNumber,
              hasNext: start + items.length < roles.length,
            },
            totalCount: roles.length,
            items,
          },
        },
      })
    }
    const sourceId = String(request.variables.externalSourceId)
    const listed = Object.values(slices).flat().find(
      (role) => role.externalSource.sourceId === sourceId,
    )
    return jsonResponse({
      data: {
        role: goldmanDetail(listed?.roleId ?? '', sourceId, {
          jobFunction: listed?.jobFunction,
          division: listed?.division,
          startDate: listed?.startDate,
          recruitingType: listed?.roleId === 'gs-role-1'
            || slices.EARLY_CAREER.includes(listed!)
            ? 'GS_EARLY_CAREER'
            : 'GS_MID_CAREER',
        }),
      },
    })
  })
}

function oneGoldmanRole(
  role: ReturnType<typeof goldmanRole>,
  experience: 'EARLY_CAREER' | 'PROFESSIONAL' = 'PROFESSIONAL',
) {
  return {
    EARLY_CAREER: experience === 'EARLY_CAREER' ? [role] : [],
    PROFESSIONAL: experience === 'PROFESSIONAL' ? [role] : [],
  }
}

describe('Goldman Higher adapter', () => {
  it('reconciles Early Career and Professional independently before hydrating the selected union', async () => {
    const providerFetch = goldmanFetch()
    const observation = await pollGoldmanHigher(
      goldmanIdentity,
      providerFetch,
      {
        pageSize: 1,
        now: () => 0,
        wallClockNow: () => GOLDMAN_NOW,
      },
    )

    expect(observation).toMatchObject({
      completeness: 'complete',
      credibleForClosure: true,
      allowMissingClosure: false,
      expectedCount: 2,
      pageCount: 2,
      warnings: [],
      jobs: [
        {
          source: 'goldman_higher',
          externalId: 'gs-role-1',
          title: 'Risk Engineer gs-role-1',
          location: 'New York, NY, United States',
          companyName: 'Goldman Sachs',
          postedAt: '2026-07-24T12:00:00.000Z',
          absoluteUrl:
            'https://hdpc.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/LateralHiring/job/177001/apply/email',
          snapshotPartial: false,
          scopeEvidence: {
            sourceKey: GOLDMAN_HIGHER_SOURCE_KEY,
            selectionMode: 'recent_exact_us_provider_category',
            recentHours: 720,
            providerSourceId: '177001',
            providerCategoryField: 'jobFunction',
            providerCategoryLabel: 'credit risk',
            matchedTerm: 'Risk',
            detailCountryCode: 'US',
            postedAt: '2026-07-24T12:00:00.000Z',
            recruitingType: 'GS_EARLY_CAREER',
            externalIdDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
          },
        },
        {
          source: 'goldman_higher',
          externalId: 'gs-role-2',
          scopeEvidence: { matchedTerm: 'Technology' },
        },
      ],
      scopeEvidence: {
        sourceKey: GOLDMAN_HIGHER_SOURCE_KEY,
        selectionMode: 'recent_exact_us_provider_category',
        recentHours: 720,
        sliceDigests: [
          expect.stringMatching(/^[a-f0-9]{64}$/),
          expect.stringMatching(/^[a-f0-9]{64}$/),
        ],
        jobDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        categoryDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        countryDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        freshnessDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        applicationDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    })

    expect(providerFetch).toHaveBeenCalledTimes(4)
    const requests = await Promise.all(providerFetch.mock.calls.map(
      async ([input, init]) => ({
        url: new URL(String(input)),
        init,
        body: await graphqlBody(init),
      }),
    ))
    expect(requests.every(({ url }) =>
      url.origin === goldmanIdentity.origin
      && url.pathname === goldmanIdentity.graphqlPath
    )).toBe(true)
    expect(requests.every(({ init }) =>
      init?.method === 'POST'
      && init?.redirect === 'error'
      && new Headers(init.headers).get('content-type') === 'application/json'
    )).toBe(true)

    const lists = requests.filter(({ body }) =>
      body.operationName === goldmanIdentity.listOperation
    )
    expect(lists).toHaveLength(2)
    expect(lists.map(({ body }) =>
      (body.variables.searchQueryInput as {
        experiences: string[]
      }).experiences
    )).toEqual([['EARLY_CAREER'], ['PROFESSIONAL']])
    for (const { body } of lists) {
      expect(body.query).toContain('query GetRoles(')
      expect(body.query).toContain('roleSearch(searchQueryInput: $searchQueryInput)')
      expect(body.variables).toEqual({
        searchQueryInput: {
          page: { pageSize: 1, pageNumber: expect.any(Number) },
          filters: [],
          experiences: [expect.stringMatching(/^(EARLY_CAREER|PROFESSIONAL)$/)],
          searchTerm: '',
        },
      })
      expect(body.query).toContain('page {')
      expect(body.query).toContain('startDate')
      expect(body.query).not.toContain('lastPostedDate')
    }
    const details = requests.filter(({ body }) =>
      body.operationName === goldmanIdentity.detailOperation
    )
    expect(details).toHaveLength(2)
    expect(details.every(({ body }) =>
      body.query.includes('query GetRoleById(')
      && body.query.includes('recruitingType')
      && body.query.includes('externalSourceType')
      && body.variables.externalSourceFetch === true
    )).toBe(true)
  })

  it('accepts the exact inclusive 720-hour boundary and preserves division evidence', async () => {
    const role = goldmanRole(
      'gs-boundary',
      '177010',
      '',
      'Capital Markets Technology',
      'United States',
      GOLDMAN_BOUNDARY,
    )
    const observation = await pollGoldmanHigher(
      goldmanIdentity,
      goldmanFetch(oneGoldmanRole(role, 'EARLY_CAREER')),
      {
        now: () => 0,
        wallClockNow: () => GOLDMAN_NOW,
      },
    )

    expect(observation).toMatchObject({
      completeness: 'complete',
      credibleForClosure: true,
      allowMissingClosure: false,
      jobs: [{
        postedAt: GOLDMAN_BOUNDARY,
        scopeEvidence: {
          providerCategoryField: 'division',
          providerCategoryLabel: 'capital markets technology',
          matchedTerm: 'Capital Markets',
          recruitingType: 'GS_EARLY_CAREER',
        },
      }],
    })
  })

  it('deduplicates only after both population slices independently reconcile', async () => {
    const role = goldmanRole('gs-shared', '177020')
    const observation = await pollGoldmanHigher(
      goldmanIdentity,
      goldmanFetch({
        EARLY_CAREER: [role],
        PROFESSIONAL: [{ ...role }],
      }),
      { now: () => 0, wallClockNow: () => GOLDMAN_NOW },
    )

    expect(observation).toMatchObject({
      completeness: 'complete',
      expectedCount: 1,
      pageCount: 2,
      allowMissingClosure: false,
      scopeEvidence: {
        sliceDigests: [
          expect.stringMatching(/^[a-f0-9]{64}$/),
          expect.stringMatching(/^[a-f0-9]{64}$/),
        ],
      },
    })
    expect(observation.jobs).toHaveLength(1)
  })

  it('rejects cross-population identity drift after each slice reconciles', async () => {
    const role = goldmanRole('gs-shared', '177021')
    const observation = await pollGoldmanHigher(
      goldmanIdentity,
      goldmanFetch({
        EARLY_CAREER: [role],
        PROFESSIONAL: [{
          ...role,
          jobTitle: 'Drifted title',
        }],
      }),
      { now: () => 0, wallClockNow: () => GOLDMAN_NOW },
    )

    expect(observation).toMatchObject({
      jobs: [],
      credibleForClosure: false,
      allowMissingClosure: false,
      warnings: ['cross_slice_id_drift'],
    })
  })

  it.each([
    ['page number', { pageNumber: 1 }, 'page_number_mismatch'],
    ['page size', { pageSize: 99 }, 'page_size_mismatch'],
    ['hasNext', { hasNext: true }, 'page_metadata_mismatch'],
  ])('rejects %s metadata drift independently', async (
    _name,
    pageOverride,
    warning,
  ) => {
    const role = goldmanRole('gs-page', '177022')
    const providerFetch = vi.fn(async (
      _input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const request = await graphqlBody(init)
      const input = request.variables.searchQueryInput as {
        page: { pageNumber: number; pageSize: number }
      }
      return jsonResponse({
        data: {
          roleSearch: {
            page: {
              pageSize: input.page.pageSize,
              pageNumber: input.page.pageNumber,
              hasNext: false,
              ...pageOverride,
            },
            totalCount: 1,
            items: [role],
          },
        },
      })
    })
    const observation = await pollGoldmanHigher(
      goldmanIdentity,
      providerFetch,
      { now: () => 0, wallClockNow: () => GOLDMAN_NOW },
    )

    expect(observation).toMatchObject({
      jobs: [],
      credibleForClosure: false,
      allowMissingClosure: false,
      warnings: [warning],
    })
  })

  it('filters unprovable list dates before ingesting recent roles', async () => {
    const stale = goldmanRole(
      'gs-stale',
      '177011',
      'Risk',
      '',
      'United States',
      '2026-06-27T11:59:59.999Z',
    )
    const recent = goldmanRole(
      'gs-recent',
      '177012',
      'Finance',
      '',
      'United States',
      '2026-07-24T12:00:00.000Z',
    )
    const future = goldmanRole(
      'gs-future',
      '177013',
      'Risk',
      '',
      'United States',
      '2026-07-27T12:00:00.001Z',
    )
    const malformed = goldmanRole(
      'gs-malformed',
      '177014',
      'Risk',
      '',
      'United States',
      'not-a-date',
    )
    const missing = goldmanRole(
      'gs-missing',
      '177015',
      'Risk',
      '',
      'United States',
      null,
    )
    const providerFetch = goldmanFetch({
      EARLY_CAREER: [],
      PROFESSIONAL: [stale, future, malformed, missing, recent],
    })
    const observation = await pollGoldmanHigher(
      goldmanIdentity,
      providerFetch,
      { now: () => 0, wallClockNow: () => GOLDMAN_NOW },
    )

    expect(observation).toMatchObject({
      completeness: 'complete',
      credibleForClosure: true,
      allowMissingClosure: false,
      expectedCount: 1,
      warnings: [],
      jobs: [{ externalId: 'gs-recent' }],
    })
    expect(providerFetch.mock.calls.filter(([, init]) =>
      String(init?.body).includes('"operationName":"GetRoleById"')
    )).toHaveLength(1)
  })

  it('keeps complete details while excluding incomplete selected roles', async () => {
    const valid = goldmanRole('gs-valid-detail', '177016')
    const invalid = goldmanRole('gs-invalid-detail', '177017')
    const baseFetch = goldmanFetch({
      EARLY_CAREER: [],
      PROFESSIONAL: [valid, invalid],
    })
    const providerFetch = vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const request = await graphqlBody(init)
      const response = await baseFetch(input, init)
      if (request.operationName !== 'GetRoleById') return response
      const payload = await response.json() as {
        data: { role: Record<string, unknown> }
      }
      if (request.variables.externalSourceId === '177016') {
        payload.data.role.descriptionHtml =
          '<p>Line one.</p>\n\t<p>Line two.</p>\r\n'
      } else {
        payload.data.role.recruitingType = 'CAMPUS'
      }
      return jsonResponse(payload)
    })

    const observation = await pollGoldmanHigher(
      goldmanIdentity,
      providerFetch,
      { now: () => 0, wallClockNow: () => GOLDMAN_NOW },
    )

    expect(observation).toMatchObject({
      completeness: 'complete',
      credibleForClosure: true,
      allowMissingClosure: false,
      expectedCount: 1,
      warnings: [],
      jobs: [{
        externalId: 'gs-valid-detail',
        descriptionHtml: '<p>Line one.</p>\n\t<p>Line two.</p>',
      }],
    })
  })

  it.each([
    ['detail startDate drift', { startDate: '2026-07-24T12:00:00.001Z' }, 'detail_posting_date_mismatch'],
    ['missing recruiting type', { recruitingType: null }, 'detail_population_ineligible'],
    ['unrequested recruiting type', { recruitingType: 'CAMPUS' }, 'detail_population_ineligible'],
    ['external status drift', { externalJobStatus: 'UNPOSTED' }, 'detail_evidence_missing'],
    [
      'external source drift',
      {
        externalSource: {
          externalApplicationUrl:
            'https://hdpc.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/LateralHiring/job/177012/apply/email',
          applyInExternalSource: true,
          sourceId: '177012',
          secondarySourceId: 'secondary-177012',
          externalSourceType: 'OTHER',
        },
      },
      'detail_evidence_missing',
    ],
  ])('rejects %s with selective closure disabled', async (
    _name,
    overrides,
    warning,
  ) => {
    const role = goldmanRole('gs-detail', '177012')
    const providerFetch = goldmanFetch(oneGoldmanRole(role))
    providerFetch.mockImplementation(async (
      _input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const request = await graphqlBody(init)
      if (request.operationName === 'GetRoles') {
        const input = request.variables.searchQueryInput as {
          page: { pageNumber: number; pageSize: number }
          experiences: ['EARLY_CAREER'] | ['PROFESSIONAL']
        }
        const roles = oneGoldmanRole(role)[input.experiences[0]]
        const start = input.page.pageNumber * input.page.pageSize
        const items = roles.slice(start, start + input.page.pageSize)
        return jsonResponse({
          data: {
            roleSearch: {
              page: {
                pageSize: input.page.pageSize,
                pageNumber: input.page.pageNumber,
                hasNext: start + items.length < roles.length,
              },
              totalCount: roles.length,
              items,
            },
          },
        })
      }
      return jsonResponse({
        data: {
          role: goldmanDetail('gs-detail', '177012', overrides),
        },
      })
    })

    const observation = await pollGoldmanHigher(
      goldmanIdentity,
      providerFetch,
      {
        now: () => 0,
        wallClockNow: () => GOLDMAN_NOW,
      },
    )
    expect(observation).toMatchObject({
      jobs: [],
      credibleForClosure: false,
      allowMissingClosure: false,
      warnings: [warning],
    })
  })

  it.each([
    '?redirect=https://attacker.example',
    '/extra',
    '#fragment',
  ])('rejects same-host Oracle Apply URL suffix %s', async (suffix) => {
    const role = goldmanRole('gs-apply', '177013')
    const providerFetch = goldmanFetch(oneGoldmanRole(role))
    const exact =
      'https://hdpc.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/LateralHiring/job/177013/apply/email'
    providerFetch.mockImplementation(async (
      _input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const request = await graphqlBody(init)
      if (request.operationName === 'GetRoles') {
        const input = request.variables.searchQueryInput as {
          page: { pageNumber: number; pageSize: number }
          experiences: ['EARLY_CAREER'] | ['PROFESSIONAL']
        }
        const roles = oneGoldmanRole(role)[input.experiences[0]]
        return jsonResponse({
          data: {
            roleSearch: {
              page: {
                pageSize: input.page.pageSize,
                pageNumber: input.page.pageNumber,
                hasNext: false,
              },
              totalCount: roles.length,
              items: roles,
            },
          },
        })
      }
      return jsonResponse({
        data: {
          role: goldmanDetail('gs-apply', '177013', {
            externalSource: {
              externalApplicationUrl: `${exact}${suffix}`,
              applyInExternalSource: true,
              sourceId: '177013',
              secondarySourceId: 'secondary-177013',
              externalSourceType: 'ORACLE',
            },
          }),
        },
      })
    })

    const observation = await pollGoldmanHigher(
      goldmanIdentity,
      providerFetch,
      { now: () => 0, wallClockNow: () => GOLDMAN_NOW },
    )
    expect(observation).toMatchObject({
      jobs: [],
      allowMissingClosure: false,
      warnings: ['detail_evidence_missing'],
    })
  })

  it('rejects caller-selected operation, variables, host, and path before fetch', async () => {
    const providerFetch = vi.fn()
    const drifted = {
      ...goldmanIdentity,
      graphqlPath: '/attacker',
      listOperation: 'AttackerQuery',
    } as unknown as GoldmanHigherBrandedIdentity
    const observation = await pollGoldmanHigher(drifted, providerFetch)
    expect(providerFetch).not.toHaveBeenCalled()
    expect(observation.warnings).toEqual(['invalid_identity'])
    expect(pollGoldmanHigher.length).toBeLessThanOrEqual(3)
  })

  it.each([
    [
      'GraphQL errors',
      async () => jsonResponse({
        errors: [{ message: 'private upstream detail' }],
        data: null,
      }),
      {},
      'graphql_error',
    ],
    [
      'non-JSON response',
      async () => new Response('<html>challenge</html>', {
        headers: { 'content-type': 'text/html' },
      }),
      {},
      'invalid_content_type',
    ],
    [
      'count drift',
      async (
        _input: string | URL | Request,
        init?: RequestInit,
      ) => {
        const request = await graphqlBody(init)
        const input = request.variables.searchQueryInput as {
          page: { pageNumber: number; pageSize: number }
          experiences: ['EARLY_CAREER'] | ['PROFESSIONAL']
        }
        if (input.experiences[0] === 'PROFESSIONAL') {
          return jsonResponse(goldmanListEnvelope(
            [],
            input.page.pageNumber,
            input.page.pageSize,
            0,
          ))
        }
        return jsonResponse(goldmanListEnvelope(
          [goldmanRole(
            `gs-${input.page.pageNumber}`,
            `17700${input.page.pageNumber + 1}`,
          )],
          input.page.pageNumber,
          input.page.pageSize,
          input.page.pageNumber === 0 ? 2 : 3,
        ))
      },
      { pageSize: 1 },
      'count_mismatch',
    ],
    [
      'duplicate role ID',
      async (_input: string | URL | Request, init?: RequestInit) => {
        const request = await graphqlBody(init)
        const input = request.variables.searchQueryInput as {
          page: { pageNumber: number; pageSize: number }
        }
        return jsonResponse(goldmanListEnvelope(
          [
            goldmanRole('gs-role-1', '177001'),
            goldmanRole('gs-role-1', '177002'),
          ],
          input.page.pageNumber,
          input.page.pageSize,
          2,
        ))
      },
      {},
      'duplicate_id',
    ],
    [
      'duplicate source ID',
      async (_input: string | URL | Request, init?: RequestInit) => {
        const request = await graphqlBody(init)
        const input = request.variables.searchQueryInput as {
          page: { pageNumber: number; pageSize: number }
        }
        return jsonResponse(goldmanListEnvelope(
          [
            goldmanRole('gs-role-1', '177001'),
            goldmanRole('gs-role-2', '177001'),
          ],
          input.page.pageNumber,
          input.page.pageSize,
          2,
        ))
      },
      {},
      'duplicate_source_id',
    ],
    [
      'page cap',
      async (
        _input: string | URL | Request,
        init?: RequestInit,
      ) => {
        const request = await graphqlBody(init)
        const input = request.variables.searchQueryInput as {
          page: { pageNumber: number; pageSize: number }
        }
        return jsonResponse(goldmanListEnvelope(
          [goldmanRole(
            `gs-${input.page.pageNumber}`,
            `17700${input.page.pageNumber + 1}`,
          )],
          input.page.pageNumber,
          input.page.pageSize,
          2,
        ))
      },
      { pageSize: 1, maxPages: 1 },
      'page_cap_exceeded',
    ],
    [
      'job cap',
      async (_input: string | URL | Request, init?: RequestInit) => {
        const request = await graphqlBody(init)
        const input = request.variables.searchQueryInput as {
          page: { pageNumber: number; pageSize: number }
        }
        return jsonResponse(goldmanListEnvelope(
          [
            goldmanRole('gs-role-1', '177001'),
            goldmanRole('gs-role-2', '177002'),
          ],
          input.page.pageNumber,
          input.page.pageSize,
          2,
        ))
      },
      { maxJobs: 1 },
      'job_cap_exceeded',
    ],
  ])('fails closed on %s without leaking provider payloads', async (
    _name,
    providerFetch,
    options,
    warning,
  ) => {
    const observation = await pollGoldmanHigher(
      goldmanIdentity,
      providerFetch,
      { ...options, now: () => 0, wallClockNow: () => GOLDMAN_NOW },
    )
    expect(observation).toMatchObject({
      credibleForClosure: false,
      allowMissingClosure: false,
      warnings: [warning],
    })
    expect(JSON.stringify(observation)).not.toContain('private upstream detail')
    expect(observation.warnings[0].length).toBeLessThanOrEqual(64)
  })

  it.each([
    [
      'missing trusted category',
      goldmanRole('gs-role-1', '177001', '', ''),
      'category_evidence_missing',
    ],
    [
      'zero allowed category',
      goldmanRole('gs-role-1', '177001', 'Human Resources', 'Operations'),
      'zero_eligible_jobs',
    ],
    [
      'zero U.S. scope',
      goldmanRole(
        'gs-role-1',
        '177001',
        'Credit Risk',
        'Risk Division',
        'United Kingdom',
      ),
      'zero_eligible_jobs',
    ],
  ])('preserves the admission fence for %s', async (
    _name,
    role,
    warning,
  ) => {
    const observation = await pollGoldmanHigher(
      goldmanIdentity,
      goldmanFetch(oneGoldmanRole(role)),
      { now: () => 0, wallClockNow: () => GOLDMAN_NOW },
    )
    expect(observation).toMatchObject({
      jobs: [],
      completeness: 'unknown',
      credibleForClosure: false,
      allowMissingClosure: false,
      expectedCount: 0,
      warnings: [warning],
    })
  })

  it.each([
    [
      'detail country drift',
      {
        locations: [{
          primary: true,
          state: 'London',
          country: 'United Kingdom',
          city: 'London',
        }],
      },
      'detail_country_ineligible',
    ],
    [
      'detail category drift',
      { jobFunction: 'Operations', division: 'Operations' },
      'detail_category_ineligible',
    ],
    [
      'selected category field drift',
      { jobFunction: '', division: 'Credit Risk' },
      'detail_category_ineligible',
    ],
    [
      'detail title drift',
      { jobTitle: 'Different title' },
      'detail_evidence_missing',
    ],
    [
      'detail location drift',
      {
        locations: [{
          primary: true,
          state: 'IL',
          country: 'United States',
          city: 'Chicago',
        }],
      },
      'detail_evidence_missing',
    ],
    [
      'missing description',
      { descriptionHtml: '' },
      'detail_evidence_missing',
    ],
    [
      'unsafe apply URL',
      {
        externalSource: {
          externalApplicationUrl: 'https://attacker.example/apply',
          applyInExternalSource: true,
          sourceId: '177001',
          secondarySourceId: 'secondary-177001',
        },
      },
      'detail_evidence_missing',
    ],
    [
      'detail role ID drift',
      { roleId: 'gs-other' },
      'detail_id_mismatch',
    ],
  ])('rejects %s and retains no unproven row', async (
    _name,
    overrides,
    warning,
  ) => {
    const role = goldmanRole('gs-role-1', '177001')
    const providerFetch = vi.fn(async (
      _input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const request = await graphqlBody(init)
      if (request.operationName === 'GetRoles') {
        const input = request.variables.searchQueryInput as {
          page: { pageNumber: number; pageSize: number }
          experiences: ['EARLY_CAREER'] | ['PROFESSIONAL']
        }
        const roles = oneGoldmanRole(role)[input.experiences[0]]
        return jsonResponse(goldmanListEnvelope(
          roles,
          input.page.pageNumber,
          input.page.pageSize,
          roles.length,
        ))
      }
      return jsonResponse({
        data: {
          role: goldmanDetail('gs-role-1', '177001', overrides),
        },
      })
    })
    const observation = await pollGoldmanHigher(
      goldmanIdentity,
      providerFetch,
      { now: () => 0, wallClockNow: () => GOLDMAN_NOW },
    )
    expect(observation).toMatchObject({
      jobs: [],
      credibleForClosure: false,
      allowMissingClosure: false,
      warnings: [warning],
    })
  })

  it('enforces detail and deadline caps before scheduling excess work', async () => {
    const detailCap = await pollGoldmanHigher(
      goldmanIdentity,
      goldmanFetch(),
      {
        maxDetailRequests: 1,
        now: () => 0,
        wallClockNow: () => GOLDMAN_NOW,
      },
    )
    expect(detailCap.warnings).toEqual(['detail_cap_exceeded'])
    expect(detailCap.allowMissingClosure).toBe(false)

    let nowMs = 0
    const providerFetch = goldmanFetch()
    providerFetch.mockImplementationOnce(async (
      _input: string | URL | Request,
      init?: RequestInit,
    ) => {
      nowMs = 100
      const request = await graphqlBody(init)
      expect(request.operationName).toBe('GetRoles')
      return jsonResponse(goldmanListEnvelope(
        [goldmanRole('gs-role-1', '177001')],
        0,
        100,
        1,
      ))
    })
    const deadline = await pollGoldmanHigher(
      goldmanIdentity,
      providerFetch,
      {
        totalDurationMs: 50,
        now: () => nowMs,
        wallClockNow: () => GOLDMAN_NOW,
      },
    )
    expect(providerFetch).toHaveBeenCalledTimes(1)
    expect(deadline.warnings).toEqual(['deadline_exceeded'])
  })
})

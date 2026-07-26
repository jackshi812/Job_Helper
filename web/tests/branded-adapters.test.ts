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
        { Limit: Number(finder.limit) },
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
      { pageSize: 1 },
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
        { Limit: 2 },
      )),
      { pageSize: 2 },
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
      { pageSize: 1, now: () => 0 },
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
      { pageSize: 1, now: () => 0 },
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

const goldmanRole = (
  roleId: string,
  sourceId: string,
  jobFunction = 'Credit Risk',
  division = 'Risk Division',
  country = 'United States',
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
  division,
  skills: ['Risk systems'],
  jobType: null,
  externalSource: { sourceId },
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
  jobType: null,
  skillset: ['Risk systems'],
  compensation: null,
  applyActive: true,
  status: 'POSTED',
  externalSource: {
    externalApplicationUrl:
      `https://hdpc.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/LateralHiring/job/${sourceId}/apply/email`,
    applyInExternalSource: true,
    sourceId,
    secondarySourceId: `secondary-${sourceId}`,
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

function goldmanFetch(
  roles = [
    goldmanRole('gs-role-1', '177001', 'Credit Risk'),
    goldmanRole('gs-role-2', '177002', 'Technology', 'Engineering Division'),
  ],
) {
  return vi.fn(async (
    _input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const request = await graphqlBody(init)
    if (request.operationName === 'GetRoles') {
      const input = request.variables.searchQueryInput as {
        page: { pageNumber: number; pageSize: number }
      }
      const start = input.page.pageNumber * input.page.pageSize
      return jsonResponse({
        data: {
          roleSearch: {
            totalCount: roles.length,
            items: roles.slice(start, start + input.page.pageSize),
          },
        },
      })
    }
    const sourceId = String(request.variables.externalSourceId)
    const listed = roles.find((role) =>
      role.externalSource.sourceId === sourceId
    )
    return jsonResponse({
      data: {
        role: goldmanDetail(listed?.roleId ?? '', sourceId),
      },
    })
  })
}

describe('Goldman Higher adapter', () => {
  it('reconciles complete GraphQL pagination and admits only positive trusted U.S. category evidence', async () => {
    const providerFetch = goldmanFetch()
    const observation = await pollGoldmanHigher(
      goldmanIdentity,
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
          source: 'goldman_higher',
          externalId: 'gs-role-1',
          title: 'Risk Engineer gs-role-1',
          location: 'New York, NY, United States',
          companyName: 'Goldman Sachs',
          snapshotPartial: false,
          scopeEvidence: {
            sourceKey: GOLDMAN_HIGHER_SOURCE_KEY,
            providerCategoryLabel: 'credit risk',
            matchedTerm: 'Risk',
            detailCountryCode: 'US',
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
        sliceDigests: [expect.stringMatching(/^[a-f0-9]{64}$/)],
        categoryDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        countryDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
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
    expect(lists.map(({ body }) =>
      (body.variables.searchQueryInput as {
        page: { pageNumber: number }
      }).page.pageNumber
    )).toEqual([0, 1])
    for (const { body } of lists) {
      expect(body.query).toContain('query GetRoles(')
      expect(body.query).toContain('roleSearch(searchQueryInput: $searchQueryInput)')
      expect(body.variables).toEqual({
        searchQueryInput: {
          page: { pageSize: 1, pageNumber: expect.any(Number) },
          filters: [],
          experiences: ['EARLY_CAREER', 'PROFESSIONAL'],
          searchTerm: '',
        },
      })
    }
    const details = requests.filter(({ body }) =>
      body.operationName === goldmanIdentity.detailOperation
    )
    expect(details).toHaveLength(2)
    expect(details.every(({ body }) =>
      body.query.includes('query GetRoleById(')
      && body.variables.externalSourceFetch === true
    )).toBe(true)
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
          page: { pageNumber: number }
        }
        return jsonResponse({
          data: {
            roleSearch: {
              totalCount: input.page.pageNumber === 0 ? 2 : 3,
              items: [goldmanRole(
                `gs-${input.page.pageNumber}`,
                `17700${input.page.pageNumber}`,
              )],
            },
          },
        })
      },
      { pageSize: 1 },
      'count_mismatch',
    ],
    [
      'duplicate role ID',
      async () => jsonResponse({
        data: {
          roleSearch: {
            totalCount: 2,
            items: [
              goldmanRole('gs-role-1', '177001'),
              goldmanRole('gs-role-1', '177002'),
            ],
          },
        },
      }),
      {},
      'duplicate_id',
    ],
    [
      'duplicate source ID',
      async () => jsonResponse({
        data: {
          roleSearch: {
            totalCount: 2,
            items: [
              goldmanRole('gs-role-1', '177001'),
              goldmanRole('gs-role-2', '177001'),
            ],
          },
        },
      }),
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
          page: { pageNumber: number }
        }
        return jsonResponse({
          data: {
            roleSearch: {
              totalCount: 2,
              items: [goldmanRole(
                `gs-${input.page.pageNumber}`,
                `17700${input.page.pageNumber}`,
              )],
            },
          },
        })
      },
      { pageSize: 1, maxPages: 1 },
      'page_cap_exceeded',
    ],
    [
      'job cap',
      async () => jsonResponse({
        data: {
          roleSearch: {
            totalCount: 2,
            items: [
              goldmanRole('gs-role-1', '177001'),
              goldmanRole('gs-role-2', '177002'),
            ],
          },
        },
      }),
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
      { ...options, now: () => 0 },
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
      goldmanFetch([role]),
      { now: () => 0 },
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
      return request.operationName === 'GetRoles'
        ? jsonResponse({
          data: { roleSearch: { totalCount: 1, items: [role] } },
        })
        : jsonResponse({
          data: {
            role: goldmanDetail('gs-role-1', '177001', overrides),
          },
        })
    })
    const observation = await pollGoldmanHigher(
      goldmanIdentity,
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

  it('enforces detail and deadline caps before scheduling excess work', async () => {
    const detailCap = await pollGoldmanHigher(
      goldmanIdentity,
      goldmanFetch(),
      { maxDetailRequests: 1, now: () => 0 },
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
      return jsonResponse({
        data: {
          roleSearch: {
            totalCount: 1,
            items: [goldmanRole('gs-role-1', '177001')],
          },
        },
      })
    })
    const deadline = await pollGoldmanHigher(
      goldmanIdentity,
      providerFetch,
      { totalDurationMs: 50, now: () => nowMs },
    )
    expect(providerFetch).toHaveBeenCalledTimes(1)
    expect(deadline.warnings).toEqual(['deadline_exceeded'])
  })
})

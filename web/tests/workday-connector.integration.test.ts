import { describe, expect, it, vi } from 'vitest'
import {
  CAPITAL_ONE_WORKDAY_SOURCE_KEY,
  pollCapitalOneRecent,
  pollWorkday,
  pollWorkdayRecent,
  verifyWorkdayListing,
} from '../../supabase/functions/_shared/adapters/workday.ts'
import {
  resolveWorkdayIdentity,
  WORKDAY_IDENTITIES,
  type WorkdayIdentity,
} from '../../supabase/functions/_shared/workday-identities.ts'
import {
  pollConnector,
  providerRegistry,
  type SupportedDetection,
  verifyConnector,
} from '../../supabase/functions/_shared/connectors.ts'
import { detectAts } from '../../supabase/functions/_shared/detect.ts'
import { createVerifyBoardHandler } from '../../supabase/functions/verify-board/index.ts'
import catalogSql from '../../supabase/migrations/0013_source_coverage_catalog.sql?raw'
import migrationSql from '../../supabase/migrations/0016_workday_experimental.sql?raw'
import activationSql from '../../supabase/migrations/0029_paylocity_connector.sql?raw'
import normalizedTypesSource from '../../supabase/functions/_shared/adapters/types.ts?raw'

const sourceKey = 'workday:wd12:capitalone:Capital_One'
const boardUrl = 'https://capitalone.wd12.myworkdayjobs.com/Capital_One'
const listUrl = 'https://capitalone.wd12.myworkdayjobs.com/wday/cxs/capitalone/Capital_One/jobs'
const detailPath = '/job/Chicago-IL/Senior-Software-Engineer_R123456'

const listPosting = {
  title: 'Senior Software Engineer',
  externalPath: detailPath,
  locationsText: 'Chicago, IL',
  postedOn: 'Posted 2 Days Ago',
}

const detailPayload = {
  jobPostingInfo: {
    id: 'R123456',
    title: 'Senior Software Engineer',
    jobDescription: '<p>Build reliable financial systems.</p>',
    location: 'Chicago, IL',
    postedOn: 'Posted 2 Days Ago',
  },
}

function jsonResponse(payload: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json', ...init.headers },
    ...init,
  })
}

function categoryFacets(analysis: number, finance: number) {
  return [{
    facetParameter: 'jobFamilyGroup',
    values: [
      {
        descriptor: 'Analysis',
        id: 'a12c70bf789e105802e9caf800542991',
        count: analysis,
      },
      {
        descriptor: 'Finance',
        id: 'a12c70bf789e105802e9de2c3b5f29a3',
        count: finance,
      },
    ],
  }]
}

describe('Capital One Workday identity contract', () => {
  it('shares one byte-identical source key across the catalog and connector', () => {
    expect(CAPITAL_ONE_WORKDAY_SOURCE_KEY).toBe(sourceKey)
    expect(catalogSql).toContain(`'${sourceKey}'`)
    expect(catalogSql.match(new RegExp(sourceKey, 'g'))).toHaveLength(2)
    expect(migrationSql).toContain(`source_key = '${sourceKey}'`)
  })

  it('verifies only the fixed identity and returns every server-owned identity field', async () => {
    const detected = detectAts(boardUrl)
    expect(detected).toEqual({
      ats: 'workday',
      slug: 'capitalone',
      region: 'wd12',
      site: 'Capital_One',
      hostForm: 'jobs',
    })
    if (detected.ats === 'unsupported') throw new Error('expected Workday detection')

    const providerFetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ total: 1, jobPostings: [listPosting] }))
      .mockResolvedValueOnce(jsonResponse(detailPayload))
    await expect(verifyConnector(detected, providerFetch)).resolves.toEqual({
      ats: 'workday',
      boardToken: 'capitalone',
      region: 'wd12',
      siteToken: 'Capital_One',
      companyName: 'Capital One',
      jobCount: 1,
      careersUrl: boardUrl,
      sourceKey,
    })
    expect(providerFetch).toHaveBeenCalledTimes(1)
  })

  it('bounds manual verification to reconciled list pages without detail fan-out', async () => {
    const detected = detectAts(boardUrl)
    if (detected.ats === 'unsupported') throw new Error('expected Workday detection')
    const secondPosting = {
      ...listPosting,
      title: 'Data Engineer',
      externalPath: '/job/Chicago-IL/Data-Engineer_R654321',
    }
    const providerFetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { limit: number; offset: number }
      expect(body).toMatchObject({ appliedFacets: {}, limit: 20, searchText: '' })
      return body.offset === 0
        ? jsonResponse({ total: 2, jobPostings: [listPosting] })
        : jsonResponse({ total: 2, jobPostings: [secondPosting] })
    })

    await expect(verifyConnector(detected, providerFetch)).resolves.toMatchObject({
      jobCount: 2,
      sourceKey,
    })
    expect(providerFetch).toHaveBeenCalledTimes(2)
  })

  it('dispatches only the exact active Capital One identity', async () => {
    expect(Object.keys(providerRegistry).sort()).toEqual([
      'ashby',
      'greenhouse',
      'lever',
      'paylocity',
      'recruitee',
      'smartrecruiters',
      'workday',
    ])
    const providerFetch = vi.fn().mockResolvedValue(jsonResponse({
      total: 1,
      jobPostings: [listPosting],
      facets: categoryFacets(1, 0),
    }))
    vi.stubGlobal('fetch', providerFetch)
    await expect(pollConnector({
      ats_type: 'workday',
      board_token: 'capitalone',
      region: 'wd12',
      site_token: 'Capital_One',
      source_key: sourceKey,
      activation_state: 'active',
    }, new Set(['R123456']))).resolves.toMatchObject({
      completeness: 'complete',
      credibleForClosure: true,
      allowMissingClosure: false,
      jobs: [{ externalId: 'R123456', snapshotPartial: true }],
    })
    expect(providerFetch).toHaveBeenCalledTimes(1)

    await expect(pollConnector({
      ats_type: 'workday',
      board_token: 'other',
      region: 'wd12',
      site_token: 'Capital_One',
      source_key: sourceKey,
      activation_state: 'active',
    }, new Set())).rejects.toThrow('inactive_connector:workday_identity_not_allowed')
    vi.unstubAllGlobals()
  })

  it('keeps final database and source unions closed with Adzuna as jobs-only exception', () => {
    const companyCheck = activationSql.match(/companies_ats_type_check check \(([\s\S]*?)\n  \)/)?.[1] ?? ''
    const jobCheck = activationSql.match(/jobs_source_check check \(([\s\S]*?)\n  \)/)?.[1] ?? ''
    const direct = ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'recruitee', 'workday', 'paylocity']
    for (const provider of direct) {
      expect(normalizedTypesSource).toContain(`| '${provider}'`)
      expect(companyCheck).toContain(`'${provider}'`)
      expect(jobCheck).toContain(`'${provider}'`)
    }
    expect(jobCheck).toContain("'adzuna'")
    expect(companyCheck).not.toContain("'adzuna'")
    for (const unsupported of ['oracle', 'icims', 'successfactors', 'eightfold']) {
      expect(normalizedTypesSource.toLowerCase()).not.toContain(`'${unsupported}'`)
      expect(companyCheck.toLowerCase()).not.toContain(`'${unsupported}'`)
      expect(jobCheck.toLowerCase()).not.toContain(`'${unsupported}'`)
    }
    expect(activationSql).toMatch(/ats_type in \('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'recruitee', 'paylocity'\)/)
    expect(activationSql).not.toMatch(/insert into public\.companies/i)
  })

  it('records Workday drift against the exact existing source key', async () => {
    const updateEq = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn(() => ({ eq: updateEq }))
    const insert = vi.fn()
    const handler = createVerifyBoardHandler({
      createAuthClient: () => ({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'user-1', role: 'authenticated' } },
            error: null,
          }),
        },
      }),
      createServiceClient: () => ({
        from: vi.fn(() => ({ update, insert })),
      }),
      providerFetch: vi.fn().mockResolvedValue(
        new Response('<html>challenge</html>', {
          headers: { 'content-type': 'text/html' },
        }),
      ),
    })
    const response = await handler(new Request('https://example.test/functions/v1/verify-board', {
      method: 'POST',
      headers: {
        authorization: 'Bearer real-user-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ url: boardUrl }),
    }))

    expect(response.status).toBe(200)
    expect(update).toHaveBeenCalledWith({
      last_error: 'Manual verification failed.',
      last_error_code: 'invalid_content_type',
    })
    expect(updateEq).toHaveBeenCalledWith('source_key', sourceKey)
    expect(insert).not.toHaveBeenCalled()
  })
})

describe('bounded Capital One Workday observation', () => {
  it('reconciles fixed-body POST pages and sequential details into credible evidence', async () => {
    const secondPosting = {
      ...listPosting,
      title: 'Data Engineer',
      externalPath: '/job/Chicago-IL/Data-Engineer_R654321',
    }
    const secondDetail = {
      jobPostingInfo: {
        ...detailPayload.jobPostingInfo,
        id: 'R654321',
        title: 'Data Engineer',
      },
    }
    let active = 0
    let peak = 0
    const providerFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url === listUrl) {
        const body = JSON.parse(String(init?.body)) as { limit: number; offset: number }
        expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
        expect(body).toMatchObject({ appliedFacets: {}, limit: 1, searchText: '' })
        return body.offset === 0
          ? jsonResponse({ total: 2, jobPostings: [listPosting] })
          : jsonResponse({ total: 2, jobPostings: [secondPosting] })
      }

      active += 1
      peak = Math.max(peak, active)
      await Promise.resolve()
      active -= 1
      return url.endsWith(detailPath)
        ? jsonResponse(detailPayload)
        : jsonResponse(secondDetail)
    })

    const observation = await pollWorkday(providerFetch, { pageSize: 1 })

    expect(peak).toBe(1)
    expect(observation).toMatchObject({
      completeness: 'complete',
      credibleForClosure: true,
      expectedCount: 2,
      pageCount: 2,
      jobs: [
        { source: 'workday', externalId: 'R123456' },
        { source: 'workday', externalId: 'R654321' },
      ],
      warnings: [],
    })
    expect(Object.isFrozen(observation.jobs)).toBe(true)
    expect(observation.jobs.every(Object.isFrozen)).toBe(true)
  })

  it.each([
    ['origin change', { ...listPosting, externalPath: 'https://evil.example/job/R1' }, 'unsafe_detail_path'],
    ['protocol relative', { ...listPosting, externalPath: '//evil.example/job/R1' }, 'unsafe_detail_path'],
    ['traversal', { ...listPosting, externalPath: '/../admin' }, 'unsafe_detail_path'],
    ['encoded traversal', { ...listPosting, externalPath: '/job/%2e%2e/admin' }, 'unsafe_detail_path'],
    ['query', { ...listPosting, externalPath: '/job/R1?redirect=evil' }, 'unsafe_detail_path'],
  ])('rejects %s before a detail request', async (_name, posting, warning) => {
    const providerFetch = vi.fn().mockResolvedValue(
      jsonResponse({ total: 1, jobPostings: [posting] }),
    )
    const observation = await pollWorkday(providerFetch)
    expect(providerFetch).toHaveBeenCalledTimes(1)
    expect(observation).toMatchObject({
      completeness: 'unknown',
      credibleForClosure: false,
      jobs: [],
      warnings: [warning],
    })
  })

  it.each([
    ['rate limit', () => new Response('', { status: 429, headers: { 'retry-after': '9999' } }), 'http_429'],
    ['WAF HTML', () => new Response('<html>challenge</html>', { headers: { 'content-type': 'text/html' } }), 'invalid_content_type'],
    ['malformed JSON', () => new Response('{', { headers: { 'content-type': 'application/json' } }), 'malformed_response'],
    ['oversized payload', () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '99999999' } }), 'payload_too_large'],
  ])('makes %s closure-ineligible without leaking provider content', async (_name, response, warning) => {
    const observation = await pollWorkday(vi.fn().mockResolvedValue(response()))
    expect(observation).toMatchObject({
      completeness: 'unknown',
      credibleForClosure: false,
      jobs: [],
      warnings: [warning],
    })
    expect(observation.warnings.join('')).not.toContain('challenge')
  })

  it('degrades on timeout without making a second request', async () => {
    const providerFetch = vi.fn().mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    const observation = await pollWorkday(providerFetch)
    expect(providerFetch).toHaveBeenCalledTimes(1)
    expect(observation).toMatchObject({
      completeness: 'unknown',
      credibleForClosure: false,
      jobs: [],
      warnings: ['provider_timeout'],
    })
  })

  it('treats an undocumented empty board as closure-ineligible', async () => {
    const observation = await pollWorkday(
      vi.fn().mockResolvedValue(jsonResponse({ total: 0, jobPostings: [] })),
    )
    expect(observation).toMatchObject({
      completeness: 'unknown',
      credibleForClosure: false,
      expectedCount: 0,
      jobs: [],
      warnings: ['implausible_empty'],
    })
  })

  it('retains validated details but denies closure on an incomplete fan-out', async () => {
    const secondPosting = {
      ...listPosting,
      externalPath: '/job/Chicago-IL/Data-Engineer_R654321',
    }
    const providerFetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ total: 2, jobPostings: [listPosting, secondPosting] }))
      .mockResolvedValueOnce(jsonResponse(detailPayload))
      .mockResolvedValueOnce(new Response('', { status: 503, headers: { 'content-type': 'application/json' } }))

    const observation = await pollWorkday(providerFetch)
    expect(observation).toMatchObject({
      completeness: 'partial',
      credibleForClosure: false,
      expectedCount: 2,
      jobs: [{ externalId: 'R123456' }],
      warnings: ['provider_http_503'],
    })
  })

  it('degrades count mismatch and hard-cap overflow without extra requests', async () => {
    const mismatchFetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ total: 2, jobPostings: [listPosting] }))
      .mockResolvedValueOnce(jsonResponse({ total: 2, jobPostings: [] }))
    const mismatch = await pollWorkday(mismatchFetch, { pageSize: 20 })
    expect(mismatch).toMatchObject({
      completeness: 'unknown',
      credibleForClosure: false,
      expectedCount: 2,
      jobs: [],
      warnings: ['count_mismatch'],
    })

    const capFetch = vi.fn().mockResolvedValue(
      jsonResponse({ total: 201, jobPostings: [listPosting] }),
    )
    const capped = await pollWorkday(capFetch, { maxJobs: 200 })
    expect(capFetch).toHaveBeenCalledTimes(1)
    expect(capped).toMatchObject({
      completeness: 'unknown',
      credibleForClosure: false,
      jobs: [],
      warnings: ['job_cap_exceeded'],
    })
  })
})

describe('recent Capital One Analysis and Finance import', () => {
  const nowMs = Date.parse('2026-07-20T12:00:00.000Z')
  const recentPosting = {
    title: 'Data Science Internship',
    externalPath: '/job/McLean-VA/Data-Science-Internship_R100001-1',
    locationsText: 'McLean, VA',
    postedOn: 'Posted Today',
  }

  function recentDetail(
    posting: typeof recentPosting,
    country: string,
    requiredYears: number,
  ) {
    return {
      jobPostingInfo: {
        id: `opaque-${posting.externalPath}`,
        jobReqId: posting.externalPath.match(/_(R\d+)/)?.[1],
        title: posting.title,
        jobDescription: `<p>Basic Qualifications</p><p>At least ${requiredYears} years of experience</p><p>Preferred Qualifications</p><p>5 years preferred</p>`,
        location: posting.locationsText,
        postedOn: posting.postedOn,
        startDate: '2026-07-20',
        jobRequisitionLocation: {
          country: { descriptor: country === 'US' ? 'United States of America' : 'United Kingdom', alpha2Code: country },
        },
      },
    }
  }

  it('uses required experience rather than seniority words in the title', async () => {
    const titleOnlyCandidates = [
      ['Senior Data Scientist', 'R100002'],
      ['Principal Data Scientist', 'R100007'],
      ['Data Science Manager', 'R100008'],
      ['Lead Data Scientist', 'R100009'],
      ['Director, Data Science', 'R100010'],
    ].map(([title, id]) => ({
      ...recentPosting,
      title,
      externalPath: `/job/McLean-VA/${title.replaceAll(' ', '-')}_${id}-1`,
    }))
    const old = {
      ...recentPosting,
      title: 'Data Analyst',
      externalPath: '/job/McLean-VA/Data-Analyst_R100003-1',
      postedOn: 'Posted 8 Days Ago',
    }
    const uk = {
      ...recentPosting,
      title: 'Finance Analyst',
      externalPath: '/job/Nottingham-Eng/Finance-Analyst_R100004-1',
      locationsText: 'Nottingham, Eng',
    }
    const experienced = {
      ...recentPosting,
      title: 'Business Analyst',
      externalPath: '/job/McLean-VA/Business-Analyst_R100005-1',
    }
    const experiencedDetail = recentDetail(experienced, 'US', 3)
    experiencedDetail.jobPostingInfo.jobDescription = experiencedDetail.jobPostingInfo.jobDescription
      .replace('Basic Qualifications', 'Basic\u00a0Qualifications')
    const postings = [recentPosting, ...titleOnlyCandidates, old, uk, experienced]
    const providerFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url === listUrl) {
        expect(JSON.parse(String(init?.body))).toEqual({
          appliedFacets: {
            jobFamilyGroup: [
              'a12c70bf789e105802e9caf800542991',
              'a12c70bf789e105802e9de2c3b5f29a3',
            ],
          },
          limit: 20,
          offset: 0,
          searchText: '',
        })
        return jsonResponse({
          total: postings.length,
          jobPostings: postings,
          facets: categoryFacets(postings.length - 1, 1),
        })
      }
      if (url.endsWith(recentPosting.externalPath)) return jsonResponse(recentDetail(recentPosting, 'US', 1))
      const titleOnlyCandidate = titleOnlyCandidates.find((posting) => url.endsWith(posting.externalPath))
      if (titleOnlyCandidate) return jsonResponse(recentDetail(titleOnlyCandidate, 'US', 2))
      if (url.endsWith(uk.externalPath)) return jsonResponse(recentDetail(uk, 'GB', 1))
      if (url.endsWith(experienced.externalPath)) return jsonResponse(experiencedDetail)
      throw new Error(`unexpected detail request: ${url}`)
    })

    const observation = await pollCapitalOneRecent(providerFetch, { nowMs })

    expect(providerFetch).toHaveBeenCalledTimes(9)
    expect(observation).toMatchObject({
      completeness: 'complete',
      credibleForClosure: true,
      allowMissingClosure: false,
      expectedCount: 6,
      warnings: [],
      jobs: [
        {
          externalId: 'R100001',
          title: 'Data Science Internship',
          location: 'McLean, VA',
          snapshotPartial: false,
        },
        ...titleOnlyCandidates.map((posting) => ({
          externalId: posting.externalPath.match(/_(R\d+)/)?.[1],
          title: posting.title,
          location: 'McLean, VA',
          snapshotPartial: false,
        })),
      ],
    })
  })

  it('fails closed when the category facet response cannot prove the filter applied', async () => {
    const observation = await pollCapitalOneRecent(
      vi.fn().mockResolvedValue(jsonResponse({
        total: 1,
        jobPostings: [recentPosting],
        facets: [],
      })),
      { nowMs },
    )
    expect(observation).toMatchObject({
      completeness: 'unknown',
      credibleForClosure: false,
      jobs: [],
      warnings: ['category_filter_unverified'],
    })
  })

  it('includes the full seventh UTC calendar day in the requested window', async () => {
    const boundaryPosting = {
      ...recentPosting,
      externalPath: '/job/McLean-VA/Data-Science-Internship_R100006-1',
      postedOn: 'Posted 7 Days Ago',
    }
    const boundaryDetail = recentDetail(boundaryPosting, 'US', 1)
    boundaryDetail.jobPostingInfo.startDate = '2026-07-13'
    const providerFetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        total: 1,
        jobPostings: [boundaryPosting],
        facets: categoryFacets(1, 0),
      }))
      .mockResolvedValueOnce(jsonResponse(boundaryDetail))

    await expect(pollCapitalOneRecent(providerFetch, { nowMs })).resolves.toMatchObject({
      completeness: 'complete',
      jobs: [{ externalId: 'R100006' }],
    })
  })

  it('activates and claims only the exact evidence-backed Capital One identity', () => {
    const claimSql = activationSql.match(/create or replace function public\.claim_due_companies[\s\S]*?as \$\$([\s\S]*?)\$\$;/i)?.[1] ?? ''
    expect(activationSql).toContain("source_key = 'workday:wd12:capitalone:Capital_One'")
    expect(claimSql).toMatch(/where activation_state = 'active'[\s\S]*ats_type = 'workday'[\s\S]*source_key = 'workday:wd12:capitalone:Capital_One'/i)
    expect(claimSql).toMatch(/last_polled_at < now\(\) - interval '9 minutes'/i)
    expect(claimSql).toMatch(/for update skip locked/i)
    expect(claimSql).not.toMatch(/ats_type\s+in\s*\([^)]*'workday'/i)
    expect(claimSql).toMatch(/ats_type\s*=\s*'workday'\s+and source_key\s*=\s*'workday:wd12:capitalone:Capital_One'\s+and board_token\s*=\s*'capitalone'\s+and region\s*=\s*'wd12'\s+and site_token\s*=\s*'Capital_One'/i)
    expect(activationSql.match(/workday:wd12:capitalone:Capital_One/g)?.length).toBeGreaterThanOrEqual(2)
    expect(activationSql).toContain("c.conname = 'companies_workday_identity_check'")
    expect(activationSql).toContain("p.proname = 'promote_capital_one_after_observation'")
    expect(activationSql).toContain("t.tgname = 'promote_capital_one_after_observation'")
    expect(activationSql).not.toMatch(/drop constraint companies_workday_identity_check/i)
    expect(activationSql).not.toMatch(/create or replace function public\.promote_capital_one_after_observation/i)
    expect(activationSql).not.toMatch(/drop trigger if exists promote_capital_one_after_observation/i)
  })
})

const fidelityListUrl = 'https://wd1.myworkdaysite.com/wday/cxs/fmr/FidelityCareers/jobs'

function fidelityFacets(counts: {
  it: number
  rm: number
  sales: number
  customerService: number
  salesSupport: number
}) {
  return [{
    facetParameter: 'jobFamilyGroup',
    values: [
      { descriptor: 'Information Technology', id: 'fmr-it', count: counts.it },
      { descriptor: 'Relationship Management', id: 'fmr-rm', count: counts.rm },
      { descriptor: 'Sales', id: 'fmr-sales', count: counts.sales },
      { descriptor: 'Customer Service', id: 'fmr-cs', count: counts.customerService },
      { descriptor: 'Sales Support', id: 'fmr-ss', count: counts.salesSupport },
    ],
  }]
}

describe('Workday identity registry', () => {
  it('resolves the frozen Capital One identity byte-identically', () => {
    const identity = resolveWorkdayIdentity('capitalone', 'wd12', 'Capital_One', 'jobs')
    expect(identity).not.toBeNull()
    expect(identity?.sourceKey).toBe('workday:wd12:capitalone:Capital_One')
    expect(identity?.origin).toBe('https://capitalone.wd12.myworkdayjobs.com')
    expect(identity?.cxsRoot).toBe('https://capitalone.wd12.myworkdayjobs.com/wday/cxs/capitalone/Capital_One')
    expect(identity?.companyName).toBe('Capital One')
    expect(identity?.keptFacetIds).toEqual({
      Analysis: 'a12c70bf789e105802e9caf800542991',
      Finance: 'a12c70bf789e105802e9de2c3b5f29a3',
    })
    expect(identity?.excludedJobFamilyGroups).toBeUndefined()
  })

  it('resolves the Fidelity Form B identity with the myworkdaysite origin', () => {
    const identity = resolveWorkdayIdentity('fmr', 'wd1', 'FidelityCareers', 'site')
    expect(identity).not.toBeNull()
    expect(identity?.sourceKey).toBe('workday:wd1:fmr:FidelityCareers')
    expect(identity?.origin).toBe('https://wd1.myworkdaysite.com')
    expect(identity?.cxsRoot).toBe('https://wd1.myworkdaysite.com/wday/cxs/fmr/FidelityCareers')
    expect(identity?.hostForm).toBe('site')
    expect(identity?.companyName).toBeNull()
    expect(identity?.excludedJobFamilyGroups).toEqual(['Sales', 'Customer Service', 'Sales Support'])
    expect(identity?.keptFacetIds).toBeUndefined()
  })

  it('fails closed for any unadmitted tuple', () => {
    expect(resolveWorkdayIdentity('evil', 'wd1', 'X', 'site')).toBeNull()
    expect(resolveWorkdayIdentity('capitalone', 'wd12', 'Capital_One', 'site')).toBeNull()
    expect(resolveWorkdayIdentity('fmr', 'wd12', 'FidelityCareers', 'site')).toBeNull()
    expect(Object.isFrozen(WORKDAY_IDENTITIES)).toBe(true)
  })
})

describe('Fidelity category-scoped recent import', () => {
  const nowMs = Date.parse('2026-07-20T12:00:00.000Z')
  const fidelityIdentity = resolveWorkdayIdentity('fmr', 'wd1', 'FidelityCareers', 'site') as WorkdayIdentity

  const fidPostingA = {
    title: 'Software Engineer',
    externalPath: '/job/Boston-MA/Software-Engineer_R200001-1',
    locationsText: 'Boston, MA',
    postedOn: 'Posted Today',
  }
  const fidPostingB = {
    title: 'Investment Operations Analyst',
    externalPath: '/job/Boston-MA/Investment-Operations-Analyst_R200002-1',
    locationsText: 'Boston, MA',
    postedOn: 'Posted Today',
  }

  function fidDetail(posting: typeof fidPostingA) {
    return {
      jobPostingInfo: {
        id: `opaque-${posting.externalPath}`,
        jobReqId: posting.externalPath.match(/_(R\d+)/)?.[1],
        title: posting.title,
        jobDescription: '<p>Basic Qualifications</p><p>At least 1 years of experience</p><p>Preferred Qualifications</p><p>5 years preferred</p>',
        location: posting.locationsText,
        postedOn: posting.postedOn,
        startDate: '2026-07-20',
        jobRequisitionLocation: {
          country: { descriptor: 'United States of America', alpha2Code: 'US' },
        },
      },
    }
  }

  it('applies live-discovered kept-family inclusion facets and excludes Sales families', async () => {
    let filteredBody: { appliedFacets: { jobFamilyGroup?: string[] } } | null = null
    const providerFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url === fidelityListUrl) {
        const body = JSON.parse(String(init?.body)) as {
          appliedFacets: { jobFamilyGroup?: string[] }
          offset: number
        }
        if (body.appliedFacets.jobFamilyGroup === undefined) {
          // discovery request: unfiltered, returns the live facets array
          return jsonResponse({
            total: 5,
            jobPostings: [],
            facets: fidelityFacets({ it: 1, rm: 1, sales: 1, customerService: 1, salesSupport: 1 }),
          })
        }
        filteredBody = body
        return jsonResponse({
          total: 2,
          jobPostings: [fidPostingA, fidPostingB],
          facets: fidelityFacets({ it: 1, rm: 1, sales: 0, customerService: 0, salesSupport: 0 }),
        })
      }
      if (url.endsWith(fidPostingA.externalPath)) return jsonResponse(fidDetail(fidPostingA))
      if (url.endsWith(fidPostingB.externalPath)) return jsonResponse(fidDetail(fidPostingB))
      throw new Error(`unexpected request: ${url}`)
    })

    const observation = await pollWorkdayRecent(fidelityIdentity, providerFetch, { nowMs })

    // The inclusion facet list is exactly the kept families (IT + Relationship Management),
    // never the excluded Sales / Customer Service / Sales Support families.
    expect(filteredBody).not.toBeNull()
    expect(filteredBody!.appliedFacets.jobFamilyGroup).toEqual(['fmr-it', 'fmr-rm'])
    expect(observation).toMatchObject({
      completeness: 'complete',
      credibleForClosure: true,
      jobs: [
        { externalId: 'R200001', companyName: null },
        { externalId: 'R200002', companyName: null },
      ],
    })
  })

  it('fails closed when kept+excluded facet counts do not equal the provider total', async () => {
    const observation = await pollWorkdayRecent(
      fidelityIdentity,
      vi.fn().mockResolvedValue(jsonResponse({
        total: 5,
        jobPostings: [],
        // counts sum to 4, not the declared total of 5 -> cannot prove the filter applied
        facets: fidelityFacets({ it: 1, rm: 1, sales: 1, customerService: 1, salesSupport: 0 }),
      })),
      { nowMs },
    )
    expect(observation).toMatchObject({
      completeness: 'unknown',
      credibleForClosure: false,
      jobs: [],
      warnings: ['category_filter_unverified'],
    })
  })
})

describe('Fidelity paste -> verify -> experimental staging', () => {
  const fidelityBoardUrl = 'https://wd1.myworkdaysite.com/en-US/recruiting/fmr/FidelityCareers'
  const fidelitySourceKey = 'workday:wd1:fmr:FidelityCareers'
  const fidVerifyPosting = {
    title: 'Software Engineer',
    externalPath: '/job/Boston-MA/Software-Engineer_R200001-1',
    locationsText: 'Boston, MA',
    postedOn: 'Posted Today',
  }

  describe('listing tombstone accounting', () => {
    const fidelityIdentity = resolveWorkdayIdentity(
      'fmr',
      'wd1',
      'FidelityCareers',
      'site',
    ) as WorkdayIdentity
    const liveTombstone = { bulletFields: ['2131450'] }

    it('counts the exact live tombstone as a provider row while advancing by raw rows', async () => {
      const offsets: number[] = []
      const secondPosting = {
        ...fidVerifyPosting,
        title: 'Data Engineer',
        externalPath: '/job/Chicago-IL/Data-Engineer_R654321',
      }
      const providerFetch = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { offset: number }
        offsets.push(body.offset)
        return Promise.resolve(body.offset === 0
          ? jsonResponse({
              total: 3,
              jobPostings: [fidVerifyPosting, liveTombstone],
            })
          : jsonResponse({
              total: 0,
              jobPostings: [secondPosting],
            }))
      })

      await expect(verifyWorkdayListing(
        providerFetch,
        { pageSize: 2 },
        fidelityIdentity,
      )).resolves.toEqual({
        jobCount: 3,
        pageCount: 2,
      })
      expect(offsets).toEqual([0, 2])
    })

    it('counts exact-equivalent listing duplicates across adjacent raw pages', async () => {
      const offsets: number[] = []
      const secondPosting = {
        ...fidVerifyPosting,
        title: 'Data Engineer',
        externalPath: '/job/Chicago-IL/Data-Engineer_R654321',
      }
      const providerFetch = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { offset: number }
        offsets.push(body.offset)
        return Promise.resolve(body.offset === 0
          ? jsonResponse({
              total: 3,
              jobPostings: [fidVerifyPosting, secondPosting],
            })
          : jsonResponse({
              total: 0,
              jobPostings: [secondPosting],
            }))
      })

      await expect(verifyWorkdayListing(
        providerFetch,
        { pageSize: 2 },
        fidelityIdentity,
      )).resolves.toEqual({
        jobCount: 3,
        pageCount: 2,
      })
      expect(offsets).toEqual([0, 2])
    })

    it.each([
      ['empty fields', { bulletFields: [] }],
      ['multiple fields', { bulletFields: ['2131450', '2131451'] }],
      ['non-string field', { bulletFields: [2131450] }],
      ['empty identifier', { bulletFields: [''] }],
      ['oversized identifier', { bulletFields: ['a'.repeat(257)] }],
      ['control-character identifier', { bulletFields: ['213\u00001450'] }],
      ['extra externalPath', { bulletFields: ['2131450'], externalPath: fidVerifyPosting.externalPath }],
      ['extra field', { bulletFields: ['2131450'], title: 'Not a job' }],
      ['malformed fields', { bulletFields: '2131450' }],
    ])('rejects a tombstone with %s', async (_name, tombstone) => {
      await expect(verifyWorkdayListing(
        vi.fn().mockResolvedValue(jsonResponse({
          total: 1,
          jobPostings: [tombstone],
        })),
        {},
        fidelityIdentity,
      )).rejects.toThrow('provider_schema_invalid')
    })

    it('rejects duplicate tombstone identifiers and collisions with a listed requisition', async () => {
      const duplicateFetch = vi.fn().mockResolvedValue(jsonResponse({
        total: 2,
        jobPostings: [liveTombstone, liveTombstone],
      }))
      await expect(verifyWorkdayListing(
        duplicateFetch,
        {},
        fidelityIdentity,
      )).rejects.toThrow('count_mismatch')

      const collidingPosting = {
        ...fidVerifyPosting,
        externalPath: '/job/Boston-MA/Software-Engineer_2131450',
      }
      const collisionFetch = vi.fn().mockResolvedValue(jsonResponse({
        total: 2,
        jobPostings: [collidingPosting, liveTombstone],
      }))
      await expect(verifyWorkdayListing(
        collisionFetch,
        {},
        fidelityIdentity,
      )).rejects.toThrow('count_mismatch')
    })

    it.each([
      ['title', { title: 'Conflicting title' }],
      ['location', { locationsText: 'Chicago, IL' }],
      ['posted age', { postedOn: 'Posted Yesterday' }],
    ])('rejects duplicate paths with conflicting %s', async (_field, override) => {
      await expect(verifyWorkdayListing(
        vi.fn().mockResolvedValue(jsonResponse({
          total: 2,
          jobPostings: [fidVerifyPosting, { ...fidVerifyPosting, ...override }],
        })),
        {},
        fidelityIdentity,
      )).rejects.toThrow('count_mismatch')
    })

    it('keeps contradictory totals and unaccounted rows fail-closed', async () => {
      const contradictoryFetch = vi.fn()
        .mockResolvedValueOnce(jsonResponse({
          total: 2,
          jobPostings: [fidVerifyPosting],
        }))
        .mockResolvedValueOnce(jsonResponse({
          total: 1,
          jobPostings: [liveTombstone],
        }))
      await expect(verifyWorkdayListing(
        contradictoryFetch,
        { pageSize: 1 },
        fidelityIdentity,
      )).rejects.toThrow('count_mismatch')

      await expect(verifyWorkdayListing(
        vi.fn().mockResolvedValue(jsonResponse({
          total: 1,
          jobPostings: [fidVerifyPosting, liveTombstone],
        })),
        {},
        fidelityIdentity,
      )).rejects.toThrow('count_mismatch')
    })
  })

  it('accepts the live later-page total sentinel and stages the complete Fidelity listing', async () => {
    // Form B detection resolves the Fidelity identity with its own source key.
    const detected = detectAts(fidelityBoardUrl)
    expect(detected).toEqual({
      ats: 'workday',
      slug: 'fmr',
      region: 'wd1',
      site: 'FidelityCareers',
      hostForm: 'site',
    })

    let insertArg: Record<string, unknown> | null = null
    const persisted = {
      id: 'fidelity-company-1',
      name: 'fmr',
      source_key: fidelitySourceKey,
      activation_state: 'experimental',
    }
    const single = vi.fn().mockResolvedValue({ data: { ...persisted }, error: null })
    const insertSelect = vi.fn(() => ({ single }))
    const insert = vi.fn((value: Record<string, unknown>) => {
      insertArg = value
      return { select: insertSelect }
    })
    const maybeSingle = vi.fn().mockResolvedValue({ data: { ...persisted }, error: null })
    const selectEq = vi.fn(() => ({ maybeSingle }))
    const select = vi.fn(() => ({ eq: selectEq }))
    const rpc = vi.fn().mockResolvedValue({
      data: {
        accepted: true,
        reason: 'accepted',
        progress: 1,
        window_start: null,
        next_eligible_at: null,
        result_activation_state: 'experimental',
      },
      error: null,
    })
    const providerFetch = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { limit: number; offset: number }
      const remaining = Math.max(704 - body.offset, 0)
      const count = Math.min(body.limit, remaining)
      const jobPostings = Array.from({ length: count }, (_, index) => {
        const sequence = body.offset + index + 1
        return {
          ...fidVerifyPosting,
          title: `Software Engineer ${sequence}`,
          externalPath: `/job/Boston-MA/Software-Engineer-${sequence}_R${String(sequence).padStart(6, '0')}-1`,
        }
      })
      return Promise.resolve(jsonResponse({
        // Fidelity CXS reports the authoritative count only on page 0. Later
        // non-empty pages carry zero as a pagination sentinel.
        total: body.offset === 0 ? 704 : 0,
        jobPostings,
      }))
    })

    const handler = createVerifyBoardHandler({
      createAuthClient: () => ({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'user-1', role: 'authenticated' } },
            error: null,
          }),
        },
      }),
      createServiceClient: () => ({
        from: vi.fn(() => ({ insert, select })),
        rpc,
      }),
      providerFetch,
      digestEvidence: async () => 'digest',
      randomUUID: () => 'observation-1',
    })

    const response = await handler(new Request('https://example.test/functions/v1/verify-board', {
      method: 'POST',
      headers: {
        authorization: 'Bearer real-user-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ url: fidelityBoardUrl }),
    }))

    expect(response.status).toBe(200)
    const payload = await response.json() as { ok: boolean; company: { source_key: string } }
    expect(payload.ok).toBe(true)
    expect(payload.company.source_key).toBe(fidelitySourceKey)
    expect(providerFetch).toHaveBeenCalledTimes(36)
    expect(rpc).toHaveBeenCalledTimes(1)

    // Verification reconciled all 704 unique list rows before staging experimental.
    expect(insertArg).not.toBeNull()
    expect(insertArg).toMatchObject({
      ats_type: 'workday',
      board_token: 'fmr',
      region: 'wd1',
      site_token: 'FidelityCareers',
      source_key: fidelitySourceKey,
      activation_state: 'experimental',
      last_observation_count: 704,
    })
  })

  it('rejects a non-allowlisted Workday tenant at verify and poll', async () => {
    // verify (defense-in-depth): an unadmitted tuple that bypassed detection fails closed.
    await expect(verifyConnector(
      { ats: 'workday', slug: 'evil', region: 'wd1', site: 'Evil', hostForm: 'site' } as SupportedDetection,
      vi.fn(),
    )).rejects.toThrow('invalid_identity')

    // poll (dispatch re-check): a company whose source key is not admitted is rejected.
    await expect(pollConnector({
      ats_type: 'workday',
      board_token: 'evil',
      region: 'wd1',
      site_token: 'Evil',
      source_key: 'workday:wd1:evil:Evil',
      activation_state: 'active',
    }, new Set())).rejects.toThrow('inactive_connector:workday_identity_not_allowed')
  })
})

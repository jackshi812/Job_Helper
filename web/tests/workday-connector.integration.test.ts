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
  observeConnector,
  pollConnector,
  providerRegistry,
  type SupportedDetection,
  verifyConnector,
} from '../../supabase/functions/_shared/connectors.ts'
import { detectAts } from '../../supabase/functions/_shared/detect.ts'
import { fingerprint } from '../../supabase/functions/_shared/dedup.ts'
import { planCompanySync } from '../../supabase/functions/_shared/lifecycle.ts'
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
      'eightfold',
      'goldman_higher',
      'greenhouse',
      'lever',
      'oracle_recruiting',
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
      expect(normalizedTypesSource).toContain(
        provider === 'workday' ? "source: 'workday'" : `| '${provider}'`,
      )
      expect(companyCheck).toContain(`'${provider}'`)
      expect(jobCheck).toContain(`'${provider}'`)
    }
    expect(jobCheck).toContain("'adzuna'")
    expect(companyCheck).not.toContain("'adzuna'")
    for (const unsupported of ['oracle', 'icims', 'successfactors']) {
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

  it('keeps legacy Capital One R-suffix identity authoritative over bullet fields', async () => {
    const providerFetch = vi.fn().mockResolvedValue(jsonResponse({
      total: 1,
      jobPostings: [{ ...recentPosting, bulletFields: ['9999999'] }],
      facets: categoryFacets(1, 0),
    }))

    await expect(pollCapitalOneRecent(providerFetch, {
      knownIds: new Set(['R100001']),
      nowMs,
    })).resolves.toMatchObject({
      completeness: 'complete',
      jobs: [{ externalId: 'R100001', snapshotPartial: true }],
    })
    expect(providerFetch).toHaveBeenCalledTimes(1)
  })

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
    expect(identity?.companyName).toBe('Fidelity')
    expect(identity?.excludedJobFamilyGroups).toEqual(['Sales', 'Customer Service', 'Sales Support'])
    expect(identity?.keptFacetIds).toBeUndefined()
    expect(fingerprint(
      identity?.companyName ?? '',
      'Full Stack Developer',
      'Westlake, TX',
    )).toBe(fingerprint('Fidelity', 'Full Stack Developer', 'Westlake, TX'))
  })

  it('fails closed for any unadmitted tuple', () => {
    expect(resolveWorkdayIdentity('evil', 'wd1', 'X', 'site')).toBeNull()
    expect(resolveWorkdayIdentity('capitalone', 'wd12', 'Capital_One', 'site')).toBeNull()
    expect(resolveWorkdayIdentity('fmr', 'wd12', 'FidelityCareers', 'site')).toBeNull()
    expect(Object.isFrozen(WORKDAY_IDENTITIES)).toBe(true)
  })
})

const UNITED_STATES_WORKDAY_FACET_ID = 'bc33aa3152ec42d4995f4791a106ed09'
const UNITED_STATES_WORKDAY_DESCRIPTOR = 'United States of America'

type Phase036CountryScope = {
  readonly descriptor: string
  readonly id: string
  readonly facetParameter: string
  readonly route: readonly string[]
}

type Phase036Identity = WorkdayIdentity & {
  readonly countryScope?: Phase036CountryScope
}

const phase036Identities = [
  {
    companyName: 'Nasdaq',
    tuple: ['nasdaq', 'wd1', 'Global_External_Site', 'jobs'],
    sourceKey: 'workday:wd1:nasdaq:Global_External_Site',
    origin: 'https://nasdaq.wd1.myworkdayjobs.com',
    cxsRoot: 'https://nasdaq.wd1.myworkdayjobs.com/wday/cxs/nasdaq/Global_External_Site',
    publicBoard: 'https://nasdaq.wd1.myworkdayjobs.com/Global_External_Site',
    facetParameter: 'Location_Country',
    route: ['Location_Country'],
  },
  {
    companyName: 'S&P Global',
    tuple: ['spgi', 'wd5', 'SPGI_Careers', 'jobs'],
    sourceKey: 'workday:wd5:spgi:SPGI_Careers',
    origin: 'https://spgi.wd5.myworkdayjobs.com',
    cxsRoot: 'https://spgi.wd5.myworkdayjobs.com/wday/cxs/spgi/SPGI_Careers',
    publicBoard: 'https://spgi.wd5.myworkdayjobs.com/SPGI_Careers',
    facetParameter: 'Location_Country',
    route: ['Location_Country'],
  },
  {
    companyName: 'Morningstar',
    tuple: ['morningstar', 'wd5', 'morningstar', 'jobs'],
    sourceKey: 'workday:wd5:morningstar:morningstar',
    origin: 'https://morningstar.wd5.myworkdayjobs.com',
    cxsRoot: 'https://morningstar.wd5.myworkdayjobs.com/wday/cxs/morningstar/morningstar',
    publicBoard: 'https://morningstar.wd5.myworkdayjobs.com/morningstar',
    facetParameter: 'locationCountry',
    route: ['locationMainGroup', 'locationCountry'],
  },
  {
    companyName: 'State Street',
    tuple: ['statestreet', 'wd1', 'Global', 'jobs'],
    sourceKey: 'workday:wd1:statestreet:Global',
    origin: 'https://statestreet.wd1.myworkdayjobs.com',
    cxsRoot: 'https://statestreet.wd1.myworkdayjobs.com/wday/cxs/statestreet/Global',
    publicBoard: 'https://statestreet.wd1.myworkdayjobs.com/Global',
    facetParameter: 'Location_Country',
    route: ['Location_Country'],
  },
] as const

function countryFacetValues(usCount: number, otherCount = 1) {
  return [
    {
      descriptor: UNITED_STATES_WORKDAY_DESCRIPTOR,
      id: UNITED_STATES_WORKDAY_FACET_ID,
      count: usCount,
    },
    {
      descriptor: 'Canada',
      id: 'a30a87ed25634629aa6c3958aa2b91ea',
      count: otherCount,
    },
  ]
}

function countryFacets(route: readonly string[], usCount: number, otherCount = 1) {
  const countryFacet = {
    facetParameter: route.at(-1),
    descriptor: 'Country',
    values: countryFacetValues(usCount, otherCount),
  }
  return route.length === 1
    ? [countryFacet]
    : [{ facetParameter: 'locationMainGroup', values: [countryFacet] }]
}

function phase036Posting(sequence: number, location = 'New York, NY') {
  return {
    title: `Phase 03.6 Analyst ${sequence}`,
    externalPath: `/job/New-York/Phase-03-6-Analyst-${sequence}_R36${String(sequence).padStart(4, '0')}-1`,
    locationsText: location,
    postedOn: 'Posted Today',
  }
}

function phase036Detail(
  posting: ReturnType<typeof phase036Posting>,
  country = UNITED_STATES_WORKDAY_DESCRIPTOR,
  alpha2Code = 'US',
) {
  return {
    jobPostingInfo: {
      id: `opaque-${posting.externalPath}`,
      jobReqId: posting.externalPath.match(/_(R\d+)/)?.[1],
      title: posting.title,
      jobDescription: '<p>Build reliable financial systems.</p>',
      location: posting.locationsText,
      postedOn: posting.postedOn,
      startDate: new Date().toISOString().slice(0, 10),
      jobRequisitionLocation: {
        country: { descriptor: country, alpha2Code },
      },
    },
  }
}

describe('Phase 03.6 exact Workday identity registry and U.S. scope', () => {
  it('resolves all four exact Phase 03.6 identities', () => {
    const resolved = phase036Identities.map((expected) => {
      const identity = resolveWorkdayIdentity(...expected.tuple) as Phase036Identity | null
      return { expected, identity }
    })
    const contractPresent = resolved.every(({ expected, identity }) => (
      identity?.sourceKey === expected.sourceKey
      && identity.origin === expected.origin
      && identity.cxsRoot === expected.cxsRoot
      && identity.publicBoard === expected.publicBoard
      && identity.companyName === expected.companyName
      && identity.hostForm === 'jobs'
      && identity.countryScope?.id === UNITED_STATES_WORKDAY_FACET_ID
      && identity.countryScope.descriptor === UNITED_STATES_WORKDAY_DESCRIPTOR
      && identity.countryScope.facetParameter === expected.facetParameter
      && JSON.stringify(identity.countryScope.route) === JSON.stringify(expected.route)
      && Object.isFrozen(identity)
      && Object.isFrozen(identity.countryScope)
      && Object.isFrozen(identity.countryScope.route)
    ))
    if (!contractPresent) throw new Error('PHASE_03_6_REGISTRY_SCOPE_MISSING')

    expect(Object.keys(WORKDAY_IDENTITIES)).toHaveLength(21)
    expect(Object.isFrozen(WORKDAY_IDENTITIES)).toBe(true)
  })

  it('rejects held-out one-field tuple mutations before verify or poll fetches', async () => {
    for (const expected of phase036Identities) {
      const [tenant, region, site, hostForm] = expected.tuple
      const mutations = [
        [`${tenant}-lookalike`, region, site, hostForm],
        [tenant, region === 'wd1' ? 'wd5' : 'wd1', site, hostForm],
        [tenant, region, `${site}-lookalike`, hostForm],
        [tenant, region, site, 'site'],
        [tenant.toUpperCase(), region, site, hostForm],
        ['null', region, site, hostForm],
      ] as const
      for (const tuple of mutations) {
        expect(resolveWorkdayIdentity(...tuple)).toBeNull()
        const verifyFetch = vi.fn()
        await expect(verifyConnector({
          ats: 'workday',
          slug: tuple[0],
          region: tuple[1],
          site: tuple[2],
          hostForm: tuple[3],
        } as SupportedDetection, verifyFetch)).rejects.toThrow('invalid_identity')
        expect(verifyFetch).not.toHaveBeenCalled()
      }

      const pollFetch = vi.fn()
      vi.stubGlobal('fetch', pollFetch)
      await expect(pollConnector({
        ats_type: 'workday',
        board_token: `${tenant}-lookalike`,
        region,
        site_token: site,
        source_key: expected.sourceKey,
        activation_state: 'active',
      }, new Set())).rejects.toThrow('inactive_connector:workday_identity_not_allowed')
      expect(pollFetch).not.toHaveBeenCalled()
      vi.unstubAllGlobals()
    }
    expect(resolveWorkdayIdentity('unknown', 'wd1', 'Global', 'jobs')).toBeNull()
  })

  it.each(phase036Identities)(
    'discovers and applies the registered U.S. route for $companyName on every scoped page',
    async (expected) => {
      const identity = resolveWorkdayIdentity(...expected.tuple) as WorkdayIdentity
      const postings = [phase036Posting(1), phase036Posting(2)]
      const bodies: Array<{
        appliedFacets: Record<string, string[]>
        offset: number
      }> = []
      const providerFetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        if (url !== `${expected.cxsRoot}/jobs`) {
          const posting = postings.find((candidate) => url.endsWith(candidate.externalPath))
          if (!posting) throw new Error(`unexpected detail request: ${url}`)
          return Promise.resolve(jsonResponse(phase036Detail(posting)))
        }
        const body = JSON.parse(String(init?.body)) as {
          appliedFacets: Record<string, string[]>
          offset: number
        }
        bodies.push(body)
        if (body.appliedFacets[expected.facetParameter] === undefined) {
          return Promise.resolve(jsonResponse({
            total: 3,
            jobPostings: [],
            facets: countryFacets(expected.route, 2),
          }))
        }
        const page = body.offset === 0 ? postings.slice(0, 1) : postings.slice(1)
        return Promise.resolve(jsonResponse({ total: 2, jobPostings: page }))
      })

      const observation = await pollWorkdayRecent(identity, providerFetch, {
        knownIds: new Set(['R360001', 'R360002']),
      })

      expect(observation).toMatchObject({
        completeness: 'complete',
        credibleForClosure: true,
        allowMissingClosure: true,
        expectedCount: 2,
        jobs: [
          { externalId: 'R360001', companyName: expected.companyName },
          { externalId: 'R360002', companyName: expected.companyName },
        ],
        warnings: [],
      })
      expect(bodies.slice(1)).toHaveLength(2)
      for (const body of bodies.slice(1)) {
        expect(body.appliedFacets).toEqual({
          [expected.facetParameter]: [UNITED_STATES_WORKDAY_FACET_ID],
        })
      }
    },
  )

  it('reconciles the complete country-scoped population beyond an all-old page', async () => {
    const identity = resolveWorkdayIdentity(
      'nasdaq',
      'wd1',
      'Global_External_Site',
      'jobs',
    ) as WorkdayIdentity
    const scopedOffsets: number[] = []
    const providerFetch = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        appliedFacets: Record<string, string[]>
        offset: number
      }
      if (body.appliedFacets.Location_Country === undefined) {
        return Promise.resolve(jsonResponse({
          total: 4,
          jobPostings: [],
          facets: countryFacets(['Location_Country'], 3),
        }))
      }
      scopedOffsets.push(body.offset)
      return Promise.resolve(jsonResponse({
        total: 3,
        jobPostings: [{
          ...phase036Posting(body.offset + 70),
          postedOn: 'Posted 8 Days Ago',
        }],
      }))
    })

    await expect(pollWorkdayRecent(identity, providerFetch)).resolves.toMatchObject({
      completeness: 'complete',
      credibleForClosure: true,
      allowMissingClosure: true,
      pageCount: 3,
      expectedCount: 3,
      jobs: [
        { externalId: 'R360070', snapshotPartial: true },
        { externalId: 'R360071', snapshotPartial: true },
        { externalId: 'R360072', snapshotPartial: true },
      ],
      warnings: [],
    })
    expect(scopedOffsets).toEqual([0, 1, 2])
  })

  it('reconciles the complete Nasdaq U.S. population without detail-cap truncation', async () => {
    const expected = phase036Identities[0]
    const identity = resolveWorkdayIdentity(...expected.tuple) as WorkdayIdentity
    const postings = Array.from({ length: 48 }, (_, index) => ({
      ...phase036Posting(index + 100),
      postedOn: index < 7 ? 'Posted Today' : 'Posted 30 Days Ago',
    }))
    const offsets: number[] = []
    const providerFetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe(`${expected.cxsRoot}/jobs`)
      const body = JSON.parse(String(init?.body)) as {
        appliedFacets: Record<string, string[]>
        offset: number
      }
      if (body.appliedFacets.Location_Country === undefined) {
        return Promise.resolve(jsonResponse({
          total: 186,
          jobPostings: [],
          facets: countryFacets(expected.route, postings.length, 142),
        }))
      }
      offsets.push(body.offset)
      return Promise.resolve(jsonResponse({
        total: postings.length,
        jobPostings: postings.slice(body.offset, body.offset + 20),
      }))
    })

    const observation = await pollWorkdayRecent(identity, providerFetch, {
      maxDetails: 1,
    })

    expect(offsets).toEqual([0, 20, 40])
    expect(providerFetch).toHaveBeenCalledTimes(4)
    expect(observation).toMatchObject({
      completeness: 'complete',
      credibleForClosure: true,
      allowMissingClosure: true,
      expectedCount: 48,
      warnings: [],
    })
    expect(observation.jobs).toHaveLength(48)
    expect(observation.jobs.every((job) => job.snapshotPartial)).toBe(true)
    expect(observation.jobs.at(-1)?.externalId).toBe('R360147')
  })

  it('reconciles prior partial source rows and permits stale closure only after a later complete list', async () => {
    const expected = phase036Identities[3]
    const identity = resolveWorkdayIdentity(...expected.tuple) as WorkdayIdentity
    const postings = [
      phase036Posting(201),
      phase036Posting(202),
      phase036Posting(203),
    ]
    const fetchFor = (truncate: boolean) => vi.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        expect(String(input)).toBe(`${expected.cxsRoot}/jobs`)
        const body = JSON.parse(String(init?.body)) as {
          appliedFacets: Record<string, string[]>
          offset: number
        }
        if (body.appliedFacets.Location_Country === undefined) {
          return Promise.resolve(jsonResponse({
            total: 4,
            jobPostings: [],
            facets: countryFacets(expected.route, postings.length),
          }))
        }
        return Promise.resolve(jsonResponse({
          total: postings.length,
          jobPostings: truncate ? postings.slice(0, 2) : postings,
        }))
      },
    )
    const partial = await pollWorkdayRecent(identity, fetchFor(true), {
      maxListings: 2,
    })
    const complete = await pollWorkdayRecent(identity, fetchFor(false))
    const existing = [
      {
        id: 'existing-201',
        source: 'workday',
        external_id: 'R360201',
        fingerprint: 'state street|analyst 201|new york ny',
        status: 'open' as const,
        last_seen_at: '2026-07-24T00:00:00.000Z',
      },
      {
        id: 'existing-202',
        source: 'workday',
        external_id: 'R360202',
        fingerprint: 'state street|analyst 202|new york ny',
        status: 'open' as const,
        last_seen_at: '2026-07-24T00:00:00.000Z',
      },
      {
        id: 'stale-removed',
        source: 'workday',
        external_id: 'R359999',
        fingerprint: 'state street|removed|new york ny',
        status: 'open' as const,
        last_seen_at: '2026-07-24T00:00:00.000Z',
      },
    ]

    expect(partial).toMatchObject({
      credibleForClosure: false,
      allowMissingClosure: false,
      warnings: ['recent_window_cap_exceeded'],
    })
    expect(planCompanySync(existing, partial, '2026-07-25T05:00:00.000Z').closeIds)
      .toEqual([])
    expect(complete).toMatchObject({
      completeness: 'complete',
      credibleForClosure: true,
      allowMissingClosure: true,
      expectedCount: 3,
      warnings: [],
    })
    expect(planCompanySync(existing, complete, '2026-07-25T05:00:00.000Z')).toMatchObject({
      seenOpenIds: ['existing-201', 'existing-202'],
      newJobs: [{ externalId: 'R360203' }],
      closeIds: ['stale-removed'],
    })
  })

  it.each(phase036Identities)(
    'verifies $companyName when overlapping country counts exceed the global unique-job total',
    async (expected) => {
      const identity = resolveWorkdayIdentity(...expected.tuple) as WorkdayIdentity
      const bodies: Array<Record<string, string[]>> = []
      const providerFetch = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          appliedFacets: Record<string, string[]>
        }
        bodies.push(body.appliedFacets)
        return Promise.resolve(body.appliedFacets[expected.facetParameter] === undefined
          ? jsonResponse({
              total: 3,
              jobPostings: [],
              facets: countryFacets(expected.route, 1, 3),
            })
          : jsonResponse({ total: 1, jobPostings: [phase036Posting(3)] }))
      })

      await expect(verifyWorkdayListing(providerFetch, {}, identity)).resolves.toEqual({
        jobCount: 1,
        pageCount: 1,
      })
      expect(bodies).toEqual([
        {},
        { [expected.facetParameter]: [UNITED_STATES_WORKDAY_FACET_ID] },
      ])
    },
  )

  it.each(phase036Identities)(
    'fails $companyName closed when the filtered total differs from its discovered U.S. count',
    async (expected) => {
      const identity = resolveWorkdayIdentity(...expected.tuple) as WorkdayIdentity
      const providerFetch = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          appliedFacets: Record<string, string[]>
        }
        return Promise.resolve(body.appliedFacets[expected.facetParameter] === undefined
          ? jsonResponse({
              total: 2,
              jobPostings: [],
              facets: countryFacets(expected.route, 1, 2),
            })
          : jsonResponse({
              total: 2,
              jobPostings: [phase036Posting(301), phase036Posting(302)],
            }))
      })

      await expect(verifyWorkdayListing(providerFetch, {}, identity))
        .rejects.toThrow('country_filter_unverified')
    },
  )

  it.each([
    ['missing facet', []],
    ['duplicate facet', [
      ...countryFacets(['Location_Country'], 1),
      ...countryFacets(['Location_Country'], 1),
    ]],
    ['negative count', [{
      facetParameter: 'Location_Country',
      values: countryFacetValues(-1),
    }]],
    ['wrong descriptor', [{
      facetParameter: 'Location_Country',
      values: [{
        descriptor: 'United States',
        id: UNITED_STATES_WORKDAY_FACET_ID,
        count: 1,
      }],
    }]],
    ['wrong ID', [{
      facetParameter: 'Location_Country',
      values: [{
        descriptor: UNITED_STATES_WORKDAY_DESCRIPTOR,
        id: 'wrong-country-id',
        count: 1,
      }],
    }]],
    ['wrong flat route', countryFacets(['locationMainGroup', 'locationCountry'], 1)],
    ['wrong flat casing', countryFacets(['locationCountry'], 1)],
  ])('fails closed for flat country discovery with %s', async (_name, facets) => {
    const identity = resolveWorkdayIdentity(
      'nasdaq',
      'wd1',
      'Global_External_Site',
      'jobs',
    ) as WorkdayIdentity
    const observation = await pollWorkdayRecent(
      identity,
      vi.fn().mockResolvedValue(jsonResponse({
        total: 2,
        jobPostings: [],
        facets,
      })),
    )
    expect(observation).toMatchObject({
      completeness: 'unknown',
      credibleForClosure: false,
      allowMissingClosure: false,
      jobs: [],
      warnings: ['country_filter_unverified'],
    })
  })

  it('fails closed when Morningstar receives a flat country facet instead of its nested route', async () => {
    const identity = resolveWorkdayIdentity(
      'morningstar',
      'wd5',
      'morningstar',
      'jobs',
    ) as WorkdayIdentity
    await expect(pollWorkdayRecent(
      identity,
      vi.fn().mockResolvedValue(jsonResponse({
        total: 2,
        jobPostings: [],
        facets: countryFacets(['locationCountry'], 1),
      })),
    )).resolves.toMatchObject({
      credibleForClosure: false,
      allowMissingClosure: false,
      jobs: [],
      warnings: ['country_filter_unverified'],
    })
  })

  it('rejects ignored U.S. filtering before a non-U.S. row can materialize', async () => {
    const identity = resolveWorkdayIdentity(
      'statestreet',
      'wd1',
      'Global',
      'jobs',
    ) as WorkdayIdentity
    const providerFetch = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        appliedFacets: Record<string, string[]>
      }
      return Promise.resolve(body.appliedFacets.Location_Country === undefined
        ? jsonResponse({
            total: 2,
            jobPostings: [],
            facets: countryFacets(['Location_Country'], 1),
          })
        : jsonResponse({
            total: 2,
            jobPostings: [
              phase036Posting(4),
              phase036Posting(5, 'Toronto, Canada'),
            ],
          }))
    })

    await expect(pollWorkdayRecent(identity, providerFetch, {
      knownIds: new Set(['R360004', 'R360005']),
    })).resolves.toMatchObject({
      completeness: 'unknown',
      credibleForClosure: false,
      allowMissingClosure: false,
      jobs: [],
      warnings: ['country_filter_unverified'],
    })
  })

  it('does not materialize a foreign-only detail where detail remains authoritative', async () => {
    const identity = resolveWorkdayIdentity(
      'capitalone',
      'wd12',
      'Capital_One',
      'jobs',
    ) as WorkdayIdentity
    const posting = {
      ...phase036Posting(6, 'Toronto, Canada'),
      title: 'Capital One Foreign Detail',
    }
    const providerFetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url !== `${identity.cxsRoot}/jobs`) {
        expect(url.endsWith(posting.externalPath)).toBe(true)
        return Promise.resolve(jsonResponse(phase036Detail(
          posting,
          'Canada',
          'CA',
        )))
      }
      const body = JSON.parse(String(init?.body)) as {
        appliedFacets: Record<string, string[]>
      }
      return Promise.resolve(body.appliedFacets.jobFamilyGroup === undefined
        ? jsonResponse({
            total: 1,
            jobPostings: [],
            facets: categoryFacets(1, 0),
          })
        : jsonResponse({
            total: 1,
            jobPostings: [posting],
            facets: categoryFacets(1, 0),
          }))
    })

    await expect(pollWorkdayRecent(identity, providerFetch)).resolves.toMatchObject({
      completeness: 'complete',
      credibleForClosure: true,
      allowMissingClosure: false,
      jobs: [],
      warnings: [],
    })
  })

  it('accepts an exact U.S.-scoped multi-location listing without requiring detail country', async () => {
    const expected = phase036Identities[1]
    const identity = resolveWorkdayIdentity(...expected.tuple) as WorkdayIdentity
    const posting = {
      ...phase036Posting(7, 'Toronto, CAN'),
      externalPath: '/job/Toronto-CAN/Phase-03-6-Multi-Location_360007-2',
      bulletFields: ['360007'],
    }
    const providerFetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url !== `${expected.cxsRoot}/jobs`) {
        throw new Error(`unexpected detail request: ${url}`)
      }
      const body = JSON.parse(String(init?.body)) as {
        appliedFacets: Record<string, string[]>
      }
      return Promise.resolve(body.appliedFacets.Location_Country === undefined
        ? jsonResponse({
            total: 2,
            jobPostings: [],
            facets: countryFacets(expected.route, 1),
          })
        : jsonResponse({ total: 1, jobPostings: [posting] }))
    })

    await expect(pollWorkdayRecent(identity, providerFetch)).resolves.toMatchObject({
      completeness: 'complete',
      credibleForClosure: true,
      allowMissingClosure: true,
      jobs: [{
        externalId: '360007',
        location: 'Toronto, CAN',
        snapshotPartial: true,
        companyName: 'S&P Global',
      }],
      warnings: [],
    })
    expect(providerFetch).toHaveBeenCalledTimes(2)
  })

  it('uses the exact Morningstar listing identity without depending on detail aliases', async () => {
    const expected = phase036Identities[2]
    const identity = resolveWorkdayIdentity(...expected.tuple) as WorkdayIdentity
    const posting = {
      title: 'Phase 03.6 Morningstar Alias',
      externalPath: '/job/Chicago/Phase-03-6-Morningstar-Alias_REQ-057624-1',
      locationsText: 'Chicago',
      postedOn: 'Posted Today',
      bulletFields: ['REQ-057624'],
    }
    const providerFetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url !== `${expected.cxsRoot}/jobs`) {
        throw new Error(`unexpected detail request: ${url}`)
      }
      const body = JSON.parse(String(init?.body)) as {
        appliedFacets: Record<string, string[]>
      }
      return Promise.resolve(body.appliedFacets.locationCountry === undefined
        ? jsonResponse({
            total: 2,
            jobPostings: [],
            facets: countryFacets(expected.route, 1),
          })
        : jsonResponse({ total: 1, jobPostings: [posting] }))
    })

    await expect(pollWorkdayRecent(identity, providerFetch)).resolves.toMatchObject({
      completeness: 'complete',
      credibleForClosure: true,
      allowMissingClosure: true,
      jobs: [{
        externalId: 'REQ-057624',
        snapshotPartial: true,
        companyName: 'Morningstar',
      }],
      warnings: [],
    })
    expect(providerFetch).toHaveBeenCalledTimes(2)
  })

  it('keeps scoped later-page drift, contradictory totals, and caps closure-ineligible', async () => {
    const identity = resolveWorkdayIdentity(
      'spgi',
      'wd5',
      'SPGI_Careers',
      'jobs',
    ) as WorkdayIdentity
    const postings = Array.from({ length: 21 }, (_, index) => phase036Posting(index + 10))
    let scopedPage = 0
    const driftFetch = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        appliedFacets: Record<string, string[]>
      }
      if (body.appliedFacets.Location_Country === undefined) {
        return Promise.resolve(jsonResponse({
          total: 22,
          jobPostings: [],
          facets: countryFacets(['Location_Country'], 21),
        }))
      }
      scopedPage += 1
      return Promise.resolve(scopedPage === 1
        ? jsonResponse({ total: 21, jobPostings: postings.slice(0, 20) })
        : jsonResponse({ total: 20, jobPostings: postings.slice(20) }))
    })
    await expect(pollWorkdayRecent(identity, driftFetch, {
      knownIds: new Set(postings.map((posting) => (
        posting.externalPath.match(/_(R\d+)/)?.[1] ?? ''
      ))),
    })).resolves.toMatchObject({
      credibleForClosure: false,
      allowMissingClosure: false,
      jobs: [],
      warnings: ['count_mismatch'],
    })

    const capFetch = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        appliedFacets: Record<string, string[]>
      }
      return Promise.resolve(body.appliedFacets.Location_Country === undefined
        ? jsonResponse({
            total: 3,
            jobPostings: [],
            facets: countryFacets(['Location_Country'], 2),
          })
        : jsonResponse({ total: 2, jobPostings: [phase036Posting(40)] }))
    })
    await expect(pollWorkdayRecent(identity, capFetch, {
      knownIds: new Set(['R360040']),
      maxListings: 1,
    })).resolves.toMatchObject({
      credibleForClosure: false,
      allowMissingClosure: false,
      warnings: ['recent_window_cap_exceeded'],
    })
  })

  it('keeps failed and successful identity observations request-local and independently settled', async () => {
    const nasdaq = resolveWorkdayIdentity(
      'nasdaq',
      'wd1',
      'Global_External_Site',
      'jobs',
    ) as WorkdayIdentity
    const morningstar = resolveWorkdayIdentity(
      'morningstar',
      'wd5',
      'morningstar',
      'jobs',
    ) as WorkdayIdentity
    const failedFetch = vi.fn().mockResolvedValue(jsonResponse({
      total: 1,
      jobPostings: [],
      facets: [],
    }))
    const successfulFetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const posting = phase036Posting(50)
      if (url !== `${phase036Identities[2].cxsRoot}/jobs`) {
        if (!url.endsWith(posting.externalPath)) throw new Error(`unexpected detail request: ${url}`)
        return Promise.resolve(jsonResponse(phase036Detail(posting)))
      }
      const body = JSON.parse(String(init?.body)) as {
        appliedFacets: Record<string, string[]>
      }
      return Promise.resolve(body.appliedFacets.locationCountry === undefined
        ? jsonResponse({
            total: 2,
            jobPostings: [],
            facets: countryFacets(['locationMainGroup', 'locationCountry'], 1),
          })
        : jsonResponse({ total: 1, jobPostings: [posting] }))
    })

    const settled = await Promise.allSettled([
      pollWorkdayRecent(nasdaq, failedFetch),
      pollWorkdayRecent(morningstar, successfulFetch, {
        knownIds: new Set(['R360050']),
      }),
    ])
    expect(settled).toHaveLength(2)
    expect(settled[0]).toMatchObject({
      status: 'fulfilled',
      value: {
        credibleForClosure: false,
        warnings: ['country_filter_unverified'],
      },
    })
    expect(settled[1]).toMatchObject({
      status: 'fulfilled',
      value: {
        completeness: 'complete',
        credibleForClosure: true,
        jobs: [{ externalId: 'R360050', companyName: 'Morningstar' }],
        warnings: [],
      },
    })
  })

  it('stages one exact U.S.-scoped source as experimental with one observation RPC', async () => {
    const expected = phase036Identities[0]
    const persisted = {
      id: 'nasdaq-company-1',
      name: expected.companyName,
      source_key: expected.sourceKey,
      activation_state: 'experimental',
    }
    let insertArg: Record<string, unknown> | null = null
    const single = vi.fn().mockResolvedValue({ data: persisted, error: null })
    const insert = vi.fn((value: Record<string, unknown>) => {
      insertArg = value
      return { select: vi.fn(() => ({ single })) }
    })
    const maybeSingle = vi.fn().mockResolvedValue({ data: persisted, error: null })
    const select = vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) }))
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
      const body = JSON.parse(String(init?.body)) as {
        appliedFacets: Record<string, string[]>
      }
      return Promise.resolve(body.appliedFacets[expected.facetParameter] === undefined
        ? jsonResponse({
            total: 2,
            jobPostings: [],
            facets: countryFacets(expected.route, 1),
          })
        : jsonResponse({ total: 1, jobPostings: [phase036Posting(60)] }))
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
      digestEvidence: async () => 'nasdaq-scope-digest',
      randomUUID: () => 'nasdaq-observation-1',
    })

    const response = await handler(new Request('https://example.test/functions/v1/verify-board', {
      method: 'POST',
      headers: {
        authorization: 'Bearer real-user-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ url: expected.publicBoard }),
    }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      company: { source_key: expected.sourceKey },
    })
    expect(insertArg).toMatchObject({
      name: expected.companyName,
      ats_type: 'workday',
      board_token: expected.tuple[0],
      region: expected.tuple[1],
      site_token: expected.tuple[2],
      source_key: expected.sourceKey,
      activation_state: 'experimental',
      last_observation_count: 1,
    })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('record_connector_observation', expect.objectContaining({
      p_company_id: persisted.id,
      p_job_count: 1,
      p_expected_count: 1,
      p_warning_count: 0,
    }))
  })
})

const phase038WorkdayCandidates = [
  {
    companyName: 'Morgan Stanley',
    tuple: ['ms', 'wd5', 'External', 'jobs'],
    sourceKey: 'workday:wd5:ms:External',
    origin: 'https://ms.wd5.myworkdayjobs.com',
    cxsRoot: 'https://ms.wd5.myworkdayjobs.com/wday/cxs/ms/External',
    publicBoard: 'https://ms.wd5.myworkdayjobs.com/en-US/External',
    proof: 'countryFacet',
  },
  {
    companyName: 'Bank of America',
    tuple: ['ghr', 'wd1', 'Lateral-US', 'jobs'],
    sourceKey: 'workday:wd1:ghr:Lateral-US',
    origin: 'https://ghr.wd1.myworkdayjobs.com',
    cxsRoot: 'https://ghr.wd1.myworkdayjobs.com/wday/cxs/ghr/Lateral-US',
    publicBoard: 'https://ghr.wd1.myworkdayjobs.com/en-US/Lateral-US',
    proof: 'wholeSite',
  },
  {
    companyName: 'BlackRock',
    tuple: ['blackrock', 'wd1', 'BlackRock_Professional', 'jobs'],
    sourceKey: 'workday:wd1:blackrock:BlackRock_Professional',
    origin: 'https://blackrock.wd1.myworkdayjobs.com',
    cxsRoot: 'https://blackrock.wd1.myworkdayjobs.com/wday/cxs/blackrock/BlackRock_Professional',
    publicBoard: 'https://blackrock.wd1.myworkdayjobs.com/en-US/BlackRock_Professional',
    proof: 'unsupported',
  },
  {
    companyName: 'Barclays',
    tuple: ['barclays', 'wd3', 'External_Career_Site_Barclays', 'jobs'],
    sourceKey: 'workday:wd3:barclays:External_Career_Site_Barclays',
    origin: 'https://barclays.wd3.myworkdayjobs.com',
    cxsRoot: 'https://barclays.wd3.myworkdayjobs.com/wday/cxs/barclays/External_Career_Site_Barclays',
    publicBoard: 'https://barclays.wd3.myworkdayjobs.com/en-US/External_Career_Site_Barclays',
    proof: 'unsupported',
  },
] as const

function phase038Posting(sequence: number, company: string) {
  return {
    title: `${company} Analyst ${sequence}`,
    externalPath: `/job/New-York/${company.replaceAll(' ', '-')}-Analyst-${sequence}_R38${String(sequence).padStart(4, '0')}-1`,
    locationsText: 'New York, NY',
    postedOn: 'Posted Today',
  }
}

function phase038Detail(
  posting: ReturnType<typeof phase038Posting>,
  country: { descriptor?: string; alpha2Code?: string } | null = {
    descriptor: UNITED_STATES_WORKDAY_DESCRIPTOR,
    alpha2Code: 'US',
  },
) {
  return {
    jobPostingInfo: {
      id: `opaque-${posting.externalPath}`,
      jobReqId: posting.externalPath.match(/_(R\d+)/)?.[1],
      title: posting.title,
      jobDescription: '<p>Authoritative Workday detail.</p>',
      location: posting.locationsText,
      postedOn: posting.postedOn,
      startDate: new Date().toISOString().slice(0, 10),
      jobRequisitionLocation: country === null ? {} : { country },
    },
  }
}

describe('Phase 03.8 exact Workday candidates and U.S. proof', () => {
  it('adds exactly four frozen candidates without changing the six existing identities', () => {
    expect(Object.keys(WORKDAY_IDENTITIES)).toHaveLength(21)
    for (const expected of phase038WorkdayCandidates) {
      const identity = resolveWorkdayIdentity(...expected.tuple)
      expect(identity).toMatchObject({
        companyName: expected.companyName,
        sourceKey: expected.sourceKey,
        origin: expected.origin,
        cxsRoot: expected.cxsRoot,
        publicBoard: expected.publicBoard,
        tenant: expected.tuple[0],
        region: expected.tuple[1],
        site: expected.tuple[2],
        hostForm: expected.tuple[3],
      })
      expect(Object.isFrozen(identity)).toBe(true)
    }
    expect(resolveWorkdayIdentity('capitalone', 'wd12', 'Capital_One', 'jobs'))
      .toBe(WORKDAY_IDENTITIES['workday:wd12:capitalone:Capital_One'])
    expect(resolveWorkdayIdentity('fmr', 'wd1', 'FidelityCareers', 'site'))
      .toBe(WORKDAY_IDENTITIES['workday:wd1:fmr:FidelityCareers'])
    expect(WORKDAY_IDENTITIES['workday:wd1:ghr:Lateral-US'])
      .toMatchObject({
        selectiveRecentUsScope: {
          titleIncludesAny: ['finance', 'analytics', 'data', 'research'],
        },
      })
    expect(WORKDAY_IDENTITIES['workday:wd5:ms:External']
      .selectiveRecentUsScope?.titleIncludesAny).toBeUndefined()
    expect(WORKDAY_IDENTITIES[
      'workday:wd3:barclays:External_Career_Site_Barclays'
    ].keptFacetIds).toEqual({
      'Data & Analytics': '1ab48a98eb7c1001e8e0bdc7d4a10000',
      Finance: '1ab48a98eb7c1001e8e0ccc6d3af0000',
      'Investment Banking': '112c054282011001e915f210568e0000',
      Research: '112c054282011001e9161cb8b7960000',
      Risk: '112c054282011001e9162220a12b0000',
      Technology: '112c054282011001e9162cfccdc10000',
    })
  })

  it('authorizes every selective candidate in the Experimental observation lane', async () => {
    for (const expected of phase038WorkdayCandidates) {
      const providerFetch = vi.fn().mockRejectedValue(new Error('network sentinel'))
      await expect(observeConnector({
        ats_type: 'workday',
        board_token: expected.tuple[0],
        region: expected.tuple[1],
        site_token: expected.tuple[2],
        source_key: expected.sourceKey,
        activation_state: 'experimental',
      }, providerFetch)).resolves.toMatchObject({
        completeness: 'unknown',
        warnings: ['network_error'],
      })
      expect(providerFetch).toHaveBeenCalled()
    }
  })

  it('rejects every one-field candidate tuple mutation before fetch', async () => {
    for (const expected of phase038WorkdayCandidates) {
      const [tenant, region, site, hostForm] = expected.tuple
      for (const tuple of [
        [`${tenant}-lookalike`, region, site, hostForm],
        [tenant, `${region}0`, site, hostForm],
        [tenant, region, `${site}-lookalike`, hostForm],
        [tenant, region, site, 'site'],
        [tenant.toUpperCase(), region, site, hostForm],
      ] as const) {
        expect(resolveWorkdayIdentity(...tuple)).toBeNull()
        const providerFetch = vi.fn()
        await expect(verifyConnector({
          ats: 'workday',
          slug: tuple[0],
          region: tuple[1],
          site: tuple[2],
          hostForm: tuple[3],
        } as SupportedDetection, providerFetch)).rejects.toThrow('invalid_identity')
        expect(providerFetch).not.toHaveBeenCalled()
      }
    }
  })

  it('requires Morgan Stanley exact facet reconciliation plus U.S. detail proof', async () => {
    const expected = phase038WorkdayCandidates[0]
    const identity = resolveWorkdayIdentity(...expected.tuple) as WorkdayIdentity
    const posting = phase038Posting(1, expected.companyName)
    const bodies: Array<Record<string, string[]>> = []
    const providerFetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url !== `${expected.cxsRoot}/jobs`) {
        expect(url.endsWith(posting.externalPath)).toBe(true)
        return Promise.resolve(jsonResponse(phase038Detail(posting)))
      }
      const body = JSON.parse(String(init?.body)) as {
        appliedFacets: Record<string, string[]>
      }
      bodies.push(body.appliedFacets)
      return Promise.resolve(body.appliedFacets.Location_Country === undefined
        ? jsonResponse({
            total: 2,
            jobPostings: [],
            facets: countryFacets(['Location_Country'], 1),
          })
        : jsonResponse({ total: 1, jobPostings: [posting] }))
    })

    await expect(pollWorkdayRecent(identity, providerFetch)).resolves.toMatchObject({
      completeness: 'complete',
      credibleForClosure: true,
      allowMissingClosure: false,
      expectedCount: 1,
      jobs: [{
        externalId: 'R380001',
        companyName: 'Morgan Stanley',
        scopeEvidence: {
          sourceKey: expected.sourceKey,
          detailCountryCode: 'US',
          selectionMode: 'recent_exact_us',
          recentDays: 7,
          titleKeywords: [],
          providerFacetLabels: [],
        },
      }],
      warnings: [],
    })
    expect(bodies).toEqual([
      {},
      { Location_Country: [UNITED_STATES_WORKDAY_FACET_ID] },
    ])
    expect(providerFetch).toHaveBeenCalledTimes(3)

    const foreignFetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (String(input) !== `${expected.cxsRoot}/jobs`) {
        return Promise.resolve(jsonResponse(phase038Detail(posting, {
          descriptor: 'Canada',
          alpha2Code: 'CA',
        })))
      }
      const body = JSON.parse(String(init?.body)) as {
        appliedFacets: Record<string, string[]>
      }
      return Promise.resolve(body.appliedFacets.Location_Country === undefined
        ? jsonResponse({
            total: 2,
            jobPostings: [],
            facets: countryFacets(['Location_Country'], 1),
          })
        : jsonResponse({ total: 1, jobPostings: [posting] }))
    })
    await expect(pollWorkdayRecent(identity, foreignFetch)).resolves.toMatchObject({
      credibleForClosure: false,
      allowMissingClosure: false,
      jobs: [],
      warnings: ['foreign_detail_detected'],
    })
  })

  it('authorizes Bank of America recent rows only from exact U.S. detail proof', async () => {
    const expected = phase038WorkdayCandidates[1]
    const identity = resolveWorkdayIdentity(...expected.tuple) as WorkdayIdentity
    const postings = [
      {
        ...phase038Posting(2, expected.companyName),
        title: 'Finance Analyst',
      },
      {
        ...phase038Posting(3, expected.companyName),
        title: 'Data Research Associate',
      },
      {
        ...phase038Posting(4, expected.companyName),
        title: 'Financial Services Representative',
      },
      {
        ...phase038Posting(5, expected.companyName),
        title: 'Finance Manager',
        postedOn: 'Posted 30+ Days Ago',
      },
    ]
    const providerFetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url === `${expected.cxsRoot}/jobs`) {
        expect(JSON.parse(String(init?.body))).toMatchObject({ appliedFacets: {} })
        return Promise.resolve(jsonResponse({ total: 4, jobPostings: postings }))
      }
      const posting = postings.find((candidate) => url.endsWith(candidate.externalPath))
      if (!posting) throw new Error(`unexpected detail: ${url}`)
      return Promise.resolve(jsonResponse(phase038Detail(posting)))
    })
    await expect(pollWorkdayRecent(identity, providerFetch)).resolves.toMatchObject({
      completeness: 'complete',
      credibleForClosure: true,
      allowMissingClosure: false,
      expectedCount: 2,
      jobs: [
        {
          externalId: 'R380002',
          companyName: 'Bank of America',
          scopeEvidence: {
            sourceKey: expected.sourceKey,
            detailCountryCode: 'US',
            selectionMode: 'recent_exact_us',
            recentDays: 7,
            titleKeywords: ['finance', 'analytics', 'data', 'research'],
            providerFacetLabels: [],
          },
        },
        {
          externalId: 'R380003',
          companyName: 'Bank of America',
          scopeEvidence: {
            sourceKey: expected.sourceKey,
            detailCountryCode: 'US',
            selectionMode: 'recent_exact_us',
            recentDays: 7,
            titleKeywords: ['finance', 'analytics', 'data', 'research'],
            providerFacetLabels: [],
          },
        },
      ],
      warnings: [],
    })
    expect(providerFetch).toHaveBeenCalledTimes(3)

    const missingCountryFetch = vi.fn((input: string | URL | Request) => {
      const url = String(input)
      if (url === `${expected.cxsRoot}/jobs`) {
        return Promise.resolve(jsonResponse({ total: 1, jobPostings: [postings[0]] }))
      }
      return Promise.resolve(jsonResponse(phase038Detail(postings[0], null)))
    })
    await expect(pollWorkdayRecent(identity, missingCountryFetch)).resolves.toMatchObject({
      credibleForClosure: false,
      allowMissingClosure: false,
      jobs: [],
      warnings: ['country_filter_unverified'],
    })
  })

  it.each(phase038WorkdayCandidates.slice(2))(
    'retains only recent exact-U.S. $companyName details without closure authority',
    async (expected) => {
      const identity = resolveWorkdayIdentity(...expected.tuple) as WorkdayIdentity
      const recentUs = phase038Posting(10, expected.companyName)
      const recentForeign = {
        ...phase038Posting(11, expected.companyName),
        postedOn: 'Posted 7 Days Ago',
      }
      const old = {
        ...phase038Posting(12, expected.companyName),
        postedOn: 'Posted 8 Days Ago',
      }
      const providerFetch = vi.fn((
        input: string | URL | Request,
        init?: RequestInit,
      ) => {
        const url = String(input)
        if (url === `${expected.cxsRoot}/jobs`) {
          const body = JSON.parse(String(init?.body)) as {
            appliedFacets: { jobFamilyGroup?: string[] }
          }
          const familyValues = Object.entries(identity.keptFacetIds ?? {})
            .map(([descriptor, id], index) => ({
              descriptor,
              id,
              count: index === 0 ? 3 : 0,
            }))
          if (identity.keptFacetIds) {
            expect(body.appliedFacets.jobFamilyGroup).toEqual(
              Object.values(identity.keptFacetIds),
            )
          }
          return Promise.resolve(jsonResponse({
            total: 3,
            jobPostings: [recentUs, recentForeign, old],
            facets: familyValues.length
              ? [{ facetParameter: 'jobFamilyGroup', values: familyValues }]
              : [],
          }))
        }
        if (url.endsWith(recentUs.externalPath)) {
          return Promise.resolve(jsonResponse(phase038Detail(recentUs)))
        }
        if (url.endsWith(recentForeign.externalPath)) {
          return Promise.resolve(jsonResponse(phase038Detail(recentForeign, {
            descriptor: 'Canada',
            alpha2Code: 'CA',
          })))
        }
        throw new Error(`unexpected detail: ${url}`)
      })
      await expect(pollWorkdayRecent(identity, providerFetch)).resolves.toMatchObject({
        completeness: 'complete',
        credibleForClosure: true,
        allowMissingClosure: false,
        expectedCount: 1,
        jobs: [{
          externalId: 'R380010',
          companyName: expected.companyName,
          scopeEvidence: {
            sourceKey: expected.sourceKey,
            detailCountryCode: 'US',
            selectionMode: 'recent_exact_us',
            recentDays: 7,
            titleKeywords: [],
            providerFacetLabels: expected.companyName === 'Barclays'
              ? [
                  'Data & Analytics',
                  'Finance',
                  'Investment Banking',
                  'Research',
                  'Risk',
                  'Technology',
                ]
              : [],
          },
        }],
        warnings: [],
      })
      expect(providerFetch).toHaveBeenCalledTimes(3)
    },
  )

  it('scans all Morgan Stanley list pages before hydrating only recent details', async () => {
    const expected = phase038WorkdayCandidates[0]
    const identity = resolveWorkdayIdentity(...expected.tuple) as WorkdayIdentity
    const postings = Array.from({ length: 963 }, (_, index) => ({
      ...phase038Posting(index + 100, expected.companyName),
      postedOn: index === 0 || index === 40
        ? 'Posted 2 Days Ago'
        : 'Posted 8 Days Ago',
    }))
    const recent = postings.filter((posting) => posting.postedOn === 'Posted 2 Days Ago')
    const providerFetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url !== `${expected.cxsRoot}/jobs`) {
        const posting = recent.find((candidate) => url.endsWith(candidate.externalPath))
        if (!posting) throw new Error(`unexpected detail: ${url}`)
        return Promise.resolve(jsonResponse(phase038Detail(posting)))
      }
      const body = JSON.parse(String(init?.body)) as {
        appliedFacets: Record<string, string[]>
        offset: number
      }
      if (body.appliedFacets.Location_Country === undefined) {
        return Promise.resolve(jsonResponse({
          total: 963,
          jobPostings: [],
          facets: countryFacets(['Location_Country'], 963),
        }))
      }
      return Promise.resolve(jsonResponse({
        total: 963,
        jobPostings: postings.slice(body.offset, body.offset + 20),
      }))
    })

    await expect(pollWorkdayRecent(identity, providerFetch)).resolves.toMatchObject({
      completeness: 'complete',
      credibleForClosure: true,
      allowMissingClosure: false,
      expectedCount: 2,
      pageCount: 49,
      warnings: [],
    })
    expect(providerFetch).toHaveBeenCalledTimes(52)
  })
})

describe('Fidelity category-scoped recent import', () => {
  const nowMs = Date.parse('2026-07-20T12:00:00.000Z')
  const fidelityIdentity = resolveWorkdayIdentity('fmr', 'wd1', 'FidelityCareers', 'site') as WorkdayIdentity
  const liveTombstone = { bulletFields: ['2131450'] }

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
  const liveNumericPosting = {
    title: 'Full Stack Developer',
    externalPath: '/job/Westlake-TX/Full-Stack-Developer_2130089-2',
    locationsText: 'Westlake, TX',
    postedOn: 'Posted Today',
    bulletFields: ['2130089'],
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

  function numericDetail(jobReqId: string | null = '2130089') {
    return {
      jobPostingInfo: {
        id: 'opaque-2130089',
        ...(jobReqId === null ? {} : { jobReqId }),
        title: liveNumericPosting.title,
        jobDescription: '<p>Basic Qualifications</p><p>1 year of experience</p>',
        location: liveNumericPosting.locationsText,
        postedOn: liveNumericPosting.postedOn,
        startDate: '2026-07-20',
        jobRequisitionLocation: {
          country: { descriptor: 'United States of America', alpha2Code: 'US' },
        },
      },
    }
  }

  function numericPostingFetch(
    posting: Record<string, unknown> = liveNumericPosting,
    detail: unknown = numericDetail(),
  ) {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === fidelityListUrl) {
        const body = JSON.parse(String(init?.body)) as {
          appliedFacets: { jobFamilyGroup?: string[] }
        }
        return body.appliedFacets.jobFamilyGroup === undefined
          ? jsonResponse({
              total: 1,
              jobPostings: [],
              facets: fidelityFacets({ it: 1, rm: 0, sales: 0, customerService: 0, salesSupport: 0 }),
            })
          : jsonResponse({
              total: 1,
              jobPostings: [posting],
            })
      }
      return jsonResponse(detail)
    })
  }

  it('uses the exact live numeric requisition ID on the known-ID fast path', async () => {
    const providerFetch = numericPostingFetch()
    const observation = await pollWorkdayRecent(fidelityIdentity, providerFetch, {
      knownIds: new Set(['2130089']),
      nowMs,
    })

    expect(providerFetch).toHaveBeenCalledTimes(2)
    expect(observation).toMatchObject({
      completeness: 'complete',
      allowMissingClosure: false,
      jobs: [{
        externalId: '2130089',
        title: 'Full Stack Developer',
        snapshotPartial: true,
      }],
    })
  })

  it('maps a live numeric requisition only when detail identity agrees', async () => {
    const providerFetch = numericPostingFetch()
    const observation = await pollWorkdayRecent(fidelityIdentity, providerFetch, { nowMs })

    expect(providerFetch).toHaveBeenCalledTimes(3)
    expect(observation).toMatchObject({
      completeness: 'complete',
      jobs: [{
        externalId: '2130089',
        title: 'Full Stack Developer',
        snapshotPartial: false,
      }],
    })
  })

  it.each([
    ['missing bullet fields', { bulletFields: undefined }],
    ['multiple bullet fields', { bulletFields: ['2130089', '2130090'] }],
    ['unsafe bullet identifier', { bulletFields: ['213\u00000089'] }],
    ['mismatched bullet identifier', { bulletFields: ['2130090'] }],
    ['zero path suffix', { externalPath: '/job/Westlake-TX/Full-Stack-Developer_2130089-0' }],
    ['nonnumeric path suffix', { externalPath: '/job/Westlake-TX/Full-Stack-Developer_2130089-copy' }],
    ['nonterminal path identifier', { externalPath: '/job/Westlake-TX/Full-Stack-Developer_x2130089-2' }],
  ])('rejects numeric listing identity with %s', async (_name, override) => {
    const posting = { ...liveNumericPosting, ...override }
    await expect(pollWorkdayRecent(
      fidelityIdentity,
      numericPostingFetch(posting),
      { nowMs },
    )).resolves.toMatchObject({
      completeness: 'unknown',
      credibleForClosure: false,
      jobs: [],
      warnings: ['provider_identity_drift'],
    })
  })

  it.each([
    ['missing', null],
    ['inconsistent', '2130090'],
  ])('rejects %s numeric detail jobReqId', async (_name, jobReqId) => {
    await expect(pollWorkdayRecent(
      fidelityIdentity,
      numericPostingFetch(liveNumericPosting, numericDetail(jobReqId)),
      { nowMs },
    )).resolves.toMatchObject({
      completeness: 'unknown',
      credibleForClosure: false,
      jobs: [],
      warnings: ['provider_identity_drift'],
    })
  })

  it('retains safe partial rows when a later detail has provider identity drift', async () => {
    const providerFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url === fidelityListUrl) {
        const body = JSON.parse(String(init?.body)) as {
          appliedFacets: { jobFamilyGroup?: string[] }
        }
        return body.appliedFacets.jobFamilyGroup === undefined
          ? jsonResponse({
              total: 2,
              jobPostings: [],
              facets: fidelityFacets({
                it: 2,
                rm: 0,
                sales: 0,
                customerService: 0,
                salesSupport: 0,
              }),
            })
          : jsonResponse({
              total: 2,
              jobPostings: [fidPostingA, liveNumericPosting],
            })
      }
      if (url.endsWith(fidPostingA.externalPath)) return jsonResponse(fidDetail(fidPostingA))
      if (url.endsWith(liveNumericPosting.externalPath)) return jsonResponse(numericDetail('2130090'))
      throw new Error(`unexpected request: ${url}`)
    })

    await expect(pollWorkdayRecent(
      fidelityIdentity,
      providerFetch,
      { nowMs },
    )).resolves.toMatchObject({
      completeness: 'partial',
      credibleForClosure: false,
      allowMissingClosure: false,
      jobs: [{ externalId: 'R200001' }],
      warnings: ['provider_identity_drift'],
    })
  })

  it('counts a strict tombstone as a raw row without mapping, fetching, or closing it', async () => {
    const offsets: number[] = []
    const oldPosting = {
      ...fidPostingB,
      postedOn: 'Posted 8 Days Ago',
    }
    const providerFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe(fidelityListUrl)
      const body = JSON.parse(String(init?.body)) as {
        appliedFacets: { jobFamilyGroup?: string[] }
        offset: number
      }
      if (body.appliedFacets.jobFamilyGroup === undefined) {
        return jsonResponse({
          total: 3,
          jobPostings: [],
          facets: fidelityFacets({ it: 3, rm: 0, sales: 0, customerService: 0, salesSupport: 0 }),
        })
      }
      offsets.push(body.offset)
      return body.offset === 0
        ? jsonResponse({
            total: 3,
            jobPostings: [fidPostingA, liveTombstone],
          })
        : jsonResponse({
            total: 3,
            jobPostings: [oldPosting],
          })
    })

    const observation = await pollWorkdayRecent(fidelityIdentity, providerFetch, {
      knownIds: new Set(['R200001', '2131450']),
      nowMs,
    })

    expect(offsets).toEqual([0, 2])
    expect(providerFetch).toHaveBeenCalledTimes(3)
    expect(observation).toMatchObject({
      completeness: 'complete',
      credibleForClosure: true,
      allowMissingClosure: false,
      expectedCount: 1,
      jobs: [{ externalId: 'R200001', snapshotPartial: true }],
      warnings: [],
    })
    expect(observation.jobs.some((job) => job.externalId === '2131450')).toBe(false)
  })

  it('accepts the live nonempty later-page zero sentinel with raw tombstone offsets', async () => {
    const makePosting = (sequence: number, postedOn = 'Posted Today') => ({
      ...fidPostingA,
      title: `Software Engineer ${sequence}`,
      externalPath: `/job/Boston-MA/Software-Engineer-${sequence}_R${String(sequence).padStart(6, '0')}-1`,
      postedOn,
    })
    const recentPostings = Array.from({ length: 59 }, (_, index) => makePosting(index + 1))
    const filteredPages = new Map<number, unknown[]>([
      [0, [...recentPostings.slice(0, 18), liveTombstone, recentPostings[18]]],
      [20, recentPostings.slice(19, 39)],
      [40, recentPostings.slice(39, 59)],
      [60, Array.from({ length: 20 }, (_, index) => makePosting(index + 60, 'Posted 8 Days Ago'))],
    ])
    const offsets: number[] = []
    const providerFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe(fidelityListUrl)
      const body = JSON.parse(String(init?.body)) as {
        appliedFacets: { jobFamilyGroup?: string[] }
        offset: number
      }
      if (body.appliedFacets.jobFamilyGroup === undefined) {
        return jsonResponse({
          total: 506,
          jobPostings: [],
          facets: fidelityFacets({ it: 506, rm: 0, sales: 0, customerService: 0, salesSupport: 0 }),
        })
      }
      offsets.push(body.offset)
      const jobPostings = filteredPages.get(body.offset)
      if (!jobPostings) throw new Error(`unexpected offset: ${body.offset}`)
      return jsonResponse({
        total: body.offset === 0 ? 506 : 0,
        jobPostings,
      })
    })

    const observation = await pollWorkdayRecent(fidelityIdentity, providerFetch, {
      knownIds: new Set(recentPostings.map((posting) => (
        posting.externalPath.match(/_(R\d+)/)?.[1] ?? ''
      ))),
      nowMs,
    })

    expect(offsets).toEqual([0, 20, 40, 60])
    expect(providerFetch).toHaveBeenCalledTimes(5)
    expect(observation).toMatchObject({
      completeness: 'complete',
      credibleForClosure: true,
      allowMissingClosure: false,
      expectedCount: 59,
      warnings: [],
    })
    expect(observation.jobs).toHaveLength(59)
    expect(observation.jobs.some((job) => job.externalId === '2131450')).toBe(false)
  })

  it.each([
    ['first-page zero', 1, [
      { total: 0, jobPostings: [fidPostingA] },
    ], 'category_filter_unverified'],
    ['later empty zero', 2, [
      { total: 2, jobPostings: [fidPostingA] },
      { total: 0, jobPostings: [] },
    ], 'count_mismatch'],
    ['later nonzero drift', 2, [
      { total: 2, jobPostings: [fidPostingA] },
      { total: 1, jobPostings: [{ ...fidPostingB, postedOn: 'Posted 8 Days Ago' }] },
    ], 'count_mismatch'],
    ['raw overcount', 1, [
      { total: 1, jobPostings: [fidPostingA, liveTombstone] },
    ], 'count_mismatch'],
  ])('keeps polling %s fail-closed', async (_name, discoveryTotal, pages, warning) => {
    let filteredPage = 0
    const providerFetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        appliedFacets: { jobFamilyGroup?: string[] }
      }
      if (body.appliedFacets.jobFamilyGroup === undefined) {
        return jsonResponse({
          total: discoveryTotal,
          jobPostings: [],
          facets: fidelityFacets({
            it: discoveryTotal,
            rm: 0,
            sales: 0,
            customerService: 0,
            salesSupport: 0,
          }),
        })
      }
      return jsonResponse(pages[filteredPage++])
    })

    await expect(pollWorkdayRecent(fidelityIdentity, providerFetch, { nowMs })).resolves.toMatchObject({
      completeness: 'unknown',
      credibleForClosure: false,
      jobs: [],
      warnings: [warning],
    })
  })

  it('counts a tombstone toward the raw recent-listing cap', async () => {
    const providerFetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        appliedFacets: { jobFamilyGroup?: string[] }
      }
      return body.appliedFacets.jobFamilyGroup === undefined
        ? jsonResponse({
            total: 2,
            jobPostings: [],
            facets: fidelityFacets({ it: 2, rm: 0, sales: 0, customerService: 0, salesSupport: 0 }),
          })
        : jsonResponse({
            total: 2,
            jobPostings: [liveTombstone],
          })
    })

    await expect(pollWorkdayRecent(fidelityIdentity, providerFetch, {
      maxListings: 1,
      nowMs,
    })).resolves.toMatchObject({
      completeness: 'unknown',
      credibleForClosure: false,
      jobs: [],
      warnings: ['recent_window_cap_exceeded'],
    })
  })

  it.each([
    ['empty fields', { bulletFields: [] }],
    ['control-character identifier', { bulletFields: ['213\u00001450'] }],
    ['extra field', { bulletFields: ['2131450'], title: 'Not a job' }],
  ])('fails closed on a polling tombstone with %s', async (_name, tombstone) => {
    const providerFetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        appliedFacets: { jobFamilyGroup?: string[] }
      }
      return body.appliedFacets.jobFamilyGroup === undefined
        ? jsonResponse({
            total: 1,
            jobPostings: [],
            facets: fidelityFacets({ it: 1, rm: 0, sales: 0, customerService: 0, salesSupport: 0 }),
          })
        : jsonResponse({
            total: 1,
            jobPostings: [tombstone],
          })
    })

    await expect(pollWorkdayRecent(fidelityIdentity, providerFetch, { nowMs })).resolves.toMatchObject({
      completeness: 'unknown',
      credibleForClosure: false,
      jobs: [],
      warnings: ['provider_schema_invalid'],
    })
  })

  it.each([
    ['duplicate tombstones', [liveTombstone, liveTombstone]],
    ['listing identifier collision', [
      {
        ...fidPostingA,
        externalPath: '/job/Boston-MA/Software-Engineer_2131450',
        bulletFields: ['2131450'],
      },
      liveTombstone,
    ]],
    ['legacy occurrence-suffix collision', [
      fidPostingA,
      { bulletFields: ['R200001'] },
    ]],
    ['numeric occurrence-suffix collision', [
      liveNumericPosting,
      { bulletFields: ['2130089'] },
    ]],
    ['duplicate listing paths', [fidPostingA, fidPostingA]],
  ])('rejects polling %s', async (_name, jobPostings) => {
    const providerFetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        appliedFacets: { jobFamilyGroup?: string[] }
      }
      return body.appliedFacets.jobFamilyGroup === undefined
        ? jsonResponse({
            total: 2,
            jobPostings: [],
            facets: fidelityFacets({ it: 2, rm: 0, sales: 0, customerService: 0, salesSupport: 0 }),
          })
        : jsonResponse({
            total: 2,
            jobPostings,
          })
    })

    await expect(pollWorkdayRecent(fidelityIdentity, providerFetch, { nowMs })).resolves.toMatchObject({
      completeness: 'unknown',
      credibleForClosure: false,
      jobs: [],
      warnings: ['count_mismatch'],
    })
  })

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
        { externalId: 'R200001', companyName: 'Fidelity' },
        { externalId: 'R200002', companyName: 'Fidelity' },
      ],
    })
  })

  it('retains recent kept-family Fidelity roles for downstream location and experience filtering', async () => {
    const nonUsDetail = fidDetail(fidPostingA)
    nonUsDetail.jobPostingInfo.jobDescription =
      '<p>Basic Qualifications</p><p>At least 4 years of experience</p>'
    nonUsDetail.jobPostingInfo.jobRequisitionLocation.country = {
      descriptor: 'Canada',
      alpha2Code: 'CA',
    }
    const experiencedUsDetail = fidDetail(fidPostingB)
    experiencedUsDetail.jobPostingInfo.jobDescription =
      '<p>Required Qualifications</p><p>5+ years of experience</p>'

    const providerFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url === fidelityListUrl) {
        const body = JSON.parse(String(init?.body)) as {
          appliedFacets: { jobFamilyGroup?: string[] }
        }
        return body.appliedFacets.jobFamilyGroup === undefined
          ? jsonResponse({
              total: 2,
              jobPostings: [],
              facets: fidelityFacets({
                it: 1,
                rm: 1,
                sales: 0,
                customerService: 0,
                salesSupport: 0,
              }),
            })
          : jsonResponse({
              total: 2,
              jobPostings: [fidPostingA, fidPostingB],
            })
      }
      if (url.endsWith(fidPostingA.externalPath)) return jsonResponse(nonUsDetail)
      if (url.endsWith(fidPostingB.externalPath)) return jsonResponse(experiencedUsDetail)
      throw new Error(`unexpected request: ${url}`)
    })

    await expect(pollWorkdayRecent(
      fidelityIdentity,
      providerFetch,
      { nowMs },
    )).resolves.toMatchObject({
      completeness: 'complete',
      jobs: [
        { externalId: 'R200001', location: 'Boston, MA' },
        { externalId: 'R200002', location: 'Boston, MA' },
      ],
      warnings: [],
    })
  })

  it('fails closed when Workday ignores the discovered Fidelity inclusion facets', async () => {
    const postings = Array.from({ length: 5 }, (_, index) => ({
      ...fidPostingA,
      title: `Scoped role ${index + 1}`,
      externalPath: `/job/Boston-MA/Scoped-role-${index + 1}_R30000${index + 1}-1`,
    }))
    const providerFetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        appliedFacets: { jobFamilyGroup?: string[] }
      }
      return body.appliedFacets.jobFamilyGroup === undefined
        ? jsonResponse({
            total: 5,
            jobPostings: [],
            facets: fidelityFacets({
              it: 1,
              rm: 1,
              sales: 1,
              customerService: 1,
              salesSupport: 1,
            }),
          })
        : jsonResponse({
            // The provider ignored the two kept-family IDs and returned the
            // unfiltered total. List rows cannot reveal which family leaked.
            total: 5,
            jobPostings: postings,
          })
    })

    await expect(pollWorkdayRecent(fidelityIdentity, providerFetch, {
      knownIds: new Set(postings.map((posting) => (
        posting.externalPath.match(/_(R\d+)/)?.[1] ?? ''
      ))),
      nowMs,
    })).resolves.toMatchObject({
      completeness: 'unknown',
      credibleForClosure: false,
      jobs: [],
      warnings: ['category_filter_unverified'],
    })
  })

  it.each([
    ['negative counts', [
      { descriptor: 'Information Technology', id: 'fmr-it', count: 3 },
      { descriptor: 'Relationship Management', id: 'fmr-rm', count: -1 },
      { descriptor: 'Sales', id: 'fmr-sales', count: 0 },
      { descriptor: 'Customer Service', id: 'fmr-cs', count: 0 },
      { descriptor: 'Sales Support', id: 'fmr-ss', count: 0 },
    ]],
    ['duplicate descriptors', [
      { descriptor: 'Information Technology', id: 'fmr-it', count: 1 },
      { descriptor: 'Information Technology', id: 'fmr-other', count: 1 },
      { descriptor: 'Sales', id: 'fmr-sales', count: 0 },
      { descriptor: 'Customer Service', id: 'fmr-cs', count: 0 },
      { descriptor: 'Sales Support', id: 'fmr-ss', count: 0 },
    ]],
    ['duplicate IDs', [
      { descriptor: 'Information Technology', id: 'fmr-kept', count: 1 },
      { descriptor: 'Relationship Management', id: 'fmr-kept', count: 1 },
      { descriptor: 'Sales', id: 'fmr-sales', count: 0 },
      { descriptor: 'Customer Service', id: 'fmr-cs', count: 0 },
      { descriptor: 'Sales Support', id: 'fmr-ss', count: 0 },
    ]],
  ])('fails closed on Fidelity facet discovery with %s', async (_name, values) => {
    const providerFetch = vi.fn().mockResolvedValue(jsonResponse({
      total: 2,
      jobPostings: [],
      facets: [{ facetParameter: 'jobFamilyGroup', values }],
    }))

    await expect(pollWorkdayRecent(
      fidelityIdentity,
      providerFetch,
      { nowMs },
    )).resolves.toMatchObject({
      completeness: 'unknown',
      credibleForClosure: false,
      jobs: [],
      warnings: ['category_filter_unverified'],
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
        bulletFields: ['2131450'],
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
      ['legacy occurrence suffix', fidVerifyPosting, { bulletFields: ['R200001'] }],
      ['numeric occurrence suffix', {
        ...fidVerifyPosting,
        externalPath: '/job/Westlake-TX/Full-Stack-Developer_2130089-2',
        bulletFields: ['2130089'],
      }, { bulletFields: ['2130089'] }],
    ])('rejects a listing/tombstone collision with %s', async (_name, posting, tombstone) => {
      await expect(verifyWorkdayListing(
        vi.fn().mockResolvedValue(jsonResponse({
          total: 2,
          jobPostings: [posting, tombstone],
        })),
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

    it('rejects exact-path overlap with conflicting numeric requisition identity', async () => {
      const numericPosting = {
        ...fidVerifyPosting,
        externalPath: '/job/Westlake-TX/Full-Stack-Developer_2130089-2',
        bulletFields: ['2130089'],
      }
      await expect(verifyWorkdayListing(
        vi.fn().mockResolvedValue(jsonResponse({
          total: 2,
          jobPostings: [
            numericPosting,
            { ...numericPosting, bulletFields: ['2130090'] },
          ],
        })),
        {},
        fidelityIdentity,
      )).rejects.toThrow('provider_identity_drift')
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
      name: 'Fidelity',
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
      name: 'Fidelity',
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

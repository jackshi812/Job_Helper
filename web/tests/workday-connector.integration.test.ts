import { describe, expect, it, vi } from 'vitest'
import {
  CAPITAL_ONE_WORKDAY_SOURCE_KEY,
  pollWorkday,
} from '../../supabase/functions/_shared/adapters/workday.ts'
import {
  pollConnector,
  providerRegistry,
  verifyConnector,
} from '../../supabase/functions/_shared/connectors.ts'
import { detectAts } from '../../supabase/functions/_shared/detect.ts'
import { createVerifyBoardHandler } from '../../supabase/functions/verify-board/index.ts'
import catalogSql from '../../supabase/migrations/0013_source_coverage_catalog.sql?raw'
import migrationSql from '../../supabase/migrations/0016_workday_experimental.sql?raw'
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

  it('registers Workday for manual verification but blocks scheduled dispatch', async () => {
    expect(Object.keys(providerRegistry).sort()).toEqual([
      'ashby',
      'greenhouse',
      'lever',
      'recruitee',
      'smartrecruiters',
      'workday',
    ])
    const providerFetch = vi.fn()
    vi.stubGlobal('fetch', providerFetch)
    await expect(pollConnector({
      ats_type: 'workday',
      board_token: 'capitalone',
      region: null,
      activation_state: 'active',
    }, new Set())).rejects.toThrow('inactive_connector:workday_experimental_only')
    expect(providerFetch).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('keeps final database and source unions closed with Adzuna as jobs-only exception', () => {
    const companyCheck = migrationSql.match(/companies_ats_type_check check \(([\s\S]*?)\n  \)/)?.[1] ?? ''
    const jobCheck = migrationSql.match(/jobs_source_check check \(([\s\S]*?)\n  \)/)?.[1] ?? ''
    const direct = ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'recruitee', 'workday']
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
    expect(migrationSql).toContain("activation_state = 'experimental'")
    expect(migrationSql).toMatch(/ats_type in \('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'recruitee'\)/)
    expect(migrationSql).toContain('Only Plan 07 real-user verify-board may create/reconcile')
    expect(migrationSql).toContain('expects zero Workday job rows')
    expect(migrationSql).not.toMatch(/insert into public\.companies/i)
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

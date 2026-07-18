import { describe, expect, it } from 'vitest'
import {
  mapGreenhouseJob,
} from '../../supabase/functions/_shared/adapters/greenhouse'
import {
  mapLeverPosting,
} from '../../supabase/functions/_shared/adapters/lever'
import {
  mapAshbyJob,
  mapAshbyJobs,
} from '../../supabase/functions/_shared/adapters/ashby'
import {
  mapWorkdayDetail,
} from '../../supabase/functions/_shared/adapters/workday'
import {
  DEFAULT_MAX_DETAIL_REQUESTS,
  DEFAULT_TOTAL_DURATION_MS,
  pollSmartRecruiters,
} from '../../supabase/functions/_shared/adapters/smartrecruiters'

const decodeFixtureHtml = (value: string) =>
  value.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')

const smartRecruitersPosting = (id: number, withDescription = false) => ({
  id: `sr-${id}`,
  name: `Platform Engineer ${id}`,
  releasedDate: '2026-07-17T12:00:00Z',
  ref: `https://jobs.smartrecruiters.com/SmartRecruiters/${id}`,
  location: { city: 'Chicago', region: 'Illinois', country: 'US' },
  company: { name: 'SmartRecruiters' },
  ...(withDescription
    ? { jobAd: { sections: { jobDescription: { text: `<p>Build platform ${id}.</p>` } } } }
    : {}),
})

const jsonResponse = (payload: unknown) => new Response(JSON.stringify(payload), {
  status: 200,
  headers: { 'content-type': 'application/json' },
})

describe('Greenhouse adapter mapping', () => {
  it('normalizes a live-shaped list item plus decoded detail content', () => {
    const job = mapGreenhouseJob(
      {
        id: 7954688,
        title: 'Software Engineer',
        first_published: '2026-06-02T08:58:57-04:00',
        absolute_url: 'https://stripe.com/jobs/search?gh_jid=7954688',
        location: { name: 'San Francisco, CA' },
        company_name: 'Stripe',
        content: '&lt;h2&gt;Build payments &amp; infrastructure&lt;/h2&gt;',
      },
      decodeFixtureHtml,
    )

    expect(job).toEqual({
      source: 'greenhouse',
      externalId: '7954688',
      title: 'Software Engineer',
      location: 'San Francisco, CA',
      absoluteUrl: 'https://stripe.com/jobs/search?gh_jid=7954688',
      postedAt: '2026-06-02T12:58:57.000Z',
      descriptionHtml: '<h2>Build payments & infrastructure</h2>',
      descriptionText: 'Build payments & infrastructure',
      snapshotPartial: false,
      companyName: 'Stripe',
    })
  })
})

describe('Lever adapter mapping', () => {
  it('treats createdAt as epoch milliseconds and assembles full HTML', () => {
    const job = mapLeverPosting({
      id: 'a379fcb3-b235-41d4-951f-d533f294a01e',
      text: 'Forward Deployed Software Engineer',
      createdAt: 1711403416463,
      hostedUrl: 'https://jobs.lever.co/palantir/a379fcb3',
      categories: { location: 'New York, NY' },
      description: '<p>Build critical systems.</p>',
      descriptionPlain: 'Build critical systems.',
      lists: [
        { text: 'What we value', content: '<ul><li>Ownership</li></ul>' },
      ],
      additional: '<p>Equal opportunity employer.</p>',
      additionalPlain: 'Equal opportunity employer.',
    })

    expect(job.postedAt).toBe(new Date(1711403416463).toISOString())
    expect(job.descriptionHtml).toBe(
      '<p>Build critical systems.</p><h3>What we value</h3><ul><li>Ownership</li></ul><p>Equal opportunity employer.</p>',
    )
    expect(job).toMatchObject({
      source: 'lever',
      externalId: 'a379fcb3-b235-41d4-951f-d533f294a01e',
      title: 'Forward Deployed Software Engineer',
      location: 'New York, NY',
      absoluteUrl: 'https://jobs.lever.co/palantir/a379fcb3',
      snapshotPartial: false,
      companyName: null,
    })
  })
})

describe('Ashby adapter mapping', () => {
  const listed = {
    id: 'e1a8aefa-8c75-4f8f-8b3c-cf959e14a081',
    title: ' Security Engineer, Cloud ',
    publishedAt: '2026-04-07T17:12:35.753+00:00',
    jobUrl: 'https://jobs.ashbyhq.com/ramp/e1a8aefa',
    location: 'New York, NY',
    isListed: true,
    descriptionHtml: '<p>Secure financial infrastructure.</p>',
    descriptionPlain: 'Secure financial infrastructure.',
  }

  it('trims titles and preserves the full snapshot', () => {
    expect(mapAshbyJob(listed)).toEqual({
      source: 'ashby',
      externalId: 'e1a8aefa-8c75-4f8f-8b3c-cf959e14a081',
      title: 'Security Engineer, Cloud',
      location: 'New York, NY',
      absoluteUrl: 'https://jobs.ashbyhq.com/ramp/e1a8aefa',
      postedAt: '2026-04-07T17:12:35.753Z',
      descriptionHtml: '<p>Secure financial infrastructure.</p>',
      descriptionText: 'Secure financial infrastructure.',
      snapshotPartial: false,
      companyName: null,
    })
  })

  it('filters unlisted jobs at the list mapping boundary', () => {
    expect(
      mapAshbyJobs([
        listed,
        { ...listed, id: 'hidden', title: 'Hidden role', isListed: false },
      ]).map((job) => job.externalId),
    ).toEqual(['e1a8aefa-8c75-4f8f-8b3c-cf959e14a081'])
  })
})

describe('Workday adapter mapping', () => {
  it('normalizes a validated Capital One detail without trusting display identity', () => {
    expect(mapWorkdayDetail({
      jobPostingInfo: {
        id: 'R123456',
        title: 'Senior Software Engineer',
        jobDescription: '<p>Build reliable financial systems.</p>',
        location: 'Chicago, IL',
        postedOn: 'Posted 2 Days Ago',
      },
    }, '/job/Chicago-IL/Senior-Software-Engineer_R123456')).toEqual({
      source: 'workday',
      externalId: 'R123456',
      title: 'Senior Software Engineer',
      location: 'Chicago, IL',
      absoluteUrl: 'https://capitalone.wd12.myworkdayjobs.com/Capital_One/job/Chicago-IL/Senior-Software-Engineer_R123456',
      postedAt: null,
      descriptionHtml: '<p>Build reliable financial systems.</p>',
      descriptionText: 'Build reliable financial systems.',
      snapshotPartial: false,
      companyName: 'Capital One',
    })
  })
})

describe('SmartRecruiters invocation budgets', () => {
  it('uses the exact production count and duration defaults', () => {
    expect(DEFAULT_MAX_DETAIL_REQUESTS).toBe(40)
    expect(DEFAULT_TOTAL_DURATION_MS).toBe(60_000)
  })

  it('stops before detail request 41 and retains safe partial rows', async () => {
    const postings = Array.from(
      { length: DEFAULT_MAX_DETAIL_REQUESTS + 1 },
      (_, index) => smartRecruitersPosting(index + 1),
    )
    const detailIds: string[] = []
    const providerFetch = async (input: string | URL | Request) => {
      const url = String(input)
      const detailId = url.match(/\/postings\/(sr-\d+)$/)?.[1]
      if (!detailId) {
        return jsonResponse({ totalFound: postings.length, content: postings })
      }
      detailIds.push(detailId)
      const posting = postings.find(({ id }) => id === detailId)
      return jsonResponse({ ...posting, ...smartRecruitersPosting(Number(detailId.slice(3)), true) })
    }

    const observation = await pollSmartRecruiters('SmartRecruiters', providerFetch)

    expect(detailIds).toHaveLength(DEFAULT_MAX_DETAIL_REQUESTS)
    expect(detailIds).not.toContain(`sr-${DEFAULT_MAX_DETAIL_REQUESTS + 1}`)
    expect(observation).toMatchObject({
      completeness: 'partial',
      credibleForClosure: false,
      expectedCount: postings.length,
      pageCount: 1,
      warnings: ['detail_budget_exceeded'],
    })
    expect(observation.jobs).toHaveLength(postings.length)
    expect(observation.jobs.at(-1)).toMatchObject({
      externalId: `sr-${DEFAULT_MAX_DETAIL_REQUESTS + 1}`,
      snapshotPartial: true,
    })
  })

  it('uses the 60-second default across list and detail work without another fetch', async () => {
    let nowMs = 0
    const calls: string[] = []
    const providerFetch = async (input: string | URL | Request) => {
      const url = String(input)
      calls.push(url)
      nowMs = DEFAULT_TOTAL_DURATION_MS
      return jsonResponse({
        totalFound: 1,
        content: [smartRecruitersPosting(1)],
      })
    }

    const observation = await pollSmartRecruiters(
      'SmartRecruiters',
      providerFetch,
      { now: () => nowMs },
    )

    expect(calls).toHaveLength(1)
    expect(observation).toMatchObject({
      completeness: 'partial',
      credibleForClosure: false,
      expectedCount: 1,
      pageCount: 1,
      jobs: [{ externalId: 'sr-1', snapshotPartial: true }],
      warnings: ['detail_budget_exceeded'],
    })
  })

  it('accepts deterministic smaller budgets without changing production defaults', async () => {
    const postings = Array.from({ length: 3 }, (_, index) => smartRecruitersPosting(index + 1))
    let calls = 0
    const observation = await pollSmartRecruiters(
      'SmartRecruiters',
      async (input) => {
        calls += 1
        const detailId = String(input).match(/\/postings\/(sr-\d+)$/)?.[1]
        if (!detailId) return jsonResponse({ totalFound: postings.length, content: postings })
        return jsonResponse(smartRecruitersPosting(Number(detailId.slice(3)), true))
      },
      { maxDetailRequests: 2, totalDurationMs: 5_000, now: () => 0 },
    )

    expect(calls).toBe(3)
    expect(observation).toMatchObject({
      completeness: 'partial',
      credibleForClosure: false,
      warnings: ['detail_budget_exceeded'],
    })
    expect(DEFAULT_MAX_DETAIL_REQUESTS).toBe(40)
    expect(DEFAULT_TOTAL_DURATION_MS).toBe(60_000)
  })

  it('keeps a small board complete and credible within both budgets', async () => {
    const postings = [smartRecruitersPosting(1), smartRecruitersPosting(2)]
    const observation = await pollSmartRecruiters(
      'SmartRecruiters',
      async (input) => {
        const detailId = String(input).match(/\/postings\/(sr-\d+)$/)?.[1]
        if (!detailId) return jsonResponse({ totalFound: postings.length, content: postings })
        return jsonResponse(smartRecruitersPosting(Number(detailId.slice(3)), true))
      },
      { now: () => 0 },
    )

    expect(observation).toMatchObject({
      completeness: 'complete',
      credibleForClosure: true,
      expectedCount: 2,
      pageCount: 1,
      warnings: [],
      jobs: [
        { externalId: 'sr-1', snapshotPartial: false },
        { externalId: 'sr-2', snapshotPartial: false },
      ],
    })
  })
})

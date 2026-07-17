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

const decodeFixtureHtml = (value: string) =>
  value.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')

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

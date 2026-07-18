import { describe, expect, it } from 'vitest'
import {
  buildEndpoint,
  detectAts,
  UNSUPPORTED_URL_MESSAGE,
} from '../../supabase/functions/_shared/detect'

describe('detectAts', () => {
  it.each([
    ['https://boards.greenhouse.io/stripe', { ats: 'greenhouse', slug: 'stripe' }],
    ['https://job-boards.greenhouse.io/acme', { ats: 'greenhouse', slug: 'acme' }],
    ['https://greenhouse.io/embed/job_board?for=acme', { ats: 'greenhouse', slug: 'acme' }],
    ['https://www.greenhouse.io/embed/job_board?for=acme', { ats: 'greenhouse', slug: 'acme' }],
    ['https://www.boards.greenhouse.io/stripe', { ats: 'greenhouse', slug: 'stripe' }],
    ['https://jobs.lever.co/palantir', { ats: 'lever', slug: 'palantir' }],
    ['https://www.jobs.lever.co/palantir', { ats: 'lever', slug: 'palantir' }],
    ['https://jobs.eu.lever.co/foo', { ats: 'lever', slug: 'foo', region: 'eu' }],
    ['https://jobs.ashbyhq.com/ramp', { ats: 'ashby', slug: 'ramp' }],
    ['https://www.jobs.ashbyhq.com/ramp', { ats: 'ashby', slug: 'ramp' }],
    ['https://jobs.smartrecruiters.com/SmartRecruiters', { ats: 'smartrecruiters', slug: 'SmartRecruiters' }],
    ['https://uturn.recruitee.com', { ats: 'recruitee', slug: 'uturn' }],
  ])('detects %s', (url, expected) => {
    expect(detectAts(url)).toEqual(expected)
  })

  it.each([
    'https://acme.wd5.myworkdayjobs.com/jobs',
    'https://careers.example.com/jobs',
    'https://boards.greenhouse.io/acme/jobs/123',
    'https://boards.greenhouse.io/bad.slug',
    'https://jobs.lever.co/bad%20slug',
    'https://jobs.ashbyhq.com/acme/jobs',
    'https://jobs.ashbyhq.com/Acme%20Labs',
    'https://jobs.ashbyhq.com/acme%2Fjobs',
    'http://jobs.smartrecruiters.com/SmartRecruiters',
    'https://user:password@jobs.smartrecruiters.com/SmartRecruiters',
    'https://jobs.smartrecruiters.com:444/SmartRecruiters',
    'https://jobs.smartrecruiters.com.evil.example/SmartRecruiters',
    'https://jobs.smartrecruiters.com/SmartRecruiters/jobs',
    'https://uturn.recruitee.com.evil.example',
    'https://nested.uturn.recruitee.com',
    'https://bad.slug.recruitee.com',
    'https://uturn.recruitee.com/jobs',
    'https://uturn.recruitee.com/%2Fapi',
    'http://uturn.recruitee.com',
    'https://user:password@uturn.recruitee.com',
    'https://uturn.recruitee.com:444',
    '',
    'not a URL',
  ])('returns unsupported for %s', (url) => {
    expect(detectAts(url)).toEqual({ ats: 'unsupported' })
  })

  it('exports the exact unsupported URL guidance', () => {
    expect(UNSUPPORTED_URL_MESSAGE).toBe(
      "This URL isn't a supported job board. Job Copilot works with Greenhouse, Lever, Ashby, SmartRecruiters, and Recruitee. Use the exact public careers-board URL — usually where the careers page's Apply buttons point.",
    )
  })
})

describe('buildEndpoint', () => {
  it.each([
    [
      { ats: 'greenhouse', slug: 'stripe' } as const,
      'https://boards-api.greenhouse.io/v1/boards/stripe/jobs',
    ],
    [
      { ats: 'lever', slug: 'palantir' } as const,
      'https://api.lever.co/v0/postings/palantir?mode=json',
    ],
    [
      { ats: 'lever', slug: 'foo', region: 'eu' } as const,
      'https://api.eu.lever.co/v0/postings/foo?mode=json',
    ],
    [
      { ats: 'ashby', slug: 'ramp' } as const,
      'https://api.ashbyhq.com/posting-api/job-board/ramp',
    ],
    [
      { ats: 'smartrecruiters', slug: 'SmartRecruiters' } as const,
      'https://api.smartrecruiters.com/v1/companies/SmartRecruiters/postings',
    ],
    [
      { ats: 'recruitee', slug: 'uturn' } as const,
      'https://uturn.recruitee.com/api/offers/',
    ],
  ])('constructs an allowlisted endpoint', (detected, expected) => {
    expect(buildEndpoint(detected)).toBe(expected)
  })

  it('rejects unsupported results', () => {
    expect(() => buildEndpoint({ ats: 'unsupported' })).toThrow(UNSUPPORTED_URL_MESSAGE)
  })
})

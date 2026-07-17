import { describe, expect, it } from 'vitest'
import {
  buildAdzunaUrl,
  mapAdzunaResult,
} from '../../supabase/functions/_shared/adapters/adzuna'

describe('Adzuna adapter mapping', () => {
  it('normalizes a live-shaped result as a partial job snapshot', () => {
    expect(
      mapAdzunaResult({
        id: 'adzuna-123',
        title: 'Software Engineer',
        description: 'Build reliable systems and developer tooling.',
        created: '2026-07-17T12:34:56Z',
        redirect_url: 'https://www.adzuna.com/details/adzuna-123',
        company: { display_name: 'Acme Labs' },
        location: { display_name: 'San Francisco, CA' },
      }),
    ).toEqual({
      source: 'adzuna',
      externalId: 'adzuna-123',
      title: 'Software Engineer',
      location: 'San Francisco, CA',
      absoluteUrl: 'https://www.adzuna.com/details/adzuna-123',
      postedAt: '2026-07-17T12:34:56.000Z',
      descriptionHtml: null,
      descriptionText: 'Build reliable systems and developer tooling.',
      snapshotPartial: true,
      companyName: 'Acme Labs',
    })
  })

  it('returns nulls for missing optional location and company fields', () => {
    expect(
      mapAdzunaResult({
        id: 'adzuna-optional',
        title: 'Platform Engineer',
        description: 'A short result snippet.',
        created: '2026-07-17T12:34:56Z',
        redirect_url: 'https://www.adzuna.com/details/adzuna-optional',
      }),
    ).toMatchObject({
      location: null,
      companyName: null,
      snapshotPartial: true,
    })
  })
})

describe('Adzuna search URL', () => {
  it('builds a one-day newest-first US search request', () => {
    const url = new URL(
      buildAdzunaUrl(
        'us',
        'software engineer',
        'san francisco',
        'app-id',
        'app-key',
      ),
    )

    expect(url.origin + url.pathname).toBe(
      'https://api.adzuna.com/v1/api/jobs/us/search/1',
    )
    expect(Object.fromEntries(url.searchParams)).toEqual({
      app_id: 'app-id',
      app_key: 'app-key',
      what: 'software engineer',
      where: 'san francisco',
      sort_by: 'date',
      max_days_old: '1',
      results_per_page: '50',
      'content-type': 'application/json',
    })
  })
})

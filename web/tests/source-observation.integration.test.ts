import { afterEach, describe, expect, it, vi } from 'vitest'
import { mapAshbyJobs } from '../../supabase/functions/_shared/adapters/ashby.ts'
import { mapLeverPosting } from '../../supabase/functions/_shared/adapters/lever.ts'
import { mapGreenhouseJob } from '../../supabase/functions/_shared/adapters/greenhouse.ts'
import {
  type NormalizedJob,
  type PollObservation,
} from '../../supabase/functions/_shared/adapters/types.ts'
import {
  planCompanySync,
  type ExistingJobRow,
} from '../../supabase/functions/_shared/lifecycle.ts'
import {
  pollConnector,
  providerRegistry,
} from '../../supabase/functions/_shared/connectors.ts'

const nowIso = '2026-07-17T17:00:00.000Z'

function complete(jobs: NormalizedJob[]): PollObservation {
  return {
    jobs,
    completeness: 'complete',
    credibleForClosure: true,
    pageCount: 1,
    expectedCount: jobs.length,
    warnings: [],
  }
}

function staleMissing(source: NormalizedJob['source']): ExistingJobRow {
  return {
    id: `${source}-missing`,
    source,
    external_id: 'missing',
    fingerprint: `example|missing|${source}`,
    status: 'open',
    last_seen_at: '2026-07-17T16:00:00.000Z',
  }
}

describe('existing provider observation journey', () => {
  it.each([
    ['greenhouse', () => mapGreenhouseJob({
      id: 101,
      title: 'Engineer',
      absolute_url: 'https://boards.greenhouse.io/example/jobs/101',
      content: '<p>Build systems</p>',
      location: { name: 'Chicago' },
    }, (value) => value)],
    ['lever', () => mapLeverPosting({
      id: 'lever-101',
      text: 'Engineer',
      hostedUrl: 'https://jobs.lever.co/example/lever-101',
      categories: { location: 'Chicago' },
      description: '<p>Build systems</p>',
    })],
    ['ashby', () => mapAshbyJobs([{
      id: 'ashby-101',
      title: 'Engineer',
      jobUrl: 'https://jobs.ashbyhq.com/example/ashby-101',
      location: 'Chicago',
      isListed: true,
      descriptionHtml: '<p>Build systems</p>',
    }])[0]],
  ] as const)('%s complete evidence preserves ingestion and permits closure', (source, mapJob) => {
    const job = mapJob()
    const plan = planCompanySync([staleMissing(source)], complete([job]), nowIso)

    expect(plan.newJobs).toEqual([job])
    expect(plan.closeIds).toEqual([`${source}-missing`])
  })

  it('reopens an exact-ID job from a complete credible observation', () => {
    const returned = mapLeverPosting({
      id: 'lever-returned',
      text: 'Returned Engineer',
      hostedUrl: 'https://jobs.lever.co/example/lever-returned',
    })
    const closed: ExistingJobRow = {
      id: 'closed-row',
      source: 'lever',
      external_id: returned.externalId,
      fingerprint: 'example|returned engineer|remote',
      status: 'closed',
      last_seen_at: '2026-07-17T16:00:00.000Z',
    }

    expect(planCompanySync([closed], complete([returned]), nowIso).reopenIds)
      .toEqual(['closed-row'])
  })
})

describe('scheduled closed-registry dispatch', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the registry exhaustive for exactly the implemented providers', () => {
    expect(Object.keys(providerRegistry).sort()).toEqual(['ashby', 'greenhouse', 'lever'])
  })

  it('dispatches an active claimed row to its exact provider connector', async () => {
    const providerFetch = vi.fn().mockResolvedValue(Response.json([{
      id: 'lever-201',
      text: 'Platform Engineer',
      hostedUrl: 'https://jobs.lever.co/acme/lever-201',
    }]))
    vi.stubGlobal('fetch', providerFetch)

    const observation = await pollConnector({
      ats_type: 'lever',
      board_token: 'acme',
      region: null,
      activation_state: 'active',
    }, new Set())

    expect(providerFetch).toHaveBeenCalledOnce()
    expect(providerFetch).toHaveBeenCalledWith(
      'https://api.lever.co/v0/postings/acme?mode=json',
    )
    expect(observation).toMatchObject({
      completeness: 'complete',
      credibleForClosure: true,
      expectedCount: 1,
      jobs: [{ source: 'lever', externalId: 'lever-201' }],
    })
  })

  it('fails an unknown provider closed before network access', async () => {
    const providerFetch = vi.fn()
    vi.stubGlobal('fetch', providerFetch)

    await expect(pollConnector({
      ats_type: 'invented-provider',
      board_token: 'acme',
      region: null,
      activation_state: 'active',
    }, new Set())).rejects.toThrow('unsupported_provider:invented-provider')
    expect(providerFetch).not.toHaveBeenCalled()
  })

  it.each(['experimental', 'disabled'] as const)(
    'rejects a directly injected %s row before adapter access',
    async (activation_state) => {
      const providerFetch = vi.fn()
      vi.stubGlobal('fetch', providerFetch)

      await expect(pollConnector({
        ats_type: 'lever',
        board_token: 'acme',
        region: null,
        activation_state,
      }, new Set())).rejects.toThrow(`inactive_connector:${activation_state}`)
      expect(providerFetch).not.toHaveBeenCalled()
    },
  )
})

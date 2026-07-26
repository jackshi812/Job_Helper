import { describe, expect, it, vi } from 'vitest'
import {
  EIGHTFOLD_MORGAN_STANLEY_SOURCE_KEY,
  GOLDMAN_HIGHER_SOURCE_KEY,
  ORACLE_JPMC_SOURCE_KEY,
} from '../../supabase/functions/_shared/branded-identities'
import {
  observeConnector,
  pollConnector,
  providerRegistry,
  verifyConnector,
} from '../../supabase/functions/_shared/connectors'
import {
  buildEndpoint,
  detectAts,
} from '../../supabase/functions/_shared/detect'

const exactBoards = [
  [
    'https://www.morganstanley.com/careers/career-opportunities-search/',
    { ats: 'eightfold', slug: EIGHTFOLD_MORGAN_STANLEY_SOURCE_KEY },
  ],
  [
    'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs',
    { ats: 'oracle_recruiting', slug: ORACLE_JPMC_SOURCE_KEY },
  ],
  [
    'https://higher.gs.com/roles',
    { ats: 'goldman_higher', slug: GOLDMAN_HIGHER_SOURCE_KEY },
  ],
] as const

const unsupportedBoards = [
  'https://careers.bankofamerica.com/en-us/job-search',
  'https://jobs.citi.com/search-jobs',
  'https://careers.blackrock.com/search-jobs',
  'https://www.wellsfargojobs.com/en/jobs/',
  'https://jobs.ubs.com/TGnewUI/Search/Home/HomeWithPreLoad?PageType=JobDetails&partnerid=25008&siteid=5012',
  'https://search.jobs.barclays/en/search-jobs',
  'https://www.schwabjobs.com/job-search-results/',
]

function company(
  sourceKey: string,
  atsType: string,
  activationState: 'active' | 'experimental' | 'disabled',
) {
  return {
    ats_type: atsType,
    board_token: sourceKey,
    region: null,
    site_token: null,
    source_key: sourceKey,
    activation_state: activationState,
  }
}

describe('closed branded connector authorization', () => {
  it.each(exactBoards)('detects and reconstructs only exact primary URL %s', (url, expected) => {
    const detected = detectAts(url)
    expect(detected).toEqual(expected)
    expect(buildEndpoint(detected)).toBe(url)
  })

  it('accepts the exact JPMorgan requisitions alias but reconstructs the canonical jobs URL', () => {
    const alias =
      'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/requisitions'
    const detected = detectAts(alias)
    expect(detected).toEqual({
      ats: 'oracle_recruiting',
      slug: ORACLE_JPMC_SOURCE_KEY,
    })
    expect(buildEndpoint(detected)).toBe(exactBoards[1][0])
  })

  it.each([
    ...unsupportedBoards,
    `${exactBoards[0][0]}?query=data`,
    `${exactBoards[1][0]}#jobs`,
    `${exactBoards[2][0]}/extra`,
    exactBoards[0][0].replace('https://', 'http://'),
    exactBoards[1][0].replace('https://', 'https://user:password@'),
    exactBoards[2][0].replace('.com/', '.com:444/'),
  ])('rejects unsupported or drifted primary URL %s', (url) => {
    expect(detectAts(url)).toEqual({ ats: 'unsupported' })
  })

  it('registers exactly the three branded providers without weakening existing entries', () => {
    expect(Object.keys(providerRegistry)).toEqual(expect.arrayContaining([
      'greenhouse',
      'lever',
      'ashby',
      'paylocity',
      'smartrecruiters',
      'recruitee',
      'workday',
      'eightfold',
      'oracle_recruiting',
      'goldman_higher',
    ]))
  })

  it.each(exactBoards)('re-resolves %s before verification fetch', async (url, expected) => {
    const providerFetch = vi.fn().mockResolvedValue(new Response('<html></html>', {
      headers: { 'content-type': 'text/html' },
    }))
    const detected = detectAts(url)

    await expect(verifyConnector(detected as Exclude<typeof detected, { ats: 'unsupported' }>, providerFetch))
      .rejects.toThrow()
    expect(providerFetch).toHaveBeenCalled()
    expect(String(providerFetch.mock.calls[0]?.[0])).toContain(
      expected.ats === 'eightfold'
        ? 'morganstanley.eightfold.ai'
        : expected.ats === 'oracle_recruiting'
          ? 'jpmc.fa.oraclecloud.com'
          : 'api-higher.gs.com',
    )
  })

  it.each(exactBoards)('keeps Active polling and Experimental observation disjoint for %s', async (_url, detected) => {
    const active = company(detected.slug, detected.ats, 'active')
    const experimental = company(detected.slug, detected.ats, 'experimental')
    const disabled = company(detected.slug, detected.ats, 'disabled')
    const noFetch = vi.fn()

    await expect(pollConnector(experimental, new Set())).rejects.toThrow(
      'inactive_connector:experimental',
    )
    await expect(observeConnector(active, noFetch)).rejects.toThrow(
      'inactive_observation_connector:active',
    )
    await expect(observeConnector(disabled, noFetch)).rejects.toThrow(
      'inactive_observation_connector:disabled',
    )
    expect(noFetch).not.toHaveBeenCalled()
  })

  it('rejects copied and unknown persisted identities before fetch', async () => {
    const noFetch = vi.fn()

    await expect(observeConnector({
      ...company(EIGHTFOLD_MORGAN_STANLEY_SOURCE_KEY, 'eightfold', 'experimental'),
      board_token: 'eightfold:attacker',
    }, noFetch)).rejects.toThrow('inactive_observation_connector:identity_not_allowed')
    await expect(observeConnector(
      company('eightfold:attacker', 'eightfold', 'experimental'),
      noFetch,
    )).rejects.toThrow('inactive_observation_connector:identity_not_allowed')
    expect(noFetch).not.toHaveBeenCalled()
  })
})

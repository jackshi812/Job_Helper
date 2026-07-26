import { describe, expect, it } from 'vitest'
import {
  BRANDED_IDENTITIES,
  EIGHTFOLD_MORGAN_STANLEY_SOURCE_KEY,
  GOLDMAN_HIGHER_SOURCE_KEY,
  ORACLE_JPMC_SOURCE_KEY,
  resolveBrandedIdentity,
  resolveBrandedPublicUrl,
} from '../../supabase/functions/_shared/branded-identities'
import {
  CAPITAL_ONE_WORKDAY_IDENTITY,
  FIDELITY_WORKDAY_IDENTITY,
} from '../../supabase/functions/_shared/workday-identities'

const capitalOneIdentityBytes =
  '{"origin":"https://capitalone.wd12.myworkdayjobs.com","cxsRoot":"https://capitalone.wd12.myworkdayjobs.com/wday/cxs/capitalone/Capital_One","publicBoard":"https://capitalone.wd12.myworkdayjobs.com/Capital_One","tenant":"capitalone","site":"Capital_One","region":"wd12","hostForm":"jobs","sourceKey":"workday:wd12:capitalone:Capital_One","companyName":"Capital One","applyCapitalOneEligibility":true,"keptFacetIds":{"Analysis":"a12c70bf789e105802e9caf800542991","Finance":"a12c70bf789e105802e9de2c3b5f29a3"}}'
const fidelityIdentityBytes =
  '{"origin":"https://wd1.myworkdaysite.com","cxsRoot":"https://wd1.myworkdaysite.com/wday/cxs/fmr/FidelityCareers","publicBoard":"https://wd1.myworkdaysite.com/en-US/recruiting/fmr/FidelityCareers","tenant":"fmr","site":"FidelityCareers","region":"wd1","hostForm":"site","sourceKey":"workday:wd1:fmr:FidelityCareers","companyName":"Fidelity","applyCapitalOneEligibility":false,"excludedJobFamilyGroups":["Sales","Customer Service","Sales Support"]}'

describe('branded connector identities', () => {
  it('contains exactly the three reviewed primary-portal candidates', () => {
    expect(Object.keys(BRANDED_IDENTITIES)).toEqual([
      EIGHTFOLD_MORGAN_STANLEY_SOURCE_KEY,
      ORACLE_JPMC_SOURCE_KEY,
      GOLDMAN_HIGHER_SOURCE_KEY,
    ])

    expect(resolveBrandedIdentity(EIGHTFOLD_MORGAN_STANLEY_SOURCE_KEY)).toMatchObject({
      provider: 'eightfold',
      companyName: 'Morgan Stanley',
      host: 'morganstanley.eightfold.ai',
      searchPath: '/api/pcsx/search',
      detailPath: '/api/pcsx/position_details',
      domain: 'morganstanley.com',
      countryValue: 'United States of America',
    })
    expect(resolveBrandedIdentity(ORACLE_JPMC_SOURCE_KEY)).toMatchObject({
      provider: 'oracle_recruiting',
      companyName: 'JPMorgan Chase',
      host: 'jpmc.fa.oraclecloud.com',
      siteNumber: 'CX_1001',
      countryFacet: {
        id: '300000000289738',
        expectedLabel: 'United States',
      },
      titleFacets: [
        { id: 'FIN', expectedLabel: 'Finance' },
        { id: 'D&A', expectedLabel: 'Data & Analytics' },
        { id: 'RSK', expectedLabel: 'Risk' },
        { id: 'PIM', expectedLabel: 'Product/Investment Mgmt' },
        { id: 'S&D', expectedLabel: 'Strategy & Development' },
        { id: 'PAA', expectedLabel: 'Program Analysts & Associate' },
      ],
      postingDateFacet: {
        id: '7',
        expectedLabel: 'Less than 7 days',
        recentDays: 7,
      },
    })
    expect(resolveBrandedIdentity(GOLDMAN_HIGHER_SOURCE_KEY)).toMatchObject({
      provider: 'goldman_higher',
      companyName: 'Goldman Sachs',
      host: 'api-higher.gs.com',
      graphqlPath: '/gateway/api/v1/graphql',
      listOperation: 'GetRoles',
      detailOperation: 'GetRoleById',
    })
  })

  it.each([
    ['https://www.morganstanley.com/careers/career-opportunities-search/', EIGHTFOLD_MORGAN_STANLEY_SOURCE_KEY],
    ['https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs', ORACLE_JPMC_SOURCE_KEY],
    ['https://higher.gs.com/roles', GOLDMAN_HIGHER_SOURCE_KEY],
  ])('resolves only the exact reviewed public URL %s', (publicUrl, sourceKey) => {
    expect(resolveBrandedPublicUrl(publicUrl)?.sourceKey).toBe(sourceKey)
    expect(resolveBrandedPublicUrl(publicUrl)?.sourceKey).toBe(sourceKey)
  })

  it('resolves the exact JPMorgan requisitions alias to the canonical frozen identity', () => {
    const canonical = resolveBrandedIdentity(ORACLE_JPMC_SOURCE_KEY)
    expect(resolveBrandedPublicUrl(
      'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/requisitions',
    )).toBe(canonical)
    expect(canonical?.publicUrl).toBe(
      'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs',
    )
  })

  it.each([
    'http://www.morganstanley.com/careers/career-opportunities-search/',
    'https://user:password@www.morganstanley.com/careers/career-opportunities-search/',
    'https://www.morganstanley.com:444/careers/career-opportunities-search/',
    'https://www.morganstanley.com.evil.example/careers/career-opportunities-search/',
    'https://www.morganstanley.com/careers/career-opportunities-search',
    'https://www.morganstanley.com/careers/career-opportunities-search/?redirect=https://evil.example',
    'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1002/requisitions',
    'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/requisitions/extra',
    'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/requisitions?q=risk',
    'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs/',
    'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs#finance',
    'https://higher.gs.com/roles/',
    'https://higher.gs.com/roles#technology',
    'https://api-higher.gs.com/gateway/api/v1/graphql',
  ])('rejects hostile or drifted public URL %s before network access', async (publicUrl) => {
    let fetchCount = 0
    const fetchOnlyAfterResolution = async () => {
      const identity = resolveBrandedPublicUrl(publicUrl)
      if (!identity) return null
      fetchCount += 1
      return identity
    }

    expect(await fetchOnlyAfterResolution()).toBeNull()
    expect(fetchCount).toBe(0)
  })

  it.each([
    '',
    'eightfold:morganstanley:secondary',
    'oracle:jpmc:CX_1002',
    'goldman_higher:campus',
    'radancy:citi',
    'radancy:blackrock',
    'radancy:barclays',
    'radancy:charles-schwab',
    'brassring:ubs',
    'branded:bank-of-america',
    'branded:wells-fargo',
  ])('does not authorize an unreviewed source key %s', (sourceKey) => {
    expect(resolveBrandedIdentity(sourceKey)).toBeNull()
  })

  it('deep-freezes every network coordinate and transport bound', () => {
    for (const identity of Object.values(BRANDED_IDENTITIES)) {
      expect(Object.isFrozen(identity)).toBe(true)
      expect(Object.isFrozen(identity.transport)).toBe(true)
      if (identity.provider === 'oracle_recruiting') {
        expect(Object.isFrozen(identity.countryFacet)).toBe(true)
        expect(Object.isFrozen(identity.titleFacets)).toBe(true)
        expect(identity.titleFacets.every(Object.isFrozen)).toBe(true)
        expect(Object.isFrozen(identity.postingDateFacet)).toBe(true)
        expect(Object.isFrozen(identity.publicUrlAliases)).toBe(true)
      }
    }
  })

  it('keeps Capital One and Fidelity identity serializations byte-identical', () => {
    expect(JSON.stringify(CAPITAL_ONE_WORKDAY_IDENTITY)).toBe(capitalOneIdentityBytes)
    expect(JSON.stringify(FIDELITY_WORKDAY_IDENTITY)).toBe(fidelityIdentityBytes)
  })
})

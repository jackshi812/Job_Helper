/**
 * Exact server-owned identities for Phase 03.8 branded career portals.
 *
 * Recognition is not authorization: only these literal source keys and primary
 * public URLs resolve. Provider adapters must derive every network coordinate,
 * facet, operation, and transport bound from the resolved frozen value.
 */

export const EIGHTFOLD_MORGAN_STANLEY_SOURCE_KEY = 'eightfold:morganstanley'
export const ORACLE_JPMC_SOURCE_KEY = 'oracle:jpmc:CX_1001'
export const GOLDMAN_HIGHER_SOURCE_KEY = 'goldman_higher:roles'

export interface BrandedTransportBounds {
  readonly pageSize: number
  readonly maxPages: number
  readonly maxJobs: number
  readonly maxBytes: number
  readonly maxDetailRequests: number
  readonly pageConcurrency: number
  readonly detailConcurrency: number
  readonly stopSchedulingAfterMs: number
}

export interface BrandedFacetIdentity {
  readonly id: string
  readonly expectedLabel: string
}

interface BrandedIdentityBase {
  readonly sourceKey:
    | typeof EIGHTFOLD_MORGAN_STANLEY_SOURCE_KEY
    | typeof ORACLE_JPMC_SOURCE_KEY
    | typeof GOLDMAN_HIGHER_SOURCE_KEY
  readonly companyName: 'Morgan Stanley' | 'JPMorgan Chase' | 'Goldman Sachs'
  readonly publicUrl: string
  readonly origin: string
  readonly host: string
  readonly transport: BrandedTransportBounds
}

export interface EightfoldBrandedIdentity extends BrandedIdentityBase {
  readonly provider: 'eightfold'
  readonly sourceKey: typeof EIGHTFOLD_MORGAN_STANLEY_SOURCE_KEY
  readonly companyName: 'Morgan Stanley'
  readonly domain: 'morganstanley.com'
  readonly searchPath: '/api/pcsx/search'
  readonly detailPath: '/api/pcsx/position_details'
  readonly countryValue: 'United States of America'
  readonly countryFacet: BrandedFacetIdentity
}

export interface OracleRecruitingBrandedIdentity extends BrandedIdentityBase {
  readonly provider: 'oracle_recruiting'
  readonly sourceKey: typeof ORACLE_JPMC_SOURCE_KEY
  readonly companyName: 'JPMorgan Chase'
  readonly siteNumber: 'CX_1001'
  readonly listPath: '/hcmRestApi/resources/latest/recruitingCEJobRequisitions'
  readonly detailPath: '/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails'
  readonly countryFacet: BrandedFacetIdentity
  readonly titleFacets: readonly BrandedFacetIdentity[]
  readonly postingDateFacet: BrandedFacetIdentity & {
    readonly recentDays: 7
  }
  readonly publicUrlAliases: readonly string[]
}

export interface GoldmanHigherBrandedIdentity extends BrandedIdentityBase {
  readonly provider: 'goldman_higher'
  readonly sourceKey: typeof GOLDMAN_HIGHER_SOURCE_KEY
  readonly companyName: 'Goldman Sachs'
  readonly graphqlPath: '/gateway/api/v1/graphql'
  readonly listOperation: 'GetRoles'
  readonly detailOperation: 'GetRoleById'
  readonly countryValue: 'United States'
  readonly categoryFields: readonly ['jobFunction', 'division']
}

export type BrandedIdentity =
  | EightfoldBrandedIdentity
  | OracleRecruitingBrandedIdentity
  | GoldmanHigherBrandedIdentity

function transportBounds(pageSize: number): BrandedTransportBounds {
  return Object.freeze({
    pageSize,
    maxPages: 100,
    maxJobs: 5_000,
    maxBytes: 1_000_000,
    maxDetailRequests: 5_000,
    pageConcurrency: 2,
    detailConcurrency: 4,
    stopSchedulingAfterMs: 120_000,
  })
}

function facet(id: string, expectedLabel: string): BrandedFacetIdentity {
  return Object.freeze({ id, expectedLabel })
}

const morganStanleyIdentity: EightfoldBrandedIdentity = Object.freeze({
  provider: 'eightfold',
  sourceKey: EIGHTFOLD_MORGAN_STANLEY_SOURCE_KEY,
  companyName: 'Morgan Stanley',
  publicUrl: 'https://www.morganstanley.com/careers/career-opportunities-search/',
  origin: 'https://morganstanley.eightfold.ai',
  host: 'morganstanley.eightfold.ai',
  domain: 'morganstanley.com',
  searchPath: '/api/pcsx/search',
  detailPath: '/api/pcsx/position_details',
  countryValue: 'United States of America',
  countryFacet: facet('country', 'United States of America'),
  transport: transportBounds(100),
})

const jpmorganChaseIdentity: OracleRecruitingBrandedIdentity = Object.freeze({
  provider: 'oracle_recruiting',
  sourceKey: ORACLE_JPMC_SOURCE_KEY,
  companyName: 'JPMorgan Chase',
  publicUrl:
    'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs',
  origin: 'https://jpmc.fa.oraclecloud.com',
  host: 'jpmc.fa.oraclecloud.com',
  siteNumber: 'CX_1001',
  listPath: '/hcmRestApi/resources/latest/recruitingCEJobRequisitions',
  detailPath: '/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails',
  countryFacet: facet('300000000289738', 'United States'),
  titleFacets: Object.freeze([
    facet('FIN', 'Finance'),
    facet('D&A', 'Data & Analytics'),
    facet('RSK', 'Risk'),
    facet('PIM', 'Product/Investment Mgmt'),
    facet('S&D', 'Strategy & Development'),
    facet('PAA', 'Program Analysts & Associate'),
  ]),
  postingDateFacet: Object.freeze({
    ...facet('7', 'Less than 7 days'),
    recentDays: 7 as const,
  }),
  publicUrlAliases: Object.freeze([
    'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/requisitions',
  ]),
  transport: transportBounds(25),
})

const goldmanSachsIdentity: GoldmanHigherBrandedIdentity = Object.freeze({
  provider: 'goldman_higher',
  sourceKey: GOLDMAN_HIGHER_SOURCE_KEY,
  companyName: 'Goldman Sachs',
  publicUrl: 'https://higher.gs.com/roles',
  origin: 'https://api-higher.gs.com',
  host: 'api-higher.gs.com',
  graphqlPath: '/gateway/api/v1/graphql',
  listOperation: 'GetRoles',
  detailOperation: 'GetRoleById',
  countryValue: 'United States',
  categoryFields: Object.freeze(['jobFunction', 'division'] as const),
  transport: transportBounds(100),
})

export const BRANDED_IDENTITIES: Readonly<Record<BrandedIdentity['sourceKey'], BrandedIdentity>> =
  Object.freeze({
    [EIGHTFOLD_MORGAN_STANLEY_SOURCE_KEY]: morganStanleyIdentity,
    [ORACLE_JPMC_SOURCE_KEY]: jpmorganChaseIdentity,
    [GOLDMAN_HIGHER_SOURCE_KEY]: goldmanSachsIdentity,
  })

export function resolveBrandedIdentity(sourceKey: string): BrandedIdentity | null {
  if (!Object.prototype.hasOwnProperty.call(BRANDED_IDENTITIES, sourceKey)) return null
  return BRANDED_IDENTITIES[sourceKey as BrandedIdentity['sourceKey']]
}

export function resolveBrandedPublicUrl(publicUrl: string): BrandedIdentity | null {
  for (const identity of Object.values(BRANDED_IDENTITIES)) {
    if (identity.publicUrl === publicUrl) return identity
    if (
      identity.provider === 'oracle_recruiting'
      && identity.publicUrlAliases.includes(publicUrl)
    ) return identity
  }
  return null
}

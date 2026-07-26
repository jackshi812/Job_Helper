/**
 * Frozen Workday identity registry.
 *
 * Mirrors provider-identities.ts: a small set of admitted, frozen identities plus
 * a pure, fail-closed resolver. Only tuples that exactly match an admitted entry
 * resolve to a pollable origin — no free-string origin construction is possible,
 * so an attacker-supplied (tenant, region, site, hostForm) tuple can never coerce
 * the adapter into fetching an arbitrary host.
 *
 * The Capital One entry is byte-frozen: the source key
 * `workday:wd12:capitalone:Capital_One` and its category facet IDs must never change.
 * Fidelity is admitted as a SECOND entry — the two real Workday URL shapes:
 *   - Form A (`myworkdayjobs` subdomain): Capital One, hostForm 'jobs'
 *   - Form B (`myworkdaysite` path):       Fidelity,     hostForm 'site'
 * The CXS path `/wday/cxs/{tenant}/{site}` is identical across both; only origin
 * construction differs, which is why `hostForm`/`origin` are carried explicitly and
 * never re-derived from region alone.
 */

export const CAPITAL_ONE_WORKDAY_SOURCE_KEY = 'workday:wd12:capitalone:Capital_One'
export const FIDELITY_WORKDAY_SOURCE_KEY = 'workday:wd1:fmr:FidelityCareers'
export const NASDAQ_WORKDAY_SOURCE_KEY = 'workday:wd1:nasdaq:Global_External_Site'
export const SP_GLOBAL_WORKDAY_SOURCE_KEY = 'workday:wd5:spgi:SPGI_Careers'
export const MORNINGSTAR_WORKDAY_SOURCE_KEY = 'workday:wd5:morningstar:morningstar'
export const STATE_STREET_WORKDAY_SOURCE_KEY = 'workday:wd1:statestreet:Global'
export const MORGAN_STANLEY_WORKDAY_SOURCE_KEY = 'workday:wd5:ms:External'
export const BANK_OF_AMERICA_WORKDAY_SOURCE_KEY = 'workday:wd1:ghr:Lateral-US'
export const BLACKROCK_WORKDAY_SOURCE_KEY =
  'workday:wd1:blackrock:BlackRock_Professional'
export const BARCLAYS_WORKDAY_SOURCE_KEY =
  'workday:wd3:barclays:External_Career_Site_Barclays'
export const UNITED_STATES_WORKDAY_FACET_ID = 'bc33aa3152ec42d4995f4791a106ed09'

export type WorkdayHostForm = 'jobs' | 'site'
export type WorkdayCountryFacetRoute =
  | readonly ['Location_Country']
  | readonly ['locationMainGroup', 'locationCountry']
export type WorkdayCountryFacetParameter =
  | 'Location_Country'
  | 'locationCountry'

export interface WorkdayCountryScope {
  readonly descriptor: 'United States of America'
  readonly id: typeof UNITED_STATES_WORKDAY_FACET_ID
  readonly facetParameter: WorkdayCountryFacetParameter
  readonly route: WorkdayCountryFacetRoute
}

export interface WorkdaySelectiveRecentUsScope {
  /** Only list rows advertised as no older than this many days are hydrated. */
  readonly recentDays: 7
  /** Provider-list bounds; detail hydration remains inside the 300-request rollout ceiling. */
  readonly maxPages: 100
  readonly maxListings: 2_000
  readonly maxDetails: 199
  /** Optional server-owned whole-word title gate applied before detail hydration. */
  readonly titleIncludesAny?: readonly string[]
}

export interface WorkdayIdentity {
  readonly origin: string
  readonly cxsRoot: string
  readonly publicBoard: string
  readonly tenant: string
  readonly site: string
  readonly region: string
  readonly hostForm: WorkdayHostForm
  readonly sourceKey: string
  readonly companyName: string | null
  /** Preserve the legacy Capital One-only U.S. and <3-year ingestion policy. */
  readonly applyCapitalOneEligibility: boolean
  /** Inclusion facet IDs applied verbatim (Capital One). Byte-frozen. */
  readonly keptFacetIds?: Readonly<Record<string, string>>
  /** jobFamilyGroup descriptors to exclude via live-discovered inclusion facets (Fidelity). */
  readonly excludedJobFamilyGroups?: readonly string[]
  /** Exact server-owned country facet contract for U.S.-scoped identities. */
  readonly countryScope?: WorkdayCountryScope
  /** Require authoritative detail-country proof for every scoped listing. */
  readonly requireDetailCountryProof?: true
  /** Complete unfiltered site is U.S.-authoritative only when every detail proves US. */
  readonly wholeSiteUsScope?: 'all_details'
  /**
   * Selective shared-pool import: enumerate the complete lightweight listing
   * population, hydrate every recent row, retain only exact-U.S. details, and
   * never infer closure from absence. Complete list enumeration is required
   * because some Workday boards interleave old and newly posted rows.
   */
  readonly selectiveRecentUsScope?: WorkdaySelectiveRecentUsScope
  /** Exact identity is evaluable but has no country authority and must fetch nothing. */
  readonly unsupportedCountryContract?: true
}

function unitedStatesScope(route: WorkdayCountryFacetRoute): WorkdayCountryScope {
  return Object.freeze({
    descriptor: 'United States of America',
    id: UNITED_STATES_WORKDAY_FACET_ID,
    facetParameter: route.at(-1) as WorkdayCountryFacetParameter,
    route: Object.freeze([...route]) as WorkdayCountryFacetRoute,
  })
}

const selectiveRecentUsScope: WorkdaySelectiveRecentUsScope = Object.freeze({
  recentDays: 7,
  maxPages: 100,
  maxListings: 2_000,
  maxDetails: 199,
})

const bankOfAmericaSelectiveRecentUsScope: WorkdaySelectiveRecentUsScope =
  Object.freeze({
    ...selectiveRecentUsScope,
    titleIncludesAny: Object.freeze([
      'finance',
      'analytics',
      'data',
      'research',
    ]),
  })

const barclaysKeptJobFamilies = Object.freeze({
  'Data & Analytics': '1ab48a98eb7c1001e8e0bdc7d4a10000',
  Finance: '1ab48a98eb7c1001e8e0ccc6d3af0000',
  'Investment Banking': '112c054282011001e915f210568e0000',
  Research: '112c054282011001e9161cb8b7960000',
  Risk: '112c054282011001e9162220a12b0000',
  Technology: '112c054282011001e9162cfccdc10000',
})

const capitalOneIdentity: WorkdayIdentity = Object.freeze({
  origin: 'https://capitalone.wd12.myworkdayjobs.com',
  cxsRoot: 'https://capitalone.wd12.myworkdayjobs.com/wday/cxs/capitalone/Capital_One',
  publicBoard: 'https://capitalone.wd12.myworkdayjobs.com/Capital_One',
  tenant: 'capitalone',
  site: 'Capital_One',
  region: 'wd12',
  hostForm: 'jobs',
  sourceKey: CAPITAL_ONE_WORKDAY_SOURCE_KEY,
  companyName: 'Capital One',
  applyCapitalOneEligibility: true,
  keptFacetIds: Object.freeze({
    Analysis: 'a12c70bf789e105802e9caf800542991',
    Finance: 'a12c70bf789e105802e9de2c3b5f29a3',
  }),
})

const fidelityIdentity: WorkdayIdentity = Object.freeze({
  origin: 'https://wd1.myworkdaysite.com',
  cxsRoot: 'https://wd1.myworkdaysite.com/wday/cxs/fmr/FidelityCareers',
  publicBoard: 'https://wd1.myworkdaysite.com/en-US/recruiting/fmr/FidelityCareers',
  tenant: 'fmr',
  site: 'FidelityCareers',
  region: 'wd1',
  hostForm: 'site',
  sourceKey: FIDELITY_WORKDAY_SOURCE_KEY,
  companyName: 'Fidelity',
  applyCapitalOneEligibility: false,
  excludedJobFamilyGroups: Object.freeze(['Sales', 'Customer Service', 'Sales Support']),
})

const nasdaqIdentity: WorkdayIdentity = Object.freeze({
  origin: 'https://nasdaq.wd1.myworkdayjobs.com',
  cxsRoot: 'https://nasdaq.wd1.myworkdayjobs.com/wday/cxs/nasdaq/Global_External_Site',
  publicBoard: 'https://nasdaq.wd1.myworkdayjobs.com/Global_External_Site',
  tenant: 'nasdaq',
  site: 'Global_External_Site',
  region: 'wd1',
  hostForm: 'jobs',
  sourceKey: NASDAQ_WORKDAY_SOURCE_KEY,
  companyName: 'Nasdaq',
  applyCapitalOneEligibility: false,
  countryScope: unitedStatesScope(['Location_Country']),
})

const spGlobalIdentity: WorkdayIdentity = Object.freeze({
  origin: 'https://spgi.wd5.myworkdayjobs.com',
  cxsRoot: 'https://spgi.wd5.myworkdayjobs.com/wday/cxs/spgi/SPGI_Careers',
  publicBoard: 'https://spgi.wd5.myworkdayjobs.com/SPGI_Careers',
  tenant: 'spgi',
  site: 'SPGI_Careers',
  region: 'wd5',
  hostForm: 'jobs',
  sourceKey: SP_GLOBAL_WORKDAY_SOURCE_KEY,
  companyName: 'S&P Global',
  applyCapitalOneEligibility: false,
  countryScope: unitedStatesScope(['Location_Country']),
})

const morningstarIdentity: WorkdayIdentity = Object.freeze({
  origin: 'https://morningstar.wd5.myworkdayjobs.com',
  cxsRoot: 'https://morningstar.wd5.myworkdayjobs.com/wday/cxs/morningstar/morningstar',
  publicBoard: 'https://morningstar.wd5.myworkdayjobs.com/morningstar',
  tenant: 'morningstar',
  site: 'morningstar',
  region: 'wd5',
  hostForm: 'jobs',
  sourceKey: MORNINGSTAR_WORKDAY_SOURCE_KEY,
  companyName: 'Morningstar',
  applyCapitalOneEligibility: false,
  countryScope: unitedStatesScope(['locationMainGroup', 'locationCountry']),
})

const stateStreetIdentity: WorkdayIdentity = Object.freeze({
  origin: 'https://statestreet.wd1.myworkdayjobs.com',
  cxsRoot: 'https://statestreet.wd1.myworkdayjobs.com/wday/cxs/statestreet/Global',
  publicBoard: 'https://statestreet.wd1.myworkdayjobs.com/Global',
  tenant: 'statestreet',
  site: 'Global',
  region: 'wd1',
  hostForm: 'jobs',
  sourceKey: STATE_STREET_WORKDAY_SOURCE_KEY,
  companyName: 'State Street',
  applyCapitalOneEligibility: false,
  countryScope: unitedStatesScope(['Location_Country']),
})

const morganStanleyIdentity: WorkdayIdentity = Object.freeze({
  origin: 'https://ms.wd5.myworkdayjobs.com',
  cxsRoot: 'https://ms.wd5.myworkdayjobs.com/wday/cxs/ms/External',
  publicBoard: 'https://ms.wd5.myworkdayjobs.com/en-US/External',
  tenant: 'ms',
  site: 'External',
  region: 'wd5',
  hostForm: 'jobs',
  sourceKey: MORGAN_STANLEY_WORKDAY_SOURCE_KEY,
  companyName: 'Morgan Stanley',
  applyCapitalOneEligibility: false,
  countryScope: unitedStatesScope(['Location_Country']),
  requireDetailCountryProof: true,
  selectiveRecentUsScope,
})

const bankOfAmericaIdentity: WorkdayIdentity = Object.freeze({
  origin: 'https://ghr.wd1.myworkdayjobs.com',
  cxsRoot: 'https://ghr.wd1.myworkdayjobs.com/wday/cxs/ghr/Lateral-US',
  publicBoard: 'https://ghr.wd1.myworkdayjobs.com/en-US/Lateral-US',
  tenant: 'ghr',
  site: 'Lateral-US',
  region: 'wd1',
  hostForm: 'jobs',
  sourceKey: BANK_OF_AMERICA_WORKDAY_SOURCE_KEY,
  companyName: 'Bank of America',
  applyCapitalOneEligibility: false,
  selectiveRecentUsScope: bankOfAmericaSelectiveRecentUsScope,
})

const blackRockIdentity: WorkdayIdentity = Object.freeze({
  origin: 'https://blackrock.wd1.myworkdayjobs.com',
  cxsRoot:
    'https://blackrock.wd1.myworkdayjobs.com/wday/cxs/blackrock/BlackRock_Professional',
  publicBoard:
    'https://blackrock.wd1.myworkdayjobs.com/en-US/BlackRock_Professional',
  tenant: 'blackrock',
  site: 'BlackRock_Professional',
  region: 'wd1',
  hostForm: 'jobs',
  sourceKey: BLACKROCK_WORKDAY_SOURCE_KEY,
  companyName: 'BlackRock',
  applyCapitalOneEligibility: false,
  selectiveRecentUsScope,
})

const barclaysIdentity: WorkdayIdentity = Object.freeze({
  origin: 'https://barclays.wd3.myworkdayjobs.com',
  cxsRoot:
    'https://barclays.wd3.myworkdayjobs.com/wday/cxs/barclays/External_Career_Site_Barclays',
  publicBoard:
    'https://barclays.wd3.myworkdayjobs.com/en-US/External_Career_Site_Barclays',
  tenant: 'barclays',
  site: 'External_Career_Site_Barclays',
  region: 'wd3',
  hostForm: 'jobs',
  sourceKey: BARCLAYS_WORKDAY_SOURCE_KEY,
  companyName: 'Barclays',
  applyCapitalOneEligibility: false,
  keptFacetIds: barclaysKeptJobFamilies,
  selectiveRecentUsScope,
})

export const WORKDAY_IDENTITIES = Object.freeze({
  [CAPITAL_ONE_WORKDAY_SOURCE_KEY]: capitalOneIdentity,
  [FIDELITY_WORKDAY_SOURCE_KEY]: fidelityIdentity,
  [NASDAQ_WORKDAY_SOURCE_KEY]: nasdaqIdentity,
  [SP_GLOBAL_WORKDAY_SOURCE_KEY]: spGlobalIdentity,
  [MORNINGSTAR_WORKDAY_SOURCE_KEY]: morningstarIdentity,
  [STATE_STREET_WORKDAY_SOURCE_KEY]: stateStreetIdentity,
  [MORGAN_STANLEY_WORKDAY_SOURCE_KEY]: morganStanleyIdentity,
  [BANK_OF_AMERICA_WORKDAY_SOURCE_KEY]: bankOfAmericaIdentity,
  [BLACKROCK_WORKDAY_SOURCE_KEY]: blackRockIdentity,
  [BARCLAYS_WORKDAY_SOURCE_KEY]: barclaysIdentity,
})

export const CAPITAL_ONE_WORKDAY_IDENTITY = capitalOneIdentity
export const FIDELITY_WORKDAY_IDENTITY = fidelityIdentity
export const NASDAQ_WORKDAY_IDENTITY = nasdaqIdentity
export const SP_GLOBAL_WORKDAY_IDENTITY = spGlobalIdentity
export const MORNINGSTAR_WORKDAY_IDENTITY = morningstarIdentity
export const STATE_STREET_WORKDAY_IDENTITY = stateStreetIdentity
export const MORGAN_STANLEY_WORKDAY_IDENTITY = morganStanleyIdentity
export const BANK_OF_AMERICA_WORKDAY_IDENTITY = bankOfAmericaIdentity
export const BLACKROCK_WORKDAY_IDENTITY = blackRockIdentity
export const BARCLAYS_WORKDAY_IDENTITY = barclaysIdentity

/**
 * Pure, fail-closed resolver. Returns an admitted identity only when ALL four
 * components (tenant, region, site, hostForm) match an admitted frozen entry;
 * any other tuple returns null. hostForm is a required lookup key — it is never
 * inferred from region, because the source-key tuple alone cannot disambiguate
 * Form A (`myworkdayjobs`) from Form B (`myworkdaysite`).
 */
export function resolveWorkdayIdentity(
  tenant: string,
  region: string,
  site: string,
  hostForm: string,
): WorkdayIdentity | null {
  for (const identity of Object.values(WORKDAY_IDENTITIES)) {
    if (
      identity.tenant === tenant
      && identity.region === region
      && identity.site === site
      && identity.hostForm === hostForm
    ) {
      return identity
    }
  }
  return null
}

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
export const UNITED_STATES_WORKDAY_FACET_ID = 'bc33aa3152ec42d4995f4791a106ed09'

export type WorkdayHostForm = 'jobs' | 'site'
export type WorkdayCountryFacetRoute =
  | readonly ['locationCountry']
  | readonly ['locationMainGroup', 'locationCountry']

export interface WorkdayCountryScope {
  readonly descriptor: 'United States of America'
  readonly id: typeof UNITED_STATES_WORKDAY_FACET_ID
  readonly facetParameter: 'locationCountry'
  readonly route: WorkdayCountryFacetRoute
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
}

function unitedStatesScope(route: WorkdayCountryFacetRoute): WorkdayCountryScope {
  return Object.freeze({
    descriptor: 'United States of America',
    id: UNITED_STATES_WORKDAY_FACET_ID,
    facetParameter: 'locationCountry',
    route: Object.freeze([...route]) as WorkdayCountryFacetRoute,
  })
}

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
  countryScope: unitedStatesScope(['locationCountry']),
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
  countryScope: unitedStatesScope(['locationCountry']),
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
  countryScope: unitedStatesScope(['locationCountry']),
})

export const WORKDAY_IDENTITIES = Object.freeze({
  [CAPITAL_ONE_WORKDAY_SOURCE_KEY]: capitalOneIdentity,
  [FIDELITY_WORKDAY_SOURCE_KEY]: fidelityIdentity,
  [NASDAQ_WORKDAY_SOURCE_KEY]: nasdaqIdentity,
  [SP_GLOBAL_WORKDAY_SOURCE_KEY]: spGlobalIdentity,
  [MORNINGSTAR_WORKDAY_SOURCE_KEY]: morningstarIdentity,
  [STATE_STREET_WORKDAY_SOURCE_KEY]: stateStreetIdentity,
})

export const CAPITAL_ONE_WORKDAY_IDENTITY = capitalOneIdentity
export const FIDELITY_WORKDAY_IDENTITY = fidelityIdentity
export const NASDAQ_WORKDAY_IDENTITY = nasdaqIdentity
export const SP_GLOBAL_WORKDAY_IDENTITY = spGlobalIdentity
export const MORNINGSTAR_WORKDAY_IDENTITY = morningstarIdentity
export const STATE_STREET_WORKDAY_IDENTITY = stateStreetIdentity

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

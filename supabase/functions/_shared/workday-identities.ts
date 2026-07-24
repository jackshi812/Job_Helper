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

export type WorkdayHostForm = 'jobs' | 'site'

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

export const WORKDAY_IDENTITIES = Object.freeze({
  [CAPITAL_ONE_WORKDAY_SOURCE_KEY]: capitalOneIdentity,
  [FIDELITY_WORKDAY_SOURCE_KEY]: fidelityIdentity,
})

export const CAPITAL_ONE_WORKDAY_IDENTITY = capitalOneIdentity
export const FIDELITY_WORKDAY_IDENTITY = fidelityIdentity

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

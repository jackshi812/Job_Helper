export type BrandedJobSource = 'eightfold' | 'oracle_recruiting' | 'goldman_higher'
export type BrandedJobSourceKey =
  | 'eightfold:morganstanley'
  | 'oracle:jpmc:CX_1001'
  | 'goldman_higher:roles'
export type BrandedAllowedCategoryTerm =
  | 'Data'
  | 'Technology'
  | 'Finance'
  | 'Investment'
  | 'Research'
  | 'Risk'
  | 'Capital Markets'
  | 'Strategy'
  | 'Program Analysts'

export interface BrandedJobScopeEvidence {
  readonly sourceKey: BrandedJobSourceKey
  readonly providerCategoryLabel: string
  readonly matchedTerm: BrandedAllowedCategoryTerm
  readonly detailCountryCode: 'US'
  readonly externalIdDigest: string
}

export interface BrandedObservationScopeEvidence {
  readonly sourceKey: BrandedJobSourceKey
  readonly sliceDigests: readonly string[]
  readonly categoryDigest: string
  readonly countryDigest: string
}

export type GoldmanHigherRecruitingType =
  | 'GS_EARLY_CAREER'
  | 'GS_MID_CAREER'

export interface GoldmanHigherJobScopeEvidence {
  readonly sourceKey: 'goldman_higher:roles'
  readonly selectionMode: 'recent_exact_us_provider_category'
  readonly recentHours: 168
  readonly providerSourceId: string
  readonly providerCategoryField: 'jobFunction' | 'division'
  readonly providerCategoryLabel: string
  readonly matchedTerm:
    | 'Data'
    | 'Technology'
    | 'Finance'
    | 'Investment'
    | 'Research'
    | 'Risk'
    | 'Capital Markets'
  readonly detailCountryCode: 'US'
  readonly postedAt: string
  readonly recruitingType: GoldmanHigherRecruitingType
  readonly externalIdDigest: string
}

export interface GoldmanHigherObservationScopeEvidence {
  readonly sourceKey: 'goldman_higher:roles'
  readonly selectionMode: 'recent_exact_us_provider_category'
  readonly recentHours: 168
  readonly sliceDigests: readonly [string, string]
  readonly jobDigest: string
  readonly categoryDigest: string
  readonly countryDigest: string
  readonly freshnessDigest: string
  readonly applicationDigest: string
}

interface NormalizedJobFields {
  externalId: string
  title: string
  location: string | null
  absoluteUrl: string
  postedAt: string | null
  descriptionHtml: string | null
  descriptionText: string | null
  snapshotPartial: boolean
  companyName: string | null
}

type ExistingNormalizedJob = NormalizedJobFields & {
  source:
    | 'greenhouse'
    | 'lever'
    | 'ashby'
    | 'smartrecruiters'
    | 'recruitee'
    | 'paylocity'
    | 'adzuna'
  scopeEvidence?: never
}

export interface WorkdayJobScopeEvidence {
  readonly sourceKey: string
  readonly detailCountryCode: 'US'
  readonly selectionMode: 'recent_exact_us'
  readonly recentDays: 7
  readonly titleKeywords: readonly string[]
  readonly providerFacetLabels: readonly string[]
}

type WorkdayNormalizedJob = NormalizedJobFields & {
  source: 'workday'
  scopeEvidence?: WorkdayJobScopeEvidence
}

type ExistingBrandedNormalizedJob = NormalizedJobFields & {
  source: Exclude<BrandedJobSource, 'goldman_higher'>
  scopeEvidence: BrandedJobScopeEvidence
}

export type GoldmanHigherNormalizedJob = NormalizedJobFields & {
  source: 'goldman_higher'
  postedAt: string
  scopeEvidence: GoldmanHigherJobScopeEvidence
}

export type NormalizedJob =
  | ExistingNormalizedJob
  | WorkdayNormalizedJob
  | ExistingBrandedNormalizedJob
  | GoldmanHigherNormalizedJob

export type PollCompleteness = 'complete' | 'partial' | 'unknown'

export interface PollObservation {
  jobs: NormalizedJob[]
  completeness: PollCompleteness
  credibleForClosure: boolean
  /**
   * False for intentionally selective observations (for example a recent,
   * category-filtered import). The observation may still be healthy and
   * internally complete, but absence from that selection never proves that a
   * previously stored provider job closed upstream.
   */
  allowMissingClosure?: boolean
  pageCount: number
  expectedCount?: number
  warnings: string[]
  /**
   * Bounded aggregate evidence for Phase 03.8 provider slices. Full provider
   * payloads and per-job labels remain on the normalized job contract instead.
   */
  scopeEvidence?:
    | BrandedObservationScopeEvidence
    | GoldmanHigherObservationScopeEvidence
}

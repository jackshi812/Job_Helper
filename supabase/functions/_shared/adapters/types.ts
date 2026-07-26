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
    | 'workday'
    | 'adzuna'
  scopeEvidence?: never
}

type BrandedNormalizedJob = NormalizedJobFields & {
  source: BrandedJobSource
  scopeEvidence: BrandedJobScopeEvidence
}

export type NormalizedJob = ExistingNormalizedJob | BrandedNormalizedJob

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
  scopeEvidence?: BrandedObservationScopeEvidence
}

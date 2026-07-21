export interface NormalizedJob {
  source:
    | 'greenhouse'
    | 'lever'
    | 'ashby'
    | 'smartrecruiters'
    | 'recruitee'
    | 'paylocity'
    | 'workday'
    | 'adzuna'
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
}

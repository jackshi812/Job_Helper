export interface NormalizedJob {
  source:
    | 'greenhouse'
    | 'lever'
    | 'ashby'
    | 'smartrecruiters'
    | 'recruitee'
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
  pageCount: number
  expectedCount?: number
  warnings: string[]
}

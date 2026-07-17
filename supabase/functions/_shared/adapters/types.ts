export interface NormalizedJob {
  source: 'greenhouse' | 'lever' | 'ashby' | 'adzuna'
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

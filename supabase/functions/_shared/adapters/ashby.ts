import { type NormalizedJob } from './types.ts'

interface AshbyJob {
  id: string
  title: string
  publishedAt?: string | null
  jobUrl: string
  location?: string | null
  isListed: boolean
  descriptionHtml?: string | null
  descriptionPlain?: string | null
}

interface AshbyResponse {
  jobs: AshbyJob[]
}

export function mapAshbyJob(job: AshbyJob): NormalizedJob {
  return {
    source: 'ashby',
    externalId: job.id,
    title: job.title.trim(),
    location: job.location?.trim() || null,
    absoluteUrl: job.jobUrl,
    postedAt: job.publishedAt ? new Date(job.publishedAt).toISOString() : null,
    descriptionHtml: job.descriptionHtml ?? null,
    descriptionText: job.descriptionPlain ?? null,
    snapshotPartial: false,
    companyName: null,
  }
}

export function mapAshbyJobs(jobs: AshbyJob[]): NormalizedJob[] {
  return jobs.filter((job) => job.isListed === true).map(mapAshbyJob)
}

export async function pollAshby(name: string): Promise<NormalizedJob[]> {
  const response = await fetch(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(name)}?includeCompensation=true`,
  )

  if (!response.ok) throw new Error(`ashby ${name}: HTTP ${response.status}`)

  const { jobs } = (await response.json()) as AshbyResponse
  return mapAshbyJobs(jobs)
}

import { type NormalizedJob } from './types'

interface GreenhouseJob {
  id: number
  title: string
  first_published?: string | null
  absolute_url: string
  location?: { name?: string | null } | null
  company_name?: string | null
  content?: string | null
}

interface GreenhouseListResponse {
  jobs: GreenhouseJob[]
}

type DecodeHtml = (value: string) => string

function htmlToText(value: string) {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function normalizedDate(value: string | null | undefined) {
  return value ? new Date(value).toISOString() : null
}

export function mapGreenhouseJob(
  job: GreenhouseJob,
  decodeHtml: DecodeHtml,
): NormalizedJob {
  const descriptionHtml = job.content ? decodeHtml(job.content) : null

  return {
    source: 'greenhouse',
    externalId: String(job.id),
    title: job.title.trim(),
    location: job.location?.name?.trim() || null,
    absoluteUrl: job.absolute_url,
    postedAt: normalizedDate(job.first_published),
    descriptionHtml,
    descriptionText: descriptionHtml ? htmlToText(descriptionHtml) : null,
    snapshotPartial: false,
    companyName: job.company_name?.trim() || null,
  }
}

export async function pollGreenhouse(
  token: string,
  knownIds: Set<string>,
): Promise<NormalizedJob[]> {
  const encodedToken = encodeURIComponent(token)
  const listUrl = `https://boards-api.greenhouse.io/v1/boards/${encodedToken}/jobs`
  const listResponse = await fetch(listUrl)

  if (!listResponse.ok) {
    throw new Error(`greenhouse ${token}: HTTP ${listResponse.status}`)
  }

  const { jobs } = (await listResponse.json()) as GreenhouseListResponse
  const heSpecifier = 'npm:he@1.2.0'
  const { decode } = (await import(heSpecifier)) as { decode: DecodeHtml }

  return Promise.all(
    jobs.map(async (job) => {
      if (knownIds.has(String(job.id))) return mapGreenhouseJob(job, decode)

      const detailResponse = await fetch(`${listUrl}/${job.id}`)
      if (!detailResponse.ok) {
        throw new Error(
          `greenhouse ${token} job ${job.id}: HTTP ${detailResponse.status}`,
        )
      }

      const detail = (await detailResponse.json()) as GreenhouseJob
      return mapGreenhouseJob({ ...job, content: detail.content }, decode)
    }),
  )
}

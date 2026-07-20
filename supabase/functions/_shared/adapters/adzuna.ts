import { type NormalizedJob } from './types.ts'

interface AdzunaResult {
  id: string | number
  title: string
  description?: string | null
  created?: string | null
  redirect_url: string
  company?: { display_name?: string | null } | null
  location?: { display_name?: string | null } | null
}

export function mapAdzunaResult(result: AdzunaResult): NormalizedJob {
  const companyName = result.company?.display_name?.trim() || null
  return {
    source: 'adzuna',
    externalId: String(result.id),
    title: result.title.trim(),
    location: result.location?.display_name ?? null,
    absoluteUrl: result.redirect_url,
    postedAt: result.created ? new Date(result.created).toISOString() : null,
    descriptionHtml: null,
    descriptionText: result.description ?? null,
    snapshotPartial: true,
    companyName,
  }
}

export function buildAdzunaUrl(
  country: string,
  what: string,
  whereLoc: string,
  appId: string,
  appKey: string,
) {
  const url = new URL(
    `https://api.adzuna.com/v1/api/jobs/${encodeURIComponent(country)}/search/1`,
  )
  url.searchParams.set('app_id', appId)
  url.searchParams.set('app_key', appKey)
  url.searchParams.set('what', what)
  url.searchParams.set('where', whereLoc)
  url.searchParams.set('sort_by', 'date')
  url.searchParams.set('max_days_old', '1')
  url.searchParams.set('results_per_page', '50')
  url.searchParams.set('content-type', 'application/json')
  return url.toString()
}

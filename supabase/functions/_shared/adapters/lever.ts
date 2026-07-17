import { type NormalizedJob } from './types'

interface LeverList {
  text?: string | null
  content?: string | null
}

interface LeverPosting {
  id: string
  text: string
  createdAt?: number | null
  hostedUrl: string
  categories?: { location?: string | null } | null
  description?: string | null
  descriptionPlain?: string | null
  lists?: LeverList[] | null
  additional?: string | null
  additionalPlain?: string | null
}

function htmlToText(value: string) {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function renderLists(lists: LeverList[] | null | undefined) {
  return (lists ?? [])
    .map((list) => {
      const heading = list.text ? `<h3>${list.text}</h3>` : ''
      return `${heading}${list.content ?? ''}`
    })
    .join('')
}

export function mapLeverPosting(posting: LeverPosting): NormalizedJob {
  const descriptionHtml = [
    posting.description ?? '',
    renderLists(posting.lists),
    posting.additional ?? '',
  ].join('') || null
  const descriptionText = [
    posting.descriptionPlain ?? '',
    ...(posting.lists ?? []).flatMap((list) => [
      list.text ?? '',
      list.content ? htmlToText(list.content) : '',
    ]),
    posting.additionalPlain ?? '',
  ]
    .filter(Boolean)
    .join('\n') || null

  return {
    source: 'lever',
    externalId: posting.id,
    title: posting.text.trim(),
    location: posting.categories?.location?.trim() || null,
    absoluteUrl: posting.hostedUrl,
    postedAt:
      posting.createdAt === null || posting.createdAt === undefined
        ? null
        : new Date(posting.createdAt).toISOString(),
    descriptionHtml,
    descriptionText,
    snapshotPartial: false,
    companyName: null,
  }
}

export async function pollLever(
  site: string,
  region?: 'eu',
): Promise<NormalizedJob[]> {
  const host = region === 'eu' ? 'api.eu.lever.co' : 'api.lever.co'
  const response = await fetch(
    `https://${host}/v0/postings/${encodeURIComponent(site)}?mode=json`,
  )

  if (!response.ok) throw new Error(`lever ${site}: HTTP ${response.status}`)

  const postings = (await response.json()) as LeverPosting[]
  return postings.map(mapLeverPosting)
}

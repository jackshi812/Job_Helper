import { normalizeCompanyDomain } from './outreach'

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php'
const MAX_RESPONSE_BYTES = 100_000
const BUSINESS_DESCRIPTION =
  /\b(?:airline|automaker|bank|business|company|conglomerate|corporation|enterprise|financial|firm|insurer|manufacturer|organization|retailer|software|technology)\b/iu

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface CompanyDomainLookupOptions {
  signal: AbortSignal
  fetchImpl?: FetchLike
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizedName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/gu, '')
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) return null
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  const contentLength = Number(response.headers.get('content-length') ?? '0')
  if (
    !contentType.includes('application/json')
    || (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES)
  ) return null
  try {
    return await response.json() as unknown
  } catch {
    return null
  }
}

function searchEntityId(payload: unknown, company: string): string | null {
  if (!isRecord(payload) || !Array.isArray(payload.search)) return null
  const query = normalizedName(company)
  let selected: { id: string; score: number } | null = null
  for (const raw of payload.search.slice(0, 3)) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || !/^Q\d+$/u.test(raw.id)) continue
    const label = typeof raw.label === 'string' ? raw.label : ''
    const description = typeof raw.description === 'string' ? raw.description : ''
    const aliases = Array.isArray(raw.aliases)
      ? raw.aliases.filter((value): value is string => typeof value === 'string')
      : []
    const names = [label, ...aliases].map(normalizedName).filter(Boolean)
    const exact = names.includes(query)
    const related = names.some((name) => name.includes(query) || query.includes(name))
    const businessLike = BUSINESS_DESCRIPTION.test(description)
    const score = (businessLike ? 4 : 0) + (exact ? 2 : related ? 1 : 0)
    if (score > 0 && (!selected || score > selected.score)) {
      selected = { id: raw.id, score }
    }
  }
  return selected?.id ?? null
}

function officialDomain(payload: unknown): string | null {
  if (!isRecord(payload) || !isRecord(payload.claims) || !Array.isArray(payload.claims.P856)) {
    return null
  }
  const statements = payload.claims.P856
    .filter(isRecord)
    .filter((statement) => statement.rank !== 'deprecated')
    .sort((left, right) => Number(right.rank === 'preferred') - Number(left.rank === 'preferred'))
  for (const statement of statements) {
    const mainsnak = isRecord(statement.mainsnak) ? statement.mainsnak : null
    const datavalue = mainsnak && isRecord(mainsnak.datavalue) ? mainsnak.datavalue : null
    if (!datavalue || typeof datavalue.value !== 'string') continue
    try {
      const url = new URL(datavalue.value)
      if (
        (url.protocol !== 'https:' && url.protocol !== 'http:')
        || url.username
        || url.password
      ) continue
      const hostname = url.hostname
        .toLocaleLowerCase('en-US')
        .replace(/^www\./u, '')
        .replace(/\.$/u, '')
      const domain = normalizeCompanyDomain(hostname)
      if (domain) return domain
    } catch {
      continue
    }
  }
  return null
}

function apiUrl(parameters: Record<string, string>): URL {
  const url = new URL(WIKIDATA_API)
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value)
  return url
}

export async function lookupCompanyDomain(
  company: string,
  { signal, fetchImpl = fetch }: CompanyDomainLookupOptions,
): Promise<string | null> {
  const query = company.trim()
  if (!query || signal.aborted) return null
  const init: RequestInit = {
    credentials: 'omit',
    headers: { accept: 'application/json' },
    referrerPolicy: 'no-referrer',
    signal,
  }
  try {
    const searchResponse = await fetchImpl(apiUrl({
      action: 'wbsearchentities',
      format: 'json',
      language: 'en',
      limit: '3',
      origin: '*',
      search: query,
      type: 'item',
    }), init)
    const entityId = searchEntityId(await readJson(searchResponse), query)
    if (!entityId || signal.aborted) return null

    const claimsResponse = await fetchImpl(apiUrl({
      action: 'wbgetclaims',
      entity: entityId,
      format: 'json',
      origin: '*',
      property: 'P856',
    }), init)
    return officialDomain(await readJson(claimsResponse))
  } catch {
    return null
  }
}

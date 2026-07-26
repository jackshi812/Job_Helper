import {
  detectAts,
  UNSUPPORTED_URL_MESSAGE,
} from '../../../supabase/functions/_shared/detect'
import { supabase } from './supabase'

export const COMPANY_COLUMNS =
  'id, name, ats_type, board_token, region, careers_url, source_key, site_token, activation_state, activation_successes, last_verified_at, last_polled_at, last_success_at, consecutive_failures, last_error, last_error_code, last_observation_count, created_at'

export const SOURCE_COVERAGE_CATALOG_COLUMNS =
  'id, company_name, careers_url, provider, access_evidence, disposition, verified_at, unsupported_reason, source_key'

export interface CompanyRecord {
  id: string
  name: string
  ats_type:
    | 'greenhouse'
    | 'lever'
    | 'ashby'
    | 'smartrecruiters'
    | 'recruitee'
    | 'workday'
    | 'paylocity'
    | 'eightfold'
    | 'oracle_recruiting'
    | 'goldman_higher'
  board_token: string
  region: string | null
  careers_url: string
  source_key: string
  site_token: string | null
  activation_state: 'experimental' | 'active' | 'disabled'
  activation_successes: number
  last_verified_at: string | null
  last_polled_at: string | null
  last_success_at: string | null
  consecutive_failures: number
  last_error: string | null
  last_error_code: string | null
  last_observation_count: number | null
  created_at: string
}

export interface SourceCoverageCatalogRecord {
  id: string
  company_name: string
  careers_url: string
  provider: string
  access_evidence: string
  disposition: 'experimental' | 'unsupported_with_reason'
  verified_at: string
  unsupported_reason: string | null
  source_key: string | null
}

export type WatchlistHealthState = 'ok' | 'degraded' | 'unsupported'

export interface WatchlistRow {
  key: string
  company_id: string | null
  catalog_id: string | null
  name: string
  careers_url: string | null
  source_key: string | null
  provider: string
  access_evidence: string | null
  disposition: SourceCoverageCatalogRecord['disposition'] | 'operational'
  activation_state: CompanyRecord['activation_state'] | 'disabled'
  activation_successes: number
  health_state: WatchlistHealthState
  last_success_at: string | null
  last_error_code: string | null
  unsupported_reason: string | null
  created_at: string | null
  scheduled: boolean
  monitored: boolean
}

export interface ActivationPresentation {
  label: 'Active' | 'Experimental' | 'Disabled'
  details: string[]
}

export interface HealthPresentation {
  label: 'OK' | 'Degraded' | 'Unsupported'
  detail: string | null
  retention: string | null
}

export type HealthStatus = 'ok' | 'failing' | 'stale'

export type VerifyBoardResponse =
  | {
      ok: true
      company: CompanyRecord
      already_watched: false
    }
  | {
      ok: false
      reason: 'unsupported' | 'not_found' | 'already_watched' | 'unauthorized' | 'forbidden' | 'error'
      message: string
    }

export function safeCareersUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null
    return parsed.href
  } catch {
    return null
  }
}

function healthState(
  company: CompanyRecord,
  lastSuccessAt: string | null,
): Exclude<WatchlistHealthState, 'unsupported'> {
  return company.consecutive_failures > 0
    || company.last_error_code !== null
    || lastSuccessAt === null
    ? 'degraded'
    : 'ok'
}

function operationalRow(
  company: CompanyRecord,
  catalog: SourceCoverageCatalogRecord | null,
): WatchlistRow {
  const experimentalVerificationSuccessAt = company.activation_state === 'experimental'
    && company.activation_successes > 0
    && company.consecutive_failures === 0
    && company.last_error_code === null
    ? company.last_verified_at
    : null
  const displaySuccessAt = company.last_success_at ?? experimentalVerificationSuccessAt

  return {
    key: `company:${company.id}`,
    company_id: company.id,
    catalog_id: catalog?.id ?? null,
    name: catalog?.company_name ?? company.name,
    careers_url: catalog?.careers_url ?? company.careers_url,
    source_key: company.source_key,
    provider: catalog?.provider ?? company.ats_type,
    access_evidence: catalog?.access_evidence ?? null,
    disposition: catalog?.disposition ?? 'operational',
    activation_state: company.activation_state,
    activation_successes: Math.min(3, Math.max(0, company.activation_successes)),
    health_state: healthState(company, displaySuccessAt),
    last_success_at: displaySuccessAt,
    last_error_code: company.last_error_code,
    unsupported_reason: null,
    created_at: company.created_at,
    scheduled: company.activation_state === 'active',
    monitored: true,
  }
}

function catalogOnlyRow(catalog: SourceCoverageCatalogRecord): WatchlistRow {
  return {
    key: `catalog:${catalog.id}`,
    company_id: null,
    catalog_id: catalog.id,
    name: catalog.company_name,
    careers_url: catalog.careers_url,
    source_key: catalog.disposition === 'unsupported_with_reason' ? null : catalog.source_key,
    provider: catalog.provider,
    access_evidence: catalog.access_evidence,
    disposition: catalog.disposition,
    activation_state: 'disabled',
    activation_successes: 0,
    health_state: 'unsupported',
    last_success_at: null,
    last_error_code: null,
    unsupported_reason: catalog.unsupported_reason ?? 'Experimental connector not yet configured',
    created_at: null,
    scheduled: false,
    monitored: false,
  }
}

export function mergeCoverageRows(
  companies: CompanyRecord[],
  catalog: SourceCoverageCatalogRecord[],
): WatchlistRow[] {
  const catalogBySourceKey = new Map(
    catalog
      .filter((entry): entry is SourceCoverageCatalogRecord & { source_key: string } => (
        entry.source_key !== null
      ))
      .map((entry) => [entry.source_key, entry]),
  )
  const matchedCatalogIds = new Set<string>()

  const companyRows = companies.map((company) => {
    const catalogEntry = catalogBySourceKey.get(company.source_key) ?? null
    if (catalogEntry) matchedCatalogIds.add(catalogEntry.id)
    return operationalRow(company, catalogEntry)
  })
  const catalogRows = catalog
    .filter((entry) => !matchedCatalogIds.has(entry.id))
    .map(catalogOnlyRow)

  return [...companyRows, ...catalogRows]
}

export async function listCompanies(): Promise<WatchlistRow[]> {
  const { data: companies, error: companiesError } = await supabase
    .from('companies')
    .select(COMPANY_COLUMNS)
    .order('created_at', { ascending: false })

  if (companiesError) throw companiesError

  const { data: catalog, error: catalogError } = await supabase
    .from('source_coverage_catalog')
    .select(SOURCE_COVERAGE_CATALOG_COLUMNS)
    .order('company_name', { ascending: true })

  if (catalogError) throw catalogError
  return mergeCoverageRows(
    (companies ?? []) as CompanyRecord[],
    (catalog ?? []) as SourceCoverageCatalogRecord[],
  )
}

export async function addCompany(url: string): Promise<CompanyRecord> {
  if (detectAts(url).ats === 'unsupported') throw new Error(UNSUPPORTED_URL_MESSAGE)

  const { data: verificationData, error: verificationError } =
    await supabase.functions.invoke('verify-board', { body: { url } })
  const verification = verificationData as VerifyBoardResponse | null

  if (verificationError) {
    const context = (verificationError as { context?: Response }).context
    if (context) {
      let message: string | null = null
      try {
        const response = await context.clone().json() as { message?: unknown }
        message = typeof response.message === 'string' ? response.message : null
      } catch { /* retain the original invocation error */ }
      if (message) throw new Error(message)
    }
    throw verificationError
  }
  if (!verification?.ok) {
    throw new Error(verification?.message ?? 'Unable to verify this job board. Please try again.')
  }

  return verification.company
}

export async function removeCompany(id: string): Promise<void> {
  const { error } = await supabase.from('companies').delete().eq('id', id)
  if (error) throw error
}

export function deriveHealth(company: CompanyRecord, now = new Date()): HealthStatus {
  if (company.consecutive_failures >= 3) return 'failing'
  if (!company.last_success_at) return 'stale'

  const lastSuccess = new Date(company.last_success_at).getTime()
  if (!Number.isFinite(lastSuccess) || now.getTime() - lastSuccess > 30 * 60_000) return 'stale'
  return 'ok'
}

export function activationPresentation(row: WatchlistRow): ActivationPresentation {
  const capitalOneFilterNote = row.company_id
    && row.source_key === 'workday:wd12:capitalone:Capital_One'
    ? ['Workday filter: Analysis and Finance roles posted in the last 7 days; U.S. only; required experience below 3 years (job title does not exclude a role).']
    : null

  const fidelityFilterNote = row.company_id
    && row.source_key === 'workday:wd1:fmr:FidelityCareers'
    ? ['Workday filter: excludes Sales, Customer Service, and Sales Support roles; required experience is applied by the dashboard filters, not the connector.']
    : null

  const filterNote = capitalOneFilterNote ?? fidelityFilterNote

  if (row.activation_state === 'active') {
    return { label: 'Active', details: filterNote ?? [] }
  }
  if (row.activation_state === 'experimental') {
    return {
      label: 'Experimental',
      details: filterNote
        ?? [`${row.activation_successes} of 3 checks passed`, 'Scheduled polling off'],
    }
  }
  return { label: 'Disabled', details: ['Scheduled polling off'] }
}

function degradedDetail(code: string | null) {
  if (code === 'timeout' || code === 'provider_timeout') return 'Timed out while syncing.'
  if (code && /^(http_401|http_403|invalid_provider_content)$/.test(code)) {
    return 'Access blocked by source.'
  }
  if (code && /^(malformed_response|provider_schema_invalid|schema_changed)$/.test(code)) {
    return 'Source response changed.'
  }
  if (code && /^(detail_failure|pagination_incomplete|count_mismatch|http_429)$/.test(code)) {
    return 'Source returned an incomplete job list.'
  }
  if (code === 'implausibly_empty') return 'Unexpected empty result.'
  return 'Latest sync could not be completed.'
}

export function healthPresentation(row: WatchlistRow): HealthPresentation {
  if (row.health_state === 'unsupported') {
    return {
      label: 'Unsupported',
      detail: row.unsupported_reason ?? 'No stable public feed',
      retention: 'Not monitored',
    }
  }
  if (row.health_state === 'degraded') {
    return {
      label: 'Degraded',
      detail: degradedDetail(row.last_error_code),
      retention: 'Last-known jobs retained.',
    }
  }
  return { label: 'OK', detail: null, retention: null }
}

import { detectAts, UNSUPPORTED_URL_MESSAGE } from '../_shared/detect.ts'
import {
  verifyConnector,
} from '../_shared/connectors.ts'
import { CAPITAL_ONE_WORKDAY_SOURCE_KEY } from '../_shared/adapters/workday.ts'

const VERIFICATION_FAILED_MESSAGE =
  "We couldn't verify this board — it may not exist or the URL may be misspelled. Check the address and try again."
const COMPANY_COLUMNS =
  'id, name, ats_type, board_token, region, careers_url, source_key, site_token, activation_state, activation_successes, last_verified_at, last_polled_at, last_success_at, consecutive_failures, last_error, last_error_code, last_observation_count, created_at'
const AUTH_STAGE_HEADER = 'x-job-copilot-auth-stage'
const FETCH_COUNT_HEADER = 'x-job-copilot-provider-fetch-count'

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Origin': '*',
}

interface AuthUser {
  id: string
  role?: string
}

interface AuthClient {
  auth: {
    getUser: (token: string) => Promise<{
      data: { user: AuthUser | null }
      error: unknown
    }>
  }
}

interface InsertResult {
  data: unknown
  error: null | { code?: string; message?: string }
}

interface CompanyTable {
  insert: (value: Record<string, unknown>) => {
    select: (columns: string) => { single: () => Promise<InsertResult> }
  }
  select?: (columns: string) => {
    eq: (column: string, value: unknown) => { maybeSingle: () => Promise<InsertResult> }
  }
  update?: (value: Record<string, unknown>) => {
    eq: (column: string, value: unknown) => Promise<{ error: InsertResult['error'] }>
  }
}

interface ServiceClient {
  from: (table: string) => CompanyTable
  rpc?: (name: string, args?: Record<string, unknown>) => Promise<{
    data: unknown
    error: InsertResult['error']
  }>
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface VerifyBoardDependencies {
  createAuthClient: () => AuthClient
  createServiceClient: () => ServiceClient
  providerFetch: FetchLike
  now?: () => Date
  randomUUID?: () => string
  digestEvidence?: (value: string) => Promise<string>
}

interface ActivationResult {
  accepted: boolean
  reason: string
  progress: number | null
  window_start: string | null
  next_eligible_at: string | null
  result_activation_state: string | null
}

const stagedActivationProviders = new Set(['smartrecruiters', 'recruitee', 'workday'])

function diagnosticHeaders(stage: string, fetchCount: number) {
  return {
    ...corsHeaders,
    [AUTH_STAGE_HEADER]: stage.slice(0, 24),
    [FETCH_COUNT_HEADER]: String(Math.max(0, Math.min(fetchCount, 9))),
  }
}

function json(body: unknown, status: number, stage: string, fetchCount: number) {
  return Response.json(body, {
    status,
    headers: diagnosticHeaders(stage, fetchCount),
  })
}

function bearerToken(request: Request) {
  const authorization = request.headers.get('authorization')
  const match = authorization?.match(/^Bearer ([A-Za-z0-9._~-]{8,})$/)
  return match?.[1] ?? null
}

function duplicateMessage(companyName: string) {
  return `${companyName} is already on the watchlist.`
}

function sourceKeyForDetection(detected: Exclude<ReturnType<typeof detectAts>, { ats: 'unsupported' }>) {
  if (detected.ats === 'workday') return CAPITAL_ONE_WORKDAY_SOURCE_KEY
  return `${detected.ats}:${detected.region ?? 'global'}:${detected.slug}`
}

function boundedVerificationCode(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  return /^[a-z0-9_]{1,64}$/.test(message) ? message : 'verification_failed'
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function lookupCompany(service: ServiceClient, sourceKey: string) {
  const table = service.from('companies')
  if (!table.select) throw new Error('company_lookup_unavailable')
  const { data, error } = await table
    .select(COMPANY_COLUMNS)
    .eq('source_key', sourceKey)
    .maybeSingle()
  if (error || !data) throw new Error('company_lookup_failed')
  return data
}

async function recordVerificationFailure(
  service: ServiceClient,
  sourceKey: string,
  error: unknown,
) {
  const table = service.from('companies')
  if (!table.update) return
  const result = await table
    .update({
      last_error: 'Manual verification failed.',
      last_error_code: boundedVerificationCode(error),
    })
    .eq('source_key', sourceKey)
  if (result.error) throw new Error('verification_health_update_failed')
}

function parseActivationResult(value: unknown): ActivationResult {
  const row = Array.isArray(value) ? value[0] : value
  if (!row || typeof row !== 'object') throw new Error('activation_result_invalid')
  const candidate = row as Partial<ActivationResult>
  if (
    typeof candidate.accepted !== 'boolean'
    || typeof candidate.reason !== 'string'
    || (candidate.progress !== null && (
      !Number.isInteger(candidate.progress)
      || (candidate.progress as number) < 0
      || (candidate.progress as number) > 3
    ))
    || (candidate.window_start !== null && typeof candidate.window_start !== 'string')
    || (candidate.next_eligible_at !== null && typeof candidate.next_eligible_at !== 'string')
    || (candidate.result_activation_state !== null && typeof candidate.result_activation_state !== 'string')
  ) {
    throw new Error('activation_result_invalid')
  }
  return candidate as ActivationResult
}

async function recordEligibleObservation(
  service: ServiceClient,
  dependencies: VerifyBoardDependencies,
  companyId: string,
  verified: Awaited<ReturnType<typeof verifyConnector>>,
) {
  if (!service.rpc) throw new Error('activation_rpc_unavailable')
  const digestInput = JSON.stringify([
    verified.ats,
    verified.sourceKey,
    verified.jobCount,
  ])
  const evidenceDigest = await (dependencies.digestEvidence ?? sha256Hex)(digestInput)
  const { data, error } = await service.rpc('record_connector_observation', {
    p_company_id: companyId,
    p_observation_id: (dependencies.randomUUID ?? (() => crypto.randomUUID()))(),
    p_completeness: 'complete',
    p_credible_for_closure: true,
    p_job_count: verified.jobCount,
    p_expected_count: verified.jobCount,
    p_warning_count: 0,
    p_evidence_digest: evidenceDigest,
  })
  if (error) throw new Error('activation_rpc_failed')
  return parseActivationResult(data)
}

export function createVerifyBoardHandler(dependencies: VerifyBoardDependencies) {
  return async (request: Request): Promise<Response> => {
    let providerFetchCount = 0
    const countedFetch: FetchLike = async (input, init) => {
      providerFetchCount += 1
      return dependencies.providerFetch(input, init)
    }

    if (request.method === 'OPTIONS') {
      return new Response('ok', { headers: diagnosticHeaders('preflight', 0) })
    }
    if (request.method !== 'POST') {
      return json({ ok: false, reason: 'error', message: 'Method not allowed.' }, 405, 'rejected', 0)
    }

    const token = bearerToken(request)
    if (!token) {
      return json({ ok: false, reason: 'unauthorized', message: 'Unauthorized.' }, 401, 'rejected', 0)
    }

    let resolved: Awaited<ReturnType<AuthClient['auth']['getUser']>>
    try {
      resolved = await dependencies.createAuthClient().auth.getUser(token)
    } catch {
      return json({ ok: false, reason: 'unauthorized', message: 'Unauthorized.' }, 401, 'rejected', 0)
    }
    if (resolved.error || !resolved.data.user) {
      return json({ ok: false, reason: 'unauthorized', message: 'Unauthorized.' }, 401, 'rejected', 0)
    }
    if (resolved.data.user.role !== 'authenticated') {
      return json({ ok: false, reason: 'forbidden', message: 'Forbidden.' }, 403, 'rejected', 0)
    }

    try {
      const body = await request.json() as { url?: unknown }
      const detected = detectAts(typeof body.url === 'string' ? body.url : '')
      if (detected.ats === 'unsupported') {
        return json({ ok: false, reason: 'unsupported', message: UNSUPPORTED_URL_MESSAGE }, 200, 'authenticated', 0)
      }

      let verified: Awaited<ReturnType<typeof verifyConnector>>
      try {
        verified = await verifyConnector(detected, countedFetch)
      } catch (error) {
        const service = dependencies.createServiceClient()
        await recordVerificationFailure(service, sourceKeyForDetection(detected), error)
        throw error
      }

      const service = dependencies.createServiceClient()
      const verifiedAt = (dependencies.now ?? (() => new Date()))().toISOString()
      const usesStagedActivation = stagedActivationProviders.has(verified.ats)
      const { data, error } = await service
        .from('companies')
        .insert({
          name: verified.companyName,
          ats_type: verified.ats,
          board_token: verified.boardToken,
          region: verified.region,
          careers_url: verified.careersUrl,
          source_key: verified.sourceKey,
          site_token: verified.siteToken,
          activation_state: usesStagedActivation ? 'experimental' : 'active',
          activation_successes: 0,
          last_verified_at: verifiedAt,
          last_observation_count: verified.jobCount,
          last_error: null,
          last_error_code: null,
        })
        .select(COMPANY_COLUMNS)
        .single()

      if (error?.code === '23505' && !usesStagedActivation) {
        return json({
          ok: false,
          reason: 'already_watched',
          message: duplicateMessage(verified.companyName),
        }, 409, 'verified', providerFetchCount)
      }
      if (error && error.code !== '23505') throw new Error('company_insert_failed')

      if (usesStagedActivation) {
        const company = error?.code === '23505'
          ? await lookupCompany(service, verified.sourceKey)
          : data
        if (!company || typeof company !== 'object' || typeof (company as { id?: unknown }).id !== 'string') {
          throw new Error('company_result_invalid')
        }
        const activation = await recordEligibleObservation(
          service,
          dependencies,
          (company as { id: string }).id,
          verified,
        )
        const persistedCompany = await lookupCompany(service, verified.sourceKey)

        return json({
          ok: true,
          company: persistedCompany,
          already_watched: error?.code === '23505',
          activation,
        }, 200, 'verified', providerFetchCount)
      }

      return json({ ok: true, company: data, already_watched: false }, 200, 'verified', providerFetchCount)
    } catch (error) {
      console.error('verify-board failed', error instanceof Error ? error.message : 'unknown')
      return json({ ok: false, reason: 'error', message: VERIFICATION_FAILED_MESSAGE }, 200, 'authenticated', providerFetchCount)
    }
  }
}

type DenoRuntime = {
  env: { get: (name: string) => string | undefined }
  serve: (handler: (request: Request) => Promise<Response>) => void
}

function requiredEnvironment(runtime: DenoRuntime, name: string) {
  const value = runtime.env.get(name)
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

async function startDenoServer(runtime: DenoRuntime) {
  const { createClient } = await import(
    /* @vite-ignore */ 'npm:@supabase/supabase-js@2.110.7'
  )
  const url = requiredEnvironment(runtime, 'SUPABASE_URL')
  const clientOptions = {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  }
  runtime.serve(createVerifyBoardHandler({
    createAuthClient: () => createClient(
      url,
      requiredEnvironment(runtime, 'SUPABASE_ANON_KEY'),
      clientOptions,
    ) as unknown as AuthClient,
    createServiceClient: () => createClient(
      url,
      requiredEnvironment(runtime, 'SUPABASE_SERVICE_ROLE_KEY'),
      clientOptions,
    ) as unknown as ServiceClient,
    providerFetch: fetch,
  }))
}

const runtime = (globalThis as typeof globalThis & { Deno?: DenoRuntime }).Deno
if (runtime) void startDenoServer(runtime)

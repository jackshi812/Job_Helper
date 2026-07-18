import { detectAts, UNSUPPORTED_URL_MESSAGE } from '../_shared/detect.ts'
import { verifyConnector } from '../_shared/connectors.ts'

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

interface ServiceClient {
  from: (table: string) => {
    insert: (value: Record<string, unknown>) => {
      select: (columns: string) => { single: () => Promise<InsertResult> }
    }
  }
  rpc?: (name: string, args?: Record<string, unknown>) => Promise<unknown>
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface VerifyBoardDependencies {
  createAuthClient: () => AuthClient
  createServiceClient: () => ServiceClient
  providerFetch: FetchLike
  now?: () => Date
}

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

      const verified = await verifyConnector(detected, countedFetch)
      const service = dependencies.createServiceClient()
      const verifiedAt = (dependencies.now ?? (() => new Date()))().toISOString()
      const { data, error } = await service
        .from('companies')
        .insert({
          name: verified.companyName,
          ats_type: verified.ats,
          board_token: verified.boardToken,
          region: verified.region,
          careers_url: verified.careersUrl,
          source_key: verified.sourceKey,
          site_token: null,
          activation_state: 'active',
          activation_successes: 0,
          last_verified_at: verifiedAt,
          last_observation_count: verified.jobCount,
          last_error: null,
          last_error_code: null,
        })
        .select(COMPANY_COLUMNS)
        .single()

      if (error?.code === '23505') {
        return json({
          ok: false,
          reason: 'already_watched',
          message: duplicateMessage(verified.companyName),
        }, 409, 'verified', providerFetchCount)
      }
      if (error) throw new Error('company_insert_failed')

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

import {
  routeResume,
  type ResumeExtractInput,
} from '../_shared/routing.ts'

const corsHeaders = {
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Origin': '*',
}
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

interface AuthClient {
  auth: {
    getUser(token: string): Promise<{
      data: { user: { id: string; role?: string } | null }
      error: unknown
    }>
  }
}

interface QueryResult {
  data: unknown
  error: null | { code?: string; message?: string }
}

interface Query {
  select(columns: string): Query
  eq(column: string, value: unknown): Query
  in(column: string, values: string[]): Query
  lt(column: string, value: number): Query
  single(): Promise<QueryResult>
  then(
    resolve: (result: QueryResult) => unknown,
    reject?: (error: unknown) => unknown,
  ): Promise<unknown>
}

interface ServiceClient {
  from(table: string): Query
  rpc(name: string, args: Record<string, unknown>): Promise<QueryResult>
}

export interface RouteDashboardResumesDependencies {
  createAuthClient(): AuthClient
  createServiceClient(): ServiceClient
}

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: corsHeaders })
}

function bearerToken(request: Request) {
  const authorization = request.headers.get('authorization')
  const match = authorization?.match(/^Bearer ([A-Za-z0-9._~-]{8,})$/)
  return match?.[1] ?? null
}

function keywords(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

function conflict(error: QueryResult['error']) {
  return /resume_route_revision_conflict/i.test(error?.message ?? '')
}

export function createRouteDashboardResumesHandler(
  dependencies: RouteDashboardResumesDependencies,
) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders })
    }
    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405)
    }

    const token = bearerToken(request)
    if (!token) return json({ error: 'unauthorized' }, 401)

    let authResult: Awaited<ReturnType<AuthClient['auth']['getUser']>>
    try {
      authResult = await dependencies.createAuthClient().auth.getUser(token)
    } catch {
      return json({ error: 'unauthorized' }, 401)
    }
    if (authResult.error || !authResult.data.user) {
      return json({ error: 'unauthorized' }, 401)
    }
    if (authResult.data.user.role !== 'authenticated') {
      return json({ error: 'forbidden' }, 403)
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return json({ error: 'invalid_request' }, 400)
    }
    const ids = (
      body && typeof body === 'object' && !Array.isArray(body)
        ? (body as { user_job_ids?: unknown }).user_job_ids
        : null
    )
    if (
      !Array.isArray(ids)
      || ids.length < 1
      || ids.length > 200
      || ids.some((id) => typeof id !== 'string' || !UUID.test(id))
      || new Set(ids).size !== ids.length
    ) {
      return json({ error: 'invalid_request' }, 400)
    }

    const userId = authResult.data.user.id
    const service = dependencies.createServiceClient()
    const stateResult = await service
      .from('deterministic_ranking_state')
      .select('resume_route_revision')
      .eq('user_id', userId)
      .single()
    const revision = Number(
      (stateResult.data as { resume_route_revision?: unknown } | null)
        ?.resume_route_revision,
    )
    if (
      stateResult.error
      || !Number.isSafeInteger(revision)
      || revision < 1
    ) {
      return json({ error: 'route_unavailable' }, 500)
    }

    const jobsResult = await service
      .from('user_jobs')
      .select('id, resume_route_revision, jobs!inner(title, description_text)')
      .eq('user_id', userId)
      .in('id', ids as string[])
      .lt('resume_route_revision', revision) as unknown as QueryResult
    if (jobsResult.error || !Array.isArray(jobsResult.data)) {
      return json({ error: 'route_unavailable' }, 500)
    }
    const staleRows = jobsResult.data as Array<{
      id: string
      jobs: { title?: unknown; description_text?: unknown } | null
    }>
    if (staleRows.length === 0) {
      return json({ route_revision: revision, updated_count: 0, routes: [] }, 200)
    }

    const extractsResult = await service
      .from('resume_extracts')
      .select('resume_id, keywords, resumes!inner(filename)')
      .eq('user_id', userId)
      .eq('status', 'ready') as unknown as QueryResult
    if (extractsResult.error || !Array.isArray(extractsResult.data)) {
      return json({ error: 'route_unavailable' }, 500)
    }
    const extracts: ResumeExtractInput[] = extractsResult.data.flatMap(
      (value) => {
        const row = value as {
          resume_id?: unknown
          keywords?: unknown
          resumes?: { filename?: unknown } | null
        }
        return typeof row.resume_id === 'string'
            && typeof row.resumes?.filename === 'string'
          ? [{
            resumeId: row.resume_id,
            filename: row.resumes.filename,
            keywords: keywords(row.keywords),
          }]
          : []
      },
    )

    const routes = staleRows.map((row) => {
      const title = typeof row.jobs?.title === 'string' ? row.jobs.title : ''
      const description = typeof row.jobs?.description_text === 'string'
        ? row.jobs.description_text
        : ''
      const result = routeResume(`${title}\n${description}`, extracts)
      return {
        user_job_id: row.id,
        best_fit_resume_id: result?.resumeId ?? null,
        runner_up_resume_id: result?.runnerUpResumeId ?? null,
      }
    })
    const publish = await service.rpc('publish_resume_route_page', {
      p_user_id: userId,
      p_expected_revision: revision,
      p_routes: routes,
    })
    if (publish.error) {
      if (conflict(publish.error)) {
        return json({ error: 'route_revision_conflict', retryable: true }, 409)
      }
      return json({ error: 'route_unavailable' }, 500)
    }
    const updatedCount = Number(publish.data)
    if (!Number.isSafeInteger(updatedCount) || updatedCount !== routes.length) {
      return json({ error: 'route_unavailable' }, 500)
    }
    return json({
      route_revision: revision,
      updated_count: updatedCount,
      routes,
    }, 200)
  }
}

declare const Deno: {
  env: { get(name: string): string | undefined }
  serve(handler: (request: Request) => Promise<Response>): void
}

function requiredEnvironment(name: string) {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

if (typeof Deno !== 'undefined') {
  const { createClient } = await import(
    'npm:@supabase/supabase-js@2.110.7'
  )
  const url = requiredEnvironment('SUPABASE_URL')
  const options = {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  }
  Deno.serve(createRouteDashboardResumesHandler({
    createAuthClient: () => createClient(
      url,
      requiredEnvironment('SUPABASE_PUBLISHABLE_KEY'),
      options,
    ) as unknown as AuthClient,
    createServiceClient: () => createClient(
      url,
      requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY'),
      options,
    ) as unknown as ServiceClient,
  }))
}

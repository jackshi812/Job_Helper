import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.110.7'
import {
  buildAdzunaUrl,
  mapAdzunaResult,
} from '../_shared/adapters/adzuna.ts'
import { fingerprint } from '../_shared/dedup.ts'
import {
  distinctSeedQueries,
  summarizeDiscovery,
} from '../_shared/discovery-health.ts'

interface SeedQuery {
  what: string
  where_loc: string
}

interface HeartbeatBudget {
  adzuna_requests_today: number
  adzuna_budget_date: string | null
}

interface OpenJob {
  source: string
  external_id: string
  fingerprint: string
}

interface AdzunaResponse {
  results?: Parameters<typeof mapAdzunaResult>[0][]
}

const DAILY_REQUEST_CUTOFF = 240

function requiredEnvironment(name: string) {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

async function writeBudget(
  admin: SupabaseClient,
  requestCount: number,
  budgetDate: string,
) {
  const { error } = await admin
    .from('pipeline_heartbeat')
    .update({
      adzuna_requests_today: requestCount,
      adzuna_budget_date: budgetDate,
    })
    .eq('id', true)
  if (error) throw error
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret || request.headers.get('x-cron-secret') !== cronSecret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const appId = Deno.env.get('ADZUNA_APP_ID')
  const appKey = Deno.env.get('ADZUNA_APP_KEY')
  if (!appId || !appKey) {
    // Missing configuration is not a completed sweep, so preserve the last known health.
    return Response.json({ skipped: 'missing adzuna credentials' })
  }

  try {
    const admin = createClient(
      requiredEnvironment('SUPABASE_URL'),
      requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY'),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      },
    )

    const today = new Date().toISOString().slice(0, 10)
    const { data: heartbeat, error: heartbeatError } = await admin
      .from('pipeline_heartbeat')
      .select('adzuna_requests_today, adzuna_budget_date')
      .eq('id', true)
      .single()
    if (heartbeatError) throw heartbeatError

    const budget = heartbeat as HeartbeatBudget
    let requestCount = budget.adzuna_budget_date === today
      ? budget.adzuna_requests_today
      : 0
    if (budget.adzuna_budget_date !== today) {
      await writeBudget(admin, requestCount, today)
    }

    if (requestCount >= DAILY_REQUEST_CUTOFF) {
      // Budget exhaustion is expected protection, not evidence of discovery failure.
      return Response.json({ skipped: 'budget', requestsToday: requestCount })
    }

    const { data: seedQueries, error: seedError } = await admin
      .from('seed_queries')
      .select('what, where_loc')
      .eq('enabled', true)
    if (seedError) throw seedError

    const { data: openJobs, error: jobsError } = await admin
      .from('jobs')
      .select('source, external_id, fingerprint')
      .eq('status', 'open')
    if (jobsError) throw jobsError

    const openByFingerprint = new Map(
      ((openJobs ?? []) as OpenJob[]).map((job) => [job.fingerprint, job]),
    )
    const openByExternalId = new Map(
      ((openJobs ?? []) as OpenJob[])
        .filter((job) => job.source === 'adzuna')
        .map((job) => [job.external_id, job]),
    )
    let inserted = 0
    let refreshed = 0
    let duplicates = 0
    let failedQueries = 0
    let attempted = 0
    let succeeded = 0

    for (const seed of distinctSeedQueries((seedQueries ?? []) as SeedQuery[])) {
      if (requestCount >= DAILY_REQUEST_CUTOFF) break

      requestCount += 1
      attempted += 1
      // Persist before the request so timeouts and partial failures still spend budget.
      await writeBudget(admin, requestCount, today)

      let results: AdzunaResponse['results']
      try {
        const response = await fetch(
          buildAdzunaUrl('us', seed.what, seed.where_loc, appId, appKey),
        )
        if (!response.ok) {
          throw new Error(`Adzuna HTTP ${response.status}`)
        }
        const payload = (await response.json()) as AdzunaResponse
        results = payload.results ?? []
        succeeded += 1
      } catch (error) {
        failedQueries += 1
        console.error('discovery-sweep query failed', error)
        continue
      }

      for (const raw of results) {
        const normalized = mapAdzunaResult(raw)
        const jobFingerprint = fingerprint(
          normalized.companyName ?? '',
          normalized.title,
          normalized.location,
        )
        const exact = openByExternalId.get(normalized.externalId)
        const existing = openByFingerprint.get(jobFingerprint)
        const seenAt = new Date().toISOString()

        if (exact) {
          const { error: refreshError } = await admin
            .from('jobs')
            .update({ last_seen_at: seenAt })
            .eq('source', 'adzuna')
            .eq('external_id', normalized.externalId)
          if (refreshError) throw refreshError
          refreshed += 1
          continue
        }

        if (existing) {
          duplicates += 1
          continue
        }

        const { error: upsertError } = await admin.from('jobs').upsert(
          {
            company_id: null,
            source: normalized.source,
            external_id: normalized.externalId,
            title: normalized.title,
            location: normalized.location,
            absolute_url: normalized.absoluteUrl,
            posted_at: normalized.postedAt,
            description_html: normalized.descriptionHtml,
            description_text: normalized.descriptionText,
            snapshot_partial: normalized.snapshotPartial,
            fingerprint: jobFingerprint,
            last_seen_at: seenAt,
          },
          { onConflict: 'source,external_id' },
        )
        if (upsertError) throw upsertError

        inserted += 1
        const openJob = {
          source: normalized.source,
          external_id: normalized.externalId,
          fingerprint: jobFingerprint,
        }
        openByFingerprint.set(jobFingerprint, openJob)
        openByExternalId.set(normalized.externalId, openJob)
      }
    }

    const closedAt = new Date().toISOString()
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString()
    const { data: closedRows, error: closeError } = await admin
      .from('jobs')
      .update({ status: 'closed', closed_at: closedAt })
      .eq('source', 'adzuna')
      .eq('status', 'open')
      .lt('first_seen_at', cutoff)
      .select('id')
    if (closeError) throw closeError

    const summary = summarizeDiscovery(attempted, succeeded)
    const discoveryAt = new Date().toISOString()
    const discoveryHeartbeat: Record<string, string> = {
      discovery_status: summary.status,
      last_discovery_at: discoveryAt,
    }
    if (succeeded > 0 || attempted === 0) {
      discoveryHeartbeat.last_discovery_success_at = discoveryAt
    }

    const { error: discoveryHeartbeatError } = await admin
      .from('pipeline_heartbeat')
      .update(discoveryHeartbeat)
      .eq('id', true)
    if (discoveryHeartbeatError) throw discoveryHeartbeatError

    return Response.json(
      {
        requestsToday: requestCount,
        discoveryStatus: summary.status,
        attemptedQueries: attempted,
        succeededQueries: succeeded,
        failedQueries,
        inserted,
        refreshed,
        duplicates,
        closed: closedRows?.length ?? 0,
      },
      { status: summary.httpStatus },
    )
  } catch (error) {
    console.error('discovery-sweep failed', error)
    return Response.json({ error: 'Discovery sweep failed' }, { status: 500 })
  }
})

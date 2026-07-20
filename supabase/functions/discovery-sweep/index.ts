import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.110.7'
import {
  buildAdzunaUrl,
  mapAdzunaResult,
} from '../_shared/adapters/adzuna.ts'
import { fingerprint } from '../_shared/dedup.ts'
import {
  ADZUNA_DAILY_CUTOFF,
  ADZUNA_EFFECTIVE_DAILY_CUTOFF,
  chicagoDiscoverySlot,
  distinctSeedQueries,
  summarizeDiscovery,
} from '../_shared/discovery-health.ts'
import { exactJobReturnAction } from '../_shared/lifecycle.ts'

interface SeedQuery {
  what: string
  where_loc: string
}

interface SlotAdmission {
  admitted: boolean
  admitted_slot: string
}

interface OpenJob {
  source: string
  external_id: string
  fingerprint: string
}

interface AdzunaJob extends OpenJob {
  status: 'open' | 'closed'
}

interface QuotaReservation {
  reserved: boolean
  requests_today: number
  budget_date: string
}

interface AdzunaResponse {
  results?: Parameters<typeof mapAdzunaResult>[0][]
}

function requiredEnvironment(name: string) {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

async function writeDiscoveryFailure(
  admin: SupabaseClient,
  discoveryAt: string,
) {
  const { error } = await admin
    .from('pipeline_heartbeat')
    .update({
      discovery_status: 'failed',
      last_discovery_at: discoveryAt,
    })
    .eq('id', true)
  if (error) throw error
}

async function reserveAdzunaRequest(admin: SupabaseClient) {
  const { data, error } = await admin.rpc('reserve_adzuna_request', {
    p_effective_cutoff: ADZUNA_EFFECTIVE_DAILY_CUTOFF,
    p_hard_cutoff: ADZUNA_DAILY_CUTOFF,
  })
  if (error) throw error

  const reservation = (data as QuotaReservation[] | null)?.[0]
  if (!reservation) throw new Error('Adzuna quota reservation returned no row')
  return reservation
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret || request.headers.get('x-cron-secret') !== cronSecret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
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

    const requestBody = await request.json().catch(() => ({})) as { scheduled?: boolean }
    const now = new Date()

    if (requestBody.scheduled) {
      const slot = chicagoDiscoverySlot(now)
      if (!slot) {
        // Schedule gating is an intentional no-op: it spends no Adzuna quota and
        // preserves the last real discovery health state.
        return Response.json({ skipped: 'schedule' })
      }

      const { data, error } = await admin.rpc('admit_discovery_slot', {
        p_slot: slot,
      })
      if (error) throw error
      const admission = (data as SlotAdmission[] | null)?.[0]
      if (!admission?.admitted) {
        return Response.json({ skipped: 'schedule' })
      }
    }

    const appId = Deno.env.get('ADZUNA_APP_ID')
    const appKey = Deno.env.get('ADZUNA_APP_KEY')
    if (!appId || !appKey) {
      const discoveryAt = new Date().toISOString()
      await writeDiscoveryFailure(admin, discoveryAt)
      return Response.json(
        { error: 'Missing Adzuna credentials', discoveryStatus: 'failed' },
        { status: 503 },
      )
    }
    let requestCount = 0

    const { data: seedQueries, error: seedError } = await admin
      .from('seed_queries')
      .select('what, where_loc')
      .eq('enabled', true)
    if (seedError) throw seedError
    const seeds = distinctSeedQueries((seedQueries ?? []) as SeedQuery[])

    const { data: openJobs, error: jobsError } = await admin
      .from('jobs')
      .select('source, external_id, fingerprint')
      .eq('status', 'open')
    if (jobsError) throw jobsError

    const { data: adzunaJobs, error: adzunaJobsError } = await admin
      .from('jobs')
      .select('source, external_id, fingerprint, status')
      .eq('source', 'adzuna')
      .in('status', ['open', 'closed'])
    if (adzunaJobsError) throw adzunaJobsError

    const openByFingerprint = new Map(
      ((openJobs ?? []) as OpenJob[]).map((job) => [job.fingerprint, job]),
    )
    const openByExternalId = new Map(
      ((adzunaJobs ?? []) as AdzunaJob[])
        .map((job) => [job.external_id, job]),
    )
    let inserted = 0
    let refreshed = 0
    let reopened = 0
    let duplicates = 0
    let failedQueries = 0
    let attempted = 0
    let succeeded = 0
    let budgetExhausted = false

    for (const seed of seeds) {
      // Re-check immediately before every external call. The 75-request
      // effective allocation keeps seven- and thirty-day usage below the
      // official defaults while retaining the original 240/day hard ceiling.
      const reservation = await reserveAdzunaRequest(admin)
      requestCount = reservation.requests_today
      if (!reservation.reserved) {
        budgetExhausted = true
        break
      }

      attempted += 1

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
        const sourceCompanyName = normalized.companyName?.trim().slice(0, 200) || null
        const jobFingerprint = fingerprint(
          sourceCompanyName ?? '',
          normalized.title,
          normalized.location,
        )
        const exact = openByExternalId.get(normalized.externalId)
        const existing = openByFingerprint.get(jobFingerprint)
        const seenAt = new Date().toISOString()
        const exactAction = exactJobReturnAction(exact)

        if (exactAction !== 'insert' && exact) {
          const { error: refreshError } = await admin
            .from('jobs')
            .update({
              status: 'open',
              closed_at: null,
              last_seen_at: seenAt,
              source_company_name: sourceCompanyName,
            })
            .eq('source', 'adzuna')
            .eq('external_id', normalized.externalId)
          if (refreshError) throw refreshError
          if (exactAction === 'reopen') reopened += 1
          else refreshed += 1
          exact.status = 'open'
          openByFingerprint.set(jobFingerprint, exact)
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
            source_company_name: sourceCompanyName,
            fingerprint: jobFingerprint,
            last_seen_at: seenAt,
          },
          { onConflict: 'source,external_id', ignoreDuplicates: true },
        )
        if (upsertError) throw upsertError

        inserted += 1
        const openJob = {
          source: normalized.source,
          external_id: normalized.externalId,
          fingerprint: jobFingerprint,
          status: 'open' as const,
        }
        openByFingerprint.set(jobFingerprint, openJob)
        openByExternalId.set(normalized.externalId, openJob)
      }
    }

    if (budgetExhausted && attempted === 0) {
      // Budget exhaustion is an intentional no-op. Keep the last completed
      // sweep's health state and expose both policy ceilings to operators.
      return Response.json({
        skipped: 'budget',
        requestsToday: requestCount,
        dailyHardCutoff: ADZUNA_DAILY_CUTOFF,
        effectiveDailyCutoff: ADZUNA_EFFECTIVE_DAILY_CUTOFF,
        skippedQueries: seeds.length,
      })
    }

    const closedAt = new Date().toISOString()
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString()
    const { data: closedRows, error: closeError } = await admin
      .from('jobs')
      .update({ status: 'closed', closed_at: closedAt })
      .eq('source', 'adzuna')
      .eq('status', 'open')
      .lt('last_seen_at', cutoff)
      .select('id')
    if (closeError) throw closeError

    const skippedQueries = Math.max(0, seeds.length - attempted)
    const summary = summarizeDiscovery(attempted, succeeded, skippedQueries)
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
        skippedQueries,
        inserted,
        refreshed,
        reopened,
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

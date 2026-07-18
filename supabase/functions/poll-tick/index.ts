import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.110.7'
import { pollAshby } from '../_shared/adapters/ashby.ts'
import { pollGreenhouse } from '../_shared/adapters/greenhouse.ts'
import { pollLever } from '../_shared/adapters/lever.ts'
import {
  type NormalizedJob,
  type PollObservation,
} from '../_shared/adapters/types.ts'
import { fingerprint } from '../_shared/dedup.ts'
import {
  planCompanySync,
  observationHealthUpdate,
  shouldAdvanceSuccessHeartbeat,
  type ExistingJobRow,
} from '../_shared/lifecycle.ts'

type AtsType = 'greenhouse' | 'lever' | 'ashby'

interface Company {
  id: string
  name: string
  ats_type: AtsType
  board_token: string
  region: 'eu' | null
  consecutive_failures: number
  last_success_at: string | null
}

interface CompanyResult {
  inserted: number
  reopened: number
  closed: number
}

const DATABASE_BATCH_SIZE = 100

function diagnosticCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (/\b429\b/.test(message)) return 'http_429'
  if (/timeout|timed out|abort/i.test(message)) return 'timeout'
  if (/implausible empty/i.test(message)) return 'implausibly_empty'
  if (/HTML|WAF|content-type/i.test(message)) return 'invalid_provider_content'
  if (/JSON|parse|schema|shape/i.test(message)) return 'malformed_response'
  return 'source_poll_failed'
}

function requiredEnvironment(name: string) {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

async function pollCompany(company: Company, knownIds: Set<string>) {
  let jobs: NormalizedJob[]
  if (company.ats_type === 'greenhouse') {
    jobs = await pollGreenhouse(company.board_token, knownIds)
  } else if (company.ats_type === 'lever') {
    jobs = await pollLever(company.board_token, company.region ?? undefined)
  } else if (company.ats_type === 'ashby') {
    jobs = await pollAshby(company.board_token)
  } else {
    const exhaustive: never = company.ats_type
    throw new Error(`Unsupported ATS type: ${exhaustive}`)
  }

  return {
    jobs,
    completeness: 'complete',
    credibleForClosure: true,
    pageCount: 1,
    expectedCount: jobs.length,
    warnings: [],
  } satisfies PollObservation
}

function batches<T>(values: T[]) {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += DATABASE_BATCH_SIZE) {
    result.push(values.slice(index, index + DATABASE_BATCH_SIZE))
  }
  return result
}

function snapshot(
  company: Company,
  normalized: NormalizedJob,
  jobFingerprint: string,
  seenAt: string,
) {
  return {
    company_id: company.id,
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
  }
}

async function updateSeenJobs(
  admin: SupabaseClient,
  ids: string[],
  seenAt: string,
) {
  for (const batch of batches(ids)) {
    const { error } = await admin
      .from('jobs')
      .update({ last_seen_at: seenAt })
      .in('id', batch)
    if (error) throw error
  }
}

async function loadAdzunaMatches(admin: SupabaseClient, fingerprints: string[]) {
  const matches = new Map<string, string>()
  for (const batch of batches([...new Set(fingerprints)])) {
    const { data, error } = await admin
      .from('jobs')
      .select('id, fingerprint')
      .eq('status', 'open')
      .eq('source', 'adzuna')
      .in('fingerprint', batch)
    if (error) throw error
    for (const row of data ?? []) matches.set(row.fingerprint, row.id)
  }
  return matches
}

async function ingestNewJobs(
  admin: SupabaseClient,
  company: Company,
  jobs: Array<{ normalized: NormalizedJob; fingerprint: string }>,
  companyFingerprintIds: Map<string, string>,
  seenAt: string,
) {
  const adzunaMatches = await loadAdzunaMatches(
    admin,
    jobs.map((job) => job.fingerprint),
  )
  const inserts: ReturnType<typeof snapshot>[] = []

  for (const job of jobs) {
    const row = snapshot(company, job.normalized, job.fingerprint, seenAt)
    const adzunaId = adzunaMatches.get(job.fingerprint)

    if (adzunaId) {
      const { error } = await admin.from('jobs').update(row).eq('id', adzunaId)
      if (error) throw error
      continue
    }

    const repostId = companyFingerprintIds.get(job.fingerprint)
    if (repostId) {
      const { error } = await admin
        .from('jobs')
        .update({
          source: job.normalized.source,
          external_id: job.normalized.externalId,
          last_seen_at: seenAt,
        })
        .eq('id', repostId)
      if (error) throw error
      continue
    }

    inserts.push(row)
  }

  let inserted = 0
  for (const batch of batches(inserts)) {
    const { data, error } = await admin
      .from('jobs')
      .upsert(batch, {
        onConflict: 'source,external_id',
        ignoreDuplicates: true,
      })
      .select('id')
    if (error) throw error
    inserted += data?.length ?? 0
  }
  return inserted
}

async function processCompany(
  admin: SupabaseClient,
  company: Company,
): Promise<CompanyResult> {
  const { data: jobs, error: jobsError } = await admin
    .from('jobs')
    .select('id, source, external_id, fingerprint, status, last_seen_at')
    .eq('company_id', company.id)
    .in('status', ['open', 'closed'])
  if (jobsError) throw jobsError

  const existing = (jobs ?? []) as ExistingJobRow[]
  const openRows = existing.filter((job) => job.status === 'open')
  const knownIds = new Set(
    existing
      .filter((job) => job.source === company.ats_type)
      .map((job) => job.external_id),
  )
  let observation = await pollCompany(company, knownIds)

  if (openRows.length > 0 && observation.jobs.length === 0) {
    observation = {
      ...observation,
      completeness: 'unknown',
      credibleForClosure: false,
      warnings: ['implausibly_empty'],
    }
  }

  const seenAt = new Date().toISOString()
  const plan = planCompanySync(existing, observation, seenAt)
  const companyFingerprintIds = new Map(
    openRows.map((job) => [job.fingerprint, job.id]),
  )
  const newJobs = plan.newJobs.map((normalized) => ({
    normalized,
    fingerprint: fingerprint(
      normalized.companyName ?? company.name,
      normalized.title,
      normalized.location,
    ),
  }))

  await updateSeenJobs(admin, plan.seenOpenIds, seenAt)

  let reopened = 0
  for (const batch of batches(plan.reopenIds)) {
    const { data: reopenedRows, error: reopenError } = await admin
      .from('jobs')
      .update({ status: 'open', closed_at: null, last_seen_at: seenAt })
      .in('id', batch)
      .select('id')
    if (reopenError) throw reopenError
    reopened += reopenedRows?.length ?? 0
  }

  const inserted = await ingestNewJobs(
    admin,
    company,
    newJobs,
    companyFingerprintIds,
    seenAt,
  )

  const health = observationHealthUpdate(
    observation,
    company.last_success_at,
    company.consecutive_failures,
    seenAt,
  )
  const { error: healthError } = await admin
    .from('companies')
    .update(health)
    .eq('id', company.id)
  if (healthError) throw healthError

  let closed = 0
  // planCompanySync makes closure reachable only after complete, credible evidence.
  for (const batch of batches(plan.closeIds)) {
    const { data: closedRows, error: closeError } = await admin
      .from('jobs')
      .update({ status: 'closed', closed_at: seenAt })
      .eq('status', 'open')
      .in('id', batch)
      .select('id')
    if (closeError) throw closeError
    closed += closedRows?.length ?? 0
  }

  return { inserted, reopened, closed }
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
    const tickAt = new Date().toISOString()
    const { error: heartbeatError } = await admin
      .from('pipeline_heartbeat')
      .upsert({ id: true, last_tick_at: tickAt }, { onConflict: 'id' })
    if (heartbeatError) throw heartbeatError

    const { data, error: claimError } = await admin.rpc('claim_due_companies', {
      batch_size: 10,
    })
    if (claimError) throw claimError

    const companies = (data ?? []) as Company[]
    const settled = await Promise.allSettled(
      companies.map((company) => processCompany(admin, company)),
    )

    let succeeded = 0
    let failed = 0
    let inserted = 0
    let reopened = 0
    let closed = 0

    for (const [index, result] of settled.entries()) {
      const company = companies[index]
      if (result.status === 'fulfilled') {
        succeeded += 1
        inserted += result.value.inserted
        reopened += result.value.reopened
        closed += result.value.closed
        continue
      }

      failed += 1
      const code = diagnosticCode(result.reason)
      console.error(`poll-tick company ${company.id} failed`, code)
      const { error: failureError } = await admin
        .from('companies')
        .update({
          consecutive_failures: (company.consecutive_failures ?? 0) + 1,
          last_error: code,
        })
        .eq('id', company.id)
      if (failureError) console.error(`poll-tick health update ${company.id} failed`, failureError)
    }

    if (shouldAdvanceSuccessHeartbeat(companies.length, succeeded)) {
      const { error: successHeartbeatError } = await admin
        .from('pipeline_heartbeat')
        .update({ last_success_at: new Date().toISOString() })
        .eq('id', true)
      if (successHeartbeatError) throw successHeartbeatError
    }

    return Response.json({
      claimed: companies.length,
      succeeded,
      failed,
      inserted,
      reopened,
      closed,
    })
  } catch (error) {
    console.error('poll-tick failed', error)
    return Response.json({ error: 'Pipeline tick failed' }, { status: 500 })
  }
})

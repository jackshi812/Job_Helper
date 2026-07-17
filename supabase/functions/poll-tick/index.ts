import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.110.7'
import { pollAshby } from '../_shared/adapters/ashby.ts'
import { pollGreenhouse } from '../_shared/adapters/greenhouse.ts'
import { pollLever } from '../_shared/adapters/lever.ts'
import { type NormalizedJob } from '../_shared/adapters/types.ts'
import { fingerprint } from '../_shared/dedup.ts'

type AtsType = 'greenhouse' | 'lever' | 'ashby'

interface Company {
  id: string
  name: string
  ats_type: AtsType
  board_token: string
  region: 'eu' | null
  consecutive_failures: number
}

interface OpenJob {
  id: string
  source: string
  external_id: string
  fingerprint: string
}

interface CompanyResult {
  inserted: number
  closed: number
}

const DATABASE_BATCH_SIZE = 100

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function requiredEnvironment(name: string) {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

async function pollCompany(company: Company, knownIds: Set<string>) {
  if (company.ats_type === 'greenhouse') {
    return pollGreenhouse(company.board_token, knownIds)
  }
  if (company.ats_type === 'lever') {
    return pollLever(company.board_token, company.region ?? undefined)
  }
  return pollAshby(company.board_token)
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
  const { data: openJobs, error: openJobsError } = await admin
    .from('jobs')
    .select('id, source, external_id, fingerprint')
    .eq('company_id', company.id)
    .eq('status', 'open')
  if (openJobsError) throw openJobsError

  const existing = (openJobs ?? []) as OpenJob[]
  const knownIds = new Set(
    existing
      .filter((job) => job.source === company.ats_type)
      .map((job) => job.external_id),
  )
  const normalizedJobs = await pollCompany(company, knownIds)

  if (existing.length > 0 && normalizedJobs.length === 0) {
    throw new Error(`${company.ats_type} ${company.board_token}: implausible empty board response`)
  }

  const seenAt = new Date().toISOString()
  const exactIds = new Map(
    existing.map((job) => [`${job.source}|${job.external_id}`, job.id]),
  )
  const companyFingerprintIds = new Map(
    existing.map((job) => [job.fingerprint, job.id]),
  )
  const seenIds: string[] = []
  const newJobs: Array<{ normalized: NormalizedJob; fingerprint: string }> = []

  for (const normalized of normalizedJobs) {
    const exactId = exactIds.get(`${normalized.source}|${normalized.externalId}`)
    if (exactId) {
      seenIds.push(exactId)
      continue
    }
    newJobs.push({
      normalized,
      fingerprint: fingerprint(
        normalized.companyName ?? company.name,
        normalized.title,
        normalized.location,
      ),
    })
  }

  await updateSeenJobs(admin, seenIds, seenAt)
  const inserted = await ingestNewJobs(
    admin,
    company,
    newJobs,
    companyFingerprintIds,
    seenAt,
  )

  const { error: healthError } = await admin
    .from('companies')
    .update({
      last_success_at: seenAt,
      consecutive_failures: 0,
      last_error: null,
    })
    .eq('id', company.id)
  if (healthError) throw healthError

  let closed = 0
  // Closing is deliberately reachable only after a successful, non-empty poll.
  if (existing.length > 0 && normalizedJobs.length > 0) {
    const cutoff = new Date(Date.now() - 35 * 60_000).toISOString()
    const { data: closedRows, error: closeError } = await admin
      .from('jobs')
      .update({ status: 'closed', closed_at: seenAt })
      .eq('company_id', company.id)
      .eq('status', 'open')
      .lt('last_seen_at', cutoff)
      .select('id')
    if (closeError) throw closeError
    closed = closedRows?.length ?? 0
  }

  return { inserted, closed }
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
    let closed = 0

    for (const [index, result] of settled.entries()) {
      const company = companies[index]
      if (result.status === 'fulfilled') {
        succeeded += 1
        inserted += result.value.inserted
        closed += result.value.closed
        continue
      }

      failed += 1
      const message = errorMessage(result.reason).slice(0, 2000)
      console.error(`poll-tick company ${company.id} failed`, message)
      const { error: failureError } = await admin
        .from('companies')
        .update({
          consecutive_failures: (company.consecutive_failures ?? 0) + 1,
          last_error: message,
        })
        .eq('id', company.id)
      if (failureError) console.error(`poll-tick health update ${company.id} failed`, failureError)
    }

    if (succeeded > 0) {
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
      closed,
    })
  } catch (error) {
    console.error('poll-tick failed', error)
    return Response.json({ error: 'Pipeline tick failed' }, { status: 500 })
  }
})

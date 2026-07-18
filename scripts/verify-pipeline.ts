import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createClient } from '../web/node_modules/@supabase/supabase-js/dist/index.mjs'

const PIPELINE_REOPEN_PROBE_PREFIX = 'phase-02.1-reopen-probe-'
const PIPELINE_REOPEN_BOARD_TOKEN = 'planetscale'
const PIPELINE_REOPEN_SOURCE_KEY = 'greenhouse:global:planetscale'
const PIPELINE_REOPEN_MAX_JOBS = 25
const PIPELINE_REOPEN_DRAIN_ATTEMPTS = 20
const PIPELINE_REOPEN_OBSERVATION_ATTEMPTS = 12
const PIPELINE_REOPEN_OBSERVATION_DELAY_MS = 1_000
const PIPELINE_JOB_COLUMNS = [
  'id',
  'company_id',
  'source',
  'external_id',
  'title',
  'location',
  'absolute_url',
  'posted_at',
  'description_html',
  'description_text',
  'snapshot_partial',
  'fingerprint',
  'status',
  'first_seen_at',
  'last_seen_at',
  'closed_at',
].join(', ')

interface GreenhouseFixtureJob {
  id: number
  title: string
  absolute_url: string
  first_published?: string | null
  location?: { name?: string | null } | null
}

interface ReopenFixtureState {
  marker: string
  companyId: string | null
  jobId: string | null
  externalIds: string[]
}

const required = [
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'CRON_SECRET',
  'HEARTBEAT_SECRET',
  'USER1_EMAIL',
  'SEED_PASSWORD_1',
] as const

const seedBoards = [
  {
    label: 'Stripe',
    url: 'https://boards.greenhouse.io/stripe',
    source: 'greenhouse',
    boardToken: 'stripe',
  },
  {
    label: 'Palantir',
    url: 'https://jobs.lever.co/palantir',
    source: 'lever',
    boardToken: 'palantir',
  },
  {
    label: 'Ramp',
    url: 'https://jobs.ashbyhq.com/ramp',
    source: 'ashby',
    boardToken: 'ramp',
  },
] as const

function requiredEnvironment() {
  for (const name of required) {
    if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`)
  }
  return {
    url: process.env.SUPABASE_URL!,
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY!,
    secretKey: process.env.SUPABASE_SECRET_KEY!,
    cronSecret: process.env.CRON_SECRET!,
    heartbeatSecret: process.env.HEARTBEAT_SECRET!,
    user: {
      email: process.env.USER1_EMAIL!,
      password: process.env.SEED_PASSWORD_1!,
    },
  }
}

function client(url: string, key: string) {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
}

function assert(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${label}`)
  console.log(`PASS: ${label}`)
}

async function postTick(url: string, cronSecret?: string) {
  const response = await fetch(`${url}/functions/v1/poll-tick`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cronSecret ? { 'x-cron-secret': cronSecret } : {}),
    },
    body: '{}',
  })
  return response
}

async function postDiscoverySweep(url: string, cronSecret: string) {
  return fetch(`${url}/functions/v1/discovery-sweep`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-cron-secret': cronSecret,
    },
    body: '{}',
  })
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function normalizedProviderDate(value: string | null | undefined) {
  return value ? new Date(value).toISOString() : null
}

async function fetchReopenFixtureJobs() {
  const response = await fetch(
    `https://boards-api.greenhouse.io/v1/boards/${PIPELINE_REOPEN_BOARD_TOKEN}/jobs`,
  )
  if (!response.ok) throw new Error(`PlanetScale fixture board returned HTTP ${response.status}`)
  const payload = await response.json() as { jobs?: GreenhouseFixtureJob[] }
  if (!Array.isArray(payload.jobs)) throw new Error('PlanetScale fixture board schema drifted')
  if (payload.jobs.length === 0 || payload.jobs.length > PIPELINE_REOPEN_MAX_JOBS) {
    throw new Error(
      `PlanetScale fixture board must contain 1-${PIPELINE_REOPEN_MAX_JOBS} jobs; received ${payload.jobs.length}`,
    )
  }
  const externalIds = payload.jobs.map((job) => String(job.id))
  if (new Set(externalIds).size !== externalIds.length) {
    throw new Error('PlanetScale fixture board returned duplicate job IDs')
  }
  return { jobs: payload.jobs, externalIds }
}

async function assertReopenFixtureAvailable(
  admin: ReturnType<typeof client>,
  externalIds: string[],
) {
  const [sourceKey, identity, jobs] = await Promise.all([
    admin.from('companies').select('id').eq('source_key', PIPELINE_REOPEN_SOURCE_KEY),
    admin.from('companies').select('id')
      .eq('ats_type', 'greenhouse')
      .eq('board_token', PIPELINE_REOPEN_BOARD_TOKEN),
    admin.from('jobs').select('id').eq('source', 'greenhouse').in('external_id', externalIds),
  ])
  if (sourceKey.error) throw sourceKey.error
  if (identity.error) throw identity.error
  if (jobs.error) throw jobs.error
  if ((sourceKey.data?.length ?? 0) > 0 || (identity.data?.length ?? 0) > 0) {
    throw new Error('PlanetScale fixture company identity already exists; refusing writes')
  }
  if ((jobs.data?.length ?? 0) > 0) {
    throw new Error('PlanetScale fixture job ID collides with a pre-existing row; refusing writes')
  }
}

async function drainDueCompanies(
  url: string,
  cronSecret: string,
) {
  for (let attempt = 0; attempt < PIPELINE_REOPEN_DRAIN_ATTEMPTS; attempt += 1) {
    const response = await postTick(url, cronSecret)
    if (!response.ok) throw new Error(`pre-fixture poll-tick returned HTTP ${response.status}`)
    const body = await response.json() as { claimed?: number }
    if (body.claimed === 0) return
  }
  throw new Error('Active company drain exceeded its bounded attempt budget')
}

async function snapshotRealJobs(admin: ReturnType<typeof client>) {
  const { data, error } = await admin
    .from('jobs')
    .select(PIPELINE_JOB_COLUMNS)
    .order('id', { ascending: true })
  if (error) throw error
  return data ?? []
}

async function assertRealJobsUnchanged(
  admin: ReturnType<typeof client>,
  baseline: Awaited<ReturnType<typeof snapshotRealJobs>>,
) {
  const current = await snapshotRealJobs(admin)
  assert(
    JSON.stringify(current) === JSON.stringify(baseline),
    'probe 15: every pre-existing job matches the post-drain baseline',
  )
}

async function cleanupReopenFixture(
  admin: ReturnType<typeof client>,
  fixture: ReopenFixtureState,
) {
  if (fixture.companyId) {
    const { error: jobError } = await admin.from('jobs').delete()
      .eq('company_id', fixture.companyId)
      .eq('source', 'greenhouse')
      .in('external_id', fixture.externalIds)
    if (jobError) throw jobError
    const { error: companyError } = await admin.from('companies').delete()
      .eq('id', fixture.companyId)
      .eq('source_key', PIPELINE_REOPEN_SOURCE_KEY)
      .eq('name', fixture.marker)
    if (companyError) throw companyError
  }
}

async function assertReopenFixtureRemoved(
  admin: ReturnType<typeof client>,
  fixture: ReopenFixtureState,
) {
  const [markerCompanies, sourceCompanies, returnedJobs] = await Promise.all([
    admin.from('companies').select('*', { count: 'exact', head: true }).eq('name', fixture.marker),
    admin.from('companies').select('*', { count: 'exact', head: true })
      .eq('source_key', PIPELINE_REOPEN_SOURCE_KEY),
    admin.from('jobs').select('*', { count: 'exact', head: true })
      .eq('source', 'greenhouse')
      .in('external_id', fixture.externalIds),
  ])
  if (markerCompanies.error) throw markerCompanies.error
  if (sourceCompanies.error) throw sourceCompanies.error
  if (returnedJobs.error) throw returnedJobs.error
  assert(
    (markerCompanies.count ?? 0) === 0 &&
      (sourceCompanies.count ?? 0) === 0 &&
      (returnedJobs.count ?? 0) === 0,
    'probe 15: no marked company or returned-ID fixture row remains',
  )
}

function immutableFixtureSnapshot(row: Record<string, unknown>) {
  const { status: _status, closed_at: _closedAt, last_seen_at: _lastSeenAt, ...immutable } = row
  return immutable
}

async function runReopenFixtureProbe(
  admin: ReturnType<typeof client>,
  url: string,
  cronSecret: string,
) {
  const fixtureBoard = await fetchReopenFixtureJobs()
  await assertReopenFixtureAvailable(admin, fixtureBoard.externalIds)
  await drainDueCompanies(url, cronSecret)
  const realJobBaseline = await snapshotRealJobs(admin)
  const marker = `${PIPELINE_REOPEN_PROBE_PREFIX}${Date.now()}-${randomUUID()}`
  const fixture: ReopenFixtureState = {
    marker,
    companyId: null,
    jobId: null,
    externalIds: fixtureBoard.externalIds,
  }

  try {
    const { data: company, error: companyError } = await admin.from('companies').insert({
      name: marker,
      ats_type: 'greenhouse',
      board_token: PIPELINE_REOPEN_BOARD_TOKEN,
      region: null,
      careers_url: 'https://job-boards.greenhouse.io/planetscale',
      source_key: PIPELINE_REOPEN_SOURCE_KEY,
      activation_state: 'active',
      last_polled_at: null,
      last_success_at: null,
    }).select('id').single()
    if (companyError) throw companyError
    fixture.companyId = company.id

    const providerJob = fixtureBoard.jobs[0]
    const firstSeenAt = new Date(Date.now() - 60 * 60_000).toISOString()
    const closedAt = new Date(Date.now() - 40 * 60_000).toISOString()
    const { data: job, error: jobError } = await admin.from('jobs').insert({
      company_id: fixture.companyId,
      source: 'greenhouse',
      external_id: String(providerJob.id),
      title: providerJob.title.trim(),
      location: providerJob.location?.name?.trim() || null,
      absolute_url: providerJob.absolute_url,
      posted_at: normalizedProviderDate(providerJob.first_published),
      description_html: null,
      description_text: null,
      snapshot_partial: false,
      fingerprint: `${PIPELINE_REOPEN_PROBE_PREFIX}${randomUUID()}`,
      status: 'closed',
      first_seen_at: firstSeenAt,
      last_seen_at: firstSeenAt,
      closed_at: closedAt,
    }).select(PIPELINE_JOB_COLUMNS).single()
    if (jobError) throw jobError
    fixture.jobId = job.id
    const immutableBefore = immutableFixtureSnapshot(job as Record<string, unknown>)
    const lastSeenBefore = new Date(job.last_seen_at).getTime()

    const reopenResponse = await postTick(url, cronSecret)
    if (!reopenResponse.ok) {
      throw new Error(`reopen fixture poll-tick returned HTTP ${reopenResponse.status}`)
    }

    let reopenedJob: Record<string, unknown> | null = null
    for (let attempt = 0; attempt < PIPELINE_REOPEN_OBSERVATION_ATTEMPTS; attempt += 1) {
      const { data: observed, error: observedError } = await admin.from('jobs')
        .select(PIPELINE_JOB_COLUMNS)
        .eq('id', fixture.jobId)
        .single()
      if (observedError) throw observedError
      if (
        observed.status === 'open' &&
        observed.closed_at === null &&
        new Date(observed.last_seen_at).getTime() > lastSeenBefore
      ) {
        reopenedJob = observed as Record<string, unknown>
        break
      }
      await sleep(PIPELINE_REOPEN_OBSERVATION_DELAY_MS)
    }
    assert(Boolean(reopenedJob), 'probe 15: deployed poll-tick reopens the owned exact-ID fixture')
    assert(
      JSON.stringify(immutableFixtureSnapshot(reopenedJob!)) === JSON.stringify(immutableBefore),
      'probe 15: reopen preserves every immutable first-sight field',
    )
  } finally {
    await cleanupReopenFixture(admin, fixture)
    await assertReopenFixtureRemoved(admin, fixture)
    await assertRealJobsUnchanged(admin, realJobBaseline)
  }
}

async function ensureSeeds(
  admin: ReturnType<typeof client>,
  userClient: ReturnType<typeof client>,
) {
  for (const board of seedBoards) {
    const { data: existing, error: lookupError } = await admin
      .from('companies')
      .select('id')
      .eq('ats_type', board.source)
      .eq('board_token', board.boardToken)
      .maybeSingle()
    if (lookupError) throw lookupError
    if (existing) continue

    const { data: rawVerified, error: verifyError } = await userClient.functions.invoke('verify-board', {
      body: { url: board.url },
    })
    const verified = rawVerified as null | {
      ok?: boolean
      company?: { id?: string }
    }
    if (verifyError || !verified?.ok || !verified.company?.id) {
      throw verifyError ?? new Error(`${board.label} board verification failed`)
    }

    const { data: persisted, error: persistedError } = await admin
      .from('companies')
      .select('id, ats_type, board_token')
      .eq('id', verified.company.id)
      .single()
    if (
      persistedError ||
      persisted?.ats_type !== board.source ||
      persisted?.board_token !== board.boardToken
    ) {
      throw persistedError ?? new Error(`${board.label} persisted seed identity drifted`)
    }
  }
}

export async function runPipelineVerification() {
  const environment = requiredEnvironment()
  const admin = client(environment.url, environment.secretKey)
  const userClient = client(environment.url, environment.publishableKey)
  const { data: auth, error: authError } = await userClient.auth.signInWithPassword(environment.user)
  if (authError || !auth.user) throw authError ?? new Error('Verification user authentication failed')

  let unexpectedProbeId: string | undefined
  try {
    await ensureSeeds(admin, userClient)
    const { data: companyRows, error: companiesError } = await admin
      .from('companies')
      .select('id, name, ats_type, board_token, last_polled_at, last_success_at, consecutive_failures')
      .in('board_token', seedBoards.map((board) => board.boardToken))
    if (companiesError) throw companiesError
    const companies = (companyRows ?? []).filter((company) =>
      seedBoards.some(
        (board) => board.source === company.ats_type && board.boardToken === company.board_token,
      ),
    )
    assert(
      seedBoards.every((board) =>
        companies.some(
          (company) =>
            company.ats_type === board.source && company.board_token === board.boardToken,
        ),
      ),
      'probe 1: Stripe, Palantir, and Ramp seed companies exist',
    )

    const seedIds = companies.map((company) => company.id)
    const { count: seedJobCountBefore, error: seedJobCountBeforeError } = await admin
      .from('jobs')
      .select('*', { count: 'exact', head: true })
      .in('company_id', seedIds)
    if (seedJobCountBeforeError) throw seedJobCountBeforeError
    if (seedIds.length !== seedBoards.length) {
      throw new Error('Seed identity snapshot is incomplete; refusing destructive probes')
    }
    await admin.from('companies').update({ last_polled_at: null }).in('id', seedIds)
    let polledCompanies: typeof companies = []
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await postTick(environment.url, environment.cronSecret)
      if (!response.ok) throw new Error(`poll-tick returned HTTP ${response.status}`)
      const { data: refreshed, error: refreshError } = await admin
        .from('companies')
        .select('id, name, ats_type, board_token, last_polled_at, last_success_at, consecutive_failures')
        .in('id', seedIds)
      if (refreshError) throw refreshError
      polledCompanies = refreshed
      if (refreshed.every((company) => company.last_polled_at)) break
    }
    assert(
      polledCompanies.length === seedIds.length && polledCompanies.every((company) => company.last_polled_at),
      'probe 2: poll-tick claimed and polled all three seeded companies',
    )

    const { data: jobs, error: jobsError } = await admin
      .from('jobs')
      .select('source, description_html, description_text, fingerprint, snapshot_partial, status')
      .in('company_id', seedIds)
      .eq('status', 'open')
    if (jobsError) throw jobsError
    assert(
      seedBoards.every((board) => jobs?.some((job) => job.source === board.source)) &&
        jobs?.every((job) =>
          Boolean(job.description_html && job.description_text && job.fingerprint) &&
          job.snapshot_partial === false && job.status === 'open'),
      'probe 3: all ATS sources have open jobs with complete first-sight snapshots',
    )

    const forcedCompany = polledCompanies[0]
    const { data: jobsBefore, error: beforeError } = await admin
      .from('jobs')
      .select('source, external_id')
      .eq('company_id', forcedCompany.id)
      .order('source', { ascending: true })
      .order('external_id', { ascending: true })
    if (beforeError) throw beforeError
    const identitiesBefore = (jobsBefore ?? []).map(
      (job) => `${job.source}|${job.external_id}`,
    )
    const { error: forceError } = await admin
      .from('companies')
      .update({ last_polled_at: null })
      .eq('id', forcedCompany.id)
    if (forceError) throw forceError
    const repeat = await postTick(environment.url, environment.cronSecret)
    if (!repeat.ok) throw new Error(`repeat poll-tick returned HTTP ${repeat.status}`)
    const { data: jobsAfter, error: afterError } = await admin
      .from('jobs')
      .select('source, external_id')
      .eq('company_id', forcedCompany.id)
      .order('source', { ascending: true })
      .order('external_id', { ascending: true })
    if (afterError) throw afterError
    const identitiesAfter = (jobsAfter ?? []).map(
      (job) => `${job.source}|${job.external_id}`,
    )
    assert(
      identitiesBefore.length > 0 &&
        identitiesAfter.length === new Set(identitiesAfter).size &&
        JSON.stringify(identitiesBefore) === JSON.stringify(identitiesAfter),
      'probe 4: repeated polling preserves exactly one row per forced-company job identity',
    )

    const { data: heartbeat, error: heartbeatError } = await admin
      .from('pipeline_heartbeat')
      .select('last_tick_at, last_success_at')
      .eq('id', true)
      .single()
    if (heartbeatError) throw heartbeatError
    const freshnessCutoff = Date.now() - 5 * 60_000
    assert(
      new Date(heartbeat.last_tick_at).getTime() >= freshnessCutoff &&
        new Date(heartbeat.last_success_at).getTime() >= freshnessCutoff,
      'probe 5: pipeline tick and success heartbeat timestamps are fresh',
    )

    const { data: health, error: healthError } = await admin
      .from('companies')
      .select('last_success_at, consecutive_failures')
      .in('id', seedIds)
    if (healthError) throw healthError
    assert(
      health?.length === seedIds.length &&
        health.every((company) => company.last_success_at && company.consecutive_failures === 0),
      'probe 6: all seeded companies report successful healthy polls',
    )

    const [missingSecret, wrongSecret] = await Promise.all([
      postTick(environment.url),
      postTick(environment.url, 'definitely-wrong-secret'),
    ])
    assert(
      missingSecret.status === 401 && wrongSecret.status === 401,
      'probe 7: missing or incorrect cron secret is rejected with HTTP 401',
    )

    const externalId = `rls-probe-${Date.now()}`
    const { data: forbiddenRows, error: forbiddenError } = await userClient
      .from('jobs')
      .insert({
        source: 'greenhouse',
        external_id: externalId,
        title: 'RLS probe',
        absolute_url: 'https://example.invalid/rls-probe',
        fingerprint: externalId,
      })
      .select('id')
    unexpectedProbeId = forbiddenRows?.[0]?.id
    assert(
      Boolean(forbiddenError) || forbiddenRows?.length === 0,
      'probe 8: authenticated publishable-key client cannot insert jobs',
    )

    const { data: heartbeatBeforeProbe, error: heartbeatBeforeProbeError } = await admin
      .from('pipeline_heartbeat')
      .select('last_tick_at, last_success_at, adzuna_requests_today, adzuna_budget_date')
      .eq('id', true)
      .single()
    if (heartbeatBeforeProbeError) throw heartbeatBeforeProbeError

    const heartbeatFresh = Boolean(
      heartbeatBeforeProbe.last_success_at &&
        Date.now() - new Date(heartbeatBeforeProbe.last_success_at).getTime() < 30 * 60_000,
    )
    const [heartbeatWithoutSecret, heartbeatWithSecret] = await Promise.all([
      fetch(`${environment.url}/functions/v1/heartbeat`),
      fetch(
        `${environment.url}/functions/v1/heartbeat?k=${encodeURIComponent(environment.heartbeatSecret)}`,
      ),
    ])
    assert(
      heartbeatWithoutSecret.status === 401 &&
        heartbeatWithSecret.status === (heartbeatFresh ? 200 : 503),
      'probe 9: heartbeat is secret-gated and matches pipeline freshness',
    )

    const discoveryResponse = await postDiscoverySweep(environment.url, environment.cronSecret)
    const discoveryBody = await discoveryResponse.json() as {
      skipped?: string
      requestsToday?: number
      inserted?: number
      refreshed?: number
      duplicates?: number
      failedQueries?: number
    }
    const today = new Date().toISOString().slice(0, 10)
    const requestsBefore = heartbeatBeforeProbe.adzuna_budget_date === today
      ? heartbeatBeforeProbe.adzuna_requests_today
      : 0
    const discoveredRows =
      (discoveryBody.inserted ?? 0) +
      (discoveryBody.refreshed ?? 0) +
      (discoveryBody.duplicates ?? 0)
    assert(
      discoveryResponse.status === 200 &&
        !discoveryBody.skipped &&
        discoveryBody.failedQueries === 0 &&
        (discoveryBody.requestsToday ?? 0) > requestsBefore,
      'probe 10: credentialed discovery sweep spends budget and completes every seed query',
    )
    console.log(
      discoveredRows > 0
        ? `PASS: probe 10 detail: ${discoveredRows} fresh result(s) were inserted, refreshed, or deduplicated`
        : 'PASS: probe 10 detail: seed queries legitimately returned zero fresh results',
    )

    const { data: openJobs, error: openJobsError } = await admin
      .from('jobs')
      .select('source, fingerprint, snapshot_partial')
      .eq('status', 'open')
    if (openJobsError) throw openJobsError
    const openAdzunaJobs = (openJobs ?? []).filter((job) => job.source === 'adzuna')
    assert(
      discoveredRows === 0 ||
        (openAdzunaJobs.length > 0 && openAdzunaJobs.every((job) => job.snapshot_partial === true)),
      'probe 10: returned Adzuna results persist only as partial snapshots',
    )
    const nonAdzunaFingerprints = new Set(
      (openJobs ?? [])
        .filter((job) => job.source !== 'adzuna')
        .map((job) => job.fingerprint),
    )
    assert(
      openAdzunaJobs.every((job) => !nonAdzunaFingerprints.has(job.fingerprint)),
      'probe 11: no open Adzuna job duplicates an open non-Adzuna fingerprint',
    )

    const cronBaseline = new Date(heartbeatBeforeProbe.last_tick_at).getTime()
    let cronAdvancedAt = cronBaseline
    const cronDeadline = Date.now() + 100_000
    while (Date.now() < cronDeadline && cronAdvancedAt <= cronBaseline) {
      await sleep(5_000)
      const { data: cronHeartbeat, error: cronHeartbeatError } = await admin
        .from('pipeline_heartbeat')
        .select('last_tick_at')
        .eq('id', true)
        .single()
      if (cronHeartbeatError) throw cronHeartbeatError
      cronAdvancedAt = new Date(cronHeartbeat.last_tick_at).getTime()
    }
    assert(
      cronAdvancedAt > cronBaseline && cronAdvancedAt >= Date.now() - 3 * 60_000,
      'probe 12: pg_cron advances pipeline heartbeat without a manual tick during the probe window',
    )

    const { error: resetClaimsError } = await admin
      .from('companies')
      .update({ last_polled_at: null })
      .in('id', seedIds)
    if (resetClaimsError) throw resetClaimsError
    const { data: claimBaselineRows, error: claimBaselineError } = await admin
      .from('companies')
      .select('id, last_polled_at')
    if (claimBaselineError) throw claimBaselineError
    const claimBaseline = new Map(
      (claimBaselineRows ?? []).map((row) => [row.id, row.last_polled_at]),
    )
    const concurrentClaims = await Promise.all(
      Array.from({ length: 4 }, () =>
        admin.rpc('claim_due_companies', { batch_size: 2 }),
      ),
    )
    const claimedIdBatches = concurrentClaims.map(({ data, error }) => {
      if (error) throw error
      return (data ?? []).map((company: { id: string }) => company.id)
    })
    const allClaimedIds = claimedIdBatches.flat()
    const uniqueClaimedIds = new Set(allClaimedIds)
    assert(
      uniqueClaimedIds.size === allClaimedIds.length,
      'probe 13: concurrent claim_due_companies calls return disjoint company batches',
    )
    for (const result of concurrentClaims) {
      for (const row of result.data ?? []) {
        const previous = claimBaseline.get(row.id)
        if (previous === undefined) continue
        const { error: restoreClaimError } = await admin
          .from('companies')
          .update({ last_polled_at: previous })
          .eq('id', row.id)
          .eq('last_polled_at', row.last_polled_at)
        if (restoreClaimError) throw restoreClaimError
      }
    }

    const now = new Date().toISOString()
    const { data: activeRows, error: activeRowsError } = await admin
      .from('companies')
      .select('id, last_polled_at')
      .eq('activation_state', 'active')
    if (activeRowsError) throw activeRowsError
    const activeIds = (activeRows ?? []).map((row) => row.id)
    const { data: noWorkBaseline, error: noWorkBaselineError } = await admin
      .from('pipeline_heartbeat')
      .select('last_success_at')
      .eq('id', true)
      .single()
    if (noWorkBaselineError) throw noWorkBaselineError
    try {
      const { error: makeAllCurrentError } = await admin
        .from('companies')
        .update({ last_polled_at: now })
        .in('id', activeIds)
      if (makeAllCurrentError) throw makeAllCurrentError
      const noWorkResponse = await postTick(environment.url, environment.cronSecret)
      const noWorkBody = await noWorkResponse.json() as { claimed?: number }
      const { data: noWorkAfter, error: noWorkAfterError } = await admin
        .from('pipeline_heartbeat')
        .select('last_success_at')
        .eq('id', true)
        .single()
      if (noWorkAfterError) throw noWorkAfterError
      const noWorkBaselineMs = noWorkBaseline.last_success_at
        ? new Date(noWorkBaseline.last_success_at).getTime()
        : null
      const noWorkAfterMs = noWorkAfter.last_success_at
        ? new Date(noWorkAfter.last_success_at).getTime()
        : null
      assert(
        noWorkResponse.ok &&
          noWorkBody.claimed === 0 &&
          noWorkAfterMs !== null &&
          (noWorkBaselineMs === null || noWorkAfterMs > noWorkBaselineMs),
        'probe 14: a successful no-work tick advances last_success_at',
      )
    } finally {
      for (const row of activeRows ?? []) {
        const { error: restoreCurrentError } = await admin
          .from('companies')
          .update({ last_polled_at: row.last_polled_at })
          .eq('id', row.id)
          .eq('last_polled_at', now)
        if (restoreCurrentError) throw restoreCurrentError
      }
    }

    await runReopenFixtureProbe(admin, environment.url, environment.cronSecret)

    const discoveryHealthResponse = await postDiscoverySweep(
      environment.url,
      environment.cronSecret,
    )
    const discoveryHealthBody = await discoveryHealthResponse.json() as {
      skipped?: string
      discoveryStatus?: 'ok' | 'degraded' | 'failed'
    }
    const discoverySkipped = discoveryHealthBody.skipped === 'budget' ||
      discoveryHealthBody.skipped === 'missing adzuna credentials'
    const validDiscoveryStatus = discoveryHealthBody.discoveryStatus === 'ok' ||
      discoveryHealthBody.discoveryStatus === 'degraded' ||
      discoveryHealthBody.discoveryStatus === 'failed'
    let discoveryHeartbeatPersisted = true
    if (!discoverySkipped) {
      const { data: discoveryHeartbeat, error: discoveryHeartbeatError } = await admin
        .from('pipeline_heartbeat')
        .select('last_discovery_at, discovery_status')
        .eq('id', true)
        .single()
      if (discoveryHeartbeatError) throw discoveryHeartbeatError
      discoveryHeartbeatPersisted = Boolean(
        discoveryHeartbeat.last_discovery_at &&
          discoveryHeartbeat.discovery_status === discoveryHealthBody.discoveryStatus,
      )
    }
    assert(
      (discoverySkipped || validDiscoveryStatus) && discoveryHeartbeatPersisted,
      'probe 16: discovery sweep surfaces health state in its response and heartbeat row',
    )

    const { data: seedIdentityAfter, error: seedIdentityAfterError } = await admin
      .from('companies')
      .select('id, ats_type, board_token')
      .in('id', seedIds)
    if (seedIdentityAfterError) throw seedIdentityAfterError
    const { count: seedJobCountAfter, error: seedJobCountAfterError } = await admin
      .from('jobs')
      .select('*', { count: 'exact', head: true })
      .in('company_id', seedIds)
    if (seedJobCountAfterError) throw seedJobCountAfterError
    assert(
      seedIdentityAfter?.length === seedIds.length &&
        seedBoards.every((board) => seedIdentityAfter.some((row) =>
          row.ats_type === board.source && row.board_token === board.boardToken
        )) &&
        (seedJobCountAfter ?? 0) >= (seedJobCountBefore ?? 0),
      'probe 17: seed identities and linked job count survive every pipeline probe',
    )
  } finally {
    if (unexpectedProbeId) await admin.from('jobs').delete().eq('id', unexpectedProbeId)
    await userClient.auth.signOut()
  }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  try {
    await runPipelineVerification()
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Pipeline verification failed')
    process.exitCode = 1
  }
}

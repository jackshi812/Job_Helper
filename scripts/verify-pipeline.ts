import { pathToFileURL } from 'node:url'
import { createClient } from '../web/node_modules/@supabase/supabase-js/dist/index.mjs'

const required = [
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'CRON_SECRET',
  'USER1_EMAIL',
  'SEED_PASSWORD_1',
] as const

const seedBoards = [
  { label: 'Stripe', url: 'https://boards.greenhouse.io/stripe', source: 'greenhouse' },
  { label: 'Palantir', url: 'https://jobs.lever.co/palantir', source: 'lever' },
  { label: 'Ramp', url: 'https://jobs.ashbyhq.com/ramp', source: 'ashby' },
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

async function ensureSeeds(
  admin: ReturnType<typeof createClient>,
  userClient: ReturnType<typeof createClient>,
) {
  for (const board of seedBoards) {
    const { data: existing, error: lookupError } = await admin
      .from('companies')
      .select('id')
      .eq('ats_type', board.source)
      .maybeSingle()
    if (lookupError) throw lookupError
    if (existing) continue

    const { data: verified, error: verifyError } = await userClient.functions.invoke('verify-board', {
      body: { url: board.url },
    })
    if (verifyError || !verified?.ok) {
      throw verifyError ?? new Error(`${board.label} board verification failed`)
    }
    const { error: insertError } = await userClient.from('companies').insert({
      name: verified.company_name,
      ats_type: verified.ats,
      board_token: verified.board_token,
      region: verified.region,
    })
    if (insertError) throw insertError
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
    const { data: companies, error: companiesError } = await admin
      .from('companies')
      .select('id, name, ats_type, last_polled_at, last_success_at, consecutive_failures')
      .in('ats_type', seedBoards.map((board) => board.source))
    if (companiesError) throw companiesError
    assert(
      seedBoards.every((board) => companies?.some((company) => company.ats_type === board.source)),
      'probe 1: Stripe, Palantir, and Ramp seed companies exist',
    )

    const seedIds = companies!.map((company) => company.id)
    await admin.from('companies').update({ last_polled_at: null }).in('id', seedIds)
    let polledCompanies: typeof companies = []
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await postTick(environment.url, environment.cronSecret)
      if (!response.ok) throw new Error(`poll-tick returned HTTP ${response.status}`)
      const { data: refreshed, error: refreshError } = await admin
        .from('companies')
        .select('id, name, ats_type, last_polled_at, last_success_at, consecutive_failures')
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

    const { count: countBefore, error: beforeError } = await admin
      .from('jobs')
      .select('*', { count: 'exact', head: true })
    if (beforeError) throw beforeError
    const forcedCompany = polledCompanies[0]
    const { error: forceError } = await admin
      .from('companies')
      .update({ last_polled_at: null })
      .eq('id', forcedCompany.id)
    if (forceError) throw forceError
    const repeat = await postTick(environment.url, environment.cronSecret)
    if (!repeat.ok) throw new Error(`repeat poll-tick returned HTTP ${repeat.status}`)
    const { count: countAfter, error: afterError } = await admin
      .from('jobs')
      .select('*', { count: 'exact', head: true })
    if (afterError) throw afterError
    assert(countBefore === countAfter, 'probe 4: repeated polling does not duplicate jobs')

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
  } finally {
    if (unexpectedProbeId) await admin.from('jobs').delete().eq('id', unexpectedProbeId)
    await userClient.auth.signOut()
  }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  runPipelineVerification().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Pipeline verification failed')
    process.exitCode = 1
  })
}

import { pathToFileURL } from 'node:url'
import { createClient } from '../web/node_modules/@supabase/supabase-js/dist/index.mjs'

const required = [
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'USER1_EMAIL',
  'USER2_EMAIL',
  'SEED_PASSWORD_1',
  'SEED_PASSWORD_2',
] as const

type VerifyBoardResponse =
  | {
      ok: true
      company: {
        id: string
        ats_type: 'greenhouse' | 'lever' | 'ashby'
        board_token: string
        region: 'eu' | null
        name: string
      }
      already_watched: boolean
    }
  | {
      ok: false
      reason: 'unsupported' | 'not_found' | 'already_watched' | 'error'
      message: string
    }

type PersistedSeed = Extract<VerifyBoardResponse, { ok: true }>['company']

const seedBoards = [
  { label: 'Stripe', url: 'https://boards.greenhouse.io/stripe' },
  { label: 'Palantir', url: 'https://jobs.lever.co/palantir' },
  { label: 'Ramp', url: 'https://jobs.ashbyhq.com/ramp' },
] as const

const seedIdentities = [
  { ats_type: 'greenhouse', board_token: 'stripe' },
  { ats_type: 'lever', board_token: 'palantir' },
  { ats_type: 'ashby', board_token: 'ramp' },
] as const

const sanitizedFetch: typeof fetch = async (input, init) => {
  try {
    return await globalThis.fetch(input, init)
  } catch {
    throw new Error('Supabase network request failed')
  }
}

function requiredEnvironment() {
  for (const name of required) {
    if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`)
  }

  return {
    url: process.env.SUPABASE_URL!,
    key: process.env.SUPABASE_PUBLISHABLE_KEY!,
    secretKey: process.env.SUPABASE_SECRET_KEY!,
    user1: { email: process.env.USER1_EMAIL!, password: process.env.SEED_PASSWORD_1! },
    user2: { email: process.env.USER2_EMAIL!, password: process.env.SEED_PASSWORD_2! },
  }
}

function createProbeClient(url: string, key: string) {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: sanitizedFetch },
  })
}

async function verifyBoard(
  client: ReturnType<typeof createProbeClient>,
  url: string,
): Promise<VerifyBoardResponse> {
  const { data, error } = await client.functions.invoke<VerifyBoardResponse>('verify-board', {
    body: { url },
  })
  if (error) {
    const context = (error as { context?: Response }).context
    if (context) {
      try {
        const body = await context.clone().json() as VerifyBoardResponse
        if (body && typeof body === 'object' && 'ok' in body) return body
      } catch { /* preserve the original invocation error */ }
    }
    throw error
  }
  if (!data) throw new Error(`verify-board returned no data for ${url}`)
  return data
}

async function verifyAndLoadSeed(
  client: ReturnType<typeof createProbeClient>,
  board: typeof seedBoards[number],
) {
  const verified = await verifyBoard(client, board.url)
  if (verified.ok) return verified.company
  if (verified.reason !== 'already_watched') {
    throw new Error(`${board.label} could not be verified for seeding`)
  }
  const identity = seedIdentities.find((seed) => seed.board_token === board.url.split('/').at(-1))
  if (!identity) throw new Error(`${board.label} seed identity is not declared`)
  const { data, error } = await client
    .from('companies')
    .select('id, ats_type, board_token, region, name')
    .eq('ats_type', identity.ats_type)
    .eq('board_token', identity.board_token)
    .single()
  if (error || !data) throw error ?? new Error(`${board.label} persisted seed was not found`)
  return data as PersistedSeed
}

export async function runWatchlistVerification() {
  const environment = requiredEnvironment()
  const clientA = createProbeClient(environment.url, environment.key)
  const clientB = createProbeClient(environment.url, environment.key)
  const anonClient = createProbeClient(environment.url, environment.key)
  // This client is deliberately confined to an invocation-unique disposable
  // company. Real seed creation/recreation always crosses verify-board as a
  // signed-in user after migration 0012 revokes browser company writes.
  const disposableAdmin = createProbeClient(environment.url, environment.secretKey)
  const failures: string[] = []
  let disposableProbeId: string | undefined
  const disposablePrefix = 'phase-02.1-watchlist-probe-'

  function probe(condition: boolean, label: string) {
    if (condition) {
      console.log(`PASS: ${label}`)
      return
    }
    console.error(`FAIL: ${label}`)
    failures.push(label)
  }

  try {
    const [{ data: authA, error: authErrorA }, { data: authB, error: authErrorB }] =
      await Promise.all([
        clientA.auth.signInWithPassword(environment.user1),
        clientB.auth.signInWithPassword(environment.user2),
      ])

    if (authErrorA || !authA.user) throw new Error('User A authentication failed')
    if (authErrorB || !authB.user) throw new Error('User B authentication failed')
    console.log('PASS: both independent publishable-key clients authenticated')

    const { data: seedBaselineRows, error: seedBaselineError } = await clientA
      .from('companies')
      .select('id, ats_type, board_token')
      .in('board_token', seedIdentities.map((seed) => seed.board_token))
    if (seedBaselineError) throw seedBaselineError
    const seedBaseline = (seedBaselineRows ?? []).filter((company) =>
      seedIdentities.some(
        (seed) => seed.ats_type === company.ats_type && seed.board_token === company.board_token,
      ),
    )
    const seedCompanyIds = seedBaseline.map((company) => company.id)
    let jobsBefore = 0
    if (seedCompanyIds.length > 0) {
      const { count, error: jobsBeforeError } = await clientA
        .from('jobs')
        .select('*', { count: 'exact', head: true })
        .in('company_id', seedCompanyIds)
      if (jobsBeforeError) throw jobsBeforeError
      jobsBefore = count ?? 0
    }

    const unsupported = await verifyBoard(clientA, 'https://example.com/careers')
    probe(
      !unsupported.ok && unsupported.reason === 'unsupported',
      "probe 1: unsupported URL returns reason 'unsupported'",
    )

    const missing = await verifyBoard(
      clientA,
      'https://boards.greenhouse.io/definitely-not-a-real-board-xyz',
    )
    probe(
      !missing.ok && (missing.reason === 'not_found' || missing.reason === 'error'),
      'probe 2: nonexistent board is rejected without creating a company',
    )

    const stripe = await verifyAndLoadSeed(clientA, seedBoards[0])
    probe(
      stripe.ats_type === 'greenhouse' && stripe.board_token === 'stripe',
      'probe 3: Stripe verifies as a Greenhouse board',
    )

    const probeMarker = `${disposablePrefix}${Date.now()}-${crypto.randomUUID()}`
    const { data: insertedProbe, error: insertProbeError } = await disposableAdmin
      .from('companies')
      .insert({
        name: probeMarker,
        ats_type: 'greenhouse',
        board_token: probeMarker,
        region: null,
        careers_url: `https://job-boards.greenhouse.io/${probeMarker}`,
        source_key: `greenhouse:global:${probeMarker}`,
        activation_state: 'active',
        last_polled_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (insertProbeError || !insertedProbe) {
      throw insertProbeError ?? new Error('Unable to insert disposable shared probe row')
    }
    disposableProbeId = insertedProbe.id

    const { data: visibleToB, error: visibleError } = await clientB
      .from('companies')
      .select('id')
      .eq('id', disposableProbeId)
      .single()
    probe(
      !visibleError && visibleToB?.id === disposableProbeId,
      'probe 4a: User B can read the company saved by User A',
    )

    const { data: deletedByB, error: deleteError } = await clientB
      .from('companies')
      .delete()
      .eq('id', disposableProbeId)
      .select('id')
    probe(
      !deleteError && deletedByB?.length === 1,
      'probe 4b: User B can remove the company saved by User A',
    )
    if (!deleteError && deletedByB?.length === 1) disposableProbeId = undefined

    const { data: anonRows, error: anonError } = await anonClient.from('companies').select('id')
    probe(
      Boolean(anonError) || anonRows?.length === 0,
      'probe 5: anonymous client cannot read companies',
    )

    const { data: seedAfterRows, error: seedAfterError } = await clientA
      .from('companies')
      .select('id, ats_type, board_token')
      .in('board_token', seedIdentities.map((seed) => seed.board_token))
    if (seedAfterError) throw seedAfterError
    const seedIdsUnchanged = seedBaseline.every((before) =>
      seedAfterRows?.some(
        (after) =>
          after.id === before.id &&
          after.ats_type === before.ats_type &&
          after.board_token === before.board_token,
      ),
    )
    let jobsAfter = 0
    if (seedCompanyIds.length > 0) {
      const { count, error: jobsAfterError } = await clientA
        .from('jobs')
        .select('*', { count: 'exact', head: true })
        .in('company_id', seedCompanyIds)
      if (jobsAfterError) throw jobsAfterError
      jobsAfter = count ?? 0
    }
    probe(
      seedIdsUnchanged && jobsAfter >= jobsBefore,
      'probe 6: seed companies and their job links are unchanged by verification',
    )
  } finally {
    if (disposableProbeId) {
      const { error } = await disposableAdmin
        .from('companies')
        .delete()
        .eq('id', disposableProbeId)
        .like('source_key', `greenhouse:global:${disposablePrefix}%`)
      if (error) failures.push('cleanup: disposable probe row could not be removed')
    }
  }

  if (failures.length > 0) {
    await Promise.all([clientA.auth.signOut(), clientB.auth.signOut()])
    throw new Error(`${failures.length} watchlist verification probe(s) failed`)
  }

  for (const board of seedBoards) {
    const company = await verifyAndLoadSeed(clientA, board)
    console.log(
      `PASS: ${board.label} seed persisted by verify-board (${company.id})`,
    )
  }

  await Promise.all([clientA.auth.signOut(), clientB.auth.signOut()])
  console.log('PASS: all 6 watchlist probes completed and live boards are seeded')
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  runWatchlistVerification().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Watchlist verification failed')
    process.exitCode = 1
  })
}

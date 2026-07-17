import { pathToFileURL } from 'node:url'
import { createClient } from '../web/node_modules/@supabase/supabase-js/dist/index.mjs'

const required = [
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'USER1_EMAIL',
  'USER2_EMAIL',
  'SEED_PASSWORD_1',
  'SEED_PASSWORD_2',
] as const

type VerifyBoardResponse =
  | {
      ok: true
      ats: 'greenhouse' | 'lever' | 'ashby'
      board_token: string
      region: 'eu' | null
      company_name: string
      job_count: number
    }
  | {
      ok: false
      reason: 'unsupported' | 'not_found' | 'error'
      message: string
    }

const seedBoards = [
  { label: 'Stripe', url: 'https://boards.greenhouse.io/stripe' },
  { label: 'Palantir', url: 'https://jobs.lever.co/palantir' },
  { label: 'Ramp', url: 'https://jobs.ashbyhq.com/ramp' },
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
  if (error) throw error
  if (!data) throw new Error(`verify-board returned no data for ${url}`)
  return data
}

export async function runWatchlistVerification() {
  const environment = requiredEnvironment()
  const clientA = createProbeClient(environment.url, environment.key)
  const clientB = createProbeClient(environment.url, environment.key)
  const anonClient = createProbeClient(environment.url, environment.key)
  const failures: string[] = []
  let sharedProbeId: string | undefined

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
      !missing.ok && missing.reason === 'not_found',
      "probe 2: nonexistent board returns reason 'not_found'",
    )

    const stripe = await verifyBoard(clientA, seedBoards[0].url)
    probe(
      stripe.ok && stripe.ats === 'greenhouse' && stripe.board_token === 'stripe',
      'probe 3: Stripe verifies as a Greenhouse board',
    )
    if (!stripe.ok) throw new Error('Stripe verification failed; cannot run shared-row probe')

    const { data: existingStripe, error: existingStripeError } = await clientA
      .from('companies')
      .select('id')
      .eq('ats_type', stripe.ats)
      .eq('board_token', stripe.board_token)
      .maybeSingle()
    if (existingStripeError) throw existingStripeError

    if (existingStripe) {
      sharedProbeId = existingStripe.id
    } else {
      const { data: inserted, error: insertError } = await clientA
        .from('companies')
        .insert({
          name: stripe.company_name,
          ats_type: stripe.ats,
          board_token: stripe.board_token,
          region: stripe.region,
        })
        .select('id')
        .single()
      if (insertError || !inserted) throw insertError ?? new Error('Unable to insert shared probe row')
      sharedProbeId = inserted.id
    }

    const { data: visibleToB, error: visibleError } = await clientB
      .from('companies')
      .select('id')
      .eq('id', sharedProbeId)
      .single()
    probe(
      !visibleError && visibleToB?.id === sharedProbeId,
      'probe 4a: User B can read the company saved by User A',
    )

    const { data: deletedByB, error: deleteError } = await clientB
      .from('companies')
      .delete()
      .eq('id', sharedProbeId)
      .select('id')
    probe(
      !deleteError && deletedByB?.length === 1,
      'probe 4b: User B can remove the company saved by User A',
    )
    if (!deleteError && deletedByB?.length === 1) sharedProbeId = undefined

    const { data: anonRows, error: anonError } = await anonClient.from('companies').select('id')
    probe(
      Boolean(anonError) || anonRows?.length === 0,
      'probe 5: anonymous client cannot read companies',
    )
  } finally {
    if (sharedProbeId) {
      const { error } = await clientA.from('companies').delete().eq('id', sharedProbeId)
      if (error) failures.push('cleanup: shared probe row could not be removed')
    }
  }

  if (failures.length > 0) {
    await Promise.all([clientA.auth.signOut(), clientB.auth.signOut()])
    throw new Error(`${failures.length} watchlist verification probe(s) failed`)
  }

  for (const board of seedBoards) {
    const verified = await verifyBoard(clientA, board.url)
    if (!verified.ok) throw new Error(`${board.label} could not be verified for seeding`)

    const { data: existing, error: lookupError } = await clientA
      .from('companies')
      .select('id')
      .eq('ats_type', verified.ats)
      .eq('board_token', verified.board_token)
      .maybeSingle()
    if (lookupError) throw lookupError

    if (existing) {
      console.log(`PASS: ${board.label} seed already exists`)
      continue
    }

    const { error: insertError } = await clientA.from('companies').insert({
      name: verified.company_name,
      ats_type: verified.ats,
      board_token: verified.board_token,
      region: verified.region,
    })
    if (insertError) throw insertError
    console.log(`PASS: seeded ${board.label}`)
  }

  await Promise.all([clientA.auth.signOut(), clientB.auth.signOut()])
  console.log('PASS: all 5 watchlist probes completed and live boards are seeded')
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  runWatchlistVerification().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Watchlist verification failed')
    process.exitCode = 1
  })
}

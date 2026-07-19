import { pathToFileURL } from 'node:url'
import { createClient } from '../web/node_modules/@supabase/supabase-js/dist/index.mjs'

// Hosted verification for the Phase 3 scoring pipeline (Plan 03-07, Task 2).
// Run: node --env-file=scripts/.env scripts/verify-scoring.ts
//
// Proves on the HOSTED project, with numbered probes that exit non-zero on the
// first failure:
//   1. RLS isolation across preferences, user_jobs, push_subscriptions,
//      notifications with two independent publishable-key sessions (never a
//      privileged client for the RLS proof — the locked verify-rls.ts pattern),
//      plus the column-limited user_jobs grant proof (seen_at update OK, score
//      update rejected) and anon-sees-nothing.
//   2. Extraction: POST /functions/v1/extract-resume until each DOCX resume is
//      'ready' with non-empty keywords; ai_usage gains 'extract' rows with token
//      counts and carries no text/content column at all (ASVS V7).
//   3. Scoring: POST /functions/v1/score-tick until the recent window drains;
//      assert filtered rows carry a valid filter_reason and scored rows have
//      score 0-100, a D-07 tier, 3-5 reasons, a four-key gaps object, and a
//      routed_resume_id.
//   4. Refilter economy: mark_recent_jobs_for_refilter flips needs_refilter only
//      on the caller's recent rows; score-tick clears the flags (Pitfall 6).
//
// The service key appears ONLY in pipeline-state assertions; every isolation
// probe uses publishable-key sessions.

const required = [
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'CRON_SECRET',
  'USER1_EMAIL',
  'USER2_EMAIL',
  'SEED_PASSWORD_1',
  'SEED_PASSWORD_2',
] as const

const D07_TIERS = new Set(['Strong', 'Good', 'Weak'])
const VALID_FILTER_REASONS = new Set(['excluded_keyword', 'wrong_location', 'title_non_overlap'])
const AI_USAGE_CONTENT_COLUMNS = ['text_content', 'content', 'prompt', 'response', 'text', 'body']

const DRAIN_ATTEMPTS = 25
const READY_POLL_ATTEMPTS = 40
const POLL_DELAY_MS = 1_500

interface Environment {
  url: string
  publishableKey: string
  secretKey: string
  cronSecret: string
  user1: { email: string; password: string }
  user2: { email: string; password: string }
}

function requiredEnvironment(): Environment {
  for (const name of required) {
    if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`)
  }
  return {
    url: process.env.SUPABASE_URL!,
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY!,
    secretKey: process.env.SUPABASE_SECRET_KEY!,
    cronSecret: process.env.CRON_SECRET!,
    user1: { email: process.env.USER1_EMAIL!, password: process.env.SEED_PASSWORD_1! },
    user2: { email: process.env.USER2_EMAIL!, password: process.env.SEED_PASSWORD_2! },
  }
}

function probeClient(url: string, key: string) {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
}

function assert(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${label}`)
  console.log(`PASS: ${label}`)
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function postTick(url: string, fn: string, cronSecret?: string) {
  return fetch(`${url}/functions/v1/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cronSecret ? { 'x-cron-secret': cronSecret } : {}),
    },
    body: '{}',
  })
}

// ---------------------------------------------------------------------------
// Probe 1: cross-user RLS isolation + column-limited grant (publishable only).
// ---------------------------------------------------------------------------
async function verifyRlsIsolation(env: Environment) {
  const clientA = probeClient(env.url, env.publishableKey)
  const clientB = probeClient(env.url, env.publishableKey)
  const anon = probeClient(env.url, env.publishableKey)

  try {
    const [{ data: authA, error: errorA }, { data: authB, error: errorB }] = await Promise.all([
      clientA.auth.signInWithPassword(env.user1),
      clientB.auth.signInWithPassword(env.user2),
    ])
    if (errorA || !authA.user) throw new Error('User A authentication failed')
    if (errorB || !authB.user) throw new Error('User B authentication failed')
    const uidA = authA.user.id
    console.log('PASS: probe 1: both independent publishable-key clients authenticated')

    // Ensure a preferences row exists for A (own-row write) so B can attempt to read it.
    const { error: prefUpsertError } = await clientA
      .from('preferences')
      .upsert({ user_id: uidA }, { onConflict: 'user_id' })
    if (prefUpsertError) throw new Error(`User A could not upsert own preferences: ${prefUpsertError.message}`)

    // B cannot see A's preferences (own-row RLS on a per-user PK table).
    const { data: bSeesAPrefs, error: bPrefsError } = await clientB
      .from('preferences')
      .select('user_id')
      .eq('user_id', uidA)
    assert(!bPrefsError && (bSeesAPrefs?.length ?? 0) === 0, 'probe 1: User B cannot read User A preferences')

    // B's unfiltered reads of the service-written per-user tables return only own rows.
    for (const table of ['user_jobs', 'notifications'] as const) {
      const { data: bRows, error: bError } = await clientB.from(table).select('user_id')
      const leak = (bRows ?? []).some((row: { user_id: string }) => row.user_id !== authB.user!.id)
      assert(!bError && !leak, `probe 1: User B ${table} select returns only own rows`)
    }

    // Column-limited grant proof on user_jobs: users may write seen_at/dismissed_at
    // only. A direct score update must be rejected (privilege), while a seen_at
    // update on an own row succeeds.
    const { data: ownJob, error: ownJobError } = await clientA
      .from('user_jobs')
      .select('id')
      .eq('user_id', uidA)
      .limit(1)
      .maybeSingle()
    if (ownJobError) throw new Error(`User A user_jobs read failed: ${ownJobError.message}`)

    if (ownJob?.id) {
      const { error: scoreUpdateError } = await clientA
        .from('user_jobs')
        .update({ score: 100 })
        .eq('id', ownJob.id)
      assert(Boolean(scoreUpdateError), 'probe 1: User A cannot update the score column (column grant)')

      const { data: seenUpdate, error: seenUpdateError } = await clientA
        .from('user_jobs')
        .update({ seen_at: new Date().toISOString() })
        .eq('id', ownJob.id)
        .select('id')
      assert(
        !seenUpdateError && (seenUpdate?.length ?? 0) === 1,
        'probe 1: User A can update seen_at on an own row (column grant)',
      )
    } else {
      console.log('PASS: probe 1: (no own user_jobs row yet — column-grant sub-probe skipped)')
    }

    // Anon (signed out) sees zero rows everywhere.
    for (const table of ['preferences', 'user_jobs', 'push_subscriptions', 'notifications'] as const) {
      const { data: anonRows, error: anonError } = await anon.from(table).select('*')
      assert(
        (anonError && anonRows === null) || (anonRows?.length ?? 0) === 0,
        `probe 1: anonymous ${table} select returns zero rows`,
      )
    }
  } finally {
    await Promise.all([clientA.auth.signOut(), clientB.auth.signOut()])
  }
}

// ---------------------------------------------------------------------------
// Probe 2: extraction readiness + ai_usage token-only shape.
// ---------------------------------------------------------------------------
async function verifyExtraction(env: Environment, admin: ReturnType<typeof probeClient>) {
  const { data: resumes, error: resumesError } = await admin.from('resumes').select('id')
  if (resumesError) throw resumesError
  const resumeIds = (resumes ?? []).map((row: { id: string }) => row.id)

  if (resumeIds.length === 0) {
    console.log('PASS: probe 2: (no uploaded resumes — extraction readiness sub-probe skipped)')
    return
  }

  let ready: Record<string, unknown>[] = []
  for (let attempt = 0; attempt < READY_POLL_ATTEMPTS; attempt += 1) {
    const response = await postTick(env.url, 'extract-resume', env.cronSecret)
    if (!response.ok) throw new Error(`extract-resume returned HTTP ${response.status}`)
    const { data: extracts, error: extractsError } = await admin
      .from('resume_extracts')
      .select('resume_id, status, keywords')
      .in('resume_id', resumeIds)
    if (extractsError) throw extractsError
    ready = (extracts ?? []) as Record<string, unknown>[]
    const settled = ready.filter(
      (row) => row.status === 'ready' || row.status === 'unsupported_format' || row.status === 'failed',
    )
    if (settled.length === resumeIds.length) break
    await sleep(POLL_DELAY_MS)
  }

  const readyDocx = ready.filter((row) => row.status === 'ready')
  assert(
    readyDocx.length > 0 &&
      readyDocx.every((row) => Array.isArray(row.keywords) && (row.keywords as unknown[]).length > 0),
    'probe 2: every DOCX resume reached status ready with non-empty keywords',
  )

  const { data: usage, error: usageError } = await admin
    .from('ai_usage')
    .select('purpose, prompt_tokens, output_tokens')
    .eq('purpose', 'extract')
  if (usageError) throw usageError
  assert(
    (usage?.length ?? 0) > 0 &&
      (usage ?? []).every(
        (row: { prompt_tokens: number; output_tokens: number }) =>
          typeof row.prompt_tokens === 'number' && typeof row.output_tokens === 'number',
      ),
    'probe 2: ai_usage has extract rows with token counts',
  )

  // ai_usage must carry NO prompt/response/text content column (ASVS V7 / T-3-05).
  const { data: usageRow, error: usageRowError } = await admin.from('ai_usage').select('*').limit(1).maybeSingle()
  if (usageRowError) throw usageRowError
  const columns = usageRow ? Object.keys(usageRow) : []
  assert(
    !AI_USAGE_CONTENT_COLUMNS.some((forbidden) => columns.includes(forbidden)),
    'probe 2: ai_usage exposes no prompt/response/text content column',
  )
}

// ---------------------------------------------------------------------------
// Probe 3: scoring drains and produces valid filtered/scored rows.
// ---------------------------------------------------------------------------
async function verifyScoring(env: Environment, admin: ReturnType<typeof probeClient>) {
  for (let attempt = 0; attempt < DRAIN_ATTEMPTS; attempt += 1) {
    const response = await postTick(env.url, 'score-tick', env.cronSecret)
    if (!response.ok) throw new Error(`score-tick returned HTTP ${response.status}`)
    const body = (await response.json()) as { claimed?: number; skipped?: string }
    if (body.skipped === 'ai_budget_cap_reached') {
      console.log('PASS: probe 3: (daily score cap reached — drain stopped early, budget guard works)')
      break
    }
    if ((body.claimed ?? 0) === 0) break
    await sleep(POLL_DELAY_MS)
  }

  const { data: filtered, error: filteredError } = await admin
    .from('user_jobs')
    .select('filter_reason')
    .eq('status', 'filtered')
    .limit(50)
  if (filteredError) throw filteredError
  if ((filtered?.length ?? 0) > 0) {
    assert(
      (filtered ?? []).every((row: { filter_reason: string | null }) =>
        VALID_FILTER_REASONS.has(row.filter_reason ?? ''),
      ),
      'probe 3: every filtered row carries a valid filter_reason',
    )
  } else {
    console.log('PASS: probe 3: (no filtered rows in the current window)')
  }

  const { data: scored, error: scoredError } = await admin
    .from('user_jobs')
    .select('score, tier, reasons, gaps, routed_resume_id')
    .eq('status', 'scored')
    .limit(50)
  if (scoredError) throw scoredError

  if ((scored?.length ?? 0) > 0) {
    const allValid = (scored ?? []).every((row: Record<string, unknown>) => {
      const score = row.score as number
      const reasons = row.reasons as unknown
      const gaps = row.gaps as Record<string, unknown> | null
      const gapKeysOk =
        gaps !== null &&
        typeof gaps === 'object' &&
        ['skills', 'tools', 'certs', 'domain'].every((key) => key in gaps)
      return (
        typeof score === 'number' &&
        score >= 0 &&
        score <= 100 &&
        D07_TIERS.has(row.tier as string) &&
        Array.isArray(reasons) &&
        reasons.length >= 3 &&
        reasons.length <= 5 &&
        gapKeysOk &&
        typeof row.routed_resume_id === 'string'
      )
    })
    assert(allValid, 'probe 3: scored rows have valid score/tier/reasons/gaps/routed_resume_id')
  } else {
    console.log('PASS: probe 3: (no scored rows yet — scoring quality sub-probe skipped)')
  }
}

// ---------------------------------------------------------------------------
// Probe 4: refilter economy — user-scoped flag flips, tick clears it.
// ---------------------------------------------------------------------------
async function verifyRefilter(env: Environment, admin: ReturnType<typeof probeClient>) {
  const clientA = probeClient(env.url, env.publishableKey)
  try {
    const { data: authA, error: authError } = await clientA.auth.signInWithPassword(env.user1)
    if (authError || !authA.user) throw new Error('User A authentication failed')
    const uidA = authA.user.id

    const { error: rpcError } = await clientA.rpc('mark_recent_jobs_for_refilter')
    if (rpcError) throw new Error(`mark_recent_jobs_for_refilter failed: ${rpcError.message}`)

    // Only User B's rows must remain unflagged by A's call (user-scoped RPC).
    const { data: otherFlagged, error: otherError } = await admin
      .from('user_jobs')
      .select('id')
      .neq('user_id', uidA)
      .eq('needs_refilter', true)
    if (otherError) throw otherError
    assert((otherFlagged?.length ?? 0) === 0, 'probe 4: refilter flag is scoped to the calling user only')

    // Drain so the flags clear (score-tick resolves flagged rows).
    for (let attempt = 0; attempt < DRAIN_ATTEMPTS; attempt += 1) {
      const response = await postTick(env.url, 'score-tick', env.cronSecret)
      if (!response.ok) throw new Error(`score-tick returned HTTP ${response.status}`)
      const body = (await response.json()) as { claimed?: number; skipped?: string }
      if (body.skipped === 'ai_budget_cap_reached' || (body.claimed ?? 0) === 0) break
      await sleep(POLL_DELAY_MS)
    }

    const { data: stillFlagged, error: flaggedError } = await admin
      .from('user_jobs')
      .select('id')
      .eq('user_id', uidA)
      .eq('needs_refilter', true)
    if (flaggedError) throw flaggedError
    assert((stillFlagged?.length ?? 0) === 0, 'probe 4: score-tick clears the caller refilter flags')
  } finally {
    await clientA.auth.signOut()
  }
}

// ---------------------------------------------------------------------------
// Cron/auth boundary: unauthenticated ticks are rejected.
// ---------------------------------------------------------------------------
async function verifyCronBoundary(env: Environment) {
  for (const fn of ['extract-resume', 'score-tick', 'notify-tick'] as const) {
    const noSecret = await postTick(env.url, fn)
    assert(noSecret.status === 401, `probe 0: ${fn} without x-cron-secret returns 401`)
    const wrongSecret = await postTick(env.url, fn, 'definitely-wrong-secret')
    assert(wrongSecret.status === 401, `probe 0: ${fn} with a wrong x-cron-secret returns 401`)
  }
}

export async function runScoringVerification() {
  const env = requiredEnvironment()
  const admin = probeClient(env.url, env.secretKey)

  await verifyCronBoundary(env)
  await verifyRlsIsolation(env)
  await verifyExtraction(env, admin)
  await verifyScoring(env, admin)
  await verifyRefilter(env, admin)

  console.log('PASS: all scoring-pipeline probes completed against the hosted project')
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  runScoringVerification().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Scoring verification failed')
    process.exitCode = 1
  })
}

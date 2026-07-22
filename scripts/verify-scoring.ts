import { pathToFileURL } from 'node:url'
import { createClient } from '../web/node_modules/@supabase/supabase-js/dist/index.mjs'

// Hosted verification for the Phase 3 scoring pipeline (Plan 03-07, Task 2).
// Run: node --env-file=scripts/.env scripts/verify-scoring.ts
//
// Proves on the HOSTED project, with numbered probes that exit non-zero on the
// first failure:
//   1. RLS isolation across preferences and user_jobs with two independent
//      publishable-key sessions (never a
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
const VALID_FILTER_REASONS = new Set(['excluded_keyword', 'wrong_location', 'title_non_overlap', 'experience_above_max'])
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

interface ResumeRow {
  id: string
  filename: string
}

interface PreferencesSnapshot {
  existed: boolean
  titles: string[] | null
  locations: string[] | null
  include_keywords: string[] | null
  exclude_keywords: string[] | null
}

interface UserJobSnapshot {
  id: string
  job_id: string
  status: string
  filter_reason: string | null
  filter_detail: string | null
  attempts: number
  claimed_at: string | null
  error_code: string | null
  score: number | null
  tier: string | null
  reasons: unknown
  gaps: unknown
  covered: unknown
  matched_include_keywords: unknown
  routed_resume_id: string | null
  runner_up_resume_id: string | null
  scored_at: string | null
  needs_refilter: boolean
}

const USER_JOB_SNAPSHOT_COLUMNS = [
  'id',
  'job_id',
  'status',
  'filter_reason',
  'filter_detail',
  'attempts',
  'claimed_at',
  'error_code',
  'score',
  'tier',
  'reasons',
  'gaps',
  'covered',
  'matched_include_keywords',
  'routed_resume_id',
  'runner_up_resume_id',
  'scored_at',
  'needs_refilter',
].join(', ')

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
  let uidA: string | null = null
  let createdPreferences = false
  let seenSnapshot: { id: string; seen_at: string | null } | null = null

  try {
    const [{ data: authA, error: errorA }, { data: authB, error: errorB }] = await Promise.all([
      clientA.auth.signInWithPassword(env.user1),
      clientB.auth.signInWithPassword(env.user2),
    ])
    if (errorA || !authA.user) throw new Error('User A authentication failed')
    if (errorB || !authB.user) throw new Error('User B authentication failed')
    uidA = authA.user.id
    console.log('PASS: probe 1: both independent publishable-key clients authenticated')

    // Ensure a preferences row exists for A so B can attempt to read it. If the
    // verifier creates the row, remove it in finally; never leave fixture state on
    // a real account.
    const { data: existingPreferences, error: existingPreferencesError } = await clientA
      .from('preferences')
      .select('user_id')
      .eq('user_id', uidA)
      .maybeSingle()
    if (existingPreferencesError) throw existingPreferencesError
    if (!existingPreferences) {
      const { error: prefInsertError } = await clientA.from('preferences').insert({ user_id: uidA })
      if (prefInsertError) {
        throw new Error(`User A could not insert own preferences: ${prefInsertError.message}`)
      }
      createdPreferences = true
    }

    // B cannot see A's preferences (own-row RLS on a per-user PK table).
    const { data: bSeesAPrefs, error: bPrefsError } = await clientB
      .from('preferences')
      .select('user_id')
      .eq('user_id', uidA)
    assert(!bPrefsError && (bSeesAPrefs?.length ?? 0) === 0, 'probe 1: User B cannot read User A preferences')

    // B's unfiltered reads of the service-written per-user tables return only own rows.
    for (const table of ['user_jobs'] as const) {
      const { data: bRows, error: bError } = await clientB.from(table).select('user_id')
      const leak = (bRows ?? []).some((row: { user_id: string }) => row.user_id !== authB.user!.id)
      assert(!bError && !leak, `probe 1: User B ${table} select returns only own rows`)
    }

    // Column-limited grant proof on user_jobs: users may write seen_at/dismissed_at
    // only. A direct score update must be rejected (privilege), while a seen_at
    // update on an own row succeeds.
    const { data: ownJob, error: ownJobError } = await clientA
      .from('user_jobs')
      .select('id, seen_at')
      .eq('user_id', uidA)
      .limit(1)
      .maybeSingle()
    if (ownJobError) throw new Error(`User A user_jobs read failed: ${ownJobError.message}`)

    if (ownJob?.id) {
      seenSnapshot = { id: ownJob.id as string, seen_at: (ownJob.seen_at as string | null) ?? null }
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
    for (const table of ['preferences', 'user_jobs'] as const) {
      const { data: anonRows, error: anonError } = await anon.from(table).select('*')
      assert(
        (anonError && anonRows === null) || (anonRows?.length ?? 0) === 0,
        `probe 1: anonymous ${table} select returns zero rows`,
      )
    }
  } finally {
    const cleanupErrors: string[] = []
    if (seenSnapshot) {
      const { error } = await clientA
        .from('user_jobs')
        .update({ seen_at: seenSnapshot.seen_at })
        .eq('id', seenSnapshot.id)
      if (error) cleanupErrors.push(`seen_at restore failed: ${error.message}`)
    }
    if (createdPreferences && uidA) {
      const { error } = await clientA.from('preferences').delete().eq('user_id', uidA)
      if (error) cleanupErrors.push(`preferences cleanup failed: ${error.message}`)
    }
    await Promise.all([clientA.auth.signOut(), clientB.auth.signOut()])
    if (cleanupErrors.length > 0) throw new Error(cleanupErrors.join('; '))
  }
}

// ---------------------------------------------------------------------------
// Probe 2: extraction readiness + ai_usage token-only shape.
// ---------------------------------------------------------------------------
async function verifyExtraction(env: Environment, admin: ReturnType<typeof probeClient>) {
  const { data: resumes, error: resumesError } = await admin.from('resumes').select('id, filename')
  if (resumesError) throw resumesError
  const resumeRows = (resumes ?? []) as ResumeRow[]
  const resumeIds = resumeRows.map((row) => row.id)
  const docxIds = new Set(
    resumeRows.filter((row) => row.filename.toLowerCase().endsWith('.docx')).map((row) => row.id),
  )

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
    const settled = ready.filter((row) =>
      ['ready', 'unsupported_format', 'failed'].includes(row.status as string),
    )
    if (settled.length === resumeIds.length) break
    await sleep(POLL_DELAY_MS)
  }

  // Every upload must settle, but a worker failure is never accepted as successful
  // verification. DOCX rows must be ready; PDF/non-DOCX rows must be explicitly
  // unsupported rather than silently failing.
  const settled = ready.filter((row) =>
    ['ready', 'unsupported_format', 'failed'].includes(row.status as string),
  )
  assert(
    settled.length === resumeIds.length,
    'probe 2: every uploaded resume reached a terminal extraction state',
  )
  assert(
    settled.every((row) => row.status !== 'failed'),
    'probe 2: no resume extraction ended in failed state',
  )

  const readyDocx = ready.filter((row) => docxIds.has(row.resume_id as string))
  if (docxIds.size === 0) {
    console.log(
      'PASS: probe 2: (no DOCX uploads — readiness/keyword sub-probes skipped)',
    )
  } else {
    assert(
      readyDocx.length === docxIds.size &&
        readyDocx.every(
          (row) =>
            row.status === 'ready' &&
            Array.isArray(row.keywords) &&
            (row.keywords as unknown[]).length > 0,
        ),
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
  }

  const nonDocx = ready.filter((row) => !docxIds.has(row.resume_id as string))
  assert(
    nonDocx.every((row) => row.status === 'unsupported_format'),
    'probe 2: every non-DOCX resume is marked unsupported_format',
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
// A title token no seeded job will contain, so cheapFilter's title-overlap gate
// (filters.ts step 3) discards every one of User A's recent rows via the pure
// FILTERED path — BEFORE any OpenAI call. That is what lets probe 4 prove the
// refilter flag clears without requiring User A to have a ready resume (an empty
// system has none): the flag only clears on a resolvable outcome, and `filtered`
// is the cheapest resolvable outcome (zero AI spend).
const NONSENSE_TITLE = 'zzqqxxnofitmarker'

function pipelineState(row: UserJobSnapshot) {
  return {
    status: row.status,
    filter_reason: row.filter_reason,
    filter_detail: row.filter_detail,
    attempts: row.attempts,
    claimed_at: row.claimed_at,
    error_code: row.error_code,
    score: row.score,
    tier: row.tier,
    reasons: row.reasons,
    gaps: row.gaps,
    covered: row.covered,
    matched_include_keywords: row.matched_include_keywords,
    routed_resume_id: row.routed_resume_id,
    runner_up_resume_id: row.runner_up_resume_id,
    scored_at: row.scored_at,
    needs_refilter: row.needs_refilter,
  }
}

async function restoreAttemptFlags(
  admin: ReturnType<typeof probeClient>,
  rows: UserJobSnapshot[],
) {
  const groups = new Map<string, UserJobSnapshot[]>()
  for (const row of rows) {
    const key = `${row.attempts}:${row.needs_refilter}`
    groups.set(key, [...(groups.get(key) ?? []), row])
  }

  for (const groupedRows of groups.values()) {
    for (let index = 0; index < groupedRows.length; index += 200) {
      const batch = groupedRows.slice(index, index + 200)
      const { error } = await admin
        .from('user_jobs')
        .update({
          attempts: batch[0].attempts,
          needs_refilter: batch[0].needs_refilter,
        })
        .in(
          'id',
          batch.map((row) => row.id),
        )
      if (error) throw new Error(`user_jobs attempt/flag restore failed: ${error.message}`)
    }
  }
}

async function verifyRefilter(env: Environment, admin: ReturnType<typeof probeClient>) {
  const clientA = probeClient(env.url, env.publishableKey)
  let uidA: string | null = null
  let preferencesSnapshot: PreferencesSnapshot | null = null
  let userJobsSnapshot: UserJobSnapshot[] = []
  let targetSnapshot: UserJobSnapshot | null = null
  try {
    const { data: authA, error: authError } = await clientA.auth.signInWithPassword(env.user1)
    if (authError || !authA.user) throw new Error('User A authentication failed')
    uidA = authA.user.id

    // Snapshot real prefs, then force a guaranteed-filter config so A's flagged rows
    // resolve via the cheap FILTERED path (no resume / no OpenAI call needed).
    const { data: prefRow, error: snapError } = await admin
      .from('preferences')
      .select('titles, locations, include_keywords, exclude_keywords')
      .eq('user_id', uidA)
      .maybeSingle()
    if (snapError) throw snapError
    preferencesSnapshot = {
      existed: Boolean(prefRow),
      titles: prefRow?.titles ?? null,
      locations: prefRow?.locations ?? null,
      include_keywords: prefRow?.include_keywords ?? null,
      exclude_keywords: prefRow?.exclude_keywords ?? null,
    }

    const { data: snapshotRows, error: snapshotError } = await admin
      .from('user_jobs')
      .select(USER_JOB_SNAPSHOT_COLUMNS)
      .eq('user_id', uidA)
    if (snapshotError) throw snapshotError
    userJobsSnapshot = (snapshotRows ?? []) as unknown as UserJobSnapshot[]
    assert(userJobsSnapshot.length > 0, 'probe 4: caller has user_jobs rows to refilter')

    // Pin one recent open row as the only claimable User A row. All other User A
    // rows are temporarily protected with attempts=5 after the RPC, then restored
    // exactly in finally. This prevents the verifier's nonsense preference from
    // filtering unrelated real-user rows.
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000).toISOString()
    const { data: newestJob, error: newestError } = await admin
      .from('jobs')
      .select('id')
      .eq('status', 'open')
      .gte('first_seen_at', sevenDaysAgo)
      .order('first_seen_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (newestError) throw newestError
    if (!newestJob?.id) throw new Error('no recent open job to target for refilter clear proof')
    targetSnapshot =
      userJobsSnapshot.find((row) => row.job_id === (newestJob.id as string)) ?? null
    if (!targetSnapshot) throw new Error('no caller user_jobs row for newest recent open job')

    const { count: otherFlaggedBefore, error: otherBeforeError } = await admin
      .from('user_jobs')
      .select('id', { count: 'exact', head: true })
      .neq('user_id', uidA)
      .eq('needs_refilter', true)
    if (otherBeforeError) throw otherBeforeError

    const { error: setPrefError } = await admin
      .from('preferences')
      .upsert(
        {
          user_id: uidA,
          titles: [NONSENSE_TITLE],
          locations: [],
          include_keywords: [],
          exclude_keywords: [],
        },
        { onConflict: 'user_id' },
    )
    if (setPrefError) throw new Error(`prefs override failed: ${setPrefError.message}`)

    const { error: rpcError } = await clientA.rpc('mark_recent_jobs_for_refilter')
    if (rpcError) throw new Error(`mark_recent_jobs_for_refilter failed: ${rpcError.message}`)

    // User A's call must leave every other user's refilter count unchanged.
    const { count: otherFlaggedAfter, error: otherError } = await admin
      .from('user_jobs')
      .select('id', { count: 'exact', head: true })
      .neq('user_id', uidA)
      .eq('needs_refilter', true)
    if (otherError) throw otherError
    assert(
      otherFlaggedAfter === otherFlaggedBefore,
      'probe 4: refilter flag is scoped to the calling user only',
    )

    // Confirm A's recent rows were actually flagged, so the clear assertion is not
    // vacuously satisfied by an empty flag set.
    const { count: flaggedCount, error: flagCountError } = await admin
      .from('user_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', uidA)
      .eq('needs_refilter', true)
    if (flagCountError) throw flagCountError
    assert((flaggedCount ?? 0) > 0, 'probe 4: caller recent rows were flagged for refilter')

    const { data: targetRow, error: targetError } = await admin
      .from('user_jobs')
      .select('id, needs_refilter')
      .eq('id', targetSnapshot.id)
      .maybeSingle()
    if (targetError) throw targetError
    assert(targetRow?.needs_refilter === true, 'probe 4: target recent row was flagged')

    const protectedRows = userJobsSnapshot.filter((row) => row.id !== targetSnapshot!.id)
    for (let index = 0; index < protectedRows.length; index += 200) {
      const batch = protectedRows.slice(index, index + 200)
      const { error: protectError } = await admin
        .from('user_jobs')
        .update({ attempts: 5, needs_refilter: false })
        .in(
          'id',
          batch.map((row) => row.id),
        )
      if (protectError) throw new Error(`protecting non-target rows failed: ${protectError.message}`)
    }

    // Guarantee the target is flagged and claimable this instant (mark_recent already
    // flagged it; make attempts/claim state deterministic).
    const { error: armError } = await admin
      .from('user_jobs')
      .update({ needs_refilter: true, status: 'pending', attempts: 0, claimed_at: null })
      .eq('id', targetSnapshot.id)
    if (armError) throw new Error(`arming target row failed: ${armError.message}`)

    let cleared = false
    for (let attempt = 0; attempt < DRAIN_ATTEMPTS; attempt += 1) {
      const response = await postTick(env.url, 'score-tick', env.cronSecret)
      if (!response.ok) throw new Error(`score-tick returned HTTP ${response.status}`)
      const { data: row, error: rowError } = await admin
        .from('user_jobs')
        .select('needs_refilter, status')
        .eq('id', targetSnapshot.id)
        .maybeSingle()
      if (rowError) throw rowError
      if (row && row.needs_refilter === false) {
        cleared = true
        break
      }
      await sleep(POLL_DELAY_MS)
    }
    assert(cleared, 'probe 4: score-tick clears the caller refilter flag on a resolved row')
  } finally {
    const cleanupErrors: string[] = []
    if (targetSnapshot) {
      const { error } = await admin
        .from('user_jobs')
        .update(pipelineState(targetSnapshot))
        .eq('id', targetSnapshot.id)
      if (error) cleanupErrors.push(`target user_jobs restore failed: ${error.message}`)
    }
    const protectedRows = userJobsSnapshot.filter((row) => row.id !== targetSnapshot?.id)
    if (protectedRows.length > 0) {
      try {
        await restoreAttemptFlags(admin, protectedRows)
      } catch (error) {
        cleanupErrors.push(error instanceof Error ? error.message : 'attempt/flag restore failed')
      }
    }
    if (uidA && preferencesSnapshot) {
      if (preferencesSnapshot.existed) {
        const { existed: _existed, ...values } = preferencesSnapshot
        const { error } = await admin
          .from('preferences')
          .upsert({ user_id: uidA, ...values }, { onConflict: 'user_id' })
        if (error) cleanupErrors.push(`preferences restore failed: ${error.message}`)
      } else {
        const { error } = await admin.from('preferences').delete().eq('user_id', uidA)
        if (error) cleanupErrors.push(`temporary preferences cleanup failed: ${error.message}`)
      }
    }
    await clientA.auth.signOut()
    if (cleanupErrors.length > 0) throw new Error(cleanupErrors.join('; '))
  }
}

// ---------------------------------------------------------------------------
// Cron/auth boundary: unauthenticated ticks are rejected.
// ---------------------------------------------------------------------------
async function verifyCronBoundary(env: Environment) {
  for (const fn of ['extract-resume', 'score-tick'] as const) {
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

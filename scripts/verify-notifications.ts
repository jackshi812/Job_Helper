import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createClient } from '../web/node_modules/@supabase/supabase-js/dist/index.mjs'

// Hosted verification for the notification dispatcher (Plan 03-07, Task 2, Codex F6).
// Run: node --env-file=scripts/.env scripts/verify-notifications.ts
//
// SAFETY (Codex F6): this script NEVER emits a real push or Resend email and
// NEVER mutates a real invited account. It proves the notify-tick bookkeeping
// (enqueue -> claim -> status collapse -> exactly-once uniqueness -> transient
// retry vs terminal failure -> digest advance) against a DISPOSABLE fixture user
// only, driving notify-tick in DRY-RUN / no-send mode (header `x-notify-dry-run: 1`,
// outcome forced by `x-notify-dry-run-outcome`).
//
// notify-tick has no per-user targeting — it sweeps every user each tick. In
// dry-run nothing is SENT, but the tick still does DB bookkeeping on real users'
// rows. To leave zero footprint, this verifier SNAPSHOTS the notifications table
// and every preferences.last_digest_date BEFORE the run and RESTORES them in a
// finally block: pre-existing non-fixture rows are reverted field-by-field, any
// non-fixture rows the dry-run created are deleted (they were never sent, so the
// next real tick re-enqueues them), and advanced digest dates are rolled back.
// The disposable fixture user is deleted (its rows FK-cascade away).
//
// The single real end-to-end send is reserved for the human UAT (Task 3).

const required = [
  'SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
  'CRON_SECRET',
] as const

const FIXTURE_EMAIL_PREFIX = 'notif-fixture+'
const FIXTURE_EMAIL_DOMAIN = '@job-copilot.invalid'
const POLL_DELAY_MS = 1_000

const RESTORABLE_NOTIFICATION_FIELDS = [
  'status',
  'claimed_at',
  'attempts',
  'retry_at',
  'sent_at',
  'error_code',
] as const

interface Environment {
  url: string
  secretKey: string
  cronSecret: string
}

function requiredEnvironment(): Environment {
  for (const name of required) {
    if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`)
  }
  return {
    url: process.env.SUPABASE_URL!,
    secretKey: process.env.SUPABASE_SECRET_KEY!,
    cronSecret: process.env.CRON_SECRET!,
  }
}

function adminClient(env: Environment) {
  return createClient(env.url, env.secretKey, {
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

type Admin = ReturnType<typeof adminClient>

// One dry-run notify-tick with a forced push outcome (sent | failed | gone).
async function notifyTick(env: Environment, outcome: 'sent' | 'failed' | 'gone') {
  const response = await fetch(`${env.url}/functions/v1/notify-tick`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-cron-secret': env.cronSecret,
      'x-notify-dry-run': '1',
      'x-notify-dry-run-outcome': outcome,
    },
    body: '{}',
  })
  if (!response.ok) throw new Error(`notify-tick returned HTTP ${response.status}`)
  const body = (await response.json()) as Record<string, unknown>
  if (body.dry_run !== true) throw new Error('notify-tick did not honor dry-run mode')
  return body
}

async function snapshotNotifications(admin: Admin): Promise<Map<string, Record<string, unknown>>> {
  const { data, error } = await admin
    .from('notifications')
    .select('id, status, claimed_at, attempts, retry_at, sent_at, error_code')
  if (error) throw error
  return new Map((data ?? []).map((row: Record<string, unknown>) => [row.id as string, row]))
}

async function snapshotDigestDates(admin: Admin): Promise<Map<string, string | null>> {
  const { data, error } = await admin.from('preferences').select('user_id, last_digest_date')
  if (error) throw error
  return new Map(
    (data ?? []).map((row: { user_id: string; last_digest_date: string | null }) => [
      row.user_id,
      row.last_digest_date,
    ]),
  )
}

export async function runNotificationVerification() {
  const env = requiredEnvironment()
  const admin = adminClient(env)

  // Pick any existing job to attach the fixture user_job to (read-only on the job).
  const { data: anyJob, error: jobError } = await admin.from('jobs').select('id').limit(1).maybeSingle()
  if (jobError) throw jobError
  if (!anyJob?.id) {
    console.log('SKIP: no jobs exist yet — cannot seed a fixture scored match. Re-run after ingestion.')
    return
  }
  const jobId = anyJob.id as string

  // Snapshot real state so the global dry-run tick leaves zero footprint.
  const preNotifications = await snapshotNotifications(admin)
  const preDigestDates = await snapshotDigestDates(admin)

  const fixtureEmail = `${FIXTURE_EMAIL_PREFIX}${randomUUID()}${FIXTURE_EMAIL_DOMAIN}`
  let fixtureUserId: string | null = null

  try {
    // --- Fixture setup (disposable user, tagged rows) -----------------------
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: fixtureEmail,
      password: randomUUID(),
      email_confirm: true,
    })
    if (createError || !created?.user) throw createError ?? new Error('fixture user creation failed')
    fixtureUserId = created.user.id
    console.log('PASS: setup: disposable fixture user created')

    // Digest-due preferences: 00:00 UTC + null last_digest_date => due now.
    const { error: prefError } = await admin.from('preferences').upsert(
      {
        user_id: fixtureUserId,
        notify_threshold: 1,
        digest_time: '00:00',
        timezone: 'UTC',
        last_digest_date: null,
      },
      { onConflict: 'user_id' },
    )
    if (prefError) throw prefError

    // A scored, above-threshold match for the fixture user.
    const { error: ujError } = await admin.from('user_jobs').insert({
      user_id: fixtureUserId,
      job_id: jobId,
      status: 'scored',
      score: 95,
      tier: 'Strong',
      reasons: ['fixture reason one', 'fixture reason two', 'fixture reason three'],
      gaps: { skills: [], tools: [], certs: [], domain: [] },
      covered: [],
      scored_at: new Date().toISOString(),
    })
    if (ujError) throw ujError

    // A (fake) push subscription so the transient-failure path is reachable.
    const { error: subError } = await admin.from('push_subscriptions').insert({
      user_id: fixtureUserId,
      endpoint: `https://push.invalid/fixture-${randomUUID()}`,
      subscription: {
        endpoint: `https://push.invalid/fixture-${randomUUID()}`,
        keys: { p256dh: 'ZmFrZQ', auth: 'ZmFrZQ' },
      },
    })
    if (subError) throw subError
    console.log('PASS: setup: fixture preferences, scored match, and subscription seeded')

    const fixturePushRows = async () => {
      const { data, error } = await admin
        .from('notifications')
        .select('id, status, retry_at, sent_at, error_code, claimed_at')
        .eq('user_id', fixtureUserId)
        .eq('channel', 'push')
      if (error) throw error
      return (data ?? []) as Record<string, unknown>[]
    }

    // --- Probe 1 + 2: enqueue -> claim -> sent (dry-run) --------------------
    await notifyTick(env, 'sent')
    await sleep(POLL_DELAY_MS)
    let pushRows = await fixturePushRows()
    assert(pushRows.length === 1, 'probe 1: exactly one push notification row exists for the fixture match')
    assert(
      pushRows[0].status === 'sent' && pushRows[0].sent_at !== null,
      'probe 2: the claimed push row transitions to sent with sent_at (dry-run collapse)',
    )

    // --- Probe 3: re-running the tick creates zero additional rows (NOTF-04) -
    await notifyTick(env, 'sent')
    await sleep(POLL_DELAY_MS)
    pushRows = await fixturePushRows()
    assert(
      pushRows.length === 1,
      'probe 3: re-running notify-tick creates no duplicate (user, job, channel) push row (NOTF-04)',
    )

    // --- Probe 4: transient dry-run failure stays retryable, not terminal ----
    // Reset the fixture push row to queued so it re-claims, then force 'failed'.
    const { error: resetError } = await admin
      .from('notifications')
      .delete()
      .eq('user_id', fixtureUserId)
      .eq('channel', 'push')
    if (resetError) throw resetError
    await notifyTick(env, 'failed')
    await sleep(POLL_DELAY_MS)
    pushRows = await fixturePushRows()
    assert(
      pushRows.length === 1 &&
        pushRows[0].status === 'queued' &&
        pushRows[0].retry_at !== null &&
        pushRows[0].status !== 'failed',
      'probe 4: a transient push failure keeps the row queued with retry_at (F4 — not terminal)',
    )

    // --- Probe 5: digest bookkeeping advances last_digest_date on success ----
    const { data: prefAfter, error: prefAfterError } = await admin
      .from('preferences')
      .select('last_digest_date')
      .eq('user_id', fixtureUserId)
      .single()
    if (prefAfterError) throw prefAfterError
    const todayUtc = new Date().toISOString().slice(0, 10)
    assert(
      prefAfter.last_digest_date === todayUtc,
      'probe 5: a successful dry-run digest advances last_digest_date to today (D-20)',
    )

    console.log('PASS: all notification-dispatcher probes completed on the disposable fixture')
  } finally {
    // --- Restore: leave zero footprint on real users -----------------------
    if (fixtureUserId) {
      // Deleting the auth user FK-cascades preferences/user_jobs/notifications/push_subscriptions.
      const { error: deleteError } = await admin.auth.admin.deleteUser(fixtureUserId)
      if (deleteError) console.error(`PROBE CLEANUP: fixture user delete failed — ${deleteError.message}`)
    }

    // Revert every non-fixture notification the global dry-run touched.
    const postNotifications = await snapshotNotifications(admin)
    for (const [id, current] of postNotifications) {
      const before = preNotifications.get(id)
      if (!before) {
        // Created by the dry-run for a real user: never sent — delete so a real
        // tick re-enqueues it.
        const { error } = await admin.from('notifications').delete().eq('id', id)
        if (error) console.error(`PROBE CLEANUP: could not delete dry-run notification ${id} — ${error.message}`)
        continue
      }
      const drifted = RESTORABLE_NOTIFICATION_FIELDS.some(
        (field) => JSON.stringify(current[field]) !== JSON.stringify(before[field]),
      )
      if (drifted) {
        const restore = Object.fromEntries(
          RESTORABLE_NOTIFICATION_FIELDS.map((field) => [field, before[field]]),
        )
        const { error } = await admin.from('notifications').update(restore).eq('id', id)
        if (error) console.error(`PROBE CLEANUP: could not restore notification ${id} — ${error.message}`)
      }
    }

    // Roll back any real users' advanced digest date.
    const postDigestDates = await snapshotDigestDates(admin)
    for (const [userId, before] of preDigestDates) {
      const current = postDigestDates.get(userId)
      if (current !== before) {
        const { error } = await admin
          .from('preferences')
          .update({ last_digest_date: before })
          .eq('user_id', userId)
        if (error) console.error(`PROBE CLEANUP: could not restore last_digest_date for ${userId.slice(0, 8)} — ${error.message}`)
      }
    }
    console.log('PASS: cleanup: fixture removed and real-user notification/digest state restored')
  }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  runNotificationVerification().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Notification verification failed')
    process.exitCode = 1
  })
}

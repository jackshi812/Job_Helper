import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.110.7'
import { digestDue, quietHoursState, userLocalDate } from '../_shared/quiet-hours.ts'
import { sendPush, type PushOutcome, type PushPayload } from '../_shared/webpush.ts'

// notify-tick: the per-minute notification dispatcher (RESEARCH Pattern 2/3).
// Built on the poll-tick skeleton (POST-only, x-cron-secret gate, service-role
// client, Promise.allSettled per-entity isolation). Each tick:
//
//   1. ENQUEUE (NOTF-04): every scored, non-dismissed user_job at/above the
//      user's threshold gets a 'push' notification row. `on conflict do nothing`
//      on unique (user_id, job_id, channel) makes a re-enqueue structurally
//      impossible — once a push row exists it is never created again.
//   2. CLAIM (Codex F3): claim_notifications SKIP LOCKED atomically OWNs a batch
//      before any external send, so two concurrent ticks never double-SEND.
//   3. Per user: quiet-hours gate (D-19) releases the claim untouched; otherwise
//      burst-collapse all claimed rows into ONE push (D-18) sent to every
//      subscription. Dead endpoints (gone) are pruned; a terminally undeliverable
//      Strong match falls back to ONE collapsed email (D-20).
//   4. DIGEST (D-20): one Resend digest of Strong+Good matches with an
//      Idempotency-Key; last_digest_date advances ONLY on a confirmed 2xx.
//
// Retry safety (Codex F4): status 'failed' is TERMINAL (dead endpoint or attempts
// exhausted); transient failures stay 'queued' with a future retry_at.
//
// ASVS V7: only bounded machine codes/counters/UUIDs are logged — never
// subscription endpoints, email bodies, JD text, or resume content.

const PUSH_BATCH_SIZE = 50
const PER_TICK_EMAIL_CAP = 20
const DEFAULT_THRESHOLD = 75
const GOOD_TIER_MIN = 50
const RECENT_WINDOW = "now() - interval '24 hours'"

interface PreferencesRow {
  user_id: string
  notify_threshold: number | null
  quiet_start: string | null
  quiet_end: string | null
  digest_time: string | null
  timezone: string | null
  last_digest_date: string | null
}

interface UserJobRow {
  id: string
  user_id: string
  job_id: string
  score: number | null
  tier: string | null
}

interface NotificationRow {
  id: string
  user_id: string
  job_id: string
  attempts: number
}

interface JobInfo {
  title: string
  company: string
  url: string
}

interface MatchLine {
  title: string
  company: string
  score: number
  tier: string
  applyUrl: string
}

function requiredEnvironment(name: string) {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

// Escape untrusted third-party text (job titles, company names, URLs) before
// interpolation into any email HTML (Codex email-injection mitigation).
function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
}

function thresholdFor(prefs: PreferencesRow | undefined): number {
  return prefs?.notify_threshold ?? DEFAULT_THRESHOLD
}

function timezoneFor(prefs: PreferencesRow | undefined): string {
  return prefs?.timezone ?? 'America/Chicago'
}

// A tick-scoped transport wrapper. In dry-run mode (Codex F6) it exercises the
// full bookkeeping path but NEVER reaches a push service or Resend, returning a
// synthetic outcome so Plan 07's verifier can probe claim/retry/digest logic
// against a disposable fixture user with zero real sends.
interface Transport {
  dryRun: boolean
  dryPushOutcome: PushOutcome
  push(subscription: unknown, payload: PushPayload): Promise<PushOutcome>
  sendEmail(body: unknown, idempotencyKey?: string): Promise<{ status: number }>
}

function makeTransport(request: Request): Transport {
  const dryRun =
    request.headers.get('x-notify-dry-run') === '1' || Deno.env.get('NOTIFY_DRY_RUN') === '1'
  const requested = request.headers.get('x-notify-dry-run-outcome')
  const dryPushOutcome: PushOutcome =
    requested === 'gone' || requested === 'failed' ? requested : 'sent'

  return {
    dryRun,
    dryPushOutcome,
    async push(subscription, payload) {
      if (dryRun) return dryPushOutcome
      return await sendPush(subscription, payload)
    },
    async sendEmail(body, idempotencyKey) {
      if (dryRun) return { status: 200 }
      const apiKey = Deno.env.get('RESEND_API_KEY')
      // No key configured (local/pre-Plan-07): treat as a transient failure so
      // rows stay retryable rather than crashing the tick.
      if (!apiKey) return { status: 0 }
      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      }
      if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      return { status: response.status }
    },
  }
}

// Insert 'push' notification rows for every scored, non-dismissed user_job at or
// above the user's threshold, scored within the last 24h. The unique constraint +
// ignoreDuplicates makes this idempotent and enforces NOTF-04.
async function enqueuePush(
  admin: SupabaseClient,
  prefsByUser: Map<string, PreferencesRow>,
): Promise<number> {
  let enqueued = 0
  for (const prefs of prefsByUser.values()) {
    const threshold = thresholdFor(prefs)
    const { data, error } = await admin
      .from('user_jobs')
      .select('id, user_id, job_id, score')
      .eq('user_id', prefs.user_id)
      .eq('status', 'scored')
      .is('dismissed_at', null)
      .gte('score', threshold)
      .gt('scored_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    if (error) throw error

    const rows = (data as UserJobRow[]) ?? []
    if (rows.length === 0) continue

    const inserts = rows.map((row) => ({
      user_id: row.user_id,
      job_id: row.job_id,
      channel: 'push',
      status: 'queued',
    }))
    const { data: inserted, error: insertError } = await admin
      .from('notifications')
      .upsert(inserts, { onConflict: 'user_id,job_id,channel', ignoreDuplicates: true })
      .select('id')
    if (insertError) throw insertError
    enqueued += inserted?.length ?? 0
  }
  return enqueued
}

// Build the burst-collapsed push payload (D-18) from a user's claimed matches,
// following the UI-SPEC copy contract exactly.
function collapsePayload(matches: CollapseMatch[], siteUrl: string): PushPayload {
  const sorted = [...matches].sort((a, b) => b.score - a.score)
  const top = sorted[0]
  if (sorted.length === 1) {
    return {
      title: `Strong match: ${top.title}`,
      body: `${top.company} · score ${top.score}`,
      url: `${siteUrl}/jobs/${top.userJobId}`,
      tag: `strong-${top.userJobId}`,
    }
  }
  return {
    title: `${sorted.length} strong matches`,
    body: `${top.title} and ${sorted.length - 1} more`,
    url: `${siteUrl}/`,
    tag: 'strong-burst',
  }
}

interface CollapseMatch {
  userJobId: string
  jobId: string
  title: string
  company: string
  score: number
  tier: string
  applyUrl: string
}

interface Subscription {
  id: string
  subscription: unknown
}

interface PushUserResult {
  pushed: boolean
  pruned: number
  fallbackEmail: boolean
  failed: number
}

function buildFallbackHtml(matches: CollapseMatch[]): string {
  const items = matches
    .map(
      (match) =>
        `<li><a href="${htmlEscape(match.applyUrl)}">${htmlEscape(match.title)}</a> — ${htmlEscape(
          match.company,
        )} (score ${match.score})</li>`,
    )
    .join('')
  return `<div><p>Strong matches you may have missed (push could not be delivered):</p><ul>${items}</ul><p>Sent by Job Copilot · tune alerts in Settings</p></div>`
}

async function processPushUser(
  admin: SupabaseClient,
  transport: Transport,
  userId: string,
  rows: NotificationRow[],
  prefs: PreferencesRow | undefined,
  jobInfoById: Map<string, JobInfo>,
  userJobByJobId: Map<string, UserJobRow>,
  siteUrl: string,
  nowIso: string,
  emailBudget: { sent: number },
): Promise<PushUserResult> {
  const result: PushUserResult = { pushed: false, pruned: 0, fallbackEmail: false, failed: 0 }
  const rowIds = rows.map((row) => row.id)

  // D-19 quiet gate: RELEASE the claim untouched — no send, no status change. The
  // rows re-claim and fire as one combined push at window end on a later tick.
  const quiet = quietHoursState(
    {
      quietStart: prefs?.quiet_start ?? null,
      quietEnd: prefs?.quiet_end ?? null,
      timezone: timezoneFor(prefs),
    },
    nowIso,
  )
  if (quiet.inQuietWindow) {
    const { error } = await admin
      .from('notifications')
      .update({ status: 'queued', claimed_at: null })
      .in('id', rowIds)
    if (error) throw error
    return result
  }

  // Build the collapse set from the user_jobs backing each claimed row.
  const matches: CollapseMatch[] = []
  for (const row of rows) {
    const info = jobInfoById.get(row.job_id)
    const userJob = userJobByJobId.get(row.job_id)
    if (!info || !userJob) continue
    matches.push({
      userJobId: userJob.id,
      jobId: row.job_id,
      title: info.title,
      company: info.company,
      score: userJob.score ?? 0,
      tier: userJob.tier ?? 'Strong',
      applyUrl: info.url,
    })
  }

  const payload = collapsePayload(matches, siteUrl)

  // Send the ONE collapsed payload to every subscription for the user.
  const { data: subData, error: subError } = await admin
    .from('push_subscriptions')
    .select('id, subscription')
    .eq('user_id', userId)
  if (subError) throw subError
  const subscriptions = (subData as Subscription[]) ?? []

  let anySent = false
  let anyTransient = false
  for (const sub of subscriptions) {
    const outcome = await transport.push(sub.subscription, payload)
    if (outcome === 'sent') {
      anySent = true
      await admin
        .from('push_subscriptions')
        .update({ last_success_at: nowIso })
        .eq('id', sub.id)
    } else if (outcome === 'gone') {
      // TERMINAL for this endpoint: delete the dead subscription row.
      await admin.from('push_subscriptions').delete().eq('id', sub.id)
      result.pruned += 1
    } else {
      anyTransient = true
    }
  }

  if (anySent) {
    const { error } = await admin
      .from('notifications')
      .update({ status: 'sent', sent_at: nowIso, claimed_at: null })
      .in('id', rowIds)
    if (error) throw error
    result.pushed = true
    return result
  }

  // No successful send. Decide terminal vs transient (Codex F4).
  const noSubscriptions = subscriptions.length === 0
  const allGone = !noSubscriptions && !anyTransient // every result was 'gone'
  const attemptsExhausted = rows.some((row) => row.attempts >= 5)

  if (noSubscriptions || allGone || attemptsExhausted) {
    // Terminally undeliverable via push → mark failed + email fallback (D-20).
    const { error } = await admin
      .from('notifications')
      .update({ status: 'failed', error_code: 'push_undeliverable', claimed_at: null })
      .in('id', rowIds)
    if (error) throw error
    result.failed += rows.length

    const sentFallback = await sendFallbackEmail(
      admin,
      transport,
      userId,
      matches,
      payload.title,
      emailBudget,
    )
    result.fallbackEmail = sentFallback
    return result
  }

  // Transient failure: keep retryable with backoff (retry_at), NOT terminal.
  const { error } = await admin
    .from('notifications')
    .update({
      status: 'queued',
      claimed_at: null,
      retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      error_code: 'push_retry',
    })
    .in('id', rowIds)
  if (error) throw error
  console.error('notify-tick push_send_failed', userId.slice(0, 8))
  return result
}

async function sendFallbackEmail(
  admin: SupabaseClient,
  transport: Transport,
  userId: string,
  matches: CollapseMatch[],
  subject: string,
  emailBudget: { sent: number },
): Promise<boolean> {
  if (matches.length === 0) return false

  // Insert 'email' channel rows (idempotent via the unique constraint).
  const emailRows = matches.map((match) => ({
    user_id: userId,
    job_id: match.jobId,
    channel: 'email',
    status: 'queued',
  }))
  const { error: insertError } = await admin
    .from('notifications')
    .upsert(emailRows, { onConflict: 'user_id,job_id,channel', ignoreDuplicates: true })
  if (insertError) throw insertError

  const jobIds = matches.map((match) => match.jobId)

  // Hard per-tick email cap (D-20 safety valve): leave rows retryable.
  if (emailBudget.sent >= PER_TICK_EMAIL_CAP) {
    await admin
      .from('notifications')
      .update({
        error_code: 'email_cap_reached',
        retry_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      })
      .eq('user_id', userId)
      .eq('channel', 'email')
      .in('job_id', jobIds)
    return false
  }

  const { data: userData, error: userError } = await admin.auth.admin.getUserById(userId)
  if (userError || !userData?.user?.email) {
    console.error('notify-tick fallback_no_email', userId.slice(0, 8))
    return false
  }
  const toEmail = userData.user.email

  const { status } = await transport.sendEmail({
    from: Deno.env.get('RESEND_FROM') ?? 'Job Copilot <onboarding@resend.dev>',
    to: [toEmail],
    subject,
    html: buildFallbackHtml(matches),
  })

  if (status >= 200 && status < 300) {
    emailBudget.sent += 1
    await admin
      .from('notifications')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('channel', 'email')
      .in('job_id', jobIds)
    return true
  }

  if (status === 429 || status >= 500 || status === 0) {
    // Transient: keep retryable, NOT terminal (F4).
    await admin
      .from('notifications')
      .update({
        error_code: 'resend_http_429',
        retry_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      })
      .eq('user_id', userId)
      .eq('channel', 'email')
      .in('job_id', jobIds)
    console.error('notify-tick resend_http_429', userId.slice(0, 8))
    return false
  }

  // Permanent 4xx: terminal failure.
  await admin
    .from('notifications')
    .update({ status: 'failed', error_code: 'email_permanent' })
    .eq('user_id', userId)
    .eq('channel', 'email')
    .in('job_id', jobIds)
  return false
}

function buildDigestHtml(matches: MatchLine[]): string {
  const rows = matches
    .map(
      (match) =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${htmlEscape(
          match.title,
        )}</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${htmlEscape(
          match.company,
        )}</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${match.score} · ${htmlEscape(
          match.tier,
        )}</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;"><a href="${htmlEscape(
          match.applyUrl,
        )}">Apply</a></td></tr>`,
    )
    .join('')
  return `<div style="background:#f8fafc;padding:24px;font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#18181b;">
    <table style="width:100%;max-width:640px;margin:0 auto;background:#ffffff;border-collapse:collapse;border:1px solid #e2e8f0;">
      <thead><tr>
        <th style="text-align:left;padding:8px 12px;border-bottom:1px solid #e2e8f0;">Title</th>
        <th style="text-align:left;padding:8px 12px;border-bottom:1px solid #e2e8f0;">Company</th>
        <th style="text-align:left;padding:8px 12px;border-bottom:1px solid #e2e8f0;">Score</th>
        <th style="text-align:left;padding:8px 12px;border-bottom:1px solid #e2e8f0;">Apply</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="max-width:640px;margin:16px auto 0;font-size:12px;color:#64748b;">Sent by Job Copilot · tune alerts in Settings</p>
  </div>`
}

interface DigestUserResult {
  sent: boolean
}

async function processDigestUser(
  admin: SupabaseClient,
  transport: Transport,
  prefs: PreferencesRow,
  nowIso: string,
  emailBudget: { sent: number },
): Promise<DigestUserResult> {
  const localDate = userLocalDate(timezoneFor(prefs), nowIso)

  // Collect Strong+Good (score >= 50) scored in the last 24h.
  const { data, error } = await admin
    .from('user_jobs')
    .select('id, user_id, job_id, score, tier')
    .eq('user_id', prefs.user_id)
    .eq('status', 'scored')
    .is('dismissed_at', null)
    .gte('score', GOOD_TIER_MIN)
    .gt('scored_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
  if (error) throw error
  const rows = (data as UserJobRow[]) ?? []

  // Empty digest (zero matches): advance last_digest_date without a send so we do
  // not re-check every tick; no digest rows are inserted (F4 confirmed-success).
  if (rows.length === 0) {
    await admin
      .from('preferences')
      .update({ last_digest_date: localDate })
      .eq('user_id', prefs.user_id)
    return { sent: false }
  }

  if (emailBudget.sent >= PER_TICK_EMAIL_CAP) {
    // Do NOT advance last_digest_date — retried next tick under the cap.
    console.error('notify-tick digest email_cap_reached', prefs.user_id.slice(0, 8))
    return { sent: false }
  }

  const jobInfoById = await loadJobInfo(admin, [...new Set(rows.map((row) => row.job_id))])
  const matches: MatchLine[] = rows
    .map((row) => {
      const info = jobInfoById.get(row.job_id)
      if (!info) return null
      return {
        title: info.title,
        company: info.company,
        score: row.score ?? 0,
        tier: row.tier ?? 'Good',
        applyUrl: info.url,
      }
    })
    .filter((line): line is MatchLine => line !== null)
    .sort((a, b) => b.score - a.score)

  const { data: userData, error: userError } = await admin.auth.admin.getUserById(prefs.user_id)
  if (userError || !userData?.user?.email) {
    console.error('notify-tick digest_no_email', prefs.user_id.slice(0, 8))
    return { sent: false }
  }

  const { status } = await transport.sendEmail(
    {
      from: Deno.env.get('RESEND_FROM') ?? 'Job Copilot <onboarding@resend.dev>',
      to: [userData.user.email],
      subject: `${matches.length} new job matches`,
      html: buildDigestHtml(matches),
    },
    // 24h server-side dedup even across a crash between send and DB write.
    `digest-${prefs.user_id}-${localDate}`,
  )

  // CONFIRMED-SUCCESS-ONLY (F4): advance last_digest_date + insert digest rows
  // ONLY after a 2xx. On failure, leave everything so the next tick retries (the
  // Idempotency-Key prevents a double-send if a prior attempt reached Resend).
  if (status >= 200 && status < 300) {
    emailBudget.sent += 1
    const digestRows = rows.map((row) => ({
      user_id: prefs.user_id,
      job_id: row.job_id,
      channel: 'digest',
      status: 'sent',
      sent_at: new Date().toISOString(),
    }))
    await admin
      .from('notifications')
      .upsert(digestRows, { onConflict: 'user_id,job_id,channel', ignoreDuplicates: true })
    await admin
      .from('preferences')
      .update({ last_digest_date: localDate })
      .eq('user_id', prefs.user_id)
    return { sent: true }
  }

  console.error('notify-tick digest_send_failed', prefs.user_id.slice(0, 8))
  return { sent: false }
}

// Load job title/company/apply-url for a set of job ids (for push + digest copy).
async function loadJobInfo(
  admin: SupabaseClient,
  jobIds: string[],
): Promise<Map<string, JobInfo>> {
  const info = new Map<string, JobInfo>()
  if (jobIds.length === 0) return info
  const { data: jobs, error } = await admin
    .from('jobs')
    .select('id, title, absolute_url, company_id')
    .in('id', jobIds)
  if (error) throw error

  const companyIds = [
    ...new Set(
      (jobs ?? [])
        .map((job) => job.company_id as string | null)
        .filter((id): id is string => Boolean(id)),
    ),
  ]
  const companyName = new Map<string, string>()
  if (companyIds.length > 0) {
    const { data: companies, error: companyError } = await admin
      .from('companies')
      .select('id, name')
      .in('id', companyIds)
    if (companyError) throw companyError
    for (const company of companies ?? []) {
      companyName.set(company.id as string, company.name as string)
    }
  }

  for (const job of jobs ?? []) {
    info.set(job.id as string, {
      title: (job.title as string) ?? '',
      company: companyName.get(job.company_id as string) ?? 'Company',
      url: (job.absolute_url as string) ?? '',
    })
  }
  return info
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret || request.headers.get('x-cron-secret') !== cronSecret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const transport = makeTransport(request)

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
    const nowIso = new Date().toISOString()
    const siteUrl = (Deno.env.get('SITE_URL') ?? '').replace(/\/$/, '')
    const emailBudget = { sent: 0 }

    const { data: prefsData, error: prefsError } = await admin
      .from('preferences')
      .select(
        'user_id, notify_threshold, quiet_start, quiet_end, digest_time, timezone, last_digest_date',
      )
    if (prefsError) throw prefsError
    const prefsByUser = new Map<string, PreferencesRow>(
      (prefsData as PreferencesRow[]).map((row) => [row.user_id, row]),
    )

    // 1. ENQUEUE (NOTF-04).
    const enqueued = await enqueuePush(admin, prefsByUser)

    // 2. CLAIM (Codex F3): own a batch of queued push rows before any send.
    const { data: claimData, error: claimError } = await admin.rpc('claim_notifications', {
      p_channel: 'push',
      batch_size: PUSH_BATCH_SIZE,
    })
    if (claimError) throw claimError
    const claimed = (claimData as NotificationRow[]) ?? []

    let pushedUsers = 0
    let fallbackEmails = 0
    let digestsSent = 0
    let subscriptionsPruned = 0
    let failed = 0

    if (claimed.length > 0) {
      const rowsByUser = new Map<string, NotificationRow[]>()
      for (const row of claimed) {
        const list = rowsByUser.get(row.user_id) ?? []
        list.push(row)
        rowsByUser.set(row.user_id, list)
      }

      const claimedJobIds = [...new Set(claimed.map((row) => row.job_id))]
      const claimedUserIds = [...rowsByUser.keys()]
      const jobInfoById = await loadJobInfo(admin, claimedJobIds)

      const { data: ujData, error: ujError } = await admin
        .from('user_jobs')
        .select('id, user_id, job_id, score, tier')
        .in('user_id', claimedUserIds)
        .in('job_id', claimedJobIds)
      if (ujError) throw ujError
      const userJobByKey = new Map<string, UserJobRow>(
        (ujData as UserJobRow[]).map((row) => [`${row.user_id}:${row.job_id}`, row]),
      )

      const pushSettled = await Promise.allSettled(
        [...rowsByUser.entries()].map(([userId, rows]) => {
          const perUserJobs = new Map<string, UserJobRow>()
          for (const row of rows) {
            const uj = userJobByKey.get(`${userId}:${row.job_id}`)
            if (uj) perUserJobs.set(row.job_id, uj)
          }
          return processPushUser(
            admin,
            transport,
            userId,
            rows,
            prefsByUser.get(userId),
            jobInfoById,
            perUserJobs,
            siteUrl,
            nowIso,
            emailBudget,
          )
        }),
      )

      for (const settled of pushSettled) {
        if (settled.status === 'fulfilled') {
          if (settled.value.pushed) pushedUsers += 1
          if (settled.value.fallbackEmail) fallbackEmails += 1
          subscriptionsPruned += settled.value.pruned
          failed += settled.value.failed
        } else {
          failed += 1
          console.error('notify-tick push_user_failed')
        }
      }
    }

    // 3. DIGEST (D-20): one email per due user; last_digest_date advances only on 2xx.
    const dueUsers = [...prefsByUser.values()].filter((prefs) =>
      digestDue(
        {
          digestTime: prefs.digest_time ?? '08:00',
          timezone: timezoneFor(prefs),
          lastDigestDate: prefs.last_digest_date,
        },
        nowIso,
      ),
    )

    if (dueUsers.length > 0) {
      const digestSettled = await Promise.allSettled(
        dueUsers.map((prefs) =>
          processDigestUser(admin, transport, prefs, nowIso, emailBudget),
        ),
      )
      for (const settled of digestSettled) {
        if (settled.status === 'fulfilled' && settled.value.sent) digestsSent += 1
        else if (settled.status === 'rejected') console.error('notify-tick digest_user_failed')
      }
    }

    return Response.json({
      enqueued,
      claimed: claimed.length,
      pushed_users: pushedUsers,
      fallback_emails: fallbackEmails,
      digests_sent: digestsSent,
      subscriptions_pruned: subscriptionsPruned,
      failed,
      dry_run: transport.dryRun,
    })
  } catch (error) {
    const code = error instanceof Error ? error.message : 'notify_tick_failed'
    console.error('notify-tick failed', code.slice(0, 80))
    return Response.json({ error: 'Notification tick failed' }, { status: 500 })
  }
})

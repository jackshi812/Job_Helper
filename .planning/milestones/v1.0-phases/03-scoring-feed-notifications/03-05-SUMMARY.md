---
phase: 03-scoring-feed-notifications
plan: 05
subsystem: notifications-dispatcher
tags: [notifications, web-push, resend, quiet-hours, dst, skip-locked, idempotency, rls, edge-functions]
status: complete

requires:
  - phase: 03-scoring-feed-notifications (Plan 03)
    provides: "user_jobs table (0019) with score/tier/status='scored'/scored_at/dismissed_at; claim SKIP LOCKED precedent"
  - phase: 03-scoring-feed-notifications (Plan 01)
    provides: "preferences table (0017) with notify_threshold/quiet_start/quiet_end/digest_time/timezone"
provides:
  - "supabase/migrations/0020_notifications.sql — push_subscriptions + notifications (unique(user_id,job_id,channel), claimed/retry_at/attempts), claim_notifications SKIP LOCKED RPC (service_role), preferences.last_digest_date, notify-tick cron, delete_my_data replacement (LOCAL FILE ONLY, not pushed)"
  - "supabase/functions/_shared/quiet-hours.ts — pure DST-safe quietHoursState / userLocalMinutes / userLocalDate / digestDue"
  - "supabase/functions/_shared/webpush.ts — Deno @negrel/webpush@0.5.0 wrapper sendPush -> sent|gone|failed"
  - "supabase/functions/notify-tick/index.ts — enqueue -> claim -> quiet-gate -> collapse -> push -> fallback -> digest dispatcher"
  - "web/tests/quiet-hours.test.ts — 18 fixtures incl. both 2026 DST boundaries as exact UTC instants"
affects:
  - "Plan 06 (Settings ▸ Notifications UI edits threshold/quiet-hours/digest-time; push subscribe writes push_subscriptions)"
  - "Plan 07 (pushes 0020 to hosted DB, deploys notify-tick, sets VAPID_KEYS/RESEND_API_KEY/RESEND_FROM/SITE_URL, proves live push + digest via the dry-run and real paths)"

tech-stack:
  added:
    - "@negrel/webpush@0.5.0 (JSR, Deno-only edge import)"
    - "Resend REST (plain fetch, Idempotency-Key header) — no SDK"
  patterns:
    - "claim_notifications SKIP LOCKED mirrors claim_due_companies (0008)/claim_scoring_work (0019): a tick OWNS rows (status 'claimed') before any external send, so concurrent ticks never double-SEND (F3)"
    - "Terminal-only 'failed' status: transient push/Resend failures stay 'queued' with a future retry_at; only dead-endpoint (410/404 'gone') or attempts>=5 mark 'failed' (F4)"
    - "Pure Intl.DateTimeFormat time math (no UTC-offset arithmetic) keeps quiet-hours/digest DST-correct across both 2026 transitions"
    - "Confirmed-success-only bookkeeping: last_digest_date + digest rows advance ONLY after a 2xx Resend response; Idempotency-Key dedups across a crash"
    - "Dry-run transport (x-notify-dry-run / NOTIFY_DRY_RUN) exercises the full claim/status path with zero real push/email sends (F6)"

key-files:
  created:
    - supabase/migrations/0020_notifications.sql
    - supabase/functions/_shared/quiet-hours.ts
    - supabase/functions/_shared/webpush.ts
    - supabase/functions/notify-tick/index.ts
    - web/tests/quiet-hours.test.ts
  modified: []

key-decisions:
  - "notifications.status 'failed' is TERMINAL and reserved for permanent errors (410/404 gone or attempts>=5); every transient push/Resend failure keeps the row 'queued' with retry_at so a flaky provider never permanently suppresses a notification (Codex F4)"
  - "claim_notifications(p_channel, batch_size) claims a whole channel's queued batch with FOR UPDATE SKIP LOCKED and bumps attempts in the same statement, so ownership + the retry budget are enforced atomically before any send (Codex F3)"
  - "Quiet-hours releases the claim untouched (status back to 'queued', claimed_at null) — no send, no status->sent/failed — so queued Strong matches fire as ONE combined push at window end (D-19)"
  - "Company label for push/digest copy comes from companies.name via jobs.company_id; null company_id (e.g. Adzuna) falls back to 'Company' rather than enumerating jobs.source (RESEARCH Pitfall 8)"
  - "delete_my_data() omits resume_extracts because it dies via the FK cascade from resumes; explicitly documented in a comment (AUTH-04)"

requirements: [NOTF-01, NOTF-02, NOTF-03, NOTF-04]

coverage:
  - id: R1
    description: "Strong matches (score >= threshold) trigger ONE burst-collapsed push per tick per user; everything else waits for the daily digest (D-18, NOTF-01)"
    requirement: "NOTF-01"
    verification:
      - kind: other
        ref: "grep: enqueuePush filters status='scored' & score>=threshold; collapsePayload emits single 'Strong match: {title}' or '{n} strong matches'; only score>=threshold rows get 'push' rows, digest is a separate channel"
        status: pass
    human_judgment: true
    rationale: "Real push delivery to a browser push service requires VAPID_KEYS + deploy; observable only on the hosted runtime (Plan 07). Local proof is composition + copy-contract shape."
  - id: R2
    description: "Quiet-hours Strong matches queue and fire as one combined push at window end; transient failures retryable (D-19, NOTF-03, F4)"
    requirement: "NOTF-03"
    verification:
      - kind: tests
        ref: "web/tests/quiet-hours.test.ts (18 tests incl. both 2026 DST instants); grep: quiet branch sets status 'queued'/claimed_at null with no send; transient branch sets retry_at + 'push_retry'"
        status: pass
    human_judgment: false
  - id: R3
    description: "claim_notifications SKIP LOCKED prevents double-SEND across concurrent ticks (Codex F3)"
    requirement: "NOTF-04"
    verification:
      - kind: other
        ref: "grep: 0020 claim_notifications has 'for update skip locked', service_role-only execute; notify-tick calls rpc('claim_notifications') before any sendPush/Resend"
        status: pass
    human_judgment: true
    rationale: "Concurrency non-double-SEND is a runtime property provable only with two live overlapping ticks against a real DB (Plan 07 dry-run verifier)."
  - id: R4
    description: "One daily digest of Strong+Good matches with a Resend Idempotency-Key; last_digest_date advances only on confirmed 2xx; individual fallback only when a Strong push is terminally undeliverable (D-20, NOTF-02, F4)"
    requirement: "NOTF-02"
    verification:
      - kind: other
        ref: "grep: digest uses Idempotency-Key 'digest-{userId}-{localDate}'; last_digest_date + digest rows written only inside the 2xx branch; sendFallbackEmail called only on the terminal-undeliverable push branch"
        status: pass
    human_judgment: true
    rationale: "Live Resend send + 2xx bookkeeping requires RESEND_API_KEY + verified sender; deferred to Plan 07."
  - id: R5
    description: "UNIQUE (user_id, job_id, channel) makes double-notify structurally impossible (NOTF-04)"
    requirement: "NOTF-04"
    verification:
      - kind: other
        ref: "grep: 0020 notifications 'unique (user_id, job_id, channel)'; all enqueue/fallback/digest inserts use onConflict do-nothing on that key"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-07-19
---

# Phase 3 Plan 05: Notification Dispatcher Vertical Slice Summary

**A per-minute `notify-tick` dispatcher that turns scored `user_jobs` rows into exactly-once notifications: it enqueues one `push` row per Strong match (structurally deduped by `unique (user_id, job_id, channel)`), atomically claims a batch via a `claim_notifications` SKIP LOCKED RPC before any send, releases the claim untouched during DST-correct quiet hours, burst-collapses awake-window matches into one push per subscription, prunes dead endpoints and falls back to a collapsed email only when push is terminally undeliverable, and sends one Resend digest per day with an Idempotency-Key whose `last_digest_date` advances only on a confirmed 2xx — with a dry-run transport that exercises the whole bookkeeping path without touching a push service or Resend.**

## Performance

- **Duration:** ~12 min
- **Tasks:** 3 (Task 1 auto, Task 2 TDD, Task 3 auto)
- **Files created:** 5 · **Files modified:** 0

## Must-Have Verification

| Must-have | Evidence |
|-----------|----------|
| Strong matches → ONE burst-collapsed push per tick per user; everything else waits for the daily digest (D-18, NOTF-01) | `enqueuePush` inserts a `push` row only for `status='scored'` rows at/above `coalesce(notify_threshold,75)`; `collapsePayload` emits a single `Strong match: {title}` (1 row) or `{n} strong matches` (many) per user; Good-only matters land in the separate `digest` channel |
| Quiet-hours queue + combined release; transient failures retryable (D-19, NOTF-03, F4) | quiet branch sets rows back to `status='queued'`, `claimed_at=null` with **no send**; DST-safe `quietHoursState` proven by 18 tests incl. `2026-03-08T11:59:00Z` (spring-forward 06:59 → quiet) and `2026-11-01T12:59:00Z` (fall-back 06:59 → quiet); transient push failure → `retry_at=now()+5m`, `error_code='push_retry'`, never terminal |
| `claim_notifications` SKIP LOCKED prevents double-SEND (F3) | `0020` RPC: `for update skip locked`, `set status='claimed', claimed_at=now(), attempts=attempts+1`, `grant execute ... to service_role`; notify-tick calls `rpc('claim_notifications', { p_channel:'push', batch_size:50 })` **before** any `transport.push`/Resend call |
| One daily digest w/ Idempotency-Key; last_digest_date only on 2xx; fallback only on terminal-undeliverable push (D-20, NOTF-02, F4) | digest uses header `Idempotency-Key: digest-${userId}-${localDate}`; `last_digest_date` + `digest` rows written **only inside** the `status>=200 && <300` branch; `sendFallbackEmail` invoked only on the `noSubscriptions || allGone || attemptsExhausted` push branch; per-tick email cap 20 (`email_cap_reached`) |
| UNIQUE (user_id, job_id, channel) makes double-notify impossible (NOTF-04) | `0020` `unique (user_id, job_id, channel)`; every insert (`push`/`email`/`digest`) uses `onConflict:'user_id,job_id,channel', ignoreDuplicates:true` |
| Files/exports exactly per plan frontmatter | `0020_notifications.sql` (push_subscriptions, notifications w/ claimed/retry_at/attempts, `claim_notifications`, `last_digest_date`, notify-tick cron, `delete_my_data`), `quiet-hours.ts` (`quietHoursState`/`userLocalDate`/`userLocalMinutes` + `digestDue`), `web/tests/quiet-hours.test.ts`, `webpush.ts` (`sendPush`), `notify-tick/index.ts` (contains `Idempotency-Key`) — all present |

## Local Gate Results (exact numbers)

- `cd web && npm run build` (tsc -b + vite) — **green** (only the pre-existing >500 kB chunk advisory; not introduced here).
- `cd web && npx vitest run tests/quiet-hours.test.ts` — **1 file, 18 tests passed** (incl. both 2026 DST boundaries as exact UTC instants).
- `cd web && npx vitest run` — **27 files, 366 tests passed** (Plan-04 baseline 26/348; +1 file `quiet-hours.test.ts`, +18 tests).
- `cd web && npm run lint` (oxlint) — **green**; sole warning is the pre-existing `AuthProvider.tsx:120` (out of scope, untouched).
- Migration/dispatcher greps: `unique (user_id, job_id, channel)` ✓, `for update skip locked` ✓, `claim_notifications ... to service_role` ✓, `endpoint text not null unique` ✓, 4 `push_subscriptions_*_own` policies ✓, `last_digest_date date` ✓, `x-cron-secret` ✓, `rpc('claim_notifications'` ✓, `Idempotency-Key` ✓, `x-notify-dry-run`/`NOTIFY_DRY_RUN` ✓, `htmlEscape` ✓, `attempts >= 5` ✓.

## Task Commits

1. **Task 1 — 0020 notifications schema + claim RPC + cron + delete_my_data** — `33004d9` (feat)
2. **Task 2 — quiet-hours RED fixtures** — `724041d` (test); **quiet-hours + webpush GREEN** — `c9314ef` (feat)
3. **Task 3 — notify-tick dispatcher** — `52561c9` (feat)

## Deviations from Plan

None — plan executed exactly as written.

### Implementation note (within-task, not a plan deviation)

- **Digest job-info loading.** An initial pass wired `processDigestUser` to a job-info map that was never populated, which would have produced an empty digest table with a `0 new job matches` subject. Caught and fixed before the Task 3 commit by loading job title/company/apply-url inside `processDigestUser` via the shared `loadJobInfo` helper. No plan scope change; the committed code loads real job data.

## Authentication Gates

None. All work is local code + unit tests; no live push, email send, deploy, or edge-secret set was attempted (per the plan's autonomous-local-only boundary).

## Safety Boundary Compliance

- Migration written as a **FILE ONLY** at the pinned path `0020_notifications.sql` (exact number 0020, no OFFSET); no `supabase db push`, no edge deploy, no edge-secret set, no live push/email send.
- `poll-tick/index.ts`, `score-tick/index.ts`, `_shared/lifecycle.ts`, and 02.1-owned files were read as skeletons/patterns only, never edited. No `jobs.source` value enumerated anywhere.
- `notify-tick` is claim-isolated: it claims from `notifications` via `claim_notifications` and never touches `claim_scoring_work`/`claim_due_companies` or the jobs pipeline.
- ASVS V7: logs carry only bounded machine codes (`push_send_failed`, `resend_http_429`, `digest_send_failed`, `email_cap_reached`) + truncated UUID prefixes + counters — never subscription endpoints, email bodies, JD text, or resume content.
- Left `.DS_Store`, `scripts/agent-dashboard.mjs`, `scripts/agent-dashboard.test.mjs` untracked/unstaged; did not edit `STATE.md`.

## Known Stubs

None. Every branch writes real data; the only non-send paths are the intentional dry-run transport (F6) and the "no RESEND_API_KEY configured" guard, which returns a transient (retryable) status rather than crashing the tick — both by design pending Plan 07 secrets.

## Issues Encountered

None. RED confirmed before implementing quiet-hours; local gate green on the first full run after the within-task digest fix.

## Next Phase Readiness

- **Ready for Plan 06 (Settings ▸ Notifications):** `push_subscriptions` (own-row CRUD, unique endpoint) is ready for the browser subscribe flow; `preferences` already carries threshold/quiet-hours/digest-time for the tuning UI.
- **Deferred to Plan 07 (hosted delivery proof):** push 0020 to the hosted DB, deploy `notify-tick`, set edge secrets `VAPID_KEYS`, `RESEND_API_KEY`, `RESEND_FROM`, `SITE_URL`, and prove — via the dry-run transport first, then a real send — claim atomicity (no double-SEND), quiet-hours combined release, terminal-vs-transient retry bookkeeping, digest Idempotency-Key + confirmed-2xx `last_digest_date` advance, and email-fallback-only-on-terminal-push. **Live push/email delivery proof requires the Resend key + VAPID keypair + deploy and is intentionally deferred to Plan 07** — no live external send was performed here.

## Self-Check: PASSED

All 5 created artifacts exist on disk (`0020_notifications.sql`, `_shared/quiet-hours.ts`, `_shared/webpush.ts`, `notify-tick/index.ts`, `web/tests/quiet-hours.test.ts`); all four task commits (`33004d9`, `724041d`, `c9314ef`, `52561c9`) are present in git log; local gate (build + 366 tests + lint) is green.

---
*Phase: 03-scoring-feed-notifications*
*Completed: 2026-07-19*

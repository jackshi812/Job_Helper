# Architecture Research

**Domain:** Job-discovery + alerting + AI resume-tailoring web app (2 users, free-tier: Cloudflare Pages + Supabase Free)
**Researched:** 2026-07-15
**Confidence:** MEDIUM-HIGH (platform limits verified against official Supabase docs; pipeline shape cross-checked across multiple independent sources)

## Standard Architecture

Job-monitoring/alerting systems converge on the same pipeline shape regardless of scale: **source pollers → normalizer → dedupe → cheap filter → enrichment/scoring → notifier**, with a database as the state spine between stages. This project adds a second, fully independent subsystem (resume tailoring) that is request-driven rather than scheduled.

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  FRONTEND — Cloudflare Pages (static SPA + service worker)           │
│  ┌──────────┐ ┌───────────┐ ┌─────────┐ ┌──────────┐ ┌───────────┐   │
│  │Dashboard │ │Prefs +    │ │Resumes  │ │Tailoring │ │Application│   │
│  │(matches) │ │Watchlist  │ │(DOCX)   │ │Review UI │ │Tracker    │   │
│  └────┬─────┘ └────┬──────┘ └───┬─────┘ └────┬─────┘ └────┬──────┘   │
│       │  supabase-js (auth, RLS reads/writes, Storage)    │          │
├───────┴────────────┴────────────┴────────────┴────────────┴──────────┤
│  SUPABASE — Postgres (state spine) + Auth + Storage + Vault          │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │ jobs (global, deduped) · user_job_matches (per-user, RLS)   │     │
│  │ watchlist_companies · preferences · push_subscriptions      │     │
│  │ resumes (metadata) · tailoring_sessions · applications      │     │
│  └─────────────────────────────────────────────────────────────┘     │
│  pg_cron ──net.http_post──▶ Edge Functions (Deno)                    │
│  ┌───────────┐  ┌──────────────┐  ┌────────┐  ┌───────────────┐      │
│  │ poll-jobs │─▶│score-matches │─▶│ notify │  │ tailor-resume │      │
│  │ (ingest)  │  │ (AI, capped) │  │        │  │ (on-demand)   │      │
│  └─────┬─────┘  └──────┬───────┘  └───┬────┘  └───────┬───────┘      │
├────────┼───────────────┼──────────────┼───────────────┼──────────────┤
│  EXTERNAL                                                            │
│  Greenhouse/Lever/Ashby JSON · Aggregator API │ LLM API │ Push       │
│  (keyless public endpoints)                   │ (cheap)  │ services  │
│                                                          │ + Resend  │
└──────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Frontend SPA | Auth UI, dashboard feed, prefs/watchlist CRUD, resume upload, tailoring diff review, tracker table | Static SPA on Cloudflare Pages; talks to Supabase directly via supabase-js under RLS |
| Service worker | Receives web push while tab is closed; shows OS notification with deep link | `sw.js` registered by SPA; stores `PushSubscription` in `push_subscriptions` table |
| Scheduler | Fires pipeline stages on intervals | `pg_cron` (min interval 1 min, free tier) + `pg_net` `http_post` to Edge Function URLs; secrets in Vault |
| `poll-jobs` (ingest) | Fetch all watchlist ATS endpoints + aggregator, normalize, dedupe-insert, run cheap filter, enqueue matches | Edge Function; ACK immediately, work in `EdgeRuntime.waitUntil` background task |
| Source adapters | One module per source type mapping raw payload → canonical `JobPosting` | `greenhouse.ts`, `lever.ts`, `ashby.ts`, `aggregator.ts` in `_shared/` |
| Dedupe layer | Guarantee a posting enters the pipeline exactly once | `UNIQUE(source, external_id)` + `INSERT … ON CONFLICT DO NOTHING RETURNING *` — returned rows *are* the "new jobs" signal |
| Cheap filter | Title/location/keyword match against each user's prefs; zero AI cost | SQL or in-function JS; survivors become `user_job_matches` rows with `status='pending_score'` |
| `score-matches` (AI scorer) | Score pending matches against user prefs + resume summary; write score + reasons | Edge Function on its own cron; cheap LLM; daily budget counter enforced before calling |
| `notify` | Push + email for scored matches above threshold; mark notified | `@negrel/webpush` (Deno-native VAPID) + Resend HTTP API; delete dead subscriptions on 404/410 |
| `tailor-resume` | Parse DOCX, propose keyword edits, apply approved edits, produce PDF | On-demand Edge Function(s), completely decoupled from the monitoring pipeline |
| Postgres | Single source of truth AND the queue between stages | Status columns as pipeline state machine; RLS for per-user isolation |
| Storage | Resume DOCX/PDF files, private per-user | Supabase Storage bucket with per-user folder policies |

## Recommended Project Structure

```
/
├── src/                          # Cloudflare Pages frontend
│   ├── routes/ (or pages/)       # dashboard, prefs, resumes, tailor, tracker
│   ├── components/
│   ├── lib/
│   │   ├── supabase.ts           # client init
│   │   └── push.ts               # subscription registration
│   └── sw.ts                     # service worker (push handler)
├── supabase/
│   ├── migrations/               # schema, RLS policies, cron.schedule() calls
│   ├── functions/
│   │   ├── _shared/
│   │   │   ├── adapters/         # greenhouse.ts, lever.ts, ashby.ts, aggregator.ts
│   │   │   ├── types.ts          # canonical JobPosting shape
│   │   │   └── db.ts             # service-role client helpers
│   │   ├── poll-jobs/            # ingest stage
│   │   ├── score-matches/        # AI stage
│   │   ├── notify/               # push + email stage
│   │   └── tailor-resume/        # on-demand tailoring
│   └── config.toml
└── package.json
```

### Structure Rationale

- **`supabase/functions/_shared/adapters/`:** Source heterogeneity is the main growth axis (new ATS types, HTML fallback later). One file per source with a common `fetchPostings(company) → JobPosting[]` signature keeps additions cheap and testable in isolation.
- **Pipeline stages as separate functions:** Each stage has different failure modes (network flake vs LLM outage vs push service errors). Separate functions + DB status columns mean a scoring outage never blocks ingestion, and every stage is independently retryable and observable.
- **`migrations/` owns cron registration:** `cron.schedule()` calls live in SQL migrations so the schedule is versioned with the schema, not clicked together in a dashboard.

## Architectural Patterns

### Pattern 1: Postgres as the Pipeline Queue (status-column state machine)

**What:** Jobs and matches carry a `status` column (`new → pending_score → scored → notified` / `failed`). Each cron-fired stage claims rows in its input status, processes, and advances the status. No external queue.
**When to use:** Modest throughput (this app: dozens of new postings/day, 2 users). Postgres-as-queue is fine up to 1K–10K jobs/sec — five orders of magnitude above this workload.
**Trade-offs:** Maximally simple and observable (queue state is a `SELECT`); everything transactional. `SELECT FOR UPDATE SKIP LOCKED` is only needed if stages ever run concurrently with themselves — at this scale a plain `UPDATE … WHERE status = X` claim is enough. Supabase Queues (pgmq) exists if visibility timeouts are ever wanted, but is overkill here.

**Example:**
```sql
-- score-matches stage claims its work
UPDATE user_job_matches
SET status = 'scoring', claimed_at = now()
WHERE status = 'pending_score'
RETURNING id, job_id, user_id;
-- ...call LLM, then: SET status='scored', score=…, reasons=…
```

### Pattern 2: ACK-fast + background task (the pg_net timeout dodge)

**What:** `pg_net` HTTP calls from cron have short timeouts (~5s reported in Supabase discussions). The Edge Function returns `200` immediately and does the real work in `EdgeRuntime.waitUntil()`, which keeps running up to the 150s free-tier wall clock.
**When to use:** Every cron-invoked function in this system. Non-negotiable — without it, poll cycles get killed mid-run.
**Trade-offs:** Cron can't see success/failure from the HTTP response; write a `pipeline_runs` row (started/finished/counts/errors) inside the task for observability instead.

**Example:**
```typescript
Deno.serve((req) => {
  EdgeRuntime.waitUntil(runPollCycle()); // fetch 100+ sources, dedupe, filter
  return new Response("accepted", { status: 202 }); // ACK before pg_net times out
});
```

### Pattern 3: Global jobs, per-user matches (fan-out at the filter)

**What:** Postings are stored once in a global `jobs` table (no RLS needed, or read-only policy). Per-user state lives in `user_job_matches` (score, reasons, notified, tracker stage) with strict RLS on `user_id`. The cheap filter is the fan-out point: one new job row → 0–2 match rows.
**When to use:** Any multi-user monitor watching overlapping sources.
**Trade-offs:** Both users watching the same company costs one fetch and one job row, not two. Per-user isolation lives exactly where user data lives. Slightly more join work on the dashboard query — irrelevant at this size.

### Pattern 4: Dedupe at the unique index, detect "new" from the insert

**What:** `UNIQUE(source, external_id)` on `jobs` (Greenhouse/Lever/Ashby all provide stable IDs). Ingest does `INSERT … ON CONFLICT (source, external_id) DO NOTHING RETURNING *` — the returned rows are precisely the never-seen-before postings, making every poll run idempotent. For the aggregator (cross-source dupes of watchlist jobs), add a `content_hash` column (normalized `company|title|location`) and skip aggregator rows whose hash already exists from an ATS source — the ATS copy is fresher and canonical.
**When to use:** Always; this is the industry-standard shape (set-membership dedupe keyed on stable ID, hash fallback where IDs are unstable).
**Trade-offs:** Hash-based cross-source dedupe has false-negative risk (title reworded); acceptable — worst case is one duplicate notification, and cheap-filter + AI score run on it anyway.

## Data Flow

### Monitoring flow (poll → notification)

```
pg_cron (*/5 min)
    ↓ net.http_post (Vault-stored URL + key)
poll-jobs Edge Fn  ── 202 ACK immediately, then in waitUntil:
    ↓ fan out concurrent fetches (limit ~15 in flight)
Greenhouse/Lever/Ashby JSON + Aggregator API
    ↓ adapters normalize → JobPosting[]
INSERT jobs ON CONFLICT DO NOTHING RETURNING *   ← dedupe + new-detection
    ↓ for each new job × each user's prefs (cheap filter: title/loc/keywords)
INSERT user_job_matches (status='pending_score')
    ↓ pg_cron (*/1–2 min) → score-matches Edge Fn
LLM scores survivors (budget-capped) → status='scored', score, reasons
    ↓ pg_cron (*/1 min) → notify Edge Fn (or chained from scorer)
score ≥ threshold → Web Push (@negrel/webpush) + Resend email
    ↓ status='notified', notified_at set
Dashboard reads user_job_matches (RLS) — feed with scores + reasons
```

Latency budget vs the 5–15 min goal: poll every 5 min + score cron ≤2 min + notify ≤1 min ≈ **≤8 min worst case** from posting appearing on the ATS feed. The critical dependency is polling ATS endpoints directly — aggregators lag by hours and only serve discovery breadth, never the freshness SLA.

### Tailoring flow (fully independent of monitoring)

```
Upload DOCX → Supabase Storage (private, per-user path)
    ↓ user picks base resume + target job
tailor-resume Edge Fn: parse DOCX → LLM proposes keyword edits (JSON diff)
    ↓ stored in tailoring_sessions
Review UI: side-by-side diff → user approves/rejects each edit (mandatory)
    ↓ apply approved edits to DOCX structure → render PDF
Download PDF (and store artifact in Storage)
```

### Key Data Flows

1. **New-job detection:** the `RETURNING` clause of the dedupe insert is the event source — no separate "seen" table, no diffing.
2. **Notification exactly-once:** `notified_at` on the match row; notify stage only selects `status='scored' AND notified_at IS NULL`. Re-runs are harmless.
3. **Per-user isolation:** all user-scoped tables carry `user_id` + RLS; Storage policies scope files to `auth.uid()` folders; the `jobs` table is the only shared surface and contains no user data.
4. **Pipeline observability:** every cron-fired run writes a `pipeline_runs` row (stage, started, finished, fetched, inserted, errors) — this is how you debug a fire-and-forget pipeline.

## Suggested Build Order

Dependencies drive this ordering; the monitoring pipeline is the core value and needs the longest soak time to prove reliability.

1. **Foundation** — Supabase project, invite-only auth (2 users), schema + RLS policies, frontend shell with login. *Everything depends on this; RLS retrofitting later is painful.*
2. **Ingestion** — watchlist CRUD, source adapters (Greenhouse/Lever/Ashby first, aggregator second), `jobs` table + dedupe, cron + ACK-fast wiring, `pipeline_runs` logging, manual "run now" trigger for testing. *Build before anything downstream; let it soak against 100+ real sites while later phases proceed.*
3. **Filter + scoring** — preferences UI, cheap filter fan-out, `user_job_matches`, AI scorer with daily budget cap, dashboard feed with scores/reasons. *Depends on 2; the dashboard becomes usable here.*
4. **Notifications** — service worker + push subscription flow, `notify` stage with @negrel/webpush, Resend email fallback, threshold setting. *Depends on 3 (needs scores to gate on); this completes the core value loop.*
5. **Resume tailoring** — DOCX upload/Storage policies, parse → suggest → review → PDF pipeline. *Independent of 2–4; slots anywhere after 1, but sequenced after the core loop works.*
6. **Tracker + polish** — application stage tracking on match rows, tracker table view. *Trivial CRUD over existing tables; last.*

Research flags for the roadmap: phase 5 (DOCX parsing + PDF generation inside Deno edge constraints) is the highest-uncertainty area and warrants phase-level research; phase 2's aggregator choice needs a concrete API pick (STACK concern). Phases 1, 3, 4, 6 follow well-trodden Supabase patterns.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 2 users, ~100–150 sources (v1) | Everything above as-is. Single poll function handles 100+ concurrent JSON fetches in well under the 150s free wall clock (I/O-bound; 2s CPU limit is not a factor for JSON parsing at this volume). |
| ~500+ sources or HTML-scraping fallback | Shard polling: watchlist gets a `poll_group` column; cron fires the poll function per group in staggered minutes. HTML scraping may need Cloudflare Workers/Browser Rendering instead of edge functions. |
| Many users | Move cheap filter fan-out into SQL set operations; add `SKIP LOCKED` claims to stages; consider Supabase Queues (pgmq). Not a v1 concern by design. |

### Scaling Priorities

1. **First bottleneck:** Supabase Free 500MB database — the `jobs` table grows forever. Fix pre-emptively: nightly cron pruning jobs older than ~30 days with no linked match/application.
2. **Second bottleneck:** 150s wall clock if the watchlist balloons or sources get slow. Fix: poll groups + per-fetch timeout (e.g., 8s) so one dead site never eats the budget.
3. **Watch:** Supabase Free pauses projects after ~1 week of inactivity — cron activity itself counts as activity, but verify during the soak period.

## Anti-Patterns

### Anti-Pattern 1: Doing pipeline work in the HTTP response path

**What people do:** cron → pg_net → edge function fetches 100 sites before responding.
**Why it's wrong:** pg_net's short timeout (~5s) kills the request; the function is terminated mid-poll and the failure is silent.
**Do this instead:** ACK with 202 immediately, run the cycle in `EdgeRuntime.waitUntil`, log completion to `pipeline_runs`.

### Anti-Pattern 2: One monolithic poll-score-notify function

**What people do:** a single function doing everything each tick.
**Why it's wrong:** an LLM outage or push failure blocks ingestion; a mid-run crash loses new-job detection; no independent retries.
**Do this instead:** stage-per-function with status columns as handoff. Stages are individually rerunnable and idempotent.

### Anti-Pattern 3: AI scoring every posting

**What people do:** send all fetched postings to the LLM.
**Why it's wrong:** 100+ boards × full job lists = thousands of postings per day; blows any budget for zero value since most are obvious misses.
**Do this instead:** dedupe first (only *new* rows proceed), cheap title/location/keyword filter second, AI only on survivors — typically a handful per day. Enforce a hard daily AI call cap as a backstop.

### Anti-Pattern 4: Per-user copies of job postings

**What people do:** store each posting once per user who might see it.
**Why it's wrong:** duplicates storage and fetches, and makes dedupe user-relative.
**Do this instead:** global `jobs` table, per-user `user_job_matches`. Isolation belongs on user data, not on public postings.

### Anti-Pattern 5: Diff-based new-job detection

**What people do:** snapshot each board's full list and diff against the previous snapshot to find new jobs.
**Why it's wrong:** fragile ordering assumptions, extra state, breaks on partial fetch failures.
**Do this instead:** dedupe-insert with `RETURNING` — the database *is* the seen-set, and reruns are naturally idempotent.

### Anti-Pattern 6: Relying on the aggregator for freshness

**What people do:** treat the aggregator API as the primary source and ATS endpoints as supplemental.
**Why it's wrong:** aggregators index with hours-to-days lag; the 5–15 min goal dies.
**Do this instead:** ATS JSON endpoints are the freshness path for watchlist companies; the aggregator is breadth-only discovery outside the watchlist, with relaxed latency expectations.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Greenhouse | `GET api.greenhouse.io/v1/boards/{board}/jobs?content=true` | Keyless; returns all jobs in one call, no pagination; stable job IDs |
| Lever | `GET api.lever.co/v0/postings/{company}?mode=json` | Keyless; supports source-side filters (team, location, commitment) |
| Ashby | `GET api.ashbyhq.com/posting-api/job-board/{org}` | Keyless; `?includeCompensation=true` for salary data |
| Aggregator API (TBD in STACK) | Polled from same ingest stage via its own adapter | Expect lag; used for discovery breadth only; watch rate limits |
| LLM API | HTTPS from `score-matches` and `tailor-resume`; key in edge function secrets | Cheap model; hard daily call cap stored in DB |
| Web push services (FCM/Mozilla/Apple endpoints) | `@negrel/webpush` (Deno-native VAPID, RFC 8291/8292) | Node's `web-push` lib is not Deno-friendly; prune subscriptions on 404/410 |
| Resend | Plain HTTPS API from `notify` | Email is the offline fallback, not the primary channel |
| Supabase Vault | Stores project URL + key for pg_cron's `net.http_post` calls | Keeps secrets out of migration SQL |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Frontend ↔ Postgres | supabase-js under RLS | No custom API layer needed for CRUD; RLS is the authorization boundary |
| Frontend ↔ tailor-resume | Direct edge function invoke (authed) | Synchronous request/response; user waits with progress UI |
| cron ↔ edge functions | `pg_net` HTTP POST, fire-and-forget | ACK-fast pattern mandatory; observability via `pipeline_runs` table |
| Stage ↔ stage (poll/score/notify) | Status columns in Postgres only | No direct function-to-function calls; keeps stages independently retryable |
| Adapters ↔ ingest | In-process, common `JobPosting` interface | The seam for adding new source types (HTML fallback later) |
| Monitoring subsystem ↔ tailoring subsystem | None (share only auth + DB) | Deliberate: can be built, broken, and shipped independently |

## Sources

- [Supabase — Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions) (official, fetched) — MEDIUM-HIGH
- [Supabase — Edge Function Limits](https://supabase.com/docs/guides/functions/limits) (official, fetched: 150s free wall clock, 2s CPU, 256MB) — MEDIUM-HIGH
- [Supabase — Cron module](https://supabase.com/docs/guides/cron) / [pg_cron guidance](https://crontap.com/guides/supabase-cron-jobs) (1-min minimum, ≤8 concurrent jobs) — MEDIUM
- [Supabase discussion #37574 — pg_net ~5s timeout calling edge functions](https://github.com/orgs/supabase/discussions/37574) — MEDIUM
- [Supabase — Background Tasks (EdgeRuntime.waitUntil)](https://supabase.com/docs/guides/functions/background-tasks) — MEDIUM
- [Greenhouse Job Board API](https://developers.greenhouse.io/job-board.html) + [ATS public API surveys (cavuno)](https://cavuno.com/blog/ats-platforms-public-job-posting-apis), [fantastic.jobs](https://fantastic.jobs/article/ats-with-api) — MEDIUM (cross-checked)
- Job-alert pipeline shape: [olostep — Job Scraping: Build a Pipeline, Not a Bot](https://www.olostep.com/blog/job-scraping), [HackerNoon — Zero-Cost Daily Job Alert Pipeline](https://hackernoon.com/building-a-zero-cost-daily-job-alert-pipeline-on-github-actions) — MEDIUM (cross-checked)
- Postgres-as-queue: [dbpro — SKIP LOCKED one-liner queue](https://www.dbpro.app/blog/postgresql-skip-locked), [richyen — Consequences of Postgres as a Job Queue](https://richyen.com/postgres/2026/05/04/postgres_job_queue.html) — MEDIUM (cross-checked)
- Web push from Deno: [negrel/webpush](https://github.com/negrel/webpush), [Supabase push notification guide](https://supabase.com/docs/guides/functions/examples/push-notifications) — MEDIUM

---
*Architecture research for: job-discovery + AI resume-tailoring web app (Cloudflare Pages + Supabase Free)*
*Researched: 2026-07-15*

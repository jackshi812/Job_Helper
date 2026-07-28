# Phase 2: Watchlist Ingestion & Monitoring - Research

**Researched:** 2026-07-16
**Domain:** ATS polling (Greenhouse/Lever/Ashby), aggregator ingestion (Adzuna), dedup/snapshot pipeline, pg_cron scheduling, pipeline health monitoring
**Confidence:** HIGH (ATS shapes verified via live calls this session; the STATE.md MEDIUM-confidence blocker is closed)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Watchlist ownership
- **D-01:** Single shared global watchlist. Either user adds a company; polling runs once per company; both users receive matches from every watched company.
- **D-02:** Either user can add or remove any company, including ones the other added. No `added_by` attribution column.

#### Add flow & unsupported URLs
- **D-03:** Adding a company = paste any careers/job-board URL. The app auto-detects ATS + board slug from URL patterns, then verifies with one live API call to the detected board before saving.
- **D-04:** Unsupported ATS (anything other than Greenhouse/Lever/Ashby) or a failed verification call is rejected with a clear guidance message ("works with Greenhouse, Lever, Ashby" + how to find the supported board URL). The company is NOT saved — no "unsupported" placeholder rows, no per-company Adzuna fallback.

#### Health visibility
- **D-05:** Per-company health is a status badge on each watchlist row: OK / failing / stale, with last-success time on hover. No separate health/monitoring page.
- **D-06:** A company counts as "failing" after 3+ consecutive fetch errors.
- **D-07:** Whole-pipeline heartbeat: dashboard banner when the last successful poll is > 30 minutes old, PLUS an external dead-man's switch (e.g. cron-job.org) that checks a heartbeat endpoint and triggers one Resend email when the pipeline goes silent. External check is mandatory because a paused Supabase project cannot alert about itself.

#### Aggregator scope before preferences exist
- **D-08:** Adzuna discovery runs on hardcoded seed queries — 2–3 fixed queries per user (role keywords + location) stored as config/DB seed rows, editable via SQL. No throwaway preferences UI in Phase 2; the Phase 3 preferences UI replaces the seed as the query source.

### Claude's Discretion
- Polling shard layout across pg_cron ticks (per-minute round-robin slices per RESEARCH pattern)
- Dedup key design (URL vs source+external-id vs content hash)
- JD snapshot storage format and stale-close threshold specifics
- Watchlist table UI details (within Phase 1's D-15 clean minimal dense-table style)
- Heartbeat endpoint shape and banner copy

### Deferred Ideas (OUT OF SCOPE)
- Adzuna company-name fallback for unsupported-ATS companies — considered and rejected for Phase 2; revisit only if watchlist coverage proves too narrow
- Preferences UI for aggregator queries — explicitly Phase 3 (PREF-01)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PREF-02 | Add/edit/remove companies on a watchlist of 100+ career-site URLs | `companies` table schema + shared-table RLS pattern; watchlist page reuses Phase 1 dense-table + ConfirmDialog + TanStack Query patterns |
| PREF-03 | Auto-detect ATS platform from pasted URL and store polling endpoint | URL detection regex table (verified host patterns incl. Lever EU); live verification call via `verify-board` edge function; 404 error shapes verified live for all three ATSs |
| PREF-04 | Per-company monitoring health (last successful poll, failing flagged) | Health columns on `companies` (`last_success_at`, `consecutive_failures`, `last_error`); badge derivation rules (D-05/D-06) |
| DISC-01 | Poll watchlist ATS endpoints keeping discovery within 5–15 min | Per-minute pg_cron + due-queue sharding (10 companies/tick → each company every ~10 min); edge function limits verified (150s wall / 2s CPU) |
| DISC-02 | Discover jobs outside watchlist via one aggregator API | Adzuna search endpoint + params (cited from official docs); 250/day budget math → 45–60 min sweep cadence on seed queries (D-08) |
| DISC-03 | Deduplicate postings across sources | Two-layer dedup: unique `(source, external_id)` + normalized fingerprint (company\|title\|location) for reposts and aggregator overlap; ATS row wins |
| DISC-04 | JD snapshot at first sight | Greenhouse lean-list + per-new-job content fetch (verified live, 12x smaller polls); Lever/Ashby include full HTML in list; entity-decode Greenhouse content; Adzuna snapshots flagged partial (snippet only) |
| DISC-05 | Mark jobs closed when they disappear from polls | `last_seen_at` watermark updated on every successful poll; close only after successful polls (never on fetch failure); Adzuna-only jobs age out |
| DISC-06 | Pipeline heartbeat; dead cron detectable within one poll cycle | `pipeline_heartbeat` row written by the tick function itself (not pg_cron status); dashboard banner at >30 min; cron-job.org external monitor on a public heartbeat endpoint (D-07) |
</phase_requirements>

## Summary

The phase's biggest unknown — the exact JSON shapes of the Greenhouse, Lever, and Ashby public board APIs — was resolved this session with live calls against real boards (Stripe/Greenhouse, Palantir/Lever, Ramp/Ashby). All three endpoints work as CLAUDE.md described, with important specifics now pinned down: Greenhouse escapes JD HTML into entities and offers a per-job endpoint that makes lean polling 12x cheaper; Lever returns a bare array with epoch-millisecond timestamps and has an EU host variant; Ashby always ships full descriptions and has no lean mode. All three return clean 404s for invalid board slugs, which makes D-03's verify-before-save flow trivial.

The pipeline design follows the locked CLAUDE.md pattern: pg_cron fires a `poll-tick` edge function every minute; the function pulls the ~10 companies most overdue for polling (self-balancing due-queue, no static shard column), normalizes postings through per-ATS adapters, upserts against a two-layer dedup (exact source ID + normalized fingerprint for reposts/aggregator overlap), snapshots JDs at first insert, and advances `last_seen_at` watermarks that drive stale-closing. Adzuna sweeps run on their own slower cadence (45–60 min) against D-08 seed queries to stay inside 250 req/day. Health is written per company (D-05/D-06) and a single heartbeat row — written by the function itself, not inferred from pg_cron — feeds both the dashboard banner and an external cron-job.org monitor (D-07).

Two practical constraints shape the plan: Supabase Edge Functions on the free plan get 150s wall-clock but only **2s CPU** per invocation (verified), so per-tick batches must stay small and JSON parsing lean; and neither Docker nor Deno is installed on this machine, so edge functions cannot run locally — pure adapter/dedup logic should be unit-tested with Vitest and integration verified against the hosted project (the Phase 1 `scripts/` verification pattern).

**Primary recommendation:** Build three thin ATS adapters that normalize to one internal job shape (verified shapes below), schedule one per-minute `poll-tick` with a due-queue, dedup with `(source, external_id)` + open-job fingerprint, and write heartbeat/health from inside the function — then wire cron-job.org at the very end against the deployed heartbeat endpoint.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| ATS URL detection (pattern match) | Browser (SPA) | — | Pure string parsing; instant feedback while typing/pasting |
| Board verification live call (D-03) | API (Edge Function `verify-board`) | — | Avoids CORS uncertainty, keeps SSRF allowlist enforcement server-side, shares adapter code with poller |
| Watchlist CRUD | Database (RLS) + Browser | — | Direct supabase-js table access under shared-table RLS; no edge function needed |
| Polling, normalization, dedup, snapshots | API (Edge Function `poll-tick`) | Database (unique constraints) | Only compute surface on free plan; DB constraints are the dedup backstop |
| Scheduling | Database (pg_cron + pg_net + Vault) | — | Locked CLAUDE.md pattern; 1-min granularity |
| Aggregator sweep | API (Edge Function, Adzuna) | Database (seed_queries) | Separate cadence/budget from ATS polling |
| Per-company health state | Database (columns on `companies`) | Browser (badge derivation) | Written by poller; read by watchlist page |
| Pipeline heartbeat | API (writes) + Database (row) | External (cron-job.org) | Function writes truth; external monitor survives project pause (D-07) |
| Stale-close sweep | API (within `poll-tick`) | Database (`last_seen_at`) | Closing decisions need "poll succeeded" context only the function has |

## Standard Stack

### Core

No new frameworks. The phase runs entirely on the already-installed stack plus first edge functions:

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@supabase/supabase-js` | 2.110.7 (pinned, already in `web/package.json`) | Browser DB/auth client; edge functions import `npm:@supabase/supabase-js@2.110.7` | Already the project client; pin the exact same version in Deno imports [VERIFIED: npm registry] |
| Supabase Edge Functions (Deno) | hosted runtime | `poll-tick`, `verify-board`, `heartbeat`, Adzuna sweep | Only free compute surface; limits verified: 150s wall, 2s CPU, 256MB [CITED: supabase.com/docs/guides/functions/limits] |
| pg_cron + pg_net + Vault | Supabase-managed | Per-minute scheduling of edge functions with auth token from Vault | Locked CLAUDE.md pattern (HIGH) [CITED: supabase.com/docs/guides/functions/schedule-functions] |
| `@tanstack/react-query` | 5.101.2 (installed) | Watchlist data fetching/mutations | Established Phase 1 pattern (Resumes page) |
| Supabase CLI | 2.109.1 (installed as devDep) | `supabase functions deploy`, `supabase db push`, secrets | Already used in Phase 1 |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `he` | ^1.2.0 | Decode Greenhouse's HTML-entity-escaped JD content | In the Greenhouse adapter before storing snapshots; import as `npm:he@1.2.0` in Deno [VERIFIED: npm registry — 29.8M weekly downloads, mathiasbynens/he] |
| `pg_trgm` (Postgres extension) | Supabase built-in | Fuzzy title similarity for cross-source dedup fallback | Only if exact normalized-fingerprint matching proves too strict [ASSUMED — availability on Supabase widely documented, not enabled/tested this session] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Due-queue sharding (`order by last_polled_at limit N`) | Static `minute % 10` shard column | Static shards are simpler to reason about but rebalance poorly when companies are added/removed; due-queue self-balances and needs no shard bookkeeping |
| `he` for entity decode | Hand-rolled 5-entity replace | Greenhouse emits named AND numeric entities; `he` handles all of them for ~free |
| cron-job.org built-in failure email | Resend email fired by a checker | cron-job.org's own status notification works even when Supabase is paused (the exact failure D-07 targets); a Resend send requires the very infrastructure being monitored |
| Adzuna sweep inside `poll-tick` | Separate `discovery-sweep` function on its own cron | Separate function keeps the 250/day budget cadence independent from the 1-min ATS tick; strongly preferred |

**Installation:**
```bash
# No npm installs required in web/ — all deps already present.
# Edge functions (Deno) import via specifiers, no install step:
#   import { createClient } from "npm:@supabase/supabase-js@2.110.7";
#   import { decode } from "npm:he@1.2.0";
```

**Version verification:** `@supabase/supabase-js` 2.110.7 already pinned in `web/package.json`; `he` verified on npm (published 2018, 29.8M weekly downloads, no postinstall script) via the package-legitimacy seam this session.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `he` | npm | ~8 yrs (v1.2.0 2018) | 29.9M/wk | github.com/mathiasbynens/he | OK | Approved; no postinstall |
| `@supabase/supabase-js` | npm | latest release published 2026-07-16 (today) | 18.8M/wk | github.com/supabase/supabase-js | SUS (reason: `too-new` **latest release**, not a new package) | Already in use at pinned 2.110.7 from Phase 1. Do NOT bump to today's release in this phase; pin `npm:@supabase/supabase-js@2.110.7` in Deno imports to match `web/`. With the exact-version pin, no new install occurs — but per protocol the flag is recorded here and the planner may add a `checkpoint:human-verify` if it chooses to upgrade instead |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** `@supabase/supabase-js` (established package; flag is against the same-day latest release — mitigated by pinning the already-vetted 2.110.7)

## Architecture Patterns

### System Architecture Diagram

```
                     ┌──────────────────────── Supabase (free) ────────────────────────┐
                     │                                                                  │
 pg_cron '* * * * *' │  net.http_post(url, Authorization: <Vault token>)                │
        ─────────────┼──► poll-tick (Edge Fn) ──┬──► GET boards-api.greenhouse.io ─┐    │
                     │        │ due-queue:      ├──► GET api.lever.co / api.eu.…  ─┤    │
                     │        │ 10 most-overdue ├──► GET api.ashbyhq.com          ─┤    │
                     │        │ companies       │                                  │    │
                     │        ▼                 ▼                                  │    │
                     │   [per-ATS adapter → normalized Job]  ◄──── responses ──────┘    │
                     │        │                                                         │
                     │        ├─ new job?  ── dedup check ──► insert jobs + JD snapshot │
                     │        ├─ seen job? ──────────────────► update last_seen_at      │
                     │        ├─ poll OK?  ──────────────────► companies.last_success,  │
                     │        │                                reset consecutive_fails, │
                     │        │                                stale-close sweep        │
                     │        ├─ poll ERR? ──────────────────► consecutive_failures++   │
                     │        └─ always ─────────────────────► pipeline_heartbeat row   │
                     │                                                                  │
 pg_cron '*/45 …'    │                                                                  │
        ─────────────┼──► discovery-sweep (Edge Fn) ──► GET api.adzuna.com (seed        │
                     │         │                          queries, sort_by=date)        │
                     │         └─ fingerprint dedup vs ATS rows ──► insert or skip      │
                     │                                                                  │
  Browser SPA ───────┼──► supabase-js: companies CRUD (RLS), jobs/health reads          │
      │              │                                                                  │
      │ paste URL    │                                                                  │
      └──────────────┼──► verify-board (Edge Fn) ──► 1 live GET to detected board       │
                     │         └─ 200 → save row │ 404/unsupported → guidance msg (D-04)│
                     │                                                                  │
 cron-job.org ───────┼──► heartbeat (Edge Fn, public+secret) ─► 200 fresh / 503 stale   │
   (external,        │         reads pipeline_heartbeat                                 │
    emails on fail)  └──────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
supabase/
├── migrations/
│   └── 0005_watchlist_pipeline.sql   # companies, jobs, seed_queries, pipeline_heartbeat, RLS, pg_cron schedules
└── functions/
    ├── _shared/
    │   ├── adapters/                 # greenhouse.ts, lever.ts, ashby.ts, adzuna.ts → NormalizedJob
    │   ├── detect.ts                 # URL → {ats, slug, endpoint} (also used by verify-board)
    │   └── dedup.ts                  # fingerprint normalization (pure, unit-testable)
    ├── poll-tick/index.ts
    ├── discovery-sweep/index.ts
    ├── verify-board/index.ts
    └── heartbeat/index.ts
web/src/pages/Watchlist.tsx           # replace stub: dense table + add form + health badges
```

Keep adapters/detect/dedup as **pure TypeScript with no Deno-specific APIs** so they can be unit-tested by Vitest from `web/` (Docker/Deno are not available locally — see Environment Availability).

### Pattern 1: Verified ATS response shapes and adapter mapping

All three verified with LIVE calls on 2026-07-16. [VERIFIED: live API calls — Stripe (Greenhouse, 527 jobs), Palantir (Lever), Ramp (Ashby, 127 jobs)]

**Greenhouse** — `GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs` → `{ jobs: [...], meta: { total } }`

| Field | Type / Example | Adapter use |
|-------|----------------|-------------|
| `id` | int, `7954688` | `external_id` (stable posting id) |
| `title` | string | title |
| `first_published` | ISO w/ offset `"2026-06-02T08:58:57-04:00"` | `posted_at` |
| `updated_at` | ISO w/ offset | change detection |
| `absolute_url` | `"https://stripe.com/jobs/search?gh_jid=7954688"` | apply link |
| `location.name` | `"San Francisco, CA"` | location |
| `company_name`, `departments[]`, `offices[]`, `internal_job_id`, `requisition_id`, `metadata`, `language`, `application_deadline` | present | optional metadata |
| `content` | **HTML-entity-escaped HTML string** (`&lt;h2&gt;…`) — only with `?content=true` or on the single-job endpoint | JD snapshot after `he.decode()` |

- List **without** `content=true`: 313 KB for 527 jobs. With: 3.9 MB. Single-job endpoint `GET /v1/boards/{token}/jobs/{id}` returns full `content` (~6 KB) → **poll lean list, fetch content only for NEW jobs** (12x cheaper, and dodges the 2s CPU cap).
- Invalid board: HTTP 404 `{"status":404,"error":"Job not found"}`.
- JD HTML entity escaping is documented behavior. [CITED: developers.greenhouse.io/job-board.html]

**Lever** — `GET https://api.lever.co/v0/postings/{site}?mode=json` → **bare array** (no wrapper)

| Field | Type / Example | Adapter use |
|-------|----------------|-------------|
| `id` | UUID string | `external_id` |
| `text` | string | title (yes, the title field is `text`) |
| `createdAt` | **epoch milliseconds** `1711403416463` | `posted_at` (no `updated_at` exists) |
| `hostedUrl` / `applyUrl` | jobs.lever.co URLs | apply link |
| `categories` | `{ commitment, location, team, allLocations[] }` | location = `categories.location` |
| `country`, `workplaceType` | `"GB"`, `"hybrid"` | metadata |
| `description`, `descriptionPlain`, `descriptionBody(+Plain)`, `opening(+Plain)`, `additional(+Plain)`, `lists[{text, content}]` | HTML strings, always included | JD snapshot: `description` + rendered `lists` + `additional` |

- Server-side filters supported: `limit`, `skip`, `team`, `location`, `commitment`, `mode`.
- EU-hosted accounts answer on `https://api.eu.lever.co/v0/postings/{site}` (boards at `jobs.eu.lever.co`). [CITED: github.com/lever/postings-api README]
- Invalid site: HTTP 404 `{"ok":false,"error":"Document not found"}`.

**Ashby** — `GET https://api.ashbyhq.com/posting-api/job-board/{name}?includeCompensation=true` → `{ jobs: [...], apiVersion }`

| Field | Type / Example | Adapter use |
|-------|----------------|-------------|
| `id` | UUID string | `external_id` |
| `title` | string (may have leading whitespace — trim) | title |
| `publishedAt` | ISO `"2026-04-07T17:12:35.753+00:00"` | `posted_at` (no `updated_at` exists) |
| `jobUrl` / `applyUrl` | jobs.ashbyhq.com URLs | apply link |
| `location`, `secondaryLocations[]`, `isRemote`, `workplaceType`, `address` | present | location |
| `department`, `team`, `employmentType` | `"Engineering"`, `"FullTime"` | metadata |
| `isListed` | boolean | **filter `isListed === true`** |
| `descriptionHtml`, `descriptionPlain` | always included (no lean mode) | JD snapshot (already unescaped) |
| `compensation` | `{ compensationTierSummary, scrapeableCompensationSalarySummary, compensationTiers, summaryComponents }` | optional comp data |

- Ramp board: 127 jobs = 2.25 MB (descriptions always included).
- Invalid board: HTTP 404, plain-text body `Not Found` (not JSON — don't `res.json()` before checking status).

**Adzuna** — `GET https://api.adzuna.com/v1/api/jobs/{country}/search/{page}?app_id=…&app_key=…` [CITED: developer.adzuna.com/docs/search + /overview]

- Confirmed params from official docs examples: `what`, `what_exclude`, `where`, `sort_by`, `results_per_page`, `salary_min`, `full_time`, `permanent`, `content-type=application/json`. `max_days_old` exists [ASSUMED — seen in secondary sources; full param list is behind the registration-gated interactive docs].
- Result fields: `id`, `title`, `description` (**explicitly a snippet, not the full JD** — official docs: "we currently only provide a snipped of the job description"), `created`, `redirect_url` (Adzuna tracking redirect, not the employer URL), `company.display_name`, `location {area[], display_name}`, `salary_min/max`, `salary_is_predicted`, `category {label, tag}`, `contract_type`, `contract_time`, `latitude`, `longitude`.
- Recommended sweep call: `sort_by=date&max_days_old=1&results_per_page=50&what=<seed>&where=<seed>`.
- **Budget math:** ~6 seed queries (2–3 per user × 2 users, D-08) per sweep; 250 req/day free [ASSUMED — CLAUDE.md MEDIUM] → sweep every 45–60 min (192–144 req/day) with headroom for retries. DISC-02 explicitly does not guarantee latency for the aggregator path.

### Pattern 2: ATS auto-detection (D-03)

Detect from URL host+path; **never fetch the user-supplied URL itself** (SSRF — see Security Domain). Construct the API URL from an allowlisted host + validated slug:

| Pasted URL matches | ATS | Poll endpoint |
|--------------------|-----|---------------|
| `boards.greenhouse.io/{token}` or `job-boards.greenhouse.io/{token}` | greenhouse | `https://boards-api.greenhouse.io/v1/boards/{token}/jobs` |
| `greenhouse.io/embed/job_board?for={token}` | greenhouse | same |
| `jobs.lever.co/{site}` | lever | `https://api.lever.co/v0/postings/{site}?mode=json` |
| `jobs.eu.lever.co/{site}` | lever (EU) | `https://api.eu.lever.co/v0/postings/{site}?mode=json` |
| `jobs.ashbyhq.com/{name}` | ashby | `https://api.ashbyhq.com/posting-api/job-board/{encodeURIComponent(name)}` |
| anything else (company's own careers domain, Workday, etc.) | unsupported | Reject with D-04 guidance |

Slug validation: `^[A-Za-z0-9_-]+$` for Greenhouse/Lever; Ashby board names can contain spaces/unicode in the wild — accept the path segment, URL-encode it, but still restrict to a single path segment (no `/`, `?`, `#`). Store the detected `ats_type` + `board_token` (+ `region` for Lever EU), not the raw endpoint string, so endpoint construction stays in one audited function.

Verification call (D-03): run in the `verify-board` edge function (avoids browser CORS uncertainty, reuses adapters). 200 + parseable + expected shape → return company name guess (Greenhouse `jobs[0].company_name`; otherwise slug) and job count; 404 → reject (verified error shapes above).

### Pattern 3: Due-queue sharded polling (DISC-01)

pg_cron fires `poll-tick` every minute. The function claims the N companies most overdue:

```sql
-- inside poll-tick, via service-role client
update companies set last_polled_at = now()
where id in (
  select id from companies
  where last_polled_at is null or last_polled_at < now() - interval '9 minutes'
  order by last_polled_at asc nulls first
  limit 10
)
returning *;
```

- 100 companies / 10 per tick → every company polled every ~10 minutes → inside the 5–15 min window with slack.
- Self-balancing: adding/removing companies needs no shard bookkeeping; a new company gets polled on the next tick (`nulls first`).
- Claim-then-poll (`update … returning`) makes overlapping ticks safe.
- Fetch the 10 boards with `Promise.allSettled` (I/O concurrency is free; the 2s CPU cap only counts parse/compute). Per-company failures are isolated — one company's error must not skip the rest (record it in that company's health and continue).

### Pattern 4: Two-layer dedup (DISC-03) — recommended design for the discretion area

**Layer 1 — exact:** `unique (source, external_id)` on `jobs`. Handles re-seeing the same posting every poll. Upsert with `on conflict … do update set last_seen_at = now()`.

**Layer 2 — fingerprint (reposts + aggregator overlap):** computed column or app-computed
`fingerprint = norm(company_name) || '|' || norm(title) || '|' || norm(location_city)`
where `norm` = lowercase, strip punctuation, collapse whitespace, drop parentheticals like "(Remote)". Before inserting:
- **Adzuna insert:** if an **open** job with the same fingerprint exists (any source) → skip (ATS/self wins).
- **ATS insert:** if an open **Adzuna-sourced** job with the same fingerprint exists → upgrade that row in place (set `company_id`, `source`, `external_id`, replace the partial snapshot with the full ATS JD) instead of inserting a second row.
- **ATS insert, same company:** if an open job with the same fingerprint exists for that company (repost with a new ATS id) → treat as duplicate: keep the existing row, record the new `external_id` (e.g. `external_ids text[]` or just update `external_id`) so `last_seen_at` tracking keeps working.

Fingerprint matching on **open jobs only** — a company legitimately re-hiring the same title a year later must not be swallowed. Start with exact normalized-fingerprint equality; hold `pg_trgm` similarity in reserve if real-world titles prove noisy (don't build it speculatively).

### Pattern 5: Snapshot + stale-close (DISC-04, DISC-05) — recommended design for the discretion area

- **Snapshot format:** store on the `jobs` row itself: `description_html text` (entity-decoded for Greenhouse; as-received for Lever/Ashby) + `description_text text` (plain, from `descriptionPlain` where offered, else naive tag-strip) + `snapshot_partial boolean` (true for Adzuna snippet). No separate snapshot table, no Storage objects — at ~3–8 KB per JD, even 10K jobs ≈ 60 MB, comfortably inside the 500 MB DB. Immutable after first write.
- **Stale-close:** every successful poll updates `last_seen_at` for all postings present. After a **successful** poll of company C, close: `status='open' and company_id=C and last_seen_at < now() - interval '35 minutes'` (≈3 missed poll cycles — tolerates one flaky/partial response). **Never close anything when the poll failed** — a company outage would otherwise mass-close its jobs. Adzuna-only jobs have no closure signal: age out at `first_seen_at < now() - interval '30 days'` (also serves the DB-pruning guidance in CLAUDE.md).

### Pattern 6: Heartbeat and health (DISC-06, D-05/06/07)

- `pipeline_heartbeat` (single row): `last_tick_at` written by `poll-tick` on **every** invocation before doing work; `last_success_at` written when ≥1 company polled successfully. Written by the function, **not** inferred from pg_cron's job log — a cron that fires into a broken function must still be detected (the tick write proves invocation; the success write proves the pipeline works).
- Per-company: `last_success_at`, `last_polled_at`, `consecutive_failures`, `last_error text`. Badge derivation (D-05/D-06): `failing` = `consecutive_failures >= 3`; `stale` = `last_success_at` older than 3 poll cycles (~30 min) without 3 failures (pipeline-level problem); else `OK`. Hover shows `last_success_at`.
- Dashboard banner: SPA reads `pipeline_heartbeat`; if `last_success_at > 30 min` old → banner ("Job monitoring hasn't run since {time} — new postings may be missed").
- **External dead-man's switch (D-07):** `heartbeat` edge function, deployed public (`verify_jwt = false` in `supabase/config.toml` `[functions.heartbeat]` [ASSUMED — standard config, verify at deploy]) plus a shared-secret query param. Returns 200 when `last_success_at` < 30 min, 503 otherwise. cron-job.org (free, 1-min granularity, built-in fail/recover email notifications [CITED: cron-job.org]) checks it every 5–10 min. When Supabase is paused the endpoint itself dies → cron-job.org still emails. This satisfies D-07's intent with cron-job.org's native notification; no Resend call is needed on this path (and none is possible when the project is paused). If the planner wants the literal Resend email too, it can only cover the "pipeline stale but project alive" case.

### Pattern 7: Scheduling SQL (locked CLAUDE.md pattern)

```sql
-- Vault: project URL + function token stored once (Dashboard → Vault)
select cron.schedule(
  'poll-tick-every-minute', '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/poll-tick',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'fn_token')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
-- discovery-sweep: '*/45 * * * *' won't do what you want in cron syntax at 45;
-- use '15,45 * * * *' every 30 min? No — budget says 45–60 min: use '0 * * * *' (hourly)
-- or two entries; simplest budget-safe choice: hourly.
```

[CITED: supabase.com/docs/guides/functions/schedule-functions — HIGH per CLAUDE.md] Note `pg_net` is fire-and-forget: cron "success" only means the HTTP request was queued. This is exactly why the heartbeat must be written by the function (Pattern 6).

### Anti-Patterns to Avoid

- **Polling all 100 companies in one invocation:** 2s CPU / 150s wall caps; one bad company poisons the whole tick. Use the due-queue batch.
- **`content=true` on every Greenhouse poll:** 3.9 MB parses per big board per poll for data you already have. Lean list + per-new-job fetch.
- **Closing jobs after a failed poll:** mass false closures on any ATS hiccup. Close only in the success path.
- **Trusting pg_cron's job log as the heartbeat:** pg_net queuing succeeds even when the function 500s or the project's function runtime is broken.
- **Fetching the user's pasted URL server-side:** SSRF. Fetch only constructed URLs on the three allowlisted API hosts.
- **Rendering stored JD HTML without sanitization:** stored-XSS vector; Phase 2 only stores, but leave a loud note for Phase 3's renderer (sanitize at render, e.g. DOMPurify).
- **Treating Adzuna `description` as a JD snapshot:** it's a snippet; mark `snapshot_partial` and upgrade when the ATS copy appears.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTML entity decoding (Greenhouse content) | Regex replace of 5 entities | `he` (npm:he@1.2.0) | Greenhouse emits named + numeric entities; partial decoding corrupts snapshots |
| Scheduling | setInterval loops, external worker | pg_cron + pg_net + Vault | Locked pattern; 1-min granularity; survives deploys |
| Uptime alerting | A second Supabase function watching the first | cron-job.org status notifications | An in-platform watcher dies with the platform (the exact D-07 failure mode) |
| Dedup enforcement | App-level "check then insert" only | Postgres `unique (source, external_id)` + `on conflict` | Concurrent ticks/sweeps race; the constraint is the backstop |
| Fuzzy string similarity (if ever needed) | Custom Levenshtein | `pg_trgm` in Postgres | Battle-tested, indexed, already on Supabase |

**Key insight:** every hard problem in this phase (scheduling, dedup races, liveness alerting) has a Postgres- or platform-native answer; the only custom code that should exist is the thin adapters and the normalization rules.

## Common Pitfalls

### Pitfall 1: Greenhouse JD content is entity-escaped HTML
**What goes wrong:** Snapshots stored as `&lt;h2&gt;…` render as literal text (or get double-escaped later).
**Why it happens:** Documented Greenhouse behavior — hosted-editor HTML is auto-converted to entities. [CITED: developers.greenhouse.io/job-board.html; VERIFIED: live call]
**How to avoid:** `he.decode()` in the Greenhouse adapter only (Lever/Ashby ship real HTML).
**Warning signs:** `&lt;` appearing in `description_html`.

### Pitfall 2: Timestamp format chaos across ATSs
**What goes wrong:** Sorting/recency logic breaks: Lever `createdAt` is epoch **milliseconds**, Greenhouse `first_published` is ISO with `-04:00` offsets, Ashby `publishedAt` is ISO UTC.
**How to avoid:** Adapters normalize to `timestamptz` at ingest; nothing downstream sees raw source timestamps. Lever and Ashby have **no updated-at**; only Greenhouse does — don't design change-detection around a field two of three sources lack.
**Warning signs:** jobs "posted in 1970" (ms treated as s) or 56,000 years from now (s treated as ms).

### Pitfall 3: Error-shape mismatch on verification (D-03)
**What goes wrong:** `verify-board` calls `res.json()` and throws on Ashby's plain-text `Not Found` 404, turning a clean "unsupported" rejection into a 500.
**How to avoid:** Check `res.ok` first; verified shapes: GH `{"status":404,"error":"Job not found"}`, Lever `{"ok":false,"error":"Document not found"}`, Ashby plain text. [VERIFIED: live calls]

### Pitfall 4: The 2s CPU cap (not the 150s wall clock) is the real per-tick budget
**What goes wrong:** A tick that parses 10 multi-MB JSON bodies plus dedup logic exceeds CPU and gets killed mid-write.
**Why it happens:** Free plan: 2s CPU per request; async I/O doesn't count but `JSON.parse` does. [CITED: supabase.com/docs/guides/functions/limits]
**How to avoid:** Lean Greenhouse lists (313 KB vs 3.9 MB, verified); batch of 10; avoid re-parsing/re-stringifying big blobs; upsert per company as you go rather than accumulating everything.
**Warning signs:** function logs showing kills/timeouts on ticks that include large boards (Lever/Ashby always ship descriptions — an enterprise Lever board can be several MB).

### Pitfall 5: Mass false-closure of jobs
**What goes wrong:** A company's ATS has a bad 10 minutes; the stale-close sweep marks all its jobs closed; they "reopen" later — churn downstream (Phase 3 would re-notify).
**How to avoid:** Close only after a **successful** poll, with a ~3-cycle `last_seen_at` grace (Pattern 5). Also treat an implausible response (e.g. 200 with 0 jobs for a company that had 50) as a failure, not a mass closure.

### Pitfall 6: Silent pipeline death is the default failure mode
**What goes wrong:** pg_cron keeps "succeeding" (pg_net queues requests) while the function 500s; or the whole Supabase project pauses after 7 idle days and nothing anywhere can notice.
**How to avoid:** Heartbeat written by the function itself + external cron-job.org check (Pattern 6). Wire the external monitor **in this phase**, not later — D-07 makes it mandatory. The 1-min ATS cron also doubles as pause-prevention (continuous activity).

### Pitfall 7: Adzuna budget blowout or key misuse
**What goes wrong:** Sweeping 6 seed queries on the 5-min ATS cadence = 1,728 req/day — 7x over the 250/day cap; Adzuna starts 429ing/blocking.
**How to avoid:** Separate hourly (or 45-min via `15,45`-style entries) cron for `discovery-sweep`; count requests per UTC day in the heartbeat/health row and stop when near 240. Adzuna keys are edge-function secrets (`supabase secrets set`), never in the SPA.

### Pitfall 8: RLS shape is different from Phase 1
**What goes wrong:** Copying the Phase 1 per-user `(select auth.uid()) = user_id` policies onto `companies`/`jobs` locks each user out of the other's additions — violating D-01/D-02.
**How to avoid:** These are **shared** tables: `for select/insert/update/delete to authenticated using (true)` (with `with check (true)`) on `companies`; `jobs` is select-only for `authenticated` (writes come from the service-role poller, which bypasses RLS); `seed_queries` select-only (edited via SQL per D-08); `pipeline_heartbeat` select-only. Keep `anon` at zero grants. Note AUTH-03's "per-user isolation" applies to personal data (resumes, preferences, applications) — the shared watchlist/jobs pool is a deliberate D-01 exception; state this in the migration comment so the security reviewer doesn't flag it blind.

## Code Examples

### Normalized job shape (adapter output)

```typescript
// supabase/functions/_shared/adapters/types.ts — pure TS, Vitest-testable
export interface NormalizedJob {
  source: "greenhouse" | "lever" | "ashby" | "adzuna";
  externalId: string;          // GH int → String(id); Lever/Ashby UUID; Adzuna id
  title: string;               // trimmed (Ashby had " Security Engineer, Cloud")
  location: string | null;
  absoluteUrl: string;         // GH absolute_url | Lever hostedUrl | Ashby jobUrl | Adzuna redirect_url
  postedAt: string | null;     // ISO; Lever: new Date(createdAt).toISOString()
  descriptionHtml: string | null;  // GH: he.decode(content); Ashby: descriptionHtml; Lever: description + lists + additional
  descriptionText: string | null;  // descriptionPlain where offered
  snapshotPartial: boolean;    // true only for Adzuna
  companyName: string | null;  // GH company_name | Adzuna company.display_name | else watchlist name
}
```

### Greenhouse adapter core (verified fields)

```typescript
// Source: live API verification 2026-07-16 + developers.greenhouse.io/job-board.html
import { decode } from "npm:he@1.2.0";

const LIST = (t: string) => `https://boards-api.greenhouse.io/v1/boards/${t}/jobs`;      // lean: no content
const JOB  = (t: string, id: number) => `${LIST(t)}/${id}`;                              // full content

export async function pollGreenhouse(token: string, knownIds: Set<string>) {
  const res = await fetch(LIST(token));
  if (!res.ok) throw new Error(`greenhouse ${token}: HTTP ${res.status}`);
  const { jobs } = await res.json() as { jobs: GHJob[] };
  const seen = jobs.map(j => String(j.id));
  const fresh = jobs.filter(j => !knownIds.has(String(j.id)));
  const detailed = await Promise.allSettled(
    fresh.map(async j => ({ ...j, content: (await (await fetch(JOB(token, j.id))).json()).content }))
  );
  // map to NormalizedJob: descriptionHtml = decode(content), postedAt = first_published
  return { seen, fresh: detailed };
}
```

### Fingerprint normalization (dedup layer 2)

```typescript
export function fingerprint(company: string, title: string, location: string | null): string {
  const norm = (s: string) => s.toLowerCase()
    .replace(/\(.*?\)/g, " ")        // drop "(Remote)", "(Hybrid)"
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ").trim();
  const city = (location ?? "").split(",")[0];  // "San Francisco, CA" → "san francisco"
  return `${norm(company)}|${norm(title)}|${norm(city)}`;
}
```

### Heartbeat endpoint

```typescript
// supabase/functions/heartbeat/index.ts — public (verify_jwt=false) + shared secret
Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("k") !== Deno.env.get("HEARTBEAT_SECRET")) return new Response("nope", { status: 401 });
  const { data } = await admin.from("pipeline_heartbeat").select("last_success_at").single();
  const fresh = data && Date.now() - new Date(data.last_success_at).getTime() < 30 * 60_000;
  return new Response(fresh ? "ok" : "stale", { status: fresh ? 200 : 503 });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `boards.greenhouse.io/{token}` hosted boards | `job-boards.greenhouse.io/{token}` | Greenhouse migration (rolling) | Detection must accept **both** hosts; API base unchanged |
| Node `web-push`-style Node-only assumptions in edge code | Deno `npm:`/`jsr:` specifiers | n/a (Phase 3 concern) | Phase 2 edge code needs only `npm:@supabase/supabase-js@2.110.7` and `npm:he@1.2.0` |
| Supabase legacy anon/service_role JWT naming | Publishable/secret key naming (already adopted in Phase 1) | 2025+ | Edge functions read the secret key from env; browser keeps publishable key |

**Deprecated/outdated:** nothing else relevant to this phase.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Adzuna supports `max_days_old` and `sort_by=date`; `results_per_page` max ~50 | Pattern 1 (Adzuna) | Sweep queries return stale/unsorted results; fix at first live keyed call (params are behind registration-gated docs) |
| A2 | Adzuna free tier ≈ 25 req/min, 250 req/day | Budget math | Sweep cadence must shrink/grow; design already leaves 25% headroom |
| A3 | Lever postings endpoint returns all postings without pagination when `limit` is omitted | Lever adapter | Missing jobs on very large boards; mitigate by passing `limit=…&skip=…` loop if a watched board is huge |
| A4 | Ashby has no "lean" mode (descriptions always included) | CPU budgeting | None serious — batch size already sized for multi-MB boards |
| A5 | Public edge function via `[functions.heartbeat] verify_jwt = false` in config.toml | Pattern 6 | If flag differs, use the documented current mechanism at deploy; endpoint stays secret-gated either way |
| A6 | `pg_trgm` is available on Supabase Free | Don't Hand-Roll | Only matters if fuzzy fallback is ever needed; exact fingerprints are the primary design |
| A7 | Greenhouse/Lever/Ashby have no hard published rate limits; polling ~1 board / 10 min per company is polite | Polling cadence | If throttled: back off per-company via `consecutive_failures` — already in the health design |
| A8 | Supabase free-tier egress is not consumed by inbound poll responses (egress counts data leaving Supabase); CLAUDE.md's egress warning overstates this path | Free-tier limits | If wrong, the lean-list pattern already minimizes transfer; monitor egress in dashboard during soak |

## Open Questions (RESOLVED)

1. **Adzuna account + keys don't exist yet** — (RESOLVED) by 02-03-PLAN Task 3 (`checkpoint:human-action`): signup + `supabase secrets set` + first keyed call confirming A1/A2 via verify-pipeline probe 10; 02-03 Task 2 makes discovery-sweep a graceful no-op until credentials exist.
   - What we know: registration at developer.adzuna.com is free; app_id/app_key are query params.
   - What's unclear: nothing technical — it's a human signup step.
   - Recommendation: plan a `checkpoint:human-verify`-style task early: create account, `supabase secrets set ADZUNA_APP_ID/ADZUNA_APP_KEY`, make one live call, and confirm A1/A2 (params + quota) before finalizing sweep cadence.
2. **cron-job.org account is also a human step** — (RESOLVED) by 02-03-PLAN Task 3: monitor created against the deployed heartbeat URL with failure + recovery notifications and one intentional stale test (acceptance criterion 4 of that task).
   - Recommendation: last task of the phase — create the monitor against the deployed heartbeat URL (with secret param), set fail+recover notifications, then verify by intentionally stopping the pipeline once (UAT for success criterion 4).
3. **Which real boards to watch during soak** — (RESOLVED) by 02-01-PLAN Task 3: scripts/verify-watchlist.ts seeds Stripe (greenhouse), Palantir (lever), Ramp (ashby) idempotently through the verify-then-insert flow.
   - Recommendation: seed the watchlist with the three verified boards (Stripe/Greenhouse, Palantir/Lever, Ramp/Ashby) on day one so success criteria 2–3 can be observed against live data.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | web build, Vitest, scripts | ✓ | v26.3.1 | — |
| Supabase CLI | migrations, `functions deploy`, secrets | ✓ | 2.109.1 (via `npx supabase` in web/) | — |
| Docker | `supabase start` / `functions serve` (local stack) | ✗ (not running/installed) | — | Skip local edge runtime: unit-test pure adapter/dedup/detect logic with Vitest; deploy functions to the hosted project and verify there (Phase 1 `scripts/` + hosted-verification pattern) |
| Deno | local edge-function type-check/run | ✗ | — | Same fallback as Docker; keep `_shared/` pure-TS so Vitest covers logic; `supabase functions deploy` bundles server-side |
| curl | live endpoint spot-checks | ✓ | — | — |
| Adzuna API keys | discovery-sweep | ✗ (no account yet) | — | None — blocking for DISC-02 until signup (human task; rest of phase proceeds without it) |
| cron-job.org account | D-07 external monitor | ✗ (no account yet) | — | None — blocking for the external half of D-07 (human task at phase end) |

**Missing dependencies with no fallback:** Adzuna keys, cron-job.org account — both are 5-minute human signups; plan them as explicit tasks.
**Missing dependencies with fallback:** Docker/Deno — hosted-deploy verification replaces local edge runtime.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (unchanged) | Phase 1 Supabase auth stands; new tables ride the same sessions |
| V3 Session Management | no (unchanged) | — |
| V4 Access Control | yes | RLS: shared-table policies for `companies` (authenticated CRUD per D-01/D-02); `jobs`/`seed_queries`/`pipeline_heartbeat` select-only for authenticated; all writes via service-role in edge functions; zero `anon` grants. Document the deliberate D-01 exception to AUTH-03 in the migration |
| V5 Input Validation | yes | URL detection: parse with `new URL()`, allowlist exact hosts, slug regex `^[A-Za-z0-9_-]+$` (single path segment for Ashby); **SSRF**: never fetch user-supplied URLs — only constructed URLs on `boards-api.greenhouse.io`, `api.lever.co`, `api.eu.lever.co`, `api.ashbyhq.com`, `api.adzuna.com` |
| V5 (stored XSS) | yes | JD HTML from third parties stored raw (decoded); Phase 2 never renders it — leave an explicit note that Phase 3 must sanitize at render (DOMPurify or equivalent) |
| V6 Cryptography | no new crypto | Secrets in Supabase Vault (cron token) and function secrets (Adzuna keys, heartbeat secret); nothing hand-rolled |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SSRF via pasted "careers URL" | Tampering/Info disclosure | Host allowlist + slug validation; verification fetch only to constructed API URLs (Pattern 2) |
| Stored XSS via third-party JD HTML | Tampering | Store-only this phase; sanitize-at-render contract for Phase 3 |
| Unauthenticated function invocation | Elevation | `poll-tick`/`verify-board`/`discovery-sweep` require JWT (Vault bearer for cron; user session for verify-board); only `heartbeat` is public and it's secret-gated + read-only + leaks only fresh/stale |
| Secret leakage to SPA | Info disclosure | Adzuna keys + service-role key exist only in edge env/Vault; SPA keeps the publishable key (Phase 1 pattern) |
| Dedup race duplicate rows | — (integrity) | DB unique constraint as backstop, `on conflict` upserts |
| SQL injection | Tampering | supabase-js parameterized queries only; the one raw SQL surface (migration/cron DDL) is static |

## Project Constraints (from CLAUDE.md)

- **Free tiers only:** no new paid services — Adzuna free (250/day), cron-job.org free, everything else on existing Supabase/Cloudflare free plans.
- **All backend on Supabase Edge Functions** (Deno); no Cloudflare Workers/Pages Functions.
- **pg_cron + pg_net + Vault** is the locked scheduling pattern.
- **No LinkedIn scraping of any logged-in surface** — sources are exactly the three ATS public APIs + Adzuna (this phase complies by construction).
- **Keep `content=true` fetches lean and dedupe early** — implemented via lean-list + per-new-job content and the two-layer dedup.
- **Prune job rows older than ~30 days** (500 MB DB) — the Adzuna age-out + closed-job pruning covers this.
- **Project-pause is a named failure mode** — D-07's external monitor + 1-min cron activity address it.
- **GSD workflow enforcement:** all file changes through GSD commands.
- **No AI calls in this phase** (scoring is Phase 3), so no Gemini budget/data-terms concerns yet.

## Sources

### Primary (HIGH confidence)
- Live API calls (2026-07-16, this session): `boards-api.greenhouse.io/v1/boards/stripe/jobs` (with/without content, single-job 7954688, invalid-board 404), `api.lever.co/v0/postings/palantir?mode=json`, `api.ashbyhq.com/posting-api/job-board/ramp?includeCompensation=true`, invalid-slug 404s on all three — full field inventories and payload sizes captured above
- Existing codebase: `web/package.json` (pinned versions), `supabase/migrations/0002_resumes.sql` (RLS style), `web/src/lib/supabase.ts`, `web/src/pages/Watchlist.tsx` (stub)
- gsd-tools package-legitimacy seam: `he` (OK), `@supabase/supabase-js` (SUS/too-new latest release)

### Secondary (MEDIUM confidence)
- [Supabase Edge Functions limits](https://supabase.com/docs/guides/functions/limits) — 150s wall / 2s CPU / 256MB free plan (official docs via WebFetch)
- [Greenhouse Job Board API](https://developers.greenhouse.io/job-board.html) — content/questions params, entity-escaping, no EU API variant (official docs via WebFetch)
- [Lever postings-api README](https://github.com/lever/postings-api) — EU host `api.eu.lever.co`, mode param (official repo via WebSearch)
- [Adzuna docs/search + overview](https://developer.adzuna.com/docs/search) — endpoint, confirmed params, response fields, description-is-a-snippet statement (official docs via WebFetch; full param list behind registration)
- [cron-job.org](https://cron-job.org/en/) — free, 1-min jobs, fail/recover status notifications (official site via WebFetch)
- CLAUDE.md researched stack (2026-07): pg_cron pattern, free-tier limit table, Adzuna quota

### Tertiary (LOW confidence)
- WebSearch corroboration of Adzuna `max_days_old`/`salary_is_predicted` field names — flagged in Assumptions Log (A1)

## Metadata

**Confidence breakdown:**
- ATS endpoint shapes & error behavior: HIGH — verified with live calls against real boards this session (closes the STATE.md blocker)
- Scheduling & edge-function limits: HIGH/MEDIUM — official docs (pg_cron pattern already HIGH in CLAUDE.md; limits page fetched and quoted)
- Adzuna specifics: MEDIUM — official docs confirm endpoint/response/snippet behavior; exact quota + a few params remain ASSUMED until first keyed call
- Dedup/stale-close/heartbeat designs: HIGH as designs (discretion areas) — pure engineering on verified primitives
- Pitfalls: HIGH — each traces to a verified fact (entity escaping, CPU cap, error shapes, fire-and-forget pg_net)

**Research date:** 2026-07-16
**Valid until:** 2026-08-15 (ATS public APIs and Supabase limits are stable; re-verify Adzuna quota at signup)

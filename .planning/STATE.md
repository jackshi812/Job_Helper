---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: 03
current_phase_name: scoring-feed-notifications
status: executing
stopped_at: Completed 03-08-PLAN.md
last_updated: "2026-07-20T14:22:03.124Z"
last_activity: 2026-07-20
last_activity_desc: Completed Plan 03-08 scoring freshness and isolation
progress:
  total_phases: 5
  completed_phases: 3
  total_plans: 34
  completed_plans: 31
  percent: 91
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-17)

**Core value:** Discover relevant jobs fast, score them accurately, and surface them in a focused feed.
**Current focus:** Phase 03 — scoring-feed-notifications

## Current Position

Phase: 03 (scoring-feed-notifications) — EXECUTING
Plan: 9 of 11
Status: Ready to execute
Last activity: 2026-07-20 — Completed Plan 03-08 scoring freshness and isolation

Progress: [███████░░░] 73% (8/11 Phase 03 plans executed)

## Performance Metrics

**Velocity:**

- Total plans completed: 14
- Average duration: 45m
- Total execution time: 627m

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| Phase 01 | 3 | 342m | 114m |
| Phase 02 | 7 | 251m | 36m |
| Phase 02.1 | 4 | 34m | 9m |

**Recent Trend:**

- Last 3 plans: 8m, 10m, 8m
- Trend: Compact source-coverage plans now include lifecycle safety, registry authority, catalog UI, and two bounded public connectors

*Updated after each plan completion*
| Phase 02 P01 | 16 min | 3 tasks | 8 files |
| Phase 02 P02 | 1h 17m | 3 tasks | 11 files |
| Phase 02 P03 | 1h 57m | 3 tasks | 9 files |
| Phase 02 P04 | 5min | 2 tasks | 3 files |
| Phase 02 P05 | 9m | 3 tasks | 3 files |
| Phase 02 P06 | 6min | 3 tasks | 8 files |
| Phase 02 P07 | 21min | 2 tasks | 9 files |
| Phase 02.1 P01 | 8 min | 3 tasks | 5 files |
| Phase 02.1 P02 | 8 min | 3 tasks | 8 files |
| Phase 02.1 P03 | 10 min | 2 tasks | 5 files |
| Phase 02.1 P04 | 8 min | 3 tasks | 9 files |
| Phase 02.1 P05 | 8 min | 3 tasks | 3 files |
| Phase 02.1 P06 | 12 min | 3 tasks | 11 files |
| Phase 02.1 P07 | 743min | 3 tasks | 5 files |
| Phase 02.1 P08 | 79 min | 3 tasks | 2 files |
| Phase 02.1 P09 | 7 min | 2 tasks | 2 files |
| Phase 02.1 P10 | 4 min | 2 tasks | 5 files |
| Phase 02.1 P11 | 5 min | 2 tasks | 2 files |
| Phase 02.1 P12 | 9h 5m | 3 tasks | 4 files |
| Phase 02.1 P13 | 14min | 1 checkpoint | 5 planning files |
| Phase 03 P08 | 14m | 2 tasks | 10 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Phase 01]: Use Supabase client defaults for persistent, auto-refreshing browser sessions.
- [Phase 01]: Keep privileged account provisioning in local scripts with gitignored credentials.
- [Phase 01]: Use database and storage RLS as the authorization boundary; route guards are UX only.
- [Phase 01]: Resume deletion is storage-first and requires the exact removed object path before metadata deletion.
- [Phase 01]: Hosted RLS verification uses independent publishable-key sessions and never a privileged client.
- [Phase 01]: Browser file round-trip judgment remains in the configured end-of-phase UAT batch.
- [Phase 01]: Keep bulk deletion storage-first and require exact object-removal counts before the database RPC.
- [Phase 01]: Use manual recovery OTP instead of ConfirmationURL because email-security prefetch can consume clickable one-time links.
- [Phase 01]: Clear the temporary recovery session locally after password update.
- [Phase 02]: Parse pasted URLs in the browser for immediate rejection, then repeat detection in verify-board so the server remains the authoritative SSRF boundary.
- [Phase 02]: Keep companies globally shared between the two authenticated users while granting no anonymous table access.
- [Phase 02]: Represent watchlist edits as remove and re-add because every stored polling identity field is derived from live URL verification.
- [Phase 02]: Keep ATS mapping pure and fixture-testable while thin wrappers own live fetches, response validation, and Greenhouse HTML decoding. — Preserves Vitest coverage while keeping Deno network concerns at the edge.
- [Phase 02]: Use the database unique source/external-ID constraint as the concurrency backstop and normalized company/title/location fingerprints for repost and aggregator merges. — Combines exact concurrent safety with cross-source and repost deduplication.
- [Phase 02]: Disable Edge JWT verification for cron calls and enforce a dedicated x-cron-secret shared only by Vault, Edge environment, and gitignored verification config. — The project's publishable and secret keys are not JWTs, so function-level shared-secret authorization is the applicable trust boundary.
- [Phase 02]: Allow stale closure only after a successful non-empty company poll; failures and implausibly empty boards never close jobs. — Prevents transient ATS failures or malformed empty responses from falsely closing active jobs.
- [Phase 02]: Protect the public heartbeat with a dedicated query secret and expose only ok/stale status. — Keeps the endpoint read-only and independent from user sessions while revealing no pipeline data beyond liveness.
- [Phase 02]: Keep Adzuna descriptions partial, cap requests at 240 per UTC day, and let matching open ATS fingerprints win. — Preserves snapshot truth, protects the free quota, and prevents aggregator overlap from creating duplicate jobs.
- [Phase 02]: Record cron-job.org recovery-email receipt as user-waived rather than passed. — Failure email delivery and HTTP recovery were observed, but no recovery email arrived and the user declined another test cycle.
- [Phase 02]: Resolve source/external-ID matches across open and closed rows while keeping repost fingerprints open-only. — Returned exact-ID postings reopen without changing repost merge semantics.
- [Phase 02]: Restrict reopened jobs to lifecycle-field updates so first-sight snapshots remain immutable. — Captured job content remains a truthful first-sight record.
- [Phase 02]: Treat zero claimed companies as heartbeat success while all-claimed-failed ticks remain stale. — Scheduler health reflects successful execution instead of work volume.
- [Phase 02]: Preserve the claim RPC contract while using a locking CTE and service-role-only execution.
- [Phase 02]: Resolve hosted seed probes by exact ATS type and board token.
- [Phase 02]: Restore temporary hosted probe mutations whenever verification aborts.
- [Phase 02]: Treat no enabled discovery seeds as a healthy no-work sweep, while any attempted run with zero successes is failed.
- [Phase 02]: Deduplicate seed queries by trimmed lowercase role/location pairs while preserving the first configured values sent upstream.
- [Phase 02]: Use 15-minute discovery during 11:00-02:59 UTC and hourly discovery overnight to hold the current three-query workload to 216 requests per day.
- [Phase 02]: Keep partial discovery failures degraded and HTTP 200, but propagate total failure as HTTP 503 through both discovery-sweep and heartbeat.
- [Phase 02]: Use the user-approved 30-minute 06:00-noon Chicago and two-hour otherwise aggregator cadence, about 63 requests/day for three queries.
- [Phase 02]: Gate a frequent cron trigger with DST-safe Chicago-local slots and cap operational Adzuna usage at 75 requests/day for weekly/monthly headroom.
- [Phase 02.1]: Require completeness, closure credibility, positive page evidence, no warnings, and reconciled expected counts before direct-source closure.
- [Phase 02.1]: Treat implausibly empty established boards as unknown observations that retain jobs and last_success_at.
- [Phase 02.1]: Keep the temporary Greenhouse/Lever/Ashby dispatch exhaustive until Plan 02 replaces it with the closed connector registry.
- [Phase 02.1]: Require auth.getUser and authenticated role before verify-board provider or privileged work. — Gateway JWT acceptance alone does not prove the bearer belongs to a real signed-in user.
- [Phase 02.1]: Use deterministic provider-region-token source keys and separate canonical careers URLs. — Polling identity stays server-constructed while users retain a directly searchable navigation link.
- [Phase 02.1]: Reject unknown and non-active connectors inside pollConnector before adapter access. — SQL eligibility and application dispatch independently fail closed.
- [Phase 02.1]: Keep unsupported finance entries in a select-only evidence catalog so they can never enter scheduler claims or connector dispatch.
- [Phase 02.1]: Pin Capital One reconciliation to the literal workday:wd12:capitalone:Capital_One source key and never derive it from display data.
- [Phase 02.1]: Let catalog rows own navigation and evidence while matched company rows exclusively own activation, progress, health, dates, and removal.
- [Phase 02.1]: Accept only exact HTTPS SmartRecruiters and single-label Recruitee board identities; unsafe URL variants fail before network access.
- [Phase 02.1]: Make page, count, schema, content-type, cap, and required-detail failures closure-ineligible while retaining safe partial rows.
- [Phase 02.1]: Add only SmartRecruiters and Recruitee to migration 0014 executable-provider checks; Workday and unsupported targets remain gated.
- [Phase 02.1]: Use database-timed provider windows and a hard three-row cap; only SmartRecruiters/Recruitee auto-promote, while real-user Edge verification derives all accepted evidence. — Prevents replay, client-time spoofing, progress divergence, and unintended Workday activation.
- [Phase 02.1]: Pin Workday execution to workday:wd12:capitalone:Capital_One and treat empty or drifted CXS responses as closure-ineligible. — The candidate CXS contract is undocumented, so only the fixed Capital One identity and fully reconciled positive observations are trustworthy.
- [Phase 02.1]: Keep Workday Experimental and exclude it from both SQL claims and scheduled application dispatch after all three accepted windows. — Activation evidence may establish reachability without authorizing recurring polling of an undocumented provider contract.
- [Phase 02.1]: SmartRecruiters remains catalog-only unsupported; no access bypass. — Hosted anonymous verification was unavailable, so D-04 requires honest unsupported evidence.
- [Phase 02.1]: Capital One Workday remains Experimental and unclaimable after 3/3 observations. — The public CXS surface is undocumented; the fourth-window cap passed without enabling scheduled polling.
- [Phase 02.1]: Reattach preserved provider jobs only when company_id is null and exact source/external ID returns. — This restores delete/re-add continuity while preserving first-sight snapshots and concurrent ownership.
- [Phase 02.1]: Tie production acceptance to the exact Cloudflare deployment commit and immutable asset hash before UAT. — Prevents stale mutable-URL acceptance.
- [Phase 02.1]: Exclude minute-scheduler-owned health fields from rejected-auth mutation baselines while retaining stable identity, activation, ledger, and job checks. — Avoids concurrent cron false positives without weakening the tested authorization boundary.
- [Phase 02.1]: Use last_verified_at only as an Experimental display-health fallback after positive progress with zero failures and no bounded error; Active health remains poll-derived.
- [Phase 02.1]: Keep ConfirmDialog errorMessage optional so Watchlist can announce bounded removal failures inside the modal without changing Resume or Settings destructive defaults.
- [Phase 02.1]: Use performance.now by default and an injectable clock so SmartRecruiters enforces a monotonic 60-second invocation deadline deterministically.
- [Phase 02.1]: Allow a final one-request detail batch when one count slot remains, preserving the exact 40-request ceiling and maximum concurrency two.
- [Phase 02.1]: Preserve source, external ID, and first-sight fields on fingerprint repost refreshes; only last_seen_at may advance on the existing row.
- [Phase 02.1]: Paginate complete hosted job snapshots because evidence reconciliation cannot be safe when the provider default silently truncates rows.
- [Phase 02.1]: Record the offline removal hang as a real deferred gap, not a pass; the user chose to move on without running human Checks 6-8.
- [Phase 03]: Use GPT-5.4 nano through OpenAI Responses (`store:false`, strict Structured Outputs, reasoning none) for extraction/scoring; ChatGPT Pro is separate from API billing; compare GPT-5.6 Luna only if fewer than 16/20 representative scores pass human quality review.
- [Phase 03]: Remove browser push, email alerts, alert tuning, and notification persistence; scored matches are feed-only. — Owner decision on 2026-07-19.
- [Phase 03]: Authorize score reuse only when the complete server-computed semantic input hash matches; use desired revisions solely as CAS publication fences.
- [Phase 03]: While the short-lived scoring-verification latch is active, suppress ordinary and mismatched claims before seeding and permit only its two registered existing fixture rows.
- [Phase 03]: Keep scoring provider-agnostic after dedup; every claimed job passes the same cheap filter before routing, hashing, or paid AI work.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260716-nw6 | Enforce current-password reauthentication in Settings changePassword (CR-01/T-01-07) | 2026-07-16 | def0e91 | [260716-nw6-enforce-current-password-reauthenticatio](./quick/260716-nw6-enforce-current-password-reauthenticatio/) |

### Blockers/Concerns

- [Phase 2 verification]: cron-job.org failure email delivery and HTTP 200 recovery were observed, but recovery-email receipt was user-waived and remains unverified; do not record it as passed.
- [Phase 02.1 UAT]: offline Watchlist removal can remain indefinitely at `Removing…` with both actions disabled and no modal error. Curi Capital remained after recovery. The user accepted deferring the fix and Checks 6-8; do not record the behavior as passed.
- [Phase 4]: Highest-uncertainty area (DOCX XML run-splitting, truthful-edit prompting, CloudConvert fidelity + PII posture) — research flagged for deeper research during planning

### Roadmap Evolution

- Phase 02.1 inserted after Phase 2: Expand representative ATS and branded finance career-site coverage with safe degraded-source behavior (URGENT)

## Session Continuity

Last session: 2026-07-20T14:22:03.114Z
Stopped at: Completed 03-08-PLAN.md
Resume file: None
Last session (2026-07-20): Plan 03-08 completed locally with provider-agnostic title filtering, semantic freshness/CAS, truthful company persistence, and the expiring two-fixture verification latch. Continue with Plan 03-09; no rollout or hosted verification occurred.

---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: 02.1
current_phase_name: Source Coverage Expansion
status: planning
stopped_at: Phase 02 complete; Phase 02.1 ready for research planning
last_updated: "2026-07-17T20:13:11.664Z"
last_activity: 2026-07-17
last_activity_desc: Phase 02 complete, transitioned to Phase 02.1
progress:
  total_phases: 5
  completed_phases: 2
  total_plans: 10
  completed_plans: 10
  percent: 40
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-17)

**Core value:** Discover relevant jobs fast (5–15 minutes from posting) and notify the user immediately — if job discovery and notification don't work reliably, nothing else matters.
**Current focus:** Phase 02.1 — source-coverage-expansion

## Current Position

Phase: 02.1 — Source Coverage Expansion
Plan: Not started
Status: Ready for planning
Last activity: 2026-07-17 — Phase 02 complete, transitioned to Phase 02.1

Progress: [██████████] 100% (10/10 plans)

## Performance Metrics

**Velocity:**

- Total plans completed: 10
- Average duration: 59m
- Total execution time: 593m

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| Phase 01 | 3 | 342m | 114m |
| Phase 02 | 7 | 251m | 36m |

**Recent Trend:**

- Last 3 plans: 9m, 6m, 21m
- Trend: Gap-closure plans stayed compact; hosted deployment and proof made the final plan the longest of the three

*Updated after each plan completion*
| Phase 02 P01 | 16 min | 3 tasks | 8 files |
| Phase 02 P02 | 1h 17m | 3 tasks | 11 files |
| Phase 02 P03 | 1h 57m | 3 tasks | 9 files |
| Phase 02 P04 | 5min | 2 tasks | 3 files |
| Phase 02 P05 | 9m | 3 tasks | 3 files |
| Phase 02 P06 | 6min | 3 tasks | 8 files |
| Phase 02 P07 | 21min | 2 tasks | 9 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: 4 coarse phases (research suggested 6; notifications folded into scoring phase, tracker folded into tailoring phase — dependency chain preserved)
- [Roadmap]: RESU-01 (resume upload) placed in Phase 3 because AI scoring runs against the uploaded resume
- [Roadmap]: PREF-01 (job preferences) placed in Phase 3 because preferences drive the cheap filters built there
- [Roadmap]: Pitfall mitigations are in-phase requirements — source_health + heartbeat ship with the first fetcher (Phase 2), dedupe before aggregator (Phase 2), email co-channel + tiering with first push (Phase 3), term-diff guardrail with first AI edit (Phase 4)
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

### Pending Todos

None yet.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260716-nw6 | Enforce current-password reauthentication in Settings changePassword (CR-01/T-01-07) | 2026-07-16 | def0e91 | [260716-nw6-enforce-current-password-reauthenticatio](./quick/260716-nw6-enforce-current-password-reauthenticatio/) |

### Blockers/Concerns

- [Phase 2 verification]: cron-job.org failure email delivery and HTTP 200 recovery were observed, but recovery-email receipt was user-waived and remains unverified; do not record it as passed.
- [Phase 4]: Highest-uncertainty area (DOCX XML run-splitting, truthful-edit prompting, CloudConvert fidelity + PII posture) — research flagged for deeper research during planning

### Roadmap Evolution

- Phase 02.1 inserted after Phase 2: Expand representative ATS and branded finance career-site coverage with safe degraded-source behavior (URGENT)

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-07-17T20:13:11.664Z
Stopped at: Phase 02 complete; Phase 02.1 ready for research planning
Resume file: None

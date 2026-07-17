---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: 02
current_phase_name: watchlist-ingestion-monitoring
status: executing
stopped_at: Completed 02-02-PLAN.md
last_updated: "2026-07-17T03:49:09.007Z"
last_activity: 2026-07-17
last_activity_desc: Phase 02 execution started
progress:
  total_phases: 4
  completed_phases: 1
  total_plans: 6
  completed_plans: 5
  percent: 25
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-15)

**Core value:** Discover relevant jobs fast (5–15 minutes from posting) and notify the user immediately — if job discovery and notification don't work reliably, nothing else matters.
**Current focus:** Phase 02 — watchlist-ingestion-monitoring

## Current Position

Phase: 02 (watchlist-ingestion-monitoring) — EXECUTING
Plan: 3 of 3
Status: Ready to execute
Last activity: 2026-07-17 — Phase 02 execution started

Progress: [██▓░░░░░░░] 25% (1/4 phases)

## Performance Metrics

**Velocity:**

- Total plans completed: 3
- Average duration: 114m
- Total execution time: 342m

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| Phase 01 | 3 | 342m | 114m |

**Recent Trend:**

- Last 3 plans: 124m, 12m, 206m
- Trend: Deployment and production recovery UAT made Plan 03 the longest phase plan

*Updated after each plan completion*
| Phase 02 P01 | 16 min | 3 tasks | 8 files |
| Phase 02 P02 | 1h 17m | 3 tasks | 11 files |

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

### Pending Todos

None yet.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260716-nw6 | Enforce current-password reauthentication in Settings changePassword (CR-01/T-01-07) | 2026-07-16 | def0e91 | [260716-nw6-enforce-current-password-reauthenticatio](./quick/260716-nw6-enforce-current-password-reauthenticatio/) |

### Blockers/Concerns

- [Phase 2]: ATS endpoint shapes (Greenhouse/Lever/Ashby) are MEDIUM confidence — validate one live call per ATS before building adapters; confirm Adzuna coverage for target market (Jooble is the fallback)
- [Phase 4]: Highest-uncertainty area (DOCX XML run-splitting, truthful-edit prompting, CloudConvert fidelity + PII posture) — research flagged for deeper research during planning

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-07-17T13:48:13.747Z
Stopped at: Session resumed, proceeding to Phase 02 Plan 03 Task 1
Resume file: .planning/phases/02-watchlist-ingestion-monitoring/.continue-here.md

---
phase: 02-watchlist-ingestion-monitoring
plan: 06
subsystem: discovery-monitoring
tags: [supabase, adzuna, pg-cron, heartbeat, react, vitest]

requires:
  - phase: 02-watchlist-ingestion-monitoring
    plan: 03
    provides: Adzuna discovery sweep, request budget ledger, seed queries, and public heartbeat endpoint
provides:
  - Persisted ok, degraded, and failed discovery health with total-failure HTTP 503
  - Deduped seed queries and a quota-safe Chicago-local discovery cadence
  - Shared, tested banner decisions for stale, failed-discovery, and unavailable monitoring states
affects: [02-07-hosted-gap-verification, phase-3-preferences, pipeline-monitoring]

tech-stack:
  added: []
  patterns:
    - Pure health classification shared by tested logic and the discovery edge function
    - Persist liveness state before projecting it through external and in-app monitoring surfaces

key-files:
  created:
    - supabase/functions/_shared/discovery-health.ts
    - web/tests/discovery-health.test.ts
    - web/src/lib/pipeline.test.ts
    - supabase/migrations/0009_discovery_health_cadence.sql
  modified:
    - supabase/functions/discovery-sweep/index.ts
    - supabase/functions/heartbeat/index.ts
    - web/src/lib/pipeline.ts
    - web/src/components/Shell.tsx

key-decisions:
  - "Treat no enabled discovery seeds as a healthy no-work sweep, while any attempted run with zero successes is failed."
  - "Deduplicate seed queries by trimmed lowercase role/location pairs while preserving the first configured values sent upstream."
  - "Checkpoint override: use 30-minute discovery from 06:00-noon America/Chicago and two-hour discovery otherwise, totaling about 63 requests per day for three queries."
  - "Keep partial discovery failures degraded and HTTP 200, but propagate total failure as HTTP 503 through both discovery-sweep and heartbeat."

patterns-established:
  - "Health projection: one pure decision function owns banner priority across read failure, stale polling, and discovery failure."
  - "Budget-aware scheduling: document distinct queries multiplied by daily sweeps next to cron definitions."

requirements-completed: [DISC-02, DISC-06, PREF-04]

coverage:
  - id: D1
    description: Completed discovery runs persist explicit health, return 503 when every attempted query fails, and remain 200 when only some queries fail.
    requirement: DISC-06
    verification:
      - kind: unit
        ref: "web/tests/discovery-health.test.ts#summarizeDiscovery"
        status: pass
      - kind: other
        ref: "discovery-sweep response and persistence acceptance greps"
        status: pass
    human_judgment: false
  - id: D2
    description: Discovery deduplicates normalized seed pairs and follows the accepted 30-minute morning/two-hour otherwise Chicago-local cadence at about 63 requests per day.
    requirement: DISC-02
    verification:
      - kind: unit
        ref: "web/tests/discovery-health.test.ts#distinctSeedQueries"
        status: pass
      - kind: other
        ref: "supabase/migrations/0009_discovery_health_cadence.sql cadence acceptance greps"
        status: pass
    human_judgment: false
  - id: D3
    description: Total discovery failure reaches the secret-gated heartbeat as 503 and the application banner as a clear monitoring warning.
    requirement: PREF-04
    verification:
      - kind: unit
        ref: "web/src/lib/pipeline.test.ts#deriveHeartbeatBanner"
        status: pass
      - kind: other
        ref: "heartbeat endpoint acceptance greps and npm run build"
        status: pass
    human_judgment: true
    rationale: "Rendered banner behavior and hosted heartbeat responses remain part of the phase-end UAT and Plan 02-07 hosted probes."

duration: 6min
completed: 2026-07-17
status: complete
---

# Phase 2 Plan 6: Discovery Health and Cadence Summary

**Persisted discovery health fails loudly on total Adzuna outage, drives both monitoring surfaces, and uses a DST-safe quota-conscious Chicago cadence.**

## Performance

- **Duration:** 6 minutes
- **Started:** 2026-07-17T17:26:48Z
- **Completed:** 2026-07-17T17:32:39Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Added pure discovery classification and query deduplication with RED/GREEN coverage for failed, degraded, healthy, and no-work sweeps.
- Reworked discovery-sweep to persist attempted/succeeded health, return 503 on total attempted failure, and leave intentional budget/configuration skips outside failure accounting.
- The deployment checkpoint replaced the original cadence with the user's accepted 30-minute 06:00-noon Chicago and two-hour otherwise schedule, totaling about 63 requests per day.
- Propagated total discovery failure through the external heartbeat and the in-app banner, including an explicit unavailable state when the health query fails.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Discovery health and banner regression coverage** - `8cb1a8f` (test)
2. **Task 1 GREEN: Pure discovery and banner health classification** - `4589867` (feat)
3. **Task 2: Persisted health and budget-safe discovery cadence** - `8963ccc` (fix)
4. **Task 3: External and in-app discovery failure surfaces** - `dcfbe06` (fix)

## Files Created/Modified

- `supabase/functions/_shared/discovery-health.ts` - Pure sweep classification and normalized seed-pair deduplication.
- `web/tests/discovery-health.test.ts` - Failed, degraded, healthy, no-work, and dedupe coverage.
- `web/src/lib/pipeline.test.ts` - Stale, fresh, failed-discovery, query-error, and loading banner coverage.
- `supabase/migrations/0009_discovery_health_cadence.sql` - Discovery health columns and budget-bound active/overnight cron jobs.
- `supabase/functions/discovery-sweep/index.ts` - Deduped requests, attempt/success counts, persisted health, and status-aware response.
- `supabase/functions/heartbeat/index.ts` - Secret-gated discovery failure projection as `discovery-failed` HTTP 503.
- `web/src/lib/pipeline.ts` - Extended heartbeat row plus shared banner derivation.
- `web/src/components/Shell.tsx` - Banner rendering through the tested shared decision function.

## Decisions Made

- A sweep with no enabled seeds is a healthy no-work execution; a sweep is failed only when it attempted at least one query and none succeeded.
- Seed equality is a trimmed, lowercase `(what, where_loc)` pair, while the first row's original values are retained for the upstream request.
- A 30-minute cron trigger delegates Chicago-local slot decisions to discovery-sweep, avoiding UTC/DST drift; the accepted schedule runs every 30 minutes from 06:00-noon and every two hours otherwise.
- The effective 75-request daily allocation reserves safety headroom beneath Adzuna's weekly and monthly defaults while retaining the original 240/day hard limit.

## Checkpoint Deviation

Plan 02-07 deployment approval superseded Plan 02-06's original 216-request/day cadence before migration 0009 was pushed. The revised unpushed migration and implementation use the accepted 63-request/day cadence and add weekly/monthly quota defense in depth.
- Degraded discovery remains HTTP 200 for the external dead-man monitor, while total discovery failure returns 503 and warns in-app.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Repository metadata is outside the workspace-write sandbox, so the required atomic commits used the approved git escalation path.
- The GSD progress updater reported 90% but left stale progress fields in `STATE.md`; the required state values were corrected to 9/10 plans and 90%.
- The existing Vite chunk-size warning remains unchanged and outside this plan's scope; production build succeeds.

## Authentication Gates

None.

## Known Stubs

None.

## User Setup Required

None - migration push, function deployment, and hosted probes are intentionally deferred to Plan 02-07.

## Next Phase Readiness

- Plan 02-07 can push migration 0009, deploy the discovery and heartbeat functions, and execute the prepared hosted health/cadence probes.
- No local implementation blockers remain.

## Self-Check: PASSED

- All eight created or modified implementation/test files and this summary exist.
- Commits `8cb1a8f`, `4589867`, `8963ccc`, and `dcfbe06` exist on `main`.
- The full 88-test suite, production build, acceptance greps, and diff checks pass.
- No goal-blocking stubs or unplanned threat surfaces were found.

---
*Phase: 02-watchlist-ingestion-monitoring*
*Completed: 2026-07-17*

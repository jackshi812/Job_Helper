---
phase: 02-watchlist-ingestion-monitoring
plan: 04
subsystem: ingestion-pipeline
tags: [supabase, edge-functions, lifecycle, heartbeat, vitest]

requires:
  - phase: 02-watchlist-ingestion-monitoring
    plan: 02
    provides: Watched-board polling, immutable first-sight snapshots, stale closure, and pipeline heartbeat writes
provides:
  - Pure lifecycle planning for open, closed, new, and stale job rows
  - Returned exact-ID job reopening without snapshot mutation
  - Truthful heartbeat advancement for successful no-work ticks
  - Automated disappearance-grace and failed-poll closure coverage
affects: [02-07-deploy-hosted-proof, phase-3-feed, pipeline-monitoring]

tech-stack:
  added: []
  patterns:
    - Pure lifecycle decision core wrapped by the Deno polling function
    - Exact-ID lifecycle resolution across open and closed rows

key-files:
  created:
    - supabase/functions/_shared/lifecycle.ts
    - web/tests/lifecycle.test.ts
  modified:
    - supabase/functions/poll-tick/index.ts

key-decisions:
  - "Resolve source/external-ID matches across both open and closed rows while keeping repost fingerprint matching limited to open rows."
  - "Restrict reopen writes to status, closed_at, and last_seen_at so immutable first-sight snapshots remain untouched."
  - "Treat zero claimed companies as a successful scheduler tick, but keep all-claimed-failed ticks stale."

patterns-established:
  - "Lifecycle planner: database wrappers execute tested ID sets instead of duplicating lifecycle decisions in query chains."
  - "Immutable reopen: a returned closed posting changes only lifecycle fields, never captured content."

requirements-completed: [DISC-03, DISC-05, DISC-06]

coverage:
  - id: D1
    description: A returned closed ATS posting is classified for reopening instead of duplicate insertion, while open exact-ID matches remain seen.
    requirement: DISC-03
    verification:
      - kind: unit
        ref: "web/tests/lifecycle.test.ts#reopens a returned closed exact-ID job without creating or closing it"
        status: pass
      - kind: other
        ref: "poll-tick restricted reopen payload acceptance grep"
        status: pass
    human_judgment: false
  - id: D2
    description: Grace-expired missing jobs close only after a successful non-empty poll; empty polls and closed rows produce no close candidates.
    requirement: DISC-05
    verification:
      - kind: unit
        ref: "web/tests/lifecycle.test.ts#close and empty-poll lifecycle tests"
        status: pass
    human_judgment: false
  - id: D3
    description: Successful no-work and partial-success ticks advance pipeline health while an all-claimed-failed tick does not.
    requirement: DISC-06
    verification:
      - kind: unit
        ref: "web/tests/lifecycle.test.ts#shouldAdvanceSuccessHeartbeat tests"
        status: pass
    human_judgment: false

duration: 5min
completed: 2026-07-17
status: complete
---

# Phase 2 Plan 4: Job Lifecycle Correctness Summary

**Pure lifecycle planning now reopens returned closed postings without altering their snapshots, closes only tested grace-expired candidates, and reports healthy no-work scheduler ticks truthfully.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-17T17:12:14Z
- **Completed:** 2026-07-17T17:17:35Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Extracted lifecycle classification into a pure module covering open exact matches, closed-job reopening, genuinely new jobs, and close-grace candidates.
- Rewired `poll-tick` to load both open and closed rows, reopen exact-ID returns with a restricted update payload, and report a `reopened` count.
- Added deterministic coverage for disappearance closure, empty-poll safety, closed-row exclusion, and all three scheduler heartbeat transitions.
- Passed the complete 78-test web suite and the production TypeScript/Vite build.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Lifecycle regression coverage** - `05741c8` (test)
2. **Task 1 GREEN: Pure lifecycle sync planning** - `762558c` (feat)
3. **Task 2: poll-tick lifecycle and heartbeat integration** - `85d8f6b` (fix)

## Files Created/Modified

- `supabase/functions/_shared/lifecycle.ts` - Pure lifecycle and heartbeat decision functions.
- `web/tests/lifecycle.test.ts` - Ten focused reopen, close-grace, empty-poll, and heartbeat tests.
- `supabase/functions/poll-tick/index.ts` - All-status resolution, restricted reopening, ID-based closure, reopened totals, and no-work heartbeat advancement.

## Decisions Made

- Exact source/external-ID resolution includes both open and closed rows, while repost fingerprint matching intentionally remains open-only.
- Reopen updates modify only `status`, `closed_at`, and `last_seen_at`; captured descriptions, posting timestamps, titles, and fingerprints remain immutable.
- A tick is a heartbeat success when it claims no work or completes at least one company; claiming work and failing every company remains stale.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The repository git index is outside the workspace-write sandbox, so required atomic commits used the approved git escalation path.
- The existing Vite chunk-size warning remains unchanged and outside this plan's scope.

## User Setup Required

None - deployment and hosted probes are intentionally deferred to Plan 02-07.

## Next Phase Readiness

- Plan 02-07 can deploy the rewired `poll-tick` and prove reopening plus no-work heartbeat behavior against hosted Supabase.
- No implementation blockers remain for this plan.

## Self-Check: PASSED

- All three created or modified implementation/test files exist.
- Commits `05741c8`, `762558c`, and `85d8f6b` exist on `main`.
- `web/tests/lifecycle.test.ts` passes all 10 focused tests; the full suite passes 78 tests across 12 files.
- `npm run build` succeeds, and all acceptance greps pass.
- No goal-blocking stubs or new unplanned threat surfaces were found.

---
*Phase: 02-watchlist-ingestion-monitoring*
*Completed: 2026-07-17*

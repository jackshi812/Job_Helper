---
phase: 02-watchlist-ingestion-monitoring
plan: 05
subsystem: ingestion-verification
tags: [supabase, postgres, row-locking, rls, verification, concurrency]

requires:
  - phase: 02-watchlist-ingestion-monitoring
    plan: 02
    provides: Shared watchlist, jobs pipeline, claim_due_companies RPC, polling heartbeat, and hosted verification scripts
provides:
  - Exclusive due-company claims using FOR UPDATE SKIP LOCKED
  - Non-destructive cross-user watchlist verification with seed-integrity regression coverage
  - Hosted regression probes for concurrent claims, no-work heartbeat, job reopen, and discovery health
affects: [phase-02-hosted-gap-verification, polling-cadence, exactly-once-ingestion]

tech-stack:
  added: []
  patterns:
    - Lock due rows in a CTE and update from the locked set for exclusive concurrent claims
    - Verification mutates only invocation-owned disposable rows and checks production identity invariants
    - Hosted state-transition probes restore temporary mutations when verification aborts

key-files:
  created:
    - supabase/migrations/0008_claim_exclusive.sql
  modified:
    - scripts/verify-watchlist.ts
    - scripts/verify-pipeline.ts

key-decisions:
  - "Preserve the existing claim RPC signature and service-role-only grant posture while replacing selection with a locking CTE."
  - "Resolve production seed companies by exact ATS type and board token in hosted probes."
  - "Restore a temporarily closed probe job if the reopen verification aborts before proving recovery."

patterns-established:
  - "Disposable hosted probes: create an invocation-unique row, mutate only its returned ID, and clean it up in finally."
  - "Integrity baselines: compare stable entity IDs and non-decreasing linked-row counts before and after verification."

requirements-completed: [DISC-01, DISC-03, PREF-02]

coverage:
  - id: D1
    description: Overlapping claim_due_companies calls lock and skip rows already claimed by another invocation while retaining the nine-minute due interval.
    requirement: DISC-01
    verification:
      - kind: static
        ref: "supabase/migrations/0008_claim_exclusive.sql acceptance greps"
        status: pass
      - kind: integration
        ref: "scripts/verify-pipeline.ts probe 13 (runs in Plan 02-07)"
        status: pending
    human_judgment: false
  - id: D2
    description: Cross-user RLS verification creates and deletes only a disposable company row and proves existing seed identities plus linked jobs survive.
    requirement: PREF-02
    verification:
      - kind: static
        ref: "node --check scripts/verify-watchlist.ts and disposable-ID acceptance greps"
        status: pass
      - kind: integration
        ref: "scripts/verify-watchlist.ts probes 4a, 4b, and 6 (runs in Plan 02-07)"
        status: pending
    human_judgment: false
  - id: D3
    description: Hosted pipeline verification covers no-work heartbeat success, close-then-return reopening with immutable first-sight fields, and persisted discovery health.
    requirement: DISC-03
    verification:
      - kind: static
        ref: "node --check scripts/verify-pipeline.ts and probes 14-16 acceptance greps"
        status: pass
      - kind: integration
        ref: "scripts/verify-pipeline.ts probes 14-16 (runs in Plan 02-07)"
        status: pending
    human_judgment: false

duration: 9m
completed: 2026-07-17
status: complete
---

# Phase 2 Plan 5: Exclusive Claims and Safe Hosted Verification Summary

**Exclusive concurrent company claims, disposable RLS verification, and hosted regression probes for the remaining ingestion-health fixes**

## Performance

- **Duration:** 9 minutes
- **Started:** 2026-07-17T17:11:50Z
- **Completed:** 2026-07-17T17:20:48Z
- **Tasks:** 3
- **Files modified:** 3 implementation and verification files

## Accomplishments

- Added migration `0008` with a locking due-row CTE and `FOR UPDATE SKIP LOCKED`, while preserving the RPC signature, nine-minute due window, empty search path, security-invoker behavior, and service-role-only execution grants.
- Reworked watchlist verification so User A creates an invocation-unique disposable company, User B reads/deletes only that returned ID, cleanup targets only that ID, and production seed IDs plus linked job counts are checked before seeding continues.
- Extended pipeline verification with probes 13-16 for disjoint concurrent claims, successful no-work heartbeat advancement, close-then-return reopening with immutable snapshot fields, and discovery-health response/heartbeat agreement.
- Kept the verifier deterministic in multi-company watchlists by selecting Stripe, Palantir, and Ramp with exact ATS/token identities.

## Task Commits

Each task was committed atomically:

1. **Task 1: Exclusive due-company claim migration** - `661bbd1` (fix)
2. **Task 2: Disposable watchlist verification and seed regression** - `5a897d1` (fix)
3. **Task 3: Hosted pipeline probes 13-16** - `d30f070` (test)

## Files Created/Modified

- `supabase/migrations/0008_claim_exclusive.sql` - Replaces the applied RPC definition through a new migration using a locking CTE and service-role-only grants.
- `scripts/verify-watchlist.ts` - Uses a disposable probe row and verifies seed identities/job links remain intact.
- `scripts/verify-pipeline.ts` - Adds hosted probes 13-16, exact seed resolution, and safe close-probe recovery.

## Decisions Made

- Keep migration `0006` immutable because it is already applied; redefine the RPC only in migration `0008`.
- Set the disposable watchlist row's `last_polled_at` to the current timestamp so minute cron cannot claim the fake board during its short lifetime.
- Treat the first-sight description and timestamp as immutable during reopen verification and restore the original open state if the temporary close probe aborts.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Resolved seed companies by exact ATS identity**
- **Found during:** Task 3
- **Issue:** The existing verifier looked up seeds only by ATS type, so another company on the same ATS could make `maybeSingle()` fail and the new probes could mutate non-seed rows.
- **Fix:** Added each seed's board token and selected by both `ats_type` and `board_token`; the shared seed list is filtered to the same exact identities.
- **Files modified:** `scripts/verify-pipeline.ts`
- **Verification:** Syntax check and all 78 web tests pass.
- **Commit:** `d30f070`

**2. [Rule 2 - Missing Critical Functionality] Restored temporary close state on failed reopen verification**
- **Found during:** Task 3
- **Issue:** If probe 15 failed after manually closing a production job, the verifier could leave that row closed and alter hosted job state.
- **Fix:** Captured the original `last_seen_at` and added finally cleanup that reopens/restores the row unless the probe proves the normal poll path already reopened it.
- **Files modified:** `scripts/verify-pipeline.ts`
- **Verification:** Syntax check passes and cleanup is limited to the captured probe row ID.
- **Commit:** `d30f070`

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing critical safety behavior).
**Impact on plan:** Both changes strengthen deterministic, non-destructive hosted verification without changing the production schema or runtime API contracts.

## Issues Encountered

- Git metadata writes required the normal repository commit permission; all three scoped commits completed successfully.
- Plan 02-04 executed concurrently in the shared checkout. Its source and planning files were preserved and never staged by this plan.

## Authentication Gates

None. Hosted scripts were intentionally not executed in this plan; deployment and hosted execution are deferred to Plan 02-07.

## Known Stubs

None.

## Verification

- `node --check scripts/verify-watchlist.ts` - passed.
- `node --check scripts/verify-pipeline.ts` - passed.
- Migration acceptance greps for locking, security invoker, empty search path, revoke, and grant posture - passed.
- Disposable-probe and seed-integrity acceptance greps - passed.
- Probes 13-16, concurrency-set, and immutable-snapshot acceptance greps - passed.
- `cd web && npx vitest run` - 12 files and 78 tests passed.
- `git diff --check HEAD~3..HEAD` - passed.
- Migration `0006` remains unmodified.

## Next Phase Readiness

- Migration `0008` and both verification scripts are ready for Plan 02-07 to push/deploy and execute against the hosted project.
- Hosted evidence remains deliberately pending until migrations `0008`/`0009` and the Plan 02-04/02-06 function changes are deployed together.

## Self-Check: PASSED

- All three implementation and verification files exist.
- Commits `661bbd1`, `5a897d1`, and `d30f070` exist.
- All plan acceptance checks and the 78-test suite pass.
- Unrelated `.DS_Store` and dashboard files remain unstaged and unmodified by this plan.

---
*Phase: 02-watchlist-ingestion-monitoring*
*Completed: 2026-07-17*

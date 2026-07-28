---
phase: 04-application-tracker
plan: 01
subsystem: database
tags: [postgres, supabase, rls, react-query, application-tracker, tdd]
requires:
  - phase: 03.6-us-only-workday-expansion
    provides: Server-authoritative Dashboard lifecycle queue and Mark Applied browser seam
  - phase: 01-foundation-access
    provides: Supabase authentication, private resumes, and owner-scoped RLS conventions
provides:
  - Owner-scoped application aggregate with immutable system snapshots and optional owner-bound resume linkage
  - Chronological six-stage event ledger with trigger-derived current projection and final-event protection
  - Atomic Dashboard Mark Applied RPC, legacy applied-history backfill, and tracker-backed applied projection
  - Validated TypeScript tracker contracts and first usable owned application table on /tracker
affects: [04-02, 04-03, 04-04, 04-05, dashboard, tracker, resumes]
tech-stack:
  added: []
  patterns:
    - Owner-scoped aggregate plus chronological event ledger
    - Narrow security-definer mutation RPCs with exact ACLs and empty search paths
    - Runtime-validated snake_case database responses mapped to camelCase browser contracts
key-files:
  created:
    - supabase/migrations/0053_application_tracker.sql
    - web/src/lib/tracker.ts
    - web/tests/application-tracker-happy-path.test.tsx
    - web/tests/migration-0053-application-tracker.test.ts
  modified:
    - web/src/lib/feed.ts
    - web/src/lib/feed.test.ts
    - web/src/pages/Tracker.tsx
key-decisions:
  - "System tracker membership is immutable provenance keyed by owner and source job; current stage changes never return the job to Active."
  - "All lifecycle changes append or correct dated events, while current stage and date remain database-derived projections."
  - "Manual creation sends exactly six inputs including the client-visible current date and returns one named application_id/duplicate_warning record."
patterns-established:
  - "Tracker writes: browser code calls field-discriminated RPCs instead of generic table updates."
  - "Durable snapshots: system company, title, URL, location, description, and partial status never depend on a later live jobs row."
requirements-completed: [TRAK-01, TRAK-04]
coverage:
  - id: D1
    description: "Dashboard Mark Applied atomically creates or reuses one owned system application, records Applied history, and permanently excludes tracker membership from Active."
    requirement: TRAK-01
    verification:
      - kind: integration
        ref: "web/tests/application-tracker-happy-path.test.tsx#Dashboard Mark Applied → Tracker happy path"
        status: pass
      - kind: unit
        ref: "web/tests/migration-0053-application-tracker.test.ts#marks applied atomically, snapshots server data, and backfills legacy history"
        status: pass
    human_judgment: false
  - id: D2
    description: "Applications share exactly six stages with chronological repeated events, correction-driven projection recalculation, and recoverable final-event deletion protection."
    requirement: TRAK-01
    verification:
      - kind: unit
        ref: "web/tests/migration-0053-application-tracker.test.ts#uses exactly the six locked tracker stage slugs"
        status: pass
      - kind: unit
        ref: "web/tests/migration-0053-application-tracker.test.ts#derives the current projection from stable event order and protects the final event"
        status: pass
    human_judgment: false
  - id: D3
    description: "Tracker rows preserve system job context independently and couple optional resumes to the same owner while resume deletion clears only the reference."
    requirement: TRAK-04
    verification:
      - kind: unit
        ref: "web/tests/migration-0053-application-tracker.test.ts#couples application, event, and resume ownership without deleting applications"
        status: pass
      - kind: integration
        ref: "web/tests/application-tracker-happy-path.test.tsx#renders the owned durable system snapshot on the Tracker route at Applied"
        status: pass
    human_judgment: false
duration: 7min
completed: 2026-07-27
status: complete
---

# Phase 04 Plan 01: Atomic Dashboard-to-Tracker Vertical Slice Summary

**Owner-scoped application snapshots with a six-stage dated event ledger, atomic Mark Applied RPC, legacy backfill, and a visible Tracker table**

## Performance

- **Duration:** 7 min
- **Started:** 2026-07-28T03:27:42Z
- **Completed:** 2026-07-28T03:34:48Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Added the forward-only `0053` schema with owner-scoped applications, repeated chronological stage events, RLS, exact RPC ACLs, deterministic projection updates, and owner-safe resume cleanup.
- Changed Dashboard Mark Applied from a direct timestamp update to one idempotent transaction that snapshots the job, appends Applied only when needed, preserves legacy history, and keeps tracker members out of Active.
- Added validated tracker list/detail/manual/applied-history contracts and replaced the `/tracker` placeholder with the first accessible, owned system-application table.
- Locked the migration, browser RPC, current-date manual creation, exact six stages, earliest-Applied history, and Dashboard-to-Tracker path with behavior-first tests.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write the failing Dashboard-to-Tracker happy-path and migration contracts** — `68eedfe` (test)
2. **Task 2: Implement the atomic Mark Applied to Tracker vertical slice** — `976bf63` (feat)

## Files Created/Modified

- `supabase/migrations/0053_application_tracker.sql` — application aggregate, event ledger, projection trigger, hardened tracker RPCs, backfill, and Dashboard projections.
- `web/src/lib/tracker.ts` — six-stage types, strict response parsers, owned queries, and narrow mutations.
- `web/src/lib/feed.ts` — validated scalar `mark_job_applied` client.
- `web/src/pages/Tracker.tsx` — loading, error, empty, and populated application table states.
- `web/tests/migration-0053-application-tracker.test.ts` — raw migration/security/schema contract coverage.
- `web/tests/application-tracker-happy-path.test.tsx` — Dashboard-to-Tracker, current-date manual creation, exact stages, and applied projection coverage.
- `web/src/lib/feed.test.ts` — hardened Mark Applied RPC result and error behavior.

## Decisions Made

- Preserved system provenance with a partial unique owner/source-job index rather than deriving tracker membership from mutable `user_jobs.applied_at`.
- Used a database-owned immutable HTTPS/no-credentials validator in constraints, snapshot projection, and RPC input checks, while browser parsers independently enforce the same rule.
- Kept all direct application/event writes unavailable to authenticated clients; every mutation is a narrow owner-checking function.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Replaced assumed URL parser primitives with an executable PostgreSQL validator**
- **Found during:** Task 2 (migration implementation)
- **Issue:** The RED contract initially described URL checks through parser-like primitives that PostgreSQL does not provide.
- **Fix:** Added one immutable `tracker_https_url_valid(text)` function enforcing HTTPS and rejecting credentials in the authority, then updated structural assertions to verify the same behavior.
- **Files modified:** `supabase/migrations/0053_application_tracker.sql`, `web/tests/migration-0053-application-tracker.test.ts`
- **Verification:** Focused migration suite and full web suite pass.
- **Committed in:** `976bf63`

**2. [Rule 1 - Bug] Corrected mock-call isolation in the Mark Applied contract**
- **Found during:** Task 2 GREEN verification
- **Issue:** The Supabase mock retained unrelated historical mock metadata even though the explicit lifecycle call trace had been reset.
- **Fix:** Asserted the exact reset RPC call trace, which proves one `mark_job_applied` call and no table operation without depending on stale mock metadata.
- **Files modified:** `web/src/lib/feed.test.ts`
- **Verification:** Focused lifecycle tests pass.
- **Committed in:** `976bf63`

---

**Total deviations:** 2 auto-fixed bugs.
**Impact on plan:** Both corrections made the contracts executable without reducing security or behavior coverage; no feature scope was added.

## Issues Encountered

The build retains the existing non-blocking JavaScript chunk-size advisory and two pre-existing lint warnings in `AuthProvider.tsx` and the Dashboard cursor control-character regex. No new lint errors or warnings were introduced.

## User Setup Required

None - migration `0053` remains intentionally unapplied until the Phase 04 release workflow.

## Next Phase Readiness

- Plans 04-02 through 04-05 can consume the stable tracker types, complete narrow RPC inventory, event projection, manual-create response, and Dashboard applied-history projection.
- The schema is locally verified but not pushed; hosted RLS and cross-user probes remain assigned to the later release/verification plan.
- No blocking issues remain for the next tracker plan.

## Self-Check: PASSED

- All four created files and three modified production/test files exist.
- Task commits `68eedfe` and `976bf63` exist in Git history.
- Focused tests pass 48/48; the full web suite passes 1,463/1,463.
- Production build, lint, and `git diff --check` exit 0.
- Stub scan found no goal-blocking placeholder or unwired empty-data path in created/modified files.
- Threat-surface scan found only the tables, RPCs, snapshot rendering boundary, and resume/event trust boundaries already covered by the plan threat model.

---
*Phase: 04-application-tracker*
*Completed: 2026-07-27*

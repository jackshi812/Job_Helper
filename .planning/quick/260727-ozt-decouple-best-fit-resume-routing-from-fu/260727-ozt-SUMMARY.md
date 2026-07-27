---
phase: quick-260727-ozt
plan: 01
subsystem: database-api-ui
tags: [postgres, supabase-edge, react, routing, revisions, cas]
requires:
  - phase: 03.4
    provides: deterministic ranking worker, atomic finalizer, and dashboard feed
provides:
  - Page-bounded deterministic Best Fit resume routing
  - Monotonic per-user route invalidation and guarded bulk publication
  - Stale-route suppression without score or ranking evidence changes
affects: [dashboard, resume-extraction, deterministic-ranking]
tech-stack:
  added: []
  patterns:
    - Independent revisioned projection with expected-revision publication
    - Best-effort page-local enrichment that cannot fail the primary feed
key-files:
  created:
    - supabase/migrations/0052_decouple_resume_routing.sql
    - supabase/functions/route-dashboard-resumes/index.ts
    - web/tests/resume-routing-migration.test.ts
    - web/tests/resume-routing-source.test.ts
  modified:
    - supabase/functions/_shared/routing.ts
    - supabase/functions/_shared/deterministic-worker.ts
    - supabase/functions/extract-resume/index.ts
    - web/src/lib/feed.ts
    - web/src/pages/Dashboard.tsx
key-decisions:
  - "Keep deterministic ranking publication route-free; legacy route staging arguments remain null for rollout compatibility."
  - "Treat zero keyword overlap as no route instead of inventing a filename-ordered winner."
  - "Route only the database page just returned and preserve it unchanged on any routing failure or invalid response."
patterns-established:
  - "Route freshness requires equal positive owner and row revisions."
  - "Privileged route publication authenticates the bearer before service-role construction and independently validates ownership in SQL."
requirements-completed:
  - QUICK-OZT-01
  - QUICK-OZT-02
  - QUICK-OZT-03
  - QUICK-OZT-04
  - QUICK-OZT-05
  - QUICK-OZT-06
  - QUICK-OZT-07
coverage:
  - id: D1
    description: Resume extraction is the only AI boundary and deterministic ranking has no routing capability.
    requirement: QUICK-OZT-01
    verification:
      - kind: unit
        ref: web/tests/deterministic-ranking-source.test.ts
        status: pass
    human_judgment: false
  - id: D2
    description: Route invalidation and page publication use independent revisions and a locked expected-revision guard.
    requirement: QUICK-OZT-03
    verification:
      - kind: integration
        ref: web/tests/resume-routing-migration.test.ts
        status: pass
    human_judgment: false
  - id: D3
    description: Authenticated routing is bounded to 200 owner rows and uses the shared pure routeResume function.
    requirement: QUICK-OZT-07
    verification:
      - kind: unit
        ref: web/tests/resume-routing-source.test.ts
        status: pass
    human_judgment: false
  - id: D4
    description: Zero overlap publishes no Best Fit or runner-up.
    requirement: QUICK-OZT-06
    verification:
      - kind: unit
        ref: web/tests/routing.test.ts
        status: pass
    human_judgment: false
  - id: D5
    description: Each loaded feed page routes independently and routing failure preserves deterministic evidence.
    requirement: QUICK-OZT-04
    verification:
      - kind: unit
        ref: web/src/lib/feed.test.ts
        status: pass
    human_judgment: false
  - id: D6
    description: Dashboard hides stale route labels while keeping scores visible.
    requirement: QUICK-OZT-05
    verification:
      - kind: automated_ui
        ref: web/src/pages/Dashboard.test.tsx
        status: pass
    human_judgment: false
duration: 9min
completed: 2026-07-27
status: complete
---

# Quick Task 260727-ozt: Decouple Best Fit Resume Routing Summary

**Revision-guarded, page-bounded Best Fit routing now refreshes loaded dashboard rows without rebuilding or rewriting deterministic rankings.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-07-27T23:05:00Z
- **Completed:** 2026-07-27T23:14:25Z
- **Tasks:** 3
- **Files modified:** 14

## Accomplishments

- Removed resume reads, route computation, and route maintenance from the deterministic ranking worker while preserving its claim, evaluation, recovery, and finalization behavior.
- Added forward-only route revisions, transactional resume invalidation, a service-only guarded page publisher, and an auth-first Edge routing boundary.
- Routed only the page returned by each dashboard request, strictly validated response IDs, hid stale labels, and isolated routing failures from deterministic scores.

## Task Commit

All three tightly coupled tasks were delivered in one atomic implementation commit:

- `1caaa5c` — `feat(quick-260727-ozt): decouple resume routing`

Planning artifacts are intentionally uncommitted for the orchestrator.

## Files Created/Modified

- `supabase/migrations/0052_decouple_resume_routing.sql` — route revisions, triggers, route-free finalizer, guarded publisher, and feed revision projection.
- `supabase/functions/route-dashboard-resumes/index.ts` — authenticated page routing handler with no AI or ranking capability.
- `supabase/functions/_shared/routing.ts` — truthful zero-overlap semantics.
- `supabase/functions/_shared/deterministic-worker.ts` — deterministic evaluation with route-free maintenance and staging.
- `supabase/functions/extract-resume/index.ts` — ready publication relies on transactional trigger invalidation.
- `web/src/lib/feed.ts` — page-local route invocation, strict response parsing, and freshness helper.
- `web/src/pages/Dashboard.tsx` — route labels render only for current revisions.
- Focused migration, source, routing, feed, scoring-input, and Dashboard regression tests.

## Decisions Made

- Preserved rolling deployment compatibility by continuing to pass null route arguments to the legacy staging RPC while migration 0052 prevents the finalizer from copying route columns.
- Wrapped the exact 0048 dashboard page implementation and augmented its row JSON with route revisions, preserving its filters, keyset contract, RLS boundary, 200-row cap, and ordinal result order.
- Kept routing enrichment best-effort in the browser: malformed, failed, or conflicting route calls return the original page object.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Kept route revision fields optional in the shared TypeScript interface**

- **Found during:** Production build verification
- **Issue:** Historical test fixtures outside the plan construct partial `FeedRow` values and failed project-reference compilation after the two new fields became required.
- **Fix:** Made the two additive fields optional while the live dashboard RPC always supplies them; the freshness helper still fails closed for absent values.
- **Files modified:** `web/src/lib/feed.ts`
- **Verification:** `npx tsc --noEmit`, `npm test`, and `npm run build`
- **Committed in:** `1caaa5c`

**Total deviations:** 1 auto-fixed (1 Rule 3)

## Issues Encountered

- The local Supabase Docker stack was not running (`supabase_db_Linkedin` did not exist), so the optional isolated migration exercise could not run. Migration/source contract tests passed, and no hosted environment was mutated.
- Lint passed with two pre-existing warnings in `AuthProvider.tsx` and the existing control-character validation regex in `feed.ts`.

## Known Stubs

None.

## Verification

- Focused plan suite: 7 files, 89 tests passed.
- Full web suite: 67 files, 1,446 tests passed.
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed with two pre-existing warnings.
- `npm run build`: passed; Vite reported the existing large-chunk advisory.
- `git diff --check`: passed.

## User Setup Required

None.

## Next Phase Readiness

Ready for migration-first rollout followed by Edge functions and frontend. The first loaded page will lazily publish current route labels; older pages remain stale until loaded.

## Self-Check: PASSED

All four created implementation/test artifacts and this summary exist; implementation commit `1caaa5c` is present in repository history.

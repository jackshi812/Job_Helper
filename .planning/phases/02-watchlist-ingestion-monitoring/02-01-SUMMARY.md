---
phase: 02-watchlist-ingestion-monitoring
plan: 01
subsystem: watchlist
tags: [supabase, postgres, rls, edge-functions, react-query, vitest]

requires:
  - phase: 01-foundation-access
    provides: Authenticated Supabase sessions, browser client, dense-table UI patterns, and hosted RLS verification conventions
provides:
  - Pure Greenhouse, Lever, and Ashby URL detection with allowlisted endpoint construction
  - Hosted shared companies table and JWT-protected verify-board Edge Function
  - Watchlist add, list, health badge, and confirmed remove experience
  - Hosted shared-RLS probes and idempotent Stripe, Palantir, and Ramp seeds
affects: [02-02-ingestion-pipeline, 02-03-aggregator-liveness, phase-3-feed]

tech-stack:
  added: []
  patterns:
    - Shared pure TypeScript URL classifier consumed by both the SPA and Edge Functions
    - Browser precheck followed by authoritative server verification before insert
    - Deliberately shared authenticated-only RLS for global watchlist data

key-files:
  created:
    - supabase/migrations/0005_watchlist.sql
    - supabase/functions/_shared/detect.ts
    - supabase/functions/verify-board/index.ts
    - web/tests/detect.test.ts
    - web/src/lib/watchlist.ts
    - web/src/lib/watchlist.test.ts
    - scripts/verify-watchlist.ts
  modified:
    - web/src/pages/Watchlist.tsx

key-decisions:
  - "Parse pasted URLs in the browser for immediate rejection, then repeat detection in verify-board so the server remains the authoritative SSRF boundary."
  - "Keep companies globally shared between the two authenticated users while granting no anonymous table access."
  - "Represent watchlist edits as remove and re-add because every stored polling identity field is derived from live URL verification."

patterns-established:
  - "Verify then save: no company row is inserted until verify-board confirms an allowlisted ATS endpoint."
  - "Health precedence: three failures is Failing; otherwise a missing or older-than-30-minute success is Stale; all other rows are OK."

requirements-completed: [PREF-02, PREF-03, PREF-04]

coverage:
  - id: D1
    description: Greenhouse, Lever, and Ashby URLs are detected and converted only to allowlisted API endpoints; unsupported URLs fail without I/O.
    requirement: PREF-03
    verification:
      - kind: unit
        ref: "web/tests/detect.test.ts (25 passing tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: The hosted companies table provides shared authenticated CRUD while anonymous access and anonymous verify-board invocation are denied.
    requirement: PREF-02
    verification:
      - kind: integration
        ref: "node --env-file=scripts/.env scripts/verify-watchlist.ts (5 hosted probes pass)"
        status: pass
      - kind: integration
        ref: "anonymous POST /functions/v1/verify-board returns HTTP 401"
        status: pass
    human_judgment: false
  - id: D3
    description: The Watchlist page adds verified companies, renders source and health state, and removes rows through confirmation.
    requirement: PREF-02
    verification:
      - kind: unit
        ref: "web/src/lib/watchlist.test.ts"
        status: pass
      - kind: other
        ref: "cd web && npm run build"
        status: pass
    human_judgment: true
    rationale: Browser interaction, dense-table usability, dark-mode styling, and confirmation behavior require end-of-phase visual UAT.
  - id: D4
    description: Health derives deterministically at the 3-failure and 30-minute boundaries and displays OK, Failing, or Stale with last-success hover text.
    requirement: PREF-04
    verification:
      - kind: unit
        ref: "web/src/lib/watchlist.test.ts#deriveHealth"
        status: pass
    human_judgment: true
    rationale: Unit tests prove the state calculation; badge colors, labels, and hover presentation require visual UAT.

duration: 16 min
completed: 2026-07-17
status: complete
---

# Phase 2 Plan 1: Watchlist Management Summary

**Shared authenticated watchlist with live ATS verification, SSRF-safe endpoint construction, health badges, and hosted cross-user RLS proof**

## Performance

- **Duration:** 16 min
- **Started:** 2026-07-17T02:06:06Z
- **Completed:** 2026-07-17T02:22:22Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Added pure, unit-tested URL detection and endpoint construction for current Greenhouse, Lever, and Ashby board URL shapes.
- Applied migration `0005` to the hosted `job-copilot` project and deployed a JWT-protected `verify-board` function that never fetches a pasted URL directly.
- Replaced the Watchlist stub with verified add, dense shared table, health badges, and confirmed removal backed by a tested data-access layer.
- Proved unsupported/not-found/success responses, cross-user visibility and deletion, anonymous denial, and seeded three real boards through the verify-then-insert flow.

## Task Commits

Each task was committed atomically:

1. **Task 1: ATS URL detection module** - `769e888` (test), `b0d6a0d` (feat)
2. **Task 2: Shared companies migration and verify-board deploy** - `5117c67` (feat)
3. **Task 3: Watchlist data layer, UI, tests, and hosted verification** - `4c27fc1` (feat)

## Files Created/Modified

- `supabase/functions/_shared/detect.ts` - Pure ATS URL detection, shared rejection copy, and allowlisted endpoint construction.
- `web/tests/detect.test.ts` - Detection and endpoint unit coverage across supported and rejected URL shapes.
- `supabase/migrations/0005_watchlist.sql` - Shared companies table, health fields, index, grants, and authenticated-only RLS.
- `supabase/functions/verify-board/index.ts` - Hosted live board verification with JWT enforcement and ATS-specific response parsing.
- `web/src/lib/watchlist.ts` - Verify-then-save CRUD layer and health derivation.
- `web/src/lib/watchlist.test.ts` - Health-boundary and rejection-before-network tests.
- `web/src/pages/Watchlist.tsx` - Add form, dense table, health badges, and removal confirmation.
- `scripts/verify-watchlist.ts` - Hosted rejection, shared-RLS, anonymous-access, and seed verification.

## Decisions Made

- Browser detection is an immediate UX precheck; `verify-board` repeats detection and constructs the outbound endpoint so bypassing the SPA cannot widen the SSRF allowlist.
- `companies` is deliberately shared system data: either authenticated user can read or mutate rows, while anonymous clients receive no rows.
- A company edit is remove plus re-add through the same live verification flow because name, ATS type, board token, and region are all derived values.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Used the linked Supabase pooler for migration transport**
- **Found during:** Task 2 (hosted migration push)
- **Issue:** The direct database hostname repeatedly resolved to an unreachable IPv6 route and failed TLS before PostgreSQL connection.
- **Fix:** Constructed the authenticated URL from the CLI-managed linked pooler metadata and pushed/listed migrations through the IPv4-compatible pooler.
- **Files modified:** None
- **Verification:** Remote migration listing reports local/remote `0005`; hosted probes use the new table successfully.
- **Committed in:** `5117c67` (migration source)

---

**Total deviations:** 1 auto-fixed (1 blocking infrastructure issue).
**Impact on plan:** No scope or schema change; only the transport used to reach the approved hosted database changed.

## Issues Encountered

- The first Supabase CLI call did not inherit the gitignored access token; rerunning with the existing `scripts/.env` credentials authenticated successfully without new user action.
- Supabase reported a non-blocking Docker catalog-cache warning after the hosted migration completed. Remote migration listing independently confirmed `0005` is live.
- The existing `AuthProvider.tsx` fast-refresh lint warning and existing Vite chunk-size warning remain outside this plan; they are recorded in `deferred-items.md`.

## Authentication Gates

- Hosted schema and function mutation approval was received before Task 2. Existing gitignored credentials were sufficient; no new login, secret, or human authentication action was required.

## User Setup Required

None - the project was already linked and its existing gitignored Supabase credentials were sufficient.

## Next Phase Readiness

- Migration `0005` and `verify-board` are live, and Stripe, Palantir, and Ramp are present for the ingestion pipeline to poll.
- Plan 02-02 can build its due queue directly from `companies.last_polled_at` and write the health columns already rendered by this page.
- End-of-phase UAT should visually exercise the Watchlist add/reject/remove flow, badge styling, and dark mode.

## Self-Check: PASSED

- All eight planned files exist.
- Commits `769e888`, `b0d6a0d`, `5117c67`, and `4c27fc1` exist in git history.
- `npm test` passes 58/58 tests; `npm run build` succeeds.
- Hosted migration list reports `0005`; all five hosted watchlist probes pass and all three seed boards are present.

---
*Phase: 02-watchlist-ingestion-monitoring*
*Completed: 2026-07-17*

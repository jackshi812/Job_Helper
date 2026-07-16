---
phase: 01-foundation-access
plan: 02
subsystem: storage-security
tags: [react-query, supabase-storage, postgres, rls, vitest]

requires:
  - phase: 01-01
    provides: Invite-only authentication, resumes schema, private bucket, and owner-scoped policies
provides:
  - Resume upload, list, private download, and storage-first hard-delete UI
  - Accessible single-confirmation dialog for granular deletion
  - Executable two-account proof of table, profile, and storage isolation
affects: [01-03-settings-deploy, phase-03-resume-scoring, future-user-owned-tables]

tech-stack:
  added: [Vitest 4]
  patterns: [UUID storage paths, storage-first deletion, query invalidation, two-client RLS probes]

key-files:
  created:
    - web/src/lib/resumes.ts
    - web/src/components/ConfirmDialog.tsx
    - scripts/verify-rls.ts
  modified:
    - web/src/pages/Resumes.tsx
    - web/package.json
    - web/package-lock.json

key-decisions:
  - "Treat storage deletion as complete only when the API returns exactly the requested object path before deleting metadata."
  - "Use independent publishable-key clients for live isolation proof; privileged credentials never participate in RLS verification."
  - "Keep browser round-trip judgment in end-of-phase UAT while automating helper behavior and hosted authorization probes."

patterns-established:
  - "Resume path: {auth user id}/{crypto.randomUUID()}.{validated extension}; original filenames remain metadata only."
  - "RLS verifier: create one owned fixture, probe every cross-user path, and clean up in finally even when a probe fails."

requirements-completed: [AUTH-03, AUTH-04]

coverage:
  - id: D1
    description: "Resume helpers reject unsafe extensions, use UUID paths, clean up failed metadata inserts, and delete storage before rows."
    requirement: AUTH-04
    verification:
      - kind: unit
        ref: "web/src/lib/resumes.test.ts (5 lifecycle tests via npm test)"
        status: pass
      - kind: integration
        ref: "cd web && npm run build"
        status: pass
    human_judgment: false
  - id: D2
    description: "A signed-in user can upload, list, download, and confirm hard deletion of a DOCX/PDF resume in the browser."
    requirement: AUTH-04
    verification: []
    human_judgment: true
    rationale: "The real browser file picker, blob download, visible table refresh, and dashboard object absence are harvested during end-of-phase UAT."
  - id: D3
    description: "Two publishable-key accounts cannot cross-read, modify, delete, re-parent, list, download, upload, or update each other's rows and files."
    requirement: AUTH-03
    verification:
      - kind: e2e
        ref: "node --env-file=scripts/.env scripts/verify-rls.ts"
        status: pass
    human_judgment: false

duration: 12m
completed: 2026-07-16
status: complete
---

# Phase 1 Plan 2: Resume Lifecycle and RLS Proof Summary

**Private resume lifecycle with UUID object paths, storage-first deletion, and a live two-account isolation proof covering tables, profiles, and files**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-16T16:58:07Z
- **Completed:** 2026-07-16T17:09:54Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Replaced the Resumes placeholder with a dense, responsive upload/list/download/delete surface backed by the hosted private bucket and RLS-scoped metadata table.
- Enforced client-side DOCX/PDF validation, user-ID/UUID storage paths, orphan cleanup, exact-path delete validation, and a single accessible confirmation dialog.
- Proved zero cross-user access with both real accounts across resume rows, row re-parenting, profile rows, and storage download/list/upload operations.
- Added a repeatable Vitest suite with seven passing tests and kept the production build green.

## Task Commits

1. **Task 1 RED: Resume lifecycle behavior tests** - `f68c7d5` (test)
2. **Task 1 GREEN: Secure resume lifecycle UI and helpers** - `f8ea7fc` (feat)
3. **Task 2 RED: RLS verifier assertion contract** - `2834344` (test)
4. **Task 2 GREEN: Hosted two-user RLS isolation proof** - `7fc01b4` (test)

## Files Created/Modified

- `web/src/lib/resumes.ts` - Validated upload, RLS-scoped listing, private download, and storage-first hard deletion.
- `web/src/pages/Resumes.tsx` - React Query UI with dense table, inline errors, object downloads, and per-item deletion.
- `web/src/components/ConfirmDialog.tsx` - Accessible single-confirmation modal with pending-state protection.
- `web/src/lib/resumes.test.ts` - Unit coverage for paths, rejection, orphan cleanup, delete order, and silent empty removal.
- `web/tests/verify-rls.test.ts` - Fail-closed assertion-contract coverage for isolation probes.
- `scripts/verify-rls.ts` - Live two-account PostgREST, profile, and Storage API verifier with guaranteed cleanup.
- `web/package.json` / `web/package-lock.json` - Pinned Vitest test harness and repeatable test script.

## Decisions Made

- Storage deletion must return exactly the requested object before the corresponding row may be deleted; an empty success response is treated as failure.
- Cross-user authorization is tested only with independent publishable-key sessions so the service privilege boundary cannot mask an RLS defect.
- The hosted verifier sanitizes transport failures before they reach logs, while pass/fail output contains labels only.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added the missing test runner required by both TDD tasks**
- **Found during:** Task 1 RED
- **Issue:** The plan marked both tasks TDD, but the scaffold had no test framework or test command.
- **Fix:** Installed pinned Vitest 4, added `npm test`, and committed behavioral tests before implementation.
- **Files modified:** `web/package.json`, `web/package-lock.json`
- **Verification:** Seven tests pass with `npm test`.
- **Committed in:** `f68c7d5`

**2. [Rule 2 - Security] Sanitized network failures in the hosted verifier**
- **Found during:** Task 2 hosted verification
- **Issue:** A sandbox DNS failure could expose configured endpoint details through a nested fetch error.
- **Fix:** Supplied a custom fetch wrapper that converts transport failures to a generic message without changing successful requests.
- **Files modified:** `scripts/verify-rls.ts`
- **Verification:** The escalated hosted run passed all probes and emitted label-only output.
- **Committed in:** `7fc01b4`

**3. [Rule 1 - Tooling bug] Corrected persisted GSD progress after state refresh**
- **Found during:** Plan completion bookkeeping
- **Issue:** `state.update-progress` returned 67% but persisted stale 0%/33% values in `STATE.md`.
- **Fix:** Reconciled the frontmatter percentage and visible progress bar to the two-of-three summary count.
- **Files modified:** `.planning/STATE.md`
- **Verification:** `STATE.md` and `ROADMAP.md` both report two of three plans complete and 67% progress.
- **Committed in:** Final plan metadata commit

---

**Total deviations:** 3 auto-fixed (1 blocking infrastructure, 1 missing security safeguard, 1 tooling bug)
**Impact on plan:** The changes were required for faithful TDD execution, safe verification output, and accurate state tracking; feature scope did not expand.

## Issues Encountered

- The first hosted verification attempt could not resolve external DNS inside the sandbox. The approved network run completed in 3.6 seconds with every probe passing.
- Lint remains exit-zero with one pre-existing Fast Refresh warning in `AuthProvider.tsx`; that file was outside this plan and was not changed.
- The generic key-link scanner expects direct Supabase calls in `Resumes.tsx`, while the plan explicitly routes all UI access through `lib/resumes.ts`; artifact checks, unit tests, the build, and hosted probes verify the intended indirect links.

## Authentication Gates

None. Both preconfigured accounts authenticated in the automated hosted verifier.

## Known Stubs

None in files created or modified by this plan. The browser file round trip is implemented and awaits the configured end-of-phase UAT batch.

## User Setup Required

None - the existing Supabase project, users, bucket, policies, and ignored local credentials were sufficient.

## Next Phase Readiness

- Plan 01-03 can build password and delete-all settings against the proven ownership boundary, deploy the SPA, and run final UAT.
- The resume page's real browser upload/download/delete round trip remains explicitly queued for that end-of-phase UAT; no implementation blocker remains.

## Self-Check: PASSED

All eight plan files exist, all four TDD/task commits resolve, seven tests pass, the production build succeeds, and the hosted two-account verifier reports zero cross-user leaks.

---
*Phase: 01-foundation-access*
*Completed: 2026-07-16*

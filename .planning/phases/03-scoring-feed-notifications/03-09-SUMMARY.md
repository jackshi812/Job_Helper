---
phase: 03-scoring-feed-notifications
plan: 09
subsystem: web-feed
tags: [react-query, feed-freshness, preferences, company-identity, vitest]
status: complete
completed: 2026-07-20
duration: 6m
requires:
  - phase: 03-scoring-feed-notifications
    plan: 08
    provides: "Monotonic refilter revisions, needs_refilter state, provider-agnostic title matching, and truthful source company persistence"
provides:
  - "Current/open Strong and Good focused-feed projection with stale rows retained only for diagnostics"
  - "Post-save feed cancellation, eviction, and refetch after the authenticated revision signal"
  - "Unified truthful company-name mapping with identity-less rows withheld"
affects: [03-10, 03-11, dashboard-uat]
tech-stack:
  added: []
  patterns: [current-state visibility predicate, mutation-driven cache eviction, truthful identity fallback]
key-files:
  created:
    - web/src/pages/Preferences.test.tsx
    - web/tests/preference-refilter-feed.integration.test.ts
    - web/tests/company-name-feed.integration.test.ts
  modified:
    - web/src/lib/feed.ts
    - web/src/lib/feed.test.ts
    - web/src/lib/preferences.test.ts
    - web/src/pages/Preferences.tsx
key-decisions:
  - "Focused visibility requires scored state, score at least 50, no dismissal, needs_refilter=false, and an embedded open job."
  - "Feed identity prefers trimmed normalized companies.name, then a bounded trimmed source_company_name; rows with neither are withheld."
  - "A successful preference save cancels and removes feed cache before showing success, then invalidates feed and preferences; failures leave cache and chips untouched."
patterns-established:
  - "Focused eligibility is a pure current-state predicate; All jobs remains the diagnostic view."
  - "Provider identity is display metadata only and never selects relevance, ranking, or navigation behavior."
requirements-completed: [PREF-01, SCOR-03, SCOR-04]
coverage:
  - id: D1
    description: "Focused feed shows only current open nondismissed Strong and Good rows while diagnostic states remain available to All jobs."
    requirement: SCOR-04
    verification:
      - kind: unit
        ref: "web/src/lib/feed.test.ts#focused feed freshness gap"
        status: pass
      - kind: integration
        ref: "web/tests/preference-refilter-feed.integration.test.ts#preference refilter feed gap"
        status: pass
    human_judgment: false
  - id: D2
    description: "Successful preference saves evict stale feed data after the revision signal and preserve retry state on failure."
    requirement: PREF-01
    verification:
      - kind: unit
        ref: "web/src/lib/preferences.test.ts#savePreferences revision signal"
        status: pass
      - kind: integration
        ref: "web/src/pages/Preferences.test.tsx#preference save cache gap"
        status: pass
    human_judgment: false
  - id: D3
    description: "One ranked feed maps truthful Adzuna, Greenhouse, and Ashby company identities and withholds unnamed rows without fabrication."
    requirement: SCOR-04
    verification:
      - kind: integration
        ref: "web/tests/company-name-feed.integration.test.ts#truthful company feed gap"
        status: pass
    human_judgment: false
---

# Phase 3 Plan 09: Current Focused Feed and Cache Freshness Summary

**The unified dashboard now removes stale preference-era results immediately, admits only current open Strong/Good matches to the focused view, and renders only truthful provider company identities.**

## Performance

- **Duration:** 6 minutes
- **Started:** 2026-07-20T14:25:15Z
- **Completed:** 2026-07-20T14:30:41Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Added a complete focused-feed boundary matrix for pending, failed, filtered, weak, dismissed, closed, needs-refilter, Good, and Strong rows.
- Made preference-save success cancel and remove `['feed']` cache before success messaging, then invalidate feed and preferences against the new server revision.
- Added local preference-to-feed convergence coverage reproducing the stale Research Data Analyst report and retaining only the fresh Equity Research Analyst match.
- Mapped Adzuna source-provided names and normalized Greenhouse/Ashby names in one score-ranked dataset while withholding rows with no truthful identity.

## Task Commits

1. **Task 1: Drive the focused-feed and save-invalidation slice from failing browser contracts** - `80c1bb9` (`test`)
2. **Task 2: Implement current focused visibility and successful-save cache eviction** - `db4eefb` (`feat`)

## Files Created/Modified

- `web/src/lib/feed.ts` - Selects freshness/source identity, enforces focused eligibility, maps company identity, and withholds unnamed list rows.
- `web/src/lib/feed.test.ts` - Covers every focused visibility boundary.
- `web/src/lib/preferences.test.ts` - Proves upsert-before-revision-signal ordering and both failure paths.
- `web/src/pages/Preferences.tsx` - Evicts stale feed cache only after the complete save operation succeeds.
- `web/src/pages/Preferences.test.tsx` - Proves exact success cache-operation order and failure cache preservation.
- `web/tests/preference-refilter-feed.integration.test.ts` - Reproduces stale shared-token visibility and proves local convergence.
- `web/tests/company-name-feed.integration.test.ts` - Proves truthful unified company mapping and identity withholding.

## Decisions Made

- Kept `defaultVisible` as the sole focused-view policy and retained All jobs as the existing diagnostic surface.
- Treated provider/company identity strictly as display data; no source-specific relevance, sorting, tab, or page path was introduced.
- Removed cached feed rows before presenting save success so browser memory cannot briefly represent stale matches as current.

## Verification

- `node scripts/verify-expected-red.mjs --suite web-gap` passed before implementation with exactly 4 intended failures and the 19-test baseline green.
- `cd web && npx vitest run src/lib/feed.test.ts src/lib/preferences.test.ts src/pages/Preferences.test.tsx tests/preference-refilter-feed.integration.test.ts tests/company-name-feed.integration.test.ts tests/notification-removal.test.ts` passed: 33/33 tests.
- `cd web && npm run build` passed.
- `cd web && npm run lint` passed with one pre-existing `react(only-export-components)` warning in `src/auth/AuthProvider.tsx`.
- Stub scan found only intentional test defaults, nullable state, and input placeholder copy; no unimplemented runtime stub exists.
- Threat-surface scan found no new endpoint, auth path, schema change, file access, or provider-specific relevance branch.
- No network access, hosted mutation, deployment, production verifier, or paid AI call occurred.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Completed the existing FeedJob fixture after the type contract expanded**

- **Found during:** Task 2 build verification
- **Issue:** The existing feed unit-test factory lacked the newly required nullable `source_company_name` property, causing TypeScript build failure.
- **Fix:** Added the truthful null value to the tracked-company fixture.
- **Files modified:** `web/src/lib/feed.test.ts`
- **Verification:** Focused tests, production build, and lint all pass.
- **Committed in:** `db4eefb`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** The fixture correction was required by the planned projection/type change and added no runtime scope.

## Issues Encountered

None.

## Known Stubs

None.

## User Setup Required

None. This plan is local-only.

## Next Phase Readiness

- Plan 03-10 can build the fail-closed rollout verifier against a locally green browser slice.
- Rollout approval and the later one-shot paid proof remain separate; this plan performed neither.
- The production verifier still must not make the matching claim before the later sole score-tick proof.

## Self-Check: PASSED

- All three created test files exist.
- Task commits `80c1bb9` and `db4eefb` are present in git history.
- The prescribed tests, notification-removal regression, build, lint, stub scan, and threat-surface scan passed.
- Unrelated `.DS_Store`, `.planning/HANDOFF.json`, and agent-dashboard workspace changes remain untouched.

---
*Phase: 03-scoring-feed-notifications*
*Completed: 2026-07-20*

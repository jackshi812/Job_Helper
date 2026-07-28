---
phase: 04-application-tracker
plan: 05
subsystem: dashboard-tracker-integration
tags: [react, dashboard, tracker, supabase, lifecycle, accessibility]
requires:
  - phase: 04-04
    provides: Complete Tracker spreadsheet and expanded lifecycle experience
provides:
  - Atomic irreversible Dashboard Mark Applied integration
  - Seven-column tracker-backed Show applied history
  - Safe owned-row-only Tracker focus and expansion routing
  - Removal of the legacy reversible Applied client capability
affects: [application-tracker, dashboard, feed, milestone-v1]
tech-stack:
  added: []
  patterns:
    - Historical Dashboard rows consume tracker snapshots rather than ranked feed rows
    - Query-parameter focus resolves only against an RLS-owned all-stage list
    - Durable mutation success invalidates active, tracker, detail, and applied-history keys
key-files:
  modified:
    - web/src/lib/feed.ts
    - web/src/pages/Dashboard.tsx
    - web/src/pages/Dashboard.test.tsx
    - web/src/pages/Tracker.tsx
    - web/src/pages/Tracker.test.tsx
    - web/tests/application-tracker-happy-path.test.tsx
key-decisions:
  - "Keep Dashboard Active on its existing paged feed and load applied history through a separate tracker snapshot query."
  - "Use the database-owned earliest Applied event date directly; never substitute current-stage date or live-job state."
  - "Resolve focus targets through an owner-scoped all-stage list, then expose no missing/non-owned distinction."
requirements-completed: [TRAK-01, TRAK-04]
duration: 8m
completed: 2026-07-28
status: complete
---

# Phase 04 Plan 05: Durable Dashboard-to-Tracker Lifecycle Summary

**Dashboard Mark Applied, Tracker, and Show applied now share one irreversible,
snapshot-backed application lifecycle with safe historical navigation.**

## Accomplishments

- Removed the `undoJobApplied` service, Dashboard import, mutation, target,
  timer, row action, and toast so an ever-applied job cannot return to Active.
- Preserved Active optimistic removal, exact cache rollback, and focus recovery;
  successful Mark Applied now announces
  `{Job title} marked applied and added to Tracker.` and invalidates the exact
  Active, tracker-list, tracker-detail, and applied-history query scopes.
- Added an independent `dashboard-applied-applications` query that consumes the
  exact eight-field snapshot contract rather than coercing history into ranked
  `FeedRow` data.
- Added the exact seven historical columns—Position, Company, Location,
  Applied date, Current stage, Apply link, and Tracker link—with the shared
  stage palette and database-owned original `appliedOn`.
- Kept employer Apply navigation HTTPS-only and mutation-free; no Save to
  tracker action or Apply-link lifecycle side effect exists.
- Added `/tracker?application={id}` handling that validates UUID shape, loads an
  RLS-owned all-stage list, expands only a matching owned row, scrolls it into
  view, and focuses its expand control without revealing missing/non-owned
  identifiers.

## Verification

- Final integration focused gate: 5 files, 93 tests — PASS
- Complete suite: 76 files, 1,524 tests — PASS
- Production TypeScript/Vite build — PASS
- Lint — PASS with two pre-existing warnings
- `git diff --check` — PASS
- Hosted tracker catalog, RLS, ordinary-session behavior, and cleanup evidence
  from Plan 04-03 remain PASS through migrations 0053–0055.
- Interactive owner/browser UAT — NOT RUN because no browser backend was
  connected to this session; no unrelated browser surface was substituted.

## Task Commits

1. Final integration contract RED — `5c15a80`
2. Durable Dashboard/Tracker integration GREEN — `3dcba8d`

## Deviations from Plan

### Auto-fixed issues

**1. The legacy undo function remained callable after the page action was removed**

- Deleted `undoJobApplied` from the feed service so the browser has no competing
  reversible lifecycle capability.

**2. Terminal target rows are absent from the Tracker’s default active filter**

- Added a separate all-stage owner-scoped focus list. A successful owned match
  switches the visible table to all stages before expansion/focus; missing,
  malformed, and non-owned targets receive no existence-specific UI.

## Security and Scope

- Show applied reads only the owner-filtered, system-origin database projection.
- Historical rows do not depend on live/open source jobs, scores, tiers, resume
  routing, or manual applications.
- Historical Apply links remain parsed HTTPS/no-credentials values and open
  with `rel="noreferrer"`.
- Focus targets never call a direct ID detail endpoint before ownership is
  established through the loaded RLS list.
- No provider/AI call, polling change, resume tailoring, package, or manual
  ranking path was added.

## User Setup Required

None.

## Phase 04 Completion

All five plans are complete. The production schema and ordinary-user behavior
are proven, the complete Tracker experience is implemented, Dashboard history
uses the same durable lifecycle, and all four tracker requirements are marked
complete.

## Self-Check: PASSED

- All final plan source and tests exist.
- No Dashboard source reference to Undo applied remains.
- Applied history uses the exact snapshot contract and seven columns.
- Safe focus routing resolves only through owned loaded applications.
- Focused/full tests, build, lint, and diff check pass.
- Unrelated user-owned worktree paths remain unstaged.

---
*Phase: 04-application-tracker*
*Completed: 2026-07-28*

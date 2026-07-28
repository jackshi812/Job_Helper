---
phase: 04-application-tracker
plan: 04
subsystem: tracker-web-experience
tags: [react, tanstack-query, supabase, tracker, accessibility, timeline]
requires:
  - phase: 04-03
    provides: Hosted tracker schema, lifecycle behavior, RLS, and cleanup PASS
provides:
  - Complete semantic spreadsheet tracker with six-stage filters and pinned ordering
  - Manual application capture with exact validation and nonblocking duplicate warning
  - Cell-local serialized saves with retained drafts and real retry actions
  - Lazy expanded timeline, safe JD rendering, notes, and optional resume linking
affects: [04-05, application-tracker, dashboard-applied]
tech-stack:
  added: []
  patterns:
    - Stable TanStack mutation scopes serialize each editable tracker cell
    - List and expanded-detail projections keep JD and event bodies lazy
    - System HTML is sanitized while manual descriptions and notes remain text
key-files:
  created:
    - web/src/lib/tracker.test.ts
    - web/src/components/ApplicationTimeline.tsx
    - web/src/components/ApplicationTimeline.test.tsx
    - web/src/pages/Tracker.test.tsx
  modified:
    - web/src/lib/tracker.ts
    - web/src/pages/Tracker.tsx
    - web/tests/application-tracker-happy-path.test.tsx
key-decisions:
  - "Filter list rows at the Supabase boundary while retaining zero-stage selection as a no-query empty result."
  - "Resolve latest-event date correction lazily from the owned detail query, then call only the narrow event RPC."
  - "Load resume labels in the bounded list projection so the 16px indicator has its required accessible name."
requirements-completed: [TRAK-01, TRAK-02, TRAK-03, TRAK-04]
duration: 22m
completed: 2026-07-28
status: complete
---

# Phase 04 Plan 04: Tracker Spreadsheet Experience Summary

**The `/tracker` route now provides the complete approved spreadsheet,
manual-capture, event-history, notes, JD, and optional-resume workflow over the
production-proven tracker schema.**

## Accomplishments

- Added exact six-stage presentation metadata, active/terminal filters,
  pinned-first stable ordering, chronological event sorting, repeated-stage
  ordinals, date-only validation, notes previews, duplicate normalization, and
  manual-draft validation.
- Hardened the service boundary with bounded list/detail parsing, safe resume
  labels, selected-stage reads, strict six-input manual creation, field-specific
  mutation payloads, and client rejection of system snapshot edits.
- Replaced the placeholder Tracker with one 1,224px semantic table containing
  the approved eight columns, active/terminal/all filters, stage-colored
  accents/tints, immediate pin/stage writes, inline text/date/notes editing, and
  cell-local Saving/Saved/Retry feedback.
- Added one client-only manual row with required company/title/HTTPS URL,
  Ready-to-Apply default, selectable initial stage, read-only current date,
  optional notes, nonblocking duplicate warning, retained failure values, and
  exact success/error recovery copy.
- Added lazy expanded details with a chronological editable timeline, final
  event protection, cancel-first deletion confirmation, full notes, immutable
  system snapshots, sanitized system HTML, plain manual JD text, and optional
  owned-resume selection.
- Preserved the semantic spreadsheet at narrow widths with independent table
  and timeline overflow, leading expand/pin controls, keyboard labels, visible
  focus, and 44px controls.

## Verification

- Tracker service/UI focused gate: 4 files, 40 tests — PASS
- Complete suite: 76 files, 1,520 tests — PASS
- Production TypeScript/Vite build — PASS
- Lint — PASS with two pre-existing warnings
- `git diff --check` — PASS
- Interactive desktop/320px browser check — NOT RUN because this session had
  no connected browser backend; automated responsive, semantic, color, copy,
  and accessibility contracts remain green.

## Task Commits

1. Tracker service contract RED — `5c1fa60`
2. Tracker service implementation GREEN — `8c82b6e`
3. Tracker interaction contract RED — `55dc4c6`
4. Spreadsheet/timeline implementation GREEN — `09ee63e`

## Deviations from Plan

### Auto-fixed issues

**1. Existing happy-path mocks covered only the placeholder query**

- Expanded the established test mock to include mutations and query-client
  behavior without weakening its Mark Applied → Tracker assertions.

**2. Resume indicator lacked its required accessible label**

- Added the owned resume label to the bounded list projection and rejected
  mismatched resume IDs during response parsing.

**3. Compact and expanded notes initially used different save scopes**

- Bound both editors to the same `applicationId:notes` mutation scope so
  concurrent writes cannot resolve out of order.

### Environment limitation

The browser-control runtime reported no available browser. Per its safety
contract, no unrelated automation surface was substituted. This did not affect
the complete automated suite, production build, lint, or static
responsive/accessibility contract checks.

## Security and Scope

- System company/title/JD snapshots remain immutable in the client and database.
- Manual URLs remain HTTPS-only and reject embedded credentials.
- System HTML passes through DOMPurify with `style` and `form` forbidden;
  manual descriptions and all notes render as text.
- List rows omit JD/event bodies; details load only for an expanded owned ID.
- No generic whole-row patch, AI/provider call, polling change, resume
  generation/tailoring, application submission, dependency, Kanban, or manual
  ranking path was added.

## User Setup Required

None.

## Next Plan Readiness

Plan 04-05 may now remove the last reversible Dashboard Applied behavior, render
the seven-column tracker-backed history, and add safe owned-row focus routing.

## Self-Check: PASSED

- All created and modified source/test files exist.
- The exact lifecycle, copy, table, timeline, safety, and recovery contracts are
  represented in source and tests.
- Complete tests, build, lint, and diff check pass.
- Unrelated user-owned worktree paths remain unstaged.

---
*Phase: 04-application-tracker*
*Completed: 2026-07-28*

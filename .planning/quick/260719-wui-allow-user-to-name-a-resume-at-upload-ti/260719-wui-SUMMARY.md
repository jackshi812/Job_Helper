---
phase: quick-260719-wui
plan: 01
subsystem: resumes
status: complete
tags: [resumes, ui, migration, tdd]
requires:
  - public.resumes table (migration 0002)
provides:
  - resumes.display_name column
  - resumeLabel() render helper
  - defaultDisplayName() stem helper
  - uploadResume(file, displayName?) signature
affects:
  - web/src/pages/Resumes.tsx
  - web/src/pages/Dashboard.tsx
  - web/src/pages/JobDetail.tsx
tech-stack:
  added: []
  patterns:
    - Single exported label helper instead of inlined fallback expressions at render sites
key-files:
  created:
    - supabase/migrations/0026_resume_display_name.sql
  modified:
    - web/src/lib/resumes.ts
    - web/src/lib/resumes.test.ts
    - web/src/pages/Resumes.tsx
    - web/src/pages/Dashboard.tsx
    - web/src/pages/JobDetail.tsx
decisions:
  - Normalize blank/whitespace-only names to NULL at the data layer so the UI fallback has exactly one representation of "unnamed"
  - Keep filename authoritative for extension validation, storage path, and the download attribute; display_name is cosmetic only
metrics:
  duration: 5m
  tasks: 3
  files: 6
  completed: 2026-07-19
---

# Quick Task 260719-wui: Resume Display Name Summary

Optional user-chosen resume label captured at upload, threaded through the data layer via a single `resumeLabel()` helper, and rendered across the resume list, dashboard badges, and gap panel — while `filename` stays the authoritative file identity.

## What Was Built

**Task 1 — Migration 0026** (`04a8ad3`)

A single additive `alter table public.resumes add column display_name text`. No NOT NULL, no default, no backfill, no index — existing rows keep NULL so they render exactly as before. The four table-scoped `resumes_*` RLS policies already cover the new column, so no policy was touched. Migration 0025 was never created or read (claimed by the concurrent Phase 03 agent).

**Task 2 — Data layer, TDD** (`1f882b4` RED, `2c37532` GREEN)

RED commit added 10 failing tests; GREEN made all 15 in the suite pass. Added to `web/src/lib/resumes.ts`:

- `resumeLabel(resume)` — returns `display_name ?? filename`. The single render helper; the fallback is never inlined at a call site.
- `defaultDisplayName(filename)` — strips only the final dot-suffix via `lastIndexOf('.')`, guarded with `lastDot <= 0` so dotfile-style names (`.resume`) and dotless names return unchanged.
- `normalizeDisplayName()` (private) — trims, and collapses empty-after-trim or absent to `null`.
- `uploadResume(file, displayName?)` — new optional second parameter fed through `normalizeDisplayName` into the insert payload.
- `display_name` appended to `RESUME_COLUMNS` and to the `ResumeRecord` interface.

**Task 3 — UI** (`a5bf9f2`)

`Resumes.tsx` gained a controlled `displayName` state and an optional "Display name" text input matching the existing `grid gap-1.5 text-sm font-medium` label pattern. The file input's new `onChange` prefills the name with `defaultDisplayName(file.name)` and resets to `''` when the selection is cleared, so the user gets a sensible default they can edit before submitting. The mutation's `mutationFn` now takes `{ file, name }` rather than a bare `File`; `onSuccess` clears the name alongside the existing file-input reset. The table's first column renders `resumeLabel(resume)` and its header changed from "Filename" to "Name"; the delete `ConfirmDialog` names the resume the user recognizes. `Dashboard.tsx` populates its `resumeNames` map through `resumeLabel`, and `JobDetail.tsx` applies it to the routed record while preserving the `'routed'` fallback for a missing match.

## Security Posture

All three `mitigate` dispositions in the plan's threat register hold, verified by grep:

- **T-WUI-01** — `anchor.download = resume.filename` is unchanged. A crafted display name cannot influence the name a file is written to disk under.
- **T-WUI-02** — `allowedExtension(file.name)` and the storage-path construction still read the real file's name. A regression test asserts that `uploadResume(txtFile, 'Anything.pdf')` rejects before any network call, so a display name ending in an allowed extension cannot smuggle a disallowed file past validation.
- The `mark_recent_jobs_for_refilter` RPC call is byte-for-byte unchanged: same call site, same position after the insert, same error handling.

## Verification Results

| Check | Result |
|-------|--------|
| `npx vitest run src/lib/resumes.test.ts` (RED gate) | 10 failed as intended before implementation |
| `npx vitest run src/lib/resumes.test.ts` (GREEN gate) | 15 passed |
| `npx tsc --noEmit` | Clean, no output |
| `npx vitest run` (full suite) | **27 files, 360 tests, all passed** |
| `npm run build` | Succeeded in 183ms |
| Task 1 migration greps | Both automated checks passed |
| `grep "anchor.download = resume.filename"` | Present |
| `grep -c resumeLabel` across 3 pages | Resumes 3, Dashboard 2, JobDetail 2 |
| Deletion check across all 4 commits | No files deleted |

**No foreign or pre-existing failures were encountered.** The full suite was green, so the concurrent Phase 03 work in feed, preferences, scoring, and `web/tests/` did not produce any failures to separate out from these results.

## Concurrency Discipline

Every commit staged explicit paths only; `git diff --cached --name-only` was confirmed before each of the four commits. No `git add -A`, `-u`, `.`, or `commit -a` was used, and no stash/reset/checkout-discard command was run. `git status --porcelain` at completion shows only the other agent's and the user's untouched files: `.DS_Store`, `.planning/ROADMAP.md`, `.planning/STATE.md`, the Phase 03 continue-here and plan files, the debug note, and the two `scripts/agent-dashboard*` files. None of the off-limits paths were read-modified, staged, or committed.

Per the execution environment, `.planning/STATE.md` and `.planning/ROADMAP.md` were treated as read-only and were **not** updated by this task — the Phase 03 agent owns them.

## Deviations from Plan

None — the plan executed exactly as written.

## Known Stubs

None.

## TDD Gate Compliance

Task 2 ran the full cycle with distinct gate commits: `test(...)` at `1f882b4` (RED, 10 failing), `feat(...)` at `2c37532` (GREEN, 15 passing). No REFACTOR commit was needed — the implementation was already minimal.

## Commits

| Commit | Type | Description |
|--------|------|-------------|
| `04a8ad3` | feat | Add nullable display_name to resumes (migration 0026) |
| `1f882b4` | test | Failing tests for resume display name (RED) |
| `2c37532` | feat | Thread display_name through resumes data layer (GREEN) |
| `a5bf9f2` | feat | Capture and render resume display name in UI |

## Follow-Up Notes

Migration 0026 was not applied against a local Supabase stack — no local stack was running during execution. It is a single additive column with no constraint, default, or policy change, so the risk is minimal, but it still needs to reach the hosted database before the UI change is deployed. If it is deployed out of order, `listResumes` will fail its select because `display_name` is in `RESUME_COLUMNS`.

## Self-Check: PASSED

All created and modified files verified present on disk; all four commit hashes verified in `git log`.

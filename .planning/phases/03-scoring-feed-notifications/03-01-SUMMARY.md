---
phase: 03-scoring-feed-notifications
plan: 01
subsystem: preferences-and-cheap-filters
tags: [preferences, rls, cheap-filter, scoring, chip-input]
status: complete
requires: []
provides:
  - "public.preferences per-user table (migration file 0017, local only — not pushed)"
  - "supabase/functions/_shared/filters.ts pure cheapFilter + SYNONYMS"
  - "web/src/lib/preferences.ts loadPreferences/savePreferences/parseChips"
  - "web/src/pages/Preferences.tsx chip-input form + /preferences route + nav entry"
affects:
  - "Plan 03 (adds mark-rescore RPC call to savePreferences)"
  - "Plan 06 (edits NOTF-03 tuning columns via Settings UI)"
  - "Plan 07 (pushes migration 0017 to hosted DB, proves cross-user RLS denial)"
tech-stack:
  added: []
  patterns:
    - "Pure cross-repo module (no runtime globals / registry specifiers) tested from web/tests"
    - "Own-row per-operation RLS in the 0002_resumes.sql style"
    - "TanStack Query ['preferences'] load-on-mount + invalidate-on-save"
key-files:
  created:
    - supabase/migrations/0017_preferences.sql
    - supabase/functions/_shared/filters.ts
    - web/tests/filters.test.ts
    - web/src/lib/preferences.ts
    - web/src/lib/preferences.test.ts
    - web/src/pages/Preferences.tsx
  modified:
    - web/src/main.tsx
    - web/src/components/Shell.tsx
decisions:
  - "D-01/D-02/D-03 filter semantics implemented pure and fixture-proven before any AI call exists"
  - "Exclude matching is token/phrase-boundary (not substring) to prevent short-keyword false positives"
  - "savePreferences omits user_id — DB default auth.uid() + RLS with-check own the row"
metrics:
  duration: "~10 minutes"
  completed: "2026-07-18"
  tasks: 3
  files: 8
---

# Phase 3 Plan 01: Preferences & Cheap Filters Summary

Per-user preferences vertical slice (form → typed lib → per-user RLS table) plus the pure cheap-filter module that gates every AI dollar, with D-01/D-02/D-03 semantics unit-proven before any scoring code exists. Migration 0017 written as a LOCAL FILE ONLY (never pushed to the hosted DB per the Phase 02.1 safety boundary).

## What Was Built

### Task 1 — `supabase/migrations/0017_preferences.sql` (commit 9b76141)
`public.preferences` with `user_id uuid primary key default auth.uid()` (one row per user, D-05), the four filter arrays (`titles`, `locations`, `include_keywords`, `exclude_keywords`) each capped at `cardinality <= 50` (T-3-02, ASVS V5), and the NOTF-03 tuning columns: `notify_threshold integer not null default 75 check (between 0 and 100)` (D-07), nullable `quiet_start`/`quiet_end` (D-19), `digest_time not null default '08:00'` (D-20), `timezone not null default 'America/Chicago'` (IANA, never UTC offset). RLS enabled with the four own-row per-operation policies (`preferences_select_own/insert_own/update_own/delete_own`) copied verbatim from the locked 0002_resumes.sql shape; `grant … to authenticated` only, no anon access. House-style header comment documents the per-user isolation decision. No reference to `user_jobs` (does not exist until Plan 03).

### Task 2 — `supabase/functions/_shared/filters.ts` + `web/tests/filters.test.ts` (commits 6cf2483 RED, bda0804 GREEN)
Pure module (no runtime globals, no registry import specifiers) so `web/tests` imports it cross-repo like `dedup.ts`. Exports `cheapFilter`, `SYNONYMS`, and the `FilterOutcome`/`FilterJobInput`/`FilterPreferences` types. Check order fixed: exclude → location → title. Exclude matching is whole-token / contiguous-phrase (never substring). Location leniency passes on empty prefs, blank location, any `remote` token, or a preferred-location token sequence. Title overlap uses bidirectional `SYNONYMS` token expansion with stopword drop, discarding only on clear non-overlap. `matchedIncludeKeywords` is a soft signal that never discards (D-02). Written test-first: RED confirmed (import failure) before implementation.

### Task 3 — preferences lib, page, nav, route (commit 1cb60a8)
`web/src/lib/preferences.ts`: `PREFERENCE_COLUMNS`, `PreferencesRecord`, `loadPreferences()` (`.maybeSingle()`), `savePreferences()` (`.upsert` on `user_id`, omitting `user_id` per the RLS default), and pure `parseChips()`. `web/src/lib/preferences.test.ts` covers parseChips trim/dedupe/empty with the `vi.mock('./supabase')` pattern. `web/src/pages/Preferences.tsx`: single-column form with four chip inputs (Enter/comma adds a chip, Backspace removes last), neutral-badge chips with `aria-label={`Remove ${keyword}`}` remove buttons at ≥36px hit area, verbatim helper texts, primary `Save preferences` button with `disabled:cursor-wait disabled:opacity-60`, inline success/failure copy, and `queryKey: ['preferences']` load-on-mount. Route `path="preferences"` added inside the RequireAuth/Shell group; `Preferences` nav entry added between Dashboard and Watchlist.

## Must-Have Verification

| Must-have | Evidence |
|-----------|----------|
| Preferences page: target titles, locations, include/exclude keywords, saveable (PREF-01, D-05) | Preferences.tsx four chip inputs + savePreferences upsert; route + nav wired; build green |
| Cheap filter D-01/D-02/D-03 pure, no runtime globals / registry specifiers, unit-proven before any AI call | filters.ts (0 forbidden specifiers), 17 fixtures green; no scoring/AI code created this plan |
| Schema carries notify_threshold (default 75), quiet hours, digest time, timezone | 0017_preferences.sql columns present; grep verify passed |
| Exclude token/phrase-boundary (no substring false positives) | c/Cloud, go/Category, staff/Staffing pass; go/Go Developer discards — all green |
| Exclude checked before location | order-proof fixture returns `excluded_keyword` when both apply — green |
| Artifacts (all 8 files) with min-lines | filters.test.ts 200≥40, Preferences.tsx 205≥80; all files present |
| Key links | Preferences.tsx→lib/preferences imports; lib→`from('preferences')` upsert; main.tsx `path="preferences"` |

## Local Gate Results

- `npx vitest run tests/filters.test.ts` — **17 passed**
- `npx vitest run src/lib/preferences.test.ts` — **4 passed**
- `npm test` (full suite) — **24 files, 322 tests passed**
- `npm run build` (tsc -b + vite) — **green** (pre-existing >500 kB chunk advisory only; not introduced here)
- `npm run lint` (oxlint) — **green**; sole warning is pre-existing `AuthProvider.tsx:120` (out of scope, untouched)

## Deviations from Plan

None — plan executed exactly as written. The filters.ts header comment was reworded to avoid the literal `Deno.`/`npm:`/`jsr:` substrings so the purity acceptance check (`no occurrences`) passes on the file text, not just on imports.

## Safety Boundary Compliance

- Migration written as a FILE ONLY at the pinned path `0017_preferences.sql`; no hosted push, no schema apply, no paid API call, no deployment, no live verifier run.
- Did not modify poll-tick, lifecycle, connectors, adapters, or migrations 0012–0016; no `jobs.source` enumeration added.
- Did not stage/commit `.DS_Store`, `scripts/agent-dashboard.mjs`, `scripts/agent-dashboard.test.mjs`, or `.planning/STATE.md` (left for the orchestrator).

## Self-Check: PASSED

All 6 created artifacts exist on disk; all 4 commits (9b76141, 6cf2483, bda0804, 1cb60a8) present in git log.

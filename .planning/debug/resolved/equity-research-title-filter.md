---
status: resolved
trigger: 'Phase 03 UAT Test 2: include only equity research as title, got data related roles after refreshing.'
created: 2026-07-20T03:57:27Z
updated: 2026-07-20T19:42:27Z
---

## Current Focus

hypothesis: Confirmed and resolved — the permissive one-token title policy and stale feed visibility caused the false positives.
test: Production UAT completed; the user explicitly reported "all tests pass."
expecting: Unrelated shared-token roles remain excluded from the current focused feed.
next_action: None; archive this resolved session.

## Symptoms

expected: Saving only Equity Research as the target title should remove unrelated data roles from the focused feed after refresh.
actual: User saved only Equity Research as title and got data-related roles after refreshing.
errors: None reported.
reproduction: Phase 03 UAT Test 2 in .planning/phases/03-scoring-feed-notifications/03-UAT.md.
started: Discovered during UAT after hosted feed-only deployment.

## Eliminated

- hypothesis: The deployed authenticated refilter RPC is wholly missing or unusable because of its original column-grant failure.
  evidence: Migration 0022 replaces it with a security-definer function scoped to auth.uid(); the already-recorded hosted verification passed the flag-and-clear probe.
  timestamp: 2026-07-20T03:59:35Z

- hypothesis: The pure filter cannot reject data roles for an Equity Research preference.
  evidence: Direct execution rejects Data Analyst and Data Researcher with title_non_overlap; the defect is permissive one-token matches and stale processing, not a total absence of title filtering.
  timestamp: 2026-07-20T03:59:35Z

## Evidence

- timestamp: 2026-07-20T03:58:05Z
  checked: web/src/pages/Preferences.tsx and web/src/lib/preferences.ts
  found: Save upserts the four arrays, then awaits mark_recent_jobs_for_refilter; the success message is shown only after both calls succeed. The page reloads persisted arrays through loadPreferences.
  implication: A normal displayed success rules against a simple missing-save or missing-RPC-call path, though hosted values cannot be observed in this offline investigation.

- timestamp: 2026-07-20T03:58:05Z
  checked: supabase/functions/_shared/filters.ts and web/tests/filters.test.ts
  found: Title matching passes when any one significant/synonym-expanded token overlaps. No fixture covers Equity Research against data-role variants.
  implication: Roles sharing only "research" or "equity" survive the cheap filter by design even if the rest of the title is unrelated.

- timestamp: 2026-07-20T03:58:05Z
  checked: supabase/functions/score-tick/index.ts
  found: Preference saves do not synchronously filter feed rows. A per-minute worker later processes needs_refilter. For already-scored rows that still pass and keep the same routed resume, it clears needs_refilter without rescoring against the new preferences.
  implication: A browser refresh can show stale rows before the worker runs; permissively passing rows can retain scores/reasons generated from the previous target titles.

- timestamp: 2026-07-20T03:58:05Z
  checked: migrations 0019/0021/0022 and web/src/lib/feed.ts
  found: Only user_jobs linked to jobs first_seen within 7 days are flagged. Claiming excludes attempts >=5. The feed reads up to 200 rows without a 7-day cutoff and default visibility depends only on status=scored, score>=50, and not dismissed.
  implication: Older rows and retry-exhausted rows can remain visibly stale forever after a preference edit.

- timestamp: 2026-07-20T03:58:05Z
  checked: .planning/phases/03-scoring-feed-notifications/03-CONTEXT.md and 03-03-PLAN.md
  found: D-01 explicitly chose one-word fuzzy overlap and D-10 explicitly accepts stale scores older than about 7 days; plan review already warned title overlap is very permissive.
  implication: The reported behavior is consistent with documented implementation tradeoffs, but conflicts with the stricter UAT truth that unrelated roles must disappear.

- timestamp: 2026-07-20T03:59:35Z
  checked: Direct cheapFilter execution with titles=[Equity Research]
  found: Data Analyst and Data Researcher were rejected, but Research Data Analyst, Equity Data Analyst, and Equity Research Data Analyst all passed solely because one token overlapped.
  implication: The target-title implementation demonstrably admits unrelated data-role variants under the reported preference.

- timestamp: 2026-07-20T03:59:35Z
  checked: Existing filter suite
  found: All 17 tests passed, but the suite tests only a total non-overlap and a positive synonym pair; it contains no generic/shared-token negative cases despite the earlier review requesting them.
  implication: Current tests lock in permissive behavior without guarding the UAT expectation.

- timestamp: 2026-07-20T03:59:35Z
  checked: scripts/verify-scoring.ts refilter probe and recorded UAT automated result
  found: The hosted probe verified one recent, manually armed row can be flagged and cleared; it explicitly sets the target attempts to 0 and all other rows to 5, then restores them.
  implication: This proves the RPC/worker signal exists but does not prove ordinary older or attempts-exhausted rows are refreshed.

## Resolution

root_cause: Target titles are not enforced as an exclusive constraint. cheapFilter accepts any job title sharing one significant token with any preferred title, so Equity Research admits titles such as Research Data Analyst or Equity Data Analyst. Preference saving then only flags rows newer than 7 days for a later per-minute worker; the feed refresh itself applies no preference filter. Passing rows with the same routed resume keep their prior score/reasons without rescoring, older rows are never flagged, and attempts>=5 rows are unclaimable. These choices allow unrelated or stale data roles to remain in the focused feed after save/refresh.
fix: Applied through Phase 3 gap plans 03-08 through 03-11: strengthened title overlap, versioned complete semantic scoring inputs, refiltered all open rows with CAS publication, and enforced current preference-pass feed visibility with regression coverage.
verification: Automated gap coverage and production rollout passed; the user passed the focused-feed correction and later explicitly reported "all tests pass" for the complete Phase 3 human UAT.
files_changed:
  - supabase/functions/_shared/filters.ts
  - supabase/functions/_shared/scoring-input.ts
  - supabase/functions/score-tick/index.ts
  - supabase/migrations/0025_scoring_freshness.sql
  - supabase/migrations/0027_score_budget_after_free_work.sql
  - web/src/lib/feed.ts

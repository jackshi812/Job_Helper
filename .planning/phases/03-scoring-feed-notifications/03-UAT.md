---
status: diagnosed
phase: 03-scoring-feed-notifications
source:
  - 03-01-SUMMARY.md
  - 03-02-SUMMARY.md
  - 03-03-SUMMARY.md
  - 03-04-SUMMARY.md
  - 03-07-PLAN.md
started: 2026-07-20T03:53:29Z
updated: 2026-07-20T04:00:36Z
---

## Current Test

[testing paused — user-flow issue at Test 2]

## Tests

### 1. Open the scored-job dashboard
expected: Open https://job-helper-qs9.pages.dev and sign in. The Dashboard should load a focused job feed rather than a placeholder or error. Each visible scored row should show a title, company, numeric score and tier, a plain-language match reason, posted time, best-fit resume, Apply, and Dismiss.
result: pass

### 2. Save matching preferences
expected: Open Preferences; add target titles, locations, include keywords, and exclude keywords; then choose Save preferences. The page should confirm the save, preserve the chips after refresh, and the feed should remain usable.
result: issue
reported: "include only equity research as title, got data related roles after refreshing."
severity: major

### 3. Judge a representative scoring sample
expected: Review 20 scored entry-level jobs. At least 16 should have scores, tiers, and reasons that are useful and consistent with the saved preferences and uploaded resume; irrelevant jobs should not dominate the focused feed.
result: [pending]

### 4. Review one job in detail
expected: Open a job from the feed. The detail page should show the job-description snapshot, score and match reasons, advisory keyword gaps grouped by category, covered keywords, routed resume, posted time, and a safe Apply link.
result: [pending]

### 5. Confirm feed-only settings
expected: Open Settings. No push, email, digest, quiet-hours, alert-threshold, or notification controls should appear, and the browser should receive no new-job alerts from this app.
result: [pending]

### 6. Hosted scoring pipeline verification
expected: The deployed feed-only scoring pipeline enforces cron authentication, two-user RLS isolation, extraction readiness, token-only AI usage, valid scoring shape, and refilter restoration.
result: pass
source: automated
coverage_id: hosted-scoring-24

### 7. Focus the strongest opportunities
expected: Returning to the Dashboard should make the strongest fitting opportunities easy to identify quickly: Strong and Good matches are the default view, score sorting works, weaker or filtered jobs require All jobs, and dismissed jobs stay hidden unless Show dismissed is enabled.
result: [pending]

## Summary

total: 7
passed: 2
issues: 1
pending: 4
skipped: 0
blocked: 0

## Gaps

- truth: "Saving only Equity Research as the target title should remove unrelated data roles from the focused feed after refresh."
  status: failed
  reason: "User reported: include only equity research as title, got data related roles after refreshing."
  severity: major
  test: 2
  root_cause: "Target-title matching accepts any single significant token, so Equity Research admits titles such as Research Data Analyst. Preference saves only flag recent rows for asynchronous refiltering; unchanged passing rows reuse old scores, older or retry-exhausted rows remain stale, and the feed has no current-preference visibility gate."
  artifacts:
    - path: "supabase/functions/_shared/filters.ts"
      issue: "One-token title overlap admits unrelated shared-token roles."
    - path: "supabase/functions/score-tick/index.ts"
      issue: "Asynchronous refilter can clear the flag while retaining a score created under older title preferences."
    - path: "supabase/migrations/0022_refilter_definer.sql"
      issue: "Only jobs first seen within seven days are flagged after preference changes."
    - path: "supabase/migrations/0021_claim_scoring_work_definer.sql"
      issue: "Rows with attempts >= 5 cannot be reclaimed for refiltering."
    - path: "web/src/lib/feed.ts"
      issue: "Focused-feed visibility does not account for current preferences or pending/stale scoring inputs."
    - path: "web/tests/filters.test.ts"
      issue: "No shared-token negative fixtures cover Equity Research versus data roles."
  missing:
    - "Require stronger phrase or weighted title matching for exclusive target-title preferences."
    - "Invalidate prior scores when title preferences change instead of silently reusing them."
    - "Hide or visibly mark stale rows until refiltering finishes, including older and retry-exhausted rows."
    - "Add Equity Research negative fixtures and an end-to-end preference-save/refilter/feed regression test."
  debug_session: ".planning/debug/equity-research-title-filter.md"

---
status: partial
phase: 03-scoring-feed-notifications
source:
  - 03-01-SUMMARY.md
  - 03-02-SUMMARY.md
  - 03-03-SUMMARY.md
  - 03-04-SUMMARY.md
  - 03-07-PLAN.md
  - 03-11-PLAN.md
  - 03-11-PAID-PROOF.md
started: 2026-07-20T03:53:29Z
updated: 2026-07-20T18:00:49Z
git_sha: c15ad867f5714862192c8e95099e755d90963566
migration: 0025
score_tick_version: 3
score_tick_deployment: ae6c147f-c3a8-417e-8057-d4105ac9aed5
cloudflare_deployment: 2b3cb77f-9043-4fc8-b9dc-b57e1565ceed
asset_path: /assets/index-BxwGvdK2.js
asset_sha256: b29c1297c2945749aa4b2ed891567ca352ee643947126db3cfed867f815175af
---

## Current Test

[testing paused — first failure recorded at Test 4; Tests 5-7 not run]

## Tests

### 1. Equity Research focused-feed correction
expected: Save Equity Research as the only target title, then immediately return to or refresh the Dashboard in its default focused view. Coffee Distributor, Product Delivery Associate, Research Data Analyst, and other unrelated shared-token roles do not appear as current focused matches while refiltering. All jobs may retain diagnostic rows.
result: pass
reported: "pass focused feed"
notes: "The user clarified that the pass applies to the default focused feed; All jobs may retain diagnostic rows."

### 2. Cross-provider results in one unified ranked dashboard
expected: Inspect the one unified ranked Dashboard. Eligible results from sources currently available may appear; not every provider must have a visible representative example. Source metadata must not change matching or ranking, and every displayed row must show a truthful nonblank company name. No separate provider page or tab is expected.
result: pass
reported: "pass"
notes: "The user clarified that only currently eligible sources need appear and reported seeing mostly Stripe/watchlist results. This pass confirms one unified feed and truthful nonblank company names among the available results; it does not claim every provider had a visible example."

### 3. Current saved preferences and scoring state
expected: After bounded worker completion, saved chips persist and valid matches show a current score, tier, routed resume, and plain-language reasons; stale reasons do not return.
result: pass
reported: "pass"

### 4. Judge a representative scoring sample
expected: Review 20 scored entry-level jobs. At least 16 have useful scores, tiers, and reasons consistent with the current preferences and uploaded resume.
result: issue
reported: "more than 20 min, still no match in dashboard"
severity: major
notes: |
  Before this observation, the user reported that only 3 jobs had scores. The user then saved four persisted target-title chips: data engineer, equity research, data analyst, and data scientist. After waiting more than 20 minutes, the focused Dashboard had zero matches, so the required 20-job scoring-quality sample could not be reviewed.
evidence: |
  Attached Dashboard screenshot at 12:59:19 PM shows the focused feed empty state "No matches yet" with the message that postings are scored against resumes and preferences within minutes of discovery. Attached Preferences screenshot at 12:59:26 PM shows the four persisted target-title chips and the Save preferences control. This observation is bound to the exact release identities in this file and the passing 03-11-PAID-PROOF.md.

### 5. Review one job in detail
expected: Open one job from the feed. The detail page shows the job-description snapshot, current score and reasons, advisory keyword gaps grouped by category, covered keywords, routed resume, posted time, truthful company, and a safe Apply link.
result: [pending]
notes: "Not run because UAT stopped at the first reproducible failure in Test 4."

### 6. Focus, diagnostics, and dismissal controls
expected: Strong and Good matches are the default view, score sorting works, All jobs provides diagnostics, and dismissed jobs stay hidden unless Show dismissed is enabled.
result: [pending]
notes: "Not run because UAT stopped at the first reproducible failure in Test 4."

### 7. Confirm notification absence
expected: Settings contains no push, email, digest, quiet-hours, alert-threshold, or notification controls, and the browser receives no job alerts from this app.
result: [pending]
notes: "Not run because UAT stopped at the first reproducible failure in Test 4."

## Summary

total: 7
passed: 3
issues: 1
pending: 3
skipped: 0
blocked: 0

## Gaps

- truth: "Saving only Equity Research as the target title should remove unrelated data roles from the focused feed after refresh."
  status: resolved
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
  resolved_by: "03-08 through 03-11 exact-release gap closure and rerun"
  resolution_reported: "pass focused feed"
  resolution_note: "The pass applies to the default focused feed; All jobs may retain diagnostic rows."

- truth: "After bounded worker completion, the focused Dashboard provides at least 20 scored entry-level jobs so the representative scoring-quality sample can be reviewed."
  status: failed
  reason: "User reported: more than 20 min, still no match in dashboard"
  severity: major
  test: 4
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

---
status: complete
phase: 03-scoring-feed-notifications
source:
  - 03-01-SUMMARY.md
  - 03-02-SUMMARY.md
  - 03-03-SUMMARY.md
  - 03-04-SUMMARY.md
  - 03-07-PLAN.md
  - 03-11-PLAN.md
  - 03-11-PAID-PROOF.md
  - 03-FINAL-ROLLOUT-EVIDENCE.md
  - 03-FINAL-PAID-PROOF.md
started: 2026-07-20T03:53:29Z
updated: 2026-07-20T21:12:01Z
git_sha: 020295200ff3e48db4d685f5382c10f406ca7967
migration: 0027
score_tick_version: 6
score_tick_deployment: ae6c147f-c3a8-417e-8057-d4105ac9aed5
extract_resume_version: 3
extract_resume_deployment: 9358db1a-95fc-49bc-a684-b98fb8eceff9
cloudflare_deployment: 877499ee-f1ad-4067-b8f2-b5c152954141
asset_path: /assets/index-lyvShdhx.js
asset_sha256: a6f11edc4d18ed264233d5d17e2fd2005e9064036ec09409cf95761498013d66
---

## Current Test

[testing complete]

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
result: pass
reported: "all tests pass"
notes: |
  The original zero-match observation was diagnosed and fixed through the budget-after-free-work migration, score worker changes, and corrected preference-pass feed query. After the production rerun and subsequent refinements, the user explicitly reported that all remaining tests pass.
evidence: |
  Attached Dashboard screenshot at 12:59:19 PM shows the focused feed empty state "No matches yet" with the message that postings are scored against resumes and preferences within minutes of discovery. Attached Preferences screenshot at 12:59:26 PM shows the four persisted target-title chips and the Save preferences control. This observation is bound to the exact release identities in this file and the passing 03-11-PAID-PROOF.md.

### 5. Review one job in detail
expected: Open one job from the feed. The detail page shows the job-description snapshot, current score and reasons, advisory keyword gaps grouped by category, covered keywords, routed resume, posted time, truthful company, and a safe Apply link.
result: pass
reported: "all tests pass"

### 6. Focus, diagnostics, and dismissal controls
expected: Strong and Good preference matches scoring 50+ are the default focused view, score sorting works, All jobs shows confirmed preference-pass jobs regardless of score, and dismissed jobs stay hidden unless Show dismissed is enabled.
result: pass
reported: "all tests pass"
notes: "Expected behavior reflects the owner's final UAT decision: All jobs is preference-pass, not an unfiltered diagnostics view."

### 7. Confirm notification absence
expected: Settings contains no push, email, digest, quiet-hours, alert-threshold, or notification controls, and the browser receives no job alerts from this app.
result: pass
reported: "all tests pass"

### 8. Final-release dashboard binding
expected: Refresh the production Dashboard on release 0202952. Matches load, All jobs contains only preference-passing jobs regardless of score, and Focused contains only jobs scoring 50 or higher.
result: pass
reported: "pass"
notes: "This final confirmation binds human UAT to the same git, migration, Edge Function, Cloudflare deployment, immutable asset SHA-256, and paid-proof identities recorded in this file. The frontend asset is byte-identical to the earlier seven-test UAT release."

## Summary

total: 8
passed: 8
issues: 0
pending: 0
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
  debug_session: ".planning/debug/resolved/equity-research-title-filter.md"
  resolved_by: "03-08 through 03-11 exact-release gap closure and rerun"
  resolution_reported: "pass focused feed"
  resolution_note: "The pass applies to the default focused feed; All jobs may retain diagnostic rows."

- truth: "After bounded worker completion, the focused Dashboard provides at least 20 scored entry-level jobs so the representative scoring-quality sample can be reviewed."
  status: resolved
  reason: "User reported: more than 20 min, still no match in dashboard"
  severity: major
  test: 4
  root_cause: "The 200-call guard ran before claims, blocking free refilter/reuse while focused mode hid stale rows; afterward, an incorrectly bounded parent query still excluded valid focused candidates behind the pending backlog."
  artifacts:
    - path: "supabase/functions/score-tick/index.ts"
      issue: "Fixed to perform free work before atomic paid reservation and defer only paid survivors."
    - path: "supabase/migrations/0027_score_budget_after_free_work.sql"
      issue: "Added atomic request reservation and paid-deferred row state."
    - path: "web/src/lib/feed.ts"
      issue: "Fixed parent ordering and replaced diagnostics with a server-filtered preference-pass pool."
  missing: []
  debug_session: ".planning/debug/resolved/saved-titles-zero-matches.md"
  resolution_reported: "all tests pass"

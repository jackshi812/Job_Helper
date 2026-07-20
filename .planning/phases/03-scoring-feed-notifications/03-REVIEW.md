---
phase: 03-scoring-feed-notifications
reviewed: 2026-07-20T19:54:57Z
depth: standard
files_reviewed: 42
files_reviewed_list:
  - scripts/verify-expected-red.mjs
  - scripts/verify-openai.ts
  - scripts/verify-scoring-evidence.mjs
  - scripts/verify-scoring-evidence.test.mjs
  - scripts/verify-scoring-freshness.test.mjs
  - scripts/verify-scoring-freshness.ts
  - supabase/functions/_shared/adapters/adzuna.ts
  - supabase/functions/_shared/docx.ts
  - supabase/functions/_shared/filters.ts
  - supabase/functions/_shared/openai.ts
  - supabase/functions/_shared/routing.ts
  - supabase/functions/_shared/scoring-input.ts
  - supabase/functions/discovery-sweep/index.ts
  - supabase/functions/extract-resume/index.ts
  - supabase/functions/score-tick/index.ts
  - supabase/migrations/0017_preferences.sql
  - supabase/migrations/0018_resume_extracts.sql
  - supabase/migrations/0019_user_jobs_scoring.sql
  - supabase/migrations/0020_notifications.sql
  - supabase/migrations/0025_scoring_freshness.sql
  - supabase/migrations/0027_score_budget_after_free_work.sql
  - web/package.json
  - web/src/components/Shell.tsx
  - web/src/lib/feed.test.ts
  - web/src/lib/feed.ts
  - web/src/lib/preferences.test.ts
  - web/src/lib/preferences.ts
  - web/src/lib/resumes.test.ts
  - web/src/lib/resumes.ts
  - web/src/main.tsx
  - web/src/pages/Dashboard.tsx
  - web/src/pages/JobDetail.tsx
  - web/src/pages/Preferences.test.tsx
  - web/src/pages/Preferences.tsx
  - web/src/pages/Settings.test.ts
  - web/src/pages/Settings.tsx
  - web/tests/company-name-feed.integration.test.ts
  - web/tests/company-name-ingestion.test.ts
  - web/tests/filters.test.ts
  - web/tests/preference-refilter-feed.integration.test.ts
  - web/tests/routing.test.ts
  - web/tests/scoring-input.test.ts
findings:
  critical: 3
  warning: 4
  info: 0
  total: 7
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-07-20T19:54:57Z
**Depth:** standard
**Files Reviewed:** 42
**Status:** issues_found

## Summary

The scoring, preference, feed, ingestion, migration, and production-verification paths were reviewed adversarially. The implementation has three release-blocking risks: untrusted DOCX archives reach Mammoth before the advertised zip-bomb checks, one paid-budget reservation can authorize up to three physical OpenAI requests, and the production verifier can overwrite real user changes made concurrently with a run. Four additional correctness issues affect deferred feed truthfulness, feed completeness, provider-data resilience, and resume-upload result reporting.

## Critical Issues

### CR-01: DOCX zip-bomb checks run only after Mammoth has processed the archive

**File:** `supabase/functions/_shared/docx.ts:67-117`

**Issue:** `extractDocxText` sends the entire user-controlled ZIP archive to `mammoth.extractRawText` first. Entry-count, declared-uncompressed-size, and `document.xml` limits are checked only in the JSZip fallback after Mammoth throws. A highly compressed hostile DOCX that Mammoth accepts can therefore consume unbounded decompression memory/CPU before any guard executes. The fallback also treats a missing private `_data.uncompressedSize` as zero, which can fail open. This defeats the stated T-3-08b availability control for the shared extraction worker.

**Fix:** Preflight every archive before Mammoth: load/inspect the central directory with a bounded parser, require trustworthy sizes for all entries, enforce entry/aggregate/XML limits, and only then invoke Mammoth. Prefer a bounded streaming/decompression API or reject entries whose size cannot be established. Add hostile high-ratio and missing-size fixtures that prove Mammoth is never called when preflight fails.

### CR-02: The daily score ceiling counts logical scores, not physical paid API requests

**File:** `supabase/functions/score-tick/index.ts:327-364`

**Issue:** `reserve_score_request` is called exactly once, then `generateStructured` is invoked. The shared wrapper retries 429/5xx twice (`supabase/functions/_shared/openai.ts:122-140`), so one reservation can produce three HTTP requests. The documented hard ceiling of 499 can therefore permit as many as 1,497 physical OpenAI requests during a transient-failure day, exceeding the owner's explicit under-500 authorization and invalidating the request-ledger claim.

**Fix:** Make each physical fetch attempt consume its own atomic reservation. One practical design is an async `beforeAttempt` hook in `generateStructured`; scoring passes a hook that calls `reserve_score_request`, while extraction can keep its separate retry policy. Alternatively disable retries for paid scoring. Add a test where two 500 responses precede success and assert three reservations, with the final attempt blocked when the cap has only two slots.

### CR-03: Production verification can roll back concurrent real user changes

**File:** `scripts/verify-scoring-freshness.ts:219-245`

**Issue:** The verifier snapshots all `user_jobs` plus the target user's preference row, then deliberately changes that real user's preferences and job state. Cleanup unconditionally writes every snapshot row and upserts/deletes the old preference (`scripts/verify-scoring-freshness.ts:418-423`, `708-720`). The maintenance latch gates score claims only; it does not prevent the user from saving preferences or an extraction worker from signaling a reroute during the run. Any legitimate change after the snapshot is silently overwritten during cleanup, creating a production data-loss window.

**Fix:** Run verification under a dedicated disposable verifier user and never mutate a real user's preference row. If a real account is unavoidable, record post-write revisions and restore with compare-and-swap predicates that refuse to overwrite unexpected concurrent changes; do the same for every `user_jobs` row. Add a failure-injection test that performs an external preference/revision change after snapshot and proves cleanup preserves it or stops with explicit recovery instructions.

## Warnings

### WR-01: A newly preference-matching deferred row can display its obsolete filter rejection

**File:** `supabase/functions/score-tick/index.ts:338-355`

**Issue:** When a previously `filtered` row passes the new cheap filter but the paid budget is exhausted, the deferral update leaves `status`, `filter_reason`, and `filter_detail` unchanged. `preferenceVisible` intentionally admits any `needs_refilter` row with `score_deferred_until` (`web/src/lib/feed.ts:129-137`), while Dashboard treats `status === 'filtered'` as authoritative and renders the old rejection twice (`web/src/pages/Dashboard.tsx:268-324`). Thus All jobs can show a confirmed current preference match labeled “title mismatch” or another obsolete rejection.

**Fix:** On successful free filtering followed by budget deferral, transition the row to a neutral pending/awaiting-score state and clear old filter fields, guarded by the same revision CAS. Add an integration fixture that begins filtered, passes changed preferences, is deferred, and renders without the stale rejection.

### WR-02: Client-side eligibility filtering happens after the hard 200-row limit

**File:** `web/src/lib/feed.ts:188-203`

**Issue:** PostgREST limits the parent result to 200 before the client removes closed jobs, missing embedded jobs, identity-less companies, and stale/non-preference rows. Those rejected rows consume the limit and can hide newer or lower-ranked valid preference matches beyond row 200. The current test stubs a tiny already-curated response and does not exercise displacement, so the earlier backlog symptom can recur as data grows.

**Fix:** Move open-job, truthful-company, and current-preference eligibility into a server-side view/RPC before limiting, or page deterministically until 200 eligible rows have been collected. Add a test with more than 200 ineligible leading rows followed by valid matches.

### WR-03: One malformed Adzuna result aborts the entire discovery sweep

**File:** `supabase/functions/_shared/adapters/adzuna.ts:13-23`

**Issue:** Runtime provider JSON is trusted as if it matched the TypeScript interface. In particular, an invalid nonempty `created` value makes `new Date(...).toISOString()` throw, and missing/non-string `title` makes `.trim()` throw. Mapping occurs inside the result loop but outside a per-result error boundary (`supabase/functions/discovery-sweep/index.ts:200-266`), so one malformed listing escapes to the outer handler and returns HTTP 500 after discarding the rest of the sweep.

**Fix:** Runtime-validate each provider result, map invalid dates to `null` (or reject only that item), and wrap per-result normalization so malformed entries increment a bounded counter without aborting valid results. Add invalid-date, missing-title, and mixed-validity response tests.

### WR-04: Resume upload reports failure after the upload has already succeeded

**File:** `web/src/lib/resumes.ts:71-94`

**Issue:** Storage upload and metadata insertion are durable before `mark_recent_jobs_for_refilter` runs. If that final RPC fails, `uploadResume` throws even though the resume exists, causing the UI to report an upload failure and encouraging a retry that creates a duplicate resume. The test suite explicitly checks RPC rejection but does not verify truthful partial-success behavior.

**Fix:** Treat the metadata insert as the upload commit. Return the created resume and surface a distinct nonfatal “uploaded; matching refresh delayed” warning when refilter signaling fails (the extraction-ready service signal can retry routing), or provide an idempotent server transaction/outbox that couples metadata creation to the signal. Add a test asserting exactly one durable resume after a signal failure and retry.

---

_Reviewed: 2026-07-20T19:54:57Z_
_Reviewer: the agent (gsd-code-reviewer; generic-agent workaround)_
_Depth: standard_

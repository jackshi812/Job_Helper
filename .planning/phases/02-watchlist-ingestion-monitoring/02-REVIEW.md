---
phase: 02-watchlist-ingestion-monitoring
reviewed: 2026-07-17T15:56:40Z
depth: standard
files_reviewed: 26
files_reviewed_list:
  - supabase/config.toml
  - supabase/functions/_shared/adapters/adzuna.ts
  - supabase/functions/_shared/adapters/ashby.ts
  - supabase/functions/_shared/adapters/greenhouse.ts
  - supabase/functions/_shared/adapters/lever.ts
  - supabase/functions/_shared/adapters/types.ts
  - supabase/functions/_shared/dedup.ts
  - supabase/functions/_shared/detect.ts
  - supabase/functions/discovery-sweep/index.ts
  - supabase/functions/heartbeat/index.ts
  - supabase/functions/poll-tick/index.ts
  - supabase/functions/verify-board/index.ts
  - supabase/migrations/0005_watchlist.sql
  - supabase/migrations/0006_jobs_pipeline.sql
  - supabase/migrations/0007_discovery.sql
  - scripts/verify-pipeline.ts
  - scripts/verify-watchlist.ts
  - web/src/components/Shell.tsx
  - web/src/lib/pipeline.ts
  - web/src/lib/watchlist.test.ts
  - web/src/lib/watchlist.ts
  - web/src/pages/Watchlist.tsx
  - web/tests/adapters.test.ts
  - web/tests/adzuna.test.ts
  - web/tests/dedup.test.ts
  - web/tests/detect.test.ts
findings:
  critical: 5
  warning: 3
  info: 0
  total: 8
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-07-17T15:56:40Z
**Depth:** standard
**Files Reviewed:** 26
**Status:** issues_found

## Narrative Findings (AI reviewer)

## Summary

The review found five correctness/data-integrity defects in the polling, monitoring, and hosted verification paths, plus three robustness defects. The most immediate risk is that the watchlist verification script deletes a real watched-company row when its seed already exists, orphaning that company's captured jobs. The ingestion path also cannot reopen a posting after stale-close, and its due-company claim is not exclusive under concurrent ticks. Monitoring has two false/hidden-success cases: an empty but healthy watchlist becomes stale, while an entirely failed discovery batch still returns HTTP 200.

## Critical Issues

### CR-01: Hosted verification deletes a real watched company and orphans its jobs

**File:** `scripts/verify-watchlist.ts:124-168`

**Issue:** The shared-row probe reuses the existing Stripe row when it is already present, then has User B delete that row. Because `jobs.company_id` uses `on delete set null`, rerunning this verification after ingestion has begun permanently detaches every captured Stripe job from its company. The later seed loop creates a new company with a new UUID, so those jobs are not reattached and subsequent polls can create a second set of Stripe rows.

**Fix:** Always create a dedicated disposable probe row with a randomized, valid board token and record whether this invocation inserted it. Exercise cross-user visibility/deletion only on that row, and clean up only rows created by the probe. Never substitute a pre-existing production row as the deletion target.

### CR-02: A stale-closed ATS posting can never reopen

**File:** `supabase/functions/poll-tick/index.ts:171-184,153-160`

**Issue:** `processCompany` loads only open jobs, so a posting that was previously marked closed is absent from `exactIds`. When the ATS later returns the same external ID, `ingestNewJobs` attempts an insert with `ignoreDuplicates: true`; the unique `(source, external_id)` constraint silently discards it. The existing row stays closed and its `last_seen_at` is not advanced, even though the posting is live again.

**Fix:** Resolve exact source/external-ID matches across both open and closed rows. On a returned closed match, update `status = 'open'`, `closed_at = null`, `last_seen_at = seenAt`, and the current `company_id` while preserving the immutable first-sight snapshot fields. Add a regression test that closes a row and then processes the same external ID again.

### CR-03: The due-company claim is not exclusive under concurrent ticks

**File:** `supabase/migrations/0006_jobs_pipeline.sql:55-71`

**Issue:** `claim_due_companies` selects IDs in an uncorrelated subquery and then updates them without row locking or `SKIP LOCKED`. Two overlapping function invocations can select the same due rows before either update commits; the second invocation can then update and return those same companies after waiting. This violates the claim contract and causes duplicate upstream polling, racing health/stale-close writes, and avoidable API usage.

**Fix:** Implement the claim with a locking CTE, for example `select id ... for update skip locked limit batch_size`, followed by `update ... from candidates where companies.id = candidates.id returning companies.*`. Add a concurrent-claim integration probe that asserts disjoint returned IDs.

### CR-04: A healthy empty watchlist is reported as a pipeline failure

**File:** `supabase/functions/poll-tick/index.ts:281-324`

**Issue:** A tick with no due companies (including the valid state where users removed every company) completes successfully and advances `last_tick_at`, but `last_success_at` advances only when `succeeded > 0`. After 30 minutes, both the in-app banner and external heartbeat return stale even though cron is running and there was no work to fail.

**Fix:** Treat a no-work tick as successful: update `last_success_at` when `companies.length === 0 || succeeded > 0`. Preserve the stale signal when companies were claimed and all of them failed.

### CR-05: Complete Adzuna failure is acknowledged as HTTP success

**File:** `supabase/functions/discovery-sweep/index.ts:125-146,216-223`

**Issue:** Every seed-query fetch error is caught and counted, but the function still returns HTTP 200 even when all enabled queries failed. Nothing writes this failure into `pipeline_heartbeat`, so cron monitoring sees a successful invocation while discovery can remain completely broken indefinitely.

**Fix:** Track attempted and successful queries. If at least one query was attempted and none succeeded, return a non-2xx response (and/or persist a discovery-specific failure heartbeat). For partial failures, persist an explicit degraded state that the UI/external monitor consumes instead of relying only on the response body.

## Warnings

### WR-01: Heartbeat query failures suppress the warning banner

**File:** `web/src/components/Shell.tsx:30-38,92-98`

**Issue:** The banner appears only when heartbeat data was successfully loaded and is stale. Authentication, RLS, or network failures leave `heartbeatQuery.data` undefined, so the monitoring indicator disappears precisely when pipeline health cannot be determined.

**Fix:** Treat `heartbeatQuery.isError` as an unhealthy/unknown monitoring state and render a distinct "monitoring status unavailable" banner. Keep the stale-timestamp copy for successful queries with old data.

### WR-02: Seed setup assumes only one company exists per ATS

**File:** `scripts/verify-pipeline.ts:75-100`

**Issue:** `ensureSeeds` looks up a seed using only `ats_type` and calls `maybeSingle()`. The product explicitly supports many watched companies on the same ATS, so adding a second Greenhouse, Lever, or Ashby company makes this verification throw a multiple-rows error (or incorrectly skip a missing seed, depending on client behavior).

**Fix:** Add each seed's expected board token to `seedBoards` and query by both `ats_type` and `board_token`, matching the table's unique key.

### WR-03: The duplicate-ingestion probe races unrelated scheduled writes

**File:** `scripts/verify-pipeline.ts:157-173`

**Issue:** Probe 4 compares the total row count across the entire `jobs` table before and after polling one forced company. The minute cron or hourly discovery sweep can legitimately insert an unrelated row between those reads, producing a false failure even when the forced company created no duplicate.

**Fix:** Compare the forced company's source/external-ID set (or its row count) before and after, and exclude unrelated companies and Adzuna rows. If exact isolation is required, also capture the target IDs and assert uniqueness directly.

---

_Reviewed: 2026-07-17T15:56:40Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_

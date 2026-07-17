---
phase: 02-watchlist-ingestion-monitoring
verified: 2026-07-17T16:23:22Z
status: gaps_found
score: 7/15 must-haves verified
behavior_unverified: 4
overrides_applied: 0
gaps:
  - truth: "Hosted verification can be rerun without corrupting watched-company identity or exactly-once job state"
    status: failed
    reason: "The watchlist verifier reuses and deletes the existing Stripe company row, orphaning its jobs before recreating the company with a new UUID."
    artifacts:
      - path: "scripts/verify-watchlist.ts"
        issue: "Lines 124-168 select a pre-existing Stripe row as the destructive cross-user deletion target."
    missing:
      - "Create and delete only a dedicated disposable probe row, tracked as inserted by the current invocation."
      - "Add a regression check that production seed rows and their job foreign keys are unchanged."
  - truth: "A currently live ATS posting is open and current even after it was previously stale-closed"
    status: failed
    reason: "poll-tick loads only open jobs; a returned closed exact-ID match reaches an ignoreDuplicates upsert and remains closed."
    artifacts:
      - path: "supabase/functions/poll-tick/index.ts"
        issue: "Lines 171-184 exclude closed rows, while lines 153-160 silently ignore the unique-key conflict."
    missing:
      - "Resolve exact source/external-ID matches across open and closed rows."
      - "Reopen returned closed matches while preserving the first-sight snapshot."
      - "Add a close-then-return regression test."
  - truth: "Concurrent poll ticks claim disjoint due-company batches and preserve the 5-15 minute cadence"
    status: failed
    reason: "claim_due_companies has no locking CTE or FOR UPDATE SKIP LOCKED, so overlapping invocations can return the same companies."
    artifacts:
      - path: "supabase/migrations/0006_jobs_pipeline.sql"
        issue: "Lines 55-71 select and update due rows without exclusive claim semantics."
    missing:
      - "Replace the uncorrelated IN subquery with a locking CTE using FOR UPDATE SKIP LOCKED."
      - "Add a concurrent-claim integration probe asserting disjoint IDs."
  - truth: "The heartbeat reports a healthy scheduler when an authorized tick has no companies to poll"
    status: failed
    reason: "poll-tick advances last_success_at only when succeeded > 0, so an empty or fully not-due watchlist becomes falsely stale after 30 minutes."
    artifacts:
      - path: "supabase/functions/poll-tick/index.ts"
        issue: "Lines 318-324 omit the valid companies.length === 0 success case."
    missing:
      - "Advance last_success_at for a successful no-work tick."
      - "Retain stale behavior when companies were claimed and all failed."
      - "Test both transitions."
  - truth: "A completely failing Adzuna discovery run is surfaced as unhealthy rather than acknowledged as success"
    status: failed
    reason: "Every seed query may fail while discovery-sweep still returns HTTP 200 and writes no discovery failure state consumed by monitoring."
    artifacts:
      - path: "supabase/functions/discovery-sweep/index.ts"
        issue: "Lines 125-146 count per-query failures, but lines 216-223 always return success after the loop."
    missing:
      - "Track attempted and successful queries and fail non-2xx when all attempted queries fail."
      - "Persist and surface partial/degraded discovery health."
      - "Add all-failed and partial-failure tests."
  - truth: "Aggregator jobs arrive within the MVP story's 5-15 minute window"
    status: failed
    reason: "The corrected MVP capability explicitly includes the aggregator in the 5-15 minute promise, while discovery-sweep-hourly can wait nearly 60 minutes before running."
    artifacts:
      - path: "supabase/migrations/0007_discovery.sql"
        issue: "Lines 36-38 schedule discovery at 0 * * * * (hourly)."
      - path: ".planning/ROADMAP.md"
        issue: "The Phase 2 user story now promises watched career sites and an aggregator within 5-15 minutes."
    missing:
      - "Either adopt a budget-safe 5-15 minute aggregator strategy or obtain an explicit goal override/clarification that aggregator latency is excluded."
behavior_unverified_items:
  - truth: "A user can complete the watchlist add, replace-by-remove-and-re-add, and remove flow in the deployed browser UI"
    test: "Open Watchlist, add a supported board, replace it via remove and re-add, then remove it through confirmation."
    expected: "The table, teaching errors, confirmation, and final persisted state all match the action without losing unrelated job data."
    why_human: "Backend probes and symbol checks do not exercise the rendered browser flow or the documented edit equivalence."
  - truth: "Health badges visibly communicate OK, Failing, and Stale with usable hover text"
    test: "View rows representing each health state and inspect the last-success hover text in light and dark themes."
    expected: "All states are distinct, readable, and show the correct last-success information."
    why_human: "Unit tests cover deriveHealth, but no component test or completed visual UAT covers rendering and hover behavior."
  - truth: "A job absent for the configured successful-poll grace period transitions from open to closed, while a failed poll closes nothing"
    test: "Exercise a controlled disappearance across the 35-minute window and a failed-poll case."
    expected: "Only the successful disappearance path closes the job; failure leaves it open."
    why_human: "The branches are present, but no unit or integration test exercises this state transition."
  - truth: "The global pipeline banner appears on stale data and disappears after recovery"
    test: "Observe a stale heartbeat in the browser, then restore successful polling and wait for the one-minute refetch."
    expected: "The banner appears while stale and clears after fresh data arrives."
    why_human: "No component test exercises the query-driven stale-to-fresh render transition."
---

# Phase 2: Watchlist Ingestion & Monitoring Verification Report

**Phase Goal:** As a job seeker, I want to receive new job postings from watched career sites and an aggregator exactly once within 5-15 minutes, so that I can trust my job feed is current without manually checking each career site.
**Verified:** 2026-07-17T16:23:22Z
**Status:** gaps_found
**Re-verification:** No — initial goal-backward verification after the MVP story was corrected

## User Flow Coverage

User story: “As a job seeker, I want to receive new job postings from watched career sites and an aggregator exactly once within 5-15 minutes, so that I can trust my job feed is current without manually checking each career site.”

| Step | Expected | Evidence | Status |
|------|----------|----------|--------|
| Open the watchlist | A signed-in user sees watched companies, source, health, and actions | `web/src/pages/Watchlist.tsx:67-205` reads real `companies` data through `listCompanies()` | ⚠️ PRESENT — browser flow not UAT-verified |
| Add or replace a company | Pasting a supported URL verifies the board and persists its ATS identity; unsupported URLs teach without saving | `watchlist.ts:50-80`, `verify-board/index.ts:59-86`; named unsupported-before-network test passed | ⚠️ PRESENT — replace-by-remove/re-add needs browser UAT |
| Receive watched-site jobs | A new posting is polled and represented once within 15 minutes | Per-minute cron and batch size exist, but the claim is non-exclusive and closed exact-ID rows cannot reopen | ✗ FAILED |
| Receive aggregator jobs | Adzuna contributes non-duplicate jobs in the same 5-15 minute promise | `0007_discovery.sql:36-38` schedules hourly | ✗ FAILED |
| Trust monitoring | Per-company state and whole-pipeline health reveal failures within one poll cycle | Health paths exist, but no-work ticks false-alarm and total discovery failure remains HTTP 200/unrecorded | ✗ FAILED |
| Outcome | The feed can be trusted as current without manually checking each site | Data-integrity, cadence, and liveness gaps above prevent this conclusion | ✗ FAILED |

The MVP user-flow contract is incomplete, so the user-visible outcome is not achieved even though all planned files exist and the regression suite is green.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can add, replace-by-remove/re-add, and remove supported watched companies | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | SPA and backend paths are wired; no completed browser UAT proves the full flow. |
| 2 | Unsupported or unverifiable URLs teach and save nothing | ✓ VERIFIED | Shared detector/server rejection exists; focused Vitest test passed and invokes no network. |
| 3 | Authenticated users share watchlist visibility and mutation access while anonymous access is denied | ✓ VERIFIED | Migration grants/policies implement the shared contract; hosted probe code covers both users and anonymous denial, though its cleanup bug must be fixed before rerun. |
| 4 | Rows visibly show correct OK/Failing/Stale health with hover context | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `deriveHealth` boundary test passed; visual and hover behavior lack component/UAT evidence. |
| 5 | Watched-board postings arrive within 15 minutes and exactly once across polls, reposts, and aggregator overlap | ✗ FAILED | Non-exclusive claims, destructive verification, and inability to reopen a returned exact-ID posting break the reliability contract. |
| 6 | ATS jobs retain complete immutable first-sight snapshots | ✓ VERIFIED | Normalized adapters, schema, and insert-only snapshot path are substantive; the 68-test regression and prior hosted checks passed. |
| 7 | Successful disappearance closes a job while failed polls never close it | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Close SQL is confined to the success path, but no test exercises the state transition. |
| 8 | Per-company success/failure fields update on every claimed poll | ✓ VERIFIED | `poll-tick/index.ts:225-233,296-315` wires both success and isolated failure writes. |
| 9 | Heartbeat semantics distinguish healthy, failed, and no-work scheduler states | ✗ FAILED | A no-work tick advances only `last_tick_at`, causing a false stale state. |
| 10 | Adzuna search inserts partial snapshots and prevents exact normalized-fingerprint overlap with open ATS jobs | ✓ VERIFIED | Discovery data flow and dedup maps are wired; adapter and fingerprint focused tests pass. |
| 11 | Adzuna request usage stops at the 240/day cutoff | ✓ VERIFIED | Budget is persisted before fetch and checked at both entry and loop boundaries. |
| 12 | The global stale banner appears and clears on recovery | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Query/refetch/render wiring exists, but no test exercises stale-to-fresh behavior; query errors are hidden. |
| 13 | The external monitor detects heartbeat failure outside Supabase | ✓ VERIFIED | Failure HTTP history and a failure email were observed. Recovery execution reached 200; recovery-email receipt is explicitly waived and remains unknown. |
| 14 | Aggregator jobs meet the MVP story's 5-15 minute cadence | ✗ FAILED | The committed schedule is hourly, so worst-case discovery delay approaches 60 minutes. |
| 15 | Complete discovery failure is visible as a pipeline failure | ✗ FAILED | All seed requests can fail while the function still responds 200 and monitoring remains green. |

**Score:** 7/15 truths verified (4 present but behavior-unverified; 4 failed)

## Required Artifacts

All 14 PLAN-declared artifacts exist and passed deterministic substance checks. Key examples:

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/0005_watchlist.sql` | Shared companies schema and RLS | ✓ VERIFIED | 42 lines; schema, unique ATS identity, health columns, authenticated policies. |
| `supabase/functions/_shared/detect.ts` | Allowlisted ATS detection and endpoint construction | ✓ VERIFIED | 81 lines; exported detector/constructor and no network I/O. |
| `supabase/functions/verify-board/index.ts` | Authoritative live board verification | ✓ VERIFIED | Imports detector, fetches only constructed endpoints, validates response status/shape. |
| `web/src/lib/watchlist.ts` | Real watchlist CRUD and health derivation | ✓ VERIFIED | Reads/writes `companies` and invokes `verify-board` before insert. |
| `web/src/pages/Watchlist.tsx` | Watchlist user interface | ✓ SUBSTANTIVE + WIRED | 205 lines; real TanStack Query data, add/remove mutations, table, and badges. |
| `supabase/migrations/0006_jobs_pipeline.sql` | Jobs, heartbeat, claim RPC, minute cron | ⚠️ SUBSTANTIVE BUT DEFECTIVE | Exists and is wired; claim RPC lacks exclusive locking. |
| `supabase/functions/poll-tick/index.ts` | ATS polling, dedup, snapshots, closure, health | ⚠️ SUBSTANTIVE BUT DEFECTIVE | 337 lines; closed-posting and no-work-heartbeat paths are incorrect. |
| `supabase/functions/_shared/dedup.ts` | Normalized cross-source fingerprint | ✓ VERIFIED | Focused normalization test passed. |
| `supabase/functions/heartbeat/index.ts` | Secret-gated fresh/stale endpoint | ✓ VERIFIED | Reads real heartbeat data and fails closed on read/config error. |
| `supabase/functions/discovery-sweep/index.ts` | Budgeted Adzuna ingestion | ⚠️ SUBSTANTIVE BUT DEFECTIVE | Data flows, but total query failure is acknowledged as HTTP 200. |
| `supabase/migrations/0007_discovery.sql` | Seed queries, budget fields, sweep cron | ⚠️ SUBSTANTIVE BUT GOAL-MISMATCHED | Hourly cadence conflicts with the corrected MVP story. |
| `web/src/components/Shell.tsx` | Global stale banner | ⚠️ WIRED WITH WARNING | Real heartbeat data drives rendering; query failures render no warning. |
| `web/src/lib/pipeline.ts` | Browser heartbeat reader | ✓ VERIFIED | Queries the singleton row and propagates errors. |

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `Watchlist.tsx` | `watchlist.ts` | CRUD imports and `['watchlist']` query | ✓ WIRED | Deterministic query passed. |
| `watchlist.ts` | `verify-board` | `supabase.functions.invoke('verify-board')` | ✓ WIRED | Manual source trace confirms verify-before-insert; deterministic checker reported only an invalid-regex limitation. |
| `verify-board` | `_shared/detect.ts` | direct `.ts` import | ✓ WIRED | `verify-board/index.ts:1-6,67-73`. |
| `poll-tick` | ATS adapters | direct Greenhouse/Lever/Ashby imports | ✓ WIRED | `poll-tick/index.ts:2-5,43-51`; deterministic checker missed extension-qualified imports. |
| `poll-tick` | `claim_due_companies` / jobs | RPC plus Supabase writes | ⚠️ WIRED, DEFECTIVE | Link exists, but claim exclusivity and reopen behavior are wrong. |
| `0006_jobs_pipeline.sql` | `poll-tick` | minute pg_cron `net.http_post` | ✓ WIRED | URL and shared-secret header are present. |
| `Shell.tsx` | `pipeline.ts` | one-minute heartbeat query | ✓ WIRED | Deterministic query passed. |
| `discovery-sweep` | `_shared/dedup.ts` | `fingerprint()` before insert | ✓ WIRED | Manual source trace confirms import/use; deterministic checker reported only an invalid-regex limitation. |
| `heartbeat` | `pipeline_heartbeat` | service-role singleton read | ✓ WIRED | Uses the same `last_success_at` written by poll-tick. |

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `Watchlist.tsx` | `companiesQuery.data` | `listCompanies()` → `public.companies` | Yes | ✓ FLOWING |
| `Shell.tsx` | `heartbeatQuery.data.last_success_at` | `fetchHeartbeat()` → `public.pipeline_heartbeat` | Yes | ⚠️ FLOWING; errors are hidden |
| `poll-tick` | normalized ATS jobs | live ATS adapters → `public.jobs` | Yes | ⚠️ FLOWING; lifecycle/claim defects |
| `discovery-sweep` | Adzuna results | enabled `seed_queries` → Adzuna → `public.jobs` | Yes | ⚠️ FLOWING; all-failed run remains green |

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Unsupported URL rejected before network | `npx vitest run src/lib/watchlist.test.ts -t "rejects an unsupported URL before making a network call"` | 1 passed | ✓ PASS |
| Three failures derive Failing | `npx vitest run src/lib/watchlist.test.ts -t "is failing at three consecutive failures"` | 1 passed | ✓ PASS |
| Fingerprint tolerates title case/punctuation | `npx vitest run tests/dedup.test.ts -t "treats title punctuation and case as equivalent"` | 1 passed | ✓ PASS |
| Full regression | Orchestrator's current execute-phase run | 11 files, 68 tests passed | ✓ PASS |
| Returned closed job reopens | No named test exists | Source trace proves it remains closed | ✗ FAIL |
| Concurrent claims are disjoint | No integration test exists | SQL has no lock/skip-locked mechanism | ✗ FAIL |
| Successful disappearance vs failed poll | No named test exists | Transition present but unexercised | ⚠️ UNVERIFIED |

## Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| `scripts/verify-watchlist.ts` | Not executed | Running it can delete a production seed company and orphan jobs (CR-01) | ✗ UNSAFE / GAP |
| `scripts/verify-pipeline.ts` | Not re-executed by verifier | The phase execution recorded 12/12 hosted probes, but the script mutates hosted state and contains two race/seed warnings; those claims are supporting context, not independent proof of the missing transitions | ⚠️ NOT COUNTED FOR GAP PATHS |

## Requirements Coverage

| Requirement | Source Plan | Status | Evidence / Blocking Issue |
|-------------|-------------|--------|---------------------------|
| PREF-02 | 02-01 | ⚠️ NEEDS HUMAN | Add/remove implementation exists; replace-by-remove/re-add browser flow needs UAT. |
| PREF-03 | 02-01 | ✓ SATISFIED | ATS detection and centrally constructed polling endpoints are wired. |
| PREF-04 | 02-01, 02-02 | ⚠️ PARTIAL | Health state and UI exist, but heartbeat-query errors hide monitoring status. |
| DISC-01 | 02-02 | ✗ BLOCKED | Non-exclusive concurrent claims can duplicate work and jeopardize the 100+ company cadence. |
| DISC-02 | 02-03 | ✓ SATISFIED AS WRITTEN | Adzuna provides breadth; however its hourly schedule fails the newer MVP 5-15 minute capability. |
| DISC-03 | 02-02 | ✗ BLOCKED | Verification can orphan/reseed companies, and lifecycle handling leaves returned jobs closed; exactly-once/current-feed trust is not proven. |
| DISC-04 | 02-02 | ✓ SATISFIED | ATS snapshots are full and immutable; Adzuna is deliberately flagged partial. |
| DISC-05 | 02-02 | ⚠️ NEEDS BEHAVIORAL PROOF | Close-on-success code exists, but the transition has no test and returned rows cannot reopen. |
| DISC-06 | 02-02, 02-03 | ✗ BLOCKED | No-work ticks false-alarm; total discovery failure is invisible to monitoring. |

No orphaned Phase 2 requirement IDs were found.

## Anti-Patterns and Warnings

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `web/src/components/Shell.tsx` | 35-38 | Query errors suppress the health banner | ⚠️ Warning | Monitoring status disappears when it cannot be loaded. |
| `scripts/verify-pipeline.ts` | 75-100 | Seed lookup filters only by ATS type | ⚠️ Warning | Multiple companies on one ATS can break or misdirect the verifier. |
| `scripts/verify-pipeline.ts` | 157-173 | Duplicate probe compares global job count | ⚠️ Warning | Scheduled unrelated inserts can produce false failures. |
| `supabase/migrations/0007_discovery.sql` | 21 | Placeholder seed rows | ℹ️ Intentional | Explicit D-08 configuration, specifically replaced by Phase 3 preferences; not a Phase 2 blocker. |

No unreferenced `TBD`, `FIXME`, or `XXX` debt markers were found in the Phase 2 implementation files.

## Human Verification and Waiver Record

The four `behavior_unverified_items` in frontmatter remain appropriate UAT after gap closure. They do not lower the overall status from `gaps_found`, because source-level blockers take precedence.

The cron-job.org failure email was received, and restored requests reached HTTP 200. Recovery-email receipt was not received. The user explicitly waived only another recovery-email cycle. Therefore:

- Failure notification: **verified**
- Recovery execution (HTTP 200): **verified**
- Recovery-email receipt: **unknown / waived by user**, not passed

## Gaps Summary

Phase 2 has a substantial, wired implementation and a green 68-test suite, but it does not yet achieve the corrected MVP outcome. Six actionable gaps remain:

1. Make hosted watchlist verification disposable and non-destructive.
2. Reopen returned exact-ID ATS postings.
3. Make due-company claims exclusive under concurrency.
4. Treat a successful no-work tick as heartbeat success.
5. Surface complete and partial Adzuna failure through HTTP and monitoring state.
6. Reconcile the hourly aggregator implementation with the MVP story's 5-15 minute promise.

The first five are source-code correctness gaps. The sixth is a goal-versus-design contract conflict and needs either implementation work or an explicit accepted override; it must not be silently passed.

---

_Verified: 2026-07-17T16:23:22Z_
_Verifier: the agent (gsd-verifier, generic-agent workaround)_

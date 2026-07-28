---
phase: 02-watchlist-ingestion-monitoring
verified: 2026-07-17T20:11:25Z
status: passed
score: 15/15 must-haves verified
behavior_unverified: 0
overrides_applied: 1
overrides:

  - must_have: "Aggregator jobs arrive within the MVP story's 5-15 minute window"
    reason: "User accepted a quota-safe Chicago cadence: every 30 minutes from 6 AM-noon and every two hours otherwise; the Phase 2 goal and implementation now use that cadence."
    accepted_by: "user"
    accepted_at: "2026-07-17"
re_verification:
  previous_status: gaps_found
  previous_score: 7/15
  gaps_closed:

    - "Hosted watchlist verification is disposable and preserves seed-company identities and job links."
    - "Returned closed exact-ID postings reopen while preserving first-sight snapshots."
    - "Concurrent poll ticks claim disjoint due-company batches with FOR UPDATE SKIP LOCKED."
    - "Authorized no-work ticks advance the successful scheduler heartbeat."
    - "Complete and partial Adzuna failures persist and surface distinct health states."
    - "The superseded universal aggregator 5-15-minute promise is covered by the user-approved Chicago cadence override."
  gaps_remaining: []
  regressions: []
behavior_unverified_items: []
human_verification_results:

  - test: "Complete the deployed Watchlist add, replace-by-remove-and-re-add, and remove flow."
    result: pass
    source: "02-UAT.md test 1"

  - test: "Inspect OK, Failing, and Stale badges and their hover text in light and dark themes."
    result: pass
    source: "02-UAT.md test 2"
---

# Phase 2: Watchlist Ingestion & Monitoring Verification Report

**Phase Goal:** As a job seeker, I want to receive watched-site postings exactly once within 5-15 minutes and aggregator discovery every 30 minutes from 6 AM-noon Chicago and every two hours otherwise, so that I can trust my job feed without manually checking each career site.
**Verified:** 2026-07-17T20:11:25Z
**Status:** passed
**Re-verification:** Yes — after all six blocking gaps were closed or explicitly overridden

## User Flow Coverage

| Step | Expected | Evidence | Status |
|------|----------|----------|--------|
| Open Watchlist | A signed-in user sees real watched companies, source, health, and actions | `Watchlist.tsx:67-205` plus passing `02-UAT.md` tests | ✓ VERIFIED |
| Add, replace, remove | A supported URL is verified before save; replace is remove-and-re-add; removal confirms first | `watchlist.ts:50-85`, `verify-board/index.ts:59-86`, hosted probes, and UAT test 1 | ✓ VERIFIED |
| Receive watched-site postings | Per-minute ticks claim disjoint due rows, poll ATS adapters, preserve snapshots, deduplicate, and reopen returned jobs | `0008_claim_exclusive.sql:11-24`, `poll-tick/index.ts:166-248`; lifecycle tests and hosted probes 1-15 passed | ✓ VERIFIED |
| Receive aggregator postings | Chicago-local gating admits 30-minute morning slots and two-hour off-hour slots, with atomic quota reservation | `discovery-health.ts:44-67`, `0009_discovery_health_cadence.sql:35-57`, `0010`/`0011`; DST/quota tests and hosted probe 16 passed | ✓ VERIFIED |
| Trust monitoring | Company health, scheduler heartbeat, discovery health, banner state, and external 503 surface are wired | Deterministic health tests plus passing UAT test 2 | ✓ VERIFIED |
| Outcome | Feed freshness and integrity no longer require checking each career site manually | Automated integrity, cadence, and liveness checks plus both human UAT tests pass | ✓ VERIFIED |

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can add, replace-by-remove/re-add, and remove supported watched companies | ✓ VERIFIED | SPA/backend paths are wired and deployed browser UAT test 1 passed. |
| 2 | Unsupported or unverifiable URLs teach and save nothing | ✓ VERIFIED | Shared allowlist detector and server rejection are wired; Vitest covers rejection before network and rejection without insert. |
| 3 | Authenticated users share watchlist access while anonymous access is denied | ✓ VERIFIED | `0005_watchlist.sql` defines shared authenticated policies; the disposable hosted verifier passed twice. |
| 4 | Rows visibly show OK, Failing, and Stale health with hover context | ✓ VERIFIED | `deriveHealth` boundaries pass and deployed light/dark/hover UAT test 2 passed. |
| 5 | Watched-board postings arrive within 15 minutes and exactly once across polls, reposts, and aggregator overlap | ✓ VERIFIED | Minute cron plus 9-minute due threshold and 10-row batches support 100+ boards; exclusive claims, unique identity, fingerprint conversion, and hosted dedup probes are wired. |
| 6 | ATS jobs retain complete immutable first-sight snapshots | ✓ VERIFIED | All adapters produce full snapshots; update/reopen paths touch lifecycle fields only; hosted probe 3 and reopen probe passed. |
| 7 | Successful non-empty disappearance closes a grace-expired job while failed or empty polls close nothing | ✓ VERIFIED | `planCompanySync` tests cover close, grace, empty, and closed-row cases; `poll-tick` applies `closeIds` only after successful polling. |
| 8 | Per-company success/failure fields update on every claimed poll | ✓ VERIFIED | `poll-tick/index.ts:225-233,295-315` wires isolated success and failure updates; hosted health probe passed. |
| 9 | Heartbeat semantics distinguish healthy, all-failed, and no-work scheduler states | ✓ VERIFIED | `shouldAdvanceSuccessHeartbeat` has all three transition tests; hosted no-work probe 14 passed. |
| 10 | Adzuna inserts partial snapshots and cannot remain open beside a matching ATS fingerprint | ✓ VERIFIED | Discovery maps partial snapshots, checks open fingerprints, and ATS ingestion converts matching Adzuna rows; hosted probes 10-11 passed. |
| 11 | Adzuna usage stays below default daily, weekly, and monthly quotas | ✓ VERIFIED | Effective cutoff is 75/day, atomic reservation locks the singleton ledger, and tests prove 75×7 < 1000 and 75×30 < 2500. |
| 12 | Global monitoring banner appears for stale/failed/degraded/unavailable health and clears when healthy | ✓ VERIFIED | Nine banner unit tests cover stale, failed, missing, degraded, unavailable, priority, and healthy states; `Shell.tsx` renders the pure result on a 60-second query. |
| 13 | An external monitor detects stale polling and total discovery failure outside Supabase | ✓ VERIFIED | Secret-gated heartbeat returns 503 for stale polling, failed discovery, or missed discovery cadence; failure email was observed. Recovery-email receipt remains user-waived and unknown. |
| 14 | Aggregator jobs meet the superseded universal 5-15-minute cadence | PASSED (override) | User accepted the quota-safe Chicago cadence on 2026-07-17; ROADMAP and implementation now encode that exact replacement. |
| 15 | Complete discovery failure is visible as a pipeline failure | ✓ VERIFIED | `summarizeDiscovery` returns failed/503 when all attempts fail; the function persists `discovery_status`; heartbeat and banner consume it. |

**Score:** 15/15 truths verified (including 1 accepted cadence override)

## Required Artifacts

The deterministic artifact checker found all 27 PLAN-declared artifacts present and substantive.

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `0005_watchlist.sql` | Shared watchlist schema/RLS | ✓ VERIFIED | Unique ATS identity, health fields, authenticated CRUD, no anonymous grant. |
| `_shared/detect.ts` + `verify-board` | Safe ATS detection and live verification | ✓ VERIFIED | Pasted URL is parsed; only constructed allowlisted endpoints are fetched. |
| `watchlist.ts` + `Watchlist.tsx` | Real CRUD and health UI | ✓ SUBSTANTIVE + WIRED | Query/mutations use live Supabase data; browser UAT remains. |
| `0006` + `0008_claim_exclusive.sql` | Jobs, heartbeat, minute cron, exclusive claims | ✓ VERIFIED | `FOR UPDATE SKIP LOCKED` replaces the original non-exclusive claim. |
| `_shared/lifecycle.ts` + `poll-tick` | Dedup, snapshots, reopen, close, health | ✓ VERIFIED | Pure transitions are tested and applied to real database updates. |
| `0009` + `_shared/discovery-health.ts` | Chicago cadence and health model | ✓ VERIFIED | DST-safe slot logic and freshness model have deterministic coverage. |
| `0010` + `0011` | Atomic slot admission and quota reservation | ✓ VERIFIED | Singleton row lock serializes admission and quota; UTC date is read after lock. |
| `discovery-sweep` | Budgeted Adzuna ingestion | ✓ VERIFIED | Distinct seeds, pre-fetch reservation, dedup, lifecycle, and persisted health are wired. |
| `heartbeat` + `pipeline.ts` + `Shell.tsx` | External/in-app liveness | ✓ VERIFIED | Both surfaces consume polling and discovery freshness. |
| Verification drivers | Rerunnable hosted proof | ✓ VERIFIED | Pipeline probes 1-16 passed; watchlist verifier passed twice without seed/job-link corruption. |

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `Watchlist.tsx` | `watchlist.ts` | Query and mutations | ✓ WIRED | Live data drives table and actions. |
| `watchlist.ts` | `verify-board` | `functions.invoke` before insert | ✓ WIRED | Manual source trace resolves checker regex limitation. |
| `verify-board` | `_shared/detect.ts` | Direct import and allowlisted endpoint builder | ✓ WIRED | Manual source trace resolves extension-qualified import limitation. |
| `poll-tick` | ATS adapters | Direct imports and dispatch | ✓ WIRED | All three adapters return `NormalizedJob[]`. |
| `poll-tick` | exclusive claim RPC/jobs | RPC and database updates | ✓ WIRED | Hosted concurrent-claim probe proved disjoint batches. |
| minute cron | `poll-tick` | Vault-authenticated `net.http_post` | ✓ WIRED | Hosted heartbeat advanced without manual invocation. |
| schedule gate | `discovery-sweep` | 30-minute cron plus Chicago slot admission | ✓ WIRED | Atomic admission prevents duplicate slot execution. |
| `discovery-sweep` | quota RPC + dedup + health | Pre-fetch reservation and persisted summary | ✓ WIRED | Atomic SQL and source ordering are covered by tests. |
| `heartbeat` | `pipeline_heartbeat` | Service-role freshness read | ✓ WIRED | Polling and discovery failures produce 503. |
| `Shell.tsx` | `pipeline.ts` | 60-second query and pure banner derivation | ✓ WIRED | Real heartbeat values drive banner rendering. |

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `Watchlist.tsx` | `companiesQuery.data` | `listCompanies()` → `public.companies` | Yes | ✓ FLOWING |
| `poll-tick` | normalized ATS jobs | Live ATS adapters → `public.jobs` | Yes | ✓ FLOWING |
| `discovery-sweep` | Adzuna results | enabled `seed_queries` → Adzuna → `public.jobs` | Yes | ✓ FLOWING |
| `Shell.tsx` | heartbeat row/banner | `public.pipeline_heartbeat` → `fetchHeartbeat()` | Yes | ✓ FLOWING |

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full deterministic regression | `cd web && npx vitest run` | 14 files, 110 tests passed | ✓ PASS |
| Production compilation/bundle | `cd web && npm run build` | TypeScript and Vite build passed | ✓ PASS |
| Lifecycle transitions | Full regression includes `lifecycle.test.ts` | 12 reopen/refresh/close/heartbeat tests passed | ✓ PASS |
| Cadence, DST, quota, discovery health | Full regression includes `discovery-health.test.ts` | 19 focused tests passed | ✓ PASS |
| Banner state behavior | Full regression includes `pipeline.test.ts` | 9 focused tests passed | ✓ PASS |

## Probe Execution

No conventional `scripts/**/tests/probe-*.sh` files are declared. The phase uses stateful TypeScript verification drivers, so this verifier did not re-run them and mutate hosted state a third time. Current execute-session evidence records:

| Driver | Result | Status |
|--------|--------|--------|
| `scripts/verify-pipeline.ts` | Exit 0; probes 1-16 PASS after migrations 0010/0011 and final deployments | ✓ PASS |
| `scripts/verify-watchlist.ts` | Exit 0 twice; disposable row cleanup and seed/job-link integrity PASS | ✓ PASS |
| Hosted deployment | Migrations 0008-0011 remote; `poll-tick`, `discovery-sweep`, and `heartbeat` active | ✓ PASS |

## Requirements Coverage

| Requirement | Source Plans | Status | Evidence |
|-------------|--------------|--------|----------|
| PREF-02 | 02-01, 02-05 | ✓ SATISFIED | CRUD/shared RLS are implemented and deployed browser UAT test 1 passed. |
| PREF-03 | 02-01 | ✓ SATISFIED | Detector and endpoint constructor support Greenhouse, Lever, and Ashby. |
| PREF-04 | 02-01, 02-02, 02-06 | ✓ SATISFIED | Health derivation and deployed light/dark/hover presentation passed UAT test 2. |
| DISC-01 | 02-02, 02-05, 02-07 | ✓ SATISFIED | Minute scheduling, 9-minute due threshold, batching, exclusive claims, and hosted proof. |
| DISC-02 | 02-03, 02-06, 02-07 | ✓ SATISFIED | Adzuna discovery runs on the accepted quota-safe cadence. |
| DISC-03 | 02-02, 02-04, 02-05 | ✓ SATISFIED | Stable IDs, fingerprint dedup, reopen semantics, and hosted repeated-poll proof. |
| DISC-04 | 02-02, 02-04 | ✓ SATISFIED | Full ATS snapshots are captured once and preserved. |
| DISC-05 | 02-02, 02-04 | ✓ SATISFIED | Successful non-empty disappearance transition is tested; failed/empty polls never close. |
| DISC-06 | 02-02, 02-03, 02-04, 02-06 | ✓ SATISFIED | Poll/discovery heartbeat, external 503 surface, and in-app warnings are wired. |

No orphaned Phase 2 requirement IDs were found.

## Anti-Patterns and Disconfirmation Pass

| Check | Result | Assessment |
|-------|--------|------------|
| Debt markers (`TBD`, `FIXME`, `XXX`) | None in 35 reviewed implementation files | ✓ CLEAN |
| Placeholder scan | URL input placeholder and seed-query configuration comment only | ℹ Intentional, not stubs |
| Partial requirement | PREF-02 edit is the locked remove-and-re-add equivalent | ✓ Browser UAT passed |
| Potentially misleading structural tests | SQL tests inspect locking/order text rather than execute PostgreSQL | ✓ Hosted probes/deploy evidence supplies the integration layer |
| Presentation path | Watchlist flow and native hover require human judgment | ✓ Both human checks passed |

The final standard-depth code review covered 35 files and reported 0 critical, 0 warning, and 0 informational findings.

## Human Verification Completed

### 1. Deployed Watchlist flow

**Test:** Open Watchlist, add a supported board, replace it by removing and re-adding it, then remove it through the confirmation dialog.

**Expected:** The table and persisted state match every action, removal always confirms first, and unrelated captured jobs remain intact.

**Result:** PASS — recorded in `02-UAT.md` test 1 on 2026-07-17.

### 2. Health badge presentation

**Test:** Inspect OK, Failing, and Stale rows in light and dark themes and hover each badge.

**Expected:** States are distinct and readable and the hover text reports correct last-success context.

**Result:** PASS — recorded in `02-UAT.md` test 2 on 2026-07-17.

## Recovery Email Waiver

The cron-job.org failure email was observed. Receipt of a later recovery email was explicitly waived by the user and remains **unknown**, not passed. This does not block the roadmap criterion: the external monitor already demonstrated that stale/failing heartbeat responses produce an alert, while recovery is also visible through the endpoint and in-app health state.

## Gaps Summary

All six prior blocking gaps are closed or covered by the accepted cadence override. Both remaining human browser/UI checks passed. No implementation gap or regression remains; the phase is `passed`.

---

_Verified: 2026-07-17T20:11:25Z_
_Verifier: the agent (gsd-verifier)_

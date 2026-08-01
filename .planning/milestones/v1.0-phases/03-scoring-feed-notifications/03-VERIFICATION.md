---
phase: 03-scoring-feed-notifications
verified: 2026-07-20T21:13:54Z
status: passed
score: 17/17 must-haves verified
behavior_unverified: 0
overrides_applied: 0
gaps: []
---

# Phase 3: Scoring & Feed Re-verification Report

**Phase Goal:** As a new grad seeking an entry-level job, I want to review relevant jobs scored against my preferences and resume in a web dashboard, so that I can quickly focus on the strongest opportunities that best fit me.

**Status:** passed
**Re-verification:** Yes — all four gaps from the initial 2026-07-20 verification were remediated and rechecked.

## Final Release Identity

| Component | Verified identity |
|---|---|
| Git release | `020295200ff3e48db4d685f5382c10f406ca7967` |
| Database migration | `0027` |
| `score-tick` | deployment `ae6c147f-c3a8-417e-8057-d4105ac9aed5`, version 6, active |
| `extract-resume` | deployment `9358db1a-95fc-49bc-a684-b98fb8eceff9`, version 3, active |
| Cloudflare Pages | `877499ee-f1ad-4067-b8f2-b5c152954141` |
| Immutable frontend asset | `/assets/index-lyvShdhx.js` |
| Asset SHA-256 | `a6f11edc4d18ed264233d5d17e2fd2005e9064036ec09409cf95761498013d66` |

The immutable deployment and production alias served byte-identical 574,383-byte assets. `03-FINAL-ROLLOUT-EVIDENCE.md`, `03-FINAL-PAID-PROOF.md`, and `03-UAT.md` bind automated and human evidence to these identities.

## User Flow Coverage

| Step | Expected | Evidence | Status |
|---|---|---|---|
| Set preferences | Save target titles, locations, and include/exclude keywords | Preferences implementation and UAT 1/3/8 | Verified |
| Supply resumes | Upload and manage multiple private DOCX resumes | Private storage/RLS, extraction worker v3, upload UAT | Verified |
| Filter and score | Reject preference failures before AI; score survivors against current inputs | `cheapFilter`, scoring hash/CAS, worker v6, final paid proof | Verified |
| Review matches | All jobs contains preference passes; Focused contains scores at least 50 | Feed implementation and UAT 1/4/6/8 | Verified |
| Inspect details | Show score, reasons, JD snapshot, gaps, routed resume, time, company, and safe apply link | Dashboard/detail implementation and UAT 5 | Verified |
| Stay current | Saved preference and resume changes reroute/refilter without manual intervention | Invalidation/reroute tests and completed production UAT | Verified |

## Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Preferences save and persist per user | Verified | Preferences route, mutation/query wiring, RLS, UAT |
| 2 | Provider-agnostic cheap filters reject irrelevant jobs before AI | Verified | `cheapFilter` precedes route/hash/AI; filter tests |
| 3 | Multiple base resumes remain private to their owner | Verified | Private bucket, own-row policies, resume CRUD, UAT |
| 4 | DOCX archives are bounded before any parser expands them | Verified | `preflightDocxArchive` runs before Mammoth; hostile entry-count, size, ratio, and metadata fixtures |
| 5 | Extraction is claimed once and ready extracts trigger rerouting | Verified | Extraction claim/reroute RPCs and worker tests |
| 6 | Survivors receive grounded scores and plain-language reasons | Verified | Current preferences/resume enter scoring input and prompt; paid proof and UAT |
| 7 | Semantic hash and revision CAS prevent stale publication | Verified | Scoring-input/CAS implementation and tests |
| 8 | Provider/company identity is truthful and source-neutral | Verified | Provider normalization, unified scoring path, UAT 2 |
| 9 | All and Focused feeds implement preference-pass and score-at-least-50 semantics | Verified | Feed predicates and UAT 6/8 |
| 10 | Detail view safely renders the JD snapshot and advisory gaps | Verified | DOMPurify boundary, safe HTTPS apply guard, UAT 5 |
| 11 | Seen and dismissed state is per user | Verified | Own-row `user_jobs` RLS and UAT 6 |
| 12 | Successful preference saves evict stale feed cache | Verified | Query cancellation/removal/invalidation tests |
| 13 | Maintenance latch confines verification claims and normal operation resumes | Verified | Migration 0025, verifier tests, final proof cleanup audit |
| 14 | Physical paid scoring attempts stay below the authorized daily ceiling | Verified | `maxAttempts: 1` for scoring plus atomic reservation; retry-cap tests; worker v6 |
| 15 | Production verification cannot overwrite legitimate user changes | Verified | Disposable verifier account is created only after pause/drain and deleted before cron restore; failure-injection tests |
| 16 | Paid proof and human UAT bind to the same immutable release | Verified | Final rollout/paid artifacts and UAT identities above |
| 17 | Notification runtime and UI remain absent | Verified | Notification-removal regression and UAT 7 |

**Score:** 17/17 truths verified; no behavioral truth is unverified and no override was used.

## Required Artifacts

| Artifact | Status | Verification |
|---|---|---|
| `supabase/migrations/0017_preferences.sql` | Verified | Per-user preferences and RLS |
| `supabase/functions/_shared/filters.ts` | Verified | Pure, source-neutral preference filter |
| `supabase/functions/_shared/docx.ts` | Verified | Trustworthy ZIP preflight before Mammoth |
| `supabase/functions/extract-resume/index.ts` | Verified | Claimed private extraction and reroute flow |
| `supabase/migrations/0019_user_jobs_scoring.sql`, `0025_scoring_freshness.sql`, `0027_score_budget_after_free_work.sql` | Verified | Scoring rows, CAS/latch, and paid deferral/reservation |
| `supabase/functions/score-tick/index.ts` | Verified | Filter, route, hash/reuse, reserved single-attempt score, CAS persist |
| `web/src/lib/feed.ts` | Verified | RLS-scoped preference-pass and focused projections |
| `web/src/pages/Dashboard.tsx` | Verified | Unified ranked feed and controls |
| `web/src/pages/JobDetail.tsx` | Verified | Sanitized detail view and safe apply link |
| `scripts/verify-scoring-freshness.ts` | Verified | Disposable-account, fail-closed verifier |
| `03-FINAL-ROLLOUT-EVIDENCE.md`, `03-FINAL-PAID-PROOF.md`, `03-UAT.md` | Verified | Same-release automated and human proof |

## Resolved Initial Gaps

| Initial gap | Resolution | Evidence |
|---|---|---|
| DOCX parser could expand before bounds checking | Added trustworthy central/local ZIP metadata preflight before Mammoth | Commit `70beef1`; hostile DOCX fixtures; `extract-resume` v3 |
| One reservation could cover multiple physical OpenAI attempts | Added configurable attempts and forced scoring to one physical attempt per reservation | Commit `4c0f87c`; retry-cap tests; `score-tick` v6 |
| Verifier cleanup could restore over real-user changes | Moved verification into a unique disposable account inside the paused/drained interval | Commits `273b3b6`, `f40c2eb`, `96c58db`, `d5805a9`, `0202952`; 15 verifier/evidence tests |
| Automated paid proof and UAT covered different releases | Captured rollout identity, one approved paid run, and final UAT on release `0202952` | Final rollout/paid artifacts and UAT 8 |

## Automated and Runtime Evidence

- Web test suite: 409/409 passing.
- Verifier/evidence test suite: 15/15 passing.
- Production evidence validators pass for rollout-only and rollout-plus-paid-proof modes.
- Web build passes. Lint passes with one pre-existing Fast Refresh warning in `AuthProvider`.
- Final paid proof observed exactly one verifier-owned `gpt-5.4-nano` usage and an HTTP 200 `score-tick` v6 execution.
- The verifier's core assertions passed. Its process exited nonzero only because an isolated synthetic fixture cleanup request received HTTP 520; three exact, ownership-validated `verify-*` fixtures were then deleted manually. The final residue audit found zero verifier accounts, profiles, preferences, resumes, extracts, `user_jobs`, fixtures, or latches, and the cron was active. No real-user data was involved.

## Requirements Coverage

`PREF-01`, `RESU-01`, and `SCOR-01` through `SCOR-05` are satisfied by the verified implementation, automated evidence, production proof, and 8/8 human UAT.

## Human Verification Required

None. Human UAT is complete: 8 passed, 0 issues, 0 pending, 0 skipped, 0 blocked.

## Residual Notes

- Workday polling and an explicit entry-level/years-of-experience preference are captured as future scope; neither is a Phase 3 requirement.
- The final paid-proof cleanup exception is retained in the evidence record rather than hidden. Exact cleanup and a zero-residue audit resolved it without an override.

## Final Assessment

Phase 3 achieves its goal on the final deployed release. All 17 must-haves and all 8 human acceptance tests pass, with no open Phase 3 verification gap.

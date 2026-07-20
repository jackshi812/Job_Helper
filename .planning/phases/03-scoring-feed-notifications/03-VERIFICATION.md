---
phase: 03-scoring-feed-notifications
verified: 2026-07-20T20:02:35Z
status: gaps_found
score: 13/17 must-haves verified
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "Uploaded DOCX archives are bounded against zip bombs before any parser expands them"
    status: failed
    reason: "extractDocxText calls Mammoth on the untrusted archive before the JSZip entry-count and uncompressed-size guards run; a Mammoth-success path bypasses those guards entirely."
    artifacts:
      - path: "supabase/functions/_shared/docx.ts"
        issue: "Lines 109-117 invoke extractViaMammoth first and enter the guarded JSZip path only after Mammoth throws; missing JSZip private size metadata is also counted as zero."
    missing:
      - "Preflight every DOCX archive with trustworthy bounded metadata before Mammoth or any other expanding parser."
      - "Add hostile high-ratio, excessive-entry, and unavailable-size fixtures proving Mammoth is not called after preflight rejection."
  - truth: "The user-authorized daily ceiling below 500 limits physical paid scoring API attempts"
    status: failed
    reason: "score-tick reserves once per logical score, but generateStructured can make three physical OpenAI requests after retryable 429/5xx responses, so a 499 reservation ceiling can authorize up to 1,497 requests."
    artifacts:
      - path: "supabase/functions/score-tick/index.ts"
        issue: "One reserve_score_request call precedes generateStructured."
      - path: "supabase/functions/_shared/openai.ts"
        issue: "The shared wrapper retries twice after the initial request without consuming another reservation."
    missing:
      - "Reserve atomically before each physical scoring attempt, or disable scoring retries."
      - "Add a retry fixture proving each attempted fetch consumes capacity and the cap blocks the next attempt."
  - truth: "Production verification cleanup cannot overwrite legitimate concurrent user changes"
    status: failed
    reason: "The verifier snapshots a real user's rows/preferences and restores them with unconditional update/upsert/delete operations. The scoring latch restricts claims, not browser preference writes or extraction reroute signals, so cleanup can roll back changes made after the snapshot."
    artifacts:
      - path: "scripts/verify-scoring-freshness.ts"
        issue: "restoreRows updates by id only; restoreData unconditionally upserts or deletes the target preference row."
    missing:
      - "Use a disposable verifier account, or restore every touched row with compare-and-swap predicates that refuse to overwrite an unexpected concurrent revision."
      - "Add a failure-injection test where an independent post-snapshot change survives cleanup or causes an explicit fail-closed recovery state."
  - truth: "Paid automated proof and all human UAT apply to the same immutable release"
    status: failed
    reason: "The paid proof is bound to git c15ad867, migration 0025, score-tick v3, and asset index-BxwGvdK2.js, while completed UAT is bound to git 1eb7525, migration 0027, score-tick v5, and asset index-lyvShdhx.js; the UAT asset hash is also not recorded."
    artifacts:
      - path: ".planning/phases/03-scoring-feed-notifications/03-11-PAID-PROOF.md"
        issue: "Records the earlier Plan 03-10 release identity."
      - path: ".planning/phases/03-scoring-feed-notifications/03-UAT.md"
        issue: "Records a later remediated release and asset_sha256: not_recorded."
    missing:
      - "Produce an approved proof artifact for the final release, or document and accept a formal verification override explaining why the earlier paid proof remains sufficient for the later score-worker changes."
      - "Record the final immutable frontend asset SHA-256."
---

# Phase 3: Scoring & Feed Verification Report

**Phase Goal:** As a new grad seeking an entry-level job, I want to review relevant jobs scored against my preferences and resume in a web dashboard, so that I can quickly focus on the strongest opportunities that best fit me.
**Verified:** 2026-07-20T20:02:35Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## User Flow Coverage

User story: “As a new grad seeking an entry-level job, I want to review relevant jobs scored against my preferences and resume in a web dashboard, so that I can quickly focus on the strongest opportunities that best fit me.”

| Step | Expected | Evidence | Status |
|---|---|---|---|
| Set preferences | Save target titles, locations, and include/exclude keywords | `Preferences.tsx` → `savePreferences`; UAT 1 and 3 passed | ✓ |
| Supply resume | Upload/manage multiple private DOCX resumes | `resumes.ts`, migrations 0002/0003, private bucket + own-row policies; UAT 3 passed | ✓ |
| Filter and score | Irrelevant jobs filter before AI; survivors score against current resume/preferences | `score-tick/index.ts` orders `cheapFilter` before routing/hash/AI; semantic hash/CAS tests pass; paid proof records one fresh positive and one free negative | ✓ |
| Review matches | All jobs shows current preference passes; Focused shows score ≥50 | `preferenceVisible`/`defaultVisible`; UAT 1, 2, 4, and 6 passed | ✓ |
| Inspect details | View score, reasons, JD snapshot, gaps, routed resume, posted time, and safe apply link | `Dashboard.tsx`, `JobDetail.tsx`, DOMPurify and HTTPS guard; UAT 5 passed | ✓ |
| Outcome | Quickly focus on strongest fitting opportunities | 7/7 human UAT passed on the final deployed UI | ✓, with release-binding gap |

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Preferences can be saved and persist | ✓ VERIFIED | Preferences route, query/mutation wiring, RLS schema, and UAT 1/3 |
| 2 | Provider-agnostic cheap filters reject irrelevant jobs before AI | ✓ VERIFIED | `cheapFilter` precedes routing/hash/`generateStructured`; 72 targeted tests passed |
| 3 | Multiple base resumes are managed in private own-user storage | ✓ VERIFIED | Private `resumes` bucket, storage-folder policies, resume CRUD, and UAT |
| 4 | DOCX parsing enforces archive bounds before expansion | ✗ FAILED | Mammoth runs before JSZip guards; see Gap 1 |
| 5 | Extraction is claimed once, reroutes on ready, and cascades on deletion | ✓ VERIFIED | `claim_resume_extractions`, ready reroute RPC, cascade schema, and paid provider smoke evidence |
| 6 | Surviving jobs receive scores and plain-language reasons grounded in current inputs | ✓ VERIFIED | Routed resume text/preferences enter the scoring hash/prompt; paid proof and UAT 3/4 |
| 7 | Semantic hash + revision CAS suppress stale score publication | ✓ VERIFIED | `scoring-input.ts`, migration 0025, score worker CAS branches, targeted tests |
| 8 | Adzuna/Greenhouse/Ashby identity is truthful and source-neutral | ✓ VERIFIED | Normalized/source name mapping, no source branch in score worker, UAT 2 |
| 9 | Unified All/Focused feed implements preference-pass and ≥50 semantics | ✓ VERIFIED | `preferenceVisible`, `defaultVisible`, Dashboard consumption, UAT 6 |
| 10 | Detail view safely renders JD snapshot and advisory gaps | ✓ VERIFIED | Single DOMPurify-sanitized HTML path, plain-text gap/reason rendering, safe apply guard, UAT 5 |
| 11 | Seen/dismiss state is per user | ✓ VERIFIED | Own-row `user_jobs` RLS and column-limited mutations; UAT 6 |
| 12 | Successful preference saves evict stale feed cache; failures preserve retry state | ✓ VERIFIED | Query cancellation/removal/invalidation and integration tests |
| 13 | Maintenance latch confines matching claims and normal operation resumes afterward | ✓ VERIFIED | Migration 0025, 12 verifier/evidence tests, paid two-fixture proof |
| 14 | Physical paid scoring calls stay below the authorized daily ceiling | ✗ FAILED | One reservation can cover three retried fetches; see Gap 2 |
| 15 | Verifier cleanup preserves concurrent legitimate changes | ✗ FAILED | Unconditional snapshot restoration; see Gap 3 |
| 16 | Paid proof and human UAT are bound to one immutable release | ✗ FAILED | Paid proof and final UAT identify different releases; see Gap 4 |
| 17 | Notification runtime/UI remains absent | ✓ VERIFIED | Notification-removal regression and UAT 7 |

**Score:** 13/17 truths verified (0 present-but-behavior-unverified)

## Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `supabase/migrations/0017_preferences.sql` | Per-user preferences + RLS | ✓ VERIFIED | Exists, substantive, wired through `preferences.ts` |
| `supabase/functions/_shared/filters.ts` | Pure preference filter | ✓ VERIFIED | Source-neutral implementation; targeted fixtures pass |
| `supabase/functions/_shared/docx.ts` | Bounded DOCX extractor | ✗ PARTIAL | Exists and is used, but pre-expansion archive guard is not enforced |
| `supabase/functions/extract-resume/index.ts` | Claimed extraction worker | ✓ VERIFIED | Storage download → DOCX extraction → OpenAI → ready/reroute |
| `supabase/migrations/0019_user_jobs_scoring.sql` / `0025_scoring_freshness.sql` / `0027_score_budget_after_free_work.sql` | Scoring rows, claim/CAS/latch, paid deferral | ✓ VERIFIED | Substantive and used by score worker; automated verifier's regex miss on 0025 is a tooling false negative caused by alternation handling |
| `supabase/functions/score-tick/index.ts` | Filter → route → hash/reuse → score → persist | ⚠️ PARTIAL | Core flow is wired; physical-attempt accounting and stale deferral labels need correction |
| `web/src/lib/feed.ts` | RLS-scoped unified feed projection | ⚠️ PARTIAL | Core flow works; eligibility is still applied after the 200-row limit |
| `web/src/pages/Dashboard.tsx` | Focused/All jobs feed | ✓ VERIFIED | Real feed data, scoring, reasons, company, posted time, apply, dismissal |
| `web/src/pages/JobDetail.tsx` | Sanitized JD + advisory gaps | ✓ VERIFIED | DOMPurify boundary and detail query wired |
| `scripts/verify-scoring-freshness.ts` | Fail-closed, exact-restoration verifier | ✗ PARTIAL | Latch/one-shot logic works, but concurrent user changes can be overwritten during restore |
| `03-11-PAID-PROOF.md` and `03-UAT.md` | Same-release automated + human proof | ✗ PARTIAL | Individually complete, but bound to different deployed releases |

## Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| Preferences page | preferences table | `loadPreferences` / `savePreferences` | ✓ WIRED | Imports and Supabase upsert/query confirmed |
| Resume worker | private storage + DOCX/OpenAI helpers | storage download and helper calls | ✓ WIRED | Real bytes and extracted text flow into cached extraction |
| Score worker | filters/routing/hash/OpenAI/user_jobs | ordered server-side pipeline | ✓ WIRED | One source-neutral path; CAS-protected terminal writes |
| Dashboard | feed query | TanStack Query `listFeed` | ✓ WIRED | RLS-scoped rows populate visible table |
| Job detail | feed detail + DOMPurify | `getFeedJob` and sanitized HTML | ✓ WIRED | JD body is fetched only on detail and sanitized before insertion |
| Verifier | latch + score tick + proof | begin/end RPCs and one run UUID | ⚠️ PARTIAL | Claim isolation works; restoration is not concurrency-safe |
| Paid proof | final UAT | immutable release identity | ✗ NOT WIRED | Artifact identities differ after remediation releases |

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| Preferences | chip arrays | `preferences` own row | Yes | ✓ FLOWING |
| Dashboard | `rows` | `user_jobs` joined to jobs/companies | Yes | ✓ FLOWING |
| Job detail | selected `FeedRow` | single `user_jobs` detail query | Yes | ✓ FLOWING |
| Resume routing/scoring | extraction text + preference/job inputs | private storage, `resume_extracts`, `preferences`, `jobs` | Yes | ✓ FLOWING |

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Filtering, feed visibility, resume client, preference convergence, company mapping, and freshness contracts | `cd web && npx vitest run` with six named Phase 3 test files | 6 files, 72 tests passed | ✓ PASS |
| One-shot verifier/evidence state machine | `node --experimental-strip-types --test scripts/verify-scoring-freshness.test.mjs scripts/verify-scoring-evidence.test.mjs` | 12/12 passed | ✓ PASS |
| Paid proof schema/release consistency against its rollout evidence | `node scripts/verify-scoring-evidence.mjs --paid ...` | PASS | ✓ PASS |

## Probe Execution

No Phase 3 probe scripts are declared or present. Probe execution is not applicable.

## Requirements Coverage

| Requirement | Source Plans | Status | Evidence |
|---|---|---|---|
| PREF-01 | 01, 07-11 | ✓ SATISFIED | Persisted chips, refilter signal, cache invalidation, UAT |
| RESU-01 | 02, 07 | ⚠️ PARTIAL | Private multi-resume management works, but promised DOCX archive hardening fails before Mammoth |
| SCOR-01 | 01, 03, 07-11 | ✓ SATISFIED | Cheap filter order/source neutrality and tests |
| SCOR-02 | 02, 03, 07-11 | ⚠️ PARTIAL | Grounded scoring works; physical request ceiling and final-release proof are incomplete |
| SCOR-03 | 03, 07-11 | ✓ SATISFIED | Reasons persisted/rendered; UAT passed |
| SCOR-04 | 04, 07-11 | ✓ SATISFIED | Unified feed and controls passed UAT, with post-limit completeness warning |
| SCOR-05 | 03, 04, 07, 11 | ✓ SATISFIED | Full JD and advisory gap panel passed UAT |

No Phase 3 requirement is orphaned. Notification-plan requirements were explicitly superseded and removed by Plan 07 and are not part of the current roadmap contract.

## Anti-Patterns Found

| File | Pattern | Severity | Impact |
|---|---|---|---|
| `supabase/functions/_shared/docx.ts` | Security guard after parser | 🛑 Blocker | Hostile DOCX may expand before bounds apply |
| `score-tick/index.ts` + `_shared/openai.ts` | Logical reservation around retrying physical request | 🛑 Blocker | Paid-call limit can be exceeded |
| `scripts/verify-scoring-freshness.ts` | Unconditional snapshot restore | 🛑 Blocker | Concurrent real-user changes can be lost |
| `score-tick/index.ts` | Deferred row retains obsolete filtered status/reason | ⚠️ Warning | All jobs can label a current preference pass as a mismatch |
| `web/src/lib/feed.ts` | Client filtering after `.limit(200)` | ⚠️ Warning | Ineligible leading rows can displace valid matches |
| `_shared/adapters/adzuna.ts` | Runtime provider fields trusted | ⚠️ Warning | One malformed item can abort a sweep |
| `web/src/lib/resumes.ts` | Throws after durable upload+metadata commit | ⚠️ Warning | UI can report failure and induce duplicate retry |

No unreferenced `TBD`, `FIXME`, or `XXX` debt markers were found in the inspected Phase 3 runtime files.

## Confirmation-Bias Countercheck

- **Partially met requirement:** RESU-01's user-visible upload/manage path works, but the Plan 02 bounded-parser promise does not.
- **Passing test that misses the stated behavior:** verifier cleanup tests pass using controlled fake mutations, but none performs an independent post-snapshot user change that unconditional restoration must preserve.
- **Uncovered error path:** two retryable OpenAI failures followed by success are not coupled to three atomic paid-cap reservations.

## Human Verification Required

None. Existing `03-UAT.md` is complete with 7/7 passes and is accepted as the human evidence. The remaining issues are observable code/evidence gaps, not unresolved visual judgments.

## Gaps Summary

The end-user flow is implemented and human UAT passed, but Phase 3 cannot receive a canonical `passed` verdict yet. Four plan-level guarantees remain false: DOCX bounds are applied too late, paid retries bypass the physical request ceiling, verifier cleanup can overwrite concurrent user changes, and the paid proof is not bound to the later release that passed final UAT. The four warning-level findings should also be remediated or explicitly accepted, but they are not counted as independent blockers in the 13/17 score.

---

_Verified: 2026-07-20T20:02:35Z_
_Verifier: the agent (gsd-verifier; generic-agent workaround)_

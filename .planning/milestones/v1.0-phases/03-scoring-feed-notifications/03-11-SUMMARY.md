---
phase: 03-scoring-feed-notifications
plan: 11
subsystem: testing
tags: [production-verification, scoring, uat, supabase, cloudflare]

requires:
  - phase: 03-scoring-feed-notifications
    provides: Plan 03-10 immutable production release and latch-backed verifier
provides:
  - One approved, bounded paid production scoring proof
  - Exact restoration and zero-residue evidence
  - Completed seven-check human UAT for the unified preference-matched feed
affects: [phase-04, scoring, dashboard, production-operations]

tech-stack:
  added: []
  patterns:
    - One-shot production proof with explicit paid-effect authorization
    - Preference-pass All jobs view with score-thresholded focused view

key-files:
  created:
    - .planning/phases/03-scoring-feed-notifications/03-11-PAID-PROOF.md
    - .planning/phases/03-scoring-feed-notifications/03-11-SUMMARY.md
  modified:
    - .planning/phases/03-scoring-feed-notifications/03-UAT.md
    - supabase/functions/score-tick/index.ts
    - supabase/migrations/0027_score_budget_after_free_work.sql
    - web/src/lib/feed.ts
    - web/src/pages/Dashboard.tsx

key-decisions:
  - "The separately approved verifier process was one-shot and permitted at most one owned paid score call with no retry."
  - "All jobs contains confirmed current preference-pass rows regardless of score; Focused contains that same pool at score 50 or higher."
  - "The temporary July 20 paid-score ceiling is 499 and automatically returns to the configured 200-call ceiling after the UTC date boundary."

patterns-established:
  - "Paid-budget accounting occurs after free filtering and score reuse, so reaching the paid cap cannot block free refilter work."
  - "Feed visibility is derived from current preference eligibility, not merely the existence of a user_jobs diagnostic row."

requirements-completed: [PREF-01, SCOR-01, SCOR-02, SCOR-03, SCOR-04, SCOR-05]

coverage:
  - id: D1
    description: One approved production verifier run proved latch isolation, one owned paid score delta, exact restoration, and zero residue.
    requirement: SCOR-02
    verification:
      - kind: integration
        ref: node scripts/verify-scoring-evidence.mjs --paid 03-10-ROLLOUT-EVIDENCE.md 03-11-PAID-PROOF.md
        status: pass
    human_judgment: false
  - id: D2
    description: Provider-agnostic preference filtering and truthful company identity work in one unified dashboard.
    requirement: SCOR-01
    verification:
      - kind: manual_procedural
        ref: 03-UAT.md tests 1-3 and 6
        status: pass
    human_judgment: true
    rationale: Relevance and truthful presentation require judgment against visible production results.
  - id: D3
    description: Scores, tiers, reasons, routed resumes, job detail, dismissal behavior, and notification absence satisfy the Phase 3 user workflow.
    requirement: SCOR-04
    verification:
      - kind: manual_procedural
        ref: 03-UAT.md tests 3-7
        status: pass
    human_judgment: true
    rationale: End-to-end usefulness and presentation were judged in the deployed application.

duration: 187min
completed: 2026-07-20
status: complete
---

# Phase 03 Plan 11: Paid Proof and Human UAT Summary

**The deployed scoring correction now has bounded paid-production proof and 7/7 passing human UAT, including the final preference-only All jobs and score-50 Focused semantics.**

## Performance

- **Duration:** 187 minutes from the first paid-proof attempt through final UAT closeout
- **Completed:** 2026-07-20
- **Tasks:** 3 checkpoints/tasks completed
- **Files modified:** 8 material source, migration, test, and evidence files across the proof and follow-up gap fixes

## Accomplishments

- Ran exactly one newly approved verifier process after the earlier failed attempt was remediated and separately reauthorized. The passing process claimed exactly two registered fixtures, produced one target-owned `purpose=score` usage delta, produced zero other paid deltas, restored cron/data/preferences exactly, ended the latch, and left zero residue.
- Diagnosed the initial post-proof zero-match UAT failure and shipped budget-after-free-work scoring, deferred paid state, and the corrected feed query so preference changes can expose valid matches without being trapped behind a paid backlog.
- Confirmed the final dashboard contract with the user: All jobs shows confirmed current preference matches at any score, while Focused shows the same eligible pool at score 50 or higher. Human UAT finished 7/7 passing.

## Task Commits

| Task | Commit | Description |
|---|---|---|
| Paid production proof | `5f56504` | Record the passing one-shot latch-backed verifier evidence |
| Initial UAT and diagnosed gap | `d85f4f8` | Record the focused-feed UAT failure for remediation |
| Budget-after-free-work fix | `2876c74` | Let free filter/reuse work proceed and defer only paid survivors |
| Feed candidate query fix | `80d772e` | Retain valid focused matches beyond the bounded parent query |
| Bounded temporary scoring capacity | `1e169cc` | Raise the July 20 ceiling below the user-authorized 500-call maximum |
| Final feed semantics | `7ef01d8` | Restrict All jobs to current preference-pass rows regardless of score |
| Human UAT completion | `d511bec` | Record 7/7 passes and archive the resolved debug sessions |

## Files Created/Modified

- `.planning/phases/03-scoring-feed-notifications/03-11-PAID-PROOF.md` — bounded release identity, invocation, paid delta, isolation, restoration, and cleanup evidence.
- `.planning/phases/03-scoring-feed-notifications/03-UAT.md` — exact user observations and final 7/7 passing result.
- `supabase/functions/score-tick/index.ts` — free-work-first budget flow and date-bounded temporary score ceiling.
- `supabase/migrations/0027_score_budget_after_free_work.sql` — atomic paid reservation and deferred-row state.
- `web/src/lib/feed.ts` and `web/src/pages/Dashboard.tsx` — current preference-pass pool and focused score threshold.
- Associated scoring and feed tests — regression coverage for budget, eligibility, company identity, and feed query behavior.

## Decisions Made

- Preserved the proof's one-process/no-retry boundary. The prior failed attempt remains failed in the evidence history; it was not reclassified or silently retried.
- Used the user's explicit daily authorization as a hard ceiling of 499 calls for July 20 only; the worker automatically returns to the configured 200-call ceiling after the UTC day changes.
- Applied preference eligibility to both dashboard views. Score affects Focused membership but never removes an otherwise eligible row from All jobs.

## Deviations from Plan

### Auto-fixed Issues

**1. Scoring budget blocked free refilter work after the paid ceiling was reached**
- **Found during:** Human UAT after the paid proof
- **Issue:** The budget guard ran before claiming and filtering, so thousands of existing rows awaited refilter while none could become visible without additional paid capacity.
- **Fix:** Moved paid reservation after free filters/reuse, added atomic reservations and explicit deferral state, and performed the approved bounded recovery run.
- **Verification:** Automated scoring/feed tests passed and the user confirmed the dashboard repopulated.

**2. The feed's bounded parent query excluded valid candidates**
- **Found during:** Zero-match production diagnosis
- **Issue:** Valid preference-pass rows could sit behind unrelated pending rows and never reach client-side filtering.
- **Fix:** Server-filtered eligible user_job states, ordered by job posting time, and enforced current preference visibility on the returned pool.
- **Verification:** Production-shaped queries returned eligible matches and automated feed tests passed.

**3. All jobs semantics were weaker than the owner's intended preference filter**
- **Found during:** Final UAT clarification
- **Issue:** All jobs exposed diagnostic/weak rows that did not match current target-title preferences.
- **Fix:** Both views now require confirmed current preference eligibility; Focused additionally requires score 50 or higher.
- **Verification:** The user found Adzuna jobs and explicitly confirmed all tests pass.

---

**Total deviations:** 3 auto-fixed UAT gaps
**Impact on plan:** The fixes expanded runtime and feed work but were required to achieve the Phase 3 user story; they did not add a second paid verifier run or weaken the proof boundary.

## Issues Encountered

- The first separately approved verifier attempt failed before any fixture, latch, tick, or OpenAI activity because the hosted snapshot was truncated; cleanup also left the score cron inactive. The history remains recorded, a narrowly approved repair restored cron state, and a new explicit authorization was obtained before the single passing attempt.
- Adding a new resume temporarily invalidated current scores, exposing the budget ordering and feed-query gaps above. Both are resolved and covered by the final UAT result.

## Verification

- `node scripts/verify-scoring-evidence.mjs --paid .planning/phases/03-scoring-feed-notifications/03-10-ROLLOUT-EVIDENCE.md .planning/phases/03-scoring-feed-notifications/03-11-PAID-PROOF.md` — pass.
- Paid proof: one newly approved process, one owned score delta, zero other deltas, two controlled fixtures, exact restoration, ended latch, restored cron, zero residue.
- Human UAT: 7 passed, 0 issues, 0 pending.
- Full automated suite, lint, and production build passed during the remediation releases.

## Known Stubs

None.

## User Setup Required

None.

## Next Phase Readiness

- Phase 3 behavior and human validation are complete.
- The phase-level verifier must still produce `03-VERIFICATION.md` and confirm requirement traceability before ROADMAP/STATE can mark the phase complete.

## Self-Check: PASSED

- Paid-proof evidence exists and its validator passes.
- UAT exists with status `complete` and 7/7 passing.
- Every listed task/fix commit exists in git history.
- No second unapproved verifier process or manual scoring tick was run during closeout.
- Unrelated `.DS_Store`, `.planning/HANDOFF.json`, and agent-dashboard work remain untouched.

---
*Phase: 03-scoring-feed-notifications*
*Completed: 2026-07-20*

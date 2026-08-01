---
phase: 03-scoring-feed-notifications
plan: 03
subsystem: scoring-pipeline
tags: [scoring, skip-locked, rls, openai, structured-outputs, routing, refilter, edge-functions]
status: complete

requires:
  - phase: 03-scoring-feed-notifications (Plan 01)
    provides: "preferences table (0017), pure cheapFilter + FilterJobInput/FilterPreferences (filters.ts)"
  - phase: 03-scoring-feed-notifications (Plan 02)
    provides: "generateStructured OpenAI Responses wrapper + OPENAI_SCORING_MODEL (openai.ts), resume_extracts + ai_usage (0018), extract-resume worker that already calls mark_user_jobs_for_reroute (guarded)"
provides:
  - "supabase/migrations/0019_user_jobs_scoring.sql — user_jobs table (column-limited user writes), claim_scoring_work SKIP LOCKED RPC (service_role), mark_recent_jobs_for_refilter (authenticated), mark_user_jobs_for_reroute(uuid) (service_role, F2), score-tick cron (LOCAL FILE ONLY, not pushed)"
  - "supabase/functions/_shared/routing.ts — pure routeResume (D-06 keyword-overlap + near-tie runner-up) and tierFor (D-07)"
  - "supabase/functions/score-tick/index.ts — claim → cheapFilter → route → one nano scoring call → persist worker, budget-guarded and injection-hardened"
  - "web refilter wiring: savePreferences and resume upload/delete raise the D-04/D-10 refilter flag"
affects:
  - "Plan 04 (job-detail SCOR-05 gap panel reads user_jobs.gaps/covered; feed reads score/tier/reasons)"
  - "Plan 07 (pushes 0019 to hosted DB, deploys score-tick, proves hosted scoring end-to-end + cross-user RLS denial)"

tech-stack:
  added: []
  patterns:
    - "Scan/claim scoring decoupled from ingestion: claim_scoring_work mirrors claim_due_companies (0008) but locks ONLY user_jobs rows (single-table FROM + scalar-subquery ORDER BY) so it never contends with poll-tick"
    - "Column-level UPDATE grant (seen_at, dismissed_at) as the authorization boundary — users physically cannot alter their own scores (T-3-11)"
    - "Free flag / paid-decision split: refilter flag is cheap to raise; the worker owns the rescore-economy decision (re-score only on real filter/route change, Pitfall 6)"
    - "Server-side clamp + tierFor re-derivation never trusts model arithmetic (Pitfall 5); delimited BEGIN_/END_ data blocks + data-not-instructions line (T-3-09)"

key-files:
  created:
    - supabase/migrations/0019_user_jobs_scoring.sql
    - supabase/functions/_shared/routing.ts
    - supabase/functions/score-tick/index.ts
    - web/tests/routing.test.ts
  modified:
    - web/src/lib/preferences.ts
    - web/src/lib/resumes.ts
    - web/src/lib/resumes.test.ts

key-decisions:
  - "claim_scoring_work locks only user_jobs rows: the claimable CTE selects from user_jobs alone with a scalar-subquery newest-first ORDER BY, so `for update skip locked` never takes locks on jobs rows and cannot contend with poll-tick's plain UPDATEs (02.1 isolation), while still satisfying the literal SKIP LOCKED grep"
  - "Rescore economy (Pitfall 6): a previously scored row flagged needs_refilter that still passes the filter with the same routed_resume_id keeps its existing score (D-10 stale-score); prompt-only preference changes accept staleness (Codex disposition, DEFERRED)"
  - "no_resume_extract is thrown (not terminal): routing null leaves the row to retry within the attempts<5 budget; F2 mark_user_jobs_for_reroute re-flags it once extraction lands, so it is not permanently stranded"
  - "SCORE_SCHEMA carries advisory min/max + minItems/maxItems, but the server-side clamp (0–100) and tierFor re-derivation are the real guards — model arithmetic is never trusted"
  - "OpenAI intent over leftover Gemini wording: RESEARCH Pattern 1 still shows Gemini generateContent/responseSchema (explicitly superseded 2026-07-19). Implemented against generateStructured/OPENAI_SCORING_MODEL; no Gemini endpoint, responseSchema field, or GEMINI_* env introduced"

requirements: [SCOR-01, SCOR-02, SCOR-03, SCOR-05, NOTF-04]

coverage:
  - id: R1
    description: "Cheap filters gate every AI call BEFORE any OpenAI request (SCOR-01)"
    requirement: "SCOR-01"
    verification:
      - kind: other
        ref: "grep: score-tick calls cheapFilter and returns 'filtered' before generateStructured; filters.test.ts 17 fixtures green"
        status: pass
    human_judgment: false
  - id: R2
    description: "One strict Structured Outputs nano call per survivor produces score/tier/reasons/gaps/covered persisted per (job,user) (SCOR-02/03, D-08/D-09)"
    requirement: "SCOR-02"
    verification:
      - kind: other
        ref: "grep: generateStructured with SCORE_SCHEMA (additionalProperties:false, all required); score clamped + tierFor re-derived; user_jobs persist of reasons/gaps/covered"
        status: pass
    human_judgment: true
    rationale: "The scoring call executes only on the hosted edge runtime with OPENAI_API_KEY and real (job,user) rows; no local Deno/OpenAI invocation ran here (deferred to Plan 07). Local proof is composition + schema shape only."
  - id: R3
    description: "Plain-language match reasons (3–5) persisted (SCOR-03, D-09)"
    requirement: "SCOR-03"
    verification:
      - kind: other
        ref: "grep: SCORE_SCHEMA reasons minItems 3/maxItems 5; parseScoreResult slices to 5; user_jobs.reasons jsonb written"
        status: pass
    human_judgment: true
    rationale: "Reason quality/calibration is a judgment property observable only against live model output on hosted deploy (Plan 07)."
  - id: R4
    description: "Keyword-gap data (skills/tools/certs/domain + covered) persisted for SCOR-05 job detail (fed to Plan 04)"
    requirement: "SCOR-05"
    verification:
      - kind: other
        ref: "grep: gaps object schema + user_jobs.gaps/covered columns (0019) + persist in score-tick"
        status: pass
    human_judgment: true
    rationale: "SCOR-05 is only precondition-complete here: this plan persists the gap payload; the advisory gap panel UI ships in a later plan. End-to-end gap rendering is unverified this phase."
  - id: R5
    description: "Scoring reads only post-dedup jobs rows, upstream of any notification (NOTF-04 precondition)"
    requirement: "NOTF-04"
    verification:
      - kind: other
        ref: "grep: claim_scoring_work seeds from public.jobs (status='open', already deduped at ingest); no jobs writes; no notification code in scope"
        status: pass
    human_judgment: true
    rationale: "NOTF-04 is only precondition-satisfied here (scoring is structurally post-dedup); the UNIQUE(user_id,job_id,channel) notification enforcement lands in a later plan."
  - id: R6
    description: "Decoupled scan/claim + refilter/reroute flags (D-04/D-10, F2), routing (D-06) + tiers (D-07)"
    requirement: "SCOR-01"
    verification:
      - kind: tests
        ref: "web/tests/routing.test.ts (7 cases incl. D-07 boundaries 75/74/50/49); migration greps: for update skip locked, grant update (seen_at, dismissed_at), unique (user_id, job_id)"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-07-19
---

# Phase 3 Plan 03: Scoring Pipeline Vertical Slice Summary

**A per-minute `score-tick` worker that claims (job, user) rows via a SKIP LOCKED RPC isolated from poll-tick, gates every AI dollar through the pure cheap filters, routes to the best-fit resume by keyword overlap (D-06), and makes exactly one gpt-5.4 nano strict Structured Outputs call per survivor — persisting score/tier/reasons/gaps/covered per user with server-side clamp, injection-hardened prompts, and free-flag refilter/rescore economy.**

## Performance

- **Duration:** ~15 min
- **Tasks:** 3 (Task 1 auto, Task 2 TDD, Task 3 auto)
- **Files created:** 4 · **Files modified:** 3

## Must-Have Verification

| Must-have | Evidence |
|-----------|----------|
| Every recent open job gets a per-user `user_jobs` row; filtered rows keep a bounded reason (D-04); survivors get 0–100 score, tier, 3–5 reasons, categorized gaps from ONE nano call against the routed resume (D-06..D-09) | 0019 `user_jobs` (all pipeline + result columns) + `claim_scoring_work` seed (open jobs × users, `on conflict do nothing`); score-tick writes `status='filtered'` + `filter_reason`/`filter_detail` on filter fail, and one `generateStructured` call → clamped score + `tierFor` tier + reasons/gaps/covered persisted on pass |
| score-tick claims via `claim_scoring_work` SKIP LOCKED; never touches poll-tick | `admin.rpc('claim_scoring_work', { batch_size: 12 })`; claim RPC mirrors 0008, locks only `user_jobs` rows; poll-tick/index.ts unmodified (only read as skeleton) |
| Preference save + resume change flag recent jobs for refilter; extraction-ready reroutes owner's recent jobs (F2); re-score only when filter outcome or routed resume changed (D-04/D-10, Pitfall 6) | `savePreferences` + resume upload/delete call `rpc('mark_recent_jobs_for_refilter')`; `mark_user_jobs_for_reroute(uuid)` shipped (extract-resume already calls it, guarded); worker's rescore-economy branch keeps existing score when nothing material changed |
| cheapFilter runs BEFORE any AI call (SCOR-01) | score-tick runs `cheapFilter` and returns `'filtered'` before any `generateStructured` call |
| Scoring reads only post-dedup jobs rows (NOTF-04 precondition) | claim seeds from `public.jobs` (deduped at ingest); no `jobs` writes anywhere in score-tick |
| Files/exports exactly per plan frontmatter | 0019 migration (user_jobs, claim_scoring_work, mark_recent_jobs_for_refilter, mark_user_jobs_for_reroute, score-tick cron); routing.ts (`routeResume`, `tierFor`, `ResumeExtractInput`, `RoutingResult`); score-tick/index.ts (`claim_scoring_work`); web/tests/routing.test.ts; preferences.ts + resumes.ts refilter wiring — all present |

## Local Gate Results (exact numbers)

- `cd web && npm run build` (tsc -b + vite) — **green** (only the pre-existing >500 kB chunk advisory; not introduced here).
- `cd web && npx vitest run` — **25 files, 329 tests passed** (Plan 02 baseline was 24/322; +1 file `routing.test.ts`, +7 tests).
- `cd web && npx vitest run tests/routing.test.ts tests/filters.test.ts` — **2 files, 24 tests passed**.
- `cd web && npm run lint` (oxlint) — **green**; sole warning is the pre-existing `AuthProvider.tsx:120` (out of scope, untouched).
- Migration greps: `for update skip locked` ✓, `grant update (seen_at, dismissed_at)` ✓, `unique (user_id, job_id)` ✓, no `jobs.source` value enumeration ✓.

## Task Commits

1. **Task 1 — user_jobs schema + claim/refilter/reroute RPCs + score-tick cron** — `b0c4e49` (feat)
2. **Task 2 — routing RED fixtures** — `4642730` (test); **routing GREEN** — `3c94ebb` (feat)
3. **Task 3 — score-tick worker + refilter hooks** — `b7ae600` (feat)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `supabase.rpc` to the `resumes.test.ts` mock**
- **Found during:** Task 3 (refilter wiring)
- **Issue:** `resumes.ts` now calls `supabase.rpc('mark_recent_jobs_for_refilter')` after a successful upload/delete. The two happy-path tests mock `supabase` without an `rpc` member, so the new call would throw `supabase.rpc is not a function` and fail those tests.
- **Fix:** Added `rpc: vi.fn().mockResolvedValue({ error: null })` to the `vi.mock('./supabase')` factory (persists across `clearAllMocks`, which clears calls but not implementations). Error-path tests fail before reaching the RPC and are unaffected.
- **Files modified:** web/src/lib/resumes.test.ts
- **Verification:** full suite 329 green.
- **Commit:** `b7ae600`

### Design choices worth recording (not scope changes)

- **Claim locks only `user_jobs`.** The plan's claim step ordered "by the joined job's first_seen_at desc". A literal join under `for update skip locked` would lock `jobs` rows too and could contend with poll-tick (breaking the 02.1 isolation must-have). The claimable CTE therefore selects from `user_jobs` alone and orders by a scalar subquery on `jobs.first_seen_at`, preserving newest-first ordering (Pitfall 2) while locking only `user_jobs` — and still satisfying the literal `for update skip locked` grep.
- **`no_resume_extract` is thrown, not written as a distinct terminal state.** Matches the plan's "retries via attempts" intent; F2 reroute re-flags the row when extraction lands (per Codex disposition, distinct waiting states are DEFERRED).

**Total deviations:** 1 auto-fixed (blocking-textual, test mock). **Impact:** no scope change; the design choices strengthen the 02.1-isolation must-have.

## Gemini → OpenAI Discrepancy Note

RESEARCH.md "Pattern 1" and the architecture diagram still show Gemini `generateContent` + `responseSchema` + `GEMINI_API_KEY`, explicitly flagged **superseded** by the 2026-07-19 provider revision (D-11..D-13). Implemented against the existing `generateStructured` OpenAI Responses wrapper (`OPENAI_SCORING_MODEL` = `gpt-5.4-nano`, strict `text.format` json_schema, `store:false`). No Gemini endpoint, `responseSchema` field name, or `GEMINI_*` env was introduced.

## Safety Boundary Compliance

- Migration written as a **FILE ONLY** at the pinned path `0019_user_jobs_scoring.sql` (exact number 0019, no OFFSET); no hosted push, no `supabase db push`, no edge deploy, no paid/external OpenAI call. The nano scoring call runs only at hosted runtime (Plan 07).
- Did not modify `poll-tick/index.ts`, `_shared/lifecycle.ts`, `_shared/connectors.ts`, `_shared/adapters/*`, or migrations 0012–0016 (copied skeleton/patterns, never edited). No `jobs.source` value enumerated anywhere.
- Preserved first-sight job identity: score-tick performs zero writes to `jobs`; the refilter/reroute RPCs only raise the `needs_refilter` flag on `user_jobs`, never mutating job identity or dedup rows.
- Left `.DS_Store`, `scripts/agent-dashboard.mjs`, `scripts/agent-dashboard.test.mjs` untracked/unstaged; did not edit `STATE.md`.
- ASVS V7 / T-3-12: score-tick logs only bounded codes, row UUIDs, and counters; resume/JD/prompt/response text never logged; `ai_usage` stores token counts only.

## Known Stubs

- **D-13 Pro-rescore valve** — `PRO_RESCORE_ENABLED` is read and gated to a no-op branch by design (config-only this phase; no Pro model call built). Documented in CONTEXT D-13 and the code comment; resolves only on eval-backed operator decision, not a bug.

No unintended data stubs: filtered/scored/failed rows all carry real per-user pipeline data.

## Issues Encountered

None. RED confirmed before implementation; local gate green on first full run.

## Next Phase Readiness

- **Ready for feed/detail plans:** `user_jobs` exposes score/tier/reasons/gaps/covered/routed_resume_id + seen/dismiss columns with own-row RLS; the SCOR-05 gap payload is persisted for the Plan 04 job-detail panel.
- **Plan 07 owes (deferred hosted proof):** push 0019, deploy `score-tick`, set the score-tick edge secrets, and prove hosted claim isolation, one-call-per-survivor scoring, column-grant enforcement (users cannot alter scores), and cross-user RLS denial. Coverage R2–R5 are `human_judgment: true` precisely because their runtime behavior is observable only on the hosted edge runtime.

## Self-Check: PASSED

All 4 created artifacts exist on disk (0019 migration, routing.ts, score-tick/index.ts, routing.test.ts) plus the two modified web libs and the test mock; all four task commits (`b0c4e49`, `4642730`, `3c94ebb`, `b7ae600`) present in git log.

---
*Phase: 03-scoring-feed-notifications*
*Completed: 2026-07-19*

---
status: awaiting_human_verify
trigger: 'Phase 03 UAT Check 4: saved four target titles, waited more than 20 minutes, and the focused Dashboard still showed no matches.'
created: 2026-07-20T18:03:42Z
updated: 2026-07-20T18:44:58Z
---

## Current Focus

hypothesis: CONFIRMED SECONDARY CAUSE — after the cap fix recovered valid rows, listFeed still limited an arbitrarily ordered parent user_jobs slice because referencedTable ordering sorts only the embedded jobs object; the pending backlog therefore excluded every focused candidate before browser filtering.
test: Frontend patch 80d772e is live and its focused server query returns the affected account's valid candidates; human verification must confirm the production Dashboard renders them after refresh.
expecting: The focused Dashboard shows at least the currently valid Greenhouse matches marked Updating while the paid cap remains exhausted; more newly scored matches can arrive after UTC rollover.
next_action: Ask the user to hard-refresh the Dashboard and confirm jobs are visible; do not archive this session as resolved without that browser confirmation.

reasoning_checkpoint:
  hypothesis: "The pre-claim global AI_DAILY_SCORE_CAP guard causes the zero feed: saving preferences flags all open user_jobs as needs_refilter, focused mode hides every flagged row, and once daily usage is 200 score-tick exits before claim_scoring_work can clear any flag."
  confirming_evidence:
    - "Affected user has the exact four persisted titles, 1,487 needs_refilter rows, 21 stored scores >=50, focusedEligible=0, and no current/stale claims."
    - "Global score usage today is exactly 200, latest usage predates the preference save, and each subsequent scheduled score-tick response is skipped=ai_budget_cap_reached."
    - "cron.job has one active score-tick-every-minute job and cron.job_run_details shows successful minute dispatches, ruling out a stopped scheduler."
  falsification_test: "An inactive/missing cron, post-save score usage growth, non-cap score-tick responses, or resolved needs_refilter rows would disprove the cap-before-claim mechanism; none was observed."
  fix_rationale: "A fix must prevent budget exhaustion from turning a preference save into indefinite total feed suppression—by changing invalidation/visibility and/or ensuring free filtering/current-score preservation can progress independently of paid-score capacity."
  blind_spots: "The production AI_DAILY_SCORE_CAP environment value was not read directly; exact usage=200 plus repeated ai_budget_cap_reached responses establishes the effective cap. No next-day rollover behavior was observed."

## Symptoms

expected: After saving target titles, eligible jobs should be refiltered and scored within minutes; enough current scored jobs should appear in the focused Dashboard to review a 20-job quality sample.
actual: The user initially saw only three scored jobs. After adding Data Engineer, Data Analyst, and Data Scientist alongside Equity Research, saving, waiting more than 20 minutes, and refreshing, the focused Dashboard showed “No matches yet.”
errors: No visible runtime error. The Dashboard empty state says postings are scored within minutes and asks the user to set preferences even though four persisted title chips are visible.
reproduction: In production, save target titles data engineer, equity research, data analyst, and data scientist; wait more than 20 minutes; refresh the default focused Dashboard.
started: Observed during Phase 03 Plan 11 UAT Check 4 on 2026-07-20 after the exact-release paid verifier passed.

## User Evidence

- exact_observation: 'more than 20 min, still no match in dashboard'
- dashboard_screenshot: '/var/folders/fj/pxz8d_45589622lsp3n_9t4h0000gn/T/TemporaryItems/NSIRD_screencaptureui_SawA47/Screenshot 2026-07-20 at 12.59.19 PM.png'
- preferences_screenshot: '/var/folders/fj/pxz8d_45589622lsp3n_9t4h0000gn/T/TemporaryItems/NSIRD_screencaptureui_T2VogV/Screenshot 2026-07-20 at 12.59.26 PM.png'
- saved_titles: [data engineer, equity research, data analyst, data scientist]

## Release Binding

- git_sha: c15ad867f5714862192c8e95099e755d90963566
- migration_head: 0025
- score_tick_version: 3
- score_tick_deployment: ae6c147f-c3a8-417e-8057-d4105ac9aed5
- cloudflare_deployment: 2b3cb77f-9043-4fc8-b9dc-b57e1565ceed
- asset: /assets/index-BxwGvdK2.js
- asset_sha256: b29c1297c2945749aa4b2ed891567ca352ee643947126db3cfed867f815175af
- paid_proof: passed after remediation; exact restoration and zero residue recorded in 03-11-PAID-PROOF.md

## Post-fix Production Release

- git_sha: 08335867e78ce203c36d916bf9715b3e1beef0c6
- migration_head: 0027
- score_tick_version: 4
- score_tick_sha256: 610b107eb5c7ceded1f809105e693c1e5527659de40987928537257666fe4c3b
- verify_board_version: 12
- verify_board_sha256: db3635d96e0436c1170009bc5afbb11cff1296da8b16a0dfd56c5d06ae87c2ec
- cloudflare_deployment: eec67d2a-a61e-4afe-83c8-630fcf3592da
- cloudflare_check_run: 88439868484
- asset: /assets/index-BabHf86W.js
- asset_sha256: 2b2caf61110d82837f7a3ca585b85c39b4f6fd73e686dd8be416ab883a94347d
- paid_verifier: not_run
- feed_patch_sha: 80d772e1fa1cac01a4f91891537b21f437e56852
- feed_patch_cloudflare_deployment: 28a3d420-d804-487a-a52d-72d4b867787c
- feed_patch_cloudflare_check_run: 88442190125
- feed_patch_asset: /assets/index-CTtXNGMU.js

## Eliminated

- hypothesis: The score cron remained inactive or stopped dispatching after verifier maintenance.
  evidence: Production cron.job shows one active * * * * * score-tick job, and recent cron.job_run_details entries succeeded every minute.
  timestamp: 2026-07-20T18:13:00Z

- hypothesis: The focused feed is empty because all current rows legitimately filtered, scored Weak, lacked company identity, exhausted retries, or were stuck in claims.
  evidence: The affected user has 21 stored scores >=50, but all are hidden within 1,487 needs_refilter rows; attempts>=5 and fresh/stale claim counts are zero. Company identity is therefore not sufficient to explain total disappearance.
  timestamp: 2026-07-20T18:13:00Z

## Evidence

- timestamp: 2026-07-20T18:03:42Z
  checked: Phase 03 UAT Check 4 user observation and screenshots
  found: Four target-title chips persist, but the default focused Dashboard remains empty after more than 20 minutes.
  implication: Preference persistence alone is working; the failure remains somewhere after persistence or in the current focused-feed eligibility path.

- timestamp: 2026-07-20T18:13:00Z
  checked: Project-defined skills and debug knowledge base
  found: Neither .codex/skills nor .agents/skills contains a project SKILL.md, and .planning/debug/knowledge-base.md does not exist.
  implication: There are no project-specific debugging rules or prior resolved pattern matches to prioritize; the pipeline must be traced directly.

- timestamp: 2026-07-20T18:15:00Z
  checked: Repository inventory and symbol/text search
  found: The relevant path is web/src/lib/preferences.ts and Preferences.tsx -> SQL refilter functions in migrations 0022/0025 -> claim_scoring_work in migration 0025 -> supabase/functions/score-tick/index.ts -> web/src/lib/feed.ts and Dashboard.tsx. Focused-feed tests explicitly hide needs_refilter rows.
  implication: The symptom can be localized by comparing the exact row-state transition contract across these producer/consumer boundaries.

- timestamp: 2026-07-20T18:20:00Z
  checked: Preference save, refilter migration, claim function, score worker, and associated tests
  found: A successful save upserts preferences then calls mark_recent_jobs_for_refilter; migration 0025 flags every existing open user_job, increments its desired revision, and resets retries. defaultVisible deliberately hides needs_refilter rows. score-tick clears the flag only after filtering, unchanged-hash reuse, successful scoring, or a recorded failure; it returns before claiming anything when the global daily AI usage count is at the configured cap.
  implication: The immediate disappearance is designed freshness behavior. Persistent emptiness requires non-convergence or all rows resolving filtered/weak, with global budget-cap return being one concrete branch that would leave every flagged row hidden.

- timestamp: 2026-07-20T18:24:00Z
  checked: Complete feed and Dashboard implementations
  found: Dashboard polls listFeed every 60 seconds and computes focused rows solely with defaultVisible. listFeed reads the newest 200 user_jobs by embedded posted_at but first removes every row lacking either normalized or source-provided company identity; focused mode then requires status=scored, score>=50, needs_refilter=false, not dismissed, and open job status.
  implication: React query invalidation is not the persistent cause after 20 minutes. Production row-state counts and the 200-row/company projection boundaries are required to distinguish worker non-convergence from legitimate client filtering.

- timestamp: 2026-07-20T18:29:00Z
  checked: Scheduler/release artifact search, environment-file presence, and git status
  found: The repository contains scripts/.env and web/.env.local plus production verifier code capable of Supabase administration; phase artifacts state the paid verifier restored the score cron exactly. Unrelated worktree changes exist in .DS_Store, .planning/HANDOFF.json, and agent-dashboard files.
  implication: Read-only production state is likely accessible locally, and unrelated workspace changes must remain untouched. The previously restored cron makes a scheduler-configuration hypothesis less likely but does not prove subsequent invocations or row convergence.

- timestamp: 2026-07-20T18:31:00Z
  checked: Environment key names and phase evidence file locations
  found: scripts/.env contains SUPABASE_URL, SUPABASE_SECRET_KEY, configured USER1_EMAIL/USER2_EMAIL, database credentials, and access token; the Phase 03 UAT and exact paid proof are present.
  implication: A production-safe, read-only, user-scoped Supabase query is possible after the affected account is mapped from artifacts.

- timestamp: 2026-07-20T18:36:00Z
  checked: Phase 03 UAT and exact paid-verifier proof
  found: UAT confirms the zero-focused-match observation followed an earlier state with only three scores and a save of four titles. The paid proof recorded 2,992 restored user_jobs and 229 global purpose=score usage rows by 2026-07-20T17:02:31Z, with the score cron active and exactly restored.
  implication: The production dataset is large enough for backlog/projection effects. The default 200 cap cannot be assumed because the verifier successfully made the 229th score call, but current usage and per-user row states can directly discriminate cap/backlog/non-convergence from legitimate zero matches.

- timestamp: 2026-07-20T18:40:00Z
  checked: First read-only production aggregate attempt
  found: The query made no state change and failed before authentication because sandbox DNS could not resolve the Supabase host (ENOTFOUND).
  implication: This is an environment restriction, not application evidence; the same read-only query requires network permission.

- timestamp: 2026-07-20T18:11:00Z
  checked: Read-only production aggregate snapshot for configured accounts and today's score usage
  found: user1 is the affected account: its exact four titles are persisted, 1,487 of 1,497 user_jobs have needs_refilter=true, 21 stored scores are >=50 but focusedEligible is zero because the freshness flag hides them, and there are no active/stale claims or retry-exhausted rows. Global purpose=score usage today is exactly 200; the latest score usage was 2026-07-20T17:54:03Z, before the preference update at 18:07:09Z. user2 has no preferences and all 1,497 rows failed no_resume_extract, but that does not explain user1.
  implication: Legitimate all-filtered/all-weak output, company projection, retry exhaustion, and active claim contention are refuted for user1. The leading cause is the score worker's pre-claim global daily cap, which can freeze every refilter flag after usage reaches 200.

- timestamp: 2026-07-20T18:15:00Z
  checked: Existing production verifier Management SQL helper
  found: scripts/verify-scoring-freshness.ts provides a proven access-token Management SQL pattern and a read-only cron inventory query; no worker invocation is required to inspect cron.job, cron.job_run_details, or stored pg_net HTTP responses.
  implication: The cap hypothesis can be falsified or confirmed using scheduler-generated evidence only, within the read-only scope guard.

- timestamp: 2026-07-20T18:13:00Z
  checked: Current score cron metadata, recent cron run history, and stored scheduler HTTP responses
  found: score-tick-every-minute is active on * * * * *; each recent cron dispatch succeeded. Stored score-tick responses from 18:02 through 18:11 UTC repeatedly returned HTTP 200 with {"skipped":"ai_budget_cap_reached"}, including immediately after the preference update, while no new score usage appeared after 17:54 UTC.
  implication: The worker is healthy enough to receive scheduled requests but intentionally exits at the budget guard before claim_scoring_work. This directly causes the affected user's 1,487 refilter flags—and therefore zero focused matches—to persist.

- timestamp: 2026-07-20T18:22:03Z
  checked: Complete local score worker, claim migration, feed visibility, Dashboard rendering, and existing scoring/feed regression tests
  found: The worker counts ai_usage and returns before claim_scoring_work; processRow otherwise performs cheapFilter and exact-hash reuse before generateStructured. claim_scoring_work has no paid-deferred state, so simply releasing capped rows would repeatedly reclaim the newest paid rows and could starve free work. defaultVisible explicitly rejects every needs_refilter row and Dashboard has no stale/updating indicator.
  implication: The minimal complete fix is a new migration-backed serialized request reservation plus UTC-day paid deferral, a per-row reservation immediately before generateStructured, and focused visibility/rendering that preserves old scored matches while truthfully marking them updating. Pending unscored rows stay hidden.

- timestamp: 2026-07-20T18:23:13Z
  checked: New exact-cap focused-feed and worker/migration regression tests against the unmodified implementation
  found: Four assertions failed on the intended pre-fix boundaries: stale scored needs_refilter rows were hidden in both unit and integration coverage, reserve_score_request was absent after reuse, and migration 0027 did not exist. The other 29 targeted assertions passed.
  implication: The regression suite reproduces the empty-feed mechanism at daily usage=200 and isolates the required behavior change before implementation.

- timestamp: 2026-07-20T18:25:41Z
  checked: Targeted post-fix regression suite for feed freshness, exact-cap preference-save behavior, worker ordering, and migration reservation/defer contracts
  found: All 33 targeted assertions pass. At usage=cap=200 a previously scored eligible stale row remains focused-visible with Updating, a newly eligible pending row remains hidden, free filter/hash-reuse precede reservation, and SQL coverage requires serialized reconciliation plus UTC deferral.
  implication: The local implementation addresses the reproduced mechanism; broader regression and static/type verification remain before handoff.

- timestamp: 2026-07-20T18:28:08Z
  checked: Full local verification and scoped diff review
  found: All 402 tests across 32 files pass; oxlint exits 0 with one unrelated existing AuthProvider fast-refresh warning; tsc plus Vite production build succeeds; git diff --check succeeds. The claim query prioritizes prior >=50 scored rows, paid-deferred rows are excluded until UTC rollover, preference/reroute changes clear deferral, and the reservation ledger admits at most the configured count under concurrent ticks. No production, verifier, paid, fixture, latch, deployment, or push action was run.
  implication: The fix is locally verified and regression-protected. Human production-like workflow confirmation remains intentionally outstanding.

- timestamp: 2026-07-20T18:30:00Z
  checked: Scoped local implementation commit
  found: Commit 2876c74 records only the migration, score worker, feed/UI, and regression-test changes. Existing .DS_Store, .planning/HANDOFF.json deletion, and agent-dashboard files remain outside the commit.
  implication: The implementation is captured atomically without modifying unrelated worktree state or passed exact-release evidence.

- timestamp: 2026-07-20T18:36:42Z
  checked: Approved production rollout and read-only post-release state
  found: Production migrations 0026 and 0027 are applied; score-tick v4 and verify-board v12 are ACTIVE with their intended JWT boundaries; score-tick-every-minute remains active; origin/main and Cloudflare are bound to exact SHA 08335867e78ce203c36d916bf9715b3e1beef0c6; the immutable deployment and production alias serve the same asset and SHA-256. The score-request ledger remains at 200, proving no new paid score request was used. The affected account already has 11 undismissed open focused matches after free processing, including 10 Adzuna and 1 Greenhouse result. Production also exposes resumes.display_name, and the deployed verify-board bundle contains Greenhouse EU host support.
  implication: The backend root cause is fixed and production data is recovering without paid work. Only the user's refreshed-browser confirmation remains before resolving and archiving the debug session.

- timestamp: 2026-07-20T18:44:58Z
  checked: Failed human verification screenshot, exact RLS-scoped production feed query, corrected query probe, regression suite, and frontend patch rollout
  found: The refreshed Dashboard still rendered zero rows although Greenhouse EU and resume upload were confirmed fixed. The exact old listFeed query returned 200 rows spanning 2026-07-20 to 2026-05-20 with zero scored >=50 rows because `.order('posted_at', { foreignTable: 'jobs' })` ordered only the embedded relation, not parent user_jobs. Even corrected parent ordering allowed the pending backlog to fill the newest 200 before focused filtering. A separate server-filtered status=scored/score>=50 query returned the affected account's six deferred candidates, three of which currently have truthful company identity and open/undismissed jobs. Patch 80d772e merges those bounded focused candidates with the newest diagnostic window, passed 403/403 tests, lint, build, and diff check, and Cloudflare successfully deployed matching asset /assets/index-CTtXNGMU.js to both immutable and production URLs.
  implication: The secondary feed-query cause is fixed in production. A final hard-refresh confirmation is required before resolving the GSD debug session.

## Resolution

root_cause: Two defects composed. Saving preferences marked every open row needs_refilter=true while the global score worker's pre-claim 200-call guard prevented all free refilter work, hiding prior scores. After that was fixed, listFeed still limited an arbitrarily ordered 200-parent-row slice: referencedTable ordering sorted only embedded jobs, and the large pending backlog excluded all valid focused candidates before browser filtering.
fix: Added migration 0027 with atomic paid-request reservation and UTC deferral so free filtering/reuse proceeds at the cap; preserved truthful deferred scores as Updating. Then changed listFeed to use PostgREST to-one parent ordering and merge a bounded server-filtered scored>=50 candidate query with the recent diagnostic window, preventing pending rows from crowding focused matches out.
verification: The cap fix passed 34/34 targeted and 402/402 full tests before its production rollout. The secondary feed test failed RED on the old one-query implementation, then the patch passed 23/23 targeted and 403/403 full tests, lint, TypeScript/Vite build, and diff check. Read-only production probes confirmed the corrected focused query returns six candidates and three currently renderable matches for the affected account. Patch 80d772e and matching Cloudflare asset are live; final browser confirmation remains outstanding.
files_changed:
  - supabase/migrations/0027_score_budget_after_free_work.sql
  - supabase/functions/score-tick/index.ts
  - web/src/lib/feed.ts
  - web/src/pages/Dashboard.tsx
  - web/src/lib/feed.test.ts
  - web/tests/preference-refilter-feed.integration.test.ts
  - web/tests/scoring-input.test.ts
  - web/tests/company-name-feed.integration.test.ts
  - .planning/debug/saved-titles-zero-matches.md

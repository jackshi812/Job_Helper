---
phase: quick-260727-ozt
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - supabase/migrations/0052_decouple_resume_routing.sql
  - supabase/functions/_shared/routing.ts
  - supabase/functions/_shared/deterministic-worker.ts
  - supabase/functions/extract-resume/index.ts
  - supabase/functions/route-dashboard-resumes/index.ts
  - web/tests/routing.test.ts
  - web/tests/deterministic-ranking-source.test.ts
  - web/tests/scoring-input.test.ts
  - web/tests/resume-routing-migration.test.ts
  - web/tests/resume-routing-source.test.ts
  - web/src/lib/feed.ts
  - web/src/lib/feed.test.ts
  - web/src/pages/Dashboard.tsx
  - web/src/pages/Dashboard.test.tsx
autonomous: true
requirements:
  - QUICK-OZT-01
  - QUICK-OZT-02
  - QUICK-OZT-03
  - QUICK-OZT-04
  - QUICK-OZT-05
  - QUICK-OZT-06
  - QUICK-OZT-07

must_haves:
  truths:
    - "D-01/D-02: Resume extraction remains the only AI boundary; Best Fit routing uses routeResume in ordinary Edge code and never creates, claims, stages, or finalizes a deterministic ranking run."
    - "D-03: Every user has a monotonic resume-route revision and every user_jobs row records the revision at which its Best Fit fields were last published."
    - "D-04: A request routes only the rows returned by one dashboard page, rejects more than 200 unique IDs, and leaves older pages stale until each page is loaded."
    - "D-05: Publishing a route page changes only deterministic_best_fit_resume_id, deterministic_runner_up_resume_id, resume_route_revision, and a route timestamp; deterministic eligibility, score, tier, breakdown, ranking revision, and ranking timestamps remain byte-for-byte unchanged."
    - "D-06: No ready extracts or zero keyword overlap publishes no Best Fit and no runner-up; filename order never invents a winner."
    - "D-07: The server authenticates the bearer with auth.getUser before constructing service-role authority, computes with the shared routeResume function, and publishes the whole page under one expected-revision guard."
    - "A stale or failed route refresh never hides or rewrites a job's deterministic score; the dashboard shows no stale Best Fit while the next bounded retry remains possible."
  artifacts:
    - "supabase/migrations/0052_decouple_resume_routing.sql"
    - "supabase/functions/route-dashboard-resumes/index.ts"
    - "supabase/functions/_shared/routing.ts"
    - "supabase/functions/_shared/deterministic-worker.ts"
    - "web/src/lib/feed.ts"
    - "web/src/pages/Dashboard.tsx"
  key_links:
    - "resume/resume_extract trigger -> deterministic_ranking_state.resume_route_revision -> user_jobs.resume_route_revision staleness comparison"
    - "dashboard_feed_page row IDs (maximum 200) -> route-dashboard-resumes -> routeResume -> publish_resume_route_page expected-revision transaction"
    - "publish_resume_route_page response -> page-local FeedRow patch -> Dashboard current-revision guard -> Best Fit and runner-up labels"
    - "deterministic worker/finalizer -> deterministic score fields only; resume routing columns are preserved across ranking publication"
---

<objective>
Decouple Best Fit resume routing from deterministic ranking so resume changes invalidate a cheap, page-bounded route projection without rebuilding scores.

Purpose: Resume uploads, extraction completion, and deletion should refresh only the dashboard rows a user actually loads. Ranking publication and score evidence must remain independent and stable.
Output: A forward-only revision/CAS migration, an authenticated page-routing Edge Function, a route-free deterministic worker, zero-overlap semantics, page-local frontend routing, and focused regression tests.
</objective>

<execution_context>
@/Users/jackshi/.codex/gsd-core/workflows/execute-plan.md
@/Users/jackshi/.codex/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/PROJECT.md

@supabase/functions/_shared/routing.ts
@supabase/functions/_shared/deterministic-worker.ts
@supabase/functions/extract-resume/index.ts
@supabase/functions/verify-board/index.ts
@supabase/migrations/0033_deterministic_ranking_gap_closure.sql
@supabase/migrations/0048_phase_03_10_goldman_higher.sql
@supabase/migrations/0051_resume_delete_fk_indexes.sql
@web/src/lib/feed.ts
@web/src/pages/Dashboard.tsx
@web/tests/routing.test.ts

<interfaces>
Existing shared routing contract:
- `routeResume(jobText: string, extracts: ResumeExtractInput[]): RoutingResult | null`
- `ResumeExtractInput = { resumeId: string; filename: string; keywords: string[] }`
- `RoutingResult = { resumeId: string; runnerUpResumeId: string | null; hitCounts: Record<string, number> }`

Existing dashboard contract:
- `listFeedPage(query, cursor)` requests `dashboard_feed_page` with a hard page size of 200.
- `FeedRow` carries stored deterministic score/tier/breakdown and the two deterministic resume IDs.
- `Dashboard` renders all loaded infinite-query pages and calls `listFeedPage` once per cursor page.

New database contract to create:
- `deterministic_ranking_state.resume_route_revision bigint`
- `user_jobs.resume_route_revision bigint` plus a nullable route-published timestamp
- `publish_resume_route_page(p_user_id uuid, p_expected_revision bigint, p_routes jsonb)` is service-role-only and all-or-nothing.

New Edge response contract:
- `{ route_revision: number, updated_count: number, routes: Array<{ user_job_id: string, best_fit_resume_id: string | null, runner_up_resume_id: string | null }> }`
</interfaces>
</context>

<constraints>
LOCKED DECISIONS:
- D-01: Resume keyword extraction remains the existing one-time AI boundary.
- D-02: Best Fit routing uses ordinary code and cannot initiate full deterministic score/rank work.
- D-03: Invalidation uses a per-user resume-route revision and a per-user-job route revision marker.
- D-04: Route at most one dashboard page, with the existing hard maximum of 200; older pages route only when loaded.
- D-05: Route publication preserves every deterministic score, tier, breakdown, eligibility, filter, ranking revision, and ranking timestamp field.
- D-06: Zero keyword overlap means no Best Fit and no filename-alphabetical fallback.
- D-07: Reuse routeResume behind an authenticated server boundary and publish with an expected-revision guard.

DIRTY WORKTREE:
- Preserve the user's existing changes and untracked files: `.DS_Store`, `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `.planning/phases/03.8-monitor-and-poll-the-branded-banking-companies-currently-on-/.gitkeep`, `scripts/agent-dashboard.mjs`, `scripts/agent-dashboard.test.mjs`, and `web/zh`.
- Do not rewrite deployed migrations 0033, 0048, or 0051. Migration 0052 is forward-only.
- Stage only the explicit implementation paths from this plan; never use `git add -A`, `git commit -a`, reset, checkout, clean, or stash.

BOUNDARIES:
- Add no package dependency. The route function must not import OpenAI or any provider client.
- A routing failure is not a feed failure: current scores remain visible, stale resume labels remain hidden, and the next page/refetch may retry.
</constraints>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Make routeResume honest and remove routing from deterministic ranking</name>
  <files>supabase/functions/_shared/routing.ts, supabase/functions/_shared/deterministic-worker.ts, web/tests/routing.test.ts, web/tests/deterministic-ranking-source.test.ts, web/tests/scoring-input.test.ts</files>
  <behavior>
    - A job with one or more matching keywords chooses the highest-hit resume and retains the current meaningful near-tie runner-up rule.
    - A job with ready resume extracts but zero total keyword hits returns null, regardless of filename order.
    - An empty extract list returns null.
    - The deterministic worker evaluates and stages deterministic ranking data without importing routeResume, querying resumes/resume_extracts, or invoking route-refresh maintenance.
    - Ranking work continues to pass null route arguments to the legacy staging signature until migration 0052 removes route-column publication from the finalizer.
  </behavior>
  <action>
Update `routeResume` per D-06 so it returns null when `ranked[0]` is absent or its hit count is zero. Keep normalized distinct-keyword counting, positive-overlap ordering, hit counts, and the existing positive near-tie runner-up tolerance unchanged. Remove comments that promise a filename-selected winner for all-zero overlap.

Refactor `deterministic-worker.ts` per D-01, D-02, and D-05: remove the routing import, resume/extract row types, the resume loading cache, `loadResumeExtracts`, and every `routeResume` call. Remove `enqueue_deterministic_route_refreshes` from maintenance. `processRow` should stage only the deterministic evaluation and pass null for the two legacy route parameters; migration 0052 will ensure finalization no longer copies those nulls onto `user_jobs`. Do not alter claim limits, deadline handling, deterministic evaluation inputs, failure semantics, recovery, new-job enqueue, or recency enqueue.

Replace the filename-fallback routing test with zero-overlap-null coverage, and retain positive winner/runner-up/boundary cases. Update source-contract tests to prove the worker has no route/extract capability, the extraction function remains the only OpenAI boundary, and score input remains independent of resume routing. These tests must fail against the current coupled worker before production edits.
  </action>
  <verify>
    <automated>cd web &amp;&amp; npx vitest run tests/routing.test.ts tests/deterministic-ranking-source.test.ts tests/scoring-input.test.ts</automated>
    <automated>! rg -n "routeResume|resume_extracts|enqueue_deterministic_route_refreshes" supabase/functions/_shared/deterministic-worker.ts</automated>
    <automated>rg -n "generateStructured|purpose: 'extract'" supabase/functions/extract-resume/index.ts</automated>
  </verify>
  <done>Zero overlap produces no route, while positive routing still works; deterministic ranking has no resume read/routing/route-enqueue path; focused tests pass without changing ranking behavior.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add revisioned route invalidation and authenticated guarded page publication</name>
  <files>supabase/migrations/0052_decouple_resume_routing.sql, supabase/functions/extract-resume/index.ts, supabase/functions/route-dashboard-resumes/index.ts, web/tests/resume-routing-migration.test.ts, web/tests/resume-routing-source.test.ts</files>
  <behavior>
    - Resume insert/delete and a resume_extracts transition to ready advance the owning user's resume-route revision transactionally.
    - The old route-refresh RPC names advance only the new revision, and the old route-run enqueuer returns zero without creating ranking runs/items; any pre-migration timestamp demand is cleared.
    - Existing ranking-state rows start at route revision 1 and existing user_jobs rows start stale at route revision 0; no eager route-result backfill is performed.
    - A page publish accepts 1-200 unique user-job route records, locks the owner's state, requires the expected route revision to remain current, validates user-job/resume ownership, and updates all submitted rows atomically.
    - The Edge handler validates method/body/bearer, calls auth.getUser and checks the authenticated role before constructing service authority, loads only the authenticated owner's stale requested rows and ready extracts, calls routeResume, and publishes one guarded page.
    - Revision races return a bounded retryable conflict and publish nothing; JD text, resume text, and keyword arrays are neither returned nor logged.
  </behavior>
  <action>
Create forward-only migration `0052_decouple_resume_routing.sql` per D-02 through D-05 and D-07:

1. Add `resume_route_revision bigint not null default 1 check (resume_route_revision &gt; 0)` to `deterministic_ranking_state`. Add `resume_route_revision bigint not null default 0 check (resume_route_revision &gt;= 0)` and nullable `resume_routed_at timestamptz` to `user_jobs`. Do not overwrite any existing Best Fit IDs or any deterministic ranking field.
2. Replace the existing authenticated and service-only route-request RPC bodies so they atomically increment the new per-user revision instead of setting `route_refresh_requested_at`. Replace `enqueue_deterministic_route_refreshes(integer)` with a compatibility no-op returning zero initialized/seeded counts, preserving its service-role-only grants so an old score-tick bundle cannot build a route ranking run during rollout. Clear existing timestamp requests once in the migration.
3. Replace `signal_deterministic_route_refresh_from_resume()` so resume insert/delete increments the new revision in the metadata transaction. Add a separate definer trigger on `resume_extracts` that increments only when extraction becomes `ready` with its keyword set committed. Revoke both trigger functions from public/anon/authenticated.
4. Replace `finalize_deterministic_ranking_run(uuid)` from the latest 0033 definition, retaining all locks, completeness checks, failure/retry handling, score publication, and state transitions, but omit the two resume-route columns from its `user_jobs SET` list. This guarantees future preference/new-job/recency runs preserve page routes.
5. Create service-role-only `publish_resume_route_page`. Require a JSON array of 1-200 exact-shape objects, unique UUID user-job IDs, null-or-UUID route IDs, distinct winner/runner-up IDs, rows owned by `p_user_id`, and route resumes owned by the same user with a ready extract. Lock the owner's ranking-state row and compare `p_expected_revision` before validation/update. Update only the two deterministic route ID columns, `user_jobs.resume_route_revision`, and `resume_routed_at`; reject stale revisions without partial writes.
6. Replace the latest `dashboard_feed_page` definition while preserving its 0048 Goldman age filter, keyset validation/order, lifecycle filters, RLS behavior, grants, and 200 limit. Carry ranking state's current route revision through `candidates`, and add both row/current route revisions to `row_data`. Do not add description bodies to dashboard output.

Modify `extract-resume/index.ts` per D-01 so its existing ready-row update remains the single paid AI extraction boundary, while route invalidation is owned by the new transactional ready trigger. Remove the best-effort deterministic route RPC block and update its comments; leave OpenAI model/schema, token accounting, storage safety, claim/retry, and cron authorization unchanged.

Create `route-dashboard-resumes/index.ts` as an injectable, unit-testable handler following `verify-board`'s authorization order. Accept only POST/OPTIONS and `{ user_job_ids: string[] }`; require 1-200 unique canonical UUIDs. Authenticate the bearer through a publishable-key client and require role `authenticated` before constructing a service-role client. Read the user's current route revision, select only requested own `user_jobs` rows whose marker is older, load their job title/description plus the user's ready extracts and filenames, compute each result with shared `routeResume`, and invoke `publish_resume_route_page` once using the server-read expected revision. Return only bounded IDs/revision/counts. Treat the guarded RPC's revision mismatch as HTTP 409 so the browser can retry; return 401/403/405 for their exact boundaries and bounded 400/500 codes for all other failures. Never log or return job descriptions, extracted resume text, or keywords.

Write migration tests before the SQL and handler/source tests before the Edge implementation. Assert exact grants, input cap, revision lock/CAS ordering, trigger transitions, compatibility no-op, finalizer route preservation, dashboard revision exposure, auth-before-service ordering, routeResume reuse, and absence of OpenAI/provider imports.
  </action>
  <verify>
    <automated>cd web &amp;&amp; npx vitest run tests/resume-routing-migration.test.ts tests/resume-routing-source.test.ts tests/deterministic-ranking-source.test.ts</automated>
    <automated>rg -n "resume_route_revision|publish_resume_route_page|p_limit &gt; 200" supabase/migrations/0052_decouple_resume_routing.sql</automated>
    <automated>! rg -n "generateStructured|OPENAI|enqueue_deterministic|finalize_deterministic" supabase/functions/route-dashboard-resumes/index.ts</automated>
  </verify>
  <done>The schema records monotonic per-user/per-job route revisions, old routing signals cannot create ranking work, ranking finalization preserves route fields, and the authenticated Edge handler can atomically publish no more than 200 current-revision routes.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Route each loaded dashboard page lazily without disturbing scores</name>
  <files>web/src/lib/feed.ts, web/src/lib/feed.test.ts, web/src/pages/Dashboard.tsx, web/src/pages/Dashboard.test.tsx</files>
  <behavior>
    - FeedRow exposes both its published resume-route revision and the user's current resume-route revision.
    - Each dashboard RPC result routes exactly that result page's IDs: at most 200 for listFeedPage and one for a backfill request; it never sends all merged infinite-query rows.
    - A successful route response patches only matching rows in that returned page with the two route IDs and returned revision.
    - A routing error or 409 leaves the feed page usable and all deterministic score/tier/breakdown data unchanged; periodic/page refetch can retry.
    - Dashboard renders Best Fit and runner-up only when row and current revisions match. Stale fields, no extracts, and zero overlap render the existing em dash while the score remains visible.
    - Loading an older cursor page invokes routing for that page only, satisfying lazy backfill without a corpus-wide job.
  </behavior>
  <action>
Extend `FeedRow`, list/detail select columns, and dashboard response parsing with `resume_route_revision` and `current_resume_route_revision`. Add a pure currentness helper that returns true only when both are positive integers and equal; Dashboard must use this helper before resolving either stored resume ID to a label.

Add a private page-routing helper to `feed.ts` per D-03 through D-07. After `requestDashboardFeedPage` receives one database page, invoke `route-dashboard-resumes` with only that page's unique row IDs, never the accumulated infinite-query cache. Skip empty pages and reject any internal attempt above 200. Strictly validate the Edge response: revision is a positive safe integer; route count is bounded; IDs are unique and a subset of the requested page; resume IDs are null or UUIDs. Patch only matching rows in the local page object, setting both route fields and the row route revision. Preserve every other field by object spread. If invocation or response validation fails, return the original page rather than rejecting the feed query; currentness gating prevents stale labels, and the existing 60-second refetch/load-more path retries naturally.

Keep `listFeedPage` at the existing 200 maximum and route `backfillDashboardFeedRow` through the same helper with its one-row limit. Do not route company-option results, the entire loaded cache, job-detail bodies, or rows outside the requested cursor page.

Update Dashboard to derive `bestFit` and `runnerUp` only from a current route. Keep the score/tier cell and ranking-state polling untouched. Add feed tests for the 200-ID request, one-row backfill, response patching, subset/shape rejection, failure isolation, and preservation of score/tier/breakdown object identity/values. Add Dashboard tests showing a stale non-null Best Fit is hidden while score remains rendered, and a current route renders the winner/runner-up names. Existing pagination, lifecycle, filters, optimistic mutations, and ranking-state tests must remain green.
  </action>
  <verify>
    <automated>cd web &amp;&amp; npx vitest run src/lib/feed.test.ts src/pages/Dashboard.test.tsx tests/routing.test.ts tests/resume-routing-source.test.ts</automated>
    <automated>cd web &amp;&amp; npx tsc --noEmit</automated>
    <automated>cd web &amp;&amp; npm run build</automated>
  </verify>
  <done>Every fetched dashboard page lazily receives guarded Best Fit routes, older pages wait until load, stale or failed routes display no resume label, and deterministic score/tier/breakdown remain visible and unchanged.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Browser -> route-dashboard-resumes | Untrusted bearer and up to 200 caller-selected user-job IDs enter the Edge boundary. |
| Edge auth -> service client | Privileged database authority may be constructed only after Supabase verifies a real authenticated user. |
| Resume/job data -> routeResume | Private resume keywords and job descriptions are read for local computation and must not leave the server or logs. |
| Edge -> publish_resume_route_page | Computed route IDs cross into an all-or-nothing service-role SQL mutation guarded by owner and revision. |
| Ranking finalizer -> user_jobs | Full deterministic ranking publication shares the row but must not overwrite independent route fields. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-OZT-01 | Spoofing | Edge bearer authentication | high | mitigate | Task 2 validates the bearer with `auth.getUser`, requires the authenticated role, and constructs the service client only afterward; source tests pin this ordering. |
| T-OZT-02 | Tampering | Requested user-job/resume IDs | high | mitigate | Task 2 caps and deduplicates canonical UUIDs, scopes reads to the authenticated owner, and makes the publish RPC independently validate every user-job and ready resume owner. |
| T-OZT-03 | Tampering | Concurrent resume mutation | high | mitigate | Task 2 locks the per-user state and compares the server-read expected revision before any page update; a newer resume revision aborts the entire publish. |
| T-OZT-04 | Tampering | Deterministic score evidence | high | mitigate | The page RPC SET list contains only two route IDs, route revision, and route timestamp; the ranking finalizer omits route columns. Migration tests inspect both function bodies. |
| T-OZT-05 | Information disclosure | JD/resume routing inputs | high | mitigate | Edge responses/logs contain only bounded IDs, revision, and counts. Task 2 tests reject logging/return of description text, resume text, or keywords. |
| T-OZT-06 | Denial of service | Page routing request | medium | mitigate | Both Edge and SQL enforce at most 200 unique rows, queries are set-based, routeResume is local code, and no AI/provider/network call occurs. |
| T-OZT-07 | Repudiation | Route freshness | medium | mitigate | Per-user and per-row revisions plus `resume_routed_at` make the published input revision auditable without storing content. |
| T-OZT-08 | Information disclosure | Browser stale route rendering | medium | mitigate | The feed returns current and row revisions; Dashboard renders route labels only on equality, so invalidated resume choices are not exposed as current. |
| T-OZT-SC | Tampering | Dependency supply chain | low | accept | No npm, Deno, or database extension install is introduced; implementation reuses pinned Supabase and existing shared code. |
</threat_model>

<deployment_and_backfill>
1. Apply migration 0052 first. Its compatibility no-op immediately prevents an older deployed score-tick bundle from turning legacy route demand into a ranking run. Existing ranking results and route IDs remain stored; route IDs are merely marked stale by row revision 0 versus user revision 1.
2. Deploy `score-tick` with the modified shared deterministic worker and deploy `extract-resume` with its unchanged cron-secret/JWT settings. Deploy the new `route-dashboard-resumes` authenticated function before the frontend calls it. No new secret or dashboard configuration is required.
3. Deploy the frontend last. The first dashboard page routes at most 200 stale rows and patches that page. Each later Load more/backfill request routes only its own cursor page. Do not run `enqueue_deterministic_route_refreshes`, initialize a deterministic ranking backfill, or mass-update all user_jobs route markers.
4. Verify lazy progress with a read-only count joining `user_jobs.resume_route_revision` to `deterministic_ranking_state.resume_route_revision`: the stale count should decrease only for pages actually loaded. Snapshot deterministic score/tier/breakdown/revision before and after a routed page and prove equality while route fields/revision change.
5. Rollout order is migration -> Edge workers/functions -> frontend. If the route function fails, the deployed frontend continues showing deterministic scores and suppresses stale Best Fit labels; retrying the page is safe and idempotent.
</deployment_and_backfill>

<source_audit>
| SOURCE | ID | Feature / requirement | Task | Status | Notes |
|--------|----|-----------------------|------|--------|-------|
| GOAL | — | Decouple Best Fit routing from full reranking while preserving scores and routing only loaded dashboard rows | 1-3 | COVERED | Worker decoupling, revision/CAS server path, and page integration form the complete flow. |
| REQ | QUICK-OZT-01 | Extraction remains the one-time AI boundary | 1-2 | COVERED | Worker/Edge have no AI; extractor remains unchanged in model/accounting behavior. |
| REQ | QUICK-OZT-02 | Routing cannot initiate a score/rank rebuild | 1-2 | COVERED | Worker drops route enqueue; old enqueuer becomes a no-op. |
| REQ | QUICK-OZT-03 | Per-user and per-user-job route revisions | 2-3 | COVERED | Migration owns revision state; feed exposes currentness. |
| REQ | QUICK-OZT-04 | Maximum 200 page rows with lazy older pages | 2-3 | COVERED | Edge, SQL, and frontend independently enforce the page bound. |
| REQ | QUICK-OZT-05 | Preserve score/tier/breakdown | 1-3 | COVERED | Ranking finalizer and route publisher have disjoint SET lists; frontend patch preserves fields. |
| REQ | QUICK-OZT-06 | Zero overlap has no Best Fit | 1 | COVERED | Pure routing behavior and tests change first. |
| REQ | QUICK-OZT-07 | Reuse routeResume behind authenticated guarded bulk publish | 2 | COVERED | Auth-first Edge handler and revision-locked service RPC. |
| RESEARCH | — | No research artifact by explicit quick-task constraint | — | EXCLUDED | Existing code patterns and pinned dependencies are sufficient; no new dependency or integration is selected. |
| CONTEXT | D-01 | Existing AI extraction boundary | 1-2 | COVERED | Referenced in task actions and source tests. |
| CONTEXT | D-02 | Ordinary routing code, no ranking rebuild | 1-2 | COVERED | Referenced in worker and migration actions. |
| CONTEXT | D-03 | Revisioned invalidation | 2-3 | COVERED | Referenced in migration/feed actions. |
| CONTEXT | D-04 | Route only loaded page, maximum 200 | 2-3 | COVERED | Referenced in Edge and frontend actions. |
| CONTEXT | D-05 | Preserve deterministic evidence | 1-3 | COVERED | Referenced in finalizer, publisher, and patch actions. |
| CONTEXT | D-06 | No zero-overlap fallback | 1 | COVERED | Referenced in routeResume action/test. |
| CONTEXT | D-07 | Shared routeResume plus authenticated guarded publish | 2-3 | COVERED | Referenced in server and frontend actions. |
</source_audit>

<verification>
1. `cd web && npx vitest run tests/routing.test.ts tests/deterministic-ranking-source.test.ts tests/scoring-input.test.ts tests/resume-routing-migration.test.ts tests/resume-routing-source.test.ts src/lib/feed.test.ts src/pages/Dashboard.test.tsx`
2. `cd web && npx tsc --noEmit`
3. `cd web && npm run lint`
4. `cd web && npm run build`
5. Inspect `git diff --name-only` and confirm every pre-existing dirty path listed in constraints is preserved and no deployed migration was edited.
6. On a local/isolated Supabase stack, apply through migration 0052 and verify: zero migration errors; a resume/extract revision bump makes loaded user_jobs stale; one authenticated page call advances at most 200 row markers; score/tier/breakdown/revision snapshots are identical before/after; zero-overlap rows publish both resume IDs as NULL.
</verification>

<success_criteria>
- Resume changes advance only a resume-route revision; they cannot create ranking runs/items or alter ranking state status.
- Deterministic workers no longer read resume extracts or call routeResume, and ranking publication preserves existing route fields.
- `routeResume` returns null on zero overlap while retaining positive winner and near-tie behavior.
- The authenticated Edge function routes and publishes no more than 200 own rows under one expected-revision CAS, with no AI/provider capability and no private-content logging.
- The dashboard routes the exact database page as it loads, patches only that page, hides stale route labels, and keeps scores available if routing fails.
- Migration, source, routing, feed, Dashboard, typecheck, lint, and build checks pass.
- No unrelated dirty worktree file is modified, staged, deleted, reset, or cleaned.
</success_criteria>

<output>
Create `.planning/quick/260727-ozt-decouple-best-fit-resume-routing-from-fu/260727-ozt-SUMMARY.md` when done.
</output>

---
status: diagnosed
trigger: "Diagnose delayed job publication, slow dismissal, and prolonged disabled dashboard actions; independently verify ranking-table growth, worker resource failures, query timings, retention, frontend refresh behavior, and deployment drift before any fix."
created: 2026-07-31
updated: 2026-07-31
---

## Current Focus

hypothesis: Permanent dismissal is the initiating feedback-loop bug: deleting user_jobs leaves open dismissed jobs permanently absent, while enqueue_deterministic_new_jobs treats any absent current user_job as new work and launches another full-universe run without excluding dismissal tombstones. Full-snapshot fan-out and no retention then magnify this into resource failures, publication delay, and slow delete cascades; the client adds synchronous refresh/routing and global disable amplification.
test: Completed — current code, deployed schema/version inventory, sanitized production SQL aggregates, and 24-hour Edge/runtime logs were compared against the causal predictions.
expecting: Observed — both owners have permanent tombstone-induced false work; full snapshots continuously restart, completed history dominates a multi-gigabyte table, score-tick fails frequently, publication takes 5-8 minutes, and dismissal awaits synchronous refresh/routing while globally disabling actions.
next_action: Return the diagnosis-only root-cause report to the orchestrator; no fix, maintenance, deployment, or production mutation is authorized in this session.

## Symptoms

expected: Newly ingested jobs publish promptly; dismissing one job completes quickly; unrelated job actions remain available.
actual: Newly discovered jobs take too long to appear, dismissal feels slow, and dashboard actions stay unavailable longer than expected.
errors: Production reportedly contains score-tick WORKER_RESOURCE_LIMIT failures.
reproduction: Wait for connector ingestion and ranking publication; dismiss a dashboard job and observe the row, requests, feed refresh, and action availability.
started: Not specified.

## Eliminated

- hypothesis: The 60-second dashboard refetch interval is the primary cause of multi-minute publication delay.
  evidence: Hosted new_job runs themselves take median 340.4 seconds and p95 480.0 seconds before atomic publication; the UI interval is only a bounded post-publication delay.
  timestamp: 2026-07-31

- hypothesis: Score-tick WORKER_RESOURCE_LIMIT is caused by memory exhaustion.
  evidence: Runtime logs classify 160 shutdowns as CPUTime with about 2,006 ms average CPU and only about 34.1 MB maximum observed total memory.
  timestamp: 2026-07-31

- hypothesis: Raw seven-day-old pending/claimed rows are the current active backlog.
  evidence: Joining through the current building state isolated a live run with 5,043 completed and 25 recently claimed items; the very old rows belong to terminal/stale history.
  timestamp: 2026-07-31

- hypothesis: Undeployed migration 0062 or preserved Phase 5 changes cause the performance regression.
  evidence: Remote schema matches through 0061; 0062 changes connector scope, and both preserved stashes have no ranking/feed/dashboard implementation overlap.
  timestamp: 2026-07-31

- hypothesis: Resume-routing Edge latency alone explains slow dismissal.
  evidence: route-dashboard-resumes p50/p95 are 412/1,214 ms, max 7,521 ms. It amplifies dismissal but is normally far below the multi-minute ranking delay and cannot explain continuous new_job runs.
  timestamp: 2026-07-31

## Evidence

- timestamp: 2026-07-31
  checked: Repository and working-tree inventory
  found: Current HEAD is 5fb1cf1 on main; the only unstaged path is this debug artifact. Two read-only stashes exist, one explicitly preserving Phase 5 before this diagnosis. Relevant implementation is in Supabase poll/score functions, deterministic ranking helpers, migrations 0032-0038 and 0060, and web dashboard/feed code.
  implication: Current-code behavior can be investigated without conflating unrelated working-tree edits, while stash/deployment comparisons remain separate drift tests.

- timestamp: 2026-07-31
  checked: Project skill discovery
  found: No project-local .codex/skills or .agents/skills SKILL.md files were present.
  implication: No additional project skill rules constrain this read-only diagnosis.

- timestamp: 2026-07-31
  checked: Dashboard action-state symbol search
  found: Dashboard.tsx defines lifecycleMutationPending as dismissMutation.isPending OR markAppliedMutation.isPending, and applies that single flag to both lifecycle buttons on every rendered job row.
  implication: One in-flight dismissal or applied mutation deterministically disables unrelated actions across the dashboard until that mutation promise settles; this is a UI-level latency amplifier independent of the server-side cause.

- timestamp: 2026-07-31
  checked: Complete dismissal and feed-refresh client path
  found: dismissJob itself awaits only dismiss_job_permanently, but dismissMutation.onSuccess then awaits refillVisibleQueue. Watchlist scope performs feedQuery.refetch; all-jobs scope performs a one-row backfill. Every dashboard feed request first awaits dashboard_feed_page_v2 and then awaits route-dashboard-resumes for every returned row (up to 200 on refetch); route failures are caught only after the invocation finishes.
  implication: Perceived dismissal/pending duration equals dismissal RPC plus a synchronous feed query and synchronous resume-routing Edge request (plus network), not the dismissal RPC alone. Optimistic row removal hides the row immediately, while the global pending flag keeps all row actions disabled through the full refresh chain.

- timestamp: 2026-07-31
  checked: Dashboard publication refresh triggers
  found: Active/dismissed feed data polls every 60 seconds. Ranking state polls every 2 seconds only while its current data status is building; an observed active-revision increase triggers a dashboard-feed refetch.
  implication: Once ranking publication completes, UI visibility adds up to 60 seconds absent the revision-triggered refetch; if ranking state is not observed building or the revision signal is delayed, polling cadence is a bounded secondary delay, not an explanation for multi-minute or unbounded backlog.

- timestamp: 2026-07-31
  checked: Current score-tick execution model
  found: Each invocation has a 45,000 ms ceiling with a 1,000 ms cleanup margin, claims 25 items per batch, processes up to 25 items concurrently, and caps at 5,000 claimed items. Every item stages through its own RPC. The worker claims existing work first; orphan recovery and new-job/recency enqueue maintenance run only when the first claim is empty, and maintenance is followed by another claim. Finalization happens only after the processing loop.
  implication: Under sustained backlog, enqueue maintenance is starved until the queue drains. A worker-wide deadline abort can prevent finalization and returns HTTP 500; atomic publication therefore waits for an entire run, not merely the first ranked jobs.

- timestamp: 2026-07-31
  checked: Poll ingestion capacity path
  found: poll-tick claims at most 10 due companies per invocation, uses a bounded pool, fetches each company’s existing open/closed jobs, polls the provider, and persists new jobs in batches of 100. It records tick and success heartbeats separately.
  implication: Ingestion cadence/capacity is independently measurable via due-company state and heartbeat; inserted jobs still require a later score-tick maintenance pass and full ranking publication before dashboard visibility.

- timestamp: 2026-07-31
  checked: Current ranking SQL fan-out and publication semantics
  found: enqueue_deterministic_new_jobs selects an idle owner with any unranked open job, inserts user_jobs for every open job, then creates a new_job run and one ranking item for every open user_job for that owner. Recency runs do the same full-open-universe fan-out. finalize_deterministic_ranking_run again inserts any missing open-job items and refuses publication until all run items are completed; it then updates the full matching user_jobs projection atomically.
  implication: Ranking work is snapshot-wide rather than incremental. Repeated arrivals/recency boundaries create O(open jobs) work per run and can grow approximately quadratically as the open universe grows; a newly ingested job is unpublished until its owner’s entire snapshot completes.

- timestamp: 2026-07-31
  checked: Ranking retention and indexes in all migrations
  found: No migration deletes completed deterministic_ranking_runs/items by age or completion. Ranking items are removed only through personal-data deletion or FK cascades when a run, user_job, job, or user is deleted. Closed unapplied jobs are purged after seven days, but open-job history remains. Indexes cover claim(status, claimed_at, created_at), run(status), user_job_id, job_id, user_id, and resume FKs.
  implication: Completed open-job snapshot history grows without a retention bound. Indexes make lookups possible but do not bound storage, write amplification, vacuum/index maintenance, or the number of cascade rows deleted for one user_job.

- timestamp: 2026-07-31
  checked: Dismissal SQL and ranking FK cascade
  found: dismiss_job_permanently locks the owner-scoped user_job, inserts one compact tombstone, then deletes that user_job. deterministic_ranking_items.user_job_id has ON DELETE CASCADE; the later 0038 index supports lookup, but every historical item referencing the dismissed user_job is still physically deleted in the same RPC transaction.
  implication: Server-side dismissal duration should increase with historical ranking items per user_job. This is a direct causal bridge between unbounded snapshot history and the observed slow dismissal, before the frontend’s additional awaited feed/routing work.

- timestamp: 2026-07-31
  checked: Claim/retry failure semantics
  found: Claims increment attempts up to three, expired claimed leases are reaped after five minutes, and a staged item error marks the entire run/state failed. A retry clones every item from the failed run into another complete run. Worker-wide deadline/resource termination can occur before stageFailure, leaving claimed rows to wait for lease expiry rather than immediately failing.
  implication: Resource deaths can add at least a five-minute retry gap per abandoned claim cycle and duplicate another full run on manual retry, compounding delay and storage.

- timestamp: 2026-07-31
  checked: Hosted-access prerequisites
  found: The repository has a linked Supabase project reference, a project-local Supabase CLI, and existing local credentials including an access token, DB password, project ref, and service credential; none are exported by default. The initial CLI version probe failed solely because telemetry attempted to write outside the workspace sandbox.
  implication: Read-only hosted inspection can proceed by privately loading existing credentials with telemetry disabled or by using the authenticated management endpoint; output must be explicitly aggregated and sanitized.

- timestamp: 2026-07-31
  checked: Hosted migration and Edge Function inventory
  found: Remote migrations exactly match local 0001 through 0061; local migration 0062 is pending remotely. Active relevant deployments are poll-tick version 41, score-tick version 16, and route-dashboard-resumes version 1; all report ACTIVE, with cron workers configured without platform JWT verification and routing with JWT verification.
  implication: Database behavior through 0061, including the ranking owner-delete index, is deployed. Migration 0062 is connector-scope drift and cannot explain ranking/dismissal behavior. Function source parity still requires bundle/hash or lineage verification because ACTIVE/version metadata alone does not prove equality with the checkout.

- timestamp: 2026-07-31
  checked: First hosted exact ranking-item count probe
  found: A read-only count(*) over deterministic_ranking_items failed to return before a 30-second client timeout; the same management SQL endpoint had returned malformed-query errors promptly.
  implication: The ranking-item relation is sufficiently large or contended that even an exact whole-table count is already outside an interactive diagnostic budget. This supports, but does not quantify, the growth hypothesis; catalog estimates and indexed slices are required to avoid confounding timeout with cardinality.

- timestamp: 2026-07-31
  checked: Hosted catalog row and storage estimates
  found: deterministic_ranking_items is estimated at 6,105,052 rows and occupies 6,761,971,712 bytes total (5,184,602,112 heap plus 1,575,911,424 indexes). By comparison, hosted estimates are 10,465 user_jobs, 5,263 jobs, and 1,593 ranking runs; jobs plus user_jobs occupy about 45.7 MB total.
  implication: Ranking-item history is roughly 583 rows per current user_job and about 148 times the combined storage of jobs plus user_jobs. The relation’s multi-gigabyte size independently explains why whole-table scans are non-interactive and makes per-item RPC writes, indexes, vacuum, and cascades credible performance bottlenecks.

- timestamp: 2026-07-31
  checked: Hosted ranking table activity and analyzed status distribution
  found: pg_stat reports about 6,237,036 live and 1,201,995 dead ranking-item tuples, 15,372,413 inserts, 12,569,737 updates, and only 17,414 deletes. Analyzed frequencies are 99.57% completed, 0.233% superseded, 0.173% pending, and 0.023% claimed. Autovacuum and autoanalyze ran on 2026-07-31, so estimates are fresh.
  implication: The multi-gigabyte relation is overwhelmingly retained completed history, not merely a transient live backlog. Heavy insert/update churn plus more than a million dead tuples adds ongoing vacuum and index pressure.

- timestamp: 2026-07-31
  checked: Hosted run fan-out by kind/status
  found: From 2026-07-23 through measurement, 1,199 completed new_job runs produced 5,117,661 expected item evaluations (average 4,268, p95 4,983, max 5,101). Another 357 completed recency runs produced 1,020,293 (average 2,858, p95 3,933). Only 15 completed preference runs and 6 completed retries existed. At measurement both owners were in building new_job runs totaling 10,168 expected items, oldest state age about 6.5 minutes.
  implication: Production growth is dominated by automatic new-job snapshots repeatedly re-evaluating the entire open universe, with recency snapshots the secondary multiplier. The current delayed-publication symptom corresponds to both owner states waiting on full ~5,100-item runs.

- timestamp: 2026-07-31
  checked: Hosted completed-run end-to-end durations
  found: Completed new_job runs have median duration 340.4 seconds, p95 480.0 seconds, and max 652.9 seconds; completed recency runs have median 361.0 seconds, p95 482.1 seconds, and max 2,010.6 seconds. Preference and retry medians are 374.5 and 416.9 seconds. These durations are from run creation to atomic completion/publication.
  implication: Ranking itself contributes approximately 5.7 minutes at the median and 8 minutes at p95 before a newly ingested job can publish; UI polling can add up to another minute. This quantitatively explains delayed publication without requiring slow ingestion.

- timestamp: 2026-07-31
  checked: Hosted raw pending/claimed age and failed-run codes
  found: Raw status counts include 11,882 pending attempt-0 items and 75 claimed items whose oldest rows are about seven to eight days old; all seven failed runs carry ranking_item_failed. These ages far exceed the five-minute lease.
  implication: Many non-completed rows are stranded history belonging to terminal/stale runs rather than necessarily claimable active backlog. They demonstrate incomplete cleanup and can pollute the claim index; current-building joins must be measured separately before using them as active queue counts.

- timestamp: 2026-07-31
  checked: Hosted current-building queue separated from stranded history
  found: A subsequent indexed aggregate over the then-current building run showed 5,043 completed items and 25 attempt-1 claimed items, with the run about 7.9 minutes old and the oldest claim about 4.3 minutes old; there were no current pending rows in that snapshot.
  implication: The long raw pending/claimed ages are terminal-run residue, while a live ~5,100-item run advances in periodic worker slices and remains unpublished until the last claims finish. The measured active run age agrees with the historical 5-8 minute publication distribution.

- timestamp: 2026-07-31
  checked: Dismissal tombstone reinsertion guard versus new-job enqueue predicate
  found: Migration 0048 adds a BEFORE INSERT trigger on user_jobs that returns null when a matching user_job_dismissals tombstone exists, permanently suppressing reinsertion. The deployed enqueue_deterministic_new_jobs predicate tests for any open job lacking a current-revision user_jobs row but does not join or exclude user_job_dismissals; it then attempts to insert all open jobs and launches a full run over all successfully present rows.
  implication: For every owner with at least one dismissed job that remains provider-open, the enqueue condition is permanently true while reinsertion is permanently impossible. Each time ranking state returns idle, maintenance deterministically launches another full new_job snapshot even if no job was newly ingested. This is the initiating feedback loop behind the 1,199 repeated new_job runs.

- timestamp: 2026-07-31
  checked: Hosted tombstone-loop prerequisites and inter-run cadence
  found: Production has 51 dismissal tombstones that still reference open jobs absent from user_jobs; both ranking owners are affected, with 8 and 43 missing open dismissals. In the prior 24 hours 174 new_job runs started. For those runs, median time from the immediately preceding run completion to the next new_job start was 79.4 seconds; 88 restarted within 90 seconds and 101 within 120 seconds.
  implication: The tombstone-blind predicate is active for every owner and new_job work restarts almost immediately after prior publication, consistent with the every-minute scheduler feedback loop. This independently confirms continuous false-positive reranking rather than mere growth from genuine ingestion events.

- timestamp: 2026-07-31
  checked: Hosted 24-hour Edge invocation status and duration aggregates
  found: score-tick v16 recorded 438 HTTP 200, 834 HTTP 500 EDGE_FUNCTION_ERROR, 157 HTTP 546 WORKER_RESOURCE_LIMIT, and one 503 execution. Thus 992 of 1,430 executions were non-200 (69.4%). Successful p50/p95 were 2.09/23.73 seconds; 500 p50/p95 were 8.56/44.14 seconds; 546 p50/p95 were 32.96/41.77 seconds. route-dashboard-resumes v1 had 176 successful calls with p50 412 ms, p95 1,214 ms, max 7,521 ms. poll-tick v41 had 1,416 successful calls with p50 693 ms but p95 110.4 seconds and max 121.0 seconds.
  implication: Score-tick resource/application failure is frequent and quantitatively explains multi-invocation ranking completion. Resume routing adds subsecond-to-several-second latency to every awaited feed refresh. Poll ingestion is generally fast but has a material two-minute tail, so it contributes to worst-case discovery delay without explaining the persistent ranking feedback loop.

- timestamp: 2026-07-31
  checked: Hosted 24-hour score-tick runtime error and shutdown aggregates
  found: Sanitized function logs contain 792 distinct executions with ranking_item_failed, 40 with ranking_timeout, and 160 with CPU-limit messages. Runtime shutdown reasons include 160 CPUTime executions averaging about 2,006 ms CPU with maximum observed total memory about 34.1 MB; 1,263 executions ended EarlyDrop and 5 TerminationRequested.
  implication: WORKER_RESOURCE_LIMIT is specifically CPU exhaustion, not memory exhaustion. The high ranking_item_failed/timeout counts align with the 500s and show the perpetual snapshot workload is failing both at application/database awaits and at the Edge CPU ceiling.

- timestamp: 2026-07-31
  checked: Phase 5 stash and function deployment lineage drift
  found: Preserved Phase 5 stash paths are planning decision/reconciliation artifacts and do not overlap ingestion, ranking, migrations, feed, or dashboard code. Hosted deployments expose bundle hashes, but the repository has no matching release manifest or deterministic local bundle artifact for byte-for-byte comparison.
  implication: Phase 5 work is eliminated as a cause. Exact Edge bundle source parity remains unproven, although active versions and production behavior match the checked-out architecture and SQL semantics.

- timestamp: 2026-07-31
  checked: Final named-RPC timing attempt
  found: The read-only Management API query for cron metadata and pg_stat_statements timing returned an upstream 502 and no SQL result. A separate indexed per-user-job history aggregate also did not finish inside the 30-second diagnostic window.
  implication: DB-only latency for dismiss_job_permanently and dashboard_feed_page_v2, exact cron rows, and the exact per-user-job cascade distribution remain evidence gaps. Edge invocation volume independently demonstrates approximately minute-level poll/score scheduling, and catalog estimates bound average ranking history near 583 rows per current user_job.

## Resolution

root_cause: Permanent dismissal creates a compact tombstone and deletes user_jobs, but enqueue_deterministic_new_jobs ignores those tombstones when deciding whether an owner has unranked open jobs. The reinsertion trigger correctly suppresses the tombstoned row, so the enqueue predicate remains permanently true. Each idle owner therefore starts another full-open-universe new_job ranking run. Full-snapshot fan-out, atomic all-items-before-publication, and no completed-history retention produce millions of rows and frequent score-tick CPU/application failures. Dismissal then cascade-deletes that job's historical ranking items, after which the frontend awaits a feed RPC plus resume-routing Edge call and holds one global lifecycle pending flag across every row.
fix: not applied — diagnosis-only. Suggested direction is to make all enqueue/seed/finalize eligibility tombstone-aware and incremental, add bounded completed/terminal history retention and cleanup, decouple dismissal settlement from feed routing/refill, and scope pending state to the affected row. Any production cleanup, cron pause, migration, function deployment, or web release is approval-gated.
verification: Root cause confirmed by current SQL/TypeScript trace, remote schema through migration 0061, two affected hosted owners with 51 missing open dismissals, 79.4-second median restart after prior completion, 6.1M estimated ranking items/6.76 GB, 5-8 minute publication durations, 69.4% non-200 score-tick executions, CPUTime runtime shutdowns, and the synchronous frontend refresh/routing/global-pending chain. No post-fix verification was performed because no fix was authorized.
files_changed: [.planning/debug/job-copilot-performance.md]

## Diagnosis Report

### 1. Executive diagnosis

The primary root cause is a deterministic feedback loop between permanent dismissal and new-job detection. Dismissal deletes the heavy `user_jobs` row and retains a tombstone. The insert trigger then prevents that row from returning, but `enqueue_deterministic_new_jobs` does not consider the tombstone and forever interprets the absent row as unranked new work. Both hosted owners are affected. Every time a ranking run publishes and the owner becomes idle, the next maintenance opportunity starts another full-universe `new_job` run.

The full-universe design and missing history retention turn that loop into a capacity failure: roughly 6.1 million ranking items occupy 6.76 GB, completed history is about 99.57% of live rows, and score-tick returns non-200 for about 69.4% of executions. Newly ingested jobs wait for the complete snapshot to publish atomically. Dismissal latency is a separate downstream manifestation: deleting one user job cascades its historical ranking items, then the browser waits for a feed refill and resume-routing Edge call while disabling lifecycle actions globally.

### 2. Symptom-to-cause map and delay attribution

| Symptom/layer | Confirmed contribution | Measured bound |
|---|---|---|
| Connector polling | Usually fast, with a long provider/worker tail | poll-tick p50 0.693 s, p95 110.4 s, max 121.0 s; 1,416 successful calls/24 h |
| Ranking enqueue | Tombstone-blind false-positive work restarts after idle | Both owners affected; 51 missing open dismissals; median restart gap 79.4 s |
| Ranking execution/publication | Full ~5.1k-item snapshots; atomic publication; frequent failures | new_job p50 340.4 s, p95 480.0 s; score-tick 69.4% non-200/24 h |
| Ranking database | Multi-GB retained history and high tuple churn | ~6.1M estimated rows, 6.76 GB, 1.20M dead tuples; exact count exceeded 30 s |
| Dashboard refresh | Adds bounded delay after publication | 60 s interval; active-revision observation can refetch sooner |
| Dismissal RPC | Tombstone insert plus user_job delete and ranking-item FK cascade | Exact RPC-only latency unavailable; catalog ratio is ~583 historical rows per current user_job on average, not a per-row exact count |
| Feed database | Synchronous dashboard_feed_page_v2, possibly scanning multiple 200-row base pages for watchlist scope | Exact DB-only timing unavailable due read-only stats endpoint failure |
| Resume-routing Edge | Synchronously awaited after every feed page | p50 0.412 s, p95 1.214 s, max 7.521 s |
| Frontend mutation state | Awaits refill/routing and disables every row's lifecycle buttons | Deterministic from Dashboard.tsx/feed.ts call chain |
| Browser network | Adds one RPC round trip, one feed RPC round trip, and one Edge invocation path | Not separately isolated; real-browser trace remains a gap |

### 3. Confirmed causal chain

1. `dismiss_job_permanently` writes `user_job_dismissals` and deletes the user's `user_jobs` projection.
2. `prevent_dismissed_user_job_reinsert` returns null for future inserts of the same provider identity.
3. `enqueue_deterministic_new_jobs` sees an open job with no current `user_jobs` row because it does not exclude the dismissal tombstone.
4. It attempts reinsertion (suppressed) and creates a `new_job` run containing every remaining open user job for that owner.
5. score-tick processes items through per-item staging RPCs under an Edge CPU/deadline envelope; failures and one-minute scheduling spread a run across multiple invocations.
6. Finalization refuses publication until all live run items complete and again seeds any newly missing open jobs.
7. The owner returns idle, but the dismissed open job is still absent, so maintenance starts the next full snapshot. Production median restart is 79.4 seconds.
8. Completed runs/items are retained, causing multi-gigabyte growth and increasing DB/index/vacuum/cascade work.

This is falsifiable: if all open dismissal tombstones are excluded from enqueue eligibility in an isolated model, affected idle owners should no longer qualify absent genuine new jobs. No production mutation was used to execute that counterfactual in this diagnosis-only session.

### 4. Ingestion and publication timing

poll-tick claims up to ten companies per invocation and processes them with bounded concurrency. Last-day telemetry shows minute-scale invocation volume and all observed responses successful, but p95 execution is about 110 seconds. Provider polling can therefore add roughly two minutes in the tail.

That is not the dominant persistent delay. After ingestion, score-tick maintenance must reach an empty claim queue, enqueue a run, process the owner's full open universe, and atomically finalize it. Hosted new_job runs publish at a median 5.7 minutes and p95 8 minutes. The dashboard can then add up to 60 seconds if the active-revision refetch signal is not observed sooner.

### 5. Ranking workload and worker failure

The workload is snapshot-wide rather than incremental. At the first hosted snapshot, 1,199 completed new_job runs had generated 5,117,661 expected evaluations (average 4,268, p95 4,983, max 5,101); another run completed during the investigation. Recency added 1,020,293 expected evaluations across 357 completed runs.

score-tick claims 25 items, processes 25 concurrent per-item staging RPCs, and operates inside a 44-second work window. In the measured 24 hours it produced 438 HTTP 200, 834 HTTP 500, 157 HTTP 546, and one 503. Runtime logs identified 792 `ranking_item_failed`, 40 `ranking_timeout`, and 160 CPU-limit executions. CPUTime shutdowns averaged about 2,006 ms CPU with only about 34.1 MB maximum observed memory, eliminating memory pressure as the 546 cause.

### 6. Database growth, retention, and dismissal cascade

Hosted catalog estimates place `deterministic_ranking_items` at 6,105,052 rows and 6,761,971,712 bytes: 5.18 GB heap plus 1.58 GB indexes. Fresh statistics report about 6.24M live and 1.20M dead tuples, 15.37M inserts, 12.57M updates, and only 17.4k deletes. Completed rows are approximately 99.57% of live history.

No migration applies completion- or age-based retention to ranking runs/items. Cleanup occurs only through personal-data deletion or FK cascades when referenced data is deleted. The seven-day closed-job purge bounds closed unapplied jobs, not open-job snapshot history.

The dismissal RPC deletes one `user_jobs` row inside its transaction. Ranking items reference `user_job_id ON DELETE CASCADE`, so every historical item for that job is deleted before the RPC completes. The supporting index avoids a whole-table lookup but cannot avoid deleting matching history. The estimated global ratio is about 583 ranking items per current user job; exact p50/p95/max cascade counts were not obtained within the safe diagnostic window.

### 7. Dismissal, feed, routing, and disabled-action behavior

The row is optimistically removed before the server call finishes. After `dismiss_job_permanently` succeeds, the mutation's awaited `onSuccess` refills the visible queue. Watchlist scope performs a complete feed refetch; all-jobs scope performs a one-row backfill. `dashboard_feed_page_v2` may internally scan repeated 200-row base pages until enough source-filtered rows are accepted.

Every returned feed page then synchronously calls `route-dashboard-resumes` for all row IDs, up to 200. Errors are swallowed only after the invocation finishes, so latency is still awaited. Hosted routing is usually subsecond but reaches 7.5 seconds.

`lifecycleMutationPending` is the OR of dismiss and mark-applied pending states and is applied to both lifecycle buttons on every rendered row. One dismissal therefore disables unrelated actions across the entire dashboard until the dismissal RPC, feed refill, routing invocation, and mutation callbacks settle.

### 8. Deployment, schema, checkout, and stash drift

Remote migrations match local versions 0001-0061. Local 0062 is pending remotely and changes connector scope, not ranking/dismissal behavior. Relevant active deployments are poll-tick v41, score-tick v16, and route-dashboard-resumes v1. Hosted logs confirm those versions execute the diagnosed architectural paths.

Exact byte-for-byte function source parity is not proven because hosted bundle hashes have no matching deterministic local bundle/release manifest. This is a bounded evidence gap, not evidence of drift. Both preserved Phase 5 stashes contain no performance-path implementation overlap.

### 9. Alternatives eliminated and secondary contributors

- Dashboard polling alone is not primary: ranking publication already takes 5-8 minutes.
- Memory exhaustion is eliminated: 546 shutdowns are CPUTime with low memory use.
- Seven-day-old pending/claimed rows are stranded terminal history, not the live run; current-building joins showed recent claims.
- Migration 0062 and Phase 5 stash content are unrelated.
- Resume routing is an amplifier, not the initiating cause.
- Polling has meaningful p95 tail latency and remains a secondary contributor to worst-case discovery delay.
- The 60-second feed refetch interval and browser/network round trips are bounded post-publication/post-RPC amplifiers.

### 10. Evidence gaps and verification boundary

- Exact DB-only timing for `dismiss_job_permanently`, `dashboard_feed_page_v2`, and the underlying v0052 feed function was not recovered; the final aggregate stats call returned an upstream 502.
- Exact per-user-job cascade distribution did not complete within 30 seconds; only catalog-based average scale is reported.
- Browser network waterfall and real-user action timing were not captured because no signed-in browser workflow was available to this subagent.
- Exact cron table rows were not recovered, though 1,416 poll and 1,430 score invocations in 24 hours demonstrate approximately one-minute scheduling.
- Exact deployed Edge bundle parity is unproven as described in section 8.
- No production counterfactual, cleanup, pause, or fix verification was attempted in diagnosis-only mode.

These gaps affect layer-by-layer precision, not the root-cause finding: the tombstone loop and its production prerequisites/cadence are directly confirmed.

### 11. Approval-gated action register

No action below was performed. Each requires an explicit implementation/operations plan and human approval appropriate to its blast radius.

| Action class | Direction | Gate/reason |
|---|---|---|
| Code/SQL correctness | Make new-job eligibility, user_job seeding, and finalization consistently exclude dismissal tombstones; prove with regression tests | Migration and ranking semantics change |
| Workload shape | Rank only genuinely new/changed jobs instead of rebuilding every open job snapshot | Algorithm/data-contract change |
| Retention | Define bounded completed/terminal run/item retention and cleanup indexes/batches | Destructive production maintenance; backup and dry-run required |
| Recovery | Classify/retire stranded pending/claimed terminal-run rows | Production mutation; must preserve active-run safety |
| Operations | Consider a temporary score cron pause only inside an approved rollout/cleanup protocol | Changes production freshness and scheduler state |
| Worker | Reduce per-item RPC/CPU pressure or move set-based work into Postgres/background infrastructure | Runtime architecture and capacity change |
| Dismissal UI | Settle/enable the affected row after the dismissal RPC; make refill/routing background and row-scoped | User-visible consistency/accessibility behavior change |
| Feed/routing | Cache or invoke routing only for stale rows and avoid synchronous full-page routing on every refetch | Cross-function/frontend contract change |
| Deployment | Apply migration, deploy score/poll/routing as needed, then release web in a version/hash-bound sequence | Explicit production deploy approval required |
| Verification | Re-measure restart eligibility, table growth, 24-hour status mix, publication p50/p95, dismissal RPC/feed/Edge/browser timing, and regressions | Hosted read-only verification after approved change; real-user confirmation required |

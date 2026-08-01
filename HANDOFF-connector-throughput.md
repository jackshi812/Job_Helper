# Handoff: connector throughput and health regressions

**Date:** 2026-07-30
**Author:** Claude (worktree `/private/tmp/job-copilot-add-companies`, branch `feat/add-companies`)
**Status:** investigation complete, no fixes applied — all findings below are unpatched
**Trigger:** two user reports — "Morgan Stanley is degraded" and "only a few new jobs on the dashboard"

Every claim marked *verified* was reproduced live against the real provider through
the production adapter, or read directly out of committed migration text. Claims
marked *unverified* need database access I did not have.

---

## TL;DR

The dashboard is starved because `poll-tick` claims more work than it can finish,
and then penalizes the companies it never got to. Two Workday boards are slow
enough to consume the entire tick budget on their own. The root cause of that
slowness is that the Workday adapter fetches job details one at a time.

Separately: Bank of America returns zero jobs, Fidelity silently drops 46% of its
jobs, and the Morgan Stanley Eightfold connector has been unschedulable since
migration 0045.

Recommended order: **R1 + R2** (fix the starvation), **R4** (cheap), then **R5**,
then a decision on **R6**.

---

## How to reproduce

A read-only live probe of the ten active Workday boards, using the production
adapter and the production entry point:

```
node scripts/probe-workday-contract.mjs                # the four 03.11 candidates
node scripts/probe-workday-contract.mjs --static-only  # contract check, no network
```

`scripts/probe-workday-contract.mjs` (landed on this branch, commit `0401c8d`)
covers Workday identities only. The active-board sweep and the Eightfold probe
were throwaway scripts in scratch; both are trivially rebuilt from the notes here.

---

## Findings

### F1 — `poll-tick` claims more than it can finish *(verified)*

`poll-tick/index.ts:522` claims **10 companies per tick**. `poll-tick/index.ts:534`
runs them at **concurrency 2** with a **120 s deadline**
(`_shared/bounded-pool.ts:1-5`). Cron fires every minute (`0006_jobs_pipeline.sql:85`).

Measured wall time per board, one at a time, from a residential connection:

| board | wall | requests | outcome |
|---|---|---|---|
| Morgan Stanley | **113.9 s** | 180 | 131 jobs, complete, credible |
| Barclays | **103.4 s** | 229 | 15 jobs, complete, credible |
| BlackRock | 52.1 s | 100 | 33 jobs, complete, credible |
| Bank of America | 33.6 s | 55 | **0 jobs, `count_mismatch`** |
| Fidelity | 28.5 s | 68 | **60 of 111, `detail_cap_exceeded`** |
| State Street | 19.3 s | 29 | 547 jobs |
| Capital One | 19.0 s | 50 | 16 jobs |
| S&P Global | 4.7 s | 6 | 95 jobs |
| Morningstar | 3.7 s | 5 | 61 jobs |
| Nasdaq | 2.7 s | 4 | 50 jobs |

Serial total ≈ 381 s. At concurrency 2 the best possible makespan is ~191 s
against a 120 s deadline. Morgan Stanley alone is 95% of the window on one lane;
Barclays is 86% on the other. A tick that claims both accomplishes nearly nothing else.

**Caveat on the numbers.** The probe passed an empty `knownIds` set, which is the
worst case. In production `knownIds` comes from the database and lets the adapter
skip re-fetching details for jobs it has already seen — but only for identities
without `countryScope` (see F3). Barclays benefits and is cheaper in production
than measured. Morgan Stanley does not benefit; its 113.9 s is what it costs on
every poll, forever.

### F2 — starved companies are penalized twice *(verified)*

At the deadline the pool aborts in-flight work and throws, keeping only outcomes
that settled in time (`_shared/bounded-pool.ts:103-146`). `poll-tick` then marks
**every** unsettled company as rejected, and `bounded_pool_deadline` matches the
`/timeout|timed out|abort|deadline/i` regex at `poll-tick/index.ts:86`, so it is
recorded as error code `timeout`. That increments `consecutive_failures` and sets
`last_error_code`, which is exactly what `healthState` in `web/src/lib/watchlist.ts`
turns into **Degraded**.

Worse: `claim_due_companies` sets `next_poll_at = v_now + interval '10 minutes'`
**at claim time**, before any polling happens. So a company that was claimed,
starved, and never contacted is both marked failed and locked out for ten minutes.
This compounds every tick.

This is very likely the true cause of the "Morgan Stanley is degraded" report —
not the Eightfold breakage in F5. MS polls cleanly in isolation (131 US jobs,
complete, credible); it just cannot finish inside a shared 120 s window.

### F3 — Morgan Stanley re-downloads every job detail on every poll *(verified)*

The adapter's known-job shortcut is gated on
`knownIds.has(externalId) && !identity.countryScope && !identity.wholeSiteUsScope`
(`_shared/adapters/workday.ts:1121-1124`). Morgan Stanley has `countryScope`
(`workday-identities.ts:233`), so the shortcut never applies and all 131 details
are re-fetched every poll in perpetuity. The same is true of every other
`countryScope` identity (Capital One, Morningstar, State Street, Visa, PIMCO).

Note that MS also carries `requireDetailCountryProof`, so the country was already
proven for each job the first time it was seen.

### F4 — the Workday adapter hydrates details sequentially *(verified)*

`_shared/adapters/workday.ts:1091` is a plain `for (const posting of candidates)`
loop with an `await` per detail request. No concurrency. At ~630 ms per request,
Morgan Stanley's 180 requests come to 113.9 s almost exactly. This is the root
cause of F1 — the boards are not slow, the fetching strategy is.

The shared `runBoundedPool` helper already exists and the Eightfold adapter
already uses it at `detailConcurrency: 4`.

### F5 — the Eightfold API changed shape; the adapter cannot parse it *(verified)*

Morgan Stanley's Eightfold PCSX API migrated from flat snake_case responses to a
`{status, error, data, metadata}` envelope with camelCase fields. Live poll today
returns 0 jobs, `completeness: "unknown"`, `warnings: ["provider_schema_invalid"]`
after a single request.

Five distinct breaks, in the order the adapter hits them:

1. `validSearchEnvelope` (`adapters/eightfold.ts:238`) requires top-level `count`,
   `positions`, `query`. All moved under `data`. This fires first.
2. **The `query` echo is gone entirely.** `data.appliedFilters` is only
   `{includeRemote, includeRelocation}`. That echo was the adapter's proof the
   country filter applied server-side, and there is no query-level replacement.
   Per-row `standardizedLocations` (e.g. `"Colorado Springs, CO, US"`) is the only
   remaining evidence.
3. `parsePosition` (`adapters/eightfold.ts:193`) requires `business_area`,
   `canonicalPositionUrl`, `t_create` → now `department`, `positionUrl` (relative),
   `creationTs`/`postedTs`.
4. `normalizeDetail` (`adapters/eightfold.ts:278`) requires `job_description`,
   `apply_url` → now `data.jobDescription`, `data.publicUrl`.
5. Detail param renamed `pid` → `position_id`. Old form returns
   `422 {"messages": {"position_id": ["Missing data for required field."]}}`.

**The filter itself still works** — 957 US / 1366 unfiltered / 73 UK. This is pure
contract drift, not a data-integrity problem.

**Budget problem that survives any field renaming:** page size is now hard-capped
at 10 server-side (tested `num`, `pageSize`, `size`, `limit` at 50 — all returned
10). The identity declares `pageSize: 100`, and the adapter demands full
enumeration (`positions.length !== expectedCount` → `count_mismatch`). 957 US rows
is 96 list pages plus a detail request per eligible row, all inside
`stopSchedulingAfterMs: 120_000`. `maxPages` is 100, so 96 also nearly exhausts
the page cap. Expect `deadline_exceeded` to simply replace `provider_schema_invalid`
unless pagination and budget are reworked.

### F6 — the Eightfold connector has been unschedulable since 0045 *(verified)*

`claim_due_companies` in `0040_phase_03_8_branded_connectors.sql` allowlisted all
three branded types:

```sql
or (ats_type, source_key) in (
  ('eightfold', 'eightfold:morganstanley'),
  ('oracle_recruiting', 'oracle:jpmc:CX_1001'),
  ('goldman_higher', 'goldman_higher:roles')
)
```

`0045_phase_03_9_jpmorgan_oracle.sql` rebuilt that RPC with **only**
`oracle_recruiting`. `0048_phase_03_10_goldman_higher.sql` restored
`goldman_higher` — and never restored `eightfold`. Nothing has claimed
`eightfold:morganstanley` in the active path since 0045.

This is the same defect class as rebuilding an RPC from a stale definition and
silently dropping a later addition. **Audit the full 0045 → 0048 range for anything
else lost the same way.**

### F7 — Bank of America returns zero jobs *(verified)*

`workday:wd1:ghr:Lateral-US` — `count_mismatch` after 55 pages, 0 jobs, 33.6 s.
Not diagnosable without a dedicated probe session. Likely either provider drift
or the pagination/tombstone accounting in the list loop.

### F8 — Fidelity silently drops 46% of its jobs *(verified)*

`workday:wd1:fmr:FidelityCareers` returns `detail_cap_exceeded`, 60 of 111 US
rows, `completeness: "partial"`, `credibleForClosure: false`. That is the exact
shape of the PIMCO defect fixed earlier on this branch: no `selectiveRecentUsScope`,
so hydration inherits the adapter default `DEFAULT_RECENT_MAX_DETAILS = 60`
(`adapters/workday.ts:72`) against a 111-row population. Every poll reports
degraded and 51 jobs never reach the feed.

---

## What I could not verify

No database credentials in this worktree, so all of the following are **unverified**:

- Which Morgan Stanley company row the user is actually looking at, and its
  `last_error_code`. Both a Workday row and an Eightfold row may exist.
- Whether the deterministic ranking stage is a second, independent chokepoint.
  The dashboard only shows rows with `deterministic_eligible = true` and non-null
  revision/score/tier (`web/src/lib/feed.ts:473-477`), so a ranking failure would
  produce the identical symptom. Note the main checkout has uncommitted work on
  `deterministic-worker.ts` and a debug note named `ranking-bank-health-failures`,
  which suggests this is already known.
- Actual job counts, ingest rates, and how many companies are active in total.

Three queries settle all of it:

```sql
-- 1. Is the starvation hypothesis right? Look for widespread last_error_code = 'timeout'.
select name, ats_type, source_key, activation_state, last_success_at,
       last_polled_at, next_poll_at, consecutive_failures, last_error_code
from public.companies
order by consecutive_failures desc, last_success_at nulls first;

-- 2. Is ranking a second chokepoint?
select deterministic_eligible, deterministic_filter_code, count(*)
from public.user_jobs
where deterministic_ranked_at > now() - interval '24 hours'
group by 1, 2 order by 3 desc;

-- 3. Ranking backlog.
select count(*) from public.user_jobs where deterministic_revision is null;
```

---

## Recommendations

### R1 — parallelize Workday detail hydration *(highest impact)*

Replace the sequential loop at `_shared/adapters/workday.ts:1091` with
`runBoundedPool` at concurrency 4, matching the Eightfold adapter. Expected: Morgan
Stanley ~114 s → ~30 s, Barclays similar. This alone likely ends the starvation.

Constraints to respect: the loop's early-return paths currently abort the whole
poll on the first bad detail (`provider_schema_invalid`, `unsafe_detail_path`,
foreign country, etc.) and return the partial `jobs` array. Preserving that
fail-closed behavior under concurrency is the real work — do not let a pooled
version silently retain jobs that the sequential version would have discarded.
Ordering of the resulting `jobs` array also feeds `expectedCount === jobs.length`,
so keep it deterministic.

**This file is frozen Phase 03.8 code with terminal evidence attached.** Changing
it has release-process implications beyond the diff.

### R2 — stop penalizing companies that were never polled

Two independent bugs, both worth fixing even after R1:

- **Claim lease.** `claim_due_companies` should set a short lease
  (~2 minutes) instead of `next_poll_at = v_now + interval '10 minutes'`, with
  `poll-tick` advancing to the real interval on completion. Then a starved company
  retries on the next tick rather than in ten minutes. Needs a new forward
  migration on top of 0062 — do not edit a deployed migration.
- **Failure attribution.** `poll-tick` currently records `bounded_pool_deadline`
  as a per-company failure for companies that never started.
  `BoundedPoolDeadlineError` already carries `startedCount` and per-index
  `outcomes`, so "never attempted" is distinguishable from "attempted and timed
  out". Only the latter should increment `consecutive_failures`.

### R3 — let `countryScope` identities reuse `knownIds`

Narrower alternative to R1 if R1 is judged too invasive. Relax the shortcut at
`_shared/adapters/workday.ts:1121-1124` so an identity carrying
`requireDetailCountryProof` can skip re-hydrating a job whose country was already
proven. Think carefully about what this costs in closure credibility before
adopting it — the current gate is conservative on purpose.

### R4 — give Fidelity a selective scope *(cheap)*

Add `selectiveRecentUsScope` to `fidelityIdentity` in
`_shared/workday-identities.ts`, exactly as PIMCO was fixed in commit `fd8da92` on
this branch. Raises the hydration ceiling 60 → 199 and recovers 51 jobs per poll.
Re-probe afterwards to confirm `complete` / `credible` / zero warnings.

### R5 — investigate Bank of America

Dedicated live probe session against `workday:wd1:ghr:Lateral-US`. Start by
dumping the raw list pages and comparing `total` against accumulated
`jobPostings`, plus the tombstone dedup paths that can return `count_mismatch`.

### R6 — decide the Eightfold question before writing code

Restoring `eightfold` to `claim_due_companies` alone would only schedule a broken
adapter. This is a product decision, not a repair:

- **Retire it.** MS via Workday already yields 131 recent US jobs and works.
- **Rewrite it.** MS via Eightfold covers 957 US postings — a substantially larger
  population — but needs the envelope, four field renames, a replacement scope
  proof, and a pagination/budget rework for the 10-row page cap. That is
  phase-sized.

Either way, do the 0045 → 0048 audit from F6.

---

## Sequencing risks

- R2 touches `poll-tick/index.ts`, which has uncommitted Phase 5 changes in the
  main checkout. Land it after Phase 5 clears rather than into a dirty file.
- R2's claim-lease change needs a forward migration **after** 0062. Migration 0062
  lives on branch `feat/add-companies` and is not yet applied to the hosted
  database.
- `feat/add-companies` is based on `04b9529` and needs a rebase onto current main
  before merge.
- R1 and R4 both touch Phase 03.8 frozen files.

## Verification suggestion

The unit suite passed against a Morgan Stanley identity that cannot finish a poll,
and against a PIMCO identity that could never have promoted. Both defects live in
the interaction between identity configuration, adapter defaults, and the live
provider — invisible from any one of them alone. `scripts/probe-workday-contract.mjs`
exists to catch that class. Extending it to record wall time and request count per
board, with a ceiling, would have caught F1 before it reached production; extending
it to branded identities would have caught F5.

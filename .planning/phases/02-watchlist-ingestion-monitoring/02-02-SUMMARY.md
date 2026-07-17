---
phase: 02-watchlist-ingestion-monitoring
plan: 02
subsystem: ingestion-pipeline
tags: [supabase, postgres, pg-cron, edge-functions, greenhouse, lever, ashby, vitest]

requires:
  - phase: 02-watchlist-ingestion-monitoring
    plan: 01
    provides: Shared companies watchlist, live-verified ATS identities, health columns, and seeded Greenhouse, Lever, and Ashby boards
provides:
  - Fixture-tested Greenhouse, Lever, and Ashby adapters with normalized first-sight snapshots
  - Two-layer exact-ID and company-title-location deduplication
  - Hosted jobs and pipeline heartbeat tables with service-role-only ingestion writes
  - Per-minute Vault-authenticated poll-tick scheduling with isolated company failures and safe stale closure
affects: [02-03-aggregator-liveness, phase-3-feed, phase-3-scoring]

tech-stack:
  added: []
  patterns:
    - Pure ATS mappers wrapped by thin Deno fetch adapters
    - Database uniqueness plus normalized fingerprints as concurrent-ingestion dedup layers
    - Heartbeat-first cron execution with per-company Promise.allSettled isolation
    - Successful non-empty polls as the only path allowed to close stale jobs

key-files:
  created:
    - supabase/functions/_shared/adapters/types.ts
    - supabase/functions/_shared/adapters/greenhouse.ts
    - supabase/functions/_shared/adapters/lever.ts
    - supabase/functions/_shared/adapters/ashby.ts
    - supabase/functions/_shared/dedup.ts
    - web/tests/adapters.test.ts
    - web/tests/dedup.test.ts
    - supabase/migrations/0006_jobs_pipeline.sql
    - supabase/functions/poll-tick/index.ts
    - scripts/verify-pipeline.ts
  modified:
    - supabase/config.toml

key-decisions:
  - "Keep ATS mapping pure and fixture-testable while thin wrappers own live fetches, response validation, and Greenhouse HTML decoding."
  - "Use the database unique source/external-ID constraint as the concurrency backstop and normalized company/title/location fingerprints for repost and aggregator merges."
  - "Disable Edge JWT verification for cron calls and enforce a dedicated x-cron-secret shared only by Vault, Edge environment, and gitignored verification config."
  - "Allow stale closure only after a successful non-empty company poll; failures and implausibly empty boards never close jobs."

patterns-established:
  - "Immutable first sight: conflict updates advance last_seen_at without replacing the captured job-description snapshot."
  - "Heartbeat first: every authorized invocation advances last_tick_at before claiming work, while last_success_at advances only when a company poll succeeds."

requirements-completed: [DISC-01, DISC-03, DISC-04, DISC-05, DISC-06, PREF-04]

coverage:
  - id: D1
    description: Greenhouse, Lever, and Ashby payloads normalize to a shared job contract with correct timestamps, HTML handling, listing filters, and deterministic fingerprints.
    requirement: DISC-04
    verification:
      - kind: unit
        ref: "web/tests/adapters.test.ts and web/tests/dedup.test.ts (65-test suite passes)"
        status: pass
    human_judgment: false
  - id: D2
    description: Watched-board jobs land exactly once with complete first-sight snapshots across repeated polls and all three ATS sources.
    requirement: DISC-03
    verification:
      - kind: integration
        ref: "node --env-file=scripts/.env scripts/verify-pipeline.ts probes 1-4"
        status: pass
    human_judgment: false
  - id: D3
    description: Vault-backed pg_cron invokes the secret-gated poll-tick function every minute and advances the hosted pipeline heartbeat automatically.
    requirement: DISC-01
    verification:
      - kind: integration
        ref: "pipeline_heartbeat.last_tick_at advanced from 2026-07-17T03:44:00.667Z to 2026-07-17T03:45:00.309Z without manual invocation"
        status: pass
      - kind: integration
        ref: "node --env-file=scripts/.env scripts/verify-pipeline.ts probes 5 and 7"
        status: pass
    human_judgment: false
  - id: D4
    description: Company health updates per poll, failures remain isolated, and stale jobs can close only after a successful non-empty poll.
    requirement: DISC-05
    verification:
      - kind: integration
        ref: "node --env-file=scripts/.env scripts/verify-pipeline.ts probe 6"
        status: pass
      - kind: other
        ref: "code review of supabase/functions/poll-tick/index.ts success and failure branches"
        status: pass
    human_judgment: true
    rationale: A real ATS disappearance across the 35-minute stale window is time-dependent and remains appropriate for soak monitoring even though branch reachability and health writes are verified.

duration: 1h 17m
completed: 2026-07-17
status: complete
---

# Phase 2 Plan 2: Watched-Board Ingestion Pipeline Summary

**Per-minute Supabase ingestion with three live ATS adapters, immutable job snapshots, two-layer deduplication, safe stale closure, and an automatically advancing heartbeat**

## Performance

- **Duration:** 1h 17m (including hosted approval and Vault setup checkpoints)
- **Started:** 2026-07-17T02:29:57Z
- **Completed:** 2026-07-17T03:46:30Z
- **Tasks:** 3
- **Files modified:** 11 implementation and test files

## Accomplishments

- Added pure, fixture-tested Greenhouse, Lever, and Ashby adapters plus a deterministic company/title/location fingerprint while retaining full first-sight JD snapshots.
- Applied migration `0006` to the hosted `job-copilot` project, creating shared-read jobs and heartbeat tables, a service-role-only due-queue claim RPC, and the per-minute pg_cron schedule.
- Deployed `poll-tick` with dedicated shared-secret authorization, per-company failure isolation, exact and fuzzy deduplication, health writes, and success-only stale closure.
- Passed all eight hosted pipeline probes and observed `last_tick_at` advance automatically across consecutive cron minutes after the Vault setup.

## Task Commits

Each task was committed atomically:

1. **Task 1: ATS adapters and dedup fingerprint** - `06189ef` (test), `eca1c4a` (feat)
2. **Task 2: Jobs pipeline migration and hosted schedule** - `3552044` (feat)
3. **Task 3: poll-tick function, deployment, and hosted verification** - `8b0b9e7` (feat)

## Files Created/Modified

- `supabase/functions/_shared/adapters/types.ts` - Shared `NormalizedJob` contract.
- `supabase/functions/_shared/adapters/greenhouse.ts` - Lean list polling with new-job detail snapshots and entity-decoded HTML.
- `supabase/functions/_shared/adapters/lever.ts` - Region-aware Lever polling with epoch-millisecond timestamps and assembled descriptions.
- `supabase/functions/_shared/adapters/ashby.ts` - Listed-job filtering and normalized Ashby snapshots.
- `supabase/functions/_shared/dedup.ts` - Pure normalized company, title, and city fingerprint.
- `web/tests/adapters.test.ts` - Fixture coverage for all three live-verified ATS shapes.
- `web/tests/dedup.test.ts` - Fingerprint normalization and equivalence coverage.
- `supabase/migrations/0006_jobs_pipeline.sql` - Jobs, heartbeat, RLS, due-queue RPC, extensions, and Vault-backed cron schedule.
- `supabase/functions/poll-tick/index.ts` - Authorized scheduled polling, ingestion, dedup, health, stale closure, and heartbeat orchestration.
- `supabase/config.toml` - `poll-tick` deployment with platform JWT verification disabled in favor of the function-level shared secret.
- `scripts/verify-pipeline.ts` - Eight hosted ingestion, dedup, health, authorization, and RLS probes.

## Decisions Made

- Kept mapping logic independent of network and Deno-only imports so Vitest can validate each ATS payload contract without fetch mocks.
- Used immutable first-sight snapshots: repeat sightings update `last_seen_at`, while captured JD content remains unchanged.
- Preserved the planned `verify_jwt = false` deviation from JWT-based cron examples because this project uses non-JWT publishable/secret keys; `x-cron-secret` is mandatory before any privileged work.
- Made implausibly empty board responses failures and placed stale-close SQL exclusively after successful non-empty polling.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Made shared adapter imports deployable in Deno**
- **Found during:** Task 3 (poll-tick deployment)
- **Issue:** Extensionless local imports and the initial indirect npm specifier prevented reliable Edge Function module resolution/bundling.
- **Fix:** Added explicit `.ts` extensions to Deno-reachable adapter imports and used the audited literal `npm:he@1.2.0` import with a compatibility-safe decoder export lookup.
- **Files modified:** `supabase/functions/_shared/adapters/greenhouse.ts`, `supabase/functions/_shared/adapters/lever.ts`, `supabase/functions/_shared/adapters/ashby.ts`
- **Verification:** `poll-tick` deployed active as version 4; all 65 tests, production build, and all eight hosted probes pass.
- **Committed in:** `8b0b9e7`

---

**Total deviations:** 1 auto-fixed (1 blocking deployment compatibility issue).
**Impact on plan:** No behavioral or package-version change; the fix made the planned adapter modules valid in the deployed Deno graph.

## Issues Encountered

- Hosted schema, extensions, scheduling, secret configuration, and function deployment were intentionally paused until the user approved the exact mutation set.
- Supabase Vault rows required a Dashboard SQL action. After the user confirmed completion, automatic heartbeat advancement proved the scheduler could read both rows and authorize the function.
- The existing Vite chunk-size warning remains outside this plan and is already recorded in `deferred-items.md`.

## Authentication Gates

- The user approved migration `0006`, `pg_cron`/`pg_net`, the schedule, `CRON_SECRET`, and `poll-tick` deployment before any hosted mutation.
- The user then confirmed the `project_url` and `cron_secret` Vault rows were created without exposing either secret in chat or committed files.

## User Setup Required

Complete. See [02-USER-SETUP.md](./02-USER-SETUP.md) for the non-secret record and automatic cron verification evidence.

## Next Phase Readiness

- Plan 02-03 can ingest aggregator results into the same jobs table and merge them through the established fingerprint contract.
- The Watchlist health badges now receive real success/failure data, and the heartbeat row is ready for the dashboard banner and external dead-man monitor.
- Continue soak monitoring for a real ATS disappearance crossing the 35-minute stale window; no implementation blocker remains.

## Self-Check: PASSED

- All eleven implementation and test files exist.
- Commits `06189ef`, `eca1c4a`, `3552044`, and `8b0b9e7` exist on `main`.
- Linked project identity is `fjcsvajkkztvlrpdplwx`; remote migration listing reports `0006` and `poll-tick` is active with `verify_jwt=false`.
- All 65 tests pass, the production build succeeds, and all eight hosted pipeline probes pass.
- Without a manual invocation, hosted `last_tick_at` advanced from `03:44:00.667Z` to `03:45:00.309Z`, proving the Vault-backed minute schedule is firing.
- No goal-blocking stubs were found in the files created or modified by this plan.

---
*Phase: 02-watchlist-ingestion-monitoring*
*Completed: 2026-07-17*


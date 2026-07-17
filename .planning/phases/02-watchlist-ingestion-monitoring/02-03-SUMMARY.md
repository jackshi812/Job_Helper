---
phase: 02-watchlist-ingestion-monitoring
plan: 03
subsystem: aggregator-liveness
tags: [supabase, adzuna, pg-cron, edge-functions, heartbeat, cron-job-org, vitest]

requires:
  - phase: 02-watchlist-ingestion-monitoring
    plan: 02
    provides: Watched-board ingestion, normalized jobs, fingerprint deduplication, pipeline heartbeat storage, and Vault-authenticated cron
provides:
  - Budget-capped hourly Adzuna discovery on shared seed queries
  - Cross-source fingerprint deduplication with partial-snapshot handling
  - Secret-gated heartbeat endpoint and global stale-pipeline banner
  - External cron-job.org failure monitoring independent of Supabase
affects: [phase-3-preferences, phase-3-feed, phase-3-notifications, production-monitoring]

tech-stack:
  added: [Adzuna API, cron-job.org]
  patterns:
    - Dedicated daily request ledger with a hard cutoff before third-party API calls
    - External dead-man monitor against a secret-gated, read-only liveness endpoint
    - Aggregator rows remain partial and yield to any matching open ATS fingerprint

key-files:
  created:
    - supabase/functions/heartbeat/index.ts
    - web/src/lib/pipeline.ts
    - supabase/functions/_shared/adapters/adzuna.ts
    - web/tests/adzuna.test.ts
    - supabase/migrations/0007_discovery.sql
    - supabase/functions/discovery-sweep/index.ts
  modified:
    - supabase/config.toml
    - web/src/components/Shell.tsx
    - scripts/verify-pipeline.ts

key-decisions:
  - "Protect the public heartbeat with a dedicated query secret and expose only ok/stale status."
  - "Keep Adzuna descriptions explicitly partial, cap requests at 240 per UTC day, and let existing open ATS fingerprints win."
  - "Treat the missing cron-job.org recovery email as a user-waived verification criterion, not as a passing check."

patterns-established:
  - "Budget before fetch: persist each Adzuna request against the daily ledger before making the third-party call."
  - "Independent liveness: the external monitor checks a read-only endpoint outside the platform it monitors."

requirements-completed: [DISC-02, DISC-06]

coverage:
  - id: D1
    description: A secret-gated heartbeat reports 200 for fresh polling, 503 for stale polling, and 401 for a missing or incorrect secret while the global banner reflects the same 30-minute threshold.
    requirement: DISC-06
    verification:
      - kind: integration
        ref: "node --env-file=scripts/.env scripts/verify-pipeline.ts probe 9"
        status: pass
      - kind: other
        ref: "cd web && npm run build"
        status: pass
    human_judgment: false
  - id: D2
    description: Hourly Adzuna discovery uses the configured seed queries, stores partial snapshots, and stops before the 250-request free-tier budget.
    requirement: DISC-02
    verification:
      - kind: unit
        ref: "web/tests/adzuna.test.ts (68-test suite passes)"
        status: pass
      - kind: integration
        ref: "node --env-file=scripts/.env scripts/verify-pipeline.ts probe 10; credentialed sweep handled 200 results"
        status: pass
    human_judgment: false
  - id: D3
    description: Adzuna results do not duplicate matching open ATS jobs, and the hourly discovery plus per-minute pipeline schedules advance automatically.
    requirement: DISC-02
    verification:
      - kind: integration
        ref: "node --env-file=scripts/.env scripts/verify-pipeline.ts probes 11-12"
        status: pass
    human_judgment: false
  - id: D4
    description: cron-job.org independently reports heartbeat failure and recovery conditions by email.
    requirement: DISC-06
    verification:
      - kind: manual_procedural
        ref: "Scheduled heartbeat request without the secret returned 401 and produced a failure email"
        status: pass
      - kind: manual_procedural
        ref: "Heartbeat URL was restored and cron-job.org recorded HTTP 200 recovery; recovery email receipt"
        status: unknown
    human_judgment: true
    rationale: "Failure detection was proven, but no recovery email arrived. The user explicitly declined another failure/recovery cycle and waived only recovery-email receipt; this criterion is not recorded as passed."

duration: 1h 57m
completed: 2026-07-17
status: complete
---

# Phase 2 Plan 3: Aggregator and Pipeline Liveness Summary

**Budgeted Adzuna discovery with cross-source deduplication, a secret-gated heartbeat, a global stale banner, and independent external failure monitoring**

## Performance

- **Duration:** 1h 57m (including hosted approvals, account setup, and external-monitor verification)
- **Started:** 2026-07-17T13:48:13Z
- **Completed:** 2026-07-17T15:45:18Z
- **Tasks:** 3
- **Files modified:** 9 implementation and verification files

## Accomplishments

- Deployed a read-only heartbeat endpoint with dedicated secret authorization and connected a global one-minute-refreshed banner to the same 30-minute staleness rule.
- Applied migration `0007` and deployed an hourly, secret-gated Adzuna sweep with four shared seed queries, a persisted 240-request daily cutoff, partial snapshots, and ATS-first fingerprint deduplication.
- Extended hosted verification to 12 probes; all passed, including a credentialed sweep handling 200 Adzuna results, cross-source deduplication, and autonomous pg_cron heartbeat advancement.
- Configured cron-job.org outside Supabase; scheduled 401 failures generated a failure email, and restoring the secret URL recovered execution to HTTP 200.

## Task Commits

Each task was committed atomically:

1. **Task 1: Heartbeat endpoint and global stale-pipeline banner** - `88be22e` (feat)
2. **Task 2 RED: Adzuna adapter behavior tests** - `9ae6bc3` (test)
3. **Task 2 GREEN: Pure Adzuna adapter** - `a8f76f9` (feat)
4. **Task 2: Migration 0007 and deployed discovery sweep** - `9c7b174` (feat)
5. **Task 3: Full hosted discovery and liveness verification** - `3f837d4` (test)

## Files Created/Modified

- `supabase/functions/heartbeat/index.ts` - Secret-gated `ok`/`stale` liveness endpoint.
- `web/src/lib/pipeline.ts` - Authenticated heartbeat-row reader for the browser.
- `web/src/components/Shell.tsx` - Global stale-pipeline status banner.
- `supabase/functions/_shared/adapters/adzuna.ts` - Pure Adzuna URL builder and result mapper.
- `web/tests/adzuna.test.ts` - Adapter mapping, URL, partial-snapshot, and optional-field tests.
- `supabase/migrations/0007_discovery.sql` - Seed-query table, budget ledger, RLS, and hourly schedule.
- `supabase/functions/discovery-sweep/index.ts` - Budgeted, secret-gated discovery and deduplication pipeline.
- `supabase/config.toml` - JWT-verification configuration for heartbeat and discovery functions.
- `scripts/verify-pipeline.ts` - Hosted probes 9-12 for heartbeat, discovery, deduplication, and cron advancement.

## Decisions Made

- The heartbeat endpoint returns only `ok`, `stale`, or authorization failure and uses a dedicated secret separate from user sessions and scheduler authorization.
- Adzuna request budget is charged before each fetch so timeouts and partial failures cannot bypass the daily ledger.
- Existing open fingerprints from any source win over new Adzuna rows; Adzuna descriptions remain explicitly partial.
- The user accepted completion without proving recovery-email delivery. This is preserved as a verification waiver and warning, not as successful evidence.

## Deviations from Plan

### User-Approved Verification Waiver

**1. Recovery email receipt was waived, not passed**
- **Found during:** Task 3 external-monitor verification
- **Expected:** cron-job.org sends both a failure email and a recovery email during the intentional test cycle.
- **Observed:** Scheduled secretless requests returned HTTP 401; the failure and automatic-disable emails arrived. After the secret URL was restored and the job re-enabled, execution recovered to HTTP 200, but no recovery email arrived.
- **User decision:** The user wrote, `I don't want to do this. mark as complete and carry on`, explicitly waiving only another recovery-email receipt test.
- **Disposition:** Plan marked complete with this warning carried into phase verification. Recovery-email receipt is `unknown`, not `pass`.

---

**Total deviations:** 1 user-approved verification waiver; no implementation deviations.
**Impact on plan:** Core external failure detection is proven. Recovery execution is proven by HTTP 200, but recovery email delivery remains unverified.

## Issues Encountered

- Repeated intentional 401 runs triggered cron-job.org's automatic-disable protection. The job was restored with the correct secret URL, re-enabled, and recovered to HTTP 200.
- The recovery notification toggle was enabled, but no recovery email was received. The user declined another test cycle and accepted the documented waiver above.

## Authentication Gates

- The user created the Adzuna developer application and configured the cron-job.org account. Secrets were stored only in Supabase Edge Function secrets and gitignored `scripts/.env`; no secret values were written to planning artifacts or commits.

## Known Stubs

- `supabase/migrations/0007_discovery.sql:21` labels the four initial role/location seed rows as placeholders. This is intentional D-08 configuration: the rows are live and produced results, may be edited in SQL, and Phase 3 preferences replace them as the query source.

## User Setup Required

Complete. Adzuna credentials are configured, and cron-job.org is scheduled every 5-10 minutes with failure, recovery, and automatic-disable notifications enabled.

## Verification

- `cd web && npm test` - 68/68 tests pass.
- `cd web && npm run build` - production build passes.
- `node --env-file=scripts/.env scripts/verify-pipeline.ts` - probes 1-12 passed during hosted verification.
- Hosted credentialed Adzuna sweep handled 200 results; partial-snapshot and cross-source dedup checks passed.
- Hosted pg_cron advanced the pipeline heartbeat without manual invocation.
- External scheduled requests produced HTTP 401 failure history and a failure email; the restored job produced HTTP 200 recovery history.

## Next Phase Readiness

- Phase 2 implementation is complete and ready for phase verification and code review before Phase 3 planning.
- Carry one verification warning forward: recovery-email delivery from cron-job.org was user-waived and remains unverified.
- Phase 3 can replace seed queries with per-user preferences and consume the normalized, deduplicated job pool.

## Self-Check: PASSED

- All nine implementation and verification files exist.
- Commits `88be22e`, `9ae6bc3`, `a8f76f9`, `9c7b174`, and `3f837d4` exist.
- The 68-test suite and production build pass on the closing worktree.
- The recovery-email criterion is accurately recorded as waived/unknown rather than passed.

---
*Phase: 02-watchlist-ingestion-monitoring*
*Completed: 2026-07-17*

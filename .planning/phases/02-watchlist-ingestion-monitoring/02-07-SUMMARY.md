---
phase: 02-watchlist-ingestion-monitoring
plan: 07
subsystem: hosted-pipeline-verification
tags: [supabase, postgres, pg-cron, edge-functions, adzuna, vitest]

requires:
  - phase: 02-watchlist-ingestion-monitoring
    plan: 04-06
    provides: Lifecycle, exclusive-claim, no-work heartbeat, discovery health, and cadence gap fixes
provides:
  - Hosted migrations 0008 and 0009 with exclusive claims and discovery health
  - Deployed poll-tick, discovery-sweep, and heartbeat gap-closure behavior
  - DST-safe Chicago-local discovery cadence with weekly/monthly quota headroom
  - Passing hosted pipeline probes 1-16 and two non-destructive watchlist verification runs
affects: [phase-2-verification, phase-3-preferences, pipeline-monitoring]

tech-stack:
  added: []
  patterns:
    - Frequent lightweight UTC cron trigger with Chicago-local execution-slot gate
    - Longer-window API quota safety derived into an enforceable daily allocation

key-files:
  created: []
  modified:
    - supabase/migrations/0009_discovery_health_cadence.sql
    - supabase/functions/_shared/discovery-health.ts
    - supabase/functions/discovery-sweep/index.ts
    - web/tests/discovery-health.test.ts
    - scripts/verify-pipeline.ts

key-decisions:
  - "User goal override: every 30 minutes from 06:00 through noon America/Chicago, then every two hours otherwise."
  - "Invoke discovery every 30 minutes but admit only Chicago-local schedule slots, so daylight-saving changes cannot drift the user-selected window."
  - "Use a 75-request effective UTC-day allocation derived from 90% of the 1000/week and 2500/month defaults while retaining the 240/day hard ceiling."

patterns-established:
  - "Scheduled no-op: gated cron invocations return skipped=schedule without Adzuna calls or discovery-health changes."
  - "Hosted verification entrypoints use top-level await so the process cannot finish before late probes."

requirements-completed: [DISC-01, DISC-02, DISC-03, DISC-05, DISC-06]

coverage:
  - id: D1
    description: Hosted claims are exclusive, returned jobs reopen, and successful no-work ticks advance heartbeat health.
    requirement: DISC-01
    verification:
      - kind: integration
        ref: "scripts/verify-pipeline.ts#probes 13-15"
        status: pass
    human_judgment: false
  - id: D2
    description: Hosted discovery surfaces health and follows the accepted quota-safe Chicago-local cadence.
    requirement: DISC-02
    verification:
      - kind: integration
        ref: "scripts/verify-pipeline.ts#probe 16"
        status: pass
      - kind: unit
        ref: "web/tests/discovery-health.test.ts#Chicago discovery cadence"
        status: pass
      - kind: other
        ref: "Supabase remote migration list includes 0009 and discovery-sweep version 4 is ACTIVE"
        status: pass
    human_judgment: false
  - id: D3
    description: Watchlist verification is rerunnable without changing seed company identities or their job links.
    requirement: DISC-03
    verification:
      - kind: integration
        ref: "scripts/verify-watchlist.ts#probe 6, two consecutive hosted runs"
        status: pass
    human_judgment: false
  - id: D4
    description: Full web regression and production build remain green after hosted gap closure.
    verification:
      - kind: unit
        ref: "cd web && npx vitest run (92 tests)"
        status: pass
      - kind: other
        ref: "cd web && npm run build"
        status: pass
    human_judgment: false

duration: 21min
completed: 2026-07-17
status: complete
---

# Phase 2 Plan 7: Hosted Gap Closure Verification Summary

**Exclusive polling claims, truthful lifecycle and heartbeat behavior, surfaced discovery health, and the accepted quota-safe Chicago cadence are deployed and proven against the hosted project.**

## Performance

- **Duration:** 21 minutes
- **Started:** 2026-07-17T18:04:00Z
- **Completed:** 2026-07-17T18:25:16Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- Pushed migrations 0008 and revised 0009; the remote migration history now contains local/remote entries through 0009.
- Deployed active poll-tick version 7, discovery-sweep version 4, and heartbeat version 3 with JWT verification disabled as configured.
- Replaced the unpushed 216-request/day proposal with a DST-safe 21-sweep schedule: approximately 63 Adzuna requests/day for three queries.
- Added a 75-request effective daily allocation that reserves headroom under the 1,000/week and 2,500/month defaults while preserving the 240/day hard ceiling.
- Passed hosted pipeline probes 1-16, including exclusive claims, no-work heartbeat, close-then-return reopen, and persisted discovery health.
- Passed the non-destructive watchlist verifier twice consecutively, including unchanged seed identities and job links, plus all 92 web tests and the production build.

## User Goal-Override Sign-Off

The user's exact acceptance before any migration push or function deployment was:

> Every 30 minutes from 6 AM–12 PM Chicago, then every two hours otherwise.

This explicitly replaces the earlier universal 5-15-minute aggregator promise. Watched ATS sites retain the 5-15-minute goal; aggregator latency is up to approximately 30 minutes from 06:00 through noon Chicago and up to approximately two hours otherwise.

## Task Commits

1. **Task 1: Push migrations 0008/0009 and deploy three functions** - `8192d4c` (fix)
2. **Task 2: Hosted proof and complete asynchronous verifier** - `565f4fb` (fix)

## Files Created/Modified

- `supabase/functions/_shared/discovery-health.ts` - Chicago-local slot calculation and longer-window quota-derived effective daily limit.
- `supabase/functions/discovery-sweep/index.ts` - Scheduled slot gate, zero-request no-op behavior, and quota check before every external call.
- `supabase/migrations/0009_discovery_health_cadence.sql` - Single 30-minute Vault-backed schedule trigger with scheduled-request marker.
- `web/tests/discovery-health.test.ts` - Morning, two-hour, DST, and weekly/monthly quota headroom coverage.
- `scripts/verify-pipeline.ts` - Top-level awaited execution through all sixteen probes.
- `.planning/ROADMAP.md`, `02-06-PLAN.md`, `02-06-SUMMARY.md`, `02-07-PLAN.md` - Accepted goal override and deployment contract.

## Decisions Made

- Chicago-local slot logic lives in the function rather than fixed UTC cron windows because Chicago changes between UTC-6 and UTC-5.
- A scheduled invocation outside an admitted slot returns `skipped: schedule`, performs zero Adzuna requests, and does not alter discovery health.
- The existing UTC-day counter enforces a 75-request operational allocation: 525/week and 2,250/30 days at maximum, leaving ten-percent headroom under longer-window defaults.
- Manual secret-authorized verification calls bypass schedule gating so operators can test health without waiting for an admitted cron slot; they remain quota-counted.

## Deviations from Plan

### Approved Checkpoint Deviation

**1. [User decision] Replaced the planned 216-request/day cadence**
- **Found during:** Task 1 hosted-mutation checkpoint
- **Issue:** The proposed cadence exceeded Adzuna's weekly/monthly default limits and did not match the user's preferred cost/quota posture.
- **Decision:** Use 30-minute discovery from 06:00-noon Chicago and two-hour discovery otherwise.
- **Implementation:** Reworked migration 0009 before it was pushed, added DST-safe slot gating, and revised planning artifacts and tests.
- **Committed in:** `8192d4c`

### Auto-fixed Issues

**2. [Rule 2 - Missing Critical] Added weekly/monthly quota defense in depth**
- **Found during:** Task 1 cadence revision
- **Issue:** The original ledger enforced only a 240 daily cutoff, which could still exceed official weekly/monthly defaults.
- **Fix:** Derived a 75-request effective daily allocation from 90% of the weekly/monthly limits and checked it before every Adzuna call.
- **Verification:** Focused quota tests and the 92-test regression pass.
- **Committed in:** `8192d4c`

**3. [Rule 1 - Bug] Awaited the complete hosted verifier**
- **Found during:** Task 2 hosted proof
- **Issue:** The script's detached promise allowed non-PTY execution output to finish before probes 12-16 were captured reliably.
- **Fix:** Changed the main-module entrypoint to top-level await with explicit error handling.
- **Verification:** A PTY run printed PASS for probes 1-16 and exited 0.
- **Committed in:** `565f4fb`

---

**Total deviations:** 3 (1 approved user decision, 1 missing-critical quota defense, 1 verifier bug fix)
**Impact on plan:** The accepted cadence lowers quota use and latency expectations without weakening the hosted correctness proofs.

## Issues Encountered

- Supabase applied both migrations successfully but could not refresh its optional local Docker catalog cache because Docker Desktop was not running. Remote migration listing independently confirmed 0008 and 0009.
- The existing Vite chunk-size warning remains non-blocking and unchanged.

## Authentication Gates

None. Existing gitignored credentials and linked-project configuration worked; no secret values were logged or committed.

## Known Stubs

None.

## User Setup Required

None.

## Next Phase Readiness

- All six source-level gaps from the prior Phase 2 verification now have hosted or automated proof.
- The four previously identified rendered/browser behaviors remain appropriate for Phase 2 UAT.
- Recovery-email receipt remains user-waived and unknown; it is not recorded as passed.

## Self-Check: PASSED

- Migrations 0008 and 0009 appear in both local and remote migration history.
- poll-tick, discovery-sweep, and heartbeat are ACTIVE on the hosted project.
- Commits `8192d4c` and `565f4fb` exist on main.
- Hosted probes 1-16 passed; both watchlist verifier runs passed probe 6.
- All 92 web tests and the production build passed.
- No secret, dashboard file, or unrelated `.DS_Store` change was staged.

---
*Phase: 02-watchlist-ingestion-monitoring*
*Completed: 2026-07-17*

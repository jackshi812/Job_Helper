---
phase: 05-outreach-feasibility-gate
plan: 12
subsystem: compliance
tags: [atomic-publication, evidence-integrity, node-fs, utc-validation]

requires:
  - phase: 05-09
    provides: receipt-bound accepted decision v2 and immutable-source zero-residue v2
provides:
  - verified rollback for paired decision and residue publication
  - strict v2 source-snapshot-to-Git-surface digest equality
  - canonical UTC validation and deterministic direct finalizer clocks
affects: [05-13, 05-19, phase-05-terminal-audit]

tech-stack:
  added: []
  patterns:
    - durable same-directory staging and verified pair rollback
    - exact UTC round-trip validation
    - direct-API-only clock injection

key-files:
  created: []
  modified:
    - scripts/outreach-feasibility/decision-evidence.mjs
    - scripts/outreach-feasibility/decision-evidence.test.mjs
    - scripts/outreach-feasibility/evidence-integrity.mjs
    - scripts/outreach-feasibility/evidence-integrity.test.mjs
    - scripts/outreach-feasibility/owner-checkpoint.mjs

key-decisions:
  - "Keep the legacy two-path artifact interface, but publish it through durable staged files, exact prior-version backups, verified rollback, and hard failure with recovery backups preserved when rollback cannot be proven."
  - "Accept only the repository's existing exact UTC whole-second or three-millisecond Z forms, and reject calendar normalization, offsets, and partial precision."
  - "Expose fixed time only on direct validation/finalizer APIs; CLI execution retains the real wall clock and the unchanged seven-day rights window."

patterns-established:
  - "Recoverable pair publication: no error may return until both prior destinations have been restored and verified byte-for-byte, including original modes or prior absence."
  - "Cross-field self-consistency: a valid record self-hash cannot substitute for equality between duplicated source-snapshot and Git-surface digests."

requirements-completed: [OUTR-04, OUTR-05]

coverage:
  - id: D1
    description: Paired decision and residue publication restores exact prior bytes, modes, or absence at every named fault boundary and leaves no transaction residue on success.
    requirement: OUTR-04
    verification:
      - kind: unit
        ref: scripts/outreach-feasibility/decision-evidence.test.mjs#paired publication restores exact prior bytes and modes at every fault point
        status: pass
      - kind: unit
        ref: scripts/outreach-feasibility/decision-evidence.test.mjs#successful paired publication leaves one coherent pair and no transaction residue
        status: pass
    human_judgment: false
  - id: D2
    description: Zero-residue v2 rejects either side of both duplicated digest pairs after self-rehashing and rejects impossible or noncanonical UTC timestamps.
    requirement: OUTR-04
    verification:
      - kind: unit
        ref: scripts/outreach-feasibility/evidence-integrity.test.mjs#zero-residue v2 rejects independently rehashed source digest contradictions
        status: pass
      - kind: unit
        ref: scripts/outreach-feasibility/evidence-integrity.test.mjs#canonical UTC validation rejects normalized calendar rollovers and noncanonical syntax
        status: pass
    human_judgment: false
  - id: D3
    description: Direct finalizer validation remains deterministic beyond the committed rights window while production CLI paths keep real-clock enforcement.
    requirement: OUTR-05
    verification:
      - kind: integration
        ref: scripts/outreach-feasibility/decision-evidence.test.mjs#finalizer derives receipt-bound decision and complete residue without changing legacy input
        status: pass
      - kind: integration
        ref: env -u TAVILY_API_KEY GIT_OPTIONAL_LOCKS=0 node --test scripts/outreach-feasibility/*.test.mjs scripts/outreach-feasibility/dormant/*.test.mjs
        status: pass
    human_judgment: false

duration: 8min
completed: 2026-07-30
status: complete
---

# Phase 05 Plan 12: Recoverable Evidence Publication Summary

**Rollback-safe decision/residue publication with strict duplicated-digest equality, canonical UTC instants, and test-stable direct finalization**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-30T14:50:56Z
- **Completed:** 2026-07-30T14:59:18Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Replaced two uncoordinated publication renames with durable staging, exact prior-version backups, directory flushes, readback, verified rollback, and recovery-preserving hard failure.
- Enforced both missing zero-residue v2 snapshot-to-Git digest equalities even when a contradictory record has a valid recomputed self-hash.
- Rejected normalized impossible dates and malformed UTC precision while making direct finalizer tests independent of the live seven-day rights window.

## Task Commits

Each TDD task was committed through a failing regression followed by its fix:

1. **Task 1 RED: Paired publication fault matrix** - `9ebc29f` (test)
2. **Task 1 GREEN: Recoverable evidence pair publication** - `062bb8f` (fix)
3. **Task 2 RED: Digest, timestamp, and fixed-clock regressions** - `32169b6` (test)
4. **Task 2 GREEN: Canonical evidence integrity enforcement** - `997e99c` (fix)

## Files Created/Modified

- `scripts/outreach-feasibility/decision-evidence.mjs` - Durable paired publisher, verified rollback, named direct-test fault points, and fixed-clock finalization.
- `scripts/outreach-feasibility/decision-evidence.test.mjs` - Five-boundary failure matrix, absence/mode recovery, clean-success proof, and expired-wall-clock finalizer test.
- `scripts/outreach-feasibility/evidence-integrity.mjs` - Canonical UTC validator and both zero-residue v2 duplicated-digest equalities.
- `scripts/outreach-feasibility/evidence-integrity.test.mjs` - Independently rehashed contradiction and impossible-date regressions.
- `scripts/outreach-feasibility/owner-checkpoint.mjs` - Nested direct validation now accepts the same optional fixed clock as the finalizer.

## Decisions Made

- Preserve the required legacy decision/residue paths while treating their publication as a recoverable transaction. A failed rollback is a distinct hard error and retains recovery backups.
- Preserve the immutable rights matrix's exact whole-second UTC form alongside exact three-millisecond UTC, while rejecting offsets, rollover normalization, and partial fractional precision.
- Keep fault injection and fixed time as direct module-test capabilities only. No CLI flag, environment bypass, provider call, or production outreach effect was added.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Propagated fixed time through nested owner-checkpoint validation**

- **Found during:** Task 2 GREEN
- **Issue:** `finalizeAcceptedEvidence({ now })` still called owner-checkpoint validation that independently read the wall clock, so a direct finalizer test would expire despite the requested fixed time.
- **Fix:** Added the same optional direct-API `now` parameter to owner request/record validation and passed it through without adding a CLI or environment override.
- **Files modified:** `scripts/outreach-feasibility/owner-checkpoint.mjs`
- **Verification:** Owner-checkpoint suite passes 6/6; complete offline Phase 5 suite passes 108/108 under `TAVILY_API_KEY` unset.
- **Committed in:** `997e99c`

---

**Total deviations:** 1 auto-fixed (1 Rule 3 blocking issue)
**Impact on plan:** The additional nested validator change is required for deterministic direct finalization and does not alter production clock policy or expand outreach capability.

## Issues Encountered

The managed workspace initially denied creation of Git's index lock. The sanctioned Git permission path was used, and all four scoped commits completed normally with hooks enabled.

## Known Stubs

None. Null decision fields and empty arrays in the touched validators/tests are intentional fail-closed no-go states or parser initialization, not unwired production data.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 05-13 can unify the clean-review lifecycle on top of a rollback-safe and internally consistent evidence pair.
- Production outreach remains disabled. No provider call, representative spike, network search, evidence JSON regeneration, or production mutation occurred.
- The authoritative live `--terminal-audit` was not invoked.

## Self-Check: PASSED

- All five modified source/test files exist.
- Task commits `9ebc29f`, `062bb8f`, `32169b6`, and `997e99c` are reachable.
- Task verification passes 16/16 and 23/23; the complete offline Phase 5 suite passes 108/108.
- No tracked file deletion occurred in the Plan 05-12 commit range.

---
*Phase: 05-outreach-feasibility-gate*
*Completed: 2026-07-30*

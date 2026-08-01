---
phase: 05-outreach-feasibility-gate
plan: 17
subsystem: security
tags: [sshsig, authorization, evidence-integrity, atomic-publication, node-test]

requires:
  - phase: 05-16
    provides: owner-produced detached SSHSIG over the fresh stopped-decision request
provides:
  - authenticated schema-v3 decision and zero-residue contracts bound to raw SSHSIG proof
  - pre-effect authenticated finalization with rollback-safe stopped-pair publication
affects: [05-18, 05-19, phase-05-terminal-audit]

tech-stack:
  added: []
  patterns:
    - raw detached-signature reverification at every authoritative accepted-evidence boundary
    - authenticated metadata copied field-by-field into mutually bound decision/residue records
    - structural-only compatibility for historical schema versions

key-files:
  created: []
  modified:
    - scripts/outreach-feasibility/evidence-integrity.mjs
    - scripts/outreach-feasibility/evidence-integrity.test.mjs
    - scripts/outreach-feasibility/decision-evidence.mjs
    - scripts/outreach-feasibility/decision-evidence.test.mjs

key-decisions:
  - "Only schema v3 may satisfy authoritative accepted-evidence validation; schema v1 and v2 remain inspectable structural history."
  - "The historical owner checkpoint digest is retained as integrity-only lineage and never substitutes for any fresh authorization field."
  - "Finalization verifies the raw SSHSIG before rights checks, Git resolution, residue scanning, candidate construction, staging, rename, or publication."

patterns-established:
  - "Authenticated v3 boundary: reverify request/signature bytes against pinned public trust, then compare every bound field in both artifacts."
  - "Pre-effect finalizer: authentication failure returns before Git or publication work and preserves prior pair bytes, existence, and modes."

requirements-completed: [OUTR-04, OUTR-05]

coverage:
  - id: D1
    description: Accepted decision and residue schema v3 require fresh SSHSIG verification and exact authorization metadata while v1/v2 remain structural-only.
    requirement: OUTR-05
    verification:
      - kind: integration
        ref: "node --test scripts/outreach-feasibility/evidence-integrity.test.mjs scripts/outreach-feasibility/owner-authorization.test.mjs scripts/outreach-feasibility/owner-checkpoint.test.mjs"
        status: pass
    human_judgment: false
  - id: D2
    description: The finalizer authenticates before every effect and publishes only a rollback-safe stopped schema-v3 pair with five zero effect counters.
    requirement: OUTR-04
    verification:
      - kind: integration
        ref: "node --test scripts/outreach-feasibility/decision-evidence.test.mjs scripts/outreach-feasibility/evidence-integrity.test.mjs"
        status: pass
    human_judgment: false

duration: 10min
completed: 2026-07-30
status: complete
---

# Phase 05 Plan 17: Authenticated Accepted-Evidence Finalizer Summary

**Fresh SSHSIG reverification now gates schema-v3 stopped evidence before every Git or publication effect, with exact metadata binding and verified rollback**

## Performance

- **Duration:** 10 min
- **Started:** 2026-07-30T16:29:25Z
- **Completed:** 2026-07-30T16:39:45Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added exact schema-v3 decision and zero-residue contracts binding raw request/signature SHA-256 values, principal, namespace, key fingerprint, nonce digest, issuance/verification times, signed stopped-payload digest, and integrity-only historical receipt lineage.
- Kept schema versions 1 and 2 available for structural inspection while requiring fresh public SSHSIG verification for every authoritative accepted-evidence assertion.
- Moved owner authorization ahead of rights checks, Git HEAD resolution, controlled-surface scanning, record construction, staging, rename, and publication.
- Published only `RIGHTS_NO_GO` / `NOT_RUN_RIGHTS_NO_GO` schema-v3 pairs with representative cases, provider calls, fixtures, raw results, and production mutations all fixed at zero.
- Preserved exact prior decision/residue bytes, absence, and file modes across every injected publication fault.

## Task Commits

Each TDD task was committed through RED then GREEN:

1. **Task 1 RED: Require fresh authorization in accepted schema v3** - `70630da` (test)
2. **Task 1 GREEN: Require fresh authorization in accepted schema v3** - `4450cd1` (feat)
3. **Task 2 RED: Gate authenticated finalization before every effect** - `cc073b3` (test)
4. **Task 2 GREEN: Gate authenticated finalization before every effect** - `9359179` (feat)

## Files Created/Modified

- `scripts/outreach-feasibility/evidence-integrity.mjs` - Defines structural v1/v2 schemas, authenticated v3 contracts, proof-field validation, and fresh accepted-evidence reverification.
- `scripts/outreach-feasibility/evidence-integrity.test.mjs` - Covers exact authenticated success, deletion, independent re-hash, legacy receipt substitution, swapped signature, stale request, revoked trust, and path drift.
- `scripts/outreach-feasibility/decision-evidence.mjs` - Verifies fresh authorization before all finalization effects, constructs the stopped v3 pair, enforces exact public CLI inputs, and reuses rollback-safe publication.
- `scripts/outreach-feasibility/decision-evidence.test.mjs` - Proves pre-Git/no-write authentication failure, five zero counters, exact CLI flag rejection, and pair restoration at every fault point.

## Decisions Made

- Authoritative acceptance is an asynchronous cryptographic boundary because raw SSHSIG verification cannot be represented truthfully by a structural boolean or synchronous schema check.
- `owner_authorization_verified_at` is persisted and pair-bound at finalization; later reverification requires it to remain identical across both artifacts, no earlier than issuance, and no later than the current in-window verification.
- Public CLI trust inputs are exact repository-relative paths. Unknown, duplicate, missing, planning-directory, or non-public substitutes fail before validation.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - verification uses only the already committed request, detached signature, and pinned public trust artifacts.

## Next Phase Readiness

- Plan 05-18 can resolve the remaining dormant-runner authorization boundary against the now-authenticated stopped decision.
- Production outreach, provider/network calls, representative spike execution, redesign selection, code review, and authoritative terminal audit remain disabled or reserved for their explicit later gates.

## Self-Check: PASSED

- All four modified source/test files exist.
- TDD commits `70630da`, `4450cd1`, `cc073b3`, and `9359179` are reachable.
- The complete offline authorization/finalization suite passes 47/47 with `TAVILY_API_KEY` unset.
- Node syntax checks pass for both modified implementation modules.
- No tracked files were deleted, no private-key path was accessed or introduced, and no provider/network or live terminal-audit command ran.

---
*Phase: 05-outreach-feasibility-gate*
*Completed: 2026-07-30*

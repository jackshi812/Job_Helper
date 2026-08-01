---
phase: 05-outreach-feasibility-gate
plan: 15
subsystem: security
tags: [canonical-json, sha256, nonce, openssh, owner-authorization]

requires:
  - phase: 05-14
    provides: pinned public owner trust anchor and canonical request validator
provides:
  - one exclusive byte-exact owner authorization request for the stopped Phase 5 no-go
  - fresh replay boundary with a 256-bit nonce and exact seven-day signing window
affects: [05-16, 05-17, 05-18, 05-19]

tech-stack:
  added: []
  patterns:
    - repository-derived finite signing payload serialized as canonical JSON plus one LF
    - exclusive creation followed by byte-for-byte reopen and validation

key-files:
  created:
    - .planning/phases/05-outreach-feasibility-gate/05-OWNER-AUTHORIZATION-REQUEST.json
  modified: []

key-decisions:
  - "Plan 05-15 creates only the public request; detached signing remains exclusively in the blocking Plan 05-16 owner action."
  - "The full Plan 05-14 test suite was not invoked because its fixture tests run ssh-keygen -Y sign; five non-signing request/trust tests plus production and independent byte assertions validate this request without creating any signature."

patterns-established:
  - "Fresh authorization input: exact evidence, stopped decision, owner identity, nonce, time window, and self-hash travel in one immutable canonical document."
  - "Preparation/effect separation: request generation cannot sign, call a provider, run the spike, mutate accepted evidence, or enable production outreach."

requirements-completed: [OUTR-04, OUTR-05]

coverage:
  - id: D1
    description: The generated authorization request binds the exact stopped RIGHTS_NO_GO and NOT_RUN_RIGHTS_NO_GO evidence, semantic digests, historical integrity-only receipt digest, and zero-effect decision projection.
    requirement: OUTR-04
    verification:
      - kind: integration
        ref: "env -u TAVILY_API_KEY GIT_OPTIONAL_LOCKS=0 node scripts/outreach-feasibility/owner-authorization.mjs --assert-request ... (OWNER_AUTHORIZATION_REQUEST_VALID)"
        status: pass
      - kind: other
        ref: "independent Node byte/counter assertion (canonical_sha256=db79ebef9aa42fa5e453ed4b7fbeb1fa175e60f614ab02521fbed1b09516e5dd)"
        status: pass
    human_judgment: false
  - id: D2
    description: The request is fresh, non-reusable canonical signing input bound to the pinned owner principal, namespace, key record, fingerprint, and exact seven-day window.
    requirement: OUTR-05
    verification:
      - kind: unit
        ref: "scripts/outreach-feasibility/owner-authorization.test.mjs#five non-signing request and trust tests (5/5 pass)"
        status: pass
      - kind: other
        ref: "signature destination absence and task commit file-scope assertion"
        status: pass
    human_judgment: false

duration: 2min
completed: 2026-07-30
status: complete
---

# Phase 05 Plan 15: Fresh Owner Authorization Request Summary

**One canonical 1,885-byte signing request binds the stopped no-go evidence to the pinned owner identity with fresh randomness, an exact seven-day window, and zero outreach effects**

## Performance

- **Duration:** 2 min
- **Started:** 2026-07-30T15:36:19Z
- **Completed:** 2026-07-30T15:38:39Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Created the sole `05-OWNER-AUTHORIZATION-REQUEST.json` through the exclusive production CLI and reopened the exact written bytes before success.
- Bound principal `jackshi812`, namespace `job-copilot-phase-05-owner-v1`, signing-key record `1081409`, the pinned fingerprint, stopped decision payload, current evidence digests, stable semantic digests, and historical integrity-only receipt lineage.
- Generated a fresh 64-character lowercase hexadecimal nonce, canonical millisecond UTC issue time, exact seven-day expiry, stopped-payload digest, and self-hash over every finite field except the self-hash itself.
- Preserved `search_authorized=false`, `production_outreach_enabled=false`, `spike_executed=false`, null redesign selection, and all five effect/case counters at zero.

## Task Commits

Each task was committed atomically:

1. **Task 1: Generate and validate the fresh canonical authorization request** - `3bdde94` (feat)

## Files Created/Modified

- `.planning/phases/05-outreach-feasibility-gate/05-OWNER-AUTHORIZATION-REQUEST.json` - Exact public bytes for the owner-only detached signature in Plan 05-16.

## Decisions Made

- Request generation remained strictly separate from signing. No detached signature was created, and no signing command or private-key path was invoked.
- The explicit no-signing constraint superseded the plan's broad test-suite wording. Verification used the production assertion command, an independent canonical-byte/time/counter check, and the five Plan 05-14 tests that perform no signing.

## Deviations from Plan

### Execution-Constraint Adjustment

**1. Full authorization suite narrowed to non-signing coverage**
- **Found during:** Task 1 verification
- **Issue:** Three Plan 05-14 fixture tests create temporary SSH signatures through `ssh-keygen -Y sign`, which this plan's explicit execution scope forbids.
- **Adjustment:** Ran the five request/trust tests that do not sign, then separately ran the production request assertion and an independent byte, nonce, time-window, and zero-effect validation.
- **Files modified:** None.
- **Verification:** 5/5 selected tests passed; production CLI returned `OWNER_AUTHORIZATION_REQUEST_VALID`; full-file SHA-256 is `db79ebef9aa42fa5e453ed4b7fbeb1fa175e60f614ab02521fbed1b09516e5dd`.
- **Committed in:** No code change; execution-only adjustment.

**Total deviations:** 1 execution-constraint adjustment; 0 auto-fixed code deviations.
**Impact on plan:** The canonical request is fully validated without crossing the signing boundary reserved for Plan 05-16.

## Issues Encountered

None.

## Known Stubs

None. `redesign_selection: null` and the five zero counters are intentional fail-closed stopped-decision values, not unwired data.

## User Setup Required

None. The blocking owner-only signature action remains in Plan 05-16.

## Next Phase Readiness

- Plan 05-16 can sign these exact committed bytes through the separately authorized owner checkpoint and verify the resulting public detached signature offline.
- Production outreach remains disabled. No provider/network call, representative spike, accepted-evidence mutation, signature creation, code review, or authoritative terminal audit occurred.

## Self-Check: PASSED

- The request exists at its canonical path, is 1,885 bytes, ends in exactly one LF, and has full-file SHA-256 `db79ebef9aa42fa5e453ed4b7fbeb1fa175e60f614ab02521fbed1b09516e5dd`.
- The request's internal self-hash, stopped-decision digest, evidence bindings, pinned trust identity, fresh nonce, issue time, and exact seven-day expiry all validate.
- Task commit `3bdde94` is reachable and contains only the request artifact; it deletes no tracked files.
- The signature destination is absent, all provider/effect counters remain zero, and unrelated owner changes remain unstaged and uncommitted.

---
*Phase: 05-outreach-feasibility-gate*
*Completed: 2026-07-30*

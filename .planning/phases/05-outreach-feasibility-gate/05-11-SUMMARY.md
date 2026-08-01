---
phase: 05-outreach-feasibility-gate
plan: 11
subsystem: compliance
tags: [rights-no-go, dormant-contract, effect-boundary, adversarial-testing]

requires:
  - phase: 05-09
    provides: accepted RIGHTS_NO_GO evidence and NOT_RUN_RIGHTS_NO_GO terminal contract
provides:
  - structurally non-effectful dormant spike runner
  - direct all-ALLOW and hostile-capability regression coverage
  - held-out forged-authorization and global-transport non-execution proof
affects: [phase-05-verification, OUTR-04, OUTR-05, terminal-audit]

tech-stack:
  added: []
  patterns:
    - zero-input fail-closed dormant boundary
    - hostile getter and throwing global transport sentinels

key-files:
  created: []
  modified:
    - scripts/outreach-feasibility/dormant/spike-runner.mjs
    - scripts/outreach-feasibility/dormant/spike-runner.test.mjs
    - scripts/outreach-feasibility/adversarial-regression.test.mjs

key-decisions:
  - "Remove authorization evaluation and every injectable effect capability from runConditionalSpike instead of attempting to strengthen a dormant authorization object."
  - "Preserve D-01 through D-08 as a frozen quality-design contract while marking execution permanently non-executable under D-09, D-10, D-12, and D-13."

patterns-established:
  - "Dormant means capability-free: runConditionalSpike accepts no operational input and returns only the terminal no-go record."
  - "Effect-boundary regressions use throwing access sentinels, never provider-capable fakes."

requirements-completed: [OUTR-04, OUTR-05]

coverage:
  - id: D1
    description: The dormant runner has no authorization-to-secret, corpus, request, transport, or production-mutation path.
    requirement: OUTR-04
    verification:
      - kind: unit
        ref: "env -u TAVILY_API_KEY GIT_OPTIONAL_LOCKS=0 node --test scripts/outreach-feasibility/dormant/spike-runner.test.mjs"
        status: pass
      - kind: other
        ref: "rg structural scan for removed authorization and effect symbols in spike-runner.mjs"
        status: pass
    human_judgment: false
  - id: D2
    description: All-ALLOW and forged authorization inputs remain production-disabled and observe zero injected or global transport effects.
    requirement: OUTR-05
    verification:
      - kind: integration
        ref: "scripts/outreach-feasibility/adversarial-regression.test.mjs#forged all-ALLOW authorization cannot cross the dormant effect boundary"
        status: pass
      - kind: unit
        ref: "scripts/outreach-feasibility/dormant/spike-runner.test.mjs#all-ALLOW authorization cannot read capabilities or leave the terminal no-go"
        status: pass
    human_judgment: false
  - id: D3
    description: The six-real-plus-two-control quality design remains frozen documentation but is explicitly non-executable under the accepted rights no-go.
    requirement: OUTR-05
    verification:
      - kind: unit
        ref: "scripts/outreach-feasibility/dormant/spike-runner.test.mjs#SPIKE_CONTRACT exactly preserves D-01 through D-08 and D-14 through D-16"
        status: pass
    human_judgment: false

duration: 3min
completed: 2026-07-30
status: complete
---

# Phase 05 Plan 11: Structurally Inert Dormant Spike Summary

**Capability-free dormant runner with invariant RIGHTS_NO_GO output and direct plus held-out proof that forged inputs cannot cross an effect boundary**

## Performance

- **Duration:** 3 min
- **Started:** 2026-07-30T14:45:09Z
- **Completed:** 2026-07-30T14:48:42Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Removed the forgeable authorization predicate and every secret, corpus, request, provider-transport, and production-mutation capability from the dormant runner.
- Made every invocation return `production_outreach_enabled=false`, `spike_executed=false`, `NOT_RUN_RIGHTS_NO_GO`, and four zero effect counters.
- Added direct and held-out regressions proving all-ALLOW matrices, forged digest-shaped authorization, hostile getters, and a throwing global transport sentinel remain unobserved.
- Preserved the complete eight-case quality design as frozen documentation while explicitly marking it non-executable under the accepted terminal decisions.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Add failing dormant boundary regressions** - `c9a3d01` (test)
2. **Task 1 GREEN: Make the dormant spike structurally inert** - `62e40a7` (fix)
3. **Task 2: Add held-out dormant effect proof** - `abd0a54` (test)

## Files Created/Modified

- `scripts/outreach-feasibility/dormant/spike-runner.mjs` - Frozen non-executable quality contract and single terminal no-go return path.
- `scripts/outreach-feasibility/dormant/spike-runner.test.mjs` - Direct all-ALLOW, hostile-getter, invariant-result, and contract coverage.
- `scripts/outreach-feasibility/adversarial-regression.test.mjs` - Held-out forged-authorization and global-transport sentinel proof.

## Decisions Made

- Removed the dormant authorization mechanism entirely. A stronger caller-supplied digest shape would still be the wrong trust primitive for a permanently stopped branch.
- Kept D-01 through D-08 reviewable in `SPIKE_CONTRACT`, but made D-09, D-10, D-12, and D-13 an explicit non-executable policy rather than a runtime admission condition.
- Kept adversarial tests offline and non-provider-capable: sentinels throw if accessed and cannot perform transport or production work.

## TDD Gate Compliance

- Task 1 RED failed against the prior implementation because the required terminal flags were absent and the hostile `readSecret` getter was accessed.
- Task 1 GREEN passed 12/12 direct tests after the implementation branch was removed.
- Task 2 is a test-only held-out proof added after Task 1 fixed the behavior; the combined direct and adversarial suite passed 19/19 without further implementation.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Known Stubs

None. The documented case counts and zero execution counters are intentional terminal no-go evidence, not unwired production data.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 05-11 closes the verifier's dormant effect-boundary finding without widening outreach scope.
- Production outreach, provider transport, representative spike execution, Phase 6, and Phase 7 remain disabled and unauthorized.
- Remaining Phase 5 gap-closure plans may proceed without treating this dormant contract as executable authority.

## Self-Check: PASSED

- All three modified source/test files exist.
- RED `c9a3d01`, GREEN `62e40a7`, and held-out `abd0a54` commits are reachable.
- Both task verification commands and the plan-level 19-test offline suite pass with `TAVILY_API_KEY` unset.
- Structural scan confirms the dormant runner contains none of the removed authorization or effect-capability symbols.

---
*Phase: 05-outreach-feasibility-gate*
*Completed: 2026-07-30*

---
phase: 05-outreach-feasibility-gate
plan: 01
subsystem: compliance
tags: [node, sha256, policy-gate, fail-closed, evidence]

# Dependency graph
requires:
  - phase: 04
    provides: Shipped production application tracker boundary that remains untouched by this evidence-only gate
provides:
  - Sanitized operation-by-operation LinkedIn and Tavily rights matrix
  - Fail-closed rights evaluator with exact schema, freshness, and digest validation
  - Digest-bound NOT_RUN_RIGHTS_NO_GO quality evidence with four zero effect counters
affects: [05-02, 05-03, 05-04, phase-06, phase-07, outreach]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Canonical recursive JSON plus final-newline SHA-256 evidence binding
    - Every required operation must be current, digest-valid, and explicitly ALLOW before authorization
    - Rights-blocked quality work is recorded as not run with exact zero effects

key-files:
  created:
    - .planning/phases/05-outreach-feasibility-gate/05-RIGHTS-MATRIX.json
    - .planning/phases/05-outreach-feasibility-gate/05-QUALITY-REPORT.json
    - scripts/outreach-feasibility/rights-gate.mjs
    - scripts/outreach-feasibility/rights-gate.test.mjs
  modified: []

key-decisions:
  - "Treat the current LinkedIn prohibitions and Tavily ambiguities as RIGHTS_NO_GO before request one; owner acknowledgement cannot substitute for permission."
  - "Keep required local raw-response deletion separate from ambiguous provider-side retention and from optional company-level caching."
  - "Use canonical SHA-256 digests only for drift detection; a digest neither authenticates an owner nor grants legal permission."

patterns-established:
  - "Exact rights admission: missing, duplicate, stale, drifted, prohibited, ambiguous, malformed, or unknown permission evidence fails closed."
  - "Truthful no-run evidence: a rights-blocked quality report has no cases and zero provider calls, fixtures, raw results, or production mutations."

requirements-completed: [OUTR-04, OUTR-05]

coverage:
  - id: D1
    description: "Current LinkedIn and Tavily evidence is a sanitized, digest-bound RIGHTS_NO_GO matrix covering every required operation exactly once."
    requirement: OUTR-04
    verification:
      - kind: unit
        ref: "scripts/outreach-feasibility/rights-gate.test.mjs#the committed matrix fails closed with truthful zero-effect evidence"
        status: pass
      - kind: other
        ref: "05-01-PLAN.md Task 1 exact matrix verification command"
        status: pass
    human_judgment: false
  - id: D2
    description: "The quality spike is truthfully recorded as NOT_RUN_RIGHTS_NO_GO with no cases and four exact zero effect counters."
    requirement: OUTR-05
    verification:
      - kind: unit
        ref: "scripts/outreach-feasibility/rights-gate.test.mjs#no-run report rejects fabricated outcomes, candidate data, effects, and drift"
        status: pass
      - kind: other
        ref: "env -u TAVILY_API_KEY node scripts/outreach-feasibility/rights-gate.mjs --assert-no-go --matrix ... --quality-report ..."
        status: pass
    human_judgment: false

# Metrics
duration: 6m
completed: 2026-07-29
status: complete
---

# Phase 05 Plan 01: Rights Evidence and No-Run Quality Gate Summary

**Canonical, digest-bound rights evidence now stops the Tavily-to-LinkedIn spike before request one and records quality as not run with zero effects.**

## Performance

- **Duration:** 6m
- **Started:** 2026-07-29T15:00:19Z
- **Completed:** 2026-07-29T15:05:54Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Froze eight official-source evidence rows and the exact seven required plus one optional operation classifications in a sanitized, canonical-digest matrix.
- Implemented a built-in-only ESM gate whose `PASS` requires every required operation to be current, digest-valid, unique, and exactly `ALLOW`.
- Proved the current matrix produces `RIGHTS_NO_GO`, `search_authorized: false`, `NOT_RUN_RIGHTS_NO_GO`, no cases, and four zero effect counters without a provider key or network boundary.

## Task Commits

Each task was committed atomically:

1. **Task 1: Freeze the sanitized operation-by-operation rights matrix** - `5cdcd56` (docs)
2. **Task 2 RED: Add the failing rights-gate contract** - `228e4d1` (test)
3. **Task 2 GREEN: Implement the fail-closed rights gate and no-run evidence** - `2496bd7` (feat)

## Files Created/Modified

- `.planning/phases/05-outreach-feasibility-gate/05-RIGHTS-MATRIX.json` - Exact sanitized source and operation evidence with per-source and aggregate digests.
- `.planning/phases/05-outreach-feasibility-gate/05-QUALITY-REPORT.json` - Digest-bound rights-blocked no-run report with four zero effect counters.
- `scripts/outreach-feasibility/rights-gate.mjs` - Strict validator, evaluator, no-run report builder/assertion, and import-safe CLI.
- `scripts/outreach-feasibility/rights-gate.test.mjs` - Offline positive and denial-path coverage for matrix and report drift.

## Decisions Made

- Public visibility and technical API capability never upgrade a rights row; only explicit, current `ALLOW` evidence can authorize a required operation.
- Required local deletion remains hygiene only and cannot cure unauthorized acquisition or resolve provider-side retention.
- Optional company-level caching remains ambiguous but is kept separate from the seven required flow operations.
- Owner acknowledgement is intentionally absent from admission logic and cannot override missing, prohibited, ambiguous, stale, or drifted evidence.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected the RED test's expected canonical hash**
- **Found during:** Task 2 GREEN verification
- **Issue:** The hand-entered expected SHA-256 literal for `{"a":1,"b":2}` plus a final newline was incorrect, while the implementation produced the independently correct digest.
- **Fix:** Recomputed the fixture with `shasum -a 256` and replaced only the incorrect expected literal.
- **Files modified:** `scripts/outreach-feasibility/rights-gate.test.mjs`
- **Verification:** The independent hash and all 26 focused tests pass.
- **Committed in:** `2496bd7`

---

**Total deviations:** 1 auto-fixed (1 Rule 1 bug).
**Impact on plan:** The correction fixed test evidence only; implementation scope and rights behavior were unchanged.

## Issues Encountered

- Repository metadata was read-only in the default sandbox. Each normal, hook-enabled Git commit was retried with narrowly scoped repository metadata permission; unrelated working-tree changes remained unstaged.

## Authentication Gates

None.

## User Setup Required

None - no provider key, network access, package installation, or external configuration is required.

## Next Phase Readiness

- Plan 05-02 can consume the exact rights digest and stable no-run contract while preserving the dormant spike boundary.
- Production outreach search remains disabled. The current evidence cannot be upgraded by owner acknowledgement and no provider effect occurred.

## Self-Check: PASSED

- All four key files exist.
- Task commits `5cdcd56`, `228e4d1`, and `2496bd7` exist in Git history.
- Task 1 exact schema/reference/classification/digest verification passed.
- Task 2 passed 26/26 focused tests and the `--assert-no-go` CLI with `TAVILY_API_KEY` absent.
- Stub scan found no `TODO`, `FIXME`, placeholder, or unimplemented behavior in the final plan files.
- The plan changed only the four declared evidence/script files before this summary; no production UI, schema, Edge Function, database, cache, or scheduler file was touched.

---
*Phase: 05-outreach-feasibility-gate*
*Completed: 2026-07-29*

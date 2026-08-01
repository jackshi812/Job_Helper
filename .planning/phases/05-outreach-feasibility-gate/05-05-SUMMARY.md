---
phase: 05-outreach-feasibility-gate
plan: 05
subsystem: compliance
tags: [node, policy-gate, chronology, sha256, zero-effect]

# Dependency graph
requires:
  - phase: 05-04
    provides: Accepted RIGHTS_NO_GO decision, disabled production outreach, and stopped-milestone evidence
provides:
  - Strict canonical UTC retrieval-timestamp validation
  - Seven-UTC-calendar-day maximum rights-evidence horizon
  - Future and out-of-window evidence denial before any conditional spike effect
affects: [05-06, outreach, rights-gate, dormant-spike]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Canonical UTC chronology is validated before rights admission
    - Digest-consistent denial fixtures prove fail-closed behavior
    - Matching structured authorization cannot override invalid evidence time

key-files:
  created: []
  modified:
    - scripts/outreach-feasibility/rights-gate.mjs
    - scripts/outreach-feasibility/rights-gate.test.mjs
    - scripts/outreach-feasibility/dormant/spike-runner.test.mjs

key-decisions:
  - "Accept retrieval timestamps only as canonical UTC whole seconds or exactly three fractional-second digits."
  - "Cap the research-start to validity-start difference at seven UTC calendar days while keeping valid_until inclusive through its final millisecond."

patterns-established:
  - "Current evidence only: research and every retrieval must be no later than the evaluation clock."
  - "Window-bound retrieval: every source must be retrieved from research start through the inclusive validity end."

requirements-completed: [OUTR-04, OUTR-05]

coverage:
  - id: D1
    description: "Rights evidence cannot become current through future research, future or out-of-window retrieval, a non-canonical timestamp, or an excessive validity horizon."
    requirement: OUTR-04
    verification:
      - kind: unit
        ref: "scripts/outreach-feasibility/rights-gate.test.mjs#future, out-of-window, and excessive-horizon evidence fails closed"
        status: pass
      - kind: unit
        ref: "scripts/outreach-feasibility/rights-gate.test.mjs#retrieval timestamps accept only canonical UTC seconds or milliseconds"
        status: pass
    human_judgment: false
  - id: D2
    description: "Digest-consistent invalid chronology with matching structured authorization reaches no secret, corpus, request-build, or provider-fetch callback."
    requirement: OUTR-05
    verification:
      - kind: integration
        ref: "scripts/outreach-feasibility/dormant/spike-runner.test.mjs#digest-consistent chronology denials never reach injected effects"
        status: pass
    human_judgment: false

# Metrics
duration: 5 min
completed: 2026-07-29
status: complete
---

# Phase 05 Plan 05: Rights Chronology and Zero-Effect Gate Summary

**Strict UTC chronology and a seven-day evidence horizon now reject not-yet-current rights material before every dormant spike effect while preserving the accepted RIGHTS_NO_GO.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-29T17:44:23Z
- **Completed:** 2026-07-29T17:49:29Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added strict canonical UTC parsing for source retrieval timestamps, accepting whole seconds or exactly three fractional-second digits.
- Enforced research and retrieval no-later-than-now checks, retrieval containment inside the approved evidence window, and a seven-day maximum validity horizon.
- Added digest-consistent evaluator and dormant-runner coverage proving five chronology/horizon denial cases return the exact no-run record with all four callbacks untouched.
- Preserved the committed matrix classifications, its canonical digest, `RIGHTS_NO_GO`, `NOT_RUN_RIGHTS_NO_GO`, and all four zero effect counters.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Add failing rights chronology boundaries** - `dc6331b` (test)
2. **Task 1 GREEN: Enforce bounded rights chronology** - `320c668` (feat)
3. **Task 2: Prove chronology blocks injected spike effects** - `2ae4657` (test)

Task 2 is intentionally test-only. Its new regression cases passed on their first run because Task 1 had already implemented the shared evaluator behavior they exercise.

## Files Created/Modified

- `scripts/outreach-feasibility/rights-gate.mjs` - Exports the seven-day limit and validates strict current, in-window retrieval chronology.
- `scripts/outreach-feasibility/rights-gate.test.mjs` - Covers exact boundary acceptance and future, malformed, out-of-window, and excessive-horizon denial.
- `scripts/outreach-feasibility/dormant/spike-runner.test.mjs` - Supplies re-signed invalid chronology plus matching authorization and proves zero injected effects.

## Decisions Made

- Canonical retrieval time permits only `YYYY-MM-DDTHH:mm:ssZ` or the same UTC form with exactly three fractional-second digits.
- The maximum horizon is measured between UTC date starts and may equal seven days; operational validity remains inclusive through the last millisecond of `valid_until`.
- Chronology failures remain non-overridable: exact structured authorization and internally consistent digests cannot convert invalid time evidence into permission.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The managed filesystem initially denied Git index writes. The normal hook-enabled commits were retried through narrowly scoped repository-metadata approval; no hook was bypassed and no unrelated file was staged.
- The stub scanner's broad empty-value pattern matched legitimate validator sentinels and an injected-call spy. Manual flow review confirmed these are not rendered or unwired stubs; the placeholder-text scan is clean.

## Authentication Gates

None.

## User Setup Required

None - no provider key, network access, package installation, fixture, or external configuration is required.

## Next Phase Readiness

- Plan 05-06 can address the next verification gap with the future-evidence authorization bypass closed.
- Production outreach search remains disabled; no provider call, corpus, raw result, fixture, production mutation, or redesign authorization was introduced.

## Self-Check: PASSED

- All three modified plan files exist.
- Task commits `dc6331b`, `320c668`, and `2ae4657` exist in Git history in order.
- The rights-gate suite passes 41/41 and the dormant-runner suite passes 12/12 with `TAVILY_API_KEY` absent.
- The exact committed matrix still validates at the 2026-07-29 clock and evaluates to `RIGHTS_NO_GO` with all four effect counters zero.
- Stub review found no placeholder text or unwired UI/data source; this plan has no UI.
- Threat-surface review found no provider origin, environment-secret lookup, endpoint, server, direct fetch, schema, database, cache, scheduler, or production import.
- The plan commit range modifies only the three declared local script/test files; unrelated worktree changes remain unstaged and preserved.

---
*Phase: 05-outreach-feasibility-gate*
*Completed: 2026-07-29*

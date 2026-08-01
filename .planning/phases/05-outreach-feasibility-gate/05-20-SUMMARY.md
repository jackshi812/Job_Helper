---
phase: 05-outreach-feasibility-gate
plan: 20
subsystem: security
tags: [node-fs, crash-consistency, write-ahead-journal, file-locking, sshsig]

requires:
  - phase: 05-outreach-feasibility-gate
    plan: 21
    provides: Historical no-go consumer compatibility and public proof integrity
provides:
  - Durable, restartable accepted decision/residue pair publication
  - Recovery-before-read interfaces for every in-scope accepted-pair consumer
  - SIGKILL, concurrency, active-lock, malformed-state, and path-substitution regressions
affects: [05-23-terminal-integration, accepted-evidence-consumers, outreach-feasibility]

tech-stack:
  added: []
  patterns:
    - Same-directory exclusive lock with PID-aware bounded acquisition
    - Finite write-ahead journal with file and directory fsync boundaries
    - Recovery-before-read for accepted evidence consumers

key-files:
  created: []
  modified:
    - scripts/outreach-feasibility/decision-evidence.mjs
    - scripts/outreach-feasibility/decision-evidence.test.mjs
    - scripts/outreach-feasibility/residue-check.mjs
    - scripts/outreach-feasibility/residue-check.test.mjs

key-decisions:
  - "Publish the residue before the decision under one canonical lock, with exact prior backups and a finite prepared → record-published → committed journal."
  - "Authenticate the existing raw SSHSIG before recovery, Git resolution, scanning, construction, or publication; never introduce another signing path."
  - "Keep one finite accepted-pair consumer inventory and reserve terminal runContractValidation/runTerminalAudit integration for Plan 05-23."

patterns-established:
  - "Durable boundary inventory: every fsync, rename, readback, cleanup, and lock boundary is exported and killed in a subprocess regression."
  - "Ambiguous recovery fails closed: verified recovery copies and journal state are retained whenever old-or-new coherence cannot be proved."
  - "Transaction path hardening: canonical artifacts, lock, journal, stage, backup, restore, journal-stage, and parent paths reject substitution."

requirements-completed: [OUTR-04, OUTR-05]

coverage:
  - id: D1
    description: Durable accepted-pair publication recovers to one coherent old or new generation after process death at every exported boundary.
    requirement: OUTR-04
    verification:
      - kind: integration
        ref: "scripts/outreach-feasibility/decision-evidence.test.mjs#every durable publication boundary survives SIGKILL and restart recovery"
        status: pass
    human_judgment: false
  - id: D2
    description: Concurrent writers serialize, readers observe complete generations, and active locks are never stolen.
    requirement: OUTR-04
    verification:
      - kind: integration
        ref: "scripts/outreach-feasibility/decision-evidence.test.mjs#concurrent writers serialize and readers observe only complete generations"
        status: pass
      - kind: unit
        ref: "scripts/outreach-feasibility/decision-evidence.test.mjs#an active lock is bounded and never stolen"
        status: pass
    human_judgment: false
  - id: D3
    description: Decision, finalizer, and residue CLIs recover before consuming either canonical artifact and fail closed on malformed recovery.
    requirement: OUTR-05
    verification:
      - kind: integration
        ref: "env -u TAVILY_API_KEY GIT_OPTIONAL_LOCKS=0 node --test scripts/outreach-feasibility/decision-evidence.test.mjs scripts/outreach-feasibility/residue-check.test.mjs scripts/outreach-feasibility/owner-authorization.test.mjs"
        status: pass
    human_judgment: false
  - id: D4
    description: Canonical and transient paths reject symlink or parent substitution while the authenticated public proof and stopped no-go artifacts remain unchanged.
    requirement: OUTR-05
    verification:
      - kind: integration
        ref: "scripts/outreach-feasibility/decision-evidence.test.mjs#canonical, transient, and parent path substitution fails before publication"
        status: pass
      - kind: integration
        ref: "scripts/outreach-feasibility/owner-authorization.test.mjs#committed public trust artifacts are byte-exact and fingerprint-pinned"
        status: pass
    human_judgment: false

duration: 46m
completed: 2026-07-30
status: complete
---

# Phase 05 Plan 20: Crash-Consistent Accepted Evidence Summary

**A same-directory lock and fsynced write-ahead journal now make the authenticated stopped decision/residue pair restartable, concurrency-safe, and recovery-first without changing its public proof.**

## Performance

- **Duration:** 46m
- **Started:** 2026-07-30T19:50:24Z
- **Completed:** 2026-07-30T20:29:10Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Replaced caught-exception-only pair publication with 35 exported durable boundaries, exact prior backups, three journal states, semantic readback, and deterministic restart recovery.
- Routed the writer, finalizer, decision assertion CLI, finalization CLI, and real residue `--assert-zero` CLI through recovery before either accepted artifact is consumed.
- Proved concurrency, active-lock handling, every canonical/transient path class, malformed-state preservation, public proof immutability, and retained `RIGHTS_NO_GO_ACCEPTED` / `NOT_RUN_RIGHTS_NO_GO` zero-effect semantics.

## Task Commits

Each task was committed atomically using TDD:

1. **Task 1 RED: process-kill and concurrency regressions** - `4dd4cf4` (test)
2. **Task 1 GREEN: durable pair transaction protocol** - `4eddcd8` (feat)
3. **Task 2 RED: recovery-first consumer regressions** - `b2d02e9` (test)
4. **Task 2 GREEN: recovery-first consumer wiring** - `16c11ca` (feat)
5. **Final security hardening: complete transaction path matrix** - `ead1c4c` (fix)

## Files Created/Modified

- `scripts/outreach-feasibility/decision-evidence.mjs` - Exports the complete durable-boundary and consumer inventories, delegates publication to the durable pair protocol, and makes finalizer/assertion reads recovery-first.
- `scripts/outreach-feasibility/decision-evidence.test.mjs` - Exercises SIGKILL at all 35 boundaries, concurrent processes, active locks, real decision/finalizer CLIs, and every canonical/transient path substitution class.
- `scripts/outreach-feasibility/residue-check.mjs` - Implements the canonical lock, strict journal schema, durable staging/backups, deterministic recovery, and coherent pair reader.
- `scripts/outreach-feasibility/residue-check.test.mjs` - Exercises real residue `--assert-zero` recovery-before-both-reads and malformed-journal failure before parsing or scanning.

## Decisions Made

- Residue publishes before decision so a prepared or record-published journal has one deterministic rollback path; a committed journal must prove the complete next pair.
- Readers and writers share the same canonical lock and recovery routine so no accepted-pair consumer can bypass crash recovery.
- Raw public SSHSIG verification remains first in finalization, preserving the stronger authentication-before-Git-and-publication ordering from Plan 05-17.
- Terminal consumer integration remains explicitly assigned to Plan 05-23; this plan publishes and tests the finite inventory without changing terminal lifecycle code.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected the journal replacement-stage namespace**

- **Found during:** Final path-substitution acceptance check
- **Issue:** Journal replacement-stage basenames inherited an unintended second leading dot, so generic `.05-*` transaction-residue checks did not identify them.
- **Fix:** Removed the duplicate prefix and added a finite regression covering both canonical outputs, both stages, both backups, both restores, all three journal replacement stages, the lock, journal, and substituted parent.
- **Files modified:** `scripts/outreach-feasibility/residue-check.mjs`, `scripts/outreach-feasibility/decision-evidence.test.mjs`
- **Verification:** Focused decision suite passed 74/74; combined decision/residue/authorization gate passed 108/108.
- **Committed in:** `ead1c4c`

---

**Total deviations:** 1 auto-fixed bug
**Impact on plan:** The fix closes a planned transaction-residue and path-substitution boundary without adding capabilities or changing the public artifact interface.

## Issues Encountered

- The exact wildcard outreach-feasibility run reached 203/205. Its only failures were two terminal-audit tests requiring the future ROADMAP token `| 5. Outreach Feasibility Gate | v1.1 | 19/19 | Complete |`. Updating tracking or invoking the authoritative terminal audit is prohibited in this plan and terminal integration belongs to Plan 05-23.
- The non-terminal full suite passed 197/197 before final path hardening. After the final fix, the exact focused gates passed 74/74 and 108/108.

## Known Stubs

None. Empty collections and `null` values found by the scan are bounded parser/control state or the intentional unselected redesign field; no created or modified component renders placeholder data.

## Public Artifact Preservation

- `05-DECISION.json` remains SHA-256 `9a857523d186818a6e48ade116d11b8da2e12180a44d1a2665624d767aaba664` with mode `0600`.
- `05-ZERO-RESIDUE.json` remains SHA-256 `4a9ec21b53f9e1dedd6098152c9d49dd4cbc14aef792d6ac6f53b877e7ff77bb` with mode `0600`.
- The owner authorization request, detached signature, trust anchor, public key, and allowed-signers files remain byte-identical and mode-identical.
- No provider request, network search, representative spike, fixture, raw result, production mutation, schema push, or outreach path was invoked.

## User Setup Required

None - no external service configuration or private-key access was required.

## Next Phase Readiness

- Plan 05-23 can integrate `runContractValidation` and `runTerminalAudit` using the exported recovery-first consumer inventory.
- This summary does not claim canonical review, final verification, Phase 5 completion, or terminal-audit success.
- No in-scope crash-consistency, concurrency, recovery, public-proof, or zero-effect blocker remains.

## Self-Check: PASSED

- All four declared implementation/test files and this summary exist.
- All five task/deviation commits resolve in Git.
- Focused post-fix gates passed 74/74 and 108/108.
- No canonical or double-prefix transaction residue exists in the Phase 5 directory.
- The accepted decision, zero-residue record, owner request/signature, and three public trust files are unchanged.

---
*Phase: 05-outreach-feasibility-gate*
*Completed: 2026-07-30*

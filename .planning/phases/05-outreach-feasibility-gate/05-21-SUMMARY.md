---
phase: 05-outreach-feasibility-gate
plan: 21
subsystem: security
tags: [rights-gate, review-integrity, sshsig, bounded-input, fail-closed]

requires:
  - phase: 05-19
    provides: authenticated stopped evidence, public owner proof, and exact 20-file post-hook scope
provides:
  - exact seven-inclusive-UTC-date rights eligibility with immutable historical no-go compatibility
  - exact official HTTPS source contracts for all eight rights evidence sources
  - byte-pinned 7-critical/4-warning immutable review lineage into one exact clean 20-path report
  - pre-OpenSSH stopped-payload reconstruction and bounded historical checkpoint input
affects: [phase-05-post-hook-review, phase-05-final-verifier, phase-05-terminal-audit]

tech-stack:
  added: []
  patterns:
    - structural evidence inspection separated from prospective authorization eligibility
    - exact source-ID to credential-free HTTPS origin, path, and clause-family projection
    - immutable Git-blob review lineage with exact ordered scope and body-to-frontmatter reconciliation
    - canonical signed-payload reconstruction before external signature verification
    - byte-counted streaming input with fail-before-persistence overflow handling

key-files:
  created: []
  modified:
    - scripts/outreach-feasibility/rights-gate.mjs
    - scripts/outreach-feasibility/rights-gate.test.mjs
    - scripts/outreach-feasibility/evidence-integrity.mjs
    - scripts/outreach-feasibility/evidence-integrity.test.mjs
    - scripts/outreach-feasibility/owner-authorization.mjs
    - scripts/outreach-feasibility/owner-authorization.test.mjs
    - scripts/outreach-feasibility/owner-checkpoint.mjs
    - scripts/outreach-feasibility/owner-checkpoint.test.mjs
    - scripts/outreach-feasibility/decision-evidence.mjs
    - scripts/outreach-feasibility/residue-check.test.mjs
    - scripts/outreach-feasibility/terminal-audit.mjs
    - scripts/outreach-feasibility/terminal-audit.test.mjs

key-decisions:
  - "Prospective authorization permits at most seven inclusive UTC dates; the committed eight-date matrix remains inspectable only as historical RIGHTS_NO_GO evidence."
  - "Each rights source ID is bound to one exact credential-free HTTPS protocol, hostname, pathname, and clause family before an ALLOW row can contribute to eligibility."
  - "The prior 7-critical/4-warning report comes only from immutable commit 357d9d02bcc1e4d4bb4b49781f24ae50ff88d1ad with byte SHA-256 8ef26b90728bc388339c07294ffe819d7e8a6d58cd6377a8f11705f14bc8b752; mutable live review bytes are clean-output-only."
  - "The signed stopped-decision payload is reconstructed and hashed before OpenSSH, and all five public request/signature/trust artifacts retain exact canonical path, regular-file, non-writable, and byte contracts."
  - "Historical checkpoint stdin is capped at 1024 bytes while streaming and remains integrity-only; no new owner action or authorization path was created."
  - "Accepted decision and terminal consumers validate the immutable eight-date matrix only through the structural zero-effect no-run contract; prospective evaluateRights eligibility remains strict and rejects every overlong all-ALLOW matrix."
  - "Residue and terminal fixtures fetch the prior review from immutable commit 357d9d0 and assert its byte hash instead of synthesizing an obsolete report."

patterns-established:
  - "Historical no-go compatibility: inspect immutable evidence structurally, compute a fail-closed verdict under current eligibility rules, and admit only the zero-effect no-run report."
  - "Review transition integrity: require byte-pinned immutable issues_found input and exact ordered duplicate-free 20-path clean output with reconciled CR/BL/WR/IN inventories."
  - "Proof ingestion: validate finite canonical payload semantics and public artifact identity before invoking the system verifier."

requirements-completed: [OUTR-04, OUTR-05]

coverage:
  - id: D1
    description: Seven inclusive UTC dates are the absolute prospective authorization limit, and rehashed official-source substitutions cannot produce PASS.
    requirement: OUTR-04
    verification:
      - kind: integration
        ref: "env -u TAVILY_API_KEY GIT_OPTIONAL_LOCKS=0 node --test scripts/outreach-feasibility/rights-gate.test.mjs scripts/outreach-feasibility/dormant/spike-runner.test.mjs (69/69 pass)"
        status: pass
    human_judgment: false
  - id: D2
    description: Only the byte-pinned immutable 7/4/0/11 issues report can transition to one exact ordered unique 20-path clean report with zero findings.
    requirement: OUTR-05
    verification:
      - kind: integration
        ref: "env -u TAVILY_API_KEY GIT_OPTIONAL_LOCKS=0 node --test scripts/outreach-feasibility/evidence-integrity.test.mjs (15/15 pass)"
        status: pass
    human_judgment: false
  - id: D3
    description: Owner proof verification reconstructs the stopped payload before OpenSSH, rejects substitutions across all five public artifacts, and rejects checkpoint input above 1024 bytes before receipt creation.
    requirement: OUTR-05
    verification:
      - kind: integration
        ref: "env -u TAVILY_API_KEY GIT_OPTIONAL_LOCKS=0 node --test scripts/outreach-feasibility/owner-authorization.test.mjs scripts/outreach-feasibility/owner-checkpoint.test.mjs (21/21 pass)"
        status: pass
      - kind: integration
        ref: "env -u TAVILY_API_KEY GIT_OPTIONAL_LOCKS=0 node --test scripts/outreach-feasibility/*.test.mjs scripts/outreach-feasibility/dormant/*.test.mjs (159/159 pass)"
        status: pass
    human_judgment: false

duration: 38min
completed: 2026-07-30
status: complete
---

# Phase 05 Plan 21: Rights, Review, and Owner-Proof Integrity Summary

**Seven-date rights eligibility, exact immutable review lineage, and fail-closed public owner-proof ingestion with the complete 159-test offline suite passing**

## Performance

- **Duration:** 38 min
- **Started:** 2026-07-30T19:10:00Z
- **Completed:** 2026-07-30T19:48:02Z
- **Tasks:** 3
- **Files modified:** 12

## Accomplishments

- Enforced the final millisecond of the seventh inclusive UTC date as the last eligible instant and denied the first millisecond of date eight across month, year, and leap-day boundaries.
- Bound all eight rights source IDs to exact approved HTTPS origin/path/clause contracts, rejecting cross-ID, host, subdomain, port, query, fragment, credential, path-alias, and clause-family substitutions after rehashing.
- Preserved the committed matrix and no-run report byte-for-byte as stopped historical evidence while ensuring the overlong declaration cannot authorize search and every effect counter remains zero.
- Replaced the stale review superset contract with one exact ordered duplicate-free 20-path lifecycle sourced from immutable Git bytes with counters 7 critical, 4 warning, 0 info, and 11 total.
- Reconstructed the finite signed stopped-decision payload before OpenSSH, required the canonical detached-signature path, and proved path, symlink, writable-mode, and content substitutions fail across all five public proof/trust artifacts.
- Capped historical checkpoint input at 1,024 bytes during streaming, stopped before oversized concatenation, and created no receipt on overflow.
- Repaired post-merge compatibility so accepted historical no-go consumers use the structural no-run contract and residue/terminal fixtures consume the exact immutable prior review bytes.
- Passed the complete 159-test offline suite, including strict prospective all-ALLOW denial and every formerly failing decision, adversarial, residue, and terminal path.

## Task Commits

Each task followed a failing-first RED/GREEN cycle:

1. **Task 1 RED: Rights boundary and official-source regressions** - `ed2a70d` (test)
2. **Task 1 GREEN: Seven-date eligibility and exact source contracts** - `ff3fd52` (fix)
3. **Task 2 RED: Exact immutable review lifecycle regressions** - `0dd0cb8` (test)
4. **Task 2 GREEN: Exact 20-path review lifecycle** - `5c8285b` (fix)
5. **Task 3 RED: Owner-proof and bounded-input regressions** - `6d4f43c` (test)
6. **Task 3 GREEN: Hardened owner-proof ingestion** - `118bd39` (fix)
7. **Post-merge gate: Historical no-go consumers and immutable review fixtures** - `a54b6ba` (fix)

## Files Created/Modified

- `scripts/outreach-feasibility/rights-gate.mjs` - Separates immutable structural inspection from seven-date prospective eligibility and binds exact official sources.
- `scripts/outreach-feasibility/rights-gate.test.mjs` - Covers exact UTC boundaries, calendar properties, source substitutions, and historical zero-effect no-go compatibility.
- `scripts/outreach-feasibility/evidence-integrity.mjs` - Exports the exact 20-path inventory and validates pinned issues_found-to-clean review lineage.
- `scripts/outreach-feasibility/evidence-integrity.test.mjs` - Exercises immutable Git bytes, ordered scope drift, duplicates, omissions, extras, counter drift, and CR/BL/WR/IN findings.
- `scripts/outreach-feasibility/owner-authorization.mjs` - Reconstructs the stopped payload before OpenSSH and requires the canonical public signature path.
- `scripts/outreach-feasibility/owner-authorization.test.mjs` - Verifies the existing public proof offline and rejects every public-artifact substitution class.
- `scripts/outreach-feasibility/owner-checkpoint.mjs` - Preserves integrity-only historical validation and enforces the 1,024-byte streaming ceiling.
- `scripts/outreach-feasibility/owner-checkpoint.test.mjs` - Covers exact-limit input, split UTF-8 bytes, early overflow rejection, and zero receipt creation.
- `scripts/outreach-feasibility/decision-evidence.mjs` - Validates accepted historical no-go evidence through the structural no-run report contract without relaxing prospective eligibility.
- `scripts/outreach-feasibility/residue-check.test.mjs` - Uses the exported 20-path scope and byte-pinned immutable prior review in administrative-tail fixtures.
- `scripts/outreach-feasibility/terminal-audit.mjs` - Reconciles authenticated stopped history through the structural no-run contract while retaining strict verdict assertions.
- `scripts/outreach-feasibility/terminal-audit.test.mjs` - Uses the exported 20-path scope and immutable Git review bytes across terminal lifecycle fixtures.

## Decisions Made

- Structural inspection may preserve immutable historical evidence, but authorization eligibility always enforces the current seven-inclusive-date and exact-source contracts.
- Review lineage is anchored to immutable commit `357d9d02bcc1e4d4bb4b49781f24ae50ff88d1ad`; the live `05-REVIEW.md` was neither read as the prior fixture nor rewritten.
- Only public request, signature, trust-anchor, public-key, and allowed-signers files were verified. The owner private key was not accessed, invoked, copied, or exposed.
- Production outreach search remains disabled. No provider call, representative spike, candidate fixture, raw result, production mutation, later-phase enablement, live review, or authoritative live terminal audit occurred.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Preserved integrity-only checkpoint compatibility with the immutable historical matrix**

- **Found during:** Task 3 RED verification after Task 1 tightened prospective eligibility
- **Issue:** The historical checkpoint validator called the prospective `validateRightsMatrix`, so the intentionally preserved eight-date no-go artifact failed structural checkpoint validation before the bounded-input tests could run.
- **Fix:** Used `inspectRightsMatrix` for historical structural/hash validation, then retained the existing computed `RIGHTS_NO_GO`, disabled-search, no-run-quality, and zero-effect assertions. No PASS or authorization path was added.
- **Files modified:** `scripts/outreach-feasibility/owner-checkpoint.mjs`
- **Verification:** The owner authorization/checkpoint gate passed 21/21, including existing canonical behavior and overflow-without-receipt coverage.
- **Committed in:** `118bd39`

**2. [Rule 3 - Blocking] Routed accepted decision and terminal history through structural no-run validation**

- **Found during:** Wave 18 complete 159-test post-merge gate
- **Issue:** `decision-evidence.mjs` and `terminal-audit.mjs` called prospective `validateRightsMatrix` before their existing stopped-verdict and no-run-report checks, so the immutable eight-date matrix failed before authenticated historical evidence could be validated.
- **Fix:** Removed the prospective precondition from those accepted-history consumers. Their existing `evaluateRights` call still returns strict zero-effect `RIGHTS_NO_GO`, while `assertNoGoQualityReport` performs structural/hash/source validation and requires disabled search, empty cases, and zero effects.
- **Files modified:** `scripts/outreach-feasibility/decision-evidence.mjs`, `scripts/outreach-feasibility/terminal-audit.mjs`
- **Verification:** Decision/adversarial tests passed 26/26, terminal tests passed 8/8, and the exact complete suite passed 159/159. Prospective all-ALLOW authorization denial remained green.
- **Committed in:** `a54b6ba`

**3. [Rule 3 - Blocking] Replaced obsolete synthetic review-tail fixtures with immutable source bytes**

- **Found during:** Wave 18 complete 159-test post-merge gate
- **Issue:** Residue and terminal fixtures still synthesized the former 15-path, 4-critical/4-warning report, which could not match the new byte-pinned 20-path, 7-critical/4-warning source contract.
- **Fix:** Imported the canonical exported 20-path list for clean reports, fetched prior bytes only from immutable commit `357d9d02bcc1e4d4bb4b49781f24ae50ff88d1ad`, and asserted SHA-256 `8ef26b90728bc388339c07294ffe819d7e8a6d58cd6377a8f11705f14bc8b752` before installing each fixture.
- **Files modified:** `scripts/outreach-feasibility/residue-check.test.mjs`, `scripts/outreach-feasibility/terminal-audit.test.mjs`
- **Verification:** Administrative review-tail tests passed 3/3, terminal tests passed 8/8, and the exact complete suite passed 159/159.
- **Committed in:** `a54b6ba`

---

**Total deviations:** 3 auto-fixed (3 Rule 3 blocking issues)
**Impact on plan:** The fixes preserve the planned historical integrity-only contract across downstream consumers and fixtures while prospective authorization remains strictly ineligible. No provider, production, live-review, private-key, or later-plan scope was added.

## Issues Encountered

All plan-owned issues were resolved. No blocker remains.

## Known Stubs

None. Empty arrays and null redesign values in the modified files are finite stopped-state contracts or test/runtime accumulators, not product stubs.

## User Setup Required

None. The existing repository public proof verified offline; no secret, provider credential, network access, or new signature was required.

## Next Phase Readiness

- Ready for the execute-phase post-hook review over the exact canonical 20-path scope, with the complete offline suite green.
- The final verifier and authoritative terminal audit remain orchestrator-owned and were not invoked.
- Phase tracking remains unchanged by this plan; production outreach and later phases remain disabled pending the ordered closeout lifecycle.

## Self-Check: PASSED

- All twelve plan-owned and compatibility-deviation source/test files exist.
- All six RED/GREEN task commits and the post-merge compatibility commit resolve in Git.
- All three focused offline gates pass: 69 rights/spike tests, 15 evidence-integrity tests, and 21 owner-proof/checkpoint tests.
- Focused compatibility gates pass: 26 decision/adversarial tests, 3 review-tail tests, and 8 terminal tests.
- The exact complete offline command passes 159/159.
- The committed rights/no-run artifacts and all five public request/signature/trust files are unchanged.
- The live `05-REVIEW.md`, untracked `05-VERIFICATION.md`, tracking documents, provider state, and production state were not modified by this plan.

---
*Phase: 05-outreach-feasibility-gate*
*Completed: 2026-07-30*

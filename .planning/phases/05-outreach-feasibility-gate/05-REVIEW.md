---
phase: 05-outreach-feasibility-gate
reviewed: 2026-07-31T02:25:54Z
depth: standard
files_reviewed: 20
files_reviewed_list:
  - scripts/outreach-feasibility/adversarial-regression.test.mjs
  - scripts/outreach-feasibility/decision-evidence.mjs
  - scripts/outreach-feasibility/decision-evidence.test.mjs
  - scripts/outreach-feasibility/dormant/spike-runner.mjs
  - scripts/outreach-feasibility/dormant/spike-runner.test.mjs
  - scripts/outreach-feasibility/evidence-integrity.mjs
  - scripts/outreach-feasibility/evidence-integrity.test.mjs
  - scripts/outreach-feasibility/owner-authorization.mjs
  - scripts/outreach-feasibility/owner-authorization.test.mjs
  - scripts/outreach-feasibility/owner-checkpoint.mjs
  - scripts/outreach-feasibility/owner-checkpoint.test.mjs
  - scripts/outreach-feasibility/residue-check.mjs
  - scripts/outreach-feasibility/residue-check.test.mjs
  - scripts/outreach-feasibility/rights-gate.mjs
  - scripts/outreach-feasibility/rights-gate.test.mjs
  - scripts/outreach-feasibility/terminal-audit.mjs
  - scripts/outreach-feasibility/terminal-audit.test.mjs
  - scripts/outreach-feasibility/trust/owner-trust-anchor.json
  - scripts/outreach-feasibility/trust/phase-05-owner.allowed_signers.txt
  - scripts/outreach-feasibility/trust/phase-05-owner.pub
findings:
  critical: 4
  warning: 0
  info: 0
  total: 4
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-07-31T02:25:54Z
**Depth:** standard
**Files Reviewed:** 20
**Status:** issues_found

## Summary

The exact ordered 20-file Phase 5 scope was re-reviewed at standard depth through source-repair commit `20bc038` and evidence-rebind commit `3cc7ad9`; `authorization-evidence-validators.mjs` was inspected only as a transitive dependency and was not added to the canonical count. The closed clean-review Summary, snapshot-before-recovery ordering, pair preservation, 20-file inventory, checkpoint lineage, shared schemas, and prior fixture corrections remain sound, but four release blockers are reproducible in the rebound state.

The exact nine-file offline suite did not produce the expected 242/242 result: the shared workspace completed 210 passed and 32 failed, while a clean clone of committed `3cc7ad9` completed 209 passed and 33 failed. All 17 scoped JavaScript files passed syntax checks and the trust-anchor JSON parsed successfully. No authoritative terminal audit, private-key operation, network/provider action, production outreach, or representative spike was performed.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: The rebound snapshot omits an intervening review mutation

**Classification:** BLOCKER

**File:** `scripts/outreach-feasibility/residue-check.mjs:3949-3964`

**Issue:** The committed residue binds the source snapshot to `20bc038`, but commit `a92fa8c` modifies `05-REVIEW.md` between that source and evidence commit `3cc7ad9`. The scanner permits at most one review event after the source snapshot. Publishing this decisive report would therefore be the second event. An isolated clone reproduces the terminal failure exactly: after committing a second review mutation, `scanOwnedSurfaces()` rejects it with `Phase 5 review changed more than once`. The claimed post-snapshot tail does not begin only with the three evidence artifacts; it already contains the `a92fa8c` review event.

**Fix:** Rebind the authenticated source snapshot at or after `a92fa8c` and regenerate the three evidence artifacts so the decisive clean review is the only post-source review transition, or explicitly validate the two-step issues-found-to-issues-found-to-clean lineage. Add a regression using the actual `20bc038 -> a92fa8c -> 3cc7ad9 -> decisive review` commit topology.

### CR-02: Semantic authorization remains bypassable through unrecognized positive language

**Classification:** BLOCKER

**File:** `scripts/outreach-feasibility/decision-evidence.mjs:693-704`; transitive dependency `scripts/outreach-feasibility/authorization-evidence-validators.mjs:127-161`, `scripts/outreach-feasibility/authorization-evidence-validators.mjs:253-263`

**Issue:** The parser now extracts the canonical no-go nodes, but it still permits arbitrary additional prose and rejects positive authorization using a finite keyword blacklist. In-memory probes inserted `Phase 6 is allowed.`, `Phase 6 is authorized, not prohibited.`, and `Production outreach has been switched on.` into each governed section. All six variants were accepted and produced byte-identical roadmap or requirements semantic digests. The first and third avoid the grant-keyword list; the second is incorrectly exempted because any negative word anywhere in the sentence sets `remainsNegative`. Finalization can therefore publish evidence whose live terminal documents contradict the signed no-go semantics.

**Fix:** Make every Phase 6/7 and production-outreach occurrence in the governed sections part of a closed grammar, accepting only the exact canonical negative statements. Do not infer safety from authorization/negation keyword lists. Hash the parsed authorization-bearing statements and add the six reproduced variants as finalizer-before-recovery regressions.

### CR-03: The runner-result digest is a hash of hardcoded expected success, not actual output

**Classification:** BLOCKER

**File:** `scripts/outreach-feasibility/residue-check.mjs:2343-2377`, `scripts/outreach-feasibility/residue-check.mjs:2430-2459`, `scripts/outreach-feasibility/residue-check.mjs:2494-2615`, `scripts/outreach-feasibility/residue-check.mjs:2678-2721`

**Issue:** The exact file inventory, count, source tree, and artifact anchors are now checked, but `PHASE_5_OFFLINE_RUNNER_RESULT_SHA256` is computed from a hardcoded object that already says 242 passed and zero failed. Neither the builder nor validator executes the tests or consumes runner output. In an isolated repository, a source snapshot containing a top-level throw in `adversarial-regression.test.mjs` passed `assertCompleteVerificationDocument()` as complete; running that claimed test then failed with 0 passed and 1 failed. The new digest is still a forgeable self-attestation.

**Fix:** Bind verification to output produced by an actual invocation at the claimed source snapshot: run the canonical command in an isolated checkout and parse machine-readable `node:test` output, or verify an externally authenticated runner attestation whose payload includes the source tree and per-file blobs. Add the deliberately failing-test snapshot as a negative regression.

### CR-04: The fresh evidence rebind breaks the required offline suite

**Classification:** BLOCKER

**File:** `scripts/outreach-feasibility/evidence-integrity.test.mjs:83-95`, `scripts/outreach-feasibility/residue-check.test.mjs:210-245`, `scripts/outreach-feasibility/residue-check.test.mjs:1276-1289`, `scripts/outreach-feasibility/terminal-audit.test.mjs:1189-1204`

**Issue:** The rebind changes `source_snapshot.head_sha` to `20bc038`, whose residue is already schema v4. Three fixture helpers still treat that SHA as the immutable schema-v3 lineage and assert `schema_version === 3`; this cascades through most residue and terminal tests. The shared-worktree suite therefore finishes 210/242. A clean clone finishes 209/242 because the verification test also reads untracked `.planning/phases/05-outreach-feasibility-gate/05-VERIFICATION.md`, which is absent from a checkout. The implementation cannot truthfully embed or validate a 242-pass runner result in its current committed state.

**Fix:** Resolve the immutable v3 artifact by walking the evidence history to the actual schema-v3 commit instead of dereferencing the current v4 source snapshot. Update terminal fixtures for the rebound topology, and commit the source-gaps verification artifact or construct it deterministically inside the test. Require the exact suite to pass in a clean clone before publishing passed verification.

---

_Reviewed: 2026-07-31T02:25:54Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_

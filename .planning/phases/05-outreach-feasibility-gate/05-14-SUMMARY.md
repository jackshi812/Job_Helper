---
phase: 05-outreach-feasibility-gate
plan: 14
subsystem: security
tags: [openssh, sshsig, ed25519, trust-anchor, canonical-json]

requires:
  - phase: 05-11
    provides: structurally inert dormant spike runner
  - phase: 05-12
    provides: canonical evidence integrity and rollback-safe publication
  - phase: 05-13
    provides: canonical review lifecycle enforcement
provides:
  - explicit integrity-only validation for the historical owner receipt
  - pinned public ED25519 owner trust material under the reviewable source tree
  - canonical fresh authorization request builder and strict OpenSSH SSHSIG verifier
affects: [05-15, 05-16, 05-17, 05-18, 05-19]

tech-stack:
  added: [system OpenSSH ssh-keygen]
  patterns:
    - finite canonical JSON plus one LF as byte-exact signing input
    - public trust artifacts pinned by identity, key bytes, fingerprint, provenance, time, and revocation state
    - detached SSHSIG verification through an absolute system binary with exact stdout and empty-stderr enforcement

key-files:
  created:
    - scripts/outreach-feasibility/owner-authorization.mjs
    - scripts/outreach-feasibility/owner-authorization.test.mjs
    - scripts/outreach-feasibility/trust/phase-05-owner.pub
    - scripts/outreach-feasibility/trust/phase-05-owner.allowed_signers.txt
    - scripts/outreach-feasibility/trust/owner-trust-anchor.json
  modified:
    - scripts/outreach-feasibility/owner-checkpoint.mjs
    - scripts/outreach-feasibility/owner-checkpoint.test.mjs

key-decisions:
  - "The schema-version-1 checkpoint remains byte- and lineage-valid but its canonical result is integrity_only with authenticated false."
  - "Fresh owner authorization is admitted only through the exact jackshi812 principal, job-copilot-phase-05-owner-v1 namespace, selected ED25519 public key, SHA-256 fingerprint, and active non-revoked trust anchor."
  - "Request and signature verification consume canonical raw bytes; semantic reserialization, alternate trust identities, extra armor, writable files, symlinks, and ambiguous ssh-keygen output fail closed."

patterns-established:
  - "Historical evidence boundary: compatibility callers may inspect the old receipt structurally, but only the new SSHSIG path can produce authenticated true."
  - "Owner proof boundary: public request, signature, key, and trust files are finite and reviewable; no production code generates a key or accesses private material."

requirements-completed: [OUTR-04, OUTR-05]

coverage:
  - id: D1
    description: The historical request/receipt chain remains structurally valid while its canonical API and CLI result is explicitly integrity-only and never authenticated.
    requirement: OUTR-04
    verification:
      - kind: unit
        ref: scripts/outreach-feasibility/owner-checkpoint.test.mjs#fully rehashed attacker-selected response bytes never authenticate
        status: pass
      - kind: unit
        ref: scripts/outreach-feasibility/owner-checkpoint.test.mjs#record mode preserves only byte-exact raw stdin and cannot overwrite
        status: pass
    human_judgment: false
  - id: D2
    description: The selected owner signer is pinned by exact public trust material and a canonical request/SSHSIG verifier rejects every tested identity, content, time, revocation, file, and armor variant.
    requirement: OUTR-05
    verification:
      - kind: integration
        ref: "env -u TAVILY_API_KEY GIT_OPTIONAL_LOCKS=0 node --test scripts/outreach-feasibility/owner-authorization.test.mjs scripts/outreach-feasibility/owner-checkpoint.test.mjs (15/15 pass)"
        status: pass
      - kind: integration
        ref: scripts/outreach-feasibility/owner-authorization.test.mjs#system OpenSSH success uses one unambiguous stdout line
        status: pass
    human_judgment: false

duration: 11min
completed: 2026-07-30
status: complete
---

# Phase 05 Plan 14: Pinned OpenSSH Owner Authorization Summary

**Historical self-hash evidence is explicitly non-authenticating, while fresh owner authority now requires a byte-exact ED25519 SSHSIG under pinned public identity and revocation metadata**

## Performance

- **Duration:** 11 min
- **Started:** 2026-07-30T15:22:36Z
- **Completed:** 2026-07-30T15:33:11Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Demoted the legacy schema-version-1 receipt to a canonical `integrity_only` result with `INTEGRITY_ONLY_NOT_AUTHENTICATED`, while retaining a structural compatibility export for existing lineage validators.
- Added exact review-visible public trust files for principal `jackshi812`, namespace `job-copilot-phase-05-owner-v1`, GitHub signing-key record `1081409`, and fingerprint `SHA256:FPrmyBVv+PxnI9UpEajtjjV3B4bQQqFcyL1duuN+IhI`.
- Added a finite canonical request builder and offline SSHSIG verifier that enforces exact raw bytes, nonce and seven-day time bounds, active/non-revoked trust, safe regular files, one armored signature, and unambiguous absolute `ssh-keygen` verification.
- Added adversarial coverage for rehashed historical bytes, wrong key/principal/namespace/payload, malformed armor, stale time, missing or substituted trust, unsafe permissions, and symlinks.

## Task Commits

Each TDD task was committed through a failing regression followed by its implementation:

1. **Task 1 RED: Integrity-only checkpoint regressions** - `83fa5a2` (test)
2. **Task 1 GREEN: Historical receipt demotion** - `4abb9f0` (fix)
3. **Task 2 RED: Owner SSHSIG regressions** - `7af5499` (test)
4. **Task 2 GREEN: Pinned owner SSHSIG verification** - `5a2780f` (feat)

## Files Created/Modified

- `scripts/outreach-feasibility/owner-checkpoint.mjs` - Canonical integrity-only result and non-authenticated CLI status for the historical receipt.
- `scripts/outreach-feasibility/owner-checkpoint.test.mjs` - Forged/rehashed historical evidence and explicit non-authentication regressions.
- `scripts/outreach-feasibility/owner-authorization.mjs` - Canonical request construction, trust validation, signature armor validation, and absolute OpenSSH verification.
- `scripts/outreach-feasibility/owner-authorization.test.mjs` - Offline request, trust, OpenSSH, file-safety, time, revocation, and adversarial signature matrix.
- `scripts/outreach-feasibility/trust/phase-05-owner.pub` - Exact selected public ED25519 key plus one LF.
- `scripts/outreach-feasibility/trust/phase-05-owner.allowed_signers.txt` - Sole allowed principal, namespace, and public key line plus one LF.
- `scripts/outreach-feasibility/trust/owner-trust-anchor.json` - Canonical public identity, GitHub record provenance, fingerprint, not-before, active state, and null revocation.

## Decisions Made

- The old receipt remains useful for exact structural lineage only. Its compatibility export returns the historical record for existing validators, but the canonical wrapper and CLI always state `authenticated: false`.
- Production owner verification hard-pins the selected identity in source and compares all reviewable trust artifacts before running OpenSSH. Tests use temporary keys only to exercise OpenSSH and rejection behavior; no alternate production identity path exists.
- Verification copies already validated public/signature bytes into a private temporary directory before invoking `/usr/bin/ssh-keygen`, eliminating mutable-path ambiguity during fingerprint and signature checks.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Known Stubs

None. The null revocation and redesign fields and zero effect counters are intentional fail-closed contract values, not unwired data.

## User Setup Required

None - Plan 05-15 will generate the public signing request, and Plan 05-16 retains the blocking owner-only signing action.

## Next Phase Readiness

- Plan 05-15 can exclusively create and re-open the canonical fresh authorization request through the new CLI.
- Plan 05-16 can accept only the detached public `.sig` artifact and verify it offline against the pinned trust files.
- Production outreach remains disabled. No provider call, network search, representative spike, accepted-evidence regeneration, signing action, code-review invocation, or authoritative terminal audit occurred.

## Self-Check: PASSED

- All seven source, test, and public trust files exist.
- Task commits `83fa5a2`, `4abb9f0`, `7af5499`, and `5a2780f` are reachable.
- Task 1 verification passes 7/7; combined Plan 05-14 verification passes 15/15 with `TAVILY_API_KEY` unset.
- The public key fingerprint is exactly `SHA256:FPrmyBVv+PxnI9UpEajtjjV3B4bQQqFcyL1duuN+IhI`, and both line-oriented trust files contain exactly one trailing LF.
- The committed historical request/receipt and accepted decision/residue artifacts are unchanged from the Plan 05-14 starting commit.
- No tracked file deletion occurred in the Plan 05-14 commit range.

---
*Phase: 05-outreach-feasibility-gate*
*Completed: 2026-07-30*

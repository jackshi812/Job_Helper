---
phase: 04-application-tracker
plan: 02
subsystem: production-approval
tags: [supabase, postgres, rls, preflight, approval, hosted-verification]
requires:
  - phase: 04-01
    provides: Local tracker migration 0053, browser contracts, and migration tests
provides:
  - Checksum-bound read-only production preflight for the sole pending tracker migration
  - Fail-closed catalog and two-user behavior verifier contracts with bounded fixture authority
  - Exact owner approval for Plan 04-03 to push 0053 and run catalog-before-behavior proof
affects: [04-03, production-schema, tracker-rls, hosted-verification]
tech-stack:
  added: []
  patterns:
    - Production approval binds target, bytes, remote inventory, dry-run output, fixture lineage, and cleanup scope
    - Hosted behavior proof cannot seed until checksum-identical catalog parity passes
key-files:
  created:
    - scripts/verify-tracker-schema.ts
    - scripts/verify-tracker-rls.ts
    - web/tests/verify-tracker-schema.test.ts
    - web/tests/verify-tracker-rls.test.ts
    - .planning/phases/04-application-tracker/04-02-PREFLIGHT.md
  modified: []
key-decisions:
  - "Owner approved only checksum-identical migration 0053, catalog-before-behavior verification, and the manifest-bound disposable two-user proof for target fjcsvajkkztvlrpdplwx."
  - "Plan 04-02 records authority for Plan 04-03 but performs no schema push, service-role key reveal, hosted fixture creation, or production data mutation."
requirements-completed: [TRAK-01, TRAK-02, TRAK-03, TRAK-04]
coverage:
  - id: D1
    description: "The owner received and approved an exact target-, checksum-, dry-run-, fixture-, and cleanup-bound production action."
    requirement: TRAK-01
    verification:
      - kind: manual_procedural
        ref: "Exact owner approval signal recorded in this summary"
        status: pass
    human_judgment: true
  - id: D2
    description: "Catalog and behavior tooling fail closed on schema, ACL, RPC, fixture-lineage, isolation, and cleanup drift."
    requirement: TRAK-02
    verification:
      - kind: unit
        ref: "web/tests/verify-tracker-schema.test.ts and web/tests/verify-tracker-rls.test.ts"
        status: pass
    human_judgment: false
duration: 14min
completed: 2026-07-27
status: complete
---

# Phase 04 Plan 02: Checksum-Bound Tracker Production Approval Summary

**Read-only tracker preflight with exact catalog/RLS verifier hashes, bounded runtime lineage, and owner approval for a later single-migration hosted proof**

## Performance

- **Duration:** 14 min
- **Started:** 2026-07-28T03:38:41Z
- **Completed:** 2026-07-28T03:52:47Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added dependency-free schema and behavior verifiers that bind hosted proof to migration 0053, exact catalog/ACL/function parity, two independent publishable-key sessions, and a manifest-bounded privileged fixture controller.
- Produced a sanitized preflight for linked project `fjcsvajkkztvlrpdplwx`, remote migrations `0001` through `0052`, and sole pending `0053_application_tracker.sql`.
- Recomputed the complete approval envelope after the checkpoint: target, migration/verifier/test/fixture hashes, remote migration list, legacy baseline, fixture IDs/counts/lineage rules, and dry-run digest all matched exactly with an empty scoped dirty inventory.
- Accepted the owner's exact approval for Plan 04-03 while keeping this plan read-only: no push, service-role key reveal, hosted fixture creation, or production data mutation occurred.

## Task Commits

1. **Task 1 RED: Add failing tracker verifier contracts** — `d504dbc` (test)
2. **Task 1 GREEN: Add checksum-bound tracker preflight and verifiers** — `d18c1b4` (feat)
3. **Task 1 fix: Preserve scoped preflight path inventory** — `ef652be` (fix)
4. **Task 1 freeze: Seal the exact approval inventory** — `704fb59` (docs)
5. **Task 2: Approve the exact migration 0053 push and bounded hosted proof** — exact owner decision recorded below; no implementation file changed

## Approval Record

The owner supplied the exact preflight signal:

`approve Phase 04 tracker schema push target=fjcsvajkkztvlrpdplwx migration_sha256=7da3c2215eb00fbee410388b79ce5dddf2e589ad9f176ad3d31c7f543ed923c0 schema_verifier_sha256=e1a9bd1b0f2f8548e34fb42221174e82f28006977e35a2931c3110120983ddee behavior_verifier_sha256=2dede3082e76f33e4b6dcf79848a40140a4ee47d37b7044965f8b182962a531b fixture_manifest_sha256=7d8f88ab8c94670fc6925c7899197a1f891dc987b5d6091f3f047bf75155864a dry_run_sha256=e32e39fd02966bfd4003a2cfda24ac0723ff7b0cc0d1f8a887f57279e4c8ac33`

This authorizes only Plan 04-03's checksum-identical `db push --linked --yes` to the named target, immediate catalog/ACL assertion, and—only after catalog PASS—the manifest-bound disposable two-user behavior proof. It does not authorize any other migration, reset, repair, ad hoc SQL, package installation, function/web deployment, provider call, polling, AI/resume generation, real-user mutation, credential persistence, or credential/user-content logging.

## Immutable Recheck

- Migration SHA-256: `7da3c2215eb00fbee410388b79ce5dddf2e589ad9f176ad3d31c7f543ed923c0`
- Schema verifier SHA-256: `e1a9bd1b0f2f8548e34fb42221174e82f28006977e35a2931c3110120983ddee`
- Behavior verifier SHA-256: `2dede3082e76f33e4b6dcf79848a40140a4ee47d37b7044965f8b182962a531b`
- Fixture manifest SHA-256: `7d8f88ab8c94670fc6925c7899197a1f891dc987b5d6091f3f047bf75155864a`
- Dry-run SHA-256: `e32e39fd02966bfd4003a2cfda24ac0723ff7b0cc0d1f8a887f57279e4c8ac33`
- Linked target: `fjcsvajkkztvlrpdplwx`
- Remote tail: `0050, 0051, 0052`
- Sole pending migration: `0053_application_tracker.sql`
- Legacy applied baseline: `0`, digest `350881a01e5ccbc5a4fd5ea7e29183793ca2f414d000dcc343cea07616047eba`
- Fixture namespace/counts/lineage rules: byte-for-byte equivalent to the approved machine contract
- Scoped dirty inventory: empty

The repository-level `.DS_Store`, Phase 03.8 `.gitkeep`, `scripts/agent-dashboard.mjs`, `scripts/agent-dashboard.test.mjs`, and `web/zh` remained excluded and unstaged.

## Files Created/Modified

- `scripts/verify-tracker-schema.ts` — read-only preflight and hosted catalog/ACL/backfill parity verifier.
- `scripts/verify-tracker-rls.ts` — fixture-manifest controller, two-session behavior/RLS proof, runtime lineage, and zero-residue cleanup.
- `web/tests/verify-tracker-schema.test.ts` — catalog, canonical parity, redaction, ordering, and drift contracts.
- `web/tests/verify-tracker-rls.test.ts` — authority, isolation, lineage, source-removal, and cleanup contracts.
- `.planning/phases/04-application-tracker/04-02-PREFLIGHT.md` — sanitized exact target, hashes, effects, commands, fixture bounds, cleanup, exclusions, and approval signal.

## Decisions Made

- Bound approval to the exact target, five source/test digests, fixture-manifest digest, remote migration list, sole-pending dry run, legacy baseline, runtime lineage rules/counts, and catalog-before-behavior ordering.
- Kept the approval checkpoint non-mutating. Plan 04-03 must recompute the same envelope before it may push 0053 or construct hosted fixture authority.
- Preserved unrelated user-owned dirty and untracked files without staging or modifying them.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Preserved the preflight output path outside scoped dirty inventory**

- **Found during:** Task 1 verification
- **Issue:** Regenerating the preflight could report its own output path as scoped dirt and make a clean approval envelope unstable.
- **Fix:** Excluded the declared output path from the sanitized scoped inventory while retaining every other in-scope change.
- **Files modified:** `scripts/verify-tracker-schema.ts`, `.planning/phases/04-application-tracker/04-02-PREFLIGHT.md`
- **Verification:** Fresh preflight reported an empty scoped inventory and identical approval-bound values.
- **Commit:** `ef652be`

---

**2. [Rule 1 - Bug] Corrected stale progress values after state advancement**

- **Found during:** Plan closeout
- **Issue:** The state SDK reported 84/86 plans and 98% but left inconsistent 93% frontmatter and a 97% body bar.
- **Fix:** Aligned both persisted progress values with the SDK's recalculated 84/86 result.
- **Files modified:** `.planning/STATE.md`
- **Verification:** STATE frontmatter and body both report 98%.
- **Commit:** Plan metadata commit

---

**Total deviations:** 2 auto-fixed issues (1 Rule 3 blocking, 1 Rule 1 tracking bug).
**Impact on plan:** The fixes made repeated read-only preflight generation stable and kept plan tracking internally consistent without weakening drift detection or widening production authority.

## Authentication Gates

None. The existing environment supported the read-only linked preflight. No service-role key was requested or revealed.

## Issues Encountered

The sandbox initially blocked the Supabase CLI telemetry write under the user profile. The same read-only preflight was rerun through the approved external execution boundary and passed; no project configuration or hosted state changed.

## Verification

- Prior commits `d504dbc`, `d18c1b4`, `ef652be`, and `704fb59` exist and contain the expected Task 1 artifacts.
- Task 2 focused gate passed: 3 test files, 18 tests, and `git diff --check`.
- Fresh read-only linked preflight passed with target `fjcsvajkkztvlrpdplwx`, sole pending `0053_application_tracker.sql`, and the approved dry-run digest.
- Direct SHA-256 checks for migration, both verifiers, and both verifier tests matched the preflight.
- Fixture contract mode reproduced the approved manifest digest, namespace, expected counts, and runtime lineage contract.
- Stub scan found no goal-blocking placeholder or unwired empty-data path.
- Threat-surface scan found only the catalog, ephemeral credential, privileged fixture, ordinary-session isolation, and evidence boundaries already enumerated in the plan threat model.

## User Setup Required

None for Plan 04-02. Plan 04-03 owns any later production push and hosted proof under the recorded approval.

## Next Phase Readiness

- Plan 04-03 is authorized to recompute the immutable envelope and, only on an exact match, push migration 0053.
- Catalog/ACL parity must pass before the behavior verifier may discover ephemeral service-role authority or seed fixtures.
- Plan 04-02 itself left production unchanged and created no reusable credential or hosted residue.

## Self-Check: PASSED

- All five key artifacts exist.
- All four Task 1 commits exist in Git history.
- The exact owner signal matches the current preflight approval signal.
- Read-only target, remote inventory, dry run, hashes, fixture counts, and lineage rules matched after the checkpoint.
- No scoped source changes remain, and excluded unrelated files remain unstaged.

---
*Phase: 04-application-tracker*
*Completed: 2026-07-27*

---
phase: 04-application-tracker
plan: 03
subsystem: production-schema-security
tags: [supabase, postgres, rls, tracker, hosted-verification, cleanup]
requires:
  - phase: 04-02
    provides: Checksum-bound migration and hosted verifier approval contract
provides:
  - Production tracker schema through migrations 0053–0055
  - Hosted catalog, ACL, RLS, function, and backfill parity evidence
  - Two-ordinary-session tracker behavior and isolation proof
  - Exact cleanup recovery with independent zero-residue evidence
affects: [04-04, 04-05, application-tracker, dashboard-applied]
tech-stack:
  added: []
  patterns:
    - Forward-only production repair migrations preserve deployed history
    - Hosted behavior evidence combines ordinary-session assertions with manifest-bound privileged setup and cleanup
    - Auth gateway timeouts require exact-ID absence plus independent relation audits
key-files:
  created:
    - supabase/migrations/0054_mark_job_applied_ambiguity.sql
    - supabase/migrations/0055_tracker_behavior_and_cleanup.sql
    - web/tests/migration-0054-tracker-rpc-repair.test.ts
    - web/tests/migration-0055-tracker-behavior-repair.test.ts
    - .planning/phases/04-application-tracker/04-03-CATALOG-EVIDENCE.json
    - .planning/phases/04-application-tracker/04-03-RLS-EVIDENCE.json
  modified:
    - scripts/verify-tracker-schema.ts
    - scripts/verify-tracker-rls.ts
    - web/tests/verify-tracker-schema.test.ts
    - web/tests/verify-tracker-rls.test.ts
    - .planning/phases/04-application-tracker/04-03-SCHEMA-EVIDENCE.md
key-decisions:
  - "Repair every hosted defect through a new forward migration; never rewrite deployed migration 0053."
  - "Reject stale cleanup approval when background ranking inventory changes, then authorize only a hard 1..64 pending/completed-only bound."
  - "Accept the completed behavior proof only after exact-manifest Auth fallback, two exact 404 reads, and independent zero counts across every approved relation."
requirements-completed: [TRAK-01, TRAK-02, TRAK-03, TRAK-04]
duration: multi-session
completed: 2026-07-28
status: complete
---

# Phase 04 Plan 03: Hosted Tracker Schema and Behavior Summary

**Production now runs the complete tracker schema with exact catalog parity,
two-user ordinary-session isolation, critical lifecycle behavior, and zero
disposable-fixture residue.**

## Accomplishments

- Applied exact owner-approved migrations 0053, 0054, and 0055 to linked
  project `fjcsvajkkztvlrpdplwx`; independent migration inventory is exact
  through 0055.
- Proved both tracker tables, 24 columns, 11 constraints, 9 indexes, 1
  projection trigger, 12 functions, 2 policies, table/column/routine ACLs,
  RLS ownership, and zero backfill drift against hosted catalogs.
- Proved through two independent ordinary sessions:
  - idempotent Mark Applied for both owners;
  - six-argument manual creation and nonblocking duplicate warning;
  - cross-owner table, pin, and resume isolation;
  - resume link deletion behavior;
  - exact eight-column Dashboard projection;
  - earliest Applied date stability after a repeated Applied event;
  - final-event deletion rejection;
  - snapshot survival after the source job/user-job lineage is removed.
- Derived exactly 4 applications and 5 events into memory-only verified
  lineage, removed exactly 1 source row, and cleaned all public fixtures in
  application-first FK order.
- Recovered the known Auth Admin timeout with an exact-manifest SQL fallback,
  then proved both disposable users return 404 and all required public, Auth,
  fake-job, ranking, and storage residue counts are zero.

## Production Repairs

### Migration 0054 — Mark Applied ambiguity

The first complete hosted fixture reached `mark_job_applied(uuid)` and exposed
PostgreSQL `42702`: the PL/pgSQL variable `application_id` collided with a
column name. Migration 0054 replaces only that function and uses the
unambiguous `target_application_id`.

### Migration 0055 — Dashboard invocation and cleanup cascade

The repaired Mark Applied path passed, then Dashboard exposed PostgreSQL
`42501`: the security-invoker projection called an internal helper whose
execute privilege is intentionally revoked. Migration 0055 inlines the same
HTTPS expression without widening helper authority.

The same migration permits final-event removal only after the parent
application is gone, preserving ordinary final-event rejection while making
application-first cleanup cascade correctly.

During failed-proof cleanup, a background ranker observed the temporary open
fake job. The first exact-three-item cleanup approval was invalidated when the
mandatory pre-push audit found nine items; no mutation ran. The final migration
closes the exact fake job first and accepts only one pending zero-attempt
projection with 1–64 pending/completed items, zero claimed/failed items, and
one distinct run per item. It removed 11 completed items and preserved the
real Auth account and every ranking-run record.

## Verification Evidence

- Focused contract gate: 3 files, 21 tests — PASS
- Complete suite: 73 files, 1,486 tests — PASS
- Production build — PASS
- Lint — PASS with two pre-existing warnings
- Hosted catalog evidence:
  `8ee9400b4f8a2b6936dd5fa36b706051df701c642e910a30bbf65719f5e12991`
- Hosted catalog inventory:
  `50d48091d143e9314cd4cf3dfe76f9ae7f58566adb2468413d411d5bdb831f78`
- Recovered behavior evidence:
  `9741a8a3aa2c5292f97d853d714cf4f2d7998b8c1442204dc5beab1440b07e9b`
- Exact Auth absence: 2/2 Admin reads returned 404
- Final residue: zero across seven required relations plus storage and all
  fake-job projections

## Task Commits

Key RED/GREEN checkpoints:

1. Catalog contract repair — `5418025` / `c9718d2`
2. Safe step diagnostics — `26d0c52` / `c7d7473`
3. Complete company fixture identity — `e721b96` / `7450faf`
4. Bounded remote failure retention — `0031a1a` / `64d5df5`
5. Mark Applied forward repair — `9a90ab2` / `62e9783`
6. Dashboard/cascade cleanup repair — `697f61c` / `60c9004`
7. Bounded ranking-drift cleanup — `850cff7` / `4618c56`
8. Post-push bounded schema contract — `19b37c3` / `ed44254`
9. Redaction-safe evidence label — `3c4b45f` / `8214735`

## Deviations from Plan

### Auto-fixed issues

**1. Hosted catalog expectations differed from the real PostgreSQL catalog**

- Replaced nonexistent constraint expectations with the actual reviewed
  constraint and canonical function-signature inventory.
- Verified the corrected inspector before any behavior fixture was seeded.

**2. Hosted failures were initially opaque**

- Added static allowlisted step labels, elapsed timing, bounded database codes,
  and preservation of the first proof failure without retaining content,
  identifiers, endpoints, or credentials.

**3. Two forward migrations were required**

- Migration 0054 fixed `mark_job_applied` ambiguity.
- Migration 0055 fixed Dashboard invoker safety, cleanup cascade order, and the
  audited fake-job contamination.

**4. Background ranking inventory changed while approval was pending**

- Refused the stale approval before mutation.
- Replaced the unstable exact count with a hard, state-constrained 1–64 guard.

**5. Auth Admin deletion timed out after all behavior passed**

- The original verifier exited fail-closed and produced no false PASS.
- The already approved exact-manifest fallback deleted only the two disposable
  users after proving zero public/storage residue.
- Independent 404 and relation audits established final cleanup PASS.

**6. Evidence output used a self-forbidden label**

- Renamed `service_role_memory_only` to `privileged_key_memory_only` so the
  evidence redaction scan no longer rejects its own sanitized field name.

## Security and Authority

- No credential, endpoint, Auth/application/event UUID, email, note, resume
  data, or job description is retained in evidence.
- Service authority stayed memory-only.
- All product behavior assertions used ordinary publishable-key sessions.
- Privileged mutations were restricted to manifest identities, verified
  parents, fixture namespace, runtime lineage, and exact counts.
- No real-user row or ranking-run record was removed.

## User Setup Required

None.

## Next Plan Readiness

- Plan 04-04 may now build the complete spreadsheet Tracker, manual capture,
  timeline, notes, JD, and optional resume experience on the verified hosted
  foundation.
- Plan 04-05 remains queued for durable Dashboard Mark Applied, seven-column
  Show applied, and safe Tracker focus routing.

## Self-Check: PASSED

- Remote migrations are exact through 0055.
- Catalog and behavior evidence exist with reproducible digests.
- Both exact disposable Auth users are absent.
- All approved fixture, fake-job, ranking-item, and storage residue is zero.
- Unrelated user-owned worktree paths remain unstaged.

---
*Phase: 04-application-tracker*
*Completed: 2026-07-28*

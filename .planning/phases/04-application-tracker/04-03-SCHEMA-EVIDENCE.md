# Phase 04 Plan 03 Hosted Tracker Schema Evidence

**Status:** PASS — migrations 0053–0055, hosted catalogs, ordinary-session
behavior, exceptional cleanup recovery, and zero residue are verified.

## Deployed identity

- Linked project: `fjcsvajkkztvlrpdplwx`
- Source commit: `ed44254b80dc6ed73b36e6ceace52030c82be044`
- Installed migration tail: `0053`, `0054`, `0055`
- Migration 0053 SHA-256: `7da3c2215eb00fbee410388b79ce5dddf2e589ad9f176ad3d31c7f543ed923c0`
- Migration 0054 SHA-256: `111fc68f01dd0658cd2536c4fb6abfd99ba25179e70b98ef158e3ab22753a5c3`
- Migration 0055 SHA-256: `d468c3b6dd019006bd856001eed6209a3547072c9091ad3b101125ee33267bf3`
- Schema verifier SHA-256: `3d2d22852dc8543e66bd7df556acff1f0d121a602cc17d6731f4920c6ae57e2e`
- Behavior verifier SHA-256: `721a25b8d193ada2b3a6a69866e710a3d7dcf2943abdd285f9fb0ce038e0f7ea`
- Migration 0055 test SHA-256: `4595b6d8308348306dffb79e55f446ed80b66ba95c68a048b0cf845e28b1fe30`
- Schema verifier test SHA-256: `2648306b1bd072ee1745dbae2e92a97e36476d12cbf7cb1fb8bd40245023a078`
- Behavior verifier test SHA-256: `35fe8e9a0d2b5892a0b51680c8213040fdbdaf316086f57173786cf454c9efd1`
- Fixture manifest SHA-256: `8f49236a3704e970a274d64ecc060cea2b9bc54d07cd8741789104f906fd8a77`
- Catalog evidence SHA-256: `8ee9400b4f8a2b6936dd5fa36b706051df701c642e910a30bbf65719f5e12991`
- Hosted catalog SHA-256: `50d48091d143e9314cd4cf3dfe76f9ae7f58566adb2468413d411d5bdb831f78`
- Behavior scope SHA-256: `988269a1fff0f185794f568dcfe1ee7772b21dab624f2104cb2aa3f1910fc941`
- Catalog checked at: `2026-07-28T15:59:09.724Z`
- Scoped source dirty inventory: empty

## Migration 0055 result

The exact owner-approved migration push installed only
`0055_tracker_behavior_and_cleanup.sql`. The CLI emitted an optional local
Docker catalog-cache warning after the database migration completed; the
independent linked migration inventory confirms exact remote order through
0055.

The migration:

1. Keeps ordinary final-event deletion rejected while allowing the event
   cascade after its parent application is removed.
2. Keeps `dashboard_applied_applications()` security-invoker safe without
   granting authenticated execute on the internal URL helper.
3. Closed and removed the exact fake job/company and removed one
   background-created projection plus its 11 completed ranking items.
4. Preserved the real Auth account and every ranking-run record.

Post-push audits are zero across fixture Auth users, applications, events,
manifest user-jobs, all fake-job user-jobs, resumes, fake job/company, and
storage. A separate lineage audit found zero remaining projection, ranking
item, application, or scoring-maintenance references.

The first post-push schema-verifier attempt stopped locally because its static
0055 contract still expected the superseded three-item inventory. No hosted
catalog query or mutation ran. RED `19b37c3` and GREEN `ed44254` bind that
contract to the deployed `1..64` pending/completed-only guard. The focused
3-file/21-test gate, complete 73-file/1,486-test suite, production build, and
lint all pass; lint retains only two pre-existing warnings.

## Read-only hosted catalog proof

- Catalog verifier result: PASS
- Tables: `2`; columns: `24`; constraints: `11`; indexes: `9`
- Triggers: `1`; functions: `12`; policies: `2`
- Required tracker policies: `applications_select_own`,
  `application_stage_events_select_own`
- Tracker table ACL: authenticated `SELECT` only
- Tracker column ACL: authenticated `SELECT` only across 24 columns
- Narrow authenticated routine ACLs: `10`
- Both tracker tables: RLS enabled; owner `postgres`
- All 12 reviewed functions: empty search path and expected security mode
- Legacy applied rows: `0`; system applications/events: `0`
- Missing application/event backfill rows: `0`

The full sanitized catalog inventory is retained in
`04-03-CATALOG-EVIDENCE.json`. It contains only object names, booleans, counts,
versions, privilege labels, and SHA-256 values.

The behavior scope digest is the canonical sorted-key SHA-256 of the current
contract mode's `fixture_manifest_sha256`, `expected_counts`, `lineage_rules`,
`zero_residue_relations`, and `diagnostics` fields.

## Ordinary-session behavior and cleanup proof

The owner supplied the exact signal below. The approved verifier then:

1. Revalidated every source/catalog/scope digest, exact remote order through
   0055, and the zero-residue baseline.
2. Seeded exactly 2 disposable Auth users, 1 closed fake company/job lineage,
   2 user-job rows, and 2 resume rows.
3. Used two independent ordinary sessions to pass Mark Applied idempotency,
   manual creation/duplicate warning, cross-owner isolation, resume behavior,
   Dashboard before/after projection, earliest-Applied stability, repeated
   stages, final-event rejection, and source-loss snapshot survival.
4. Derived exactly 4 application IDs and 5 event IDs into its memory-only
   verified lineage and removed exactly 1 manifest-bound source row.
5. Removed every public fixture through application-first FK-safe cleanup.

The Auth Admin deletion transport timed out at `cleanup.auth.delete.b` after
30,004 ms, so the original command exited fail-closed and wrote no misleading
PASS. The approved exact-manifest SQL fallback then required both fixture
identities plus zero public/storage residue and deleted exactly 2 Auth users.
Independent reads returned 404 for both exact users, and a separate database
audit returned zero across all seven required relations plus storage and all
fake-job user-jobs.

Recovered sanitized evidence is in `04-03-RLS-EVIDENCE.json`, digest
`9741a8a3aa2c5292f97d853d714cf4f2d7998b8c1442204dc5beab1440b07e9b`.
It explicitly records the timeout and recovery rather than representing the
original command as a clean exit.

Closeout also found that the verifier's evidence key
`service_role_memory_only` matched its own forbidden-label scanner. RED
`3c4b45f` and GREEN `8214735` renamed that emitted key to
`privileged_key_memory_only`; this is an evidence-only local repair made after
the completed hosted proof.

## Consumed approval signal

`approve Phase 04 tracker behavior verification target=fjcsvajkkztvlrpdplwx source_commit=ed44254b80dc6ed73b36e6ceace52030c82be044 migration_sha256=7da3c2215eb00fbee410388b79ce5dddf2e589ad9f176ad3d31c7f543ed923c0 repair_migration_sha256=111fc68f01dd0658cd2536c4fb6abfd99ba25179e70b98ef158e3ab22753a5c3 behavior_repair_migration_sha256=d468c3b6dd019006bd856001eed6209a3547072c9091ad3b101125ee33267bf3 schema_verifier_sha256=3d2d22852dc8543e66bd7df556acff1f0d121a602cc17d6731f4920c6ae57e2e behavior_verifier_sha256=721a25b8d193ada2b3a6a69866e710a3d7dcf2943abdd285f9fb0ce038e0f7ea repair_test_sha256=4595b6d8308348306dffb79e55f446ed80b66ba95c68a048b0cf845e28b1fe30 schema_test_sha256=2648306b1bd072ee1745dbae2e92a97e36476d12cbf7cb1fb8bd40245023a078 behavior_test_sha256=35fe8e9a0d2b5892a0b51680c8213040fdbdaf316086f57173786cf454c9efd1 fixture_manifest_sha256=8f49236a3704e970a274d64ecc060cea2b9bc54d07cd8741789104f906fd8a77 catalog_evidence_sha256=8ee9400b4f8a2b6936dd5fa36b706051df701c642e910a30bbf65719f5e12991 behavior_scope_sha256=988269a1fff0f185794f568dcfe1ee7772b21dab624f2104cb2aa3f1910fc941 auth_users=2 companies=1 jobs=1 user_jobs=2 resumes=2 runtime_applications=4 runtime_events=5 source_rows_removed=1 cleanup_relations=7`

Replying `defer Phase 04 tracker behavior verification` performs no hosted
fixture mutation.

This exact approval was consumed on 2026-07-28.

<!-- tracker-preflight-json
{
  "status": "PASS",
  "created_at": "2026-07-28T15:59:09.724Z",
  "project_ref": "fjcsvajkkztvlrpdplwx",
  "source_commit": "ed44254b80dc6ed73b36e6ceace52030c82be044",
  "scoped_source_dirty_inventory": [],
  "migration": "supabase/migrations/0053_application_tracker.sql",
  "migration_sha256": "7da3c2215eb00fbee410388b79ce5dddf2e589ad9f176ad3d31c7f543ed923c0",
  "repair_migration_sha256": "111fc68f01dd0658cd2536c4fb6abfd99ba25179e70b98ef158e3ab22753a5c3",
  "behavior_repair_migration_sha256": "d468c3b6dd019006bd856001eed6209a3547072c9091ad3b101125ee33267bf3",
  "schema_verifier_sha256": "3d2d22852dc8543e66bd7df556acff1f0d121a602cc17d6731f4920c6ae57e2e",
  "behavior_verifier_sha256": "721a25b8d193ada2b3a6a69866e710a3d7dcf2943abdd285f9fb0ce038e0f7ea",
  "schema_test_sha256": "2648306b1bd072ee1745dbae2e92a97e36476d12cbf7cb1fb8bd40245023a078",
  "behavior_test_sha256": "35fe8e9a0d2b5892a0b51680c8213040fdbdaf316086f57173786cf454c9efd1",
  "repair_test_sha256": "4595b6d8308348306dffb79e55f446ed80b66ba95c68a048b0cf845e28b1fe30",
  "fixture_manifest_sha256": "8f49236a3704e970a274d64ecc060cea2b9bc54d07cd8741789104f906fd8a77",
  "catalog_evidence_sha256": "8ee9400b4f8a2b6936dd5fa36b706051df701c642e910a30bbf65719f5e12991",
  "hosted_catalog_sha256": "50d48091d143e9314cd4cf3dfe76f9ae7f58566adb2468413d411d5bdb831f78",
  "behavior_scope_sha256": "988269a1fff0f185794f568dcfe1ee7772b21dab624f2104cb2aa3f1910fc941",
  "remote_migration_tail": ["0052", "0053", "0054", "0055"],
  "installed_migration": "0055_tracker_behavior_and_cleanup.sql",
  "legacy_applied_count": 0,
  "expected_counts": {
    "auth_users": 2,
    "companies": 1,
    "jobs": 1,
    "user_jobs_seeded": 2,
    "resumes_seeded": 2,
    "applications": 4,
    "application_stage_events": 5,
    "source_rows_removed_during_proof": 1,
    "cleanup_relations": 7
  },
  "lineage_rules": [
    "runtime application IDs enter the memory-only lineage allowlist only after exact owner, origin/source parent or manual namespace, and exact expected count verification",
    "runtime event IDs enter the memory-only lineage allowlist only through an approved application plus exact owner, parent, fixture namespace, and exact expected count verification",
    "every privileged removal requires exact owner, verified parent, fixture namespace, memory-only lineage membership, and exact expected count"
  ],
  "zero_residue_relations": [
    "public.application_stage_events",
    "public.applications",
    "public.user_jobs",
    "public.resumes",
    "public.jobs",
    "public.companies",
    "auth.users"
  ],
  "approval_signal": "approve Phase 04 tracker behavior verification target=fjcsvajkkztvlrpdplwx source_commit=ed44254b80dc6ed73b36e6ceace52030c82be044 migration_sha256=7da3c2215eb00fbee410388b79ce5dddf2e589ad9f176ad3d31c7f543ed923c0 repair_migration_sha256=111fc68f01dd0658cd2536c4fb6abfd99ba25179e70b98ef158e3ab22753a5c3 behavior_repair_migration_sha256=d468c3b6dd019006bd856001eed6209a3547072c9091ad3b101125ee33267bf3 schema_verifier_sha256=3d2d22852dc8543e66bd7df556acff1f0d121a602cc17d6731f4920c6ae57e2e behavior_verifier_sha256=721a25b8d193ada2b3a6a69866e710a3d7dcf2943abdd285f9fb0ce038e0f7ea repair_test_sha256=4595b6d8308348306dffb79e55f446ed80b66ba95c68a048b0cf845e28b1fe30 schema_test_sha256=2648306b1bd072ee1745dbae2e92a97e36476d12cbf7cb1fb8bd40245023a078 behavior_test_sha256=35fe8e9a0d2b5892a0b51680c8213040fdbdaf316086f57173786cf454c9efd1 fixture_manifest_sha256=8f49236a3704e970a274d64ecc060cea2b9bc54d07cd8741789104f906fd8a77 catalog_evidence_sha256=8ee9400b4f8a2b6936dd5fa36b706051df701c642e910a30bbf65719f5e12991 behavior_scope_sha256=988269a1fff0f185794f568dcfe1ee7772b21dab624f2104cb2aa3f1910fc941 auth_users=2 companies=1 jobs=1 user_jobs=2 resumes=2 runtime_applications=4 runtime_events=5 source_rows_removed=1 cleanup_relations=7"
}
tracker-preflight-json -->

# Phase 04 Plan 03 Behavior and Cleanup Repair Preflight

**Status:** PASS — read-only inventory and dry run complete; production repair awaits exact approval.

## Failure and cleanup evidence

- The repaired `mark_job_applied(uuid)` passed first, repeat, and second-owner
  calls.
- Manual creation, lineage validation, cross-owner isolation, pin/resume
  rejection, resume link/delete, and post-delete resume nulling passed.
- `dashboard_applied_applications()` failed with PostgreSQL `42501` because
  its invoker body called `tracker_https_url_valid(text)`, whose execute
  privilege is intentionally revoked from authenticated users.
- Fixture-owner cleanup removed exactly 4 applications, 4 cascaded events,
  2 manifest `user_jobs`, 1 remaining resume, and 2 disposable Auth users.
  The projection trigger was disabled and reenabled only inside that atomic,
  exact-count cleanup transaction.
- Independent residue after that cleanup:
  `auth.users=0`, `applications=0`, `application_stage_events=0`,
  manifest `user_jobs=0`, `resumes=0`, `storage.objects=0`,
  fake `jobs=1`, fake `companies=1`.

The background scoring worker saw the temporary open fake job and created one
additional projection for the existing nonfixture account. The bounded audit
proved:

- unexpected nonfixture `user_jobs`: `1`
- projection state: pending, attempts `0`, not filtered/scored/failed
- owning Auth user exists and must be preserved
- nonfixture applications: `0`
- scoring-maintenance references: `0`
- deterministic ranking items tied to the fake job/projection: `3`
- ranking item states: completed `2`, pending `1`, claimed `0`, failed `0`
- distinct ranking runs: `3`, all preserved

## Approval-bound migration

- Linked project: `fjcsvajkkztvlrpdplwx`
- Source commit: `60c90040ee41f2e53af60be9ef0c0be80cc2c620`
- Installed migration tail: `0053`, `0054`
- Sole pending migration: `0055_tracker_behavior_and_cleanup.sql`
- Migration 0053 SHA-256: `7da3c2215eb00fbee410388b79ce5dddf2e589ad9f176ad3d31c7f543ed923c0`
- Migration 0054 SHA-256: `111fc68f01dd0658cd2536c4fb6abfd99ba25179e70b98ef158e3ab22753a5c3`
- Migration 0055 SHA-256: `c09321ff2fe5e24bedee7651e7d6bba2fa4a9976a0f4c74bde55a702bf559726`
- Schema verifier SHA-256: `0fc97edc6f959ea7df2d75d8513d283f99d14970ff8c52d332b1e14b27f27115`
- Behavior verifier SHA-256: `721a25b8d193ada2b3a6a69866e710a3d7dcf2943abdd285f9fb0ce038e0f7ea`
- Migration 0055 test SHA-256: `81c3a5709514207478ed4d415a2330904585ad70bad346098ba38e0ed0a05d07`
- Schema test SHA-256: `a7fa177cf583f8dfc94f8059c95ea3bd23a5de183a91abc319b6fb484d15dc15`
- Behavior test SHA-256: `35fe8e9a0d2b5892a0b51680c8213040fdbdaf316086f57173786cf454c9efd1`
- Dry-run SHA-256: `a4afc62e38abebcc31d4fcfc23a9d0e2a21754fe79df1de194307465b3746e03`
- Supabase CLI: `2.109.1`
- Scoped source dirty inventory: empty

The read-only command was:

`web/node_modules/.bin/supabase db push --linked --dry-run`

It proposed exactly `0055_tracker_behavior_and_cleanup.sql`. No mutation ran.

## Exact migration scope

Migration 0055:

1. Replaces `sync_application_stage_projection()` so ordinary final-event
   deletion remains rejected while an event cascade is allowed only after its
   exact parent application no longer exists.
2. Replaces `dashboard_applied_applications()` with the same eight-column,
   security-invoker contract and an inline HTTPS expression. It does not grant
   authenticated execute on the internal URL helper.
3. Atomically revalidates the residual inventory above, closes the exact fake
   job, deletes the one audited pending projection, requires exactly three
   ranking items to disappear through the existing FK cascade, and deletes the
   exact fake job/company.
4. Preserves the nonfixture Auth user, all preferences/resumes/applications,
   and all three ranking-run records.

The behavior verifier separately seeds future fake jobs as `closed`, deletes
applications before verifying event cascade, and binds migrations 0053–0055
into every later hosted proof.

Local verification is PASS: 3 focused files / 21 tests, 73 complete files /
1,486 tests, production build, lint with only two pre-existing warnings, and
repository diff check.

## Exact approval signal

`approve Phase 04 tracker behavior cleanup repair push target=fjcsvajkkztvlrpdplwx source_commit=60c90040ee41f2e53af60be9ef0c0be80cc2c620 repair_migration=0055_tracker_behavior_and_cleanup.sql migration_sha256=c09321ff2fe5e24bedee7651e7d6bba2fa4a9976a0f4c74bde55a702bf559726 schema_verifier_sha256=0fc97edc6f959ea7df2d75d8513d283f99d14970ff8c52d332b1e14b27f27115 behavior_verifier_sha256=721a25b8d193ada2b3a6a69866e710a3d7dcf2943abdd285f9fb0ce038e0f7ea repair_test_sha256=81c3a5709514207478ed4d415a2330904585ad70bad346098ba38e0ed0a05d07 schema_test_sha256=a7fa177cf583f8dfc94f8059c95ea3bd23a5de183a91abc319b6fb484d15dc15 behavior_test_sha256=35fe8e9a0d2b5892a0b51680c8213040fdbdaf316086f57173786cf454c9efd1 dry_run_sha256=a4afc62e38abebcc31d4fcfc23a9d0e2a21754fe79df1de194307465b3746e03 cleanup_nonfixture_user_jobs=1 cleanup_ranking_items=3 cleanup_jobs=1 cleanup_companies=1 preserve_auth_users=1 preserve_ranking_runs=3`

Replying `defer Phase 04 tracker behavior cleanup repair push` leaves the
isolated fake job/company/projection lineage in place and performs no schema
change.

<!-- tracker-behavior-repair-preflight-json
{
  "status": "PASS",
  "created_at": "2026-07-28T15:08:59Z",
  "project_ref": "fjcsvajkkztvlrpdplwx",
  "source_commit": "60c90040ee41f2e53af60be9ef0c0be80cc2c620",
  "repair_migration": "0055_tracker_behavior_and_cleanup.sql",
  "base_migration_sha256": "7da3c2215eb00fbee410388b79ce5dddf2e589ad9f176ad3d31c7f543ed923c0",
  "rpc_repair_migration_sha256": "111fc68f01dd0658cd2536c4fb6abfd99ba25179e70b98ef158e3ab22753a5c3",
  "behavior_repair_migration_sha256": "c09321ff2fe5e24bedee7651e7d6bba2fa4a9976a0f4c74bde55a702bf559726",
  "schema_verifier_sha256": "0fc97edc6f959ea7df2d75d8513d283f99d14970ff8c52d332b1e14b27f27115",
  "behavior_verifier_sha256": "721a25b8d193ada2b3a6a69866e710a3d7dcf2943abdd285f9fb0ce038e0f7ea",
  "repair_test_sha256": "81c3a5709514207478ed4d415a2330904585ad70bad346098ba38e0ed0a05d07",
  "schema_test_sha256": "a7fa177cf583f8dfc94f8059c95ea3bd23a5de183a91abc319b6fb484d15dc15",
  "behavior_test_sha256": "35fe8e9a0d2b5892a0b51680c8213040fdbdaf316086f57173786cf454c9efd1",
  "dry_run_sha256": "a4afc62e38abebcc31d4fcfc23a9d0e2a21754fe79df1de194307465b3746e03",
  "remote_migration_tail": ["0052", "0053", "0054"],
  "sole_pending_migration": "0055_tracker_behavior_and_cleanup.sql",
  "scoped_source_dirty_inventory": [],
  "cleanup": {
    "nonfixture_user_jobs": 1,
    "ranking_items": 3,
    "jobs": 1,
    "companies": 1
  },
  "preserve": {
    "auth_users": 1,
    "ranking_runs": 3
  },
  "approval_signal": "approve Phase 04 tracker behavior cleanup repair push target=fjcsvajkkztvlrpdplwx source_commit=60c90040ee41f2e53af60be9ef0c0be80cc2c620 repair_migration=0055_tracker_behavior_and_cleanup.sql migration_sha256=c09321ff2fe5e24bedee7651e7d6bba2fa4a9976a0f4c74bde55a702bf559726 schema_verifier_sha256=0fc97edc6f959ea7df2d75d8513d283f99d14970ff8c52d332b1e14b27f27115 behavior_verifier_sha256=721a25b8d193ada2b3a6a69866e710a3d7dcf2943abdd285f9fb0ce038e0f7ea repair_test_sha256=81c3a5709514207478ed4d415a2330904585ad70bad346098ba38e0ed0a05d07 schema_test_sha256=a7fa177cf583f8dfc94f8059c95ea3bd23a5de183a91abc319b6fb484d15dc15 behavior_test_sha256=35fe8e9a0d2b5892a0b51680c8213040fdbdaf316086f57173786cf454c9efd1 dry_run_sha256=a4afc62e38abebcc31d4fcfc23a9d0e2a21754fe79df1de194307465b3746e03 cleanup_nonfixture_user_jobs=1 cleanup_ranking_items=3 cleanup_jobs=1 cleanup_companies=1 preserve_auth_users=1 preserve_ranking_runs=3"
}
tracker-behavior-repair-preflight-json -->

# Phase 04 Plan 03 Behavior and Cleanup Repair Preflight

**Status:** PASS — bounded inventory and dry run complete; production repair
awaits a replacement exact approval.

## Failure and cleanup evidence

- Migration 0054 repaired `mark_job_applied(uuid)`: first, repeat, and
  second-owner calls passed.
- Manual creation, lineage validation, cross-owner isolation, pin/resume
  rejection, resume link/delete, and post-delete resume nulling passed.
- `dashboard_applied_applications()` failed with PostgreSQL `42501` because
  its invoker body called `tracker_https_url_valid(text)`, whose execute
  privilege is intentionally revoked from authenticated users.
- Fixture-owner cleanup removed exactly 4 applications, 4 cascaded events,
  2 manifest `user_jobs`, 1 remaining resume, and 2 disposable Auth users.
  Independent residue is zero across those fixture relations and storage.

The background scoring worker saw the temporary open fake job and created one
projection for an existing nonfixture account. The first audit saw 3 ranking
items. The owner approved that exact inventory, but the mandatory pre-push
revalidation found 9 items, so no migration ran and that approval was
invalidated. A later read-only audit at `2026-07-28T15:44:16Z` found:

- unexpected nonfixture `user_jobs`: `1`
- projection state: pending, attempts `0`, not filtered/scored/failed
- owning Auth user exists and must be preserved
- nonfixture applications: `0`
- scoring-maintenance references: `0`
- deterministic ranking items: `10`
- ranking item states: completed `9`, pending `1`, claimed `0`, failed `0`
- distinct ranking runs: `10`

Migration 0055 now closes the exact fake job before cleanup and accepts the
moving ranking inventory only while every item is pending/completed, every
item has a distinct run, and the total remains within the hard `1..64` bound.
It rejects claimed/failed work and any other drift.

## Approval-bound migration

- Linked project: `fjcsvajkkztvlrpdplwx`
- Source commit: `4618c560ca413b29766ff40d77b58a97948ff566`
- Installed migration tail: `0053`, `0054`
- Sole pending migration: `0055_tracker_behavior_and_cleanup.sql`
- Migration 0053 SHA-256: `7da3c2215eb00fbee410388b79ce5dddf2e589ad9f176ad3d31c7f543ed923c0`
- Migration 0054 SHA-256: `111fc68f01dd0658cd2536c4fb6abfd99ba25179e70b98ef158e3ab22753a5c3`
- Migration 0055 SHA-256: `d468c3b6dd019006bd856001eed6209a3547072c9091ad3b101125ee33267bf3`
- Schema verifier SHA-256: `0fc97edc6f959ea7df2d75d8513d283f99d14970ff8c52d332b1e14b27f27115`
- Behavior verifier SHA-256: `721a25b8d193ada2b3a6a69866e710a3d7dcf2943abdd285f9fb0ce038e0f7ea`
- Migration 0055 test SHA-256: `4595b6d8308348306dffb79e55f446ed80b66ba95c68a048b0cf845e28b1fe30`
- Schema test SHA-256: `a7fa177cf583f8dfc94f8059c95ea3bd23a5de183a91abc319b6fb484d15dc15`
- Behavior test SHA-256: `35fe8e9a0d2b5892a0b51680c8213040fdbdaf316086f57173786cf454c9efd1`
- Dry-run SHA-256: `5cb3b353e1e389fba65bc6da44a9974ccb56136c817efa1aad40117b5f387259`
- Supabase CLI: `2.109.1`
- Scoped source dirty inventory: empty

The read-only command
`web/node_modules/.bin/supabase db push --linked --dry-run` was repeated and
produced the same digest twice. It proposed exactly
`0055_tracker_behavior_and_cleanup.sql`. No mutation ran.

## Exact migration scope

Migration 0055:

1. Replaces `sync_application_stage_projection()` so ordinary final-event
   deletion remains rejected while an event cascade is allowed only after its
   exact parent application no longer exists.
2. Replaces `dashboard_applied_applications()` with the same eight-column,
   security-invoker contract and an inline HTTPS expression. It does not grant
   authenticated execute on the internal URL helper.
3. Revalidates zero disposable-owner residue and the exact fake company/job,
   then closes the fake job before inspecting background-created work.
4. Requires exactly one active-owner, pending, zero-attempt projection with no
   applications or scoring-maintenance references.
5. Requires `1..64` ranking items, only pending/completed states, zero
   claimed/failed items, and one distinct run per item. It deletes the
   projection and its ranking items through the existing FK cascade, then
   deletes the exact fake job/company.
6. Preserves the nonfixture Auth user, all of that user's legitimate data,
   and all ranking-run records.

The behavior verifier seeds future fake jobs as `closed`, deletes applications
before verifying event cascade, and binds migrations 0053–0055 into every
later hosted proof.

Local verification is PASS: 3 focused files / 21 tests, 73 complete files /
1,486 tests, production build, lint with only two pre-existing warnings, and
repository diff check.

## Exact approval signal

`approve Phase 04 tracker behavior cleanup repair push target=fjcsvajkkztvlrpdplwx source_commit=4618c560ca413b29766ff40d77b58a97948ff566 repair_migration=0055_tracker_behavior_and_cleanup.sql migration_sha256=d468c3b6dd019006bd856001eed6209a3547072c9091ad3b101125ee33267bf3 schema_verifier_sha256=0fc97edc6f959ea7df2d75d8513d283f99d14970ff8c52d332b1e14b27f27115 behavior_verifier_sha256=721a25b8d193ada2b3a6a69866e710a3d7dcf2943abdd285f9fb0ce038e0f7ea repair_test_sha256=4595b6d8308348306dffb79e55f446ed80b66ba95c68a048b0cf845e28b1fe30 schema_test_sha256=a7fa177cf583f8dfc94f8059c95ea3bd23a5de183a91abc319b6fb484d15dc15 behavior_test_sha256=35fe8e9a0d2b5892a0b51680c8213040fdbdaf316086f57173786cf454c9efd1 dry_run_sha256=5cb3b353e1e389fba65bc6da44a9974ccb56136c817efa1aad40117b5f387259 cleanup_nonfixture_user_jobs=1 cleanup_ranking_items_min=1 cleanup_ranking_items_max=64 cleanup_jobs=1 cleanup_companies=1 preserve_auth_users=1 preserve_ranking_runs=all`

Replying `defer Phase 04 tracker behavior cleanup repair push` leaves the
isolated fake job/company/projection lineage in place and performs no schema
change.

<!-- tracker-behavior-repair-preflight-json
{
  "status": "PASS",
  "created_at": "2026-07-28T15:44:16Z",
  "project_ref": "fjcsvajkkztvlrpdplwx",
  "source_commit": "4618c560ca413b29766ff40d77b58a97948ff566",
  "repair_migration": "0055_tracker_behavior_and_cleanup.sql",
  "base_migration_sha256": "7da3c2215eb00fbee410388b79ce5dddf2e589ad9f176ad3d31c7f543ed923c0",
  "rpc_repair_migration_sha256": "111fc68f01dd0658cd2536c4fb6abfd99ba25179e70b98ef158e3ab22753a5c3",
  "behavior_repair_migration_sha256": "d468c3b6dd019006bd856001eed6209a3547072c9091ad3b101125ee33267bf3",
  "schema_verifier_sha256": "0fc97edc6f959ea7df2d75d8513d283f99d14970ff8c52d332b1e14b27f27115",
  "behavior_verifier_sha256": "721a25b8d193ada2b3a6a69866e710a3d7dcf2943abdd285f9fb0ce038e0f7ea",
  "repair_test_sha256": "4595b6d8308348306dffb79e55f446ed80b66ba95c68a048b0cf845e28b1fe30",
  "schema_test_sha256": "a7fa177cf583f8dfc94f8059c95ea3bd23a5de183a91abc319b6fb484d15dc15",
  "behavior_test_sha256": "35fe8e9a0d2b5892a0b51680c8213040fdbdaf316086f57173786cf454c9efd1",
  "dry_run_sha256": "5cb3b353e1e389fba65bc6da44a9974ccb56136c817efa1aad40117b5f387259",
  "remote_migration_tail": ["0052", "0053", "0054"],
  "sole_pending_migration": "0055_tracker_behavior_and_cleanup.sql",
  "scoped_source_dirty_inventory": [],
  "observed_cleanup_inventory": {
    "observed_at": "2026-07-28T15:44:16Z",
    "nonfixture_user_jobs": 1,
    "ranking_items": 10,
    "ranking_items_pending": 1,
    "ranking_items_completed": 9,
    "ranking_items_claimed": 0,
    "ranking_items_failed": 0,
    "ranking_runs": 10,
    "jobs": 1,
    "companies": 1
  },
  "cleanup_authority": {
    "nonfixture_user_jobs": 1,
    "ranking_items_min": 1,
    "ranking_items_max": 64,
    "jobs": 1,
    "companies": 1
  },
  "preserve": {
    "auth_users": 1,
    "ranking_runs": "all"
  },
  "approval_signal": "approve Phase 04 tracker behavior cleanup repair push target=fjcsvajkkztvlrpdplwx source_commit=4618c560ca413b29766ff40d77b58a97948ff566 repair_migration=0055_tracker_behavior_and_cleanup.sql migration_sha256=d468c3b6dd019006bd856001eed6209a3547072c9091ad3b101125ee33267bf3 schema_verifier_sha256=0fc97edc6f959ea7df2d75d8513d283f99d14970ff8c52d332b1e14b27f27115 behavior_verifier_sha256=721a25b8d193ada2b3a6a69866e710a3d7dcf2943abdd285f9fb0ce038e0f7ea repair_test_sha256=4595b6d8308348306dffb79e55f446ed80b66ba95c68a048b0cf845e28b1fe30 schema_test_sha256=a7fa177cf583f8dfc94f8059c95ea3bd23a5de183a91abc319b6fb484d15dc15 behavior_test_sha256=35fe8e9a0d2b5892a0b51680c8213040fdbdaf316086f57173786cf454c9efd1 dry_run_sha256=5cb3b353e1e389fba65bc6da44a9974ccb56136c817efa1aad40117b5f387259 cleanup_nonfixture_user_jobs=1 cleanup_ranking_items_min=1 cleanup_ranking_items_max=64 cleanup_jobs=1 cleanup_companies=1 preserve_auth_users=1 preserve_ranking_runs=all"
}
tracker-behavior-repair-preflight-json -->

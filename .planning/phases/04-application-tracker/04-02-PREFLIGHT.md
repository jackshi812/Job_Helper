# Phase 04 Plan 02 Tracker Schema Preflight

**Status:** PASS — read-only inventory complete; production unchanged.

## Approval-bound source and target

- Linked project: `fjcsvajkkztvlrpdplwx`
- Source commit: `d18c1b4c06471406e27d080f74d7f26c705e957c`
- Migration: `supabase/migrations/0053_application_tracker.sql`
- Migration SHA-256: `7da3c2215eb00fbee410388b79ce5dddf2e589ad9f176ad3d31c7f543ed923c0`
- Schema verifier SHA-256: `e1a9bd1b0f2f8548e34fb42221174e82f28006977e35a2931c3110120983ddee`
- Behavior verifier SHA-256: `2dede3082e76f33e4b6dcf79848a40140a4ee47d37b7044965f8b182962a531b`
- Schema verifier test SHA-256: `c5fa28e191ab53f3b8837e238eaab55c940c9ea6deeeed01e20352d83213784d`
- Behavior verifier test SHA-256: `e3b7aa6fd39e43ac113245492dd70d59ca22385a38de975114b68070df1284b2`
- Fixture manifest SHA-256: `7d8f88ab8c94670fc6925c7899197a1f891dc987b5d6091f3f047bf75155864a`
- Supabase CLI: `web/node_modules/.bin/supabase` (`2.109.1`)
- Local migration order: committed files through `0053`
- Sanitized remote migration order: `0001, 0002, 0003, 0004, 0005, 0006, 0007, 0008, 0009, 0010, 0011, 0012, 0013, 0014, 0015, 0016, 0017, 0018, 0019, 0020, 0021, 0022, 0023, 0024, 0025, 0026, 0027, 0028, 0029, 0030, 0031, 0032, 0033, 0034, 0035, 0036, 0037, 0038, 0039, 0040, 0041, 0042, 0043, 0044, 0045, 0046, 0047, 0048, 0049, 0050, 0051, 0052`
- Sole pending dry run: `0053_application_tracker.sql`
- Dry-run SHA-256: `e32e39fd02966bfd4003a2cfda24ac0723ff7b0cc0d1f8a887f57279e4c8ac33`
- Legacy `user_jobs.applied_at IS NOT NULL` baseline: `0`
- Legacy baseline digest: `350881a01e5ccbc5a4fd5ea7e29183793ca2f414d000dcc343cea07616047eba`

The read-only command was exactly:

`web/node_modules/.bin/supabase db push --linked --dry-run`

It proposed exactly `0053_application_tracker.sql` after hosted `0052`. No schema or
data mutation ran.

## Durable schema effects

1. Add owner-scoped `applications` and `application_stage_events` with RLS.
2. Add owner-safe resume linkage, immutable system provenance, constraints,
   indexes, and chronological projection trigger.
3. Add the narrow authenticated RPC inventory: `tracker_https_url_valid(text)`, `sync_application_stage_projection()`, `mark_job_applied(uuid)`, `create_manual_application(text, text, text, text, text, date)`, `set_application_pin(uuid, boolean)`, `update_application_text_field(uuid, text, text)`, `set_application_resume(uuid, uuid)`, `append_application_stage(uuid, text, date)`, `update_application_stage_event(uuid, text, date)`, `delete_application_stage_event(uuid)`, `dashboard_applied_applications()`, `dashboard_feed_page(text, text, text[], text[], text, jsonb, integer)`.
4. Backfill one system application and one Applied event per legacy applied row.
5. Replace the active Dashboard membership wrapper and add tracker-backed
   applied history.
6. Restrict tracker tables to authenticated SELECT and writes to narrow RPCs.

Manual creation is exactly
`create_manual_application(p_company text, p_title text, p_apply_url text, p_notes text, p_stage text, p_occurred_on date) returns table(application_id uuid, duplicate_warning boolean)`.

Dashboard applied history returns exactly
`application_id uuid, company text, title text, location text, apply_url text, applied_on date, current_stage text, current_stage_date date`; `apply_url` is nullable and must remain
HTTPS without embedded credentials. `applied_on` is the earliest Applied
event under `ORDER BY occurred_on ASC, created_at ASC, id ASC LIMIT 1`.

## Verifier commands and ordering

| Verifier | Mode | Exact flags |
|---|---|---|
| Schema | preflight | `--mode preflight --migration <path> --output <path>` |
| Schema | assert-hosted | `--mode assert-hosted --migration <path> --preflight <path> --evidence <path>` |
| Behavior | contract | `--mode contract` |
| Behavior | hosted | `--mode hosted --preflight <path> --catalog-evidence <path> --evidence <path>` |

After explicit approval, Plan 04-03 must:

1. Recompute every hash and target, repeat the sole-pending dry run, then run
   `web/node_modules/.bin/supabase db push --linked --yes`.
2. Run
   `node --env-file=scripts/.env --experimental-strip-types scripts/verify-tracker-schema.ts --mode assert-hosted --migration supabase/migrations/0053_application_tracker.sql --preflight .planning/phases/04-application-tracker/04-02-PREFLIGHT.md --evidence .planning/phases/04-application-tracker/04-03-CATALOG-EVIDENCE.json`.
3. Only after catalog PASS, run
   `node --env-file=scripts/.env --experimental-strip-types scripts/verify-tracker-rls.ts --mode hosted --preflight .planning/phases/04-application-tracker/04-02-PREFLIGHT.md --catalog-evidence .planning/phases/04-application-tracker/04-03-CATALOG-EVIDENCE.json --evidence .planning/phases/04-application-tracker/04-03-RLS-EVIDENCE.json`.

Catalog verification reads migration, table, column, RLS, policy, grant,
constraint, index, trigger, function definition/security/search-path/ACL, exact
RPC result, Dashboard projection, and backfill parity catalogs. It emits only
object names, booleans, counts, versions, and SHA-256 digests.

## Disposable fixture and authority boundary

- Namespace: `phase-04-tracker-0053-proof-v1`
- Directly seedable auth users: `2`
- Directly seedable companies: `1`
- Directly seedable jobs: `1`
- Directly seedable user_jobs: `2`
- Directly seedable resumes: `2`
- Runtime-derived applications: `4`
- Runtime-derived application events: `5`

The manifest's exact directly seedable objects and UUIDs are present in the
machine contract below. It deliberately contains no application or event UUID.
The behavior verifier obtains the `service_role` key non-interactively with
`web/node_modules/.bin/supabase projects api-keys --project-ref fjcsvajkkztvlrpdplwx --reveal --output json`,
keeps it only in memory, recursively redacts failures, and never writes it to
arguments, files, logs, approval text, or evidence.

Privileged authority is limited to: create the two manifest users; collision
checks and exact inserts for the listed company/job/user_jobs/resumes; exact
source-row removal; FK-safe finally cleanup; and seven-relation zero-residue
inspection. Every removal requires exact owner, verified parent, fixture
namespace, memory-only runtime lineage membership, and exact expected count.
Auth users are deleted last.

Two independently authenticated publishable-key sessions perform every Mark
Applied/manual-create/stage/table/RPC/resume/isolation assertion. RPC-created
application IDs are admitted to a memory-only allowlist only after exact owner,
origin/source parent or manual namespace, and count verification. Event IDs are
queried only through those applications plus owner/namespace and receive the
same parent/count verification. The proof calls all six manual parameters,
validates both returned fields, queries exactly the eight Dashboard columns,
adds a later Applied event, and requires the earliest Applied date to remain
stable.

Cleanup is FK-safe over `public.application_stage_events`,
`public.applications`, `public.user_jobs`, `public.resumes`,
`public.jobs`, `public.companies`, and `auth.users`: six public tables plus
`auth.users`, seven relations total. Any collision, ambiguity, drift, count
mismatch, or incomplete cleanup fails closed.

## Exclusions

No predeclared RPC-generated application/event UUID; reset; repair; ad hoc or
Dashboard SQL; historical migration edit; package install; function or web
deployment; provider network call or polling; AI/resume generation; real-user
fixture mutation; credential, endpoint, SQL-body, user-content, JD, notes, or
resume logging. The unrelated `.DS_Store`, Phase 03.8 `.gitkeep`,
`scripts/agent-dashboard.mjs`, `scripts/agent-dashboard.test.mjs`, and
`web/zh` are excluded and unstaged.

Any changed byte, checksum, target, remote migration list, dry run, test result,
seedable ID, lineage rule/count, command, authority, cleanup path, or inventory
invalidates approval and requires a fresh preflight.

## Exact approval signal

`approve Phase 04 tracker schema push target=fjcsvajkkztvlrpdplwx migration_sha256=7da3c2215eb00fbee410388b79ce5dddf2e589ad9f176ad3d31c7f543ed923c0 schema_verifier_sha256=e1a9bd1b0f2f8548e34fb42221174e82f28006977e35a2931c3110120983ddee behavior_verifier_sha256=2dede3082e76f33e4b6dcf79848a40140a4ee47d37b7044965f8b182962a531b fixture_manifest_sha256=7d8f88ab8c94670fc6925c7899197a1f891dc987b5d6091f3f047bf75155864a dry_run_sha256=e32e39fd02966bfd4003a2cfda24ac0723ff7b0cc0d1f8a887f57279e4c8ac33`

Replying `defer schema push` leaves production unchanged.

<!-- tracker-preflight-json
{
  "status": "PASS",
  "created_at": "2026-07-28T03:48:40.367Z",
  "project_ref": "fjcsvajkkztvlrpdplwx",
  "source_commit": "d18c1b4c06471406e27d080f74d7f26c705e957c",
  "scoped_dirty_inventory": [
    "scripts/verify-tracker-schema.ts"
  ],
  "migration": "supabase/migrations/0053_application_tracker.sql",
  "migration_sha256": "7da3c2215eb00fbee410388b79ce5dddf2e589ad9f176ad3d31c7f543ed923c0",
  "schema_verifier_sha256": "e1a9bd1b0f2f8548e34fb42221174e82f28006977e35a2931c3110120983ddee",
  "behavior_verifier_sha256": "2dede3082e76f33e4b6dcf79848a40140a4ee47d37b7044965f8b182962a531b",
  "schema_test_sha256": "c5fa28e191ab53f3b8837e238eaab55c940c9ea6deeeed01e20352d83213784d",
  "behavior_test_sha256": "e3b7aa6fd39e43ac113245492dd70d59ca22385a38de975114b68070df1284b2",
  "fixture_manifest_sha256": "7d8f88ab8c94670fc6925c7899197a1f891dc987b5d6091f3f047bf75155864a",
  "cli_path": "web/node_modules/.bin/supabase",
  "cli_version": "2.109.1",
  "remote_migration_versions": [
    "0001",
    "0002",
    "0003",
    "0004",
    "0005",
    "0006",
    "0007",
    "0008",
    "0009",
    "0010",
    "0011",
    "0012",
    "0013",
    "0014",
    "0015",
    "0016",
    "0017",
    "0018",
    "0019",
    "0020",
    "0021",
    "0022",
    "0023",
    "0024",
    "0025",
    "0026",
    "0027",
    "0028",
    "0029",
    "0030",
    "0031",
    "0032",
    "0033",
    "0034",
    "0035",
    "0036",
    "0037",
    "0038",
    "0039",
    "0040",
    "0041",
    "0042",
    "0043",
    "0044",
    "0045",
    "0046",
    "0047",
    "0048",
    "0049",
    "0050",
    "0051",
    "0052"
  ],
  "sole_pending_migration": "0053_application_tracker.sql",
  "dry_run_sha256": "e32e39fd02966bfd4003a2cfda24ac0723ff7b0cc0d1f8a887f57279e4c8ac33",
  "legacy_applied_count": 0,
  "legacy_applied_digest": "350881a01e5ccbc5a4fd5ea7e29183793ca2f414d000dcc343cea07616047eba",
  "fixture_manifest": {
    "namespace": "phase-04-tracker-0053-proof-v1",
    "auth_users": [
      {
        "id": "04020000-0000-4000-8000-000000000001",
        "email": "phase-04-tracker-a@example.invalid",
        "external_id": "phase-04-tracker-user-a"
      },
      {
        "id": "04020000-0000-4000-8000-000000000002",
        "email": "phase-04-tracker-b@example.invalid",
        "external_id": "phase-04-tracker-user-b"
      }
    ],
    "companies": [
      {
        "id": "04020000-0000-4000-8000-000000000010",
        "name": "Phase 04 Tracker Fixture Company",
        "board_token": "phase-04-tracker-0053-proof-v1"
      }
    ],
    "jobs": [
      {
        "id": "04020000-0000-4000-8000-000000000020",
        "external_id": "phase-04-tracker-0053-job",
        "fingerprint": "fd330e93bd57729fbd5c07a3d0ec8400f32b54ae7b8636bdb383af652b132b55"
      }
    ],
    "user_jobs": [
      {
        "id": "04020000-0000-4000-8000-000000000030",
        "owner": "a"
      },
      {
        "id": "04020000-0000-4000-8000-000000000031",
        "owner": "b"
      }
    ],
    "resumes": [
      {
        "id": "04020000-0000-4000-8000-000000000040",
        "owner": "a",
        "storage_path": "phase-04-tracker-0053-proof-v1/a.pdf"
      },
      {
        "id": "04020000-0000-4000-8000-000000000041",
        "owner": "b",
        "storage_path": "phase-04-tracker-0053-proof-v1/b.pdf"
      }
    ]
  },
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
  "approval_signal": "approve Phase 04 tracker schema push target=fjcsvajkkztvlrpdplwx migration_sha256=7da3c2215eb00fbee410388b79ce5dddf2e589ad9f176ad3d31c7f543ed923c0 schema_verifier_sha256=e1a9bd1b0f2f8548e34fb42221174e82f28006977e35a2931c3110120983ddee behavior_verifier_sha256=2dede3082e76f33e4b6dcf79848a40140a4ee47d37b7044965f8b182962a531b fixture_manifest_sha256=7d8f88ab8c94670fc6925c7899197a1f891dc987b5d6091f3f047bf75155864a dry_run_sha256=e32e39fd02966bfd4003a2cfda24ac0723ff7b0cc0d1f8a887f57279e4c8ac33"
}
tracker-preflight-json -->

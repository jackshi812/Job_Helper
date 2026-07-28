# Phase 04 Plan 03 Hosted Tracker Schema Evidence

**Status:** SUPERSEDED — approved proof reached Dashboard RPC and exposed PostgreSQL 42501; migration 0055 approval is pending.

## Post-push identity

- Linked project: `fjcsvajkkztvlrpdplwx`
- Source commit: `62e97831eb61b28aa46c0d86657b1d55e94848aa`
- Migration version: `0054`
- Migration SHA-256: `7da3c2215eb00fbee410388b79ce5dddf2e589ad9f176ad3d31c7f543ed923c0`
- Repair migration SHA-256: `111fc68f01dd0658cd2536c4fb6abfd99ba25179e70b98ef158e3ab22753a5c3`
- Schema verifier SHA-256: `74216fdc290a863b1e1f756e665b99f657795aad45f8d2ceafdb87a999c77349`
- Behavior verifier SHA-256: `3c1ceec5ba40767816cf5aea78c748bf8c7ad760b36c713cb814e87300555d14`
- Repair migration test SHA-256: `b62077aac38f8c8cdcd42fc285323d65a2ccad14ced45992f6844130733855c0`
- Schema verifier test SHA-256: `2a6440be77a657f26268372b4d7c39eed842791661fe5d9dec7077d54230dfe0`
- Behavior verifier test SHA-256: `06cbed496c8fe2131766609e3046faf9e2f8abb4add31da93f627456e5426f76`
- Fixture manifest SHA-256: `8f49236a3704e970a274d64ecc060cea2b9bc54d07cd8741789104f906fd8a77`
- Catalog evidence SHA-256: `c208d0aa04760fe91c5f76c35615333a5f417efb7ac09ba94b98b8a45d4a1d03`
- Hosted catalog SHA-256: `38674105a76d6ff94e2ae00d5b41409bf5315981dcc2290d983bcecde81d0d3b`
- Behavior scope SHA-256: `a9cfc81a7bf1d005dbe3495898046dc6c2c8e4c2f5c77bb79ef4922d269f3b51`
- Scoped source dirty inventory: empty
- Catalog checked at: `2026-07-28T14:49:14.328Z`

## Verifier repair and timeout instrumentation

- RED commit `5418025` pins the exact migration constraint inventory and
  canonical type-only hosted function identities.
- GREEN commit `c9718d2` replaces three nonexistent constraint expectations
  with `applications_job_url_check` and derives hosted signatures from
  PostgreSQL input type OIDs.
- RED commit `26d0c52` requires static, allowlisted step diagnostics with only
  step, status, and elapsed-time fields.
- GREEN commit `c7d7473` labels every hosted request and emits sanitized
  start/pass/fail timing without endpoints, response bodies, fixture values,
  or credentials.
- The approved retry localized a fail-closed company insert rejection before
  any public fixture row was created; exact cleanup left all seven relations
  at zero.
- RED commit `e721b96` binds the company fixture's required connector-state
  identity. GREEN commit `7450faf` supplies its exact `careers_url` and
  `source_key` without changing counts or mutation boundaries.
- The second approved attempt seeded the complete direct fixture and
  established two ordinary sessions, then failed at the first
  `mark_job_applied` request. Its original HTTP/database cause was masked by a
  later Auth Admin cleanup timeout.
- RED commit `0031a1a` requires only a bounded remote database code and
  preservation of the first proof failure. GREEN commit `64d5df5` implements
  that diagnostic contract without retaining response bodies, messages,
  details, hints, endpoints, fixture values, or credentials.
- The next approved proof retained PostgreSQL code `42702` at the first Mark
  Applied RPC. Guarded cleanup and an independent audit restored zero residue.
- RED commit `9a90ab2` binds a forward-only repair. GREEN commit `62e9783`
  adds sole-pending migration 0054, replacing only `mark_job_applied(uuid)`
  and renaming the colliding variable to `target_application_id`.
- The exact owner-approved migration 0054 push succeeded. Remote order is
  exact through 0054, and the post-repair catalog/function/ACL verifier passed.
- Migration 0053, the schema verifier, schema verifier tests, fixture manifest,
  behavior scope counts, lineage constraints, and cleanup boundaries are
  unchanged.
- Focused repair gate: PASS — 3 files, 17 tests.
- Full local gate: PASS — 72 files, 1480 tests.
- Production build: PASS.
- Lint: PASS with two pre-existing warnings outside this repair.
- Repository diff check: PASS.

## Read-only hosted proof

- Supabase CLI: `2.109.1`
- Independent linked migration inventory: exact through `0054`
- Migration push during this continuation: owner-approved 0054 only
- Catalog verifier result: PASS
- Catalog evidence digest recomputation: PASS
- Tables: `2`; columns: `24`; constraints: `11`; indexes: `9`;
  triggers: `1`; functions: `12`; policies: `2`
- Required constraint labels: `applications_id_user_id_key`,
  `applications_origin_check`, `applications_stage_check`,
  `applications_manual_fields_check`, `applications_job_url_check`,
  `applications_resume_owner_fkey`,
  `application_stage_events_application_owner_fkey`,
  `application_stage_events_stage_check`
- Required policy labels: `applications_select_own`,
  `application_stage_events_select_own`
- Required function inventory: `tracker_https_url_valid(text)`,
  `sync_application_stage_projection()`, `mark_job_applied(uuid)`,
  `create_manual_application(text, text, text, text, text, date)`,
  `set_application_pin(uuid, boolean)`,
  `update_application_text_field(uuid, text, text)`,
  `set_application_resume(uuid, uuid)`,
  `append_application_stage(uuid, text, date)`,
  `update_application_stage_event(uuid, text, date)`,
  `delete_application_stage_event(uuid)`,
  `dashboard_applied_applications()`,
  `dashboard_feed_page(text, text, text[], text[], text, jsonb, integer)`
- Tracker table ACL: exactly authenticated `SELECT`
- Tracker column ACL: exactly authenticated `SELECT` across 24 columns
- Narrow authenticated routine ACLs: `10`
- Both tracker tables: RLS enabled; owner `postgres`
- All 12 reviewed functions: empty search path; security mode matched contract
- Legacy applied rows: `0`; system applications: `0`; system Applied events:
  `0`; missing application/event backfill rows: `0`

The full sanitized catalog inventory is retained in
`04-03-CATALOG-EVIDENCE.json`. It contains only object names, booleans, counts,
versions, privilege labels, and SHA-256 values.

The behavior scope digest is the canonical sorted-key SHA-256 of the contract
mode's `fixture_manifest_sha256`, `expected_counts`, `lineage_rules`,
`zero_residue_relations`, and `diagnostics` fields. This binds the new
diagnostic allowlist and output shape without expanding mutation authority.

## Behavior and cleanup scope awaiting approval

Service authority was discovered only transiently in memory and was not
retained. The first approved behavior attempt stopped at the rejected company
insert before any public fixture row existed. The second approved behavior
attempt created the complete direct fixture and two ordinary sessions, then
stopped at the first Mark Applied RPC. In both cases, the bounded SQL fallback
atomically required both exact manifest identities, zero storage objects, zero
public fixture residue, and an exact two-row Auth deletion. Following
independent exact-ID audits returned 404 for both users and zero for all seven
relations. No source row was removed, and the ordinary-session behavior proof
has not passed.

If approved with the exact signal below, the next continuation may:

1. Recompute the listed source, catalog, fixture, and scope hashes and require
   target `fjcsvajkkztvlrpdplwx`.
2. Discover the service-role key non-interactively, retain it only in memory,
   and seed exactly 2 disposable Auth users, 1 company, 1 job, 2 user-job rows,
   and 2 resume rows in namespace `phase-04-tracker-0053-proof-v1`.
3. Use two independent ordinary publishable-key sessions for every table and
   RPC behavior assertion, deriving exactly 4 application IDs and 5 event IDs
   into memory-only lineage only after owner, parent, namespace, and count
   validation.
4. Remove exactly 1 manifest-bound source row during snapshot-survival proof.
5. Run FK-safe `finally` cleanup with exact owner, parent, namespace, lineage,
   and count predicates; delete the 2 Auth users last.
6. Require zero residue across exactly
   `public.application_stage_events`, `public.applications`,
   `public.user_jobs`, `public.resumes`, `public.jobs`, `public.companies`, and
   `auth.users`.

Any target, hash, catalog digest, count, lineage, authority, cleanup, or residue
drift blocks behavior and later Phase 04 plans.

## Exact approval signal

The approval below was consumed by the failed proof and is no longer valid:
migration 0055, both verifiers, both verifier tests, the behavior scope, and
the hosted catalog binding now differ. The current production action is bound
only by `04-03-BEHAVIOR-REPAIR-PREFLIGHT.md`.

`approve Phase 04 tracker behavior verification target=fjcsvajkkztvlrpdplwx source_commit=62e97831eb61b28aa46c0d86657b1d55e94848aa migration_sha256=7da3c2215eb00fbee410388b79ce5dddf2e589ad9f176ad3d31c7f543ed923c0 repair_migration_sha256=111fc68f01dd0658cd2536c4fb6abfd99ba25179e70b98ef158e3ab22753a5c3 schema_verifier_sha256=74216fdc290a863b1e1f756e665b99f657795aad45f8d2ceafdb87a999c77349 behavior_verifier_sha256=3c1ceec5ba40767816cf5aea78c748bf8c7ad760b36c713cb814e87300555d14 repair_test_sha256=b62077aac38f8c8cdcd42fc285323d65a2ccad14ced45992f6844130733855c0 schema_test_sha256=2a6440be77a657f26268372b4d7c39eed842791661fe5d9dec7077d54230dfe0 behavior_test_sha256=06cbed496c8fe2131766609e3046faf9e2f8abb4add31da93f627456e5426f76 fixture_manifest_sha256=8f49236a3704e970a274d64ecc060cea2b9bc54d07cd8741789104f906fd8a77 catalog_evidence_sha256=c208d0aa04760fe91c5f76c35615333a5f417efb7ac09ba94b98b8a45d4a1d03 behavior_scope_sha256=a9cfc81a7bf1d005dbe3495898046dc6c2c8e4c2f5c77bb79ef4922d269f3b51 auth_users=2 companies=1 jobs=1 user_jobs=2 resumes=2 runtime_applications=4 runtime_events=5 source_rows_removed=1 cleanup_relations=7`

Replying `defer Phase 04 tracker behavior verification` leaves production
unchanged and performs no service-authority discovery or hosted mutation.

<!-- tracker-preflight-json
{
  "status": "PASS",
  "created_at": "2026-07-28T14:49:14Z",
  "project_ref": "fjcsvajkkztvlrpdplwx",
  "source_commit": "62e97831eb61b28aa46c0d86657b1d55e94848aa",
  "scoped_source_dirty_inventory": [],
  "migration": "supabase/migrations/0053_application_tracker.sql",
  "migration_sha256": "7da3c2215eb00fbee410388b79ce5dddf2e589ad9f176ad3d31c7f543ed923c0",
  "repair_migration_sha256": "111fc68f01dd0658cd2536c4fb6abfd99ba25179e70b98ef158e3ab22753a5c3",
  "schema_verifier_sha256": "74216fdc290a863b1e1f756e665b99f657795aad45f8d2ceafdb87a999c77349",
  "behavior_verifier_sha256": "3c1ceec5ba40767816cf5aea78c748bf8c7ad760b36c713cb814e87300555d14",
  "schema_test_sha256": "2a6440be77a657f26268372b4d7c39eed842791661fe5d9dec7077d54230dfe0",
  "behavior_test_sha256": "06cbed496c8fe2131766609e3046faf9e2f8abb4add31da93f627456e5426f76",
  "repair_test_sha256": "b62077aac38f8c8cdcd42fc285323d65a2ccad14ced45992f6844130733855c0",
  "fixture_manifest_sha256": "8f49236a3704e970a274d64ecc060cea2b9bc54d07cd8741789104f906fd8a77",
  "catalog_evidence_sha256": "c208d0aa04760fe91c5f76c35615333a5f417efb7ac09ba94b98b8a45d4a1d03",
  "hosted_catalog_sha256": "38674105a76d6ff94e2ae00d5b41409bf5315981dcc2290d983bcecde81d0d3b",
  "behavior_scope_sha256": "a9cfc81a7bf1d005dbe3495898046dc6c2c8e4c2f5c77bb79ef4922d269f3b51",
  "remote_migration_tail": ["0051", "0052", "0053", "0054"],
  "installed_migration": "0054_mark_job_applied_ambiguity.sql",
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
  "approval_signal": "approve Phase 04 tracker behavior verification target=fjcsvajkkztvlrpdplwx source_commit=62e97831eb61b28aa46c0d86657b1d55e94848aa migration_sha256=7da3c2215eb00fbee410388b79ce5dddf2e589ad9f176ad3d31c7f543ed923c0 repair_migration_sha256=111fc68f01dd0658cd2536c4fb6abfd99ba25179e70b98ef158e3ab22753a5c3 schema_verifier_sha256=74216fdc290a863b1e1f756e665b99f657795aad45f8d2ceafdb87a999c77349 behavior_verifier_sha256=3c1ceec5ba40767816cf5aea78c748bf8c7ad760b36c713cb814e87300555d14 repair_test_sha256=b62077aac38f8c8cdcd42fc285323d65a2ccad14ced45992f6844130733855c0 schema_test_sha256=2a6440be77a657f26268372b4d7c39eed842791661fe5d9dec7077d54230dfe0 behavior_test_sha256=06cbed496c8fe2131766609e3046faf9e2f8abb4add31da93f627456e5426f76 fixture_manifest_sha256=8f49236a3704e970a274d64ecc060cea2b9bc54d07cd8741789104f906fd8a77 catalog_evidence_sha256=c208d0aa04760fe91c5f76c35615333a5f417efb7ac09ba94b98b8a45d4a1d03 behavior_scope_sha256=a9cfc81a7bf1d005dbe3495898046dc6c2c8e4c2f5c77bb79ef4922d269f3b51 auth_users=2 companies=1 jobs=1 user_jobs=2 resumes=2 runtime_applications=4 runtime_events=5 source_rows_removed=1 cleanup_relations=7"
}
tracker-preflight-json -->

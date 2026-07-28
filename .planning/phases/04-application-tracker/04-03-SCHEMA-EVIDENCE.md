# Phase 04 Plan 03 Hosted Tracker Schema Evidence

**Status:** CATALOG PASS — awaiting explicit approval after fail-closed fixture repair.

## Post-push identity

- Linked project: `fjcsvajkkztvlrpdplwx`
- Source commit: `7450faf1041ca19094dd59b6839dc1dbc66052eb`
- Migration version: `0053`
- Migration SHA-256: `7da3c2215eb00fbee410388b79ce5dddf2e589ad9f176ad3d31c7f543ed923c0`
- Schema verifier SHA-256: `e6d303172dbd206a394aec33df941bb9627bf541a899f0e894293761e4820d26`
- Behavior verifier SHA-256: `ee785a7f0730d113044a1e6caa078e25845207541d90b387407c493ecb92aa00`
- Schema verifier test SHA-256: `fa350e883dbf64fb405db93f13e46e1e64e85f4ae3dd0e72288440ec66007ffd`
- Behavior verifier test SHA-256: `a6d0886b27d20faa34dae50ed34cc9a57ba8e58f5b6fa662bfa741ad1a140242`
- Fixture manifest SHA-256: `8f49236a3704e970a274d64ecc060cea2b9bc54d07cd8741789104f906fd8a77`
- Catalog evidence SHA-256: `a882860994072dbc5d7fc65e9ad544fc605d118c293f5080e794e2c24243919d`
- Hosted catalog SHA-256: `38884034a76d38f1fb3379d228961c5db39d527029b62bd55a6fa084763c2bce`
- Behavior scope SHA-256: `a9cfc81a7bf1d005dbe3495898046dc6c2c8e4c2f5c77bb79ef4922d269f3b51`
- Scoped source dirty inventory: empty
- Catalog checked at: `2026-07-28T14:21:44.430Z`

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
- Migration 0053, the schema verifier, schema verifier tests, fixture manifest,
  behavior scope counts, lineage constraints, and cleanup boundaries are
  unchanged.
- Focused tracker gate: PASS — 3 files, 22 tests.
- Full local gate: PASS — 71 files, 1476 tests.
- Production build: PASS.
- Lint: PASS with two pre-existing warnings outside this repair.
- Repository diff check: PASS.

## Read-only hosted proof

- Supabase CLI: `2.109.1`
- Independent linked migration inventory: exact through `0053`
- Migration push during this continuation: no
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
retained. The first approved behavior attempt created exactly the two
disposable Auth users, then stopped at the rejected company insert before any
public fixture row existed. Admin cleanup timed out; the bounded SQL fallback
atomically required both exact manifest identities, zero storage objects, zero
public fixture rows, and an exact two-row deletion. A following independent
exact-ID audit returned 404 for both users and zero for all seven relations.
No source row was removed and no ordinary-session behavior assertion ran.

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

`approve Phase 04 tracker behavior verification target=fjcsvajkkztvlrpdplwx source_commit=7450faf1041ca19094dd59b6839dc1dbc66052eb migration_sha256=7da3c2215eb00fbee410388b79ce5dddf2e589ad9f176ad3d31c7f543ed923c0 schema_verifier_sha256=e6d303172dbd206a394aec33df941bb9627bf541a899f0e894293761e4820d26 behavior_verifier_sha256=ee785a7f0730d113044a1e6caa078e25845207541d90b387407c493ecb92aa00 schema_test_sha256=fa350e883dbf64fb405db93f13e46e1e64e85f4ae3dd0e72288440ec66007ffd behavior_test_sha256=a6d0886b27d20faa34dae50ed34cc9a57ba8e58f5b6fa662bfa741ad1a140242 fixture_manifest_sha256=8f49236a3704e970a274d64ecc060cea2b9bc54d07cd8741789104f906fd8a77 catalog_evidence_sha256=a882860994072dbc5d7fc65e9ad544fc605d118c293f5080e794e2c24243919d behavior_scope_sha256=a9cfc81a7bf1d005dbe3495898046dc6c2c8e4c2f5c77bb79ef4922d269f3b51 auth_users=2 companies=1 jobs=1 user_jobs=2 resumes=2 runtime_applications=4 runtime_events=5 source_rows_removed=1 cleanup_relations=7`

Replying `defer Phase 04 tracker behavior verification` leaves production
unchanged and performs no service-authority discovery or hosted mutation.

<!-- tracker-preflight-json
{
  "status": "PASS",
  "created_at": "2026-07-28T14:21:44Z",
  "project_ref": "fjcsvajkkztvlrpdplwx",
  "source_commit": "7450faf1041ca19094dd59b6839dc1dbc66052eb",
  "scoped_source_dirty_inventory": [],
  "migration": "supabase/migrations/0053_application_tracker.sql",
  "migration_sha256": "7da3c2215eb00fbee410388b79ce5dddf2e589ad9f176ad3d31c7f543ed923c0",
  "schema_verifier_sha256": "e6d303172dbd206a394aec33df941bb9627bf541a899f0e894293761e4820d26",
  "behavior_verifier_sha256": "ee785a7f0730d113044a1e6caa078e25845207541d90b387407c493ecb92aa00",
  "schema_test_sha256": "fa350e883dbf64fb405db93f13e46e1e64e85f4ae3dd0e72288440ec66007ffd",
  "behavior_test_sha256": "a6d0886b27d20faa34dae50ed34cc9a57ba8e58f5b6fa662bfa741ad1a140242",
  "fixture_manifest_sha256": "8f49236a3704e970a274d64ecc060cea2b9bc54d07cd8741789104f906fd8a77",
  "catalog_evidence_sha256": "a882860994072dbc5d7fc65e9ad544fc605d118c293f5080e794e2c24243919d",
  "hosted_catalog_sha256": "38884034a76d38f1fb3379d228961c5db39d527029b62bd55a6fa084763c2bce",
  "behavior_scope_sha256": "a9cfc81a7bf1d005dbe3495898046dc6c2c8e4c2f5c77bb79ef4922d269f3b51",
  "remote_migration_tail": ["0050", "0051", "0052", "0053"],
  "installed_migration": "0053_application_tracker.sql",
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
  "approval_signal": "approve Phase 04 tracker behavior verification target=fjcsvajkkztvlrpdplwx source_commit=7450faf1041ca19094dd59b6839dc1dbc66052eb migration_sha256=7da3c2215eb00fbee410388b79ce5dddf2e589ad9f176ad3d31c7f543ed923c0 schema_verifier_sha256=e6d303172dbd206a394aec33df941bb9627bf541a899f0e894293761e4820d26 behavior_verifier_sha256=ee785a7f0730d113044a1e6caa078e25845207541d90b387407c493ecb92aa00 schema_test_sha256=fa350e883dbf64fb405db93f13e46e1e64e85f4ae3dd0e72288440ec66007ffd behavior_test_sha256=a6d0886b27d20faa34dae50ed34cc9a57ba8e58f5b6fa662bfa741ad1a140242 fixture_manifest_sha256=8f49236a3704e970a274d64ecc060cea2b9bc54d07cd8741789104f906fd8a77 catalog_evidence_sha256=a882860994072dbc5d7fc65e9ad544fc605d118c293f5080e794e2c24243919d behavior_scope_sha256=a9cfc81a7bf1d005dbe3495898046dc6c2c8e4c2f5c77bb79ef4922d269f3b51 auth_users=2 companies=1 jobs=1 user_jobs=2 resumes=2 runtime_applications=4 runtime_events=5 source_rows_removed=1 cleanup_relations=7"
}
tracker-preflight-json -->

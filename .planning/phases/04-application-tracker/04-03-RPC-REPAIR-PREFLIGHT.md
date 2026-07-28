# Phase 04 Plan 03 Mark Applied RPC Repair Preflight

**Status:** CONSUMED — exact owner-approved migration 0054 installed; post-repair catalog PASS.

## Failure evidence

- Approved ordinary-session proof reached `behavior.mark.a.first`.
- PostgreSQL returned bounded code `42702` (`ambiguous_column`).
- The collision is between the PL/pgSQL variable `application_id` and the
  `public.application_stage_events.application_id` column in
  `mark_job_applied(uuid)`.
- The failed proof's public cleanup passed. Guarded cleanup deleted exactly the
  two manifest Auth users, and an independent audit returned zero for all
  seven relations plus `storage.objects`.

## Approval-bound repair

- Linked project: `fjcsvajkkztvlrpdplwx`
- Source commit: `62e97831eb61b28aa46c0d86657b1d55e94848aa`
- Installed tracker migration: `0053_application_tracker.sql`
- Sole pending repair: `0054_mark_job_applied_ambiguity.sql`
- Migration 0053 SHA-256: `7da3c2215eb00fbee410388b79ce5dddf2e589ad9f176ad3d31c7f543ed923c0`
- Repair migration SHA-256: `111fc68f01dd0658cd2536c4fb6abfd99ba25179e70b98ef158e3ab22753a5c3`
- Schema verifier SHA-256: `74216fdc290a863b1e1f756e665b99f657795aad45f8d2ceafdb87a999c77349`
- Behavior verifier SHA-256: `3c1ceec5ba40767816cf5aea78c748bf8c7ad760b36c713cb814e87300555d14`
- Repair test SHA-256: `b62077aac38f8c8cdcd42fc285323d65a2ccad14ced45992f6844130733855c0`
- Schema verifier test SHA-256: `2a6440be77a657f26268372b4d7c39eed842791661fe5d9dec7077d54230dfe0`
- Behavior verifier test SHA-256: `06cbed496c8fe2131766609e3046faf9e2f8abb4add31da93f627456e5426f76`
- Dry-run SHA-256: `1f4f10036260b7d79085325475757b483c1429d54e1c0ad9f5316333018319c4`
- Supabase CLI: `2.109.1`
- Remote migration tail: `0051`, `0052`, `0053`
- Local migration tail: `0052`, `0053`, `0054`
- Scoped source dirty inventory: empty

The read-only command was:

`web/node_modules/.bin/supabase db push --linked --dry-run`

It proposed exactly `0054_mark_job_applied_ambiguity.sql`. No schema or data
mutation ran.

## Exact scope

Migration 0054 uses `create or replace function` on only
`public.mark_job_applied(uuid)`. It renames the colliding local variable to
`target_application_id`, updates only its references, and reasserts:

- `security definer`
- empty `search_path`
- execute revoked from `public` and `anon`
- execute granted to `authenticated`
- owner `postgres`

It creates no table, column, policy, trigger, data row, user, storage object,
or additional function. Migration 0053 remains byte-identical.

Local verification is PASS: 3 focused files / 17 tests, 72 complete files /
1,480 tests, production build, lint with only two pre-existing warnings, and
repository diff check.

## Exact approval signal

`approve Phase 04 tracker RPC repair push target=fjcsvajkkztvlrpdplwx source_commit=62e97831eb61b28aa46c0d86657b1d55e94848aa repair_migration=0054_mark_job_applied_ambiguity.sql migration_sha256=111fc68f01dd0658cd2536c4fb6abfd99ba25179e70b98ef158e3ab22753a5c3 schema_verifier_sha256=74216fdc290a863b1e1f756e665b99f657795aad45f8d2ceafdb87a999c77349 behavior_verifier_sha256=3c1ceec5ba40767816cf5aea78c748bf8c7ad760b36c713cb814e87300555d14 repair_test_sha256=b62077aac38f8c8cdcd42fc285323d65a2ccad14ced45992f6844130733855c0 schema_test_sha256=2a6440be77a657f26268372b4d7c39eed842791661fe5d9dec7077d54230dfe0 behavior_test_sha256=06cbed496c8fe2131766609e3046faf9e2f8abb4add31da93f627456e5426f76 dry_run_sha256=1f4f10036260b7d79085325475757b483c1429d54e1c0ad9f5316333018319c4`

Replying `defer Phase 04 tracker RPC repair push` leaves production unchanged.

The exact approval was consumed on 2026-07-28. The push installed only
`0054_mark_job_applied_ambiguity.sql`; remote order was then verified exact
through 0054, followed by a PASS from the hosted catalog/function/ACL verifier.

<!-- tracker-repair-preflight-json
{
  "status": "PASS",
  "created_at": "2026-07-28T14:41:49Z",
  "project_ref": "fjcsvajkkztvlrpdplwx",
  "source_commit": "62e97831eb61b28aa46c0d86657b1d55e94848aa",
  "repair_migration": "0054_mark_job_applied_ambiguity.sql",
  "base_migration_sha256": "7da3c2215eb00fbee410388b79ce5dddf2e589ad9f176ad3d31c7f543ed923c0",
  "repair_migration_sha256": "111fc68f01dd0658cd2536c4fb6abfd99ba25179e70b98ef158e3ab22753a5c3",
  "schema_verifier_sha256": "74216fdc290a863b1e1f756e665b99f657795aad45f8d2ceafdb87a999c77349",
  "behavior_verifier_sha256": "3c1ceec5ba40767816cf5aea78c748bf8c7ad760b36c713cb814e87300555d14",
  "repair_test_sha256": "b62077aac38f8c8cdcd42fc285323d65a2ccad14ced45992f6844130733855c0",
  "schema_test_sha256": "2a6440be77a657f26268372b4d7c39eed842791661fe5d9dec7077d54230dfe0",
  "behavior_test_sha256": "06cbed496c8fe2131766609e3046faf9e2f8abb4add31da93f627456e5426f76",
  "dry_run_sha256": "1f4f10036260b7d79085325475757b483c1429d54e1c0ad9f5316333018319c4",
  "remote_migration_tail": ["0051", "0052", "0053"],
  "sole_pending_migration": "0054_mark_job_applied_ambiguity.sql",
  "scoped_source_dirty_inventory": [],
  "production_residue": {
    "public.application_stage_events": 0,
    "public.applications": 0,
    "public.user_jobs": 0,
    "public.resumes": 0,
    "public.jobs": 0,
    "public.companies": 0,
    "auth.users": 0,
    "storage.objects": 0
  },
  "approval_signal": "approve Phase 04 tracker RPC repair push target=fjcsvajkkztvlrpdplwx source_commit=62e97831eb61b28aa46c0d86657b1d55e94848aa repair_migration=0054_mark_job_applied_ambiguity.sql migration_sha256=111fc68f01dd0658cd2536c4fb6abfd99ba25179e70b98ef158e3ab22753a5c3 schema_verifier_sha256=74216fdc290a863b1e1f756e665b99f657795aad45f8d2ceafdb87a999c77349 behavior_verifier_sha256=3c1ceec5ba40767816cf5aea78c748bf8c7ad760b36c713cb814e87300555d14 repair_test_sha256=b62077aac38f8c8cdcd42fc285323d65a2ccad14ced45992f6844130733855c0 schema_test_sha256=2a6440be77a657f26268372b4d7c39eed842791661fe5d9dec7077d54230dfe0 behavior_test_sha256=06cbed496c8fe2131766609e3046faf9e2f8abb4add31da93f627456e5426f76 dry_run_sha256=1f4f10036260b7d79085325475757b483c1429d54e1c0ad9f5316333018319c4"
}
tracker-repair-preflight-json -->

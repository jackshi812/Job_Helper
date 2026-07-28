# Phase 04 Application Delete Preflight

**Status:** PASS — read-only inventory complete; production unchanged.

- Target: `fjcsvajkkztvlrpdplwx`
- Source commit: `9747a3988b055db5383fca96cb16f3ac0f62752f`
- Sole pending migration: `0056_delete_tracker_application.sql`
- Migration SHA-256: `2ddc0e6f7b8df01ba88ff8bc4ce14ad4f0bc0fc96138d3a3c3c2c3fea8e65a85`
- Verifier SHA-256: `cdfcd83b90b3e0cc30a4445d7c046aeb884eddb8a26d7ed31fd8bc1cb5e08fe1`
- Verifier test SHA-256: `7c7c317a18b1d7a3122c7e6c1751f409f3339a60174f2b0f59a412ceff41c373`
- Migration test SHA-256: `dc8f4ff52a5606e04311681e60f0f717f88676935a6fa3d036db99d2ccb4f407`
- Dry-run SHA-256: `627a2444a625448d41a52f70e7b3c77d90ef53d251b7f35eda9692d001b039a3`

The migration adds one authenticated, owner-scoped
`delete_tracker_application(uuid)` RPC. It deletes the owned Tracker
aggregate through the existing event cascade and does not mutate
`user_jobs.applied_at`, jobs, resumes, providers, or real-user content.

## Exact approval signal

`approve Phase 04 tracker application delete push target=fjcsvajkkztvlrpdplwx source_commit=9747a3988b055db5383fca96cb16f3ac0f62752f migration_sha256=2ddc0e6f7b8df01ba88ff8bc4ce14ad4f0bc0fc96138d3a3c3c2c3fea8e65a85 verifier_sha256=cdfcd83b90b3e0cc30a4445d7c046aeb884eddb8a26d7ed31fd8bc1cb5e08fe1 verifier_test_sha256=7c7c317a18b1d7a3122c7e6c1751f409f3339a60174f2b0f59a412ceff41c373 migration_test_sha256=dc8f4ff52a5606e04311681e60f0f717f88676935a6fa3d036db99d2ccb4f407 dry_run_sha256=627a2444a625448d41a52f70e7b3c77d90ef53d251b7f35eda9692d001b039a3`

<!-- tracker-delete-preflight-json
{
  "status": "PASS",
  "created_at": "2026-07-28T18:58:58.040Z",
  "project_ref": "fjcsvajkkztvlrpdplwx",
  "source_commit": "9747a3988b055db5383fca96cb16f3ac0f62752f",
  "migration": "supabase/migrations/0056_delete_tracker_application.sql",
  "sole_pending_migration": "0056_delete_tracker_application.sql",
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
    "0052",
    "0053",
    "0054",
    "0055"
  ],
  "dry_run_sha256": "627a2444a625448d41a52f70e7b3c77d90ef53d251b7f35eda9692d001b039a3",
  "migration_sha256": "2ddc0e6f7b8df01ba88ff8bc4ce14ad4f0bc0fc96138d3a3c3c2c3fea8e65a85",
  "verifier_sha256": "cdfcd83b90b3e0cc30a4445d7c046aeb884eddb8a26d7ed31fd8bc1cb5e08fe1",
  "verifier_test_sha256": "7c7c317a18b1d7a3122c7e6c1751f409f3339a60174f2b0f59a412ceff41c373",
  "migration_test_sha256": "dc8f4ff52a5606e04311681e60f0f717f88676935a6fa3d036db99d2ccb4f407",
  "approval_signal": "approve Phase 04 tracker application delete push target=fjcsvajkkztvlrpdplwx source_commit=9747a3988b055db5383fca96cb16f3ac0f62752f migration_sha256=2ddc0e6f7b8df01ba88ff8bc4ce14ad4f0bc0fc96138d3a3c3c2c3fea8e65a85 verifier_sha256=cdfcd83b90b3e0cc30a4445d7c046aeb884eddb8a26d7ed31fd8bc1cb5e08fe1 verifier_test_sha256=7c7c317a18b1d7a3122c7e6c1751f409f3339a60174f2b0f59a412ceff41c373 migration_test_sha256=dc8f4ff52a5606e04311681e60f0f717f88676935a6fa3d036db99d2ccb4f407 dry_run_sha256=627a2444a625448d41a52f70e7b3c77d90ef53d251b7f35eda9692d001b039a3"
}
tracker-delete-preflight-json -->

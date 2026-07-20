# Phase 3 Final-Release Paid Proof

<!-- status: core_pass_with_exact_manual_fixture_cleanup -->
<!-- approval signal: approve -->
<!-- invocation command: node --env-file=scripts/.env --experimental-strip-types scripts/verify-scoring-freshness.ts -->
<!-- process attempts under this approval: 1; retries/fallback/legacy/manual tick: 0 -->
<!-- process result: all setup, isolation, one-tick, paid-usage, positive/negative outcome, restoration, account deletion, and cron equality assertions passed; the process exited 1 only because the final three-job delete received HTTP 520 and the following zero-residue assertion observed those jobs -->
<!-- inference basis: cleanupFailure emitted only cleanup errors and no primary error, which is possible only after the complete verifier try-body, including assertOutcomes, returned successfully -->
<!-- score-tick runtime: execution c6d2427d-a724-4cf4-bfa1-8dff349dd77f; HTTP 200; function ae6c147f-c3a8-417e-8057-d4105ac9aed5; deployment suffix _6; execution 2645 ms; HTTP/1.1; timestamp 2026-07-20T20:55:46.986Z -->
<!-- owned usage: exactly one orphaned-after-disposable-delete score row; gpt-5.4-nano; timestamp 2026-07-20T20:55:46.959596Z -->
<!-- cleanup: automatic latch release, data restoration, disposable-account deletion, and exact cron restoration completed without reported error; manual cleanup deleted only the three remaining validated verify-* / example.invalid fixture jobs -->
<!-- final residue audit: zero tagged auth users, fixture jobs, fixture user_jobs, and latches; cron active; immutable usage ledger retained -->
<!-- transparency: this artifact does not claim process exit 0 or automatic fixture deletion; it accepts the verified core pass plus exact audited manual cleanup -->

evidence_mode: paid
local_git_sha: 020295200ff3e48db4d685f5382c10f406ca7967
origin_git_sha: 020295200ff3e48db4d685f5382c10f406ca7967
migration_head: 0027
migration_0027_applied: true
score_tick_deployment_id: ae6c147f-c3a8-417e-8057-d4105ac9aed5
score_tick_version: 6
cloudflare_deployment_id: 877499ee-f1ad-4067-b8f2-b5c152954141
cloudflare_url: https://877499ee.job-helper-qs9.pages.dev
cloudflare_status: success
asset_url: /assets/index-lyvShdhx.js
asset_sha256: a6f11edc4d18ed264233d5d17e2fd2005e9064036ec09409cf95761498013d66
latch_table_present: true
begin_function_present: true
end_function_present: true
claim_function_present: true
maintenance_max_ttl_seconds: 300
maintenance_service_role_only: true
notification_runtime_absent: true
notification_schema_absent: true
notification_secrets_absent: true
notification_client_absent: true
notification_ui_absent: true
local_safety_command: node --experimental-strip-types --test scripts/verify-scoring-freshness.test.mjs scripts/verify-scoring-evidence.test.mjs && cd web && npm test -- --run
local_safety_result: pass
paid_verifier_runs: 1
manual_score_tick_invocations: 0
maintenance_runs_started: 1
openai_calls_by_plan_03_10: 0
rollout_local_git_sha: 020295200ff3e48db4d685f5382c10f406ca7967
rollout_origin_git_sha: 020295200ff3e48db4d685f5382c10f406ca7967
rollout_migration_head: 0027
rollout_score_tick_deployment_id: ae6c147f-c3a8-417e-8057-d4105ac9aed5
rollout_cloudflare_deployment_id: 877499ee-f1ad-4067-b8f2-b5c152954141
rollout_asset_sha256: a6f11edc4d18ed264233d5d17e2fd2005e9064036ec09409cf95761498013d66
score_tick_invocations: 1
fixture_user_jobs: 2
late_job_isolated: true
late_preference_isolated: true
late_reroute_isolated: true
no_id_claimed: 0
mismatched_id_claimed: 0
authenticated_writes_denied: true
positive_fixture_outcome: scored
negative_fixture_outcome: filtered
owned_global_usage_delta: 1
other_global_usage_delta: 0
rows_restored_exactly: true
preferences_restored_exactly: true
latch_released_or_expired: true
cron_restored_exactly: true
residue_count: 0
openai_calls_by_plan_03_11: 1

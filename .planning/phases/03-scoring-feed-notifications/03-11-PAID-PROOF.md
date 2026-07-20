# Plan 03-11 Paid Verifier Attempt Proof

<!-- bounded_failure: the sole approved process attempt failed before fixture creation, latch activation, score-tick, or OpenAI; no retry is authorized -->
<!-- cleanup_blocker: the score cron restoration call returned HTTP 400 and the exact restoration assertion found active=false instead of the baseline active=true -->
<!-- privacy: evidence contains only release identities, counts, digests, timestamps, statuses, and the bounded verifier error; no secrets or raw row content -->
<!-- remediation: the failed attempt remains failed; a separately approved active-only cron repair restored the exact pre-run row, and local defects were fixed without another verifier, tick, fixture, latch, or paid call -->

evidence_mode: paid_attempt_failure
status: fail
approval_signal: approve one paid verifier run
approved_process_attempts: 1
invocation_count: 1
invocation_command: node --env-file=scripts/.env --experimental-strip-types scripts/verify-scoring-freshness.ts
process_started_after: 2026-07-20T16:35:33.308962Z
process_finished_before: 2026-07-20T16:37:48.517278Z
process_exit_status: 1
process_stdout_records: 0
process_error: user_jobs snapshot was truncated; cleanup failed: Management SQL returned HTTP 400; score cron restoration mismatch: active
failure_stage: snapshot_data
failure_cause: hosted user_jobs snapshot count exceeded the unpaginated Supabase response row limit
retry_count: 0
retry_authorized: false
legacy_verifier_invocations: 0
manual_score_tick_invocations: 0

local_git_sha: c15ad867f5714862192c8e95099e755d90963566
origin_git_sha: c15ad867f5714862192c8e95099e755d90963566
migration_head: 0025
migration_0026_applied: false
score_tick_deployment_id: ae6c147f-c3a8-417e-8057-d4105ac9aed5
score_tick_version: 3
score_tick_verify_jwt: false
cloudflare_deployment_id: 2b3cb77f-9043-4fc8-b9dc-b57e1565ceed
cloudflare_status: success
asset_url: /assets/index-BxwGvdK2.js
asset_sha256: b29c1297c2945749aa4b2ed891567ca352ee643947126db3cfed867f815175af
release_identity_precheck: pass
latch_contract_precheck: pass
configured_fixture_user_jobs: 2
configured_ttl_seconds: 120
database_max_ttl_seconds: 300
preflight_latch_rows: 0
preflight_score_cron_rows: 1
preflight_score_cron_active: true

fixture_jobs_created: 0
fixture_user_jobs_created: 0
maintenance_runs_started: 0
score_tick_invocations: 0
no_id_claim_check: not_reached
mismatched_id_claim_check: not_reached
matching_claim_check: not_reached
authenticated_write_denial_check: not_reached
positive_fixture_outcome: not_reached
negative_fixture_outcome: not_reached
owned_score_usage_delta: 0
other_paid_deltas: 0
openai_calls_by_plan_03_11: 0
global_usage_count_before: 230
global_usage_count_after: 230
global_usage_ids_digest_before: beebdc2f597d37976dac0e4a581add6e
global_usage_ids_digest_after: beebdc2f597d37976dac0e4a581add6e
usage_rows_since_baseline: 0

user_jobs_count_before: 2992
user_jobs_count_after: 2992
user_jobs_digest_before: af749f1a2138303cebed6d26605633c1
user_jobs_digest_after: af749f1a2138303cebed6d26605633c1
rows_restored_exactly: true
target_preferences_count_before: 1
target_preferences_count_after: 1
target_preferences_digest_before: 2448fc173ee1ee5e010c4781d137b027
target_preferences_digest_after: 2448fc173ee1ee5e010c4781d137b027
preferences_restored_exactly: true
latch_rows_after: 0
latch_released_or_expired: true
verifier_job_residue: 0
verifier_user_job_residue: 0
residue_count: 0
score_cron_rows_after: 1
score_cron_active_after: false
score_cron_digest_before: 1e6b9825c9e55c43fe9c963abb13fa12
score_cron_digest_after: d5f8baaa4cfe1be9e17b48e655155f11
cron_restored_exactly: false
cleanup_result: fail
paid_proof_validator_result: fail
uat_unlocked: false

post_failure_remediation_status: complete_awaiting_new_paid_approval
post_failure_remediation_finished_at: 2026-07-20T16:47:19Z
cron_repair_approval_signal: approve restoring the score cron to active=true
cron_repair_rows_targeted: 1
cron_repair_jobid: 5
cron_repair_operation: cron.alter_job(job_id := 5, active := true)
cron_repair_score_tick_invocations: 0
cron_repair_rows_after: 1
cron_repair_active_after: true
cron_repair_schedule_after: * * * * *
cron_repair_command_md5_after: f90afe213d26135169ca316d8a8916c2
cron_repair_nodename_after: localhost
cron_repair_nodeport_after: 5432
cron_repair_database_after: postgres
cron_repair_username_after: postgres
cron_repair_full_digest_after: 1e6b9825c9e55c43fe9c963abb13fa12
cron_repair_matches_prerun_baseline: true
verifier_processes_after_failure: 0
manual_score_tick_invocations_after_failure: 0
fixtures_created_after_failure: 0
maintenance_runs_started_after_failure: 0
openai_calls_after_failure: 0
pagination_red_commit: 4210d0a
pagination_green_commit: bde942c
cron_restore_red_commit: 2944504
cron_restore_green_commit: 7189874
local_remediation_test_result: pass_12_of_12
rollout_validator_result_after_remediation: pass
web_lint_result_after_remediation: pass_with_existing_warning
web_build_result_after_remediation: pass
new_paid_run_approval_received: false

## Result

<!-- The one authorized verifier process attempt was consumed and failed during the full user_jobs snapshot, before the verifier created its two fixtures or began the maintenance latch. The score-tick path and OpenAI were never reached, and the read-only post-failure audit found zero AI-usage delta, unchanged user_jobs and target-preference digests, no latch, and zero verifier residue. -->

<!-- Cleanup did not restore the score cron: the restoration Management SQL request returned HTTP 400, and the exact post-cleanup assertion found the single cron row inactive with a changed digest. Task 2 therefore fails, Task 3 UAT remains blocked, and no verifier retry, manual tick, fallback, or legacy verifier is authorized. Any future attempt requires diagnosis, explicit cleanup/remediation authority, and a new paid-run approval. -->

## Post-failure remediation

<!-- The user separately authorized only restoration of the existing score cron to active=true. A bounded read identified the sole row and reproduced the failed-attempt digest. The active-only Management SQL call then restored jobid 5; a fresh full-row read reproduced the exact pre-run digest while command and every non-active field remained unchanged. The cron job and score-tick function were not invoked. -->

<!-- Local TDD now proves three corrections: all 2,992 rows are collected across three bounded hosted pages; the paid evidence CLI accepts the documented rollout-path plus proof-path interface and cross-checks their release identities; cron pause/restore SQL mutates only active before the existing full-row equality assertion. The failed paid attempt is not reclassified as passing, UAT remains locked, and any future verifier process requires a new explicit approval. -->

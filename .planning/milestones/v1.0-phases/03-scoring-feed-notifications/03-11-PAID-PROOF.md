# Plan 03-11 Paid Verifier Proof

<!-- status: pass -->
<!-- privacy: bounded release identities, UUIDs, counts, digests, timestamps, statuses, and prior bounded errors only; no secrets or raw row content -->
<!-- approval_signal: approve one new paid verifier run -->
<!-- invocation_command: node --env-file=scripts/.env --experimental-strip-types scripts/verify-scoring-freshness.ts -->
<!-- new_approval_process_attempts: 1; new_retry_count: 0; retry/fallback/legacy/manual tick: none -->
<!-- process_started_after: 2026-07-20T16:57:44.941481Z; process_finished_before: 2026-07-20T17:02:31.670279Z; exit_status: 0 -->
<!-- run_id: c8ea20a1-da8e-49ec-a9bf-6aab121828c1 -->
<!-- fixture_user_job_ids: 1b8de236-a3e8-4fd9-8807-ea42c4e1082d, b233a09f-af25-4864-a090-0a0793183efe -->
<!-- configured_ttl_seconds: 120; database_max_ttl_seconds: 300 -->
<!-- matching_claim: exactly the two registered fixture IDs; no-ID and mismatched claims: zero -->
<!-- late_event_isolation: late job did not seed; late preference and reroute signals did not widen the controlled claim -->
<!-- authenticated_write_denial: scoring fields, latch row, and latch-end RPC denied to authenticated -->
<!-- fixture_outcomes: positive freshly scored with a nonblank semantic input hash and cleared claimed revision; negative filtered free with title_non_overlap -->
<!-- exact desired/claimed revision numbers and preseed/protection affected-row counts were internal assertions not emitted before cleanup; no values are fabricated here -->
<!-- snapshot_before: user_jobs count 2992 digest e14ee71ce7eb40c6cef85cd240aad80e; target preferences count 1 digest c5afbcddf81ff7035041097d63e34c90 -->
<!-- snapshot_after: user_jobs count 2992 digest e14ee71ce7eb40c6cef85cd240aad80e; target preferences count 1 digest c5afbcddf81ff7035041097d63e34c90 -->
<!-- usage_before: all rows 230 digest 8587430b66d9b6f39626ec7f3db249f1; score rows 228 -->
<!-- usage_after: all rows 231 digest c280211d8f2cc132e8066b683e559eb0; score rows 229 -->
<!-- usage_delta: id f42bb79c-e1d9-4e56-a144-45c6dd0abd0d; target-owned; purpose score; model gpt-5.4-nano; one total delta and zero other deltas -->
<!-- cleanup: run latch absent; both fixture user_jobs absent; verify-pattern jobs/user_jobs absent; zero residue -->
<!-- cron_after: one active row; full-row digest 1e6b9825c9e55c43fe9c963abb13fa12 exactly equals pre-run baseline -->

evidence_mode: paid
local_git_sha: c15ad867f5714862192c8e95099e755d90963566
origin_git_sha: c15ad867f5714862192c8e95099e755d90963566
migration_head: 0025
migration_0025_applied: true
score_tick_deployment_id: ae6c147f-c3a8-417e-8057-d4105ac9aed5
score_tick_version: 3
cloudflare_deployment_id: 2b3cb77f-9043-4fc8-b9dc-b57e1565ceed
cloudflare_url: https://2b3cb77f.job-helper-qs9.pages.dev
cloudflare_status: success
asset_url: /assets/index-BxwGvdK2.js
asset_sha256: b29c1297c2945749aa4b2ed891567ca352ee643947126db3cfed867f815175af
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
local_safety_command: node --experimental-strip-types --test scripts/verify-scoring-freshness.test.mjs scripts/verify-scoring-evidence.test.mjs && git diff --exit-code -- scripts/verify-scoring.ts && cd web && npx vitest run tests/notification-removal.test.ts
local_safety_result: pass
paid_verifier_runs: 1
manual_score_tick_invocations: 0
maintenance_runs_started: 1
openai_calls_by_plan_03_10: 0
rollout_local_git_sha: c15ad867f5714862192c8e95099e755d90963566
rollout_origin_git_sha: c15ad867f5714862192c8e95099e755d90963566
rollout_migration_head: 0025
rollout_score_tick_deployment_id: ae6c147f-c3a8-417e-8057-d4105ac9aed5
rollout_cloudflare_deployment_id: 2b3cb77f-9043-4fc8-b9dc-b57e1565ceed
rollout_asset_sha256: b29c1297c2945749aa4b2ed891567ca352ee643947126db3cfed867f815175af
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

## Prior consumed attempt — retained history

<!-- prior_approval_signal: approve one paid verifier run -->
<!-- prior_process_window: after 2026-07-20T16:35:33.308962Z and before 2026-07-20T16:37:48.517278Z -->
<!-- prior_result: fail; exit 1; invocation 1; retry 0 -->
<!-- prior_failure: user_jobs snapshot truncated at the hosted response limit; cleanup Management SQL returned HTTP 400 and left the score cron inactive -->
<!-- prior_effects: fixtures 0; maintenance runs 0; score-tick invocations 0; OpenAI calls 0; global usage 230 to 230 with identical digest beebdc2f597d37976dac0e4a581add6e -->
<!-- prior_restoration: user_jobs 2992 to 2992 digest af749f1a2138303cebed6d26605633c1; target preferences 1 to 1 digest 2448fc173ee1ee5e010c4781d137b027; latch/residue zero -->
<!-- prior_cleanup_blocker: cron active false; digest d5f8baaa4cfe1be9e17b48e655155f11 instead of baseline 1e6b9825c9e55c43fe9c963abb13fa12 -->

## Prior remediation — retained history

<!-- cron_repair_approval_signal: approve restoring the score cron to active=true -->
<!-- cron_repair: jobid 5 active-only cron.alter_job; exact full-row baseline digest 1e6b9825c9e55c43fe9c963abb13fa12 restored; no cron/function invocation -->
<!-- remediation_commits: 4210d0a pagination/validator RED; bde942c bounded pagination/two-path validator fix; 2944504 cron restoration RED; 7189874 active-only restoration fix; 8edf45b remediation evidence -->
<!-- remediation_verification: 12/12 no-network tests, rollout validator, web lint with one existing warning, and web build passed -->
<!-- historical_integrity: the prior attempt remains failed and consumed; this proof records one separately approved new attempt and does not reclassify the prior failure -->

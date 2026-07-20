# Phase 3 Final Rollout Evidence

<!-- status: pass -->
<!-- approved rollout sequence: score-tick v6 and extract-resume v3 were deployed under explicit approval; later commits changed only verifier/evidence tooling -->
<!-- exact app release: origin/main 020295200ff3e48db4d685f5382c10f406ca7967; Cloudflare production deployment 877499ee-f1ad-4067-b8f2-b5c152954141 -->
<!-- migration inventory: remote and local 0001-0027 present; no migration was applied during this final rollout -->
<!-- edge inventory: score-tick ACTIVE v6 verify_jwt false; extract-resume ACTIVE v3 verify_jwt false; both retain x-cron-secret handler boundaries -->
<!-- immutable asset and production alias served identical 574383-byte JavaScript and SHA-256 -->
<!-- rollout effects: no paid verifier process, manual score tick, latch, account, fixture, or OpenAI request was started by this artifact -->

evidence_mode: rollout
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
paid_verifier_runs: 0
manual_score_tick_invocations: 0
maintenance_runs_started: 0
openai_calls_by_plan_03_10: 0

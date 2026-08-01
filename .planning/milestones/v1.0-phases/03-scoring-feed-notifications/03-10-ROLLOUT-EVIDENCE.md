# Plan 03-10 Rollout Evidence

<!-- approved_scope: migration 0025; score-tick only; exact origin/main push; resulting Cloudflare production deployment and read-only checks -->
<!-- migration_inventory: remote 0001-0025 present; local 0026 remains pending and was not applied -->
<!-- score_tick_inventory: id ae6c147f-c3a8-417e-8057-d4105ac9aed5; ACTIVE; version 3; verify_jwt false; x-cron-secret handler boundary retained; not invoked -->
<!-- cloudflare_identity: account c3989e46150d3e2dda972af220a69867; project job-helper; deployment 2b3cb77f-9043-4fc8-b9dc-b57e1565ceed; environment production; branch main; trigger github:push; commit_dirty false -->
<!-- cloudflare_check: GitHub check-run 88408784403 completed successfully for the exact commit -->
<!-- cloudflare_alias: https://job-helper-qs9.pages.dev served the same immutable asset as the deployment URL -->
<!-- maintenance_inventory: table RLS enabled; begin/end/claim(integer,uuid) present; legacy claim(integer) absent; table and routine grants only postgres/service_role; expires_at constrained to created_at plus 00:05:00 -->
<!-- notification_absence: hosted notify function, dedicated secrets, tables, claim RPC, tuning columns, and cron absent; local client/UI source exposes only one-time legacy worker unregistration cleanup -->
<!-- zero_effects: neither production verifier was run; score-tick was not manually invoked; no latch/fixture was created; no OpenAI request was made -->

evidence_mode: rollout
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
paid_verifier_runs: 0
manual_score_tick_invocations: 0
maintenance_runs_started: 0
openai_calls_by_plan_03_10: 0

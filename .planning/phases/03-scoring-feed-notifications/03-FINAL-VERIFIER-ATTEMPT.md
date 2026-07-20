# Phase 3 Final-Release Verifier Attempt

status: failed_before_verifier_tick
approval_signal: approve
invocation_command: node --env-file=scripts/.env --experimental-strip-types /private/tmp/phase3-final-verifier.mjs
launcher_sha256: bcb5ee2c04cd318a33dc840c2047918f04d591aae9140726348a3e99245b6d55
git_sha: 51de0b0991628b70bc029eec8e472764c6fb7933
migration_head: 0027
score_tick_deployment_id: ae6c147f-c3a8-417e-8057-d4105ac9aed5
score_tick_version: 6
extract_resume_deployment_id: 9358db1a-95fc-49bc-a684-b98fb8eceff9
extract_resume_version: 3
cloudflare_deployment_id: d5953f81-f1a7-4bd7-a2a3-1647b83482cd
cloudflare_url: https://d5953f81.job-helper-qs9.pages.dev
asset_path: /assets/index-lyvShdhx.js
asset_sha256: a6f11edc4d18ed264233d5d17e2fd2005e9064036ec09409cf95761498013d66
verifier_process_attempts: 1
verifier_tick_invocations: 0
verifier_fixture_jobs_created: 0
maintenance_runs_started: 0
openai_calls_by_verifier_process: 0
failure: score work quiescence is unprovable
cron_restored_active: true
maintenance_residue_count: 0
fixture_residue_count: 0

## Incident and containment

The approved verifier process paused the production score cron, found recently
claimed ordinary score work, failed closed before fixture creation or verifier
tick invocation, and restored the cron. The process was not retried.

The separately provisioned dedicated account had been left eligible for the
normal minute cron before this process began. The cron therefore created 60
target-owned score-usage rows between `2026-07-20T20:26:03.349213Z` and
`2026-07-20T20:30:12.086288Z`. These were background cron calls, not calls made
by the failed verifier process, but they were unintended verifier-account spend.

Containment deleted only the service-tagged synthetic verifier auth account.
Its resume and user-job rows cascaded to zero; the immutable usage ledger was
retained. A delayed read-only audit confirmed the usage count stayed at 60,
the account and its user-job rows stayed absent, the maintenance latch count
was zero, and the real score cron was active.

## Local corrective change

The verifier now:

1. snapshots and pauses the real score cron before creating any verifier user;
2. performs one bounded drain check for an already-dispatched worker;
3. creates a new service-tagged disposable account only while the cron is paused;
4. writes a fail-closed target-title preference before its synthetic ready resume;
5. deletes the disposable account before restoring the cron, including failure paths.

No additional production invocation is authorized by this corrective work.
The corrected verifier passed 13/13 verifier/evidence tests, 409/409 web tests,
lint with one pre-existing Fast Refresh warning, and the production build.

## Replacement attempt on `f40c2eb`

status: failed_before_verifier_account
approval_signal: approve
invocation_command: node --env-file=scripts/.env --experimental-strip-types scripts/verify-scoring-freshness.ts
git_sha: f40c2ebc121cdaec41790f2c71bbb629bda7272f
cloudflare_deployment_id: 05e7f5e6-bd14-4c75-a86e-be94036895f2
verifier_process_attempts: 1
verifier_tick_invocations: 0
verifier_fixture_jobs_created: 0
maintenance_runs_started: 0
openai_calls_by_verifier_process: 0
failure: Dedicated verifier account creation failed
budget_before: 358
budget_after: 358
cron_restored_active: true
maintenance_residue_count: 0
verifier_auth_residue_count: 0

The separately approved replacement process was consumed and was not retried.
It paused and drained the cron, then failed closed while attempting to recreate
the previously deleted fixed-email verifier identity. Cleanup restored the cron;
no account, fixture, latch, verifier tick, or paid request was created.

The next local correction uses a short per-run email nonce so a deleted identity
is never reused. The account remains service-tagged, is still created only after
cron pause/drain, and is still deleted before cron restoration.

## Zero-paid auth preflight on `96c58db`

status: failed_before_account_creation
approval_signal: approve
git_sha: 96c58db
account_created: false
resume_created: false
score_tick_invocations: 0
openai_calls_by_preflight: 0
verifier_auth_residue_count: 0
maintenance_residue_count: 0
cron_restored_active: true
global_request_ledger_at_audit: 359
failure: bcrypt password length exceeds 72 bytes

The one approved zero-paid auth preflight used a unique service-tagged identity
and no resume, but Supabase Auth rejected it before insertion. A narrow read-only
Auth log query identified the exact server panic: the generated password was 77
bytes and exceeded bcrypt's 72-byte maximum. The healthy `handle_new_user`
trigger, profile constraints, two real auth users, and zero verifier users ruled
out the earlier deleted-email hypothesis. The global ledger moved once while the
ordinary cron remained active; the preflight could not cause an OpenAI call
because no auth user or resume was created.

The local correction now generates a 40-byte password and enforces a 12–72 byte
invariant in a dedicated regression test.

## Successful zero-paid auth preflight on `d5805a9`

status: pass
approval_signal: approve
git_sha: d5805a933ecd1523618559106c537feb369833c2
cloudflare_deployment_id: 1d9bc36d-80b3-4ef3-a77a-aa42ef2b970b
cloudflare_url: https://1d9bc36d.job-helper-qs9.pages.dev
asset_path: /assets/index-lyvShdhx.js
asset_sha256: a6f11edc4d18ed264233d5d17e2fd2005e9064036ec09409cf95761498013d66
password_bytes: 40
account_created: true
account_deleted: true
resume_created: false
score_tick_invocations: 0
openai_calls_by_preflight: 0
budget_after: 359
cron_active_after: true
maintenance_residue_count: 0
verifier_auth_residue_count: 0

The corrected password was accepted. The one service-tagged preflight account
was deleted immediately without a resume, worker invocation, latch, or OpenAI
request. The production alias and immutable deployment served the same asset
bytes and SHA-256.

## Paid verifier transport failure on `d5805a9`

status: failed_after_one_owned_paid_call
approval_signal: approve
invocation_command: node --env-file=scripts/.env --experimental-strip-types scripts/verify-scoring-freshness.ts
git_sha: d5805a933ecd1523618559106c537feb369833c2
verifier_process_attempts: 1
verifier_owned_score_usage: 1
verifier_model: gpt-5.4-nano
verifier_usage_at: 2026-07-20T20:47:42.592695Z
failure: ERR_HTTP2_GOAWAY_SESSION
automatic_cleanup_complete: false
manual_exact_cleanup_complete: true
cron_active_after: true
maintenance_residue_count: 0
verifier_auth_residue_count: 0
verifier_profile_residue_count: 0
verifier_preference_residue_count: 0
verifier_resume_residue_count: 0
verifier_extract_residue_count: 0
verifier_user_job_residue_count: 0
fixture_job_residue_count: 0
global_request_ledger_at_final_audit: 364

The one approved process entered its bounded drain and was monitored through the
same process session without restart. It created the disposable verifier and
made exactly one target-owned paid scoring request, then Node's long-lived HTTP/2
session received GOAWAY during post-call verification/cleanup. The process was
not retried and is not classified as passing proof.

The failing cleanup reported tracked user-job deletion, zero-residue assertion,
and verifier-account inventory errors. A read-only audit found one tagged account,
1,671 verifier user-job rows, and exactly three validated `verify-*` jobs on
`example.invalid`; the latch was already absent and cron was active. Manual
containment deleted only the tagged account and those three exact fixture jobs.
A final audit proved every verifier-owned mutable table and fixture count was zero.
The immutable target-owned usage ledger row remains as audit evidence.

The local transport correction pins all verifier Supabase, Management API, and
score-tick requests to fresh HTTPS/1.1 connections (`agent: false`) so a drained
HTTP/2 session cannot be reused during evidence or cleanup.

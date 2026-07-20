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

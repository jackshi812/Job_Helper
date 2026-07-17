# Phase 2: User Setup Required

**Generated:** 2026-07-17
**Phase:** 02-watchlist-ingestion-monitoring
**Status:** Complete

The Supabase Vault configuration required by Plan 02-02 and the external-service setup required by Plan 02-03 are complete.

## Environment Variables

| Status | Variable | Source | Add to |
|--------|----------|--------|--------|
| [x] | `CRON_SECRET` | Generated once locally | Supabase Edge Function secrets and gitignored `scripts/.env` |
| [x] | `HEARTBEAT_SECRET` | Generated once locally | Supabase Edge Function secrets and gitignored `scripts/.env` |
| [x] | `ADZUNA_APP_ID` | Adzuna developer application | Supabase Edge Function secrets and gitignored `scripts/.env` |
| [x] | `ADZUNA_APP_KEY` | Adzuna developer application | Supabase Edge Function secrets and gitignored `scripts/.env` |

## Dashboard Configuration

- [x] **Create the scheduler Vault secrets**
  - Location: Supabase Dashboard → SQL Editor
  - `project_url` contains the linked project URL.
  - `cron_secret` contains the same existing value used by the Edge Function and gitignored verification environment.
  - Secret values are intentionally not recorded in this file.
- [x] **Create the external heartbeat monitor**
  - Location: cron-job.org.
  - Runs every 5-10 minutes against the secret-gated heartbeat URL.
  - Failure, recovery, and automatic-disable notifications are enabled.
  - Failure email delivery was proven; recovery email delivery was explicitly waived by the user and remains unverified.

## Verification

- The hosted `poll-tick` function is active with JWT verification disabled and its own `x-cron-secret` authorization gate.
- Missing or incorrect scheduler secrets return HTTP 401.
- `pipeline_heartbeat.last_tick_at` advanced from `2026-07-17T03:44:00.667Z` to `2026-07-17T03:45:00.309Z` without a manual invocation, proving the Vault-backed cron call succeeds.
- The credentialed Adzuna sweep completed all configured seed queries and the hosted verification script passed probes 1-12.
- cron-job.org recorded scheduled HTTP 401 failures and sent a failure email; after restoring the secret URL it recorded HTTP 200 recovery. Recovery-email receipt was not proven.

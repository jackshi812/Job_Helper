# Phase 2: User Setup Required

**Generated:** 2026-07-17
**Phase:** 02-watchlist-ingestion-monitoring
**Status:** Complete

The Supabase Vault configuration required by Plan 02-02 is complete.

## Environment Variables

| Status | Variable | Source | Add to |
|--------|----------|--------|--------|
| [x] | `CRON_SECRET` | Generated once locally | Supabase Edge Function secrets and gitignored `scripts/.env` |

## Dashboard Configuration

- [x] **Create the scheduler Vault secrets**
  - Location: Supabase Dashboard → SQL Editor
  - `project_url` contains the linked project URL.
  - `cron_secret` contains the same existing value used by the Edge Function and gitignored verification environment.
  - Secret values are intentionally not recorded in this file.

## Verification

- The hosted `poll-tick` function is active with JWT verification disabled and its own `x-cron-secret` authorization gate.
- Missing or incorrect scheduler secrets return HTTP 401.
- `pipeline_heartbeat.last_tick_at` advanced from `2026-07-17T03:44:00.667Z` to `2026-07-17T03:45:00.309Z` without a manual invocation, proving the Vault-backed cron call succeeds.


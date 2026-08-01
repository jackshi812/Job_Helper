---
phase: 02-watchlist-ingestion-monitoring
reviewed: 2026-07-17T19:06:55Z
depth: standard
files_reviewed: 35
files_reviewed_list:
  - supabase/migrations/0005_watchlist.sql
  - supabase/functions/_shared/detect.ts
  - supabase/functions/verify-board/index.ts
  - web/tests/detect.test.ts
  - web/src/lib/watchlist.ts
  - web/src/lib/watchlist.test.ts
  - scripts/verify-watchlist.ts
  - web/src/pages/Watchlist.tsx
  - supabase/functions/_shared/adapters/types.ts
  - supabase/functions/_shared/adapters/greenhouse.ts
  - supabase/functions/_shared/adapters/lever.ts
  - supabase/functions/_shared/adapters/ashby.ts
  - supabase/functions/_shared/adapters/adzuna.ts
  - supabase/functions/_shared/dedup.ts
  - supabase/functions/_shared/lifecycle.ts
  - supabase/functions/_shared/discovery-health.ts
  - web/tests/adapters.test.ts
  - web/tests/dedup.test.ts
  - web/tests/adzuna.test.ts
  - web/tests/lifecycle.test.ts
  - web/tests/discovery-health.test.ts
  - supabase/migrations/0006_jobs_pipeline.sql
  - supabase/migrations/0007_discovery.sql
  - supabase/migrations/0008_claim_exclusive.sql
  - supabase/migrations/0009_discovery_health_cadence.sql
  - supabase/migrations/0010_atomic_discovery_reservations.sql
  - supabase/migrations/0011_lock_before_quota_clock.sql
  - supabase/functions/poll-tick/index.ts
  - supabase/functions/discovery-sweep/index.ts
  - supabase/functions/heartbeat/index.ts
  - scripts/verify-pipeline.ts
  - supabase/config.toml
  - web/src/lib/pipeline.ts
  - web/src/lib/pipeline.test.ts
  - web/src/components/Shell.tsx
findings:
  critical: 0
  warning: 0
  info: 0
  total: 0
status: clean
---

# Phase 2: Code Review Report

**Reviewed:** 2026-07-17T19:06:55Z
**Depth:** standard
**Files Reviewed:** 35
**Status:** clean

## Narrative Findings (AI reviewer)

## Summary

All reviewed files meet quality standards. No issues found.

The final three warnings are resolved without introducing a new correctness or security defect:

- Adzuna age-out now uses `last_seen_at`, so a returned exact-ID row is reopened with only lifecycle fields changed and remains open through the same sweep while its first-sight snapshot stays immutable.
- The sweep materializes distinct seeds, reports `skippedQueries`, and classifies any partially quota-skipped run as `degraded`; an all-attempted-failed run remains `failed`, while a zero-attempt budget stop remains an explicit skip whose stale timestamp is caught by freshness monitoring.
- Migration 0011 acquires the singleton heartbeat row lock before evaluating `clock_timestamp()` for the UTC ledger date, preserving atomic rollover accounting. The replacement function retains an empty search path and service-role-only execution.

The earlier fixes also remain sound: scheduled Chicago slots are admitted at most once under row locking, per-request quota reservation is atomic, discovery freshness follows the DST-safe Chicago cadence, missing credentials fail visibly, degraded health reaches the banner with appropriate priority, closed Adzuna exact IDs preserve immutable fields, and duplicate-ingestion verification is company-scoped.

---

_Reviewed: 2026-07-17T19:06:55Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_

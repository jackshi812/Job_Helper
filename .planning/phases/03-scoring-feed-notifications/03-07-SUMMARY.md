---
phase: 03-scoring-feed-notifications
plan: 07
subsystem: feed-only-closeout
tags: [scoring, feed, notification-removal, hosted-verification, uat-gap]
status: implementation_complete_with_uat_gap
requirements: [PREF-01, RESU-01, SCOR-01, SCOR-02, SCOR-03, SCOR-04, SCOR-05]
completed: 2026-07-20
provides:
  - "Notification subsystem removed locally and from hosted Supabase/Cloudflare scope"
  - "Feed-only release bound to exact origin commit, deployment, asset, and migration evidence"
  - "One approved hosted scoring verifier run with all 24 assertions passing"
affects:
  - "Plans 03-08 through 03-11 close the diagnosed title relevance, freshness, and company-display UAT gap"
---

# Phase 3 Plan 07: Feed-only Closeout Summary

Plan 07 implementation and hosted cleanup are complete. Human UAT began and found one major relevance defect; that failed truth is diagnosed in `03-UAT.md` and transferred into executable gap plans 03-08 through 03-11. This summary does not claim Phase 3 or UAT completion.

## Completed Work

- Removed the notification Edge Function, sender helpers, service worker, push client, notification controls/tests/verifier, VAPID generator, and local VAPID material.
- Applied migration 0024: notification cron unscheduled, account deletion preserved, notification RPC/tables dropped, and notification preference columns removed.
- Deleted hosted `notify-tick`; confirmed its endpoint returns 404.
- Confirmed hosted `notifications` and `push_subscriptions` are absent (`PGRST205`).
- Confirmed `VAPID_KEYS`, `RESEND_API_KEY`, `RESEND_FROM`, and Cloudflare `VITE_VAPID_PUBLIC_KEY` are absent.
- Ran the hosted scoring verifier exactly once under approval: 24/24 assertions passed, including cron-secret rejection, two-user RLS, extraction readiness, token-only usage, scoring shape, and refilter restoration.

## Release Evidence

- Local/origin release commit: `2547608b8bf25e7bdb779bdf00542c524cd9ffc3`
- Hosted migration head: `0024`
- Cloudflare deployment: `d2cc3239-c5da-4c83-836a-a17ce050853a`
- Immutable asset: `/assets/index-DN4oCAxv.js`
- Asset SHA-256: `8050578007096e08af609653d30f4363e0b0a90162d9c5e8c33b0a37646703f1`
- Notification feature markers in the live asset: absent

## UAT Result and Transfer

- Dashboard/feed opening passed.
- Hosted scoring pipeline verification passed.
- Preference-save UAT failed: an exclusive `Equity Research` target still showed data-related roles after refresh.
- Root cause: one-token title overlap plus partial asynchronous refiltering and preference-unaware feed visibility can preserve unrelated or stale scores.
- Diagnosis: `.planning/debug/equity-research-title-filter.md`.
- Closure work: Plans 03-08 through 03-11 add provider-agnostic filtering, semantic freshness/CAS, truthful company-name persistence/display, cache invalidation, bounded rollout proof, and resumed human UAT.

## Scope Decision

- Notifications remain removed and must not be rebuilt.
- Adzuna, Greenhouse, and Ashby remain in one unified dashboard.
- Provider-specific pages/tabs are deferred; the current work fixes missing company names and relevance filtering instead.

## Self-Check

Implementation/deployment evidence is complete. Phase completion remains open until Plans 03-08 through 03-11 execute and the pending UAT tests pass.

---
*Phase: 03-scoring-feed-notifications*
*Completed implementation: 2026-07-20*

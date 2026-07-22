---
created: 2026-07-20T21:25:34.579Z
title: Refine company visibility controls
area: ui
files:
  - web/src/pages/Dashboard.tsx
  - web/src/lib/feed.ts
  - web/src/lib/feed.test.ts
---

## Problem

Phase 03.2 added a staged, session-only company checklist for the current feed. Its footer currently exposes Reset, which is not the bulk-selection model the user wants.

## Solution

Keep the truthful current-feed company checklist and its session-only, staged Show results behavior. Replace Reset with two explicit bulk actions inside the company panel:

- `Clear all` unchecks every currently listed company in the draft.
- `Select all` checks every currently listed company in the draft.

Both actions affect only the draft until Show results is pressed. Newly refreshed companies remain selected by default, and no company control changes ingestion, matching, scoring, or future employer discovery.

Acceptance requires accessible bulk-action labels, correct disabled states when everything is already clear/selected, predictable empty-result messaging after applying Clear all, and correct composition with score-tier filters, sorting, dismissal, and Show dismissed.

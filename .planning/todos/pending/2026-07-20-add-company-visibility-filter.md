---
created: 2026-07-20T21:25:34.579Z
title: Add company visibility filter
area: ui
files:
  - web/src/pages/Dashboard.tsx
  - web/src/lib/feed.ts
  - web/src/lib/feed.test.ts
---

## Problem

The unified dashboard mixes jobs from many employers without a quick way to reveal or hide selected companies. The user wants checkbox controls that can be clicked and unclicked to change which companies are visible without changing matching, scoring, or source ingestion.

## Solution

Add a company filter derived from the truthful company names present in the current preference-passing feed. Each company has a checkbox: checked reveals its jobs and unchecked hides them. Default to all companies selected, keep Focused versus All jobs semantics unchanged, and apply company visibility after authorization/preference eligibility so unchecked companies are hidden rather than discarded or rescored. Define predictable behavior for newly arriving companies and an empty selection, and include accessible labels plus convenient select-all/clear-all controls if the list becomes long.

Acceptance requires checkbox changes to update the visible rows immediately, preserve the choice across Dashboard navigation/refresh for the same user, never expose identity-less or preference-failing rows, and compose correctly with Focused, All jobs, score sorting, dismissal, and Show dismissed.

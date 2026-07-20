---
created: 2026-07-20T20:04:31.233Z
title: Add entry-level-only job preference filter
area: ui
files:
  - web/src/pages/Preferences.tsx
  - web/src/lib/preferences.ts
  - supabase/functions/_shared/filters.ts
  - supabase/functions/score-tick/index.ts
  - supabase/migrations/
---

## Problem

The dashboard can show preference-relevant but senior roles such as Director, Analytics, Data Engineering. The user is seeking entry-level work and wants senior positions removed before they reach either All jobs or Focused. Title matching alone does not reliably capture required experience stated inside the job description.

## Solution

Add an explicit `Entry level only` preference and enforce it in the free pre-AI eligibility filter. Reject unambiguously senior titles such as Director, VP, Head, Principal, Staff, Senior, Lead, and Manager, with carefully tested exceptions where needed. Parse required-experience language separately from preferred/nice-to-have language; hard-reject roles requiring 5 or more years, while treating ambiguous 3-4 year requirements conservatively to avoid false exclusions. Persist a specific filter reason, invalidate affected rows on preference changes, and cover title, years-required, years-preferred, range, and false-positive fixtures across all providers.

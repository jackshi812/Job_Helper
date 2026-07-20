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

The Focused dashboard can show preference-relevant but senior roles such as Director, Analytics, Data Engineering. The user is seeking entry-level work and wants Focused to contain only entry-level jobs whose explicit required-experience minimum is less than three years. Title matching alone does not reliably capture required experience stated inside the job description.

## Solution

Add an explicit `Entry level only` preference and make it control Focused visibility. Reject unambiguously senior titles such as Director, VP, Head, Principal, Staff, Senior, Lead, and Manager, with carefully tested exceptions where needed. Parse required-experience language separately from preferred/nice-to-have language and reject Focused candidates whose explicit required minimum is three or more years. Do not reject solely for preferred, desired, or nice-to-have experience. Treat ambiguous ranges and conflicting requirements conservatively and expose a specific reason instead of silently guessing.

Keep the existing All jobs contract unchanged unless the owner later decides otherwise: it remains the set of preference-passing jobs regardless of score. Persist the entry-level decision inputs, invalidate affected rows when the preference changes, and cover senior-title, required-years, preferred-years, ranges, missing-years, and provider-neutral fixtures. Acceptance requires zero clearly senior or 3+-years-required roles in Focused after refiltering.

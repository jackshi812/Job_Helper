---
created: 2026-07-20T20:04:31.233Z
title: Replace experience cap with title exclusions
area: ui
files:
  - web/src/pages/Preferences.tsx
  - web/src/lib/preferences.ts
  - supabase/functions/_shared/filters.ts
  - supabase/functions/score-tick/index.ts
  - supabase/migrations/
---

## Problem

Phase 03.2 added a maximum required-experience preference and description parser. The user no longer wants experience years configured in Preferences. They want a simpler user-managed filter that excludes jobs when configured keywords occur in the job title.

## Solution

Remove the maximum required-experience control from Preferences and stop using that setting to filter jobs. Replace it with a persisted list of excluded job-title keywords, initially seeded with:

- `president`
- `PhD`

Match case-insensitively against job titles only, with clear token/phrase boundaries so short keywords do not match inside unrelated words. Let the user add and remove keywords later; the seed values are defaults, not a hard-coded permanent list. Preference changes should reuse the existing refilter lifecycle and expose a specific bounded reason for title-keyword exclusions.

Plan the transition of the existing `max_required_experience` field and `experience_above_max` outcome deliberately: remove them from active UI/scoring behavior without losing deployment safety, and decide whether a later migration should delete or retain the dormant column. Cover default seeding, case-insensitive title matching, whole-word/phrase boundaries, user edits, refiltering, and provider-neutral behavior.

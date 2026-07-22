---
created: 2026-07-22T23:08:14.485Z
title: Consolidate score tier controls
area: ui
files:
  - web/src/pages/Dashboard.tsx
  - web/src/lib/dashboard.ts
  - web/src/pages/Dashboard.test.tsx
---

## Problem

Strong, Good, and Weak currently occupy three separate Dashboard buttons. The user wants the score filters grouped into one compact control so the table toolbar is easier to scan and uses less horizontal space.

## Solution

Replace the three standalone tier buttons with one accessible score-tier dropdown containing Strong, Good, and Weak selections. Preserve the current default of all tiers selected, multi-select filtering, AND composition with company visibility, live result counts, keyboard access, and clear selected-state feedback when the dropdown is closed.

The control should handle zero, one, two, or all tiers selected without ambiguity and retain the session-only persistence boundary established in Phase 03.2.

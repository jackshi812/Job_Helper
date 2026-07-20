---
created: 2026-07-20T20:04:31.233Z
title: Pilot Workday polling for 10 companies
area: api
files:
  - supabase/functions/discovery-sweep/index.ts
  - supabase/functions/_shared/adapters/workday.ts
  - supabase/migrations/
---

## Problem

The user wants Job Copilot to monitor and poll job opportunities from an initial set of 10 companies that use Workday. Current Phase 02.1 evidence keeps Workday experimental and unclaimable because the public CXS contract is undocumented, so expanding it requires a deliberate safety and reliability design rather than simply enabling the existing Capital One experiment.

## Solution

Plan a bounded 10-company Workday pilot. Have the user select the 10 companies, derive and verify each tenant/site identity server-side, and validate pagination, completeness, rate limits, truthful company identity, deduplication, lifecycle closure safety, and degraded-source behavior. Preserve the existing fail-closed rule until repeatable positive evidence supports scheduled polling; do not let one company's Workday configuration generalize implicitly to another tenant.

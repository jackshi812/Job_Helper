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

The user wants Job Copilot to successfully add, implement, and continuously monitor an initial set of 10 companies that use Workday before Phase 4 begins. The first four named companies are BMO, Capital One, Avant, and PIMCO; six company names are still required. Current Phase 02.1 evidence keeps Workday experimental and unclaimable because the public CXS contract is undocumented, so expanding it requires a deliberate safety and reliability design rather than simply enabling the existing Capital One experiment.

## Solution

Plan and implement a bounded 10-company Workday pilot. Confirm that each named employer currently uses a supported Workday careers tenant, derive and verify every tenant/site identity server-side, and validate pagination, completeness, rate limits, truthful company identity, deduplication, lifecycle closure safety, and degraded-source behavior independently per tenant. Add recurring scheduler claims and visible health only after repeatable positive evidence supports them. Preserve the fail-closed rule when any tenant drifts, becomes incomplete, or returns an implausibly empty result; one company's successful Workday configuration must never authorize another tenant implicitly.

Acceptance requires all 10 configured companies to have a truthful supported/degraded state, scheduled monitoring for every proven-safe tenant, job ingestion into the unified feed, and regression evidence that one failing tenant cannot close jobs or block the others.

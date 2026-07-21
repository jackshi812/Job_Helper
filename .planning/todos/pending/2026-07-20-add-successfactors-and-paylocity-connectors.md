---
created: 2026-07-20T21:25:34.579Z
title: Add SuccessFactors and Paylocity connectors
area: api
files:
  - supabase/functions/_shared/adapters/
  - supabase/functions/_shared/connectors.ts
  - supabase/functions/poll-tick/index.ts
  - supabase/functions/verify-board/index.ts
  - supabase/migrations/
---

> **Scope reset, 2026-07-20 (owner decision):** Both Paylocity and SAP SuccessFactors are
> planned in Phase 03.1. New Workday expansion is deferred. SuccessFactors remains bounded
> to exact employer-specific proof: a tenant without a safe, repeatable public contract is
> recorded as `unsupported_with_reason`, never generalized into an HTML scraper.

## Problem

Job Copilot cannot yet consistently verify, ingest, and monitor employers hosted on SAP SuccessFactors or Paylocity Recruiting. The user wants both ATS families added before Phase 4 so those companies can participate in the same truthful, deduplicated job pipeline as existing providers.

## Solution

Research and implement one closed, server-authoritative connector contract per provider. Identify safe canonical URL patterns and server-derived tenant identities; reject unsafe or unsupported variants before network access. Each adapter must provide bounded pagination, schema/content validation, truthful company identity, stable external IDs, complete-snapshot evidence, deduplication compatibility, lifecycle closure credibility, rate/deadline limits, and degraded-source behavior. Add verify-board support, registry/claim eligibility, polling dispatch, fixtures, hosted evidence, and visible source health only after the provider-specific contract passes.

Acceptance requires representative real employers for both SAP SuccessFactors and Paylocity Recruiting to ingest jobs repeatedly without duplicates, preserve existing jobs on incomplete/failed observations, and recover cleanly when the source becomes healthy again.

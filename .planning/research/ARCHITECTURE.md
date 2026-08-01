# Architecture Research

**Domain:** Application-scoped public-profile discovery
**Researched:** 2026-07-28
**Confidence:** HIGH for internal architecture; MEDIUM for external provider

## System Overview

```text
┌──────────────────────── Cloudflare Pages ────────────────────────┐
│ Tracker expanded row            Outreach profile route          │
│ request / refresh / clear       confirmed education + work      │
└───────────────┬──────────────────────────┬───────────────────────┘
                │ authenticated Supabase client
                ▼
┌──────────────────────── Supabase boundary ───────────────────────┐
│ Postgres RPCs + RLS             Authenticated Edge Function     │
│ stage/profile/request/result    search-outreach                 │
│ ownership + quota + lifecycle   query → validate → rank         │
└───────────────┬──────────────────────────┬───────────────────────┘
                │                          │ secret-bearing fetch
                │                          ▼
                │                 ┌──────────────────────┐
                │                 │ Search adapter       │
                │                 │ Tavily spike first   │
                │                 └──────────┬───────────┘
                │                            │ transient hits only
                ▼                            ▼
┌──────────────────────── Deterministic core ──────────────────────┐
│ URL validation → evidence extraction → eligibility → score       │
│ 35 title / 30 academic / 15 usefulness / 10 timing / 5 / 5      │
│ → top 1–5 → bounded title-inclusive reason                       │
└────────────────────────────────┬─────────────────────────────────┘
                                 │ atomic finalization
                                 ▼
┌──────────────────────── Owner-scoped storage ────────────────────┐
│ Search status + minimal metadata                                 │
│ Result position + LinkedIn URL + short match reason              │
│ No source payload, profile copy, score, or separate person name  │
└──────────────────────────────────────────────────────────────────┘
```

## Components and Responsibilities

| Component | Responsibility | Implementation |
|-----------|----------------|----------------|
| Outreach profile UI | Collect explicit user facts and dates | New route/components using existing form conventions |
| Tracker outreach panel | Request, refresh, clear, render states/results | Section inside existing expanded Tracker row |
| Profile RPCs | Validate and mutate only the authenticated user's profile | `security definer` RPCs with explicit `auth.uid()` checks |
| Search admission RPC | Validate application ownership/stage/profile and open one request | Transactional Postgres function |
| Provider quota RPC | Atomically reserve each external call | Date-bucketed user/global ledger |
| Search Edge Function | Authenticate, build bounded queries, call provider, orchestrate pure pipeline | One user-invoked Supabase Edge Function |
| Provider adapter | Hide vendor request/response shape | Native-fetch TypeScript interface |
| Evidence parser | Normalize URL/title/snippet and identify direct facts | Pure TypeScript, bounded strings |
| Eligibility/ranker | Reject unrelated/excessively senior candidates and apply locked score | Pure TypeScript with exhaustive fixtures |
| Reason formatter | Select strongest supported signals | Pure deterministic function |
| Finalization RPC | Replace results atomically or record unknown state | Owner/request-token scoped function |
| Lifecycle trigger | Delete results on terminal stage | Database trigger on projected application stage |

## Recommended Data Model

Names are illustrative; planning should finalize exact constraints.

### `outreach_profiles`

One owner row containing only profile-level metadata:

- `user_id` primary/foreign key with `on delete cascade`
- `confirmed_at`, `created_at`, `updated_at`

Education and work history should use bounded child rows instead of unbounded
JSON so constraints and deletion are explicit.

### `outreach_profile_education`

- `id`, `user_id`
- `university`
- optional `school_or_college`
- optional `program_or_major`
- optional `started_on`, `ended_on`
- normalized comparison fields generated server-side or during reads

### `outreach_profile_work`

- `id`, `user_id`
- `employer`
- optional `role`
- `history_kind` constrained to `employment` or `internship`
- optional `started_on`, `ended_on`

Every text field needs length and nonblank constraints. Unknown dates stay
null; they must not become invented intervals.

### `application_outreach_searches`

At most one current status row per owner/application:

- `application_id`, `user_id` composite ownership
- `status`: `searching`, `ready`, `no_match`, `coverage_unknown`
- `request_id` for stale-completion protection
- `requested_at`, `completed_at`
- bounded `error_code` for operational display
- optional provider/query-version metadata only if needed for support

Do not store query text, snippets, person names, source pages, or scores here.

### `application_outreach_results`

- `id`, `application_id`, `user_id`
- `position` constrained to 1–5
- `linkedin_url`
- `match_reason`
- `created_at`

Constraints:

- composite foreign key to the owned application with cascade deletion;
- unique `(application_id, user_id, position)`;
- unique canonical URL per application;
- canonical HTTPS LinkedIn profile-path validation;
- at most five rows enforced by finalization RPC;
- reason length/control-character validation.

`position` is necessary operational metadata. Current title lives only inside
the reason, as the user requested; score and ranking breakdown are transient.

### `outreach_provider_usage`

- provider, budget date/month, optional `user_id`
- reserved request count
- atomic reservation RPC with hard global and per-user ceilings

Keep global and user records distinguishable. Never trust a browser counter.

### Optional `outreach_company_cache`

Create this only if the selected provider explicitly permits the intended
storage:

- cache key: normalized company identity + target role family + query version;
- short TTL (for example, one day);
- only the minimum derived evidence needed to rerank;
- no user profile terms in a shared key or payload;
- no raw provider response.

Brave's ordinary terms do not support this cache. If no provider grants the
right, either waive caching or change provider; do not implement a nominal
cache that violates the contract.

## Request Flow

```text
User clicks Find outreach profiles
    ↓
Browser invokes search-outreach with application UUID
    ↓
Edge verifies bearer with auth.getUser()
    ↓
begin_outreach_search RPC:
  - owner exists
  - application belongs to owner
  - current stage is Applied / Outreach Sent / Interview
  - outreach profile is confirmed
  - no active request for this application
  - issue request UUID
    ↓
Build bounded query plan from:
  - application company + title + saved JD
  - no-cost company/job vocabulary from existing poll history
  - confirmed academic/work profile terms
    ↓
Before each provider call:
  reserve_outreach_provider_request RPC
    ↓
Provider adapter returns public result title/snippet/URL
    ↓
Canonicalize and deduplicate LinkedIn URLs
    ↓
Extract only evidence present in each hit
    ↓
Eligibility gate → deterministic score → stable tie-break
    ↓
Top 1–5; create bounded reasons; discard raw evidence
    ↓
complete_outreach_search RPC:
  - request UUID must still be current
  - application must still be eligible
  - delete old result rows
  - insert new ordered rows, or none for valid no-match
  - mark ready/no_match atomically
    ↓
Browser invalidates application outreach query
```

### Refresh Semantics

A successful refresh atomically replaces the previous set. A valid completed
search with zero eligible profiles replaces it with `no_match`.

A provider/quota/source failure should not destroy the last successful set.
Mark the latest attempt `coverage_unknown` and, if old results remain, label
them as the prior successful results. This preserves useful data without
misrepresenting the failed refresh. If the user wants every refresh attempt to
clear old results regardless of failure, that should be an explicit
requirements decision because it materially worsens recovery.

### Concurrency Semantics

- Browser mutation scope prevents accidental local double-clicks.
- Database request UUID prevents two tabs from committing stale results.
- Only the latest admitted request may finalize.
- Quota reservation happens per external request, not once per logical search.
- Final replacement occurs in one database transaction.
- External work never runs while holding a database lock.

## Query Strategy

Use a small deterministic plan rather than one giant query:

1. company + target role family + `site:linkedin.com/in`;
2. company + useful adjacent lead/manager titles;
3. company + strongest program/school term;
4. optionally company + strongest shared employer/internship term.

The query planner may use existing job-poll history to learn company-specific
role vocabulary at no additional external cost. It must not claim this history
proves a person belongs to a team.

Do not award academic/work points because a term was placed in the query. The
returned page title/snippet (or another cleared public result) must independently
contain the fact.

## Deterministic Ranking Structure

```ts
interface OutreachEvidence {
  linkedinUrl: string
  currentTitle: string | null
  currentCompanyMatched: boolean
  titleFamily: 'exact' | 'close' | 'adjacent' | 'unrelated' | 'unknown'
  seniority: 'peer' | 'lead' | 'manager' | 'too_senior' | 'unknown'
  academicLevel: 'program' | 'school' | 'university' | 'none'
  timing: 'overlap' | 'nearby' | 'unknown'
  sharedWork: boolean
  evidenceQuality: 'direct' | 'specific' | 'ambiguous'
}
```

Recommended order:

1. validate company and URL;
2. classify function/title relationship;
3. reject unrelated and too-senior candidates;
4. calculate exactly one academic-history tier;
5. score timing, work history, and evidence quality;
6. sort by score, then title proximity, role usefulness, academic match,
   canonical URL for deterministic stability;
7. format the reason from supported evidence;
8. persist only URL, reason, and position.

The existing job `titleConceptsMatch()` cannot be used as outreach eligibility
unchanged: it requires every preferred concept and does not model useful
lead/manager relationships. Reuse normalization and conservative variants,
then implement a dedicated outreach taxonomy.

## Lifecycle Flow

```text
Application becomes Offer or Rejected
    ↓
stage projection updates applications.current_stage
    ↓
database trigger deletes application_outreach_results
and clears/terminalizes search state

Application deleted
    ↓
foreign-key cascade removes search/results

User clicks Clear
    ↓
owner-scoped RPC removes current search/results

Later move from Offer/Rejected back to active
    ↓
no old results are restored; user must request a fresh search
```

The trigger must respond to any route that changes the projected stage,
including historical event edits and deletion. UI-only cleanup is insufficient.

## Authentication and RLS

- All exposed outreach tables enable RLS.
- Direct table writes from `authenticated` remain revoked.
- Browser reads use own-row policies.
- Browser mutations use narrow RPCs.
- The Edge Function verifies the bearer with `auth.getUser()`.
- If the function uses the service role, it must pass the verified owner ID to
  owner-checking RPCs and never accept a caller-provided user ID.
- Index all `user_id` policy columns and application composite keys.
- Provider secrets exist only in Edge Function environment variables.

## Recommended Project Structure

```text
supabase/
├── functions/
│   ├── search-outreach/index.ts
│   └── _shared/outreach/
│       ├── provider.ts
│       ├── query-plan.ts
│       ├── evidence.ts
│       ├── eligibility.ts
│       ├── ranking.ts
│       └── reason.ts
└── migrations/
    └── 006x_outreach_*.sql

web/src/
├── lib/outreach.ts
├── pages/OutreachProfile.tsx
└── components/outreach/
    ├── OutreachProfileForm.tsx
    └── ApplicationOutreachPanel.tsx

web/tests/
├── outreach-ranking.test.ts
├── outreach-evidence.test.ts
├── outreach-lifecycle.test.ts
└── search-outreach-source.test.ts
```

Keep pure matching modules below `_shared/outreach/` free of Deno-only imports
so Vitest can import them directly, following the existing repository pattern.

## Synchronous vs Queued Execution

For two users and two to four queries, begin with one bounded synchronous Edge
request. It is simpler and can fit Supabase limits if every fetch has an abort
timeout and work stays low-CPU.

Switch to a queued worker only if the feasibility corpus shows that useful
coverage requires more queries or the provider regularly exceeds the response
budget. A queued design adds claim/retry/cancellation UI that the current scope
does not otherwise need.

## Integration Points

| Service/Boundary | Pattern | Notes |
|------------------|---------|-------|
| Tavily prototype | Native HTTPS fetch through adapter | Basic search only; no LinkedIn page extraction |
| Tracker | Application UUID + current projected stage | Search action only on three active stages |
| Existing job history | Read company/title/JD vocabulary | Team-query aid, never person evidence |
| Postgres | RPCs for admission/finalization/lifecycle | Maintains ownership and transaction boundaries |
| TanStack Query | Dedicated keys per application/profile | No polling; explicit invalidation after mutations |

## Sources

- Existing Tracker schema/RPCs in migrations `0053`–`0056`
- Existing pure ranking/filter and quota-reservation patterns under
  `supabase/functions/_shared/` and `discovery-sweep`
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) —
  owner policies and indexed policy columns
- [Supabase Edge Function authentication](https://supabase.com/docs/guides/functions/auth) —
  user JWT and RLS-scoped access
- [Supabase Edge Function limits](https://supabase.com/docs/guides/functions/limits) —
  execution bounds
- [Tavily Search endpoint](https://docs.tavily.com/documentation/api-reference/endpoint/search) —
  request/result contract

---
*Architecture research for: v1.1 Outreach Intelligence*
*Researched: 2026-07-28*

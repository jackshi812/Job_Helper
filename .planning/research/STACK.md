# Stack Research

**Domain:** Public-source outreach candidate discovery and deterministic ranking
**Researched:** 2026-07-28
**Confidence:** MEDIUM

## Recommendation in One Sentence

Extend the shipped React/Supabase application with one authenticated Supabase
Edge Function, a provider-neutral search adapter, deterministic TypeScript
ranking, and owner-scoped Postgres tables; use Tavily only for a bounded
prototype until both its output rights and LinkedIn-policy implications are
explicitly cleared.

## Recommended Stack

### Existing Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| React | 19.2.7 | Tracker and outreach-profile UI | Already shipped and tested; no new frontend framework is justified |
| React Router | 8.2.0 | Outreach profile route | Existing routing boundary |
| TanStack Query | 5.101.2 | Search/result/profile server state | Existing mutation, invalidation, retry, and loading-state patterns fit manual refresh |
| Supabase JS | 2.110.7 | Authenticated browser and Edge database access | Matches the current browser and Edge runtime |
| Supabase Postgres + RLS | Current hosted project | User profile, request state, result lifecycle, quotas | Existing authorization boundary and cascade/RPC conventions |
| Supabase Edge Functions | Current hosted runtime | Secret-bearing public search request | Keeps the provider key and scoring inputs off the browser |
| TypeScript | 6.0.2 web / Deno Edge runtime | Deterministic matching and contracts | Existing pure-module testing style can be reused |
| Vitest | 4.1.10 | Fixtures, score invariants, lifecycle tests | Existing suite already tests shared Edge modules from the web workspace |

### New Integration Boundary

| Component | Recommendation | Purpose | Launch Status |
|-----------|----------------|---------|---------------|
| Search provider adapter | Small internal `searchPublicProfiles()` interface using native `fetch` | Prevent provider terms, quota, or recall changes from leaking into ranking and UI | Required |
| Tavily Search | Basic search, domain-limited, no raw-content extraction | Best current free prototype candidate: 1,000 credits/month, no card, basic search costs one credit | Prototype only pending rights and quality checks |
| Provider quota ledger | Postgres reservation RPC | Atomic per-user and global daily/monthly admission before every external call | Required |
| Deterministic outreach ranker | Pure TypeScript module | Enforce eligibility and the locked 35/30/15/10/5/5 formula | Required |
| Bounded reason formatter | Pure TypeScript module | Produce the saved title-inclusive reason without retaining source payloads | Required |

Do not introduce an LLM for v1.1. The score is already defined, the output is
small, and an LLM would add cost, nondeterminism, and unsupported factual
inference. If title-family mapping needs more coverage, extend a reviewed alias
taxonomy and fixtures.

### Search Provider Decision

| Provider | Current Free Path | Fit | Decision |
|----------|-------------------|-----|----------|
| Tavily | 1,000 credits/month; basic search is one credit; development limit 100 requests/minute | Returns URL, title, content snippet, and relevance score; supports domain filters | Best prototype candidate, not production-approved |
| Brave Search API | $5 per 1,000 requests with $5 monthly credits; card required | Strong search API, but ordinary terms prohibit non-transient storage/caching of search results unless the plan grants storage rights | Do not use for persisted v1.1 results without a different written right |
| Google Custom Search JSON API | Existing customers only; 100 free queries/day; discontinuation on 2027-01-01 | Closed to new customers | Not viable |
| LinkedIn Profile API | Restricted approved-partner access; authenticated-member profile use | Does not provide general people discovery and restricts storage of other members' data | Not viable |

The provider decision is subordinate to LinkedIn's own User Agreement. LinkedIn
currently prohibits automated scraping/access and also restricts copying,
using, displaying, or distributing information obtained through third-party
search tools or aggregators without consent. A public search result is
technically accessible, but that does not make unattended LinkedIn candidate
harvesting "no risk." This is a product-policy gate, not an implementation
detail.

## Installation

No new npm dependency is needed for the recommended architecture:

```bash
# Browser and Edge packages are already pinned in the repository.
# The Edge Function should call the selected provider with native fetch.
```

Using native `fetch` keeps the request bounded and avoids adding a provider SDK
that could obscure response handling, timeouts, and retry behavior.

## Provider Adapter Contract

The adapter should return a deliberately transient contract:

```ts
interface PublicProfileHit {
  url: string
  pageTitle: string
  snippet: string
  providerRank: number
}

interface PublicProfileSearch {
  search(query: string, signal: AbortSignal): Promise<PublicProfileHit[]>
}
```

The provider response is not the saved result model. Downstream validation
must canonicalize the URL, reject non-profile or unsupported hosts, extract
only evidence actually present in the returned title/snippet, rank candidates,
and persist only the final URL and bounded match reason if the chosen terms
permit that use.

## Operational Limits

- Begin with two to four basic queries per manual request.
- Reserve quota atomically before each external request.
- Keep both a global daily ceiling and a lower per-user ceiling.
- Honor `Retry-After` on HTTP 429 and do not retry interactively in a tight loop.
- Use an abort timeout comfortably below Supabase's 150-second idle timeout.
- Do not use a cron; the approved product is manual request and manual refresh.
- Treat provider failure, quota exhaustion, or incomplete coverage as
  `coverage_unknown`, never as zero matches.
- Cache only data the selected provider contract permits. Brave's ordinary
  plan does not permit the proposed company-scoped cache.

At 1,000 free basic Tavily credits, a four-query request supports at most 250
full searches/month before retries. That is probably adequate for two users,
but the product must show quota exhaustion honestly.

## Existing Code to Reuse

| Existing asset | Reuse |
|----------------|-------|
| `supabase/functions/_shared/filters.ts` | Reuse normalization, token boundaries, conservative inflections, and selected title aliases |
| `supabase/functions/_shared/deterministic-ranking.ts` | Reuse rubric validation and bounded-evidence patterns, not its job-ranking categories |
| `supabase/functions/discovery-sweep/index.ts` | Reuse atomic quota-reservation and partial-failure principles |
| Tracker RPCs/migrations | Extend owner checks, cascade deletion, and stage-projection behavior |
| `web/src/lib/tracker.ts` | Add result/profile parsers and authenticated mutation wrappers |
| `web/src/pages/Tracker.tsx` | Place the action and results in the existing expanded row |

The current title gate is intentionally too strict for outreach: it requires
every preferred-title concept. Outreach allows useful adjacent roles such as a
Risk Team Lead for a Risk Analyst application. Build a separate title-family
and seniority module while sharing only low-level normalization.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Bounded synchronous Edge request | Queued asynchronous worker | Switch if provider latency regularly exceeds the interactive budget or query count grows |
| Deterministic alias taxonomy | Embeddings or LLM classifier | Consider only after a labeled corpus proves deterministic recall inadequate and a funded API budget exists |
| Separate outreach profile | Resume-derived prefill | Add optional prefill later only with explicit user review; user chose confirmed manual facts |
| Final-result persistence | Full provider response archive | Never for v1.1; it conflicts with data minimization and may conflict with provider rights |

## What Not to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Browser automation against logged-in LinkedIn | Explicitly out of scope and prohibited by platform terms | Server-side provider spike or user-opened manual workflow |
| Direct LinkedIn page fetching/extraction | Turns discovery into profile scraping and increases policy and reliability risk | Use only provider-returned public snippets if cleared |
| Brave ordinary plan for saved results | Search-result storage/caching is restricted | Rights-approved provider or no persisted provider-derived result |
| Google Custom Search for a new project | Closed to new customers and sunsetting | Provider-neutral spike |
| LLM-generated match facts | Can fabricate school, timing, or team membership | Deterministic evidence extraction with `unknown` |
| Client-side provider calls | Exposes API key and bypasses quota ownership | Authenticated Edge Function |
| Service-role writes without owner validation | Bypasses RLS | Verify the JWT, resolve `auth.uid()`, then use scoped RPCs |

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@supabase/supabase-js@2.110.7` | Existing browser and Edge functions | Keep the exact pin used throughout the repo |
| React 19.2.7 | TanStack Query 5.101.2 | Existing mutation/invalidation patterns are sufficient |
| TypeScript 6.0.2 | Vite 8.1.1 / Vitest 4.1.10 | Current build/test baseline |
| Native Edge `fetch` | Tavily REST API | No runtime SDK required |

## Sources

- [Tavily API credits](https://docs.tavily.com/documentation/api-credits) —
  free monthly credits and per-search cost
- [Tavily rate limits](https://docs.tavily.com/documentation/rate-limits) —
  development rate limit and 429 behavior
- [Tavily Search endpoint](https://docs.tavily.com/documentation/api-reference/endpoint/search) —
  domain filters and result fields
- [Tavily Terms of Service](https://www.tavily.com/terms) — current customer,
  output, third-party-rights, and reliability obligations
- [Brave Search API](https://brave.com/search/api/) — current pricing and free
  monthly credits
- [Brave Search API Terms](https://api-dashboard.search.brave.com/documentation/resources/terms-of-service) —
  search-result storage and caching restrictions
- [Google Custom Search JSON API overview](https://developers.google.com/custom-search/v1/overview) —
  new-customer closure and discontinuation date
- [LinkedIn Profile API](https://learn.microsoft.com/en-us/linkedin/shared/integrations/people/profile-api?view=li-lms-2025-04) —
  restricted access and member-data storage limits
- [Supabase Edge Function limits](https://supabase.com/docs/guides/functions/limits) —
  wall-clock, CPU, memory, and idle limits
- [Supabase Edge Function secrets](https://supabase.com/docs/guides/functions/secrets) —
  server-side secret handling
- Repository `web/package.json` and existing shared/Edge modules — exact
  installed versions and reusable patterns

---
*Stack research for: v1.1 Outreach Intelligence*
*Researched: 2026-07-28*

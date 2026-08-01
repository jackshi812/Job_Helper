# Project Research Summary

**Project:** Job Application Copilot — v1.1 Outreach Intelligence
**Domain:** Public-source, application-specific candidate discovery and ranking
**Researched:** 2026-07-28
**Confidence:** MEDIUM

## Executive Summary

The proposed experience is technically compatible with the shipped
React/Supabase application. A user-confirmed outreach profile, authenticated
manual search action, deterministic 100-point ranking, one-to-five minimal
results, and database-enforced lifecycle can all be added without a new
frontend framework, background worker, LLM, or paid contact provider. The
existing tracker, RLS, quota, deletion, normalization, and pure-module testing
patterns provide strong foundations.

The external discovery assumption is not yet production-safe. Google Custom
Search is closed to new customers. Brave's current free-credit path has
ordinary-plan terms that restrict storing or caching search results. Tavily is
the best free prototype candidate at 1,000 basic searches/month, but its search
quality for public LinkedIn evidence is unproven and its terms place
third-party-rights responsibility on the customer. More importantly,
LinkedIn's current User Agreement restricts automated access and the use or
display of information obtained through third-party search tools. Avoiding
logged-in automation reduces risk but does not make server-side LinkedIn
candidate harvesting “no risk.”

Therefore, v1.1 should start with a blocking feasibility phase, not the full
feature build. That phase must resolve the exact product-policy posture,
provider output/storage rights, and real search recall on a small
multi-company corpus. If the boundary is accepted and the corpus is useful,
the remaining implementation is straightforward. If not, the product must
shift to a user-driven/manual profile bookmarking flow or non-LinkedIn public
professional pages before further investment.

## Key Findings

### Recommended Stack

Keep the existing stack:

- **React 19.2.7 + TanStack Query 5.101.2:** outreach profile and tracker flow
- **Supabase Postgres + RLS:** owner data, status, results, lifecycle, and quota
- **One authenticated Supabase Edge Function:** secret-bearing manual search
- **Native `fetch` provider adapter:** Tavily as a disposable first spike
- **Pure TypeScript deterministic core:** evidence, eligibility, ranking, reason
- **Vitest 4.1.10:** fixture corpus, invariants, and source/runtime checks

No new npm dependency and no LLM are recommended. See
[STACK.md](./STACK.md).

### Expected v1.1 Features

**Must have:**

- confirmed manual academic/work outreach profile;
- action only in Applied, Outreach Sent, and Interview;
- one-shot public search and manual replace-refresh;
- separate ready, no suitable profiles, and coverage unknown states;
- meaningful-function eligibility before scoring;
- locked 35/30/15/10/5/5 deterministic formula;
- 1–5 canonical LinkedIn URLs without weak padding;
- one short reason containing current title and strongest supported facts;
- only URL, reason, position, and necessary operational metadata persisted;
- per-user RLS, manual clear, terminal-stage deletion, and app-delete cascade;
- atomic provider quota and bounded 429/backoff behavior.

**Important ranking semantics:**

- exact program/major > school/college > university, with no stacking;
- overlapping academic timing > nearby; unknown remains neutral;
- relevant team lead/manager is highly useful, but excessive seniority fails;
- same exact title is preferred, not required;
- Risk Analyst vs Software Engineer is ineligible regardless of generic overlap.

**Deferred or removed:**

- LinkedIn connections CSV;
- single-profile clipper;
- contact details;
- messages and talking points;
- automated sending;
- logged-in page automation;
- background candidate monitoring;
- 30-day warm-path hit/kill measurement.

See [FEATURES.md](./FEATURES.md).

### Architecture Approach

The browser invokes an authenticated `search-outreach` Edge Function with an
application ID. An admission RPC verifies owner, stage, confirmed profile, and
request concurrency. The function builds two-to-four bounded queries from the
application, company/job vocabulary, and strongest confirmed history. Each
physical provider call reserves quota atomically. Search hits are transiently
validated, deduplicated, evaluated, scored, and reduced to one-to-five
URL/reason pairs. A request-token-scoped finalization RPC atomically replaces
the prior set. Raw results, scores, names, source pages, and profile copies are
discarded.

Use owner/profile child tables, one current application search-state row,
minimal result rows, and a provider-usage ledger. A database trigger deletes
results whenever the canonical application stage becomes Offer or Rejected;
foreign keys cascade on application deletion. A failed refresh should preserve
the last successful set while reporting unknown coverage; a successful
zero-match refresh should replace it with no results. See
[ARCHITECTURE.md](./ARCHITECTURE.md).

### Critical Pitfalls

1. **Public visibility is not use permission** — require explicit policy/legal
   acceptance before production implementation.
2. **Free API does not imply storage rights** — Brave's ordinary plan conflicts
   with the proposed saved results/cache; verify every field and TTL.
3. **Search relevance is not evidence** — never award points because a term was
   in the query; snippets are partial and stale.
4. **Token overlap is not role fit** — use function taxonomy and seniority,
   separating title proximity from manager/lead usefulness.
5. **Empty is not always no-match** — provider, quota, timeout, and insufficient
   evidence become coverage unknown.
6. **Refresh needs request tokens and atomic replacement** — prevent stale
   completions and mixed rows.
7. **Privacy applies to logs/cache too** — URL/reason-only is a storage
   contract, not just a UI rule.
8. **Provider recall is unknown** — test real qualifying evidence before
   building the complete interface.

See [PITFALLS.md](./PITFALLS.md).

## Provider Comparison

| Option | Free Path | Storage/Policy Fit | Research Decision |
|--------|-----------|--------------------|-------------------|
| Tavily basic search | 1,000 credits/month, no card | No explicit ordinary-plan storage ban found in reviewed terms, but customer bears third-party-rights risk; recall unknown | First spike candidate only |
| Brave Search API | Approximately 1,000 requests/month through credits; card required | Ordinary terms prohibit storage/cache except transient operation unless plan grants rights | Reject for current persistence requirement |
| Google Custom Search | Existing customers only | Closed to new customers; ends 2027-01-01 | Reject |
| LinkedIn official API | Restricted approved access | No general people search; storage restrictions | Reject |

Even if Tavily is acceptable, LinkedIn's separate restrictions remain. The
provider does not grant rights to the target platform's content.

## Suggested Feasibility Corpus

Before implementation, build a small, owner-approved reference set rather than
a 30-day production metric:

- 6–10 applications across at least three companies;
- target roles including Risk Analyst and at least one unrelated family such
  as Software Engineering;
- known positive examples for peer, team lead, relevant manager, program alum,
  school alum, university alum, overlap/nearby timing, and shared internship;
- known negatives for wrong company, unrelated function, excessive seniority,
  non-profile URL, ambiguous snippet, and query-term-only “evidence.”

For each application, record only spike evaluation facts outside production
data:

- qualifying URL recall;
- whether current company and title are supported;
- whether academic/work facts appear in usable public snippets;
- eligible/ineligible judgment;
- expected ordering;
- provider calls used;
- unknown/failure outcome.

The owner should set the go/no-go bar after seeing the first corpus results.
The research does not invent a percentage threshold the user did not approve.

## Roadmap Implications

### Phase 1: Feasibility, Rights, and Search Quality Gate

**Rationale:** The core uncertainty is whether the feature can lawfully and
reliably produce the requested persisted LinkedIn URLs under the free-only
constraint.

**Delivers:**

- exact data-flow and provider-rights checklist;
- explicit owner go/no-go on LinkedIn-policy posture;
- provider-neutral disposable spike;
- representative labeled corpus and query budget;
- approved search provider or documented redesign decision;
- no production UI or third-party result retention.

**Exit gate:** Do not proceed until both rights/posture and search usefulness
are accepted. If they fail, redesign to user-driven bookmarking or non-LinkedIn
public profiles.

### Phase 2: Private Outreach Profile and Deterministic Ranking Core

**Rationale:** Once the external source is viable, the next dependency is
trusted user facts and a verified product-specific ranking contract.

**Delivers:**

- owner-scoped manual education/work profile;
- outreach-specific normalization, function taxonomy, seniority, eligibility;
- locked score and deterministic tie-break;
- bounded reason formatter;
- fixture suite covering positive, negative, unknown, and adversarial cases.

**Avoids:** fabricated facts, academic stacking, unrelated-role leakage,
manager/lead misranking.

### Phase 3: Search Orchestration, Quota, and Minimal Persistence

**Rationale:** External work should be built only after the core can evaluate
its output deterministically.

**Delivers:**

- authenticated Edge Function and provider adapter;
- admission/current-request token;
- per-physical-call quota reservation and backoff;
- transient evidence pipeline;
- atomic replace finalization;
- `ready`, `no_match`, and `coverage_unknown`;
- URL/reason-only results and permitted company cache, if any.

**Avoids:** quota races, stale completion, mixed results, raw data retention.

### Phase 4: Tracker UX, Lifecycle, and Hosted Proof

**Rationale:** Integrate only after the backend contract is stable.

**Delivers:**

- Applied/Outreach Sent/Interview request panel;
- manual refresh, clear, prior-result/unknown behavior;
- 1–5 linked result rows;
- database terminal-stage cleanup and deletion cascade;
- two-account RLS proof, provider-cap proof, lifecycle-path tests, and hosted
  user acceptance.

**Avoids:** misleading empty states, client-only cleanup, cross-user exposure.

### Phase Ordering Rationale

- External feasibility is the only blocker that can invalidate the entire
  current product shape, so it comes first.
- Ranking needs confirmed user facts before search output can be judged.
- Search orchestration should consume a tested deterministic core.
- UI comes after request/status/lifecycle semantics are stable.
- Security and lifecycle are built into each phase, then proven together in
  the final hosted phase.

## Research Flags

Phases needing deeper research:

- **Feasibility phase:** current platform/provider terms and real-world search
  recall are both unstable and must be checked again at execution time.
- **Search orchestration:** exact provider response behavior, supported query
  operators, and storage rights require a live spike.
- **Ranking core:** title-family and seniority taxonomy needs owner-reviewed
  examples, not general assumptions.

Phases using established repository patterns:

- **Outreach profile/RLS:** existing owner tables, RPCs, and deletion proofs.
- **Tracker UI:** existing expanded-row, TanStack mutation, status, and modal
  patterns.
- **Terminal lifecycle:** existing application projection and cascade model.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Existing stack fit | HIGH | Verified directly against current source and pinned versions |
| Internal architecture | HIGH | Reuses shipped RLS, RPC, quota, tracker, and pure-module patterns |
| User feature contract | HIGH | Repeated owner decisions resolved ranking, count, display, and lifecycle |
| Free provider availability | HIGH | Current official pricing/docs checked |
| Provider storage rights | MEDIUM | Brave is clearly incompatible; Tavily still needs explicit use confirmation |
| LinkedIn policy posture | HIGH that risk exists; LOW on acceptable product decision | Terms are clear enough to invalidate “no risk,” but acceptance is a product/legal choice |
| Public search recall | LOW | Must be measured on a representative corpus |
| Deterministic ranking feasibility | MEDIUM–HIGH | Mechanically feasible; taxonomy quality needs fixtures |

**Overall confidence:** MEDIUM. The internal build is well understood; the
external source and policy assumptions are not yet validated.

## Blocking Owner Decision

Before requirements and roadmap are finalized, choose one direction:

1. keep server-side LinkedIn URL discovery, but make explicit policy/provider
   approval and search-quality evidence a blocking first phase with no launch
   until cleared;
2. change v1.1 to a lower-risk user-driven workflow that saves URLs the user
   finds/opens manually, optionally ranking only user-supplied facts;
3. broaden targets to rights-cleared public professional/company biography
   pages, with LinkedIn only when manually supplied.

The original promise of unattended, free, and “no risk” cannot be supported by
the current official terms.

## Primary Sources

- [LinkedIn User Agreement](https://www.linkedin.com/legal/user-agreement)
- [LinkedIn public profile visibility](https://www.linkedin.com/help/linkedin/answer/a520838/)
- [LinkedIn Profile API](https://learn.microsoft.com/en-us/linkedin/shared/integrations/people/profile-api?view=li-lms-2025-04)
- [Tavily API credits](https://docs.tavily.com/documentation/api-credits)
- [Tavily Search endpoint](https://docs.tavily.com/documentation/api-reference/endpoint/search)
- [Tavily rate limits](https://docs.tavily.com/documentation/rate-limits)
- [Tavily Terms of Service](https://www.tavily.com/terms)
- [Brave Search API](https://brave.com/search/api/)
- [Brave Search API Terms](https://api-dashboard.search.brave.com/documentation/resources/terms-of-service)
- [Google Custom Search JSON API overview](https://developers.google.com/custom-search/v1/overview)
- [Supabase Edge Function limits](https://supabase.com/docs/guides/functions/limits)
- [Supabase Edge Function authentication](https://supabase.com/docs/guides/functions/auth)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- Current Job Application Copilot source and migrations

---
*Research completed: 2026-07-28*
*Ready for roadmap: conditional on owner decision and feasibility gate*

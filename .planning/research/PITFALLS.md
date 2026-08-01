# Pitfalls Research

**Domain:** Public-source LinkedIn-target outreach intelligence
**Researched:** 2026-07-28
**Confidence:** HIGH for identified risks; MEDIUM for acceptable policy posture

## Critical Pitfalls

### 1. Treating “Public” as Permission to Harvest and Persist

**What goes wrong:**
The system technically finds public LinkedIn URLs and assumes that avoiding
logged-in automation makes the workflow risk-free.

**Why it happens:**
Engineers conflate public visibility, robots-accessible indexing, a search
provider's API license, and the target platform's contractual rules.

**How to avoid:**
Make production implementation conditional on an explicit policy/legal product
decision. Review both the search provider's output/storage rights and
LinkedIn's rules for information obtained through third-party search tools.
Document the approved exact data flow, retention, and link rendering.

**Warning signs:**

- Requirements say “unattended, free, no risk.”
- The architecture cites only the search provider's terms.
- A provider key is chosen before anyone approves storage/link use.
- The team argues that no login means no platform-policy issue.

**Phase to address:**
First phase, before schema or UI implementation.

---

### 2. Choosing a Free Search Tier That Forbids the Required Cache

**What goes wrong:**
Company-scoped caching or saved profile results violate the selected plan's
storage terms.

**Why it happens:**
Pricing pages emphasize request credits while storage rights live in separate
terms. Brave's ordinary Search API terms allow only transient operation unless
the plan explicitly grants storage rights.

**How to avoid:**
Create a provider-rights checklist covering raw results, derived URLs,
snippets, match reasons, caching, retention, and display. The chosen provider
must affirm the intended use, or the caching/persistence requirement must
change. Keep the provider behind an adapter.

**Warning signs:**

- “Free credits” is the only provider-selection criterion.
- Raw JSON is written “temporarily” without a defined TTL.
- A company cache is planned before provider selection.
- No one can point to the clause granting storage.

**Phase to address:**
Feasibility/provider spike.

---

### 3. Mistaking Query Terms or Search Snippets for Verified Facts

**What goes wrong:**
A reason says “Same MS Finance program” because the query contained the program,
or a clipped snippet ambiguously joins unrelated page text.

**Why it happens:**
Search results are relevance artifacts, not structured profile records.
LinkedIn public visibility is user-controlled, and external indexes may take
weeks or months to reflect changes.

**How to avoid:**
Award a fact only when the result title/snippet directly and specifically
contains it. Keep `unknown` neutral. Mark uncertain language `Likely` or omit
it. Build adversarial fixtures where the query includes a term absent from the
result. Do not fetch/extract the LinkedIn profile page to “fill the gaps.”

**Warning signs:**

- Every program-targeted query produces program points.
- Reasons contain facts absent from saved test fixtures.
- The parser merges text across separate results.
- Academic timing is inferred from graduation year without defined bounds.

**Phase to address:**
Evidence and ranking phase.

---

### 4. Using Word Overlap as Functional Relevance

**What goes wrong:**
Obviously unrelated employees enter the list, or useful adjacent leads are
rejected. “Risk Analyst” vs “Software Engineer” is clearly ineligible even if
both snippets contain generic words; “Risk Team Lead” should remain highly
useful for a Risk Analyst.

**Why it happens:**
Token overlap is easy to implement, while role families, seniority, and
managerial usefulness are separate concepts.

**How to avoid:**
Use an explicit, reviewed function taxonomy and seniority ladder. Gate
unrelated functions before scoring. Score title proximity separately from role
usefulness. Reuse low-level normalization, not the current job filter's
all-concepts-must-match rule.

**Warning signs:**

- Generic tokens such as analyst, associate, business, or technology create a
  match by themselves.
- A manager receives title-proximity points merely for containing the target
  noun.
- Exact peers always beat relevant team leads despite the 15-point usefulness
  weight.
- C-suite or distant directors appear as “useful managers.”

**Phase to address:**
Ranking-contract phase with owner-reviewed fixtures.

---

### 5. Conflating No Match With Unknown Coverage

**What goes wrong:**
Quota exhaustion, provider failure, sparse public visibility, or parsing
failure renders “No suitable profiles,” misleading the user into believing
none exist.

**Why it happens:**
A binary result model treats an empty array as a business conclusion.

**How to avoid:**
Model `no_match` only when the admitted query set completed successfully and
all returned hits were evaluated. Model provider, quota, timeout, and
insufficient-evidence failures as `coverage_unknown`. Preserve the last
successful set when a refresh is unknown, with a clear stale label.

**Warning signs:**

- Catch blocks return `[]`.
- HTTP 429 and a real zero-result response follow the same code path.
- UI copy has one empty state.
- A failed refresh deletes useful prior results.

**Phase to address:**
Search orchestration and tracker UI.

---

### 6. Non-Atomic Refresh and Stale Completion

**What goes wrong:**
Two tabs or rapid refreshes interleave, producing mixed result sets or letting
an older search overwrite a newer one.

**Why it happens:**
The external call cannot be wrapped inside a database transaction, so naive
delete-then-insert operations expose partial state.

**How to avoid:**
Issue a current request UUID in the admission RPC. Compute externally. Finalize
through one RPC that rechecks ownership, stage, and request UUID, then replaces
all result rows transactionally. Old requests must fail closed.

**Warning signs:**

- Browser directly deletes and inserts result rows.
- Results disappear while a refresh is pending.
- No idempotency/current-request token exists.
- Five insert calls can succeed or fail independently.

**Phase to address:**
Search persistence phase.

---

### 7. Quota Races and Accidental Paid Operation

**What goes wrong:**
Concurrent requests exceed free credits, retries amplify provider errors, or
one user consumes the entire allowance.

**Why it happens:**
The app checks usage and increments later, counts logical searches instead of
physical provider calls, or retries 429 responses automatically.

**How to avoid:**
Reserve every physical call atomically before the fetch. Enforce global and
per-user ceilings below the vendor limit. Honor `Retry-After`; expose unknown
coverage rather than burst-retrying. Alert before the monthly free allowance
is exhausted. Do not enable pay-as-you-go automatically.

**Warning signs:**

- `SELECT count` followed by a separate insert.
- One “refresh” is counted once despite four provider calls.
- TanStack/Edge automatic retries remain enabled for 429.
- Provider billing has no hard cap.

**Phase to address:**
Provider adapter and quota phase.

---

### 8. Client-Only Lifecycle Cleanup

**What goes wrong:**
Results remain after the application becomes Offer or Rejected through a
different browser, historical timeline edit, or RPC.

**Why it happens:**
The visible stage dropdown is mistaken for the only mutation path.

**How to avoid:**
Delete results from a database trigger reacting to the canonical projected
stage. Cascade on application deletion. Test append, historical update,
historical delete, application delete, terminal-to-active reversal, and manual
clear.

**Warning signs:**

- Cleanup exists only in a React mutation callback.
- The append-stage RPC is the only tested path.
- Returning from terminal to active restores old results.
- Application deletion fails due to outreach foreign keys.

**Phase to address:**
Schema/lifecycle phase.

---

### 9. Data Minimization That Exists Only in the UI

**What goes wrong:**
The page displays only URL and reason, but logs, tables, error payloads, cache,
or observability retain names, titles, snippets, full profiles, and queries.

**Why it happens:**
Developers interpret “save only” as a presentation rule.

**How to avoid:**
Define transient structs and persistent schemas separately. Log bounded codes
and counts only. Forbid raw result logging and query logging. Verify database
and Edge logs during hosted testing. Ensure provider requests do not contain
the user's name and use only the minimum academic/work terms.

**Warning signs:**

- `console.error(error)` contains request/response bodies.
- Search JSON is stored for debugging.
- Match score/evidence silently appears in metadata.
- A shared cache key contains user-specific history.

**Phase to address:**
Schema/security phase and release verification.

---

### 10. Assuming Search Recall Before Measuring It

**What goes wrong:**
The feature is fully built, but the free provider rarely surfaces LinkedIn
profiles with enough public education/work/title evidence to compute the
intended ranking.

**Why it happens:**
API capability is mistaken for domain recall. Public profiles expose a
user-selected subset, and search snippets are inconsistent.

**How to avoid:**
Before production code, assemble a small owner-approved corpus of target
company/job/profile cases and score:

- valid profile URL recall;
- current-company and current-title evidence rate;
- program/school evidence rate;
- unrelated-role rejection;
- manager/lead usefulness ordering;
- query count per successful application.

This is a pre-launch feasibility test, not the deleted 30-day warm-path metric.

**Warning signs:**

- The spike tests only one company.
- Search result count is used instead of qualifying-candidate count.
- Academic ranking is designed without any snippet examples containing
  academic evidence.
- The roadmap commits to full UI before provider recall is known.

**Phase to address:**
First feasibility phase.

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-Term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hard-code provider response shape in Edge index | Faster spike | Provider lock-in and mixed policy logic | Only in disposable spike code, never merged as production path |
| Reuse job title matcher unchanged | Less code | Rejects useful adjacent roles and cannot model seniority | Never |
| Store raw snippets for reranking | Easy debugging | Privacy/rights burden and stale evidence | Never for v1.1 |
| Client-side max-five slicing | Quick UI | Database can contain excess/mixed results | Never; enforce in finalization RPC |
| One global quota | Simple | One user can starve the other | Only during a local non-production spike |
| Shared user-specific cache | Saves calls | Cross-user data mixing | Never |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Tavily | Treat provider relevance score as candidate quality | Use it only as input ordering; run product eligibility/ranking independently |
| Brave | Persist/cache ordinary-plan results | Obtain an explicit storage right or do not use |
| LinkedIn links | Fetch the profile to enrich snippets | Do not crawl or automate LinkedIn pages |
| Supabase Edge auth | Trust JWT gateway or caller user ID | Verify with `auth.getUser()` and derive owner server-side |
| Supabase service role | Assume RLS still applies | Use narrow owner-checking RPCs; service role bypasses RLS |
| Tracker stage | Clean up from dropdown callback | React to canonical projected stage in database |
| TanStack Query | Default retry on quota/validation errors | Set explicit retry behavior; never retry 429/4xx blindly |

## Performance and Reliability Traps

| Trap | Symptoms | Prevention | Likely Threshold |
|------|----------|------------|------------------|
| Too many broad queries | Slow request, duplicate/noisy hits, quota drain | Two-to-four deterministic queries and strict dedupe | Immediate even with two users |
| Unbounded snippet parsing | Edge CPU/memory spikes | Bound result count and code points before normalization | Malformed/large provider response |
| Serial long provider timeouts | Edge idle timeout | Per-fetch abort deadline and bounded total budget | Provider degradation |
| Cache stampede | Concurrent identical company refreshes | Admission/idempotency plus permitted cache lock | Two tabs are enough |
| Missing owner indexes | RLS queries scan personal tables | Index `user_id` and composite FKs | Grows with tracker history |

## Security and Privacy Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Provider key in browser | Key theft and uncontrolled quota | Edge secret only |
| Raw query/result logging | Exposes user history and third-party data | Codes/counts only |
| Caller-provided owner ID | Cross-user access with service role | Resolve verified owner server-side |
| Broad direct table grants | Bypasses validation and five-result limit | Select own rows; mutate via RPC |
| URL validation by prefix only | Lookalike domains or arbitrary paths | Parse URL, exact HTTPS hostname set, allowed profile path, strip tracking |
| Unsanitized match reason | Stored XSS/control characters | Plain text rendering and bounded normalized server formatter |
| Shared personalized cache | Cross-user history disclosure | Company/role-only key or per-user cache |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| “No connections found” wording | Implies first-degree knowledge that no longer exists | “No suitable public profiles found” |
| Five empty placeholders | Encourages expectation of exactly five | Render 1–5 real rows only |
| Hidden stage eligibility | Button vanishes without explanation | Explain availability in Applied/Outreach Sent/Interview |
| Blocking profile setup discovered after search click | Feels broken | Show profile readiness and link to edit |
| Failed refresh wipes prior results | Loses useful work | Preserve previous successful set and show unknown refresh |
| Raw score shown | Suggests false precision | Show only simple reason |
| Inference phrased as fact | Damages trust | `Likely` or omit |

## “Looks Done But Isn’t” Checklist

- [ ] **Provider approval:** both output-storage rights and LinkedIn-policy
      posture are explicitly resolved
- [ ] **Corpus:** multiple companies and role families prove useful recall
- [ ] **Evidence:** query terms alone never award points
- [ ] **Eligibility:** unrelated functions and excessive seniority fail
- [ ] **Ranking:** all weights total 100 and academic levels do not stack
- [ ] **Count:** zero to five rows are enforced server-side
- [ ] **Refresh:** old completion cannot overwrite a newer request
- [ ] **Unknown state:** quota/429/timeout is distinct from no match
- [ ] **Lifecycle:** every stage-mutation path deletes terminal results
- [ ] **Privacy:** database, cache, Edge logs, and error payloads contain no raw
      third-party profile copy
- [ ] **Isolation:** two-account hosted probes deny cross-user reads/mutations
- [ ] **Cost:** provider dashboard cannot silently enter paid usage

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Provider terms conflict discovered | HIGH | Disable provider with kill switch, delete disallowed cache/results, choose cleared provider or redesign |
| Low search recall | MEDIUM | Stop after spike; improve bounded queries/taxonomy or change product boundary before UI build |
| Incorrect reasons stored | MEDIUM | Disable search, fix evidence fixtures/formatter, delete affected results, rerun only on user request |
| Quota overspend | LOW–MEDIUM | Disable key/PAYGO, lower DB cap, reconcile physical call accounting |
| Cross-user exposure | HIGH | Disable feature, revoke grants, audit/delete rows/logs, repair RLS/RPC, rerun two-account proof |
| Stale lifecycle rows | LOW | Add database cleanup trigger, backfill-delete terminal results, add mutation-path tests |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Public is not permission | Feasibility gate | Written go/no-go records exact approved data flow |
| Provider cache rights | Feasibility gate | Terms checklist covers every persisted field |
| Low recall | Feasibility gate | Labeled multi-company corpus meets owner-approved threshold |
| Evidence hallucination | Ranking core | Adversarial fixtures and provenance-to-reason assertions |
| Title/function errors | Ranking core | Owner-reviewed positive/negative role pairs |
| Quota races | Search foundation | Concurrent reservation tests and hard provider cap |
| Stale refresh | Search foundation | Two-request out-of-order finalization test |
| Lifecycle residue | Tracker integration | All stage/delete routes prove zero result rows |
| Data leakage | Security/release | Schema/log review and two-account hosted probes |

## Sources

- [LinkedIn User Agreement](https://www.linkedin.com/legal/user-agreement) —
  automated access, third-party search-tool information use, and linking rules
- [LinkedIn public profile visibility](https://www.linkedin.com/help/linkedin/answer/a520838/) —
  user-selected public sections and external-index update delay
- [Brave Search API Terms](https://api-dashboard.search.brave.com/documentation/resources/terms-of-service) —
  ordinary search-result storage/caching restriction
- [Tavily Terms of Service](https://www.tavily.com/terms) — third-party-rights,
  output-reliability, and customer-responsibility terms
- [Tavily rate limits](https://docs.tavily.com/documentation/rate-limits) —
  development limits and `Retry-After`
- [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security) —
  RLS behavior and policy indexing
- Existing repository incidents and safeguards around quota reservation,
  service-role boundaries, source closure, deletion, and deterministic ranking

---
*Pitfalls research for: v1.1 Outreach Intelligence*
*Researched: 2026-07-28*

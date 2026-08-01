# Feature Research

**Domain:** Application-specific public-source outreach intelligence
**Researched:** 2026-07-28
**Confidence:** HIGH for user scope; MEDIUM for public-source feasibility

## Product Boundary

The approved v1.1 product is not a contact database or an automated outreach
agent. It is a small decision aid attached to an already-applied job:

1. the user confirms their own academic and work history;
2. the user requests a search from an eligible tracker stage;
3. the system returns one to five strong public-profile destinations;
4. each result contains only a LinkedIn URL and a short title-inclusive reason;
5. the user opens the profile and decides what to do manually.

The result count is a quality boundary, not a fill target. One qualified profile
is success. Zero qualified profiles and unknown search coverage are different
states.

## Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Confirmed outreach profile | Academic/work matching cannot be trustworthy without explicit user facts | MEDIUM | Manual entry; schools, program/major, employers, internships, roles, dates |
| Stage-gated request | Outreach belongs to active applied jobs, not the discovery feed | LOW | Only Applied, Outreach Sent, Interview |
| Manual search and refresh | User expects deliberate control over quota and result replacement | MEDIUM | No polling; one request at a time per application |
| Honest search state | “No candidates” must not hide provider/quota failure | MEDIUM | Distinct ready, no suitable profiles, coverage unknown states |
| Hard eligibility | Obviously unrelated roles must never appear | HIGH | Risk Analyst vs Software Engineer is ineligible even if snippets share generic words |
| Ranked 1–5 results | User wants a short usable list without weak padding | HIGH | Score all eligible hits, dedupe URLs, return at most five |
| Simple reason | A URL without context is difficult to evaluate | MEDIUM | Include current title and strongest verified match signals |
| Result lifecycle | Refresh and terminal stages must behave predictably | MEDIUM | Refresh replaces; Offer/Rejected/delete/manual clear deletes |
| Per-user isolation | Profile and outreach history are personal data | HIGH | RLS plus owner-scoped RPCs |
| Free-tier control | Free operation is a hard constraint | MEDIUM | Provider-independent quota, backoff, and visible exhaustion |

## Ranking Contract

The user locked a deterministic 100-point formula:

| Category | Weight | Evidence principle |
|----------|-------:|--------------------|
| Title proximity | 35 | Same/adjacent function and role-family closeness; no token-overlap shortcut |
| Academic history | 30 | Exact program/major > same school/college > same university; award only one level |
| Role usefulness | 15 | Relevant team lead or manager is most useful; excessively senior candidates lose or fail |
| Academic timing | 10 | Overlap > nearby attendance; unknown is neutral |
| Shared work/internship history | 5 | Same prior employer or internship |
| Evidence quality | 5 | Direct, specific public evidence beats ambiguous snippet inference |

### Eligibility Before Scoring

A candidate must:

- work at the application company based on usable public evidence;
- expose a canonical, usable LinkedIn profile URL;
- have a meaningful title/function relationship to the target job;
- not be clearly unrelated;
- not be excessively senior for the outreach purpose.

Eligibility does not require the exact same title, specialty, or direct peer
role. A Risk Team Lead can outrank a Risk Analyst peer because leadership
usefulness is part of ranking. A Software Engineer is not eligible for a Risk
Analyst role simply because both work at the same company.

### Match-Reason Contract

The persisted and displayed reason should follow a bounded structure:

`<Current title> · <strongest match> · <next strongest match>`

Examples:

- `Risk Team Lead · Same MS Finance program · Overlapping attendance`
- `Risk Manager · Closely related risk role · Same university`
- `Senior Risk Analyst · Same program alum · Shared Deloitte internship`

Do not mention a fact that the transient evidence did not establish. Prefix
inferences with `Likely`, or omit them. The score and raw evidence remain
internal.

## Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Title-first, relationship-aware ranking | Avoids generic “people at company” lists | HIGH | Blends role proximity and manager/lead usefulness |
| Program-first alumni matching | More specific than university-only affinity | MEDIUM | Exact program/major outranks school/college, then university |
| No weak-result padding | Preserves trust when public coverage is sparse | LOW | One is valid; never stretch to five |
| Evidence-minimal persistence | Reduces retained third-party data | MEDIUM | URL + reason only; transient scoring evidence discarded |
| Application-aware cleanup | Outreach results follow the tracker lifecycle | MEDIUM | Database-enforced deletion on Offer/Rejected |
| Honest unknown coverage | Prevents false negative conclusions | MEDIUM | Provider/quota/source ambiguity is visible |

## Anti-Features

| Feature | Surface Appeal | Why Problematic | v1.1 Alternative |
|---------|----------------|-----------------|------------------|
| LinkedIn connections CSV | Warm graph and shared-history clues | Roughly 500 connections are unlikely to yield enough company-and-role joins; adds sensitive graph retention | Public-source search only |
| Logged-in LinkedIn automation | Richer profiles and reliable first-degree status | Platform-policy, account, privacy, and operational risk | User opens returned URL manually |
| Automatic message sending | Saves time | High social/reputational risk and explicitly rejected | No send action |
| Message/talking-point generation | Feels like complete outreach | Expands scope before candidate quality is proven | URL + simple reason only |
| Email/contact discovery | More channels | Paid sources, privacy burden, stale data | No contact details |
| Background candidate monitoring | Fresh results automatically | Spends quota and adds state complexity without user intent | Manual refresh |
| Single-profile clipper | Could enrich one candidate | Requires browser-extension/manual capture design not needed for core flow | Deferred |
| Save full profiles or snippets | Easier reranking/debugging | Third-party-data retention and provider-rights burden | Save only URL + reason |
| Always return five | Visually consistent | Encourages weak or unrelated matches | Return 1–5, or an honest empty state |
| LLM inference | Flexible title interpretation | Cost, nondeterminism, and fabricated match facts | Reviewed deterministic taxonomy |

## Feature Dependencies

```text
[Provider/policy feasibility gate]
    └──requires──> [Labeled search-quality corpus]
                       └──validates──> [Provider adapter + query strategy]

[Confirmed outreach profile]
    └──feeds──> [Evidence extraction]
                   └──feeds──> [Eligibility + deterministic ranking]
                                  └──feeds──> [Bounded match reason]

[Tracker stage + application snapshot]
    └──authorizes──> [Manual search/refresh]
                         └──replaces──> [Saved outreach results]

[Terminal stage or application deletion]
    └──deletes──> [Saved outreach results]

[Quota reservation + backoff]
    └──guards──> [Every external search call]
```

### Dependency Notes

- **Feasibility precedes implementation:** no search UI should ship until the
  selected provider's rights and LinkedIn-policy posture are accepted.
- **The outreach profile precedes useful ranking:** otherwise academic and
  shared-history weights cannot be computed.
- **Eligibility precedes scoring:** a high academic score must never rescue an
  unrelated role.
- **Evidence extraction precedes reason generation:** query terms are not proof
  that a returned person has that history.
- **Lifecycle belongs in the database:** a client-only cleanup can leave stale
  rows after another client or RPC changes the stage.

## v1.1 MVP Definition

### Launch With

- [ ] An explicit provider/policy feasibility decision backed by a small
      representative corpus
- [ ] Manual confirmed outreach profile with edit and delete
- [ ] Applied/Outreach Sent/Interview action gate
- [ ] One manual public-source request and manual replace-refresh
- [ ] Atomic free-tier quota and bounded backoff
- [ ] Eligibility plus locked deterministic 100-point score
- [ ] One to five deduplicated LinkedIn URLs with title-inclusive reasons
- [ ] Separate no-match and coverage-unknown outcomes
- [ ] RLS, terminal-stage cleanup, application-delete cascade, and manual clear
- [ ] Automated fixtures plus two-account hosted verification

### Add After Validation

- [ ] Better deterministic title-family taxonomy — after false-negative review
- [ ] Provider fallback — only if the primary free provider is unavailable and
      the fallback permits the intended use
- [ ] Optional manual single-profile clipper — only if public snippets cannot
      support enough evidence and the user still wants deeper confirmation
- [ ] Optional resume-to-profile draft — only with explicit fact-by-fact user
      confirmation

### Future Consideration

- [ ] Connection import — revisit only with a materially larger graph and clear
      hit-rate value
- [ ] Outreach drafting — after candidate quality earns trust
- [ ] Contact details — only with a funded, rights-cleared data provider
- [ ] Automated or scheduled outreach — remains outside the product posture

## Feature Prioritization

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Feasibility/policy gate | HIGH | MEDIUM | P1 |
| Confirmed profile | HIGH | MEDIUM | P1 |
| Eligibility + deterministic score | HIGH | HIGH | P1 |
| Manual search/refresh | HIGH | HIGH | P1 |
| URL + reason results | HIGH | MEDIUM | P1 |
| Honest unknown state | HIGH | MEDIUM | P1 |
| Lifecycle and privacy | HIGH | MEDIUM | P1 |
| Provider fallback | MEDIUM | HIGH | P2 |
| Clipper | LOW | HIGH | P3 |
| Messages/contact details | LOW for current goal | HIGH | P3 |

## Acceptance Signals

The deleted 30-day warm-path hit-rate criterion must not be reintroduced.
Instead, validate the feature itself with pre-launch evidence:

- all deliberately unrelated title pairs are rejected;
- team leads/managers in the same function can outrank peers without becoming
  excessively senior;
- program match outranks school/college, which outranks university;
- no fact appears in a reason unless supported by returned evidence;
- no search failure is presented as “no suitable profiles”;
- no request can exceed configured quota or leak across users;
- result count is always 0–5 and weak candidates are never used as padding.

## Sources

- Owner decisions captured during v1.1 milestone questioning
- Existing tracker, ranking, RLS, quota, and deletion implementation in this
  repository
- [LinkedIn public profile visibility](https://www.linkedin.com/help/linkedin/answer/a520838/) —
  public-profile sections are user-controlled and external search indexes may
  be stale
- [LinkedIn User Agreement](https://www.linkedin.com/legal/user-agreement) —
  automated access and downstream information-use restrictions
- [Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search) —
  result fields and domain-filter capability

---
*Feature research for: v1.1 Outreach Intelligence*
*Researched: 2026-07-28*

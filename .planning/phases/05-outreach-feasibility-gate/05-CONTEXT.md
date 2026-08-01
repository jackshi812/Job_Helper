# Phase 5: Outreach Feasibility Gate - Context

**Gathered:** 2026-07-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 5 produces an evidence-backed owner go/no decision before any production
outreach search is built. It first reviews the exact Tavily-to-LinkedIn search,
display, persistence, optional cache, and deletion flow against current provider
rights and LinkedIn policy. Only if that review passes may a disposable,
non-production spike test public search quality. The phase may add local spike
scripts, fixtures, and planning evidence, but it does not add production UI,
database schema, background collection, or application-facing search behavior.
A no-go stops the outreach milestone and returns to the owner with separately
scoped redesign choices.

</domain>

<decisions>
## Implementation Decisions

### Test Applications
- **D-01:** Use eight cases: six user-selected real applications plus two
  controlled cases.
- **D-02:** The six real applications must span at least three companies,
  include both risk/finance and software/technical roles, and include no more
  than two applications from any one company.
- **D-03:** The controlled set contains one known-positive retrieval case and
  one known-negative rejection case.
- **D-04:** Real applications are copied into a disposable corpus rather than
  queried or modified in production during the spike.

### Search-Quality Gate
- **D-05:** Quality passes only when at least four of the six real applications
  yield at least one genuinely qualified LinkedIn profile, the known-positive
  control is found, and the known-negative control is rejected.
- **D-06:** A qualifying result needs supported current-company and meaningful
  role-fit evidence. Shared academic or work history improves ranking but is
  not required for a case to pass.
- **D-07:** Each application may use at most three provider searches.
- **D-08:** A provider or evidence failure gets at most one bounded retry. If it
  remains unresolved, the case is labeled `coverage_unknown` and does not count
  toward the four-of-six pass bar. It must not be mislabeled as no suitable
  profiles.

### Rights and Policy Gate
- **D-09:** A clear prohibition in either the selected provider's terms or
  LinkedIn's rules is an automatic no-go. Production search must not be built.
- **D-10:** Unclear terms are also a no-go unless written provider
  clarification resolves the ambiguity for the intended operation.
- **D-11:** The exact reviewed flow must permit public search plus display and
  persistence of the final LinkedIn URL and title-inclusive match reason.
  Reusable company-level caching is optional: omit it if it is not permitted,
  provided the hard free-tier limits remain viable without it.
- **D-12:** Rights review happens before live candidate searches in the spike.
  Both the rights/policy gate and the search-quality gate must pass for a go.
- **D-13:** A failed rights or quality gate stops the outreach milestone. Phase
  5 records the no-go and returns separate redesign choices to the owner; it
  does not automatically pivot to pasted LinkedIn URLs or non-LinkedIn pages.

### Disposable Data and Cleanup
- **D-14:** Each real-case fixture contains only an anonymous case label,
  company, job title, a few role terms, and the selected confirmed academic or
  work facts required for its searches. Do not copy tracker notes, resumes,
  linked-resume information, or full job descriptions.
- **D-15:** Raw provider responses may be retained only long enough to label
  the run and let the owner review exact results. They are deleted when the
  sanitized report is produced.
- **D-16:** The committed quality report contains anonymous case labels,
  `pass`/`no_match`/`coverage_unknown` outcomes, evidence booleans, provider
  query counts, and aggregate totals. It contains no candidate names, LinkedIn
  URLs, or source snippets.
- **D-17:** Immediately after the owner records the go/no decision, delete the
  temporary corpus and all raw results and run an automated zero-residue
  assertion. Only the sanitized report, rights evidence, and decision record
  remain.

### the agent's Discretion
- Exact query wording and allocation across role fit, manager/lead fit, and
  shared-history discovery, within the three-search cap.
- Fixture IDs, local file layout, report schema details, bounded retry timing,
  and the zero-residue assertion mechanism.
- Exact presentation of the rights matrix and quality report, provided every
  locked operation, case outcome, query count, and gate result is plainly
  reviewable by the owner.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone Contract
- `.planning/PROJECT.md` — Defines the v1.1 outreach boundary, free-only
  constraint, prohibited LinkedIn automation, and blocking feasibility posture.
- `.planning/REQUIREMENTS.md` — `OUTR-04` and `OUTR-05` are the requirements
  owned by Phase 5; later outreach requirements must not be implemented here.
- `.planning/ROADMAP.md` — Defines the Phase 5 goal, dependency, and three
  success criteria.

### Research Baseline
- `.planning/research/SUMMARY.md` — Synthesizes the current provider comparison,
  LinkedIn-policy concern, suggested corpus, and gate-first roadmap.
- `.planning/research/STACK.md` — Establishes Tavily as a disposable first
  spike behind a provider-neutral native-fetch boundary.
- `.planning/research/ARCHITECTURE.md` — Describes the proposed search, evidence,
  persistence, cache, and deletion flow whose rights must be reviewed.
- `.planning/research/PITFALLS.md` — Defines the policy, evidence, free-quota,
  unknown-coverage, and data-retention failure modes the spike must expose.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `supabase/functions/discovery-sweep/index.ts`: existing external-call flow
  reserves quota immediately before each physical provider request and
  distinguishes budget skips from failed calls. Phase 5 can mirror these
  invariants in its local spike without coupling the spike to production.
- `supabase/functions/_shared/discovery-health.ts`: existing
  `ok`/`degraded`/`failed` summarization and explicit skipped-work handling are
  useful precedents for honest `pass`/`no_match`/`coverage_unknown` reporting.
- `scripts/verify-phase-03-9-hosted.mjs`: existing verification scripts use pure
  evaluators, machine-readable check records, exact owner approval, and
  zero-residue assertions. Phase 5 can follow the same evidence shape.

### Established Patterns
- External work is admitted and bounded before the call that spends quota.
- Missing or partial evidence fails closed and remains distinct from a valid
  empty result.
- Disposable verification must not mutate real-user state, must bind evidence
  to an explicit decision, and must prove cleanup rather than merely claim it.
- Machine-readable checks back a short owner-facing decision instead of making
  the owner inspect implementation details.

### Integration Points
- Phase 5 should be isolated to local `scripts/`, tests, and
  `.planning/phases/05-outreach-feasibility-gate/` evidence; production
  functions, migrations, and web UI remain untouched.
- If the gate passes, later phases may adapt the existing quota, degraded-state,
  deterministic-verification, and owner-scoped data patterns. They must not be
  introduced into production during this phase.

</code_context>

<specifics>
## Specific Ideas

- The representative set deliberately includes risk/finance and
  software/technical applications so unrelated functions such as Risk Analyst
  versus Software Engineer cannot pass through generic word overlap.
- The positive control proves that the provider can retrieve a known qualified
  public profile; the negative control proves that apparent public results can
  be rejected.
- The owner reviews exact transient results before cleanup, while the committed
  artifact remains anonymous and contains no third-party profile data.

</specifics>

<deferred>
## Deferred Ideas

- No fallback outreach capability is selected in advance. User-pasted LinkedIn
  URLs, non-LinkedIn professional pages, or stopping the feature entirely are
  separate choices to discuss only if Phase 5 records a no-go.

### Reviewed Todos (not folded)
- **Refine company visibility controls** — existing dashboard feed filtering;
  unrelated to the outreach feasibility gate.
- **Replace experience cap with title exclusions** — job-preference filtering;
  unrelated to public profile search feasibility.
- **Consolidate score tier controls** — dashboard presentation work; unrelated
  to this phase.
- **Pilot Workday polling for 10 companies** — job-source monitoring expansion;
  company-keyword overlap only and outside Phase 5.

</deferred>

---

*Phase: 5-outreach-feasibility-gate*
*Context gathered: 2026-07-28*

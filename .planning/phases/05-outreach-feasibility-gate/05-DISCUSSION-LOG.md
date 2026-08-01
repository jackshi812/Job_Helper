# Phase 5: Outreach Feasibility Gate - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution
> agents. Decisions are captured in CONTEXT.md — this log preserves the
> alternatives considered.

**Date:** 2026-07-28
**Phase:** 5-outreach-feasibility-gate
**Areas discussed:** Test applications, search-quality bar, policy-risk bar,
test-data cleanup

---

## Scope Triage

The pending-todo matcher surfaced four existing items. The user selected
**None**, so none were folded into Phase 5:

- Refine company visibility controls
- Replace experience cap with title exclusions
- Consolidate score tier controls
- Pilot Workday polling for 10 companies

## Test Applications

### Corpus Source

| Option | Description | Selected |
|--------|-------------|----------|
| Blend | User-selected real applications plus controlled examples | ✓ |
| Real only | Highest realism but fewer known failure cases | |
| Made-up only | Lowest personal-data exposure but weaker evidence | |

**User's choice:** Blend.

### Corpus Size

| Option | Description | Selected |
|--------|-------------|----------|
| 6 real + 2 controlled | Eight total cases | ✓ |
| 4 real + 2 controlled | Minimum six-case corpus | |
| 8 real + 2 controlled | Maximum ten-case corpus | |

**User's choice:** Six real applications and two controlled examples.

### Real-Case Balance

| Option | Description | Selected |
|--------|-------------|----------|
| Maximize variety | At least three companies, both risk/finance and software/technical roles, no more than two cases per company | ✓ |
| Six most recent | Accept repeated companies or role families | |
| Hardest searches | Focus on uncommon titles and less-public companies | |

**User's choice:** Maximize company and role variety.

### Controlled Cases

| Option | Description | Selected |
|--------|-------------|----------|
| One positive + one negative | Test both retrieval and rejection | ✓ |
| Two positives | Focus on retrieval recall | |
| Two negatives | Focus on false-positive resistance | |

**User's choice:** One known-positive retrieval case and one known-negative
rejection case.

**Notes:** After these four decisions, the user chose to move to the next area.

## Search-Quality Bar

### Real-Case Pass Rate

| Option | Description | Selected |
|--------|-------------|----------|
| At least 4 of 6 | Balanced usefulness bar | ✓ |
| At least 5 of 6 | Strict bar | |
| At least 3 of 6 | Easier exploratory bar | |

**User's choice:** At least four of six real applications. The positive control
must also be found and the negative control rejected.

### What Counts as Success

| Option | Description | Selected |
|--------|-------------|----------|
| Strong company-and-role match | Shared history improves ranking but is optional | ✓ |
| Shared history required | At least one academic or work overlap | |
| Both result types required | One role match plus one shared-history match | |

**User's choice:** A strong supported company-and-role match is sufficient.

### Search Effort

| Option | Description | Selected |
|--------|-------------|----------|
| Up to 3 searches | Try role, manager/lead, and shared-history angles | ✓ |
| Up to 2 searches | Lower cost and narrower coverage | |
| Up to 4 searches | Broader but less representative of a tight cap | |

**User's choice:** At most three provider searches per application.

### Unknown Coverage

| Option | Description | Selected |
|--------|-------------|----------|
| One retry, then not passing | Preserve `coverage_unknown` label | ✓ |
| Exclude unknown cases | Remove them from the denominator | |
| Retry on later days | Continue until every case resolves | |

**User's choice:** One bounded retry; an unresolved case remains
`coverage_unknown` and does not pass.

**Notes:** After these four decisions, the user chose to move to the next area.

## Policy-Risk Bar

### Clear Prohibition

| Option | Description | Selected |
|--------|-------------|----------|
| Automatic no-go | Do not build production search | ✓ |
| Public-minimal exception | Proceed when only URLs/reasons are retained | |
| Accept documented risk | Proceed despite no clear permission | |

**User's choice:** Any clear prohibition is an automatic no-go.

### Unclear Terms

| Option | Description | Selected |
|--------|-------------|----------|
| No-go until clarified | Require written provider clarification | ✓ |
| Owner accepts uncertainty | Proceed after documented acceptance | |
| Smaller persisted feature | Save less data and proceed | |

**User's choice:** Unclear is also no-go unless written provider clarification
resolves it.

### Optional Cache

| Option | Description | Selected |
|--------|-------------|----------|
| Proceed without cache | Final URL/reason persistence must be permitted and free caps must still work | ✓ |
| Cache required | No go without cache permission | |
| Spike only | Never proceed to production without cache | |

**User's choice:** Caching is optional if the permitted, cache-free flow remains
within hard free limits.

### No-Go Outcome

| Option | Description | Selected |
|--------|-------------|----------|
| Stop and return | Present separately scoped redesign choices | ✓ |
| Auto-pivot to pasted URLs | Build a manual LinkedIn URL flow | |
| Auto-pivot off LinkedIn | Use other public professional pages | |

**User's choice:** Stop the outreach milestone and return with redesign choices.

**Notes:** After these four decisions, the user chose to move to the next area.

## Test-Data Cleanup

### Real-Application Fields

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal search inputs | Anonymous ID, company, title, role terms, selected confirmed history | ✓ |
| Full job description | Add complete posting content | |
| Complete tracker record | Include notes and resume linkage | |

**User's choice:** Copy only the minimal search inputs.

### Raw Provider Responses

| Option | Description | Selected |
|--------|-------------|----------|
| Retain through review, then delete | Permit labeling and exact owner review | ✓ |
| Memory only | Never write raw responses to disk | |
| Keep through milestone | Preserve local raw evidence longer | |

**User's choice:** Keep raw responses only through labeling and owner review,
then delete them when the sanitized report is produced.

### Committed Quality Evidence

| Option | Description | Selected |
|--------|-------------|----------|
| Anonymous outcomes and counts | No names, LinkedIn URLs, or snippets | ✓ |
| Include URLs | Retain qualifying LinkedIn URLs | |
| Include URLs and snippets | Preserve stronger third-party evidence | |

**User's choice:** Commit only anonymous outcomes, evidence booleans, query
counts, and aggregate totals.

### Cleanup Timing

| Option | Description | Selected |
|--------|-------------|----------|
| Immediately after go/no | Require automated zero-residue proof | ✓ |
| Seven days later | Short retention window | |
| At milestone completion | Retain until v1.1 closes | |

**User's choice:** Delete immediately after the owner records go/no and prove
zero residue automatically.

**Notes:** The user finished this area and approved creation of the Phase 5
context document.

## the agent's Discretion

- Exact query wording and distribution within the three-search cap
- Local fixture and report file layout
- Anonymous case-ID format
- Bounded retry timing
- Exact zero-residue assertion implementation
- Rights-matrix and owner-report presentation details

## Deferred Ideas

- If Phase 5 produces a no-go, possible fallback directions must be discussed
  as a separate decision. No pasted-URL or non-LinkedIn fallback was selected.


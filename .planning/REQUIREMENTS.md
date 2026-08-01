# Requirements: Job Application Copilot

**Defined:** 2026-07-28
**Milestone:** v1.1 Outreach Intelligence
**Core Value:** Discover relevant jobs fast, score them accurately, and surface
them in a focused feed — then help the user identify a small number of credible
people for deliberate, manual outreach.

## v1.1 Requirements

Requirements for the v1.1 milestone. Each requirement maps to exactly one
roadmap phase.

### Feasibility and Cost

- [x] **OUTR-04**: Production implementation proceeds only after the selected public-web search provider permits the intended LinkedIn URL and match-reason display, persistence, and any caching, and the owner accepts the documented LinkedIn-policy posture; otherwise the feature remains disabled and is redesigned or stopped.
- [x] **OUTR-05**: Before the complete feature is built, the historical 6–10 application, three-company representative spike remains conditional on rights clearance; because the accepted branch is `RIGHTS_NO_GO`, D-12 requires `NOT_RUN_RIGHTS_NO_GO` with zero cases and provider calls, no quality claim, disabled production outreach, and a receipt-bound owner no-go that closes the feasibility decision at a stopped milestone.
- [ ] **OUTR-06**: Each user-requested search stays within hard per-user and global free-tier budgets using atomic per-call admission, provider backoff, and no automatic paid usage; provider-permitted company/role-scoped reuse may reduce calls without weakening freshness or user isolation.

### Outreach Profile

- [ ] **OUTR-07**: User can create, edit, explicitly confirm, and delete an outreach profile containing universities, schools or colleges, programs or majors, employers, internships, roles, and optional attendance or employment dates.
- [ ] **OUTR-08**: User's outreach profile remains private to that user, is not automatically inferred from a resume, and treats omitted dates or facts as unknown rather than inferred.

### Search Flow

- [ ] **OUTR-09**: User can manually request or refresh outreach candidates only for an owned application whose current stage is Applied, Outreach Sent, or Interview.
- [ ] **OUTR-10**: A permitted user request runs a bounded server-side public-web search for LinkedIn profile URLs using the application company, role, saved job information, confirmed outreach-profile facts, and no-cost role vocabulary from existing job-poll history, without logging into, enumerating, or directly scraping LinkedIn.
- [ ] **OUTR-11**: User sees “No suitable public profiles” only after a successfully
  completed search finds no eligible candidate, while quota, provider, timeout, or insufficient-coverage failures are shown as “Coverage unknown.”

### Eligibility and Ranking

- [ ] **OUTR-12**: A candidate is eligible only when public evidence supports a usable LinkedIn profile URL, current work at the target company, a meaningful relationship to the applied role, and neither a clearly unrelated function nor excessive seniority; exact title, specialty, or direct-peer status is not required.
- [ ] **OUTR-13**: Every eligible candidate receives the deterministic 100-point score locked by the owner: title proximity 35, academic history 30, role usefulness 15, academic timing 10, shared work or internship history 5, and evidence quality 5.
- [ ] **OUTR-14**: Academic-history scoring awards only the strongest supported level—exact program or major above school or college above university—and academic timing ranks overlapping attendance above nearby attendance while unknown timing remains neutral.
- [ ] **OUTR-15**: Role-usefulness scoring gives highest preference to a relevant team lead or manager without allowing an excessively senior candidate, while title-proximity scoring separately prefers exact and closely related roles.
- [ ] **OUTR-16**: A
  completed search returns one to five highest-ranked qualified profiles when at least one qualifies, uses deterministic tie-breaking and canonical URL deduplication, and never pads the list with weak or ineligible candidates.

### Results and Lifecycle

- [ ] **OUTR-17**: User sees and the system persists only each selected candidate's canonical LinkedIn profile URL and one short match reason containing the candidate's current title, plus the minimum owner, application, order, status, and timestamp metadata required to operate the feature.
- [ ] **OUTR-18**: A match reason includes only facts supported by transient public evidence, labels uncertain inference with “Likely” or omits it, and never persists or displays the internal score, person name as a separate field, full profile, source page, snippet, or unmatched facts.
- [ ] **OUTR-19**: A successful manual refresh atomically replaces the prior result set, including replacing it with a valid no-match state, while a failed or coverage-unknown refresh preserves the last successful results with an explicit warning instead of presenting them as fresh.
- [ ] **OUTR-20**: Saved outreach results remain isolated to their owner and are permanently removed by manual clear, application deletion, or a canonical stage transition to Offer or Rejected; later returning the application to an active stage does not restore deleted results.

## Future Requirements

Deferred beyond v1.1 and excluded from the current roadmap.

### Outreach Depth

- **OUTR-01**: User can request likely contact details for a selected person through a rights-cleared data source.
- **OUTR-02**: User can generate email and LinkedIn outreach drafts; nothing is sent without explicit approval and LinkedIn messages remain manual.
- **OUTR-03**: User can generate cover letters or follow-up emails.
- **OUTR-21**: User can manually confirm or enrich one profile they opened through an explicit single-record clipper.
- **OUTR-22**: System can use a sufficiently valuable, explicitly imported connections graph to identify first-degree relationships.
- **OUTR-23**: System can use a rights-cleared fallback search provider when the primary provider is unavailable or lacks coverage.

### Enhancements

- **ENHC-01**: User can save an arbitrary job URL to the tracker and parse its basic position details.
- **ENHC-02**: User can use a companion browser extension for employer-application form autofill.

## Out of Scope

| Feature | Reason |
|---------|--------|
| LinkedIn Connections CSV in v1.1 | The roughly 500-person graph is unlikely to yield enough company-and-role matches to justify sensitive graph-data handling |
| Automatic connection-status detection | The selected public-search path does not know first-degree relationship status |
| Single-profile clipper in v1.1 | Explicitly deferred until public-search quality is understood |
| Logged-in LinkedIn automation, profile enumeration, or direct page scraping | Conflicts with the approved human-in-the-loop posture and creates platform/account risk |
| Email or other contact-detail discovery | v1.1 returns profile destinations only; paid contact providers violate the free-only constraint |
| Talking points, message drafting, or automated sending | Candidate quality must be proven first; the user opens profiles and communicates manually |
| Background outreach monitoring | Search and refresh occur only when the user requests them |
| Saving names, full profile histories, raw source results, snippets, scores, or source pages | The approved result contract retains only URL and short title-inclusive reason |
| Always returning five candidates | Weak-result padding would damage trust; one qualified candidate is valid |
| Paid search or automatic pay-as-you-go | Free operation is a hard constraint |
| The removed 30-day warm-path hit-rate or kill measurement | Explicitly deleted by the owner because the small connection graph made the metric inappropriate |
| Google Custom Search as the v1.1 engine | Closed to new customers; the implementation remains provider-neutral and starts with a Tavily feasibility spike |
| Native mobile/desktop app or public signup | Existing web app and two-user invite-only scope remain sufficient |

## Traceability

Each v1.1 requirement maps to exactly one roadmap phase.

| Requirement | Phase | Status |
|-------------|-------|--------|
| OUTR-04 | Phase 5 | Complete |
| OUTR-05 | Phase 5 | Complete |
| OUTR-06 | Phase 7 | Pending |
| OUTR-07 | Phase 6 | Pending |
| OUTR-08 | Phase 6 | Pending |
| OUTR-09 | Phase 7 | Pending |
| OUTR-10 | Phase 7 | Pending |
| OUTR-11 | Phase 7 | Pending |
| OUTR-12 | Phase 6 | Pending |
| OUTR-13 | Phase 6 | Pending |
| OUTR-14 | Phase 6 | Pending |
| OUTR-15 | Phase 6 | Pending |
| OUTR-16 | Phase 6 | Pending |
| OUTR-17 | Phase 7 | Pending |
| OUTR-18 | Phase 7 | Pending |
| OUTR-19 | Phase 7 | Pending |
| OUTR-20 | Phase 7 | Pending |

**Coverage:**

- v1.1 requirements: 17 total
- Mapped to phases: 17
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-28*
*Last updated: 2026-07-28 after roadmap traceability mapping*

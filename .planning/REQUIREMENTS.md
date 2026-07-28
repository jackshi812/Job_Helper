# Requirements: Job Application Copilot

**Defined:** 2026-07-15
**Core Value:** Discover relevant jobs fast, score them accurately, and surface them in a focused feed — if discovery and scoring are unreliable, nothing else matters.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Foundation

- [x] **AUTH-01**: User can log in with email/password; signup is invite-only (exactly two accounts, no public registration)
- [x] **AUTH-02**: User session persists across browser refresh
- [x] **AUTH-03**: Each user's data (preferences, resumes, watchlist, applications, jobs) is fully isolated via row-level security — no user can read another's rows
- [x] **AUTH-04**: User can delete their own resumes and data (user-controlled deletion)

### Preferences & Watchlist

- [x] **PREF-01**: User can set target titles, locations, include/exclude keywords, title exclusions, an optional maximum-experience scoring signal, and a validated editable deterministic ranking rubric and tier thresholds
- [x] **PREF-02**: User can add, edit, and remove companies on a watchlist of 100+ career-site URLs
- [x] **PREF-03**: System auto-detects ATS platform (Greenhouse/Lever/Ashby) from a pasted career-site URL and stores the polling endpoint
- [x] **PREF-04**: User can see per-company monitoring health (last successful poll, failing sources flagged)
- [x] **PREF-05**: Watchlist shows a clickable Link column that opens each company's stored job-search/careers URL in a new tab

### Discovery & Monitoring

- [x] **DISC-01**: System polls watchlist ATS endpoints on a schedule that keeps discovery-to-feed within 5–15 minutes
- [x] **DISC-02**: System discovers jobs outside the watchlist via one aggregator API (breadth source, latency not guaranteed)
- [x] **DISC-03**: System deduplicates postings across sources (stable ATS IDs + fuzzy company/title/location match) so a job is never surfaced twice
- [x] **DISC-04**: System captures a job-description snapshot at first sight so posting context remains available after the source disappears
- [x] **DISC-05**: System marks jobs as closed when they disappear from ATS polls (stale-job detection)
- [x] **DISC-06**: Pipeline runs record a heartbeat; a dead or silently failing cron is detectable within one poll cycle
- [x] **DISC-07**: System validates one representative company per feasible additional source platform (SmartRecruiters, Recruitee, Workday, Oracle Recruiting, iCIMS, SuccessFactors, and Eightfold) while preserving Greenhouse/Lever/Ashby support
- [x] **DISC-08**: System validates the agreed finance-company set by directly monitoring each company with a stable, safely pollable public contract; every remaining company has a canonical careers link, provider evidence, and an explicit `unsupported_with_reason` disposition and is never labeled monitored
- [x] **DISC-09**: Failed, blocked, changed, or implausibly empty sources retain last-known jobs, report Degraded with last-success/error detail, and never close jobs from the failed observation; new connectors are staged before scheduled activation

### Scoring & Feed

- [x] **SCOR-01**: Deterministic title, US-location, title-exclusion, and literal keyword rules remove ineligible postings before publication
- [x] **SCOR-02**: Eligible postings receive a reproducible, transparent 100-point deterministic ranking with no automatic/background AI scoring or paid score reservation
- [x] **SCOR-03**: Each ranked job stores a six-category points-earned/points-possible/evidence breakdown
- [x] **SCOR-04**: User can view one atomically complete deterministic Dashboard feed with stored score/tier, posted time, company controls, sorting, and a direct HTTPS employer apply link
- [x] **SCOR-05**: User can view the full JD snapshot and the same stored six-category deterministic rubric evidence on job detail

### Resume Management

- [x] **RESU-01**: User can upload and manage multiple base resumes as DOCX files, stored in private encrypted storage

### Tracker

- [x] **TRAK-01**: User can track each application through exactly six stages: Ready to Apply, Applied, Outreach Sent, Interview, Offer, and Rejected
- [ ] **TRAK-02**: User can manually add a job to the tracker (jobs found outside the system)
- [ ] **TRAK-03**: User can attach notes to each tracked application
- [x] **TRAK-04**: Tracked application links its preserved JD context and, when available, a resume the user prepared manually outside the app

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Outreach

- **OUTR-01**: User can request likely hiring contacts for a job (heuristic email patterns, manual verification, no paid APIs)
- **OUTR-02**: User can generate email and LinkedIn outreach drafts; nothing sent without approval; LinkedIn messages sent manually
- **OUTR-03**: User can generate cover letters / follow-up emails

### Enhancements

- **ENHC-01**: Save-to-tracker from arbitrary URL (paste a LinkedIn link, parse basics)
- **ENHC-02**: Companion browser extension for form autofill on employer application pages

## Out of Scope

| Feature | Reason |
|---------|--------|
| LinkedIn logged-in scraping, Easy Apply automation, auto-sent LinkedIn messages | Platform policy violation, account risk — explicit PROJECT.md exclusion |
| Auto-apply / mass apply | Policy violations and garbage applications; speed the human up instead |
| Full resume builder with templates | Would destroy the DOCX-preservation differentiator; users have polished resumes |
| Gamified ATS match score ("get to 80!") | Encourages keyword stuffing; conflicts with truthful-edits principle |
| Kanban drag-drop board | Table + stage column suffices for 2 users |
| Paid contact-discovery APIs (Hunter/Apollo) | Near-zero cost constraint |
| Native mobile/desktop app | Web app covers the need for 2 users |
| Multi-tenant/public signup | Invite-only, two users, by design |
| Interview prep / salary tools / analytics | Teal-style feature sprawl; stay narrow |
| Browser push, email alerts, alert tuning, and notification ledger (NOTF-01..04) | Removed by owner on 2026-07-19; the product is feed-only |
| Automated resume tailoring (former RESU-02..05) | Removed by owner on 2026-07-27; resumes will be tailored manually outside the app |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

A requirement may appear on more than one row when a later phase extends or
replaces its implementation without inventing a new requirement ID. DISC-07,
DISC-08, and DISC-09 were closed by Phase 02.1 and extended by Phase 03.1.
PREF-01 and SCOR-01..05 were first closed by Phase 3 and remapped by Phase 03.4
from automatic AI scoring to the complete deterministic ranking contract.

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | Phase 1 | Complete |
| AUTH-02 | Phase 1 | Complete |
| AUTH-03 | Phase 1 | Complete |
| AUTH-04 | Phase 1 | Complete |
| PREF-01 | Phase 3 | Complete |
| PREF-01 | Phase 03.4 | Complete |
| PREF-02 | Phase 2 | Complete |
| PREF-03 | Phase 2 | Complete |
| PREF-04 | Phase 2 | Complete |
| PREF-05 | Phase 02.1 | Complete |
| DISC-01 | Phase 2 | Complete |
| DISC-02 | Phase 2 | Complete |
| DISC-03 | Phase 2 | Complete |
| DISC-04 | Phase 2 | Complete |
| DISC-05 | Phase 2 | Complete |
| DISC-06 | Phase 2 | Complete |
| DISC-07 | Phase 02.1 | Complete |
| DISC-07 | Phase 03.1 | Complete |
| DISC-08 | Phase 02.1 | Complete |
| DISC-08 | Phase 03.1 | Complete |
| DISC-09 | Phase 02.1 | Complete |
| DISC-09 | Phase 03.1 | Complete |
| SCOR-01 | Phase 3 | Complete |
| SCOR-02 | Phase 3 | Complete |
| SCOR-03 | Phase 3 | Complete |
| SCOR-04 | Phase 3 | Complete |
| SCOR-05 | Phase 3 | Complete |
| SCOR-01 | Phase 03.4 | Complete |
| SCOR-02 | Phase 03.4 | Complete |
| SCOR-03 | Phase 03.4 | Complete |
| SCOR-04 | Phase 03.4 | Complete |
| SCOR-05 | Phase 03.4 | Complete |
| RESU-01 | Phase 3 | Complete |
| TRAK-01 | Phase 4 | Complete |
| TRAK-02 | Phase 4 | Pending |
| TRAK-03 | Phase 4 | Pending |
| TRAK-04 | Phase 4 | Complete |

**Coverage:**

- v1 requirements: 28 total
- Mapped to phases: 28
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-15*
*Last updated: 2026-07-28 after Phase 4's six-stage tracker lifecycle was finalized*

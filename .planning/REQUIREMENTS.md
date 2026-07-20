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

- [x] **PREF-01**: User can set job preferences: target titles, locations, keywords (include/exclude)
- [x] **PREF-02**: User can add, edit, and remove companies on a watchlist of 100+ career-site URLs
- [x] **PREF-03**: System auto-detects ATS platform (Greenhouse/Lever/Ashby) from a pasted career-site URL and stores the polling endpoint
- [x] **PREF-04**: User can see per-company monitoring health (last successful poll, failing sources flagged)
- [x] **PREF-05**: Watchlist shows a clickable Link column that opens each company's stored job-search/careers URL in a new tab

### Discovery & Monitoring

- [x] **DISC-01**: System polls watchlist ATS endpoints on a schedule that keeps discovery-to-feed within 5–15 minutes
- [x] **DISC-02**: System discovers jobs outside the watchlist via one aggregator API (breadth source, latency not guaranteed)
- [x] **DISC-03**: System deduplicates postings across sources (stable ATS IDs + fuzzy company/title/location match) so a job is never surfaced twice
- [x] **DISC-04**: System captures a job-description snapshot at first sight (postings vanish; snapshot feeds tailoring)
- [x] **DISC-05**: System marks jobs as closed when they disappear from ATS polls (stale-job detection)
- [x] **DISC-06**: Pipeline runs record a heartbeat; a dead or silently failing cron is detectable within one poll cycle
- [x] **DISC-07**: System validates one representative company per feasible additional source platform (SmartRecruiters, Recruitee, Workday, Oracle Recruiting, iCIMS, SuccessFactors, and Eightfold) while preserving Greenhouse/Lever/Ashby support
- [x] **DISC-08**: System validates the agreed finance-company set by directly monitoring each company with a stable, safely pollable public contract; every remaining company has a canonical careers link, provider evidence, and an explicit `unsupported_with_reason` disposition and is never labeled monitored
- [x] **DISC-09**: Failed, blocked, changed, or implausibly empty sources retain last-known jobs, report Degraded with last-success/error detail, and never close jobs from the failed observation; new connectors are staged before scheduled activation

### Scoring & Feed

- [x] **SCOR-01**: Cheap filters (title/location/keyword rules) discard irrelevant postings before any AI call
- [x] **SCOR-02**: AI scores surviving postings against the user's preferences and uploaded resume
- [x] **SCOR-03**: Each scored job shows plain-language match reasons ("why this matched")
- [x] **SCOR-04**: User can view a dashboard feed of new matches with score, match reasons, posted-time, and direct link to the employer's apply page
- [x] **SCOR-05**: User can view job detail with full JD snapshot and keyword-gap panel (categorized gaps vs their resume, advisory only)

### Resume Tailoring

- [ ] **RESU-01**: User can upload and manage multiple base resumes as DOCX files, stored in private encrypted storage
- [ ] **RESU-02**: User can pick a base resume for a job and receive AI-suggested keyword edits that preserve the DOCX formatting
- [ ] **RESU-03**: AI edits are truthful-only: rephrase/reorder/emphasize existing facts, never invent skills or experience; new-term diff against source resume enforced programmatically
- [ ] **RESU-04**: User reviews edits in a word-level diff view and must approve before any edit lands
- [ ] **RESU-05**: User can download the approved tailored resume as PDF with formatting fidelity

### Tracker

- [ ] **TRAK-01**: User can track each application through stages: saved, resume prepared, applied, outreach sent, interview, rejected, offer
- [ ] **TRAK-02**: User can manually add a job to the tracker (jobs found outside the system)
- [ ] **TRAK-03**: User can attach notes to each tracked application
- [ ] **TRAK-04**: Tracked application links its JD snapshot and tailored resume (when prepared)

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

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | Phase 1 | Complete |
| AUTH-02 | Phase 1 | Complete |
| AUTH-03 | Phase 1 | Complete |
| AUTH-04 | Phase 1 | Complete |
| PREF-01 | Phase 3 | Complete |
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
| DISC-08 | Phase 02.1 | Complete |
| DISC-09 | Phase 02.1 | Complete |
| SCOR-01 | Phase 3 | Complete |
| SCOR-02 | Phase 3 | Complete |
| SCOR-03 | Phase 3 | Complete |
| SCOR-04 | Phase 3 | Complete |
| SCOR-05 | Phase 3 | Complete |
| RESU-01 | Phase 3 | Pending |
| RESU-02 | Phase 4 | Pending |
| RESU-03 | Phase 4 | Pending |
| RESU-04 | Phase 4 | Pending |
| RESU-05 | Phase 4 | Pending |
| TRAK-01 | Phase 4 | Pending |
| TRAK-02 | Phase 4 | Pending |
| TRAK-03 | Phase 4 | Pending |
| TRAK-04 | Phase 4 | Pending |

**Coverage:**

- v1 requirements: 32 total
- Mapped to phases: 32
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-15*
*Last updated: 2026-07-19 after removing notifications from v1*

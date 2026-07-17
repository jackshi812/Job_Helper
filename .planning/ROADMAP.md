# Roadmap: Job Application Copilot

## Overview

Four vertical phases, each ending with something two real users can exercise end-to-end. Phase 1 stands up the deployed app with invite-only auth and airtight per-user data isolation (RLS retrofits are painful — it goes first). Phase 2 builds the core-value engine: 100+ watched career sites polled on a 5–15 minute cadence, deduplicated, snapshotted, and health-monitored — started early so it soaks against real-world sites while later phases proceed. Phase 3 closes the promise loop: preferences drive cheap filters, AI scores survivors against the user's uploaded resume, and strong matches reach the user via push + email within minutes of posting. Phase 4 turns matches into applications: truthful DOCX-preserving resume tailoring with mandatory review, plus a manual tracker from saved through offer.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation & Access** - Deployed app with invite-only auth for two users and RLS-enforced data isolation (completed 2026-07-16)
- [x] **Phase 2: Watchlist Ingestion & Monitoring** - New postings from 100+ watched sites land deduplicated within 5–15 minutes, with visible pipeline health (completed 2026-07-17)
- [ ] **Phase 3: Scoring, Feed & Notifications** - Preferences + cheap filters + AI scoring produce a match feed, and strong matches trigger push + email alerts
- [ ] **Phase 4: Resume Tailoring & Tracker** - Truthful DOCX-preserving tailoring to PDF with mandatory review, plus a manual application tracker

## Phase Details

### Phase 1: Foundation & Access

**Goal**: Two invited users can securely access the deployed app, with every row of their data fully isolated and under their own control
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04
**Success Criteria** (what must be TRUE):

  1. Each of the two invited users can log in with email/password at the deployed URL, and no public signup path exists
  2. User remains logged in after a browser refresh
  3. Logged in as either account, no query or API call can read or modify the other user's rows (preferences, resumes, watchlist, applications, jobs) — verified with both accounts
  4. User can delete their own resumes and data, and the deleted items are gone from both the database and storage

**Plans**: 3/3 plans complete

Plans:
**Wave 1**

- [x] 01-01-PLAN.md — Walking skeleton: scaffold + schema + seeded invite-only login proven end-to-end

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — Resumes vertical slice (upload/list/download/delete) + two-account RLS proof

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-03-PLAN.md — Settings deletion flows, Cloudflare Pages deploy, end-to-end phase verification

### Phase 2: Watchlist Ingestion & Monitoring

**Goal**: As a job seeker, I want to receive new job postings from watched career sites and an aggregator exactly once within 5-15 minutes, so that I can trust my job feed is current without manually checking each career site.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: PREF-02, PREF-03, PREF-04, DISC-01, DISC-02, DISC-03, DISC-04, DISC-05, DISC-06
**Success Criteria** (what must be TRUE):

  1. User can add, edit, and remove companies on a watchlist page by pasting career-site URLs; the system auto-detects Greenhouse/Lever/Ashby and stores the polling endpoint
  2. A job newly posted by a watched company appears in the system within 15 minutes of publication, and appears exactly once even when the aggregator also carries it or the company reposts it
  3. Every captured job has a JD snapshot taken at first sight, and jobs that disappear from ATS polls are marked closed
  4. User can view per-company monitoring health (last successful poll, consecutive failures flagged), and a dead or silently failing cron is surfaced within one poll cycle via the pipeline heartbeat

**Plans**: 6/7 plans executed
**UI hint**: yes

Plans:
**Wave 1**

- [x] 02-01-PLAN.md — Watchlist management slice: paste URL → ATS detect → live verify → shared table with health badges

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02-02-PLAN.md — Ingestion pipeline slice: per-minute due-queue polling, two-layer dedup, JD snapshots, stale-close, health + heartbeat writes

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 02-03-PLAN.md — Aggregator + liveness slice: Adzuna sweep on seed queries, stale-pipeline banner, external dead-man's switch

**Gap Closure Wave 1** *(from 02-VERIFICATION.md gaps_found)*

- [x] 02-04-PLAN.md — Job lifecycle correctness: reopen returned closed postings, truthful no-work heartbeat, close-grace regression tests
- [x] 02-05-PLAN.md — Exclusive claims + non-destructive verification: FOR UPDATE SKIP LOCKED claim migration, disposable watchlist probe, hosted probes 13-16
- [x] 02-06-PLAN.md — Discovery health + cadence: all-failed sweeps surface 503 + persisted status, 15-minute active-window schedule within Adzuna budget

**Gap Closure Wave 2** *(blocked on Gap Closure Wave 1)*

- [ ] 02-07-PLAN.md — Deploy + hosted proof: [BLOCKING] db push 0008/0009, redeploy functions, run probes 1-16 and the rerunnable watchlist verifier

### Phase 3: Scoring, Feed & Notifications

**Goal**: User is alerted within minutes of a relevant new posting — cheap filters gate AI cost, AI scores survivors against the user's own resume and preferences, and only deduplicated matches above the user's threshold notify
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: PREF-01, RESU-01, SCOR-01, SCOR-02, SCOR-03, SCOR-04, SCOR-05, NOTF-01, NOTF-02, NOTF-03, NOTF-04
**Success Criteria** (what must be TRUE):

  1. User can set target titles, locations, and include/exclude keywords, and obviously irrelevant postings are discarded by cheap filters before any AI call is made
  2. User can upload and manage multiple DOCX base resumes in private encrypted storage, and surviving postings receive AI scores with plain-language match reasons grounded in that resume and the user's preferences
  3. User can view a dashboard feed of new matches showing score, match reasons, posted-time, and a direct link to the employer's apply page, plus a job detail view with the full JD snapshot and an advisory keyword-gap panel
  4. A strong match triggers a browser web push (with the tab closed while the browser runs) and a backup email that respects the free-tier digest cap — and notifications fire only for deduplicated, scored jobs above the user's threshold
  5. User can tune their own score threshold and quiet hours, and alerts respect both

**Plans**: TBD
**UI hint**: yes

### Phase 4: Resume Tailoring & Tracker

**Goal**: User can turn any match into a truthfully tailored, formatting-faithful PDF resume after mandatory review, and track every application from saved through offer
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: RESU-02, RESU-03, RESU-04, RESU-05, TRAK-01, TRAK-02, TRAK-03, TRAK-04
**Success Criteria** (what must be TRUE):

  1. User can pick a base resume for a job and receive AI-suggested keyword edits that preserve the original DOCX formatting
  2. Edits only rephrase, reorder, or emphasize facts already in the resume — any term not present in the source resume is flagged programmatically before the user ever sees it
  3. User reviews proposed edits in a word-level diff view, must explicitly approve before any edit lands, and can then download the tailored resume as a PDF with formatting fidelity
  4. User can track applications through all seven stages (saved, resume prepared, applied, outreach sent, interview, rejected, offer), manually add jobs found outside the system, and attach notes to any tracked application
  5. Each tracked application links its JD snapshot and, once prepared, its tailored resume

**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Access | 3/3 | Complete    | 2026-07-16 |
| 2. Watchlist Ingestion & Monitoring | 6/7 | In Progress|  |
| 3. Scoring, Feed & Notifications | 0/TBD | Not started | - |
| 4. Resume Tailoring & Tracker | 0/TBD | Not started | - |

## Coverage

All 32 v1 requirements mapped to exactly one phase:

| Category | Requirements | Phase |
|----------|--------------|-------|
| Foundation | AUTH-01..04 | Phase 1 |
| Preferences & Watchlist | PREF-02, PREF-03, PREF-04 | Phase 2 |
| Preferences & Watchlist | PREF-01 | Phase 3 |
| Discovery & Monitoring | DISC-01..06 | Phase 2 |
| Scoring & Feed | SCOR-01..05 | Phase 3 |
| Notifications | NOTF-01..04 | Phase 3 |
| Resume Tailoring | RESU-01 | Phase 3 |
| Resume Tailoring | RESU-02..05 | Phase 4 |
| Tracker | TRAK-01..04 | Phase 4 |

Notes:

- PREF-01 (job preferences) lands in Phase 3, not Phase 2, because preferences exist to drive the cheap filters built there.
- RESU-01 (base resume upload) lands in Phase 3, not Phase 4, because AI scoring runs against the user's uploaded resume (research: Phase 3 rationale).

---
*Roadmap created: 2026-07-15*
*Granularity: coarse (research's 6 suggested phases compressed to 4 along the dependency chain: auth/RLS → ingestion+dedupe → filtering/scoring+notifications → tailoring+tracker)*

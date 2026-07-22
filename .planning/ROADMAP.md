# Roadmap: Job Application Copilot

## Overview

Four vertical phases plus an inserted source-coverage phase, each ending with something two real users can exercise end-to-end. Phase 1 stands up the deployed app with invite-only auth and airtight per-user data isolation. Phase 2 builds the core ingestion engine. Phase 02.1 broadens that engine from three public ATS APIs to representative public portals and major branded finance career sites before scoring depends on it. Phase 3 closes the relevance loop with filtering, AI scoring, and a focused feed. Phase 4 turns matches into applications with truthful resume tailoring and a manual tracker.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation & Access** - Deployed app with invite-only auth for two users and RLS-enforced data isolation (completed 2026-07-16)
- [x] **Phase 2: Watchlist Ingestion & Monitoring** - New postings from 100+ watched sites land deduplicated within 5–15 minutes, with visible pipeline health (completed 2026-07-17)
- [ ] **Phase 02.1: Source Coverage Expansion (INSERTED)** - Prove representative ATS/portal connectors and direct ingestion from major branded finance career sites with safe degraded-source behavior (13/13 plans executed; user-deferred UAT gap)
- [x] **Phase 3: Scoring & Feed** - Preferences + cheap filters + AI scoring produce a focused match feed (completed 2026-07-20)
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

**Goal**: As a job seeker, I want to receive watched-site postings exactly once within 5-15 minutes and aggregator discovery every 30 minutes from 6 AM-noon Chicago and every two hours otherwise, so that I can trust my job feed without manually checking each career site.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: PREF-02, PREF-03, PREF-04, DISC-01, DISC-02, DISC-03, DISC-04, DISC-05, DISC-06
**Success Criteria** (what must be TRUE):

  1. User can add, edit, and remove companies on a watchlist page by pasting career-site URLs; the system auto-detects Greenhouse/Lever/Ashby and stores the polling endpoint
  2. A job newly posted by a watched company appears in the system within 15 minutes of publication, and appears exactly once even when the aggregator also carries it or the company reposts it
  3. Every captured job has a JD snapshot taken at first sight, and jobs that disappear from ATS polls are marked closed
  4. User can view per-company monitoring health (last successful poll, consecutive failures flagged), and a dead or silently failing cron is surfaced within one poll cycle via the pipeline heartbeat

**Plans**: 7/7 plans complete
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
- [x] 02-06-PLAN.md — Discovery health + cadence: all-failed sweeps surface 503 + persisted status; accepted Chicago-local quota-safe schedule

**Gap Closure Wave 2** *(blocked on Gap Closure Wave 1)*

- [x] 02-07-PLAN.md — Deploy + hosted proof: [BLOCKING] db push 0008/0009, redeploy functions, run probes 1-16 and the rerunnable watchlist verifier

### Phase 02.1: Source Coverage Expansion (INSERTED)

**Goal:** As a job seeker, I want to monitor representative major-employer career platforms with honest active, experimental, degraded, and unsupported states, so that I can broaden my job coverage without trusting brittle or failing sources.
**Mode:** mvp
**Requirements**: PREF-05, DISC-07, DISC-08, DISC-09
**Depends on:** Phase 2
**Success Criteria** (what must be TRUE):

  1. The Watchlist table includes a clickable Link column that opens each company's stored job-search/careers URL in a new tab
  2. Existing Greenhouse/Lever/Ashby support remains intact, and one publicly testable company is connected and verified for each feasible additional platform: SmartRecruiters, Recruitee, Workday, Oracle Recruiting, iCIMS, SuccessFactors, and Eightfold
  3. Direct-source coverage is validated for Morgan Stanley, Goldman Sachs, JPMorgan Chase, Bank of America, Citi, BlackRock, Wells Fargo, UBS, Barclays, Capital One, Fidelity, and Charles Schwab: companies with a stable, safely pollable public contract are monitored through shared or allowlisted adapters, while every remaining company has a canonical careers link, provider evidence, and an explicit unsupported reason and is never labeled monitored
  4. A blocked, changed, failed, or implausibly empty source retains its last known jobs, reports Degraded with the last successful sync and useful error detail, and never closes jobs from that failed observation
  5. Every new connector passes manual verification and several successful syncs before scheduled polling is enabled; unsupported or unstable candidates remain clearly documented rather than being presented as reliable

**Plans:** 13/13 plans executed
**Status:** Gaps found — offline Watchlist removal can remain indefinitely pending; user accepted deferral without marking it passed.
**UI hint:** yes

Plans:

**Wave 1**

- [x] 02.1-01-PLAN.md — Existing-provider PollObservation and closure-safe degradation slice

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02.1-02-PLAN.md — Closed registry, server-owned connector state, and authoritative verified-add slice

**Wave 3** *(blocked on Wave 2; parallel UI/catalog and public-connector slices)*

- [x] 02.1-03-PLAN.md — Safe Link/state UI and evidence-backed twelve-company finance catalog
- [x] 02.1-04-PLAN.md — SmartRecruiters/Recruitee adapters, exact detection, registry dispatch, and strict source-schema parity

**Wave 4** *(blocked on public connector wiring)*

- [x] 02.1-05-PLAN.md — Server-time activation windows, replay rejection, and provider-specific promotion

**Wave 5** *(blocked on activation policy)*

- [x] 02.1-06-PLAN.md — Allowlisted Capital One Workday connector retained as Experimental

**Wave 6** *(blocked on catalog, activation, and Workday implementation)*

- [x] 02.1-07-PLAN.md — [BLOCKING] ordered schema push, function deploy, and resumable hosted proof across real server windows

**Wave 7** *(blocked on hosted backend proof)*

- [x] 02.1-08-PLAN.md — [APPROVAL] origin/main push, SHA-matched Cloudflare deployment proof, and deployed UI acceptance

**Gap Closure Wave 1** *(from 02.1-VERIFICATION.md gaps_found)*

- [x] 02.1-09-PLAN.md — Safe disposable hosted verifier with real poll-tick reopen proof and zero production-row residue
- [x] 02.1-10-PLAN.md — Truthful Experimental health plus accessible in-modal removal failures
- [x] 02.1-11-PLAN.md — Invocation-wide SmartRecruiters detail and time budgets with stable partial warnings

**Gap Closure Wave 2** *(blocked on Gap Closure Wave 1)*

- [x] 02.1-12-PLAN.md — [APPROVAL] exact-SHA deployment and exhaustive mutation-evidence hosted proof

**Gap Closure Wave 3** *(blocked on Gap Closure Wave 2)*

- [x] 02.1-13-PLAN.md — Final human D5 UAT concluded: Checks 1-4 passed; offline removal timeout failed; Checks 6-8 deferred by user

### Phase 3: Scoring & Feed

**Goal:** As a new grad seeking an entry-level job, I want to review relevant jobs scored against my preferences and resume in a web dashboard, so that I can quickly focus on the strongest opportunities that best fit me.
**Mode:** mvp
**Depends on**: Phase 02.1
**Requirements**: PREF-01, RESU-01, SCOR-01, SCOR-02, SCOR-03, SCOR-04, SCOR-05
**Success Criteria** (what must be TRUE):

  1. User can set target titles, locations, and include/exclude keywords, and obviously irrelevant postings are discarded by cheap filters before any AI call is made
  2. User can upload and manage multiple DOCX base resumes in private encrypted storage, and surviving postings receive AI scores with plain-language match reasons grounded in that resume and the user's preferences
  3. User can view a dashboard feed of new matches showing score, match reasons, posted-time, and a direct link to the employer's apply page, plus a job detail view with the full JD snapshot and an advisory keyword-gap panel

**Plans**: 11/11 plans executed; verification gaps remain

- [x] 03-01-PLAN.md
- [x] 03-02-PLAN.md
- [x] 03-03-PLAN.md
- [x] 03-04-PLAN.md
- [x] 03-05-PLAN.md — notification backend (superseded and removed by Plan 07)
- [x] 03-06-PLAN.md — notification UI (superseded and removed by Plan 07)
- [x] 03-07-PLAN.md — feed-only implementation and hosted cleanup complete; UAT title-filter gap transferred to Plans 08-11

**Gap Closure Wave 1** *(blocked on Plan 07 completion)*

- [x] 03-08-PLAN.md — provider-agnostic title relevance, score freshness/CAS, truthful company persistence, and verifier latch

**Gap Closure Wave 2** *(blocked on Gap Closure Wave 1)*

- [x] 03-09-PLAN.md — current-preference focused feed, truthful company display, and save-time cache invalidation

**Gap Closure Wave 3** *(blocked on Gap Closure Wave 2)*

- [x] 03-10-PLAN.md — fail-closed verifier, rollout-only approval, deployment, and release evidence

**Gap Closure Wave 4** *(blocked on Gap Closure Wave 3)*

- [x] 03-11-PLAN.md — separately approved one-shot paid proof and sequential human UAT

**Cross-cutting constraints:**

- All Adzuna, Greenhouse, and Ashby jobs use the same preference/title filter; no source-specific relevance bypass.
- Company names must come from normalized provider/company data and are never fabricated.
- Notifications remain absent from runtime, schema, secrets, client, and UI.
- Production verification is one-shot, two-fixture scoped, exact-release bound, and separately approved from rollout.

**UI hint**: yes

### Phase 03.1: SuccessFactors & Paylocity Connector Expansion (INSERTED)

**Goal:** Add Paylocity Recruiting through its documented public feed and establish a bounded, allowlisted SAP SuccessFactors employer contract that either proves safe recurring ingestion or records an honest unsupported disposition, with staged activation, deduplication, non-destructive failures, scheduled polling, scoring, and dashboard delivery
**Requirements**: DISC-07, DISC-08, DISC-09
**Depends on:** Phase 3
**Context:** `.planning/phases/03.1-workday-ats-connector-expansion/03.1-CONTEXT.md`
**Research:** `.planning/phases/03.1-workday-ats-connector-expansion/03.1-RESEARCH.md`
**Plans:** 5/5 plans complete

Plans:
**Wave 1**

- [x] 03.1-01-PLAN.md — Exact Paylocity identity and bounded adapter; SuccessFactors unsupported evidence

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 03.1-02-PLAN.md — Closed registry, staged verification, lifecycle, and dispatch integration

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 03.1-03-PLAN.md — Migration 0029, Capital One regression, and resumable hosted verifier

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 03.1-04-PLAN.md — [BLOCKING] Owner approval for production schema, Edge, activation, and paid proof

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 03.1-05-PLAN.md — Approved deployment, three-window activation, polling, and dashboard evidence

**Success Criteria** (what must be TRUE):

- Paylocity employers verify, ingest, and re-poll without duplicates through the documented public Job Feed V2 contract
- Each SuccessFactors employer is admitted only through an exact server-owned identity and a bounded live proof; unproven variants remain `unsupported_with_reason`
- Failed, partial, malformed, drifted, or implausibly empty observations retain prior jobs and cannot advance success health or authorize closure
- Each admitted provider reaches scheduled polling only after its own repeated, warning-free, closure-credible evidence and remains independently fail-closed
- Jobs from admitted executable providers flow through the existing persistence, scoring, and feed contracts and appear on the dashboard without provider-specific frontend exceptions

**Scope notes:**

- New multi-tenant Workday expansion is **deferred**. Phase 03.1 must not widen Workday detection, identity, scheduling, or migrations.
- The already-shipped Capital One Workday connector remains unchanged and continues to poll under its exact fixed identity.
- The existing phase directory name is retained as a stable historical path; its active scope is defined by this roadmap section and the rewritten context.

### Phase 03.2: Dashboard Precision & Company Visibility (INSERTED)

**Goal:** Users can tune the current dashboard feed by company, score tier, and explicit required-experience cap while retaining truthful future ingestion and gaining a full-width, accessible, resizable results table.
**Requirements**: PREF-01, SCOR-01, SCOR-03, SCOR-04
**Depends on:** Phase 03.1
**Plans:** 4/4 plans complete

Plans:
**Wave 1**

- [x] 03.2-01-PLAN.md — Add persisted required-experience preference and provider-neutral filter contract

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 03.2-02-PLAN.md — Add session-only Dashboard company/tier precision controls and full-width table

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 03.2-03-PLAN.md — Add accessible persistent column resizing and final UAT/release checkpoint

**Gap Closure Wave 4** *(blocked on Wave 3 completion)*

- [x] 03.2-04-PLAN.md — Remove the redundant All jobs mode, preserve tier-owned complete preference-pass visibility, and run exact-release UAT

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
Phases execute in numeric order: 1 → 2 → 02.1 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Access | 3/3 | Complete    | 2026-07-16 |
| 2. Watchlist Ingestion & Monitoring | 7/7 | Complete    | 2026-07-17 |
| 02.1 Source Coverage Expansion | 13/13 | Gaps found (deferred) |  |
| 3. Scoring & Feed | 11/11 | Complete    | 2026-07-20 |
| 4. Resume Tailoring & Tracker | 0/TBD | Not started | - |

## Coverage

All 32 v1 requirements mapped to exactly one phase:

| Category | Requirements | Phase |
|----------|--------------|-------|
| Foundation | AUTH-01..04 | Phase 1 |
| Preferences & Watchlist | PREF-02, PREF-03, PREF-04 | Phase 2 |
| Preferences & Watchlist | PREF-05 | Phase 02.1 |
| Preferences & Watchlist | PREF-01 | Phase 3 |
| Discovery & Monitoring | DISC-01..06 | Phase 2 |
| Discovery & Monitoring | DISC-07..09 | Phase 02.1 |
| Scoring & Feed | SCOR-01..05 | Phase 3 |
| Resume Tailoring | RESU-01 | Phase 3 |
| Resume Tailoring | RESU-02..05 | Phase 4 |
| Tracker | TRAK-01..04 | Phase 4 |

Notes:

- PREF-01 (job preferences) lands in Phase 3, not Phase 2, because preferences exist to drive the cheap filters built there.
- RESU-01 (base resume upload) lands in Phase 3, not Phase 4, because AI scoring runs against the user's uploaded resume (research: Phase 3 rationale).

---
*Roadmap created: 2026-07-15*
*Granularity: coarse (research's 6 suggested phases compressed to 4 along the dependency chain: auth/RLS → ingestion+dedupe → filtering/scoring/feed → tailoring+tracker)*

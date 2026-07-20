# Job Application Copilot

## What This Is

An invite-only web app (browser-based, no install) for two users that discovers relevant job postings within 5–15 minutes of publication, speeds up applications with AI-tailored resumes, and assists with approved outreach. Users open a URL, log in, and get a dashboard of scored job matches, a resume tailoring workflow, and a manual application tracker.

## Core Value

Discover relevant jobs fast, score them accurately, and surface them in a focused feed — if discovery and scoring are unreliable, nothing else matters.

## Requirements

### Validated

- ✓ Invite-only auth for exactly two users with fully separated data — Phase 1 (deployed at pages.dev; RLS proven by two-account cross-access probes; UAT 6/6)
- ✓ Base resume management: upload multiple DOCX resumes per user — shipped early in Phase 1 as the walking-skeleton vertical slice (upload/list/download/delete, per-user storage isolation)
- ✓ Shared watchlist management for Greenhouse, Lever, and Ashby career URLs, including add/remove/re-add flows and visible source-health badges — Phase 2 (production UAT 2/2)
- ✓ Scheduled direct-ATS ingestion plus quota-capped Adzuna discovery, exact-once deduplication, immutable first-sight snapshots, safe close/reopen behavior, and public heartbeat health — Phase 2 (15/15 verification truths passed)

### Active

- [ ] Per-user job preferences (titles, locations, keywords)
- [ ] Source coverage expansion: representative public ATS/portal adapters and major finance-company career sites, while preserving safe degraded-source behavior
- [ ] Deduplication and scoring pipeline: cheap filters (title/location/keywords) first, then AI scoring against user preferences and resume — AI called only on survivors
- [ ] Resume tailoring: pick base resume, review AI keyword edits side by side, approve, download PDF — truthful edits only, user review mandatory
- [ ] Manual application tracker with stages: saved, resume prepared, applied, outreach sent, interview, rejected, offer
- [ ] Dashboard showing new matches with scores and match reasons

### Out of Scope

- LinkedIn scraping of logged-in pages, Easy Apply automation, auto-sent LinkedIn messages — LinkedIn automated-activity policy violation
- Form autofill on employer application pages — deferred to later version (possible companion browser extension)
- Outreach drafting (contact discovery, email + LinkedIn drafts) — deferred to v2; contact approach when built: heuristic email patterns (first.last@company) with manual user verification, no paid API
- Browser push, email alerts, alert tuning, and notification history — removed by owner; feed-only workflow
- Native desktop/mobile app — web app covers the need for two users
- Paid contact-discovery APIs (Hunter/Apollo) — cost constraint; heuristic approach chosen
- Multi-tenant/general signup — invite-only, two users, by design

## Context

- Greenfield project; empty repo at /Users/jackshi/Desktop/Linkedin
- LinkedIn has no open job-search API; official alerts are daily/weekly — usable only as a supplemental source
- Career-site monitoring is heterogeneous: some platforms expose public JSON endpoints, while Workday/Oracle/iCIMS/SuccessFactors/Eightfold and branded sites require structured portal or allowlisted company-specific adapters with stricter failure handling
- Two users only — no scaling pressure, free tiers must suffice
- Users manually submit applications on employer sites; the copilot prepares materials, never submits
- Product shape: login → dashboard (match feed) → preferences/watchlist → resumes (DOCX upload) → job detail with "tailor resume" → tracker table

## Constraints

- **Budget**: Near-zero cost for v1 — Cloudflare Pages and Supabase Free; AI calls budget-capped, cheap model, invoked only after cheap filtering
- **Tech stack**: Cloudflare Pages frontend, Supabase Free backend (auth, Postgres, resume storage, scheduled functions) — chosen for free-tier fit
- **Compliance**: No scraping logged-in LinkedIn pages, no Easy Apply automation, no auto-sent LinkedIn messages — platform policy
- **Security**: Resumes in encrypted private cloud storage with user-controlled deletion; strict per-user data separation
- **Integrity**: Resume tailoring must remain truthful and always require user review before download
- **Performance**: Job discovery-to-feed target 5–15 minutes

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Web app (not native app or extension) | No install, works anywhere, background monitoring runs server-side; extension deferred to autofill later | ✓ Good — Phase 1: deployed on Cloudflare Pages, both users live |
| RLS is the sole authorization boundary; route guards are UX only | Client checks are bypassable; Postgres/storage policies are not | ✓ Good — Phase 1: two-account cross-access probes all denied |
| Storage-first deletion with exact removed-count assertion before row deletes | A failed file delete must leave a visible row to retry, never an orphan file | ✓ Good — Phase 1: verify-deletion.ts proves 0 rows AND 0 objects |
| Password recovery via manual six-digit OTP + Gmail custom SMTP (supersedes org-member default-sender plan) | Email-security prefetch consumed clickable one-time reset links; Supabase default sender proved insufficient | ✓ Good — Phase 1 UAT: OTP round trip passed in production |
| Hybrid monitoring (ATS endpoints + aggregator) | ATS JSON is reliable/free for watchlist; aggregator covers discovery beyond watchlist | ✓ Good — Phase 2: Greenhouse/Lever/Ashby ingestion and quota-capped Adzuna discovery passed verification; broader coverage continues in Phase 02.1 |
| Major-employers-first source expansion | Representative adapters prove coverage without pretending that arbitrary-site scraping is universally reliable; custom finance sources are allowlisted and monitored | — Pending (Phase 02.1) |
| Phase 2 security register accepted without implementation audit | The owner chose bulk acceptance during the verification gate; this records acceptance, not evidence that mitigations were tested | ⚠ Accepted risk — a later security audit may reopen threats |
| DOCX as base resume format | Preserves user's own formatting; app edits text and converts to PDF | — Pending |
| Cheap filters before AI scoring | Keeps AI cost near zero; AI only scores plausible candidates | — Pending |
| Feed-only match delivery | Owner does not want notifications; scored matches remain in the dashboard | ✓ Chosen — notifications removed 2026-07-19 |
| Heuristic contact discovery (when outreach builds in v2) | Paid APIs conflict with near-zero cost constraint | — Pending |
| v1 scope = discovery + scoring/feed + resume tailoring | Highest-value loop; outreach and tracking polish can follow | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-19 after notification removal*

# Job Application Copilot

## What This Is

An invite-only web app (browser-based, no install) for two users that discovers relevant job postings within 5–15 minutes of publication, ranks them transparently, and keeps applications organized. Users open a URL, log in, and get a dashboard of ranked job matches, a private resume library, and a manual application tracker.

## Core Value

Discover relevant jobs fast, score them accurately, and surface them in a focused feed — if discovery and scoring are unreliable, nothing else matters.

## Requirements

### Validated

- ✓ Invite-only auth for exactly two users with fully separated data — Phase 1 (deployed at pages.dev; RLS proven by two-account cross-access probes; UAT 6/6)
- ✓ Base resume management: upload multiple DOCX resumes per user — shipped early in Phase 1 as the walking-skeleton vertical slice (upload/list/download/delete, per-user storage isolation)
- ✓ Shared watchlist management for Greenhouse, Lever, and Ashby career URLs, including add/remove/re-add flows and visible source-health badges — Phase 2 (production UAT 2/2)
- ✓ Scheduled direct-ATS ingestion plus quota-capped Adzuna discovery, exact-once deduplication, immutable first-sight snapshots, safe close/reopen behavior, and public heartbeat health — Phase 2 (15/15 verification truths passed)
- ✓ Per-user job preferences for target titles, locations, and include/exclude keywords — Phase 3 (8/8 UAT; own-row RLS)
- ✓ Transparent deterministic ranking after owner-controlled title, location, and keyword filters, with stored score evidence and no automatic/background paid AI scoring — Phase 03.4 (13/13 verification truths; 6/6 production UAT; paid score ledger unchanged)
- ✓ Unified dashboard and job detail: one current preference-pass scope stays inspectable, explicit Strong/Good/Weak selection owns score boundaries, and job descriptions/apply links render safely — Phase 3 and Phase 03.2
- ✓ Bounded generic Workday connector with exact, fail-closed employer identities and scheduled Fidelity ingestion through the existing Watchlist paste-URL flow — Phase 03.5 (6/6 verification truths; Capital One unchanged)
- ✓ Exact U.S.-only Workday ingestion for Nasdaq, S&P Global, Morningstar, and State Street plus Active/Applied/Dismissed dashboard queues with stable retrieval beyond 200 jobs — Phase 03.6 (6/6 verification truths; 20/20 hosted checks; 12/12 exact-release UAT)
- ✓ Exact Goldman Sachs Higher monitoring for complete U.S. Early Career and Professional roles in the owner-approved rolling 30-day scope, with Active 3/3 natural polling, closure disabled, and direct Oracle Apply links — Phase 03.10 (5/5 verification truths; 27 persisted jobs; exact-release owner UAT)
- ✓ Manual application tracking across Ready to Apply, Applied, Outreach Sent, Interview, Offer, and Rejected, with external positions, notes, preserved JD context, optional resume links, Dashboard integration, and owner-scoped deletion — Phase 4 (4/4 requirements; 5/5 exact-release owner UAT)

### Active

- [ ] Source coverage expansion: representative public ATS/portal adapters and major finance-company career sites, while preserving safe degraded-source behavior

### Out of Scope

- LinkedIn scraping of logged-in pages, Easy Apply automation, auto-sent LinkedIn messages — LinkedIn automated-activity policy violation
- Form autofill on employer application pages — deferred to later version (possible companion browser extension)
- Outreach drafting (contact discovery, email + LinkedIn drafts) — deferred to v2; contact approach when built: heuristic email patterns (first.last@company) with manual user verification, no paid API
- Browser push, email alerts, alert tuning, and notification history — removed by owner; feed-only workflow
- Native desktop/mobile app — web app covers the need for two users
- Paid contact-discovery APIs (Hunter/Apollo) — cost constraint; heuristic approach chosen
- Multi-tenant/general signup — invite-only, two users, by design
- Automated resume tailoring, DOCX editing, and PDF generation — removed by owner; resumes are prepared manually outside the app

## Context

- Greenfield project; empty repo at /Users/jackshi/Desktop/Linkedin
- LinkedIn has no open job-search API; official alerts are daily/weekly — usable only as a supplemental source
- Career-site monitoring is heterogeneous: some platforms expose public JSON endpoints, while Workday/Oracle/iCIMS/SuccessFactors/Eightfold and branded sites require structured portal or allowlisted company-specific adapters with stricter failure handling
- Two users only — no scaling pressure, free tiers must suffice
- Users prepare application materials and submit on employer sites manually; the copilot discovers, ranks, and tracks opportunities but never submits
- Product shape: login → dashboard (match feed) → preferences/watchlist → resumes (private upload/library) → job detail → tracker table

## Constraints

- **Budget**: Cost-conscious v1 — Cloudflare Pages and Supabase Pro on Micro compute; AI calls budget-capped, cheap model, invoked only after cheap filtering
- **Tech stack**: Cloudflare Pages frontend, Supabase Pro backend on Micro compute (auth, Postgres, resume storage, scheduled functions)
- **Compliance**: No scraping logged-in LinkedIn pages, no Easy Apply automation, no auto-sent LinkedIn messages — platform policy
- **Security**: Resumes in encrypted private cloud storage with user-controlled deletion; strict per-user data separation
- **Performance**: Job discovery-to-feed target 5–15 minutes

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Web app (not native app or extension) | No install, works anywhere, background monitoring runs server-side; extension deferred to autofill later | ✓ Good — Phase 1: deployed on Cloudflare Pages, both users live |
| RLS is the sole authorization boundary; route guards are UX only | Client checks are bypassable; Postgres/storage policies are not | ✓ Good — Phase 1: two-account cross-access probes all denied |
| Storage-first deletion with exact removed-count assertion before row deletes | A failed file delete must leave a visible row to retry, never an orphan file | ✓ Good — Phase 1: verify-deletion.ts proves 0 rows AND 0 objects |
| Password recovery via manual six-digit OTP + Gmail custom SMTP (supersedes org-member default-sender plan) | Email-security prefetch consumed clickable one-time reset links; Supabase default sender proved insufficient | ✓ Good — Phase 1 UAT: OTP round trip passed in production |
| Hybrid monitoring (ATS endpoints + aggregator) | ATS JSON is reliable/free for watchlist; aggregator covers discovery beyond watchlist | ✓ Good — Phase 2: Greenhouse/Lever/Ashby ingestion and quota-capped Adzuna discovery passed verification; broader coverage continues in Phase 02.1 |
| Major-employers-first source expansion | Representative adapters prove coverage without pretending that arbitrary-site scraping is universally reliable; custom finance sources are allowlisted and monitored | ✓ Ongoing — Workday finance sources, JPMorgan Oracle, and Goldman Higher are monitored through exact employer-specific contracts |
| Phase 2 security register accepted without implementation audit | The owner chose bulk acceptance during the verification gate; this records acceptance, not evidence that mitigations were tested | ⚠ Accepted risk — a later security audit may reopen threats |
| Private resume library retained without automated tailoring | Users keep their resume files in the app but prepare job-specific versions manually outside it | ✓ Phase 3 private upload/extraction remains; automated editing and PDF conversion were removed from Phase 4 |
| Deterministic ranking replaces automatic AI scoring | Ranking must be transparent, reproducible, retryable, and free of background paid-score work while preserving the feed workflow | ✓ Good — Phase 03.4 passed 13/13 verification truths, 966/966 tests, and exact-release production UAT |
| Feed-only match delivery | Owner does not want notifications; scored matches remain in the dashboard | ✓ Chosen — notifications removed 2026-07-19 |
| Dashboard feed scope and score tiers | Every confirmed preference pass should remain inspectable without a redundant mode; explicit tiers should own score boundaries | ✓ Phase 03.2 — one current preference-pass scope with Strong, Good, and Weak selected by default |
| Exact-release acceptance for Workday expansion and dashboard queues | UAT approval is valid only for the immutable manifest, source commit, deployment, and asset bytes that passed hosted verification | ✓ Phase 03.6 — exact release `70cc6e527ffe57d3bfc18f706625dfc7e121c59cb636dea06df9ba6557b96f2b` passed 20/20 hosted checks and 12/12 owner-approved UAT interactions |
| Exact-release acceptance for Goldman Higher | Monitoring authority requires exact identity, complete two-population evidence, three server windows, a later natural poll, independent hosted proof, and owner-only browser acceptance | ✓ Phase 03.10 — Goldman Active 3/3 with 27 persisted jobs, zero false closures, zero verifier residue, and exact-release owner UAT |
| Disposable-account production verification | Proof must not overwrite real-user preferences/resume/reroute state | ✓ Phase 3 — verifier account exists only inside the paused/drained interval and is deleted before cron restoration |
| Physical scoring-attempt accounting | The daily ceiling applies to actual paid attempts, not logical jobs | ✓ Phase 3 — atomic reservation plus `maxAttempts: 1` for scoring |
| One database-derived application lifecycle | Tracker membership, current stage/date, and owner-scoped deletion must not compete with Dashboard lifecycle state or restore deleted history to Active | ✓ Phase 4 — exact production release passed 5/5 owner UAT; deletion preserves `user_jobs.applied_at` |
| Heuristic contact discovery (when outreach builds in v2) | Paid APIs conflict with near-zero cost constraint | — Pending |
| v1 scope = discovery + deterministic ranking/feed + application tracker | Keep the app focused on finding, prioritizing, and organizing applications; resume tailoring remains manual | ✓ Complete — Phase 4 closed the application lifecycle |

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
*Last updated: 2026-07-28 after Phase 4 and the v1.0 milestone completed*

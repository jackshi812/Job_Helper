# Job Application Copilot

## What This Is

An invite-only web app (browser-based, no install) for two users that discovers relevant job postings within 5–15 minutes of publication, speeds up applications with AI-tailored resumes, and assists with approved outreach. Users open a URL, log in, and get a dashboard of scored job matches, a resume tailoring workflow, and a manual application tracker.

## Core Value

Discover relevant jobs fast (5–15 minutes from posting) and notify the user immediately — if job discovery and notification don't work reliably, nothing else matters.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Invite-only auth for exactly two users with fully separated data (preferences, resumes, watchlists, applications, drafts)
- [ ] Per-user job preferences (titles, locations, keywords) and watchlist of 100+ company career sites
- [ ] Hybrid monitoring: public ATS endpoints (Greenhouse/Lever/Ashby JSON) for watchlist companies + one aggregator API for discovery outside watchlist
- [ ] Deduplication and scoring pipeline: cheap filters (title/location/keywords) first, then AI scoring against user preferences and resume — AI called only on survivors
- [ ] Near-instant notifications targeting the 5–15 minute goal: browser web push (desktop, works with tab closed) + email backup
- [ ] Base resume management: upload multiple DOCX resumes per user
- [ ] Resume tailoring: pick base resume, review AI keyword edits side by side, approve, download PDF — truthful edits only, user review mandatory
- [ ] Manual application tracker with stages: saved, resume prepared, applied, outreach sent, interview, rejected, offer
- [ ] Dashboard showing new matches with scores and match reasons

### Out of Scope

- LinkedIn scraping of logged-in pages, Easy Apply automation, auto-sent LinkedIn messages — LinkedIn automated-activity policy violation
- Form autofill on employer application pages — deferred to later version (possible companion browser extension)
- Outreach drafting (contact discovery, email + LinkedIn drafts) — deferred to v2; contact approach when built: heuristic email patterns (first.last@company) with manual user verification, no paid API
- Mobile push notifications — email + desktop push sufficient for v1
- Native desktop/mobile app — web app covers the need for two users
- Paid contact-discovery APIs (Hunter/Apollo) — cost constraint; heuristic approach chosen
- Multi-tenant/general signup — invite-only, two users, by design

## Context

- Greenfield project; empty repo at /Users/jackshi/Desktop/Linkedin
- LinkedIn has no open job-search API; official alerts are daily/weekly — usable only as a supplemental source
- Career-site monitoring is heterogeneous: Greenhouse/Lever/Ashby expose public JSON endpoints, other sites need HTML scraping fallback
- Two users only — no scaling pressure, free tiers must suffice
- Users manually submit applications on employer sites; the copilot prepares materials, never submits
- Product shape: login → dashboard (match feed) → preferences/watchlist → resumes (DOCX upload) → job detail with "tailor resume" → tracker table

## Constraints

- **Budget**: Near-zero cost for v1 — free tiers everywhere (Cloudflare Pages, Supabase Free, free-tier email like Resend, free web push); AI calls budget-capped, cheap model, invoked only after cheap filtering
- **Tech stack**: Cloudflare Pages frontend, Supabase Free backend (auth, Postgres, resume storage, scheduled functions) — chosen for free-tier fit
- **Compliance**: No scraping logged-in LinkedIn pages, no Easy Apply automation, no auto-sent LinkedIn messages — platform policy
- **Security**: Resumes in encrypted private cloud storage with user-controlled deletion; strict per-user data separation
- **Integrity**: Resume tailoring must remain truthful and always require user review before download
- **Performance**: Job discovery-to-notification target 5–15 minutes

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Web app (not native app or extension) | No install, works anywhere, background monitoring runs server-side; extension deferred to autofill later | — Pending |
| Hybrid monitoring (ATS endpoints + aggregator) | ATS JSON is reliable/free for watchlist; aggregator covers discovery beyond watchlist | — Pending |
| DOCX as base resume format | Preserves user's own formatting; app edits text and converts to PDF | — Pending |
| Cheap filters before AI scoring | Keeps AI cost near zero; AI only scores plausible candidates | — Pending |
| Web push + email notifications | Push hits 5–15 min goal when laptop active; email catches offline gaps | — Pending |
| Heuristic contact discovery (when outreach builds in v2) | Paid APIs conflict with near-zero cost constraint | — Pending |
| v1 scope = discovery + alerts + resume tailoring | Highest-value loop; outreach and tracking polish can follow | — Pending |

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
*Last updated: 2026-07-15 after initialization*

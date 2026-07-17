# Phase 2: Watchlist Ingestion & Monitoring - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-16
**Phase:** 02-watchlist-ingestion-monitoring
**Areas discussed:** Watchlist ownership, Unsupported-URL handling, Health visibility, Aggregator scope pre-preferences

---

## Watchlist Ownership

| Option | Description | Selected |
|--------|-------------|----------|
| Shared pool | One global watchlist; either user adds; polled once; both get matches | ✓ |
| Per-user watchlists | Separate lists, duplicate polling for overlaps | |
| Per-user view, shared polling | Global companies table + per-user follow flags | |

**User's choice:** Shared pool (Recommended)

### Edit rights follow-up

| Option | Description | Selected |
|--------|-------------|----------|
| Anyone edits, no attribution | Free add/remove, no added_by column | ✓ |
| Anyone edits, track added_by | Free edits + audit column | |
| Only adder removes | RLS-enforced ownership on removal | |

**User's choice:** Anyone edits, no attribution (Recommended)

---

## Unsupported-URL Handling

| Option | Description | Selected |
|--------|-------------|----------|
| Reject with guidance | Clear "unsupported ATS" message; company not saved | ✓ |
| Save as 'unsupported', no polling | Keep dead entries visible in list | |
| Save + Adzuna fallback | Company-name search via aggregator for unsupported ATSs | |

**User's choice:** Reject with guidance (Recommended)

### Add flow follow-up

| Option | Description | Selected |
|--------|-------------|----------|
| Paste any URL, auto-detect | Detect ATS + slug from URL, verify with one live call | ✓ |
| URL or company name search | Also probe boards by normalized company name | |
| Manual ATS + slug entry | Dropdown + slug field, no detection code | |

**User's choice:** Paste any URL, auto-detect (Recommended)

---

## Health Visibility

| Option | Description | Selected |
|--------|-------------|----------|
| Badge on watchlist row | Status dot per company, failing = 3+ consecutive errors | ✓ |
| Separate health page | Dedicated monitoring dashboard | |
| Silent + alert only | No UI, notify on repeated failure only | |

**User's choice:** Badge on watchlist row (Recommended)

### Heartbeat follow-up

| Option | Description | Selected |
|--------|-------------|----------|
| Banner + email alert | Stale banner (>30 min) + external cron checks heartbeat endpoint, Resend email on silence | ✓ |
| Dashboard banner only | In-app only; learn on open | |
| External dead-man's switch only | cron-job.org/healthchecks.io, no in-app UI | |

**User's choice:** Banner + email alert (Recommended)

---

## Aggregator Scope Pre-Preferences

| Option | Description | Selected |
|--------|-------------|----------|
| Hardcoded seed queries | 2–3 fixed queries per user in config/DB seed, SQL-editable | ✓ |
| Minimal keyword field now | Tiny settings input, formal PREF-01 later | |
| Defer Adzuna to Phase 3 | Watchlist-only Phase 2 | |

**User's choice:** Hardcoded seed queries (Recommended)

---

## Claude's Discretion

- Polling shard layout across pg_cron ticks
- Dedup key design
- JD snapshot format and stale-close threshold specifics
- Watchlist table UI details (within D-15 style)
- Heartbeat endpoint shape and banner copy

## Deferred Ideas

- Adzuna company-name fallback for unsupported-ATS companies (rejected for Phase 2, revisit if coverage too narrow)
- Preferences UI for aggregator queries — Phase 3 (PREF-01)

---

*Phase: 02-watchlist-ingestion-monitoring*
*Discussion log generated: 2026-07-16*

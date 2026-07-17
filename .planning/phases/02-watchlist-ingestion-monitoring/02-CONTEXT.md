# Phase 2: Watchlist Ingestion & Monitoring - Context

**Gathered:** 2026-07-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Users maintain a company watchlist (add via careers URL, ATS auto-detected) and the system polls Greenhouse/Lever/Ashby boards plus an Adzuna discovery sweep on a 5–15 minute cadence, deduplicates postings, snapshots job descriptions, closes stale postings, and exposes per-source health plus a whole-pipeline heartbeat. Scoring, preferences UI, and notifications are Phase 3.

</domain>

<decisions>
## Implementation Decisions

### Watchlist ownership
- **D-01:** Single shared global watchlist. Either user adds a company; polling runs once per company; both users receive matches from every watched company.
- **D-02:** Either user can add or remove any company, including ones the other added. No `added_by` attribution column.

### Add flow & unsupported URLs
- **D-03:** Adding a company = paste any careers/job-board URL. The app auto-detects ATS + board slug from URL patterns, then verifies with one live API call to the detected board before saving.
- **D-04:** Unsupported ATS (anything other than Greenhouse/Lever/Ashby) or a failed verification call is rejected with a clear guidance message ("works with Greenhouse, Lever, Ashby" + how to find the supported board URL). The company is NOT saved — no "unsupported" placeholder rows, no per-company Adzuna fallback.

### Health visibility
- **D-05:** Per-company health is a status badge on each watchlist row: OK / failing / stale, with last-success time on hover. No separate health/monitoring page.
- **D-06:** A company counts as "failing" after 3+ consecutive fetch errors.
- **D-07:** Whole-pipeline heartbeat: dashboard banner when the last successful poll is > 30 minutes old, PLUS an external dead-man's switch (e.g. cron-job.org) that checks a heartbeat endpoint and triggers one Resend email when the pipeline goes silent. External check is mandatory because a paused Supabase project cannot alert about itself.

### Aggregator scope before preferences exist
- **D-08:** Adzuna discovery runs on hardcoded seed queries — 2–3 fixed queries per user (role keywords + location) stored as config/DB seed rows, editable via SQL. No throwaway preferences UI in Phase 2; the Phase 3 preferences UI replaces the seed as the query source.

### Claude's Discretion
- Polling shard layout across pg_cron ticks (per-minute round-robin slices per RESEARCH pattern)
- Dedup key design (URL vs source+external-id vs content hash)
- JD snapshot storage format and stale-close threshold specifics
- Watchlist table UI details (within Phase 1's D-15 clean minimal dense-table style)
- Heartbeat endpoint shape and banner copy

</decisions>

<specifics>
## Specific Ideas

- Health should live where companies live — one glance at the watchlist shows what's broken, no digging into a separate dashboard.
- Rejection on unsupported URLs must teach: tell the user which ATSs work and how to locate the supported board URL, not just "invalid".

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` §Phase 2 — goal, success criteria, requirement IDs (PREF-02/03/04, DISC-01..06)
- `.planning/REQUIREMENTS.md` — full requirement text for the IDs above

### Stack & source endpoints
- `.claude/CLAUDE.md` §Job Data Sources — Greenhouse/Lever/Ashby/Adzuna endpoints, auth, rate limits (ATS shapes are MEDIUM confidence — validate one live call per ATS before building adapters; carried in STATE.md Blockers)
- `.claude/CLAUDE.md` §Stack Patterns — sharded pg_cron polling pattern, dedupe-before-aggregator ordering

### Prior phase constraints
- `.planning/phases/01-foundation-access/01-CONTEXT.md` — D-14 (system theme), D-15 (clean minimal dense-table UI style), nav skeleton already includes a Watchlist stub route

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `web/src/lib/supabase.ts` — shared browser client (publishable key only); pattern for isolated clients if needed
- Phase 1 RLS migration style (`(select auth.uid())`-scoped per-operation policies) — note the shared watchlist table needs authenticated-read/write policies, not per-user isolation
- `web/src/components/ConfirmDialog.tsx` — reusable for company removal confirmation
- TanStack Query patterns from Resumes page for watchlist data fetching

### Established Patterns
- Verification scripts in `scripts/` run with `node --env-file=scripts/.env`; secret key never leaves `scripts/`
- pg_cron + pg_net + Vault is the locked scheduling pattern (CLAUDE.md, HIGH confidence)

### Integration Points
- Nav skeleton Watchlist stub route (Phase 1) is where the watchlist UI lands
- New tables (companies/watchlist, jobs, source_health, seed queries) join the existing migrations sequence (next: 0005)
- Edge functions are new surface area — first Deno functions in the repo

</code_context>

<deferred>
## Deferred Ideas

- Adzuna company-name fallback for unsupported-ATS companies — considered and rejected for Phase 2; revisit only if watchlist coverage proves too narrow
- Preferences UI for aggregator queries — explicitly Phase 3 (PREF-01)

</deferred>

---

*Phase: 02-watchlist-ingestion-monitoring*
*Context gathered: 2026-07-16*

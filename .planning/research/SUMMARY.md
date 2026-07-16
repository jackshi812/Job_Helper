# Project Research Summary

**Project:** Job Application Copilot
**Domain:** Job-discovery + alerting + AI resume-tailoring web app (invite-only, 2 users, near-zero cost)
**Researched:** 2026-07-15
**Confidence:** MEDIUM-HIGH

## Executive Summary

This is a job-search copilot that combines three jobs-to-be-done the market currently splits across separate tools: *find fast* (career-page monitoring like Scoutify/OpenJobRadar), *apply fast* (Jobscan-style tailoring), and *stay organized* (Teal/Huntr trackers). Experts build the discovery side as a staged pipeline — source pollers → normalizer → dedupe → cheap filter → AI scoring → notifier — with a database as the state spine between stages. The core value is the 5–15 minute discovery-to-notification latency, which is only achievable by polling Greenhouse/Lever/Ashby public JSON endpoints directly (aggregators lag by hours and serve breadth only). If the alert loop doesn't work reliably, nothing else matters.

The recommended approach is a React + Vite SPA on Cloudflare Pages with all backend logic in Supabase (free plan): Postgres as both source of truth and pipeline queue (status-column state machine), pg_cron + pg_net firing Deno edge functions on 1–5 minute ticks, Gemini 2.5 Flash-Lite for scoring and tailoring (paid tier, still <$1/month — free tier's data terms are unacceptable for resume content), `@negrel/webpush` for desktop push, and Resend for email backup. Resume tailoring is a deliberately independent subsystem: edit the user's own DOCX at the XML run level via jszip (preserving formatting — the rare differentiator no mainstream competitor offers), with mandatory per-bullet diff review, and DOCX→PDF via CloudConvert's free tier since LibreOffice cannot run in edge functions.

The key risks are all reliability-shaped, not scale-shaped: silent failures (dead company slugs, stalled crons, undelivered push), trust destruction (duplicate alerts, AI-fabricated resume content, notification fatigue), and free-tier behavioral limits (Supabase 7-day inactivity pause, 5 GB egress, 402 hard-stops). Every one has a known mitigation — per-company health tracking, heartbeat rows + dead-man's-switch, dedupe before the aggregator ships, term-diff guardrails on AI edits, tiered notifications, egress-lean schema — and each mitigation must be built *in the same phase* as the feature it protects, not deferred as polish.

## Key Findings

### Recommended Stack

A pure SPA + Supabase free-plan architecture fits comfortably: 2 users generate ~8.6K edge invocations/month against a 500K cap, and a `*/5 min` polling cadence beats the latency goal with headroom. The only genuinely hard free-tier problem is DOCX→PDF conversion (no headless LibreOffice in Deno); CloudConvert's free tier (~25 conversion-min/day) solves it, with browser print-to-PDF as the zero-dependency fallback.

**Core technologies:**
- **React 19 + Vite 7 SPA on Cloudflare Pages**: dashboard frontend — no SEO need, so SSR buys nothing; Next.js on CF Pages is second-class
- **Supabase Free (Postgres + Auth + Storage + Edge Functions + pg_cron/pg_net)**: entire backend — official cron→edge-function pattern at 1-min granularity meets the latency goal
- **Gemini 2.5 Flash-Lite (paid tier)**: job scoring + tailoring edits — $0.10/$0.40 per 1M tokens ≈ <$1/month at this volume; paid tier avoids free-tier data-use terms on resume PII
- **jszip + run-level `document.xml` edits**: DOCX tailoring that preserves user formatting — docxtemplater/mammoth round-trips are ruled out (require templates / destroy formatting)
- **`@negrel/webpush` (JSR) + Resend**: Deno-native web push + email backup (100/day free — batch into digests, never per-job emails)
- **Greenhouse/Lever/Ashby public JSON + Adzuna**: keyless ATS endpoints carry the freshness SLA; Adzuna (250 req/day free) is discovery breadth only

### Expected Features

**Must have (table stakes):**
- Match feed with job basics, posted-time, and direct link to the company's own apply page
- Cross-source deduplication — duplicate listings are the #1 aggregator complaint
- Per-user preferences (titles, locations, keywords) driving the feed + watchlist management for 100+ companies
- Email alerts; application pipeline stages (saved → applied → interview → …) in a table view; notes + JD snapshot per job
- Resume upload with versions; resume-vs-JD keyword gap visibility; mandatory human review before any AI edit lands
- Invite-only auth with RLS-enforced data separation

**Should have (competitive):**
- **5–15 min discovery-to-notification latency** — the make-or-break differentiator; incumbents batch daily/weekly
- Browser web push that works with the tab closed (service worker + VAPID), email as co-equal backup
- AI scoring of *every incoming job* against the user's own resume + preferences, with plain-language match reasons
- DOCX-preserving tailoring → PDF with truthful-edits-only guarantee (rephrase/reorder existing facts, never invent)
- Stale/closed-job detection — near-free byproduct of ATS polling

**Defer (v2+):**
- Outreach drafting + contact discovery; autofill browser extension; cover letter generation; kanban board; mobile app — avoid Teal-style feature sprawl until the core loop is validated
- Anti-features to actively refuse: auto-apply, LinkedIn logged-in scraping, gamified ATS scores, template resume builder

### Architecture Approach

Two independent subsystems sharing only auth + DB: a scheduled monitoring pipeline (pg_cron → `poll-jobs` → `score-matches` → `notify` as separate edge functions handing off via status columns in Postgres) and an on-demand tailoring flow (`tailor-resume`). Jobs are stored once globally with `UNIQUE(source, external_id)` dedupe; `INSERT … ON CONFLICT DO NOTHING RETURNING *` doubles as the new-job event source. Per-user state (scores, reasons, tracker stage) lives in `user_job_matches` under strict RLS. Every cron-invoked function ACKs 202 immediately and does real work in `EdgeRuntime.waitUntil` (pg_net's ~5s timeout kills anything slower), logging to a `pipeline_runs` heartbeat table.

**Major components:**
1. **`poll-jobs` (ingest)** — fetch watchlist ATS endpoints + aggregator via per-source adapters, normalize to canonical `JobPosting`, dedupe-insert, cheap-filter fan-out to per-user matches
2. **`score-matches` (AI)** — budget-capped LLM scoring of pending matches against resume + preferences; writes score + reasons
3. **`notify`** — push + email for matches above threshold; exactly-once via `notified_at`; prunes dead subscriptions on 404/410
4. **`tailor-resume`** — DOCX parse → structured edit proposals → review → apply approved edits → PDF; fully decoupled from monitoring
5. **Frontend SPA + service worker** — dashboard, prefs/watchlist, tailoring diff review, tracker; talks to Supabase directly under RLS

### Critical Pitfalls

1. **One dead company slug silently degrades coverage** — per-company try/catch with a `source_health` table from the very first fetcher; alert when a company fails N consecutive runs or drops to 0 postings
2. **Naive dedupe → duplicate/repost alerts destroy notification trust** — normalized (company, title, location) key with lookback window, ATS copy canonical; dedupe must land *before* the aggregator and notifications ship
3. **AI conflation edits lie plausibly** — constrain prompts to per-bullet keyword rewrites with structured output; programmatic term-diff flags any skill/tool not in the source resume; per-bullet word-level diff review (full-document side-by-side hides conflation)
4. **Web push is not reliable; cron is not a heartbeat** — email as co-equal channel always; heartbeat table + "last run N min ago" on dashboard + external dead-man's-switch (healthchecks.io); watermark-based idempotent runs so missed ticks self-heal
5. **Free-tier behavioral limits hit as hard cutoffs** — egress-lean schema (normalized fields only, hash-skip unchanged payloads), prune jobs >30 days, weekly pg_dump (no free-tier backups), track usage in the same heartbeat dashboard
6. **DOCX→PDF fidelity + platform trap** — conversion path decided up front (CloudConvert), golden-file test each user's real resume on the deployed target before tailoring depends on it; DOCX download as escape hatch

## Implications for Roadmap

Based on research, suggested phase structure (6 phases; ordering mirrors ARCHITECTURE.md's build order and PITFALLS.md's phase mapping):

### Phase 1: Foundation
**Rationale:** Everything depends on auth, schema, and RLS; retrofitting RLS later is painful, and the no-LinkedIn-credentials rule plus egress-lean schema are architectural decisions that must precede code.
**Delivers:** Supabase project, invite-only auth (2 users), full schema + RLS policies tested with both accounts, SPA shell with login on Cloudflare Pages, weekly pg_dump export.
**Addresses:** Auth + data separation (table stakes).
**Avoids:** Missing-RLS leaks, free-tier ceiling surprises, compliance drift (Pitfalls 6, 9; security mistakes table).

### Phase 2: Ingestion & Monitoring
**Rationale:** The monitoring pipeline is the core value and needs the longest soak time against 100+ real sites; build it first and let it run while later phases proceed. Dedupe must exist before the aggregator source is enabled.
**Delivers:** Watchlist CRUD, Greenhouse/Lever/Ashby adapters then Adzuna, `jobs` table with dedupe-insert, pg_cron + ACK-fast wiring, `source_health` + `pipeline_runs` heartbeat, manual "run now" trigger, dead-man's-switch monitor.
**Uses:** pg_cron + pg_net + Vault, edge functions with `EdgeRuntime.waitUntil`, keyless ATS endpoints.
**Implements:** `poll-jobs`, source adapters, dedupe layer.
**Avoids:** Dead-slug silent failure, naive dedupe, silent cron stalls (Pitfalls 1, 2, 5).

### Phase 3: Filtering & AI Scoring
**Rationale:** Depends on ingestion output; the dashboard becomes usable here. Cheap filters must precede AI calls (cost anti-pattern), and resume upload must land here (not in the tailoring phase) because scoring runs against the user's resume.
**Delivers:** Preferences UI, cheap-filter fan-out to `user_job_matches`, base resume upload (DOCX, private Storage), Gemini scorer with hard daily budget cap, dashboard match feed with scores + match reasons + JD snapshots.
**Uses:** Gemini 2.5 Flash-Lite (paid tier), TanStack Query dashboard.
**Implements:** cheap filter, `score-matches`, match feed.
**Avoids:** AI-scoring-everything budget blowout (Anti-Pattern 3).

### Phase 4: Notifications
**Rationale:** Needs scores to gate on; completes the core value loop (the 5–15 min promise). Subscription lifecycle, tiering, and the feedback signal must ship with the first push, not after.
**Delivers:** Service worker + push subscription flow, `notify` stage with @negrel/webpush + Resend digests, tiered thresholds (push+email for high scores, feed-only for the rest), test-notification button, 404/410 pruning, thumbs up/down feedback logging.
**Uses:** `@negrel/webpush` (JSR), Resend REST API, long-TTL pushes.
**Implements:** `notify` stage.
**Avoids:** Push-as-sole-channel unreliability, threshold fatigue (Pitfalls 4, 8).

### Phase 5: Resume Tailoring
**Rationale:** Fully independent of the monitoring pipeline (shares only auth + DB), so it slots after the core loop works; it is also the highest-uncertainty area and benefits from the pipeline soaking in parallel.
**Delivers:** jszip run-level DOCX editing, structured per-bullet edit proposals, term-diff "NEW TERM" guardrail, per-bullet word-level diff review UI, approved-edits → tailored DOCX → CloudConvert PDF with inline preview + page-count check, golden-file verification of each user's real resume.
**Uses:** jszip + fast-xml-parser (edit path), mammoth (preview only), CloudConvert free tier, Gemini paid tier.
**Avoids:** AI conflation/fabrication, mangled-PDF fidelity trap (Pitfalls 3, 7).

### Phase 6: Tracker & Polish
**Rationale:** Trivial CRUD over existing tables; manual-add must work standalone (users track jobs found outside the system), but nothing depends on it, so it goes last alongside v1.x refinements.
**Delivers:** Application tracker table with 7 stages (saved → resume prepared → applied → outreach sent → interview → rejected → offer), save-to-tracker from feed, stale/closed-job marking from poll data, alert-tuning controls, repost-alert suppression for tracked jobs.

### Phase Ordering Rationale

- **Dependency chain drives 1→2→3→4:** alerts require scores, scores require matches, matches require deduped ingestion, everything requires auth/RLS. Alerting on unscored raw feed = spam users permanently disable.
- **Ingestion first among the pipeline stages** because reliability against 100+ heterogeneous real-world sites is only proven by soak time — start the clock early.
- **Tailoring after the core loop (not before)** because it's architecturally independent, the discovery loop is the stated core value, and tailoring carries the most unresolved technical risk — decoupling lets it slip without endangering the alert promise.
- **Pitfall mitigations are in-phase requirements:** `source_health` ships with the first fetcher (Phase 2), dedupe before aggregator (Phase 2 internal ordering), email co-channel + tiering with first push (Phase 4), term-diff guardrail with first AI edit (Phase 5).

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 5 (Resume Tailoring):** highest-uncertainty area — DOCX XML run-splitting edge cases, tailoring prompt design for structured truthful edits, term-extraction guardrail approach, CloudConvert API flow + fidelity verification. Both ARCHITECTURE.md and PITFALLS.md independently flag this.
- **Phase 2 (Ingestion):** verify one live call per ATS (endpoint shapes are MEDIUM confidence from surveys, not official docs for all three); confirm Adzuna quota/coverage for the users' target market; confirm edge-function wall-clock behavior with 100+ concurrent fetches.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Foundation):** canonical Supabase auth + RLS + migrations; extensively documented.
- **Phase 3 (Scoring):** standard LLM structured-output call with budget counter; patterns well established.
- **Phase 4 (Notifications):** service worker + VAPID push and Resend are well-trodden; the pitfalls are known and mitigations specified.
- **Phase 6 (Tracker):** trivial CRUD over existing tables.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM-HIGH | Platform limits verified against official Supabase/Cloudflare/Gemini/Resend pages; @negrel/webpush latest version and Adzuna quota unverified (MEDIUM); pin exact npm versions at install |
| Features | MEDIUM | Competitor features cross-verified across vendor sites + independent reviews; user-sentiment claims from secondary roundups are LOW |
| Architecture | MEDIUM-HIGH | Edge-function limits and cron pattern from official docs; pipeline shape cross-checked across multiple independent sources |
| Pitfalls | MEDIUM | Platform-limit pitfalls anchored to official docs (HIGH); dedupe rates and AI-conflation behavior from industry/community sources (MEDIUM) |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **ATS endpoint shapes (Greenhouse/Lever/Ashby):** cross-checked from surveys, not all official docs — validate one live call per ATS at the start of Phase 2 before building adapters.
- **Edge function wall-clock limit (~150s free tier):** MEDIUM confidence — verify empirically during Phase 2; sharding strategy (poll groups) is the ready fallback.
- **@negrel/webpush latest version:** JSR page returned 403 during research — confirm at install time in Phase 4.
- **Adzuna coverage in the users' target market:** if weak, Jooble is the named alternative — evaluate with real queries in Phase 2.
- **CloudConvert privacy posture for resume files:** resumes are PII; review retention terms in Phase 5 planning; browser print-to-PDF is the fallback if unacceptable.
- **Supabase inactivity-pause behavior under continuous cron:** cron activity should count as activity — verify during the Phase 2 soak period; external health-check ping is the cheap guard.
- **Flash-Lite scoring quality:** unproven for this use — if it disappoints, the two-stage pattern (Flash-Lite triage → stronger model on survivors) is pre-planned and still ~free.

## Sources

### Primary (HIGH confidence)
- [Supabase — Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions) — pg_cron + pg_net + Vault pattern, 1-min granularity
- [Supabase Pricing](https://supabase.com/pricing) + [Edge Function Limits](https://supabase.com/docs/guides/functions/limits) — free-plan limits, 150s wall clock, 7-day pause
- [Cloudflare Pages Limits](https://developers.cloudflare.com/pages/platform/limits/) + [Workers Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) — build/request limits, no cron retries
- [Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing) — Flash-Lite pricing, free-tier data terms
- [Resend quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits) — 100/day, 3,000/month free

### Secondary (MEDIUM confidence)
- ATS endpoint surveys ([Cavuno](https://cavuno.com/blog/ats-platforms-public-job-posting-apis), [fantastic.jobs](https://fantastic.jobs/article/ats-with-api)) + [Greenhouse Job Board API docs](https://developers.greenhouse.io/job-board.html) — public JSON shapes for Greenhouse/Lever/Ashby
- Competitor analysis: Teal, Simplify, Huntr, Jobscan, HiringCafe official sites cross-checked with independent reviews — feature landscape
- Dedupe methodology: [Lightcast](https://kb.lightcast.io/en/articles/6957661-how-does-lightcast-handle-duplicate-postings), [Textkernel](https://www.textkernel.com/learn-support/blog/online-job-postings-have-many-duplicates-but-how-can-you-detect-them-if-they-are-not-exact-copies-of-each-other/) — normalized-key + lookback-window approach
- [Supabase pg_net timeout discussion #37574](https://github.com/orgs/supabase/discussions/37574) + [Background Tasks docs](https://supabase.com/docs/guides/functions/background-tasks) — ACK-fast pattern necessity
- [@negrel/webpush](https://github.com/negrel/webpush) — Deno-native web push; [Pushpad](https://pushpad.xyz/blog/why-some-web-push-notifications-are-not-delivered-to-the-browser) / [web.dev](https://web.dev/articles/push-notifications-web-push-protocol) — push delivery failure modes
- AI resume fabrication/conflation: [Hirecarta](https://hirecarta.com/blog/why-ai-resume-writers-lie), [SwiftScout](https://www.swiftscout.ai/blog/llm-resume-tailoring-guide), [ACL 2025 paper](https://aclanthology.org/2025.clicit-1.51.pdf)
- [CloudConvert pricing](https://cloudconvert.com/pricing) + LibreOffice headless fidelity reports — DOCX→PDF options
- [Adzuna developer portal](https://developer.adzuna.com/) — free-tier quota (~250 req/day)

### Tertiary (LOW confidence)
- User-sentiment roundups ([Optim Careers](https://optimcareers.com/expert-articles/job-application-tracker), [Prentus](https://prentus.com/blog/we-found-the-5-best-job-tracker-tools-on-the-market)) — competitor complaint claims; validate against own usage
- Monitoring-niche vendor claims (Scoutify/OpenJobRadar/Jobstrack latency figures) — self-reported

---
*Research completed: 2026-07-15*
*Ready for roadmap: yes*

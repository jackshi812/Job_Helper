# Phase 3: Scoring, Feed & Notifications - Context

**Gathered:** 2026-07-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Per-user job preferences (titles, locations, include/exclude keywords) drive cheap filters that gate AI cost; Gemini scores survivors against the user's own resume and preferences; a dashboard feed shows deduplicated matches with scores and reasons; job detail shows the JD snapshot plus an advisory keyword-gap panel; strong matches trigger instant web push with a daily email digest as backup. RESU-01 (base resume upload) already shipped in Phase 1 — this phase consumes those resumes, it does not rebuild upload. Resume tailoring, tracker, and outreach remain Phase 4+.

**Note:** Phase 02.1 (source coverage expansion) is executing in parallel via another agent. Planning must re-verify 02.1's final schema/adapter surface before execution begins (jobs.source values, connector states, degraded-source semantics).

</domain>

<decisions>
## Implementation Decisions

### Cheap filters & preference semantics
- **D-01:** Title filtering is fuzzy word-overlap: normalize, match on significant word overlap plus known synonyms (quant=quantitative, sr=senior). Title mismatch discards only on clear non-overlap; AI judges real relevance after.
- **D-02:** Exclude keywords hard-discard (any hit in title/JD drops the job before AI). Include keywords are soft — they boost/inform scoring but absence never discards.
- **D-03:** Location: posting passes if it mentions a preferred location, is remote-eligible, or has blank/unparseable location (AI judges). Discard only clear mismatches (wrong-country/city with no remote option).
- **D-04:** Filtered-out jobs keep their rows with a filtered status + reason (excluded keyword / wrong location / title non-overlap). Feed hides them; an "all jobs" toggle reveals them. Editing preferences re-runs cheap filters over recent jobs so tuning gives retroactive feedback.
- **D-05:** Preferences are per-user (PREF-01); the shared global job pool is filtered/scored per user independently.

### Resume routing & scoring
- **D-06:** User maintains 3 base resumes targeting different roles (data scientist, finance, data engineer). System recommends which resume fits each job: keywords extracted from each resume once at upload; per job, keyword overlap routes to the best-fit resume; AI scores against that one resume only (1 scoring call per job). Recommendation shown on the job card; near-ties pick top overlap and show runner-up.
- **D-07:** Score is 0–100 plus tier label. Tiers: Strong ≥75, Good 50–74, Weak <50. Default instant-notify threshold 75, tunable (NOTF-03).
- **D-08:** Scoring prompt sends full JD text + full routed-resume text + user preferences. No summarization (volume is tiny; fidelity wins).
- **D-09:** Match reasons (SCOR-03): 3–5 short structured bullets — skill overlaps, title fit, location, resume-specific hooks.
- **D-10:** Rescoring: when a resume or preferences change, rescore still-open jobs from a recent window (~7 days). Older jobs keep stale scores marked with scored-at time.

### AI model plan (budget: some cost OK, <$5/month)
- **D-11:** Provider: Google Gemini only, **all paid tier** (never free tier — free-tier inputs may train Google models; resume is personal data). No OpenAI (user subscriptions to ChatGPT Pro/Gemini Pro do not cover API usage; second provider adds no value at this scale).
- **D-12:** Model split: **Gemini 2.5 Flash** (`gemini-2.5-flash`) = scorer + resume keyword extraction; **Gemini 2.5 Flash-Lite** (`gemini-2.5-flash-lite`) = JD triage. Structured JSON output, temperature 0, rubric-in-prompt. Estimated ~$3/month at ~50 survivors/day.
- **D-13:** Escalation valve (build as config, not rebuild): optional stage-2 rescore of Strong matches only with Gemini 2.5 Pro if reason quality proves weak after real use.

### Feed & job detail
- **D-14:** Feed defaults to newest-first with score + tier column visible; column-header sort by score available. Dense-table style per Phase 1 D-15.
- **D-15:** Feed shows Strong + Good (≥50) by default; Weak and filtered-out jobs live behind the "all jobs" toggle.
- **D-16:** Feed states: unseen jobs get a New badge; dismiss button hides a job (recoverable via filter). State is per-user — one user's dismissals never affect the other.
- **D-17:** Job detail (SCOR-05): full JD snapshot plus categorized keyword-gap panel — "in JD, missing from resume" grouped by skills / tools / certs / domain terms, plus a "covered" list. Advisory only; computed against the routed resume. Feeds Phase 4 tailoring.

### Notifications
- **D-18:** Cadence: **instant push only for Strong (≥75) matches**, burst-collapsed (multiple strong matches in one poll tick = one combined push). Everything else lands in one daily digest. Preserves the 5–15 min promise where it matters without spam. (User initially wanted one-per-day; confirmed this hybrid after the core-promise tradeoff was surfaced.)
- **D-19:** Quiet hours (per-user setting, e.g. 22:00–07:00): Strong matches during quiet hours queue and fire as one combined push at quiet-hours end. Nothing suppressed, nothing lost.
- **D-20:** Email (Resend, 100/day cap): one daily digest email covering all new Strong + Good matches, plus individual email fallback when a Strong instant push fails to deliver (no subscription / push service error). ~2–5 emails/day.
- **D-21:** Alert tuning UI lives in a "Notifications" section of the existing Settings page: instant-push threshold slider (default 75), quiet hours start/end, digest send time, per-device push enable.

### Claude's Discretion
- Fuzzy title-match algorithm specifics (tokenization, synonym table, overlap threshold)
- Keyword-extraction prompt/schema for resume routing; routing tie-break threshold
- Scoring rubric wording and JSON schema; calibration checks
- Preferences page layout/UX (titles, locations, keyword chips) within Phase 1 D-15 style
- Push permission onboarding flow, service-worker structure, notification click-through target
- Digest email layout; queue/delivery bookkeeping tables
- Where triage (Flash-Lite pass/fail) sits in the pipeline vs relying on cheap filters alone — drop triage stage entirely if cheap filters prove sufficient

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project scope & requirements
- `.planning/ROADMAP.md` §Phase 3 — goal, success criteria, requirement IDs (PREF-01, RESU-01, SCOR-01..05, NOTF-01..04)
- `.planning/REQUIREMENTS.md` — full requirement text for the IDs above
- `.planning/PROJECT.md` — core value (5–15 min discovery-to-notification), budget/compliance constraints

### Stack decisions
- `.claude/CLAUDE.md` §Technology Stack — Gemini pricing/tiers, `@negrel/webpush` (JSR, Deno edge push), Resend free-tier caps, per-job-email prohibition, two-stage scoring pattern
- `.claude/CLAUDE.md` §Free-Tier Limits — Resend 100/day binding cap, Gemini free-tier data-training caveat (why paid tier is locked)

### Prior phase constraints (MUST re-verify 02.1 after its execution completes)
- `.planning/phases/02-watchlist-ingestion-monitoring/02-CONTEXT.md` — shared watchlist (D-01), Adzuna seed queries that Phase 3 preferences replace (D-08), health semantics
- `.planning/phases/02.1-source-coverage-expansion/02.1-CONTEXT.md` — expanded source set, degraded-source semantics, activation states; **02.1 executing in parallel — planner must diff against its final VERIFICATION.md before Phase 3 execution**
- `.planning/phases/01-foundation-access/01-CONTEXT.md` — D-14 system theme, D-15 dense-table minimal style, nav skeleton (Dashboard/Settings stubs Phase 3 fills)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `supabase/functions/poll-tick/index.ts` + `supabase/functions/_shared/lifecycle.ts` — ingestion pipeline Phase 3 hooks into after dedup; scoring must trigger off newly ingested jobs
- `supabase/functions/_shared/dedup.ts` — NOTF-04 depends on scoring running post-dedup only
- `supabase/migrations/0006_jobs_pipeline.sql` — jobs table Phase 3 extends (score, tier, filtered status, per-user state likely in separate per-user tables given shared job pool)
- `web/src/pages/Dashboard.tsx` — stub page the match feed fills; `web/src/pages/Settings.tsx` — existing page gaining Notifications section
- `web/src/lib/watchlist.ts` TanStack Query patterns; `web/src/lib/resumes.ts` — resume storage access for extraction
- Phase 1 RLS style: `(select auth.uid())`-scoped per-operation policies — per-user preference/feed-state/notification tables need per-user isolation (unlike shared watchlist)

### Established Patterns
- pg_cron + pg_net + Vault scheduling (locked); scoring/notification stages join the existing tick cadence
- Migrations sequence next: 0017
- Verification scripts in `scripts/` run with `node --env-file=scripts/.env`

### Integration Points
- Phase 2 D-08 Adzuna seed queries are replaced by the Phase 3 preferences UI as the discovery-query source
- New edge surface: scoring worker, notification dispatcher, digest sender; new Gemini API key + VAPID keys in Vault/secrets
- Service worker for web push is new frontend surface (vanilla, no library; browser uses native PushManager)

</code_context>

<specifics>
## Specific Ideas

- User's concrete setup: 3 resumes (data scientist / finance / data engineer); the system should recommend which resume to use per job based on keywords — this recommendation is a first-class feed feature, not an afterthought.
- Notification philosophy: quiet by default — user's instinct was one notification per day; instant pushes are the exception reserved for Strong matches only. When in doubt, notify less.

</specifics>

<deferred>
## Deferred Ideas

- Star/shortlist state in feed — proto-tracker behavior, belongs in Phase 4 tracker (saved stage)
- Score-against-all-3-resumes comparison view — revisit only if keyword routing misroutes in practice
- Gemini 2.5 Pro stage-2 rescore — config valve, activate only on evidence of weak reason quality

</deferred>

---

*Phase: 3-Scoring, Feed & Notifications*
*Context gathered: 2026-07-18*

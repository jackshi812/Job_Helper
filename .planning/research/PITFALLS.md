# Pitfalls Research

**Domain:** Job-discovery + AI resume-tailoring copilot (career-site scraping, free-tier hosting, 2 users)
**Researched:** 2026-07-15
**Confidence:** MEDIUM overall — platform-limit claims (Cloudflare, Supabase, web push) anchored to official docs found during research (HIGH); ecosystem/dedupe/AI-behavior claims from industry and community sources (MEDIUM); a few single-source community claims marked LOW inline.

## Critical Pitfalls

### Pitfall 1: One dead company slug silently kills or degrades the whole monitoring run

**What goes wrong:**
The scheduled scrape loops over 100+ company career endpoints. One company migrates off Greenhouse, renames its board slug, or returns a 404/timeout — and either the whole run throws (no more jobs from anyone), or the failure is swallowed and that company silently drops out of coverage for weeks. Lever returns HTTP 404 for unknown slugs; companies migrate ATS platforms without announcement.

**Why it happens:**
The natural first implementation is a single loop with shared error handling. Nobody notices per-company failures because the run "succeeds" overall, and with 100+ companies there's no baseline for "company X usually has 12 postings, today it has 0."

**How to avoid:**
- Per-company error isolation: try/catch around each company fetch, record per-company status (`ok`, `http_error`, `timeout`, `empty`) in a `source_health` table every run.
- Alert (to yourselves, in the dashboard) when a company fails N consecutive runs or drops to 0 postings after having >0 — that's the "they migrated ATS" signal.
- Retries with backoff on 429/5xx, but a hard per-company timeout so one slow site can't eat the run budget.

**Warning signs:**
A watchlist company you know is hiring never shows matches; per-company posting counts trending to zero; run duration creeping up.

**Phase to address:**
Monitoring/ingestion phase — build `source_health` tracking in the same phase as the first fetcher, not later.

---

### Pitfall 2: Naive dedupe — duplicate alerts and re-alerting on reposts destroy trust in notifications

**What goes wrong:**
The same job arrives from the ATS endpoint AND the aggregator API with different URLs, different text framing, and different IDs. Industry data: an average job ad is reposted 2–5x and 50–80% of aggregator listings are duplicates. Exact-URL or exact-string dedupe passes them all through, so the user gets 2–4 pings per real job. Separately, companies repost/refresh the same role, re-triggering "new job" alerts for something already seen (or already rejected from).

**Why it happens:**
Devs key dedupe on the source's job ID or URL, which is only unique *within* a source. Cross-source identity requires normalized fuzzy matching, which feels like premature complexity — until the aggregator is added and every job doubles.

**How to avoid:**
- Dedupe key = normalized (company, title, location) composite — this is Lightcast's production approach — with a lookback window (they use 60 days) so reposts within the window are treated as the same job.
- Store the ATS-native ID per source as a secondary exact key; treat ATS endpoint as canonical when both sources have the job (better data, faster).
- Normalize before comparing: lowercase, strip seniority noise ("Sr."/"Senior"), canonical location strings. Remote status is represented differently per ATS (Ashby boolean, Lever enum, Greenhouse just the word "Remote" in location) — normalize to one enum at ingestion.
- "New" = first time the dedupe key is seen, not first time a source row is seen.

**Warning signs:**
Same role appearing twice in the dashboard; user gets a push for a job they already saved; match feed count roughly doubles when the aggregator source is enabled.

**Phase to address:**
Ingestion/pipeline phase — dedupe must land *before* the aggregator source is turned on, and before notifications ship. Ordering constraint for the roadmap: ATS fetch → dedupe → aggregator → notifications.

---

### Pitfall 3: AI "conflation" edits — the resume tailor lies plausibly, not obviously

**What goes wrong:**
Two failure modes: (a) outright fabrication — the model adds "Kubernetes" or "AWS" the user never touched; (b) the subtler and more dangerous *conflation* — the model recombines true facts from different parts of the resume into one coherent-sounding but false bullet (documented example: a "real-time" detail from a college capstone attributed to a current job's dashboard work). Mode (b) survives a casual side-by-side skim because every word in it is individually true.

**Why it happens:**
Free-form "rewrite this resume for this job" prompts give the model license to synthesize. Cheap models (budget constraint here) conflate more. Users approve quickly because the output *sounds* like them.

**How to avoid:**
- Constrain the task: prompt for keyword-level rewrites of existing bullets only, with an explicit instruction set ("never add a skill, tool, employer, metric, or date not present in the source"); output structured edits (bullet-by-bullet before/after), not a rewritten document.
- Programmatic guardrail: extract skill/tool/proper-noun terms from the AI output and diff against the source resume text; flag any term that appears in output but not in source as "NEW — verify this is true" in the review UI.
- Review UI shows per-bullet diffs (word-level), not two full documents side by side — conflation hides in full-document views.
- Reject-and-regenerate per bullet, so one bad edit doesn't force redoing the whole pass.

**Warning signs:**
Approved edits containing tools/metrics you can't find in the base DOCX; edits that merge content from two different jobs' sections.

**Phase to address:**
Resume tailoring phase — the term-diff guardrail and per-bullet diff UI are core requirements of that phase, not polish. This phase should be flagged for deeper research (prompt design + extraction approach).

---

### Pitfall 4: Web push treated as reliable primary channel — it is not, especially with the browser closed

**What goes wrong:**
The 5–15 minute notification goal quietly fails. Web push "works with tab closed" only if the *browser process* is running; on desktop, if Chrome/Firefox is fully quit, nothing arrives until relaunch. Subscriptions expire or are revoked (push service returns 404/410); "sent" only means delivered to FCM/Mozilla autopush, not to the device; TTL expiry drops messages silently; OS Focus/DND suppresses display. None of these produce an error you'll see unless you look.

**Why it happens:**
Push demos work perfectly on the dev machine with the browser open. The failure modes are all silent and environmental.

**How to avoid:**
- Design email as a co-equal channel from day one (already planned) — send both, always, for high-score matches; don't gate email on "push failed" because you can't reliably detect push failure at the device level.
- Handle 404/410 responses by pruning dead subscriptions and surfacing "push disconnected — re-enable?" in the dashboard.
- Set a long TTL (hours, not default) so a briefly-offline laptop still gets the push on wake.
- Add a "test notification" button so users can self-verify the channel works on their setup.
- macOS specifically: instruct users to keep the browser running and allow notifications in System Settings; verify during onboarding.

**Warning signs:**
Push send logs show success but user reports nothing appeared; subscription rows older than ~30 days never re-validated; zero 410 handling in code.

**Phase to address:**
Notifications phase — build subscription lifecycle (prune/re-subscribe) and the email fallback in the same phase as first push send.

---

### Pitfall 5: Serverless cron assumed to be a reliable heartbeat — no retries, no failure alarms, silent stalls

**What goes wrong:**
The 5–15 minute discovery loop depends on a scheduled function firing every few minutes forever. Cloudflare Workers cron: **no retry** if the scheduled handler throws — next attempt is the next tick; **no built-in notification** when crons start failing; free plan allows 3 cron triggers per Worker; there have been platform incidents where cron dispatch stopped globally. Supabase pg_cron→edge-function via pg_net is **fire-and-forget** with a ~5s connect timeout, so the caller never knows the function failed; auth wiring between pg_cron and edge functions is a known documentation gap (static service_role pattern removed, teams end up disabling JWT verification). A stalled cron looks identical to "no new jobs today."

**Why it happens:**
Cron "just works" in testing. The absence of failure signals means the first detection is a human noticing days of silence.

**How to avoid:**
- Heartbeat table: every scheduled run writes a row (started_at, finished_at, companies_ok, companies_failed, jobs_found). Dashboard shows "last successful run: N minutes ago" prominently; red banner if > 3× the interval.
- Optional dead-man's-switch: a free external ping monitor (e.g., healthchecks.io free tier) that alerts if the run stops checking in — this catches platform-level cron outages your own code can't.
- Make each run idempotent and self-recovering (process everything since last successful watermark, not "last N minutes"), so a missed tick is caught up by the next one instead of creating a permanent gap.
- If using pg_cron→edge functions, decide the auth pattern deliberately (secret header checked in-function rather than disabled JWT with no check).

**Warning signs:**
Gaps in the heartbeat table; jobs_found flat at zero across runs; discovery latency measured from posting timestamps drifting past 15 minutes.

**Phase to address:**
Monitoring/ingestion phase (heartbeat + watermark idempotency); observability check in every subsequent phase's verification.

---

### Pitfall 6: Free-tier ceilings hit as hard cutoffs — Supabase 7-day pause and 402 hard-stop

**What goes wrong:**
Supabase free tier **pauses projects after 7 days of database inactivity** — but with a cron writing every few minutes this project stays active *until* the cron itself breaks, at which point the pause compounds the outage (Pitfall 5 cascade: cron dies → 7 days later DB pauses → manual resume required). Worse: crossing a free-tier limit (e.g., 5 GB egress) triggers the Fair Use response where **services return 402 and stop serving entirely** until reset/upgrade. No automatic backups on free tier — a bad migration is unrecoverable. Cloudflare Workers free plan gives only 10 ms CPU per cron tick, which cannot do real work inline.

**Why it happens:**
Free tiers are evaluated by "requests/month" headroom (500K edge invocations is plenty for 2 users) while the actual killers are the *behavioral* limits: inactivity pause, egress from resume file traffic and job payloads, CPU-per-invocation, and hard-stop enforcement.

**How to avoid:**
- Budget egress deliberately: store only normalized job fields (not full HTML), don't re-download unchanged ATS payloads (use per-company content hash / conditional requests), serve resume files via signed URLs only on demand.
- Architect the cron so heavy work happens where the budget is (Supabase edge function or fetch-based Worker with subrequests — network wait doesn't count against Workers CPU time, but parsing large payloads does).
- Export a periodic `pg_dump` (free, via a scheduled job or manual weekly) since there are no backups.
- Track monthly usage against limits in the same heartbeat/dashboard from Pitfall 5.

**Warning signs:**
Supabase dashboard usage bars past 50% mid-month; 402 responses; project showing "paused" after a vacation week where cron had also failed.

**Phase to address:**
Foundation/infra phase (architecture placement of the cron work, egress-lean schema); backup export in the same phase as first real data.

---

### Pitfall 7: DOCX→PDF conversion silently mangles the resume (fonts, layout) — and can't run on your chosen stack in-process

**What goes wrong:**
Two traps. (1) **Platform**: neither Cloudflare Workers nor Supabase edge functions can run LibreOffice; DOCX→PDF needs a container or an external conversion API — this is an architectural hole if discovered late. (2) **Fidelity**: LibreOffice headless substitutes missing fonts silently — without the Carlito/Caladea metric-compatible fonts installed, Calibri/Cambria documents reflow, page breaks move, and a one-page resume becomes 1.2 pages. Text boxes, columns, and custom fonts degrade further. The user approves truthful *text* edits and then downloads a visually broken PDF.

**Why it happens:**
"Convert DOCX to PDF" sounds like a library call. On serverless-free-tier stacks it's the single hardest infrastructure requirement in the project, and font substitution produces no error — only a subtly different document.

**How to avoid:**
- Decide the conversion path in the architecture phase, not the tailoring phase. Realistic free options: a tiny always-free container host running LibreOffice/Gotenberg; a free-tier conversion API (watch quota + privacy — resumes are sensitive); or client-side rendering compromise. Flag this decision for phase-specific research.
- If self-hosting LibreOffice: install `fonts-crosextra-carlito` and `fonts-crosextra-caladea`; conversion is single-threaded — queue, don't parallelize (fine for 2 users).
- Golden-file test: convert each user's actual base resumes at setup, show the PDF for visual approval *before* any tailoring run depends on it; re-verify page count matches the DOCX.
- Alternative worth evaluating: keep edits inside the DOCX (docx libraries do text-run edits well) and let fidelity risk live only at the final PDF step, with the DOCX also downloadable as escape hatch.

**Warning signs:**
Generated PDF page count differs from source DOCX; fonts in the PDF don't match the original; conversion works locally (fonts installed) but not in deploy target.

**Phase to address:**
Architecture/stack phase for the "where does conversion run" decision; resume management phase for golden-file verification. Flag for deeper research.

---

### Pitfall 8: Scoring/alert thresholds untuned — notification fatigue in week one, then missed jobs after overcorrection

**What goes wrong:**
The classic two-phase failure: launch with a permissive threshold → 30 alerts/day, mostly mediocre matches → user tunes out or the threshold gets cranked up → now genuinely great matches score 0.68 against a 0.7 cutoff and are never seen. With alert systems generally, high false-positive rates cause users to unconsciously ignore *all* alerts — which destroys this project's entire core value (the 5–15 min alert only matters if the user acts on it).

**Why it happens:**
Thresholds are picked by gut before any data exists; there's no feedback loop; and "notify" is binary instead of tiered.

**How to avoid:**
- Tier the output: push+email only for high-score matches; everything above a lower floor goes to the dashboard feed silently. Missing a mediocre job in the feed is fine; pinging for it is not.
- Include match *reasons* in the notification (already a requirement) — actionable alerts survive fatigue far better than bare links.
- Add a lightweight feedback signal from day one (thumbs up/down or "not relevant" on each match) and log score + verdict, so thresholds are tuned from data within weeks.
- Run the first 1–2 weeks in "shadow mode" review: check the dashboard for jobs that scored just below the push threshold to calibrate before trusting it.

**Warning signs:**
User reports ignoring pushes; >10 push notifications/day/user; a good job discovered manually that the system had scored below threshold.

**Phase to address:**
Scoring/notifications phase — tiering and the feedback signal ship with the first notification, not after.

---

### Pitfall 9: LinkedIn/aggregator compliance drift — "just this one scrape" recreates the banned pattern

**What goes wrong:**
The out-of-scope line (no logged-in LinkedIn scraping) erodes under coverage pressure: watchlist + aggregator misses jobs that are LinkedIn-only, and the tempting fix is scraping LinkedIn search results. Logged-in scraping violates LinkedIn's User Agreement and gets accounts restricted/banned — and it's the *user's personal account* (the one they need for job hunting) that gets burned. Aggregator APIs also have their own ToS and rate limits that free-tier keys hit quickly.

**Why it happens:**
Coverage gaps feel like bugs; the policy boundary is invisible in code. Aggregator quota exhaustion mid-month pushes toward scraping as a "backup."

**How to avoid:**
- Encode the boundary architecturally: LinkedIn appears only as (a) official email alerts the user forwards/checks manually, or (b) public unauthenticated pages if ever needed — never session-cookie fetches. No LinkedIn credentials stored anywhere in the system, ever.
- Treat coverage gaps as a watchlist-growth task (add more companies' ATS endpoints — free and compliant) rather than a scraping task.
- Track aggregator API quota in the heartbeat dashboard; degrade gracefully (watchlist keeps working) when quota exhausts.

**Warning signs:**
Any code path touching LinkedIn cookies/sessions; aggregator 429s near month-end; feature requests phrased as "can we also pull from LinkedIn search."

**Phase to address:**
Foundation phase (architecture rule + no-credential policy); aggregator quota tracking in ingestion phase.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Dedupe by source job URL/ID only | Ships fast, works for single source | Duplicate alerts explode when aggregator added; trust in notifications lost | Only before the aggregator source exists |
| Skip per-company health tracking | Simpler fetch loop | Silent coverage decay; watchlist rots invisibly | Never — it's a small table and cheap |
| Disable JWT verification on cron-invoked edge functions with no substitute check | Unblocks pg_cron→function calls | Publicly invokable function that runs your scraper/AI budget | Only with a secret-header check in-function |
| Hardcode alert threshold | No tuning UI needed | Fatigue or missed jobs, no data to fix it | Acceptable for week 1 only if scores+outcomes are logged |
| Full-document AI rewrite instead of structured per-bullet edits | Simpler prompt, faster to build | Conflation hallucinations slip through review; violates truthfulness constraint | Never for this project |
| Store raw HTML/full JSON payloads per run | Easier debugging | Eats 500 MB DB + egress budget in weeks at 100+ companies × frequent polls | Only with short TTL cleanup job |
| Local-only DOCX→PDF testing | Avoids infra decision | Conversion path may be impossible on chosen deploy target | Never — decide platform first |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Greenhouse/Lever/Ashby JSON | Assuming one normalized shape — date formats, pagination, remote flags all differ per ATS | Per-ATS adapter that maps to one internal schema at ingestion; normalize remote/location/employment-type there |
| Lever API | Treating 404 as transient error and retrying forever | 404 = slug gone/renamed; flag company for manual re-check, don't retry-loop |
| Aggregator API | Polling it as eagerly as ATS endpoints | It's the quota-limited source; poll less often, track quota, watchlist ATS carries the 5–15 min goal |
| Supabase pg_cron → edge function | Believing the 5000 ms setting bounds function runtime | pg_net is fire-and-forget; 5 s is connect timeout only — function outcome must be recorded by the function itself (heartbeat row) |
| Cloudflare Workers cron | Expecting retries/alerts on handler failure | No retries, no failure notification — self-report via heartbeat + external dead-man's-switch |
| Resend (email) | Sending from unverified domain / no DMARC and expecting inbox placement | Verify domain, set SPF+DKIM+DMARC before first real alert; keep alert emails simple (few links, plain layout) |
| Web push service | Treating a 201 from FCM/autopush as "user saw it" | It only means the push service accepted it; prune on 404/410, set long TTL, keep email co-channel |
| LibreOffice headless | Converting with default container fonts | Install Carlito/Caladea (metric-compatible with Calibri/Cambria); serialize conversions (not thread-safe) |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Re-fetch + re-process full payload of all 100+ companies every tick | Egress climbing, run time growing, AI cost per run nonzero even with no new jobs | Content-hash per company; skip unchanged; delta-only processing | 5 GB egress ceiling within a month at frequent polling |
| AI scoring called before cheap filters (or on unchanged jobs) | AI spend scales with total postings, not new relevant ones | Filter order enforced in pipeline: title/location/keyword → dedupe → AI on survivors only; never re-score an unchanged job | Budget cap, immediately |
| Sequential fetch of 100+ companies in one function invocation | Runs exceed function time limits; later companies starve when early ones are slow | Batch companies across invocations or use bounded concurrency with per-company timeout | ~50–100 companies with a few slow hosts |
| Storing every raw posting forever | 500 MB DB fills; queries slow | Keep normalized fields; TTL-expire closed/old postings (e.g., 90 days) | Months at 100+ companies |
| Serverless cron interval < work duration | Overlapping runs double-process, duplicate notifications | Run lock (advisory lock / status row) + idempotent watermark processing | First slow run |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Cron-invoked edge function publicly callable (JWT off, no check) | Anyone can trigger scraping/AI spend, or probe internals | Secret header validated in-function; secret in env, rotated |
| Resume storage bucket public or shared-path | Resumes are sensitive PII; cross-user leak between the two users | Supabase Storage private bucket + RLS by user id; signed URLs with short expiry for downloads |
| Missing RLS on job/application/preference tables | "Fully separated data" requirement silently violated — both users see each other's tracker | RLS on every user-owned table from the first migration; test with both accounts |
| Resume text sent to AI provider without thought | Third-party retention of resume content | Use provider with no-training/retention policy tier; send only needed sections; document it |
| Storing LinkedIn or any user credentials for "future automation" | Policy violation + credential breach blast radius | Architectural rule: no third-party credentials stored, period |
| No backup of free-tier DB | Bad migration or accidental delete is unrecoverable (no free-tier backups) | Scheduled `pg_dump` export to storage/local weekly |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Every match triggers push+email | Fatigue within days; user ignores the channel that carries core value | Tiered: push+email for high scores only; dashboard feed for the rest |
| Bare "New job: [link]" notifications | User must open and evaluate each one; alerts feel like spam | Include score + top 2 match reasons + company/title/location in the notification body |
| Full-document side-by-side resume review | Conflation edits get approved unseen | Per-bullet word-level diff with explicit "NEW TERM" flags; approve per edit |
| No "last checked" visibility | Silent monitoring failure indistinguishable from quiet job market; trust erodes | "Last run N min ago / X companies OK" always visible on dashboard |
| Repost re-alerts | User pinged about a job they already dismissed/applied to | Dedupe window + suppress alerts for keys already in tracker with any stage |
| PDF download without preview | User submits a mangled resume to a real employer | Inline PDF preview + page-count check before download is offered |

## "Looks Done But Isn't" Checklist

- [ ] **Watchlist monitoring:** Works for 5 test companies — verify per-company failure isolation, health tracking, and behavior when a slug 404s or an ATS migrates.
- [ ] **Dedupe:** Works within one source — verify cross-source (ATS + aggregator) and repost-within-window cases with real duplicate pairs.
- [ ] **Notifications:** Push arrives in dev with browser open — verify with browser fully quit (expect failure on desktop; confirm email covers it), after laptop sleep, and after subscription expiry (410 pruning).
- [ ] **Cron:** Fires in testing — verify heartbeat visibility, behavior after a thrown error (no retry on CF Workers), overlapping-run lock, and an external dead-man's-switch.
- [ ] **Resume tailoring:** Produces plausible edits — verify the new-term diff guardrail catches an injected fabricated skill, and conflation test (facts from two sections merged) is flagged.
- [ ] **DOCX→PDF:** Converts a simple test doc — verify with each user's actual resume (fonts, text boxes, page count) on the *deployed* conversion environment, not locally.
- [ ] **Data separation:** Both users can log in — verify user A cannot query user B's rows via API with RLS tests, not just UI checks.
- [ ] **Email alerts:** Delivered to your own Gmail — verify SPF/DKIM/DMARC pass (check headers) and inbox (not spam/promotions) placement on both users' actual providers.
- [ ] **Free-tier budget:** Works this week — verify projected monthly egress/invocations/DB growth at real polling frequency against Supabase/Cloudflare limits.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Silent coverage decay (dead slugs) | LOW | Backfill `source_health` from logs; re-resolve each dead company's current ATS/board URL; add health alerts |
| Duplicate-alert flood after aggregator launch | MEDIUM | Pause aggregator notifications (keep ingesting); build normalized dedupe key; backfill-merge existing rows; re-enable |
| Cron stalled for days unnoticed | LOW | Watermark-based catch-up run processes the gap; add heartbeat + external monitor so it can't recur |
| Supabase project paused / 402 hard-stop | LOW–MEDIUM | Manual resume (~30 s wake) or wait for billing reset; then cut egress (hash-skip unchanged payloads, TTL old rows) |
| Fabricated content shipped in a downloaded resume | HIGH (trust/user harm) | User must re-check submitted applications; add term-diff guardrail + per-bullet review before re-enabling tailoring |
| Mangled PDFs discovered post-launch | MEDIUM | Re-offer DOCX download as escape hatch; fix fonts/conversion host; golden-file re-verify all base resumes |
| Alert emails in spam | MEDIUM | Fix SPF/DKIM/DMARC; simplify template; users mark "not spam"; consider new sending subdomain warm-up |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Dead-slug silent failure | Monitoring/ingestion | Kill one test slug; confirm run completes, health row records failure, dashboard flags it |
| Naive dedupe / repost re-alerts | Ingestion pipeline (before aggregator + notifications) | Feed same job via ATS + aggregator fixtures; exactly one match, one alert |
| AI conflation/fabrication | Resume tailoring (flag: deeper research) | Injected-fabrication test caught by term-diff; conflation fixture flagged in review UI |
| Push unreliability | Notifications | Browser-quit test documents behavior; 410 pruning verified; email arrives for every high-score match |
| Cron no-retry/silent stall | Monitoring/ingestion + infra | Throw in handler; confirm next tick catches up via watermark; dead-man's-switch alarm fires |
| Free-tier ceilings (pause, 402, egress) | Foundation/infra | Monthly usage projection < 60% of each limit at production polling rate; pg_dump export exists |
| DOCX→PDF platform + fidelity | Architecture/stack decision (flag: deeper research), verified in resume phase | Each real base resume converts on deployed target with matching page count and fonts |
| Threshold fatigue / missed jobs | Scoring/notifications | Tiered channels live; feedback signal logging score+verdict from first alert |
| LinkedIn/aggregator compliance drift | Foundation (architecture rule) | Code search: zero LinkedIn credential/session handling; aggregator quota visible in dashboard |

## Sources

- ATS API structural differences and monitoring requirements: [Comparing job-posting APIs of Workday, Greenhouse, Lever, Ashby (2026)](https://bebee.com/us/jobs/comparing-the-job-posting-apis-of-workday-greenhouse-lever-ashby-smartrecruiters-and-recruitee-2026---techmap_us_4440015861); ecosystem of multi-ATS scrapers: [Apify multi-ATS scrapers](https://apify.com/webdata_labs/greenhouse-lever-ashby-jobs-scraper) — MEDIUM
- Duplicate rates and production dedupe approaches: [Textkernel — detecting non-exact duplicate job postings](https://www.textkernel.com/learn-support/blog/online-job-postings-have-many-duplicates-but-how-can-you-detect-them-if-they-are-not-exact-copies-of-each-other/), [Lightcast dedupe methodology](https://kb.lightcast.io/en/articles/6957661-how-does-lightcast-handle-duplicate-postings), [Indeed dedupe explained](https://recruitingdaily.com/did-indeed-hide-your-job-postings-deduplication-explained/) — MEDIUM
- Cloudflare cron behavior/limits (no retry, 3 triggers, 10 ms CPU free, jitter/propagation): [Cron Triggers docs](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), outage report: [Cron Triggers stopped dispatching (community)](https://community.cloudflare.com/t/cron-triggers-stopped-dispatching-scheduled-since-20-june-14-00-utc/935555) — HIGH (official docs)
- Supabase cron/edge-function gotchas: [Scheduling Edge Functions docs](https://supabase.com/docs/guides/functions/schedule-functions), [pg_cron auth pattern gap (cli#4287)](https://github.com/supabase/cli/issues/4287), [pg_net 5000 ms timeout discussion](https://github.com/orgs/supabase/discussions/37574) — HIGH (official docs + issue tracker)
- Supabase free-tier pause/limits/402: [Supabase functions limits docs](https://supabase.com/docs/guides/functions/limits), [free tier limits 2026 overview](https://www.iloveblogs.blog/post/supabase-free-tier-limits-2026), [hidden pauses & caps](https://www.itpathsolutions.com/supabase-free-tier-limits) — MEDIUM (community summaries cross-checked against docs)
- LLM resume fabrication + conflation failure mode: [Why AI resume writers lie — Hirecarta](https://hirecarta.com/blog/why-ai-resume-writers-lie), [LLM resume tailoring guide — SwiftScout](https://www.swiftscout.ai/blog/llm-resume-tailoring-guide), dual-LLM anti-hallucination framing: [ACL 2025 resume-analysis paper](https://aclanthology.org/2025.clicit-1.51.pdf) — MEDIUM
- LibreOffice headless fidelity/fonts/threading: [LibreOffice in Docker for conversion (OneUptime)](https://oneuptime.com/blog/post/2026-02-08-how-to-run-libreoffice-in-docker-for-document-conversion/view), [DOCX→PDF on AWS Lambda + LibreOffice](https://dev.to/itsawaisahmad/convert-docx-to-pdf-programmatically-aws-lambda-libreoffice-1l24), [wkhtmltopdf→LibreOffice case](https://medium.com/@zofia.lekki/rethinking-web-app-document-conversion-the-case-for-switching-from-wkhtmltopdf-to-libreoffice-6c02b3017862) — MEDIUM
- Web push delivery failure modes (410 pruning, TTL, browser-must-run, "sent ≠ shown"): [Pushpad — why push notifications are not delivered](https://pushpad.xyz/blog/why-some-web-push-notifications-are-not-delivered-to-the-browser), [web.dev Web Push Protocol](https://web.dev/articles/push-notifications-web-push-protocol), [Mozilla VAPID service post](https://blog.mozilla.org/services/2016/08/23/sending-vapid-identified-webpush-notifications-via-mozillas-push-service/) — MEDIUM–HIGH
- Alert-fatigue dynamics (false positives → tuning out; actionable alerts; feedback loops): [Splunk on alert fatigue](https://www.splunk.com/en_us/blog/learn/alert-fatigue.html), [PagerDuty on alert fatigue](https://www.pagerduty.com/resources/digital-operations/learn/alert-fatigue/) — MEDIUM (domain-adjacent, principles transfer)

---
*Pitfalls research for: job-discovery + AI resume-tailoring copilot*
*Researched: 2026-07-15*

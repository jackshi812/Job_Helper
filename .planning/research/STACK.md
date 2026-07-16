# Stack Research

**Domain:** Job-discovery + AI resume-tailoring web app (invite-only, 2 users, near-zero cost)
**Researched:** 2026-07-15
**Confidence:** MEDIUM-HIGH overall (platform limits verified against official docs; exact minor versions of npm libs should be pinned at `npm install` time, not from this doc)

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| React + Vite (SPA) | React 19.x, Vite 7.x | Frontend dashboard on Cloudflare Pages | A pure SPA compiles to static assets and deploys to Pages with zero server config. No SEO requirement (invite-only, 2 users) → SSR buys nothing. Next.js on CF Pages is second-class vs Vercel; a Vite SPA is the friction-free path. Confidence: HIGH |
| TypeScript | 5.x | Language everywhere (frontend + edge functions) | Supabase Edge Functions are Deno/TypeScript; one language across the whole codebase. Confidence: HIGH |
| Supabase (Free plan) | supabase-js ^2 | Auth, Postgres, Storage, Edge Functions, cron | Already decided; validated as viable — limits (below) comfortably fit 2 users. Confidence: HIGH |
| Supabase Edge Functions (Deno) | Deno runtime, current | All backend logic: pollers, scoring, notifications, DOCX processing | Only compute surface on the free plan; scheduled via pg_cron + pg_net at 1-minute granularity — comfortably meets the 5–15 min discovery goal. Confidence: HIGH (pattern verified on official docs) |
| pg_cron + pg_net | Supabase-managed extensions | Scheduling the monitoring pipeline | Official Supabase pattern: `cron.schedule('*/5 * * * *', net.http_post(<edge fn URL>))` with the auth token in Supabase Vault. No external scheduler needed. Confidence: HIGH |
| Gemini 2.5 Flash-Lite | API model `gemini-2.5-flash-lite` | AI job scoring + resume keyword tailoring | Cheapest capable tier that also has a **free tier**: $0.10/$0.40 per 1M tokens paid (verified on ai.google.dev pricing). For ~50 scored jobs/day at ~2K tokens each, paid cost is <$1/month — effectively zero. Structured JSON output supported for scoring. Confidence: HIGH on pricing; MEDIUM on "best" (GPT-5 nano is marginally cheaper but has no free tier) |
| Web Push via `@negrel/webpush` | latest (JSR) | Desktop push notifications from edge functions | Deno-native RFC 8291/8292 implementation on JSR — runs in Supabase Edge Functions where Node's `web-push` does not cleanly. Ships a VAPID keygen script. Store `PushSubscription` JSON per user in Postgres. Confidence: MEDIUM (library exists and targets exactly this runtime; JSR page returned 403 so latest version unverified — check at install) |
| Resend | REST API / resend-node ^4 | Email notification backup | Free tier verified: **100 emails/day, 3,000/month, 1 verified domain**. Call via plain `fetch` from edge functions (no SDK needed in Deno). Confidence: HIGH |

### Job Data Sources

| Source | Endpoint | Auth | Limits | Role |
|--------|----------|------|--------|------|
| Greenhouse Job Board API | `GET https://boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true` | None | Undocumented; be polite | Watchlist polling |
| Lever Postings API | `GET https://api.lever.co/v0/postings/{company}?mode=json` | None | Undocumented; supports `team`/`location`/`limit` filters server-side | Watchlist polling |
| Ashby Posting API | `GET https://api.ashbyhq.com/posting-api/job-board/{name}?includeCompensation=true` | None | Undocumented | Watchlist polling (best compensation data) |
| **Adzuna** (recommended aggregator) | `GET https://api.adzuna.com/v1/api/jobs/{country}/search/1` | Free app_id/app_key | ~25 req/min, **250 req/day** free | Discovery beyond watchlist — 250/day = a discovery sweep every ~10 min with headroom |
| Remotive | `GET https://remotive.com/api/remote-jobs` | None | Unofficial, remote-only | Optional supplement for remote roles |

**Watchlist math:** 100+ companies polled every 5 minutes = ~30K HTTP calls/day from one edge-function tick fanning out with `Promise.allSettled` batches. These are public syndication endpoints with no auth; stagger companies across ticks (e.g., 20 companies/minute round-robin) to stay polite and inside edge-function wall-clock limits.

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@supabase/supabase-js` | ^2 | DB/auth/storage client (browser + edge) | Everywhere |
| `@tanstack/react-query` | ^5 | Server-state fetching/caching in dashboard | All dashboard data |
| `react-router` | ^7 (library mode) | Client-side routing | SPA routes (login, dashboard, resumes, tracker) |
| Tailwind CSS | ^4 | Styling | All UI; pair with shadcn/ui components if desired |
| `mammoth` | ^1 (latest) | DOCX → HTML for the side-by-side review UI | Rendering uploaded/tailored resume preview in browser |
| `jszip` | ^3.10 | Unzip/rezip DOCX; edit `word/document.xml` text runs directly | Resume tailoring edits — preserves the user's original formatting (see note below) |
| `fast-xml-parser` or DOM `DOMParser` | latest | Parse/serialize `document.xml` for run-level text edits | With jszip in the tailoring step |
| Supabase Vault | built-in | Store service-role key + API keys for pg_cron HTTP calls | Cron → edge function auth |
| Service Worker (vanilla) | n/a | Receive push events with tab closed | Required for web push; no library needed |

**DOCX editing note (important architectural choice):** The tailoring flow is *edit an arbitrary user upload, preserving formatting* — not *fill a template*. That rules out docxtemplater/docx-templates (they require `{placeholder}` tags in the source document) and the `docx` generator (it rebuilds documents, losing user formatting). The reliable approach: unzip with jszip → locate text runs (`<w:t>`) in `document.xml` → apply approved keyword replacements at run level → rezip. mammoth is used only for on-screen preview, never as the edit path (its HTML round-trip loses formatting).

**DOCX → PDF (the hardest free-tier problem):** No LibreOffice/Chromium runs inside Deno edge functions. Recommended: **CloudConvert API free tier** (~25 conversion-minutes/day — dozens of resume conversions, far more than 2 users need) called from an edge function: upload tailored DOCX → receive PDF → store in Supabase Storage. Zero-cost fallback: render the mammoth HTML preview with print CSS and use the browser's print-to-PDF (lower fidelity, acceptable as backup). Do **not** plan on self-hosting Gotenberg — it needs an always-on Docker host, which violates the near-zero-cost constraint.

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Supabase CLI | Local dev (DB, auth, edge functions), migrations, `supabase functions deploy` | `supabase start` runs the whole stack locally in Docker |
| Wrangler / CF dashboard Git integration | Deploy SPA to Cloudflare Pages | Git-push deploys; 500 builds/mo free is ample |
| Deno | Edge function runtime + local testing | Pin the version Supabase currently runs |
| Vitest | Unit tests (scoring filters, dedup logic) | Vite-native |

## Installation

```bash
# Frontend (in /web)
npm create vite@latest web -- --template react-ts
npm install @supabase/supabase-js @tanstack/react-query react-router
npm install -D tailwindcss vitest

# Resume processing (used client-side and/or bundled into edge functions)
npm install mammoth jszip fast-xml-parser

# Edge functions: imports via JSR/npm specifiers in Deno, no npm install
# e.g. import * as webpush from "jsr:@negrel/webpush";
#      import { createClient } from "npm:@supabase/supabase-js@2";

# Supabase CLI
brew install supabase/tap/supabase
```

## Free-Tier Limits That Matter (verified against official pages, 2026-07)

| Platform | Limit | Impact on this project |
|----------|-------|------------------------|
| Supabase Free | 500 MB database | Fine — prune job rows older than ~30 days to stay small |
| Supabase Free | 1 GB storage | Fine for resumes (DOCX/PDF are ~100 KB each) |
| Supabase Free | 500K edge invocations/mo | A `*/5 min` pipeline = ~8.6K invocations/mo per function — huge headroom |
| Supabase Free | 5 GB egress/mo | Watch this one: outbound polling responses count; keep `content=true` fetches lean and dedupe early |
| Supabase Free | **Project pauses after 1 week of inactivity** | Biggest operational risk to the 5–15 min goal. Daily use by 2 users mitigates it; still, treat "project paused" as a failure mode (Cloudflare health-check cron pinging a Supabase endpoint is a cheap guard) |
| Supabase Free | 2 active projects, no custom SMTP | Auth emails come from Supabase's shared sender; fine for 2 invited users |
| Supabase Edge Functions | Wall-clock cap per invocation (~150 s on free — MEDIUM confidence, verify) | Shard the 100-company watchlist across ticks rather than one long run |
| Cloudflare Pages Free | 500 builds/mo, 20K files, 25 MiB/asset, unlimited bandwidth | No practical constraint |
| Cloudflare Workers Free (if Pages Functions used) | 100K requests/day | Not needed — all backend lives in Supabase |
| Resend Free | **100/day, 3,000/mo**, 1 domain | Daily cap is the binding one; batch job matches into digest emails rather than 1 email per job |
| Adzuna Free | ~25 req/min, 250 req/day | Discovery sweeps only (watchlist uses free ATS endpoints) |
| Gemini API Free tier | Exists with rate limits; **free-tier content may be used to improve Google products** | For job-description scoring: free tier fine. For anything containing the user's resume text: **use the paid tier** (still <$1/mo) to avoid sending personal data under free-tier data terms |
| CloudConvert Free | ~25 conversion-min/day | Dozens of DOCX→PDF conversions/day — ample |

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| React + Vite SPA | SvelteKit + CF adapter | If you prefer Svelte; equally well supported on Pages. Not Next.js — its CF Pages support is incomplete |
| Gemini 2.5 Flash-Lite | GPT-5 nano (~$0.05/$0.40) | If you already have OpenAI credits; no free tier though |
| Gemini 2.5 Flash-Lite | Claude Haiku 4.5 ($1/$5) | If scoring quality proves insufficient — 10× the cost but stronger reasoning |
| Adzuna | Jooble (free key on request) | If Adzuna coverage is weak in your target market |
| CloudConvert DOCX→PDF | Browser print-to-PDF from mammoth HTML | If CloudConvert's free quota or account requirement becomes a problem; accept fidelity loss |
| jszip + XML run editing | `docx` (dolanmiu) patcher | Only if you switch to a "template resume" model where users add placeholders |
| pg_cron + pg_net | External cron (GitHub Actions schedule, cron-job.org) | GitHub Actions cron is unreliable (±15 min drift) — fails the 5–15 min goal; use only as a dead-man's-switch monitor |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Next.js on Cloudflare Pages | Partial support, server-feature friction; SSR is pointless for a 2-user private dashboard | React + Vite SPA |
| Node `web-push` package | Node-API assumptions; doesn't target Deno edge runtime | `@negrel/webpush` (JSR) |
| docxtemplater / docx-templates for tailoring | Require `{tags}` embedded in the source doc — users upload arbitrary resumes | jszip + `document.xml` run-level edits |
| mammoth as the edit/save path | DOCX→HTML→DOCX round-trip destroys formatting | mammoth for preview only |
| Self-hosted Gotenberg / LibreOffice | Needs an always-on container host — no genuinely free option | CloudConvert free tier or browser print CSS |
| Puppeteer/Chromium inside Supabase Edge Functions | Chromium doesn't run in the Deno edge sandbox | Browser-side print, or CloudConvert |
| JSearch (RapidAPI) as the aggregator | Free quota too small for continuous polling | Adzuna (250 req/day free) |
| LinkedIn scraping of any logged-in surface | Policy violation; explicitly out of scope | ATS endpoints + Adzuna |
| Per-job notification emails | Blows the 100/day Resend cap during job-posting bursts | Push per match; email as batched digest/backup |
| Gemini **free tier** for resume-content calls | Free-tier inputs may be used to improve Google products — resumes are personal data | Gemini paid tier (cost is negligible) |

## Stack Patterns by Variant

**If the watchlist grows past ~150 companies:**
- Shard polling round-robin across minutes (pg_cron every 1 min, each tick polls a slice) instead of one 5-min tick polling everything
- Because edge functions have a per-invocation wall-clock cap and you want per-company failures isolated.

**If push notifications prove unreliable on a sleeping laptop:**
- Lean on the email path with a tighter digest cadence (e.g., every 15 min when new matches exist)
- Because desktop push only meets the 5–15 min goal while the browser/OS is awake; email is the safety net by design.

**If AI scoring quality on Flash-Lite disappoints:**
- Two-stage: Flash-Lite for pass/fail triage, then Gemini 2.5 Flash (or Haiku 4.5) only on the top handful
- Because survivors after cheap filters are already few; a pricier model on 5 jobs/day is still ~free.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@supabase/supabase-js@2` | Deno edge functions | Import as `npm:@supabase/supabase-js@2` in edge code; same API as browser |
| Tailwind 4 | Vite 7 | Uses the first-party `@tailwindcss/vite` plugin — no PostCSS config needed |
| `@negrel/webpush` | Deno / Supabase Edge | JSR import; not for the browser side (browser uses native `PushManager`) |
| jszip 3.x | Browser + Deno | Works in both; you can run tailoring edits client-side or in an edge function |
| pg_cron | Supabase hosted Postgres | Enable via Dashboard → Integrations; pair with pg_net + Vault for authed HTTP calls |
| React 19 | react-router 7, TanStack Query 5 | All current-major; pin at install time |

## Sources

- [Supabase — Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions) — pg_cron + pg_net + Vault pattern, 1-min granularity (official, verified)
- [Supabase Pricing](https://supabase.com/pricing) — Free plan limits: 500MB DB, 1GB storage, 500K invocations, 5GB egress, 1-week pause (official, verified)
- [Cloudflare Pages Limits](https://developers.cloudflare.com/pages/platform/limits/) — 500 builds/mo, 20K files, Functions on free plan (official, verified)
- [Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing) — Flash-Lite $0.10/$0.40, free tier exists (official, verified)
- [Resend — quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits) + pricing/blog — 100/day, 3,000/mo free (official via search, MEDIUM-HIGH)
- claude-api skill (bundled, cached 2026-06) — Claude Haiku 4.5 $1/$5 per MTok (HIGH)
- [Adzuna developer portal](https://developer.adzuna.com/) + directory sources — free tier ~250 req/day (MEDIUM)
- ATS endpoint survey — [Cavuno](https://cavuno.com/blog/ats-platforms-public-job-posting-apis) / [fantastic.jobs](https://fantastic.jobs/article/ats-with-api): Greenhouse/Lever/Ashby public JSON shapes (MEDIUM — cross-checked across two sources; verify one live call per ATS in phase 1)
- [@negrel/webpush](https://github.com/negrel/webpush) — Deno web push, RFC 8291/8292 (MEDIUM; JSR page 403'd, confirm latest version at install)
- [CloudConvert pricing](https://cloudconvert.com/pricing) — ~25 free conversion-min/day (MEDIUM)
- npm-compare + library READMEs — mammoth/docxtemplater/docx/jszip roles (MEDIUM)

---
*Stack research for: job-discovery + AI resume-tailoring web app*
*Researched: 2026-07-15*

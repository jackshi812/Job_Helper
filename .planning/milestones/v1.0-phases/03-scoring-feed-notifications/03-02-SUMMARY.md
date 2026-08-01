---
phase: 03-scoring-feed-notifications
plan: 02
subsystem: api
tags: [openai, responses-api, structured-outputs, docx, mammoth, jszip, skip-locked, edge-functions, resume-extraction]

requires:
  - phase: 01-foundation-access
    provides: "resumes table (0002), resumes storage bucket (0003), delete_my_data pattern (0004)"
  - phase: 03-scoring-feed-notifications (Plan 01)
    provides: "preferences table (0017), cheap-filter module — extraction feeds the same per-user pipeline"
provides:
  - "supabase/functions/_shared/openai.ts — stateless OpenAI Responses wrapper (generateStructured, OPENAI_SCORING_MODEL, OPENAI_FALLBACK_MODEL, OpenAIUsage); store:false, reasoning none, strict Structured Outputs"
  - "supabase/functions/_shared/docx.ts — magic-byte detectFormat + bounded extractDocxText (mammoth primary, jszip regex fallback) with zip-bomb/size guards"
  - "supabase/functions/extract-resume/index.ts — SKIP LOCKED claim worker caching resume text + routing keywords per DOCX resume"
  - "supabase/migrations/0018_resume_extracts.sql — resume_extracts + ai_usage tables, claim_resume_extractions RPC, extract-resume cron (LOCAL FILE ONLY, not pushed)"
  - "scripts/verify-openai.ts — live strict Structured Outputs smoke script"
  - "Proven-live OpenAI provider contract (gpt-5.4-nano, /v1/responses, store:false) for all downstream Phase 3 AI calls"
affects:
  - "Plan 03 (score-tick consumes resume_extracts keywords for D-06 routing + text for D-08 scoring; adds mark_user_jobs_for_reroute RPC in 0019)"
  - "Plan 07 (pushes 0018 to hosted DB, deploys extract-resume edge fn, sets OPENAI_API_KEY edge secret, proves hosted execution)"

tech-stack:
  added:
    - "OpenAI Responses API (gpt-5.4-nano) via plain fetch — no SDK"
    - "npm:mammoth@1.12.0 (DOCX primary text extraction, dynamic import)"
    - "npm:jszip@3.10.1 (DOCX fallback extraction, dynamic import)"
  patterns:
    - "Stateless provider wrapper with apiKey as a parameter (not a runtime global) so Node verify scripts + Deno edge share identical request shaping"
    - "SKIP LOCKED claim RPC that seeds a pending row then claims (Codex F-extract-claim) — exclusive ownership before any paid API call"
    - "Magic-byte format detection (never filename) + pre-read zip-bomb guards on untrusted archives"
    - "Committing-write ordering: status='ready' is the last fatal write; post-ready accounting/reroute are best-effort to protect exactly-once/no-double-bill"

key-files:
  created:
    - supabase/functions/_shared/openai.ts
    - supabase/functions/_shared/docx.ts
    - supabase/functions/extract-resume/index.ts
    - supabase/migrations/0018_resume_extracts.sql
    - scripts/verify-openai.ts
  modified: []

key-decisions:
  - "D-11/D-12: OpenAI Responses API only, store:false, reasoning.effort none, strict Structured Outputs, no temperature field; model gpt-5.4-nano encoded as OPENAI_SCORING_MODEL, gpt-5.6-luna as configuration-only OPENAI_FALLBACK_MODEL (never auto-called, D-13)"
  - "Exactly-once extraction via claim_resume_extractions SKIP LOCKED: seeds a pending row per resume, claims attempts<3 with 5-min stale reclaim, so overlapping crons never double-bill OpenAI (Codex F-extract-claim, T-3-08a)"
  - "resume_extracts.resume_id FK on delete cascade (+ user_id on delete cascade) so extraction data dies with the resume (AUTH-04); ai_usage service-role only, token counts never prompt content (ASVS V7, T-3-05)"
  - "Post-'ready' ai_usage insert and mark_user_jobs_for_reroute made non-fatal to prevent re-billing on reclaim (correctness hardening of the exactly-once invariant)"

patterns-established:
  - "OpenAI wrapper: bounded openai_http_${status}/openai_refusal/openai_incomplete/openai_invalid_output codes; 429/5xx retry x2 (1s/4s); zero prompt/response logging"
  - "Resume extraction worker: claim -> download -> magic-byte detect -> mammoth/jszip -> generateStructured keywords -> cache; PDF/unknown honestly marked unsupported_format"

requirements-completed: [RESU-01, SCOR-02]

coverage:
  - id: D1
    description: "Live OpenAI strict Structured Outputs smoke call against POST /v1/responses with store:false succeeds before any scoring code"
    requirement: "SCOR-02"
    verification:
      - kind: integration
        ref: "node --env-file=scripts/.env scripts/verify-openai.ts (exit 0; input=100 output=45 reasoning=0 tokens)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Shared OpenAI Responses wrapper: store:false, reasoning none, strict json_schema, no temperature, bounded codes, no content logging"
    requirement: "SCOR-02"
    verification:
      - kind: other
        ref: "grep acceptance: /v1/responses + store:false + reasoning effort none + type json_schema + strict true present; temperature absent; zero console statements"
        status: pass
      - kind: integration
        ref: "web build + 322 vitest tests green (openai.ts type-checks and does not regress suite)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Bounded DOCX extraction: magic-byte detectFormat + mammoth primary + jszip fallback with entry-count/uncompressed/xml/char guards"
    requirement: "RESU-01"
    verification:
      - kind: other
        ref: "grep acceptance: npm:mammoth@1.12.0 + npm:jszip@3.10.1 + detectFormat export + MAX_ZIP_ENTRIES/MAX_UNCOMPRESSED_BYTES/MAX_DOCUMENT_XML_BYTES/MAX_EXTRACT_CHARS bounds"
        status: pass
    human_judgment: true
    rationale: "Runtime DOCX extraction (mammoth-in-Deno, Pitfall 7) and zip-bomb guard behavior execute only on the hosted edge runtime with real resume bytes; no local Deno runtime here proved the extraction path end-to-end (deferred to Plan 07 hosted deploy)."
  - id: D4
    description: "resume_extracts + ai_usage schema, claim_resume_extractions SKIP LOCKED RPC (no double-bill), extract-resume cron; FK cascade preserves AUTH-04"
    requirement: "SCOR-02"
    verification:
      - kind: other
        ref: "grep acceptance: on delete cascade + 'claimed' status + claimed_at + for update skip locked + service_role-only grant + /functions/v1/extract-resume cron + ai_usage no authenticated grants"
        status: pass
    human_judgment: true
    rationale: "Migration 0018 is a LOCAL FILE ONLY (safety boundary — not pushed). Atomic SKIP LOCKED claim semantics and cascade deletion are verifiable only after hosted db push in Plan 07."
  - id: D5
    description: "extract-resume worker: claim-based (not raw scan), batch cap 3, magic-byte gate, keyword extraction via generateStructured, mark_user_jobs_for_reroute on 'ready' (F2, guarded)"
    requirement: "SCOR-02"
    verification:
      - kind: other
        ref: "grep acceptance: rpc('claim_resume_extractions') + CLAIM_BATCH_SIZE=3 + detectFormat gate + mark_user_jobs_for_reroute guarded + console logs only bounded codes/UUIDs/counters"
        status: pass
    human_judgment: true
    rationale: "Full claim->download->extract->score->cache->reroute flow runs only on the hosted edge runtime (needs storage bytes, OPENAI_API_KEY edge secret, and Plan 03's 0019 reroute RPC). Deferred to Plan 07."

duration: 20min
completed: 2026-07-18
status: complete
---

# Phase 3 Plan 02: Resume Extraction & OpenAI Responses Wrapper Summary

**One-time cached DOCX resume extraction (full text + routing keywords) via a SKIP-LOCKED claim worker calling gpt-5.4-nano through the OpenAI Responses API (store:false, strict Structured Outputs) — proven live before any scoring code.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 3 (Task 1 checkpoint pre-satisfied; Tasks 2–3 auto)
- **Files created:** 5
- **Files modified:** 0

## Human Checkpoint (Task 1) — recorded

The OpenAI API key provisioning checkpoint was already satisfied and approval was granted for exactly one live paid smoke call:

- `scripts/.env` contains an `OPENAI_API_KEY` line — confirmed present.
- `git check-ignore scripts/.env` → **ignored** (secret never enters git).
- Key is **project-scoped** (`sk-proj-…`), length 164, **last four `TWsA`**. Full key never read, printed, or recorded. (Operator did not surface a separate project id/name; the `sk-proj` prefix confirms a project-scoped API key on an API-billed project.)
- Implementation sends `store:false` on every call; `store:false` is **not** Zero Data Retention — OpenAI default abuse-monitoring logs may retain content up to 30 days, so no resume/JD text is ever logged or persisted in `ai_usage`.

## Live OpenAI Smoke Call — evidence & spend (the approved single invocation)

`node --env-file=scripts/.env scripts/verify-openai.ts` — **exit 0**, run exactly once:

```
verify-openai: OK — strict Structured Outputs call succeeded
  model:            gpt-5.4-nano
  input_tokens:     100
  output_tokens:    45
  reasoning_tokens: 0
```

- **Endpoint:** `POST https://api.openai.com/v1/responses`, `store:false`, `reasoning.effort:'none'`, strict `text.format` json_schema (`additionalProperties:false` at every object level), no `temperature`.
- **Assertion:** returned schema-valid JSON with `score === 42` and exactly three non-empty string reasons.
- **Spend:** 100 input + 45 output tokens on gpt-5.4-nano ($0.20 / $1.25 per 1M) ≈ **$0.000076** (~8 hundred-thousandths of a dollar). This is the only paid/external invocation made.

## Must-Have Verification

| Must-have | Evidence |
|-----------|----------|
| Exactly-once cached extraction, work claimed atomically via SKIP LOCKED (no double-bill) — D-06/D-11/D-12, Codex F-extract-claim | `claim_resume_extractions(batch_size default 3)`: seeds a pending row per resume lacking one, then `for update skip locked` claim of `status in (pending,claimed,failed) and attempts<3 and (claimed_at is null or claimed_at < now()-5min)`, setting `status='claimed'`, `claimed_at=now()`, `attempts+1`. Worker claims via `rpc('claim_resume_extractions')` (not a scan), cap 3/tick; `status='ready'` is the committing write and post-ready writes are non-fatal so a hiccup cannot flip back to failed and re-bill |
| On 'ready', owner's recent user_jobs flagged for reroute (F2) | `extract-resume/index.ts` calls `admin.rpc('mark_user_jobs_for_reroute', { p_user_id: row.user_id })` immediately after the ready update, wrapped in try/catch logging only `reroute_signal_failed` (RPC ships in Plan 03's 0019; guard tolerates its absence in isolated wave-1 runs) |
| Extraction FK-cascades on resume delete (AUTH-04) | `resume_id uuid primary key references public.resumes (id) on delete cascade` + `user_id ... references auth.users (id) on delete cascade` |
| Live OpenAI strict Structured Outputs smoke succeeded before scoring code | verify-openai.ts exit 0, token evidence above; committed in `e325d25` before any extraction code |
| Files + exports exactly as plan frontmatter | openai.ts (`generateStructured`, `OPENAI_SCORING_MODEL`, `OPENAI_FALLBACK_MODEL`, `OpenAIUsage`); docx.ts (`extractDocxText`, `detectFormat` + size constants); extract-resume/index.ts (`claim_resume_extractions`); 0018 migration; scripts/verify-openai.ts — all present |
| ASVS V7: zero resume text / prompt / response in logs or ai_usage | openai.ts has zero console statements; extract-resume logs only bounded codes, row UUIDs, counters; ai_usage stores token counts + model only |

## Task Commits

1. **Task 2: OpenAI Responses wrapper + live smoke test** — `e325d25` (feat)
2. **Task 3: resume_extracts + ai_usage migration and extract-resume worker** — `5813124` (feat)

_(Task 1 was a human-action checkpoint already satisfied — no code commit.)_

## Files Created

- `supabase/functions/_shared/openai.ts` — stateless `generateStructured()` Responses wrapper; store:false, reasoning none, strict json_schema, no temperature; 429/5xx retry x2 (1s/4s); bounded `openai_*` codes; no content logging; model constants (D-12/D-13).
- `scripts/verify-openai.ts` — Node smoke script importing openai.ts directly; asserts score 42 + 3 reasons; prints token counts only.
- `supabase/migrations/0018_resume_extracts.sql` — `resume_extracts` (own-row RLS, cascade), `ai_usage` (service-role only), `claim_resume_extractions` SKIP LOCKED RPC, `extract-resume-every-minute` cron. **Local file only — not pushed.**
- `supabase/functions/_shared/docx.ts` — `detectFormat` (magic bytes), `extractDocxText` (mammoth primary + jszip `<w:t>` regex fallback) with entry-count / uncompressed / document.xml / MAX_EXTRACT_CHARS guards.
- `supabase/functions/extract-resume/index.ts` — POST-only, x-cron-secret gated, service-role claim worker; DOCX→keywords, PDF/unknown→unsupported_format, ai_usage accounting, guarded reroute signal, bounded error codes.

## Local Gate Results

- `cd web && npm run build` (tsc -b + vite) — **green** (only the pre-existing >500 kB chunk advisory, not introduced here).
- `cd web && npx vitest run` — **24 files, 322 tests passed** (unchanged from Plan 01 baseline; no regressions).
- `cd web && npm run lint` (oxlint) — **green**; sole warning is the pre-existing `AuthProvider.tsx:120` (out of scope, untouched).

## Decisions Made

- **OpenAI intent over leftover Gemini wording.** The plan's supporting docs (03-RESEARCH.md Pattern 1, the architecture diagram) still contain historical Gemini `generateContent`/`responseSchema` code, explicitly marked **superseded** by the 2026-07-19 provider revision. The revised plan frontmatter `files_modified` lists `_shared/openai.ts`, so the wrapper was built for OpenAI (model gpt-5.4-nano, Responses API, strict Structured Outputs, store:false) with no Gemini endpoints, `responseSchema`, or `GEMINI_*` env names anywhere. See Deviations for the specific discrepancy.
- **Committing-write ordering to protect no-double-bill.** `status='ready'` (with text/keywords/model) is the last fatal write; the `ai_usage` insert and `mark_user_jobs_for_reroute` are best-effort afterward. This guarantees that a post-extraction accounting/reroute failure cannot flip the row back to `failed` and cause the reclaim path to re-invoke (and re-bill) OpenAI.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Correctness] Post-'ready' accounting/reroute made non-fatal**
- **Found during:** Task 3 (extract-resume worker)
- **Issue:** The plan lists "update row to 'ready' … and insert an ai_usage row" then "call mark_user_jobs_for_reroute". A literal sequential read where the ai_usage insert or reroute throws after billing would flip the row back to `failed`, and the claim RPC (attempts<3, stale reclaim) would then re-extract and **re-bill** OpenAI — violating the exactly-once/no-double-bill must-have.
- **Fix:** Ordered `status='ready'` as the final fatal write; `ai_usage` insert and `mark_user_jobs_for_reroute` are best-effort (log bounded `ai_usage_write_failed` / `reroute_signal_failed` only, never throw).
- **Files modified:** supabase/functions/extract-resume/index.ts
- **Verification:** Code review of write ordering; build + 322 tests green.
- **Committed in:** `5813124`

**2. [Rule 3 - Blocking] Reworded openai.ts comment to satisfy the literal "no temperature" acceptance grep**
- **Found during:** Task 2 (acceptance-criteria gate)
- **Issue:** Acceptance criterion "openai.ts … contains no `temperature`" is a literal text check; an explanatory comment ("No temperature is sent…") tripped it even though no `temperature` field is ever built into the request.
- **Fix:** Reworded the comment to "Sampling parameters are omitted for this reasoning model (none is sent)." No behavioral change. (Same class of fix as Plan 01's Deno-substring rewording.)
- **Files modified:** supabase/functions/_shared/openai.ts
- **Verification:** `grep temperature` on the file → no match; smoke call still sends no sampling params and succeeds.
- **Committed in:** `e325d25`

**3. [Rule 2 - Consistency] Added `resume_extracts_user_id_idx`**
- **Found during:** Task 3 (migration)
- **Issue:** The own-row select RLS policy filters on `user_id`; the 0002_resumes house style indexes `user_id`.
- **Fix:** Added `create index resume_extracts_user_id_idx on public.resume_extracts using btree (user_id)`.
- **Files modified:** supabase/migrations/0018_resume_extracts.sql
- **Verification:** Migration structure review against 0002 analog.
- **Committed in:** `5813124`

---

**Total deviations:** 3 auto-fixed (2 correctness/consistency, 1 blocking-textual)
**Impact on plan:** No scope change. All three protect a must-have (no double-bill), satisfy an acceptance gate, or match established house style.

## Discrepancy Note (Gemini→OpenAI revision)

Per the execution directive, leftover Gemini wording in the phase's supporting research was resolved toward OpenAI intent:
- **03-RESEARCH.md "Pattern 1"** and the **architecture diagram** still show Gemini `generateContent` + `responseSchema` + `GEMINI_API_KEY`. These are explicitly flagged "superseded" by the file's own 2026-07-19 revision header. No Gemini code, endpoint, `responseSchema` field name, or `GEMINI_*` env name was introduced. The wrapper file is named `openai.ts` (matching the revised plan `files_modified`), not `gemini.ts`.
- The OpenAI implementation uses `text.format` json_schema + `strict:true` (Responses API) — not Gemini's `generationConfig.responseSchema`.

## Safety Boundary Compliance

- Migration written as a **FILE ONLY** at the pinned path `0018_resume_extracts.sql` (exact number 0018); no hosted push, no schema apply, no `supabase db push`, no edge-function deploy.
- Exactly **one** paid OpenAI call made (the approved smoke test); it succeeded on the first try — no retries, no loops, no counter mutation. No other hosted mutation or external invocation.
- Did not modify `poll-tick`, `lifecycle.ts`, `connectors.ts`, `_shared/adapters/*`, or migrations 0012–0016. Patterns were copied, never edited.
- Did not stage/commit `.DS_Store`, `scripts/agent-dashboard.mjs`, `scripts/agent-dashboard.test.mjs` (left untracked/unstaged), and did not edit `STATE.md`.
- Job identity preserved: this plan only adds per-resume extraction rows; it does not mutate any `jobs`/`user_jobs` identity. DOCX parsing is bounded (magic-byte detect + zip-bomb/size guards) — no unbounded reads.

## Issues Encountered

None. The single approved smoke call succeeded on the first attempt; the local gate was green on first run.

## Next Phase Readiness

- **Ready for Plan 03 (scoring/feed):** `resume_extracts.keywords` (D-06 routing) and `resume_extracts.text_content` (D-08 full-text scoring) are available per DOCX resume once extraction runs; `generateStructured` is the proven-live scoring transport.
- **Plan 03 owes:** the `mark_user_jobs_for_reroute` RPC in migration 0019 (this worker already calls it, guarded).
- **Plan 07 owes (deferred hosted proof):** push 0018, deploy `extract-resume`, set `OPENAI_API_KEY` as an edge secret, and prove hosted execution + cross-user RLS denial. Coverage entries D3/D4/D5 are `human_judgment: true` precisely because their runtime behavior can only be observed on the hosted edge runtime.

## Self-Check: PASSED

All 5 created artifacts exist on disk (openai.ts, verify-openai.ts, 0018_resume_extracts.sql, docx.ts, extract-resume/index.ts) plus the SUMMARY; both task commits (`e325d25`, `5813124`) present in git log.

---
*Phase: 03-scoring-feed-notifications*
*Completed: 2026-07-18*

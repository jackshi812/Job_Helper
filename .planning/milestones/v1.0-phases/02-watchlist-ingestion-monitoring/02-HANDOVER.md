# Phase 2 Handover — Execution (Codex)

**Prepared:** 2026-07-16
**From:** Claude Code planning session (plan-phase 2 complete)
**To:** Codex runtime (GSD installed at `~/.codex/gsd-core`, skill `gsd-execute-phase` present)

## State at handover

- Phase 2 (Watchlist Ingestion & Monitoring) fully planned and verified. Status in STATE.md: Ready to execute, 3 plans.
- Plans committed through `d4f9b76`. Working tree clean (only `.DS_Store` noise).
- Plan checker: VERIFICATION PASSED after 1 revision iteration (blocker: PREF-02 "edit" → documented remove+re-add equivalence; warning: browser-tier `detectAts` precheck added to Plan 01 Task 3).
- All coverage gates green: 9/9 REQ-IDs, 8/8 CONTEXT decisions, 17/17 gap-analysis items.

## Execute

```
/gsd-execute-phase 2
```

Waves are sequential (data dependency): 02-01 → 02-02 → 02-03.

## Things the executor must know (not obvious from a single plan file)

1. **[BLOCKING] schema push tasks.** Each plan's Task 2 ends with `npx supabase db push` (run from `web/`, set `SUPABASE_ACCESS_TOKEN` if non-TTY prompt blocks). Build/typecheck pass WITHOUT the push — do not treat green builds as proof the migration landed. Confirm with `npx supabase migration list --linked`.
2. **Cron auth deviation (intentional, documented).** RESEARCH Pattern 7 shows Vault JWT bearer auth; plans instead use `verify_jwt = false` + in-function `x-cron-secret` header check, because Phase 1 adopted the new publishable/secret key system (keys are not JWTs). Keep the SQL comment recording this in migration 0006. Do not "fix" back to JWT.
3. **Pinned versions — do not bump.** `npm:@supabase/supabase-js@2.110.7` (exact pin, package-legitimacy audit) and `npm:he@1.2.0`. Pure modules (`_shared/dedup.ts`, `_shared/adapters/types.ts`, mappers) must stay free of `npm:` specifiers so Vitest in `web/` can import them cross-directory.
4. **user_setup (human steps — surface, don't skip):**
   - Plan 02-02: two Supabase Vault secrets via Dashboard SQL editor (`project_url`, `cron_secret`); same `CRON_SECRET` value into `supabase secrets set` and gitignored `scripts/.env`. Pipeline no-ops until done.
   - Plan 02-03: Adzuna app_id/app_key signup + cron-job.org dead-man monitor. Task 3 is `checkpoint:human-action`, `autonomous: false` — stop and wait.
5. **Stale-close safety.** Closing jobs happens ONLY in a company's per-poll success path with the implausible-empty guard (non-empty poll result for a company that had open jobs). A failed poll must never close anything (DISC-05).
6. **PREF-02 "edit" is remove+re-add by design.** Documented in 02-01 must_haves + success_criteria. Do not add an edit UI; UI-SPEC has no edit affordance intentionally.
7. **Cross-root import risk (checker note).** `web/src/lib/watchlist.ts` imports `../../../supabase/functions/_shared/detect` — may hit tsconfig `rootDir` boundary in `tsc -b`. Precedent exists (web/tests → ../../scripts). If build breaks, fix within Plan 01 Task 3 scope (e.g., include path in tsconfig), don't move the module.
8. **Compliance rails (project CLAUDE.md).** Free tiers only; no LinkedIn scraping surfaces; Adzuna budget guard 240 req/day cutoff; job rows pruned/aged per 30-day guidance.

## Key artifacts

| File | Role |
|------|------|
| `.planning/phases/02-watchlist-ingestion-monitoring/02-0{1,2,3}-PLAN.md` | Execution contracts (tasks, acceptance criteria, threat models) |
| `02-CONTEXT.md` | Locked decisions D-01..D-08 |
| `02-RESEARCH.md` | Live-verified ATS field tables (fixture source of truth), Patterns 1–7, Pitfalls 1–8 |
| `02-PATTERNS.md` | Analog files + excerpts (resumes.ts/Resumes.tsx pair is the Watchlist template) |
| `02-UI-SPEC.md` | UI design contract (dense table, badges, D-15 markup) |

## Verification commands (per plan)

- 02-01: `cd web && npm test && npm run build`, `node --env-file=scripts/.env scripts/verify-watchlist.ts`
- 02-02: `cd web && npm test`, `npx supabase migration list --linked`, `node --env-file=scripts/.env scripts/verify-pipeline.ts` (8 probes)
- 02-03: per-plan verify blocks + cron-job.org intentional-stale test

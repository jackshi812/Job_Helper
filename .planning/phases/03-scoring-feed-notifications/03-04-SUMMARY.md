---
phase: 03-scoring-feed-notifications
plan: 04
subsystem: feed-and-detail
tags: [feed, job-detail, dompurify, xss-boundary, per-user-state, tanstack-query, dense-table]
status: complete

requires:
  - phase: 03-scoring-feed-notifications (Plan 03)
    provides: "user_jobs table (0019) with score/tier/reasons/gaps/covered/routed_resume_id + seen_at/dismissed_at, own-row RLS, column-limited (seen_at,dismissed_at) update grant"
  - phase: 01-foundation-access
    provides: "resumes table + listResumes (routed-resume filename chips)"
provides:
  - "web/src/lib/feed.ts — user_jobs ⋈ jobs ⋈ companies queries (listFeed/getFeedJob), tier/filter/visibility/company/posted-time mappers, seen/dismiss/undismiss mutations, safeApplyUrl https guard"
  - "web/src/pages/Dashboard.tsx — dense newest-first match feed (SCOR-04, D-14..D-16) replacing the stub"
  - "web/src/pages/JobDetail.tsx + /jobs/:id route — sanitized JD snapshot + categorized keyword-gap panel (SCOR-05, D-17)"
  - "dompurify@3.4.12 exact pin (the single new frontend dependency)"
affects:
  - "Plan 07 (hosted UAT of the feed/detail visuals against real scored data; sanitizer adversarial fixtures deferred here)"
  - "Phase 4 tailoring (consumes the gap panel data surfaced by JobDetail)"

tech-stack:
  added:
    - "dompurify@3.4.12 (exact pin; cure53, 48.2M weekly downloads, no install/postinstall script)"
  patterns:
    - "Split column sets (FEED_LIST_COLUMNS vs FEED_DETAIL_COLUMNS) so list rows never fetch untrusted JD bodies — bandwidth + XSS surface reduction"
    - "Company name pulled through jobs.company_id → companies(name) PostgREST embedding (no denormalized column exists — Codex F5)"
    - "XSS boundary: description_html reaches the DOM only through DOMPurify.sanitize(FORBID_TAGS ['style','form']); a single dangerouslySetInnerHTML in the whole surface; reasons/gap chips rendered as plain text"
    - "Conditional markSeen (.is('seen_at', null)) so a detail re-mount never rewrites the seen timestamp; New badge clears once, per-user (D-16)"
    - "Optimistic dismiss/restore via TanStack onMutate cache patch + onError rollback + onSettled invalidate"

key-files:
  created:
    - web/src/lib/feed.ts
    - web/src/lib/feed.test.ts
    - web/src/pages/JobDetail.tsx
  modified:
    - web/package.json
    - web/package-lock.json
    - web/src/pages/Dashboard.tsx
    - web/src/main.tsx

key-decisions:
  - "Embedded jobs/companies kept unaliased (keys `jobs`, `companies`) so the newest-first ordering `.order('posted_at', { foreignTable: 'jobs' })` in the plan contract stays internally consistent (aliasing would desync the foreignTable name); mappers (companyName/relativePostedTime) hide the shape from components"
  - "tierPresentation derives the tier from the clamped score (Strong ≥75 emerald, Good 50–74 neutral, Weak <50 plain zinc-500, null → Weak) rather than trusting the stored tier column — matches D-07 and the UI-SPEC no-fill Weak rule"
  - "Package-legitimacy blocking-human gate (Task 1) satisfied by substantive npm-registry verification (maintainer cure53, 48.2M weekly downloads, version 3.4.12 present, sha512 integrity, no install/postinstall lifecycle script) combined with the orchestrator's explicit prior-decision pre-approval of the exact pin — not self-approved on heuristic alone"

requirements: [SCOR-04, SCOR-05]

coverage:
  - id: F1
    description: "Dense newest-first match feed with New badge, title link, company, score+tier, first reason, best-fit resume chip, relative posted-time, Apply, Dismiss; score-sortable header (SCOR-04, D-14)"
    requirement: "SCOR-04"
    verification:
      - kind: other
        ref: "grep: Dashboard.tsx All-jobs/Show-dismissed toggles, aria-sort={scoreAriaSort} on the score <th> button, aria-label Dismiss/Restore; npm run build green; full vitest 348 green"
        status: pass
    human_judgment: true
    rationale: "Visual density, sort affordance clarity, and real-data layout are judgment properties verified against hosted scored data in Plan 07 (no local scored rows exist)."
  - id: F2
    description: "Default view Strong+Good only; Weak + filtered rows behind All-jobs toggle; dismissed behind Show-dismissed (D-15, D-16)"
    requirement: "SCOR-04"
    verification:
      - kind: tests
        ref: "web/src/lib/feed.test.ts defaultVisible cases (scored≥50 visible; Weak<50, filtered, dismissed hidden); Dashboard row filter derives from defaultVisible + viewAll + showDismissed"
        status: pass
    human_judgment: false
  - id: F3
    description: "Job detail renders full JD snapshot ONLY through DOMPurify.sanitize + categorized keyword-gap panel + covered list vs routed resume (SCOR-05, D-17)"
    requirement: "SCOR-05"
    verification:
      - kind: other
        ref: "grep: JobDetail.tsx exactly one dangerouslySetInnerHTML wrapping DOMPurify.sanitize(FORBID_TAGS ['style','form']); <pre> fallback; GapPanel skills/tools/certs/domain + emerald covered chips"
        status: pass
    human_judgment: true
    rationale: "Adversarial sanitizer behavior (script/onerror/javascript:/SVG/mutation-XSS) is DEFERRED to Plan 07 UAT per Codex disposition; the structural single-sanitized-path invariant is asserted here, gap-panel rendering against real gaps is human-verified hosted."
  - id: F4
    description: "Per-user seen/dismiss isolation — one user's state never affects the other (D-16)"
    requirement: "SCOR-04"
    verification:
      - kind: other
        ref: "feed.ts mutations update only user_jobs seen_at/dismissed_at (the sole grant-writable columns, Plan 03); RLS own-row scoping; markSeen conditional .is('seen_at', null)"
        status: pass
    human_judgment: true
    rationale: "Cross-user RLS denial is enforced by the Plan 03 migration and observable only on the hosted DB with two authenticated users (Plan 07)."

duration: 6 min
completed: 2026-07-19
---

# Phase 3 Plan 04: Feed & Job-Detail Vertical Slice Summary

**The Dashboard becomes a dense, newest-first, score-sortable match feed (SCOR-04) over the per-user `user_jobs` projection, and `/jobs/:id` opens a job detail whose full JD snapshot renders exclusively through `DOMPurify.sanitize` alongside an advisory categorized keyword-gap panel (SCOR-05) — with per-user New-badge/dismiss state and `dompurify@3.4.12` pinned exactly.**

## Performance

- **Duration:** ~6 min
- **Tasks:** 3 (Task 1 package-legitimacy gate, Task 2 TDD feed lib, Task 3 feed + detail UI)
- **Files created:** 3 · **Files modified:** 4

## Must-Have Verification

| Must-have | Evidence |
|-----------|----------|
| Dashboard dense feed: New badge, title link, company, score+tier, first reason, best-fit resume chip, relative posted-time, Apply ↗, Dismiss — newest-first, score-sortable header (SCOR-04, D-14) | `Dashboard.tsx` (384 lines) renders all nine columns in order; default sort newest-first via `relativePostedTime`; `<th aria-sort={scoreAriaSort}>` wraps a `<button>` toggling score sort direction |
| Default Strong+Good only; Weak + filtered behind All-jobs; dismissed behind Show-dismissed (D-15, D-16) | Row filter: `showDismissed ? dismissed_at!==null : (dismissed_at===null && (viewAll ? true : defaultVisible(row)))`; `defaultVisible` unit-tested (scored≥50 visible, Weak/filtered/dismissed hidden); filtered rows render `text-zinc-500` + `filteredReasonLabel` |
| Job detail: full JD via `DOMPurify.sanitize` + categorized keyword-gap panel + covered vs routed resume (SCOR-05, D-17) | `JobDetail.tsx`: exactly one `dangerouslySetInnerHTML` wrapping `DOMPurify.sanitize(html, { FORBID_TAGS: ['style','form'] })`, `<pre>` fallback for null html; `GapPanel` groups skills/tools/certs/domain neutral chips + emerald covered chips, advisory heading naming the routed resume |
| Per-user seen/dismiss isolation (D-16) | Mutations write only `user_jobs.seen_at`/`dismissed_at` (the sole grant-writable columns from Plan 03) under own-row RLS; `markSeen` chains `.is('seen_at', null)` |
| Files/exports exactly per frontmatter | `feed.ts` exports `listFeed, getFeedJob, markSeen, dismissJob, undismissJob, tierPresentation, filteredReasonLabel, defaultVisible, relativePostedTime, companyName, safeApplyUrl, FEED_LIST_COLUMNS, FEED_DETAIL_COLUMNS, FeedRow`; `Dashboard.tsx` >120 lines; `JobDetail.tsx` contains `DOMPurify.sanitize`; `main.tsx` has `path="jobs/:id"`; `package.json` pins `"dompurify": "3.4.12"` |

## Local Gate Results (exact numbers)

- `cd web && npx vitest run src/lib/feed.test.ts` — **1 file, 19 tests passed** (TDD: RED confirmed missing-module failure before implementation, then GREEN).
- `cd web && npm run build` (tsc -b + vite) — **green** (only the pre-existing >500 kB chunk advisory, not introduced here).
- `cd web && npx vitest run` — **26 files, 348 tests passed** (Plan 03 baseline 25/329; +1 file `feed.test.ts`, +19 tests).
- `cd web && npm run lint` (oxlint) — **green**; sole warning is the pre-existing `AuthProvider.tsx:120` fast-refresh notice (out of scope, untouched).
- `grep '"dompurify": "3.4.12"' package.json` ✓ (exact, no caret); lockfile resolves `dompurify-3.4.12.tgz`.

## Package Legitimacy Gate (Task 1)

The `dompurify` [SUS] flag was heuristic-only (published <14 days before the audit). Substantive npm-registry verification recorded before install:

- Maintainer: `cure53 <mario@cure53.de>` (canonical DOMPurify author) ✓
- Weekly downloads: **48,227,696** (last week) ✓
- Version `3.4.12` present; `dist.integrity` sha512 pinned ✓
- Lifecycle scripts: no `install`/`postinstall`; only a dev-repo `prepare:husky` (not run from published tarballs) ✓

Installed with `--save-exact`. This is the only new frontend dependency this phase (T-3-SC).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed an unused `fullDateFormatter` in JobDetail.tsx**
- **Found during:** Task 3 (first `npm run build`)
- **Issue:** `tsc` failed `TS6133: 'fullDateFormatter' is declared but its value is never read` — the detail meta line uses `relativeTime` only, so the full-date formatter (copied from the Dashboard) was dead.
- **Fix:** Deleted the unused constant; kept `relativeFormatter`.
- **Files modified:** web/src/pages/JobDetail.tsx
- **Verification:** `npm run build` green; full suite 348 green.
- **Commit:** `d8b511e`

### Design choices worth recording (not scope changes)

- **Embedded resources kept unaliased.** The plan's ordering contract is `.order('posted_at', { foreignTable: 'jobs' })`. Aliasing the embed to `job`/`company` would desync `foreignTable: 'jobs'` and risk a runtime PostgREST ordering error (unobservable locally — no live query in the gate). Keys `jobs`/`companies` are kept; `companyName(row)` and `relativePostedTime(row)` mappers hide the shape from components. Company name is reached via nested `companies(name)` through `jobs.company_id` (Codex F5), never a non-existent `jobs.company` column.
- **Tier derived from score, not the stored `tier` column.** `tierPresentation(score)` re-derives Strong/Good/Weak so the badge always agrees with the numeral shown, honoring the UI-SPEC no-fill Weak rule and D-07 boundaries (75/74/50/49 unit-tested).

**Total deviations:** 1 auto-fixed (blocking build error). **Impact:** no scope change.

## Deferred / Notes

- **Visual UAT deferred to Plan 07.** Manual review of feed density, sort affordance, gap-panel rendering, and JD sanitization against real hosted scored data is the Plan 07 hosted-UAT checkpoint (no scored `user_jobs` rows exist locally). This plan completes the full local code + build + lint slice.
- **Adversarial sanitizer fixtures deferred (Codex MEDIUM disposition).** The single-`dangerouslySetInnerHTML`-wraps-`DOMPurify.sanitize` invariant is asserted structurally; DOMPurify's own suite covers script/onerror/javascript:/SVG/mutation-XSS. Revisit only if a bespoke sanitizer config is introduced.

## Safety Boundary Compliance

- JD snapshot renders only through `DOMPurify.sanitize` (T-3-15); reasons and gap/covered chips are plain text, never HTML. Apply links pass the `safeApplyUrl` https-only guard + `rel="noreferrer"` (T-3-16).
- No 02.1-owned files touched (no poll-tick/lifecycle/connectors/adapters/migrations edits); feed queries are source-agnostic — no `jobs.source` value enumerated.
- Seen/dismiss writes target only `user_jobs.seen_at`/`dismissed_at`; job identity is never mutated (feed is read-only over jobs).
- Left `.DS_Store`, `scripts/agent-dashboard.mjs`, `scripts/agent-dashboard.test.mjs` untracked/unstaged; did not edit `STATE.md`; no migration push or deploy.

## Known Stubs

None. The feed/detail render real per-user pipeline data from `user_jobs`; empty/loading/error states are intentional UX, not data stubs. (No scored rows exist locally — that is a hosted-data condition, resolved in Plan 07, not a code stub.)

## Issues Encountered

None blocking. RED confirmed before implementation; one trivial unused-const build error auto-fixed.

## Next Phase Readiness

- **Ready for the remaining Plan 05/06 notification work and Plan 07 hosted UAT:** the feed reads score/tier/reasons and the detail reads gaps/covered/description via the split column sets; `/jobs/:id` is the push click-through target the notification plans will link to.
- **Plan 07 owes:** hosted visual UAT with real scored data, cross-user RLS denial proof, and (optional) adversarial sanitizer fixtures.

## Self-Check: PASSED

All 3 created artifacts exist on disk (`web/src/lib/feed.ts`, `web/src/lib/feed.test.ts`, `web/src/pages/JobDetail.tsx`) plus the 4 modified files; both task commits (`1c20610`, `d8b511e`) present in git log; `dompurify@3.4.12` pinned in package.json and lockfile.

---
*Phase: 03-scoring-feed-notifications*
*Completed: 2026-07-19*

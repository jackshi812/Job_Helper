---
status: resolved
trigger: "UAT-03.2-ALL-JOBS: the All jobs button has no visible effect"
created: 2026-07-22T18:03:33-05:00
updated: 2026-07-22T18:41:35-05:00
---

## Current Focus

hypothesis: RESOLVED — the redundant dual-mode contract was replaced by one current preference-pass Dashboard scope whose score boundary is owned by Strong, Good, and Weak.
test: Automated predicate and integration coverage plus exact-release production UAT.
expecting: All current confirmed preference passes are reachable when all tiers are selected; deselecting Weak removes low-score and eligible scoreless rows; no All jobs control remains.
next_action: Complete Phase 03.2 gap-closure artifacts and continue with the captured follow-up ideas only in a later phase.

## Symptoms

expected: The All jobs button changes the Dashboard from its normal feed view to the complete job view, revealing rows intentionally hidden by the normal view while still respecting separate dismissal controls as designed.
actual: User reports that clicking the All jobs button shows the same jobs as the normal Dashboard.
errors: None reported.
reproduction: In Phase 03.2 UAT Test 2, compare default Dashboard rows, click All jobs, and compare again.
started: Discovered during authenticated production UAT after Phase 03.2 deployment.

## Eliminated

- hypothesis: The button click is not wired or `viewAll` is omitted from the row memo dependencies.
  evidence: `Dashboard.tsx` toggles state in the button handler, reflects it in `aria-pressed`/styling, passes it into `filterDashboardRows`, and lists it in the `useMemo` dependency array.
  timestamp: 2026-07-22T18:06:34-05:00

- hypothesis: The feed query filters out every row that All jobs could add, making the toggle unconditionally dead.
  evidence: `listFeed` deliberately returns failed and deferred preference-pass rows as well as scored rows, and the integration fixture proves a deferred pending row is preference-visible but not default-visible.
  timestamp: 2026-07-22T18:06:34-05:00

- hypothesis: Company/tier filtering accidentally removes every All-jobs-only row even in the fresh default state.
  evidence: Fresh state has no hidden company keys and includes Weak; scoreless rows map to Weak, so eligible failed/deferred rows survive the downstream filters when present.
  timestamp: 2026-07-22T18:06:34-05:00

## Evidence

- timestamp: 2026-07-22T18:05:41-05:00
  checked: Debug knowledge base and project-local skills.
  found: No `.planning/debug/knowledge-base.md` exists and no project-local `.codex/skills/*/SKILL.md` or `.agents/skills/*/SKILL.md` files were found.
  implication: There is no known-pattern candidate or project-specific skill rule to test first; proceed from the implementation and Phase 03.2 evidence.

- timestamp: 2026-07-22T18:05:50-05:00
  checked: `Dashboard.tsx` state and row derivation.
  found: The All jobs button toggles `viewAll`, its active styling and `aria-pressed`, and `filterDashboardRows` is memoized with `viewAll` as a dependency.
  implication: The button is wired and React state is not stale; the no-visible-effect symptom is not caused by a missing click handler or omitted memo dependency.

- timestamp: 2026-07-22T18:05:50-05:00
  checked: `baseDashboardVisible`, `defaultVisible`, and `preferenceVisible`.
  found: Normal mode accepts every open nondismissed scored row with a non-null score, including Weak; All jobs accepts the preference-pass pool and adds only open `failed` rows plus deferred survivors without a usable score. Dismissed rows are governed separately.
  implication: For a loaded pool consisting only of normal completed scored rows, the two predicates are extensionally equal.

- timestamp: 2026-07-22T18:05:50-05:00
  checked: Commit `ed7c446` against earlier contract commit `7ef01d8` and Phase 3 requirements/history.
  found: Before Phase 03.2, `defaultVisible` required score >= 50 while All jobs was score-independent; `ed7c446` intentionally changed the normal predicate to `score !== null` so Weak rows could be selected by the new tier controls. Phase 3 explicitly defined Focused as >=50 and All jobs as all preference passes.
  implication: Phase 03.2 collapsed the principal semantic distinction behind All jobs while retaining the old button and product expectation.

- timestamp: 2026-07-22T18:05:50-05:00
  checked: Dashboard/feed unit and integration tests.
  found: Tests explicitly assert Weak score 42 is visible in the normal Dashboard. The integration fixture shows preference-visible `[Weak, deferred pending, focused]` versus default-visible `[Weak, focused]`; no test asserts that toggling All jobs must differ for ordinary scored production rows.
  implication: Automated coverage codifies the semantic collapse and only demonstrates a difference when exceptional deferred/pending state is present.

- timestamp: 2026-07-22T18:05:50-05:00
  checked: Focused Vitest run for `dashboard.test.ts`, `feed.test.ts`, and `company-name-feed.integration.test.ts`.
  found: 3 files and 39 tests passed, including Weak-by-default and deferred-only mode distinction fixtures.
  implication: The reported behavior is reproducible as an allowed consequence of the current tested predicates rather than a runtime toggle failure.

- timestamp: 2026-07-22T18:06:34-05:00
  checked: Phase 03.2 research and verification artifacts.
  found: Research explicitly instructed refactoring the existing >=50 focused eligibility for all-three-tier defaults, and verification explicitly celebrates that `defaultVisible` no longer removes Weak. Neither artifact reevaluated the retained All jobs button's now-narrow residual semantics.
  implication: This is a cross-requirement semantic regression: a deliberate Phase 03.2 change made an older control observationally redundant for ordinary production state.

- timestamp: 2026-07-22T18:30:23-05:00
  checked: Gap-closure commits `10891ea` and `895356f`.
  found: `defaultVisible`, `viewAll`, and the All jobs control were removed; `preferenceVisible` is now the sole nondismissed base scope, and `tierPresentation(null)` keeps eligible scoreless rows under Weak.
  implication: The implementation now has one coherent scope and cannot regress into an observationally redundant mode without failing source and behavior tests.

- timestamp: 2026-07-22T18:41:35-05:00
  checked: Full local gates, exact Cloudflare release identity, immutable asset, and owner production UAT.
  found: 571/571 tests, build, and lint passed; deployment `7c804087-c656-499f-a3ec-3ad91a71fac4` is a successful production `github:push` for exact SHA `895356f76edd8bbdb34a253460ad5152fbc16310`; immutable and production `assets/index-B44mvuSI.js` match the local build at SHA-256 `d085764d3d54c78f8668ee593608cb99b39161ec4bc93da1af15bbe930d8301e`; the owner reported the targeted signed-in check passed.
  implication: The diagnosed UAT gap is closed on the exact reviewed release without production fixture mutation.

## Resolution

root_cause: Phase 03.2 intentionally changed the normal Dashboard from Strong+Good only to every completed scored row so all three tier toggles, including Weak, could start selected. `viewAll` still switched from `defaultVisible` to `preferenceVisible`, but the only remaining extra rows were exceptional preference-pass rows whose AI scoring failed or was deferred and scoreless. When production contained only completed scored rows—as a healthy settled feed often does—both modes returned exactly the same IDs, so the functioning toggle had no visible effect. The retained All jobs affordance and UAT expectation were not reconciled with the new default-tier semantics.
fix: Removed the competing default predicate and All jobs mode. The Dashboard now uses one current `preferenceVisible` base scope, with Strong/Good/Weak as its sole score-boundary controls; Weak owns low-score and eligible scoreless rows, while company selection and Show dismissed remain independent downstream filters. Updated tests, verifier assertions, UI/product contracts, and state history to match.
verification: Focused tests, 571/571 full tests, production build, lint, no-findings code review, exact-SHA Cloudflare deployment, byte-identical immutable/production/local asset hashes, and owner signed-in UAT all passed. No production job fixture, backend, preference, provider, or paid-AI state was mutated.
files_changed:
  - web/src/lib/feed.ts
  - web/src/lib/dashboard.ts
  - web/src/pages/Dashboard.tsx
  - web/src/lib/feed.test.ts
  - web/src/lib/dashboard.test.ts
  - web/src/pages/Dashboard.test.tsx
  - web/tests/company-name-feed.integration.test.ts
  - web/tests/preference-refilter-feed.integration.test.ts
  - scripts/verify-paylocity.ts
  - web/tests/paylocity-verifier-safety.test.ts

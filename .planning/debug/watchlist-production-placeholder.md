---
status: resolved
trigger: "UAT Test 1 failed. Expected deployed Watchlist add/replace/remove flow; production /watchlist shows only the old Company monitoring is coming soon placeholder."
created: 2026-07-17T19:23:39Z
updated: 2026-07-17T20:11:25Z
---

## Current Focus

hypothesis: CONFIRMED — Cloudflare Pages is serving origin/main, which is 68 commits behind local main and predates the Watchlist implementation.
test: Compare HEAD, origin/main, the Watchlist feature commit's ancestry, and the live bundle text.
expecting: Confirmed when origin/main contains the exact placeholder, excludes 4c27fc1, and the live bundle contains that placeholder while the current local bundle contains the new flow.
next_action: Resolved — origin/main was pushed, Cloudflare deployed the completed Watchlist bundle, and UAT test 1 passed.

## Symptoms

expected: The deployed Watchlist page provides add, replace-by-remove-and-re-add, and confirmed remove flow.
actual: At 2026-07-17 14:22 America/Chicago, https://job-helper-qs9.pages.dev/watchlist renders only “Company monitoring is coming soon.”
errors: No runtime error reported.
reproduction: Open https://job-helper-qs9.pages.dev/watchlist in the deployed site.
started: Discovered during Phase 2 UAT Test 1 on 2026-07-17.

## Eliminated

- hypothesis: Local routing or source regression still renders the placeholder.
  evidence: Current main.tsx routes /watchlist to the substantive Watchlist.tsx, and current web/dist contains the new form/table strings with no placeholder.
  timestamp: 2026-07-17T19:29:00Z

- hypothesis: Browser cache alone is showing an obsolete asset.
  evidence: A fresh server-side curl received live HTML pointing to index-C8nsKKfI.js, and a fresh fetch of that current origin asset contains the placeholder; responses require revalidation.
  timestamp: 2026-07-17T19:29:00Z

- hypothesis: The current Vite build directory or frontend code fails to include the Watchlist implementation.
  evidence: The default Vite web/dist output contains the expected new Watchlist strings and has a different content hash from the live asset.
  timestamp: 2026-07-17T19:29:00Z

## Evidence

- timestamp: 2026-07-17T19:27:00Z
  checked: Complete local Watchlist.tsx, main.tsx, Vite/package configuration, and file history.
  found: Current source imports and routes the substantive Watchlist component; it contains add, table, health badges, confirmation, and remove flows. The placeholder existed only in the initial scaffold lineage, while the substantive page was introduced by commit 4c27fc1 on 2026-07-16. Vite has no custom root/base/outDir and builds web/dist. No repository Cloudflare Pages, Wrangler, or CI deployment configuration exists.
  implication: A local routing/source regression is contradicted. Deployment is configured externally, so stale branch/project/build settings or an untriggered frontend deployment remain plausible.

- timestamp: 2026-07-17T19:29:00Z
  checked: Current local web/dist and git history of Watchlist.tsx.
  found: Local dist asset index-CLenEcPO.js contains “Companies polled every few minutes,” “Add company,” and “No companies watched yet,” and does not contain the placeholder. Commit 08fc69b contains the exact one-line placeholder; commit 4c27fc1 replaces it with the substantive component.
  implication: The current build process produces the expected UI. The old text maps directly to the initial scaffold artifact.

- timestamp: 2026-07-17T19:29:00Z
  checked: Fresh server-side HTTPS fetch of live /watchlist and its referenced immutable asset.
  found: Cloudflare returned HTML referencing /assets/index-C8nsKKfI.js. A fresh curl of that asset contains the exact placeholder and none of the new Watchlist strings. Its SHA-256 and size differ from current local index-CLenEcPO.js. Both HTML and asset responses use max-age=0, must-revalidate.
  implication: This is not a browser-cache-only symptom. Cloudflare's current origin deployment itself is an older build artifact.

- timestamp: 2026-07-17T19:32:00Z
  checked: Git upstream tracking, remote refs, feature ancestry, and origin/main's Watchlist source.
  found: Local main at 005c205 tracks origin/main but is ahead by 68 commits. origin/main is ff2cf69 from 2026-07-16 14:53 CDT. The Watchlist feature commit 4c27fc1 is not an ancestor of origin/main, and origin/main:web/src/pages/Watchlist.tsx contains the exact “Company monitoring is coming soon.” component served live. The repository has no in-repo Pages/Wrangler/CI deployment config, so Pages deployment settings are external.
  implication: Cloudflare never received the local Phase 2 frontend commits through the tracked production branch. The live artifact matches the pushed branch, not current local main. A wrong project/build-directory theory is unnecessary to explain the symptom; the upstream branch itself lacks the feature.

## Resolution

root_cause: Local main contains the Watchlist implementation but is 68 commits ahead of origin/main. Cloudflare Pages is serving a build corresponding to the pushed origin/main lineage, whose Watchlist.tsx still contains the placeholder; commit 4c27fc1 and subsequent Phase 2 work were never pushed to the production branch.
fix: The reviewed local main commits were pushed to the intended Cloudflare production branch and Pages deployed the completed Watchlist bundle.
verification: Root cause was established by exact source-text comparison; after deployment, Phase 2 UAT test 1 passed the add, cancel-remove, confirmed-remove, re-add, and cleanup flow.
files_changed: []

---
phase: 3
reviewers: [codex]
reviewed_at: 2026-07-19T02:59:42Z
plans_reviewed: [03-01-PLAN.md,03-02-PLAN.md,03-03-PLAN.md,03-04-PLAN.md,03-05-PLAN.md,03-06-PLAN.md,03-07-PLAN.md]
note: antigravity requested but skipped by user
---

# Cross-AI Plan Review — Phase 3

## Codex Review

# Cross-AI Plan Review — Phase 3

## Overall assessment

The plans are thoughtfully structured, security-conscious, and correctly keep Phase 3 scoring scan-based and separate from Phase 02.1 ingestion. However, several cross-plan correctness defects should be fixed before execution.

The most important blockers are:

1. **The migration-numbering algorithm is self-incrementing and will produce incorrect numbers after Plan 01.** Each plan computes `OFFSET = current head - 16`, but the “current head” will include earlier Phase 3 migrations. For example, after preferences becomes 0017, Plan 02 would turn nominal 0018 into 0019; after that, Plan 03 could become 0022. The current actual head is 0016, confirmed by [0016_workday_experimental.sql](/Users/jackshi/Desktop/Linkedin/supabase/migrations/0016_workday_experimental.sql:1). Resolve Phase 02.1 once before Phase 3 execution, allocate four fixed filenames, and remove per-plan recomputation.

2. **Newly extracted resumes do not trigger rerouting/rescoring.** Upload triggers refilter before extraction is ready; when extraction later becomes `ready`, nothing marks recent `user_jobs` for refilter. A new resume therefore may never participate in D-06 routing.

3. **Notification enqueueing is described as a client-side select-plus-insert flow, not an atomic claim.** Concurrent cron executions can select the same candidates. The unique constraint prevents duplicate rows but does not give one worker ownership of the existing queued rows, so both workers may send them.

4. **Transient push and digest failures can permanently suppress retries.** Push failures become terminal `failed` rows under a uniqueness constraint; digest dates are advanced even when sending fails.

5. **The feed plan expects company data that the proposed query does not actually select.** `jobs` has only `company_id`, not a company-name column. See [0006_jobs_pipeline.sql](/Users/jackshi/Desktop/Linkedin/supabase/migrations/0006_jobs_pipeline.sql:5).

6. **The production verifier can generate real user notifications and emails.** Lowering a real user’s threshold to 1 and running `notify-tick` is not an isolated verification fixture.

The phase should be considered **HIGH risk until these issues are corrected**.

---

## 03-01 — Preferences and cheap filters

### 1. Summary

Creates per-user preference storage, the cheap-filter implementation, and the Preferences UI. This is a sensible first vertical slice and correctly precedes scoring.

### 2. Strengths

- The proposed RLS pattern is grounded in the existing implementation. The current resume table has four own-row policies using `(select auth.uid())`, matching the plan’s intended design: [0002_resumes.sql](/Users/jackshi/Desktop/Linkedin/supabase/migrations/0002_resumes.sql:16).
- Per-user preferences are correctly separated from the shared jobs pool. The current jobs table is intentionally shared and read-only to authenticated users: [0006_jobs_pipeline.sql](/Users/jackshi/Desktop/Linkedin/supabase/migrations/0006_jobs_pipeline.sql:31).
- The filter module is kept pure and follows the established normalization philosophy in [dedup.ts](/Users/jackshi/Desktop/Linkedin/supabase/functions/_shared/dedup.ts:1).
- Exclude-first evaluation, soft include keywords, lenient location handling, and bounded reason codes are all good cost-control decisions.
- The route and navigation changes align with the current authenticated route group and navigation array: [main.tsx](/Users/jackshi/Desktop/Linkedin/web/src/main.tsx:27), [Shell.tsx](/Users/jackshi/Desktop/Linkedin/web/src/components/Shell.tsx:7).

### 3. Concerns

- **HIGH — migration numbering is unsafe.** After this plan creates 0017, later plans will treat it as additional Phase 02.1 offset and skip numbers. This is a phase-wide defect, not merely cosmetic, because dependency order and deployment reconciliation rely on the names.
- **MEDIUM — preference creation/upsert ownership is underspecified.** The plan says upsert “keyed on `user_id`,” but the browser-side input must either obtain the authenticated UID or omit `user_id` and rely on its database default. An upsert cannot reliably conflict on `user_id` if that column is absent from the submitted row.
- **MEDIUM — substring matching can over-filter.** Normalized substring matching means short exclusions such as `c`, `r`, `go`, or `staff` inside longer tokens may cause false positives. This matters because exclusion is a hard discard.
- **MEDIUM — title overlap is very permissive.** Passing on one shared significant token can make “Software Sales Engineer” match a target of “Software Engineer.” The AI can judge relevance, but this weakens the promise that cheap filters meaningfully gate AI cost.
- **LOW — migration validation is incomplete.** Cardinality limits do not reject blank strings, excessively long terms, invalid timezone identifiers, or quiet-hour half-configurations.
- **LOW — success copy claims re-filtering before it exists.** Plan 01 displays “recent jobs re-filtering,” but the RPC is only added in Plan 03. That message is false if Plan 01 is deployed or tested independently.

### 4. Suggestions

- Allocate fixed migration filenames once after reconciling Phase 02.1; do not recompute offsets in each plan.
- Have `savePreferences` explicitly resolve the current user and submit `user_id`, or create a database RPC that performs the own-row upsert.
- Use token/phrase-boundary matching for exclusions, with an explicit separate mode if substring matching is wanted.
- Add title-filter fixtures for shared generic tokens such as `software`, `data`, `manager`, and `engineer`.
- Validate timezone with a server-side allowlist or helper rather than accepting arbitrary text.
- Change the Plan 01 success message to `Preferences saved.` and introduce the re-filtering message only after Plan 03.

### 5. Risk assessment

**MEDIUM**, elevated to **HIGH** if the migration-numbering rule remains unchanged.

---

## 03-02 — Resume extraction and Gemini wrapper

### 1. Summary

Adds cached DOCX text and keyword extraction, AI usage accounting, a shared Gemini wrapper, and a scheduled extraction worker.

### 2. Strengths

- It correctly consumes the existing resume implementation rather than rebuilding upload. The current uploader already supports private per-user paths and cleans up storage if row creation fails: [resumes.ts](/Users/jackshi/Desktop/Linkedin/web/src/lib/resumes.ts:31).
- Cascade deletion from `resumes` is appropriate because existing resumes are user-owned and already reference `auth.users`: [0002_resumes.sql](/Users/jackshi/Desktop/Linkedin/supabase/migrations/0002_resumes.sql:1).
- Keeping prompts and extracted content out of `ai_usage` is a strong privacy boundary.
- Parameterizing the API key and using standard `fetch` makes the Gemini wrapper testable in both Node and Deno.
- The live structured-output smoke test is valuable because the AI endpoint and schema contract are genuine integration risks.
- The cron-secret design matches the existing deployment model. The repository explicitly documents why scheduler functions use `x-cron-secret`: [0006_jobs_pipeline.sql](/Users/jackshi/Desktop/Linkedin/supabase/migrations/0006_jobs_pipeline.sql:80).

### 3. Concerns

- **HIGH — extraction work is not exclusively claimed.** Scanning missing/pending rows and processing them directly allows overlapping one-minute cron invocations to extract and bill for the same resume. Unlike the scoring plan, there is no `SKIP LOCKED` claim RPC.
- **HIGH — “exactly one cached extraction” is not guaranteed.** The PK prevents two final rows, but it does not prevent duplicate Gemini calls before competing workers upsert the same row.
- **HIGH — the plan cannot technically prove paid-tier billing.** A Gemini API key does not encode “paid” in the request, and a successful smoke call only proves access. The human checkpoint is useful but should be described as an operator attestation, not a runtime enforcement.
- **MEDIUM — `attempts` and retry ownership are underspecified.** If the worker fails before an extract row exists, there is no row whose attempts can be incremented unless it first inserts a pending/claimed record.
- **MEDIUM — unsupported PDF handling relies on filename.** Existing uploads accept both DOCX and PDF: [resumes.ts](/Users/jackshi/Desktop/Linkedin/web/src/lib/resumes.ts:23), and storage allows both MIME types: [0003_storage.sql](/Users/jackshi/Desktop/Linkedin/supabase/migrations/0003_storage.sql:1). Filename-only detection should not be the trust boundary; inspect magic bytes/content type or record the upload MIME type.
- **MEDIUM — the Mammoth fallback may conceal malformed or hostile archives.** The JSZip path needs limits on uncompressed size, entry count, and `word/document.xml` size to avoid zip bombs.
- **MEDIUM — no extraction-size limit is specified.** A 5 MB compressed DOCX may expand into very large XML and then be sent in full to Gemini.
- **LOW — `user_id` duplication can drift.** `resume_extracts.user_id` is copied separately from the parent resume without a composite FK ensuring it matches the resume owner.

### 4. Suggestions

- Add `claim_resume_extractions(batch_size)` with an atomic pending-row seed and `FOR UPDATE SKIP LOCKED`.
- Add `claimed_at`, make stale claims reclaimable, and increment attempts during claim.
- Treat paid tier as a documented operator control and record the Google project/key identifier used during UAT.
- Bound compressed input, uncompressed XML size, extracted text length, and prompt length.
- Derive the extraction owner from the joined resume row server-side; consider omitting duplicated `user_id` or enforce it with a composite relationship.
- Add fixtures for corrupt DOCX, encrypted archive, zip bomb thresholds, blank document, and Gemini success followed by database-write failure.

### 5. Risk assessment

**HIGH** due to duplicate paid calls and missing atomic claim behavior.

---

## 03-03 — Per-user scoring pipeline

### 1. Summary

Introduces `user_jobs`, claim/refilter RPCs, deterministic resume routing, and the scheduled scoring worker.

### 2. Strengths

- The architecture correctly avoids every Phase 02.1-owned ingestion file. The current ingestion function directly imports connectors, dedup, and lifecycle logic: [poll-tick/index.ts](/Users/jackshi/Desktop/Linkedin/supabase/functions/poll-tick/index.ts:1). A separate `score-tick` is the right isolation boundary.
- The proposed claim RPC follows the existing proven `FOR UPDATE SKIP LOCKED` pattern: [0008_claim_exclusive.sql](/Users/jackshi/Desktop/Linkedin/supabase/migrations/0008_claim_exclusive.sql:11).
- A unique `(user_id, job_id)` relationship correctly models per-user decisions over a shared job.
- Column-limited grants for `seen_at` and `dismissed_at` are stronger than relying on RLS alone.
- Server-side score clamping and tier derivation prevent model output from controlling notification classifications.
- The prompt-injection precautions and plain-text downstream rendering are appropriate.
- Source-agnostic querying correctly avoids coupling to the evolving `jobs.source` constraint. Phase 02.1 has already expanded that constraint through Workday: [0016_workday_experimental.sql](/Users/jackshi/Desktop/Linkedin/supabase/migrations/0016_workday_experimental.sql:27).

### 3. Concerns

- **HIGH — completed resume extraction never triggers refilter.** The browser upload hook runs immediately, before `extract-resume` produces a ready keyword set. The extraction worker does not call `mark_recent_jobs_for_refilter`, so the new resume may never become a routing candidate.
- **HIGH — `no_resume_extract` can exhaust retries before extraction completes.** Scoring runs every minute and allows five attempts. If extraction is delayed, jobs can become permanently failed even though a ready extraction later appears.
- **HIGH — the “rescore only on real change” rule is incomplete.** Preference changes can materially alter AI scoring while the cheap-filter outcome and routed resume remain unchanged. For example, include keywords or preferred locations may change, yet the plan keeps the old score.
- **HIGH — missing preferences cause all jobs to survive.** Empty title/location/exclusion arrays pass the stated filter rules. That contradicts the UI guidance that matching starts after at least one target title and can trigger AI calls for the entire recent pool.
- **MEDIUM — seed × users happens inside every claim invocation.** Even with only two users, crossing all open jobs with all auth users on every minute tick is unnecessary. It should seed incrementally or use a bounded candidate set.
- **MEDIUM — `auth.users` access and row generation need hosted proof.** The function is `security invoker`; it relies on the service role caller’s ability to read `auth.users`. That is plausible but should be verified before making it the central seeding mechanism.
- **MEDIUM — failed writes may leave claims stuck.** Every failure branch must clear `claimed_at`; the plan explicitly clears it for filtered/scored paths but does not define the update for all exceptions.
- **MEDIUM — attempt counting penalizes non-AI prerequisites.** Missing preferences or extracts should be waiting states, not retry failures consuming the same terminal budget as repeated Gemini errors.
- **MEDIUM — daily AI cap is race-prone.** Two concurrent workers can both observe count 199 and each issue calls. A database reservation/budget RPC is needed for a hard cap.
- **LOW — all-zero routing depends on filename order.** Stable ordering is deterministic but may not reflect the user’s preferred default resume.

### 4. Suggestions

- Have extraction completion mark the user’s recent jobs for refilter/reroute.
- Add distinct `waiting_preferences` and `waiting_resume_extract` states that do not consume AI retry attempts.
- Require at least one target title before scoring, or explicitly keep rows pending until preferences are configured.
- Store scoring input versions/hashes: preference hash, resume-extract version/hash, filter version, and prompt/rubric version. Rescore when any relevant hash changes.
- Make AI budget reservation atomic in SQL.
- Seed work with a bounded SQL candidate CTE rather than an unrestricted cross join on every invocation.
- Ensure every claimed row is released or transitions to a clearly reclaimable state in `finally`.

### 5. Risk assessment

**HIGH**. This is the phase’s core pipeline, and current trigger/version semantics can produce stale or permanently missing scores.

---

## 03-04 — Feed and job detail

### 1. Summary

Builds the match feed and job-detail UI, including sanitized JD HTML and per-user seen/dismiss state.

### 2. Strengths

- DOMPurify is the correct class of protection for stored third-party HTML. The existing schema explicitly warns that Phase 3 must sanitize `description_html`: [0006_jobs_pipeline.sql](/Users/jackshi/Desktop/Linkedin/supabase/migrations/0006_jobs_pipeline.sql:1).
- The HTTPS-only apply-link guard has a strong existing precedent. `safeCareersUrl` rejects non-HTTPS URLs and embedded credentials: [watchlist.ts](/Users/jackshi/Desktop/Linkedin/web/src/lib/watchlist.ts:94).
- The page structure fits the current authenticated SPA route group: [main.tsx](/Users/jackshi/Desktop/Linkedin/web/src/main.tsx:27).
- New/seen state changes only when detail opens or dismissal occurs, which is better than marking jobs seen merely because a feed rendered in the background.
- The planned plain-text rendering of reasons and gaps closes an additional XSS path.
- Default hiding of Weak/filtered/dismissed rows matches the stated quiet-by-default product behavior.

### 3. Concerns

- **HIGH — company name is not available from the stated query.** `jobs` contains `company_id` but no `company` or `company_name`: [0006_jobs_pipeline.sql](/Users/jackshi/Desktop/Linkedin/supabase/migrations/0006_jobs_pipeline.sql:5). `FEED_COLUMNS` must embed `companies(name)` through `jobs`, or the UI cannot render the required company column.
- **MEDIUM — embedded ordering is underspecified.** Ordering `user_jobs` by a nested job timestamp requires correct PostgREST foreign-table syntax and relationship naming. A plain `.order('posted_at')` on `user_jobs` will not work.
- **MEDIUM — the plan selects two full JD representations in feed queries.** `listFeed` should not fetch `description_html` and `description_text` for every table row. That wastes bandwidth and increases exposure of untrusted HTML. Fetch those only in `getFeedJob`.
- **MEDIUM — `markSeen` is not truly conditional as described.** It should include `.is('seen_at', null)` to avoid rewriting timestamps on every detail mount.
- **MEDIUM — sanitization tests are absent.** A grep proving one `dangerouslySetInnerHTML` does not prove scripts, event handlers, SVG/MathML payloads, unsafe links, or mutation-XSS cases are removed.
- **MEDIUM — the package checkpoint does not verify integrity.** Human confirmation of publisher/version is weaker than checking the lockfile-resolved package, integrity hash, repository ownership, and package lifecycle scripts.
- **LOW — dismissed-row recovery is underspecified in the UI.** The library provides `undismissJob`, but the page instructions do not clearly require a Restore action when “Show dismissed” is active.
- **LOW — filtering and sorting entirely client-side may be acceptable for two users but should be bounded.** `listFeed` needs a limit or recent-window pagination so the dashboard does not grow indefinitely.

### 4. Suggestions

- Use a nested relationship such as `jobs(..., companies(name))`, confirmed against the actual FK relationship name.
- Split feed-list and detail column constants; keep JD bodies out of the list query.
- Add a database/view or RPC for newest-first feed ordering if nested PostgREST ordering proves awkward.
- Add sanitizer fixtures containing script tags, `onerror`, `javascript:` links, SVG, malformed HTML, forms, styles, and safe formatting.
- Add a visible Restore action for dismissed jobs.
- Add pagination or a recent-row limit.

### 5. Risk assessment

**MEDIUM-HIGH** because the required company display is currently unwired and the main XSS boundary lacks behavioral tests.

---

## 03-05 — Notification backend

### 1. Summary

Adds push subscriptions, notification bookkeeping, quiet-hour calculations, web-push delivery, fallback email, and daily digests.

### 2. Strengths

- The quiet-hours module is pure, clock-injected, timezone-aware, and explicitly tested across DST boundaries.
- Using `Intl.DateTimeFormat` is preferable to manual UTC offsets.
- Burst collapse and digest-first email design fit the attention and free-tier constraints.
- The proposed notification audit table provides useful delivery visibility.
- Push subscription RLS follows the same per-user boundary established for resumes.
- Dead-subscription pruning is a necessary operational behavior.
- The deletion RPC extension is consistent with the existing function’s instruction that later phases append their tables: [0004_delete_my_data.sql](/Users/jackshi/Desktop/Linkedin/supabase/migrations/0004_delete_my_data.sql:11).
- Storage-first bulk deletion already exists in the client before the RPC is invoked, so extending the database RPC does not itself orphan resume files: [Settings.tsx](/Users/jackshi/Desktop/Linkedin/web/src/pages/Settings.tsx:49).

### 3. Concerns

- **HIGH — enqueue and delivery claiming are not atomic.** A select for missing rows followed by inserts does not give one cron invocation ownership. Two notify workers can both load the same queued rows and both send before either marks them sent.
- **HIGH — transient push failure becomes permanent.** Once `(user_id, job_id, 'push')` exists with status `failed`, the enqueue condition will never recreate or retry it. This contradicts “nothing lost.”
- **HIGH — digest failures are suppressed for the day.** The plan updates `last_digest_date` “regardless of empty/sent.” If Resend fails, the user receives no digest and the worker will not retry until the following day.
- **HIGH — notification uniqueness does not itself prove exactly-once delivery.** A crash after an external push/email succeeds but before marking the database row sent can cause a replay. Resend’s idempotency key helps digest email, but push delivery has no corresponding provider idempotency.
- **HIGH — email/digest state is too coarse.** One collapsed fallback email can cover multiple per-job notification rows. Partial database updates or a crash can leave inconsistent statuses without a delivery-attempt/batch record.
- **MEDIUM — `notifications.channel = 'digest'` uniquely locks a job forever.** That may be intended, but it should be explicit. If a digest send fails after rows are inserted, those jobs may never appear in a later digest.
- **MEDIUM — quiet-hour release may be delayed by retry failures.** Rows remain queued during quiet time, which is good, but there is no atomic release claim immediately afterward.
- **MEDIUM — invalid timezones can throw and starve a user’s notifications.** Plan 01 stores arbitrary timezone text, while `Intl.DateTimeFormat` rejects invalid zones.
- **MEDIUM — endpoint uniqueness is global.** That is defensible because a push endpoint identifies a subscription, but cross-user endpoint conflicts must fail without revealing or overwriting another user’s record.
- **MEDIUM — direct HTML construction needs escaping.** Job titles, company names, and URLs are third-party data. Interpolating them into digest/fallback HTML without escaping creates email HTML injection.
- **LOW — digest time means “after this time,” not “at this time.”** That is acceptable but should be reflected in UX and tests, particularly after downtime.

### 4. Suggestions

- Add atomic notification claim RPCs using `FOR UPDATE SKIP LOCKED`, `claimed_at`, and stale-claim recovery.
- Separate candidate/event identity from delivery attempts. Suggested model:

  - `notification_events`: unique user/job/event type.
  - `notification_batches`: one collapsed push or digest.
  - `delivery_attempts`: channel, attempt number, provider ID, status, retry time.

- Keep transient failures retryable with exponential backoff; reserve terminal failure for permanent errors.
- Update `last_digest_date` only after successful delivery or a deliberate empty-digest decision.
- Do not insert final digest event rows until send succeeds, or mark them retryable under a batch.
- HTML-escape all third-party text and validate apply URLs before embedding them in email.
- Add concurrency and crash-point tests: before send, after send/before status update, partial subscription success, and Resend 429/500.

### 5. Risk assessment

**HIGH**. The current design prevents duplicate database rows but not duplicate external sends, while also risking permanent missed notifications.

---

## 03-06 — Push client and notification settings

### 1. Summary

Adds the service worker, browser subscription management, push health reporting, and Settings controls for thresholds, quiet hours, and digest time.

### 2. Strengths

- Permission is correctly required inside an explicit user click.
- The service worker has a deliberately narrow scope: push display and notification navigation only.
- The browser receives only the public VAPID key; the private key stays server-side.
- The proposed Settings card matches the existing visual pattern in [Settings.tsx](/Users/jackshi/Desktop/Linkedin/web/src/pages/Settings.tsx:125).
- Merging notification fields with the existing preference arrays is explicitly required, reducing accidental preference loss.
- Current settings actions are already exported and behavior-tested, providing an established testability pattern: [Settings.tsx](/Users/jackshi/Desktop/Linkedin/web/src/pages/Settings.tsx:14).

### 3. Concerns

- **HIGH — “dead subscription for this device” cannot be determined from the proposed schema.** When the browser has no subscription, there is no endpoint to match to a database row. `user_agent` is not a stable device identifier and can be shared across devices.
- **HIGH — saving notification settings invokes the Plan 03 refilter RPC.** `savePreferences` is modified to refilter after every save. Plan 06 reuses it for threshold/quiet-hour/digest changes, so notification-only changes unnecessarily refilter recent jobs, contrary to the plan’s own “no refilter surprise” done condition.
- **MEDIUM — service-worker navigation needs origin validation.** The worker should accept only same-origin relative paths or same-origin URLs before calling `navigate`/`openWindow`.
- **MEDIUM — focus-first navigation can hijack the wrong app tab.** The plan says focus an existing window and navigate it, but should select a same-origin client and preferably one already showing the app.
- **MEDIUM — disable order can leave stale server state.** If browser unsubscribe succeeds and database deletion fails, the dead subscription remains stored. This is recoverable but should be detected and retried.
- **MEDIUM — VAPID key rotation is not handled.** Existing browser subscriptions made with an old key may appear enabled but become undeliverable.
- **LOW — browser API tests are too narrow.** Tests focus on Settings actions, not mocked service-worker registration, denied permission, existing subscriptions, unsubscribe failure, or database failure.
- **LOW — quiet-hour partial configuration should be prevented.** Allowing start without end silently disables quiet hours under Plan 05 semantics.

### 4. Suggestions

- Give installations a stable random `device_id` stored locally and in `push_subscriptions`; use it for health reconciliation.
- Split preference mutations:

  - `saveMatchingPreferences` → may invoke refilter.
  - `saveNotificationPreferences` → never invokes refilter.

- Validate service-worker targets with `new URL(target, self.location.origin)` and reject cross-origin URLs.
- Reconcile stale database subscriptions during app load and after failed disable operations.
- Store a VAPID key version with each subscription.
- Add browser API unit tests with mocked `navigator.serviceWorker`, `PushManager`, and `Notification`.

### 5. Risk assessment

**HIGH** because push health detection is not implementable as specified and settings changes unintentionally trigger scoring work.

---

## 03-07 — Deployment and hosted verification

### 1. Summary

Reconciles Phase 02.1, generates VAPID keys, sets secrets, pushes schema, deploys functions, runs hosted security/pipeline probes, and finishes with human UAT.

### 2. Strengths

- Treating schema push and function deployment as blocking verification steps is correct; local builds cannot prove hosted RLS, cron, or secret configuration.
- Two independent publishable-key sessions are the right RLS proof pattern. The existing verifier uses exactly that technique: [verify-rls.ts](/Users/jackshi/Desktop/Linkedin/scripts/verify-rls.ts:83).
- Requiring unauthenticated 401 probes for all cron functions is valuable.
- The VAPID public/private separation is correct.
- Human UAT is necessary for actual push receipt, closed-tab behavior, reason quality, visual fidelity, and digest delivery.
- The actual Phase 02.1 files are now present through migration 0016, and its latest execution summary says all 13 plans concluded, although the phase remains `gaps_found`: [02.1-13-SUMMARY.md](/Users/jackshi/Desktop/Linkedin/.planning/phases/02.1-source-coverage-expansion/02.1-13-SUMMARY.md:101).

### 3. Concerns

- **HIGH — Phase 02.1 is not verified cleanly.** Its verification report remains `gaps_found`, scoring only 6/8 goal truths: [02.1-VERIFICATION.md](/Users/jackshi/Desktop/Linkedin/.planning/phases/02.1-source-coverage-expansion/02.1-VERIFICATION.md:32). The latest summary permits moving on but explicitly does not claim full verification. Plan 07 should distinguish “execution concluded with accepted deferred gaps” from “final verification passed.”
- **HIGH — migration renumbering at deployment time is too late.** Earlier plans, summaries, tests, and references will already use generated names. Renumber once before Plan 01, not immediately before `db push`.
- **HIGH — secret values passed as CLI arguments can leak.** Inline `KEY=value` arguments may appear in shell history, process listings, CI logs, or tool-call transcripts. This conflicts with the plan’s “never echo secret values” requirement.
- **HIGH — notification verification can spam real users.** Lowering a real account’s threshold to 1 and invoking `notify-tick` can send push and fallback email for every eligible recent job. Restoring preferences afterward does not undo external sends.
- **HIGH — verifier mutations are not isolated fixtures.** The repository has already had problems with hosted verification mutating production state; the Phase 02.1 report explicitly identified that class of defect: [02.1-VERIFICATION.md](/Users/jackshi/Desktop/Linkedin/.planning/phases/02.1-source-coverage-expansion/02.1-VERIFICATION.md:65). Plan 07 repeats the risk with real preferences and notification rows.
- **HIGH — the scoring verifier assumes organic data provides both filtered and scored rows.** Hosted data may not happen to contain both, making the probe flaky. It needs owned fixtures.
- **MEDIUM — paid-tier verification remains an attestation.** The verifier cannot infer Gemini billing tier merely from successful calls or `ai_usage`.
- **MEDIUM — cron verification checks existence but not cadence or duplicate jobs.** It should verify exactly one enabled job per name and expected schedule.
- **MEDIUM — deployment of the SPA is only parenthetical.** Cloudflare Pages deployment and `VITE_VAPID_PUBLIC_KEY` configuration are prerequisites for UAT and should be an explicit task with SHA-bound evidence.
- **MEDIUM — verification of cron-secret functions must test valid and invalid secrets.** A missing-header 401 alone does not prove the configured Vault secret matches the function environment.
- **MEDIUM — VAPID compatibility is deferred to implementation-time source inspection.** A local round-trip test against the actual pinned `@negrel/webpush` package would be stronger.
- **LOW — verification scripts need signal/abort restoration.** A JavaScript `finally` does not run after every termination mode. Use disposable rows so restoration is not the only safety mechanism.

### 4. Suggestions

- Record Phase 02.1 as “execution concluded, accepted deferred gaps,” and explicitly confirm those gaps do not affect Phase 3’s jobs schema or ingestion safety.
- Freeze final Phase 3 migration numbers before executing Plan 01.
- Set secrets through a protected env file, stdin-supported mechanism, or interactive masked input—not inline CLI arguments.
- Build completely disposable verification fixtures:

  - Dedicated verification user or isolated job/user rows.
  - A uniquely named test resume and test job.
  - Notification rows and subscriptions owned by the fixture.
  - A Resend test recipient/sink.
  - Cleanup by unique IDs in `finally`.

- Add a notification “dry-run transport” or injectable transport for structural hosted verification; reserve the real external send for the human UAT account.
- Make Cloudflare deployment a formal task: configure env, deploy exact commit, verify asset SHA, then conduct UAT.
- Verify one valid-secret 200/structured response and invalid/missing-secret 401 for each edge function.
- Query cron for name, schedule, active status, target path, and duplicates.

### 5. Risk assessment

**HIGH** because production verification can send irreversible external notifications and because migration/secrets deployment procedures are unsafe as written.

---

## Cross-plan dependency and scope review

### Phase 02.1 isolation

The plans successfully honor the central isolation requirement in their declared file lists:

- None proposes modifying `poll-tick/index.ts`, lifecycle, connectors, adapters, or migrations 0012–0016.
- Scoring is a new `score-tick` worker with a new claim RPC.
- Feed and scoring remain source-agnostic.

That architectural decision is sound.

One wording issue remains: the plans say Phase 02.1 is “executing in parallel,” but the workspace currently contains all 13 summaries and a concluded UAT summary. The canonical status is still `gaps_found`, not actively executing and not fully verified. Plans should be refreshed against that actual state before execution.

### Missing end-to-end state transitions

The plans need an explicit lifecycle such as:

```text
resume uploaded
  → extraction claimed
  → extraction ready
  → recent user_jobs marked for reroute
  → scoring claimed
  → scored row committed
  → notification event atomically claimed
  → delivery attempted
  → sent or retry_at scheduled
```

The current plans omit the `extraction ready → reroute` transition and do not atomically claim notification delivery.

### Testing gaps

Unit tests are strongest around pure helpers but weakest around concurrency and failure boundaries. Add integration tests for:

- Two overlapping extraction ticks.
- Two overlapping scoring ticks.
- Two overlapping notification ticks.
- Crash after provider send but before database status update.
- Gemini success followed by database failure.
- Resume extraction completing after scoring has already entered `no_resume_extract`.
- Preference-only versus notification-only changes.
- Sanitizer adversarial fixtures.
- Resend 429/500 retry behavior.
- Invalid timezone and DST behavior.
- VAPID key rotation and dead-device reconciliation.

## Final recommendation

**Do not execute the plans unchanged.** Revise at least Plans 02, 03, 05, 06, and 07, and replace the migration-numbering rule across all migration-producing plans.

Once the six blockers identified in the overall assessment are addressed, the architecture should be capable of meeting the phase goal without touching Phase 02.1 ingestion.

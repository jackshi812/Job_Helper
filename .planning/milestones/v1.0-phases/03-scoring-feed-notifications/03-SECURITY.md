---
phase: 03
slug: scoring-feed-notifications
status: verified
threats_open: 0
asvs_level: 1
block_on: high
register_authored_at_plan_time: true
created: 2026-07-20
verified: 2026-07-20T21:13:54Z
---

# Phase 3 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

## Audit Scope

This ASVS L1 audit rechecked every parseable `<threat_model>` in Plans 03-01 through 03-11 against the final Phase 3 implementation, tests, production evidence, and notification-removal migration. Threat IDs reused by later gap-closure plans are qualified by plan number below.

## Trust Boundaries

| Boundary | Data crossing | Verified control |
|---|---|---|
| Authenticated browser to per-user rows/storage | Preferences, resumes, extracts, scores, seen/dismiss state | Own-user RLS, folder policies, restricted column grants |
| Untrusted ATS/aggregator content to browser | Job descriptions, URLs, company metadata | DOMPurify, HTTPS-only apply guard, truthful-name projection |
| Untrusted jobs/resumes/preferences to OpenAI | Private scoring/extraction inputs | Free filters first, delimited data blocks, strict schema, `store:false`, no content logging |
| Cron to Edge Functions | Privileged worker invocation | `x-cron-secret`; secrets remain outside the SPA |
| Score worker to production rows | Claims, hashes, revisions, scores | SKIP LOCKED ownership, atomic budget reservation, one physical attempt, revision CAS |
| Verifier to production scoring | Temporary latch, synthetic fixtures, one approved paid call | Disposable account, strict two-row/run latch, five-minute TTL, exact cleanup and cron restoration |
| Release evidence to human UAT | Deployment identity and proof metadata | Exact git/migration/function/deployment/asset binding; bounded non-content evidence |

## Threat Register

### Plan 03-01 — Preferences and filters

| Threat | Category | Severity | Disposition | Verified mitigation | Status |
|---|---|---|---|---|---|
| `03-01/T-3-01` | Information disclosure — preferences | high | mitigate | Four own-row RLS policies; no anonymous grant | closed |
| `03-01/T-3-02` | Tampering — preference arrays | medium | mitigate | Database cardinality caps plus trim/dedupe/normalization | closed |
| `03-01/T-3-03` | Elevation — forged ownership | high | mitigate | `auth.uid()` default and insert/update `with check` | closed |

### Plan 03-02 — Resume extraction

| Threat | Category | Severity | Disposition | Verified mitigation | Status |
|---|---|---|---|---|---|
| `03-02/T-3-04` | Information disclosure — resume to OpenAI | critical | mitigate | Responses API `store:false`; no application content logging | closed |
| `03-02/T-3-05` | Information disclosure — logs/usage | high | mitigate | Token/count metadata and bounded error codes only | closed |
| `03-02/T-3-06` | Spoofing — worker invocation | high | mitigate | `x-cron-secret` checked before privileged work | closed |
| `03-02/T-3-07` | Information disclosure — cross-user extracts | high | mitigate | Own-row extract RLS and cascading ownership | closed |
| `03-02/T-3-08` | Tampering — resume prompt input | medium | mitigate | Delimited data blocks and schema-constrained output | closed |
| `03-02/T-3-08a` | DoS — duplicate extraction cost | high | mitigate | SKIP LOCKED extraction claim, bounded attempts, stale reclaim | closed |
| `03-02/T-3-08b` | DoS/tampering — hostile DOCX | high | mitigate | Trustworthy ZIP preflight before Mammoth, format/entry/size/ratio caps, hostile fixtures | closed |

### Plan 03-03 — Scoring pipeline

| Threat | Category | Severity | Disposition | Verified mitigation | Status |
|---|---|---|---|---|---|
| `03-03/T-3-09` | Tampering — JD prompt injection | high | mitigate | Data-only delimiters, strict response schema, server score/tier derivation, plain-text reasons | closed |
| `03-03/T-3-10` | Spoofing — score worker invocation | high | mitigate | `x-cron-secret` gate | closed |
| `03-03/T-3-11` | Elevation — client score writes | high | mitigate | Authenticated updates limited to `seen_at` and `dismissed_at` | closed |
| `03-03/T-3-12` | Information disclosure — scoring logs | high | mitigate | Bounded diagnostic errors; no JD/resume content logging | closed |
| `03-03/T-3-13` | DoS — scoring cost | medium | mitigate | Atomic daily reservation below 500 and `maxAttempts: 1` per reserved scoring call | closed |
| `03-03/T-3-14` | Information disclosure — PII to OpenAI | critical | mitigate | Project-scoped key, `store:false`, no prompt/response logs | closed |

### Plan 03-04 — Feed and job detail

| Threat | Category | Severity | Disposition | Verified mitigation | Status |
|---|---|---|---|---|---|
| `03-04/T-3-15` | Tampering/elevation — stored XSS | critical | mitigate | Single DOMPurify render boundary with forbidden tags; plain-text fallback/reasons/gaps | closed |
| `03-04/T-3-16` | Tampering — unsafe apply URL | medium | mitigate | HTTPS-only, credential-free URL guard and `noreferrer` | closed |
| `03-04/T-3-SC` | Tampering — dependency supply chain | high | mitigate | Human legitimacy checkpoint and exact `dompurify@3.4.12` pin | closed |
| `03-04/T-3-17` | Information disclosure — cross-user feed | high | mitigate | Own-row `user_jobs` RLS; no service key in SPA | closed |

### Plans 03-05 and 03-06 — Retired notification subsystem

Migration `0024_remove_notifications.sql` unschedules `notify-tick`, drops its claim function and persistence tables, and the browser unregisters the retired service worker. Removal closes the notification attack surface more strongly than retaining its original mitigations.

| Threat | Category | Severity | Disposition | Verified mitigation | Status |
|---|---|---|---|---|---|
| `03-05/T-3-18` | Spoofing — notify invocation | high | mitigate | Runtime and schedule removed | closed |
| `03-05/T-3-19` | Information disclosure — subscriptions | high | mitigate | Subscription table removed | closed |
| `03-05/T-3-20` | DoS — notification spam/replay | high | mitigate | Sender, queue, schedule, and worker removed | closed |
| `03-05/T-3-21` | Information disclosure — push payload | medium | mitigate | Push delivery removed | closed |
| `03-05/T-3-22` | DoS — email quota | medium | mitigate | Email notification delivery removed | closed |
| `03-05/T-3-23` | Repudiation — delivery disputes | low | accept (historical) | No delivery occurs; risk retired | closed |
| `03-06/T-3-24` | Information disclosure — endpoint theft | high | mitigate | Subscription table and browser subscription removed | closed |
| `03-06/T-3-25` | Spoofing — unauthorized push | medium | mitigate | Push sender removed | closed |
| `03-06/T-3-26` | Elevation — service-worker scope | low | accept (historical) | Retired worker is actively unregistered; no notification fetch/push runtime remains | closed |

### Plan 03-08 — Freshness, isolation, and company identity

| Threat | Category | Severity | Disposition | Verified mitigation | Status |
|---|---|---|---|---|---|
| `03-08/T-3-18` | Tampering — hash/revision publication | high | mitigate | Server-derived semantic hash and revision CAS on terminal writes | closed |
| `03-08/T-3-19` | Elevation — maintenance latch | critical | mitigate | Service-only functions, strict UUIDs/two IDs, matching end, maximum TTL | closed |
| `03-08/T-3-20` | DoS — abandoned latch | critical | mitigate | Expired rows are inactive and TTL is database-bounded to five minutes | closed |
| `03-08/T-3-21` | Tampering — concurrent/late signals | critical | mitigate | Latch blocks nonmatching seeds and claims; CAS protects publication | closed |
| `03-08/T-3-22` | Information disclosure — proof/logs | high | mitigate | Bounded IDs, digests, counts, statuses; no raw private content | closed |
| `03-08/T-3-23` | Tampering — notification reintroduction | medium | mitigate | Notification-removal regression remains green | closed |
| `03-08/T-3-33` | Spoofing — fabricated company | high | mitigate | Only normalized or trimmed source names; identity-less rows withheld | closed |

### Plan 03-09 — Focused feed and cache

| Threat | Category | Severity | Disposition | Verified mitigation | Status |
|---|---|---|---|---|---|
| `03-09/T-3-24` | Tampering — stale focused cache | high | mitigate | Cancel/remove feed cache only after server signal succeeds, then refetch | closed |
| `03-09/T-3-25` | Repudiation — false save success | medium | mitigate | Success follows completed upsert/RPC; failures retain retry state | closed |
| `03-09/T-3-26` | Information disclosure — list overfetch | medium | mitigate | Bounded list excludes JD bodies; detail query is separate | closed |
| `03-09/T-3-27` | Elevation — cross-user feed | high | mitigate | Existing own-row `user_jobs` RLS remains authoritative | closed |
| `03-09/T-3-34` | Spoofing — company fallback | high | mitigate | Truthful joined/source names only; no invented fallback | closed |

### Plan 03-10 — Rollout and release evidence

| Threat | Category | Severity | Disposition | Verified mitigation | Status |
|---|---|---|---|---|---|
| `03-10/T-3-28` | Tampering — verifier claim isolation | critical | mitigate | Exact run and two-ID latch; mismatch/no-ID claims denied | closed |
| `03-10/T-3-29` | DoS — latch/cron not restored | critical | mitigate | Database TTL, finally cleanup, exact cron re-read; final audit active | closed |
| `03-10/T-3-30` | Repudiation — approval creep | critical | mitigate | Rollout approval and paid-run approval were distinct and exact | closed |
| `03-10/T-3-31` | Tampering — mutable release | high | mitigate | Git, migration, Edge, Cloudflare, asset path/hash evidence binding | closed |
| `03-10/T-3-32` | Information disclosure — evidence | high | mitigate | Evidence contains bounded identifiers/counts/statuses, not private content | closed |

### Plan 03-11 — Paid proof and final UAT

| Threat | Category | Severity | Disposition | Verified mitigation | Status |
|---|---|---|---|---|---|
| `03-11/T-3-35` | Repudiation — reused approval | critical | mitigate | One separately approved process, one owned call, no retry | closed |
| `03-11/T-3-36` | DoS — verifier cleanup | critical | mitigate | Disposable account, TTL/finally cleanup, exact manual synthetic-fixture cleanup, zero residue, cron active | closed |
| `03-11/T-3-37` | Tampering — organic work claimed/billed | critical | mitigate | Latch admitted only registered synthetic IDs; final proof observed one verifier-owned call | closed |
| `03-11/T-3-38` | Spoofing — provider/company display | high | mitigate | Truthful nonblank provider-normalized/source identity required and passed in UAT | closed |
| `03-11/T-3-39` | Tampering — source relevance bypass | high | mitigate | Unified post-dedup cheap-filter path and cross-provider/UAT evidence | closed |
| `03-11/T-3-40` | Information disclosure — proof record | high | mitigate | Final proof records bounded operational metadata only | closed |

## Accepted Risks Log

No active accepted risks. The two historical low-severity notification risks were retired when the entire notification subsystem was removed; they cannot recur without failing the notification-removal regression.

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|---|---:|---:|---:|---|
| 2026-07-20 | 52 | 52 | 0 | Codex, ASVS L1 artifact audit |

## Sign-Off

- [x] All threats have a disposition.
- [x] Historical accepted risks and their retirement are documented.
- [x] `threats_open: 0` confirmed at the configured `high` blocking threshold.
- [x] `status: verified` set in frontmatter.

**Approval:** verified 2026-07-20

---
phase: 02
slug: watchlist-ingestion-monitoring
status: verified
# threats_open counts OPEN threats at or above workflow.security_block_on (high).
threats_open: 0
asvs_level: 1
block_on: high
created: 2026-07-17
audit_mode: owner-accepted-without-verification
---

# Phase 02 — Watchlist Ingestion & Monitoring — Security

> Security sign-off by explicit risk acceptance. The project owner selected
> “Accept all open risks” on 2026-07-17. The controls proposed in PLAN.md were
> not independently audited in this run and are not represented as verified.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Browser → verify-board | User-supplied career URL reaches server-side detection and verification | Untrusted URL and board identifier |
| Edge functions → ATS/Adzuna | Scheduled functions fetch third-party job data | Public JSON, HTML, job metadata |
| pg_cron/pg_net → Edge functions | Scheduler invokes privileged ingestion functions | Shared cron secret and trigger payload |
| Edge functions → Postgres | Service-role clients write companies, jobs, snapshots, and health | Privileged database mutations |
| Internet → heartbeat | External monitoring reads a secret-gated liveness endpoint | Query secret and limited health state |
| Verification scripts → hosted project | Local scripts inspect and temporarily mutate hosted state | Secret-key credentials and disposable probe rows |
| Postgres → future browser renderer | Stored third-party descriptions may later be rendered | Untrusted HTML/text snapshots |

---

## Threat Register

All entries below are closed by the owner's bulk acceptance in `AR-02-BULK`,
not by an implementation audit. “Original plan” summarizes the control that
would need verification if this decision is revisited.

| Threat ID | Category | Component | Severity | Disposition | Original plan | Status |
|-----------|----------|-----------|----------|-------------|---------------|--------|
| T-02-01 | Tampering / SSRF | verify-board URL handling | high | accept | Exact-host allowlist and audited endpoint constructor | closed |
| T-02-02 | Elevation | verify-board invocation | medium | accept | Authenticated invocation enforced by JWT | closed |
| T-02-03 | Information disclosure | Shared companies table | low | accept | Deliberate shared-watchlist design; no anonymous grants | closed |
| T-02-04 | Denial of service | verify-board outbound fetch | low | accept | Two-user scope and one fetch per add attempt | closed |
| T-02-SC | Tampering / supply chain | Deno and web dependencies | low | accept | No new installs and pinned audited versions | closed |
| T-02-05 | Elevation | poll-tick invocation | high | accept | Mandatory `x-cron-secret` check | closed |
| T-02-06 | Tampering / stored XSS | Job description snapshots | medium | accept | Store-only Phase 2 posture and sanitize-at-render contract | closed |
| T-02-07 | Information disclosure | Service-role key | high | accept | Edge environment and gitignored script storage only | closed |
| T-02-08 | Tampering / integrity | Concurrent ingestion | low | accept | Database uniqueness and exclusive claim RPC | closed |
| T-02-09 | Denial of service | Oversized ATS responses | medium | accept | Bounded batch processing and lean response handling | closed |
| T-02-10 | Information disclosure | Adzuna credentials | high | accept | Edge secrets only; never exposed to SPA | closed |
| T-02-11 | Elevation | discovery-sweep invocation | high | accept | Mandatory `x-cron-secret` check | closed |
| T-02-12 | Information disclosure / spoofing | Public heartbeat | medium | accept | Secret gate and liveness-only response | closed |
| T-02-13 | Denial of service | Adzuna quota | medium | accept | Cadence plus UTC daily hard cutoff | closed |
| T-02-14 | Tampering / stored XSS | Adzuna description snippets | low | accept | Store-only posture and sanitize-at-render contract | closed |
| T-02-04-01 | Tampering | Reopen update | high | accept | Lifecycle-only update fields preserve snapshots | closed |
| T-02-04-02 | Denial of service | All-status company job load | low | accept | Small deployment and bounded retention assumption | closed |
| T-02-04-03 | Repudiation | Heartbeat truthfulness | medium | accept | Unit-tested heartbeat transition rules | closed |
| T-02-04-SC | Tampering / supply chain | Plan 04 dependencies | low | accept | No package installation | closed |
| T-02-05-01 | Tampering | Hosted verification probes | high | accept | Disposable rows and seed-preservation assertions | closed |
| T-02-05-02 | Elevation | `claim_due_companies` RPC | high | accept | Service-role-only grants and empty search path | closed |
| T-02-05-03 | Information disclosure | Script credentials | medium | accept | Gitignored `scripts/.env` convention | closed |
| T-02-05-04 | Denial of service | Concurrent claim probes | low | accept | `SKIP LOCKED` non-blocking behavior | closed |
| T-02-05-SC | Tampering / supply chain | Plan 05 dependencies | low | accept | No package installation | closed |
| T-02-06-01 | Denial of service | Adzuna free-tier quota | high | accept | Distinct-query deduplication, schedule budget, and hard cutoff | closed |
| T-02-06-02 | Information disclosure | Heartbeat response | medium | accept | Secret-gated liveness category only | closed |
| T-02-06-03 | Repudiation | Silent discovery failure | high | accept | Persisted status, HTTP 503, heartbeat and banner propagation | closed |
| T-02-06-04 | Spoofing | Sweep and heartbeat calls | medium | accept | Existing cron and heartbeat secret gates | closed |
| T-02-06-SC | Tampering / supply chain | Plan 06 dependencies | low | accept | No package installation | closed |
| T-02-07-01 | Tampering | Hosted schema push | high | accept | Additive-only migrations and remote list verification | closed |
| T-02-07-02 | Information disclosure | Deploy and verification credentials | medium | accept | Gitignored environment and hosted secret stores | closed |
| T-02-07-03 | Denial of service | Verification poll timing | low | accept | Probe changes remain within the normal due window | closed |
| T-02-07-SC | Tampering / supply chain | Deployment tooling | low | accept | Existing pinned Supabase CLI only | closed |

*Status `closed` here means accepted by the owner, not technically verified.*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-02-BULK | T-02-01 through T-02-14, T-02-SC, and T-02-04/05/06/07 sub-registers listed above | Project owner explicitly selected “Accept all open risks” to complete Phase 2 without running the implementation security auditor. This accepts the possibility that one or more planned mitigations is absent, misplaced, or bypassable. | Project owner | 2026-07-17 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed by verification | Closed by acceptance | Open | Run By |
|------------|---------------|------------------------|----------------------|------|--------|
| 2026-07-17 | 33 | 0 | 33 | 0 | Project owner acceptance via `$gsd-verify-work 02` |

---

## Sign-Off

- [x] All threats have a final disposition
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed by owner acceptance
- [x] `status: verified` set in frontmatter

**Approval:** accepted without implementation verification on 2026-07-17.

---

## Verification Limits

- No source-code or hosted-configuration security audit was performed in this run.
- No mitigation should be described elsewhere as independently verified based on this file.
- A future `$gsd-secure-phase 02` audit may replace this bulk acceptance with file-and-line evidence and may reopen threats if controls are absent.

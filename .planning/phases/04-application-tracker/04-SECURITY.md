---
phase: 04
slug: application-tracker
status: verified
threats_open: 0
asvs_level: 1
block_on: high
created: 2026-07-28
---

# Phase 04 — Security

## Trust Boundaries

| Boundary | Data crossing | Primary controls |
|---|---|---|
| Browser ↔ Supabase | Applications, events, notes, snapshots, and optional resume IDs | Authenticated RLS, owner-scoped RPCs, bounded inputs |
| Dashboard ↔ Tracker | System job snapshots and applied-stage transitions | Atomic `mark_job_applied`, stable system uniqueness |
| Tracker ↔ Resume Library | Optional private resume association | Owner-coupled foreign key and RPC validation |
| Release verifier ↔ production | Schema/catalog probes and temporary fixtures | Exact approval hashes, two ordinary sessions, constrained cleanup |
| Stored content ↔ browser | System HTML and manual text | DOMPurify for system HTML; plain-text manual JD and notes |

## Evidence Index

| Ref | Verified controls |
|---|---|
| E01 | Migration/RPC tests prove RLS, grants, owner checks, immutable provenance, final-event guard, and projection behavior |
| E02 | Hosted schema/catalog verification proves exact definitions, ACLs, triggers, constraints, Dashboard projections, and migration parity |
| E03 | Hosted two-session behavior verification proves same-owner success, cross-owner denial, resume-link denial, repeat/edit/delete ordering, and final-event rejection |
| E04 | UI/client review proves bounded validation, field-specific RPCs, lazy detail bodies, DOMPurify, plain-text notes/JD, and safe external URLs |
| E05 | Checksum-bound approvals and sanitized cleanup evidence prove target identity, artifact integrity, exact fixture lineage, and zero residue in seven relations |
| E06 | Full automated suite, production build, exact live-asset checksum, and successful Cloudflare release check |

## Threat Register

| Threat ID | Component | Severity | Disposition | Evidence | Status |
|---|---|---:|---|---|---|
| T-04-01-01 | applications/events RLS | high | mitigate | E01, E03 | closed |
| T-04-01-02 | definer RPCs | high | mitigate | E01, E02, E03 | closed |
| T-04-01-03 | system snapshots/origin | high | mitigate | E01, E03 | closed |
| T-04-01-04 | resume association | high | mitigate | E01, E03 | closed |
| T-04-01-05 | URLs and text inputs | high | mitigate | E01, E04 | closed |
| T-04-01-06 | event/current-stage projection | high | mitigate | E01, E03 | closed |
| T-04-01-07 | backfill/idempotent Mark Applied | medium | mitigate | E01, E02, E03 | closed |
| T-04-01-SC | dependency supply chain | low | accept | E06 | closed |
| T-04-02-01 | owner approval | high | mitigate | E05 | closed |
| T-04-02-02 | migration inventory | high | mitigate | E02, E05 | closed |
| T-04-02-03 | Supabase access token | high | mitigate | E05 | closed |
| T-04-02-04 | production schema/data | high | mitigate | E02, E05 | closed |
| T-04-02-05 | preflight artifacts | medium | mitigate | E05 | closed |
| T-04-02-06 | ephemeral service-role key | high | mitigate | E05 | closed |
| T-04-02-07 | privileged fixture mutations | high | mitigate | E03, E05 | closed |
| T-04-02-08 | behavior verifier authority | high | mitigate | E03 | closed |
| T-04-02-SC | dependency supply chain | low | accept | E06 | closed |
| T-04-03-01 | schema push | high | mitigate | E02, E05 | closed |
| T-04-03-02 | hosted catalog parity | high | mitigate | E02 | closed |
| T-04-03-03 | service-role discovery | high | mitigate | E05 | closed |
| T-04-03-04 | fixture setup/removal/cleanup | high | mitigate | E03, E05 | closed |
| T-04-03-05 | applications/events/RPC isolation | high | mitigate | E02, E03 | closed |
| T-04-03-06 | resume linking | high | mitigate | E03 | closed |
| T-04-03-07 | event projection | high | mitigate | E02, E03 | closed |
| T-04-03-08 | verification evidence | medium | mitigate | E05 | closed |
| T-04-03-SC | dependency supply chain | low | accept | E06 | closed |
| T-04-04-01 | manual/text/date/stage inputs | high | mitigate | E01, E04 | closed |
| T-04-04-02 | resume association | high | mitigate | E01, E03, E04 | closed |
| T-04-04-03 | stored JD/notes | high | mitigate | E04 | closed |
| T-04-04-04 | external URLs | high | mitigate | E01, E04 | closed |
| T-04-04-05 | autosave ordering | medium | mitigate | E01, E04 | closed |
| T-04-04-06 | event projection | high | mitigate | E01, E03, E04 | closed |
| T-04-04-07 | list/detail payloads | medium | mitigate | E04 | closed |
| T-04-04-SC | dependency supply chain | low | accept | E06 | closed |
| T-04-05-01 | Mark Applied target | high | mitigate | E01, E03 | closed |
| T-04-05-02 | Show applied disclosure | high | mitigate | E01, E04 | closed |
| T-04-05-03 | Tracker focus parameter | high | mitigate | E04 | closed |
| T-04-05-04 | optimistic Active removal | medium | mitigate | E01, E04 | closed |
| T-04-05-05 | historical Apply URL | high | mitigate | E04 | closed |
| T-04-05-SC | dependency supply chain | low | accept | E06 | closed |

## Accepted Risks Log

| Risk ID | Threat refs | Rationale | Accepted by | Date |
|---|---|---|---|---|
| AR-01 | T-04-01-SC, T-04-02-SC, T-04-03-SC, T-04-04-SC, T-04-05-SC | Phase 04 installed no package or registry block and reused the repository lockfile and project-owned scripts | Phase plans | 2026-07-28 |

## Security Audit Trail

| Audit date | Threats total | Closed | Open | Run by |
|---|---:|---:|---:|---|
| 2026-07-28 | 40 | 40 | 0 | root inline ASVS L1 audit |

## Sign-Off

- [x] Every planned threat has a disposition.
- [x] Accepted risks are documented.
- [x] Every high-severity mitigation is present in source and supported by
  automated or hosted evidence.
- [x] Runtime verification left no fixture residue.
- [x] `threats_open: 0`.
- [x] `status: verified`.

**Approval:** verified 2026-07-28


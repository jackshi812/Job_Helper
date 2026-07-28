# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into
future planning.*

## Milestone: v1.0 — MVP

**Shipped:** 2026-07-28
**Phases:** 15 | **Plans:** 88 | **Recorded tasks:** 208

### What Was Built

- Invite-only two-user authentication with private personal data and a shared
  monitored-company/raw-job catalog.
- Scheduled multi-provider monitoring with exact identities, deduplication,
  immutable snapshots, lifecycle reconciliation, and visible degradation.
- Reproducible deterministic ranking with stored six-category evidence.
- Watchlist-first and combined job feeds with source-aware server pagination.
- Private DOCX resume management and a six-stage application tracker.
- Exact production release evidence across Supabase migrations, Cloudflare
  source/asset identity, automated tests, owner UAT, and disposable verifiers.

### What Worked

- Forward-only migrations kept already-deployed history immutable and made each
  production repair independently reviewable.
- Exact commit, migration, verifier, and asset hashes prevented stale-release
  acceptance.
- Disposable production fixtures exercised real authorization and cleanup
  behavior without mutating either invited user's data.
- Owner UAT at the end of each user-visible slice caught density, navigation,
  and lifecycle expectations that automated tests could not infer.

### What Was Inefficient

- Provider-specific rollout evidence and approval loops produced a large
  planning history that became costly to navigate.
- Several hosted-only PostgreSQL and provider-contract differences were found
  after local verification, requiring small forward repairs.
- UAT status labels and completed/superseded todo files were not normalized as
  work closed, leaving eight bookkeeping records at milestone close.

### Patterns Established

- Treat network/provider recognition separately from execution authority.
- Fail closed on incomplete source observations and preserve last-known jobs.
- Apply user/source/tracker scope before any outward pagination limit.
- Delete storage first, then transactional database state, and verify zero
  residue with an isolated account.
- Index every foreign-key/owner column used by bulk deletion or cascades.

### Key Lessons

1. A release is not complete until the exact hosted runtime passes the same
   invariant that local tests claim.
2. Cleanup verification needs representative rows in every current relation;
   schema evolution otherwise creates silent retention gaps.
3. Planning artifacts should be reconciled when work closes, not deferred to
   milestone archival.
4. Exact-source allowlists and immutable evidence are worth the overhead for
   brittle third-party career portals.

### Cost Observations

- Model mix: not reliably recorded.
- Sessions: not reliably recorded.
- Notable: deterministic ranking eliminated background paid job-scoring calls;
  the largest cost was verification and provider-integration effort.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | not recorded | 15 | Exact-release manifests, disposable hosted verification, and forward-only repair migrations |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v1.0 | 1,561 | not measured | not measured |

### Top Lessons (Verified Across Milestones)

1. Hosted verification must remain bound to immutable release identity.
2. Reconcile UAT/todo metadata continuously so closeout reflects product truth.

---
status: complete
phase: 01-foundation-access
source: [01-01-SUMMARY.md, 01-02-SUMMARY.md, 01-03-SUMMARY.md]
started: 2026-07-16T17:16:13Z
updated: 2026-07-16T20:41:58Z
---

## Current Test

[testing complete]

## Tests

### 1. Logged-out outsider view
expected: A private-window visitor sees only the minimal Job Copilot login form, with no signup path or private application content.
result: pass
evidence: Human production check at `https://job-helper-qs9.pages.dev`.

### 2. User 1 deployed session persistence
expected: User 1 can sign in, refresh, and reopen the tab without losing the session.
result: pass
evidence: Human production refresh and tab-reopen check.

### 3. User 2 deployed session persistence
expected: User 2 can sign in, refresh, and reopen the tab without losing the session.
result: pass
evidence: Human production refresh and tab-reopen check.

### 4. User 2 production password recovery
expected: A fresh recovery email arrives, recovery completes at the deployed reset page, the new password authenticates, and the previous password is rejected.
result: pass
evidence: Gmail custom SMTP delivered a fresh six-digit OTP; the deployed manual-OTP flow accepted it, changed the password, signed out the recovery session, accepted the new password, and rejected the previous password. `scripts/.env` was updated locally afterward.
notes: The initial clickable-link flow failed because email security prefetch consumed the one-time link. Commits `4b7ae84` and `ff2cf69` added recovery-session gating and the scanner-resistant OTP flow. See `.planning/debug/resolved/password-reset-production.md`.

### 5. Delete-all confirmation and cross-user isolation
expected: Exact `DELETE` enables bulk deletion; User 2 rows and objects disappear while User 1's disposable resume remains, after which User 1 can remove that probe normally.
result: pass
evidence: Human production UAT passed upload for both users, exact-confirmation gating, User 2 bulk deletion, User 1 isolation, and final probe cleanup.

### 6. Accelerated refresh-token persistence proxy
expected: Both users' stored sessions can be handed to fresh clients and renewed with refresh tokens without changing user identity.
result: pass
evidence: Both current seed credentials authenticated; fresh Supabase clients renewed each refresh token for the same user identity; all temporary local sessions were cleaned up.
notes: Accepted as an accelerated proxy for the next-day revisit because it exercises the same refresh-token renewal invariant without waiting a calendar day.

## Summary

total: 6
passed: 6
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

None. The one issue discovered during UAT was fixed, deployed, and reverified before this record was completed.

## Resolved During UAT

- Production password recovery originally failed when a mail scanner consumed the reset link. Recovery-session gating, manual OTP verification, Gmail custom SMTP, a `{{ .Token }}` template, and six-digit OTP alignment resolved it. Full evidence is preserved in `.planning/debug/resolved/password-reset-production.md`.

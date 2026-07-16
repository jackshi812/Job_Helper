---
phase: 01-foundation-access
plan: 03
subsystem: auth-security-deployment
tags: [supabase-auth, otp-recovery, cloudflare-pages, storage, rls, vitest]

requires:
  - phase: 01-01
    provides: Invite-only authentication, hosted schema, private storage, and delete-my-data RPC
  - phase: 01-02
    provides: Secure resume lifecycle and executable two-user RLS isolation proof
provides:
  - Functional password-change and exact-confirmation delete-all Settings flows
  - Break-glass local admin reset and executable destructive-deletion proof
  - Deployed Cloudflare Pages SPA with production Supabase auth configuration
  - Scanner-resistant six-digit OTP password recovery through custom SMTP
  - Completed production UAT and Phase 1 verification evidence
affects: [phase-02-ingestion, future-auth-flows, future-user-owned-data]

tech-stack:
  added: [Cloudflare Pages, Gmail custom SMTP]
  patterns: [storage-first bulk deletion, fail-closed destructive preflight, recovery OTP before password update, local sign-out after recovery]

key-files:
  created:
    - web/src/components/TypeToConfirmDialog.tsx
    - scripts/admin-reset-password.ts
    - scripts/verify-deletion.ts
    - web/src/auth/passwordRecovery.ts
    - .planning/phases/01-foundation-access/01-UAT.md
    - .planning/phases/01-foundation-access/01-VERIFICATION.md
  modified:
    - web/src/pages/Settings.tsx
    - web/src/pages/Login.tsx
    - web/src/pages/ResetPassword.tsx
    - web/src/auth/AuthProvider.tsx

key-decisions:
  - "Delete-all remains storage-first and may invoke the database RPC only after exact object-removal counts match."
  - "Use a user-entered recovery OTP instead of a clickable one-time link because email-security prefetch can consume ConfirmationURL before the user opens it."
  - "Sign out the temporary recovery session locally after changing the password, while retaining safe confirmed-session compatibility."
  - "Treat the Supabase SDK's static sb_secret_ detector as a scan false positive and verify the configured secret value plus value-shaped tokens instead."

patterns-established:
  - "Destructive verifier: inspect existing data, require explicit wipe authorization when non-empty, create one probe, delete storage first, run the RPC, and assert both persistence layers are empty."
  - "Recovery workflow: request email, manually verify the six-digit recovery OTP, update the password only with the resulting session, then clear the local session."

requirements-completed: [AUTH-01, AUTH-02, AUTH-04]

coverage:
  - id: D1
    description: "Settings changes passwords and performs exact-confirmation, storage-first delete-all with count assertions."
    requirement: AUTH-04
    verification:
      - kind: unit
        ref: "web/src/pages/Settings.test.ts (11-test baseline plus current full suite)"
        status: pass
      - kind: manual_procedural
        ref: "01-UAT.md#5-delete-all-confirmation-and-cross-user-isolation"
        status: pass
    human_judgment: false
  - id: D2
    description: "The SPA is deployed at the Pages URL with production auth URLs and no public signup surface."
    requirement: AUTH-01
    verification:
      - kind: manual_procedural
        ref: "01-UAT.md#1-logged-out-outsider-view"
        status: pass
      - kind: integration
        ref: "Cloudflare production root and /reset-password HTTP 200 checks"
        status: pass
    human_judgment: false
  - id: D3
    description: "Delete-all removes both rows and storage objects without crossing the User 2 isolation boundary."
    requirement: AUTH-04
    verification:
      - kind: e2e
        ref: "node --env-file=scripts/.env scripts/verify-deletion.ts (authorized live run)"
        status: pass
      - kind: e2e
        ref: "node --env-file=scripts/.env scripts/verify-rls.ts (post-delete regression)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Both deployed users retain sessions through refresh/reopen and refresh-token renewal."
    requirement: AUTH-02
    verification:
      - kind: manual_procedural
        ref: "01-UAT.md#2-user-1-deployed-session-persistence"
        status: pass
      - kind: manual_procedural
        ref: "01-UAT.md#3-user-2-deployed-session-persistence"
        status: pass
      - kind: e2e
        ref: "01-UAT.md#6-accelerated-refresh-token-persistence-proxy"
        status: pass
    human_judgment: false
  - id: D5
    description: "User 2 receives a recovery code and can replace the password while the previous password stops working."
    requirement: AUTH-01
    verification:
      - kind: unit
        ref: "web/src/auth/passwordRecovery.test.ts and web/src/pages/ResetPassword.test.tsx"
        status: pass
      - kind: manual_procedural
        ref: "01-UAT.md#4-user-2-production-password-recovery"
        status: pass
    human_judgment: false

duration: 3h 26m
completed: 2026-07-16
status: complete
---

# Phase 1 Plan 3: Secure Settings, Production Deployment, and Recovery Summary

**Production Job Copilot with count-asserted account deletion, persistent two-user sessions, and scanner-resistant Supabase OTP password recovery**

## Performance

- **Duration:** 3h 26m, including dashboard deployment, production debugging, and UAT
- **Started:** 2026-07-16T17:16:13Z
- **Completed:** 2026-07-16T20:41:58Z
- **Tasks:** 3
- **Files modified:** 16 implementation, test, verification, and debug artifacts

## Accomplishments

- Replaced the Settings placeholder with current-password reauthentication, inline feedback, and a hard delete-all flow gated by the exact word `DELETE`.
- Proved live bulk deletion removes every User 1 resume row and Storage object, then reran the independent two-user RLS probe with zero cross-user leaks.
- Deployed the Git-connected Vite SPA to `https://job-helper-qs9.pages.dev` and configured production plus localhost auth redirects without exposing privileged keys.
- Diagnosed email-link prefetch during production UAT and shipped a six-digit OTP recovery path through custom SMTP; User 2's new password works and the previous password fails.
- Completed six production UAT checks covering outsider view, both users' session persistence, recovery, delete-all isolation, and refresh-token renewal.

## Task Commits

1. **Task 1 RED: Settings security behavior tests** - `bee7431` (test)
2. **Task 1 GREEN: Secure account settings and recovery fallback** - `491cfec` (feat)
3. **Task 2: Cloudflare Pages deploy and Supabase production URLs** - dashboard checkpoint; production deployed successfully
4. **Task 3: Executable destructive-deletion proof** - `b7871f5` (test)
5. **Task 3 UAT fix: Gate reset on a confirmed recovery session** - `4b7ae84` (fix)
6. **Task 3 UAT fix: Use manual OTP password recovery** - `ff2cf69` (fix)

## Files Created/Modified

- `web/src/pages/Settings.tsx` - Password change plus paginated, batched, storage-first delete-all.
- `web/src/components/TypeToConfirmDialog.tsx` - Accessible exact-text destructive confirmation.
- `scripts/admin-reset-password.ts` - Local-only privileged recovery fallback.
- `scripts/verify-deletion.ts` - Fail-closed live proof that rows and objects are both removed.
- `web/src/auth/passwordRecovery.ts` - Ordered OTP verification, password update, and local sign-out.
- `web/src/pages/Login.tsx` - Recovery request that routes to manual OTP entry.
- `web/src/pages/ResetPassword.tsx` - Recovery-session gate plus six-digit OTP form.
- `web/src/auth/AuthProvider.tsx` - Explicit recovery lifecycle state.
- `.planning/debug/resolved/password-reset-production.md` - Root-cause and production rollout record.
- `.planning/phases/01-foundation-access/01-UAT.md` - Six-item completed production UAT record.
- `.planning/phases/01-foundation-access/01-VERIFICATION.md` - Goal-backward Phase 1 verification report.

## Decisions Made

- Kept all bulk deletion storage-first so a failed object removal leaves retryable database metadata instead of an invisible orphan file.
- Switched the primary production recovery mechanism from `ConfirmationURL` to a manually entered `{{ .Token }}` OTP because email security prefetch can consume clickable one-time links.
- Required a successful recovery session before password mutation and cleared that temporary session locally after completion.
- Used exact-value and value-shaped secret scans because Supabase JS legitimately embeds the static `sb_secret_` prefix detector in its public bundle.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Security bug] Blocked password mutation without a valid recovery session**
- **Found during:** Task 3 production UAT
- **Issue:** The public reset route rendered an active password form even when a reset callback had been consumed or invalid, so `updateUser` ran without a usable recovery session.
- **Fix:** Added explicit recovery callback classification, provider state, UI gating, generic safe errors, and lifecycle cleanup.
- **Files modified:** `web/src/auth/AuthProvider.tsx`, `web/src/auth/recovery.ts`, `web/src/pages/ResetPassword.tsx`, related tests
- **Verification:** RED/GREEN recovery tests plus full build and production behavior.
- **Committed in:** `4b7ae84`

**2. [Rule 2 - Missing critical resilience] Added scanner-resistant recovery OTP**
- **Found during:** Task 3 production UAT
- **Issue:** Email security prefetch could consume Supabase's clickable one-time recovery URL before the user opened it.
- **Fix:** Added email-and-token recovery OTP verification before password update, kept inputs out of URLs and logs, configured custom SMTP, changed the hosted template to `{{ .Token }}`, and aligned OTP length to six digits.
- **Files modified:** `web/src/auth/passwordRecovery.ts`, `web/src/pages/Login.tsx`, `web/src/pages/ResetPassword.tsx`, related tests
- **Verification:** 25/25 tests, successful production build, and a fresh live User 2 recovery round trip.
- **Committed in:** `ff2cf69`

**3. [Rule 1 - Verification correctness] Replaced a false-positive literal secret-prefix gate**
- **Found during:** Task 3 secret scan
- **Issue:** Supabase JS's public bundle contains the literal `sb_secret_` solely to detect key types, so a naive prefix grep fails even when no secret value is shipped.
- **Fix:** Verified the configured secret value and value-shaped secret tokens are absent from source/build output and that no example exposes a Vite-prefixed privileged variable.
- **Files modified:** Verification records only
- **Verification:** Exact-value and value-shaped scans pass after a fresh build.

---

**Total deviations:** 3 auto-fixed (2 security/correctness fixes, 1 verification correction)
**Impact on plan:** All changes were required to prove the planned production recovery and secret-boundary outcomes; no product scope was added.

## Issues Encountered

- Cloudflare's dashboard initially routed to Worker creation; the deployment was corrected to Pages with root `web`, build `npm run build`, and output `dist`.
- Supabase's default mail provider would not accept the custom recovery template. Gmail custom SMTP enabled the six-digit token template.
- Gmail initially rejected the SMTP credential; replacing the App Password fixed delivery.
- Hosted OTP length was initially eight while the deployed form expected six. The exposed test code was discarded, the setting was aligned to six, and a fresh code passed.
- Lint exits zero with one pre-existing Fast Refresh warning in `AuthProvider.tsx`. Vite also reports a non-blocking approximately-500-kB chunk advisory.

## Authentication Gates

- Task 1 required explicit approval before pushing the implementation to the existing GitHub remote.
- Task 2 required the user to connect the repository in Cloudflare Pages and enter publishable frontend variables.
- Production recovery required user-managed Gmail SMTP configuration and human entry of the fresh OTP. No credentials or OTP values were recorded here.

## Known Stubs

None in Plan 01-03 files. Watchlist and Tracker remain intentional shell destinations assigned to later roadmap phases.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: recovery-input | `web/src/auth/passwordRecovery.ts` | Email and one-time recovery code cross the browser/Auth boundary; inputs are POSTed directly to Supabase, never serialized into URLs or logs, and the temporary session is locally signed out after password change. |

## User Setup Required

Completed: Cloudflare Pages Git integration, production build variables, Supabase URL allowlist, Gmail custom SMTP, six-digit OTP length, and the `{{ .Token }}` recovery template are live.

## Accepted Operational Risks

- The Supabase free project may pause after roughly seven inactive days until Phase 2's scheduled pipeline keeps it active; recovery is a short manual dashboard restore.
- The free tier has no dependable backups. Make a manual export before storing irreplaceable resumes or production data.

## Next Phase Readiness

- Phase 1's invite-only auth, persistent sessions, production recovery, private storage, delete-all behavior, and two-user RLS boundary are verified.
- Phase 2 can build ingestion and monitoring tables by copying the established owner-scoped RLS pattern.
- No Phase 1 blocker or open UAT gap remains.

## Self-Check: PASSED

All listed artifacts exist; commits `bee7431`, `491cfec`, `b7871f5`, `4b7ae84`, and `ff2cf69` resolve; 25 tests, lint, and the production build pass; live deletion/RLS evidence and all six UAT items are recorded.

---
*Phase: 01-foundation-access*
*Completed: 2026-07-16*

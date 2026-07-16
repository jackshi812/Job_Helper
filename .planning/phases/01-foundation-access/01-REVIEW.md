---
phase: 01-foundation-access
reviewed: 2026-07-16T00:00:00Z
depth: standard
files_reviewed: 19
files_reviewed_list:
  - scripts/admin-reset-password.ts
  - scripts/seed-users.ts
  - scripts/verify-auth.ts
  - scripts/verify-deletion.ts
  - scripts/verify-rls.ts
  - supabase/migrations/0001_profiles.sql
  - supabase/migrations/0002_resumes.sql
  - supabase/migrations/0003_storage.sql
  - supabase/migrations/0004_delete_my_data.sql
  - web/package.json
  - web/src/auth/AuthProvider.tsx
  - web/src/auth/passwordRecovery.ts
  - web/src/components/ConfirmDialog.tsx
  - web/src/components/TypeToConfirmDialog.tsx
  - web/src/lib/resumes.ts
  - web/src/pages/Login.tsx
  - web/src/pages/ResetPassword.tsx
  - web/src/pages/Resumes.tsx
  - web/src/pages/Settings.tsx
findings:
  critical: 1
  warning: 4
  info: 3
  total: 8
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-07-16
**Depth:** standard
**Files Reviewed:** 19
**Status:** issues_found

## Summary

Phase 1 delivers invite-only auth, per-user RLS isolation, a resume upload/list/download/delete slice, settings (password change + type-DELETE wipe), OTP-based password recovery, and admin/verification scripts. The RLS migrations are solid: `(select auth.uid())`-scoped policies on `profiles`, `resumes`, and `storage.objects`; `security definer` trigger with an empty `search_path`; `security invoker` `delete_my_data()`; and the secret key correctly confined to server-side scripts (web uses the publishable key only). The storage-first delete-with-count-assertion pattern is present in both the app and the verification scripts.

The most serious concern is that the "confirm your current password" control in the password-change flow relies on a Supabase/GoTrue server-side flag that is nowhere set in this repo and is off by default — meaning the reauthentication may silently no-op. Remaining issues are robustness/consistency defects around blob-URL lifetime, partial-delete orphaning, and an RLS invariant that does not bind storage paths to the owning user's folder.

## Critical Issues

### CR-01: Current-password reauthentication is not guaranteed to be enforced

**File:** `web/src/pages/Settings.tsx:14-21`
**Issue:** `changePassword` calls `supabase.auth.updateUser({ current_password, password })`. The `@supabase/auth-js` type docs (`node_modules/@supabase/auth-js/dist/module/lib/types.d.ts:378-385`) state `current_password` is honored **only** when `GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD` is enabled server-side. That flag defaults to off and is set nowhere in this repository (no config or migration references it). If it is not enabled on the hosted project, the `current_password` value is ignored: anyone holding a live session (e.g. an unattended/hijacked browser tab) can change the account password without knowing the current one, while the UI text ("Confirm your current password before choosing a new one") gives false assurance. The phase's own SECURITY/UAT intent treats current-password confirmation as a control; a control that silently no-ops is a security gap.
**Fix:** Enforce reauthentication in a way the code can guarantee rather than depending on an unverified server flag. Either (a) confirm and document that `GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD=true` is set on the project and add a verification script/assertion for it, or (b) explicitly reauthenticate before the update:
```ts
// Re-verify the current password before allowing the change.
const { error: reauthError } = await supabase.auth.signInWithPassword({
  email: session.user.email!,
  password: currentPassword,
})
if (reauthError) throw reauthError
const { error } = await supabase.auth.updateUser({ password: newPassword })
if (error) throw error
```

**Verification (2026-07-16):** CONFIRMED by empirical probe. A non-mutating two-call
`updateUser` test (wrong vs real `current_password`, new password == current) returned the
identical `same_password` error both times — the wrong current password was never rejected,
proving `current_password` is ignored on the hosted project. Original password unchanged.
**Fix chosen: option (a)** — enable Supabase project flag
`security_update_password_require_reauthentication` (dashboard → Authentication → Email
provider → secure password change). No code change; existing `current_password` field starts
being enforced. Re-run the probe to confirm enforcement, then close CR-01 / T-01-07.

## Warnings

### WR-01: Object URL revoked immediately after `click()` can truncate downloads

**File:** `web/src/pages/Resumes.tsx:60-65`
**Issue:** `handleDownload` calls `anchor.click()` and then `URL.revokeObjectURL(objectUrl)` synchronously on the next line. For anything but tiny blobs, some browsers have not yet committed the download when the URL is revoked, causing an intermittently failed or truncated download of the resume the user is trying to retrieve.
**Fix:** Defer revocation so the browser can start the transfer first:
```ts
anchor.click()
setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
```

### WR-02: Partial-failure paths leave orphaned rows / objects in the resume slice

**File:** `web/src/lib/resumes.ts:57-60, 81-91`
**Issue:** Two consistency gaps: (1) In `uploadResume`, when the row insert fails, `bucket.remove([storagePath])` is called but its return value/error is ignored — a failed rollback silently leaves an orphaned storage object counting against the 1 GB quota. (2) In `deleteResume`, storage removal succeeds first and then the row delete runs; if `supabase.from('resumes').delete()` errors, the DB row survives while its file is already gone, so the resume keeps appearing in the list but every download 404s. The storage-first ordering is intentional, but the row-delete failure is not surfaced as a recoverable/orphaned state.
**Fix:** Check the rollback result in `uploadResume` (log/throw if `remove` fails), and in `deleteResume` treat a post-storage row-delete failure as a distinct "record now orphaned — retry" error so the UI/user understands the inconsistent state.

### WR-03: `resumes` INSERT policy does not bind `storage_path` to the owner's folder

**File:** `supabase/migrations/0002_resumes.sql:20-22`
**Issue:** The insert policy checks only `(select auth.uid()) = user_id`. Nothing constrains `storage_path`, so an authenticated user can insert a row whose `storage_path` references another user's folder prefix (e.g. `'<otherUserId>/x.docx'`). Storage RLS still blocks reading the bytes, so this is not a direct data leak, but it breaks the per-user path invariant the rest of the system assumes (`${userId}/...`) and could poison list/delete bookkeeping or future joins across the resumes table and storage.
**Fix:** Add a `with check` predicate that ties the path to the owner, e.g. `with check ((select auth.uid()) = user_id and storage_path like (select auth.uid()::text) || '/%')`.

### WR-04: `ResetPassword` "ready" path failure dead-ends with no OTP fallback

**File:** `web/src/pages/ResetPassword.tsx:47-51, 73, 80`
**Issue:** When `recoveryStatus === 'ready'` (confirmed recovery session) and `resetPasswordFromConfirmedSession` fails with `session_invalid`, `setSessionInvalid(true)` forces `effectiveRecoveryStatus` to `'invalid'`, which renders the "Reset link unavailable" screen. The user cannot fall back to manually entering the emailed six-digit OTP in the same visit and must restart from the login page. Given that manual OTP entry is the primary recovery mechanism for this app, a transient confirmed-session failure should degrade to the OTP form rather than a terminal error.
**Fix:** On `session_invalid` during the "ready" path, drop back to the OTP entry form (reveal the email/code fields) instead of switching to the terminal `invalid` view.

## Info

### IN-01: Brittle deep import into `web/node_modules` internal dist path

**File:** `scripts/admin-reset-password.ts:1`, `scripts/seed-users.ts:1`, `scripts/verify-auth.ts:1`, `scripts/verify-deletion.ts:2`, `scripts/verify-rls.ts:2`
**Issue:** Every script imports `createClient` from `../web/node_modules/@supabase/supabase-js/dist/index.mjs`. Reaching into another package's `node_modules` and pinning the internal `dist/index.mjs` file path is fragile — it breaks on any packaging change or if the scripts are run from a workspace that hoists dependencies elsewhere.
**Fix:** Add `@supabase/supabase-js` as a dependency for the scripts' own package and import via the bare specifier `@supabase/supabase-js`.

### IN-02: Dependency versions run ahead of the documented/known stack

**File:** `web/package.json:19,29-30`
**Issue:** `react-router` is pinned to `8.2.0` (CLAUDE.md specifies `^7` library mode), and `typescript` `6.0.2` / `vite` `8.1.1` are ahead of the versions the project docs and current known releases describe. This may be intentional pinning to future releases, but it is worth confirming these resolve to real, compatible packages rather than accidental typos, since a wrong major here would silently change routing/build behavior.
**Fix:** Confirm the intended majors and either align with the documented stack (`react-router ^7`, `vite ^7`, `typescript ^5`) or update CLAUDE.md to record the deliberate upgrade.

### IN-03: `profiles_update_own` permits arbitrary email mutation

**File:** `supabase/migrations/0001_profiles.sql:15-17`
**Issue:** The update policy has a `using` clause but no `with check` (Postgres falls back to `using` for the check, so `id` cannot be re-parented — good). However, an authenticated user can freely overwrite their own `profiles.email` to any string, including impersonating another user's address in this mirror column. It is not an auth identity (auth.users is the source of truth), so impact is low, but the mirror can drift from the real login email.
**Fix:** If the email mirror is meant to track `auth.users`, remove `update` from the grant (keep it maintained only by the `handle_new_user` trigger / an auth-change trigger) or add a `with check` that forbids editing `email`.

---

_Reviewed: 2026-07-16_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

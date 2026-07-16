---
quick_id: 260716-nw6
slug: enforce-current-password-reauthenticatio
description: Enforce current-password reauthentication in Settings changePassword
status: complete
completed: 2026-07-16
commit: def0e91
---

# Quick Task 260716-nw6 — Summary

## What changed

Closed code-review **CR-01** / security **T-01-07**: the password-change flow's
current-password check was a silent no-op because it relied on the Supabase project flag
`security_update_password_require_reauthentication`, which is off on this project (and did
not take effect when toggled in the dashboard).

Reauthentication now runs in application code, independent of any dashboard flag:

- `web/src/lib/supabase.ts` — new `reauthenticate(email, password)` helper spins up an
  isolated Supabase client (`persistSession: false`, `autoRefreshToken: false`) and calls
  `signInWithPassword`, returning `{ error }`. The isolated client avoids disturbing the
  active session or firing `onAuthStateChange`.
- `web/src/pages/Settings.tsx` — `changePassword(email, currentPassword, newPassword)` now
  reauthenticates first and throws on failure, then calls `updateUser({ password })` (the
  ignored `current_password` field is dropped). The component passes `session.user.email`.
- `web/src/pages/Settings.test.ts` — updated the reauth test to the new contract and added a
  regression proving a failed reauth throws and never calls `updateUser`.

## Verification

- `npm run test` → 26/26 pass (was 25; +1 regression test)
- `npm run lint` → clean (only the pre-existing AuthProvider Fast Refresh warning)
- `npm run build` → typecheck + production build pass

## Records updated

- `01-REVIEW.md` — CR-01 marked RESOLVED with the pivot from option (a) to option (b)
- `01-SECURITY.md` — T-01-07 flipped back to closed; audit trail + sign-off amended; `threats_open` back to 0

## Notes

`scripts/verify-reauth.ts` (added earlier) still reports the *server flag* as off — that is
expected. The code path no longer depends on it; the script remains a useful signal if the
dashboard flag is ever enabled as defense-in-depth.

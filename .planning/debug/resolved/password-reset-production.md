---
status: resolved
trigger: "Production password recovery opens the reset page, but submitting a new password reports that it cannot update and asks for a new reset link. The attempted new credentials are then rejected at login."
created: 2026-07-16
updated: 2026-07-16T20:30:00Z
---

# Debug Session: Production Password Reset

## Symptoms

- Expected behavior: The User 2 recovery email opens the production `/reset-password` route, accepts a new password, and the new password signs in while the old password fails.
- Actual behavior: The recovery link opens the reset form, but submitting the new password shows `Unable to update password. Request a new reset link and try again.` The attempted new credentials are rejected at login.
- Error messages: `Unable to update password. Request a new reset link and try again.` and `Unable to complete request. Check your details and try again.`
- Timeline: First observed during Phase 1 production UAT on 2026-07-16; no successful production recovery has been observed.
- Reproduction: Sign out, request a User 2 password-reset email, open the email link at the production Pages domain, enter a new password, and submit.

## Current Focus

- hypothesis: Confirmed. Manual OTP recovery avoids email-link prefetch consumption by verifying the user-entered email and `{{ .Token }}` with `verifyOtp({ email, token, type: 'recovery' })` before `updateUser`.
- test: Passed. Production delivered a fresh six-digit code through Gmail custom SMTP; User 2 completed the reset and verified new-password success plus previous-password rejection.
- expecting: Achieved. The email displayed a six-digit code, manual OTP verification created the recovery session, the password updated, the session signed out, and only the new password authenticated.
- next_action: None; debug session resolved. Continue Phase 1 manual UAT.
- reasoning_checkpoint:
    hypothesis: "Email security prefetch can consume ConfirmationURL before the user clicks it; a manually entered recovery OTP avoids that request-time link consumption and yields the authenticated session required by updateUser."
    confirming_evidence:
      - "Supabase documents email prefetch as consuming ConfirmationURL and recommends displaying {{ .Token }} plus verifyOtp."
      - "Installed auth-js accepts email, token, and type recovery; it stores the returned session and emits PASSWORD_RECOVERY before returning."
      - "The existing page already updates passwords correctly once a recovery session is confirmed."
    falsification_test: "If verifyOtp with type recovery did not return/store a session or could not precede updateUser in the installed client, the proposed sequence test and TypeScript build would fail."
    fix_rationale: "Collecting email and OTP in the app and verifying via POST removes the email-client GET link as the one-time-token consumer, while keeping password update behind an authenticated recovery session."
    blind_spots: "The live email still contains ConfirmationURL until the app is deployed and the hosted recovery template is changed; end-to-end verification must wait for that ordered rollout."
- tdd_checkpoint:

## Evidence

- timestamp: 2026-07-16T14:11:40-05:00
  observation: The production reset route rendered correctly, but the password update returned the app's generic invalid-reset-link error.
- timestamp: 2026-07-16T16:42:00Z
  checked: Debug knowledge base and project skill indexes.
  found: No knowledge base exists and no project-specific skills are installed; there is no prior known-pattern shortcut or extra project rule.
  implication: Investigation must proceed from the current source/config and Supabase callback behavior.
- timestamp: 2026-07-16T16:47:00Z
  checked: Complete `AuthProvider`, `ResetPassword`, Supabase client, router, login, and build configuration.
  found: The client uses default implicit URL detection; `AuthProvider` only records `PASSWORD_RECOVERY`, while `ResetPassword` enables submission immediately and calls `updateUser` without checking `session`, auth initialization, recovery-event state, or callback errors. The real Supabase error is replaced by a generic message.
  implication: The observed UI error proves only that `updateUser` lacked a usable auth context or rejected the password; current code cannot distinguish callback/session failure from policy rejection.
- timestamp: 2026-07-16T16:52:00Z
  checked: Live Supabase Auth URL configuration and git/deployment state.
  found: Site URL is `https://job-helper-qs9.pages.dev`; both production and localhost reset routes are allowlisted; signup is disabled and the minimum password length is 8+. The production route exactly matches the app's `redirectTo` construction.
  implication: Redirect allowlisting, wrong Site URL, and the minimum-length setting are not the cause. Production is deployed from commit `491cfec`, while local-only commit `b7871f5` is unrelated deletion verification.
- timestamp: 2026-07-16T16:57:00Z
  checked: Public production artifact and installed `@supabase/auth-js` callback machinery.
  found: Production serves the SPA at `/reset-password` and contains the current generic reset error and recovery listener. The installed client defaults `detectSessionInUrl` to true and contains both implicit-token and PKCE-code exchange paths.
  implication: The app is not missing a required manual PKCE exchange under its default client configuration; a valid callback should be converted into a stored session automatically.
- timestamp: 2026-07-16T17:02:00Z
  checked: Exact `@supabase/auth-js` initialization path and live password-policy flags.
  found: On a valid callback, auth-js saves the session before emitting `PASSWORD_RECOVERY`; on callback error it returns without a session. The project requires only 8 characters, the form enforces 8, and no character-class or breached-password policy is enabled.
  implication: Password-policy rejection is not supported by the configuration. The failure boundary is the absent/invalid recovery session, and the application makes that failure actionable by rendering the form unconditionally and suppressing the callback/update error details.
- timestamp: 2026-07-16T19:24:00Z
  checked: Initial regression test execution.
  found: Vitest rejected a mock factory that referenced top-level variables before initialization, so no behavioral assertion ran.
  implication: This is a test-harness issue, not evidence about the product behavior; use `vi.hoisted` and rerun before implementing the fix.
- timestamp: 2026-07-16T19:25:00Z
  checked: Corrected pre-fix regression test.
  found: Two assertions fail exactly as predicted: invalid and checking recovery states both render the active `Update password` form. The ready-state assertion passes because the form is always visible.
  implication: The regression test directly reproduces the missing recovery gate and is RED before implementation.
- timestamp: 2026-07-16T19:27:00Z
  checked: Focused post-fix regression and callback-classification tests.
  found: All 6 tests pass. Invalid/direct and checking routes do not expose the update action; ready state does. Callback inspection recognizes a valid recovery fragment, safely classifies an expired callback, and rejects a direct route.
  implication: The local implementation closes the unauthenticated submission path and preserves non-sensitive diagnostic classification.
- timestamp: 2026-07-16T19:29:00Z
  checked: Full tests, lint, production build, diff validation, and static marker scan.
  found: All 17 tests pass, lint exits 0, and the production build succeeds. Lint reports one pre-existing AuthProvider Fast Refresh warning plus a new ResetPassword warning caused by exporting a helper. The broad marker scan returned a filename-level failure and needs narrowing; it printed no credential values.
  implication: Behavior and compilation are green; clean up the new warning and verify the broad scan matched only non-secret identifier/test text before committing.
- timestamp: 2026-07-16T19:31:00Z
  checked: Reverification after relocating the helper.
  found: All 19 tests pass, lint exits 0 with only the pre-existing AuthProvider export warning, the production build succeeds, and `git diff --check` is clean. A concurrent scan saw one prior build artifact filename; no credential value was printed.
  implication: Automated behavior and build quality are green. Perform a final source/lifecycle review and a post-build, non-concurrent marker classification before commit.
- timestamp: 2026-07-16T19:34:00Z
  checked: Complete focused diff and post-build marker classification.
  found: The only client-bundle marker is the literal `sb_secret_` guard embedded by the Supabase library; no value-shaped secret is present. Review found recovery status should be explicitly revoked after successful completion and sign-out rather than remain `ready` for the app lifetime.
  implication: The static secret scan is a false positive from dependency safety code. Add the small recovery-state lifecycle reset before final verification.
- timestamp: 2026-07-16T19:39:00Z
  checked: Final local verification after recovery-state lifecycle reset.
  found: All 19 tests pass, lint exits 0 with only the pre-existing AuthProvider Fast Refresh warning, the TypeScript production build succeeds, `git diff --check` passes, bundle strings prove the three recovery states are compiled, and no value-shaped server secret appears in client source or build output.
  implication: The local fix is ready for an atomic commit. A fresh production email round trip remains the required human verification after approved push/deploy.
- timestamp: 2026-07-16T19:42:00Z
  checked: Atomic fix commit.
  found: Commit `4b7ae84` contains only the six focused React/TypeScript source and regression-test files. Unrelated `.DS_Store`, ignored env files, and the active debug session were not staged.
  implication: Local implementation is complete and safely committed; production verification requires separate push/deploy approval.
- timestamp: 2026-07-16T20:05:00Z
  checked: Official Supabase JavaScript and email-template documentation for durable recovery OTP.
  found: Supabase documents `verifyOtp({ email, token, type: 'recovery' })` for password-reset OTPs and explicitly recommends `{{ .Token }}` instead of `{{ .ConfirmationURL }}` when email security systems prefetch and consume links. `{{ .Token }}` is the six-digit OTP template variable.
  implication: The authorized OTP design directly addresses the documented prefetch failure mode without placing the email or token in a URL. The email template must be changed only after the compatible app is deployed.
- timestamp: 2026-07-16T20:10:00Z
  checked: Installed `@supabase/auth-js` recovery OTP contract and current recovery UI.
  found: `VerifyEmailOtpParams` accepts `{ email, token, type: EmailOtpType }`; `recovery` is documented by the installed client, and a successful verification saves the session before emitting `PASSWORD_RECOVERY`. The current direct reset route has no email or OTP fields and only supports a prior callback session.
  implication: The installed version supports the durable OTP flow without a dependency change. Tests must assert both the new form and the security-sensitive call order.
- timestamp: 2026-07-16T20:50:00Z
  checked: Pre-implementation OTP regression tests.
  found: The workflow suite is RED because the OTP module does not exist, and the rendered idle reset route lacks email and OTP fields. Existing confirmed-link checks continue to pass.
  implication: The tests directly capture the missing durable OTP behavior while protecting the existing safe link compatibility path.
- timestamp: 2026-07-16T20:52:00Z
  checked: Focused post-implementation OTP tests.
  found: All 14 targeted tests pass. They prove recovery OTP verification precedes password update and local sign-out, invalid/expired OTP blocks update, recovery requests keep email/token out of the redirect URL, idle routes collect email/code/password, and confirmed-link sessions remain compatible without another OTP.
  implication: The authorized durable OTP flow is GREEN locally; proceed to full regression and leakage checks.
- timestamp: 2026-07-16T20:54:00Z
  checked: First full OTP verification matrix.
  found: All 25 tests and lint pass; URL, logging, and value-shaped secret checks pass. The TypeScript build found one `erasableSyntaxOnly` parameter-property violation and two unsupported generic matcher annotations in tests.
  implication: Runtime behavior and security checks are green; apply mechanical TypeScript compatibility fixes before repeating the full matrix.
- timestamp: 2026-07-16T20:56:00Z
  checked: Second full verification attempt.
  found: All 25 tests and security checks still pass. TypeScript now reports only an unused test import left after removing matcher generics; bundle assertions ran against the prior build and are therefore not meaningful.
  implication: Remove the unused import and ensure build succeeds before inspecting the generated bundle.
- timestamp: 2026-07-16T20:58:00Z
  checked: Final local OTP verification matrix.
  found: All 25 tests pass; lint exits 0 with only the pre-existing AuthProvider Fast Refresh warning; the TypeScript production build succeeds; diff, URL serialization, recovery-input logging, value-shaped secret, and compiled OTP-state checks all pass. Vite reports only the existing approximate 500 kB chunk-size advisory.
  implication: The local OTP implementation is fully verified and ready for a focused commit. Hosted email template and production deployment remain intentionally untouched.
- timestamp: 2026-07-16T21:02:00Z
  checked: Atomic OTP implementation commit.
  found: Commit `ff2cf69` contains exactly the five focused OTP source/test files. `.DS_Store`, ignored env files, the active debug session, hosted Supabase configuration, and production deployment were not staged or changed.
  implication: Code is ready for ordered rollout: deploy first, change the recovery template second, then request a fresh code for human verification.
- timestamp: 2026-07-16T21:14:00Z
  checked: Ordered production rollout and hosted recovery-template update.
  found: Commit `ff2cf69` was pushed and Cloudflare serves its matching production bundle. Supabase rejected the authorized recovery-template PATCH with HTTP 400 because new free-tier projects using the default email provider cannot customize auth email templates.
  implication: The application is OTP-capable in production, but Supabase will continue sending its default clickable recovery link until the project configures custom SMTP or upgrades to a tier that permits template customization.
- timestamp: 2026-07-16T21:31:00Z
  checked: Custom SMTP activation and second hosted recovery-template update.
  found: After the user configured Gmail custom SMTP, Supabase accepted the authorized template PATCH with HTTP 200. Safe field checks confirm the expected recovery subject, a `{{ .Token }}` body, no `.ConfirmationURL`, and the Gmail SMTP host; no SMTP credentials were printed.
  implication: Production is ready for the final manual OTP email and password-change round trip without a scanner-sensitive clickable link.
- timestamp: 2026-07-16T20:16:13Z
  checked: Repeated production recovery requests and sanitized Supabase Auth logs.
  found: Each `/auth/v1/recover` POST returned HTTP 500. Auth logs report Gmail SMTP error 535, `Username and Password not accepted`; sender addresses and credentials were redacted and not printed.
  implication: The OTP application and template are active, but Gmail rejects the configured SMTP username/App Password pair. Regenerate the Google App Password and save the exact Gmail username plus the new App Password before retrying.
- timestamp: 2026-07-16T20:23:00Z
  checked: Controlled recovery-email probe after the user replaced the Gmail App Password.
  found: Supabase accepted the recovery request without an Auth error and handed the OTP email to the configured custom SMTP provider. No email address, OTP, or credential was printed.
  implication: Gmail SMTP authentication is fixed. The latest delivered OTP is ready for the final production password-reset round trip.
- timestamp: 2026-07-16T20:27:00Z
  checked: Hosted OTP length after the first successfully delivered custom-template email.
  found: Supabase generated an eight-digit code because `mailer_otp_length` was 8, while the deployed form and template specify six digits. The user-provided screenshot exposed that one-time code, so it was treated as compromised and not used.
  implication: Align the hosted OTP length with the validated six-digit form before continuing.
- timestamp: 2026-07-16T20:28:00Z
  checked: Hosted OTP-length correction and fresh recovery request.
  found: Supabase accepted `mailer_otp_length: 6`, returned the setting as 6, and accepted a new controlled recovery-email request through Gmail SMTP. No OTP or credential was printed.
  implication: Production email, hosted OTP length, and the deployed six-digit form are now aligned; use only the newest email for final verification.
- timestamp: 2026-07-16T20:30:00Z
  checked: Final production human verification.
  found: User 2 received the six-digit OTP, completed password recovery, confirmed the new password authenticates, confirmed the previous password is rejected, and updated the local seed password.
  implication: The scanner-resistant production password-recovery flow is verified end to end and the debug session can be resolved.

## Eliminated

- hypothesis: Production Site URL or redirect allowlist mismatch.
  evidence: Live Auth configuration exactly matches `https://job-helper-qs9.pages.dev/reset-password`.
  timestamp: 2026-07-16T16:52:00Z
- hypothesis: Missing explicit PKCE exchange in application code.
  evidence: The client uses the default implicit flow and auth-js automatically handles both implicit callback tokens and supported PKCE callbacks during initialization.
  timestamp: 2026-07-16T16:57:00Z
- hypothesis: Submitted password rejected by configured complexity policy.
  evidence: Live policy requires only length 8, matching the form; no required characters or HIBP check is enabled.
  timestamp: 2026-07-16T17:02:00Z

## Resolution

- root_cause: `ResetPassword` is publicly routable and enables submission without waiting for or requiring a successful `PASSWORD_RECOVERY` session. When a recovery callback is invalid, expired, reused, consumed, or otherwise fails, auth-js returns without storing a session; the app ignores that state/error, still renders the form, then calls session-required `updateUser`, replacing the diagnostic with a generic message. The available read-only evidence cannot distinguish which external condition invalidated this particular one-time link because the application discards the callback error.
- fix: Commit `4b7ae84` added recovery-session gating. Commit `ff2cf69` replaces ConfirmationURL as the main path with manual recovery OTP verification, routes forgot-password requests to the OTP form, signs out locally after update, retains safe confirmed-link compatibility for ordered rollout, and never serializes or logs recovery inputs.
- verification: OTP RED/GREEN plus all 25 tests, lint, TypeScript production build, diff validation, compiled-state assertions, URL/log hygiene, and value-shaped secret scans pass. Commit `ff2cf69` is deployed. Gmail custom SMTP, the hosted six-digit `{{ .Token }}` recovery template, new-password login, and previous-password rejection all passed production human verification.
- files_changed: [web/src/auth/passwordRecovery.ts, web/src/auth/passwordRecovery.test.ts, web/src/pages/Login.tsx, web/src/pages/ResetPassword.tsx, web/src/pages/ResetPassword.test.tsx, .planning/debug/password-reset-production.md]

## Pending Hosted Recovery Template

Apply only after commit `ff2cf69` is deployed.

Subject:

`Your Job Copilot password reset code`

Body:

```html
<h2>Reset your Job Copilot password</h2>
<p>Enter this six-digit verification code in Job Copilot:</p>
<p style="font-size: 24px; font-weight: 700; letter-spacing: 0.25em;">{{ .Token }}</p>
<p>This code expires soon and can only be used once.</p>
<p>If you did not request a password reset, you can safely ignore this email.</p>
```

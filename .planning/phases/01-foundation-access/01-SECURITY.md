---
phase: 01
slug: foundation-access
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on (high) severity
threats_open: 0
asvs_level: 1
block_on: high
created: 2026-07-16
---

# Phase 01 — Foundation & Access — Security

> Retroactive threat-mitigation verification for the invite-only auth, RLS, private
> resume storage, delete-all, and production-recovery slice. Every declared mitigation
> was verified against implemented code (file:line evidence below), not documentation.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Browser → Supabase Auth (GoTrue) | Untrusted credentials / recovery OTP verified server-side | Passwords, session JWTs, recovery codes |
| Browser (user JWT) → PostgREST | All table access crosses RLS here | resumes rows, profiles rows |
| Browser (user JWT) → Storage API | All file access crosses storage.objects policies | Resume DOCX/PDF blobs |
| Developer machine → Supabase admin API | Secret key used only in local `scripts/` | Service-role credentials |
| Repo → npm registry | Supply-chain surface at install time | Package tarballs |
| Email → browser | Recovery OTP crosses an untrusted channel | Six-digit recovery token |
| Internet → pages.dev | Anyone can load the login page; auth is the only gate | Public static bundle |
| Cloudflare build env → public bundle | Any env var entered there can ship in JS | VITE_ publishable vars only |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation (verified evidence) | Status |
|-----------|----------|-----------|----------|-------------|--------------------------------|--------|
| T-01-01 | Spoofing/Elevation | Login (signInWithPassword) | medium | mitigate | Generic error copy — all failures return the same `genericError`, no enumeration (`web/src/pages/Login.tsx:6,23-24`); seed passwords enforced ≥8 chars (`scripts/seed-users.ts:28`); Supabase built-in auth rate limits (platform) | closed |
| T-01-02 | Information disclosure | Secret key vs client bundle / Pages env | high | mitigate | `scripts/.env` gitignored (`.gitignore:5`); client reads only `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` (`web/src/lib/supabase.ts:8-11`); secret key confined to `scripts/*` (`seed-users.ts:35`, `admin-reset-password.ts:22`); scans: 0 `VITE_*SECRET` refs, 0 `sb_secret` in `web/src`, 0 non-comment `signUp` | closed |
| T-01-03 | Information disclosure | IDOR via PostgREST (by-id reads) | critical | mitigate | Per-operation RLS policies all keyed `(select auth.uid()) = user_id` (`supabase/migrations/0002_resumes.sql:16-31`); live by-id select/update/delete probes return 0 rows (`scripts/verify-rls.ts:119-137`) | closed |
| T-01-04 | Tampering | Row re-parenting via UPDATE | high | mitigate | UPDATE policy carries `with check ((select auth.uid()) = user_id)` and INSERT `with check` (`0002_resumes.sql:20-27`); live re-parent probe errors/0-rows (`verify-rls.ts:139-144`) | closed |
| T-01-05 | Tampering/DoS | Malicious / oversized upload | medium | mitigate | Server-side bucket `file_size_limit` 5 MB + DOCX/PDF MIME allowlist (`0003_storage.sql:1-12`); client-side extension gate as UX (`web/src/lib/resumes.ts:23-29`) | closed |
| T-01-06 | Spoofing | Reset-link redirectTo (open redirect) | medium | mitigate | `redirectTo` built from `window.location.origin` only — not user-controlled (`web/src/pages/Login.tsx:42-45`); current OTP flow does not rely on a clickable link; Supabase redirect allowlist (dashboard, Task 2) | closed |
| T-01-07 | Elevation | Password change on stolen session | medium | mitigate | `updateUser` sends `current_password` reauth attribute (`web/src/pages/Settings.tsx:14-20`) — **but empirically OFF**: `security_update_password_require_reauthentication` is disabled on the hosted project, so `current_password` is ignored and reauth silently no-ops (see Audit Trail 2026-07-16 probe / CR-01). A live-session password change needs no current password. | **open** — non-blocking (medium < high); fix = enable dashboard flag, re-verify pending |
| T-01-08 | Repudiation/Info disclosure | Partial delete-all (orphan files) | high | mitigate | Storage-first: list all paths → batch `remove` with per-batch and total count-equality assertion, throws before RPC on mismatch, then `rpc('delete_my_data')` (`web/src/pages/Settings.tsx:44-65`); both-sides-empty proof (`scripts/verify-deletion.ts:135-148`) | closed |
| T-01-09 | Elevation | Public signup path | high | mitigate | Zero `signUp` calls in `web/src` (grep=0); dashboard signup toggle OFF (Task 2); third-account probe expected to fail (`scripts/verify-auth.ts`, per 01-01 acceptance) | closed |
| T-01-10 | Spoofing | No 2FA (D-07) | low | accept | See Accepted Risks Log (AR-01) | closed |
| T-01-11 | Information disclosure | Cross-user storage (download/list/upload) | critical | mitigate | Per-user-folder storage policies `(storage.foldername(name))[1] = (select auth.uid()::text)` for select/insert/delete (`0003_storage.sql:14-33`); all three probed as User B → denied (`verify-rls.ts:146-159`) | closed |
| T-01-12 | Repudiation | Silent failed delete (remove() empty array) | medium | mitigate | `deleteResume` asserts `removed.length === 1 && removed[0].name === storagePath` before row delete (`web/src/lib/resumes.ts:82-89`) | closed |
| T-01-13 | DoS | Free project pause after ~7 idle days | low | accept | See Accepted Risks Log (AR-02) | closed |
| T-01-SC | Tampering | npm installs (supply chain) | high | mitigate | Committed lockfile `web/package-lock.json` present (pinned installs); RESEARCH Package Legitimacy Audit approved all packages; no postinstall scripts declared | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats ≥ high count toward threats_open*

---

## Threat Flags (from SUMMARY files)

| Flag | Source | File | Disposition |
|------|--------|------|-------------|
| recovery-input | 01-03-SUMMARY.md `## Threat Flags` | `web/src/auth/passwordRecovery.ts` | Informational — maps to the Email→Browser boundary (T-01-06 area). Verified: OTP is POSTed via `verifyOtp` (`passwordRecovery.ts:73-83`), never serialized to URL/logs; temporary recovery session is locally signed out after password change (`passwordRecovery.ts:49-57`). Not an unregistered gap. |

No unregistered flags requiring escalation.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01 | T-01-10 | No 2FA. Two known invite-only users with strong out-of-band-delivered passwords; user-locked decision D-07. Severity low, below high block threshold. | Project owner (D-07) | 2026-07-16 |
| AR-02 | T-01-13 | Supabase free project pauses after ~7 idle days; ~30 s manual dashboard restore. Phase 2 pg_cron pipeline is the real fix. No keep-alive code by design. Recorded in 01-03-SUMMARY "Accepted Operational Risks". Severity low. | Project owner (RESEARCH Pitfall 5) | 2026-07-16 |
| AR-03 | (operational) | Free tier has no dependable backups; manual export advised before storing irreplaceable resumes. | Project owner (01-03-SUMMARY) | 2026-07-16 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-16 | 14 | 14 | 0 | gsd-security-auditor (ASVS L1, block_on: high) |
| 2026-07-16 | 14 | 13 | 1 (T-01-07, medium, non-blocking) | Post-review empirical probe — code review CR-01 confirmed. Non-mutating two-call `updateUser` probe (wrong vs real `current_password`, new==current) returned identical `same_password` errors → `current_password` ignored → reauth no-op. Original password unchanged. |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed (T-01-07 reopened post-review is medium — below the high block threshold, so non-blocking)
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-16 (amended 2026-07-16: T-01-07 reopened after empirical probe confirmed CR-01; chosen fix = enable Supabase `security_update_password_require_reauthentication`; re-verify pending)

---

## Notes / Verification Limits (ASVS L1)

- Dashboard-side controls (signup toggle OFF, min-password-length, redirect allowlist,
  custom-SMTP OTP template) are outside the code tree and were confirmed via PLAN/SUMMARY
  Task records and the executable `scripts/verify-auth.ts` third-account probe rather than
  by grep. They are platform config, not source.
- T-01-SC verified at L1 depth (committed lockfile present). A deeper audit of exact-version
  pinning and per-dependency provenance was not performed — deferred to the RESEARCH Package
  Legitimacy Audit already on record.
- T-01-06/T-01-07 were judged against the current OTP recovery implementation (commits
  4b7ae84, ff2cf69), not the original clickable-link plan text.
- **T-01-07 amendment (2026-07-16):** the original "mitigate/closed" disposition was wrong.
  `current_password` on `updateUser` is only enforced when the project-level flag
  `security_update_password_require_reauthentication` is ON; a non-mutating empirical probe
  confirmed it is OFF, so reauth no-ops (code review CR-01). Reopened as medium/non-blocking.
  Fix chosen: enable the dashboard flag (no code change), then re-run the probe to confirm
  enforcement and close.

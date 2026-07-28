---
phase: 01-foundation-access
plan: 01
subsystem: auth
tags: [react, vite, supabase, postgres, rls, storage]

requires: []
provides:
  - Invite-only email/password authentication for exactly two seeded users
  - Guarded React SPA shell with persistent Supabase sessions
  - Hosted profiles and resumes schema with row-level security
  - Private per-user resume storage policies and delete-my-data RPC
affects: [01-02-resumes-rls, 01-03-settings-deploy, later-user-owned-tables]

tech-stack:
  added: [React 19, Vite 8, Supabase JS 2, Supabase CLI 2, React Router, TanStack Query, Tailwind CSS 4]
  patterns: [shared Supabase client, auth context plus UX route guard, per-operation RLS policies, user-id-first storage paths]

key-files:
  created:
    - web/src/auth/AuthProvider.tsx
    - web/src/pages/Login.tsx
    - supabase/migrations/0001_profiles.sql
    - supabase/migrations/0002_resumes.sql
    - supabase/migrations/0003_storage.sql
    - supabase/migrations/0004_delete_my_data.sql
    - scripts/seed-users.ts
    - scripts/verify-auth.ts
  modified: [.gitignore]

key-decisions:
  - "Use Supabase client defaults for persistent, auto-refreshing browser sessions."
  - "Keep all privileged account provisioning in a local gitignored environment and admin script."
  - "Make Postgres RLS and Storage policies the authorization boundary; the React route guard is UX only."

patterns-established:
  - "RLS template: enable RLS immediately, grant narrowly, and define one authenticated policy per operation."
  - "Storage isolation: the first object-path folder must equal auth.uid()."
  - "Secret boundary: publishable key may reach the SPA; secret key remains only in scripts/.env."

requirements-completed: [AUTH-01, AUTH-02]

coverage:
  - id: D1
    description: "Exactly two configured users authenticate and public client signup is rejected."
    requirement: AUTH-01
    verification:
      - kind: e2e
        ref: "node --env-file=scripts/.env scripts/verify-auth.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "The hosted project contains all four Phase 1 migrations with RLS and private storage policies."
    requirement: AUTH-01
    verification:
      - kind: integration
        ref: "supabase migration list --linked"
        status: pass
    human_judgment: false
  - id: D3
    description: "The guarded Job Copilot SPA builds with Supabase session persistence defaults and no signup surface."
    requirement: AUTH-02
    verification:
      - kind: integration
        ref: "cd web && npm run build"
        status: pass
      - kind: other
        ref: "static acceptance checks for signUp and persistSession overrides"
        status: pass
    human_judgment: false
  - id: D4
    description: "A signed-in browser remains authenticated after a full page refresh."
    requirement: AUTH-02
    verification: []
    human_judgment: true
    rationale: "Browser refresh persistence is intentionally harvested during end-of-phase conversational UAT."

duration: 2h 4m
completed: 2026-07-16
status: complete
---

# Phase 1 Plan 1: Walking Skeleton and Invite-Only Auth Summary

**React/Vite authenticated shell backed by four live Supabase migrations, two seeded users, publishable-key login proof, and rejected public signup**

## Performance

- **Duration:** 2h 4m, including dashboard and credential checkpoints
- **Started:** 2026-07-16T14:51:21Z
- **Completed:** 2026-07-16T16:54:50Z
- **Tasks:** 3
- **Files modified:** 37 committed files

## Accomplishments

- Built the minimal Job Copilot login flow, password-recovery landing page, persistent session provider, guarded routes, and five-entry application shell.
- Applied profiles, resumes, private resume storage, and delete-my-data migrations to the hosted Supabase project.
- Seeded exactly the two configured accounts, proved both can sign in using only the publishable key, and proved public signup is disabled.
- Kept secret and database credentials in ignored local environment files; no privileged key is present in the frontend tree or commits.

## Task Commits

1. **Task 1: Scaffold repo and authenticated SPA shell** - `08fc69b` (feat)
2. **Task 2: Provision hosted Supabase project and local env files** - human-action checkpoint; local env files are intentionally uncommitted
3. **Task 3: Deploy schema, seed accounts, and prove authentication** - `bd0f218` (feat)

## Files Created/Modified

- `web/src/lib/supabase.ts` - Shared public Supabase browser client using persistence defaults.
- `web/src/auth/AuthProvider.tsx` - Initial session load and auth-event subscription.
- `web/src/pages/Login.tsx` - Email/password login and recovery request flow with generic errors.
- `web/src/components/Shell.tsx` - Guarded five-destination navigation shell and sign-out action.
- `supabase/migrations/0001_profiles.sql` - Owner-scoped profiles plus auth-user trigger.
- `supabase/migrations/0002_resumes.sql` - RLS-protected resumes template with re-parenting protection.
- `supabase/migrations/0003_storage.sql` - Private five-megabyte PDF/DOCX bucket with user-folder policies.
- `supabase/migrations/0004_delete_my_data.sql` - Security-invoker bulk row deletion RPC.
- `scripts/seed-users.ts` - Idempotent privileged provisioning with an exact-two-user invariant.
- `scripts/verify-auth.ts` - Publishable-key login and disabled-signup integration proof.
- `scripts/.env.example` - Credential-name documentation with placeholders only.

## Decisions Made

- Followed the planned hosted-only workflow because Docker is unavailable; the Supabase CLI linked and pushed directly to the free project.
- Used the new publishable/secret key model and verified the privileged key never crossed into `web/`.
- Enforced an exact-two-user invariant after seeding so a silently created third account cannot satisfy the verification step.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Database authentication initially failed at the human-action checkpoint. The user reset the hosted database password; the subsequent remote migration-list check authenticated successfully.
- `supabase db push` applied all migrations successfully, then emitted a non-blocking Docker catalog-cache warning. Remote migration listing independently confirmed migrations `0001` through `0004` are live.

## Authentication Gates

- Task 2 required the user to create/configure the hosted project and populate ignored environment files.
- Task 3 paused twice for correction of the hosted database password. No credentials were logged, printed, or committed; the final retry succeeded.

## Known Stubs

- `web/src/pages/Resumes.tsx` - Intentional “coming soon” state replaced by Plan 01-02.
- `web/src/pages/Settings.tsx` - Intentional “coming soon” state replaced by Plan 01-03.
- `web/src/pages/Watchlist.tsx` and `web/src/pages/Tracker.tsx` - Intentional navigation skeletons for later product phases.

## User Setup Required

The required Supabase project, auth configuration, URL allowlist, team membership, API credentials, and two local seed identities are already configured. Local values remain in ignored `web/.env.local` and `scripts/.env` files.

## Next Phase Readiness

- Plan 01-02 can build resume upload/list/delete against the live `resumes` table and private bucket, then run two-client RLS isolation probes.
- The browser refresh-persistence experience remains a planned end-of-phase UAT check; the underlying Supabase persistence and refresh defaults are intact.
- No implementation blocker remains.

## Self-Check: PASSED

All listed artifacts exist, both task commits resolve, the production build passes, both configured users authenticate, public signup is rejected, and remote migrations `0001` through `0004` are present.

---
*Phase: 01-foundation-access*
*Completed: 2026-07-16*

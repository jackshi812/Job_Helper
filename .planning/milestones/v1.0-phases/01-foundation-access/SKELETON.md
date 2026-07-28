# Walking Skeleton — Job Copilot

**Phase:** 1
**Generated:** 2026-07-15

## Capability Proven End-to-End

An invited user can log in with email/password at the deployed pages.dev URL, upload a resume file that lands in RLS-isolated storage plus a database row, and hard-delete it — proving auth, database, storage, routing, and deployment work as one stack.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Framework | React 19 + Vite SPA (react-ts scaffold), TypeScript everywhere | Pure static SPA is the friction-free path on Cloudflare Pages; no SEO/SSR need for a 2-user private app (STACK.md; Next.js on Pages explicitly avoided) |
| Routing | react-router (library/declarative mode), `BrowserRouter`; public `/login` + `/reset-password`, all else behind `RequireAuth` inside `Shell` | Pages' automatic SPA fallback serves index.html for unmatched paths — zero routing config on the CDN |
| Data layer | Supabase Free Postgres via `@supabase/supabase-js` ^2 + TanStack Query 5 (`['resumes']` query keys); migrations in `supabase/migrations/`, applied with `npx supabase db push` against the hosted project (no Docker/local stack) | Free-tier fit; RLS is the authorization layer; hosted-push workflow because Docker is unavailable (RESEARCH Environment Availability) |
| Auth | Supabase Auth (GoTrue), invite-only: dashboard signup toggle OFF + local admin seed script (`scripts/seed-users.ts`, `email_confirm: true`); sessions = untouched supabase-js defaults (localStorage persist + auto-refresh, indefinite on free plan) | D-01..D-08; free-tier defaults literally are the D-06 long-session requirement; no 2FA (D-07, accepted) |
| Authorization | Postgres RLS on every user-owned table: per-operation policies, `TO authenticated`, `(select auth.uid()) = user_id`, `WITH CHECK` on INSERT/UPDATE, indexed `user_id`; storage: private `resumes` bucket, path `{user_id}/{uuid}.{ext}`, `storage.foldername(name)[1] = auth.uid()::text` policies | `0002_resumes.sql` is the canonical template Phases 2–4 copy verbatim; app-level filters are never the boundary |
| Deletion model | Hard delete, storage-first with removed-count assertion, then rows; bulk path via `security invoker` RPC `delete_my_data()` that later phases append their tables to | D-09/D-10/D-11; failed file delete must leave a visible retryable row, never an orphan file |
| Deployment target | Cloudflare Pages via GitHub Git integration (root `web`, build `npm run build`, output `dist`); env vars `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Free, git-push deploys; secret key never leaves `scripts/.env` |
| Directory layout | `web/` (SPA: `src/lib`, `src/auth`, `src/pages`, `src/components`), `supabase/migrations/`, `scripts/` (local-only admin + verification scripts) | RESEARCH Recommended Project Structure; secret-bearing scripts live outside `web/` by construction |
| Styling/theme | Tailwind CSS 4 via `@tailwindcss/vite`, dark mode by default media strategy (follows OS), neutral dense minimal UI; no component library | D-14/D-15; zero theme code, zero PostCSS config |
| Verification style | Executable probe scripts over UI spot-checks: `verify-auth.ts`, `verify-rls.ts`, `verify-deletion.ts` run with `node --env-file=scripts/.env` | Phase 1 risk is configuration correctness, not algorithms — spend verification budget at the API layer with both accounts |

## Stack Touched in Phase 1

- [x] Project scaffold (Vite react-ts, Tailwind 4, lint/build via scaffold defaults) — plan 01
- [x] Routing — public login/reset routes + five guarded shell routes — plan 01
- [x] Database — real read AND write: resumes rows (insert/select/delete) + profiles trigger — plans 01–02
- [x] UI — resume upload/list/download/delete wired to Storage + PostgREST — plan 02
- [x] Deployment — Cloudflare Pages Git integration, live at `https://<project>.pages.dev` — plan 03

## Out of Scope (Deferred to Later Slices)

- Job ingestion, watchlist, polling, dedupe, heartbeat (Phase 2)
- Preferences, cheap filters, AI scoring, match feed, push/email notifications (Phase 3)
- Resume tailoring, DOCX editing, PDF export, application tracker (Phase 4)
- Keep-alive against the 7-day free-project pause (accepted risk until Phase 2's pg_cron; manual dashboard restore is the interim recovery)
- Custom SMTP via Resend (Phase 3 upgrade path; Phase 1 uses org-member delivery + break-glass admin reset script)
- 2FA, admin roles, signup/invite UI, email template customization — permanently out per D-01/D-04/D-07 and free-tier limits

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without altering its architectural decisions:

- Phase 2: user watches 100+ career sites; new postings land deduplicated within 5–15 min with visible pipeline health (adds Edge Functions + pg_cron on the same Supabase project; new tables copy `0002` RLS template; watchlist page fills its shell slot)
- Phase 3: preferences + cheap filters + AI scoring produce a match feed with push/email alerts (Dashboard page fills its slot; resumes uploaded via the Phase 1 storage path feed scoring)
- Phase 4: truthful DOCX tailoring to PDF + application tracker (Tracker page fills its slot; tailored files reuse the per-user storage folders and delete flows)

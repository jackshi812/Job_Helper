# Phase 1: Foundation & Access - Research

**Researched:** 2026-07-16
**Domain:** Supabase Auth (invite-only) + RLS data isolation + Vite/React SPA on Cloudflare Pages
**Confidence:** HIGH overall (core patterns verified against official Supabase/Cloudflare docs this session; a handful of behavioral details flagged MEDIUM/LOW inline)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Invite mechanism
- **D-01:** Both accounts pre-seeded by an admin script at deploy time using the two users' real emails. No signup UI exists anywhere in the app.
- **D-02:** Third parties hitting the URL see the login page only — no signup link, no "invite-only" explainer page; wrong credentials simply fail.
- **D-03:** User will provide the second user's email before deploy (first: jk8839888@gmail.com).
- **D-04:** Both users have equal capability. No admin role, no admin UI.

#### Login & recovery
- **D-05:** Password reset ships in v1 via Supabase's built-in reset-by-email link.
- **D-06:** Long-lived sessions (~30+ days) with auto-renewing refresh tokens. No re-login friction on personal laptops.
- **D-07:** No 2FA.
- **D-08:** Login page is minimal: app name, email + password fields, submit button, forgot-password link. Nothing else.

#### Data deletion UX
- **D-09:** Both granular and bulk deletion: per-item delete for resumes (and later data types) plus a "delete all my data" button in Settings.
- **D-10:** Hard delete — items removed immediately from both database and storage. No trash, no undo, no purge jobs.
- **D-11:** Confirmation: per-item deletes get a single confirm dialog; delete-all requires type-to-confirm (user types DELETE).

#### App shell & look
- **D-12:** Phase 1 ships a real app shell: nav skeleton with Dashboard, Watchlist, Resumes, Tracker, Settings entries. Unbuilt pages show "coming soon" empty states. Settings is functional (password change, delete data).
- **D-13:** App name in UI: **Job Copilot**.
- **D-14:** Theme follows system: light + dark, auto-switch per OS setting.
- **D-15:** Style: clean minimal — neutral palette, dense tables, function over flair. Daily-use tool, not a showcase.

### Claude's Discretion
- Exact seed-script mechanics (Supabase admin API vs SQL), RLS policy structure, session token configuration details, empty-state copy, exact nav layout.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-01 | Log in with email/password; invite-only, exactly two accounts, no public registration | "Allow new users to sign up" toggle OFF blocks client `signUp()`; `auth.admin.createUser()` with secret key still works — seed script pattern documented below (Code Example 1). Login page = `signInWithPassword` (Pattern 2) |
| AUTH-02 | Session persists across browser refresh | supabase-js defaults (`persistSession: true` in localStorage, `autoRefreshToken: true`) + indefinite session lifetime on free plan (time-box/inactivity limits are Pro-only features) satisfy D-06 with zero config (Pattern 2, Pitfall 6) |
| AUTH-03 | Per-user data isolation via RLS on every user-owned table | RLS policy template with `(select auth.uid())`, `TO authenticated`, per-operation policies, indexed `user_id` (Pattern 3); Storage per-user-folder policies (Pattern 4); two-account cross-access verification script (Code Example 5) |
| AUTH-04 | User can delete own resumes and data (DB + storage) | Per-item delete = storage `.remove()` + row delete; delete-all = `delete_my_data()` RPC + storage folder emptying (Pattern 5, Code Example 4); storage/DB delete-both gotcha covered in Pitfall 3 |
</phase_requirements>

## Summary

Phase 1 is a well-trodden Supabase path with one genuine landmine. The happy path: scaffold a Vite + React SPA, connect Cloudflare Pages via Git integration (automatic SPA fallback — zero routing config needed), create a Supabase free project, turn OFF "Allow new users to sign up," seed the two accounts with a local Node script calling `auth.admin.createUser({ email, password, email_confirm: true })`, and write RLS-first migrations. Session persistence needs no work at all: supabase-js persists to localStorage and auto-refreshes by default, and free-plan sessions last indefinitely (the session-limiting features are Pro-only) — D-06's "30+ day sessions" is literally the free-tier default behavior.

The landmine is D-05 (password reset by email): **Supabase's built-in email service only delivers to project team-member addresses, at 2 emails/hour** [VERIFIED: supabase.com/docs/guides/auth/auth-smtp + cross-checked web sources]. The second invited user is not a team member, so out of the box their reset email is rejected with "Email address not authorized." The zero-cost fix is to add the second user's email as a member of the Supabase organization (fine for a 2-person invite-only app); the robust fix is custom SMTP via Resend (available on the free plan, and Resend is already in the Phase 3 stack — but requires a verified sending domain). The plan must include one of these plus a break-glass admin script (`auth.admin.updateUserById`) — this cannot be discovered at implementation time without breaking a success criterion.

Isolation (AUTH-03) is a schema-discipline problem, not a library problem: RLS enabled on every user-owned table from the first migration, one policy per operation, `(select auth.uid()) = user_id`, `TO authenticated`, and a Storage bucket where the first path folder equals the user's id. Success criterion 3 demands verification *with both accounts* — plan an executable two-client cross-access test, not a UI spot-check.

**Primary recommendation:** Build in this order — Supabase project + migrations (schema/RLS/storage policies) → seed script → SPA scaffold with auth wiring → app shell + Settings (password change, deletes) → Cloudflare Pages deploy → two-account RLS verification. Resolve the reset-email delivery decision (org member vs Resend SMTP) before writing the reset UI.

## Project Constraints (from CLAUDE.md)

Directives extracted from `./.claude/CLAUDE.md` that bind this phase:

1. **Budget:** near-zero cost — free tiers only (Cloudflare Pages, Supabase Free); no paid services in Phase 1.
2. **Tech stack fixed:** Cloudflare Pages frontend, Supabase Free backend (auth, Postgres, resume storage). React + Vite SPA, TypeScript everywhere.
3. **Do NOT use:** Next.js on Cloudflare Pages; Node `web-push` (later phases); LinkedIn scraping of any logged-in surface; per-job notification emails.
4. **Security:** resumes in encrypted private cloud storage with user-controlled deletion; strict per-user data separation (this IS Phase 1's job).
5. **Recommended supporting libs:** `@supabase/supabase-js` ^2, `@tanstack/react-query` ^5, `react-router` (library mode), Tailwind CSS ^4 (via `@tailwindcss/vite` plugin, no PostCSS config).
6. **Free-tier limits to respect:** Supabase 500 MB DB / 1 GB storage / project pauses after 1 week of inactivity (treat "project paused" as a failure mode); Cloudflare Pages 500 builds/mo.
7. **GSD workflow enforcement:** work flows through GSD commands; planner output drives execution.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Login / logout / password reset UI | Browser (SPA) | — | Forms + supabase-js calls; no server rendering needed for a 2-user private app |
| Credential verification, session issuance, refresh tokens | Supabase Auth (backend service) | — | Never hand-rolled; GoTrue owns password hashing, JWT minting, refresh rotation |
| Session persistence across refresh | Browser (supabase-js localStorage) | Supabase Auth (refresh endpoint) | Client stores session; auto-refresh exchanges refresh token ~before 1h JWT expiry |
| Account creation (invite-only seeding) | Local admin script (Node, developer machine) | Supabase Auth admin API | Secret key must never reach the browser; script runs once per user at deploy time |
| Per-user data authorization | Database (Postgres RLS) | — | Authorization at the data layer, not app code — client filters are UX, RLS is the boundary |
| Resume file storage + access control | Supabase Storage (private bucket + storage.objects RLS) | Browser (upload/download calls) | Bucket policies enforce per-user folders; SPA only holds the user's own JWT |
| Data deletion (rows + files) | Browser-initiated, enforced by RLS/policies | Postgres RPC for multi-table delete-all | Client can only delete what RLS lets it; delete-all wrapped in one RPC for atomicity on DB side |
| Static asset serving + SPA routing fallback | Cloudflare Pages (CDN) | — | Git-integrated build; automatic SPA index.html fallback when no 404.html |
| Theme (light/dark) | Browser (CSS `prefers-color-scheme`) | — | D-14 auto-follow OS; pure CSS/Tailwind, no persistence needed |

## Standard Stack

### Core

| Library | Version (verified on npm 2026-07-16) | Purpose | Why Standard |
|---------|--------------------------------------|---------|--------------|
| `react` / `react-dom` | 19.2.7 | UI | Locked by project stack [VERIFIED: npm registry] |
| `vite` | 8.1.4 latest (STACK.md wrote against 7.x) | Build tool / dev server | Scaffold via `npm create vite@latest` and accept the versions it pins — see State of the Art [VERIFIED: npm registry] |
| `typescript` | 7.0.2 latest on npm; scaffold may pin 5.x | Language | Accept whatever the Vite scaffold pins; do not hand-upgrade to TS 7 in this phase [VERIFIED: npm registry] |
| `@supabase/supabase-js` | 2.110.6 | Auth, DB (RLS), Storage client | Official client; same API browser + scripts [VERIFIED: npm registry] |
| `react-router` | 8.2.0 latest (STACK.md wrote against ^7) | Client routing, library mode (`BrowserRouter`) | Declarative-mode API is stable across 7→8; pin `^7` if v8 surprises at install [VERIFIED: npm registry, version delta noted] |
| `@tanstack/react-query` | 5.101.2 | Server-state fetching/caching | Project stack; used for resume list + settings data [VERIFIED: npm registry] |
| `tailwindcss` + `@tailwindcss/vite` | 4.3.2 | Styling; dark mode via media strategy (D-14) | First-party Vite plugin, no PostCSS config [VERIFIED: npm registry] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `supabase` (CLI, dev-dep) | 2.109.1 | Migrations (`supabase db push`), project linking, type generation | All schema/RLS work lives in `supabase/migrations/` from day one [VERIFIED: npm registry] |
| `@vitejs/plugin-react` | 6.0.3 | React fast-refresh in Vite | Installed by scaffold [VERIFIED: npm registry] |
| `dotenv` or Node 26 `--env-file` | built-in | Seed script env loading | Node ≥20.6 has native `--env-file`; no package needed [VERIFIED: node v26.3.1 present locally] |

**No component library needed.** D-15 (clean minimal, dense tables) is achievable with Tailwind alone; shadcn/ui is optional per stack doc — recommend skipping it in Phase 1 to keep the skeleton thin.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Org-team-member trick for reset emails | Custom SMTP via Resend free tier | Resend needs a verified sending domain (domains cost ~$10/yr — violates near-zero unless one already exists); org-member approach is $0 but grants the second user Supabase dashboard access |
| `react-router` v8 latest | Pin `react-router@^7` | STACK.md was written against 7; declarative mode API is the same — use latest unless install-time type errors appear |
| Client-side per-table deletes for delete-all | Single `delete_my_data()` Postgres RPC | RPC is atomic for DB rows and automatically covers future tables added to it; recommended. Storage files still deleted via Storage API either way |
| Supabase CLI local stack (`supabase start`) | Development against the hosted free project | Docker is NOT installed on this machine — use hosted project + `supabase db push` for migrations (see Environment Availability) |

**Installation:**
```bash
# Scaffold (accept pinned versions)
npm create vite@latest web -- --template react-ts
cd web
npm install @supabase/supabase-js react-router @tanstack/react-query
npm install tailwindcss @tailwindcss/vite
npm install -D supabase

# Link hosted project (no Docker needed for db push)
npx supabase login
npx supabase link --project-ref <PROJECT_REF>
npx supabase db push   # applies supabase/migrations/*.sql
```

**Version verification:** all versions above confirmed via `npm view <pkg> version` on 2026-07-16.

## Package Legitimacy Audit

`gsd-tools query package-legitimacy check --ecosystem npm` run 2026-07-16 on all packages above.

| Package | Registry | Weekly Downloads | Source Repo | Verdict | Disposition |
|---------|----------|------------------|-------------|---------|-------------|
| react | npm | 144.9M | github.com/facebook/react | OK | Approved |
| react-dom | npm | 112.9M | github.com/facebook/react | OK | Approved |
| vite | npm | 117.2M | github.com/vitejs/vite | SUS (too-new) | Approved — see note |
| @vitejs/plugin-react | npm | 55.3M | github.com/vitejs/vite-plugin-react | SUS (too-new) | Approved — see note |
| typescript | npm | 214.4M | github.com/microsoft/TypeScript | SUS (too-new) | Approved — see note |
| @supabase/supabase-js | npm | 18.8M | github.com/supabase/supabase-js | SUS (too-new) | Approved — see note |
| react-router | npm | 38.8M | github.com/remix-run/react-router | SUS (too-new) | Approved — see note |
| @tanstack/react-query | npm | 56.2M | github.com/TanStack/query | SUS (too-new) | Approved — see note |
| tailwindcss | npm | 97.8M | github.com/tailwindlabs/tailwindcss | SUS (too-new) | Approved — see note |
| @tailwindcss/vite | npm | 38.2M | github.com/tailwindlabs/tailwindcss | SUS (too-new) | Approved — see note |
| supabase (CLI) | npm | 2.1M | github.com/supabase/cli | SUS (too-new) | Approved — see note |

**Note on SUS verdicts:** every SUS flag carries the single reason `too-new`, triggered by the *latest release* being published within ~30 days (normal cadence for these projects). All flagged packages have tens-of-millions weekly downloads, official org-owned source repos, no `postinstall` scripts, and no deprecation — the slopsquatting risk these heuristics guard against is not plausible here. Planner may treat these as approved without a `checkpoint:human-verify`; the standard mitigation (pin exact versions in `package.json`, commit the lockfile) suffices.

**Packages removed due to SLOP verdict:** none
**Packages flagged genuinely suspicious:** none

## Architecture Patterns

### System Architecture Diagram

```
                 ┌────────────────────────────────────────────────┐
                 │  Cloudflare Pages (CDN, Git-integrated builds) │
   users ───────▶│  serves dist/ static assets                    │
  (2 invited)    │  SPA fallback: unmatched paths → index.html    │
                 └───────────────┬────────────────────────────────┘
                                 │ loads SPA (React 19 + react-router)
                                 ▼
        ┌───────────────────────────────────────────────────────────┐
        │  Browser SPA — Job Copilot                                │
        │  /login ──signInWithPassword──┐                           │
        │  /reset-password (recovery)   │   supabase-js client      │
        │  AuthProvider (getSession +   │   (VITE_SUPABASE_URL,     │
        │   onAuthStateChange) ─────────┼──  publishable key,       │
        │  <RequireAuth> route guard    │   localStorage session,   │
        │  Shell: Dashboard·Watchlist·  │   autoRefreshToken)       │
        │   Resumes·Tracker·Settings    │                           │
        └───────┬───────────────┬───────┴───────────┬───────────────┘
                │ auth API      │ PostgREST (RLS)   │ Storage API
                ▼               ▼                   ▼
        ┌───────────────────────────────────────────────────────────┐
        │  Supabase (Free project)                                  │
        │  Auth (GoTrue): signups DISABLED · reset emails ·         │
        │    refresh-token rotation · JWT 1h expiry                 │
        │  Postgres: profiles, resumes (+ RLS template for future   │
        │    tables) · delete_my_data() RPC                         │
        │  Storage: private bucket "resumes",                       │
        │    path = {user_id}/{filename}, per-folder RLS            │
        └───────────────▲───────────────────────────────────────────┘
                        │ auth.admin.createUser (sb_secret key)
        ┌───────────────┴───────────────┐
        │ seed script (Node, local only,│   ← run once per user at deploy;
        │  scripts/seed-users.ts)       │     secret key NEVER in repo/browser
        └───────────────────────────────┘
```

Primary use case trace (login): user hits Pages URL → SPA loads → no session in localStorage → redirected to /login → `signInWithPassword` → Supabase Auth returns JWT + refresh token → stored in localStorage → route guard admits → dashboard reads user rows through PostgREST with RLS applied → refresh of the tab replays `getSession()` from localStorage (AUTH-02).

### Recommended Project Structure

```
/                                  # repo root
├── web/                           # Vite SPA
│   ├── src/
│   │   ├── main.tsx               # providers: QueryClient, AuthProvider, Router
│   │   ├── lib/supabase.ts        # createClient(url, publishableKey)
│   │   ├── auth/
│   │   │   ├── AuthProvider.tsx   # session state + onAuthStateChange
│   │   │   └── RequireAuth.tsx    # route guard (redirect to /login)
│   │   ├── pages/
│   │   │   ├── Login.tsx          # D-08 minimal login
│   │   │   ├── ResetPassword.tsx  # PASSWORD_RECOVERY landing
│   │   │   ├── Dashboard.tsx      # "coming soon" empty state
│   │   │   ├── Watchlist.tsx      # "coming soon"
│   │   │   ├── Resumes.tsx        # upload/list/delete (real DB+storage r/w)
│   │   │   ├── Tracker.tsx        # "coming soon"
│   │   │   └── Settings.tsx       # password change, delete-all-my-data
│   │   ├── components/            # Shell/nav, ConfirmDialog, TypeToConfirmDialog
│   │   └── index.css              # @import "tailwindcss"
│   └── vite.config.ts             # react() + tailwindcss() plugins
├── supabase/
│   ├── config.toml
│   └── migrations/
│       ├── 0001_profiles.sql      # profiles + trigger on auth.users
│       ├── 0002_resumes.sql       # resumes metadata + RLS
│       ├── 0003_storage.sql       # bucket + storage.objects policies
│       └── 0004_delete_my_data.sql
└── scripts/
    └── seed-users.ts              # admin createUser — local only, reads .env
```

### Pattern 1: Invite-only via disabled signups + admin seed script

**What:** Turn OFF "Allow new users to sign up" (Dashboard → Authentication → Sign In / Providers). Client `signUp()` then errors; `auth.admin.createUser()` with the secret key still works. [VERIFIED: supabase discussions #3208/#4296 + admin API reference]
**When to use:** Exactly this app shape — fixed user list, no invitation emails needed (D-01 says seed with known emails/passwords, not `inviteUserByEmail`).
**Key detail:** create users with `email_confirm: true` so no confirmation email is ever needed — this completely sidesteps SMTP for account creation. Users receive their initial password out-of-band (in person / private message) and can change it in Settings.

### Pattern 2: Session wiring — the free-tier defaults are the requirement

**What:** `createClient()` defaults: `persistSession: true` (localStorage), `autoRefreshToken: true`. JWT expires after 1 h and is silently refreshed; refresh tokens rotate and never expire on their own. Free-plan sessions last indefinitely because time-boxed sessions / inactivity timeout / single-session are Pro-plan-only settings. [CITED: supabase.com/docs/guides/auth/sessions]
**When to use:** AUTH-02 and D-06 — no configuration to write. The app-side work is: an `AuthProvider` that calls `getSession()` once at mount, subscribes to `onAuthStateChange`, and exposes `session` to the router guard.
**Gotcha:** avoid `await`-ing other supabase-js calls directly inside the `onAuthStateChange` callback (documented deadlock risk — dispatch to state and let effects react instead). [ASSUMED — noted in supabase-js reference docs; verify comment in implementation]

### Pattern 3: RLS template that every future table copies

**What:** Per-operation policies, `TO authenticated`, `(select auth.uid())` wrapper (per-statement caching, ~95% faster per official benchmark), `user_id uuid not null default auth.uid()` column, btree index on `user_id`. [CITED: supabase.com/docs/guides/database/postgres/row-level-security]
**When to use:** `resumes` now; jobs/watchlist/preferences/applications in Phases 2–4 copy it verbatim. The one later exception is the global `jobs` table (shared, read-only policy — see ARCHITECTURE.md Pattern 3), which is deliberately NOT user-scoped.
**Example:** see Code Example 2.

### Pattern 4: Private storage bucket, first folder = user id

**What:** Private bucket `resumes`; object paths `"{user_id}/{uuid}.docx"`; policies on `storage.objects` per operation with `bucket_id = 'resumes' AND (storage.foldername(name))[1] = (select auth.uid()::text)`. Downloads via `.download()` (respects SELECT policy) — signed URLs not needed in Phase 1 since only the owner ever fetches their file. [CITED: supabase.com/docs/guides/storage/security/access-control]
**When to use:** Resume upload in this phase (walking-skeleton real write) and all later file features.

### Pattern 5: Hard delete = storage first, then rows (and never trust one side)

**What:** Per-item delete: `storage.from('resumes').remove([path])` then `delete from resumes where id = ...` (RLS scopes both). Delete-all: empty the user's storage folder (list → remove in batches), then call `delete_my_data()` RPC which deletes the user's rows from every user-owned table in one transaction.
**When to use:** D-09/D-10/D-11. The RPC runs as `security invoker` so RLS still applies — it's a convenience wrapper, not a privilege escalation.
**Why storage first:** if row delete succeeded but file remove failed, the file would be orphaned with no metadata pointing at it (invisible to the user, violates "gone from both" criterion). Deleting the file first means a failure leaves a visible row the user can retry.

### Anti-Patterns to Avoid

- **Building any signup/invite UI:** D-01/D-02 forbid it. No `/signup` route, no `signUp()` call anywhere in the client bundle.
- **App-level filtering as the isolation mechanism:** `.eq('user_id', uid)` in queries is a performance/UX aid only; RLS is the boundary. Success criterion 3 is tested against the API, not the UI.
- **Secret key anywhere near the frontend:** the seed script and its `.env` live outside `web/`; add `.env` to `.gitignore` before the first commit.
- **`DELETE` on `storage.objects` rows via SQL:** deleting metadata rows directly leaves the underlying files orphaned in S3; always delete files through the Storage API. [ASSUMED — widely documented Supabase behavior; verify during implementation]
- **Custom "session keep-alive" code:** unnecessary; defaults already give indefinite sessions.
- **Landing password-reset links on a route the allowlist doesn't cover:** every `redirectTo` must be registered under Auth → URL Configuration, and Site URL must be the production Pages URL (default is `http://localhost:3000` — a classic silent failure).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Password hashing, JWT minting, refresh rotation | Custom auth tables/tokens | Supabase Auth (GoTrue) | Battle-tested; hand-rolled auth is the #1 ASVS failure source |
| Session persistence across refresh | localStorage token juggling | supabase-js defaults | `persistSession`+`autoRefreshToken` already do exactly D-06 |
| Per-user authorization | WHERE clauses in app code | Postgres RLS policies | Enforced at the data layer for every client, including curl with a stolen JWT |
| Password reset token flow | Custom reset tokens/emails | `resetPasswordForEmail` + `PASSWORD_RECOVERY` event | Token issuance, expiry, and single-use handled by GoTrue |
| File access control | Proxy endpoints for downloads | Storage RLS + `.download()` | Bucket policies are the same RLS mental model as tables |
| SPA route fallback on CDN | Custom worker/redirect logic | Cloudflare Pages automatic SPA behavior (no 404.html) | Zero config; documented platform behavior |
| Dark mode | Theme toggle + persistence | CSS `prefers-color-scheme` via Tailwind's default `dark:` media strategy | D-14 says follow OS — that's the no-code default |

**Key insight:** Phase 1 contains almost no algorithmic code. Its risk is *configuration* correctness (signup toggle, URL allowlist, SMTP delivery, RLS coverage) — the plan should spend its verification budget there, not on unit-testing UI.

## Common Pitfalls

### Pitfall 1: Password reset emails silently undeliverable to the second user (BLOCKS D-05)
**What goes wrong:** Supabase's default email service sends **only to project team-member addresses** ("Email address not authorized" otherwise) at **2 emails/hour** total, best-effort, no SLA. User 2 (not a team member) never gets a reset email; success criterion "reset ships in v1" fails in a way that demos fine for user 1.
**Why it happens:** The restriction is a platform anti-abuse rule, invisible until a non-team address is used. [VERIFIED: supabase.com/docs/guides/auth/auth-smtp + multiple cross-checked sources]
**How to avoid:** Decide the delivery path in the plan: **(a) zero-cost:** invite user 2's email as a member of the Supabase organization — default sender then works for both users, and 2/hr is ample for resets between two people; **(b) robust:** configure custom SMTP with Resend (available on free plan; default limit becomes 30/hr) — but Resend needs a verified sending domain; **(c) break-glass fallback either way:** a local admin script using `auth.admin.updateUserById(uid, { password })`. Note: as of June 2026, free projects on the default sender can no longer customize email templates — cosmetic only, ignore for v1. [VERIFIED: web cross-check 2026-07]
**Warning signs:** reset works for the developer's email but "nothing arrives" for the other user; AuthApiError mentioning authorized addresses; rate-limit errors while testing reset repeatedly (2/hr cap!).

### Pitfall 2: Site URL / redirect allowlist left at defaults — reset links point at localhost
**What goes wrong:** Reset email links redirect to `http://localhost:3000` (the default Site URL) or the `redirectTo` is ignored because it's not in the allowlist; the recovery session lands nowhere.
**How to avoid:** Migration-adjacent config task: set Site URL to the production Pages URL; add `https://<app>.pages.dev/reset-password` (and local dev URL) to Auth → URL Configuration → Redirect URLs. Test the full email round-trip on the deployed URL, not localhost. [CITED: supabase.com/docs/guides/auth/passwords]
**Warning signs:** clicking the email link opens localhost or the login page with no `PASSWORD_RECOVERY` event.

### Pitfall 3: "Deleted" resumes still exist on one side (DB row or storage object)
**What goes wrong:** Deleting the metadata row doesn't touch the file; deleting the file doesn't touch the row. Also, `storage.remove()` **returns success with an empty array when RLS denies the delete** rather than throwing — a policy gap looks like a working delete. [ASSUMED — commonly reported supabase-js behavior; verify explicitly during implementation]
**How to avoid:** Delete file first, then row (Pattern 5); after `.remove()`, check the returned data actually lists the removed object; verification step for AUTH-04 must confirm absence in BOTH `select` and a storage `list()` call.
**Warning signs:** storage usage not shrinking after deletes; `remove()` resolving with `data: []`.

### Pitfall 4: RLS coverage gaps — enabled-but-no-policy, or policy-without-WITH CHECK
**What goes wrong:** Three variants: (1) table created without `enable row level security` — all rows visible to both users via PostgREST; (2) RLS enabled but no INSERT policy — feature mysteriously broken with 403s; (3) UPDATE policy missing `WITH CHECK` — a user can re-parent a row to the other user.
**How to avoid:** The migration template (Code Example 2) always: enables RLS immediately after `create table`, defines all four operation policies, includes `WITH CHECK` on INSERT/UPDATE, defaults `user_id` to `auth.uid()`. Verify with the two-account script (Code Example 5), including an UPDATE that attempts `set user_id = <other user>`.
**Warning signs:** empty results as *authenticated* user but rows visible in the SQL editor (service role bypasses RLS — never test isolation from the dashboard).

### Pitfall 5: Supabase free project pauses after ~7 days of inactivity
**What goes wrong:** Phase 1 has no cron keeping the project warm (that arrives in Phase 2). If both users skip a week, the project pauses; the app then fails to load data until someone restores it from the dashboard (~30 s manual action).
**How to avoid:** Accept the risk for the days between Phase 1 and Phase 2 (documented failure mode per PITFALLS.md); do NOT build keep-alive infrastructure in this phase — Phase 2's pg_cron pipeline is the real fix. Mention the manual-restore path in the phase verification notes. Also: no free-tier backups — after real resumes are uploaded, take a manual `pg_dump`/export (PITFALLS.md security table).
**Warning signs:** dashboard shows "Paused"; API returns errors after a quiet week.

### Pitfall 6: Legacy vs new API keys confusion
**What goes wrong:** Tutorials reference `anon`/`service_role` JWT-shaped keys; new projects in 2026 surface `sb_publishable_...` / `sb_secret_...` keys. Legacy keys are deprecated by end of 2026. Mixing naming in env vars causes copy-paste errors (e.g., a secret key pasted into `VITE_`-prefixed var — which Vite would happily bundle into public JS).
**How to avoid:** Use the new keys: `VITE_SUPABASE_PUBLISHABLE_KEY` in the SPA, `SUPABASE_SECRET_KEY` only in `scripts/.env` (gitignored, never `VITE_`-prefixed). [VERIFIED: supabase.com/docs/guides/getting-started/api-keys + migration guide]
**Warning signs:** any env var containing `sb_secret_` with a `VITE_` prefix — grep for this in verification.

### Pitfall 7: Testing session persistence only in dev
**What goes wrong:** localStorage sessions survive refresh in dev, but the deployed check matters: success criterion 2 is "at the deployed URL." Third-party-cookie or storage partitioning is not an issue for localStorage on same origin, but a misconfigured Pages custom domain or hard-coded localhost Supabase URL breaks the deployed flow while dev works.
**How to avoid:** Set `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` as Cloudflare Pages build environment variables; verify login + refresh + next-day revisit on the `*.pages.dev` URL with both accounts.

## Code Examples

Verified patterns from official sources (adapted to this project's names).

### 1. Seed script — invite-only account creation (Claude's discretion resolved: admin API, not SQL)
```typescript
// scripts/seed-users.ts — run locally: node --env-file=scripts/.env scripts/seed-users.ts
// Source: https://supabase.com/docs/reference/javascript/auth-admin-createuser
import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!, // sb_secret_... — NEVER in the web app or repo
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const users = [
  { email: "jk8839888@gmail.com", password: process.env.SEED_PASSWORD_1! },
  { email: process.env.USER2_EMAIL!, password: process.env.SEED_PASSWORD_2! },
];

for (const u of users) {
  const { data, error } = await admin.auth.admin.createUser({
    email: u.email,
    password: u.password,
    email_confirm: true, // no confirmation email needed — sidesteps SMTP entirely
  });
  if (error) throw error;
  console.log(`created ${data.user.email} (${data.user.id})`);
}
```
Prerequisite (dashboard config, not code): Authentication → Sign In / Providers → Email → "Allow new users to sign up" = **OFF**. Client `signUp()` then errors; this script still works. [VERIFIED: supabase discussions #3208/#4296]

### 2. RLS migration template (the pattern all later tables copy)
```sql
-- supabase/migrations/0002_resumes.sql
-- Source: https://supabase.com/docs/guides/database/postgres/row-level-security
create table public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  filename text not null,
  storage_path text not null unique,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

alter table public.resumes enable row level security;  -- IMMEDIATELY after create

create index resumes_user_id_idx on public.resumes using btree (user_id);

create policy "resumes_select_own" on public.resumes
  for select to authenticated
  using ( (select auth.uid()) = user_id );

create policy "resumes_insert_own" on public.resumes
  for insert to authenticated
  with check ( (select auth.uid()) = user_id );

create policy "resumes_update_own" on public.resumes
  for update to authenticated
  using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );  -- blocks re-parenting to other user

create policy "resumes_delete_own" on public.resumes
  for delete to authenticated
  using ( (select auth.uid()) = user_id );
```

### 3. Storage bucket + per-user folder policies
```sql
-- supabase/migrations/0003_storage.sql
-- Source: https://supabase.com/docs/guides/storage/security/access-control
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('resumes', 'resumes', false, 5242880,
        array['application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/pdf'])
on conflict (id) do nothing;

create policy "resumes_storage_select" on storage.objects
  for select to authenticated
  using ( bucket_id = 'resumes'
          and (storage.foldername(name))[1] = (select auth.uid()::text) );

create policy "resumes_storage_insert" on storage.objects
  for insert to authenticated
  with check ( bucket_id = 'resumes'
               and (storage.foldername(name))[1] = (select auth.uid()::text) );

create policy "resumes_storage_delete" on storage.objects
  for delete to authenticated
  using ( bucket_id = 'resumes'
          and (storage.foldername(name))[1] = (select auth.uid()::text) );
-- Upload path convention in app code: `${user.id}/${crypto.randomUUID()}.docx`
```

### 4. Delete-all-my-data RPC + client flow (D-09/D-10/D-11)
```sql
-- supabase/migrations/0004_delete_my_data.sql
create or replace function public.delete_my_data()
returns void
language plpgsql
security invoker  -- RLS still applies; deletes only the caller's rows
set search_path = ''
as $$
begin
  delete from public.resumes where user_id = (select auth.uid());
  -- Phases 2-4 append: watchlist_companies, preferences, user_job_matches, applications
end;
$$;
```
```typescript
// Settings.tsx — after type-DELETE confirmation dialog
const { data: files } = await supabase.storage.from("resumes").list(user.id, { limit: 1000 });
if (files?.length) {
  const paths = files.map((f) => `${user.id}/${f.name}`);
  const { data: removed, error } = await supabase.storage.from("resumes").remove(paths);
  if (error || removed?.length !== paths.length) throw new Error("storage delete incomplete");
}
const { error: rpcErr } = await supabase.rpc("delete_my_data");
if (rpcErr) throw rpcErr;
```

### 5. Two-account RLS verification (success criterion 3 — run as a script, not a UI check)
```typescript
// scripts/verify-rls.ts — sign in as BOTH users with the PUBLISHABLE key (never secret)
const a = createClient(URL, PUBLISHABLE_KEY, { auth: { persistSession: false } });
const b = createClient(URL, PUBLISHABLE_KEY, { auth: { persistSession: false } });
await a.auth.signInWithPassword({ email: USER_A, password: PW_A });
await b.auth.signInWithPassword({ email: USER_B, password: PW_B });

// A inserts; B must see zero rows
await a.from("resumes").insert({ filename: "probe.docx", storage_path: `${uidA}/probe` });
const { data: leak } = await b.from("resumes").select("*");
assert(leak!.length === 0, "CROSS-USER READ LEAK");

// B attempts targeted read/update/delete of A's row by id — all must affect 0 rows
// B attempts storage download of A's path — must 400/404
// A attempts UPDATE ... set user_id = uidB — must fail WITH CHECK
```

### 6. Auth wiring — provider, guard, reset flow
```typescript
// lib/supabase.ts
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
); // defaults: persistSession=true (localStorage), autoRefreshToken=true → AUTH-02

// auth/AuthProvider.tsx (shape)
useEffect(() => {
  supabase.auth.getSession().then(({ data }) => setSession(data.session));
  const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
    setSession(session);                       // no awaits inside this callback
    if (event === "PASSWORD_RECOVERY") navigate("/reset-password");
  });
  return () => sub.subscription.unsubscribe();
}, []);

// Login.tsx: supabase.auth.signInWithPassword({ email, password })
// Forgot: supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/reset-password` })
// ResetPassword.tsx + Settings password change: supabase.auth.updateUser({ password: newPw })
// Source: https://supabase.com/docs/guides/auth/passwords
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `anon` / `service_role` JWT keys | `sb_publishable_...` / `sb_secret_...` keys | Rolling through 2025–2026; legacy deprecated end of 2026 | Use new keys in all env vars; tutorials showing JWT-shaped keys are outdated [VERIFIED: supabase docs] |
| Vite 7 / react-router 7 (per STACK.md, researched 2026-07-15) | Vite 8.1.x / react-router 8.2.x on npm latest | Majors shipped by mid-2026 | Accept scaffold-pinned versions; declarative router API unchanged in practice — fall back to `^7` only on concrete breakage [VERIFIED: npm registry] |
| TypeScript 5.x | TS 7.x (native port) now `latest` on npm | 2026 | Do not hand-adopt TS 7 this phase; use whatever `create-vite` pins [ASSUMED: scaffold behavior] |
| Tailwind PostCSS setup | `@tailwindcss/vite` first-party plugin, CSS `@import "tailwindcss"` | Tailwind v4 (2025) | No `tailwind.config.js` needed for the media-strategy dark mode D-14 requires |
| Customizable auth email templates on free default sender | New free projects on default sender: templates NOT customizable | June 2026 | Cosmetic only; custom SMTP restores it [VERIFIED: web cross-check] |
| `supabase.auth.getUser()` everywhere for route guards | `getSession()` for local UI state; server-verified check unnecessary in pure SPA + RLS model | — | RLS is the enforcement layer; the guard is UX only |

**Deprecated/outdated:**
- Legacy API keys (see above) — plan should never reference `service_role` by name; use "secret key."
- `docs` patterns using `auth.jwt()->>'sub'` in storage policies work, but `(select auth.uid()::text)` is the consistent form with table policies — use one form everywhere.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `storage.remove()` silently succeeds (empty array) when RLS denies the delete | Pitfall 3 | Delete verification would pass while files persist — mitigated by explicit list-after-delete check either way |
| A2 | Adding user 2 as a Supabase **organization member** is possible on the free plan and makes the default sender deliver reset emails to them | Pitfall 1, Open Q1 | Reset path (a) fails; fall back to Resend SMTP (b) or admin reset script (c) — verify by sending a real reset email to user 2 during phase execution |
| A3 | Deleting `storage.objects` rows via SQL orphans underlying files | Anti-patterns | Low — we never do it; noted only as a prohibition |
| A4 | `onAuthStateChange` callback deadlock when awaiting supabase calls inside it | Pattern 2 | Low — the recommended pattern (set state, react in effects) is good practice regardless |
| A5 | react-router 8 declarative-mode API is drop-in compatible with the v7 patterns in STACK.md | Standard Stack | Install-time type errors; fall back to `react-router@^7` (explicitly sanctioned) |
| A6 | Vite scaffold pins TS 5.x, not TS 7 | Standard Stack | If scaffold pins TS 7 and tooling breaks, pin `typescript@^5` manually |
| A7 | `current_password` reauth param on `updateUser` (supabase-js ≥2.102.0) works as documented | Security Domain | Optional hardening only; password change works without it |

## Open Questions

1. **Which reset-email delivery path? (needs a decision before the reset UI task)**
   - What we know: default sender = team members only, 2/hr [VERIFIED]; custom SMTP available on free plan but Resend needs a verified domain; org-member add is free.
   - What's unclear: whether free-plan orgs accept a second member without friction (A2), and whether the users own a domain for Resend.
   - Recommendation: plan for **(a) org-member add** as primary (zero cost, zero new services), with the **admin reset script (c)** shipped in `scripts/` regardless as break-glass. Surface (b) Resend SMTP as the Phase 3 upgrade path (Resend gets configured then anyway for notifications).
2. **Second user's email (D-03)**
   - Blocking only for the final seed-script run, not for building it. Script should read emails from env, so the plan isn't blocked on this.
3. **Cloudflare Pages project creation is dashboard-manual**
   - Git integration setup (connect repo, set build command `npm run build`, output `dist`, env vars) happens in the CF dashboard — plan this as a human-in-the-loop checkpoint, same for the Supabase project creation + signup toggle + URL configuration (no API/CLI on free tier covers all of it cleanly).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Vite build, seed script | ✓ | v26.3.1 | — |
| npm | package management | ✓ | 11.16.0 | — |
| git | repo + Pages Git integration | ✓ | 2.39.3 (repo not yet initialized — `git init` is a Phase 1 task) | — |
| Supabase CLI | migrations (`db push`) | ✗ | — | `npm install -D supabase` (verified 2.109.1 on npm) — no global install needed |
| Docker | `supabase start` local stack | ✗ | — | **Develop against the hosted free project**; apply migrations with `npx supabase db push`. Acceptable for 2-user greenfield; do not plan tasks that require the local stack |
| Wrangler | CF Pages deploy | ✗ | — | Not needed — use Pages Git integration (dashboard); `npx wrangler` available if direct-upload ever needed |
| gh CLI | GitHub repo creation for Pages integration | ✓ | 2.96.0 | — |
| Deno | Edge functions | ✗ (not needed this phase) | — | Phase 2 concern |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** Supabase CLI (npm dev-dep), Docker (hosted-project workflow), Wrangler (Git integration).

## Security Domain

ASVS Level 1 scope (config: `security_enforcement: true`, `security_asvs_level: 1`).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase Auth (GoTrue): bcrypt hashing, no public signup, min password length ≥ 8 set in dashboard; no 2FA per D-07 (accepted risk, 2 known users) |
| V3 Session Management | yes | supabase-js managed sessions; 1h JWTs + rotating refresh tokens; logout via `signOut()`; localStorage acceptable for this threat model (no untrusted JS, no third-party scripts — keep it that way) |
| V4 Access Control | yes | Postgres RLS on every user-owned table + storage.objects policies; verified with the two-account script; no admin role exists (D-04) |
| V5 Input Validation | yes | Upload constraints in bucket config (`file_size_limit` 5 MB, MIME allowlist DOCX/PDF); filename never used as storage path (UUID paths); no other free-text inputs land in queries (PostgREST parameterizes) |
| V6 Cryptography | yes | Nothing hand-rolled: TLS everywhere, Supabase-managed at-rest encryption for DB and Storage (satisfies "encrypted private cloud storage" constraint) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-user data access (IDOR via PostgREST) | Information disclosure | RLS per-operation policies; verify with targeted by-id reads as the other user |
| Row re-parenting (`update set user_id`) | Tampering | `WITH CHECK` on UPDATE policies (Code Example 2) |
| Secret key leakage into client bundle | Information disclosure | Secret key only in `scripts/.env` (gitignored); grep verification: no `sb_secret` under `web/`; Vite only exposes `VITE_`-prefixed vars |
| Open redirect via reset link `redirectTo` | Spoofing | Supabase redirect-URL allowlist (only own origins registered) |
| Credential stuffing / brute force on the 2 accounts | Elevation of privilege | Supabase Auth built-in rate limits; strong seeded passwords; no username enumeration on the minimal login page (generic error copy) |
| Account takeover via password change on stolen session | Elevation of privilege | Optional: `current_password` reauth on `updateUser` (supabase-js ≥ 2.102.0) — recommend enabling in Settings flow [A7] |
| Malicious file upload (wrong type/oversize) | Tampering/DoS | Bucket MIME allowlist + size limit enforced server-side in bucket config, not just client validation |

## Sources

### Primary (official docs fetched this session)
- [supabase.com/docs/guides/auth/auth-smtp](https://supabase.com/docs/guides/auth/auth-smtp) — default sender team-member restriction, 2/hr limit, custom SMTP setup
- [supabase.com/docs/guides/auth/sessions](https://supabase.com/docs/guides/auth/sessions) — indefinite default sessions; time-box/inactivity = Pro-only; 1h JWT default
- [supabase.com/docs/guides/database/postgres/row-level-security](https://supabase.com/docs/guides/database/postgres/row-level-security) — `(select auth.uid())`, `TO authenticated`, indexing, per-op policies
- [supabase.com/docs/guides/storage/security/access-control](https://supabase.com/docs/guides/storage/security/access-control) — `storage.foldername` per-user folder policies
- [supabase.com/docs/guides/auth/passwords](https://supabase.com/docs/guides/auth/passwords) — reset flow, `PASSWORD_RECOVERY`, redirect allowlist, `current_password` reauth
- [supabase.com/docs/reference/javascript/auth-admin-createuser](https://supabase.com/docs/reference/javascript/auth-admin-createuser) — admin createUser params, server-only
- [developers.cloudflare.com/pages/configuration/serving-pages](https://developers.cloudflare.com/pages/configuration/serving-pages/) — automatic SPA fallback without 404.html
- npm registry via `npm view` — all package versions (2026-07-16)

### Secondary (web search, cross-checked)
- [supabase.com/docs/guides/getting-started/api-keys](https://supabase.com/docs/guides/getting-started/api-keys) + [migrating-to-new-api-keys](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys) — publishable/secret key migration, legacy deprecation end of 2026
- [Supabase discussion #3208](https://github.com/orgs/supabase/discussions/3208) / [#4296](https://github.com/orgs/supabase/discussions/4296) — signup-disabled + admin creation behavior
- Custom-SMTP-on-free-plan cross-check: sendlayer.com, dreamlit.ai, mailtrap.io guides (2026)

### Tertiary (project docs, prior research)
- `.planning/research/STACK.md`, `ARCHITECTURE.md`, `PITFALLS.md` (2026-07-15) — stack versions (superseded where npm registry differs), build-order rationale, 7-day-pause/no-backup warnings

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions registry-verified today; only the RR7→8 delta carries mild risk (sanctioned fallback exists)
- Auth/session/RLS/storage patterns: HIGH — fetched from official docs this session
- Reset-email delivery constraint: HIGH that the restriction exists; MEDIUM on the org-member workaround (A2 — verify live during execution)
- Pitfalls: HIGH for 1/2/4/6 (doc-verified), MEDIUM for 3/5 (known community behavior + prior project research)

**Research date:** 2026-07-16
**Valid until:** 2026-08-15 (Supabase config surfaces move; re-check SMTP restriction and key naming if planning slips a month)

# Phase 1: Foundation & Access - Context

**Gathered:** 2026-07-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Deployed web app (Cloudflare Pages + Supabase Free) where the two invited users log in with email/password, stay logged in across refreshes, and every row of their data is RLS-isolated and user-deletable. No public signup exists. Requirements: AUTH-01, AUTH-02, AUTH-03, AUTH-04.

</domain>

<decisions>
## Implementation Decisions

### Invite mechanism
- **D-01:** Both accounts pre-seeded by an admin script at deploy time using the two users' real emails. No signup UI exists anywhere in the app.
- **D-02:** Third parties hitting the URL see the login page only — no signup link, no "invite-only" explainer page; wrong credentials simply fail.
- **D-03:** User will provide the second user's email before deploy (first: jk8839888@gmail.com).
- **D-04:** Both users have equal capability. No admin role, no admin UI.

### Login & recovery
- **D-05:** Password reset ships in v1 via Supabase's built-in reset-by-email link.
- **D-06:** Long-lived sessions (~30+ days) with auto-renewing refresh tokens. No re-login friction on personal laptops.
- **D-07:** No 2FA.
- **D-08:** Login page is minimal: app name, email + password fields, submit button, forgot-password link. Nothing else.

### Data deletion UX
- **D-09:** Both granular and bulk deletion: per-item delete for resumes (and later data types) plus a "delete all my data" button in Settings.
- **D-10:** Hard delete — items removed immediately from both database and storage. No trash, no undo, no purge jobs.
- **D-11:** Confirmation: per-item deletes get a single confirm dialog; delete-all requires type-to-confirm (user types DELETE).

### App shell & look
- **D-12:** Phase 1 ships a real app shell: nav skeleton with Dashboard, Watchlist, Resumes, Tracker, Settings entries. Unbuilt pages show "coming soon" empty states. Settings is functional (password change, delete data).
- **D-13:** App name in UI: **Job Copilot**.
- **D-14:** Theme follows system: light + dark, auto-switch per OS setting.
- **D-15:** Style: clean minimal — neutral palette, dense tables, function over flair. Daily-use tool, not a showcase.

### Claude's Discretion
- Exact seed-script mechanics (Supabase admin API vs SQL), RLS policy structure, session token configuration details, empty-state copy, exact nav layout.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project planning
- `.planning/PROJECT.md` — Core value, constraints (near-zero cost, security/integrity rules)
- `.planning/REQUIREMENTS.md` — AUTH-01..04 definitions
- `.planning/ROADMAP.md` — Phase 1 success criteria

### Research
- `.planning/research/STACK.md` — React 19 + Vite on Cloudflare Pages, Supabase Free specifics, free-tier limits
- `.planning/research/ARCHITECTURE.md` — Build order rationale (auth/schema/RLS first; retrofit painful)
- `.planning/research/PITFALLS.md` — Supabase 7-day inactivity pause, free-tier behavioral limits, no-backups warning

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — greenfield repo, no code yet.

### Established Patterns
- None yet — Phase 1 establishes them (project scaffold, RLS policy style, component conventions).

### Integration Points
- Phase 1 schema must anticipate later tables (jobs, watchlist, preferences, resumes, applications) so RLS pattern extends cleanly — but only auth/profile/resume-storage foundations are built here.

</code_context>

<specifics>
## Specific Ideas

- Login page deliberately anonymous-looking to outsiders: just "Job Copilot" and a login form, nothing about what the app does.
- Full nav skeleton up front so later phases fill pages in rather than restructuring the shell.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 1-Foundation & Access*
*Context gathered: 2026-07-15*

# Phase 1: Foundation & Access - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-15
**Phase:** 1-Foundation & Access
**Areas discussed:** Invite mechanism, Login & recovery, Data deletion UX, App shell & look

---

## Invite mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Pre-seeded | Admin script creates both accounts at deploy time; no signup UI | ✓ |
| Email allowlist | Signup page exists, whitelisted emails only | |
| Invite codes | Signup needs a secret code | |

**User's choice:** Pre-seeded

| Option | Description | Selected |
|--------|-------------|----------|
| Login only | Login page, no signup link, wrong credentials fail | ✓ |
| Explicit lockout page | "Invite-only" message page | |

**User's choice:** Login only for third parties

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, will provide | Both real emails seeded at deploy | ✓ |
| Placeholder second | Placeholder second account, change later | |

**User's choice:** Real emails; second email to be provided before deploy

| Option | Description | Selected |
|--------|-------------|----------|
| Equal | Both identical capability, no admin UI | ✓ |
| One admin | One account manages the other | |

**User's choice:** Equal users

---

## Login & recovery

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, email link | Supabase built-in reset via email | ✓ |
| No, manual reset | Reset by hand via Supabase dashboard | |

**User's choice:** Password reset in v1 via email link

| Option | Description | Selected |
|--------|-------------|----------|
| Long-lived | ~30+ days, auto-renewing refresh tokens | ✓ |
| Standard week | Re-login weekly | |
| Short + remember-me | Short default with opt-in checkbox | |

**User's choice:** Long-lived sessions

| Option | Description | Selected |
|--------|-------------|----------|
| No | Low risk for 2 invite-only users | ✓ |
| Yes, TOTP | Authenticator app codes | |

**User's choice:** No 2FA

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal | App name, two fields, submit, forgot-password link | ✓ |
| You decide | Claude picks during planning | |

**User's choice:** Minimal login page

---

## Data deletion UX

| Option | Description | Selected |
|--------|-------------|----------|
| Per-item + nuke-all | Individual deletes plus delete-all-my-data in settings | ✓ |
| Per-item only | One-at-a-time deletes only | |
| Nuke-all only | Single wipe button only | |

**User's choice:** Per-item + nuke-all

| Option | Description | Selected |
|--------|-------------|----------|
| Hard delete | Gone immediately from DB + storage | ✓ |
| Soft with 30-day trash | Recoverable window with purge job | |

**User's choice:** Hard delete

| Option | Description | Selected |
|--------|-------------|----------|
| Simple confirm | Per-item confirm dialog; nuke-all type-to-confirm | ✓ |
| You decide | Claude picks during planning | |

**User's choice:** Simple confirm + type-to-confirm for delete-all

---

## App shell & look

| Option | Description | Selected |
|--------|-------------|----------|
| Shell + nav | Nav skeleton with coming-soon empty states; Settings functional | ✓ |
| Settings only | Just settings page; nav grows per phase | |
| You decide | Claude picks | |

**User's choice:** Shell + nav

| Option | Description | Selected |
|--------|-------------|----------|
| Job Copilot | Matches project docs | ✓ |
| Job Helper | Matches GitHub repo name | |
| You decide | Claude picks | |

**User's choice:** Job Copilot

| Option | Description | Selected |
|--------|-------------|----------|
| Follow system | Light + dark auto-switch | ✓ |
| Dark only | One theme | |
| Light only | One theme | |

**User's choice:** Follow system

| Option | Description | Selected |
|--------|-------------|----------|
| Clean minimal | Neutral palette, dense tables, function over flair | ✓ |
| Polished product | More personality, cards, accents | |
| You decide | Claude picks | |

**User's choice:** Clean minimal

---

## Claude's Discretion

- Seed-script mechanics (Supabase admin API vs SQL)
- RLS policy structure
- Session token configuration details
- Empty-state copy and exact nav layout

## Deferred Ideas

None — discussion stayed within phase scope.

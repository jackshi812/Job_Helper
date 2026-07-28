# AUTH-03 Shared System Scope Decision

**Accepted by:** owner

**Accepted at:** 2026-07-28

**Milestone:** v1.0

The monitored-company/source catalog and raw provider job pool are intentional
shared system data for the two invited accounts. Both users may see the same
monitored companies and raw discovered jobs; anonymous access remains denied.

Every user-derived record remains private and owner-scoped:

- preferences;
- resumes and resume extracts;
- deterministic ranking state, runs, items, and results;
- dismissals;
- applications and application stage events; and
- AI usage accounting associated with that user.

The Settings “delete all my data” action deletes those personal records and
resume storage objects. It deliberately retains the user's login/profile and
the shared monitored-company/raw-job system catalog.

This decision clarifies AUTH-03; it does not weaken RLS isolation for personal
data or grant anonymous access.

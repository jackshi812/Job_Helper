# Phase 4: Application Tracker - Context

**Gathered:** 2026-07-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 4 delivers a private application tracker for both system-discovered jobs and positions the user finds elsewhere. It covers application creation, the current lifecycle stage, chronological stage history, notes, preserved job-description context, prioritization, and an optional link to a resume the user prepared manually.

The tracker does not tailor or generate resumes, submit applications, rank manually entered jobs, or add a separate Dashboard save workflow.

</domain>

<decisions>
## Implementation Decisions

### Dashboard-to-tracker flow

- **D-01:** A system-discovered job enters the tracker when the user selects **Mark Applied** on the Dashboard. That action creates or updates the tracker entry at Applied.
- **D-02:** Do not add **Save to tracker** or create tracker entries merely because an employer Apply link was opened.
- **D-03:** Manually entered positions exist in the Tracker only. They do not appear in or receive ranking from the Dashboard.
- **D-04:** Dashboard **Show applied** contains every system job that was ever marked applied, even after its tracker stage changes. It displays the current tracker stage and the job never returns to the active Dashboard queue.

### Tracker table and stages

- **D-05:** Use exactly six tracker stages: **Ready to Apply**, **Applied**, **Outreach Sent**, **Interview**, **Offer**, and **Rejected**. This decision supersedes the legacy seven-stage wording in TRAK-01 and the Phase 4 roadmap: **Saved** is renamed **Ready to Apply**, and **Resume Prepared** is removed.
- **D-06:** Stage treatments are: Ready to Apply neutral, Applied blue, Outreach Sent cyan, Interview light green, Offer green, and Rejected red.
- **D-07:** Present applications in one spreadsheet-like table with stage filters, not a Kanban board or separate tables. Each row uses a colored stage badge and a subtle matching accent.
- **D-08:** Use hybrid Excel-style editing. Stage, relevant date, and notes edit inline. Company and title are read-only for system-discovered jobs but remain editable for manual jobs.
- **D-09:** Default visibility includes active stages only: Ready to Apply, Applied, Outreach Sent, and Interview. Offer and Rejected remain accessible through filters.
- **D-10:** Users can star or pin applications. Pinned rows sort first; unpinned rows sort by most recently updated.
- **D-11:** Autosave each edited cell and show an explicit **Saving**, **Saved**, or **Retry** state.

### Stage history and dates

- **D-12:** Keep the main table compact. Expanding a row reveals a full-width horizontal timeline with dates above circular nodes and stage/event labels below, following the supplied visual reference.
- **D-13:** The timeline is chronological event history rather than a fixed one-node-per-stage diagram. Repeated events create additional nodes, including Interview 1, Interview 2, and later rounds.
- **D-14:** Every stage update automatically records the current date without prompting.
- **D-15:** Users can edit or delete timeline events to correct mistakes. The application’s current stage recalculates from the most recent remaining event.

### Manual job capture

- **D-16:** **Add position** inserts a new editable row directly into the table.
- **D-17:** A manual position requires company, job title, and job URL. Location, job description, notes, and other details are optional.
- **D-18:** New manual rows default to Ready to Apply, with the stage dropdown immediately editable.
- **D-19:** A likely duplicate company/title combination produces a warning but does not block creation.

### Notes and resume links

- **D-20:** Each application has one freeform notes field. The table shows an inline preview and the expanded row shows the full text.
- **D-21:** An application may optionally reference an existing item in the user’s private Resume Library. The app does not generate or tailor that resume.
- **D-22:** Show the linked resume in the expanded row and use a small resume icon in the main row as an indicator; do not add a dedicated Resume column.
- **D-23:** If a linked resume is deleted, retain the application and automatically clear the resume reference.

### the agent's Discretion

- Exact database schema, migration structure, and API boundaries, provided system and manual applications share one tracker lifecycle.
- Exact table column order, responsive behavior, timeline connector styling, and neutral Ready to Apply palette within the locked spreadsheet and color decisions.
- Empty, loading, validation, and recoverable error-state wording consistent with established application patterns.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product scope and requirements

- `.planning/PROJECT.md` — Product boundary, privacy model, manual resume preparation, and explicit exclusion of automated resume tailoring.
- `.planning/REQUIREMENTS.md` — Phase 4 tracker requirements TRAK-01 through TRAK-04. D-05 in this context supersedes TRAK-01’s legacy stage labels.
- `.planning/ROADMAP.md` — Phase goal, dependencies, success criteria, and delivery sequence. D-05 in this context supersedes the roadmap’s legacy seven-stage wording.

### Visual direction

- `.planning/phases/04-application-tracker/references/stage-timeline-reference.png` — Required direction for the expanded horizontal event timeline: connecting line, circular milestones, dates above, and labels below.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `web/src/pages/Dashboard.tsx`: Existing table, filters, sorting controls, query invalidation, lifecycle views, and per-row action patterns.
- `web/src/lib/dashboardColumns.ts`: Existing resizable Dashboard column definitions and width constraints.
- `web/src/pages/JobDetail.tsx`: Existing safe rendering for preserved job-description HTML/text.
- `web/src/pages/Resumes.tsx` and `web/src/lib/resumes.ts`: Existing private Resume Library queries, labels, download/delete behavior, and React Query key.
- `web/src/components/ConfirmDialog.tsx`: Existing destructive-action confirmation pattern for timeline-event or application deletion where needed.

### Established Patterns

- React Query mutations invalidate scoped query keys after state changes and expose pending/error states.
- Supabase tables use per-user RLS policies; tracker records and history must preserve the same isolation.
- System-discovered feed rows reference `jobs` through `user_jobs`, while resume foreign keys use `ON DELETE SET NULL` where the parent may disappear.
- Job descriptions are fetched and rendered only in detail contexts rather than in the main Dashboard list.

### Integration Points

- `web/src/pages/Tracker.tsx` and the existing `/tracker` route are placeholders ready for the tracker UI.
- `web/src/lib/feed.ts::markJobApplied` currently writes `user_jobs.applied_at`; it must also create or update the shared tracker lifecycle without a competing state.
- `user_jobs` requires a system `job_id` and enforces one row per user/job, so manual external positions need tracker persistence that does not require a discovered job.
- Existing `jobs.description_html` and `jobs.description_text` provide preserved JD context for system jobs; manual entries need their own optional supplied context.
- The private `resumes` table is the source for optional tracker resume references.

</code_context>

<specifics>
## Specific Ideas

- The user explicitly wants the tracker to feel “like Excel”: direct cell editing, compact rows, and automatic per-cell saving.
- Expanding a row should visually resemble `.planning/phases/04-application-tracker/references/stage-timeline-reference.png`, adapted from years/events to application stage events.
- Stage history must preserve practical dates such as Applied, first interview, later interview rounds, Offer, and Rejected without adding a date column for every event.

</specifics>

<deferred>
## Deferred Ideas

None. Automated resume tailoring was intentionally removed from the product rather than deferred as part of this phase.

</deferred>

---

*Phase: 4-Application Tracker*
*Context gathered: 2026-07-27*

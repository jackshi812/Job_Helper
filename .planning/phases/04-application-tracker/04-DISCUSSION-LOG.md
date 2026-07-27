# Phase 4: Application Tracker - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-27
**Phase:** 4-Application Tracker
**Areas discussed:** Dashboard-to-tracker flow, Tracker table behavior, Manual job capture, Notes and resume links

---

## Dashboard-to-tracker flow

### System job entry trigger

| Option | Selected |
|--------|----------|
| Enter only when explicitly saved or marked applied | ✓, narrowed to Mark Applied only |
| Enter when the employer Apply link is clicked | |
| Add every eligible Dashboard job automatically | |

**User's choice:** Do not add a save action. Mark Applied automatically creates or updates the tracker entry at Applied.

### Manual position location

| Option | Selected |
|--------|----------|
| Add from the Dashboard but store in Tracker only | |
| Show in both Dashboard and Tracker | |
| Add directly in Tracker without Dashboard ranking | ✓ |

**User's choice:** Users manually add external positions in Tracker and can update their stages freely.

### Dashboard Show applied behavior

| Option | Selected |
|--------|----------|
| Keep every ever-applied system job and show its current tracker stage | ✓ |
| Show only jobs currently at Applied | |
| Remove Show applied | |

**User's choice:** A job remains in Show applied after progressing to Interview, Offer, Rejected, or another stage. It never returns to Active.

---

## Tracker table behavior

### Primary organization

| Option | Selected |
|--------|----------|
| One spreadsheet-like table with stage filters | ✓ |
| Kanban board grouped by stage | |
| Separate table for each stage | |

**User's choice:** One table that behaves like Excel.

### Stages and colors

| Option | Selected |
|--------|----------|
| Keep the original seven stages | |
| Rename Saved to Ready to Apply and remove Resume Prepared | ✓ |
| Use a shorter three-stage lifecycle | |

**User's choice:** Ready to Apply is neutral; Applied blue; Outreach Sent cyan; Interview light green; Offer green; Rejected red.

### Row treatment

| Option | Selected |
|--------|----------|
| Colored stage badge plus subtle matching row accent | ✓ |
| Colored badge only | |
| Fully color the row | |

### Editing model

| Option | Selected |
|--------|----------|
| Hybrid spreadsheet editing | ✓ |
| Make every field editable inline | |
| Open a separate edit form | |

**Notes:** Stage, relevant date, and short notes edit inline. System company/title stay read-only; manual company/title remain editable.

### Default visibility

| Option | Selected |
|--------|----------|
| Active stages by default | ✓ |
| All stages by default | |
| Only Applied and Interview | |

**Notes:** Active means Ready to Apply, Applied, Outreach Sent, and Interview. Offer and Rejected are available through filters.

### Priority and sorting

| Option | Selected |
|--------|----------|
| Pinned first, then most recently updated | ✓ |
| Manual drag ordering | |
| Most recently updated only | |

**User's choice:** Allow users to star or pin rows on top.

### Save behavior

| Option | Selected |
|--------|----------|
| Autosave each cell with Saving/Saved/Retry status | ✓ |
| Save the entire row explicitly | |
| Save the entire table explicitly | |

### Stage-date presentation

| Option | Selected |
|--------|----------|
| Expand the row into a full-width horizontal timeline | ✓ |
| Show a small timeline popover | |
| Add a separate column for every stage date | |

**Notes:** The user supplied a reference image with a horizontal blue line, circular milestones, dates above, and event labels below.

### Repeated events

| Option | Selected |
|--------|----------|
| Add a chronological node for every interview round | ✓ |
| Preserve only the first interview date | |
| Use one Interview node with first and latest dates | |

**User's choice:** Show Interview 1, Interview 2, and further rounds as separate events.

### Event dates

| Option | Selected |
|--------|----------|
| Automatically record the current date on every stage update | ✓ |
| Prompt for a date on every stage update | |
| Enter dates separately | |

### Corrections

| Option | Selected |
|--------|----------|
| Allow timeline events to be edited or deleted | ✓ |
| Allow date editing only | |
| Keep history permanent | |

**Notes:** Current stage recalculates from the most recent remaining event after a correction.

---

## Manual job capture

### Required fields

| Option | Selected |
|--------|----------|
| Company and job title only | Initially selected, then revised |
| Company, job title, and job URL | ✓ final choice |
| Company, job title, URL, and full job description | |

**User's choice:** Company, job title, and URL are required. Other details are optional.

### Creation interaction

| Option | Selected |
|--------|----------|
| Add position inserts an editable table row | ✓ |
| Open a small form above the table | |
| Open a separate modal | |

### Initial stage

| Option | Selected |
|--------|----------|
| Default to Ready to Apply with immediate stage editing | ✓ |
| Require a stage before creation | |
| Default to Applied | |

### Duplicate handling

| Option | Selected |
|--------|----------|
| Warn but allow the duplicate | ✓ |
| Prevent the duplicate | |
| Add without warning | |

---

## Notes and resume links

### Notes model

| Option | Selected |
|--------|----------|
| One freeform field with inline preview and expanded full text | ✓ |
| Chronological timestamped note entries | |
| Short single-line notes only | |

### Resume source

| Option | Selected |
|--------|----------|
| Select an existing private Resume Library item | ✓ |
| Paste an external resume URL | |
| Support both a library item and external URL | |
| Do not link resumes | |

**Notes:** Resumes are prepared manually outside the app. There is no automated tailoring or generation.

### Resume presentation

| Option | Selected |
|--------|----------|
| Show in the expanded row with a small icon in the main row | ✓ |
| Add a dedicated Resume column | |
| Put the link only inside notes | |

### Deleted resume behavior

| Option | Selected |
|--------|----------|
| Keep the application and clear the resume link | ✓ |
| Prevent deletion until all applications are unlinked | |
| Keep a broken reference | |

---

## the agent's Discretion

- Database schema and API boundaries.
- Exact table column order and responsive layout.
- Exact timeline connector styling within the supplied reference direction.
- Empty, loading, validation, and recoverable error-state wording.

## Deferred Ideas

None. Automated resume tailoring was removed from the product scope by owner decision.

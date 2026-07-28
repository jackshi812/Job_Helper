---
status: diagnosed
phase: 04-application-tracker
source: [04-VERIFICATION.md]
started: 2026-07-28T16:56:12Z
updated: 2026-07-28T18:48:45Z
---

## Current Test

[testing paused — owner-requested UI fixes are being implemented]

## Tests

### 1. Production Tracker renders
expected: Refresh the signed-in production Tracker; the placeholder is gone and the real Tracker header, Add position action, six stage filters, and table or real empty state render.
result: issue
reported: "window don't wide enought, don't want to scrow left to right; allow user to delete a job application from dashboard; After update confirm to update status; saved put on the very right replacing the Updated column. All column values should be fully visible without scrolling; For the stage folders, collaspe the 6 stages into one drop down, and collapse all stages terminal stages and active stages into one dropdown; DELETE the best fit resume feature entirely from dashboard, but still allow user to upload resume; Reorder Tabs: Watchlist Jobs -> All Jobs -> Tracker --> Resumes -> Preferences -> Settings."
severity: major

### 2. Manual tracking and detail editing persist
expected: Add a manual position, edit stage/date/notes, inspect its expanded timeline and details, optionally link a resume, reload, and observe the saved values and safe rendering.
result: pending

### 3. Dashboard and Tracker stay integrated
expected: Mark a Dashboard job applied, move it to Interview in Tracker, enable Show applied, and use View in Tracker; the current stage and focused row agree and opening Apply alone creates nothing.
result: pending

## Summary

total: 3
passed: 0
issues: 1
pending: 2
skipped: 0
blocked: 0

## Gaps

- truth: "The Tracker fits the available window, wraps complete values, and does not require horizontal scrolling."
  status: failed
  reason: "User reported the table is wider than the window and does not want left-right scrolling."
  severity: major
  test: 1
  root_cause: "Shell centers `/tracker` at `max-w-6xl` while Tracker forces a `min-w-[1224px]` fixed table inside `overflow-x-auto` and assigns rigid column widths."
  artifacts:
    - path: "web/src/components/Shell.tsx"
      issue: "Tracker route does not receive the full-width dashboard shell."
    - path: "web/src/pages/Tracker.tsx"
      issue: "The table and columns require horizontal overflow and the mobile copy instructs users to swipe."
  missing:
    - "Give `/tracker` the full-width shell."
    - "Remove the minimum table width and horizontal-scroll contract; wrap complete values in responsive fixed columns."

- truth: "A user can delete an owned application from the Tracker with explicit confirmation."
  status: failed
  reason: "User requested application deletion from the dashboard."
  severity: major
  test: 1
  root_cause: "Phase 04 intentionally omitted whole-application deletion; the database exposes only event deletion and authenticated clients have SELECT-only table grants."
  artifacts:
    - path: "supabase/migrations/0053_application_tracker.sql"
      issue: "No owner-scoped whole-application delete RPC exists."
    - path: "web/src/pages/Tracker.tsx"
      issue: "No confirmed delete action exists."
    - path: "web/src/pages/Dashboard.tsx"
      issue: "Show applied provides navigation but no application delete action."
  missing:
    - "Add an authenticated owner-scoped security-definer delete RPC with narrow ACLs."
    - "Add confirmation flows in Tracker and Dashboard Show applied; preserve irreversible applied history outside Active."

- truth: "A row-level status cell at the far right confirms Saving, Saved, or retry after updates and replaces Updated."
  status: failed
  reason: "User requested the Saved confirmation at the far right in place of the Updated column."
  severity: major
  test: 1
  root_cause: "Each mutation renders its own `SaveFeedback` under the edited control, while the final column renders `updated_at`."
  artifacts:
    - path: "web/src/pages/Tracker.tsx"
      issue: "Save state is distributed across cells and the rightmost column is Updated."
  missing:
    - "Track the latest row mutation and render its Saving/Saved/Retry state in one rightmost Status column."

- truth: "Stage filters use compact dropdowns for an individual stage and for Active, Terminal, or All groups."
  status: failed
  reason: "User requested the six stage controls and the three stage-group controls be collapsed into dropdowns."
  severity: major
  test: 1
  root_cause: "The filter region renders three preset buttons plus six independent stage buttons."
  artifacts:
    - path: "web/src/pages/Tracker.tsx"
      issue: "Nine filter buttons consume horizontal and vertical space."
  missing:
    - "Replace preset buttons with one stage-group select and individual stage buttons with one stage select."

- truth: "The jobs Dashboard contains no best-fit or runner-up resume feature while Resume Library upload remains available."
  status: failed
  reason: "User requested complete removal of the best-fit resume feature from Dashboard without removing resume uploads."
  severity: major
  test: 1
  root_cause: "Dashboard fetches the Resume Library, maps routed resume IDs, and reserves a resizable Best fit column for best-fit and runner-up labels."
  artifacts:
    - path: "web/src/pages/Dashboard.tsx"
      issue: "Resume routing is fetched and rendered in the jobs table."
    - path: "web/src/lib/dashboardColumns.ts"
      issue: "The persisted Dashboard layout includes a Best fit column."
  missing:
    - "Remove Dashboard resume queries, labels, rendering, and the Best fit column while leaving `/resumes` upload behavior unchanged."

- truth: "Primary tabs are ordered Watchlist Jobs, All Jobs, Tracker, Resumes, Preferences, Settings."
  status: failed
  reason: "User requested the exact six-tab navigation order and omitted the Watchlist tab."
  severity: major
  test: 1
  root_cause: "Shell navigation uses the older order and still exposes the standalone Watchlist link."
  artifacts:
    - path: "web/src/components/Shell.tsx"
      issue: "Navigation order is Watchlist Jobs, All Jobs, Preferences, Watchlist, Resumes, Tracker, Settings."
  missing:
    - "Use the exact requested six-tab order and leave the Watchlist route available only by direct/internal navigation."
  debug_session: "inline Phase 04 UAT diagnosis, 2026-07-28"

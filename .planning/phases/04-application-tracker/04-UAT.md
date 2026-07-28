---
status: testing
phase: 04-application-tracker
source: [04-VERIFICATION.md]
started: 2026-07-28T16:56:12Z
updated: 2026-07-28T19:33:07Z
---

## Current Test

number: 5
name: Final compact row scale
expected: |
  Refresh the signed-in Tracker. Application rows and their text fields are
  about 25% shorter with smaller text, Notes fields have no placeholder
  caption, and the star, row number, and expand arrow remain larger and easy
  to distinguish.
awaiting: owner response

## Tests

### 1. Revised Tracker layout and controls
expected: Refresh the signed-in production Tracker; it uses the available window without left-right scrolling, wraps complete values, exposes Stage group and Stage dropdowns, shows Saving/Saved/Retry in the far-right Status column, and opens a cancel-first delete confirmation.
result: pass
previous_reported: "window don't wide enought, don't want to scrow left to right; allow user to delete a job application from dashboard; After update confirm to update status; saved put on the very right replacing the Updated column. All column values should be fully visible without scrolling; For the stage folders, collaspe the 6 stages into one drop down, and collapse all stages terminal stages and active stages into one dropdown; DELETE the best fit resume feature entirely from dashboard, but still allow user to upload resume; Reorder Tabs: Watchlist Jobs -> All Jobs -> Tracker --> Resumes -> Preferences -> Settings."
fix_release: 9b1672538f3ba995ebfb49a9683a1ed7ed4049e6

### 2. Manual tracking and detail editing persist
expected: Add a manual position, edit stage/date/notes, inspect its expanded timeline and details, optionally link a resume, reload, and observe the saved values and safe rendering.
result: pass

### 3. Dashboard and Tracker stay integrated
expected: Mark a Dashboard job applied, move it to Interview in Tracker, enable Show applied, and use View in Tracker; the current stage and focused row agree, opening Apply alone creates nothing, Dashboard has no best-fit resume column, and deleting an application requires confirmation.
result: pass

### 4. Compact indexed Tracker rows
expected: Every application row is only slightly taller than its text fields, the pin star is clearly larger, and a numbered # column identifies each visible application without horizontal scrolling.
result: pass
previous_reported: "The row is a bit too wide now. just make it a bit bigger than the text box. Also make the star sign larger and add indexing"
fix_commit: 4b29033a7733f199943794b8f9456c4a0031cf5d
release_commit: 4b29033a7733f199943794b8f9456c4a0031cf5d

### 5. Final compact row scale
expected: Application rows and their text fields are about 25% shorter with smaller text, Notes fields have no placeholder caption, and the star, row number, and expand arrow remain larger and easy to distinguish.
result: pending
previous_reported: "still make the text box and each line smaller. no need to include captions in the notes chat box, enlarge the star. index and the expand button; font size also smaller; just a bit smaller 25%"

## Summary

total: 5
passed: 4
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps

- truth: "The Tracker fits the available window, wraps complete values, and does not require horizontal scrolling."
  status: resolved
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
  resolution: "Tracker now receives the full-width shell and uses a responsive fixed-layout table with wrapping and no horizontal-scroll contract."
  fix_commit: "9747a3988b055db5383fca96cb16f3ac0f62752f"
  release_commit: "9b1672538f3ba995ebfb49a9683a1ed7ed4049e6"

- truth: "A user can delete an owned application from the Tracker with explicit confirmation."
  status: resolved
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
  resolution: "Hosted migration 0056 adds the authenticated owner-scoped RPC; Tracker and Dashboard Show applied expose cancel-first confirmation flows that preserve applied history."
  fix_commit: "9747a3988b055db5383fca96cb16f3ac0f62752f"
  release_commit: "9b1672538f3ba995ebfb49a9683a1ed7ed4049e6"

- truth: "A row-level status cell at the far right confirms Saving, Saved, or retry after updates and replaces Updated."
  status: resolved
  reason: "User requested the Saved confirmation at the far right in place of the Updated column."
  severity: major
  test: 1
  root_cause: "Each mutation renders its own `SaveFeedback` under the edited control, while the final column renders `updated_at`."
  artifacts:
    - path: "web/src/pages/Tracker.tsx"
      issue: "Save state is distributed across cells and the rightmost column is Updated."
  missing:
    - "Track the latest row mutation and render its Saving/Saved/Retry state in one rightmost Status column."
  resolution: "The rightmost Status cell now reports the latest row mutation as Saving, Saved, or Retry and also contains the delete action."
  fix_commit: "9747a3988b055db5383fca96cb16f3ac0f62752f"
  release_commit: "9b1672538f3ba995ebfb49a9683a1ed7ed4049e6"

- truth: "Stage filters use compact dropdowns for an individual stage and for Active, Terminal, or All groups."
  status: resolved
  reason: "User requested the six stage controls and the three stage-group controls be collapsed into dropdowns."
  severity: major
  test: 1
  root_cause: "The filter region renders three preset buttons plus six independent stage buttons."
  artifacts:
    - path: "web/src/pages/Tracker.tsx"
      issue: "Nine filter buttons consume horizontal and vertical space."
  missing:
    - "Replace preset buttons with one stage-group select and individual stage buttons with one stage select."
  resolution: "The nine buttons are replaced by Stage group and Stage dropdowns."
  fix_commit: "9747a3988b055db5383fca96cb16f3ac0f62752f"
  release_commit: "9b1672538f3ba995ebfb49a9683a1ed7ed4049e6"

- truth: "The jobs Dashboard contains no best-fit or runner-up resume feature while Resume Library upload remains available."
  status: resolved
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
  resolution: "Dashboard no longer queries or renders best-fit/runner-up resumes or reserves that column; Resume Library upload remains unchanged."
  fix_commit: "9747a3988b055db5383fca96cb16f3ac0f62752f"
  release_commit: "9b1672538f3ba995ebfb49a9683a1ed7ed4049e6"

- truth: "Primary tabs are ordered Watchlist Jobs, All Jobs, Tracker, Resumes, Preferences, Settings."
  status: resolved
  reason: "User requested the exact six-tab navigation order and omitted the Watchlist tab."
  severity: major
  test: 1
  root_cause: "Shell navigation uses the older order and still exposes the standalone Watchlist link."
  artifacts:
    - path: "web/src/components/Shell.tsx"
      issue: "Navigation order is Watchlist Jobs, All Jobs, Preferences, Watchlist, Resumes, Tracker, Settings."
  missing:
    - "Use the exact requested six-tab order and leave the Watchlist route available only by direct/internal navigation."
  resolution: "Primary navigation is exactly Watchlist Jobs, All Jobs, Tracker, Resumes, Preferences, Settings; the standalone Watchlist route remains non-primary."
  fix_commit: "9747a3988b055db5383fca96cb16f3ac0f62752f"
  release_commit: "9b1672538f3ba995ebfb49a9683a1ed7ed4049e6"
  debug_session: "inline Phase 04 UAT diagnosis, 2026-07-28"

- truth: "Tracker rows and fields are roughly 25% more compact, Notes has no placeholder caption, and the star, index, and expand arrow remain prominent."
  status: resolved_pending_uat
  reason: "User requested one more approximately 25% density reduction, smaller row text, removal of Notes captions, and larger star/index/expand affordances."
  severity: minor
  test: 5
  root_cause: "The prior compact pass retained 44px controls, text-sm cell typography, standard vertical padding, and visible Notes placeholder copy; the expand and index glyphs were still smaller than the requested emphasis."
  artifacts:
    - path: "web/src/pages/Tracker.tsx"
      issue: "Main-row controls, padding, typography, Notes placeholders, and glyph emphasis needed a second bounded density adjustment."
    - path: "web/src/pages/Tracker.test.tsx"
      issue: "The final scale and placeholder-free Notes contract needed explicit regression assertions."
  missing:
    - "Use 36px controls and half-sized vertical cell padding for an overall row reduction near 25%."
    - "Use text-xs row/input typography and remove Notes placeholder captions."
    - "Use text-3xl star, text-lg bold index, and text-2xl expand arrow."
  resolution: "Main rows now use 36px controls, py-1 cells, text-xs typography, caption-free Notes fields, and deliberately larger star/index/expand glyphs."
  debug_session: "inline Phase 04 UAT diagnosis, 2026-07-28"

- truth: "Tracker rows remain compact, show a larger pin star, and include visible row numbering."
  status: resolved
  reason: "User reported the row is too tall, requested it sit only slightly beyond the text box, and requested a larger star plus indexing."
  severity: minor
  test: 4
  root_cause: "The far-right Status cell stacked save feedback above a 44px Delete action, while the main Notes editor used two rows; both forced the row well above the 44px control height. The table also had no row-number column and the pin glyph used text-lg."
  artifacts:
    - path: "web/src/pages/Tracker.tsx"
      issue: "Status actions stack vertically, Notes uses two rows, the star is text-lg, and the table has no index column."
    - path: "web/src/pages/Tracker.test.tsx"
      issue: "The compact row, larger star, and numbering contract lacked regression coverage."
  missing:
    - "Place save feedback and Delete side by side and use a one-row Notes editor so the row remains near the 44px control height."
    - "Render a dedicated # column and numbered visible rows."
    - "Increase the star glyph to text-2xl and cover the revised density contract."
  resolution: "The Status cell is horizontal, the main Notes editor is one row, the pin uses text-2xl, and a dedicated # column numbers visible applications."
  fix_commit: "4b29033a7733f199943794b8f9456c4a0031cf5d"
  release_commit: "4b29033a7733f199943794b8f9456c4a0031cf5d"
  debug_session: "inline Phase 04 UAT diagnosis, 2026-07-28"

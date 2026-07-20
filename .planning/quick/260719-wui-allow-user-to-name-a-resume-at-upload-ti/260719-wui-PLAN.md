---
phase: quick-260719-wui
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - supabase/migrations/0026_resume_display_name.sql
  - web/src/lib/resumes.ts
  - web/src/lib/resumes.test.ts
  - web/src/pages/Resumes.tsx
  - web/src/pages/Dashboard.tsx
  - web/src/pages/JobDetail.tsx
autonomous: true
requirements: [QUICK-WUI-01]

must_haves:
  truths:
    - "A user can type a display name in the resume upload form before submitting, prefilled from the chosen file's name without its extension."
    - "Resume lists show the user-chosen display name when one exists, and the raw filename when it does not."
    - "Uploading with a blank or whitespace-only name stores NULL, so the UI falls back to the filename."
    - "Downloading a resume still writes the original filename to disk; file-type validation still reads the filename."
    - "Existing resume rows (display_name NULL) render exactly as they did before this change."
  artifacts:
    - supabase/migrations/0026_resume_display_name.sql
    - web/src/lib/resumes.ts
    - web/src/lib/resumes.test.ts
    - web/src/pages/Resumes.tsx
  key_links:
    - "resumes.display_name column -> RESUME_COLUMNS select list -> ResumeRecord.display_name -> resumeLabel() render sites"
    - "uploadResume second argument -> trimmed-or-NULL insert payload"
    - "uploadResume still calls the mark_recent_jobs_for_refilter RPC after a successful insert (unchanged)"
---

<objective>
Add an optional user-chosen display name for resumes, captured at upload time and shown wherever a resume is named in the UI, while keeping `filename` as the authoritative file identity.

Purpose: Users upload files with unhelpful names (`Resume_v3_FINAL.docx`); a human-readable label makes the resume list, routed-resume badges, and gap panel legible.
Output: One additive migration, a `display_name` field threaded through the resumes data layer with a shared label helper, an upload-form name input, and unit tests for the fallback and trimming rules.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md

@web/src/lib/resumes.ts
@web/src/lib/resumes.test.ts
@web/src/pages/Resumes.tsx
@supabase/migrations/0002_resumes.sql
</context>

<constraints>
CONCURRENCY — another agent is executing Phase 03 against this repo right now. Do NOT read-modify, stage, or commit any of:
- `supabase/migrations/0025_scoring_freshness.sql` (migration number 0025 is claimed — this plan uses 0026)
- `supabase/functions/_shared/filters.ts`, `supabase/functions/_shared/scoring-input.ts`, `supabase/functions/score-tick/**`
- `web/src/lib/feed.ts`, `web/src/lib/feed.test.ts`
- `web/src/pages/Preferences.tsx`, `web/src/pages/Preferences.test.tsx`
- `.planning/ROADMAP.md`, `.planning/STATE.md`, `.planning/phases/03-*`

Stage commits with explicit paths (`git add <path> ...`), never `git add -A` or `git commit -a`.

BEHAVIOR — a display name is cosmetic. It must not alter extraction, routing, scoring, or storage-path construction. The `mark_recent_jobs_for_refilter` RPC call in `uploadResume` stays exactly as it is: same call site, same position after the insert, same error handling.
</constraints>

<tasks>

<task type="auto">
  <name>Task 1: Add nullable display_name column to public.resumes</name>
  <files>supabase/migrations/0026_resume_display_name.sql</files>
  <action>
Create the migration as a new file. It contains a single additive statement adding a nullable text column named `display_name` to `public.resumes`.

Do not touch the four existing `resumes_*` RLS policies — they are table-scoped and already cover every column, including new ones. Do not add a NOT NULL constraint, a default, a backfill, or an index: existing rows must keep a NULL value so the UI falls back to `filename` for them.

Do not create or edit migration 0025 under any circumstance; that number belongs to a concurrent agent.
  </action>
  <verify>
    <automated>test -f supabase/migrations/0026_resume_display_name.sql &amp;&amp; grep -iq 'add column' supabase/migrations/0026_resume_display_name.sql &amp;&amp; grep -iq 'display_name text' supabase/migrations/0026_resume_display_name.sql &amp;&amp; test ! -e supabase/migrations/0025_scoring_freshness.sql -o -z "$(git diff --name-only -- supabase/migrations/0025_scoring_freshness.sql)"</automated>
    <automated>grep -v '^--' supabase/migrations/0026_resume_display_name.sql | grep -ci 'create policy\|alter policy\|drop policy\|not null' | grep -qx 0</automated>
  </verify>
  <done>`supabase/migrations/0026_resume_display_name.sql` exists, adds one nullable text column, declares no constraints, and changes no policies. Migration 0025 is untouched.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Thread display_name through the resumes data layer</name>
  <files>web/src/lib/resumes.ts, web/src/lib/resumes.test.ts</files>
  <behavior>
    - `resumeLabel({ display_name: 'Backend CV', filename: 'r.pdf' })` returns `'Backend CV'`.
    - `resumeLabel({ display_name: null, filename: 'r.pdf' })` returns `'r.pdf'`.
    - `defaultDisplayName('Jack Resume.pdf')` returns `'Jack Resume'`; `defaultDisplayName('my.resume.v2.docx')` returns `'my.resume.v2'`; a name with no dot is returned unchanged.
    - `uploadResume(file)` with no second argument inserts a null value for the new column.
    - `uploadResume(file, '  Backend CV  ')` inserts the trimmed string.
    - `uploadResume(file, '   ')` inserts null (whitespace-only collapses to null).
    - `uploadResume(file, 'Anything')` still rejects a `.txt` file before any network call — validation reads the file's own name.
  </behavior>
  <action>
In `web/src/lib/resumes.ts`:

1. Append the new column to the `RESUME_COLUMNS` select string and add a matching `display_name: string | null` member to the `ResumeRecord` interface.
2. Export `resumeLabel(resume: Pick&lt;ResumeRecord, 'display_name' | 'filename'&gt;): string` returning the display name when present and the filename otherwise. This is the single render helper the UI will import — do not inline the fallback expression at call sites in Task 3.
3. Export `defaultDisplayName(filename: string): string` that strips only the final dot-suffix. Split on the last dot; if there is no dot, or the last dot is at index 0, return the input unchanged so dotfile-style names survive.
4. Change the `uploadResume` signature to accept an optional second parameter for the user-supplied name. Normalize it by trimming; if the result is an empty string, or the argument was not supplied, use `null`. Add the normalized value to the insert payload object under the new column key.
5. `allowedExtension` keeps receiving the file's own `name` property, and the storage path keeps being built from that extension. The user-supplied name never influences extension checks, content type, or the storage path.

In `web/src/lib/resumes.test.ts`:

6. Follow the existing mock shape at the top of the file — the module mock for `./supabase`, the `beforeEach(vi.clearAllMocks)`, and the `insert`/`select`/`single` chain built with `vi.mocked(supabase.from).mockReturnValue(...)`. Extend the existing "user-scoped UUID path" test's expected row and its `expect(insert).toHaveBeenCalledWith(...)` assertion to include the new column, since `RESUME_COLUMNS` now returns it.
7. Add tests covering every bullet in `&lt;behavior&gt;`. For the trimming and blank cases, assert on the object passed to the `insert` mock. For the label and default-name helpers, assert return values directly — no mocking needed.
  </action>
  <verify>
    <automated>cd web &amp;&amp; npx vitest run src/lib/resumes.test.ts</automated>
    <automated>cd web &amp;&amp; npx tsc --noEmit</automated>
    <automated>grep -q "allowedExtension(file.name)" web/src/lib/resumes.ts &amp;&amp; grep -q "mark_recent_jobs_for_refilter" web/src/lib/resumes.ts</automated>
  </verify>
  <done>Vitest passes for the resumes suite with new cases for label fallback, default-name derivation, trimming, and blank-to-null. `tsc --noEmit` is clean. Extension validation still reads `file.name` and the refilter RPC call is intact.</done>
</task>

<task type="auto">
  <name>Task 3: Capture the name at upload and render it across the UI</name>
  <files>web/src/pages/Resumes.tsx, web/src/pages/Dashboard.tsx, web/src/pages/JobDetail.tsx</files>
  <action>
In `web/src/pages/Resumes.tsx`:

1. Import `resumeLabel` and `defaultDisplayName` from `../lib/resumes`.
2. Add a controlled `useState` string for the display name and a text input to the upload form, labelled "Display name" with helper text marking it optional. Match the existing form's Tailwind classes and `grid gap-1.5 text-sm font-medium` label pattern. The input is NOT `required`.
3. Add an `onChange` handler to the existing file input that reads the newly selected file and sets the display-name state to `defaultDisplayName(file.name)`. The user can then edit it before submitting. If the selection is cleared, reset the state to an empty string.
4. The mutation currently passes the `File` straight through as `mutationFn`. Change `mutationFn` to accept an object holding the file and the name, and call the two-argument `uploadResume` inside it. Update `handleUpload` to pass that object. In `onSuccess`, clear the display-name state alongside the existing file-input reset.
5. Render `resumeLabel(resume)` in the table's first cell instead of the raw filename, and rename that column header from "Filename" to "Name". Use `resumeLabel(resumeToDelete)` in the `ConfirmDialog` message so the confirmation names what the user recognizes.
6. `handleDownload` is unchanged: the anchor's `download` attribute keeps using the record's `filename` so the saved file keeps its real extension.

In `web/src/pages/Dashboard.tsx`:

7. The `resumeNames` memo builds an id-to-name map from the resumes query. Populate that map with `resumeLabel(resume)` instead of the raw filename. Import the helper.

In `web/src/pages/JobDetail.tsx`:

8. The `resumeName` lookup finds the routed resume and reads its filename, defaulting to `'routed'`. Apply `resumeLabel` to the found record before the default, preserving the existing `'routed'` fallback when no record matches.
  </action>
  <verify>
    <automated>cd web &amp;&amp; npx tsc --noEmit &amp;&amp; npx vitest run</automated>
    <automated>cd web &amp;&amp; npm run build</automated>
    <automated>grep -q "anchor.download = resume.filename" web/src/pages/Resumes.tsx</automated>
    <automated>grep -c "resumeLabel" web/src/pages/Resumes.tsx web/src/pages/Dashboard.tsx web/src/pages/JobDetail.tsx</automated>
  </verify>
  <done>The upload form has an optional, prefilled, editable name field; all three pages render resume names through `resumeLabel`; the download anchor still uses `filename`; typecheck, full test suite, and production build all pass.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser form -> resumes table | User-controlled free text (`display_name`) crosses into persisted per-user data |
| resumes table -> browser DOM | Stored free text is rendered back into the resume list, dashboard badges, and gap panel |
| resumes table -> filesystem (download) | Record fields influence the name a file is written to disk under |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-WUI-01 | Tampering | download anchor in `Resumes.tsx` | high | mitigate | The `download` attribute keeps reading `filename`; the user-supplied name never reaches it, so a crafted name cannot force a misleading extension or a traversal-style path segment. Task 3 verify greps for the unchanged assignment. |
| T-WUI-02 | Tampering | `allowedExtension` / storage path in `resumes.ts` | high | mitigate | Extension validation and storage-path construction stay bound to `file.name`. A user-supplied name ending in `.docx` cannot smuggle a disallowed file past the check. Task 2 verify greps for the unchanged call. |
| T-WUI-03 | Information disclosure | `resumes` RLS | medium | accept | The new column lives on a table already covered by the four owner-scoped `resumes_*` policies; no policy change widens access. Additive column inherits existing row-level isolation. |
| T-WUI-04 | Elevation of privilege | React text rendering | low | accept | React escapes text children by default; the name is rendered as a text node, never via `dangerouslySetInnerHTML` or an href/src attribute. No sanitizer needed. |
| T-WUI-05 | Denial of service | unbounded free text | low | accept | Two trusted invited users, 500 MB DB budget. An oversized name is a self-inflicted cosmetic problem, not a shared-resource risk. Truncation on render is handled by the existing `max-w-sm truncate` cell. |
</threat_model>

<verification>
1. `cd web && npx tsc --noEmit` — clean.
2. `cd web && npx vitest run` — full suite green, including new resumes cases.
3. `cd web && npm run build` — production build succeeds.
4. `git status --porcelain` lists only the six files in `files_modified` plus this plan's artifacts. No Phase 03 file appears.
5. `supabase db reset` (or `supabase migration up`) applies 0026 without error against a local stack, if a local Supabase stack is running. Skip if Docker is not available — the migration is a single additive column.
</verification>

<success_criteria>
- Migration 0026 exists, is additive-only, and leaves RLS untouched.
- `uploadResume` takes an optional name, trims it, and stores NULL for blank input, while still calling the refilter RPC unchanged.
- `resumeLabel` is the single fallback helper and is used at every render site across the three pages.
- The upload form prefills the name from the selected file's stem and lets the user edit it before submit.
- Downloads and extension validation still use `filename`.
- Typecheck, tests, and build all pass; no off-limits file is modified.
</success_criteria>

<output>
Create `.planning/quick/260719-wui-allow-user-to-name-a-resume-at-upload-ti/260719-wui-SUMMARY.md` when done.
</output>

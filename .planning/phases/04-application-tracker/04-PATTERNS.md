# Phase 4: Application Tracker - Pattern Map

**Mapped:** 2026-07-27
**Files analyzed:** 14 required, 2 conditional
**Analogs found:** 15 / 16
**Migration head observed:** `0052_decouple_resume_routing.sql`

> The research-time filename `0051_application_tracker.sql` is stale. Migrations
> `0051` and `0052` already exist, so implementation must use
> `0053_application_tracker.sql` after re-checking the head immediately before
> execution.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `supabase/migrations/0053_application_tracker.sql` | migration/model/API | CRUD, event-driven, batch backfill, request-response | `0002_resumes.sql`, `0037_us_workday_dashboard_queue.sql`, `0052_decouple_resume_routing.sql` | composite exact |
| `web/src/lib/tracker.ts` | service/utility | CRUD, request-response, transform | `web/src/lib/feed.ts` | role + flow exact |
| `web/src/lib/tracker.test.ts` | test | request-response, transform | `web/src/lib/resumes.test.ts`, `web/src/lib/feed.test.ts` | role exact |
| `web/src/lib/trackerColumns.ts` | config/utility | browser storage, transform | `web/src/lib/dashboardColumns.ts` | exact, conditional |
| `web/src/components/ApplicationTimeline.tsx` | component | event-driven, request-response | `web/src/components/ConfirmDialog.tsx`, `web/src/pages/JobDetail.tsx` | partial; no timeline analog |
| `web/src/components/ApplicationTimeline.test.tsx` | test | render/interaction | `web/src/components/ConfirmDialog.test.ts` | role match |
| `web/src/pages/Tracker.tsx` | page/component | CRUD, request-response, event-driven | `web/src/pages/Dashboard.tsx`, `web/src/pages/Resumes.tsx` | role + table-flow exact |
| `web/src/pages/Tracker.test.tsx` | test | render/interaction | `web/src/pages/Dashboard.test.tsx` | exact |
| `web/src/lib/feed.ts` | service | request-response mutation | same file, especially `dismissJob` | exact modification site |
| `web/src/lib/feed.test.ts` | test | request-response | same file; `web/src/lib/resumes.test.ts` for mocks | exact modification site |
| `web/src/pages/Dashboard.tsx` | page/component | request-response, event-driven | same file | exact modification site |
| `web/src/pages/Dashboard.test.tsx` | test | render/interaction | same file | exact modification site |
| `web/tests/migration-0053-application-tracker.test.ts` | test | static migration contract | `web/tests/migration-0037-us-workday-dashboard-queue.test.ts` | exact |
| `scripts/verify-tracker-rls.ts` | verifier/utility | CRUD, request-response | `scripts/verify-rls.ts` | exact |
| `web/src/lib/dashboard.ts` | utility | transform | same file | conditional modification |
| `web/src/lib/dashboard.test.ts` | test | transform | same file | conditional modification |

`trackerColumns.ts` is conditional because the UI contract says column resizing
must not delay the core tracker. `dashboard.ts` and its test are conditional:
change them only if existing applied-lifecycle helpers remain in the Dashboard
path after the tracker-backed applied view is split out. The `/tracker` route
already exists in `web/src/main.tsx:69`; no route file change is needed.

## Pattern Assignments

### `supabase/migrations/0053_application_tracker.sql`

**Role/data flow:** migration + model + narrow API; CRUD, event-triggered
projection, one-time backfill, request-response RPCs.

**Analogs:**

- `supabase/migrations/0002_resumes.sql` for UUID/user ownership, owner index,
  RLS, and own-row policy syntax.
- `supabase/migrations/0052_decouple_resume_routing.sql` for current
  authenticated function hardening.
- `supabase/migrations/0037_us_workday_dashboard_queue.sql` for explicit grants,
  stable server-side ordering, JSON projections, migration assertions, and
  transaction framing.
- `supabase/migrations/0051_resume_delete_fk_indexes.sql` for indexing nullable
  resume foreign keys that participate in `ON DELETE SET NULL`.

**Owner/RLS pattern** (`0002_resumes.sql:1-18`):

```sql
create table public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ...
);

alter table public.resumes enable row level security;
create index resumes_user_id_idx on public.resumes using btree (user_id);

create policy "resumes_select_own" on public.resumes
  for select to authenticated
  using ((select auth.uid()) = user_id);
```

Copy this for both `applications` and `application_stage_events`, but do not
copy the broad `select, insert, update, delete` grant from line 14. Phase 4
requires `SELECT` plus narrow RPCs/column grants so clients cannot write origin,
snapshots, current-stage projection, owner, or server timestamps.

**Explicit table grant/policy reset pattern**
(`0037_us_workday_dashboard_queue.sql:228-243`):

```sql
alter table public.user_jobs enable row level security;
revoke all on table public.user_jobs from anon, authenticated;
grant select on table public.user_jobs to authenticated;

drop policy if exists "user_jobs_select_own" on public.user_jobs;
create policy "user_jobs_select_own" on public.user_jobs
  for select to authenticated
  using ((select auth.uid()) = user_id);
```

**Authenticated RPC hardening** (`0052_decouple_resume_routing.sql:16-38`):

```sql
create or replace function public.request_deterministic_route_refresh()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
begin
  if owner_id is null then raise exception 'authentication_required'; end if;
  ...
end;
$$;
revoke execute on function public.request_deterministic_route_refresh()
  from public, anon;
grant execute on function public.request_deterministic_route_refresh()
  to authenticated;
```

Use fully-qualified relations and owner predicates in every function. Prefer
`SECURITY INVOKER`; when `mark_job_applied` or a create function needs
`SECURITY DEFINER`, copy the complete `auth.uid()` check, empty search path,
revoke, and exact grant pattern. Trigger functions should be revoked from
`public`, `anon`, and `authenticated`.

**Stable filter/order/projection pattern**
(`0037_us_workday_dashboard_queue.sql:613-632, 737-770`):

```sql
from public.user_jobs as user_job
join public.jobs as job on job.id = user_job.job_id
...
where user_job.user_id = (select auth.uid())
  ...

row_number() over (
  order by
    ...
    candidate.user_job.id desc
) as page_position
```

For Tracker, filter before limiting and order applications by
`pinned DESC, updated_at DESC, id DESC`. Events use
`occurred_on ASC, created_at ASC, id ASC`. The latest-stage projection uses the
same keys reversed.

**Required tracker-specific additions (no existing exact analog):**

- Six checked text stages only: `ready_to_apply`, `applied`,
  `outreach_sent`, `interview`, `offer`, `rejected`.
- One `applications` aggregate for both `system` and `manual` origins, with
  immutable system snapshots and a partial unique `(user_id, source_job_id)`
  index.
- One `application_stage_events` ledger with composite
  `(application_id, user_id)` ownership FK and repeated stages allowed.
- A projection function/trigger handling `OLD.application_id` on delete and
  `NEW.application_id` otherwise; reject deletion of the final event.
- A composite `(resume_id, user_id)` FK to a unique `(resumes.id,
  resumes.user_id)` key, using `ON DELETE SET NULL (resume_id)`, plus a
  referencing index as motivated by `0051_resume_delete_fk_indexes.sql:1-20`.
- `mark_job_applied(p_user_job_id)` must lock an owned `user_jobs` row, snapshot
  job/company/JD fields, upsert the system application, append Applied only when
  needed, preserve `applied_at` with `coalesce`, and clear `dismissed_at` in one
  transaction.
- Backfill every legacy row with non-null `user_jobs.applied_at` before switching
  Dashboard reads.
- Revoke authenticated direct update of `user_jobs.applied_at`.
- A tracker-backed Dashboard applied projection that does not require a live or
  open `jobs` row.

### `web/src/lib/tracker.ts`

**Analog:** `web/src/lib/feed.ts`.

Follow the file organization described at `feed.ts:3-12`: exported select
constants, snake_case database record types, pure presentation/validation
helpers, then thin query and mutation functions that throw on Supabase errors.

**List/detail separation** (`feed.ts:17-35`):

```typescript
export const FEED_LIST_COLUMNS =
  'id, ... ' +
  'jobs!inner ( id, title, location, absolute_url, ... )'

export const FEED_DETAIL_COLUMNS =
  'id, ... ' +
  'jobs ( id, title, location, absolute_url, ... ' +
  'description_html, description_text, companies ( name ) )'
```

Create `TRACKER_LIST_COLUMNS` without JD bodies/events and a detail query keyed
by application ID that loads snapshots, linked resume label, and ordered events.
Do not live-join system display fields back to `jobs`.

**Safe URL validation** (`feed.ts:185-196`):

```typescript
export function safeApplyUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null
    return parsed.href
  } catch {
    return null
  }
}
```

Reuse this exact HTTPS/credential rule for manual job URL validation and
rendering.

**Thin RPC + response guard** (`feed.ts:773-780`):

```typescript
export async function dismissJob(userJobId: string): Promise<void> {
  const { data, error } = await supabase.rpc('dismiss_job_permanently', {
    p_user_job_id: userJobId,
  })
  if (error) throw error
  if (data !== true) throw new Error('user_job_not_found')
}
```

Every tracker mutation must be field-discriminated rather than accepting a
generic object patch. Provide explicit operations for manual create, editable
application field, stage append, latest-event date, event edit/delete, pin, and
resume link. Validate RPC result shapes as `feed.ts:501-577` does before
returning them to React.

Pure helpers belong here and should be unit tested: stage literals/presentation,
active-stage defaults, stable application sorting, repeated-stage ordinal
labels, notes preview, manual duplicate normalization, HTTPS validation, and
date parsing.

### `web/src/lib/tracker.test.ts`

**Analogs:** `web/src/lib/resumes.test.ts:1-13` and
`web/src/lib/feed.test.ts`.

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { supabase } from './supabase'

vi.mock('./supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}))
```

Copy the chain-mock style from `resumes.test.ts:32-70` and assert exact RPC
names/payloads plus throw-on-error behavior. Add pure table tests for:

- exact six stages and active defaults;
- pin/updated/id sorting;
- chronological event ordering and repeated-stage ordinals;
- manual required fields and HTTPS-only URL;
- nonblocking normalized duplicate warning;
- list/detail response rejection for malformed or cross-shaped data;
- field allowlist (system company/title rejected; manual allowed).

### `web/src/lib/trackerColumns.ts` (conditional)

**Analog:** `web/src/lib/dashboardColumns.ts`.

Copy the declarative column and safe-storage pattern
(`dashboardColumns.ts:1-39, 42-113`):

```typescript
export const DASHBOARD_COLUMN_STORAGE_KEY = 'job-copilot.dashboard.column-widths.v2'
export const DASHBOARD_COLUMNS = [
  { id: 'job', label: 'Job', defaultWidth: 280, minWidth: 220, maxWidth: 520 },
  ...
] as const

export function clampDashboardColumnWidth(columnId, width) {
  const column = COLUMN_BY_ID.get(columnId)
  if (!column || !Number.isFinite(width)) return column?.defaultWidth ?? 0
  return Math.min(column.maxWidth, Math.max(column.minWidth, width))
}
```

Use a tracker-specific versioned storage key and the UI contract’s fixed
starting widths. Preserve guarded JSON parsing and silent localStorage failure.
If resizing is deferred, keep widths directly in Tracker and do not create this
file.

### `web/src/components/ApplicationTimeline.tsx`

**Closest analogs:** `ConfirmDialog.tsx` for accessible event deletion and
`JobDetail.tsx` for trusted rendering boundaries. There is no existing event
timeline analog, so geometry and behavior must come directly from
`04-UI-SPEC.md`.

**Dialog usage pattern** (`ConfirmDialog.tsx:87-125`):

```tsx
<section
  role="dialog"
  aria-modal="true"
  aria-labelledby={titleId}
  aria-describedby={`${messageId}${errorMessage ? ` ${errorId}` : ''}`}
>
  ...
</section>
```

Use the existing component rather than making a second modal. Pass
`initialFocus="cancel"`, `cancelLabel="Keep event"`, and
`confirmLabel="Delete event"`. `ConfirmDialog.tsx:35-74` already restores focus,
handles Escape, and traps Tab focus.

**Sanitized system/plain manual JD pattern**
(`JobDetail.tsx:171-173, 219-235`):

```tsx
const sanitizedDescription = job?.description_html
  ? DOMPurify.sanitize(job.description_html, { FORBID_TAGS: ['style', 'form'] })
  : null

{sanitizedDescription !== null ? (
  <div dangerouslySetInnerHTML={{ __html: sanitizedDescription }} />
) : job?.description_text ? (
  <pre className="font-sans whitespace-pre-wrap">{job.description_text}</pre>
) : (
  <p>No description snapshot is available for this posting.</p>
)}
```

System HTML must pass through DOMPurify. Manual descriptions and notes remain
plain text with preserved line breaks.

**Timeline-specific contract (no source analog):**

- ordered list, sorted `occurred_on`, `created_at`, `id`;
- horizontal scroll region with 32px padding and at least 144px node spacing;
- dates above a 4px connector, 20px circular nodes with 44px button hit areas,
  labels below;
- derive repeated ordinals after sorting; never persist `Interview 2`;
- node button opens an inline editor; edit may reorder the list;
- final event has no destructive action and shows the exact guard copy;
- no animation and no motion under reduced-motion preferences.

### `web/src/components/ApplicationTimeline.test.tsx`

**Analog:** `web/src/components/ConfirmDialog.test.ts:1-49`.

Use `renderToStaticMarkup`, direct component props, and `?raw` source assertions
for contracts that static rendering cannot exercise:

```typescript
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import timelineSource from './ApplicationTimeline.tsx?raw'
```

Assert ordered-list semantics, `<time dateTime>`, accessible node labels,
repeated ordinals, 44px controls, the final-event guard, ConfirmDialog copy,
`initialFocus="cancel"`, and isolated retry behavior.

### `web/src/pages/Tracker.tsx`

**Primary analog:** `web/src/pages/Dashboard.tsx`; use `Resumes.tsx` for the
smaller query/mutation/error pattern.

**Imports/query convention** (`Resumes.tsx:1-12, 27-50`):

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
...
const resumesQuery = useQuery({ queryKey: ['resumes'], queryFn: listResumes })
const deleteMutation = useMutation({
  mutationFn: deleteResume,
  onSuccess: async () => {
    await queryClient.invalidateQueries({ queryKey: ['resumes'] })
  },
})
```

Use scoped keys: `['tracker-applications', selectedStages]`,
`['tracker-application', applicationId]`, and the existing `['resumes']`.
Detail queries are enabled only for expanded rows.

**Accessible table surface** (`Dashboard.tsx:885-905`):

```tsx
<div
  role="region"
  aria-label="Job matches; scroll horizontally to view all columns"
  tabIndex={0}
  className="overflow-x-auto rounded-lg border ... focus-visible:outline-2 ..."
>
  {feedLoading ? <p>Loading…</p> : feedError ? (
    <div>
      <p role="alert">Couldn’t load ...</p>
      <button type="button" onClick={() => void feedQuery.refetch()}>Retry</button>
    </div>
  ) : ...}
</div>
```

Change the label/copy to the exact tracker contract. Preserve the container
during loading/error/empty states. Copy native table semantics and sticky header
from `Dashboard.tsx:950-1039`, and row hover/focus treatment from
`Dashboard.tsx:1052-1055`.

**Optimistic rollback/focus pattern** (`Dashboard.tsx:408-430, 461-478`):

```tsx
await queryClient.cancelQueries({ queryKey: feedKey })
const previous = queryClient.getQueryData(feedKey)
queryClient.setQueryData(feedKey, ...)
...
onError: (_error, _id, context) => {
  if (context?.previous) queryClient.setQueryData(feedKey, context.previous)
}
```

Use this for immediate pin/stage updates, but key pending/error state by
`applicationId:field`. Use a stable TanStack mutation `scope.id` for each cell,
`retry: false`, retain `mutation.variables` on failure, and retry the same
payload. Never use one page-wide saving boolean.

**Tracker page composition:**

- page header + exact description + primary `Add position`;
- stage filter group with active/terminal/all quick actions and six
  `aria-pressed` toggles;
- one semantic table, 1,224px minimum width, Expand/Pin leading columns;
- draft row immediately below the header; persist nothing until company, title,
  and HTTPS URL validate;
- paired parent/detail `<tr>` rows with full-width `colSpan`;
- company/title edit affordances only for manual origin;
- cell-local Saving/Saved/Retry live regions;
- pinned-first/stable ordering;
- on narrow screens, the exact one-time swipe hint without converting rows to
  cards.

### `web/src/pages/Tracker.test.tsx`

**Analog:** `web/src/pages/Dashboard.test.tsx:1-8, 70-145`.

Use `renderToStaticMarkup(<Tracker />)`, mock React Query and tracker/resume
services, and import `Tracker.tsx?raw` where source-level invariants are more
reliable than static markup. Existing Dashboard tests demonstrate this mix at
`Dashboard.test.tsx:146-194` and table accessibility assertions at
`Dashboard.test.tsx:366-397`.

Cover all three state layers:

1. Pure rendered states: exact copy, filters, six badges, table semantics,
   empty/loading/error, manual draft validation, responsive hint.
2. Source contracts: cell-scoped mutation IDs, no generic row update, no
   page-wide saving flag, lazy detail query, scoped invalidations.
3. Interaction/state helpers: failed drafts retained, Escape rollback, one
   draft at a time, pin/stage immediate saves, notes/date blur or keyboard
   commit, system fields read-only.

### `web/src/lib/feed.ts`

**Modification analog:** replace the current direct update at
`feed.ts:782-801` with the RPC style already used at `feed.ts:773-780`.

Current code to replace:

```typescript
export async function markJobApplied(userJobId: string): Promise<void> {
  const { error } = await supabase
    .from('user_jobs')
    .update({ applied_at: new Date().toISOString(), dismissed_at: null })
    .eq('id', userJobId)
  if (error) throw error
}
```

Target shape:

```typescript
export async function markJobApplied(userJobId: string): Promise<string> {
  const { data, error } = await supabase.rpc('mark_job_applied', {
    p_user_job_id: userJobId,
  })
  if (error) throw error
  if (typeof data !== 'string') throw new Error('invalid_application_id')
  return data
}
```

Delete `undoJobApplied`. Applied Dashboard data should come from tracker
snapshots, preferably through `tracker.ts`; do not force tracker types into the
legacy ranked-feed row shape.

### `web/src/lib/feed.test.ts`

Update the existing lifecycle mutation tests to assert exactly one
`mark_job_applied` RPC, its user-job argument, returned application ID
validation, and error propagation. Delete tests for clearing `applied_at`.
Use the Supabase mock setup style from `resumes.test.ts:1-13`.

### `web/src/pages/Dashboard.tsx`

**Modification analog:** retain the file’s existing query, mutation,
optimistic-removal, focus, region, and table patterns.

The mark mutation at `Dashboard.tsx:480-500` already has the correct rollback
shape. Change success behavior to:

- announce ``${context.title} marked applied and added to Tracker.``;
- invalidate active Dashboard, tracker list/detail, and tracker-backed applied
  query keys;
- do not set an Undo target.

Remove `undoJobApplied` imports/state/mutation, the applied-row action at
`Dashboard.tsx:1157-1171`, and the toast at `Dashboard.tsx:1229-1245`.

Show applied requires a distinct tracker-backed compact projection with these
columns only: Position, Company, Location, Applied date, Current stage, Apply
link, Tracker link. Reuse the accessible external-link pattern at
`Dashboard.tsx:1115-1125` and link to `/tracker` with the application row
focused/expanded. Do not populate historical rows from the ranked feed or
require `jobs.status = 'open'`.

### `web/src/pages/Dashboard.test.tsx`

**Analog:** same file’s current render + raw-source testing pattern.

Replace assertions that require `undoJobApplied`, `Undo applied`, timeout/toast,
score/tier/resume columns in the applied view, or `applied_at` as its current
state. Add assertions for:

- tracker-backed Show applied query;
- exact compact historical columns and current-stage badge;
- `View in Tracker` link;
- atomic Mark Applied RPC integration and exact success announcement;
- no Undo control/import/mutation;
- active-row optimistic rollback and focus recovery remain intact.

### `web/tests/migration-0053-application-tracker.test.ts`

**Analog:** `web/tests/migration-0037-us-workday-dashboard-queue.test.ts`.

Copy raw migration import and static contract style
(`migration-0037...test.ts:1-5, 93-101`):

```typescript
import { describe, expect, it } from 'vitest'
import migration0053 from '../../supabase/migrations/0053_application_tracker.sql?raw'

expect(migration0053).toMatch(/^\s*begin\s*;/i)
expect(migration0053).toMatch(/\bcommit\s*;\s*$/i)
expect(migration0053).not.toMatch(/\b(?:drop|truncate)\s+table\b/i)
```

Use extracted function bodies as at `migration-0037...test.ts:177-196` to assert:
six exact stage checks; no Saved/Resume Prepared; both tables and owner indexes;
composite owner FKs; resume column-list SET NULL; final-event guard; projection
trigger on insert/update/delete; stable order; narrow grants/function ACLs;
`auth.uid()` checks; direct `applied_at` update removed; legacy backfill;
idempotent Mark Applied; system snapshots; tracker-backed applied projection
without live/open-job dependency.

### `scripts/verify-tracker-rls.ts`

**Analog:** `scripts/verify-rls.ts`.

Copy required environment/client setup (`verify-rls.ts:4-45`), independent
publishable-key sessions (`82-92`), targeted zero-row probes (`116-144`), and
unconditional cleanup/failure aggregation (`176-210`).

```typescript
const clientA = createProbeClient(environment.url, environment.key)
const clientB = createProbeClient(environment.url, environment.key)
...
const { data: targetedRead, error: targetedReadError } = await clientB
  .from('resumes').select('id').eq('id', probeRowId)
probe(!targetedReadError && targetedRead?.length === 0, '...')
```

Tracker proof must use disposable rows only and verify:

- unfiltered and targeted cross-user application/event reads return zero;
- foreign updates/deletes and every tracker RPC fail or affect zero rows;
- cross-user resume attachment fails;
- deleting an owned resume nulls only `application.resume_id`;
- event edit/delete recalculates current stage and final-event delete fails;
- Mark Applied is idempotent;
- system snapshot survives source loss;
- cleanup leaves zero application, event, and resume fixtures.

### `web/src/lib/dashboard.ts` and `web/src/lib/dashboard.test.ts` (conditional)

Only modify these if `Dashboard.tsx` continues to delegate Show applied copy,
timestamps, query construction, or source-row selection to these helpers.
Applied rows are no longer `FeedRow` instances, so do not extend
`dashboardLifecycleTimestamp(row: FeedRow, 'applied')` to guess across two
incompatible shapes. Prefer dedicated tracker-backed applied helpers in
`tracker.ts`; leave Active/Dismissed helpers stable. Update tests only for
helpers that actually change.

## Shared Patterns

### Authentication and authorization

**Sources:** `0002_resumes.sql:10-31`,
`0052_decouple_resume_routing.sql:16-38`.

Apply owner indexes and own-row RLS to every exposed table. Route guards are UX,
not authorization. Every definer function must use an empty search path,
fully-qualified relations, explicit `auth.uid()`, and exact execute ACLs.

### Query keys and invalidation

**Sources:** `Resumes.tsx:35-50`, `Dashboard.tsx:309-335, 461-500`.

- list: `['tracker-applications', selectedStages]`;
- detail: `['tracker-application', applicationId]`;
- applied Dashboard: `['dashboard-applied-applications']`;
- resumes: preserve `['resumes']`.

Invalidate only affected scopes. A stage/source display mutation affects
Tracker and applied Dashboard; notes-only changes do not need a Dashboard
refresh.

### Error handling

**Sources:** `feed.ts:617-670`, `Dashboard.tsx:885-905`,
`ConfirmDialog.tsx:76-84`.

Data functions throw Supabase/shape errors. Components retain the user’s draft,
render bounded exact copy with `role="alert"`, and expose a real Retry button.
Expanded-detail failure remains inside its detail row. Never use browser
`alert`/`confirm`, and never use a toast as the only persistence signal.

### Validation

**Sources:** `feed.ts:185-196`, `0052_decouple_resume_routing.sql:288-395`.

Validate at both client and database boundaries. Client validation improves
focus/copy; database allowlists, ownership checks, and constraints remain
authoritative. URLs must be HTTPS with no embedded credentials.

### Safe rendering

**Source:** `JobDetail.tsx:171-173, 219-235`.

Sanitize system HTML snapshots with DOMPurify immediately before render. Render
manual JD and all notes as plain text. External links use `target="_blank"`,
`rel="noreferrer"`, and accessible “new tab” names.

### Accessibility

**Sources:** `Dashboard.tsx:885-950`,
`ConfirmDialog.tsx:35-74, 87-125`.

Retain semantic tables, keyboard-focusable scroll regions, visible focus
outlines, `aria-expanded`/`aria-controls`, `aria-pressed`, polite save live
regions, alert failures, application-specific icon labels, focus return, and
44px coarse-pointer targets.

## No Exact Analog Found

| File | Role | Data Flow | Reason / fallback |
|---|---|---|---|
| `web/src/components/ApplicationTimeline.tsx` | component | event-driven | No chronological editable timeline exists. Use `ConfirmDialog` and `JobDetail` only for cross-cutting behavior; implement geometry and event semantics directly from `04-UI-SPEC.md` and `references/stage-timeline-reference.png`. |

The cell-local serialized autosave state also has no complete existing
implementation. Use the TanStack mutation-scope design in `04-RESEARCH.md`
rather than adapting Dashboard’s page-wide lifecycle pending state.

## Metadata

**Analog search scope:** `web/src`, `web/tests`, `scripts`,
`supabase/migrations`
**Files scanned:** 137 candidate files; 13 strong analog files read
**Strong analogs retained:** 5 pattern families (Dashboard/feed, RLS/migration,
dialog/detail rendering, tests, two-user verifier)
**Pattern extraction date:** 2026-07-27

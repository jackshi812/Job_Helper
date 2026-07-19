# Phase 3: Scoring, Feed & Notifications - Pattern Map

**Mapped:** 2026-07-18
**Files analyzed:** 24 new/modified files
**Analogs found:** 21 / 24 (2 partial, 1 no-analog: `web/public/sw.js`)

**Parallel-execution caveat:** Phase 02.1 is executing concurrently. All analogs below were read as of migration head **0016**. Do NOT copy source enumerations (e.g., `jobs.source` check values) — operate on job rows source-agnostically, and re-verify 02.1's final VERIFICATION.md before execution. Do not modify `poll-tick/index.ts`, `_shared/lifecycle.ts`, `_shared/connectors.ts`, or `_shared/adapters/*` — they are 02.1-contended; copy from them, never edit them.

## File Classification

### Edge functions (Deno)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `supabase/functions/score-tick/index.ts` (new) | cron worker | batch (scan-claim) | `supabase/functions/poll-tick/index.ts` | exact |
| `supabase/functions/notify-tick/index.ts` (new) | cron worker | batch + request-response (push/email dispatch) | `supabase/functions/poll-tick/index.ts` | role-match |
| `supabase/functions/extract-resume/index.ts` (new) | cron worker | batch + file-I/O | `supabase/functions/poll-tick/index.ts` (skeleton) + `web/src/lib/resumes.ts` (storage semantics) | role-match |
| `supabase/functions/_shared/filters.ts` (new) | utility (pure) | transform | `supabase/functions/_shared/dedup.ts` | exact |
| `supabase/functions/_shared/routing.ts` (new) | utility (pure) | transform | `supabase/functions/_shared/dedup.ts` + `lifecycle.ts` | exact |
| `supabase/functions/_shared/quiet-hours.ts` (new) | utility (pure) | transform | `supabase/functions/_shared/lifecycle.ts` | role-match |
| `supabase/functions/_shared/gemini.ts` (new) | service (API client) | request-response | `supabase/functions/_shared/adapters/greenhouse.ts` | role-match |
| `supabase/functions/_shared/webpush.ts` (new) | service (API client) | request-response | `adapters/greenhouse.ts` (npm-import + error style only) | partial — API surface from RESEARCH.md Pattern 3 |
| `supabase/functions/_shared/docx.ts` (new) | utility | file-I/O transform | `adapters/greenhouse.ts` (`htmlToText` philosophy) | partial — mammoth usage from RESEARCH.md |

### Migrations (start at 0017; re-verify head against 02.1 final state)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `preferences` table migration | model (per-user CRUD) | CRUD | `supabase/migrations/0002_resumes.sql` | exact |
| `user_jobs` table migration | model (service-written, column-limited user writes) | CRUD | `0006_jobs_pipeline.sql` (revoke/grant) + `0002_resumes.sql` (own-row policies) | exact (composite) |
| `push_subscriptions` table migration | model (per-user CRUD) | CRUD | `0002_resumes.sql` | exact |
| `notifications` table migration | model (service-written, user-readable) | CRUD | `0006_jobs_pipeline.sql` (`jobs` grants) | exact |
| `resume_extracts` table migration | model (service-written, FK cascade) | CRUD | `0002_resumes.sql` (cascade) + `0006` (grants) | exact (composite) |
| `ai_usage` table migration | model (service-only) | CRUD | `0006_jobs_pipeline.sql` (`pipeline_heartbeat`) | exact |
| claim RPC (`claim_scoring_work` or similar) | migration (RPC) | batch claim | `supabase/migrations/0008_claim_exclusive.sql` | exact |
| user-invoked mark-rescore RPC | migration (RPC) | CRUD | `supabase/migrations/0004_delete_my_data.sql` | exact |
| cron schedules for score-tick / notify-tick | config (pg_cron) | event-driven | `0006_jobs_pipeline.sql` lines 77–107 | exact |
| `delete_my_data()` update (append new user tables) | migration (modify) | CRUD | `0004_delete_my_data.sql` (its own comment mandates this) | exact |

### Frontend (React SPA)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `web/src/pages/Dashboard.tsx` (replace stub) | component (feed table) | request-response | `web/src/pages/Watchlist.tsx` | exact |
| `web/src/pages/JobDetail.tsx` (new) | component (detail view) | request-response | `Watchlist.tsx` (presentation) + `Settings.tsx` (sectioning) | role-match |
| `web/src/pages/Preferences.tsx` (new, or section) | component (form) | CRUD | `web/src/pages/Settings.tsx` | role-match |
| `web/src/pages/Settings.tsx` (modify: Notifications section) | component (form) | CRUD | itself — copy its existing section pattern | exact |
| `web/src/lib/feed.ts` (new) | service (data lib) | request-response | `web/src/lib/watchlist.ts` | exact |
| `web/src/lib/preferences.ts` (new) | service (data lib) | CRUD | `web/src/lib/resumes.ts` | exact |
| `web/src/lib/push.ts` (new) | service (browser API + data lib) | event-driven | `web/src/lib/resumes.ts` (structure only) | role-match — PushManager flow from RESEARCH.md Pattern 3 |
| `web/src/main.tsx` (modify: add routes) | config (routing) | — | itself | exact |
| `web/public/sw.js` (new) | service worker | event-driven (push) | — | none — use RESEARCH.md Pattern 3 verbatim |

### Tests & verification

| New File | Role | Closest Analog | Match Quality |
|----------|------|----------------|---------------|
| `web/tests/filters.test.ts`, `routing.test.ts`, `quiet-hours.test.ts` | test (pure edge modules) | `web/tests/dedup.test.ts`, `web/tests/lifecycle.test.ts` | exact |
| `web/src/lib/feed.test.ts` etc. | test (web lib) | `web/src/lib/pipeline.test.ts` | exact |
| `scripts/verify-scoring.ts` / `verify-notifications.ts` | verification script | `scripts/verify-pipeline.ts` (header pattern) | exact |

## Pattern Assignments

### `supabase/functions/score-tick/index.ts` and `notify-tick/index.ts` (cron workers)

**Analog:** `supabase/functions/poll-tick/index.ts` — copy the whole skeleton.

**Imports pattern** (lines 1–10) — pinned npm specifier, `.ts`-suffixed relative shared imports:
```typescript
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.110.7'
import { fingerprint } from '../_shared/dedup.ts'
```

**Auth pattern — cron secret gate** (lines 293–301). Copy verbatim; this is the locked `verify_jwt`-off + `x-cron-secret` boundary:
```typescript
Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret || request.headers.get('x-cron-secret') !== cronSecret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
```

**Service-role client creation** (lines 41–45, 304–314) — `requiredEnvironment` helper plus no-session client:
```typescript
function requiredEnvironment(name: string) {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}
// ...
const admin = createClient(
  requiredEnvironment('SUPABASE_URL'),
  requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } },
)
```

**Core pattern — claim batch via RPC, process with `Promise.allSettled`, aggregate counters** (lines 321–359). score-tick swaps `claim_due_companies` for its own claim RPC and `processCompany` for a per-(job,user) pipeline (filter → route → score → write). Cap the batch (RESEARCH Pitfall 2: 10–15 scoring calls/tick):
```typescript
const { data, error: claimError } = await admin.rpc('claim_due_companies', {
  batch_size: 10,
})
if (claimError) throw claimError

const companies = (data ?? []) as Company[]
const settled = await Promise.allSettled(
  companies.map((company) => processCompany(admin, company)),
)
// per-item failure handling: increment attempt counter, record bounded error code
```

**Error handling — bounded diagnostic codes, never raw messages into DB** (lines 31–39, 347–359):
```typescript
function diagnosticCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (/\b429\b/.test(message)) return 'http_429'
  if (/timeout|timed out|abort/i.test(message)) return 'timeout'
  // ...
  return 'source_poll_failed'
}
// on rejection:
failed += 1
const code = diagnosticCode(result.reason)
console.error(`poll-tick company ${company.id} failed`, code)
```
For score-tick: same shape with `gemini_http_429` etc. NEVER log prompt content or resume text (RESEARCH §Security V7).

**Batched DB writes** (lines 29, 47–53, 77–89) — `DATABASE_BATCH_SIZE = 100`, `batches<T>()` helper, `.in('id', batch)` loops. Reuse for `user_jobs` upserts.

**Top-level response + catch** (lines 369–381):
```typescript
    return Response.json({ claimed: companies.length, succeeded, failed, inserted, reopened, closed })
  } catch (error) {
    console.error('poll-tick failed', error)
    return Response.json({ error: 'Pipeline tick failed' }, { status: 500 })
  }
})
```

**notify-tick specifics:** same skeleton; the per-user dispatch loop replaces `processCompany`. Heartbeat bookkeeping analog: `pipeline_heartbeat` upsert at lines 315–319 if a notify heartbeat is wanted. `_shared/webpush.ts` + Resend fetch (RESEARCH.md Pattern 3 / Code Examples) supply the send calls.

---

### `supabase/functions/_shared/filters.ts`, `routing.ts`, `quiet-hours.ts` (pure modules)

**Analog 1:** `supabase/functions/_shared/dedup.ts` (entire file, 17 lines) — the normalize philosophy filters.ts must mirror (D-01 fuzzy title overlap starts from exactly this normalization):
```typescript
function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function fingerprint(company: string, title: string, location: string | null): string {
  const city = (location ?? '').split(',')[0]
  return `${normalize(company)}|${normalize(title)}|${normalize(city)}`
}
```

**Analog 2:** `supabase/functions/_shared/lifecycle.ts` — the "pure planning function" shape: typed row interfaces in, plan object out, zero I/O, injectable clock. Copy this structure for `cheapFilter(job, prefs): FilterOutcome`, `routeResume(jobKeywords, extracts): RoutingResult`, `quietHoursState(prefs, nowIso): QuietState`:
```typescript
// lifecycle.ts lines 75–80 — signature style: data in, decision out, now as a parameter
export function planCompanySync(
  existing: ExistingJobRow[],
  observation: PollObservation,
  nowIso: string,
  graceMs = DEFAULT_CLOSE_GRACE_MS,
): CompanySyncPlan {
```
Bounded-string guard to reuse for any user-visible/stored reason codes (lifecycle.ts lines 49–52):
```typescript
function boundedWarning(warnings: string[]) {
  const warning = warnings.find((value) => /^[a-z][a-z0-9_]{0,79}$/.test(value))
  return warning ?? 'source_observation_failed'
}
```

**Testability constraint (important):** pure `_shared` modules are Vitest-tested from `web/tests/` importing across the repo, e.g. `web/tests/dedup.test.ts` line 2:
```typescript
import { fingerprint } from '../../supabase/functions/_shared/dedup'
```
Keep filters/routing/quiet-hours free of Deno globals and `npm:`/`jsr:` specifiers so these cross-imports keep working (dedup.ts and lifecycle.ts are the precedents).

---

### `supabase/functions/_shared/gemini.ts` (API client wrapper)

**Analog:** `supabase/functions/_shared/adapters/greenhouse.ts` — plain-`fetch` provider client with typed response interfaces and bounded error strings.

**Fetch + error pattern** (lines 47–59):
```typescript
export async function pollGreenhouse(token: string, knownIds: Set<string>): Promise<NormalizedJob[]> {
  const listUrl = `https://boards-api.greenhouse.io/v1/boards/${encodedToken}/jobs`
  const listResponse = await fetch(listUrl)

  if (!listResponse.ok) {
    throw new Error(`greenhouse ${token}: HTTP ${listResponse.status}`)
  }

  const { jobs } = (await listResponse.json()) as GreenhouseListResponse
```
Apply: `throw new Error(\`gemini_http_${response.status}\`)`; typed request/response interfaces at top of file like `GreenhouseJob`/`GreenhouseListResponse` (lines 3–15). The Gemini request body (responseSchema, temperature 0, `v1beta` pin) is fully specified in RESEARCH.md Pattern 1 — combine that body with this file's fetch/error/typing style. Capture `usageMetadata` into an `ai_usage` row (counts and cost only, never prompt content). Retry per RESEARCH: 429/5xx → 2 tries, 1s/4s backoff, then leave row unscored for next tick.

**npm-in-Deno import precedent** (greenhouse.ts lines 60–65, dynamic import with vite-ignore so web tests don't choke):
```typescript
const he = (await import(/* @vite-ignore */ 'npm:he@1.2.0')) as {
  decode?: DecodeHtml
  default?: { decode?: DecodeHtml }
}
```
Use this same guard style in `docx.ts` (`npm:mammoth@1.12.0`) and keep `webpush.ts` (`jsr:@negrel/webpush@0.5.0`) out of any web-imported module.

---

### Migrations: per-user tables (`preferences`, `push_subscriptions`)

**Analog:** `supabase/migrations/0002_resumes.sql` (entire file) — the locked per-user RLS style: `default auth.uid()` + cascade FK, per-operation `(select auth.uid())` policies, user_id index:
```sql
create table public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ...
);

alter table public.resumes enable row level security;
create index resumes_user_id_idx on public.resumes using btree (user_id);
grant select, insert, update, delete on table public.resumes to authenticated;

create policy "resumes_select_own" on public.resumes
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "resumes_insert_own" on public.resumes
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "resumes_update_own" on public.resumes
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "resumes_delete_own" on public.resumes
  for delete to authenticated
  using ((select auth.uid()) = user_id);
```
`preferences` variant: `user_id uuid primary key` (one row per user, D-05). `push_subscriptions` variant: add `unique (endpoint)`.

### Migrations: service-written tables (`user_jobs`, `notifications`, `resume_extracts`, `ai_usage`)

**Analog:** `supabase/migrations/0006_jobs_pipeline.sql` — the revoke-then-grant pattern for tables the pipeline writes and users only read (lines 25–36):
```sql
alter table public.jobs enable row level security;
revoke all on table public.jobs from anon, authenticated;
grant select on table public.jobs to authenticated;

create policy "jobs_select_shared" on public.jobs
  for select to authenticated
  using (true);
```
Variants:
- `notifications` / `resume_extracts`: same revoke-then-grant, but the select policy is own-row: `using ((select auth.uid()) = user_id)`.
- `user_jobs` (RESEARCH Pattern 4 — column-limited user writes): revoke all, then `grant select on public.user_jobs to authenticated; grant update (seen_at, dismissed_at) on public.user_jobs to authenticated;` + own-row select and update policies from the 0002 excerpt. Add `unique (user_id, job_id)`.
- `notifications`: `unique (user_id, job_id, channel)` — this constraint IS the NOTF-04 enforcement.
- `ai_usage`: service-role only — revoke all from anon/authenticated, no grants, no user policies (compare `pipeline_heartbeat`, 0006 lines 38–53, which grants read; ai_usage need not).
- Header comments explaining the security decision are house style (0006 lines 1–4, 80–84) — write them.

### Migrations: claim RPC

**Analog:** `supabase/migrations/0008_claim_exclusive.sql` (entire file) — the SKIP LOCKED claim shape score-tick's RPC must mirror:
```sql
create or replace function public.claim_due_companies(batch_size integer default 10)
returns setof public.companies
language sql
security invoker
set search_path = ''
as $$
  with due as (
    select id
    from public.companies
    where last_polled_at is null
      or last_polled_at < now() - interval '9 minutes'
    order by last_polled_at asc nulls first
    limit batch_size
    for update skip locked
  )
  update public.companies c
  set last_polled_at = now()
  from due
  where c.id = due.id
  returning c.*;
$$;

revoke execute on function public.claim_due_companies(integer) from public, anon, authenticated;
grant execute on function public.claim_due_companies(integer) to service_role;
```
Score-tick variant: the `where` becomes "(open job × user) lacking a user_jobs row, or user_jobs flagged needs_refilter/needs_rescore", ordered newest-first (Pitfall 2), claiming into a processing marker with attempt count. Keep `security invoker`, `set search_path = ''`, and the revoke/grant tail verbatim.

### Migrations: user-invoked RPC (mark rescore on preference save) + deletion hook

**Analog:** `supabase/migrations/0004_delete_my_data.sql` (entire file) — user-scoped RPC style:
```sql
create or replace function public.delete_my_data()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.resumes
  where user_id = (select auth.uid());

  -- Phases 2-4 append their user-owned tables here.
end;
$$;

revoke execute on function public.delete_my_data() from public, anon;
grant execute on function public.delete_my_data() to authenticated;
```
Two uses: (1) the mark-rescore RPC follows this exact shape (`update user_jobs set needs_refilter = true where user_id = (select auth.uid()) and ...`); (2) Phase 3 MUST also ship a migration replacing `delete_my_data()` to append deletes for `preferences`, `user_jobs`, `push_subscriptions`, `notifications` (the comment at line 11 is a standing instruction). `resume_extracts` dies via FK cascade from `resumes`.

### Migrations: cron schedules

**Analog:** `supabase/migrations/0006_jobs_pipeline.sql` lines 77–107 — copy the whole block per RESEARCH ("copy the x-cron-secret block verbatim"), including the explanatory comment style:
```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'poll-tick-every-minute',
  '* * * * *',
  $cron$
  select net.http_post(
    url := (
      select decrypted_secret from vault.decrypted_secrets where name = 'project_url'
    ) || '/functions/v1/poll-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);
```
Change only the job name and the function path (`/functions/v1/score-tick`, `/functions/v1/notify-tick`). Extensions already exist — the `create extension if not exists` lines may be omitted or kept harmlessly.

---

### `web/src/lib/feed.ts` (feed data lib)

**Analog:** `web/src/lib/watchlist.ts` — copy its whole architecture: exported column-list constant, typed records, pure presentation-mapping functions (unit-testable), then thin supabase query functions.

**Column constant + typed record** (lines 7–8, 13–32):
```typescript
export const COMPANY_COLUMNS =
  'id, name, ats_type, board_token, region, careers_url, source_key, ...'

export interface CompanyRecord {
  id: string
  name: string
  // ... exact DB column names, snake_case
}
```

**Pure presentation mappers kept out of components** (lines 258–300) — feed.ts should expose `tierPresentation(score)`, `filteredReasonPresentation(reason)` in this style:
```typescript
export function activationPresentation(row: WatchlistRow): ActivationPresentation {
  if (row.activation_state === 'active') return { label: 'Active', details: [] }
  if (row.activation_state === 'experimental') {
    return {
      label: 'Experimental',
      details: [`${row.activation_successes} of 3 checks passed`, 'Scheduled polling off'],
    }
  }
  return { label: 'Disabled', details: ['Scheduled polling off'] }
}
```

**Query function shape** (lines 198–216) — throw on error, cast, return typed rows. The feed query joins `user_jobs` to `jobs` (embedded select: `.from('user_jobs').select('..., jobs(...)')`) with RLS doing the per-user scoping:
```typescript
export async function listCompanies(): Promise<WatchlistRow[]> {
  const { data: companies, error: companiesError } = await supabase
    .from('companies')
    .select(COMPANY_COLUMNS)
    .order('created_at', { ascending: false })
  if (companiesError) throw companiesError
  // ...
}
```

**Mutation shape** (lines 244–247) — seen/dismiss updates follow `removeCompany`:
```typescript
export async function removeCompany(id: string): Promise<void> {
  const { error } = await supabase.from('companies').delete().eq('id', id)
  if (error) throw error
}
```

### `web/src/lib/preferences.ts`

**Analog:** `web/src/lib/resumes.ts` — small CRUD lib: column constant (line 3), typed record (lines 10–16), `list`/`upsert`/`delete` functions that throw on error and return typed rows (lines 65–73). Preferences save additionally calls the mark-rescore RPC — RPC-call precedent is `web/src/pages/Settings.tsx` line 68:
```typescript
const { error: rpcError } = await supabase.rpc('delete_my_data')
if (rpcError) throw rpcError
```

### `web/src/lib/push.ts`

**Analog (structure only):** `web/src/lib/resumes.ts` — auth-guarded browser-API + table write flow (lines 31–45): get user via `supabase.auth.getUser()`, throw friendly error if signed out, perform browser-side operation, then write the row. The PushManager/subscribe specifics come from RESEARCH.md Pattern 3 (`pushManager.subscribe` + upsert on `endpoint`). Permission request must be inside a click handler (Settings "Enable push" button, D-21).

---

### `web/src/pages/Dashboard.tsx` (feed — replaces the 8-line stub)

**Analog:** `web/src/pages/Watchlist.tsx` — the project's only dense table; copy wholesale.

**Query + mutation wiring** (lines 144–166) — queryKey, refetchInterval, invalidate-on-success:
```typescript
const companiesQuery = useQuery({
  queryKey: ['watchlist'],
  queryFn: listCompanies,
  refetchInterval: 60_000,
})
const removeMutation = useMutation({
  mutationFn: removeCompany,
  onSuccess: async () => {
    setCompanyToRemove(null)
    await queryClient.invalidateQueries({ queryKey: ['watchlist'] })
  },
})
```
Feed: `queryKey: ['feed', filters]`, `refetchInterval: 60_000` keeps the New badges fresh. Dismiss/seen mutations invalidate `['feed']`.

**Badge component + tier/status styles** (lines 21–31, 56–69) — reuse `StatusBadge` verbatim; tier colors follow the existing palette (emerald=OK→Strong, amber=Degraded→Good, zinc=Weak/filtered):
```typescript
const healthStyles = {
  OK: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400',
  Degraded: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
  Unsupported: 'border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400',
} as const

function StatusBadge({ label, classes }: { label: string; classes: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold ${classes}`}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  )
}
```

**Dense table markup with loading/error/empty states** (lines 215–282) — copy the scroll-region wrapper, thead classes, and tri-state rendering:
```tsx
<div role="region" aria-label="Watchlist; scroll horizontally to view all columns" tabIndex={0}
  className="mt-8 overflow-x-auto rounded-lg border border-zinc-200 bg-white ... dark:border-zinc-800 dark:bg-zinc-900 ...">
  {companiesQuery.isPending ? (
    <p className="p-4 text-sm text-zinc-600 dark:text-zinc-400">Loading watchlist…</p>
  ) : companiesQuery.error ? (
    <p role="alert" className="p-4 text-sm text-red-700 dark:text-red-400">Unable to load ...</p>
  ) : companiesQuery.data.length === 0 ? (
    <div className="p-4"> ... empty state heading + hint ... </div>
  ) : (
    <table className="w-full min-w-[68rem] border-collapse text-left text-sm">
      <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold tracking-wide text-zinc-600 uppercase dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
```

**External link + timestamps** (lines 14–19, 41–54, 71–88, 104–117) — `safeCareersUrl` https-only guard for the apply link (reuse from watchlist.ts lines 94–103), `Intl.RelativeTimeFormat` `relativeTime()` for posted-at, `<time dateTime title>` accessibility shape.

**Bounded error display** (lines 33–39) — copy for all new pages:
```typescript
function boundedErrorMessage(error: unknown) {
  const fallback = 'Something went wrong. Please try again.'
  if (!(error instanceof Error)) return fallback
  const message = error.message.trim()
  if (!message || /https?:|token|secret|stack|<html/i.test(message)) return fallback
  return message.slice(0, 120)
}
```

### `web/src/pages/JobDetail.tsx`

**Analogs:** `Watchlist.tsx` badges/timestamps (above) + `Settings.tsx` card-section layout (lines 129–133):
```tsx
<section className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
  <h2 className="text-base font-semibold">Change password</h2>
  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">...</p>
```
Use one card per concern: JD snapshot (DOMPurify-sanitized per RESEARCH "Sanitized JD render" example — never raw `description_html`; `<pre>{description_text}</pre>` fallback), score+reasons, keyword-gap panel. Route: add `<Route path="jobs/:id" element={<JobDetail />} />` in `web/src/main.tsx` inside the `RequireAuth`/`Shell` route group (lines 27–39).

### `web/src/pages/Preferences.tsx` and `Settings.tsx` Notifications section

**Analog:** `web/src/pages/Settings.tsx` — copy its form idiom exactly: controlled inputs, pending/message/error state trio (lines 75–82), submit handler with try/finally (lines 84–102), input classes (lines 137–145), success/error paragraphs (lines 161–162), submit button classes (lines 163–169):
```tsx
const [passwordPending, setPasswordPending] = useState(false)
const [passwordMessage, setPasswordMessage] = useState<string | null>(null)
const [passwordError, setPasswordError] = useState<string | null>(null)

async function handlePasswordChange(event: FormEvent<HTMLFormElement>) {
  event.preventDefault()
  setPasswordPending(true)
  setPasswordMessage(null)
  setPasswordError(null)
  try {
    // ... mutate
    setPasswordMessage('Password updated. ...')
  } catch {
    setPasswordError('Could not update your password. ...')
  } finally {
    setPasswordPending(false)
  }
}
```
The Notifications section (threshold slider, quiet hours, digest time, per-device push enable — D-21) is a new `<section className="mt-6 rounded-lg border ...">` card appended inside the existing `Settings` component, matching the existing two cards. Note Settings.tsx exports plain async action functions (`changePassword`, `deleteAllMyData`) for testability (`Settings.test.ts`) — keep new push/preference actions exported the same way.

---

### Tests for pure edge modules

**Analog:** `web/tests/dedup.test.ts` (lines 1–9) — plain Vitest, relative cross-repo import, no mocks for pure modules:
```typescript
import { describe, expect, it } from 'vitest'
import { fingerprint } from '../../supabase/functions/_shared/dedup'

describe('fingerprint', () => {
  it('normalizes company, title, and the first location segment', () => {
    expect(
      fingerprint('Stripe', 'Software Engineer (Remote)', 'San Francisco, CA'),
    ).toBe('stripe|software engineer|san francisco')
  })
```
New tests: `web/tests/filters.test.ts`, `web/tests/routing.test.ts`, `web/tests/quiet-hours.test.ts` (include DST-boundary cases per RESEARCH Pitfall 4). For web libs needing the supabase client mocked, follow `web/src/lib/pipeline.test.ts` line 4: `vi.mock('./supabase', () => ({ supabase: {} }))`.

### Verification scripts

**Analog:** `scripts/verify-pipeline.ts` (lines 1–3) — Node script importing supabase-js from web's node_modules, run with `node --env-file=scripts/.env`:
```typescript
import { createHash, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createClient } from '../web/node_modules/@supabase/supabase-js/dist/index.mjs'
```
The Gemini live smoke test (RESEARCH Pitfall 1) and RLS checks for new tables (`scripts/verify-rls.ts` precedent) follow this pattern.

## Shared Patterns

### Cron authentication (`x-cron-secret`)
**Source:** `supabase/functions/poll-tick/index.ts` lines 298–301 + `supabase/migrations/0006_jobs_pipeline.sql` lines 80–107
**Apply to:** `score-tick`, `notify-tick`, `extract-resume` (if cron-scheduled) — deploy with `verify_jwt` disabled; secret lives only in Vault + edge env.

### Service-role admin client
**Source:** `poll-tick/index.ts` lines 41–45, 304–314
**Apply to:** all three new edge functions.

### Claim-RPC + bounded batch + `Promise.allSettled`
**Source:** `poll-tick/index.ts` lines 321–329; RPC shape from `0008_claim_exclusive.sql`
**Apply to:** score-tick (and notify-tick if it claims queued notification rows).

### Bounded error codes (never raw errors into DB or UI)
**Source:** `poll-tick/index.ts` lines 31–39 (`diagnosticCode`), `_shared/lifecycle.ts` lines 49–52 (`boundedWarning`), `Watchlist.tsx` lines 33–39 (`boundedErrorMessage`)
**Apply to:** score-tick/notify-tick failure paths, all new page mutation error displays. Extra rule for this phase: never log resume text or prompt content.

### Per-user RLS (revoke-then-grant, `(select auth.uid())` per-operation)
**Source:** `0002_resumes.sql` (user-CRUD tables), `0006_jobs_pipeline.sql` lines 25–36 (service-written tables)
**Apply to:** all six new tables; `user_jobs` adds column-level `grant update (seen_at, dismissed_at)`.

### TanStack Query conventions
**Source:** `Watchlist.tsx` lines 144–166
**Apply to:** Dashboard feed, JobDetail, Preferences — stable array queryKeys, `invalidateQueries` in `onSuccess`, `refetchInterval: 60_000` for pipeline-fed data. Existing queryKeys in use: `['watchlist']`, `['resumes']`, heartbeat via `pipeline.ts` — new keys: `['feed']`, `['preferences']`, `['job', id]`.

### Dense-table UI kit (Phase 1 D-15)
**Source:** `Watchlist.tsx` — `StatusBadge` (56–69), table region (215–247), `Settings.tsx` card sections (129–133), form idiom (84–102, 137–169)
**Apply to:** Dashboard, JobDetail, Preferences, Settings additions. Zinc palette, dark: variants on every class, `focus-visible:outline-2`, min-h-9 touch targets.

### Pure-module + fixture-test discipline
**Source:** `_shared/dedup.ts`, `_shared/lifecycle.ts`, tests in `web/tests/`
**Apply to:** `filters.ts`, `routing.ts`, `quiet-hours.ts` — no I/O, no Deno globals, clock passed as parameter, so `web/tests/` can import them directly.

## No Analog Found

| File | Role | Data Flow | Reason | Use Instead |
|------|------|-----------|--------|-------------|
| `web/public/sw.js` | service worker | event-driven push | No service worker exists (public/ has only favicon.svg, icons.svg) | RESEARCH.md Pattern 3 sw.js snippet verbatim; Vite serves `/public` at site root, no build step |
| `_shared/webpush.ts` (send internals) | service | request-response | No push code exists anywhere | RESEARCH.md Pattern 3 verified API surface (`importVapidKeys` → `ApplicationServer.new` → `subscribe().pushTextMessage`; handle `.isGone()` AND `response.status === 404`) |
| `_shared/docx.ts` (mammoth usage) | utility | file-I/O | No DOCX parsing exists yet (Phase 4 planned it) | RESEARCH.md: `mammoth.extractRawText({ arrayBuffer })` primary, jszip/`<w:t>` regex fallback; verify mammoth-in-edge in the first extraction task (Pitfall 7) |

## Metadata

**Analog search scope:** `supabase/functions/**`, `supabase/migrations/**`, `web/src/**`, `web/tests/**`, `web/public/**`, `scripts/**`
**Files scanned:** 60 source files enumerated; 16 read in full or targeted
**Pattern extraction date:** 2026-07-18
**Snapshot caveat:** analogs read while 02.1 executes in parallel; poll-tick/lifecycle/connectors/adapters and migrations 0012–0016 may drift — patterns copied FROM them remain valid, but re-verify jobs schema and migration head against 02.1's final VERIFICATION.md before execution.

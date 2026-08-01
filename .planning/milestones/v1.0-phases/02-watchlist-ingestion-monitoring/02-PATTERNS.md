# Phase 2: Watchlist Ingestion & Monitoring - Pattern Map

**Mapped:** 2026-07-16
**Files analyzed:** 16 new/modified files
**Analogs found:** 11 / 16 (4 edge functions + Deno entrypoints have no codebase analog — first Deno functions in the repo; use RESEARCH.md patterns)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `supabase/migrations/0005_watchlist_pipeline.sql` | migration | schema/CRUD | `supabase/migrations/0002_resumes.sql` (+ `0004_delete_my_data.sql` for functions/grants) | exact (style) — RLS *shape* deliberately differs, see caveat |
| `web/src/lib/watchlist.ts` (data-access layer) | service | CRUD | `web/src/lib/resumes.ts` | exact |
| `web/src/pages/Watchlist.tsx` (replace stub) | component (page) | CRUD | `web/src/pages/Resumes.tsx` | exact |
| Heartbeat banner (in `web/src/components/Shell.tsx` or new component) | component | request-response (read) | `web/src/components/Shell.tsx` error strip + `Resumes.tsx` useQuery | role-match |
| Health badge (inline in Watchlist table) | component | — | `Resumes.tsx` table cell/button styling | role-match |
| `supabase/functions/_shared/detect.ts` | utility (pure) | transform | `web/src/auth/recovery.ts` | role-match (URL → discriminated union, same problem shape) |
| `supabase/functions/_shared/dedup.ts` | utility (pure) | transform | `web/src/auth/recovery.ts` (style) + RESEARCH.md fingerprint example | role-match |
| `supabase/functions/_shared/adapters/types.ts` | utility (types) | — | `web/src/lib/resumes.ts` interfaces + RESEARCH.md `NormalizedJob` | role-match |
| `supabase/functions/_shared/adapters/{greenhouse,lever,ashby,adzuna}.ts` | adapter | request-response transform | `web/src/auth/recovery.ts` (pure-module style); response shapes from RESEARCH.md Pattern 1 | partial |
| `supabase/functions/poll-tick/index.ts` | edge function | batch / event-driven | — | no analog (RESEARCH Patterns 3–6) |
| `supabase/functions/discovery-sweep/index.ts` | edge function | batch | — | no analog (RESEARCH Pattern 1 Adzuna + Pitfall 7) |
| `supabase/functions/verify-board/index.ts` | edge function | request-response | — | no analog (RESEARCH Pattern 2 + Pitfall 3) |
| `supabase/functions/heartbeat/index.ts` | edge function | request-response | — | no analog (RESEARCH.md has a complete code example) |
| Unit tests for detect/dedup/adapters | test | — | `web/tests/verify-rls.test.ts` (cross-dir import) + `web/src/lib/resumes.test.ts` (mocking) | exact |
| `scripts/verify-pipeline.ts` (hosted verification) | script | request-response | `scripts/verify-rls.ts` | exact |
| `supabase/config.toml` (modify: `[functions.heartbeat] verify_jwt = false`) | config | — | existing `supabase/config.toml` (table-per-section style, e.g. `[edge_runtime]` lines 374–383) | exact |

## Pattern Assignments

### `supabase/migrations/0005_watchlist_pipeline.sql` (migration, schema)

**Analog:** `supabase/migrations/0002_resumes.sql` (whole file, 32 lines)

**Table + RLS + grants pattern** (0002_resumes.sql lines 1–31) — copy the ordering: create table → enable RLS → index → explicit grant → named per-operation policies:
```sql
create table public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  filename text not null,
  storage_path text not null unique,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

alter table public.resumes enable row level security;

create index resumes_user_id_idx on public.resumes using btree (user_id);

grant select, insert, update, delete on table public.resumes to authenticated;

create policy "resumes_select_own" on public.resumes
  for select to authenticated
  using ((select auth.uid()) = user_id);
```
Conventions to copy: lowercase SQL, `public.` schema prefix everywhere, `gen_random_uuid()` PKs, `timestamptz ... default now()`, snake_case `{table}_{operation}_{scope}` policy names, `{table}_{col}_idx` index names, `(select auth.uid())` wrapper (never bare `auth.uid()` in policies), explicit `grant` before policies.

**CRITICAL RLS-shape caveat (RESEARCH Pitfall 8):** Do NOT copy the `(select auth.uid()) = user_id` predicate onto the Phase 2 tables. `companies` is a shared table (D-01/D-02): policies are `for select/insert/update/delete to authenticated using (true)` (`with check (true)` on writes). `jobs`, `seed_queries`, `pipeline_heartbeat`: select-only for `authenticated` (writes come from the service-role poller, which bypasses RLS). Zero `anon` grants — 0002 already grants only to `authenticated`; keep that. Add a migration comment stating the deliberate D-01 exception to AUTH-03 so the security reviewer doesn't flag it blind.

**Function/grant pattern** (0004_delete_my_data.sql lines 1–16) — if the migration defines any SQL function (or the pg_cron `cron.schedule` DDL), copy the security posture:
```sql
create or replace function public.delete_my_data()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  ...
end;
$$;

revoke execute on function public.delete_my_data() from public, anon;
grant execute on function public.delete_my_data() to authenticated;
```
Note 0004 line 11 comment: "Phases 2-4 append their user-owned tables here." — Phase 2 tables are shared (not user-owned), so `delete_my_data()` likely needs **no** change; state that explicitly in the plan rather than silently skipping it.

The pg_cron scheduling SQL has no codebase analog — use RESEARCH.md Pattern 7 (Vault-sourced URL + bearer token via `net.http_post`) verbatim.

---

### `web/src/lib/watchlist.ts` (service, CRUD)

**Analog:** `web/src/lib/resumes.ts` (whole file, 92 lines) — the project's only data-access layer; copy its structure exactly.

**Imports + module constants pattern** (lines 1–8):
```typescript
import { supabase } from './supabase'

const RESUME_COLUMNS = 'id, filename, storage_path, size_bytes, created_at'
```
Copy: single named `supabase` import, an explicit column-list constant reused in every select (→ `COMPANY_COLUMNS` with the health columns).

**Row interface pattern** (lines 10–16) — snake_case fields mirroring DB columns, exported for the page:
```typescript
export interface ResumeRecord {
  id: string
  filename: string
  storage_path: string
  size_bytes: number | null
  created_at: string
}
```

**Validation-before-network pattern** (lines 23–29) — throw a user-readable `Error` before any network call (this is how the Resumes tests assert "no network on bad input"; the ATS URL detection in the add flow should behave the same way client-side before calling `verify-board`):
```typescript
function allowedExtension(filename: string): keyof typeof CONTENT_TYPES {
  const extension = filename.split('.').pop()?.toLowerCase()
  if (extension !== 'docx' && extension !== 'pdf') {
    throw new Error('Only DOCX and PDF files are allowed')
  }
  return extension
}
```

**Query + error-throwing pattern** (lines 65–73) — destructure `{ data, error }`, throw the error, return typed data:
```typescript
export async function listResumes(): Promise<ResumeRecord[]> {
  const { data, error } = await supabase
    .from('resumes')
    .select(RESUME_COLUMNS)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as ResumeRecord[]
}
```

**Insert-with-returning pattern** (lines 47–62) — `.insert({...}).select(COLUMNS).single()`, compensate/cleanup on failure, return the row. For the add-company flow the "verify then insert" sequence mirrors this upload-then-insert two-step (verify via edge function first; only insert on success per D-03/D-04).

**Edge-function invocation:** no analog exists for calling `verify-board` from the browser. Use `supabase.functions.invoke('verify-board', { body: {...} })` from the same shared client (keeps the user JWT, matching the security requirement that `verify-board` requires a session), and keep the `if (error) throw error` convention.

---

### `web/src/pages/Watchlist.tsx` (component/page, CRUD)

**Analog:** `web/src/pages/Resumes.tsx` (whole file, 188 lines) — replace the 8-line stub at `web/src/pages/Watchlist.tsx` with this exact page shape. This is the D-15 "clean minimal dense-table" reference implementation named in CONTEXT.md.

**Imports pattern** (lines 1–10) — relative imports, no path aliases; page pulls its data functions from the lib module:
```typescript
import { useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ConfirmDialog } from '../components/ConfirmDialog'
import {
  deleteResume, downloadResume, listResumes, uploadResume,
  type ResumeRecord,
} from '../lib/resumes'
```

**Error-message helper** (lines 21–23) — every page-level error goes through this:
```typescript
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}
```
The D-04 rejection guidance ("works with Greenhouse, Lever, Ashby" + how to find the board URL) should surface through this same channel: throw an `Error` with the full guidance text from the lib/edge call, render via the alert paragraph below.

**Query + mutation + invalidation pattern** (lines 26–46):
```typescript
const queryClient = useQueryClient()
const resumesQuery = useQuery({ queryKey: ['resumes'], queryFn: listResumes })
const uploadMutation = useMutation({
  mutationFn: uploadResume,
  onSuccess: async () => {
    if (fileInput.current) fileInput.current.value = ''
    await queryClient.invalidateQueries({ queryKey: ['resumes'] })
  },
})
const deleteMutation = useMutation({
  mutationFn: deleteResume,
  onSuccess: async () => {
    setResumeToDelete(null)
    await queryClient.invalidateQueries({ queryKey: ['resumes'] })
  },
})
```
Copy: flat string query keys (`['companies']`), invalidate-on-success, `mutation.reset()` before re-triggering (line 52), `mutateAsync` inside ConfirmDialog so the dialog's spinner awaits completion (lines 178–183).

**Page skeleton + add form** (lines 73–98) — `<section>` root, `h1 text-xl font-semibold tracking-tight`, muted `p mt-2 text-sm text-zinc-600 dark:text-zinc-400` subtitle, form `mt-6 flex flex-wrap items-end gap-3`, labeled input, primary button:
```tsx
<button
  type="submit"
  disabled={uploadMutation.isPending}
  className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-wait disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
>
  {uploadMutation.isPending ? 'Uploading…' : 'Upload'}
</button>
```
(→ URL text input + "Add company" button; pending label "Verifying…" fits the D-03 live-verification wait.)

**Inline alert pattern** (lines 100–104):
```tsx
{uploadMutation.error ? (
  <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">
    Upload failed: {errorMessage(uploadMutation.error)}
  </p>
) : null}
```

**Dense table with loading/error/empty states** (lines 116–170) — the exact D-15 table to copy:
```tsx
<div className="mt-8 overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
  {resumesQuery.isPending ? (
    <p className="p-4 text-sm text-zinc-600 dark:text-zinc-400">Loading resumes…</p>
  ) : resumesQuery.error ? (
    <p role="alert" className="p-4 text-sm text-red-700 dark:text-red-400">…</p>
  ) : resumesQuery.data.length === 0 ? (
    <p className="p-4 text-sm text-zinc-600 dark:text-zinc-400">Upload your first resume to get started.</p>
  ) : (
    <table className="w-full min-w-2xl border-collapse text-left text-sm">
      <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-medium tracking-wide text-zinc-600 uppercase dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
        <tr><th scope="col" className="px-4 py-2.5">Filename</th>…</tr>
      </thead>
      <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
        <tr key={resume.id}>
          <td className="max-w-sm truncate px-4 py-3 font-medium">{resume.filename}</td>
          <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">…</td>
```
Columns for watchlist: company, ATS type, health badge (D-05), jobs count / last success, actions. Row action buttons (lines 145–162): small `rounded-md border … px-2.5 py-1 text-xs font-medium` buttons; the red delete variant `border-red-300 … text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950` is the Remove button.

**Health badge (D-05):** no badge component exists yet. Derive status client-side from `consecutive_failures` / `last_success_at` (rules in RESEARCH Pattern 6) and render as a small pill using the same token vocabulary (`rounded-md px-2.5 py-1 text-xs font-medium` + zinc/red/amber tints); put `last_success_at` in a `title` attribute for the hover requirement. Date display via the module-level `Intl.DateTimeFormat` pattern (Resumes.tsx line 12).

**Removal confirmation** (lines 172–185) — reuse `web/src/components/ConfirmDialog.tsx` as-is (CONTEXT.md names it reusable). Its contract (ConfirmDialog.tsx lines 3–9): `title`, `message`, `confirmLabel`, `onConfirm` (may return a Promise — dialog shows "Deleting…" while pending, line 62), `onCancel`. Parent owns error rendering (lines 27–29: dialog swallows onConfirm rejections).

---

### Heartbeat banner (component, read)

**Analog:** `web/src/components/Shell.tsx` error strip (lines 64–68) for placement/styling + Resumes.tsx `useQuery` for data.

Shell renders a full-width alert strip inside the header:
```tsx
{error ? (
  <p role="alert" className="mx-auto max-w-6xl px-4 pb-3 text-sm text-red-700 sm:px-6 dark:text-red-400">
    {error}
  </p>
) : null}
```
The D-07 dashboard banner ("monitoring hasn't run since {time}") follows this shape — a conditional `role="alert"` strip between `<header>` (ends line 69) and `<main>` (line 70) in Shell.tsx (visible on every page, matching "dashboard banner" intent), driven by a `useQuery({ queryKey: ['pipeline_heartbeat'], … refetchInterval })` reading the `pipeline_heartbeat` row through a lib function in the resumes.ts style. Shell is inside `QueryClientProvider` (main.tsx lines 21–43), so hooks work there. Use an amber/warning tint rather than red (it's a degradation warning, not an action failure); keep the `mx-auto max-w-6xl px-4 … sm:px-6` container geometry so it aligns with the header/main columns.

---

### `supabase/functions/_shared/detect.ts` (utility, transform)

**Analog:** `web/src/auth/recovery.ts` — the project's pure "parse a URL, classify it into a typed union" module; detect.ts is the same problem. Keep it pure TS with zero Deno APIs (RESEARCH requirement so Vitest in `web/` can test it).

**Discriminated-union result type** (recovery.ts lines 10–13):
```typescript
export type RecoveryCallbackHint =
  | { kind: 'none'; diagnostic: null }
  | { kind: 'pending'; diagnostic: null }
  | { kind: 'error'; diagnostic: Exclude<RecoveryDiagnostic, null> }
```
→ mirror as `type DetectResult = { ats: 'greenhouse' | 'lever' | 'ashby'; slug: string; region?: 'eu' } | { ats: 'unsupported' }` (store `ats_type` + `board_token` + `region`, not raw endpoint strings — RESEARCH Pattern 2).

**URL parsing + classification pattern** (recovery.ts lines 34–64):
```typescript
function mergedCallbackParams(url: URL) {
  const params = new URLSearchParams(url.search)
  ...
}

export function inspectRecoveryCallback(href: string): RecoveryCallbackHint {
  const params = mergedCallbackParams(new URL(href))
  const errorCode = params.get('error_code')

  if (params.has('error') || params.has('error_description') || errorCode) {
    return { kind: 'error', diagnostic: ... }
  }
  ...
}
```
Copy: `new URL()` for parsing (never regex the whole href), small private helpers, module-level `Set`/lookup tables for the match lists (lines 27–32 `expiredCallbackCodes` → a host-pattern table per RESEARCH Pattern 2), exhaustive fall-through to the safe default (`unsupported`). Slug validation `^[A-Za-z0-9_-]+$` (single path segment for Ashby) lives here — this function is the single audited endpoint constructor (SSRF control).

---

### `supabase/functions/_shared/dedup.ts` (utility, pure transform)

**Analog:** `web/src/auth/recovery.ts` for module style (pure exported functions, exported types, no I/O). Core logic comes from RESEARCH.md "Fingerprint normalization" example verbatim (norm → lowercase, drop parentheticals, strip punctuation, collapse whitespace; city = first comma segment). Keep DB interaction out of this file — the poll-tick function applies the fingerprint decisions; dedup.ts only computes.

---

### `supabase/functions/_shared/adapters/*.ts` (adapters, request-response transform)

**Analog (style only):** `web/src/auth/recovery.ts` pure-module conventions + `web/src/lib/resumes.ts` interface style. No fetch-and-normalize adapter exists in the codebase; the field mappings, `NormalizedJob` interface, and the Greenhouse lean-list/per-new-job pattern come from RESEARCH.md Pattern 1 and its Code Examples (verified live 2026-07-16).

Conventions to carry over from the codebase:
- Throw `Error` with context (`resumes.ts` line 27 style): `` throw new Error(`greenhouse ${token}: HTTP ${res.status}`) `` — check `res.ok` before `res.json()` (RESEARCH Pitfall 3: Ashby 404 is plain text).
- Exported interfaces with the exact field list, one per module (`resumes.ts` lines 10–16).
- Version-pinned Deno npm specifiers per RESEARCH: `npm:@supabase/supabase-js@2.110.7` (match `web/package.json` pin exactly — package-legitimacy flag says do NOT bump), `npm:he@1.2.0` in the Greenhouse adapter only. Keep npm-specifier imports out of `_shared/detect.ts` and `_shared/dedup.ts` so they stay Vitest-importable; adapters that need `he` can isolate the decode call so the fetch-free mapping logic remains testable.

---

### `supabase/functions/{poll-tick,discovery-sweep,verify-board,heartbeat}/index.ts` (edge functions)

**No codebase analog** — first Deno functions in the repo. Build from RESEARCH.md directly:
- `heartbeat`: complete code example in RESEARCH.md "Heartbeat endpoint" (`Deno.serve`, shared-secret query param, 200/503). Requires `[functions.heartbeat] verify_jwt = false` in config.toml (see below).
- `poll-tick`: RESEARCH Pattern 3 due-queue claim SQL (`update … returning`, limit 10), Pattern 4 dedup application, Pattern 5 stale-close (success path only), Pattern 6 heartbeat writes. `Promise.allSettled` for the batch with per-company failure isolation.
- `verify-board`: RESEARCH Pattern 2 — reuses `_shared/detect.ts` + adapters; verified 404 shapes per ATS.
- `discovery-sweep`: RESEARCH Pattern 1 Adzuna section + Pitfall 7 budget guard.

Codebase conventions that still apply inside these functions: `{ data, error }` destructure + throw (`resumes.ts`), service-role client created per-invocation with env-sourced secret (never in SPA — mirrors the "secret key never leaves `scripts/`" rule from CONTEXT.md), isolated-client options `persistSession: false, autoRefreshToken: false` when constructing non-default clients (`web/src/lib/supabase.ts` lines 20–23 and `scripts/verify-rls.ts` lines 40–45).

---

### Unit tests for detect/dedup/adapter mapping (test)

**Analog A — cross-directory import from `web/tests/`:** `web/tests/verify-rls.test.ts` (lines 1–2) proves the established pattern for testing code outside `web/src`:
```typescript
import { describe, expect, it } from 'vitest'
import { assertIsolation } from '../../scripts/verify-rls'
```
→ Tests for `_shared` live as `web/tests/detect.test.ts` etc., importing `../../supabase/functions/_shared/detect` (works because those modules are pure TS, no Deno APIs — the RESEARCH constraint exists precisely for this). Vitest runs with default config from `web/` (`npm test` → `vitest run`, no `test` block in `vite.config.ts`).

**Analog B — mocking + behavioral assertions:** `web/src/lib/resumes.test.ts`:
```typescript
vi.mock('./supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn() },
    storage: { from: vi.fn() },
    from: vi.fn(),
  },
}))
```
Copy: `vi.mock` at module scope, `beforeEach(() => vi.clearAllMocks())`, "rejects before making a network call" assertions (lines 20–27) — directly applicable to "unsupported URL rejected without fetching" detect tests — and fixture rows shaped exactly like DB records (lines 37–43). For adapter mapping tests, feed captured JSON fixtures (RESEARCH field tables) through the pure mapping functions; no fetch mocking needed if fetch and mapping are separated.

---

### `scripts/verify-pipeline.ts` (hosted verification script)

**Analog:** `scripts/verify-rls.ts` (whole file, 219 lines) — the Phase 1 hosted-verification pattern CONTEXT.md tells us to reuse (Docker/Deno unavailable locally, so deployed-function verification happens here).

**Env validation pattern** (lines 4–11, 27–38):
```typescript
const required = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', ...] as const

function requiredEnvironment() {
  for (const name of required) {
    if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`)
  }
  return { url: process.env.SUPABASE_URL!, ... }
}
```

**Probe client pattern** (lines 40–45):
```typescript
function createProbeClient(url: string, key: string) {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: sanitizedFetch },
  })
}
```
Note the import (line 2): `import { createClient } from '../web/node_modules/@supabase/supabase-js/dist/index.mjs'` — scripts reuse web's installed package; keep this.

**PASS/FAIL accumulation + cleanup-in-finally + main-module guard** (lines 53–72, 176–207, 213–219):
```typescript
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  runRlsVerification().catch((error) => {
    console.error(error instanceof Error ? error.message : 'RLS verification failed')
    process.exitCode = 1
  })
}
```
Run convention: `node --env-file=scripts/.env scripts/verify-pipeline.ts`; secrets never leave `scripts/` (CONTEXT.md Established Patterns). Phase 2 probes: shared-table RLS (both users see/edit the same companies — inverse of the Phase 1 isolation probes), `jobs` write-rejection for authenticated, heartbeat endpoint 200/401/503 behavior, verify-board accept/reject cases.

---

### `supabase/config.toml` (modify)

**Analog:** the file itself — flat TOML tables with comment headers. Append a function section following the `[edge_runtime]` style (lines 374–383):
```toml
[functions.heartbeat]
verify_jwt = false
```
(RESEARCH A5 flags this key as ASSUMED — verify the exact mechanism at deploy time.) Other functions keep JWT verification (default).

## Shared Patterns

### Supabase error-throwing convention
**Source:** `web/src/lib/resumes.ts` (lines 65–73 and throughout)
**Apply to:** all lib functions, edge-function DB calls, scripts
```typescript
const { data, error } = await supabase.from('...').select(...)
if (error) throw error
return (data ?? []) as SomeRecord[]
```
Errors are thrown, never returned; React Query surfaces them; pages render via `errorMessage()` + `role="alert"`.

### TanStack Query usage
**Source:** `web/src/pages/Resumes.tsx` lines 26–46
**Apply to:** Watchlist page, heartbeat banner
Flat array query keys, `useMutation` + `invalidateQueries` on success, `isPending` for disabled/spinner states, `mutation.reset()` before retry.

### D-15 dense-table visual language
**Source:** `web/src/pages/Resumes.tsx` lines 116–170; `web/src/components/Shell.tsx` for chrome
**Apply to:** Watchlist table, badges, banner
Zinc palette with `dark:` variants on every colored class (system theme, D-14), `rounded-lg border` card wrapping tables, `text-sm` body / `text-xs uppercase` headers, `px-4 py-3` cells, small `text-xs` bordered action buttons, red-tint destructive variants.

### RLS migration conventions
**Source:** `supabase/migrations/0002_resumes.sql`; function security from `0004_delete_my_data.sql`
**Apply to:** migration 0005
Create → enable RLS → index → grant → named per-operation policies; `(select auth.uid())` wrapper where user-scoping applies; `security invoker` + `set search_path = ''` + revoke-then-grant on functions. **Phase 2 exception:** shared tables use `using (true)` policies (documented in the Pattern Assignments caveat above).

### Isolated/non-default Supabase clients
**Source:** `web/src/lib/supabase.ts` lines 19–25 (`reauthenticate`); `scripts/verify-rls.ts` lines 40–45
**Apply to:** edge-function service-role clients, script probe clients
```typescript
const isolated = createClient(supabaseUrl, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})
```
Always disable persistence/refresh on purpose-built clients; browser keeps only the publishable key.

### Pure-module style for testable logic
**Source:** `web/src/auth/recovery.ts`
**Apply to:** `_shared/detect.ts`, `_shared/dedup.ts`, adapter mapping functions
Exported discriminated-union types, small private helpers, module-level lookup tables, no I/O, no environment access — this is what makes the Vitest-from-`web/` fallback (no local Deno/Docker) work.

### Code style (all TS/TSX files)
**Source:** every file read
No semicolons, single quotes, 2-space indent, named exports only (no default exports), `function` declarations for components and helpers, relative imports (no path aliases), `type`-only imports use `import { type X }` inline syntax (Resumes.tsx line 1, resumes.ts usage).

## No Analog Found

Files with no close match in the codebase (planner should use RESEARCH.md patterns instead):

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `supabase/functions/poll-tick/index.ts` | edge function | batch/event-driven | No edge functions exist; RESEARCH Patterns 3–6 are the spec |
| `supabase/functions/discovery-sweep/index.ts` | edge function | batch | Same; RESEARCH Pattern 1 (Adzuna) + Pitfall 7 |
| `supabase/functions/verify-board/index.ts` | edge function | request-response | Same; RESEARCH Pattern 2 + Pitfall 3 |
| `supabase/functions/heartbeat/index.ts` | edge function | request-response | Same; RESEARCH.md contains a complete implementation example |
| pg_cron schedule DDL (in migration 0005) | config/SQL | event-driven | No cron exists yet; RESEARCH Pattern 7 verbatim |

## Metadata

**Analog search scope:** `web/src/**` (pages, lib, auth, components), `web/tests/`, `supabase/migrations/`, `supabase/config.toml`, `scripts/`
**Files scanned:** 14 read in full (all Phase 1 source is small; no file exceeded 420 lines)
**Pattern extraction date:** 2026-07-16

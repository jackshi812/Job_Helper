#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  access,
  mkdir,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import process from 'node:process'

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type JsonRecord = { [key: string]: Json }

const USAGE =
  'Usage: verify-tracker-schema.ts --mode preflight|assert-hosted ' +
  '[--migration <path>] [--output <path>] [--preflight <path>] [--evidence <path>]'
const SHA256 = /^[a-f0-9]{64}$/
const MIGRATION_NAME = '0053_application_tracker.sql'
const MANUAL_SIGNATURE =
  'create_manual_application(text, text, text, text, text, date)'
const MANUAL_RESULT = 'application_id uuid, duplicate_warning boolean'
const DASHBOARD_RESULT = [
  'application_id uuid',
  'company text',
  'title text',
  'location text',
  'apply_url text',
  'applied_on date',
  'current_stage text',
  'current_stage_date date',
] as const
const EARLIEST_APPLIED =
  'ORDER BY occurred_on ASC, created_at ASC, id ASC LIMIT 1'
const TRACKER_TABLES = ['applications', 'application_stage_events'] as const
const TRACKER_POLICIES = [
  'applications_select_own',
  'application_stage_events_select_own',
] as const
const TRACKER_INDEXES = [
  'applications_user_id_idx',
  'applications_system_source_unique_idx',
  'applications_pinned_updated_id_idx',
  'applications_resume_owner_idx',
  'application_stage_events_user_id_idx',
  'application_stage_events_application_order_idx',
] as const
const TRACKER_CONSTRAINTS = [
  'applications_id_user_id_key',
  'applications_origin_check',
  'applications_stage_check',
  'applications_manual_fields_check',
  'applications_apply_url_check',
  'applications_snapshot_check',
  'applications_notes_check',
  'applications_resume_owner_fkey',
  'application_stage_events_application_owner_fkey',
  'application_stage_events_stage_check',
] as const
const TRACKER_FUNCTIONS = [
  'tracker_https_url_valid(text)',
  'sync_application_stage_projection()',
  'mark_job_applied(uuid)',
  MANUAL_SIGNATURE,
  'set_application_pin(uuid, boolean)',
  'update_application_text_field(uuid, text, text)',
  'set_application_resume(uuid, uuid)',
  'append_application_stage(uuid, text, date)',
  'update_application_stage_event(uuid, text, date)',
  'delete_application_stage_event(uuid)',
  'dashboard_applied_applications()',
  'dashboard_feed_page(text, text, text[], text[], text, jsonb, integer)',
] as const

function fail(message: string): never {
  throw new Error(message)
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function normalizedSql(value: string): string {
  return value
    .replace(/--[^\n]*/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),=])\s*/g, '$1')
    .trim()
    .toLowerCase()
}

function parseArgs(argv: string[]) {
  const allowed = new Set([
    '--mode',
    '--migration',
    '--output',
    '--preflight',
    '--evidence',
  ])
  const parsed = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!flag || !allowed.has(flag)) fail(`unknown argument: ${flag ?? '<empty>'}`)
    if (!value || value.startsWith('--')) fail(`missing value for ${flag}`)
    if (parsed.has(flag)) fail(`duplicate argument: ${flag}`)
    parsed.set(flag, value)
  }
  const mode = parsed.get('--mode')
  if (mode !== 'preflight' && mode !== 'assert-hosted') fail(USAGE)
  const exact =
    mode === 'preflight'
      ? new Set(['--mode', '--migration', '--output'])
      : new Set(['--mode', '--migration', '--preflight', '--evidence'])
  for (const flag of parsed.keys()) {
    if (!exact.has(flag)) fail(`flag ${flag} is invalid for mode ${mode}`)
  }
  for (const flag of exact) {
    if (!parsed.has(flag)) fail(`required flag missing: ${flag}`)
  }
  return {
    mode,
    migration: parsed.get('--migration')!,
    output: parsed.get('--output'),
    preflight: parsed.get('--preflight'),
    evidence: parsed.get('--evidence'),
  }
}

async function repositoryRoot(start = process.cwd()): Promise<string> {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: start,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
  if (!root) fail('repository root is unavailable')
  return realpath(root)
}

async function checkedPath(root: string, value: string): Promise<string> {
  const path = resolve(root, value)
  const rel = relative(root, path)
  if (rel.startsWith('..') || rel === '') {
    if (path !== root) fail(`path is outside repository: ${value}`)
  }
  return path
}

async function fileSha(path: string): Promise<string> {
  return sha256(await readFile(path))
}

function command(
  executable: string,
  args: string[],
  cwd: string,
  environment = process.env,
): string {
  return execFileSync(executable, args, {
    cwd,
    encoding: 'utf8',
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  }).trim()
}

function commandCombined(
  executable: string,
  args: string[],
  cwd: string,
  environment = process.env,
): string {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    fail(`command failed with exit ${String(result.status)}`)
  }
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
}

async function managementSql(
  projectRef: string,
  query: string,
): Promise<JsonRecord[]> {
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim()
  if (!token) fail('SUPABASE_ACCESS_TOKEN is required')
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(30_000),
    },
  )
  const payload = (await response.json().catch(() => null)) as Json
  if (!response.ok || !Array.isArray(payload)) {
    fail(`Management API catalog query failed with HTTP ${response.status}`)
  }
  return payload.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      fail('Management API returned a malformed row')
    }
    return row as JsonRecord
  })
}

function stringField(row: JsonRecord, field: string): string {
  const value = row[field]
  if (typeof value !== 'string') fail(`catalog field ${field} is malformed`)
  return value
}

function integerField(row: JsonRecord, field: string): number {
  const value = row[field]
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    fail(`catalog field ${field} is malformed`)
  }
  return parsed
}

function extractRemoteVersions(cliOutput: string): string[] {
  try {
    const parsed = JSON.parse(cliOutput) as JsonRecord
    if (!Array.isArray(parsed.migrations)) fail('CLI migration list is malformed')
    return [
      ...new Set(
        (parsed.migrations as JsonRecord[])
          .map((row) => row.remote)
          .filter(
            (version): version is string =>
              typeof version === 'string' && /^\d{4}$/.test(version),
          ),
      ),
    ].sort()
  } catch (error) {
    if (error instanceof SyntaxError) fail('CLI migration list is not JSON')
    throw error
  }
}

function requireMigrationContract(migration: string): void {
  const normalized = normalizedSql(migration)
  const required = [
    'create table public.applications',
    'create table public.application_stage_events',
    'create function public.create_manual_application(',
    'p_company text',
    'p_title text',
    'p_apply_url text',
    'p_notes text',
    'p_stage text',
    'p_occurred_on date',
    'returns table(application_id uuid,duplicate_warning boolean)',
    'create function public.dashboard_applied_applications()',
    ...DASHBOARD_RESULT,
    'order by event.occurred_on asc,event.created_at asc,event.id asc limit 1',
    'create trigger application_stage_events_sync_projection',
    'grant select on table public.applications to authenticated',
    'grant select on table public.application_stage_events to authenticated',
  ]
  for (const item of required) {
    if (!normalized.includes(normalizedSql(item))) {
      fail(`migration contract missing: ${item}`)
    }
  }
}

function safeDirtyInventory(root: string): string[] {
  const output = command('git', ['status', '--short'], root)
  if (!output) return []
  const excluded = new Set([
    '.DS_Store',
    '.planning/phases/03.8-monitor-and-poll-the-branded-banking-companies-currently-on-/.gitkeep',
    'scripts/agent-dashboard.mjs',
    'scripts/agent-dashboard.test.mjs',
    'web/zh',
  ])
  return output
    .split('\n')
    .map((line) => line.slice(3))
    .filter((path) => !excluded.has(path))
    .sort()
}

async function fixtureContract(root: string): Promise<JsonRecord> {
  const verifier = resolve(root, 'scripts/verify-tracker-rls.ts')
  const output = command(
    process.execPath,
    ['--experimental-strip-types', verifier, '--mode', 'contract'],
    root,
  )
  const parsed = JSON.parse(output) as Json
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('fixture contract output is malformed')
  }
  return parsed as JsonRecord
}

function preflightJson(markdown: string): JsonRecord {
  const match = markdown.match(
    /<!-- tracker-preflight-json\n([\s\S]*?)\ntracker-preflight-json -->/,
  )
  if (!match) fail('preflight machine contract is missing')
  const parsed = JSON.parse(match[1]) as Json
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('preflight machine contract is malformed')
  }
  return parsed as JsonRecord
}

function assertHash(value: Json, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    fail(`${label} is not a SHA-256 digest`)
  }
  return value
}

async function collectHostedInventory(projectRef: string): Promise<{
  migrationVersions: string[]
  tables: JsonRecord[]
  columns: JsonRecord[]
  constraints: JsonRecord[]
  indexes: JsonRecord[]
  triggers: JsonRecord[]
  functions: JsonRecord[]
  policies: JsonRecord[]
  tablePrivileges: JsonRecord[]
  columnPrivileges: JsonRecord[]
  routinePrivileges: JsonRecord[]
  backfill: JsonRecord
}> {
  const rows = await managementSql(
    projectRef,
    `
      with migrations as (
        select jsonb_agg(version order by version) as value
        from supabase_migrations.schema_migrations
      ),
      tables as (
        select jsonb_agg(
          jsonb_build_object(
            'name', c.relname,
            'rls', c.relrowsecurity,
            'owner', pg_get_userbyid(c.relowner)
          ) order by c.relname
        ) as value
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname in ('applications', 'application_stage_events')
      ),
      columns as (
        select jsonb_agg(
          jsonb_build_object(
            'table', c.relname,
            'name', a.attname,
            'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
            'not_null', a.attnotnull
          ) order by c.relname, a.attnum
        ) as value
        from pg_catalog.pg_attribute a
        join pg_catalog.pg_class c on c.oid = a.attrelid
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname in ('applications', 'application_stage_events')
          and a.attnum > 0 and not a.attisdropped
      ),
      constraints as (
        select jsonb_agg(
          jsonb_build_object(
            'name', con.conname,
            'definition_sha256', encode(digest(pg_get_constraintdef(con.oid, true), 'sha256'), 'hex')
          ) order by con.conname
        ) as value
        from pg_catalog.pg_constraint con
        join pg_catalog.pg_class c on c.oid = con.conrelid
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname in ('applications', 'application_stage_events')
      ),
      indexes as (
        select jsonb_agg(
          jsonb_build_object(
            'name', indexname,
            'definition_sha256', encode(digest(pg_get_indexdef((quote_ident(schemaname)||'.'||quote_ident(indexname))::regclass), 'sha256'), 'hex')
          ) order by indexname
        ) as value
        from pg_catalog.pg_indexes
        where schemaname = 'public'
          and tablename in ('applications', 'application_stage_events')
      ),
      triggers as (
        select jsonb_agg(
          jsonb_build_object(
            'name', t.tgname,
            'definition_sha256', encode(digest(pg_get_triggerdef(t.oid, true), 'sha256'), 'hex')
          ) order by t.tgname
        ) as value
        from pg_catalog.pg_trigger t
        join pg_catalog.pg_class c on c.oid = t.tgrelid
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname = 'application_stage_events'
          and not t.tgisinternal
      ),
      functions as (
        select jsonb_agg(
          jsonb_build_object(
            'signature', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
            'result', pg_get_function_result(p.oid),
            'security_definer', p.prosecdef,
            'volatility', p.provolatile,
            'search_path', coalesce(array_to_string(p.proconfig, ','), ''),
            'acl', coalesce(array_to_string(p.proacl, ','), ''),
            'definition_sha256', encode(digest(pg_get_functiondef(p.oid), 'sha256'), 'hex')
          ) order by p.proname, pg_get_function_identity_arguments(p.oid)
        ) as value
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in (
            'tracker_https_url_valid', 'sync_application_stage_projection',
            'mark_job_applied', 'create_manual_application',
            'set_application_pin', 'update_application_text_field',
            'set_application_resume', 'append_application_stage',
            'update_application_stage_event', 'delete_application_stage_event',
            'dashboard_applied_applications', 'dashboard_feed_page'
          )
      ),
      policies as (
        select jsonb_agg(
          jsonb_build_object(
            'name', pol.polname,
            'table', c.relname,
            'command', pol.polcmd,
            'roles', pol.polroles::text,
            'using_sha256', encode(digest(coalesce(pg_get_expr(pol.polqual, pol.polrelid), ''), 'sha256'), 'hex'),
            'check_sha256', encode(digest(coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), ''), 'sha256'), 'hex')
          ) order by pol.polname
        ) as value
        from pg_catalog.pg_policy pol
        join pg_catalog.pg_class c on c.oid = pol.polrelid
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname in ('applications', 'application_stage_events')
      ),
      table_privileges as (
        select jsonb_agg(
          jsonb_build_object(
            'table', table_name, 'grantee', grantee, 'privilege', privilege_type
          ) order by table_name, grantee, privilege_type
        ) as value
        from information_schema.table_privileges
        where table_schema = 'public'
          and table_name in ('applications', 'application_stage_events', 'user_jobs')
          and grantee in ('anon', 'authenticated')
      ),
      column_privileges as (
        select jsonb_agg(
          jsonb_build_object(
            'table', table_name, 'column', column_name,
            'grantee', grantee, 'privilege', privilege_type
          ) order by table_name, column_name, grantee, privilege_type
        ) as value
        from information_schema.column_privileges
        where table_schema = 'public'
          and table_name in ('applications', 'application_stage_events', 'user_jobs')
          and grantee in ('anon', 'authenticated')
      ),
      routine_privileges as (
        select jsonb_agg(
          jsonb_build_object(
            'routine', routine_name, 'grantee', grantee, 'privilege', privilege_type
          ) order by routine_name, grantee, privilege_type
        ) as value
        from information_schema.routine_privileges
        where specific_schema = 'public'
          and routine_name in (
            'tracker_https_url_valid', 'sync_application_stage_projection',
            'mark_job_applied', 'create_manual_application',
            'set_application_pin', 'update_application_text_field',
            'set_application_resume', 'append_application_stage',
            'update_application_stage_event', 'delete_application_stage_event',
            'dashboard_applied_applications', 'dashboard_feed_page'
          )
          and grantee in ('PUBLIC', 'anon', 'authenticated')
      ),
      backfill as (
        select jsonb_build_object(
          'legacy_applied_count', (
            select count(*) from public.user_jobs where applied_at is not null
          ),
          'system_application_count', (
            select count(*) from public.applications where origin = 'system'
          ),
          'system_applied_event_count', (
            select count(*)
            from public.application_stage_events e
            join public.applications a on a.id = e.application_id
            where a.origin = 'system' and e.stage = 'applied'
          ),
          'missing_application_count', (
            select count(*)
            from public.user_jobs uj
            where uj.applied_at is not null
              and not exists (
                select 1 from public.applications a
                where a.user_id = uj.user_id
                  and a.source_job_id = uj.job_id
                  and a.origin = 'system'
              )
          ),
          'missing_applied_event_count', (
            select count(*)
            from public.applications a
            where a.origin = 'system'
              and not exists (
                select 1 from public.application_stage_events e
                where e.application_id = a.id and e.user_id = a.user_id
                  and e.stage = 'applied'
              )
          )
        ) as value
      )
      select jsonb_build_object(
        'migrations', migrations.value,
        'tables', tables.value,
        'columns', columns.value,
        'constraints', constraints.value,
        'indexes', indexes.value,
        'triggers', triggers.value,
        'functions', functions.value,
        'policies', policies.value,
        'table_privileges', table_privileges.value,
        'column_privileges', column_privileges.value,
        'routine_privileges', routine_privileges.value,
        'backfill', backfill.value
      ) as inventory
      from migrations, tables, columns, constraints, indexes, triggers, functions,
        policies, table_privileges, column_privileges, routine_privileges, backfill;
    `,
  )
  if (rows.length !== 1 || !rows[0].inventory || typeof rows[0].inventory !== 'object') {
    fail('hosted catalog inventory is malformed')
  }
  const inventory = rows[0].inventory as JsonRecord
  function array(name: string): JsonRecord[] {
    const value = inventory[name]
    if (!Array.isArray(value)) fail(`hosted ${name} inventory is malformed`)
    return value as JsonRecord[]
  }
  const migrations = inventory.migrations
  if (!Array.isArray(migrations) || migrations.some((item) => typeof item !== 'string')) {
    fail('hosted migration inventory is malformed')
  }
  if (!inventory.backfill || typeof inventory.backfill !== 'object') {
    fail('hosted backfill inventory is malformed')
  }
  return {
    migrationVersions: migrations as string[],
    tables: array('tables'),
    columns: array('columns'),
    constraints: array('constraints'),
    indexes: array('indexes'),
    triggers: array('triggers'),
    functions: array('functions'),
    policies: array('policies'),
    tablePrivileges: array('table_privileges'),
    columnPrivileges: array('column_privileges'),
    routinePrivileges: array('routine_privileges'),
    backfill: inventory.backfill as JsonRecord,
  }
}

function assertHostedContract(
  inventory: Awaited<ReturnType<typeof collectHostedInventory>>,
  baseline: number,
): void {
  if (!inventory.migrationVersions.includes('0053')) {
    fail('hosted migration 0053 is absent')
  }
  for (const table of TRACKER_TABLES) {
    const row = inventory.tables.find((item) => item.name === table)
    if (!row || row.rls !== true || row.owner !== 'postgres') {
      fail(`hosted table contract drifted: ${table}`)
    }
  }
  for (const policy of TRACKER_POLICIES) {
    if (!inventory.policies.some((item) => item.name === policy)) {
      fail(`hosted policy contract drifted: ${policy}`)
    }
  }
  for (const constraint of TRACKER_CONSTRAINTS) {
    if (!inventory.constraints.some((item) => item.name === constraint)) {
      fail(`hosted constraint contract drifted: ${constraint}`)
    }
  }
  for (const index of TRACKER_INDEXES) {
    if (!inventory.indexes.some((item) => item.name === index)) {
      fail(`hosted index contract drifted: ${index}`)
    }
  }
  if (
    !inventory.triggers.some(
      (item) => item.name === 'application_stage_events_sync_projection',
    )
  ) {
    fail('hosted stage projection trigger drifted')
  }
  for (const signature of TRACKER_FUNCTIONS) {
    if (!inventory.functions.some((item) => item.signature === signature)) {
      fail(`hosted function contract drifted: ${signature}`)
    }
  }
  const manual = inventory.functions.find(
    (item) => item.signature === MANUAL_SIGNATURE,
  )
  if (
    !manual ||
    normalizedSql(String(manual.result)) !==
      normalizedSql(`TABLE(${MANUAL_RESULT})`)
  ) {
    fail('hosted manual-create parameter/result contract drifted')
  }
  const dashboard = inventory.functions.find(
    (item) => item.signature === 'dashboard_applied_applications()',
  )
  if (
    !dashboard ||
    normalizedSql(String(dashboard.result)) !==
      normalizedSql(`TABLE(${DASHBOARD_RESULT.join(', ')})`)
  ) {
    fail('hosted Dashboard applied column/order/type contract drifted')
  }
  for (const row of inventory.functions) {
    const signature = String(row.signature)
    const invoker = signature === 'tracker_https_url_valid(text)'
      || signature === 'dashboard_applied_applications()'
      || signature.startsWith('dashboard_feed_page(')
    if (row.search_path !== 'search_path=""') {
      fail(`hosted function search path drifted: ${signature}`)
    }
    if (row.security_definer !== !invoker) {
      fail(`hosted function security mode drifted: ${signature}`)
    }
  }
  const tableAcl = inventory.tablePrivileges.filter(
    (row) => TRACKER_TABLES.includes(String(row.table) as never),
  )
  if (
    tableAcl.length !== 2 ||
    tableAcl.some(
      (row) => row.grantee !== 'authenticated' || row.privilege !== 'SELECT',
    )
  ) {
    fail('tracker table ACL expanded beyond authenticated SELECT')
  }
  const forbiddenTrackerColumns = inventory.columnPrivileges.filter((row) =>
    TRACKER_TABLES.includes(String(row.table) as never),
  )
  if (forbiddenTrackerColumns.some((row) => row.privilege !== 'SELECT')) {
    fail('tracker column ACL expanded beyond authenticated SELECT')
  }
  const legacy = integerField(inventory.backfill, 'legacy_applied_count')
  const applications = integerField(inventory.backfill, 'system_application_count')
  const events = integerField(inventory.backfill, 'system_applied_event_count')
  if (
    legacy !== baseline ||
    applications < baseline ||
    events < applications ||
    integerField(inventory.backfill, 'missing_application_count') !== 0 ||
    integerField(inventory.backfill, 'missing_applied_event_count') !== 0
  ) {
    fail('legacy applied backfill parity drifted')
  }
}

async function runPreflight(args: ReturnType<typeof parseArgs>): Promise<void> {
  const root = await repositoryRoot()
  const migrationPath = await checkedPath(root, args.migration)
  if (!migrationPath.endsWith(`/supabase/migrations/${MIGRATION_NAME}`)) {
    fail(`migration must be supabase/migrations/${MIGRATION_NAME}`)
  }
  const outputPath = await checkedPath(root, args.output!)
  const migration = await readFile(migrationPath, 'utf8')
  requireMigrationContract(migration)

  const projectRef = (
    await readFile(resolve(root, 'supabase/.temp/project-ref'), 'utf8')
  ).trim()
  if (!/^[a-z0-9]{20}$/.test(projectRef)) fail('linked project reference is malformed')
  const environmentRef = process.env.SUPABASE_PROJECT_REF?.trim()
  if (environmentRef && environmentRef !== projectRef) {
    fail('linked project target drifted from SUPABASE_PROJECT_REF')
  }
  if (!process.env.SUPABASE_ACCESS_TOKEN?.trim()) {
    fail('SUPABASE_ACCESS_TOKEN is required')
  }

  const cliPath = resolve(root, 'web/node_modules/.bin/supabase')
  await access(cliPath)
  const cliVersion = command(cliPath, ['--version'], root)
  const migrationListOutput = command(cliPath, ['migration', 'list', '--linked'], root)
  const remoteVersions = extractRemoteVersions(migrationListOutput)
  const baselineRows = await managementSql(
    projectRef,
    `
      select
        (select count(*) from public.user_jobs where applied_at is not null)::integer
          as legacy_applied_count,
        coalesce(
          (select jsonb_agg(version order by version)
           from supabase_migrations.schema_migrations),
          '[]'::jsonb
        ) as migration_versions;
    `,
  )
  if (baselineRows.length !== 1 || !Array.isArray(baselineRows[0].migration_versions)) {
    fail('remote baseline inventory is malformed')
  }
  const catalogVersions = baselineRows[0].migration_versions as string[]
  if (
    catalogVersions.some((version) => typeof version !== 'string') ||
    catalogVersions.at(-1) !== '0052' ||
    catalogVersions.includes('0053')
  ) {
    fail('remote migration inventory must end at 0052 with 0053 absent')
  }
  if (!remoteVersions.includes('0052') || remoteVersions.includes('0053')) {
    fail('linked migration inventory does not show remote 0052 with 0053 pending')
  }
  const dryRun = commandCombined(
    cliPath,
    ['db', 'push', '--linked', '--dry-run'],
    root,
  )
  const proposed = [
    ...new Set(dryRun.match(/\d{4}_[a-z0-9_]+\.sql/gi) ?? []),
  ]
  if (proposed.length !== 1 || proposed[0] !== MIGRATION_NAME) {
    fail(`linked dry run is not sole-pending ${MIGRATION_NAME}`)
  }

  const fixture = await fixtureContract(root)
  const artifacts = {
    migration_sha256: await fileSha(migrationPath),
    schema_verifier_sha256: await fileSha(
      resolve(root, 'scripts/verify-tracker-schema.ts'),
    ),
    behavior_verifier_sha256: await fileSha(
      resolve(root, 'scripts/verify-tracker-rls.ts'),
    ),
    schema_test_sha256: await fileSha(
      resolve(root, 'web/tests/verify-tracker-schema.test.ts'),
    ),
    behavior_test_sha256: await fileSha(
      resolve(root, 'web/tests/verify-tracker-rls.test.ts'),
    ),
    fixture_manifest_sha256: assertHash(
      fixture.fixture_manifest_sha256,
      'fixture manifest hash',
    ),
  }
  const legacyCount = integerField(baselineRows[0], 'legacy_applied_count')
  const legacyDigest = sha256(
    canonical({
      project_ref: projectRef,
      through: '0052',
      legacy_applied_count: legacyCount,
    }),
  )
  const sourceCommit = command('git', ['rev-parse', 'HEAD'], root)
  const fixtureManifest = fixture.fixture_manifest as JsonRecord
  const expectedCounts = fixture.expected_counts as JsonRecord
  const machine: JsonRecord = {
    status: 'PASS',
    created_at: new Date().toISOString(),
    project_ref: projectRef,
    source_commit: sourceCommit,
    scoped_dirty_inventory: safeDirtyInventory(root),
    migration: `supabase/migrations/${MIGRATION_NAME}`,
    ...artifacts,
    cli_path: 'web/node_modules/.bin/supabase',
    cli_version: cliVersion,
    remote_migration_versions: catalogVersions,
    sole_pending_migration: MIGRATION_NAME,
    dry_run_sha256: sha256(dryRun),
    legacy_applied_count: legacyCount,
    legacy_applied_digest: legacyDigest,
    fixture_manifest: fixtureManifest,
    expected_counts: expectedCounts,
    lineage_rules: fixture.lineage_rules,
  }
  const approvalSignal =
    `approve Phase 04 tracker schema push ` +
    `target=${projectRef} migration_sha256=${artifacts.migration_sha256} ` +
    `schema_verifier_sha256=${artifacts.schema_verifier_sha256} ` +
    `behavior_verifier_sha256=${artifacts.behavior_verifier_sha256} ` +
    `fixture_manifest_sha256=${artifacts.fixture_manifest_sha256} ` +
    `dry_run_sha256=${machine.dry_run_sha256}`
  machine.approval_signal = approvalSignal

  const users = fixtureManifest.auth_users as Json[]
  const companies = fixtureManifest.companies as Json[]
  const jobs = fixtureManifest.jobs as Json[]
  const userJobs = fixtureManifest.user_jobs as Json[]
  const resumes = fixtureManifest.resumes as Json[]
  const markdown = `# Phase 04 Plan 02 Tracker Schema Preflight

**Status:** PASS — read-only inventory complete; production unchanged.

## Approval-bound source and target

- Linked project: \`${projectRef}\`
- Source commit: \`${sourceCommit}\`
- Migration: \`supabase/migrations/${MIGRATION_NAME}\`
- Migration SHA-256: \`${artifacts.migration_sha256}\`
- Schema verifier SHA-256: \`${artifacts.schema_verifier_sha256}\`
- Behavior verifier SHA-256: \`${artifacts.behavior_verifier_sha256}\`
- Schema verifier test SHA-256: \`${artifacts.schema_test_sha256}\`
- Behavior verifier test SHA-256: \`${artifacts.behavior_test_sha256}\`
- Fixture manifest SHA-256: \`${artifacts.fixture_manifest_sha256}\`
- Supabase CLI: \`web/node_modules/.bin/supabase\` (\`${cliVersion}\`)
- Local migration order: committed files through \`0053\`
- Sanitized remote migration order: \`${catalogVersions.join(', ')}\`
- Sole pending dry run: \`${MIGRATION_NAME}\`
- Dry-run SHA-256: \`${machine.dry_run_sha256}\`
- Legacy \`user_jobs.applied_at IS NOT NULL\` baseline: \`${legacyCount}\`
- Legacy baseline digest: \`${legacyDigest}\`

The read-only command was exactly:

\`web/node_modules/.bin/supabase db push --linked --dry-run\`

It proposed exactly \`${MIGRATION_NAME}\` after hosted \`0052\`. No schema or
data mutation ran.

## Durable schema effects

1. Add owner-scoped \`applications\` and \`application_stage_events\` with RLS.
2. Add owner-safe resume linkage, immutable system provenance, constraints,
   indexes, and chronological projection trigger.
3. Add the narrow authenticated RPC inventory: \`${TRACKER_FUNCTIONS.join('`, `')}\`.
4. Backfill one system application and one Applied event per legacy applied row.
5. Replace the active Dashboard membership wrapper and add tracker-backed
   applied history.
6. Restrict tracker tables to authenticated SELECT and writes to narrow RPCs.

Manual creation is exactly
\`create_manual_application(p_company text, p_title text, p_apply_url text, p_notes text, p_stage text, p_occurred_on date) returns table(${MANUAL_RESULT})\`.

Dashboard applied history returns exactly
\`${DASHBOARD_RESULT.join(', ')}\`; \`apply_url\` is nullable and must remain
HTTPS without embedded credentials. \`applied_on\` is the earliest Applied
event under \`${EARLIEST_APPLIED}\`.

## Verifier commands and ordering

| Verifier | Mode | Exact flags |
|---|---|---|
| Schema | preflight | \`--mode preflight --migration <path> --output <path>\` |
| Schema | assert-hosted | \`--mode assert-hosted --migration <path> --preflight <path> --evidence <path>\` |
| Behavior | contract | \`--mode contract\` |
| Behavior | hosted | \`--mode hosted --preflight <path> --catalog-evidence <path> --evidence <path>\` |

After explicit approval, Plan 04-03 must:

1. Recompute every hash and target, repeat the sole-pending dry run, then run
   \`web/node_modules/.bin/supabase db push --linked --yes\`.
2. Run
   \`node --env-file=scripts/.env --experimental-strip-types scripts/verify-tracker-schema.ts --mode assert-hosted --migration supabase/migrations/${MIGRATION_NAME} --preflight .planning/phases/04-application-tracker/04-02-PREFLIGHT.md --evidence .planning/phases/04-application-tracker/04-03-CATALOG-EVIDENCE.json\`.
3. Only after catalog PASS, run
   \`node --env-file=scripts/.env --experimental-strip-types scripts/verify-tracker-rls.ts --mode hosted --preflight .planning/phases/04-application-tracker/04-02-PREFLIGHT.md --catalog-evidence .planning/phases/04-application-tracker/04-03-CATALOG-EVIDENCE.json --evidence .planning/phases/04-application-tracker/04-03-RLS-EVIDENCE.json\`.

Catalog verification reads migration, table, column, RLS, policy, grant,
constraint, index, trigger, function definition/security/search-path/ACL, exact
RPC result, Dashboard projection, and backfill parity catalogs. It emits only
object names, booleans, counts, versions, and SHA-256 digests.

## Disposable fixture and authority boundary

- Namespace: \`${String(fixtureManifest.namespace)}\`
- Directly seedable auth users: \`${users.length}\`
- Directly seedable companies: \`${companies.length}\`
- Directly seedable jobs: \`${jobs.length}\`
- Directly seedable user_jobs: \`${userJobs.length}\`
- Directly seedable resumes: \`${resumes.length}\`
- Runtime-derived applications: \`${String(expectedCounts.applications)}\`
- Runtime-derived application events: \`${String(expectedCounts.application_stage_events)}\`

The manifest's exact directly seedable objects and UUIDs are present in the
machine contract below. It deliberately contains no application or event UUID.
The behavior verifier obtains the \`service_role\` key non-interactively with
\`web/node_modules/.bin/supabase projects api-keys --project-ref ${projectRef} --reveal --output json\`,
keeps it only in memory, recursively redacts failures, and never writes it to
arguments, files, logs, approval text, or evidence.

Privileged authority is limited to: create the two manifest users; collision
checks and exact inserts for the listed company/job/user_jobs/resumes; exact
source-row removal; FK-safe finally cleanup; and seven-relation zero-residue
inspection. Every removal requires exact owner, verified parent, fixture
namespace, memory-only runtime lineage membership, and exact expected count.
Auth users are deleted last.

Two independently authenticated publishable-key sessions perform every Mark
Applied/manual-create/stage/table/RPC/resume/isolation assertion. RPC-created
application IDs are admitted to a memory-only allowlist only after exact owner,
origin/source parent or manual namespace, and count verification. Event IDs are
queried only through those applications plus owner/namespace and receive the
same parent/count verification. The proof calls all six manual parameters,
validates both returned fields, queries exactly the eight Dashboard columns,
adds a later Applied event, and requires the earliest Applied date to remain
stable.

Cleanup is FK-safe over \`public.application_stage_events\`,
\`public.applications\`, \`public.user_jobs\`, \`public.resumes\`,
\`public.jobs\`, \`public.companies\`, and \`auth.users\`: six public tables plus
\`auth.users\`, seven relations total. Any collision, ambiguity, drift, count
mismatch, or incomplete cleanup fails closed.

## Exclusions

No predeclared RPC-generated application/event UUID; reset; repair; ad hoc or
Dashboard SQL; historical migration edit; package install; function or web
deployment; provider network call or polling; AI/resume generation; real-user
fixture mutation; credential, endpoint, SQL-body, user-content, JD, notes, or
resume logging. The unrelated \`.DS_Store\`, Phase 03.8 \`.gitkeep\`,
\`scripts/agent-dashboard.mjs\`, \`scripts/agent-dashboard.test.mjs\`, and
\`web/zh\` are excluded and unstaged.

Any changed byte, checksum, target, remote migration list, dry run, test result,
seedable ID, lineage rule/count, command, authority, cleanup path, or inventory
invalidates approval and requires a fresh preflight.

## Exact approval signal

\`${approvalSignal}\`

Replying \`defer schema push\` leaves production unchanged.

<!-- tracker-preflight-json
${JSON.stringify(machine, null, 2)}
tracker-preflight-json -->
`
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, markdown, { encoding: 'utf8', mode: 0o600 })
  process.stdout.write(
    `${JSON.stringify({
      status: 'PASS',
      target: projectRef,
      sole_pending: MIGRATION_NAME,
      dry_run_sha256: machine.dry_run_sha256,
      output: relative(root, outputPath),
    })}\n`,
  )
}

async function runHosted(args: ReturnType<typeof parseArgs>): Promise<void> {
  const root = await repositoryRoot()
  const migrationPath = await checkedPath(root, args.migration)
  const preflightPath = await checkedPath(root, args.preflight!)
  const evidencePath = await checkedPath(root, args.evidence!)
  const migration = await readFile(migrationPath, 'utf8')
  requireMigrationContract(migration)
  const approved = preflightJson(await readFile(preflightPath, 'utf8'))
  if (approved.status !== 'PASS') fail('preflight status is not PASS')
  const projectRef = stringField(approved, 'project_ref')
  const current = {
    migration_sha256: await fileSha(migrationPath),
    schema_verifier_sha256: await fileSha(
      resolve(root, 'scripts/verify-tracker-schema.ts'),
    ),
    behavior_verifier_sha256: await fileSha(
      resolve(root, 'scripts/verify-tracker-rls.ts'),
    ),
    schema_test_sha256: await fileSha(
      resolve(root, 'web/tests/verify-tracker-schema.test.ts'),
    ),
    behavior_test_sha256: await fileSha(
      resolve(root, 'web/tests/verify-tracker-rls.test.ts'),
    ),
    fixture_manifest_sha256: assertHash(
      (await fixtureContract(root)).fixture_manifest_sha256,
      'fixture manifest hash',
    ),
  }
  for (const [field, value] of Object.entries(current)) {
    if (approved[field] !== value) fail(`approval-bound ${field} drifted`)
  }
  const linkedRef = (
    await readFile(resolve(root, 'supabase/.temp/project-ref'), 'utf8')
  ).trim()
  if (linkedRef !== projectRef) fail('linked project target drifted')

  const inventory = await collectHostedInventory(projectRef)
  assertHostedContract(
    inventory,
    integerField(approved, 'legacy_applied_count'),
  )
  const sanitizedInventory: JsonRecord = {
    migration_versions: inventory.migrationVersions,
    tables: inventory.tables.map((row) => ({
      name: row.name,
      rls: row.rls,
      owner: row.owner,
    })),
    columns: inventory.columns,
    constraints: inventory.constraints,
    indexes: inventory.indexes,
    triggers: inventory.triggers,
    functions: inventory.functions.map((row) => ({
      signature: row.signature,
      result: row.result,
      security_definer: row.security_definer,
      volatility: row.volatility,
      search_path: row.search_path,
      acl_sha256: sha256(String(row.acl ?? '')),
      definition_sha256: row.definition_sha256,
    })),
    policies: inventory.policies,
    table_privileges: inventory.tablePrivileges,
    column_privileges: inventory.columnPrivileges,
    routine_privileges: inventory.routinePrivileges,
    backfill: inventory.backfill,
  }
  const hostedCatalogSha = sha256(canonical(sanitizedInventory))
  const evidenceBody: JsonRecord = {
    status: 'PASS',
    checked_at: new Date().toISOString(),
    migration_version: '0053',
    migration_sha256: current.migration_sha256,
    schema_verifier_sha256: current.schema_verifier_sha256,
    behavior_verifier_sha256: current.behavior_verifier_sha256,
    fixture_manifest_sha256: current.fixture_manifest_sha256,
    hosted_catalog_sha256: hostedCatalogSha,
    object_counts: {
      tables: inventory.tables.length,
      columns: inventory.columns.length,
      constraints: inventory.constraints.length,
      indexes: inventory.indexes.length,
      triggers: inventory.triggers.length,
      functions: inventory.functions.length,
      policies: inventory.policies.length,
      table_privileges: inventory.tablePrivileges.length,
      column_privileges: inventory.columnPrivileges.length,
      routine_privileges: inventory.routinePrivileges.length,
    },
    backfill_counts: inventory.backfill,
    inventory: sanitizedInventory,
  }
  evidenceBody.catalog_evidence_sha256 = sha256(canonical(evidenceBody))
  const serialized = `${JSON.stringify(evidenceBody, null, 2)}\n`
  if (
    /(?:eyJ[a-zA-Z0-9_-]{20,}|service_role|SUPABASE_ACCESS_TOKEN|postgres(?:ql)?:\/\/|https?:\/\/)/.test(
      serialized,
    )
  ) {
    fail('sanitized evidence contains a forbidden credential or endpoint')
  }
  await mkdir(dirname(evidencePath), { recursive: true })
  await writeFile(evidencePath, serialized, { encoding: 'utf8', mode: 0o600 })
  process.stdout.write(
    `${JSON.stringify({
      status: 'PASS',
      catalog_evidence_sha256: evidenceBody.catalog_evidence_sha256,
      hosted_catalog_sha256: hostedCatalogSha,
      evidence: relative(root, evidencePath),
    })}\n`,
  )
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.mode === 'preflight') await runPreflight(args)
  else await runHosted(args)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'unknown verifier failure'
  process.stderr.write(`tracker schema verification failed: ${message}\n`)
  process.exitCode = 1
})

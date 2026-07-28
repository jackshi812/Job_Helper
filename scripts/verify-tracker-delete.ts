#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { access, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import process from 'node:process'

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type JsonRecord = { [key: string]: Json }

const MIGRATION_NAME = '0056_delete_tracker_application.sql'
const PREFLIGHT_MARKER = 'tracker-delete-preflight-json'
const SHA256 = /^[a-f0-9]{64}$/
const USAGE =
  'Usage: verify-tracker-delete.ts --mode preflight|assert-hosted ' +
  '--migration <path> (--output <path> | --preflight <path> --evidence <path>)'

function fail(message: string): never {
  throw new Error(message)
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
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
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!flag || !allowed.has(flag)) fail(`unknown argument: ${flag ?? '<empty>'}`)
    if (!value || value.startsWith('--')) fail(`missing value for ${flag}`)
    if (values.has(flag)) fail(`duplicate argument: ${flag}`)
    values.set(flag, value)
  }
  const mode = values.get('--mode')
  const exact = mode === 'preflight'
    ? new Set(['--mode', '--migration', '--output'])
    : mode === 'assert-hosted'
      ? new Set(['--mode', '--migration', '--preflight', '--evidence'])
      : null
  if (!exact) fail(USAGE)
  for (const flag of values.keys()) {
    if (!exact.has(flag)) fail(`flag ${flag} is invalid for mode ${mode}`)
  }
  for (const flag of exact) {
    if (!values.has(flag)) fail(`required flag missing: ${flag}`)
  }
  return {
    mode,
    migration: values.get('--migration')!,
    output: values.get('--output'),
    preflight: values.get('--preflight'),
    evidence: values.get('--evidence'),
  }
}

async function repositoryRoot(): Promise<string> {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
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

function command(executable: string, args: string[], cwd: string): string {
  return execFileSync(executable, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  }).trim()
}

function commandCombined(executable: string, args: string[], cwd: string): string {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) fail(`command failed with exit ${String(result.status)}`)
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
}

function extractRemoteVersions(output: string): string[] {
  let payload: Json
  try {
    payload = JSON.parse(output) as Json
  } catch {
    fail('CLI migration list is not JSON')
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    fail('CLI migration list is malformed')
  }
  const migrations = (payload as JsonRecord).migrations
  if (!Array.isArray(migrations)) fail('CLI migration list is malformed')
  return [
    ...new Set(
      migrations
        .filter(
          (item): item is JsonRecord =>
            Boolean(item) && typeof item === 'object' && !Array.isArray(item),
        )
        .map((item) => item.remote)
        .filter(
          (version): version is string =>
            typeof version === 'string' && /^\d{4}$/.test(version),
        ),
    ),
  ].sort()
}

function requireMigrationContract(migration: string): void {
  const normalized = normalizedSql(migration)
  for (const item of [
    'create function public.delete_tracker_application(p_application_id uuid)',
    'returns boolean',
    'security definer',
    "set search_path = ''",
    'owner_id uuid := (select auth.uid())',
    'delete from public.applications as application',
    'application.id = p_application_id',
    'application.user_id = owner_id',
    'changed <> 1',
    'application_not_found',
    'revoke all on function public.delete_tracker_application(uuid) from public,anon,authenticated',
    'grant execute on function public.delete_tracker_application(uuid) to authenticated',
    'alter function public.delete_tracker_application(uuid) owner to postgres',
  ]) {
    if (!normalized.includes(normalizedSql(item))) {
      fail(`delete migration contract missing: ${item}`)
    }
  }
  if (/public\.user_jobs|applied_at\s*=/i.test(migration)) {
    fail('delete migration mutates irreversible applied history')
  }
}

async function managementSql(projectRef: string, query: string): Promise<JsonRecord[]> {
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
  return payload.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      fail('Management API returned a malformed row')
    }
    return item as JsonRecord
  })
}

function preflightJson(markdown: string): JsonRecord {
  const match = markdown.match(
    new RegExp(`<!-- ${PREFLIGHT_MARKER}\\n([\\s\\S]*?)\\n${PREFLIGHT_MARKER} -->`),
  )
  if (!match) fail('delete preflight machine contract is missing')
  const parsed = JSON.parse(match[1]) as Json
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('delete preflight machine contract is malformed')
  }
  return parsed as JsonRecord
}

function stringField(row: JsonRecord, field: string): string {
  const value = row[field]
  if (typeof value !== 'string') fail(`${field} is malformed`)
  return value
}

function booleanField(row: JsonRecord, field: string): boolean {
  const value = row[field]
  if (typeof value !== 'boolean') fail(`${field} is malformed`)
  return value
}

function assertHash(value: Json, field: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) fail(`${field} drifted`)
  return value
}

async function runPreflight(args: ReturnType<typeof parseArgs>): Promise<void> {
  const root = await repositoryRoot()
  const migrationPath = await checkedPath(root, args.migration)
  const outputPath = await checkedPath(root, args.output!)
  if (!migrationPath.endsWith(`/supabase/migrations/${MIGRATION_NAME}`)) {
    fail(`migration must be supabase/migrations/${MIGRATION_NAME}`)
  }
  requireMigrationContract(await readFile(migrationPath, 'utf8'))
  const projectRef = (
    await readFile(resolve(root, 'supabase/.temp/project-ref'), 'utf8')
  ).trim()
  if (!/^[a-z0-9]{20}$/.test(projectRef)) fail('linked project reference is malformed')
  if (!process.env.SUPABASE_ACCESS_TOKEN?.trim()) {
    fail('SUPABASE_ACCESS_TOKEN is required')
  }
  const cliPath = resolve(root, 'web/node_modules/.bin/supabase')
  await access(cliPath)
  const migrationList = command(cliPath, ['migration', 'list', '--linked'], root)
  const remoteVersions = extractRemoteVersions(migrationList)
  if (remoteVersions.at(-1) !== '0055' || remoteVersions.includes('0056')) {
    fail('linked migration inventory must end at 0055 with 0056 absent')
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
  const artifacts = {
    migration_sha256: await fileSha(migrationPath),
    verifier_sha256: await fileSha(resolve(root, 'scripts/verify-tracker-delete.ts')),
    verifier_test_sha256: await fileSha(
      resolve(root, 'web/tests/verify-tracker-delete.test.ts'),
    ),
    migration_test_sha256: await fileSha(
      resolve(root, 'web/tests/migration-0056-delete-tracker-application.test.ts'),
    ),
  }
  const sourceCommit = command('git', ['rev-parse', 'HEAD'], root)
  const machine: JsonRecord = {
    status: 'PASS',
    created_at: new Date().toISOString(),
    project_ref: projectRef,
    source_commit: sourceCommit,
    migration: `supabase/migrations/${MIGRATION_NAME}`,
    sole_pending_migration: MIGRATION_NAME,
    remote_migration_versions: remoteVersions,
    dry_run_sha256: sha256(dryRun),
    ...artifacts,
  }
  const approvalSignal =
    `approve Phase 04 tracker application delete push ` +
    `target=${projectRef} source_commit=${sourceCommit} ` +
    `migration_sha256=${artifacts.migration_sha256} ` +
    `verifier_sha256=${artifacts.verifier_sha256} ` +
    `verifier_test_sha256=${artifacts.verifier_test_sha256} ` +
    `migration_test_sha256=${artifacts.migration_test_sha256} ` +
    `dry_run_sha256=${String(machine.dry_run_sha256)}`
  machine.approval_signal = approvalSignal
  const markdown = `# Phase 04 Application Delete Preflight

**Status:** PASS — read-only inventory complete; production unchanged.

- Target: \`${projectRef}\`
- Source commit: \`${sourceCommit}\`
- Sole pending migration: \`${MIGRATION_NAME}\`
- Migration SHA-256: \`${artifacts.migration_sha256}\`
- Verifier SHA-256: \`${artifacts.verifier_sha256}\`
- Verifier test SHA-256: \`${artifacts.verifier_test_sha256}\`
- Migration test SHA-256: \`${artifacts.migration_test_sha256}\`
- Dry-run SHA-256: \`${String(machine.dry_run_sha256)}\`

The migration adds one authenticated, owner-scoped
\`delete_tracker_application(uuid)\` RPC. It deletes the owned Tracker
aggregate through the existing event cascade and does not mutate
\`user_jobs.applied_at\`, jobs, resumes, providers, or real-user content.

## Exact approval signal

\`${approvalSignal}\`

<!-- ${PREFLIGHT_MARKER}
${JSON.stringify(machine, null, 2)}
${PREFLIGHT_MARKER} -->
`
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, markdown, { encoding: 'utf8', mode: 0o600 })
  process.stdout.write(`${JSON.stringify({
    status: 'PASS',
    target: projectRef,
    source_commit: sourceCommit,
    sole_pending: MIGRATION_NAME,
    approval_signal: approvalSignal,
    output: relative(root, outputPath),
  })}\n`)
}

async function runHosted(args: ReturnType<typeof parseArgs>): Promise<void> {
  const root = await repositoryRoot()
  const migrationPath = await checkedPath(root, args.migration)
  const preflightPath = await checkedPath(root, args.preflight!)
  const evidencePath = await checkedPath(root, args.evidence!)
  requireMigrationContract(await readFile(migrationPath, 'utf8'))
  const approved = preflightJson(await readFile(preflightPath, 'utf8'))
  if (approved.status !== 'PASS') fail('delete preflight status is not PASS')
  const current = {
    source_commit: command('git', ['rev-parse', 'HEAD'], root),
    migration_sha256: await fileSha(migrationPath),
    verifier_sha256: await fileSha(resolve(root, 'scripts/verify-tracker-delete.ts')),
    verifier_test_sha256: await fileSha(
      resolve(root, 'web/tests/verify-tracker-delete.test.ts'),
    ),
    migration_test_sha256: await fileSha(
      resolve(root, 'web/tests/migration-0056-delete-tracker-application.test.ts'),
    ),
  }
  for (const [field, value] of Object.entries(current)) {
    if (approved[field] !== value) fail(`approval-bound ${field} drifted`)
  }
  assertHash(approved.dry_run_sha256, 'dry_run_sha256')
  const projectRef = stringField(approved, 'project_ref')
  const linkedRef = (
    await readFile(resolve(root, 'supabase/.temp/project-ref'), 'utf8')
  ).trim()
  if (linkedRef !== projectRef) fail('linked project target drifted')
  const rows = await managementSql(
    projectRef,
    `
      select
        exists (
          select 1
          from supabase_migrations.schema_migrations
          where version = '0056'
        ) as migration_present,
        pg_catalog.pg_get_userbyid(p.proowner) = 'postgres' as postgres_owner,
        pg_catalog.pg_get_function_result(p.oid) = 'boolean' as boolean_result,
        p.prosecdef as security_definer,
        coalesce(array_to_string(p.proconfig, ','), '') = 'search_path=""'
          as empty_search_path,
        pg_catalog.has_function_privilege(
          'authenticated', 'public.delete_tracker_application(uuid)', 'EXECUTE'
        ) as authenticated_execute,
        pg_catalog.has_function_privilege(
          'anon', 'public.delete_tracker_application(uuid)', 'EXECUTE'
        ) as anon_execute,
        position(
          'application.user_id = owner_id'
          in pg_catalog.pg_get_functiondef(p.oid)
        ) > 0 as owner_predicate,
        position(
          'delete from public.applications'
          in lower(pg_catalog.pg_get_functiondef(p.oid))
        ) > 0 as deletes_application,
        position(
          'user_jobs'
          in lower(pg_catalog.pg_get_functiondef(p.oid))
        ) = 0 as preserves_user_jobs,
        encode(
          extensions.digest(pg_catalog.pg_get_functiondef(p.oid), 'sha256'),
          'hex'
        ) as definition_sha256
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'delete_tracker_application'
        and pg_catalog.oidvectortypes(p.proargtypes) = 'uuid';
    `,
  )
  if (rows.length !== 1) fail('hosted delete RPC catalog row is absent or ambiguous')
  const catalog = rows[0]
  for (const field of [
    'migration_present',
    'postgres_owner',
    'boolean_result',
    'security_definer',
    'empty_search_path',
    'authenticated_execute',
    'owner_predicate',
    'deletes_application',
    'preserves_user_jobs',
  ]) {
    if (!booleanField(catalog, field)) fail(`hosted delete RPC contract drifted: ${field}`)
  }
  if (booleanField(catalog, 'anon_execute')) {
    fail('hosted delete RPC is executable by anon or PUBLIC')
  }
  const evidence: JsonRecord = {
    status: 'PASS',
    checked_at: new Date().toISOString(),
    target: projectRef,
    source_commit: current.source_commit,
    migration_version: '0056',
    migration_sha256: current.migration_sha256,
    verifier_sha256: current.verifier_sha256,
    verifier_test_sha256: current.verifier_test_sha256,
    migration_test_sha256: current.migration_test_sha256,
    definition_sha256: assertHash(catalog.definition_sha256, 'definition_sha256'),
    migration_present: true,
    postgres_owner: true,
    boolean_result: true,
    security_definer: true,
    empty_search_path: true,
    authenticated_execute: true,
    anon_execute: false,
    owner_predicate: true,
    deletes_application: true,
    preserves_user_jobs: true,
  }
  await mkdir(dirname(evidencePath), { recursive: true })
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  process.stdout.write(`${JSON.stringify({
    status: 'PASS',
    target: projectRef,
    migration_version: '0056',
    evidence: relative(root, evidencePath),
  })}\n`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.mode === 'preflight') await runPreflight(args)
  else await runHosted(args)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'unknown verifier failure'
  process.stderr.write(`tracker delete verification failed: ${message}\n`)
  process.exitCode = 1
})

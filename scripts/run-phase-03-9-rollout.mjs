#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SUPABASE_CLI = resolve(ROOT, 'web/node_modules/.bin/supabase')
export const RELEASE_MANIFEST_ID = '03900000-0000-4000-8000-000000000001'
export const REPAIR_MANIFEST_ID = '03900000-0000-4000-8000-000000000002'
export const CATALOG_REPAIR_MANIFEST_ID =
  '03900000-0000-4000-8000-000000000003'
export const PHASE_DIR =
  '.planning/phases/03.9-jpmorgan-chase-selective-oracle-monitoring'
export const DEFAULT_MANIFEST = `${PHASE_DIR}/03.9-01-RELEASE-MANIFEST.json`

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonical(value[key])}`,
    ).join(',')}}`
  }
  return JSON.stringify(value)
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message)
}

async function fileHash(path) {
  return sha256(await readFile(resolve(ROOT, path)))
}

export async function validateManifest(manifest, manifestBytes) {
  requireCondition(manifest.schema_version === 1 && manifest.phase === '03.9',
    'manifest version/phase drift')
  const isInitial = manifest.release_manifest_id === RELEASE_MANIFEST_ID
  const isRepair = manifest.release_manifest_id === REPAIR_MANIFEST_ID
  const isCatalogRepair =
    manifest.release_manifest_id === CATALOG_REPAIR_MANIFEST_ID
  requireCondition(isInitial || isRepair || isCatalogRepair,
    'release manifest ID drift')
  requireCondition(manifest.source_key === 'oracle:jpmc:CX_1001',
    'source identity drift')
  requireCondition(manifest.site_number === 'CX_1001',
    'site identity drift')
  requireCondition(
    manifest.migration?.version === (isCatalogRepair ? '0046' : '0045'),
    'migration version drift')
  requireCondition(
    manifest.migration.path === (isCatalogRepair
      ? 'supabase/migrations/0046_phase_03_9_jpmorgan_catalog_repair.sql'
      : 'supabase/migrations/0045_phase_03_9_jpmorgan_oracle.sql'),
    'migration path drift',
  )
  requireCondition(
    await fileHash(manifest.migration.path) === manifest.migration.sha256,
    'migration hash drift',
  )
  requireCondition(
    Object.keys(manifest.functions ?? {}).sort().join(',') ===
      'observe-connectors,poll-tick',
    'function inventory drift',
  )
  for (const [slug, entry] of Object.entries(manifest.functions)) {
    const files = [...entry.bundle_files].sort()
    const hashes = []
    for (const path of files) hashes.push([path, await fileHash(path)])
    requireCondition(
      sha256(canonical(hashes)) === entry.bundle_sha256,
      `${slug} bundle hash drift`,
    )
    requireCondition(
      await fileHash(entry.entry_path) === entry.entry_sha256,
      `${slug} entry hash drift`,
    )
  }
  if (isInitial) {
    requireCondition(
      manifest.approved_actions.join(',') ===
        'db_push_0045,deploy_observe-connectors,deploy_poll-tick,observe_three_windows,natural_poll,owner_browser_uat',
      'approved action inventory drift',
    )
  } else if (isRepair) {
    requireCondition(
      manifest.supersedes_release_manifest_id === RELEASE_MANIFEST_ID
        && manifest.hosted_baseline?.last_migration === '0045'
        && manifest.hosted_baseline?.migration_count === 45,
      'repair baseline drift',
    )
    requireCondition(
      manifest.approved_actions.join(',') ===
        'deploy_observe-connectors,deploy_poll-tick,live_probe,observe_three_windows,natural_poll,owner_browser_uat',
      'repair action inventory drift',
    )
  } else {
    requireCondition(
      manifest.supersedes_release_manifest_id === REPAIR_MANIFEST_ID
        && manifest.hosted_baseline?.last_migration === '0045'
        && manifest.hosted_baseline?.migration_count === 45
        && manifest.hosted_baseline?.jpmorgan_company_rows === 0
        && manifest.hosted_baseline?.jpmorgan_observation_rows === 0
        && manifest.hosted_baseline?.jpmorgan_unsupported_terminal_rows === 4,
      'catalog repair baseline drift',
    )
    requireCondition(
      manifest.approved_actions.join(',') ===
        'db_push_0046,live_probe,terminal_admission,observe_three_windows,natural_poll,owner_browser_uat',
      'catalog repair action inventory drift',
    )
  }
  return {
    manifest_file_sha256: sha256(manifestBytes),
    migration_sha256: manifest.migration.sha256,
    observe_sha256: manifest.functions['observe-connectors'].bundle_sha256,
    poll_sha256: manifest.functions['poll-tick'].bundle_sha256,
  }
}

export function exactApproval(manifest, hashes) {
  if (manifest.release_manifest_id === CATALOG_REPAIR_MANIFEST_ID) {
    return [
      'approve Phase 03.9 JPMorgan catalog repair',
      manifest.release_manifest_id,
      hashes.manifest_file_sha256,
      hashes.migration_sha256,
      hashes.observe_sha256,
      hashes.poll_sha256,
    ].join(' ')
  }
  if (manifest.release_manifest_id === REPAIR_MANIFEST_ID) {
    return [
      'approve Phase 03.9 JPMorgan function repair',
      manifest.release_manifest_id,
      hashes.manifest_file_sha256,
      hashes.observe_sha256,
      hashes.poll_sha256,
    ].join(' ')
  }
  return [
    'approve Phase 03.9 JPMorgan rollout',
    manifest.release_manifest_id,
    hashes.manifest_file_sha256,
    hashes.migration_sha256,
    hashes.observe_sha256,
    hashes.poll_sha256,
  ].join(' ')
}

export function dryRunPlan(manifest, hashes) {
  return {
    status: 'PENDING_EXPLICIT_APPROVAL',
    release_manifest_id: manifest.release_manifest_id,
    source_key: manifest.source_key,
    source_commit: manifest.source_commit,
    hosted_baseline: manifest.hosted_baseline,
    actions: manifest.approved_actions,
    required_approval: exactApproval(manifest, hashes),
  }
}

function parseArgs(argv) {
  const result = { mode: 'dry-run', manifest: DEFAULT_MANIFEST, approval: null }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--dry-run') result.mode = 'dry-run'
    else if (argv[index] === '--manifest') result.manifest = argv[++index]
    else if (argv[index] === '--approve') {
      result.mode = 'execute'
      result.approval = argv[++index]
    } else throw new Error(`unknown argument: ${argv[index]}`)
  }
  return result
}

async function runSupabase(args) {
  return execFile(SUPABASE_CLI, args, {
    cwd: ROOT,
    env: process.env,
    maxBuffer: 10_000_000,
  })
}

export async function executeRelease(manifest, approval, hashes, run = runSupabase) {
  requireCondition(approval === exactApproval(manifest, hashes),
    'execution requires the exact manifest/hash-bound approval string')
  if (
    manifest.release_manifest_id === RELEASE_MANIFEST_ID
    || manifest.release_manifest_id === CATALOG_REPAIR_MANIFEST_ID
  ) {
    await run(['db', 'push', '--linked', '--yes'])
  }
  const deployFunctions =
    manifest.release_manifest_id !== CATALOG_REPAIR_MANIFEST_ID
  for (const slug of deployFunctions
    ? ['observe-connectors', 'poll-tick']
    : []) {
    const entry = manifest.functions[slug]
    await run([
      'functions', 'deploy', slug,
      '--project-ref', manifest.project_ref,
      entry.verify_jwt ? '--verify-jwt' : '--no-verify-jwt',
      ...(manifest.release_manifest_id === REPAIR_MANIFEST_ID
        ? ['--use-api']
        : []),
    ])
  }
  return {
    status: 'DEPLOYED_PENDING_ACTIVATION',
    release_manifest_id: manifest.release_manifest_id,
    source_key: manifest.source_key,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const manifestPath = resolve(ROOT, args.manifest)
  const manifestBytes = await readFile(manifestPath)
  const manifest = JSON.parse(manifestBytes)
  const hashes = await validateManifest(manifest, manifestBytes)
  const result = args.mode === 'dry-run'
    ? dryRunPlan(manifest, hashes)
    : await executeRelease(manifest, args.approval, hashes)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}

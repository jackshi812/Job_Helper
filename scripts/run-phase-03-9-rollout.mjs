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
export const IDENTITY_REPAIR_MANIFEST_ID =
  '03900000-0000-4000-8000-000000000004'
export const PHASE_DIR =
  '.planning/phases/03.9-jpmorgan-chase-selective-oracle-monitoring'
export const DEFAULT_MANIFEST = `${PHASE_DIR}/03.9-01-RELEASE-MANIFEST.json`
export const DEFAULT_EVIDENCE =
  `${PHASE_DIR}/03.9-01-ROLLOUT-VERIFICATION.json`
export const MANIFEST_CHAIN_PATHS = Object.freeze([
  `${PHASE_DIR}/03.9-01-RELEASE-MANIFEST.json`,
  `${PHASE_DIR}/03.9-02-REPAIR-MANIFEST.json`,
  `${PHASE_DIR}/03.9-03-CATALOG-REPAIR-MANIFEST.json`,
  `${PHASE_DIR}/03.9-04-IDENTITY-REPAIR-MANIFEST.json`,
])

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

async function gitObject(commit, path = null) {
  requireCondition(/^[0-9a-f]{40}$/.test(commit), 'source commit drift')
  const args = path
    ? ['show', `${commit}:${path}`]
    : ['cat-file', 'commit', commit]
  const { stdout } = await execFile('git', args, {
    cwd: ROOT,
    encoding: 'buffer',
    maxBuffer: 10_000_000,
  })
  return stdout
}

async function historicalFileHash(commit, path) {
  return sha256(await gitObject(commit, path))
}

export async function validateManifest(
  manifest,
  manifestBytes,
  { filesAtSourceCommit = false } = {},
) {
  requireCondition(manifest.schema_version === 1 && manifest.phase === '03.9',
    'manifest version/phase drift')
  const isInitial = manifest.release_manifest_id === RELEASE_MANIFEST_ID
  const isRepair = manifest.release_manifest_id === REPAIR_MANIFEST_ID
  const isCatalogRepair =
    manifest.release_manifest_id === CATALOG_REPAIR_MANIFEST_ID
  const isIdentityRepair =
    manifest.release_manifest_id === IDENTITY_REPAIR_MANIFEST_ID
  requireCondition(isInitial || isRepair || isCatalogRepair || isIdentityRepair,
    'release manifest ID drift')
  requireCondition(manifest.source_key === 'oracle:jpmc:CX_1001',
    'source identity drift')
  requireCondition(manifest.site_number === 'CX_1001',
    'site identity drift')
  requireCondition(
    sha256(await gitObject(manifest.source_commit))
      === manifest.source_commit_object_sha256,
    'source commit object drift',
  )
  const hashFile = filesAtSourceCommit
    ? (path) => historicalFileHash(manifest.source_commit, path)
    : fileHash
  requireCondition(
    manifest.migration?.version === (
      isIdentityRepair ? '0047' : isCatalogRepair ? '0046' : '0045'
    ),
    'migration version drift')
  requireCondition(
    manifest.migration.path === (
      isIdentityRepair
        ? 'supabase/migrations/0047_phase_03_9_jpmorgan_company_identity.sql'
        : isCatalogRepair
          ? 'supabase/migrations/0046_phase_03_9_jpmorgan_catalog_repair.sql'
          : 'supabase/migrations/0045_phase_03_9_jpmorgan_oracle.sql'
    ),
    'migration path drift',
  )
  requireCondition(
    await hashFile(manifest.migration.path) === manifest.migration.sha256,
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
    for (const path of files) hashes.push([path, await hashFile(path)])
    requireCondition(
      sha256(canonical(hashes)) === entry.bundle_sha256,
      `${slug} bundle hash drift`,
    )
    requireCondition(
      await hashFile(entry.entry_path) === entry.entry_sha256,
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
  } else if (isCatalogRepair) {
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
  } else {
    requireCondition(
      manifest.supersedes_release_manifest_id === CATALOG_REPAIR_MANIFEST_ID
        && manifest.hosted_baseline?.last_migration === '0046'
        && manifest.hosted_baseline?.migration_count === 46
        && manifest.hosted_baseline?.jpmorgan_company_rows === 0
        && manifest.hosted_baseline?.jpmorgan_observation_rows === 0
        && manifest.hosted_baseline?.jpmorgan_unsupported_terminal_rows === 4,
      'identity repair baseline drift',
    )
    requireCondition(
      manifest.approved_actions.join(',') ===
        'db_push_0047,live_probe,terminal_admission,observe_three_windows,natural_poll,owner_browser_uat',
      'identity repair action inventory drift',
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
  if (manifest.release_manifest_id === IDENTITY_REPAIR_MANIFEST_ID) {
    return [
      'approve Phase 03.9 JPMorgan identity repair',
      manifest.release_manifest_id,
      hashes.manifest_file_sha256,
      hashes.migration_sha256,
      hashes.observe_sha256,
      hashes.poll_sha256,
    ].join(' ')
  }
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

function exactKeys(value, keys, label) {
  requireCondition(value && typeof value === 'object' && !Array.isArray(value),
    `${label} must be an object`)
  requireCondition(
    canonical(Object.keys(value).sort()) === canonical([...keys].sort()),
    `${label} keys are not exact`,
  )
}

export function assertRolloutEvidence(evidence, manifests) {
  exactKeys(evidence, [
    'schema_version',
    'phase',
    'release_manifest_id',
    'status',
    'completed_at',
    'approved_release_chain',
    'source',
    'live_probe',
    'terminal_admission',
    'activation',
    'natural_poll',
    'persisted_job_sample',
    'closure_guard',
    'protected_sources',
    'cleanup',
    'automated_verification',
    'owner_browser_uat',
  ], 'rollout evidence')
  requireCondition(
    evidence.schema_version === 1
      && evidence.phase === '03.9'
      && evidence.status === 'PASS'
      && evidence.release_manifest_id === IDENTITY_REPAIR_MANIFEST_ID,
    'rollout evidence release binding failed',
  )
  requireCondition(
    Array.isArray(manifests) && manifests.length === MANIFEST_CHAIN_PATHS.length,
    'complete manifest chain is required',
  )
  const manifestIds = manifests.map(({ release_manifest_id: id }) => id)
  const expectedIds = [
    RELEASE_MANIFEST_ID,
    REPAIR_MANIFEST_ID,
    CATALOG_REPAIR_MANIFEST_ID,
    IDENTITY_REPAIR_MANIFEST_ID,
  ]
  requireCondition(
    canonical(manifestIds) === canonical(expectedIds)
      && canonical(evidence.approved_release_chain.map(
        ({ release_manifest_id: id }) => id,
      )) === canonical(expectedIds),
    'approved release chain drift',
  )
  for (const [index, item] of evidence.approved_release_chain.entries()) {
    exactKeys(item, ['release_manifest_id', 'action'],
      `approved release chain item ${index + 1}`)
    requireCondition(
      typeof item.action === 'string' && item.action.trim().length > 0,
      'approved release chain action is invalid',
    )
  }
  requireCondition(
    evidence.source?.source_key === 'oracle:jpmc:CX_1001'
      && evidence.source?.site_number === 'CX_1001'
      && evidence.source?.country === 'United States'
      && evidence.source?.posting_date_facet === '7'
      && Array.isArray(evidence.source?.title_families)
      && evidence.source.title_families.length === 6,
    'source evidence drift',
  )
  requireCondition(
    evidence.live_probe?.status === 'PASS'
      && Number.isSafeInteger(evidence.live_probe.deduplicated_job_count)
      && evidence.live_probe.deduplicated_job_count > 0
      && evidence.live_probe.deduplicated_job_count
        === evidence.live_probe.expected_job_count
      && evidence.live_probe.warning_count === 0
      && evidence.live_probe.allow_missing_closure === false,
    'live probe evidence failed',
  )
  requireCondition(
    evidence.terminal_admission?.status === 'PASS'
      && evidence.activation?.status === 'PASS'
      && evidence.activation.accepted_observations === 3
      && evidence.activation.required_observations === 3
      && evidence.activation.final_state === 'active'
      && evidence.activation.replay_guard === 'PASS'
      && evidence.activation.same_window_guard === 'PASS'
      && evidence.activation.stored_observation_count === 3,
    'activation evidence failed',
  )
  requireCondition(
    evidence.natural_poll?.status === 'PASS'
      && Number.isSafeInteger(evidence.natural_poll.open_job_count)
      && evidence.natural_poll.open_job_count > 0
      && evidence.natural_poll.last_error_code === null,
    'natural poll evidence failed',
  )
  requireCondition(
    evidence.persisted_job_sample?.source_key === 'oracle:jpmc:CX_1001'
      && evidence.persisted_job_sample?.country_evidence === 'United States'
      && evidence.persisted_job_sample?.description_present === true
      && evidence.persisted_job_sample?.snapshot_partial === false
      && evidence.persisted_job_sample?.status === 'open'
      && evidence.persisted_job_sample?.closed_at === null,
    'persisted job evidence failed',
  )
  requireCondition(
    evidence.closure_guard?.status === 'PASS'
      && evidence.closure_guard.allow_missing_closure === false
      && evidence.closure_guard.absence_closed_count === 0
      && evidence.protected_sources?.status === 'PASS'
      && evidence.protected_sources.unchanged_except_scheduler_owned_timestamps
        === true,
    'closure or protected-source evidence failed',
  )
  requireCondition(
    evidence.cleanup?.status === 'PASS'
      && evidence.cleanup.temporary_fixture_count === 0
      && evidence.cleanup.verifier_residue_count === 0
      && evidence.cleanup.scheduler_override_count === 0,
    'cleanup evidence failed',
  )
  requireCondition(
    Number.isSafeInteger(evidence.automated_verification?.tests_passed)
      && evidence.automated_verification.tests_passed > 0
      && evidence.automated_verification.tests_failed === 0
      && evidence.automated_verification.production_build === 'PASS',
    'automated verification evidence failed',
  )
  return evidence
}

function parseArgs(argv) {
  const result = {
    mode: 'dry-run',
    manifest: DEFAULT_MANIFEST,
    evidence: DEFAULT_EVIDENCE,
    approval: null,
  }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--dry-run') result.mode = 'dry-run'
    else if (argv[index] === '--assert-evidence') {
      result.mode = 'assert-evidence'
      result.evidence = argv[++index]
    }
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
    || manifest.release_manifest_id === IDENTITY_REPAIR_MANIFEST_ID
  ) {
    await run(['db', 'push', '--linked', '--yes'])
  }
  const deployFunctions = ![
    CATALOG_REPAIR_MANIFEST_ID,
    IDENTITY_REPAIR_MANIFEST_ID,
  ].includes(manifest.release_manifest_id)
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
  if (args.mode === 'assert-evidence') {
    const manifests = []
    for (const path of MANIFEST_CHAIN_PATHS) {
      const bytes = await readFile(resolve(ROOT, path))
      const manifest = JSON.parse(bytes)
      await validateManifest(manifest, bytes, { filesAtSourceCommit: true })
      manifests.push(manifest)
    }
    const selectedManifest = JSON.parse(
      await readFile(resolve(ROOT, args.manifest)),
    )
    requireCondition(
      manifests.some(({ release_manifest_id: id }) =>
        id === selectedManifest.release_manifest_id),
      'selected manifest is not in the approved release chain',
    )
    const evidence = JSON.parse(
      await readFile(resolve(ROOT, args.evidence)),
    )
    assertRolloutEvidence(evidence, manifests)
    process.stdout.write(
      `PASS: ${args.evidence} is exact Phase 03.9 rollout evidence\n`,
    )
    return
  }
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

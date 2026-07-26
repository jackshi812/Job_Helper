#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import {
  FAMILY_ORDER,
  ManagementSqlOps,
  directProbe,
  requireConsumedVerifierState,
} from './run-phase-03-8-rollout.mjs'
import { bundleManifest } from './verify-phase-03-8-hosted.mjs'

const execFile = promisify(execFileCallback)
const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PHASE_DIR = resolve(
  SCRIPT_ROOT,
  '.planning/phases/03.8-monitor-and-poll-the-branded-banking-companies-currently-on-',
)
const DEFAULT_MANIFEST = resolve(PHASE_DIR, '03.8-08-RELEASE-MANIFEST.json')
const DEFAULT_OUTPUT = resolve(PHASE_DIR, '03.8-08-ROLLOUT-EVIDENCE.json')
const SHA256 = /^[0-9a-f]{64}$/
const COMMIT = /^[0-9a-f]{40}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const FAMILY_CEILING_MS = 20 * 60_000
const EXPECTED_MIGRATIONS = Array.from(
  { length: 43 },
  (_, index) => String(index + 1).padStart(4, '0'),
)
const FUNCTION_ORDER = Object.freeze([
  'verify-board',
  'observe-connectors',
  'poll-tick',
])

function requireCondition(condition, message) {
  if (!condition) throw new Error(message)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonical(value[key])}`,
    ).join(',')}}`
  }
  return JSON.stringify(value)
}

function boundedText(value, limit = 240) {
  return String(value ?? '').replaceAll(/\s+/g, ' ').slice(0, limit)
}

function validateManifest(manifest) {
  requireCondition(manifest?.schema_version === 1, 'manifest schema is invalid')
  requireCondition(manifest.phase === '03.8', 'manifest phase is invalid')
  requireCondition(UUID.test(manifest.release_manifest_id), 'manifest id is invalid')
  requireCondition(manifest.project_ref === 'fjcsvajkkztvlrpdplwx',
    'project ref is invalid')
  requireCondition(COMMIT.test(manifest.accepted_production_source),
    'accepted production source is invalid')
  requireCondition(COMMIT.test(manifest.candidate?.git_sha)
    && SHA256.test(manifest.candidate?.commit_object_sha256)
    && typeof manifest.candidate?.worktree_path === 'string'
    && Array.isArray(manifest.candidate?.changed_files),
  'candidate identity is invalid')
  requireCondition(canonical(manifest.migrations) === canonical(EXPECTED_MIGRATIONS),
    'hosted migration inventory is invalid')
  requireCondition(canonical(Object.keys(manifest.functions ?? {}).sort())
    === canonical([...FUNCTION_ORDER].sort()), 'function inventory is invalid')
  for (const slug of FUNCTION_ORDER) {
    const entry = manifest.functions[slug]
    requireCondition(typeof entry.entry_path === 'string'
      && SHA256.test(entry.entry_sha256)
      && SHA256.test(entry.bundle_manifest_sha256)
      && UUID.test(entry.hosted_baseline?.id)
      && Number.isInteger(entry.hosted_baseline?.version)
      && entry.hosted_baseline.version > 0
      && typeof entry.hosted_baseline.verify_jwt === 'boolean'
      && [0, 1].includes(entry.deploy_increment ?? 1),
    `${slug} manifest identity is invalid`)
  }
  requireCondition(Array.isArray(manifest.verifier?.fixtures)
    && manifest.verifier.fixtures.length === 3,
  'consumed verifier fixture inventory is invalid')
  requireCondition(canonical(manifest.families)
    === canonical(FAMILY_ORDER.map((family) => family.sourceKey)),
  'family inventory is invalid')
  return manifest
}

export function exactSelectiveApproval(manifest, manifestFileSha256) {
  validateManifest(manifest)
  requireCondition(SHA256.test(manifestFileSha256), 'manifest file hash is invalid')
  return [
    'approve Phase 03.8 selective rollout',
    manifest.release_manifest_id,
    manifestFileSha256,
    manifest.candidate.git_sha,
    ...FUNCTION_ORDER.map(
      (slug) => manifest.functions[slug].bundle_manifest_sha256,
    ),
  ].join(' ')
}

async function commandBytes(cwd, executable, args) {
  const result = await execFile(executable, args, {
    cwd,
    encoding: null,
    maxBuffer: 20 * 1024 * 1024,
  })
  return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout)
}

async function command(cwd, executable, args) {
  return (await execFile(executable, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  })).stdout.trim()
}

export async function assertSelectiveCandidate(manifest) {
  validateManifest(manifest)
  const root = manifest.candidate.worktree_path
  const [commit, status, object, changed] = await Promise.all([
    command(root, 'git', ['rev-parse', 'HEAD']),
    command(root, 'git', ['status', '--porcelain']),
    commandBytes(root, 'git', ['cat-file', 'commit', 'HEAD']),
    command(root, 'git', [
      'diff',
      '--name-only',
      `${manifest.accepted_production_source}..HEAD`,
    ]),
  ])
  requireCondition(commit === manifest.candidate.git_sha,
    'source-only candidate commit drift')
  requireCondition(status === '', 'source-only candidate is not clean')
  requireCondition(sha256(object) === manifest.candidate.commit_object_sha256,
    'source-only candidate commit object drift')
  requireCondition(canonical(changed.split(/\r?\n/).filter(Boolean))
    === canonical(manifest.candidate.changed_files),
  'source-only candidate path inventory drift')
  for (const slug of FUNCTION_ORDER) {
    const expected = manifest.functions[slug]
    const actual = await bundleManifest(root, expected.entry_path)
    requireCondition(actual.sha256 === expected.bundle_manifest_sha256,
    `${slug} transitive bundle drift`)
    requireCondition(actual.entries.find(
      ({ path }) => path === expected.entry_path,
    )?.sha256 === expected.entry_sha256, `${slug} entrypoint drift`)
  }
  return true
}

async function functionInventory(projectRef, accessToken) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/functions`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  )
  requireCondition(response.ok, `function inventory returned HTTP ${response.status}`)
  const payload = await response.json()
  requireCondition(Array.isArray(payload), 'function inventory is malformed')
  return payload
}

export async function assertSelectiveHostedIdentity({
  manifest,
  ops,
  accessToken,
  stage,
  inventory,
}) {
  requireCondition(['predeploy', 'postdeploy'].includes(stage),
    'hosted identity stage is invalid')
  const rows = await ops.query(`
    select coalesce(
      jsonb_agg(version::text order by version),
      '[]'::jsonb
    ) as migrations
    from supabase_migrations.schema_migrations
  `)
  requireCondition(rows.length === 1
    && canonical(rows[0].migrations) === canonical(EXPECTED_MIGRATIONS),
  'hosted migration parity failed')
  const functions = inventory ?? await functionInventory(
    manifest.project_ref,
    accessToken,
  )
  for (const slug of FUNCTION_ORDER) {
    const expected = manifest.functions[slug]
    const hosted = functions.find((item) => item.slug === slug)
    const increment = stage === 'postdeploy'
      ? (expected.deploy_increment ?? 1)
      : 0
    requireCondition(hosted?.status === 'ACTIVE'
      && hosted.id === expected.hosted_baseline.id
      && hosted.version === expected.hosted_baseline.version + increment
      && hosted.verify_jwt === expected.hosted_baseline.verify_jwt,
    `${slug} hosted ${stage} identity failed`)
  }
  return true
}

function freshDigest({ manifest, family, start, probe, nonce }) {
  return sha256(canonical({
    schema_version: 1,
    release_manifest_id: manifest.release_manifest_id,
    source_commit: manifest.candidate.git_sha,
    source_key: family.sourceKey,
    start_kind: start.kind,
    outcome: 'admit_experimental',
    probe_evidence_digest: probe.evidence.evidence_digest,
    attempt_nonce: nonce,
  }))
}

async function runFamily({
  manifest,
  family,
  ops,
  probe,
  now,
  nonce,
}) {
  const deadline = now() + FAMILY_CEILING_MS
  const start = await ops.inspectCandidateStart(family)
  requireCondition(
    ['pending', 'terminal_unsupported', 'experimental', 'active']
      .includes(start?.kind),
    `${family.company} candidate state is ambiguous`,
  )
  const probeResult = await probe(family)
  requireCondition(probeResult?.positive === true,
    `${family.company} selective probe failed: ${probeResult?.reason ?? 'unknown'}`)
  requireCondition(now() <= deadline, `${family.company} probe exceeded ceiling`)
  let terminalEvidenceDigest = start.evidence_digest ?? null
  if (start.kind === 'pending' || start.kind === 'terminal_unsupported') {
    terminalEvidenceDigest = freshDigest({
      manifest,
      family,
      start,
      probe: probeResult,
      nonce: nonce(),
    })
    const finalized = await ops.finalizeCandidate({
      sourceKey: family.sourceKey,
      outcome: 'admit_experimental',
      reason: null,
      evidenceDigest: terminalEvidenceDigest,
    })
    requireCondition(finalized?.accepted === true,
      `${family.company} re-admission was rejected`)
  }
  const terminal = await ops.awaitTerminalFamily({ family, deadline })
  requireCondition(terminal?.status === 'PASS'
    && terminal.outcome === 'active'
    && terminal.activation_successes === 3
    && terminal.eligible_job_count > 0
    && terminal.natural_poll === true,
  `${family.company} did not become actively monitored`)
  return {
    ...terminal,
    start_state: start.kind,
    terminal_evidence_digest: terminalEvidenceDigest,
    probe: probeResult.evidence,
  }
}

export async function executeSelectiveRollout({
  manifest,
  ops,
  probe = directProbe,
  now = () => Date.now(),
  nonce = () => randomUUID(),
}) {
  validateManifest(manifest)
  const consumedBefore = requireConsumedVerifierState(
    await ops.assertConsumedVerifier(manifest),
  )
  const settled = await Promise.allSettled(FAMILY_ORDER.map(
    (family) => runFamily({ manifest, family, ops, probe, now, nonce }),
  ))
  const failures = settled.flatMap((result, index) => (
    result.status === 'rejected'
      ? [`${FAMILY_ORDER[index].company}: ${boundedText(result.reason?.message)}`]
      : []
  ))
  requireCondition(failures.length === 0, failures.join('; '))
  const families = Object.fromEntries(settled.map(
    (result, index) => [FAMILY_ORDER[index].key, result.value],
  ))
  const consumedAfter = requireConsumedVerifierState(
    await ops.assertConsumedVerifier(manifest),
  )
  const cleanup = await ops.assertFinalRollout(
    manifest,
    families,
    consumedAfter,
  )
  requireCondition(cleanup?.status === 'PASS', 'final rollout assertion failed')
  return {
    schema_version: 1,
    phase: '03.8',
    status: 'PASS',
    release_manifest_id: manifest.release_manifest_id,
    source_commit: manifest.candidate.git_sha,
    generated_at: new Date(now()).toISOString(),
    families,
    verifier: {
      before: consumedBefore,
      after: consumedAfter,
    },
    cleanup,
  }
}

async function promoteOutput(path, value) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx',
  })
  await rename(temporary, path)
}

function parseArgs(argv) {
  const result = {
    mode: 'preflight',
    manifest: DEFAULT_MANIFEST,
    output: DEFAULT_OUTPUT,
    approval: null,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--preflight') result.mode = 'preflight'
    else if (value === '--execute') result.mode = 'execute'
    else if (value === '--manifest') result.manifest = resolve(argv[++index])
    else if (value === '--output') result.output = resolve(argv[++index])
    else if (value === '--approve') result.approval = argv[++index]
    else throw new Error(`unknown argument: ${value}`)
  }
  return result
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const manifestBytes = await readFile(args.manifest)
  const manifest = validateManifest(JSON.parse(manifestBytes))
  const manifestFileSha256 = sha256(manifestBytes)
  const approval = exactSelectiveApproval(manifest, manifestFileSha256)
  await assertSelectiveCandidate(manifest)
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim()
  requireCondition(accessToken, 'SUPABASE_ACCESS_TOKEN is required')
  const ops = new ManagementSqlOps({
    projectRef: manifest.project_ref,
    accessToken,
    hosted: { status: 'PASS' },
  })
  if (args.mode === 'preflight') {
    await assertSelectiveHostedIdentity({
      manifest,
      ops,
      accessToken,
      stage: 'predeploy',
    })
    process.stdout.write(`${JSON.stringify({
      status: 'READY_FOR_OWNER_APPROVAL',
      release_manifest_id: manifest.release_manifest_id,
      manifest_file_sha256: manifestFileSha256,
      source_commit: manifest.candidate.git_sha,
      required_approval: approval,
    }, null, 2)}\n`)
    return
  }
  requireCondition(args.approval === approval, 'exact owner approval is required')
  await assertSelectiveHostedIdentity({
    manifest,
    ops,
    accessToken,
    stage: 'postdeploy',
  })
  const result = await executeSelectiveRollout({
    manifest,
    ops,
    probe: (family) => directProbe(family, {
      root: manifest.candidate.worktree_path,
    }),
  })
  await promoteOutput(args.output, {
    ...result,
    manifest_file_sha256: manifestFileSha256,
  })
  process.stdout.write(`PASS: wrote ${args.output}\n`)
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`FAIL: ${boundedText(error?.message ?? error)}\n`)
    process.exitCode = 1
  })
}

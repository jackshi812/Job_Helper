import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  access,
  appendFile,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'
import * as residueCheck from './residue-check.mjs'
import {
  assertRecordMatchesLiveScan,
  buildZeroResidueRecord,
  scanOwnedSurfaces as scanOwnedSurfacesProduction,
} from './residue-check.mjs'
import {
  assertArtifactSchema,
  PHASE_5_REVIEWED_PATHS,
} from './evidence-integrity.mjs'
import { verifyOwnerAuthorization } from './owner-authorization.mjs'
import { sha256Json } from './rights-gate.mjs'

const execFileAsync = promisify(execFile)
const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const PHASE_RELATIVE = '.planning/phases/05-outreach-feasibility-gate'
const BASELINE_RELATIVE = `${PHASE_RELATIVE}/05-EXECUTION-BASELINE.json`
const MATRIX_RELATIVE = `${PHASE_RELATIVE}/05-RIGHTS-MATRIX.json`
const QUALITY_RELATIVE = `${PHASE_RELATIVE}/05-QUALITY-REPORT.json`
const DECISION_RELATIVE = `${PHASE_RELATIVE}/05-DECISION.json`
const RECORD_RELATIVE = `${PHASE_RELATIVE}/05-ZERO-RESIDUE.json`
const RECONCILIATION_RELATIVE =
  `${PHASE_RELATIVE}/05-CONTRACT-RECONCILIATION.json`
const REQUEST_RELATIVE =
  `${PHASE_RELATIVE}/05-OWNER-CHECKPOINT-REQUEST.json`
const RECEIPT_RELATIVE = `${PHASE_RELATIVE}/05-OWNER-CHECKPOINT.json`
const TEST_VERIFICATION_SNAPSHOT = Object.freeze({
  source_head_sha: 'a'.repeat(40),
  controlled_tree_sha256: 'b'.repeat(64),
})
const AUTHORIZATION_REQUEST_RELATIVE =
  `${PHASE_RELATIVE}/05-OWNER-AUTHORIZATION-REQUEST.json`
const AUTHORIZATION_SIGNATURE_RELATIVE =
  `${AUTHORIZATION_REQUEST_RELATIVE}.sig`
const TRUST_ANCHOR_RELATIVE =
  'scripts/outreach-feasibility/trust/owner-trust-anchor.json'
const PUBLIC_KEY_RELATIVE =
  'scripts/outreach-feasibility/trust/phase-05-owner.pub'
const ALLOWED_SIGNERS_RELATIVE =
  'scripts/outreach-feasibility/trust/phase-05-owner.allowed_signers.txt'
const REVIEW_RELATIVE = `${PHASE_RELATIVE}/05-REVIEW.md`
const PLAN_RELATIVE = `${PHASE_RELATIVE}/05-01-PLAN.md`
const PLAN_19_RELATIVE = `${PHASE_RELATIVE}/05-19-PLAN.md`
const SUMMARY_19_RELATIVE = `${PHASE_RELATIVE}/05-19-SUMMARY.md`
const RIGHTS_SOURCE =
  'scripts/outreach-feasibility/rights-gate.mjs'
const SCRIPT_PATH = fileURLToPath(
  new URL('./residue-check.mjs', import.meta.url),
)
const DECISION_SCRIPT_PATH = fileURLToPath(
  new URL('./decision-evidence.mjs', import.meta.url),
)
const SOURCE_SECRET = 'tvly-synthetic-residue-token-1234567890'
const PRIOR_REVIEW_COMMIT =
  '357d9d02bcc1e4d4bb4b49781f24ae50ff88d1ad'
const PRIOR_REVIEW_SHA256 =
  '8ef26b90728bc388339c07294ffe819d7e8a6d58cd6377a8f11705f14bc8b752'
const PROVIDER_PAYLOAD = {
  results: [{
    name: 'Synthetic Person',
    title: 'Synthetic Title',
    url: 'https://example.invalid/synthetic-profile',
    content: 'Synthetic provider content',
  }],
}
const AUTHORIZATION_VERIFIED_AT = new Date('2026-07-31T12:00:00.000Z')

function testRunnerResult(snapshot, overrides = {}) {
  return residueCheck.normalizePhase5OfflineRunnerResult({
    ...snapshot,
    test_file_blobs_sha256: 'c'.repeat(64),
    test_outcomes_sha256: 'd'.repeat(64),
    exit: 0,
    tests: residueCheck.PHASE_5_OFFLINE_TEST_COUNT,
    suites: 0,
    pass: residueCheck.PHASE_5_OFFLINE_TEST_COUNT,
    fail: 0,
    cancelled: 0,
    skipped: 0,
    todo: 0,
    ...overrides,
  })
}

async function testVerificationRunner(options) {
  return testRunnerResult({
    source_head_sha: options.source_head_sha,
    controlled_tree_sha256: options.controlled_tree_sha256,
  })
}

async function scanOwnedSurfaces(options) {
  return scanOwnedSurfacesProduction({
    ...options,
    verificationRunner: testVerificationRunner,
  })
}

function assertVerificationDocument(
  text,
  status,
  snapshot = null,
  repoRoot = null,
) {
  return residueCheck.assertCompleteVerificationDocument(
    text,
    status,
    snapshot,
    repoRoot,
    status === 'passed'
      ? testVerificationRunner
      : undefined,
  )
}

function testEnv() {
  const env = {
    PATH: process.env.PATH ?? '',
    LANG: 'C',
    LC_ALL: 'C',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_OPTIONAL_LOCKS: '0',
  }
  return env
}

async function git(repoRoot, args, options = {}) {
  return execFileAsync('git', args, {
    cwd: repoRoot,
    encoding: options.encoding ?? 'utf8',
    env: testEnv(),
    maxBuffer: 20_000_000,
  })
}

async function ownerPathSnapshot(repoRoot, relativePaths) {
  const { stdout: porcelain } = await git(
    repoRoot,
    [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
      '--',
      ...relativePaths,
    ],
    { encoding: 'buffer' },
  )
  const files = []
  for (const relativePath of relativePaths) {
    try {
      files.push([
        relativePath,
        await readFile(join(repoRoot, relativePath)),
      ])
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      files.push([relativePath, null])
    }
  }
  return { porcelain, files }
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function interruptAcceptedPairPublication({
  decisionPath,
  recordPath,
  decision,
  record,
}) {
  const source = `
    const input = JSON.parse(process.argv[1])
    const implementation = await import(process.argv[2])
    await implementation.writeAtomicPair({
      decision: input.decision,
      record: input.record,
      decisionPath: input.decisionPath,
      recordPath: input.recordPath,
      injectFault(point) {
        if (point === 'record_canonical_directory_fsync') {
          process.kill(process.pid, 'SIGKILL')
        }
      },
    })
  `
  await assert.rejects(
    execFileAsync(process.execPath, [
      '--input-type=module',
      '--eval',
      source,
      JSON.stringify({
        decisionPath,
        recordPath,
        decision,
        record,
      }),
      pathToFileURL(DECISION_SCRIPT_PATH).href,
    ], {
      cwd: REPO_ROOT,
      env: testEnv(),
    }),
    (error) => error?.signal === 'SIGKILL',
  )
}

function invalidInterruptedPair(evidence) {
  return {
    decision: {
      ...structuredClone(evidence.decision),
      interrupted_marker: 'decision-parser-must-not-see-this',
    },
    record: {
      ...structuredClone(evidence.record),
      interrupted_marker: 'record-parser-must-not-see-this',
    },
  }
}

async function assertNoPairTransactionResidue(phaseDirectory) {
  assert.equal(
    (await readdir(phaseDirectory)).filter((name) =>
      name.startsWith('.05-accepted-evidence')
      || /^\.05-(?:DECISION|ZERO-RESIDUE)\.json\..*\.(?:stage|backup|restore)$/.test(name)
    ).length,
    0,
  )
}

async function readJson(repoRoot, relativePath) {
  return JSON.parse(await readFile(join(repoRoot, relativePath), 'utf8'))
}

async function headSha(repoRoot) {
  return (await git(repoRoot, ['rev-parse', 'HEAD'])).stdout.trim()
}

let immutableV3LineagePromise

async function immutableV3Record() {
  immutableV3LineagePromise ??=
    residueCheck.resolveImmutableAuthenticatedV3Lineage({
      repoRoot: REPO_ROOT,
      sourceHeadSha: await headSha(REPO_ROOT),
      now: AUTHORIZATION_VERIFIED_AT,
    })
  const lineage = await immutableV3LineagePromise
  assert.equal(lineage.residue.schema_version, 3)
  return structuredClone(lineage.residue)
}

async function commitAll(repoRoot, message) {
  await git(repoRoot, ['add', '-u'])
  await git(repoRoot, ['add', RIGHTS_SOURCE, PLAN_RELATIVE])
  await git(repoRoot, ['commit', '-qm', message])
}

async function withRepository(run) {
  const owner = await mkdtemp(join(tmpdir(), 'job-copilot-residue-'))
  const root = join(owner, 'repository')
  try {
    await git(owner, ['clone', '--quiet', '--shared', REPO_ROOT, root])
    await git(root, ['config', 'user.name', 'Residue Test'])
    await git(root, ['config', 'user.email', 'residue@example.invalid'])
    const sourceRecord = await immutableV3Record()
    if (sourceRecord.schema_version >= 2) {
      await git(root, [
        'checkout',
        '--quiet',
        '--detach',
        sourceRecord.source_snapshot.head_sha,
      ])
    }
    return await run(root)
  } finally {
    await rm(owner, { recursive: true, force: true })
    await assert.rejects(access(owner))
  }
}

async function withCurrentRepository(run) {
  const owner = await mkdtemp(join(tmpdir(), 'job-copilot-current-residue-'))
  const root = join(owner, 'repository')
  try {
    await git(owner, ['clone', '--quiet', '--shared', REPO_ROOT, root])
    await git(root, ['config', 'user.name', 'Residue Test'])
    await git(root, ['config', 'user.email', 'residue@example.invalid'])
    return await run(root)
  } finally {
    await rm(owner, { recursive: true, force: true })
    await assert.rejects(access(owner))
  }
}

async function scanOptions(root, sourceHeadSha) {
  const selectedSourceHead = sourceHeadSha ?? await headSha(root)
  return {
    repoRoot: root,
    phaseDir: PHASE_RELATIVE,
    baseline: await readJson(root, BASELINE_RELATIVE),
    sourceHeadSha: selectedSourceHead,
  }
}

function ownerReceipt(request) {
  const responseBytes = Buffer.from(
    'owner byte-exact terminal no-go response',
    'utf8',
  )
  const body = {
    schema_version: 1,
    phase: '05',
    status: 'OWNER_RESPONSE_RECORDED',
    checkpoint_plan: request.checkpoint_plan,
    checkpoint_task: request.checkpoint_task,
    gate: request.gate,
    owner_checkpoint_request_sha256:
      request.owner_checkpoint_request_sha256,
    nonce: request.nonce,
    rights_evidence_sha256: request.rights_evidence_sha256,
    quality_evidence_sha256: request.quality_evidence_sha256,
    checkpointed_decision_contract_sha256:
      request.checkpointed_decision_contract_sha256,
    baseline_evidence_sha256: request.baseline_evidence_sha256,
    owner_response_utf8_base64: responseBytes.toString('base64'),
    owner_response_sha256:
      createHash('sha256').update(responseBytes).digest('hex'),
    received_at: '2026-07-29T18:00:00.000Z',
  }
  return {
    ...body,
    owner_checkpoint_evidence_sha256: sha256Json(body),
  }
}

function acceptedDecision({ legacyDecision, receipt }) {
  const stable = {
    schema_version: 2,
    phase: '05',
    rights_status: 'RIGHTS_NO_GO',
    quality_status: 'NOT_RUN_RIGHTS_NO_GO',
    search_authorized: false,
    production_outreach_enabled: false,
    outreach_milestone_status: 'STOPPED_RIGHTS_NO_GO',
    phase_6_authorized: false,
    phase_7_authorized: false,
    provider_call_count: 0,
    fixture_count: 0,
    raw_result_count: 0,
    production_mutation_count: 0,
    rights_evidence_sha256: legacyDecision.rights_evidence_sha256,
    quality_evidence_sha256: legacyDecision.quality_evidence_sha256,
    redesign_handoff_options:
      structuredClone(legacyDecision.redesign_handoff_options),
    redesign_selection: null,
    checkpointed_decision_contract_sha256:
      legacyDecision.schema_version === 2
        ? legacyDecision.checkpointed_decision_contract_sha256
        : legacyDecision.decision_contract_sha256,
    owner_checkpoint_evidence_sha256:
      receipt.owner_checkpoint_evidence_sha256,
  }
  const ownerResponse = Buffer.from(
    receipt.owner_response_utf8_base64,
    'base64',
  ).toString('utf8')
  return {
    ...stable,
    status: 'RIGHTS_NO_GO_ACCEPTED',
    decision_contract_sha256: sha256Json(stable),
    required_owner_attestation: ownerResponse,
    owner_attestation: ownerResponse,
    zero_residue_sha256: '0'.repeat(64),
  }
}

function authorizationFields(authorization) {
  return {
    owner_authorization_request_sha256:
      authorization.owner_authorization_request_sha256,
    owner_authorization_signature_sha256:
      authorization.owner_authorization_signature_sha256,
    owner_authorization_principal: authorization.principal,
    owner_authorization_namespace: authorization.namespace,
    owner_authorization_key_fingerprint: authorization.fingerprint,
    owner_authorization_nonce_sha256: authorization.nonce_sha256,
    owner_authorization_issued_at: authorization.issued_at,
    owner_authorization_verified_at: authorization.verified_at,
    owner_authorization_stopped_decision_payload_sha256:
      authorization.stopped_decision_payload_sha256,
  }
}

function acceptedDecisionV3({
  legacyDecision,
  receipt,
  authorization,
}) {
  const v2 = acceptedDecision({ legacyDecision, receipt })
  const {
    status: ignoredStatus,
    decision_contract_sha256: ignoredDigest,
    required_owner_attestation: ignoredRequiredAttestation,
    owner_attestation: ignoredAttestation,
    zero_residue_sha256: ignoredResidueDigest,
    ...stableV2
  } = v2
  const stable = {
    ...stableV2,
    schema_version: 3,
    representative_case_count: 0,
    ...authorizationFields(authorization),
  }
  return {
    ...stable,
    status: 'RIGHTS_NO_GO_ACCEPTED',
    decision_contract_sha256: sha256Json(stable),
    zero_residue_sha256: '0'.repeat(64),
  }
}

async function installPublicAuthorizationProof(root) {
  const trustDir = join(root, 'scripts/outreach-feasibility/trust')
  await mkdir(trustDir, { recursive: true })
  for (const relativePath of [
    AUTHORIZATION_REQUEST_RELATIVE,
    AUTHORIZATION_SIGNATURE_RELATIVE,
    TRUST_ANCHOR_RELATIVE,
    PUBLIC_KEY_RELATIVE,
    ALLOWED_SIGNERS_RELATIVE,
  ]) {
    const destination = join(root, relativePath)
    if (relativePath.startsWith(PHASE_RELATIVE)) {
      await mkdir(join(root, PHASE_RELATIVE), { recursive: true })
    }
    await copyFile(join(REPO_ROOT, relativePath), destination)
  }
  return {
    requestPath: join(root, AUTHORIZATION_REQUEST_RELATIVE),
    signaturePath: join(root, AUTHORIZATION_SIGNATURE_RELATIVE),
    trustAnchorPath: join(root, TRUST_ANCHOR_RELATIVE),
    publicKeyPath: join(root, PUBLIC_KEY_RELATIVE),
    allowedSignersPath: join(root, ALLOWED_SIGNERS_RELATIVE),
  }
}

async function authenticatedLiveEvidence(root, scan) {
  const publicProof = await installPublicAuthorizationProof(root)
  const authorization = await verifyOwnerAuthorization({
    ...publicProof,
    now: AUTHORIZATION_VERIFIED_AT,
  })
  const matrix = await readJson(root, MATRIX_RELATIVE)
  const qualityReport = await readJson(root, QUALITY_RELATIVE)
  const legacyDecision = await readJson(root, DECISION_RELATIVE)
  const baseline = await readJson(root, BASELINE_RELATIVE)
  const receipt = await readJson(root, RECEIPT_RELATIVE)
  const decision = acceptedDecisionV3({
    legacyDecision,
    receipt,
    authorization,
  })
  const record = buildZeroResidueRecord({
    matrix,
    qualityReport,
    decisionContract: decision,
    ownerCheckpoint: receipt,
    baseline,
    scan,
  })
  decision.zero_residue_sha256 = record.zero_residue_sha256
  return {
    publicProof,
    authorization,
    receipt,
    decision,
    record,
  }
}

async function liveEvidence(root, scan) {
  const matrix = await readJson(root, MATRIX_RELATIVE)
  const qualityReport = await readJson(root, QUALITY_RELATIVE)
  const legacyDecision = await readJson(root, DECISION_RELATIVE)
  const baseline = await readJson(root, BASELINE_RELATIVE)
  const request = await readJson(root, REQUEST_RELATIVE)
  const receipt = ownerReceipt(request)
  const decision = acceptedDecision({ legacyDecision, receipt })
  const record = buildZeroResidueRecord({
    matrix,
    qualityReport,
    decisionContract: decision,
    ownerCheckpoint: receipt,
    baseline,
    scan,
  })
  decision.zero_residue_sha256 = record.zero_residue_sha256
  return {
    matrix,
    qualityReport,
    baseline,
    receipt,
    decision,
    record,
  }
}

function rehashRecord(record) {
  const { zero_residue_sha256: ignored, ...body } = record
  return {
    ...body,
    zero_residue_sha256: sha256Json(body),
  }
}

function rebindCurrentAuthenticatedTriple(
  { decision, residue, reconciliation },
  sourceHeadSha,
) {
  const nextResidue = structuredClone(residue)
  nextResidue.source_snapshot.head_sha = sourceHeadSha
  nextResidue.git_surfaces.phase_commit_range.head_sha = sourceHeadSha
  nextResidue.git_surfaces.source_head_tree.head_sha = sourceHeadSha
  nextResidue.administrative_tail_policy.from_source_head_sha =
    sourceHeadSha
  const reboundResidue = rehashRecord(nextResidue)
  const reboundDecision = {
    ...structuredClone(decision),
    zero_residue_sha256: reboundResidue.zero_residue_sha256,
  }
  const {
    contract_reconciliation_sha256: ignored,
    ...reconciliationBody
  } = structuredClone(reconciliation)
  reconciliationBody.zero_residue_sha256 =
    reboundResidue.zero_residue_sha256
  return {
    decision: reboundDecision,
    residue: reboundResidue,
    reconciliation: {
      ...reconciliationBody,
      contract_reconciliation_sha256:
        sha256Json(reconciliationBody),
    },
  }
}

async function readAuthenticatedTriple(root) {
  return {
    decision: await readJson(root, DECISION_RELATIVE),
    residue: await readJson(root, RECORD_RELATIVE),
    reconciliation:
      await readJson(root, RECONCILIATION_RELATIVE),
  }
}

async function writeAuthenticatedTriple(root, triple) {
  await writeJson(
    join(root, DECISION_RELATIVE),
    triple.decision,
  )
  await writeJson(
    join(root, RECORD_RELATIVE),
    triple.residue,
  )
  await writeJson(
    join(root, RECONCILIATION_RELATIVE),
    triple.reconciliation,
  )
}

async function commitPaths(root, message, paths) {
  await git(root, ['add', '--', ...paths])
  await git(root, ['commit', '-qm', message])
}

function reviewReport(status, {
  findings = {
    critical: 0,
    warning: 0,
    info: 0,
    total: 0,
  },
  files = PHASE_5_REVIEWED_PATHS,
  body =
    'The standard review covered the exact 20-file Phase 5 scope and found zero unresolved findings.',
} = {}) {
  return `---
phase: 05-outreach-feasibility-gate
reviewed: 2026-07-30T12:00:00.000Z
depth: standard
files_reviewed: ${files.length}
files_reviewed_list:
${files.map((path) => `  - ${path}`).join('\n')}
findings:
  critical: ${findings.critical}
  warning: ${findings.warning}
  info: ${findings.info}
  total: ${findings.total}
status: ${status}
---

# Phase 05: Code Review Report

## Summary

${body}

---

_Reviewed: 2026-07-30T12:00:00.000Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
`
}

async function installImmutablePriorReview(root) {
  const { stdout: immutableBytes } = await git(
    REPO_ROOT,
    ['show', `${PRIOR_REVIEW_COMMIT}:${REVIEW_RELATIVE}`],
    { encoding: 'buffer' },
  )
  assert.equal(
    createHash('sha256').update(immutableBytes).digest('hex'),
    PRIOR_REVIEW_SHA256,
  )
  const reviewPath = join(root, REVIEW_RELATIVE)
  const currentBytes = await readFile(reviewPath)
  if (!currentBytes.equals(immutableBytes)) {
    await commitFile(
      root,
      REVIEW_RELATIVE,
      immutableBytes,
      'install immutable prior review fixture',
    )
  }
  return headSha(root)
}

test('clean scan is pinned, byte-complete, and deterministic', async () => {
  await withRepository(async (root) => {
    const options = await scanOptions(root)
    const first = await scanOwnedSurfaces(options)
    const second = await scanOwnedSurfaces(options)

    assert.equal(
      first.git_surfaces.phase_commit_range.base_sha,
      options.baseline.base_sha,
    )
    assert.equal(
      first.source_snapshot.head_sha,
      options.sourceHeadSha,
    )
    assert.equal(
      first.source_snapshot.controlled_tree_sha256,
      first.git_surfaces.source_head_tree.tree_sha256,
    )
    assert.equal(
      first.source_snapshot.baseline_to_source_history_sha256,
      first.git_surfaces.phase_commit_range.inventory_sha256,
    )
    assert.deepEqual(first.git_surfaces, second.git_surfaces)
    assert.deepEqual(
      first.administrative_tail,
      second.administrative_tail,
    )
    assert.ok(first.git_surfaces.worktree.blob_count > 0)
    assert.ok(first.git_surfaces.index.blob_count > 0)
    assert.ok(first.git_surfaces.phase_commit_range.blob_count > 0)
  })
})

test('source snapshot accepts an already committed complete Plan 05-09 summary', async () => {
  await withRepository(async (root) => {
    const summaryRelative =
      `${PHASE_RELATIVE}/05-09-SUMMARY.md`
    try {
      await access(join(root, summaryRelative))
    } catch {
      await commitFile(
        root,
        summaryRelative,
        await readFile(join(REPO_ROOT, summaryRelative), 'utf8'),
        'install complete Plan 05-09 summary at source',
      )
    }
    const sourceHeadSha = await headSha(root)
    const scan = await scanOwnedSurfaces(
      await scanOptions(root, sourceHeadSha),
    )
    assert.equal(scan.administrative_tail.commit_count, 0)
    assert.equal(scan.administrative_tail.path_count, 0)
  })
})

test('source leaks are rejected on worktree, full index, and pinned history', async () => {
  for (const surface of ['worktree', 'index', 'phase_commit_range']) {
    await withRepository(async (root) => {
      const cleanBytes = await readFile(join(root, RIGHTS_SOURCE))
      await appendFile(
        join(root, RIGHTS_SOURCE),
        `\nconst leakedProviderCredential = '${SOURCE_SECRET}'\n`,
      )
      let sourceHeadSha = await headSha(root)

      if (surface === 'index') {
        await git(root, ['add', RIGHTS_SOURCE])
        await writeFile(join(root, RIGHTS_SOURCE), cleanBytes)
      } else if (surface === 'phase_commit_range') {
        await git(root, ['add', RIGHTS_SOURCE])
        await git(root, ['commit', '-qm', 'temporary source leak'])
        await writeFile(join(root, RIGHTS_SOURCE), cleanBytes)
        await git(root, ['add', RIGHTS_SOURCE])
        await git(root, ['commit', '-qm', 'remove source leak'])
        sourceHeadSha = await headSha(root)
      }

      await assert.rejects(
        scanOwnedSurfaces(await scanOptions(root, sourceHeadSha)),
        (error) => {
          assert.match(error.message, new RegExp(`surface=${surface}`))
          assert.doesNotMatch(error.message, new RegExp(SOURCE_SECRET))
          return true
        },
      )
    })
  }
})

test('every allowed JSON path rejects a realistic provider response by schema', async () => {
  const paths = [
    `${PHASE_RELATIVE}/05-RIGHTS-MATRIX.json`,
    `${PHASE_RELATIVE}/05-QUALITY-REPORT.json`,
    `${PHASE_RELATIVE}/05-DECISION.json`,
    `${PHASE_RELATIVE}/05-ZERO-RESIDUE.json`,
    `${PHASE_RELATIVE}/05-EXECUTION-BASELINE.json`,
    `${PHASE_RELATIVE}/05-OWNER-CHECKPOINT-REQUEST.json`,
    `${PHASE_RELATIVE}/05-OWNER-CHECKPOINT.json`,
    `${PHASE_RELATIVE}/05-CONTRACT-RECONCILIATION.json`,
  ]
  for (const relativePath of paths) {
    if ([
      DECISION_RELATIVE,
      RECORD_RELATIVE,
      `${PHASE_RELATIVE}/05-CONTRACT-RECONCILIATION.json`,
    ].includes(relativePath)) {
      assert.throws(
        () => assertArtifactSchema(relativePath, PROVIDER_PAYLOAD),
        /schema|artifact|object|field|missing|unknown/i,
      )
      continue
    }
    await withRepository(async (root) => {
      await writeJson(join(root, relativePath), PROVIDER_PAYLOAD)
      await assert.rejects(
        scanOwnedSurfaces(await scanOptions(root)),
        (error) => {
          assert.match(error.message, /schema|artifact|object|field/i)
          assert.doesNotMatch(error.message, /Synthetic Person/)
          assert.doesNotMatch(error.message, /Synthetic provider content/)
          return true
        },
      )
    })
  }
})

test('a later plan edit cannot move the pinned baseline past a removed leak', async () => {
  await withRepository(async (root) => {
    const cleanBytes = await readFile(join(root, RIGHTS_SOURCE))
    await appendFile(
      join(root, RIGHTS_SOURCE),
      `\nconst leakedProviderCredential = '${SOURCE_SECRET}'\n`,
    )
    await git(root, ['add', RIGHTS_SOURCE])
    await git(root, ['commit', '-qm', 'temporary source leak'])
    await writeFile(join(root, RIGHTS_SOURCE), cleanBytes)
    await git(root, ['add', RIGHTS_SOURCE])
    await git(root, ['commit', '-qm', 'remove source leak'])
    await appendFile(join(root, PLAN_RELATIVE), '\nlater mutable plan edit\n')
    await git(root, ['add', PLAN_RELATIVE])
    await git(root, ['commit', '-qm', 'later plan edit'])

    await assert.rejects(
      scanOwnedSurfaces(await scanOptions(root)),
      (error) => {
        assert.match(error.message, /phase_commit_range/)
        assert.doesNotMatch(error.message, new RegExp(SOURCE_SECRET))
        return true
      },
    )
  })
})

test('records bind the reconstructed source snapshot and evidence digests', async () => {
  await withRepository(async (root) => {
    const options = await scanOptions(root)
    const scan = await scanOwnedSurfaces(options)
    const evidence = await liveEvidence(root, scan)
    assert.equal(
      assertRecordMatchesLiveScan(
        evidence.record,
        scan,
        {
          decision: evidence.decision,
          ownerCheckpoint: evidence.receipt,
        },
      ),
      evidence.record,
    )

    const driftedTree = structuredClone(evidence.record)
    driftedTree.source_snapshot.controlled_tree_sha256 = 'f'.repeat(64)
    driftedTree.git_surfaces.source_head_tree.tree_sha256 = 'f'.repeat(64)
    const rehashedTree = rehashRecord(driftedTree)
    const treeBoundDecision = structuredClone(evidence.decision)
    treeBoundDecision.zero_residue_sha256 =
      rehashedTree.zero_residue_sha256
    assert.throws(
      () => assertRecordMatchesLiveScan(
        rehashedTree,
        scan,
        {
          decision: treeBoundDecision,
          ownerCheckpoint: evidence.receipt,
        },
      ),
      /tree|snapshot|live/i,
    )

    const driftedDecision = structuredClone(evidence.decision)
    driftedDecision.decision_contract_sha256 = 'e'.repeat(64)
    assert.throws(
      () => assertRecordMatchesLiveScan(
        evidence.record,
        scan,
        {
          decision: driftedDecision,
          ownerCheckpoint: evidence.receipt,
        },
      ),
      /decision|digest/i,
    )
  })
})

test('authenticated v3 residue propagates raw proof and reverifies the historical accepted interval', async () => {
  await withRepository(async (root) => {
    const scan = await scanOwnedSurfaces(await scanOptions(root))
    const evidence = await authenticatedLiveEvidence(root, scan)

    assert.equal(evidence.record.schema_version, 4)
    assert.equal(evidence.record.representative_case_count, 0)
    for (const [key, value] of Object.entries(
      authorizationFields(evidence.authorization),
    )) {
      assert.equal(evidence.record[key], value, key)
    }
    assert.equal(
      await assertRecordMatchesLiveScan(
        evidence.record,
        scan,
        {
          decision: evidence.decision,
          ownerCheckpoint: evidence.receipt,
          repoRoot: root,
          ...evidence.publicProof,
        },
      ),
      evidence.record,
    )
  })
})

test('authenticated live residue rejects stale recorded verification, revoked trust, missing proof, and alternate trust copies', async () => {
  await withRepository(async (root) => {
    const scan = await scanOwnedSurfaces(await scanOptions(root))
    const evidence = await authenticatedLiveEvidence(root, scan)

    const stale = structuredClone(evidence)
    stale.decision.owner_authorization_verified_at =
      '2026-08-07T00:00:00.000Z'
    stale.record.owner_authorization_verified_at =
      stale.decision.owner_authorization_verified_at
    const {
      status: ignoredStatus,
      decision_contract_sha256: ignoredDecisionDigest,
      zero_residue_sha256: ignoredDecisionResidue,
      ...decisionStable
    } = stale.decision
    stale.decision.decision_contract_sha256 = sha256Json(decisionStable)
    stale.record.decision_contract_sha256 =
      stale.decision.decision_contract_sha256
    stale.record = rehashRecord(stale.record)
    stale.decision.zero_residue_sha256 =
      stale.record.zero_residue_sha256
    await assert.rejects(
      async () => assertRecordMatchesLiveScan(
        stale.record,
        scan,
        {
          decision: stale.decision,
          ownerCheckpoint: evidence.receipt,
          repoRoot: root,
          ...evidence.publicProof,
        },
      ),
      /expired|verification|window/i,
    )

    const alternateTrustDir = join(root, PHASE_RELATIVE, 'trust-copy')
    await mkdir(alternateTrustDir, { recursive: true })
    const alternateTrust = join(
      alternateTrustDir,
      'owner-trust-anchor.json',
    )
    await copyFile(evidence.publicProof.trustAnchorPath, alternateTrust)
    await assert.rejects(
      async () => assertRecordMatchesLiveScan(
        evidence.record,
        scan,
        {
          decision: evidence.decision,
          ownerCheckpoint: evidence.receipt,
          repoRoot: root,
          ...evidence.publicProof,
          trustAnchorPath: alternateTrust,
        },
      ),
      /trust anchor path|canonical repository artifact/i,
    )

    await rm(evidence.publicProof.signaturePath)
    await assert.rejects(
      () => assertRecordMatchesLiveScan(
        evidence.record,
        scan,
        {
          decision: evidence.decision,
          ownerCheckpoint: evidence.receipt,
          repoRoot: root,
          ...evidence.publicProof,
        },
      ),
      /signature|could not be read/i,
    )
    await copyFile(
      join(REPO_ROOT, AUTHORIZATION_SIGNATURE_RELATIVE),
      evidence.publicProof.signaturePath,
    )

    const revokedTrust = JSON.parse(
      await readFile(evidence.publicProof.trustAnchorPath, 'utf8'),
    )
    revokedTrust.status = 'REVOKED'
    revokedTrust.revoked_at = '2026-07-31T00:00:00.000Z'
    await writeJson(evidence.publicProof.trustAnchorPath, revokedTrust)
    await assert.rejects(
      () => assertRecordMatchesLiveScan(
        evidence.record,
        scan,
        {
          decision: evidence.decision,
          ownerCheckpoint: evidence.receipt,
          repoRoot: root,
          ...evidence.publicProof,
        },
      ),
      /active|revoked/i,
    )
  })
})

test('administrative review tail accepts one immutable issues_found to canonical clean transition', async () => {
  await withRepository(async (root) => {
    const sourceHeadSha = await installImmutablePriorReview(root)
    await commitFile(
      root,
      REVIEW_RELATIVE,
      reviewReport('clean'),
      'record canonical clean review',
    )
    const scan = await scanOwnedSurfaces(
      await scanOptions(root, sourceHeadSha),
    )
    const reviewTransitions = scan.administrative_tail.transitions
      .filter((transition) => transition.path === REVIEW_RELATIVE)
    assert.equal(reviewTransitions.length, 1)
    assert.equal(reviewTransitions[0].transition, 'review')
  })
})

test('administrative review tail rejects aliases, skipped, and unresolved finals', async () => {
  for (const status of [
    'passed',
    'no_issues',
    'skipped',
    'issues_found',
  ]) {
    await withRepository(async (root) => {
      const sourceHeadSha = await installImmutablePriorReview(root)
      await commitFile(
        root,
        REVIEW_RELATIVE,
        reviewReport(status),
        `record invalid ${status} review`,
      )
      await assert.rejects(
        scanOwnedSurfaces(await scanOptions(root, sourceHeadSha)),
        /final Phase 5 review status must equal clean/,
        status,
      )
    })
  }
})

test('administrative review tail rejects nonzero findings and incomplete coverage', async () => {
  const cases = [
    {
      name: 'nonzero findings',
      report: reviewReport('clean', {
        findings: {
          critical: 1,
          warning: 0,
          info: 0,
          total: 1,
        },
      }),
      error: /findings must all equal zero/,
    },
    {
      name: 'missing prior-reviewed path',
      report: reviewReport('clean', {
        files: PHASE_5_REVIEWED_PATHS.slice(0, -1),
      }),
      error: /final Phase 5 review file scope drift/,
    },
    {
      name: 'resolved CR carryover',
      report: reviewReport('clean', {
        body: '### CR-01: resolved\n\nNo active findings.',
      }),
      error: /summary|final Phase 5 review finding body\/counter drift/,
    },
  ]
  for (const fixture of cases) {
    await withRepository(async (root) => {
      const sourceHeadSha = await installImmutablePriorReview(root)
      await commitFile(
        root,
        REVIEW_RELATIVE,
        fixture.report,
        `record invalid review: ${fixture.name}`,
      )
      await assert.rejects(
        scanOwnedSurfaces(await scanOptions(root, sourceHeadSha)),
        fixture.error,
        fixture.name,
      )
    })
  }
})

test('residue checked_at rejects impossible canonical-looking dates at the scan boundary', async () => {
  await withRepository(async (root) => {
    const scan = await scanOwnedSurfaces(await scanOptions(root))
    scan.checked_at = '2026-02-30T00:00:00.000Z'
    await assert.rejects(
      liveEvidence(root, scan),
      /residue scan time is malformed/,
    )
  })
})

test('CLI requires the exact full assertion flag set and reports the live tail', async () => {
  await withRepository(async (root) => {
    const options = await scanOptions(root)
    const scan = await scanOwnedSurfaces(options)
    const evidence = await authenticatedLiveEvidence(root, scan)
    await writeJson(join(root, DECISION_RELATIVE), evidence.decision)
    await writeJson(join(root, RECEIPT_RELATIVE), evidence.receipt)
    await writeJson(join(root, RECORD_RELATIVE), evidence.record)

    const fullArgs = [
      SCRIPT_PATH,
      '--assert-zero',
      '--repo-root',
      root,
      '--phase-dir',
      PHASE_RELATIVE,
      '--baseline-record',
      join(root, BASELINE_RELATIVE),
      '--matrix',
      join(root, MATRIX_RELATIVE),
      '--quality-report',
      join(root, QUALITY_RELATIVE),
      '--decision',
      join(root, DECISION_RELATIVE),
      '--owner-checkpoint',
      join(root, RECEIPT_RELATIVE),
      '--owner-authorization-request',
      evidence.publicProof.requestPath,
      '--owner-authorization-signature',
      evidence.publicProof.signaturePath,
      '--owner-trust-anchor',
      evidence.publicProof.trustAnchorPath,
      '--owner-public-key',
      evidence.publicProof.publicKeyPath,
      '--owner-allowed-signers',
      evidence.publicProof.allowedSignersPath,
      '--record',
      join(root, RECORD_RELATIVE),
    ]
    const result = await execFileAsync(process.execPath, fullArgs, {
      cwd: root,
      encoding: 'utf8',
      env: testEnv(),
    })
    assert.equal(result.stderr, '')
    const output = JSON.parse(result.stdout)
    assert.equal(output.record_source_head, options.sourceHeadSha)
    assert.equal(output.live_head, scan.administrative_tail.head_sha)
    assert.equal(
      output.administrative_tail_inventory_sha256,
      scan.administrative_tail.inventory_sha256,
    )

    for (const mutation of [
      fullArgs.filter((argument) => argument !== '--quality-report'),
      [...fullArgs, '--unknown'],
      [...fullArgs, '--record', join(root, RECORD_RELATIVE)],
    ]) {
      await assert.rejects(
        execFileAsync(process.execPath, mutation, {
          cwd: root,
          encoding: 'utf8',
          env: testEnv(),
        }),
      )
    }
  })
})

test('real assert-zero CLI recovers before both accepted artifact reads', async () => {
  await withRepository(async (root) => {
    const options = await scanOptions(root)
    const scan = await scanOwnedSurfaces(options)
    const evidence = await authenticatedLiveEvidence(root, scan)
    const decisionPath = join(root, DECISION_RELATIVE)
    const recordPath = join(root, RECORD_RELATIVE)
    await writeJson(decisionPath, evidence.decision)
    await writeJson(join(root, RECEIPT_RELATIVE), evidence.receipt)
    await writeJson(recordPath, evidence.record)
    const interrupted = invalidInterruptedPair(evidence)
    await interruptAcceptedPairPublication({
      decisionPath,
      recordPath,
      ...interrupted,
    })

    const result = await execFileAsync(process.execPath, [
      SCRIPT_PATH,
      '--assert-zero',
      '--repo-root', root,
      '--phase-dir', PHASE_RELATIVE,
      '--baseline-record', join(root, BASELINE_RELATIVE),
      '--matrix', join(root, MATRIX_RELATIVE),
      '--quality-report', join(root, QUALITY_RELATIVE),
      '--decision', decisionPath,
      '--owner-checkpoint', join(root, RECEIPT_RELATIVE),
      '--owner-authorization-request',
      evidence.publicProof.requestPath,
      '--owner-authorization-signature',
      evidence.publicProof.signaturePath,
      '--owner-trust-anchor', evidence.publicProof.trustAnchorPath,
      '--owner-public-key', evidence.publicProof.publicKeyPath,
      '--owner-allowed-signers',
      evidence.publicProof.allowedSignersPath,
      '--record', recordPath,
    ], {
      cwd: root,
      encoding: 'utf8',
      env: testEnv(),
    })
    assert.equal(result.stderr, '')
    assert.equal(JSON.parse(result.stdout).status, 'PASS')
    assert.deepEqual(
      JSON.parse(await readFile(decisionPath, 'utf8')),
      evidence.decision,
    )
    assert.deepEqual(
      JSON.parse(await readFile(recordPath, 'utf8')),
      evidence.record,
    )
    await assertNoPairTransactionResidue(join(root, PHASE_RELATIVE))
  })
})

test('real assert-zero CLI rejects malformed recovery before parsing or scanning and preserves backups', async () => {
  await withRepository(async (root) => {
    const options = await scanOptions(root)
    const scan = await scanOwnedSurfaces(options)
    const evidence = await authenticatedLiveEvidence(root, scan)
    await writeJson(join(root, DECISION_RELATIVE), evidence.decision)
    await writeJson(join(root, RECEIPT_RELATIVE), evidence.receipt)
    await writeJson(join(root, RECORD_RELATIVE), evidence.record)
    const journalPath =
      join(root, PHASE_RELATIVE, '.05-accepted-evidence.journal.json')
    const backupPath = join(
      root,
      PHASE_RELATIVE,
      '.05-DECISION.json.verified.backup',
    )
    await writeFile(backupPath, 'only-verified-recovery-copy\n', {
      mode: 0o600,
    })
    await writeFile(
      journalPath,
      '{"schema_version":1,"unknown":"fail-before-scan"}\n',
      { mode: 0o600 },
    )
    await assert.rejects(
      execFileAsync(process.execPath, [
        SCRIPT_PATH,
        '--assert-zero',
        '--repo-root', root,
        '--phase-dir', PHASE_RELATIVE,
        '--baseline-record', join(root, BASELINE_RELATIVE),
        '--matrix', join(root, MATRIX_RELATIVE),
        '--quality-report', join(root, QUALITY_RELATIVE),
        '--decision', join(root, DECISION_RELATIVE),
        '--owner-checkpoint', join(root, RECEIPT_RELATIVE),
        '--owner-authorization-request',
        evidence.publicProof.requestPath,
        '--owner-authorization-signature',
        evidence.publicProof.signaturePath,
        '--owner-trust-anchor', evidence.publicProof.trustAnchorPath,
        '--owner-public-key', evidence.publicProof.publicKeyPath,
        '--owner-allowed-signers',
        evidence.publicProof.allowedSignersPath,
        '--record', join(root, RECORD_RELATIVE),
      ], {
        cwd: root,
        encoding: 'utf8',
        env: testEnv(),
      }),
      (error) => {
        assert.match(error.stderr, /accepted evidence journal/i)
        assert.doesNotMatch(error.stderr, /residue violation|surface=/i)
        return true
      },
    )
    assert.equal(
      await readFile(backupPath, 'utf8'),
      'only-verified-recovery-copy\n',
    )
  })
})

function verificationReport(status, {
  includeRequirements = true,
  score = null,
  truthRows = null,
  requirementRows = null,
  evidenceSnapshot = TEST_VERIFICATION_SNAPSHOT,
  runnerResult = testRunnerResult(evidenceSnapshot),
  goalAchievement = null,
} = {}) {
  const passedEvidence =
    residueCheck.buildPhase5PassedVerificationEvidence({
      ...evidenceSnapshot,
      runner_result: runnerResult,
    })
  const failedGapTruths = new Set([2, 7, 8, 9, 14, 17, 18, 19])
  const defaultTruthRows =
    (
      status === 'passed'
        ? residueCheck.PHASE_5_VERIFICATION_TRUTHS
        : residueCheck.PHASE_5_SOURCE_GAPS_VERIFICATION_TRUTHS
    ).map(([id, truth]) => ({
      id,
      truth,
      status: status === 'passed' || !failedGapTruths.has(id)
      ? '✓ VERIFIED'
      : '✗ FAILED',
      evidence: status === 'passed'
        ? passedEvidence.truths[id]
        : `Offline fixture verifies canonical truth ${id} without provider effects.`,
    }))
  const selectedTruthRows = truthRows ?? defaultTruthRows
  const selectedRequirementRows = requirementRows ?? [
    {
      id: 'OUTR-04',
      status: status === 'passed' ? '✓ VERIFIED' : '✗ BLOCKED',
      evidence: status === 'passed'
        ? passedEvidence.requirements['OUTR-04']
        : 'Canonical offline evidence verifies OUTR-04 without provider effects.',
    },
    {
      id: 'OUTR-05',
      status: status === 'passed' ? '✓ VERIFIED' : '✗ BLOCKED',
      evidence: status === 'passed'
        ? passedEvidence.requirements['OUTR-05']
        : 'Canonical offline evidence verifies OUTR-05 without provider effects.',
    },
  ]
  const selectedScore = score ?? (
    status === 'passed'
      ? '21/21 must-haves verified'
      : '13/21 must-haves verified'
  )
  return [
    '---',
    'phase: 05-outreach-feasibility-gate',
    'verified: 2026-07-29T18:30:00Z',
    `status: ${status}`,
    `score: ${selectedScore}`,
    'behavior_unverified: 0',
    'overrides_applied: 0',
    '---',
    '',
    '# Phase 5: Outreach Feasibility Gate Verification Report',
    '',
    '## Goal Achievement',
    '',
    goalAchievement ?? (
      status === 'passed'
        ? 'Every bounded no-go evidence requirement is verified.'
        : 'Gap evidence remains open.'
    ),
    '',
    '### Observable Truths',
    '',
    '| # | Truth | Status | Evidence |',
    '|---|---|---|---|',
    ...selectedTruthRows.map((row) =>
      `| ${row.id} | ${row.truth} | ${row.status} | ${row.evidence} |`
    ),
    '',
    ...(includeRequirements
      ? [
          '## Requirements Coverage',
          '',
          '| Requirement | Source Plans | Description | Status | Evidence |',
          '|---|---|---|---|---|',
          ...selectedRequirementRows.map((row) =>
            `| ${row.id} | ${
              status === 'passed'
                ? '05-01 through 05-23'
                : '05-01 through 05-19'
            } | ${
              row.id === 'OUTR-04'
                ? 'Production proceeds only after permitted rights and owner acceptance; otherwise remains disabled and stopped/redesigned.'
                : 'Rights-first terminal branch truthfully closes quality as not run, zero effect, and receipt-bound owner no-go.'
            } | ${row.status} |`
            + ` ${row.evidence ?? (
              status === 'passed'
                ? passedEvidence.requirements[row.id]
                : `Canonical offline evidence verifies ${row.id} without provider effects.`
            )} |`
          ),
          '',
        ]
      : []),
  ].join('\n')
}

test('verification completion requires a positive complete truth and requirement inventory', async () => {
  assert.equal(
    typeof residueCheck.assertCompleteVerificationDocument,
    'function',
  )
  const sourceGaps = verificationReport('gaps_found')
  await assert.doesNotReject(
    () => assertVerificationDocument(
      sourceGaps,
      'gaps_found',
    ),
  )
  await withCurrentRepository(async (root) => {
    const sourceHeadSha = await headSha(root)
    const sourceScan = await scanOwnedSurfaces(
      await scanOptions(root, sourceHeadSha),
    )
    const verificationSnapshot = {
      source_head_sha: sourceHeadSha,
      controlled_tree_sha256:
        sourceScan.source_snapshot.controlled_tree_sha256,
    }
    const passedReport = (options = {}) =>
      verificationReport('passed', {
        evidenceSnapshot: verificationSnapshot,
        ...options,
      })
    await assert.doesNotReject(
      () => assertVerificationDocument(
        passedReport(),
        'passed',
        verificationSnapshot,
        root,
      ),
    )
    await assert.rejects(
      () => assertVerificationDocument(
        passedReport(),
        'passed',
        {
          source_head_sha: 'c'.repeat(40),
          controlled_tree_sha256: 'd'.repeat(64),
        },
        root,
      ),
      /source snapshot drift/,
    )

    const completeRows =
      residueCheck.PHASE_5_VERIFICATION_TRUTHS.map(([id, truth]) => ({
      id,
      truth,
      status: '✓ VERIFIED',
      evidence:
        residueCheck.buildPhase5PassedVerificationEvidence({
          ...verificationSnapshot,
          runner_result: testRunnerResult(verificationSnapshot),
        }).truths[id],
    }))
    const forgeries = [
      passedReport({
        score: '0/0 must-haves verified',
        truthRows: [],
      }),
      passedReport({
        score: '0/21 must-haves verified',
      }),
      passedReport({
        score: '20/21 must-haves verified',
      }),
      passedReport({
        score: '21/22 must-haves verified',
      }),
      passedReport({
        truthRows: completeRows.slice(0, -1),
      }),
      passedReport({
        truthRows: completeRows.map((row, index) =>
          index === 20 ? { ...row, id: 20 } : row
        ),
      }),
      passedReport({
        truthRows: completeRows.map((row, index) =>
          index === 4 ? { ...row, status: '✗ FAILED' } : row
        ),
      }),
      passedReport({
        requirementRows: [{
          id: 'OUTR-04',
          status: '✓ VERIFIED',
        }],
      }),
      passedReport({
        requirementRows: [
          { id: 'OUTR-04', status: '✓ VERIFIED' },
          { id: 'OUTR-05', status: '✗ BLOCKED' },
        ],
      }),
      sourceGaps.replace(
        'score: 13/21 must-haves verified',
        'score: 12/21 must-haves verified',
      ),
      passedReport().replace(
        'behavior_unverified: 0',
        'behavior_unverified: 1',
      ),
      passedReport().replace(
        'overrides_applied: 0',
        'overrides_applied: 1',
      ),
      passedReport().replace(
        completeRows[0].evidence,
        'None',
      ),
      passedReport().replace(
        'anchor=inspectRightsMatrix',
        'anchor=unreviewedAssertion',
      ),
      passedReport().replace(
        `source_head=${verificationSnapshot.source_head_sha}`,
        `source_head=${'c'.repeat(40)}`,
      ),
      passedReport().replace(
        /command_sha256=[0-9a-f]{64}/,
        `command_sha256=${'d'.repeat(64)}`,
      ),
      passedReport().replace(
        /test_file_inventory_sha256=[0-9a-f]{64}/,
        `test_file_inventory_sha256=${'d'.repeat(64)}`,
      ),
      passedReport().replace(
        /runner_result_sha256=[0-9a-f]{64}/,
        `runner_result_sha256=${'d'.repeat(64)}`,
      ),
      passedReport().replace(
        'tests=242 pass=242 fail=0',
        'tests=1 pass=1 fail=0',
      ),
      passedReport().replace(
        'tests=242 pass=242 fail=0',
        'tests=238 pass=238 fail=0',
      ),
      passedReport().replace(
        'tests=242 pass=242 fail=0',
        'tests=242 pass=241 fail=1',
      ),
      passedReport({
        requirementRows: [
          {
            id: 'OUTR-04',
            status: '✓ VERIFIED',
            evidence:
              completeRows[0].evidence,
          },
          {
            id: 'OUTR-05',
            status: '✓ VERIFIED',
          },
        ],
      }),
      passedReport({
        score: '1/1 must-haves verified',
        truthRows: [{
          id: 1,
          truth: 'Placeholder',
          status: '✓ VERIFIED',
          evidence: 'None',
        }],
      }),
      passedReport({
        goalAchievement:
          'No verification was performed; this text only claims a complete score.',
        truthRows: residueCheck.PHASE_5_VERIFICATION_TRUTHS.map(
          ([id, truth]) => ({
            id,
            truth,
            status: '✓ VERIFIED',
            evidence:
              'Fabricated prose with no artifact or command reference.',
          }),
        ),
        requirementRows: [
          {
            id: 'OUTR-04',
            status: '✓ VERIFIED',
            evidence:
              'Fabricated prose with no artifact or command reference.',
          },
          {
            id: 'OUTR-05',
            status: '✓ VERIFIED',
            evidence:
              'Fabricated prose with no artifact or command reference.',
          },
        ],
      }),
    ]
    for (const [index, forged] of forgeries.entries()) {
      await assert.rejects(
        () => assertVerificationDocument(
          forged,
          forged.includes('status: gaps_found')
            ? 'gaps_found'
            : 'passed',
          forged.includes('status: gaps_found')
            ? null
            : verificationSnapshot,
          root,
        ),
        /verification|score|truth|requirement|inventory|verified/i,
        `forgery ${index} was accepted`,
      )
    }

    const rightsPath = join(root, RIGHTS_SOURCE)
    await writeFile(
      rightsPath,
      (await readFile(rightsPath, 'utf8'))
        .replaceAll('inspectRightsMatrix', 'inspectRightsMatrixRemoved'),
    )
    await git(root, ['add', RIGHTS_SOURCE])
    await git(root, ['commit', '-qm', 'remove claimed source anchor'])
    const missingAnchorHead = await headSha(root)
    const missingAnchorScan = await scanOwnedSurfaces(
      await scanOptions(root, missingAnchorHead),
    )
    const missingAnchorSnapshot = {
      source_head_sha: missingAnchorHead,
      controlled_tree_sha256:
        missingAnchorScan.source_snapshot.controlled_tree_sha256,
    }
    await assert.rejects(
      () => assertVerificationDocument(
        verificationReport('passed', {
          evidenceSnapshot: missingAnchorSnapshot,
        }),
        'passed',
        missingAnchorSnapshot,
        root,
      ),
      /artifact anchor is absent at source/i,
    )

    const removedTest =
      'scripts/outreach-feasibility/adversarial-regression.test.mjs'
    await rm(join(root, removedTest))
    await git(root, ['add', removedTest])
    await git(root, ['commit', '-qm', 'remove claimed test inventory entry'])
    const missingTestHead = await headSha(root)
    const missingTestScan = await scanOwnedSurfaces(
      await scanOptions(root, missingTestHead),
    )
    const missingTestSnapshot = {
      source_head_sha: missingTestHead,
      controlled_tree_sha256:
        missingTestScan.source_snapshot.controlled_tree_sha256,
    }
    await assert.rejects(
      () => assertVerificationDocument(
        verificationReport('passed', {
          evidenceSnapshot: missingTestSnapshot,
        }),
        'passed',
        missingTestSnapshot,
        root,
      ),
      /test-file inventory drift/i,
    )

    const mismatchedDigestResult = testRunnerResult(
      verificationSnapshot,
      { test_outcomes_sha256: 'e'.repeat(64) },
    )
    await assert.rejects(
      () => residueCheck.assertCompleteVerificationDocument(
        passedReport(),
        'passed',
        verificationSnapshot,
        root,
        async () => mismatchedDigestResult,
      ),
      /offline command evidence drift/i,
    )

    const failedInjectedResult = testRunnerResult(
      verificationSnapshot,
      {
        exit: 1,
        pass: residueCheck.PHASE_5_OFFLINE_TEST_COUNT - 1,
        fail: 1,
      },
    )
    await assert.rejects(
      () => residueCheck.assertCompleteVerificationDocument(
        passedReport(),
        'passed',
        verificationSnapshot,
        root,
        async () => failedInjectedResult,
      ),
      /actual offline runner did not pass completely/i,
    )

    const wrongSnapshotResult = testRunnerResult({
      ...verificationSnapshot,
      source_head_sha: 'f'.repeat(40),
    })
    await assert.rejects(
      () => residueCheck.assertCompleteVerificationDocument(
        passedReport(),
        'passed',
        verificationSnapshot,
        root,
        async () => wrongSnapshotResult,
      ),
      /actual offline runner did not pass completely/i,
    )

    if (process.env.PHASE_5_ISOLATED_RUNNER_CHILD !== '1') {
      const successfulRunnerResult =
        await residueCheck.runPhase5OfflineSuiteAtSourceSnapshot({
          repoRoot: root,
          ...verificationSnapshot,
        })
      assert.equal(successfulRunnerResult.exit, 0)
      assert.equal(
        successfulRunnerResult.pass,
        successfulRunnerResult.tests,
      )
      await assert.doesNotReject(
        () => residueCheck.assertCompleteVerificationDocument(
          verificationReport('passed', {
            evidenceSnapshot: verificationSnapshot,
            runnerResult: successfulRunnerResult,
          }),
          'passed',
          verificationSnapshot,
          root,
          async () => successfulRunnerResult,
        ),
      )

      const failingOwner = await mkdtemp(
        join(tmpdir(), 'phase-05-failing-runner-'),
      )
      const failingRoot = join(failingOwner, 'repository')
      try {
        await git(failingOwner, [
          'clone',
          '--quiet',
          '--shared',
          root,
          failingRoot,
        ])
        await git(failingRoot, ['config', 'user.name', 'Residue Test'])
        await git(
          failingRoot,
          ['config', 'user.email', 'residue@example.invalid'],
        )
        await git(failingRoot, [
          'checkout',
          '--quiet',
          '--detach',
          verificationSnapshot.source_head_sha,
        ])
        const failingTest = join(
          failingRoot,
          'scripts/outreach-feasibility/adversarial-regression.test.mjs',
        )
        await appendFile(
          failingTest,
          '\nthrow new Error("committed runner rejection probe")\n',
        )
        await git(failingRoot, [
          'add',
          'scripts/outreach-feasibility/adversarial-regression.test.mjs',
        ])
        await git(failingRoot, [
          'commit',
          '-qm',
          'introduce committed runner failure',
        ])
        const failingHead = await headSha(failingRoot)
        const failingScan = await scanOwnedSurfaces(
          await scanOptions(failingRoot, failingHead),
        )
        const failingSnapshot = {
          source_head_sha: failingHead,
          controlled_tree_sha256:
            failingScan.source_snapshot.controlled_tree_sha256,
        }
        const failedRunnerResult =
          await residueCheck.runPhase5OfflineSuiteAtSourceSnapshot({
            repoRoot: failingRoot,
            ...failingSnapshot,
          })
        assert.notEqual(failedRunnerResult.exit, 0)
        assert.ok(failedRunnerResult.fail > 0)
        await assert.rejects(
          () => residueCheck.assertCompleteVerificationDocument(
            verificationReport('passed', {
              evidenceSnapshot: failingSnapshot,
            }),
            'passed',
            failingSnapshot,
            failingRoot,
            async () => failedRunnerResult,
          ),
          /actual offline runner did not pass completely/i,
        )
      } finally {
        await rm(failingOwner, { recursive: true, force: true })
      }
    }
  })
})

async function commitFile(root, relativePath, contents, message) {
  await writeFile(join(root, relativePath), contents)
  await git(root, ['add', relativePath])
  await git(root, ['commit', '-qm', message])
}

async function commitAdministrativeDocuments(root, relativePaths, message) {
  for (const relativePath of relativePaths) {
    await writeFile(
      join(root, relativePath),
      await readFile(join(REPO_ROOT, relativePath)),
    )
  }
  await git(root, ['add', ...relativePaths])
  await git(root, ['commit', '-qm', message])
}

test('actual 05-19 summary and later contiguous plan-summary tail derive one finite exact policy', async () => {
  assert.equal(
    typeof residueCheck.deriveAdministrativeTailPolicy,
    'function',
  )
  await withRepository(async (root) => {
    const sourceHeadSha = await headSha(root)
    assert.equal(
      (await git(root, [
        'ls-tree',
        '-r',
        '--name-only',
        sourceHeadSha,
        '--',
        PLAN_19_RELATIVE,
      ])).stdout.trim(),
      PLAN_19_RELATIVE,
    )
    assert.equal(
      (await git(root, [
        'ls-tree',
        '-r',
        '--name-only',
        sourceHeadSha,
        '--',
        SUMMARY_19_RELATIVE,
      ])).stdout,
      '',
    )

    await commitAdministrativeDocuments(
      root,
      [
        SUMMARY_19_RELATIVE,
        `${PHASE_RELATIVE}/05-20-PLAN.md`,
        `${PHASE_RELATIVE}/05-21-PLAN.md`,
        `${PHASE_RELATIVE}/05-22-PLAN.md`,
        `${PHASE_RELATIVE}/05-23-PLAN.md`,
      ],
      'install actual post-source plans and Plan 19 summary',
    )
    await commitAdministrativeDocuments(
      root,
      [
        `${PHASE_RELATIVE}/05-20-SUMMARY.md`,
        `${PHASE_RELATIVE}/05-21-SUMMARY.md`,
      ],
      'install contiguous completed summaries',
    )

    const policy = await residueCheck.deriveAdministrativeTailPolicy({
      repoRoot: root,
      phaseDir: PHASE_RELATIVE,
      sourceHeadSha,
    })
    const dynamicPaths = [
      SUMMARY_19_RELATIVE,
      `${PHASE_RELATIVE}/05-20-PLAN.md`,
      `${PHASE_RELATIVE}/05-20-SUMMARY.md`,
      `${PHASE_RELATIVE}/05-21-PLAN.md`,
      `${PHASE_RELATIVE}/05-21-SUMMARY.md`,
      `${PHASE_RELATIVE}/05-22-PLAN.md`,
      `${PHASE_RELATIVE}/05-23-PLAN.md`,
    ]
    assert.deepEqual(
      dynamicPaths.filter((path) => policy.allowed_paths.includes(path)),
      dynamicPaths,
    )
    assert.deepEqual(
      policy.allowed_paths,
      [...policy.allowed_paths].sort(),
    )
    assert.equal(new Set(policy.allowed_paths).size, policy.allowed_paths.length)
    assert.ok(policy.allowed_paths.length < 32)
    assert.deepEqual(
      (await scanOwnedSurfaces(
        await scanOptions(root, sourceHeadSha),
      )).administrative_tail_policy,
      policy,
    )
  })
})

test('administrative tail rejects gaps, mismatched frontmatter, edits, and unknown post-source files', async () => {
  const cases = [
    {
      name: 'skipped plan ID',
      paths: [`${PHASE_RELATIVE}/05-21-PLAN.md`],
      mutate: null,
    },
    {
      name: 'plan frontmatter mismatch',
      paths: [`${PHASE_RELATIVE}/05-20-PLAN.md`],
      mutate: (bytes) => Buffer.from(
        bytes.toString('utf8').replace('plan: 20', 'plan: 21'),
      ),
    },
    {
      name: 'unknown post-source artifact',
      paths: [`${PHASE_RELATIVE}/05-20-PLAN.md`],
      extra: `${PHASE_RELATIVE}/05-24-NOTES.md`,
    },
  ]
  for (const fixture of cases) {
    await withRepository(async (root) => {
      const sourceHeadSha = await headSha(root)
      for (const relativePath of fixture.paths) {
        const original = await readFile(join(REPO_ROOT, relativePath))
        await writeFile(
          join(root, relativePath),
          fixture.mutate ? fixture.mutate(original) : original,
        )
      }
      if (fixture.extra) {
        await writeFile(join(root, fixture.extra), 'unknown\n')
      }
      await git(root, [
        'add',
        ...fixture.paths,
        ...(fixture.extra ? [fixture.extra] : []),
      ])
      await git(root, ['commit', '-qm', fixture.name])
      await assert.rejects(
        residueCheck.deriveAdministrativeTailPolicy({
          repoRoot: root,
          phaseDir: PHASE_RELATIVE,
          sourceHeadSha,
        }),
        /administrative|plan|inventory|path|frontmatter|contiguous/i,
        fixture.name,
      )
    })
  }

  await withRepository(async (root) => {
    const sourceHeadSha = await headSha(root)
    const plan20 = `${PHASE_RELATIVE}/05-20-PLAN.md`
    await commitAdministrativeDocuments(root, [plan20], 'create Plan 20')
    await appendFile(join(root, plan20), '\npost-creation edit\n')
    await git(root, ['add', plan20])
    await git(root, ['commit', '-qm', 'edit Plan 20'])
    await assert.rejects(
      residueCheck.deriveAdministrativeTailPolicy({
        repoRoot: root,
        phaseDir: PHASE_RELATIVE,
        sourceHeadSha,
      }),
      /create-once|changed|edit|administrative/i,
    )
  })
})

test('immutable schema v3 migrates deterministically to the same publishable v4 as direct construction', async () => {
  assert.equal(
    typeof residueCheck.migrateZeroResidueV3ToV4,
    'function',
  )
  await withRepository(async (root) => {
    const sourceRecord = await immutableV3Record()
    assert.equal(sourceRecord.schema_version, 3)
    const sourceHeadSha = sourceRecord.source_snapshot.head_sha
    const scan = await scanOwnedSurfaces(
      await scanOptions(root, sourceHeadSha),
    )
    const migrated = residueCheck.migrateZeroResidueV3ToV4({
      record: sourceRecord,
      liveScan: scan,
    })
    const migratedAgain = residueCheck.migrateZeroResidueV3ToV4({
      record: structuredClone(sourceRecord),
      liveScan: structuredClone(scan),
    })
    assert.deepEqual(migratedAgain, migrated)
    assert.equal(migrated.schema_version, 4)
    assert.deepEqual(migrated.git_surfaces.worktree.status_paths, [])
    assert.deepEqual(migrated.git_surfaces.index.staged_paths, [])
    assert.deepEqual(
      migrated.administrative_tail_policy.allowed_paths,
      scan.administrative_tail_policy.allowed_paths,
    )
    assert.deepEqual(
      await immutableV3Record(),
      sourceRecord,
    )

    const poisoned = structuredClone(sourceRecord)
    poisoned.administrative_tail_policy.allowed_paths = ['attacker/path']
    poisoned.git_surfaces.worktree.status_paths = ['attacker/path']
    poisoned.git_surfaces.index.staged_paths = ['attacker/path']
    assert.throws(
      () => residueCheck.migrateZeroResidueV3ToV4({
        record: poisoned,
        liveScan: scan,
      }),
      /unknown|schema|v3/i,
    )

    const malformed = structuredClone(sourceRecord)
    malformed.unknown = true
    assert.throws(
      () => residueCheck.migrateZeroResidueV3ToV4({
        record: malformed,
        liveScan: scan,
      }),
      /unknown|schema|v3/i,
    )
  })

  await withCurrentRepository(async (root) => {
    const currentHead = await headSha(root)
    const lineage =
      await residueCheck.resolveImmutableAuthenticatedV3Lineage({
        repoRoot: root,
        sourceHeadSha: currentHead,
        now: AUTHORIZATION_VERIFIED_AT,
      })
    assert.deepEqual(
      lineage.chain.map(({ residue_schema_version: version }) => version),
      [4, 4, 3],
    )
    assert.equal(
      lineage.commit_sha,
      'd3229edd0622694ece4b0ccc10e5db39af9bdfcb',
    )
    const currentScan = await scanOwnedSurfaces(
      await scanOptions(root, currentHead),
    )
    assert.equal(currentScan.source_snapshot.head_sha, currentHead)

    await appendFile(
      join(root, RIGHTS_SOURCE),
      '\n// repeatable rebind compatibility source root\n',
    )
    await commitPaths(root, 'record fresh compatibility source', [
      RIGHTS_SOURCE,
    ])
    const sourceHeadSha = await headSha(root)
    const sourceScan = await scanOwnedSurfaces(
      await scanOptions(root, sourceHeadSha),
    )
    const sourceTriple = await readAuthenticatedTriple(root)
    const matrix = await readJson(root, MATRIX_RELATIVE)
    const qualityReport = await readJson(root, QUALITY_RELATIVE)
    const baseline = await readJson(root, BASELINE_RELATIVE)
    const receipt = await readJson(root, RECEIPT_RELATIVE)
    const decision = structuredClone(sourceTriple.decision)
    const residue = buildZeroResidueRecord({
      matrix,
      qualityReport,
      decisionContract: decision,
      ownerCheckpoint: receipt,
      baseline,
      scan: sourceScan,
    })
    decision.zero_residue_sha256 = residue.zero_residue_sha256
    const {
      contract_reconciliation_sha256: ignored,
      ...reconciliationBody
    } = structuredClone(sourceTriple.reconciliation)
    reconciliationBody.zero_residue_sha256 =
      residue.zero_residue_sha256
    const reconciliation = {
      ...reconciliationBody,
      contract_reconciliation_sha256:
        sha256Json(reconciliationBody),
    }
    await writeAuthenticatedTriple(root, {
      decision,
      residue,
      reconciliation,
    })
    await commitPaths(root, 'publish one later authenticated rebind', [
      DECISION_RELATIVE,
      RECORD_RELATIVE,
      RECONCILIATION_RELATIVE,
    ])
    const reboundScan = await scanOwnedSurfaces(
      await scanOptions(root, sourceHeadSha),
    )
    assert.equal(reboundScan.administrative_tail.commit_count, 1)
    assert.equal(
      reboundScan.administrative_tail_policy.source_changes_allowed,
      false,
    )
    assert.deepEqual(
      reboundScan.administrative_tail.transitions.map(
        ({ path }) => path,
      ).sort(),
      [
        DECISION_RELATIVE,
        RECORD_RELATIVE,
        RECONCILIATION_RELATIVE,
      ].sort(),
    )
  })

  for (const scenario of [
    {
      name: 'missing reconciliation path',
      stagedPaths: [DECISION_RELATIVE, RECORD_RELATIVE],
      prepare: async () => {},
      pattern: /exactly the finite evidence path set/i,
    },
    {
      name: 'wrong evidence path substitution',
      stagedPaths: [
        DECISION_RELATIVE,
        RECORD_RELATIVE,
        QUALITY_RELATIVE,
      ],
      prepare: async (root) => {
        await appendFile(join(root, QUALITY_RELATIVE), '\n')
      },
      pattern: /exactly the finite evidence path set/i,
    },
    {
      name: 'mixed source change',
      stagedPaths: [
        DECISION_RELATIVE,
        RECORD_RELATIVE,
        RECONCILIATION_RELATIVE,
        RIGHTS_SOURCE,
      ],
      prepare: async (root) => {
        await appendFile(
          join(root, RIGHTS_SOURCE),
          '\n// forbidden mixed rebind source change\n',
        )
      },
      pattern: /exactly the finite evidence path set/i,
    },
    {
      name: 'mismatched authenticated pair',
      stagedPaths: [
        DECISION_RELATIVE,
        RECORD_RELATIVE,
        RECONCILIATION_RELATIVE,
      ],
      prepare: async (_root, triple) => {
        triple.decision.zero_residue_sha256 = 'f'.repeat(64)
      },
      pattern: /pair digest drift|binding drift/i,
    },
  ]) {
    await withCurrentRepository(async (root) => {
      const sourceHeadSha = await headSha(root)
      const triple = rebindCurrentAuthenticatedTriple(
        await readAuthenticatedTriple(root),
        sourceHeadSha,
      )
      await scenario.prepare(root, triple)
      await writeAuthenticatedTriple(root, triple)
      await commitPaths(root, scenario.name, scenario.stagedPaths)
      const invalidSourceHead = await headSha(root)
      await assert.rejects(
        scanOwnedSurfaces(
          await scanOptions(root, invalidSourceHead),
        ),
        scenario.pattern,
        scenario.name,
      )
    })
  }

  await withCurrentRepository(async (root) => {
    for (let index = 0; index < 14; index += 1) {
      const sourceHeadSha = await headSha(root)
      const triple = rebindCurrentAuthenticatedTriple(
        await readAuthenticatedTriple(root),
        sourceHeadSha,
      )
      await writeAuthenticatedTriple(root, triple)
      await commitPaths(
        root,
        `extend authenticated lineage ${index + 1}`,
        [
          DECISION_RELATIVE,
          RECORD_RELATIVE,
          RECONCILIATION_RELATIVE,
        ],
      )
    }
    await assert.rejects(
      residueCheck.resolveImmutableAuthenticatedV3Lineage({
        repoRoot: root,
        sourceHeadSha: await headSha(root),
        now: AUTHORIZATION_VERIFIED_AT,
      }),
      /exceeds 16 commits/i,
    )
  })

  await withCurrentRepository(async (root) => {
    const originalHead = await headSha(root)
    await git(root, ['switch', '-q', '-c', 'lineage-sibling', 'HEAD^'])
    await appendFile(
      join(root, RIGHTS_SOURCE),
      '\n// unrelated sibling lineage\n',
    )
    await commitPaths(root, 'create unrelated lineage sibling', [
      RIGHTS_SOURCE,
    ])
    const siblingHead = await headSha(root)
    await git(root, ['switch', '-q', '--detach', originalHead])
    const triple = rebindCurrentAuthenticatedTriple(
      await readAuthenticatedTriple(root),
      siblingHead,
    )
    await writeAuthenticatedTriple(root, triple)
    await commitPaths(root, 'point lineage outside strict ancestry', [
      DECISION_RELATIVE,
      RECORD_RELATIVE,
      RECONCILIATION_RELATIVE,
    ])
    await assert.rejects(
      residueCheck.resolveImmutableAuthenticatedV3Lineage({
        repoRoot: root,
        sourceHeadSha: await headSha(root),
        now: AUTHORIZATION_VERIFIED_AT,
      }),
      /strict ancestor/i,
    )
  })
})

test('committed source gaps_found advances through exactly one passed write', async () => {
  await withCurrentRepository(async (root) => {
    await commitFile(
      root,
      VERIFICATION_RELATIVE,
      verificationReport('gaps_found'),
      'record source verification gaps',
    )
    const sourceHeadSha = await headSha(root)
    const sourceScan = await scanOwnedSurfaces(
      await scanOptions(root, sourceHeadSha),
    )
    const evidence = await liveEvidence(root, sourceScan)
    await commitFile(
      root,
      VERIFICATION_RELATIVE,
      verificationReport('passed', {
        evidenceSnapshot: {
          source_head_sha: sourceHeadSha,
          controlled_tree_sha256:
            sourceScan.source_snapshot.controlled_tree_sha256,
        },
      }),
      'record final verification pass',
    )

    const liveScan = await scanOwnedSurfaces(
      await scanOptions(root, sourceHeadSha),
    )
    assert.equal(
      liveScan.administrative_tail.verification_lineage,
      'gaps_found_to_passed',
    )
    assert.equal(liveScan.administrative_tail.path_count, 1)
    assert.equal(
      assertRecordMatchesLiveScan(
        evidence.record,
        liveScan,
        {
          decision: evidence.decision,
          ownerCheckpoint: evidence.receipt,
        },
      ),
      evidence.record,
    )
  })
})

const VERIFICATION_RELATIVE =
  `${PHASE_RELATIVE}/05-VERIFICATION.md`

test('untracked gaps report cannot seed absent committed lineage', async () => {
  await withCurrentRepository(async (root) => {
    const sourceHeadSha = await headSha(root)
    const untracked = verificationReport('gaps_found')
    await writeFile(join(root, VERIFICATION_RELATIVE), untracked)
    const pendingScan = await scanOwnedSurfaces(
      await scanOptions(root, sourceHeadSha),
    )
    assert.equal(
      pendingScan.administrative_tail.verification_lineage,
      'absent_pending',
    )
    assert.equal(
      await readFile(join(root, VERIFICATION_RELATIVE), 'utf8'),
      untracked,
    )
    const { stdout: sourceTree } = await git(root, [
      'ls-tree',
      '-r',
      '--name-only',
      sourceHeadSha,
      '--',
      VERIFICATION_RELATIVE,
    ])
    assert.equal(sourceTree, '')

    const evidence = await liveEvidence(root, pendingScan)
    await commitFile(
      root,
      VERIFICATION_RELATIVE,
      verificationReport('passed', {
        evidenceSnapshot: {
          source_head_sha: sourceHeadSha,
          controlled_tree_sha256:
            pendingScan.source_snapshot.controlled_tree_sha256,
        },
      }),
      'create final verification pass',
    )
    const liveScan = await scanOwnedSurfaces(
      await scanOptions(root, sourceHeadSha),
    )
    assert.equal(
      liveScan.administrative_tail.verification_lineage,
      'absent_to_passed',
    )
    assert.equal(
      assertRecordMatchesLiveScan(
        evidence.record,
        liveScan,
        {
          decision: evidence.decision,
          ownerCheckpoint: evidence.receipt,
        },
      ),
      evidence.record,
    )
  })
})

test('every invalid committed verification lineage fails closed', async () => {
  const cases = [
    {
      name: 'passed at source head',
      prepare: async (root) => {
        await commitFile(
          root,
          VERIFICATION_RELATIVE,
          verificationReport('passed'),
          'invalid source pass',
        )
        return headSha(root)
      },
    },
    {
      name: 'absent to gaps to passed',
      prepare: async (root) => {
        const source = await headSha(root)
        await commitFile(
          root,
          VERIFICATION_RELATIVE,
          verificationReport('gaps_found'),
          'invalid intermediate gaps',
        )
        await commitFile(
          root,
          VERIFICATION_RELATIVE,
          verificationReport('passed'),
          'invalid second write',
        )
        return source
      },
    },
    {
      name: 'non-passed final report',
      prepare: async (root) => {
        const source = await headSha(root)
        await commitFile(
          root,
          VERIFICATION_RELATIVE,
          verificationReport('gaps_found'),
          'invalid final gaps',
        )
        return source
      },
    },
    {
      name: 'drifted final report structure',
      prepare: async (root) => {
        const source = await headSha(root)
        await commitFile(
          root,
          VERIFICATION_RELATIVE,
          verificationReport('passed', { includeRequirements: false }),
          'invalid final schema',
        )
        return source
      },
    },
    {
      name: 'deletion and recreation',
      prepare: async (root) => {
        await commitFile(
          root,
          VERIFICATION_RELATIVE,
          verificationReport('gaps_found'),
          'source gaps',
        )
        const source = await headSha(root)
        await rm(join(root, VERIFICATION_RELATIVE))
        await git(root, ['add', VERIFICATION_RELATIVE])
        await git(root, ['commit', '-qm', 'invalid verification deletion'])
        await commitFile(
          root,
          VERIFICATION_RELATIVE,
          verificationReport('passed'),
          'invalid verification recreation',
        )
        return source
      },
    },
    {
      name: 'passed reversal to gaps',
      prepare: async (root) => {
        await commitFile(
          root,
          VERIFICATION_RELATIVE,
          verificationReport('passed'),
          'invalid source pass',
        )
        const source = await headSha(root)
        await commitFile(
          root,
          VERIFICATION_RELATIVE,
          verificationReport('gaps_found'),
          'invalid pass reversal',
        )
        return source
      },
    },
  ]
  for (const fixture of cases) {
    await withRepository(async (root) => {
      const sourceHeadSha = await fixture.prepare(root)
      await assert.rejects(
        scanOwnedSurfaces(await scanOptions(root, sourceHeadSha)),
        /verification|administrative/i,
        fixture.name,
      )
    })
  }
})

test('administrative tail rejects source edits and unknown phase artifacts', async () => {
  await withRepository(async (root) => {
    const sourceHeadSha = await headSha(root)
    await appendFile(join(root, RIGHTS_SOURCE), '\n// post-snapshot edit\n')
    await git(root, ['add', RIGHTS_SOURCE])
    await git(root, ['commit', '-qm', 'invalid post-snapshot source edit'])
    await assert.rejects(
      scanOwnedSurfaces(await scanOptions(root, sourceHeadSha)),
      /administrative_tail|tail policy/,
    )
  })

  await withRepository(async (root) => {
    const sourceHeadSha = await headSha(root)
    const unknown =
      `${PHASE_RELATIVE}/05-UNKNOWN-ADMINISTRATIVE.json`
    await commitFile(root, unknown, '{}\n', 'invalid phase artifact')
    await assert.rejects(
      scanOwnedSurfaces(await scanOptions(root, sourceHeadSha)),
      /administrative|unexpected phase path|tail policy/,
    )
  })
})

test('fresh source snapshot leaves only a finite review verification and tracking tail', async () => {
  const owner = await mkdtemp(join(tmpdir(), 'job-copilot-fresh-tail-'))
  const root = join(owner, 'repository')
  try {
    await git(owner, ['clone', '--quiet', '--shared', REPO_ROOT, root])
    await git(root, ['config', 'user.name', 'Residue Test'])
    await git(root, ['config', 'user.email', 'residue@example.invalid'])
    const sourceHeadSha = await headSha(root)
    const sourceScan = await scanOwnedSurfaces(
      await scanOptions(root, sourceHeadSha),
    )
    assert.equal(sourceScan.administrative_tail.commit_count, 0)

    await commitFile(
      root,
      REVIEW_RELATIVE,
      reviewReport('clean'),
      'record clean post-snapshot review',
    )
    await commitFile(
      root,
      VERIFICATION_RELATIVE,
      verificationReport('passed', {
        evidenceSnapshot: {
          source_head_sha: sourceHeadSha,
          controlled_tree_sha256:
            sourceScan.source_snapshot.controlled_tree_sha256,
        },
      }),
      'record passed post-snapshot verification',
    )

    const roadmapPath = join(root, '.planning/ROADMAP.md')
    let roadmap = await readFile(roadmapPath, 'utf8')
    roadmap = roadmap
      .replace(
        /\*\*Plans\*\*: \d+\/\d+ plans executed/,
        '**Plans**: 23/23 plans executed',
      )
      .replace(
        /Phase 5 current gap-closure cycle: \*\*Plans\*\*: \d+\/\d+ plans executed/,
        'Phase 5 current gap-closure cycle: **Plans**: 23/23 plans executed',
      )
      .replace(
        /\| 5\. Outreach Feasibility Gate \| v1\.1 \| \d+\/\d+ \| [^|]+?\s*\|[^|]*\|/,
        '| 5. Outreach Feasibility Gate | v1.1 | 23/23 | Complete | 2026-07-31 |',
      )
    for (let plan = 20; plan <= 23; plan += 1) {
      roadmap = roadmap.replace(
        `- [ ] 05-${plan}-PLAN.md`,
        `- [x] 05-${plan}-PLAN.md`,
      )
    }
    await writeFile(roadmapPath, roadmap)

    const statePath = join(root, '.planning/STATE.md')
    const state = (await readFile(statePath, 'utf8'))
      .replace(/^status: executing$/m, 'status: complete')
      .replace(
        /^stopped_at:.*$/m,
        'stopped_at: Completed 05-23-PLAN.md',
      )
      .replace(/^  total_plans: \d+$/m, '  total_plans: 23')
      .replace(/^  completed_plans: \d+$/m, '  completed_plans: 23')
      .replace(/^  percent: \d+$/m, '  percent: 100')
      .replace(
        /^Phase: 05 .*$/m,
        'Phase: 05 (outreach-feasibility-gate) — COMPLETE',
      )
      .replace(/^Plan: \d+ of \d+$/m, 'Plan: 23 of 23')
      .replace(/^Status:.*$/m, 'Status: Complete')
    await writeFile(statePath, state)
    await git(root, ['add', '.planning/ROADMAP.md', '.planning/STATE.md'])
    await git(root, ['commit', '-qm', 'complete post-snapshot tracking'])

    const liveScan = await scanOwnedSurfaces(
      await scanOptions(root, sourceHeadSha),
    )
    assert.equal(
      liveScan.administrative_tail_policy.source_changes_allowed,
      false,
    )
    assert.equal(
      liveScan.administrative_tail_policy.allowed_paths.includes(
        `${PHASE_RELATIVE}/05-REVIEW-FIX.md`,
      ),
      false,
    )
    assert.deepEqual(
      [...new Set(
        liveScan.administrative_tail.transitions.map(({ path }) => path),
      )].sort(),
      [
        '.planning/ROADMAP.md',
        '.planning/STATE.md',
        REVIEW_RELATIVE,
        VERIFICATION_RELATIVE,
      ].sort(),
    )
    assert.equal(liveScan.source_snapshot.head_sha, sourceHeadSha)
  } finally {
    await rm(owner, { recursive: true, force: true })
  }
})

test('tracking projections reject unrelated lookalikes and ambiguous Phase 5 nodes', async () => {
  const cases = [
    {
      name: 'unrelated roadmap completion replaces the Phase 5 row',
      path: '.planning/ROADMAP.md',
      mutate: (text) => text.replace(
        '- [ ] **Phase 5: Outreach Feasibility Gate**',
        '- [x] **Phase 4: Unrelated Complete**',
      ),
    },
    {
      name: 'unrelated requirement replaces OUTR-04',
      path: '.planning/REQUIREMENTS.md',
      mutate: (text) => text.replace(
        '- [x] **OUTR-04**:',
        '- [x] **UNREL-01**:',
      ),
    },
    {
      name: 'unrelated state velocity changes',
      path: '.planning/STATE.md',
      mutate: (text) => text.replace(
        '- Total plans completed: 88',
        '- Total plans completed: 89',
      ),
    },
    {
      name: 'duplicate Phase 5 roadmap section',
      path: '.planning/ROADMAP.md',
      mutate: (text) => text.replace(
        '### Phase 5: Outreach Feasibility Gate',
        '### Phase 5: Outreach Feasibility Gate\n'
          + '### Phase 5: Outreach Feasibility Gate',
      ),
    },
  ]
  for (const fixture of cases) {
    await withRepository(async (root) => {
      const sourceHeadSha = await headSha(root)
      const source = await readFile(join(root, fixture.path), 'utf8')
      const mutated = fixture.mutate(source)
      assert.notEqual(mutated, source, fixture.name)
      await commitFile(
        root,
        fixture.path,
        mutated,
        fixture.name,
      )
      await assert.rejects(
        scanOwnedSurfaces(await scanOptions(root, sourceHeadSha)),
        /ROADMAP|REQUIREMENTS|STATE|tracking|Phase 5|OUTR|duplicate/i,
        fixture.name,
      )
    })
  }
})

test('tracking projections admit the exact current Phase 5 named nodes', async () => {
  await withRepository(async (root) => {
    const sourceHeadSha = await headSha(root)
    await commitAdministrativeDocuments(
      root,
      [
        '.planning/ROADMAP.md',
        '.planning/REQUIREMENTS.md',
        '.planning/STATE.md',
      ],
      'advance exact Phase 5 tracking nodes',
    )
    const scan = await scanOwnedSurfaces(
      await scanOptions(root, sourceHeadSha),
    )
    assert.ok(
      scan.administrative_tail.transitions.some(
        (transition) => transition.transition === 'roadmap',
      ),
    )
    assert.ok(
      scan.administrative_tail.transitions.some(
        (transition) => transition.transition === 'state',
      ),
    )
  })
})

test('unrelated committed, modified, and untracked paths stay outside the claim', async () => {
  await withRepository(async (root) => {
    const sourceHeadSha = await headSha(root)
    const committedPath = 'unrelated-residue-note.txt'
    const untrackedPath = 'unrelated-residue-untracked.txt'
    await writeFile(join(root, committedPath), 'committed outside scope\n')
    await git(root, ['add', committedPath])
    await git(root, ['commit', '-qm', 'unrelated repository work'])
    await writeFile(join(root, committedPath), 'modified outside scope\n')
    await writeFile(join(root, untrackedPath), 'untracked outside scope\n')
    const before = [
      await readFile(join(root, committedPath), 'utf8'),
      await readFile(join(root, untrackedPath), 'utf8'),
    ]

    const scan = await scanOwnedSurfaces(
      await scanOptions(root, sourceHeadSha),
    )
    assert.equal(scan.administrative_tail.commit_count, 1)
    assert.equal(scan.administrative_tail.path_count, 0)
    assert.deepEqual([
      await readFile(join(root, committedPath), 'utf8'),
      await readFile(join(root, untrackedPath), 'utf8'),
    ], before)
  })
})

test('controlled worktree and index projections bind every count, path list, and inventory field', async () => {
  await withRepository(async (root) => {
    const scan = await scanOwnedSurfaces(await scanOptions(root))
    const evidence = await authenticatedLiveEvidence(root, scan)
    const mutations = [
      (record) => {
        record.git_surfaces.worktree.status_entry_count = 1
      },
      (record) => {
        record.git_surfaces.worktree.status_paths = [RIGHTS_SOURCE]
      },
      (record) => {
        record.git_surfaces.worktree.path_count += 1
      },
      (record) => {
        record.git_surfaces.worktree.blob_count += 1
      },
      (record) => {
        record.git_surfaces.worktree.inventory_sha256 = 'f'.repeat(64)
      },
      (record) => {
        record.git_surfaces.index.staged_path_count = 1
      },
      (record) => {
        record.git_surfaces.index.staged_paths = [RIGHTS_SOURCE]
      },
      (record) => {
        record.git_surfaces.index.path_count += 1
      },
      (record) => {
        record.git_surfaces.index.blob_count += 1
      },
      (record) => {
        record.git_surfaces.index.inventory_sha256 = 'f'.repeat(64)
      },
    ]
    for (const mutate of mutations) {
      const record = structuredClone(evidence.record)
      mutate(record)
      const rehashed = rehashRecord(record)
      const decision = {
        ...structuredClone(evidence.decision),
        zero_residue_sha256: rehashed.zero_residue_sha256,
      }
      await assert.rejects(
        async () => assertRecordMatchesLiveScan(
          rehashed,
          scan,
          {
            decision,
            ownerCheckpoint: evidence.receipt,
            repoRoot: root,
            ...evidence.publicProof,
          },
        ),
        /count|path|inventory|surface|drift/i,
      )
    }
  })
})

test('controlled dirty and staged paths block while complex unrelated owner dirt remains byte-exact', async () => {
  for (const controlledState of ['modified', 'staged']) {
    await withRepository(async (root) => {
      const sourceHeadSha = await headSha(root)
      const ownerPaths = [
        'owner-modified-雪.txt',
        'owner-staged space.txt',
        'owner-renamed-before.txt',
        'owner-renamed-after.txt',
        'owner-deleted.txt',
        'owner-untracked-ß.txt',
      ]
      await writeFile(join(root, ownerPaths[0]), 'owner modified base\n')
      await writeFile(join(root, ownerPaths[1]), 'owner staged base\n')
      await writeFile(join(root, ownerPaths[2]), 'owner rename base\n')
      await writeFile(join(root, ownerPaths[4]), 'owner delete base\n')
      await git(root, ['add', ...ownerPaths.slice(0, 3), ownerPaths[4]])
      await git(root, ['commit', '-qm', 'install unrelated owner fixture'])
      await writeFile(join(root, ownerPaths[0]), 'owner modified live\n')
      await writeFile(join(root, ownerPaths[1]), 'owner staged live\n')
      await git(root, ['add', ownerPaths[1]])
      await git(root, ['mv', ownerPaths[2], ownerPaths[3]])
      await rm(join(root, ownerPaths[4]))
      await writeFile(join(root, ownerPaths[5]), 'owner untracked live\n')

      const controlledPath = join(root, RIGHTS_SOURCE)
      const controlledBytes = await readFile(controlledPath)
      await appendFile(controlledPath, '\n// controlled dirt fixture\n')
      if (controlledState === 'staged') {
        await git(root, ['add', RIGHTS_SOURCE])
      }
      const ownerBefore = await ownerPathSnapshot(root, ownerPaths)
      const scan = await scanOwnedSurfaces(
        await scanOptions(root, sourceHeadSha),
      )
      const evidence = await authenticatedLiveEvidence(root, scan)

      if (controlledState === 'modified') {
        assert.deepEqual(
          scan.git_surfaces.worktree.status_paths,
          [RIGHTS_SOURCE],
        )
        assert.deepEqual(scan.git_surfaces.index.staged_paths, [])
      } else {
        assert.deepEqual(
          scan.git_surfaces.worktree.status_paths,
          [RIGHTS_SOURCE],
        )
        assert.deepEqual(
          scan.git_surfaces.index.staged_paths,
          [RIGHTS_SOURCE],
        )
      }
      await assert.rejects(
        async () => assertRecordMatchesLiveScan(
          evidence.record,
          scan,
          {
            decision: evidence.decision,
            ownerCheckpoint: evidence.receipt,
            repoRoot: root,
            ...evidence.publicProof,
          },
        ),
        /controlled worktree and index surfaces must be clean/i,
      )
      assert.deepEqual(
        await ownerPathSnapshot(root, ownerPaths),
        ownerBefore,
      )
      await writeFile(controlledPath, controlledBytes)
    })
  }
})

test('controlled and accepted-pair transaction symlinks fail before any target read', async () => {
  const cases = [
    RIGHTS_SOURCE,
    `${PHASE_RELATIVE}/.05-accepted-evidence.lock`,
    `${PHASE_RELATIVE}/.05-DECISION.json.00000000-0000-4000-8000-000000000000.stage`,
    `${PHASE_RELATIVE}/.05-accepted-evidence.journal.json.00000000-0000-4000-8000-000000000000.prepared.stage`,
  ]
  for (const relativePath of cases) {
    await withRepository(async (root) => {
      if (relativePath === RIGHTS_SOURCE) {
        await rm(join(root, relativePath))
      }
      await symlink(
        'target-that-must-never-be-read',
        join(root, relativePath),
      )
      await assert.rejects(
        scanOwnedSurfaces(await scanOptions(root)),
        /symlink|transaction|residue|unexpected phase path/i,
      )
    })
  }
})

test('record mutations fail for every bound surface and zero counter', async () => {
  await withRepository(async (root) => {
    const scan = await scanOwnedSurfaces(await scanOptions(root))
    const evidence = await liveEvidence(root, scan)
    const mutations = [
      (record) => {
        record.source_snapshot.head_sha = 'f'.repeat(40)
      },
      (record) => {
        record.source_snapshot.controlled_tree_sha256 = 'f'.repeat(64)
      },
      (record) => {
        record.source_snapshot.baseline_to_source_history_sha256 =
          'f'.repeat(64)
      },
      (record) => {
        record.git_surfaces.worktree.inventory_sha256 = 'f'.repeat(64)
      },
      (record) => {
        record.git_surfaces.index.inventory_sha256 = 'f'.repeat(64)
      },
      (record) => {
        record.git_surfaces.phase_commit_range.inventory_sha256 =
          'f'.repeat(64)
      },
      (record) => {
        record.git_surfaces.source_head_tree.tree_sha256 = 'f'.repeat(64)
      },
      ...[
        'provider_call_count',
        'fixture_count',
        'raw_result_count',
        'production_mutation_count',
        'forbidden_hit_count',
        'unexpected_survivor_count',
        'symlink_count',
      ].map((key) => (record) => {
        record[key] = 1
      }),
    ]
    for (const mutate of mutations) {
      const record = structuredClone(evidence.record)
      mutate(record)
      assert.throws(
        () => assertRecordMatchesLiveScan(
          record,
          scan,
          {
            decision: evidence.decision,
            ownerCheckpoint: evidence.receipt,
          },
        ),
        /digest|zero|drift|source|surface/i,
      )
    }
  })
})

test('control and sensitive filenames cannot forge or disclose diagnostics', async () => {
  const filenames = [
    `unexpected-${SOURCE_SECRET}.mjs`,
    'unexpected-newline\nforged.mjs',
    'unexpected-carriage\rforged.mjs',
    'unexpected-tab\tforged.mjs',
    'unexpected-ansi\u001b[31mforged.mjs',
    'unexpected-c0\u0001forged.mjs',
  ]
  await withRepository(async (root) => {
    for (const filename of filenames) {
      const path = join(root, 'scripts/outreach-feasibility', filename)
      await writeFile(path, 'export const safe = true\n')
      await assert.rejects(
        scanOwnedSurfaces(await scanOptions(root)),
        (error) => {
          assert.equal(error.message.split('\n').length, 1)
          assert.doesNotMatch(error.message, new RegExp(SOURCE_SECRET))
          assert.doesNotMatch(error.message, /[\r\t\u001b\u0001]/)
          return true
        },
      )
      await rm(path)
    }
  })
})

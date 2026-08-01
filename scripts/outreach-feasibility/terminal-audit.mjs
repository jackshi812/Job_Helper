#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, readdir, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual, promisify } from 'node:util'
import {
  assertAuthenticatedAcceptedEvidence,
  assertArtifactSchema,
  assertExecutionBaseline,
  assertPhase5ReviewLifecycle,
  assertPublishableZeroResidueRecord,
  resolveCheckpointedDecisionContractSha256,
} from './evidence-integrity.mjs'
import {
  extractRequirementsTerminalContract,
  extractRoadmapTerminalContract,
} from './authorization-evidence-validators.mjs'
import { assertOwnerCheckpointRecord } from './owner-checkpoint.mjs'
import {
  assertCompleteVerificationDocument,
  assertRecordMatchesLiveScan,
  readAcceptedEvidencePair,
  scanOwnedSurfaces,
} from './residue-check.mjs'
import {
  assertNoGoQualityReport,
  evaluateRights,
  sha256Json,
} from './rights-gate.mjs'

const execFileAsync = promisify(execFile)
const PHASE_DIR =
  '.planning/phases/05-outreach-feasibility-gate'
const MAX_FILE_BYTES = 1_000_000
const MAX_GIT_BUFFER = 40_000_000
const SHA = /^[0-9a-f]{40}$/
const DISALLOWED_CONTROLS =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/

export const TERMINAL_AUDIT_COMMAND =
  'env -u TAVILY_API_KEY GIT_OPTIONAL_LOCKS=0 node scripts/outreach-feasibility/terminal-audit.mjs --terminal-audit --repo-root . --phase-dir .planning/phases/05-outreach-feasibility-gate'
export const TERMINAL_AUDIT_RUNBOOK = [
  'Phase 5 terminal audit runbook',
  '',
  '1. Run `$gsd-execute-phase 5 --gaps-only` and wait until it fully returns after all standard plan closeout, wave-post gates, code review, verification, `phase.complete`, tracking synchronization, project/todo maintenance, and post hooks.',
  `2. Without making another Phase 5 mutation, run \`${TERMINAL_AUDIT_COMMAND}\`.`,
  '',
  'The second command is authoritative only after the first command has fully returned. Plan 05-10 tests and SUMMARY are implementation evidence only; no GSD hook invokes this audit. Successful stdout is the final authoritative check. Do not save stdout as a required evidence artifact, and do not make a follow-up commit.',
].join('\n')

const PATHS = Object.freeze({
  baseline: `${PHASE_DIR}/05-EXECUTION-BASELINE.json`,
  matrix: `${PHASE_DIR}/05-RIGHTS-MATRIX.json`,
  qualityReport: `${PHASE_DIR}/05-QUALITY-REPORT.json`,
  decision: `${PHASE_DIR}/05-DECISION.json`,
  request: `${PHASE_DIR}/05-OWNER-CHECKPOINT-REQUEST.json`,
  ownerCheckpoint: `${PHASE_DIR}/05-OWNER-CHECKPOINT.json`,
  ownerAuthorizationRequest:
    `${PHASE_DIR}/05-OWNER-AUTHORIZATION-REQUEST.json`,
  ownerAuthorizationSignature:
    `${PHASE_DIR}/05-OWNER-AUTHORIZATION-REQUEST.json.sig`,
  ownerTrustAnchor:
    'scripts/outreach-feasibility/trust/owner-trust-anchor.json',
  ownerPublicKey:
    'scripts/outreach-feasibility/trust/phase-05-owner.pub',
  ownerAllowedSigners:
    'scripts/outreach-feasibility/trust/phase-05-owner.allowed_signers.txt',
  residue: `${PHASE_DIR}/05-ZERO-RESIDUE.json`,
  reconciliation: `${PHASE_DIR}/05-CONTRACT-RECONCILIATION.json`,
  review: `${PHASE_DIR}/05-REVIEW.md`,
  verification: `${PHASE_DIR}/05-VERIFICATION.md`,
  roadmap: '.planning/ROADMAP.md',
  requirements: '.planning/REQUIREMENTS.md',
  state: '.planning/STATE.md',
  project: '.planning/PROJECT.md',
})

export {
  extractRequirementsTerminalContract,
  extractRoadmapTerminalContract,
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message)
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function requireText(text, label) {
  requireCondition(
    typeof text === 'string'
      && text.length > 0
      && Buffer.byteLength(text, 'utf8') <= MAX_FILE_BYTES
      && !DISALLOWED_CONTROLS.test(text),
    `${label} is malformed`,
  )
}

function requireSemanticTokens(text, tokens, label) {
  for (const token of tokens) {
    requireCondition(
      text.includes(token),
      `${label} terminal contract is missing ${token}`,
    )
  }
}

function assertAcceptedEvidence({
  matrix,
  qualityReport,
  decision,
  ownerCheckpoint,
  residue,
}) {
  const verdict = evaluateRights(matrix)
  requireCondition(
    verdict.status === 'RIGHTS_NO_GO'
      && verdict.search_authorized === false
      && verdict.quality_status === 'NOT_RUN_RIGHTS_NO_GO',
    'terminal reconciliation requires current RIGHTS_NO_GO evidence',
  )
  assertNoGoQualityReport(matrix, qualityReport)
  assertArtifactSchema(PATHS.decision, decision)
  assertArtifactSchema(PATHS.ownerCheckpoint, ownerCheckpoint)
  assertArtifactSchema(PATHS.residue, residue)
  requireCondition(
    decision.schema_version === 3
      && residue.schema_version === 4
      && decision.status === 'RIGHTS_NO_GO_ACCEPTED',
    'terminal reconciliation requires authenticated v3/v4 evidence',
  )
  const checkpointedDigest =
    resolveCheckpointedDecisionContractSha256({
      decision,
      matrix,
      qualityReport,
    })
  requireCondition(
    checkpointedDigest
      === ownerCheckpoint.checkpointed_decision_contract_sha256,
    'terminal reconciliation checkpointed decision digest drift',
  )
  requireCondition(
    decision.owner_checkpoint_evidence_sha256
      === ownerCheckpoint.owner_checkpoint_evidence_sha256,
    'terminal reconciliation owner checkpoint digest drift',
  )
  requireCondition(
    decision.zero_residue_sha256 === residue.zero_residue_sha256,
    'terminal reconciliation zero-residue digest drift',
  )
  for (const key of [
    'provider_call_count',
    'fixture_count',
    'raw_result_count',
    'production_mutation_count',
  ]) {
    requireCondition(
      decision[key] === 0
        && qualityReport[key] === 0
        && residue[key] === 0,
      `terminal reconciliation ${key} must equal zero`,
    )
  }
  requireCondition(
    decision.representative_case_count === 0
      && residue.representative_case_count === 0,
    'terminal reconciliation representative_case_count must equal zero',
  )
  requireCondition(
    decision.search_authorized === false
      && decision.production_outreach_enabled === false
      && decision.phase_6_authorized === false
      && decision.phase_7_authorized === false
      && decision.outreach_milestone_status === 'STOPPED_RIGHTS_NO_GO'
      && decision.quality_status === 'NOT_RUN_RIGHTS_NO_GO',
    'terminal reconciliation decision authorization drift',
  )
  for (const key of [
    'owner_authorization_request_sha256',
    'owner_authorization_signature_sha256',
    'owner_authorization_principal',
    'owner_authorization_namespace',
    'owner_authorization_key_fingerprint',
    'owner_authorization_nonce_sha256',
    'owner_authorization_issued_at',
    'owner_authorization_verified_at',
    'owner_authorization_stopped_decision_payload_sha256',
  ]) {
    requireCondition(
      decision[key] === residue[key],
      `terminal reconciliation authenticated field drift: ${key}`,
    )
  }
  requireCondition(
    decision.redesign_selection === null
      && Array.isArray(qualityReport.cases)
      && qualityReport.cases.length === 0
      && residue.provider_side_retention === 'NOT_ASSERTED',
    'terminal reconciliation no-run posture drift',
  )
  return checkpointedDigest
}

export function buildContractReconciliation({
  matrix,
  qualityReport,
  decision,
  ownerCheckpoint,
  residue,
  roadmapText,
  requirementsText,
}) {
  const checkpointedDigest = assertAcceptedEvidence({
    matrix,
    qualityReport,
    decision,
    ownerCheckpoint,
    residue,
  })
  const roadmapProjection =
    extractRoadmapTerminalContract(roadmapText)
  const requirementsProjection =
    extractRequirementsTerminalContract(requirementsText)
  const body = {
    schema_version: 2,
    phase: '05',
    requirement_id: 'OUTR-05',
    status: 'ACCEPTED_RIGHTS_NO_GO_RECONCILED',
    original_representative_spike_intent:
      'Run a representative 6-10 application quality test only after rights clearance.',
    rights_prerequisite: 'NOT_CLEARED_RIGHTS_NO_GO',
    quality_status: 'NOT_RUN_RIGHTS_NO_GO',
    spike_executed: false,
    representative_case_count: 0,
    provider_call_count: 0,
    fixture_count: 0,
    raw_result_count: 0,
    production_mutation_count: 0,
    quality_claim: 'NONE',
    d09_resolution: 'CLEAR_PROHIBITION_CAUSED_RIGHTS_NO_GO',
    d10_resolution: 'UNRESOLVED_AMBIGUITY_CAUSED_RIGHTS_NO_GO',
    d12_resolution: 'RIGHTS_REVIEW_BLOCKED_LIVE_SPIKE',
    d13_resolution: 'OUTREACH_MILESTONE_STOPPED',
    rights_evidence_sha256: matrix.rights_evidence_sha256,
    quality_evidence_sha256:
      qualityReport.quality_evidence_sha256,
    checkpointed_decision_contract_sha256: checkpointedDigest,
    decision_contract_sha256: decision.decision_contract_sha256,
    owner_checkpoint_evidence_sha256:
      ownerCheckpoint.owner_checkpoint_evidence_sha256,
    zero_residue_sha256: residue.zero_residue_sha256,
    roadmap_semantic_sha256: sha256Json(roadmapProjection),
    requirements_semantic_sha256:
      sha256Json(requirementsProjection),
    owner_authorization_request_sha256:
      decision.owner_authorization_request_sha256,
    owner_authorization_signature_sha256:
      decision.owner_authorization_signature_sha256,
    owner_authorization_principal:
      decision.owner_authorization_principal,
    owner_authorization_namespace:
      decision.owner_authorization_namespace,
    owner_authorization_key_fingerprint:
      decision.owner_authorization_key_fingerprint,
    owner_authorization_nonce_sha256:
      decision.owner_authorization_nonce_sha256,
    owner_authorization_stopped_decision_payload_sha256:
      decision.owner_authorization_stopped_decision_payload_sha256,
  }
  const record = {
    ...body,
    contract_reconciliation_sha256: sha256Json(body),
  }
  assertArtifactSchema(PATHS.reconciliation, record)
  return record
}

export function assertContractReconciliation(record, evidence) {
  assertArtifactSchema(PATHS.reconciliation, record)
  const expected = buildContractReconciliation(evidence)
  requireCondition(
    isDeepStrictEqual(record, expected),
    'contract reconciliation does not match terminal evidence',
  )
  return record
}

async function runGit(repoRoot, args, options = {}) {
  try {
    return await execFileAsync('git', args, {
      cwd: repoRoot,
      encoding: options.encoding ?? 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        LANG: 'C',
        LC_ALL: 'C',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_OPTIONAL_LOCKS: '0',
      },
      maxBuffer: MAX_GIT_BUFFER,
    })
  } catch {
    throw new Error(`terminal audit Git inspection failed during ${args[0]}`)
  }
}

function isOwnedPath(pathBytes) {
  const exact = [
    PATHS.roadmap,
    PATHS.requirements,
    PATHS.state,
    PATHS.project,
  ].map((path) => Buffer.from(path, 'utf8'))
  if (exact.some((path) => path.equals(pathBytes))) return true
  return [
    'scripts/outreach-feasibility/',
    `${PHASE_DIR}/`,
  ].some((prefix) => pathBytes.subarray(
    0,
    Buffer.byteLength(prefix),
  ).equals(Buffer.from(prefix, 'utf8')))
}

function splitStatusEntries(rawStatus) {
  requireCondition(
    Buffer.isBuffer(rawStatus),
    'terminal audit status must be raw bytes',
  )
  const fields = []
  let offset = 0
  while (offset < rawStatus.length) {
    const end = rawStatus.indexOf(0, offset)
    requireCondition(end >= 0, 'terminal audit status is truncated')
    fields.push(rawStatus.subarray(offset, end))
    offset = end + 1
  }
  const entries = []
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]
    requireCondition(
      field.length >= 4
        && field[2] === 0x20
        && field[0] !== 0x00
        && field[1] !== 0x00,
      'terminal audit status entry is malformed',
    )
    const status = field.subarray(0, 2)
    const paths = [field.subarray(3)]
    if (
      status[0] === 0x52
      || status[0] === 0x43
      || status[1] === 0x52
      || status[1] === 0x43
    ) {
      requireCondition(
        index + 1 < fields.length,
        'terminal audit rename status is truncated',
      )
      paths.push(fields[++index])
    }
    entries.push({ field, paths })
  }
  return entries
}

function classifyStatus(rawStatus) {
  const entries = splitStatusEntries(rawStatus)
  const owned = entries.filter((entry) =>
    entry.paths.some((path) => isOwnedPath(path)))
  const unrelated = entries.filter((entry) =>
    !entry.paths.some((path) => isOwnedPath(path)))
  const inventory = Buffer.concat(
    unrelated.flatMap((entry) => [
      entry.field,
      Buffer.from([0]),
      ...entry.paths.slice(1).flatMap((path) => [
        path,
        Buffer.from([0]),
      ]),
    ]),
  )
  return {
    ownedCount: owned.length,
    unrelatedCount: unrelated.length,
    unrelatedInventorySha256: sha256Bytes(inventory),
  }
}

async function captureRepositoryState(repoRoot) {
  const [headResult, statusResult] = await Promise.all([
    runGit(repoRoot, ['rev-parse', 'HEAD']),
    runGit(repoRoot, [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
    ], { encoding: 'buffer' }),
  ])
  const head = headResult.stdout.trim()
  requireCondition(SHA.test(head), 'terminal audit HEAD is malformed')
  return {
    head,
    status: statusResult.stdout,
    classification: classifyStatus(statusResult.stdout),
  }
}

async function readBounded(repoRoot, relativePath) {
  let bytes
  try {
    bytes = await readFile(resolve(repoRoot, relativePath))
  } catch {
    throw new Error(
      `terminal lifecycle artifact is missing or unreadable: ${relativePath}`,
    )
  }
  requireCondition(
    bytes.length > 0 && bytes.length <= MAX_FILE_BYTES,
    `terminal audit artifact is outside the size bound: ${relativePath}`,
  )
  return bytes
}

async function readBoundedGitPath(repoRoot, commit, relativePath) {
  requireCondition(
    typeof commit === 'string' && SHA.test(commit),
    'terminal lifecycle source snapshot SHA is malformed',
  )
  let bytes
  try {
    bytes = (
      await runGit(
        repoRoot,
        ['show', `${commit}:${relativePath}`],
        { encoding: 'buffer' },
      )
    ).stdout
  } catch {
    throw new Error(
      `terminal lifecycle source artifact is missing: ${relativePath}`,
    )
  }
  requireCondition(
    Buffer.isBuffer(bytes)
      && bytes.length > 0
      && bytes.length <= MAX_FILE_BYTES,
    `terminal lifecycle source artifact is outside the size bound: ${relativePath}`,
  )
  return bytes
}

async function readText(repoRoot, relativePath) {
  const bytes = await readBounded(repoRoot, relativePath)
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error(`terminal audit artifact is not UTF-8: ${relativePath}`)
  }
  requireCondition(
    !DISALLOWED_CONTROLS.test(text),
    `terminal audit artifact contains controls: ${relativePath}`,
  )
  return { bytes, text }
}

async function readJson(repoRoot, relativePath) {
  const { bytes, text } = await readText(repoRoot, relativePath)
  try {
    return { bytes, value: JSON.parse(text) }
  } catch {
    throw new Error(`terminal audit artifact is malformed JSON: ${relativePath}`)
  }
}

function frontmatterValue(text, key) {
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1]
  requireCondition(frontmatter, 'terminal lifecycle frontmatter is missing')
  return frontmatter.match(
    new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm'),
  )?.[1]
}

function planIdFromFilename(filename, suffix) {
  return filename.match(
    new RegExp(`^05-(\\d{2})-${suffix}\\.md$`),
  )?.[1] ?? null
}

async function readPhasePlanInventory(root) {
  const entries = await readdir(resolve(root, PHASE_DIR), {
    withFileTypes: true,
  })
  const planIds = entries
    .filter((entry) => entry.isFile())
    .map((entry) => planIdFromFilename(entry.name, 'PLAN'))
    .filter(Boolean)
    .sort()
  const summaryIds = entries
    .filter((entry) => entry.isFile())
    .map((entry) => planIdFromFilename(entry.name, 'SUMMARY'))
    .filter(Boolean)
    .sort()
  requireCondition(planIds.length > 0, 'Phase 5 plan inventory is empty')
  requireCondition(
    planIds.every(
      (plan, index) => plan === String(index + 1).padStart(2, '0'),
    ),
    'Phase 5 plan inventory is not contiguous',
  )
  requireCondition(
    isDeepStrictEqual(summaryIds, planIds),
    'Phase 5 summary inventory does not match plan inventory',
  )
  const summaries = await Promise.all(planIds.map(async (plan) => ({
    plan,
    artifact: await readText(
      root,
      `${PHASE_DIR}/05-${plan}-SUMMARY.md`,
    ),
  })))
  return {
    planIds,
    planCount: planIds.length,
    summaries,
  }
}

export async function assertTerminalLifecycle({
  roadmap,
  requirements,
  state,
  project,
  priorReviewBytes,
  priorReviewSourceSha256,
  reviewBytes,
  verification,
  verificationEvidenceSnapshot,
  verificationRepositoryRoot,
  verificationRunner,
  planInventory,
}) {
  extractRoadmapTerminalContract(roadmap)
  extractRequirementsTerminalContract(requirements)
  requireCondition(
    planInventory
      && Number.isSafeInteger(planInventory.planCount)
      && planInventory.planCount > 0
      && Array.isArray(planInventory.planIds)
      && Array.isArray(planInventory.summaries),
    'Phase 5 plan inventory is malformed',
  )
  const completedPlanToken =
    `Phase 5 current gap-closure cycle: **Plans**: ${planInventory.planCount}/${planInventory.planCount} plans executed`
  requireSemanticTokens(roadmap, [
    completedPlanToken,
    `| 5. Outreach Feasibility Gate | v1.1 | ${planInventory.planCount}/${planInventory.planCount} | Complete |`,
    'Phase 5 only',
    'no production outreach search',
  ], 'roadmap lifecycle')
  for (const plan of planInventory.planIds) {
    requireCondition(
      roadmap.includes(`- [x] 05-${plan}-PLAN.md`),
      `roadmap lifecycle plan 05-${plan} is not complete`,
    )
  }
  requireCondition(
    !/^- \[ \] 05-\d{2}-PLAN\.md\b/m.test(roadmap),
    'roadmap lifecycle contains an incomplete Phase 5 plan',
  )
  requireCondition(
    !/\*\*Phase [67]:/.test(roadmap),
    'roadmap lifecycle must not admit Phase 6 or Phase 7',
  )
  requireSemanticTokens(state, [
    `total_plans: ${planInventory.planCount}`,
    `completed_plans: ${planInventory.planCount}`,
    'percent: 100',
    `Plan: ${planInventory.planCount} of ${planInventory.planCount}`,
    'Status: Complete',
  ], 'state lifecycle')
  requireCondition(
    frontmatterValue(state, 'status') === 'complete',
    'state lifecycle is not complete',
  )
  requireText(project, 'project lifecycle')
  assertPhase5ReviewLifecycle({
    priorReviewBytes,
    finalReviewBytes: reviewBytes,
    ...(priorReviewSourceSha256
      ? { priorReviewSourceSha256 }
      : {}),
  })
  await assertCompleteVerificationDocument(
    verification,
    'passed',
    verificationEvidenceSnapshot,
    verificationRepositoryRoot,
    verificationRunner,
  )
  for (const { plan, artifact } of planInventory.summaries) {
    requireCondition(
      frontmatterValue(artifact.text, 'phase')
        === '05-outreach-feasibility-gate'
        && frontmatterValue(artifact.text, 'plan') === plan
        && frontmatterValue(artifact.text, 'status') === 'complete'
        && artifact.text.includes('## Self-Check: PASSED'),
      `05-${plan} summary is not complete`,
    )
  }
}

async function resolveAuditRoot(repoRoot, phaseDir) {
  requireCondition(
    typeof repoRoot === 'string' && repoRoot.trim().length > 0,
    'terminal audit repository root is required',
  )
  requireCondition(
    phaseDir === PHASE_DIR,
    'terminal audit phase directory must be the canonical Phase 5 path',
  )
  const root = await realpath(resolve(repoRoot))
  const gitRoot = (
    await runGit(root, ['rev-parse', '--show-toplevel'])
  ).stdout.trim()
  requireCondition(
    await realpath(gitRoot) === root,
    'terminal audit repository root is not canonical',
  )
  requireCondition(
    await realpath(resolve(root, phaseDir))
      === resolve(root, PHASE_DIR),
    'terminal audit phase directory escapes the repository',
  )
  return root
}

function ownerProofPaths(root) {
  return {
    requestPath: resolve(root, PATHS.ownerAuthorizationRequest),
    signaturePath: resolve(root, PATHS.ownerAuthorizationSignature),
    trustAnchorPath: resolve(root, PATHS.ownerTrustAnchor),
    publicKeyPath: resolve(root, PATHS.ownerPublicKey),
    allowedSignersPath: resolve(root, PATHS.ownerAllowedSigners),
  }
}

async function authenticateStableEvidence(
  root,
  decision,
  residue,
  reconciliation,
) {
  return assertAuthenticatedAcceptedEvidence({
    decision,
    residue,
    reconciliation,
    ...ownerProofPaths(root),
    now: decision.owner_authorization_verified_at,
  })
}

async function validateStableContract(root) {
  const acceptedPair = await readAcceptedEvidencePair({
    decisionPath: resolve(root, PATHS.decision),
    recordPath: resolve(root, PATHS.residue),
  })
  const [
    baselineArtifact,
    matrixArtifact,
    qualityArtifact,
    requestArtifact,
    checkpointArtifact,
    reconciliationArtifact,
    roadmapArtifact,
    requirementsArtifact,
  ] = await Promise.all([
    readJson(root, PATHS.baseline),
    readJson(root, PATHS.matrix),
    readJson(root, PATHS.qualityReport),
    readJson(root, PATHS.request),
    readJson(root, PATHS.ownerCheckpoint),
    readJson(root, PATHS.reconciliation),
    readText(root, PATHS.roadmap),
    readText(root, PATHS.requirements),
  ])
  const baseline = baselineArtifact.value
  const matrix = matrixArtifact.value
  const qualityReport = qualityArtifact.value
  const decision = acceptedPair.decision
  const request = requestArtifact.value
  const ownerCheckpoint = checkpointArtifact.value
  const residue = acceptedPair.record
  const reconciliation = reconciliationArtifact.value
  assertArtifactSchema(PATHS.decision, decision)
  assertArtifactSchema(PATHS.residue, residue)
  assertPublishableZeroResidueRecord(residue)
  const checkpointedDigest =
    resolveCheckpointedDecisionContractSha256({
      decision,
      matrix,
      qualityReport,
    })
  await assertExecutionBaseline({
    record: baseline,
    repoRoot: root,
    sourceHeadSha: residue.source_snapshot.head_sha,
  })
  await authenticateStableEvidence(
    root,
    decision,
    residue,
    reconciliation,
  )
  assertOwnerCheckpointRecord({
    request,
    record: ownerCheckpoint,
    baseline,
    matrix,
    qualityReport,
    checkpointedDecisionContractSha256: checkpointedDigest,
  })
  assertContractReconciliation(reconciliation, {
    matrix,
    qualityReport,
    decision,
    ownerCheckpoint,
    residue,
    roadmapText: roadmapArtifact.text,
    requirementsText: requirementsArtifact.text,
  })
  return {
    baseline,
    matrix,
    qualityReport,
    decision,
    ownerCheckpoint,
    residue,
    reconciliation,
    roadmapArtifact,
    requirementsArtifact,
  }
}

export async function runContractValidation({
  repoRoot,
  phaseDir = PHASE_DIR,
}) {
  const root = await resolveAuditRoot(repoRoot, phaseDir)
  const evidence = await validateStableContract(root)
  return {
    status: 'CONTRACT_VALIDATION_PASS',
    authoritative: false,
    evidence: {
      rights_evidence_sha256:
        evidence.matrix.rights_evidence_sha256,
      quality_evidence_sha256:
        evidence.qualityReport.quality_evidence_sha256,
      decision_contract_sha256:
        evidence.decision.decision_contract_sha256,
      owner_checkpoint_evidence_sha256:
        evidence.ownerCheckpoint.owner_checkpoint_evidence_sha256,
      zero_residue_sha256:
        evidence.residue.zero_residue_sha256,
      contract_reconciliation_sha256:
        evidence.reconciliation.contract_reconciliation_sha256,
    },
  }
}

export async function runTerminalAudit({
  repoRoot,
  phaseDir = PHASE_DIR,
  _verificationRunnerForTests,
}) {
  const root = await resolveAuditRoot(repoRoot, phaseDir)
  const before = await captureRepositoryState(root)
  requireCondition(
    before.classification.ownedCount === 0,
    'terminal audit requires a clean Phase 5 owned surface',
  )
  const acceptedPair = await readAcceptedEvidencePair({
    decisionPath: resolve(root, PATHS.decision),
    recordPath: resolve(root, PATHS.residue),
  })
  const planInventory = await readPhasePlanInventory(root)

  const [
    baselineArtifact,
    matrixArtifact,
    qualityArtifact,
    requestArtifact,
    checkpointArtifact,
    reconciliationArtifact,
    roadmapArtifact,
    requirementsArtifact,
    stateArtifact,
    projectArtifact,
    reviewArtifact,
    verificationArtifact,
  ] = await Promise.all([
    readJson(root, PATHS.baseline),
    readJson(root, PATHS.matrix),
    readJson(root, PATHS.qualityReport),
    readJson(root, PATHS.request),
    readJson(root, PATHS.ownerCheckpoint),
    readJson(root, PATHS.reconciliation),
    readText(root, PATHS.roadmap),
    readText(root, PATHS.requirements),
    readText(root, PATHS.state),
    readText(root, PATHS.project),
    readText(root, PATHS.review),
    readText(root, PATHS.verification),
  ])
  const matrix = matrixArtifact.value
  const qualityReport = qualityArtifact.value
  const decision = acceptedPair.decision
  const ownerCheckpoint = checkpointArtifact.value
  const residue = acceptedPair.record
  assertArtifactSchema(PATHS.decision, decision)
  assertArtifactSchema(PATHS.residue, residue)
  assertPublishableZeroResidueRecord(residue)
  const checkpointedDigest =
    resolveCheckpointedDecisionContractSha256({
      decision,
      matrix,
      qualityReport,
    })
  await assertExecutionBaseline({
    record: baselineArtifact.value,
    repoRoot: root,
    sourceHeadSha: residue.source_snapshot.head_sha,
  })
  await authenticateStableEvidence(
    root,
    decision,
    residue,
    reconciliationArtifact.value,
  )
  assertOwnerCheckpointRecord({
    request: requestArtifact.value,
    record: ownerCheckpoint,
    baseline: baselineArtifact.value,
    matrix,
    qualityReport,
    checkpointedDecisionContractSha256: checkpointedDigest,
  })
  assertContractReconciliation(reconciliationArtifact.value, {
    matrix,
    qualityReport,
    decision,
    ownerCheckpoint,
    residue,
    roadmapText: roadmapArtifact.text,
    requirementsText: requirementsArtifact.text,
  })
  const priorReviewBytes = await readBoundedGitPath(
    root,
    residue.source_snapshot.head_sha,
    PATHS.review,
  )
  await assertTerminalLifecycle({
    roadmap: roadmapArtifact.text,
    requirements: requirementsArtifact.text,
    state: stateArtifact.text,
    project: projectArtifact.text,
    priorReviewBytes,
    priorReviewSourceSha256:
      createHash('sha256').update(priorReviewBytes).digest('hex'),
    reviewBytes: reviewArtifact.bytes,
    verification: verificationArtifact.text,
    verificationEvidenceSnapshot: {
      source_head_sha: residue.source_snapshot.head_sha,
      controlled_tree_sha256:
        residue.source_snapshot.controlled_tree_sha256,
    },
    verificationRepositoryRoot: root,
    verificationRunner: _verificationRunnerForTests,
    planInventory,
  })
  const liveScan = await scanOwnedSurfaces({
    repoRoot: root,
    phaseDir,
    baseline: baselineArtifact.value,
    sourceHeadSha: residue.source_snapshot.head_sha,
    verificationRunner: _verificationRunnerForTests,
  })
  await assertRecordMatchesLiveScan(residue, liveScan, {
    decision,
    ownerCheckpoint,
    repoRoot: root,
    ...ownerProofPaths(root),
  })

  const after = await captureRepositoryState(root)
  requireCondition(
    after.head === before.head
      && after.status.equals(before.status),
    'terminal audit changed repository state',
  )
  requireCondition(
    after.classification.ownedCount === 0,
    'terminal audit left the Phase 5 owned surface dirty',
  )
  return {
    status: 'TERMINAL_AUDIT_PASS',
    authoritative: true,
    live_head: before.head,
    source_head: residue.source_snapshot.head_sha,
    evidence: {
      rights_evidence_sha256: matrix.rights_evidence_sha256,
      quality_evidence_sha256:
        qualityReport.quality_evidence_sha256,
      decision_contract_sha256:
        decision.decision_contract_sha256,
      owner_checkpoint_evidence_sha256:
        ownerCheckpoint.owner_checkpoint_evidence_sha256,
      zero_residue_sha256: residue.zero_residue_sha256,
      contract_reconciliation_sha256:
        reconciliationArtifact.value
          .contract_reconciliation_sha256,
    },
    administrative_tail: {
      commit_count: liveScan.administrative_tail.commit_count,
      path_count: liveScan.administrative_tail.path_count,
      blob_count: liveScan.administrative_tail.blob_count,
      inventory_sha256:
        liveScan.administrative_tail.inventory_sha256,
    },
    document_fingerprints: {
      roadmap_sha256: sha256Bytes(roadmapArtifact.bytes),
      requirements_sha256: sha256Bytes(requirementsArtifact.bytes),
      state_sha256: sha256Bytes(stateArtifact.bytes),
      project_sha256: sha256Bytes(projectArtifact.bytes),
      review_sha256: sha256Bytes(reviewArtifact.bytes),
      verification_sha256:
        sha256Bytes(verificationArtifact.bytes),
    },
    unrelated_worktree: {
      entry_count: before.classification.unrelatedCount,
      inventory_sha256:
        before.classification.unrelatedInventorySha256,
    },
  }
}

function argumentError(message) {
  throw new Error(`terminal audit arguments: ${message}`)
}

function parseArgs(argv) {
  const result = {
    mode: null,
    repoRoot: null,
    phaseDir: null,
  }
  const modes = new Set([
    '--print-runbook',
    '--validate-contract',
    '--terminal-audit',
  ])
  const pathFlags = new Map([
    ['--repo-root', 'repoRoot'],
    ['--phase-dir', 'phaseDir'],
  ])
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (modes.has(argument)) {
      if (result.mode !== null) {
        argumentError('choose exactly one mode')
      }
      result.mode = argument
      continue
    }
    const key = pathFlags.get(argument)
    if (!key) argumentError('unknown or positional argument')
    if (result[key] !== null) argumentError(`duplicate ${argument}`)
    const value = argv[++index]
    if (!value || value.startsWith('--')) {
      argumentError(`${argument} requires a path`)
    }
    result[key] = value
  }
  if (result.mode === null) argumentError('choose exactly one mode')
  if (result.mode === '--print-runbook') {
    if (result.repoRoot !== null || result.phaseDir !== null) {
      argumentError('--print-runbook does not accept path flags')
    }
  } else if (result.repoRoot === null || result.phaseDir === null) {
    argumentError('--repo-root and --phase-dir are required')
  }
  return result
}

async function main(argv) {
  const args = parseArgs(argv)
  if (args.mode === '--print-runbook') {
    process.stdout.write(`${TERMINAL_AUDIT_RUNBOOK}\n`)
    return
  }
  const options = {
    repoRoot: args.repoRoot,
    phaseDir: args.phaseDir,
  }
  const report = args.mode === '--validate-contract'
    ? await runContractValidation(options)
    : await runTerminalAudit(options)
  process.stdout.write(`${JSON.stringify(report)}\n`)
}

function boundedFailure(error) {
  const message = error instanceof Error
    ? error.message
    : 'unknown terminal audit failure'
  return message
    .replaceAll(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .slice(0, 500)
}

if (
  process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`terminal audit failed: ${boundedFailure(error)}\n`)
    process.exitCode = 1
  })
}

#!/usr/bin/env node

import { execFile } from 'node:child_process'
import {
  lstat,
  readFile,
  realpath,
} from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual, promisify } from 'node:util'
import {
  assertAuthenticatedAcceptedEvidence,
  assertAuthenticatedAcceptedV3Lineage,
  assertArtifactSchema,
  assertZeroResidueRecord,
  checkpointedDecisionPayloadFromAccepted,
  resolveCheckpointedDecisionContractSha256,
} from './evidence-integrity.mjs'
import { assertOwnerCheckpointRecord } from './owner-checkpoint.mjs'
import {
  assertSignedSemanticReconciliation,
  verifyOwnerAuthorization,
} from './owner-authorization.mjs'
import {
  terminalSemanticDigests,
} from './authorization-evidence-validators.mjs'
import {
  assertRecordMatchesLiveScan,
  buildZeroResidueRecord,
  publishAcceptedEvidencePair,
  readAcceptedEvidencePair,
  scanOwnedSurfaces,
} from './residue-check.mjs'
import {
  assertNoGoQualityReport,
  evaluateRights,
  sha256Json,
} from './rights-gate.mjs'

const execFileAsync = promisify(execFile)
const PHASE_DIR = '.planning/phases/05-outreach-feasibility-gate'
const MATRIX_PATH = `${PHASE_DIR}/05-RIGHTS-MATRIX.json`
const QUALITY_PATH = `${PHASE_DIR}/05-QUALITY-REPORT.json`
const DECISION_PATH = `${PHASE_DIR}/05-DECISION.json`
const ZERO_RESIDUE_PATH = `${PHASE_DIR}/05-ZERO-RESIDUE.json`
const BASELINE_PATH = `${PHASE_DIR}/05-EXECUTION-BASELINE.json`
const REQUEST_PATH = `${PHASE_DIR}/05-OWNER-CHECKPOINT-REQUEST.json`
const RECEIPT_PATH = `${PHASE_DIR}/05-OWNER-CHECKPOINT.json`
const OWNER_AUTHORIZATION_REQUEST_PATH =
  `${PHASE_DIR}/05-OWNER-AUTHORIZATION-REQUEST.json`
const OWNER_AUTHORIZATION_SIGNATURE_PATH =
  `${OWNER_AUTHORIZATION_REQUEST_PATH}.sig`
const OWNER_TRUST_ANCHOR_PATH =
  'scripts/outreach-feasibility/trust/owner-trust-anchor.json'
const OWNER_PUBLIC_KEY_PATH =
  'scripts/outreach-feasibility/trust/phase-05-owner.pub'
const OWNER_ALLOWED_SIGNERS_PATH =
  'scripts/outreach-feasibility/trust/phase-05-owner.allowed_signers.txt'
const RECONCILIATION_PATH =
  `${PHASE_DIR}/05-CONTRACT-RECONCILIATION.json`
const ROADMAP_PATH = '.planning/ROADMAP.md'
const REQUIREMENTS_PATH = '.planning/REQUIREMENTS.md'
const SHA256 = /^[0-9a-f]{64}$/
const SHA = /^[0-9a-f]{40}$/
const REDESIGN_HANDOFF_OPTIONS = Object.freeze([
  'user-pasted LinkedIn URLs',
  'non-LinkedIn public professional profiles',
  'stopping outreach',
])
const CHECKPOINTED_V1_KEYS = Object.freeze([
  'schema_version',
  'phase',
  'rights_status',
  'quality_status',
  'search_authorized',
  'production_outreach_enabled',
  'outreach_milestone_status',
  'phase_6_authorized',
  'phase_7_authorized',
  'provider_call_count',
  'fixture_count',
  'raw_result_count',
  'production_mutation_count',
  'rights_evidence_sha256',
  'quality_evidence_sha256',
  'redesign_handoff_options',
  'redesign_selection',
])
const STABLE_V2_KEYS = Object.freeze([
  ...CHECKPOINTED_V1_KEYS,
  'checkpointed_decision_contract_sha256',
  'owner_checkpoint_evidence_sha256',
])
const ZERO_COUNTER_KEYS = Object.freeze([
  'provider_call_count',
  'fixture_count',
  'raw_result_count',
  'production_mutation_count',
  'forbidden_hit_count',
  'unexpected_survivor_count',
  'symlink_count',
])
const LEGACY_PAIR_PUBLICATION_FAULT_POINTS = Object.freeze([
  'before_publish',
  'after_record_publish',
  'before_decision_publish',
  'after_decision_publish',
  'during_readback',
])
const PAIR_PUBLICATION_FAULT_POINT_SET =
  new Set(LEGACY_PAIR_PUBLICATION_FAULT_POINTS)
export const PAIR_PUBLICATION_BOUNDARIES = Object.freeze([
  'lock_file_fsync',
  'lock_directory_fsync',
  'record_stage_file_fsync',
  'record_stage_directory_fsync',
  'decision_stage_file_fsync',
  'decision_stage_directory_fsync',
  'record_backup_file_fsync',
  'record_backup_directory_fsync',
  'decision_backup_file_fsync',
  'decision_backup_directory_fsync',
  'journal_prepared_file_fsync',
  'journal_prepared_temp_directory_fsync',
  'journal_prepared_rename',
  'journal_prepared_directory_fsync',
  'record_canonical_rename',
  'record_canonical_directory_fsync',
  'journal_record_published_file_fsync',
  'journal_record_published_temp_directory_fsync',
  'journal_record_published_rename',
  'journal_record_published_directory_fsync',
  'decision_canonical_rename',
  'decision_canonical_directory_fsync',
  'publication_readback',
  'journal_committed_file_fsync',
  'journal_committed_temp_directory_fsync',
  'journal_committed_rename',
  'journal_committed_directory_fsync',
  'cleanup_journal_unlink',
  'cleanup_journal_directory_fsync',
  'cleanup_record_backup_unlink',
  'cleanup_record_backup_directory_fsync',
  'cleanup_decision_backup_unlink',
  'cleanup_decision_backup_directory_fsync',
  'lock_cleanup_unlink',
  'lock_cleanup_directory_fsync',
])
export const ACCEPTED_PAIR_CONSUMERS = Object.freeze([
  'writeAtomicPair',
  'finalizeAcceptedEvidence',
  'decision-cli:assert-decision',
  'decision-cli:finalize-accepted',
  'residue-cli:assert-zero',
  'terminal:runContractValidation@05-23',
  'terminal:runTerminalAudit@05-23',
])

function requireCondition(condition, message) {
  if (!condition) throw new Error(message)
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
}

function requireSha256(value, label) {
  requireCondition(
    typeof value === 'string' && SHA256.test(value),
    `${label} is malformed`,
  )
}

async function readLiveTerminalDocument(root, relativePath, label) {
  const absolutePath = resolve(root, relativePath)
  requireCondition(
    await realpath(absolutePath) === absolutePath,
    `live ${label} path must be canonical and non-symlinked`,
  )
  const metadata = await lstat(absolutePath)
  requireCondition(
    metadata.isFile() && !metadata.isSymbolicLink(),
    `live ${label} must be a regular file`,
  )
  const bytes = await readFile(absolutePath)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error(`live ${label} must be valid UTF-8`)
  }
}

async function readLiveTerminalSemanticDigests(repoRoot) {
  requireCondition(
    typeof repoRoot === 'string' && repoRoot.length > 0,
    'live terminal semantic repository root is required',
  )
  const root = await realpath(resolve(repoRoot))
  const [roadmapText, requirementsText] = await Promise.all([
    readLiveTerminalDocument(root, ROADMAP_PATH, 'roadmap'),
    readLiveTerminalDocument(root, REQUIREMENTS_PATH, 'requirements'),
  ])
  return terminalSemanticDigests({
    roadmapText,
    requirementsText,
  })
}

function currentNoGo({ matrix, qualityReport, now = new Date() }) {
  const rights = evaluateRights(matrix, { now })
  requireCondition(
    rights.status === 'RIGHTS_NO_GO'
      && rights.search_authorized === false
      && rights.quality_status === 'NOT_RUN_RIGHTS_NO_GO',
    'decision requires current RIGHTS_NO_GO evidence',
  )
  assertNoGoQualityReport(matrix, qualityReport, { now })
}

function checkpointedV1Payload({ matrix, qualityReport }) {
  return {
    schema_version: 1,
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
    rights_evidence_sha256: matrix.rights_evidence_sha256,
    quality_evidence_sha256: qualityReport.quality_evidence_sha256,
    redesign_handoff_options: [...REDESIGN_HANDOFF_OPTIONS],
    redesign_selection: null,
  }
}

export function decisionPayload({
  matrix,
  qualityReport,
  checkpointedDecisionContractSha256,
  ownerCheckpointEvidenceSha256,
}) {
  requireSha256(
    checkpointedDecisionContractSha256,
    'checkpointed decision contract digest',
  )
  requireSha256(
    ownerCheckpointEvidenceSha256,
    'owner checkpoint evidence digest',
  )
  return {
    ...checkpointedV1Payload({ matrix, qualityReport }),
    schema_version: 2,
    checkpointed_decision_contract_sha256:
      checkpointedDecisionContractSha256,
    owner_checkpoint_evidence_sha256:
      ownerCheckpointEvidenceSha256,
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

export function authenticatedDecisionPayload({
  matrix,
  qualityReport,
  checkpointedDecisionContractSha256,
  ownerCheckpointEvidenceSha256,
  authorization,
}) {
  requireCondition(
    authorization?.authenticated === true
      && authorization.status === 'OWNER_AUTHORIZATION_VERIFIED',
    'verified owner authorization is required',
  )
  return {
    ...decisionPayload({
      matrix,
      qualityReport,
      checkpointedDecisionContractSha256,
      ownerCheckpointEvidenceSha256,
    }),
    schema_version: 3,
    representative_case_count: 0,
    ...authorizationFields(authorization),
  }
}

function exactStablePayload(value, keys) {
  const result = {}
  for (const key of keys) result[key] = structuredClone(value[key])
  return result
}

function ownerResponseText(ownerCheckpoint) {
  requireCondition(
    isPlainObject(ownerCheckpoint),
    'owner checkpoint record is required',
  )
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.from(ownerCheckpoint.owner_response_utf8_base64, 'base64'),
    )
  } catch {
    throw new Error('owner checkpoint response is not valid UTF-8')
  }
  requireCondition(text.length > 0, 'owner checkpoint response is empty')
  return text
}

function assertPendingLegacyDecision({
  matrix,
  qualityReport,
  decision,
  requireAccepted,
}) {
  assertArtifactSchema(DECISION_PATH, decision)
  requireCondition(
    decision.status === 'PENDING_OWNER_ATTESTATION',
    'legacy accepted decisions cannot satisfy accepted v2 validation',
  )
  requireCondition(!requireAccepted, 'accepted owner decision v2 is required')
  const expected = checkpointedV1Payload({ matrix, qualityReport })
  for (const key of CHECKPOINTED_V1_KEYS) {
    requireCondition(
      isDeepStrictEqual(decision[key], expected[key]),
      `legacy pending decision payload field drift: ${key}`,
    )
  }
  requireCondition(
    decision.decision_contract_sha256 === sha256Json(expected),
    'legacy pending decision contract digest mismatch',
  )
  return decision
}

export function assertDecisionRecord({
  matrix,
  qualityReport,
  decision,
  residue,
  request,
  ownerCheckpoint,
  baseline,
  requireAccepted = false,
  now = new Date(),
}) {
  requireCondition(
    !requireAccepted,
    'accepted evidence requires fresh authenticated schema v3 validation',
  )
  currentNoGo({ matrix, qualityReport, now })
  requireCondition(isPlainObject(decision), 'decision is required')
  if (decision.schema_version === 1) {
    return assertPendingLegacyDecision({
      matrix,
      qualityReport,
      decision,
      requireAccepted,
    })
  }
  requireCondition(
    decision.schema_version === 2,
    'schema v3 requires the asynchronous authenticated decision boundary',
  )

  assertArtifactSchema(DECISION_PATH, decision)
  requireCondition(
    decision.schema_version === 2
      && decision.status === 'RIGHTS_NO_GO_ACCEPTED',
    'accepted decision must use schema v2',
  )
  requireCondition(
    isPlainObject(request)
      && isPlainObject(ownerCheckpoint)
      && isPlainObject(baseline)
      && isPlainObject(residue),
    'accepted decision requires request, receipt, baseline, and residue objects',
  )

  const checkpointedPayload = checkpointedDecisionPayloadFromAccepted({
    decision,
    matrix,
    qualityReport,
  })
  const checkpointedDecisionContractSha256 =
    sha256Json(checkpointedPayload)
  requireCondition(
    checkpointedDecisionContractSha256
      === decision.checkpointed_decision_contract_sha256,
    'checkpointed decision contract digest mismatch',
  )
  const validatedCheckpoint = assertOwnerCheckpointRecord({
    request,
    record: ownerCheckpoint,
    baseline,
    matrix,
    qualityReport,
    checkpointedDecisionContractSha256,
    now,
  })
  requireCondition(
    request.checkpointed_decision_contract_sha256
      === checkpointedDecisionContractSha256
      && validatedCheckpoint.checkpointed_decision_contract_sha256
        === checkpointedDecisionContractSha256,
    'request/receipt checkpointed decision lineage drift',
  )

  const expectedPayload = decisionPayload({
    matrix,
    qualityReport,
    checkpointedDecisionContractSha256,
    ownerCheckpointEvidenceSha256:
      validatedCheckpoint.owner_checkpoint_evidence_sha256,
  })
  for (const key of STABLE_V2_KEYS) {
    requireCondition(
      isDeepStrictEqual(decision[key], expectedPayload[key]),
      `decision payload field drift: ${key}`,
    )
  }
  requireCondition(
    decision.decision_contract_sha256 === sha256Json(expectedPayload),
    'decision contract digest mismatch',
  )

  const responseText = ownerResponseText(validatedCheckpoint)
  requireCondition(
    decision.required_owner_attestation === responseText
      && decision.owner_attestation === responseText,
    'accepted decision owner response bytes drift',
  )
  requireCondition(
    decision.owner_checkpoint_evidence_sha256
      === validatedCheckpoint.owner_checkpoint_evidence_sha256,
    'accepted decision owner checkpoint digest drift',
  )

  assertZeroResidueRecord(residue, {
    rights_evidence_sha256: matrix.rights_evidence_sha256,
    quality_evidence_sha256: qualityReport.quality_evidence_sha256,
    decision_contract_sha256: decision.decision_contract_sha256,
    owner_checkpoint_evidence_sha256:
      validatedCheckpoint.owner_checkpoint_evidence_sha256,
    baseline_evidence_sha256: baseline.baseline_evidence_sha256,
  })
  requireCondition(
    residue.zero_residue_sha256 === decision.zero_residue_sha256,
    'accepted decision zero-residue digest drift',
  )
  requireCondition(
    isDeepStrictEqual(residue.baseline, {
      base_sha: baseline.base_sha,
      plan_path: baseline.plan_path,
      plan_blob_sha256: baseline.plan_blob_sha256,
      baseline_evidence_sha256: baseline.baseline_evidence_sha256,
    }),
    'accepted decision residue baseline drift',
  )
  requireCondition(
    residue.source_snapshot.head_sha
      === residue.git_surfaces.phase_commit_range.head_sha
      && residue.source_snapshot.head_sha
        === residue.git_surfaces.source_head_tree.head_sha
      && residue.source_snapshot.controlled_tree_sha256
        === residue.git_surfaces.source_head_tree.tree_sha256
      && residue.source_snapshot.baseline_to_source_history_sha256
        === residue.git_surfaces.phase_commit_range.inventory_sha256,
    'accepted decision residue source snapshot drift',
  )
  for (const key of ZERO_COUNTER_KEYS) {
    requireCondition(residue[key] === 0, `${key} must equal zero`)
  }
  return decision
}

export async function assertAuthenticatedDecisionRecord({
  matrix,
  qualityReport,
  decision,
  residue,
  reconciliation,
  request,
  ownerCheckpoint,
  baseline,
  ownerAuthorizationRequestPath,
  ownerAuthorizationSignaturePath,
  ownerTrustAnchorPath,
  ownerPublicKeyPath,
  ownerAllowedSignersPath,
  allowImmutableV3Lineage = false,
  now = new Date(),
}) {
  requireCondition(
    allowImmutableV3Lineage === false
      || (
        allowImmutableV3Lineage === true
        && decision?.schema_version === 3
        && residue?.schema_version === 3
      ),
    'immutable authenticated lineage requires an exact schema v3 pair',
  )
  const assertAuthenticatedPair = allowImmutableV3Lineage
    ? assertAuthenticatedAcceptedV3Lineage
    : assertAuthenticatedAcceptedEvidence
  await assertAuthenticatedPair({
    decision,
    residue,
    ...(reconciliation === undefined ? {} : { reconciliation }),
    requestPath: ownerAuthorizationRequestPath,
    signaturePath: ownerAuthorizationSignaturePath,
    trustAnchorPath: ownerTrustAnchorPath,
    publicKeyPath: ownerPublicKeyPath,
    allowedSignersPath: ownerAllowedSignersPath,
    now,
  })
  currentNoGo({ matrix, qualityReport, now })
  requireCondition(
    isPlainObject(request)
      && isPlainObject(ownerCheckpoint)
      && isPlainObject(baseline),
    'authenticated decision requires historical request, integrity receipt, and baseline objects',
  )
  const checkpointedPayload = checkpointedDecisionPayloadFromAccepted({
    decision,
    matrix,
    qualityReport,
  })
  const checkpointedDecisionContractSha256 =
    sha256Json(checkpointedPayload)
  requireCondition(
    checkpointedDecisionContractSha256
      === decision.checkpointed_decision_contract_sha256,
    'authenticated checkpointed decision contract digest mismatch',
  )
  const validatedCheckpoint = assertOwnerCheckpointRecord({
    request,
    record: ownerCheckpoint,
    baseline,
    matrix,
    qualityReport,
    checkpointedDecisionContractSha256,
    now,
  })
  requireCondition(
    decision.owner_checkpoint_evidence_sha256
      === validatedCheckpoint.owner_checkpoint_evidence_sha256,
    'authenticated decision historical integrity receipt drift',
  )
  assertZeroResidueRecord(residue, {
    rights_evidence_sha256: matrix.rights_evidence_sha256,
    quality_evidence_sha256: qualityReport.quality_evidence_sha256,
    decision_contract_sha256: decision.decision_contract_sha256,
    owner_checkpoint_evidence_sha256:
      validatedCheckpoint.owner_checkpoint_evidence_sha256,
    baseline_evidence_sha256: baseline.baseline_evidence_sha256,
  })
  for (const key of ZERO_COUNTER_KEYS) {
    requireCondition(residue[key] === 0, `${key} must equal zero`)
  }
  requireCondition(
    decision.representative_case_count === 0
      && residue.representative_case_count === 0,
    'representative_case_count must equal zero',
  )
  return decision
}

async function gitHead(repoRoot) {
  let stdout
  try {
    ({ stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: resolve(repoRoot),
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        LANG: 'C',
        LC_ALL: 'C',
        GIT_OPTIONAL_LOCKS: '0',
      },
    }))
  } catch {
    throw new Error('accepted evidence source HEAD could not be resolved')
  }
  const head = stdout.trim()
  requireCondition(SHA.test(head), 'accepted evidence source HEAD is malformed')
  return head
}

function serializePairArtifact(value, label) {
  requireCondition(isPlainObject(value), `${label} must be an object`)
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
  requireCondition(
    isDeepStrictEqual(JSON.parse(bytes.toString('utf8')), value),
    `${label} serialization drift`,
  )
  return bytes
}

export async function writeAtomicPair({
  decision,
  record,
  decisionPath,
  recordPath,
  injectFault,
}) {
  requireCondition(
    injectFault === undefined || typeof injectFault === 'function',
    'accepted evidence fault injector must be a function',
  )
  const decisionBytes = serializePairArtifact(
    decision,
    'accepted decision',
  )
  const recordBytes = serializePairArtifact(
    record,
    'accepted residue record',
  )
  const invokedLegacyFaultPoints = new Set()
  await publishAcceptedEvidencePair({
    decisionBytes,
    recordBytes,
    decisionPath,
    recordPath,
    onBoundary: injectFault,
    async onLegacyFault(point) {
      requireCondition(
        PAIR_PUBLICATION_FAULT_POINT_SET.has(point),
        'accepted evidence fault point is unknown',
      )
      requireCondition(
        !invokedLegacyFaultPoints.has(point),
        `accepted evidence fault point repeated: ${point}`,
      )
      invokedLegacyFaultPoints.add(point)
      if (injectFault) await injectFault(point)
    },
  })
}

export async function finalizeAcceptedEvidence({
  matrix,
  qualityReport,
  legacyDecision,
  reconciliation,
  request,
  ownerCheckpoint,
  baseline,
  repoRoot,
  phaseDir,
  decisionPath,
  recordPath,
  ownerAuthorizationRequestPath,
  ownerAuthorizationSignaturePath,
  ownerTrustAnchorPath,
  ownerPublicKeyPath,
  ownerAllowedSignersPath,
  now = new Date(),
}) {
  const authorization = await verifyOwnerAuthorization({
    requestPath: ownerAuthorizationRequestPath,
    signaturePath: ownerAuthorizationSignaturePath,
    trustAnchorPath: ownerTrustAnchorPath,
    publicKeyPath: ownerPublicKeyPath,
    allowedSignersPath: ownerAllowedSignersPath,
    now,
  })
  assertArtifactSchema(RECONCILIATION_PATH, reconciliation)
  assertSignedSemanticReconciliation({
    authorization,
    reconciliation,
  })
  const liveSemanticDigests =
    await readLiveTerminalSemanticDigests(repoRoot)
  assertSignedSemanticReconciliation({
    authorization,
    reconciliation,
    ...liveSemanticDigests,
  })
  const recoveredPair = await readAcceptedEvidencePair({
    decisionPath,
    recordPath,
    allowMissingPair: true,
  })
  const transitionDecision = recoveredPair?.decision ?? legacyDecision
  currentNoGo({ matrix, qualityReport, now })
  assertArtifactSchema(DECISION_PATH, transitionDecision)
  requireCondition(
    [1, 2, 3].includes(transitionDecision.schema_version)
      && transitionDecision.status === 'RIGHTS_NO_GO_ACCEPTED',
    'finalization requires the exact historical accepted decision',
  )
  if (transitionDecision.schema_version === 3) {
    await assertAuthenticatedDecisionRecord({
      matrix,
      qualityReport,
      decision: transitionDecision,
      residue: recoveredPair.record,
      request,
      ownerCheckpoint,
      baseline,
      reconciliation,
      ownerAuthorizationRequestPath,
      ownerAuthorizationSignaturePath,
      ownerTrustAnchorPath,
      ownerPublicKeyPath,
      ownerAllowedSignersPath,
      allowImmutableV3Lineage:
        recoveredPair.record.schema_version === 3,
      now,
    })
  }
  const checkpointedDecisionContractSha256 =
    resolveCheckpointedDecisionContractSha256({
      decision: transitionDecision,
      matrix,
      qualityReport,
    })
  if (transitionDecision.schema_version === 1) {
    requireCondition(
      checkpointedDecisionContractSha256
        === transitionDecision.decision_contract_sha256,
      'legacy decision contract digest drift',
    )
  } else {
    requireCondition(
      checkpointedDecisionContractSha256
        === transitionDecision.checkpointed_decision_contract_sha256,
      'historical decision checkpoint digest drift',
    )
  }
  const validatedCheckpoint = assertOwnerCheckpointRecord({
    request,
    record: ownerCheckpoint,
    baseline,
    matrix,
    qualityReport,
    checkpointedDecisionContractSha256,
    now,
  })
  requireCondition(
    request.checkpointed_decision_contract_sha256
      === checkpointedDecisionContractSha256
      && validatedCheckpoint.checkpointed_decision_contract_sha256
        === checkpointedDecisionContractSha256,
    'legacy request/receipt decision lineage drift',
  )

  const stable = authenticatedDecisionPayload({
    matrix,
    qualityReport,
    checkpointedDecisionContractSha256,
    ownerCheckpointEvidenceSha256:
      validatedCheckpoint.owner_checkpoint_evidence_sha256,
    authorization,
  })
  const decision = {
    ...stable,
    status: 'RIGHTS_NO_GO_ACCEPTED',
    decision_contract_sha256: sha256Json(stable),
    zero_residue_sha256: '0'.repeat(64),
  }
  requireCondition(
    sha256Json(checkpointedDecisionPayloadFromAccepted({
      decision,
      matrix,
      qualityReport,
    })) === checkpointedDecisionContractSha256,
    'accepted v3 projection does not preserve historical decision lineage',
  )

  const sourceHeadSha = await gitHead(repoRoot)
  const liveScan = await scanOwnedSurfaces({
    repoRoot,
    phaseDir,
    baseline,
    sourceHeadSha,
  })
  const structuralRecord = buildZeroResidueRecord({
    matrix,
    qualityReport,
    decisionContract: decision,
    ownerCheckpoint: validatedCheckpoint,
    baseline,
    scan: liveScan,
  })
  const {
    zero_residue_sha256: ignoredStructuralDigest,
    ...structuralBody
  } = structuralRecord
  const recordBody = {
    ...structuralBody,
    schema_version: 4,
    representative_case_count: 0,
    ...authorizationFields(authorization),
  }
  const record = {
    ...recordBody,
    zero_residue_sha256: sha256Json(recordBody),
  }
  decision.zero_residue_sha256 = record.zero_residue_sha256
  await assertAuthenticatedDecisionRecord({
    matrix,
    qualityReport,
    decision,
    residue: record,
    request,
    ownerCheckpoint: validatedCheckpoint,
    baseline,
    ownerAuthorizationRequestPath,
    ownerAuthorizationSignaturePath,
    ownerTrustAnchorPath,
    ownerPublicKeyPath,
    ownerAllowedSignersPath,
    now,
  })
  await assertRecordMatchesLiveScan(record, liveScan, {
    decision,
    ownerCheckpoint: validatedCheckpoint,
    repoRoot,
    requestPath: ownerAuthorizationRequestPath,
    signaturePath: ownerAuthorizationSignaturePath,
    trustAnchorPath: ownerTrustAnchorPath,
    publicKeyPath: ownerPublicKeyPath,
    allowedSignersPath: ownerAllowedSignersPath,
  })
  await writeAtomicPair({
    decision,
    record,
    decisionPath,
    recordPath,
  })
  return { decision, record }
}

function parseArgs(argv) {
  const result = {
    command: null,
    requireAccepted: false,
    matrixPath: null,
    qualityReportPath: null,
    legacyDecisionPath: null,
    decisionPath: null,
    requestPath: null,
    ownerCheckpointPath: null,
    baselinePath: null,
    phaseDir: null,
    repoRoot: null,
    recordPath: null,
    ownerAuthorizationRequestPath: null,
    ownerAuthorizationSignaturePath: null,
    ownerTrustAnchorPath: null,
    ownerPublicKeyPath: null,
    ownerAllowedSignersPath: null,
    reconciliationPath: null,
  }
  const commands = new Map([
    ['--assert-decision', 'assertDecision'],
    ['--finalize-accepted', 'finalizeAccepted'],
  ])
  const paths = new Map([
    ['--matrix', 'matrixPath'],
    ['--quality-report', 'qualityReportPath'],
    ['--legacy-decision', 'legacyDecisionPath'],
    ['--decision', 'decisionPath'],
    ['--request', 'requestPath'],
    ['--owner-checkpoint', 'ownerCheckpointPath'],
    ['--baseline-record', 'baselinePath'],
    ['--phase-dir', 'phaseDir'],
    ['--repo-root', 'repoRoot'],
    ['--record', 'recordPath'],
    ['--reconciliation', 'reconciliationPath'],
    [
      '--owner-authorization-request',
      'ownerAuthorizationRequestPath',
    ],
    [
      '--owner-authorization-signature',
      'ownerAuthorizationSignaturePath',
    ],
    ['--owner-trust-anchor', 'ownerTrustAnchorPath'],
    ['--owner-public-key', 'ownerPublicKeyPath'],
    ['--owner-allowed-signers', 'ownerAllowedSignersPath'],
  ])
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (commands.has(argument)) {
      requireCondition(result.command === null,
        'choose exactly one decision command')
      result.command = commands.get(argument)
    } else if (argument === '--require-accepted') {
      requireCondition(!result.requireAccepted,
        'duplicate --require-accepted')
      result.requireAccepted = true
    } else if (paths.has(argument)) {
      const key = paths.get(argument)
      requireCondition(result[key] === null, `duplicate ${argument}`)
      const value = argv[++index]
      requireCondition(
        value && !value.startsWith('--'),
        `${argument} requires a path`,
      )
      result[key] = value
    } else {
      throw new Error(`unknown argument: ${argument}`)
    }
  }
  requireCondition(result.command !== null,
    'choose exactly one decision command')
  for (const [key, flag] of [
    ['matrixPath', '--matrix'],
    ['qualityReportPath', '--quality-report'],
    ['decisionPath', '--decision'],
    ['requestPath', '--request'],
    ['ownerCheckpointPath', '--owner-checkpoint'],
    ['baselinePath', '--baseline-record'],
    ['recordPath', '--record'],
  ]) requireCondition(result[key] !== null, `${flag} is required`)

  const authorizationFlags = [
    [
      'ownerAuthorizationRequestPath',
      '--owner-authorization-request',
      OWNER_AUTHORIZATION_REQUEST_PATH,
    ],
    [
      'ownerAuthorizationSignaturePath',
      '--owner-authorization-signature',
      OWNER_AUTHORIZATION_SIGNATURE_PATH,
    ],
    [
      'ownerTrustAnchorPath',
      '--owner-trust-anchor',
      OWNER_TRUST_ANCHOR_PATH,
    ],
    [
      'ownerPublicKeyPath',
      '--owner-public-key',
      OWNER_PUBLIC_KEY_PATH,
    ],
    [
      'ownerAllowedSignersPath',
      '--owner-allowed-signers',
      OWNER_ALLOWED_SIGNERS_PATH,
    ],
  ]
  const requiresAuthorization = result.command === 'finalizeAccepted'
    || result.requireAccepted
  for (const [key, flag, canonicalPath] of authorizationFlags) {
    if (requiresAuthorization) {
      requireCondition(result[key] !== null, `${flag} is required`)
      requireCondition(
        result[key] === canonicalPath,
        `${flag} must use the canonical ${flag.slice(2).replaceAll('-', ' ')}`,
      )
    } else {
      requireCondition(
        result[key] === null,
        `${flag} is valid only for authenticated accepted evidence`,
      )
    }
  }

  if (result.command === 'assertDecision') {
    requireCondition(
      result.legacyDecisionPath === null,
      '--legacy-decision is only valid with --finalize-accepted',
    )
    requireCondition(
      result.phaseDir === null && result.repoRoot === null,
      '--phase-dir and --repo-root are only valid with --finalize-accepted',
    )
    requireCondition(
      result.reconciliationPath === null,
      '--reconciliation is only valid with --finalize-accepted',
    )
  } else {
    requireCondition(
      result.legacyDecisionPath !== null,
      '--legacy-decision is required',
    )
    requireCondition(
      result.phaseDir !== null && result.repoRoot !== null,
      '--phase-dir and --repo-root are required',
    )
    requireCondition(
      result.reconciliationPath !== null,
      '--reconciliation is required',
    )
    requireCondition(
      !result.requireAccepted,
      '--require-accepted is only valid with --assert-decision',
    )
  }
  return result
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(resolve(path), 'utf8'))
  } catch {
    throw new Error(`${label} could not be read`)
  }
}

async function main(argv) {
  const args = parseArgs(argv)
  const [
    matrix,
    qualityReport,
    request,
    ownerCheckpoint,
    baseline,
    reconciliation,
  ] = await Promise.all([
    readJson(args.matrixPath, 'rights matrix'),
    readJson(args.qualityReportPath, 'quality report'),
    readJson(args.requestPath, 'owner checkpoint request'),
    readJson(args.ownerCheckpointPath, 'owner checkpoint record'),
    readJson(args.baselinePath, 'execution baseline'),
    args.reconciliationPath === null
      ? null
      : readJson(args.reconciliationPath, 'contract reconciliation'),
  ])

  if (args.command === 'finalizeAccepted') {
    requireCondition(
      resolve(args.legacyDecisionPath) === resolve(args.decisionPath),
      '--legacy-decision and --decision must identify the same canonical artifact',
    )
    const finalized = await finalizeAcceptedEvidence({
      matrix,
      qualityReport,
      legacyDecision: null,
      reconciliation,
      request,
      ownerCheckpoint,
      baseline,
      repoRoot: args.repoRoot,
      phaseDir: args.phaseDir,
      decisionPath: args.decisionPath,
      recordPath: args.recordPath,
      ownerAuthorizationRequestPath:
        args.ownerAuthorizationRequestPath,
      ownerAuthorizationSignaturePath:
        args.ownerAuthorizationSignaturePath,
      ownerTrustAnchorPath: args.ownerTrustAnchorPath,
      ownerPublicKeyPath: args.ownerPublicKeyPath,
      ownerAllowedSignersPath: args.ownerAllowedSignersPath,
    })
    process.stdout.write(`${JSON.stringify({
      status: finalized.decision.status,
      decision_contract_sha256:
        finalized.decision.decision_contract_sha256,
      checkpointed_decision_contract_sha256:
        finalized.decision.checkpointed_decision_contract_sha256,
      owner_checkpoint_evidence_sha256:
        finalized.decision.owner_checkpoint_evidence_sha256,
      zero_residue_sha256:
        finalized.decision.zero_residue_sha256,
    }, null, 2)}\n`)
    return
  }

  const {
    decision,
    record: residue,
  } = await readAcceptedEvidencePair({
    decisionPath: args.decisionPath,
    recordPath: args.recordPath,
  })
  const validationInput = {
    matrix,
    qualityReport,
    decision,
    residue,
    request,
    ownerCheckpoint,
    baseline,
  }
  const validated = args.requireAccepted
    ? await assertAuthenticatedDecisionRecord({
      ...validationInput,
      ownerAuthorizationRequestPath:
        args.ownerAuthorizationRequestPath,
      ownerAuthorizationSignaturePath:
        args.ownerAuthorizationSignaturePath,
      ownerTrustAnchorPath: args.ownerTrustAnchorPath,
      ownerPublicKeyPath: args.ownerPublicKeyPath,
      ownerAllowedSignersPath: args.ownerAllowedSignersPath,
    })
    : assertDecisionRecord(validationInput)
  process.stdout.write(`${JSON.stringify({
    status: validated.status,
    rights_status: validated.rights_status,
    quality_status: validated.quality_status,
    search_authorized: validated.search_authorized,
    production_outreach_enabled:
      validated.production_outreach_enabled,
    phase_6_authorized: validated.phase_6_authorized,
    phase_7_authorized: validated.phase_7_authorized,
    checkpointed_decision_contract_sha256:
      validated.checkpointed_decision_contract_sha256,
    decision_contract_sha256:
      validated.decision_contract_sha256,
    owner_checkpoint_evidence_sha256:
      validated.owner_checkpoint_evidence_sha256,
    zero_residue_sha256: validated.zero_residue_sha256,
  }, null, 2)}\n`)
}

const isMainModule = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url

if (isMainModule) {
  main(process.argv.slice(2)).catch((error) => {
    const message = error instanceof Error
      ? error.message.replace(/[\r\n\u001b]/g, ' ')
      : 'decision assertion failed'
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}

import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import * as evidenceIntegrity from './evidence-integrity.mjs'
import {
  assertAuthenticatedAcceptedEvidence,
  assertArtifactSchema,
  assertExecutionBaseline,
  assertZeroResidueRecord,
  checkpointedDecisionPayloadFromAccepted,
  resolveCheckpointedDecisionContractSha256,
} from './evidence-integrity.mjs'
import {
  resolveImmutableAuthenticatedV3Lineage,
} from './residue-check.mjs'
import { sha256Json } from './rights-gate.mjs'
import { verifyOwnerAuthorization } from './owner-authorization.mjs'

const execFileAsync = promisify(execFile)
const PHASE_DIR =
  '.planning/phases/05-outreach-feasibility-gate'
const BASELINE_PATH = `${PHASE_DIR}/05-EXECUTION-BASELINE.json`
const REQUEST_PATH = `${PHASE_DIR}/05-OWNER-CHECKPOINT-REQUEST.json`
const RECEIPT_PATH = `${PHASE_DIR}/05-OWNER-CHECKPOINT.json`
const RECONCILIATION_PATH = `${PHASE_DIR}/05-CONTRACT-RECONCILIATION.json`
const DECISION_PATH = `${PHASE_DIR}/05-DECISION.json`
const ZERO_RESIDUE_PATH = `${PHASE_DIR}/05-ZERO-RESIDUE.json`
const AUTHORIZATION_REQUEST_PATH =
  `${PHASE_DIR}/05-OWNER-AUTHORIZATION-REQUEST.json`
const AUTHORIZATION_SIGNATURE_PATH =
  `${AUTHORIZATION_REQUEST_PATH}.sig`
const TRUST_ANCHOR_PATH =
  'scripts/outreach-feasibility/trust/owner-trust-anchor.json'
const PUBLIC_KEY_PATH =
  'scripts/outreach-feasibility/trust/phase-05-owner.pub'
const ALLOWED_SIGNERS_PATH =
  'scripts/outreach-feasibility/trust/phase-05-owner.allowed_signers.txt'
const PLAN_PATH = `${PHASE_DIR}/05-01-PLAN.md`
const PINNED_BASE = 'e1d592e8b574ae3e474ce44661b3970954ef00d9'
const PINNED_PLAN_BLOB =
  '2a7b1050772e674a3f880dbf5d2b8a96ae5dd48fb8e183a05ba8272a7ff6aba0'
const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)
const SHA_C = 'c'.repeat(64)
const SHA_D = 'd'.repeat(64)
const SHA_E = 'e'.repeat(64)
const GIT_SHA_A = 'a'.repeat(40)
const GIT_SHA_B = 'b'.repeat(40)
const FIXED_AUTHORIZATION_TIME = new Date('2026-07-31T12:00:00.000Z')
const PHASE_5_REVIEWED_PATHS =
  evidenceIntegrity.PHASE_5_REVIEWED_PATHS
const PRIOR_REVIEW_COMMIT =
  '357d9d02bcc1e4d4bb4b49781f24ae50ff88d1ad'
const PRIOR_REVIEW_PATH = `${PHASE_DIR}/05-REVIEW.md`
const PRIOR_REVIEW_SHA256 =
  '8ef26b90728bc388339c07294ffe819d7e8a6d58cd6377a8f11705f14bc8b752'
const AUTHENTICATED_ADMINISTRATIVE_TRANSITIONS = Object.freeze([
  'decision_v1_to_v2_to_v3_once',
  'zero_residue_v1_to_v2_to_v3_to_v4_once',
  'contract_reconciliation_absent_to_v1_to_v2_once',
  'plan_summary_contiguous_once',
  'review_pre_gap_to_final_once',
  'verification_source_gaps_found_or_absent_to_passed_once',
  'roadmap_phase_05_bookkeeping_only',
  'requirements_outr_04_outr_05_bookkeeping_only',
  'state_phase_05_bookkeeping_only',
])

async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(relativePath), 'utf8'))
}

async function readImmutableV3Residue() {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
    cwd: resolve('.'),
    encoding: 'utf8',
  })
  const lineage = await resolveImmutableAuthenticatedV3Lineage({
    repoRoot: resolve('.'),
    sourceHeadSha: stdout.trim(),
    now: FIXED_AUTHORIZATION_TIME,
  })
  assert.equal(lineage.residue.schema_version, 3)
  return lineage.residue
}

function checkpointedDigest(decision) {
  return decision.schema_version >= 2
    ? decision.checkpointed_decision_contract_sha256
    : decision.decision_contract_sha256
}

function executionBaseline() {
  const body = {
    schema_version: 1,
    phase: '05',
    status: 'PINNED',
    base_sha: PINNED_BASE,
    plan_path: PLAN_PATH,
    plan_blob_sha256: PINNED_PLAN_BLOB,
  }
  return {
    ...body,
    baseline_evidence_sha256: sha256Json(body),
  }
}

function decisionV2({ matrix, qualityReport, legacyDecision }) {
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
    rights_evidence_sha256: matrix.rights_evidence_sha256,
    quality_evidence_sha256: qualityReport.quality_evidence_sha256,
    redesign_handoff_options: [
      'user-pasted LinkedIn URLs',
      'non-LinkedIn public professional profiles',
      'stopping outreach',
    ],
    redesign_selection: null,
    checkpointed_decision_contract_sha256:
      checkpointedDigest(legacyDecision),
    owner_checkpoint_evidence_sha256: SHA_B,
  }
  const ownerResponse = 'owner byte-exact terminal no-go response'
  return {
    ...stable,
    status: 'RIGHTS_NO_GO_ACCEPTED',
    decision_contract_sha256: sha256Json(stable),
    required_owner_attestation: ownerResponse,
    owner_attestation: ownerResponse,
    zero_residue_sha256: SHA_C,
  }
}

function zeroResidueV2({
  matrix,
  qualityReport,
  decision,
  baseline = executionBaseline(),
}) {
  const body = {
    schema_version: 2,
    phase: '05',
    status: 'PASS',
    scope: 'LOCAL_AND_GIT_ONLY',
    provider_side_retention: 'NOT_ASSERTED',
    scanned_roots: [
      'scripts/outreach-feasibility/',
      '.planning/phases/05-outreach-feasibility-gate/*.json',
    ],
    baseline: {
      base_sha: baseline.base_sha,
      plan_path: baseline.plan_path,
      plan_blob_sha256: baseline.plan_blob_sha256,
      baseline_evidence_sha256: baseline.baseline_evidence_sha256,
    },
    source_snapshot: {
      head_sha: GIT_SHA_A,
      controlled_tree_sha256: SHA_A,
      baseline_to_source_history_sha256: SHA_B,
    },
    git_surfaces: {
      worktree: {
        status_entry_count: 0,
        path_count: 0,
        blob_count: 12,
        inventory_sha256: SHA_A,
      },
      index: {
        staged_path_count: 0,
        path_count: 0,
        blob_count: 0,
        inventory_sha256: SHA_B,
      },
      phase_commit_range: {
        base_sha: baseline.base_sha,
        head_sha: GIT_SHA_A,
        commit_count: 12,
        path_count: 31,
        blob_count: 90,
        inventory_sha256: SHA_B,
      },
      source_head_tree: {
        head_sha: GIT_SHA_A,
        path_count: 12,
        blob_count: 12,
        tree_sha256: SHA_A,
      },
    },
    administrative_tail_policy: {
      from_source_head_sha: GIT_SHA_A,
      allowed_paths: [
        `${PHASE_DIR}/05-DECISION.json`,
        `${PHASE_DIR}/05-ZERO-RESIDUE.json`,
        `${PHASE_DIR}/05-CONTRACT-RECONCILIATION.json`,
        `${PHASE_DIR}/05-09-SUMMARY.md`,
        `${PHASE_DIR}/05-REVIEW.md`,
        `${PHASE_DIR}/05-VERIFICATION.md`,
        '.planning/ROADMAP.md',
        '.planning/REQUIREMENTS.md',
        '.planning/STATE.md',
      ],
      allowed_state_transitions: [
        'decision_v1_to_v2_once',
        'zero_residue_v1_to_v2_once',
        'contract_reconciliation_absent_to_v1_once',
        'summary_absent_to_complete_once',
        'review_pre_gap_to_final_once',
        'verification_source_gaps_found_or_absent_to_passed_once',
        'roadmap_phase_05_bookkeeping_only',
        'requirements_outr_05_bookkeeping_only',
        'state_phase_05_bookkeeping_only',
      ],
      source_changes_allowed: false,
    },
    provider_call_count: 0,
    fixture_count: 0,
    raw_result_count: 0,
    production_mutation_count: 0,
    forbidden_hit_count: 0,
    unexpected_survivor_count: 0,
    symlink_count: 0,
    rights_evidence_sha256: matrix.rights_evidence_sha256,
    quality_evidence_sha256: qualityReport.quality_evidence_sha256,
    decision_contract_sha256: decision.decision_contract_sha256,
    owner_checkpoint_evidence_sha256:
      decision.owner_checkpoint_evidence_sha256,
    baseline_evidence_sha256: baseline.baseline_evidence_sha256,
    checked_at: '2026-07-29T12:00:00.000Z',
  }
  return {
    ...body,
    zero_residue_sha256: sha256Json(body),
  }
}

function rehashResidue(record) {
  const { zero_residue_sha256: ignored, ...body } = record
  record.zero_residue_sha256 = sha256Json(body)
  return record
}

function authorizationFields(verified) {
  return {
    owner_authorization_request_sha256:
      verified.owner_authorization_request_sha256,
    owner_authorization_signature_sha256:
      verified.owner_authorization_signature_sha256,
    owner_authorization_principal: verified.principal,
    owner_authorization_namespace: verified.namespace,
    owner_authorization_key_fingerprint: verified.fingerprint,
    owner_authorization_nonce_sha256: verified.nonce_sha256,
    owner_authorization_issued_at: verified.issued_at,
    owner_authorization_verified_at: verified.verified_at,
    owner_authorization_stopped_decision_payload_sha256:
      verified.stopped_decision_payload_sha256,
  }
}

function authenticatedV3Pair({
  matrix,
  qualityReport,
  legacyDecision,
  verified,
}) {
  const v2 = decisionV2({ matrix, qualityReport, legacyDecision })
  const {
    status: ignoredStatus,
    decision_contract_sha256: ignoredContract,
    required_owner_attestation: ignoredRequiredAttestation,
    owner_attestation: ignoredAttestation,
    zero_residue_sha256: ignoredResidue,
    ...v2Stable
  } = v2
  const stable = {
    ...v2Stable,
    schema_version: 3,
    representative_case_count: 0,
    owner_checkpoint_evidence_sha256:
      verified.request.owner_checkpoint_evidence_sha256,
    ...authorizationFields(verified),
  }
  const decision = {
    ...stable,
    status: 'RIGHTS_NO_GO_ACCEPTED',
    decision_contract_sha256: sha256Json(stable),
    zero_residue_sha256: SHA_A,
  }
  const v2Residue = zeroResidueV2({
    matrix,
    qualityReport,
    decision,
  })
  const {
    zero_residue_sha256: ignoredResidueDigest,
    ...v2ResidueBody
  } = v2Residue
  const residueBody = {
    ...v2ResidueBody,
    schema_version: 4,
    representative_case_count: 0,
    decision_contract_sha256: decision.decision_contract_sha256,
    git_surfaces: {
      ...v2ResidueBody.git_surfaces,
      worktree: {
        ...v2ResidueBody.git_surfaces.worktree,
        status_paths: [],
      },
      index: {
        ...v2ResidueBody.git_surfaces.index,
        staged_paths: [],
      },
    },
    administrative_tail_policy: {
      ...v2ResidueBody.administrative_tail_policy,
      allowed_paths: [
        ...new Set([
          ...v2ResidueBody.administrative_tail_policy.allowed_paths,
          `${PHASE_DIR}/05-19-SUMMARY.md`,
          `${PHASE_DIR}/05-20-PLAN.md`,
          `${PHASE_DIR}/05-20-SUMMARY.md`,
          `${PHASE_DIR}/05-21-PLAN.md`,
          `${PHASE_DIR}/05-21-SUMMARY.md`,
          `${PHASE_DIR}/05-22-PLAN.md`,
          `${PHASE_DIR}/05-23-PLAN.md`,
        ]),
      ].filter((path) => !path.endsWith('/05-09-SUMMARY.md')).sort(),
      allowed_state_transitions: [
        ...AUTHENTICATED_ADMINISTRATIVE_TRANSITIONS,
      ],
    },
    ...authorizationFields(verified),
  }
  const residue = {
    ...residueBody,
    zero_residue_sha256: sha256Json(residueBody),
  }
  decision.zero_residue_sha256 = residue.zero_residue_sha256
  return { decision, residue }
}

async function temporaryAuthorizationProof(root) {
  const requestPath = join(root, '05-OWNER-AUTHORIZATION-REQUEST.json')
  const signaturePath = `${requestPath}.sig`
  await Promise.all([
    copyFile(AUTHORIZATION_REQUEST_PATH, requestPath),
    copyFile(AUTHORIZATION_SIGNATURE_PATH, signaturePath),
  ])
  await Promise.all([
    chmod(requestPath, 0o600),
    chmod(signaturePath, 0o600),
  ])
  return {
    requestPath,
    signaturePath,
    trustAnchorPath: TRUST_ANCHOR_PATH,
    publicKeyPath: PUBLIC_KEY_PATH,
    allowedSignersPath: ALLOWED_SIGNERS_PATH,
  }
}

function cleanReviewBytes({
  status = 'clean',
  findings = {
    critical: 0,
    warning: 0,
    info: 0,
    total: 0,
  },
  files = PHASE_5_REVIEWED_PATHS,
  filesReviewed = files.length,
  depth = 'standard',
  body =
    'The standard review covered the exact 20-file Phase 5 scope and found zero unresolved findings.',
  includeReviewerMetadata = true,
} = {}) {
  return Buffer.from(`---
phase: 05-outreach-feasibility-gate
reviewed: 2026-07-30T12:00:00Z
${depth === null ? '' : `depth: ${depth}\n`}files_reviewed: ${filesReviewed}
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

_Reviewed: 2026-07-30T12:00:00Z_
${includeReviewerMetadata ? '_Reviewer: the agent (gsd-code-reviewer)_\n' : ''}_Depth: standard_
`, 'utf8')
}

async function immutablePriorReviewBytes({
  repoRoot = resolve('.'),
  sourceCommit = PRIOR_REVIEW_COMMIT,
} = {}) {
  const { stdout } = await execFileAsync(
    'git',
    ['show', `${sourceCommit}:${PRIOR_REVIEW_PATH}`],
    { cwd: repoRoot, encoding: 'buffer' },
  )
  return stdout
}

function requestFixture({
  matrix,
  qualityReport,
  legacyDecision,
  baseline = executionBaseline(),
}) {
  const body = {
    schema_version: 1,
    phase: '05',
    status: 'AWAITING_OWNER_RESPONSE',
    checkpoint_plan: '05-07',
    checkpoint_task:
      "Task 1: Preserve the owner's one-time raw-byte no-go reconfirmation",
    gate: 'blocking-human',
    nonce: '12'.repeat(32),
    rights_evidence_sha256: matrix.rights_evidence_sha256,
    quality_evidence_sha256: qualityReport.quality_evidence_sha256,
    checkpointed_decision_contract_sha256:
      checkpointedDigest(legacyDecision),
    baseline_evidence_sha256: baseline.baseline_evidence_sha256,
    required_response_sha256: SHA_A,
  }
  return {
    ...body,
    owner_checkpoint_request_sha256: sha256Json(body),
  }
}

function receiptFixture(request) {
  const responseBytes = Buffer.from('owner byte-exact terminal no-go response')
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
    received_at: '2026-07-29T12:00:00.000Z',
  }
  return {
    ...body,
    owner_checkpoint_evidence_sha256: sha256Json(body),
  }
}

function reconciliationFixture({
  matrix,
  qualityReport,
  decision,
  residue,
}) {
  const body = {
    schema_version: 1,
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
    quality_evidence_sha256: qualityReport.quality_evidence_sha256,
    checkpointed_decision_contract_sha256:
      decision.checkpointed_decision_contract_sha256,
    decision_contract_sha256: decision.decision_contract_sha256,
    owner_checkpoint_evidence_sha256:
      decision.owner_checkpoint_evidence_sha256,
    zero_residue_sha256: residue.zero_residue_sha256,
    roadmap_semantic_sha256: SHA_D,
    requirements_semantic_sha256: SHA_E,
  }
  return {
    ...body,
    contract_reconciliation_sha256: sha256Json(body),
  }
}

test('pinned execution baseline proves the exact immutable plan blob', async () => {
  const validated = await assertExecutionBaseline({
    record: executionBaseline(),
    repoRoot: resolve('.'),
  })
  assert.equal(validated.status, 'PINNED')
  assert.equal(validated.base_sha, PINNED_BASE)

  for (const [field, value] of [
    ['base_sha', GIT_SHA_B],
    ['plan_path', `${PHASE_DIR}/05-02-PLAN.md`],
    ['plan_blob_sha256', SHA_A],
    ['unexpected', true],
  ]) {
    const drifted = { ...executionBaseline(), [field]: value }
    if (field !== 'unexpected') {
      const { baseline_evidence_sha256: ignored, ...body } = drifted
      drifted.baseline_evidence_sha256 = sha256Json(body)
    }
    await assert.rejects(
      () => assertExecutionBaseline({
        record: drifted,
        repoRoot: resolve('.'),
      }),
      /baseline|unknown|pinned/i,
    )
  }

  const selfHashDrift = executionBaseline()
  selfHashDrift.baseline_evidence_sha256 = SHA_A
  await assert.rejects(
    () => assertExecutionBaseline({
      record: selfHashDrift,
      repoRoot: resolve('.'),
    }),
    /digest/i,
  )
})

test('newest plan edit cannot replace the pinned history anchor', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'job-copilot-baseline-'))
  try {
    await execFileAsync('git', ['init', '-q'], { cwd: temporary })
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: temporary,
    })
    await execFileAsync('git', ['config', 'user.name', 'Test'], {
      cwd: temporary,
    })
    const planPath = resolve(temporary, PLAN_PATH)
    await execFileAsync('mkdir', ['-p', resolve(temporary, PHASE_DIR)])
    await writeFile(planPath, 'newest mutable plan edit\n', 'utf8')
    await execFileAsync('git', ['add', PLAN_PATH], { cwd: temporary })
    await execFileAsync('git', ['commit', '-qm', 'later plan edit'], {
      cwd: temporary,
    })
    const { stdout: latestSha } = await execFileAsync(
      'git',
      ['rev-parse', 'HEAD'],
      { cwd: temporary, encoding: 'utf8' },
    )
    const { stdout: latestBytes } = await execFileAsync(
      'git',
      ['show', `HEAD:${PLAN_PATH}`],
      { cwd: temporary, encoding: 'buffer' },
    )
    const discovered = {
      ...executionBaseline(),
      base_sha: latestSha.trim(),
      plan_blob_sha256:
        (await import('node:crypto'))
          .createHash('sha256')
          .update(latestBytes)
          .digest('hex'),
    }
    const { baseline_evidence_sha256: ignored, ...body } = discovered
    discovered.baseline_evidence_sha256 = sha256Json(body)
    await assert.rejects(
      () => assertExecutionBaseline({
        record: discovered,
        repoRoot: temporary,
      }),
      /pinned baseline/i,
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('finite artifact registry validates exact historical and planned states', async () => {
  const matrix = await readJson(`${PHASE_DIR}/05-RIGHTS-MATRIX.json`)
  const qualityReport = await readJson(`${PHASE_DIR}/05-QUALITY-REPORT.json`)
  const legacyDecision = await readJson(DECISION_PATH)
  const legacyResidue = await readJson(ZERO_RESIDUE_PATH)
  const baseline = executionBaseline()
  const acceptedDecision = decisionV2({
    matrix,
    qualityReport,
    legacyDecision,
  })
  const residue = zeroResidueV2({
    matrix,
    qualityReport,
    decision: acceptedDecision,
    baseline,
  })
  const request = requestFixture({
    matrix,
    qualityReport,
    legacyDecision,
    baseline,
  })
  const receipt = receiptFixture(request)
  const reconciliation = reconciliationFixture({
    matrix,
    qualityReport,
    decision: acceptedDecision,
    residue,
  })

  for (const [path, artifact] of [
    [`${PHASE_DIR}/05-RIGHTS-MATRIX.json`, matrix],
    [`${PHASE_DIR}/05-QUALITY-REPORT.json`, qualityReport],
    [DECISION_PATH, legacyDecision],
    [DECISION_PATH, acceptedDecision],
    [ZERO_RESIDUE_PATH, legacyResidue],
    [ZERO_RESIDUE_PATH, residue],
    [BASELINE_PATH, baseline],
    [REQUEST_PATH, request],
    [RECEIPT_PATH, receipt],
    [RECONCILIATION_PATH, reconciliation],
  ]) {
    assert.equal(assertArtifactSchema(path, artifact), artifact)
  }

  assert.throws(
    () => assertArtifactSchema(`${PHASE_DIR}/05-UNKNOWN.json`, {}),
    /unrecognized Phase 5 artifact path/,
  )
  const nestedDrift = structuredClone(matrix)
  nestedDrift.sources[0].results = [{
    name: 'synthetic person',
    title: 'synthetic title',
    url: 'https://example.invalid/profile',
    content: 'synthetic provider content',
  }]
  assert.throws(
    () => assertArtifactSchema(
      `${PHASE_DIR}/05-RIGHTS-MATRIX.json`,
      nestedDrift,
    ),
    /unknown/i,
  )
  assert.throws(
    () => assertArtifactSchema(
      ZERO_RESIDUE_PATH,
      { ...residue, unexpected_surface: {} },
    ),
    /unknown/i,
  )
})

test('accepted v2 decision independently recomputes the immutable v1 projection', async () => {
  const matrix = await readJson(`${PHASE_DIR}/05-RIGHTS-MATRIX.json`)
  const qualityReport = await readJson(`${PHASE_DIR}/05-QUALITY-REPORT.json`)
  const legacyDecision = await readJson(DECISION_PATH)
  const acceptedDecision = decisionV2({
    matrix,
    qualityReport,
    legacyDecision,
  })
  const projection = checkpointedDecisionPayloadFromAccepted({
    decision: acceptedDecision,
    matrix,
    qualityReport,
  })
  assert.equal(projection.schema_version, 1)
  assert.deepEqual(Object.keys(projection), [
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
  assert.equal(
    sha256Json(projection),
    checkpointedDigest(legacyDecision),
  )
  assert.equal(
    resolveCheckpointedDecisionContractSha256({
      decision: legacyDecision,
      matrix,
      qualityReport,
    }),
    checkpointedDigest(legacyDecision),
  )
  assert.equal(
    resolveCheckpointedDecisionContractSha256({
      decision: acceptedDecision,
      matrix,
      qualityReport,
    }),
    checkpointedDigest(legacyDecision),
  )

  const drifted = structuredClone(acceptedDecision)
  drifted.phase_6_authorized = true
  const {
    status,
    decision_contract_sha256,
    required_owner_attestation,
    owner_attestation,
    zero_residue_sha256,
    ...stable
  } = drifted
  drifted.decision_contract_sha256 = sha256Json(stable)
  assert.throws(
    () => resolveCheckpointedDecisionContractSha256({
      decision: drifted,
      matrix,
      qualityReport,
    }),
    /phase_6_authorized|no-go|projection/i,
  )
})

test('zero-residue v2 requires every surface, counter, digest, and self-hash', async () => {
  const matrix = await readJson(`${PHASE_DIR}/05-RIGHTS-MATRIX.json`)
  const qualityReport = await readJson(`${PHASE_DIR}/05-QUALITY-REPORT.json`)
  const legacyDecision = await readJson(DECISION_PATH)
  const decision = decisionV2({ matrix, qualityReport, legacyDecision })
  const residue = zeroResidueV2({ matrix, qualityReport, decision })
  const expected = {
    rights_evidence_sha256: matrix.rights_evidence_sha256,
    quality_evidence_sha256: qualityReport.quality_evidence_sha256,
    decision_contract_sha256: decision.decision_contract_sha256,
    owner_checkpoint_evidence_sha256:
      decision.owner_checkpoint_evidence_sha256,
    baseline_evidence_sha256:
      executionBaseline().baseline_evidence_sha256,
  }
  assert.equal(assertZeroResidueRecord(residue, expected), residue)

  for (const mutate of [
    (record) => { delete record.source_snapshot },
    (record) => { delete record.git_surfaces.index.inventory_sha256 },
    (record) => { record.git_surfaces.worktree.extra = 0 },
    (record) => { record.provider_call_count = 1 },
    (record) => { record.owner_checkpoint_evidence_sha256 = SHA_E },
    (record) => { record.zero_residue_sha256 = SHA_E },
  ]) {
    const drifted = structuredClone(residue)
    mutate(drifted)
    assert.throws(
      () => assertZeroResidueRecord(drifted, expected),
      /missing|unknown|zero|digest|evidence/i,
    )
  }

  const stub = {
    schema_version: 2,
    phase: '05',
    status: 'PASS',
    provider_call_count: 0,
    fixture_count: 0,
    raw_result_count: 0,
    production_mutation_count: 0,
  }
  assert.throws(
    () => assertZeroResidueRecord(stub, expected),
    /missing/i,
  )
})

test('schema v3 is immutable lineage only and publishable residue must be canonical v4', async () => {
  assert.equal(
    typeof evidenceIntegrity.assertImmutableZeroResidueV3Lineage,
    'function',
  )
  assert.equal(
    typeof evidenceIntegrity.assertPublishableZeroResidueRecord,
    'function',
  )
  const liveV3 = await readImmutableV3Residue()
  assert.equal(liveV3.schema_version, 3)
  assert.equal(
    evidenceIntegrity.assertImmutableZeroResidueV3Lineage(liveV3),
    liveV3,
  )
  assert.throws(
    () => evidenceIntegrity.assertPublishableZeroResidueRecord(liveV3),
    /schema v4|publishable|terminal/i,
  )

  const v4 = structuredClone(liveV3)
  v4.schema_version = 4
  v4.git_surfaces.worktree.status_entry_count = 0
  v4.git_surfaces.worktree.status_paths = []
  v4.git_surfaces.index.staged_path_count = 0
  v4.git_surfaces.index.staged_paths = []
  v4.administrative_tail_policy.allowed_paths = [
    ...new Set([
      ...v4.administrative_tail_policy.allowed_paths,
      `${PHASE_DIR}/05-19-SUMMARY.md`,
      `${PHASE_DIR}/05-20-PLAN.md`,
      `${PHASE_DIR}/05-20-SUMMARY.md`,
      `${PHASE_DIR}/05-21-PLAN.md`,
      `${PHASE_DIR}/05-21-SUMMARY.md`,
      `${PHASE_DIR}/05-22-PLAN.md`,
      `${PHASE_DIR}/05-23-PLAN.md`,
    ]),
  ].filter((path) => !path.endsWith('/05-09-SUMMARY.md')).sort()
  v4.administrative_tail_policy.allowed_state_transitions = [
    'decision_v1_to_v2_to_v3_once',
    'zero_residue_v1_to_v2_to_v3_to_v4_once',
    'contract_reconciliation_absent_to_v1_to_v2_once',
    'plan_summary_contiguous_once',
    'review_pre_gap_to_final_once',
    'verification_source_gaps_found_or_absent_to_passed_once',
    'roadmap_phase_05_bookkeeping_only',
    'requirements_outr_04_outr_05_bookkeeping_only',
    'state_phase_05_bookkeeping_only',
  ]
  rehashResidue(v4)
  assert.equal(
    evidenceIntegrity.assertPublishableZeroResidueRecord(v4),
    v4,
  )
  assert.equal(assertArtifactSchema(ZERO_RESIDUE_PATH, v4), v4)

  const mutations = [
    (record) => { delete record.git_surfaces.worktree.status_paths },
    (record) => { record.git_surfaces.worktree.status_paths = ['b', 'a'] },
    (record) => { record.git_surfaces.worktree.status_paths = ['a', 'a'] },
    (record) => { delete record.git_surfaces.index.staged_paths },
    (record) => { record.git_surfaces.index.staged_paths = ['bad\\path'] },
    (record) => {
      record.administrative_tail_policy.allowed_paths = [
        ...record.administrative_tail_policy.allowed_paths,
        'scripts/outreach-feasibility/not-administrative.mjs',
      ].sort()
    },
    (record) => {
      record.administrative_tail_policy.authorized_paths =
        record.administrative_tail_policy.allowed_paths
    },
  ]
  for (const mutate of mutations) {
    const drifted = structuredClone(v4)
    mutate(drifted)
    rehashResidue(drifted)
    assert.throws(
      () => evidenceIntegrity.assertPublishableZeroResidueRecord(drifted),
      /path|missing|unknown|canonical|sorted|duplicate|administrative/i,
    )
  }
})

test('zero-residue v2 rejects independently rehashed source digest contradictions', async () => {
  const matrix = await readJson(`${PHASE_DIR}/05-RIGHTS-MATRIX.json`)
  const qualityReport = await readJson(`${PHASE_DIR}/05-QUALITY-REPORT.json`)
  const legacyDecision = await readJson(DECISION_PATH)
  const decision = decisionV2({ matrix, qualityReport, legacyDecision })
  const residue = zeroResidueV2({ matrix, qualityReport, decision })
  const cases = [
    {
      mutate(record) {
        record.source_snapshot.controlled_tree_sha256 = SHA_D
      },
      error: /controlled tree digest.*source-head tree/i,
    },
    {
      mutate(record) {
        record.git_surfaces.source_head_tree.tree_sha256 = SHA_D
      },
      error: /controlled tree digest.*source-head tree/i,
    },
    {
      mutate(record) {
        record.source_snapshot.baseline_to_source_history_sha256 = SHA_C
      },
      error: /source history digest.*phase range inventory/i,
    },
    {
      mutate(record) {
        record.git_surfaces.phase_commit_range.inventory_sha256 = SHA_C
      },
      error: /source history digest.*phase range inventory/i,
    },
  ]
  for (const { mutate, error } of cases) {
    const drifted = structuredClone(residue)
    mutate(drifted)
    rehashResidue(drifted)
    assert.throws(
      () => assertArtifactSchema(ZERO_RESIDUE_PATH, drifted),
      error,
    )
  }
})

test('canonical UTC validation rejects normalized calendar rollovers and noncanonical syntax', () => {
  assert.equal(
    typeof evidenceIntegrity.requireCanonicalUtcTimestamp,
    'function',
  )
  for (const value of [
    '2024-02-29T23:59:59.000Z',
    '2026-12-31T00:00:00.123Z',
  ]) {
    assert.equal(
      evidenceIntegrity.requireCanonicalUtcTimestamp(
        value,
        'test timestamp',
      ),
      value,
    )
  }
  for (const value of [
    '2026-02-30T00:00:00.000Z',
    '2025-02-29T00:00:00.000Z',
    '2026-13-01T00:00:00.000Z',
    '2026-02-28T18:00:00.000-06:00',
    '2026-02-28T00:00:00.00Z',
    '2026-02-28T00:00:00.0000Z',
  ]) {
    assert.throws(
      () => evidenceIntegrity.requireCanonicalUtcTimestamp(
        value,
        'test timestamp',
      ),
      /test timestamp is malformed/,
      value,
    )
  }
})

test('shared authorization evidence schemas have no shadow consumer definitions', async () => {
  const consumer = await readFile(
    'scripts/outreach-feasibility/evidence-integrity.mjs',
    'utf8',
  )
  const shared = await readFile(
    'scripts/outreach-feasibility/authorization-evidence-validators.mjs',
    'utf8',
  )
  for (const binding of [
    'BASE64',
    'BASELINE_KEYS',
    'RECEIPT_KEYS',
    'RECONCILIATION_V1_KEYS',
    'RECONCILIATION_AUTHORIZATION_KEYS',
    'RECONCILIATION_V2_KEYS',
  ]) {
    assert.doesNotMatch(
      consumer,
      new RegExp(`^const ${binding}\\b`, 'm'),
      binding,
    )
    assert.match(
      shared,
      new RegExp(`^const ${binding}\\b`, 'm'),
      binding,
    )
  }
})

test('review lifecycle accepts only immutable issues_found followed by complete canonical clean', async () => {
  assert.equal(
    typeof evidenceIntegrity.assertPhase5ReviewLifecycle,
    'function',
  )
  assert.equal(Object.isFrozen(PHASE_5_REVIEWED_PATHS), true)
  assert.equal(PHASE_5_REVIEWED_PATHS.length, 20)
  assert.equal(
    PHASE_5_REVIEWED_PATHS.includes(
      'scripts/outreach-feasibility/authorization-evidence-validators.mjs',
    ),
    false,
  )
  const priorReviewBytes = await immutablePriorReviewBytes()
  assert.equal(
    createHash('sha256').update(priorReviewBytes).digest('hex'),
    PRIOR_REVIEW_SHA256,
  )
  const finalReviewBytes = cleanReviewBytes()
  const result = evidenceIntegrity.assertPhase5ReviewLifecycle({
    priorReviewBytes,
    finalReviewBytes,
  })
  assert.deepEqual(result, {
    prior_status: 'issues_found',
    final_status: 'clean',
    prior_files_reviewed: 20,
    final_files_reviewed: 20,
  })
})

test('review lifecycle rejects former final aliases and unresolved issues', async () => {
  const priorReviewBytes = await immutablePriorReviewBytes()
  for (const status of [
    'skipped',
    'passed',
    'no_issues',
    'issues_found',
  ]) {
    assert.throws(
      () => evidenceIntegrity.assertPhase5ReviewLifecycle({
        priorReviewBytes,
        finalReviewBytes: cleanReviewBytes({ status }),
      }),
      /final Phase 5 review status must equal clean/,
      status,
    )
  }
})

test('review lifecycle requires a standard substantive report with canonical reviewer metadata', async () => {
  const priorReviewBytes = await immutablePriorReviewBytes()
  for (const depth of [null, 'quick', 'deep']) {
    assert.throws(
      () => evidenceIntegrity.assertPhase5ReviewLifecycle({
        priorReviewBytes,
        finalReviewBytes: cleanReviewBytes({ depth }),
      }),
      /depth/i,
      String(depth),
    )
  }
  for (const body of [
    '',
    'No review was performed.',
    'No standard review was performed; this sentence only pads the summary beyond forty characters.',
    'The standard review was not performed; this sentence only pads the summary beyond forty characters.',
    'The standard review covered the exact 20-file Phase 5 scope and found zero unresolved findings.\n\n'
      + 'No standard review was performed; the affirmative sentence above is false.',
    'The standard review covered the exact 20-file Phase 5 scope and found zero unresolved findings.\n\n'
      + 'No code was reviewed.',
    'No code was reviewed.\n\n'
      + 'The standard review covered the exact 20-file Phase 5 scope and found zero unresolved findings.',
    'The standard review covered the exact 20-file Phase 5 scope and found zero unresolved findings.\n\n'
      + 'The code was not reviewed.',
    'The standard review covered the exact 20-file Phase 5 scope and found zero unresolved findings.\n\n'
      + "The code wasn't reviewed.",
  ]) {
    assert.throws(
      () => evidenceIntegrity.assertPhase5ReviewLifecycle({
        priorReviewBytes,
        finalReviewBytes: cleanReviewBytes({ body }),
      }),
      /summary|substantive/i,
      body,
    )
  }
  assert.throws(
    () => evidenceIntegrity.assertPhase5ReviewLifecycle({
      priorReviewBytes,
      finalReviewBytes: cleanReviewBytes({
        includeReviewerMetadata: false,
      }),
    }),
    /reviewer metadata/i,
  )
  assert.throws(
    () => evidenceIntegrity.assertPhase5ReviewLifecycle({
      priorReviewBytes,
      finalReviewBytes: cleanReviewBytes({
        body:
          'The standard review covered the exact 20-file Phase 5 scope and found zero unresolved findings.\n\n'
          + '### CR-100: uncounted terminal issue',
      }),
    }),
    /summary|finding body|counter/i,
  )
})

test('review lifecycle rejects nonzero final counters and incomplete affected-file coverage', async () => {
  const priorReviewBytes = await immutablePriorReviewBytes()
  for (const counter of ['critical', 'warning', 'info', 'total']) {
    const findings = {
      critical: 0,
      warning: 0,
      info: 0,
      total: 0,
      [counter]: 1,
    }
    assert.throws(
      () => evidenceIntegrity.assertPhase5ReviewLifecycle({
        priorReviewBytes,
        finalReviewBytes: cleanReviewBytes({ findings }),
      }),
      /final Phase 5 review findings must all equal zero/,
      counter,
    )
  }

  for (const omittedPath of [
    'scripts/outreach-feasibility/owner-authorization.mjs',
    'scripts/outreach-feasibility/owner-authorization.test.mjs',
    'scripts/outreach-feasibility/trust/owner-trust-anchor.json',
    'scripts/outreach-feasibility/trust/phase-05-owner.allowed_signers.txt',
    'scripts/outreach-feasibility/trust/phase-05-owner.pub',
  ]) {
    assert.throws(
      () => evidenceIntegrity.assertPhase5ReviewLifecycle({
        priorReviewBytes,
        finalReviewBytes: cleanReviewBytes({
          files: PHASE_5_REVIEWED_PATHS.filter(
            (path) => path !== omittedPath,
          ),
        }),
      }),
      /final Phase 5 review file scope drift/,
      omittedPath,
    )
  }
  assert.throws(
    () => evidenceIntegrity.assertPhase5ReviewLifecycle({
      priorReviewBytes,
      finalReviewBytes: cleanReviewBytes({
        files: [
          ...PHASE_5_REVIEWED_PATHS,
          PHASE_5_REVIEWED_PATHS[0],
        ],
      }),
    }),
    /final Phase 5 review file scope drift|duplicates/,
  )
  assert.throws(
    () => evidenceIntegrity.assertPhase5ReviewLifecycle({
      priorReviewBytes,
      finalReviewBytes: cleanReviewBytes({
        files: [
          PHASE_5_REVIEWED_PATHS[1],
          PHASE_5_REVIEWED_PATHS[0],
          ...PHASE_5_REVIEWED_PATHS.slice(2),
        ],
      }),
    }),
    /final Phase 5 review file scope drift/,
  )
  assert.throws(
    () => evidenceIntegrity.assertPhase5ReviewLifecycle({
      priorReviewBytes,
      finalReviewBytes: cleanReviewBytes({
        files: [
          ...PHASE_5_REVIEWED_PATHS,
          'scripts/outreach-feasibility/unreviewed-extra.mjs',
        ],
      }),
    }),
    /final Phase 5 review file scope drift/,
  )
  assert.throws(
    () => evidenceIntegrity.assertPhase5ReviewLifecycle({
      priorReviewBytes,
      finalReviewBytes: cleanReviewBytes({
        filesReviewed: PHASE_5_REVIEWED_PATHS.length + 1,
      }),
    }),
    /final Phase 5 review file count drift/,
  )
})

test('review lifecycle preserves the exact prior findings record and forbids CR carryover', async () => {
  const priorReviewBytes = await immutablePriorReviewBytes()
  for (const drift of [
    ['status: issues_found', 'status: clean'],
    ['  critical: 7', '  critical: 6'],
    ['  warning: 4', '  warning: 3'],
    ['  total: 11', '  total: 10'],
    ['### CR-07 ', '### CR-08 '],
    [
      `  - ${PHASE_5_REVIEWED_PATHS[0]}`,
      '  - scripts/outreach-feasibility/not-reviewed.mjs',
    ],
  ]) {
    const driftedPrior = Buffer.from(
      priorReviewBytes.toString('utf8').replace(...drift),
      'utf8',
    )
    assert.throws(
      () => evidenceIntegrity.assertPhase5ReviewLifecycle({
        priorReviewBytes: driftedPrior,
        finalReviewBytes: cleanReviewBytes(),
      }),
      /prior Phase 5 review|immutable source/,
    )
  }

  for (const issueId of ['CR-01', 'BL-01', 'WR-01', 'IN-01']) {
    assert.throws(
      () => evidenceIntegrity.assertPhase5ReviewLifecycle({
        priorReviewBytes,
        finalReviewBytes: cleanReviewBytes({
          body:
            'The standard review covered the exact 20-file Phase 5 scope and found zero unresolved findings.\n\n'
            + `### ${issueId}: unresolved`,
        }),
      }),
      /summary|final Phase 5 review finding body|counter/i,
      issueId,
    )
  }
})

test('review lifecycle uses immutable source bytes when the live review is already clean', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'phase-5-review-lineage-'))
  try {
    await execFileAsync('git', ['init', '-q'], { cwd: temporary })
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: temporary,
    })
    await execFileAsync('git', ['config', 'user.name', 'Test'], {
      cwd: temporary,
    })
    await mkdir(resolve(temporary, PHASE_DIR), { recursive: true })
    const priorReviewBytes = await immutablePriorReviewBytes()
    const liveReviewPath = resolve(temporary, PRIOR_REVIEW_PATH)
    await writeFile(liveReviewPath, priorReviewBytes)
    await execFileAsync('git', ['add', PRIOR_REVIEW_PATH], { cwd: temporary })
    await execFileAsync('git', ['commit', '-qm', 'immutable issues review'], {
      cwd: temporary,
    })
    const { stdout: sourceCommit } = await execFileAsync(
      'git',
      ['rev-parse', 'HEAD'],
      { cwd: temporary, encoding: 'utf8' },
    )
    const finalReviewBytes = cleanReviewBytes()
    await writeFile(liveReviewPath, finalReviewBytes)

    const sourceReviewBytes = await immutablePriorReviewBytes({
      repoRoot: temporary,
      sourceCommit: sourceCommit.trim(),
    })
    const liveReviewBytes = await readFile(liveReviewPath)
    assert.deepEqual(liveReviewBytes, finalReviewBytes)
    assert.notDeepEqual(sourceReviewBytes, liveReviewBytes)
    assert.doesNotThrow(
      () => evidenceIntegrity.assertPhase5ReviewLifecycle({
        priorReviewBytes: sourceReviewBytes,
        finalReviewBytes: liveReviewBytes,
      }),
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('accepted schema v3 requires fresh SSHSIG verification and exact bound metadata', async () => {
  assert.equal(typeof assertAuthenticatedAcceptedEvidence, 'function')
  const temporary = await mkdtemp(join(tmpdir(), 'accepted-v3-proof-'))
  try {
    const paths = await temporaryAuthorizationProof(temporary)
    const verified = await verifyOwnerAuthorization({
      ...paths,
      now: FIXED_AUTHORIZATION_TIME,
    })
    const matrix = await readJson(`${PHASE_DIR}/05-RIGHTS-MATRIX.json`)
    const qualityReport = await readJson(`${PHASE_DIR}/05-QUALITY-REPORT.json`)
    const legacyDecision = await readJson(DECISION_PATH)
    const { decision, residue } = authenticatedV3Pair({
      matrix,
      qualityReport,
      legacyDecision,
      verified,
    })

    const accepted = await assertAuthenticatedAcceptedEvidence({
      decision,
      residue,
      ...paths,
      now: FIXED_AUTHORIZATION_TIME,
    })
    assert.equal(accepted.decision, decision)
    assert.equal(accepted.residue, residue)
    assert.equal(accepted.authorization.authenticated, true)
    assert.equal(decision.schema_version, 3)
    assert.equal(residue.schema_version, 4)
    assert.equal(
      decision.owner_authorization_principal,
      'jackshi812',
    )
    assert.equal(
      decision.owner_authorization_namespace,
      'job-copilot-phase-05-owner-v1',
    )
    assert.equal(
      decision.owner_checkpoint_evidence_sha256,
      legacyDecision.owner_checkpoint_evidence_sha256,
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('accepted schema v3 rejects deleted, independently rehashed, and legacy-substituted authorization fields', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'accepted-v3-drift-'))
  try {
    const paths = await temporaryAuthorizationProof(temporary)
    const verified = await verifyOwnerAuthorization({
      ...paths,
      now: FIXED_AUTHORIZATION_TIME,
    })
    const matrix = await readJson(`${PHASE_DIR}/05-RIGHTS-MATRIX.json`)
    const qualityReport = await readJson(`${PHASE_DIR}/05-QUALITY-REPORT.json`)
    const legacyDecision = await readJson(DECISION_PATH)
    const original = authenticatedV3Pair({
      matrix,
      qualityReport,
      legacyDecision,
      verified,
    })
    const authorizationKeys = Object.keys(authorizationFields(verified))

    for (const target of ['decision', 'residue']) {
      for (const key of authorizationKeys) {
        const pair = structuredClone(original)
        delete pair[target][key]
        await assert.rejects(
          () => assertAuthenticatedAcceptedEvidence({
            ...pair,
            ...paths,
            now: FIXED_AUTHORIZATION_TIME,
          }),
          /missing|authorization/i,
          `${target}.${key}`,
        )
      }
    }

    for (const target of ['decision', 'residue']) {
      const pair = structuredClone(original)
      pair[target].owner_authorization_signature_sha256 = SHA_E
      if (target === 'decision') {
        const {
          status,
          decision_contract_sha256,
          zero_residue_sha256,
          ...stable
        } = pair.decision
        pair.decision.decision_contract_sha256 = sha256Json(stable)
        pair.residue.decision_contract_sha256 =
          pair.decision.decision_contract_sha256
      }
      rehashResidue(pair.residue)
      pair.decision.zero_residue_sha256 =
        pair.residue.zero_residue_sha256
      await assert.rejects(
        () => assertAuthenticatedAcceptedEvidence({
          ...pair,
          ...paths,
          now: FIXED_AUTHORIZATION_TIME,
        }),
        /signature|authorization|digest/i,
        `${target} independently rehashed`,
      )
    }

    const substituted = structuredClone(original)
    for (const key of authorizationKeys.filter((value) =>
      value.endsWith('_sha256'))) {
      substituted.decision[key] =
        legacyDecision.owner_checkpoint_evidence_sha256
      substituted.residue[key] =
        legacyDecision.owner_checkpoint_evidence_sha256
    }
    const {
      status,
      decision_contract_sha256,
      zero_residue_sha256,
      ...stable
    } = substituted.decision
    substituted.decision.decision_contract_sha256 = sha256Json(stable)
    substituted.residue.decision_contract_sha256 =
      substituted.decision.decision_contract_sha256
    rehashResidue(substituted.residue)
    substituted.decision.zero_residue_sha256 =
      substituted.residue.zero_residue_sha256
    await assert.rejects(
      () => assertAuthenticatedAcceptedEvidence({
        ...substituted,
        ...paths,
        now: FIXED_AUTHORIZATION_TIME,
      }),
      /authorization|request|signature|nonce|payload/i,
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('accepted schema v3 rejects swapped signatures, stale requests, revoked anchors, and trust-path drift', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'accepted-v3-trust-'))
  try {
    const paths = await temporaryAuthorizationProof(temporary)
    const verified = await verifyOwnerAuthorization({
      ...paths,
      now: FIXED_AUTHORIZATION_TIME,
    })
    const matrix = await readJson(`${PHASE_DIR}/05-RIGHTS-MATRIX.json`)
    const qualityReport = await readJson(`${PHASE_DIR}/05-QUALITY-REPORT.json`)
    const legacyDecision = await readJson(DECISION_PATH)
    const pair = authenticatedV3Pair({
      matrix,
      qualityReport,
      legacyDecision,
      verified,
    })

    const swappedSignaturePath =
      join(temporary, 'swapped-request.json.sig')
    const signatureBytes = await readFile(paths.signaturePath)
    const swapped = Buffer.from(signatureBytes)
    swapped[swapped.indexOf(Buffer.from('U1NI'))] = 0x56
    await writeFile(swappedSignaturePath, swapped, { mode: 0o600 })
    await assert.rejects(
      () => assertAuthenticatedAcceptedEvidence({
        ...pair,
        ...paths,
        signaturePath: swappedSignaturePath,
        now: FIXED_AUTHORIZATION_TIME,
      }),
      /SSHSIG|signature/i,
    )

    await assert.rejects(
      () => assertAuthenticatedAcceptedEvidence({
        ...pair,
        ...paths,
        now: new Date('2026-08-07T00:00:00.000Z'),
      }),
      /expired/i,
    )

    const revokedDir = join(temporary, 'revoked')
    await mkdir(revokedDir)
    const revokedAnchorPath =
      join(revokedDir, 'owner-trust-anchor.json')
    const anchor = await readJson(TRUST_ANCHOR_PATH)
    await writeFile(
      revokedAnchorPath,
      Buffer.from(`${JSON.stringify({
        ...anchor,
        status: 'REVOKED',
        revoked_at: '2026-07-31T00:00:00.000Z',
      }, null, 2)}\n`),
      { mode: 0o600 },
    )
    await assert.rejects(
      () => assertAuthenticatedAcceptedEvidence({
        ...pair,
        ...paths,
        trustAnchorPath: revokedAnchorPath,
        now: FIXED_AUTHORIZATION_TIME,
      }),
      /active|revoked/i,
    )

    const driftedAnchorPath =
      join(temporary, '05-OWNER-TRUST-ANCHOR.json')
    await copyFile(TRUST_ANCHOR_PATH, driftedAnchorPath)
    await chmod(driftedAnchorPath, 0o600)
    await assert.rejects(
      () => assertAuthenticatedAcceptedEvidence({
        ...pair,
        ...paths,
        trustAnchorPath: driftedAnchorPath,
        now: FIXED_AUTHORIZATION_TIME,
      }),
      /canonical public artifact|trust anchor path/i,
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

import { createHash } from 'node:crypto'
import {
  assertNoGoQualityReport,
  sha256Json,
} from './rights-gate.mjs'

export const PINNED_PHASE_5_BASE_SHA =
  'e1d592e8b574ae3e474ce44661b3970954ef00d9'
export const PINNED_PHASE_5_PLAN_PATH =
  '.planning/phases/05-outreach-feasibility-gate/05-01-PLAN.md'
export const PINNED_PHASE_5_PLAN_BLOB_SHA256 =
  '2a7b1050772e674a3f880dbf5d2b8a96ae5dd48fb8e183a05ba8272a7ff6aba0'
export const OWNER_CHECKPOINT_TASK =
  "Task 1: Preserve the owner's one-time raw-byte no-go reconfirmation"

const SHA = /^[0-9a-f]{40}$/
const SHA256 = /^[0-9a-f]{64}$/
const NONCE = /^[0-9a-f]{64}$/
const BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const UTC_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
const MAX_TERMINAL_DOCUMENT_BYTES = 1_000_000
const DISALLOWED_TERMINAL_CONTROLS =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/
const NUMBER_WORDS = Object.freeze(new Map([
  ['three', 3],
]))

const BASELINE_KEYS = Object.freeze([
  'schema_version',
  'phase',
  'status',
  'base_sha',
  'plan_path',
  'plan_blob_sha256',
  'baseline_evidence_sha256',
])
const RECEIPT_KEYS = Object.freeze([
  'schema_version',
  'phase',
  'status',
  'checkpoint_plan',
  'checkpoint_task',
  'gate',
  'owner_checkpoint_request_sha256',
  'nonce',
  'rights_evidence_sha256',
  'quality_evidence_sha256',
  'checkpointed_decision_contract_sha256',
  'baseline_evidence_sha256',
  'owner_response_utf8_base64',
  'owner_response_sha256',
  'received_at',
  'owner_checkpoint_evidence_sha256',
])
const RECONCILIATION_V1_KEYS = Object.freeze([
  'schema_version',
  'phase',
  'requirement_id',
  'status',
  'original_representative_spike_intent',
  'rights_prerequisite',
  'quality_status',
  'spike_executed',
  'representative_case_count',
  'provider_call_count',
  'fixture_count',
  'raw_result_count',
  'production_mutation_count',
  'quality_claim',
  'd09_resolution',
  'd10_resolution',
  'd12_resolution',
  'd13_resolution',
  'rights_evidence_sha256',
  'quality_evidence_sha256',
  'checkpointed_decision_contract_sha256',
  'decision_contract_sha256',
  'owner_checkpoint_evidence_sha256',
  'zero_residue_sha256',
  'roadmap_semantic_sha256',
  'requirements_semantic_sha256',
  'contract_reconciliation_sha256',
])
const RECONCILIATION_AUTHORIZATION_KEYS = Object.freeze([
  'owner_authorization_request_sha256',
  'owner_authorization_signature_sha256',
  'owner_authorization_principal',
  'owner_authorization_namespace',
  'owner_authorization_key_fingerprint',
  'owner_authorization_nonce_sha256',
  'owner_authorization_stopped_decision_payload_sha256',
])
const RECONCILIATION_V2_KEYS = Object.freeze([
  ...RECONCILIATION_V1_KEYS,
  ...RECONCILIATION_AUTHORIZATION_KEYS,
])

function requireCondition(condition, message) {
  if (!condition) throw new Error(message)
}

function requireTerminalText(text, label) {
  requireCondition(
    typeof text === 'string'
      && text.length > 0
      && Buffer.byteLength(text, 'utf8') <= MAX_TERMINAL_DOCUMENT_BYTES
      && !DISALLOWED_TERMINAL_CONTROLS.test(text),
    `${label} is malformed`,
  )
}

function normalizeTerminalSemanticText(text) {
  return text.replace(/\s+/g, ' ').trim()
}

function uniqueTerminalMatch(text, expression, label) {
  const matches = [...text.matchAll(expression)]
  requireCondition(
    matches.length === 1,
    `${label} must occur exactly once`,
  )
  return matches[0]
}

function assertClosedTerminalAuthorizationGrammar({
  text,
  canonicalStatements,
  label,
}) {
  let residual = normalizeTerminalSemanticText(text)
  for (const statement of canonicalStatements) {
    const canonical = normalizeTerminalSemanticText(statement)
    requireCondition(
      residual.includes(canonical),
      `${label} canonical authorization statement is missing`,
    )
    residual = residual.replace(canonical, ' ')
  }
  requireCondition(
    !(
      /\bPhase\s+(?:6|7)\b/i.test(residual)
      || /\blater\s+phases?\b/i.test(residual)
      || /(?<!non-)\bproduction\b/i.test(residual)
    ),
    `${label} contains authorization text outside the canonical grammar`,
  )
}

export function extractRoadmapTerminalContract(text) {
  requireTerminalText(text, 'roadmap')
  const phaseSection = uniqueTerminalMatch(
    text,
    /### Phase 5: Outreach Feasibility Gate[\s\S]*?(?=\n## Progress)/g,
    'roadmap Phase 5 section',
  )[0]
  const normalizedPhaseSection =
    normalizeTerminalSemanticText(phaseSection)
  requireCondition(
    !/^### Phase [67]:/m.test(text),
    'roadmap terminal contract must not admit Phase 6 or Phase 7',
  )
  const milestone = uniqueTerminalMatch(
    text,
    /^- ⛔ \*\*v1\.1 Outreach Intelligence\*\* — Phase (\d+) only; rights ([a-z-]+) accepted; no production outreach search; any redesign requires a separately scoped owner decision$/gm,
    'roadmap Phase 5 stopped milestone declaration',
  )
  const goal = uniqueTerminalMatch(
    normalizedPhaseSection,
    /\*\*Goal\*\*: (The owner can make an evidence-backed go\/no-go decision on the exact public-web-to-LinkedIn workflow before any production result collection is enabled\.) \*\*Depends on\*\*:/g,
    'roadmap Phase 5 goal',
  )
  const requirements = uniqueTerminalMatch(
    normalizedPhaseSection,
    /\*\*Requirements\*\*: (OUTR-\d{2}), (OUTR-\d{2}) \*\*Success Criteria\*\*/g,
    'roadmap Phase 5 requirement inventory',
  )
  const spike = uniqueTerminalMatch(
    normalizedPhaseSection,
    /Phase 5 terminal branch: the D-09\/D-10 rights prerequisite did not clear, so D-12 preserves that (\d+)–(\d+) application, (three)-company representative spike only as conditional intent; the accepted `([A-Z_]+)` instead requires `([A-Z_]+)`, zero representative cases and provider calls, no recall\/company\/title quality claim, and disabled production outreach\./g,
    'roadmap Phase 5 representative-spike terminal branch',
  )
  const stopped = uniqueTerminalMatch(
    normalizedPhaseSection,
    /Phase 5 terminal branch: the receipt-bound owner no-go accepts D-13, selects no redesign, and stops the milestone at Phase (\d+) while production outreach remains disabled\./g,
    'roadmap Phase 5 stopped terminal branch',
  )
  const noGoCriterion = uniqueTerminalMatch(
    normalizedPhaseSection,
    /The owner records a clear go decision only if both the rights\/posture review and the representative search-quality evidence are acceptable; a no-go keeps production search disabled and stops or redirects the milestone before later phases\./g,
    'roadmap Phase 5 no-go criterion',
  )
  assertClosedTerminalAuthorizationGrammar({
    text: normalizedPhaseSection,
    canonicalStatements: [
      goal[1],
      spike[0],
      noGoCriterion[0],
      stopped[0],
    ],
    label: 'roadmap Phase 5 section',
  })
  requireCondition(
    NUMBER_WORDS.has(spike[3]),
    'roadmap representative company count is not canonical',
  )
  requireCondition(
    [...normalizedPhaseSection.matchAll(/Phase 5 terminal branch:/g)].length
      === 2,
    'roadmap Phase 5 terminal branch inventory drift',
  )
  requireCondition(
    milestone[1] === stopped[1],
    'roadmap stopped phase declarations disagree',
  )
  requireCondition(
    milestone[1] === '5'
      && milestone[2] === 'no-go'
      && requirements[1] === 'OUTR-04'
      && requirements[2] === 'OUTR-05'
      && spike[1] === '6'
      && spike[2] === '10'
      && NUMBER_WORDS.get(spike[3]) === 3
      && spike[4] === 'RIGHTS_NO_GO'
      && spike[5] === 'NOT_RUN_RIGHTS_NO_GO',
    'roadmap terminal contract semantic values drift',
  )
  return {
    phase: milestone[1].padStart(2, '0'),
    requirement_id: requirements[2],
    goal: goal[1].startsWith(
      'The owner can make an evidence-backed go/no-go decision',
    )
      ? 'OWNER_EVIDENCE_BACKED_GO_NO_GO_BEFORE_PRODUCTION'
      : null,
    representative_spike_intent:
      Number(spike[1]) < Number(spike[2])
        && NUMBER_WORDS.get(spike[3]) > 0
        ? 'CONDITIONAL_AFTER_RIGHTS_CLEARANCE'
        : null,
    accepted_terminal_branch: spike[4],
    quality_status: spike[5],
    representative_case_count: 0,
    provider_call_count: 0,
    quality_claim: 'NONE',
    production_outreach_enabled: false,
    milestone_status: `STOPPED_PHASE_${stopped[1]}_ONLY`,
    phase_6_authorized: false,
    phase_7_authorized: false,
  }
}

function requirementLine(text, requirementId) {
  const expression = new RegExp(
    `^- \\[(.)\\] \\*\\*${requirementId}\\*\\*:[^\\n]*$`,
    'gm',
  )
  return uniqueTerminalMatch(
    text,
    expression,
    `${requirementId} requirement`,
  )
}

export function extractRequirementsTerminalContract(text) {
  requireTerminalText(text, 'requirements')
  const feasibilitySection = uniqueTerminalMatch(
    text,
    /### Feasibility and Cost[\s\S]*?(?=\n### Outreach Profile)/g,
    'requirements feasibility section',
  )[0]
  const outr04 = requirementLine(text, 'OUTR-04')
  const outr05 = requirementLine(text, 'OUTR-05')
  requireCondition(outr04, 'OUTR-04 requirement is missing')
  requireCondition(outr05, 'OUTR-05 requirement is missing')
  requireCondition(outr04[1] === 'x', 'OUTR-04 must be complete')
  requireCondition(outr05[1] === 'x', 'OUTR-05 must be complete')
  const outr04Semantics = uniqueTerminalMatch(
    outr04[0],
    /^- \[x\] \*\*OUTR-04\*\*: Production implementation proceeds only after the selected public-web search provider permits the intended LinkedIn URL and match-reason display, persistence, and any caching, and the owner accepts the documented LinkedIn-policy posture; otherwise the feature remains (disabled) and is (redesigned or stopped)\.$/g,
    'OUTR-04 semantic contract',
  )
  const outr05Semantics = uniqueTerminalMatch(
    outr05[0],
    /^- \[x\] \*\*OUTR-05\*\*: Before the complete feature is built, the historical (\d+)–(\d+) application, (three)-company representative spike remains conditional on rights clearance; because the accepted branch is `([A-Z_]+)`, D-12 requires `([A-Z_]+)` with zero cases and provider calls, no quality claim, disabled production outreach, and a receipt-bound owner no-go that closes the feasibility decision at a stopped milestone\.$/g,
    'OUTR-05 semantic contract',
  )
  assertClosedTerminalAuthorizationGrammar({
    text: feasibilitySection,
    canonicalStatements: [outr04[0], outr05[0]],
    label: 'requirements feasibility section',
  })
  requireCondition(
    NUMBER_WORDS.has(outr05Semantics[3]),
    'OUTR-05 representative company count is not canonical',
  )
  for (const requirementId of ['OUTR-04', 'OUTR-05']) {
    const traceability = uniqueTerminalMatch(
      text,
      new RegExp(
        `^\\| ${requirementId} \\| Phase (\\d+) \\| (Complete) \\|$`,
        'gm',
      ),
      `${requirementId} traceability`,
    )
    requireCondition(
      traceability[1] === '5',
      `${requirementId} traceability phase drift`,
    )
  }
  requireCondition(
    outr05Semantics[1] === '6'
      && outr05Semantics[2] === '10'
      && NUMBER_WORDS.get(outr05Semantics[3]) === 3
      && outr05Semantics[4] === 'RIGHTS_NO_GO'
      && outr05Semantics[5] === 'NOT_RUN_RIGHTS_NO_GO',
    'OUTR-05 terminal contract semantic values drift',
  )
  return {
    phase: '05',
    requirements: ['OUTR-04', 'OUTR-05'],
    outr_04_complete: outr04[1] === 'x',
    outr_05_complete: outr05[1] === 'x',
    representative_spike_intent:
      Number(outr05Semantics[1]) < Number(outr05Semantics[2])
        && NUMBER_WORDS.get(outr05Semantics[3]) > 0
        ? 'CONDITIONAL_AFTER_RIGHTS_CLEARANCE'
        : null,
    accepted_terminal_branch: outr05Semantics[4],
    quality_status: outr05Semantics[5],
    representative_case_count: 0,
    provider_call_count: 0,
    quality_claim: 'NONE',
    production_outreach_enabled: false,
    milestone_status:
      outr04Semantics[1] === 'disabled'
        && outr04Semantics[2].endsWith('stopped')
        ? 'STOPPED'
        : null,
    later_phase_authorized: false,
  }
}

export function terminalSemanticDigests({
  roadmapText,
  requirementsText,
}) {
  return Object.freeze({
    roadmap_semantic_sha256:
      sha256Json(extractRoadmapTerminalContract(roadmapText)),
    requirements_semantic_sha256:
      sha256Json(extractRequirementsTerminalContract(requirementsText)),
  })
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
}

function requireExactKeys(value, expectedKeys, label) {
  requireCondition(isPlainObject(value), `${label} must be an object`)
  const actual = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  requireCondition(
    actual.length === expected.length
      && actual.every((key, index) => key === expected[index]),
    `${label} schema keys drift`,
  )
}

function requireSha(value, label, pattern = SHA256) {
  requireCondition(
    typeof value === 'string' && pattern.test(value),
    `${label} is malformed`,
  )
}

function requireDigest(record, digestField, label) {
  requireSha(record[digestField], `${label} digest`)
  const { [digestField]: digest, ...body } = record
  requireCondition(
    digest === sha256Json(body),
    `${label} digest mismatch`,
  )
}

function requireCanonicalUtcTimestamp(value, label) {
  const normalized = typeof value === 'string' && !value.includes('.')
    ? value.replace(/Z$/, '.000Z')
    : value
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN
  requireCondition(
    typeof value === 'string'
      && UTC_TIMESTAMP.test(value)
      && Number.isFinite(parsed)
      && new Date(parsed).toISOString() === normalized,
    `${label} is malformed`,
  )
}

export function validateExecutionBaselineArtifact(
  record,
  { requirePinned = true } = {},
) {
  requireExactKeys(record, BASELINE_KEYS, 'execution baseline')
  requireCondition(
    record.schema_version === 1,
    'baseline schema_version must equal 1',
  )
  requireCondition(record.phase === '05', 'baseline phase must equal 05')
  requireCondition(
    record.status === 'PINNED',
    'baseline status must be PINNED',
  )
  requireSha(record.base_sha, 'baseline base SHA', SHA)
  requireCondition(
    typeof record.plan_path === 'string'
      && record.plan_path.length > 0
      && record.plan_path.length <= 300
      && record.plan_path.trim() === record.plan_path,
    'baseline plan path is malformed',
  )
  requireSha(record.plan_blob_sha256, 'baseline plan blob digest')
  if (requirePinned) {
    requireCondition(
      record.base_sha === PINNED_PHASE_5_BASE_SHA
        && record.plan_path === PINNED_PHASE_5_PLAN_PATH
        && record.plan_blob_sha256 === PINNED_PHASE_5_PLAN_BLOB_SHA256,
      'pinned baseline identity drift',
    )
  }
  requireDigest(record, 'baseline_evidence_sha256', 'execution baseline')
  return record
}

export function validateOwnerCheckpointReceiptArtifact(receipt) {
  requireExactKeys(receipt, RECEIPT_KEYS, 'owner checkpoint receipt')
  requireCondition(
    receipt.schema_version === 1,
    'owner checkpoint receipt schema_version must equal 1',
  )
  requireCondition(
    receipt.phase === '05',
    'owner checkpoint receipt phase must equal 05',
  )
  requireCondition(
    receipt.status === 'OWNER_RESPONSE_RECORDED',
    'owner checkpoint receipt status drift',
  )
  requireCondition(
    receipt.checkpoint_plan === '05-07',
    'owner checkpoint receipt plan drift',
  )
  requireCondition(
    receipt.checkpoint_task === OWNER_CHECKPOINT_TASK,
    'owner checkpoint receipt task drift',
  )
  requireCondition(
    receipt.gate === 'blocking-human',
    'owner checkpoint receipt gate drift',
  )
  requireCondition(
    typeof receipt.nonce === 'string' && NONCE.test(receipt.nonce),
    'owner checkpoint receipt nonce is malformed',
  )
  for (const key of [
    'owner_checkpoint_request_sha256',
    'rights_evidence_sha256',
    'quality_evidence_sha256',
    'checkpointed_decision_contract_sha256',
    'baseline_evidence_sha256',
    'owner_response_sha256',
  ]) requireSha(receipt[key], `owner checkpoint receipt ${key}`)
  requireCondition(
    typeof receipt.owner_response_utf8_base64 === 'string'
      && receipt.owner_response_utf8_base64.length > 0
      && BASE64.test(receipt.owner_response_utf8_base64),
    'owner checkpoint response base64 is malformed',
  )
  const responseBytes = Buffer.from(
    receipt.owner_response_utf8_base64,
    'base64',
  )
  requireCondition(
    responseBytes.toString('base64')
      === receipt.owner_response_utf8_base64,
    'owner checkpoint response base64 is non-canonical',
  )
  requireCondition(
    createHash('sha256').update(responseBytes).digest('hex')
      === receipt.owner_response_sha256,
    'owner checkpoint response digest mismatch',
  )
  requireCondition(
    new TextDecoder('utf-8', { fatal: true }).decode(responseBytes).length > 0,
    'owner checkpoint response is not non-empty UTF-8',
  )
  requireCanonicalUtcTimestamp(
    receipt.received_at,
    'owner checkpoint received_at',
  )
  requireDigest(
    receipt,
    'owner_checkpoint_evidence_sha256',
    'owner checkpoint receipt',
  )
  return receipt
}

export function validateContractReconciliationArtifact(
  record,
  {
    principal,
    namespace,
    fingerprint,
  } = {},
) {
  requireCondition(
    record?.schema_version === 1 || record?.schema_version === 2,
    'contract reconciliation schema_version is unrecognized',
  )
  requireExactKeys(
    record,
    record.schema_version === 2
      ? RECONCILIATION_V2_KEYS
      : RECONCILIATION_V1_KEYS,
    'contract reconciliation',
  )
  requireCondition(
    record.phase === '05'
      && record.requirement_id === 'OUTR-05'
      && record.status === 'ACCEPTED_RIGHTS_NO_GO_RECONCILED',
    'contract reconciliation identity drift',
  )
  requireCondition(
    record.original_representative_spike_intent
      === 'Run a representative 6-10 application quality test only after rights clearance.'
      && record.rights_prerequisite === 'NOT_CLEARED_RIGHTS_NO_GO'
      && record.quality_status === 'NOT_RUN_RIGHTS_NO_GO'
      && record.spike_executed === false
      && record.quality_claim === 'NONE',
    'contract reconciliation stopped branch drift',
  )
  for (const key of [
    'representative_case_count',
    'provider_call_count',
    'fixture_count',
    'raw_result_count',
    'production_mutation_count',
  ]) {
    requireCondition(
      record[key] === 0,
      `contract reconciliation ${key} must equal zero`,
    )
  }
  for (const [key, expected] of Object.entries({
    d09_resolution: 'CLEAR_PROHIBITION_CAUSED_RIGHTS_NO_GO',
    d10_resolution: 'UNRESOLVED_AMBIGUITY_CAUSED_RIGHTS_NO_GO',
    d12_resolution: 'RIGHTS_REVIEW_BLOCKED_LIVE_SPIKE',
    d13_resolution: 'OUTREACH_MILESTONE_STOPPED',
  })) {
    requireCondition(
      record[key] === expected,
      `contract reconciliation ${key} drift`,
    )
  }
  for (const key of [
    'rights_evidence_sha256',
    'quality_evidence_sha256',
    'checkpointed_decision_contract_sha256',
    'decision_contract_sha256',
    'owner_checkpoint_evidence_sha256',
    'zero_residue_sha256',
    'roadmap_semantic_sha256',
    'requirements_semantic_sha256',
  ]) requireSha(record[key], `contract reconciliation ${key}`)
  if (record.schema_version === 2) {
    for (const key of [
      'owner_authorization_request_sha256',
      'owner_authorization_signature_sha256',
      'owner_authorization_nonce_sha256',
      'owner_authorization_stopped_decision_payload_sha256',
    ]) requireSha(record[key], `contract reconciliation ${key}`)
    requireCondition(
      typeof principal === 'string'
        && typeof namespace === 'string'
        && typeof fingerprint === 'string',
      'contract reconciliation authorization identity is required',
    )
    requireCondition(
      record.owner_authorization_principal === principal
        && record.owner_authorization_namespace === namespace
        && record.owner_authorization_key_fingerprint === fingerprint,
      'contract reconciliation owner authorization identity drift',
    )
  }
  requireDigest(
    record,
    'contract_reconciliation_sha256',
    'contract reconciliation',
  )
  return record
}

export function assertOwnerAuthorizationEvidenceArtifacts({
  matrix,
  qualityReport,
  ownerCheckpoint,
  baseline,
  reconciliation,
  authorizationIdentity,
}) {
  assertNoGoQualityReport(matrix, qualityReport)
  validateExecutionBaselineArtifact(baseline)
  validateOwnerCheckpointReceiptArtifact(ownerCheckpoint)
  validateContractReconciliationArtifact(
    reconciliation,
    authorizationIdentity,
  )
  requireCondition(
    ownerCheckpoint.rights_evidence_sha256
      === matrix.rights_evidence_sha256
      && ownerCheckpoint.quality_evidence_sha256
        === qualityReport.quality_evidence_sha256
      && ownerCheckpoint.baseline_evidence_sha256
        === baseline.baseline_evidence_sha256,
    'owner authorization evidence lineage drift',
  )
  requireCondition(
    reconciliation.rights_evidence_sha256
      === matrix.rights_evidence_sha256
      && reconciliation.quality_evidence_sha256
        === qualityReport.quality_evidence_sha256
      && reconciliation.owner_checkpoint_evidence_sha256
        === ownerCheckpoint.owner_checkpoint_evidence_sha256,
    'owner authorization reconciliation lineage drift',
  )
  requireCondition(
    ownerCheckpoint.checkpointed_decision_contract_sha256
      === reconciliation.checkpointed_decision_contract_sha256,
    'owner authorization checkpointed decision lineage drift',
  )
  return {
    matrix,
    qualityReport,
    ownerCheckpoint,
    baseline,
    reconciliation,
  }
}

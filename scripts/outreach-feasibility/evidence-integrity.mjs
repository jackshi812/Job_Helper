#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { isDeepStrictEqual, promisify } from 'node:util'
import {
  OWNER_CHECKPOINT_TASK as SHARED_OWNER_CHECKPOINT_TASK,
  PINNED_PHASE_5_BASE_SHA as SHARED_PINNED_PHASE_5_BASE_SHA,
  PINNED_PHASE_5_PLAN_BLOB_SHA256 as SHARED_PINNED_PHASE_5_PLAN_BLOB_SHA256,
  PINNED_PHASE_5_PLAN_PATH as SHARED_PINNED_PHASE_5_PLAN_PATH,
  validateContractReconciliationArtifact,
  validateExecutionBaselineArtifact,
  validateOwnerCheckpointReceiptArtifact,
} from './authorization-evidence-validators.mjs'
import {
  OWNER_AUTHORIZATION_NAMESPACE,
  OWNER_AUTHORIZATION_PRINCIPAL,
  OWNER_KEY_FINGERPRINT,
  assertSignedSemanticReconciliation,
  verifyOwnerAuthorization,
} from './owner-authorization.mjs'
import { sha256Json } from './rights-gate.mjs'

const execFileAsync = promisify(execFile)

const PHASE_DIR =
  '.planning/phases/05-outreach-feasibility-gate'
const RIGHTS_PATH = `${PHASE_DIR}/05-RIGHTS-MATRIX.json`
const QUALITY_PATH = `${PHASE_DIR}/05-QUALITY-REPORT.json`
const DECISION_PATH = `${PHASE_DIR}/05-DECISION.json`
const ZERO_RESIDUE_PATH = `${PHASE_DIR}/05-ZERO-RESIDUE.json`
const BASELINE_PATH = `${PHASE_DIR}/05-EXECUTION-BASELINE.json`
const REQUEST_PATH = `${PHASE_DIR}/05-OWNER-CHECKPOINT-REQUEST.json`
const RECEIPT_PATH = `${PHASE_DIR}/05-OWNER-CHECKPOINT.json`
const RECONCILIATION_PATH =
  `${PHASE_DIR}/05-CONTRACT-RECONCILIATION.json`

export const PINNED_PHASE_5_BASE_SHA =
  SHARED_PINNED_PHASE_5_BASE_SHA
export const PINNED_PHASE_5_PLAN_PATH =
  SHARED_PINNED_PHASE_5_PLAN_PATH
export const PINNED_PHASE_5_PLAN_BLOB_SHA256 =
  SHARED_PINNED_PHASE_5_PLAN_BLOB_SHA256
export const OWNER_CHECKPOINT_TASK =
  SHARED_OWNER_CHECKPOINT_TASK

const SHA = /^[0-9a-f]{40}$/
const SHA256 = /^[0-9a-f]{64}$/
const NONCE = /^[0-9a-f]{64}$/
const UTC_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/

const RIGHTS_KEYS = Object.freeze([
  'schema_version',
  'phase',
  'researched_at',
  'valid_until',
  'sources',
  'operations',
  'rights_evidence_sha256',
])
const RIGHTS_SOURCE_KEYS = Object.freeze([
  'source_id',
  'official_url',
  'source_date_marker',
  'retrieved_at',
  'clause_id',
  'short_paraphrase',
  'evidence_sha256',
])
const RIGHTS_OPERATION_KEYS = Object.freeze([
  'operation',
  'required',
  'status',
  'evidence_refs',
])
const REQUIRED_RIGHTS_OPERATIONS = Object.freeze([
  'public_search',
  'transient_owner_review',
  'persist_profile_url',
  'persist_title_reason',
  'manual_networking_purpose',
  'delete_local_raw_responses',
  'provider_retention',
])
const OPTIONAL_RIGHTS_OPERATION = 'company_level_cache'
const RIGHTS_STATUSES = new Set([
  'ALLOW',
  'PROHIBIT',
  'AMBIGUOUS',
  'NOT_APPLICABLE',
])

const QUALITY_KEYS = Object.freeze([
  'schema_version',
  'phase',
  'status',
  'rights_status',
  'search_authorized',
  'rights_evidence_sha256',
  'quality_evidence_sha256',
  'cases',
  'provider_call_count',
  'fixture_count',
  'raw_result_count',
  'production_mutation_count',
])

const CHECKPOINTED_DECISION_KEYS = Object.freeze([
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
const DECISION_V1_KEYS = Object.freeze([
  ...CHECKPOINTED_DECISION_KEYS,
  'status',
  'decision_contract_sha256',
  'required_owner_attestation',
  'owner_attestation',
  'owner_attestation_source',
  'zero_residue_sha256',
])
const DECISION_V2_STABLE_KEYS = Object.freeze([
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
  'checkpointed_decision_contract_sha256',
  'owner_checkpoint_evidence_sha256',
])
const DECISION_V2_KEYS = Object.freeze([
  ...DECISION_V2_STABLE_KEYS,
  'status',
  'decision_contract_sha256',
  'required_owner_attestation',
  'owner_attestation',
  'zero_residue_sha256',
])
const AUTHORIZATION_FIELD_KEYS = Object.freeze([
  'owner_authorization_request_sha256',
  'owner_authorization_signature_sha256',
  'owner_authorization_principal',
  'owner_authorization_namespace',
  'owner_authorization_key_fingerprint',
  'owner_authorization_nonce_sha256',
  'owner_authorization_issued_at',
  'owner_authorization_verified_at',
  'owner_authorization_stopped_decision_payload_sha256',
])
const DECISION_V3_STABLE_KEYS = Object.freeze([
  ...DECISION_V2_STABLE_KEYS,
  'representative_case_count',
  ...AUTHORIZATION_FIELD_KEYS,
])
const DECISION_V3_KEYS = Object.freeze([
  ...DECISION_V3_STABLE_KEYS,
  'status',
  'decision_contract_sha256',
  'zero_residue_sha256',
])
const REDESIGN_OPTIONS = Object.freeze([
  'user-pasted LinkedIn URLs',
  'non-LinkedIn public professional profiles',
  'stopping outreach',
])

const BASELINE_EMBEDDED_KEYS = Object.freeze([
  'base_sha',
  'plan_path',
  'plan_blob_sha256',
  'baseline_evidence_sha256',
])

const REQUEST_KEYS = Object.freeze([
  'schema_version',
  'phase',
  'status',
  'checkpoint_plan',
  'checkpoint_task',
  'gate',
  'nonce',
  'rights_evidence_sha256',
  'quality_evidence_sha256',
  'checkpointed_decision_contract_sha256',
  'baseline_evidence_sha256',
  'required_response_sha256',
  'owner_checkpoint_request_sha256',
])
const ZERO_V1_KEYS = Object.freeze([
  'schema_version',
  'phase',
  'status',
  'scope',
  'provider_side_retention',
  'scanned_roots',
  'git_surfaces',
  'provider_call_count',
  'fixture_count',
  'raw_result_count',
  'production_mutation_count',
  'forbidden_hit_count',
  'unexpected_survivor_count',
  'symlink_count',
  'rights_evidence_sha256',
  'quality_evidence_sha256',
  'decision_contract_sha256',
  'checked_at',
  'zero_residue_sha256',
])
const ZERO_V2_KEYS = Object.freeze([
  'schema_version',
  'phase',
  'status',
  'scope',
  'provider_side_retention',
  'scanned_roots',
  'baseline',
  'source_snapshot',
  'git_surfaces',
  'administrative_tail_policy',
  'provider_call_count',
  'fixture_count',
  'raw_result_count',
  'production_mutation_count',
  'forbidden_hit_count',
  'unexpected_survivor_count',
  'symlink_count',
  'rights_evidence_sha256',
  'quality_evidence_sha256',
  'decision_contract_sha256',
  'owner_checkpoint_evidence_sha256',
  'baseline_evidence_sha256',
  'checked_at',
  'zero_residue_sha256',
])
const ZERO_V3_KEYS = Object.freeze([
  ...ZERO_V2_KEYS,
  'representative_case_count',
  ...AUTHORIZATION_FIELD_KEYS,
])
const ZERO_V4_KEYS = ZERO_V3_KEYS
const ZERO_V1_WORKTREE_KEYS = Object.freeze([
  'status_entry_count',
  'path_count',
  'blob_count',
])
const ZERO_V1_INDEX_KEYS = Object.freeze([
  'staged_path_count',
  'blob_count',
])
const ZERO_V1_RANGE_KEYS = Object.freeze([
  'base_sha',
  'head_sha',
  'commit_count',
  'path_count',
  'blob_count',
])
const ZERO_V2_WORKTREE_KEYS = Object.freeze([
  'status_entry_count',
  'path_count',
  'blob_count',
  'inventory_sha256',
])
const ZERO_V2_INDEX_KEYS = Object.freeze([
  'staged_path_count',
  'path_count',
  'blob_count',
  'inventory_sha256',
])
const ZERO_V4_WORKTREE_KEYS = Object.freeze([
  'status_entry_count',
  'status_paths',
  'path_count',
  'blob_count',
  'inventory_sha256',
])
const ZERO_V4_INDEX_KEYS = Object.freeze([
  'staged_path_count',
  'staged_paths',
  'path_count',
  'blob_count',
  'inventory_sha256',
])
const ZERO_V2_RANGE_KEYS = Object.freeze([
  'base_sha',
  'head_sha',
  'commit_count',
  'path_count',
  'blob_count',
  'inventory_sha256',
])
const ZERO_V2_SOURCE_TREE_KEYS = Object.freeze([
  'head_sha',
  'path_count',
  'blob_count',
  'tree_sha256',
])
const ZERO_V2_SOURCE_SNAPSHOT_KEYS = Object.freeze([
  'head_sha',
  'controlled_tree_sha256',
  'baseline_to_source_history_sha256',
])
const ZERO_V2_TAIL_POLICY_KEYS = Object.freeze([
  'from_source_head_sha',
  'allowed_paths',
  'allowed_state_transitions',
  'source_changes_allowed',
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
const SCANNED_ROOTS = Object.freeze([
  'scripts/outreach-feasibility/',
  '.planning/phases/05-outreach-feasibility-gate/*.json',
])
const ADMINISTRATIVE_TAIL_PATHS = Object.freeze([
  `${PHASE_DIR}/05-DECISION.json`,
  `${PHASE_DIR}/05-ZERO-RESIDUE.json`,
  `${PHASE_DIR}/05-CONTRACT-RECONCILIATION.json`,
  `${PHASE_DIR}/05-09-SUMMARY.md`,
  `${PHASE_DIR}/05-REVIEW.md`,
  `${PHASE_DIR}/05-VERIFICATION.md`,
  '.planning/ROADMAP.md',
  '.planning/REQUIREMENTS.md',
  '.planning/STATE.md',
])
const ADMINISTRATIVE_TRANSITIONS_V2 = Object.freeze([
  'decision_v1_to_v2_once',
  'zero_residue_v1_to_v2_once',
  'contract_reconciliation_absent_to_v1_once',
  'summary_absent_to_complete_once',
  'review_pre_gap_to_final_once',
  'verification_source_gaps_found_or_absent_to_passed_once',
  'roadmap_phase_05_bookkeeping_only',
  'requirements_outr_05_bookkeeping_only',
  'state_phase_05_bookkeeping_only',
])
const ADMINISTRATIVE_TRANSITIONS_V3 = Object.freeze([
  'decision_v1_to_v2_to_v3_once',
  'zero_residue_v1_to_v2_to_v3_once',
  'contract_reconciliation_absent_to_v1_to_v2_once',
  ...ADMINISTRATIVE_TRANSITIONS_V2.slice(3),
])
const ADMINISTRATIVE_TRANSITIONS_V4 = Object.freeze([
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
const V4_STATIC_ADMINISTRATIVE_PATHS = Object.freeze([
  `${PHASE_DIR}/05-DECISION.json`,
  `${PHASE_DIR}/05-ZERO-RESIDUE.json`,
  `${PHASE_DIR}/05-CONTRACT-RECONCILIATION.json`,
  `${PHASE_DIR}/05-REVIEW.md`,
  `${PHASE_DIR}/05-VERIFICATION.md`,
  '.planning/ROADMAP.md',
  '.planning/REQUIREMENTS.md',
  '.planning/STATE.md',
])
const PLAN_OR_SUMMARY_PATH =
  /^\.planning\/phases\/05-outreach-feasibility-gate\/05-(\d{2})-(PLAN|SUMMARY)\.md$/
const CANONICAL_REPOSITORY_PATH =
  /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)(?!.*[\u0000-\u001f\u007f]).{1,500}$/
const CANONICAL_CLEAN_REVIEW_ATTESTATION =
  'The standard review covered the exact 20-file Phase 5 scope and found zero unresolved findings.'
const PHASE_5_PRIOR_REVIEWED_PATHS = Object.freeze([
  'scripts/outreach-feasibility/adversarial-regression.test.mjs',
  'scripts/outreach-feasibility/decision-evidence.mjs',
  'scripts/outreach-feasibility/decision-evidence.test.mjs',
  'scripts/outreach-feasibility/dormant/spike-runner.mjs',
  'scripts/outreach-feasibility/dormant/spike-runner.test.mjs',
  'scripts/outreach-feasibility/evidence-integrity.mjs',
  'scripts/outreach-feasibility/evidence-integrity.test.mjs',
  'scripts/outreach-feasibility/owner-authorization.mjs',
  'scripts/outreach-feasibility/owner-authorization.test.mjs',
  'scripts/outreach-feasibility/owner-checkpoint.mjs',
  'scripts/outreach-feasibility/owner-checkpoint.test.mjs',
  'scripts/outreach-feasibility/residue-check.mjs',
  'scripts/outreach-feasibility/residue-check.test.mjs',
  'scripts/outreach-feasibility/rights-gate.mjs',
  'scripts/outreach-feasibility/rights-gate.test.mjs',
  'scripts/outreach-feasibility/terminal-audit.mjs',
  'scripts/outreach-feasibility/terminal-audit.test.mjs',
  'scripts/outreach-feasibility/trust/owner-trust-anchor.json',
  'scripts/outreach-feasibility/trust/phase-05-owner.allowed_signers.txt',
  'scripts/outreach-feasibility/trust/phase-05-owner.pub',
])
export const PHASE_5_REVIEWED_PATHS =
  PHASE_5_PRIOR_REVIEWED_PATHS
const PHASE_5_PRIOR_REVIEW_FINDINGS = Object.freeze({
  critical: 7,
  warning: 4,
  info: 0,
  total: 11,
})
const PHASE_5_PRIOR_REVIEW_IDS = Object.freeze([
  'CR-01',
  'CR-02',
  'CR-03',
  'CR-04',
  'CR-05',
  'CR-06',
  'CR-07',
  'WR-01',
  'WR-02',
  'WR-03',
  'WR-04',
])
const PHASE_5_PRIOR_REVIEW_SHA256 =
  '8ef26b90728bc388339c07294ffe819d7e8a6d58cd6377a8f11705f14bc8b752'

function requireCondition(condition, message) {
  if (!condition) throw new Error(message)
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
}

function requireExactKeys(value, expectedKeys, label) {
  requireCondition(isPlainObject(value), `${label} must be an object`)
  const expected = new Set(expectedKeys)
  for (const key of Object.keys(value)) {
    requireCondition(expected.has(key), `${label} has unknown field: ${key}`)
  }
  for (const key of expectedKeys) {
    requireCondition(Object.hasOwn(value, key), `${label} is missing field: ${key}`)
  }
}

function requireSha(value, label, pattern = SHA256) {
  requireCondition(
    typeof value === 'string' && pattern.test(value),
    `${label} is malformed`,
  )
}

function requireNonnegativeInteger(value, label) {
  requireCondition(
    Number.isSafeInteger(value) && value >= 0,
    `${label} must be a nonnegative integer`,
  )
}

function requireNonemptyString(value, label, maxLength = 2_000) {
  requireCondition(
    typeof value === 'string'
      && value.length > 0
      && value.length <= maxLength
      && value.trim() === value,
    `${label} is malformed`,
  )
}

export function requireCanonicalUtcTimestamp(value, label) {
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
  return value
}

function decodeReviewBytes(value, label) {
  requireCondition(
    value instanceof Uint8Array
      && value.byteLength > 0
      && value.byteLength <= 1_000_000,
    `${label} bytes are malformed`,
  )
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(value)
  } catch {
    throw new Error(`${label} bytes are not valid UTF-8`)
  }
  requireCondition(
    !text.includes('\r') && !text.includes('\0'),
    `${label} bytes are not canonical Markdown`,
  )
  return text
}

function requireUniqueFrontmatterScalar(lines, pattern, label) {
  const matches = lines.flatMap((line) => {
    const match = line.match(pattern)
    return match ? [match[1]] : []
  })
  requireCondition(matches.length === 1, `${label} frontmatter drift`)
  return matches[0]
}

function parseReviewDocument(value, label) {
  const text = decodeReviewBytes(value, label)
  const frontmatterMatch = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)
  requireCondition(frontmatterMatch, `${label} frontmatter is malformed`)
  const lines = frontmatterMatch[1].split('\n')
  const phase = requireUniqueFrontmatterScalar(
    lines,
    /^phase: ([a-z0-9.-]+)$/,
    `${label} phase`,
  )
  const reviewed = requireUniqueFrontmatterScalar(
    lines,
    /^reviewed: ([^\s]+)$/,
    `${label} reviewed`,
  )
  requireCanonicalUtcTimestamp(reviewed, `${label} reviewed`)
  const depth = requireUniqueFrontmatterScalar(
    lines,
    /^depth: (quick|standard|deep)$/,
    `${label} depth`,
  )
  requireCondition(
    depth === 'standard',
    `${label} depth must equal standard`,
  )
  const filesReviewedText = requireUniqueFrontmatterScalar(
    lines,
    /^files_reviewed: (\d+)$/,
    `${label} files_reviewed`,
  )
  const filesReviewed = Number(filesReviewedText)
  requireNonnegativeInteger(filesReviewed, `${label} files_reviewed`)
  const status = requireUniqueFrontmatterScalar(
    lines,
    /^status: ([a-z_]+)$/,
    `${label} status`,
  )

  const filesListMarkers = lines
    .map((line, index) => line === 'files_reviewed_list:' ? index : -1)
    .filter((index) => index >= 0)
  requireCondition(
    filesListMarkers.length === 1,
    `${label} files_reviewed_list frontmatter drift`,
  )
  const files = []
  for (
    let index = filesListMarkers[0] + 1;
    index < lines.length && lines[index].startsWith('  - ');
    index += 1
  ) {
    const path = lines[index].slice(4)
    requireCondition(
      path.length > 0
        && path.length <= 300
        && path.trim() === path
        && !/[\u0000-\u001f\u007f]/.test(path),
      `${label} reviewed path is malformed`,
    )
    files.push(path)
  }
  requireCondition(files.length > 0, `${label} files_reviewed_list is empty`)

  const findingMarkers = lines
    .map((line, index) => line === 'findings:' ? index : -1)
    .filter((index) => index >= 0)
  requireCondition(
    findingMarkers.length === 1,
    `${label} findings frontmatter drift`,
  )
  const findings = {}
  const findingIndex = findingMarkers[0]
  for (const [offset, key] of [
    [1, 'critical'],
    [2, 'warning'],
    [3, 'info'],
    [4, 'total'],
  ]) {
    const match = lines[findingIndex + offset]?.match(
      new RegExp(`^  ${key}: (\\d+)$`),
    )
    requireCondition(match, `${label} findings frontmatter drift`)
    findings[key] = Number(match[1])
    requireNonnegativeInteger(findings[key], `${label} findings.${key}`)
  }
  const body = text.slice(frontmatterMatch[0].length)
  const titleMatches = [...body.matchAll(
    /^# Phase 05: Code Review Report$/gm,
  )]
  requireCondition(
    titleMatches.length === 1,
    `${label} canonical title drift`,
  )
  const summaryMatches = [...body.matchAll(
    /^## Summary\n\n([\s\S]*?)(?=\n## |\n---\n|\n_Reviewed:)/gm,
  )]
  requireCondition(
    summaryMatches.length === 1,
    `${label} summary is missing`,
  )
  const summary = summaryMatches[0][1].trim()
  requireCondition(
    summary.length >= 40,
    `${label} summary is not substantive`,
  )
  if (status === 'clean') {
    requireCondition(
      summary === CANONICAL_CLEAN_REVIEW_ATTESTATION,
      `${label} summary is not the closed clean-review attestation`,
    )
  }
  const reviewerMatches = [...body.matchAll(
    /^_Reviewer: the agent \(gsd-code-reviewer\)_$/gm,
  )]
  requireCondition(
    reviewerMatches.length === 1,
    `${label} reviewer metadata drift`,
  )
  const depthMetadataMatches = [...body.matchAll(
    /^_Depth: standard_$/gm,
  )]
  requireCondition(
    depthMetadataMatches.length === 1,
    `${label} depth metadata drift`,
  )
  const reviewedMetadataMatches = [...body.matchAll(
    /^_Reviewed: ([^\s]+)_$/gm,
  )].map((match) => match[1])
  requireCondition(
    reviewedMetadataMatches.length === 1
      && reviewedMetadataMatches[0] === reviewed,
    `${label} reviewed metadata drift`,
  )
  const findingLikeHeadings = [...body.matchAll(
    /^### ((?:CR|BL|WR|IN)-[^\s:]+)(?:\s|:|$)/gm,
  )].map((match) => match[1])
  const issueIds = [...body.matchAll(
    /^### ((?:CR|BL|WR|IN)-\d+)(?:\s|:|$)/gm,
  )].map((match) => match[1])
  requireCondition(
    isDeepStrictEqual(findingLikeHeadings, issueIds),
    `${label} contains a malformed finding heading`,
  )
  const bodyFindings = {
    critical: issueIds.filter(
      (issueId) => issueId.startsWith('CR-') || issueId.startsWith('BL-'),
    ).length,
    warning: issueIds.filter((issueId) => issueId.startsWith('WR-')).length,
    info: issueIds.filter((issueId) => issueId.startsWith('IN-')).length,
    total: issueIds.length,
  }
  return {
    phase,
    reviewed,
    depth,
    filesReviewed,
    files,
    findings,
    status,
    issueIds,
    bodyFindings,
  }
}

export function assertPhase5ReviewLifecycle({
  priorReviewBytes,
  finalReviewBytes,
  priorReviewSourceSha256 = PHASE_5_PRIOR_REVIEW_SHA256,
}) {
  requireCondition(
    priorReviewBytes !== finalReviewBytes,
    'Phase 5 review lifecycle requires distinct prior and final bytes',
  )
  requireSha(
    priorReviewSourceSha256,
    'prior Phase 5 source review digest',
  )
  const priorReviewSha256 =
    createHash('sha256').update(priorReviewBytes).digest('hex')
  requireCondition(
    priorReviewSha256 === priorReviewSourceSha256,
    'prior Phase 5 review does not match the immutable source bytes',
  )
  const prior = parseReviewDocument(
    priorReviewBytes,
    'prior Phase 5 review',
  )
  requireCondition(
    prior.phase === '05-outreach-feasibility-gate',
    'prior Phase 5 review phase drift',
  )
  requireCondition(
    prior.status === 'issues_found',
    'prior Phase 5 review status must equal issues_found',
  )
  requireCondition(
    prior.filesReviewed === PHASE_5_PRIOR_REVIEWED_PATHS.length
      && isDeepStrictEqual(prior.files, PHASE_5_PRIOR_REVIEWED_PATHS),
    'prior Phase 5 review file scope drift',
  )
  requireCondition(
    new Set(prior.files).size === prior.files.length,
    'prior Phase 5 review files contain duplicates',
  )
  requireCondition(
    prior.findings.total
      === prior.findings.critical + prior.findings.warning + prior.findings.info
      && isDeepStrictEqual(prior.bodyFindings, prior.findings)
      && new Set(prior.issueIds).size === prior.issueIds.length,
    'prior Phase 5 review finding body/counter drift',
  )
  if (priorReviewSourceSha256 === PHASE_5_PRIOR_REVIEW_SHA256) {
    requireCondition(
      isDeepStrictEqual(prior.findings, PHASE_5_PRIOR_REVIEW_FINDINGS),
      'prior Phase 5 review finding counters drift',
    )
    requireCondition(
      isDeepStrictEqual(prior.issueIds, PHASE_5_PRIOR_REVIEW_IDS),
      'prior Phase 5 review finding ID lineage drift',
    )
  } else {
    requireCondition(
      prior.findings.total > 0,
      'source-snapshot Phase 5 review must contain unresolved findings',
    )
  }

  const final = parseReviewDocument(
    finalReviewBytes,
    'final Phase 5 review',
  )
  requireCondition(
    final.phase === prior.phase,
    'final Phase 5 review phase drift',
  )
  requireCondition(
    final.status === 'clean',
    'final Phase 5 review status must equal clean',
  )
  requireCondition(
    Object.values(final.findings).every((count) => count === 0),
    'final Phase 5 review findings must all equal zero',
  )
  requireCondition(
    final.findings.total
      === final.findings.critical + final.findings.warning + final.findings.info
      && isDeepStrictEqual(final.bodyFindings, final.findings)
      && new Set(final.issueIds).size === final.issueIds.length,
    'final Phase 5 review finding body/counter drift',
  )
  requireCondition(
    new Set(final.files).size === final.files.length,
    'final Phase 5 review files contain duplicates',
  )
  requireCondition(
    final.filesReviewed === final.files.length,
    'final Phase 5 review file count drift',
  )
  requireCondition(
    final.filesReviewed === PHASE_5_REVIEWED_PATHS.length
      && isDeepStrictEqual(final.files, PHASE_5_REVIEWED_PATHS),
    'final Phase 5 review file scope drift',
  )
  return {
    prior_status: prior.status,
    final_status: final.status,
    prior_files_reviewed: prior.filesReviewed,
    final_files_reviewed: final.filesReviewed,
  }
}

function requireExactArray(value, expected, label) {
  requireCondition(
    Array.isArray(value) && isDeepStrictEqual(value, expected),
    `${label} drift`,
  )
}

function requireCanonicalPathArray(value, label, {
  administrative = false,
} = {}) {
  requireCondition(
    Array.isArray(value) && value.length <= 64,
    `${label} must be a finite path array`,
  )
  for (const path of value) {
    requireCondition(
      typeof path === 'string'
        && CANONICAL_REPOSITORY_PATH.test(path),
      `${label} contains a noncanonical path`,
    )
  }
  requireCondition(
    new Set(value).size === value.length,
    `${label} contains duplicate paths`,
  )
  requireCondition(
    isDeepStrictEqual(value, [...value].sort()),
    `${label} must be sorted`,
  )
  if (administrative) {
    for (const requiredPath of V4_STATIC_ADMINISTRATIVE_PATHS) {
      requireCondition(
        value.includes(requiredPath),
        `${label} is missing a required administrative path`,
      )
    }
    for (const path of value) {
      requireCondition(
        V4_STATIC_ADMINISTRATIVE_PATHS.includes(path)
          || PLAN_OR_SUMMARY_PATH.test(path),
        `${label} contains a non-administrative path`,
      )
    }
  }
  return value
}

function requireDigest(record, digestField, label) {
  requireSha(record[digestField], `${label} digest`)
  const { [digestField]: digest, ...body } = record
  requireCondition(
    digest === sha256Json(body),
    `${label} digest mismatch`,
  )
}

function requireNoGoProjectionFields(value, schemaVersion) {
  requireCondition(value.schema_version === schemaVersion,
    `decision schema_version must equal ${schemaVersion}`)
  requireCondition(value.phase === '05', 'decision phase must equal 05')
  requireCondition(value.rights_status === 'RIGHTS_NO_GO',
    'decision rights status drift')
  requireCondition(value.quality_status === 'NOT_RUN_RIGHTS_NO_GO',
    'decision quality status drift')
  requireCondition(value.search_authorized === false,
    'decision search authorization drift')
  requireCondition(value.production_outreach_enabled === false,
    'decision production state drift')
  requireCondition(value.outreach_milestone_status === 'STOPPED_RIGHTS_NO_GO',
    'decision milestone state drift')
  requireCondition(value.phase_6_authorized === false,
    'decision phase_6_authorized must remain false')
  requireCondition(value.phase_7_authorized === false,
    'decision phase_7_authorized must remain false')
  for (const key of [
    'provider_call_count',
    'fixture_count',
    'raw_result_count',
    'production_mutation_count',
  ]) requireCondition(value[key] === 0, `decision ${key} must equal zero`)
  requireSha(value.rights_evidence_sha256, 'decision rights digest')
  requireSha(value.quality_evidence_sha256, 'decision quality digest')
  requireExactArray(
    value.redesign_handoff_options,
    REDESIGN_OPTIONS,
    'decision redesign options',
  )
  requireCondition(value.redesign_selection === null,
    'decision redesign selection must be null')
}

function checkpointedPayloadFromFields(value) {
  const payload = {}
  for (const key of CHECKPOINTED_DECISION_KEYS) {
    payload[key] = key === 'schema_version' ? 1 : structuredClone(value[key])
  }
  return payload
}

function validateRightsArtifact(matrix) {
  requireExactKeys(matrix, RIGHTS_KEYS, 'rights matrix')
  requireCondition(matrix.schema_version === 1, 'rights schema_version must equal 1')
  requireCondition(matrix.phase === '05', 'rights phase must equal 05')
  requireCondition(
    typeof matrix.researched_at === 'string'
      && /^\d{4}-\d{2}-\d{2}$/.test(matrix.researched_at),
    'rights researched_at is malformed',
  )
  requireCondition(
    typeof matrix.valid_until === 'string'
      && /^\d{4}-\d{2}-\d{2}$/.test(matrix.valid_until),
    'rights valid_until is malformed',
  )
  requireCondition(
    Array.isArray(matrix.sources) && matrix.sources.length > 0,
    'rights sources must be non-empty',
  )
  const sourceIds = new Set()
  for (const source of matrix.sources) {
    requireExactKeys(source, RIGHTS_SOURCE_KEYS, 'rights source')
    requireNonemptyString(source.source_id, 'rights source_id', 100)
    requireCondition(!sourceIds.has(source.source_id), 'duplicate rights source_id')
    sourceIds.add(source.source_id)
    requireCondition(
      typeof source.official_url === 'string'
        && source.official_url.startsWith('https://'),
      'rights source URL is malformed',
    )
    for (const key of [
      'source_date_marker',
      'clause_id',
      'short_paraphrase',
    ]) requireNonemptyString(source[key], `rights ${key}`)
    requireCanonicalUtcTimestamp(source.retrieved_at, 'rights retrieved_at')
    requireDigest(source, 'evidence_sha256', 'rights source')
  }
  requireCondition(
    Array.isArray(matrix.operations)
      && matrix.operations.length === REQUIRED_RIGHTS_OPERATIONS.length + 1,
    'rights operations must contain the finite operation set',
  )
  const operationNames = new Set()
  for (const operation of matrix.operations) {
    requireExactKeys(operation, RIGHTS_OPERATION_KEYS, 'rights operation')
    const expectedRequired =
      REQUIRED_RIGHTS_OPERATIONS.includes(operation.operation)
    requireCondition(
      expectedRequired || operation.operation === OPTIONAL_RIGHTS_OPERATION,
      'rights operation is unrecognized',
    )
    requireCondition(!operationNames.has(operation.operation),
      'duplicate rights operation')
    operationNames.add(operation.operation)
    requireCondition(operation.required === expectedRequired,
      'rights operation required flag drift')
    requireCondition(RIGHTS_STATUSES.has(operation.status),
      'rights operation status drift')
    requireCondition(
      Array.isArray(operation.evidence_refs)
        && operation.evidence_refs.length > 0
        && operation.evidence_refs.every(
          (reference) => typeof reference === 'string'
            && sourceIds.has(reference),
        )
        && new Set(operation.evidence_refs).size
          === operation.evidence_refs.length,
      'rights operation evidence reference drift',
    )
  }
  for (const operation of [
    ...REQUIRED_RIGHTS_OPERATIONS,
    OPTIONAL_RIGHTS_OPERATION,
  ]) {
    requireCondition(operationNames.has(operation),
      `rights operation is missing: ${operation}`)
  }
  requireDigest(matrix, 'rights_evidence_sha256', 'rights matrix')
  return matrix
}

function validateQualityArtifact(report) {
  requireExactKeys(report, QUALITY_KEYS, 'quality report')
  requireCondition(report.schema_version === 1,
    'quality schema_version must equal 1')
  requireCondition(report.phase === '05', 'quality phase must equal 05')
  requireCondition(report.status === 'NOT_RUN_RIGHTS_NO_GO',
    'quality status drift')
  requireCondition(report.rights_status === 'RIGHTS_NO_GO',
    'quality rights status drift')
  requireCondition(report.search_authorized === false,
    'quality search authorization drift')
  requireSha(report.rights_evidence_sha256, 'quality rights digest')
  requireCondition(
    Array.isArray(report.cases) && report.cases.length === 0,
    'quality cases must remain empty',
  )
  for (const key of [
    'provider_call_count',
    'fixture_count',
    'raw_result_count',
    'production_mutation_count',
  ]) requireCondition(report[key] === 0, `quality ${key} must equal zero`)
  requireDigest(report, 'quality_evidence_sha256', 'quality report')
  return report
}

function validateDecisionV1(decision) {
  requireExactKeys(decision, DECISION_V1_KEYS, 'decision v1')
  requireNoGoProjectionFields(decision, 1)
  const payload = checkpointedPayloadFromFields(decision)
  requireSha(decision.decision_contract_sha256, 'decision v1 contract digest')
  requireCondition(
    decision.decision_contract_sha256 === sha256Json(payload),
    'decision v1 contract digest mismatch',
  )
  requireNonemptyString(
    decision.required_owner_attestation,
    'decision v1 required owner attestation',
  )
  if (decision.status === 'PENDING_OWNER_ATTESTATION') {
    requireCondition(
      decision.owner_attestation === null
        && decision.owner_attestation_source === null
        && decision.zero_residue_sha256 === null,
      'pending decision v1 owner/residue state drift',
    )
  } else {
    requireCondition(
      decision.status === 'RIGHTS_NO_GO_ACCEPTED',
      'decision v1 status drift',
    )
    requireCondition(
      decision.owner_attestation === decision.required_owner_attestation,
      'accepted decision v1 owner attestation drift',
    )
    requireCondition(
      decision.owner_attestation_source === 'owner_checkpoint_05-03',
      'accepted decision v1 owner source drift',
    )
    requireSha(decision.zero_residue_sha256, 'decision v1 residue digest')
  }
  return decision
}

function stableDecisionV2Payload(decision) {
  const payload = {}
  for (const key of DECISION_V2_STABLE_KEYS) {
    payload[key] = structuredClone(decision[key])
  }
  return payload
}

function validateDecisionV2(decision) {
  requireExactKeys(decision, DECISION_V2_KEYS, 'decision v2')
  requireNoGoProjectionFields(decision, 2)
  requireSha(
    decision.checkpointed_decision_contract_sha256,
    'checkpointed decision contract digest',
  )
  requireSha(
    decision.owner_checkpoint_evidence_sha256,
    'decision owner checkpoint digest',
  )
  requireCondition(decision.status === 'RIGHTS_NO_GO_ACCEPTED',
    'decision v2 status drift')
  requireNonemptyString(
    decision.required_owner_attestation,
    'decision v2 required owner attestation',
  )
  requireCondition(
    decision.owner_attestation === decision.required_owner_attestation,
    'accepted decision v2 owner attestation drift',
  )
  requireSha(decision.zero_residue_sha256, 'decision v2 residue digest')
  requireSha(decision.decision_contract_sha256,
    'decision v2 contract digest')
  requireCondition(
    decision.decision_contract_sha256
      === sha256Json(stableDecisionV2Payload(decision)),
    'decision v2 contract digest mismatch',
  )
  return decision
}

function validateAuthorizationFields(record, label) {
  for (const key of [
    'owner_authorization_request_sha256',
    'owner_authorization_signature_sha256',
    'owner_authorization_nonce_sha256',
    'owner_authorization_stopped_decision_payload_sha256',
  ]) requireSha(record[key], `${label} ${key}`)
  requireCondition(
    record.owner_authorization_principal
      === OWNER_AUTHORIZATION_PRINCIPAL,
    `${label} owner authorization principal drift`,
  )
  requireCondition(
    record.owner_authorization_namespace
      === OWNER_AUTHORIZATION_NAMESPACE,
    `${label} owner authorization namespace drift`,
  )
  requireCondition(
    record.owner_authorization_key_fingerprint
      === OWNER_KEY_FINGERPRINT,
    `${label} owner authorization key fingerprint drift`,
  )
  requireCanonicalUtcTimestamp(
    record.owner_authorization_issued_at,
    `${label} owner authorization issued_at`,
  )
  requireCanonicalUtcTimestamp(
    record.owner_authorization_verified_at,
    `${label} owner authorization verified_at`,
  )
  requireCondition(
    Date.parse(record.owner_authorization_verified_at)
      >= Date.parse(record.owner_authorization_issued_at),
    `${label} owner authorization verification precedes issuance`,
  )
}

function stableDecisionV3Payload(decision) {
  const payload = {}
  for (const key of DECISION_V3_STABLE_KEYS) {
    payload[key] = structuredClone(decision[key])
  }
  return payload
}

function validateDecisionV3(decision) {
  requireExactKeys(decision, DECISION_V3_KEYS, 'decision v3')
  requireNoGoProjectionFields(decision, 3)
  requireSha(
    decision.checkpointed_decision_contract_sha256,
    'decision v3 checkpointed decision contract digest',
  )
  requireSha(
    decision.owner_checkpoint_evidence_sha256,
    'decision v3 historical integrity receipt digest',
  )
  validateAuthorizationFields(decision, 'decision v3')
  requireCondition(
    decision.representative_case_count === 0,
    'decision v3 representative_case_count must equal zero',
  )
  requireCondition(
    decision.status === 'RIGHTS_NO_GO_ACCEPTED',
    'decision v3 status drift',
  )
  requireSha(
    decision.zero_residue_sha256,
    'decision v3 residue digest',
  )
  requireSha(
    decision.decision_contract_sha256,
    'decision v3 contract digest',
  )
  requireCondition(
    decision.decision_contract_sha256
      === sha256Json(stableDecisionV3Payload(decision)),
    'decision v3 contract digest mismatch',
  )
  return decision
}

function validateBaseline(record, { requirePinned = true } = {}) {
  return validateExecutionBaselineArtifact(record, { requirePinned })
}

function validateRequest(request) {
  requireExactKeys(request, REQUEST_KEYS, 'owner checkpoint request')
  requireCondition(request.schema_version === 1,
    'owner checkpoint request schema_version must equal 1')
  requireCondition(request.phase === '05',
    'owner checkpoint request phase must equal 05')
  requireCondition(request.status === 'AWAITING_OWNER_RESPONSE',
    'owner checkpoint request status drift')
  requireCondition(request.checkpoint_plan === '05-07',
    'owner checkpoint plan drift')
  requireCondition(request.checkpoint_task === OWNER_CHECKPOINT_TASK,
    'owner checkpoint task drift')
  requireCondition(request.gate === 'blocking-human',
    'owner checkpoint gate drift')
  requireCondition(
    typeof request.nonce === 'string' && NONCE.test(request.nonce),
    'owner checkpoint nonce is malformed',
  )
  for (const key of [
    'rights_evidence_sha256',
    'quality_evidence_sha256',
    'checkpointed_decision_contract_sha256',
    'baseline_evidence_sha256',
    'required_response_sha256',
  ]) requireSha(request[key], `owner checkpoint request ${key}`)
  requireDigest(
    request,
    'owner_checkpoint_request_sha256',
    'owner checkpoint request',
  )
  return request
}

function validateReceipt(receipt) {
  return validateOwnerCheckpointReceiptArtifact(receipt)
}

function validateZeroCommon(record, keys, version) {
  requireExactKeys(record, keys, `zero-residue v${version}`)
  requireCondition(record.schema_version === version,
    `zero-residue schema_version must equal ${version}`)
  requireCondition(record.phase === '05', 'zero-residue phase must equal 05')
  requireCondition(record.status === 'PASS', 'zero-residue status must equal PASS')
  requireCondition(record.scope === 'LOCAL_AND_GIT_ONLY',
    'zero-residue scope drift')
  requireCondition(record.provider_side_retention === 'NOT_ASSERTED',
    'zero-residue provider retention drift')
  requireExactArray(record.scanned_roots, SCANNED_ROOTS,
    'zero-residue scanned roots')
  for (const key of ZERO_COUNTER_KEYS) {
    requireCondition(record[key] === 0, `${key} must equal zero`)
  }
  for (const key of [
    'rights_evidence_sha256',
    'quality_evidence_sha256',
    'decision_contract_sha256',
  ]) requireSha(record[key], `zero-residue ${key}`)
  requireCanonicalUtcTimestamp(record.checked_at, 'zero-residue checked_at')
}

function validateZeroV1(record) {
  validateZeroCommon(record, ZERO_V1_KEYS, 1)
  requireExactKeys(record.git_surfaces, [
    'worktree',
    'index',
    'phase_commit_range',
  ], 'zero-residue v1 Git surfaces')
  requireExactKeys(
    record.git_surfaces.worktree,
    ZERO_V1_WORKTREE_KEYS,
    'zero-residue v1 worktree surface',
  )
  requireExactKeys(
    record.git_surfaces.index,
    ZERO_V1_INDEX_KEYS,
    'zero-residue v1 index surface',
  )
  requireExactKeys(
    record.git_surfaces.phase_commit_range,
    ZERO_V1_RANGE_KEYS,
    'zero-residue v1 phase range surface',
  )
  for (const [surface, keys] of [
    [record.git_surfaces.worktree, ZERO_V1_WORKTREE_KEYS],
    [record.git_surfaces.index, ZERO_V1_INDEX_KEYS],
    [record.git_surfaces.phase_commit_range, [
      'commit_count',
      'path_count',
      'blob_count',
    ]],
  ]) {
    for (const key of keys) requireNonnegativeInteger(surface[key], key)
  }
  requireSha(record.git_surfaces.phase_commit_range.base_sha,
    'zero-residue v1 range base', SHA)
  requireSha(record.git_surfaces.phase_commit_range.head_sha,
    'zero-residue v1 range head', SHA)
  requireDigest(record, 'zero_residue_sha256', 'zero-residue v1')
  return record
}

function validateEmbeddedBaseline(baseline) {
  requireExactKeys(baseline, BASELINE_EMBEDDED_KEYS,
    'zero-residue embedded baseline')
  requireCondition(
    baseline.base_sha === PINNED_PHASE_5_BASE_SHA
      && baseline.plan_path === PINNED_PHASE_5_PLAN_PATH
      && baseline.plan_blob_sha256 === PINNED_PHASE_5_PLAN_BLOB_SHA256,
    'zero-residue pinned baseline drift',
  )
  requireSha(baseline.baseline_evidence_sha256,
    'zero-residue embedded baseline digest')
}

function validateInventorySurface(surface, keys, label, countKeys) {
  requireExactKeys(surface, keys, label)
  for (const key of countKeys) requireNonnegativeInteger(surface[key], `${label}.${key}`)
  requireSha(surface.inventory_sha256, `${label}.inventory_sha256`)
}

function validateZeroV2OrV3(record, version, keys) {
  validateZeroCommon(record, keys, version)
  validateEmbeddedBaseline(record.baseline)
  requireExactKeys(
    record.source_snapshot,
    ZERO_V2_SOURCE_SNAPSHOT_KEYS,
    'zero-residue source snapshot',
  )
  requireSha(record.source_snapshot.head_sha,
    'zero-residue source snapshot head', SHA)
  requireSha(record.source_snapshot.controlled_tree_sha256,
    'zero-residue controlled tree digest')
  requireSha(record.source_snapshot.baseline_to_source_history_sha256,
    'zero-residue source history digest')

  requireExactKeys(record.git_surfaces, [
    'worktree',
    'index',
    'phase_commit_range',
    'source_head_tree',
  ], 'zero-residue v2 Git surfaces')
  validateInventorySurface(
    record.git_surfaces.worktree,
    ZERO_V2_WORKTREE_KEYS,
    'zero-residue worktree surface',
    ['status_entry_count', 'path_count', 'blob_count'],
  )
  validateInventorySurface(
    record.git_surfaces.index,
    ZERO_V2_INDEX_KEYS,
    'zero-residue index surface',
    ['staged_path_count', 'path_count', 'blob_count'],
  )
  validateInventorySurface(
    record.git_surfaces.phase_commit_range,
    ZERO_V2_RANGE_KEYS,
    'zero-residue phase range surface',
    ['commit_count', 'path_count', 'blob_count'],
  )
  requireSha(record.git_surfaces.phase_commit_range.base_sha,
    'zero-residue phase range base', SHA)
  requireSha(record.git_surfaces.phase_commit_range.head_sha,
    'zero-residue phase range head', SHA)
  requireExactKeys(
    record.git_surfaces.source_head_tree,
    ZERO_V2_SOURCE_TREE_KEYS,
    'zero-residue source-head tree surface',
  )
  requireSha(record.git_surfaces.source_head_tree.head_sha,
    'zero-residue source-head tree head', SHA)
  for (const key of ['path_count', 'blob_count']) {
    requireNonnegativeInteger(
      record.git_surfaces.source_head_tree[key],
      `zero-residue source-head tree ${key}`,
    )
  }
  requireSha(record.git_surfaces.source_head_tree.tree_sha256,
    'zero-residue source-head tree digest')
  requireCondition(
    record.source_snapshot.head_sha
      === record.git_surfaces.phase_commit_range.head_sha
      && record.source_snapshot.head_sha
        === record.git_surfaces.source_head_tree.head_sha,
    'zero-residue source-head SHA drift',
  )
  requireCondition(
    record.source_snapshot.controlled_tree_sha256
      === record.git_surfaces.source_head_tree.tree_sha256,
    'zero-residue controlled tree digest does not match source-head tree digest',
  )
  requireCondition(
    record.source_snapshot.baseline_to_source_history_sha256
      === record.git_surfaces.phase_commit_range.inventory_sha256,
    'zero-residue source history digest does not match phase range inventory digest',
  )
  requireCondition(
    record.baseline.base_sha
      === record.git_surfaces.phase_commit_range.base_sha,
    'zero-residue range baseline drift',
  )

  requireExactKeys(
    record.administrative_tail_policy,
    ZERO_V2_TAIL_POLICY_KEYS,
    'zero-residue administrative tail policy',
  )
  requireCondition(
    record.administrative_tail_policy.from_source_head_sha
      === record.source_snapshot.head_sha,
    'zero-residue administrative tail source-head drift',
  )
  requireExactArray(
    record.administrative_tail_policy.allowed_paths,
    ADMINISTRATIVE_TAIL_PATHS,
    'zero-residue administrative tail paths',
  )
  requireExactArray(
    record.administrative_tail_policy.allowed_state_transitions,
    version === 3
      ? ADMINISTRATIVE_TRANSITIONS_V3
      : ADMINISTRATIVE_TRANSITIONS_V2,
    'zero-residue administrative transitions',
  )
  requireCondition(
    record.administrative_tail_policy.source_changes_allowed === false,
    'zero-residue source changes must remain disabled',
  )
  requireSha(record.owner_checkpoint_evidence_sha256,
    'zero-residue owner checkpoint digest')
  requireSha(record.baseline_evidence_sha256,
    'zero-residue baseline digest')
  requireCondition(
    record.baseline_evidence_sha256
      === record.baseline.baseline_evidence_sha256,
    'zero-residue baseline digest drift',
  )
  if (version === 3) {
    requireCondition(
      record.representative_case_count === 0,
      'zero-residue v3 representative_case_count must equal zero',
    )
    validateAuthorizationFields(record, 'zero-residue v3')
  }
  requireDigest(
    record,
    'zero_residue_sha256',
    `zero-residue v${version}`,
  )
  return record
}

function validateZeroV2(record) {
  return validateZeroV2OrV3(record, 2, ZERO_V2_KEYS)
}

function validateZeroV3(record) {
  return validateZeroV2OrV3(record, 3, ZERO_V3_KEYS)
}

function validateZeroV4(record) {
  validateZeroCommon(record, ZERO_V4_KEYS, 4)
  validateEmbeddedBaseline(record.baseline)
  requireExactKeys(
    record.source_snapshot,
    ZERO_V2_SOURCE_SNAPSHOT_KEYS,
    'zero-residue v4 source snapshot',
  )
  requireSha(record.source_snapshot.head_sha,
    'zero-residue v4 source snapshot head', SHA)
  requireSha(record.source_snapshot.controlled_tree_sha256,
    'zero-residue v4 controlled tree digest')
  requireSha(record.source_snapshot.baseline_to_source_history_sha256,
    'zero-residue v4 source history digest')

  requireExactKeys(record.git_surfaces, [
    'worktree',
    'index',
    'phase_commit_range',
    'source_head_tree',
  ], 'zero-residue v4 Git surfaces')
  validateInventorySurface(
    record.git_surfaces.worktree,
    ZERO_V4_WORKTREE_KEYS,
    'zero-residue v4 worktree surface',
    ['status_entry_count', 'path_count', 'blob_count'],
  )
  requireCanonicalPathArray(
    record.git_surfaces.worktree.status_paths,
    'zero-residue v4 worktree status_paths',
  )
  requireCondition(
    record.git_surfaces.worktree.status_entry_count
      === record.git_surfaces.worktree.status_paths.length,
    'zero-residue v4 worktree status count drift',
  )
  validateInventorySurface(
    record.git_surfaces.index,
    ZERO_V4_INDEX_KEYS,
    'zero-residue v4 index surface',
    ['staged_path_count', 'path_count', 'blob_count'],
  )
  requireCanonicalPathArray(
    record.git_surfaces.index.staged_paths,
    'zero-residue v4 index staged_paths',
  )
  requireCondition(
    record.git_surfaces.index.staged_path_count
      === record.git_surfaces.index.staged_paths.length,
    'zero-residue v4 index staged count drift',
  )
  validateInventorySurface(
    record.git_surfaces.phase_commit_range,
    ZERO_V2_RANGE_KEYS,
    'zero-residue v4 phase range surface',
    ['commit_count', 'path_count', 'blob_count'],
  )
  requireSha(record.git_surfaces.phase_commit_range.base_sha,
    'zero-residue v4 phase range base', SHA)
  requireSha(record.git_surfaces.phase_commit_range.head_sha,
    'zero-residue v4 phase range head', SHA)
  requireExactKeys(
    record.git_surfaces.source_head_tree,
    ZERO_V2_SOURCE_TREE_KEYS,
    'zero-residue v4 source-head tree surface',
  )
  requireSha(record.git_surfaces.source_head_tree.head_sha,
    'zero-residue v4 source-head tree head', SHA)
  for (const key of ['path_count', 'blob_count']) {
    requireNonnegativeInteger(
      record.git_surfaces.source_head_tree[key],
      `zero-residue v4 source-head tree ${key}`,
    )
  }
  requireSha(record.git_surfaces.source_head_tree.tree_sha256,
    'zero-residue v4 source-head tree digest')
  requireCondition(
    record.source_snapshot.head_sha
      === record.git_surfaces.phase_commit_range.head_sha
      && record.source_snapshot.head_sha
        === record.git_surfaces.source_head_tree.head_sha,
    'zero-residue v4 source-head SHA drift',
  )
  requireCondition(
    record.source_snapshot.controlled_tree_sha256
      === record.git_surfaces.source_head_tree.tree_sha256,
    'zero-residue v4 controlled tree digest does not match source-head tree digest',
  )
  requireCondition(
    record.source_snapshot.baseline_to_source_history_sha256
      === record.git_surfaces.phase_commit_range.inventory_sha256,
    'zero-residue v4 source history digest does not match phase range inventory digest',
  )
  requireCondition(
    record.baseline.base_sha
      === record.git_surfaces.phase_commit_range.base_sha,
    'zero-residue v4 range baseline drift',
  )

  requireExactKeys(
    record.administrative_tail_policy,
    ZERO_V2_TAIL_POLICY_KEYS,
    'zero-residue v4 administrative tail policy',
  )
  requireCondition(
    record.administrative_tail_policy.from_source_head_sha
      === record.source_snapshot.head_sha,
    'zero-residue v4 administrative tail source-head drift',
  )
  requireCanonicalPathArray(
    record.administrative_tail_policy.allowed_paths,
    'zero-residue v4 administrative tail allowed_paths',
    { administrative: true },
  )
  requireExactArray(
    record.administrative_tail_policy.allowed_state_transitions,
    ADMINISTRATIVE_TRANSITIONS_V4,
    'zero-residue v4 administrative transitions',
  )
  requireCondition(
    record.administrative_tail_policy.source_changes_allowed === false,
    'zero-residue v4 source changes must remain disabled',
  )
  requireSha(record.owner_checkpoint_evidence_sha256,
    'zero-residue v4 owner checkpoint digest')
  requireSha(record.baseline_evidence_sha256,
    'zero-residue v4 baseline digest')
  requireCondition(
    record.baseline_evidence_sha256
      === record.baseline.baseline_evidence_sha256,
    'zero-residue v4 baseline digest drift',
  )
  requireCondition(
    record.representative_case_count === 0,
    'zero-residue v4 representative_case_count must equal zero',
  )
  validateAuthorizationFields(record, 'zero-residue v4')
  requireDigest(record, 'zero_residue_sha256', 'zero-residue v4')
  return record
}

export function assertImmutableZeroResidueV3Lineage(record) {
  requireCondition(
    isPlainObject(record) && record.schema_version === 3,
    'immutable zero-residue lineage must use schema v3',
  )
  return validateZeroV3(record)
}

export function assertPublishableZeroResidueRecord(record) {
  requireCondition(
    isPlainObject(record) && record.schema_version === 4,
    'publishable and terminal zero-residue records require schema v4',
  )
  return validateZeroV4(record)
}

function validateReconciliation(record) {
  return validateContractReconciliationArtifact(record, {
    principal: OWNER_AUTHORIZATION_PRINCIPAL,
    namespace: OWNER_AUTHORIZATION_NAMESPACE,
    fingerprint: OWNER_KEY_FINGERPRINT,
  })
}

const ARTIFACT_VALIDATORS = new Map([
  [RIGHTS_PATH, validateRightsArtifact],
  [QUALITY_PATH, validateQualityArtifact],
  [BASELINE_PATH, validateBaseline],
  [REQUEST_PATH, validateRequest],
  [RECEIPT_PATH, validateReceipt],
  [RECONCILIATION_PATH, validateReconciliation],
])

export function assertArtifactSchema(relativePath, parsedArtifact) {
  requireCondition(
    typeof relativePath === 'string' && relativePath.length > 0,
    'artifact path is malformed',
  )
  if (relativePath === DECISION_PATH) {
    requireCondition(isPlainObject(parsedArtifact),
      'decision artifact must be an object')
    if (parsedArtifact.schema_version === 1) {
      return validateDecisionV1(parsedArtifact)
    }
    if (parsedArtifact.schema_version === 2) {
      return validateDecisionV2(parsedArtifact)
    }
    if (parsedArtifact.schema_version === 3) {
      return validateDecisionV3(parsedArtifact)
    }
    throw new Error('decision schema version is unrecognized')
  }
  if (relativePath === ZERO_RESIDUE_PATH) {
    requireCondition(isPlainObject(parsedArtifact),
      'zero-residue artifact must be an object')
    if (parsedArtifact.schema_version === 1) {
      return validateZeroV1(parsedArtifact)
    }
    if (parsedArtifact.schema_version === 2) {
      return validateZeroV2(parsedArtifact)
    }
    if (parsedArtifact.schema_version === 3) {
      return validateZeroV3(parsedArtifact)
    }
    if (parsedArtifact.schema_version === 4) {
      return validateZeroV4(parsedArtifact)
    }
    throw new Error('zero-residue schema version is unrecognized')
  }
  const validator = ARTIFACT_VALIDATORS.get(relativePath)
  requireCondition(
    validator,
    `unrecognized Phase 5 artifact path: ${relativePath}`,
  )
  return validator(parsedArtifact)
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
        GIT_OPTIONAL_LOCKS: '0',
      },
      maxBuffer: 20_000_000,
    })
  } catch {
    throw new Error(`execution baseline Git proof failed during ${args[0]}`)
  }
}

export async function assertExecutionBaseline({
  record,
  repoRoot,
  sourceHeadSha,
}) {
  validateBaseline(record)
  requireCondition(
    typeof repoRoot === 'string' && repoRoot.trim().length > 0,
    'execution baseline repository root is malformed',
  )
  const root = resolve(repoRoot)
  await runGit(root, ['cat-file', '-e', `${record.base_sha}^{commit}`])
  const headSha = sourceHeadSha === undefined
    ? (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim()
    : sourceHeadSha
  requireSha(headSha, 'execution baseline source head', SHA)
  await runGit(root, [
    'merge-base',
    '--is-ancestor',
    record.base_sha,
    headSha,
  ])
  const { stdout: planBytes } = await runGit(
    root,
    ['show', `${record.base_sha}:${record.plan_path}`],
    { encoding: 'buffer' },
  )
  const planDigest = createHash('sha256').update(planBytes).digest('hex')
  requireCondition(
    planDigest === record.plan_blob_sha256,
    'execution baseline plan blob digest mismatch',
  )
  return record
}

function expectedCheckpointedPayload({ matrix, qualityReport }) {
  validateRightsArtifact(matrix)
  validateQualityArtifact(qualityReport)
  requireCondition(
    qualityReport.rights_evidence_sha256 === matrix.rights_evidence_sha256,
    'checkpointed decision rights digest drift',
  )
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
    redesign_handoff_options: [...REDESIGN_OPTIONS],
    redesign_selection: null,
  }
}

export function checkpointedDecisionPayloadFromAccepted({
  decision,
  matrix,
  qualityReport,
}) {
  if (decision?.schema_version === 2) {
    validateDecisionV2(decision)
  } else if (decision?.schema_version === 3) {
    validateDecisionV3(decision)
  } else {
    throw new Error('accepted decision schema version is unrecognized')
  }
  const projected = checkpointedPayloadFromFields(decision)
  const expected = expectedCheckpointedPayload({ matrix, qualityReport })
  for (const key of CHECKPOINTED_DECISION_KEYS) {
    requireCondition(
      isDeepStrictEqual(projected[key], expected[key]),
      `checkpointed decision projection drift: ${key}`,
    )
  }
  return projected
}

export function resolveCheckpointedDecisionContractSha256({
  decision,
  matrix,
  qualityReport,
}) {
  const expected = expectedCheckpointedPayload({ matrix, qualityReport })
  if (decision?.schema_version === 1) {
    validateDecisionV1(decision)
    const actual = checkpointedPayloadFromFields(decision)
    requireCondition(
      isDeepStrictEqual(actual, expected),
      'checkpointed decision v1 payload drift',
    )
    return decision.decision_contract_sha256
  }
  if (decision?.schema_version === 2) {
    const projected = checkpointedDecisionPayloadFromAccepted({
      decision,
      matrix,
      qualityReport,
    })
    const digest = sha256Json(projected)
    requireCondition(
      digest === decision.checkpointed_decision_contract_sha256,
      'checkpointed decision digest mismatch',
    )
    return digest
  }
  if (decision?.schema_version === 3) {
    const projected = checkpointedDecisionPayloadFromAccepted({
      decision,
      matrix,
      qualityReport,
    })
    const digest = sha256Json(projected)
    requireCondition(
      digest === decision.checkpointed_decision_contract_sha256,
      'checkpointed decision digest mismatch',
    )
    return digest
  }
  throw new Error('decision schema version is unrecognized')
}

export function assertZeroResidueRecord(record, expectedDigests) {
  requireCondition(isPlainObject(record), 'zero-residue record must be an object')
  if (record.schema_version === 1) {
    validateZeroV1(record)
    requireExactKeys(expectedDigests, [
      'rights_evidence_sha256',
      'quality_evidence_sha256',
      'decision_contract_sha256',
    ], 'expected zero-residue v1 digests')
    for (const key of [
      'rights_evidence_sha256',
      'quality_evidence_sha256',
      'decision_contract_sha256',
    ]) {
      requireCondition(
        record[key] === expectedDigests[key],
        `zero-residue v1 evidence digest drift: ${key}`,
      )
    }
    return record
  }
  if (record.schema_version === 2) {
    validateZeroV2(record)
    requireExactKeys(expectedDigests, [
      'rights_evidence_sha256',
      'quality_evidence_sha256',
      'decision_contract_sha256',
      'owner_checkpoint_evidence_sha256',
      'baseline_evidence_sha256',
    ], 'expected zero-residue v2 digests')
    for (const key of [
      'rights_evidence_sha256',
      'quality_evidence_sha256',
      'decision_contract_sha256',
      'owner_checkpoint_evidence_sha256',
      'baseline_evidence_sha256',
    ]) {
      requireCondition(
        record[key] === expectedDigests[key],
        `zero-residue v2 evidence digest drift: ${key}`,
      )
    }
    return record
  }
  if (record.schema_version === 3) {
    validateZeroV3(record)
    requireExactKeys(expectedDigests, [
      'rights_evidence_sha256',
      'quality_evidence_sha256',
      'decision_contract_sha256',
      'owner_checkpoint_evidence_sha256',
      'baseline_evidence_sha256',
    ], 'expected zero-residue v3 digests')
    for (const key of [
      'rights_evidence_sha256',
      'quality_evidence_sha256',
      'decision_contract_sha256',
      'owner_checkpoint_evidence_sha256',
      'baseline_evidence_sha256',
    ]) {
      requireCondition(
        record[key] === expectedDigests[key],
        `zero-residue v3 evidence digest drift: ${key}`,
      )
    }
    return record
  }
  if (record.schema_version === 4) {
    validateZeroV4(record)
    requireExactKeys(expectedDigests, [
      'rights_evidence_sha256',
      'quality_evidence_sha256',
      'decision_contract_sha256',
      'owner_checkpoint_evidence_sha256',
      'baseline_evidence_sha256',
    ], 'expected zero-residue v4 digests')
    for (const key of [
      'rights_evidence_sha256',
      'quality_evidence_sha256',
      'decision_contract_sha256',
      'owner_checkpoint_evidence_sha256',
      'baseline_evidence_sha256',
    ]) {
      requireCondition(
        record[key] === expectedDigests[key],
        `zero-residue v4 evidence digest drift: ${key}`,
      )
    }
    return record
  }
  throw new Error('zero-residue schema version is unrecognized')
}

function verifiedAuthorizationFields(authorization) {
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

async function assertAuthenticatedAcceptedEvidenceWithResidue({
  decision,
  residue,
  reconciliation,
  requestPath,
  signaturePath,
  trustAnchorPath,
  publicKeyPath,
  allowedSignersPath,
  assertResidue,
  residueLabel,
  now = new Date(),
}) {
  const authorization = await verifyOwnerAuthorization({
    requestPath,
    signaturePath,
    trustAnchorPath,
    publicKeyPath,
    allowedSignersPath,
    now,
  })
  requireCondition(
    authorization.authenticated === true
      && authorization.status === 'OWNER_AUTHORIZATION_VERIFIED',
    'fresh owner authorization did not authenticate',
  )
  if (reconciliation !== undefined) {
    assertSignedSemanticReconciliation({
      authorization,
      reconciliation,
    })
  }

  validateDecisionV3(decision)
  assertResidue(residue)
  const expectedAuthorization =
    verifiedAuthorizationFields(authorization)
  for (const [key, value] of Object.entries(expectedAuthorization)) {
    if (key === 'owner_authorization_verified_at') continue
    requireCondition(
      decision[key] === value,
      `decision v3 fresh authorization drift: ${key}`,
    )
    requireCondition(
      residue[key] === value,
      `${residueLabel} fresh authorization drift: ${key}`,
    )
  }
  requireCondition(
    decision.owner_authorization_verified_at
      === residue.owner_authorization_verified_at,
    'authenticated decision/residue verification time drift',
  )
  const recordedVerification = Date.parse(
    decision.owner_authorization_verified_at,
  )
  requireCondition(
    recordedVerification <= Date.parse(authorization.verified_at)
      && recordedVerification <= Date.parse(authorization.request.expires_at),
    'recorded owner authorization verification time is not fresh',
  )

  const signedRequest = authorization.request
  requireCondition(
    decision.owner_checkpoint_evidence_sha256
      === signedRequest.owner_checkpoint_evidence_sha256
      && residue.owner_checkpoint_evidence_sha256
        === signedRequest.owner_checkpoint_evidence_sha256,
    'historical integrity receipt lineage drift',
  )
  for (const key of [
    'rights_evidence_sha256',
    'quality_evidence_sha256',
  ]) {
    requireCondition(
      decision[key] === signedRequest[key]
        && residue[key] === signedRequest[key],
      `signed stopped decision drift: ${key}`,
    )
  }
  requireCondition(
    residue.baseline_evidence_sha256
      === signedRequest.baseline_evidence_sha256,
    'signed stopped decision baseline evidence drift',
  )
  requireCondition(
    decision.decision_contract_sha256
      === residue.decision_contract_sha256,
    'authenticated decision/residue contract digest drift',
  )
  requireCondition(
    decision.zero_residue_sha256 === residue.zero_residue_sha256,
    'authenticated decision/residue pair digest drift',
  )

  return Object.freeze({
    decision,
    residue,
    authorization,
  })
}

export function assertAuthenticatedAcceptedEvidence(options) {
  return assertAuthenticatedAcceptedEvidenceWithResidue({
    ...options,
    assertResidue: assertPublishableZeroResidueRecord,
    residueLabel: 'zero-residue v4',
  })
}

export function assertAuthenticatedAcceptedV3Lineage(options) {
  return assertAuthenticatedAcceptedEvidenceWithResidue({
    ...options,
    assertResidue: assertImmutableZeroResidueV3Lineage,
    residueLabel: 'immutable zero-residue v3 lineage',
  })
}

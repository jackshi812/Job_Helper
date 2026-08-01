#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  OWNER_CHECKPOINT_TASK,
  assertArtifactSchema,
  assertExecutionBaseline,
  resolveCheckpointedDecisionContractSha256,
} from './evidence-integrity.mjs'
import {
  assertNoGoQualityReport,
  evaluateRights,
  inspectRightsMatrix,
  sha256Json,
} from './rights-gate.mjs'

const PHASE_DIR =
  '.planning/phases/05-outreach-feasibility-gate'
const REQUEST_PATH = `${PHASE_DIR}/05-OWNER-CHECKPOINT-REQUEST.json`
const RECEIPT_PATH = `${PHASE_DIR}/05-OWNER-CHECKPOINT.json`
const BASELINE_PATH = `${PHASE_DIR}/05-EXECUTION-BASELINE.json`
const MATRIX_PATH = `${PHASE_DIR}/05-RIGHTS-MATRIX.json`
const QUALITY_PATH = `${PHASE_DIR}/05-QUALITY-REPORT.json`
const DECISION_PATH = `${PHASE_DIR}/05-DECISION.json`
const SHA256 = /^[0-9a-f]{64}$/
export const MAX_OWNER_CHECKPOINT_BYTES = 1024

function requireCondition(condition, message) {
  if (!condition) throw new Error(message)
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function responseTextFromFields(request) {
  return [
    'I RECONFIRM PHASE 5 RIGHTS_NO_GO',
    'quality is NOT_RUN_RIGHTS_NO_GO',
    'production outreach search remains disabled',
    'no provider call or representative spike is permitted',
    `request nonce ${request.nonce}`,
    `rights evidence ${request.rights_evidence_sha256}`,
    `quality evidence ${request.quality_evidence_sha256}`,
    `checkpointed decision ${request.checkpointed_decision_contract_sha256}`,
    `execution baseline ${request.baseline_evidence_sha256}.`,
  ].join('; ')
}

export function exactOwnerCheckpointResponse(request) {
  assertArtifactSchema(REQUEST_PATH, request)
  const response = responseTextFromFields(request)
  requireCondition(
    sha256Bytes(Buffer.from(response, 'utf8'))
      === request.required_response_sha256,
    'owner checkpoint required response digest drift',
  )
  return response
}

function assertCurrentNoGo(matrix, qualityReport, now) {
  inspectRightsMatrix(matrix, { now })
  const verdict = evaluateRights(matrix, { now })
  requireCondition(
    verdict.status === 'RIGHTS_NO_GO'
      && verdict.search_authorized === false
      && verdict.quality_status === 'NOT_RUN_RIGHTS_NO_GO',
    'owner checkpoint requires current RIGHTS_NO_GO evidence',
  )
  assertNoGoQualityReport(matrix, qualityReport, { now })
}

export function assertOwnerCheckpointRequest({
  request,
  baseline,
  matrix,
  qualityReport,
  checkpointedDecisionContractSha256,
  now = new Date(),
}) {
  assertArtifactSchema(BASELINE_PATH, baseline)
  assertArtifactSchema(MATRIX_PATH, matrix)
  assertArtifactSchema(QUALITY_PATH, qualityReport)
  assertArtifactSchema(REQUEST_PATH, request)
  assertCurrentNoGo(matrix, qualityReport, now)
  requireCondition(
    typeof checkpointedDecisionContractSha256 === 'string'
      && SHA256.test(checkpointedDecisionContractSha256),
    'checkpointed decision contract digest is malformed',
  )
  requireCondition(
    request.rights_evidence_sha256 === matrix.rights_evidence_sha256,
    'owner checkpoint request rights evidence digest drift',
  )
  requireCondition(
    request.quality_evidence_sha256
      === qualityReport.quality_evidence_sha256,
    'owner checkpoint request quality evidence digest drift',
  )
  requireCondition(
    request.checkpointed_decision_contract_sha256
      === checkpointedDecisionContractSha256,
    'owner checkpoint request checkpointed decision digest drift',
  )
  requireCondition(
    request.baseline_evidence_sha256
      === baseline.baseline_evidence_sha256,
    'owner checkpoint request baseline evidence digest drift',
  )
  const response = responseTextFromFields(request)
  requireCondition(
    request.required_response_sha256
      === sha256Bytes(Buffer.from(response, 'utf8')),
    'owner checkpoint required response digest drift',
  )
  return request
}

function assertOwnerCheckpointRecordStructure({
  request,
  record,
  baseline,
  matrix,
  qualityReport,
  checkpointedDecisionContractSha256,
  now = new Date(),
}) {
  assertOwnerCheckpointRequest({
    request,
    baseline,
    matrix,
    qualityReport,
    checkpointedDecisionContractSha256,
    now,
  })
  assertArtifactSchema(RECEIPT_PATH, record)
  const requestBindings = {
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
  }
  for (const [key, value] of Object.entries(requestBindings)) {
    requireCondition(
      record[key] === value,
      `owner checkpoint record ${key.replaceAll('_', ' ')} drift`,
    )
  }
  const responseBytes = Buffer.from(
    record.owner_response_utf8_base64,
    'base64',
  )
  requireCondition(
    responseBytes.equals(
      Buffer.from(exactOwnerCheckpointResponse(request), 'utf8'),
    ),
    'owner checkpoint record response bytes drift',
  )
  requireCondition(
    record.owner_response_sha256 === request.required_response_sha256,
    'owner checkpoint record response digest drift',
  )
  return record
}

export function assertOwnerCheckpointIntegrityRecord(args) {
  const record = assertOwnerCheckpointRecordStructure(args)
  return Object.freeze({
    status: 'INTEGRITY_ONLY_NOT_AUTHENTICATED',
    scope: 'integrity_only',
    authenticated: false,
    record,
  })
}

// Compatibility boundary for historical structural callers. This validates
// lineage and byte integrity only; fresh authorization must use the independent
// SSHSIG verifier in owner-authorization.mjs.
export function assertOwnerCheckpointRecord(args) {
  return assertOwnerCheckpointIntegrityRecord(args).record
}

function buildOwnerCheckpointRequest({
  baseline,
  matrix,
  qualityReport,
  checkpointedDecisionContractSha256,
  nonce = randomBytes(32).toString('hex'),
}) {
  requireCondition(/^[0-9a-f]{64}$/.test(nonce),
    'owner checkpoint nonce is malformed')
  const responseFields = {
    nonce,
    rights_evidence_sha256: matrix.rights_evidence_sha256,
    quality_evidence_sha256: qualityReport.quality_evidence_sha256,
    checkpointed_decision_contract_sha256:
      checkpointedDecisionContractSha256,
    baseline_evidence_sha256: baseline.baseline_evidence_sha256,
  }
  const body = {
    schema_version: 1,
    phase: '05',
    status: 'AWAITING_OWNER_RESPONSE',
    checkpoint_plan: '05-07',
    checkpoint_task: OWNER_CHECKPOINT_TASK,
    gate: 'blocking-human',
    ...responseFields,
    required_response_sha256: sha256Bytes(
      Buffer.from(responseTextFromFields(responseFields), 'utf8'),
    ),
  }
  const request = {
    ...body,
    owner_checkpoint_request_sha256: sha256Json(body),
  }
  assertOwnerCheckpointRequest({
    request,
    baseline,
    matrix,
    qualityReport,
    checkpointedDecisionContractSha256,
  })
  return request
}

function buildOwnerCheckpointRecord({
  request,
  responseBytes,
  baseline,
  matrix,
  qualityReport,
  checkpointedDecisionContractSha256,
  receivedAt = new Date(),
}) {
  const timestamp = new Date(receivedAt)
  requireCondition(Number.isFinite(timestamp.getTime()),
    'owner checkpoint received time is malformed')
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
    owner_response_sha256: sha256Bytes(responseBytes),
    received_at: timestamp.toISOString(),
  }
  const record = {
    ...body,
    owner_checkpoint_evidence_sha256: sha256Json(body),
  }
  assertOwnerCheckpointRecord({
    request,
    record,
    baseline,
    matrix,
    qualityReport,
    checkpointedDecisionContractSha256,
  })
  return record
}

function parseArgs(argv) {
  const parsed = {
    command: null,
    requestPath: null,
    recordPath: null,
    baselinePath: null,
    matrixPath: null,
    qualityReportPath: null,
    decisionPath: null,
  }
  const commands = new Map([
    ['--create-request', 'createRequest'],
    ['--assert-request', 'assertRequest'],
    ['--print-required-response', 'printRequiredResponse'],
    ['--record-response', 'recordResponse'],
    ['--assert-record', 'assertRecord'],
  ])
  const pathFlags = new Map([
    ['--request', 'requestPath'],
    ['--record', 'recordPath'],
    ['--baseline', 'baselinePath'],
    ['--matrix', 'matrixPath'],
    ['--quality-report', 'qualityReportPath'],
    ['--decision', 'decisionPath'],
  ])
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (commands.has(argument)) {
      requireCondition(parsed.command === null,
        'choose exactly one owner checkpoint command')
      parsed.command = commands.get(argument)
    } else if (pathFlags.has(argument)) {
      const value = argv[++index]
      requireCondition(
        value && !value.startsWith('--'),
        `${argument} requires a path`,
      )
      const key = pathFlags.get(argument)
      requireCondition(parsed[key] === null, `duplicate ${argument}`)
      parsed[key] = value
    } else {
      throw new Error(`unknown argument: ${argument}`)
    }
  }
  requireCondition(parsed.command !== null,
    'choose exactly one owner checkpoint command')
  for (const [key, flag] of [
    ['requestPath', '--request'],
    ['baselinePath', '--baseline'],
    ['matrixPath', '--matrix'],
    ['qualityReportPath', '--quality-report'],
    ['decisionPath', '--decision'],
  ]) requireCondition(parsed[key] !== null, `${flag} is required`)
  if (parsed.command === 'recordResponse' || parsed.command === 'assertRecord') {
    requireCondition(parsed.recordPath !== null, '--record is required')
  } else {
    requireCondition(parsed.recordPath === null,
      '--record is only valid for record commands')
  }
  return parsed
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(resolve(path), 'utf8'))
  } catch {
    throw new Error(`${label} could not be read`)
  }
}

async function loadEvidence(args) {
  const [baseline, matrix, qualityReport, decision] = await Promise.all([
    readJson(args.baselinePath, 'execution baseline'),
    readJson(args.matrixPath, 'rights matrix'),
    readJson(args.qualityReportPath, 'quality report'),
    readJson(args.decisionPath, 'decision'),
  ])
  assertArtifactSchema(DECISION_PATH, decision)
  await assertExecutionBaseline({
    record: baseline,
    repoRoot: process.cwd(),
  })
  const checkpointedDecisionContractSha256 =
    resolveCheckpointedDecisionContractSha256({
      decision,
      matrix,
      qualityReport,
    })
  return {
    baseline,
    matrix,
    qualityReport,
    decision,
    checkpointedDecisionContractSha256,
  }
}

async function writeJsonExclusive(path, value, label) {
  try {
    await writeFile(
      resolve(path),
      `${JSON.stringify(value, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx' },
    )
  } catch {
    throw new Error(`${label} already exists or cannot be created`)
  }
}

export async function readRawStdin(stream = process.stdin) {
  const chunks = []
  let totalBytes = 0
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += bytes.length
    requireCondition(
      totalBytes <= MAX_OWNER_CHECKPOINT_BYTES,
      `owner checkpoint stdin exceeds ${MAX_OWNER_CHECKPOINT_BYTES} bytes`,
    )
    chunks.push(bytes)
  }
  return Buffer.concat(chunks, totalBytes)
}

async function main(argv) {
  const args = parseArgs(argv)
  const evidence = await loadEvidence(args)
  if (args.command === 'createRequest') {
    const request = buildOwnerCheckpointRequest(evidence)
    await writeJsonExclusive(
      args.requestPath,
      request,
      'owner checkpoint request',
    )
    return
  }

  const request = await readJson(
    args.requestPath,
    'owner checkpoint request',
  )
  assertOwnerCheckpointRequest({ request, ...evidence })
  if (args.command === 'assertRequest') {
    process.stdout.write(`${JSON.stringify({
      status: request.status,
      checkpoint_plan: request.checkpoint_plan,
      checkpoint_task: request.checkpoint_task,
      gate: request.gate,
      owner_checkpoint_request_sha256:
        request.owner_checkpoint_request_sha256,
    }, null, 2)}\n`)
    return
  }
  if (args.command === 'printRequiredResponse') {
    process.stdout.write(exactOwnerCheckpointResponse(request))
    return
  }
  if (args.command === 'recordResponse') {
    const responseBytes = await readRawStdin(process.stdin)
    requireCondition(
      responseBytes.equals(
        Buffer.from(exactOwnerCheckpointResponse(request), 'utf8'),
      ),
      'stdin does not match the exact raw owner response bytes',
    )
    const record = buildOwnerCheckpointRecord({
      request,
      responseBytes,
      ...evidence,
    })
    await writeJsonExclusive(
      args.recordPath,
      record,
      'owner checkpoint record',
    )
    return
  }

  const record = await readJson(
    args.recordPath,
    'owner checkpoint record',
  )
  const integrityResult = assertOwnerCheckpointIntegrityRecord({
    request,
    record,
    ...evidence,
  })
  process.stdout.write(`${JSON.stringify({
    status: integrityResult.status,
    scope: integrityResult.scope,
    authenticated: integrityResult.authenticated,
    historical_record_status: record.status,
    checkpoint_plan: record.checkpoint_plan,
    checkpoint_task: record.checkpoint_task,
    gate: record.gate,
    owner_checkpoint_request_sha256:
      record.owner_checkpoint_request_sha256,
    owner_checkpoint_evidence_sha256:
      record.owner_checkpoint_evidence_sha256,
  }, null, 2)}\n`)
}

const isMainModule = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url

if (isMainModule) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'owner checkpoint failed'}\n`,
    )
    process.exitCode = 1
  })
}

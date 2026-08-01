import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import * as ownerCheckpoint from './owner-checkpoint.mjs'
import {
  assertOwnerCheckpointIntegrityRecord,
  assertOwnerCheckpointRecord,
  assertOwnerCheckpointRequest,
  exactOwnerCheckpointResponse,
} from './owner-checkpoint.mjs'
import { assertArtifactSchema } from './evidence-integrity.mjs'
import { sha256Json } from './rights-gate.mjs'

const PHASE_DIR =
  '.planning/phases/05-outreach-feasibility-gate'
const REQUEST_PATH = `${PHASE_DIR}/05-OWNER-CHECKPOINT-REQUEST.json`
const RECEIPT_PATH = `${PHASE_DIR}/05-OWNER-CHECKPOINT.json`
const BASELINE_PATH = `${PHASE_DIR}/05-EXECUTION-BASELINE.json`
const MATRIX_PATH = `${PHASE_DIR}/05-RIGHTS-MATRIX.json`
const QUALITY_PATH = `${PHASE_DIR}/05-QUALITY-REPORT.json`
const DECISION_PATH = `${PHASE_DIR}/05-DECISION.json`
const CLI_PATH = resolve(
  'scripts/outreach-feasibility/owner-checkpoint.mjs',
)
const REDESIGN_OPTIONS = [
  'user-pasted LinkedIn URLs',
  'non-LinkedIn public professional profiles',
  'stopping outreach',
]

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), 'utf8'))
}

function checkpointedDigest(decision) {
  return decision.schema_version >= 2
    ? decision.checkpointed_decision_contract_sha256
    : decision.decision_contract_sha256
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function runCli(args, { stdin = null } = {}) {
  return new Promise((resolveRun) => {
    const environment = { ...process.env }
    delete environment.TAVILY_API_KEY
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd: resolve('.'),
      env: environment,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.on('close', (code) => {
      resolveRun({
        code,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      })
    })
    if (stdin === null) child.stdin.end()
    else child.stdin.end(stdin)
  })
}

function commonArgs(requestPath, decisionPath = DECISION_PATH) {
  return [
    '--request',
    requestPath,
    '--baseline',
    BASELINE_PATH,
    '--matrix',
    MATRIX_PATH,
    '--quality-report',
    QUALITY_PATH,
    '--decision',
    decisionPath,
  ]
}

async function createRequest(requestPath) {
  const result = await runCli([
    '--create-request',
    ...commonArgs(requestPath),
  ])
  assert.equal(result.code, 0, result.stderr.toString('utf8'))
  assert.equal(result.stdout.length, 0)
  return readJson(requestPath)
}

function decisionV2({ matrix, qualityReport, legacyDecision, ownerDigest }) {
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
    redesign_handoff_options: [...REDESIGN_OPTIONS],
    redesign_selection: null,
    checkpointed_decision_contract_sha256:
      checkpointedDigest(legacyDecision),
    owner_checkpoint_evidence_sha256: ownerDigest,
  }
  return {
    ...stable,
    status: 'RIGHTS_NO_GO_ACCEPTED',
    decision_contract_sha256: sha256Json(stable),
    required_owner_attestation: 'receipt-derived owner bytes',
    owner_attestation: 'receipt-derived owner bytes',
    zero_residue_sha256: 'c'.repeat(64),
  }
}

test('raw checkpoint input is bounded by bytes and aborts before reading a tail', async () => {
  assert.equal(
    Number.isSafeInteger(ownerCheckpoint.MAX_OWNER_CHECKPOINT_BYTES),
    true,
  )
  assert.equal(ownerCheckpoint.MAX_OWNER_CHECKPOINT_BYTES, 1024)
  assert.equal(typeof ownerCheckpoint.readRawStdin, 'function')

  const exactLimit = Buffer.alloc(
    ownerCheckpoint.MAX_OWNER_CHECKPOINT_BYTES,
    0x61,
  )
  assert.deepEqual(
    await ownerCheckpoint.readRawStdin(Readable.from([exactLimit])),
    exactLimit,
  )

  const splitUtf8 = [
    Buffer.from([0xe2]),
    Buffer.from([0x82]),
    Buffer.from([0xac]),
  ]
  assert.deepEqual(
    await ownerCheckpoint.readRawStdin(Readable.from(splitUtf8)),
    Buffer.from('€', 'utf8'),
  )

  let pulls = 0
  async function* overlongChunks() {
    pulls += 1
    yield Buffer.alloc(ownerCheckpoint.MAX_OWNER_CHECKPOINT_BYTES)
    pulls += 1
    yield Buffer.from('x')
    pulls += 1
    yield Buffer.from('unread tail')
  }
  await assert.rejects(
    () => ownerCheckpoint.readRawStdin(overlongChunks()),
    /exceeds.*1024 bytes|too large/i,
  )
  assert.equal(pulls, 2)
})

test('overlong CLI input exits nonzero without creating a receipt', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'owner-checkpoint-limit-'))
  try {
    const recordPath = join(temporary, 'record.json')
    const result = await runCli([
      '--record-response',
      ...commonArgs(REQUEST_PATH),
      '--record',
      recordPath,
    ], {
      stdin: Buffer.alloc(
        ownerCheckpoint.MAX_OWNER_CHECKPOINT_BYTES + 1,
        0x61,
      ),
    })
    assert.notEqual(result.code, 0)
    assert.match(result.stderr.toString('utf8'), /exceeds.*1024 bytes|too large/i)
    await assert.rejects(() => access(recordPath))
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('one-time request is nonce- and evidence-bound with an exact self-hash', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'owner-checkpoint-request-'))
  try {
    const requestPath = join(temporary, 'request.json')
    const request = await createRequest(requestPath)
    const [baseline, matrix, qualityReport, decision] = await Promise.all([
      readJson(BASELINE_PATH),
      readJson(MATRIX_PATH),
      readJson(QUALITY_PATH),
      readJson(DECISION_PATH),
    ])
    assert.equal(request.status, 'AWAITING_OWNER_RESPONSE')
    assert.match(request.nonce, /^[0-9a-f]{64}$/)
    assert.equal(
      assertOwnerCheckpointRequest({
        request,
        baseline,
        matrix,
        qualityReport,
        checkpointedDecisionContractSha256:
          checkpointedDigest(decision),
      }),
      request,
    )
    const response = exactOwnerCheckpointResponse(request)
    assert.equal(
      Buffer.from(response, 'utf8').includes(Buffer.from(request.nonce)),
      true,
    )
    assert.match(response, /RIGHTS_NO_GO/)
    assert.match(response, /NOT_RUN_RIGHTS_NO_GO/)
    assert.match(response, /production outreach search remains disabled/)
    assert.doesNotMatch(response, /authorize|spike ran|provider-side deletion/i)

    const duplicate = await runCli([
      '--create-request',
      ...commonArgs(requestPath),
    ])
    assert.notEqual(duplicate.code, 0)
    assert.equal(
      (await readFile(requestPath, 'utf8')),
      `${JSON.stringify(request, null, 2)}\n`,
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('print mode derives the exact response without persisting owner input', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'owner-checkpoint-print-'))
  try {
    const requestPath = join(temporary, 'request.json')
    const request = await createRequest(requestPath)
    const result = await runCli([
      '--print-required-response',
      ...commonArgs(requestPath),
    ])
    assert.equal(result.code, 0, result.stderr.toString('utf8'))
    assert.deepEqual(
      result.stdout,
      Buffer.from(exactOwnerCheckpointResponse(request), 'utf8'),
    )
    await assert.rejects(() => access(join(temporary, 'record.json')))
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('record mode preserves only byte-exact raw stdin and cannot overwrite', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'owner-checkpoint-record-'))
  try {
    const requestPath = join(temporary, 'request.json')
    const recordPath = join(temporary, 'record.json')
    const request = await createRequest(requestPath)
    const responseBytes = Buffer.from(
      exactOwnerCheckpointResponse(request),
      'utf8',
    )
    const result = await runCli([
      '--record-response',
      ...commonArgs(requestPath),
      '--record',
      recordPath,
    ], { stdin: responseBytes })
    assert.equal(result.code, 0, result.stderr.toString('utf8'))
    assert.equal(result.stdout.length, 0)

    const [baseline, matrix, qualityReport, decision, record] =
      await Promise.all([
        readJson(BASELINE_PATH),
        readJson(MATRIX_PATH),
        readJson(QUALITY_PATH),
        readJson(DECISION_PATH),
        readJson(recordPath),
      ])
    assert.equal(
      assertOwnerCheckpointRecord({
        request,
        record,
        baseline,
        matrix,
        qualityReport,
        checkpointedDecisionContractSha256:
          checkpointedDigest(decision),
      }),
      record,
    )
    assert.deepEqual(
      assertOwnerCheckpointIntegrityRecord({
        request,
        record,
        baseline,
        matrix,
        qualityReport,
        checkpointedDecisionContractSha256:
          checkpointedDigest(decision),
      }),
      {
        status: 'INTEGRITY_ONLY_NOT_AUTHENTICATED',
        scope: 'integrity_only',
        authenticated: false,
        record,
      },
    )
    assert.deepEqual(
      Buffer.from(record.owner_response_utf8_base64, 'base64'),
      responseBytes,
    )

    const before = await readFile(recordPath)
    const overwrite = await runCli([
      '--record-response',
      ...commonArgs(requestPath),
      '--record',
      recordPath,
    ], { stdin: responseBytes })
    assert.notEqual(overwrite.code, 0)
    assert.deepEqual(await readFile(recordPath), before)

    const assertion = await runCli([
      '--assert-record',
      ...commonArgs(requestPath),
      '--record',
      recordPath,
    ])
    assert.equal(assertion.code, 0, assertion.stderr.toString('utf8'))
    assert.deepEqual(JSON.parse(assertion.stdout), {
      status: 'INTEGRITY_ONLY_NOT_AUTHENTICATED',
      scope: 'integrity_only',
      authenticated: false,
      historical_record_status: 'OWNER_RESPONSE_RECORDED',
      checkpoint_plan: '05-07',
      checkpoint_task:
        "Task 1: Preserve the owner's one-time raw-byte no-go reconfirmation",
      gate: 'blocking-human',
      owner_checkpoint_request_sha256:
        request.owner_checkpoint_request_sha256,
      owner_checkpoint_evidence_sha256:
        record.owner_checkpoint_evidence_sha256,
    })
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('every byte-level response drift fails without creating a receipt', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'owner-checkpoint-drift-'))
  try {
    const requestPath = join(temporary, 'request.json')
    const request = await createRequest(requestPath)
    const exact = Buffer.from(exactOwnerCheckpointResponse(request), 'utf8')
    const text = exact.toString('utf8')
    const variants = [
      Buffer.concat([exact, Buffer.from('\n')]),
      exact.subarray(0, exact.length - 1),
      Buffer.from(text.replace('RIGHTS_NO_GO', 'rights_no_go'), 'utf8'),
      Buffer.from(text.replace(';', ':'), 'utf8'),
      Buffer.from(text.replace('remains', 'rema\u0069ns\u0301'), 'utf8'),
      Buffer.from(text.replaceAll('; ', ';\r\n'), 'utf8'),
    ]
    for (const [index, bytes] of variants.entries()) {
      const recordPath = join(temporary, `record-${index}.json`)
      const result = await runCli([
        '--record-response',
        ...commonArgs(requestPath),
        '--record',
        recordPath,
      ], { stdin: bytes })
      assert.notEqual(result.code, 0)
      assert.match(result.stderr.toString('utf8'), /exact raw owner response bytes/)
      await assert.rejects(() => access(recordPath))
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('record validation survives accepted-v2 replacement with no legacy file', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'owner-checkpoint-v2-'))
  try {
    const requestPath = join(temporary, 'request.json')
    const recordPath = join(temporary, 'record.json')
    const decisionV2Path = join(temporary, '05-DECISION.json')
    const request = await createRequest(requestPath)
    const responseBytes = Buffer.from(
      exactOwnerCheckpointResponse(request),
      'utf8',
    )
    const recorded = await runCli([
      '--record-response',
      ...commonArgs(requestPath),
      '--record',
      recordPath,
    ], { stdin: responseBytes })
    assert.equal(recorded.code, 0, recorded.stderr.toString('utf8'))
    const [matrix, qualityReport, legacyDecision, record] =
      await Promise.all([
        readJson(MATRIX_PATH),
        readJson(QUALITY_PATH),
        readJson(DECISION_PATH),
        readJson(recordPath),
      ])
    const acceptedV2 = decisionV2({
      matrix,
      qualityReport,
      legacyDecision,
      ownerDigest: record.owner_checkpoint_evidence_sha256,
    })
    await writeFile(
      decisionV2Path,
      `${JSON.stringify(acceptedV2, null, 2)}\n`,
      'utf8',
    )
    const assertion = await runCli([
      '--assert-record',
      ...commonArgs(requestPath, decisionV2Path),
      '--record',
      recordPath,
    ])
    assert.equal(assertion.code, 0, assertion.stderr.toString('utf8'))

    const drifted = structuredClone(acceptedV2)
    drifted.checkpointed_decision_contract_sha256 = 'd'.repeat(64)
    const {
      status,
      decision_contract_sha256,
      required_owner_attestation,
      owner_attestation,
      zero_residue_sha256,
      ...stable
    } = drifted
    drifted.decision_contract_sha256 = sha256Json(stable)
    await writeFile(
      decisionV2Path,
      `${JSON.stringify(drifted, null, 2)}\n`,
      'utf8',
    )
    const rejected = await runCli([
      '--assert-record',
      ...commonArgs(requestPath, decisionV2Path),
      '--record',
      recordPath,
    ])
    assert.notEqual(rejected.code, 0)
    assert.match(rejected.stderr.toString('utf8'), /checkpointed decision/i)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('fully rehashed attacker-selected response bytes never authenticate', async () => {
  const [request, record, baseline, matrix, qualityReport, decision] =
    await Promise.all([
      readJson(REQUEST_PATH),
      readJson(RECEIPT_PATH),
      readJson(BASELINE_PATH),
      readJson(MATRIX_PATH),
      readJson(QUALITY_PATH),
      readJson(DECISION_PATH),
    ])
  const attackerResponse = Buffer.from(
    'attacker-selected historical response bytes',
    'utf8',
  )
  const forgedRequest = structuredClone(request)
  forgedRequest.required_response_sha256 = sha256Bytes(attackerResponse)
  {
    const {
      owner_checkpoint_request_sha256: ignored,
      ...body
    } = forgedRequest
    forgedRequest.owner_checkpoint_request_sha256 = sha256Json(body)
  }
  const forgedRecord = structuredClone(record)
  forgedRecord.owner_checkpoint_request_sha256 =
    forgedRequest.owner_checkpoint_request_sha256
  forgedRecord.owner_response_utf8_base64 =
    attackerResponse.toString('base64')
  forgedRecord.owner_response_sha256 = sha256Bytes(attackerResponse)
  {
    const {
      owner_checkpoint_evidence_sha256: ignored,
      ...body
    } = forgedRecord
    forgedRecord.owner_checkpoint_evidence_sha256 = sha256Json(body)
  }

  assert.equal(
    assertArtifactSchema(REQUEST_PATH, forgedRequest),
    forgedRequest,
  )
  assert.equal(
    assertArtifactSchema(RECEIPT_PATH, forgedRecord),
    forgedRecord,
  )
  assert.throws(
    () => assertOwnerCheckpointIntegrityRecord({
      request: forgedRequest,
      record: forgedRecord,
      baseline,
      matrix,
      qualityReport,
      checkpointedDecisionContractSha256:
        checkpointedDigest(decision),
    }),
    /required response digest drift/,
  )
})

test('request and receipt reject re-self-hashed evidence or checkpoint drift', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'owner-checkpoint-binding-'))
  try {
    const requestPath = join(temporary, 'request.json')
    const recordPath = join(temporary, 'record.json')
    const request = await createRequest(requestPath)
    const response = Buffer.from(exactOwnerCheckpointResponse(request), 'utf8')
    const recorded = await runCli([
      '--record-response',
      ...commonArgs(requestPath),
      '--record',
      recordPath,
    ], { stdin: response })
    assert.equal(recorded.code, 0, recorded.stderr.toString('utf8'))
    const [baseline, matrix, qualityReport, decision, record] =
      await Promise.all([
        readJson(BASELINE_PATH),
        readJson(MATRIX_PATH),
        readJson(QUALITY_PATH),
        readJson(DECISION_PATH),
        readJson(recordPath),
      ])

    const requestDrift = structuredClone(request)
    requestDrift.rights_evidence_sha256 = 'e'.repeat(64)
    {
      const {
        owner_checkpoint_request_sha256: ignored,
        ...body
      } = requestDrift
      requestDrift.owner_checkpoint_request_sha256 = sha256Json(body)
    }
    assert.throws(
      () => assertOwnerCheckpointRequest({
        request: requestDrift,
        baseline,
        matrix,
        qualityReport,
        checkpointedDecisionContractSha256:
          checkpointedDigest(decision),
      }),
      /rights evidence digest drift/,
    )

    const receiptDrift = structuredClone(record)
    receiptDrift.checkpoint_task = 'Task 1: agent-authored source label'
    {
      const {
        owner_checkpoint_evidence_sha256: ignored,
        ...body
      } = receiptDrift
      receiptDrift.owner_checkpoint_evidence_sha256 = sha256Json(body)
    }
    assert.throws(
      () => assertOwnerCheckpointRecord({
        request,
        record: receiptDrift,
        baseline,
        matrix,
        qualityReport,
        checkpointedDecisionContractSha256:
          checkpointedDigest(decision),
      }),
      /checkpoint (?:receipt )?task drift/,
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

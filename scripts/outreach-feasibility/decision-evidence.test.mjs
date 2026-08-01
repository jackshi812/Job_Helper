import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import * as decisionEvidence from './decision-evidence.mjs'
import {
  assertAuthenticatedDecisionRecord,
  assertDecisionRecord,
  decisionPayload,
  finalizeAcceptedEvidence,
} from './decision-evidence.mjs'
import {
  checkpointedDecisionPayloadFromAccepted,
} from './evidence-integrity.mjs'
import {
  buildZeroResidueRecord,
  readAcceptedEvidencePair,
} from './residue-check.mjs'
import { sha256Json } from './rights-gate.mjs'

const execFileAsync = promisify(execFile)
const PHASE_DIR = '.planning/phases/05-outreach-feasibility-gate'
const MATRIX_PATH = `${PHASE_DIR}/05-RIGHTS-MATRIX.json`
const QUALITY_PATH = `${PHASE_DIR}/05-QUALITY-REPORT.json`
const DECISION_PATH = `${PHASE_DIR}/05-DECISION.json`
const BASELINE_PATH = `${PHASE_DIR}/05-EXECUTION-BASELINE.json`
const REQUEST_PATH = `${PHASE_DIR}/05-OWNER-CHECKPOINT-REQUEST.json`
const RECEIPT_PATH = `${PHASE_DIR}/05-OWNER-CHECKPOINT.json`
const RECONCILIATION_PATH =
  `${PHASE_DIR}/05-CONTRACT-RECONCILIATION.json`
const ROADMAP_PATH = '.planning/ROADMAP.md'
const REQUIREMENTS_PATH = '.planning/REQUIREMENTS.md'
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
const SCRIPT_PATH = 'scripts/outreach-feasibility/decision-evidence.mjs'
const OWNER_SCRIPT_PATH = 'scripts/outreach-feasibility/owner-checkpoint.mjs'
const NOW = new Date('2026-07-29T12:00:00.000Z')
const AUTHORIZATION_NOW = new Date('2026-07-31T12:00:00.000Z')
const SOURCE_HEAD = 'a'.repeat(40)
const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)
const SHA_C = 'c'.repeat(64)
const SHA_D = 'd'.repeat(64)
const PUBLICATION_FAULT_POINTS = Object.freeze([
  'before_publish',
  'after_record_publish',
  'before_decision_publish',
  'after_decision_publish',
  'during_readback',
])
const matrix = JSON.parse(await readFile(MATRIX_PATH, 'utf8'))
const qualityReport = JSON.parse(await readFile(QUALITY_PATH, 'utf8'))
const baseline = JSON.parse(await readFile(BASELINE_PATH, 'utf8'))
const request = JSON.parse(await readFile(REQUEST_PATH, 'utf8'))
const ownerCheckpoint = JSON.parse(await readFile(RECEIPT_PATH, 'utf8'))
const reconciliation =
  JSON.parse(await readFile(RECONCILIATION_PATH, 'utf8'))
const legacyStable = {
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
  redesign_handoff_options: [
    'user-pasted LinkedIn URLs',
    'non-LinkedIn public professional profiles',
    'stopping outreach',
  ],
  redesign_selection: null,
}
const legacyOwnerText = Buffer.from(
  ownerCheckpoint.owner_response_utf8_base64,
  'base64',
).toString('utf8')
const legacyDecision = {
  ...legacyStable,
  status: 'RIGHTS_NO_GO_ACCEPTED',
  decision_contract_sha256: sha256Json(legacyStable),
  required_owner_attestation: legacyOwnerText,
  owner_attestation: legacyOwnerText,
  owner_attestation_source: 'owner_checkpoint_05-03',
  zero_residue_sha256: '0'.repeat(64),
}

function ownerText(record = ownerCheckpoint) {
  return Buffer.from(
    record.owner_response_utf8_base64,
    'base64',
  ).toString('utf8')
}

function scanFixture() {
  return {
    checked_at: '2026-07-29T12:00:00.000Z',
    scanned_roots: [
      'scripts/outreach-feasibility/',
      '.planning/phases/05-outreach-feasibility-gate/*.json',
    ],
    source_snapshot: {
      head_sha: SOURCE_HEAD,
      controlled_tree_sha256: SHA_A,
      baseline_to_source_history_sha256: SHA_B,
    },
    git_surfaces: {
      worktree: {
        status_entry_count: 0,
        status_paths: [],
        path_count: 18,
        blob_count: 18,
        inventory_sha256: SHA_C,
      },
      index: {
        staged_path_count: 0,
        staged_paths: [],
        path_count: 18,
        blob_count: 18,
        inventory_sha256: SHA_D,
      },
      phase_commit_range: {
        base_sha: baseline.base_sha,
        head_sha: SOURCE_HEAD,
        commit_count: 20,
        path_count: 120,
        blob_count: 60,
        inventory_sha256: SHA_B,
      },
      source_head_tree: {
        head_sha: SOURCE_HEAD,
        path_count: 18,
        blob_count: 18,
        tree_sha256: SHA_A,
      },
    },
    administrative_tail_policy: {
      from_source_head_sha: SOURCE_HEAD,
      allowed_paths: [],
      allowed_state_transitions: [
        'decision_v1_to_v2_to_v3_once',
        'zero_residue_v1_to_v2_to_v3_to_v4_once',
        'contract_reconciliation_absent_to_v1_to_v2_once',
        'plan_summary_contiguous_once',
        'review_pre_gap_to_final_once',
        'verification_source_gaps_found_or_absent_to_passed_once',
        'roadmap_phase_05_bookkeeping_only',
        'requirements_outr_04_outr_05_bookkeeping_only',
        'state_phase_05_bookkeeping_only',
      ],
      source_changes_allowed: false,
    },
    administrative_tail: {
      from_source_head_sha: SOURCE_HEAD,
      head_sha: SOURCE_HEAD,
      commit_count: 0,
      path_count: 0,
      blob_count: 0,
      inventory_sha256: SHA_D,
      transitions: [],
      verification_lineage: 'absent_pending',
    },
    forbidden_hit_count: 0,
    unexpected_survivor_count: 0,
    symlink_count: 0,
  }
}

function acceptedFixture() {
  const stable = decisionPayload({
    matrix,
    qualityReport,
    checkpointedDecisionContractSha256:
      legacyDecision.decision_contract_sha256,
    ownerCheckpointEvidenceSha256:
      ownerCheckpoint.owner_checkpoint_evidence_sha256,
  })
  const decision = {
    ...stable,
    status: 'RIGHTS_NO_GO_ACCEPTED',
    decision_contract_sha256: sha256Json(stable),
    required_owner_attestation: ownerText(),
    owner_attestation: ownerText(),
    zero_residue_sha256: '0'.repeat(64),
  }
  const residue = buildZeroResidueRecord({
    matrix,
    qualityReport,
    decisionContract: decision,
    ownerCheckpoint,
    baseline,
    scan: scanFixture(),
  })
  decision.zero_residue_sha256 = residue.zero_residue_sha256
  return { decision, residue }
}

function assertAccepted({
  decision,
  residue,
  requestRecord = request,
  receiptRecord = ownerCheckpoint,
  baselineRecord = baseline,
}) {
  return assertDecisionRecord({
    matrix,
    qualityReport,
    decision,
    residue,
    request: requestRecord,
    ownerCheckpoint: receiptRecord,
    baseline: baselineRecord,
    requireAccepted: false,
    now: NOW,
  })
}

function rehashDecision(decision) {
  const {
    status,
    decision_contract_sha256: ignored,
    required_owner_attestation,
    owner_attestation,
    zero_residue_sha256,
    ...stable
  } = decision
  decision.decision_contract_sha256 = sha256Json(stable)
  return decision
}

function rehashResidue(record) {
  const { zero_residue_sha256: ignored, ...body } = record
  record.zero_residue_sha256 = sha256Json(body)
  return record
}

function bindResidue(decision, record) {
  rehashResidue(record)
  decision.zero_residue_sha256 = record.zero_residue_sha256
}

function rehashRequest(record) {
  const { owner_checkpoint_request_sha256: ignored, ...body } = record
  record.owner_checkpoint_request_sha256 = sha256Json(body)
}

function rehashReceipt(record) {
  const { owner_checkpoint_evidence_sha256: ignored, ...body } = record
  record.owner_checkpoint_evidence_sha256 = sha256Json(body)
}

function cliEnvironment() {
  const environment = { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
  delete environment.TAVILY_API_KEY
  return environment
}

async function committedJsonArtifact(root, commit, path) {
  const [blobResult, bytesResult] = await Promise.all([
    execFileAsync('git', ['rev-parse', `${commit}:${path}`], {
      cwd: root,
      env: cliEnvironment(),
    }),
    execFileAsync('git', ['show', `${commit}:${path}`], {
      cwd: root,
      encoding: 'buffer',
      env: cliEnvironment(),
    }),
  ])
  return {
    blob: blobResult.stdout.trim(),
    bytes: bytesResult.stdout,
    value: JSON.parse(bytesResult.stdout.toString('utf8')),
  }
}

function authorizationPaths() {
  return {
    ownerAuthorizationRequestPath: AUTHORIZATION_REQUEST_PATH,
    ownerAuthorizationSignaturePath: AUTHORIZATION_SIGNATURE_PATH,
    ownerTrustAnchorPath: TRUST_ANCHOR_PATH,
    ownerPublicKeyPath: PUBLIC_KEY_PATH,
    ownerAllowedSignersPath: ALLOWED_SIGNERS_PATH,
  }
}

async function installAuthorizationPaths(repository) {
  await mkdir(
    join(repository, 'scripts/outreach-feasibility/trust'),
    { recursive: true },
  )
  for (const relativePath of [
    AUTHORIZATION_REQUEST_PATH,
    AUTHORIZATION_SIGNATURE_PATH,
    TRUST_ANCHOR_PATH,
    PUBLIC_KEY_PATH,
    ALLOWED_SIGNERS_PATH,
  ]) {
    await copyFile(
      resolve(relativePath),
      join(repository, relativePath),
    )
  }
  return {
    ownerAuthorizationRequestPath:
      join(repository, AUTHORIZATION_REQUEST_PATH),
    ownerAuthorizationSignaturePath:
      join(repository, AUTHORIZATION_SIGNATURE_PATH),
    ownerTrustAnchorPath: join(repository, TRUST_ANCHOR_PATH),
    ownerPublicKeyPath: join(repository, PUBLIC_KEY_PATH),
    ownerAllowedSignersPath:
      join(repository, ALLOWED_SIGNERS_PATH),
  }
}

async function readMode(path) {
  return (await stat(path)).mode & 0o777
}

async function directoryByteModeSnapshot(directory) {
  const snapshot = []
  for (const name of (await readdir(directory)).sort()) {
    const path = join(directory, name)
    snapshot.push({
      name,
      mode: await readMode(path),
      bytes: await readFile(path),
    })
  }
  return snapshot
}

async function assertOnlyPairFiles(directory, decisionPath, recordPath) {
  assert.deepEqual(
    (await readdir(directory)).sort(),
    [decisionPath, recordPath].map((path) => path.split('/').at(-1)).sort(),
  )
}

function publicationPair(generation) {
  const digest = generation === 'old' ? SHA_A : SHA_C
  const residueDigest = generation === 'old' ? SHA_B : SHA_D
  return {
    decision: {
      generation,
      decision_contract_sha256: digest,
      zero_residue_sha256: residueDigest,
    },
    record: {
      generation,
      decision_contract_sha256: digest,
      zero_residue_sha256: residueDigest,
    },
  }
}

async function installPublicationPair(directory, pair, {
  decisionMode = 0o640,
  recordMode = 0o604,
} = {}) {
  const decisionPath = join(directory, '05-DECISION.json')
  const recordPath = join(directory, '05-ZERO-RESIDUE.json')
  await writeFile(
    decisionPath,
    `${JSON.stringify(pair.decision, null, 2)}\n`,
    { mode: decisionMode },
  )
  await writeFile(
    recordPath,
    `${JSON.stringify(pair.record, null, 2)}\n`,
    { mode: recordMode },
  )
  return { decisionPath, recordPath }
}

async function runPublicationSubprocess({
  decisionPath,
  recordPath,
  pair,
  boundary = null,
  holdBoundary = null,
  holdMilliseconds = 0,
}) {
  const moduleUrl = new URL(
    './decision-evidence.mjs',
    import.meta.url,
  ).href
  const source = `
    const input = JSON.parse(process.argv[1])
    const implementation = await import(process.argv[2])
    await implementation.writeAtomicPair({
      decision: input.pair.decision,
      record: input.pair.record,
      decisionPath: input.decisionPath,
      recordPath: input.recordPath,
      async injectFault(point) {
        if (point === input.boundary) process.kill(process.pid, 'SIGKILL')
        if (point === input.holdBoundary) {
          await new Promise((resolve) =>
            setTimeout(resolve, input.holdMilliseconds))
        }
      },
    })
  `
  return execFileAsync(process.execPath, [
    '--input-type=module',
    '--eval',
    source,
    JSON.stringify({
      decisionPath,
      recordPath,
      pair,
      boundary,
      holdBoundary,
      holdMilliseconds,
    }),
    moduleUrl,
  ], {
    cwd: resolve('.'),
    env: cliEnvironment(),
  })
}

function assertCoherentGeneration(pair) {
  assert.equal(pair.decision.generation, pair.record.generation)
  assert.equal(
    pair.decision.decision_contract_sha256,
    pair.record.decision_contract_sha256,
  )
  assert.equal(
    pair.decision.zero_residue_sha256,
    pair.record.zero_residue_sha256,
  )
  assert.match(pair.decision.generation, /^(old|new|writer-a|writer-b)$/)
}

function interruptedInvalidPair(pair) {
  return {
    decision: {
      ...structuredClone(pair.decision),
      interrupted_marker: 'must-recover-before-decision-parse',
    },
    record: {
      ...structuredClone(pair.record),
      interrupted_marker: 'must-recover-before-residue-parse',
    },
  }
}

async function assertNoAcceptedPairTransactionFiles(directory) {
  assert.equal(
    (await readdir(directory)).filter((name) =>
      name.startsWith('.05-accepted-evidence')
      || /^\.05-(?:DECISION|ZERO-RESIDUE)\.json\..*\.(?:stage|backup|restore)$/.test(name)
    ).length,
    0,
  )
}

async function publicProofSnapshot(root = resolve('.')) {
  const snapshot = {}
  for (const relativePath of [
    AUTHORIZATION_REQUEST_PATH,
    AUTHORIZATION_SIGNATURE_PATH,
    TRUST_ANCHOR_PATH,
    PUBLIC_KEY_PATH,
    ALLOWED_SIGNERS_PATH,
  ]) {
    const path = join(root, relativePath)
    const bytes = await readFile(path)
    snapshot[relativePath] = {
      sha256: createHash('sha256').update(bytes).digest('hex'),
      mode: await readMode(path),
    }
  }
  return snapshot
}

test('every durable publication boundary survives SIGKILL and restart recovery', async () => {
  assert.ok(
    Array.isArray(decisionEvidence.PAIR_PUBLICATION_BOUNDARIES),
    'PAIR_PUBLICATION_BOUNDARIES must be exported',
  )
  assert.ok(
    decisionEvidence.PAIR_PUBLICATION_BOUNDARIES.length >= 20,
    'the durable inventory must cover every fsync, rename, readback, and cleanup boundary',
  )
  assert.equal(
    new Set(decisionEvidence.PAIR_PUBLICATION_BOUNDARIES).size,
    decisionEvidence.PAIR_PUBLICATION_BOUNDARIES.length,
    'durable boundary names must be unique',
  )

  for (const boundary of decisionEvidence.PAIR_PUBLICATION_BOUNDARIES) {
    await test(boundary, { timeout: 15_000 }, async () => {
      const temporary = await mkdtemp(
        join(tmpdir(), 'decision-pair-sigkill-'),
      )
      try {
        const oldPair = publicationPair('old')
        const newPair = publicationPair('new')
        const { decisionPath, recordPath } =
          await installPublicationPair(temporary, oldPair)
        await assert.rejects(
          runPublicationSubprocess({
            decisionPath,
            recordPath,
            pair: newPair,
            boundary,
          }),
          (error) => error?.signal === 'SIGKILL',
        )

        const recovered = await readAcceptedEvidencePair({
          decisionPath,
          recordPath,
          lockTimeoutMs: 2_000,
        })
        assertCoherentGeneration(recovered)
        await assertOnlyPairFiles(temporary, decisionPath, recordPath)
      } finally {
        await rm(temporary, { recursive: true, force: true })
      }
    })
  }
})

test('concurrent writers serialize and readers observe only complete generations', async () => {
  const temporary = await mkdtemp(
    join(tmpdir(), 'decision-pair-concurrent-'),
  )
  try {
    const oldPair = publicationPair('old')
    const pairA = publicationPair('writer-a')
    const pairB = publicationPair('writer-b')
    pairA.decision.decision_contract_sha256 = SHA_A
    pairA.record.decision_contract_sha256 = SHA_A
    pairA.decision.zero_residue_sha256 = SHA_C
    pairA.record.zero_residue_sha256 = SHA_C
    pairB.decision.decision_contract_sha256 = SHA_B
    pairB.record.decision_contract_sha256 = SHA_B
    pairB.decision.zero_residue_sha256 = SHA_D
    pairB.record.zero_residue_sha256 = SHA_D
    const { decisionPath, recordPath } =
      await installPublicationPair(temporary, oldPair)

    const writerA = runPublicationSubprocess({
      decisionPath,
      recordPath,
      pair: pairA,
      holdBoundary: 'journal_prepared_directory_fsync',
      holdMilliseconds: 200,
    })
    await new Promise((resolve) => setTimeout(resolve, 40))
    const duringA = readAcceptedEvidencePair({
      decisionPath,
      recordPath,
      lockTimeoutMs: 2_000,
    })
    const writerB = runPublicationSubprocess({
      decisionPath,
      recordPath,
      pair: pairB,
    })
    const duringB = readAcceptedEvidencePair({
      decisionPath,
      recordPath,
      lockTimeoutMs: 2_000,
    })
    const [, observedA, , observedB] = await Promise.all([
      writerA,
      duringA,
      writerB,
      duringB,
    ])
    assertCoherentGeneration(observedA)
    assertCoherentGeneration(observedB)
    assertCoherentGeneration(await readAcceptedEvidencePair({
      decisionPath,
      recordPath,
      lockTimeoutMs: 2_000,
    }))
    await assertOnlyPairFiles(temporary, decisionPath, recordPath)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('accepted-pair consumer inventory is finite and assigns terminal integration to Plan 05-23', () => {
  assert.deepEqual(
    decisionEvidence.ACCEPTED_PAIR_CONSUMERS,
    [
      'writeAtomicPair',
      'finalizeAcceptedEvidence',
      'decision-cli:assert-decision',
      'decision-cli:finalize-accepted',
      'residue-cli:assert-zero',
      'terminal:runContractValidation@05-23',
      'terminal:runTerminalAudit@05-23',
    ],
  )
})

test('real assert-decision CLI recovers an interrupted pair before either canonical parse', async () => {
  const temporary = await mkdtemp(
    join(tmpdir(), 'decision-cli-recovery-'),
  )
  try {
    const fixture = acceptedFixture()
    const pair = {
      decision: fixture.decision,
      record: fixture.residue,
    }
    const { decisionPath, recordPath } =
      await installPublicationPair(temporary, pair)
    await assert.rejects(
      runPublicationSubprocess({
        decisionPath,
        recordPath,
        pair: interruptedInvalidPair(pair),
        boundary: 'record_canonical_directory_fsync',
      }),
      (error) => error?.signal === 'SIGKILL',
    )
    const result = await execFileAsync(process.execPath, [
      SCRIPT_PATH,
      '--assert-decision',
      '--matrix', MATRIX_PATH,
      '--quality-report', QUALITY_PATH,
      '--decision', decisionPath,
      '--request', REQUEST_PATH,
      '--owner-checkpoint', RECEIPT_PATH,
      '--baseline-record', BASELINE_PATH,
      '--record', recordPath,
    ], { cwd: resolve('.'), env: cliEnvironment() })
    assert.equal(result.stderr, '')
    assert.equal(
      JSON.parse(result.stdout).status,
      'RIGHTS_NO_GO_ACCEPTED',
    )
    assert.deepEqual(
      JSON.parse(await readFile(decisionPath, 'utf8')),
      pair.decision,
    )
    assert.deepEqual(
      JSON.parse(await readFile(recordPath, 'utf8')),
      pair.record,
    )
    await assertOnlyPairFiles(temporary, decisionPath, recordPath)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('real finalize-accepted CLI authenticates, recovers, then scans and publishes', async () => {
  const temporary = await mkdtemp(
    join(tmpdir(), 'decision-finalize-cli-recovery-'),
  )
  try {
    const requestedRepository = join(temporary, 'repository')
    await execFileAsync('git', [
      'clone',
      '--quiet',
      '--shared',
      resolve('.'),
      requestedRepository,
    ], { env: cliEnvironment() })
    const repository = await realpath(requestedRepository)
    const liveResidue = JSON.parse(
      await readFile(resolve(`${PHASE_DIR}/05-ZERO-RESIDUE.json`), 'utf8'),
    )
    const liveHead = (
      await execFileAsync('git', ['rev-parse', 'HEAD'], {
        cwd: resolve('.'),
        env: cliEnvironment(),
      })
    ).stdout.trim()
    const lineageCommit = liveResidue.schema_version === 4
      ? liveResidue.source_snapshot.head_sha
      : liveHead
    const [
      lineageDecisionArtifact,
      lineageRecordArtifact,
      lineageReconciliationArtifact,
    ] = await Promise.all([
      committedJsonArtifact(resolve('.'), lineageCommit, DECISION_PATH),
      committedJsonArtifact(
        resolve('.'),
        lineageCommit,
        `${PHASE_DIR}/05-ZERO-RESIDUE.json`,
      ),
      committedJsonArtifact(
        resolve('.'),
        lineageCommit,
        RECONCILIATION_PATH,
      ),
    ])
    const lineagePair = {
      decision: lineageDecisionArtifact.value,
      record: lineageRecordArtifact.value,
    }
    const lineageReconciliation = lineageReconciliationArtifact.value
    assert.equal(lineagePair.decision.schema_version, 3)
    assert.equal(
      lineagePair.record.schema_version,
      liveResidue.schema_version,
    )
    assert.equal(lineageReconciliation.schema_version, 2)
    assert.equal(
      lineagePair.decision.zero_residue_sha256,
      lineagePair.record.zero_residue_sha256,
    )
    assert.equal(
      lineageReconciliation.decision_contract_sha256,
      lineagePair.decision.decision_contract_sha256,
    )
    assert.equal(
      lineageReconciliation.zero_residue_sha256,
      lineagePair.record.zero_residue_sha256,
    )
    const {
      contract_reconciliation_sha256: reconciliationSha256,
      ...reconciliationBody
    } = lineageReconciliation
    assert.equal(reconciliationSha256, sha256Json(reconciliationBody))
    await execFileAsync('git', [
      'checkout',
      '--quiet',
      '--detach',
      liveResidue.source_snapshot.head_sha,
    ], { cwd: repository, env: cliEnvironment() })
    await installAuthorizationPaths(repository)
    await writeFile(
      join(repository, RECONCILIATION_PATH),
      lineageReconciliationArtifact.bytes,
    )
    const installedFixturePaths = [
      RECONCILIATION_PATH,
      AUTHORIZATION_REQUEST_PATH,
      AUTHORIZATION_SIGNATURE_PATH,
      TRUST_ANCHOR_PATH,
      PUBLIC_KEY_PATH,
      ALLOWED_SIGNERS_PATH,
    ]
    await execFileAsync('git', [
      'config',
      'user.name',
      'Decision Evidence Test',
    ], { cwd: repository, env: cliEnvironment() })
    await execFileAsync('git', [
      'config',
      'user.email',
      'decision-evidence@example.invalid',
    ], { cwd: repository, env: cliEnvironment() })
    await execFileAsync('git', [
      'add',
      '--',
      ...installedFixturePaths,
    ], { cwd: repository, env: cliEnvironment() })
    const installedStatus = (
      await execFileAsync('git', [
        'status',
        '--porcelain=v1',
        '--untracked-files=all',
      ], { cwd: repository, env: cliEnvironment() })
    ).stdout.trim()
    const installedPaths = installedStatus.length === 0
      ? []
      : installedStatus.split('\n').map((line) => line.slice(3))
    assert.equal(
      installedPaths.every((path) => installedFixturePaths.includes(path)),
      true,
      `lineage fixture changed an unexpected path: ${installedStatus}`,
    )
    assert.equal(new Set(installedPaths).size, installedPaths.length)
    if (installedPaths.length > 0) {
      await execFileAsync('git', [
        'commit',
        '-qm',
        'install authenticated lineage fixture',
      ], { cwd: repository, env: cliEnvironment() })
    }
    assert.equal(
      (
        await execFileAsync('git', [
          'status',
          '--porcelain=v1',
          '--untracked-files=all',
        ], { cwd: repository, env: cliEnvironment() })
      ).stdout,
      '',
    )
    assert.deepEqual(
      await readFile(join(repository, RECONCILIATION_PATH)),
      lineageReconciliationArtifact.bytes,
    )
    assert.equal(
      (
        await execFileAsync('git', [
          'hash-object',
          '--',
          RECONCILIATION_PATH,
        ], { cwd: repository, env: cliEnvironment() })
      ).stdout.trim(),
      lineageReconciliationArtifact.blob,
    )
    const pair = {
      decision: lineagePair.decision,
      record: lineagePair.record,
    }
    const decisionPath = join(repository, DECISION_PATH)
    const recordPath =
      join(repository, `${PHASE_DIR}/05-ZERO-RESIDUE.json`)
    await installPublicationPair(
      join(repository, PHASE_DIR),
      pair,
    )
    await assert.rejects(
      runPublicationSubprocess({
        decisionPath,
        recordPath,
        pair: interruptedInvalidPair(pair),
        boundary: 'record_canonical_directory_fsync',
      }),
      (error) => error?.signal === 'SIGKILL',
    )
    const proofBefore = await publicProofSnapshot(repository)
    const finalizeArgs = [
      resolve(SCRIPT_PATH),
      '--finalize-accepted',
      '--matrix', join(repository, MATRIX_PATH),
      '--quality-report', join(repository, QUALITY_PATH),
      '--legacy-decision', decisionPath,
      '--decision', decisionPath,
      '--request', join(repository, REQUEST_PATH),
      '--owner-checkpoint', join(repository, RECEIPT_PATH),
      '--baseline-record', join(repository, BASELINE_PATH),
      '--phase-dir', PHASE_DIR,
      '--repo-root', repository,
      '--record', recordPath,
      '--reconciliation', join(repository, RECONCILIATION_PATH),
      '--owner-authorization-request', AUTHORIZATION_REQUEST_PATH,
      '--owner-authorization-signature', AUTHORIZATION_SIGNATURE_PATH,
      '--owner-trust-anchor', TRUST_ANCHOR_PATH,
      '--owner-public-key', PUBLIC_KEY_PATH,
      '--owner-allowed-signers', ALLOWED_SIGNERS_PATH,
    ]
    const result = await execFileAsync(process.execPath, finalizeArgs, {
      cwd: repository,
      env: cliEnvironment(),
    })
    assert.equal(result.stderr, '')
    assert.equal(
      JSON.parse(result.stdout).status,
      'RIGHTS_NO_GO_ACCEPTED',
    )
    assert.equal(
      JSON.parse(await readFile(decisionPath, 'utf8')).schema_version,
      3,
    )
    const rebound = await execFileAsync(process.execPath, finalizeArgs, {
      cwd: repository,
      env: cliEnvironment(),
    })
    assert.equal(rebound.stderr, '')
    assert.equal(
      JSON.parse(rebound.stdout).status,
      'RIGHTS_NO_GO_ACCEPTED',
    )
    assert.deepEqual(
      await publicProofSnapshot(repository),
      proofBefore,
    )
    await assertNoAcceptedPairTransactionFiles(
      join(repository, PHASE_DIR),
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('an active lock is bounded and never stolen', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'decision-pair-lock-'))
  try {
    const pair = publicationPair('old')
    const { decisionPath, recordPath } =
      await installPublicationPair(temporary, pair)
    const lockPath = join(temporary, '.05-accepted-evidence.lock')
    const lock = {
      schema_version: 1,
      pid: process.pid,
      transaction_id: '11111111-1111-4111-8111-111111111111',
      created_at: '2026-07-30T12:00:00.000Z',
    }
    await writeFile(lockPath, `${JSON.stringify(lock)}\n`, { mode: 0o600 })
    const started = Date.now()
    await assert.rejects(
      readAcceptedEvidencePair({
        decisionPath,
        recordPath,
        lockTimeoutMs: 80,
      }),
      /active|lock|timeout/i,
    )
    assert.ok(Date.now() - started < 1_000)
    assert.deepEqual(
      JSON.parse(await readFile(lockPath, 'utf8')),
      lock,
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('malformed journal and symlink-substituted transaction state fail closed', async () => {
  for (const substitutedName of [
    '.05-accepted-evidence.journal.json',
    '.05-accepted-evidence.lock',
  ]) {
    await test(substitutedName, async () => {
      const temporary = await mkdtemp(
        join(tmpdir(), 'decision-pair-substitution-'),
      )
      try {
        const pair = publicationPair('old')
        const { decisionPath, recordPath } =
          await installPublicationPair(temporary, pair)
        const target = join(temporary, 'substitution-target')
        await writeFile(target, 'do-not-follow\n')
        await symlink(target, join(temporary, substitutedName))
        await assert.rejects(
          readAcceptedEvidencePair({
            decisionPath,
            recordPath,
            lockTimeoutMs: 80,
          }),
          /symlink|regular|lock|journal/i,
        )
        assert.deepEqual(await readFile(target, 'utf8'), 'do-not-follow\n')
      } finally {
        await rm(temporary, { recursive: true, force: true })
      }
    })
  }

  const temporary = await mkdtemp(
    join(tmpdir(), 'decision-pair-malformed-'),
  )
  try {
    const pair = publicationPair('old')
    const { decisionPath, recordPath } =
      await installPublicationPair(temporary, pair)
    const journalPath =
      join(temporary, '.05-accepted-evidence.journal.json')
    const backupPath =
      join(temporary, '.05-DECISION.json.verified.backup')
    await writeFile(backupPath, 'verified-backup-copy\n', { mode: 0o600 })
    await writeFile(journalPath, '{"schema_version":1,"unknown":true}\n', {
      mode: 0o600,
    })
    await assert.rejects(
      readAcceptedEvidencePair({
        decisionPath,
        recordPath,
        lockTimeoutMs: 80,
      }),
      /journal|field|malformed/i,
    )
    assert.deepEqual(
      await readFile(backupPath, 'utf8'),
      'verified-backup-copy\n',
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('canonical, transient, and parent path substitution fails before publication', async () => {
  for (const substitutedName of [
    '05-DECISION.json',
    '05-ZERO-RESIDUE.json',
  ]) {
    await test(substitutedName, async () => {
      const temporary = await mkdtemp(
        join(tmpdir(), 'decision-pair-output-substitution-'),
      )
      try {
        const pair = publicationPair('old')
        const { decisionPath, recordPath } =
          await installPublicationPair(temporary, pair)
        const substitutedPath = join(temporary, substitutedName)
        const target = join(temporary, 'substitution-target')
        await writeFile(target, 'do-not-follow\n')
        await rm(substitutedPath)
        await symlink(target, substitutedPath)
        await assert.rejects(
          readAcceptedEvidencePair({
            decisionPath,
            recordPath,
            lockTimeoutMs: 80,
          }),
          /symlink|regular|artifact/i,
        )
        assert.equal(await readFile(target, 'utf8'), 'do-not-follow\n')
      } finally {
        await rm(temporary, { recursive: true, force: true })
      }
    })
  }

  for (const substitutedKind of [
    'decision_stage_basename',
    'record_stage_basename',
    'decision_backup_basename',
    'record_backup_basename',
    'decision_restore_basename',
    'record_restore_basename',
    'journal_prepared_basename',
    'journal_record_published_basename',
    'journal_committed_basename',
  ]) {
    await test(substitutedKind, async () => {
      const temporary = await mkdtemp(
        join(tmpdir(), 'decision-pair-transient-substitution-'),
      )
      try {
        const oldPair = publicationPair('old')
        const newPair = publicationPair('new')
        const { decisionPath, recordPath } =
          await installPublicationPair(temporary, oldPair)
        await assert.rejects(
          runPublicationSubprocess({
            decisionPath,
            recordPath,
            pair: newPair,
            boundary: 'journal_prepared_directory_fsync',
          }),
          (error) => error?.signal === 'SIGKILL',
        )
        const journal = JSON.parse(await readFile(
          join(temporary, '.05-accepted-evidence.journal.json'),
          'utf8',
        ))
        const derivedBasenames = {
          decision_restore_basename:
            `.05-DECISION.json.${journal.transaction_id}.restore`,
          record_restore_basename:
            `.05-ZERO-RESIDUE.json.${journal.transaction_id}.restore`,
          journal_prepared_basename:
            `.05-accepted-evidence.journal.json.${journal.transaction_id}.prepared.stage`,
          journal_record_published_basename:
            `.05-accepted-evidence.journal.json.${journal.transaction_id}.record-published.stage`,
          journal_committed_basename:
            `.05-accepted-evidence.journal.json.${journal.transaction_id}.committed.stage`,
        }
        const substitutedBasename =
          journal[substitutedKind] ?? derivedBasenames[substitutedKind]
        const substitutedPath = join(temporary, substitutedBasename)
        const target = join(temporary, 'substitution-target')
        await writeFile(target, 'do-not-follow\n')
        await rm(substitutedPath, { force: true })
        await symlink(target, substitutedPath)
        await assert.rejects(
          readAcceptedEvidencePair({
            decisionPath,
            recordPath,
            lockTimeoutMs: 2_000,
          }),
          /symlink|regular|transaction|stage|backup|restore|journal/i,
        )
        assert.deepEqual(
          JSON.parse(await readFile(decisionPath, 'utf8')),
          oldPair.decision,
        )
        assert.deepEqual(
          JSON.parse(await readFile(recordPath, 'utf8')),
          oldPair.record,
        )
        assert.equal(await readFile(target, 'utf8'), 'do-not-follow\n')
      } finally {
        await rm(temporary, { recursive: true, force: true })
      }
    })
  }

  const temporary = await mkdtemp(
    join(tmpdir(), 'decision-pair-parent-substitution-'),
  )
  try {
    const realDirectory = join(temporary, 'real')
    const substitutedDirectory = join(temporary, 'substituted')
    await mkdir(realDirectory)
    await installPublicationPair(realDirectory, publicationPair('old'))
    await symlink(realDirectory, substitutedDirectory)
    await assert.rejects(
      readAcceptedEvidencePair({
        decisionPath: join(substitutedDirectory, '05-DECISION.json'),
        recordPath: join(substitutedDirectory, '05-ZERO-RESIDUE.json'),
        lockTimeoutMs: 80,
      }),
      /parent directory substitution/i,
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('paired publication restores exact prior bytes and modes at every fault point', async () => {
  assert.equal(typeof decisionEvidence.writeAtomicPair, 'function')
  for (const faultPoint of PUBLICATION_FAULT_POINTS) {
    await test(faultPoint, async () => {
      const temporary = await mkdtemp(
        join(tmpdir(), 'decision-pair-rollback-'),
      )
      try {
        const decisionPath = join(temporary, '05-DECISION.json')
        const recordPath = join(temporary, '05-ZERO-RESIDUE.json')
        const priorDecision = Buffer.from(
          '{\n  "version": "prior-decision"\n}\n',
          'utf8',
        )
        const priorRecord = Buffer.from(
          '{ "version": "prior-residue" }\n',
          'utf8',
        )
        await writeFile(decisionPath, priorDecision)
        await writeFile(recordPath, priorRecord)
        await chmod(decisionPath, 0o640)
        await chmod(recordPath, 0o604)
        let injections = 0

        await assert.rejects(
          decisionEvidence.writeAtomicPair({
            decision: { version: 'new-decision' },
            record: { version: 'new-residue' },
            decisionPath,
            recordPath,
            injectFault(point) {
              if (point === faultPoint) {
                injections += 1
                throw new Error(`injected publication fault: ${point}`)
              }
            },
          }),
          new RegExp(`injected publication fault: ${faultPoint}`),
        )

        assert.equal(injections, 1)
        assert.deepEqual(await readFile(decisionPath), priorDecision)
        assert.deepEqual(await readFile(recordPath), priorRecord)
        assert.equal(await readMode(decisionPath), 0o640)
        assert.equal(await readMode(recordPath), 0o604)
        await assertOnlyPairFiles(temporary, decisionPath, recordPath)
      } finally {
        await rm(temporary, { recursive: true, force: true })
      }
    })
  }
})

test('paired publication rollback restores destination absence', async () => {
  assert.equal(typeof decisionEvidence.writeAtomicPair, 'function')
  const temporary = await mkdtemp(join(tmpdir(), 'decision-pair-absence-'))
  try {
    const decisionPath = join(temporary, '05-DECISION.json')
    const recordPath = join(temporary, '05-ZERO-RESIDUE.json')
    await assert.rejects(
      decisionEvidence.writeAtomicPair({
        decision: { version: 'new-decision' },
        record: { version: 'new-residue' },
        decisionPath,
        recordPath,
        injectFault(point) {
          if (point === 'after_decision_publish') {
            throw new Error('injected absence rollback')
          }
        },
      }),
      /injected absence rollback/,
    )
    assert.deepEqual(await readdir(temporary), [])
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('paired publication preserves incomplete or incoherent prior generations', async () => {
  for (const priorState of [
    'decision-only',
    'residue-only',
    'split-generation',
  ]) {
    await test(priorState, async () => {
      const temporary = await mkdtemp(
        join(tmpdir(), `decision-pair-${priorState}-`),
      )
      try {
        const decisionPath = join(temporary, '05-DECISION.json')
        const recordPath = join(temporary, '05-ZERO-RESIDUE.json')
        if (priorState !== 'residue-only') {
          await writeFile(
            decisionPath,
            `${JSON.stringify({
              generation: 'prior',
              decision_contract_sha256: SHA_A,
              zero_residue_sha256: SHA_B,
            })}\n`,
            { mode: 0o640 },
          )
        }
        if (priorState !== 'decision-only') {
          await writeFile(
            recordPath,
            `${JSON.stringify({
              generation: 'prior',
              decision_contract_sha256:
                priorState === 'split-generation' ? SHA_C : SHA_A,
              zero_residue_sha256: SHA_B,
            })}\n`,
            { mode: 0o604 },
          )
        }
        const beforeEntries = (await readdir(temporary)).sort()
        const before = new Map()
        for (const path of [decisionPath, recordPath]) {
          try {
            before.set(path, {
              bytes: await readFile(path),
              mode: await readMode(path),
            })
          } catch (error) {
            if (error?.code !== 'ENOENT') throw error
          }
        }

        await assert.rejects(
          decisionEvidence.writeAtomicPair({
            decision: publicationPair('new').decision,
            record: publicationPair('new').record,
            decisionPath,
            recordPath,
          }),
          priorState === 'split-generation'
            ? /decision binding is split/i
            : /existing accepted evidence pair is incomplete/i,
        )

        assert.deepEqual(
          (await readdir(temporary)).sort(),
          beforeEntries,
        )
        for (const path of [decisionPath, recordPath]) {
          if (!before.has(path)) {
            await assert.rejects(readFile(path), /ENOENT/)
            continue
          }
          assert.deepEqual(await readFile(path), before.get(path).bytes)
          assert.equal(await readMode(path), before.get(path).mode)
        }
      } finally {
        await rm(temporary, { recursive: true, force: true })
      }
    })
  }
})

test('successful paired publication leaves one coherent pair and no transaction residue', async () => {
  assert.equal(typeof decisionEvidence.writeAtomicPair, 'function')
  const temporary = await mkdtemp(join(tmpdir(), 'decision-pair-success-'))
  try {
    const decisionPath = join(temporary, '05-DECISION.json')
    const recordPath = join(temporary, '05-ZERO-RESIDUE.json')
    const decision = { version: 'new-decision', residue_sha256: SHA_A }
    const record = { version: 'new-residue', residue_sha256: SHA_A }
    await decisionEvidence.writeAtomicPair({
      decision,
      record,
      decisionPath,
      recordPath,
    })
    assert.deepEqual(
      JSON.parse(await readFile(decisionPath, 'utf8')),
      decision,
    )
    assert.deepEqual(
      JSON.parse(await readFile(recordPath, 'utf8')),
      record,
    )
    await assertOnlyPairFiles(temporary, decisionPath, recordPath)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('decisionPayload is the exact stable v2 no-go projection', () => {
  const payload = decisionPayload({
    matrix,
    qualityReport,
    checkpointedDecisionContractSha256:
      legacyDecision.decision_contract_sha256,
    ownerCheckpointEvidenceSha256:
      ownerCheckpoint.owner_checkpoint_evidence_sha256,
  })
  assert.equal(payload.schema_version, 2)
  assert.equal(payload.rights_status, 'RIGHTS_NO_GO')
  assert.equal(payload.quality_status, 'NOT_RUN_RIGHTS_NO_GO')
  assert.equal(payload.search_authorized, false)
  assert.equal(payload.production_outreach_enabled, false)
  assert.equal(payload.phase_6_authorized, false)
  assert.equal(payload.phase_7_authorized, false)
  assert.equal(payload.checkpointed_decision_contract_sha256,
    legacyDecision.decision_contract_sha256)
  assert.equal(payload.owner_checkpoint_evidence_sha256,
    ownerCheckpoint.owner_checkpoint_evidence_sha256)
  for (const excluded of [
    'status',
    'decision_contract_sha256',
    'required_owner_attestation',
    'owner_attestation',
    'owner_attestation_source',
    'zero_residue_sha256',
  ]) assert.equal(Object.hasOwn(payload, excluded), false)
})

test('complete request, receipt, baseline, and residue v2 admit the accepted no-go', () => {
  const { decision, residue } = acceptedFixture()
  assert.equal(assertAccepted({ decision, residue }), decision)
  assert.equal(decision.required_owner_attestation, ownerText())
  assert.equal(decision.owner_attestation, ownerText())
  assert.equal(Object.hasOwn(decision, 'owner_attestation_source'), false)
  assert.deepEqual(
    checkpointedDecisionPayloadFromAccepted({
      decision,
      matrix,
      qualityReport,
    }),
    {
      schema_version: 1,
      phase: legacyDecision.phase,
      rights_status: legacyDecision.rights_status,
      quality_status: legacyDecision.quality_status,
      search_authorized: legacyDecision.search_authorized,
      production_outreach_enabled:
        legacyDecision.production_outreach_enabled,
      outreach_milestone_status:
        legacyDecision.outreach_milestone_status,
      phase_6_authorized: legacyDecision.phase_6_authorized,
      phase_7_authorized: legacyDecision.phase_7_authorized,
      provider_call_count: legacyDecision.provider_call_count,
      fixture_count: legacyDecision.fixture_count,
      raw_result_count: legacyDecision.raw_result_count,
      production_mutation_count:
        legacyDecision.production_mutation_count,
      rights_evidence_sha256:
        legacyDecision.rights_evidence_sha256,
      quality_evidence_sha256:
        legacyDecision.quality_evidence_sha256,
      redesign_handoff_options:
        legacyDecision.redesign_handoff_options,
      redesign_selection: legacyDecision.redesign_selection,
    },
  )
})

test('accepted validation rejects every missing full evidence object and the legacy source label', () => {
  const { decision, residue } = acceptedFixture()
  for (const field of [
    'residue',
    'request',
    'ownerCheckpoint',
    'baseline',
  ]) {
    const input = {
      matrix,
      qualityReport,
      decision,
      residue,
      request,
      ownerCheckpoint,
      baseline,
      requireAccepted: true,
      now: NOW,
    }
    delete input[field]
    assert.throws(() => assertDecisionRecord(input))
  }
  assert.throws(
    () => assertDecisionRecord({
      matrix,
      qualityReport,
      decision: legacyDecision,
      requireAccepted: true,
      now: NOW,
    }),
    /v2|legacy|accepted/i,
  )
})

test('request and receipt exact schemas, bytes, bindings, and self-hashes fail closed', () => {
  const { decision, residue } = acceptedFixture()
  const cases = [
    () => {
      const drifted = structuredClone(request)
      delete drifted.gate
      return { requestRecord: drifted }
    },
    () => {
      const drifted = structuredClone(request)
      drifted.source = 'owner_checkpoint_05-03'
      return { requestRecord: drifted }
    },
    () => {
      const drifted = structuredClone(request)
      drifted.checkpointed_decision_contract_sha256 = SHA_C
      rehashRequest(drifted)
      return { requestRecord: drifted }
    },
    () => {
      const drifted = structuredClone(ownerCheckpoint)
      delete drifted.received_at
      return { receiptRecord: drifted }
    },
    () => {
      const drifted = structuredClone(ownerCheckpoint)
      drifted.source = 'summary'
      return { receiptRecord: drifted }
    },
    () => {
      const drifted = structuredClone(ownerCheckpoint)
      drifted.owner_response_utf8_base64 =
        Buffer.from(`${ownerText()} `, 'utf8').toString('base64')
      rehashReceipt(drifted)
      return { receiptRecord: drifted }
    },
    () => {
      const drifted = structuredClone(ownerCheckpoint)
      drifted.owner_checkpoint_evidence_sha256 = SHA_D
      return { receiptRecord: drifted }
    },
  ]
  for (const build of cases) {
    assert.throws(
      () => assertAccepted({ decision, residue, ...build() }),
      /checkpoint|receipt|request|response|field|digest/i,
    )
  }
})

test('every projected v1 no-go field and lineage digest remains immutable', () => {
  const projectionFields = [
    ['rights_status', 'PASS'],
    ['quality_status', 'PASS'],
    ['search_authorized', true],
    ['production_outreach_enabled', true],
    ['outreach_milestone_status', 'ACTIVE'],
    ['phase_6_authorized', true],
    ['phase_7_authorized', true],
    ['provider_call_count', 1],
    ['fixture_count', 1],
    ['raw_result_count', 1],
    ['production_mutation_count', 1],
    ['rights_evidence_sha256', SHA_C],
    ['quality_evidence_sha256', SHA_D],
    ['redesign_selection', 'stopping outreach'],
  ]
  for (const [field, value] of projectionFields) {
    const { decision, residue } = acceptedFixture()
    decision[field] = value
    rehashDecision(decision)
    assert.throws(
      () => assertAccepted({ decision, residue }),
      /decision|no-go|projection|digest|drift|zero/i,
      field,
    )
  }

  const { decision, residue } = acceptedFixture()
  decision.checkpointed_decision_contract_sha256 = SHA_C
  rehashDecision(decision)
  assert.throws(
    () => assertAccepted({ decision, residue }),
    /checkpointed decision/i,
  )
})

test('complete residue schema rejects omissions, extras, nonzero counters, and bound-surface drift', () => {
  const omissionPaths = [
    (record) => { delete record.source_snapshot },
    (record) => { delete record.git_surfaces.index.inventory_sha256 },
    (record) => { delete record.administrative_tail_policy },
    (record) => { delete record.baseline.plan_blob_sha256 },
    (record) => { delete record.checked_at },
  ]
  const driftCases = [
    (record) => { record.extra = true },
    (record) => { record.provider_call_count = 1 },
    (record) => { record.fixture_count = 1 },
    (record) => { record.raw_result_count = 1 },
    (record) => { record.production_mutation_count = 1 },
    (record) => { record.forbidden_hit_count = 1 },
    (record) => { record.unexpected_survivor_count = 1 },
    (record) => { record.symlink_count = 1 },
    (record) => { record.baseline_evidence_sha256 = SHA_C },
    (record) => { record.owner_checkpoint_evidence_sha256 = SHA_D },
    (record) => {
      record.source_snapshot.controlled_tree_sha256 = SHA_D
    },
    (record) => {
      record.administrative_tail_policy.from_source_head_sha =
        'f'.repeat(40)
    },
  ]
  for (const mutate of [...omissionPaths, ...driftCases]) {
    const { decision, residue } = acceptedFixture()
    mutate(residue)
    bindResidue(decision, residue)
    assert.throws(
      () => assertAccepted({ decision, residue }),
      /residue|missing|unknown|zero|digest|snapshot|baseline|tail/i,
    )
  }

  const { decision } = acceptedFixture()
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
    () => assertAccepted({ decision, residue: stub }),
    /missing/,
  )
})

test('owner and decision CLIs validate accepted v2 after the legacy file is gone', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'decision-v2-only-'))
  try {
    const { decision, residue } = acceptedFixture()
    const decisionPath = join(temporary, '05-DECISION.json')
    const residuePath = join(temporary, '05-ZERO-RESIDUE.json')
    await writeFile(decisionPath, `${JSON.stringify(decision, null, 2)}\n`)
    await writeFile(residuePath, `${JSON.stringify(residue, null, 2)}\n`)

    const ownerResult = await execFileAsync(process.execPath, [
      OWNER_SCRIPT_PATH,
      '--assert-record',
      '--request', REQUEST_PATH,
      '--record', RECEIPT_PATH,
      '--baseline', BASELINE_PATH,
      '--matrix', MATRIX_PATH,
      '--quality-report', QUALITY_PATH,
      '--decision', decisionPath,
    ], { cwd: resolve('.'), env: cliEnvironment() })
    assert.equal(ownerResult.stderr, '')

    const decisionResult = await execFileAsync(process.execPath, [
      SCRIPT_PATH,
      '--assert-decision',
      '--matrix', MATRIX_PATH,
      '--quality-report', QUALITY_PATH,
      '--decision', decisionPath,
      '--request', REQUEST_PATH,
      '--owner-checkpoint', RECEIPT_PATH,
      '--baseline-record', BASELINE_PATH,
      '--record', residuePath,
    ], { cwd: resolve('.'), env: cliEnvironment() })
    assert.equal(decisionResult.stderr, '')
    assert.equal(
      JSON.parse(decisionResult.stdout).status,
      'RIGHTS_NO_GO_ACCEPTED',
    )

    await assert.rejects(
      execFileAsync(process.execPath, [
        SCRIPT_PATH,
        '--assert-decision',
        '--require-accepted',
        '--matrix', MATRIX_PATH,
        '--quality-report', QUALITY_PATH,
        '--decision', decisionPath,
        '--request', REQUEST_PATH,
        '--owner-checkpoint', RECEIPT_PATH,
        '--baseline-record', BASELINE_PATH,
        '--record', residuePath,
      ], { cwd: resolve('.'), env: cliEnvironment() }),
      /owner-authorization-request is required/i,
    )

    await assert.rejects(
      execFileAsync(process.execPath, [
        SCRIPT_PATH,
        '--assert-decision',
        '--require-accepted',
        '--matrix', MATRIX_PATH,
        '--quality-report', QUALITY_PATH,
        '--decision', decisionPath,
        '--request', REQUEST_PATH,
        '--owner-checkpoint', RECEIPT_PATH,
        '--baseline-record', BASELINE_PATH,
        '--record', residuePath,
        '--owner-authorization-request', AUTHORIZATION_REQUEST_PATH,
        '--owner-authorization-signature', AUTHORIZATION_SIGNATURE_PATH,
        '--owner-trust-anchor', TRUST_ANCHOR_PATH,
        '--owner-public-key', PUBLIC_KEY_PATH,
        '--owner-allowed-signers', ALLOWED_SIGNERS_PATH,
        '--legacy-decision', DECISION_PATH,
      ], { cwd: resolve('.'), env: cliEnvironment() }),
      /legacy|argument/i,
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('finalizer derives receipt-bound decision and complete residue without changing legacy input', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'decision-finalizer-'))
  const SystemDate = globalThis.Date
  try {
    const repository = join(temporary, 'repository')
    await execFileAsync('git', [
      'clone',
      '--quiet',
      '--shared',
      resolve('.'),
      repository,
    ], { env: cliEnvironment() })
    const liveResidue = JSON.parse(
      await readFile(resolve(`${PHASE_DIR}/05-ZERO-RESIDUE.json`), 'utf8'),
    )
    if (liveResidue.schema_version >= 2) {
      await execFileAsync('git', [
        'checkout',
        '--quiet',
        '--detach',
        liveResidue.source_snapshot.head_sha,
      ], { cwd: repository, env: cliEnvironment() })
    }
    const decisionPath = join(temporary, '05-DECISION.json')
    const recordPath = join(temporary, '05-ZERO-RESIDUE.json')
    const repositoryAuthorizationPaths =
      await installAuthorizationPaths(repository)
    const before = structuredClone(legacyDecision)
    globalThis.Date = class ExpiredWallClock extends SystemDate {
      constructor(...args) {
        super(...(args.length > 0
          ? args
          : ['2030-01-01T00:00:00.000Z']))
      }

      static now() {
        return new SystemDate('2030-01-01T00:00:00.000Z').getTime()
      }
    }
    const finalized = await finalizeAcceptedEvidence({
      matrix,
      qualityReport,
      legacyDecision,
      reconciliation,
      request,
      ownerCheckpoint,
      baseline,
      repoRoot: repository,
      phaseDir: PHASE_DIR,
      decisionPath,
      recordPath,
      ...repositoryAuthorizationPaths,
      now: AUTHORIZATION_NOW,
    })
    assert.deepEqual(legacyDecision, before)
    assert.deepEqual(
      JSON.parse(await readFile(decisionPath, 'utf8')),
      finalized.decision,
    )
    assert.deepEqual(
      JSON.parse(await readFile(recordPath, 'utf8')),
      finalized.record,
    )
    assert.equal(finalized.decision.schema_version, 3)
    assert.equal(finalized.record.schema_version, 4)
    assert.equal(finalized.decision.representative_case_count, 0)
    assert.equal(finalized.record.representative_case_count, 0)
    assert.equal(
      await assertAuthenticatedDecisionRecord({
        matrix,
        qualityReport,
        decision: finalized.decision,
        residue: finalized.record,
        request,
        ownerCheckpoint,
        baseline,
        ...authorizationPaths(),
        now: AUTHORIZATION_NOW,
      }),
      finalized.decision,
    )
  } finally {
    globalThis.Date = SystemDate
    await rm(temporary, { recursive: true, force: true })
  }
})

test('authentication failure precedes Git resolution, scanning, construction, and pair publication', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'decision-auth-first-'))
  try {
    const decisionPath = join(temporary, '05-DECISION.json')
    const recordPath = join(temporary, '05-ZERO-RESIDUE.json')
    const signaturePath =
      join(temporary, '05-OWNER-AUTHORIZATION-REQUEST.json.sig')
    const priorDecision = Buffer.from('prior-decision-bytes\n')
    const priorRecord = Buffer.from('prior-residue-bytes\n')
    await Promise.all([
      writeFile(decisionPath, priorDecision, { mode: 0o640 }),
      writeFile(recordPath, priorRecord, { mode: 0o604 }),
      copyFile(AUTHORIZATION_SIGNATURE_PATH, signaturePath),
    ])
    const signature = await readFile(signaturePath)
    signature[signature.indexOf(Buffer.from('U1NI'))] = 0x56
    await writeFile(signaturePath, signature, { mode: 0o600 })

    await assert.rejects(
      () => finalizeAcceptedEvidence({
        matrix,
        qualityReport,
        legacyDecision,
        reconciliation,
        request,
        ownerCheckpoint,
        baseline,
        repoRoot: join(temporary, 'not-a-repository'),
        phaseDir: 'not-a-phase-directory',
        decisionPath,
        recordPath,
        ...authorizationPaths(),
        ownerAuthorizationSignaturePath: signaturePath,
        now: AUTHORIZATION_NOW,
      }),
      /SSHSIG|signature/i,
    )
    assert.deepEqual(await readFile(decisionPath), priorDecision)
    assert.deepEqual(await readFile(recordPath), priorRecord)
    assert.equal(await readMode(decisionPath), 0o640)
    assert.equal(await readMode(recordPath), 0o604)
    assert.deepEqual(
      (await readdir(temporary)).sort(),
      [
        decisionPath,
        recordPath,
        signaturePath,
      ].map((path) => path.split('/').at(-1)).sort(),
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('finalizer rejects reconciliation outside the signed semantic projection before publication', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'decision-semantic-drift-'))
  try {
    const decisionPath = join(temporary, '05-DECISION.json')
    const recordPath = join(temporary, '05-ZERO-RESIDUE.json')
    const priorDecision = Buffer.from('prior-decision-bytes\n')
    const priorRecord = Buffer.from('prior-residue-bytes\n')
    await Promise.all([
      writeFile(decisionPath, priorDecision, { mode: 0o640 }),
      writeFile(recordPath, priorRecord, { mode: 0o604 }),
    ])
    const drifted = structuredClone(reconciliation)
    drifted.roadmap_semantic_sha256 = 'f'.repeat(64)
    const {
      contract_reconciliation_sha256: ignored,
      ...body
    } = drifted
    drifted.contract_reconciliation_sha256 = sha256Json(body)

    await assert.rejects(
      () => finalizeAcceptedEvidence({
        matrix,
        qualityReport,
        legacyDecision,
        reconciliation: drifted,
        request,
        ownerCheckpoint,
        baseline,
        repoRoot: join(temporary, 'not-a-repository'),
        phaseDir: 'not-a-phase-directory',
        decisionPath,
        recordPath,
        ...authorizationPaths(),
        now: AUTHORIZATION_NOW,
      }),
      /signed roadmap semantic digest drift/i,
    )
    assert.deepEqual(await readFile(decisionPath), priorDecision)
    assert.deepEqual(await readFile(recordPath), priorRecord)
    assert.equal(await readMode(decisionPath), 0o640)
    assert.equal(await readMode(recordPath), 0o604)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('finalizer rejects live terminal semantic drift before pair recovery or mutation', async () => {
  const liveResidue = JSON.parse(
    await readFile(resolve(`${PHASE_DIR}/05-ZERO-RESIDUE.json`), 'utf8'),
  )
  const livePair = {
    decision: JSON.parse(
      await readFile(resolve(DECISION_PATH), 'utf8'),
    ),
    record: liveResidue,
  }
  const authorizationProbes = [
    'Phase 6 is allowed.',
    'Phase 6 is authorized, not prohibited.',
    'Production outreach has been switched on.',
  ]
  const driftCases = [
    ...authorizationProbes.map((probe, index) => ({
      label: `roadmap-${index + 1}`,
      relativePath: ROADMAP_PATH,
      mutate(text) {
        return text.replace(
          'Phase 5 terminal branch: the receipt-bound owner no-go',
          `${probe} Phase 5 terminal branch: the receipt-bound owner no-go`,
        )
      },
      error: /roadmap|authorization|canonical grammar/i,
    })),
    ...authorizationProbes.map((probe, index) => ({
      label: `requirements-${index + 1}`,
      relativePath: REQUIREMENTS_PATH,
      mutate(text) {
        return text.replace(
          '- [x] **OUTR-04**',
          `${probe}\n- [x] **OUTR-04**`,
        )
      },
      error: /requirements|authorization|canonical grammar/i,
    })),
  ]

  for (const driftCase of driftCases) {
    const temporary = await mkdtemp(
      join(tmpdir(), `decision-live-${driftCase.label}-drift-`),
    )
    try {
      const repository = join(temporary, 'repository')
      await execFileAsync('git', [
        'clone',
        '--quiet',
        '--shared',
        resolve('.'),
        repository,
      ], { env: cliEnvironment() })
      await execFileAsync('git', [
        'checkout',
        '--quiet',
        '--detach',
        liveResidue.source_snapshot.head_sha,
      ], { cwd: repository, env: cliEnvironment() })
      const repositoryAuthorizationPaths =
        await installAuthorizationPaths(repository)

      const pairDirectory = join(temporary, 'accepted-pair')
      await mkdir(pairDirectory)
      const { decisionPath, recordPath } =
        await installPublicationPair(pairDirectory, livePair)
      await assert.rejects(
        runPublicationSubprocess({
          decisionPath,
          recordPath,
          pair: interruptedInvalidPair(livePair),
          boundary: 'record_canonical_directory_fsync',
        }),
        (error) => error?.signal === 'SIGKILL',
      )
      const before = await directoryByteModeSnapshot(pairDirectory)
      assert.equal(
        before.some(({ name }) =>
          name.startsWith('.05-accepted-evidence')
        ),
        true,
      )

      const liveDocumentPath =
        join(repository, driftCase.relativePath)
      const originalDocument =
        await readFile(liveDocumentPath, 'utf8')
      const driftedDocument = driftCase.mutate(originalDocument)
      assert.notEqual(driftedDocument, originalDocument)
      await writeFile(liveDocumentPath, driftedDocument)

      await assert.rejects(
        () => finalizeAcceptedEvidence({
          matrix,
          qualityReport,
          legacyDecision,
          reconciliation,
          request,
          ownerCheckpoint,
          baseline,
          repoRoot: repository,
          phaseDir: PHASE_DIR,
          decisionPath,
          recordPath,
          ...repositoryAuthorizationPaths,
          now: AUTHORIZATION_NOW,
        }),
        driftCase.error,
      )
      assert.deepEqual(
        await directoryByteModeSnapshot(pairDirectory),
        before,
        `${driftCase.label} drift changed accepted-pair state`,
      )
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  }
})

test('accepted CLI requires the exact public authorization flags and rejects substitutes', async () => {
  const { decision, residue } = acceptedFixture()
  const temporary = await mkdtemp(join(tmpdir(), 'decision-auth-cli-'))
  try {
    const decisionPath = join(temporary, '05-DECISION.json')
    const recordPath = join(temporary, '05-ZERO-RESIDUE.json')
    await Promise.all([
      writeFile(decisionPath, `${JSON.stringify(decision, null, 2)}\n`),
      writeFile(recordPath, `${JSON.stringify(residue, null, 2)}\n`),
    ])
    const base = [
      SCRIPT_PATH,
      '--assert-decision',
      '--require-accepted',
      '--matrix', MATRIX_PATH,
      '--quality-report', QUALITY_PATH,
      '--decision', decisionPath,
      '--request', REQUEST_PATH,
      '--owner-checkpoint', RECEIPT_PATH,
      '--baseline-record', BASELINE_PATH,
      '--record', recordPath,
    ]
    const publicFlags = [
      '--owner-authorization-request', AUTHORIZATION_REQUEST_PATH,
      '--owner-authorization-signature', AUTHORIZATION_SIGNATURE_PATH,
      '--owner-trust-anchor', TRUST_ANCHOR_PATH,
      '--owner-public-key', PUBLIC_KEY_PATH,
      '--owner-allowed-signers', ALLOWED_SIGNERS_PATH,
    ]
    for (let index = 0; index < publicFlags.length; index += 2) {
      await assert.rejects(
        execFileAsync(process.execPath, [
          ...base,
          ...publicFlags.slice(0, index),
          ...publicFlags.slice(index + 2),
        ], { cwd: resolve('.'), env: cliEnvironment() }),
        /is required/i,
      )
    }
    await assert.rejects(
      execFileAsync(process.execPath, [
        ...base,
        ...publicFlags,
        '--owner-trust-anchor', TRUST_ANCHOR_PATH,
      ], { cwd: resolve('.'), env: cliEnvironment() }),
      /duplicate --owner-trust-anchor/i,
    )
    await assert.rejects(
      execFileAsync(process.execPath, [
        ...base,
        ...publicFlags,
        '--private-key', 'not-permitted',
      ], { cwd: resolve('.'), env: cliEnvironment() }),
      /unknown argument/i,
    )
    await assert.rejects(
      execFileAsync(process.execPath, [
        ...base,
        ...publicFlags.slice(0, 5),
        `${PHASE_DIR}/owner-trust-anchor.json`,
        ...publicFlags.slice(6),
      ], { cwd: resolve('.'), env: cliEnvironment() }),
      /canonical owner trust anchor/i,
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

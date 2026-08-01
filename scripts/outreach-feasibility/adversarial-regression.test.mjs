import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFile,
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
import {
  assertDecisionRecord,
  decisionPayload,
  finalizeAcceptedEvidence,
} from './decision-evidence.mjs'
import { assertZeroResidueRecord } from './evidence-integrity.mjs'
import {
  assertRecordMatchesLiveScan,
  buildZeroResidueRecord,
  resolveImmutableAuthenticatedV3Lineage,
  scanOwnedSurfaces,
} from './residue-check.mjs'
import { runConditionalSpike } from './dormant/spike-runner.mjs'
import {
  buildContractReconciliation,
  runContractValidation,
} from './terminal-audit.mjs'
import { canonicalJsonBytes } from './owner-authorization.mjs'
import { sha256Json } from './rights-gate.mjs'

const execFileAsync = promisify(execFile)
const REPO_ROOT = resolve('.')
const PHASE_DIR = '.planning/phases/05-outreach-feasibility-gate'
const MATRIX_PATH = `${PHASE_DIR}/05-RIGHTS-MATRIX.json`
const QUALITY_PATH = `${PHASE_DIR}/05-QUALITY-REPORT.json`
const LEGACY_DECISION_PATH = `${PHASE_DIR}/05-DECISION.json`
const BASELINE_PATH = `${PHASE_DIR}/05-EXECUTION-BASELINE.json`
const REQUEST_PATH = `${PHASE_DIR}/05-OWNER-CHECKPOINT-REQUEST.json`
const RECEIPT_PATH = `${PHASE_DIR}/05-OWNER-CHECKPOINT.json`
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
const RECONCILIATION_PATH =
  `${PHASE_DIR}/05-CONTRACT-RECONCILIATION.json`
const ROADMAP_PATH = '.planning/ROADMAP.md'
const REQUIREMENTS_PATH = '.planning/REQUIREMENTS.md'
const LEAK_TARGET = 'scripts/outreach-feasibility/rights-gate.mjs'
const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)
const SHA_C = 'c'.repeat(64)
const SHA_D = 'd'.repeat(64)
const AUTHORIZATION_NOW = new Date('2026-07-31T12:00:00.000Z')

async function readJson(root, path) {
  return JSON.parse(await readFile(join(root, path), 'utf8'))
}

function environment() {
  return {
    PATH: process.env.PATH ?? '',
    LANG: 'C',
    LC_ALL: 'C',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_OPTIONAL_LOCKS: '0',
  }
}

async function git(root, args) {
  return execFileAsync('git', args, {
    cwd: root,
    env: environment(),
    maxBuffer: 30_000_000,
  })
}

async function withClone(run) {
  const owner = await mkdtemp(join(tmpdir(), 'phase-05-held-out-'))
  const root = join(owner, 'repo')
  try {
    await git(owner, ['clone', '--quiet', '--shared', REPO_ROOT, root])
    await git(root, ['config', 'user.name', 'Held Out'])
    await git(root, ['config', 'user.email', 'held-out@example.invalid'])
    return await run(root)
  } finally {
    await rm(owner, { recursive: true, force: true })
  }
}

async function cloneFixture(source, owner, name) {
  const root = join(owner, name)
  await git(owner, ['clone', '--quiet', '--shared', source, root])
  await git(root, ['config', 'user.name', 'Held Out'])
  await git(root, ['config', 'user.email', 'held-out@example.invalid'])
  return root
}

async function scan(root, sourceHeadSha) {
  const head = sourceHeadSha
    ?? (await git(root, ['rev-parse', 'HEAD'])).stdout.trim()
  return scanOwnedSurfaces({
    repoRoot: root,
    phaseDir: PHASE_DIR,
    baseline: await readJson(root, BASELINE_PATH),
    sourceHeadSha: head,
  })
}

function publicProofPaths(root) {
  return {
    ownerAuthorizationRequestPath:
      join(root, AUTHORIZATION_REQUEST_PATH),
    ownerAuthorizationSignaturePath:
      join(root, AUTHORIZATION_SIGNATURE_PATH),
    ownerTrustAnchorPath: join(root, TRUST_ANCHOR_PATH),
    ownerPublicKeyPath: join(root, PUBLIC_KEY_PATH),
    ownerAllowedSignersPath: join(root, ALLOWED_SIGNERS_PATH),
  }
}

async function prepareAuthenticatedContract(root) {
  const [
    matrix,
    qualityReport,
    legacyDecision,
    request,
    ownerCheckpoint,
    baseline,
    existingResidue,
  ] = await Promise.all([
    readJson(root, MATRIX_PATH),
    readJson(root, QUALITY_PATH),
    readJson(root, LEGACY_DECISION_PATH),
    readJson(root, REQUEST_PATH),
    readJson(root, RECEIPT_PATH),
    readJson(root, BASELINE_PATH),
    readJson(root, `${PHASE_DIR}/05-ZERO-RESIDUE.json`),
  ])
  const finalized = legacyDecision.schema_version === 3
    ? await (async () => {
        const decision = structuredClone(legacyDecision)
        const liveScan = await scan(root)
        const record = buildZeroResidueRecord({
          matrix,
          qualityReport,
          decisionContract: decision,
          ownerCheckpoint,
          baseline,
          scan: liveScan,
        })
        decision.zero_residue_sha256 = record.zero_residue_sha256
        await Promise.all([
          writeFile(
            join(root, LEGACY_DECISION_PATH),
            `${JSON.stringify(decision, null, 2)}\n`,
          ),
          writeFile(
            join(root, `${PHASE_DIR}/05-ZERO-RESIDUE.json`),
            `${JSON.stringify(record, null, 2)}\n`,
          ),
        ])
        return { decision, record }
      })()
    : await finalizeAcceptedEvidence({
        matrix,
        qualityReport,
        legacyDecision,
        reconciliation:
          await readJson(root, RECONCILIATION_PATH),
        request,
        ownerCheckpoint,
        baseline,
        repoRoot: root,
        phaseDir: PHASE_DIR,
        decisionPath: join(root, LEGACY_DECISION_PATH),
        recordPath: join(root, `${PHASE_DIR}/05-ZERO-RESIDUE.json`),
        ...publicProofPaths(root),
        now: AUTHORIZATION_NOW,
      })
  const reconciliation = buildContractReconciliation({
    matrix,
    qualityReport,
    decision: finalized.decision,
    ownerCheckpoint,
    residue: finalized.record,
    roadmapText: await readFile(join(root, ROADMAP_PATH), 'utf8'),
    requirementsText:
      await readFile(join(root, REQUIREMENTS_PATH), 'utf8'),
  })
  await writeFile(
    join(root, RECONCILIATION_PATH),
    `${JSON.stringify(reconciliation, null, 2)}\n`,
  )
  return {
    ...finalized,
    reconciliation,
  }
}

async function installCurrentAuthenticatedSource(root) {
  const sourceHeadSha = (
    await git(REPO_ROOT, ['rev-parse', 'HEAD'])
  ).stdout.trim()
  const lineage = await resolveImmutableAuthenticatedV3Lineage({
    repoRoot: REPO_ROOT,
    sourceHeadSha,
    now: AUTHORIZATION_NOW,
  })
  await git(root, [
    'checkout',
    '--quiet',
    '--detach',
    lineage.commit_sha,
  ])
  await mkdir(
    join(root, 'scripts/outreach-feasibility/trust'),
    { recursive: true },
  )
  const paths = [
    'scripts/outreach-feasibility/authorization-evidence-validators.mjs',
    'scripts/outreach-feasibility/owner-authorization.mjs',
    'scripts/outreach-feasibility/evidence-integrity.mjs',
    'scripts/outreach-feasibility/residue-check.mjs',
    'scripts/outreach-feasibility/decision-evidence.mjs',
    'scripts/outreach-feasibility/terminal-audit.mjs',
    AUTHORIZATION_REQUEST_PATH,
    AUTHORIZATION_SIGNATURE_PATH,
    TRUST_ANCHOR_PATH,
    PUBLIC_KEY_PATH,
    ALLOWED_SIGNERS_PATH,
    ROADMAP_PATH,
    REQUIREMENTS_PATH,
  ]
  for (const path of paths) {
    await copyFile(join(REPO_ROOT, path), join(root, path))
  }
  await git(root, ['add', '--', ...paths])
  const installedStatus = (
    await git(root, [
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
    ])
  ).stdout.trim()
  const installedPaths = installedStatus.length === 0
    ? []
    : installedStatus.split('\n').map((line) => line.slice(3))
  assert.equal(
    installedPaths.every((path) => paths.includes(path)),
    true,
    `authenticated source fixture changed an unexpected path: ${installedStatus}`,
  )
  assert.equal(new Set(installedPaths).size, installedPaths.length)
  if (installedPaths.length > 0) {
    await git(root, [
      'commit',
      '-qm',
      'install authenticated source fixture',
    ])
  }
}

function rehashOwnerRequest(request) {
  const {
    owner_authorization_request_sha256: ignored,
    ...body
  } = request
  request.owner_authorization_request_sha256 = createHash('sha256')
    .update(canonicalJsonBytes(body))
    .digest('hex')
}

function rehashAuthenticatedPair(decision, residue) {
  const {
    status: ignoredStatus,
    decision_contract_sha256: ignoredDecisionDigest,
    zero_residue_sha256: ignoredDecisionResidue,
    ...stable
  } = decision
  decision.decision_contract_sha256 = sha256Json(stable)
  residue.decision_contract_sha256 = decision.decision_contract_sha256
  const { zero_residue_sha256: ignoredResidueDigest, ...body } = residue
  residue.zero_residue_sha256 = sha256Json(body)
  decision.zero_residue_sha256 = residue.zero_residue_sha256
}

async function repositorySnapshot(root, paths) {
  const [head, status, files] = await Promise.all([
    git(root, ['rev-parse', 'HEAD']),
    git(root, [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
    ]),
    Promise.all(paths.map(async (path) => {
      try {
        return await readFile(join(root, path))
      } catch {
        return null
      }
    })),
  ])
  return {
    head: head.stdout,
    status: status.stdout,
    files,
  }
}

function rehashMatrix(value) {
  for (const source of value.sources) {
    const { evidence_sha256: ignored, ...body } = source
    source.evidence_sha256 = sha256Json(body)
  }
  const { rights_evidence_sha256: ignored, ...body } = value
  value.rights_evidence_sha256 = sha256Json(body)
  return value
}

function allAllow(value) {
  for (const operation of value.operations) {
    operation.status = operation.required ? 'ALLOW' : 'NOT_APPLICABLE'
  }
  return rehashMatrix(value)
}

test('future research, future retrieval, and excessive horizons reach no effect', async () => {
  const matrix = JSON.parse(await readFile(MATRIX_PATH, 'utf8'))
  const cases = [
    (value) => {
      value.researched_at = '2099-01-01'
      value.valid_until = '2099-01-08'
      for (const source of value.sources) {
        source.retrieved_at = '2099-01-01T00:00:00Z'
      }
    },
    (value) => {
      value.sources[0].retrieved_at = '2099-01-01T00:00:00Z'
    },
    (value) => {
      value.valid_until = '2026-08-05'
    },
  ]
  for (const mutate of cases) {
    const candidate = allAllow(structuredClone(matrix))
    mutate(candidate)
    rehashMatrix(candidate)
    const effects = []
    const result = await runConditionalSpike({
      matrix: candidate,
      spikeAuthorization: {
        type: 'ACCEPT_RIGHTS',
        rights_evidence_sha256: candidate.rights_evidence_sha256,
      },
      now: new Date('2026-07-29T12:00:00.000Z'),
      readSecret: async () => effects.push('secret'),
      createCorpus: async () => effects.push('corpus'),
      buildRequest: async () => effects.push('request'),
      fetchImpl: async () => effects.push('fetch'),
    })
    assert.equal(result.status, 'RIGHTS_NO_GO')
    assert.deepEqual(effects, [])
  }
})

test('forged all-ALLOW authorization cannot cross the dormant effect boundary', async () => {
  const matrix = allAllow(
    JSON.parse(await readFile(MATRIX_PATH, 'utf8')),
  )
  const observedEffects = []
  const input = {
    matrix,
    spikeAuthorization: {
      type: 'ACCEPT_RIGHTS',
      rights_evidence_sha256: matrix.rights_evidence_sha256,
    },
    now: new Date('2026-07-29T12:00:00.000Z'),
  }
  for (const property of [
    'readSecret',
    'createCorpus',
    'buildRequest',
    'fetchImpl',
    'productionMutation',
  ]) {
    Object.defineProperty(input, property, {
      enumerable: true,
      get() {
        observedEffects.push(property)
        throw new Error(`${property} must not be read`)
      },
    })
  }

  const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value() {
      observedEffects.push('globalThis.fetch')
      throw new Error('global transport must not be called')
    },
  })

  try {
    assert.deepEqual(await runConditionalSpike(input), {
      status: 'RIGHTS_NO_GO',
      search_authorized: false,
      production_outreach_enabled: false,
      spike_executed: false,
      quality_status: 'NOT_RUN_RIGHTS_NO_GO',
      provider_call_count: 0,
      fixture_count: 0,
      raw_result_count: 0,
      production_mutation_count: 0,
    })
    assert.deepEqual(observedEffects, [])
  } finally {
    if (originalFetch) {
      Object.defineProperty(globalThis, 'fetch', originalFetch)
    } else {
      delete globalThis.fetch
    }
  }
})

test('an incomplete accepted residue can never cross the public schema boundary', () => {
  assert.throws(
    () => assertZeroResidueRecord({
      schema_version: 2,
      phase: '05',
      status: 'PASS',
      provider_call_count: 0,
      fixture_count: 0,
      raw_result_count: 0,
      production_mutation_count: 0,
    }, {
      rights_evidence_sha256: SHA_A,
      quality_evidence_sha256: SHA_B,
      decision_contract_sha256: SHA_C,
      owner_checkpoint_evidence_sha256: SHA_D,
      baseline_evidence_sha256: SHA_A,
    }),
    /missing/,
  )
})

test('allowlisted source leaks fail on worktree, index, and immutable history', async () => {
  const secret = ['tvly', 'held-out-regression-1234567890'].join('-')
  for (const surface of ['worktree', 'index', 'phase_commit_range']) {
    await withClone(async (root) => {
      const original = await readFile(join(root, LEAK_TARGET))
      await appendFile(join(root, LEAK_TARGET),
        `\nconst heldOutCredential = '${secret}'\n`)
      let sourceHeadSha
      if (surface === 'index') {
        await git(root, ['add', LEAK_TARGET])
        await writeFile(join(root, LEAK_TARGET), original)
      } else if (surface === 'phase_commit_range') {
        await git(root, ['add', LEAK_TARGET])
        await git(root, ['commit', '-qm', 'held-out leak'])
        await writeFile(join(root, LEAK_TARGET), original)
        await git(root, ['add', LEAK_TARGET])
        await git(root, ['commit', '-qm', 'held-out cleanup'])
        sourceHeadSha = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim()
      }
      await assert.rejects(
        scan(root, sourceHeadSha),
        (error) => {
          assert.match(error.message, new RegExp(`surface=${surface}`))
          assert.doesNotMatch(error.message, new RegExp(secret))
          return true
        },
      )
    })
  }
})

test('realistic provider-shaped JSON is rejected on an allowlisted evidence path', async () => {
  await withClone(async (root) => {
    const payload = {}
    payload[['res', 'ults'].join('')] = [{
      name: 'Synthetic Person',
      title: 'Synthetic Role',
      url: ['https://example.invalid', '/profile'].join(''),
      content: 'Synthetic provider body',
    }]
    await writeFile(
      join(root, MATRIX_PATH),
      `${JSON.stringify(payload, null, 2)}\n`,
    )
    await assert.rejects(
      scan(root),
      (error) => {
        assert.match(error.message, /schema|artifact/i)
        assert.doesNotMatch(error.message, /Synthetic Person|provider body/)
        return true
      },
    )
  })
})

test('baseline movement and control-character paths are rejected without disclosure', async () => {
  await withClone(async (root) => {
    const moved = await readJson(root, BASELINE_PATH)
    moved.base_sha = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim()
    const { baseline_evidence_sha256: ignored, ...body } = moved
    moved.baseline_evidence_sha256 = sha256Json(body)
    await assert.rejects(
      scanOwnedSurfaces({
        repoRoot: root,
        phaseDir: PHASE_DIR,
        baseline: moved,
        sourceHeadSha: moved.base_sha,
      }),
      /pinned baseline/i,
    )

    const hostile = 'unexpected-held-out\nforged.mjs'
    await writeFile(
      join(root, 'scripts/outreach-feasibility', hostile),
      'export const safe = true\n',
    )
    await assert.rejects(
      scan(root),
      (error) => {
        assert.equal(error.message.split('\n').length, 1)
        assert.doesNotMatch(error.message, /forged\.mjs/)
        return true
      },
    )
  })
})

test('a re-self-hashed stale record cannot match a different live source snapshot', async () => {
  const [
    matrix,
    qualityReport,
    legacyDecision,
    baseline,
    request,
    ownerCheckpoint,
  ] = await Promise.all([
    readJson(REPO_ROOT, MATRIX_PATH),
    readJson(REPO_ROOT, QUALITY_PATH),
    readJson(REPO_ROOT, LEGACY_DECISION_PATH),
    readJson(REPO_ROOT, BASELINE_PATH),
    readJson(REPO_ROOT, REQUEST_PATH),
    readJson(REPO_ROOT, RECEIPT_PATH),
  ])
  const stable = decisionPayload({
    matrix,
    qualityReport,
    checkpointedDecisionContractSha256:
      legacyDecision.schema_version >= 2
        ? legacyDecision.checkpointed_decision_contract_sha256
        : legacyDecision.decision_contract_sha256,
    ownerCheckpointEvidenceSha256:
      ownerCheckpoint.owner_checkpoint_evidence_sha256,
  })
  const response = Buffer.from(
    ownerCheckpoint.owner_response_utf8_base64,
    'base64',
  ).toString('utf8')
  const decision = {
    ...stable,
    status: 'RIGHTS_NO_GO_ACCEPTED',
    decision_contract_sha256: sha256Json(stable),
    required_owner_attestation: response,
    owner_attestation: response,
    zero_residue_sha256: '0'.repeat(64),
  }
  const liveScan = {
    checked_at: '2026-07-29T12:00:00.000Z',
    scanned_roots: [
      'scripts/outreach-feasibility/',
      '.planning/phases/05-outreach-feasibility-gate/*.json',
    ],
    source_snapshot: {
      head_sha: 'a'.repeat(40),
      controlled_tree_sha256: SHA_A,
      baseline_to_source_history_sha256: SHA_B,
    },
    git_surfaces: {
      worktree: {
        status_entry_count: 0,
        status_paths: [],
        path_count: 1,
        blob_count: 1,
        inventory_sha256: SHA_C,
      },
      index: {
        staged_path_count: 0,
        staged_paths: [],
        path_count: 1,
        blob_count: 1,
        inventory_sha256: SHA_D,
      },
      phase_commit_range: {
        base_sha: baseline.base_sha,
        head_sha: 'a'.repeat(40),
        commit_count: 1,
        path_count: 1,
        blob_count: 1,
        inventory_sha256: SHA_B,
      },
      source_head_tree: {
        head_sha: 'a'.repeat(40),
        path_count: 1,
        blob_count: 1,
        tree_sha256: SHA_A,
      },
    },
    administrative_tail_policy: {
      from_source_head_sha: 'a'.repeat(40),
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
      from_source_head_sha: 'a'.repeat(40),
      head_sha: 'a'.repeat(40),
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
  const record = buildZeroResidueRecord({
    matrix,
    qualityReport,
    decisionContract: decision,
    ownerCheckpoint,
    baseline,
    scan: liveScan,
  })
  decision.zero_residue_sha256 = record.zero_residue_sha256
  assert.equal(assertDecisionRecord({
    matrix,
    qualityReport,
    decision,
    residue: record,
    request,
    ownerCheckpoint,
    baseline,
    requireAccepted: false,
    now: new Date('2026-07-29T12:00:00.000Z'),
  }), decision)

  const differentLiveScan = structuredClone(liveScan)
  differentLiveScan.source_snapshot.head_sha = 'f'.repeat(40)
  differentLiveScan.git_surfaces.phase_commit_range.head_sha =
    'f'.repeat(40)
  differentLiveScan.git_surfaces.source_head_tree.head_sha =
    'f'.repeat(40)
  differentLiveScan.administrative_tail.from_source_head_sha =
    'f'.repeat(40)
  differentLiveScan.administrative_tail_policy.from_source_head_sha =
    'f'.repeat(40)
  assert.throws(
    () => assertRecordMatchesLiveScan(
      record,
      differentLiveScan,
      { decision, ownerCheckpoint },
    ),
    /source|history|live|snapshot/i,
  )
})

test('held-out terminal authentication attacks fail closed and preserve every repository byte', async () => {
  const owner = await mkdtemp(join(tmpdir(), 'phase-05-terminal-attacks-'))
  try {
    const base = await cloneFixture(REPO_ROOT, owner, 'base')
    await installCurrentAuthenticatedSource(base)
    await prepareAuthenticatedContract(base)
    await git(base, [
      'add',
      '--',
      LEGACY_DECISION_PATH,
      `${PHASE_DIR}/05-ZERO-RESIDUE.json`,
      RECONCILIATION_PATH,
    ])
    const authenticatedChanges = await git(base, [
      'status',
      '--porcelain=v1',
      '--',
      LEGACY_DECISION_PATH,
      `${PHASE_DIR}/05-ZERO-RESIDUE.json`,
      RECONCILIATION_PATH,
    ])
    if (authenticatedChanges.stdout.trim().length > 0) {
      await git(base, ['commit', '-qm', 'authenticated held-out base'])
    }
    assert.equal(
      (await runContractValidation({
        repoRoot: base,
        phaseDir: PHASE_DIR,
      })).status,
      'CONTRACT_VALIDATION_PASS',
    )

    const testKey = join(owner, 'held-out-wrong-key')
    await execFileAsync('/usr/bin/ssh-keygen', [
      '-q',
      '-t',
      'ed25519',
      '-N',
      '',
      '-f',
      testKey,
    ], { env: environment() })
    const signedCopy = join(owner, 'wrong-signature-request.json')
    await copyFile(
      join(base, AUTHORIZATION_REQUEST_PATH),
      signedCopy,
    )
    await execFileAsync('/usr/bin/ssh-keygen', [
      '-Y',
      'sign',
      '-f',
      testKey,
      '-n',
      'job-copilot-phase-05-owner-v1',
      signedCopy,
    ], { env: environment() })

    const attacks = [
      {
        name: 'wrong-key',
        mutate: (root) => copyFile(
          `${testKey}.pub`,
          join(root, PUBLIC_KEY_PATH),
        ),
      },
      {
        name: 'wrong-signature',
        mutate: (root) => copyFile(
          `${signedCopy}.sig`,
          join(root, AUTHORIZATION_SIGNATURE_PATH),
        ),
      },
      ...[
        ['principal', 'principal', 'attacker'],
        ['namespace', 'namespace', 'wrong-namespace'],
        ['nonce', 'nonce', 'ff'.repeat(32)],
        [
          'payload',
          'stopped_decision_payload_sha256',
          'f'.repeat(64),
        ],
      ].map(([name, key, value]) => ({
        name: `wrong-${name}`,
        async mutate(root) {
          const request = await readJson(
            root,
            AUTHORIZATION_REQUEST_PATH,
          )
          request[key] = value
          rehashOwnerRequest(request)
          await writeFile(
            join(root, AUTHORIZATION_REQUEST_PATH),
            canonicalJsonBytes(request),
          )
        },
      })),
      {
        name: 'any-request-byte',
        mutate: async (root) => {
          await appendFile(
            join(root, AUTHORIZATION_REQUEST_PATH),
            ' ',
          )
        },
      },
      {
        name: 'stale-request',
        mutate: async (root) => {
          const request = await readJson(
            root,
            AUTHORIZATION_REQUEST_PATH,
          )
          request.issued_at = '2026-07-20T00:00:00.000Z'
          request.expires_at = '2026-07-27T00:00:00.000Z'
          rehashOwnerRequest(request)
          await writeFile(
            join(root, AUTHORIZATION_REQUEST_PATH),
            canonicalJsonBytes(request),
          )
        },
      },
      {
        name: 'revoked-anchor',
        mutate: async (root) => {
          const anchor = await readJson(root, TRUST_ANCHOR_PATH)
          anchor.status = 'REVOKED'
          anchor.revoked_at = '2026-07-31T00:00:00.000Z'
          await writeFile(
            join(root, TRUST_ANCHOR_PATH),
            canonicalJsonBytes(anchor),
          )
        },
      },
      ...[
        ['missing-trust-anchor', TRUST_ANCHOR_PATH],
        ['missing-public-key', PUBLIC_KEY_PATH],
        ['missing-allowed-signers', ALLOWED_SIGNERS_PATH],
        ['missing-signature', AUTHORIZATION_SIGNATURE_PATH],
      ].map(([name, path]) => ({
        name,
        mutate: (root) => rm(join(root, path)),
      })),
      {
        name: 'legacy-receipt-substitution',
        mutate: async (root) => {
          const decision = await readJson(root, LEGACY_DECISION_PATH)
          const residue = await readJson(
            root,
            `${PHASE_DIR}/05-ZERO-RESIDUE.json`,
          )
          const reconciliation =
            await readJson(root, RECONCILIATION_PATH)
          const receipt = await readJson(root, RECEIPT_PATH)
          for (const key of [
            'owner_authorization_request_sha256',
            'owner_authorization_signature_sha256',
            'owner_authorization_nonce_sha256',
            'owner_authorization_stopped_decision_payload_sha256',
          ]) {
            decision[key] =
              receipt.owner_checkpoint_evidence_sha256
            residue[key] =
              receipt.owner_checkpoint_evidence_sha256
            reconciliation[key] =
              receipt.owner_checkpoint_evidence_sha256
          }
          rehashAuthenticatedPair(decision, residue)
          reconciliation.decision_contract_sha256 =
            decision.decision_contract_sha256
          reconciliation.zero_residue_sha256 =
            residue.zero_residue_sha256
          const {
            contract_reconciliation_sha256: ignored,
            ...body
          } = reconciliation
          reconciliation.contract_reconciliation_sha256 =
            sha256Json(body)
          await Promise.all([
            writeFile(
              join(root, LEGACY_DECISION_PATH),
              `${JSON.stringify(decision, null, 2)}\n`,
            ),
            writeFile(
              join(root, `${PHASE_DIR}/05-ZERO-RESIDUE.json`),
              `${JSON.stringify(residue, null, 2)}\n`,
            ),
            writeFile(
              join(root, RECONCILIATION_PATH),
              `${JSON.stringify(reconciliation, null, 2)}\n`,
            ),
          ])
        },
      },
      {
        name: 'post-verification-decision-mutation',
        mutate: async (root) => {
          const decision = await readJson(root, LEGACY_DECISION_PATH)
          const residue = await readJson(
            root,
            `${PHASE_DIR}/05-ZERO-RESIDUE.json`,
          )
          decision.owner_authorization_principal = 'attacker'
          residue.owner_authorization_principal = 'attacker'
          rehashAuthenticatedPair(decision, residue)
          await Promise.all([
            writeFile(
              join(root, LEGACY_DECISION_PATH),
              `${JSON.stringify(decision, null, 2)}\n`,
            ),
            writeFile(
              join(root, `${PHASE_DIR}/05-ZERO-RESIDUE.json`),
              `${JSON.stringify(residue, null, 2)}\n`,
            ),
          ])
        },
      },
    ]
    const protectedPaths = [
      LEGACY_DECISION_PATH,
      `${PHASE_DIR}/05-ZERO-RESIDUE.json`,
      RECONCILIATION_PATH,
      AUTHORIZATION_REQUEST_PATH,
      AUTHORIZATION_SIGNATURE_PATH,
      TRUST_ANCHOR_PATH,
      PUBLIC_KEY_PATH,
      ALLOWED_SIGNERS_PATH,
    ]

    for (const attack of attacks) {
      const variant = await cloneFixture(
        base,
        owner,
        attack.name,
      )
      await attack.mutate(variant)
      const before = await repositorySnapshot(variant, protectedPaths)
      await assert.rejects(
        () => runContractValidation({
          repoRoot: variant,
          phaseDir: PHASE_DIR,
        }),
        /authorization|owner|signature|request|trust|key|canonical|reconciliation|decision|expired|revoked/i,
        attack.name,
      )
      const after = await repositorySnapshot(variant, protectedPaths)
      assert.deepEqual(after, before, attack.name)
    }
  } finally {
    await rm(owner, { recursive: true, force: true })
  }
})

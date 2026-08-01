import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import * as ownerAuthorization from './owner-authorization.mjs'
import {
  OWNER_ALLOWED_SIGNERS_LINE,
  OWNER_AUTHORIZATION_NAMESPACE,
  OWNER_AUTHORIZATION_PRINCIPAL,
  OWNER_KEY_FINGERPRINT,
  OWNER_NOT_BEFORE,
  OWNER_PUBLIC_KEY_LINE,
  assertCanonicalSshsigBytes,
  assertOwnerAuthorizationRequest,
  assertProductionTrustArtifacts,
  assertSignedSemanticReconciliation,
  buildOwnerAuthorizationRequest,
  canonicalJsonBytes,
  verifyOwnerAuthorization,
} from './owner-authorization.mjs'
import { sha256Json } from './rights-gate.mjs'

const PHASE_DIR =
  '.planning/phases/05-outreach-feasibility-gate'
const MATRIX_PATH = `${PHASE_DIR}/05-RIGHTS-MATRIX.json`
const QUALITY_PATH = `${PHASE_DIR}/05-QUALITY-REPORT.json`
const CHECKPOINT_PATH = `${PHASE_DIR}/05-OWNER-CHECKPOINT.json`
const BASELINE_PATH = `${PHASE_DIR}/05-EXECUTION-BASELINE.json`
const RECONCILIATION_PATH =
  `${PHASE_DIR}/05-CONTRACT-RECONCILIATION.json`
const TRUST_DIR = 'scripts/outreach-feasibility/trust'
const TRUST_ANCHOR_PATH = `${TRUST_DIR}/owner-trust-anchor.json`
const PUBLIC_KEY_PATH = `${TRUST_DIR}/phase-05-owner.pub`
const ALLOWED_SIGNERS_PATH =
  `${TRUST_DIR}/phase-05-owner.allowed_signers.txt`
const CLI_PATH = resolve(
  'scripts/outreach-feasibility/owner-authorization.mjs',
)
const FIXED_ISSUED_AT = '2026-07-30T04:00:00.000Z'
const FIXED_VERIFY_AT = new Date('2026-07-31T04:00:00.000Z')
const FIXED_NONCE = 'a'.repeat(64)

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), 'utf8'))
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function run(command, args, { stdin = null, cwd = resolve('.') } = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, {
      cwd,
      env: { PATH: '/usr/bin:/bin' },
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
    child.stdin.end(stdin ?? undefined)
  })
}

async function evidence() {
  const [
    trustAnchor,
    matrix,
    qualityReport,
    ownerCheckpoint,
    baseline,
    reconciliation,
  ] = await Promise.all([
    readJson(TRUST_ANCHOR_PATH),
    readJson(MATRIX_PATH),
    readJson(QUALITY_PATH),
    readJson(CHECKPOINT_PATH),
    readJson(BASELINE_PATH),
    readJson(RECONCILIATION_PATH),
  ])
  return {
    trustAnchor,
    matrix,
    qualityReport,
    ownerCheckpoint,
    baseline,
    reconciliation,
  }
}

async function requestFixture() {
  const inputs = await evidence()
  const request = buildOwnerAuthorizationRequest({
    ...inputs,
    nonce: FIXED_NONCE,
    issuedAt: FIXED_ISSUED_AT,
  })
  return {
    ...inputs,
    request,
    requestBytes: canonicalJsonBytes(request),
  }
}

function rehashRequest(request) {
  const copy = structuredClone(request)
  delete copy.owner_authorization_request_sha256
  return {
    ...copy,
    owner_authorization_request_sha256:
      sha256Bytes(canonicalJsonBytes(copy)),
  }
}

function rehashArtifact(record, digestField) {
  const body = structuredClone(record)
  delete body[digestField]
  return {
    ...body,
    [digestField]: sha256Json(body),
  }
}

async function copyTrustArtifacts(root) {
  const trustDir = join(root, 'scripts/outreach-feasibility/trust')
  await mkdir(trustDir, { recursive: true })
  const paths = {
    trustAnchorPath: join(trustDir, 'owner-trust-anchor.json'),
    publicKeyPath: join(trustDir, 'phase-05-owner.pub'),
    allowedSignersPath:
      join(trustDir, 'phase-05-owner.allowed_signers.txt'),
  }
  await Promise.all([
    copyFile(TRUST_ANCHOR_PATH, paths.trustAnchorPath),
    copyFile(PUBLIC_KEY_PATH, paths.publicKeyPath),
    copyFile(ALLOWED_SIGNERS_PATH, paths.allowedSignersPath),
  ])
  await Promise.all(Object.values(paths).map((path) => chmod(path, 0o644)))
  return paths
}

async function copyPublicAuthorizationArtifacts(root) {
  const paths = await copyTrustArtifacts(root)
  const requestPath = join(
    root,
    '05-OWNER-AUTHORIZATION-REQUEST.json',
  )
  const signaturePath =
    `${requestPath}.sig`
  await Promise.all([
    copyFile(
      `${PHASE_DIR}/05-OWNER-AUTHORIZATION-REQUEST.json`,
      requestPath,
    ),
    copyFile(
      `${PHASE_DIR}/05-OWNER-AUTHORIZATION-REQUEST.json.sig`,
      signaturePath,
    ),
  ])
  await Promise.all([
    chmod(requestPath, 0o644),
    chmod(signaturePath, 0o644),
  ])
  return { ...paths, requestPath, signaturePath }
}

async function generateTestKey(root, label = 'fixture') {
  const keyPath = join(root, label)
  const generated = await run('/usr/bin/ssh-keygen', [
    '-q',
    '-t',
    'ed25519',
    '-N',
    '',
    '-C',
    'temporary-test-key',
    '-f',
    keyPath,
  ])
  assert.equal(generated.code, 0, generated.stderr.toString('utf8'))
  return keyPath
}

async function signRequest({
  keyPath,
  requestPath,
  namespace = OWNER_AUTHORIZATION_NAMESPACE,
}) {
  const signed = await run('/usr/bin/ssh-keygen', [
    '-Y',
    'sign',
    '-f',
    keyPath,
    '-n',
    namespace,
    requestPath,
  ])
  assert.equal(signed.code, 0, signed.stderr.toString('utf8'))
  return `${requestPath}.sig`
}

test('committed public trust artifacts are byte-exact and fingerprint-pinned', async () => {
  assert.equal(
    await readFile(PUBLIC_KEY_PATH, 'utf8'),
    `${OWNER_PUBLIC_KEY_LINE}\n`,
  )
  assert.equal(
    await readFile(ALLOWED_SIGNERS_PATH, 'utf8'),
    `${OWNER_ALLOWED_SIGNERS_LINE}\n`,
  )
  const verified = await assertProductionTrustArtifacts({
    trustAnchorPath: TRUST_ANCHOR_PATH,
    publicKeyPath: PUBLIC_KEY_PATH,
    allowedSignersPath: ALLOWED_SIGNERS_PATH,
    now: FIXED_VERIFY_AT,
  })
  assert.equal(verified.principal, 'jackshi812')
  assert.equal(verified.principal, OWNER_AUTHORIZATION_PRINCIPAL)
  assert.equal(
    verified.namespace,
    'job-copilot-phase-05-owner-v1',
  )
  assert.equal(verified.fingerprint, OWNER_KEY_FINGERPRINT)
  assert.equal(verified.github_signing_key_record_id, 1081409)
  assert.equal(verified.not_before, OWNER_NOT_BEFORE)
  assert.equal(verified.status, 'ACTIVE')
  assert.equal(verified.revoked_at, null)
})

test('request builder emits one canonical LF-terminated finite document', async () => {
  const {
    request,
    requestBytes,
    trustAnchor,
    matrix,
    qualityReport,
    ownerCheckpoint,
    baseline,
    reconciliation,
  } = await requestFixture()
  assert.equal(request.nonce, FIXED_NONCE)
  assert.equal(request.issued_at, FIXED_ISSUED_AT)
  assert.equal(
    request.expires_at,
    '2026-08-06T04:00:00.000Z',
  )
  assert.equal(request.search_authorized, false)
  assert.equal(request.production_outreach_enabled, false)
  assert.equal(request.spike_executed, false)
  assert.equal(request.provider_call_count, 0)
  assert.equal(request.representative_case_count, 0)
  assert.equal(request.redesign_selection, null)
  assert.equal(requestBytes.at(-1), 0x0a)
  assert.notEqual(requestBytes.at(-2), 0x0a)
  assert.deepEqual(
    assertOwnerAuthorizationRequest({
      requestBytes,
      trustAnchor,
      matrix,
      qualityReport,
      ownerCheckpoint,
      baseline,
      reconciliation,
      now: FIXED_VERIFY_AT,
    }),
    request,
  )
})

test('request builder rejects every schema-invalid or self-hash-invalid evidence artifact', async () => {
  const fixture = await evidence()
  const mutations = [
    ['rights matrix schema', 'matrix',
      (value) => { value.schema_version = 2 }],
    ['rights matrix self-hash', 'matrix',
      (value) => { value.rights_evidence_sha256 = 'f'.repeat(64) }],
    ['rights source self-hash', 'matrix',
      (value) => { value.sources[0].evidence_sha256 = 'f'.repeat(64) }],
    ['quality report schema', 'qualityReport',
      (value) => { value.schema_version = 2 }],
    ['quality report self-hash', 'qualityReport',
      (value) => { value.quality_evidence_sha256 = 'f'.repeat(64) }],
    ['execution baseline schema', 'baseline',
      (value) => { value.schema_version = 2 }],
    ['execution baseline self-hash', 'baseline',
      (value) => { value.baseline_evidence_sha256 = 'f'.repeat(64) }],
    ['owner checkpoint schema', 'ownerCheckpoint',
      (value) => { value.schema_version = 2 }],
    ['owner checkpoint self-hash', 'ownerCheckpoint',
      (value) => {
        value.owner_checkpoint_evidence_sha256 = 'f'.repeat(64)
      }],
    ['reconciliation schema', 'reconciliation',
      (value) => { value.schema_version = 99 }],
    ['reconciliation self-hash', 'reconciliation',
      (value) => {
        value.contract_reconciliation_sha256 = 'f'.repeat(64)
      }],
  ]
  for (const [label, key, mutate] of mutations) {
    const inputs = structuredClone(fixture)
    mutate(inputs[key])
    assert.throws(
      () => buildOwnerAuthorizationRequest({
        ...inputs,
        nonce: FIXED_NONCE,
        issuedAt: FIXED_ISSUED_AT,
      }),
      /schema|digest|evidence|rights|quality|baseline|checkpoint|reconciliation/i,
      label,
    )
  }

  assert.throws(
    () => buildOwnerAuthorizationRequest({
      ...fixture,
      matrix: {
        phase: '05',
        rights_evidence_sha256: 'a'.repeat(64),
      },
      nonce: FIXED_NONCE,
      issuedAt: FIXED_ISSUED_AT,
    }),
    /matrix|schema|field|keys/i,
  )
})

test('request builder rejects every validly rehashed cross-artifact lineage split', async () => {
  const fixture = await evidence()
  const checkpointDigest = 'c'.repeat(64)
  const mutations = [
    ['checkpoint rights', (inputs) => {
      inputs.ownerCheckpoint.rights_evidence_sha256 = 'c'.repeat(64)
    }],
    ['checkpoint quality', (inputs) => {
      inputs.ownerCheckpoint.quality_evidence_sha256 = 'c'.repeat(64)
    }],
    ['checkpoint baseline', (inputs) => {
      inputs.ownerCheckpoint.baseline_evidence_sha256 = 'c'.repeat(64)
    }],
    ['reconciliation rights', (inputs) => {
      inputs.reconciliation.rights_evidence_sha256 = 'c'.repeat(64)
    }],
    ['reconciliation quality', (inputs) => {
      inputs.reconciliation.quality_evidence_sha256 = 'c'.repeat(64)
    }],
    ['reconciliation checkpoint', (inputs) => {
      inputs.reconciliation.owner_checkpoint_evidence_sha256 =
        'c'.repeat(64)
    }],
    ['checkpointed decision', (inputs) => {
      inputs.ownerCheckpoint.checkpointed_decision_contract_sha256 =
        checkpointDigest
    }],
  ]
  for (const [label, mutate] of mutations) {
    const inputs = structuredClone(fixture)
    mutate(inputs)
    inputs.ownerCheckpoint = rehashArtifact(
      inputs.ownerCheckpoint,
      'owner_checkpoint_evidence_sha256',
    )
    if (label.startsWith('checkpoint')) {
      inputs.reconciliation.owner_checkpoint_evidence_sha256 =
        inputs.ownerCheckpoint.owner_checkpoint_evidence_sha256
    }
    inputs.reconciliation = rehashArtifact(
      inputs.reconciliation,
      'contract_reconciliation_sha256',
    )
    assert.throws(
      () => buildOwnerAuthorizationRequest({
        ...inputs,
        nonce: FIXED_NONCE,
        issuedAt: FIXED_ISSUED_AT,
      }),
      /lineage drift/,
      label,
    )
  }
})

test('request parser recomputes the stopped payload digest before OpenSSH', async () => {
  assert.equal(
    typeof ownerAuthorization.parseOwnerAuthorizationRequest,
    'function',
  )
  const fixture = await requestFixture()
  const inconsistent = structuredClone(fixture.request)
  inconsistent.rights_evidence_sha256 = 'f'.repeat(64)
  const rehashed = rehashRequest(inconsistent)

  assert.throws(
    () => ownerAuthorization.parseOwnerAuthorizationRequest({
      requestBytes: canonicalJsonBytes(rehashed),
      trustAnchor: fixture.trustAnchor,
      now: FIXED_VERIFY_AT,
    }),
    /stopped decision payload digest/i,
  )
})

test('existing repository request and SSHSIG verify under exact pinned public trust', async () => {
  const verified = await verifyOwnerAuthorization({
    requestPath:
      `${PHASE_DIR}/05-OWNER-AUTHORIZATION-REQUEST.json`,
    signaturePath:
      `${PHASE_DIR}/05-OWNER-AUTHORIZATION-REQUEST.json.sig`,
    trustAnchorPath: TRUST_ANCHOR_PATH,
    publicKeyPath: PUBLIC_KEY_PATH,
    allowedSignersPath: ALLOWED_SIGNERS_PATH,
    now: FIXED_VERIFY_AT,
  })
  assert.equal(verified.authenticated, true)
  assert.equal(verified.principal, 'jackshi812')
  assert.equal(
    verified.namespace,
    'job-copilot-phase-05-owner-v1',
  )
  assert.equal(verified.fingerprint, OWNER_KEY_FINGERPRINT)
  assert.equal(
    verified.stopped_decision_payload_sha256,
    '82357d1fad4a50c5673691e96a0b688e0cd533b568be7005c03d4351015c31cb',
  )
})

test('verified authorization binds both signed terminal semantic digests', async () => {
  const verified = await verifyOwnerAuthorization({
    requestPath:
      `${PHASE_DIR}/05-OWNER-AUTHORIZATION-REQUEST.json`,
    signaturePath:
      `${PHASE_DIR}/05-OWNER-AUTHORIZATION-REQUEST.json.sig`,
    trustAnchorPath: TRUST_ANCHOR_PATH,
    publicKeyPath: PUBLIC_KEY_PATH,
    allowedSignersPath: ALLOWED_SIGNERS_PATH,
    now: FIXED_VERIFY_AT,
  })
  const reconciliation = await readJson(RECONCILIATION_PATH)
  assert.equal(
    assertSignedSemanticReconciliation({
      authorization: verified,
      reconciliation,
    }),
    reconciliation,
  )
  for (const [label, key] of [
    ['roadmap', 'roadmap_semantic_sha256'],
    ['requirements', 'requirements_semantic_sha256'],
  ]) {
    const drifted = {
      ...reconciliation,
      [key]: 'f'.repeat(64),
    }
    assert.throws(
      () => assertSignedSemanticReconciliation({
        authorization: verified,
        reconciliation: drifted,
      }),
      new RegExp(`signed ${label} semantic digest drift`, 'i'),
    )
    assert.throws(
      () => assertSignedSemanticReconciliation({
        authorization: verified,
        reconciliation,
        roadmap_semantic_sha256:
          key === 'roadmap_semantic_sha256'
            ? 'f'.repeat(64)
            : reconciliation.roadmap_semantic_sha256,
        requirements_semantic_sha256:
          key === 'requirements_semantic_sha256'
            ? 'f'.repeat(64)
            : reconciliation.requirements_semantic_sha256,
      }),
      new RegExp(`live ${label} semantic digest drift`, 'i'),
    )
  }
})

test('authorization rejects a valid signature moved to a noncanonical path', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'owner-auth-path-'))
  try {
    const requestPath = join(
      temporary,
      '05-OWNER-AUTHORIZATION-REQUEST.json',
    )
    const signaturePath = join(temporary, 'moved-request.json.sig')
    await Promise.all([
      copyFile(
        `${PHASE_DIR}/05-OWNER-AUTHORIZATION-REQUEST.json`,
        requestPath,
      ),
      copyFile(
        `${PHASE_DIR}/05-OWNER-AUTHORIZATION-REQUEST.json.sig`,
        signaturePath,
      ),
    ])
    await Promise.all([
      chmod(requestPath, 0o600),
      chmod(signaturePath, 0o600),
    ])
    await assert.rejects(
      () => verifyOwnerAuthorization({
        requestPath,
        signaturePath,
        trustAnchorPath: TRUST_ANCHOR_PATH,
        publicKeyPath: PUBLIC_KEY_PATH,
        allowedSignersPath: ALLOWED_SIGNERS_PATH,
        now: FIXED_VERIFY_AT,
      }),
      /signature path is not canonical/i,
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('every public authorization artifact fails closed under path and byte substitution', async () => {
  const artifacts = [
    {
      key: 'requestPath',
      source: `${PHASE_DIR}/05-OWNER-AUTHORIZATION-REQUEST.json`,
    },
    {
      key: 'signaturePath',
      source: `${PHASE_DIR}/05-OWNER-AUTHORIZATION-REQUEST.json.sig`,
    },
    { key: 'trustAnchorPath', source: TRUST_ANCHOR_PATH },
    { key: 'publicKeyPath', source: PUBLIC_KEY_PATH },
    { key: 'allowedSignersPath', source: ALLOWED_SIGNERS_PATH },
  ]
  const substitutions = [
    {
      label: 'renamed',
      async mutate(paths, artifact) {
        const moved = join(
          resolve(paths.requestPath, '..'),
          `renamed-${artifact.key}`,
        )
        await copyFile(paths[artifact.key], moved)
        await chmod(moved, 0o644)
        paths[artifact.key] = moved
      },
    },
    {
      label: 'symlinked',
      async mutate(paths, artifact) {
        await unlink(paths[artifact.key])
        await symlink(resolve(artifact.source), paths[artifact.key])
      },
    },
    {
      label: 'writable',
      async mutate(paths, artifact) {
        await chmod(paths[artifact.key], 0o666)
      },
    },
    {
      label: 'content-changed',
      async mutate(paths, artifact) {
        const original = await readFile(paths[artifact.key])
        await writeFile(
          paths[artifact.key],
          Buffer.concat([original, Buffer.from('\n')]),
          { mode: 0o644 },
        )
      },
    },
  ]

  for (const artifact of artifacts) {
    for (const substitution of substitutions) {
      const temporary = await mkdtemp(
        join(tmpdir(), `owner-auth-${artifact.key}-`),
      )
      try {
        const paths = await copyPublicAuthorizationArtifacts(temporary)
        await substitution.mutate(paths, artifact)
        await assert.rejects(
          () => verifyOwnerAuthorization({
            ...paths,
            now: FIXED_VERIFY_AT,
          }),
          undefined,
          `${artifact.key} ${substitution.label}`,
        )
      } finally {
        await rm(temporary, { recursive: true, force: true })
      }
    }
  }
})

test('request CLI creates exclusively and reopens canonical bytes', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'owner-auth-cli-'))
  try {
    const requestPath = join(
      temporary,
      '05-OWNER-AUTHORIZATION-REQUEST.json',
    )
    const evidenceArgs = [
      '--request',
      requestPath,
      '--trust-anchor',
      TRUST_ANCHOR_PATH,
      '--matrix',
      MATRIX_PATH,
      '--quality-report',
      QUALITY_PATH,
      '--owner-checkpoint',
      CHECKPOINT_PATH,
      '--baseline-record',
      BASELINE_PATH,
      '--reconciliation',
      RECONCILIATION_PATH,
    ]
    const created = await run(process.execPath, [
      CLI_PATH,
      '--create-request',
      ...evidenceArgs,
    ])
    assert.equal(created.code, 0, created.stderr.toString('utf8'))
    assert.equal(
      created.stdout.toString('utf8'),
      'OWNER_AUTHORIZATION_REQUEST_CREATED\n',
    )
    const bytes = await readFile(requestPath)
    assert.equal(bytes.at(-1), 0x0a)
    assert.deepEqual(bytes, canonicalJsonBytes(JSON.parse(bytes)))

    const duplicate = await run(process.execPath, [
      CLI_PATH,
      '--create-request',
      ...evidenceArgs,
    ])
    assert.notEqual(duplicate.code, 0)
    assert.match(duplicate.stderr.toString('utf8'), /already exists/)
    assert.deepEqual(await readFile(requestPath), bytes)

    const asserted = await run(process.execPath, [
      CLI_PATH,
      '--assert-request',
      ...evidenceArgs,
    ])
    assert.equal(asserted.code, 0, asserted.stderr.toString('utf8'))
    assert.equal(
      JSON.parse(asserted.stdout).status,
      'OWNER_AUTHORIZATION_REQUEST_VALID',
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('nonce, timestamps, canonical bytes, payload, and stale time fail closed', async () => {
  const fixture = await requestFixture()
  const mutations = [
    {
      label: 'nonce',
      mutate(request) {
        request.nonce = 'A'.repeat(64)
      },
      error: /nonce/,
    },
    {
      label: 'issued_at',
      mutate(request) {
        request.issued_at = '2026-07-30T03:39:43.370Z'
      },
      error: /not-before/,
    },
    {
      label: 'expires_at',
      mutate(request) {
        request.expires_at = '2026-08-06T04:00:00.001Z'
      },
      error: /seven-day/,
    },
    {
      label: 'payload',
      mutate(request) {
        request.search_authorized = true
      },
      error: /search authorized/,
    },
  ]
  for (const mutation of mutations) {
    const request = structuredClone(fixture.request)
    mutation.mutate(request)
    const rehashed = rehashRequest(request)
    assert.throws(
      () => assertOwnerAuthorizationRequest({
        requestBytes: canonicalJsonBytes(rehashed),
        trustAnchor: fixture.trustAnchor,
        matrix: fixture.matrix,
        qualityReport: fixture.qualityReport,
        ownerCheckpoint: fixture.ownerCheckpoint,
        baseline: fixture.baseline,
        reconciliation: fixture.reconciliation,
        now: FIXED_VERIFY_AT,
      }),
      mutation.error,
      mutation.label,
    )
  }
  assert.throws(
    () => assertOwnerAuthorizationRequest({
      requestBytes: Buffer.concat([
        fixture.requestBytes.subarray(0, fixture.requestBytes.length - 1),
        Buffer.from(' \n'),
      ]),
      trustAnchor: fixture.trustAnchor,
      matrix: fixture.matrix,
      qualityReport: fixture.qualityReport,
      ownerCheckpoint: fixture.ownerCheckpoint,
      baseline: fixture.baseline,
      reconciliation: fixture.reconciliation,
      now: FIXED_VERIFY_AT,
    }),
    /canonical/,
  )
  assert.throws(
    () => assertOwnerAuthorizationRequest({
      requestBytes: fixture.requestBytes,
      trustAnchor: fixture.trustAnchor,
      matrix: fixture.matrix,
      qualityReport: fixture.qualityReport,
      ownerCheckpoint: fixture.ownerCheckpoint,
      baseline: fixture.baseline,
      reconciliation: fixture.reconciliation,
      now: new Date('2026-08-06T04:00:00.001Z'),
    }),
    /expired/,
  )
})

test('SSHSIG armor accepts one document and rejects malformed or extra bytes', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'owner-auth-armor-'))
  try {
    const { requestBytes } = await requestFixture()
    const requestPath = join(
      temporary,
      '05-OWNER-AUTHORIZATION-REQUEST.json',
    )
    await writeFile(requestPath, requestBytes, { mode: 0o600 })
    const keyPath = await generateTestKey(temporary)
    const signaturePath = await signRequest({ keyPath, requestPath })
    const signatureBytes = await readFile(signaturePath)
    assert.deepEqual(
      assertCanonicalSshsigBytes(signatureBytes),
      signatureBytes,
    )
    for (const malformed of [
      signatureBytes.subarray(0, signatureBytes.length - 1),
      Buffer.concat([signatureBytes, Buffer.from('\n')]),
      Buffer.concat([signatureBytes, signatureBytes]),
      Buffer.from(signatureBytes.toString('utf8').replaceAll('\n', '\r\n')),
      Buffer.from('-----BEGIN SSH SIGNATURE-----\ninvalid!\n'
        + '-----END SSH SIGNATURE-----\n'),
    ]) {
      assert.throws(
        () => assertCanonicalSshsigBytes(malformed),
        /canonical SSHSIG/,
      )
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('system OpenSSH success uses one unambiguous stdout line', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'owner-auth-openssh-'))
  try {
    const { requestBytes } = await requestFixture()
    const requestPath = join(
      temporary,
      '05-OWNER-AUTHORIZATION-REQUEST.json',
    )
    await writeFile(requestPath, requestBytes, { mode: 0o600 })
    const keyPath = await generateTestKey(temporary)
    const signaturePath = await signRequest({ keyPath, requestPath })
    const publicKey = (await readFile(`${keyPath}.pub`, 'utf8')).trim()
    const allowedPath = join(temporary, 'allowed_signers')
    await writeFile(
      allowedPath,
      `${OWNER_AUTHORIZATION_PRINCIPAL} `
        + `namespaces="${OWNER_AUTHORIZATION_NAMESPACE}" `
        + `${publicKey}\n`,
      { mode: 0o600 },
    )
    const fingerprint = await run('/usr/bin/ssh-keygen', [
      '-lf',
      `${keyPath}.pub`,
      '-E',
      'sha256',
    ])
    assert.equal(fingerprint.code, 0)
    assert.equal(fingerprint.stderr.length, 0)
    const fingerprintValue =
      fingerprint.stdout.toString('utf8').split(' ')[1]
    const verified = await run('/usr/bin/ssh-keygen', [
      '-Y',
      'verify',
      '-f',
      allowedPath,
      '-I',
      OWNER_AUTHORIZATION_PRINCIPAL,
      '-n',
      OWNER_AUTHORIZATION_NAMESPACE,
      '-s',
      signaturePath,
    ], { stdin: requestBytes })
    assert.equal(verified.code, 0)
    assert.equal(verified.stderr.length, 0)
    assert.equal(
      verified.stdout.toString('utf8'),
      `Good "${OWNER_AUTHORIZATION_NAMESPACE}" signature for `
        + `${OWNER_AUTHORIZATION_PRINCIPAL} with ED25519 key `
        + `${fingerprintValue}\n`,
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('revoked, mismatched, missing, writable, or symlinked trust fails closed', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'owner-auth-trust-'))
  try {
    const paths = await copyTrustArtifacts(temporary)
    const anchor = await readJson(paths.trustAnchorPath)
    const inactive = {
      ...anchor,
      status: 'INACTIVE',
    }
    await writeFile(
      paths.trustAnchorPath,
      canonicalJsonBytes(inactive),
      { mode: 0o644 },
    )
    await assert.rejects(
      () => assertProductionTrustArtifacts({
        ...paths,
        now: FIXED_VERIFY_AT,
      }),
      /active|revoked/i,
    )

    const revoked = {
      ...anchor,
      revoked_at: '2026-07-31T00:00:00.000Z',
    }
    await writeFile(
      paths.trustAnchorPath,
      canonicalJsonBytes(revoked),
      { mode: 0o644 },
    )
    await assert.rejects(
      () => assertProductionTrustArtifacts({
        ...paths,
        now: FIXED_VERIFY_AT,
      }),
      /revoked/i,
    )

    await copyFile(TRUST_ANCHOR_PATH, paths.trustAnchorPath)
    const mismatched = {
      ...anchor,
      fingerprint_sha256: `SHA256:${'x'.repeat(43)}`,
    }
    await writeFile(
      paths.trustAnchorPath,
      canonicalJsonBytes(mismatched),
      { mode: 0o644 },
    )
    await assert.rejects(
      () => assertProductionTrustArtifacts({
        ...paths,
        now: FIXED_VERIFY_AT,
      }),
      /fingerprint/,
    )

    await copyFile(TRUST_ANCHOR_PATH, paths.trustAnchorPath)
    await writeFile(
      paths.allowedSignersPath,
      `${OWNER_ALLOWED_SIGNERS_LINE.replace(
        OWNER_AUTHORIZATION_PRINCIPAL,
        'attacker',
      )}\n`,
      { mode: 0o644 },
    )
    await assert.rejects(
      () => assertProductionTrustArtifacts({
        ...paths,
        now: FIXED_VERIFY_AT,
      }),
      /allowed-signers/,
    )

    await copyFile(ALLOWED_SIGNERS_PATH, paths.allowedSignersPath)
    await chmod(paths.publicKeyPath, 0o666)
    await assert.rejects(
      () => assertProductionTrustArtifacts({
        ...paths,
        now: FIXED_VERIFY_AT,
      }),
      /permissions/,
    )

    await chmod(paths.publicKeyPath, 0o644)
    await unlink(paths.publicKeyPath)
    await symlink(resolve(PUBLIC_KEY_PATH), paths.publicKeyPath)
    await assert.rejects(
      () => assertProductionTrustArtifacts({
        ...paths,
        now: FIXED_VERIFY_AT,
      }),
      /symlink/,
    )

    await unlink(paths.publicKeyPath)
    await assert.rejects(
      () => assertProductionTrustArtifacts({
        ...paths,
        now: FIXED_VERIFY_AT,
      }),
      /could not be read/,
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('wrong key, namespace, request byte, principal, and fingerprint never verify', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'owner-auth-verify-'))
  try {
    const fixture = await requestFixture()
    const requestPath = join(
      temporary,
      '05-OWNER-AUTHORIZATION-REQUEST.json',
    )
    await writeFile(requestPath, fixture.requestBytes, { mode: 0o600 })
    const keyPath = await generateTestKey(temporary)
    const wrongKeySignature = await signRequest({ keyPath, requestPath })
    const paths = await copyTrustArtifacts(temporary)
    await assert.rejects(
      () => verifyOwnerAuthorization({
        requestPath,
        signaturePath: wrongKeySignature,
        ...paths,
        now: FIXED_VERIFY_AT,
      }),
      /SSHSIG verification failed/,
    )

    await unlink(wrongKeySignature)
    const wrongNamespaceSignature = await signRequest({
      keyPath,
      requestPath,
      namespace: 'wrong-owner-namespace',
    })
    await assert.rejects(
      () => verifyOwnerAuthorization({
        requestPath,
        signaturePath: wrongNamespaceSignature,
        ...paths,
        now: FIXED_VERIFY_AT,
      }),
      /SSHSIG verification failed/,
    )

    const mutatedBytes = Buffer.from(fixture.requestBytes)
    const marker = Buffer.from('RIGHTS_NO_GO')
    const offset = mutatedBytes.indexOf(marker)
    assert.notEqual(offset, -1)
    mutatedBytes[offset] = 0x58
    await writeFile(requestPath, mutatedBytes, { mode: 0o600 })
    await assert.rejects(
      () => verifyOwnerAuthorization({
        requestPath,
        signaturePath: wrongNamespaceSignature,
        ...paths,
        now: FIXED_VERIFY_AT,
      }),
      /self-hash|canonical|purpose|rights status/,
    )

    await writeFile(requestPath, fixture.requestBytes, { mode: 0o600 })
    await writeFile(
      paths.allowedSignersPath,
      `${OWNER_ALLOWED_SIGNERS_LINE.replace(
        OWNER_AUTHORIZATION_NAMESPACE,
        'wrong-owner-namespace',
      )}\n`,
      { mode: 0o644 },
    )
    await assert.rejects(
      () => verifyOwnerAuthorization({
        requestPath,
        signaturePath: wrongNamespaceSignature,
        ...paths,
        now: FIXED_VERIFY_AT,
      }),
      /allowed-signers/,
    )

    await copyFile(ALLOWED_SIGNERS_PATH, paths.allowedSignersPath)
    const anchor = await readJson(paths.trustAnchorPath)
    await writeFile(
      paths.trustAnchorPath,
      canonicalJsonBytes({
        ...anchor,
        fingerprint_sha256: 'SHA256:wrong',
      }),
      { mode: 0o644 },
    )
    await assert.rejects(
      () => verifyOwnerAuthorization({
        requestPath,
        signaturePath: wrongNamespaceSignature,
        ...paths,
        now: FIXED_VERIFY_AT,
      }),
      /fingerprint/,
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

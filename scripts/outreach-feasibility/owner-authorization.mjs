#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import {
  lstat,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  assertOwnerAuthorizationEvidenceArtifacts,
} from './authorization-evidence-validators.mjs'

export const OWNER_AUTHORIZATION_PRINCIPAL = 'jackshi812'
export const OWNER_AUTHORIZATION_NAMESPACE =
  'job-copilot-phase-05-owner-v1'
export const OWNER_KEY_FINGERPRINT =
  'SHA256:FPrmyBVv+PxnI9UpEajtjjV3B4bQQqFcyL1duuN+IhI'
export const OWNER_NOT_BEFORE = '2026-07-30T03:39:43.371Z'
export const OWNER_PUBLIC_KEY_LINE =
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG2D1nrByiQxldOhXWZnd4TlyKq67wGblKkgCNyWtGC8'
export const OWNER_ALLOWED_SIGNERS_LINE =
  `${OWNER_AUTHORIZATION_PRINCIPAL} `
  + `namespaces="${OWNER_AUTHORIZATION_NAMESPACE}" `
  + OWNER_PUBLIC_KEY_LINE

const OWNER_GITHUB_ACCOUNT = 'jackshi812'
const OWNER_GIT_IDENTITY = 'jackshi812 <jack.s@wustl.edu>'
const OWNER_GITHUB_RECORD_ID = 1081409
const OWNER_GITHUB_RECORD_TITLE = 'Job Copilot owner signing'
const OWNER_GITHUB_PUBLIC_URL = 'https://github.com/jackshi812'
const OWNER_STATEMENT =
  'I authorize only the existing stopped Phase 5 RIGHTS_NO_GO / '
  + 'NOT_RUN_RIGHTS_NO_GO decision; production outreach search remains '
  + 'disabled; no provider call or representative spike is permitted.'
const REQUEST_PURPOSE =
  'FRESH_OWNER_AUTHORIZATION_RIGHTS_NO_GO'
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const SHA256 = /^[0-9a-f]{64}$/
const NONCE = /^[0-9a-f]{64}$/
const CANONICAL_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const MAX_JSON_BYTES = 64 * 1024
const MAX_SIGNATURE_BYTES = 16 * 1024
const SSH_KEYGEN = '/usr/bin/ssh-keygen'

const TRUST_ANCHOR_KEYS = [
  'algorithm',
  'fingerprint_sha256',
  'git_identity',
  'github_account',
  'github_public_url',
  'github_signing_key_created_at',
  'github_signing_key_record_id',
  'github_signing_key_title',
  'namespace',
  'not_before',
  'phase',
  'principal',
  'public_key',
  'revoked_at',
  'schema_version',
  'status',
]

const REQUEST_KEYS = [
  'baseline_evidence_sha256',
  'expires_at',
  'fixture_count',
  'github_signing_key_created_at',
  'github_signing_key_record_id',
  'issued_at',
  'namespace',
  'nonce',
  'owner_authorization_request_sha256',
  'owner_checkpoint_evidence_sha256',
  'owner_statement',
  'phase',
  'principal',
  'production_mutation_count',
  'production_outreach_enabled',
  'provider_call_count',
  'purpose',
  'quality_evidence_sha256',
  'quality_status',
  'raw_result_count',
  'redesign_selection',
  'representative_case_count',
  'requirements_semantic_sha256',
  'rights_evidence_sha256',
  'rights_status',
  'roadmap_semantic_sha256',
  'search_authorized',
  'spike_executed',
  'ssh_signing_key_fingerprint',
  'stopped_decision_payload_sha256',
]

function requireCondition(condition, message) {
  if (!condition) throw new Error(message)
}

function assertPlainJsonValue(value, label) {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) return value
  if (typeof value === 'number') {
    requireCondition(Number.isFinite(value), `${label} is not finite JSON`)
    return value
  }
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      assertPlainJsonValue(item, `${label}[${index}]`))
  }
  requireCondition(
    typeof value === 'object'
      && (Object.getPrototypeOf(value) === Object.prototype
        || Object.getPrototypeOf(value) === null),
    `${label} is not a plain JSON value`,
  )
  const sorted = {}
  for (const key of Object.keys(value).sort()) {
    const child = value[key]
    requireCondition(
      child !== undefined
        && typeof child !== 'bigint'
        && typeof child !== 'function'
        && typeof child !== 'symbol',
      `${label}.${key} is not finite JSON`,
    )
    sorted[key] = assertPlainJsonValue(child, `${label}.${key}`)
  }
  return sorted
}

export function canonicalJsonBytes(value) {
  return Buffer.from(
    `${JSON.stringify(assertPlainJsonValue(value, 'document'), null, 2)}\n`,
    'utf8',
  )
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function assertExactKeys(value, expected, label) {
  requireCondition(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    `${label} must be an object`,
  )
  const actual = Object.keys(value).sort()
  requireCondition(
    actual.length === expected.length
      && actual.every((key, index) => key === expected[index]),
    `${label} fields are not the exact finite schema`,
  )
}

function timestampMs(value, label) {
  requireCondition(
    typeof value === 'string' && CANONICAL_TIMESTAMP.test(value),
    `${label} is not a canonical UTC millisecond timestamp`,
  )
  const parsed = Date.parse(value)
  requireCondition(
    Number.isFinite(parsed) && new Date(parsed).toISOString() === value,
    `${label} is not a real canonical UTC timestamp`,
  )
  return parsed
}

function nowMs(value, label = 'verification time') {
  const date = value instanceof Date ? value : new Date(value)
  requireCondition(
    Number.isFinite(date.getTime()),
    `${label} is malformed`,
  )
  return date.getTime()
}

function requireSha256(value, label) {
  requireCondition(
    typeof value === 'string' && SHA256.test(value),
    `${label} is malformed`,
  )
}

function assertTrustAnchorValue(anchor, { now = new Date() } = {}) {
  assertExactKeys(anchor, TRUST_ANCHOR_KEYS, 'owner trust anchor')
  requireCondition(
    anchor.algorithm === 'ssh-ed25519',
    'owner trust anchor algorithm drift',
  )
  requireCondition(
    anchor.fingerprint_sha256 === OWNER_KEY_FINGERPRINT,
    'owner trust anchor fingerprint drift',
  )
  requireCondition(
    anchor.git_identity === OWNER_GIT_IDENTITY,
    'owner trust anchor Git identity drift',
  )
  requireCondition(
    anchor.github_account === OWNER_GITHUB_ACCOUNT,
    'owner trust anchor GitHub account drift',
  )
  requireCondition(
    anchor.github_public_url === OWNER_GITHUB_PUBLIC_URL,
    'owner trust anchor public GitHub URL drift',
  )
  requireCondition(
    anchor.github_signing_key_created_at === OWNER_NOT_BEFORE,
    'owner trust anchor signing-key created time drift',
  )
  requireCondition(
    anchor.github_signing_key_record_id === OWNER_GITHUB_RECORD_ID,
    'owner trust anchor signing-key record drift',
  )
  requireCondition(
    anchor.github_signing_key_title === OWNER_GITHUB_RECORD_TITLE,
    'owner trust anchor signing-key title drift',
  )
  requireCondition(
    anchor.namespace === OWNER_AUTHORIZATION_NAMESPACE,
    'owner trust anchor namespace drift',
  )
  requireCondition(
    anchor.not_before === OWNER_NOT_BEFORE,
    'owner trust anchor not-before drift',
  )
  requireCondition(anchor.phase === '05', 'owner trust anchor phase drift')
  requireCondition(
    anchor.principal === OWNER_AUTHORIZATION_PRINCIPAL,
    'owner trust anchor principal drift',
  )
  requireCondition(
    anchor.public_key === OWNER_PUBLIC_KEY_LINE,
    'owner trust anchor public key drift',
  )
  requireCondition(
    anchor.schema_version === 1,
    'owner trust anchor schema version drift',
  )
  requireCondition(
    anchor.status === 'ACTIVE',
    'owner trust anchor is not active',
  )
  requireCondition(
    anchor.revoked_at === null,
    'owner trust anchor is revoked',
  )
  const notBefore = timestampMs(anchor.not_before, 'owner key not-before')
  requireCondition(
    nowMs(now) >= notBefore,
    'verification time precedes owner key not-before',
  )
  return anchor
}

function stoppedDecisionPayload({
  matrix,
  qualityReport,
  ownerCheckpoint,
  baseline,
  reconciliation,
}) {
  return {
    baseline_evidence_sha256: baseline.baseline_evidence_sha256,
    fixture_count: 0,
    owner_checkpoint_evidence_sha256:
      ownerCheckpoint.owner_checkpoint_evidence_sha256,
    phase: '05',
    production_mutation_count: 0,
    production_outreach_enabled: false,
    provider_call_count: 0,
    quality_evidence_sha256: qualityReport.quality_evidence_sha256,
    quality_status: 'NOT_RUN_RIGHTS_NO_GO',
    raw_result_count: 0,
    redesign_selection: null,
    representative_case_count: 0,
    requirements_semantic_sha256:
      reconciliation.requirements_semantic_sha256,
    rights_evidence_sha256: matrix.rights_evidence_sha256,
    rights_status: 'RIGHTS_NO_GO',
    roadmap_semantic_sha256: reconciliation.roadmap_semantic_sha256,
    search_authorized: false,
    spike_executed: false,
  }
}

function stoppedDecisionPayloadFromRequest(request) {
  return {
    baseline_evidence_sha256: request.baseline_evidence_sha256,
    fixture_count: request.fixture_count,
    owner_checkpoint_evidence_sha256:
      request.owner_checkpoint_evidence_sha256,
    phase: request.phase,
    production_mutation_count: request.production_mutation_count,
    production_outreach_enabled: request.production_outreach_enabled,
    provider_call_count: request.provider_call_count,
    quality_evidence_sha256: request.quality_evidence_sha256,
    quality_status: request.quality_status,
    raw_result_count: request.raw_result_count,
    redesign_selection: request.redesign_selection,
    representative_case_count: request.representative_case_count,
    requirements_semantic_sha256:
      request.requirements_semantic_sha256,
    rights_evidence_sha256: request.rights_evidence_sha256,
    rights_status: request.rights_status,
    roadmap_semantic_sha256: request.roadmap_semantic_sha256,
    search_authorized: request.search_authorized,
    spike_executed: request.spike_executed,
  }
}

export function assertSignedSemanticReconciliation({
  authorization,
  reconciliation,
  roadmap_semantic_sha256: liveRoadmapSemanticSha256,
  requirements_semantic_sha256: liveRequirementsSemanticSha256,
}) {
  requireCondition(
    authorization?.authenticated === true
      && authorization.status === 'OWNER_AUTHORIZATION_VERIFIED'
      && authorization.request,
    'verified owner authorization is required for semantic reconciliation',
  )
  requireCondition(
    reconciliation
      && typeof reconciliation === 'object'
      && !Array.isArray(reconciliation),
    'contract reconciliation is required for signed semantic lineage',
  )
  for (const [label, key] of [
    ['roadmap', 'roadmap_semantic_sha256'],
    ['requirements', 'requirements_semantic_sha256'],
  ]) {
    requireSha256(
      reconciliation[key],
      `reconciliation ${label} semantic digest`,
    )
    requireCondition(
      authorization.request[key] === reconciliation[key],
      `signed ${label} semantic digest drift`,
    )
  }
  const liveDigests = [
    ['roadmap', 'roadmap_semantic_sha256', liveRoadmapSemanticSha256],
    [
      'requirements',
      'requirements_semantic_sha256',
      liveRequirementsSemanticSha256,
    ],
  ]
  const hasLiveDigests = liveDigests.some(
    ([, , digest]) => digest !== undefined,
  )
  if (hasLiveDigests) {
    requireCondition(
      liveDigests.every(([, , digest]) => digest !== undefined),
      'both live terminal semantic digests are required',
    )
    for (const [label, key, digest] of liveDigests) {
      requireSha256(digest, `live ${label} semantic digest`)
      requireCondition(
        digest === authorization.request[key]
          && digest === reconciliation[key],
        `live ${label} semantic digest drift`,
      )
    }
  }
  return reconciliation
}

function assertStoppedEvidence({
  matrix,
  qualityReport,
  ownerCheckpoint,
  baseline,
  reconciliation,
}) {
  assertOwnerAuthorizationEvidenceArtifacts({
    matrix,
    qualityReport,
    ownerCheckpoint,
    baseline,
    reconciliation,
    authorizationIdentity: {
      principal: OWNER_AUTHORIZATION_PRINCIPAL,
      namespace: OWNER_AUTHORIZATION_NAMESPACE,
      fingerprint: OWNER_KEY_FINGERPRINT,
    },
  })
  requireCondition(
    matrix.phase === '05'
      && matrix.rights_evidence_sha256 ===
        reconciliation.rights_evidence_sha256,
    'rights evidence drift',
  )
  requireCondition(
    qualityReport.phase === '05'
      && qualityReport.status === 'NOT_RUN_RIGHTS_NO_GO'
      && qualityReport.rights_status === 'RIGHTS_NO_GO'
      && qualityReport.search_authorized === false
      && qualityReport.cases?.length === 0
      && qualityReport.provider_call_count === 0
      && qualityReport.fixture_count === 0
      && qualityReport.raw_result_count === 0
      && qualityReport.production_mutation_count === 0,
    'quality evidence is not the stopped no-run branch',
  )
  requireCondition(
    qualityReport.quality_evidence_sha256
      === reconciliation.quality_evidence_sha256,
    'quality evidence drift',
  )
  requireSha256(
    baseline.baseline_evidence_sha256,
    'baseline evidence digest',
  )
  requireSha256(
    ownerCheckpoint.owner_checkpoint_evidence_sha256,
    'historical integrity receipt digest',
  )
  requireCondition(
    ownerCheckpoint.status === 'OWNER_RESPONSE_RECORDED',
    'historical integrity receipt status drift',
  )
  requireCondition(
    reconciliation.status === 'ACCEPTED_RIGHTS_NO_GO_RECONCILED'
      && reconciliation.spike_executed === false
      && reconciliation.representative_case_count === 0
      && reconciliation.provider_call_count === 0
      && reconciliation.fixture_count === 0
      && reconciliation.raw_result_count === 0
      && reconciliation.production_mutation_count === 0
      && reconciliation.quality_claim === 'NONE',
    'stopped reconciliation drift',
  )
  for (const [label, value] of [
    ['roadmap semantic digest', reconciliation.roadmap_semantic_sha256],
    [
      'requirements semantic digest',
      reconciliation.requirements_semantic_sha256,
    ],
  ]) requireSha256(value, label)
}

export function buildOwnerAuthorizationRequest({
  trustAnchor,
  matrix,
  qualityReport,
  ownerCheckpoint,
  baseline,
  reconciliation,
  nonce = randomBytes(32).toString('hex'),
  issuedAt = new Date(),
}) {
  assertTrustAnchorValue(trustAnchor, { now: issuedAt })
  assertStoppedEvidence({
    matrix,
    qualityReport,
    ownerCheckpoint,
    baseline,
    reconciliation,
  })
  requireCondition(
    typeof nonce === 'string' && NONCE.test(nonce),
    'owner authorization nonce is malformed',
  )
  const issued = issuedAt instanceof Date
    ? issuedAt.toISOString()
    : issuedAt
  const issuedMs = timestampMs(issued, 'request issued_at')
  const notBeforeMs = timestampMs(
    trustAnchor.not_before,
    'owner key not-before',
  )
  requireCondition(
    issuedMs >= notBeforeMs,
    'request issued_at precedes key not-before',
  )
  const payload = stoppedDecisionPayload({
    matrix,
    qualityReport,
    ownerCheckpoint,
    baseline,
    reconciliation,
  })
  const body = {
    ...payload,
    expires_at: new Date(issuedMs + SEVEN_DAYS_MS).toISOString(),
    github_signing_key_created_at:
      trustAnchor.github_signing_key_created_at,
    github_signing_key_record_id:
      trustAnchor.github_signing_key_record_id,
    issued_at: issued,
    namespace: trustAnchor.namespace,
    nonce,
    owner_statement: OWNER_STATEMENT,
    principal: trustAnchor.principal,
    purpose: REQUEST_PURPOSE,
    ssh_signing_key_fingerprint: trustAnchor.fingerprint_sha256,
    stopped_decision_payload_sha256:
      sha256Bytes(canonicalJsonBytes(payload)),
  }
  const sortedBody = assertPlainJsonValue(body, 'request payload')
  return assertPlainJsonValue({
    ...sortedBody,
    owner_authorization_request_sha256:
      sha256Bytes(canonicalJsonBytes(sortedBody)),
  }, 'owner authorization request')
}

export function parseOwnerAuthorizationRequest({
  requestBytes,
  trustAnchor,
  now = new Date(),
}) {
  requireCondition(
    Buffer.isBuffer(requestBytes)
      && requestBytes.length > 0
      && requestBytes.length <= MAX_JSON_BYTES,
    'owner authorization request size is invalid',
  )
  let text
  let request
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(requestBytes)
    request = JSON.parse(text)
  } catch {
    throw new Error('owner authorization request is not canonical JSON')
  }
  assertExactKeys(
    request,
    REQUEST_KEYS,
    'owner authorization request',
  )
  requireCondition(
    requestBytes.equals(canonicalJsonBytes(request)),
    'owner authorization request bytes are not canonical',
  )
  const {
    owner_authorization_request_sha256: requestDigest,
    ...body
  } = request
  requireSha256(requestDigest, 'owner authorization request self-hash')
  requireCondition(
    requestDigest === sha256Bytes(canonicalJsonBytes(body)),
    'owner authorization request self-hash drift',
  )
  assertTrustAnchorValue(trustAnchor, { now })
  requireCondition(
    request.phase === '05',
    'owner authorization request phase drift',
  )
  requireCondition(
    request.purpose === REQUEST_PURPOSE,
    'owner authorization request purpose drift',
  )
  requireCondition(
    request.principal === OWNER_AUTHORIZATION_PRINCIPAL
      && request.principal === trustAnchor.principal,
    'owner authorization request principal drift',
  )
  requireCondition(
    request.namespace === OWNER_AUTHORIZATION_NAMESPACE
      && request.namespace === trustAnchor.namespace,
    'owner authorization request namespace drift',
  )
  requireCondition(
    request.ssh_signing_key_fingerprint === OWNER_KEY_FINGERPRINT
      && request.ssh_signing_key_fingerprint
        === trustAnchor.fingerprint_sha256,
    'owner authorization request fingerprint drift',
  )
  requireCondition(
    request.github_signing_key_record_id === OWNER_GITHUB_RECORD_ID
      && request.github_signing_key_record_id
        === trustAnchor.github_signing_key_record_id,
    'owner authorization request signing-key record drift',
  )
  requireCondition(
    request.github_signing_key_created_at === OWNER_NOT_BEFORE
      && request.github_signing_key_created_at
        === trustAnchor.github_signing_key_created_at,
    'owner authorization request signing-key created time drift',
  )
  requireCondition(
    request.owner_statement === OWNER_STATEMENT,
    'owner authorization request owner statement drift',
  )
  requireCondition(
    request.rights_status === 'RIGHTS_NO_GO',
    'owner authorization request rights status drift',
  )
  requireCondition(
    request.quality_status === 'NOT_RUN_RIGHTS_NO_GO',
    'owner authorization request quality status drift',
  )
  requireCondition(
    request.search_authorized === false,
    'owner authorization request search authorized drift',
  )
  requireCondition(
    request.production_outreach_enabled === false,
    'owner authorization request production outreach drift',
  )
  requireCondition(
    request.spike_executed === false,
    'owner authorization request spike execution drift',
  )
  for (const key of [
    'representative_case_count',
    'provider_call_count',
    'fixture_count',
    'raw_result_count',
    'production_mutation_count',
  ]) {
    requireCondition(
      request[key] === 0,
      `owner authorization request ${key.replaceAll('_', ' ')} drift`,
    )
  }
  requireCondition(
    request.redesign_selection === null,
    'owner authorization request redesign selection drift',
  )
  for (const key of [
    'rights_evidence_sha256',
    'quality_evidence_sha256',
    'baseline_evidence_sha256',
    'owner_checkpoint_evidence_sha256',
    'roadmap_semantic_sha256',
    'requirements_semantic_sha256',
    'stopped_decision_payload_sha256',
  ]) requireSha256(request[key], `owner authorization request ${key}`)
  requireCondition(
    request.stopped_decision_payload_sha256
      === sha256Bytes(canonicalJsonBytes(
        stoppedDecisionPayloadFromRequest(request),
      )),
    'owner authorization request stopped decision payload digest drift',
  )
  requireCondition(
    typeof request.nonce === 'string' && NONCE.test(request.nonce),
    'owner authorization request nonce is malformed',
  )
  const issued = timestampMs(request.issued_at, 'request issued_at')
  const expires = timestampMs(request.expires_at, 'request expires_at')
  const notBefore = timestampMs(
    trustAnchor.not_before,
    'owner key not-before',
  )
  requireCondition(
    issued >= notBefore,
    'request issued_at precedes key not-before',
  )
  requireCondition(
    expires - issued === SEVEN_DAYS_MS,
    'owner authorization request exceeds the exact seven-day window',
  )
  const verification = nowMs(now)
  requireCondition(
    verification >= notBefore,
    'verification time precedes owner key not-before',
  )
  requireCondition(
    verification >= issued,
    'verification time precedes request issued_at',
  )
  requireCondition(
    verification <= expires,
    'owner authorization request expired',
  )
  return request
}

export function assertOwnerAuthorizationRequest({
  requestBytes,
  trustAnchor,
  matrix,
  qualityReport,
  ownerCheckpoint,
  baseline,
  reconciliation,
  now = new Date(),
}) {
  const request = parseOwnerAuthorizationRequest({
    requestBytes,
    trustAnchor,
    now,
  })
  assertStoppedEvidence({
    matrix,
    qualityReport,
    ownerCheckpoint,
    baseline,
    reconciliation,
  })
  const payload = stoppedDecisionPayload({
    matrix,
    qualityReport,
    ownerCheckpoint,
    baseline,
    reconciliation,
  })
  for (const [key, value] of Object.entries(payload)) {
    requireCondition(
      request[key] === value,
      `owner authorization request ${key.replaceAll('_', ' ')} drift`,
    )
  }
  requireCondition(
    request.stopped_decision_payload_sha256
      === sha256Bytes(canonicalJsonBytes(payload)),
    'owner authorization request stopped decision payload drift',
  )
  return request
}

function assertPathBasename(path, expected, label) {
  requireCondition(
    typeof path === 'string' && basename(path) === expected,
    `${label} path is not the canonical public artifact`,
  )
}

async function readRegularFile(path, {
  label,
  maxBytes,
  expectedBasename,
}) {
  assertPathBasename(path, expectedBasename, label)
  let metadata
  try {
    metadata = await lstat(resolve(path))
  } catch {
    throw new Error(`${label} could not be read`)
  }
  requireCondition(!metadata.isSymbolicLink(), `${label} is a symlink`)
  requireCondition(metadata.isFile(), `${label} is not a regular file`)
  requireCondition(
    (metadata.mode & 0o022) === 0,
    `${label} has unsafe permissions`,
  )
  requireCondition(
    metadata.size > 0 && metadata.size <= maxBytes,
    `${label} size is invalid`,
  )
  try {
    return await readFile(resolve(path))
  } catch {
    throw new Error(`${label} could not be read`)
  }
}

function spawnSshKeygen(args, { stdin = null } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(SSH_KEYGEN, args, {
      env: { PATH: '/usr/bin:/bin' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.on('error', () => rejectRun(
      new Error('absolute ssh-keygen tool is unavailable'),
    ))
    child.on('close', (code) => resolveRun({
      code,
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat(stderr),
    }))
    child.stdin.end(stdin ?? undefined)
  })
}

async function fingerprintPublicKey(publicKeyBytes) {
  const temporary = await mkdtemp(
    join(tmpdir(), 'owner-public-fingerprint-'),
  )
  try {
    const publicKeyPath = join(temporary, 'owner.pub')
    await writeFile(publicKeyPath, publicKeyBytes, { mode: 0o600 })
    const result = await spawnSshKeygen([
      '-lf',
      publicKeyPath,
      '-E',
      'sha256',
    ])
    requireCondition(
      result.code === 0
        && result.stderr.length === 0
        && result.stdout.toString('utf8')
          === `256 ${OWNER_KEY_FINGERPRINT} no comment (ED25519)\n`,
      'owner public key fingerprint verification failed',
    )
    return OWNER_KEY_FINGERPRINT
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

export async function assertProductionTrustArtifacts({
  trustAnchorPath,
  publicKeyPath,
  allowedSignersPath,
  now = new Date(),
}) {
  const [anchorBytes, publicKeyBytes, allowedSignersBytes] =
    await Promise.all([
      readRegularFile(trustAnchorPath, {
        label: 'owner trust anchor',
        maxBytes: MAX_JSON_BYTES,
        expectedBasename: 'owner-trust-anchor.json',
      }),
      readRegularFile(publicKeyPath, {
        label: 'owner public key',
        maxBytes: 4 * 1024,
        expectedBasename: 'phase-05-owner.pub',
      }),
      readRegularFile(allowedSignersPath, {
        label: 'owner allowed-signers',
        maxBytes: 4 * 1024,
        expectedBasename: 'phase-05-owner.allowed_signers.txt',
      }),
    ])
  let trustAnchor
  try {
    trustAnchor = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(anchorBytes),
    )
  } catch {
    throw new Error('owner trust anchor is not canonical JSON')
  }
  requireCondition(
    anchorBytes.equals(canonicalJsonBytes(trustAnchor)),
    'owner trust anchor is not canonical JSON',
  )
  assertTrustAnchorValue(trustAnchor, { now })
  requireCondition(
    publicKeyBytes.equals(Buffer.from(`${OWNER_PUBLIC_KEY_LINE}\n`)),
    'owner public key bytes drift',
  )
  requireCondition(
    allowedSignersBytes.equals(
      Buffer.from(`${OWNER_ALLOWED_SIGNERS_LINE}\n`),
    ),
    'owner allowed-signers bytes drift',
  )
  const fingerprint = await fingerprintPublicKey(publicKeyBytes)
  return Object.freeze({
    trustAnchor,
    publicKeyBytes,
    allowedSignersBytes,
    principal: OWNER_AUTHORIZATION_PRINCIPAL,
    namespace: OWNER_AUTHORIZATION_NAMESPACE,
    fingerprint,
    github_signing_key_record_id: OWNER_GITHUB_RECORD_ID,
    not_before: OWNER_NOT_BEFORE,
    status: trustAnchor.status,
    revoked_at: trustAnchor.revoked_at,
  })
}

export function assertCanonicalSshsigBytes(signatureBytes) {
  requireCondition(
    Buffer.isBuffer(signatureBytes)
      && signatureBytes.length > 0
      && signatureBytes.length <= MAX_SIGNATURE_BYTES,
    'signature is not one canonical SSHSIG document',
  )
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(signatureBytes)
  } catch {
    throw new Error('signature is not one canonical SSHSIG document')
  }
  const canonical =
    /^-----BEGIN SSH SIGNATURE-----\n(?:[A-Za-z0-9+/=]+\n)+-----END SSH SIGNATURE-----\n$/
  requireCondition(
    canonical.test(text),
    'signature is not one canonical SSHSIG document',
  )
  return signatureBytes
}

export async function verifyOwnerAuthorization({
  requestPath,
  signaturePath,
  trustAnchorPath,
  publicKeyPath,
  allowedSignersPath,
  now = new Date(),
}) {
  assertPathBasename(
    requestPath,
    '05-OWNER-AUTHORIZATION-REQUEST.json',
    'owner authorization request',
  )
  requireCondition(
    typeof signaturePath === 'string'
      && basename(signaturePath)
        === '05-OWNER-AUTHORIZATION-REQUEST.json.sig',
    'owner authorization signature path is not canonical',
  )
  const verifiedTrust = await assertProductionTrustArtifacts({
    trustAnchorPath,
    publicKeyPath,
    allowedSignersPath,
    now,
  })
  const [requestBytes, signatureBytes] = await Promise.all([
    readRegularFile(requestPath, {
      label: 'owner authorization request',
      maxBytes: MAX_JSON_BYTES,
      expectedBasename: basename(requestPath),
    }),
    readRegularFile(signaturePath, {
      label: 'owner authorization signature',
      maxBytes: MAX_SIGNATURE_BYTES,
      expectedBasename: basename(signaturePath),
    }),
  ])
  const request = parseOwnerAuthorizationRequest({
    requestBytes,
    trustAnchor: verifiedTrust.trustAnchor,
    now,
  })
  assertCanonicalSshsigBytes(signatureBytes)

  const temporary = await mkdtemp(join(tmpdir(), 'owner-sshsig-verify-'))
  try {
    const allowedPath = join(temporary, 'allowed_signers')
    const detachedPath = join(temporary, 'request.sig')
    await Promise.all([
      writeFile(allowedPath, verifiedTrust.allowedSignersBytes, {
        mode: 0o600,
      }),
      writeFile(detachedPath, signatureBytes, { mode: 0o600 }),
    ])
    const result = await spawnSshKeygen([
      '-Y',
      'verify',
      '-f',
      allowedPath,
      '-I',
      OWNER_AUTHORIZATION_PRINCIPAL,
      '-n',
      OWNER_AUTHORIZATION_NAMESPACE,
      '-s',
      detachedPath,
    ], { stdin: requestBytes })
    const expectedOutput =
      `Good "${OWNER_AUTHORIZATION_NAMESPACE}" signature for `
      + `${OWNER_AUTHORIZATION_PRINCIPAL} with ED25519 key `
      + `${OWNER_KEY_FINGERPRINT}\n`
    requireCondition(
      result.code === 0
        && result.stderr.length === 0
        && result.stdout.toString('utf8') === expectedOutput,
      'owner SSHSIG verification failed',
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }

  const verifiedAt = new Date(nowMs(now)).toISOString()
  return Object.freeze({
    status: 'OWNER_AUTHORIZATION_VERIFIED',
    authenticated: true,
    principal: OWNER_AUTHORIZATION_PRINCIPAL,
    namespace: OWNER_AUTHORIZATION_NAMESPACE,
    fingerprint: OWNER_KEY_FINGERPRINT,
    github_signing_key_record_id: OWNER_GITHUB_RECORD_ID,
    owner_authorization_request_sha256: sha256Bytes(requestBytes),
    owner_authorization_signature_sha256:
      sha256Bytes(signatureBytes),
    nonce_sha256: sha256Bytes(Buffer.from(request.nonce, 'utf8')),
    issued_at: request.issued_at,
    verified_at: verifiedAt,
    stopped_decision_payload_sha256:
      request.stopped_decision_payload_sha256,
    request,
  })
}

function parseArgs(argv) {
  const commands = new Map([
    ['--create-request', 'createRequest'],
    ['--assert-request', 'assertRequest'],
    ['--verify-authorization', 'verifyAuthorization'],
  ])
  const flags = new Map([
    ['--request', 'requestPath'],
    ['--signature', 'signaturePath'],
    ['--trust-anchor', 'trustAnchorPath'],
    ['--public-key', 'publicKeyPath'],
    ['--allowed-signers', 'allowedSignersPath'],
    ['--matrix', 'matrixPath'],
    ['--quality-report', 'qualityReportPath'],
    ['--owner-checkpoint', 'ownerCheckpointPath'],
    ['--baseline-record', 'baselinePath'],
    ['--reconciliation', 'reconciliationPath'],
  ])
  const parsed = { command: null }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (commands.has(argument)) {
      requireCondition(
        parsed.command === null,
        'choose exactly one owner authorization command',
      )
      parsed.command = commands.get(argument)
      continue
    }
    requireCondition(flags.has(argument), `unknown argument: ${argument}`)
    const value = argv[++index]
    requireCondition(
      value && !value.startsWith('--'),
      `${argument} requires a path`,
    )
    const key = flags.get(argument)
    requireCondition(parsed[key] === undefined, `duplicate ${argument}`)
    parsed[key] = value
  }
  requireCondition(
    parsed.command !== null,
    'choose exactly one owner authorization command',
  )
  const common = [
    ['requestPath', '--request'],
    ['trustAnchorPath', '--trust-anchor'],
  ]
  const evidenceFlags = [
    ['matrixPath', '--matrix'],
    ['qualityReportPath', '--quality-report'],
    ['ownerCheckpointPath', '--owner-checkpoint'],
    ['baselinePath', '--baseline-record'],
    ['reconciliationPath', '--reconciliation'],
  ]
  const verifyFlags = [
    ['signaturePath', '--signature'],
    ['publicKeyPath', '--public-key'],
    ['allowedSignersPath', '--allowed-signers'],
  ]
  for (const [key, flag] of common) {
    requireCondition(parsed[key], `${flag} is required`)
  }
  const required = parsed.command === 'verifyAuthorization'
    ? verifyFlags
    : evidenceFlags
  const forbidden = parsed.command === 'verifyAuthorization'
    ? evidenceFlags
    : verifyFlags
  for (const [key, flag] of required) {
    requireCondition(parsed[key], `${flag} is required`)
  }
  for (const [key, flag] of forbidden) {
    requireCondition(
      parsed[key] === undefined,
      `${flag} is not valid for this command`,
    )
  }
  return parsed
}

async function readJson(path, label) {
  let bytes
  try {
    bytes = await readFile(resolve(path))
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new Error(`${label} could not be read`)
  }
}

async function loadRequestInputs(args) {
  const [
    trustAnchor,
    matrix,
    qualityReport,
    ownerCheckpoint,
    baseline,
    reconciliation,
  ] = await Promise.all([
    readJson(args.trustAnchorPath, 'owner trust anchor'),
    readJson(args.matrixPath, 'rights matrix'),
    readJson(args.qualityReportPath, 'quality report'),
    readJson(args.ownerCheckpointPath, 'historical owner checkpoint'),
    readJson(args.baselinePath, 'execution baseline'),
    readJson(args.reconciliationPath, 'contract reconciliation'),
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

async function main(argv) {
  const args = parseArgs(argv)
  if (args.command === 'verifyAuthorization') {
    const result = await verifyOwnerAuthorization(args)
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }

  assertPathBasename(
    args.requestPath,
    '05-OWNER-AUTHORIZATION-REQUEST.json',
    'owner authorization request',
  )
  assertPathBasename(
    args.trustAnchorPath,
    'owner-trust-anchor.json',
    'owner trust anchor',
  )
  for (const [path, expected, label] of [
    [args.matrixPath, '05-RIGHTS-MATRIX.json', 'rights matrix'],
    [
      args.qualityReportPath,
      '05-QUALITY-REPORT.json',
      'quality report',
    ],
    [
      args.ownerCheckpointPath,
      '05-OWNER-CHECKPOINT.json',
      'historical owner checkpoint',
    ],
    [
      args.baselinePath,
      '05-EXECUTION-BASELINE.json',
      'execution baseline',
    ],
    [
      args.reconciliationPath,
      '05-CONTRACT-RECONCILIATION.json',
      'contract reconciliation',
    ],
  ]) assertPathBasename(path, expected, label)

  const inputs = await loadRequestInputs(args)
  if (args.command === 'createRequest') {
    const request = buildOwnerAuthorizationRequest(inputs)
    const bytes = canonicalJsonBytes(request)
    try {
      await writeFile(resolve(args.requestPath), bytes, {
        flag: 'wx',
        mode: 0o644,
      })
    } catch {
      throw new Error(
        'owner authorization request already exists or cannot be created',
      )
    }
    const reopened = await readFile(resolve(args.requestPath))
    requireCondition(
      reopened.equals(bytes),
      'owner authorization request write verification failed',
    )
    assertOwnerAuthorizationRequest({
      requestBytes: reopened,
      ...inputs,
    })
    process.stdout.write('OWNER_AUTHORIZATION_REQUEST_CREATED\n')
    return
  }

  const requestBytes = await readFile(resolve(args.requestPath))
  const request = assertOwnerAuthorizationRequest({
    requestBytes,
    ...inputs,
  })
  process.stdout.write(`${JSON.stringify({
    status: 'OWNER_AUTHORIZATION_REQUEST_VALID',
    principal: request.principal,
    namespace: request.namespace,
    fingerprint: request.ssh_signing_key_fingerprint,
    request_sha256: sha256Bytes(requestBytes),
  }, null, 2)}\n`)
}

const isMainModule = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url

if (isMainModule) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `${error instanceof Error
        ? error.message
        : 'owner authorization failed'}\n`,
    )
    process.exitCode = 1
  })
}

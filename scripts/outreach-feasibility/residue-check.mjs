#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { constants as FS_CONSTANTS } from 'node:fs'
import {
  lstat,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import {
  isAbsolute,
  join,
  parse,
  posix,
  resolve,
} from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual, promisify } from 'node:util'
import {
  assertAuthenticatedAcceptedEvidence,
  assertAuthenticatedAcceptedV3Lineage,
  assertArtifactSchema,
  assertExecutionBaseline,
  assertImmutableZeroResidueV3Lineage,
  assertPhase5ReviewLifecycle,
  assertPublishableZeroResidueRecord,
  assertZeroResidueRecord,
  requireCanonicalUtcTimestamp,
} from './evidence-integrity.mjs'
import {
  assertCanonicalSshsigBytes,
  canonicalJsonBytes,
} from './owner-authorization.mjs'
import { sha256Json } from './rights-gate.mjs'

const execFileAsync = promisify(execFile)
const PHASE_DIR_RELATIVE =
  '.planning/phases/05-outreach-feasibility-gate'
const SCRIPT_ROOT_RELATIVE = 'scripts/outreach-feasibility'
const VERIFICATION_PATH =
  `${PHASE_DIR_RELATIVE}/05-VERIFICATION.md`
const OWNER_AUTHORIZATION_REQUEST_PATH =
  `${PHASE_DIR_RELATIVE}/05-OWNER-AUTHORIZATION-REQUEST.json`
const OWNER_AUTHORIZATION_SIGNATURE_PATH =
  `${OWNER_AUTHORIZATION_REQUEST_PATH}.sig`
const OWNER_TRUST_ANCHOR_PATH =
  `${SCRIPT_ROOT_RELATIVE}/trust/owner-trust-anchor.json`
const OWNER_PUBLIC_KEY_PATH =
  `${SCRIPT_ROOT_RELATIVE}/trust/phase-05-owner.pub`
const OWNER_ALLOWED_SIGNERS_PATH =
  `${SCRIPT_ROOT_RELATIVE}/trust/phase-05-owner.allowed_signers.txt`
const AUTHENTICATED_REBIND_PATHS = Object.freeze([
  `${PHASE_DIR_RELATIVE}/05-CONTRACT-RECONCILIATION.json`,
  `${PHASE_DIR_RELATIVE}/05-DECISION.json`,
  `${PHASE_DIR_RELATIVE}/05-ZERO-RESIDUE.json`,
].sort())
const AUTHENTICATED_LINEAGE_PROOF_PATHS = Object.freeze([
  OWNER_AUTHORIZATION_REQUEST_PATH,
  OWNER_AUTHORIZATION_SIGNATURE_PATH,
  OWNER_TRUST_ANCHOR_PATH,
  OWNER_PUBLIC_KEY_PATH,
  OWNER_ALLOWED_SIGNERS_PATH,
])
const MAX_AUTHENTICATED_LINEAGE_DEPTH = 16
const SCANNED_ROOTS = Object.freeze([
  'scripts/outreach-feasibility/',
  '.planning/phases/05-outreach-feasibility-gate/*.json',
])
const SOURCE_TREE_PATHSPECS = Object.freeze([
  SCRIPT_ROOT_RELATIVE,
  PHASE_DIR_RELATIVE,
])
const CURRENT_PATHSPECS = Object.freeze([
  SCRIPT_ROOT_RELATIVE,
  `:(glob)${PHASE_DIR_RELATIVE}/*.json`,
  OWNER_AUTHORIZATION_SIGNATURE_PATH,
  VERIFICATION_PATH,
])
const ALLOWED_SOURCE_PATHS = new Set([
  'scripts/outreach-feasibility/rights-gate.mjs',
  'scripts/outreach-feasibility/rights-gate.test.mjs',
  'scripts/outreach-feasibility/authorization-evidence-validators.mjs',
  'scripts/outreach-feasibility/decision-evidence.mjs',
  'scripts/outreach-feasibility/decision-evidence.test.mjs',
  'scripts/outreach-feasibility/residue-check.mjs',
  'scripts/outreach-feasibility/residue-check.test.mjs',
  'scripts/outreach-feasibility/evidence-integrity.mjs',
  'scripts/outreach-feasibility/evidence-integrity.test.mjs',
  'scripts/outreach-feasibility/owner-checkpoint.mjs',
  'scripts/outreach-feasibility/owner-checkpoint.test.mjs',
  'scripts/outreach-feasibility/owner-authorization.mjs',
  'scripts/outreach-feasibility/owner-authorization.test.mjs',
  'scripts/outreach-feasibility/terminal-audit.mjs',
  'scripts/outreach-feasibility/terminal-audit.test.mjs',
  'scripts/outreach-feasibility/adversarial-regression.test.mjs',
  'scripts/outreach-feasibility/dormant/spike-runner.mjs',
  'scripts/outreach-feasibility/dormant/spike-runner.test.mjs',
  'scripts/outreach-feasibility/dormant/quality-evaluator.mjs',
  'scripts/outreach-feasibility/dormant/quality-evaluator.test.mjs',
  'scripts/outreach-feasibility/dormant/sanitize-report.mjs',
  OWNER_TRUST_ANCHOR_PATH,
  OWNER_PUBLIC_KEY_PATH,
  OWNER_ALLOWED_SIGNERS_PATH,
])
const ALLOWED_SOURCE_DIRECTORIES = new Set([
  SCRIPT_ROOT_RELATIVE,
  `${SCRIPT_ROOT_RELATIVE}/dormant`,
  `${SCRIPT_ROOT_RELATIVE}/trust`,
])
const ALLOWED_JSON_PATHS = new Set([
  `${PHASE_DIR_RELATIVE}/05-RIGHTS-MATRIX.json`,
  `${PHASE_DIR_RELATIVE}/05-QUALITY-REPORT.json`,
  `${PHASE_DIR_RELATIVE}/05-DECISION.json`,
  `${PHASE_DIR_RELATIVE}/05-ZERO-RESIDUE.json`,
  `${PHASE_DIR_RELATIVE}/05-EXECUTION-BASELINE.json`,
  `${PHASE_DIR_RELATIVE}/05-OWNER-CHECKPOINT-REQUEST.json`,
  `${PHASE_DIR_RELATIVE}/05-OWNER-CHECKPOINT.json`,
  `${PHASE_DIR_RELATIVE}/05-CONTRACT-RECONCILIATION.json`,
])
const PUBLIC_AUTHORIZATION_JSON_PATHS = new Set([
  OWNER_AUTHORIZATION_REQUEST_PATH,
])
const LEGACY_ADMINISTRATIVE_TAIL_PATHS = Object.freeze([
  `${PHASE_DIR_RELATIVE}/05-DECISION.json`,
  `${PHASE_DIR_RELATIVE}/05-ZERO-RESIDUE.json`,
  `${PHASE_DIR_RELATIVE}/05-CONTRACT-RECONCILIATION.json`,
  `${PHASE_DIR_RELATIVE}/05-09-SUMMARY.md`,
  `${PHASE_DIR_RELATIVE}/05-REVIEW.md`,
  VERIFICATION_PATH,
  '.planning/ROADMAP.md',
  '.planning/REQUIREMENTS.md',
  '.planning/STATE.md',
])
const STATIC_ADMINISTRATIVE_TAIL_PATHS = Object.freeze([
  `${PHASE_DIR_RELATIVE}/05-DECISION.json`,
  `${PHASE_DIR_RELATIVE}/05-ZERO-RESIDUE.json`,
  `${PHASE_DIR_RELATIVE}/05-CONTRACT-RECONCILIATION.json`,
  `${PHASE_DIR_RELATIVE}/05-REVIEW.md`,
  VERIFICATION_PATH,
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
const PHASE_PLAN_OR_SUMMARY =
  /^\.planning\/phases\/05-outreach-feasibility-gate\/05-(\d{2})-(PLAN|SUMMARY)\.md$/
const EFFECT_COUNTERS = new Set([
  'provider_call_count',
  'fixture_count',
  'raw_result_count',
  'production_mutation_count',
])
const FORBIDDEN_JSON_KEYS = new Set([
  'apikey',
  'secret',
  'accesstoken',
  'authorization',
  'providerpayload',
  'providerresponse',
  'rawresponse',
  'rawresult',
  'candidatename',
  'candidateprofile',
  'profileurl',
  'linkedinurl',
  'sourcesnippet',
  'query',
  'rolefacts',
  'resume',
  'trackernotes',
  'fulljobdescription',
])
const SOURCE_TOKEN_PATTERNS = Object.freeze([
  /\btvly-[A-Za-z0-9_-]{8,}\b/g,
  /\b(?:sk|pk)_[A-Za-z0-9_-]{16,}\b/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /\bBearer\s+[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /https?:\/\/(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9%._~!$&'()*+,;=:@/-]+/g,
  /\bresults\s*:\s*\[[\s\S]{0,800}?\bname\s*:[\s\S]{0,300}?\btitle\s*:[\s\S]{0,300}?\burl\s*:[\s\S]{0,300}?\bcontent\s*:/g,
  /["']results["']\s*:\s*\[[\s\S]{0,800}?["']name["']\s*:[\s\S]{0,300}?["']title["']\s*:[\s\S]{0,300}?["']url["']\s*:[\s\S]{0,300}?["']content["']\s*:/g,
])
const ALLOWED_SOURCE_TOKEN_DIGESTS = new Map([
  ['scripts/outreach-feasibility/residue-check.test.mjs', new Set([
    // Exact synthetic tokens used only to prove rejection on another path.
    '432b7436d9d213319077b20ba22907fd9580974b39bb9c89f632808d7b51c825',
    '5b245b2425d4f9dcaab9171adb16feeb79ee955847514ee2530d126b16da99f1',
    '409f0212c48a1d28f4aeb4f591abb0f4ce1e8075eee2f0497b01fd27e89e2857',
  ])],
])
const EXACT_HISTORICAL_JSON_STATES = new Map([
  [`${PHASE_DIR_RELATIVE}/05-DECISION.json`, new Set([
    // The exact pre-schema placeholder committed before Plan 05-01 finalized
    // the decision contract. No other empty or schema-less artifact is valid.
    'ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356',
  ])],
])
const SHA = /^[0-9a-f]{40}$/
const OBJECT_ID = /^[0-9a-f]{40,64}$/
const SHA256 = /^[0-9a-f]{64}$/
const MAX_FILE_BYTES = 1_000_000
const MAX_GIT_BUFFER = 40_000_000
const DISALLOWED_TEXT_CONTROLS =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/
const PATH_CONTROLS = /[\u0000-\u001f\u007f-\u009f]/
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
const ACCEPTED_PAIR_LOCK_BASENAME = '.05-accepted-evidence.lock'
const ACCEPTED_PAIR_JOURNAL_BASENAME =
  '.05-accepted-evidence.journal.json'
const ACCEPTED_PAIR_DECISION_BASENAME = '05-DECISION.json'
const ACCEPTED_PAIR_RECORD_BASENAME = '05-ZERO-RESIDUE.json'
const ACCEPTED_PAIR_LOCK_TIMEOUT_MS = 2_000
const ACCEPTED_PAIR_LOCK_POLL_MS = 20
const ACCEPTED_PAIR_MAX_STATE_BYTES = 32_768
const TRANSACTION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const ACCEPTED_PAIR_LOCK_TOKEN = Symbol('accepted-pair-lock-token')
const LOCK_KEYS = Object.freeze([
  'schema_version',
  'pid',
  'transaction_id',
  'created_at',
])
const PRIOR_KEYS = Object.freeze([
  'exists',
  'mode',
  'sha256',
])
const JOURNAL_KEYS = Object.freeze([
  'schema_version',
  'transaction_id',
  'state',
  'decision_basename',
  'record_basename',
  'prior_decision',
  'prior_record',
  'next_decision_sha256',
  'next_record_sha256',
  'decision_stage_basename',
  'record_stage_basename',
  'decision_backup_basename',
  'record_backup_basename',
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

function requireExactKeys(value, keys, label) {
  requireCondition(isPlainObject(value), `${label} must be an object`)
  const expected = new Set(keys)
  for (const key of Object.keys(value)) {
    requireCondition(expected.has(key), `${label} has unknown field`)
  }
  for (const key of keys) {
    requireCondition(Object.hasOwn(value, key), `${label} is missing field`)
  }
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function acceptedPairNames(transactionId) {
  requireCondition(
    typeof transactionId === 'string'
      && TRANSACTION_ID.test(transactionId),
    'accepted evidence transaction ID is malformed',
  )
  return {
    decisionStage:
      `.${ACCEPTED_PAIR_DECISION_BASENAME}.${transactionId}.stage`,
    recordStage:
      `.${ACCEPTED_PAIR_RECORD_BASENAME}.${transactionId}.stage`,
    decisionBackup:
      `.${ACCEPTED_PAIR_DECISION_BASENAME}.${transactionId}.backup`,
    recordBackup:
      `.${ACCEPTED_PAIR_RECORD_BASENAME}.${transactionId}.backup`,
    decisionRestore:
      `.${ACCEPTED_PAIR_DECISION_BASENAME}.${transactionId}.restore`,
    recordRestore:
      `.${ACCEPTED_PAIR_RECORD_BASENAME}.${transactionId}.restore`,
    journalPrepared:
      `${ACCEPTED_PAIR_JOURNAL_BASENAME}.${transactionId}.prepared.stage`,
    journalRecordPublished:
      `${ACCEPTED_PAIR_JOURNAL_BASENAME}.${transactionId}.record-published.stage`,
    journalCommitted:
      `${ACCEPTED_PAIR_JOURNAL_BASENAME}.${transactionId}.committed.stage`,
  }
}

async function canonicalAcceptedPairPaths(decisionPath, recordPath) {
  requireCondition(
    typeof decisionPath === 'string' && decisionPath.length > 0
      && typeof recordPath === 'string' && recordPath.length > 0,
    'accepted evidence paths are required',
  )
  const requestedDecision = resolve(decisionPath)
  const requestedRecord = resolve(recordPath)
  const requestedDirectory = resolve(requestedDecision, '..')
  requireCondition(
    resolve(requestedRecord, '..') === requestedDirectory,
    'accepted evidence outputs must share one directory',
  )
  requireCondition(
    requestedDecision !== requestedRecord,
    'accepted evidence output paths must be distinct',
  )
  requireCondition(
    posix.basename(requestedDecision) === ACCEPTED_PAIR_DECISION_BASENAME
      && posix.basename(requestedRecord) === ACCEPTED_PAIR_RECORD_BASENAME,
    'accepted evidence outputs must use canonical basenames',
  )
  const requestedDirectoryMetadata = await lstatOptional(requestedDirectory)
  requireCondition(
    requestedDirectoryMetadata?.isDirectory()
      && !requestedDirectoryMetadata.isSymbolicLink(),
    'accepted evidence parent directory substitution is forbidden',
  )
  if (typeof process.getuid === 'function') {
    requireCondition(
      requestedDirectoryMetadata.uid === process.getuid(),
      'accepted evidence parent directory ownership is invalid',
    )
  }
  let canonicalDirectory
  try {
    canonicalDirectory = await realpath(requestedDirectory)
  } catch {
    throw new Error('accepted evidence parent directory is invalid')
  }
  const decision = resolve(
    canonicalDirectory,
    ACCEPTED_PAIR_DECISION_BASENAME,
  )
  const record = resolve(
    canonicalDirectory,
    ACCEPTED_PAIR_RECORD_BASENAME,
  )
  const directory = canonicalDirectory
  return {
    decisionPath: decision,
    recordPath: record,
    directory,
    lockPath: resolve(directory, ACCEPTED_PAIR_LOCK_BASENAME),
    journalPath: resolve(directory, ACCEPTED_PAIR_JOURNAL_BASENAME),
  }
}

async function lstatOptional(path) {
  try {
    return await lstat(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function assertRestrictiveRegular(metadata, label, {
  exactMode = null,
} = {}) {
  requireCondition(
    metadata !== null
      && metadata.isFile()
      && !metadata.isSymbolicLink(),
    `${label} must be a regular file and must not be a symlink`,
  )
  requireCondition(
    metadata.nlink === 1,
    `${label} must have exactly one link`,
  )
  if (typeof process.getuid === 'function') {
    requireCondition(
      metadata.uid === process.getuid(),
      `${label} ownership is invalid`,
    )
  }
  if (exactMode !== null) {
    requireCondition(
      (metadata.mode & 0o777) === exactMode,
      `${label} mode is invalid`,
    )
  }
}

async function readRegularBytes(path, label, {
  maxBytes = ACCEPTED_PAIR_MAX_STATE_BYTES,
  exactMode = null,
  allowUnlinkedRace = false,
} = {}) {
  const metadata = await lstatOptional(path)
  if (allowUnlinkedRace && metadata === null) return null
  assertRestrictiveRegular(metadata, label, { exactMode })
  requireCondition(metadata.size <= maxBytes, `${label} is too large`)
  let handle
  try {
    handle = await open(
      path,
      FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW,
    )
    const opened = await handle.stat()
    if (
      allowUnlinkedRace
      && metadata.nlink === 1
      && opened.nlink === 0
      && opened.dev === metadata.dev
      && opened.ino === metadata.ino
    ) return null
    assertRestrictiveRegular(opened, label, { exactMode })
    requireCondition(
      opened.dev === metadata.dev && opened.ino === metadata.ino,
      `${label} changed during validation`,
    )
    return await handle.readFile()
  } catch (error) {
    if (allowUnlinkedRace && error?.code === 'ENOENT') return null
    throw error
  } finally {
    await handle?.close()
  }
}

async function writeExclusiveDurable(path, bytes, mode, label, boundary) {
  let handle
  try {
    handle = await open(
      path,
      FS_CONSTANTS.O_WRONLY
        | FS_CONSTANTS.O_CREAT
        | FS_CONSTANTS.O_EXCL
        | FS_CONSTANTS.O_NOFOLLOW,
      mode,
    )
    await handle.writeFile(bytes)
    await handle.chmod(mode)
    await handle.sync()
    if (boundary) await boundary()
  } finally {
    await handle?.close()
  }
}

async function syncAcceptedPairDirectory(directory, boundary) {
  const handle = await open(directory, 'r')
  try {
    await handle.sync()
    if (boundary) await boundary()
  } finally {
    await handle.close()
  }
}

function parseFiniteJson(bytes, label) {
  let value
  try {
    value = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    )
  } catch {
    throw new Error(`${label} is malformed`)
  }
  requireCondition(isPlainObject(value), `${label} must be an object`)
  return value
}

function requireExactObjectKeys(value, keys, label) {
  requireCondition(isPlainObject(value), `${label} must be an object`)
  requireCondition(
    isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort()),
    `${label} has missing or unknown fields`,
  )
}

function validateAcceptedPairLock(value) {
  requireExactObjectKeys(value, LOCK_KEYS, 'accepted evidence lock')
  requireCondition(
    value.schema_version === 1
      && Number.isSafeInteger(value.pid)
      && value.pid > 0
      && value.pid <= 2_147_483_647
      && typeof value.transaction_id === 'string'
      && TRANSACTION_ID.test(value.transaction_id)
      && typeof value.created_at === 'string'
      && Number.isFinite(Date.parse(value.created_at)),
    'accepted evidence lock is malformed',
  )
  return value
}

async function readAcceptedPairLock(paths, {
  allowUnlinkedRace = false,
} = {}) {
  const bytes = await readRegularBytes(
    paths.lockPath,
    'accepted evidence lock',
    { exactMode: 0o600, allowUnlinkedRace },
  )
  if (bytes === null) return null
  return {
    bytes,
    value: validateAcceptedPairLock(
      parseFiniteJson(bytes, 'accepted evidence lock'),
    ),
  }
}

function processLiveness(pid) {
  if (pid === process.pid) return 'alive'
  try {
    process.kill(pid, 0)
    return 'alive'
  } catch (error) {
    if (error?.code === 'ESRCH') return 'dead'
    throw new Error('accepted evidence lock owner liveness is ambiguous')
  }
}

function sleep(milliseconds) {
  return new Promise((resolveSleep) =>
    setTimeout(resolveSleep, milliseconds))
}

async function acquireAcceptedPairLock(paths, {
  lockTimeoutMs = ACCEPTED_PAIR_LOCK_TIMEOUT_MS,
  onBoundary,
} = {}) {
  requireCondition(
    Number.isSafeInteger(lockTimeoutMs)
      && lockTimeoutMs >= 0
      && lockTimeoutMs <= 30_000,
    'accepted evidence lock timeout is invalid',
  )
  const deadline = Date.now() + lockTimeoutMs
  let abandonedTransactionId = null
  while (true) {
    const transactionId = randomUUID()
    const value = {
      schema_version: 1,
      pid: process.pid,
      transaction_id: transactionId,
      created_at: new Date().toISOString(),
    }
    const bytes = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8')
    try {
      await writeExclusiveDurable(
        paths.lockPath,
        bytes,
        0o600,
        'accepted evidence lock',
        () => onBoundary?.('lock_file_fsync'),
      )
      await syncAcceptedPairDirectory(
        paths.directory,
        () => onBoundary?.('lock_directory_fsync'),
      )
      return Object.freeze({
        [ACCEPTED_PAIR_LOCK_TOKEN]: true,
        ...paths,
        transactionId,
        abandonedTransactionId,
      })
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
    }

    const observed = await readAcceptedPairLock(paths, {
      allowUnlinkedRace: true,
    })
    if (observed === null) continue
    if (processLiveness(observed.value.pid) === 'alive') {
      if (Date.now() >= deadline) {
        throw new Error('accepted evidence lock is active; timeout reached')
      }
      await sleep(Math.min(
        ACCEPTED_PAIR_LOCK_POLL_MS,
        Math.max(1, deadline - Date.now()),
      ))
      continue
    }

    const confirmed = await readAcceptedPairLock(paths, {
      allowUnlinkedRace: true,
    })
    if (confirmed === null) continue
    requireCondition(
      confirmed.bytes.equals(observed.bytes),
      'accepted evidence abandoned lock changed during validation',
    )
    abandonedTransactionId = confirmed.value.transaction_id
    await rm(paths.lockPath)
    await syncAcceptedPairDirectory(paths.directory)
  }
}

function assertAcceptedPairLockToken(token, paths) {
  requireCondition(
    token?.[ACCEPTED_PAIR_LOCK_TOKEN] === true
      && token.decisionPath === paths.decisionPath
      && token.recordPath === paths.recordPath
      && token.directory === paths.directory
      && token.lockPath === paths.lockPath
      && token.journalPath === paths.journalPath,
    'accepted evidence lock token is invalid',
  )
}

async function releaseAcceptedPairLock(token, onBoundary) {
  const lock = await readAcceptedPairLock(token)
  requireCondition(
    lock.value.pid === process.pid
      && lock.value.transaction_id === token.transactionId,
    'accepted evidence lock ownership changed before release',
  )
  await rm(token.lockPath)
  await onBoundary?.('lock_cleanup_unlink')
  await syncAcceptedPairDirectory(
    token.directory,
    () => onBoundary?.('lock_cleanup_directory_fsync'),
  )
}

export async function withAcceptedEvidencePairLock({
  decisionPath,
  recordPath,
  lockTimeoutMs = ACCEPTED_PAIR_LOCK_TIMEOUT_MS,
  onBoundary,
}, callback) {
  requireCondition(
    typeof callback === 'function',
    'accepted evidence lock callback is required',
  )
  const paths = await canonicalAcceptedPairPaths(decisionPath, recordPath)
  const token = await acquireAcceptedPairLock(paths, {
    lockTimeoutMs,
    onBoundary,
  })
  let callbackError = null
  try {
    return await callback(token)
  } catch (error) {
    callbackError = error
    throw error
  } finally {
    try {
      await releaseAcceptedPairLock(token, onBoundary)
    } catch (releaseError) {
      if (callbackError) {
        throw new AggregateError(
          [callbackError, releaseError],
          'accepted evidence operation and lock release both failed',
        )
      }
      throw releaseError
    }
  }
}

function validatePriorDescriptor(value, label) {
  requireExactObjectKeys(value, PRIOR_KEYS, label)
  requireCondition(typeof value.exists === 'boolean', `${label} is malformed`)
  if (value.exists) {
    requireCondition(
      Number.isSafeInteger(value.mode)
        && value.mode >= 0
        && value.mode <= 0o777
        && typeof value.sha256 === 'string'
        && SHA256.test(value.sha256),
      `${label} is malformed`,
    )
  } else {
    requireCondition(
      value.mode === null && value.sha256 === null,
      `${label} absence is malformed`,
    )
  }
}

function validateTransactionBasename(value, expected, label) {
  requireCondition(
    typeof value === 'string'
      && value === expected
      && !value.includes('/')
      && !value.includes('\\')
      && !PATH_CONTROLS.test(value),
    `${label} is invalid`,
  )
}

function validateAcceptedPairJournal(value, paths) {
  requireExactObjectKeys(value, JOURNAL_KEYS, 'accepted evidence journal')
  requireCondition(
    value.schema_version === 1
      && typeof value.transaction_id === 'string'
      && TRANSACTION_ID.test(value.transaction_id)
      && ['prepared', 'record-published', 'committed'].includes(value.state),
    'accepted evidence journal is malformed',
  )
  const names = acceptedPairNames(value.transaction_id)
  validateTransactionBasename(
    value.decision_basename,
    ACCEPTED_PAIR_DECISION_BASENAME,
    'accepted decision basename',
  )
  validateTransactionBasename(
    value.record_basename,
    ACCEPTED_PAIR_RECORD_BASENAME,
    'accepted residue basename',
  )
  validateTransactionBasename(
    value.decision_stage_basename,
    names.decisionStage,
    'accepted decision stage basename',
  )
  validateTransactionBasename(
    value.record_stage_basename,
    names.recordStage,
    'accepted residue stage basename',
  )
  validateTransactionBasename(
    value.decision_backup_basename,
    names.decisionBackup,
    'accepted decision backup basename',
  )
  validateTransactionBasename(
    value.record_backup_basename,
    names.recordBackup,
    'accepted residue backup basename',
  )
  validatePriorDescriptor(value.prior_decision, 'prior accepted decision')
  validatePriorDescriptor(value.prior_record, 'prior accepted residue')
  requireCondition(
    SHA256.test(value.next_decision_sha256)
      && SHA256.test(value.next_record_sha256),
    'accepted evidence journal next digests are malformed',
  )
  for (const basename of [
    value.decision_basename,
    value.record_basename,
    value.decision_stage_basename,
    value.record_stage_basename,
    value.decision_backup_basename,
    value.record_backup_basename,
  ]) {
    requireCondition(
      resolve(paths.directory, basename)
        === `${paths.directory}/${basename}`,
      'accepted evidence journal path escapes its directory',
    )
  }
  return { value, names }
}

async function readAcceptedPairJournal(paths) {
  const metadata = await lstatOptional(paths.journalPath)
  if (metadata === null) return null
  const bytes = await readRegularBytes(
    paths.journalPath,
    'accepted evidence journal',
    { exactMode: 0o600 },
  )
  return validateAcceptedPairJournal(
    parseFiniteJson(bytes, 'accepted evidence journal'),
    paths,
  )
}

async function captureAcceptedDestination(path, label) {
  const metadata = await lstatOptional(path)
  if (metadata === null) {
    return {
      exists: false,
      mode: null,
      sha256: null,
      bytes: null,
    }
  }
  const bytes = await readRegularBytes(path, label, {
    maxBytes: MAX_FILE_BYTES,
  })
  return {
    exists: true,
    mode: metadata.mode & 0o777,
    sha256: sha256Bytes(bytes),
    bytes,
  }
}

function journalDescriptor(destination) {
  return {
    exists: destination.exists,
    mode: destination.mode,
    sha256: destination.sha256,
  }
}

function transactionPath(paths, basename) {
  return resolve(paths.directory, basename)
}

async function assertOptionalTransactionRegular(path, label) {
  const metadata = await lstatOptional(path)
  if (metadata === null) return null
  assertRestrictiveRegular(metadata, label, { exactMode: 0o600 })
  return metadata
}

async function removeTransactionPath(path, directory, boundaries = {}) {
  const metadata = await lstatOptional(path)
  if (metadata === null) return false
  assertRestrictiveRegular(metadata, 'accepted evidence transaction file', {
    exactMode: 0o600,
  })
  await rm(path)
  await boundaries.afterUnlink?.()
  await syncAcceptedPairDirectory(directory, boundaries.afterSync)
  return true
}

function allTransactionPaths(paths, transactionId) {
  const names = acceptedPairNames(transactionId)
  return [
    names.decisionStage,
    names.recordStage,
    names.decisionBackup,
    names.recordBackup,
    names.decisionRestore,
    names.recordRestore,
    names.journalPrepared,
    names.journalRecordPublished,
    names.journalCommitted,
  ].map((name) => transactionPath(paths, name))
}

async function cleanPreJournalAbandonment(paths, transactionId) {
  if (!transactionId) return
  for (const path of allTransactionPaths(paths, transactionId)) {
    await removeTransactionPath(path, paths.directory)
  }
}

async function assertNoUnexpectedTransactionState(paths) {
  const children = await readdir(paths.directory)
  const reserved = children.filter((name) => (
    name.startsWith(`.${ACCEPTED_PAIR_DECISION_BASENAME}.`)
    || name.startsWith(`.${ACCEPTED_PAIR_RECORD_BASENAME}.`)
    || name.startsWith(`.${ACCEPTED_PAIR_JOURNAL_BASENAME}.`)
  ))
  requireCondition(
    reserved.length === 0,
    'accepted evidence transaction state is ambiguous',
  )
}

function assertAcceptedPairBinding(decision, record) {
  requireCondition(
    isPlainObject(decision) && isPlainObject(record),
    'accepted evidence pair must contain JSON objects',
  )
  if (
    Object.hasOwn(decision, 'decision_contract_sha256')
    || Object.hasOwn(record, 'decision_contract_sha256')
  ) {
    requireCondition(
      decision.decision_contract_sha256
        === record.decision_contract_sha256,
      'accepted evidence decision binding is split',
    )
  }
  if (
    Object.hasOwn(decision, 'zero_residue_sha256')
    || Object.hasOwn(record, 'zero_residue_sha256')
  ) {
    requireCondition(
      decision.zero_residue_sha256 === record.zero_residue_sha256,
      'accepted evidence residue binding is split',
    )
  }
}

function parseAcceptedPairBytes(decisionBytes, recordBytes) {
  const decision = parseFiniteJson(
    decisionBytes,
    'accepted decision artifact',
  )
  const record = parseFiniteJson(
    recordBytes,
    'accepted residue artifact',
  )
  assertAcceptedPairBinding(decision, record)
  return { decision, record }
}

async function readCanonicalAcceptedPair(paths, {
  allowMissingPair = false,
} = {}) {
  const [decisionMetadata, recordMetadata] = await Promise.all([
    lstatOptional(paths.decisionPath),
    lstatOptional(paths.recordPath),
  ])
  if (decisionMetadata === null && recordMetadata === null) {
    requireCondition(
      allowMissingPair,
      'accepted evidence pair is missing',
    )
    return null
  }
  requireCondition(
    decisionMetadata !== null && recordMetadata !== null,
    'accepted evidence pair is incomplete',
  )
  const [decisionBytes, recordBytes] = await Promise.all([
    readRegularBytes(
      paths.decisionPath,
      'accepted decision artifact',
      { maxBytes: MAX_FILE_BYTES },
    ),
    readRegularBytes(
      paths.recordPath,
      'accepted residue artifact',
      { maxBytes: MAX_FILE_BYTES },
    ),
  ])
  return {
    ...parseAcceptedPairBytes(decisionBytes, recordBytes),
    decisionBytes,
    recordBytes,
  }
}

async function restorePriorDestination({
  paths,
  canonicalPath,
  prior,
  nextSha256,
  backupBasename,
  restoreBasename,
  label,
}) {
  const current = await captureAcceptedDestination(canonicalPath, label)
  if (!prior.exists) {
    requireCondition(
      !current.exists
        || current.sha256 === nextSha256,
      `${label} recovery state is ambiguous`,
    )
    if (current.exists) {
      await rm(canonicalPath)
      await syncAcceptedPairDirectory(paths.directory)
    }
    return
  }
  const backupPath = transactionPath(paths, backupBasename)
  const backupBytes = await readRegularBytes(
    backupPath,
    `${label} recovery backup`,
    { maxBytes: MAX_FILE_BYTES, exactMode: 0o600 },
  )
  requireCondition(
    sha256Bytes(backupBytes) === prior.sha256,
    `${label} recovery backup digest drift`,
  )
  if (
    current.exists
    && current.sha256 === prior.sha256
    && current.mode === prior.mode
  ) return
  const restorePath = transactionPath(paths, restoreBasename)
  requireCondition(
    await lstatOptional(restorePath) === null,
    `${label} restore path is ambiguous`,
  )
  await writeExclusiveDurable(
    restorePath,
    backupBytes,
    prior.mode,
    `${label} restore`,
  )
  await syncAcceptedPairDirectory(paths.directory)
  await rename(restorePath, canonicalPath)
  await syncAcceptedPairDirectory(paths.directory)
}

async function verifyPriorPair(paths, journal) {
  for (const [path, prior, label] of [
    [paths.decisionPath, journal.prior_decision, 'accepted decision'],
    [paths.recordPath, journal.prior_record, 'accepted residue'],
  ]) {
    const current = await captureAcceptedDestination(path, label)
    requireCondition(
      current.exists === prior.exists
        && (!prior.exists || (
          current.sha256 === prior.sha256
          && current.mode === prior.mode
        )),
      `${label} prior generation was not restored`,
    )
  }
  if (journal.prior_decision.exists && journal.prior_record.exists) {
    await readCanonicalAcceptedPair(paths)
  }
}

async function cleanupRecoveredTransaction(paths, journal) {
  await removeTransactionPath(paths.journalPath, paths.directory)
  for (const path of allTransactionPaths(
    paths,
    journal.transaction_id,
  )) {
    await removeTransactionPath(path, paths.directory)
  }
}

async function recoverAcceptedEvidencePairLocked(paths, token) {
  assertAcceptedPairLockToken(token, paths)
  const parsed = await readAcceptedPairJournal(paths)
  if (parsed === null) {
    await cleanPreJournalAbandonment(
      paths,
      token.abandonedTransactionId,
    )
    await assertNoUnexpectedTransactionState(paths)
    return { recovered: false, generation: 'unchanged' }
  }
  const { value: journal, names } = parsed
  for (const [name, label] of [
    [names.decisionStage, 'accepted decision stage'],
    [names.recordStage, 'accepted residue stage'],
    [names.decisionBackup, 'accepted decision backup'],
    [names.recordBackup, 'accepted residue backup'],
    [names.decisionRestore, 'accepted decision restore'],
    [names.recordRestore, 'accepted residue restore'],
    [names.journalPrepared, 'accepted prepared journal stage'],
    [names.journalRecordPublished, 'accepted published journal stage'],
    [names.journalCommitted, 'accepted committed journal stage'],
  ]) {
    await assertOptionalTransactionRegular(
      transactionPath(paths, name),
      label,
    )
  }

  const [decision, record] = await Promise.all([
    captureAcceptedDestination(
      paths.decisionPath,
      'accepted decision artifact',
    ),
    captureAcceptedDestination(
      paths.recordPath,
      'accepted residue artifact',
    ),
  ])
  const completeNext = decision.exists
    && record.exists
    && decision.sha256 === journal.next_decision_sha256
    && record.sha256 === journal.next_record_sha256
  if (completeNext) {
    await readCanonicalAcceptedPair(paths)
    await cleanupRecoveredTransaction(paths, journal)
    return { recovered: true, generation: 'new' }
  }
  requireCondition(
    journal.state !== 'committed',
    'committed accepted evidence journal does not match canonical pair',
  )

  if (!journal.prior_decision.exists && decision.exists) {
    requireCondition(
      decision.sha256 === journal.next_decision_sha256,
      'accepted decision recovery state is ambiguous',
    )
  }
  if (!journal.prior_record.exists && record.exists) {
    requireCondition(
      record.sha256 === journal.next_record_sha256,
      'accepted residue recovery state is ambiguous',
    )
  }
  await restorePriorDestination({
    paths,
    canonicalPath: paths.recordPath,
    prior: journal.prior_record,
    nextSha256: journal.next_record_sha256,
    backupBasename: names.recordBackup,
    restoreBasename: names.recordRestore,
    label: 'accepted residue',
  })
  await restorePriorDestination({
    paths,
    canonicalPath: paths.decisionPath,
    prior: journal.prior_decision,
    nextSha256: journal.next_decision_sha256,
    backupBasename: names.decisionBackup,
    restoreBasename: names.decisionRestore,
    label: 'accepted decision',
  })
  await verifyPriorPair(paths, journal)
  await cleanupRecoveredTransaction(paths, journal)
  return { recovered: true, generation: 'prior' }
}

export async function recoverAcceptedEvidencePair({
  decisionPath,
  recordPath,
  lockTimeoutMs = ACCEPTED_PAIR_LOCK_TIMEOUT_MS,
  lockToken = null,
} = {}) {
  const paths = await canonicalAcceptedPairPaths(decisionPath, recordPath)
  if (lockToken) {
    return recoverAcceptedEvidencePairLocked(paths, lockToken)
  }
  return withAcceptedEvidencePairLock({
    decisionPath,
    recordPath,
    lockTimeoutMs,
  }, (token) => recoverAcceptedEvidencePairLocked(paths, token))
}

export async function readAcceptedEvidencePair({
  decisionPath,
  recordPath,
  lockTimeoutMs = ACCEPTED_PAIR_LOCK_TIMEOUT_MS,
  allowMissingPair = false,
} = {}) {
  const paths = await canonicalAcceptedPairPaths(decisionPath, recordPath)
  return withAcceptedEvidencePairLock({
    decisionPath,
    recordPath,
    lockTimeoutMs,
  }, async (token) => {
    await recoverAcceptedEvidencePairLocked(paths, token)
    const pair = await readCanonicalAcceptedPair(paths, {
      allowMissingPair,
    })
    if (pair === null) return null
    return {
      decision: pair.decision,
      record: pair.record,
    }
  })
}

async function writeJournalState(paths, journal, state, onBoundary) {
  const names = acceptedPairNames(journal.transaction_id)
  const stateKey = state === 'prepared'
    ? 'journalPrepared'
    : state === 'record-published'
      ? 'journalRecordPublished'
      : 'journalCommitted'
  const temporaryPath = transactionPath(paths, names[stateKey])
  const next = { ...journal, state }
  const bytes = Buffer.from(`${JSON.stringify(next)}\n`, 'utf8')
  await writeExclusiveDurable(
    temporaryPath,
    bytes,
    0o600,
    'accepted evidence journal stage',
    () => onBoundary?.(`journal_${state.replace('-', '_')}_file_fsync`),
  )
  await syncAcceptedPairDirectory(
    paths.directory,
    () => onBoundary?.(
      `journal_${state.replace('-', '_')}_temp_directory_fsync`
    ),
  )
  await rename(temporaryPath, paths.journalPath)
  await onBoundary?.(`journal_${state.replace('-', '_')}_rename`)
  await syncAcceptedPairDirectory(
    paths.directory,
    () => onBoundary?.(
      `journal_${state.replace('-', '_')}_directory_fsync`
    ),
  )
  return next
}

async function cleanupCommittedPublication(paths, journal, onBoundary) {
  await removeTransactionPath(paths.journalPath, paths.directory, {
    afterUnlink: () => onBoundary?.('cleanup_journal_unlink'),
    afterSync: () => onBoundary?.('cleanup_journal_directory_fsync'),
  })
  for (const [basename, label] of [
    [
      journal.record_backup_basename,
      'record_backup',
    ],
    [
      journal.decision_backup_basename,
      'decision_backup',
    ],
  ]) {
    await removeTransactionPath(
      transactionPath(paths, basename),
      paths.directory,
      {
        afterUnlink: () => onBoundary?.(`cleanup_${label}_unlink`),
        afterSync: () => onBoundary?.(
          `cleanup_${label}_directory_fsync`
        ),
      },
    )
  }
  for (const path of allTransactionPaths(
    paths,
    journal.transaction_id,
  )) {
    await removeTransactionPath(path, paths.directory)
  }
}

async function rollbackCaughtPublication(paths) {
  const parsed = await readAcceptedPairJournal(paths)
  if (parsed === null) return
  const { value: journal, names } = parsed
  requireCondition(
    journal.state !== 'committed',
    'committed accepted evidence cannot be rolled back',
  )
  await restorePriorDestination({
    paths,
    canonicalPath: paths.recordPath,
    prior: journal.prior_record,
    nextSha256: journal.next_record_sha256,
    backupBasename: names.recordBackup,
    restoreBasename: names.recordRestore,
    label: 'accepted residue',
  })
  await restorePriorDestination({
    paths,
    canonicalPath: paths.decisionPath,
    prior: journal.prior_decision,
    nextSha256: journal.next_decision_sha256,
    backupBasename: names.decisionBackup,
    restoreBasename: names.decisionRestore,
    label: 'accepted decision',
  })
  await verifyPriorPair(paths, journal)
  await cleanupRecoveredTransaction(paths, journal)
}

export async function publishAcceptedEvidencePair({
  decisionBytes,
  recordBytes,
  decisionPath,
  recordPath,
  onBoundary,
  onLegacyFault,
}) {
  requireCondition(
    Buffer.isBuffer(decisionBytes) && Buffer.isBuffer(recordBytes),
    'accepted evidence publication bytes are required',
  )
  parseAcceptedPairBytes(decisionBytes, recordBytes)
  const paths = await canonicalAcceptedPairPaths(decisionPath, recordPath)
  return withAcceptedEvidencePairLock({
    decisionPath,
    recordPath,
    onBoundary,
  }, async (token) => {
    await recoverAcceptedEvidencePairLocked(paths, token)
    const [priorDecision, priorRecord] = await Promise.all([
      captureAcceptedDestination(
        paths.decisionPath,
        'accepted decision artifact',
      ),
      captureAcceptedDestination(
        paths.recordPath,
        'accepted residue artifact',
      ),
    ])
    requireCondition(
      priorDecision.exists === priorRecord.exists,
      'existing accepted evidence pair is incomplete',
    )
    if (priorDecision.exists) {
      parseAcceptedPairBytes(priorDecision.bytes, priorRecord.bytes)
    }
    const names = acceptedPairNames(token.transactionId)
    const journal = {
      schema_version: 1,
      transaction_id: token.transactionId,
      state: 'prepared',
      decision_basename: ACCEPTED_PAIR_DECISION_BASENAME,
      record_basename: ACCEPTED_PAIR_RECORD_BASENAME,
      prior_decision: journalDescriptor(priorDecision),
      prior_record: journalDescriptor(priorRecord),
      next_decision_sha256: sha256Bytes(decisionBytes),
      next_record_sha256: sha256Bytes(recordBytes),
      decision_stage_basename: names.decisionStage,
      record_stage_basename: names.recordStage,
      decision_backup_basename: names.decisionBackup,
      record_backup_basename: names.recordBackup,
    }
    let durableJournal = null
    try {
      await writeExclusiveDurable(
        transactionPath(paths, names.recordStage),
        recordBytes,
        0o600,
        'accepted residue stage',
        () => onBoundary?.('record_stage_file_fsync'),
      )
      await syncAcceptedPairDirectory(
        paths.directory,
        () => onBoundary?.('record_stage_directory_fsync'),
      )
      await writeExclusiveDurable(
        transactionPath(paths, names.decisionStage),
        decisionBytes,
        0o600,
        'accepted decision stage',
        () => onBoundary?.('decision_stage_file_fsync'),
      )
      await syncAcceptedPairDirectory(
        paths.directory,
        () => onBoundary?.('decision_stage_directory_fsync'),
      )
      if (priorRecord.exists) {
        await writeExclusiveDurable(
          transactionPath(paths, names.recordBackup),
          priorRecord.bytes,
          0o600,
          'accepted residue backup',
          () => onBoundary?.('record_backup_file_fsync'),
        )
        await syncAcceptedPairDirectory(
          paths.directory,
          () => onBoundary?.('record_backup_directory_fsync'),
        )
      }
      if (priorDecision.exists) {
        await writeExclusiveDurable(
          transactionPath(paths, names.decisionBackup),
          priorDecision.bytes,
          0o600,
          'accepted decision backup',
          () => onBoundary?.('decision_backup_file_fsync'),
        )
        await syncAcceptedPairDirectory(
          paths.directory,
          () => onBoundary?.('decision_backup_directory_fsync'),
        )
      }
      durableJournal = await writeJournalState(
        paths,
        journal,
        'prepared',
        onBoundary,
      )
      await onLegacyFault?.('before_publish')
      await rename(
        transactionPath(paths, names.recordStage),
        paths.recordPath,
      )
      await onBoundary?.('record_canonical_rename')
      await syncAcceptedPairDirectory(
        paths.directory,
        () => onBoundary?.('record_canonical_directory_fsync'),
      )
      await onLegacyFault?.('after_record_publish')
      durableJournal = await writeJournalState(
        paths,
        durableJournal,
        'record-published',
        onBoundary,
      )
      await onLegacyFault?.('before_decision_publish')
      await rename(
        transactionPath(paths, names.decisionStage),
        paths.decisionPath,
      )
      await onBoundary?.('decision_canonical_rename')
      await syncAcceptedPairDirectory(
        paths.directory,
        () => onBoundary?.('decision_canonical_directory_fsync'),
      )
      await onLegacyFault?.('after_decision_publish')
      const publishedRecord = await readRegularBytes(
        paths.recordPath,
        'accepted residue artifact',
        { maxBytes: MAX_FILE_BYTES },
      )
      await onLegacyFault?.('during_readback')
      const publishedDecision = await readRegularBytes(
        paths.decisionPath,
        'accepted decision artifact',
        { maxBytes: MAX_FILE_BYTES },
      )
      requireCondition(
        publishedRecord.equals(recordBytes)
          && publishedDecision.equals(decisionBytes),
        'accepted evidence publication readback mismatch',
      )
      parseAcceptedPairBytes(publishedDecision, publishedRecord)
      await onBoundary?.('publication_readback')
      durableJournal = await writeJournalState(
        paths,
        durableJournal,
        'committed',
        onBoundary,
      )
      await cleanupCommittedPublication(
        paths,
        durableJournal,
        onBoundary,
      )
      return { decisionBytes, recordBytes }
    } catch (originalError) {
      try {
        if (durableJournal?.state === 'committed') {
          await recoverAcceptedEvidencePairLocked(paths, token)
        } else {
          await rollbackCaughtPublication(paths)
          if (durableJournal === null) {
            await cleanPreJournalAbandonment(
              paths,
              token.transactionId,
            )
          }
        }
      } catch (recoveryError) {
        throw new AggregateError(
          [originalError, recoveryError],
          'accepted evidence publication failed and recovery could not be verified; recovery state preserved',
        )
      }
      throw originalError
    }
  })
}

function safePathReference(path) {
  if (
    typeof path !== 'string'
    || path.length === 0
    || path.length > 500
    || PATH_CONTROLS.test(path)
    || sourceSensitiveTokens(path).length > 0
  ) {
    const digest = sha256Bytes(Buffer.from(String(path), 'utf8'))
    return `sha256:${digest}`
  }
  return JSON.stringify(path)
}

function violation(surface, path, reason) {
  const safeSurface = new Set([
    'worktree',
    'index',
    'phase_commit_range',
    'source_head_tree',
    'administrative_tail',
  ]).has(surface)
    ? surface
    : 'scan'
  throw new Error(
    `residue violation surface=${safeSurface} path=${safePathReference(path)} reason=${reason}`,
  )
}

function normalizedGitPath(path, surface) {
  if (
    typeof path !== 'string'
    || path.length === 0
    || path.length > 500
    || path.includes('\0')
    || path.includes('\\')
    || isAbsolute(path)
  ) violation(surface, path, 'unsafe path')
  if (PATH_CONTROLS.test(path)) {
    violation(surface, path, 'control characters in path')
  }
  const normalized = posix.normalize(path)
  if (
    normalized !== path
    || normalized === '..'
    || normalized.startsWith('../')
  ) violation(surface, path, 'unsafe path')
  return normalized
}

function classifyControlledPath(path, surface, {
  allowVerification = false,
} = {}) {
  const normalized = normalizedGitPath(path, surface)
  if (normalized === OWNER_TRUST_ANCHOR_PATH) {
    return { path: normalized, kind: 'public_authorization_json' }
  }
  if (normalized.startsWith(`${SCRIPT_ROOT_RELATIVE}/`)) {
    if (!ALLOWED_SOURCE_PATHS.has(normalized)) {
      violation(surface, normalized, 'unexpected source path')
    }
    return { path: normalized, kind: 'source' }
  }
  if (normalized.startsWith(`${PHASE_DIR_RELATIVE}/`)) {
    if (ALLOWED_JSON_PATHS.has(normalized)) {
      return { path: normalized, kind: 'json' }
    }
    if (PUBLIC_AUTHORIZATION_JSON_PATHS.has(normalized)) {
      return { path: normalized, kind: 'public_authorization_json' }
    }
    if (normalized === OWNER_AUTHORIZATION_SIGNATURE_PATH) {
      return { path: normalized, kind: 'public_authorization_signature' }
    }
    if (allowVerification && normalized === VERIFICATION_PATH) {
      return { path: normalized, kind: 'verification' }
    }
    violation(surface, normalized, 'unexpected phase path')
  }
  violation(surface, normalized, 'unapproved path')
}

function decodeBounded(bytes, surface, path) {
  requireCondition(Buffer.isBuffer(bytes), 'residue bytes must be a Buffer')
  if (bytes.length > MAX_FILE_BYTES) {
    violation(surface, path, 'file size limit')
  }
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    violation(surface, path, 'invalid UTF-8')
  }
  if (DISALLOWED_TEXT_CONTROLS.test(text)) {
    violation(surface, path, 'disallowed content controls')
  }
  return text
}

function inspectJsonValue(value, surface, path, depth = 0) {
  if (depth > 50) violation(surface, path, 'JSON nesting limit')
  if (Array.isArray(value)) {
    for (const item of value) {
      inspectJsonValue(item, surface, path, depth + 1)
    }
    return
  }
  if (isPlainObject(value)) {
    for (const [key, nested] of Object.entries(value)) {
      const normalizedKey = key.replace(/[^A-Za-z0-9]/g, '').toLowerCase()
      if (
        FORBIDDEN_JSON_KEYS.has(normalizedKey)
        && !normalizedKey.endsWith('count')
      ) violation(surface, path, 'forbidden JSON field')
      if (EFFECT_COUNTERS.has(key) && nested !== 0) {
        violation(surface, path, 'nonzero effect counter')
      }
      inspectJsonValue(nested, surface, path, depth + 1)
    }
    return
  }
  if (
    typeof value === 'string'
    && /https?:\/\/(?:www\.)?linkedin\.com\/in\//i.test(value)
  ) violation(surface, path, 'candidate profile value')
}

function inspectJsonBytes(bytes, surface, path) {
  const text = decodeBounded(bytes, surface, path)
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    violation(surface, path, 'malformed JSON')
  }
  try {
    assertArtifactSchema(path, parsed)
  } catch {
    violation(surface, path, 'artifact schema rejection')
  }
  inspectJsonValue(parsed, surface, path)
  return parsed
}

function inspectPublicAuthorizationJsonBytes(bytes, surface, path) {
  const text = decodeBounded(bytes, surface, path)
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    violation(surface, path, 'malformed public authorization JSON')
  }
  if (!bytes.equals(canonicalJsonBytes(parsed))) {
    violation(surface, path, 'noncanonical public authorization JSON')
  }
  inspectJsonValue(parsed, surface, path)
  return parsed
}

function inspectHistoricalJsonBytes(bytes, surface, path) {
  try {
    return inspectJsonBytes(bytes, surface, path)
  } catch (error) {
    const digest = sha256Bytes(bytes)
    if (EXACT_HISTORICAL_JSON_STATES.get(path)?.has(digest)) {
      const text = decodeBounded(bytes, surface, path)
      const parsed = JSON.parse(text)
      requireCondition(
        isPlainObject(parsed) && Object.keys(parsed).length === 0,
        'exact historical artifact state drift',
      )
      inspectJsonValue(parsed, surface, path)
      return parsed
    }
    throw error
  }
}

function sourceSensitiveTokens(text) {
  const tokens = []
  for (const pattern of SOURCE_TOKEN_PATTERNS) {
    pattern.lastIndex = 0
    for (const match of text.matchAll(pattern)) {
      tokens.push(match[0])
    }
  }
  return tokens
}

function inspectSourceBytes(bytes, surface, path) {
  const text = decodeBounded(bytes, surface, path)
  const allowed = ALLOWED_SOURCE_TOKEN_DIGESTS.get(path) ?? new Set()
  for (const token of sourceSensitiveTokens(text)) {
    const digest = sha256Bytes(Buffer.from(token, 'utf8'))
    if (!allowed.has(digest)) {
      violation(surface, path, 'sensitive source token')
    }
  }
}

function inspectVerificationWorktreeBytes(bytes, surface, path) {
  decodeBounded(bytes, surface, path)
}

function inspectControlledBytes(bytes, surface, controlled) {
  if (controlled.kind === 'json') {
    return inspectJsonBytes(bytes, surface, controlled.path)
  }
  if (controlled.kind === 'public_authorization_json') {
    return inspectPublicAuthorizationJsonBytes(
      bytes,
      surface,
      controlled.path,
    )
  }
  if (controlled.kind === 'public_authorization_signature') {
    try {
      assertCanonicalSshsigBytes(bytes)
    } catch {
      violation(surface, controlled.path, 'noncanonical public SSHSIG')
    }
    return null
  }
  if (controlled.kind === 'source') {
    inspectSourceBytes(bytes, surface, controlled.path)
    return null
  }
  inspectVerificationWorktreeBytes(bytes, surface, controlled.path)
  return null
}

async function runGit(repoRoot, args, {
  allowFailure = false,
  encoding = 'buffer',
} = {}) {
  try {
    const result = await execFileAsync('git', args, {
      cwd: repoRoot,
      encoding,
      env: {
        PATH: process.env.PATH ?? '',
        LANG: 'C',
        LC_ALL: 'C',
        GIT_OPTIONAL_LOCKS: '0',
      },
      maxBuffer: MAX_GIT_BUFFER,
    })
    return result.stdout
  } catch {
    if (allowFailure) return null
    throw new Error(`Git residue inspection failed during ${args[0]}`)
  }
}

function decodeGitOutput(bytes, label) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error(`${label} contains invalid UTF-8`)
  }
}

async function resolveScanRoots({
  repoRoot,
  phaseDir,
  baseline,
  sourceHeadSha,
}) {
  requireCondition(
    typeof repoRoot === 'string' && repoRoot.trim().length > 0,
    'unsafe scan root',
  )
  const requestedRoot = resolve(repoRoot)
  requireCondition(
    requestedRoot !== parse(requestedRoot).root
      && requestedRoot !== resolve(homedir()),
    'unsafe scan root',
  )
  let canonicalRoot
  try {
    canonicalRoot = await realpath(requestedRoot)
  } catch {
    throw new Error('unsafe scan root')
  }
  const gitTopLevelBytes = await runGit(
    canonicalRoot,
    ['rev-parse', '--show-toplevel'],
    { allowFailure: true },
  )
  requireCondition(gitTopLevelBytes !== null, 'not a Git repository')
  const gitTopLevel =
    decodeGitOutput(gitTopLevelBytes, 'Git root').trim()
  requireCondition(
    await realpath(gitTopLevel) === canonicalRoot,
    'scan root is not the Git workspace root',
  )

  const expectedPhaseDir = resolve(canonicalRoot, PHASE_DIR_RELATIVE)
  const requestedPhaseDir = resolve(canonicalRoot, phaseDir ?? '')
  requireCondition(
    requestedPhaseDir === expectedPhaseDir
      && requestedPhaseDir !== canonicalRoot,
    'approved phase directory is required',
  )
  requireCondition(
    await realpath(expectedPhaseDir) === expectedPhaseDir,
    'approved phase directory is required',
  )
  const scriptRoot = resolve(canonicalRoot, SCRIPT_ROOT_RELATIVE)
  requireCondition(
    await realpath(scriptRoot) === scriptRoot,
    'approved script scan root is invalid',
  )
  requireCondition(
    typeof sourceHeadSha === 'string' && SHA.test(sourceHeadSha),
    'source head SHA is required',
  )
  await assertExecutionBaseline({
    record: baseline,
    repoRoot: canonicalRoot,
    sourceHeadSha,
  })
  const sourceAncestor = await runGit(canonicalRoot, [
    'merge-base',
    '--is-ancestor',
    sourceHeadSha,
    'HEAD',
  ], { allowFailure: true })
  requireCondition(
    sourceAncestor !== null,
    'source head is not an ancestor of live HEAD',
  )
  return {
    repoRoot: canonicalRoot,
    phaseDir: expectedPhaseDir,
    scriptRoot,
    baseline,
    sourceHeadSha,
  }
}

function inventoryDigest(entries) {
  return sha256Json(
    [...entries].sort((left, right) => {
      const a = JSON.stringify(left)
      const b = JSON.stringify(right)
      return a.localeCompare(b)
    }),
  )
}

async function inspectWorktreeFile(roots, path, kind, entries) {
  const absolutePath = resolve(roots.repoRoot, path)
  const metadata = await lstat(absolutePath)
  if (metadata.isSymbolicLink()) violation('worktree', path, 'symlink')
  if (!metadata.isFile()) violation('worktree', path, 'non-regular file')
  const bytes = await readFile(absolutePath)
  inspectControlledBytes(bytes, 'worktree', { path, kind })
  entries.push({
    path,
    size: bytes.length,
    sha256: sha256Bytes(bytes),
  })
}

async function scanScriptWorktree(roots, entries) {
  async function walk(relativeDirectory) {
    const absoluteDirectory = resolve(roots.repoRoot, relativeDirectory)
    const children = await readdir(absoluteDirectory, {
      withFileTypes: true,
    })
    for (const child of children) {
      const relativePath = posix.join(relativeDirectory, child.name)
      const metadata = await lstat(resolve(roots.repoRoot, relativePath))
      if (metadata.isSymbolicLink()) {
        violation('worktree', relativePath, 'symlink')
      }
      if (metadata.isDirectory()) {
        if (!ALLOWED_SOURCE_DIRECTORIES.has(relativePath)) {
          violation('worktree', relativePath, 'unexpected source directory')
        }
        await walk(relativePath)
        continue
      }
      const controlled = classifyControlledPath(relativePath, 'worktree')
      await inspectWorktreeFile(
        roots,
        controlled.path,
        controlled.kind,
        entries,
      )
    }
  }
  await walk(SCRIPT_ROOT_RELATIVE)
}

function isAcceptedPairTransactionCandidate(basename) {
  return basename.startsWith('.05-accepted-evidence.')
    || basename.startsWith(`.${ACCEPTED_PAIR_DECISION_BASENAME}.`)
    || basename.startsWith(`.${ACCEPTED_PAIR_RECORD_BASENAME}.`)
}

async function assertNoAcceptedPairTransactionResidue(roots) {
  const children = await readdir(roots.phaseDir)
  for (const basename of children) {
    if (!isAcceptedPairTransactionCandidate(basename)) continue
    const relativePath = `${PHASE_DIR_RELATIVE}/${basename}`
    const metadata = await lstat(resolve(roots.repoRoot, relativePath))
    if (metadata.isSymbolicLink()) {
      violation('worktree', relativePath, 'transaction path symlink')
    }
    violation('worktree', relativePath, 'accepted evidence transaction residue')
  }
}

async function scanPhaseWorktree(roots, entries, excludedPaths) {
  await assertNoAcceptedPairTransactionResidue(roots)
  const children = await readdir(roots.phaseDir, { withFileTypes: true })
  for (const child of children) {
    if (
      !child.name.endsWith('.json')
      && child.name !== '05-OWNER-AUTHORIZATION-REQUEST.json.sig'
    ) continue
    const path = `${PHASE_DIR_RELATIVE}/${child.name}`
    if (excludedPaths.has(path)) continue
    const controlled = classifyControlledPath(path, 'worktree')
    await inspectWorktreeFile(
      roots,
      controlled.path,
      controlled.kind,
      entries,
    )
  }
  try {
    if (excludedPaths.has(VERIFICATION_PATH)) return
    const controlled = classifyControlledPath(
      VERIFICATION_PATH,
      'worktree',
      { allowVerification: true },
    )
    await inspectWorktreeFile(
      roots,
      controlled.path,
      controlled.kind,
      entries,
    )
  } catch (error) {
    if (
      error?.code !== 'ENOENT'
      && !String(error?.message).includes('ENOENT')
    ) throw error
  }
}

function parsePorcelain(output) {
  if (output === '') return []
  const tokens = output.split('\0')
  if (tokens.at(-1) === '') tokens.pop()
  const paths = []
  for (let index = 0; index < tokens.length; index += 1) {
    const record = tokens[index]
    requireCondition(record.length >= 4, 'Git worktree status is malformed')
    const status = record.slice(0, 2)
    paths.push(record.slice(3))
    if (status.includes('R') || status.includes('C')) {
      requireCondition(index + 1 < tokens.length,
        'Git rename status is malformed')
      paths.push(tokens[++index])
    }
  }
  return paths
}

async function scanWorktree(roots, policy) {
  const entries = []
  const excludedPaths = new Set(policy.allowed_paths)
  await scanScriptWorktree(roots, entries)
  await scanPhaseWorktree(roots, entries, excludedPaths)
  const statusBytes = await runGit(roots.repoRoot, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--',
    ...CURRENT_PATHSPECS,
  ])
  const statusPaths = parsePorcelain(
    decodeGitOutput(statusBytes, 'Git status'),
  ).filter((path) => !excludedPaths.has(path))
  for (const path of statusPaths) {
    classifyControlledPath(path, 'worktree', {
      allowVerification: true,
    })
  }
  const sortedStatusPaths = [...statusPaths].sort()
  requireCondition(
    new Set(sortedStatusPaths).size === sortedStatusPaths.length,
    'Git controlled status paths contain duplicates',
  )
  return {
    status_entry_count: statusPaths.length,
    status_paths: sortedStatusPaths,
    path_count: entries.length,
    blob_count: entries.length,
    inventory_sha256: inventoryDigest(entries),
  }
}

function parseIndexEntries(output) {
  if (output === '') return []
  const records = output.split('\0')
  if (records.at(-1) === '') records.pop()
  return records.map((record) => {
    const match = /^(\d{6}) ([0-9a-f]{40,64}) ([0-3])\t([\s\S]+)$/.exec(
      record,
    )
    requireCondition(match, 'Git index entry is malformed')
    return {
      mode: match[1],
      oid: match[2],
      stage: Number(match[3]),
      path: match[4],
    }
  })
}

async function readGitBlob(roots, oid, cache) {
  if (!cache.has(oid)) {
    const bytes = await runGit(roots.repoRoot, ['cat-file', 'blob', oid])
    cache.set(oid, bytes)
  }
  return cache.get(oid)
}

async function scanIndex(roots, policy) {
  const excludedPaths = new Set(policy.allowed_paths)
  const indexBytes = await runGit(roots.repoRoot, [
    'ls-files',
    '-s',
    '-z',
    '--',
    ...CURRENT_PATHSPECS,
  ])
  const indexEntries = parseIndexEntries(
    decodeGitOutput(indexBytes, 'Git index'),
  )
  const blobCache = new Map()
  const inventory = []
  for (const entry of indexEntries) {
    if (excludedPaths.has(entry.path)) continue
    const controlled = classifyControlledPath(entry.path, 'index', {
      allowVerification: true,
    })
    if (
      entry.stage !== 0
      || !['100644', '100755'].includes(entry.mode)
    ) violation('index', entry.path, 'non-regular or unmerged index entry')
    const bytes = await readGitBlob(roots, entry.oid, blobCache)
    inspectControlledBytes(bytes, 'index', controlled)
    inventory.push({
      path: controlled.path,
      mode: entry.mode,
      oid: entry.oid,
      size: bytes.length,
      sha256: sha256Bytes(bytes),
    })
  }
  const stagedBytes = await runGit(roots.repoRoot, [
    'diff',
    '--cached',
    '--name-only',
    '-z',
    '--',
    ...CURRENT_PATHSPECS,
  ])
  const stagedPaths = decodeGitOutput(stagedBytes, 'Git staged paths')
    .split('\0')
    .filter(Boolean)
    .filter((path) => !excludedPaths.has(path))
  for (const path of stagedPaths) {
    classifyControlledPath(path, 'index', { allowVerification: true })
  }
  const sortedStagedPaths = [...stagedPaths].sort()
  requireCondition(
    new Set(sortedStagedPaths).size === sortedStagedPaths.length,
    'Git controlled staged paths contain duplicates',
  )
  return {
    staged_path_count: stagedPaths.length,
    staged_paths: sortedStagedPaths,
    path_count: inventory.length,
    blob_count: blobCache.size,
    inventory_sha256: inventoryDigest(inventory),
  }
}

function parseTreeEntries(output, surface) {
  if (output === '') return []
  const records = output.split('\0')
  if (records.at(-1) === '') records.pop()
  return records.map((record) => {
    const match = /^(\d{6}) ([a-z]+) ([0-9a-f]{40,64})\t([\s\S]+)$/.exec(
      record,
    )
    requireCondition(match, 'Git tree entry is malformed')
    const entry = {
      mode: match[1],
      type: match[2],
      oid: match[3],
      path: match[4],
    }
    if (
      entry.type !== 'blob'
      || !['100644', '100755'].includes(entry.mode)
    ) violation(surface, entry.path, 'non-regular tree entry')
    return entry
  })
}

async function commitsFromBaseline(roots) {
  if (roots.baseline.base_sha === roots.sourceHeadSha) {
    return [roots.baseline.base_sha]
  }
  const bytes = await runGit(roots.repoRoot, [
    'rev-list',
    '--reverse',
    '--ancestry-path',
    `${roots.baseline.base_sha}..${roots.sourceHeadSha}`,
  ])
  const commits = decodeGitOutput(bytes, 'Git revision range')
    .trim()
    .split('\n')
    .filter(Boolean)
  requireCondition(
    commits.length > 0 && commits.every((commit) => SHA.test(commit)),
    'phase commit range is malformed',
  )
  return [roots.baseline.base_sha, ...commits]
}

async function residueSchemaVersionAt(roots, commit, blobCache) {
  const path = `${PHASE_DIR_RELATIVE}/05-ZERO-RESIDUE.json`
  const entry = await treeEntryAt(roots, commit, path)
  if (entry === null) return null
  return inspectHistoricalJsonBytes(
    await readTreeEntryBytes(roots, entry, blobCache),
    'phase_commit_range',
    path,
  ).schema_version ?? null
}

async function assertAuthenticatedRebindCommits(
  roots,
  commits,
  blobCache,
) {
  for (const commit of commits.slice(1)) {
    const changesBytes = await runGit(roots.repoRoot, [
      'diff-tree',
      '--no-commit-id',
      '--name-status',
      '--no-renames',
      '-r',
      '-z',
      `${commit}^`,
      commit,
    ])
    const changes = parseNameStatus(
      decodeGitOutput(
        changesBytes,
        'Git baseline-to-source changes',
      ),
    )
    if (
      !changes.some(({ path }) =>
        AUTHENTICATED_REBIND_PATHS.includes(path)
      )
    ) continue
    const [beforeVersion, afterVersion] = await Promise.all([
      residueSchemaVersionAt(roots, `${commit}^`, blobCache),
      residueSchemaVersionAt(roots, commit, blobCache),
    ])
    if (beforeVersion !== 4 && afterVersion !== 4) continue
    requireCondition(
      (
        (beforeVersion === 3 && afterVersion === 4)
        || (beforeVersion === 4 && afterVersion === 4)
      )
        && isDeepStrictEqual(
        changes.map(({ path }) => path).sort(),
        AUTHENTICATED_REBIND_PATHS,
      )
        && changes.every(({ status }) => status === 'M'),
      'authenticated evidence rebind commit must modify exactly the finite evidence path set',
    )
    await resolveImmutableAuthenticatedV3Lineage({
      repoRoot: roots.repoRoot,
      sourceHeadSha: commit,
    })
  }
}

async function treeEntriesAt(roots, commit, surface) {
  const bytes = await runGit(roots.repoRoot, [
    'ls-tree',
    '-r',
    '-z',
    '--full-tree',
    commit,
    '--',
    ...SOURCE_TREE_PATHSPECS,
  ])
  return parseTreeEntries(
    decodeGitOutput(bytes, 'Git tree'),
    surface,
  ).filter((entry) => (
    entry.path.startsWith(`${SCRIPT_ROOT_RELATIVE}/`)
    || (
      entry.path.startsWith(`${PHASE_DIR_RELATIVE}/`)
      && (
        entry.path.endsWith('.json')
        || entry.path === OWNER_AUTHORIZATION_SIGNATURE_PATH
      )
    )
  ))
}

async function scanPhaseCommitRange(roots) {
  const commits = await commitsFromBaseline(roots)
  const blobCache = new Map()
  await assertAuthenticatedRebindCommits(roots, commits, blobCache)
  const inventory = []
  for (const commit of commits) {
    const entries = await treeEntriesAt(
      roots,
      commit,
      'phase_commit_range',
    )
    for (const entry of entries) {
      const controlled = classifyControlledPath(
        entry.path,
        'phase_commit_range',
      )
      const bytes = await readGitBlob(roots, entry.oid, blobCache)
      if (controlled.kind === 'json') {
        inspectHistoricalJsonBytes(
          bytes,
          'phase_commit_range',
          controlled.path,
        )
      } else {
        inspectControlledBytes(bytes, 'phase_commit_range', controlled)
      }
      inventory.push({
        commit,
        path: controlled.path,
        mode: entry.mode,
        oid: entry.oid,
        size: bytes.length,
        sha256: sha256Bytes(bytes),
      })
    }
  }
  return {
    base_sha: roots.baseline.base_sha,
    head_sha: roots.sourceHeadSha,
    commit_count: commits.length,
    path_count: inventory.length,
    blob_count: blobCache.size,
    inventory_sha256: inventoryDigest(inventory),
  }
}

async function scanSourceHeadTree(roots) {
  const entries = await treeEntriesAt(
    roots,
    roots.sourceHeadSha,
    'source_head_tree',
  )
  const blobCache = new Map()
  const inventory = []
  for (const entry of entries) {
    const controlled = classifyControlledPath(
      entry.path,
      'source_head_tree',
    )
    const bytes = await readGitBlob(roots, entry.oid, blobCache)
    inspectControlledBytes(bytes, 'source_head_tree', controlled)
    inventory.push({
      path: controlled.path,
      mode: entry.mode,
      oid: entry.oid,
      size: bytes.length,
      sha256: sha256Bytes(bytes),
    })
  }
  return {
    head_sha: roots.sourceHeadSha,
    path_count: entries.length,
    blob_count: blobCache.size,
    tree_sha256: inventoryDigest(inventory),
  }
}

function parseFrontmatter(text, label) {
  requireCondition(text.startsWith('---\n'), `${label} frontmatter missing`)
  const end = text.indexOf('\n---\n', 4)
  requireCondition(end > 4, `${label} frontmatter is malformed`)
  const fields = new Map()
  for (const line of text.slice(4, end).split('\n')) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!match) continue
    requireCondition(!fields.has(match[1]), `${label} duplicate field`)
    fields.set(match[1], match[2].replace(/^["']|["']$/g, ''))
  }
  return {
    fields,
    body: text.slice(end + 5).trimStart(),
  }
}

function frontmatterBlock(text, label) {
  requireCondition(text.startsWith('---\n'), `${label} frontmatter missing`)
  const end = text.indexOf('\n---\n', 4)
  requireCondition(end > 4, `${label} frontmatter is malformed`)
  return text.slice(4, end)
}

function frontmatterList(text, field, label) {
  const lines = frontmatterBlock(text, label).split('\n')
  const markers = lines
    .map((line, index) => line === `${field}:` ? index : -1)
    .filter((index) => index >= 0)
  requireCondition(
    markers.length === 1,
    `${label} ${field} inventory is ambiguous`,
  )
  const values = []
  for (
    let index = markers[0] + 1;
    index < lines.length && /^  - /.test(lines[index]);
    index += 1
  ) values.push(lines[index].slice(4))
  return values
}

function splitMarkdownRow(line, expectedColumns, label) {
  requireCondition(
    line.startsWith('|') && line.endsWith('|'),
    `${label} row is malformed`,
  )
  const cells = line.slice(1, -1).split('|').map((cell) => cell.trim())
  requireCondition(
    cells.length === expectedColumns,
    `${label} column count drift`,
  )
  return cells
}

function markdownTableAtHeading(body, headingPattern, expectedHeaders, label) {
  const lines = body.split('\n')
  const headings = lines
    .map((line, index) => headingPattern.test(line) ? index : -1)
    .filter((index) => index >= 0)
  requireCondition(headings.length === 1, `${label} heading is ambiguous`)
  let cursor = headings[0] + 1
  while (lines[cursor] === '') cursor += 1
  requireCondition(cursor < lines.length, `${label} table is missing`)
  requireCondition(
    isDeepStrictEqual(
      splitMarkdownRow(
        lines[cursor],
        expectedHeaders.length,
        `${label} header`,
      ),
      expectedHeaders,
    ),
    `${label} header drift`,
  )
  cursor += 1
  const separators = splitMarkdownRow(
    lines[cursor] ?? '',
    expectedHeaders.length,
    `${label} separator`,
  )
  requireCondition(
    separators.every((cell) => /^:?-{3,}:?$/.test(cell)),
    `${label} separator drift`,
  )
  cursor += 1
  const rows = []
  while (cursor < lines.length && lines[cursor].startsWith('|')) {
    rows.push(splitMarkdownRow(
      lines[cursor],
      expectedHeaders.length,
      label,
    ))
    cursor += 1
  }
  requireCondition(rows.length > 0, `${label} inventory is empty`)
  return rows
}

function requireSafeTableCell(value, label) {
  requireCondition(
    typeof value === 'string'
      && value.length > 0
      && value.length <= 4_000
      && !DISALLOWED_TEXT_CONTROLS.test(value),
    `${label} is empty or malformed`,
  )
}

export const PHASE_5_VERIFICATION_TRUTHS = Object.freeze([
  [1, 'The owner can review the exact search/display/persistence/cache/deletion posture and its current evidence.'],
  [2, 'Rights admission fails closed for every invalid state and enforces at most seven inclusive dates.'],
  [3, 'The representative spike is truthfully `NOT_RUN_RIGHTS_NO_GO` with no quality claim and zero cases/effects.'],
  [4, 'The D-01 through D-08 quality design remains explicit but cannot execute from this repository.'],
  [5, 'Production outreach and Phases 6/7 remain disabled, the milestone is stopped, and no redesign is selected.'],
  [6, 'The immutable baseline and source/history inventories are pinned and byte-inspected.'],
  [7, 'Live zero residue binds clean worktree and index surfaces.'],
  [8, 'The administrative tail accepts the complete canonical 23-plan lifecycle.'],
  [9, 'Administrative tracking changes are restricted to exact Phase 5 bookkeeping.'],
  [10, 'Fresh owner authorization verifies the exact request bytes under the pinned principal, namespace, key, fingerprint, time window, and active trust state.'],
  [11, 'The historical receipt is integrity-only and cannot replace fresh authentication.'],
  [12, 'Accepted v3 decision, residue, and reconciliation bind the same raw owner proof and stopped zero-effect branch.'],
  [13, 'Caught in-process publication faults restore the exact prior evidence pair.'],
  [14, 'Publication remains coherent across process termination or power loss.'],
  [15, 'Residue duplicated digests and evidence timestamps are exact and internally consistent.'],
  [16, 'Review consumers use one clean-only status and reject aliases/skipped/unresolved review states.'],
  [17, 'The final review is clean and covers the exact 20-file source/test/trust scope.'],
  [18, 'The complete offline Phase 5 suite passes in the current repository state.'],
  [19, 'A passed verification artifact proves an N/N score.'],
  [20, 'Non-authoritative contract validation and terminal fixtures are offline and read-only.'],
  [21, 'The exact 20-file review scope is exposed and no production outreach implementation is wired.'],
].map((entry) => Object.freeze(entry)))

export const PHASE_5_SOURCE_GAPS_VERIFICATION_TRUTHS = Object.freeze(
  PHASE_5_VERIFICATION_TRUTHS.map(([id, truth]) => Object.freeze([
    id,
    id === 8
      ? 'The administrative tail accepts the complete canonical 19-plan lifecycle.'
      : id === 17
        ? 'The final review is clean and covers the exact 20-file source/test/trust scope.'
        : id === 21
          ? 'The exact 20-file review scope is exposed and no production outreach implementation is wired.'
          : truth,
  ])),
)

const PHASE_5_VERIFICATION_REQUIREMENTS = Object.freeze([
  Object.freeze({
    id: 'OUTR-04',
    description:
      'Production proceeds only after permitted rights and owner acceptance; otherwise remains disabled and stopped/redesigned.',
  }),
  Object.freeze({
    id: 'OUTR-05',
    description:
      'Rights-first terminal branch truthfully closes quality as not run, zero effect, and receipt-bound owner no-go.',
  }),
])

export const PHASE_5_OFFLINE_TEST_FILES = Object.freeze([
  'scripts/outreach-feasibility/adversarial-regression.test.mjs',
  'scripts/outreach-feasibility/decision-evidence.test.mjs',
  'scripts/outreach-feasibility/evidence-integrity.test.mjs',
  'scripts/outreach-feasibility/owner-authorization.test.mjs',
  'scripts/outreach-feasibility/owner-checkpoint.test.mjs',
  'scripts/outreach-feasibility/residue-check.test.mjs',
  'scripts/outreach-feasibility/rights-gate.test.mjs',
  'scripts/outreach-feasibility/terminal-audit.test.mjs',
  'scripts/outreach-feasibility/dormant/spike-runner.test.mjs',
])
export const PHASE_5_OFFLINE_TEST_COUNT = 242
export const PHASE_5_OFFLINE_TEST_COMMAND =
  'env -u TAVILY_API_KEY GIT_OPTIONAL_LOCKS=0 node --test'
  + ' --test-reporter=tap '
  + PHASE_5_OFFLINE_TEST_FILES.join(' ')
const PHASE_5_OFFLINE_TEST_COMMAND_SHA256 = createHash('sha256')
  .update(PHASE_5_OFFLINE_TEST_COMMAND)
  .digest('hex')
const PHASE_5_OFFLINE_TEST_FILE_INVENTORY_SHA256 =
  sha256Json(PHASE_5_OFFLINE_TEST_FILES)
const PHASE_5_VERIFICATION_ARTIFACTS = Object.freeze([
  [1, 'scripts/outreach-feasibility/rights-gate.mjs', 'inspectRightsMatrix'],
  [2, 'scripts/outreach-feasibility/rights-gate.mjs', 'evaluateRights'],
  [3, 'scripts/outreach-feasibility/rights-gate.mjs', 'assertNoGoQualityReport'],
  [4, 'scripts/outreach-feasibility/dormant/spike-runner.mjs', 'SPIKE_CONTRACT'],
  [5, 'scripts/outreach-feasibility/decision-evidence.mjs', 'decisionPayload'],
  [6, 'scripts/outreach-feasibility/residue-check.mjs', 'scanOwnedSurfaces'],
  [7, 'scripts/outreach-feasibility/residue-check.mjs', 'requireStaticSurfaceMatch'],
  [8, 'scripts/outreach-feasibility/residue-check.mjs', 'deriveAdministrativeTailPolicy'],
  [9, 'scripts/outreach-feasibility/residue-check.mjs', 'assertTrackingTransition'],
  [10, 'scripts/outreach-feasibility/owner-authorization.mjs', 'verifyOwnerAuthorization'],
  [11, 'scripts/outreach-feasibility/owner-checkpoint.mjs', 'assertOwnerCheckpointRecord'],
  [12, 'scripts/outreach-feasibility/terminal-audit.mjs', 'assertContractReconciliation'],
  [13, 'scripts/outreach-feasibility/decision-evidence.mjs', 'writeAtomicPair'],
  [14, 'scripts/outreach-feasibility/decision-evidence.mjs', 'PAIR_PUBLICATION_BOUNDARIES'],
  [15, 'scripts/outreach-feasibility/residue-check.mjs', 'assertRecordMatchesLiveScan'],
  [16, 'scripts/outreach-feasibility/evidence-integrity.mjs', 'assertPhase5ReviewLifecycle'],
  [17, 'scripts/outreach-feasibility/evidence-integrity.mjs', 'PHASE_5_REVIEWED_PATHS'],
  [19, 'scripts/outreach-feasibility/residue-check.mjs', 'assertCompleteVerificationDocument'],
  [20, 'scripts/outreach-feasibility/terminal-audit.mjs', 'runContractValidation'],
  [21, 'scripts/outreach-feasibility/evidence-integrity.mjs', 'PHASE_5_REVIEWED_PATHS'],
].map((entry) => Object.freeze(entry)))
const PHASE_5_REQUIREMENT_EVIDENCE_ARTIFACTS = Object.freeze([
  ['OUTR-04', 'scripts/outreach-feasibility/decision-evidence.mjs', 'decisionPayload'],
  ['OUTR-05', 'scripts/outreach-feasibility/terminal-audit.mjs', 'assertContractReconciliation'],
].map((entry) => Object.freeze(entry)))
const ARTIFACT_VERIFICATION_EVIDENCE =
  /^ARTIFACT path=([^ ]+) anchor=([^ ]+) source_head=([0-9a-f]{40}) tree_sha256=([0-9a-f]{64})$/
const COMMAND_VERIFICATION_EVIDENCE =
  /^COMMAND id=phase5-offline-suite command_sha256=([0-9a-f]{64}) test_file_inventory_sha256=([0-9a-f]{64}) test_file_blobs_sha256=([0-9a-f]{64}) runner_result_sha256=([0-9a-f]{64}) exit=0 tests=(\d+) pass=(\d+) fail=(\d+) cancelled=(\d+) skipped=(\d+) todo=(\d+) source_head=([0-9a-f]{40}) tree_sha256=([0-9a-f]{64})$/

function requireVerificationSnapshot(snapshot) {
  requireCondition(
    snapshot
      && typeof snapshot === 'object'
      && !Array.isArray(snapshot)
      && SHA.test(snapshot.source_head_sha)
      && SHA256.test(snapshot.controlled_tree_sha256),
    'verification source snapshot is malformed',
  )
  return {
    source_head_sha: snapshot.source_head_sha,
    controlled_tree_sha256: snapshot.controlled_tree_sha256,
  }
}

function artifactVerificationEvidence(path, anchor, snapshot) {
  return `ARTIFACT path=${path} anchor=${anchor}`
    + ` source_head=${snapshot.source_head_sha}`
    + ` tree_sha256=${snapshot.controlled_tree_sha256}`
}

const PHASE_5_OFFLINE_RUNNER_RESULT_KEYS = Object.freeze([
  'schema_version',
  'runner',
  'command_sha256',
  'test_file_inventory_sha256',
  'test_file_blobs_sha256',
  'source_head_sha',
  'controlled_tree_sha256',
  'test_outcomes_sha256',
  'exit',
  'tests',
  'suites',
  'pass',
  'fail',
  'cancelled',
  'skipped',
  'todo',
])

export function normalizePhase5OfflineRunnerResult({
  source_head_sha: sourceHeadSha,
  controlled_tree_sha256: controlledTreeSha256,
  test_file_blobs_sha256: testFileBlobsSha256,
  test_outcomes_sha256: testOutcomesSha256,
  exit,
  tests,
  suites,
  pass,
  fail,
  cancelled,
  skipped,
  todo,
}) {
  const snapshot = requireVerificationSnapshot({
    source_head_sha: sourceHeadSha,
    controlled_tree_sha256: controlledTreeSha256,
  })
  requireCondition(
    SHA256.test(testFileBlobsSha256)
      && SHA256.test(testOutcomesSha256),
    'offline runner blob or outcome digest is malformed',
  )
  const counters = {
    exit,
    tests,
    suites,
    pass,
    fail,
    cancelled,
    skipped,
    todo,
  }
  requireCondition(
    Object.values(counters).every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    ),
    'offline runner counters are malformed',
  )
  return Object.freeze({
    schema_version: 1,
    runner: 'node:test',
    command_sha256: PHASE_5_OFFLINE_TEST_COMMAND_SHA256,
    test_file_inventory_sha256:
      PHASE_5_OFFLINE_TEST_FILE_INVENTORY_SHA256,
    test_file_blobs_sha256: testFileBlobsSha256,
    ...snapshot,
    test_outcomes_sha256: testOutcomesSha256,
    ...counters,
  })
}

function requirePhase5OfflineRunnerResult(value) {
  requireExactKeys(
    value,
    PHASE_5_OFFLINE_RUNNER_RESULT_KEYS,
    'offline runner result',
  )
  const normalized = normalizePhase5OfflineRunnerResult(value)
  requireCondition(
    isDeepStrictEqual(value, normalized),
    'offline runner result is not canonical',
  )
  return normalized
}

export function buildPhase5PassedVerificationEvidence(options) {
  requireExactKeys(
    options,
    [
      'source_head_sha',
      'controlled_tree_sha256',
      'runner_result',
    ],
    'passed verification evidence options',
  )
  const {
    source_head_sha: sourceHeadSha,
    controlled_tree_sha256: controlledTreeSha256,
    runner_result: runnerResultValue,
  } = options
  const snapshot = requireVerificationSnapshot({
    source_head_sha: sourceHeadSha,
    controlled_tree_sha256: controlledTreeSha256,
  })
  const runnerResult =
    requirePhase5OfflineRunnerResult(runnerResultValue)
  requireCondition(
    runnerResult.source_head_sha === snapshot.source_head_sha
      && runnerResult.controlled_tree_sha256
        === snapshot.controlled_tree_sha256
      && runnerResult.exit === 0
      && runnerResult.tests === PHASE_5_OFFLINE_TEST_COUNT
      && runnerResult.pass === runnerResult.tests
      && runnerResult.fail === 0
      && runnerResult.cancelled === 0
      && runnerResult.skipped === 0
      && runnerResult.todo === 0,
    'passed verification requires an actual successful offline runner result',
  )
  const runnerResultSha256 = sha256Json(runnerResult)
  const truths = Object.fromEntries(
    PHASE_5_VERIFICATION_ARTIFACTS.map(([id, path, anchor]) => [
      id,
      artifactVerificationEvidence(path, anchor, snapshot),
    ]),
  )
  truths[18] =
    `COMMAND id=phase5-offline-suite`
    + ` command_sha256=${PHASE_5_OFFLINE_TEST_COMMAND_SHA256}`
    + ` test_file_inventory_sha256=${PHASE_5_OFFLINE_TEST_FILE_INVENTORY_SHA256}`
    + ` test_file_blobs_sha256=${runnerResult.test_file_blobs_sha256}`
    + ` runner_result_sha256=${runnerResultSha256}`
    + ` exit=${runnerResult.exit} tests=${runnerResult.tests}`
    + ` pass=${runnerResult.pass} fail=${runnerResult.fail}`
    + ` cancelled=${runnerResult.cancelled}`
    + ` skipped=${runnerResult.skipped} todo=${runnerResult.todo}`
    + ` source_head=${snapshot.source_head_sha}`
    + ` tree_sha256=${snapshot.controlled_tree_sha256}`
  const requirements = Object.fromEntries(
    PHASE_5_REQUIREMENT_EVIDENCE_ARTIFACTS.map(([id, path, anchor]) => [
      id,
      artifactVerificationEvidence(path, anchor, snapshot),
    ]),
  )
  return Object.freeze({
    truths: Object.freeze(truths),
    requirements: Object.freeze(requirements),
  })
}

function requireVerificationEvidence(value, label) {
  requireSafeTableCell(value, label)
  requireCondition(
    value.length >= 24
      && !/^(?:none|n\/a|placeholder|(?:offline )?evidence(?: for)?(?: \d+| for OUTR-\d{2})?)[.!]?$/i
        .test(value),
    `${label} is not a substantive evidence reference`,
  )
}

function passedVerificationSnapshot(value, label) {
  const artifactMatch = ARTIFACT_VERIFICATION_EVIDENCE.exec(value)
  requireCondition(
    artifactMatch !== null,
    `${label} is not canonical structured artifact evidence`,
  )
  return {
    source_head_sha: artifactMatch[3],
    controlled_tree_sha256: artifactMatch[4],
  }
}

export async function resolvePhase5VerificationSourceSnapshot({
  repoRoot,
  source_head_sha: sourceHeadSha,
  controlled_tree_sha256: controlledTreeSha256,
}) {
  const snapshot = requireVerificationSnapshot({
    source_head_sha: sourceHeadSha,
    controlled_tree_sha256: controlledTreeSha256,
  })
  requireCondition(
    typeof repoRoot === 'string' && repoRoot.trim().length > 0,
    'verification repository root is required',
  )
  const requestedRoot = resolve(repoRoot)
  requireCondition(
    requestedRoot !== parse(requestedRoot).root
      && requestedRoot !== resolve(homedir()),
    'verification repository root is unsafe',
  )
  const canonicalRoot = await realpath(requestedRoot)
  const gitRootBytes = await runGit(
    canonicalRoot,
    ['rev-parse', '--show-toplevel'],
    { allowFailure: true },
  )
  requireCondition(
    gitRootBytes !== null
      && await realpath(
        decodeGitOutput(gitRootBytes, 'verification Git root').trim(),
      ) === canonicalRoot,
    'verification repository root is not canonical',
  )
  requireCondition(
    await runGit(
      canonicalRoot,
      ['cat-file', '-e', `${snapshot.source_head_sha}^{commit}`],
      { allowFailure: true },
    ) !== null,
    'verification source snapshot is not a Git commit',
  )
  const roots = {
    repoRoot: canonicalRoot,
    sourceHeadSha: snapshot.source_head_sha,
  }
  const sourceTree = await scanSourceHeadTree(roots)
  requireCondition(
    sourceTree.tree_sha256 === snapshot.controlled_tree_sha256,
    'verification controlled source tree digest drift',
  )

  const testTreeBytes = await runGit(canonicalRoot, [
    'ls-tree',
    '-r',
    '--name-only',
    snapshot.source_head_sha,
    '--',
    SCRIPT_ROOT_RELATIVE,
  ])
  const testFiles = decodeGitOutput(
    testTreeBytes,
    'verification test-file inventory',
  )
    .split('\n')
    .filter((path) =>
      /^scripts\/outreach-feasibility\/(?:[^/]+|dormant\/[^/]+)\.test\.mjs$/
        .test(path)
    )
    .sort()
  requireCondition(
    isDeepStrictEqual(testFiles, [...PHASE_5_OFFLINE_TEST_FILES].sort()),
    'verification offline test-file inventory drift',
  )
  const testFileBlobInventory = []
  const testFileBlobCache = new Map()
  for (const path of PHASE_5_OFFLINE_TEST_FILES) {
    const entry = await treeEntryAt(
      roots,
      snapshot.source_head_sha,
      path,
    )
    requireCondition(
      entry !== null,
      `verification test file is absent at source: ${path}`,
    )
    const bytes = await readTreeEntryBytes(
      roots,
      entry,
      testFileBlobCache,
    )
    testFileBlobInventory.push({
      path,
      mode: entry.mode,
      oid: entry.oid,
      size: bytes.length,
      sha256: sha256Bytes(bytes),
    })
  }

  const artifactDefinitions = [
    ...PHASE_5_VERIFICATION_ARTIFACTS.map(
      ([id, path, anchor]) => ({ consumer: `truth-${id}`, path, anchor }),
    ),
    ...PHASE_5_REQUIREMENT_EVIDENCE_ARTIFACTS.map(
      ([id, path, anchor]) => ({
        consumer: `requirement-${id}`,
        path,
        anchor,
      }),
    ),
  ]
  const artifactInventory = []
  const blobCache = new Map()
  for (const definition of artifactDefinitions) {
    requireCondition(
      /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(definition.anchor),
      `verification artifact anchor is malformed: ${definition.anchor}`,
    )
    const entry = await treeEntryAt(
      roots,
      snapshot.source_head_sha,
      definition.path,
    )
    requireCondition(
      entry !== null,
      `verification artifact path is absent at source: ${definition.path}`,
    )
    const bytes = await readTreeEntryBytes(roots, entry, blobCache)
    const text = decodeBounded(
      bytes,
      'source_head_tree',
      definition.path,
    )
    requireCondition(
      new RegExp(`\\b${definition.anchor}\\b`).test(text),
      `verification artifact anchor is absent at source: ${definition.path}#${definition.anchor}`,
    )
    artifactInventory.push({
      ...definition,
      blob_sha256: sha256Bytes(bytes),
    })
  }
  return Object.freeze({
    ...snapshot,
    test_file_inventory_sha256:
      PHASE_5_OFFLINE_TEST_FILE_INVENTORY_SHA256,
    test_file_blobs_sha256:
      inventoryDigest(testFileBlobInventory),
    artifact_inventory_sha256: inventoryDigest(artifactInventory),
  })
}

function parsePhase5TapResult(tapBytes, exit) {
  const text = decodeGitOutput(tapBytes, 'offline runner TAP output')
  requireCondition(
    text.startsWith('TAP version 13\n'),
    'offline runner did not produce TAP version 13 output',
  )
  const summary = new Map()
  for (const match of text.matchAll(
    /^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)$/gm,
  )) {
    requireCondition(
      !summary.has(match[1]),
      `offline runner duplicated TAP ${match[1]} summary`,
    )
    summary.set(match[1], Number(match[2]))
  }
  requireCondition(
    ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo']
      .every((key) => summary.has(key)),
    'offline runner TAP summary is incomplete',
  )
  const outcomes = [...text.matchAll(
    /^(\s*)(ok|not ok) (\d+) - (.+)$/gm,
  )].map((match) => ({
    depth: match[1].length,
    status: match[2],
    ordinal: Number(match[3]),
    name: match[4],
  }))
  requireCondition(
    outcomes.length > 0,
    'offline runner TAP outcome inventory is empty',
  )
  return {
    test_outcomes_sha256: inventoryDigest(outcomes),
    exit,
    tests: summary.get('tests'),
    suites: summary.get('suites'),
    pass: summary.get('pass'),
    fail: summary.get('fail'),
    cancelled: summary.get('cancelled'),
    skipped: summary.get('skipped'),
    todo: summary.get('todo'),
  }
}

function isolatedRunnerEnvironment(temporaryRoot) {
  return {
    PATH: process.env.PATH ?? '',
    HOME: temporaryRoot,
    TMPDIR: temporaryRoot,
    LANG: 'C',
    LC_ALL: 'C',
    TZ: 'UTC',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    PHASE_5_ISOLATED_RUNNER_CHILD: '1',
  }
}

async function captureRunnerSourceState(repoRoot) {
  const [head, status] = await Promise.all([
    runGit(repoRoot, ['rev-parse', 'HEAD']),
    runGit(repoRoot, [
      'status',
      '--porcelain=v2',
      '-z',
      '--untracked-files=all',
    ]),
  ])
  return { head, status }
}

export async function runPhase5OfflineSuiteAtSourceSnapshot({
  repoRoot,
  source_head_sha: sourceHeadSha,
  controlled_tree_sha256: controlledTreeSha256,
  resolvedSnapshot = null,
}) {
  const snapshot = requireVerificationSnapshot({
    source_head_sha: sourceHeadSha,
    controlled_tree_sha256: controlledTreeSha256,
  })
  const resolved = resolvedSnapshot
    ?? await resolvePhase5VerificationSourceSnapshot({
      repoRoot,
      ...snapshot,
    })
  requireCondition(
    resolved.source_head_sha === snapshot.source_head_sha
      && resolved.controlled_tree_sha256
        === snapshot.controlled_tree_sha256
      && SHA256.test(resolved.test_file_blobs_sha256),
    'offline runner resolved source snapshot drift',
  )
  const sourceRoot = await realpath(resolve(repoRoot))
  const before = await captureRunnerSourceState(sourceRoot)
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), 'phase-05-offline-runner-'),
  )
  const isolatedRepository = join(temporaryRoot, 'repository')
  let result
  try {
    const environment = isolatedRunnerEnvironment(temporaryRoot)
    await execFileAsync('git', [
      'clone',
      '--quiet',
      '--no-checkout',
      '--shared',
      '--',
      sourceRoot,
      isolatedRepository,
    ], {
      encoding: 'buffer',
      env: environment,
      maxBuffer: MAX_GIT_BUFFER,
    })
    await execFileAsync('git', [
      'checkout',
      '--quiet',
      '--detach',
      snapshot.source_head_sha,
    ], {
      cwd: isolatedRepository,
      encoding: 'buffer',
      env: environment,
      maxBuffer: MAX_GIT_BUFFER,
    })
    let tapBytes
    let exit = 0
    try {
      const execution = await execFileAsync(process.execPath, [
        '--test',
        '--test-reporter=tap',
        ...PHASE_5_OFFLINE_TEST_FILES,
      ], {
        cwd: isolatedRepository,
        encoding: 'buffer',
        env: environment,
        maxBuffer: MAX_GIT_BUFFER,
      })
      tapBytes = execution.stdout
    } catch (error) {
      tapBytes = Buffer.isBuffer(error?.stdout)
        ? error.stdout
        : Buffer.from(error?.stdout ?? '')
      exit = Number.isSafeInteger(error?.code) && error.code >= 0
        ? error.code
        : 1
    }
    result = normalizePhase5OfflineRunnerResult({
      ...snapshot,
      test_file_blobs_sha256: resolved.test_file_blobs_sha256,
      ...parsePhase5TapResult(tapBytes, exit),
    })
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
    const after = await captureRunnerSourceState(sourceRoot)
    requireCondition(
      before.head.equals(after.head)
        && before.status.equals(after.status),
      'offline runner mutated the source repository',
    )
  }
  return result
}

export async function assertCompleteVerificationDocument(
  text,
  expectedStatus,
  expectedSnapshot = null,
  repoRoot = null,
  runOfflineSuite = runPhase5OfflineSuiteAtSourceSnapshot,
) {
  requireCondition(
    expectedStatus === 'gaps_found' || expectedStatus === 'passed',
    'verification expected status is invalid',
  )
  const parsed = parseFrontmatter(text, 'verification report')
  requireCondition(
    parsed.fields.get('phase') === '05-outreach-feasibility-gate',
    'verification report phase drift',
  )
  requireCondition(
    parsed.fields.get('status') === expectedStatus,
    'verification report status drift',
  )
  requireCondition(
    parsed.fields.get('behavior_unverified') === '0'
      && parsed.fields.get('overrides_applied') === '0',
    'verification report contains unverified behavior or overrides',
  )
  const scoreMatch = /^(\d+)\/(\d+) must-haves verified$/.exec(
    parsed.fields.get('score') ?? '',
  )
  requireCondition(
    scoreMatch !== null,
    'verification report score drift',
  )
  const numerator = Number(scoreMatch[1])
  const denominator = Number(scoreMatch[2])
  requireCondition(
    Number.isSafeInteger(numerator)
      && Number.isSafeInteger(denominator)
      && numerator >= 0
      && denominator > 0
      && numerator <= denominator,
    'verification report score is out of range',
  )
  requireCondition(
    parsed.body.startsWith(
      '# Phase 5: Outreach Feasibility Gate Verification Report',
    ),
    'verification report title drift',
  )
  requireCondition(
    parsed.body.includes('## Goal Achievement')
      && parsed.body.includes('## Requirements Coverage'),
    'verification report structure drift',
  )
  const truthRows = markdownTableAtHeading(
    parsed.body,
    /^### Observable Truths$/,
    ['#', 'Truth', 'Status', 'Evidence'],
    'verification Observable Truths',
  )
  let passedEvidence = null
  let verificationSnapshot = null
  if (expectedStatus === 'passed') {
    verificationSnapshot = passedVerificationSnapshot(
      truthRows[0]?.[3],
      'verification truth 1 evidence',
    )
    requireCondition(
      expectedSnapshot !== null,
      'passed verification requires an expected source snapshot',
    )
    const requiredSnapshot = requireVerificationSnapshot(expectedSnapshot)
    requireCondition(
      isDeepStrictEqual(verificationSnapshot, requiredSnapshot),
      'verification evidence source snapshot drift',
    )
    const resolvedSnapshot =
      await resolvePhase5VerificationSourceSnapshot({
      repoRoot,
      ...requiredSnapshot,
    })
    requireCondition(
      typeof runOfflineSuite === 'function',
      'verification offline runner is unavailable',
    )
    const actualRunnerResult = requirePhase5OfflineRunnerResult(
      await runOfflineSuite({
        repoRoot,
        ...requiredSnapshot,
        resolvedSnapshot,
      }),
    )
    requireCondition(
      actualRunnerResult.source_head_sha
        === requiredSnapshot.source_head_sha
        && actualRunnerResult.controlled_tree_sha256
          === requiredSnapshot.controlled_tree_sha256
        && (
          runOfflineSuite !== runPhase5OfflineSuiteAtSourceSnapshot
          || actualRunnerResult.test_file_blobs_sha256
            === resolvedSnapshot.test_file_blobs_sha256
        )
        && actualRunnerResult.exit === 0
        && actualRunnerResult.tests === PHASE_5_OFFLINE_TEST_COUNT
        && actualRunnerResult.pass === actualRunnerResult.tests
        && actualRunnerResult.fail === 0
        && actualRunnerResult.cancelled === 0
        && actualRunnerResult.skipped === 0
        && actualRunnerResult.todo === 0,
      'verification actual offline runner did not pass completely',
    )
    const commandEvidence = truthRows.find(
      ([idText]) => idText === '18',
    )?.[3]
    const commandMatch = COMMAND_VERIFICATION_EVIDENCE.exec(
      commandEvidence ?? '',
    )
    requireCondition(
      commandMatch !== null
        && commandMatch[1] === PHASE_5_OFFLINE_TEST_COMMAND_SHA256
        && commandMatch[2]
          === PHASE_5_OFFLINE_TEST_FILE_INVENTORY_SHA256
        && commandMatch[3]
          === actualRunnerResult.test_file_blobs_sha256
        && commandMatch[4] === sha256Json(actualRunnerResult)
        && Number(commandMatch[5]) === actualRunnerResult.tests
        && Number(commandMatch[6]) === actualRunnerResult.pass
        && Number(commandMatch[7]) === actualRunnerResult.fail
        && Number(commandMatch[8]) === actualRunnerResult.cancelled
        && Number(commandMatch[9]) === actualRunnerResult.skipped
        && Number(commandMatch[10]) === actualRunnerResult.todo
        && commandMatch[11] === verificationSnapshot.source_head_sha
        && commandMatch[12]
          === verificationSnapshot.controlled_tree_sha256,
      'verification offline command evidence drift',
    )
    passedEvidence = buildPhase5PassedVerificationEvidence({
      ...verificationSnapshot,
      runner_result: actualRunnerResult,
    })
  }
  const truthInventory = []
  let verifiedTruths = 0
  for (const [idText, truth, status, evidence] of truthRows) {
    requireCondition(/^[1-9]\d*$/.test(idText),
      'verification truth ID is malformed')
    const id = Number(idText)
    requireCondition(Number.isSafeInteger(id),
      'verification truth ID is out of range')
    truthInventory.push([id, truth])
    requireSafeTableCell(truth, `verification truth ${id}`)
    requireSafeTableCell(status, `verification truth ${id} status`)
    if (expectedStatus === 'passed') {
      requireCondition(
        evidence === passedEvidence.truths[id],
        `verification truth ${id} evidence contract drift`,
      )
    } else {
      requireVerificationEvidence(
        evidence,
        `verification truth ${id} evidence`,
      )
    }
    if (status === '✓ VERIFIED') verifiedTruths += 1
    if (expectedStatus === 'passed') {
      requireCondition(
        status === '✓ VERIFIED',
        'passed verification contains a non-verified truth',
      )
    }
  }
  requireCondition(
    isDeepStrictEqual(
      truthInventory,
      expectedStatus === 'passed'
        ? PHASE_5_VERIFICATION_TRUTHS
        : PHASE_5_SOURCE_GAPS_VERIFICATION_TRUTHS,
    ),
    'verification truth inventory drift',
  )
  requireCondition(
    denominator === truthRows.length
      && numerator === verifiedTruths,
    'verification score does not match the complete truth inventory',
  )
  if (expectedStatus === 'passed') {
    requireCondition(
      numerator === denominator,
      'passed verification must have a positive complete N/N score',
    )
  }

  const requirementRows = markdownTableAtHeading(
    parsed.body,
    /^#{2,3} Requirements Coverage$/,
    ['Requirement', 'Source Plans', 'Description', 'Status', 'Evidence'],
    'verification Requirements Coverage',
  )
  const requirementInventory = []
  for (const [id, plans, description, status, evidence] of requirementRows) {
    requireCondition(/^OUTR-\d{2}$/.test(id),
      'verification requirement ID is malformed')
    requirementInventory.push({ id, description })
    requireSafeTableCell(plans, `${id} source plans`)
    requireSafeTableCell(description, `${id} description`)
    requireSafeTableCell(status, `${id} status`)
    if (expectedStatus === 'passed') {
      requireCondition(
        evidence === passedEvidence.requirements[id],
        `verification requirement ${id} evidence contract drift`,
      )
    } else {
      requireVerificationEvidence(evidence, `${id} evidence`)
    }
    requireCondition(
      plans === (
        expectedStatus === 'passed'
          ? '05-01 through 05-23'
          : '05-01 through 05-19'
      ),
      `verification requirement ${id} source-plan mapping drift`,
    )
    if (expectedStatus === 'passed') {
      requireCondition(
        status === '✓ VERIFIED' || status === '✓ COMPLETE',
        `passed verification requirement ${id} is not verified`,
      )
    }
  }
  requireCondition(
    isDeepStrictEqual(
      requirementInventory,
      PHASE_5_VERIFICATION_REQUIREMENTS,
    ),
    'verification requirement inventory drift',
  )
  return {
    status: expectedStatus,
    numerator,
    denominator,
    truth_count: truthRows.length,
    verified_truth_count: verifiedTruths,
    requirements: requirementInventory.map(({ id }) => id),
  }
}

function assertGapPlanDocument(text, planId) {
  const label = `Plan 05-${planId} document`
  const parsed = parseFrontmatter(text, label)
  requireCondition(
    parsed.fields.get('phase') === '05-outreach-feasibility-gate'
      && parsed.fields.get('plan') === String(Number(planId))
      && parsed.fields.get('type') === 'execute'
      && parsed.fields.get('gap_closure') === 'true',
    `${label} frontmatter drift`,
  )
  requireCondition(
    isDeepStrictEqual(
      frontmatterList(text, 'requirements', label),
      ['OUTR-04', 'OUTR-05'],
    ),
    `${label} requirements drift`,
  )
  requireCondition(
    !/<task\b[^>]*\btype="checkpoint:/i.test(text),
    `${label} cannot own a checkpoint`,
  )
  for (const action of text.matchAll(/<action>([\s\S]*?)<\/action>/g)) {
    requireCondition(
      !/node\s+[^\n]*terminal-audit\.mjs\s+[^\n]*--terminal-audit/.test(
        action[1],
      )
        && !/(?:write|overwrite|hand-edit)\s+`?05-REVIEW\.md/i.test(
          action[1],
        ),
      `${label} cannot own review or authoritative audit`,
    )
  }
}

function assertSummaryDocument(text, planId) {
  const label = `Plan 05-${planId} summary`
  const parsed = parseFrontmatter(text, label)
  requireCondition(
    parsed.fields.get('phase') === '05-outreach-feasibility-gate'
      && parsed.fields.get('plan') === String(Number(planId))
      && parsed.fields.get('status') === 'complete',
    `${label} frontmatter drift`,
  )
  requireCondition(
    new RegExp(`^# Phase 05 Plan ${planId}:|^# Phase 05 Plan ${planId}\\b`, 'm')
      .test(parsed.body),
    `${label} title drift`,
  )
  requireCondition(
    parsed.body.includes('## Self-Check: PASSED'),
    `${label} self-check missing`,
  )
}

function uniqueLineMatch(lines, pattern, label, {
  start = 0,
  end = lines.length,
} = {}) {
  const matches = []
  for (let index = start; index < end; index += 1) {
    const match = pattern.exec(lines[index])
    if (match) matches.push({ index, match })
  }
  requireCondition(matches.length === 1, `${label} is missing or duplicated`)
  return matches[0]
}

function requireBoundedCount(numeratorText, denominatorText, label, {
  maximum = 100,
  allowedDenominators = null,
} = {}) {
  const numerator = Number(numeratorText)
  const denominator = Number(denominatorText)
  requireCondition(
    Number.isSafeInteger(numerator)
      && Number.isSafeInteger(denominator)
      && denominator > 0
      && denominator <= maximum
      && numerator >= 0
      && numerator <= denominator
      && (
        allowedDenominators === null
        || allowedDenominators.includes(denominator)
      ),
    `${label} is out of range`,
  )
  return { numerator, denominator }
}

function projectRoadmap(text) {
  requireCondition(
    !/Phase\s+(?:6|7)\b/i.test(text)
      && /RIGHTS_NO_GO|rights no-go/i.test(text),
    'ROADMAP Phase 5 terminal state drift',
  )
  let lines = text.split('\n')
  const phaseHeadings = lines.filter((line) => /^### Phase 5\b/.test(line))
  requireCondition(
    isDeepStrictEqual(
      phaseHeadings,
      ['### Phase 5: Outreach Feasibility Gate'],
    ),
    'ROADMAP Phase 5 section is missing or ambiguous',
  )
  const thirdCriterion = uniqueLineMatch(
    lines,
    /^  3\. The owner records a clear go decision only if both the rights\/posture review and the representative search-quality evidence are acceptable;/,
    'ROADMAP Phase 5 third success criterion',
  )
  if (lines[thirdCriterion.index - 1] === '') {
    lines.splice(thirdCriterion.index - 1, 1)
  }
  requireCondition(
    /^     Phase 5 terminal branch: the D-09\/D-10 rights prerequisite did not clear,/.test(
      lines[
        lines.findIndex((line) =>
          /^  3\. The owner records a clear go decision only if both/.test(line)
        ) - 1
      ],
    ),
    'ROADMAP Phase 5 success criteria moved',
  )
  const phaseRow = uniqueLineMatch(
    lines,
    /^- \[([ x])\] \*\*Phase 5: Outreach Feasibility Gate\*\* — (.+)$/,
    'ROADMAP Phase 5 checklist row',
  )
  requireSafeTableCell(phaseRow.match[2], 'ROADMAP Phase 5 description')
  lines[phaseRow.index] = lines[phaseRow.index].replace(
    /^- \[[ x]\]/,
    '- [@]',
  )

  const primaryPlans = uniqueLineMatch(
    lines,
    /^\*\*Plans\*\*: (\d+)\/(\d+) plans executed$/,
    'ROADMAP Phase 5 primary plan count',
  )
  requireBoundedCount(
    primaryPlans.match[1],
    primaryPlans.match[2],
    'ROADMAP Phase 5 primary plan count',
    { maximum: 23 },
  )
  lines[primaryPlans.index] = '**Plans**: @/@ plans executed'

  uniqueLineMatch(
    lines,
    /^Phase 5 final plan count \(the immutable source-snapshot line above is retained for audit\): \*\*Plans\*\*: 10\/10 plans executed$/,
    'ROADMAP immutable source plan count',
  )
  const gapPlans = uniqueLineMatch(
    lines,
    /^Phase 5 current gap-closure cycle: \*\*Plans\*\*: (\d+)\/(\d+) plans executed$/,
    'ROADMAP Phase 5 gap plan count',
  )
  requireBoundedCount(
    gapPlans.match[1],
    gapPlans.match[2],
    'ROADMAP Phase 5 gap plan count',
    { maximum: 23, allowedDenominators: [19, 23] },
  )
  lines[gapPlans.index] =
    'Phase 5 current gap-closure cycle: **Plans**: @/@ plans executed'

  const plansHeading = uniqueLineMatch(
    lines,
    /^Plans:$/,
    'ROADMAP Phase 5 plan inventory heading',
  )
  const checklistRows = []
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^- \[([ x])\] 05-(\d{2})-PLAN\.md(.*)$/.exec(lines[index])
    if (match) checklistRows.push({ index, match })
  }
  const checklistIds = checklistRows.map(({ match }) => Number(match[2]))
  requireCondition(
    new Set(checklistIds).size === checklistIds.length,
    'ROADMAP Phase 5 plan checklist contains duplicates',
  )
  const primaryRows = checklistRows.filter(({ match }) =>
    Number(match[2]) <= 19
  )
  requireCondition(
    isDeepStrictEqual(
      primaryRows.map(({ match }) => Number(match[2])).sort((a, b) => a - b),
      Array.from({ length: 19 }, (_, index) => index + 1),
    )
      && primaryRows.every(({ match }) => /^ — \S/.test(match[3])),
    'ROADMAP Phase 5 primary plan checklist drift',
  )
  for (const row of primaryRows) {
    lines[row.index] = lines[row.index].replace(
      /^- \[[ x]\]/,
      '- [@]',
    )
  }
  const gapRows = checklistRows.filter(({ match }) => Number(match[2]) >= 20)
  requireCondition(
    gapRows.every(({ match }) =>
      Number(match[2]) <= 23 && match[3] === ''
    ),
    'ROADMAP Phase 5 gap checklist row drift',
  )
  if (gapRows.length > 0) {
    requireCondition(
      isDeepStrictEqual(
        gapRows.map(({ match }) => Number(match[2])).sort((a, b) => a - b),
        Array.from({ length: gapRows.length }, (_, index) => index + 20),
      ),
      'ROADMAP Phase 5 gap checklist is not contiguous',
    )
  }
  const firstPrimaryIndex = Math.min(...primaryRows.map(({ index }) => index))
  requireCondition(
    firstPrimaryIndex > plansHeading.index
      && lines
        .slice(plansHeading.index + 1, firstPrimaryIndex)
        .every((line) =>
          line === ''
          || /^- \[[ x]\] 05-(?:2[0-3])-PLAN\.md$/.test(line)
        ),
    'ROADMAP Phase 5 gap checklist moved outside its named inventory',
  )
  lines.splice(
    plansHeading.index + 1,
    firstPrimaryIndex - plansHeading.index - 1,
    '',
  )

  const progress = uniqueLineMatch(
    lines,
    /^\| 5\. Outreach Feasibility Gate \| v1\.1 \| (\d+)\/(\d+) \| (Planned|In Progress|Complete) ?\| (|—|\d{4}-\d{2}-\d{2}) \|$/,
    'ROADMAP Phase 5 progress row',
  )
  requireBoundedCount(
    progress.match[1],
    progress.match[2],
    'ROADMAP Phase 5 progress',
    { maximum: 23, allowedDenominators: [19, 23] },
  )
  if (progress.match[3] === 'Complete') {
    requireCondition(
      progress.match[1] === progress.match[2],
      'ROADMAP complete progress row must be N/N',
    )
  }
  lines[progress.index] =
    '| 5. Outreach Feasibility Gate | v1.1 | @/@ | @STATUS@ | @DATE@ |'
  return lines.join('\n')
}

function projectRequirements(text) {
  const lines = text.split('\n')
  requireCondition(
    lines.filter((line) => line === '## Traceability').length === 1
      && lines.filter((line) => line === '**Coverage:**').length === 1,
    'REQUIREMENTS tracking sections are missing or ambiguous',
  )
  const checklist = []
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^- \[([ x])\] \*\*(OUTR-\d{2})\*\*:/.exec(lines[index])
    if (match) checklist.push({ index, match })
  }
  const expectedIds = Array.from(
    { length: 17 },
    (_, index) => `OUTR-${String(index + 4).padStart(2, '0')}`,
  )
  requireCondition(
    isDeepStrictEqual(
      checklist.map(({ match }) => match[2]).sort(),
      [...expectedIds].sort(),
    )
      && new Set(checklist.map(({ match }) => match[2])).size
        === checklist.length,
    'REQUIREMENTS active requirement inventory drift',
  )
  for (const row of checklist) {
    if (!['OUTR-04', 'OUTR-05'].includes(row.match[2])) continue
    lines[row.index] = lines[row.index].replace(
      /^- \[[ x]\]/,
      '- [@]',
    )
  }

  const traceability = []
  for (let index = 0; index < lines.length; index += 1) {
    const match =
      /^\| (OUTR-\d{2}) \| Phase ([567]) \| (Pending|Complete) \|$/
        .exec(lines[index])
    if (match) traceability.push({ index, match })
  }
  requireCondition(
    isDeepStrictEqual(
      traceability.map(({ match }) => match[1]).sort(),
      [...expectedIds].sort(),
    )
      && new Set(traceability.map(({ match }) => match[1])).size
        === traceability.length,
    'REQUIREMENTS traceability inventory drift',
  )
  for (const row of traceability) {
    const expectedPhase = ['OUTR-04', 'OUTR-05'].includes(row.match[1])
      ? '5'
      : ['OUTR-07', 'OUTR-08', 'OUTR-12', 'OUTR-13',
          'OUTR-14', 'OUTR-15', 'OUTR-16'].includes(row.match[1])
        ? '6'
        : '7'
    requireCondition(
      row.match[2] === expectedPhase,
      `REQUIREMENTS ${row.match[1]} phase drift`,
    )
    if (['OUTR-04', 'OUTR-05'].includes(row.match[1])) {
      lines[row.index] =
        `| ${row.match[1]} | Phase 5 | @STATUS@ |`
    }
  }

  const total = uniqueLineMatch(
    lines,
    /^- v1\.1 requirements: (\d+) total$/,
    'REQUIREMENTS coverage total',
  )
  const mapped = uniqueLineMatch(
    lines,
    /^- Mapped to phases: (\d+)$/,
    'REQUIREMENTS mapped coverage',
  )
  const unmapped = uniqueLineMatch(
    lines,
    /^- Unmapped: (\d+) ✓$/,
    'REQUIREMENTS unmapped coverage',
  )
  const counts = [total, mapped, unmapped].map(({ match }) => Number(match[1]))
  requireCondition(
    counts.every((value) => Number.isSafeInteger(value) && value >= 0)
      && counts[0] === counts[1] + counts[2]
      && counts[0] <= 100,
    'REQUIREMENTS coverage counters are inconsistent',
  )
  lines[total.index] = '- v1.1 requirements: @ total'
  lines[mapped.index] = '- Mapped to phases: @'
  lines[unmapped.index] = '- Unmapped: @ ✓'
  return lines.join('\n')
}

function requireCanonicalDate(value, label) {
  requireCondition(/^\d{4}-\d{2}-\d{2}$/.test(value), `${label} is malformed`)
  const date = new Date(`${value}T00:00:00.000Z`)
  requireCondition(
    !Number.isNaN(date.getTime())
      && date.toISOString().slice(0, 10) === value,
    `${label} is not a calendar date`,
  )
}

function projectState(text) {
  const lines = text.split('\n')
  requireCondition(lines[0] === '---', 'STATE frontmatter missing')
  const frontmatterEnd = lines.indexOf('---', 1)
  requireCondition(frontmatterEnd > 1, 'STATE frontmatter is malformed')
  uniqueLineMatch(
    lines,
    /^current_phase: 05$/,
    'STATE current_phase',
    { start: 1, end: frontmatterEnd },
  )
  uniqueLineMatch(
    lines,
    /^current_phase_name: outreach-feasibility-gate$/,
    'STATE current_phase_name',
    { start: 1, end: frontmatterEnd },
  )
  const frontmatterStatus = uniqueLineMatch(
    lines,
    /^status: (planned|executing|verifying|complete)$/,
    'STATE status',
    { start: 1, end: frontmatterEnd },
  )
  lines[frontmatterStatus.index] = 'status: @STATUS@'
  const stoppedAt = uniqueLineMatch(
    lines,
    /^stopped_at: (.{1,300})$/,
    'STATE stopped_at',
    { start: 1, end: frontmatterEnd },
  )
  lines[stoppedAt.index] = 'stopped_at: @STOPPED_AT@'
  const lastUpdated = uniqueLineMatch(
    lines,
    /^last_updated: "?([^"]+)"?$/,
    'STATE last_updated',
    { start: 1, end: frontmatterEnd },
  )
  requireCanonicalUtcTimestamp(lastUpdated.match[1], 'STATE last_updated')
  lines[lastUpdated.index] = 'last_updated: @TIMESTAMP@'
  const lastActivity = uniqueLineMatch(
    lines,
    /^last_activity: (\d{4}-\d{2}-\d{2})$/,
    'STATE last_activity',
    { start: 1, end: frontmatterEnd },
  )
  requireCanonicalDate(lastActivity.match[1], 'STATE last_activity')
  lines[lastActivity.index] = 'last_activity: @DATE@'
  const activityDescription = uniqueLineMatch(
    lines,
    /^last_activity_desc: (.{1,300})$/,
    'STATE last_activity_desc',
    { start: 1, end: frontmatterEnd },
  )
  lines[activityDescription.index] = 'last_activity_desc: @ACTIVITY@'

  const progressFields = new Map()
  for (const [key, maximum] of [
    ['total_phases', 100],
    ['completed_phases', 100],
    ['total_plans', 23],
    ['completed_plans', 23],
    ['percent', 100],
  ]) {
    const field = uniqueLineMatch(
      lines,
      new RegExp(`^  ${key}: (\\d+)$`),
      `STATE progress.${key}`,
      { start: 1, end: frontmatterEnd },
    )
    const value = Number(field.match[1])
    requireCondition(
      Number.isSafeInteger(value) && value >= 0 && value <= maximum,
      `STATE progress.${key} is out of range`,
    )
    progressFields.set(key, value)
    lines[field.index] = `  ${key}: @`
  }
  requireCondition(
    progressFields.get('completed_phases')
      <= progressFields.get('total_phases')
      && progressFields.get('completed_plans')
        <= progressFields.get('total_plans'),
    'STATE progress counters are inconsistent',
  )

  const phasePosition = uniqueLineMatch(
    lines,
    /^Phase: 05 \(outreach-feasibility-gate\) — (PLANNED|EXECUTING|VERIFYING|COMPLETE)$/,
    'STATE Phase 05 position',
  )
  lines[phasePosition.index] =
    'Phase: 05 (outreach-feasibility-gate) — @POSITION@'
  const planPosition = uniqueLineMatch(
    lines,
    /^Plan: (\d+) of (\d+)$/,
    'STATE Phase 05 plan position',
  )
  requireBoundedCount(
    planPosition.match[1],
    planPosition.match[2],
    'STATE Phase 05 plan position',
    { maximum: 23, allowedDenominators: [19, 23] },
  )
  lines[planPosition.index] = 'Plan: @ of @'
  const bodyStatus = uniqueLineMatch(
    lines,
    /^Status: (Ready to execute|Executing Phase 05|Phase 05 complete|Phase complete|Phase complete — ready for verification|Complete)$/,
    'STATE Phase 05 body status',
  )
  lines[bodyStatus.index] = 'Status: @STATUS@'
  const bodyActivity = uniqueLineMatch(
    lines,
    /^Last activity: (\d{4}-\d{2}-\d{2}) — (.{1,300})$/,
    'STATE Phase 05 body activity',
  )
  requireCanonicalDate(bodyActivity.match[1], 'STATE body activity date')
  lines[bodyActivity.index] = 'Last activity: @DATE@ — @ACTIVITY@'

  const metricRows = []
  for (let index = 0; index < lines.length; index += 1) {
    const match =
      /^\| Phase 05 P(\d{2}) \| (\d+(?:\s*(?:m|min)|h(?:\s*\d+m)?)(?: elapsed)?|-) \| (\d+) (tasks?|checkpoint) \| (\d+) ([^|]*files?) \|$/
        .exec(lines[index])
    if (match) metricRows.push({ index, match })
  }
  requireCondition(
    new Set(metricRows.map(({ match }) => match[1])).size
      === metricRows.length,
    'STATE Phase 05 metric rows contain duplicates',
  )
  const sourceMetricIds = ['01', '02', '04', '05', '06', '08', '07', '10', '09']
  requireCondition(
    sourceMetricIds.every((id) =>
      metricRows.some(({ match }) => match[1] === id)
    ),
    'STATE source Phase 05 metric inventory drift',
  )
  const newMetricIndices = metricRows
    .filter(({ match }) => Number(match[1]) >= 11)
    .map(({ index, match }) => {
      requireCondition(
        Number(match[1]) <= 23
          && Number(match[3]) >= 0
          && Number(match[5]) >= 0,
        'STATE Phase 05 metric row is out of range',
      )
      return index
    })
    .sort((a, b) => b - a)
  for (const index of newMetricIndices) lines.splice(index, 1)

  requireCondition(
    lines.filter((line) => line === '## Session Continuity').length === 1,
    'STATE Session Continuity section is missing or ambiguous',
  )
  const lastSession = uniqueLineMatch(
    lines,
    /^Last session: (.+)$/,
    'STATE last session',
  )
  requireCanonicalUtcTimestamp(lastSession.match[1], 'STATE last session')
  lines[lastSession.index] = 'Last session: @TIMESTAMP@'
  const completionTimestamp = uniqueLineMatch(
    lines,
    /^Phase 05 complete session timestamp: (.+)$/,
    'STATE Phase 05 completion timestamp',
  )
  requireCanonicalUtcTimestamp(
    completionTimestamp.match[1],
    'STATE Phase 05 completion timestamp',
  )
  lines[completionTimestamp.index] =
    'Phase 05 complete session timestamp: @TIMESTAMP@'
  const bodyStoppedAt = uniqueLineMatch(
    lines,
    /^Stopped at: (.{1,300})$/,
    'STATE session stopped_at',
  )
  lines[bodyStoppedAt.index] = 'Stopped at: @STOPPED_AT@'
  const completionHandoff = uniqueLineMatch(
    lines,
    /^Phase 05 complete session handoff: (.{1,300})$/,
    'STATE Phase 05 session handoff',
  )
  lines[completionHandoff.index] =
    'Phase 05 complete session handoff: @HANDOFF@'
  const resumeFile = uniqueLineMatch(
    lines,
    /^Resume file: (None|\.planning\/[A-Za-z0-9._/-]+)$/,
    'STATE resume file',
  )
  lines[resumeFile.index] = 'Resume file: @RESUME@'
  return lines.join('\n')
}

function assertTrackingTransition(path, beforeText, afterText) {
  let beforeProjection
  let afterProjection
  if (path === '.planning/ROADMAP.md') {
    beforeProjection = projectRoadmap(beforeText)
    afterProjection = projectRoadmap(afterText)
  } else if (path === '.planning/REQUIREMENTS.md') {
    beforeProjection = projectRequirements(beforeText)
    afterProjection = projectRequirements(afterText)
  } else {
    requireCondition(path === '.planning/STATE.md',
      'unknown tracking document')
    beforeProjection = projectState(beforeText)
    afterProjection = projectState(afterText)
  }
  requireCondition(
    beforeProjection === afterProjection,
    `${path} changed outside exact Phase 5 bookkeeping`,
  )
}

async function treeEntryAt(roots, commit, path) {
  const bytes = await runGit(roots.repoRoot, [
    'ls-tree',
    '-z',
    commit,
    '--',
    path,
  ])
  const entries = parseTreeEntries(
    decodeGitOutput(bytes, 'Git administrative tree'),
    'administrative_tail',
  )
  requireCondition(entries.length <= 1, 'administrative path is ambiguous')
  return entries[0] ?? null
}

async function tailCommits(roots) {
  if (roots.sourceHeadSha === 'HEAD') return []
  const headBytes = await runGit(roots.repoRoot, ['rev-parse', 'HEAD'])
  const head = decodeGitOutput(headBytes, 'Git HEAD').trim()
  if (head === roots.sourceHeadSha) return []
  const bytes = await runGit(roots.repoRoot, [
    'rev-list',
    '--reverse',
    '--ancestry-path',
    `${roots.sourceHeadSha}..${head}`,
  ])
  const commits = decodeGitOutput(bytes, 'Git administrative range')
    .trim()
    .split('\n')
    .filter(Boolean)
  requireCondition(
    commits.every((commit) => SHA.test(commit)),
    'administrative commit range is malformed',
  )
  return commits
}

function parseNameStatus(output) {
  if (output === '') return []
  const tokens = output.split('\0')
  if (tokens.at(-1) === '') tokens.pop()
  const changes = []
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++]
    requireCondition(/^[AMD]$/.test(status),
      'administrative change status is unsupported')
    requireCondition(index < tokens.length,
      'administrative change path is missing')
    changes.push({ status, path: tokens[index++] })
  }
  return changes
}

async function readTreeEntryBytes(roots, entry, cache) {
  if (!entry) return null
  return readGitBlob(roots, entry.oid, cache)
}

async function requiredTreeBlob(roots, commit, path, cache, label) {
  const entry = await treeEntryAt(roots, commit, path)
  requireCondition(entry !== null, `${label} is missing`)
  return {
    entry,
    bytes: await readTreeEntryBytes(roots, entry, cache),
  }
}

async function authenticatedEvidenceTripleAt(
  roots,
  commit,
  blobCache,
) {
  const artifacts = {}
  const objectIds = {}
  for (const path of AUTHENTICATED_REBIND_PATHS) {
    const { entry, bytes } = await requiredTreeBlob(
      roots,
      commit,
      path,
      blobCache,
      'authenticated lineage artifact',
    )
    artifacts[path] = inspectJsonBytes(
      bytes,
      'phase_commit_range',
      path,
    )
    objectIds[path] = entry.oid
  }
  return {
    decision:
      artifacts[`${PHASE_DIR_RELATIVE}/05-DECISION.json`],
    residue:
      artifacts[`${PHASE_DIR_RELATIVE}/05-ZERO-RESIDUE.json`],
    reconciliation:
      artifacts[
        `${PHASE_DIR_RELATIVE}/05-CONTRACT-RECONCILIATION.json`
      ],
    objectIds,
  }
}

function assertAuthenticatedEvidenceTripleBindings({
  decision,
  residue,
  reconciliation,
}) {
  requireCondition(
    decision.schema_version === 3
      && [3, 4].includes(residue.schema_version)
      && reconciliation.schema_version === 2,
    'authenticated lineage requires decision v3, residue v3/v4, and reconciliation v2',
  )
  for (const key of [
    'rights_evidence_sha256',
    'quality_evidence_sha256',
    'checkpointed_decision_contract_sha256',
    'decision_contract_sha256',
    'owner_checkpoint_evidence_sha256',
    'zero_residue_sha256',
  ]) {
    requireCondition(
      reconciliation[key] === decision[key]
        && (
          key === 'checkpointed_decision_contract_sha256'
          || residue[key] === decision[key]
        ),
      `authenticated reconciliation binding drift: ${key}`,
    )
  }
  for (const key of AUTHORIZATION_FIELD_KEYS) {
    if (!Object.hasOwn(reconciliation, key)) continue
    requireCondition(
      reconciliation[key] === decision[key]
        && reconciliation[key] === residue[key],
      `authenticated reconciliation authorization drift: ${key}`,
    )
  }
}

async function materializeGitProofPaths(
  roots,
  commit,
  blobCache,
) {
  const directory = await mkdtemp(
    join(tmpdir(), 'phase-05-lineage-proof-'),
  )
  try {
    const paths = []
    for (
      let index = 0;
      index < AUTHENTICATED_LINEAGE_PROOF_PATHS.length;
      index += 1
    ) {
      const sourcePath = AUTHENTICATED_LINEAGE_PROOF_PATHS[index]
      const { bytes } = await requiredTreeBlob(
        roots,
        commit,
        sourcePath,
        blobCache,
        'authenticated lineage proof',
      )
      const destination = join(
        directory,
        posix.basename(sourcePath),
      )
      await writeFile(destination, bytes, { mode: 0o600 })
      paths.push(destination)
    }
    return {
      directory,
      requestPath: paths[0],
      signaturePath: paths[1],
      trustAnchorPath: paths[2],
      publicKeyPath: paths[3],
      allowedSignersPath: paths[4],
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

async function authenticateGitEvidenceTriple({
  roots,
  commit,
  triple,
  blobCache,
  now,
}) {
  assertAuthenticatedEvidenceTripleBindings(triple)
  const proof = await materializeGitProofPaths(
    roots,
    commit,
    blobCache,
  )
  try {
    const assertion = triple.residue.schema_version === 3
      ? assertAuthenticatedAcceptedV3Lineage
      : assertAuthenticatedAcceptedEvidence
    await assertion({
      decision: triple.decision,
      residue: triple.residue,
      reconciliation: triple.reconciliation,
      requestPath: proof.requestPath,
      signaturePath: proof.signaturePath,
      trustAnchorPath: proof.trustAnchorPath,
      publicKeyPath: proof.publicKeyPath,
      allowedSignersPath: proof.allowedSignersPath,
      now,
    })
  } finally {
    await rm(proof.directory, { recursive: true, force: true })
  }
}

export async function resolveImmutableAuthenticatedV3Lineage({
  repoRoot,
  sourceHeadSha,
  now = null,
}) {
  const roots = await resolveAdministrativePolicyRoots({
    repoRoot,
    phaseDir: PHASE_DIR_RELATIVE,
    sourceHeadSha,
  })
  const visited = new Set()
  const blobCache = new Map()
  const chain = []
  let commit = sourceHeadSha

  for (
    let depth = 0;
    depth < MAX_AUTHENTICATED_LINEAGE_DEPTH;
    depth += 1
  ) {
    requireCondition(
      SHA.test(commit) && !visited.has(commit),
      'authenticated lineage is cyclic or malformed',
    )
    visited.add(commit)
    requireCondition(
      await runGit(roots.repoRoot, [
        'cat-file',
        '-e',
        `${commit}^{commit}`,
      ], { allowFailure: true }) !== null,
      'authenticated lineage commit is missing',
    )
    const triple = await authenticatedEvidenceTripleAt(
      roots,
      commit,
      blobCache,
    )
    await authenticateGitEvidenceTriple({
      roots,
      commit,
      triple,
      blobCache,
      now: now ?? new Date(
        triple.decision.owner_authorization_verified_at,
      ),
    })
    chain.push(Object.freeze({
      commit_sha: commit,
      residue_schema_version: triple.residue.schema_version,
      artifact_object_ids: Object.freeze({
        ...triple.objectIds,
      }),
    }))
    if (triple.residue.schema_version === 3) {
      return Object.freeze({
        commit_sha: commit,
        decision: triple.decision,
        residue: triple.residue,
        reconciliation: triple.reconciliation,
        chain: Object.freeze(chain),
      })
    }
    requireCondition(
      triple.residue.schema_version === 4,
      'authenticated lineage intermediate residue must use schema v4',
    )
    const next = triple.residue.source_snapshot?.head_sha
    requireCondition(
      typeof next === 'string'
        && SHA.test(next)
        && next !== commit
        && !visited.has(next),
      'authenticated lineage is cyclic or malformed',
    )
    requireCondition(
      await runGit(roots.repoRoot, [
        'merge-base',
        '--is-ancestor',
        next,
        commit,
      ], { allowFailure: true }) !== null,
      'authenticated lineage must move to a strict ancestor',
    )
    commit = next
  }
  throw new Error(
    `authenticated lineage exceeds ${MAX_AUTHENTICATED_LINEAGE_DEPTH} commits`,
  )
}

function isTailControlledPath(path) {
  return path.startsWith(`${SCRIPT_ROOT_RELATIVE}/`)
    || path.startsWith(`${PHASE_DIR_RELATIVE}/`)
    || [
      '.planning/ROADMAP.md',
      '.planning/REQUIREMENTS.md',
      '.planning/STATE.md',
    ].includes(path)
}

async function resolveAdministrativePolicyRoots({
  repoRoot,
  phaseDir,
  sourceHeadSha,
}) {
  requireCondition(
    typeof repoRoot === 'string' && repoRoot.trim().length > 0,
    'administrative repository root is required',
  )
  const requestedRoot = resolve(repoRoot)
  requireCondition(
    requestedRoot !== parse(requestedRoot).root
      && requestedRoot !== resolve(homedir()),
    'administrative repository root is unsafe',
  )
  const canonicalRoot = await realpath(requestedRoot)
  const topLevelBytes = await runGit(
    canonicalRoot,
    ['rev-parse', '--show-toplevel'],
    { allowFailure: true },
  )
  requireCondition(
    topLevelBytes !== null
      && await realpath(
        decodeGitOutput(topLevelBytes, 'Git root').trim(),
      ) === canonicalRoot,
    'administrative repository root is not the Git workspace root',
  )
  requireCondition(
    resolve(canonicalRoot, phaseDir ?? '') ===
      resolve(canonicalRoot, PHASE_DIR_RELATIVE),
    'administrative phase directory drift',
  )
  requireCondition(
    typeof sourceHeadSha === 'string' && SHA.test(sourceHeadSha),
    'administrative source head is malformed',
  )
  requireCondition(
    await runGit(canonicalRoot, [
      'merge-base',
      '--is-ancestor',
      sourceHeadSha,
      'HEAD',
    ], { allowFailure: true }) !== null,
    'administrative source head is not an ancestor of HEAD',
  )
  return {
    repoRoot: canonicalRoot,
    phaseDir: resolve(canonicalRoot, PHASE_DIR_RELATIVE),
    sourceHeadSha,
  }
}

function planningId(path) {
  const match = PHASE_PLAN_OR_SUMMARY.exec(path)
  return match
    ? { id: Number(match[1]), idText: match[1], kind: match[2] }
    : null
}

async function planningInventoryAt(roots, ref) {
  const bytes = await runGit(roots.repoRoot, [
    'ls-tree',
    '-r',
    '-z',
    '--full-tree',
    ref,
    '--',
    PHASE_DIR_RELATIVE,
  ])
  const inventory = new Map()
  for (const entry of parseTreeEntries(
    decodeGitOutput(bytes, 'Git planning inventory'),
    'administrative_tail',
  )) {
    const parsed = planningId(entry.path)
    if (parsed) inventory.set(entry.path, { ...entry, ...parsed })
  }
  return inventory
}

function requireContiguousInventory(entries, kind, label) {
  const ids = [...entries.values()]
    .filter((entry) => entry.kind === kind)
    .map((entry) => entry.id)
    .sort((left, right) => left - right)
  requireCondition(ids.length > 0, `${label} ${kind} inventory is empty`)
  requireCondition(
    isDeepStrictEqual(
      ids,
      Array.from({ length: ids.at(-1) }, (_, index) => index + 1),
    ),
    `${label} ${kind} inventory is not contiguous from 01`,
  )
  return ids.at(-1)
}

async function administrativePlanningEvents(roots) {
  const commits = await tailCommits(roots)
  const events = new Map()
  for (const commit of commits) {
    const changesBytes = await runGit(roots.repoRoot, [
      'diff-tree',
      '--no-commit-id',
      '--name-status',
      '--no-renames',
      '-r',
      '-z',
      `${commit}^`,
      commit,
    ])
    for (const change of parseNameStatus(
      decodeGitOutput(changesBytes, 'Git administrative planning changes'),
    )) {
      const path = normalizedGitPath(change.path, 'administrative_tail')
      if (!path.startsWith(`${PHASE_DIR_RELATIVE}/`)) continue
      const parsed = planningId(path)
      if (!parsed) {
        requireCondition(
          STATIC_ADMINISTRATIVE_TAIL_PATHS.includes(path),
          'administrative planning path is outside the finite policy',
        )
        continue
      }
      if (!events.has(path)) events.set(path, [])
      events.get(path).push({ commit, status: change.status })
    }
  }
  return events
}

async function readPlanningDocument(roots, ref, path, blobCache) {
  const entry = await treeEntryAt(roots, ref, path)
  requireCondition(entry !== null, 'administrative planning document missing')
  return decodeBounded(
    await readTreeEntryBytes(roots, entry, blobCache),
    'administrative_tail',
    path,
  )
}

export async function deriveAdministrativeTailPolicy(options) {
  const roots = await resolveAdministrativePolicyRoots(options)
  const source = await planningInventoryAt(roots, roots.sourceHeadSha)
  const final = await planningInventoryAt(roots, 'HEAD')
  const sourcePlanMax = requireContiguousInventory(
    source,
    'PLAN',
    'source planning',
  )
  const sourceSummaryMax = requireContiguousInventory(
    source,
    'SUMMARY',
    'source planning',
  )
  const finalPlanMax = requireContiguousInventory(
    final,
    'PLAN',
    'final planning',
  )
  const finalSummaryMax = requireContiguousInventory(
    final,
    'SUMMARY',
    'final planning',
  )
  requireCondition(
    sourceSummaryMax <= sourcePlanMax
      && finalPlanMax >= sourcePlanMax
      && finalSummaryMax >= sourceSummaryMax
      && finalSummaryMax <= finalPlanMax,
    'administrative plan/summary inventory is inconsistent',
  )

  const events = await administrativePlanningEvents(roots)
  const expectedNewPlans = Array.from(
    { length: finalPlanMax - sourcePlanMax },
    (_, index) => sourcePlanMax + index + 1,
  )
  const expectedPermittedSummaries = Array.from(
    { length: finalPlanMax - sourceSummaryMax },
    (_, index) => sourceSummaryMax + index + 1,
  )
  const dynamicPaths = []
  const blobCache = new Map()
  for (const [kind, ids] of [
    ['PLAN', expectedNewPlans],
    ['SUMMARY', expectedPermittedSummaries],
  ]) {
    for (const id of ids) {
      const idText = String(id).padStart(2, '0')
      const path =
        `${PHASE_DIR_RELATIVE}/05-${idText}-${kind}.md`
      const pathEvents = events.get(path) ?? []
      dynamicPaths.push(path)
      const existsAtFinal = final.has(path)
      if (kind === 'SUMMARY' && !existsAtFinal) {
        requireCondition(
          !source.has(path) && pathEvents.length === 0,
          'pending administrative summary must remain absent',
        )
        continue
      }
      requireCondition(
        !source.has(path)
          && existsAtFinal
          && pathEvents.length === 1
          && pathEvents[0].status === 'A',
        'administrative plan/summary must be created exactly once',
      )
      const text = await readPlanningDocument(
        roots,
        'HEAD',
        path,
        blobCache,
      )
      if (kind === 'PLAN') assertGapPlanDocument(text, idText)
      else {
        const planPath =
          `${PHASE_DIR_RELATIVE}/05-${idText}-PLAN.md`
        requireCondition(
          final.has(planPath),
          'administrative summary has no matching plan',
        )
        assertGapPlanDocument(
          await readPlanningDocument(
            roots,
            'HEAD',
            planPath,
            blobCache,
          ),
          idText,
        )
        assertSummaryDocument(text, idText)
      }
    }
  }

  for (const [path, pathEvents] of events) {
    const parsed = planningId(path)
    requireCondition(parsed, 'administrative planning path is invalid')
    requireCondition(
      dynamicPaths.includes(path)
        && pathEvents.length === 1
        && pathEvents[0].status === 'A',
      'administrative planning documents are create-once and immutable',
    )
  }

  const verificationEntry = await treeEntryAt(
    roots,
    'HEAD',
    VERIFICATION_PATH,
  )
  if (verificationEntry) {
    const verification = parseFrontmatter(
      decodeBounded(
        await readTreeEntryBytes(
          roots,
          verificationEntry,
          blobCache,
        ),
        'administrative_tail',
        VERIFICATION_PATH,
      ),
      'verification report',
    )
    if (verification.fields.get('status') === 'passed') {
      requireCondition(
        finalSummaryMax === finalPlanMax,
        'terminal administrative inventory has a plan without summary',
      )
    }
  }

  const allowedPaths = [
    ...STATIC_ADMINISTRATIVE_TAIL_PATHS,
    ...dynamicPaths,
  ].sort()
  requireCondition(
    new Set(allowedPaths).size === allowedPaths.length
      && allowedPaths.length <= 32,
    'administrative allowed path inventory is not finite and unique',
  )
  return Object.freeze({
    from_source_head_sha: roots.sourceHeadSha,
    allowed_paths: Object.freeze(allowedPaths),
    allowed_state_transitions: Object.freeze([
      ...ADMINISTRATIVE_TRANSITIONS_V4,
    ]),
    source_changes_allowed: false,
  })
}

async function validateTailPathEvents(
  roots,
  path,
  events,
  blobCache,
  policy,
  verificationSnapshot,
  verificationRunner,
) {
  const sourceEntry = await treeEntryAt(roots, roots.sourceHeadSha, path)
  const sourceBytes = await readTreeEntryBytes(roots, sourceEntry, blobCache)
  const finalEvent = events.at(-1)
  const finalBytes = finalEvent?.afterBytes ?? sourceBytes

  const planning = planningId(path)
  if (planning) {
    if (
      planning.kind === 'SUMMARY'
      && policy.allowed_paths.includes(path)
      && sourceEntry === null
      && events.length === 0
      && finalBytes === null
    ) {
      return 'plan_summary_contiguous_once'
    }
    requireCondition(
      policy.allowed_paths.includes(path)
        && sourceEntry === null
        && events.length === 1
        && events[0].status === 'A'
        && finalBytes !== null,
      'administrative plan/summary transition is invalid',
    )
    const text = decodeBounded(finalBytes, 'administrative_tail', path)
    if (planning.kind === 'PLAN') {
      assertGapPlanDocument(text, planning.idText)
    } else {
      assertSummaryDocument(text, planning.idText)
    }
    return 'plan_summary_contiguous_once'
  }

  if (path === `${PHASE_DIR_RELATIVE}/05-DECISION.json`) {
    requireCondition(events.length <= 2, 'decision changed more than twice')
    requireCondition(sourceBytes, 'decision transition is incomplete')
    const versions = [
      inspectJsonBytes(sourceBytes, 'administrative_tail', path)
        .schema_version,
      ...events.map((event) =>
        inspectJsonBytes(
          event.afterBytes,
          'administrative_tail',
          path,
        ).schema_version),
    ]
    const historicalTransition = isDeepStrictEqual(
      versions,
      Array.from(
        { length: versions.length },
        (_, index) => versions[0] + index,
      ),
    )
      && versions[0] >= 1
      && versions.at(-1) <= 3
    const terminalRebind = isDeepStrictEqual(versions, [3, 3])
    requireCondition(
      historicalTransition || terminalRebind,
      'decision transition must be historical v1 to v2 to v3 or one v3 terminal rebind',
    )
    return 'decision'
  }
  if (path === `${PHASE_DIR_RELATIVE}/05-ZERO-RESIDUE.json`) {
    requireCondition(
      events.length <= 3,
      'zero-residue changed more than three times',
    )
    requireCondition(sourceBytes, 'zero-residue transition is incomplete')
    const versions = [
      inspectJsonBytes(sourceBytes, 'administrative_tail', path)
        .schema_version,
      ...events.map((event) =>
        inspectJsonBytes(
          event.afterBytes,
          'administrative_tail',
          path,
        ).schema_version),
    ]
    const historicalTransition = isDeepStrictEqual(
      versions,
      Array.from(
        { length: versions.length },
        (_, index) => versions[0] + index,
      ),
    )
    const terminalRebind = isDeepStrictEqual(versions, [4, 4])
    requireCondition(
      historicalTransition || terminalRebind,
      'zero-residue transition must be v1 to v2 to v3 to v4 or one v4 terminal rebind',
    )
    requireCondition(
      versions[0] >= 1 && versions.at(-1) <= 4,
      'zero-residue transition version is outside v1 through v4',
    )
    return 'zero_residue'
  }
  if (
    path ===
    `${PHASE_DIR_RELATIVE}/05-CONTRACT-RECONCILIATION.json`
  ) {
    requireCondition(events.length <= 2,
      'reconciliation changed more than twice')
    if (sourceEntry === null) {
      if (events.length > 0) {
        requireCondition(
          events[0].status === 'A'
            && events.slice(1).every((event) => event.status === 'M'),
          'reconciliation must be created then modified',
        )
        const versions = events.map((event) =>
          inspectJsonBytes(
            event.afterBytes,
            'administrative_tail',
            path,
          ).schema_version)
        requireCondition(
          isDeepStrictEqual(
            versions,
            [1, 2].slice(0, versions.length),
          ),
          'reconciliation transition must be absent to v1 to v2',
        )
      }
    } else {
      requireCondition(sourceBytes !== null,
        'source reconciliation is incomplete')
      const before = inspectJsonBytes(
        sourceBytes,
        'administrative_tail',
        path,
      )
      requireCondition(events.length <= 1,
        'existing reconciliation changed more than once')
      if (events.length === 1) {
        const after = inspectJsonBytes(
          finalBytes,
          'administrative_tail',
          path,
        )
        requireCondition(
          events[0].status === 'M'
            && (
              (
                before.schema_version === 1
                && after.schema_version === 2
              )
              || (
                before.schema_version === 2
                && after.schema_version === 2
              )
            ),
          'reconciliation transition must be v1 to v2 or one v2 terminal rebind',
        )
      }
    }
    return 'contract_reconciliation'
  }
  if (path === `${PHASE_DIR_RELATIVE}/05-09-SUMMARY.md`) {
    requireCondition(
      events.length <= 1,
      'Plan 05-09 summary changed more than once',
    )
    if (sourceEntry !== null) {
      requireCondition(
        events.length === 0,
        'Plan 05-09 summary already complete at source must remain immutable',
      )
      assertSummaryDocument(
        decodeBounded(sourceBytes, 'administrative_tail', path),
        '09',
      )
    } else if (events.length === 1) {
      requireCondition(events[0].status === 'A',
        'Plan 05-09 summary must be created')
      assertSummaryDocument(
        decodeBounded(finalBytes, 'administrative_tail', path),
        '09',
      )
    }
    return 'summary'
  }
  if (path === `${PHASE_DIR_RELATIVE}/05-REVIEW.md`) {
    requireCondition(events.length <= 1, 'Phase 5 review changed more than once')
    if (events.length === 1) {
      requireCondition(
        sourceBytes !== null
          && finalBytes !== null
          && events[0].status === 'M',
        'Phase 5 review transition is incomplete',
      )
      assertPhase5ReviewLifecycle({
        priorReviewBytes: sourceBytes,
        finalReviewBytes: finalBytes,
        priorReviewSourceSha256: sha256Bytes(sourceBytes),
      })
    }
    return 'review'
  }
  if (path === VERIFICATION_PATH) {
    requireCondition(events.length <= 1,
      'verification changed more than once')
    const initialState = sourceBytes === null ? 'absent' : 'gaps_found'
    if (sourceBytes !== null) {
      await assertCompleteVerificationDocument(
        decodeBounded(sourceBytes, 'administrative_tail', path),
        'gaps_found',
      )
    }
    if (events.length === 1) {
      requireCondition(
        events[0].status === (sourceBytes === null ? 'A' : 'M'),
        'verification transition type drift',
      )
      await assertCompleteVerificationDocument(
        decodeBounded(finalBytes, 'administrative_tail', path),
        'passed',
        verificationSnapshot,
        roots.repoRoot,
        verificationRunner,
      )
    }
    return events.length === 0
      ? `${initialState}_pending`
      : `${initialState}_to_passed`
  }
  requireCondition(sourceBytes !== null, 'tracking document is missing')
  let previousText = decodeBounded(
    sourceBytes,
    'administrative_tail',
    path,
  )
  for (const event of events) {
    requireCondition(event.status === 'M',
      'tracking document must only be modified')
    const nextText = decodeBounded(
      event.afterBytes,
      'administrative_tail',
      path,
    )
    assertTrackingTransition(path, previousText, nextText)
    previousText = nextText
  }
  return path.endsWith('ROADMAP.md')
    ? 'roadmap'
    : path.endsWith('REQUIREMENTS.md')
      ? 'requirements'
      : 'state'
}

async function scanAdministrativeTail(
  roots,
  policy,
  verificationSnapshot,
  verificationRunner,
) {
  const headBytes = await runGit(roots.repoRoot, ['rev-parse', 'HEAD'])
  const headSha = decodeGitOutput(headBytes, 'Git HEAD').trim()
  requireCondition(SHA.test(headSha), 'live HEAD is malformed')
  const commits = await tailCommits(roots)
  const blobCache = new Map()
  await assertAuthenticatedRebindCommits(
    roots,
    [roots.sourceHeadSha, ...commits],
    blobCache,
  )
  const inventory = []
  const byPath = new Map()
  const allowedPathSet = new Set(policy.allowed_paths)

  for (const commit of commits) {
    const changesBytes = await runGit(roots.repoRoot, [
      'diff-tree',
      '--no-commit-id',
      '--name-status',
      '--no-renames',
      '-r',
      '-z',
      `${commit}^`,
      commit,
    ])
    const changes = parseNameStatus(
      decodeGitOutput(changesBytes, 'Git administrative changes'),
    )
    for (const change of changes) {
      const path = normalizedGitPath(change.path, 'administrative_tail')
      if (!isTailControlledPath(path)) continue
      if (!allowedPathSet.has(path)) {
        violation('administrative_tail', path, 'path outside tail policy')
      }
      if (change.status === 'D') {
        violation('administrative_tail', path, 'administrative deletion')
      }
      const beforeEntry = await treeEntryAt(roots, `${commit}^`, path)
      const afterEntry = await treeEntryAt(roots, commit, path)
      requireCondition(afterEntry, 'administrative blob is missing')
      const afterBytes = await readTreeEntryBytes(
        roots,
        afterEntry,
        blobCache,
      )
      decodeBounded(afterBytes, 'administrative_tail', path)
      const event = {
        commit,
        path,
        status: change.status,
        before_oid: beforeEntry?.oid ?? null,
        after_oid: afterEntry.oid,
        afterBytes,
      }
      if (!byPath.has(path)) byPath.set(path, [])
      byPath.get(path).push(event)
      inventory.push({
        commit,
        path,
        status: change.status,
        before_oid: event.before_oid,
        after_oid: event.after_oid,
        size: afterBytes.length,
        sha256: sha256Bytes(afterBytes),
      })
    }
  }

  const validatedTransitions = []
  let verificationLineage = null
  for (const path of policy.allowed_paths) {
    const transition = await validateTailPathEvents(
      roots,
      path,
      byPath.get(path) ?? [],
      blobCache,
      policy,
      verificationSnapshot,
      verificationRunner,
    )
    if (path === VERIFICATION_PATH) verificationLineage = transition
    for (const event of byPath.get(path) ?? []) {
      validatedTransitions.push({
        commit: event.commit,
        path,
        status: event.status,
        transition,
        before_oid: event.before_oid,
        after_oid: event.after_oid,
      })
    }
  }

  return {
    from_source_head_sha: roots.sourceHeadSha,
    head_sha: headSha,
    commit_count: commits.length,
    path_count: inventory.length,
    blob_count: new Set(inventory.map((entry) => entry.after_oid)).size,
    inventory_sha256: inventoryDigest(inventory),
    transitions: validatedTransitions,
    verification_lineage: verificationLineage,
  }
}

function requireNonnegativeInteger(value, label) {
  requireCondition(
    Number.isSafeInteger(value) && value >= 0,
    `${label} must be a nonnegative integer`,
  )
}

function assertInventorySurface(surface, keys, label, countKeys) {
  requireExactKeys(surface, keys, label)
  for (const key of countKeys) {
    requireNonnegativeInteger(surface[key], `${label}.${key}`)
  }
  requireCondition(
    typeof surface.inventory_sha256 === 'string'
      && SHA256.test(surface.inventory_sha256),
    `${label} inventory digest is malformed`,
  )
}

function assertScanShape(scan) {
  requireExactKeys(scan, [
    'checked_at',
    'scanned_roots',
    'source_snapshot',
    'git_surfaces',
    'administrative_tail_policy',
    'administrative_tail',
    'forbidden_hit_count',
    'unexpected_survivor_count',
    'symlink_count',
  ], 'residue scan')
  requireCondition(
    isDeepStrictEqual(scan.scanned_roots, SCANNED_ROOTS),
    'residue scan roots drift',
  )
  requireExactKeys(scan.source_snapshot, [
    'head_sha',
    'controlled_tree_sha256',
    'baseline_to_source_history_sha256',
  ], 'residue source snapshot')
  requireCondition(
    SHA.test(scan.source_snapshot.head_sha)
      && SHA256.test(scan.source_snapshot.controlled_tree_sha256)
      && SHA256.test(
        scan.source_snapshot.baseline_to_source_history_sha256,
      ),
    'residue source snapshot is malformed',
  )
  requireExactKeys(scan.git_surfaces, [
    'worktree',
    'index',
    'phase_commit_range',
    'source_head_tree',
  ], 'residue Git surfaces')
  assertInventorySurface(
    scan.git_surfaces.worktree,
    [
      'status_entry_count',
      'status_paths',
      'path_count',
      'blob_count',
      'inventory_sha256',
    ],
    'worktree surface',
    ['status_entry_count', 'path_count', 'blob_count'],
  )
  requireCondition(
    Array.isArray(scan.git_surfaces.worktree.status_paths)
      && scan.git_surfaces.worktree.status_entry_count
        === scan.git_surfaces.worktree.status_paths.length
      && isDeepStrictEqual(
        scan.git_surfaces.worktree.status_paths,
        [...scan.git_surfaces.worktree.status_paths].sort(),
      )
      && new Set(scan.git_surfaces.worktree.status_paths).size
        === scan.git_surfaces.worktree.status_paths.length,
    'worktree status path inventory drift',
  )
  assertInventorySurface(
    scan.git_surfaces.index,
    [
      'staged_path_count',
      'staged_paths',
      'path_count',
      'blob_count',
      'inventory_sha256',
    ],
    'index surface',
    ['staged_path_count', 'path_count', 'blob_count'],
  )
  requireCondition(
    Array.isArray(scan.git_surfaces.index.staged_paths)
      && scan.git_surfaces.index.staged_path_count
        === scan.git_surfaces.index.staged_paths.length
      && isDeepStrictEqual(
        scan.git_surfaces.index.staged_paths,
        [...scan.git_surfaces.index.staged_paths].sort(),
      )
      && new Set(scan.git_surfaces.index.staged_paths).size
        === scan.git_surfaces.index.staged_paths.length,
    'index staged path inventory drift',
  )
  assertInventorySurface(
    scan.git_surfaces.phase_commit_range,
    [
      'base_sha',
      'head_sha',
      'commit_count',
      'path_count',
      'blob_count',
      'inventory_sha256',
    ],
    'phase commit range surface',
    ['commit_count', 'path_count', 'blob_count'],
  )
  requireExactKeys(scan.git_surfaces.source_head_tree, [
    'head_sha',
    'path_count',
    'blob_count',
    'tree_sha256',
  ], 'source-head tree surface')
  requireCondition(
    SHA.test(scan.git_surfaces.phase_commit_range.base_sha)
      && SHA.test(scan.git_surfaces.phase_commit_range.head_sha)
      && SHA.test(scan.git_surfaces.source_head_tree.head_sha)
      && SHA256.test(scan.git_surfaces.source_head_tree.tree_sha256),
    'residue Git source identity is malformed',
  )
  for (const key of ['path_count', 'blob_count']) {
    requireNonnegativeInteger(
      scan.git_surfaces.source_head_tree[key],
      `source-head tree ${key}`,
    )
  }
  requireCondition(
    scan.source_snapshot.head_sha
      === scan.git_surfaces.phase_commit_range.head_sha
      && scan.source_snapshot.head_sha
        === scan.git_surfaces.source_head_tree.head_sha
      && scan.source_snapshot.controlled_tree_sha256
        === scan.git_surfaces.source_head_tree.tree_sha256
      && scan.source_snapshot.baseline_to_source_history_sha256
        === scan.git_surfaces.phase_commit_range.inventory_sha256,
    'residue source snapshot surface drift',
  )
  requireExactKeys(scan.administrative_tail, [
    'from_source_head_sha',
    'head_sha',
    'commit_count',
    'path_count',
    'blob_count',
    'inventory_sha256',
    'transitions',
    'verification_lineage',
  ], 'administrative tail')
  requireExactKeys(scan.administrative_tail_policy, [
    'from_source_head_sha',
    'allowed_paths',
    'allowed_state_transitions',
    'source_changes_allowed',
  ], 'administrative tail policy')
  requireCondition(
    scan.administrative_tail_policy.from_source_head_sha
      === scan.source_snapshot.head_sha
      && Array.isArray(scan.administrative_tail_policy.allowed_paths)
      && scan.administrative_tail_policy.allowed_paths.length <= 32
      && new Set(scan.administrative_tail_policy.allowed_paths).size
        === scan.administrative_tail_policy.allowed_paths.length
      && isDeepStrictEqual(
        scan.administrative_tail_policy.allowed_paths,
        [...scan.administrative_tail_policy.allowed_paths].sort(),
      )
      && isDeepStrictEqual(
        scan.administrative_tail_policy.allowed_state_transitions,
        ADMINISTRATIVE_TRANSITIONS_V4,
      )
      && scan.administrative_tail_policy.source_changes_allowed === false,
    'administrative tail policy drift',
  )
  requireCondition(
    scan.administrative_tail.from_source_head_sha
      === scan.source_snapshot.head_sha
      && SHA.test(scan.administrative_tail.head_sha)
      && SHA256.test(scan.administrative_tail.inventory_sha256)
      && Array.isArray(scan.administrative_tail.transitions),
    'administrative tail identity drift',
  )
  for (const key of ['commit_count', 'path_count', 'blob_count']) {
    requireNonnegativeInteger(
      scan.administrative_tail[key],
      `administrative tail ${key}`,
    )
  }
  requireCanonicalUtcTimestamp(scan.checked_at, 'residue scan time')
  for (const key of [
    'forbidden_hit_count',
    'unexpected_survivor_count',
    'symlink_count',
  ]) requireCondition(scan[key] === 0, `${key} must equal zero`)
  return scan
}

export async function scanOwnedSurfaces({
  repoRoot,
  phaseDir,
  baseline,
  sourceHeadSha,
  verificationRunner,
}) {
  const roots = await resolveScanRoots({
    repoRoot,
    phaseDir,
    baseline,
    sourceHeadSha,
  })
  const administrativeTailPolicy =
    await deriveAdministrativeTailPolicy({
      repoRoot: roots.repoRoot,
      phaseDir: PHASE_DIR_RELATIVE,
      sourceHeadSha: roots.sourceHeadSha,
    })
  const worktree = await scanWorktree(roots, administrativeTailPolicy)
  const index = await scanIndex(roots, administrativeTailPolicy)
  const phaseCommitRange = await scanPhaseCommitRange(roots)
  const sourceHeadTree = await scanSourceHeadTree(roots)
  const administrativeTail = await scanAdministrativeTail(
    roots,
    administrativeTailPolicy,
    {
      source_head_sha: roots.sourceHeadSha,
      controlled_tree_sha256: sourceHeadTree.tree_sha256,
    },
    verificationRunner,
  )
  const scan = {
    checked_at: new Date().toISOString(),
    scanned_roots: [...SCANNED_ROOTS],
    source_snapshot: {
      head_sha: roots.sourceHeadSha,
      controlled_tree_sha256: sourceHeadTree.tree_sha256,
      baseline_to_source_history_sha256:
        phaseCommitRange.inventory_sha256,
    },
    git_surfaces: {
      worktree,
      index,
      phase_commit_range: phaseCommitRange,
      source_head_tree: sourceHeadTree,
    },
    administrative_tail_policy:
      structuredClone(administrativeTailPolicy),
    administrative_tail: administrativeTail,
    forbidden_hit_count: 0,
    unexpected_survivor_count: 0,
    symlink_count: 0,
  }
  return assertScanShape(scan)
}

function embeddedBaseline(baseline) {
  return {
    base_sha: baseline.base_sha,
    plan_path: baseline.plan_path,
    plan_blob_sha256: baseline.plan_blob_sha256,
    baseline_evidence_sha256: baseline.baseline_evidence_sha256,
  }
}

export function buildZeroResidueRecord({
  matrix,
  qualityReport,
  decisionContract,
  ownerCheckpoint,
  baseline,
  scan,
}) {
  assertScanShape(scan)
  assertArtifactSchema(
    `${PHASE_DIR_RELATIVE}/05-RIGHTS-MATRIX.json`,
    matrix,
  )
  assertArtifactSchema(
    `${PHASE_DIR_RELATIVE}/05-QUALITY-REPORT.json`,
    qualityReport,
  )
  assertArtifactSchema(
    `${PHASE_DIR_RELATIVE}/05-DECISION.json`,
    decisionContract,
  )
  assertArtifactSchema(
    `${PHASE_DIR_RELATIVE}/05-OWNER-CHECKPOINT.json`,
    ownerCheckpoint,
  )
  assertArtifactSchema(
    `${PHASE_DIR_RELATIVE}/05-EXECUTION-BASELINE.json`,
    baseline,
  )
  requireCondition(
    decisionContract.owner_checkpoint_evidence_sha256
      === ownerCheckpoint.owner_checkpoint_evidence_sha256,
    'decision owner checkpoint digest drift',
  )
  requireCondition(
    baseline.baseline_evidence_sha256
      === ownerCheckpoint.baseline_evidence_sha256,
    'owner checkpoint baseline digest drift',
  )
  const authenticatedV4 = decisionContract.schema_version === 3
  const gitSurfaces = structuredClone(scan.git_surfaces)
  if (!authenticatedV4) {
    delete gitSurfaces.worktree.status_paths
    delete gitSurfaces.index.staged_paths
  }
  const body = {
    schema_version: authenticatedV4 ? 4 : 2,
    phase: '05',
    status: 'PASS',
    scope: 'LOCAL_AND_GIT_ONLY',
    provider_side_retention: 'NOT_ASSERTED',
    scanned_roots: [...SCANNED_ROOTS],
    baseline: embeddedBaseline(baseline),
    source_snapshot: structuredClone(scan.source_snapshot),
    git_surfaces: gitSurfaces,
    administrative_tail_policy: authenticatedV4
      ? structuredClone(scan.administrative_tail_policy)
      : {
          from_source_head_sha: scan.source_snapshot.head_sha,
          allowed_paths: [...LEGACY_ADMINISTRATIVE_TAIL_PATHS],
          allowed_state_transitions: [
            ...ADMINISTRATIVE_TRANSITIONS_V2,
          ],
          source_changes_allowed: false,
        },
    provider_call_count: decisionContract.provider_call_count,
    fixture_count: decisionContract.fixture_count,
    raw_result_count: decisionContract.raw_result_count,
    production_mutation_count:
      decisionContract.production_mutation_count,
    forbidden_hit_count: scan.forbidden_hit_count,
    unexpected_survivor_count: scan.unexpected_survivor_count,
    symlink_count: scan.symlink_count,
    rights_evidence_sha256: matrix.rights_evidence_sha256,
    quality_evidence_sha256: qualityReport.quality_evidence_sha256,
    decision_contract_sha256:
      decisionContract.decision_contract_sha256,
    owner_checkpoint_evidence_sha256:
      ownerCheckpoint.owner_checkpoint_evidence_sha256,
    baseline_evidence_sha256: baseline.baseline_evidence_sha256,
    checked_at: scan.checked_at,
    ...(authenticatedV4
      ? {
          representative_case_count:
            decisionContract.representative_case_count,
          ...Object.fromEntries(
            AUTHORIZATION_FIELD_KEYS.map((key) => [
              key,
              decisionContract[key],
            ]),
          ),
        }
      : {}),
  }
  const record = {
    ...body,
    zero_residue_sha256: sha256Json(body),
  }
  assertZeroResidueRecord(record, {
    rights_evidence_sha256: matrix.rights_evidence_sha256,
    quality_evidence_sha256: qualityReport.quality_evidence_sha256,
    decision_contract_sha256:
      decisionContract.decision_contract_sha256,
    owner_checkpoint_evidence_sha256:
      ownerCheckpoint.owner_checkpoint_evidence_sha256,
    baseline_evidence_sha256: baseline.baseline_evidence_sha256,
  })
  if (authenticatedV4) assertPublishableZeroResidueRecord(record)
  return record
}

export function migrateZeroResidueV3ToV4({
  record,
  liveScan,
}) {
  assertImmutableZeroResidueV3Lineage(record)
  assertScanShape(liveScan)
  requireStaticSurfaceMatch(record, liveScan)
  const {
    zero_residue_sha256: ignoredDigest,
    ...lineageBody
  } = record
  const body = {
    ...structuredClone(lineageBody),
    schema_version: 4,
    git_surfaces: structuredClone(liveScan.git_surfaces),
    administrative_tail_policy:
      structuredClone(liveScan.administrative_tail_policy),
    checked_at: liveScan.checked_at,
  }
  const migrated = {
    ...body,
    zero_residue_sha256: sha256Json(body),
  }
  assertPublishableZeroResidueRecord(migrated)
  return migrated
}

function assertCanonicalProofPaths({
  repoRoot,
  requestPath,
  signaturePath,
  trustAnchorPath,
  publicKeyPath,
  allowedSignersPath,
}) {
  requireCondition(
    typeof repoRoot === 'string' && repoRoot.trim().length > 0,
    'repository root is required for authenticated residue',
  )
  const root = resolve(repoRoot)
  for (const [actual, relative, label] of [
    [
      requestPath,
      OWNER_AUTHORIZATION_REQUEST_PATH,
      'owner authorization request',
    ],
    [
      signaturePath,
      OWNER_AUTHORIZATION_SIGNATURE_PATH,
      'owner authorization signature',
    ],
    [trustAnchorPath, OWNER_TRUST_ANCHOR_PATH, 'owner trust anchor'],
    [publicKeyPath, OWNER_PUBLIC_KEY_PATH, 'owner public key'],
    [
      allowedSignersPath,
      OWNER_ALLOWED_SIGNERS_PATH,
      'owner allowed-signers',
    ],
  ]) {
    requireCondition(
      typeof actual === 'string'
        && resolve(actual) === resolve(root, relative),
      `${label} path is not the canonical repository artifact`,
    )
  }
}

function requireStaticSurfaceMatch(record, liveScan) {
  requireCondition(
    isDeepStrictEqual(record.baseline, {
      base_sha: liveScan.git_surfaces.phase_commit_range.base_sha,
      plan_path: record.baseline.plan_path,
      plan_blob_sha256: record.baseline.plan_blob_sha256,
      baseline_evidence_sha256: record.baseline.baseline_evidence_sha256,
    }),
    'record baseline does not match live reconstruction',
  )
  requireCondition(
    isDeepStrictEqual(record.source_snapshot, liveScan.source_snapshot),
    'record source snapshot does not match live reconstruction',
  )
  requireCondition(
    isDeepStrictEqual(
      record.git_surfaces.phase_commit_range,
      liveScan.git_surfaces.phase_commit_range,
    ),
    'record history surface does not match live reconstruction',
  )
  requireCondition(
    isDeepStrictEqual(
      record.git_surfaces.source_head_tree,
      liveScan.git_surfaces.source_head_tree,
    ),
    'record source tree does not match live reconstruction',
  )
}

export function assertRecordMatchesLiveScan(
  record,
  liveScan,
  {
    decision,
    ownerCheckpoint,
    repoRoot,
    requestPath,
    signaturePath,
    trustAnchorPath,
    publicKeyPath,
    allowedSignersPath,
  },
) {
  assertScanShape(liveScan)
  assertArtifactSchema(
    `${PHASE_DIR_RELATIVE}/05-DECISION.json`,
    decision,
  )
  assertArtifactSchema(
    `${PHASE_DIR_RELATIVE}/05-OWNER-CHECKPOINT.json`,
    ownerCheckpoint,
  )
  assertZeroResidueRecord(record, {
    rights_evidence_sha256: decision.rights_evidence_sha256,
    quality_evidence_sha256: decision.quality_evidence_sha256,
    decision_contract_sha256: decision.decision_contract_sha256,
    owner_checkpoint_evidence_sha256:
      ownerCheckpoint.owner_checkpoint_evidence_sha256,
    baseline_evidence_sha256:
      ownerCheckpoint.baseline_evidence_sha256,
  })
  requireCondition(
    decision.owner_checkpoint_evidence_sha256
      === ownerCheckpoint.owner_checkpoint_evidence_sha256,
    'decision owner checkpoint digest drift',
  )
  requireCondition(
    decision.zero_residue_sha256 === record.zero_residue_sha256,
    'decision zero-residue digest drift',
  )
  requireStaticSurfaceMatch(record, liveScan)
  if (record.schema_version === 4) {
    assertPublishableZeroResidueRecord(record)
    requireCondition(
      isDeepStrictEqual(
        record.administrative_tail_policy,
        liveScan.administrative_tail_policy,
      ),
      'record administrative tail policy drift',
    )
    requireCondition(
      isDeepStrictEqual(
        record.git_surfaces.worktree,
        liveScan.git_surfaces.worktree,
      )
        && isDeepStrictEqual(
          record.git_surfaces.index,
          liveScan.git_surfaces.index,
        ),
      'record controlled worktree or index surface drift',
    )
    requireCondition(
      record.git_surfaces.worktree.status_entry_count === 0
        && record.git_surfaces.worktree.status_paths.length === 0
        && record.git_surfaces.index.staged_path_count === 0
        && record.git_surfaces.index.staged_paths.length === 0,
      'controlled worktree and index surfaces must be clean',
    )
  } else {
    requireCondition(
      record.schema_version === 2
        && isDeepStrictEqual(record.administrative_tail_policy, {
          from_source_head_sha: liveScan.source_snapshot.head_sha,
          allowed_paths: [...LEGACY_ADMINISTRATIVE_TAIL_PATHS],
          allowed_state_transitions: [
            ...ADMINISTRATIVE_TRANSITIONS_V2,
          ],
          source_changes_allowed: false,
        }),
      'record administrative tail policy drift',
    )
  }
  for (const key of [
    'provider_call_count',
    'fixture_count',
    'raw_result_count',
    'production_mutation_count',
    'forbidden_hit_count',
    'unexpected_survivor_count',
    'symlink_count',
  ]) requireCondition(record[key] === 0, `${key} must equal zero`)
  if (record.schema_version === 4) {
    requireCondition(
      decision.schema_version === 3,
      'authenticated residue requires decision schema v3',
    )
    assertCanonicalProofPaths({
      repoRoot,
      requestPath,
      signaturePath,
      trustAnchorPath,
      publicKeyPath,
      allowedSignersPath,
    })
    return assertAuthenticatedAcceptedEvidence({
      decision,
      residue: record,
      requestPath,
      signaturePath,
      trustAnchorPath,
      publicKeyPath,
      allowedSignersPath,
      now: decision.owner_authorization_verified_at,
    }).then(() => record)
  }
  requireCondition(
    record.schema_version !== 3,
    'terminal zero-residue consumption requires schema v4',
  )
  return record
}

function parseArgs(argv) {
  const result = {
    assertZero: false,
    repoRoot: null,
    phaseDir: null,
    baselineRecord: null,
    matrix: null,
    qualityReport: null,
    decision: null,
    ownerCheckpoint: null,
    requestPath: null,
    signaturePath: null,
    trustAnchorPath: null,
    publicKeyPath: null,
    allowedSignersPath: null,
    record: null,
  }
  const flags = new Map([
    ['--repo-root', 'repoRoot'],
    ['--phase-dir', 'phaseDir'],
    ['--baseline-record', 'baselineRecord'],
    ['--matrix', 'matrix'],
    ['--quality-report', 'qualityReport'],
    ['--decision', 'decision'],
    ['--owner-checkpoint', 'ownerCheckpoint'],
    ['--owner-authorization-request', 'requestPath'],
    ['--owner-authorization-signature', 'signaturePath'],
    ['--owner-trust-anchor', 'trustAnchorPath'],
    ['--owner-public-key', 'publicKeyPath'],
    ['--owner-allowed-signers', 'allowedSignersPath'],
    ['--record', 'record'],
  ])
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--assert-zero') {
      requireCondition(!result.assertZero, 'duplicate --assert-zero')
      result.assertZero = true
      continue
    }
    const key = flags.get(argument)
    requireCondition(key, 'unknown argument')
    requireCondition(result[key] === null, `duplicate ${argument}`)
    const value = argv[++index]
    requireCondition(
      value && !value.startsWith('--'),
      `${argument} requires a path`,
    )
    result[key] = value
  }
  requireCondition(result.assertZero, '--assert-zero is required')
  for (const [flag, key] of flags) {
    requireCondition(result[key] !== null, `${flag} is required`)
  }
  return result
}

async function readJsonFile(path, label) {
  const bytes = await readFile(path)
  const text = decodeBounded(bytes, 'worktree', label)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${label} is malformed JSON`)
  }
}

async function main(argv) {
  const args = parseArgs(argv)
  const repoRoot = resolve(args.repoRoot)
  const phaseDir = resolve(repoRoot, args.phaseDir)
  const expectedPaths = {
    baselineRecord: resolve(phaseDir, '05-EXECUTION-BASELINE.json'),
    matrix: resolve(phaseDir, '05-RIGHTS-MATRIX.json'),
    qualityReport: resolve(phaseDir, '05-QUALITY-REPORT.json'),
    decision: resolve(phaseDir, '05-DECISION.json'),
    ownerCheckpoint: resolve(phaseDir, '05-OWNER-CHECKPOINT.json'),
    requestPath: resolve(repoRoot, OWNER_AUTHORIZATION_REQUEST_PATH),
    signaturePath: resolve(repoRoot, OWNER_AUTHORIZATION_SIGNATURE_PATH),
    trustAnchorPath: resolve(repoRoot, OWNER_TRUST_ANCHOR_PATH),
    publicKeyPath: resolve(repoRoot, OWNER_PUBLIC_KEY_PATH),
    allowedSignersPath: resolve(repoRoot, OWNER_ALLOWED_SIGNERS_PATH),
    record: resolve(phaseDir, '05-ZERO-RESIDUE.json'),
  }
  for (const [key, expected] of Object.entries(expectedPaths)) {
    requireCondition(
      resolve(args[key]) === expected,
      'assertion path is outside the approved phase directory',
    )
  }
  const {
    decision,
    record,
  } = await readAcceptedEvidencePair({
    decisionPath: expectedPaths.decision,
    recordPath: expectedPaths.record,
  })
  const baseline = await readJsonFile(
    expectedPaths.baselineRecord,
    BASELINE_RECORD_LABEL,
  )
  const matrix = await readJsonFile(expectedPaths.matrix, 'rights matrix')
  const qualityReport = await readJsonFile(
    expectedPaths.qualityReport,
    'quality report',
  )
  const ownerCheckpoint = await readJsonFile(
    expectedPaths.ownerCheckpoint,
    'owner checkpoint',
  )
  assertArtifactSchema(
    `${PHASE_DIR_RELATIVE}/05-RIGHTS-MATRIX.json`,
    matrix,
  )
  assertArtifactSchema(
    `${PHASE_DIR_RELATIVE}/05-QUALITY-REPORT.json`,
    qualityReport,
  )
  const liveScan = await scanOwnedSurfaces({
    repoRoot,
    phaseDir: args.phaseDir,
    baseline,
    sourceHeadSha: record.source_snapshot?.head_sha,
  })
  await assertRecordMatchesLiveScan(record, liveScan, {
    decision,
    ownerCheckpoint,
    repoRoot,
    requestPath: expectedPaths.requestPath,
    signaturePath: expectedPaths.signaturePath,
    trustAnchorPath: expectedPaths.trustAnchorPath,
    publicKeyPath: expectedPaths.publicKeyPath,
    allowedSignersPath: expectedPaths.allowedSignersPath,
  })
  process.stdout.write(`${JSON.stringify({
    status: record.status,
    record_source_head: record.source_snapshot.head_sha,
    live_head: liveScan.administrative_tail.head_sha,
    administrative_tail_commit_count:
      liveScan.administrative_tail.commit_count,
    administrative_tail_path_count:
      liveScan.administrative_tail.path_count,
    administrative_tail_blob_count:
      liveScan.administrative_tail.blob_count,
    administrative_tail_inventory_sha256:
      liveScan.administrative_tail.inventory_sha256,
  }, null, 2)}\n`)
}

const BASELINE_RECORD_LABEL = 'execution baseline'
const isMainModule = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url

if (isMainModule) {
  main(process.argv.slice(2)).catch((error) => {
    const message = error instanceof Error
      ? error.message.replace(/[\r\n\u001b]/g, ' ')
      : 'zero-residue assertion failed'
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}

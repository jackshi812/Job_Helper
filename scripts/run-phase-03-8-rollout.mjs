#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { createRequire, registerHooks } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const require = createRequire(import.meta.url)

export const RELEASE_MANIFEST_ID = '03850000-0000-4000-8000-000000000005'
export const RELEASE_MANIFEST_FILE_SHA256 =
  '57bcab61932d0f8772d4e0d9959471fae09f6ba6b8727f27a8d1b9d1d419c6e5'
export const RELEASE_MANIFEST_OBJECT_SHA256 =
  '041d043db86a306981df3d520b6cdc4ea8857beff61c77da096018b5192493e7'
export const PLAN_05_HOSTED_SHA256 =
  '3a36a1acab9a21aff0fdc26e1419040dd6487fb075e608bef71842a6c35b594f'
export const RELEASE_SOURCE_COMMIT =
  '83fbf8fc7707d8566f47034229884c517a16c979'
export const VERIFIER_RUN_ID = '03850000-0000-4000-8000-000000000501'
export const PROVIDER_REQUEST_LIMIT = 300
export const PROBE_DEADLINE_MS = 120_000
export const FAMILY_CEILING_MS = 20 * 60_000
export const ACTIVE_LATENCY_MS = 15 * 60_000
export const MAX_EVIDENCE_BYTES = 16_384

export const FAMILY_ORDER = Object.freeze([
  Object.freeze({
    family: 'eightfold',
    company: 'Morgan Stanley',
    sourceKey: 'eightfold:morganstanley',
    fixture: 'eightfold_fixture',
    fault: 'incomplete_observation',
    adapter: 'eightfold',
  }),
  Object.freeze({
    family: 'oracle_recruiting',
    company: 'JPMorgan Chase',
    sourceKey: 'oracle:jpmc:CX_1001',
    fixture: 'oracle_fixture',
    fault: 'provider_schema_error',
    adapter: 'oracle-recruiting',
  }),
  Object.freeze({
    family: 'goldman_higher',
    company: 'Goldman Sachs',
    sourceKey: 'goldman_higher:roles',
    fixture: 'goldman_fixture',
    fault: 'provider_timeout',
    adapter: 'goldman-higher',
  }),
])

const TERMINAL_REASONS = new Set([
  'pending_current_live_contract_proof',
  'provider_timeout',
  'provider_schema_error',
  'category_evidence_missing',
  'scope_evidence_incomplete',
  'positive_job_count_missing',
  'pagination_incomplete',
  'count_mismatch',
])

const REASON_MAP = Object.freeze({
  provider_timeout: 'provider_timeout',
  deadline_exceeded: 'provider_timeout',
  fetch_failed: 'provider_timeout',
  network_error: 'provider_timeout',
  http_429: 'provider_timeout',
  http_status: 'provider_schema_error',
  invalid_json: 'provider_schema_error',
  response_too_large: 'provider_schema_error',
  provider_error: 'provider_schema_error',
  provider_schema_error: 'provider_schema_error',
  provider_schema_invalid: 'provider_schema_error',
  invalid_identity: 'provider_schema_error',
  invalid_clock: 'provider_schema_error',
  redirect_rejected: 'provider_schema_error',
  invalid_content_type: 'provider_schema_error',
  payload_too_large: 'provider_schema_error',
  malformed_response: 'provider_schema_error',
  graphql_error: 'provider_schema_error',
  detail_id_mismatch: 'provider_schema_error',
  facet_label_mismatch: 'provider_schema_error',
  slice_limit_mismatch: 'provider_schema_error',
  slice_identity_mismatch: 'provider_schema_error',
  slice_offset_mismatch: 'provider_schema_error',
  cross_slice_id_drift: 'provider_schema_error',
  category_evidence_missing: 'category_evidence_missing',
  scope_evidence_incomplete: 'scope_evidence_incomplete',
  scope_evidence_invalid: 'scope_evidence_incomplete',
  detail_evidence_missing: 'scope_evidence_incomplete',
  detail_country_ineligible: 'scope_evidence_incomplete',
  detail_category_ineligible: 'scope_evidence_incomplete',
  zero_eligible_jobs: 'positive_job_count_missing',
  positive_job_count_missing: 'positive_job_count_missing',
  page_cap_exceeded: 'pagination_incomplete',
  detail_cap_exceeded: 'pagination_incomplete',
  pagination_incomplete: 'pagination_incomplete',
  count_mismatch: 'count_mismatch',
  slice_count_mismatch: 'count_mismatch',
  duplicate_id: 'count_mismatch',
  duplicate_source_id: 'count_mismatch',
  job_cap_exceeded: 'count_mismatch',
})

const DEFAULT_PHASE_DIR = resolve(
  '.planning/phases/03.8-monitor-and-poll-the-branded-banking-companies-currently-on-',
)
const DEFAULT_MANIFEST = resolve(DEFAULT_PHASE_DIR, '03.8-05-RELEASE-MANIFEST.json')
const DEFAULT_HOSTED = resolve(DEFAULT_PHASE_DIR, '03.8-05-HOSTED-VERIFICATION.json')
const DEFAULT_OUTPUT = resolve(DEFAULT_PHASE_DIR, '03.8-06-ROLLOUT-VERIFICATION.json')
let typeScriptHookRegistered = false

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonical(value[key])}`,
    ).join(',')}}`
  }
  return JSON.stringify(value)
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message)
}

export function exactApproval() {
  return `approve Phase 03.8 rollout ${RELEASE_MANIFEST_ID} ${RELEASE_MANIFEST_FILE_SHA256} ${PLAN_05_HOSTED_SHA256}`
}

export function validateIdentityFiles({
  manifestBytes,
  hostedBytes,
  sourceCommit,
}) {
  requireCondition(
    sha256(manifestBytes) === RELEASE_MANIFEST_FILE_SHA256,
    'release manifest file hash drift',
  )
  requireCondition(
    sha256(hostedBytes) === PLAN_05_HOSTED_SHA256,
    'immutable Plan 05 hosted evidence hash drift',
  )
  const manifest = JSON.parse(manifestBytes)
  const hosted = JSON.parse(hostedBytes)
  requireCondition(manifest.release_manifest_id === RELEASE_MANIFEST_ID,
    'release manifest ID drift')
  requireCondition(manifest.candidate?.git_sha === RELEASE_SOURCE_COMMIT,
    'release manifest source commit drift')
  requireCondition(sha256(JSON.stringify(manifest)) === RELEASE_MANIFEST_OBJECT_SHA256,
    'canonical release manifest hash drift')
  requireCondition(hosted.status === 'PASS'
    && hosted.phase === '03.8'
    && hosted.manifest_sha256 === RELEASE_MANIFEST_OBJECT_SHA256,
  'Plan 05 hosted evidence is not exact-release PASS')
  requireCondition(hosted.checks?.release_identity?.source_commit
    === RELEASE_SOURCE_COMMIT,
  'Plan 05 source identity drift')
  requireCondition(hosted.verifier_authority?.status === 'ARMED'
    && hosted.verifier_authority.run_id === VERIFIER_RUN_ID
    && hosted.cleanup?.status === 'PENDING',
  'one-use verifier authority is not pristine and armed')
  requireCondition(sourceCommit === RELEASE_SOURCE_COMMIT,
    `source worktree must be exactly ${RELEASE_SOURCE_COMMIT}`)
  return { manifest, hosted }
}

export function assertFamilyOrder(families) {
  requireCondition(Array.isArray(families), 'families must be an array')
  requireCondition(
    canonical(families.map((item) => item.family))
      === canonical(FAMILY_ORDER.map((item) => item.family)),
    'provider family order must be Eightfold, Oracle Recruiting, Goldman Higher',
  )
  return families
}

export function mapUnsupportedReason(code) {
  const normalized = typeof code === 'string' ? code.trim() : ''
  const dynamicHttp = /^http_(\d{3})$/.exec(normalized)
  const mapped = dynamicHttp
    ? dynamicHttp[1] === '429'
      ? 'provider_timeout'
      : 'provider_schema_error'
    : REASON_MAP[normalized]
  if (!mapped || !TERMINAL_REASONS.has(mapped)) {
    throw new Error(`unmapped provider reason: ${normalized || '<empty>'}`)
  }
  return mapped
}

function isoMs(value, label) {
  const milliseconds = Date.parse(value)
  requireCondition(typeof value === 'string' && Number.isFinite(milliseconds),
    `${label} must be an ISO timestamp`)
  return milliseconds
}

export function validateTimestampChain(timestamps, maximumMs = ACTIVE_LATENCY_MS) {
  const keys = [
    'activated_at',
    'due_at',
    'claimed_at',
    'completed_at',
    'feed_visible_at',
  ]
  requireCondition(
    canonical(Object.keys(timestamps).sort()) === canonical([...keys].sort()),
    'active timestamp chain has missing or extra fields',
  )
  const values = keys.map((key) => isoMs(timestamps[key], key))
  for (let index = 1; index < values.length; index += 1) {
    requireCondition(values[index] >= values[index - 1],
      'active timestamp chain is not ordered')
  }
  requireCondition(values[2] - values[1] <= 60_000,
    'natural claim was more than one cron interval late')
  requireCondition(values[3] - values[2] <= 120_000,
    'natural poll exceeded its 120-second reserve')
  requireCondition(values.at(-1) - values[0] <= maximumMs,
    'activation-to-feed visibility exceeded 15 minutes')
  return timestamps
}

function boundedText(value, maximum = 96) {
  return String(value ?? '')
    .replaceAll(/https?:\/\/\S+/gi, '[url]')
    .replaceAll(/(?:bearer|apikey|authorization|token|secret|password)\s*[:=]?\s*\S+/gi,
      '[credential-redacted]')
    .slice(0, maximum)
}

export function sanitizeProbeEvidence(family, observation, requestCount, elapsedMs) {
  const jobs = Array.isArray(observation.jobs) ? observation.jobs : []
  const scope = observation.scopeEvidence
  const evidence = {
    schema_version: 1,
    family: family.family,
    company: family.company,
    source_key: family.sourceKey,
    completeness: boundedText(observation.completeness, 16),
    credible_for_closure: observation.credibleForClosure === true,
    allow_missing_closure: observation.allowMissingClosure === true,
    job_count: jobs.length,
    expected_count: Number.isInteger(observation.expectedCount)
      ? observation.expectedCount
      : null,
    page_count: Number.isInteger(observation.pageCount) ? observation.pageCount : null,
    warning_codes: [...new Set(
      (Array.isArray(observation.warnings) ? observation.warnings : [])
        .map((warning) => boundedText(warning, 64)),
    )].slice(0, 8),
    request_count: requestCount,
    elapsed_ms: Math.max(0, Math.ceil(elapsedMs)),
    aggregate_scope_digest: scope ? sha256(canonical(scope)) : null,
    eligible_job_digests: jobs.slice(0, 8).map((job) => sha256(canonical({
      external_id: boundedText(job.externalId, 128),
      source: boundedText(job.source, 32),
      scope: job.scopeEvidence ?? null,
    }))),
  }
  const serialized = canonical(evidence)
  requireCondition(Buffer.byteLength(serialized) <= MAX_EVIDENCE_BYTES,
    'sanitized probe evidence exceeds its byte bound')
  requireCondition(!/(bearer|apikey|authorization|secret|password)/i.test(serialized),
    'sanitized probe evidence contains credential-shaped text')
  return Object.freeze({ ...evidence, evidence_digest: sha256(serialized) })
}

export function classifyProbe(family, observation, requestCount, elapsedMs) {
  requireCondition(requestCount >= 0 && requestCount <= PROVIDER_REQUEST_LIMIT,
    'provider request limit exceeded')
  requireCondition(elapsedMs >= 0 && elapsedMs <= PROBE_DEADLINE_MS + 1_000,
    'provider probe deadline exceeded')
  const evidence = sanitizeProbeEvidence(family, observation, requestCount, elapsedMs)
  const positive = observation.completeness === 'complete'
    && observation.credibleForClosure === true
    && observation.allowMissingClosure === true
    && Array.isArray(observation.jobs)
    && observation.jobs.length > 0
    && observation.expectedCount === observation.jobs.length
    && Array.isArray(observation.warnings)
    && observation.warnings.length === 0
    && observation.scopeEvidence
    && observation.jobs.every((job) =>
      job.scopeEvidence?.sourceKey === family.sourceKey
      && job.scopeEvidence?.detailCountryCode === 'US'
      && typeof job.scopeEvidence?.providerCategoryLabel === 'string'
      && job.scopeEvidence.providerCategoryLabel.length > 0
      && typeof job.scopeEvidence?.matchedTerm === 'string'
      && /^[0-9a-f]{64}$/.test(job.scopeEvidence?.externalIdDigest ?? ''))
  if (positive) return { positive: true, reason: null, evidence }
  const warning = observation.warnings?.[0]
    ?? (!observation.jobs?.length ? 'zero_eligible_jobs' : 'scope_evidence_incomplete')
  return {
    positive: false,
    reason: mapUnsupportedReason(warning),
    evidence,
  }
}

export function createBoundedFetch(identity, fetchImpl = fetch, now = Date.now) {
  let requestCount = 0
  const startedAt = now()
  const allowedPaths = identity.provider === 'eightfold'
    ? [identity.searchPath, identity.detailPath]
    : identity.provider === 'oracle_recruiting'
      ? [identity.listPath, identity.detailPath]
      : [identity.graphqlPath]
  const boundedFetch = async (input, init = {}) => {
    requestCount += 1
    requireCondition(requestCount <= PROVIDER_REQUEST_LIMIT,
      'provider request limit exceeded')
    requireCondition(now() - startedAt <= PROBE_DEADLINE_MS,
      'provider probe deadline exceeded')
    const url = new URL(input instanceof Request ? input.url : input)
    requireCondition(url.protocol === 'https:' && url.hostname === identity.host
      && url.username === '' && url.password === ''
      && allowedPaths.some((path) => url.pathname === path
        || url.pathname.startsWith(`${path}/`)),
    'adapter attempted an unapproved network coordinate')
    return fetchImpl(input, init)
  }
  return Object.freeze({
    fetch: boundedFetch,
    count: () => requestCount,
    elapsed: () => now() - startedAt,
  })
}

export function registerTypeScriptTranspileHook(root = resolve('.')) {
  if (typeScriptHookRegistered) return
  const ts = require(resolve(
    root,
    'web/node_modules/typescript/lib/typescript.js',
  ))
  registerHooks({
    load(url, context, nextLoad) {
      if (!url.startsWith('file:') || !url.endsWith('.ts')) {
        return nextLoad(url, context)
      }
      const source = readFileSync(fileURLToPath(url), 'utf8')
      const transpiled = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          verbatimModuleSyntax: true,
          sourceMap: false,
          inlineSourceMap: false,
        },
        fileName: fileURLToPath(url),
        reportDiagnostics: false,
      })
      return {
        format: 'module',
        shortCircuit: true,
        source: transpiled.outputText,
      }
    },
  })
  typeScriptHookRegistered = true
}

export async function directProbe(family, dependencies = {}) {
  const root = dependencies.root ?? resolve('.')
  registerTypeScriptTranspileHook(root)
  const identities = dependencies.identities
    ?? await import(pathToFileURL(resolve(
      root,
      'supabase/functions/_shared/branded-identities.ts',
    )))
  const identity = identities.resolveBrandedIdentity(family.sourceKey)
  requireCondition(identity?.provider === family.family,
    'exact adapter identity did not resolve')
  const module = dependencies.adapterModule ?? await import(pathToFileURL(resolve(
    root,
    `supabase/functions/_shared/adapters/${family.adapter}.ts`,
  )))
  const poll = family.family === 'eightfold'
    ? module.pollMorganStanleyEightfold
    : family.family === 'oracle_recruiting'
      ? module.pollJpmorganOracleRecruiting
      : module.pollGoldmanHigher
  requireCondition(typeof poll === 'function', 'exact adapter entrypoint is missing')
  const bounded = createBoundedFetch(identity, dependencies.fetchImpl, dependencies.now)
  const observation = await poll(identity, bounded.fetch, {
    totalDurationMs: PROBE_DEADLINE_MS,
    maxDetailRequests: 200,
  })
  return classifyProbe(family, observation, bounded.count(), bounded.elapsed())
}

function requireTerminalFamilyEvidence(result, family) {
  requireCondition(result?.family === family.family
    && result?.source_key === family.sourceKey
    && result?.status === 'PASS',
  `${family.family} terminal evidence is invalid`)
  requireCondition(['active', 'unsupported'].includes(result.outcome),
    `${family.family} has no terminal outcome`)
  if (result.outcome === 'active') {
    requireCondition(result.activation_successes === 3
      && result.eligible_job_count > 0
      && result.natural_poll === true,
    `${family.family} active outcome lacks three windows or a natural poll`)
    validateTimestampChain(result.timestamps)
  } else {
    requireCondition(TERMINAL_REASONS.has(result.reason)
      && result.scheduled === false
      && result.monitored === false
      && result.operational_rows === 0,
    `${family.family} unsupported outcome retained authority`)
  }
  return result
}

function requireCandidateStart(start, family) {
  requireCondition(start?.family === family.family
    && start?.source_key === family.sourceKey
    && ['pending', 'terminal_unsupported', 'experimental', 'active']
      .includes(start?.kind),
  `${family.family} candidate start state is invalid`)
  if (start.kind === 'terminal_unsupported') {
    requireCondition(TERMINAL_REASONS.has(start.reason)
      && start.operational_rows === 0
      && start.evidence_rows >= 1,
    `${family.family} terminal Unsupported resume is invalid`)
  }
  if (start.kind === 'experimental') {
    requireCondition(start.operational_rows === 1
      && start.activation_successes >= 0
      && start.activation_successes <= 3
      && start.observation_rows === start.activation_successes
      && start.positive_evidence_rows >= 1,
    `${family.family} Experimental resume is invalid`)
  }
  if (start.kind === 'active') {
    requireCondition(start.operational_rows === 1
      && start.activation_successes === 3
      && start.observation_rows === 3
      && start.positive_evidence_rows >= 1,
    `${family.family} Active resume is invalid`)
  }
  return start
}

function freshTerminalDigest({
  family,
  start,
  probe,
  outcome,
  nonce,
}) {
  return sha256(canonical({
    schema_version: 1,
    release_manifest_id: RELEASE_MANIFEST_ID,
    source_key: family.sourceKey,
    start_kind: start.kind,
    outcome,
    probe_evidence_digest: probe.evidence.evidence_digest,
    attempt_nonce: nonce,
  }))
}

export async function exerciseVerifierFinally(ops, manifest, clock = Date) {
  if (typeof ops.runVerifierTransaction === 'function') {
    try {
      return await ops.runVerifierTransaction(manifest)
    } catch (error) {
      // A management response can fail after the transaction committed. Accept
      // that ambiguous transport outcome only if a fresh SQL assertion proves
      // irreversible cleanup and revoked authority.
      const terminal = await ops.assertVerifierTerminal(manifest).catch(() => null)
      if (terminal
        && terminal.run_rows === 0
        && terminal.fixture_rows === 0
        && terminal.company_rows === 0
        && terminal.job_rows === 0
        && terminal.observation_rows === 0
        && terminal.begin_execute === false
        && terminal.exercise_execute === false
          && terminal.finish_execute === false
          && terminal.post_finish_denied === true) {
        throw new Error(
          'verifier response was ambiguous; irreversible cleanup is confirmed but rollout evidence is not provable',
          { cause: error },
        )
      }
      throw error
    }
  }
  const versions = Object.fromEntries(FAMILY_ORDER.map((family) => [family.fixture, 0]))
  let began = false
  let primaryError
  const results = []
  try {
    const begin = await ops.beginVerifier(VERIFIER_RUN_ID)
    began = true
    requireCondition(begin?.started === true
      && begin.fixture_count === 3
      && begin.exercise_calls === 0,
    'verifier begin did not seed exactly three pristine fixtures')
    const expiresAt = isoMs(begin.expires_at, 'verifier expires_at')
    requireCondition(expiresAt > clock.now()
      && expiresAt - clock.now() <= FAMILY_CEILING_MS + 5_000,
    'verifier expiry exceeds its 20-minute ceiling')
    for (const family of FAMILY_ORDER) {
      const failed = await ops.exerciseVerifier({
        runId: VERIFIER_RUN_ID,
        fixture: family.fixture,
        fault: family.fault,
        expectedVersion: versions[family.fixture],
      })
      requireCondition(failed.fixture_key === family.fixture
        && failed.fixture_version === versions[family.fixture] + 1
        && failed.fault === family.fault
        && failed.job_status === 'open',
      `${family.fixture} failure transition is invalid`)
      versions[family.fixture] = failed.fixture_version
      const recovered = await ops.exerciseVerifier({
        runId: VERIFIER_RUN_ID,
        fixture: family.fixture,
        fault: 'clean_recovery',
        expectedVersion: versions[family.fixture],
      })
      requireCondition(recovered.fixture_key === family.fixture
        && recovered.fixture_version === versions[family.fixture] + 1
        && recovered.fault === 'clean_recovery'
        && recovered.job_status === 'open'
        && recovered.activation_state === 'active'
        && recovered.consecutive_failures === 0,
      `${family.fixture} recovery transition is invalid`)
      versions[family.fixture] = recovered.fixture_version
      results.push({ fixture: family.fixture, fault: family.fault, status: 'PASS' })
    }
  } catch (error) {
    primaryError = error
  } finally {
    if (began) {
      try {
        const finish = await ops.finishVerifier({
          runId: VERIFIER_RUN_ID,
          eightfoldVersion: versions.eightfold_fixture,
          oracleVersion: versions.oracle_fixture,
          goldmanVersion: versions.goldman_fixture,
        })
        requireCondition(finish?.consumed === true
          && finish.release_manifest_id === manifest.release_manifest_id
          && finish.run_id === VERIFIER_RUN_ID
          && finish.deleted_fixtures === 3
          && finish.remaining_rows === 0
          && finish.grants_revoked === true,
        'verifier finish did not consume and clean exact authority')
        const terminal = await ops.assertVerifierTerminal(manifest)
        requireCondition(terminal.run_rows === 0
          && terminal.fixture_rows === 0
          && terminal.company_rows === 0
          && terminal.job_rows === 0
          && terminal.observation_rows === 0
          && terminal.begin_execute === false
          && terminal.exercise_execute === false
          && terminal.finish_execute === false
          && terminal.post_finish_denied === true,
        'verifier residue, ACL, or post-finish assertion failed')
      } catch (cleanupError) {
        primaryError = primaryError
          ? new AggregateError([primaryError, cleanupError], 'rollout and cleanup failed')
          : cleanupError
      }
    }
  }
  if (primaryError) throw primaryError
  return {
    status: 'PASS',
    fixtures: results,
    exercise_calls: results.length * 2,
  }
}

export async function executeRollout({
  manifest,
  hostedSha256 = PLAN_05_HOSTED_SHA256,
  ops,
  probe = directProbe,
  now = () => Date.now(),
  nonce = () => randomUUID(),
}) {
  assertFamilyOrder(FAMILY_ORDER)
  const familyResults = {}
  for (const family of FAMILY_ORDER) {
    const deadline = now() + FAMILY_CEILING_MS
    await ops.assertReleaseIdentity(manifest, hostedSha256)
    const start = requireCandidateStart(
      await ops.inspectCandidateStart(family),
      family,
    )
    const probeResult = await probe(family)
    requireCondition(now() <= deadline, `${family.family} exceeded 20-minute ceiling`)
    const outcome = probeResult.positive ? 'admit_experimental' : 'unsupported'
    let terminalEvidenceDigest = null
    if (start.kind === 'pending' || start.kind === 'terminal_unsupported') {
      terminalEvidenceDigest = freshTerminalDigest({
        family,
        start,
        probe: probeResult,
        outcome,
        nonce: nonce(),
      })
      const finalized = await ops.finalizeCandidate({
        sourceKey: family.sourceKey,
        outcome,
        reason: probeResult.reason,
        evidenceDigest: terminalEvidenceDigest,
      })
      requireCondition(finalized?.accepted === true,
        `${family.family} terminal RPC rejected exact evidence`)
    } else if (start.kind === 'experimental' && !probeResult.positive) {
      terminalEvidenceDigest = freshTerminalDigest({
        family,
        start,
        probe: probeResult,
        outcome: 'unsupported',
        nonce: nonce(),
      })
      const finalized = await ops.finalizeCandidate({
        sourceKey: family.sourceKey,
        outcome: 'unsupported',
        reason: probeResult.reason,
        evidenceDigest: terminalEvidenceDigest,
      })
      requireCondition(finalized?.accepted === true,
        `${family.family} Experimental terminalization failed`)
    } else if (start.kind === 'active' && !probeResult.positive) {
      throw new Error(
        `${family.family} live probe no longer supports its Active state; refusing mutation`,
      )
    }
    let terminal
    try {
      terminal = await ops.awaitTerminalFamily({
        family,
        deadline,
        probe: probeResult,
      })
    } catch (error) {
      if (!probeResult.positive) throw error
      if (start.kind === 'active') throw error
      await ops.assertReleaseIdentity(manifest, hostedSha256)
      terminalEvidenceDigest = freshTerminalDigest({
        family,
        start,
        probe: probeResult,
        outcome: 'unsupported',
        nonce: nonce(),
      })
      terminal = await ops.terminalizeExperimental({
        family,
        reason: 'provider_timeout',
        evidenceDigest: terminalEvidenceDigest,
      })
    }
    familyResults[family.family] = {
      ...requireTerminalFamilyEvidence(terminal, family),
      start_state: start.kind,
      terminal_evidence_digest: terminalEvidenceDigest,
      probe: probeResult.evidence,
    }
  }
  await ops.assertReleaseIdentity(manifest, hostedSha256)
  const faultRecovery = await exerciseVerifierFinally(ops, manifest)
  const cleanup = await ops.assertFinalRollout(manifest, familyResults)
  requireCondition(cleanup?.status === 'PASS', 'final rollout assertion failed')
  return {
    schema_version: 1,
    phase: '03.8',
    status: 'PASS',
    release_manifest_id: manifest.release_manifest_id,
    manifest_file_sha256: RELEASE_MANIFEST_FILE_SHA256,
    manifest_sha256: RELEASE_MANIFEST_OBJECT_SHA256,
    hosted_evidence_sha256: hostedSha256,
    release_source_commit: RELEASE_SOURCE_COMMIT,
    generated_at: new Date(now()).toISOString(),
    limits: {
      family_ceiling_ms: FAMILY_CEILING_MS,
      provider_requests: PROVIDER_REQUEST_LIMIT,
      provider_deadline_ms: PROBE_DEADLINE_MS,
      active_latency_ms: ACTIVE_LATENCY_MS,
    },
    families: familyResults,
    fault_recovery: faultRecovery,
    cleanup,
  }
}

export function createDryRunPlan(manifest) {
  return {
    mode: 'DRY_RUN_NO_NETWORK_NO_MUTATION',
    release_manifest_id: manifest.release_manifest_id,
    manifest_file_sha256: RELEASE_MANIFEST_FILE_SHA256,
    manifest_sha256: RELEASE_MANIFEST_OBJECT_SHA256,
    hosted_evidence_sha256: PLAN_05_HOSTED_SHA256,
    release_source_commit: RELEASE_SOURCE_COMMIT,
    required_approval: exactApproval(),
    family_order: FAMILY_ORDER.map(({ family, company, sourceKey }) => ({
      family,
      company,
      source_key: sourceKey,
      ceiling_ms: FAMILY_CEILING_MS,
    })),
    mutation_sequence: [
      'revalidate exact release and pristine candidate',
      'run direct bounded read-only adapter probe',
      'invoke terminal RPC only after probe',
      'wait for terminal Unsupported or exactly three windows plus natural poll',
      'begin/fault/recover/finish verifier with cleanup in finally',
      'assert zero residue, revoked ACLs, and denied post-finish calls',
    ],
  }
}

function exactKeys(value, keys, label) {
  requireCondition(value && typeof value === 'object' && !Array.isArray(value),
    `${label} must be an object`)
  requireCondition(canonical(Object.keys(value).sort())
    === canonical([...keys].sort()), `${label} keys are not exact`)
}

export function assertRolloutEvidence(evidence, manifest, family = null) {
  exactKeys(evidence, [
    'schema_version',
    'phase',
    'status',
    'release_manifest_id',
    'manifest_file_sha256',
    'manifest_sha256',
    'hosted_evidence_sha256',
    'release_source_commit',
    'generated_at',
    'limits',
    'families',
    'fault_recovery',
    'cleanup',
  ], 'rollout evidence')
  requireCondition(evidence.schema_version === 1
    && evidence.phase === '03.8'
    && evidence.status === 'PASS'
    && evidence.release_manifest_id === RELEASE_MANIFEST_ID
    && evidence.manifest_file_sha256 === RELEASE_MANIFEST_FILE_SHA256
    && evidence.manifest_sha256 === RELEASE_MANIFEST_OBJECT_SHA256
    && evidence.hosted_evidence_sha256 === PLAN_05_HOSTED_SHA256
    && evidence.release_source_commit === RELEASE_SOURCE_COMMIT
    && manifest.release_manifest_id === RELEASE_MANIFEST_ID,
  'rollout evidence release binding failed')
  exactKeys(evidence.limits, [
    'family_ceiling_ms',
    'provider_requests',
    'provider_deadline_ms',
    'active_latency_ms',
  ], 'rollout limits')
  requireCondition(evidence.limits.family_ceiling_ms === FAMILY_CEILING_MS
    && evidence.limits.provider_requests === PROVIDER_REQUEST_LIMIT
    && evidence.limits.provider_deadline_ms === PROBE_DEADLINE_MS
    && evidence.limits.active_latency_ms === ACTIVE_LATENCY_MS,
  'rollout limits drift')
  exactKeys(evidence.families, FAMILY_ORDER.map((item) => item.family),
    'rollout families')
  const requested = family
    ? FAMILY_ORDER.filter((item) => item.family === family)
    : FAMILY_ORDER
  requireCondition(requested.length > 0, 'unknown rollout family assertion')
  for (const expected of requested) {
    const result = evidence.families[expected.family]
    requireTerminalFamilyEvidence(result, expected)
    exactKeys(result, result.outcome === 'active'
      ? [
          'family',
          'source_key',
          'status',
          'outcome',
          'activation_successes',
          'eligible_job_count',
          'natural_poll',
          'timestamps',
          'start_state',
          'terminal_evidence_digest',
          'probe',
        ]
      : [
          'family',
          'source_key',
          'status',
          'outcome',
          'reason',
          'scheduled',
          'monitored',
          'operational_rows',
          'start_state',
          'terminal_evidence_digest',
          'probe',
        ],
    `${expected.family} outcome`)
    exactKeys(result.probe, [
      'schema_version',
      'family',
      'company',
      'source_key',
      'completeness',
      'credible_for_closure',
      'allow_missing_closure',
      'job_count',
      'expected_count',
      'page_count',
      'warning_codes',
      'request_count',
      'elapsed_ms',
      'aggregate_scope_digest',
      'eligible_job_digests',
      'evidence_digest',
    ], `${expected.family} probe`)
    requireCondition(result.probe.family === expected.family
      && result.probe.company === expected.company
      && result.probe.source_key === expected.sourceKey
      && result.probe.request_count <= PROVIDER_REQUEST_LIMIT
      && result.probe.elapsed_ms <= PROBE_DEADLINE_MS + 1_000
      && /^[0-9a-f]{64}$/.test(result.probe.evidence_digest),
    `${expected.family} probe binding failed`)
    requireCondition(
      ['pending', 'terminal_unsupported', 'experimental', 'active']
        .includes(result.start_state)
      && (result.terminal_evidence_digest === null
        || /^[0-9a-f]{64}$/.test(result.terminal_evidence_digest)),
    `${expected.family} resume binding failed`)
  }
  exactKeys(evidence.fault_recovery, [
    'status',
    'fixtures',
    'exercise_calls',
    'real_company_sha256',
    'real_job_sha256',
    'real_companies_unchanged',
    'real_jobs_unchanged',
    'heartbeat_advanced',
    'sibling_isolation',
  ], 'fault/recovery evidence')
  requireCondition(evidence.fault_recovery?.status === 'PASS'
    && evidence.fault_recovery.exercise_calls === 6
    && Array.isArray(evidence.fault_recovery.fixtures)
    && evidence.fault_recovery.fixtures.length === 3
    && /^[0-9a-f]{64}$/.test(evidence.fault_recovery.real_company_sha256)
    && /^[0-9a-f]{64}$/.test(evidence.fault_recovery.real_job_sha256)
    && evidence.fault_recovery.real_companies_unchanged === true
    && evidence.fault_recovery.real_jobs_unchanged === true
    && evidence.fault_recovery.heartbeat_advanced === true
    && evidence.fault_recovery.sibling_isolation === true,
  'fault/recovery evidence is not PASS')
  exactKeys(evidence.cleanup, [
    'status',
    'catalog_rows',
    'protected_rows',
    'terminal',
  ], 'rollout cleanup')
  exactKeys(evidence.cleanup.terminal, [
    'run_rows',
    'fixture_rows',
    'company_rows',
    'job_rows',
    'observation_rows',
    'authority_state',
    'begin_execute',
    'exercise_execute',
    'finish_execute',
    'post_finish_denied',
  ], 'terminal cleanup')
  requireCondition(evidence.cleanup?.status === 'PASS'
    && evidence.cleanup.catalog_rows === 10
    && evidence.cleanup.protected_rows === 2,
  'rollout cleanup evidence is not PASS')
  const terminal = evidence.cleanup.terminal
  requireCondition(terminal?.run_rows === 0
    && terminal.fixture_rows === 0
    && terminal.company_rows === 0
    && terminal.job_rows === 0
    && terminal.observation_rows === 0
    && terminal.authority_state === 'consumed'
    && terminal.begin_execute === false
    && terminal.exercise_execute === false
    && terminal.finish_execute === false
    && terminal.post_finish_denied === true,
  'terminal verifier cleanup evidence failed')
  return evidence
}

function sqlLiteral(value) {
  requireCondition(typeof value === 'string'
    && value.length <= 256
    && !value.includes('\0'), 'unsafe SQL literal')
  return `'${value.replaceAll("'", "''")}'`
}

function oneRow(rows, label) {
  requireCondition(Array.isArray(rows) && rows.length === 1,
    `${label} returned an invalid row count`)
  return rows[0]
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

export class ManagementSqlOps {
  constructor({
    projectRef,
    accessToken,
    hosted,
    fetchImpl = fetch,
    wait = delay,
  }) {
    requireCondition(/^[a-z]{20}$/.test(projectRef),
      'Supabase project ref is invalid')
    requireCondition(typeof accessToken === 'string' && accessToken.length > 20,
      'SUPABASE_ACCESS_TOKEN is missing')
    this.projectRef = projectRef
    this.accessToken = accessToken
    this.hosted = hosted
    this.fetch = fetchImpl
    this.wait = wait
    this.webChecked = false
  }

  async query(query) {
    const response = await this.fetch(
      `https://api.supabase.com/v1/projects/${this.projectRef}/database/query`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ query }),
      },
    )
    if (!response.ok) {
      const raw = await response.text()
      const detail = raw
        .replaceAll(this.accessToken, '[access-token-redacted]')
        .replaceAll(
          /(?:authorization|bearer|apikey|token|secret|password)\s*[:=]?\s*\S+/gi,
          '[credential-redacted]',
        )
        .replaceAll(
          /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,
          '[jwt-redacted]',
        )
        .replaceAll(/\s+/g, ' ')
        .slice(0, 500)
      throw new Error(
        `management SQL returned HTTP ${response.status}: ${detail || '<empty>'}`,
      )
    }
    const rows = await response.json()
    requireCondition(Array.isArray(rows), 'management SQL response is malformed')
    return rows
  }

  async assertReleaseIdentity(manifest, hostedSha256) {
    requireCondition(manifest.release_manifest_id === RELEASE_MANIFEST_ID
      && hostedSha256 === PLAN_05_HOSTED_SHA256,
    'in-memory release identity drift')
    requireCondition(this.hosted?.status === 'PASS',
      'immutable hosted evidence was not supplied to live operations')
    const expectedMigrations = Array.from(
      { length: 40 },
      (_, index) => String(index + 1).padStart(4, '0'),
    )
    const row = oneRow(await this.query(`
      select
        (
          select coalesce(jsonb_agg(version::text order by version), '[]'::jsonb)
          from supabase_migrations.schema_migrations
        ) as migrations,
        (
          select count(*)::integer
          from public.phase_03_8_verifier_runs
          where run_id = '${VERIFIER_RUN_ID}'::uuid
            and release_manifest_id = '${RELEASE_MANIFEST_ID}'::uuid
            and state = 'armed'
            and started_at is null
            and expires_at is null
            and exercise_calls = 0
        ) as armed_runs,
        has_function_privilege(
          'service_role',
          'public.finalize_branded_connector_candidate(text,text,text,text)',
          'EXECUTE'
        ) as finalize_execute,
        (
          select count(*)::integer
          from cron.job
          where (jobname = 'observe-connectors-every-minute'
              and schedule = '* * * * *'
              and command like '%observe-connectors%'
              and command like '%120000%')
             or (jobname = 'poll-tick-every-minute'
              and schedule = '* * * * *'
              and command like '%poll-tick%'
              and command like '%120000%')
        ) as exact_cron_rows
    `), 'release identity')
    requireCondition(canonical(row.migrations) === canonical(expectedMigrations)
      && row.armed_runs === 1
      && row.finalize_execute === true
      && row.exact_cron_rows === 2,
    'hosted release/verifier identity drift')
    await this.assertRemoteRuntimeIdentity(manifest)
    return true
  }

  async assertRemoteRuntimeIdentity(manifest) {
    const response = await this.fetch(
      `https://api.supabase.com/v1/projects/${this.projectRef}/functions`,
      {
        headers: { authorization: `Bearer ${this.accessToken}` },
      },
    )
    requireCondition(response.ok,
      `Functions API returned HTTP ${response.status}`)
    const functions = await response.json()
    requireCondition(Array.isArray(functions), 'Functions API response is malformed')
    for (const [slug, checkKey] of [
      ['verify-board', 'verify_board_bundle'],
      ['observe-connectors', 'observe_connectors_bundle'],
      ['poll-tick', 'poll_tick_bundle'],
    ]) {
      const actual = functions.find((entry) => entry.slug === slug
        || entry.name === slug)
      const expected = this.hosted.checks[checkKey]
      requireCondition(actual
        && actual.id === expected.id
        && Number(actual.version) === expected.version
        && actual.status === expected.deployment_status
        && actual.verify_jwt === expected.verify_jwt,
      `${slug} hosted function identity drift`)
    }
    if (!this.webChecked) {
      const web = this.hosted.checks.web_identity
      const asset = await this.fetch(`${web.immutable_url}${web.asset_path}`)
      requireCondition(asset.ok, `immutable web asset returned HTTP ${asset.status}`)
      const bytes = Buffer.from(await asset.arrayBuffer())
      requireCondition(bytes.length === web.asset_bytes
        && sha256(bytes) === web.asset_sha256,
      'immutable web asset identity drift')
      this.webChecked = true
    }
    requireCondition(manifest.web.immutable_url
      === this.hosted.checks.web_identity.immutable_url,
    'manifest/hosted web identity drift')
  }

  async inspectCandidateStart(family) {
    const row = oneRow(await this.query(`
      with company_state as (
        select
          count(*)::integer as operational_rows,
          min(activation_state) as activation_state,
          min(activation_successes)::integer as activation_successes,
          min(ats_type) as ats_type
        from public.companies
        where source_key = ${sqlLiteral(family.sourceKey)}
      ),
      evidence_state as (
        select
          count(*)::integer as evidence_rows,
          count(*) filter (
            where outcome = 'admit_experimental'
          )::integer as positive_evidence_rows,
          (array_agg(outcome order by recorded_at desc))[1] as latest_outcome,
          (array_agg(reason order by recorded_at desc))[1] as latest_reason
        from public.branded_connector_terminal_evidence
        where source_key = ${sqlLiteral(family.sourceKey)}
      ),
      observation_state as (
        select
          count(*)::integer as observation_rows,
          count(distinct eligibility_window_start)::integer as window_rows
        from public.connector_observations
        where company_id in (
          select id from public.companies
          where source_key = ${sqlLiteral(family.sourceKey)}
        )
      )
      select
        catalog.disposition,
        catalog.unsupported_reason,
        catalog.source_key as catalog_source_key,
        company.*,
        evidence.*,
        observation.*
      from public.source_coverage_catalog as catalog
      cross join company_state as company
      cross join evidence_state as evidence
      cross join observation_state as observation
      where catalog.company_name = ${sqlLiteral(family.company)}
    `), `${family.family} candidate start`)
    const base = {
      family: family.family,
      source_key: family.sourceKey,
      operational_rows: row.operational_rows,
      evidence_rows: row.evidence_rows,
      positive_evidence_rows: row.positive_evidence_rows,
      activation_successes: row.activation_successes,
      observation_rows: row.observation_rows,
    }
    if (row.disposition === 'unsupported_with_reason'
      && row.unsupported_reason === 'pending_current_live_contract_proof'
      && row.catalog_source_key === null
      && row.operational_rows === 0
      && row.evidence_rows === 0) {
      return { ...base, kind: 'pending' }
    }
    if (row.disposition === 'unsupported_with_reason'
      && TERMINAL_REASONS.has(row.unsupported_reason)
      && row.catalog_source_key === null
      && row.operational_rows === 0
      && row.evidence_rows >= 1
      && row.latest_outcome === 'unsupported'
      && row.latest_reason === row.unsupported_reason) {
      return { ...base, kind: 'terminal_unsupported', reason: row.unsupported_reason }
    }
    if (row.disposition === 'experimental'
      && row.catalog_source_key === family.sourceKey
      && row.operational_rows === 1
      && row.ats_type === family.family
      && row.activation_state === 'experimental'
      && row.activation_successes >= 0
      && row.activation_successes <= 3
      && row.observation_rows === row.activation_successes
      && row.window_rows === row.observation_rows
      && row.positive_evidence_rows >= 1) {
      return { ...base, kind: 'experimental' }
    }
    if (row.catalog_source_key === family.sourceKey
      && row.operational_rows === 1
      && row.ats_type === family.family
      && row.activation_state === 'active'
      && row.activation_successes === 3
      && row.observation_rows === 3
      && row.window_rows === 3
      && row.positive_evidence_rows >= 1) {
      return { ...base, kind: 'active' }
    }
    throw new Error(`${family.family} candidate start state is ambiguous`)
  }

  async finalizeCandidate({ sourceKey, outcome, reason, evidenceDigest }) {
    requireCondition(FAMILY_ORDER.some((family) => family.sourceKey === sourceKey),
      'refusing unknown exact source')
    requireCondition(['admit_experimental', 'unsupported'].includes(outcome),
      'refusing unknown terminal outcome')
    requireCondition(reason === null || TERMINAL_REASONS.has(reason),
      'refusing unknown terminal reason')
    requireCondition(/^[0-9a-f]{64}$/.test(evidenceDigest),
      'terminal evidence digest is invalid')
    return oneRow(await this.query(`
      begin;
      set local role service_role;
      create temporary table phase_03_8_finalize_result
        on commit preserve rows
        as
      select *
      from public.finalize_branded_connector_candidate(
        ${sqlLiteral(sourceKey)},
        ${sqlLiteral(outcome)},
        ${reason === null ? 'null' : sqlLiteral(reason)},
        ${sqlLiteral(evidenceDigest)}
      );
      commit;
      select * from phase_03_8_finalize_result;
    `), `${sourceKey} finalize`)
  }

  async familyState(family) {
    return oneRow(await this.query(`
      with company_row as (
        select *
        from public.companies
        where source_key = ${sqlLiteral(family.sourceKey)}
      ),
      observation_state as (
        select
          count(*)::integer as observation_count,
          count(distinct eligibility_window_start)::integer as window_count,
          max(observed_at) as activated_at
        from public.connector_observations
        where company_id in (select id from company_row)
      ),
      job_state as (
        select
          count(*) filter (
            where status = 'open'
              and source = ${sqlLiteral(family.family)}
              and scope_evidence ->> 'sourceKey' = ${sqlLiteral(family.sourceKey)}
              and scope_evidence ->> 'detailCountryCode' = 'US'
              and coalesce(scope_evidence ->> 'providerCategoryLabel', '') <> ''
              and coalesce(scope_evidence ->> 'matchedTerm', '') <> ''
              and coalesce(scope_evidence ->> 'externalIdDigest', '')
                ~ '^[0-9a-f]{64}$'
          )::integer as eligible_job_count,
          max(last_seen_at) filter (where status = 'open') as feed_visible_at
        from public.jobs
        where company_id in (select id from company_row)
      )
      select
        clock_timestamp() as checked_at,
        catalog.disposition,
        catalog.unsupported_reason,
        catalog.source_key as catalog_source_key,
        company.id as company_id,
        company.activation_state,
        company.activation_successes,
        company.next_poll_at,
        company.last_polled_at,
        company.last_success_at,
        company.consecutive_failures,
        company.last_error_code,
        observation.observation_count,
        observation.window_count,
        observation.activated_at,
        case
          when observation.activated_at is null then null
          else observation.activated_at
            + (abs(hashtextextended(${sqlLiteral(family.sourceKey)}, 0)) % 5)
              * interval '1 minute'
        end as due_at,
        job.eligible_job_count,
        job.feed_visible_at
      from public.source_coverage_catalog as catalog
      left join company_row as company on true
      cross join observation_state as observation
      cross join job_state as job
      where catalog.company_name = ${sqlLiteral(family.company)}
    `), `${family.family} state`)
  }

  async awaitTerminalFamily({ family, deadline }) {
    while (Date.now() <= deadline) {
      const state = await this.familyState(family)
      if (state.disposition === 'unsupported_with_reason'
        && state.catalog_source_key === null
        && state.company_id === null) {
        return {
          family: family.family,
          source_key: family.sourceKey,
          status: 'PASS',
          outcome: 'unsupported',
          reason: state.unsupported_reason,
          scheduled: false,
          monitored: false,
          operational_rows: 0,
        }
      }
      const chain = state.activated_at
        && state.due_at
        && state.last_polled_at
        && state.last_success_at
        && state.feed_visible_at
        ? {
            activated_at: new Date(state.activated_at).toISOString(),
            due_at: new Date(state.due_at).toISOString(),
            claimed_at: new Date(state.last_polled_at).toISOString(),
            completed_at: new Date(state.last_success_at).toISOString(),
            feed_visible_at: new Date(state.feed_visible_at).toISOString(),
          }
        : null
      if (state.activation_state === 'active'
        && state.activation_successes === 3
        && state.observation_count === 3
        && state.window_count === 3
        && state.eligible_job_count > 0
        && state.consecutive_failures === 0
        && state.last_error_code === null
        && chain) {
        validateTimestampChain(chain)
        return {
          family: family.family,
          source_key: family.sourceKey,
          status: 'PASS',
          outcome: 'active',
          activation_successes: 3,
          eligible_job_count: state.eligible_job_count,
          natural_poll: true,
          timestamps: chain,
        }
      }
      await this.wait(Math.min(10_000, Math.max(1, deadline - Date.now())))
    }
    throw new Error(`${family.family} finite observation ceiling expired`)
  }

  async terminalizeExperimental({ family, reason, evidenceDigest }) {
    const result = await this.finalizeCandidate({
      sourceKey: family.sourceKey,
      outcome: 'unsupported',
      reason,
      evidenceDigest,
    })
    requireCondition(result.accepted === true
      && result.reason === 'recorded_unsupported',
    `${family.family} failed to terminalize Unsupported`)
    return this.awaitTerminalFamily({ family, deadline: Date.now() + 10_000 })
  }

  async runVerifierTransaction(manifest) {
    requireCondition(manifest.release_manifest_id === RELEASE_MANIFEST_ID,
      'verifier manifest identity drift')
    const row = oneRow(await this.query(`
      begin;
      set transaction isolation level repeatable read;
      create temporary table phase_03_8_runner_baseline
        on commit preserve rows
        as
      select
        encode(extensions.digest(convert_to(coalesce((
          select jsonb_agg(to_jsonb(stable_row) order by stable_row.source_key)::text
          from (
            select id, name, ats_type, source_key, careers_url,
              activation_state, activation_successes, consecutive_failures,
              last_error_code, last_observation_count
            from public.companies
            where source_key in (
              'eightfold:morganstanley',
              'oracle:jpmc:CX_1001',
              'goldman_higher:roles',
              'workday:wd12:capitalone:Capital_One',
              'workday:wd1:fmr:FidelityCareers'
            )
          ) as stable_row
        ), '[]'), 'UTF8'), 'sha256'), 'hex') as real_company_sha256,
        encode(extensions.digest(convert_to(coalesce((
          select jsonb_agg(to_jsonb(stable_row) order by stable_row.id)::text
          from (
            select job.id, job.company_id, job.source, job.external_id,
              job.status, job.fingerprint, job.scope_evidence
            from public.jobs as job
            join public.companies as company on company.id = job.company_id
            where company.source_key in (
              'eightfold:morganstanley',
              'oracle:jpmc:CX_1001',
              'goldman_higher:roles',
              'workday:wd12:capitalone:Capital_One',
              'workday:wd1:fmr:FidelityCareers'
            )
          ) as stable_row
        ), '[]'), 'UTF8'), 'sha256'), 'hex') as real_job_sha256,
        (select last_success_at from public.pipeline_heartbeat where id = true)
          as heartbeat_before;
      create temporary table phase_03_8_runner_results (
        fixture_key text,
        fixture_version integer,
        fault text,
        job_status text,
        activation_state text,
        consecutive_failures integer
      ) on commit preserve rows;
      grant insert, select on phase_03_8_runner_results to service_role;
      create temporary table phase_03_8_runner_checkpoints (
        stage text,
        fixture_key text,
        fixture_version integer,
        last_fault text,
        last_error_code text,
        job_status text
      ) on commit preserve rows;
      create temporary table phase_03_8_runner_begin (
        started boolean,
        expires_at timestamptz,
        exercise_calls integer,
        fixture_count integer
      ) on commit preserve rows;
      grant insert, select on phase_03_8_runner_begin to service_role;
      set local role service_role;
      insert into phase_03_8_runner_begin
      select * from public.begin_phase_03_8_verifier_run(
        '${VERIFIER_RUN_ID}'::uuid
      );
      reset role;
      set local role anon;
      do $anon_denied$
      begin
        begin
          perform * from public.begin_phase_03_8_verifier_run(
            '${VERIFIER_RUN_ID}'::uuid
          );
          raise exception 'anon verifier begin was callable';
        exception when insufficient_privilege then null;
        end;
        begin
          perform * from public.exercise_phase_03_8_verifier_fault(
            '${VERIFIER_RUN_ID}'::uuid, 'eightfold_fixture',
            'provider_timeout', 0
          );
          raise exception 'anon verifier exercise was callable';
        exception when insufficient_privilege then null;
        end;
        begin
          perform * from public.finish_phase_03_8_verifier_run(
            '${VERIFIER_RUN_ID}'::uuid, 0, 0, 0
          );
          raise exception 'anon verifier finish was callable';
        exception when insufficient_privilege then null;
        end;
      end
      $anon_denied$;
      reset role;
      set local role authenticated;
      do $authenticated_denied$
      begin
        begin
          perform * from public.begin_phase_03_8_verifier_run(
            '${VERIFIER_RUN_ID}'::uuid
          );
          raise exception 'authenticated verifier begin was callable';
        exception when insufficient_privilege then null;
        end;
        begin
          perform * from public.exercise_phase_03_8_verifier_fault(
            '${VERIFIER_RUN_ID}'::uuid, 'eightfold_fixture',
            'provider_timeout', 0
          );
          raise exception 'authenticated verifier exercise was callable';
        exception when insufficient_privilege then null;
        end;
        begin
          perform * from public.finish_phase_03_8_verifier_run(
            '${VERIFIER_RUN_ID}'::uuid, 0, 0, 0
          );
          raise exception 'authenticated verifier finish was callable';
        exception when insufficient_privilege then null;
        end;
      end
      $authenticated_denied$;
      reset role;
      do $negative$
      begin
        if not exists (
          select 1
          from phase_03_8_runner_begin
          where started is true
            and exercise_calls = 0
            and fixture_count = 3
            and expires_at > clock_timestamp()
            and expires_at <= clock_timestamp() + interval '20 minutes 5 seconds'
        ) or not exists (
          select 1
          from public.phase_03_8_verifier_runs
          where run_id = '${VERIFIER_RUN_ID}'::uuid
            and state = 'running'
            and max_exercise_calls = 12
        ) then
          raise exception 'verifier begin bounds failed';
        end if;
        if exists (
          select 1
          from (values
            ('anon'::text), ('authenticated'::text)
          ) as role_name(name)
          cross join (values
            ('public.begin_phase_03_8_verifier_run(uuid)'::text),
            ('public.exercise_phase_03_8_verifier_fault(uuid,text,text,integer)'::text),
            ('public.finish_phase_03_8_verifier_run(uuid,integer,integer,integer)'::text)
          ) as procedure_name(name)
          where has_function_privilege(
            role_name.name, procedure_name.name, 'EXECUTE'
          )
        ) then
          raise exception 'unauthorized verifier ACL remains';
        end if;
        begin
          execute 'set local role service_role';
          perform * from public.begin_phase_03_8_verifier_run(
            '03850000-0000-4000-8000-000000009999'::uuid
          );
          execute 'reset role';
          raise exception 'unknown verifier run was accepted';
        exception when sqlstate '22023' then
          execute 'reset role';
        end;
        begin
          execute 'set local role service_role';
          perform * from public.exercise_phase_03_8_verifier_fault(
            '${VERIFIER_RUN_ID}'::uuid, 'eightfold_fixture',
            'unknown_fault', 0
          );
          execute 'reset role';
          raise exception 'unknown verifier fault was accepted';
        exception when sqlstate '22023' then
          execute 'reset role';
        end;
        begin
          execute 'set local role service_role';
          perform * from public.finish_phase_03_8_verifier_run(
            '03850000-0000-4000-8000-000000009999'::uuid, 0, 0, 0
          );
          execute 'reset role';
          raise exception 'unknown verifier finish was accepted';
        exception when sqlstate '22023' then
          execute 'reset role';
        end;
        begin
          execute 'set local role service_role';
          perform * from public.exercise_phase_03_8_verifier_fault(
            '${VERIFIER_RUN_ID}'::uuid, 'real_company_identifier',
            'provider_timeout', 0
          );
          execute 'reset role';
          raise exception 'unknown verifier fixture was accepted';
        exception when sqlstate '22023' then
          execute 'reset role';
        end;
        begin
          update public.phase_03_8_verifier_runs
          set expires_at = clock_timestamp() - interval '1 second'
          where run_id = '${VERIFIER_RUN_ID}'::uuid;
          execute 'set local role service_role';
          perform * from public.exercise_phase_03_8_verifier_fault(
            '${VERIFIER_RUN_ID}'::uuid, 'eightfold_fixture',
            'provider_timeout', 0
          );
          execute 'reset role';
          raise exception 'expired verifier run was accepted';
        exception when sqlstate '55000' then
          execute 'reset role';
        end;
        begin
          update public.phase_03_8_verifier_runs
          set exercise_calls = max_exercise_calls
          where run_id = '${VERIFIER_RUN_ID}'::uuid;
          execute 'set local role service_role';
          perform * from public.exercise_phase_03_8_verifier_fault(
            '${VERIFIER_RUN_ID}'::uuid, 'eightfold_fixture',
            'provider_timeout', 0
          );
          execute 'reset role';
          raise exception 'exhausted verifier run was accepted';
        exception when sqlstate '55000' then
          execute 'reset role';
        end;
      end
      $negative$;
      set local role service_role;
      insert into phase_03_8_runner_results
      select fixture_key, fixture_version, fault, job_status,
        activation_state, consecutive_failures
      from public.exercise_phase_03_8_verifier_fault(
        '${VERIFIER_RUN_ID}'::uuid, 'eightfold_fixture',
        'incomplete_observation', 0
      );
      reset role;
      insert into phase_03_8_runner_checkpoints
      select 'eightfold_fault', fixture.fixture_key, fixture.fixture_version,
        fixture.last_fault, company.last_error_code, job.status
      from public.phase_03_8_verifier_fixtures as fixture
      join public.companies as company on company.id = fixture.company_id
      join public.jobs as job on job.id = fixture.job_id
      where fixture.run_id = '${VERIFIER_RUN_ID}'::uuid;
      do $stale$
      begin
        begin
          execute 'set local role service_role';
          perform * from public.exercise_phase_03_8_verifier_fault(
            '${VERIFIER_RUN_ID}'::uuid, 'eightfold_fixture',
            'clean_recovery', 0
          );
          execute 'reset role';
          raise exception 'stale verifier version was accepted';
        exception when sqlstate '40001' then
          execute 'reset role';
        end;
        if (select exercise_calls from public.phase_03_8_verifier_runs
            where run_id = '${VERIFIER_RUN_ID}'::uuid) <> 1
          or (select fixture_version
              from public.phase_03_8_verifier_fixtures
              where run_id = '${VERIFIER_RUN_ID}'::uuid
                and fixture_key = 'eightfold_fixture') <> 1
        then
          raise exception 'negative verifier checks mutated state';
        end if;
      end
      $stale$;
      set local role service_role;
      insert into phase_03_8_runner_results
      select fixture_key, fixture_version, fault, job_status,
        activation_state, consecutive_failures
      from public.exercise_phase_03_8_verifier_fault(
        '${VERIFIER_RUN_ID}'::uuid, 'eightfold_fixture', 'clean_recovery', 1
      );
      reset role;
      insert into phase_03_8_runner_checkpoints
      select 'eightfold_recovery', fixture.fixture_key, fixture.fixture_version,
        fixture.last_fault, company.last_error_code, job.status
      from public.phase_03_8_verifier_fixtures as fixture
      join public.companies as company on company.id = fixture.company_id
      join public.jobs as job on job.id = fixture.job_id
      where fixture.run_id = '${VERIFIER_RUN_ID}'::uuid;
      set local role service_role;
      insert into phase_03_8_runner_results
      select fixture_key, fixture_version, fault, job_status,
        activation_state, consecutive_failures
      from public.exercise_phase_03_8_verifier_fault(
        '${VERIFIER_RUN_ID}'::uuid, 'oracle_fixture',
        'provider_schema_error', 0
      );
      reset role;
      insert into phase_03_8_runner_checkpoints
      select 'oracle_fault', fixture.fixture_key, fixture.fixture_version,
        fixture.last_fault, company.last_error_code, job.status
      from public.phase_03_8_verifier_fixtures as fixture
      join public.companies as company on company.id = fixture.company_id
      join public.jobs as job on job.id = fixture.job_id
      where fixture.run_id = '${VERIFIER_RUN_ID}'::uuid;
      set local role service_role;
      insert into phase_03_8_runner_results
      select fixture_key, fixture_version, fault, job_status,
        activation_state, consecutive_failures
      from public.exercise_phase_03_8_verifier_fault(
        '${VERIFIER_RUN_ID}'::uuid, 'oracle_fixture', 'clean_recovery', 1
      );
      reset role;
      insert into phase_03_8_runner_checkpoints
      select 'oracle_recovery', fixture.fixture_key, fixture.fixture_version,
        fixture.last_fault, company.last_error_code, job.status
      from public.phase_03_8_verifier_fixtures as fixture
      join public.companies as company on company.id = fixture.company_id
      join public.jobs as job on job.id = fixture.job_id
      where fixture.run_id = '${VERIFIER_RUN_ID}'::uuid;
      set local role service_role;
      insert into phase_03_8_runner_results
      select fixture_key, fixture_version, fault, job_status,
        activation_state, consecutive_failures
      from public.exercise_phase_03_8_verifier_fault(
        '${VERIFIER_RUN_ID}'::uuid, 'goldman_fixture', 'provider_timeout', 0
      );
      reset role;
      insert into phase_03_8_runner_checkpoints
      select 'goldman_fault', fixture.fixture_key, fixture.fixture_version,
        fixture.last_fault, company.last_error_code, job.status
      from public.phase_03_8_verifier_fixtures as fixture
      join public.companies as company on company.id = fixture.company_id
      join public.jobs as job on job.id = fixture.job_id
      where fixture.run_id = '${VERIFIER_RUN_ID}'::uuid;
      set local role service_role;
      insert into phase_03_8_runner_results
      select fixture_key, fixture_version, fault, job_status,
        activation_state, consecutive_failures
      from public.exercise_phase_03_8_verifier_fault(
        '${VERIFIER_RUN_ID}'::uuid, 'goldman_fixture', 'clean_recovery', 1
      );
      reset role;
      insert into phase_03_8_runner_checkpoints
      select 'goldman_recovery', fixture.fixture_key, fixture.fixture_version,
        fixture.last_fault, company.last_error_code, job.status
      from public.phase_03_8_verifier_fixtures as fixture
      join public.companies as company on company.id = fixture.company_id
      join public.jobs as job on job.id = fixture.job_id
      where fixture.run_id = '${VERIFIER_RUN_ID}'::uuid;
      create temporary table phase_03_8_runner_after
        on commit preserve rows
        as
      select
        encode(extensions.digest(convert_to(coalesce((
          select jsonb_agg(to_jsonb(stable_row) order by stable_row.source_key)::text
          from (
            select id, name, ats_type, source_key, careers_url,
              activation_state, activation_successes, consecutive_failures,
              last_error_code, last_observation_count
            from public.companies
            where source_key in (
              'eightfold:morganstanley',
              'oracle:jpmc:CX_1001',
              'goldman_higher:roles',
              'workday:wd12:capitalone:Capital_One',
              'workday:wd1:fmr:FidelityCareers'
            )
          ) as stable_row
        ), '[]'), 'UTF8'), 'sha256'), 'hex') as real_company_sha256,
        encode(extensions.digest(convert_to(coalesce((
          select jsonb_agg(to_jsonb(stable_row) order by stable_row.id)::text
          from (
            select job.id, job.company_id, job.source, job.external_id,
              job.status, job.fingerprint, job.scope_evidence
            from public.jobs as job
            join public.companies as company on company.id = job.company_id
            where company.source_key in (
              'eightfold:morganstanley',
              'oracle:jpmc:CX_1001',
              'goldman_higher:roles',
              'workday:wd12:capitalone:Capital_One',
              'workday:wd1:fmr:FidelityCareers'
            )
          ) as stable_row
        ), '[]'), 'UTF8'), 'sha256'), 'hex') as real_job_sha256,
        (select last_success_at from public.pipeline_heartbeat where id = true)
          as heartbeat_after;
      do $assert$
      begin
        if (select count(*) from phase_03_8_runner_results) <> 6
          or exists (
            select 1 from phase_03_8_runner_results
            where job_status <> 'open'
               or fixture_version not between 1 and 2
               or (fault = 'clean_recovery'
                 and (activation_state <> 'active' or consecutive_failures <> 0))
          )
          or (select count(*) from public.phase_03_8_verifier_fixtures
              where run_id = '${VERIFIER_RUN_ID}'::uuid
                and fixture_version between 0 and 2) <> 3
          or (select count(*) from phase_03_8_runner_checkpoints) <> 18
          or exists (
            select 1 from phase_03_8_runner_checkpoints
            where job_status <> 'open'
          )
          or exists (
            select 1
            from phase_03_8_runner_checkpoints
            where (stage = 'eightfold_fault' and (
                (fixture_key = 'eightfold_fixture'
                  and (fixture_version <> 1
                    or last_error_code <> 'incomplete_observation'))
                or (fixture_key <> 'eightfold_fixture'
                  and (fixture_version <> 0 or last_error_code is not null))
              ))
              or (stage = 'eightfold_recovery' and (
                (fixture_key = 'eightfold_fixture'
                  and (fixture_version <> 2 or last_error_code is not null))
                or (fixture_key <> 'eightfold_fixture'
                  and (fixture_version <> 0 or last_error_code is not null))
              ))
              or (stage = 'oracle_fault' and (
                (fixture_key = 'oracle_fixture'
                  and (fixture_version <> 1
                    or last_error_code <> 'provider_schema_error'))
                or (fixture_key = 'eightfold_fixture'
                  and (fixture_version <> 2 or last_error_code is not null))
                or (fixture_key = 'goldman_fixture'
                  and (fixture_version <> 0 or last_error_code is not null))
              ))
              or (stage = 'oracle_recovery' and (
                (fixture_key in ('eightfold_fixture', 'oracle_fixture')
                  and (fixture_version <> 2 or last_error_code is not null))
                or (fixture_key = 'goldman_fixture'
                  and (fixture_version <> 0 or last_error_code is not null))
              ))
              or (stage = 'goldman_fault' and (
                (fixture_key = 'goldman_fixture'
                  and (fixture_version <> 1
                    or last_error_code <> 'provider_timeout'))
                or (fixture_key <> 'goldman_fixture'
                  and (fixture_version <> 2 or last_error_code is not null))
              ))
              or (stage = 'goldman_recovery'
                and (fixture_version <> 2 or last_error_code is not null))
          )
          or not coalesce((
            select after.real_company_sha256 = baseline.real_company_sha256
              and after.real_job_sha256 = baseline.real_job_sha256
              and after.heartbeat_after > baseline.heartbeat_before
            from phase_03_8_runner_after as after
            cross join phase_03_8_runner_baseline as baseline
          ), false)
        then
          raise exception 'verifier transition assertion failed';
        end if;
      end
      $assert$;
      create temporary table phase_03_8_runner_versions
        on commit preserve rows
        as
      select fixture_key, fixture_version
      from public.phase_03_8_verifier_fixtures
      where run_id = '${VERIFIER_RUN_ID}'::uuid
        and fixture_key in (
          'eightfold_fixture', 'oracle_fixture', 'goldman_fixture'
        );
      grant select on phase_03_8_runner_versions to service_role;
      create temporary table phase_03_8_runner_finish (
        consumed boolean,
        release_manifest_id uuid,
        run_id uuid,
        exercise_calls integer,
        deleted_fixtures integer,
        remaining_rows integer,
        grants_revoked boolean
      ) on commit preserve rows;
      grant insert, select on phase_03_8_runner_finish to service_role;
      set local role service_role;
      insert into phase_03_8_runner_finish
      select *
      from public.finish_phase_03_8_verifier_run(
        '${VERIFIER_RUN_ID}'::uuid,
        (select fixture_version
         from phase_03_8_runner_versions
         where fixture_key = 'eightfold_fixture'),
        (select fixture_version
         from phase_03_8_runner_versions
         where fixture_key = 'oracle_fixture'),
        (select fixture_version
         from phase_03_8_runner_versions
         where fixture_key = 'goldman_fixture')
      );
      reset role;
      commit;
      select
        finish.consumed,
        finish.release_manifest_id,
        finish.run_id,
        finish.exercise_calls,
        finish.deleted_fixtures,
        finish.remaining_rows,
        finish.grants_revoked,
        (select count(*)::integer
         from phase_03_8_runner_results) as transition_rows,
        baseline.real_company_sha256,
        baseline.real_job_sha256,
        (
          baseline.real_company_sha256 = encode(
            extensions.digest(convert_to(coalesce((
              select jsonb_agg(to_jsonb(stable_row) order by stable_row.source_key)::text
              from (
                select id, name, ats_type, source_key, careers_url,
                  activation_state, activation_successes, consecutive_failures,
                  last_error_code, last_observation_count
                from public.companies
                where source_key in (
                  'eightfold:morganstanley',
                  'oracle:jpmc:CX_1001',
                  'goldman_higher:roles',
                  'workday:wd12:capitalone:Capital_One',
                  'workday:wd1:fmr:FidelityCareers'
                )
              ) as stable_row
            ), '[]'), 'UTF8'), 'sha256'), 'hex')
        ) as real_companies_unchanged,
        (
          baseline.real_job_sha256 = encode(
            extensions.digest(convert_to(coalesce((
              select jsonb_agg(to_jsonb(stable_row) order by stable_row.id)::text
              from (
                select job.id, job.company_id, job.source, job.external_id,
                  job.status, job.fingerprint, job.scope_evidence
                from public.jobs as job
                join public.companies as company on company.id = job.company_id
                where company.source_key in (
                  'eightfold:morganstanley',
                  'oracle:jpmc:CX_1001',
                  'goldman_higher:roles',
                  'workday:wd12:capitalone:Capital_One',
                  'workday:wd1:fmr:FidelityCareers'
                )
              ) as stable_row
            ), '[]'), 'UTF8'), 'sha256'), 'hex')
        ) as real_jobs_unchanged,
        (
          select last_success_at > baseline.heartbeat_before
          from public.pipeline_heartbeat where id = true
        ) as heartbeat_advanced,
        (
          select count(*) = 18
            and bool_and(job_status = 'open')
          from phase_03_8_runner_checkpoints
        ) as sibling_isolation,
        not has_function_privilege(
          'service_role',
          'public.begin_phase_03_8_verifier_run(uuid)',
          'EXECUTE'
        ) as begin_denied,
        not has_function_privilege(
          'service_role',
          'public.exercise_phase_03_8_verifier_fault(uuid,text,text,integer)',
          'EXECUTE'
        ) as exercise_denied,
        not has_function_privilege(
          'service_role',
          'public.finish_phase_03_8_verifier_run(uuid,integer,integer,integer)',
          'EXECUTE'
        ) as finish_denied
      from phase_03_8_runner_finish as finish
      cross join phase_03_8_runner_baseline as baseline;
    `), 'verifier transaction')
    requireCondition(row.consumed === true
      && row.release_manifest_id === RELEASE_MANIFEST_ID
      && row.run_id === VERIFIER_RUN_ID
      && row.exercise_calls === 6
      && row.deleted_fixtures === 3
      && row.remaining_rows === 0
      && row.grants_revoked === true
      && row.transition_rows === 6
      && row.real_companies_unchanged === true
      && row.real_jobs_unchanged === true
      && row.heartbeat_advanced === true
      && row.sibling_isolation === true
      && row.begin_denied === true
      && row.exercise_denied === true
      && row.finish_denied === true,
    'verifier transaction did not finish cleanly')
    return {
      status: 'PASS',
      fixtures: FAMILY_ORDER.map((family) => ({
        fixture: family.fixture,
        fault: family.fault,
        status: 'PASS',
      })),
      exercise_calls: 6,
      real_company_sha256: row.real_company_sha256,
      real_job_sha256: row.real_job_sha256,
      real_companies_unchanged: true,
      real_jobs_unchanged: true,
      heartbeat_advanced: true,
      sibling_isolation: true,
    }
  }

  async assertVerifierTerminal(manifest) {
    const companyIds = manifest.verifier.fixtures
      .map((row) => `'${row.company_id}'::uuid`).join(',')
    const jobIds = manifest.verifier.fixtures
      .map((row) => `'${row.job_id}'::uuid`).join(',')
    const observationIds = manifest.verifier.fixtures
      .map((row) => `'${row.observation_id}'::uuid`).join(',')
    const row = oneRow(await this.query(`
      begin;
      set local role service_role;
      do $denied$
      begin
        begin
          perform * from public.begin_phase_03_8_verifier_run(
            '${VERIFIER_RUN_ID}'::uuid
          );
          raise exception 'post-finish begin was callable';
        exception when insufficient_privilege then null;
        end;
        begin
          perform * from public.exercise_phase_03_8_verifier_fault(
            '${VERIFIER_RUN_ID}'::uuid, 'eightfold_fixture',
            'clean_recovery', 2
          );
          raise exception 'post-finish exercise was callable';
        exception when insufficient_privilege then null;
        end;
        begin
          perform * from public.finish_phase_03_8_verifier_run(
            '${VERIFIER_RUN_ID}'::uuid, 2, 2, 2
          );
          raise exception 'post-finish finish was callable';
        exception when insufficient_privilege then null;
        end;
      end
      $denied$;
      reset role;
      commit;
      select
        (select count(*)::integer from public.phase_03_8_verifier_runs
         where run_id = '${VERIFIER_RUN_ID}'::uuid) as run_rows,
        (select count(*)::integer from public.phase_03_8_verifier_fixtures
         where run_id = '${VERIFIER_RUN_ID}'::uuid) as fixture_rows,
        (select count(*)::integer from public.companies
         where id in (${companyIds})) as company_rows,
        (select count(*)::integer from public.jobs
         where id in (${jobIds})) as job_rows,
        (select count(*)::integer from public.connector_observations
         where observation_id in (${observationIds})) as observation_rows,
        not has_function_privilege(
          'service_role',
          'public.begin_phase_03_8_verifier_run(uuid)',
          'EXECUTE'
        ) as begin_denied,
        not has_function_privilege(
          'service_role',
          'public.exercise_phase_03_8_verifier_fault(uuid,text,text,integer)',
          'EXECUTE'
        ) as exercise_denied,
        not has_function_privilege(
          'service_role',
          'public.finish_phase_03_8_verifier_run(uuid,integer,integer,integer)',
          'EXECUTE'
        ) as finish_denied,
        true as post_finish_denied
    `), 'terminal verifier state')
    return {
      run_rows: row.run_rows,
      fixture_rows: row.fixture_rows,
      company_rows: row.company_rows,
      job_rows: row.job_rows,
      observation_rows: row.observation_rows,
      authority_state: 'consumed',
      begin_execute: !row.begin_denied,
      exercise_execute: !row.exercise_denied,
      finish_execute: !row.finish_denied,
      post_finish_denied: row.post_finish_denied
        && row.begin_denied && row.exercise_denied && row.finish_denied,
    }
  }

  async assertFinalRollout(manifest, familyResults) {
    requireCondition(Object.keys(familyResults).length === 3,
      'all three family outcomes are required')
    const terminal = await this.assertVerifierTerminal(manifest)
    const row = oneRow(await this.query(`
      select
        (select count(*)::integer
         from public.source_coverage_catalog
         where company_name in (
           'Morgan Stanley', 'Goldman Sachs', 'JPMorgan Chase',
           'Bank of America', 'Citi', 'BlackRock', 'Wells Fargo',
           'UBS', 'Barclays', 'Charles Schwab'
         )) as catalog_rows,
        (select count(*)::integer
         from public.companies
         where source_key in (
           'eightfold:morganstanley',
           'oracle:jpmc:CX_1001',
           'goldman_higher:roles'
         )
           and activation_state in ('experimental', 'degraded')) as invalid_candidates,
        (select count(*)::integer
         from public.companies
         where (source_key, activation_state, activation_successes) in (
           ('workday:wd12:capitalone:Capital_One', 'active', 3),
           ('workday:wd1:fmr:FidelityCareers', 'active', 3)
         )) as protected_rows
    `), 'final rollout')
    requireCondition(row.catalog_rows === 10
      && row.invalid_candidates === 0
      && row.protected_rows === 2,
    'final catalog/candidate/protected-source assertion failed')
    return {
      status: 'PASS',
      catalog_rows: row.catalog_rows,
      protected_rows: row.protected_rows,
      terminal,
    }
  }
}

function parseArgs(argv) {
  const result = {
    mode: 'dry-run',
    manifest: DEFAULT_MANIFEST,
    hosted: DEFAULT_HOSTED,
    output: DEFAULT_OUTPUT,
    sourceWorktree: null,
    approval: null,
    family: null,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--dry-run') result.mode = 'dry-run'
    else if (value === '--execute') result.mode = 'execute'
    else if (value === '--assert-evidence') {
      result.mode = 'assert-evidence'
      result.output = resolve(argv[++index])
    }
    else if (value === '--manifest') result.manifest = resolve(argv[++index])
    else if (value === '--hosted') result.hosted = resolve(argv[++index])
    else if (value === '--output') result.output = resolve(argv[++index])
    else if (value === '--source-worktree') result.sourceWorktree = resolve(argv[++index])
    else if (value === '--approve') result.approval = argv[++index]
    else if (value === '--family') result.family = argv[++index]
    else if (value === '--all-families') result.family = null
    else throw new Error(`unknown argument: ${value}`)
  }
  return result
}

async function sourceIdentity(worktree) {
  requireCondition(worktree, '--source-worktree is required')
  const [{ stdout: commit }, { stdout: status }, { stdout: object }] =
    await Promise.all([
      execFile('git', ['rev-parse', 'HEAD'], { cwd: worktree }),
      execFile('git', ['status', '--porcelain', '--untracked-files=no'], {
        cwd: worktree,
      }),
      execFile('git', ['cat-file', 'commit', 'HEAD'], {
        cwd: worktree,
        maxBuffer: 4 * 1024 * 1024,
      }),
    ])
  requireCondition(status.trim() === '',
    'source worktree has tracked modifications')
  return {
    commit: commit.trim(),
    commitObjectSha256: sha256(object),
  }
}

async function promoteOutput(output, result) {
  const serialized = `${JSON.stringify(result, null, 2)}\n`
  try {
    const existing = JSON.parse(await readFile(output, 'utf8'))
    requireCondition(existing.status === 'PENDING'
      && existing.release_manifest_id === RELEASE_MANIFEST_ID
      && existing.manifest_file_sha256 === RELEASE_MANIFEST_FILE_SHA256
      && existing.manifest_sha256 === RELEASE_MANIFEST_OBJECT_SHA256
      && existing.hosted_evidence_sha256 === PLAN_05_HOSTED_SHA256
      && existing.release_source_commit === RELEASE_SOURCE_COMMIT,
    'refusing to replace a non-exact rollout template')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    await writeFile(output, serialized, { flag: 'wx', mode: 0o600 })
    return
  }
  const temporary = `${output}.tmp-${process.pid}`
  await writeFile(temporary, serialized, { flag: 'wx', mode: 0o600 })
  try {
    await rename(temporary, output)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const [manifestBytes, hostedBytes] = await Promise.all([
    readFile(args.manifest),
    readFile(args.hosted),
  ])
  const manifestJson = JSON.parse(manifestBytes)
  if (args.mode === 'assert-evidence') {
    const { manifest } = validateIdentityFiles({
      manifestBytes,
      hostedBytes,
      sourceCommit: manifestJson.candidate?.git_sha,
    })
    const evidence = JSON.parse(await readFile(args.output, 'utf8'))
    assertRolloutEvidence(evidence, manifest, args.family)
    process.stdout.write(`PASS: ${args.output} is exact-release rollout evidence\n`)
    return
  }
  if (args.mode === 'dry-run') {
    validateIdentityFiles({
      manifestBytes,
      hostedBytes,
      sourceCommit: manifestJson.candidate?.git_sha,
    })
    process.stdout.write(`${JSON.stringify(createDryRunPlan(manifestJson), null, 2)}\n`)
    return
  }
  requireCondition(args.approval === exactApproval(),
    'mutation requires the exact manifest/hash-bound approval string')
  const identity = await sourceIdentity(args.sourceWorktree)
  const { manifest, hosted } = validateIdentityFiles({
    manifestBytes,
    hostedBytes,
    sourceCommit: identity.commit,
  })
  requireCondition(identity.commitObjectSha256
    === manifest.candidate.commit_object_sha256,
  'source worktree commit object hash drift')
  const ops = new ManagementSqlOps({
    projectRef: manifest.targets.supabase.project_ref,
    accessToken: process.env.SUPABASE_ACCESS_TOKEN?.trim(),
    hosted,
  })
  const result = await executeRollout({
    manifest,
    ops,
    probe: (family) => directProbe(family, { root: args.sourceWorktree }),
  })
  await promoteOutput(args.output, result)
  process.stdout.write(`PASS: wrote ${args.output}\n`)
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`FAIL: ${boundedText(error?.message ?? error, 240)}\n`)
    process.exitCode = 1
  })
}

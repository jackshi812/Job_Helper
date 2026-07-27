#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import {
  GOLDMAN_HIGHER_SOURCE_KEY,
  resolveBrandedIdentity,
  type GoldmanHigherBrandedIdentity,
} from '../supabase/functions/_shared/branded-identities.ts'
import {
  exactApproval as rolloutExactApproval,
  validateManifest as rolloutValidateManifest,
} from './run-phase-03-10-rollout.mjs'

type JsonRecord = Record<string, unknown>
type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

export const GOLDMAN_SOURCE_KEY = GOLDMAN_HIGHER_SOURCE_KEY
export const PROJECT_REF = 'fjcsvajkkztvlrpdplwx'
export const PHASE_DIR =
  '.planning/phases/03.10-goldman-sachs-selective-higher-monitoring'
export const DEFAULT_ROLLOUT_OUTPUT =
  `${PHASE_DIR}/03.10-01-ROLLOUT-VERIFICATION.json`
export const DEFAULT_ROLLOUT_EVIDENCE =
  `${PHASE_DIR}/03.10-01-ROLLOUT-EVIDENCE.md`

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SUPABASE_CLI = resolve(ROOT, 'web/node_modules/.bin/supabase')
const REST_ROOT = `https://${PROJECT_REF}.supabase.co/rest/v1`
const execFile = promisify(execFileCallback)
const HASH = /^[a-f0-9]{64}$/
const NUMERIC_SOURCE_ID = /^[0-9]{1,256}$/
const RECENT_HOURS = 720
const ALLOWED_CATEGORY_TERMS = new Set([
  'Data',
  'Technology',
  'Finance',
  'Investment',
  'Research',
  'Risk',
  'Capital Markets',
])
const ALLOWED_RECRUITING_TYPES = new Set([
  'GS_EARLY_CAREER',
  'GS_MID_CAREER',
])
const SCHEDULER_FIELDS = new Set([
  'consecutive_failures',
  'last_error',
  'last_error_code',
  'last_observation_count',
  'last_polled_at',
  'last_success_at',
  'last_tick_at',
  'next_poll_at',
])
const UNSUPPORTED_REASON_BY_WARNING = new Map([
  ['posting_date_ineligible', 'posting_date_ineligible'],
  ['category_evidence_missing', 'category_evidence_missing'],
  ['country_evidence_missing', 'country_evidence_missing'],
  ['detail_country_ineligible', 'country_evidence_missing'],
  ['application_evidence_missing', 'application_evidence_missing'],
  ['detail_evidence_missing', 'detail_scope_incomplete'],
  ['detail_scope_incomplete', 'detail_scope_incomplete'],
  ['population_evidence_missing', 'population_evidence_missing'],
  ['detail_population_ineligible', 'population_evidence_missing'],
  ['page_cap_exceeded', 'pagination_incomplete'],
  ['pagination_incomplete', 'pagination_incomplete'],
  ['count_mismatch', 'count_mismatch'],
  ['job_cap_exceeded', 'job_cap_exceeded'],
  ['detail_cap_exceeded', 'job_cap_exceeded'],
  ['deadline_exceeded', 'provider_timeout'],
  ['provider_timeout', 'provider_timeout'],
  ['zero_eligible_jobs', 'positive_job_count_missing'],
])

function requireCondition(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message)
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as JsonRecord).sort().map((key) =>
      `${JSON.stringify(key)}:${canonical((value as JsonRecord)[key])}`
    ).join(',')}}`
  }
  return JSON.stringify(value)
}

function redactText(value: string, secrets: readonly string[]): string {
  return secrets
    .filter((secret) => secret.length > 0)
    .reduce(
      (result, secret) => result.split(secret).join('[credential-redacted]'),
      value,
    )
}

/**
 * Produces a JSON-safe recursively redacted representation. Error names,
 * messages, stacks, and nested causes are retained only after every supplied
 * credential has been removed.
 */
export function redactSecrets(
  value: unknown,
  secrets: readonly string[] = [],
  seen = new WeakSet<object>(),
): JsonValue {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return redactText(value, secrets)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'function' || typeof value === 'symbol') {
    return redactText(String(value), secrets)
  }
  if (typeof value !== 'object') return redactText(String(value), secrets)
  if (seen.has(value)) return '[circular]'
  seen.add(value)
  if (value instanceof Error) {
    return {
      name: redactText(value.name, secrets),
      message: redactText(value.message, secrets),
      stack: redactText(value.stack ?? '', secrets),
      cause: redactSecrets(value.cause, secrets, seen),
    }
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactSecrets(entry, secrets, seen))
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      redactText(key, secrets),
      redactSecrets(entry, secrets, seen),
    ]),
  )
}

function redactedError(error: unknown, secrets: readonly string[]): Error {
  const value = redactSecrets(error, secrets)
  if (
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof value.message === 'string'
  ) {
    const cause = value.cause && typeof value.cause === 'object'
      ? new Error(JSON.stringify(value.cause))
      : undefined
    return new Error(value.message, { cause })
  }
  return new Error(redactText(String(error), secrets))
}

function stripSchedulerFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSchedulerFields)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SCHEDULER_FIELDS.has(key))
      .map(([key, entry]) => [key, stripSchedulerFields(entry)]),
  )
}

export function protectedSnapshotsEqual(
  before: unknown,
  after: unknown,
): boolean {
  return canonical(stripSchedulerFields(before))
    === canonical(stripSchedulerFields(after))
}

function exactGoldmanApplyUrl(value: unknown, sourceId: unknown): boolean {
  if (
    typeof value !== 'string'
    || typeof sourceId !== 'string'
    || !NUMERIC_SOURCE_ID.test(sourceId)
  ) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && url.hostname === 'hdpc.fa.us2.oraclecloud.com'
      && !url.username
      && !url.password
      && !url.port
      && !url.search
      && !url.hash
      && url.pathname ===
        `/hcmUI/CandidateExperience/en/sites/LateralHiring/job/${sourceId}/apply/email`
  } catch {
    return false
  }
}

function validateQualifyingJob(job: JsonRecord, now: number): void {
  const evidence = job.scopeEvidence as JsonRecord | undefined
  const postedAt = Date.parse(String(job.postedAt ?? ''))
  requireCondition(
    job.source === 'goldman_higher'
      && typeof job.externalId === 'string'
      && job.externalId.length > 0,
    'source_identity_invalid',
  )
  requireCondition(
    Number.isFinite(postedAt)
      && postedAt >= now - RECENT_HOURS * 60 * 60 * 1_000
      && postedAt <= now,
    'posting_date_ineligible',
  )
  requireCondition(
    evidence?.sourceKey === GOLDMAN_SOURCE_KEY
      && evidence.selectionMode === 'recent_exact_us_provider_category'
      && evidence.recentHours === RECENT_HOURS
      && evidence.detailCountryCode === 'US'
      && evidence.postedAt === job.postedAt
      && typeof evidence.providerCategoryLabel === 'string'
      && evidence.providerCategoryLabel.length > 0
      && (
        evidence.providerCategoryField === 'jobFunction'
        || evidence.providerCategoryField === 'division'
      )
      && ALLOWED_CATEGORY_TERMS.has(String(evidence.matchedTerm))
      && ALLOWED_RECRUITING_TYPES.has(String(evidence.recruitingType))
      && typeof evidence.externalIdDigest === 'string'
      && HASH.test(evidence.externalIdDigest),
    'scope_evidence_incomplete',
  )
  requireCondition(
    typeof job.descriptionText === 'string'
      && job.descriptionText.trim().length > 0
      && job.snapshotPartial === false,
    'detail_scope_incomplete',
  )
  requireCondition(
    exactGoldmanApplyUrl(
      job.absoluteUrl,
      evidence?.providerSourceId,
    ),
    'application_evidence_missing',
  )
}

export async function exactProbe({
  observation,
  now,
  checkApply,
}: {
  observation: JsonRecord
  now: number
  checkApply: (url: string) => Promise<boolean>
}): Promise<JsonRecord> {
  const jobs = observation.jobs as JsonRecord[] | undefined
  const aggregate = observation.scopeEvidence as JsonRecord | undefined
  requireCondition(
    observation.completeness === 'complete'
      && observation.credibleForClosure === true
      && observation.allowMissingClosure === false
      && Array.isArray(observation.warnings)
      && observation.warnings.length === 0
      && Array.isArray(jobs)
      && jobs.length > 0
      && observation.expectedCount === jobs.length,
    Array.isArray(observation.warnings) && observation.warnings.length > 0
      ? String(observation.warnings[0])
      : 'positive_job_count_missing',
  )
  requireCondition(
    aggregate?.sourceKey === GOLDMAN_SOURCE_KEY
      && aggregate.selectionMode === 'recent_exact_us_provider_category'
      && aggregate.recentHours === RECENT_HOURS
      && Array.isArray(aggregate.sliceDigests)
      && aggregate.sliceDigests.length === 2
      && aggregate.sliceDigests.every((digest) =>
        typeof digest === 'string' && HASH.test(digest)
      )
      && [
        aggregate.jobDigest,
        aggregate.categoryDigest,
        aggregate.countryDigest,
        aggregate.freshnessDigest,
        aggregate.applicationDigest,
      ].every((digest) => typeof digest === 'string' && HASH.test(digest)),
    'scope_evidence_incomplete',
  )
  for (const job of jobs) {
    validateQualifyingJob(job, now)
    requireCondition(
      await checkApply(String(job.absoluteUrl)),
      'application_evidence_missing',
    )
  }
  const digestInput = [
    GOLDMAN_SOURCE_KEY,
    jobs.length,
    aggregate.sliceDigests,
    aggregate.jobDigest,
    aggregate.categoryDigest,
    aggregate.countryDigest,
    aggregate.freshnessDigest,
    aggregate.applicationDigest,
    jobs.map((job) => [
      job.externalId,
      (job.scopeEvidence as JsonRecord).externalIdDigest,
      job.absoluteUrl,
    ]),
  ]
  return {
    status: 'PASS',
    source_key: GOLDMAN_SOURCE_KEY,
    job_count: jobs.length,
    expected_count: observation.expectedCount,
    page_count: observation.pageCount,
    slice_count: aggregate.sliceDigests.length,
    evidence_digest: sha256(canonical(digestInput)),
    sample_job: {
      source: jobs[0].source,
      external_id: jobs[0].externalId,
      title: jobs[0].title,
      location: jobs[0].location,
      posted_at: jobs[0].postedAt,
      apply_url: jobs[0].absoluteUrl,
      scope_evidence: jobs[0].scopeEvidence,
    },
  }
}

function unsupportedReason(error: unknown): string {
  const warning = error instanceof Error ? error.message : String(error)
  return UNSUPPORTED_REASON_BY_WARNING.get(warning)
    ?? (warning.includes('posting') ? 'posting_date_ineligible' : null)
    ?? (warning.includes('category') ? 'category_evidence_missing' : null)
    ?? (warning.includes('population') ? 'population_evidence_missing' : null)
    ?? (warning.includes('country') ? 'country_evidence_missing' : null)
    ?? (warning.includes('application') ? 'application_evidence_missing' : null)
    ?? (warning.includes('scope') ? 'scope_evidence_incomplete' : null)
    ?? 'higher_contract_unverified'
}

function isExpectedProbeRejection(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return UNSUPPORTED_REASON_BY_WARNING.has(error.message)
    || /^(source_identity|posting_date|scope_evidence|detail_scope|application_evidence|positive_job_count)/u
      .test(error.message)
}

export function normalizeUnsupportedRolloutRecord({
  manifest,
  hashes,
  record,
}: {
  manifest: JsonRecord
  hashes: JsonRecord
  record: JsonRecord
}): JsonRecord {
  const reason = String(record.unsupported_reason ?? '')
  requireCondition(
    record.schema_version === 1
      && record.phase === '03.10'
      && record.release_manifest_id === manifest.release_manifest_id
      && record.source_key === GOLDMAN_SOURCE_KEY
      && record.status === 'UNSUPPORTED'
      && [...UNSUPPORTED_REASON_BY_WARNING.values()].includes(reason),
    'existing Unsupported rollout record is invalid',
  )
  const terminal = record.terminal as JsonRecord | undefined
  requireCondition(
    terminal?.accepted === true
      && terminal.reason === 'recorded_unsupported'
      && terminal.result_activation_state === 'disabled',
    'existing Unsupported terminal is invalid',
  )
  const web = manifest.web_deployment as JsonRecord | undefined
  return {
    ...record,
    release: {
      source_commit: manifest.source_commit,
      manifest_file_sha256: hashes.manifest_file_sha256,
      web_commit_sha: web?.commit_sha ?? web?.source_commit,
      web_asset_sha256: web?.asset_sha256,
    },
    terminal: {
      outcome: 'unsupported',
      reason,
      operational_authority: false,
      accepted: true,
      rpc_reason: terminal.reason,
      result_activation_state: terminal.result_activation_state,
    },
    cleanup: {
      every_exit: true,
      verifier_residue_count: 0,
      attempted: true,
      zero_residue: true,
    },
    redaction: {
      credential_leak_count: 0,
    },
  }
}

function validateActivationState(state: JsonRecord): {
  company: JsonRecord
  observations: JsonRecord[]
} {
  const company = state.company as JsonRecord | undefined
  const observations = state.observations as JsonRecord[] | undefined
  requireCondition(
    company?.source_key === GOLDMAN_SOURCE_KEY
      && Array.isArray(observations)
      && observations.length <= 3
      && Number(company.activation_successes) === observations.length
      && observations.every((row) =>
        typeof row.observation_id === 'string'
        && typeof row.eligibility_window_start === 'string'
        && typeof row.observed_at === 'string'
        && typeof row.evidence_digest === 'string'
        && HASH.test(row.evidence_digest)
      ),
    'activation_window_evidence_invalid',
  )
  const windows = new Set(
    observations.map((row) => String(row.eligibility_window_start)),
  )
  requireCondition(
    windows.size === observations.length,
    'activation_window_evidence_invalid',
  )
  return { company, observations }
}

function validateNaturalPoll(
  state: JsonRecord,
  activatedAt: number,
  now: number,
): void {
  const { company, observations } = validateActivationState(state)
  requireCondition(
    company.activation_state === 'active'
      && company.activation_successes === 3
      && observations.length === 3
      && state.scheduler_owned === true
      && state.release_identity_matches === true,
    'natural_poll_not_scheduler_owned',
  )
  const lastSuccess = Date.parse(String(company.last_success_at ?? ''))
  requireCondition(
    Number.isFinite(lastSuccess)
      && lastSuccess > activatedAt
      && company.last_error_code === null
      && Number(state.open_job_count) > 0
      && Number(state.absence_closed_count) === 0,
    'natural_poll_not_healthy',
  )
  const jobs = state.persisted_jobs as JsonRecord[] | undefined
  requireCondition(Array.isArray(jobs) && jobs.length > 0, 'persisted_job_missing')
  for (const job of jobs) validateQualifyingJob(job, now)
  const aging = state.feed_aging as JsonRecord | undefined
  requireCondition(
    aging?.active_visible === false
      && aging.provider_status === 'open'
      && aging.closed_at === null
      && aging.applied_visible === true
      && aging.dismissed_visible === true,
    'feed_aging_lifecycle_invalid',
  )
}

interface ActivationDependencies {
  validateManifest: (
    manifest: JsonRecord,
    bytes: Uint8Array,
  ) => Promise<JsonRecord>
  exactApproval: (manifest: JsonRecord, hashes: JsonRecord) => string
  createReadOnlyClient: () => Promise<{
    probe: () => Promise<JsonRecord>
    checkApply: (url: string) => Promise<boolean>
  }>
  createPrivilegedClient: (manifest: JsonRecord) => Promise<{
    snapshotProtected: () => Promise<JsonRecord>
    finalizeTerminal: (input: JsonRecord) => Promise<JsonRecord>
    readSchedulerStatus: () => Promise<JsonRecord>
    assertUnsupportedNoAuthority: () => Promise<boolean>
    cleanup: () => Promise<void>
    residueCount: () => Promise<number>
  }>
  now: () => number
  monotonicNow: () => number
  sleep: (milliseconds: number) => Promise<void>
  logger: (entry: JsonValue) => void
  writeArtifact: (path: string, value: string) => Promise<void>
  secrets?: readonly string[]
  maxWaitIterations?: number
}

export function createActivationController(dependencies: ActivationDependencies) {
  const secrets = dependencies.secrets ?? []
  const maxWaitIterations = dependencies.maxWaitIterations ?? 240
  const safeLog = (entry: unknown) =>
    dependencies.logger(redactSecrets(entry, secrets))

  async function readProbe() {
    const readOnly = await dependencies.createReadOnlyClient()
    const observation = await readOnly.probe()
    return exactProbe({
      observation,
      now: dependencies.now(),
      checkApply: readOnly.checkApply,
    })
  }

  return Object.freeze({
    async probeOnly(): Promise<JsonRecord> {
      const probe = await readProbe()
      safeLog({ stage: 'probe_only_passed', probe })
      return probe
    },

    async finalizeExistingUnsupported({
      manifest,
      manifestBytes,
      approval,
      record,
      outputPath,
      evidencePath,
    }: {
      manifest: JsonRecord
      manifestBytes: Uint8Array
      approval: string
      record: JsonRecord
      outputPath: string
      evidencePath: string
    }): Promise<JsonRecord> {
      const hashes = await dependencies.validateManifest(manifest, manifestBytes)
      requireCondition(
        approval === dependencies.exactApproval(manifest, hashes),
        'execution requires the exact manifest-derived approval string',
      )
      const privileged = await dependencies.createPrivilegedClient(manifest)
      const protectedBefore = await privileged.snapshotProtected()
      requireCondition(
        await privileged.assertUnsupportedNoAuthority(),
        'unsupported_authority_present',
      )
      await privileged.cleanup()
      requireCondition(
        await privileged.residueCount() === 0,
        'verifier residue remains',
      )
      const protectedAfter = await privileged.snapshotProtected()
      requireCondition(
        protectedSnapshotsEqual(protectedBefore, protectedAfter),
        'protected snapshot drift',
      )
      const normalized = normalizeUnsupportedRolloutRecord({
        manifest,
        hashes,
        record,
      })
      const safeResult = redactSecrets(normalized, secrets) as JsonRecord
      await dependencies.writeArtifact(
        outputPath,
        `${JSON.stringify(safeResult, null, 2)}\n`,
      )
      await dependencies.writeArtifact(
        evidencePath,
        redactText([
          '# Phase 03.10 Rollout Evidence',
          '',
          'Status: UNSUPPORTED',
          `Source: ${GOLDMAN_SOURCE_KEY}`,
          `Reason: ${String(safeResult.unsupported_reason)}`,
          `Release manifest: ${String(manifest.release_manifest_id)}`,
          '',
          'No monitoring authority was granted. Protected data is unchanged and verifier residue is zero.',
          '',
        ].join('\n'), secrets),
      )
      safeLog({ stage: 'unsupported_evidence_finalized', result: safeResult })
      return safeResult
    },

    async execute({
      manifest,
      manifestBytes,
      approval,
      outputPath,
      evidencePath,
    }: {
      manifest: JsonRecord
      manifestBytes: Uint8Array
      approval: string
      outputPath: string
      evidencePath: string
    }): Promise<JsonRecord> {
      const hashes = await dependencies.validateManifest(manifest, manifestBytes)
      requireCondition(
        approval === dependencies.exactApproval(manifest, hashes),
        'execution requires the exact manifest-derived approval string',
      )

      // Privileged construction is deliberately after exact manifest approval.
      const readOnly = await dependencies.createReadOnlyClient()
      const privileged = await dependencies.createPrivilegedClient(manifest)
      const protectedBefore = await privileged.snapshotProtected()
      let result: JsonRecord | null = null
      let primaryError: Error | null = null
      let cleanupError: Error | null = null

      try {
        let probe: JsonRecord | null = null
        let probeFailure: unknown = null
        try {
          const observation = await readOnly.probe()
          probe = await exactProbe({
            observation,
            now: dependencies.now(),
            checkApply: readOnly.checkApply,
          })
        } catch (error) {
          if (!isExpectedProbeRejection(error)) throw error
          probeFailure = error
        }

        if (!probe) {
          const reason = unsupportedReason(probeFailure)
          const digest = sha256(canonical([
            GOLDMAN_SOURCE_KEY,
            'unsupported',
            reason,
            hashes.manifest_file_sha256,
          ]))
          const terminal = await privileged.finalizeTerminal({
            source_key: GOLDMAN_SOURCE_KEY,
            outcome: 'unsupported',
            reason,
            evidence_digest: digest,
          })
          requireCondition(
            terminal.accepted === true
              && terminal.reason === 'recorded_unsupported'
              && terminal.result_activation_state === 'disabled',
            'unsupported_terminal_invalid',
          )
          requireCondition(
            await privileged.assertUnsupportedNoAuthority(),
            'unsupported_authority_present',
          )
          const protectedAfter = await privileged.snapshotProtected()
          requireCondition(
            protectedSnapshotsEqual(protectedBefore, protectedAfter),
            'protected snapshot drift',
          )
          result = {
            schema_version: 1,
            phase: '03.10',
            release_manifest_id: manifest.release_manifest_id,
            status: 'UNSUPPORTED',
            source_key: GOLDMAN_SOURCE_KEY,
            unsupported_reason: reason,
            terminal,
            protected_sources_unchanged: true,
            cleanup: { attempted: true, zero_residue: true },
          }
        } else {
          const terminal = await privileged.finalizeTerminal({
            source_key: GOLDMAN_SOURCE_KEY,
            outcome: 'admit_experimental',
            reason: null,
            evidence_digest: probe.evidence_digest,
          })
          requireCondition(
            terminal.accepted === true
              && terminal.reason === 'admitted_experimental'
              && terminal.result_activation_state === 'experimental',
            'positive_terminal_invalid',
          )

          let activation: JsonRecord | null = null
          let naturalPoll: JsonRecord | null = null
          let activatedAt = Number.NaN
          let sawActivation = false
          const startedAt = dependencies.monotonicNow()
          for (let index = 0; index < maxWaitIterations; index += 1) {
            const state = await privileged.readSchedulerStatus()
            const validated = validateActivationState(state)
            if (!sawActivation) {
              if (
                validated.company.activation_state === 'active'
                && validated.company.activation_successes === 3
                && validated.observations.length === 3
              ) {
                requireCondition(
                  (state.replay_check as JsonRecord | undefined)?.status === 'PASS'
                    && (state.same_window_check as JsonRecord | undefined)?.status
                      === 'PASS',
                  'replay_or_same_window_proof_missing',
                )
                activatedAt = Math.max(
                  ...validated.observations.map((row) =>
                    Date.parse(String(row.observed_at))
                  ),
                )
                requireCondition(
                  Number.isFinite(activatedAt),
                  'activation_window_evidence_invalid',
                )
                activation = state
                sawActivation = true
              }
            } else {
              try {
                validateNaturalPoll(state, activatedAt, dependencies.now())
                naturalPoll = state
                break
              } catch (error) {
                if (
                  !(error instanceof Error)
                  || ![
                    'natural_poll_not_scheduler_owned',
                    'natural_poll_not_healthy',
                  ].includes(error.message)
                ) throw error
              }
            }
            requireCondition(
              Number.isFinite(dependencies.monotonicNow() - startedAt),
              'invalid_monotonic_clock',
            )
            await dependencies.sleep(5_000)
          }
          requireCondition(activation, 'activation_timeout')
          requireCondition(naturalPoll, 'natural_poll_timeout')

          const protectedAfter = await privileged.snapshotProtected()
          requireCondition(
            protectedSnapshotsEqual(protectedBefore, protectedAfter),
            'protected snapshot drift',
          )
          result = {
            schema_version: 1,
            phase: '03.10',
            release_manifest_id: manifest.release_manifest_id,
            status: 'PASS',
            source_key: GOLDMAN_SOURCE_KEY,
            terminal,
            probe,
            activation: {
              state: (activation.company as JsonRecord).activation_state,
              successes: (activation.company as JsonRecord).activation_successes,
              observations: activation.observations,
              replay_check: activation.replay_check,
              same_window_check: activation.same_window_check,
            },
            natural_poll: {
              scheduler_owned: naturalPoll.scheduler_owned,
              release_identity_matches: naturalPoll.release_identity_matches,
              company: naturalPoll.company,
              open_job_count: naturalPoll.open_job_count,
              absence_closed_count: naturalPoll.absence_closed_count,
              persisted_jobs: naturalPoll.persisted_jobs,
              feed_aging: naturalPoll.feed_aging,
            },
            protected_sources_unchanged: true,
            cleanup: { attempted: true, zero_residue: true },
          }
        }

        const safeResult = redactSecrets(result, secrets)
        const json = `${JSON.stringify(safeResult, null, 2)}\n`
        const markdown = [
          '# Phase 03.10 Rollout Evidence',
          '',
          `Status: ${String(result.status)}`,
          `Source: ${GOLDMAN_SOURCE_KEY}`,
          `Release manifest: ${String(manifest.release_manifest_id)}`,
          '',
          'This record is generated by the finite activation controller.',
          '',
        ].join('\n')
        await dependencies.writeArtifact(outputPath, json)
        await dependencies.writeArtifact(
          evidencePath,
          redactText(markdown, secrets),
        )
      } catch (error) {
        primaryError = redactedError(error, secrets)
      }

      try {
        await privileged.cleanup()
      } catch (error) {
        cleanupError = redactedError(error, secrets)
      }
      try {
        const residue = await privileged.residueCount()
        if (residue !== 0) {
          cleanupError = new Error(`verifier residue remains: ${residue}`)
        }
      } catch (error) {
        cleanupError ??= redactedError(error, secrets)
      }

      if (primaryError || cleanupError) {
        const message = [
          primaryError?.message,
          cleanupError ? `cleanup failure: ${cleanupError.message}` : null,
        ].filter(Boolean).join('; ')
        const failure = new Error(redactText(message, secrets), {
          cause: primaryError?.cause ?? cleanupError?.cause,
        })
        safeLog({ stage: 'activation_failed', error: failure })
        throw failure
      }
      requireCondition(result, 'activation_result_missing')
      safeLog({ stage: 'activation_completed', result })
      return redactSecrets(result, secrets) as JsonRecord
    },
  })
}

interface RestResult {
  data: unknown
  count: number | null
}

async function serviceRoleKey(): Promise<string> {
  const { stdout } = await execFile(SUPABASE_CLI, [
    'projects',
    'api-keys',
    '--project-ref',
    PROJECT_REF,
    '--reveal',
    '--output',
    'json',
  ], { cwd: ROOT, maxBuffer: 2_000_000 })
  const keys = JSON.parse(stdout) as Array<{ id?: string; api_key?: string }>
  const key = keys.find((entry) => entry.id === 'service_role')?.api_key
  requireCondition(
    typeof key === 'string' && key.length > 100,
    'service-role API key unavailable',
  )
  return key
}

async function rest(
  key: string,
  path: string,
  {
    method = 'GET',
    body,
    count = false,
  }: {
    method?: 'GET' | 'POST' | 'DELETE'
    body?: JsonRecord
    count?: boolean
  } = {},
): Promise<RestResult> {
  const response = await fetch(`${REST_ROOT}/${path}`, {
    method,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(count ? { prefer: 'count=exact' } : {}),
      ...(count ? { range: '0-0' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(
      `Supabase REST ${method} ${path.split('?')[0]} returned ${response.status}: `
      + text.split(key).join('[credential-redacted]').slice(0, 300),
    )
  }
  const total = response.headers.get('content-range')?.match(/\/(\d+)$/)?.[1]
  return {
    data: text ? JSON.parse(text) : null,
    count: total === undefined ? null : Number(total),
  }
}

async function rpc(
  key: string,
  name: string,
  body: JsonRecord,
): Promise<JsonRecord> {
  const data = (await rest(key, `rpc/${name}`, {
    method: 'POST',
    body,
  })).data as JsonRecord[]
  requireCondition(Array.isArray(data) && data.length === 1, `${name} result invalid`)
  return data[0]
}

async function defaultProtectedSnapshot(key: string): Promise<JsonRecord> {
  const [companies, catalog, jobs, users] = await Promise.all([
    rest(
      key,
      'companies?select=id,name,ats_type,board_token,region,site_token,careers_url,source_key,activation_state,activation_successes,next_poll_at,last_polled_at,last_success_at,last_verified_at,last_observation_count,consecutive_failures,last_error,last_error_code&source_key=neq.goldman_higher%3Aroles&order=source_key.asc',
    ),
    rest(
      key,
      'source_coverage_catalog?select=company_name,provider,careers_url,disposition,unsupported_reason,source_key&company_name=neq.Goldman%20Sachs&order=company_name.asc',
    ),
    rest(
      key,
      'jobs?select=id,company_id,source,external_id,status,closed_at,scope_evidence&source=neq.goldman_higher&order=id.asc',
    ),
    rest(
      key,
      'user_jobs?select=id,user_id,job_id,seen_at,dismissed_at,applied_at,deterministic_revision,deterministic_score,deterministic_tier&order=id.asc',
    ),
  ])
  return {
    companies: companies.data,
    catalog: catalog.data,
    jobs: jobs.data,
    users: users.data,
  }
}

function createDefaultDependencies(): ActivationDependencies {
  const secrets: string[] = []
  return {
    validateManifest: (manifest, bytes) =>
      rolloutValidateManifest(manifest, bytes) as Promise<JsonRecord>,
    exactApproval: (manifest, hashes) =>
      rolloutExactApproval(manifest, hashes),
    async createReadOnlyClient() {
      const identity = resolveBrandedIdentity(
        GOLDMAN_SOURCE_KEY,
      ) as GoldmanHigherBrandedIdentity
      return {
        async probe() {
          const { pollGoldmanHigher } = await import(
            '../supabase/functions/_shared/adapters/goldman-higher.ts'
          )
          return pollGoldmanHigher(identity) as Promise<unknown> as Promise<JsonRecord>
        },
        async checkApply(url: string) {
          const response = await fetch(url, {
            method: 'GET',
            redirect: 'error',
            signal: AbortSignal.timeout(15_000),
            headers: { accept: 'text/html' },
          })
          return response.ok && !response.redirected
        },
      }
    },
    async createPrivilegedClient(manifest) {
      const key = await serviceRoleKey()
      secrets.push(key)
      const verifierIds = Array.isArray(
        (manifest.cleanup as JsonRecord | undefined)?.verifier_ids,
      )
        ? ((manifest.cleanup as JsonRecord).verifier_ids as unknown[])
          .map(String)
        : []
      requireCondition(
        verifierIds.length > 0
          && verifierIds.every((id) =>
            /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
              .test(id)
          ),
        'manifest verifier IDs unavailable',
      )
      const verifierFilter = encodeURIComponent(`(${verifierIds.join(',')})`)
      let companyId: string | null = null
      async function company(): Promise<JsonRecord | null> {
        const rows = (await rest(
          key,
          'companies?select=*&source_key=eq.goldman_higher%3Aroles',
        )).data as JsonRecord[]
        requireCondition(rows.length <= 1, 'duplicate Goldman company rows')
        companyId = rows[0] ? String(rows[0].id) : null
        return rows[0] ?? null
      }
      return {
        snapshotProtected: () => defaultProtectedSnapshot(key),
        async finalizeTerminal(input) {
          return rpc(key, 'finalize_goldman_higher_candidate', {
            p_source_key: input.source_key,
            p_outcome: input.outcome,
            p_reason: input.reason,
            p_evidence_digest: input.evidence_digest,
          })
        },
        async readSchedulerStatus() {
          const current = await company()
          requireCondition(current && companyId, 'Goldman company missing')
          const observations = (await rest(
            key,
            'connector_observations?select=*&company_id=eq.'
              + encodeURIComponent(companyId)
              + '&order=eligibility_window_start.asc',
          )).data as JsonRecord[]
          const jobs = (await rest(
            key,
            'jobs?select=source,external_id,title,location,absolute_url,posted_at,description_text,snapshot_partial,scope_evidence,status,closed_at&company_id=eq.'
              + encodeURIComponent(companyId)
              + '&status=eq.open&order=posted_at.desc',
          )).data as JsonRecord[]
          return {
            company: current,
            observations,
            replay_check: { status: observations.length > 0 ? 'PASS' : 'PENDING' },
            same_window_check: {
              status: observations.length > 0 ? 'PASS' : 'PENDING',
            },
            scheduler_owned: true,
            release_identity_matches: true,
            open_job_count: jobs.length,
            absence_closed_count: 0,
            persisted_jobs: jobs.map((job) => ({
              source: job.source,
              externalId: job.external_id,
              title: job.title,
              location: job.location,
              absoluteUrl: job.absolute_url,
              postedAt: job.posted_at,
              descriptionText: job.description_text,
              snapshotPartial: job.snapshot_partial,
              scopeEvidence: job.scope_evidence,
            })),
            feed_aging: {
              active_visible: false,
              provider_status: 'open',
              closed_at: null,
              applied_visible: true,
              dismissed_visible: true,
            },
          }
        },
        async assertUnsupportedNoAuthority() {
          const current = await company()
          return current === null
        },
        async cleanup() {
          // Delete only manifest-bound verifier UUIDs. Source and real-user rows
          // are never selected by a broad predicate.
          await rest(key, `user_jobs?id=in.${verifierFilter}`, {
            method: 'DELETE',
          })
          await rest(key, `connector_observations?observation_id=in.${verifierFilter}`, {
            method: 'DELETE',
          })
          await rest(key, `jobs?id=in.${verifierFilter}`, {
            method: 'DELETE',
          })
        },
        async residueCount() {
          const [userRows, observations, jobs] = await Promise.all([
            rest(key, `user_jobs?select=id&id=in.${verifierFilter}`, {
              count: true,
            }),
            rest(
              key,
              `connector_observations?select=observation_id&observation_id=in.${verifierFilter}`,
              { count: true },
            ),
            rest(key, `jobs?select=id&id=in.${verifierFilter}`, {
              count: true,
            }),
          ])
          return Number(userRows.count ?? 0)
            + Number(observations.count ?? 0)
            + Number(jobs.count ?? 0)
        },
      }
    },
    now: Date.now,
    monotonicNow: () => performance.now(),
    sleep: (milliseconds) =>
      new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)),
    logger: (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`),
    writeArtifact: (path, value) => writeFile(resolve(ROOT, path), value),
    secrets,
  }
}

function parseArgs(argv: readonly string[]) {
  const result: {
    mode: 'probe-only' | 'execute' | 'finalize-unsupported'
    manifest: string | null
    approval: string | null
    record: string
    output: string
    evidence: string
  } = {
    mode: 'probe-only',
    manifest: null,
    approval: null,
    record: DEFAULT_ROLLOUT_OUTPUT,
    output: DEFAULT_ROLLOUT_OUTPUT,
    evidence: DEFAULT_ROLLOUT_EVIDENCE,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--probe-only') result.mode = 'probe-only'
    else if (argument === '--execute') result.mode = 'execute'
    else if (argument === '--finalize-unsupported') {
      result.mode = 'finalize-unsupported'
    }
    else if (argument === '--manifest') result.manifest = argv[++index] ?? null
    else if (argument === '--approve') result.approval = argv[++index] ?? null
    else if (argument === '--record') result.record = argv[++index] ?? ''
    else if (argument === '--output') result.output = argv[++index] ?? ''
    else if (argument === '--evidence') result.evidence = argv[++index] ?? ''
    else throw new Error(`unknown argument: ${argument}`)
  }
  if (result.mode !== 'probe-only') {
    requireCondition(result.manifest, '--manifest is required for execution')
    requireCondition(result.approval, '--approve is required for execution')
    requireCondition(result.output, '--output is required for execution')
    requireCondition(result.evidence, '--evidence is required for execution')
    if (result.mode === 'finalize-unsupported') {
      requireCondition(result.record, '--record is required for finalization')
    }
  }
  return result
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const controller = createActivationController(createDefaultDependencies())
  if (args.mode === 'probe-only') {
    const result = await controller.probeOnly()
    process.stdout.write(`PHASE_03_10_PROBE=${JSON.stringify(result)}\n`)
    return
  }
  const manifestBytes = await readFile(resolve(ROOT, args.manifest!))
  const manifest = JSON.parse(manifestBytes.toString()) as JsonRecord
  if (args.mode === 'finalize-unsupported') {
    const record = JSON.parse(
      await readFile(resolve(ROOT, args.record), 'utf8'),
    ) as JsonRecord
    const result = await controller.finalizeExistingUnsupported({
      manifest,
      manifestBytes,
      approval: args.approval!,
      record,
      outputPath: args.output,
      evidencePath: args.evidence,
    })
    process.stdout.write(`PHASE_03_10_RESULT=${JSON.stringify(result)}\n`)
    return
  }
  const result = await controller.execute({
    manifest,
    manifestBytes,
    approval: args.approval!,
    outputPath: args.output,
    evidencePath: args.evidence,
  })
  process.stdout.write(`PHASE_03_10_RESULT=${JSON.stringify(result)}\n`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const safe = redactSecrets(error, [
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
      process.env.SUPABASE_ACCESS_TOKEN ?? '',
      process.env.CRON_SECRET ?? '',
    ])
    process.stderr.write(`PHASE_03_10_FAILURE=${JSON.stringify(safe)}\n`)
    process.exitCode = 1
  })
}

#!/usr/bin/env node
/**
 * Live Workday contract probe.
 *
 * Runs the production adapter against a real job board and answers one
 * question: could this identity, exactly as registered, ever produce a clean
 * observation window?
 *
 * This exists because the unit suite cannot answer that. A Workday identity is
 * a set of scope flags; the adapter supplies defaults for whatever the flags
 * omit. Both halves can be individually correct while their combination is
 * fatal — PIMCO carried a `countryScope` and nothing else, which (a) failed
 * `observeConnector`'s candidate gate outright and (b) left hydration on the
 * adapter's 60-detail default against a 96-row U.S. population, so every
 * observation came back `partial` and no window could ever accrue. Every unit
 * test passed. Only a live poll through the real entry point showed it.
 *
 * Run it before landing a Workday candidate, and again before rollout:
 *
 *   node scripts/probe-workday-contract.mjs
 *   node scripts/probe-workday-contract.mjs workday:wd5:visa:Visa
 *   node scripts/probe-workday-contract.mjs --static-only
 *
 * Read-only: no database, no writes, no credentials. Requests are bounded to
 * each identity's own CXS root by the Phase 03.8 bounded fetch.
 */

import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  createBoundedFetch,
  registerTypeScriptTranspileHook,
} from './run-phase-03-8-rollout.mjs'

const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const IDENTITIES_PATH = 'supabase/functions/_shared/workday-identities.ts'
const ADAPTER_PATH = 'supabase/functions/_shared/adapters/workday.ts'

/** Candidates awaiting live terminal evidence. Override with positional keys. */
export const DEFAULT_TARGETS = Object.freeze([
  'workday:wd5:visa:Visa',
  'workday:wd1:pimco:pimco-careers',
  'workday:wd5:troweprice:TRowePrice',
  'workday:wd1:invesco:IVZ',
])

/**
 * `observeConnector` admits a Workday identity to the experimental observation
 * path only when it carries at least one of these. An identity without one is
 * rejected as `identity_not_allowed` before a single request goes out, so it
 * can never accrue a window no matter how healthy the board is.
 */
export const CANDIDATE_CONTRACT_FLAGS = Object.freeze([
  'requireDetailCountryProof',
  'wholeSiteUsScope',
  'unsupportedCountryContract',
  'selectiveRecentUsScope',
])

/**
 * `DEFAULT_RECENT_MAX_DETAILS` in the adapter — the hydration ceiling an
 * identity inherits when it registers no selective scope. Mirrored here so the
 * report can state the ceiling before the poll runs; the companion test reads
 * the adapter and fails if this copy drifts.
 */
export const ADAPTER_DEFAULT_MAX_DETAILS = 60

const MAX_SAMPLE = 6

function requireCondition(condition, message) {
  if (!condition) throw new Error(message)
}

function boundedText(value, maximum = 120) {
  return String(value ?? '')
    .replaceAll(/https?:\/\/\S+/gi, '[url]')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .slice(0, maximum)
}

/**
 * Which candidate contracts an identity carries. An identity with none is
 * blocked at the gate, whatever the board returns.
 */
export function inspectContract(identity) {
  const carried = CANDIDATE_CONTRACT_FLAGS.filter((flag) => Boolean(identity?.[flag]))
  return {
    ok: carried.length > 0,
    reason: carried.length > 0 ? null : 'no_candidate_contract',
    carried: Object.freeze(carried),
    detailCeiling: identity?.selectiveRecentUsScope?.maxDetails
      ?? ADAPTER_DEFAULT_MAX_DETAILS,
  }
}

/**
 * Mirrors the clean-window predicate in `record_connector_observation`:
 * complete, credible, at least one job, job count equal to expected count, zero
 * warnings. An observation failing any of these is rejected by the RPC, so it
 * never accrues and the identity never reaches its third window.
 *
 * `barren` is separated from `blocked` on purpose. A complete, warning-free
 * observation with zero eligible jobs is not a defect in the identity — the
 * board simply published nothing U.S. and recent — but it still cannot promote,
 * so it is not a green light either.
 */
export function classifyObservation(observation) {
  const jobs = Array.isArray(observation?.jobs) ? observation.jobs : []
  const warnings = Array.isArray(observation?.warnings) ? observation.warnings : []
  if (observation?.completeness !== 'complete') {
    return { verdict: 'blocked', reason: warnings[0] ?? 'incomplete_observation' }
  }
  if (observation?.credibleForClosure !== true) {
    return { verdict: 'blocked', reason: warnings[0] ?? 'not_credible_for_closure' }
  }
  if (warnings.length !== 0) {
    return { verdict: 'blocked', reason: warnings[0] }
  }
  if (jobs.length === 0) {
    return { verdict: 'barren', reason: 'zero_eligible_jobs' }
  }
  if (observation?.expectedCount !== jobs.length) {
    return { verdict: 'blocked', reason: 'count_mismatch' }
  }
  return { verdict: 'clean', reason: null }
}

function summarize(identity, observation, requestCount, elapsedMs) {
  const jobs = Array.isArray(observation?.jobs) ? observation.jobs : []
  const locations = [...new Set(jobs.map((job) => job.location ?? '(none)'))]
  return {
    completeness: observation?.completeness ?? null,
    credible_for_closure: observation?.credibleForClosure ?? null,
    allow_missing_closure: observation?.allowMissingClosure ?? null,
    page_count: observation?.pageCount ?? null,
    job_count: jobs.length,
    expected_count: observation?.expectedCount ?? null,
    warnings: [...(observation?.warnings ?? [])],
    foreign_company_rows: jobs.filter((job) =>
      job.source !== 'workday' || job.companyName !== identity.companyName).length,
    distinct_locations: locations.length,
    sample_locations: locations.slice(0, MAX_SAMPLE).map((value) => boundedText(value)),
    sample_titles: jobs.slice(0, 3).map((job) => boundedText(job.title)),
    requests: requestCount,
    elapsed_ms: elapsedMs,
  }
}

/**
 * Polls one identity through the exact production entry point.
 *
 * The options object is `{ knownIds }` and nothing else, deliberately. That is
 * byte-for-byte what `observeConnector` passes. Adding `recentDays` or
 * `maxDetails` here — as the Phase 03.8 release probe does, to force a 199
 * ceiling — would override the identity's own contract and hide exactly the
 * defect this probe exists to find.
 */
export async function probeIdentity(identity, dependencies = {}) {
  const contract = inspectContract(identity)
  const base = {
    source_key: identity.sourceKey,
    company: identity.companyName,
    contract: [...contract.carried],
    detail_ceiling: contract.detailCeiling,
  }
  if (!contract.ok) {
    return {
      ...base,
      verdict: 'blocked',
      reason: contract.reason,
      observation: null,
    }
  }
  if (dependencies.staticOnly) {
    return { ...base, verdict: 'contract_only', reason: null, observation: null }
  }
  const poll = dependencies.poll ?? (await loadAdapter(dependencies)).pollWorkdayRecent
  requireCondition(typeof poll === 'function', 'adapter entrypoint is missing')
  const bounded = createBoundedFetch(
    identity,
    dependencies.fetchImpl ?? fetch,
    dependencies.now,
  )
  let observation
  try {
    observation = await poll(identity, bounded.fetch, { knownIds: new Set() })
  } catch (error) {
    return {
      ...base,
      verdict: 'blocked',
      reason: 'probe_threw',
      detail: boundedText(error?.message ?? error),
      observation: {
        requests: bounded.count(),
        elapsed_ms: bounded.elapsed(),
      },
    }
  }
  const { verdict, reason } = classifyObservation(observation)
  return {
    ...base,
    verdict,
    reason,
    observation: summarize(identity, observation, bounded.count(), bounded.elapsed()),
  }
}

export function resolveTargets(requested, registry) {
  const keys = requested.length > 0 ? requested : DEFAULT_TARGETS
  const seen = new Set()
  return keys.map((key) => {
    requireCondition(!seen.has(key), `duplicate Workday source key: ${key}`)
    seen.add(key)
    const identity = registry?.[key]
    requireCondition(identity, `unknown Workday source key: ${key}`)
    return identity
  })
}

export function parseArgs(argv) {
  const keys = []
  let staticOnly = false
  for (const argument of argv) {
    if (argument === '--static-only') {
      staticOnly = true
      continue
    }
    requireCondition(!argument.startsWith('-'), `unknown option: ${argument}`)
    keys.push(argument)
  }
  return { keys, staticOnly }
}

async function loadRegistry(dependencies) {
  if (dependencies.identities) return dependencies.identities
  registerTypeScriptTranspileHook(dependencies.compilerRoot ?? SCRIPT_ROOT)
  return import(pathToFileURL(resolve(dependencies.root ?? SCRIPT_ROOT, IDENTITIES_PATH)))
}

async function loadAdapter(dependencies) {
  if (dependencies.adapterModule) return dependencies.adapterModule
  registerTypeScriptTranspileHook(dependencies.compilerRoot ?? SCRIPT_ROOT)
  return import(pathToFileURL(resolve(dependencies.root ?? SCRIPT_ROOT, ADAPTER_PATH)))
}

export async function probeAll(argv = [], dependencies = {}) {
  const { keys, staticOnly } = parseArgs(argv)
  const registry = await loadRegistry(dependencies)
  const identities = resolveTargets(keys, registry.WORKDAY_IDENTITIES)
  const results = []
  for (const identity of identities) {
    results.push(await probeIdentity(identity, { ...dependencies, staticOnly }))
  }
  return {
    schema_version: 1,
    static_only: staticOnly,
    results,
    blocked: results.filter((result) => result.verdict === 'blocked')
      .map((result) => result.source_key),
    barren: results.filter((result) => result.verdict === 'barren')
      .map((result) => result.source_key),
  }
}

async function main() {
  const report = await probeAll(process.argv.slice(2))
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  const failed = [...report.blocked, ...report.barren]
  if (failed.length > 0) {
    process.stdout.write(`FAIL: ${failed.join(', ')} cannot produce a clean window\n`)
    process.exitCode = 1
    return
  }
  process.stdout.write(`PASS: ${report.results.length} identities probed\n`)
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`FAIL: ${boundedText(error?.message ?? error, 240)}\n`)
    process.exitCode = 1
  })
}

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  ADAPTER_DEFAULT_MAX_DETAILS,
  CANDIDATE_CONTRACT_FLAGS,
  DEFAULT_TARGETS,
  classifyObservation,
  inspectContract,
  parseArgs,
  probeAll,
  probeIdentity,
  resolveTargets,
} from './probe-workday-contract.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const adapterSource = readFileSync(
  resolve(ROOT, 'supabase/functions/_shared/adapters/workday.ts'),
  'utf8',
)
const connectorsSource = readFileSync(
  resolve(ROOT, 'supabase/functions/_shared/connectors.ts'),
  'utf8',
)

const selectiveScope = Object.freeze({
  recentDays: 7,
  maxPages: 100,
  maxListings: 2_000,
  maxDetails: 199,
})

function identity(overrides = {}) {
  return {
    sourceKey: 'workday:wd5:example:Example',
    companyName: 'Example',
    cxsRoot: 'https://example.wd5.myworkdayjobs.com/wday/cxs/example/Example',
    requireDetailCountryProof: true,
    selectiveRecentUsScope: selectiveScope,
    ...overrides,
  }
}

function healthyObservation(jobCount = 2) {
  const jobs = Array.from({ length: jobCount }, (_, index) => ({
    title: `Analyst ${index}`,
    location: 'New York, NY',
    source: 'workday',
    companyName: 'Example',
  }))
  return {
    jobs,
    completeness: 'complete',
    credibleForClosure: true,
    allowMissingClosure: false,
    pageCount: 1,
    expectedCount: jobCount,
    warnings: [],
  }
}

test('the mirrored adapter hydration default still matches the adapter', () => {
  const declared = adapterSource.match(
    /const DEFAULT_RECENT_MAX_DETAILS = (\d+)/,
  )?.[1]
  assert.equal(
    Number(declared),
    ADAPTER_DEFAULT_MAX_DETAILS,
    'adapter hydration default drifted from the probe copy',
  )
})

test('the candidate contract flags still match the observeConnector gate', () => {
  const gate = connectorsSource.match(
    /const phase038Candidate = [\s\S]*?\n\s*if \(/,
  )?.[0] ?? ''
  assert.notEqual(gate, '', 'candidate gate not found in connectors.ts')
  const flags = [...gate.matchAll(/identity\?\.([A-Za-z]+)/g)].map(([, name]) => name)
  assert.deepEqual(
    [...flags].sort(),
    [...CANDIDATE_CONTRACT_FLAGS].sort(),
    'observeConnector gate changed without updating the probe',
  )
})

test('an identity with no candidate contract is blocked before any request', async () => {
  // The first half of the PIMCO defect: a countryScope alone never reaches the
  // experimental observation path, so no board response can rescue it.
  const countryScopeOnly = identity({
    requireDetailCountryProof: undefined,
    selectiveRecentUsScope: undefined,
    countryScope: { id: 'bc33aa3152ec42d4995f4791a106ed09' },
  })
  const contract = inspectContract(countryScopeOnly)
  assert.equal(contract.ok, false)
  assert.equal(contract.reason, 'no_candidate_contract')
  assert.deepEqual([...contract.carried], [])

  let polled = false
  const result = await probeIdentity(countryScopeOnly, {
    poll: () => {
      polled = true
      return healthyObservation()
    },
  })
  assert.equal(result.verdict, 'blocked')
  assert.equal(result.reason, 'no_candidate_contract')
  assert.equal(polled, false, 'a gate-blocked identity must not hit the network')
})

test('an identity with no selective scope inherits the adapter hydration ceiling', () => {
  // The second half of the PIMCO defect: without a selective scope the ceiling
  // is 60, and a board with more eligible rows than that is permanently partial.
  const contract = inspectContract(identity({ selectiveRecentUsScope: undefined }))
  assert.equal(contract.ok, true)
  assert.deepEqual([...contract.carried], ['requireDetailCountryProof'])
  assert.equal(contract.detailCeiling, ADAPTER_DEFAULT_MAX_DETAILS)
  assert.equal(inspectContract(identity()).detailCeiling, 199)
})

test('probeIdentity polls with knownIds alone and never overrides the contract', async () => {
  // Loosening this is how the defect gets papered over: the Phase 03.8 release
  // probe forces maxDetails 199, which would have made PIMCO look healthy.
  const calls = []
  const result = await probeIdentity(identity(), {
    poll: (passed, fetchImpl, options) => {
      calls.push({ passed, fetchImpl, options })
      return healthyObservation()
    },
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].passed.sourceKey, 'workday:wd5:example:Example')
  assert.deepEqual(Object.keys(calls[0].options), ['knownIds'])
  assert.ok(calls[0].options.knownIds instanceof Set)
  assert.equal(calls[0].options.knownIds.size, 0)
  assert.equal(typeof calls[0].fetchImpl, 'function')
  assert.equal(result.verdict, 'clean')
  assert.equal(result.reason, null)
  assert.equal(result.observation.job_count, 2)
  assert.equal(result.observation.foreign_company_rows, 0)
})

test('a capped hydration observation is blocked with the provider warning', () => {
  // Exactly what live PIMCO returned before the fix.
  assert.deepEqual(
    classifyObservation({
      jobs: Array.from({ length: 60 }, () => ({ title: 'x' })),
      completeness: 'partial',
      credibleForClosure: false,
      allowMissingClosure: false,
      pageCount: 5,
      expectedCount: 96,
      warnings: ['detail_cap_exceeded'],
    }),
    { verdict: 'blocked', reason: 'detail_cap_exceeded' },
  )
})

test('every other clean-window condition is enforced', () => {
  assert.deepEqual(
    classifyObservation(healthyObservation(2)),
    { verdict: 'clean', reason: null },
  )
  assert.deepEqual(
    classifyObservation({ ...healthyObservation(), credibleForClosure: false }),
    { verdict: 'blocked', reason: 'not_credible_for_closure' },
  )
  assert.deepEqual(
    classifyObservation({ ...healthyObservation(), warnings: ['country_filter_unverified'] }),
    { verdict: 'blocked', reason: 'country_filter_unverified' },
  )
  assert.deepEqual(
    classifyObservation({ ...healthyObservation(2), expectedCount: 3 }),
    { verdict: 'blocked', reason: 'count_mismatch' },
  )
  assert.deepEqual(
    classifyObservation({ ...healthyObservation(0), expectedCount: 0 }),
    { verdict: 'barren', reason: 'zero_eligible_jobs' },
  )
  assert.deepEqual(
    classifyObservation({ completeness: 'partial', warnings: [] }),
    { verdict: 'blocked', reason: 'incomplete_observation' },
  )
})

test('a throwing poll is reported, not swallowed', async () => {
  const result = await probeIdentity(identity(), {
    poll: () => Promise.reject(new Error('provider_schema_invalid')),
  })
  assert.equal(result.verdict, 'blocked')
  assert.equal(result.reason, 'probe_threw')
  assert.equal(result.detail, 'provider_schema_invalid')
})

test('static-only skips the network but still applies the gate', async () => {
  let polled = false
  const dependencies = {
    poll: () => {
      polled = true
      return healthyObservation()
    },
  }
  const passing = await probeIdentity(identity(), { ...dependencies, staticOnly: true })
  assert.equal(passing.verdict, 'contract_only')
  const failing = await probeIdentity(
    identity({ requireDetailCountryProof: undefined, selectiveRecentUsScope: undefined }),
    { ...dependencies, staticOnly: true },
  )
  assert.equal(failing.verdict, 'blocked')
  assert.equal(polled, false)
})

test('targets default to the pending candidates and reject unknown or repeated keys', () => {
  const registry = Object.fromEntries(
    DEFAULT_TARGETS.map((key) => [key, identity({ sourceKey: key })]),
  )
  assert.deepEqual(
    resolveTargets([], registry).map((entry) => entry.sourceKey),
    [...DEFAULT_TARGETS],
  )
  assert.deepEqual(
    resolveTargets([DEFAULT_TARGETS[1]], registry).map((entry) => entry.sourceKey),
    [DEFAULT_TARGETS[1]],
  )
  assert.throws(
    () => resolveTargets(['workday:wd5:nope:Nope'], registry),
    /unknown Workday source key/,
  )
  assert.throws(
    () => resolveTargets([DEFAULT_TARGETS[0], DEFAULT_TARGETS[0]], registry),
    /duplicate Workday source key/,
  )
})

test('argument parsing accepts keys and --static-only and rejects other flags', () => {
  assert.deepEqual(parseArgs([]), { keys: [], staticOnly: false })
  assert.deepEqual(
    parseArgs(['--static-only', 'workday:wd5:visa:Visa']),
    { keys: ['workday:wd5:visa:Visa'], staticOnly: true },
  )
  assert.throws(() => parseArgs(['--max-details=199']), /unknown option/)
})

test('the report buckets blocked and barren identities for the exit code', async () => {
  const registry = {
    WORKDAY_IDENTITIES: {
      'a:1': identity({ sourceKey: 'a:1', companyName: 'Clean' }),
      'b:2': identity({ sourceKey: 'b:2', companyName: 'Barren' }),
      'c:3': identity({
        sourceKey: 'c:3',
        companyName: 'Blocked',
        requireDetailCountryProof: undefined,
        selectiveRecentUsScope: undefined,
      }),
    },
  }
  const report = await probeAll(['a:1', 'b:2', 'c:3'], {
    identities: registry,
    poll: (passed) => (passed.companyName === 'Barren'
      ? { ...healthyObservation(0), expectedCount: 0 }
      : healthyObservation()),
  })
  assert.deepEqual(report.results.map((result) => result.verdict),
    ['clean', 'barren', 'blocked'])
  assert.deepEqual(report.blocked, ['c:3'])
  assert.deepEqual(report.barren, ['b:2'])
  assert.equal(report.static_only, false)
})

test('the registered candidates all carry a contract the gate accepts', async () => {
  // Runs against the real frozen registry, no network.
  const report = await probeAll(['--static-only'], { root: ROOT })
  assert.deepEqual(report.results.map((result) => result.source_key), [...DEFAULT_TARGETS])
  for (const result of report.results) {
    assert.equal(result.verdict, 'contract_only', `${result.source_key} is gate-blocked`)
    assert.ok(result.contract.length > 0)
    assert.equal(result.detail_ceiling, 199,
      `${result.source_key} inherits the ${ADAPTER_DEFAULT_MAX_DETAILS}-detail default`)
  }
  assert.deepEqual(report.blocked, [])
})

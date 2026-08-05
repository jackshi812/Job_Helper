import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import {
  aggregateReceipts,
  canonicalForwardProof,
  canonicalJson,
  effectiveWave1,
  exactReleaseApproval,
  forwardApprovalChallenge,
  sha256Hex,
  validateBaseline,
  validateCandidateSet,
  validateForwardApproval,
  validateForwardAttempt,
  validateForwardManifest,
  validateForwardPreflight,
  validateForwardReceipt,
  validateReleaseManifest,
  validateWaveReceipt,
} from './run-phase-06-wave-gate.ts'

const HASH = 'a'.repeat(64)
const SOURCE_COMMIT = 'b'.repeat(40)
const PROJECT_REF = 'fjcsvajkkztvlrpdplwx'
const BASELINE_PATH =
  '.planning/phases/06-non-self-service-employer-connector-expansion-add-and-activa/06-EXECUTION-BASELINE.json'
const MIXES = new Map([
  [1, [8, 2]],
  [2, [6, 4]],
  [3, [4, 6]],
  [4, [2, 8]],
  [5, [0, 10]],
])
const execFile = promisify(execFileCallback)

function digest(value) {
  return sha256Hex(canonicalJson(value))
}

function selfHash(value, field) {
  const body = structuredClone(value)
  delete body[field]
  return digest(body)
}

function baselineRow(index, overrides = {}) {
  return {
    id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    normalized_name: `baseline ${String(index).padStart(2, '0')}`,
    ats_type: 'workday',
    source_key: `workday:wd1:baseline${index}:careers`,
    activation_state: 'active',
    last_success_at: '2026-08-04T12:00:00.000Z',
    watchlist_self_service_admissible: false,
    ...overrides,
  }
}

function baselineFixture(overrides = {}) {
  const rows = overrides.active_supported_companies ?? [baselineRow(1)]
  const value = {
    schema_version: 1,
    phase: '06',
    status: 'CAPTURED',
    captured_at: '2026-08-04T12:30:00.000Z',
    source_commit: SOURCE_COMMIT,
    deployed_migration_head: '0068',
    active_supported_companies: rows,
    active_supported_count: rows.length,
    normalized_identity_digest: digest(rows),
    ...overrides,
  }
  delete value.baseline_evidence_sha256
  value.baseline_evidence_sha256 = selfHash(
    value,
    'baseline_evidence_sha256',
  )
  return value
}

function target(wave, index, portfolioClass, overrides = {}) {
  const name = `wave ${wave} company ${String(index).padStart(2, '0')}`
  return {
    normalized_name: name,
    portfolio_class: portfolioClass,
    official_careers_url: `https://company-${wave}-${index}.wd1.myworkdayjobs.com/careers`,
    provider: 'workday',
    provider_id: 'workday',
    mode: 'reuse',
    source_key: `workday:wd1:company${wave}${index}:careers`,
    tenant: `company${wave}${index}`,
    region: 'wd1',
    site: 'careers',
    host_form: 'jobs',
    baseline_absent: true,
    prior_waves_absent: true,
    self_service_excluded: true,
    positive_posting_proven: true,
    anonymous_https_contract: true,
    implementation: {
      identity_module:
        'supabase/functions/_shared/workday-identities.ts',
      identity_exports: ['WORKDAY_IDENTITIES', 'resolveWorkdayIdentity'],
      adapter_module:
        'supabase/functions/_shared/adapters/workday.ts',
      adapter_exports: ['pollWorkdayRecent', 'verifyWorkdayListing'],
      registry_module: 'supabase/functions/_shared/connectors.ts',
      registry_symbol: 'providerRegistry.workday',
      observation_module: 'supabase/functions/observe-connectors/index.ts',
      observation_branch: 'workday',
      migration_path:
        `supabase/migrations/${String(68 + wave).padStart(4, '0')}_phase_06_wave_${wave}.sql`,
      test_paths: [
        'web/tests/phase-06-workday-identities.test.ts',
        'web/tests/phase-06-wave-migrations.test.ts',
      ],
    },
    identity_evidence_sha256: digest([wave, index, name]),
    ...overrides,
  }
}

function candidateFixture(wave, baseline, priorReceipt = null, overrides = {}) {
  const [financeCount, techDataCount] = MIXES.get(wave)
  const targets = Array.from({ length: 10 }, (_, index) =>
    target(
      wave,
      index + 1,
      index < financeCount ? 'finance' : 'tech_data',
    ))
  const value = {
    schema_version: 1,
    phase: '06',
    wave,
    status: 'SEALED',
    baseline_evidence_sha256: baseline.baseline_evidence_sha256,
    prior_wave_receipt_sha256:
      priorReceipt?.wave_evidence_sha256 ?? null,
    implementation_targets: targets,
    reserves: [
      ...(financeCount > 0 ? [target(wave, 91, 'finance')] : []),
      ...(techDataCount > 0 ? [target(wave, 92, 'tech_data')] : []),
    ],
    exclusions: [{
      normalized_name: `excluded ${wave}`,
      portfolio_class: 'finance',
      code: 'baseline_active',
    }],
    ...overrides,
  }
  delete value.candidate_evidence_sha256
  value.candidate_evidence_sha256 = selfHash(
    value,
    'candidate_evidence_sha256',
  )
  return value
}

function action(id, command) {
  return {
    id,
    command,
    max_attempts: 1,
    expected_identity: `${id}-identity`,
  }
}

function manifestFixture(
  wave,
  baseline,
  candidates,
  priorReceipt = null,
  overrides = {},
) {
  const functions = [
    ['verify-board', true],
    ['observe-connectors', false],
    ['poll-tick', false],
  ].map(([slug, verifyJwt]) => {
    const bundleFiles = [{
      path: `supabase/functions/${slug}/index.ts`,
      sha256: digest(['file', wave, slug]),
    }]
    return {
      slug,
      bundle_files: bundleFiles,
      bundle_sha256: digest(bundleFiles),
      verify_jwt: verifyJwt,
      expected_deployment_identity: `${slug}-v${wave}`,
    }
  })
  const actions = [
    action('schema_push', `supabase db push --include-only wave-${wave}`),
    action('deploy_verify_board', 'supabase functions deploy verify-board'),
    action(
      'deploy_observe_connectors',
      'supabase functions deploy observe-connectors --no-verify-jwt',
    ),
    action(
      'deploy_poll_tick',
      'supabase functions deploy poll-tick --no-verify-jwt',
    ),
  ]
  const webSourceFiles = [
    'web/src/lib/watchlist.ts',
    'web/src/lib/watchlist.test.ts',
    'web/src/pages/Watchlist.tsx',
    'web/src/pages/Watchlist.test.tsx',
  ].sort((left, right) => left.localeCompare(right))
    .map((path) => ({ path, sha256: digest(['web-source', path]) }))
  const web = wave === 1
    ? {
        source_files: webSourceFiles,
        source_sha256: digest(webSourceFiles),
        build_path: 'web/dist/assets/index.js',
        build_sha256: digest(['web-build', wave]),
        expected_deployment_identity: 'cloudflare-wave-1',
      }
    : null
  if (web) {
    actions.push(action('deploy_web', 'git push origin HEAD:main'))
  }
  const value = {
    schema_version: 1,
    phase: '06',
    wave,
    status: 'SEALED',
    release_manifest_id:
      `20000000-0000-4000-8000-${String(wave).padStart(12, '0')}`,
    source_commit: SOURCE_COMMIT,
    baseline_evidence_sha256: baseline.baseline_evidence_sha256,
    candidate_evidence_sha256: candidates.candidate_evidence_sha256,
    prior_wave_receipt_sha256:
      priorReceipt?.wave_evidence_sha256 ?? null,
    artifacts: {
      migration: {
        path: candidates.implementation_targets[0].implementation.migration_path,
        sha256: digest(['migration', wave]),
      },
      functions,
      web,
    },
    exclusions: [
      'outreach',
      'provider_requests',
      'manual_worker_invocation',
      'schedule_mutation',
      'migration_retry',
      'rollback_cleanup',
    ],
    remote_preconditions: {
      project_ref: PROJECT_REF,
      deployed_migration_head: String(67 + wave).padStart(4, '0'),
      source_commit: SOURCE_COMMIT,
    },
    actions,
    ...overrides,
  }
  delete value.release_manifest_sha256
  value.release_manifest_sha256 = selfHash(
    value,
    'release_manifest_sha256',
  )
  return value
}

function companyReceipt(wave, targetRow, index, overrides = {}) {
  const value = {
    company_id:
      `30000000-0000-4000-8000-${String(wave * 100 + index).padStart(12, '0')}`,
    normalized_name: targetRow.normalized_name,
    portfolio_class: targetRow.portfolio_class,
    wave,
    source_key: targetRow.source_key,
    provider: 'workday',
    official_careers_url: targetRow.official_careers_url,
    baseline_absent: true,
    self_service_excluded: true,
    identity_evidence_sha256: targetRow.identity_evidence_sha256,
    activation_state: 'active',
    activation_successes: 3,
    activation_observation_ids: [1, 2, 3].map((number) =>
      `40000000-0000-4000-8000-${String(wave * 1_000 + index * 10 + number).padStart(12, '0')}`),
    scheduler_claimed_at: '2026-08-04T13:00:00.000Z',
    last_success_at: '2026-08-04T13:01:00.000Z',
    last_error_code: null,
    persisted_job_id:
      `50000000-0000-4000-8000-${String(wave * 100 + index).padStart(12, '0')}`,
    persisted_job_source: 'workday',
    persisted_job_external_id: `job-${wave}-${index}`,
    persisted_job_url: `https://company-${wave}-${index}.wd1.myworkdayjobs.com/job/${index}`,
    persisted_job_observed_at: '2026-08-04T13:01:00.000Z',
    system_managed: true,
    ...overrides,
  }
  delete value.company_evidence_sha256
  value.company_evidence_sha256 = selfHash(
    value,
    'company_evidence_sha256',
  )
  return value
}

function receiptFixture(
  wave,
  baseline,
  candidates,
  manifest,
  priorReceipt = null,
  overrides = {},
) {
  const companies = candidates.implementation_targets.map((entry, index) =>
    companyReceipt(wave, entry, index + 1))
  const financeCount = companies.filter((entry) =>
    entry.portfolio_class === 'finance').length
  const techDataCount = companies.length - financeCount
  const attemptedActions = manifest.actions.map((entry) => entry.id)
  const cumulativeIdentities = [
    ...(priorReceipt?.cumulative_identities ?? []),
    ...companies.map((entry) => ({
      company_id: entry.company_id,
      normalized_name: entry.normalized_name,
      provider: entry.provider,
      source_key: entry.source_key,
      portfolio_class: entry.portfolio_class,
      company_evidence_sha256: entry.company_evidence_sha256,
    })),
  ]
  const value = {
    schema_version: 1,
    phase: '06',
    wave,
    status: 'PASS',
    release_manifest_sha256: manifest.release_manifest_sha256,
    candidate_evidence_sha256: candidates.candidate_evidence_sha256,
    baseline_evidence_sha256: baseline.baseline_evidence_sha256,
    source_commit: manifest.source_commit,
    migration_file_sha256: manifest.artifacts.migration.sha256,
    prior_wave_receipt_sha256:
      priorReceipt?.wave_evidence_sha256 ?? null,
    companies,
    cumulative_identities: cumulativeIdentities,
    wave_finance_count: financeCount,
    wave_tech_data_count: techDataCount,
    cumulative_finance_count:
      Number(priorReceipt?.cumulative_finance_count ?? 0) + financeCount,
    cumulative_tech_data_count:
      Number(priorReceipt?.cumulative_tech_data_count ?? 0) + techDataCount,
    isolation_status: 'PASS',
    watchlist_status: 'PASS',
    authenticated_delete_status: 'PASS',
    attempted_actions: attemptedActions,
    deployed_actions: attemptedActions,
    remote_heads: {
      deployed_migration_head: String(68 + wave).padStart(4, '0'),
      function_deployments: Object.fromEntries(
        manifest.artifacts.functions.map((entry) => [
          entry.slug,
          entry.expected_deployment_identity,
        ]),
      ),
      web_deployment:
        manifest.artifacts.web?.expected_deployment_identity ?? null,
    },
    completed_at: '2026-08-04T14:00:00.000Z',
    ...overrides,
  }
  delete value.wave_evidence_sha256
  value.wave_evidence_sha256 = selfHash(value, 'wave_evidence_sha256')
  return value
}

function failedReceiptFixture(
  wave,
  baseline,
  candidates,
  manifest,
  priorReceipt = null,
  overrides = {},
) {
  const value = {
    schema_version: 1,
    phase: '06',
    wave,
    status: 'FAILED',
    release_manifest_sha256: manifest.release_manifest_sha256,
    candidate_evidence_sha256: candidates.candidate_evidence_sha256,
    baseline_evidence_sha256: baseline.baseline_evidence_sha256,
    source_commit: manifest.source_commit,
    migration_file_sha256: manifest.artifacts.migration.sha256,
    prior_wave_receipt_sha256:
      priorReceipt?.wave_evidence_sha256 ?? null,
    failure: {
      stage: 'natural_poll',
      code: 'positive_job_missing',
      affected_identity: candidates.implementation_targets[0].source_key,
    },
    attempted_actions: ['schema_push'],
    deployed_actions: ['schema_push'],
    remote_heads: {
      deployed_migration_head: String(68 + wave).padStart(4, '0'),
      function_deployments: {},
      web_deployment: null,
    },
    failed_at: '2026-08-04T14:00:00.000Z',
    ...overrides,
  }
  delete value.wave_evidence_sha256
  value.wave_evidence_sha256 = selfHash(value, 'wave_evidence_sha256')
  return value
}

function chain() {
  const baseline = baselineFixture()
  const rows = []
  let prior = null
  for (let wave = 1; wave <= 5; wave += 1) {
    const candidates = candidateFixture(wave, baseline, prior)
    const manifest = manifestFixture(wave, baseline, candidates, prior)
    const receipt = receiptFixture(
      wave,
      baseline,
      candidates,
      manifest,
      prior,
    )
    rows.push({ candidates, manifest, receipt })
    prior = receipt
  }
  return { baseline, rows }
}

function refreshSelfHash(value, field) {
  value[field] = selfHash(value, field)
  return value
}

test('canonical JSON sorts object keys while preserving schema-owned array order', () => {
  assert.equal(
    canonicalJson({ z: 1, a: [{ d: 4, c: 3 }, 2] }),
    '{"a":[{"c":3,"d":4},2],"z":1}',
  )
  assert.match(sha256Hex('phase-06'), /^[a-f0-9]{64}$/)
})

test('baseline validates an exact sorted envelope and deterministic digests', () => {
  const baseline = baselineFixture({
    active_supported_companies: [
      baselineRow(1),
      baselineRow(2, { source_key: 'workday:wd2:baseline2:careers' }),
    ],
  })
  const result = validateBaseline(baseline)
  assert.equal(result.active_supported_count, 2)
  assert.equal(result.baseline_evidence_sha256, baseline.baseline_evidence_sha256)
})

for (const mutate of [
  (value) => value.active_supported_companies.reverse(),
  (value) => value.active_supported_companies.push(
    structuredClone(value.active_supported_companies[0]),
  ),
  (value) => delete value.active_supported_companies[0].source_key,
  (value) => { value.active_supported_companies[0].normalized_name = ' Not Lower ' },
  (value) => { value.surprise = true },
  (value) => { value.normalized_identity_digest = HASH },
]) {
  test('baseline rejects sorting, duplicate, field, canonical, or digest drift', () => {
    const baseline = baselineFixture({
      active_supported_companies: [
        baselineRow(1),
        baselineRow(2, { source_key: 'workday:wd2:baseline2:careers' }),
      ],
    })
    mutate(baseline)
    assert.throws(() => validateBaseline(baseline), { name: 'GateError' })
  })
}

test('candidate validation accepts every locked wave mix and concrete Workday target', () => {
  const { baseline, rows } = chain()
  for (const [index, row] of rows.entries()) {
    const result = validateCandidateSet({
      wave: index + 1,
      baseline,
      candidates: row.candidates,
      priorReceipt: index === 0 ? null : rows[index - 1].receipt,
    })
    assert.equal(result.implementation_targets.length, 10)
  }
})

const candidateMutations = [
  ['missing company', (value) => value.implementation_targets.pop()],
  ['duplicate company', (value) => {
    value.implementation_targets[1] = structuredClone(value.implementation_targets[0])
  }],
  ['wrong mix', (value) => {
    value.implementation_targets[0].portfolio_class = 'tech_data'
  }],
  ['baseline collision', (value, baseline) => {
    value.implementation_targets[0].normalized_name =
      baseline.active_supported_companies[0].normalized_name
  }],
  ['self service', (value) => {
    value.implementation_targets[0].self_service_excluded = false
  }],
  ['non Workday', (value) => {
    value.implementation_targets[0].provider = 'oracle_recruiting'
  }],
  ['conditional path', (value) => {
    value.implementation_targets[0].implementation.identity_module =
      'if discovered later'
  }],
  ['wrong migration', (value) => {
    value.implementation_targets[0].implementation.migration_path =
      'supabase/migrations/9999_wrong.sql'
  }],
]

for (const [label, mutate] of candidateMutations) {
  test(`candidate validation rejects ${label}`, () => {
    const baseline = baselineFixture()
    const candidates = candidateFixture(1, baseline)
    mutate(candidates, baseline)
    refreshSelfHash(candidates, 'candidate_evidence_sha256')
    assert.throws(
      () => validateCandidateSet({
        wave: 1,
        baseline,
        candidates,
        priorReceipt: null,
      }),
      { name: 'GateError' },
    )
  })
}

test('candidate prior chain requires canonical PASS and absence from prior waves', () => {
  const { baseline, rows } = chain()
  const candidates = structuredClone(rows[1].candidates)
  candidates.implementation_targets[0].source_key =
    rows[0].receipt.companies[0].source_key
  refreshSelfHash(candidates, 'candidate_evidence_sha256')
  assert.throws(() => validateCandidateSet({
    wave: 2,
    baseline,
    candidates,
    priorReceipt: rows[0].receipt,
  }), { name: 'GateError' })

  const laterCandidates = structuredClone(rows[2].candidates)
  laterCandidates.implementation_targets[0].source_key =
    rows[0].receipt.companies[0].source_key
  refreshSelfHash(laterCandidates, 'candidate_evidence_sha256')
  assert.throws(() => validateCandidateSet({
    wave: 3,
    baseline,
    candidates: laterCandidates,
    priorReceipt: rows[1].receipt,
  }), { name: 'GateError' })

  const failed = structuredClone(rows[0].receipt)
  failed.status = 'FAILED'
  assert.throws(() => validateCandidateSet({
    wave: 2,
    baseline,
    candidates: rows[1].candidates,
    priorReceipt: failed,
  }), { name: 'GateError' })
})

test('manifest binds all local artifacts, exclusions, remote preconditions, and one-attempt actions', () => {
  const { baseline, rows } = chain()
  for (const [index, row] of rows.entries()) {
    const result = validateReleaseManifest({
      wave: index + 1,
      baseline,
      candidates: row.candidates,
      manifest: row.manifest,
      priorReceipt: index === 0 ? null : rows[index - 1].receipt,
    })
    assert.equal(
      result.approval,
      `APPROVE PHASE 06 WAVE ${index + 1} RELEASE ${row.manifest.release_manifest_sha256}`,
    )
    assert.equal(
      exactReleaseApproval(row.manifest),
      result.approval,
    )
  }
})

for (const [label, mutate] of [
  ['artifact digest', (value) => { value.artifacts.migration.sha256 = HASH }],
  ['missing exclusion', (value) => { value.exclusions.pop() }],
  ['remote precondition', (value) => { delete value.remote_preconditions.project_ref }],
  ['deployment identity', (value) => {
    delete value.artifacts.functions[0].expected_deployment_identity
  }],
  ['bundle digest', (value) => {
    value.artifacts.functions[0].bundle_sha256 = HASH
  }],
  ['maximum attempts', (value) => { value.actions[0].max_attempts = 2 }],
  ['literal command', (value) => { value.actions[0].command = '' }],
  ['unexpected action', (value) => {
    value.actions.push(action('manual_poll', 'invoke poll-tick'))
  }],
]) {
  test(`manifest validation rejects ${label} drift`, () => {
    const baseline = baselineFixture()
    const candidates = candidateFixture(1, baseline)
    const manifest = manifestFixture(1, baseline, candidates)
    mutate(manifest)
    refreshSelfHash(manifest, 'release_manifest_sha256')
    assert.throws(() => validateReleaseManifest({
      wave: 1,
      baseline,
      candidates,
      manifest,
      priorReceipt: null,
    }), { name: 'GateError' })
  })
}

test('canonical PASS receipt binds exactly ten qualifying companies and immutable release identities', () => {
  const { baseline, rows } = chain()
  let prior = null
  for (const [index, row] of rows.entries()) {
    const result = validateWaveReceipt({
      wave: index + 1,
      baseline,
      candidates: row.candidates,
      manifest: row.manifest,
      receipt: row.receipt,
      priorReceipt: prior,
    })
    assert.equal(result.status, 'PASS')
    assert.equal(result.companies.length, 10)
    prior = row.receipt
  }
})

for (const [label, mutate] of [
  ['fewer than ten', (value) => value.companies.pop()],
  ['inactive company', (value) => {
    value.companies[0].activation_state = 'experimental'
  }],
  ['manual scheduler proof', (value) => {
    value.companies[0].scheduler_claimed_at = null
  }],
  ['missing job', (value) => { value.companies[0].persisted_job_id = '' }],
  ['system ownership drift', (value) => {
    value.companies[0].system_managed = false
  }],
  ['artifact binding drift', (value) => { value.migration_file_sha256 = HASH }],
]) {
  test(`PASS receipt rejects ${label}`, () => {
    const { baseline, rows } = chain()
    const { candidates, manifest } = rows[0]
    const receipt = structuredClone(rows[0].receipt)
    mutate(receipt)
    if (receipt.companies?.[0]) {
      refreshSelfHash(receipt.companies[0], 'company_evidence_sha256')
    }
    refreshSelfHash(receipt, 'wave_evidence_sha256')
    assert.throws(() => validateWaveReceipt({
      wave: 1,
      baseline,
      candidates,
      manifest,
      receipt,
      priorReceipt: null,
    }), { name: 'GateError' })
  })
}

test('canonical FAILED receipt is a bounded tagged union and never counts companies', () => {
  const baseline = baselineFixture()
  const candidates = candidateFixture(1, baseline)
  const manifest = manifestFixture(1, baseline, candidates)
  const receipt = failedReceiptFixture(1, baseline, candidates, manifest)
  const result = validateWaveReceipt({
    wave: 1,
    baseline,
    candidates,
    manifest,
    receipt,
    priorReceipt: null,
  })
  assert.equal(result.status, 'FAILED')
  assert.equal(Object.hasOwn(result, 'companies'), false)

  for (const mutate of [
    (value) => { value.failure.stage = 'retry_later' },
    (value) => { value.failure.code = 'raw provider body leaked' },
    (value) => { value.attempted_actions = ['manual_poll'] },
    (value) => { value.deployed_actions = ['deploy_web'] },
    (value) => { value.companies = [] },
  ]) {
    const invalid = structuredClone(receipt)
    mutate(invalid)
    refreshSelfHash(invalid, 'wave_evidence_sha256')
    assert.throws(() => validateWaveReceipt({
      wave: 1,
      baseline,
      candidates,
      manifest,
      receipt: invalid,
      priorReceipt: null,
    }), { name: 'GateError' })
  }
})

test('aggregate accepts five ordered chained PASS receipts at exactly 50/20/30', () => {
  const { baseline, rows } = chain()
  const result = aggregateReceipts({
    baseline,
    receipts: rows.map((entry) => entry.receipt),
    expectWaves: 5,
    expectTotal: 50,
    expectFinance: 20,
    expectTechData: 30,
  })
  assert.equal(result.status, 'PASS')
  assert.equal(result.total_company_count, 50)
  assert.equal(result.finance_count, 20)
  assert.equal(result.tech_data_count, 30)
  assert.match(result.aggregate_evidence_sha256, /^[a-f0-9]{64}$/)
})

for (const [label, mutate] of [
  ['ordered chain drift', (receipts) => receipts.reverse()],
  ['FAILED receipt', (receipts) => { receipts[2].status = 'FAILED' }],
  ['global company duplicate', (receipts) => {
    receipts[4].companies[0].company_id = receipts[0].companies[0].company_id
    refreshSelfHash(receipts[4].companies[0], 'company_evidence_sha256')
  }],
  ['global source duplicate', (receipts) => {
    receipts[4].companies[0].source_key = receipts[0].companies[0].source_key
    refreshSelfHash(receipts[4].companies[0], 'company_evidence_sha256')
  }],
  ['cumulative arithmetic drift', (receipts) => {
    receipts[3].cumulative_finance_count += 1
  }],
  ['baseline mismatch', (receipts) => {
    receipts[4].baseline_evidence_sha256 = HASH
  }],
]) {
  test(`aggregate rejects ${label}`, () => {
    const { baseline, rows } = chain()
    const receipts = rows.map((entry) => structuredClone(entry.receipt))
    mutate(receipts)
    for (const receipt of receipts) {
      refreshSelfHash(receipt, 'wave_evidence_sha256')
    }
    assert.throws(() => aggregateReceipts({
      baseline,
      receipts,
      expectWaves: 5,
      expectTotal: 50,
      expectFinance: 20,
      expectTechData: 30,
    }), { name: 'GateError' })
  })
}

test('runner source is local validation only with no effectful client capability', async () => {
  const source = await readFile(
    new URL('./run-phase-06-wave-gate.ts', import.meta.url),
    'utf8',
  )
  for (const forbidden of [
    /from ['"]@supabase\/supabase-js['"]/u,
    /\bcreateClient\s*\(/u,
    /\bfetch\s*\(/u,
    /\bexec(?:File)?\s*\(/u,
    /\bspawn\s*\(/u,
    /process\.env/u,
    /SUPABASE_(?:ACCESS_TOKEN|SERVICE_ROLE_KEY)/u,
  ]) {
    assert.doesNotMatch(source, forbidden)
  }
  assert.match(source, /--validate-baseline/u)
  assert.match(source, /--validate-candidates/u)
  assert.match(source, /--validate-manifest/u)
  assert.match(source, /--verify-receipt/u)
  assert.match(source, /--aggregate-receipts/u)
})

test('all five downstream CLI modes execute directly against bounded local fixtures', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'phase-06-gate-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const runner = new URL('./run-phase-06-wave-gate.ts', import.meta.url).pathname
  const baseline = baselineFixture()
  const candidates = candidateFixture(1, baseline)
  const manifest = manifestFixture(1, baseline, candidates)
  const localFiles = [
    manifest.artifacts.migration,
    ...manifest.artifacts.functions.flatMap((entry) => entry.bundle_files),
    ...manifest.artifacts.web.source_files,
    {
      path: manifest.artifacts.web.build_path,
      sha256: manifest.artifacts.web.build_sha256,
    },
  ]
  for (const file of localFiles) {
    const path = join(root, file.path)
    const bytes = `bounded fixture for ${file.path}\n`
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, bytes)
    file.sha256 = sha256Hex(bytes)
  }
  for (const entry of manifest.artifacts.functions) {
    entry.bundle_sha256 = digest(entry.bundle_files)
  }
  manifest.artifacts.web.source_sha256 = digest(
    manifest.artifacts.web.source_files,
  )
  manifest.artifacts.web.build_sha256 = localFiles.at(-1).sha256
  refreshSelfHash(manifest, 'release_manifest_sha256')
  const receipt = receiptFixture(1, baseline, candidates, manifest)

  const paths = {
    baseline: join(root, 'baseline.json'),
    candidates: join(root, 'candidates.json'),
    manifest: join(root, 'manifest.json'),
    receipt: join(root, 'receipt.json'),
  }
  for (const [key, path] of Object.entries(paths)) {
    await writeFile(path, `${JSON.stringify({
      baseline,
      candidates,
      manifest,
      receipt,
    }[key], null, 2)}\n`)
  }
  const invoke = async (args) => {
    const { stdout, stderr } = await execFile(
      process.execPath,
      [runner, ...args],
      { cwd: root },
    )
    assert.equal(stderr, '')
    assert.match(stdout, /^PHASE_06_GATE_RESULT=/u)
  }
  await invoke(['--validate-baseline', '--baseline', paths.baseline])
  await invoke([
    '--validate-candidates', '--wave', '1', '--baseline', paths.baseline,
    '--candidates', paths.candidates,
  ])
  await invoke([
    '--validate-manifest', '--wave', '1', '--baseline', paths.baseline,
    '--candidates', paths.candidates, '--manifest', paths.manifest,
  ])
  await invoke([
    '--verify-receipt', '--wave', '1', '--baseline', paths.baseline,
    '--candidates', paths.candidates, '--manifest', paths.manifest,
    '--receipt', paths.receipt,
  ])

  const aggregateChain = chain()
  const receiptPaths = []
  for (const [index, row] of aggregateChain.rows.entries()) {
    const path = join(root, `receipt-${index + 1}.json`)
    await writeFile(path, `${JSON.stringify(row.receipt, null, 2)}\n`)
    receiptPaths.push(path)
  }
  const aggregateBaseline = join(root, 'aggregate-baseline.json')
  await writeFile(
    aggregateBaseline,
    `${JSON.stringify(aggregateChain.baseline, null, 2)}\n`,
  )
  await invoke([
    '--aggregate-receipts', receiptPaths.join(','),
    '--baseline', aggregateBaseline,
    '--expect-waves', '5',
    '--expect-total', '50',
    '--expect-finance', '20',
    '--expect-tech-data', '30',
  ])
})

test('baseline path remains the immutable preflight artifact contract', () => {
  assert.match(BASELINE_PATH, /06-EXECUTION-BASELINE\.json$/u)
})

const FORWARD_MANIFEST_PATH =
  '.planning/phases/06-non-self-service-employer-connector-expansion-add-and-activa/06-WAVE-1-FORWARD-REPAIR-RELEASE-MANIFEST.json'
const FORWARD_PREFLIGHT_PATH =
  '.planning/phases/06-non-self-service-employer-connector-expansion-add-and-activa/06-WAVE-1-FORWARD-REPAIR-PREFLIGHT.json'
const FORWARD_RECEIPT_PATH =
  '.planning/phases/06-non-self-service-employer-connector-expansion-add-and-activa/06-WAVE-1-FORWARD-REPAIR-RECEIPT.json'
const CANDIDATE_PARENT = '1'.repeat(40)
const CANDIDATE_COMMIT = '2'.repeat(40)
const CANDIDATE_TREE = '3'.repeat(40)
const REPAIR_UUID = '60000000-0000-4000-8000-000000000007'
const CANDIDATE_WORKTREE = '/private/tmp/phase-06-07-candidate/release'
const ALLOWLIST = [
  'scripts/run-phase-06-wave-gate.test.mjs',
  'scripts/run-phase-06-wave-gate.ts',
  'supabase/functions/_shared/workday-identities.ts',
  'supabase/migrations/0069_phase_06_wave_1.sql',
  'web/src/lib/watchlist.test.ts',
  'web/src/lib/watchlist.ts',
  'web/src/pages/Watchlist.test.tsx',
  'web/src/pages/Watchlist.tsx',
  'web/tests/paylocity-activation-frontier.test.ts',
  'web/tests/phase-03-11-workday-asset-payments.test.ts',
  'web/tests/phase-03-8-workday-extension.test.ts',
  'web/tests/phase-06-wave-migrations.test.ts',
  'web/tests/phase-06-workday-identities.test.ts',
  'web/tests/workday-connector.integration.test.ts',
]
const CANDIDATE_PATHS = [...ALLOWLIST]
const PREDECESSOR = {
  manifest_path:
    '.planning/phases/06-non-self-service-employer-connector-expansion-add-and-activa/06-WAVE-1-RELEASE-MANIFEST.json',
  manifest_file_sha256:
    '245c874d78e5607da1a437e1f94e38fc496c935951c21b7478d12b4a594e8296',
  manifest_semantic_sha256:
    'dad1791e1358f4e36ec8001f8e3a1f36ee6ca7f2c0fd82e0be5541803ed45e4c',
  receipt_path:
    '.planning/phases/06-non-self-service-employer-connector-expansion-add-and-activa/06-WAVE-1-RECEIPT.json',
  receipt_file_sha256:
    'fae7e21e737bfd2ddbd92dcb3fe523777c43bfea94946da6a83c9b6dc6bc0c53',
  receipt_evidence_sha256:
    '00af33bef93338b6d7c6135d58001c05eb9335891bbc3d99569df9686b715132',
  receipt_status: 'FAILED',
  completed_schema_identity:
    'migration:0069:sha256:7ef2e35b0722db9f396e11ae5361583462e3f943db1957fbf01c319fe740632c',
  migration_path: 'supabase/migrations/0069_phase_06_wave_1.sql',
  migration_sha256:
    '7ef2e35b0722db9f396e11ae5361583462e3f943db1957fbf01c319fe740632c',
  remote_migration_head: '0069',
}
const SOURCE_CLOSURES = {
  'observe-connectors': digest('observe-connectors-closure'),
  'poll-tick': digest('poll-tick-closure'),
  'verify-board': digest('verify-board-closure'),
}
const CANONICAL_COMPANIES = Array.from({ length: 10 }, (_, index) => ({
  normalized_name: `canonical company ${String(index + 1).padStart(2, '0')}`,
  portfolio_class: index < 8 ? 'finance' : 'tech_data',
  source_key: `workday:wd1:canonical${index + 1}:careers`,
}))

function forwardPreflightFixture(overrides = {}) {
  const protectedEntries = [{
    status: 'tracked_modified',
    path: '.planning/STATE.md',
    mode: '644',
    sha256: digest('protected-state-bytes'),
  }]
  const value = {
    schema_version: 2,
    phase: '06',
    plan: '07',
    wave: 1,
    status: 'PASS',
    created_at: '2026-08-05T15:00:00.000Z',
    production_attempt_count: 0,
    production_effects: [],
    immutable_predecessor: structuredClone(PREDECESSOR),
    source_candidate: {
      origin_remote_url: 'https://github.com/jackshi812/Job_Helper.git',
      origin_main_parent_sha: CANDIDATE_PARENT,
      candidate_parent_sha: CANDIDATE_PARENT,
      candidate_commit_sha: CANDIDATE_COMMIT,
      candidate_tree_sha: CANDIDATE_TREE,
      candidate_created_at: '2026-08-05T14:59:00.000Z',
      candidate_worktree: CANDIDATE_WORKTREE,
      reconstructed_commits: [
        'a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40), 'd'.repeat(40),
        'e'.repeat(40), 'f'.repeat(40), '7'.repeat(40), '8'.repeat(40),
      ],
      reconstruction_allowlist: ALLOWLIST,
      changed_paths: CANDIDATE_PATHS,
      planning_evidence_paths: [],
      is_ancestor: true,
      single_parent_path: true,
      no_merge_commits: true,
      source_closures: structuredClone(SOURCE_CLOSURES),
    },
    dirty_worktree: {
      before_status_sha256: digest('dirty-before'),
      after_status_sha256: digest('dirty-after'),
      protected_entries_sha256: digest(protectedEntries),
      protected_entries: protectedEntries,
      unrelated_bytes_unchanged: true,
    },
    verification: {
      focused_runner_tests_sha256: digest('focused-runner-tests'),
      affected_web_tests_sha256: digest('affected-web-tests'),
      full_web_tests_sha256: digest('full-web-tests'),
      typecheck_sha256: digest('typecheck'),
      production_build_sha256: digest('production-build'),
      all_passed: true,
    },
    cli_capability: {
      executable: '/Users/jackshi/Desktop/Job_Copilot/web/node_modules/.bin/supabase',
      executable_sha256: digest('supabase-executable'),
      package_sha256: digest('supabase-package'),
      version: '2.109.1',
      version_output_sha256: digest('version-output'),
      functions_help_sha256: digest('functions-help'),
      deploy_help_sha256: digest('deploy-help'),
      serve_help_sha256: digest('serve-help'),
      docker_deploy_stage_reproduction: {
        status: 'NOT_RUN_NO_NONPRODUCTION_ENTRYPOINT',
        functions_serve_equivalent: false,
      },
      causal_repair_claim: false,
      use_api: {
        supported: true,
        classification: 'MITIGATION_ALTERNATE_SERVER_SIDE_BUNDLER',
      },
      supabase_temp_dependency: false,
      candidate_node_modules_required: false,
    },
    remote_project: {
      project_ref: PROJECT_REF,
      inspected_without_mutation: true,
    },
    scope: {
      decisions: Array.from({ length: 11 }, (_, index) => `D-${String(index + 1).padStart(2, '0')}`),
      canonical_companies: structuredClone(CANONICAL_COMPANIES),
      exclusions: [
        'company_substitution', 'provider_redesign', 'generic_connector',
        'manual_worker_invocation', 'schedule_mutation', 'outreach_mutation',
        'research_rework', 'schema_change', 'migration_rerun',
        'production_effect_outside_manifest',
      ],
    },
    ...overrides,
  }
  delete value.preflight_evidence_sha256
  value.preflight_evidence_sha256 = selfHash(
    value,
    'preflight_evidence_sha256',
  )
  return value
}

function forwardAction(order, overrides = {}) {
  const functions = ['verify-board', 'observe-connectors', 'poll-tick']
  if (order <= 3) {
    const functionName = functions[order - 1]
    const argv = [
      'functions', 'deploy', functionName,
      '--project-ref', PROJECT_REF,
      '--use-api', '--workdir', CANDIDATE_WORKTREE,
      ...(order === 1 ? [] : ['--no-verify-jwt']),
    ]
    return {
      id: `forward_${REPAIR_UUID}_deploy_${functionName.replaceAll('-', '_')}_api`,
      order,
      max_attempts: 1,
      attempt_record_path:
        `.planning/phases/06-non-self-service-employer-connector-expansion-add-and-activa/06-WAVE-1-FORWARD-REPAIR-ACTION-0${order}-ATTEMPT.json`,
      executable:
        '/Users/jackshi/Desktop/Job_Copilot/web/node_modules/.bin/supabase',
      argv,
      cwd: CANDIDATE_WORKTREE,
      workdir: CANDIDATE_WORKTREE,
      project_ref: PROJECT_REF,
      function_name: functionName,
      jwt_mode: order === 1 ? 'VERIFY_ENABLED' : 'VERIFY_DISABLED',
      expected_source_closure_sha256: SOURCE_CLOSURES[functionName],
      expected_deployment_identity:
        `function:${functionName}:sha256:${SOURCE_CLOSURES[functionName]}`,
      preconditions: ['sealed_bytes_unchanged', 'remote_migration_head_0069'],
      ...overrides,
    }
  }
  return {
    id: `forward_${REPAIR_UUID}_push_candidate_main`,
    order: 4,
    max_attempts: 1,
    attempt_record_path:
      '.planning/phases/06-non-self-service-employer-connector-expansion-add-and-activa/06-WAVE-1-FORWARD-REPAIR-ACTION-04-ATTEMPT.json',
    executable: '/usr/bin/git',
    argv: ['push', 'origin', `${CANDIDATE_COMMIT}:refs/heads/main`],
    cwd: CANDIDATE_WORKTREE,
    workdir: CANDIDATE_WORKTREE,
    project_ref: null,
    function_name: null,
    jwt_mode: 'NOT_APPLICABLE',
    expected_source_closure_sha256: CANDIDATE_TREE.padEnd(64, '0'),
    expected_deployment_identity: `web:${CANDIDATE_COMMIT}`,
    preconditions: [
      'fetch_origin_main', 'remote_head_equals_manifest_parent',
      'candidate_descends_from_fresh_remote', 'non_force_exact_refspec',
    ],
    ...overrides,
  }
}

function forwardManifestFixture(preflight, overrides = {}) {
  const value = {
    schema_version: 2,
    phase: '06',
    plan: '07',
    wave: 1,
    status: 'SEALED',
    repair_uuid: REPAIR_UUID,
    sealed_at: '2026-08-05T15:01:00.000Z',
    predecessor: structuredClone(PREDECESSOR),
    preflight: {
      path: FORWARD_PREFLIGHT_PATH,
      file_sha256: digest('preflight-file'),
      evidence_sha256: preflight.preflight_evidence_sha256,
    },
    candidate: {
      origin_main_parent_sha: CANDIDATE_PARENT,
      candidate_commit_sha: CANDIDATE_COMMIT,
      candidate_tree_sha: CANDIDATE_TREE,
      candidate_created_at: preflight.source_candidate.candidate_created_at,
      candidate_worktree: CANDIDATE_WORKTREE,
      changed_paths: CANDIDATE_PATHS,
      source_closures: structuredClone(SOURCE_CLOSURES),
    },
    runner_sha256: digest('runner-source'),
    test_sha256: digest('runner-tests'),
    cli: {
      executable: preflight.cli_capability.executable,
      executable_sha256: preflight.cli_capability.executable_sha256,
      package_sha256: preflight.cli_capability.package_sha256,
      version: '2.109.1',
      deploy_help_sha256: preflight.cli_capability.deploy_help_sha256,
    },
    remote: {
      name: 'origin',
      url: 'https://github.com/jackshi812/Job_Helper.git',
      project_ref: PROJECT_REF,
      expected_main_sha: CANDIDATE_PARENT,
    },
    mitigation: {
      token: 'USE-API-MITIGATION',
      classification: 'MITIGATION_ALTERNATE_SERVER_SIDE_BUNDLER',
      docker_deploy_stage_reproduction: 'NOT_RUN_NO_NONPRODUCTION_ENTRYPOINT',
      causal_repair_claim: false,
    },
    canonical_companies: structuredClone(CANONICAL_COMPANIES),
    actions: [1, 2, 3, 4].map((order) => forwardAction(order)),
    exclusions: preflight.scope.exclusions,
    ...overrides,
  }
  delete value.manifest_semantic_sha256
  value.manifest_semantic_sha256 = selfHash(
    value,
    'manifest_semantic_sha256',
  )
  return value
}

function forwardAttemptFixture(manifest, order, manifestFileSha256, overrides = {}) {
  const action = manifest.actions[order - 1]
  const value = {
    schema_version: 2,
    phase: '06',
    plan: '07',
    repair_uuid: manifest.repair_uuid,
    action_id: action.id,
    action_order: order,
    manifest_file_sha256: manifestFileSha256,
    manifest_semantic_sha256: manifest.manifest_semantic_sha256,
    candidate_commit_sha: CANDIDATE_COMMIT,
    candidate_tree_sha: CANDIDATE_TREE,
    executable: action.executable,
    argv: action.argv,
    cwd: action.cwd,
    attempt_started_at: `2026-08-05T15:0${order + 1}:00.000Z`,
    ...overrides,
  }
  delete value.attempt_evidence_sha256
  value.attempt_evidence_sha256 = selfHash(value, 'attempt_evidence_sha256')
  return value
}

function canonicalCompanyProof(company, index) {
  return {
    normalized_name: company.normalized_name,
    portfolio_class: company.portfolio_class,
    source_key: company.source_key,
    activation_state: 'active',
    naturally_scheduled: true,
    persisted_real_job_id:
      `70000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    company_evidence_sha256: digest(company),
  }
}

function forwardReceiptFixture(
  manifest,
  manifestFileSha256,
  status = 'PASS',
  overrides = {},
) {
  const approval = forwardApprovalChallenge(manifest, manifestFileSha256)
  const attempts = manifest.actions.map((_, index) =>
    forwardAttemptFixture(manifest, index + 1, manifestFileSha256))
  const value = {
    schema_version: 2,
    phase: '06',
    plan: '07',
    wave: 1,
    status,
    repair_uuid: manifest.repair_uuid,
    manifest_path: FORWARD_MANIFEST_PATH,
    manifest_file_sha256: manifestFileSha256,
    manifest_semantic_sha256: manifest.manifest_semantic_sha256,
    predecessor_receipt_path: PREDECESSOR.receipt_path,
    predecessor_receipt_file_sha256: PREDECESSOR.receipt_file_sha256,
    predecessor_receipt_evidence_sha256: PREDECESSOR.receipt_evidence_sha256,
    inherited_schema_identity: PREDECESSOR.completed_schema_identity,
    candidate_commit_sha: CANDIDATE_COMMIT,
    candidate_tree_sha: CANDIDATE_TREE,
    approval,
    approval_verified_at: '2026-08-05T15:01:30.000Z',
    attempts,
    attempted_action_ids: manifest.actions.map((entry) => entry.id),
    deployed_action_ids: manifest.actions.map((entry) => entry.id),
    action_results: manifest.actions.map((entry) => ({
      action_id: entry.id,
      status: 'PASS',
      output_sha256: digest(entry.id),
      proof_sha256: digest([entry.id, 'proof']),
    })),
    canonical_company_evidence: manifest.canonical_companies.map(canonicalCompanyProof),
    gates: {
      exact_candidate_deployed: true,
      authorization_rls: 'PASS',
      company_isolation: 'PASS',
      watchlist_fidelity: 'PASS',
      outreach_unchanged: true,
      provider_scope_unchanged: true,
      schedules_unchanged: true,
      migration_history_unchanged: true,
      asvs_l1_high_severity: 'PASS',
    },
    production_effects: manifest.actions.map((entry) => entry.id),
    unauthorized_effect_count: 0,
    failure: null,
    completed_at: '2026-08-05T16:00:00.000Z',
    ...overrides,
  }
  delete value.forward_evidence_sha256
  value.forward_evidence_sha256 = selfHash(value, 'forward_evidence_sha256')
  return value
}

test('forward repair preserves immutable schema-1 predecessor bytes and FAILED history', async () => {
  const repositoryRoot = process.env.PHASE_06_PREDECESSOR_ROOT
    ?? new URL('../', import.meta.url).pathname
  const phase = join(
    repositoryRoot,
    '.planning/phases/06-non-self-service-employer-connector-expansion-add-and-activa',
  )
  const manifestBytes = await readFile(join(phase, '06-WAVE-1-RELEASE-MANIFEST.json'))
  const receiptBytes = await readFile(join(phase, '06-WAVE-1-RECEIPT.json'))
  assert.equal(sha256Hex(manifestBytes), PREDECESSOR.manifest_file_sha256)
  assert.equal(sha256Hex(receiptBytes), PREDECESSOR.receipt_file_sha256)
  assert.equal(JSON.parse(receiptBytes).status, 'FAILED')
})

test('schema-2 preflight accepts only exact origin/main ancestry and allowlisted source', () => {
  const preflight = forwardPreflightFixture()
  assert.equal(validateForwardPreflight(preflight).status, 'PASS')
  for (const mutate of [
    (value) => { value.source_candidate.candidate_parent_sha = '9'.repeat(40) },
    (value) => { value.source_candidate.is_ancestor = false },
    (value) => { value.source_candidate.no_merge_commits = false },
    (value) => { value.source_candidate.changed_paths.push('README.md') },
  ]) {
    const invalid = structuredClone(preflight)
    mutate(invalid)
    refreshSelfHash(invalid, 'preflight_evidence_sha256')
    assert.throws(() => validateForwardPreflight(invalid), { name: 'GateError' })
  }
})

test('schema-2 preflight rejects predecessor, migration, dirty-byte, and evidence-boundary drift', () => {
  const preflight = forwardPreflightFixture()
  for (const mutate of [
    (value) => { value.immutable_predecessor.manifest_file_sha256 = HASH },
    (value) => { value.immutable_predecessor.receipt_file_sha256 = HASH },
    (value) => { value.immutable_predecessor.migration_sha256 = HASH },
    (value) => { value.dirty_worktree.unrelated_bytes_unchanged = false },
    (value) => { value.source_candidate.planning_evidence_paths.push(FORWARD_PREFLIGHT_PATH) },
  ]) {
    const invalid = structuredClone(preflight)
    mutate(invalid)
    refreshSelfHash(invalid, 'preflight_evidence_sha256')
    assert.throws(() => validateForwardPreflight(invalid), { name: 'GateError' })
  }
})

test('capability evidence rejects serve equivalence and accepts only alternate API bundler mitigation', () => {
  const preflight = forwardPreflightFixture()
  for (const mutate of [
    (value) => {
      value.cli_capability.docker_deploy_stage_reproduction.status = 'PASS'
    },
    (value) => {
      value.cli_capability.docker_deploy_stage_reproduction.functions_serve_equivalent = true
    },
    (value) => { value.cli_capability.causal_repair_claim = true },
    (value) => { value.cli_capability.use_api.classification = 'FIX' },
  ]) {
    const invalid = structuredClone(preflight)
    mutate(invalid)
    refreshSelfHash(invalid, 'preflight_evidence_sha256')
    assert.throws(() => validateForwardPreflight(invalid), { name: 'GateError' })
  }
})

test('schema-2 manifest freezes only four fully resolved remaining effects', () => {
  const preflight = forwardPreflightFixture()
  const manifest = forwardManifestFixture(preflight)
  assert.equal(validateForwardManifest({ manifest, preflight }).actions.length, 4)
  for (const mutate of [
    (value) => { value.actions.unshift(forwardAction(1, { id: 'schema_push' })) },
    (value) => { value.actions[0].id = 'deploy_verify_board' },
    (value) => { value.actions[0].command = 'supabase functions deploy verify-board' },
    (value) => { delete value.actions[0].expected_source_closure_sha256 },
    (value) => { value.actions[3].argv[2] = 'HEAD:refs/heads/main' },
    (value) => { value.actions[0].argv.push('--no-verify-jwt') },
    (value) => { value.actions[0].cwd = '/tmp/other' },
    (value) => { value.actions[0].max_attempts = 2 },
  ]) {
    const invalid = structuredClone(manifest)
    mutate(invalid)
    refreshSelfHash(invalid, 'manifest_semantic_sha256')
    assert.throws(
      () => validateForwardManifest({ manifest: invalid, preflight }),
      { name: 'GateError' },
    )
  }
})

test('approval and attempt records bind exact manifest file digest, candidate, mitigation, and action', () => {
  const preflight = forwardPreflightFixture()
  const manifest = forwardManifestFixture(preflight)
  const manifestFileSha256 = digest(manifest)
  const approval = forwardApprovalChallenge(manifest, manifestFileSha256)
  assert.equal(
    approval,
    `APPROVE PHASE 06 WAVE 1 FORWARD REPAIR ${manifestFileSha256} CANDIDATE ${CANDIDATE_COMMIT} USE-API-MITIGATION`,
  )
  assert.equal(validateForwardApproval({
    manifest,
    manifestFileSha256,
    approval,
  }), approval)
  const attempt = forwardAttemptFixture(manifest, 1, manifestFileSha256)
  assert.equal(validateForwardAttempt({
    attempt,
    manifest,
    manifestFileSha256,
    actionOrder: 1,
  }).action_order, 1)
  assert.throws(() => validateForwardApproval({
    manifest,
    manifestFileSha256,
    approval: approval.replace('USE-API-MITIGATION', 'APPROVED'),
  }), { name: 'GateError' })
})

test('effective Wave 1 is PASS only for predecessor schema proof plus exact four-action PASS and canonical 10/10', () => {
  const preflight = forwardPreflightFixture()
  const manifest = forwardManifestFixture(preflight)
  const manifestFileSha256 = digest(manifest)
  const receipt = forwardReceiptFixture(manifest, manifestFileSha256)
  const predecessor = {
    status: 'FAILED',
    deployed_actions: ['schema_push'],
    migration_file_sha256: PREDECESSOR.migration_sha256,
    wave_evidence_sha256: PREDECESSOR.receipt_evidence_sha256,
  }
  assert.equal(validateForwardReceipt({
    receipt,
    predecessorReceipt: predecessor,
    manifest,
    manifestFileSha256,
  }).status, 'PASS')
  assert.equal(effectiveWave1({ predecessorReceipt: predecessor, forwardReceipt: receipt }).status, 'PASS')
  assert.equal(canonicalForwardProof(receipt, 10).count, 10)

  for (const mutate of [
    (value) => { value.status = 'FAILED' },
    (value) => { value.deployed_action_ids.pop() },
    (value) => { value.canonical_company_evidence.pop() },
    (value) => { value.candidate_commit_sha = '9'.repeat(40) },
  ]) {
    const invalid = structuredClone(receipt)
    mutate(invalid)
    refreshSelfHash(invalid, 'forward_evidence_sha256')
    assert.throws(() => validateForwardReceipt({
      receipt: invalid,
      predecessorReceipt: predecessor,
      manifest,
      manifestFileSha256,
    }), { name: 'GateError' })
  }
})

test('canonical scope rejects substitutions and every deferred or unauthorized effect', () => {
  const preflight = forwardPreflightFixture()
  const manifest = forwardManifestFixture(preflight)
  const manifestFileSha256 = digest(manifest)
  const receipt = forwardReceiptFixture(manifest, manifestFileSha256)
  for (const mutate of [
    (value) => { value.canonical_company_evidence[0].normalized_name = 'substitute' },
    (value) => { value.production_effects.push('manual_worker_invocation') },
    (value) => { value.unauthorized_effect_count = 1 },
    (value) => { value.gates.outreach_unchanged = false },
    (value) => { value.gates.schedules_unchanged = false },
    (value) => { value.gates.migration_history_unchanged = false },
  ]) {
    const invalid = structuredClone(receipt)
    mutate(invalid)
    refreshSelfHash(invalid, 'forward_evidence_sha256')
    assert.throws(() => validateForwardReceipt({
      receipt: invalid,
      predecessorReceipt: {
        status: 'FAILED',
        deployed_actions: ['schema_push'],
        migration_file_sha256: PREDECESSOR.migration_sha256,
        wave_evidence_sha256: PREDECESSOR.receipt_evidence_sha256,
      },
      manifest,
      manifestFileSha256,
    }), { name: 'GateError' })
  }
})

test('forward runner remains evidence-only while exposing every schema-2 validation mode', async () => {
  const source = await readFile(
    new URL('./run-phase-06-wave-gate.ts', import.meta.url),
    'utf8',
  )
  for (const forbidden of [
    /node:child_process/u,
    /\bexecFileSync\s*\(/u,
    /\bexecSync\s*\(/u,
    /\bspawnSync\s*\(/u,
    /\bspawn\s*\(/u,
    /\bfork\s*\(/u,
  ]) {
    assert.doesNotMatch(source, forbidden)
  }
  for (const mode of [
    '--validate-forward-preflight',
    '--validate-forward-manifest',
    '--print-forward-approval-challenge',
    '--validate-forward-approval',
    '--validate-forward-attempt',
    '--validate-forward-receipt',
    '--effective-wave-1',
    '--canonical-proof',
  ]) {
    assert.match(source, new RegExp(mode, 'u'))
  }
})

test('schema-2 CLI validates preflight/manifest and prints the exact file-digest challenge', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'phase-06-forward-gate-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const runner = new URL('./run-phase-06-wave-gate.ts', import.meta.url).pathname
  const preflight = forwardPreflightFixture()
  const preflightPath = join(root, 'preflight.json')
  await writeFile(preflightPath, `${JSON.stringify(preflight, null, 2)}\n`)
  const manifest = forwardManifestFixture(preflight, {
    preflight: {
      path: preflightPath,
      file_sha256: sha256Hex(await readFile(preflightPath)),
      evidence_sha256: preflight.preflight_evidence_sha256,
    },
  })
  refreshSelfHash(manifest, 'manifest_semantic_sha256')
  const manifestPath = join(root, 'manifest.json')
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  const manifestFileSha256 = sha256Hex(await readFile(manifestPath))
  const invoke = (args) => execFile(process.execPath, [runner, ...args], { cwd: root })

  assert.match(
    (await invoke(['--validate-forward-preflight', preflightPath])).stdout,
    /^PHASE_06_GATE_RESULT=/u,
  )
  assert.match(
    (await invoke(['--validate-forward-manifest', manifestPath])).stdout,
    /^PHASE_06_GATE_RESULT=/u,
  )
  assert.equal(
    (await invoke(['--print-forward-approval-challenge', manifestPath])).stdout.trim(),
    forwardApprovalChallenge(manifest, manifestFileSha256),
  )
})

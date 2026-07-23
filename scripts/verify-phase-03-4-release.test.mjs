import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  assertInitializerAuthority,
  inspectWorkerLivenessSource,
  runApprovedBackfill,
  summarizeActiveCoverageRows,
  validateEvidenceText,
  verifyAutomaticEntryPoints,
  verifyPostReleaseEvidence,
  verifyPreflightEvidence,
} from './verify-phase-03-4-release.mjs'

const RELEASE_SHA = 'a'.repeat(40)
const INVENTORY_SHA = 'b'.repeat(64)
const MIGRATION_SHA = 'c'.repeat(64)
const SCORE_TICK_SHA = 'd'.repeat(64)
const SCORE_TICK_BUNDLE_SHA = 'e'.repeat(64)
const EXTRACT_RESUME_SHA = 'f'.repeat(64)
const EXTRACT_RESUME_BUNDLE_SHA = '1'.repeat(64)
const COST_BASELINE_SHA = '2'.repeat(64)
const ASSET_SHA = '3'.repeat(64)
const VERIFIER_SHA = '4'.repeat(64)
const VERIFIER_TEST_SHA = '5'.repeat(64)
const MIGRATIONS = Array.from(
  { length: 32 },
  (_, index) => String(index + 1).padStart(4, '0'),
)

function preflight(overrides = {}) {
  return {
    evidence_mode: 'preflight',
    project_ref: 'fjcsvajkkztvlrpdplwx',
    local_migrations: MIGRATIONS.join(','),
    remote_migrations: MIGRATIONS.join(','),
    migration_0032_sha256: MIGRATION_SHA,
    migration_0032_remote_name: 'deterministic_ranking',
    migration_0032_remote_statement_count: '72',
    score_tick_deployment_id: 'ae6c147f-c3a8-417e-8057-d4105ac9aed5',
    score_tick_version: '11',
    score_tick_status: 'ACTIVE',
    score_tick_verify_jwt: 'false',
    score_tick_index_sha256: SCORE_TICK_SHA,
    score_tick_bundle_manifest_sha256: SCORE_TICK_BUNDLE_SHA,
    extract_resume_deployment_id: '9358db1a-95fc-49bc-a684-b98fb8eceff9',
    extract_resume_version: '4',
    extract_resume_status: 'ACTIVE',
    extract_resume_verify_jwt: 'false',
    extract_resume_index_sha256: EXTRACT_RESUME_SHA,
    extract_resume_bundle_manifest_sha256: EXTRACT_RESUME_BUNDLE_SHA,
    verifier_sha256: VERIFIER_SHA,
    verifier_test_sha256: VERIFIER_TEST_SHA,
    web_asset_path: '/assets/index-deterministic.js',
    web_asset_sha256: ASSET_SHA,
    initializer_owner: 'postgres',
    initializer_security_definer: 'true',
    initializer_search_path: 'empty',
    initializer_execute_roles: 'postgres,service_role',
    initializer_max_batch: '25',
    initializer_initial_unique: 'true',
    initializer_ordinary_queue: 'true',
    worker_claim_batch_size: '25',
    worker_max_concurrency: '25',
    worker_max_items_per_invocation: '5000',
    worker_max_invocation_ms: '45000',
    worker_scheduler_interval_ms: '60000',
    worker_drain_before_maintenance: 'true',
    worker_recovery_run_scan_limit: '25',
    worker_recovery_before_maintenance: 'true',
    real_user_count: '2',
    open_job_count: '17',
    eligible_owner_count: '2',
    deterministic_state_count: '0',
    deterministic_run_count: '0',
    deterministic_item_count: '0',
    deterministic_initial_run_count: '0',
    score_usage_row_count: '9',
    score_usage_prompt_tokens: '120',
    score_usage_output_tokens: '48',
    score_budget_date: '2026-07-23',
    score_budget_requests_today: '9',
    score_budget_updated_at: '2026-07-23T04:00:00.000Z',
    cost_baseline_sha256: COST_BASELINE_SHA,
    controlled_failure_transition: 'pass',
    pending_new_job_transition: 'pass',
    recency_expiry_transition: 'pass',
    worker_liveness_transition: 'pass',
    worker_crash_recovery_transition: 'pass',
    retry_transition: 'pass',
    atomic_preference_transition: 'pass',
    full_tests: 'pass',
    production_build: 'pass',
    lint: 'pass',
    outward_mutations: '0',
    ...overrides,
  }
}

function postRelease(overrides = {}) {
  return {
    evidence_mode: 'post_release',
    approved_git_sha: RELEASE_SHA,
    approved_inventory_sha256: INVENTORY_SHA,
    project_ref: 'fjcsvajkkztvlrpdplwx',
    local_migrations: MIGRATIONS.join(','),
    remote_migrations: MIGRATIONS.join(','),
    migration_0032_sha256: MIGRATION_SHA,
    score_tick_deployment_id: 'ae6c147f-c3a8-417e-8057-d4105ac9aed5',
    score_tick_version: '12',
    score_tick_status: 'ACTIVE',
    score_tick_verify_jwt: 'false',
    score_tick_index_sha256: SCORE_TICK_SHA,
    score_tick_bundle_manifest_sha256: SCORE_TICK_BUNDLE_SHA,
    worker_claim_batch_size: '25',
    worker_max_concurrency: '25',
    worker_max_items_per_invocation: '5000',
    worker_max_invocation_ms: '45000',
    worker_scheduler_interval_ms: '60000',
    worker_drain_before_maintenance: 'true',
    worker_recovery_run_scan_limit: '25',
    worker_recovery_before_maintenance: 'true',
    real_user_count: '2',
    open_job_count: '17',
    eligible_owner_count: '2',
    active_revision_owner_count: '2',
    complete_active_owner_count: '2',
    duplicate_active_revision_owner_count: '0',
    incomplete_active_owner_count: '0',
    visible_missing_deterministic_count: '0',
    visible_mixed_revision_count: '0',
    nonterminal_open_item_count: '0',
    score_usage_row_count_before: '9',
    score_usage_row_count_after: '9',
    score_usage_prompt_tokens_before: '120',
    score_usage_prompt_tokens_after: '120',
    score_usage_output_tokens_before: '48',
    score_usage_output_tokens_after: '48',
    score_budget_date_before: '2026-07-23',
    score_budget_date_after: '2026-07-23',
    score_budget_requests_before: '9',
    score_budget_requests_after: '9',
    score_budget_updated_at_before: '2026-07-23T04:00:00.000Z',
    score_budget_updated_at_after: '2026-07-23T04:00:00.000Z',
    cloudflare_deployment_id: 'deployment-deterministic',
    cloudflare_environment: 'production',
    cloudflare_status: 'success',
    cloudflare_branch: 'main',
    cloudflare_git_sha: RELEASE_SHA,
    cloudflare_url: 'https://deployment-deterministic.job-helper-qs9.pages.dev',
    asset_path: '/assets/index-deterministic.js',
    local_asset_sha256: ASSET_SHA,
    live_asset_sha256: ASSET_SHA,
    signed_in_uat: 'pass',
    outward_mutations_outside_approval: '0',
    ...overrides,
  }
}

function evidenceText(fields) {
  return [
    '# Sanitized evidence',
    '<!-- evidence:start -->',
    ...Object.entries(fields).map(([key, value]) => `${key}: ${value}`),
    '<!-- evidence:end -->',
  ].join('\n')
}

function preflightProbes(overrides = {}) {
  return {
    projectRef: 'fjcsvajkkztvlrpdplwx',
    localMigrations: MIGRATIONS,
    remoteMigrations: MIGRATIONS,
    migration0032Sha256: MIGRATION_SHA,
    migration0032RemoteName: 'deterministic_ranking',
    migration0032RemoteStatementCount: 72,
    scoreTick: {
      id: 'ae6c147f-c3a8-417e-8057-d4105ac9aed5',
      version: 11,
      status: 'ACTIVE',
      verifyJwt: false,
      indexSha256: SCORE_TICK_SHA,
      bundleManifestSha256: SCORE_TICK_BUNDLE_SHA,
    },
    extractResume: {
      id: '9358db1a-95fc-49bc-a684-b98fb8eceff9',
      version: 4,
      status: 'ACTIVE',
      verifyJwt: false,
      indexSha256: EXTRACT_RESUME_SHA,
      bundleManifestSha256: EXTRACT_RESUME_BUNDLE_SHA,
    },
    verifierSha256: VERIFIER_SHA,
    verifierTestSha256: VERIFIER_TEST_SHA,
    webAsset: {
      path: '/assets/index-deterministic.js',
      sha256: ASSET_SHA,
    },
    initializer: {
      owner: 'postgres',
      securityDefiner: true,
      searchPath: '',
      executeRoles: ['postgres', 'service_role'],
      maxBatch: 25,
      initialUnique: true,
      ordinaryQueue: true,
    },
    worker: {
      claimBatchSize: 25,
      maxConcurrency: 25,
      maxItemsPerInvocation: 5_000,
      maxInvocationMs: 45_000,
      schedulerIntervalMs: 60_000,
      drainBeforeMaintenance: true,
      recoveryRunScanLimit: 25,
      recoveryBeforeMaintenance: true,
    },
    counts: {
      realUsers: 2,
      openJobs: 17,
      eligibleOwners: 2,
      states: 0,
      runs: 0,
      items: 0,
      initialRuns: 0,
    },
    cost: {
      usageRows: 9,
      promptTokens: 120,
      outputTokens: 48,
      budgetDate: '2026-07-23',
      requestsToday: 9,
      updatedAt: '2026-07-23T04:00:00.000Z',
      sha256: COST_BASELINE_SHA,
    },
    ...overrides,
  }
}

function postReleaseProbes(overrides = {}) {
  return {
    localGitSha: RELEASE_SHA,
    originGitSha: RELEASE_SHA,
    inventorySha256: INVENTORY_SHA,
    projectRef: 'fjcsvajkkztvlrpdplwx',
    localMigrations: MIGRATIONS,
    remoteMigrations: MIGRATIONS,
    migration0032Sha256: MIGRATION_SHA,
    scoreTick: {
      id: 'ae6c147f-c3a8-417e-8057-d4105ac9aed5',
      version: 12,
      status: 'ACTIVE',
      verifyJwt: false,
      indexSha256: SCORE_TICK_SHA,
      bundleManifestSha256: SCORE_TICK_BUNDLE_SHA,
    },
    worker: {
      claimBatchSize: 25,
      maxConcurrency: 25,
      maxItemsPerInvocation: 5_000,
      maxInvocationMs: 45_000,
      schedulerIntervalMs: 60_000,
      drainBeforeMaintenance: true,
      recoveryRunScanLimit: 25,
      recoveryBeforeMaintenance: true,
    },
    counts: {
      realUsers: 2,
      openJobs: 17,
      eligibleOwners: 2,
      activeOwners: 2,
      completeActiveOwners: 2,
      duplicateActiveOwners: 0,
      incompleteActiveOwners: 0,
      visibleMissingDeterministic: 0,
      visibleMixedRevision: 0,
      nonterminalOpenItems: 0,
    },
    costAfter: {
      usageRows: 9,
      promptTokens: 120,
      outputTokens: 48,
      budgetDate: '2026-07-23',
      requestsToday: 9,
      updatedAt: '2026-07-23T04:00:00.000Z',
    },
    cloudflare: {
      id: 'deployment-deterministic',
      environment: 'production',
      status: 'success',
      branch: 'main',
      gitSha: RELEASE_SHA,
      url: 'https://deployment-deterministic.job-helper-qs9.pages.dev',
    },
    asset: {
      path: '/assets/index-deterministic.js',
      localSha256: ASSET_SHA,
      liveSha256: ASSET_SHA,
    },
    ...overrides,
  }
}

test('preflight accepts exact schema, functions, empty deterministic state, and cost baseline', () => {
  const parsed = validateEvidenceText('preflight', evidenceText(preflight()))
  assert.doesNotThrow(() => verifyPreflightEvidence(parsed.fields, preflightProbes()))
})

test('parser fails closed on missing, malformed, duplicate, and unknown evidence', () => {
  const missing = preflight()
  delete missing.cost_baseline_sha256
  assert.throws(
    () => validateEvidenceText('preflight', evidenceText(missing)),
    /missing field: cost_baseline_sha256/,
  )
  assert.throws(
    () => validateEvidenceText(
      'preflight',
      `${evidenceText(preflight()).replace('<!-- evidence:end -->', '')}\nfull_tests: pass\n<!-- evidence:end -->`,
    ),
    /duplicate field: full_tests/,
  )
  assert.throws(
    () => validateEvidenceText('preflight', evidenceText(preflight({ open_job_count: '-1' }))),
    /open_job_count is malformed/,
  )
  assert.throws(
    () => validateEvidenceText('preflight', evidenceText(preflight({ surprise: 'true' }))),
    /unknown field: surprise/,
  )
})

test('preflight rejects migration, function, owner-count, cost, or transition drift', () => {
  assert.throws(
    () => verifyPreflightEvidence(
      preflight(),
      preflightProbes({ remoteMigrations: MIGRATIONS.slice(0, -1) }),
    ),
    /remote migration inventory mismatch/,
  )
  assert.throws(
    () => verifyPreflightEvidence(
      preflight(),
      preflightProbes({
        scoreTick: { ...preflightProbes().scoreTick, verifyJwt: true },
      }),
    ),
    /score-tick verify_jwt mismatch/,
  )
  assert.throws(
    () => verifyPreflightEvidence(
      preflight(),
      preflightProbes({
        counts: { ...preflightProbes().counts, realUsers: 3 },
      }),
    ),
    /real user count mismatch/,
  )
  assert.throws(
    () => verifyPreflightEvidence(
      preflight(),
      preflightProbes({
        cost: { ...preflightProbes().cost, requestsToday: 10 },
      }),
    ),
    /score budget requests mismatch/,
  )
  assert.throws(
    () => verifyPreflightEvidence(preflight({ retry_transition: 'fail' }), preflightProbes()),
    /retry_transition must equal pass/,
  )
})

test('initializer authority must be postgres-owned, definer, closed, and service-only', () => {
  const authority = {
    owner: 'postgres',
    securityDefiner: true,
    searchPath: '',
    executeRoles: ['postgres', 'service_role'],
    maxBatch: 25,
    initialUnique: true,
    ordinaryQueue: true,
  }
  assert.doesNotThrow(() => assertInitializerAuthority(authority))
  for (const drift of [
    { owner: 'service_role' },
    { securityDefiner: false },
    { searchPath: 'public' },
    { executeRoles: ['authenticated', 'postgres', 'service_role'] },
    { maxBatch: 26 },
    { initialUnique: false },
    { ordinaryQueue: false },
  ]) {
    assert.throws(() => assertInitializerAuthority({ ...authority, ...drift }))
  }
})

test('worker liveness source is bounded below scheduler cadence and drains before maintenance', () => {
  const source = `
    const CLAIM_BATCH_SIZE = 25
    const MAX_CONCURRENCY = 25
    const MAX_ITEMS_PER_INVOCATION = 5_000
    const MAX_INVOCATION_MS = 45_000
    const RECOVERY_RUN_SCAN_LIMIT = 25
    let rows = await claimWork(admin)
    if (rows.length === 0) {
      recovery = await recoverOrphanedRuns(admin, startedAt)
      rows = await claimWork(admin)
      if (rows.length === 0) {
        await runMaintenance(admin)
        rows = await claimWork(admin)
      }
    }
    while (rows.length > 0) {
      rows = await claimWork(admin)
    }
  `
  assert.deepEqual(
    inspectWorkerLivenessSource(source, {
      count: 1,
      expression: '* * * * *',
      active: true,
      intervalMs: 60_000,
    }),
    {
      claimBatchSize: 25,
      maxConcurrency: 25,
      maxItemsPerInvocation: 5_000,
      maxInvocationMs: 45_000,
      schedulerIntervalMs: 60_000,
      drainBeforeMaintenance: true,
      recoveryRunScanLimit: 25,
      recoveryBeforeMaintenance: true,
    },
  )
  assert.throws(
    () => inspectWorkerLivenessSource(
      source.replace(
        'let rows = await claimWork(admin)',
        'await runMaintenance(admin)\nlet rows = await claimWork(admin)',
      ),
      {
        count: 1,
        expression: '* * * * *',
        active: true,
        intervalMs: 60_000,
      },
    ),
    /drain existing work before bounded maintenance/,
  )
})

test('worker recovery source is bounded and ordered before maintenance', () => {
  const source = `
    const CLAIM_BATCH_SIZE = 25
    const MAX_CONCURRENCY = 25
    const MAX_ITEMS_PER_INVOCATION = 5_000
    const MAX_INVOCATION_MS = 45_000
    const RECOVERY_RUN_SCAN_LIMIT = 25
    let rows = await claimWork(admin)
    if (rows.length === 0) {
      recovery = await recoverOrphanedRuns(admin, startedAt)
      rows = await claimWork(admin)
      if (rows.length === 0) {
        await runMaintenance(admin)
        rows = await claimWork(admin)
      }
    }
    while (rows.length > 0) {
      rows = await claimWork(admin)
    }
  `
  const schedule = {
    count: 1,
    expression: '* * * * *',
    active: true,
    intervalMs: 60_000,
  }

  assert.throws(
    () => inspectWorkerLivenessSource(
      source.replace(
        'recovery = await recoverOrphanedRuns(admin, startedAt)',
        'recovery = { scanned: 0, attempted: 0, finalized: 0 }',
      ),
      schedule,
    ),
    /drain existing work before bounded maintenance/,
  )
  assert.throws(
    () => inspectWorkerLivenessSource(
      source.replace(
        'const RECOVERY_RUN_SCAN_LIMIT = 25',
        'const RECOVERY_RUN_SCAN_LIMIT = 26',
      ),
      schedule,
    ),
    /liveness bounds drifted/,
  )
})

test('preflight rejects a live owner/job universe above the hard worker item bound', () => {
  const fields = preflight({ open_job_count: '3000' })
  const probes = preflightProbes({
    counts: { ...preflightProbes().counts, openJobs: 3_000 },
  })
  assert.throws(
    () => verifyPreflightEvidence(fields, probes),
    /worker item bound does not cover the approved owner\/job universe/,
  )
})

test('initializer rejects missing approval and exact SHA or inventory drift before RPC', async () => {
  const calls = []
  const adapters = backfillAdapters({ calls })
  await assert.rejects(
    () => runApprovedBackfill({}, adapters),
    /approved SHA is required/,
  )
  await assert.rejects(
    () => runApprovedBackfill(approval({ approvedSha: '9'.repeat(40) }), adapters),
    /approved SHA mismatch/,
  )
  await assert.rejects(
    () => runApprovedBackfill(approval({ approvedInventorySha256: '8'.repeat(64) }), adapters),
    /approved inventory mismatch/,
  )
  assert.deepEqual(calls, [])
})

test('initializer uses only batch 25 and ordinary worker draining until no owners remain', async () => {
  const calls = []
  const batches = [
    { initialized_count: 2, seeded_count: 17, remaining_count: 0 },
  ]
  const result = await runApprovedBackfill(
    approval(),
    backfillAdapters({ calls, batches }),
  )
  assert.deepEqual(calls, [
    ['initialize', 25],
    ['tick'],
    ['tick'],
  ])
  assert.deepEqual(result, {
    initializedOwners: 2,
    seededItems: 17,
    workerTicks: 2,
    remainingUsers: 0,
  })
})

test('initializer invokes one bounded empty recovery tick for a terminal orphan', async () => {
  const calls = []
  const result = await runApprovedBackfill(
    approval(),
    backfillAdapters({
      calls,
      batches: [{ initialized_count: 0, seeded_count: 0, remaining_count: 0 }],
      queueStates: [
        { pending: 0, claimed: 0, failed: 0, duplicateOwners: 0 },
        { pending: 0, claimed: 0, failed: 0, duplicateOwners: 0 },
      ],
      finalStates: [
        {
          remainingUsers: 0,
          activeOwners: 2,
          completeActiveOwners: 1,
          duplicateActiveOwners: 0,
          incompleteActiveOwners: 1,
          visibleMissingDeterministic: 0,
          visibleMixedRevision: 0,
          nonterminalOpenItems: 0,
        },
        {
          remainingUsers: 0,
          activeOwners: 2,
          completeActiveOwners: 2,
          duplicateActiveOwners: 0,
          incompleteActiveOwners: 0,
          visibleMissingDeterministic: 0,
          visibleMixedRevision: 0,
          nonterminalOpenItems: 0,
        },
      ],
    }),
  )

  assert.deepEqual(calls, [
    ['initialize', 25],
    ['tick'],
  ])
  assert.equal(result.workerTicks, 1)
})

test('initializer polls bounded claimed leases instead of spinning', async () => {
  const calls = []
  const result = await runApprovedBackfill(
    approval(),
    backfillAdapters({
      calls,
      batches: [{ initialized_count: 0, seeded_count: 0, remaining_count: 0 }],
      queueStates: [
        { pending: 0, claimed: 23, failed: 0, duplicateOwners: 0 },
        { pending: 0, claimed: 23, failed: 0, duplicateOwners: 0 },
        { pending: 0, claimed: 0, failed: 0, duplicateOwners: 0 },
      ],
      ticks: [
        { claimed: 0, failed: 0 },
        { claimed: 23, failed: 0 },
      ],
    }),
  )

  assert.deepEqual(calls, [
    ['initialize', 25],
    ['tick'],
    ['wait', 5_000],
    ['tick'],
  ])
  assert.equal(result.workerTicks, 2)
})

test('initializer refuses recovery on failed, mixed, or nonterminal final state', async () => {
  for (const drift of [
    { duplicateActiveOwners: 1 },
    { visibleMixedRevision: 1 },
    { visibleMissingDeterministic: 1 },
    { nonterminalOpenItems: 1 },
  ]) {
    const calls = []
    await assert.rejects(
      () => runApprovedBackfill(
        approval(),
        backfillAdapters({
          calls,
          batches: [{ initialized_count: 0, seeded_count: 0, remaining_count: 0 }],
          queueStates: [
            { pending: 0, claimed: 0, failed: 0, duplicateOwners: 0 },
          ],
          finalStates: [{
            remainingUsers: 0,
            activeOwners: 2,
            completeActiveOwners: 1,
            duplicateActiveOwners: 0,
            incompleteActiveOwners: 1,
            visibleMissingDeterministic: 0,
            visibleMixedRevision: 0,
            nonterminalOpenItems: 0,
            ...drift,
          }],
        }),
      ),
    )
    assert.deepEqual(calls, [['initialize', 25]])
  }
})

test('initializer rejects over-25 responses, duplicate owners, partial progress, and cost drift', async () => {
  await assert.rejects(
    () => runApprovedBackfill(
      approval(),
      backfillAdapters({
        batches: [{ initialized_count: 26, seeded_count: 17, remaining_count: 0 }],
      }),
    ),
    /initializer response exceeds 25-owner bound/,
  )
  await assert.rejects(
    () => runApprovedBackfill(
      approval(),
      backfillAdapters({ duplicateOwners: 1 }),
    ),
    /duplicate initial owner runs/,
  )
  await assert.rejects(
    () => runApprovedBackfill(
      approval(),
      backfillAdapters({
        batches: [{ initialized_count: 0, seeded_count: 0, remaining_count: 1 }],
      }),
    ),
    /initializer made no progress/,
  )
  await assert.rejects(
    () => runApprovedBackfill(
      approval(),
      backfillAdapters({ costAfter: '7'.repeat(64) }),
    ),
    /score-purpose cost baseline changed/,
  )
})

test('initializer propagates command, API, authentication, and malformed response failures', async () => {
  for (const error of [
    new Error('command failed'),
    new Error('API request failed: 500'),
    new Error('authentication failed: 401'),
  ]) {
    await assert.rejects(
      () => runApprovedBackfill(approval(), backfillAdapters({ initializerError: error })),
      error,
    )
  }
  await assert.rejects(
    () => runApprovedBackfill(
      approval(),
      backfillAdapters({ batches: [{ initialized_count: 'two' }] }),
    ),
    /initializer response is malformed/,
  )
})

test('active coverage permits only completed historical surplus for jobs that are now closed', () => {
  const coverage = summarizeActiveCoverageRows([activeCoverageOwner({
    current_open_jobs: 17,
    exact_current_open_results: 17,
    historical_closed_completed_items: 1,
  })])

  assert.deepEqual(coverage, {
    remainingUsers: 0,
    activeOwners: 1,
    completeActiveOwners: 1,
    duplicateActiveOwners: 0,
    incompleteActiveOwners: 0,
    visibleMissingDeterministic: 0,
    visibleMixedRevision: 0,
    nonterminalOpenItems: 0,
  })
})

test('active coverage rejects missing current-open results', () => {
  const coverage = summarizeActiveCoverageRows([activeCoverageOwner({
    current_open_jobs: 17,
    exact_current_open_results: 16,
    missing_current_open_results: 1,
    visible_missing_deterministic: 1,
  })])

  assert.equal(coverage.completeActiveOwners, 0)
  assert.equal(coverage.incompleteActiveOwners, 1)
  assert.equal(coverage.visibleMissingDeterministic, 1)
})

test('active coverage rejects duplicate, mixed, nonterminal, and surplus open results', () => {
  for (const overrides of [
    { duplicate_current_open_results: 1 },
    { mixed_active_items: 1, visible_mixed_revision: 1 },
    { nonterminal_active_items: 1, nonterminal_open_items: 1 },
    { failed_active_items: 1 },
    { surplus_open_items: 1 },
    { invalid_closed_surplus_items: 1 },
  ]) {
    const coverage = summarizeActiveCoverageRows([activeCoverageOwner(overrides)])
    assert.equal(coverage.completeActiveOwners, 0)
    assert.equal(coverage.incompleteActiveOwners, 1)
  }
})

test('post-release rejects partial, mixed, missing deterministic, identity, asset, and cost evidence', () => {
  assert.doesNotThrow(() => verifyPostReleaseEvidence(postRelease(), postReleaseProbes()))
  for (const [field, value, expected] of [
    ['incomplete_active_owner_count', '1', /incomplete active owners must equal 0/],
    ['visible_mixed_revision_count', '1', /visible mixed revisions must equal 0/],
    ['visible_missing_deterministic_count', '1', /visible missing deterministic rows must equal 0/],
    ['nonterminal_open_item_count', '1', /nonterminal open items must equal 0/],
    ['score_budget_requests_after', '10', /score budget requests changed/],
    ['score_usage_row_count_after', '10', /score usage row count changed/],
    ['live_asset_sha256', '4'.repeat(64), /evidence asset hashes must match/],
  ]) {
    assert.throws(
      () => verifyPostReleaseEvidence(postRelease({ [field]: value }), postReleaseProbes()),
      expected,
    )
  }
  assert.throws(
    () => verifyPostReleaseEvidence(
      postRelease(),
      postReleaseProbes({ originGitSha: '9'.repeat(40) }),
    ),
    /origin\/main Git SHA mismatch/,
  )
})

test('automatic entry points contain no score-purpose AI capability and extraction stays separate', () => {
  assert.doesNotThrow(() => verifyAutomaticEntryPoints({
    scoreTick: `
      request.headers.get('x-cron-secret')
      admin.rpc('claim_deterministic_ranking_work')
      admin.rpc('stage_deterministic_ranking_result')
      admin.rpc('finalize_deterministic_ranking_run')
    `,
    extractResume: `
      const purpose = 'extract'
      admin.rpc('request_deterministic_route_refresh')
    `,
    preferenceSave: `rpc('save_preferences_and_start_ranking')`,
    retry: `rpc('retry_deterministic_ranking_run')`,
    maintenance: `
      enqueue_deterministic_new_jobs
      enqueue_deterministic_recency_refresh
      enqueue_deterministic_route_refreshes
    `,
  }))
  assert.throws(
    () => verifyAutomaticEntryPoints({
      scoreTick: `reserve_score_request(); createOpenAIProvider()`,
      extractResume: `const purpose = 'extract'`,
      preferenceSave: `save_preferences_and_start_ranking`,
      retry: `retry_deterministic_ranking_run`,
      maintenance: `enqueue_deterministic_new_jobs`,
    }),
    /score-tick exposes forbidden automatic scoring capability/,
  )
  assert.throws(
    () => verifyAutomaticEntryPoints({
      scoreTick: `
        x-cron-secret
        claim_deterministic_ranking_work
        stage_deterministic_ranking_result
        finalize_deterministic_ranking_run
      `,
      extractResume: `purpose = 'score'`,
      preferenceSave: `save_preferences_and_start_ranking`,
      retry: `retry_deterministic_ranking_run`,
      maintenance: `
        enqueue_deterministic_new_jobs
        enqueue_deterministic_recency_refresh
        enqueue_deterministic_route_refreshes
      `,
    }),
    /extract-resume is not extraction-only/,
  )
})

function activeCoverageOwner(overrides = {}) {
  return {
    active_owner_ready: 1,
    active_revision: 1,
    current_open_jobs: 17,
    exact_current_open_results: 17,
    missing_current_open_results: 0,
    duplicate_current_open_results: 0,
    visible_missing_deterministic: 0,
    visible_mixed_revision: 0,
    nonterminal_active_items: 0,
    nonterminal_open_items: 0,
    failed_active_items: 0,
    mixed_active_items: 0,
    surplus_open_items: 0,
    invalid_closed_surplus_items: 0,
    historical_closed_completed_items: 0,
    initial_run_count: 1,
    ...overrides,
  }
}

function approval(overrides = {}) {
  return {
    approvedSha: RELEASE_SHA,
    approvedInventorySha256: INVENTORY_SHA,
    approvedOwnerCount: 2,
    approvedOpenJobCount: 17,
    approvedCostBaselineSha256: COST_BASELINE_SHA,
    ...overrides,
  }
}

function backfillAdapters({
  calls = [],
  batches = [{ initialized_count: 2, seeded_count: 17, remaining_count: 0 }],
  duplicateOwners = 0,
  costAfter = COST_BASELINE_SHA,
  initializerError,
  queueStates,
  finalStates,
  ticks,
} = {}) {
  let batchIndex = 0
  let tickIndex = 0
  let queueIndex = 0
  let finalStateIndex = 0
  let configuredTickIndex = 0
  return {
    async preflight() {
      return {
        gitSha: RELEASE_SHA,
        inventorySha256: INVENTORY_SHA,
        ownerCount: 2,
        openJobCount: 17,
        costBaselineSha256: COST_BASELINE_SHA,
      }
    },
    async authority() {
      return {
        owner: 'postgres',
        securityDefiner: true,
        searchPath: '',
        executeRoles: ['postgres', 'service_role'],
        maxBatch: 25,
        initialUnique: true,
        ordinaryQueue: true,
      }
    },
    async initialize(batchSize) {
      calls.push(['initialize', batchSize])
      if (initializerError) throw initializerError
      return batches[Math.min(batchIndex++, batches.length - 1)]
    },
    async queueState() {
      if (queueStates) {
        return queueStates[Math.min(queueIndex++, queueStates.length - 1)]
      }
      const pending = tickIndex === 0 ? 17 : tickIndex === 1 ? 5 : 0
      return { pending, claimed: 0, failed: 0, duplicateOwners }
    },
    async tick() {
      calls.push(['tick'])
      tickIndex += 1
      if (ticks) {
        return ticks[Math.min(configuredTickIndex++, ticks.length - 1)]
      }
      return { claimed: tickIndex === 1 ? 12 : 5, failed: 0 }
    },
    async wait(milliseconds) {
      calls.push(['wait', milliseconds])
    },
    async costBaseline() {
      return tickIndex === 0 && batchIndex === 0 ? COST_BASELINE_SHA : costAfter
    },
    async finalState() {
      if (finalStates) {
        return finalStates[Math.min(finalStateIndex++, finalStates.length - 1)]
      }
      return {
        remainingUsers: 0,
        activeOwners: 2,
        completeActiveOwners: 2,
        duplicateActiveOwners: duplicateOwners,
        incompleteActiveOwners: 0,
        visibleMissingDeterministic: 0,
        visibleMixedRevision: 0,
        nonterminalOpenItems: 0,
      }
    },
  }
}

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  assertInitializerAuthority,
  runApprovedBackfill,
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
} = {}) {
  let batchIndex = 0
  let tickIndex = 0
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
      const pending = tickIndex === 0 ? 17 : tickIndex === 1 ? 5 : 0
      return { pending, claimed: 0, failed: 0, duplicateOwners }
    },
    async tick() {
      calls.push(['tick'])
      tickIndex += 1
      return { claimed: tickIndex === 1 ? 12 : 5, failed: 0 }
    },
    async costBaseline() {
      return tickIndex === 0 && batchIndex === 0 ? COST_BASELINE_SHA : costAfter
    },
    async finalState() {
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

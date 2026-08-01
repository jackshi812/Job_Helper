import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  REQUIRED_OPERATIONS,
  sha256Json,
} from '../rights-gate.mjs'
import {
  SPIKE_CONTRACT,
  runConditionalSpike,
} from './spike-runner.mjs'

const MATRIX_PATH =
  '.planning/phases/05-outreach-feasibility-gate/05-RIGHTS-MATRIX.json'
const committedMatrix = JSON.parse(await readFile(MATRIX_PATH, 'utf8'))
const NOW = new Date('2026-07-29T12:00:00.000Z')

function resignMatrix(matrix) {
  for (const source of matrix.sources) {
    const { evidence_sha256: _digest, ...body } = source
    source.evidence_sha256 = sha256Json(body)
  }
  const { rights_evidence_sha256: _digest, ...body } = matrix
  matrix.rights_evidence_sha256 = sha256Json(body)
  return matrix
}

function allAllowMatrix() {
  const matrix = structuredClone(committedMatrix)
  for (const operation of matrix.operations) {
    if (operation.required) operation.status = 'ALLOW'
  }
  return resignMatrix(matrix)
}

function authorization(matrix) {
  return {
    type: 'ACCEPT_RIGHTS',
    rights_evidence_sha256: matrix.rights_evidence_sha256,
  }
}

function injectedEffects() {
  const calls = []
  return {
    calls,
    readSecret: async () => {
      calls.push('readSecret')
      return Symbol('synthetic-secret')
    },
    createCorpus: async () => {
      calls.push('createCorpus')
      return Symbol('synthetic-corpus')
    },
    buildRequest: async () => {
      calls.push('buildRequest')
      return Symbol('synthetic-request')
    },
    fetchImpl: async () => {
      calls.push('fetchImpl')
      return Symbol('synthetic-response')
    },
  }
}

async function assertNoEffects(matrix, spikeAuthorization = null) {
  const effects = injectedEffects()
  const result = await runConditionalSpike({
    matrix,
    spikeAuthorization,
    now: NOW,
    readSecret: effects.readSecret,
    createCorpus: effects.createCorpus,
    buildRequest: effects.buildRequest,
    fetchImpl: effects.fetchImpl,
  })
  assert.deepEqual(result, {
    status: 'RIGHTS_NO_GO',
    search_authorized: false,
    production_outreach_enabled: false,
    spike_executed: false,
    quality_status: 'NOT_RUN_RIGHTS_NO_GO',
    provider_call_count: 0,
    fixture_count: 0,
    raw_result_count: 0,
    production_mutation_count: 0,
  })
  assert.deepEqual(effects.calls, [])
}

function assertDeeplyFrozen(value) {
  assert.equal(Object.isFrozen(value), true)
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) assertDeeplyFrozen(child)
  }
}

test('SPIKE_CONTRACT exactly preserves D-01 through D-08 and D-14 through D-16', () => {
  assert.deepEqual(SPIKE_CONTRACT, {
    schema_version: 1,
    phase: '05',
    state: 'NON_EXECUTABLE_RIGHTS_NO_GO',
    execution_policy: {
      executable: false,
      terminal_decisions: ['D-09', 'D-10', 'D-12', 'D-13'],
      outcome: 'NOT_RUN_RIGHTS_NO_GO',
    },
    cases: {
      total: 8,
      real: 6,
      controls: 2,
      min_companies: 3,
      max_cases_per_company: 2,
      required_role_families: ['risk_finance', 'software_technical'],
      control_kinds: ['known_positive', 'known_negative'],
    },
    input_boundary: {
      disposable_corpus_only: true,
      production_query_allowed: false,
      production_mutation_allowed: false,
    },
    quality_gate: {
      min_real_case_passes: 4,
      known_positive_must_be_found: true,
      known_negative_must_be_rejected: true,
    },
    qualifying_evidence: {
      current_company_required: true,
      meaningful_role_fit_required: true,
      shared_history_required: false,
    },
    request_budget: {
      max_physical_calls_per_case: 3,
      max_retries_per_case: 1,
      retries_inside_physical_call_cap: true,
      persistent_provider_or_evidence_failure: 'coverage_unknown',
    },
    fixture: {
      allowed_fields: [
        'case_label',
        'company',
        'job_title',
        'role_terms',
        'confirmed_academic_or_work_facts',
      ],
    },
    raw_response_lifecycle: {
      allowed_uses: ['labeling', 'owner_review'],
      transient_only: true,
      delete_before_sanitized_report: true,
    },
    committed_report: {
      case_fields: [
        'case_label',
        'outcome',
        'current_company_evidence',
        'meaningful_role_fit_evidence',
        'shared_history_evidence',
        'provider_query_count',
      ],
      aggregate_fields: [
        'real_case_pass_count',
        'known_positive_found',
        'known_negative_rejected',
        'coverage_unknown_count',
        'provider_call_count',
        'fixture_count',
        'raw_result_count',
        'production_mutation_count',
      ],
      outcomes: ['pass', 'no_match', 'coverage_unknown'],
      forbidden_fields: ['candidate_name', 'linkedin_url', 'source_snippet'],
    },
  })
  assertDeeplyFrozen(SPIKE_CONTRACT)
})

test('the committed RIGHTS_NO_GO matrix reaches no injected effect', async () => {
  await assertNoEffects(committedMatrix)
})

test('every required-row denial mutation remains no-run with zero effects', async () => {
  for (const operationName of REQUIRED_OPERATIONS) {
    const missing = allAllowMatrix()
    missing.operations = missing.operations.filter(
      (row) => row.operation !== operationName,
    )
    resignMatrix(missing)
    await assertNoEffects(missing, authorization(missing))
  }

  for (const status of ['PROHIBIT', 'AMBIGUOUS', 'NOT_APPLICABLE', 'allow']) {
    const denied = allAllowMatrix()
    denied.operations.find(
      (row) => row.operation === REQUIRED_OPERATIONS[0],
    ).status = status
    resignMatrix(denied)
    await assertNoEffects(denied, authorization(denied))
  }
})

test('stale and digest-drifted evidence remain no-run with zero effects', async () => {
  const stale = allAllowMatrix()
  stale.valid_until = '2026-07-28'
  resignMatrix(stale)
  await assertNoEffects(stale, authorization(stale))

  const drifted = allAllowMatrix()
  drifted.sources[0].short_paraphrase = `${drifted.sources[0].short_paraphrase} drift`
  await assertNoEffects(drifted, authorization(drifted))
})

test('digest-consistent chronology denials never reach injected effects', async (t) => {
  const cases = [
    {
      name: 'future research',
      mutate(matrix) {
        matrix.researched_at = '2026-07-30'
      },
    },
    {
      name: 'future retrieval',
      mutate(matrix) {
        matrix.sources[0].retrieved_at = '2026-07-29T12:00:00.001Z'
      },
    },
    {
      name: 'retrieval before research',
      mutate(matrix) {
        matrix.sources[0].retrieved_at = '2026-07-27T23:59:59.999Z'
      },
    },
    {
      name: 'retrieval after validity',
      mutate(matrix) {
        matrix.sources[0].retrieved_at = '2026-08-05T00:00:00.000Z'
      },
    },
    {
      name: 'eight-day validity horizon',
      mutate(matrix) {
        matrix.valid_until = '2026-08-05'
      },
    },
  ]

  for (const { name, mutate } of cases) {
    await t.test(name, async () => {
      const matrix = allAllowMatrix()
      mutate(matrix)
      resignMatrix(matrix)
      await assertNoEffects(matrix, authorization(matrix))
    })
  }
})

test('all-ALLOW evidence without exact structured authorization remains no-run', async () => {
  const matrix = allAllowMatrix()
  for (const deniedAuthorization of [
    null,
    'ACCEPT_RIGHTS',
    { type: 'ACCEPT_RIGHTS' },
    {
      type: 'ACCEPT_RIGHTS',
      rights_evidence_sha256: `${matrix.rights_evidence_sha256.slice(0, -1)}0`,
    },
    {
      ...authorization(matrix),
      owner_override: true,
    },
  ]) {
    await assertNoEffects(matrix, deniedAuthorization)
  }
})

test('all-ALLOW authorization cannot read capabilities or leave the terminal no-go', async () => {
  const matrix = allAllowMatrix()
  const observedProperties = []
  const input = {
    matrix,
    spikeAuthorization: authorization(matrix),
    now: NOW,
  }
  for (const property of [
    'readSecret',
    'createCorpus',
    'buildRequest',
    'fetchImpl',
    'productionMutation',
  ]) {
    Object.defineProperty(input, property, {
      enumerable: true,
      get() {
        observedProperties.push(property)
        throw new Error(`${property} must not be read`)
      },
    })
  }

  const result = await runConditionalSpike(input)

  assert.deepEqual(observedProperties, [])
  assert.deepEqual(result, {
    status: 'RIGHTS_NO_GO',
    search_authorized: false,
    production_outreach_enabled: false,
    spike_executed: false,
    quality_status: 'NOT_RUN_RIGHTS_NO_GO',
    provider_call_count: 0,
    fixture_count: 0,
    raw_result_count: 0,
    production_mutation_count: 0,
  })
})

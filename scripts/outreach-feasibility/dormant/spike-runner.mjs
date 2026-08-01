function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

export const SPIKE_CONTRACT = deepFreeze({
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

function noRunRecord() {
  return {
    status: 'RIGHTS_NO_GO',
    search_authorized: false,
    production_outreach_enabled: false,
    spike_executed: false,
    quality_status: 'NOT_RUN_RIGHTS_NO_GO',
    provider_call_count: 0,
    fixture_count: 0,
    raw_result_count: 0,
    production_mutation_count: 0,
  }
}

export function runConditionalSpike() {
  return noRunRecord()
}

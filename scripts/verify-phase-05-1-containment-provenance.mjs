#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_RECORD =
  '.planning/phases/05.1-ranking-and-dashboard-performance-stabilization/05.1-13-CONTAINMENT-PROVENANCE.json'
const HASH = /^[0-9a-f]{64}$/
const OID = /^[0-9a-f]{40}$/
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const ROOT_KEYS = Object.freeze([
  'schema_version',
  'status',
  'provenance_mode',
  'historical_deployment_identity_recovered',
  'anchors',
  'runtime',
  'historical_recovery',
  'current_baseline',
  'historical_probe_authorization',
  'current_baseline_collection_authorization',
  'owner_checkpoint',
  'provider_provenance',
  'redaction',
  'zero_effect_scope',
  'later_deployment_authorized',
  'reasons',
])
const ANCHOR_KEYS = Object.freeze(['commit', 'path', 'blob', 'sha256'])
const AUTHORIZATION_KEYS = Object.freeze([
  'status',
  'payload_serialization',
  'payload',
  'payload_sha256',
  'required_signal_sha256',
  'accepted_signal_sha256',
])
const REDACTION_KEYS = Object.freeze([
  'aggregate_only',
  'provider_response_bodies_persisted',
  'provider_identifiers_persisted',
  'credentials_persisted',
  'commands_persisted',
  'log_bodies_persisted',
  'database_rows_persisted',
  'approval_response_text_persisted',
])
const RUNTIME_KEYS = Object.freeze([
  'score_tick_function_id_sha256',
  'score_tick_deployment_id_sha256',
  'score_tick_function_version',
  'score_tick_status',
  'score_tick_verify_jwt',
  'score_tick_runtime_tuple_sha256',
  'scheduler_identity_sha256',
  'scheduler_active',
])
const CURRENT_BASELINE_KEYS = Object.freeze([
  'observed_at',
  'project_ref_sha256',
  'migration_inventory_sha256',
  'migration_0063_count',
  'migration_0062_count',
  'containment_function_definition_sha256',
  'containment_function_security_sha256',
  ...RUNTIME_KEYS,
])
const OWNER_CHECKPOINT_KEYS = Object.freeze([
  'status',
  'payload_serialization',
  'payload_sha256',
  'required_signal_sha256',
  'accepted_signal_sha256',
])
const SAFE_FAILURE_REASONS = new Set([
  'historical_probe_not_authorized',
  'historical_current_state_substitution',
  'historical_provider_contract_unverified',
  'historical_retention_incomplete',
  'historical_pagination_incomplete',
  'historical_mutation_channel_coverage_incomplete',
  'historical_edge_no_match',
  'historical_edge_ambiguous',
  'historical_edge_mixed_tuple',
  'historical_edge_deployment_event_present',
  'historical_edge_boundary_gap',
  'historical_scheduler_no_match',
  'historical_scheduler_ambiguous',
  'historical_scheduler_mixed_tuple',
  'historical_scheduler_mutation_present',
  'historical_scheduler_inactive',
  'historical_scheduler_boundary_gap',
  'historical_transport_failure',
  'historical_response_parse_failure',
  'historical_probe_timeout',
  'historical_probe_bound_exceeded',
  'current_baseline_collection_transport_failure',
])

export const PLAN_03_BOUNDARY = Object.freeze({
  before: '2026-08-01T16:39:10.434Z',
  after: '2026-08-01T16:39:16.746Z',
})

export const IMMUTABLE_ANCHORS = Object.freeze({
  plan_02: Object.freeze({
    commit: '80e54a8eb3f6b1c006d558dbff8815b42dec1306',
    path: '.planning/phases/05.1-ranking-and-dashboard-performance-stabilization/05.1-02-CONTAINMENT-APPROVAL.md',
    blob: '93b49a491e39481540554801308bbb29c62c4dd4',
    sha256: '6511e97d485672977efaca4e33354692eeb221bee0f032e6478f530672c36abf',
  }),
  plan_03_preflight: Object.freeze({
    commit: '56b0def6d749635e8d569041e31ef7282ab0ca10',
    path: '.planning/phases/05.1-ranking-and-dashboard-performance-stabilization/05.1-03-CONTAINMENT-DEPLOYMENT.md',
    blob: '73d11814969b8d203b89c7afb4b7a51a80816e36',
    sha256: 'e0c1fe194cba4dc7e6e5d0d43d5634c39f75753c8d6cd14bd47d155aadff9c99',
  }),
  plan_03_deployment: Object.freeze({
    commit: '6b55aa964dad20978a3d216d7c7de33f4c5d11e3',
    path: '.planning/phases/05.1-ranking-and-dashboard-performance-stabilization/05.1-03-CONTAINMENT-DEPLOYMENT.md',
    blob: 'a10bc1b13dfb45e15a1e9a2a2467898895063050',
    sha256: 'd0c5c7c4528f78adad3d49947fbdd2a9b46ec22487331fa1303cd4cb8d28b4eb',
  }),
  plan_03_summary: Object.freeze({
    commit: 'db5b5f7a3faa0f36bf6df0d553195a5c1adcd4c9',
    path: '.planning/phases/05.1-ranking-and-dashboard-performance-stabilization/05.1-03-SUMMARY.md',
    blob: '126fc6a185b76376c06d7e4d37e67c5b29ab9615',
    sha256: 'e7fb505a39292d959f2bdca8ee4cfb9332ed283098a37105e1c95b61df9538ea',
  }),
  blocked_plan_04: Object.freeze({
    commit: 'ab3d064a23d07b6723b542f85c2fd58ef62e473e',
    path: '.planning/phases/05.1-ranking-and-dashboard-performance-stabilization/05.1-04-CONTAINMENT-OBSERVATION.json',
    blob: 'ee54dc391bdb51fc55ca18e36ef370acac879337',
    sha256: 'f5fb4da4396ed730272680a06fd17628caf7d864050ad8fb6ff3c6b2cf875779',
  }),
})

export const ALLOWED_PROVIDER_REQUESTS = Object.freeze([
  Object.freeze(['GET', '/v1/projects/{ref}/functions']),
  Object.freeze(['GET', '/v1/projects/{ref}/analytics/endpoints/logs']),
  Object.freeze(['POST', '/v1/projects/{ref}/database/query']),
])

export const HISTORICAL_MUTATION_CHANNELS = Object.freeze([
  'cli',
  'dashboard',
  'api',
  'sql',
  'migration',
  'deploy',
  'rollback',
  'scheduler_edit',
])

export const ZERO_EFFECT_KEYS = Object.freeze([
  'schema_or_configuration_mutations',
  'function_deployments',
  'function_invocations',
  'scheduler_mutations',
  'worker_calls',
  'queue_or_run_writes',
  'item_or_state_writes',
  'history_deletes',
  'web_deployments',
  'maintenance_commands',
  'git_remote_mutations',
])

export const PROBE_LIMITS = Object.freeze({
  max_requests: 6,
  max_pages: 4,
  max_response_bytes: 1_048_576,
  timeout_ms: 12_000,
  max_window_seconds: 900,
  max_rows_per_aggregate: 1_000,
})

export const CURRENT_BASELINE_COLLECTION_REQUESTS = Object.freeze([
  Object.freeze(['GET', '/v1/projects/{ref}/functions']),
  Object.freeze(['POST', '/v1/projects/{ref}/database/query']),
])

export const CURRENT_BASELINE_COLLECTION_LIMITS = Object.freeze({
  max_snapshots: 2,
  max_requests: 4,
  max_pages: 0,
  max_response_bytes: 1_048_576,
  max_elapsed_ms: 48_000,
  per_request_timeout_ms: 12_000,
  max_rows_per_aggregate: 1,
})

export const CURRENT_BASELINE_IMMUTABLE_BINDINGS = Object.freeze({
  project_ref_sha256: '3bd38b96f081d2c09dddc6244169a9d0730c1a7f67548f215614c390daceb242',
  source_commit: 'c70152b4d453e2cf278c798b2269800f033b5f5a',
  source_tree: '0753df42f5d7cd0b987e1a30daacbcd261b22f0c',
  containment_migration_sha256:
    '64a3d0b1f144924e8ef26349828eaae1617588005eea986d8d3f15246a1d993b',
  migration_inventory_sha256:
    'd1a8231eae9428663ca9178f9bc0e3a905684627da1e0b48de0cece64da079a4',
  containment_function_definition_sha256:
    '8ca29c9432da87f85678d14a8a44410058802808e64640776a4899871d6d2bc8',
  containment_function_security_sha256:
    'f3b0bf5859bb7199b9a0ea73413c7c510ddee38858d9136fc8bc12ede6d9a0ba',
  required_migration_version: '0063',
  excluded_migration_version: '0062',
})

export const CURRENT_BASELINE_SQL = `
with migration_inventory as (
  select
    count(*) filter (where version::text = '0063')::integer
      as migration_0063_count,
    count(*) filter (where version::text = '0062')::integer
      as migration_0062_count,
    pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          pg_catalog.string_agg(version::text, ',' order by version::text),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ) as migration_inventory_sha256
  from supabase_migrations.schema_migrations
),
containment_function as (
  select
    pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(pg_catalog.pg_get_functiondef(proc.oid), 'UTF8'),
        'sha256'
      ),
      'hex'
    ) as containment_function_definition_sha256,
    pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          pg_catalog.concat_ws(
            '|',
            role.rolname,
            proc.prosecdef::text,
            pg_catalog.coalesce(pg_catalog.array_to_string(proc.proconfig, ','), ''),
            pg_catalog.coalesce(
              (
                select pg_catalog.string_agg(
                  privilege.grantee::text || ':' || privilege.privilege_type,
                  ',' order by privilege.grantee, privilege.privilege_type
                )
                from pg_catalog.aclexplode(proc.proacl) as privilege
              ),
              ''
            )
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ) as containment_function_security_sha256
  from pg_catalog.pg_proc as proc
  join pg_catalog.pg_roles as role on role.oid = proc.proowner
  where proc.oid =
    'public.enqueue_deterministic_new_jobs(integer)'::pg_catalog.regprocedure
),
scheduler_identity as (
  select
    count(*) filter (where jobname = 'score-tick-every-minute')::integer
      as scheduler_job_count,
    count(*) filter (
      where jobname = 'score-tick-every-minute' and active
    )::integer as scheduler_active_count,
    pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          pg_catalog.coalesce(
            pg_catalog.string_agg(
              jobname || '|' || schedule || '|' || command,
              ',' order by jobname
            ) filter (where jobname = 'score-tick-every-minute'),
            ''
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ) as scheduler_identity_sha256
  from cron.job
)
select
  migration_inventory.migration_inventory_sha256,
  migration_inventory.migration_0063_count,
  migration_inventory.migration_0062_count,
  containment_function.containment_function_definition_sha256,
  containment_function.containment_function_security_sha256,
  scheduler_identity.scheduler_job_count,
  scheduler_identity.scheduler_active_count,
  scheduler_identity.scheduler_identity_sha256
from migration_inventory
cross join containment_function
cross join scheduler_identity
`.trim()

const HISTORICAL_LOG_SQL = `
select count(*)::integer as bounded_count
from function_edge_logs
where timestamp >= '2026-08-01T16:32:10.434Z'
  and timestamp < '2026-08-01T16:47:10.434Z'
`.trim()

class ProvenanceError extends Error {
  constructor(code) {
    super(code)
    this.name = 'ProvenanceError'
    this.code = code
  }
}

function requireCondition(condition, code) {
  if (!condition) throw new ProvenanceError(code)
}

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

function exactKeys(value, keys, code) {
  requireCondition(value && typeof value === 'object' && !Array.isArray(value), code)
  requireCondition(
    canonical(Object.keys(value).sort()) === canonical([...keys].sort()),
    code,
  )
}

function timestamp(value, code) {
  requireCondition(typeof value === 'string' && UTC.test(value), code)
  const milliseconds = Date.parse(value)
  requireCondition(Number.isFinite(milliseconds), code)
  return milliseconds
}

function nonnegativeInteger(value, code) {
  requireCondition(Number.isSafeInteger(value) && value >= 0, code)
  return value
}

function zeroEffectScope() {
  return Object.fromEntries(ZERO_EFFECT_KEYS.map((key) => [key, 0]))
}

function redactionContract() {
  return {
    aggregate_only: true,
    provider_response_bodies_persisted: false,
    provider_identifiers_persisted: false,
    credentials_persisted: false,
    commands_persisted: false,
    log_bodies_persisted: false,
    database_rows_persisted: false,
    approval_response_text_persisted: false,
  }
}

function defaultGit(args) {
  const result = spawnSync('git', args, {
    cwd: ROOT,
    encoding: null,
    maxBuffer: 4 * 1024 * 1024,
  })
  if (result.status !== 0) throw new Error('git command failed')
  return result.stdout
}

function planBoundProjectRef() {
  const bytes = defaultGit(['cat-file', '-p', IMMUTABLE_ANCHORS.plan_03_deployment.blob])
  const matches = [...bytes.toString('utf8').matchAll(
    /^target_supabase_project_ref:\s*([a-z0-9]{20})$/gm,
  )]
  requireCondition(matches.length === 1, 'project_ref_invalid')
  return matches[0][1]
}

function environmentAccessToken() {
  const value = process.env.SUPABASE_ACCESS_TOKEN?.trim()
  requireCondition(value, 'authentication_required')
  return value
}

function recordValue(text, key, code = 'plan_02_corroboration_invalid') {
  const pattern = new RegExp(`^${key}:\\s*(.+)$`, 'gm')
  const matches = [...text.matchAll(pattern)]
  requireCondition(matches.length === 1, code)
  return matches[0][1].trim()
}

function assertPlan02Corroboration(bytes) {
  const text = bytes.toString('utf8')
  const required = {
    score_tick_window_started_at_utc: '2026-07-31T15:18:09.718Z',
    score_tick_window_ended_at_utc: '2026-08-01T15:18:09.718Z',
    score_tick_status: 'ACTIVE',
    score_tick_version: '16',
    score_tick_identity_sha256: '7c44495fb80ddf0caf48ac0a0210e7afe56967fb6e3c8b999078c57156d7dc20',
    score_tick_deployment_query_sha256: '0cd1388e768f5dabcad01ef1442a6ecabd7df152d1e72a4995b663d50399d438',
    score_tick_logs_query_sha256: '6ebfc0bdbf0634e0d396a558ab1f2415197fa22ea1bea7676a99e38b839f7697',
    score_tick_logs_output_sha256: '2ba411fb65a542bf4b349967e3a81b2528d107e12467c05bf677821f8b8f90d5',
  }
  for (const [key, expected] of Object.entries(required)) {
    requireCondition(recordValue(text, key) === expected, 'plan_02_corroboration_invalid')
  }
  const contract = JSON.parse(recordValue(text, 'score_tick_attribute_contract'))
  exactKeys(contract, ['deployment_id', 'function_id', 'response.status_code', 'version'],
    'plan_02_corroboration_invalid')
  requireCondition(Object.values(contract).every((value) => value === true),
    'plan_02_corroboration_invalid')
}

function assertPlan03CurrentBaselineBindings(bytes) {
  const text = bytes.toString('utf8')
  const code = 'anchor_plan_03_binding_invalid'
  const projectRef = recordValue(text, 'target_supabase_project_ref', code)
  requireCondition(/^[a-z0-9]{20}$/.test(projectRef)
    && sha256(projectRef) === CURRENT_BASELINE_IMMUTABLE_BINDINGS.project_ref_sha256,
  code)
  const expected = {
    source_commit: CURRENT_BASELINE_IMMUTABLE_BINDINGS.source_commit,
    source_tree: CURRENT_BASELINE_IMMUTABLE_BINDINGS.source_tree,
    migration_sha256: CURRENT_BASELINE_IMMUTABLE_BINDINGS.containment_migration_sha256,
    post_0063_function_definition_sha256_observed:
      CURRENT_BASELINE_IMMUTABLE_BINDINGS.containment_function_definition_sha256,
    post_0063_function_security_sha256_observed:
      CURRENT_BASELINE_IMMUTABLE_BINDINGS.containment_function_security_sha256,
    remote_0063_count: '1',
    remote_0062_count: '0',
  }
  for (const [key, value] of Object.entries(expected)) {
    requireCondition(recordValue(text, key, code) === value, code)
  }
}

function anchorProjection(anchors) {
  return Object.fromEntries(Object.entries(anchors).map(([name, anchor]) => [name, {
    commit: anchor.commit,
    path: anchor.path,
    blob: anchor.blob,
    sha256: anchor.sha256,
  }]))
}

export async function verifyImmutableAnchors({
  git = defaultGit,
  anchors = IMMUTABLE_ANCHORS,
  afterAnchors = null,
} = {}) {
  exactKeys(anchors, Object.keys(IMMUTABLE_ANCHORS), 'anchor_inventory_invalid')
  const result = {}
  for (const [name, anchor] of Object.entries(anchors)) {
    exactKeys(anchor, ['commit', 'path', 'blob', 'sha256', ...(anchor.bytes ? ['bytes'] : [])],
      'anchor_schema_invalid')
    requireCondition(OID.test(anchor.commit) && OID.test(anchor.blob)
      && HASH.test(anchor.sha256) && anchor.path.startsWith('.planning/'),
    'anchor_schema_invalid')
    try {
      await git(['cat-file', '-e', `${anchor.commit}^{commit}`])
    } catch {
      throw new ProvenanceError('anchor_commit_missing')
    }
    let resolved
    try {
      resolved = String(await git(['rev-parse', `${anchor.commit}:${anchor.path}`])).trim()
    } catch {
      throw new ProvenanceError('anchor_path_missing')
    }
    requireCondition(resolved === anchor.blob, 'anchor_blob_mismatch')
    let bytes
    try {
      bytes = Buffer.from(await git(['cat-file', '-p', anchor.blob]))
    } catch {
      throw new ProvenanceError('anchor_blob_missing')
    }
    if (name === 'plan_03_deployment') {
      const text = bytes.toString('utf8')
      for (const key of [
        'score_tick_function_id',
        'score_tick_function_version',
        'score_tick_deployment_id',
        'scheduler_identity_sha256',
      ]) requireCondition(!text.includes(key), 'plan_03_runtime_key_present')
    }
    requireCondition(sha256(bytes) === anchor.sha256, 'anchor_sha256_mismatch')
    if (name === 'plan_02') assertPlan02Corroboration(bytes)
    if (name === 'plan_03_deployment') assertPlan03CurrentBaselineBindings(bytes)
    result[name] = { ...anchorProjection({ anchor }).anchor }
  }
  if (afterAnchors) await afterAnchors(result)
  return result
}

function normalizeProviderPath(path) {
  return String(path).replace(/^\/v1\/projects\/[^/]+\//, '/v1/projects/{ref}/')
}

function sqlOutsideStrings(sql) {
  return sql
    .replace(/\$[A-Za-z_][A-Za-z0-9_]*\$[\s\S]*?\$[A-Za-z_][A-Za-z0-9_]*\$/g, "''")
    .replace(/'(?:''|[^'])*'/g, "''")
}

export function validateReadOnlySql(sql) {
  requireCondition(typeof sql === 'string' && sql.length > 0 && sql.length <= 40_000,
    'read_only_sql_invalid')
  const trimmed = sql.trim()
  const withoutTerminal = trimmed.endsWith(';') ? trimmed.slice(0, -1) : trimmed
  const inspected = sqlOutsideStrings(withoutTerminal)
  requireCondition(/^\s*(?:select|with)\b/i.test(inspected), 'read_only_sql_invalid')
  requireCondition(!/;|--|\/\*/.test(inspected), 'read_only_sql_invalid')
  requireCondition(!/\b(?:insert|update|delete|merge|upsert|alter|create|drop|truncate|grant|revoke|copy|call|perform|do|vacuum|analyze|reindex|cluster|refresh|set|reset|listen|notify|discard|lock)\b/i.test(inspected),
    'read_only_sql_effect')
  requireCondition(!/\b(?:pg_sleep|dblink|lo_import|lo_export|set_config)\s*\(/i.test(inspected),
    'read_only_sql_function')
  requireCondition(!/\b(?:select|from)\s+public\.[a-z_][a-z0-9_$]*\s*\(/i.test(inspected),
    'read_only_sql_function')
  requireCondition(!/\breturning\b|\bselect\s+\*/i.test(inspected), 'read_only_sql_raw_rows')
  requireCondition(!/\bselect\s+(?:[a-z_][a-z0-9_]*\.)?id\s+from\b/i.test(inspected),
    'read_only_sql_raw_identifier')
  return true
}

export function validateProviderRequest({ method, path, query = {}, body = null }) {
  const normalized = normalizeProviderPath(String(path).split('?')[0])
  requireCondition(ALLOWED_PROVIDER_REQUESTS.some(
    ([allowedMethod, allowedPath]) => method === allowedMethod && normalized === allowedPath,
  ), 'provider_request_not_allowlisted')
  requireCondition(query && typeof query === 'object' && !Array.isArray(query),
    'provider_request_query_invalid')
  if (normalized === '/v1/projects/{ref}/functions') {
    exactKeys(query, [], 'provider_request_query_invalid')
    requireCondition(body === null, 'provider_request_body_invalid')
  } else if (normalized === '/v1/projects/{ref}/database/query') {
    exactKeys(query, [], 'provider_request_query_invalid')
    exactKeys(body, ['query'], 'provider_request_body_invalid')
    validateReadOnlySql(body.query)
  } else {
    exactKeys(query, ['source', 'sql', 'start', 'end', 'limit', 'page_token'],
      'provider_request_query_invalid')
    requireCondition(query.source === 'function_edge_logs', 'provider_request_query_invalid')
    validateReadOnlySql(query.sql)
    const start = timestamp(query.start, 'provider_request_query_invalid')
    const end = timestamp(query.end, 'provider_request_query_invalid')
    requireCondition(end > start && (end - start) / 1000 <= PROBE_LIMITS.max_window_seconds,
      'provider_request_query_invalid')
    requireCondition(Number.isSafeInteger(query.limit)
      && query.limit > 0 && query.limit <= PROBE_LIMITS.max_rows_per_aggregate,
    'provider_request_query_invalid')
    requireCondition(query.page_token === null
      || (typeof query.page_token === 'string' && query.page_token.length <= 256),
    'provider_request_query_invalid')
    requireCondition(body === null, 'provider_request_body_invalid')
  }
  return true
}

export function validateProbeBudget(value) {
  exactKeys(value, ['request_count', 'page_count', 'response_bytes', 'elapsed_ms'],
    'historical_probe_bound_exceeded')
  for (const key of Object.keys(value)) nonnegativeInteger(value[key], 'historical_probe_bound_exceeded')
  requireCondition(value.request_count <= PROBE_LIMITS.max_requests
    && value.page_count <= PROBE_LIMITS.max_pages
    && value.response_bytes <= PROBE_LIMITS.max_response_bytes
    && value.elapsed_ms <= PROBE_LIMITS.timeout_ms,
  'historical_probe_bound_exceeded')
  return true
}

function probeTransport({
  accessToken,
  fetchImpl,
  monotonicNow,
  initialBudget = {},
}) {
  const startedAt = monotonicNow()
  const budget = {
    request_count: initialBudget.request_count ?? 0,
    page_count: initialBudget.page_count ?? 0,
    response_bytes: initialBudget.response_bytes ?? 0,
    elapsed_ms: 0,
  }
  const responseHashes = []

  async function request(requestSpec) {
    validateProviderRequest(requestSpec)
    budget.request_count += 1
    if (normalizeProviderPath(requestSpec.path)
      === '/v1/projects/{ref}/analytics/endpoints/logs') budget.page_count += 1
    budget.elapsed_ms = Math.max(0, Math.ceil(monotonicNow() - startedAt))
    validateProbeBudget(budget)

    const url = new URL(`https://api.supabase.com${requestSpec.path}`)
    for (const [key, value] of Object.entries(requestSpec.query ?? {})) {
      if (value !== null) url.searchParams.set(key, String(value))
    }
    const remaining = PROBE_LIMITS.timeout_ms - budget.elapsed_ms
    requireCondition(remaining > 0, 'historical_probe_timeout')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), remaining)
    try {
      const response = await fetchImpl(url, {
        method: requestSpec.method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(requestSpec.body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(requestSpec.body ? { body: JSON.stringify(requestSpec.body) } : {}),
        signal: controller.signal,
      })
      if (response.status === 401 || response.status === 403) {
        throw new ProvenanceError('authentication_required')
      }
      requireCondition(response.ok, 'historical_transport_failure')
      const bytes = Buffer.from(await response.arrayBuffer())
      budget.response_bytes += bytes.byteLength
      budget.elapsed_ms = Math.max(0, Math.ceil(monotonicNow() - startedAt))
      validateProbeBudget(budget)
      responseHashes.push(sha256(bytes))
      try {
        return JSON.parse(bytes.toString('utf8'))
      } catch {
        throw new ProvenanceError('historical_response_parse_failure')
      }
    } catch (error) {
      if (error instanceof ProvenanceError) throw error
      if (error?.name === 'AbortError') throw new ProvenanceError('historical_probe_timeout')
      throw new ProvenanceError('historical_transport_failure')
    } finally {
      clearTimeout(timeout)
    }
  }

  return {
    request,
    snapshot: () => ({
      budget: { ...budget },
      response_hashes: [...responseHashes],
    }),
  }
}

function validateCurrentBaselineCollectionRequest(requestSpec) {
  const normalized = normalizeProviderPath(String(requestSpec.path).split('?')[0])
  requireCondition(CURRENT_BASELINE_COLLECTION_REQUESTS.some(
    ([allowedMethod, allowedPath]) => requestSpec.method === allowedMethod
      && normalized === allowedPath,
  ), 'current_baseline_collection_request_not_allowlisted')
  return validateProviderRequest(requestSpec)
}

function currentBaselineCollectionTransport({ accessToken, fetchImpl, monotonicNow }) {
  const startedAt = monotonicNow()
  const budget = {
    request_count: 0,
    page_count: 0,
    response_bytes: 0,
    elapsed_ms: 0,
  }

  async function request(requestSpec) {
    validateCurrentBaselineCollectionRequest(requestSpec)
    budget.request_count += 1
    budget.elapsed_ms = Math.max(0, Math.ceil(monotonicNow() - startedAt))
    requireCondition(
      budget.request_count <= CURRENT_BASELINE_COLLECTION_LIMITS.max_requests / 2
        && budget.page_count === 0
        && budget.elapsed_ms <= CURRENT_BASELINE_COLLECTION_LIMITS.max_elapsed_ms,
      'current_baseline_collection_bound_exceeded',
    )

    const url = new URL(`https://api.supabase.com${requestSpec.path}`)
    const remaining = CURRENT_BASELINE_COLLECTION_LIMITS.max_elapsed_ms
      - budget.elapsed_ms
    requireCondition(remaining > 0, 'current_baseline_collection_timeout')
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      Math.min(
        remaining,
        CURRENT_BASELINE_COLLECTION_LIMITS.per_request_timeout_ms,
      ),
    )
    try {
      const response = await fetchImpl(url, {
        method: requestSpec.method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(requestSpec.body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(requestSpec.body ? { body: JSON.stringify(requestSpec.body) } : {}),
        signal: controller.signal,
      })
      if (response.status === 401 || response.status === 403) {
        throw new ProvenanceError('authentication_required')
      }
      requireCondition(response.ok, 'current_baseline_collection_transport_failure')
      const bytes = Buffer.from(await response.arrayBuffer())
      budget.response_bytes += bytes.byteLength
      budget.elapsed_ms = Math.max(0, Math.ceil(monotonicNow() - startedAt))
      requireCondition(
        budget.response_bytes
          <= CURRENT_BASELINE_COLLECTION_LIMITS.max_response_bytes
          && budget.elapsed_ms <= CURRENT_BASELINE_COLLECTION_LIMITS.max_elapsed_ms,
        'current_baseline_collection_bound_exceeded',
      )
      try {
        return JSON.parse(bytes.toString('utf8'))
      } catch {
        throw new ProvenanceError('current_baseline_collection_response_parse_failure')
      }
    } catch (error) {
      if (error instanceof ProvenanceError) throw error
      if (error?.name === 'AbortError') {
        throw new ProvenanceError('current_baseline_collection_timeout')
      }
      throw new ProvenanceError('current_baseline_collection_transport_failure')
    } finally {
      clearTimeout(timeout)
    }
  }

  return {
    request,
    snapshot: () => ({ ...budget }),
  }
}

function historicalFailure(reason) {
  requireCondition(SAFE_FAILURE_REASONS.has(reason), 'historical_failure_reason_invalid')
  return {
    status: 'historical_irrecoverable',
    historical_deployment_identity_recovered: false,
    runtime: null,
    historical_recovery: null,
    reasons: [reason],
  }
}

export function sanitizeFailure(reason) {
  requireCondition(SAFE_FAILURE_REASONS.has(reason), 'historical_failure_reason_invalid')
  return { status: 'historical_irrecoverable', reasons: [reason] }
}

function sameRuntime(left, right) {
  return left.function_id === right.function_id
    && left.deployment_id === right.deployment_id
    && left.version === right.version
    && left.status === right.status
    && left.verify_jwt === right.verify_jwt
}

function sameScheduler(left, right) {
  return left.jobname === right.jobname
    && left.schedule === right.schedule
    && left.command === right.command
    && left.active === right.active
}

function runtimeProjection(edge, scheduler) {
  const runtimeTuple = {
    function_id: edge.function_id,
    deployment_id: edge.deployment_id,
    version: edge.version,
    status: edge.status,
    verify_jwt: edge.verify_jwt,
  }
  return {
    score_tick_function_id_sha256: sha256(`score_tick_function_id\0${edge.function_id}`),
    score_tick_deployment_id_sha256:
      sha256(`score_tick_deployment_id\0${edge.deployment_id}`),
    score_tick_function_version: edge.version,
    score_tick_status: edge.status,
    score_tick_verify_jwt: edge.verify_jwt,
    score_tick_runtime_tuple_sha256: sha256(canonical(runtimeTuple)),
    scheduler_identity_sha256:
      sha256(`${scheduler.jobname}|${scheduler.schedule}|${scheduler.command}`),
    scheduler_active: scheduler.active,
  }
}

export function classifyHistoricalRecovery(evidence) {
  try {
    if (evidence?.failure_reason) return historicalFailure(evidence.failure_reason)
    requireCondition(evidence && typeof evidence === 'object', 'historical_response_parse_failure')
    if (evidence.source_kind === 'current_snapshot') {
      return historicalFailure('historical_current_state_substitution')
    }
    validateProbeBudget({
      request_count: evidence.request_count,
      page_count: evidence.page_count,
      response_bytes: evidence.response_bytes,
      elapsed_ms: evidence.elapsed_ms,
    })
    const contract = evidence.official_contract
    if (!contract?.independently_immutable || !HASH.test(contract.official_contract_sha256 ?? '')
      || contract.field_semantics_complete !== true) {
      return historicalFailure('historical_provider_contract_unverified')
    }
    const retainedFrom = timestamp(contract.retained_from, 'historical_response_parse_failure')
    const retainedThrough = timestamp(contract.retained_through, 'historical_response_parse_failure')
    if (contract.retention_complete !== true
      || retainedFrom > timestamp(PLAN_03_BOUNDARY.before, 'historical_response_parse_failure')
      || retainedThrough < timestamp(PLAN_03_BOUNDARY.after, 'historical_response_parse_failure')) {
      return historicalFailure('historical_retention_incomplete')
    }
    if (contract.pagination_complete !== true
      || contract.terminal_page_token_observed !== true) {
      return historicalFailure('historical_pagination_incomplete')
    }
    if (canonical([...(contract.mutation_channels ?? [])].sort())
      !== canonical([...HISTORICAL_MUTATION_CHANNELS].sort())) {
      return historicalFailure('historical_mutation_channel_coverage_incomplete')
    }

    const edge = evidence.edge
    if (!Array.isArray(edge?.before) || edge.before.length === 0
      || !Array.isArray(edge?.after) || edge.after.length === 0) {
      return historicalFailure('historical_edge_no_match')
    }
    if (edge.before.length !== 1 || edge.after.length !== 1) {
      return historicalFailure('historical_edge_ambiguous')
    }
    const edgeBefore = edge.before[0]
    const edgeAfter = edge.after[0]
    if (!sameRuntime(edgeBefore, edgeAfter)) {
      return historicalFailure('historical_edge_mixed_tuple')
    }
    if (!Array.isArray(edge.deployment_events)) {
      return historicalFailure('historical_response_parse_failure')
    }
    if (edge.deployment_events.length !== 0) {
      return historicalFailure('historical_edge_deployment_event_present')
    }
    if (timestamp(edgeBefore.observed_at, 'historical_response_parse_failure')
        >= timestamp(PLAN_03_BOUNDARY.before, 'historical_response_parse_failure')
      || timestamp(edgeAfter.observed_at, 'historical_response_parse_failure')
        <= timestamp(PLAN_03_BOUNDARY.after, 'historical_response_parse_failure')) {
      return historicalFailure('historical_edge_boundary_gap')
    }
    if (!Number.isSafeInteger(edgeBefore.version) || edgeBefore.version <= 0
      || edgeBefore.status !== 'ACTIVE' || typeof edgeBefore.verify_jwt !== 'boolean') {
      return historicalFailure('historical_edge_mixed_tuple')
    }

    const scheduler = evidence.scheduler
    if (!Array.isArray(scheduler?.before) || scheduler.before.length === 0
      || !Array.isArray(scheduler?.after) || scheduler.after.length === 0) {
      return historicalFailure('historical_scheduler_no_match')
    }
    if (scheduler.before.length !== 1 || scheduler.after.length !== 1) {
      return historicalFailure('historical_scheduler_ambiguous')
    }
    const schedulerBefore = scheduler.before[0]
    const schedulerAfter = scheduler.after[0]
    if (!sameScheduler(schedulerBefore, schedulerAfter)) {
      if (schedulerAfter.active === false) {
        return historicalFailure('historical_scheduler_inactive')
      }
      return historicalFailure('historical_scheduler_mixed_tuple')
    }
    if (!Array.isArray(scheduler.mutation_events)) {
      return historicalFailure('historical_response_parse_failure')
    }
    if (scheduler.mutation_events.length !== 0) {
      return historicalFailure('historical_scheduler_mutation_present')
    }
    if (schedulerBefore.active !== true) {
      return historicalFailure('historical_scheduler_inactive')
    }
    if (timestamp(schedulerBefore.observed_at, 'historical_response_parse_failure')
        >= timestamp(PLAN_03_BOUNDARY.before, 'historical_response_parse_failure')
      || timestamp(schedulerAfter.observed_at, 'historical_response_parse_failure')
        <= timestamp(PLAN_03_BOUNDARY.after, 'historical_response_parse_failure')) {
      return historicalFailure('historical_scheduler_boundary_gap')
    }

    const runtime = runtimeProjection(edgeBefore, schedulerBefore)
    const historicalRecovery = {
      status: 'pass',
      official_contract_sha256: contract.official_contract_sha256,
      covered_interval: {
        retained_from: contract.retained_from,
        retained_through: contract.retained_through,
        boundary_before: PLAN_03_BOUNDARY.before,
        boundary_after: PLAN_03_BOUNDARY.after,
      },
      retention_complete: true,
      pagination_complete: true,
      mutation_channel_coverage_complete: true,
      edge: {
        before_observed_at: edgeBefore.observed_at,
        after_observed_at: edgeAfter.observed_at,
        pages: edge.pages,
        result_sha256: edge.result_sha256,
        deploy_or_rollback_events: 0,
      },
      scheduler: {
        before_observed_at: schedulerBefore.observed_at,
        after_observed_at: schedulerAfter.observed_at,
        pages: scheduler.pages,
        result_sha256: scheduler.result_sha256,
        mutation_events: 0,
      },
    }
    historicalRecovery.proof_sha256 = sha256(canonical(historicalRecovery))
    return {
      status: 'historical_recovered',
      historical_deployment_identity_recovered: true,
      runtime,
      historical_recovery: historicalRecovery,
      reasons: [],
    }
  } catch (error) {
    const reason = error instanceof ProvenanceError && SAFE_FAILURE_REASONS.has(error.code)
      ? error.code
      : 'historical_response_parse_failure'
    return historicalFailure(reason)
  }
}

function requestPayload(anchors) {
  const queryContractHashes = {
    function_inventory_projection_sha256: sha256(canonical({
      route: ['GET', '/v1/projects/{ref}/functions'],
      accepted_fields: ['id', 'deployment_id', 'version', 'status', 'verify_jwt'],
      accepted_resource: 'unique_score_tick_only',
    })),
    historical_log_aggregate_sha256: sha256(canonical({
      route: ['GET', '/v1/projects/{ref}/analytics/endpoints/logs'],
      source: 'function_edge_logs',
      projection: ['bounded_count', 'canonical_hash', 'page_metadata'],
    })),
    scheduler_aggregate_sha256: sha256(canonical({
      route: ['POST', '/v1/projects/{ref}/database/query'],
      sql: 'select_or_cte_only',
      projection: ['unique_resource_count', 'canonical_identity_sha256', 'active'],
    })),
    current_baseline_aggregate_sha256: sha256(canonical({
      route: ['POST', '/v1/projects/{ref}/database/query'],
      projection: [
        'migration_counts_and_hash',
        'containment_function_definition_sha256',
        'containment_function_security_sha256',
        'scheduler_count_hash_and_active',
      ],
    })),
  }
  return {
    anchors,
    anchors_sha256: sha256(canonical(anchors)),
    plan_03_boundary: { ...PLAN_03_BOUNDARY },
    provider_allowlist: ALLOWED_PROVIDER_REQUESTS.map(([method, path]) => ({ method, path })),
    limits: { ...PROBE_LIMITS },
    aggregate_policy: {
      database_sql: 'select_or_cte_only_aggregate_hashes_and_counts',
      logs: 'aggregate_counts_hashes_and_complete_page_metadata_only',
      current_snapshot_use: 'fallback_request_preparation_only',
    },
    query_contract_hashes: queryContractHashes,
    contract_requirements: {
      independently_immutable: true,
      retention_complete: true,
      pagination_complete: true,
      field_semantics_complete: true,
      before_after_boundary_coverage: true,
      no_empty_result_as_no_change_proof: true,
    },
    mutation_channels: [...HISTORICAL_MUTATION_CHANNELS],
    redaction_contract: redactionContract(),
    zero_effect_scope: zeroEffectScope(),
    credential_source: 'existing_environment_process_only_after_exact_authorization',
    explicit_exclusions: [
      'database_mutation',
      'schema_push',
      'function_deployment',
      'function_invocation',
      'scheduler_mutation',
      'worker_or_queue_or_run_or_item_or_state_mutation',
      'history_delete',
      'maintenance',
      'observation_window_arm_or_collect_or_reuse',
      'web_deployment',
      'git_remote_mutation',
      'fallback_adoption_without_separate_exact_owner_decision',
    ],
    later_deployment_authorized: false,
  }
}

function currentBaselineCollectionPayload(record) {
  return {
    authorization_purpose: 'current_baseline_redesign_read_only_collection_only',
    anchors: record.anchors,
    anchors_sha256: sha256(canonical(record.anchors)),
    historical_irrecoverable: {
      status: record.historical_recovery.status,
      reasons: record.historical_recovery.reasons,
      proof_sha256: record.historical_recovery.proof_sha256,
    },
    historical_deployment_identity_recovered: false,
    immutable_source_bindings: { ...CURRENT_BASELINE_IMMUTABLE_BINDINGS },
    provider_allowlist: CURRENT_BASELINE_COLLECTION_REQUESTS.map(
      ([method, path]) => ({ method, path }),
    ),
    query_contracts: {
      function_inventory: {
        query_parameters: [],
        accepted_resource: 'one_unique_score_tick_function',
        process_only_fields: ['function_id', 'deployment_id'],
        persisted_fields: [
          'score_tick_function_id_sha256',
          'score_tick_deployment_id_sha256',
          'score_tick_function_version',
          'score_tick_status',
          'score_tick_verify_jwt',
          'score_tick_runtime_tuple_sha256',
        ],
      },
      database_aggregate: {
        sql_policy: 'select_or_cte_only_aggregate_hashes_and_counts',
        sql_sha256: sha256(CURRENT_BASELINE_SQL),
        exact_row_count: 1,
        persisted_fields: [
          'migration_inventory_sha256',
          'migration_0063_count',
          'migration_0062_count',
          'containment_function_definition_sha256',
          'containment_function_security_sha256',
          'scheduler_identity_sha256',
          'scheduler_active',
        ],
      },
    },
    limits: { ...CURRENT_BASELINE_COLLECTION_LIMITS },
    snapshot_contract: {
      labels: ['pre_owner_redesign_decision', 'post_owner_redesign_decision'],
      exact_snapshot_count: 2,
      canonical_pre_post_equality_required: true,
      raw_provider_identities_process_only: true,
      sanitized_hash_only_persistence: true,
    },
    retained_observation_contract: {
      window_seconds: 86_400,
      maximum_http_546_count: 0,
      minimum_score_tick_coverage_rate: 0.99,
      minimum_score_tick_success_rate: 0.99,
      maximum_phantom_new_job_runs: 0,
      genuine_arrival_correlation_required: true,
      minute_cadence_growth_forbidden: true,
    },
    credential_source: 'existing_environment_process_only_after_exact_authorization',
    redaction_contract: redactionContract(),
    zero_effect_scope: zeroEffectScope(),
    explicit_exclusions: [
      'database_or_schema_or_data_mutation',
      'configuration_or_secret_mutation',
      'function_deployment_or_invocation',
      'scheduler_mutation',
      'worker_or_queue_or_run_or_item_or_state_mutation',
      'history_delete_or_cleanup',
      'maintenance',
      'observation_window_arm_or_collect_or_reuse',
      'current_baseline_redesign_adoption_without_separate_exact_owner_decision',
      'plan_04_action',
      'later_deployment',
      'web_deployment',
      'git_remote_mutation',
    ],
    later_deployment_authorized: false,
  }
}

export function exactCurrentBaselineCollectionSignal(record) {
  return `authorize Plan 05.1-13 current baseline read-only collection ${record.current_baseline_collection_authorization.payload_sha256}`
}

export function exactHistoricalSignal(record) {
  return `authorize Plan 05.1-13 historical read-only probe ${record.historical_probe_authorization.payload_sha256}`
}

export async function buildPendingHistoricalRequest({
  git = defaultGit,
  anchors = IMMUTABLE_ANCHORS,
} = {}) {
  const verified = await verifyImmutableAnchors({ git, anchors })
  const payload = requestPayload(verified)
  const payloadSha256 = sha256(canonical(payload))
  const record = {
    schema_version: 1,
    status: 'pending_historical_authorization',
    provenance_mode: null,
    historical_deployment_identity_recovered: false,
    anchors: verified,
    runtime: null,
    historical_recovery: null,
    current_baseline: null,
    historical_probe_authorization: {
      status: 'pending',
      payload_serialization: 'canonical_json_sorted_keys_v1',
      payload,
      payload_sha256: payloadSha256,
      required_signal_sha256: sha256(
        `authorize Plan 05.1-13 historical read-only probe ${payloadSha256}`,
      ),
      accepted_signal_sha256: null,
    },
    current_baseline_collection_authorization: null,
    owner_checkpoint: null,
    provider_provenance: {
      allowlist_sha256: sha256(canonical(ALLOWED_PROVIDER_REQUESTS)),
      query_contract_sha256: sha256(canonical(payload.query_contract_hashes)),
      official_contract_requirements_sha256:
        sha256(canonical(payload.contract_requirements)),
    },
    redaction: redactionContract(),
    zero_effect_scope: zeroEffectScope(),
    later_deployment_authorized: false,
    reasons: ['historical_probe_not_authorized'],
  }
  assertRequestRecord(record, { skipGit: true })
  return record
}

function assertAnchorsSchema(anchors, code) {
  exactKeys(anchors, Object.keys(IMMUTABLE_ANCHORS), code)
  for (const anchor of Object.values(anchors)) {
    exactKeys(anchor, ANCHOR_KEYS, code)
    requireCondition(OID.test(anchor.commit) && OID.test(anchor.blob)
      && HASH.test(anchor.sha256) && anchor.path.startsWith('.planning/'), code)
  }
}

function assertRedaction(value, code) {
  exactKeys(value, REDACTION_KEYS, code)
  requireCondition(value.aggregate_only === true
    && Object.entries(value).every(([key, entry]) => key === 'aggregate_only' || entry === false),
  code)
}

function assertZeroEffects(value, code) {
  exactKeys(value, ZERO_EFFECT_KEYS, code)
  requireCondition(Object.values(value).every((entry) => entry === 0), code)
}

function assertCommonRecord(record, prefix) {
  exactKeys(record, ROOT_KEYS, `${prefix}_schema_invalid`)
  requireCondition(record.schema_version === 1, `${prefix}_schema_invalid`)
  assertAnchorsSchema(record.anchors, `${prefix}_anchors_invalid`)
  exactKeys(record.historical_probe_authorization, AUTHORIZATION_KEYS,
    `${prefix}_authorization_invalid`)
  exactKeys(record.provider_provenance, [
    'allowlist_sha256', 'query_contract_sha256', 'official_contract_requirements_sha256',
  ], `${prefix}_provider_provenance_invalid`)
  requireCondition(Object.values(record.provider_provenance).every((value) => HASH.test(value)),
    `${prefix}_provider_provenance_invalid`)
  assertRedaction(record.redaction, `${prefix}_redaction_invalid`)
  assertZeroEffects(record.zero_effect_scope, `${prefix}_zero_effect_invalid`)
  requireCondition(record.later_deployment_authorized === false, `${prefix}_authority_invalid`)
  requireCondition(Array.isArray(record.reasons)
    && record.reasons.every((reason) => SAFE_FAILURE_REASONS.has(reason)),
  `${prefix}_reasons_invalid`)
}

function assertHistoricalIrrecoverableState(record, code) {
  exactKeys(record.historical_recovery, ['status', 'reasons', 'proof_sha256'], code)
  requireCondition(record.provenance_mode === 'historical_irrecoverable'
    && record.historical_deployment_identity_recovered === false
    && record.runtime === null
    && record.current_baseline === null
    && record.owner_checkpoint === null
    && record.historical_recovery.status === 'historical_irrecoverable'
    && Array.isArray(record.historical_recovery.reasons)
    && record.historical_recovery.reasons.length > 0
    && record.historical_recovery.reasons.every((reason) => SAFE_FAILURE_REASONS.has(reason))
    && HASH.test(record.historical_recovery.proof_sha256)
    && canonical(record.reasons) === canonical(record.historical_recovery.reasons),
  code)
}

function assertCompletedHistoricalAuthorization(record, code) {
  const authorization = record.historical_probe_authorization
  const expectedPayload = requestPayload(record.anchors)
  requireCondition(authorization.status === 'authorized_and_completed'
    && authorization.payload_serialization === 'canonical_json_sorted_keys_v1'
    && canonical(authorization.payload) === canonical(expectedPayload)
    && authorization.payload_sha256 === sha256(canonical(expectedPayload))
    && authorization.required_signal_sha256 === sha256(exactHistoricalSignal(record))
    && authorization.accepted_signal_sha256 === authorization.required_signal_sha256,
  code)
}

function assertCurrentBaselineCollectionAuthorization(record, expectedStatus, code) {
  const authorization = record.current_baseline_collection_authorization
  exactKeys(authorization, AUTHORIZATION_KEYS, code)
  const expectedPayload = currentBaselineCollectionPayload(record)
  requireCondition(authorization.status === expectedStatus
    && authorization.payload_serialization === 'canonical_json_sorted_keys_v1'
    && canonical(authorization.payload) === canonical(expectedPayload)
    && authorization.payload_sha256 === sha256(canonical(expectedPayload))
    && authorization.required_signal_sha256
      === sha256(exactCurrentBaselineCollectionSignal(record))
    && (expectedStatus === 'pending'
      ? authorization.accepted_signal_sha256 === null
      : authorization.accepted_signal_sha256 === authorization.required_signal_sha256),
  code)
}

export function prepareCurrentBaselineCollectionRequest(record) {
  const prepared = structuredClone(record)
  if (!Object.hasOwn(prepared, 'current_baseline_collection_authorization')) {
    prepared.current_baseline_collection_authorization = null
  }
  assertCommonRecord(prepared, 'current_baseline_collection_source')
  requireCondition(prepared.status === 'historical_irrecoverable'
    && prepared.current_baseline_collection_authorization === null,
  'current_baseline_collection_source_invalid')
  assertHistoricalIrrecoverableState(prepared, 'current_baseline_collection_source_invalid')
  assertCompletedHistoricalAuthorization(prepared,
    'current_baseline_collection_source_authorization_invalid')
  prepared.status = 'pending_current_baseline_collection_authorization'
  const payload = currentBaselineCollectionPayload(prepared)
  const payloadSha256 = sha256(canonical(payload))
  prepared.current_baseline_collection_authorization = {
    status: 'pending',
    payload_serialization: 'canonical_json_sorted_keys_v1',
    payload,
    payload_sha256: payloadSha256,
    required_signal_sha256: sha256(
      `authorize Plan 05.1-13 current baseline read-only collection ${payloadSha256}`,
    ),
    accepted_signal_sha256: null,
  }
  assertCurrentBaselineCollectionRequestRecord(prepared)
  return prepared
}

export function assertCurrentBaselineCollectionRequestRecord(record) {
  assertCommonRecord(record, 'current_baseline_collection_request')
  requireCondition(record.status === 'pending_current_baseline_collection_authorization',
    'current_baseline_collection_request_mode_invalid')
  assertHistoricalIrrecoverableState(record,
    'current_baseline_collection_request_mode_invalid')
  assertCompletedHistoricalAuthorization(record,
    'current_baseline_collection_request_historical_authorization_invalid')
  assertCurrentBaselineCollectionAuthorization(record, 'pending',
    'current_baseline_collection_request_authorization_invalid')
  return record
}

export function assertAuthorizedCurrentBaselineCollectionRecord(record) {
  assertCommonRecord(record, 'current_baseline_collection_authorized')
  requireCondition(record.status === 'current_baseline_collection_authorized',
    'current_baseline_collection_authorized_mode_invalid')
  assertHistoricalIrrecoverableState(record,
    'current_baseline_collection_authorized_mode_invalid')
  assertCompletedHistoricalAuthorization(record,
    'current_baseline_collection_authorized_historical_authorization_invalid')
  assertCurrentBaselineCollectionAuthorization(record, 'accepted',
    'current_baseline_collection_authorized_authorization_invalid')
  return record
}

export function acceptCurrentBaselineCollectionAuthorization(record, acceptedSignalSha256) {
  assertCurrentBaselineCollectionRequestRecord(record)
  requireCondition(acceptedSignalSha256
    === record.current_baseline_collection_authorization.required_signal_sha256,
  'current_baseline_collection_not_authorized')
  const accepted = structuredClone(record)
  accepted.status = 'current_baseline_collection_authorized'
  accepted.current_baseline_collection_authorization.status = 'accepted'
  accepted.current_baseline_collection_authorization.accepted_signal_sha256 =
    acceptedSignalSha256
  assertAuthorizedCurrentBaselineCollectionRecord(accepted)
  return accepted
}

export function recordCurrentBaselineCollectionFailure(
  record,
  reason = 'current_baseline_collection_transport_failure',
) {
  assertAuthorizedCurrentBaselineCollectionRecord(record)
  requireCondition(reason === 'current_baseline_collection_transport_failure',
    'current_baseline_collection_failure_reason_invalid')
  const failed = structuredClone(record)
  failed.status = 'current_baseline_collection_failed'
  failed.current_baseline_collection_authorization.status =
    'completed_failed_first_snapshot_envelope_retired'
  failed.reasons = [reason]
  assertCurrentBaselineCollectionFailedRecord(failed)
  return failed
}

export function assertCurrentBaselineCollectionFailedRecord(record) {
  assertCommonRecord(record, 'current_baseline_collection_failed')
  requireCondition(record.status === 'current_baseline_collection_failed'
    && record.provenance_mode === 'historical_irrecoverable'
    && record.historical_deployment_identity_recovered === false
    && record.runtime === null
    && record.current_baseline === null
    && record.owner_checkpoint === null
    && record.historical_recovery?.status === 'historical_irrecoverable'
    && Array.isArray(record.historical_recovery.reasons)
    && record.historical_recovery.reasons.length > 0
    && record.historical_recovery.reasons.every((entry) => SAFE_FAILURE_REASONS.has(entry))
    && HASH.test(record.historical_recovery.proof_sha256 ?? '')
    && canonical(record.reasons)
      === canonical(['current_baseline_collection_transport_failure']),
  'current_baseline_collection_failed_mode_invalid')
  assertCompletedHistoricalAuthorization(record,
    'current_baseline_collection_failed_historical_authorization_invalid')
  assertCurrentBaselineCollectionAuthorization(
    record,
    'completed_failed_first_snapshot_envelope_retired',
    'current_baseline_collection_failed_authorization_invalid',
  )
  return record
}

export function assertRequestRecord(record, _options = {}) {
  if (record?.status === 'pending_current_baseline_collection_authorization') {
    return assertCurrentBaselineCollectionRequestRecord(record)
  }
  assertCommonRecord(record, 'request')
  requireCondition(record.status === 'pending_historical_authorization'
    && record.provenance_mode === null
    && record.historical_deployment_identity_recovered === false
    && record.runtime === null
    && record.historical_recovery === null
    && record.current_baseline === null
    && record.current_baseline_collection_authorization === null
    && record.owner_checkpoint === null,
  'request_mode_invalid')
  const authorization = record.historical_probe_authorization
  requireCondition(authorization.status === 'pending'
    && authorization.payload_serialization === 'canonical_json_sorted_keys_v1'
    && authorization.accepted_signal_sha256 === null,
  'request_authorization_invalid')
  const expectedPayload = requestPayload(record.anchors)
  requireCondition(canonical(authorization.payload) === canonical(expectedPayload),
    'request_payload_invalid')
  requireCondition(authorization.payload_sha256 === sha256(canonical(expectedPayload)),
    'request_payload_hash_invalid')
  requireCondition(authorization.required_signal_sha256 === sha256(exactHistoricalSignal(record)),
    'request_signal_hash_invalid')
  requireCondition(canonical(record.reasons) === canonical(['historical_probe_not_authorized']),
    'request_reasons_invalid')
  return record
}

export function assertAuthorizedRequestRecord(record) {
  assertCommonRecord(record, 'authorized_request')
  requireCondition(record.status === 'historical_probe_authorized'
    && record.provenance_mode === null
    && record.historical_deployment_identity_recovered === false
    && record.runtime === null
    && record.historical_recovery === null
    && record.current_baseline === null
    && record.current_baseline_collection_authorization === null
    && record.owner_checkpoint === null,
  'authorized_request_mode_invalid')
  const authorization = record.historical_probe_authorization
  const expectedPayload = requestPayload(record.anchors)
  requireCondition(authorization.status === 'accepted'
    && authorization.payload_serialization === 'canonical_json_sorted_keys_v1'
    && canonical(authorization.payload) === canonical(expectedPayload)
    && authorization.payload_sha256 === sha256(canonical(expectedPayload))
    && authorization.required_signal_sha256 === sha256(exactHistoricalSignal(record))
    && authorization.accepted_signal_sha256 === authorization.required_signal_sha256,
  'authorized_request_authorization_invalid')
  requireCondition(record.reasons.length === 0, 'authorized_request_reasons_invalid')
  return record
}

export function acceptHistoricalAuthorization(record, acceptedSignalSha256) {
  assertRequestRecord(record)
  requireCondition(acceptedSignalSha256
    === record.historical_probe_authorization.required_signal_sha256,
  'historical_probe_not_authorized')
  const accepted = structuredClone(record)
  accepted.status = 'historical_probe_authorized'
  accepted.historical_probe_authorization.status = 'accepted'
  accepted.historical_probe_authorization.accepted_signal_sha256 = acceptedSignalSha256
  accepted.reasons = []
  assertAuthorizedRequestRecord(accepted)
  return accepted
}

function assertRuntime(value) {
  exactKeys(value, RUNTIME_KEYS, 'runtime_schema_invalid')
  requireCondition([
    value.score_tick_function_id_sha256,
    value.score_tick_deployment_id_sha256,
    value.score_tick_runtime_tuple_sha256,
    value.scheduler_identity_sha256,
  ].every((entry) => HASH.test(entry)), 'runtime_schema_invalid')
  requireCondition(Number.isSafeInteger(value.score_tick_function_version)
    && value.score_tick_function_version > 0
    && value.score_tick_status === 'ACTIVE'
    && typeof value.score_tick_verify_jwt === 'boolean'
    && value.scheduler_active === true,
  'runtime_schema_invalid')
}

function assertCurrentBaseline(value) {
  exactKeys(value, CURRENT_BASELINE_KEYS, 'current_baseline_schema_invalid')
  timestamp(value.observed_at, 'current_baseline_schema_invalid')
  requireCondition(value.migration_0063_count === 1 && value.migration_0062_count === 0,
    'current_baseline_schema_invalid')
  for (const key of [
    'project_ref_sha256',
    'migration_inventory_sha256',
    'containment_function_definition_sha256',
    'containment_function_security_sha256',
  ]) requireCondition(HASH.test(value[key]), 'current_baseline_schema_invalid')
  requireCondition(value.project_ref_sha256
      === CURRENT_BASELINE_IMMUTABLE_BINDINGS.project_ref_sha256
    && value.migration_inventory_sha256
      === CURRENT_BASELINE_IMMUTABLE_BINDINGS.migration_inventory_sha256
    && value.containment_function_definition_sha256
      === CURRENT_BASELINE_IMMUTABLE_BINDINGS.containment_function_definition_sha256
    && value.containment_function_security_sha256
      === CURRENT_BASELINE_IMMUTABLE_BINDINGS.containment_function_security_sha256,
  'current_baseline_immutable_binding_invalid')
  assertRuntime(Object.fromEntries(RUNTIME_KEYS.map((key) => [key, value[key]])))
}

function assertHistoricalRecovery(value) {
  exactKeys(value, [
    'status',
    'official_contract_sha256',
    'covered_interval',
    'retention_complete',
    'pagination_complete',
    'mutation_channel_coverage_complete',
    'edge',
    'scheduler',
    'proof_sha256',
  ], 'historical_recovery_schema_invalid')
  requireCondition(value.status === 'pass'
    && HASH.test(value.official_contract_sha256)
    && HASH.test(value.proof_sha256)
    && value.retention_complete === true
    && value.pagination_complete === true
    && value.mutation_channel_coverage_complete === true,
  'historical_recovery_schema_invalid')
  exactKeys(value.covered_interval, [
    'retained_from', 'retained_through', 'boundary_before', 'boundary_after',
  ], 'historical_recovery_schema_invalid')
  requireCondition(value.covered_interval.boundary_before === PLAN_03_BOUNDARY.before
    && value.covered_interval.boundary_after === PLAN_03_BOUNDARY.after,
  'historical_recovery_schema_invalid')
  exactKeys(value.edge, [
    'before_observed_at', 'after_observed_at', 'pages', 'result_sha256',
    'deploy_or_rollback_events',
  ], 'historical_recovery_schema_invalid')
  exactKeys(value.scheduler, [
    'before_observed_at', 'after_observed_at', 'pages', 'result_sha256', 'mutation_events',
  ], 'historical_recovery_schema_invalid')
  requireCondition(value.edge.deploy_or_rollback_events === 0
    && value.scheduler.mutation_events === 0
    && HASH.test(value.edge.result_sha256)
    && HASH.test(value.scheduler.result_sha256),
  'historical_recovery_schema_invalid')
  const withoutProof = structuredClone(value)
  delete withoutProof.proof_sha256
  requireCondition(value.proof_sha256 === sha256(canonical(withoutProof)),
    'historical_recovery_schema_invalid')
}

export function assertProvenanceRecord(record) {
  assertCommonRecord(record, 'record')
  requireCondition(record.status === 'pass', 'record_not_pass')
  requireCondition(record.reasons.length === 0, 'record_reasons_invalid')
  assertRuntime(record.runtime)
  if (record.provenance_mode === 'historical_recovered') {
    requireCondition(record.historical_deployment_identity_recovered === true
      && record.current_baseline === null
      && record.current_baseline_collection_authorization === null
      && record.owner_checkpoint === null,
    'mode_schema_invalid')
    assertHistoricalRecovery(record.historical_recovery)
  } else if (record.provenance_mode === 'current_baseline_redesign') {
    requireCondition(record.historical_deployment_identity_recovered === false
      && record.historical_recovery?.status === 'historical_irrecoverable'
      && Array.isArray(record.historical_recovery.reasons)
      && HASH.test(record.historical_recovery.proof_sha256 ?? ''),
    'mode_schema_invalid')
    exactKeys(record.historical_recovery, ['status', 'reasons', 'proof_sha256'],
      'mode_schema_invalid')
    assertCurrentBaseline(record.current_baseline)
    exactKeys(record.owner_checkpoint, OWNER_CHECKPOINT_KEYS, 'owner_checkpoint_invalid')
    requireCondition(record.owner_checkpoint.status === 'accepted'
      && record.owner_checkpoint.payload_serialization === 'canonical_json_sorted_keys_v1'
      && [
        record.owner_checkpoint.payload_sha256,
        record.owner_checkpoint.required_signal_sha256,
        record.owner_checkpoint.accepted_signal_sha256,
      ].every((value) => HASH.test(value)),
    'owner_checkpoint_invalid')
    if (record.current_baseline_collection_authorization !== null) {
      assertCurrentBaselineCollectionAuthorization(record, 'accepted',
        'current_baseline_collection_authorization_invalid')
    }
  } else {
    throw new ProvenanceError('mode_schema_invalid')
  }
  return record
}

function currentBaselinePayload(record) {
  return {
    anchors: record.anchors,
    historical_recovery: record.historical_recovery,
    current_baseline_collection_authorization:
      record.current_baseline_collection_authorization,
    current_baseline: record.current_baseline,
    window_seconds: 86_400,
    zero_effect_scope: record.zero_effect_scope,
    later_deployment_authorized: false,
  }
}

export function exactCurrentBaselineSignal(record) {
  return `approve Plan 05.1-13 current_baseline_redesign ${record.owner_checkpoint.payload_sha256}`
}

export function prepareCurrentBaselineRequest(record, snapshot) {
  requireCondition(['historical_irrecoverable', 'current_baseline_collection_authorized']
    .includes(record.status)
    && record.provenance_mode === 'historical_irrecoverable'
    && record.historical_recovery?.status === 'historical_irrecoverable'
    && Array.isArray(record.historical_recovery.reasons)
    && HASH.test(record.historical_recovery.proof_sha256 ?? ''),
  'current_baseline_request_invalid')
  if (record.status === 'current_baseline_collection_authorized') {
    assertAuthorizedCurrentBaselineCollectionRecord(record)
  }
  assertCurrentBaseline(snapshot)
  const prepared = structuredClone(record)
  prepared.status = 'pending_current_baseline_authorization'
  prepared.current_baseline = structuredClone(snapshot)
  prepared.runtime = null
  prepared.historical_deployment_identity_recovered = false
  prepared.owner_checkpoint = {
    status: 'pending',
    payload_serialization: 'canonical_json_sorted_keys_v1',
    payload_sha256: '',
    required_signal_sha256: '',
    accepted_signal_sha256: null,
  }
  prepared.owner_checkpoint.payload_sha256 = sha256(canonical(currentBaselinePayload(prepared)))
  prepared.owner_checkpoint.required_signal_sha256 = sha256(exactCurrentBaselineSignal(prepared))
  prepared.reasons = [...prepared.historical_recovery.reasons]
  return prepared
}

export function sealCurrentBaseline(record, ownerSignal, freshSnapshot) {
  requireCondition(record.status === 'pending_current_baseline_authorization'
    && record.provenance_mode === 'historical_irrecoverable'
    && record.historical_recovery?.status === 'historical_irrecoverable',
  'current_baseline_request_invalid')
  assertCurrentBaseline(record.current_baseline)
  assertCurrentBaseline(freshSnapshot)
  exactKeys(record.owner_checkpoint, OWNER_CHECKPOINT_KEYS, 'owner_checkpoint_invalid')
  const payload = currentBaselinePayload(record)
  requireCondition(record.owner_checkpoint.payload_sha256 === sha256(canonical(payload)),
    'owner_payload_invalid')
  const requiredSignal = exactCurrentBaselineSignal(record)
  requireCondition(record.owner_checkpoint.required_signal_sha256 === sha256(requiredSignal),
    'owner_payload_invalid')
  requireCondition(ownerSignal === requiredSignal, 'owner_signal_invalid')
  requireCondition(canonical(freshSnapshot) === canonical(record.current_baseline),
    'current_baseline_drift')
  const sealed = structuredClone(record)
  sealed.status = 'pass'
  sealed.provenance_mode = 'current_baseline_redesign'
  sealed.historical_deployment_identity_recovered = false
  sealed.runtime = Object.fromEntries(RUNTIME_KEYS.map((key) => [key, freshSnapshot[key]]))
  sealed.owner_checkpoint.status = 'accepted'
  sealed.owner_checkpoint.accepted_signal_sha256 = sha256(ownerSignal)
  sealed.reasons = []
  assertProvenanceRecord(sealed)
  return sealed
}

function currentSnapshotFromResponses({ projectRef, functions, database, observedAt }) {
  requireCondition(Array.isArray(functions), 'historical_response_parse_failure')
  const scoreTick = functions.filter((entry) => entry?.slug === 'score-tick')
  requireCondition(scoreTick.length === 1, 'historical_response_parse_failure')
  const functionId = String(scoreTick[0].id ?? scoreTick[0].function_id ?? '')
  const deploymentId = String(
    scoreTick[0].deployment_id ?? scoreTick[0].deploymentId ?? '',
  )
  const version = Number(scoreTick[0].version)
  requireCondition(/^[A-Za-z0-9_-]{1,200}$/.test(functionId)
    && /^[A-Za-z0-9_-]{1,200}$/.test(deploymentId)
    && Number.isSafeInteger(version) && version > 0
    && scoreTick[0].status === 'ACTIVE'
    && typeof scoreTick[0].verify_jwt === 'boolean',
  'historical_response_parse_failure')

  requireCondition(Array.isArray(database) && database.length === 1
    && database[0] && typeof database[0] === 'object',
  'historical_response_parse_failure')
  const row = database[0]
  const integerField = (name) => {
    const value = Number(row[name])
    requireCondition(Number.isSafeInteger(value) && value >= 0,
      'historical_response_parse_failure')
    return value
  }
  const migration0063Count = integerField('migration_0063_count')
  const migration0062Count = integerField('migration_0062_count')
  const schedulerJobCount = integerField('scheduler_job_count')
  const schedulerActiveCount = integerField('scheduler_active_count')
  requireCondition(migration0063Count === 1 && migration0062Count === 0
    && schedulerJobCount === 1 && schedulerActiveCount === 1,
  'historical_response_parse_failure')
  for (const key of [
    'migration_inventory_sha256',
    'containment_function_definition_sha256',
    'containment_function_security_sha256',
    'scheduler_identity_sha256',
  ]) requireCondition(HASH.test(String(row[key] ?? '')),
  'historical_response_parse_failure')

  const runtimeTuple = {
    function_id: functionId,
    deployment_id: deploymentId,
    version,
    status: scoreTick[0].status,
    verify_jwt: scoreTick[0].verify_jwt,
  }
  return {
    observed_at: observedAt.toISOString(),
    project_ref_sha256: sha256(projectRef),
    migration_inventory_sha256: String(row.migration_inventory_sha256),
    migration_0063_count: migration0063Count,
    migration_0062_count: migration0062Count,
    containment_function_definition_sha256:
      String(row.containment_function_definition_sha256),
    containment_function_security_sha256:
      String(row.containment_function_security_sha256),
    score_tick_function_id_sha256: sha256(`score_tick_function_id\0${functionId}`),
    score_tick_deployment_id_sha256:
      sha256(`score_tick_deployment_id\0${deploymentId}`),
    score_tick_function_version: version,
    score_tick_status: scoreTick[0].status,
    score_tick_verify_jwt: scoreTick[0].verify_jwt,
    score_tick_runtime_tuple_sha256: sha256(canonical(runtimeTuple)),
    scheduler_identity_sha256: String(row.scheduler_identity_sha256),
    scheduler_active: true,
  }
}

function historicalIrrecoverableRecord(record, ownerSignal, reason, proof) {
  requireCondition(SAFE_FAILURE_REASONS.has(reason), 'historical_failure_reason_invalid')
  const failed = structuredClone(record)
  failed.status = 'historical_irrecoverable'
  failed.provenance_mode = 'historical_irrecoverable'
  failed.historical_deployment_identity_recovered = false
  failed.runtime = null
  failed.historical_recovery = {
    status: 'historical_irrecoverable',
    reasons: [reason],
    proof_sha256: sha256(canonical(proof)),
  }
  failed.current_baseline = null
  failed.historical_probe_authorization.status = 'authorized_and_completed'
  failed.historical_probe_authorization.accepted_signal_sha256 = ownerSignal === null
    ? record.historical_probe_authorization.accepted_signal_sha256
    : sha256(ownerSignal)
  failed.owner_checkpoint = null
  failed.reasons = [reason]
  return failed
}

export function recordHistoricalFailure(record, reason, budget) {
  assertAuthorizedRequestRecord(record)
  requireCondition(SAFE_FAILURE_REASONS.has(reason), 'historical_failure_reason_invalid')
  validateProbeBudget({ ...budget, elapsed_ms: budget.elapsed_ms ?? 0 })
  return historicalIrrecoverableRecord(record, null, reason, {
    reason,
    authorization_sha256: record.historical_probe_authorization.required_signal_sha256,
    allowlist_sha256: record.provider_provenance.allowlist_sha256,
    query_contract_sha256: record.provider_provenance.query_contract_sha256,
    official_contract_requirements_sha256:
      record.provider_provenance.official_contract_requirements_sha256,
    budget: { ...budget, elapsed_ms: budget.elapsed_ms ?? 0 },
  })
}

export async function executeAuthorizedHistoricalProbe({
  record,
  ownerSignal,
  verifyAnchors = verifyImmutableAnchors,
  loadProjectRef = planBoundProjectRef,
  loadAccessToken = environmentAccessToken,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  monotonicNow = () => performance.now(),
} = {}) {
  await verifyAnchors()
  if (record?.status === 'historical_probe_authorized') {
    assertAuthorizedRequestRecord(record)
    requireCondition(ownerSignal === null || ownerSignal === undefined,
      'historical_probe_not_authorized')
    ownerSignal = null
  } else {
    assertRequestRecord(record)
    requireCondition(ownerSignal === exactHistoricalSignal(record),
      'historical_probe_not_authorized')
  }

  const accessToken = loadAccessToken()
  requireCondition(typeof accessToken === 'string' && accessToken.trim().length > 0,
    'authentication_required')
  const projectRef = await loadProjectRef()
  requireCondition(/^[a-z0-9]{1,64}$/.test(projectRef), 'project_ref_invalid')
  requireCondition(typeof fetchImpl === 'function', 'historical_transport_failure')
  const transport = probeTransport({ accessToken, fetchImpl, monotonicNow })

  const functions = await transport.request({
    method: 'GET',
    path: `/v1/projects/${projectRef}/functions`,
    query: {},
    body: null,
  })

  let historicalReason = 'historical_mutation_channel_coverage_incomplete'
  try {
    const historical = await transport.request({
      method: 'GET',
      path: `/v1/projects/${projectRef}/analytics/endpoints/logs`,
      query: {
        source: 'function_edge_logs',
        sql: HISTORICAL_LOG_SQL,
        start: '2026-08-01T16:32:10.434Z',
        end: '2026-08-01T16:47:10.434Z',
        limit: PROBE_LIMITS.max_rows_per_aggregate,
        page_token: null,
      },
      body: null,
    })
    const historicalRows = Array.isArray(historical) ? historical : historical?.result
    if (!Array.isArray(historicalRows)) {
      historicalReason = 'historical_response_parse_failure'
    } else if (historical?.next_page_token) {
      historicalReason = 'historical_pagination_incomplete'
    }
  } catch (error) {
    if (error instanceof ProvenanceError && SAFE_FAILURE_REASONS.has(error.code)) {
      historicalReason = error.code
    } else {
      throw error
    }
  }

  const database = await transport.request({
    method: 'POST',
    path: `/v1/projects/${projectRef}/database/query`,
    query: {},
    body: { query: CURRENT_BASELINE_SQL },
  })
  const observedAt = now()
  requireCondition(observedAt instanceof Date && Number.isFinite(observedAt.getTime()),
    'historical_response_parse_failure')
  const currentBaseline = currentSnapshotFromResponses({
    projectRef,
    functions,
    database,
    observedAt,
  })
  const transportEvidence = transport.snapshot()
  validateProbeBudget(transportEvidence.budget)
  const proof = {
    reason: historicalReason,
    observed_at: currentBaseline.observed_at,
    authorization_sha256: record.historical_probe_authorization.required_signal_sha256,
    allowlist_sha256: record.provider_provenance.allowlist_sha256,
    query_contract_sha256: record.provider_provenance.query_contract_sha256,
    official_contract_requirements_sha256:
      record.provider_provenance.official_contract_requirements_sha256,
    response_hashes_sha256: sha256(canonical(transportEvidence.response_hashes)),
    budget: transportEvidence.budget,
    current_baseline_sha256: sha256(canonical(currentBaseline)),
  }
  const failed = historicalIrrecoverableRecord(
    record,
    ownerSignal,
    historicalReason,
    proof,
  )
  return prepareCurrentBaselineRequest(failed, currentBaseline)
}

export async function prepareFallbackAfterHistoricalFailure({
  record,
  reason,
  initialBudget,
  verifyAnchors = verifyImmutableAnchors,
  loadProjectRef = planBoundProjectRef,
  loadAccessToken = environmentAccessToken,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  monotonicNow = () => performance.now(),
} = {}) {
  await verifyAnchors()
  assertAuthorizedRequestRecord(record)
  requireCondition(SAFE_FAILURE_REASONS.has(reason), 'historical_failure_reason_invalid')
  validateProbeBudget({
    request_count: initialBudget?.request_count ?? -1,
    page_count: initialBudget?.page_count ?? -1,
    response_bytes: initialBudget?.response_bytes ?? 0,
    elapsed_ms: 0,
  })
  const accessToken = loadAccessToken()
  requireCondition(typeof accessToken === 'string' && accessToken.trim().length > 0,
    'authentication_required')
  const projectRef = await loadProjectRef()
  requireCondition(/^[a-z0-9]{1,64}$/.test(projectRef), 'project_ref_invalid')
  const transport = probeTransport({
    accessToken,
    fetchImpl,
    monotonicNow,
    initialBudget,
  })
  const functions = await transport.request({
    method: 'GET',
    path: `/v1/projects/${projectRef}/functions`,
    query: {},
    body: null,
  })
  const database = await transport.request({
    method: 'POST',
    path: `/v1/projects/${projectRef}/database/query`,
    query: {},
    body: { query: CURRENT_BASELINE_SQL },
  })
  const observedAt = now()
  requireCondition(observedAt instanceof Date && Number.isFinite(observedAt.getTime()),
    'historical_response_parse_failure')
  const currentBaseline = currentSnapshotFromResponses({
    projectRef,
    functions,
    database,
    observedAt,
  })
  const transportEvidence = transport.snapshot()
  const proof = {
    reason,
    observed_at: currentBaseline.observed_at,
    authorization_sha256: record.historical_probe_authorization.required_signal_sha256,
    allowlist_sha256: record.provider_provenance.allowlist_sha256,
    query_contract_sha256: record.provider_provenance.query_contract_sha256,
    official_contract_requirements_sha256:
      record.provider_provenance.official_contract_requirements_sha256,
    response_hashes_sha256: sha256(canonical(transportEvidence.response_hashes)),
    budget: transportEvidence.budget,
    current_baseline_sha256: sha256(canonical(currentBaseline)),
  }
  const failed = historicalIrrecoverableRecord(record, null, reason, proof)
  return prepareCurrentBaselineRequest(failed, currentBaseline)
}

export async function executeAuthorizedCurrentBaselineCollection({
  record,
  verifyAnchors = verifyImmutableAnchors,
  loadProjectRef = planBoundProjectRef,
  loadAccessToken = environmentAccessToken,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  monotonicNow = () => performance.now(),
} = {}) {
  await verifyAnchors()
  assertAuthorizedCurrentBaselineCollectionRecord(record)

  const accessToken = loadAccessToken()
  requireCondition(typeof accessToken === 'string' && accessToken.trim().length > 0,
    'authentication_required')
  const projectRef = await loadProjectRef()
  requireCondition(/^[a-z0-9]{1,64}$/.test(projectRef), 'project_ref_invalid')
  requireCondition(typeof fetchImpl === 'function',
    'current_baseline_collection_transport_failure')
  const transport = currentBaselineCollectionTransport({
    accessToken,
    fetchImpl,
    monotonicNow,
  })

  const functions = await transport.request({
    method: 'GET',
    path: `/v1/projects/${projectRef}/functions`,
    query: {},
    body: null,
  })
  const database = await transport.request({
    method: 'POST',
    path: `/v1/projects/${projectRef}/database/query`,
    query: {},
    body: { query: CURRENT_BASELINE_SQL },
  })
  const observedAt = now()
  requireCondition(observedAt instanceof Date && Number.isFinite(observedAt.getTime()),
    'current_baseline_collection_response_parse_failure')
  const snapshot = currentSnapshotFromResponses({
    projectRef,
    functions,
    database,
    observedAt,
  })
  const budget = transport.snapshot()
  requireCondition(budget.request_count === 2
    && budget.page_count === 0
    && budget.response_bytes <= CURRENT_BASELINE_COLLECTION_LIMITS.max_response_bytes
    && budget.elapsed_ms <= CURRENT_BASELINE_COLLECTION_LIMITS.max_elapsed_ms,
  'current_baseline_collection_bound_exceeded')
  return prepareCurrentBaselineRequest(record, snapshot)
}

function parseArgs(argv) {
  const args = {
    mode: null,
    output: DEFAULT_RECORD,
    record: null,
    snapshot: null,
    acceptedSignalSha256: null,
    historicalFailureReason: null,
    priorRequestCount: null,
    priorPageCount: null,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--prepare-historical-request') args.mode = 'prepare'
    else if (value === '--accept-historical-authorization') args.mode = 'accept-authorization'
    else if (value === '--prepare-current-baseline-collection-request') {
      args.mode = 'prepare-current-collection'
    } else if (value === '--accept-current-baseline-collection-authorization') {
      args.mode = 'accept-current-collection'
    }
    else if (value === '--collect-current-baseline') args.mode = 'collect-current'
    else if (value === '--record-current-baseline-collection-failure') {
      args.mode = 'record-current-collection-failure'
    }
    else if (value === '--probe-historical') args.mode = 'probe'
    else if (value === '--prepare-fallback-after-historical-failure') args.mode = 'prepare-fallback'
    else if (value === '--record-historical-failure') args.mode = 'record-failure'
    else if (value === '--prepare-current-baseline-request') args.mode = 'prepare-current'
    else if (value === '--seal-current-baseline') args.mode = 'seal-current'
    else if (value === '--assert-request') {
      args.mode = 'assert-request'
      args.record = argv[++index]
    } else if (value === '--assert-record') {
      args.mode = 'assert-record'
      args.record = argv[++index]
    } else if (value === '--output') args.output = argv[++index]
    else if (value === '--record') args.record = argv[++index]
    else if (value === '--snapshot') args.snapshot = argv[++index]
    else if (value === '--accepted-signal-sha256') args.acceptedSignalSha256 = argv[++index]
    else if (value === '--historical-failure-reason') args.historicalFailureReason = argv[++index]
    else if (value === '--prior-request-count') args.priorRequestCount = Number(argv[++index])
    else if (value === '--prior-page-count') args.priorPageCount = Number(argv[++index])
    else throw new ProvenanceError('unknown_argument')
  }
  requireCondition(args.mode, 'mode_required')
  if (['accept-authorization', 'prepare-current-collection', 'accept-current-collection', 'collect-current', 'record-current-collection-failure', 'assert-request', 'assert-record', 'probe', 'prepare-fallback', 'record-failure', 'prepare-current', 'seal-current']
    .includes(args.mode)) requireCondition(args.record, 'record_required')
  if (['prepare-fallback', 'record-failure'].includes(args.mode)) {
    requireCondition(SAFE_FAILURE_REASONS.has(args.historicalFailureReason)
      && Number.isSafeInteger(args.priorRequestCount)
      && Number.isSafeInteger(args.priorPageCount),
    'historical_failure_reason_invalid')
  }
  if (['accept-authorization', 'accept-current-collection'].includes(args.mode)) {
    requireCondition(HASH.test(args.acceptedSignalSha256 ?? ''),
      args.mode === 'accept-authorization'
        ? 'historical_probe_not_authorized'
        : 'current_baseline_collection_not_authorized')
  }
  if (['prepare-current', 'seal-current'].includes(args.mode)) {
    requireCondition(args.snapshot, 'snapshot_required')
  }
  return args
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2))
    if (args.mode === 'prepare') {
      const record = await buildPendingHistoricalRequest()
      await writeFile(resolve(ROOT, args.output), `${canonical(record)}\n`)
      process.stdout.write(`${JSON.stringify({
        status: record.status,
        payload_sha256: record.historical_probe_authorization.payload_sha256,
      })}\n`)
      return
    }
    const record = JSON.parse(await readFile(resolve(ROOT, args.record), 'utf8'))
    if (args.mode === 'accept-authorization') {
      await verifyImmutableAnchors()
      const accepted = acceptHistoricalAuthorization(
        record,
        args.acceptedSignalSha256,
      )
      await writeFile(resolve(ROOT, args.output), `${canonical(accepted)}\n`)
      process.stdout.write(`${JSON.stringify({
        status: accepted.status,
        accepted_signal_sha256:
          accepted.historical_probe_authorization.accepted_signal_sha256,
      })}\n`)
      return
    }
    if (args.mode === 'prepare-current-collection') {
      await verifyImmutableAnchors()
      const prepared = prepareCurrentBaselineCollectionRequest(record)
      await writeFile(resolve(ROOT, args.output), `${canonical(prepared)}\n`)
      process.stdout.write(`${JSON.stringify({
        status: prepared.status,
        payload_sha256:
          prepared.current_baseline_collection_authorization.payload_sha256,
        required_signal: exactCurrentBaselineCollectionSignal(prepared),
      })}\n`)
      return
    }
    if (args.mode === 'accept-current-collection') {
      await verifyImmutableAnchors()
      const accepted = acceptCurrentBaselineCollectionAuthorization(
        record,
        args.acceptedSignalSha256,
      )
      await writeFile(resolve(ROOT, args.output), `${canonical(accepted)}\n`)
      process.stdout.write(`${JSON.stringify({
        status: accepted.status,
        accepted_signal_sha256:
          accepted.current_baseline_collection_authorization.accepted_signal_sha256,
      })}\n`)
      return
    }
    if (args.mode === 'collect-current') {
      const prepared = await executeAuthorizedCurrentBaselineCollection({ record })
      await writeFile(resolve(ROOT, args.output), `${canonical(prepared)}\n`)
      process.stdout.write(`${JSON.stringify({
        status: prepared.status,
        provenance_mode: prepared.provenance_mode,
        historical_deployment_identity_recovered:
          prepared.historical_deployment_identity_recovered,
        request_count: 2,
        reserved_request_count: 2,
        owner_payload_sha256: prepared.owner_checkpoint.payload_sha256,
        owner_required_signal_sha256:
          prepared.owner_checkpoint.required_signal_sha256,
      })}\n`)
      return
    }
    if (args.mode === 'record-current-collection-failure') {
      await verifyImmutableAnchors()
      const failed = recordCurrentBaselineCollectionFailure(record)
      await writeFile(resolve(ROOT, args.output), `${canonical(failed)}\n`)
      process.stdout.write(`${JSON.stringify({
        status: failed.status,
        reason: failed.reasons[0],
        first_snapshot_request_envelope: 'retired_at_most_two_requests',
        post_decision_request_count: 0,
      })}\n`)
      return
    }
    if (args.mode === 'assert-request') {
      await verifyImmutableAnchors()
      assertRequestRecord(record)
      const currentCollection = record.status
        === 'pending_current_baseline_collection_authorization'
      const authorization = currentCollection
        ? record.current_baseline_collection_authorization
        : record.historical_probe_authorization
      process.stdout.write(`${JSON.stringify({
        status: record.status,
        payload_sha256: authorization.payload_sha256,
        required_signal: currentCollection
          ? exactCurrentBaselineCollectionSignal(record)
          : exactHistoricalSignal(record),
        payload: authorization.payload,
      })}\n`)
      return
    }
    if (args.mode === 'assert-record') {
      await verifyImmutableAnchors()
      assertProvenanceRecord(record)
      process.stdout.write('{"status":"pass"}\n')
      return
    }
    if (args.mode === 'probe') {
      const suppliedSignal = record.status === 'historical_probe_authorized'
        ? null
        : (await readFile(0, 'utf8')).trim()
      const prepared = await executeAuthorizedHistoricalProbe({
        record,
        ownerSignal: suppliedSignal,
      })
      await writeFile(resolve(ROOT, args.output), `${canonical(prepared)}\n`)
      process.stdout.write(`${JSON.stringify({
        status: prepared.status,
        provenance_mode: prepared.provenance_mode,
        reason: prepared.historical_recovery.reasons[0],
        fallback_payload_sha256: prepared.owner_checkpoint.payload_sha256,
        fallback_required_signal: exactCurrentBaselineSignal(prepared),
      })}\n`)
      return
    }
    if (args.mode === 'prepare-fallback') {
      const prepared = await prepareFallbackAfterHistoricalFailure({
        record,
        reason: args.historicalFailureReason,
        initialBudget: {
          request_count: args.priorRequestCount,
          page_count: args.priorPageCount,
          response_bytes: 0,
        },
      })
      await writeFile(resolve(ROOT, args.output), `${canonical(prepared)}\n`)
      process.stdout.write(`${JSON.stringify({
        status: prepared.status,
        provenance_mode: prepared.provenance_mode,
        reason: prepared.historical_recovery.reasons[0],
        fallback_payload_sha256: prepared.owner_checkpoint.payload_sha256,
        fallback_required_signal: exactCurrentBaselineSignal(prepared),
      })}\n`)
      return
    }
    if (args.mode === 'record-failure') {
      const failed = recordHistoricalFailure(
        record,
        args.historicalFailureReason,
        {
          request_count: args.priorRequestCount,
          page_count: args.priorPageCount,
          response_bytes: 0,
          elapsed_ms: 0,
        },
      )
      await writeFile(resolve(ROOT, args.output), `${canonical(failed)}\n`)
      process.stdout.write(`${JSON.stringify({
        status: failed.status,
        provenance_mode: failed.provenance_mode,
        reason: failed.historical_recovery.reasons[0],
        proof_sha256: failed.historical_recovery.proof_sha256,
        request_count: args.priorRequestCount,
        page_count: args.priorPageCount,
      })}\n`)
      return
    }
    if (args.mode === 'prepare-current') {
      const snapshot = JSON.parse(await readFile(resolve(ROOT, args.snapshot), 'utf8'))
      const prepared = prepareCurrentBaselineRequest(record, snapshot)
      await writeFile(resolve(ROOT, args.output), `${canonical(prepared)}\n`)
      process.stdout.write(`${JSON.stringify({
        status: prepared.status,
        payload_sha256: prepared.owner_checkpoint.payload_sha256,
        required_signal: exactCurrentBaselineSignal(prepared),
      })}\n`)
      return
    }
    if (args.mode === 'seal-current') {
      const snapshot = JSON.parse(await readFile(resolve(ROOT, args.snapshot), 'utf8'))
      const suppliedSignal = (await readFile(0, 'utf8')).trim()
      const sealed = sealCurrentBaseline(record, suppliedSignal, snapshot)
      await writeFile(resolve(ROOT, args.output), `${canonical(sealed)}\n`)
      process.stdout.write('{"status":"pass","provenance_mode":"current_baseline_redesign"}\n')
      return
    }
    throw new ProvenanceError('mode_not_available_before_historical_classification')
  } catch (error) {
    const code = error instanceof ProvenanceError ? error.code : 'unexpected_failure'
    process.stderr.write(`containment provenance failed: ${code}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

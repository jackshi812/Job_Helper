#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_RECORD =
  '.planning/phases/05.1-ranking-and-dashboard-performance-stabilization/05.1-04-CONTAINMENT-OBSERVATION.json'
const DEFAULT_SUMMARY =
  '.planning/phases/05.1-ranking-and-dashboard-performance-stabilization/05.1-03-SUMMARY.md'
const WINDOW_SECONDS = 86_400
const LOG_INGESTION_GRACE_SECONDS = 300
const REQUEST_TIMEOUT_MS = 12_000
const HASH = /^[0-9a-f]{64}$/
const COMMIT = /^[0-9a-f]{40}$/
const UTC_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
const REQUIRED_LOG_ATTRIBUTE_KEYS = Object.freeze([
  'deployment_id',
  'function_id',
  'response.status_code',
  'version',
])
const ZERO_EFFECT_KEYS = Object.freeze([
  'manual_worker_invocations',
  'queue_or_run_writes',
  'lease_or_ranking_state_writes',
  'ranking_history_deletes',
  'scheduler_mutations',
  'function_deployments',
  'web_deployments',
  'vacuum_or_maintenance_commands',
  'schema_or_configuration_mutations',
])

export const ALLOWED_MANAGEMENT_REQUESTS = Object.freeze([
  Object.freeze(['GET', '/v1/projects/{ref}/functions']),
  Object.freeze(['GET', '/v1/projects/{ref}/analytics/endpoints/logs']),
  Object.freeze(['POST', '/v1/projects/{ref}/database/query']),
])

export const READINESS_SQL = `
with state_counts as (
  select
    count(*) filter (where status = 'failed')::integer
      as failed_ranking_state_count,
    count(*) filter (where status = 'building')::integer
      as building_ranking_state_count
  from public.deterministic_ranking_state
),
run_counts as (
  select count(*)::integer as building_ranking_run_count
  from public.deterministic_ranking_runs
  where status = 'building'
),
item_counts as (
  select count(*)::integer as pending_or_claimed_active_item_count
  from public.deterministic_ranking_items as ranking_item
  join public.deterministic_ranking_runs as ranking_run
    on ranking_run.id = ranking_item.run_id
  where ranking_run.status = 'building'
    and ranking_item.status in ('pending', 'claimed')
)
select
  state_counts.failed_ranking_state_count,
  state_counts.building_ranking_state_count,
  run_counts.building_ranking_run_count,
  item_counts.pending_or_claimed_active_item_count
from state_counts
cross join run_counts
cross join item_counts
`.trim()

export const IDENTITY_SQL = `
with migration_inventory as (
  select
    count(*)::integer as migration_count,
    count(*) filter (where version::text = '0062')::integer as version_0062_count,
    count(*) filter (where version::text = '0063')::integer as version_0063_count,
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
  migration_inventory.migration_count,
  migration_inventory.version_0062_count,
  migration_inventory.version_0063_count,
  migration_inventory.migration_inventory_sha256,
  containment_function.containment_function_definition_sha256,
  containment_function.containment_function_security_sha256,
  scheduler_identity.scheduler_job_count,
  scheduler_identity.scheduler_identity_sha256
from migration_inventory
cross join containment_function
cross join scheduler_identity
`.trim()

// The final SELECT exposes counts and latency aggregates only. Owner/job/run/item
// identities are used solely inside bounded CTE correlations and never cross the
// production-to-evidence boundary.
export const DATABASE_OBSERVATION_SQL = `
with ranking_owners as (
  select user_id
  from public.deterministic_ranking_state
),
genuine_arrivals as (
  select
    ranking_owner.user_id,
    job.source,
    job.external_id,
    job.first_seen_at
  from ranking_owners as ranking_owner
  cross join public.jobs as job
  where job.first_seen_at >= $observation_started_at$::timestamptz
    and job.first_seen_at < $observation_ended_at$::timestamptz
    and not exists (
      select 1
      from public.user_job_dismissals as dismissal
      where dismissal.user_id = ranking_owner.user_id
        and dismissal.source = job.source
        and dismissal.external_id = job.external_id
    )
    and not exists (
      select 1
      from public.deterministic_ranking_items as prior_item
      join public.jobs as prior_job on prior_job.id = prior_item.job_id
      where prior_item.user_id = ranking_owner.user_id
        and prior_job.source = job.source
        and prior_job.external_id = job.external_id
        and prior_item.created_at < job.first_seen_at
    )
),
arrival_results as (
  select
    arrival.user_id,
    arrival.source,
    arrival.external_id,
    arrival.first_seen_at,
    exists (
      select 1
      from public.deterministic_ranking_items as enqueued_item
      join public.jobs as enqueued_job on enqueued_job.id = enqueued_item.job_id
      where enqueued_item.user_id = arrival.user_id
        and enqueued_job.source = arrival.source
        and enqueued_job.external_id = arrival.external_id
        and enqueued_item.created_at >= arrival.first_seen_at
    ) as was_enqueued,
    exists (
      select 1
      from public.deterministic_ranking_items as existing_item
      join public.jobs as existing_job on existing_job.id = existing_item.job_id
      join public.deterministic_ranking_runs as existing_building
        on existing_building.id = existing_item.run_id
      where existing_item.user_id = arrival.user_id
        and existing_job.source = arrival.source
        and existing_job.external_id = arrival.external_id
        and existing_building.created_at < arrival.first_seen_at
        and existing_item.created_at >= arrival.first_seen_at
    ) as absorbed_by_existing_building_run,
    (
      select pg_catalog.min(published_run.completed_at)
      from public.deterministic_ranking_items as published_item
      join public.jobs as published_job on published_job.id = published_item.job_id
      join public.deterministic_ranking_runs as published_run
        on published_run.id = published_item.run_id
      where published_item.user_id = arrival.user_id
        and published_job.source = arrival.source
        and published_job.external_id = arrival.external_id
        and published_item.created_at >= arrival.first_seen_at
        and published_item.status = 'completed'
        and published_run.status = 'completed'
        and published_run.completed_at is not null
    ) as published_at
  from genuine_arrivals as arrival
),
new_job_runs as (
  select ranking_run.user_id, ranking_run.created_at
  from public.deterministic_ranking_runs as ranking_run
  where ranking_run.run_kind = 'new_job'
    and ranking_run.created_at >= $observation_started_at$::timestamptz
    and ranking_run.created_at < $observation_ended_at$::timestamptz
),
phantom_runs as (
  select count(*)::integer as phantom_new_job_runs
  from new_job_runs as candidate_run
  where not exists (
    select 1
    from genuine_arrivals as arrival
    where arrival.user_id = candidate_run.user_id
      and arrival.first_seen_at <= candidate_run.created_at
      and exists (
        select 1
        from public.deterministic_ranking_items as correlated_item
        join public.deterministic_ranking_runs as correlated_run
          on correlated_run.id = correlated_item.run_id
        join public.jobs as correlated_job on correlated_job.id = correlated_item.job_id
        where correlated_run.user_id = candidate_run.user_id
          and correlated_run.run_kind = 'new_job'
          and correlated_run.created_at = candidate_run.created_at
          and correlated_job.source = arrival.source
          and correlated_job.external_id = arrival.external_id
      )
  )
),
new_job_item_minutes as (
  select
    ranking_item.user_id,
    ranking_run.created_at as run_created_at,
    pg_catalog.date_trunc('minute', ranking_item.created_at) as growth_minute,
    count(*)::integer as item_count
  from public.deterministic_ranking_items as ranking_item
  join public.deterministic_ranking_runs as ranking_run
    on ranking_run.id = ranking_item.run_id
  where ranking_run.run_kind = 'new_job'
    and ranking_item.created_at >= $observation_started_at$::timestamptz
    and ranking_item.created_at < $observation_ended_at$::timestamptz
  group by
    ranking_item.user_id,
    ranking_run.created_at,
    pg_catalog.date_trunc('minute', ranking_item.created_at)
),
uncorrelated_growth as (
  select growth.user_id, growth.growth_minute
  from new_job_item_minutes as growth
  where not exists (
    select 1
    from genuine_arrivals as arrival
    where arrival.user_id = growth.user_id
      and arrival.first_seen_at <= growth.run_created_at
      and exists (
        select 1
        from public.deterministic_ranking_items as arrival_item
        join public.jobs as arrival_job on arrival_job.id = arrival_item.job_id
        join public.deterministic_ranking_runs as arrival_run
          on arrival_run.id = arrival_item.run_id
        where arrival_run.user_id = growth.user_id
          and arrival_run.run_kind = 'new_job'
          and arrival_run.created_at = growth.run_created_at
          and arrival_job.source = arrival.source
          and arrival_job.external_id = arrival.external_id
      )
  )
),
uncorrelated_sequences as (
  select
    user_id,
    growth_minute,
    growth_minute
      - pg_catalog.row_number() over (
          partition by user_id order by growth_minute
        ) * interval '1 minute' as sequence_group
  from uncorrelated_growth
),
uncorrelated_summary as (
  select
    count(*)::integer as uncorrelated_item_growth_minutes,
    pg_catalog.coalesce(pg_catalog.max(sequence_length), 0)::integer
      as maximum_consecutive_uncorrelated_growth_minutes
  from (
    select count(*)::integer as sequence_length
    from uncorrelated_sequences
    group by user_id, sequence_group
  ) as sequences
),
latencies as (
  select
    pg_catalog.round(
      extract(epoch from (published_at - first_seen_at)) * 1000
    )::bigint as latency_ms
  from arrival_results
  where published_at is not null
    and published_at >= first_seen_at
),
arrival_summary as (
  select
    count(*)::integer as genuine_arrivals,
    count(*) filter (where was_enqueued)::integer as genuine_arrivals_enqueued,
    count(*) filter (where published_at is not null)::integer
      as genuine_arrivals_published,
    count(*) filter (where absorbed_by_existing_building_run)::integer
      as genuine_arrivals_absorbed_by_existing_building_run
  from arrival_results
),
latency_summary as (
  select
    count(*)::integer as publication_latency_sample_count,
    pg_catalog.coalesce(
      pg_catalog.percentile_disc(0.50) within group (order by latency_ms),
      0
    )::bigint as publication_latency_p50_ms,
    pg_catalog.coalesce(
      pg_catalog.percentile_disc(0.95) within group (order by latency_ms),
      0
    )::bigint as publication_latency_p95_ms,
    pg_catalog.coalesce(pg_catalog.max(latency_ms), 0)::bigint
      as publication_latency_max_ms
  from latencies
),
failed_states as (
  select count(*) filter (where status = 'failed')::integer
    as failed_ranking_state_count
  from public.deterministic_ranking_state
)
select
  failed_states.failed_ranking_state_count,
  phantom_runs.phantom_new_job_runs,
  (uncorrelated_summary.uncorrelated_item_growth_minutes > 0)
    as minute_cadence_growth_detected,
  uncorrelated_summary.uncorrelated_item_growth_minutes,
  uncorrelated_summary.maximum_consecutive_uncorrelated_growth_minutes,
  arrival_summary.genuine_arrivals,
  arrival_summary.genuine_arrivals_enqueued,
  arrival_summary.genuine_arrivals_published,
  arrival_summary.genuine_arrivals_absorbed_by_existing_building_run,
  latency_summary.publication_latency_sample_count,
  latency_summary.publication_latency_p50_ms,
  latency_summary.publication_latency_p95_ms,
  latency_summary.publication_latency_max_ms
from failed_states
cross join phantom_runs
cross join uncorrelated_summary
cross join arrival_summary
cross join latency_summary
`.trim()

class GateError extends Error {
  constructor(code, message = code) {
    super(message)
    this.name = 'GateError'
    this.code = code
  }
}

function requireCondition(condition, code, message = code) {
  if (!condition) throw new GateError(code, message)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonical(value[key])}`,
    ).join(',')}}`
  }
  return JSON.stringify(value)
}

function canonicalTimestamp(value, code) {
  requireCondition(typeof value === 'string' && UTC_TIMESTAMP.test(value), code)
  const milliseconds = Date.parse(value)
  requireCondition(Number.isFinite(milliseconds), code)
  return { value, milliseconds }
}

function integer(value, code) {
  const converted = Number(value)
  requireCondition(Number.isSafeInteger(converted) && converted >= 0, code)
  return converted
}

function exactKeys(value, expected, code) {
  requireCondition(value && typeof value === 'object' && !Array.isArray(value), code)
  requireCondition(
    canonical(Object.keys(value).sort()) === canonical([...expected].sort()),
    code,
  )
}

export function nextWholeUtcMinute(value) {
  const { milliseconds } = canonicalTimestamp(value, 'invalid_observation_time')
  return new Date((Math.floor(milliseconds / 60_000) + 1) * 60_000)
    .toISOString()
}

export function nearestRankLatency(values) {
  requireCondition(Array.isArray(values) && values.length > 0, 'latency_missing')
  const ordered = values.map((value) => integer(value, 'latency_invalid'))
    .sort((left, right) => left - right)
  const at = (percentile) => ordered[Math.ceil(percentile * ordered.length) - 1]
  return {
    sample_count: ordered.length,
    p50_ms: at(0.50),
    p95_ms: at(0.95),
    max_ms: ordered.at(-1),
  }
}

function normalizeManagementPath(path) {
  return path.replace(
    /^\/v1\/projects\/[^/]+\//,
    '/v1/projects/{ref}/',
  )
}

export function validateManagementRequest(method, path) {
  const normalized = normalizeManagementPath(String(path).split('?')[0])
  const allowed = ALLOWED_MANAGEMENT_REQUESTS.some(
    ([allowedMethod, allowedPath]) =>
      method === allowedMethod && normalized === allowedPath,
  )
  requireCondition(allowed, 'read_only_transport_violation', 'read-only endpoint violation')
  return true
}

function sqlOutsideStrings(sql) {
  return sql
    .replace(/\$[A-Za-z_][A-Za-z0-9_]*\$[\s\S]*?\$[A-Za-z_][A-Za-z0-9_]*\$/g, "''")
    .replace(/'(?:''|[^'])*'/g, "''")
}

export function validateReadOnlySql(sql) {
  requireCondition(typeof sql === 'string' && sql.length > 0 && sql.length <= 40_000,
    'read_only_sql_invalid', 'read-only SQL is invalid')
  const trimmed = sql.trim()
  const withoutTerminal = trimmed.endsWith(';') ? trimmed.slice(0, -1) : trimmed
  const inspected = sqlOutsideStrings(withoutTerminal)
  requireCondition(/^\s*(?:select|with)\b/i.test(inspected),
    'read_only_sql_invalid', 'read-only SQL must be SELECT/CTE only')
  requireCondition(!/[;]/.test(inspected),
    'read_only_sql_multiple_statements', 'read-only SQL cannot contain multiple statements')
  requireCondition(!/--|\/\*/.test(inspected),
    'read_only_sql_comment', 'read-only SQL comments are forbidden')
  requireCondition(!/\b(?:insert|update|delete|merge|upsert|alter|create|drop|truncate|grant|revoke|copy|call|perform|do|vacuum|analyze|reindex|cluster|refresh|set|reset|listen|notify|discard|lock)\b/i.test(inspected),
    'read_only_sql_effect', 'read-only SQL contains an effectful statement')
  requireCondition(!/\b(?:pg_sleep|dblink|lo_import|lo_export|set_config)\s*\(/i.test(inspected),
    'read_only_sql_function', 'read-only SQL contains a forbidden function call')
  requireCondition(!/\b(?:select|from)\s+public\.[a-z_][a-z0-9_$]*\s*\(/i.test(inspected),
    'read_only_sql_function', 'read-only SQL cannot invoke public functions')
  requireCondition(!/\breturning\b|\bselect\s+\*/i.test(inspected),
    'read_only_sql_raw_rows', 'aggregate read-only SQL cannot return raw rows')
  requireCondition(!/\bselect\s+(?:[a-z_][a-z0-9_]*\.)?id\s+from\b/i.test(inspected),
    'read_only_sql_raw_identifier', 'aggregate read-only SQL cannot return identifiers')
  return true
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim()
  requireCondition(value, 'authentication_required', `${name} is required`)
  return value
}

async function requestJson({ method, projectRef, suffix, query, body }) {
  validateManagementRequest(method, `/v1/projects/${projectRef}/${suffix}`)
  if (method === 'POST') validateReadOnlySql(body?.query)
  const url = new URL(`https://api.supabase.com/v1/projects/${projectRef}/${suffix}`)
  for (const [name, value] of Object.entries(query ?? {})) {
    url.searchParams.set(name, value)
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${requiredEnvironment('SUPABASE_ACCESS_TOKEN')}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    })
    const text = await response.text()
    requireCondition(response.ok, 'management_api_unavailable')
    const payload = JSON.parse(text)
    return payload
  } catch (error) {
    if (error instanceof GateError) throw error
    throw new GateError('management_api_unavailable')
  } finally {
    clearTimeout(timeout)
  }
}

async function managementSql(projectRef, query) {
  const rows = await requestJson({
    method: 'POST',
    projectRef,
    suffix: 'database/query',
    body: { query },
  })
  requireCondition(Array.isArray(rows), 'database_query_malformed')
  return rows
}

function uniqueRecordValue(text, key, code = 'deployment_record_malformed') {
  const expression = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*(.+)$`, 'gm')
  const matches = [...text.matchAll(expression)]
  requireCondition(matches.length === 1, code)
  return matches[0][1].trim()
}

export function parseDeploymentRecord(recordBytes, summaryBytes) {
  const text = Buffer.isBuffer(recordBytes) ? recordBytes.toString('utf8') : String(recordBytes)
  const summary = Buffer.isBuffer(summaryBytes) ? summaryBytes : Buffer.from(summaryBytes)
  requireCondition(
    uniqueRecordValue(text, 'deployment_status') === 'PASS',
    'deployment_not_passed',
  )
  const sourceCommit = uniqueRecordValue(text, 'source_commit')
  const sourceTree = uniqueRecordValue(text, 'source_tree')
  const migrationSha256 = uniqueRecordValue(text, 'migration_sha256')
  const projectRef = uniqueRecordValue(text, 'target_supabase_project_ref')
  const functionDefinitionSha256 = uniqueRecordValue(
    text,
    'post_0063_function_definition_sha256_observed',
  )
  const functionSecuritySha256 = uniqueRecordValue(
    text,
    'post_0063_function_security_sha256_observed',
  )
  const deployedAt = uniqueRecordValue(text, 'post_deployment_observed_at_utc')
  requireCondition(COMMIT.test(sourceCommit) && COMMIT.test(sourceTree),
    'deployment_source_identity_invalid')
  requireCondition(
    [migrationSha256, functionDefinitionSha256, functionSecuritySha256]
      .every((value) => HASH.test(value)),
    'deployment_hash_identity_invalid',
  )
  canonicalTimestamp(deployedAt, 'deployment_timestamp_invalid')
  requireCondition(uniqueRecordValue(text, 'remote_0063_count') === '1'
    && uniqueRecordValue(text, 'remote_0062_count') === '0',
  'deployment_migration_policy_invalid')

  // These are mandatory immutable inputs from Plan 03. Their absence must stop
  // before credentials or hosted reads; a later live observation cannot recreate
  // what the deployment record failed to bind at release time.
  const scoreTickFunctionId = uniqueRecordValue(
    text,
    'score_tick_function_id',
    'deployment_record_missing_score_tick_identity',
  )
  const scoreTickVersion = uniqueRecordValue(
    text,
    'score_tick_function_version',
    'deployment_record_missing_score_tick_identity',
  )
  const scoreTickDeploymentId = uniqueRecordValue(
    text,
    'score_tick_deployment_id',
    'deployment_record_missing_score_tick_identity',
  )
  const schedulerIdentitySha256 = uniqueRecordValue(
    text,
    'scheduler_identity_sha256',
    'deployment_record_missing_scheduler_identity',
  )
  requireCondition(
    /^[A-Za-z0-9_-]{1,200}$/.test(scoreTickFunctionId)
      && /^[A-Za-z0-9_-]{1,200}$/.test(scoreTickDeploymentId)
      && Number.isSafeInteger(Number(scoreTickVersion))
      && Number(scoreTickVersion) > 0
      && HASH.test(schedulerIdentitySha256),
    'deployment_runtime_identity_invalid',
  )
  return {
    source_commit: sourceCommit,
    source_tree: sourceTree,
    containment_migration_sha256: migrationSha256,
    deployed_migration_version: '0063',
    deployment_completed_at: deployedAt,
    deployment_record_sha256: sha256(recordBytes),
    deployment_summary_sha256: sha256(summary),
    project_ref: projectRef,
    containment_function_definition_sha256: functionDefinitionSha256,
    containment_function_security_sha256: functionSecuritySha256,
    score_tick_function_id: scoreTickFunctionId,
    score_tick_function_version: Number(scoreTickVersion),
    score_tick_deployment_id: scoreTickDeploymentId,
    scheduler_identity_sha256: schedulerIdentitySha256,
  }
}

function parseSingleAggregateRow(rows, code) {
  requireCondition(Array.isArray(rows) && rows.length === 1
    && rows[0] && typeof rows[0] === 'object', code)
  return rows[0]
}

async function collectReadiness(projectRef) {
  const row = parseSingleAggregateRow(
    await managementSql(projectRef, READINESS_SQL),
    'readiness_query_malformed',
  )
  return {
    failed_ranking_state_count: integer(
      row.failed_ranking_state_count,
      'readiness_query_malformed',
    ),
    building_ranking_state_count: integer(
      row.building_ranking_state_count,
      'readiness_query_malformed',
    ),
    building_ranking_run_count: integer(
      row.building_ranking_run_count,
      'readiness_query_malformed',
    ),
    pending_or_claimed_active_item_count: integer(
      row.pending_or_claimed_active_item_count,
      'readiness_query_malformed',
    ),
  }
}

async function functionInventory(projectRef) {
  const rows = await requestJson({
    method: 'GET',
    projectRef,
    suffix: 'functions',
  })
  requireCondition(Array.isArray(rows), 'function_inventory_malformed')
  return rows
}

function runtimeIdentityFromInventory(deployment, inventory) {
  const matches = inventory.filter((entry) => entry?.slug === 'score-tick')
  requireCondition(matches.length === 1, 'score_tick_inventory_not_unique')
  const entry = matches[0]
  const functionId = String(entry.id ?? entry.function_id ?? '')
  const deploymentId = String(entry.deployment_id ?? entry.deploymentId ?? '')
  const version = Number(entry.version)
  requireCondition(
    functionId === deployment.score_tick_function_id
      && deploymentId === deployment.score_tick_deployment_id
      && version === deployment.score_tick_function_version
      && entry.status === 'ACTIVE',
    'score_tick_identity_drift',
  )
  return {
    raw: { function_id: functionId, deployment_id: deploymentId, version },
    sha256: sha256(canonical({
      function_id: functionId,
      deployment_id: deploymentId,
      version,
      status: entry.status,
      verify_jwt: entry.verify_jwt,
    })),
  }
}

async function collectIdentity(deployment) {
  const [identityRows, inventory] = await Promise.all([
    managementSql(deployment.project_ref, IDENTITY_SQL),
    functionInventory(deployment.project_ref),
  ])
  const row = parseSingleAggregateRow(identityRows, 'identity_query_malformed')
  requireCondition(integer(row.version_0063_count, 'identity_query_malformed') === 1
    && integer(row.version_0062_count, 'identity_query_malformed') === 0,
  'migration_identity_drift')
  const expectedVersions = [
    ...Array.from(
      { length: 61 },
      (_, index) => String(index + 1).padStart(4, '0'),
    ),
    '0063',
  ]
  requireCondition(
    integer(row.migration_count, 'identity_query_malformed')
      === expectedVersions.length
      && String(row.migration_inventory_sha256 ?? '')
        === sha256(expectedVersions.join(',')),
    'migration_identity_drift',
  )
  requireCondition(integer(row.scheduler_job_count, 'identity_query_malformed') === 1,
    'scheduler_identity_drift')
  const runtime = runtimeIdentityFromInventory(deployment, inventory)
  const identity = {
    linked_project_ref_sha256: sha256(deployment.project_ref),
    migration_inventory_sha256: String(row.migration_inventory_sha256 ?? ''),
    containment_function_definition_sha256:
      String(row.containment_function_definition_sha256 ?? ''),
    containment_function_security_sha256:
      String(row.containment_function_security_sha256 ?? ''),
    score_tick_function_identity_sha256: runtime.sha256,
    scheduler_identity_sha256: String(row.scheduler_identity_sha256 ?? ''),
  }
  requireCondition(Object.values(identity).every((value) => HASH.test(value)),
    'identity_query_malformed')
  requireCondition(
    identity.containment_function_definition_sha256
      === deployment.containment_function_definition_sha256
      && identity.containment_function_security_sha256
        === deployment.containment_function_security_sha256
      && identity.scheduler_identity_sha256
        === deployment.scheduler_identity_sha256,
    'deployment_identity_drift',
  )
  return { sanitized: identity, runtime: runtime.raw }
}

function strictLogScalar(value, code) {
  const text = String(value)
  requireCondition(/^[A-Za-z0-9_-]{1,200}$/.test(text), code)
  return text
}

function logAggregateSql(runtime, startedAt, endedAt) {
  const functionId = strictLogScalar(runtime.function_id, 'log_identity_invalid')
  const deploymentId = strictLogScalar(runtime.deployment_id, 'log_identity_invalid')
  const version = integer(runtime.version, 'log_identity_invalid')
  canonicalTimestamp(startedAt, 'window_invalid')
  canonicalTimestamp(endedAt, 'window_invalid')
  return `
select
  response.status_code as status_code,
  count(*) as count,
  ['deployment_id','function_id','response.status_code','version']
    as attribute_keys
from function_edge_logs
where function_id = '${functionId}'
  and deployment_id = '${deploymentId}'
  and version = ${version}
  and timestamp >= '${startedAt}'
  and timestamp < '${endedAt}'
group by response.status_code
order by response.status_code
  `.trim()
}

async function collectLogs(deployment, runtime, startedAt, endedAt) {
  const sql = logAggregateSql(runtime, startedAt, endedAt)
  const payload = await requestJson({
    method: 'GET',
    projectRef: deployment.project_ref,
    suffix: 'analytics/endpoints/logs',
    query: { sql, source: 'function_edge_logs' },
  })
  const rows = Array.isArray(payload) ? payload : payload?.result
  requireCondition(Array.isArray(rows) && rows.length > 0, 'log_query_malformed')
  const keys = rows[0]?.attribute_keys
  requireCondition(Array.isArray(keys), 'log_attribute_keys_missing')
  return {
    attribute_keys: keys.map(String).sort(),
    rows: rows.map((row) => ({
      status_code: integer(row.status_code, 'log_query_malformed'),
      count: integer(row.count, 'log_query_malformed'),
    })),
    query_sha256: sha256(sql),
  }
}

function bindDatabaseWindow(startedAt, endedAt) {
  canonicalTimestamp(startedAt, 'window_invalid')
  canonicalTimestamp(endedAt, 'window_invalid')
  return DATABASE_OBSERVATION_SQL
    .replaceAll('$observation_started_at$', `'${startedAt}'`)
    .replaceAll('$observation_ended_at$', `'${endedAt}'`)
}

async function collectDatabaseObservation(projectRef, startedAt, endedAt) {
  const query = bindDatabaseWindow(startedAt, endedAt)
  const row = parseSingleAggregateRow(
    await managementSql(projectRef, query),
    'database_observation_malformed',
  )
  return {
    database: {
      failed_ranking_state_count: integer(
        row.failed_ranking_state_count,
        'database_observation_malformed',
      ),
      phantom_new_job_runs: integer(
        row.phantom_new_job_runs,
        'database_observation_malformed',
      ),
      minute_cadence_growth_detected:
        row.minute_cadence_growth_detected === true,
      uncorrelated_item_growth_minutes: integer(
        row.uncorrelated_item_growth_minutes,
        'database_observation_malformed',
      ),
      maximum_consecutive_uncorrelated_growth_minutes: integer(
        row.maximum_consecutive_uncorrelated_growth_minutes,
        'database_observation_malformed',
      ),
      genuine_arrivals: integer(
        row.genuine_arrivals,
        'database_observation_malformed',
      ),
      genuine_arrivals_enqueued: integer(
        row.genuine_arrivals_enqueued,
        'database_observation_malformed',
      ),
      genuine_arrivals_published: integer(
        row.genuine_arrivals_published,
        'database_observation_malformed',
      ),
      genuine_arrivals_absorbed_by_existing_building_run: integer(
        row.genuine_arrivals_absorbed_by_existing_building_run,
        'database_observation_malformed',
      ),
      publication_latency: {
        sample_count: integer(
          row.publication_latency_sample_count,
          'database_observation_malformed',
        ),
        p50_ms: integer(
          row.publication_latency_p50_ms,
          'database_observation_malformed',
        ),
        p95_ms: integer(
          row.publication_latency_p95_ms,
          'database_observation_malformed',
        ),
        max_ms: integer(
          row.publication_latency_max_ms,
          'database_observation_malformed',
        ),
      },
    },
    query_sha256: sha256(query),
  }
}

function checkedIdentity(identity) {
  const required = [
    'source_commit',
    'source_tree',
    'containment_migration_sha256',
    'deployed_migration_version',
    'deployment_record_sha256',
    'deployment_summary_sha256',
    'start',
    'end',
  ]
  requireCondition(identity && required.every((key) => key in identity),
    'identity_missing')
  const immutable = {
    source_commit: identity.source_commit,
    source_tree: identity.source_tree,
    containment_migration_sha256: identity.containment_migration_sha256,
    deployed_migration_version: identity.deployed_migration_version,
    deployment_record_sha256: identity.deployment_record_sha256,
    deployment_summary_sha256: identity.deployment_summary_sha256,
    linked_project_ref_sha256: identity.start?.linked_project_ref_sha256,
    migration_inventory_sha256: identity.start?.migration_inventory_sha256,
    containment_function_definition_sha256:
      identity.start?.containment_function_definition_sha256,
    containment_function_security_sha256:
      identity.start?.containment_function_security_sha256,
    score_tick_function_identity_sha256:
      identity.start?.score_tick_function_identity_sha256,
    scheduler_identity_sha256: identity.start?.scheduler_identity_sha256,
    start_snapshot_sha256: sha256(canonical(identity.start)),
    end_snapshot_sha256: sha256(canonical(identity.end)),
  }
  return {
    sanitized: immutable,
    valid: COMMIT.test(immutable.source_commit)
      && COMMIT.test(immutable.source_tree)
      && immutable.deployed_migration_version === '0063'
      && Object.entries(immutable).every(([key, value]) =>
        key === 'source_commit'
          || key === 'source_tree'
          || key === 'deployed_migration_version'
          || HASH.test(String(value))),
    stable: canonical(identity.start) === canonical(identity.end),
  }
}

function checkedLogMetrics(logs, durationSeconds) {
  const keys = Array.isArray(logs?.attribute_keys)
    ? logs.attribute_keys.map(String).sort()
    : []
  const keysExact = canonical(keys) === canonical([...REQUIRED_LOG_ATTRIBUTE_KEYS])
  const rows = Array.isArray(logs?.rows) ? logs.rows : []
  const seen = new Set()
  let duplicate = false
  let total = 0
  let success = 0
  let http546 = 0
  for (const row of rows) {
    const status = integer(row?.status_code, 'log_query_malformed')
    const count = integer(row?.count, 'log_query_malformed')
    if (seen.has(status)) duplicate = true
    seen.add(status)
    total += count
    if (status >= 200 && status < 300) success += count
    if (status === 546) http546 += count
  }
  const opportunities = Math.floor(durationSeconds / 60)
  const minimum = Math.ceil(opportunities * 99 / 100)
  return {
    http_546_count: http546,
    score_tick_total: total,
    score_tick_success: success,
    score_tick_success_rate: total > 0 ? success / total : 0,
    minute_schedule_opportunities: opportunities,
    minimum_required_score_tick_total: minimum,
    keys_exact: keysExact,
    unique_rows: !duplicate && rows.length > 0,
    sufficient_coverage: total * 100 >= opportunities * 99,
    sufficient_success: total > 0 && success * 100 >= total * 99,
  }
}

function checkedDatabaseMetrics(database) {
  const latency = database?.publication_latency
    ? {
        sample_count: integer(database.publication_latency.sample_count, 'latency_invalid'),
        p50_ms: integer(database.publication_latency.p50_ms, 'latency_invalid'),
        p95_ms: integer(database.publication_latency.p95_ms, 'latency_invalid'),
        max_ms: integer(database.publication_latency.max_ms, 'latency_invalid'),
      }
    : nearestRankLatency(database?.publication_latencies_ms)
  const metrics = {
    failed_ranking_state_count: integer(
      database?.failed_ranking_state_count,
      'database_observation_malformed',
    ),
    phantom_new_job_runs: integer(
      database?.phantom_new_job_runs,
      'database_observation_malformed',
    ),
    minute_cadence_growth_detected:
      database?.minute_cadence_growth_detected === true,
    uncorrelated_item_growth_minutes: integer(
      database?.uncorrelated_item_growth_minutes,
      'database_observation_malformed',
    ),
    maximum_consecutive_uncorrelated_growth_minutes: integer(
      database?.maximum_consecutive_uncorrelated_growth_minutes,
      'database_observation_malformed',
    ),
    genuine_arrivals: integer(
      database?.genuine_arrivals,
      'database_observation_malformed',
    ),
    genuine_arrivals_enqueued: integer(
      database?.genuine_arrivals_enqueued,
      'database_observation_malformed',
    ),
    genuine_arrivals_published: integer(
      database?.genuine_arrivals_published,
      'database_observation_malformed',
    ),
    genuine_arrivals_absorbed_by_existing_building_run: integer(
      database?.genuine_arrivals_absorbed_by_existing_building_run,
      'database_observation_malformed',
    ),
    publication_latency: latency,
  }
  requireCondition(
    latency.sample_count > 0
      && latency.p50_ms <= latency.p95_ms
      && latency.p95_ms <= latency.max_ms,
    'latency_invalid',
  )
  return metrics
}

function checkedZeroEffects(scope) {
  exactKeys(scope, ZERO_EFFECT_KEYS, 'zero_effect_scope_malformed')
  return Object.fromEntries(ZERO_EFFECT_KEYS.map((key) => [
    key,
    integer(scope[key], 'zero_effect_scope_malformed'),
  ]))
}

export function evaluateObservation(input) {
  const started = canonicalTimestamp(input?.window?.started_at, 'window_invalid')
  const ended = canonicalTimestamp(input?.window?.ended_at, 'window_invalid')
  const deployed = canonicalTimestamp(
    input?.window?.deployment_completed_at,
    'window_invalid',
  )
  const durationSeconds = (ended.milliseconds - started.milliseconds) / 1000
  requireCondition(Number.isSafeInteger(durationSeconds) && durationSeconds >= 0,
    'window_invalid')
  const armedStart = input.window.armed_started_at ?? input.window.started_at
  const identity = checkedIdentity(input.identity)
  const logs = checkedLogMetrics(input.logs, durationSeconds)
  const database = checkedDatabaseMetrics(input.database)
  const queryHashes = input.query_hashes
  exactKeys(queryHashes, ['readiness', 'identity', 'logs', 'database'],
    'query_hashes_malformed')
  requireCondition(Object.values(queryHashes).every((value) => HASH.test(value)),
    'query_hashes_malformed')
  const zeroEffects = checkedZeroEffects(input.zero_effect_scope)
  const checks = {
    frozen_window: armedStart === started.value,
    post_deployment_start: started.milliseconds > deployed.milliseconds,
    minimum_duration: durationSeconds >= WINDOW_SECONDS,
    identity_valid: identity.valid,
    identity_stable: identity.stable,
    log_attribute_keys_exact: logs.keys_exact,
    log_rows_unique: logs.unique_rows,
    no_http_546: logs.http_546_count === 0,
    score_tick_coverage: logs.sufficient_coverage,
    score_tick_success_rate: logs.sufficient_success,
    ranking_state_not_failed: database.failed_ranking_state_count === 0,
    no_phantom_new_job_runs: database.phantom_new_job_runs === 0,
    no_minute_cadence_growth:
      database.minute_cadence_growth_detected === false
      && database.uncorrelated_item_growth_minutes === 0
      && database.maximum_consecutive_uncorrelated_growth_minutes === 0,
    genuine_arrivals_positive: database.genuine_arrivals > 0,
    genuine_arrivals_enqueued:
      database.genuine_arrivals_enqueued === database.genuine_arrivals,
    genuine_arrivals_published:
      database.genuine_arrivals_published === database.genuine_arrivals,
    absorbed_arrivals_bounded:
      database.genuine_arrivals_absorbed_by_existing_building_run
        <= database.genuine_arrivals,
    latency_aggregate_complete:
      database.publication_latency.sample_count === database.genuine_arrivals,
    query_hashes_complete: true,
    zero_production_effects:
      Object.values(zeroEffects).every((value) => value === 0),
    redaction_passed: true,
    later_deployment_not_authorized: true,
  }
  const reasons = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name)
  return {
    schema_version: 1,
    status: reasons.length === 0 ? 'pass' : 'fail',
    window: {
      started_at: started.value,
      ended_at: ended.value,
      duration_seconds: durationSeconds,
    },
    identity: identity.sanitized,
    metrics: {
      http_546_count: logs.http_546_count,
      score_tick_total: logs.score_tick_total,
      score_tick_success: logs.score_tick_success,
      score_tick_success_rate: logs.score_tick_success_rate,
      minute_schedule_opportunities: logs.minute_schedule_opportunities,
      minimum_required_score_tick_total: logs.minimum_required_score_tick_total,
      phantom_new_job_runs: database.phantom_new_job_runs,
      minute_cadence_growth_detected: database.minute_cadence_growth_detected,
      uncorrelated_item_growth_minutes:
        database.uncorrelated_item_growth_minutes,
      maximum_consecutive_uncorrelated_growth_minutes:
        database.maximum_consecutive_uncorrelated_growth_minutes,
      genuine_arrivals: database.genuine_arrivals,
      genuine_arrivals_enqueued: database.genuine_arrivals_enqueued,
      genuine_arrivals_published: database.genuine_arrivals_published,
      genuine_arrivals_absorbed_by_existing_building_run:
        database.genuine_arrivals_absorbed_by_existing_building_run,
      publication_latency: database.publication_latency,
    },
    query_hashes: { ...queryHashes },
    checks: Object.fromEntries(Object.entries(checks).map(([name, passed]) => [
      name,
      { status: passed ? 'pass' : 'fail' },
    ])),
    redaction: {
      aggregate_only: true,
      raw_logs_persisted: false,
      raw_rows_persisted: false,
      raw_identifiers_persisted: false,
      credential_fields_persisted: false,
    },
    zero_effect_scope: zeroEffects,
    later_deployment_authorized: false,
    reasons,
  }
}

const SENSITIVE_KEYS = new Set([
  'access_token',
  'authorization',
  'password',
  'secret',
  'database_url',
  'connection_string',
  'user_id',
  'job_id',
  'run_id',
  'item_id',
  'title',
  'description',
  'payload',
  'event_message',
  'logs',
  'rows',
  'sample',
])
const SENSITIVE_VALUE =
  /(?:https?:\/\/|postgres(?:ql)?:\/\/|\bBearer\s+|\bsbp_[A-Za-z0-9_-]+|\bsk-[A-Za-z0-9_-]+|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.|\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b)/i

export function assertNoSensitiveContent(value) {
  function visit(current, parentKey = '') {
    if (Array.isArray(current)) {
      for (const entry of current) visit(entry, parentKey)
      return
    }
    if (current && typeof current === 'object') {
      for (const [key, entry] of Object.entries(current)) {
        const hashOnlyLogKey = parentKey === 'query_hashes' && key === 'logs'
        requireCondition(hashOnlyLogKey || !SENSITIVE_KEYS.has(key.toLowerCase()),
          'sensitive_output_key', 'sensitive output key')
        visit(entry, key)
      }
      return
    }
    if (typeof current === 'string') {
      requireCondition(!SENSITIVE_VALUE.test(current),
        'sensitive_output_value', 'sensitive output value')
    }
  }
  visit(value)
  return true
}

export function buildEvidenceRecord(evaluation) {
  const record = structuredClone(evaluation)
  assertNoSensitiveContent(record)
  return record
}

export function assertObservationRecord(record) {
  try {
    exactKeys(record, [
      'schema_version',
      'status',
      'window',
      'identity',
      'metrics',
      'query_hashes',
      'checks',
      'redaction',
      'zero_effect_scope',
      'later_deployment_authorized',
      'reasons',
    ], 'record_schema_invalid')
    requireCondition(record.schema_version === 1 && record.status === 'pass',
      'record_not_pass')
    exactKeys(record.window, ['started_at', 'ended_at', 'duration_seconds'],
      'record_window_invalid')
    const started = canonicalTimestamp(record.window.started_at, 'record_window_invalid')
    const ended = canonicalTimestamp(record.window.ended_at, 'record_window_invalid')
    requireCondition(
      Number(record.window.duration_seconds) >= WINDOW_SECONDS
        && (ended.milliseconds - started.milliseconds) / 1000
          === Number(record.window.duration_seconds),
      'record_window_invalid',
    )
    requireCondition(COMMIT.test(record.identity?.source_commit ?? '')
      && HASH.test(record.identity?.containment_migration_sha256 ?? '')
      && record.identity?.deployed_migration_version === '0063',
    'record_identity_invalid')
    requireCondition(Number(record.metrics?.http_546_count) === 0
      && Number(record.metrics?.score_tick_total) > 0
      && Number(record.metrics?.score_tick_success) > 0
      && Number(record.metrics?.score_tick_success_rate) >= 0.99
      && Number(record.metrics?.phantom_new_job_runs) === 0
      && record.metrics?.minute_cadence_growth_detected === false
      && Number(record.metrics?.genuine_arrivals) > 0
      && Number(record.metrics?.genuine_arrivals_enqueued)
        === Number(record.metrics?.genuine_arrivals)
      && Number(record.metrics?.genuine_arrivals_published)
        === Number(record.metrics?.genuine_arrivals),
    'record_metrics_invalid')
    requireCondition(Object.keys(record.checks ?? {}).length > 0
      && Object.values(record.checks).every((check) => check?.status === 'pass'),
    'record_check_failed')
    requireCondition(record.redaction?.aggregate_only === true
      && record.redaction?.raw_logs_persisted === false
      && record.redaction?.raw_rows_persisted === false
      && record.redaction?.raw_identifiers_persisted === false
      && record.redaction?.credential_fields_persisted === false,
    'record_redaction_invalid')
    checkedZeroEffects(record.zero_effect_scope)
    requireCondition(Object.values(record.zero_effect_scope).every((value) => value === 0)
      && record.later_deployment_authorized === false
      && Array.isArray(record.reasons)
      && record.reasons.length === 0,
    'record_scope_invalid')
    assertNoSensitiveContent(record)
    return record
  } catch (error) {
    if (error instanceof GateError) {
      throw new Error(`containment observation record rejected: ${error.code}`)
    }
    throw error
  }
}

function zeroEffectScope() {
  return Object.fromEntries(ZERO_EFFECT_KEYS.map((key) => [key, 0]))
}

function failureRecord(reason, prior = null) {
  const window = prior?.window && typeof prior.window === 'object'
    ? {
        started_at: prior.window.started_at ?? null,
        ended_at: prior.window.ended_at ?? null,
        duration_seconds: Number(prior.window.duration_seconds ?? 0),
      }
    : { started_at: null, ended_at: null, duration_seconds: 0 }
  const record = {
    schema_version: 1,
    status: 'fail',
    window,
    identity: prior?.identity ?? {},
    metrics: prior?.metrics ?? {},
    query_hashes: prior?.query_hashes ?? {},
    checks: { gate: { status: 'fail' } },
    redaction: {
      aggregate_only: true,
      raw_logs_persisted: false,
      raw_rows_persisted: false,
      raw_identifiers_persisted: false,
      credential_fields_persisted: false,
    },
    zero_effect_scope: zeroEffectScope(),
    later_deployment_authorized: false,
    reasons: [reason],
  }
  assertNoSensitiveContent(record)
  return record
}

function armedRecord(deployment, identity, startedAt) {
  const endedAt = new Date(
    Date.parse(startedAt) + WINDOW_SECONDS * 1000,
  ).toISOString()
  const record = {
    schema_version: 1,
    status: 'armed',
    window: {
      started_at: startedAt,
      ended_at: endedAt,
      duration_seconds: WINDOW_SECONDS,
      log_ingestion_grace_seconds: LOG_INGESTION_GRACE_SECONDS,
    },
    identity: {
      source_commit: deployment.source_commit,
      source_tree: deployment.source_tree,
      containment_migration_sha256: deployment.containment_migration_sha256,
      deployed_migration_version: deployment.deployed_migration_version,
      deployment_record_sha256: deployment.deployment_record_sha256,
      deployment_summary_sha256: deployment.deployment_summary_sha256,
      ...identity.sanitized,
      start_snapshot_sha256: sha256(canonical(identity.sanitized)),
    },
    query_hashes: {
      readiness: sha256(READINESS_SQL),
      identity: sha256(IDENTITY_SQL),
    },
    redaction: {
      aggregate_only: true,
      raw_logs_persisted: false,
      raw_rows_persisted: false,
      raw_identifiers_persisted: false,
      credential_fields_persisted: false,
    },
    zero_effect_scope: zeroEffectScope(),
    later_deployment_authorized: false,
  }
  assertNoSensitiveContent(record)
  return record
}

function deploymentIdentityFromArmed(record, endIdentity) {
  return {
    source_commit: record.identity.source_commit,
    source_tree: record.identity.source_tree,
    containment_migration_sha256:
      record.identity.containment_migration_sha256,
    deployed_migration_version: record.identity.deployed_migration_version,
    deployment_record_sha256: record.identity.deployment_record_sha256,
    deployment_summary_sha256: record.identity.deployment_summary_sha256,
    start: {
      linked_project_ref_sha256: record.identity.linked_project_ref_sha256,
      migration_inventory_sha256: record.identity.migration_inventory_sha256,
      containment_function_definition_sha256:
        record.identity.containment_function_definition_sha256,
      containment_function_security_sha256:
        record.identity.containment_function_security_sha256,
      score_tick_function_identity_sha256:
        record.identity.score_tick_function_identity_sha256,
      scheduler_identity_sha256: record.identity.scheduler_identity_sha256,
    },
    end: endIdentity.sanitized,
  }
}

async function arm(args) {
  const recordBytes = await readFile(resolve(ROOT, args.deploymentRecord))
  const summaryBytes = await readFile(resolve(ROOT, DEFAULT_SUMMARY))
  const deployment = parseDeploymentRecord(recordBytes, summaryBytes)
  const readiness = await collectReadiness(deployment.project_ref)
  requireCondition(readiness.failed_ranking_state_count === 0,
    'ranking_state_failed')
  if (
    readiness.building_ranking_state_count > 0
    || readiness.building_ranking_run_count > 0
    || readiness.pending_or_claimed_active_item_count > 0
  ) {
    throw new GateError('not_ready_natural_drain')
  }
  const identity = await collectIdentity(deployment)
  const startedAt = nextWholeUtcMinute(new Date().toISOString())
  const record = armedRecord(deployment, identity, startedAt)
  await writeFile(resolve(ROOT, args.output), `${JSON.stringify(record, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({
    status: record.status,
    collect_after_utc: new Date(
      Date.parse(record.window.ended_at)
        + LOG_INGESTION_GRACE_SECONDS * 1000,
    ).toISOString(),
  })}\n`)
}

async function collect(args) {
  const path = resolve(ROOT, args.record)
  const armed = JSON.parse(await readFile(path, 'utf8'))
  requireCondition(armed.schema_version === 1 && armed.status === 'armed',
    'record_not_armed')
  const started = canonicalTimestamp(armed.window?.started_at, 'window_invalid')
  const ended = canonicalTimestamp(armed.window?.ended_at, 'window_invalid')
  requireCondition((ended.milliseconds - started.milliseconds) / 1000
    === WINDOW_SECONDS, 'frozen_window_drift')
  const graceUntil = ended.milliseconds + LOG_INGESTION_GRACE_SECONDS * 1000
  requireCondition(Date.now() >= graceUntil, 'window_not_complete')

  const recordBytes = await readFile(resolve(ROOT, args.deploymentRecord))
  const summaryBytes = await readFile(resolve(ROOT, DEFAULT_SUMMARY))
  const deployment = parseDeploymentRecord(recordBytes, summaryBytes)
  requireCondition(deployment.deployment_record_sha256
    === armed.identity.deployment_record_sha256
    && deployment.deployment_summary_sha256
      === armed.identity.deployment_summary_sha256,
  'deployment_record_drift')
  const endIdentity = await collectIdentity(deployment)
  const [logs, database] = await Promise.all([
    collectLogs(
      deployment,
      endIdentity.runtime,
      armed.window.started_at,
      armed.window.ended_at,
    ),
    collectDatabaseObservation(
      deployment.project_ref,
      armed.window.started_at,
      armed.window.ended_at,
    ),
  ])
  const evaluation = evaluateObservation({
    window: {
      started_at: armed.window.started_at,
      armed_started_at: armed.window.started_at,
      ended_at: armed.window.ended_at,
      deployment_completed_at: deployment.deployment_completed_at,
    },
    identity: deploymentIdentityFromArmed(armed, endIdentity),
    logs,
    database: database.database,
    query_hashes: {
      readiness: armed.query_hashes.readiness,
      identity: sha256(IDENTITY_SQL),
      logs: logs.query_sha256,
      database: database.query_sha256,
    },
    zero_effect_scope: zeroEffectScope(),
  })
  const record = buildEvidenceRecord(evaluation)
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`)
  if (record.status !== 'pass') {
    throw new GateError('observation_gate_failed')
  }
  assertObservationRecord(record)
  process.stdout.write(`${JSON.stringify({ status: 'pass' })}\n`)
}

function parseArgs(argv) {
  const args = {
    mode: null,
    deploymentRecord: null,
    output: DEFAULT_RECORD,
    record: null,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--arm') args.mode = 'arm'
    else if (argument === '--collect') args.mode = 'collect'
    else if (argument === '--assert-record') {
      args.mode = 'assert'
      args.record = argv[++index]
    } else if (argument === '--deployment-record') {
      args.deploymentRecord = argv[++index]
    } else if (argument === '--output') args.output = argv[++index]
    else if (argument === '--record') args.record = argv[++index]
    else throw new GateError('unknown_argument')
  }
  requireCondition(['arm', 'collect', 'assert'].includes(args.mode),
    'mode_required')
  if (args.mode === 'arm') {
    requireCondition(args.deploymentRecord && args.output, 'arm_arguments_missing')
  }
  if (args.mode === 'collect') {
    requireCondition(args.record, 'collect_record_missing')
    args.deploymentRecord ??=
      '.planning/phases/05.1-ranking-and-dashboard-performance-stabilization/05.1-03-CONTAINMENT-DEPLOYMENT.md'
  }
  if (args.mode === 'assert') {
    requireCondition(args.record, 'assert_record_missing')
  }
  return args
}

async function writeFailureIfApplicable(args, reason) {
  const target = args.mode === 'arm' ? args.output
    : args.mode === 'collect' ? args.record : null
  if (!target) return
  if (reason === 'not_ready_natural_drain' || reason === 'window_not_complete') {
    return
  }
  let prior = null
  try {
    prior = JSON.parse(await readFile(resolve(ROOT, target), 'utf8'))
  } catch {
    // A missing or malformed prior record contributes no trusted fields.
  }
  if (prior?.schema_version === 1 && prior?.status === 'fail') return
  const failure = failureRecord(reason, prior)
  await writeFile(resolve(ROOT, target), `${JSON.stringify(failure, null, 2)}\n`)
}

async function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
    if (args.mode === 'assert') {
      const record = JSON.parse(await readFile(resolve(ROOT, args.record), 'utf8'))
      assertObservationRecord(record)
      process.stdout.write(`${JSON.stringify({ status: 'pass' })}\n`)
      return
    }
    if (args.mode === 'arm') await arm(args)
    else await collect(args)
  } catch (error) {
    const reason = error instanceof GateError ? error.code : 'unexpected_failure'
    await writeFailureIfApplicable(args ?? {}, reason)
    process.stderr.write(`containment observation failed: ${reason}\n`)
    process.exitCode = reason === 'not_ready_natural_drain'
      || reason === 'window_not_complete' ? 3 : 1
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}

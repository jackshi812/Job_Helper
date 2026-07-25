#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const SHA40 = /^[0-9a-f]{40}$/
const SHA256 = /^[0-9a-f]{64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const IMMUTABLE_PAGES_URL = /^https:\/\/[0-9a-f-]+\.job-helper-qs9\.pages\.dev$/
const REQUIRED_CHECKS = Object.freeze([
  'release_identity',
  'migration_parity',
  'verify_board_bundle',
  'poll_tick_bundle',
  'web_asset',
  'four_source_scope',
  'source_activation_isolation',
  'closure_safety',
  'existing_source_regressions',
  'two_user_rls',
  'lifecycle_mutual_exclusion',
  'shared_jobs_unchanged',
  'page_one_200',
  'page_two_200',
  'cursor_stability',
  'cursor_rejection',
  'single_row_backfill',
  'backfill_retry',
  'final_partial_caught_up',
  'fixture_cleanup',
])
const UAT_CASES = Object.freeze([
  'desktop_active',
  'desktop_applied',
  'desktop_dismissed',
  'desktop_filters',
  'desktop_paging',
  'narrow_width',
  'keyboard_focus',
  'screen_reader_status',
])

const ROOT_KEYS = Object.freeze([
  'schema_version',
  'phase',
  'created_at',
  'accepted_production_source',
  'candidate',
  'migration',
  'functions',
  'web',
  'targets',
  'sources',
  'verifier',
  'baselines',
  'exclusions',
])
const CANDIDATE_KEYS = Object.freeze([
  'git_sha',
  'commit_object_sha256',
  'parent_sha',
  'worktree_path',
  'changed_files',
])
const MIGRATION_KEYS = Object.freeze(['path', 'sha256', 'proposed'])
const FUNCTION_KEYS = Object.freeze([
  'entry_path',
  'entry_sha256',
  'bundle_manifest_sha256',
  'bundle_files',
  'verify_jwt',
  'current_hosted',
])
const HOSTED_FUNCTION_KEYS = Object.freeze(['id', 'version', 'status', 'verify_jwt'])
const WEB_KEYS = Object.freeze(['asset_path', 'asset_sha256', 'asset_bytes'])
const TARGET_KEYS = Object.freeze(['supabase', 'cloudflare'])
const SUPABASE_KEYS = Object.freeze(['project_ref', 'project_name', 'remote_migrations'])
const CLOUDFLARE_KEYS = Object.freeze([
  'account_id',
  'project',
  'production_branch',
  'production_domain',
  'current_deployment',
])
const DEPLOYMENT_KEYS = Object.freeze(['id', 'status', 'branch', 'git_sha', 'url'])
const SOURCE_KEYS = Object.freeze([
  'company',
  'source_key',
  'tenant',
  'region',
  'site',
  'url',
  'country_facet_id',
  'country_facet_route',
])
const VERIFIER_KEYS = Object.freeze([
  'script_sha256',
  'run_namespace',
  'fixture_namespace_uuid',
  'page_size',
  'subject_count',
  'subjects',
  'activation',
  'fixture_ceilings',
  'deterministic_id_ranges',
])
const SUBJECT_KEYS = Object.freeze(['label', 'email'])
const ACTIVATION_KEYS = Object.freeze(['max_polls', 'poll_interval_ms', 'deadline_ms'])
const CEILING_KEYS = Object.freeze([
  'auth_subjects',
  'companies',
  'connector_observations',
  'jobs',
  'user_jobs',
])
const RANGE_KEYS = Object.freeze(['jobs', 'subject_1_user_jobs', 'subject_2_user_jobs'])
const BASELINE_KEYS = Object.freeze([
  'captured_at',
  'rls',
  'grants',
  'policies_sha256',
  'counts',
  'workday_companies',
  'workday_catalog',
  'workday_jobs',
  'other_connector_health_sha256',
  'ranking_state_sha256',
  'dashboard_baseline_sha256',
])

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonical(value[key])}`
    )).join(',')}}`
  }
  return JSON.stringify(value)
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} keys mismatch`)
  }
}

function requireString(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`${label} is malformed`)
  }
}

function requireInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} is outside its finite bound`)
  }
}

function secretScan(value, path = 'manifest') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => secretScan(entry, `${path}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, entry] of Object.entries(value)) {
    const publicIdentityToken = key === 'site_token' || key === 'board_token'
    if (!publicIdentityToken
      && /(?:password|secret|token|authorization|service_role|anon_key|publishable_key)/i.test(key)) {
      throw new Error(`${path}.${key} may contain a secret`)
    }
    if (typeof entry === 'string' && /(?:Bearer\s+[A-Za-z0-9._~-]{8,}|eyJ[A-Za-z0-9_-]{20,})/.test(entry)) {
      throw new Error(`${path}.${key} contains unredacted credentials`)
    }
    secretScan(entry, `${path}.${key}`)
  }
}

function validateManifest(manifest) {
  exactKeys(manifest, ROOT_KEYS, 'manifest')
  if (manifest.schema_version !== 1 || manifest.phase !== '03.6') {
    throw new Error('manifest version/phase mismatch')
  }
  requireString(manifest.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, 'created_at')
  requireString(manifest.accepted_production_source, SHA40, 'accepted production source')

  exactKeys(manifest.candidate, CANDIDATE_KEYS, 'candidate')
  requireString(manifest.candidate.git_sha, SHA40, 'candidate git SHA')
  requireString(manifest.candidate.commit_object_sha256, SHA256, 'candidate commit SHA-256')
  requireString(manifest.candidate.parent_sha, SHA40, 'candidate parent SHA')
  if (manifest.candidate.parent_sha !== manifest.accepted_production_source) {
    throw new Error('candidate does not descend directly from accepted production source')
  }
  if (!Array.isArray(manifest.candidate.changed_files) || manifest.candidate.changed_files.length < 1) {
    throw new Error('candidate changed-file inventory is empty')
  }
  if (manifest.candidate.changed_files.some((path) => (
    typeof path !== 'string'
    || path.startsWith('.planning/')
    || ['.DS_Store', 'scripts/agent-dashboard.mjs', 'scripts/agent-dashboard.test.mjs', 'web/zh']
      .some((excluded) => path === excluded || path.startsWith(`${excluded}/`))
  ))) {
    throw new Error('candidate contains planning or unrelated files')
  }

  exactKeys(manifest.migration, MIGRATION_KEYS, 'migration')
  requireString(manifest.migration.sha256, SHA256, 'migration SHA-256')
  if (
    manifest.migration.path !== 'supabase/migrations/0037_us_workday_dashboard_queue.sql'
    || JSON.stringify(manifest.migration.proposed) !== JSON.stringify([
      '0037_us_workday_dashboard_queue.sql',
    ])
  ) throw new Error('migration inventory must propose only 0037')

  exactKeys(manifest.functions, ['verify-board', 'poll-tick'], 'functions')
  for (const [slug, entry] of Object.entries(manifest.functions)) {
    exactKeys(entry, FUNCTION_KEYS, `functions.${slug}`)
    requireString(entry.entry_sha256, SHA256, `${slug} entry SHA-256`)
    requireString(entry.bundle_manifest_sha256, SHA256, `${slug} bundle SHA-256`)
    if (!Array.isArray(entry.bundle_files) || entry.bundle_files.length < 1) {
      throw new Error(`${slug} bundle inventory is empty`)
    }
    for (const file of entry.bundle_files) {
      exactKeys(file, ['path', 'sha256'], `${slug} bundle file`)
      requireString(file.sha256, SHA256, `${slug} bundle file SHA-256`)
    }
    exactKeys(entry.current_hosted, HOSTED_FUNCTION_KEYS, `${slug} hosted identity`)
    requireString(entry.current_hosted.id, UUID, `${slug} hosted ID`)
    requireInteger(entry.current_hosted.version, 1, 10_000, `${slug} version`)
    if (entry.current_hosted.status !== 'ACTIVE'
      || entry.current_hosted.verify_jwt !== entry.verify_jwt) {
      throw new Error(`${slug} hosted JWT/status mismatch`)
    }
  }
  if (manifest.functions['verify-board'].verify_jwt !== true
    || manifest.functions['poll-tick'].verify_jwt !== false) {
    throw new Error('function JWT settings drifted')
  }

  exactKeys(manifest.web, WEB_KEYS, 'web')
  requireString(manifest.web.asset_path, /^\/assets\/[A-Za-z0-9._-]+\.js$/, 'web asset path')
  requireString(manifest.web.asset_sha256, SHA256, 'web asset SHA-256')
  requireInteger(manifest.web.asset_bytes, 1, 2_000_000, 'web asset bytes')

  exactKeys(manifest.targets, TARGET_KEYS, 'targets')
  exactKeys(manifest.targets.supabase, SUPABASE_KEYS, 'Supabase target')
  requireString(manifest.targets.supabase.project_ref, /^[a-z]{20}$/, 'Supabase project ref')
  if (
    !Array.isArray(manifest.targets.supabase.remote_migrations)
    || manifest.targets.supabase.remote_migrations.at(-1) !== '0036'
  ) throw new Error('remote migration baseline must end at 0036')
  exactKeys(manifest.targets.cloudflare, CLOUDFLARE_KEYS, 'Cloudflare target')
  exactKeys(manifest.targets.cloudflare.current_deployment, DEPLOYMENT_KEYS, 'Cloudflare deployment')
  if (
    manifest.targets.cloudflare.project !== 'job-helper'
    || manifest.targets.cloudflare.production_branch !== 'main'
    || manifest.targets.cloudflare.current_deployment.status !== 'success'
    || manifest.targets.cloudflare.current_deployment.branch !== 'main'
    || !IMMUTABLE_PAGES_URL.test(manifest.targets.cloudflare.current_deployment.url)
  ) throw new Error('Cloudflare target/deployment is mutable or malformed')

  if (!Array.isArray(manifest.sources) || manifest.sources.length !== 4) {
    throw new Error('manifest must contain exactly four sources')
  }
  const expectedSourceKeys = [
    'workday:wd1:nasdaq:Global_External_Site',
    'workday:wd5:spgi:SPGI_Careers',
    'workday:wd5:morningstar:morningstar',
    'workday:wd1:statestreet:Global',
  ]
  for (const source of manifest.sources) {
    exactKeys(source, SOURCE_KEYS, 'source')
    if (!source.url.startsWith('https://') || source.country_facet_id !== 'bc33aa3152ec42d4995f4791a106ed09') {
      throw new Error('source URL/country facet drifted')
    }
  }
  if (JSON.stringify(manifest.sources.map(({ source_key }) => source_key).sort())
    !== JSON.stringify(expectedSourceKeys.sort())) {
    throw new Error('literal four-source inventory drifted')
  }

  exactKeys(manifest.verifier, VERIFIER_KEYS, 'verifier')
  requireString(manifest.verifier.script_sha256, SHA256, 'verifier script SHA-256')
  requireString(manifest.verifier.fixture_namespace_uuid, UUID, 'fixture namespace UUID')
  requireInteger(manifest.verifier.page_size, 200, 200, 'page size')
  requireInteger(manifest.verifier.subject_count, 2, 2, 'subject count')
  if (!Array.isArray(manifest.verifier.subjects) || manifest.verifier.subjects.length !== 2) {
    throw new Error('exactly two disposable subjects are required')
  }
  for (const subject of manifest.verifier.subjects) {
    exactKeys(subject, SUBJECT_KEYS, 'subject')
    if (!subject.email.startsWith(`${manifest.verifier.run_namespace}+`)
      || !subject.email.endsWith('@example.invalid')) {
      throw new Error('non-disposable fixture subject')
    }
  }
  exactKeys(manifest.verifier.activation, ACTIVATION_KEYS, 'activation bounds')
  requireInteger(manifest.verifier.activation.max_polls, 1, 36, 'activation polls')
  requireInteger(manifest.verifier.activation.poll_interval_ms, 60_000, 1_800_000, 'activation interval')
  requireInteger(manifest.verifier.activation.deadline_ms, 60_000, 14_400_000, 'activation deadline')
  exactKeys(manifest.verifier.fixture_ceilings, CEILING_KEYS, 'fixture ceilings')
  if (
    manifest.verifier.fixture_ceilings.auth_subjects !== 2
    || manifest.verifier.fixture_ceilings.jobs > 405
    || manifest.verifier.fixture_ceilings.user_jobs > 810
    || manifest.verifier.fixture_ceilings.connector_observations > 12
  ) throw new Error('fixture ceiling exceeds approved scope')
  exactKeys(manifest.verifier.deterministic_id_ranges, RANGE_KEYS, 'fixture ID ranges')

  exactKeys(manifest.baselines, BASELINE_KEYS, 'baselines')
  for (const key of [
    'policies_sha256',
    'other_connector_health_sha256',
    'ranking_state_sha256',
    'dashboard_baseline_sha256',
  ]) requireString(manifest.baselines[key], SHA256, `baseline ${key}`)
  if (!Array.isArray(manifest.exclusions) || manifest.exclusions.length < 5) {
    throw new Error('exclusion inventory is incomplete')
  }
  secretScan(manifest)
  return Object.freeze(manifest)
}

async function command(cwd, executable, args) {
  const result = await execFile(executable, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' },
  })
  return `${result.stdout}\n${result.stderr}`.trim()
}

async function assertLocalCandidate(root, manifest) {
  const worktree = manifest.candidate.worktree_path
  const sha = await command(worktree, 'git', ['rev-parse', 'HEAD'])
  if (sha !== manifest.candidate.git_sha) throw new Error('candidate HEAD drift')
  const parent = await command(worktree, 'git', ['rev-parse', 'HEAD^'])
  if (parent !== manifest.candidate.parent_sha) throw new Error('candidate parent drift')
  const commit = await command(worktree, 'git', ['cat-file', 'commit', sha])
  if (sha256(commit) !== manifest.candidate.commit_object_sha256) {
    throw new Error('candidate commit-object drift')
  }
  const paths = (await command(worktree, 'git', [
    'diff-tree', '--no-commit-id', '--name-only', '-r', sha,
  ])).split(/\r?\n/).filter(Boolean)
  if (JSON.stringify(paths) !== JSON.stringify(manifest.candidate.changed_files)) {
    throw new Error('candidate path inventory drift')
  }
  for (const [path, expected] of [
    [manifest.migration.path, manifest.migration.sha256],
    [manifest.functions['verify-board'].entry_path, manifest.functions['verify-board'].entry_sha256],
    [manifest.functions['poll-tick'].entry_path, manifest.functions['poll-tick'].entry_sha256],
    [`web/dist${manifest.web.asset_path}`, manifest.web.asset_sha256],
  ]) {
    const bytes = await readFile(resolve(worktree, path))
    if (sha256(bytes) !== expected) throw new Error(`${path} drift`)
  }
  return root
}

async function managementSql(projectRef, query) {
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim()
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is required')
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    },
  )
  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, ' ').slice(0, 500)
    throw new Error(`management SQL returned HTTP ${response.status}: ${detail}`)
  }
  const rows = await response.json()
  if (!Array.isArray(rows)) throw new Error('management SQL response is malformed')
  return rows
}

async function collectBaseline(projectRef) {
  requireString(projectRef, /^[a-z]{20}$/, 'Supabase project ref')
  const rows = await managementSql(projectRef, `
    with table_flags as (
      select c.relname as table_name, c.relrowsecurity as rls_enabled
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in (
          'companies', 'jobs', 'user_jobs', 'source_coverage_catalog',
          'deterministic_ranking_state'
        )
    ),
    workday_companies as (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'source_key', source_key,
        'board_token', board_token, 'region', region, 'site_token', site_token,
        'careers_url', careers_url, 'activation_state', activation_state,
        'activation_successes', activation_successes,
        'last_verified_at', last_verified_at, 'last_polled_at', last_polled_at,
        'last_success_at', last_success_at,
        'consecutive_failures', consecutive_failures,
        'last_error_code', last_error_code,
        'last_observation_count', last_observation_count
      ) order by source_key), '[]'::jsonb) as rows
      from public.companies where ats_type = 'workday'
    ),
    workday_catalog as (
      select coalesce(jsonb_agg(jsonb_build_object(
        'company_name', company_name, 'provider', provider,
        'careers_url', careers_url, 'disposition', disposition,
        'source_key', source_key, 'unsupported_reason', unsupported_reason,
        'verified_at', verified_at
      ) order by source_key), '[]'::jsonb) as rows
      from public.source_coverage_catalog where provider = 'Workday'
    ),
    workday_jobs as (
      select coalesce(jsonb_agg(to_jsonb(job_count) order by source_key), '[]'::jsonb) rows
      from (
        select c.source_key,
          count(j.id) filter (where j.status = 'open') as open_jobs,
          count(j.id) filter (where j.status = 'closed') as closed_jobs,
          count(j.id) as total_jobs
        from public.companies c
        left join public.jobs j on j.company_id = c.id
        where c.ats_type = 'workday'
        group by c.source_key
      ) job_count
    ),
    grants as (
      select coalesce(jsonb_agg(jsonb_build_object(
        'grantee', grantee, 'privilege', privilege_type, 'column', column_name
      ) order by grantee, privilege_type, column_name), '[]'::jsonb) rows
      from information_schema.column_privileges
      where table_schema = 'public' and table_name = 'user_jobs'
        and grantee in ('anon', 'authenticated')
    ),
    policies as (
      select coalesce(jsonb_agg(jsonb_build_object(
        'table', tablename, 'name', policyname, 'roles', roles, 'command', cmd,
        'using', qual, 'check', with_check
      ) order by tablename, policyname), '[]'::jsonb) rows
      from pg_catalog.pg_policies
      where schemaname = 'public' and tablename in ('user_jobs', 'jobs', 'companies')
    ),
    migration_rows as (
      select coalesce(jsonb_agg(jsonb_build_object(
        'version', version::text, 'name', name,
        'statement_count', cardinality(statements)
      ) order by version), '[]'::jsonb) rows
      from supabase_migrations.schema_migrations
    ),
    connector_health as (
      select coalesce(jsonb_agg(to_jsonb(x) order by ats_type, source_key), '[]'::jsonb) rows
      from (
        select ats_type, source_key, activation_state, activation_successes,
          consecutive_failures, last_error_code, last_observation_count
        from public.companies where ats_type <> 'workday'
      ) x
    ),
    ranking as (
      select coalesce(jsonb_agg(to_jsonb(x) order by user_id), '[]'::jsonb) rows
      from (
        select user_id, status, active_revision, desired_revision, error_code
        from public.deterministic_ranking_state
      ) x
    ),
    dashboard as (
      select coalesce(jsonb_agg(to_jsonb(x) order by user_id), '[]'::jsonb) rows
      from (
        select user_id, count(*) as rows,
          count(*) filter (where dismissed_at is null) as nondismissed,
          count(*) filter (
            where deterministic_eligible and deterministic_revision is not null
          ) as deterministic_eligible
        from public.user_jobs group by user_id
      ) x
    )
    select
      (select coalesce(jsonb_object_agg(table_name, rls_enabled), '{}'::jsonb)
       from table_flags) as rls,
      (select rows from grants) as grants,
      (select rows from policies) as policies,
      (select rows from migration_rows) as migrations,
      (select rows from workday_companies) as workday_companies,
      (select rows from workday_catalog) as workday_catalog,
      (select rows from workday_jobs) as workday_jobs,
      jsonb_build_object(
        'auth_users', (select count(*) from auth.users),
        'companies', (select count(*) from public.companies),
        'jobs', (select count(*) from public.jobs),
        'open_jobs', (select count(*) from public.jobs where status = 'open'),
        'user_jobs', (select count(*) from public.user_jobs),
        'dismissed_user_jobs',
          (select count(*) from public.user_jobs where dismissed_at is not null),
        'source_catalog', (select count(*) from public.source_coverage_catalog),
        'connector_observations', (select count(*) from public.connector_observations),
        'ranking_states', (select count(*) from public.deterministic_ranking_state),
        'ranking_runs', (select count(*) from public.deterministic_ranking_runs),
        'ranking_items', (select count(*) from public.deterministic_ranking_items),
        'applied_at_column_exists', exists (
          select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'user_jobs'
            and column_name = 'applied_at'
        )
      ) as counts,
      (select rows from connector_health) as connector_health,
      (select rows from ranking) as ranking,
      (select rows from dashboard) as dashboard
  `)
  if (rows.length !== 1) throw new Error('baseline query did not return exactly one row')
  const row = rows[0]
  const policiesSha256 = sha256(canonical(row.policies))
  const result = {
    captured_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    rls: row.rls,
    grants: row.grants,
    policies_sha256: policiesSha256,
    counts: row.counts,
    workday_companies: row.workday_companies,
    workday_catalog: row.workday_catalog,
    workday_jobs: row.workday_jobs,
    other_connector_health_sha256: sha256(canonical(row.connector_health)),
    ranking_state_sha256: sha256(canonical(row.ranking)),
    dashboard_baseline_sha256: sha256(canonical(row.dashboard)),
    remote_migrations: row.migrations,
  }
  secretScan(result, 'baseline')
  return result
}

function requirePassChecks(document) {
  if (document.status !== 'PASS') throw new Error('top-level hosted evidence is not PASS')
  exactKeys(document.checks, REQUIRED_CHECKS, 'hosted checks')
  for (const check of REQUIRED_CHECKS) {
    if (document.checks[check]?.status !== 'PASS') throw new Error(`${check} is not PASS`)
  }
  if (document.counts?.subjects !== 2
    || document.counts?.page_one !== 200
    || document.counts?.page_two !== 200
    || document.counts?.remaining_fixtures !== 0) {
    throw new Error('hosted evidence counts are outside the approved proof')
  }
}

async function assertEvidence(path, rolloutPath) {
  const evidence = JSON.parse(await readFile(path, 'utf8'))
  requirePassChecks(evidence)
  const rollout = await readFile(rolloutPath, 'utf8')
  if (!/^---\n[\s\S]*?^status:\s*PASS\s*$/m.test(rollout)
    || !rollout.includes(`manifest_sha256: ${evidence.manifest_sha256}`)
    || !rollout.includes(`hosted_verification_sha256: ${sha256(await readFile(path))}`)) {
    throw new Error('rollout evidence is not hash-bound PASS')
  }
  return evidence
}

async function assertUat(path, manifestPath) {
  const uat = JSON.parse(await readFile(path, 'utf8'))
  const manifestBytes = await readFile(manifestPath)
  if (uat.status !== 'PASS' || uat.manifest_sha256 !== sha256(manifestBytes)) {
    throw new Error('UAT is not bound to the exact release manifest')
  }
  if (!uat.owner_approval || typeof uat.owner_approval !== 'string') {
    throw new Error('UAT owner approval record is absent')
  }
  exactKeys(uat.cases, UAT_CASES, 'UAT cases')
  for (const name of UAT_CASES) {
    if (uat.cases[name]?.status !== 'PASS') throw new Error(`${name} is not PASS`)
  }
  if (/(?:failed|deferred|skipped|human[-_ ]needed)/i.test(canonical(uat))) {
    throw new Error('UAT contains a non-passing disposition')
  }
}

async function runHosted(manifestPath, outputPath, rolloutPath) {
  const manifestBytes = await readFile(manifestPath)
  const manifest = validateManifest(JSON.parse(manifestBytes))
  const approval = process.env.PHASE_03_6_EXACT_APPROVAL
  if (approval !== `approve exact Phase 03.6 release ${sha256(manifestBytes)}`) {
    throw new Error('fresh exact manifest approval is required')
  }
  const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  if (sha256(await readFile(fileURLToPath(import.meta.url)))
    !== manifest.verifier.script_sha256) {
    throw new Error('hosted verifier script drift')
  }
  await assertLocalCandidate(scriptRoot, manifest)
  const rawPath = process.env.PHASE_03_6_AUTHENTICATED_PROBE_RESULTS
  if (!rawPath) throw new Error('authenticated hosted probe results path is required')
  let raw
  let primaryError
  try {
    raw = JSON.parse(await readFile(resolve(rawPath), 'utf8'))
    secretScan(raw, 'hosted results')
    if (raw.manifest_sha256 !== sha256(manifestBytes)
      || raw.release_git_sha !== manifest.candidate.git_sha
      || raw.run_namespace !== manifest.verifier.run_namespace) {
      throw new Error('hosted probe target/hash drift')
    }
    requirePassChecks(raw)
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    if (!raw?.cleanup?.finally_registered
      || !raw.cleanup.before_snapshot_sha256
      || raw.cleanup.before_snapshot_sha256 !== raw.cleanup.after_snapshot_sha256
      || raw.counts?.remaining_fixtures !== 0) {
      const cleanupError = new Error(
        'guarded finally cleanup did not restore the exact before snapshot',
      )
      if (primaryError) throw new AggregateError(
        [primaryError, cleanupError],
        'hosted verification and cleanup both failed',
      )
      throw cleanupError
    }
  }
  const evidence = {
    ...raw,
    generated_at: new Date().toISOString(),
    status: 'PASS',
    manifest_sha256: sha256(manifestBytes),
  }
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' })
  const evidenceHash = sha256(await readFile(outputPath))
  const rollout = [
    '---',
    'status: PASS',
    `manifest_sha256: ${evidence.manifest_sha256}`,
    `hosted_verification_sha256: ${evidenceHash}`,
    '---',
    '',
    '# Phase 03.6 Rollout Evidence',
    '',
    `Exact release \`${manifest.candidate.git_sha}\` passed every bounded hosted assertion.`,
    `Verifier namespace: \`${manifest.verifier.run_namespace}\`.`,
    'Credentials are redacted; exact verifier-owned fixtures were removed in the guarded finally path.',
    '',
  ].join('\n')
  await writeFile(rolloutPath, rollout, { flag: 'wx' })
}

function usage() {
  return [
    'Usage:',
    '  node scripts/verify-phase-03-6-hosted.mjs --manifest PATH --output PATH --rollout PATH',
    '  node scripts/verify-phase-03-6-hosted.mjs --assert-evidence PATH --rollout PATH',
    '  node scripts/verify-phase-03-6-hosted.mjs --assert-uat PATH --manifest PATH',
    '  node scripts/verify-phase-03-6-hosted.mjs --validate-manifest PATH',
    '  node scripts/verify-phase-03-6-hosted.mjs --collect-baseline PROJECT_REF',
  ].join('\n')
}

async function main(argv) {
  if (argv.length === 2 && argv[0] === '--collect-baseline') {
    console.log(JSON.stringify(await collectBaseline(argv[1]), null, 2))
    return
  }
  if (argv.length === 2 && argv[0] === '--validate-manifest') {
    validateManifest(JSON.parse(await readFile(resolve(argv[1]), 'utf8')))
    return
  }
  if (argv.length === 4 && argv[0] === '--assert-evidence' && argv[2] === '--rollout') {
    await assertEvidence(resolve(argv[1]), resolve(argv[3]))
    return
  }
  if (argv.length === 4 && argv[0] === '--assert-uat' && argv[2] === '--manifest') {
    await assertUat(resolve(argv[1]), resolve(argv[3]))
    return
  }
  if (argv.length === 6 && argv[0] === '--manifest'
    && argv[2] === '--output' && argv[4] === '--rollout') {
    await runHosted(resolve(argv[1]), resolve(argv[3]), resolve(argv[5]))
    return
  }
  throw new Error(usage())
}

const direct = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (direct) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`verify-phase-03-6-hosted: ${error instanceof Error ? error.message : 'failed'}`)
    process.exitCode = 1
  })
}

export {
  REQUIRED_CHECKS,
  UAT_CASES,
  assertEvidence,
  assertUat,
  canonical,
  collectBaseline,
  requirePassChecks,
  secretScan,
  sha256,
  validateManifest,
}

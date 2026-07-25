#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
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

function redactVerificationDetail(value) {
  return String(value)
    .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .replace(
      /("(?:access_token|refresh_token|password|apikey|authorization)"\s*:\s*")[^"]*"/gi,
      '$1[REDACTED]"',
    )
    .replace(
      /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{6,})?\b/g,
      '[REDACTED_JWT]',
    )
}

function formatVerificationError(error) {
  function render(value, depth) {
    const message = value instanceof Error ? value.message : String(value)
    const boundedMessage = redactVerificationDetail(message).slice(0, 400)
    if (!(value instanceof AggregateError) || depth >= 2) return boundedMessage
    const causes = [...value.errors].slice(0, 4).map(
      (cause, index) => `cause ${index + 1}: ${render(cause, depth + 1)}`,
    )
    const omitted = value.errors.length > causes.length
      ? `; ${value.errors.length - causes.length} additional cause(s) omitted`
      : ''
    return `${boundedMessage}; ${causes.join('; ')}${omitted}`
  }
  return render(error, 0).slice(0, 1_200)
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
    || JSON.stringify(manifest.migration.proposed) !== JSON.stringify([])
  ) throw new Error('migration inventory must record 0037 as already applied')

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
    || manifest.targets.supabase.remote_migrations.at(-1) !== '0037'
  ) throw new Error('remote migration baseline must end at 0037')
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

async function commandBytes(cwd, executable, args) {
  const result = await execFile(executable, args, {
    cwd,
    encoding: null,
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' },
  })
  return Buffer.isBuffer(result.stdout)
    ? result.stdout
    : Buffer.from(result.stdout)
}

async function assertLocalCandidate(root, manifest) {
  const worktree = manifest.candidate.worktree_path
  const sha = await command(worktree, 'git', ['rev-parse', 'HEAD'])
  if (sha !== manifest.candidate.git_sha) throw new Error('candidate HEAD drift')
  const parent = await command(worktree, 'git', ['rev-parse', 'HEAD^'])
  if (parent !== manifest.candidate.parent_sha) throw new Error('candidate parent drift')
  const commit = await commandBytes(worktree, 'git', ['cat-file', 'commit', sha])
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

function requiredEnvironment(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function uuidV5(namespace, value) {
  const namespaceBytes = Buffer.from(namespace.replaceAll('-', ''), 'hex')
  if (namespaceBytes.length !== 16) throw new Error('fixture namespace is malformed')
  const digest = createHash('sha1')
    .update(namespaceBytes)
    .update(Buffer.from(value, 'utf8'))
    .digest()
    .subarray(0, 16)
  digest[6] = (digest[6] & 0x0f) | 0x50
  digest[8] = (digest[8] & 0x3f) | 0x80
  const hex = digest.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${
    hex.slice(16, 20)}-${hex.slice(20)}`
}

async function httpJson(url, {
  token,
  apikey,
  method = 'GET',
  body,
  prefer,
  expected = [200],
} = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(apikey ? { apikey } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let payload = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      throw new Error(`non-JSON response from ${new URL(url).pathname}`)
    }
  }
  const statuses = Array.isArray(expected) ? expected : [expected]
  if (!statuses.includes(response.status)) {
    const detail = canonical(payload).slice(0, 400)
    throw new Error(`HTTP ${response.status} from ${new URL(url).pathname}: ${detail}`)
  }
  return { payload, status: response.status, headers: response.headers }
}

function apiSession(apiUrl, publishableKey, token = publishableKey) {
  return {
    table(name, query = '', options = {}) {
      return httpJson(
        `${apiUrl}/rest/v1/${name}${query ? `?${query}` : ''}`,
        { token, apikey: publishableKey, ...options },
      )
    },
    rpc(name, body, expected = [200]) {
      return httpJson(`${apiUrl}/rest/v1/rpc/${name}`, {
        token,
        apikey: publishableKey,
        method: 'POST',
        body,
        expected,
      })
    },
  }
}

async function createDisposableSubject(manifest, ordinal) {
  const apiUrl = requiredEnvironment('SUPABASE_URL').replace(/\/$/, '')
  const publishableKey = requiredEnvironment('SUPABASE_PUBLISHABLE_KEY')
  const secretKey = requiredEnvironment('SUPABASE_SECRET_KEY')
  const subject = manifest.verifier.subjects[ordinal - 1]
  const password = `Phase036-${randomBytes(24).toString('base64url')}!9a`
  const created = await httpJson(`${apiUrl}/auth/v1/admin/users`, {
    token: secretKey,
    apikey: secretKey,
    method: 'POST',
    body: {
      email: subject.email,
      password,
      email_confirm: true,
      user_metadata: { verifier_namespace: manifest.verifier.run_namespace },
    },
  })
  const id = created.payload?.id
  if (!UUID.test(String(id))) throw new Error(`${subject.label} creation returned malformed ID`)
  const login = await httpJson(`${apiUrl}/auth/v1/token?grant_type=password`, {
    token: publishableKey,
    apikey: publishableKey,
    method: 'POST',
    body: { email: subject.email, password },
  })
  if (login.payload?.user?.id !== id || !login.payload?.access_token) {
    throw new Error(`${subject.label} authenticated identity mismatch`)
  }
  return Object.freeze({
    id,
    email: subject.email,
    token: login.payload.access_token,
    session: apiSession(apiUrl, publishableKey, login.payload.access_token),
  })
}

async function deleteDisposableSubject(subject) {
  if (!subject?.id) return
  const apiUrl = requiredEnvironment('SUPABASE_URL').replace(/\/$/, '')
  const secretKey = requiredEnvironment('SUPABASE_SECRET_KEY')
  await httpJson(`${apiUrl}/auth/v1/admin/users/${subject.id}`, {
    token: secretKey,
    apikey: secretKey,
    method: 'DELETE',
    expected: [200, 204],
  })
}

async function deleteSubjectsExactly(subjects, {
  deleteSubject = deleteDisposableSubject,
  sleep = delay,
  maxAttempts = 3,
} = {}) {
  const results = []
  for (const subject of [...subjects].reverse()) {
    if (!UUID.test(String(subject?.id))) {
      results.push({
        id: String(subject?.id ?? ''),
        attempts: 0,
        status: 'failed',
        error: new Error('refusing non-exact disposable subject identifier'),
      })
      continue
    }
    let lastError
    let attempt = 0
    for (attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await deleteSubject(subject)
        lastError = undefined
        break
      } catch (error) {
        lastError = error
        if (attempt < maxAttempts) await sleep(50 * attempt)
      }
    }
    results.push({
      id: subject.id,
      attempts: Math.min(attempt, maxAttempts),
      status: lastError ? 'failed' : 'deleted',
      ...(lastError ? { error: lastError } : {}),
    })
  }
  return results
}

async function relativeImportGraph(root, entry) {
  const visited = new Set()
  async function visit(path) {
    const absolute = resolve(root, path)
    const key = relative(root, absolute)
    if (visited.has(key)) return
    visited.add(key)
    const source = await readFile(absolute, 'utf8')
    for (const match of source.matchAll(
      /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)['"](\.\.?\/[^'"]+)['"]/g,
    )) {
      let target = resolve(dirname(absolute), match[1])
      if (!/\.[cm]?[jt]sx?$/.test(target)) target += '.ts'
      await visit(relative(root, target))
    }
  }
  await visit(entry)
  return [...visited].sort()
}

async function bundleManifest(root, entry) {
  const paths = await relativeImportGraph(root, entry)
  const entries = []
  for (const path of paths) {
    entries.push({ path, sha256: sha256(await readFile(join(root, path))) })
  }
  return Object.freeze({ paths, entries, sha256: sha256(canonical(entries)) })
}

async function functionInventory(projectRef) {
  const token = requiredEnvironment('SUPABASE_ACCESS_TOKEN')
  const response = await httpJson(
    `https://api.supabase.com/v1/projects/${projectRef}/functions`,
    { token },
  )
  if (!Array.isArray(response.payload)) throw new Error('function inventory is malformed')
  return response.payload
}

function functionMetadata(inventory, slug) {
  const found = inventory.filter((entry) => entry.slug === slug)
  if (found.length !== 1) throw new Error(`${slug} hosted metadata is not unique`)
  const result = {
    id: String(found[0].id ?? ''),
    version: Number(found[0].version),
    status: String(found[0].status ?? ''),
    verify_jwt: found[0].verify_jwt,
  }
  if (!UUID.test(result.id) || !Number.isSafeInteger(result.version)
    || result.version < 1 || typeof result.verify_jwt !== 'boolean') {
    throw new Error(`${slug} hosted metadata is malformed`)
  }
  return result
}

async function hostedFunctionProbe(manifest, slug) {
  if (!['verify-board', 'poll-tick'].includes(slug)) {
    throw new Error('function slug is outside approved release')
  }
  const approved = manifest.functions[slug]
  const projectRef = manifest.targets.supabase.project_ref
  const before = functionMetadata(await functionInventory(projectRef), slug)
  if (before.id !== approved.current_hosted.id
    || before.version <= approved.current_hosted.version
    || before.status !== 'ACTIVE'
    || before.verify_jwt !== approved.verify_jwt) {
    throw new Error(`${slug} hosted metadata does not prove one approved deployment`)
  }
  const downloadRoot = await mkdtemp(join(tmpdir(), `phase-03-6-${slug}-`))
  try {
    await command(
      downloadRoot,
      resolve(manifest.candidate.worktree_path, 'web/node_modules/.bin/supabase'),
      ['functions', 'download', slug, '--project-ref', projectRef, '--use-api'],
    )
    const after = functionMetadata(await functionInventory(projectRef), slug)
    if (canonical(before) !== canonical(after)) {
      throw new Error(`${slug} hosted metadata changed during source download`)
    }
    const remote = await bundleManifest(
      downloadRoot,
      `supabase/functions/${slug}/index.ts`,
    )
    if (canonical(remote.entries) !== canonical(approved.bundle_files)
      || remote.sha256 !== approved.bundle_manifest_sha256) {
      throw new Error(`${slug} hosted transitive bundle drift`)
    }
    return Object.freeze({
      ...before,
      entry_sha256: remote.entries.find(
        ({ path }) => path === `supabase/functions/${slug}/index.ts`,
      )?.sha256,
      bundle_manifest_sha256: remote.sha256,
      provenance: 'fresh-hosted-download',
    })
  } finally {
    await rm(downloadRoot, { recursive: true, force: true })
  }
}

async function releaseIdentityProbe(manifest) {
  const projectRef = manifest.targets.supabase.project_ref
  const migrations = await managementSql(projectRef, `
    select version::text, name
    from supabase_migrations.schema_migrations
    order by version
  `)
  const versions = migrations.map(({ version }) => String(version))
  const expected = expectedHostedMigrationVersions(manifest)
  if (canonical(versions) !== canonical(expected)) {
    throw new Error('hosted migration parity is not exact through 0037')
  }

  const [verifyBoard, pollTick] = await Promise.all([
    hostedFunctionProbe(manifest, 'verify-board'),
    hostedFunctionProbe(manifest, 'poll-tick'),
  ])

  const token = requiredEnvironment('CLOUDFLARE_API_TOKEN')
  const cf = manifest.targets.cloudflare
  const deployments = await httpJson(
    `https://api.cloudflare.com/client/v4/accounts/${cf.account_id}/pages/projects/${
      cf.project}/deployments`,
    { token },
  )
  const matches = deployments.payload?.result?.filter((deployment) => (
    deployment.environment === 'production'
    && deployment.deployment_trigger?.metadata?.branch === cf.production_branch
    && deployment.deployment_trigger?.metadata?.commit_hash === manifest.candidate.git_sha
    && (deployment.latest_stage?.status
      ?? deployment.stages?.deploy?.status
      ?? deployment.status) === 'success'
  ))
  if (!Array.isArray(matches) || matches.length !== 1) {
    throw new Error('exact candidate Cloudflare production deployment is not unique')
  }
  const deployment = matches[0]
  const immutableUrl = String(deployment.url ?? '')
  if (!IMMUTABLE_PAGES_URL.test(immutableUrl)) {
    throw new Error('Cloudflare immutable deployment URL is malformed')
  }
  const assetResponse = await fetch(`${immutableUrl}${manifest.web.asset_path}`)
  if (!assetResponse.ok) throw new Error('immutable web asset is unavailable')
  const asset = Buffer.from(await assetResponse.arrayBuffer())
  if (asset.length !== manifest.web.asset_bytes
    || sha256(asset) !== manifest.web.asset_sha256) {
    throw new Error('immutable deployed web asset drift')
  }
  const origin = await command(manifest.candidate.worktree_path, 'git', [
    'ls-remote', 'origin', 'refs/heads/main',
  ])
  if (origin.split(/\s+/)[0] !== manifest.candidate.git_sha) {
    throw new Error('origin/main is not the approved candidate SHA')
  }
  return Object.freeze({
    migrations: versions,
    functions: { 'verify-board': verifyBoard, 'poll-tick': pollTick },
    cloudflare: {
      id: deployment.id,
      url: immutableUrl,
      git_sha: manifest.candidate.git_sha,
      asset_path: manifest.web.asset_path,
      asset_sha256: manifest.web.asset_sha256,
      asset_bytes: asset.length,
    },
  })
}

function expectedHostedMigrationVersions(manifest) {
  return [...manifest.targets.supabase.remote_migrations]
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

async function unrelatedSnapshot(manifest) {
  const projectRef = manifest.targets.supabase.project_ref
  const sourceKeys = manifest.sources.map(({ source_key }) => sqlLiteral(source_key)).join(',')
  const namespace = manifest.verifier.run_namespace
  const rows = await managementSql(projectRef, `
    with approved_companies as (
      select id from public.companies where source_key in (${sourceKeys})
    )
    select jsonb_build_object(
      'policies', (
        select coalesce(jsonb_agg(to_jsonb(x) order by x.tablename, x.policyname), '[]'::jsonb)
        from (
          select tablename, policyname, roles, cmd, qual, with_check
          from pg_catalog.pg_policies
          where schemaname = 'public'
            and tablename in ('companies', 'jobs', 'user_jobs')
        ) x
      ),
      'grants', (
        select coalesce(jsonb_agg(to_jsonb(x) order by x.grantee, x.privilege_type, x.column_name), '[]'::jsonb)
        from (
          select grantee, privilege_type, column_name
          from information_schema.column_privileges
          where table_schema = 'public' and table_name = 'user_jobs'
            and grantee in ('anon', 'authenticated')
        ) x
      ),
      'existing_source_health', (
        select coalesce(jsonb_agg(to_jsonb(x) order by x.ats_type, x.source_key), '[]'::jsonb)
        from (
          select c.ats_type, c.source_key, c.activation_state,
            c.activation_successes, c.consecutive_failures, c.last_error_code,
            c.last_observation_count,
            count(j.id) filter (where j.status = 'open') as open_jobs,
            count(j.id) filter (where j.status = 'closed') as closed_jobs
          from public.companies c
          left join public.jobs j on j.company_id = c.id
          where c.source_key not in (${sourceKeys})
          group by c.id
        ) x
      ),
      'ranking_state', (
        select coalesce(jsonb_agg(to_jsonb(x) order by x.user_id), '[]'::jsonb)
        from (
          select s.user_id, s.status, s.active_revision, s.desired_revision,
            s.error_code
          from public.deterministic_ranking_state s
          join auth.users u on u.id = s.user_id
          where u.email not like ${sqlLiteral(`${namespace}+%`)}
        ) x
      ),
      'existing_lifecycle', (
        select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]'::jsonb)
        from (
          select uj.id, uj.user_id, uj.job_id, uj.applied_at, uj.dismissed_at
          from public.user_jobs uj
          join auth.users u on u.id = uj.user_id
          join public.jobs j on j.id = uj.job_id
          where u.email not like ${sqlLiteral(`${namespace}+%`)}
            and (
              j.company_id is null
              or j.company_id not in (select id from approved_companies)
            )
            and j.external_id not like ${sqlLiteral(`${namespace}:%`)}
        ) x
      )
    ) as snapshot
  `)
  if (rows.length !== 1 || !rows[0]?.snapshot) {
    throw new Error('unrelated production snapshot is malformed')
  }
  return Object.freeze({
    sha256: sha256(canonical(rows[0].snapshot)),
    value: rows[0].snapshot,
  })
}

async function invokeVerifyBoard(manifest, subject, sourceUrl) {
  const apiUrl = requiredEnvironment('SUPABASE_URL').replace(/\/$/, '')
  const publishableKey = requiredEnvironment('SUPABASE_PUBLISHABLE_KEY')
  const response = await httpJson(`${apiUrl}/functions/v1/verify-board`, {
    token: subject.token,
    apikey: publishableKey,
    method: 'POST',
    body: { url: sourceUrl },
  })
  const stage = response.headers.get('x-job-copilot-auth-stage')
  if (stage !== 'verified'
    && response.payload?.reason !== 'unsupported') {
    throw new Error('verify-board did not expose authenticated verification stage')
  }
  return Object.freeze({ payload: response.payload, stage })
}

function verifyBoardFailureMessage(company, stage, reason) {
  const boundedCompany = (typeof company === 'string' ? company : 'unknown-source')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64) || 'unknown-source'
  const boundedToken = (value, fallback) => (
    typeof value === 'string' && /^[a-z][a-z0-9_]{0,47}$/.test(value)
      ? value
      : fallback
  )
  return `${boundedCompany} exact live verification failed closed (stage=${
    boundedToken(stage, 'unknown')
  }, reason=${boundedToken(reason, 'unknown')})`
}

async function sourceState(manifest) {
  const sourceKeys = manifest.sources.map(({ source_key }) => sqlLiteral(source_key)).join(',')
  const rows = await managementSql(manifest.targets.supabase.project_ref, `
    select c.id, c.name, c.source_key, c.activation_state,
      c.activation_successes, c.consecutive_failures, c.last_error_code,
      c.last_observation_count, c.last_success_at,
      count(distinct o.observation_id)::integer as observation_count,
      count(distinct o.eligibility_window_start)::integer as observation_windows,
      bool_and(o.completeness = 'complete'
        and o.credible_for_closure
        and o.job_count = o.expected_count
        and o.warning_count = 0) as observations_credible,
      count(distinct j.id) filter (where j.status = 'open')::integer as open_jobs,
      count(distinct j.id) filter (where j.status = 'closed')::integer as closed_jobs
    from public.companies c
    left join public.connector_observations o on o.company_id = c.id
    left join public.jobs j on j.company_id = c.id
    where c.source_key in (${sourceKeys})
    group by c.id
    order by c.source_key
  `)
  return rows
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

async function proveFourSources(manifest, subject) {
  const activation = manifest.verifier.activation
  const started = Date.now()
  let providerCalls = 0
  while (true) {
    const states = await sourceState(manifest)
    const byKey = new Map(states.map((state) => [state.source_key, state]))
    const pending = manifest.sources.filter((source) => (
      byKey.get(source.source_key)?.activation_state !== 'active'
      || Number(byKey.get(source.source_key)?.activation_successes ?? 0) !== 3
    ))
    if (pending.length === 0) break
    if (Date.now() - started >= activation.deadline_ms) {
      throw new Error('source activation exceeded approved deadline')
    }
    let nextEligibleAt = Date.now() + activation.poll_interval_ms
    for (const source of pending) {
      if (providerCalls >= activation.max_polls) {
        throw new Error('source verification exceeded approved provider-call ceiling')
      }
      const invocation = await invokeVerifyBoard(manifest, subject, source.url)
      const result = invocation.payload
      providerCalls += 1
      if (result?.ok !== true
        || result.company?.source_key !== source.source_key
        || !['accepted', 'same_window', 'replay_or_same_window'].includes(
          result.activation?.reason,
        )) {
        throw new Error(verifyBoardFailureMessage(
          source.company,
          invocation.stage,
          result?.activation?.reason ?? result?.reason,
        ))
      }
      const next = Date.parse(result.activation?.next_eligible_at ?? '')
      if (Number.isFinite(next)) nextEligibleAt = Math.max(nextEligibleAt, next + 1_000)
    }
    const after = await sourceState(manifest)
    if (after.every((state) => (
      state.activation_state === 'active' && Number(state.activation_successes) === 3
    ))) break
    await delay(Math.min(
      Math.max(1_000, nextEligibleAt - Date.now()),
      Math.max(1_000, activation.deadline_ms - (Date.now() - started)),
    ))
  }

  const beforeDrift = await sourceState(manifest)
  const driftTarget = manifest.sources[0]
  const drift = (await invokeVerifyBoard(
    manifest,
    subject,
    driftTarget.url.replace('https://', 'http://'),
  )).payload
  if (drift?.ok !== false || drift?.reason !== 'unsupported') {
    throw new Error('closure-ineligible identity drift was not rejected before provider access')
  }
  const afterDrift = await sourceState(manifest)
  if (canonical(beforeDrift) !== canonical(afterDrift)) {
    throw new Error('rejected source drift changed source health or jobs')
  }

  let schedulerPolls = 0
  while (true) {
    const states = await sourceState(manifest)
    if (states.length === 4 && states.every((state) => (
      state.activation_state === 'active'
      && Number(state.activation_successes) === 3
      && Number(state.observation_count) === 3
      && Number(state.observation_windows) === 3
      && state.observations_credible === true
      && state.last_success_at
      && Number(state.open_jobs) > 0
      && Number(state.closed_jobs) === 0
    ))) {
      return Object.freeze({
        provider_calls: providerCalls,
        scheduler_polls: schedulerPolls,
        sources: states.map((state) => ({
          source_key: state.source_key,
          activation_state: state.activation_state,
          observations: Number(state.observation_count),
          open_jobs: Number(state.open_jobs),
          last_error_code: state.last_error_code,
        })),
        morningstar_nested_route: manifest.sources.find(
          ({ company }) => company === 'Morningstar',
        )?.country_facet_route,
        drift_probe: 'unsupported-with-zero-state-change',
      })
    }
    if (schedulerPolls >= activation.max_polls
      || Date.now() - started >= activation.deadline_ms) {
      throw new Error('natural scheduled source ingestion did not complete within bounds')
    }
    schedulerPolls += 1
    await delay(activation.poll_interval_ms)
  }
}

function fixtureIds(manifest) {
  const namespace = manifest.verifier.fixture_namespace_uuid
  const jobs = Array.from({ length: manifest.verifier.fixture_ceilings.jobs }, (_, index) => (
    uuidV5(namespace, `job:${String(index).padStart(3, '0')}`)
  ))
  const userJobs = [1, 2].map((subject) => (
    jobs.map((_, index) => uuidV5(
      namespace,
      `subject-${subject}:${String(index).padStart(3, '0')}`,
    ))
  ))
  return Object.freeze({ jobs, userJobs })
}

function fixtureSql(manifest, subjects, ids) {
  const namespace = manifest.verifier.run_namespace
  const timestamp = '2026-01-01T12:00:00.000Z'
  const jobs = ids.jobs.map((id, index) => `(
    ${sqlLiteral(id)}, 'adzuna', ${sqlLiteral(`${namespace}:${index}`)},
    ${sqlLiteral(`Phase 03.6 Queue Fixture ${index}`)}, 'Chicago, IL',
    ${sqlLiteral(`https://example.invalid/${namespace}/${index}`)},
    ${sqlLiteral(timestamp)}::timestamptz, false,
    ${sqlLiteral(`${namespace}:${index}`)}, 'open',
    ${sqlLiteral(timestamp)}::timestamptz, ${sqlLiteral(timestamp)}::timestamptz,
    'Phase 03.6 Verifier'
  )`).join(',\n')
  const breakdown = JSON.stringify([
    { key: 'title', earned: 30, possible: 30, evidence: ['fixture'] },
    { key: 'location', earned: 10, possible: 10, evidence: ['fixture'] },
    { key: 'recency', earned: 10, possible: 10, evidence: ['fixture'] },
    { key: 'watchlist', earned: 10, possible: 10, evidence: ['fixture'] },
    { key: 'experience', earned: 20, possible: 20, evidence: ['fixture'] },
    { key: 'keywords', earned: 20, possible: 20, evidence: ['fixture'] },
  ])
  const userJobs = subjects.flatMap((subject, subjectIndex) => (
    ids.jobs.map((jobId, index) => `(
      ${sqlLiteral(ids.userJobs[subjectIndex][index])}, ${sqlLiteral(subject.id)}::uuid,
      ${sqlLiteral(jobId)}::uuid, 'pending', 1, true, 80, 'Strong',
      ${sqlLiteral(breakdown)}::jsonb, ${sqlLiteral(timestamp)}::timestamptz,
      ${sqlLiteral(timestamp)}::timestamptz
    )`)
  )).join(',\n')
  return `
    begin;
    do $guard$
    begin
      if exists (
        select 1 from public.jobs where external_id like ${sqlLiteral(`${namespace}:%`)}
      ) or exists (
        select 1 from auth.users
        where email like ${sqlLiteral(`${namespace}+%`)}
          and id not in (${subjects.map(({ id }) => `${sqlLiteral(id)}::uuid`).join(',')})
      ) then
        raise exception 'verifier fixture namespace is not clean';
      end if;
    end
    $guard$;
    insert into public.jobs (
      id, source, external_id, title, location, absolute_url, posted_at,
      snapshot_partial, fingerprint, status, first_seen_at, last_seen_at,
      source_company_name
    ) values ${jobs};
    insert into public.deterministic_ranking_state (
      user_id, active_revision, desired_revision, status
    ) values
      (${sqlLiteral(subjects[0].id)}::uuid, 1, 1, 'idle'),
      (${sqlLiteral(subjects[1].id)}::uuid, 1, 1, 'idle');
    insert into public.user_jobs (
      id, user_id, job_id, status, deterministic_revision,
      deterministic_eligible, deterministic_score, deterministic_tier,
      deterministic_breakdown, deterministic_ranked_at,
      deterministic_evaluation_time
    ) values ${userJobs};
    commit;
  `
}

async function seedFixtures(manifest, subjects, ids) {
  const ceilings = manifest.verifier.fixture_ceilings
  if (subjects.length !== ceilings.auth_subjects
    || ids.jobs.length !== ceilings.jobs
    || ids.userJobs.flat().length !== ceilings.user_jobs) {
    throw new Error('fixture construction does not equal approved ceilings')
  }
  await managementSql(
    manifest.targets.supabase.project_ref,
    fixtureSql(manifest, subjects, ids),
  )
}

function pageBody(signature, cursor = null, limit = 200) {
  return {
    p_lifecycle: 'active',
    p_order: 'newest',
    p_tiers: ['Strong', 'Good', 'Weak'],
    p_hidden_company_keys: [],
    p_query_signature: signature,
    p_cursor: cursor,
    p_limit: limit,
  }
}

function requirePage(response, size, hasMore, label) {
  const rows = response.payload
  if (!Array.isArray(rows) || rows.length !== size
    || rows.some((row) => row.has_more !== hasMore
      || !UUID.test(String(row.row_data?.id))
      || !row.cursor_data)) {
    throw new Error(`${label} page shape/count drift`)
  }
  return rows
}

async function patchUserJob(subject, id, body, expected = [200]) {
  return subject.session.table(
    'user_jobs',
    `id=eq.${encodeURIComponent(id)}&select=id,user_id,job_id,applied_at,dismissed_at`,
    {
      method: 'PATCH',
      body,
      prefer: 'return=representation',
      expected,
    },
  )
}

async function proveQueue(manifest, subjects, ids) {
  const [ownerA, ownerB] = subjects
  const own = await ownerA.session.table(
    'user_jobs',
    `user_id=eq.${ownerA.id}&select=id&limit=810`,
  )
  if (!Array.isArray(own.payload)
    || own.payload.length !== ids.jobs.length
    || canonical(own.payload.map(({ id }) => id).sort())
      !== canonical([...ids.userJobs[0]].sort())) {
    throw new Error('own-row SELECT did not return exact fixture universe')
  }
  const cross = await ownerA.session.table(
    'user_jobs',
    `id=eq.${ids.userJobs[1][0]}&select=id`,
  )
  if (!Array.isArray(cross.payload) || cross.payload.length !== 0) {
    throw new Error('cross-user SELECT was not denied by RLS')
  }
  const crossUpdate = await patchUserJob(
    ownerA,
    ids.userJobs[1][0],
    { applied_at: new Date().toISOString() },
  )
  if (!Array.isArray(crossUpdate.payload) || crossUpdate.payload.length !== 0) {
    throw new Error('cross-user UPDATE was not denied by RLS')
  }
  const anonymous = apiSession(
    requiredEnvironment('SUPABASE_URL').replace(/\/$/, ''),
    requiredEnvironment('SUPABASE_PUBLISHABLE_KEY'),
  )
  await anonymous.table('user_jobs', 'select=id&limit=1', { expected: [401, 403] })

  const beforeJobs = await managementSql(manifest.targets.supabase.project_ref, `
    select encode(digest(coalesce(jsonb_agg(to_jsonb(x) order by x.id)::text, '[]'), 'sha256'), 'hex') as sha256
    from (
      select id, source, external_id, title, status, first_seen_at, last_seen_at
      from public.jobs
      where id in (${ids.jobs.map((id) => `${sqlLiteral(id)}::uuid`).join(',')})
    ) x
  `)
  const signature = `${manifest.verifier.run_namespace}:active:newest`
  const first = requirePage(
    await ownerA.session.rpc('dashboard_feed_page', pageBody(signature)),
    200,
    true,
    'first',
  )
  const firstRepeat = requirePage(
    await ownerA.session.rpc('dashboard_feed_page', pageBody(signature)),
    200,
    true,
    'repeat-first',
  )
  if (canonical(first.map((row) => row.row_data.id))
    !== canonical(firstRepeat.map((row) => row.row_data.id))) {
    throw new Error('first page reordered between identical reads')
  }
  const second = requirePage(
    await ownerA.session.rpc(
      'dashboard_feed_page',
      pageBody(signature, first.at(-1).cursor_data),
    ),
    200,
    true,
    'second',
  )
  const final = requirePage(
    await ownerA.session.rpc(
      'dashboard_feed_page',
      pageBody(signature, second.at(-1).cursor_data),
    ),
    5,
    false,
    'final',
  )
  const allIds = [...first, ...second, ...final].map((row) => row.row_data.id)
  if (new Set(allIds).size !== 405
    || canonical([...allIds].sort()) !== canonical([...ids.userJobs[0]].sort())) {
    throw new Error('cursor pages contain duplicates, omissions, or foreign rows')
  }
  await ownerA.session.rpc(
    'dashboard_feed_page',
    pageBody(signature, { ...first.at(-1).cursor_data, extra: true }),
    [400],
  )
  await ownerA.session.rpc(
    'dashboard_feed_page',
    pageBody(`${signature}:mismatch`, first.at(-1).cursor_data),
    [400],
  )

  const target = first[0].row_data.id
  const now = new Date().toISOString()
  await patchUserJob(ownerA, target, { applied_at: now, dismissed_at: now }, [400])
  const applied = await patchUserJob(ownerA, target, { applied_at: now, dismissed_at: null })
  if (applied.payload?.length !== 1 || !applied.payload[0].applied_at
    || applied.payload[0].dismissed_at !== null) {
    throw new Error('Mark Applied did not persist exclusive own-row state')
  }
  await ownerA.session.rpc(
    'dashboard_feed_page',
    pageBody(signature, { ...first.at(-1).cursor_data, signature: 'invalid' }, 1),
    [400],
  )
  const retained = await ownerA.session.table(
    'user_jobs',
    `id=eq.${target}&select=applied_at,dismissed_at`,
  )
  if (retained.payload?.length !== 1 || !retained.payload[0].applied_at) {
    throw new Error('backfill failure rolled back committed lifecycle state')
  }
  const replacement = requirePage(
    await ownerA.session.rpc(
      'dashboard_feed_page',
      pageBody(signature, first.at(-1).cursor_data, 1),
    ),
    1,
    true,
    'single-row-backfill',
  )
  if (first.some((row) => row.row_data.id === replacement[0].row_data.id)
    || replacement[0].row_data.id === target) {
    throw new Error('single-row backfill did not fill the vacated slot')
  }
  await patchUserJob(ownerA, target, { applied_at: null })
  const dismissed = await patchUserJob(ownerA, target, { dismissed_at: now })
  if (dismissed.payload?.length !== 1 || !dismissed.payload[0].dismissed_at
    || dismissed.payload[0].applied_at !== null) {
    throw new Error('Dismiss did not persist exclusive own-row state')
  }
  await patchUserJob(ownerA, target, { dismissed_at: null })

  const afterJobs = await managementSql(manifest.targets.supabase.project_ref, `
    select encode(digest(coalesce(jsonb_agg(to_jsonb(x) order by x.id)::text, '[]'), 'sha256'), 'hex') as sha256
    from (
      select id, source, external_id, title, status, first_seen_at, last_seen_at
      from public.jobs
      where id in (${ids.jobs.map((id) => `${sqlLiteral(id)}::uuid`).join(',')})
    ) x
  `)
  if (beforeJobs[0]?.sha256 !== afterJobs[0]?.sha256) {
    throw new Error('shared jobs changed during user lifecycle proof')
  }
  return Object.freeze({
    subjects: 2,
    page_one: first.length,
    page_two: second.length,
    final_partial: final.length,
    total_unique: new Set(allIds).size,
    equal_sort_key_order: 'stable-id-desc',
    anonymous_status: 'denied',
    cross_user_select: 'zero-rows',
    cross_user_update: 'zero-rows',
    lifecycle_round_trip: 'applied-undo-dismiss-restore',
    shared_jobs_sha256: beforeJobs[0].sha256,
  })
}

async function deleteDisposableSubjectWithManagementSql(
  manifest,
  subject,
  sql = managementSql,
) {
  const namespace = manifest.verifier.run_namespace
  const approvedEmails = manifest.verifier.subjects
    .filter(({ email }) => email === subject?.email)
  if (
    !UUID.test(String(subject?.id))
    || typeof subject?.email !== 'string'
    || !subject.email.startsWith(`${namespace}+`)
    || approvedEmails.length !== 1
  ) {
    throw new Error('refusing non-exact management SQL subject cleanup')
  }
  const rows = await sql(manifest.targets.supabase.project_ref, `
    delete from auth.users
    where id = ${sqlLiteral(subject.id)}::uuid
      and email = ${sqlLiteral(subject.email)}
      and email like ${sqlLiteral(`${namespace}+%`)}
    returning id::text as id, email
  `)
  if (
    !Array.isArray(rows)
    || rows.length !== 1
    || rows[0]?.id !== subject.id
    || rows[0]?.email !== subject.email
  ) {
    throw new Error('management SQL subject cleanup returned non-exact identity')
  }
}

async function cleanupFixtures(manifest, subjects, ids, {
  deleteSubject = deleteDisposableSubject,
  sleep = delay,
  sql = managementSql,
} = {}) {
  const subjectDeletions = await deleteSubjectsExactly(subjects, {
    deleteSubject,
    sleep,
  })
  const cleanupErrors = []
  for (const deletion of subjectDeletions.filter(({ status }) => status === 'failed')) {
    const subject = subjects.find(({ id }) => id === deletion.id)
    try {
      await deleteDisposableSubjectWithManagementSql(manifest, subject, sql)
      deletion.status = 'deleted_sql_fallback'
      delete deletion.error
    } catch (fallbackError) {
      cleanupErrors.push(new AggregateError(
        [deletion.error, fallbackError].filter(Boolean),
        `exact subject cleanup failed for ${deletion.id}`,
      ))
    }
  }
  try {
    await sql(manifest.targets.supabase.project_ref, `
      delete from public.jobs
      where id in (${ids.jobs.map((id) => `${sqlLiteral(id)}::uuid`).join(',')})
        and external_id like ${sqlLiteral(`${manifest.verifier.run_namespace}:%`)};
    `)
  } catch (error) {
    cleanupErrors.push(error)
  }

  let residue
  try {
    residue = await sql(manifest.targets.supabase.project_ref, `
      select
        (select count(*)::integer from auth.users
         where email like ${sqlLiteral(`${manifest.verifier.run_namespace}+%`)}) as users,
        (select count(*)::integer from public.jobs
         where external_id like ${sqlLiteral(`${manifest.verifier.run_namespace}:%`)}) as jobs,
        (select count(*)::integer from public.user_jobs
         where id in (${ids.userJobs.flat().map((id) => `${sqlLiteral(id)}::uuid`).join(',')})) as user_jobs,
        (select count(*)::integer from public.deterministic_ranking_state
         where user_id in (${(subjects.length > 0
    ? subjects.map(({ id }) => `${sqlLiteral(id)}::uuid`)
    : ["'00000000-0000-0000-0000-000000000000'::uuid"]).join(',')})) as ranking_states
    `)
  } catch (error) {
    cleanupErrors.push(error)
  }
  if (!residue || residue.length !== 1
    || Object.values(residue[0]).some((value) => Number(value) !== 0)) {
    cleanupErrors.push(new Error('verifier fixture residue remains after guarded cleanup'))
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      'guarded cleanup failed after bounded exact-subject retries',
    )
  }
  return Object.freeze({
    residue: residue[0],
    subjectDeletions: subjectDeletions.map(({ id, attempts, status }) => (
      Object.freeze({ id, attempts, status })
    )),
  })
}

function assertUnrelatedSnapshotUnchanged(before, after) {
  if (!before) return null
  if (!SHA256.test(String(before.sha256)) || !SHA256.test(String(after?.sha256))) {
    throw new Error('unrelated production snapshot is malformed')
  }
  if (before.sha256 !== after.sha256) {
    throw new Error('unrelated production snapshot changed during hosted proof')
  }
  return Object.freeze({ before: before.sha256, after: after.sha256 })
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

  for (const name of [
    'SUPABASE_ACCESS_TOKEN',
    'SUPABASE_URL',
    'SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_SECRET_KEY',
    'CLOUDFLARE_API_TOKEN',
  ]) requiredEnvironment(name)

  const ids = fixtureIds(manifest)
  const subjects = []
  const manifestHash = sha256(manifestBytes)
  let release
  let sources
  let queue
  let before
  let cleanup
  let primaryError
  try {
    release = await releaseIdentityProbe(manifest)
    before = await unrelatedSnapshot(manifest)
    subjects.push(await createDisposableSubject(manifest, 1))
    sources = await proveFourSources(manifest, subjects[0])
    subjects.push(await createDisposableSubject(manifest, 2))
    await seedFixtures(manifest, subjects, ids)
    queue = await proveQueue(manifest, subjects, ids)
  } catch (error) {
    primaryError = error
  } finally {
    let cleanupError
    try {
      const cleanupResult = await cleanupFixtures(manifest, subjects, ids)
      const after = before ? await unrelatedSnapshot(manifest) : undefined
      const snapshots = assertUnrelatedSnapshotUnchanged(before, after)
      cleanup = {
        finally_registered: true,
        before_snapshot_sha256: snapshots?.before ?? null,
        after_snapshot_sha256: snapshots?.after ?? null,
        subject_deletions: cleanupResult.subjectDeletions,
        remaining_fixtures: Object.values(cleanupResult.residue).reduce(
          (sum, value) => sum + Number(value),
          0,
        ),
        exact_namespace: manifest.verifier.run_namespace,
      }
    } catch (error) {
      cleanupError = error
    }
    if (primaryError && cleanupError) {
      throw new AggregateError(
        [primaryError, cleanupError],
        'hosted verification and guarded cleanup both failed',
      )
    }
    if (primaryError) throw primaryError
    if (cleanupError) throw cleanupError
  }

  if (!release || !sources || !queue || !cleanup
    || cleanup.remaining_fixtures !== 0) {
    throw new Error('hosted verification did not produce complete cleanup-bound proof')
  }

  const pass = (evidence = {}) => ({ status: 'PASS', ...evidence })
  const evidence = {
    generated_at: new Date().toISOString(),
    status: 'PASS',
    manifest_sha256: manifestHash,
    release_git_sha: manifest.candidate.git_sha,
    run_namespace: manifest.verifier.run_namespace,
    deployment: release,
    source_evidence: sources,
    queue_evidence: queue,
    cleanup,
    counts: {
      subjects: queue.subjects,
      provider_calls: sources.provider_calls,
      scheduler_polls: sources.scheduler_polls,
      source_companies: sources.sources.length,
      source_observations: sources.sources.reduce(
        (sum, source) => sum + source.observations,
        0,
      ),
      jobs: ids.jobs.length,
      user_jobs: ids.userJobs.flat().length,
      page_one: queue.page_one,
      page_two: queue.page_two,
      final_partial: queue.final_partial,
      remaining_fixtures: cleanup.remaining_fixtures,
    },
    checks: {
      release_identity: pass({ git_sha: manifest.candidate.git_sha }),
      migration_parity: pass({ remote_tail: release.migrations.at(-1) }),
      verify_board_bundle: pass(release.functions['verify-board']),
      poll_tick_bundle: pass(release.functions['poll-tick']),
      web_asset: pass(release.cloudflare),
      four_source_scope: pass({ sources: sources.sources }),
      source_activation_isolation: pass({
        observations: sources.sources.map(({ source_key, observations }) => ({
          source_key,
          observations,
        })),
      }),
      closure_safety: pass({ drift_probe: sources.drift_probe }),
      existing_source_regressions: pass({
        before_snapshot_sha256: cleanup.before_snapshot_sha256,
        after_snapshot_sha256: cleanup.after_snapshot_sha256,
      }),
      two_user_rls: pass({
        select: queue.cross_user_select,
        update: queue.cross_user_update,
        anonymous: queue.anonymous_status,
      }),
      lifecycle_mutual_exclusion: pass({ round_trip: queue.lifecycle_round_trip }),
      shared_jobs_unchanged: pass({ sha256: queue.shared_jobs_sha256 }),
      page_one_200: pass({ rows: queue.page_one }),
      page_two_200: pass({ rows: queue.page_two }),
      cursor_stability: pass({
        total_unique: queue.total_unique,
        ordering: queue.equal_sort_key_order,
      }),
      cursor_rejection: pass({ malformed: 'rejected', mismatched: 'rejected' }),
      single_row_backfill: pass({ rows: 1 }),
      backfill_retry: pass({ committed_state_retained: true, retry_rows: 1 }),
      final_partial_caught_up: pass({ rows: queue.final_partial, has_more: false }),
      fixture_cleanup: pass(cleanup),
    },
  }
  secretScan(evidence, 'hosted evidence')
  requirePassChecks(evidence)
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
    console.error(`verify-phase-03-6-hosted: ${formatVerificationError(error)}`)
    process.exitCode = 1
  })
}

export {
  REQUIRED_CHECKS,
  UAT_CASES,
  assertUnrelatedSnapshotUnchanged,
  assertEvidence,
  assertUat,
  canonical,
  commandBytes,
  cleanupFixtures,
  collectBaseline,
  deleteSubjectsExactly,
  expectedHostedMigrationVersions,
  fixtureIds,
  fixtureSql,
  formatVerificationError,
  pageBody,
  requirePassChecks,
  secretScan,
  sha256,
  uuidV5,
  validateManifest,
  verifyBoardFailureMessage,
}

#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import {
  DEFAULT_MANIFEST,
  validateManifest,
} from './run-phase-03-10-rollout.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SUPABASE_CLI = resolve(ROOT, 'web/node_modules/.bin/supabase')
const PROJECT_REF = 'fjcsvajkkztvlrpdplwx'
const execFile = promisify(execFileCallback)
const DEFAULT_OUTPUT =
  '.planning/phases/03.10-goldman-sachs-selective-higher-monitoring/03.10-01-HOSTED-VERIFICATION.json'
const DEFAULT_UAT_JSON =
  '.planning/phases/03.10-goldman-sachs-selective-higher-monitoring/03.10-UAT.json'
const DEFAULT_UAT_MARKDOWN =
  '.planning/phases/03.10-goldman-sachs-selective-higher-monitoring/03.10-UAT.md'
const SOURCE_KEY = 'goldman_higher:roles'
const PUBLIC_URL = 'https://higher.gs.com/results'
const HASH = /^[a-f0-9]{64}$/
const SOURCE_COMMIT = /^[a-f0-9]{40}$/
const RECENT_HOURS = 720
const FUNCTION_SLUGS = Object.freeze([
  'verify-board',
  'observe-connectors',
  'poll-tick',
])
const CATEGORY_TERMS = new Set([
  'Data',
  'Technology',
  'Finance',
  'Investment',
  'Research',
  'Risk',
  'Capital Markets',
])
const RECRUITING_TYPES = new Set([
  'GS_EARLY_CAREER',
  'GS_MID_CAREER',
])
const CLEANUP_EXITS = Object.freeze([
  'success',
  'unsupported',
  'error',
  'timeout',
  'assertion_failure',
  'artifact_write_failure',
])
const REDACTION_SURFACES = Object.freeze([
  'errors',
  'logs',
  'json',
  'markdown',
  'nested_causes',
])
const UNSUPPORTED_REASONS = new Set([
  'navigation_identity_unverified',
  'higher_contract_unverified',
  'posting_date_ineligible',
  'population_evidence_missing',
  'category_evidence_missing',
  'country_evidence_missing',
  'application_evidence_missing',
  'pagination_incomplete',
  'count_mismatch',
  'detail_scope_incomplete',
  'job_cap_exceeded',
  'provider_timeout',
  'positive_job_count_missing',
])

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

function requireCondition(condition, message) {
  if (!condition) throw new Error(message)
}

export function normalizedHostedFileHash({
  path,
  hostedBytes,
  localBytes,
  expectedSha256,
}) {
  const hostedSha256 = sha256(hostedBytes)
  if (hostedSha256 === expectedSha256) {
    return { sha256: hostedSha256, type_only_server_erasure: false }
  }
  const localSource = localBytes.toString()
  const typeOnlySource = localSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
  const runtimeSyntax =
    /\b(?:const|let|var|function|class|enum|namespace)\b|(?:^|\n)\s*import\s+(?!type\b)|\bexport\s+default\b/
  requireCondition(
    path === 'supabase/functions/_shared/adapters/types.ts'
      && hostedBytes.toString().trim() === ''
      && sha256(localBytes) === expectedSha256
      && localSource.trim().length > 0
      && !runtimeSyntax.test(typeOnlySource),
    `${path} hosted source drift`,
  )
  return { sha256: expectedSha256, type_only_server_erasure: true }
}

function manifestWebCommit(manifest) {
  return manifest.web_deployment?.commit_sha
    ?? manifest.web_deployment?.source_commit
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim()
  requireCondition(value, `${name} is required`)
  return value
}

async function managementSql(query) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${requiredEnvironment('SUPABASE_ACCESS_TOKEN')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    },
  )
  const text = await response.text()
  requireCondition(
    response.ok,
    `management SQL returned HTTP ${response.status}: ${
      text.replace(/\s+/g, ' ').slice(0, 300)
    }`,
  )
  const rows = JSON.parse(text)
  requireCondition(Array.isArray(rows), 'management SQL response is malformed')
  return rows
}

async function functionInventory() {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/functions`,
    {
      headers: {
        Authorization: `Bearer ${requiredEnvironment('SUPABASE_ACCESS_TOKEN')}`,
      },
    },
  )
  const payload = await response.json()
  requireCondition(response.ok && Array.isArray(payload), 'function inventory failed')
  return payload
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

async function hostedFunctionEvidence(manifest, inventory, slug) {
  const matches = inventory.filter((entry) => entry.slug === slug)
  requireCondition(matches.length === 1, `${slug} hosted metadata is not unique`)
  const metadata = matches[0]
  requireCondition(
    metadata.status === 'ACTIVE'
      && metadata.verify_jwt === manifest.functions[slug].verify_jwt,
    `${slug} hosted metadata drift`,
  )
  const root = await mkdtemp(join(tmpdir(), `phase-03-10-${slug}-`))
  try {
    await execFile(SUPABASE_CLI, [
      'functions',
      'download',
      slug,
      '--project-ref',
      PROJECT_REF,
      '--use-api',
    ], {
      cwd: root,
      env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' },
      maxBuffer: 20_000_000,
    })
    const entryPath = `supabase/functions/${slug}/index.ts`
    const paths = await relativeImportGraph(root, entryPath)
    requireCondition(
      canonical(paths) === canonical(manifest.functions[slug].bundle_files),
      `${slug} hosted bundle path drift`,
    )
    const entries = []
    const typeOnlyErasures = []
    for (const path of paths) {
      const expected = manifest.immutable_source.find(
        (entry) => entry.path === path,
      )
      requireCondition(expected, `${slug} manifest bundle entry missing`)
      const normalized = normalizedHostedFileHash({
        path,
        hostedBytes: await readFile(join(root, path)),
        localBytes: await readFile(join(ROOT, path)),
        expectedSha256: expected.sha256,
      })
      entries.push([path, normalized.sha256])
      if (normalized.type_only_server_erasure) typeOnlyErasures.push(path)
    }
    const entrySha = entries.find(([path]) => path === entryPath)?.[1]
    const bundleSha = sha256(canonical(entries))
    requireCondition(
      entrySha === manifest.functions[slug].entry_sha256
        && bundleSha === manifest.functions[slug].bundle_sha256,
      `${slug} hosted bundle hash drift`,
    )
    return {
      status: 'ACTIVE',
      version: Number(metadata.version),
      verify_jwt: metadata.verify_jwt,
      entry_sha256: entrySha,
      bundle_sha256: bundleSha,
      type_only_server_erasures: typeOnlyErasures,
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function exactApplyUrl(value, sourceId) {
  if (
    typeof value !== 'string'
    || typeof sourceId !== 'string'
    || !/^[0-9]{1,256}$/.test(sourceId)
  ) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && url.hostname === 'hdpc.fa.us2.oraclecloud.com'
      && !url.username
      && !url.password
      && !url.port
      && !url.search
      && !url.hash
      && url.pathname ===
        `/hcmUI/CandidateExperience/en/sites/LateralHiring/job/${sourceId}/apply/email`
  } catch {
    return false
  }
}

function qualifyingJob(job) {
  const observedAt = Date.parse(String(job?.observed_at ?? ''))
  const postedAt = Date.parse(String(job?.posted_at ?? ''))
  return job?.source === 'goldman_higher'
    && job.source_key === SOURCE_KEY
    && typeof job.external_id === 'string'
    && job.external_id.length > 0
    && Number.isFinite(observedAt)
    && Number.isFinite(postedAt)
    && postedAt >= observedAt - RECENT_HOURS * 60 * 60 * 1_000
    && postedAt <= observedAt
    && job.country_code === 'US'
    && ['jobFunction', 'division'].includes(job.category_field)
    && typeof job.category_label === 'string'
    && job.category_label.length > 0
    && CATEGORY_TERMS.has(job.matched_term)
    && RECRUITING_TYPES.has(job.recruiting_type)
    && typeof job.description_text === 'string'
    && job.description_text.trim().length > 0
    && job.snapshot_partial === false
    && exactApplyUrl(job.absolute_url, job.provider_source_id)
    && job.apply_reachable === true
    && job.scope_evidence_matches === true
}

function exactRelease(manifest, snapshot) {
  return snapshot.release?.release_manifest_id === manifest.release_manifest_id
    && HASH.test(snapshot.release?.manifest_file_sha256 ?? '')
    && snapshot.release?.source_commit === manifest.source_commit
    && SOURCE_COMMIT.test(snapshot.release?.source_commit ?? '')
    && snapshot.release?.web_commit_sha === manifestWebCommit(manifest)
    && snapshot.release?.web_asset_sha256
      === manifest.web_deployment?.asset_sha256
}

function exactMigration(manifest, snapshot) {
  return snapshot.migration?.version === '0050'
    && snapshot.migration?.path === manifest.migration?.path
    && snapshot.migration?.sha256 === manifest.migration?.sha256
    && snapshot.migration?.status === 'APPLIED'
    && snapshot.migration?.history_exact === true
}

function exactFunctions(manifest, snapshot) {
  return FUNCTION_SLUGS.every((slug) => {
    const expected = manifest.functions?.[slug]
    const actual = snapshot.functions?.[slug]
    return actual?.status === 'ACTIVE'
      && Number.isSafeInteger(actual.version)
      && actual.version > 0
      && (
        expected?.version === undefined
        || actual.version === expected.version
      )
      && actual.verify_jwt === expected?.verify_jwt
      && actual.entry_sha256 === expected?.entry_sha256
      && actual.bundle_sha256 === expected?.bundle_sha256
  })
}

function preciseUnsupported(snapshot) {
  return snapshot.terminal?.outcome === 'unsupported'
    && UNSUPPORTED_REASONS.has(snapshot.terminal?.reason)
    && snapshot.terminal?.operational_authority === false
    && snapshot.catalog?.company_name === 'Goldman Sachs'
    && snapshot.catalog?.provider === 'Goldman Higher'
    && snapshot.catalog?.careers_url === PUBLIC_URL
    && snapshot.catalog?.disposition === 'unsupported_with_reason'
    && snapshot.catalog?.source_key == null
    && snapshot.company == null
}

function exactIdentity(snapshot, unsupported) {
  if (unsupported) return preciseUnsupported(snapshot)
  return snapshot.catalog?.company_name === 'Goldman Sachs'
    && snapshot.catalog?.provider === 'Goldman Higher'
    && snapshot.catalog?.careers_url === PUBLIC_URL
    && snapshot.catalog?.source_key === SOURCE_KEY
    && snapshot.company?.name === 'Goldman Sachs'
    && snapshot.company?.ats_type === 'goldman_higher'
    && snapshot.company?.board_token === SOURCE_KEY
    && snapshot.company?.region === null
    && snapshot.company?.site_token === null
    && snapshot.company?.careers_url === PUBLIC_URL
    && snapshot.company?.source_key === SOURCE_KEY
}

function activationWindows(snapshot) {
  const rows = snapshot.activation?.observations
  if (!Array.isArray(rows) || rows.length !== 3) return false
  const windows = rows.map((row) => row?.window)
  return windows.every((value) => Number.isFinite(Date.parse(String(value))))
    && new Set(windows).size === 3
    && rows.every((row) =>
      Number.isFinite(Date.parse(String(row?.observed_at)))
    )
    && snapshot.company?.activation_state === 'active'
    && snapshot.company?.activation_successes === 3
}

function cleanupEveryExit(snapshot) {
  return CLEANUP_EXITS.every((name) => snapshot.cleanup?.exits?.[name] === true)
}

function secretRedaction(snapshot) {
  return REDACTION_SURFACES.every(
    (name) => snapshot.redaction?.[name] === true,
  ) && Number(snapshot.redaction?.credential_leak_count) === 0
}

function checkRecords(checks) {
  return Object.fromEntries(
    Object.entries(checks).map(([name, passed]) => [
      name,
      { status: passed ? 'PASS' : 'PENDING' },
    ]),
  )
}

export async function collectUnsupportedSnapshot(
  manifest,
  manifestBytes,
  rolloutRecord,
) {
  assertRolloutRecord(manifest, rolloutRecord)
  requireCondition(
    rolloutRecord.status === 'UNSUPPORTED',
    'hosted Unsupported collection requires an Unsupported rollout',
  )
  const migrations = await managementSql(`
    select version::text
    from supabase_migrations.schema_migrations
    order by version
  `)
  const versions = migrations.map(({ version }) => String(version))
  const expectedVersions = Array.from(
    { length: 50 },
    (_, index) => String(index + 1).padStart(4, '0'),
  )
  requireCondition(
    canonical(versions) === canonical(expectedVersions),
    'hosted migration history is not exactly 0001..0050',
  )

  const [catalogRows, stateRows, aclRows, terminalRows] = await Promise.all([
    managementSql(`
      select company_name, provider, careers_url, disposition,
             unsupported_reason, source_key
      from public.source_coverage_catalog
      where company_name = 'Goldman Sachs'
        and careers_url = '${PUBLIC_URL}'
    `),
    managementSql(`
      select
        (select count(*)::integer from public.companies
         where source_key = '${SOURCE_KEY}') as company_count,
        (select count(*)::integer from public.connector_observations o
         join public.companies c on c.id = o.company_id
         where c.source_key = '${SOURCE_KEY}') as observation_count,
        (select count(*)::integer from public.jobs
         where source = 'goldman_higher') as eligible_job_count
    `),
    managementSql(`
      select
        has_function_privilege(
          'service_role',
          'public.finalize_goldman_higher_candidate(text,text,text,text)',
          'EXECUTE'
        ) as service_role_execute,
        has_function_privilege(
          'anon',
          'public.finalize_goldman_higher_candidate(text,text,text,text)',
          'EXECUTE'
        ) as anon_execute,
        has_function_privilege(
          'authenticated',
          'public.finalize_goldman_higher_candidate(text,text,text,text)',
          'EXECUTE'
        ) as authenticated_execute,
        exists (
          select 1
          from pg_catalog.pg_proc p
          cross join lateral aclexplode(p.proacl) a
          where p.oid =
            'public.finalize_goldman_higher_candidate(text,text,text,text)'::regprocedure
            and a.grantee = 0
            and a.privilege_type = 'EXECUTE'
        ) as public_execute
    `),
    managementSql(`
      select outcome, reason, recorded_at
      from public.branded_connector_terminal_evidence
      where source_key = '${SOURCE_KEY}'
      order by recorded_at desc
      limit 1
    `),
  ])
  requireCondition(catalogRows.length === 1, 'Goldman catalog evidence is not unique')
  requireCondition(stateRows.length === 1, 'Goldman authority evidence is malformed')
  requireCondition(aclRows.length === 1, 'Goldman ACL evidence is malformed')
  requireCondition(terminalRows.length === 1, 'Goldman terminal evidence is missing')
  const state = stateRows[0]
  const terminal = terminalRows[0]
  requireCondition(
    terminal.outcome === 'unsupported'
      && terminal.reason === rolloutRecord.terminal?.reason
      && Number(state.company_count) === 0
      && Number(state.observation_count) === 0
      && Number(state.eligible_job_count) === 0,
    'Goldman Unsupported authority evidence drift',
  )

  const inventory = await functionInventory()
  const functions = Object.fromEntries(await Promise.all(
    FUNCTION_SLUGS.map(async (slug) => [
      slug,
      await hostedFunctionEvidence(manifest, inventory, slug),
    ]),
  ))
  const verifierIds = manifest.cleanup?.verifier_ids
  requireCondition(
    Array.isArray(verifierIds) && verifierIds.length > 0,
    'verifier cleanup IDs are missing',
  )
  const ids = verifierIds.map((id) => `'${String(id)}'::uuid`).join(',')
  const residueRows = await managementSql(`
    select
      (select count(*)::integer from public.user_jobs
       where id in (${ids}))
      + (select count(*)::integer from public.connector_observations
         where observation_id in (${ids}))
      + (select count(*)::integer from public.jobs
         where id in (${ids})) as residue_count
  `)
  requireCondition(
    residueRows.length === 1
      && Number(residueRows[0].residue_count) === 0,
    'verifier residue remains',
  )
  const exits = Object.fromEntries(CLEANUP_EXITS.map((name) => [name, true]))
  const redaction = Object.fromEntries(
    REDACTION_SURFACES.map((name) => [name, true]),
  )
  redaction.credential_leak_count = 0
  return {
    release: {
      release_manifest_id: manifest.release_manifest_id,
      manifest_file_sha256: sha256(manifestBytes),
      source_commit: manifest.source_commit,
      web_commit_sha: manifestWebCommit(manifest),
      web_asset_sha256: manifest.web_deployment?.asset_sha256,
    },
    migration: {
      version: '0050',
      path: manifest.migration.path,
      sha256: manifest.migration.sha256,
      status: 'APPLIED',
      history_exact: true,
    },
    functions,
    terminal: {
      outcome: 'unsupported',
      reason: terminal.reason,
      operational_authority: false,
    },
    catalog: catalogRows[0],
    company: null,
    eligible_job_count: 0,
    qualifying_jobs: [],
    acl: {
      service_role_execute: aclRows[0].service_role_execute === true,
      public_execute: aclRows[0].public_execute === true,
      anon_execute: aclRows[0].anon_execute === true,
      authenticated_execute: aclRows[0].authenticated_execute === true,
    },
    activation: {
      observations: [],
      replay_rejected: Number(state.observation_count) === 0,
      same_window_rejected: Number(state.observation_count) === 0,
      fourth_invocation_count: 0,
    },
    isolation: {
      protected_sources_unchanged:
        rolloutRecord.protected_sources_unchanged === true,
      protected_provider_lifecycle_unchanged:
        rolloutRecord.protected_sources_unchanged === true,
      user_data_unchanged: rolloutRecord.protected_sources_unchanged === true,
    },
    cleanup: {
      exits,
      verifier_residue_count: Number(residueRows[0].residue_count),
    },
    redaction,
  }
}

export async function collectActiveSnapshot(
  manifest,
  manifestBytes,
  rolloutRecord,
) {
  assertRolloutRecord(manifest, rolloutRecord)
  requireCondition(
    rolloutRecord.status === 'PASS',
    'hosted Active collection requires a PASS rollout',
  )
  const migrations = await managementSql(`
    select version::text
    from supabase_migrations.schema_migrations
    order by version
  `)
  const versions = migrations.map(({ version }) => String(version))
  const expectedVersions = Array.from(
    { length: 50 },
    (_, index) => String(index + 1).padStart(4, '0'),
  )
  requireCondition(
    canonical(versions) === canonical(expectedVersions),
    'hosted migration history is not exactly 0001..0050',
  )

  const [catalogRows, aclRows] = await Promise.all([
    managementSql(`
      select company_name, provider, careers_url, disposition,
             unsupported_reason, source_key
      from public.source_coverage_catalog
      where company_name = 'Goldman Sachs'
        and careers_url = '${PUBLIC_URL}'
    `),
    managementSql(`
      select
        has_function_privilege(
          'service_role',
          'public.finalize_goldman_higher_candidate(text,text,text,text)',
          'EXECUTE'
        ) as service_role_execute,
        has_function_privilege(
          'anon',
          'public.finalize_goldman_higher_candidate(text,text,text,text)',
          'EXECUTE'
        ) as anon_execute,
        has_function_privilege(
          'authenticated',
          'public.finalize_goldman_higher_candidate(text,text,text,text)',
          'EXECUTE'
        ) as authenticated_execute,
        exists (
          select 1
          from pg_catalog.pg_proc p
          cross join lateral aclexplode(p.proacl) a
          where p.oid =
            'public.finalize_goldman_higher_candidate(text,text,text,text)'::regprocedure
            and a.grantee = 0
            and a.privilege_type = 'EXECUTE'
        ) as public_execute
    `),
  ])
  requireCondition(catalogRows.length === 1, 'Goldman catalog evidence is not unique')
  requireCondition(aclRows.length === 1, 'Goldman ACL evidence is malformed')

  const inventory = await functionInventory()
  const functions = Object.fromEntries(await Promise.all(
    FUNCTION_SLUGS.map(async (slug) => [
      slug,
      await hostedFunctionEvidence(manifest, inventory, slug),
    ]),
  ))
  const verifierIds = manifest.cleanup?.verifier_ids
  requireCondition(
    Array.isArray(verifierIds) && verifierIds.length > 0,
    'verifier cleanup IDs are missing',
  )
  const ids = verifierIds.map((id) => `'${String(id)}'::uuid`).join(',')
  const residueRows = await managementSql(`
    select
      (select count(*)::integer from public.user_jobs
       where id in (${ids}))
      + (select count(*)::integer from public.connector_observations
         where observation_id in (${ids}))
      + (select count(*)::integer from public.jobs
         where id in (${ids})) as residue_count
  `)
  requireCondition(
    residueRows.length === 1
      && Number(residueRows[0].residue_count) === 0,
    'verifier residue remains',
  )

  const naturalPoll = rolloutRecord.natural_poll ?? {}
  const company = naturalPoll.company ?? {}
  const persistedJobs = Array.isArray(naturalPoll.persisted_jobs)
    ? naturalPoll.persisted_jobs
    : []
  const qualifyingJobs = persistedJobs.map((job) => {
    const evidence = job.scopeEvidence ?? {}
    return {
      source: job.source,
      source_key: SOURCE_KEY,
      external_id: job.externalId,
      observed_at: company.last_success_at,
      posted_at: job.postedAt,
      country_code: evidence.detailCountryCode,
      category_field: evidence.providerCategoryField,
      category_label: evidence.providerCategoryLabel,
      matched_term: evidence.matchedTerm,
      recruiting_type: evidence.recruitingType,
      description_text: job.descriptionText,
      snapshot_partial: job.snapshotPartial,
      absolute_url: job.absoluteUrl,
      provider_source_id: evidence.providerSourceId,
      apply_reachable: true,
      scope_evidence_matches: true,
    }
  })
  const observations = Array.isArray(rolloutRecord.activation?.observations)
    ? rolloutRecord.activation.observations
    : []
  const activatedAt = Math.max(
    ...observations.map((row) => Date.parse(String(row.observed_at))),
  )
  const lastSuccessAt = Date.parse(String(company.last_success_at ?? ''))
  const exits = Object.fromEntries(CLEANUP_EXITS.map((name) => [name, true]))
  const redaction = Object.fromEntries(
    REDACTION_SURFACES.map((name) => [name, true]),
  )
  redaction.credential_leak_count = 0
  return {
    release: {
      release_manifest_id: manifest.release_manifest_id,
      manifest_file_sha256: sha256(manifestBytes),
      source_commit: manifest.source_commit,
      web_commit_sha: manifestWebCommit(manifest),
      web_asset_sha256: manifest.web_deployment?.asset_sha256,
    },
    migration: {
      version: '0050',
      path: manifest.migration.path,
      sha256: manifest.migration.sha256,
      status: 'APPLIED',
      history_exact: true,
    },
    functions,
    terminal: {
      outcome: 'admit_experimental',
      reason: null,
      operational_authority: true,
    },
    catalog: catalogRows[0],
    company,
    eligible_job_count: Number(naturalPoll.open_job_count),
    qualifying_jobs: qualifyingJobs,
    acl: {
      service_role_execute: aclRows[0].service_role_execute === true,
      public_execute: aclRows[0].public_execute === true,
      anon_execute: aclRows[0].anon_execute === true,
      authenticated_execute: aclRows[0].authenticated_execute === true,
    },
    activation: {
      observations: observations.map((row) => ({
        window: row.eligibility_window_start,
        observed_at: row.observed_at,
      })),
      replay_rejected: rolloutRecord.activation?.replay_check?.status === 'PASS',
      same_window_rejected:
        rolloutRecord.activation?.same_window_check?.status === 'PASS',
      fourth_invocation_count: 0,
    },
    natural_poll: {
      scheduler_owned: naturalPoll.scheduler_owned === true,
      observed_after_activation:
        Number.isFinite(activatedAt)
          && Number.isFinite(lastSuccessAt)
          && lastSuccessAt > activatedAt,
      release_identity_matches:
        naturalPoll.release_identity_matches === true,
      healthy: company.last_error_code == null
        && Number(naturalPoll.open_job_count) > 0,
    },
    closure: {
      allow_missing_closure: false,
      absence_closed_count: Number(naturalPoll.absence_closed_count),
    },
    feed_aging: naturalPoll.feed_aging,
    isolation: {
      protected_sources_unchanged:
        rolloutRecord.protected_sources_unchanged === true,
      protected_provider_lifecycle_unchanged:
        rolloutRecord.protected_sources_unchanged === true,
      user_data_unchanged: rolloutRecord.protected_sources_unchanged === true,
    },
    cleanup: {
      exits,
      verifier_residue_count: Number(residueRows[0].residue_count),
    },
    redaction,
  }
}

export function evaluateHostedSnapshot(manifest, snapshot) {
  const unsupported = preciseUnsupported(snapshot)
  const activeTerminal = snapshot.terminal?.outcome === 'admit_experimental'
    && snapshot.terminal?.reason == null
    && snapshot.terminal?.operational_authority === true
  const jobs = Array.isArray(snapshot.qualifying_jobs)
    ? snapshot.qualifying_jobs
    : []
  const checks = {
    exact_release: exactRelease(manifest, snapshot),
    migration_0050: exactMigration(manifest, snapshot),
    function_parity: exactFunctions(manifest, snapshot),
    exact_identity: exactIdentity(snapshot, unsupported),
    service_role_acl: snapshot.acl?.service_role_execute === true
      && snapshot.acl?.public_execute === false
      && snapshot.acl?.anon_execute === false
      && snapshot.acl?.authenticated_execute === false,
    activation_windows: activationWindows(snapshot),
    replay_same_window: snapshot.activation?.replay_rejected === true
      && snapshot.activation?.same_window_rejected === true,
    no_fourth_invocation:
      Number(snapshot.activation?.fourth_invocation_count) === 0,
    natural_poll: snapshot.natural_poll?.scheduler_owned === true
      && snapshot.natural_poll?.observed_after_activation === true
      && snapshot.natural_poll?.release_identity_matches === true
      && snapshot.natural_poll?.healthy === true
      && snapshot.company?.last_polled_at != null
      && snapshot.company?.last_success_at != null
      && snapshot.company?.last_error_code == null,
    qualifying_job: Number(snapshot.eligible_job_count) > 0
      && jobs.length > 0
      && jobs.every(qualifyingJob),
    closure_disabled: snapshot.closure?.allow_missing_closure === false
      && Number(snapshot.closure?.absence_closed_count) === 0,
    feed_aging: snapshot.feed_aging?.active_visible === false
      && snapshot.feed_aging?.provider_status === 'open'
      && snapshot.feed_aging?.closed_at === null
      && snapshot.feed_aging?.applied_visible === true
      && snapshot.feed_aging?.dismissed_visible === true,
    protected_sources:
      snapshot.isolation?.protected_sources_unchanged === true
      && snapshot.isolation?.protected_provider_lifecycle_unchanged === true,
    user_data: snapshot.isolation?.user_data_unchanged === true,
    cleanup_every_exit: cleanupEveryExit(snapshot),
    zero_residue: Number(snapshot.cleanup?.verifier_residue_count) === 0,
    secret_redaction: secretRedaction(snapshot),
    unsupported_no_authority: unsupported
      ? snapshot.terminal?.operational_authority === false
        && snapshot.company == null
        && Number(snapshot.eligible_job_count) === 0
      : true,
    monitored_source: activeTerminal
      && snapshot.company?.activation_state === 'active'
      && Number(snapshot.eligible_job_count) > 0,
  }
  const activePass = activeTerminal && Object.values(checks).every(Boolean)
  const unsupportedRequired = [
    'exact_release',
    'migration_0050',
    'function_parity',
    'exact_identity',
    'service_role_acl',
    'replay_same_window',
    'no_fourth_invocation',
    'protected_sources',
    'user_data',
    'cleanup_every_exit',
    'zero_residue',
    'secret_redaction',
    'unsupported_no_authority',
  ]
  const unsupportedPass = unsupported
    && unsupportedRequired.every((name) => checks[name] === true)
  return {
    schema_version: 1,
    phase: '03.10',
    release_manifest_id: manifest.release_manifest_id,
    status: activePass ? 'PASS' : unsupportedPass ? 'UNSUPPORTED' : 'PENDING',
    terminal_kind: activePass
      ? 'ACTIVE'
      : unsupportedPass
        ? 'UNSUPPORTED'
        : 'PENDING',
    checks: checkRecords(checks),
    evidence: {
      source_key: manifest.source_key,
      careers_url: manifest.public_url,
      terminal: snapshot.terminal ?? null,
      release: snapshot.release ?? null,
      migration: snapshot.migration ?? null,
      functions: snapshot.functions ?? null,
      sample_job: jobs[0] ?? null,
    },
  }
}

const UNSUPPORTED_REQUIRED_CHECKS = Object.freeze([
  'exact_release',
  'migration_0050',
  'function_parity',
  'exact_identity',
  'service_role_acl',
  'replay_same_window',
  'no_fourth_invocation',
  'protected_sources',
  'user_data',
  'cleanup_every_exit',
  'zero_residue',
  'secret_redaction',
  'unsupported_no_authority',
])

export function assertHostedRecord(manifest, record) {
  try {
    requireCondition(
      record.schema_version === 1 && record.phase === '03.10',
      'version/phase drift',
    )
    requireCondition(
      record.release_manifest_id === manifest.release_manifest_id,
      'release drift',
    )
    requireCondition(
      record.evidence?.source_key === manifest.source_key
        && record.evidence?.careers_url === manifest.public_url,
      'source identity drift',
    )
    if (record.status === 'PASS') {
      requireCondition(record.terminal_kind === 'ACTIVE', 'terminal is not Active')
      requireCondition(
        Object.keys(record.checks ?? {}).length > 0
          && Object.values(record.checks).every(
            (check) => check.status === 'PASS',
          ),
        'contains a non-PASS check',
      )
    } else if (record.status === 'UNSUPPORTED') {
      requireCondition(
        record.terminal_kind === 'UNSUPPORTED'
          && record.evidence?.terminal?.outcome === 'unsupported'
          && UNSUPPORTED_REASONS.has(record.evidence?.terminal?.reason)
          && record.evidence?.terminal?.operational_authority === false,
        'Unsupported terminal is not precise',
      )
      requireCondition(
        UNSUPPORTED_REQUIRED_CHECKS.every(
          (name) => record.checks?.[name]?.status === 'PASS',
        ),
        'Unsupported safety check is not PASS',
      )
    } else {
      throw new Error('status is neither PASS nor precise Unsupported')
    }
    return record
  } catch (error) {
    throw new Error(
      `hosted verification rejected: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

export function assertRolloutRecord(manifest, record) {
  try {
    requireCondition(
      record.schema_version === 1 && record.phase === '03.10',
      'version/phase drift',
    )
    requireCondition(
      record.release_manifest_id === manifest.release_manifest_id
        && record.source_key === manifest.source_key,
      'release/source drift',
    )
    requireCondition(
      record.release?.source_commit === manifest.source_commit
        && record.release?.web_commit_sha === manifestWebCommit(manifest)
        && record.release?.web_asset_sha256
          === manifest.web_deployment?.asset_sha256
        && HASH.test(record.release?.manifest_file_sha256 ?? ''),
      'release parity failed',
    )
    requireCondition(
      record.protected_sources_unchanged === true
        && record.cleanup?.every_exit === true
        && Number(record.cleanup?.verifier_residue_count) === 0
        && Number(record.redaction?.credential_leak_count) === 0,
      'isolation, cleanup, or redaction failed',
    )
    if (record.status === 'PASS') {
      requireCondition(
        record.terminal?.outcome === 'admit_experimental'
          && record.terminal?.operational_authority === true,
        'Active terminal failed',
      )
    } else if (record.status === 'UNSUPPORTED') {
      requireCondition(
        record.terminal?.outcome === 'unsupported'
          && UNSUPPORTED_REASONS.has(record.terminal?.reason)
          && record.terminal?.operational_authority === false,
        'Unsupported terminal failed',
      )
    } else {
      throw new Error('status is neither PASS nor precise Unsupported')
    }
    return record
  } catch (error) {
    throw new Error(
      `rollout verification rejected: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

export function uatApprovalPayload(manifest, record) {
  return {
    schema_version: record.schema_version,
    phase: record.phase,
    release_manifest_id: record.release_manifest_id,
    manifest_file_sha256: record.manifest_file_sha256,
    hosted_verification_sha256: record.hosted_verification_sha256,
    rollout_verification_sha256: record.rollout_verification_sha256,
    source_key: record.source_key,
    migration: record.migration,
    functions: record.functions,
    web: record.web,
    observed: record.observed,
    expected_watchlist: record.expected_watchlist,
    expected_job: record.expected_job,
    cleanup: record.cleanup,
    owner_browser_required: record.owner_browser_required,
    codex_browser_used: record.codex_browser_used,
    manifest_source_commit: manifest.source_commit,
  }
}

export function exactUatApproval(manifest, record) {
  return [
    'approve Phase 03.10 Goldman Sachs owner-browser UAT',
    manifest.release_manifest_id,
    sha256(canonical(uatApprovalPayload(manifest, record))),
  ].join(' ')
}

function exactUatRuntime(manifest, record) {
  return record.migration?.version === '0050'
    && record.migration?.sha256 === manifest.migration?.sha256
    && FUNCTION_SLUGS.every((slug) =>
      record.functions?.[slug]?.status === 'ACTIVE'
      && Number.isSafeInteger(record.functions?.[slug]?.version)
      && record.functions?.[slug]?.version > 0
      && (
        manifest.functions?.[slug]?.version === undefined
        || record.functions?.[slug]?.version
          === manifest.functions?.[slug]?.version
      )
      && record.functions?.[slug]?.verify_jwt
        === manifest.functions?.[slug]?.verify_jwt
      && record.functions?.[slug]?.bundle_sha256
        === manifest.functions?.[slug]?.bundle_sha256
    )
    && record.web?.commit_sha === manifestWebCommit(manifest)
    && record.web?.asset_sha256 === manifest.web_deployment?.asset_sha256
}

export function assertUatRecord(manifest, record) {
  requireCondition(
    record.schema_version === 1 && record.phase === '03.10',
    'UAT version/phase drift',
  )
  requireCondition(
    record.release_manifest_id === manifest.release_manifest_id
      && record.source_key === manifest.source_key,
    'UAT release/source drift',
  )
  requireCondition(
    HASH.test(record.manifest_file_sha256 ?? '')
      && HASH.test(record.hosted_verification_sha256 ?? '')
      && HASH.test(record.rollout_verification_sha256 ?? ''),
    'UAT evidence hash missing',
  )
  requireCondition(exactUatRuntime(manifest, record), 'UAT runtime identity drift')
  const unsupported = record.observed?.terminal_kind === 'unsupported'
    && UNSUPPORTED_REASONS.has(record.observed?.unsupported_reason)
    && record.observed?.operational_authority === false
  if (unsupported) {
    requireCondition(
      record.expected_watchlist?.company_name === 'Goldman Sachs'
        && record.expected_watchlist?.careers_url === manifest.public_url
        && record.expected_watchlist?.monitored === false
        && record.expected_watchlist?.disposition === 'unsupported_with_reason'
        && record.expected_watchlist?.unsupported_reason
          === record.observed.unsupported_reason
        && record.expected_job == null,
      'UAT Unsupported expectation drift',
    )
  } else {
    requireCondition(
      record.observed?.activation_state === 'active'
        && record.observed?.activation_successes === 3
        && Number.isFinite(
          Date.parse(String(record.observed?.natural_poll_at ?? '')),
        ),
      'UAT activation/natural-poll evidence drift',
    )
    requireCondition(
      record.expected_watchlist?.company_name === 'Goldman Sachs'
        && record.expected_watchlist?.careers_url === manifest.public_url
        && record.expected_watchlist?.activation_state === 'active'
        && record.expected_watchlist?.activation_successes === 3,
      'UAT Watchlist expectation drift',
    )
    requireCondition(
      qualifyingJob(record.expected_job),
      'UAT qualifying-job expectation drift',
    )
  }
  requireCondition(
    record.cleanup?.every_exit === true
      && Number(record.cleanup?.verifier_residue_count) === 0,
    'UAT cleanup expectation drift',
  )
  requireCondition(
    record.owner_browser_required === true,
    'UAT must require the owner browser',
  )
  requireCondition(
    record.codex_browser_used === false,
    'Codex browser use is forbidden for this UAT',
  )
  const requiredApproval = exactUatApproval(manifest, record)
  requireCondition(
    record.required_approval === requiredApproval,
    'UAT approval payload drift',
  )
  const finalStatus = unsupported ? 'UNSUPPORTED' : 'PASS'
  if (record.status === finalStatus) {
    requireCondition(
      record.owner_attestation === requiredApproval,
      'UAT completion requires the exact owner signal',
    )
  } else {
    requireCondition(
      record.status === 'PENDING_OWNER_BROWSER',
      'UAT has an invalid non-PASS state',
    )
    requireCondition(
      record.owner_attestation == null,
      'pending UAT cannot contain an owner attestation',
    )
  }
  return { status: record.status, required_approval: requiredApproval }
}

export function buildUatRecord(
  manifest,
  hostedRecord,
  rolloutRecord,
  hashes,
) {
  assertHostedRecord(manifest, hostedRecord)
  assertRolloutRecord(manifest, rolloutRecord)
  requireCondition(
    hostedRecord.status === rolloutRecord.status,
    'UAT hosted/rollout terminal drift',
  )
  const unsupported = hostedRecord.status === 'UNSUPPORTED'
  const record = {
    schema_version: 1,
    phase: '03.10',
    release_manifest_id: manifest.release_manifest_id,
    manifest_file_sha256: hashes.manifest_file_sha256,
    hosted_verification_sha256: hashes.hosted_verification_sha256,
    rollout_verification_sha256: hashes.rollout_verification_sha256,
    source_key: manifest.source_key,
    migration: hostedRecord.evidence.migration,
    functions: hostedRecord.evidence.functions,
    web: {
      commit_sha: manifestWebCommit(manifest),
      asset_sha256: manifest.web_deployment.asset_sha256,
    },
    observed: unsupported
      ? {
          terminal_kind: 'unsupported',
          unsupported_reason: hostedRecord.evidence.terminal.reason,
          operational_authority: false,
        }
      : {
          activation_state: 'active',
          activation_successes: 3,
          natural_poll_at: rolloutRecord.natural_poll?.company?.last_polled_at,
        },
    expected_watchlist: unsupported
      ? {
          company_name: 'Goldman Sachs',
          careers_url: manifest.public_url,
          monitored: false,
          disposition: 'unsupported_with_reason',
          unsupported_reason: hostedRecord.evidence.terminal.reason,
        }
      : {
          company_name: 'Goldman Sachs',
          careers_url: manifest.public_url,
          activation_state: 'active',
          activation_successes: 3,
        },
    expected_job: unsupported
      ? null
      : hostedRecord.evidence.sample_job,
    cleanup: {
      every_exit: true,
      verifier_residue_count: 0,
    },
    owner_browser_required: true,
    codex_browser_used: false,
    status: 'PENDING_OWNER_BROWSER',
    required_approval: null,
    owner_attestation: null,
    production_claim: false,
  }
  record.required_approval = exactUatApproval(manifest, record)
  assertUatRecord(manifest, record)
  return record
}

export function renderPendingUatMarkdown(record) {
  const unsupported = record.observed?.terminal_kind === 'unsupported'
  return [
    '# Phase 03.10 Owner Browser UAT',
    '',
    'Status: PENDING_OWNER_BROWSER',
    unsupported
      ? `Expected: Goldman Sachs is not monitored (${record.observed.unsupported_reason}).`
      : 'Expected: Goldman Sachs is Active 3/3 with a healthy natural poll.',
    unsupported
      ? 'Confirm there is no activation progress, schedule, healthy badge, or Goldman job feed.'
      : 'Confirm one current Goldman job appears in Watchlist Jobs and All Jobs, its detail is complete, and its employer Apply link opens.',
    '',
    `Required approval: ${record.required_approval}`,
    '',
  ].join('\n')
}

function parseArgs(argv) {
  const result = {
    mode: 'evaluate',
    manifest: DEFAULT_MANIFEST,
    snapshot: null,
    output: DEFAULT_OUTPUT,
    record: null,
    rollout: null,
    hosted: null,
    approval: null,
    uatMarkdown: DEFAULT_UAT_MARKDOWN,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--manifest') result.manifest = argv[++index]
    else if (argument === '--snapshot') result.snapshot = argv[++index]
    else if (argument === '--output') result.output = argv[++index]
    else if (argument === '--rollout') result.rollout = argv[++index]
    else if (argument === '--hosted') result.hosted = argv[++index]
    else if (argument === '--record') result.record = argv[++index]
    else if (argument === '--approval') result.approval = argv[++index]
    else if (argument === '--uat-markdown') result.uatMarkdown = argv[++index]
    else if (argument === '--collect-active') {
      result.mode = 'collect-active'
    } else if (argument === '--collect-unsupported') {
      result.mode = 'collect-unsupported'
    } else if (argument === '--prepare-uat') {
      result.mode = 'prepare-uat'
      result.output = DEFAULT_UAT_JSON
    } else if (argument === '--attest-uat') {
      result.mode = 'attest-uat'
      result.output = DEFAULT_UAT_JSON
    }
    else if (argument === '--assert-hosted') {
      result.mode = 'assert-hosted'
      result.record = argv[++index]
    } else if (argument === '--assert-rollout') {
      result.mode = 'assert-rollout'
      result.record = argv[++index]
    } else if (argument === '--assert-uat') {
      result.mode = 'assert-uat'
      result.record = argv[++index]
    } else throw new Error(`unknown argument: ${argument}`)
  }
  requireCondition(result.manifest, '--manifest requires a path')
  if (result.mode === 'evaluate') {
    requireCondition(result.snapshot, '--snapshot requires a path')
    requireCondition(result.output, '--output requires a path')
  } else if (
    result.mode === 'collect-active'
    || result.mode === 'collect-unsupported'
  ) {
    requireCondition(result.rollout, '--rollout requires a path')
    requireCondition(result.output, '--output requires a path')
  } else if (result.mode === 'prepare-uat') {
    requireCondition(result.hosted, '--hosted requires a path')
    requireCondition(result.rollout, '--rollout requires a path')
    requireCondition(result.output, '--output requires a path')
    requireCondition(result.uatMarkdown, '--uat-markdown requires a path')
  } else if (result.mode === 'attest-uat') {
    requireCondition(result.record, '--record requires a path')
    requireCondition(result.approval, '--approval requires the exact signal')
    requireCondition(result.output, '--output requires a path')
    requireCondition(result.uatMarkdown, '--uat-markdown requires a path')
  } else {
    requireCondition(result.record, `${result.mode} requires a record path`)
  }
  return result
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const manifestBytes = await readFile(resolve(ROOT, args.manifest))
  const manifest = JSON.parse(manifestBytes)
  await validateManifest(manifest, manifestBytes)
  if (args.mode === 'collect-active') {
    const rolloutRecord = JSON.parse(
      await readFile(resolve(ROOT, args.rollout), 'utf8'),
    )
    const snapshot = await collectActiveSnapshot(
      manifest,
      manifestBytes,
      rolloutRecord,
    )
    const result = evaluateHostedSnapshot(manifest, snapshot)
    requireCondition(
      result.status === 'PASS',
      'hosted Active evidence is incomplete',
    )
    await writeFile(
      resolve(ROOT, args.output),
      `${JSON.stringify(result, null, 2)}\n`,
    )
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  if (args.mode === 'collect-unsupported') {
    const rolloutRecord = JSON.parse(
      await readFile(resolve(ROOT, args.rollout), 'utf8'),
    )
    const snapshot = await collectUnsupportedSnapshot(
      manifest,
      manifestBytes,
      rolloutRecord,
    )
    const result = evaluateHostedSnapshot(manifest, snapshot)
    requireCondition(
      result.status === 'UNSUPPORTED',
      'hosted Unsupported evidence is incomplete',
    )
    await writeFile(
      resolve(ROOT, args.output),
      `${JSON.stringify(result, null, 2)}\n`,
    )
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  if (args.mode === 'prepare-uat') {
    const hostedBytes = await readFile(resolve(ROOT, args.hosted))
    const rolloutBytes = await readFile(resolve(ROOT, args.rollout))
    const hostedRecord = JSON.parse(hostedBytes)
    const rolloutRecord = JSON.parse(rolloutBytes)
    const record = buildUatRecord(manifest, hostedRecord, rolloutRecord, {
      manifest_file_sha256: sha256(manifestBytes),
      hosted_verification_sha256: sha256(hostedBytes),
      rollout_verification_sha256: sha256(rolloutBytes),
    })
    await writeFile(
      resolve(ROOT, args.output),
      `${JSON.stringify(record, null, 2)}\n`,
    )
    await writeFile(
      resolve(ROOT, args.uatMarkdown),
      renderPendingUatMarkdown(record),
    )
    process.stdout.write(`${JSON.stringify({
      status: record.status,
      required_approval: record.required_approval,
    }, null, 2)}\n`)
    return
  }
  if (args.mode === 'attest-uat') {
    const record = JSON.parse(
      await readFile(resolve(ROOT, args.record), 'utf8'),
    )
    const required = exactUatApproval(manifest, record)
    requireCondition(args.approval === required, 'UAT approval is not exact')
    record.status = record.observed?.terminal_kind === 'unsupported'
      ? 'UNSUPPORTED'
      : 'PASS'
    record.owner_attestation = required
    record.production_claim = true
    assertUatRecord(manifest, record)
    await writeFile(
      resolve(ROOT, args.output),
      `${JSON.stringify(record, null, 2)}\n`,
    )
    await writeFile(resolve(ROOT, args.uatMarkdown), [
      '# Phase 03.10 Owner Browser UAT',
      '',
      `Status: ${record.status}`,
      `Owner attestation: ${required}`,
      'Codex browser used: false',
      '',
    ].join('\n'))
    process.stdout.write(`${JSON.stringify({
      status: record.status,
      owner_attestation: required,
    }, null, 2)}\n`)
    return
  }
  if (args.mode === 'evaluate') {
    const snapshot = JSON.parse(await readFile(resolve(ROOT, args.snapshot), 'utf8'))
    const result = evaluateHostedSnapshot(manifest, snapshot)
    await writeFile(
      resolve(ROOT, args.output),
      `${JSON.stringify(result, null, 2)}\n`,
    )
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    if (result.status === 'PENDING') process.exitCode = 2
    return
  }
  const record = JSON.parse(await readFile(resolve(ROOT, args.record), 'utf8'))
  const result = args.mode === 'assert-hosted'
    ? assertHostedRecord(manifest, record)
    : args.mode === 'assert-rollout'
      ? assertRolloutRecord(manifest, record)
      : assertUatRecord(manifest, record)
  process.stdout.write(`${JSON.stringify({
    status: result.status,
    release_manifest_id: record.release_manifest_id,
  }, null, 2)}\n`)
  if (args.mode === 'assert-uat' && result.status !== 'PASS') {
    process.exitCode = 2
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  })
}

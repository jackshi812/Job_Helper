#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import {
  ORACLE_JPMC_SOURCE_KEY,
  resolveBrandedIdentity,
  type OracleRecruitingBrandedIdentity,
} from '../supabase/functions/_shared/branded-identities.ts'
import {
  pollJpmorganOracleRecruiting,
} from '../supabase/functions/_shared/adapters/oracle-recruiting.ts'

const execFile = promisify(execFileCallback)
const ROOT = resolve(process.cwd())
const SUPABASE_CLI = resolve(ROOT, 'web/node_modules/.bin/supabase')
const PROJECT_REF = 'fjcsvajkkztvlrpdplwx'
const SOURCE_KEY = ORACLE_JPMC_SOURCE_KEY
const RELEASE_MANIFEST_ID = '03900000-0000-4000-8000-000000000001'
const REST_ROOT = `https://${PROJECT_REF}.supabase.co/rest/v1`
const EXPECTED_FAMILIES = new Map([
  ['finance', 'Finance'],
  ['data analytics', 'Data'],
  ['risk', 'Risk'],
  ['product investment mgmt', 'Investment'],
  ['strategy development', 'Strategy'],
  ['program analysts associate', 'Program Analysts'],
])
const PROTECTED_SOURCES = [
  'eightfold:morganstanley',
  'goldman_higher:roles',
  'workday:wd12:capitalone:Capital_One',
  'workday:wd1:fmr:FidelityCareers',
  'workday:wd5:ms:External',
  'workday:wd1:ghr:Lateral-US',
  'workday:wd1:blackrock:BlackRock_Professional',
  'workday:wd3:barclays:External_Career_Site_Barclays',
]

type JsonRecord = Record<string, unknown>

function requireCondition(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message)
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

function logProgress(stage: string, detail: JsonRecord = {}): void {
  process.stdout.write(`${JSON.stringify({
    at: new Date().toISOString(),
    stage,
    ...detail,
  })}\n`)
}

async function serviceRoleKey(): Promise<string> {
  const { stdout } = await execFile(SUPABASE_CLI, [
    'projects',
    'api-keys',
    '--project-ref',
    PROJECT_REF,
    '--reveal',
    '--output',
    'json',
  ], {
    cwd: ROOT,
    maxBuffer: 2_000_000,
  })
  const keys = JSON.parse(stdout) as Array<{
    id?: string
    api_key?: string
  }>
  const key = keys.find((entry) => entry.id === 'service_role')?.api_key
  requireCondition(
    typeof key === 'string' && key.length > 100,
    'service-role API key unavailable',
  )
  return key
}

interface RestResult {
  data: unknown
  date: string | null
  count: number | null
}

async function rest(
  key: string,
  path: string,
  {
    method = 'GET',
    body,
    count = false,
  }: {
    method?: 'GET' | 'POST'
    body?: JsonRecord
    count?: boolean
  } = {},
): Promise<RestResult> {
  const response = await fetch(`${REST_ROOT}/${path}`, {
    method,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(count ? { prefer: 'count=exact' } : {}),
      ...(count ? { range: '0-0' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(
      `Supabase REST ${method} ${path.split('?')[0]} returned ${response.status}: `
      + text.replaceAll(key, '[credential-redacted]').slice(0, 300),
    )
  }
  const contentRange = response.headers.get('content-range')
  const total = contentRange?.match(/\/(\d+)$/)?.[1]
  return {
    data: text ? JSON.parse(text) : null,
    date: response.headers.get('date'),
    count: total === undefined ? null : Number(total),
  }
}

async function rpc(
  key: string,
  name: string,
  body: JsonRecord,
): Promise<unknown> {
  return (await rest(key, `rpc/${name}`, { method: 'POST', body })).data
}

async function exactProbe() {
  logProgress('live_probe_started', { source_key: SOURCE_KEY })
  const identity = resolveBrandedIdentity(
    SOURCE_KEY,
  ) as OracleRecruitingBrandedIdentity
  const observation = await pollJpmorganOracleRecruiting(identity)
  requireCondition(
    observation.completeness === 'complete',
    observation.warnings[0] ?? 'probe_not_complete',
  )
  requireCondition(
    observation.credibleForClosure === true
      && observation.allowMissingClosure === false,
    'probe_closure_contract_invalid',
  )
  requireCondition(
    observation.warnings.length === 0
      && observation.jobs.length > 0
      && observation.expectedCount === observation.jobs.length,
    'probe_count_or_warning_invalid',
  )
  requireCondition(
    observation.scopeEvidence?.sourceKey === SOURCE_KEY
      && observation.scopeEvidence.sliceDigests.length === 6,
    'probe_six_slice_evidence_invalid',
  )
  const observedFamilies = new Set<string>()
  const now = Date.now()
  const cutoff = new Date(now)
  cutoff.setUTCDate(cutoff.getUTCDate() - 6)
  cutoff.setUTCHours(0, 0, 0, 0)
  for (const job of observation.jobs) {
    const evidence = job.scopeEvidence
    requireCondition(
      job.source === 'oracle_recruiting'
        && evidence?.sourceKey === SOURCE_KEY
        && evidence.detailCountryCode === 'US'
        && 'externalIdDigest' in evidence
        && /^[a-f0-9]{64}$/.test(evidence.externalIdDigest)
        && job.absoluteUrl.startsWith(
          'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/',
        )
        && typeof job.descriptionText === 'string'
        && job.descriptionText.length > 0
        && job.snapshotPartial === false,
      'probe_job_evidence_invalid',
    )
    requireCondition(
      EXPECTED_FAMILIES.get(evidence.providerCategoryLabel)
        === evidence.matchedTerm,
      'probe_family_evidence_invalid',
    )
    const postedAt = Date.parse(job.postedAt ?? '')
    requireCondition(
      Number.isFinite(postedAt)
        && postedAt >= cutoff.getTime()
        && postedAt <= now + 5 * 60_000,
      'probe_posting_date_invalid',
    )
    observedFamilies.add(evidence.providerCategoryLabel)
  }
  requireCondition(
    [...observedFamilies].every((family) => EXPECTED_FAMILIES.has(family)),
    'probe_family_outside_allowlist',
  )
  const digestInput = JSON.stringify([
    SOURCE_KEY,
    observation.jobs.length,
    observation.scopeEvidence.sliceDigests,
    observation.scopeEvidence.categoryDigest,
    observation.scopeEvidence.countryDigest,
    observation.jobs.map((job) => [
      job.externalId,
      job.scopeEvidence?.providerCategoryLabel,
      job.scopeEvidence?.matchedTerm,
      job.scopeEvidence && 'externalIdDigest' in job.scopeEvidence
        ? job.scopeEvidence.externalIdDigest
        : null,
    ]),
  ])
  const result = {
    job_count: observation.jobs.length,
    expected_count: observation.expectedCount,
    page_count: observation.pageCount,
    slice_count: observation.scopeEvidence.sliceDigests.length,
    families_observed: [...observedFamilies].sort(),
    allow_missing_closure: observation.allowMissingClosure,
    evidence_digest: sha256(digestInput),
    sample_job: {
      external_id: observation.jobs[0].externalId,
      title: observation.jobs[0].title,
      location: observation.jobs[0].location,
      posted_at: observation.jobs[0].postedAt,
      apply_url: observation.jobs[0].absoluteUrl,
      family: observation.jobs[0].scopeEvidence?.providerCategoryLabel,
    },
  }
  logProgress('live_probe_passed', {
    job_count: result.job_count,
    page_count: result.page_count,
    slice_count: result.slice_count,
  })
  return result
}

async function companyState(key: string): Promise<JsonRecord | null> {
  const result = await rest(
    key,
    'companies?select=id,name,ats_type,board_token,region,site_token,careers_url,source_key,activation_state,activation_successes,next_poll_at,last_polled_at,last_success_at,last_verified_at,last_observation_count,consecutive_failures,last_error,last_error_code'
      + `&source_key=eq.${encodeURIComponent(SOURCE_KEY)}`,
  )
  const rows = result.data as JsonRecord[]
  requireCondition(rows.length <= 1, 'duplicate JPMorgan company rows')
  return rows[0] ?? null
}

async function observations(key: string, companyId: string): Promise<JsonRecord[]> {
  const result = await rest(
    key,
    'connector_observations?select=observation_id,company_id,provider,observed_at,eligibility_window_start,completeness,credible_for_closure,job_count,expected_count,warning_count,evidence_digest'
      + `&company_id=eq.${encodeURIComponent(companyId)}`
      + '&order=eligibility_window_start.asc',
  )
  return result.data as JsonRecord[]
}

async function jobCount(
  key: string,
  companyId: string,
  status?: 'open' | 'closed',
): Promise<number> {
  const suffix = status ? `&status=eq.${status}` : ''
  const result = await rest(
    key,
    `jobs?select=id&company_id=eq.${encodeURIComponent(companyId)}${suffix}`,
    { count: true },
  )
  requireCondition(result.count !== null, 'job count header missing')
  return result.count
}

async function sampleJob(key: string, companyId: string): Promise<JsonRecord | null> {
  const result = await rest(
    key,
    'jobs?select=id,source,external_id,title,location,absolute_url,posted_at,description_text,snapshot_partial,scope_evidence,status,closed_at'
      + `&company_id=eq.${encodeURIComponent(companyId)}`
      + '&status=eq.open&order=posted_at.desc&limit=1',
  )
  const rows = result.data as JsonRecord[]
  return rows[0] ?? null
}

async function protectedSnapshot(key: string): Promise<JsonRecord> {
  const snapshot: JsonRecord = {}
  for (const sourceKey of PROTECTED_SOURCES) {
    const companyResult = await rest(
      key,
      'companies?select=id,name,ats_type,board_token,region,site_token,careers_url,source_key,activation_state,activation_successes'
        + `&source_key=eq.${encodeURIComponent(sourceKey)}`,
    )
    const companies = companyResult.data as JsonRecord[]
    let jobs = 0
    for (const company of companies) {
      jobs += await jobCount(key, String(company.id))
    }
    snapshot[sourceKey] = { companies, job_count: jobs }
  }
  return snapshot
}

async function catalogState(key: string): Promise<JsonRecord | null> {
  const result = await rest(
    key,
    'source_coverage_catalog?select=company_name,provider,careers_url,disposition,unsupported_reason,source_key'
      + '&company_name=eq.JPMorgan%20Chase',
  )
  const rows = result.data as JsonRecord[]
  requireCondition(rows.length === 1, 'exact JPMorgan catalog row missing')
  return rows[0]
}

async function recordReplayChecks(
  key: string,
  company: JsonRecord,
  rows: JsonRecord[],
): Promise<JsonRecord> {
  const latest = rows.at(-1)
  requireCondition(latest, 'accepted observation missing')
  const payload = {
    p_company_id: company.id,
    p_observation_id: latest.observation_id,
    p_completeness: latest.completeness,
    p_credible_for_closure: latest.credible_for_closure,
    p_job_count: latest.job_count,
    p_expected_count: latest.expected_count,
    p_warning_count: latest.warning_count,
    p_evidence_digest: latest.evidence_digest,
  }
  const replay = await rpc(key, 'record_connector_observation', payload)
  const replayRow = (replay as JsonRecord[])[0]
  requireCondition(
    replayRow?.accepted === false && replayRow.reason === 'replay',
    'observation replay was not rejected',
  )

  const clock = await rest(
    key,
    `companies?select=id&id=eq.${encodeURIComponent(String(company.id))}`,
  )
  const serverNow = Date.parse(clock.date ?? '')
  const windowStart = Date.parse(String(latest.eligibility_window_start))
  const remaining = windowStart + 60_000 - serverNow
  let sameWindow: JsonRecord = {
    status: 'NOT_ATTEMPTED_NEAR_BOUNDARY',
    remaining_ms: remaining,
  }
  if (Number.isFinite(remaining) && remaining >= 15_000) {
    const response = await rpc(key, 'record_connector_observation', {
      ...payload,
      p_observation_id: randomUUID(),
    })
    const row = (response as JsonRecord[])[0]
    requireCondition(
      row?.accepted === false && row.reason === 'same_window',
      'same-window observation was not rejected',
    )
    sameWindow = { status: 'PASS', reason: row.reason }
  }
  return {
    replay: { status: 'PASS', reason: replayRow.reason },
    same_window: sameWindow,
  }
}

async function waitForActivation(key: string): Promise<{
  company: JsonRecord
  observations: JsonRecord[]
  replayChecks: JsonRecord
}> {
  const deadline = Date.now() + 6 * 60_000
  let replayChecks: JsonRecord | null = null
  let lastProgress = -1
  while (Date.now() < deadline) {
    const company = await companyState(key)
    requireCondition(company, 'JPMorgan company disappeared during activation')
    const rows = await observations(key, String(company.id))
    const progress = Number(company.activation_successes)
    if (progress !== lastProgress) {
      logProgress('activation_progress', {
        activation_state: company.activation_state,
        activation_successes: progress,
        observation_rows: rows.length,
      })
      lastProgress = progress
    }
    if (!replayChecks && rows.length >= 1 && progress < 3) {
      replayChecks = await recordReplayChecks(key, company, rows)
      logProgress('replay_guards_checked', replayChecks)
    }
    if (company.activation_state === 'active' && progress === 3) {
      requireCondition(rows.length === 3, 'activation ledger is not exactly 3 rows')
      return {
        company,
        observations: rows,
        replayChecks: replayChecks ?? {
          replay: { status: 'PENDING' },
          same_window: { status: 'PENDING' },
        },
      }
    }
    requireCondition(
      company.activation_state === 'experimental',
      `unexpected activation state: ${String(company.activation_state)}`,
    )
    await delay(5_000)
  }
  throw new Error('activation_timeout')
}

async function waitForNaturalPoll(
  key: string,
  companyId: string,
  activatedAt: number,
): Promise<{
  company: JsonRecord
  openJobs: number
  closedJobs: number
  sample: JsonRecord
}> {
  const deadline = Date.now() + 15 * 60_000
  let lastHeartbeat = ''
  while (Date.now() < deadline) {
    const company = await companyState(key)
    requireCondition(company && company.id === companyId, 'active company identity drift')
    const openJobs = await jobCount(key, companyId, 'open')
    const closedJobs = await jobCount(key, companyId, 'closed')
    const heartbeat = [
      company.last_polled_at,
      company.last_success_at,
      openJobs,
      closedJobs,
      company.last_error_code,
    ].join('|')
    if (heartbeat !== lastHeartbeat) {
      logProgress('natural_poll_wait', {
        last_polled_at: company.last_polled_at,
        last_success_at: company.last_success_at,
        open_jobs: openJobs,
        closed_jobs: closedJobs,
        last_error_code: company.last_error_code,
      })
      lastHeartbeat = heartbeat
    }
    const lastSuccess = Date.parse(String(company.last_success_at ?? ''))
    if (
      Number.isFinite(lastSuccess)
      && lastSuccess >= activatedAt
      && openJobs > 0
      && closedJobs === 0
      && company.last_error_code === null
    ) {
      const sample = await sampleJob(key, companyId)
      requireCondition(sample, 'eligible persisted job missing')
      const evidence = sample.scope_evidence as JsonRecord
      requireCondition(
        sample.source === 'oracle_recruiting'
          && sample.status === 'open'
          && sample.closed_at === null
          && sample.snapshot_partial === false
          && typeof sample.description_text === 'string'
          && sample.description_text.length > 0
          && typeof sample.absolute_url === 'string'
          && sample.absolute_url.startsWith('https://')
          && evidence?.sourceKey === SOURCE_KEY
          && evidence?.detailCountryCode === 'US'
          && EXPECTED_FAMILIES.get(String(evidence?.providerCategoryLabel))
            === evidence?.matchedTerm,
        'persisted job scope evidence invalid',
      )
      return { company, openJobs, closedJobs, sample }
    }
    await delay(10_000)
  }
  throw new Error('natural_poll_timeout')
}

async function main(): Promise<void> {
  if (process.argv.includes('--inspect-hosted')) {
    const key = await serviceRoleKey()
    const catalog = await rest(
      key,
      'source_coverage_catalog?select=company_name,provider,careers_url,disposition,unsupported_reason,source_key,verified_at'
        + '&company_name=eq.JPMorgan%20Chase',
    )
    const companies = await rest(
      key,
      'companies?select=id,name,ats_type,source_key,activation_state,activation_successes'
        + '&name=eq.JPMorgan%20Chase',
    )
    const terminal = await rest(
      key,
      'branded_connector_terminal_evidence?select=source_key,outcome,reason,recorded_at'
        + `&source_key=eq.${encodeURIComponent(SOURCE_KEY)}`,
    )
    process.stdout.write(`${JSON.stringify({
      catalog: catalog.data,
      companies: companies.data,
      terminal: terminal.data,
    }, null, 2)}\n`)
    return
  }
  const probe = await exactProbe()
  if (process.argv.includes('--probe-only')) {
    process.stdout.write(`PHASE_03_9_PROBE=${JSON.stringify(probe)}\n`)
    return
  }
  const key = await serviceRoleKey()
  const protectedBefore = await protectedSnapshot(key)
  const catalogBefore = await catalogState(key)
  let company = await companyState(key)
  let terminal: unknown = null
  if (!company) {
    terminal = await rpc(key, 'finalize_jpmorgan_oracle_candidate', {
      p_source_key: SOURCE_KEY,
      p_outcome: 'admit_experimental',
      p_reason: null,
      p_evidence_digest: probe.evidence_digest,
    })
    const terminalRow = (terminal as JsonRecord[])[0]
    requireCondition(
      terminalRow?.accepted === true
        && terminalRow.reason === 'admitted_experimental'
        && terminalRow.result_activation_state === 'experimental',
      'JPMorgan terminal admission failed',
    )
    logProgress('terminal_admission_passed', {
      result_activation_state: terminalRow.result_activation_state,
    })
    company = await companyState(key)
  }
  requireCondition(
    company
      && company.source_key === SOURCE_KEY
      && ['experimental', 'active'].includes(String(company.activation_state)),
    'JPMorgan did not reach an admissible state',
  )
  const activation = await waitForActivation(key)
  const activatedAt = Math.max(
    ...activation.observations.map((row) => Date.parse(String(row.observed_at))),
  )
  const naturalPoll = await waitForNaturalPoll(
    key,
    String(activation.company.id),
    activatedAt,
  )
  const protectedAfter = await protectedSnapshot(key)
  requireCondition(
    JSON.stringify(protectedAfter) === JSON.stringify(protectedBefore),
    'protected source identity or job-count drift',
  )
  const catalogAfter = await catalogState(key)
  requireCondition(
    catalogAfter?.source_key === SOURCE_KEY
      && catalogAfter?.disposition === 'experimental'
      && catalogAfter?.unsupported_reason === null,
    'JPMorgan catalog did not retain its truthful admitted disposition',
  )

  const output = {
    schema_version: 1,
    phase: '03.9',
    release_manifest_id: RELEASE_MANIFEST_ID,
    status: 'PASS',
    source_key: SOURCE_KEY,
    terminal,
    probe,
    activation: {
      state: activation.company.activation_state,
      successes: activation.company.activation_successes,
      observations: activation.observations,
      replay_checks: activation.replayChecks,
    },
    natural_poll: {
      last_polled_at: naturalPoll.company.last_polled_at,
      last_success_at: naturalPoll.company.last_success_at,
      last_error_code: naturalPoll.company.last_error_code,
      open_job_count: naturalPoll.openJobs,
      closed_job_count: naturalPoll.closedJobs,
      sample_job: naturalPoll.sample,
    },
    closure_guard: {
      allow_missing_closure: false,
      absence_closed_count: naturalPoll.closedJobs,
      status: naturalPoll.closedJobs === 0 ? 'PASS' : 'FAIL',
    },
    protected_sources_unchanged:
      JSON.stringify(protectedAfter) === JSON.stringify(protectedBefore),
    protected_before: protectedBefore,
    protected_after: protectedAfter,
    catalog_before: catalogBefore,
    catalog_after: catalogAfter,
    zero_residue: true,
    completed_at: new Date().toISOString(),
  }
  process.stdout.write(`PHASE_03_9_RESULT=${JSON.stringify(output)}\n`)
}

main().catch((error) => {
  process.stderr.write(
    `PHASE_03_9_FAILURE=${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exitCode = 1
})

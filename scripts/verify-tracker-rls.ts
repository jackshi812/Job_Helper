#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import process from 'node:process'

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type JsonRecord = { [key: string]: Json }
type Session = { userId: string; accessToken: string }

const USAGE =
  'Usage: verify-tracker-rls.ts --mode contract|hosted ' +
  '[--preflight <path> --catalog-evidence <path> --evidence <path>]'
const SHA256 = /^[a-f0-9]{64}$/
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const FIXTURE_MANIFEST = Object.freeze({
  namespace: 'phase-04-tracker-0053-proof-v1',
  auth_users: Object.freeze([
    Object.freeze({
      id: '04020000-0000-4000-8000-000000000001',
      email: 'phase-04-tracker-a@example.invalid',
      external_id: 'phase-04-tracker-user-a',
    }),
    Object.freeze({
      id: '04020000-0000-4000-8000-000000000002',
      email: 'phase-04-tracker-b@example.invalid',
      external_id: 'phase-04-tracker-user-b',
    }),
  ]),
  companies: Object.freeze([
    Object.freeze({
      id: '04020000-0000-4000-8000-000000000010',
      name: 'Phase 04 Tracker Fixture Company',
      board_token: 'phase-04-tracker-0053-proof-v1',
      careers_url:
        'https://job-boards.greenhouse.io/phase-04-tracker-0053-proof-v1',
      source_key:
        'greenhouse:global:phase-04-tracker-0053-proof-v1',
    }),
  ]),
  jobs: Object.freeze([
    Object.freeze({
      id: '04020000-0000-4000-8000-000000000020',
      external_id: 'phase-04-tracker-0053-job',
      fingerprint:
        'fd330e93bd57729fbd5c07a3d0ec8400f32b54ae7b8636bdb383af652b132b55',
    }),
  ]),
  user_jobs: Object.freeze([
    Object.freeze({
      id: '04020000-0000-4000-8000-000000000030',
      owner: 'a',
    }),
    Object.freeze({
      id: '04020000-0000-4000-8000-000000000031',
      owner: 'b',
    }),
  ]),
  resumes: Object.freeze([
    Object.freeze({
      id: '04020000-0000-4000-8000-000000000040',
      owner: 'a',
      storage_path: 'phase-04-tracker-0053-proof-v1/a.pdf',
    }),
    Object.freeze({
      id: '04020000-0000-4000-8000-000000000041',
      owner: 'b',
      storage_path: 'phase-04-tracker-0053-proof-v1/b.pdf',
    }),
  ]),
})
const EXPECTED_COUNTS = Object.freeze({
  auth_users: 2,
  companies: 1,
  jobs: 1,
  user_jobs_seeded: 2,
  resumes_seeded: 2,
  applications: 4,
  application_stage_events: 5,
  source_rows_removed_during_proof: 1,
  cleanup_relations: 7,
})
const LINEAGE_RULES = Object.freeze([
  'runtime application IDs enter the memory-only lineage allowlist only after exact owner, origin/source parent or manual namespace, and exact expected count verification',
  'runtime event IDs enter the memory-only lineage allowlist only through an approved application plus exact owner, parent, fixture namespace, and exact expected count verification',
  'every privileged removal requires exact owner, verified parent, fixture namespace, memory-only lineage membership, and exact expected count',
])
const ZERO_RESIDUE_RELATIONS = Object.freeze([
  'public.application_stage_events',
  'public.applications',
  'public.user_jobs',
  'public.resumes',
  'public.jobs',
  'public.companies',
  'auth.users',
])
const DIAGNOSTIC_STEPS = Object.freeze([
  'auth.preflight.a',
  'auth.preflight.b',
  'auth.create.a',
  'auth.create.b',
  'auth.signin.a',
  'auth.signin.b',
  'fixture.collision.companies',
  'fixture.collision.jobs',
  'fixture.collision.user_jobs',
  'fixture.collision.resumes',
  'fixture.seed.companies',
  'fixture.seed.jobs',
  'fixture.seed.user_jobs',
  'fixture.seed.resumes',
  'behavior.mark.a.first',
  'behavior.mark.a.repeat',
  'behavior.mark.b.first',
  'behavior.manual.a.first',
  'behavior.manual.a.duplicate',
  'lineage.application.system_a',
  'lineage.application.system_b',
  'lineage.application.manual_first',
  'lineage.application.manual_duplicate',
  'isolation.read.b_to_a',
  'isolation.read.a_to_b',
  'isolation.pin.b_to_a',
  'isolation.resume.b_to_a',
  'behavior.resume.link.a',
  'behavior.resume.delete.a',
  'behavior.resume.verify.a',
  'behavior.dashboard.before',
  'behavior.event.repeat.a',
  'behavior.dashboard.after',
  'lineage.events.all',
  'behavior.event.final_reject.b',
  'behavior.source.remove.a',
  'behavior.snapshot.verify.a',
  'cleanup.recover.applications.exact',
  'cleanup.recover.applications.fallback',
  'cleanup.recover.events',
  'cleanup.events.delete',
  'cleanup.applications.delete',
  'cleanup.user_jobs.read',
  'cleanup.user_jobs.delete',
  'cleanup.resumes.read',
  'cleanup.resumes.delete',
  'cleanup.jobs.read',
  'cleanup.jobs.delete',
  'cleanup.companies.read',
  'cleanup.companies.delete',
  'cleanup.auth.delete.a',
  'cleanup.auth.delete.b',
  'residue.events',
  'residue.applications',
  'residue.user_jobs',
  'residue.resumes',
  'residue.jobs',
  'residue.companies',
  'residue.auth.a',
  'residue.auth.b',
] as const)
const DIAGNOSTIC_STATUSES = Object.freeze(['start', 'pass', 'fail'] as const)
const DIAGNOSTIC_OUTPUT_FIELDS = Object.freeze([
  'step',
  'status',
  'elapsed_ms',
] as const)
type DiagnosticStep = (typeof DIAGNOSTIC_STEPS)[number]
type DiagnosticStatus = (typeof DIAGNOSTIC_STATUSES)[number]
const DIAGNOSTIC_STEP_SET = new Set<string>(DIAGNOSTIC_STEPS)

function fail(message: string): never {
  throw new Error(message)
}

function requireCondition(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) fail(message)
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt))
}

function writeDiagnostic(
  step: DiagnosticStep,
  status: DiagnosticStatus,
  startedAt: number,
): void {
  requireCondition(
    DIAGNOSTIC_STEP_SET.has(step),
    'diagnostic step is outside the static allowlist',
  )
  process.stderr.write(
    `[tracker-step] ${JSON.stringify({
      step,
      status,
      elapsed_ms: elapsedMs(startedAt),
    })}\n`,
  )
}

const FIXTURE_MANIFEST_SHA256 = sha256(
  canonical(FIXTURE_MANIFEST as unknown as Json),
)

function contractDocument(): JsonRecord {
  return {
    status: 'PASS',
    fixture_manifest: FIXTURE_MANIFEST as unknown as Json,
    fixture_manifest_sha256: FIXTURE_MANIFEST_SHA256,
    expected_counts: EXPECTED_COUNTS as unknown as Json,
    lineage_rules: LINEAGE_RULES as unknown as Json,
    zero_residue_relations: ZERO_RESIDUE_RELATIONS as unknown as Json,
    diagnostics: {
      steps: DIAGNOSTIC_STEPS as unknown as Json,
      output_fields: DIAGNOSTIC_OUTPUT_FIELDS as unknown as Json,
      statuses: DIAGNOSTIC_STATUSES as unknown as Json,
    },
  }
}

function parseArgs(argv: string[]) {
  const allowed = new Set([
    '--mode',
    '--preflight',
    '--catalog-evidence',
    '--evidence',
  ])
  const parsed = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!flag || !allowed.has(flag)) fail(`unknown argument: ${flag ?? '<empty>'}`)
    if (!value || value.startsWith('--')) fail(`missing value for ${flag}`)
    if (parsed.has(flag)) fail(`duplicate argument: ${flag}`)
    parsed.set(flag, value)
  }
  const mode = parsed.get('--mode')
  if (mode !== 'contract' && mode !== 'hosted') fail(USAGE)
  const exact =
    mode === 'contract'
      ? new Set(['--mode'])
      : new Set(['--mode', '--preflight', '--catalog-evidence', '--evidence'])
  for (const flag of parsed.keys()) {
    if (!exact.has(flag)) fail(`flag ${flag} is invalid for mode ${mode}`)
  }
  for (const flag of exact) {
    if (!parsed.has(flag)) fail(`required flag missing: ${flag}`)
  }
  return {
    mode,
    preflight: parsed.get('--preflight'),
    catalogEvidence: parsed.get('--catalog-evidence'),
    evidence: parsed.get('--evidence'),
  }
}

async function repositoryRoot(start = process.cwd()): Promise<string> {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: start,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
  if (!root) fail('repository root is unavailable')
  return realpath(root)
}

function checkedPath(root: string, value: string): string {
  const path = resolve(root, value)
  const rel = relative(root, path)
  if (rel.startsWith('..')) fail(`path is outside repository: ${value}`)
  return path
}

async function fileSha(path: string): Promise<string> {
  return sha256(await readFile(path))
}

function assertHash(value: Json, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    fail(`${label} is not a SHA-256 digest`)
  }
  return value
}

function stringField(record: JsonRecord, field: string): string {
  const value = record[field]
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${field} is missing or malformed`)
  }
  return value
}

function integerField(record: JsonRecord, field: string): number {
  const value = record[field]
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    fail(`${field} is missing or malformed`)
  }
  return Number(value)
}

function preflightJson(markdown: string): JsonRecord {
  const match = markdown.match(
    /<!-- tracker-preflight-json\n([\s\S]*?)\ntracker-preflight-json -->/,
  )
  if (!match) fail('preflight machine contract is missing')
  const parsed = JSON.parse(match[1]) as Json
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('preflight machine contract is malformed')
  }
  return parsed as JsonRecord
}

function recursiveRedact(value: unknown, secrets: string[]): unknown {
  if (typeof value === 'string') {
    let result = value
    for (const secret of secrets.filter(Boolean)) {
      result = result.split(secret).join('[REDACTED]')
    }
    return result
      .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
      .replace(/eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[REDACTED]')
  }
  if (Array.isArray(value)) {
    return value.map((item) => recursiveRedact(item, secrets))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /(?:key|token|password|authorization|content|notes|description)/i.test(key)
          ? '[REDACTED]'
          : recursiveRedact(item, secrets),
      ]),
    )
  }
  return value
}

function sanitizedError(error: unknown, secrets: string[]): Error {
  const rendered =
    error instanceof Error
      ? { name: error.name, message: error.message, cause: error.cause }
      : error
  return new Error(JSON.stringify(recursiveRedact(rendered, secrets)))
}

function safeRemoteErrorCode(payload: Json): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }
  const code = (payload as JsonRecord).code
  return typeof code === 'string' && /^[A-Z0-9_]{3,32}$/.test(code)
    ? code
    : null
}

function command(
  executable: string,
  args: string[],
  cwd: string,
  environment = process.env,
): string {
  return execFileSync(executable, args, {
    cwd,
    encoding: 'utf8',
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 8 * 1024 * 1024,
  }).trim()
}

function discoverServiceRoleKey(root: string, projectRef: string): string {
  requireCondition(
    process.env.SUPABASE_ACCESS_TOKEN?.trim(),
    'SUPABASE_ACCESS_TOKEN is required',
  )
  const cli = resolve(root, 'web/node_modules/.bin/supabase')
  const output = command(
    cli,
    [
      'projects',
      'api-keys',
      '--project-ref',
      projectRef,
      '--reveal',
      '--output',
      'json',
    ],
    root,
  )
  const parsed = JSON.parse(output) as Json
  requireCondition(Array.isArray(parsed), 'api-key inventory is malformed')
  const service = parsed.find(
    (entry) =>
      entry &&
      typeof entry === 'object' &&
      !Array.isArray(entry) &&
      ['service_role', 'secret'].includes(
        String(
          (entry as JsonRecord).name ??
            (entry as JsonRecord).type ??
            (entry as JsonRecord).role,
        ),
      ),
  ) as JsonRecord | undefined
  requireCondition(service, 'service_role key is absent')
  const key = [service.api_key, service.key, service.value]
    .find((value) => typeof value === 'string') as string | undefined
  requireCondition(key && key.length >= 32, 'service_role key is malformed')
  return key
}

async function httpJson(
  step: DiagnosticStep,
  url: string,
  init: RequestInit,
  expected: number[],
  secrets: string[],
): Promise<{ payload: Json; headers: Headers; status: number }> {
  const startedAt = performance.now()
  writeDiagnostic(step, 'start', startedAt)
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(30_000),
    })
    const text = await response.text()
    let payload: Json = null
    if (text) {
      try {
        payload = JSON.parse(text) as Json
      } catch {
        payload = null
      }
    }
    if (!expected.includes(response.status)) {
      const remoteCode = safeRemoteErrorCode(payload)
      throw new Error(
        `HTTP ${response.status}${remoteCode ? ` code ${remoteCode}` : ''}`,
      )
    }
    writeDiagnostic(step, 'pass', startedAt)
    return { payload, headers: response.headers, status: response.status }
  } catch (error) {
    writeDiagnostic(step, 'fail', startedAt)
    const reason =
      error instanceof Error &&
      /^HTTP \d{3}(?: code [A-Z0-9_]{3,32})?$/.test(error.message)
        ? error.message
        : error instanceof Error
          ? error.name
          : 'Error'
    throw new Error(
      `step ${step} failed after ${elapsedMs(startedAt)}ms (${reason})`,
    )
  }
}

function serviceHeaders(serviceKey: string, extra: HeadersInit = {}): HeadersInit {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    ...extra,
  }
}

function ordinaryHeaders(
  publishableKey: string,
  session: Session,
  extra: HeadersInit = {},
): HeadersInit {
  return {
    apikey: publishableKey,
    Authorization: `Bearer ${session.accessToken}`,
    'Content-Type': 'application/json',
    ...extra,
  }
}

async function postgrest(
  step: DiagnosticStep,
  apiUrl: string,
  publishableKey: string,
  session: Session | null,
  serviceKey: string | null,
  path: string,
  init: RequestInit,
  expected: number[],
  secrets: string[],
) {
  const headers = serviceKey
    ? serviceHeaders(serviceKey, init.headers)
    : ordinaryHeaders(publishableKey, session!, init.headers)
  return httpJson(
    step,
    `${apiUrl}/rest/v1/${path}`,
    { ...init, headers },
    expected,
    secrets,
  )
}

async function rpc(
  step: DiagnosticStep,
  apiUrl: string,
  publishableKey: string,
  session: Session,
  name: string,
  body: JsonRecord,
  expected: number[],
  secrets: string[],
) {
  return postgrest(
    step,
    apiUrl,
    publishableKey,
    session,
    null,
    `rpc/${name}`,
    { method: 'POST', body: JSON.stringify(body) },
    expected,
    secrets,
  )
}

async function createExactUser(
  step: DiagnosticStep,
  apiUrl: string,
  serviceKey: string,
  user: (typeof FIXTURE_MANIFEST.auth_users)[number],
  password: string,
  secrets: string[],
): Promise<void> {
  const result = await httpJson(
    step,
    `${apiUrl}/auth/v1/admin/users`,
    {
      method: 'POST',
      headers: serviceHeaders(serviceKey),
      body: JSON.stringify({
        id: user.id,
        email: user.email,
        password,
        email_confirm: true,
        user_metadata: {
          fixture_namespace: FIXTURE_MANIFEST.namespace,
          external_id: user.external_id,
        },
      }),
    },
    [200, 201],
    secrets,
  )
  requireCondition(
    result.payload &&
      typeof result.payload === 'object' &&
      !Array.isArray(result.payload) &&
      (result.payload as JsonRecord).id === user.id,
    'auth provider did not preserve the manifest user ID',
  )
}

async function deleteExactUser(
  step: DiagnosticStep,
  apiUrl: string,
  serviceKey: string,
  userId: string,
  secrets: string[],
): Promise<void> {
  await httpJson(
    step,
    `${apiUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
    { method: 'DELETE', headers: serviceHeaders(serviceKey) },
    [200, 204],
    secrets,
  )
}

async function signInWithPassword(
  step: DiagnosticStep,
  apiUrl: string,
  publishableKey: string,
  email: string,
  password: string,
  secrets: string[],
): Promise<Session> {
  const result = await httpJson(
    step,
    `${apiUrl}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: {
        apikey: publishableKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    },
    [200],
    secrets,
  )
  requireCondition(
    result.payload &&
      typeof result.payload === 'object' &&
      !Array.isArray(result.payload),
    'ordinary sign-in response is malformed',
  )
  const accessToken = (result.payload as JsonRecord).access_token
  const user = (result.payload as JsonRecord).user as JsonRecord | undefined
  requireCondition(
    typeof accessToken === 'string' && accessToken.length >= 32,
    'ordinary session token is malformed',
  )
  requireCondition(user && typeof user.id === 'string', 'ordinary user is malformed')
  secrets.push(accessToken)
  return { userId: user.id, accessToken }
}

async function expectRows(
  result: Awaited<ReturnType<typeof postgrest>>,
  expected: number,
  label: string,
): Promise<JsonRecord[]> {
  requireCondition(Array.isArray(result.payload), `${label} payload is malformed`)
  requireCondition(
    result.payload.length === expected,
    `${label} expected exact count ${expected}, received ${result.payload.length}`,
  )
  return result.payload as JsonRecord[]
}

async function selectExact(
  step: DiagnosticStep,
  apiUrl: string,
  publishableKey: string,
  session: Session | null,
  serviceKey: string | null,
  relation: string,
  query: string,
  expected: number,
  secrets: string[],
): Promise<JsonRecord[]> {
  return expectRows(
    await postgrest(
      step,
      apiUrl,
      publishableKey,
      session,
      serviceKey,
      `${relation}?${query}`,
      { method: 'GET' },
      [200],
      secrets,
    ),
    expected,
    `${relation} select`,
  )
}

async function mutateExact(
  step: DiagnosticStep,
  apiUrl: string,
  publishableKey: string,
  session: Session | null,
  serviceKey: string | null,
  relation: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  query: string,
  body: Json | undefined,
  expected: number,
  secrets: string[],
): Promise<JsonRecord[]> {
  return expectRows(
    await postgrest(
      step,
      apiUrl,
      publishableKey,
      session,
      serviceKey,
      `${relation}${query ? `?${query}` : ''}`,
      {
        method,
        headers: { Prefer: 'return=representation' },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      [200, 201],
      secrets,
    ),
    expected,
    `${relation} ${method}`,
  )
}

async function seedDirectFixtures(
  apiUrl: string,
  publishableKey: string,
  serviceKey: string,
  secrets: string[],
): Promise<void> {
  const userA = FIXTURE_MANIFEST.auth_users[0]
  const userB = FIXTURE_MANIFEST.auth_users[1]
  const company = FIXTURE_MANIFEST.companies[0]
  const job = FIXTURE_MANIFEST.jobs[0]
  const userJobA = FIXTURE_MANIFEST.user_jobs[0]
  const userJobB = FIXTURE_MANIFEST.user_jobs[1]
  const resumeA = FIXTURE_MANIFEST.resumes[0]
  const resumeB = FIXTURE_MANIFEST.resumes[1]
  for (const [step, relation, query] of [
    ['fixture.collision.companies', 'companies', `id=eq.${company.id}`],
    ['fixture.collision.jobs', 'jobs', `id=eq.${job.id}`],
    [
      'fixture.collision.user_jobs',
      'user_jobs',
      `id=in.(${userJobA.id},${userJobB.id})`,
    ],
    [
      'fixture.collision.resumes',
      'resumes',
      `id=in.(${resumeA.id},${resumeB.id})`,
    ],
  ] as const) {
    await selectExact(
      step,
      apiUrl,
      publishableKey,
      null,
      serviceKey,
      relation,
      `select=id&${query}`,
      0,
      secrets,
    )
  }
  await mutateExact(
    'fixture.seed.companies',
    apiUrl,
    publishableKey,
    null,
    serviceKey,
    'companies',
    'POST',
    '',
    {
      id: company.id,
      name: company.name,
      ats_type: 'greenhouse',
      board_token: company.board_token,
      careers_url: company.careers_url,
      source_key: company.source_key,
    },
    1,
    secrets,
  )
  await mutateExact(
    'fixture.seed.jobs',
    apiUrl,
    publishableKey,
    null,
    serviceKey,
    'jobs',
    'POST',
    '',
    {
      id: job.id,
      company_id: company.id,
      source: 'greenhouse',
      external_id: job.external_id,
      title: 'Phase 04 Tracker Fixture Analyst',
      location: 'Chicago, IL',
      absolute_url: 'https://example.invalid/phase-04-tracker-fixture',
      description_text: 'Disposable tracker verification fixture.',
      snapshot_partial: false,
      fingerprint: job.fingerprint,
      status: 'open',
    },
    1,
    secrets,
  )
  await mutateExact(
    'fixture.seed.user_jobs',
    apiUrl,
    publishableKey,
    null,
    serviceKey,
    'user_jobs',
    'POST',
    '',
    [
      { id: userJobA.id, user_id: userA.id, job_id: job.id },
      { id: userJobB.id, user_id: userB.id, job_id: job.id },
    ],
    2,
    secrets,
  )
  await mutateExact(
    'fixture.seed.resumes',
    apiUrl,
    publishableKey,
    null,
    serviceKey,
    'resumes',
    'POST',
    '',
    [
      {
        id: resumeA.id,
        user_id: userA.id,
        filename: `${FIXTURE_MANIFEST.namespace}-a.pdf`,
        storage_path: resumeA.storage_path,
        size_bytes: 1,
      },
      {
        id: resumeB.id,
        user_id: userB.id,
        filename: `${FIXTURE_MANIFEST.namespace}-b.pdf`,
        storage_path: resumeB.storage_path,
        size_bytes: 1,
      },
    ],
    2,
    secrets,
  )
}

function scalarUuid(payload: Json, label: string): string {
  requireCondition(typeof payload === 'string' && UUID.test(payload), `${label} is malformed`)
  return payload
}

function manualResult(payload: Json, warning: boolean): string {
  requireCondition(Array.isArray(payload) && payload.length === 1, 'manual create row count drifted')
  const row = payload[0]
  requireCondition(row && typeof row === 'object' && !Array.isArray(row), 'manual create result is malformed')
  const record = row as JsonRecord
  requireCondition(
    Object.keys(record).sort().join(',') ===
      ['application_id', 'duplicate_warning'].sort().join(','),
    'manual create result fields drifted',
  )
  requireCondition(record.duplicate_warning === warning, 'manual duplicate warning drifted')
  return scalarUuid(record.application_id, 'manual application ID')
}

async function proveOrdinaryBehavior(
  apiUrl: string,
  publishableKey: string,
  serviceKey: string,
  sessionA: Session,
  sessionB: Session,
  applicationLineage: Map<string, string>,
  eventLineage: Map<string, string>,
  secrets: string[],
) {
  const today = new Date().toISOString().slice(0, 10)
  const userJobA = FIXTURE_MANIFEST.user_jobs[0]
  const userJobB = FIXTURE_MANIFEST.user_jobs[1]

  const markedA = await rpc(
    'behavior.mark.a.first',
    apiUrl,
    publishableKey,
    sessionA,
    'mark_job_applied',
    { p_user_job_id: userJobA.id },
    [200],
    secrets,
  )
  const systemA = scalarUuid(markedA.payload, 'user A system application ID')
  const markedAgain = await rpc(
    'behavior.mark.a.repeat',
    apiUrl,
    publishableKey,
    sessionA,
    'mark_job_applied',
    { p_user_job_id: userJobA.id },
    [200],
    secrets,
  )
  requireCondition(markedAgain.payload === systemA, 'Mark Applied is not idempotent')

  const markedB = await rpc(
    'behavior.mark.b.first',
    apiUrl,
    publishableKey,
    sessionB,
    'mark_job_applied',
    { p_user_job_id: userJobB.id },
    [200],
    secrets,
  )
  const systemB = scalarUuid(markedB.payload, 'user B system application ID')

  const createBody = {
    p_company: `${FIXTURE_MANIFEST.namespace} manual company`,
    p_title: `${FIXTURE_MANIFEST.namespace} manual title`,
    p_apply_url: 'https://example.invalid/phase-04-tracker-manual',
    p_notes: `${FIXTURE_MANIFEST.namespace} disposable notes`,
    p_stage: 'ready_to_apply',
    p_occurred_on: today,
  }
  const firstManual = manualResult(
    (
      await rpc(
        'behavior.manual.a.first',
        apiUrl,
        publishableKey,
        sessionA,
        'create_manual_application',
        createBody,
        [200],
        secrets,
      )
    ).payload,
    false,
  )
  const duplicateManual = manualResult(
    (
      await rpc(
        'behavior.manual.a.duplicate',
        apiUrl,
        publishableKey,
        sessionA,
        'create_manual_application',
        createBody,
        [200],
        secrets,
      )
    ).payload,
    true,
  )

  for (const [step, id, owner, origin] of [
    ['lineage.application.system_a', systemA, sessionA.userId, 'system'],
    ['lineage.application.system_b', systemB, sessionB.userId, 'system'],
    [
      'lineage.application.manual_first',
      firstManual,
      sessionA.userId,
      'manual',
    ],
    [
      'lineage.application.manual_duplicate',
      duplicateManual,
      sessionA.userId,
      'manual',
    ],
  ]) {
    const rows = await selectExact(
      step as DiagnosticStep,
      apiUrl,
      publishableKey,
      null,
      serviceKey,
      'applications',
      `select=id,user_id,origin,source_job_id,company&` +
        `id=eq.${id}&user_id=eq.${owner}`,
      1,
      secrets,
    )
    requireCondition(rows[0].origin === origin, 'runtime application origin drifted')
    if (origin === 'system') {
      requireCondition(
        rows[0].source_job_id === FIXTURE_MANIFEST.jobs[0].id,
        'runtime system parent drifted',
      )
    } else {
      requireCondition(
        String(rows[0].company).startsWith(FIXTURE_MANIFEST.namespace),
        'runtime manual namespace drifted',
      )
    }
    applicationLineage.set(id, owner)
  }
  requireCondition(
    applicationLineage.size === EXPECTED_COUNTS.applications,
    'runtime application exact expected count drifted',
  )

  await selectExact(
    'isolation.read.b_to_a',
    apiUrl,
    publishableKey,
    sessionB,
    null,
    'applications',
    `select=id&id=eq.${systemA}`,
    0,
    secrets,
  )
  await selectExact(
    'isolation.read.a_to_b',
    apiUrl,
    publishableKey,
    sessionA,
    null,
    'applications',
    `select=id&id=eq.${systemB}`,
    0,
    secrets,
  )
  await rpc(
    'isolation.pin.b_to_a',
    apiUrl,
    publishableKey,
    sessionB,
    'set_application_pin',
    { p_application_id: systemA, p_pinned: true },
    [400, 404],
    secrets,
  )
  await rpc(
    'isolation.resume.b_to_a',
    apiUrl,
    publishableKey,
    sessionB,
    'set_application_resume',
    {
      p_application_id: systemB,
      p_resume_id: FIXTURE_MANIFEST.resumes[0].id,
    },
    [400, 404],
    secrets,
  )

  await rpc(
    'behavior.resume.link.a',
    apiUrl,
    publishableKey,
    sessionA,
    'set_application_resume',
    {
      p_application_id: systemA,
      p_resume_id: FIXTURE_MANIFEST.resumes[0].id,
    },
    [200],
    secrets,
  )
  await mutateExact(
    'behavior.resume.delete.a',
    apiUrl,
    publishableKey,
    sessionA,
    null,
    'resumes',
    'DELETE',
    `id=eq.${FIXTURE_MANIFEST.resumes[0].id}&user_id=eq.${sessionA.userId}`,
    undefined,
    1,
    secrets,
  )
  const resumeCleared = await selectExact(
    'behavior.resume.verify.a',
    apiUrl,
    publishableKey,
    sessionA,
    null,
    'applications',
    `select=id,resume_id&id=eq.${systemA}`,
    1,
    secrets,
  )
  requireCondition(resumeCleared[0].resume_id === null, 'resume delete did not clear only the link')

  const beforeProjection = await rpc(
    'behavior.dashboard.before',
    apiUrl,
    publishableKey,
    sessionA,
    'dashboard_applied_applications',
    {},
    [200],
    secrets,
  )
  const projectionColumns =
    'application_id, company, title, location, apply_url, applied_on, current_stage, current_stage_date'
  requireCondition(Array.isArray(beforeProjection.payload), 'Dashboard projection is malformed')
  const beforeRow = (beforeProjection.payload as JsonRecord[]).find(
    (row) => row.application_id === systemA,
  )
  requireCondition(beforeRow, 'system application is absent from Dashboard applied projection')
  requireCondition(
    Object.keys(beforeRow).join(', ') === projectionColumns,
    'Dashboard applied projection columns/order drifted',
  )
  const earliestApplied = beforeRow.applied_on

  const laterApplied = await rpc(
    'behavior.event.repeat.a',
    apiUrl,
    publishableKey,
    sessionA,
    'append_application_stage',
    {
      p_application_id: systemA,
      p_stage: 'applied',
      p_occurred_on: today,
    },
    [200],
    secrets,
  )
  const laterEventId = scalarUuid(laterApplied.payload, 'later Applied event ID')
  const afterProjection = await rpc(
    'behavior.dashboard.after',
    apiUrl,
    publishableKey,
    sessionA,
    'dashboard_applied_applications',
    {},
    [200],
    secrets,
  )
  const afterRow = (afterProjection.payload as JsonRecord[]).find(
    (row) => row.application_id === systemA,
  )
  requireCondition(
    afterRow?.applied_on === earliestApplied,
    'earliest-Applied stability drifted after later repeated Applied event',
  )

  const allEvents = await selectExact(
    'lineage.events.all',
    apiUrl,
    publishableKey,
    null,
    serviceKey,
    'application_stage_events',
    `select=id,application_id,user_id,stage&` +
      `application_id=in.(${[...applicationLineage.keys()].join(',')})`,
    EXPECTED_COUNTS.application_stage_events,
    secrets,
  )
  for (const event of allEvents) {
    const eventId = String(event.id)
    const applicationId = String(event.application_id)
    requireCondition(UUID.test(eventId), 'runtime event ID is malformed')
    requireCondition(
      applicationLineage.get(applicationId) === event.user_id,
      'runtime event owner/parent drifted',
    )
    eventLineage.set(eventId, applicationId)
  }
  requireCondition(
    eventLineage.size === EXPECTED_COUNTS.application_stage_events &&
      eventLineage.get(laterEventId) === systemA,
    'runtime event exact expected count drifted',
  )

  const finalEventB = allEvents.find((event) => event.application_id === systemB)
  requireCondition(finalEventB, 'user B final event is absent')
  await rpc(
    'behavior.event.final_reject.b',
    apiUrl,
    publishableKey,
    sessionB,
    'delete_application_stage_event',
    { p_event_id: finalEventB.id },
    [400, 409],
    secrets,
  )

  await mutateExact(
    'behavior.source.remove.a',
    apiUrl,
    publishableKey,
    null,
    serviceKey,
    'user_jobs',
    'DELETE',
    `id=eq.${userJobA.id}&user_id=eq.${sessionA.userId}&job_id=eq.${FIXTURE_MANIFEST.jobs[0].id}`,
    undefined,
    EXPECTED_COUNTS.source_rows_removed_during_proof,
    secrets,
  )
  const snapshot = await selectExact(
    'behavior.snapshot.verify.a',
    apiUrl,
    publishableKey,
    sessionA,
    null,
    'applications',
    `select=id,company,title,source_job_id&id=eq.${systemA}`,
    1,
    secrets,
  )
  requireCondition(
    snapshot[0].source_job_id === FIXTURE_MANIFEST.jobs[0].id,
    'system snapshot did not survive exact source-row removal',
  )

}

async function recoverVerifiedLineage(
  apiUrl: string,
  publishableKey: string,
  serviceKey: string,
  applicationLineage: Map<string, string>,
  eventLineage: Map<string, string>,
  secrets: string[],
): Promise<void> {
  const ownerIds = FIXTURE_MANIFEST.auth_users.map((user) => user.id)
  const applications = await selectExact(
    'cleanup.recover.applications.exact',
    apiUrl,
    publishableKey,
    null,
    serviceKey,
    'applications',
    `select=id,user_id,origin,source_job_id,company&user_id=in.(${ownerIds.join(',')})`,
    applicationLineage.size,
    secrets,
  ).catch(async () => {
    const result = await postgrest(
      'cleanup.recover.applications.fallback',
      apiUrl,
      publishableKey,
      null,
      serviceKey,
      `applications?select=id,user_id,origin,source_job_id,company&` +
        `user_id=in.(${ownerIds.join(',')})`,
      { method: 'GET' },
      [200],
      secrets,
    )
    requireCondition(
      Array.isArray(result.payload) &&
        result.payload.length <= EXPECTED_COUNTS.applications,
      'cleanup refused: runtime application count exceeds manifest bounds',
    )
    return result.payload as JsonRecord[]
  })
  for (const row of applications) {
    const id = String(row.id)
    const owner = String(row.user_id)
    requireCondition(UUID.test(id) && ownerIds.includes(owner), 'cleanup application identity drifted')
    requireCondition(
      (row.origin === 'system' &&
        row.source_job_id === FIXTURE_MANIFEST.jobs[0].id) ||
        (row.origin === 'manual' &&
          String(row.company).startsWith(FIXTURE_MANIFEST.namespace)),
      'cleanup application parent/namespace drifted',
    )
    applicationLineage.set(id, owner)
  }
  requireCondition(
    applicationLineage.size === applications.length,
    'cleanup application memory-only lineage is ambiguous',
  )
  if (applicationLineage.size === 0) return
  const eventsResult = await postgrest(
    'cleanup.recover.events',
    apiUrl,
    publishableKey,
    null,
    serviceKey,
    `application_stage_events?select=id,application_id,user_id&` +
      `application_id=in.(${[...applicationLineage.keys()].join(',')})`,
    { method: 'GET' },
    [200],
    secrets,
  )
  requireCondition(
    Array.isArray(eventsResult.payload) &&
      eventsResult.payload.length <= EXPECTED_COUNTS.application_stage_events,
    'cleanup refused: runtime event count exceeds manifest bounds',
  )
  for (const row of eventsResult.payload as JsonRecord[]) {
    const id = String(row.id)
    const parent = String(row.application_id)
    requireCondition(
      UUID.test(id) && applicationLineage.get(parent) === row.user_id,
      'cleanup event owner/parent drifted',
    )
    eventLineage.set(id, parent)
  }
  requireCondition(
    eventLineage.size === (eventsResult.payload as Json[]).length,
    'cleanup event memory-only lineage is ambiguous',
  )
}

async function cleanupExact(
  apiUrl: string,
  publishableKey: string,
  serviceKey: string,
  applicationLineage: Map<string, string>,
  eventLineage: Map<string, string>,
  secrets: string[],
): Promise<void> {
  requireCondition(
    applicationLineage.size <= EXPECTED_COUNTS.applications,
    'cleanup refused: application memory-only lineage exceeds exact expected count',
  )
  requireCondition(
    eventLineage.size <= EXPECTED_COUNTS.application_stage_events,
    'cleanup refused: event memory-only lineage exceeds exact expected count',
  )
  const applicationIds = [...applicationLineage.keys()]
  const eventIds = [...eventLineage.keys()]
  if (eventIds.length > 0) {
    await mutateExact(
      'cleanup.events.delete',
      apiUrl,
      publishableKey,
      null,
      serviceKey,
      'application_stage_events',
      'DELETE',
      `id=in.(${eventIds.join(',')})&application_id=in.(${applicationIds.join(',')})&` +
        `user_id=in.(${FIXTURE_MANIFEST.auth_users.map((user) => user.id).join(',')})`,
      undefined,
      eventIds.length,
      secrets,
    )
  }
  if (applicationIds.length > 0) {
    await mutateExact(
      'cleanup.applications.delete',
      apiUrl,
      publishableKey,
      null,
      serviceKey,
      'applications',
      'DELETE',
      `id=in.(${applicationIds.join(',')})&` +
        `user_id=in.(${FIXTURE_MANIFEST.auth_users.map((user) => user.id).join(',')})`,
      undefined,
      applicationIds.length,
      secrets,
    )
  }
  const remainingUserJobsResult = await postgrest(
    'cleanup.user_jobs.read',
    apiUrl,
    publishableKey,
    null,
    serviceKey,
    `user_jobs?select=id,user_id,job_id&id=in.(${FIXTURE_MANIFEST.user_jobs.map((row) => row.id).join(',')})`,
    { method: 'GET' },
    [200],
    secrets,
  )
  requireCondition(Array.isArray(remainingUserJobsResult.payload), 'cleanup user_jobs inventory malformed')
  const remainingUserJobs = remainingUserJobsResult.payload as JsonRecord[]
  for (const row of remainingUserJobs) {
    const manifestIndex = FIXTURE_MANIFEST.user_jobs.findIndex(
      (item) => item.id === row.id,
    )
    requireCondition(manifestIndex >= 0, 'cleanup user_job ID drifted')
    requireCondition(
      row.user_id === FIXTURE_MANIFEST.auth_users[manifestIndex].id &&
        row.job_id === FIXTURE_MANIFEST.jobs[0].id,
      'cleanup user_job owner/parent drifted',
    )
  }
  if (remainingUserJobs.length > 0) {
    await mutateExact(
      'cleanup.user_jobs.delete',
      apiUrl,
      publishableKey,
      null,
      serviceKey,
      'user_jobs',
      'DELETE',
      `id=in.(${remainingUserJobs.map((row) => row.id).join(',')})&` +
        `user_id=in.(${FIXTURE_MANIFEST.auth_users.map((user) => user.id).join(',')})&` +
        `job_id=eq.${FIXTURE_MANIFEST.jobs[0].id}`,
      undefined,
      remainingUserJobs.length,
      secrets,
    )
  }
  const remainingResumesResult = await postgrest(
    'cleanup.resumes.read',
    apiUrl,
    publishableKey,
    null,
    serviceKey,
    `resumes?select=id,user_id,storage_path&id=in.(${FIXTURE_MANIFEST.resumes.map((row) => row.id).join(',')})`,
    { method: 'GET' },
    [200],
    secrets,
  )
  requireCondition(Array.isArray(remainingResumesResult.payload), 'cleanup resume inventory malformed')
  const remainingResumes = remainingResumesResult.payload as JsonRecord[]
  for (const row of remainingResumes) {
    const manifest = FIXTURE_MANIFEST.resumes.find((item) => item.id === row.id)
    requireCondition(
      manifest &&
        row.user_id ===
          FIXTURE_MANIFEST.auth_users[manifest.owner === 'a' ? 0 : 1].id &&
        row.storage_path === manifest.storage_path,
      'cleanup resume owner/namespace drifted',
    )
  }
  if (remainingResumes.length > 0) {
    await mutateExact(
      'cleanup.resumes.delete',
      apiUrl,
      publishableKey,
      null,
      serviceKey,
      'resumes',
      'DELETE',
      `id=in.(${remainingResumes.map((row) => row.id).join(',')})&` +
        `user_id=in.(${FIXTURE_MANIFEST.auth_users.map((user) => user.id).join(',')})`,
      undefined,
      remainingResumes.length,
      secrets,
    )
  }
  const jobs = await selectExact(
    'cleanup.jobs.read',
    apiUrl, publishableKey, null, serviceKey, 'jobs',
    `select=id&id=eq.${FIXTURE_MANIFEST.jobs[0].id}`, 1, secrets,
  ).catch(() => [])
  if (jobs.length === 1) {
    await mutateExact(
      'cleanup.jobs.delete',
      apiUrl, publishableKey, null, serviceKey, 'jobs', 'DELETE',
      `id=eq.${FIXTURE_MANIFEST.jobs[0].id}&company_id=eq.${FIXTURE_MANIFEST.companies[0].id}&external_id=eq.${FIXTURE_MANIFEST.jobs[0].external_id}`,
      undefined, 1, secrets,
    )
  }
  const companies = await selectExact(
    'cleanup.companies.read',
    apiUrl, publishableKey, null, serviceKey, 'companies',
    `select=id&id=eq.${FIXTURE_MANIFEST.companies[0].id}`, 1, secrets,
  ).catch(() => [])
  if (companies.length === 1) {
    await mutateExact(
      'cleanup.companies.delete',
      apiUrl, publishableKey, null, serviceKey, 'companies', 'DELETE',
      `id=eq.${FIXTURE_MANIFEST.companies[0].id}&board_token=eq.${FIXTURE_MANIFEST.companies[0].board_token}`,
      undefined, 1, secrets,
    )
  }
}

async function zeroResidue(
  apiUrl: string,
  publishableKey: string,
  serviceKey: string,
  secrets: string[],
): Promise<JsonRecord> {
  const checks: JsonRecord = {}
  for (const [step, relation, query] of [
    [
      'residue.events',
      'application_stage_events',
      `user_id=in.(${FIXTURE_MANIFEST.auth_users.map((user) => user.id).join(',')})`,
    ],
    [
      'residue.applications',
      'applications',
      `user_id=in.(${FIXTURE_MANIFEST.auth_users.map((user) => user.id).join(',')})`,
    ],
    [
      'residue.user_jobs',
      'user_jobs',
      `id=in.(${FIXTURE_MANIFEST.user_jobs.map((row) => row.id).join(',')})`,
    ],
    [
      'residue.resumes',
      'resumes',
      `id=in.(${FIXTURE_MANIFEST.resumes.map((row) => row.id).join(',')})`,
    ],
    ['residue.jobs', 'jobs', `id=eq.${FIXTURE_MANIFEST.jobs[0].id}`],
    [
      'residue.companies',
      'companies',
      `id=eq.${FIXTURE_MANIFEST.companies[0].id}`,
    ],
  ] as const) {
    await selectExact(
      step,
      apiUrl,
      publishableKey,
      null,
      serviceKey,
      relation,
      `select=id&${query}`,
      0,
      secrets,
    )
    checks[`public.${relation}`] = 0
  }
  for (let index = 0; index < FIXTURE_MANIFEST.auth_users.length; index += 1) {
    const user = FIXTURE_MANIFEST.auth_users[index]
    const response = await httpJson(
      index === 0 ? 'residue.auth.a' : 'residue.auth.b',
      `${apiUrl}/auth/v1/admin/users/${encodeURIComponent(user.id)}`,
      { method: 'GET', headers: serviceHeaders(serviceKey) },
      [404],
      secrets,
    )
    requireCondition(response.status === 404, 'auth user residue remained')
  }
  checks['auth.users'] = 0
  requireCondition(
    Object.keys(checks).length === EXPECTED_COUNTS.cleanup_relations,
    'zero residue did not cover exactly seven relations',
  )
  return checks
}

async function runHosted(args: ReturnType<typeof parseArgs>): Promise<void> {
  const root = await repositoryRoot()
  const preflightPath = checkedPath(root, args.preflight!)
  const catalogPath = checkedPath(root, args.catalogEvidence!)
  const evidencePath = checkedPath(root, args.evidence!)
  const approved = preflightJson(await readFile(preflightPath, 'utf8'))
  requireCondition(approved.status === 'PASS', 'preflight status is not PASS')
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8')) as JsonRecord
  requireCondition(catalog.status === 'PASS', 'catalog evidence is not PASS before seed')
  const catalogDigest = assertHash(
    catalog.catalog_evidence_sha256,
    'catalog_evidence_sha256',
  )
  const catalogWithoutDigest = { ...catalog }
  delete catalogWithoutDigest.catalog_evidence_sha256
  requireCondition(
    sha256(canonical(catalogWithoutDigest)) === catalogDigest,
    'catalog PASS digest drifted before seed',
  )

  const current = {
    migration_sha256: await fileSha(
      resolve(root, 'supabase/migrations/0053_application_tracker.sql'),
    ),
    repair_migration_sha256: await fileSha(
      resolve(
        root,
        'supabase/migrations/0054_mark_job_applied_ambiguity.sql',
      ),
    ),
    schema_verifier_sha256: await fileSha(
      resolve(root, 'scripts/verify-tracker-schema.ts'),
    ),
    behavior_verifier_sha256: await fileSha(
      resolve(root, 'scripts/verify-tracker-rls.ts'),
    ),
    fixture_manifest_sha256: FIXTURE_MANIFEST_SHA256,
  }
  for (const [field, digest] of Object.entries(current)) {
    requireCondition(
      approved[field] === digest && catalog[field] === digest,
      `${field} approval/catalog drifted before seed`,
    )
  }
  const projectRef = stringField(approved, 'project_ref')
  const linkedRef = (
    await readFile(resolve(root, 'supabase/.temp/project-ref'), 'utf8')
  ).trim()
  requireCondition(linkedRef === projectRef, 'linked project target drifted before seed')
  const apiUrl = process.env.SUPABASE_URL?.trim()
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim()
  requireCondition(apiUrl && /^https:\/\/[^/@]+$/.test(apiUrl), 'SUPABASE_URL is required')
  requireCondition(publishableKey, 'SUPABASE_PUBLISHABLE_KEY is required')

  // The catalog PASS and every approval-bound digest have passed at this point.
  // No behavior fixture is seeded before this line.
  let serviceRoleKey = ''
  const secrets: string[] = []
  const applicationLineage = new Map<string, string>()
  const eventLineage = new Map<string, string>()
  const createdUserIds = new Set<string>()
  let directFixturesSeeded = false
  let behaviorCompleted = false
  let cleanupCompleted = false
  let primaryFailure: Error | null = null
  let cleanupFailure: Error | null = null
  let residue: JsonRecord = {}
  const passwordA = `T4!${randomBytes(30).toString('base64url')}`
  const passwordB = `T4!${randomBytes(30).toString('base64url')}`
  secrets.push(passwordA, passwordB)

  try {
    serviceRoleKey = discoverServiceRoleKey(root, projectRef)
    secrets.push(serviceRoleKey)
    for (let index = 0; index < FIXTURE_MANIFEST.auth_users.length; index += 1) {
      const user = FIXTURE_MANIFEST.auth_users[index]
      await httpJson(
        index === 0 ? 'auth.preflight.a' : 'auth.preflight.b',
        `${apiUrl}/auth/v1/admin/users/${encodeURIComponent(user.id)}`,
        { method: 'GET', headers: serviceHeaders(serviceRoleKey) },
        [404],
        secrets,
      )
    }
    await createExactUser(
      'auth.create.a',
      apiUrl,
      serviceRoleKey,
      FIXTURE_MANIFEST.auth_users[0],
      passwordA,
      secrets,
    )
    createdUserIds.add(FIXTURE_MANIFEST.auth_users[0].id)
    await createExactUser(
      'auth.create.b',
      apiUrl,
      serviceRoleKey,
      FIXTURE_MANIFEST.auth_users[1],
      passwordB,
      secrets,
    )
    createdUserIds.add(FIXTURE_MANIFEST.auth_users[1].id)
    directFixturesSeeded = true
    await seedDirectFixtures(apiUrl, publishableKey, serviceRoleKey, secrets)

    const sessionA = await signInWithPassword(
      'auth.signin.a',
      apiUrl,
      publishableKey,
      FIXTURE_MANIFEST.auth_users[0].email,
      passwordA,
      secrets,
    )
    const sessionB = await signInWithPassword(
      'auth.signin.b',
      apiUrl,
      publishableKey,
      FIXTURE_MANIFEST.auth_users[1].email,
      passwordB,
      secrets,
    )
    requireCondition(
      sessionA.userId === FIXTURE_MANIFEST.auth_users[0].id &&
        sessionB.userId === FIXTURE_MANIFEST.auth_users[1].id &&
        sessionA.accessToken !== sessionB.accessToken,
      'two independent ordinary publishable-key sessions were not established',
    )
    await proveOrdinaryBehavior(
      apiUrl,
      publishableKey,
      serviceRoleKey,
      sessionA,
      sessionB,
      applicationLineage,
      eventLineage,
      secrets,
    )
    behaviorCompleted = true
  } catch (error) {
    primaryFailure = sanitizedError(error, secrets)
  } finally {
    // The finally path is exact-count, owner/parent/namespace, and memory-only
    // lineage constrained. It refuses broad cleanup when behavior lineage is
    // ambiguous, preserving the fail-closed boundary.
    if (serviceRoleKey && createdUserIds.size > 0) {
      try {
        if (directFixturesSeeded) {
          await recoverVerifiedLineage(
            apiUrl,
            publishableKey,
            serviceRoleKey,
            applicationLineage,
            eventLineage,
            secrets,
          )
          await cleanupExact(
            apiUrl,
            publishableKey,
            serviceRoleKey,
            applicationLineage,
            eventLineage,
            secrets,
          )
        }
        for (const user of [...FIXTURE_MANIFEST.auth_users].reverse()) {
          if (createdUserIds.has(user.id)) {
            await deleteExactUser(
              user.id === FIXTURE_MANIFEST.auth_users[0].id
                ? 'cleanup.auth.delete.a'
                : 'cleanup.auth.delete.b',
              apiUrl,
              serviceRoleKey,
              user.id,
              secrets,
            )
          }
        }
        cleanupCompleted = true
        residue = await zeroResidue(
          apiUrl,
          publishableKey,
          serviceRoleKey,
          secrets,
        )
      } catch (cleanupError) {
        cleanupFailure = sanitizedError(cleanupError, secrets)
      } finally {
        serviceRoleKey = ''
        secrets.fill('[REDACTED]')
      }
    }
  }

  if (primaryFailure) throw primaryFailure
  if (cleanupFailure) throw cleanupFailure
  requireCondition(behaviorCompleted, 'ordinary behavior proof did not complete')
  requireCondition(cleanupCompleted, 'exact cleanup did not complete')
  const evidenceBody: JsonRecord = {
    status: 'PASS',
    checked_at: new Date().toISOString(),
    catalog_evidence_sha256: catalogDigest,
    migration_sha256: current.migration_sha256,
    repair_migration_sha256: current.repair_migration_sha256,
    schema_verifier_sha256: current.schema_verifier_sha256,
    behavior_verifier_sha256: current.behavior_verifier_sha256,
    fixture_manifest_sha256: current.fixture_manifest_sha256,
    checks: {
      exact_manifest: true,
      catalog_before_behavior: true,
      service_role_memory_only: true,
      two_ordinary_sessions: true,
      mark_applied_idempotent: true,
      manual_six_parameter_two_result: true,
      duplicate_warning_nonblocking: true,
      cross_user_table_and_rpc_isolation: true,
      resume_owner_and_delete_behavior: true,
      final_event_rejection: true,
      source_loss_snapshot_survival: true,
      dashboard_eight_column_projection: true,
      earliest_applied_stable: true,
      exact_cleanup: true,
      zero_residue: true,
    },
    counts: {
      directly_seeded_auth_users: EXPECTED_COUNTS.auth_users,
      directly_seeded_companies: EXPECTED_COUNTS.companies,
      directly_seeded_jobs: EXPECTED_COUNTS.jobs,
      directly_seeded_user_jobs: EXPECTED_COUNTS.user_jobs_seeded,
      directly_seeded_resumes: EXPECTED_COUNTS.resumes_seeded,
      runtime_applications: applicationLineage.size,
      runtime_events: eventLineage.size,
      cleanup_relations: Object.keys(residue).length,
    },
    residue_counts: residue,
  }
  evidenceBody.behavior_evidence_sha256 = sha256(canonical(evidenceBody))
  const serialized = `${JSON.stringify(evidenceBody, null, 2)}\n`
  requireCondition(
    !/(?:eyJ[a-zA-Z0-9_-]{20,}|service_role|SUPABASE_ACCESS_TOKEN|postgres(?:ql)?:\/\/|https?:\/\/|@example\.invalid)/.test(
      serialized,
    ),
    'evidence redaction failed',
  )
  await mkdir(dirname(evidencePath), { recursive: true })
  await writeFile(evidencePath, serialized, { encoding: 'utf8', mode: 0o600 })
  process.stdout.write(
    `${JSON.stringify({
      status: 'PASS',
      behavior_evidence_sha256: evidenceBody.behavior_evidence_sha256,
      evidence: relative(root, evidencePath),
    })}\n`,
  )
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.mode === 'contract') {
    process.stdout.write(`${JSON.stringify(contractDocument())}\n`)
    return
  }
  await runHosted(args)
}

main().catch((error: unknown) => {
  const sanitized = sanitizedError(error, [])
  process.stderr.write(`tracker RLS verification failed: ${sanitized.message}\n`)
  process.exitCode = 1
})

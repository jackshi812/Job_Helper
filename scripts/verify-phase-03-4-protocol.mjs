#!/usr/bin/env node

import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cli = resolve(root, 'web/node_modules/.bin/supabase')
const args = new Set(process.argv.slice(2))
const expectedArgs = new Set(['--local', '--fresh'])
const projectId = `phase034protocol${process.pid}`
const workRoot = mkdtempSync(resolve(tmpdir(), 'phase-03-4-protocol-'))
const workdir = resolve(workRoot, 'project')
const supabaseDir = resolve(workdir, 'supabase')
const results = []
let started = false

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function record(name, assertions) {
  results.push({ name, assertions })
  process.stdout.write(`PASS ${name}\n`)
}

function command(commandArgs, options = {}) {
  const result = spawnSync(cli, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      SUPABASE_TELEMETRY_DISABLED: '1',
    },
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  })
  if (result.status !== 0) {
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
    throw new Error(
      `local_supabase_command_failed:${commandArgs[0]}:${output.slice(-3000)}`,
    )
  }
  return result.stdout
}

function endpoint(base, path, query = '') {
  return `${base}${path}${query ? `?${query}` : ''}`
}

async function request(url, {
  token,
  apikey,
  method = 'GET',
  body,
  prefer,
  expected = 200,
} = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      apikey,
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  const parsed = text ? JSON.parse(text) : null
  const expectedStatuses = Array.isArray(expected) ? expected : [expected]
  if (!expectedStatuses.includes(response.status)) {
    throw new Error(
      `local_protocol_http_${response.status}:${method}:${new URL(url).pathname}:${
        JSON.stringify(parsed).slice(0, 500)
      }`,
    )
  }
  return parsed
}

function apiSession(apiUrl, apikey, token = apikey) {
  return {
    rpc(name, body = {}, expected = 200) {
      return request(endpoint(apiUrl, `/rest/v1/rpc/${name}`), {
        token,
        apikey,
        method: 'POST',
        body,
        expected,
      })
    },
    table(name, query, options = {}) {
      return request(endpoint(apiUrl, `/rest/v1/${name}`, query), {
        token,
        apikey,
        ...options,
      })
    },
  }
}

const rubric = {
  strictTitle: 30,
  weakTitle: 20,
  preferredLocation: 10,
  recency: 10,
  watchlist: 10,
  experience: 20,
  includeKeywordSteps: {
    one: 3,
    two: 5,
    three: 10,
    four: 15,
    fivePlus: 20,
  },
}

const breakdown = [
  { key: 'title', earned: 0, possible: 30, evidence: [] },
  { key: 'location', earned: 0, possible: 10, evidence: [] },
  { key: 'recency', earned: 0, possible: 10, evidence: [] },
  { key: 'watchlist', earned: 0, possible: 10, evidence: [] },
  { key: 'experience', earned: 0, possible: 20, evidence: [] },
  { key: 'keywords', earned: 0, possible: 20, evidence: [] },
]

function saveBody(title = 'Protocol Engineer') {
  return {
    p_titles: [title],
    p_locations: [],
    p_include_keywords: [],
    p_exclude_keywords: [],
    p_title_exclude_keywords: [],
    p_max_required_experience: null,
    p_ranking_rubric: rubric,
    p_good_threshold: 50,
    p_strong_threshold: 75,
  }
}

async function one(session, table, query) {
  const rows = await session.table(table, query)
  assert(Array.isArray(rows) && rows.length === 1, `${table}_expected_one`)
  return rows[0]
}

async function completeRun(service, runId) {
  const items = await service.table(
    'deterministic_ranking_items',
    `run_id=eq.${runId}&select=id`,
  )
  assert(Array.isArray(items), 'ranking_items_expected_array')
  if (items.length > 0) {
    const completed = await service.table(
      'deterministic_ranking_items',
      `run_id=eq.${runId}`,
      {
        method: 'PATCH',
        prefer: 'return=representation',
        body: {
          status: 'completed',
          deterministic_eligible: false,
          deterministic_score: null,
          deterministic_tier: null,
          deterministic_breakdown: breakdown,
          deterministic_filter_code: 'title_non_overlap',
          deterministic_filter_detail: 'protocol fixture',
          claimed_at: null,
          completed_at: new Date().toISOString(),
        },
      },
    )
    assert(completed.length === items.length, 'ranking_items_complete_count')
  }
  const finalized = await service.rpc(
    'finalize_deterministic_ranking_run',
    { p_run_id: runId },
  )
  assert(finalized[0]?.published === true, 'ranking_run_not_published')
}

async function createUser(apiUrl, serviceKey, anonKey, ordinal) {
  const email = `phase034-protocol-${process.pid}-${ordinal}@example.invalid`
  const password = `Local-only-${process.pid}-${ordinal}-A9!`
  const created = await request(endpoint(apiUrl, '/auth/v1/admin/users'), {
    token: serviceKey,
    apikey: serviceKey,
    method: 'POST',
    body: { email, password, email_confirm: true },
  })
  const login = await request(
    endpoint(apiUrl, '/auth/v1/token', 'grant_type=password'),
    {
      token: anonKey,
      apikey: anonKey,
      method: 'POST',
      body: { email, password },
    },
  )
  assert(created.id === login.user.id, 'local_auth_identity_mismatch')
  return {
    id: created.id,
    session: apiSession(apiUrl, anonKey, login.access_token),
  }
}

async function main() {
  assert(
    args.size === expectedArgs.size &&
      [...args].every((argument) => expectedArgs.has(argument)),
    'usage: node scripts/verify-phase-03-4-protocol.mjs --local --fresh',
  )
  assert(existsSync(cli), 'repository_pinned_supabase_cli_missing')
  assert(
    !existsSync(resolve(supabaseDir, '.temp/project-ref')),
    'refusing_linked_supabase_project',
  )

  cpSync(resolve(root, 'supabase/config.toml'), resolve(supabaseDir, 'config.toml'), {
    recursive: false,
  })
  cpSync(resolve(root, 'supabase/migrations'), resolve(supabaseDir, 'migrations'), {
    recursive: true,
  })
  // Local fixture/introspection access only. Production workers mutate protocol
  // state through the reviewed security-definer RPCs; the disposable verifier
  // needs service-role table access solely to seed facts, age leases, and assert
  // postconditions that authenticated callers cannot inspect.
  writeFileSync(
    resolve(supabaseDir, 'migrations/999999_phase_03_4_protocol_harness.sql'),
    [
      'grant select, insert, update, delete on table public.jobs to service_role;',
      'grant select, insert, update, delete on table public.deterministic_ranking_state to service_role;',
      'grant select, insert, update, delete on table public.deterministic_ranking_runs to service_role;',
      'grant select, insert, update, delete on table public.deterministic_ranking_items to service_role;',
      'grant execute on function public.is_valid_ranking_breakdown(jsonb) to service_role;',
      '',
    ].join('\n'),
  )
  let config = readFileSync(resolve(supabaseDir, 'config.toml'), 'utf8')
  config = config
    .replace(/^project_id = .*$/m, `project_id = "${projectId}"`)
    .replace(
      /\[db\.seed\][\s\S]*?sql_paths = \[[^\n]*\]/m,
      '[db.seed]\nenabled = false\nsql_paths = []',
    )
  writeFileSync(resolve(supabaseDir, 'config.toml'), config)

  command([
    'start',
    '--workdir',
    workdir,
    '--exclude',
    'analytics,edge-runtime,functions,imgproxy,inbucket,meta,realtime,storage,studio,vector',
  ])
  started = true
  command(['db', 'reset', '--local', '--no-seed', '--workdir', workdir])

  const status = JSON.parse(
    command(['status', '--output', 'json', '--workdir', workdir]),
  )
  const apiUrl = status.API_URL
  const anonKey = status.ANON_KEY
  const serviceKey = status.SERVICE_ROLE_KEY
  assert(
    typeof apiUrl === 'string' && /^http:\/\/127\.0\.0\.1:\d+$/.test(apiUrl),
    'local_api_url_required',
  )
  assert(anonKey && serviceKey, 'local_api_keys_missing')

  const service = apiSession(apiUrl, serviceKey)
  const ownerA = await createUser(apiUrl, serviceKey, anonKey, 1)
  const ownerB = await createUser(apiUrl, serviceKey, anonKey, 2)

  const seededJobs = await service.table('jobs', '', {
    method: 'POST',
    prefer: 'return=representation',
    expected: 201,
    body: [
      {
        source: 'adzuna',
        external_id: `protocol-${process.pid}-1`,
        title: 'Protocol Engineer',
        location: 'Chicago, IL',
        absolute_url: 'https://example.invalid/jobs/1',
        description_text: 'Local protocol fixture.',
        fingerprint: `protocol-${process.pid}-1`,
      },
      {
        source: 'adzuna',
        external_id: `protocol-${process.pid}-2`,
        title: 'Senior Protocol Engineer',
        location: 'Remote, US',
        absolute_url: 'https://example.invalid/jobs/2',
        description_text: 'Second local protocol fixture.',
        fingerprint: `protocol-${process.pid}-2`,
      },
    ],
  })
  assert(seededJobs.length === 2, 'local_jobs_not_seeded')

  const initialSave = await ownerA.session.rpc(
    'save_preferences_and_start_ranking',
    saveBody(),
  )
  const leaseRunId = initialSave[0].run_id
  const claimed = await service.rpc(
    'claim_deterministic_ranking_work',
    { batch_size: 1 },
  )
  assert(claimed.length === 1, 'terminal_lease_claim_missing')
  await service.table(
    'deterministic_ranking_items',
    `id=eq.${claimed[0].item_id}`,
    {
      method: 'PATCH',
      body: {
        status: 'claimed',
        attempts: 3,
        claimed_at: new Date(Date.now() - 10 * 60_000).toISOString(),
      },
      expected: 204,
    },
  )
  await service.rpc('claim_deterministic_ranking_work', { batch_size: 1 })
  const exhausted = await one(
    service,
    'deterministic_ranking_items',
    `id=eq.${claimed[0].item_id}&select=status,error_code`,
  )
  const failedRun = await one(
    service,
    'deterministic_ranking_runs',
    `id=eq.${leaseRunId}&select=status,error_code`,
  )
  const failedState = await one(
    service,
    'deterministic_ranking_state',
    `user_id=eq.${ownerA.id}&select=status,retry_available`,
  )
  assert(
    exhausted.status === 'failed' &&
      failedRun.status === 'failed' &&
      failedState.status === 'failed' &&
      failedState.retry_available === true,
    'terminal_lease_not_failed_retryable',
  )
  const claimedAfterReap = await service.table(
    'deterministic_ranking_items',
    `run_id=eq.${leaseRunId}&status=eq.claimed&select=id`,
  )
  assert(claimedAfterReap.length === 0, 'terminal_lease_left_claimed')
  record('third-attempt lease exhaustion', 5)

  const firstConcurrent = await ownerA.session.rpc(
    'save_preferences_and_start_ranking',
    saveBody('First Protocol Engineer'),
  )
  const oldRunId = firstConcurrent[0].run_id
  const oldClaim = await service.rpc(
    'claim_deterministic_ranking_work',
    { batch_size: 1 },
  )
  const [saveTwo, saveThree] = await Promise.all([
    ownerA.session.rpc(
      'save_preferences_and_start_ranking',
      saveBody('Second Protocol Engineer'),
    ),
    ownerA.session.rpc(
      'save_preferences_and_start_ranking',
      saveBody('Final Protocol Engineer'),
    ),
  ])
  const currentRunId = [saveTwo[0], saveThree[0]]
    .sort((left, right) => Number(left.revision) - Number(right.revision))
    .at(-1).run_id
  const oldItems = await service.table(
    'deterministic_ranking_items',
    `run_id=eq.${oldRunId}&select=status`,
  )
  assert(
    oldItems.every((item) =>
      ['completed', 'failed', 'superseded'].includes(item.status)
    ),
    'superseded_run_has_nonterminal_items',
  )
  const buildingRuns = await service.table(
    'deterministic_ranking_runs',
    `user_id=eq.${ownerA.id}&status=eq.building&select=id`,
  )
  assert(
    buildingRuns.length === 1 && buildingRuns[0].id === currentRunId,
    'concurrent_save_did_not_leave_one_current_run',
  )
  const lateStage = await service.rpc('stage_deterministic_ranking_result', {
    p_item_id: oldClaim[0].item_id,
    p_revision: oldClaim[0].revision,
    p_eligible: false,
    p_score: null,
    p_tier: null,
    p_breakdown: breakdown,
    p_filter_code: 'title_non_overlap',
    p_filter_detail: 'late local fixture',
    p_best_fit_resume_id: null,
    p_runner_up_resume_id: null,
    p_error_code: null,
  })
  assert(lateStage === false, 'late_stage_was_not_rejected')
  record('save-during-claim and repeated concurrent saves', 4)

  await ownerA.session.rpc('request_deterministic_route_refresh')
  await completeRun(service, currentRunId)
  const preservedPreferenceRequest = await one(
    service,
    'deterministic_ranking_state',
    `user_id=eq.${ownerA.id}&select=status,route_refresh_requested_at`,
  )
  assert(
    preservedPreferenceRequest.status === 'idle' &&
      preservedPreferenceRequest.route_refresh_requested_at,
    'preference_finalizer_erased_route_request',
  )
  await service.rpc('enqueue_deterministic_route_refreshes', { batch_size: 25 })
  const routeState = await one(
    service,
    'deterministic_ranking_state',
    `user_id=eq.${ownerA.id}&select=building_run_id,route_refresh_requested_at`,
  )
  assert(
    routeState.building_run_id && routeState.route_refresh_requested_at === null,
    'route_enqueue_did_not_acknowledge_request',
  )
  await ownerA.session.rpc('request_deterministic_route_refresh')
  await completeRun(service, routeState.building_run_id)
  const requestAfterRoute = await one(
    service,
    'deterministic_ranking_state',
    `user_id=eq.${ownerA.id}&select=status,route_refresh_requested_at`,
  )
  assert(
    requestAfterRoute.status === 'idle' &&
      requestAfterRoute.route_refresh_requested_at,
    'route_finalizer_erased_newer_request',
  )
  const routesBeforeFollowup = await service.table(
    'deterministic_ranking_runs',
    `user_id=eq.${ownerA.id}&run_kind=eq.route&select=id`,
  )
  await service.rpc('enqueue_deterministic_route_refreshes', { batch_size: 25 })
  const routesAfterFollowup = await service.table(
    'deterministic_ranking_runs',
    `user_id=eq.${ownerA.id}&run_kind=eq.route&select=id`,
  )
  assert(
    routesAfterFollowup.length === routesBeforeFollowup.length + 1,
    'route_request_did_not_enqueue_exactly_one_followup',
  )
  record('route requests survive preference and route finalization', 5)

  const beforeInsert = await one(
    service,
    'deterministic_ranking_state',
    `user_id=eq.${ownerA.id}&select=route_refresh_requested_at`,
  )
  const resume = await ownerA.session.table('resumes', '', {
    method: 'POST',
    prefer: 'return=representation',
    expected: 201,
    body: {
      filename: 'local-protocol.docx',
      storage_path: `${ownerA.id}/local-protocol.docx`,
      size_bytes: 1,
    },
  })
  const afterInsert = await one(
    service,
    'deterministic_ranking_state',
    `user_id=eq.${ownerA.id}&select=route_refresh_requested_at`,
  )
  assert(
    afterInsert.route_refresh_requested_at !==
      beforeInsert.route_refresh_requested_at,
    'resume_insert_did_not_signal_route_refresh',
  )
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 5))
  await ownerA.session.table('resumes', `id=eq.${resume[0].id}`, {
    method: 'DELETE',
    expected: 204,
  })
  const afterDelete = await one(
    service,
    'deterministic_ranking_state',
    `user_id=eq.${ownerA.id}&select=route_refresh_requested_at`,
  )
  assert(
    afterDelete.route_refresh_requested_at !==
      afterInsert.route_refresh_requested_at,
    'resume_delete_did_not_signal_route_refresh',
  )
  record('transactional resume insert and delete signaling', 2)

  await ownerB.session.rpc(
    'save_preferences_and_start_ranking',
    saveBody('Owner B Protocol Engineer'),
  )
  const ownerAViewOfB = await ownerA.session.table(
    'deterministic_ranking_runs',
    `user_id=eq.${ownerB.id}&select=id`,
  )
  assert(ownerAViewOfB.length === 0, 'cross_owner_run_read_allowed')
  await ownerA.session.table(
    'deterministic_ranking_state',
    `user_id=eq.${ownerB.id}`,
    {
      method: 'PATCH',
      body: { status: 'idle' },
      expected: [401, 403],
    },
  )
  await ownerA.session.table(
    'deterministic_ranking_items',
    'select=id&limit=1',
    { expected: [401, 403] },
  )
  record('authenticated cross-owner isolation', 3)

  process.stdout.write(
    `${JSON.stringify({
      kind: 'phase-03.4-local-protocol',
      runtime: 'disposable-supabase',
      project: 'redacted-local',
      scenarios: results,
      productionCommands: 0,
    })}\n`,
  )
}

try {
  await main()
} finally {
  if (started) {
    try {
      command([
        'stop',
        '--no-backup',
        '--project-id',
        projectId,
        '--workdir',
        workdir,
      ])
    } catch (error) {
      process.stderr.write(`local_cleanup_warning:${error.message}\n`)
    }
  }
  rmSync(workRoot, { recursive: true, force: true })
}

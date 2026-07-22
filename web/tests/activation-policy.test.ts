import { describe, expect, it, vi } from 'vitest'
import { createVerifyBoardHandler } from '../../supabase/functions/verify-board/index.ts'
import verifyBoardSource from '../../supabase/functions/verify-board/index.ts?raw'
import migrationSql from '../../supabase/migrations/0029_paylocity_connector.sql?raw'
import {
  PAYLOCITY_BOARD_UUID,
  PAYLOCITY_SOURCE_KEY,
} from '../../supabase/functions/_shared/provider-identities.ts'

type Provider = 'smartrecruiters' | 'recruitee' | 'paylocity' | 'workday'

interface MirrorState {
  progress: number
  activationState: 'experimental' | 'active'
  observationIds: Set<string>
  windowStarts: Set<number>
}

interface MirrorResult extends MirrorState {
  accepted: boolean
  windowStart: number
  nextEligibleAt: number
  reason: 'accepted' | 'replay' | 'same_window' | 'ineligible' | 'progress_complete'
}

interface MirrorEvidence {
  provider: Provider
  observationId: string
  nowMs: number
  completeness?: 'complete' | 'partial' | 'unknown'
  credibleForClosure?: boolean
  jobCount?: number
  expectedCount?: number
  warningCount?: number
  activationState?: 'experimental' | 'active' | 'disabled'
}

function emptyState(): MirrorState {
  return {
    progress: 0,
    activationState: 'experimental',
    observationIds: new Set(),
    windowStarts: new Set(),
  }
}

// Local pure-contract mirror only. PostgreSQL clock, row-lock, and constraint
// behavior is intentionally deferred to the blocking hosted proof in Plan 07.
function mirrorObservation(state: MirrorState, evidence: MirrorEvidence): MirrorResult {
  const windowMinutes = evidence.provider === 'workday' ? 30 : 10
  const windowMs = windowMinutes * 60_000
  const windowStart = Math.floor(evidence.nowMs / windowMs) * windowMs
  const nextEligibleAt = windowStart + windowMs
  const snapshot = {
    progress: state.progress,
    activationState: state.activationState,
    observationIds: new Set(state.observationIds),
    windowStarts: new Set(state.windowStarts),
  }
  const result = (reason: MirrorResult['reason']): MirrorResult => ({
    ...snapshot,
    accepted: reason === 'accepted',
    windowStart,
    nextEligibleAt,
    reason,
  })

  if (state.progress >= 3) return result('progress_complete')
  if (state.observationIds.has(evidence.observationId)) return result('replay')
  if (state.windowStarts.has(windowStart)) return result('same_window')

  const eligible = evidence.activationState !== 'disabled'
    && evidence.completeness === 'complete'
    && evidence.credibleForClosure === true
    && evidence.warningCount === 0
    && evidence.jobCount !== undefined
    && evidence.expectedCount !== undefined
    && evidence.jobCount === evidence.expectedCount
    && (evidence.provider !== 'paylocity' || evidence.jobCount > 0)
  if (!eligible) return result('ineligible')

  snapshot.observationIds.add(evidence.observationId)
  snapshot.windowStarts.add(windowStart)
  snapshot.progress += 1
  if (
    snapshot.progress === 3
    && (
      evidence.provider === 'smartrecruiters'
      || evidence.provider === 'recruitee'
      || evidence.provider === 'paylocity'
    )
  ) {
    snapshot.activationState = 'active'
  }
  return {
    ...snapshot,
    accepted: true,
    windowStart,
    nextEligibleAt,
    reason: 'accepted',
  }
}

function eligibleEvidence(
  provider: Provider,
  observationId: string,
  nowMs: number,
): MirrorEvidence {
  return {
    provider,
    observationId,
    nowMs,
    completeness: 'complete',
    credibleForClosure: true,
    jobCount: 2,
    expectedCount: 2,
    warningCount: 0,
    activationState: 'experimental',
  }
}

function sqlIndex(pattern: RegExp) {
  const match = migrationSql.match(pattern)
  expect(match, `Expected migration SQL to match ${pattern}`).not.toBeNull()
  return match?.index ?? -1
}

describe('local structural proof for record_connector_observation SQL', () => {
  it('declares a server-time-only service-role RPC and no caller timestamp', () => {
    expect(migrationSql).toMatch(/create or replace function public\.record_connector_observation\s*\(/i)
    expect(migrationSql).not.toMatch(/p_(?:observed_at|window_start|timestamp|now)\b/i)
    expect(migrationSql).toMatch(/clock_timestamp\(\)/i)
    expect(migrationSql).toMatch(/security definer/i)
    expect(migrationSql).toMatch(/set search_path\s*=\s*''/i)
    expect(migrationSql).toMatch(/revoke execute on function public\.record_connector_observation[\s\S]*from public, anon, authenticated/i)
    expect(migrationSql).toMatch(/grant execute on function public\.record_connector_observation[\s\S]*to service_role/i)
  })

  it('retains a closed accepted-evidence provider set with Paylocity and no SuccessFactors', () => {
    expect(migrationSql).toMatch(/alter table public\.connector_observations/i)
    expect(migrationSql).toMatch(/connector_observations_provider_check[\s\S]*provider\s+in\s*\(\s*'smartrecruiters'\s*,\s*'recruitee'\s*,\s*'workday'\s*,\s*'paylocity'\s*\)/i)
    expect(migrationSql).toMatch(/revoke all on table public\.connector_observations from public, anon, authenticated/i)
    expect(migrationSql.toLowerCase()).not.toContain('successfactors')
  })

  it('uses bounded contention and locks only after validating inputs', () => {
    expect(migrationSql).toMatch(/set local lock_timeout\s*=\s*'[^']*(?:ms|second)/i)
    expect(migrationSql).toMatch(/for update/i)
    expect(migrationSql).toMatch(/lock_(?:timeout|not_available)|55P03/i)
    expect(migrationSql).toMatch(/retryable/i)
    expect(migrationSql).not.toMatch(/https?:\/\//i)

    const validation = sqlIndex(/p_completeness\s*<>\s*'complete'/i)
    const lock = sqlIndex(/from public\.companies as c\s+where c\.id = p_company_id\s+for update/i)
    expect(validation).toBeLessThan(lock)
  })

  it('rejects persisted progress at three before every provider ledger insert', () => {
    const progressGuard = sqlIndex(/v_persisted_progress\s*>=\s*3/i)
    const insert = sqlIndex(/insert into public\.connector_observations/i)
    expect(progressGuard).toBeLessThan(insert)
    expect(migrationSql).toMatch(/progress_complete/i)
    expect(migrationSql).toMatch(/(?:provider\s+in|v_provider\s+not in)\s*\(\s*'smartrecruiters'\s*,\s*'recruitee'\s*,\s*'workday'\s*,\s*'paylocity'\s*\)/i)
  })

  it('rejects an empty Paylocity observation before every ledger insert', () => {
    const emptyGuard = sqlIndex(/v_provider\s*=\s*'paylocity'[\s\S]{0,120}p_job_count\s*<=\s*0/i)
    const insert = sqlIndex(/insert into public\.connector_observations/i)
    expect(emptyGuard).toBeLessThan(insert)
  })

  it('returns persisted progress plus server window boundaries and promotes only stable public providers', () => {
    expect(migrationSql).toMatch(/returns table\s*\([\s\S]*progress\s+integer[\s\S]*window_start\s+timestamptz[\s\S]*next_eligible_at\s+timestamptz/i)
    expect(migrationSql).toMatch(/activation_successes\s*=\s*v_progress/i)
    expect(migrationSql).toMatch(/last_verified_at\s*=/i)
    expect(migrationSql).toMatch(/last_observation_count\s*=/i)
    expect(migrationSql).toMatch(/ats_type\s+in\s*\(\s*'smartrecruiters'\s*,\s*'recruitee'\s*,\s*'paylocity'\s*\)/i)
    expect(migrationSql).not.toMatch(/ats_type\s+in\s*\([^)]*'workday'[^)]*\)[\s\S]{0,160}activation_state\s*=\s*'active'/i)
  })

  it('admits only the exact server-owned Paylocity company identity', () => {
    expect(migrationSql).toMatch(/companies_paylocity_identity_check check\s*\([\s\S]*ats_type\s*<>\s*'paylocity'[\s\S]*board_token\s*=\s*'d6628b21-949b-4400-a3d0-c9082bbf3eb1'[\s\S]*region\s+is\s+null[\s\S]*site_token\s+is\s+null[\s\S]*source_key\s*=\s*'paylocity:global:d6628b21-949b-4400-a3d0-c9082bbf3eb1'[\s\S]*activation_state\s+in\s*\(\s*'experimental'\s*,\s*'active'\s*\)/i)
    expect(migrationSql).not.toMatch(/ats_type\s*=\s*'paylocity'[\s\S]{0,220}board_token\s*=\s*source_key/i)
  })

  it('preserves every shipped source while adding Paylocity to the stable claim branch', () => {
    expect(migrationSql).toMatch(/companies_ats_type_check check\s*\([\s\S]*ats_type\s+in\s*\(\s*'greenhouse'\s*,\s*'lever'\s*,\s*'ashby'\s*,\s*'smartrecruiters'\s*,\s*'recruitee'\s*,\s*'workday'\s*,\s*'paylocity'\s*\)/i)
    expect(migrationSql).toMatch(/jobs_source_check check\s*\([\s\S]*source\s+in\s*\(\s*'greenhouse'\s*,\s*'lever'\s*,\s*'ashby'\s*,\s*'smartrecruiters'\s*,\s*'recruitee'\s*,\s*'adzuna'\s*,\s*'workday'\s*,\s*'paylocity'\s*\)/i)
    expect(migrationSql).toMatch(/where activation_state\s*=\s*'active'[\s\S]*ats_type\s+in\s*\(\s*'greenhouse'\s*,\s*'lever'\s*,\s*'ashby'\s*,\s*'smartrecruiters'\s*,\s*'recruitee'\s*,\s*'paylocity'\s*\)/i)
    expect(migrationSql).toMatch(/last_polled_at\s*<\s*now\(\)\s*-\s*interval\s*'9 minutes'/i)
    expect(migrationSql).toMatch(/for update skip locked/i)
    expect(migrationSql).toMatch(/grant execute on function public\.claim_due_companies\(integer\) to service_role/i)
  })
})

describe('local pure-contract mirror for activation windows', () => {
  it('counts three calls in one ten-minute window once and returns the future boundary', () => {
    const first = mirrorObservation(emptyState(), eligibleEvidence('smartrecruiters', 'obs-1', 60_000))
    const second = mirrorObservation(first, eligibleEvidence('smartrecruiters', 'obs-2', 2 * 60_000))
    const third = mirrorObservation(second, eligibleEvidence('smartrecruiters', 'obs-3', 9 * 60_000))

    expect(first).toMatchObject({ accepted: true, progress: 1, windowStart: 0, nextEligibleAt: 600_000 })
    expect(second).toMatchObject({ accepted: false, reason: 'same_window', progress: 1, nextEligibleAt: 600_000 })
    expect(third).toMatchObject({ accepted: false, reason: 'same_window', progress: 1 })
    expect(third.windowStarts.size).toBe(1)
  })

  it('rejects replay independently from same-window and cross-window acceptance', () => {
    const first = mirrorObservation(emptyState(), eligibleEvidence('recruitee', 'obs-1', 0))
    const replay = mirrorObservation(first, eligibleEvidence('recruitee', 'obs-1', 10 * 60_000))
    const crossWindow = mirrorObservation(first, eligibleEvidence('recruitee', 'obs-2', 10 * 60_000))

    expect(replay).toMatchObject({ accepted: false, reason: 'replay', progress: 1 })
    expect(crossWindow).toMatchObject({ accepted: true, progress: 2, windowStart: 600_000 })
  })

  it.each([
    ['partial', { completeness: 'partial' }],
    ['unknown', { completeness: 'unknown' }],
    ['non-credible', { credibleForClosure: false }],
    ['warning-bearing', { warningCount: 1 }],
    ['count-inconsistent', { expectedCount: 3 }],
    ['disabled', { activationState: 'disabled' }],
  ] as const)('rejects %s evidence without ledger or company progress mutation', (_name, override) => {
    const result = mirrorObservation(emptyState(), {
      ...eligibleEvidence('smartrecruiters', 'obs-1', 0),
      ...override,
    } as MirrorEvidence)

    expect(result).toMatchObject({ accepted: false, reason: 'ineligible', progress: 0 })
    expect(result.observationIds.size).toBe(0)
    expect(result.windowStarts.size).toBe(0)
  })

  it.each(['smartrecruiters', 'recruitee', 'paylocity'] as const)(
    'promotes %s only after three separate eligible windows',
    (provider) => {
      const one = mirrorObservation(emptyState(), eligibleEvidence(provider, 'obs-1', 0))
      const two = mirrorObservation(one, eligibleEvidence(provider, 'obs-2', 10 * 60_000))
      const three = mirrorObservation(two, eligibleEvidence(provider, 'obs-3', 20 * 60_000))
      expect(one.activationState).toBe('experimental')
      expect(two.activationState).toBe('experimental')
      expect(three).toMatchObject({ accepted: true, progress: 3, activationState: 'active' })
    },
  )

  it('does not let an empty Paylocity snapshot earn activation progress', () => {
    const result = mirrorObservation(emptyState(), {
      ...eligibleEvidence('paylocity', 'obs-empty', 0),
      jobCount: 0,
      expectedCount: 0,
    })

    expect(result).toMatchObject({ accepted: false, reason: 'ineligible', progress: 0 })
  })

  it('lets Workday reach exactly three thirty-minute windows but rejects the fourth with no mutation', () => {
    const one = mirrorObservation(emptyState(), eligibleEvidence('workday', 'obs-1', 0))
    const two = mirrorObservation(one, eligibleEvidence('workday', 'obs-2', 30 * 60_000))
    const three = mirrorObservation(two, eligibleEvidence('workday', 'obs-3', 60 * 60_000))
    const four = mirrorObservation(three, eligibleEvidence('workday', 'obs-4', 90 * 60_000))

    expect(three).toMatchObject({ accepted: true, progress: 3, activationState: 'experimental' })
    expect(four).toMatchObject({ accepted: false, reason: 'progress_complete', progress: 3, activationState: 'experimental' })
    expect(four.observationIds).toEqual(three.observationIds)
    expect(four.windowStarts).toEqual(three.windowStarts)
  })

  it.each(['smartrecruiters', 'recruitee'] as const)(
    'rejects a fourth %s window after promotion with no post-cap mutation',
    (provider) => {
      const one = mirrorObservation(emptyState(), eligibleEvidence(provider, 'obs-1', 0))
      const two = mirrorObservation(one, eligibleEvidence(provider, 'obs-2', 10 * 60_000))
      const three = mirrorObservation(two, eligibleEvidence(provider, 'obs-3', 20 * 60_000))
      const four = mirrorObservation(three, eligibleEvidence(provider, 'obs-4', 30 * 60_000))
      expect(four).toMatchObject({ accepted: false, reason: 'progress_complete', progress: 3, activationState: 'active' })
      expect(four.observationIds).toEqual(three.observationIds)
      expect(four.windowStarts).toEqual(three.windowStarts)
    },
  )
})

const smartPosting = {
  id: 'sr-activation-1',
  name: 'Platform Engineer',
  releasedDate: '2026-07-17T12:00:00Z',
  ref: 'https://jobs.smartrecruiters.com/SmartRecruiters/sr-activation-1',
  location: { city: 'Chicago', region: 'Illinois', country: 'US' },
  company: { name: 'SmartRecruiters' },
  jobAd: { sections: { jobDescription: { text: '<p>Build hiring software.</p>' } } },
}

const publicCompany = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'SmartRecruiters',
  ats_type: 'smartrecruiters',
  board_token: 'SmartRecruiters',
  region: null,
  careers_url: 'https://jobs.smartrecruiters.com/SmartRecruiters',
  source_key: 'smartrecruiters:global:SmartRecruiters',
  site_token: null,
  activation_state: 'experimental',
  activation_successes: 1,
  last_verified_at: '2026-07-18T01:10:00.000Z',
  last_polled_at: null,
  last_success_at: null,
  consecutive_failures: 0,
  last_error: null,
  last_error_code: null,
  last_observation_count: 1,
  created_at: '2026-07-18T01:00:00.000Z',
}

const paylocityBoardUrl =
  `https://recruiting.paylocity.com/recruiting/jobs/All/${PAYLOCITY_BOARD_UUID}/The-Only-Facial`
const paylocityJob = {
  jobId: 301,
  jobTitle: 'Client Experience Analyst',
  companyName: 'The Only Facial',
  location: 'Chicago, IL',
  description: '<p>Analyze client experience.</p>',
  requirements: '<p>SQL and communication.</p>',
  jobUrl: 'https://recruiting.paylocity.com/recruiting/jobs/Details/301',
  applyUrl: 'https://recruiting.paylocity.com/recruiting/jobs/Apply/301',
  listUrl: paylocityBoardUrl,
  publishedDate: '2026-07-21T12:00:00Z',
}
const paylocityCompany = {
  ...publicCompany,
  name: 'The Only Facial',
  ats_type: 'paylocity',
  board_token: PAYLOCITY_BOARD_UUID,
  careers_url: paylocityBoardUrl,
  source_key: PAYLOCITY_SOURCE_KEY,
}

function verifyRequest(
  token = 'real-user-token',
  extraBody: Record<string, unknown> = {},
) {
  return new Request('https://example.test/functions/v1/verify-board', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      url: 'https://jobs.smartrecruiters.com/SmartRecruiters',
      ...extraBody,
    }),
  })
}

function activationHarness(options: {
  duplicate?: boolean
  rpcRow?: Partial<ActivationResult>
  providerFetch?: ReturnType<typeof vi.fn>
  provider?: 'smartrecruiters' | 'paylocity'
} = {}) {
  const getUser = vi.fn().mockResolvedValue({
    data: { user: { id: 'user-1', role: 'authenticated' } },
    error: null,
  })
  const createAuthClient = vi.fn(() => ({ auth: { getUser } }))
  const baseCompany = options.provider === 'paylocity' ? paylocityCompany : publicCompany
  const persistedCompany = {
    ...baseCompany,
    activation_successes: options.rpcRow?.progress ?? 1,
    activation_state: options.rpcRow?.result_activation_state ?? 'experimental',
  }
  const single = vi.fn().mockResolvedValue(options.duplicate
    ? { data: null, error: { code: '23505' } }
    : { data: { ...baseCompany, activation_successes: 0 }, error: null })
  const insertSelect = vi.fn(() => ({ single }))
  const insert = vi.fn(() => ({ select: insertSelect }))
  const maybeSingle = vi.fn().mockResolvedValue({ data: persistedCompany, error: null })
  const eqSelect = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq: eqSelect }))
  const updateEq = vi.fn().mockResolvedValue({ error: null })
  const update = vi.fn(() => ({ eq: updateEq }))
  const from = vi.fn(() => ({ insert, select, update }))
  const rpcRow: ActivationResult = {
    accepted: true,
    reason: 'accepted',
    progress: 1,
    window_start: '2026-07-18T01:10:00.000Z',
    next_eligible_at: '2026-07-18T01:20:00.000Z',
    result_activation_state: 'experimental',
    ...options.rpcRow,
  }
  const rpc = vi.fn().mockResolvedValue({ data: [rpcRow], error: null })
  const createServiceClient = vi.fn(() => ({ from, rpc }))
  const providerFetch = options.providerFetch ?? vi.fn().mockResolvedValue(Response.json(
    options.provider === 'paylocity'
      ? { displayName: 'The Only Facial', jobs: [paylocityJob] }
      : { totalFound: 1, content: [smartPosting] },
    { headers: { 'content-type': 'application/json' } },
  ))
  const handler = createVerifyBoardHandler({
    createAuthClient,
    createServiceClient,
    providerFetch,
    randomUUID: () => '22222222-2222-4222-8222-222222222222',
    digestEvidence: async () => 'a'.repeat(64),
  })

  return {
    handler,
    getUser,
    createServiceClient,
    providerFetch,
    insert,
    select,
    update,
    updateEq,
    rpc,
  }
}

describe('verify-board real-user activation boundary', () => {
  it('derives eligible evidence on the server and ignores spoofed activation inputs', async () => {
    const h = activationHarness()
    const response = await h.handler(verifyRequest('real-user-token', {
      observed_at: '2099-01-01T00:00:00Z',
      observation_id: '33333333-3333-4333-8333-333333333333',
      credible_for_closure: false,
      activation_target: 'active',
    }))

    expect(response.status).toBe(200)
    expect(h.getUser).toHaveBeenCalledWith('real-user-token')
    expect(h.rpc).toHaveBeenCalledTimes(1)
    expect(h.rpc).toHaveBeenCalledWith('record_connector_observation', {
      p_company_id: publicCompany.id,
      p_observation_id: '22222222-2222-4222-8222-222222222222',
      p_completeness: 'complete',
      p_credible_for_closure: true,
      p_job_count: 1,
      p_expected_count: 1,
      p_warning_count: 0,
      p_evidence_digest: 'a'.repeat(64),
    })
    const args = h.rpc.mock.calls[0]?.[1]
    expect(args).not.toHaveProperty('observed_at')
    expect(args).not.toHaveProperty('window_start')
    expect(args).not.toHaveProperty('activation_target')
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      already_watched: false,
      company: { activation_successes: 1, activation_state: 'experimental' },
      activation: {
        accepted: true,
        progress: 1,
        window_start: '2026-07-18T01:10:00.000Z',
        next_eligible_at: '2026-07-18T01:20:00.000Z',
      },
    })
  })

  it('surfaces same-window no-progress and the future server eligibility boundary', async () => {
    const h = activationHarness({
      duplicate: true,
      rpcRow: {
        accepted: false,
        reason: 'same_window',
        progress: 1,
        next_eligible_at: '2026-07-18T01:20:00.000Z',
      },
    })
    const response = await h.handler(verifyRequest())

    expect(h.rpc).toHaveBeenCalledTimes(1)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      already_watched: true,
      company: { activation_successes: 1 },
      activation: {
        accepted: false,
        reason: 'same_window',
        progress: 1,
        next_eligible_at: '2026-07-18T01:20:00.000Z',
      },
    })
  })

  it.each([
    ['anon token', { data: { user: null }, error: { message: 'not a user' } }, 401],
    ['service token', { data: { user: { id: 'service', role: 'service_role' } }, error: null }, 403],
  ] as const)('lets no %s reach provider, service client, or activation RPC', async (_name, resolution, status) => {
    const h = activationHarness()
    h.getUser.mockResolvedValue(resolution as never)

    const response = await h.handler(verifyRequest('untrusted-token'))

    expect(response.status).toBe(status)
    expect(h.providerFetch).not.toHaveBeenCalled()
    expect(h.createServiceClient).not.toHaveBeenCalled()
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('records bounded health for partial evidence but never invokes activation', async () => {
    const providerFetch = vi.fn()
      .mockResolvedValueOnce(Response.json({
        totalFound: 2,
        content: [smartPosting],
      }, { headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(Response.json({
        totalFound: 2,
        content: [],
      }, { headers: { 'content-type': 'application/json' } }))
    const h = activationHarness({ providerFetch })

    const response = await h.handler(verifyRequest())

    expect(response.status).toBe(200)
    expect(h.update).toHaveBeenCalledWith({
      last_error: 'Manual verification failed.',
      last_error_code: 'count_mismatch',
    })
    expect(h.updateEq).toHaveBeenCalledWith(
      'source_key',
      'smartrecruiters:global:SmartRecruiters',
    )
    expect(h.rpc).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({ ok: false, reason: 'error' })
  })

  it('keeps the real-user check textually ahead of every handler service-role transition', () => {
    const getUser = verifyBoardSource.indexOf('.auth.getUser(token)')
    const role = verifyBoardSource.indexOf("role !== 'authenticated'")
    const service = verifyBoardSource.indexOf('dependencies.createServiceClient()')
    expect(getUser).toBeGreaterThan(-1)
    expect(getUser).toBeLessThan(role)
    expect(role).toBeLessThan(service)
    expect(verifyBoardSource).toContain("service.rpc('record_connector_observation'")
  })

  it('stages exact Paylocity identity and records only server-derived evidence', async () => {
    const h = activationHarness({ provider: 'paylocity' })
    const response = await h.handler(verifyRequest('real-user-token', {
      url: paylocityBoardUrl,
      board_token: 'forged-board',
      source_key: 'paylocity:global:forged',
      provider_key: 'forged-feed-key',
      observed_at: '2099-01-01T00:00:00Z',
      activation_target: 'active',
    }))

    expect(response.status).toBe(200)
    expect(h.insert).toHaveBeenCalledWith(expect.objectContaining({
      name: 'The Only Facial',
      ats_type: 'paylocity',
      board_token: PAYLOCITY_BOARD_UUID,
      region: null,
      careers_url: paylocityBoardUrl,
      source_key: PAYLOCITY_SOURCE_KEY,
      site_token: null,
      activation_state: 'experimental',
    }))
    expect(h.rpc).toHaveBeenCalledWith('record_connector_observation', {
      p_company_id: paylocityCompany.id,
      p_observation_id: '22222222-2222-4222-8222-222222222222',
      p_completeness: 'complete',
      p_credible_for_closure: true,
      p_job_count: 1,
      p_expected_count: 1,
      p_warning_count: 0,
      p_evidence_digest: 'a'.repeat(64),
    })
    const rpcArgs = h.rpc.mock.calls[0]?.[1]
    expect(rpcArgs).not.toHaveProperty('provider_key')
    expect(rpcArgs).not.toHaveProperty('observed_at')
    expect(rpcArgs).not.toHaveProperty('activation_target')
  })

  it('resumes duplicate Paylocity evidence on its exact existing company row', async () => {
    const h = activationHarness({ provider: 'paylocity', duplicate: true })
    const response = await h.handler(verifyRequest('real-user-token', { url: paylocityBoardUrl }))

    expect(h.select).toHaveBeenCalled()
    expect(h.rpc).toHaveBeenCalledTimes(1)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      already_watched: true,
      company: { source_key: PAYLOCITY_SOURCE_KEY },
      activation: { accepted: true, progress: 1 },
    })
  })

  it('records bounded Paylocity drift without activation or cross-identity mutation', async () => {
    const providerFetch = vi.fn().mockResolvedValue(Response.json({
      displayName: 'Other Employer',
      jobs: [paylocityJob],
    }, { headers: { 'content-type': 'application/json' } }))
    const h = activationHarness({ provider: 'paylocity', providerFetch })
    const response = await h.handler(verifyRequest('real-user-token', { url: paylocityBoardUrl }))

    expect(response.status).toBe(200)
    expect(h.update).toHaveBeenCalledWith({
      last_error: 'Manual verification failed.',
      last_error_code: 'identity_drift',
    })
    expect(h.updateEq).toHaveBeenCalledWith('source_key', PAYLOCITY_SOURCE_KEY)
    expect(h.rpc).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({ ok: false, reason: 'error' })
  })

  it('rejects Paylocity auth before provider, service client, or activation work', async () => {
    const h = activationHarness({ provider: 'paylocity' })
    h.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'not a user' } } as never)

    const response = await h.handler(verifyRequest('untrusted-token', { url: paylocityBoardUrl }))

    expect(response.status).toBe(401)
    expect(h.providerFetch).not.toHaveBeenCalled()
    expect(h.createServiceClient).not.toHaveBeenCalled()
    expect(h.rpc).not.toHaveBeenCalled()
  })
})

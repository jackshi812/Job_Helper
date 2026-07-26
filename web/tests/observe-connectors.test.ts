import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  createObserveConnectorsHandler,
} from '../../supabase/functions/observe-connectors/index'
import type { PollObservation } from '../../supabase/functions/_shared/adapters/types'

const functionSource = readFileSync(fileURLToPath(new URL(
  '../../supabase/functions/observe-connectors/index.ts',
  import.meta.url,
)), 'utf8')
const configSource = readFileSync(fileURLToPath(new URL(
  '../../supabase/config.toml',
  import.meta.url,
)), 'utf8')

const companies = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Morgan Stanley',
    ats_type: 'eightfold',
    board_token: 'eightfold:morganstanley',
    region: null,
    site_token: null,
    source_key: 'eightfold:morganstanley',
    activation_state: 'experimental',
    consecutive_failures: 0,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'JPMorgan Chase',
    ats_type: 'oracle_recruiting',
    board_token: 'oracle:jpmc:CX_1001',
    region: null,
    site_token: null,
    source_key: 'oracle:jpmc:CX_1001',
    activation_state: 'experimental',
    consecutive_failures: 1,
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Goldman Sachs',
    ats_type: 'goldman_higher',
    board_token: 'goldman_higher:roles',
    region: null,
    site_token: null,
    source_key: 'goldman_higher:roles',
    activation_state: 'experimental',
    consecutive_failures: 2,
  },
]

function positiveObservation(): PollObservation {
  return {
    jobs: [{
      source: 'eightfold',
      externalId: 'ms-1',
      title: 'Data Engineer',
      location: 'New York, NY',
      absoluteUrl: 'https://morganstanley.eightfold.ai/careers/job/ms-1',
      postedAt: null,
      descriptionHtml: '<p>Build data systems.</p>',
      descriptionText: 'Build data systems.',
      snapshotPartial: false,
      companyName: 'Morgan Stanley',
      scopeEvidence: {
        sourceKey: 'eightfold:morganstanley',
        providerCategoryLabel: 'data analytics',
        matchedTerm: 'Data',
        detailCountryCode: 'US',
        externalIdDigest: 'a'.repeat(64),
      },
    }],
    completeness: 'complete',
    credibleForClosure: true,
    allowMissingClosure: true,
    pageCount: 1,
    expectedCount: 1,
    warnings: [],
    scopeEvidence: {
      sourceKey: 'eightfold:morganstanley',
      sliceDigests: ['b'.repeat(64)],
      categoryDigest: 'c'.repeat(64),
      countryDigest: 'd'.repeat(64),
    },
  }
}

function harness() {
  const rpc = vi.fn(async (name: string) => {
    if (name === 'claim_due_experimental_connectors') {
      return { data: companies, error: null }
    }
    return {
      data: [{
        accepted: true,
        reason: 'accepted',
        progress: 1,
        window_start: '2026-07-26T00:00:00.000Z',
        next_eligible_at: '2026-07-27T00:00:00.000Z',
        result_activation_state: 'experimental',
      }],
      error: null,
    }
  })
  const updateEq = vi.fn().mockResolvedValue({ error: null })
  const update = vi.fn(() => ({ eq: updateEq }))
  const from = vi.fn((table: string) => {
    if (table !== 'companies') throw new Error(`unexpected_table:${table}`)
    return { update }
  })
  const createServiceClient = vi.fn(() => ({ rpc, from }))
  const observeCompany = vi.fn(async (company: typeof companies[number]) => {
    if (company.id === companies[0].id) return positiveObservation()
    if (company.id === companies[1].id) {
      return {
        jobs: [],
        completeness: 'partial',
        credibleForClosure: false,
        allowMissingClosure: false,
        pageCount: 1,
        expectedCount: 1,
        warnings: ['count_mismatch'],
      } satisfies PollObservation
    }
    throw new Error('private upstream payload')
  })
  const digestEvidence = vi.fn().mockResolvedValue('e'.repeat(64))
  const handler = createObserveConnectorsHandler({
    getCronSecret: vi.fn(() => 'cron-secret'),
    createServiceClient,
    observeCompany,
    digestEvidence,
    randomUUID: () => '44444444-4444-4444-8444-444444444444',
  })
  return {
    handler,
    rpc,
    from,
    update,
    updateEq,
    createServiceClient,
    observeCompany,
    digestEvidence,
  }
}

function request(method = 'POST', secret = 'cron-secret', body: unknown = undefined) {
  return new Request('https://example.test/functions/v1/observe-connectors', {
    method,
    headers: {
      'x-cron-secret': secret,
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

describe('observe-connectors cron-only Experimental lane', () => {
  it('rejects method and auth before admin or provider work', async () => {
    for (const req of [request('GET'), request('POST', 'wrong-secret')]) {
      const h = harness()
      const response = await h.handler(req)

      expect([401, 405]).toContain(response.status)
      expect(h.createServiceClient).not.toHaveBeenCalled()
      expect(h.observeCompany).not.toHaveBeenCalled()
      expect(h.rpc).not.toHaveBeenCalled()
      expect(h.from).not.toHaveBeenCalled()
    }
  })

  it('settles companies independently and records only positive server evidence', async () => {
    const h = harness()
    const response = await h.handler(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      claimed: 3,
      recorded: 1,
      degraded: 2,
    })
    expect(h.observeCompany).toHaveBeenCalledTimes(3)
    expect(h.rpc).toHaveBeenCalledWith('claim_due_experimental_connectors', {
      batch_size: 3,
    })
    const observationCalls = h.rpc.mock.calls.filter(
      ([name]) => name === 'record_connector_observation',
    )
    expect(observationCalls).toHaveLength(1)
    expect(observationCalls[0]?.[1]).toEqual({
      p_company_id: companies[0].id,
      p_observation_id: '44444444-4444-4444-8444-444444444444',
      p_completeness: 'complete',
      p_credible_for_closure: true,
      p_job_count: 1,
      p_expected_count: 1,
      p_warning_count: 0,
      p_evidence_digest: 'e'.repeat(64),
    })
    expect(h.digestEvidence).toHaveBeenCalledTimes(1)
    expect(h.update).toHaveBeenCalledTimes(2)
    expect(h.from).toHaveBeenCalledWith('companies')
  })

  it('accepts complete selective Workday proof without granting closure authority', async () => {
    const company = {
      id: '55555555-5555-4555-8555-555555555555',
      name: 'Bank of America',
      ats_type: 'workday',
      board_token: 'ghr',
      region: 'wd1',
      site_token: 'Lateral-US',
      source_key: 'workday:wd1:ghr:Lateral-US',
      activation_state: 'experimental',
      consecutive_failures: 0,
    }
    const rpc = vi.fn(async (name: string) => ({
      data: name === 'claim_due_experimental_connectors'
        ? [company]
        : [{ accepted: true }],
      error: null,
    }))
    const handler = createObserveConnectorsHandler({
      getCronSecret: () => 'cron-secret',
      createServiceClient: () => ({
        rpc,
        from: () => ({
          update: () => ({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }),
      }),
      observeCompany: async () => ({
        jobs: [{
          source: 'workday',
          externalId: '26000001',
          title: 'Finance Analyst',
          location: 'Charlotte, NC',
          absoluteUrl: 'https://ghr.wd1.myworkdayjobs.com/job/example',
          postedAt: '2026-07-26T00:00:00.000Z',
          descriptionHtml: '<p>Finance role.</p>',
          descriptionText: 'Finance role.',
          snapshotPartial: false,
          companyName: 'Bank of America',
          scopeEvidence: {
            sourceKey: company.source_key,
            detailCountryCode: 'US',
            selectionMode: 'recent_exact_us',
            recentDays: 7,
            titleKeywords: ['finance', 'analytics', 'data', 'research'],
            providerFacetLabels: [],
          },
        }],
        completeness: 'complete',
        credibleForClosure: true,
        allowMissingClosure: false,
        pageCount: 95,
        expectedCount: 1,
        warnings: [],
      }),
      digestEvidence: async () => 'f'.repeat(64),
      randomUUID: () => '66666666-6666-4666-8666-666666666666',
    })

    const response = await handler(request())
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      claimed: 1,
      recorded: 1,
      degraded: 0,
    })
    expect(rpc).toHaveBeenCalledWith(
      'record_connector_observation',
      expect.objectContaining({
        p_company_id: company.id,
        p_job_count: 1,
        p_expected_count: 1,
      }),
    )
  })

  it('accepts exact JPMorgan proof only with rolling-window closure disabled', async () => {
    const company = companies[1]
    const rpc = vi.fn(async (name: string) => ({
      data: name === 'claim_due_experimental_connectors'
        ? [company]
        : [{ accepted: true }],
      error: null,
    }))
    const oracleObservation = (allowMissingClosure: boolean): PollObservation => ({
      jobs: [{
        source: 'oracle_recruiting',
        externalId: '210000001',
        title: 'Finance Analyst',
        location: 'New York, NY, United States',
        absoluteUrl: 'https://jpmc.fa.oraclecloud.com/job/210000001',
        postedAt: '2026-07-26T00:00:00.000Z',
        descriptionHtml: '<p>Finance role.</p>',
        descriptionText: 'Finance role.',
        snapshotPartial: false,
        companyName: 'JPMorgan Chase',
        scopeEvidence: {
          sourceKey: 'oracle:jpmc:CX_1001',
          providerCategoryLabel: 'finance',
          matchedTerm: 'Finance',
          detailCountryCode: 'US',
          externalIdDigest: 'a'.repeat(64),
        },
      }],
      completeness: 'complete',
      credibleForClosure: true,
      allowMissingClosure,
      pageCount: 6,
      expectedCount: 1,
      warnings: [],
      scopeEvidence: {
        sourceKey: 'oracle:jpmc:CX_1001',
        sliceDigests: Array.from({ length: 6 }, () => 'b'.repeat(64)),
        categoryDigest: 'c'.repeat(64),
        countryDigest: 'd'.repeat(64),
      },
    })
    const degraded = vi.fn().mockResolvedValue({ error: null })
    let closureAllowed = false
    const handler = createObserveConnectorsHandler({
      getCronSecret: () => 'cron-secret',
      createServiceClient: () => ({
        rpc,
        from: () => ({ update: () => ({ eq: degraded }) }),
      }),
      observeCompany: async () => oracleObservation(closureAllowed),
      digestEvidence: async () => 'e'.repeat(64),
      randomUUID: () => '77777777-7777-4777-8777-777777777777',
    })

    const accepted = await handler(request())
    await expect(accepted.json()).resolves.toMatchObject({ recorded: 1, degraded: 0 })

    closureAllowed = true
    const rejected = await handler(request())
    await expect(rejected.json()).resolves.toMatchObject({ recorded: 0, degraded: 1 })
  })

  it('ignores request-body network, identity, time, digest, and activation fields', async () => {
    const h = harness()
    const response = await h.handler(request('POST', 'cron-secret', {
      source_key: 'eightfold:attacker',
      url: 'https://attacker.example/jobs',
      provider_payload: { jobs: [{ id: 'evil' }] },
      observation_time: '2099-01-01T00:00:00.000Z',
      evidence_digest: 'attacker',
      activation_state: 'active',
    }))

    expect(response.status).toBe(200)
    expect(h.rpc).toHaveBeenCalledWith('claim_due_experimental_connectors', {
      batch_size: 3,
    })
    expect(h.observeCompany.mock.calls.map(([company]) => company.source_key)).toEqual(
      companies.map((company) => company.source_key),
    )
  })

  it('has no production-job mutation path and disables gateway JWT verification', () => {
    expect(functionSource).not.toMatch(/\.from\(\s*['"]jobs['"]\s*\)/)
    expect(functionSource).not.toMatch(/\b(insert|upsert|delete)\s*\(/)
    expect(configSource).toMatch(/\[functions\.observe-connectors\]\s+verify_jwt = false/)
  })
})

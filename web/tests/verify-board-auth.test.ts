import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createVerifyBoardHandler } from '../../supabase/functions/verify-board/index.ts'

const userA = { id: 'user-a', role: 'authenticated' }
const userB = { id: 'user-b', role: 'authenticated' }
const savedCompany = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Acme',
  ats_type: 'greenhouse',
  board_token: 'acme',
  region: null,
  careers_url: 'https://job-boards.greenhouse.io/acme',
  source_key: 'greenhouse:global:acme',
  site_token: null,
  activation_state: 'active',
  activation_successes: 0,
  last_verified_at: '2026-07-18T00:00:00.000Z',
  last_polled_at: null,
  last_success_at: null,
  consecutive_failures: 0,
  last_error: null,
  last_error_code: null,
  last_observation_count: 1,
  created_at: '2026-07-18T00:00:00.000Z',
}

function request(token = 'real-user-token') {
  return new Request('https://example.test/functions/v1/verify-board', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ url: 'https://job-boards.greenhouse.io/acme' }),
  })
}

function harness() {
  const getUser = vi.fn().mockResolvedValue({ data: { user: userA }, error: null })
  const createAuthClient = vi.fn(() => ({ auth: { getUser } }))
  const single = vi.fn().mockResolvedValue({ data: savedCompany, error: null })
  const select = vi.fn(() => ({ single }))
  const insert = vi.fn(() => ({ select }))
  const from = vi.fn(() => ({ insert }))
  const rpc = vi.fn()
  const createServiceClient = vi.fn(() => ({ from, rpc }))
  const providerFetch = vi.fn().mockImplementation(async () => Response.json({
    jobs: [{ company_name: 'Acme' }],
    meta: { total: 1 },
  }))
  const handler = createVerifyBoardHandler({
    createAuthClient,
    createServiceClient,
    providerFetch,
    now: () => new Date('2026-07-18T00:00:00.000Z'),
  })

  return {
    handler,
    getUser,
    createAuthClient,
    createServiceClient,
    providerFetch,
    from,
    insert,
    rpc,
    single,
  }
}

async function expectRejectedBeforePrivileges(
  h: ReturnType<typeof harness>,
  req: Request,
  expectedStatus: 401 | 403,
) {
  const response = await h.handler(req)

  expect(response.status).toBe(expectedStatus)
  expect(response.headers.get('x-job-copilot-auth-stage')).toBe('rejected')
  expect(response.headers.get('x-job-copilot-provider-fetch-count')).toBe('0')
  expect(h.providerFetch).not.toHaveBeenCalled()
  expect(h.createServiceClient).not.toHaveBeenCalled()
  expect(h.from).not.toHaveBeenCalled()
  expect(h.insert).not.toHaveBeenCalled()
  expect(h.rpc).not.toHaveBeenCalled()
}

describe('verify-board authorization boundary', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects a missing or malformed bearer before resolving a user', async () => {
    for (const headers of [{}, { authorization: 'Basic malformed-token' }]) {
      const h = harness()
      const req = new Request('https://example.test/functions/v1/verify-board', {
        method: 'POST',
        headers,
        body: JSON.stringify({ url: 'https://job-boards.greenhouse.io/acme' }),
      })

      await expectRejectedBeforePrivileges(h, req, 401)
      expect(h.createAuthClient).not.toHaveBeenCalled()
      expect(h.getUser).not.toHaveBeenCalled()
    }
  })

  it.each([
    ['public anon-key JWT', { data: { user: null }, error: { message: 'not a user' } }, 401],
    ['service-role JWT', { data: { user: { id: 'service', role: 'service_role' } }, error: null }, 403],
    ['expired JWT', { data: { user: null }, error: { message: 'expired' } }, 401],
  ] as const)('rejects %s before fetch, privileged creation, mutation, or RPC', async (_name, resolution, status) => {
    const h = harness()
    h.getUser.mockResolvedValue(resolution as never)

    await expectRejectedBeforePrivileges(h, request('untrusted-token'), status)
    expect(h.getUser).toHaveBeenCalledWith('untrusted-token')
  })

  it('fails closed when the user resolver throws', async () => {
    const h = harness()
    h.getUser.mockRejectedValue(new Error('auth unavailable'))

    await expectRejectedBeforePrivileges(h, request(), 401)
  })

  it('lets a real authenticated user reach one controlled provider call and one server write', async () => {
    const h = harness()
    const response = await h.handler(request())

    expect(response.status).toBe(200)
    expect(response.headers.get('x-job-copilot-auth-stage')).toBe('verified')
    expect(response.headers.get('x-job-copilot-provider-fetch-count')).toBe('1')
    expect(h.getUser).toHaveBeenCalledWith('real-user-token')
    expect(h.providerFetch).toHaveBeenCalledTimes(1)
    expect(h.createServiceClient).toHaveBeenCalledTimes(1)
    expect(h.insert).toHaveBeenCalledTimes(1)
    expect(h.rpc).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      company: savedCompany,
      already_watched: false,
    })
  })

  it('keeps the shared watchlist user-independent while duplicate add is stable and non-overwriting', async () => {
    const h = harness()
    h.getUser
      .mockResolvedValueOnce({ data: { user: userA }, error: null })
      .mockResolvedValueOnce({ data: { user: userB }, error: null })
    h.single
      .mockResolvedValueOnce({ data: savedCompany, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: '23505' } })

    const first = await h.handler(request('user-a-token'))
    const second = await h.handler(request('user-b-token'))

    expect(first.status).toBe(200)
    expect(second.status).toBe(409)
    await expect(second.json()).resolves.toEqual({
      ok: false,
      reason: 'already_watched',
      message: 'Acme is already on the watchlist.',
    })
    expect(h.insert).toHaveBeenCalledTimes(2)
    expect(h.insert.mock.calls[0]?.[0]).not.toHaveProperty('user_id')
    expect(h.insert.mock.calls[1]?.[0]).not.toHaveProperty('user_id')
    expect(h.rpc).not.toHaveBeenCalled()
  })
})

describe('connector-state SQL ownership', () => {
  const migration = readFileSync(fileURLToPath(new URL(
    '../../supabase/migrations/0012_connector_state.sql',
    import.meta.url,
  )), 'utf8')

  it('revokes browser insert/update and removes obsolete authority policies', () => {
    expect(migration).toMatch(/drop policy if exists "companies_insert_shared"/i)
    expect(migration).toMatch(/drop policy if exists "companies_update_shared"/i)
    expect(migration).toMatch(/revoke insert, update on table public\.companies from authenticated/i)
    expect(migration).toMatch(/grant select, delete on table public\.companies to authenticated/i)
  })

  it('claims only active connectors while retaining the nine-minute due threshold', () => {
    expect(migration).toMatch(/where activation_state = 'active'/i)
    expect(migration).toMatch(/last_polled_at < now\(\) - interval '9 minutes'/i)
    expect(migration).toMatch(/for update skip locked/i)
  })
})

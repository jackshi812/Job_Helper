import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UNSUPPORTED_URL_MESSAGE } from '../../../supabase/functions/_shared/detect'
import {
  addCompany,
  COMPANY_COLUMNS,
  deriveHealth,
  type CompanyRecord,
} from './watchlist'
import { supabase } from './supabase'

vi.mock('./supabase', () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    from: vi.fn(),
  },
}))

const now = new Date('2026-07-16T12:00:00.000Z')

function company(overrides: Partial<CompanyRecord> = {}): CompanyRecord {
  return {
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
    last_verified_at: now.toISOString(),
    last_error_code: null,
    last_observation_count: 3,
    last_polled_at: now.toISOString(),
    last_success_at: new Date(now.getTime() - 10 * 60_000).toISOString(),
    consecutive_failures: 0,
    last_error: null,
    created_at: now.toISOString(),
    ...overrides,
  }
}

describe('deriveHealth', () => {
  it('is OK after two failures when the last success is fresh', () => {
    expect(deriveHealth(company({ consecutive_failures: 2 }), now)).toBe('ok')
  })

  it('is failing at three consecutive failures even when the last success is fresh', () => {
    expect(deriveHealth(company({ consecutive_failures: 3 }), now)).toBe('failing')
  })

  it('is OK 29 minutes after the last successful poll', () => {
    const last_success_at = new Date(now.getTime() - 29 * 60_000).toISOString()
    expect(deriveHealth(company({ last_success_at }), now)).toBe('ok')
  })

  it('is stale 31 minutes after the last successful poll', () => {
    const last_success_at = new Date(now.getTime() - 31 * 60_000).toISOString()
    expect(deriveHealth(company({ last_success_at }), now)).toBe('stale')
  })

  it('is stale when the board has never succeeded', () => {
    expect(deriveHealth(company({ last_success_at: null }), now)).toBe('stale')
  })
})

describe('addCompany', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects an unsupported URL before making a network call', async () => {
    await expect(addCompany('https://careers.example.com/jobs')).rejects.toThrow(
      UNSUPPORTED_URL_MESSAGE,
    )
    expect(supabase.functions.invoke).not.toHaveBeenCalled()
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('surfaces the verification message without inserting when the board is rejected', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: {
        ok: false,
        reason: 'not_found',
        message: 'Check the address and try again.',
      },
      error: null,
    } as never)

    await expect(addCompany('https://boards.greenhouse.io/not-real')).rejects.toThrow(
      'Check the address and try again.',
    )
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('returns the server-written company without a browser insert', async () => {
    const saved = company()
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: { ok: true, company: saved, already_watched: false },
      error: null,
    } as never)

    await expect(addCompany('https://job-boards.greenhouse.io/acme')).resolves.toEqual(saved)

    expect(supabase.functions.invoke).toHaveBeenCalledWith('verify-board', {
      body: { url: 'https://job-boards.greenhouse.io/acme' },
    })
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('keeps duplicate adds friendly without attempting an operational overwrite', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: {
        ok: false,
        reason: 'already_watched',
        message: 'Acme is already on the watchlist.',
      },
      error: null,
    } as never)

    await expect(addCompany('https://job-boards.greenhouse.io/acme')).rejects.toThrow(
      'Acme is already on the watchlist.',
    )
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('selects the canonical link and authoritative connector-state columns', () => {
    expect(COMPANY_COLUMNS).toContain('careers_url')
    expect(COMPANY_COLUMNS).toContain('source_key')
    expect(COMPANY_COLUMNS).toContain('activation_state')
    expect(COMPANY_COLUMNS).toContain('activation_successes')
    expect(COMPANY_COLUMNS).toContain('last_verified_at')
    expect(COMPANY_COLUMNS).toContain('last_error_code')
    expect(COMPANY_COLUMNS).toContain('last_observation_count')
  })
})

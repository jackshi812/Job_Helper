import { describe, expect, it } from 'vitest'
import {
  companyName,
  deterministicVisible,
  FEED_DETAIL_COLUMNS,
  FEED_LIST_COLUMNS,
  backfillDashboardFeedRow,
  decodeDashboardFeedCursor,
  dismissJob,
  encodeDashboardFeedCursor,
  listFeed,
  listDashboardCompanyOptions,
  listFeedPage,
  markJobApplied,
  mergeDashboardFeedPages,
  resumeRouteIsCurrent,
  relativePostedTime,
  safeApplyUrl,
  tierPresentation,
  type DashboardFeedCursor,
  type DashboardFeedPage,
  type DashboardFeedQuery,
  type FeedRow,
} from './feed'

import { vi } from 'vitest'
const queryMock = vi.hoisted(() => {
  const calls: Array<[string, ...unknown[]]> = []
  let rows: FeedRow[] = []
  let rpcData: unknown = []
  let rpcError: unknown = null
  let routeError: unknown = null
  let routeResponse: unknown = null
  const builder = {
    select: vi.fn((...args: unknown[]) => {
      calls.push(['select', ...args])
      return builder
    }),
    eq: vi.fn((...args: unknown[]) => {
      calls.push(['eq', ...args])
      return builder
    }),
    is: vi.fn((...args: unknown[]) => {
      calls.push(['is', ...args])
      return builder
    }),
    update: vi.fn((...args: unknown[]) => {
      calls.push(['update', ...args])
      return builder
    }),
    not: vi.fn((...args: unknown[]) => {
      calls.push(['not', ...args])
      return builder
    }),
    order: vi.fn((...args: unknown[]) => {
      calls.push(['order', ...args])
      return builder
    }),
    limit: vi.fn(async (...args: unknown[]) => {
      calls.push(['limit', ...args])
      const openFilter = calls.some(
        ([method, column, value]) =>
          method === 'eq' && column === 'jobs.status' && value === 'open',
      )
      return {
        data: (openFilter
          ? rows.filter((row) => row.jobs?.status === 'open')
          : rows
        ).slice(0, Number(args[0])),
        error: null,
      }
    }),
  }
  return {
    builder,
    calls,
    from: vi.fn(() => builder),
    rpc: vi.fn(async (...args: unknown[]) => {
      calls.push(['rpc', ...args])
      return { data: rpcData, error: rpcError }
    }),
    invoke: vi.fn(async (_name: string, options: { body?: { user_job_ids?: string[] } }) => {
      const ids = options.body?.user_job_ids ?? []
      return {
        data: routeError ? null : routeResponse ?? {
          route_revision: 1,
          updated_count: ids.length,
          routes: ids.map((id) => ({
            user_job_id: id,
            best_fit_resume_id: null,
            runner_up_resume_id: null,
          })),
        },
        error: routeError,
      }
    }),
    setRows(next: FeedRow[]) {
      rows = next
      calls.length = 0
    },
    setRpcRows(next: unknown) {
      rpcData = next
      rpcError = null
      calls.length = 0
    },
    setRpcError(next: unknown) {
      rpcError = next
      calls.length = 0
    },
    setRouteError(next: unknown) {
      routeError = next
    },
    setRouteResponse(next: unknown) {
      routeResponse = next
    },
  }
})
vi.mock('./supabase', () => ({
  supabase: {
    from: queryMock.from,
    rpc: queryMock.rpc,
    functions: { invoke: queryMock.invoke },
  },
}))

function feedRow(overrides: Partial<FeedRow> = {}): FeedRow {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    deterministic_revision: 4,
    deterministic_eligible: true,
    deterministic_score: 82,
    deterministic_tier: 'Strong',
    deterministic_breakdown: [
      { key: 'title', earned: 30, possible: 30, evidence: ['Strict title match'] },
      { key: 'location', earned: 10, possible: 10, evidence: ['Chicago'] },
      { key: 'recency', earned: 10, possible: 10, evidence: ['Posted within 24 hours'] },
      { key: 'watchlist', earned: 10, possible: 10, evidence: ['Acme'] },
      { key: 'experience', earned: 20, possible: 20, evidence: ['1 year below 3'] },
      { key: 'keywords', earned: 2, possible: 20, evidence: ['valuation'] },
    ],
    deterministic_filter_code: null,
    deterministic_filter_detail: null,
    deterministic_ranked_at: '2026-07-23T00:00:00.000Z',
    deterministic_best_fit_resume_id: null,
    deterministic_runner_up_resume_id: null,
    resume_route_revision: 1,
    current_resume_route_revision: 1,
    seen_at: null,
    dismissed_at: null,
    applied_at: null,
    jobs: {
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Data Scientist',
      location: 'Remote',
      absolute_url: 'https://boards.greenhouse.io/acme/jobs/1',
      posted_at: '2026-07-18T00:00:00.000Z',
      first_seen_at: '2026-07-18T01:00:00.000Z',
      status: 'open',
      source_company_name: null,
      companies: { name: 'Acme' },
    },
    ...overrides,
  }
}

describe('tierPresentation', () => {
  it('maps the stored Strong tier to the emerald badge', () => {
    expect(tierPresentation('Strong')).toEqual({ label: 'Strong', badge: 'emerald' })
  })

  it('maps the stored Good tier to the neutral badge', () => {
    expect(tierPresentation('Good')).toEqual({ label: 'Good', badge: 'neutral' })
  })

  it('maps the stored Weak tier to a plain label with no badge fill', () => {
    expect(tierPresentation('Weak')).toEqual({ label: 'Weak', badge: null })
  })

  it('does not synthesize Weak from a missing stored tier', () => {
    expect(tierPresentation(null)).toBeNull()
  })
})

describe('deterministic feed projection', () => {
  it('selects deterministic result fields and no active AI-era fields', () => {
    for (const columns of [FEED_LIST_COLUMNS, FEED_DETAIL_COLUMNS]) {
      expect(columns).toContain('deterministic_revision')
      expect(columns).toContain('deterministic_eligible')
      expect(columns).toContain('deterministic_score')
      expect(columns).toContain('deterministic_tier')
      expect(columns).toContain('deterministic_breakdown')
      expect(columns).toContain('deterministic_ranked_at')
      expect(columns).toContain('deterministic_best_fit_resume_id')
      expect(columns).toContain('resume_route_revision')
      expect(columns).toContain('applied_at')
      expect(columns).not.toMatch(/(^|, )score(,|$)/)
      expect(columns).not.toMatch(/(^|, )tier(,|$)/)
      expect(columns).not.toContain('reasons')
      expect(columns).not.toContain('gaps')
      expect(columns).not.toContain('covered')
      expect(columns).not.toContain('needs_refilter')
      expect(columns).not.toContain('score_deferred_until')
      expect(columns).not.toContain('scored_at')
    }
  })

  it('shows only complete eligible deterministic rows', () => {
    expect(deterministicVisible(feedRow())).toBe(true)
    expect(deterministicVisible(feedRow({ deterministic_revision: null }))).toBe(false)
    expect(deterministicVisible(feedRow({ deterministic_eligible: null }))).toBe(false)
    expect(deterministicVisible(feedRow({ deterministic_eligible: false }))).toBe(false)
    expect(deterministicVisible(feedRow({ deterministic_score: null }))).toBe(false)
    expect(deterministicVisible(feedRow({ deterministic_tier: null }))).toBe(false)
    expect(deterministicVisible(feedRow({
      jobs: { ...feedRow().jobs!, status: 'closed' },
    }))).toBe(false)
    expect(deterministicVisible(feedRow({ jobs: null }))).toBe(false)
  })

  it('leaves dismissal as a separate Dashboard state dimension', () => {
    expect(deterministicVisible(feedRow({
      dismissed_at: '2026-07-20T00:00:00.000Z',
    }))).toBe(true)
  })

  it('leaves applied state as a separate Dashboard state dimension', () => {
    expect(deterministicVisible(feedRow({
      applied_at: '2026-07-20T00:00:00.000Z',
    }))).toBe(true)
  })

  it('filters through an inner jobs relation before applying the 200-row cap', async () => {
    const closed = Array.from({ length: 205 }, (_, index) =>
      feedRow({
        id: `closed-${index}`,
        jobs: { ...feedRow().jobs!, id: `closed-job-${index}`, status: 'closed' },
      }))
    const open = Array.from({ length: 200 }, (_, index) =>
      feedRow({
        id: `open-${index}`,
        jobs: { ...feedRow().jobs!, id: `open-job-${index}`, status: 'open' },
      }))
    queryMock.setRows([...closed, ...open])

    await expect(listFeed()).resolves.toHaveLength(200)
    expect(FEED_LIST_COLUMNS).toContain('jobs!inner')
    expect(queryMock.calls).toContainEqual(['eq', 'jobs.status', 'open'])
    expect(queryMock.calls.findIndex(([method, column]) =>
      method === 'eq' && column === 'jobs.status',
    )).toBeLessThan(queryMock.calls.findIndex(([method]) => method === 'limit'))
  })
})

describe('resume route freshness', () => {
  it('requires equal positive integer revisions', () => {
    expect(resumeRouteIsCurrent(feedRow())).toBe(true)
    expect(resumeRouteIsCurrent(feedRow({ resume_route_revision: 0 }))).toBe(false)
    expect(resumeRouteIsCurrent(feedRow({ current_resume_route_revision: 2 }))).toBe(false)
  })
})

describe('companyName', () => {
  it('reads the embedded company name pulled through the jobs FK', () => {
    expect(companyName(feedRow())).toBe('Acme')
  })

  it('falls back to null when the company FK is unset', () => {
    expect(
      companyName(feedRow({ jobs: { ...feedRow().jobs!, companies: null } })),
    ).toBeNull()
    expect(companyName(feedRow({ jobs: null }))).toBeNull()
  })
})

describe('relativePostedTime', () => {
  it('prefers the posted timestamp', () => {
    expect(relativePostedTime(feedRow())).toBe('2026-07-18T00:00:00.000Z')
  })

  it('falls back to first_seen_at when posted_at is null', () => {
    expect(
      relativePostedTime(feedRow({ jobs: { ...feedRow().jobs!, posted_at: null } })),
    ).toBe('2026-07-18T01:00:00.000Z')
  })

  it('returns null when the job is missing', () => {
    expect(relativePostedTime(feedRow({ jobs: null }))).toBeNull()
  })
})

describe('safeApplyUrl', () => {
  it('passes through https apply links', () => {
    expect(safeApplyUrl('https://boards.greenhouse.io/acme/jobs/1')).toBe(
      'https://boards.greenhouse.io/acme/jobs/1',
    )
  })

  it('rejects non-https and credentialed URLs', () => {
    expect(safeApplyUrl('http://example.com')).toBeNull()
    expect(safeApplyUrl('javascript:alert(1)')).toBeNull()
    expect(safeApplyUrl('https://user:pass@example.com')).toBeNull()
    expect(safeApplyUrl(null)).toBeNull()
  })

  it('is navigation-only and never performs a lifecycle mutation', () => {
    queryMock.setRows([])
    expect(safeApplyUrl('https://example.com/apply')).toBe('https://example.com/apply')
    expect(queryMock.calls).toEqual([])
  })
})

const ACTIVE_QUERY: DashboardFeedQuery = {
  lifecycle: 'active',
  order: 'newest',
  tiers: ['Strong', 'Good', 'Weak'],
  hiddenCompanyKeys: ['hidden co'],
}

function cursor(overrides: Partial<DashboardFeedCursor> = {}): DashboardFeedCursor {
  return {
    v: 1,
    lifecycle: 'active',
    order: 'newest',
    signature: '0000000000000000',
    id: '00000000-0000-4000-8000-000000000000',
    posted_at: '2026-07-18T00:00:00.000Z',
    first_seen_at: '2026-07-18T01:00:00.000Z',
    score: 82,
    lifecycle_at: null,
    ...overrides,
  }
}

describe('Dashboard lifecycle feed pages', () => {
  it('routes exactly the bounded 200-row database page', async () => {
    const continuation = decodeDashboardFeedCursor(
      encodeDashboardFeedCursor(cursor(), ACTIVE_QUERY),
      ACTIVE_QUERY,
    )
    const pageRows = Array.from({ length: 200 }, (_, index) => {
      const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
      return {
        row_data: feedRow({ id }),
        cursor_data: continuation,
        has_more: false,
      }
    })
    queryMock.setRpcRows(pageRows)

    await listFeedPage(ACTIVE_QUERY)

    const invocation = queryMock.invoke.mock.calls.at(-1)
    expect(invocation?.[0]).toBe('route-dashboard-resumes')
    expect(invocation?.[1].body?.user_job_ids).toEqual(
      pageRows.map(({ row_data }) => row_data.id),
    )
  })

  it('requests a server-filtered 200-row page and exposes truthful continuation', async () => {
    const lastCursor = decodeDashboardFeedCursor(
      encodeDashboardFeedCursor(
        cursor({ id: '00000000-0000-4000-8000-000000000099' }),
        ACTIVE_QUERY,
      ),
      ACTIVE_QUERY,
    )
    queryMock.setRpcRows([
      { row_data: feedRow(), cursor_data: lastCursor, has_more: true },
    ])

    const page = await listFeedPage(ACTIVE_QUERY)

    expect(page.rows).toEqual([feedRow()])
    expect(page.hasMore).toBe(true)
    expect(page.caughtUp).toBe(false)
    expect(page.nextCursor).not.toBeNull()
    const call = queryMock.calls.find(([method]) => method === 'rpc')
    expect(call?.[1]).toBe('dashboard_feed_page')
    expect(call?.[2]).toMatchObject({
      p_lifecycle: 'active',
      p_order: 'newest',
      p_tiers: ['Strong', 'Good', 'Weak'],
      p_hidden_company_keys: ['hidden co'],
      p_cursor: null,
      p_limit: 200,
    })
    expect(queryMock.invoke).toHaveBeenCalledWith(
      'route-dashboard-resumes',
      { body: { user_job_ids: [feedRow().id] } },
    )
  })

  it('requests exactly one continuation row for backfill', async () => {
    const continuation = decodeDashboardFeedCursor(
      encodeDashboardFeedCursor(cursor(), ACTIVE_QUERY),
      ACTIVE_QUERY,
    )
    queryMock.setRpcRows([
      { row_data: feedRow(), cursor_data: continuation, has_more: false },
    ])

    const page = await backfillDashboardFeedRow(ACTIVE_QUERY)

    expect(page.rows).toHaveLength(1)
    expect(queryMock.invoke).toHaveBeenLastCalledWith(
      'route-dashboard-resumes',
      { body: { user_job_ids: [feedRow().id] } },
    )
    expect(page.caughtUp).toBe(true)
    expect(queryMock.calls).toContainEqual([
      'rpc',
      'dashboard_feed_page',
      expect.objectContaining({ p_limit: 1 }),
    ])
  })

  it('keeps the original page and deterministic evidence when routing fails', async () => {
    const original = feedRow({
      deterministic_best_fit_resume_id:
        '22222222-2222-4222-8222-222222222222',
      resume_route_revision: 1,
      current_resume_route_revision: 2,
    })
    const continuation = decodeDashboardFeedCursor(
      encodeDashboardFeedCursor(cursor(), ACTIVE_QUERY),
      ACTIVE_QUERY,
    )
    queryMock.setRpcRows([
      { row_data: original, cursor_data: continuation, has_more: false },
    ])
    queryMock.setRouteError(new Error('conflict'))

    const page = await listFeedPage(ACTIVE_QUERY)
    expect(page.rows[0]).toBe(original)
    expect(page.rows[0].deterministic_score).toBe(82)
    expect(page.rows[0].deterministic_breakdown)
      .toBe(original.deterministic_breakdown)
    queryMock.setRouteError(null)
  })

  it('patches only returned page routes while preserving deterministic evidence', async () => {
    const original = feedRow({
      current_resume_route_revision: 2,
      resume_route_revision: 1,
    })
    const continuation = decodeDashboardFeedCursor(
      encodeDashboardFeedCursor(cursor(), ACTIVE_QUERY),
      ACTIVE_QUERY,
    )
    queryMock.setRpcRows([
      { row_data: original, cursor_data: continuation, has_more: false },
    ])
    queryMock.setRouteResponse({
      route_revision: 2,
      updated_count: 1,
      routes: [{
        user_job_id: original.id,
        best_fit_resume_id: '22222222-2222-4222-8222-222222222222',
        runner_up_resume_id: '33333333-3333-4333-8333-333333333333',
      }],
    })

    const page = await listFeedPage(ACTIVE_QUERY)
    expect(page.rows[0]).toMatchObject({
      deterministic_best_fit_resume_id:
        '22222222-2222-4222-8222-222222222222',
      deterministic_runner_up_resume_id:
        '33333333-3333-4333-8333-333333333333',
      resume_route_revision: 2,
      deterministic_score: 82,
      deterministic_tier: 'Strong',
    })
    expect(page.rows[0].deterministic_breakdown)
      .toBe(original.deterministic_breakdown)
    queryMock.setRouteResponse(null)
  })

  it('rejects route records outside the requested page without failing the feed', async () => {
    const original = feedRow()
    const continuation = decodeDashboardFeedCursor(
      encodeDashboardFeedCursor(cursor(), ACTIVE_QUERY),
      ACTIVE_QUERY,
    )
    queryMock.setRpcRows([
      { row_data: original, cursor_data: continuation, has_more: false },
    ])
    queryMock.setRouteResponse({
      route_revision: 2,
      updated_count: 1,
      routes: [{
        user_job_id: '99999999-9999-4999-8999-999999999999',
        best_fit_resume_id: null,
        runner_up_resume_id: null,
      }],
    })

    const page = await listFeedPage(ACTIVE_QUERY)
    expect(page.rows[0]).toBe(original)
    queryMock.setRouteResponse(null)
  })

  it('returns explicit exhaustion when the RPC has no rows', async () => {
    queryMock.setRpcRows([])
    await expect(listFeedPage(ACTIVE_QUERY)).resolves.toEqual({
      rows: [],
      nextCursor: null,
      hasMore: false,
      caughtUp: true,
    })
  })

  it('loads company options from the complete lifecycle/tier RPC scope', async () => {
    queryMock.setRpcRows([
      { company_key: 'acme', company_name: 'Acme', matching_count: 205 },
    ])

    await expect(listDashboardCompanyOptions(ACTIVE_QUERY)).resolves.toEqual([
      { key: 'acme', label: 'Acme', count: 205 },
    ])
    expect(queryMock.calls).toContainEqual([
      'rpc',
      'dashboard_company_options',
      {
        p_lifecycle: 'active',
        p_tiers: ['Strong', 'Good', 'Weak'],
      },
    ])
  })
})

describe('Dashboard cursor validation and stable merge', () => {
  it('round-trips only canonical base64url cursor state for the exact query', () => {
    const provisional = cursor()
    const encoded = encodeDashboardFeedCursor(provisional, ACTIVE_QUERY)
    const decoded = decodeDashboardFeedCursor(encoded, ACTIVE_QUERY)

    expect(decoded).toMatchObject({
      v: 1,
      lifecycle: 'active',
      order: 'newest',
      id: provisional.id,
    })
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(encodeDashboardFeedCursor(decoded, ACTIVE_QUERY)).toBe(encoded)
  })

  it('rejects malformed, noncanonical, oversized, and query-drifted cursors', () => {
    const encoded = encodeDashboardFeedCursor(cursor(), ACTIVE_QUERY)
    expect(() => decodeDashboardFeedCursor(`${encoded}=`, ACTIVE_QUERY))
      .toThrow('invalid_dashboard_cursor')
    expect(() => decodeDashboardFeedCursor('not-json', ACTIVE_QUERY))
      .toThrow('invalid_dashboard_cursor')
    expect(() => decodeDashboardFeedCursor('a'.repeat(4097), ACTIVE_QUERY))
      .toThrow('invalid_dashboard_cursor')
    expect(() => decodeDashboardFeedCursor(encoded, {
      ...ACTIVE_QUERY,
      lifecycle: 'applied',
      order: 'newest',
    })).toThrow('dashboard_cursor_signature_mismatch')
    expect(() => decodeDashboardFeedCursor(encoded, {
      ...ACTIVE_QUERY,
      hiddenCompanyKeys: [],
    })).toThrow('dashboard_cursor_signature_mismatch')
  })

  it('deduplicates equal-tuple pages without reordering already rendered rows', () => {
    const first = feedRow({ id: 'first' })
    const duplicate = feedRow({ id: 'duplicate' })
    const next = feedRow({ id: 'next' })
    const current: DashboardFeedPage = {
      rows: [first, duplicate],
      nextCursor: 'old',
      hasMore: true,
      caughtUp: false,
    }
    const incoming: DashboardFeedPage = {
      rows: [duplicate, next],
      nextCursor: null,
      hasMore: false,
      caughtUp: true,
    }

    expect(mergeDashboardFeedPages(current, incoming)).toEqual({
      rows: [first, duplicate, next],
      nextCursor: null,
      hasMore: false,
      caughtUp: true,
    })
  })
})

describe('lifecycle mutations', () => {
  it('marks applied through exactly one tracker RPC and returns its application UUID', async () => {
    const applicationId = '22222222-2222-4222-8222-222222222222'
    queryMock.setRpcRows(applicationId)

    await expect(markJobApplied('11111111-1111-4111-8111-111111111111'))
      .resolves.toBe(applicationId)

    expect(queryMock.calls).toEqual([[
      'rpc',
      'mark_job_applied',
      { p_user_job_id: '11111111-1111-4111-8111-111111111111' },
    ]])
  })

  it('rejects malformed mark-applied results and propagates database errors', async () => {
    queryMock.setRpcRows({ application_id: 'not-the-scalar-contract' })
    await expect(markJobApplied('job-1')).rejects.toThrow('invalid_application_id')

    const databaseError = new Error('mark_job_applied_failed')
    queryMock.setRpcError(databaseError)
    await expect(markJobApplied('job-1')).rejects.toBe(databaseError)
  })

  it('permanently dismisses only through the authenticated RPC', async () => {
    queryMock.setRpcRows(true)
    await dismissJob('job-1')

    expect(queryMock.calls).toContainEqual([
      'rpc',
      'dismiss_job_permanently',
      { p_user_job_id: 'job-1' },
    ])
    expect(queryMock.from).not.toHaveBeenCalledWith('jobs')
  })

  it('fails closed when the permanent-dismiss RPC cannot find an owned row', async () => {
    queryMock.setRpcRows(false)
    await expect(dismissJob('missing')).rejects.toThrow('user_job_not_found')
  })
})

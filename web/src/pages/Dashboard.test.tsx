import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { FeedRow } from '../lib/feed'
import dashboardSource from './Dashboard.tsx?raw'
import jobDetailSource from './JobDetail.tsx?raw'
import { Dashboard } from './Dashboard'

const row: FeedRow = {
  id: 'user-job-1',
  status: 'scored',
  filter_reason: null,
  filter_detail: null,
  score: 42,
  tier: 'Weak',
  reasons: ['Entry-level scope'],
  routed_resume_id: null,
  runner_up_resume_id: null,
  scored_at: '2026-07-22T00:00:00.000Z',
  needs_refilter: false,
  score_deferred_until: null,
  seen_at: null,
  dismissed_at: null,
  jobs: {
    id: 'job-1',
    title: 'Analyst',
    location: 'Chicago, IL',
    absolute_url: 'https://example.com/jobs/1',
    posted_at: '2026-07-22T00:00:00.000Z',
    first_seen_at: '2026-07-22T00:00:00.000Z',
    status: 'open',
    source_company_name: null,
    companies: { name: 'Acme' },
  },
}

vi.mock('../lib/supabase', () => ({ supabase: {} }))

vi.mock('react-router', () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === 'feed') {
      return { data: [row], error: null, isPending: false, refetch: vi.fn() }
    }
    if (queryKey[0] === 'preferences') {
      return { data: {}, error: null, isPending: false }
    }
    return { data: [], error: null, isPending: false }
  },
  useQueryClient: () => ({
    cancelQueries: vi.fn(),
    getQueryData: vi.fn(),
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
  }),
}))

describe('Dashboard precision controls', () => {
  it('shows every score tier selected and keeps Weak rows reachable on first render', () => {
    const markup = renderToStaticMarkup(<Dashboard />)

    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('>Companies</button>')
    expect(markup).toMatch(/aria-pressed="true"[^>]*>Strong<\/button>/)
    expect(markup).toMatch(/aria-pressed="true"[^>]*>Good<\/button>/)
    expect(markup).toMatch(/aria-pressed="true"[^>]*>Weak<\/button>/)
    expect(markup).toContain('1 jobs shown')
    expect(markup).toContain('Analyst')
  })

  it('renders Location in the list and preserves Match reasons only on detail', () => {
    const markup = renderToStaticMarkup(<Dashboard />)
    const table = markup.match(/<table[\s\S]*<\/table>/)?.[0] ?? ''

    expect(table).toContain('>Location</th>')
    expect(table).toContain('Chicago, IL')
    expect(table).not.toContain('Match reason')
    expect(jobDetailSource).toContain('Match reasons')
  })

  it('pins staged company search, apply, reset, escape, and filter-empty copy', () => {
    expect(dashboardSource).toContain('Search companies')
    expect(dashboardSource).toContain('Search current companies')
    expect(dashboardSource).toContain('Show results')
    expect(dashboardSource).toContain('Reset')
    expect(dashboardSource).toContain("event.key === 'Escape'")
    expect(dashboardSource).toContain('No jobs match these filters')
    expect(dashboardSource).toContain('No current companies match your search.')
    expect(dashboardSource).not.toContain('localStorage')
    expect(dashboardSource).not.toContain('savePreferences')
  })
})

import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { FeedRow } from '../lib/feed'
import jobDetailSource from './JobDetail.tsx?raw'
import { JobDetail } from './JobDetail'

const row: FeedRow = {
  id: 'user-job-1',
  deterministic_revision: 4,
  deterministic_eligible: true,
  deterministic_score: 82,
  deterministic_tier: 'Strong',
  deterministic_breakdown: [
    {
      key: 'title',
      earned: 30,
      possible: 30,
      evidence: ['Strict title match: Equity Research Analyst'],
    },
    {
      key: 'location',
      earned: 10,
      possible: 10,
      evidence: ['Matched location keyword: Chicago'],
    },
    {
      key: 'recency',
      earned: 10,
      possible: 10,
      evidence: ['Posted within 24 hours: 2026-07-23T00:00:00.000Z'],
    },
    {
      key: 'watchlist',
      earned: 10,
      possible: 10,
      evidence: ['Watchlist source: Acme'],
    },
    {
      key: 'experience',
      earned: 20,
      possible: 20,
      evidence: ['Required minimum 1 year; configured maximum 3 years'],
    },
    {
      key: 'keywords',
      earned: 2,
      possible: 20,
      evidence: ['Matched keywords: valuation'],
    },
  ],
  deterministic_filter_code: null,
  deterministic_filter_detail: null,
  deterministic_ranked_at: '2026-07-23T01:00:00.000Z',
  deterministic_best_fit_resume_id: null,
  deterministic_runner_up_resume_id: null,
  seen_at: null,
  dismissed_at: null,
  applied_at: null,
  jobs: {
    id: 'job-1',
    title: 'Equity Research Analyst',
    location: null,
    absolute_url: 'https://example.com/jobs/1',
    posted_at: '2026-07-23T00:00:00.000Z',
    first_seen_at: '2026-07-23T00:05:00.000Z',
    status: 'open',
    source_company_name: null,
    companies: { name: 'Acme' },
    description_html: '<p>Safe description</p>',
    description_text: null,
  },
}

vi.mock('../lib/supabase', () => ({ supabase: {} }))

vi.mock('dompurify', () => ({
  default: { sanitize: vi.fn(() => '<p>Safe description</p>') },
}))

vi.mock('react-router', () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
  useParams: () => ({ id: 'user-job-1' }),
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === 'job') {
      return { data: row, error: null, isPending: false }
    }
    return { data: [], error: null, isPending: false }
  },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

describe('deterministic job detail', () => {
  it('renders stored score, stored tier, ranked time, and truthful missing location', () => {
    const markup = renderToStaticMarkup(<JobDetail />)

    expect(markup).toContain('Equity Research Analyst')
    expect(markup).toContain('Acme · —')
    expect(markup).toContain('>82<')
    expect(markup).toContain('>Strong<')
    expect(markup).toContain('ranked ')
    expect(markup).not.toContain('scored ')
  })

  it('renders the fixed six-category breakdown and total with accessible points', () => {
    const markup = renderToStaticMarkup(<JobDetail />)
    const labels = [
      'Title match',
      'Preferred location',
      'Posted within 24 hours',
      'Watchlist source',
      'Required experience',
      'Description keywords',
    ]

    expect(markup).toContain('Ranking breakdown')
    expect(markup).toContain('Deterministic ranking breakdown')
    expect(markup).toContain('<th scope="col">Category</th>')
    expect(markup).toContain('<th scope="col">Points</th>')
    expect(markup).toContain('<th scope="col">Evidence</th>')
    for (let index = 0; index < labels.length - 1; index += 1) {
      expect(markup.indexOf(labels[index])).toBeLessThan(markup.indexOf(labels[index + 1]))
    }
    expect(markup).toContain('aria-label="30 of 30 points"')
    expect(markup).toContain('30 / 30')
    expect(markup).toContain('82 / 100')
    expect(markup).toContain('Strict title match: Equity Research Analyst')
    expect(markup).toContain('Matched keywords: valuation')
  })

  it('removes every AI-era and deferred manual action while preserving safe detail behavior', () => {
    const markup = renderToStaticMarkup(<JobDetail />)

    expect(jobDetailSource).not.toContain('listResumes')
    expect(jobDetailSource).not.toContain('GapPanel')
    expect(jobDetailSource).not.toContain('row.gaps')
    expect(jobDetailSource).not.toContain('row.covered')
    expect(jobDetailSource).not.toContain('row.reasons')
    expect(markup).not.toContain('Match reasons')
    expect(markup).not.toContain('Gaps vs')
    expect(markup).not.toContain('Tailor')
    expect(markup).not.toContain('AI')
    expect(markup).toContain('← Back to matches')
    expect(markup).toContain('aria-label="Apply to Equity Research Analyst in a new tab"')
    expect(markup).toContain('<p>Safe description</p>')
    expect(jobDetailSource).toContain('DOMPurify.sanitize')
    expect(jobDetailSource).toContain('mutationFn: markSeen')
  })

  it('renders evidence as React text rather than HTML', () => {
    expect(jobDetailSource).toContain('row.evidence.join')
    expect(jobDetailSource).not.toContain('dangerouslySetInnerHTML={{ __html: evidence')
  })
})

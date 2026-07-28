import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import dashboardSource from '../src/pages/Dashboard.tsx?raw'
import trackerSource from '../src/pages/Tracker.tsx?raw'
import { Tracker } from '../src/pages/Tracker'

const trackerApplication = {
  id: '22222222-2222-4222-8222-222222222222',
  origin: 'system',
  company: 'Acme',
  title: 'Data Analyst',
  location: 'Chicago, IL',
  applyUrl: 'https://example.com/jobs/1',
  notes: '',
  pinned: false,
  currentStage: 'applied',
  currentStageDate: '2026-07-27',
  updatedAt: '2026-07-27T15:00:00.000Z',
  resumeId: null,
}

vi.mock('../src/lib/supabase', () => ({ supabase: {} }))
vi.mock('../src/lib/tracker', () => ({
  TRACKER_STAGES: [
    { slug: 'ready_to_apply', label: 'Ready to Apply' },
    { slug: 'applied', label: 'Applied' },
    { slug: 'outreach_sent', label: 'Outreach Sent' },
    { slug: 'interview', label: 'Interview' },
    { slug: 'offer', label: 'Offer' },
    { slug: 'rejected', label: 'Rejected' },
  ],
  listTrackerApplications: vi.fn(async () => [trackerApplication]),
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: [trackerApplication],
    error: null,
    isPending: false,
    refetch: vi.fn(),
  }),
}))

describe('Dashboard Mark Applied → Tracker happy path', () => {
  it('keeps the existing Dashboard button wired to the sole lifecycle mutation', () => {
    expect(dashboardSource).toContain('mutationFn: markJobApplied')
    expect(dashboardSource).toContain('onClick={() => markAppliedMutation.mutate(row.id)}')
    expect(dashboardSource).toContain('Mark Applied')
    expect(dashboardSource).not.toMatch(/onClick=\{[^}]*safeApplyUrl[^}]*markJobApplied/)
  })

  it('renders the owned durable system snapshot on the Tracker route at Applied', () => {
    const markup = renderToStaticMarkup(<Tracker />)

    expect(markup).toContain('>Tracker</h1>')
    expect(markup).toContain(
      'Track applications, update stages, and keep every follow-up in one place.',
    )
    expect(markup).toContain('Applications; scroll horizontally to view all columns')
    expect(markup).toContain('Acme')
    expect(markup).toContain('Data Analyst')
    expect(markup).toContain('Applied')
    expect(markup).toContain('2026-07-27')
  })

  it('uses the tracker list query without reconstructing lifecycle state in the page', () => {
    expect(trackerSource).toContain('listTrackerApplications')
    expect(trackerSource).toContain("queryKey: ['tracker-applications']")
    expect(trackerSource).not.toContain("from('user_jobs')")
    expect(trackerSource).not.toContain('applied_at')
  })
})

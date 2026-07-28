import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import dashboardSource from '../src/pages/Dashboard.tsx?raw'
import trackerSource from '../src/pages/Tracker.tsx?raw'
import {
  createManualApplication,
  listDashboardAppliedApplications,
  TRACKER_STAGES,
  type TrackerApplicationListItem,
} from '../src/lib/tracker'
import { Tracker } from '../src/pages/Tracker'

const trackerApplication: TrackerApplicationListItem = {
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
  resumeLabel: null,
}

const rpcMock = vi.hoisted(() => vi.fn())
vi.mock('../src/lib/supabase', () => ({
  supabase: { rpc: rpcMock },
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: [trackerApplication],
    error: null,
    isPending: false,
    refetch: vi.fn(),
  }),
  useMutation: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    variables: undefined,
    error: null,
    isPending: false,
    isError: false,
    isSuccess: false,
  }),
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
    fetchQuery: vi.fn(),
  }),
}))

vi.mock('react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useSearchParams: () => [new URLSearchParams()],
}))

afterEach(() => {
  vi.useRealTimers()
  rpcMock.mockReset()
})

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
    expect(trackerSource).toContain("queryKey: ['tracker-applications', selectedStages]")
    expect(trackerSource).not.toContain("from('user_jobs')")
    expect(trackerSource).not.toContain('applied_at')
  })

  it('locks the exact six stage values and labels without a seventh state', () => {
    expect(TRACKER_STAGES).toEqual([
      { slug: 'ready_to_apply', label: 'Ready to Apply' },
      { slug: 'applied', label: 'Applied' },
      { slug: 'outreach_sent', label: 'Outreach Sent' },
      { slug: 'interview', label: 'Interview' },
      { slug: 'offer', label: 'Offer' },
      { slug: 'rejected', label: 'Rejected' },
    ])
  })

  it('supplies today as the read-only initial stage date and sends six named inputs', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-27T23:30:00.000Z'))
    rpcMock.mockResolvedValue({
      data: [{
        application_id: '22222222-2222-4222-8222-222222222222',
        duplicate_warning: false,
      }],
      error: null,
    })

    await expect(createManualApplication({
      company: 'Acme',
      title: 'Data Analyst',
      applyUrl: 'https://example.com/jobs/1',
      notes: 'Follow up with Sam.',
      stage: 'interview',
    })).resolves.toEqual({
      applicationId: '22222222-2222-4222-8222-222222222222',
      duplicateWarning: false,
    })

    expect(rpcMock).toHaveBeenCalledWith('create_manual_application', {
      p_company: 'Acme',
      p_title: 'Data Analyst',
      p_apply_url: 'https://example.com/jobs/1',
      p_notes: 'Follow up with Sam.',
      p_stage: 'interview',
      p_occurred_on: '2026-07-27',
    })
  })

  it('parses the exact eight-column applied projection and rejects unsafe links', async () => {
    rpcMock.mockResolvedValue({
      data: [{
        application_id: '22222222-2222-4222-8222-222222222222',
        company: 'Acme',
        title: 'Data Analyst',
        location: 'Chicago, IL',
        apply_url: 'https://example.com/jobs/1',
        applied_on: '2026-07-20',
        current_stage: 'interview',
        current_stage_date: '2026-07-27',
      }],
      error: null,
    })

    await expect(listDashboardAppliedApplications()).resolves.toEqual([{
      applicationId: '22222222-2222-4222-8222-222222222222',
      company: 'Acme',
      title: 'Data Analyst',
      location: 'Chicago, IL',
      applyUrl: 'https://example.com/jobs/1',
      appliedOn: '2026-07-20',
      currentStage: 'interview',
      currentStageDate: '2026-07-27',
    }])

    rpcMock.mockResolvedValue({
      data: [{
        application_id: '22222222-2222-4222-8222-222222222222',
        company: 'Acme',
        title: 'Data Analyst',
        location: null,
        apply_url: 'https://user:password@example.com/jobs/1',
        applied_on: '2026-07-20',
        current_stage: 'applied',
        current_stage_date: '2026-07-20',
      }],
      error: null,
    })
    await expect(listDashboardAppliedApplications())
      .rejects.toThrow('invalid_dashboard_applied_application')
  })
})

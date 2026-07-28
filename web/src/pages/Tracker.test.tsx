import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TRACKER_ACTIVE_STAGES,
  type TrackerApplicationListItem,
} from '../lib/tracker'
import { Tracker } from './Tracker'
import trackerSource from './Tracker.tsx?raw'

const applications: TrackerApplicationListItem[] = [{
  id: '11111111-1111-4111-8111-111111111111',
  origin: 'system',
  company: 'Acme',
  title: 'Data Analyst',
  location: 'Chicago, IL',
  applyUrl: 'https://example.com/jobs/1',
  notes: 'Follow up with Sam.',
  pinned: false,
  resumeId: null,
  resumeLabel: null,
  currentStage: 'applied',
  currentStageDate: '2026-07-28',
  updatedAt: '2026-07-28T15:00:00.000Z',
}]

const queryState = vi.hoisted(() => ({
  data: [] as TrackerApplicationListItem[],
  error: null as Error | null,
  isPending: false,
}))

const invalidateQueries = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    ...queryState,
    refetch: vi.fn(),
  }),
  useMutation: (options: object) => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    reset: vi.fn(),
    variables: undefined,
    error: null,
    isPending: false,
    isError: false,
    isSuccess: false,
    options,
  }),
  useQueryClient: () => ({
    invalidateQueries,
    fetchQuery: vi.fn(),
  }),
}))

vi.mock('../lib/resumes', () => ({
  listResumes: vi.fn(),
  resumeLabel: ({ display_name: displayName, filename }: {
    display_name: string | null
    filename: string
  }) => displayName ?? filename,
}))

vi.mock('react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useSearchParams: () => [new URLSearchParams()],
}))

describe('Tracker page contract', () => {
  beforeEach(() => {
    queryState.data = applications
    queryState.error = null
    queryState.isPending = false
    invalidateQueries.mockReset()
  })

  it('renders the exact header, filters, table semantics, and eight columns', () => {
    const markup = renderToStaticMarkup(<Tracker />)

    expect(markup).toContain('>Tracker</h1>')
    expect(markup).toContain(
      'Track applications, update stages, and keep every follow-up in one place.',
    )
    expect(markup).toContain('>Add position</button>')
    expect(markup).toContain('aria-label="Stage filters"')
    expect(markup).toContain('Active stages')
    expect(markup).toContain('Terminal stages')
    expect(markup).toContain('All stages')
    expect(markup.match(/aria-pressed="/g)).toHaveLength(10)
    expect(markup).toContain('Applications; scroll horizontally to view all columns')
    expect(markup).toContain('<table')
    expect(markup).toContain('min-w-[1224px]')
    expect(markup).toContain('scope="col"')
    expect(markup).toContain('Company')
    expect(markup).toContain('Position')
    expect(markup).toContain('Stage date')
    expect(markup).toContain('Notes')
    expect(markup).toContain('Updated')
  })

  it('uses selected-stage query keys, active defaults, and six independent toggles', () => {
    expect(trackerSource).toMatch(
      /useState<TrackerStage\[]>\(\[\s*\.\.\.TRACKER_ACTIVE_STAGES,\s*\]\)/,
    )
    expect(TRACKER_ACTIVE_STAGES).toEqual([
      'ready_to_apply',
      'applied',
      'outreach_sent',
      'interview',
    ])
    expect(trackerSource).toContain("queryKey: ['tracker-applications', selectedStages]")
    expect(trackerSource).toContain('listTrackerApplications(selectedStages)')
    expect(trackerSource).toContain('aria-pressed={selectedStages.includes(stage.slug)}')
    expect(trackerSource).toContain('setSelectedStages([])')
  })

  it('keeps exact loading, load-error, initial-empty, and filtered-empty recovery copy', () => {
    queryState.data = []
    queryState.isPending = true
    expect(renderToStaticMarkup(<Tracker />)).toContain('Loading applications…')

    queryState.isPending = false
    queryState.error = new Error('offline')
    const errorMarkup = renderToStaticMarkup(<Tracker />)
    expect(errorMarkup).toContain(
      'Couldn’t load your applications. Check your connection and retry.',
    )
    expect(errorMarkup).toContain('aria-label="Retry loading applications"')

    expect(trackerSource).toContain('No applications yet')
    expect(trackerSource).toContain(
      'Add a position here, or mark a Dashboard job applied to start tracking.',
    )
    expect(trackerSource).toContain('No applications match these stages')
    expect(trackerSource).toContain('Choose more stages or select Active stages.')
  })

  it('locks the manual draft validation, recovery, selected stage, and read-only date', () => {
    expect(trackerSource).toContain('Enter a company.')
    expect(trackerSource).toContain('Enter a job title.')
    expect(trackerSource).toContain('Enter a job URL.')
    expect(trackerSource).toContain('Enter a valid HTTPS job URL.')
    expect(trackerSource).toContain('Discard draft')
    expect(trackerSource).toContain('Position added.')
    expect(trackerSource).toContain(
      'Couldn’t add this position. Check your entries and retry.',
    )
    expect(trackerSource).toContain('Possible duplicate:')
    expect(trackerSource).toContain('readOnly')
    expect(trackerSource).toContain('stage: draft.stage')
    expect(trackerSource).not.toMatch(/createManualApplication\(\{[^}]*location/s)
    expect(trackerSource).not.toMatch(/createManualApplication\(\{[^}]*description/s)
  })

  it('serializes same-cell writes and keeps scoped real retry actions', () => {
    for (const field of ['pin', 'stage', 'current_stage_date', 'notes']) {
      expect(trackerSource).toContain(
        `scope: { id: \`\${application.id}:${field}\` }`,
      )
    }
    expect(trackerSource).toContain('retry: false')
    expect(trackerSource).toContain('Retry saving')
    expect(trackerSource).toMatch(/\w+Mutation\.variables/)
    expect(trackerSource).toContain("queryKey: ['tracker-application', application.id]")
    expect(trackerSource).not.toContain('pageSaving')
    expect(trackerSource).not.toContain('updateApplication(')
  })

  it('keeps system snapshots immutable and renders detail content safely and lazily', () => {
    expect(trackerSource).toContain("application.origin === 'manual'")
    expect(trackerSource).toContain('enabled: expanded')
    expect(trackerSource).toContain('DOMPurify.sanitize')
    expect(trackerSource).toContain("FORBID_TAGS: ['style', 'form']")
    expect(trackerSource).toContain('dangerouslySetInnerHTML')
    expect(trackerSource).toContain('descriptionText')
    expect(trackerSource).toContain('whitespace-pre-wrap')
    expect(trackerSource).toContain('No job description was saved for this position.')
    expect(trackerSource).toContain('Linked resume (optional)')
    expect(trackerSource).toContain('No linked resume')
    expect(trackerSource).toContain('Open resume')
    expect(trackerSource).toContain("queryKey: ['resumes']")
  })

  it('retains the semantic spreadsheet and independent mobile overflow behavior', () => {
    expect(trackerSource).toContain(
      'Swipe horizontally to view and edit all columns.',
    )
    expect(trackerSource).toContain('overflow-x-auto')
    expect(trackerSource).toContain('min-w-[1224px]')
    expect(trackerSource).toContain('min-h-11')
    expect(trackerSource).not.toContain('Kanban')
    expect(trackerSource).not.toMatch(/grid-cols-[1-9].*application/i)
  })

  it('resolves a focus target only through an owned all-stage list', () => {
    expect(trackerSource).toContain('useSearchParams')
    expect(trackerSource).toContain("searchParams.get('application')")
    expect(trackerSource).toContain('TRACKER_APPLICATION_ID_PATTERN')
    expect(trackerSource).toContain("queryKey: ['tracker-focus-applications']")
    expect(trackerSource).toContain(
      'listTrackerApplications(TRACKER_STAGES.map(({ slug }) => slug))',
    )
    expect(trackerSource).toContain('focusApplicationsQuery.data?.find')
    expect(trackerSource).toContain('application.id === focusApplicationId')
    expect(trackerSource).not.toContain('getTrackerApplication(focusApplicationId')
    expect(trackerSource).not.toContain('Application not found')
    expect(trackerSource).not.toContain('You do not have access')
  })

  it('expands, scrolls, and focuses only the matched owned row', () => {
    expect(trackerSource).toContain('expandButtonRefs')
    expect(trackerSource).toContain('scrollIntoView')
    expect(trackerSource).toContain('.focus()')
    expect(trackerSource).toContain('setExpandedIds')
    expect(trackerSource).toContain('setSelectedStages')
    expect(trackerSource).toContain('registerExpandButton')
  })
})

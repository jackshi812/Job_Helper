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

  it('renders the header, compact filters, table semantics, and eight columns', () => {
    const markup = renderToStaticMarkup(<Tracker />)

    expect(markup).toContain('>Tracker</h1>')
    expect(markup).toContain(
      'Track applications, update stages, and keep every follow-up in one place.',
    )
    expect(markup).toContain('>Add position</button>')
    expect(markup).toContain('aria-label="Stage filters"')
    expect(markup).toContain('id="stage-group-filter"')
    expect(markup).toContain('id="individual-stage-filter"')
    expect(markup).toContain('Active stages')
    expect(markup).toContain('Terminal stages')
    expect(markup).toContain('All stages')
    expect(markup).toContain('Choose a stage')
    expect(markup).toContain('aria-label="Applications"')
    expect(markup).toContain('<table')
    expect(markup).not.toContain('min-w-[1224px]')
    expect(markup).toContain('scope="col"')
    expect(markup).toContain('Company')
    expect(markup).toContain('Position')
    expect(markup).toContain('Stage date')
    expect(markup).toContain('Notes')
    expect(markup).toContain('Status')
    expect(markup).toContain(
      'aria-label="Open Data Analyst job URL in new tab"',
    )
    expect(markup).not.toContain('aria-label="Data Analyst, new tab"')
    expect(markup).not.toContain('Updated')
  })

  it('uses selected-stage query keys, active defaults, and two compact selects', () => {
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
    expect(trackerSource).toContain('id="stage-group-filter"')
    expect(trackerSource).toContain('id="individual-stage-filter"')
    expect(trackerSource).not.toContain('toggleStage(')
    expect(trackerSource).not.toContain('aria-pressed={selectedStages.includes(stage.slug)}')
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

  it('keeps manual rows read-only until the role is double-clicked', () => {
    queryState.data = [{
      ...applications[0],
      origin: 'manual',
    }]
    const markup = renderToStaticMarkup(<Tracker />)

    expect(markup).toContain('aria-label="Edit Data Analyst"')
    expect(markup).toContain(
      'aria-label="Open Data Analyst job URL in new tab"',
    )
    expect(markup).toContain('href="https://example.com/jobs/1"')
    expect(markup).toContain('Double-click role to edit')
    for (const field of ['company', 'title', 'stage', 'date', 'notes']) {
      expect(markup).not.toContain(
        `id="${field}-11111111-1111-4111-8111-111111111111"`,
      )
    }
    expect(trackerSource).toContain('onDoubleClick={() => setManualEditActive(true)}')
    expect(trackerSource).toContain(
      '!event.currentTarget.contains(event.relatedTarget as Node | null)',
    )
    expect(trackerSource).toContain(
      'useEffect(() => setManualEditActive(false), [application.updatedAt])',
    )
    expect(trackerSource).toContain('setManualEditActive(false)')
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

  it('retains the semantic spreadsheet without horizontal table scrolling', () => {
    expect(trackerSource).not.toContain(
      'Swipe horizontally to view and edit all columns.',
    )
    expect(trackerSource).not.toContain('overflow-x-auto')
    expect(trackerSource).not.toContain('min-w-[1224px]')
    expect(trackerSource).toContain('className="w-full table-fixed')
    expect(trackerSource).toContain('break-words')
    expect(trackerSource).toContain('min-h-9 min-w-0 w-full')
    expect(trackerSource).toContain('rowNumber={index + 1}')
    expect(trackerSource).toContain('>#</th>')
    expect(trackerSource).toContain('text-lg font-bold')
    expect(trackerSource).toContain('min-h-9 min-w-9 rounded-md text-2xl leading-none')
    expect(trackerSource).toContain('min-h-9 min-w-9 rounded-md text-3xl leading-none')
    expect(trackerSource).toContain(
      'rounded-full border px-2 py-1 text-center text-xs font-semibold',
    )
    expect(trackerSource).toContain('rows={1}')
    expect(trackerSource).toContain('flex items-center justify-end gap-1.5')
    expect(trackerSource).toContain('colSpan={9}')
    expect(trackerSource).toContain('border-collapse text-left text-xs')
    expect(trackerSource).not.toContain(
      'placeholder="Add contacts, follow-ups, interview details, or next steps."',
    )
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

  it('puts mutation confirmation at the far right and confirms application deletion', () => {
    expect(trackerSource).toContain("setLastSave('stage')")
    expect(trackerSource).toContain('lastSaveMutation')
    expect(trackerSource).toContain('retryLastSave')
    expect(trackerSource).toContain('>Status</th>')
    expect(trackerSource).toContain('title="Delete application?"')
    expect(trackerSource).toContain('confirmLabel="Delete application"')
    expect(trackerSource).toContain('initialFocus="cancel"')
    expect(trackerSource).toContain('deleteTrackerApplication')
    expect(trackerSource).toContain('will not return to Active')
  })
})

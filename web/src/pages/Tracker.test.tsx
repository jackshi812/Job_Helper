import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TRACKER_ACTIVE_STAGES,
  TRACKER_STAGES,
  TRACKER_TERMINAL_STAGES,
  type TrackerApplicationDetail,
  type TrackerApplicationListItem,
  type TrackerStage,
} from '../lib/tracker'
import { patchTrackerApplicationCaches, Tracker } from './Tracker'
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

const focusQueryState = vi.hoisted(() => ({
  data: undefined as TrackerApplicationDetail | undefined,
  error: null as Error | null,
  isPending: false,
}))
const searchParamState = vi.hoisted(() => ({ value: null as string | null }))
const trackerOperations = vi.hoisted(() => ({
  appendApplicationStage: vi.fn(),
  getTrackerApplication: vi.fn(),
  updateApplicationStageEvent: vi.fn(),
}))
const reactQueryHarness = vi.hoisted(() => {
  const queryOptions: object[] = []
  const mutationOptions: object[] = []
  const cache = new Map<string, { key: readonly unknown[]; data: unknown }>()
  const keyId = (key: readonly unknown[]) => JSON.stringify(key)
  const queryClient = {
    fetchQuery: vi.fn(),
    getQueriesData: vi.fn(({ queryKey }: { queryKey: readonly unknown[] }) =>
      [...cache.values()]
        .filter(({ key }) => queryKey.every((part, index) => key[index] === part))
        .map(({ key, data }) => [key, data] as [readonly unknown[], unknown])),
    getQueryData: vi.fn((queryKey: readonly unknown[]) => cache.get(keyId(queryKey))?.data),
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn((
      queryKey: readonly unknown[],
      value: unknown | ((current: unknown) => unknown),
    ) => {
      const id = keyId(queryKey)
      const current = cache.get(id)?.data
      const data = typeof value === 'function'
        ? (value as (current: unknown) => unknown)(current)
        : value
      cache.set(id, { key: queryKey, data })
      return data
    }),
  }
  return { cache, keyId, mutationOptions, queryClient, queryOptions }
})

vi.mock('../lib/tracker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/tracker')>()
  return {
    ...actual,
    appendApplicationStage: trackerOperations.appendApplicationStage,
    getTrackerApplication: trackerOperations.getTrackerApplication,
    updateApplicationStageEvent: trackerOperations.updateApplicationStageEvent,
  }
})

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: readonly unknown[] }) => {
    reactQueryHarness.queryOptions.push(options)
    const state = options.queryKey[0] === 'tracker-applications'
      ? queryState
      : options.queryKey[0] === 'tracker-application' && options.queryKey[1] === searchParamState.value
        ? focusQueryState
        : { data: undefined, error: null, isPending: false }
    return { ...state, refetch: vi.fn() }
  },
  useMutation: (options: object) => {
    reactQueryHarness.mutationOptions.push(options)
    return {
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      reset: vi.fn(),
      variables: undefined,
      error: null,
      isPending: false,
      isError: false,
      isSuccess: false,
      options,
    }
  },
  useQueryClient: () => reactQueryHarness.queryClient,
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
  useSearchParams: () => [new URLSearchParams(
    searchParamState.value ? { application: searchParamState.value } : undefined,
  )],
}))

function detail(
  item: TrackerApplicationListItem = applications[0],
): TrackerApplicationDetail {
  return {
    ...item,
    descriptionHtml: null,
    descriptionText: null,
    snapshotPartial: false,
    createdAt: '2026-07-20T15:00:00.000Z',
    resume: null,
    events: [{
      id: '22222222-2222-4222-8222-222222222222',
      applicationId: item.id,
      stage: item.currentStage,
      occurredOn: item.currentStageDate,
      createdAt: '2026-07-28T15:00:00.000Z',
    }],
  }
}

function setCached(queryKey: readonly unknown[], data: unknown) {
  reactQueryHarness.cache.set(reactQueryHarness.keyId(queryKey), { key: queryKey, data })
}

function mutationOptions(scope: string, occurrence = 0) {
  const matches = reactQueryHarness.mutationOptions.filter((options) =>
    (options as { scope?: { id?: string } }).scope?.id === scope)
  const options = matches[occurrence]
  if (!options) throw new Error(`mutation options not found for ${scope} at ${occurrence}`)
  return options as {
    mutationFn: (input: never) => Promise<unknown>
    onSuccess?: (result: unknown, variables: never) => unknown
  }
}

describe('Tracker page contract', () => {
  beforeEach(() => {
    queryState.data = applications
    queryState.error = null
    queryState.isPending = false
    focusQueryState.data = undefined
    focusQueryState.error = null
    focusQueryState.isPending = false
    searchParamState.value = null
    reactQueryHarness.cache.clear()
    reactQueryHarness.mutationOptions.length = 0
    reactQueryHarness.queryOptions.length = 0
    for (const mock of Object.values(reactQueryHarness.queryClient)) mock.mockReset()
    reactQueryHarness.queryClient.getQueriesData.mockImplementation(
      ({ queryKey }: { queryKey: readonly unknown[] }) =>
        [...reactQueryHarness.cache.values()]
          .filter(({ key }) => queryKey.every((part, index) => key[index] === part))
          .map(({ key, data }) => [key, data]),
    )
    reactQueryHarness.queryClient.getQueryData.mockImplementation(
      (queryKey: readonly unknown[]) =>
        reactQueryHarness.cache.get(reactQueryHarness.keyId(queryKey))?.data,
    )
    reactQueryHarness.queryClient.setQueryData.mockImplementation((
      queryKey: readonly unknown[],
      value: unknown | ((current: unknown) => unknown),
    ) => {
      const id = reactQueryHarness.keyId(queryKey)
      const current = reactQueryHarness.cache.get(id)?.data
      const data = typeof value === 'function'
        ? (value as (current: unknown) => unknown)(current)
        : value
      reactQueryHarness.cache.set(id, { key: queryKey, data })
      return data
    })
    reactQueryHarness.queryClient.invalidateQueries.mockResolvedValue(undefined)
    trackerOperations.appendApplicationStage.mockReset()
    trackerOperations.getTrackerApplication.mockReset()
    trackerOperations.updateApplicationStageEvent.mockReset()
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

  it('serializes stage/date writes together and keeps scoped real retry actions', () => {
    for (const field of ['pin', 'notes']) {
      expect(trackerSource).toContain(
        `scope: { id: \`\${application.id}:${field}\` }`,
      )
    }
    expect(trackerSource.match(/scope: \{ id: `\$\{application\.id\}:stage-date` \}/g))
      .toHaveLength(2)
    expect(trackerSource.match(/disabled=\{stageDateMutationPending\}/g)).toHaveLength(2)
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

  it('starts one targeted owned-detail focus query in parallel with the selected list', () => {
    searchParamState.value = applications[0].id
    queryState.isPending = true
    renderToStaticMarkup(<Tracker />)
    const focusOptions = reactQueryHarness.queryOptions.find((options) =>
      JSON.stringify((options as { queryKey: readonly unknown[] }).queryKey)
        === JSON.stringify(['tracker-application', applications[0].id])) as {
          enabled?: boolean
          queryFn: () => Promise<unknown>
        } | undefined

    expect(focusOptions?.enabled).toBe(true)
    expect(focusOptions).toBeDefined()
    expect(trackerSource).toContain('getTrackerApplication(focusApplicationId)')
    expect(trackerSource).not.toContain("queryKey: ['tracker-focus-applications']")
    expect(trackerSource).not.toContain(
      'listTrackerApplications(TRACKER_STAGES.map(({ slug }) => slug))',
    )
    expect(trackerSource).toContain('useSearchParams')
    expect(trackerSource).toContain("searchParams.get('application')")
    expect(trackerSource).toContain('TRACKER_APPLICATION_ID_PATTERN')
    expect(trackerSource).toContain('focusApplicationQuery.data?.currentStage')
    expect(trackerSource).toContain('setSelectedStages([ownedStage])')
    expect(trackerSource).not.toContain('Application not found')
    expect(trackerSource).not.toContain('You do not have access')
  })

  it('patches stage membership across every valid cached list without losing fields', () => {
    const unrelated = { ...applications[0], id: '33333333-3333-4333-8333-333333333333' }
    const keys: Array<[readonly unknown[], TrackerApplicationListItem[]]> = [
      [['tracker-applications', [...TRACKER_ACTIVE_STAGES]], [applications[0], unrelated]],
      [['tracker-applications', [...TRACKER_TERMINAL_STAGES]], [unrelated]],
      [['tracker-applications', TRACKER_STAGES.map(({ slug }) => slug)], [applications[0]]],
      [['tracker-applications', ['offer']], []],
      [['tracker-applications', []], [applications[0]]],
      [['tracker-applications', 'offer'], [applications[0]]],
    ]
    for (const [key, data] of keys) setCached(key, data)
    const terminal = {
      ...applications[0],
      currentStage: 'offer' as TrackerStage,
      currentStageDate: '2026-08-03',
    }

    patchTrackerApplicationCaches(reactQueryHarness.queryClient, terminal)

    expect(reactQueryHarness.queryClient.getQueryData(keys[0][0])).toEqual([unrelated])
    expect(reactQueryHarness.queryClient.getQueryData(keys[1][0])).toContainEqual(terminal)
    expect(reactQueryHarness.queryClient.getQueryData(keys[2][0])).toContainEqual(terminal)
    expect(reactQueryHarness.queryClient.getQueryData(keys[3][0])).toEqual([terminal])
    expect(reactQueryHarness.queryClient.getQueryData(keys[4][0])).toEqual([applications[0]])
    expect(reactQueryHarness.queryClient.getQueryData(keys[5][0])).toEqual([applications[0]])
    expect(terminal.notes).toBe(applications[0].notes)

    const active = { ...terminal, currentStage: 'interview' as TrackerStage }
    patchTrackerApplicationCaches(reactQueryHarness.queryClient, active)
    expect(reactQueryHarness.queryClient.getQueryData(keys[0][0])).toContainEqual(active)
    expect(reactQueryHarness.queryClient.getQueryData(keys[1][0])).toEqual([unrelated])
    expect(reactQueryHarness.queryClient.getQueryData(keys[3][0])).toEqual([])
  })

  it('hands the returned stage event to the serialized date write before any detail fetch', async () => {
    setCached(['tracker-applications', [...TRACKER_ACTIVE_STAGES]], applications)
    setCached(['tracker-application', applications[0].id], detail())
    trackerOperations.appendApplicationStage.mockResolvedValue(
      '44444444-4444-4444-8444-444444444444',
    )
    trackerOperations.updateApplicationStageEvent.mockResolvedValue(undefined)
    renderToStaticMarkup(<Tracker />)
    const scope = `${applications[0].id}:stage-date`
    const stage = mutationOptions(scope, 0)
    const date = mutationOptions(scope, 1)

    const eventId = await stage.mutationFn('offer' as never)
    stage.onSuccess?.(eventId, 'offer' as never)
    await date.mutationFn('2026-08-03' as never)

    expect(trackerOperations.updateApplicationStageEvent).toHaveBeenCalledWith(
      '44444444-4444-4444-8444-444444444444',
      'offer',
      '2026-08-03',
    )
    expect(reactQueryHarness.queryClient.fetchQuery).not.toHaveBeenCalled()
    expect(reactQueryHarness.queryClient.invalidateQueries).toHaveBeenCalled()
  })

  it('resolves a date write from cached detail before fetch fallback', async () => {
    setCached(['tracker-application', applications[0].id], detail())
    trackerOperations.updateApplicationStageEvent.mockResolvedValue(undefined)
    renderToStaticMarkup(<Tracker />)
    const date = mutationOptions(`${applications[0].id}:stage-date`, 1)

    await date.mutationFn('2026-08-03' as never)

    expect(trackerOperations.updateApplicationStageEvent).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      'applied',
      '2026-08-03',
    )
    expect(reactQueryHarness.queryClient.fetchQuery).not.toHaveBeenCalled()
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

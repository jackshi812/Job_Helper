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
import type { DashboardFeedPage, FeedRow } from '../lib/feed'
import {
  DASHBOARD_COLUMN_STORAGE_KEY,
  DASHBOARD_COLUMNS,
  dashboardTableWidth,
  defaultDashboardColumnWidths,
  type ColumnResizeCoordinator,
} from '../lib/dashboardColumns'
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
  deleteApplicationStageEvent: vi.fn(),
  getTrackerApplication: vi.fn(),
  listTrackerApplications: vi.fn(),
  updateApplicationStageEvent: vi.fn(),
}))
const dashboardOperations = vi.hoisted(() => ({
  backfillDashboardFeedRow: vi.fn(),
  dismissJob: vi.fn(),
  listDashboardCompanyOptions: vi.fn(),
  listFeedPage: vi.fn(),
  markJobApplied: vi.fn(),
}))
const preferenceOperations = vi.hoisted(() => ({
  getDeterministicRankingState: vi.fn(),
  loadPreferences: vi.fn(),
}))
const resumeOperations = vi.hoisted(() => ({
  listResumes: vi.fn(),
}))
const authState = vi.hoisted(() => ({ userId: 'user-a' }))
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
    deleteApplicationStageEvent: trackerOperations.deleteApplicationStageEvent,
    getTrackerApplication: trackerOperations.getTrackerApplication,
    listTrackerApplications: trackerOperations.listTrackerApplications,
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

vi.mock('../lib/feed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/feed')>()
  return {
    ...actual,
    backfillDashboardFeedRow: dashboardOperations.backfillDashboardFeedRow,
    dismissJob: dashboardOperations.dismissJob,
    listDashboardCompanyOptions: dashboardOperations.listDashboardCompanyOptions,
    listFeedPage: dashboardOperations.listFeedPage,
    markJobApplied: dashboardOperations.markJobApplied,
  }
})

vi.mock('../lib/preferences', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/preferences')>()
  return {
    ...actual,
    getDeterministicRankingState: preferenceOperations.getDeterministicRankingState,
    loadPreferences: preferenceOperations.loadPreferences,
  }
})

vi.mock('../lib/resumes', () => ({
  listResumes: resumeOperations.listResumes,
  resumeLabel: ({ display_name: displayName, filename }: {
    display_name: string | null
    filename: string
  }) => displayName ?? filename,
  resumeQueryKey: (userId: string) => ['resumes', userId] as const,
}))

vi.mock('../auth/AuthProvider', () => ({
  useSession: () => ({ session: { user: { id: authState.userId } } }),
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
    onError?: (error: Error, variables: never, context?: unknown) => unknown
    onMutate?: (variables: never) => unknown
    onSuccess?: (result: unknown, variables: never, context?: unknown) => unknown
  }
}

describe('Tracker page contract', () => {
  beforeEach(() => {
    dashboardOperations.backfillDashboardFeedRow.mockReset()
    dashboardOperations.dismissJob.mockReset()
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
    trackerOperations.listTrackerApplications.mockReset()
    trackerOperations.updateApplicationStageEvent.mockReset()
    resumeOperations.listResumes.mockReset()
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
    expect(trackerSource).toContain("queryKey: resumeQueryKey(session?.user.id ?? '')")
    expect(trackerSource).toContain('enabled: session !== null && expandedIds.size > 0')
    expect(trackerSource).toContain('staleTime: Infinity')
    expect(trackerSource).toContain('resumes={resumesQuery.data ?? EMPTY_RESUMES}')
    expect(trackerSource).toContain('resumesPending={resumesQuery.isPending}')
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
    expect(trackerSource).toMatch(/getTrackerApplication\(focusApplicationId(?: as string)?\)/)
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

    patchTrackerApplicationCaches(
      reactQueryHarness.queryClient as unknown as Parameters<
        typeof patchTrackerApplicationCaches
      >[0],
      terminal,
    )

    expect(reactQueryHarness.queryClient.getQueryData(keys[0][0])).toEqual([unrelated])
    expect(reactQueryHarness.queryClient.getQueryData(keys[1][0])).toContainEqual(terminal)
    expect(reactQueryHarness.queryClient.getQueryData(keys[2][0])).toContainEqual(terminal)
    expect(reactQueryHarness.queryClient.getQueryData(keys[3][0])).toEqual([terminal])
    expect(reactQueryHarness.queryClient.getQueryData(keys[4][0])).toEqual([applications[0]])
    expect(reactQueryHarness.queryClient.getQueryData(keys[5][0])).toEqual([applications[0]])
    expect(terminal.notes).toBe(applications[0].notes)

    const active = { ...terminal, currentStage: 'interview' as TrackerStage }
    patchTrackerApplicationCaches(
      reactQueryHarness.queryClient as unknown as Parameters<
        typeof patchTrackerApplicationCaches
      >[0],
      active,
    )
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
    reactQueryHarness.queryClient.invalidateQueries.mockReturnValue(
      new Promise<void>(() => undefined),
    )
    renderToStaticMarkup(<Tracker />)
    const scope = `${applications[0].id}:stage-date`
    const stage = mutationOptions(scope, 0)
    const date = mutationOptions(scope, 1)

    const stageContext = stage.onMutate?.('offer' as never) as { attemptId: number }
    const eventId = await stage.mutationFn('offer' as never)
    const stageSettlement = stage.onSuccess?.(eventId, 'offer' as never, stageContext)
    const dateInput = {
      occurredOn: '2026-08-01',
      dependentAttemptId: stageContext.attemptId,
    }
    const dateResult = await date.mutationFn(dateInput as never)
    const dateSettlement = date.onSuccess?.(dateResult, dateInput as never)

    expect(stageSettlement).toBeUndefined()
    expect(dateSettlement).toBeUndefined()
    expect(trackerOperations.updateApplicationStageEvent).toHaveBeenCalledWith(
      '44444444-4444-4444-8444-444444444444',
      'offer',
      '2026-08-01',
    )
    expect(reactQueryHarness.queryClient.fetchQuery).not.toHaveBeenCalled()
    expect(reactQueryHarness.queryClient.invalidateQueries).toHaveBeenCalledTimes(6)
    expect(reactQueryHarness.queryClient.getQueryData(
      ['tracker-application', applications[0].id],
    )).toMatchObject({ currentStage: 'offer' })
    expect((reactQueryHarness.queryClient.getQueryData(
      ['tracker-application', applications[0].id],
    ) as TrackerApplicationDetail).currentStageDate).not.toBe('2026-08-01')
  })

  it('uses a version-matched cached current event without a pre-write detail fetch', async () => {
    setCached(['tracker-application', applications[0].id], detail())
    trackerOperations.updateApplicationStageEvent.mockResolvedValue(undefined)
    renderToStaticMarkup(<Tracker />)
    const date = mutationOptions(`${applications[0].id}:stage-date`, 1)

    await date.mutationFn({
      occurredOn: '2026-08-03',
      dependentAttemptId: null,
    } as never)

    expect(trackerOperations.updateApplicationStageEvent).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      'applied',
      '2026-08-03',
    )
    expect(reactQueryHarness.queryClient.fetchQuery).not.toHaveBeenCalled()
  })

  it('fetches authoritative detail when the cached application version is stale', async () => {
    const serverCurrentEvent = {
      ...detail().events[0],
      id: '33333333-3333-4333-8333-333333333333',
      stage: 'interview' as const,
      occurredOn: '2026-08-02',
      createdAt: '2026-08-02T15:00:00.000Z',
    }
    setCached(
      ['tracker-application', applications[0].id],
      { ...detail(), updatedAt: '2026-07-27T15:00:00.000Z' },
    )
    reactQueryHarness.queryClient.fetchQuery.mockResolvedValue({
      ...detail(),
      currentStage: 'interview',
      currentStageDate: '2026-08-02',
      updatedAt: '2026-08-02T15:00:00.000Z',
      events: [...detail().events, serverCurrentEvent],
    })
    trackerOperations.updateApplicationStageEvent.mockResolvedValue(undefined)
    renderToStaticMarkup(<Tracker />)
    const date = mutationOptions(`${applications[0].id}:stage-date`, 1)

    await date.mutationFn({
      occurredOn: '2026-08-03',
      dependentAttemptId: null,
    } as never)

    expect(reactQueryHarness.queryClient.fetchQuery).toHaveBeenCalledTimes(1)
    expect(reactQueryHarness.queryClient.fetchQuery).toHaveBeenCalledWith(
      expect.objectContaining({ staleTime: 0 }),
    )
    expect(trackerOperations.updateApplicationStageEvent).toHaveBeenCalledWith(
      serverCurrentEvent.id,
      'interview',
      '2026-08-03',
    )
  })

  it('fetches detail for a date write only when no authoritative or cached event exists', async () => {
    reactQueryHarness.queryClient.fetchQuery.mockResolvedValue(detail())
    trackerOperations.updateApplicationStageEvent.mockResolvedValue(undefined)
    renderToStaticMarkup(<Tracker />)
    const date = mutationOptions(`${applications[0].id}:stage-date`, 1)

    await date.mutationFn({
      occurredOn: '2026-08-03',
      dependentAttemptId: null,
    } as never)

    expect(reactQueryHarness.queryClient.fetchQuery).toHaveBeenCalledTimes(1)
    expect(trackerOperations.getTrackerApplication).not.toHaveBeenCalled()
    expect(trackerOperations.updateApplicationStageEvent).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      'applied',
      '2026-08-03',
    )
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

class TestEvent {
  readonly type: string
  readonly bubbles: boolean
  target: TestElement | null = null
  currentTarget: TestNode | null = null
  defaultPrevented = false
  cancelBubble = false
  returnValue = true
  timeStamp = Date.now()

  constructor(type: string, init: { bubbles?: boolean } = {}) {
    this.type = type
    this.bubbles = init.bubbles ?? true
  }

  preventDefault() {
    this.defaultPrevented = true
    this.returnValue = false
  }

  stopPropagation() {
    this.cancelBubble = true
  }
}

function pointerEvent(
  type: string,
  init: {
    pointerId?: number
    clientX?: number
    button?: number
    isPrimary?: boolean
  } = {},
) {
  return Object.assign(new TestEvent(type), {
    pointerId: init.pointerId ?? 1,
    clientX: init.clientX ?? 0,
    button: init.button ?? 0,
    isPrimary: init.isPrimary ?? true,
  })
}

function keyboardEvent(key: string, shiftKey = false) {
  return Object.assign(new TestEvent('keydown'), { key, shiftKey })
}

type TestListener = (event: TestEvent) => void

class TestNode {
  readonly nodeType: number
  readonly ownerDocument: TestDocument
  parentNode: TestNode | null = null
  childNodes: TestNode[] = []
  nodeValue: string | null = null
  private listeners = new Map<string, Array<{
    callback: TestListener
    capture: boolean
  }>>()

  constructor(nodeType: number, ownerDocument: TestDocument) {
    this.nodeType = nodeType
    this.ownerDocument = ownerDocument
  }

  get firstChild() {
    return this.childNodes[0] ?? null
  }

  get lastChild(): TestNode | null {
    return this.childNodes.at(-1) ?? null
  }

  get textContent(): string {
    if (this.nodeType === 3 || this.nodeType === 8) return this.nodeValue ?? ''
    return this.childNodes.map((child) => child.textContent).join('')
  }

  set textContent(value: string) {
    this.childNodes = []
    if (value !== '') this.appendChild(this.ownerDocument.createTextNode(value))
  }

  appendChild<T extends TestNode>(child: T): T {
    child.parentNode?.removeChild(child)
    child.parentNode = this
    this.childNodes.push(child)
    return child
  }

  insertBefore<T extends TestNode>(child: T, before: TestNode | null): T {
    if (before === null) return this.appendChild(child)
    child.parentNode?.removeChild(child)
    const index = this.childNodes.indexOf(before)
    if (index < 0) throw new Error('reference node not found')
    child.parentNode = this
    this.childNodes.splice(index, 0, child)
    return child
  }

  removeChild<T extends TestNode>(child: T): T {
    const index = this.childNodes.indexOf(child)
    if (index < 0) throw new Error('child node not found')
    this.childNodes.splice(index, 1)
    child.parentNode = null
    return child
  }

  contains(candidate: TestNode | null): boolean {
    let current = candidate
    while (current) {
      if (current === this) return true
      current = current.parentNode
    }
    return false
  }

  addEventListener(
    type: string,
    callback: TestListener,
    options?: boolean | { capture?: boolean },
  ) {
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture)
    const listeners = this.listeners.get(type) ?? []
    listeners.push({ callback, capture })
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, callback: TestListener) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((listener) => listener.callback !== callback),
    )
  }

  dispatchEvent(event: TestEvent): boolean {
    event.target = this as unknown as TestElement
    const path: TestNode[] = []
    function appendPath(node: TestNode) {
      path.push(node)
      if (node.parentNode) appendPath(node.parentNode)
    }
    appendPath(this)
    for (const node of [...path].reverse()) {
      for (const listener of node.listeners.get(event.type) ?? []) {
        if (!listener.capture) continue
        event.currentTarget = node
        listener.callback(event)
        if (event.cancelBubble) return !event.defaultPrevented
      }
    }
    for (const node of path) {
      for (const listener of node.listeners.get(event.type) ?? []) {
        if (listener.capture) continue
        event.currentTarget = node
        listener.callback(event)
        if (event.cancelBubble || !event.bubbles) return !event.defaultPrevented
      }
    }
    return !event.defaultPrevented
  }
}

class TestTextNode extends TestNode {
  constructor(value: string, ownerDocument: TestDocument, nodeType = 3) {
    super(nodeType, ownerDocument)
    this.nodeValue = value
  }
}

class TestElement extends TestNode {
  readonly tagName: string
  readonly nodeName: string
  readonly namespaceURI = 'http://www.w3.org/1999/xhtml'
  readonly style: Record<string, string> & { setProperty: (name: string, value: string) => void }
  readonly attributes = new Map<string, string>()
  readonly capturedPointerIds = new Set<number>()
  readonly releasedPointerIds: number[] = []
  scrollIntoViewCalls = 0
  _value = ''
  _checked = false
  selected = false

  constructor(tagName: string, ownerDocument: TestDocument) {
    super(1, ownerDocument)
    this.tagName = tagName.toUpperCase()
    this.nodeName = this.tagName
    const style = {} as TestElement['style']
    style.cursor = ''
    style.userSelect = ''
    style.setProperty = (name, value) => {
      style[name] = value
    }
    this.style = style
  }

  get value() {
    if (this.tagName === 'SELECT') {
      return this.options.find((option) => option.selected)?.value ?? this._value
    }
    if (this.tagName === 'OPTION') {
      return this.attributes.get('value') ?? this.textContent
    }
    return this._value
  }

  set value(value: string) {
    this._value = String(value)
    if (this.tagName === 'SELECT') {
      for (const option of this.options) option.selected = option.value === this._value
    }
  }

  get checked() {
    return this._checked
  }

  set checked(value: boolean) {
    this._checked = Boolean(value)
  }

  get options(): TestElement[] {
    return this.childNodes.filter(
      (child): child is TestElement => child instanceof TestElement && child.tagName === 'OPTION',
    )
  }

  get disabled() {
    return this.attributes.has('disabled')
  }

  set disabled(value: boolean) {
    if (value) this.attributes.set('disabled', '')
    else this.attributes.delete('disabled')
  }

  setAttribute(name: string, value: unknown) {
    this.attributes.set(name, String(value))
    if (name === 'value') this._value = String(value)
    if (name === 'disabled') this.disabled = true
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null
  }

  hasAttribute(name: string) {
    return this.attributes.has(name)
  }

  removeAttribute(name: string) {
    this.attributes.delete(name)
  }

  setPointerCapture(pointerId: number) {
    this.capturedPointerIds.add(pointerId)
  }

  releasePointerCapture(pointerId: number) {
    this.capturedPointerIds.delete(pointerId)
    this.releasedPointerIds.push(pointerId)
  }

  hasPointerCapture(pointerId: number) {
    return this.capturedPointerIds.has(pointerId)
  }

  focus() {
    this.ownerDocument.activeElement = this
  }

  blur() {
    if (this.ownerDocument.activeElement === this) {
      this.ownerDocument.activeElement = this.ownerDocument.body
    }
  }

  scrollIntoView() {
    this.scrollIntoViewCalls += 1
  }
}

class TestDocument extends TestNode {
  readonly documentElement: TestElement
  readonly body: TestElement
  activeElement: TestElement
  defaultView: Record<string, unknown> = {}
  oninput: unknown = null

  constructor() {
    super(9, undefined as unknown as TestDocument)
    ;(this as { ownerDocument: TestDocument }).ownerDocument = this
    this.documentElement = new TestElement('html', this)
    this.body = new TestElement('body', this)
    this.documentElement.appendChild(this.body)
    this.appendChild(this.documentElement)
    this.activeElement = this.body
  }

  createElement(tagName: string) {
    return new TestElement(tagName, this)
  }

  createElementNS(_namespace: string, tagName: string) {
    return this.createElement(tagName)
  }

  createTextNode(value: string) {
    return new TestTextNode(value, this)
  }

  createComment(value: string) {
    return new TestTextNode(value, this, 8)
  }

  getElementById(id: string) {
    return findTestElement(this, (element) => element.getAttribute('id') === id)
  }
}

function findTestElement(
  root: TestNode,
  predicate: (element: TestElement) => boolean,
): TestElement | null {
  for (const child of root.childNodes) {
    if (child instanceof TestElement && predicate(child)) return child
    const nested = findTestElement(child, predicate)
    if (nested) return nested
  }
  return null
}

function findTestElements(
  root: TestNode,
  predicate: (element: TestElement) => boolean,
): TestElement[] {
  const matches: TestElement[] = []
  for (const child of root.childNodes) {
    if (child instanceof TestElement && predicate(child)) matches.push(child)
    matches.push(...findTestElements(child, predicate))
  }
  return matches
}

function nativeSetValue(element: TestElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(TestElement.prototype, 'value')?.set
  if (!setter) throw new Error('native value setter not found')
  setter.call(element, value)
}

function nativeSetChecked(element: TestElement, checked: boolean) {
  const setter = Object.getOwnPropertyDescriptor(TestElement.prototype, 'checked')?.set
  if (!setter) throw new Error('native checked setter not found')
  setter.call(element, checked)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, reject, resolve }
}

function installTestDom() {
  const document = new TestDocument()
  const windowListeners = new Map<string, TestListener[]>()
  const intervalCallbacks = new Map<number, () => void>()
  const timeoutCallbacks = new Map<number, { callback: () => void; delay: number }>()
  const storage = new Map<string, string>()
  const storageWrites: Array<{ key: string; value: string }> = []
  const animationFrameCallbacks = new Map<number, (timestamp: number) => void>()
  const cancelledAnimationFrameCallbacks = new Map<number, (timestamp: number) => void>()
  let nextIntervalId = 1
  let nextTimeoutId = 1
  let nextAnimationFrameId = 1
  const window = {
    document,
    Event: TestEvent,
    Node: TestNode,
    Element: TestElement,
    HTMLElement: TestElement,
    HTMLInputElement: TestElement,
    HTMLSelectElement: TestElement,
    HTMLTextAreaElement: TestElement,
    HTMLIFrameElement: class TestIFrameElement extends TestElement {},
    SVGElement: TestElement,
    __intervalCallbacks: intervalCallbacks,
    __animationFrameCallbacks: animationFrameCallbacks,
    __cancelledAnimationFrameCallbacks: cancelledAnimationFrameCallbacks,
    __runAnimationFrame: (id: number) => {
      const callback = animationFrameCallbacks.get(id)
      animationFrameCallbacks.delete(id)
      callback?.(16)
    },
    __runCancelledAnimationFrame: (id: number) => {
      cancelledAnimationFrameCallbacks.get(id)?.(16)
    },
    __storage: storage,
    __storageWrites: storageWrites,
    __runTimeout: (id: number) => {
      const timeout = timeoutCallbacks.get(id)
      timeoutCallbacks.delete(id)
      timeout?.callback()
    },
    __timeoutCallbacks: timeoutCallbacks,
    addEventListener: (type: string, listener: TestListener) => {
      windowListeners.set(type, [...(windowListeners.get(type) ?? []), listener])
    },
    clearInterval: (id: number) => intervalCallbacks.delete(id),
    cancelAnimationFrame: (id: number) => {
      const callback = animationFrameCallbacks.get(id)
      animationFrameCallbacks.delete(id)
      if (callback) cancelledAnimationFrameCallbacks.set(id, callback)
    },
    clearTimeout: (id: number) => timeoutCallbacks.delete(id),
    dispatchEvent: (event: TestEvent) => {
      for (const listener of windowListeners.get(event.type) ?? []) listener(event)
      return !event.defaultPrevented
    },
    getComputedStyle: () => ({}),
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => {
        storage.set(key, value)
        storageWrites.push({ key, value })
      },
    },
    location: {
      hash: '',
      href: 'http://localhost/',
      pathname: '/',
      protocol: 'http:',
      reload: vi.fn(),
      search: '',
    },
    removeEventListener: (type: string, listener: TestListener) => {
      windowListeners.set(
        type,
        (windowListeners.get(type) ?? []).filter((candidate) => candidate !== listener),
      )
    },
    requestAnimationFrame: (callback: (timestamp: number) => void) => {
      const id = nextAnimationFrameId++
      animationFrameCallbacks.set(id, callback)
      return id
    },
    setInterval: (callback: () => void) => {
      const id = nextIntervalId++
      intervalCallbacks.set(id, callback)
      return id
    },
    setTimeout: (callback: () => void, delay = 0) => {
      const id = nextTimeoutId++
      timeoutCallbacks.set(id, { callback, delay })
      return id
    },
  }
  document.defaultView = window
  vi.stubGlobal('document', document)
  vi.stubGlobal('window', window)
  vi.stubGlobal('Node', TestNode)
  vi.stubGlobal('Element', TestElement)
  vi.stubGlobal('HTMLElement', TestElement)
  vi.stubGlobal('HTMLInputElement', TestElement)
  vi.stubGlobal('HTMLSelectElement', TestElement)
  vi.stubGlobal('HTMLTextAreaElement', TestElement)
  vi.stubGlobal('Event', TestEvent)
  vi.stubGlobal('navigator', { userAgent: 'test' })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  return document
}

async function loadMountedTracker() {
  vi.resetModules()
  vi.doUnmock('@tanstack/react-query')
  const react = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
  const { Tracker: MountedTracker } = await import('./Tracker')
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return { createRoot, MountedTracker, QueryClientProvider, queryClient, react }
}

async function loadMountedDashboard() {
  vi.resetModules()
  vi.doUnmock('@tanstack/react-query')
  const react = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
  const { Dashboard: MountedDashboard } = await import('./Dashboard')
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return { createRoot, MountedDashboard, QueryClientProvider, queryClient, react }
}

async function loadMountedColumnResizeHandle() {
  vi.resetModules()
  const react = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ColumnResizeHandle: MountedColumnResizeHandle } =
    await import('../components/ColumnResizeHandle')
  return { createRoot, MountedColumnResizeHandle, react }
}

async function flushMountedWork(act: (callback: () => Promise<void>) => Promise<void>) {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
}

describe('Tracker mounted performance invariants', () => {
  beforeEach(() => {
    authState.userId = 'user-a'
    searchParamState.value = null
    trackerOperations.appendApplicationStage.mockReset()
    trackerOperations.deleteApplicationStageEvent.mockReset()
    trackerOperations.getTrackerApplication.mockReset()
    trackerOperations.listTrackerApplications.mockReset()
    trackerOperations.updateApplicationStageEvent.mockReset()
    resumeOperations.listResumes.mockReset()
    resumeOperations.listResumes.mockResolvedValue([])
  })

  it('reuses one parent-owned resume request across sequential row expansions', async () => {
    const document = installTestDom()
    const secondApplication: TrackerApplicationListItem = {
      ...applications[0],
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      title: 'Investment Analyst',
    }
    const visibleApplications = [applications[0], secondApplication]
    const resume = {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      filename: 'primary.docx',
      display_name: 'Primary resume',
      storage_path: 'user/primary.docx',
      size_bytes: 1024,
      created_at: '2026-08-04T00:00:00.000Z',
    }
    trackerOperations.listTrackerApplications.mockResolvedValue(visibleApplications)
    trackerOperations.getTrackerApplication.mockImplementation(async (id: string) => {
      const application = visibleApplications.find((candidate) => candidate.id === id)
      if (!application) throw new Error('missing application')
      return detail(application)
    })
    resumeOperations.listResumes.mockResolvedValue([resume])
    const {
      createRoot,
      MountedTracker,
      QueryClientProvider,
      queryClient,
      react,
    } = await loadMountedTracker()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container as unknown as Element)
    const tree = () => react.createElement(
      QueryClientProvider,
      { client: queryClient },
      react.createElement(MountedTracker),
    )

    await react.act(async () => root.render(tree()))
    await flushMountedWork(react.act)
    const showFirst = findTestElement(container, (element) =>
      element.getAttribute('aria-label') === 'Show details for Data Analyst')
    if (!showFirst) throw new Error('first expand button not mounted')
    await react.act(async () => showFirst.dispatchEvent(new TestEvent('click')))
    await flushMountedWork(react.act)

    expect(resumeOperations.listResumes).toHaveBeenCalledOnce()
    const firstSelect = findTestElement(container, (element) =>
      element.getAttribute('id') === `resume-${applications[0].id}`)
    expect(findTestElement(firstSelect!, (element) =>
      element.tagName === 'OPTION' && element.textContent === 'Primary resume')).not.toBeNull()

    const hideFirst = findTestElement(container, (element) =>
      element.getAttribute('aria-label') === 'Hide details for Data Analyst')
    if (!hideFirst) throw new Error('first collapse button not mounted')
    await react.act(async () => hideFirst.dispatchEvent(new TestEvent('click')))
    const showSecond = findTestElement(container, (element) =>
      element.getAttribute('aria-label') === 'Show details for Investment Analyst')
    if (!showSecond) throw new Error('second expand button not mounted')
    await react.act(async () => showSecond.dispatchEvent(new TestEvent('click')))
    await flushMountedWork(react.act)

    expect(resumeOperations.listResumes).toHaveBeenCalledOnce()
    const secondSelect = findTestElement(container, (element) =>
      element.getAttribute('id') === `resume-${secondApplication.id}`)
    expect(findTestElement(secondSelect!, (element) =>
      element.tagName === 'OPTION' && element.textContent === 'Primary resume')).not.toBeNull()

    await react.act(async () => root.unmount())
    vi.unstubAllGlobals()
  })

  it('does not reuse cached resume options after the authenticated user changes', async () => {
    const document = installTestDom()
    const userAResume = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      filename: 'user-a.docx',
      display_name: 'User A private resume',
      storage_path: 'user-a/private.docx',
      size_bytes: 1024,
      created_at: '2026-08-04T00:00:00.000Z',
    }
    const userBResume = {
      ...userAResume,
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      filename: 'user-b.docx',
      display_name: 'User B resume',
      storage_path: 'user-b/resume.docx',
    }
    trackerOperations.listTrackerApplications.mockResolvedValue(applications)
    trackerOperations.getTrackerApplication.mockResolvedValue(detail())
    resumeOperations.listResumes.mockImplementation(async () =>
      authState.userId === 'user-a' ? [userAResume] : [userBResume])
    const {
      createRoot,
      MountedTracker,
      QueryClientProvider,
      queryClient,
      react,
    } = await loadMountedTracker()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container as unknown as Element)
    const tree = () => react.createElement(
      QueryClientProvider,
      { client: queryClient },
      react.createElement(MountedTracker),
    )

    await react.act(async () => root.render(tree()))
    await flushMountedWork(react.act)
    const expand = findTestElement(container, (element) =>
      element.getAttribute('aria-label') === 'Show details for Data Analyst')
    if (!expand) throw new Error('expand button not mounted')
    await react.act(async () => expand.dispatchEvent(new TestEvent('click')))
    await flushMountedWork(react.act)
    expect(container.textContent).toContain('User A private resume')

    authState.userId = 'user-b'
    await react.act(async () => root.render(tree()))
    await flushMountedWork(react.act)

    expect(resumeOperations.listResumes).toHaveBeenCalledTimes(2)
    expect(container.textContent).not.toContain('User A private resume')
    expect(container.textContent).toContain('User B resume')
    expect(queryClient.getQueryData(['resumes', 'user-a'])).toEqual([userAResume])
    expect(queryClient.getQueryData(['resumes', 'user-b'])).toEqual([userBResume])

    await react.act(async () => root.unmount())
    vi.unstubAllGlobals()
  })

  it('focuses the same application again after the normalized deep-link disappears', async () => {
    const document = installTestDom()
    searchParamState.value = applications[0].id
    trackerOperations.listTrackerApplications.mockResolvedValue(applications)
    trackerOperations.getTrackerApplication.mockResolvedValue(detail())
    const {
      createRoot,
      MountedTracker,
      QueryClientProvider,
      queryClient,
      react,
    } = await loadMountedTracker()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container as unknown as Element)
    const tree = () => react.createElement(
      QueryClientProvider,
      { client: queryClient },
      react.createElement(MountedTracker),
    )

    await react.act(async () => root.render(tree()))
    await flushMountedWork(react.act)
    const expandButton = findTestElement(container, (element) =>
      element.getAttribute('aria-label') === 'Hide details for Data Analyst')
    expect(expandButton?.scrollIntoViewCalls).toBe(1)

    searchParamState.value = null
    await react.act(async () => root.render(tree()))
    await flushMountedWork(react.act)
    searchParamState.value = applications[0].id
    await react.act(async () => root.render(tree()))
    await flushMountedWork(react.act)

    expect(expandButton?.scrollIntoViewCalls).toBe(2)
    expect(document.activeElement).toBe(expandButton)

    await react.act(async () => root.unmount())
    vi.unstubAllGlobals()
  })

  it('filters, expands, scrolls, and focuses a terminal deep-link only after its row loads', async () => {
    const document = installTestDom()
    const target = {
      ...applications[0],
      currentStage: 'offer' as const,
      currentStageDate: '2026-08-03',
    }
    const activeList = deferred<TrackerApplicationListItem[]>()
    const terminalList = deferred<TrackerApplicationListItem[]>()
    const ownedDetail = deferred<TrackerApplicationDetail>()
    searchParamState.value = target.id
    trackerOperations.listTrackerApplications.mockImplementation(
      (selectedStages: readonly TrackerStage[]) =>
        selectedStages.length === 1 && selectedStages[0] === 'offer'
          ? terminalList.promise
          : activeList.promise,
    )
    trackerOperations.getTrackerApplication.mockReturnValue(ownedDetail.promise)
    const {
      createRoot,
      MountedTracker,
      QueryClientProvider,
      queryClient,
      react,
    } = await loadMountedTracker()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container as unknown as Element)

    await react.act(async () => {
      root.render(react.createElement(
        QueryClientProvider,
        { client: queryClient },
        react.createElement(MountedTracker),
      ))
    })

    expect(trackerOperations.listTrackerApplications).toHaveBeenCalledWith(
      TRACKER_ACTIVE_STAGES,
    )
    expect(trackerOperations.getTrackerApplication).toHaveBeenCalledWith(target.id)
    expect(trackerOperations.listTrackerApplications).toHaveBeenCalledTimes(1)

    await react.act(async () => {
      ownedDetail.resolve(detail(target))
      activeList.resolve([])
      await Promise.resolve()
    })
    await flushMountedWork(react.act)

    expect(trackerOperations.listTrackerApplications).toHaveBeenLastCalledWith(['offer'])
    expect(trackerOperations.listTrackerApplications).toHaveBeenCalledTimes(2)
    expect(findTestElement(container, (element) =>
      element.getAttribute('aria-label') === 'Show details for Data Analyst')).toBeNull()

    await react.act(async () => {
      terminalList.resolve([target])
      await Promise.resolve()
    })
    await flushMountedWork(react.act)

    const expandButton = findTestElement(container, (element) =>
      element.getAttribute('aria-label') === 'Hide details for Data Analyst')
    expect(expandButton).not.toBeNull()
    expect(expandButton?.getAttribute('aria-expanded')).toBe('true')
    expect(expandButton?.scrollIntoViewCalls).toBe(1)
    expect(document.activeElement).toBe(expandButton)
    expect(trackerOperations.getTrackerApplication.mock.calls.every(([id]) =>
      id === target.id)).toBe(true)
    expect(trackerOperations.listTrackerApplications.mock.calls.some(([stages]) =>
      Array.isArray(stages) && stages.length === TRACKER_STAGES.length)).toBe(false)

    await react.act(async () => root.unmount())
    vi.unstubAllGlobals()
  })

  it('keeps live stage/date controls pending and queues the date against the new event', async () => {
    const document = installTestDom()
    const stageWrite = deferred<string>()
    trackerOperations.listTrackerApplications.mockResolvedValue(applications)
    trackerOperations.appendApplicationStage.mockReturnValue(stageWrite.promise)
    trackerOperations.updateApplicationStageEvent.mockResolvedValue(undefined)
    const {
      createRoot,
      MountedTracker,
      QueryClientProvider,
      queryClient,
      react,
    } = await loadMountedTracker()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container as unknown as Element)

    await react.act(async () => {
      root.render(react.createElement(
        QueryClientProvider,
        { client: queryClient },
        react.createElement(MountedTracker),
      ))
    })
    await flushMountedWork(react.act)

    const stageControl = findTestElement(container, (element) =>
      element.getAttribute('id') === `stage-${applications[0].id}`)
    const dateControl = findTestElement(container, (element) =>
      element.getAttribute('id') === `date-${applications[0].id}`)
    if (!stageControl || !dateControl) throw new Error('stage/date controls not mounted')

    await react.act(async () => {
      nativeSetValue(stageControl, 'offer')
      stageControl.dispatchEvent(new TestEvent('change'))
      nativeSetValue(dateControl, '2026-08-03')
      dateControl.dispatchEvent(new TestEvent('input'))
      dateControl.dispatchEvent(new TestEvent('change'))
      await Promise.resolve()
    })
    expect(dateControl.value).toBe('2026-08-03')
    await react.act(async () => {
      const enter = new TestEvent('keydown') as TestEvent & { key: string }
      enter.key = 'Enter'
      dateControl.dispatchEvent(enter)
      await Promise.resolve()
    })

    expect(stageControl.disabled).toBe(true)
    expect(dateControl.disabled).toBe(true)
    expect(trackerOperations.appendApplicationStage).toHaveBeenCalledWith(
      applications[0].id,
      'offer',
    )
    expect(trackerOperations.updateApplicationStageEvent).not.toHaveBeenCalled()
    expect(queryClient.getMutationCache().getAll()).toHaveLength(2)

    await react.act(async () => {
      stageWrite.resolve('44444444-4444-4444-8444-444444444444')
      await Promise.resolve()
    })
    await flushMountedWork(react.act)

    expect(trackerOperations.updateApplicationStageEvent).toHaveBeenCalledWith(
      '44444444-4444-4444-8444-444444444444',
      'offer',
      '2026-08-03',
    )
    expect(
      trackerOperations.updateApplicationStageEvent.mock.invocationCallOrder[0],
    ).toBeGreaterThan(
      trackerOperations.appendApplicationStage.mock.invocationCallOrder[0],
    )
    expect(stageControl.disabled).toBe(false)
    expect(dateControl.disabled).toBe(false)

    const stagedEventId = '44444444-4444-4444-8444-444444444444'
    let authoritativeDetail: TrackerApplicationDetail = {
      ...detail(),
      currentStage: 'offer',
      currentStageDate: '2026-08-03',
      events: [
        ...detail().events,
        {
          id: stagedEventId,
          applicationId: applications[0].id,
          stage: 'offer',
          occurredOn: '2026-08-03',
          createdAt: '2026-08-03T12:00:00.000Z',
        },
      ],
    }
    trackerOperations.getTrackerApplication.mockImplementation(
      async () => authoritativeDetail,
    )
    trackerOperations.updateApplicationStageEvent.mockImplementation(
      async (eventId: string, stage: TrackerStage, occurredOn: string) => {
        authoritativeDetail = {
          ...authoritativeDetail,
          events: authoritativeDetail.events.map((event) =>
            event.id === eventId ? { ...event, stage, occurredOn } : event),
        }
      },
    )
    trackerOperations.deleteApplicationStageEvent.mockImplementation(
      async (eventId: string) => {
        authoritativeDetail = {
          ...authoritativeDetail,
          events: authoritativeDetail.events.filter(({ id }) => id !== eventId),
        }
      },
    )

    const expandButton = findTestElement(container, (element) =>
      element.getAttribute('aria-label') === 'Show details for Data Analyst')
    await react.act(async () => expandButton?.dispatchEvent(new TestEvent('click')))
    await flushMountedWork(react.act)

    const editApplied = findTestElement(container, (element) =>
      element.getAttribute('aria-label')?.startsWith('Edit Applied from') ?? false)
    if (!editApplied) throw new Error(`applied timeline event not mounted: ${container.textContent}`)
    await react.act(async () => editApplied?.dispatchEvent(new TestEvent('click')))
    await flushMountedWork(react.act)
    const saveEvent = findTestElement(container, (element) => element.textContent === 'Save event')
    const editorForm = saveEvent?.parentNode?.parentNode
    const timelineDate = editorForm
      ? findTestElement(editorForm, (element) => element.tagName === 'INPUT')
      : null
    if (!editorForm || !timelineDate) {
      throw new Error(`timeline editor not mounted: ${container.textContent}`)
    }
    await react.act(async () => {
      nativeSetValue(timelineDate, '2026-08-01')
      timelineDate.dispatchEvent(new TestEvent('input'))
      timelineDate.dispatchEvent(new TestEvent('change'))
      editorForm.dispatchEvent(new TestEvent('submit'))
      await Promise.resolve()
    })
    await flushMountedWork(react.act)

    const editOffer = findTestElement(container, (element) =>
      element.getAttribute('aria-label')?.startsWith('Edit Offer from') ?? false)
    await react.act(async () => editOffer?.dispatchEvent(new TestEvent('click')))
    const requestDelete = findTestElement(container, (element) =>
      element.textContent === 'Delete event')
    await react.act(async () => requestDelete?.dispatchEvent(new TestEvent('click')))
    const deleteButtons = findTestElements(container, (element) =>
      element.textContent === 'Delete event')
    const confirmDelete = deleteButtons.at(-1)
    await react.act(async () => {
      confirmDelete?.dispatchEvent(new TestEvent('click'))
      await Promise.resolve()
    })
    await flushMountedWork(react.act)

    trackerOperations.updateApplicationStageEvent.mockClear()
    await react.act(async () => {
      nativeSetValue(dateControl, '2026-08-04')
      dateControl.dispatchEvent(new TestEvent('input'))
      dateControl.dispatchEvent(new TestEvent('change'))
      const enter = new TestEvent('keydown') as TestEvent & { key: string }
      enter.key = 'Enter'
      dateControl.dispatchEvent(enter)
      await Promise.resolve()
    })
    await flushMountedWork(react.act)

    expect(trackerOperations.updateApplicationStageEvent).toHaveBeenCalledWith(
      detail().events[0].id,
      'applied',
      '2026-08-04',
    )
    expect(trackerOperations.updateApplicationStageEvent).not.toHaveBeenCalledWith(
      stagedEventId,
      expect.anything(),
      expect.anything(),
    )

    await react.act(async () => root.unmount())
    vi.unstubAllGlobals()
  })

  it('aborts a queued date write when its exact stage attempt fails', async () => {
    const document = installTestDom()
    const stageWrite = deferred<string>()
    trackerOperations.listTrackerApplications.mockResolvedValue(applications)
    trackerOperations.appendApplicationStage.mockReturnValue(stageWrite.promise)
    trackerOperations.updateApplicationStageEvent.mockResolvedValue(undefined)
    const {
      createRoot,
      MountedTracker,
      QueryClientProvider,
      queryClient,
      react,
    } = await loadMountedTracker()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container as unknown as Element)

    await react.act(async () => root.render(react.createElement(
      QueryClientProvider,
      { client: queryClient },
      react.createElement(MountedTracker),
    )))
    await flushMountedWork(react.act)
    const stageControl = findTestElement(container, (element) =>
      element.getAttribute('id') === `stage-${applications[0].id}`)
    const dateControl = findTestElement(container, (element) =>
      element.getAttribute('id') === `date-${applications[0].id}`)
    if (!stageControl || !dateControl) throw new Error('stage/date controls not mounted')

    await react.act(async () => {
      nativeSetValue(stageControl, 'offer')
      stageControl.dispatchEvent(new TestEvent('change'))
      nativeSetValue(dateControl, '2026-08-03')
      dateControl.dispatchEvent(new TestEvent('input'))
      dateControl.dispatchEvent(new TestEvent('change'))
      await Promise.resolve()
    })
    await react.act(async () => {
      const enter = new TestEvent('keydown') as TestEvent & { key: string }
      enter.key = 'Enter'
      dateControl.dispatchEvent(enter)
      await Promise.resolve()
    })
    await react.act(async () => {
      stageWrite.reject(new Error('stage append failed'))
      await Promise.resolve()
    })
    await flushMountedWork(react.act)

    expect(trackerOperations.updateApplicationStageEvent).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Couldn’t save. Retry')
    expect(queryClient.getMutationCache().getAll().map(({ state }) => state.status))
      .toEqual(['error', 'error'])

    await react.act(async () => root.unmount())
    vi.unstubAllGlobals()
  })

  it('consumes an appended event once, then targets the reconciled current event', async () => {
    const document = installTestDom()
    const returnedEventId = '55555555-5555-4555-8555-555555555555'
    const authoritativeEventId = '66666666-6666-4666-8666-666666666666'
    const initialDetail: TrackerApplicationDetail = {
      ...detail(),
      events: [{
        ...detail().events[0],
        id: authoritativeEventId,
        stage: 'applied',
        occurredOn: '2026-08-03',
      }],
    }
    const reconciledApplication: TrackerApplicationListItem = {
      ...applications[0],
      currentStage: 'applied',
      currentStageDate: '2026-08-03',
      updatedAt: '2026-08-03T22:00:00.000Z',
    }
    const reconciledDetail: TrackerApplicationDetail = {
      ...initialDetail,
      ...reconciledApplication,
      events: [
        {
          ...initialDetail.events[0],
          occurredOn: '2026-08-03',
        },
        {
          ...initialDetail.events[0],
          id: returnedEventId,
          stage: 'offer',
          occurredOn: '2026-08-02',
          createdAt: '2026-08-03T21:00:00.000Z',
        },
      ],
    }
    let appendMovedBeforeCurrent = false
    trackerOperations.listTrackerApplications.mockImplementation(async () =>
      appendMovedBeforeCurrent ? [reconciledApplication] : applications)
    trackerOperations.getTrackerApplication.mockImplementation(async () =>
      appendMovedBeforeCurrent ? reconciledDetail : initialDetail)
    trackerOperations.appendApplicationStage.mockResolvedValue(returnedEventId)
    trackerOperations.updateApplicationStageEvent.mockImplementation(async (eventId: string) => {
      if (eventId === returnedEventId) appendMovedBeforeCurrent = true
    })
    const {
      createRoot,
      MountedTracker,
      QueryClientProvider,
      queryClient,
      react,
    } = await loadMountedTracker()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container as unknown as Element)

    await react.act(async () => root.render(react.createElement(
      QueryClientProvider,
      { client: queryClient },
      react.createElement(MountedTracker),
    )))
    await flushMountedWork(react.act)
    const expandButton = findTestElement(container, (element) =>
      element.getAttribute('aria-label') === 'Show details for Data Analyst')
    await react.act(async () => expandButton?.dispatchEvent(new TestEvent('click')))
    await flushMountedWork(react.act)
    const collapseButton = findTestElement(container, (element) =>
      element.getAttribute('aria-label') === 'Hide details for Data Analyst')
    await react.act(async () => collapseButton?.dispatchEvent(new TestEvent('click')))
    await flushMountedWork(react.act)

    const stageControl = findTestElement(container, (element) =>
      element.getAttribute('id') === `stage-${applications[0].id}`)
    const dateControl = findTestElement(container, (element) =>
      element.getAttribute('id') === `date-${applications[0].id}`)
    if (!stageControl || !dateControl) throw new Error('stage/date controls not mounted')
    await react.act(async () => {
      nativeSetValue(stageControl, 'offer')
      stageControl.dispatchEvent(new TestEvent('change'))
      await Promise.resolve()
    })
    await flushMountedWork(react.act)
    await react.act(async () => {
      nativeSetValue(dateControl, '2026-08-02')
      dateControl.dispatchEvent(new TestEvent('input'))
      dateControl.dispatchEvent(new TestEvent('change'))
      const enter = new TestEvent('keydown') as TestEvent & { key: string }
      enter.key = 'Enter'
      dateControl.dispatchEvent(enter)
      await Promise.resolve()
    })
    await flushMountedWork(react.act)

    expect(trackerOperations.updateApplicationStageEvent).toHaveBeenCalledWith(
      returnedEventId,
      'offer',
      '2026-08-02',
    )

    await flushMountedWork(react.act)
    trackerOperations.updateApplicationStageEvent.mockClear()
    const reconciledDateControl = findTestElement(container, (element) =>
      element.getAttribute('id') === `date-${applications[0].id}`)
    if (!reconciledDateControl) throw new Error('reconciled date control not mounted')
    await react.act(async () => {
      nativeSetValue(reconciledDateControl, '2026-08-04')
      reconciledDateControl.dispatchEvent(new TestEvent('input'))
      reconciledDateControl.dispatchEvent(new TestEvent('change'))
      const enter = new TestEvent('keydown') as TestEvent & { key: string }
      enter.key = 'Enter'
      reconciledDateControl.dispatchEvent(enter)
      await Promise.resolve()
    })
    await flushMountedWork(react.act)

    expect(trackerOperations.getTrackerApplication).toHaveBeenLastCalledWith(
      applications[0].id,
    )
    expect(trackerOperations.updateApplicationStageEvent).toHaveBeenCalledWith(
      authoritativeEventId,
      'applied',
      '2026-08-04',
    )
    expect(trackerOperations.updateApplicationStageEvent).not.toHaveBeenCalledWith(
      returnedEventId,
      expect.anything(),
      expect.anything(),
    )

    await react.act(async () => root.unmount())
    vi.unstubAllGlobals()
  })
})

const mountedDashboardRow: FeedRow = {
  id: 'dashboard-row-a',
  deterministic_revision: 1,
  deterministic_eligible: true,
  deterministic_score: 50,
  deterministic_tier: 'Good',
  deterministic_breakdown: [],
  deterministic_filter_code: null,
  deterministic_filter_detail: null,
  deterministic_ranked_at: '2026-08-03T12:00:00.000Z',
  deterministic_best_fit_resume_id: null,
  deterministic_runner_up_resume_id: null,
  seen_at: null,
  dismissed_at: null,
  applied_at: null,
  jobs: {
    id: 'dashboard-job-a',
    title: 'Dashboard A',
    location: 'Chicago, IL',
    absolute_url: 'https://example.com/a',
    posted_at: '2026-08-03T12:00:00.000Z',
    first_seen_at: '2026-08-03T12:00:00.000Z',
    status: 'open',
    source_company_name: null,
    companies: { name: 'Acme' },
  },
}

function mountedDashboardPage(rows: FeedRow[]): DashboardFeedPage {
  return { rows, nextCursor: null, hasMore: false, caughtUp: true }
}

describe('Dashboard mounted performance invariants', () => {
  beforeEach(() => {
    dashboardOperations.backfillDashboardFeedRow.mockReset()
    dashboardOperations.dismissJob.mockReset()
    dashboardOperations.listDashboardCompanyOptions.mockReset()
    dashboardOperations.listDashboardCompanyOptions.mockResolvedValue([])
    dashboardOperations.listFeedPage.mockReset()
    dashboardOperations.markJobApplied.mockReset()
    preferenceOperations.getDeterministicRankingState.mockReset()
    preferenceOperations.getDeterministicRankingState.mockResolvedValue({
      activeRevision: 1,
      desiredRevision: 1,
      status: 'idle',
      errorCode: null,
      retryAvailable: false,
      updatedAt: '2026-08-03T12:00:00.000Z',
    })
    preferenceOperations.loadPreferences.mockReset()
    preferenceOperations.loadPreferences.mockResolvedValue(null)
  })

  it('coalesces live column previews and commits the final pointer width once', async () => {
    const document = installTestDom()
    dashboardOperations.listFeedPage.mockResolvedValue(mountedDashboardPage([mountedDashboardRow]))
    const {
      createRoot,
      MountedDashboard,
      QueryClientProvider,
      queryClient,
      react,
    } = await loadMountedDashboard()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container as unknown as Element)
    let profilerCommits = 0

    await react.act(async () => root.render(react.createElement(
      react.Profiler,
      { id: 'dashboard-resize', onRender: () => { profilerCommits += 1 } },
      react.createElement(
        QueryClientProvider,
        { client: queryClient },
        react.createElement(MountedDashboard),
      ),
    )))
    await flushMountedWork(react.act)

    const handle = findTestElement(container, (element) =>
      element.getAttribute('aria-label') === 'Resize Job column')
    const columns = findTestElements(container, (element) => element.tagName === 'COL')
    const table = findTestElement(container, (element) => element.tagName === 'TABLE')
    if (!handle || !table) throw new Error('Dashboard resize surface not mounted')
    const testWindow = window as unknown as {
      __animationFrameCallbacks: Map<number, (timestamp: number) => void>
      __cancelledAnimationFrameCallbacks: Map<number, (timestamp: number) => void>
      __runAnimationFrame: (id: number) => void
      __runCancelledAnimationFrame: (id: number) => void
      __storageWrites: Array<{ key: string; value: string }>
    }
    const committedWidths = defaultDashboardColumnWidths()
    const committedTableWidth = dashboardTableWidth(committedWidths)
    const commitBaseline = profilerCommits

    await react.act(async () => {
      handle.dispatchEvent(pointerEvent('pointerdown', { clientX: 100 }))
      handle.dispatchEvent(pointerEvent('pointermove', { clientX: 110 }))
      handle.dispatchEvent(pointerEvent('pointermove', { clientX: 125 }))
      handle.dispatchEvent(pointerEvent('pointermove', { clientX: 130 }))
      await Promise.resolve()
    })

    expect(testWindow.__animationFrameCallbacks).toHaveLength(1)
    expect(profilerCommits).toBe(commitBaseline)
    expect(testWindow.__storageWrites).toHaveLength(0)
    expect(columns[1].style.width).toBe('280px')
    expect(table.style.minWidth).toBe(`${committedTableWidth}px`)
    expect(handle.getAttribute('aria-valuenow')).toBe('280')

    const firstFrameId = [...testWindow.__animationFrameCallbacks.keys()][0]
    await react.act(async () => testWindow.__runAnimationFrame(firstFrameId))
    expect(testWindow.__animationFrameCallbacks).toHaveLength(0)
    expect(columns[1].style.width).toBe('310px')
    expect(table.style.minWidth).toBe(`${committedTableWidth + 30}px`)
    expect(handle.getAttribute('aria-valuenow')).toBe('310')
    expect(profilerCommits).toBe(commitBaseline)
    expect(testWindow.__storageWrites).toHaveLength(0)

    await react.act(async () => {
      handle.dispatchEvent(pointerEvent('pointermove', { clientX: 145 }))
      handle.dispatchEvent(pointerEvent('pointermove', { clientX: 160 }))
      await Promise.resolve()
    })
    expect(testWindow.__animationFrameCallbacks).toHaveLength(1)
    const secondFrameId = [...testWindow.__animationFrameCallbacks.keys()][0]
    expect(secondFrameId).not.toBe(firstFrameId)
    await react.act(async () => testWindow.__runAnimationFrame(secondFrameId))
    expect(columns[1].style.width).toBe('340px')
    expect(table.style.minWidth).toBe(`${committedTableWidth + 60}px`)
    expect(handle.getAttribute('aria-valuenow')).toBe('340')
    expect(profilerCommits).toBe(commitBaseline)
    expect(testWindow.__storageWrites).toHaveLength(0)

    await react.act(async () => {
      handle.dispatchEvent(pointerEvent('pointermove', { clientX: 180 }))
      await Promise.resolve()
    })
    const cancelledFrameId = [...testWindow.__animationFrameCallbacks.keys()][0]
    expect(cancelledFrameId).toBeDefined()
    await react.act(async () => {
      handle.dispatchEvent(pointerEvent('pointerup', { clientX: 180 }))
      await Promise.resolve()
    })

    expect(testWindow.__animationFrameCallbacks).toHaveLength(0)
    expect(testWindow.__cancelledAnimationFrameCallbacks.has(cancelledFrameId!)).toBe(true)
    expect(profilerCommits).toBe(commitBaseline + 1)
    expect(testWindow.__storageWrites).toHaveLength(1)
    expect(columns[1].style.width).toBe('360px')
    expect(table.style.minWidth).toBe(`${committedTableWidth + 80}px`)
    expect(handle.getAttribute('aria-valuenow')).toBe('360')
    const persisted = JSON.parse(testWindow.__storageWrites[0].value) as {
      version: number
      widths: Record<string, number>
    }
    expect(testWindow.__storageWrites[0].key).toBe(DASHBOARD_COLUMN_STORAGE_KEY)
    expect(persisted).toEqual({
      version: 2,
      widths: { ...committedWidths, job: 360 },
    })
    await react.act(async () => testWindow.__runCancelledAnimationFrame(cancelledFrameId!))
    expect(columns[1].style.width).toBe('360px')
    expect(table.style.minWidth).toBe(`${committedTableWidth + 80}px`)
    expect(handle.getAttribute('aria-valuenow')).toBe('360')
    expect(profilerCommits).toBe(commitBaseline + 1)
    expect(testWindow.__storageWrites).toHaveLength(1)
    expect(handle.hasPointerCapture(1)).toBe(false)

    await react.act(async () => root.unmount())
    vi.unstubAllGlobals()
  })

  it('restores committed column geometry when a pending pointer preview is cancelled', async () => {
    const document = installTestDom()
    dashboardOperations.listFeedPage.mockResolvedValue(mountedDashboardPage([mountedDashboardRow]))
    const {
      createRoot,
      MountedDashboard,
      QueryClientProvider,
      queryClient,
      react,
    } = await loadMountedDashboard()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container as unknown as Element)
    let profilerCommits = 0

    await react.act(async () => root.render(react.createElement(
      react.Profiler,
      { id: 'dashboard-cancel', onRender: () => { profilerCommits += 1 } },
      react.createElement(QueryClientProvider, { client: queryClient },
        react.createElement(MountedDashboard)),
    )))
    await flushMountedWork(react.act)
    const handle = findTestElement(container, (element) =>
      element.getAttribute('aria-label') === 'Resize Job column')
    const columns = findTestElements(container, (element) => element.tagName === 'COL')
    const table = findTestElement(container, (element) => element.tagName === 'TABLE')
    if (!handle || !table) throw new Error('Dashboard resize surface not mounted')
    const testWindow = window as unknown as {
      __animationFrameCallbacks: Map<number, (timestamp: number) => void>
      __cancelledAnimationFrameCallbacks: Map<number, (timestamp: number) => void>
      __runAnimationFrame: (id: number) => void
      __runCancelledAnimationFrame: (id: number) => void
      __storageWrites: Array<{ key: string; value: string }>
    }
    const initialTableWidth = dashboardTableWidth(defaultDashboardColumnWidths())
    const commitBaseline = profilerCommits

    await react.act(async () => {
      handle.dispatchEvent(pointerEvent('pointerdown', { pointerId: 7, clientX: 100 }))
      handle.dispatchEvent(pointerEvent('pointermove', { pointerId: 7, clientX: 150 }))
      await Promise.resolve()
    })
    const appliedFrameId = [...testWindow.__animationFrameCallbacks.keys()][0]
    await react.act(async () => testWindow.__runAnimationFrame(appliedFrameId))
    expect(columns[1].style.width).toBe('330px')
    expect(table.style.minWidth).toBe(`${initialTableWidth + 50}px`)
    expect(handle.getAttribute('aria-valuenow')).toBe('330')

    await react.act(async () => {
      handle.dispatchEvent(pointerEvent('pointermove', { pointerId: 7, clientX: 190 }))
      await Promise.resolve()
    })
    const cancelledFrameId = [...testWindow.__animationFrameCallbacks.keys()][0]
    await react.act(async () => {
      handle.dispatchEvent(pointerEvent('pointercancel', { pointerId: 7, clientX: 190 }))
      await Promise.resolve()
    })

    expect(columns[1].style.width).toBe('280px')
    expect(table.style.minWidth).toBe(`${initialTableWidth}px`)
    expect(handle.getAttribute('aria-valuenow')).toBe('280')
    expect(handle.hasPointerCapture(7)).toBe(false)
    expect(handle.releasedPointerIds).toContain(7)
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
    expect(testWindow.__animationFrameCallbacks).toHaveLength(0)
    expect(testWindow.__cancelledAnimationFrameCallbacks.has(cancelledFrameId)).toBe(true)
    expect(profilerCommits).toBe(commitBaseline)
    expect(testWindow.__storageWrites).toHaveLength(0)

    await react.act(async () => testWindow.__runCancelledAnimationFrame(cancelledFrameId))
    expect(columns[1].style.width).toBe('280px')
    expect(table.style.minWidth).toBe(`${initialTableWidth}px`)
    expect(handle.getAttribute('aria-valuenow')).toBe('280')
    expect(profilerCommits).toBe(commitBaseline)
    expect(testWindow.__storageWrites).toHaveLength(0)

    await react.act(async () => root.unmount())
    vi.unstubAllGlobals()
  })

  it('cancels active handle work and releases all drag resources on unmount', async () => {
    const document = installTestDom()
    document.body.style.cursor = 'crosshair'
    document.body.style.userSelect = 'text'
    const { createRoot, MountedColumnResizeHandle, react } =
      await loadMountedColumnResizeHandle()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container as unknown as Element)
    const coordinator: ColumnResizeCoordinator = { activeColumnId: null }
    const onWidthPreview = vi.fn()
    const onWidthCommit = vi.fn()

    await react.act(async () => root.render(react.createElement(MountedColumnResizeHandle, {
      column: DASHBOARD_COLUMNS[1],
      width: DASHBOARD_COLUMNS[1].defaultWidth,
      coordinator,
      onWidthPreview,
      onWidthCommit,
    })))
    const handle = findTestElement(container, (element) =>
      element.getAttribute('aria-label') === 'Resize Job column')
    if (!handle) throw new Error('resize handle not mounted')
    const testWindow = window as unknown as {
      __animationFrameCallbacks: Map<number, (timestamp: number) => void>
      __cancelledAnimationFrameCallbacks: Map<number, (timestamp: number) => void>
      __runCancelledAnimationFrame: (id: number) => void
    }

    await react.act(async () => {
      handle.dispatchEvent(pointerEvent('pointerdown', { pointerId: 9, clientX: 100 }))
      handle.dispatchEvent(pointerEvent('pointermove', { pointerId: 9, clientX: 140 }))
      await Promise.resolve()
    })
    const cancelledFrameId = [...testWindow.__animationFrameCallbacks.keys()][0]
    expect(coordinator.activeColumnId).toBe('job')
    expect(handle.hasPointerCapture(9)).toBe(true)
    expect(document.body.style.cursor).toBe('col-resize')
    expect(document.body.style.userSelect).toBe('none')

    await react.act(async () => root.unmount())
    expect(testWindow.__animationFrameCallbacks).toHaveLength(0)
    expect(testWindow.__cancelledAnimationFrameCallbacks.has(cancelledFrameId)).toBe(true)
    expect(coordinator.activeColumnId).toBeNull()
    expect(handle.hasPointerCapture(9)).toBe(false)
    expect(handle.releasedPointerIds).toContain(9)
    expect(document.body.style.cursor).toBe('crosshair')
    expect(document.body.style.userSelect).toBe('text')
    expect(onWidthPreview).not.toHaveBeenCalled()
    expect(onWidthCommit).not.toHaveBeenCalled()

    await react.act(async () => testWindow.__runCancelledAnimationFrame(cancelledFrameId))
    expect(onWidthPreview).not.toHaveBeenCalled()
    expect(onWidthCommit).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('keeps keyboard resizing immediate, bounded, persisted, and accessible', async () => {
    const document = installTestDom()
    dashboardOperations.listFeedPage.mockResolvedValue(mountedDashboardPage([mountedDashboardRow]))
    const {
      createRoot,
      MountedDashboard,
      QueryClientProvider,
      queryClient,
      react,
    } = await loadMountedDashboard()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container as unknown as Element)

    await react.act(async () => root.render(react.createElement(
      QueryClientProvider,
      { client: queryClient },
      react.createElement(MountedDashboard),
    )))
    await flushMountedWork(react.act)
    const handles = findTestElements(container, (element) =>
      element.getAttribute('role') === 'separator')
    const jobHandle = handles.find((element) =>
      element.getAttribute('aria-label') === 'Resize Job column')
    if (!jobHandle) throw new Error('Job resize handle not mounted')
    const testWindow = window as unknown as {
      __storageWrites: Array<{ key: string; value: string }>
    }

    expect(handles).toHaveLength(7)
    expect(handles.some((element) =>
      element.getAttribute('aria-label') === 'Resize Action column')).toBe(false)
    expect(jobHandle.getAttribute('role')).toBe('separator')
    expect(jobHandle.getAttribute('aria-orientation')).toBe('vertical')
    expect(jobHandle.getAttribute('aria-valuemin')).toBe('220')
    expect(jobHandle.getAttribute('aria-valuemax')).toBe('520')
    expect(jobHandle.getAttribute('aria-valuenow')).toBe('280')
    expect(jobHandle.getAttribute('tabindex')).toBe('0')

    await react.act(async () => jobHandle.dispatchEvent(keyboardEvent('ArrowRight')))
    expect(jobHandle.getAttribute('aria-valuenow')).toBe('288')
    await react.act(async () => jobHandle.dispatchEvent(keyboardEvent('ArrowRight', true)))
    expect(jobHandle.getAttribute('aria-valuenow')).toBe('312')
    await react.act(async () => jobHandle.dispatchEvent(keyboardEvent('Home')))
    expect(jobHandle.getAttribute('aria-valuenow')).toBe('220')
    await react.act(async () => jobHandle.dispatchEvent(keyboardEvent('End')))
    expect(jobHandle.getAttribute('aria-valuenow')).toBe('520')
    expect(testWindow.__storageWrites).toHaveLength(4)
    expect(JSON.parse(testWindow.__storageWrites[3].value)).toMatchObject({
      version: 2,
      widths: { job: 520 },
    })

    await react.act(async () => {
      jobHandle.dispatchEvent(pointerEvent('pointerdown', { pointerId: 11, clientX: 100 }))
      jobHandle.dispatchEvent(keyboardEvent('ArrowLeft'))
      await Promise.resolve()
    })
    expect(jobHandle.getAttribute('aria-valuenow')).toBe('520')
    expect(testWindow.__storageWrites).toHaveLength(4)
    await react.act(async () => jobHandle.dispatchEvent(
      pointerEvent('pointercancel', { pointerId: 11, clientX: 100 }),
    ))

    await react.act(async () => root.unmount())
    vi.unstubAllGlobals()
  })

  it('updates rapid tier choices immediately and requests only the settled selection', async () => {
    const document = installTestDom()
    dashboardOperations.listFeedPage.mockResolvedValue(mountedDashboardPage([mountedDashboardRow]))
    const {
      createRoot,
      MountedDashboard,
      QueryClientProvider,
      queryClient,
      react,
    } = await loadMountedDashboard()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container as unknown as Element)

    await react.act(async () => root.render(react.createElement(
      QueryClientProvider,
      { client: queryClient },
      react.createElement(MountedDashboard),
    )))
    await flushMountedWork(react.act)

    const scoreTierTrigger = findTestElement(container, (element) =>
      element.tagName === 'BUTTON' && element.textContent.includes('Score tiers: All'))
    if (!scoreTierTrigger) throw new Error(`score tier trigger not mounted: ${container.textContent}`)
    await react.act(async () => scoreTierTrigger.dispatchEvent(new TestEvent('click')))
    await flushMountedWork(react.act)
    const tierCheckboxes = findTestElements(container, (element) =>
      element.tagName === 'INPUT')
    expect(tierCheckboxes).toHaveLength(3)
    expect(tierCheckboxes.map(({ checked }) => checked)).toEqual([true, true, true])
    expect(dashboardOperations.listFeedPage).toHaveBeenCalledTimes(1)

    const testWindow = window as unknown as {
      __runTimeout: (id: number) => void
      __timeoutCallbacks: Map<number, { callback: () => void; delay: number }>
    }
    await react.act(async () => {
      nativeSetChecked(tierCheckboxes[0], false)
      tierCheckboxes[0].dispatchEvent(new TestEvent('click'))
      await Promise.resolve()
    })
    const firstTimeoutId = [...testWindow.__timeoutCallbacks.keys()][0]
    expect(firstTimeoutId).toBeDefined()
    expect(testWindow.__timeoutCallbacks.get(firstTimeoutId!)?.delay).toBe(250)
    expect(tierCheckboxes.map(({ checked }) => checked)).toEqual([false, true, true])
    expect(scoreTierTrigger?.textContent).toContain('Score tiers: 2 selected')
    expect(dashboardOperations.listFeedPage).toHaveBeenCalledTimes(1)

    await react.act(async () => {
      nativeSetChecked(tierCheckboxes[1], false)
      tierCheckboxes[1].dispatchEvent(new TestEvent('click'))
      await Promise.resolve()
    })
    const finalTimeoutId = [...testWindow.__timeoutCallbacks.keys()][0]
    expect(finalTimeoutId).toBeDefined()
    expect(finalTimeoutId).not.toBe(firstTimeoutId)
    expect(testWindow.__timeoutCallbacks.has(firstTimeoutId!)).toBe(false)
    expect(testWindow.__timeoutCallbacks).toHaveLength(1)
    expect(tierCheckboxes.map(({ checked }) => checked)).toEqual([false, false, true])
    expect(scoreTierTrigger?.textContent).toContain('Score tiers: 1 selected')
    expect(dashboardOperations.listFeedPage).toHaveBeenCalledTimes(1)

    await react.act(async () => {
      testWindow.__runTimeout(finalTimeoutId!)
      await Promise.resolve()
    })
    await flushMountedWork(react.act)
    expect(dashboardOperations.listFeedPage).toHaveBeenCalledTimes(2)
    expect(dashboardOperations.listFeedPage.mock.calls[1][0]).toMatchObject({
      tiers: ['Weak'],
    })

    await react.act(async () => {
      nativeSetChecked(tierCheckboxes[0], true)
      tierCheckboxes[0].dispatchEvent(new TestEvent('click'))
      await Promise.resolve()
    })
    expect(testWindow.__timeoutCallbacks).toHaveLength(1)
    await react.act(async () => root.unmount())
    expect(testWindow.__timeoutCallbacks).toHaveLength(0)
    expect(dashboardOperations.listFeedPage).toHaveBeenCalledTimes(2)
    vi.unstubAllGlobals()
  })

  it('drives interval, focus, and ranking refreshes while only the newest head settles', async () => {
    const document = installTestDom()
    const intervalHead = deferred<DashboardFeedPage>()
    const focusHead = deferred<DashboardFeedPage>()
    const rankingHead = deferred<DashboardFeedPage>()
    const staleAfterApplied = deferred<DashboardFeedPage>()
    const initial = mountedDashboardPage([mountedDashboardRow])
    dashboardOperations.listFeedPage
      .mockResolvedValueOnce(initial)
      .mockReturnValueOnce(intervalHead.promise)
      .mockReturnValueOnce(focusHead.promise)
      .mockReturnValueOnce(rankingHead.promise)
      .mockReturnValueOnce(staleAfterApplied.promise)
    dashboardOperations.markJobApplied.mockResolvedValue(
      '11111111-1111-4111-8111-111111111111',
    )
    const {
      createRoot,
      MountedDashboard,
      QueryClientProvider,
      queryClient,
      react,
    } = await loadMountedDashboard()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container as unknown as Element)

    await react.act(async () => root.render(react.createElement(
      QueryClientProvider,
      { client: queryClient },
      react.createElement(MountedDashboard),
    )))
    await flushMountedWork(react.act)

    const testWindow = window as unknown as {
      __intervalCallbacks: Map<number, () => void>
      dispatchEvent: (event: TestEvent) => boolean
    }
    await react.act(async () => {
      testWindow.__intervalCallbacks.values().next().value?.()
      testWindow.dispatchEvent(new TestEvent('focus'))
      queryClient.setQueryData(['ranking-state'], {
        activeRevision: 2,
        desiredRevision: 2,
        status: 'idle',
        errorCode: null,
        retryAvailable: false,
        updatedAt: '2026-08-03T12:01:00.000Z',
      })
      await Promise.resolve()
    })
    await flushMountedWork(react.act)
    expect(dashboardOperations.listFeedPage).toHaveBeenCalledTimes(4)

    const newestRow = { ...mountedDashboardRow, deterministic_score: 93 }
    rankingHead.resolve(mountedDashboardPage([newestRow]))
    focusHead.resolve(mountedDashboardPage([
      { ...mountedDashboardRow, deterministic_score: 82 },
    ]))
    intervalHead.resolve(mountedDashboardPage([
      { ...mountedDashboardRow, deterministic_score: 71 },
    ]))
    await flushMountedWork(react.act)
    const feedQuery = queryClient.getQueryCache().findAll({
      queryKey: ['dashboard-feed'],
    })[0]
    expect((feedQuery.state.data as { pages: DashboardFeedPage[] }).pages[0].rows)
      .toEqual([newestRow])

    testWindow.dispatchEvent(new TestEvent('focus'))
    await flushMountedWork(react.act)
    const markApplied = findTestElement(container, (element) =>
      element.getAttribute('aria-label') === 'Mark Dashboard A applied')
    await react.act(async () => markApplied?.dispatchEvent(new TestEvent('click')))
    await flushMountedWork(react.act)
    staleAfterApplied.resolve(mountedDashboardPage([mountedDashboardRow]))
    await flushMountedWork(react.act)

    expect((feedQuery.state.data as { pages: DashboardFeedPage[] }).pages[0].rows)
      .toEqual([])

    await react.act(async () => root.unmount())
    vi.unstubAllGlobals()
  })

  it('preserves a successful concurrent Mark Applied and a concurrent cache addition', async () => {
    const document = installTestDom()
    const second = {
      ...mountedDashboardRow,
      id: 'dashboard-row-b',
      jobs: { ...mountedDashboardRow.jobs!, id: 'dashboard-job-b', title: 'Dashboard B' },
    }
    const concurrent = {
      ...mountedDashboardRow,
      id: 'dashboard-row-concurrent',
      jobs: {
        ...mountedDashboardRow.jobs!,
        id: 'dashboard-job-concurrent',
        title: 'Dashboard Concurrent',
      },
    }
    const firstWrite = deferred<string>()
    const secondWrite = deferred<string>()
    dashboardOperations.listFeedPage.mockResolvedValue(
      mountedDashboardPage([mountedDashboardRow, second]),
    )
    dashboardOperations.markJobApplied.mockImplementation((id: string) =>
      id === mountedDashboardRow.id ? firstWrite.promise : secondWrite.promise)
    const {
      createRoot,
      MountedDashboard,
      QueryClientProvider,
      queryClient,
      react,
    } = await loadMountedDashboard()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container as unknown as Element)

    await react.act(async () => root.render(react.createElement(
      QueryClientProvider,
      { client: queryClient },
      react.createElement(MountedDashboard),
    )))
    await flushMountedWork(react.act)
    const firstButton = findTestElement(container, (element) =>
      element.getAttribute('aria-label') === 'Mark Dashboard A applied')
    const secondButton = findTestElement(container, (element) =>
      element.getAttribute('aria-label') === 'Mark Dashboard B applied')
    await react.act(async () => {
      firstButton?.dispatchEvent(new TestEvent('click'))
      secondButton?.dispatchEvent(new TestEvent('click'))
      await Promise.resolve()
    })
    await flushMountedWork(react.act)
    const feedQuery = queryClient.getQueryCache().findAll({
      queryKey: ['dashboard-feed'],
    })[0]
    queryClient.setQueryData(feedQuery.queryKey, (current: unknown) => {
      const data = current as { pages: DashboardFeedPage[]; pageParams: unknown[] }
      return {
        ...data,
        pages: data.pages.map((page, index) => index === 0
          ? { ...page, rows: [...page.rows, concurrent] }
          : page),
      }
    })

    await react.act(async () => {
      secondWrite.resolve('22222222-2222-4222-8222-222222222222')
      await Promise.resolve()
      firstWrite.reject(new Error('first write failed'))
      await Promise.resolve()
    })
    await flushMountedWork(react.act)

    expect(
      (feedQuery.state.data as { pages: DashboardFeedPage[] }).pages
        .flatMap(({ rows }) => rows.map(({ id }) => id)),
    ).toEqual([mountedDashboardRow.id, concurrent.id])

    await react.act(async () => root.unmount())
    vi.unstubAllGlobals()
  })

  it('keeps an applied row excluded when a concurrent dismissal refetch returns it', async () => {
    const document = installTestDom()
    const dismissRow = {
      ...mountedDashboardRow,
      id: 'dashboard-row-dismiss',
      jobs: {
        ...mountedDashboardRow.jobs!,
        id: 'dashboard-job-dismiss',
        title: 'Dashboard Dismiss',
      },
    }
    const appliedWrite = deferred<string>()
    dashboardOperations.listFeedPage
      .mockResolvedValueOnce(mountedDashboardPage([mountedDashboardRow, dismissRow]))
      .mockResolvedValue(mountedDashboardPage([mountedDashboardRow]))
    dashboardOperations.markJobApplied.mockReturnValue(appliedWrite.promise)
    dashboardOperations.dismissJob.mockResolvedValue(undefined)
    const {
      createRoot,
      MountedDashboard,
      QueryClientProvider,
      queryClient,
      react,
    } = await loadMountedDashboard()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container as unknown as Element)

    await react.act(async () => root.render(react.createElement(
      QueryClientProvider,
      { client: queryClient },
      react.createElement(MountedDashboard),
    )))
    await flushMountedWork(react.act)
    const markApplied = findTestElement(container, (element) =>
      element.getAttribute('aria-label') === 'Mark Dashboard A applied')
    const dismiss = findTestElement(container, (element) =>
      element.getAttribute('aria-label') === 'Dismiss Dashboard Dismiss')
    await react.act(async () => {
      markApplied?.dispatchEvent(new TestEvent('click'))
      dismiss?.dispatchEvent(new TestEvent('click'))
      await Promise.resolve()
    })
    await flushMountedWork(react.act)

    const feedQuery = queryClient.getQueryCache().findAll({
      queryKey: ['dashboard-feed'],
    })[0]
    expect(
      (feedQuery.state.data as { pages: DashboardFeedPage[] }).pages
        .flatMap(({ rows }) => rows.map(({ id }) => id)),
    ).not.toContain(mountedDashboardRow.id)

    await react.act(async () => {
      appliedWrite.resolve('11111111-1111-4111-8111-111111111111')
      await Promise.resolve()
    })
    await flushMountedWork(react.act)

    expect(
      (feedQuery.state.data as { pages: DashboardFeedPage[] }).pages
        .flatMap(({ rows }) => rows.map(({ id }) => id)),
    ).not.toContain(mountedDashboardRow.id)
    expect(findTestElement(container, (element) =>
      element.getAttribute('aria-label') === 'Mark Dashboard A applied')).toBeNull()

    await react.act(async () => root.unmount())
    vi.unstubAllGlobals()
  })

  it('restores a rejected Mark Applied only to its originating query after sorting changes', async () => {
    const document = installTestDom()
    const remainingRow = {
      ...mountedDashboardRow,
      id: 'dashboard-row-origin-remaining',
      jobs: {
        ...mountedDashboardRow.jobs!,
        id: 'dashboard-job-origin-remaining',
        title: 'Dashboard Origin Remaining',
      },
    }
    const sortedRow = {
      ...mountedDashboardRow,
      id: 'dashboard-row-sorted',
      jobs: {
        ...mountedDashboardRow.jobs!,
        id: 'dashboard-job-sorted',
        title: 'Dashboard Sorted',
      },
    }
    const appliedWrite = deferred<string>()
    dashboardOperations.listFeedPage.mockImplementation(
      async (request: { order: string }) => mountedDashboardPage(
        request.order === 'newest'
          ? [mountedDashboardRow, remainingRow]
          : [sortedRow],
      ),
    )
    dashboardOperations.markJobApplied.mockReturnValue(appliedWrite.promise)
    const {
      createRoot,
      MountedDashboard,
      QueryClientProvider,
      queryClient,
      react,
    } = await loadMountedDashboard()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container as unknown as Element)

    await react.act(async () => root.render(react.createElement(
      QueryClientProvider,
      { client: queryClient },
      react.createElement(MountedDashboard),
    )))
    await flushMountedWork(react.act)
    const markApplied = findTestElement(container, (element) =>
      element.getAttribute('aria-label') === 'Mark Dashboard A applied')
    await react.act(async () => markApplied?.dispatchEvent(new TestEvent('click')))
    const scoreSort = findTestElement(container, (element) =>
      element.tagName === 'BUTTON' && element.textContent === 'Score↕')
    if (!scoreSort) {
      throw new Error(`score sort not mounted: ${findTestElements(
        container,
        (element) => element.tagName === 'BUTTON',
      ).map(({ textContent }) => textContent).join('|')}`)
    }
    await react.act(async () => scoreSort?.dispatchEvent(new TestEvent('click')))
    await flushMountedWork(react.act)

    const queries = queryClient.getQueryCache().findAll({ queryKey: ['dashboard-feed'] })
    const originQuery = queries.find(({ queryKey }) => queryKey[2] === 'newest')
    const currentQuery = queries.find(({ queryKey }) => queryKey[2] === 'score_desc')
    if (!originQuery || !currentQuery) throw new Error('both feed identities must be cached')
    const currentData = currentQuery.state.data
    await react.act(async () => {
      appliedWrite.reject(new Error('mark applied failed'))
      await Promise.resolve()
    })
    await flushMountedWork(react.act)

    expect((originQuery.state.data as { pages: DashboardFeedPage[] }).pages[0].rows)
      .toEqual([mountedDashboardRow, remainingRow])
    expect(currentQuery.state.data).toBe(currentData)
    expect((currentQuery.state.data as { pages: DashboardFeedPage[] }).pages[0].rows)
      .toEqual([sortedRow])

    await react.act(async () => root.unmount())
    vi.unstubAllGlobals()
  })

  it('refills a resolved dismissal only through its originating request after sorting changes', async () => {
    const document = installTestDom()
    const remainingRow = {
      ...mountedDashboardRow,
      id: 'dashboard-row-resolve-remaining',
      jobs: {
        ...mountedDashboardRow.jobs!,
        id: 'dashboard-job-resolve-remaining',
        title: 'Dashboard Resolve Remaining',
      },
    }
    const sortedRow = {
      ...mountedDashboardRow,
      id: 'dashboard-row-resolve-sorted',
      jobs: {
        ...mountedDashboardRow.jobs!,
        id: 'dashboard-job-resolve-sorted',
        title: 'Dashboard Resolve Sorted',
      },
    }
    const dismissWrite = deferred<void>()
    let dismissalCommitted = false
    dashboardOperations.listFeedPage.mockImplementation(
      async (request: { order: string }) => mountedDashboardPage(
        request.order === 'score_desc'
          ? [sortedRow]
          : dismissalCommitted ? [remainingRow] : [mountedDashboardRow, remainingRow],
      ),
    )
    dashboardOperations.dismissJob.mockImplementation(async () => {
      await dismissWrite.promise
      dismissalCommitted = true
    })
    const {
      createRoot,
      MountedDashboard,
      QueryClientProvider,
      queryClient,
      react,
    } = await loadMountedDashboard()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container as unknown as Element)

    await react.act(async () => root.render(react.createElement(
      QueryClientProvider,
      { client: queryClient },
      react.createElement(MountedDashboard),
    )))
    await flushMountedWork(react.act)
    const dismiss = findTestElement(container, (element) =>
      element.getAttribute('aria-label') === 'Dismiss Dashboard A')
    await react.act(async () => dismiss?.dispatchEvent(new TestEvent('click')))
    const scoreSort = findTestElement(container, (element) =>
      element.tagName === 'BUTTON' && element.textContent === 'Score↕')
    if (!scoreSort) {
      throw new Error(`score sort not mounted: ${findTestElements(
        container,
        (element) => element.tagName === 'BUTTON',
      ).map(({ textContent }) => textContent).join('|')}`)
    }
    await react.act(async () => scoreSort?.dispatchEvent(new TestEvent('click')))
    await flushMountedWork(react.act)

    const queries = queryClient.getQueryCache().findAll({ queryKey: ['dashboard-feed'] })
    const originQuery = queries.find(({ queryKey }) => queryKey[2] === 'newest')
    const currentQuery = queries.find(({ queryKey }) => queryKey[2] === 'score_desc')
    if (!originQuery || !currentQuery) throw new Error('both feed identities must be cached')
    const currentData = currentQuery.state.data
    await react.act(async () => {
      dismissWrite.resolve()
      await Promise.resolve()
    })
    await flushMountedWork(react.act)

    expect((originQuery.state.data as { pages: DashboardFeedPage[] }).pages[0].rows)
      .toEqual([remainingRow])
    expect(currentQuery.state.data).toBe(currentData)
    expect((currentQuery.state.data as { pages: DashboardFeedPage[] }).pages[0].rows)
      .toEqual([sortedRow])
    const requestedOrders = dashboardOperations.listFeedPage.mock.calls.map(
      ([request]) => (request as { order: string }).order,
    )
    expect(requestedOrders.filter((order) => order === 'newest').length).toBeGreaterThan(1)
    expect(requestedOrders.filter((order) => order === 'score_desc')).toHaveLength(1)

    await react.act(async () => root.unmount())
    vi.unstubAllGlobals()
  })

  it('keeps a detached origin refill failure out of the newly sorted view', async () => {
    const document = installTestDom()
    const remainingRow = {
      ...mountedDashboardRow,
      id: 'dashboard-row-failure-remaining',
      jobs: {
        ...mountedDashboardRow.jobs!,
        id: 'dashboard-job-failure-remaining',
        title: 'Dashboard Failure Remaining',
      },
    }
    const sortedRow = {
      ...mountedDashboardRow,
      id: 'dashboard-row-failure-sorted',
      jobs: {
        ...mountedDashboardRow.jobs!,
        id: 'dashboard-job-failure-sorted',
        title: 'Dashboard Failure Sorted',
      },
    }
    const originRefill = deferred<DashboardFeedPage>()
    dashboardOperations.backfillDashboardFeedRow.mockReturnValue(originRefill.promise)
    dashboardOperations.listFeedPage.mockImplementation(
      async (request: { order: string }) => {
        if (request.order === 'score_desc') return mountedDashboardPage([sortedRow])
        return {
          rows: [mountedDashboardRow, remainingRow],
          nextCursor: 'origin-next',
          hasMore: true,
          caughtUp: false,
        }
      },
    )
    dashboardOperations.dismissJob.mockResolvedValue(undefined)
    const {
      createRoot,
      MountedDashboard,
      QueryClientProvider,
      queryClient,
      react,
    } = await loadMountedDashboard()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container as unknown as Element)

    await react.act(async () => root.render(react.createElement(
      QueryClientProvider,
      { client: queryClient },
      react.createElement(MountedDashboard, { scope: 'all' }),
    )))
    await flushMountedWork(react.act)
    const dismiss = findTestElement(container, (element) =>
      element.getAttribute('aria-label') === 'Dismiss Dashboard A')
    await react.act(async () => {
      dismiss?.dispatchEvent(new TestEvent('click'))
      await Promise.resolve()
    })
    const scoreSort = findTestElement(container, (element) =>
      element.tagName === 'BUTTON' && element.textContent === 'Score↕')
    if (!scoreSort) throw new Error('score sort not mounted')
    await react.act(async () => scoreSort.dispatchEvent(new TestEvent('click')))
    await flushMountedWork(react.act)

    await react.act(async () => {
      originRefill.reject(new Error('origin refill failed'))
      await Promise.resolve()
    })
    await flushMountedWork(react.act)

    expect(container.textContent).toContain('Dashboard Failure Sorted')
    expect(container.textContent).not.toContain('Couldn’t refresh the queue.')
    expect(findTestElement(container, (element) =>
      element.tagName === 'BUTTON' && element.textContent === 'Retry')).toBeNull()

    await react.act(async () => root.unmount())
    vi.unstubAllGlobals()
  })
})

describe('mounted route load recovery', () => {
  it('renders an accessible recovery state when a lazy route import rejects', async () => {
    const document = installTestDom()
    const container = document.createElement('div')
    container.setAttribute('id', 'root')
    document.body.appendChild(container)
    vi.resetModules()
    vi.doUnmock('@tanstack/react-query')
    vi.doMock('react-router', async () => {
      const react = await import('react')
      return {
        BrowserRouter: ({ children }: { children: React.ReactNode }) => children,
        Route: ({ element, path }: { element?: React.ReactNode; path?: string }) =>
          path === '/login' ? element : null,
        Routes: ({ children }: { children: React.ReactNode }) => children,
        Link: ({ children }: { children: React.ReactNode }) =>
          react.createElement('a', null, children),
        useSearchParams: () => [new URLSearchParams()],
      }
    })
    vi.doMock('../auth/AuthProvider', () => ({
      AuthProvider: ({ children }: { children: React.ReactNode }) => children,
    }))
    vi.doMock('../auth/RequireAuth', () => ({
      RequireAuth: ({ children }: { children: React.ReactNode }) => children,
    }))
    vi.doMock('../components/Shell', () => ({ Shell: () => null }))
    vi.doMock('./Login', () => {
      throw new Error('lazy chunk rejected')
    })
    const react = await import('react')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await react.act(async () => {
      await import('../main')
      await Promise.resolve()
    })
    await flushMountedWork(react.act)

    expect(findTestElement(container, (element) => element.getAttribute('role') === 'alert')
      ?.textContent).toContain('Check your connection')
    const reload = findTestElement(container, (element) => element.textContent === 'Reload page')
    reload?.dispatchEvent(new TestEvent('click'))
    expect((window.location.reload as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1)

    consoleError.mockRestore()
    vi.unstubAllGlobals()
  })
})

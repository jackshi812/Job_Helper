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
  listTrackerApplications: vi.fn(),
  updateApplicationStageEvent: vi.fn(),
}))
const resumeOperations = vi.hoisted(() => ({
  listResumes: vi.fn(),
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

vi.mock('../lib/resumes', () => ({
  listResumes: resumeOperations.listResumes,
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

    const eventId = await stage.mutationFn('offer' as never)
    const stageSettlement = stage.onSuccess?.(eventId, 'offer' as never)
    const dateResult = await date.mutationFn('2026-08-03' as never)
    const dateSettlement = date.onSuccess?.(dateResult, '2026-08-03' as never)

    expect(stageSettlement).toBeUndefined()
    expect(dateSettlement).toBeUndefined()
    expect(trackerOperations.updateApplicationStageEvent).toHaveBeenCalledWith(
      '44444444-4444-4444-8444-444444444444',
      'offer',
      '2026-08-03',
    )
    expect(reactQueryHarness.queryClient.fetchQuery).not.toHaveBeenCalled()
    expect(reactQueryHarness.queryClient.invalidateQueries).toHaveBeenCalledTimes(6)
    expect(reactQueryHarness.queryClient.getQueryData(
      ['tracker-application', applications[0].id],
    )).toMatchObject({ currentStage: 'offer', currentStageDate: '2026-08-03' })
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

  it('fetches detail for a date write only when no authoritative or cached event exists', async () => {
    reactQueryHarness.queryClient.fetchQuery.mockResolvedValue(detail())
    trackerOperations.updateApplicationStageEvent.mockResolvedValue(undefined)
    renderToStaticMarkup(<Tracker />)
    const date = mutationOptions(`${applications[0].id}:stage-date`, 1)

    await date.mutationFn('2026-08-03' as never)

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
  scrollIntoViewCalls = 0
  _value = ''
  checked = false
  selected = false

  constructor(tagName: string, ownerDocument: TestDocument) {
    super(1, ownerDocument)
    this.tagName = tagName.toUpperCase()
    this.nodeName = this.tagName
    const style = {} as TestElement['style']
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

function nativeSetValue(element: TestElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(TestElement.prototype, 'value')?.set
  if (!setter) throw new Error('native value setter not found')
  setter.call(element, value)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function installTestDom() {
  const document = new TestDocument()
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
    getComputedStyle: () => ({}),
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

async function flushMountedWork(act: (callback: () => Promise<void>) => Promise<void>) {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
}

describe('Tracker mounted performance invariants', () => {
  beforeEach(() => {
    searchParamState.value = null
    trackerOperations.appendApplicationStage.mockReset()
    trackerOperations.getTrackerApplication.mockReset()
    trackerOperations.listTrackerApplications.mockReset()
    trackerOperations.updateApplicationStageEvent.mockReset()
    resumeOperations.listResumes.mockReset()
    resumeOperations.listResumes.mockResolvedValue([])
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

    await react.act(async () => root.unmount())
    vi.unstubAllGlobals()
  })
})

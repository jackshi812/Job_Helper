import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompanyRecord, SourceCoverageCatalogRecord } from '../lib/watchlist'

const watchlistOperations = vi.hoisted(() => ({
  addCompany: vi.fn(),
  listSourceCoverageCatalog: vi.fn(),
  listWatchlistCompanies: vi.fn(),
  removeCompany: vi.fn(),
}))

vi.mock('../lib/watchlist', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/watchlist')>(),
  addCompany: watchlistOperations.addCompany,
  listSourceCoverageCatalog: watchlistOperations.listSourceCoverageCatalog,
  listWatchlistCompanies: watchlistOperations.listWatchlistCompanies,
  removeCompany: watchlistOperations.removeCompany,
}))

const company: CompanyRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Acme',
  ats_type: 'greenhouse',
  board_token: 'acme',
  region: null,
  careers_url: 'https://job-boards.greenhouse.io/acme',
  source_key: 'greenhouse:global:acme',
  site_token: null,
  activation_state: 'active',
  activation_successes: 3,
  last_verified_at: '2026-08-04T00:00:00.000Z',
  last_polled_at: '2026-08-04T00:00:00.000Z',
  last_success_at: '2026-08-04T00:00:00.000Z',
  consecutive_failures: 0,
  last_error: null,
  last_error_code: null,
  last_observation_count: 4,
  created_at: '2026-08-04T00:00:00.000Z',
}

const coverage: SourceCoverageCatalogRecord = {
  id: 'coverage-acme',
  company_name: 'Acme',
  careers_url: 'https://job-boards.greenhouse.io/acme',
  provider: 'Greenhouse',
  access_evidence: 'Public board',
  disposition: 'experimental',
  verified_at: '2026-08-04',
  unsupported_reason: null,
  source_key: company.source_key,
}

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
  private listeners = new Map<string, Array<{ callback: TestListener; capture: boolean }>>()

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
  _value = ''
  checked = false
  selected = false
  files: File[] | null = null

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
    return this._value
  }

  set value(value: string) {
    this._value = String(value)
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

function installTestDom() {
  const document = new TestDocument()
  const storage = new Map<string, string>()
  const window = {
    document,
    Event: TestEvent,
    Node: TestNode,
    Element: TestElement,
    HTMLElement: TestElement,
    HTMLInputElement: TestElement,
    HTMLIFrameElement: class TestIFrameElement extends TestElement {},
    SVGElement: TestElement,
    addEventListener: () => {},
    removeEventListener: () => {},
    getComputedStyle: () => ({}),
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    location: { href: 'http://localhost/', protocol: 'http:' },
  }
  document.defaultView = window
  vi.stubGlobal('document', document)
  vi.stubGlobal('window', window)
  vi.stubGlobal('Node', TestNode)
  vi.stubGlobal('Element', TestElement)
  vi.stubGlobal('HTMLElement', TestElement)
  vi.stubGlobal('HTMLInputElement', TestElement)
  vi.stubGlobal('Event', TestEvent)
  vi.stubGlobal('navigator', { userAgent: 'test' })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  return document
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

function nativeSetValue(element: TestElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(TestElement.prototype, 'value')?.set
  if (!setter) throw new Error('native value setter not found')
  setter.call(element, value)
}

async function loadMountedWatchlist() {
  vi.resetModules()
  const react = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
  const { Watchlist } = await import('./Watchlist')
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return { createRoot, QueryClientProvider, queryClient, react, Watchlist }
}

async function flushMountedWork(
  act: (callback: () => Promise<void>) => Promise<void>,
) {
  await act(async () => {
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
  })
}

describe('Watchlist mounted query lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('starts both reads together, polls only live health, and reuses coverage on remount', async () => {
    const liveInitial = deferred<CompanyRecord[]>()
    const coverageInitial = deferred<SourceCoverageCatalogRecord[]>()
    watchlistOperations.listWatchlistCompanies
      .mockImplementationOnce(() => liveInitial.promise)
      .mockResolvedValue([])
    watchlistOperations.listSourceCoverageCatalog
      .mockImplementationOnce(() => coverageInitial.promise)
      .mockResolvedValue([])
    const document = installTestDom()
    const {
      createRoot,
      QueryClientProvider,
      queryClient,
      react,
      Watchlist,
    } = await loadMountedWatchlist()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const tree = () => react.createElement(
      QueryClientProvider,
      { client: queryClient },
      react.createElement(Watchlist),
    )
    const root = createRoot(container as unknown as Element)

    await react.act(async () => root.render(tree()))
    await flushMountedWork(react.act)

    expect(watchlistOperations.listWatchlistCompanies).toHaveBeenCalledOnce()
    expect(watchlistOperations.listSourceCoverageCatalog).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('Loading watchlist…')

    await react.act(async () => {
      liveInitial.resolve([])
      coverageInitial.resolve([])
      await Promise.resolve()
    })
    await flushMountedWork(react.act)
    expect(container.textContent).toContain('No companies watched yet')

    await react.act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    await flushMountedWork(react.act)
    expect(watchlistOperations.listWatchlistCompanies).toHaveBeenCalledTimes(2)
    expect(watchlistOperations.listSourceCoverageCatalog).toHaveBeenCalledOnce()

    await react.act(async () => root.unmount())
    const remountContainer = document.createElement('div')
    document.body.appendChild(remountContainer)
    const remountRoot = createRoot(remountContainer as unknown as Element)
    await react.act(async () => remountRoot.render(tree()))
    await flushMountedWork(react.act)

    expect(watchlistOperations.listWatchlistCompanies).toHaveBeenCalledTimes(3)
    expect(watchlistOperations.listSourceCoverageCatalog).toHaveBeenCalledOnce()
    expect(remountContainer.textContent).toContain('No companies watched yet')

    await react.act(async () => remountRoot.unmount())
    queryClient.clear()
  })

  it('keeps the combined region pending until both reads settle, then renders either error', async () => {
    const liveInitial = deferred<CompanyRecord[]>()
    const coverageInitial = deferred<SourceCoverageCatalogRecord[]>()
    watchlistOperations.listWatchlistCompanies.mockReturnValue(liveInitial.promise)
    watchlistOperations.listSourceCoverageCatalog.mockReturnValue(coverageInitial.promise)
    const document = installTestDom()
    const {
      createRoot,
      QueryClientProvider,
      queryClient,
      react,
      Watchlist,
    } = await loadMountedWatchlist()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container as unknown as Element)

    await react.act(async () => root.render(react.createElement(
      QueryClientProvider,
      { client: queryClient },
      react.createElement(Watchlist),
    )))
    await flushMountedWork(react.act)
    expect(container.textContent).toContain('Loading watchlist…')

    await react.act(async () => {
      liveInitial.resolve([])
      await Promise.resolve()
    })
    await flushMountedWork(react.act)
    expect(container.textContent).toContain('Loading watchlist…')
    expect(container.textContent).not.toContain('No companies watched yet')

    await react.act(async () => {
      coverageInitial.reject(new Error('coverage unavailable'))
      await Promise.resolve()
    })
    await flushMountedWork(react.act)
    expect(container.textContent).toContain(
      'Unable to load the watchlist. Refresh the page to try again.',
    )
    expect(container.textContent).not.toContain('No companies watched yet')

    await react.act(async () => root.unmount())
    queryClient.clear()
  })

  it('refetches only live companies after successful add and remove settlement', async () => {
    watchlistOperations.listWatchlistCompanies.mockResolvedValue([company])
    watchlistOperations.listSourceCoverageCatalog.mockResolvedValue([coverage])
    watchlistOperations.addCompany.mockResolvedValue(company)
    watchlistOperations.removeCompany.mockResolvedValue(undefined)
    const document = installTestDom()
    const {
      createRoot,
      QueryClientProvider,
      queryClient,
      react,
      Watchlist,
    } = await loadMountedWatchlist()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container as unknown as Element)

    await react.act(async () => root.render(react.createElement(
      QueryClientProvider,
      { client: queryClient },
      react.createElement(Watchlist),
    )))
    await flushMountedWork(react.act)
    expect(container.textContent).toContain('Acme')

    const urlInput = findTestElement(container, (element) =>
      element.getAttribute('placeholder') === 'https://boards.greenhouse.io/company')
    const addForm = findTestElement(container, (element) => element.tagName === 'FORM')
    if (!urlInput || !addForm) throw new Error('Watchlist add controls not mounted')
    nativeSetValue(urlInput, company.careers_url)
    await react.act(async () => addForm.dispatchEvent(new TestEvent('submit')))
    await flushMountedWork(react.act)

    expect(watchlistOperations.addCompany.mock.calls[0]?.[0]).toBe(company.careers_url)
    expect(watchlistOperations.listWatchlistCompanies).toHaveBeenCalledTimes(2)
    expect(watchlistOperations.listSourceCoverageCatalog).toHaveBeenCalledOnce()

    const removeButton = findTestElement(container, (element) =>
      element.getAttribute('aria-label') === 'Remove Acme')
    if (!removeButton) throw new Error('Watchlist remove control not mounted')
    await react.act(async () => removeButton.dispatchEvent(new TestEvent('click')))
    const confirmButton = findTestElement(container, (element) =>
      element.tagName === 'BUTTON' && element.textContent === 'Remove company')
    if (!confirmButton) throw new Error('Watchlist confirmation control not mounted')
    await react.act(async () => confirmButton.dispatchEvent(new TestEvent('click')))
    await flushMountedWork(react.act)

    expect(watchlistOperations.removeCompany.mock.calls[0]?.[0]).toBe(company.id)
    expect(watchlistOperations.listWatchlistCompanies).toHaveBeenCalledTimes(3)
    expect(watchlistOperations.listSourceCoverageCatalog).toHaveBeenCalledOnce()
    expect(invalidateQueries).toHaveBeenCalledTimes(2)
    expect(invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: ['watchlist-companies'],
    })
    expect(invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: ['watchlist-companies'],
    })

    await react.act(async () => root.unmount())
    queryClient.clear()
  })
})

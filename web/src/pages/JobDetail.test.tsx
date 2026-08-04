import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InfiniteData } from '@tanstack/react-query'
import DOMPurify from 'dompurify'
import type { DashboardFeedPage, FeedRow } from '../lib/feed'
import jobDetailSource from './JobDetail.tsx?raw'
import { JobDetail } from './JobDetail'

const feedOperations = vi.hoisted(() => ({
  getFeedJob: vi.fn(),
  markSeen: vi.fn(),
}))

const queryHarness = vi.hoisted(() => {
  const cache = new Map<string, { key: readonly unknown[]; data: unknown }>()
  const keyId = (key: readonly unknown[]) => JSON.stringify(key)
  return {
    cache,
    invalidateQueries: vi.fn(),
    keyId,
    mutationOptions: undefined as undefined | {
      mutationFn: (id: string) => Promise<void>
      onSuccess?: (result: void, id: string) => void
    },
    queryRow: undefined as unknown,
    setQueriesData: vi.fn(),
    setQueryData: vi.fn(),
  }
})

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

vi.mock('../lib/feed', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/feed')>()
  return {
    ...original,
    getFeedJob: feedOperations.getFeedJob,
    markSeen: feedOperations.markSeen,
  }
})

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
  useMutation: (options: typeof queryHarness.mutationOptions) => {
    queryHarness.mutationOptions = options
    return { mutate: vi.fn(), isPending: false }
  },
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === 'job') {
      return { data: queryHarness.queryRow, error: null, isPending: false }
    }
    return { data: [], error: null, isPending: false }
  },
  useQueryClient: () => ({
    invalidateQueries: queryHarness.invalidateQueries,
    setQueriesData: queryHarness.setQueriesData,
    setQueryData: queryHarness.setQueryData,
  }),
}))

function setCached(queryKey: readonly unknown[], data: unknown) {
  queryHarness.cache.set(queryHarness.keyId(queryKey), { key: queryKey, data })
}

function getCached<T>(queryKey: readonly unknown[]): T {
  return queryHarness.cache.get(queryHarness.keyId(queryKey))?.data as T
}

function captureSeenMutation() {
  renderToStaticMarkup(<JobDetail />)
  if (!queryHarness.mutationOptions) throw new Error('JobDetail did not register seen mutation')
  return queryHarness.mutationOptions
}

class TestNode {
  readonly nodeType: number
  readonly ownerDocument: TestDocument
  parentNode: TestNode | null = null
  childNodes: TestNode[] = []
  nodeValue: string | null = null

  constructor(nodeType: number, ownerDocument: TestDocument) {
    this.nodeType = nodeType
    this.ownerDocument = ownerDocument
  }

  get firstChild() {
    return this.childNodes[0] ?? null
  }

  get lastChild() {
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

  addEventListener() {}
  removeEventListener() {}
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
  readonly style: Record<string, string> = {}
  readonly attributes = new Map<string, string>()
  innerHTML = ''

  constructor(tagName: string, ownerDocument: TestDocument) {
    super(1, ownerDocument)
    this.tagName = tagName.toUpperCase()
    this.nodeName = this.tagName
  }

  setAttribute(name: string, value: unknown) {
    this.attributes.set(name, String(value))
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null
  }

  removeAttribute(name: string) {
    this.attributes.delete(name)
  }

  focus() {
    this.ownerDocument.activeElement = this
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
}

function installTestDom() {
  const document = new TestDocument()
  const window = {
    document,
    Node: TestNode,
    Element: TestElement,
    HTMLElement: TestElement,
    HTMLIFrameElement: class TestIFrameElement extends TestElement {},
    getComputedStyle: () => ({}),
    location: { href: 'http://localhost/' },
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  document.defaultView = window
  vi.stubGlobal('document', document)
  vi.stubGlobal('window', window)
  vi.stubGlobal('Node', TestNode)
  vi.stubGlobal('Element', TestElement)
  vi.stubGlobal('HTMLElement', TestElement)
  vi.stubGlobal('navigator', { userAgent: 'test' })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  return document
}

describe('deterministic job detail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryHarness.cache.clear()
    queryHarness.mutationOptions = undefined
    queryHarness.queryRow = row
    queryHarness.setQueryData.mockImplementation((
      queryKey: readonly unknown[],
      value: unknown | ((current: unknown) => unknown),
    ) => {
      const current = queryHarness.cache.get(queryHarness.keyId(queryKey))?.data
      const data = typeof value === 'function'
        ? (value as (current: unknown) => unknown)(current)
        : value
      setCached(queryKey, data)
      return data
    })
    queryHarness.setQueriesData.mockImplementation((
      filters: { queryKey: readonly unknown[] },
      value: (current: unknown) => unknown,
    ) => {
      const results: Array<[readonly unknown[], unknown]> = []
      for (const entry of queryHarness.cache.values()) {
        if (!filters.queryKey.every((part, index) => entry.key[index] === part)) continue
        entry.data = value(entry.data)
        results.push([entry.key, entry.data])
      }
      return results
    })
    feedOperations.markSeen.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('patches matching detail and every Dashboard page after one seen write', () => {
    const detail = { ...row }
    const unrelatedRow = { ...row, id: 'unrelated-user-job', seen_at: null }
    const matchingInFirstPage = { ...row }
    const matchingInSecondPage = { ...row }
    const unchangedPage: DashboardFeedPage = {
      rows: [unrelatedRow],
      nextCursor: null,
      hasMore: false,
      caughtUp: true,
    }
    const firstPage: DashboardFeedPage = {
      rows: [matchingInFirstPage, unrelatedRow],
      nextCursor: 'next',
      hasMore: true,
      caughtUp: false,
    }
    const secondPage: DashboardFeedPage = {
      rows: [matchingInSecondPage],
      nextCursor: null,
      hasMore: false,
      caughtUp: true,
    }
    const focusedFeed: InfiniteData<DashboardFeedPage, string | null> = {
      pages: [firstPage, secondPage],
      pageParams: [null, 'next'],
    }
    const otherFeed: InfiniteData<DashboardFeedPage, string | null> = {
      pages: [unchangedPage],
      pageParams: [null],
    }
    setCached(['job', row.id], detail)
    setCached(['dashboard-feed', 'focused'], focusedFeed)
    setCached(['dashboard-feed', 'other'], otherFeed)
    const mutation = captureSeenMutation()

    mutation.onSuccess?.(undefined, row.id)

    const patchedDetail = getCached<FeedRow>(['job', row.id])
    const patchedFocused = getCached<InfiniteData<DashboardFeedPage, string | null>>([
      'dashboard-feed',
      'focused',
    ])
    const patchedOther = getCached<InfiniteData<DashboardFeedPage, string | null>>([
      'dashboard-feed',
      'other',
    ])
    const seenAt = patchedDetail.seen_at
    expect(seenAt).toEqual(expect.any(String))
    expect(seenAt).not.toBe('')
    expect(patchedFocused.pages.map((page) => page.rows.map((item) => item.seen_at))).toEqual([
      [seenAt, null],
      [seenAt],
    ])
    expect(patchedFocused.pageParams).toBe(focusedFeed.pageParams)
    expect(patchedFocused.pages[0].rows[1]).toBe(unrelatedRow)
    expect(patchedOther).toBe(otherFeed)
    expect(patchedOther.pages[0]).toBe(unchangedPage)
    expect(queryHarness.invalidateQueries).not.toHaveBeenCalled()
    expect(feedOperations.getFeedJob).not.toHaveBeenCalled()
  })

  it('leaves every cache untouched when markSeen rejects', async () => {
    const detail = { ...row }
    const dashboard: InfiniteData<DashboardFeedPage, string | null> = {
      pages: [{ rows: [{ ...row }], nextCursor: null, hasMore: false, caughtUp: true }],
      pageParams: [null],
    }
    setCached(['job', row.id], detail)
    setCached(['dashboard-feed', 'focused'], dashboard)
    feedOperations.markSeen.mockRejectedValueOnce(new Error('offline'))
    const mutation = captureSeenMutation()

    await expect(mutation.mutationFn(row.id)).rejects.toThrow('offline')

    expect(getCached(['job', row.id])).toBe(detail)
    expect(getCached(['dashboard-feed', 'focused'])).toBe(dashboard)
    expect(queryHarness.setQueryData).not.toHaveBeenCalled()
    expect(queryHarness.setQueriesData).not.toHaveBeenCalled()
    expect(queryHarness.invalidateQueries).not.toHaveBeenCalled()
  })

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

  it('sanitizes once per distinct mounted description body', async () => {
    const document = installTestDom()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const react = await import('react')
    const { createRoot } = await import('react-dom/client')
    const root = createRoot(container as unknown as Element)
    const sanitize = vi.mocked(DOMPurify.sanitize)
    sanitize.mockClear()

    await react.act(async () => root.render(<JobDetail />))
    expect(sanitize).toHaveBeenCalledOnce()
    expect(sanitize).toHaveBeenLastCalledWith(
      '<p>Safe description</p>',
      { FORBID_TAGS: ['style', 'form'] },
    )

    queryHarness.queryRow = { ...row, seen_at: '2026-08-04T03:20:00.000Z' }
    await react.act(async () => root.render(<JobDetail />))
    expect(sanitize).toHaveBeenCalledOnce()

    queryHarness.queryRow = {
      ...row,
      seen_at: '2026-08-04T03:20:00.000Z',
      jobs: { ...row.jobs!, description_html: '<p>Changed description</p>' },
    }
    await react.act(async () => root.render(<JobDetail />))
    expect(sanitize).toHaveBeenCalledTimes(2)
    expect(sanitize).toHaveBeenLastCalledWith(
      '<p>Changed description</p>',
      { FORBID_TAGS: ['style', 'form'] },
    )

    await react.act(async () => root.unmount())
  })
})

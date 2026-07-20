import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Preferences } from './Preferences'

const mocks = vi.hoisted(() => ({
  cancelQueries: vi.fn(),
  invalidateQueries: vi.fn(),
  mutationOptions: undefined as undefined | {
    mutationFn: () => Promise<void>
    onSuccess: () => Promise<void>
    onError: () => void
  },
  queryClient: undefined as unknown,
  removeQueries: vi.fn(),
  savePreferences: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: (options: typeof mocks.mutationOptions) => {
    mocks.mutationOptions = options
    return { isPending: false, mutate: vi.fn() }
  },
  useQuery: () => ({
    data: {
      titles: ['Equity Research'],
      locations: [],
      include_keywords: [],
      exclude_keywords: [],
    },
    isPending: false,
  }),
  useQueryClient: () => mocks.queryClient,
}))

vi.mock('../lib/preferences', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/preferences')>()
  return { ...original, loadPreferences: vi.fn(), savePreferences: mocks.savePreferences }
})

function captureMutation() {
  renderToStaticMarkup(<Preferences />)
  if (!mocks.mutationOptions) throw new Error('Preferences did not register its mutation')
  return mocks.mutationOptions
}

describe('preference save cache gap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mutationOptions = undefined
    mocks.cancelQueries.mockResolvedValue(undefined)
    mocks.invalidateQueries.mockResolvedValue(undefined)
    mocks.queryClient = {
      cancelQueries: mocks.cancelQueries,
      invalidateQueries: mocks.invalidateQueries,
      removeQueries: mocks.removeQueries,
    }
    mocks.savePreferences.mockResolvedValue(undefined)
  })

  it('cancels removes and invalidates feed only after signal success', async () => {
    const events: string[] = []
    let completeSave!: () => void
    mocks.savePreferences.mockImplementation(() => new Promise<void>((resolve) => {
      completeSave = resolve
    }))
    mocks.cancelQueries.mockImplementation(async () => { events.push('cancel feed') })
    mocks.removeQueries.mockImplementation(() => { events.push('remove feed') })
    mocks.invalidateQueries.mockImplementation(async ({ queryKey }: { queryKey: string[] }) => {
      events.push(`invalidate ${queryKey[0]}`)
    })
    const mutation = captureMutation()

    const pendingSave = mutation.mutationFn()
    expect(events).toEqual([])
    completeSave()
    await pendingSave
    await mutation.onSuccess()

    expect(events).toEqual([
      'cancel feed',
      'remove feed',
      'invalidate feed',
      'invalidate preferences',
    ])
  })

  it('keeps feed cache untouched when saving fails', () => {
    const mutation = captureMutation()

    mutation.onError()

    expect(mocks.cancelQueries).not.toHaveBeenCalled()
    expect(mocks.removeQueries).not.toHaveBeenCalled()
    expect(mocks.invalidateQueries).not.toHaveBeenCalled()
  })
})

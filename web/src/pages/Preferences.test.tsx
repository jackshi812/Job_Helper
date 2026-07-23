import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import preferencesSource from './Preferences.tsx?raw'
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
      user_id: 'user-1',
      titles: ['Equity Research'],
      locations: [],
      include_keywords: [],
      exclude_keywords: [],
      title_exclude_keywords: [],
      updated_at: '2026-07-22T00:00:00.000Z',
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

describe('title exclusion preference form', () => {
  it('uses exact approved copy and field order without experience-year language', () => {
    const markup = renderToStaticMarkup(<Preferences />)
    const target = markup.indexOf('Target titles')
    const titleExclusions = markup.indexOf('Exclude title keywords')
    const locations = markup.indexOf('Locations')
    const include = markup.indexOf('Include keywords')
    const exclude = markup.indexOf('Exclude keywords')

    expect(target).toBeGreaterThan(-1)
    expect(target).toBeLessThan(titleExclusions)
    expect(titleExclusions).toBeLessThan(locations)
    expect(locations).toBeLessThan(include)
    expect(include).toBeLessThan(exclude)
    expect(markup).toContain(
      'Jobs are excluded when their title contains one of these words or phrases. PhD also matches Ph.D. and Ph D.',
    )
    expect(markup).toContain('Type and press Enter or comma')
    expect(markup).not.toContain('Maximum required experience')
    expect(markup).not.toContain('pref-max-experience')
  })

  it('seeds only a missing row and preserves a stored empty array', () => {
    expect(preferencesSource).toContain('data === null')
    expect(preferencesSource).toContain('[...DEFAULT_TITLE_EXCLUSIONS]')
    expect(preferencesSource).toContain('[...data.title_exclude_keywords]')
    expect(preferencesSource).toContain('if (data === undefined) return')
    expect(preferencesSource).not.toContain('data.title_exclude_keywords.length')
  })

  it('keeps canonical cross-commit dedupe, validation, pending disablement, and explicit save payload', () => {
    expect(preferencesSource).toContain('chipComparisonKey(value)')
    expect(preferencesSource).toContain('chipComparisonKey(addition)')
    expect(preferencesSource).toContain('validateTitleExclusions(titleExcludeKeywords)')
    expect(preferencesSource).toContain('title_exclude_keywords: titleExcludeKeywords')
    expect(preferencesSource).toContain('disabled={pending}')
    expect(preferencesSource).toContain("setMessage('Preferences saved — recent jobs re-filtering.')")
    expect(preferencesSource).toContain(
      'setError("Couldn\'t save preferences. Your changes are still in the form — retry.")',
    )
    expect(preferencesSource).not.toContain('maxRequiredExperience')
    expect(preferencesSource).not.toContain('experienceError')
  })
})

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

  it('sends title exclusions explicitly without an experience payload', async () => {
    const mutation = captureMutation()

    await mutation.mutationFn()

    expect(mocks.savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ title_exclude_keywords: [] }),
    )
    expect(mocks.savePreferences).not.toHaveBeenCalledWith(
      expect.objectContaining({ max_required_experience: expect.anything() }),
    )
  })

  it('keeps feed cache untouched when saving fails', () => {
    const mutation = captureMutation()

    mutation.onError()

    expect(mocks.cancelQueries).not.toHaveBeenCalled()
    expect(mocks.removeQueries).not.toHaveBeenCalled()
    expect(mocks.invalidateQueries).not.toHaveBeenCalled()
  })
})

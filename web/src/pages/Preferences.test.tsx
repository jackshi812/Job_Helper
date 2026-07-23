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
      max_required_experience: null,
      ranking_rubric: {
        strictTitle: 30,
        weakTitle: 20,
        preferredLocation: 10,
        recency: 10,
        watchlist: 10,
        experience: 20,
        includeKeywordSteps: {
          one: 3,
          two: 5,
          three: 10,
          four: 15,
          fivePlus: 20,
        },
      },
      ranking_good_threshold: 50,
      ranking_strong_threshold: 75,
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

describe('deterministic ranking preference form', () => {
  it('uses the approved complete form order and exact rubric copy', () => {
    const markup = renderToStaticMarkup(<Preferences />)
    const target = markup.indexOf('Target titles')
    const titleExclusions = markup.indexOf('Exclude title keywords')
    const locations = markup.indexOf('Locations')
    const maximumExperience = markup.indexOf('Maximum required experience (years)')
    const include = markup.indexOf('Include keywords')
    const exclude = markup.indexOf('Exclude keywords')
    const rubric = markup.indexOf('Ranking rubric')
    const thresholds = markup.indexOf('Score thresholds')

    expect(target).toBeGreaterThan(-1)
    expect(target).toBeLessThan(titleExclusions)
    expect(titleExclusions).toBeLessThan(locations)
    expect(locations).toBeLessThan(maximumExperience)
    expect(maximumExperience).toBeLessThan(include)
    expect(include).toBeLessThan(exclude)
    expect(exclude).toBeLessThan(rubric)
    expect(rubric).toBeLessThan(thresholds)
    expect(markup).toContain(
      'Jobs are excluded when their title contains one of these words or phrases. PhD also matches Ph.D. and Ph D.',
    )
    expect(markup).toContain(
      'Jobs earn experience points only when an explicit required minimum is below this value. Leave blank to award no experience points. This never filters a job.',
    )
    expect(markup).toContain(
      'Choose how many points each match signal earns. Category maximums must total 100.',
    )
    expect(markup).toContain('Category maximums: 100 / 100 points')
    expect(markup).toContain('Weak: 0–49 · Good: 50–74 · Strong: 75–100')
    expect(markup).toContain('Type and press Enter or comma')
  })

  it('seeds only a missing row and preserves a stored empty array', () => {
    expect(preferencesSource).toContain('data === null')
    expect(preferencesSource).toContain('[...DEFAULT_TITLE_EXCLUSIONS]')
    expect(preferencesSource).toContain('[...data.title_exclude_keywords]')
    expect(preferencesSource).toContain('if (data === undefined) return')
    expect(preferencesSource).not.toContain('data.title_exclude_keywords.length')
  })

  it('wires semantic groups, accessible errors, invalid focus, and complete save payload', () => {
    expect(preferencesSource).toContain('chipComparisonKey(value)')
    expect(preferencesSource).toContain('chipComparisonKey(addition)')
    expect(preferencesSource).toContain('validatePreferenceTextArrays')
    expect(preferencesSource).toContain('textArrayValidation.firstInvalidField')
    expect(preferencesSource).toContain('requestAnimationFrame')
    expect(preferencesSource).toContain('document.getElementById(firstInvalidField)?.focus()')
    for (const id of [
      'pref-titles-error',
      'pref-title-exclude-error',
      'pref-locations-error',
      'pref-include-error',
      'pref-exclude-error',
    ]) {
      expect(preferencesSource).toContain(id)
    }
    expect(preferencesSource).toContain('validateRankingForm')
    expect(preferencesSource).toContain('firstInvalidField')
    expect(preferencesSource).toContain('document.getElementById')
    expect(preferencesSource).toContain('<fieldset')
    expect(preferencesSource).toContain('<legend')
    expect(preferencesSource).toContain('aria-describedby')
    expect(preferencesSource).toContain('aria-invalid')
    expect(preferencesSource).toContain('title_exclude_keywords: titleExcludeKeywords')
    expect(preferencesSource).toContain('max_required_experience:')
    expect(preferencesSource).toContain('ranking_rubric:')
    expect(preferencesSource).toContain('ranking_good_threshold:')
    expect(preferencesSource).toContain('ranking_strong_threshold:')
    expect(preferencesSource).toContain('disabled={pending}')
    expect(preferencesSource).toContain("setMessage('Preferences saved. Updating rankings…')")
    expect(preferencesSource).toContain(
      "setError('Couldn’t save these ranking settings. Check the highlighted values and retry.')",
    )
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

  it('keeps the complete prior feed cache untouched after an accepted save', async () => {
    const mutation = captureMutation()

    await mutation.mutationFn()
    await mutation.onSuccess()

    expect(mocks.cancelQueries).not.toHaveBeenCalled()
    expect(mocks.removeQueries).not.toHaveBeenCalled()
    expect(mocks.invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['feed'] })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['preferences'] })
  })

  it('sends title exclusions, blank maximum, rubric, and thresholds explicitly', async () => {
    const mutation = captureMutation()

    await mutation.mutationFn()

    expect(mocks.savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        title_exclude_keywords: [],
        max_required_experience: null,
        ranking_rubric: expect.objectContaining({ strictTitle: 30 }),
        ranking_good_threshold: 50,
        ranking_strong_threshold: 75,
      }),
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

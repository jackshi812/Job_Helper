import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from '../auth/AuthProvider'
import {
  DEFAULT_GOOD_THRESHOLD,
  DEFAULT_RANKING_RUBRIC,
  DEFAULT_STRONG_THRESHOLD,
  DEFAULT_TITLE_EXCLUSIONS,
  chipComparisonKey,
  loadPreferences,
  mergeChips,
  parseChips,
  rankingRubricToForm,
  savePreferences,
  validatePreferenceTextArrays,
  validateRankingForm,
  type PreferencesRecord,
  type RankingFormValues,
} from '../lib/preferences'

const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-zinc-100'

const CHIP_BADGE =
  'inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-0.5 text-xs font-semibold text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400'

const INPUT_CLASSES =
  'mt-1.5 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950'

interface ChipInputProps {
  id: string
  label: string
  helper?: string
  values: string[]
  onChange: (next: string[]) => void
  disabled: boolean
  error?: string
  errorId: string
  draftValue?: string
  onDraftChange?: (value: string) => void
}

function ChipInput({
  id,
  label,
  helper,
  values,
  onChange,
  disabled,
  error,
  errorId,
  draftValue,
  onDraftChange,
}: ChipInputProps) {
  const [localDraft, setLocalDraft] = useState('')
  const draft = draftValue ?? localDraft
  const helperId = `${id}-helper`

  function setDraft(value: string) {
    if (onDraftChange) onDraftChange(value)
    else setLocalDraft(value)
  }

  function commit(raw: string) {
    const additions = parseChips(raw)
    if (additions.length === 0) {
      setDraft('')
      return
    }
    const next = [...values]
    const seen = new Set(next.map((value) => chipComparisonKey(value)))
    for (const addition of additions) {
      const comparisonKey = chipComparisonKey(addition)
      if (seen.has(comparisonKey)) continue
      seen.add(comparisonKey)
      next.push(addition)
    }
    onChange(next)
    setDraft('')
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      commit(draft)
    } else if (event.key === 'Backspace' && draft === '' && values.length > 0) {
      onChange(values.slice(0, -1))
    }
  }

  function removeChip(keyword: string) {
    onChange(values.filter((value) => value !== keyword))
  }

  return (
    <fieldset className="grid min-w-0 gap-1.5 border-0 p-0">
      <legend className="text-sm font-medium">
        {label}
      </legend>
      {helper ? <p id={helperId} className="text-xs text-zinc-500">{helper}</p> : null}
      {values.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {values.map((keyword) => (
            <li key={keyword}>
              <span className={CHIP_BADGE}>
                {keyword}
                <button
                  type="button"
                  onClick={() => removeChip(keyword)}
                  disabled={disabled}
                  aria-label={`Remove ${keyword}`}
                  className={`inline-flex min-h-9 items-center rounded-full px-1 text-zinc-500 hover:text-zinc-900 disabled:opacity-60 dark:hover:text-zinc-100 ${FOCUS_RING}`}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <input
        id={id}
        name={id}
        type="text"
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => commit(draft)}
        placeholder="Type and press Enter or comma"
        aria-label={`Add ${label.toLowerCase()}`}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={[
          helper ? helperId : null,
          error ? errorId : null,
        ].filter(Boolean).join(' ') || undefined}
        className={`${INPUT_CLASSES} ${FOCUS_RING}`}
      />
      {error ? (
        <p id={errorId} className="text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </fieldset>
  )
}

function titleExclusionsForPreferences(data: PreferencesRecord | null): string[] {
  return data === null
    ? [...DEFAULT_TITLE_EXCLUSIONS]
    : [...data.title_exclude_keywords]
}

const DEFAULT_RUBRIC_FORM = rankingRubricToForm(DEFAULT_RANKING_RUBRIC)

interface PointInputProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  onBlur: () => void
  error?: string
  disabled: boolean
}

function PointInput({
  id,
  label,
  value,
  onChange,
  onBlur,
  error,
  disabled,
}: PointInputProps) {
  const helperId = `${id}-helper`
  const errorId = `${id}-error`
  return (
    <div className="grid min-w-0 gap-1 sm:grid-cols-[minmax(0,1fr)_6rem] sm:items-center">
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        max={100}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${helperId} ${errorId}` : helperId}
        className={`${INPUT_CLASSES} mt-0 w-24 justify-self-start tabular-nums sm:justify-self-end ${FOCUS_RING}`}
      />
      <span id={helperId} className="sr-only">
        Whole number from 0 to 100.
      </span>
      {error ? (
        <p id={errorId} className="text-xs text-red-700 sm:col-span-2 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function Preferences() {
  const queryClient = useQueryClient()
  const { session } = useSession()
  const [titles, setTitles] = useState<string[]>([])
  const [titleDraft, setTitleDraft] = useState('')
  const [locations, setLocations] = useState<string[]>([])
  const [includeKeywords, setIncludeKeywords] = useState<string[]>([])
  const [excludeKeywords, setExcludeKeywords] = useState<string[]>([])
  const [titleExcludeKeywords, setTitleExcludeKeywords] = useState<string[]>([])
  const [maxRequiredExperience, setMaxRequiredExperience] = useState('')
  const [rubric, setRubric] =
    useState<RankingFormValues['rubric']>(DEFAULT_RUBRIC_FORM)
  const [goodThreshold, setGoodThreshold] = useState(String(DEFAULT_GOOD_THRESHOLD))
  const [strongThreshold, setStrongThreshold] = useState(String(DEFAULT_STRONG_THRESHOLD))
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formValidationError, setFormValidationError] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const preferencesQuery = useQuery({
    queryKey: ['preferences'],
    queryFn: loadPreferences,
  })

  useEffect(() => {
    const data = preferencesQuery.data
    if (data === undefined) return
    setTitles(data?.titles ?? [])
    setLocations(data?.locations ?? [])
    setIncludeKeywords(data?.include_keywords ?? [])
    setExcludeKeywords(data?.exclude_keywords ?? [])
    setTitleExcludeKeywords(titleExclusionsForPreferences(data))
    setMaxRequiredExperience(
      data?.max_required_experience === null || data?.max_required_experience === undefined
        ? ''
        : String(data.max_required_experience),
    )
    setRubric(rankingRubricToForm(data?.ranking_rubric ?? DEFAULT_RANKING_RUBRIC))
    setGoodThreshold(String(data?.ranking_good_threshold ?? DEFAULT_GOOD_THRESHOLD))
    setStrongThreshold(String(data?.ranking_strong_threshold ?? DEFAULT_STRONG_THRESHOLD))
  }, [preferencesQuery.data])

  function currentRankingForm(): RankingFormValues {
    return { maxRequiredExperience, rubric, goodThreshold, strongThreshold }
  }

  function currentTextArrays(nextTitles = titles) {
    return {
      titles: nextTitles,
      title_exclude_keywords: titleExcludeKeywords,
      locations,
      include_keywords: includeKeywords,
      exclude_keywords: excludeKeywords,
    }
  }

  function validateVisibleForm(nextTitles = titles) {
    const textArrayValidation = validatePreferenceTextArrays(currentTextArrays(nextTitles))
    const rankingValidation = validateRankingForm(currentRankingForm())
    const nextFieldErrors = {
      ...textArrayValidation.fieldErrors,
      ...rankingValidation.fieldErrors,
    }
    const formOrder = [
      'pref-titles',
      'pref-title-exclude',
      'pref-locations',
      'pref-max-experience',
      'pref-include',
      'pref-exclude',
      'ranking-strict-title',
      'ranking-weak-title',
      'ranking-preferred-location',
      'ranking-recency',
      'ranking-watchlist',
      'ranking-experience',
      'ranking-keyword-one',
      'ranking-keyword-two',
      'ranking-keyword-three',
      'ranking-keyword-four',
      'ranking-keyword-five-plus',
      'ranking-keyword-steps',
      'ranking-total',
      'ranking-good-threshold',
      'ranking-strong-threshold',
    ]
    const firstInvalidField =
      formOrder.find((field) => nextFieldErrors[field]) ?? null
    setFieldErrors(nextFieldErrors)
    return {
      valid: textArrayValidation.valid && rankingValidation.valid,
      firstInvalidField,
      rankingValidation,
      textArrayValidation,
    }
  }

  function focusInvalidField(firstInvalidField: string | null) {
    if (!firstInvalidField) return
    requestAnimationFrame(() => document.getElementById(firstInvalidField)?.focus())
  }

  const saveMutation = useMutation({
    mutationFn: savePreferences,
    onSuccess: (_result, submitted) => {
      setError(null)
      setFormValidationError(false)
      setMessage('Preferences saved. Updating rankings…')
      const updatedAt = new Date().toISOString()
      queryClient.setQueryData<PreferencesRecord>(['preferences'], (current) => {
        const userId = current?.user_id ?? session?.user.id
        if (!userId) return current
        return {
          ...submitted,
          user_id: userId,
          updated_at: updatedAt,
        }
      })
    },
    onError: () => {
      const validation = validateVisibleForm()
      setMessage(null)
      setError('Couldn’t save these ranking settings. Check the highlighted values and retry.')
      setFormValidationError(!validation.valid)
      focusInvalidField(validation.firstInvalidField)
    },
  })

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)
    setError(null)
    const visibleDraft = new FormData(event.currentTarget).get('pref-titles')
    const submittedTitles = mergeChips(
      titles,
      typeof visibleDraft === 'string' ? visibleDraft : titleDraft,
    )
    const validation = validateVisibleForm(submittedTitles)
    if (!validation.valid) {
      setFormValidationError(true)
      focusInvalidField(validation.firstInvalidField)
      return
    }
    setFormValidationError(false)
    setTitles(submittedTitles)
    setTitleDraft('')
    saveMutation.mutate({
      titles: submittedTitles,
      locations,
      include_keywords: includeKeywords,
      exclude_keywords: excludeKeywords,
      title_exclude_keywords: titleExcludeKeywords,
      max_required_experience: validation.rankingValidation.value!.maxRequiredExperience,
      ranking_rubric: validation.rankingValidation.value!.rubric,
      ranking_good_threshold: validation.rankingValidation.value!.goodThreshold,
      ranking_strong_threshold: validation.rankingValidation.value!.strongThreshold,
    })
  }

  const pending = saveMutation.isPending
  const currentValidation = validateRankingForm(currentRankingForm())
  const parsedRubric = currentValidation.value?.rubric
  const categoryTotal = parsedRubric
    ? parsedRubric.strictTitle
      + parsedRubric.preferredLocation
      + parsedRubric.recency
      + parsedRubric.watchlist
      + parsedRubric.experience
      + parsedRubric.includeKeywordSteps.fivePlus
    : [
      rubric.strictTitle,
      rubric.preferredLocation,
      rubric.recency,
      rubric.watchlist,
      rubric.experience,
      rubric.includeKeywordSteps.fivePlus,
    ].reduce((total, value) => total + (/^\d+$/.test(value) ? Number(value) : 0), 0)
  const parsedGood = /^\d+$/.test(goodThreshold) ? Number(goodThreshold) : null
  const parsedStrong = /^\d+$/.test(strongThreshold) ? Number(strongThreshold) : null
  const thresholdsHaveLiveRange =
    parsedGood !== null
    && parsedStrong !== null
    && parsedGood > 0
    && parsedGood < parsedStrong
    && parsedStrong <= 100

  function updateRubricField(
    key: Exclude<keyof RankingFormValues['rubric'], 'includeKeywordSteps'>,
    value: string,
  ) {
    setRubric((current) => ({ ...current, [key]: value }))
  }

  function updateKeywordStep(
    key: keyof RankingFormValues['rubric']['includeKeywordSteps'],
    value: string,
  ) {
    setRubric((current) => ({
      ...current,
      includeKeywordSteps: { ...current.includeKeywordSteps, [key]: value },
    }))
  }

  return (
    <section className="max-w-2xl">
      <h1 className="text-xl font-semibold tracking-tight">Preferences</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Matching starts once you save at least one target title.
      </p>

      {preferencesQuery.isPending ? (
        <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">Loading…</p>
      ) : (
        <form onSubmit={handleSubmit} className="mt-6 grid gap-6">
          <ChipInput
            id="pref-titles"
            label="Target titles"
            values={titles}
            onChange={setTitles}
            disabled={pending}
            error={fieldErrors['pref-titles']}
            errorId="pref-titles-error"
            draftValue={titleDraft}
            onDraftChange={setTitleDraft}
          />
          <ChipInput
            id="pref-title-exclude"
            label="Exclude title keywords"
            helper="Jobs are excluded when their title contains one of these words or phrases. PhD also matches Ph.D. and Ph D."
            values={titleExcludeKeywords}
            onChange={setTitleExcludeKeywords}
            disabled={pending}
            error={fieldErrors['pref-title-exclude']}
            errorId="pref-title-exclude-error"
          />
          <ChipInput
            id="pref-locations"
            label="Locations"
            values={locations}
            onChange={setLocations}
            disabled={pending}
            error={fieldErrors['pref-locations']}
            errorId="pref-locations-error"
          />
          <div className="grid gap-1.5">
            <label htmlFor="pref-max-experience" className="text-sm font-medium">
              Maximum required experience (years)
            </label>
            <p id="pref-max-experience-helper" className="text-xs text-zinc-500">
              Jobs earn experience points only when an explicit required minimum is below this
              value. Leave blank to award no experience points. This never filters a job.
            </p>
            <input
              id="pref-max-experience"
              type="number"
              inputMode="numeric"
              min={0}
              max={20}
              step={1}
              value={maxRequiredExperience}
              disabled={pending}
              onChange={(event) => setMaxRequiredExperience(event.target.value)}
              onBlur={() => validateVisibleForm()}
              aria-invalid={fieldErrors['pref-max-experience'] ? 'true' : undefined}
              aria-describedby={
                fieldErrors['pref-max-experience']
                  ? 'pref-max-experience-helper pref-max-experience-error'
                  : 'pref-max-experience-helper'
              }
              className={`${INPUT_CLASSES} w-32 tabular-nums ${FOCUS_RING}`}
            />
            {fieldErrors['pref-max-experience'] ? (
              <p id="pref-max-experience-error" className="text-xs text-red-700 dark:text-red-400">
                {fieldErrors['pref-max-experience']}
              </p>
            ) : null}
          </div>
          <ChipInput
            id="pref-include"
            label="Include keywords"
            helper="Boost scoring — never discard."
            values={includeKeywords}
            onChange={setIncludeKeywords}
            disabled={pending}
            error={fieldErrors['pref-include']}
            errorId="pref-include-error"
          />
          <ChipInput
            id="pref-exclude"
            label="Exclude keywords"
            helper="Any hit discards the posting before scoring."
            values={excludeKeywords}
            onChange={setExcludeKeywords}
            disabled={pending}
            error={fieldErrors['pref-exclude']}
            errorId="pref-exclude-error"
          />

          <section className="grid gap-6 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
            <div>
              <h2 className="text-base font-semibold">Ranking rubric</h2>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Choose how many points each match signal earns. Category maximums must total 100.
              </p>
            </div>

            <fieldset disabled={pending} className="grid gap-3">
              <legend className="mb-2 text-sm font-semibold">Title match</legend>
              <PointInput
                id="ranking-strict-title"
                label="Strict title match points"
                value={rubric.strictTitle}
                onChange={(value) => updateRubricField('strictTitle', value)}
                onBlur={validateVisibleForm}
                error={fieldErrors['ranking-strict-title']}
                disabled={pending}
              />
              <PointInput
                id="ranking-weak-title"
                label="Weak title match points"
                value={rubric.weakTitle}
                onChange={(value) => updateRubricField('weakTitle', value)}
                onBlur={validateVisibleForm}
                error={fieldErrors['ranking-weak-title']}
                disabled={pending}
              />
            </fieldset>

            <fieldset disabled={pending} className="grid gap-3">
              <legend className="mb-2 text-sm font-semibold">Ranking signals</legend>
              <PointInput
                id="ranking-preferred-location"
                label="Preferred location points"
                value={rubric.preferredLocation}
                onChange={(value) => updateRubricField('preferredLocation', value)}
                onBlur={validateVisibleForm}
                error={fieldErrors['ranking-preferred-location']}
                disabled={pending}
              />
              <PointInput
                id="ranking-recency"
                label="Posted within 24 hours points"
                value={rubric.recency}
                onChange={(value) => updateRubricField('recency', value)}
                onBlur={validateVisibleForm}
                error={fieldErrors['ranking-recency']}
                disabled={pending}
              />
              <PointInput
                id="ranking-watchlist"
                label="Watchlist source points"
                value={rubric.watchlist}
                onChange={(value) => updateRubricField('watchlist', value)}
                onBlur={validateVisibleForm}
                error={fieldErrors['ranking-watchlist']}
                disabled={pending}
              />
              <PointInput
                id="ranking-experience"
                label="Required experience below maximum points"
                value={rubric.experience}
                onChange={(value) => updateRubricField('experience', value)}
                onBlur={validateVisibleForm}
                error={fieldErrors['ranking-experience']}
                disabled={pending}
              />
            </fieldset>

            <fieldset
              disabled={pending}
              aria-describedby={
                fieldErrors['ranking-keyword-steps'] ? 'ranking-keyword-steps-error' : undefined
              }
              className="grid gap-3"
            >
              <legend className="mb-2 text-sm font-semibold">Description keywords</legend>
              <div
                id="ranking-keyword-steps"
                className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:grid-cols-5"
              >
                {([
                  ['one', '1 match', 'ranking-keyword-one'],
                  ['two', '2 matches', 'ranking-keyword-two'],
                  ['three', '3 matches', 'ranking-keyword-three'],
                  ['four', '4 matches', 'ranking-keyword-four'],
                  ['fivePlus', '5+ matches', 'ranking-keyword-five-plus'],
                ] as const).map(([key, label, id]) => (
                  <div key={key} className="grid gap-1">
                    <label htmlFor={id} className="text-xs font-semibold">
                      {label}
                    </label>
                    <input
                      id={id}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={100}
                      step={1}
                      value={rubric.includeKeywordSteps[key]}
                      disabled={pending}
                      onChange={(event) => updateKeywordStep(key, event.target.value)}
                      onBlur={() => validateVisibleForm()}
                      aria-invalid={
                        fieldErrors[id] || fieldErrors['ranking-keyword-steps']
                          ? 'true'
                          : undefined
                      }
                      aria-describedby={
                        fieldErrors['ranking-keyword-steps']
                          ? 'ranking-keyword-steps-error'
                          : undefined
                      }
                      className={`${INPUT_CLASSES} mt-0 w-full tabular-nums ${FOCUS_RING}`}
                    />
                  </div>
                ))}
              </div>
              {fieldErrors['ranking-keyword-steps'] ? (
                <p id="ranking-keyword-steps-error" className="text-xs text-red-700 dark:text-red-400">
                  {fieldErrors['ranking-keyword-steps']}
                </p>
              ) : null}
            </fieldset>

            <div
              id="ranking-total"
              className={`border-t border-zinc-200 pt-4 text-sm font-semibold tabular-nums dark:border-zinc-800 ${
                categoryTotal === 100 ? '' : 'text-red-700 dark:text-red-400'
              }`}
            >
              Category maximums: {categoryTotal} / 100 points
              {fieldErrors['ranking-total'] ? (
                <p className="mt-1 text-xs font-normal" role="alert">
                  {fieldErrors['ranking-total']}
                </p>
              ) : null}
            </div>

            <fieldset disabled={pending} className="grid gap-3">
              <legend className="mb-2 text-sm font-semibold">Score thresholds</legend>
              <PointInput
                id="ranking-good-threshold"
                label="Good starts at"
                value={goodThreshold}
                onChange={setGoodThreshold}
                onBlur={validateVisibleForm}
                error={fieldErrors['ranking-good-threshold']}
                disabled={pending}
              />
              <PointInput
                id="ranking-strong-threshold"
                label="Strong starts at"
                value={strongThreshold}
                onChange={setStrongThreshold}
                onBlur={validateVisibleForm}
                error={fieldErrors['ranking-strong-threshold']}
                disabled={pending}
              />
              {thresholdsHaveLiveRange ? (
                <p className="text-xs text-zinc-500">
                  Weak: 0–{parsedGood! - 1} · Good: {parsedGood}–{parsedStrong! - 1} · Strong:{' '}
                  {parsedStrong}–100
                </p>
              ) : null}
            </fieldset>
          </section>

          {formValidationError ? (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              Fix the highlighted ranking settings before saving.
            </p>
          ) : null}
          {message ? (
            <p role="status" aria-live="polite" className="text-sm text-zinc-600 dark:text-zinc-400">
              {message}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {error}
            </p>
          ) : null}

          <div>
            <button
              type="submit"
              disabled={pending}
              className={`rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-wait disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white ${FOCUS_RING}`}
            >
              {pending ? 'Saving…' : 'Save preferences'}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}

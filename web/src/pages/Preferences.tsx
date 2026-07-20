import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { loadPreferences, parseChips, savePreferences } from '../lib/preferences'

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
}

function ChipInput({ id, label, helper, values, onChange, disabled }: ChipInputProps) {
  const [draft, setDraft] = useState('')

  function commit(raw: string) {
    const additions = parseChips(raw)
    if (additions.length === 0) {
      setDraft('')
      return
    }
    const next = [...values]
    for (const addition of additions) {
      if (!next.includes(addition)) next.push(addition)
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
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {helper ? <p className="text-xs text-zinc-500">{helper}</p> : null}
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
        type="text"
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => commit(draft)}
        placeholder="Type and press Enter or comma"
        className={`${INPUT_CLASSES} ${FOCUS_RING}`}
      />
    </div>
  )
}

export function Preferences() {
  const queryClient = useQueryClient()
  const [titles, setTitles] = useState<string[]>([])
  const [locations, setLocations] = useState<string[]>([])
  const [includeKeywords, setIncludeKeywords] = useState<string[]>([])
  const [excludeKeywords, setExcludeKeywords] = useState<string[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const preferencesQuery = useQuery({
    queryKey: ['preferences'],
    queryFn: loadPreferences,
  })

  useEffect(() => {
    const data = preferencesQuery.data
    if (!data) return
    setTitles(data.titles ?? [])
    setLocations(data.locations ?? [])
    setIncludeKeywords(data.include_keywords ?? [])
    setExcludeKeywords(data.exclude_keywords ?? [])
  }, [preferencesQuery.data])

  const saveMutation = useMutation({
    mutationFn: () =>
      savePreferences({
        titles,
        locations,
        include_keywords: includeKeywords,
        exclude_keywords: excludeKeywords,
      }),
    onSuccess: async () => {
      setError(null)
      await queryClient.cancelQueries({ queryKey: ['feed'] })
      queryClient.removeQueries({ queryKey: ['feed'] })
      setMessage('Preferences saved — recent jobs re-filtering.')
      await queryClient.invalidateQueries({ queryKey: ['feed'] })
      await queryClient.invalidateQueries({ queryKey: ['preferences'] })
    },
    onError: () => {
      setMessage(null)
      setError("Couldn't save preferences. Your changes are still in the form — retry.")
    },
  })

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)
    setError(null)
    saveMutation.mutate()
  }

  const pending = saveMutation.isPending

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
          />
          <ChipInput
            id="pref-locations"
            label="Locations"
            values={locations}
            onChange={setLocations}
            disabled={pending}
          />
          <ChipInput
            id="pref-include"
            label="Include keywords"
            helper="Boost scoring — never discard."
            values={includeKeywords}
            onChange={setIncludeKeywords}
            disabled={pending}
          />
          <ChipInput
            id="pref-exclude"
            label="Exclude keywords"
            helper="Any hit discards the posting before scoring."
            values={excludeKeywords}
            onChange={setExcludeKeywords}
            disabled={pending}
          />

          {message ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{message}</p>
          ) : null}
          {error ? <p className="text-sm text-red-700 dark:text-red-400">{error}</p> : null}

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

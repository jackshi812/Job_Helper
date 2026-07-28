import { useEffect, useId, useMemo, useState, type FormEvent } from 'react'
import { ConfirmDialog } from './ConfirmDialog'
import {
  decorateRepeatedStageOrdinals,
  TRACKER_STAGES,
  type DecoratedTrackerStageEvent,
  type TrackerStage,
  type TrackerStageEvent,
} from '../lib/tracker'

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

function dateOnlyToLocalDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function formatDateOnly(value: string): string {
  return dateFormatter.format(dateOnlyToLocalDate(value))
}

export interface ApplicationTimelineProps {
  applicationTitle: string
  events: readonly TrackerStageEvent[]
  onSave: (
    eventId: string,
    stage: TrackerStage,
    occurredOn: string,
  ) => void | Promise<void>
  onDelete: (eventId: string) => void | Promise<void>
}

export function ApplicationTimeline({
  applicationTitle,
  events,
  onSave,
  onDelete,
}: ApplicationTimelineProps) {
  const headingId = useId()
  const orderedEvents = useMemo(
    () => decorateRepeatedStageOrdinals(events),
    [events],
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [stageDraft, setStageDraft] = useState<TrackerStage>('ready_to_apply')
  const [dateDraft, setDateDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(false)
  const [deleteError, setDeleteError] = useState(false)

  const selectedEvent = orderedEvents.find(({ id }) => id === selectedId) ?? null

  useEffect(() => {
    if (!selectedEvent) return
    setStageDraft(selectedEvent.stage)
    setDateDraft(selectedEvent.occurredOn)
    setSaveError(false)
    setDeleteError(false)
  }, [selectedEvent])

  async function saveSelected(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedEvent) return
    setSaving(true)
    setSaveError(false)
    try {
      await onSave(selectedEvent.id, stageDraft, dateDraft)
      setSelectedId(null)
    } catch {
      setSaveError(true)
    } finally {
      setSaving(false)
    }
  }

  async function deleteSelected() {
    if (!selectedEvent) return
    setDeleteError(false)
    try {
      await onDelete(selectedEvent.id)
      setSelectedId(null)
    } catch {
      setDeleteError(true)
    } finally {
      setDeleteTarget(false)
    }
  }

  async function retryDelete() {
    if (!selectedEvent) return
    setDeleteError(false)
    try {
      await onDelete(selectedEvent.id)
      setSelectedId(null)
    } catch {
      setDeleteError(true)
    }
  }

  return (
    <section aria-labelledby={headingId}>
      <h3
        id={headingId}
        className="text-sm font-semibold"
      >
        Stage history
      </h3>
      <div
        className="mt-4 max-w-full overflow-x-auto px-8 pb-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-zinc-100"
        tabIndex={0}
      >
        <ol
          aria-label={`Stage history for ${applicationTitle}`}
          className="relative flex min-w-max items-start"
        >
          <span
            aria-hidden="true"
            className="absolute top-[53px] right-[72px] left-[72px] h-1 bg-blue-600 dark:bg-blue-400"
          />
          {orderedEvents.map((timelineEvent) => {
            const formattedDate = formatDateOnly(timelineEvent.occurredOn)
            return (
              <li
                key={timelineEvent.id}
                className="relative grid min-w-36 justify-items-center text-center"
              >
                <time
                  dateTime={timelineEvent.occurredOn}
                  className="mb-3 text-xs text-zinc-600 dark:text-zinc-400"
                >
                  {formattedDate}
                </time>
                <button
                  type="button"
                  aria-label={`Edit ${timelineEvent.label} from ${formattedDate}`}
                  onClick={() => setSelectedId(timelineEvent.id)}
                  className="relative z-10 grid min-h-11 min-w-11 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-zinc-100"
                >
                  <span
                    aria-hidden="true"
                    className="h-5 w-5 rounded-full border-4 border-blue-600 bg-white dark:border-blue-400 dark:bg-zinc-900"
                  />
                </button>
                <span className="mt-2 max-w-32 text-xs font-semibold">
                  {timelineEvent.label}
                </span>
              </li>
            )
          })}
        </ol>
      </div>

      {orderedEvents.length === 1 ? (
        <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
          Every application needs one timeline event. Edit this event instead.
        </p>
      ) : null}

      {selectedEvent ? (
        <EventEditor
          selectedEvent={selectedEvent}
          stageDraft={stageDraft}
          dateDraft={dateDraft}
          saving={saving}
          saveError={saveError}
          deleteError={deleteError}
          finalEvent={orderedEvents.length === 1}
          onStageChange={setStageDraft}
          onDateChange={setDateDraft}
          onSave={saveSelected}
          onCancel={() => setSelectedId(null)}
          onRequestDelete={() => setDeleteTarget(true)}
          onRetryDelete={() => void retryDelete()}
        />
      ) : null}

      {deleteTarget && selectedEvent ? (
        <ConfirmDialog
          title="Delete timeline event?"
          message={`Delete ${selectedEvent.label} from ${formatDateOnly(selectedEvent.occurredOn)}? The current stage may change.`}
          confirmLabel="Delete event"
          cancelLabel="Keep event"
          pendingLabel="Deleting…"
          initialFocus="cancel"
          onCancel={() => setDeleteTarget(false)}
          onConfirm={deleteSelected}
        />
      ) : null}
    </section>
  )
}

interface EventEditorProps {
  selectedEvent: DecoratedTrackerStageEvent
  stageDraft: TrackerStage
  dateDraft: string
  saving: boolean
  saveError: boolean
  deleteError: boolean
  finalEvent: boolean
  onStageChange: (stage: TrackerStage) => void
  onDateChange: (date: string) => void
  onSave: (event: FormEvent<HTMLFormElement>) => void
  onCancel: () => void
  onRequestDelete: () => void
  onRetryDelete: () => void
}

function EventEditor({
  selectedEvent,
  stageDraft,
  dateDraft,
  saving,
  saveError,
  deleteError,
  finalEvent,
  onStageChange,
  onDateChange,
  onSave,
  onCancel,
  onRequestDelete,
  onRetryDelete,
}: EventEditorProps) {
  return (
    <form
      onSubmit={onSave}
      className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-950"
    >
      <h4 className="text-sm font-semibold">Edit {selectedEvent.label}</h4>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs font-medium">
          Stage
          <select
            value={stageDraft}
            onChange={(event) => onStageChange(event.target.value as TrackerStage)}
            className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            {TRACKER_STAGES.map((stage) => (
              <option key={stage.slug} value={stage.slug}>{stage.label}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium">
          Date
          <input
            type="date"
            value={dateDraft}
            onChange={(event) => onDateChange(event.target.value)}
            className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <button
          type="submit"
          disabled={saving}
          className="min-h-11 rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {saving ? 'Saving…' : 'Save event'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="min-h-11 rounded-md border border-zinc-300 px-4 py-2 text-sm font-semibold dark:border-zinc-700"
        >
          Cancel
        </button>
        {!finalEvent ? (
          <button
            type="button"
            onClick={onRequestDelete}
            disabled={saving}
            className="min-h-11 rounded-md px-3 py-2 text-sm font-semibold text-red-700 dark:text-red-400"
          >
            Delete event
          </button>
        ) : null}
      </div>
      {finalEvent ? (
        <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
          Every application needs one timeline event. Edit this event instead.
        </p>
      ) : null}
      {saveError ? (
        <p role="alert" className="mt-3 text-xs text-red-700 dark:text-red-400">
          Couldn’t save. Retry
        </p>
      ) : null}
      {deleteError ? (
        <div className="mt-3 text-xs text-red-700 dark:text-red-400">
          <p role="alert">
            Couldn’t delete this event. Refresh the timeline and retry.
          </p>
          <button
            type="button"
            aria-label="Retry deleting event"
            onClick={onRetryDelete}
            className="mt-1 min-h-11 font-semibold underline underline-offset-4"
          >
            Retry
          </button>
        </div>
      ) : null}
    </form>
  )
}

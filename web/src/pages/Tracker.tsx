import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router'
import DOMPurify from 'dompurify'
import { ApplicationTimeline } from '../components/ApplicationTimeline'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { listResumes, resumeLabel } from '../lib/resumes'
import {
  appendApplicationStage,
  createManualApplication,
  deleteApplicationStageEvent,
  deleteTrackerApplication,
  getTrackerApplication,
  listTrackerApplications,
  manualDuplicateWarning,
  notesPreview,
  setApplicationPin,
  setApplicationResume,
  sortTrackerEvents,
  TRACKER_ACTIVE_STAGES,
  TRACKER_STAGE_PRESENTATION,
  TRACKER_STAGES,
  TRACKER_TERMINAL_STAGES,
  updateApplicationStageEvent,
  updateApplicationTextField,
  validateManualApplicationDraft,
  type ManualApplicationCreateInput,
  type ManualApplicationValidation,
  type TrackerApplicationListItem,
  type TrackerEditableTextField,
  type TrackerStage,
} from '../lib/tracker'

const CELL_INPUT =
  'min-h-9 min-w-0 w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus-visible:outline-zinc-100'
const OUTLINE_BUTTON =
  'min-h-11 rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:cursor-wait disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:focus-visible:outline-zinc-100'
const PRIMARY_BUTTON =
  'min-h-11 rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:cursor-wait disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white dark:focus-visible:outline-zinc-100'

// These strings stay colocated with the table so the draft's aria-describedby
// contract cannot drift from the service validator:
// Enter a company. Enter a job title. Enter a job URL.
// Enter a valid HTTPS job URL. Possible duplicate:
const MANUAL_CREATE_ERROR =
  'Couldn’t add this position. Check your entries and retry.'
const TRACKER_APPLICATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const EMPTY_TRACKER_APPLICATIONS: readonly TrackerApplicationListItem[] = []

function localDate(): string {
  const now = new Date()
  const year = String(now.getFullYear()).padStart(4, '0')
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function sameStages(left: readonly TrackerStage[], right: readonly TrackerStage[]) {
  return left.length === right.length && left.every((stage) => right.includes(stage))
}

interface SaveFeedbackProps {
  pending: boolean
  saved: boolean
  failed: boolean
  onRetry: () => void
}

function SaveFeedback({
  pending,
  saved,
  failed,
  onRetry,
}: SaveFeedbackProps) {
  if (pending) {
    return (
      <span role="status" aria-live="polite" className="block text-xs text-zinc-500">
        Saving…
      </span>
    )
  }
  if (failed) {
    return (
      <span className="block text-xs text-red-700 dark:text-red-400">
        <span role="alert">Couldn’t save. </span>
        <button
          type="button"
          aria-label="Retry saving"
          onClick={onRetry}
          className="min-h-9 font-semibold underline underline-offset-4"
        >
          Retry
        </button>
      </span>
    )
  }
  if (saved) {
    return (
      <span role="status" aria-live="polite" className="block text-xs text-emerald-700 dark:text-emerald-400">
        ✓ Saved
      </span>
    )
  }
  return null
}

interface TrackerRowProps {
  application: TrackerApplicationListItem
  rowNumber: number
  expanded: boolean
  onToggleExpanded: () => void
  onRequestDelete: () => void
  registerExpandButton: (node: HTMLButtonElement | null) => void
}

function TrackerRow({
  application,
  rowNumber,
  expanded,
  onToggleExpanded,
  onRequestDelete,
  registerExpandButton,
}: TrackerRowProps) {
  const queryClient = useQueryClient()
  const presentation = TRACKER_STAGE_PRESENTATION[application.currentStage]
  const [pinDraft, setPinDraft] = useState(application.pinned)
  const [stageDraft, setStageDraft] = useState(application.currentStage)
  const [dateDraft, setDateDraft] = useState(application.currentStageDate)
  const [companyDraft, setCompanyDraft] = useState(application.company)
  const [titleDraft, setTitleDraft] = useState(application.title)
  const [notesDraft, setNotesDraft] = useState(application.notes)
  const [lastSave, setLastSave] = useState<
    'pin' | 'company' | 'title' | 'stage' | 'date' | 'notes' | null
  >(null)

  useEffect(() => setPinDraft(application.pinned), [application.pinned])
  useEffect(() => setStageDraft(application.currentStage), [application.currentStage])
  useEffect(() => setDateDraft(application.currentStageDate), [application.currentStageDate])
  useEffect(() => setCompanyDraft(application.company), [application.company])
  useEffect(() => setTitleDraft(application.title), [application.title])
  useEffect(() => setNotesDraft(application.notes), [application.notes])

  async function invalidateApplication(includeDashboard = false) {
    await queryClient.invalidateQueries({ queryKey: ['tracker-applications'] })
    await queryClient.invalidateQueries({
      queryKey: ['tracker-application', application.id],
    })
    if (includeDashboard) {
      await queryClient.invalidateQueries({
        queryKey: ['dashboard-applied-applications'],
      })
    }
  }

  const pinMutation = useMutation({
    mutationFn: (pinned: boolean) => setApplicationPin(application.id, pinned),
    scope: { id: `${application.id}:pin` },
    retry: false,
    onMutate: () => setLastSave('pin'),
    onSuccess: () => invalidateApplication(),
  })
  const stageMutation = useMutation({
    mutationFn: (stage: TrackerStage) => appendApplicationStage(application.id, stage),
    scope: { id: `${application.id}:stage` },
    retry: false,
    onMutate: () => setLastSave('stage'),
    onSuccess: () => invalidateApplication(true),
  })
  const dateMutation = useMutation({
    mutationFn: async (occurredOn: string) => {
      const detail = await queryClient.fetchQuery({
        queryKey: ['tracker-application', application.id],
        queryFn: () => getTrackerApplication(application.id),
      })
      const latestEvent = sortTrackerEvents(detail.events).at(-1)
      if (!latestEvent) throw new Error('application_event_not_found')
      await updateApplicationStageEvent(
        latestEvent.id,
        latestEvent.stage,
        occurredOn,
      )
    },
    scope: { id: `${application.id}:current_stage_date` },
    retry: false,
    onMutate: () => setLastSave('date'),
    onSuccess: () => invalidateApplication(true),
  })
  const companyMutation = useMutation({
    mutationFn: (value: string) => updateApplicationTextField(
      application.id,
      application.origin,
      'company',
      value,
    ),
    scope: { id: `${application.id}:company` },
    retry: false,
    onMutate: () => setLastSave('company'),
    onSuccess: () => invalidateApplication(true),
  })
  const titleMutation = useMutation({
    mutationFn: (value: string) => updateApplicationTextField(
      application.id,
      application.origin,
      'title',
      value,
    ),
    scope: { id: `${application.id}:title` },
    retry: false,
    onMutate: () => setLastSave('title'),
    onSuccess: () => invalidateApplication(true),
  })
  const notesMutation = useMutation({
    mutationFn: (value: string) => updateApplicationTextField(
      application.id,
      application.origin,
      'notes',
      value,
    ),
    scope: { id: `${application.id}:notes` },
    retry: false,
    onMutate: () => setLastSave('notes'),
    onSuccess: () => invalidateApplication(),
  })

  const lastSaveMutation = lastSave === 'pin'
    ? pinMutation
    : lastSave === 'company'
      ? companyMutation
      : lastSave === 'title'
        ? titleMutation
        : lastSave === 'stage'
          ? stageMutation
          : lastSave === 'date'
            ? dateMutation
            : lastSave === 'notes'
              ? notesMutation
              : null

  function retryLastSave() {
    if (lastSave === 'pin' && pinMutation.variables !== undefined) {
      pinMutation.mutate(pinMutation.variables)
    } else if (lastSave === 'company' && companyMutation.variables !== undefined) {
      companyMutation.mutate(companyMutation.variables)
    } else if (lastSave === 'title' && titleMutation.variables !== undefined) {
      titleMutation.mutate(titleMutation.variables)
    } else if (lastSave === 'stage' && stageMutation.variables !== undefined) {
      stageMutation.mutate(stageMutation.variables)
    } else if (lastSave === 'date' && dateMutation.variables !== undefined) {
      dateMutation.mutate(dateMutation.variables)
    } else if (lastSave === 'notes' && notesMutation.variables !== undefined) {
      notesMutation.mutate(notesMutation.variables)
    }
  }

  function commitOnEnter(
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    commit: () => void,
    reset: () => void,
  ) {
    if (event.key === 'Escape') {
      event.preventDefault()
      reset()
    } else if (
      event.key === 'Enter'
      && (
        event.currentTarget instanceof HTMLInputElement
        || event.ctrlKey
        || event.metaKey
      )
    ) {
      event.preventDefault()
      commit()
    }
  }

  const detailId = `tracker-detail-${application.id}`

  return (
    <>
      <tr
        className={`min-h-9 border-l-4 ${presentation.accentClass} ${presentation.tintClass} hover:bg-zinc-50 focus-within:bg-zinc-50 dark:hover:bg-zinc-800/50 dark:focus-within:bg-zinc-800/50`}
      >
        <td className="px-1 py-1 text-center text-lg font-bold text-zinc-600 dark:text-zinc-300">
          {rowNumber}
        </td>
        <td className="px-1 py-1 text-center">
          <button
            ref={registerExpandButton}
            type="button"
            aria-expanded={expanded}
            aria-controls={detailId}
            aria-label={`${expanded ? 'Hide' : 'Show'} details for ${application.title}`}
            onClick={onToggleExpanded}
            className="min-h-9 min-w-9 rounded-md text-2xl leading-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900 dark:focus-visible:outline-zinc-100"
          >
            <span aria-hidden="true">{expanded ? '⌄' : '›'}</span>
          </button>
        </td>
        <td className="px-1 py-1 text-center">
          <button
            type="button"
            aria-pressed={pinDraft}
            aria-label={`${pinDraft ? 'Unpin' : 'Pin'} ${application.title}`}
            disabled={pinMutation.isPending}
            onClick={() => {
              const next = !pinDraft
              setPinDraft(next)
              pinMutation.mutate(next)
            }}
            className="min-h-9 min-w-9 rounded-md text-3xl leading-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900 disabled:opacity-60 dark:focus-visible:outline-zinc-100"
          >
            <span aria-hidden="true">{pinDraft ? '★' : '☆'}</span>
          </button>
        </td>
        <td className="min-w-0 break-words px-2 py-1">
          {application.origin === 'manual' ? (
            <>
              <label className="sr-only" htmlFor={`company-${application.id}`}>
                Company
              </label>
              <input
                id={`company-${application.id}`}
                value={companyDraft}
                onChange={(event) => setCompanyDraft(event.target.value)}
                onBlur={() => {
                  if (companyDraft !== application.company) companyMutation.mutate(companyDraft)
                }}
                onKeyDown={(event) => commitOnEnter(
                  event,
                  () => companyMutation.mutate(companyDraft),
                  () => setCompanyDraft(application.company),
                )}
                className={CELL_INPUT}
              />
            </>
          ) : (
            application.company
          )}
        </td>
        <td className="min-w-0 break-words px-2 py-1">
          <div className="flex min-w-0 items-center gap-1.5">
            {application.resumeId ? (
              <span
                aria-label={`Resume linked: ${application.resumeLabel ?? 'linked resume'}`}
                title={`Resume linked: ${application.resumeLabel ?? 'linked resume'}`}
                className="text-base"
              >
                <span aria-hidden="true">▤</span>
              </span>
            ) : null}
            {application.origin === 'manual' ? (
              <div className="min-w-0 flex-1">
                <label className="sr-only" htmlFor={`title-${application.id}`}>
                  Position
                </label>
                <input
                  id={`title-${application.id}`}
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  onBlur={() => {
                    if (titleDraft !== application.title) titleMutation.mutate(titleDraft)
                  }}
                  onKeyDown={(event) => commitOnEnter(
                    event,
                    () => titleMutation.mutate(titleDraft),
                    () => setTitleDraft(application.title),
                  )}
                  className={CELL_INPUT}
                />
              </div>
            ) : application.applyUrl ? (
              <a
                href={application.applyUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={`${application.title}, new tab`}
                className="break-words font-semibold underline decoration-1 underline-offset-4"
              >
                {application.title} <span aria-hidden="true">↗</span>
              </a>
            ) : (
              <span className="font-semibold">{application.title}</span>
            )}
          </div>
        </td>
        <td className="min-w-0 px-2 py-1">
          <label className="sr-only" htmlFor={`stage-${application.id}`}>Stage</label>
          <select
            id={`stage-${application.id}`}
            value={stageDraft}
            disabled={stageMutation.isPending}
            onChange={(event) => {
              const next = event.target.value as TrackerStage
              setStageDraft(next)
              stageMutation.mutate(next)
            }}
            className={`min-h-9 w-full rounded-full border px-2 py-1 text-xs font-semibold ${TRACKER_STAGE_PRESENTATION[stageDraft].badgeClass}`}
          >
            {TRACKER_STAGES.map((stage) => (
              <option key={stage.slug} value={stage.slug}>{stage.label}</option>
            ))}
          </select>
        </td>
        <td className="min-w-0 px-2 py-1">
          <label className="sr-only" htmlFor={`date-${application.id}`}>Stage date</label>
          <input
            id={`date-${application.id}`}
            type="date"
            max={localDate()}
            value={dateDraft}
            onChange={(event) => setDateDraft(event.target.value)}
            onBlur={() => {
              if (dateDraft !== application.currentStageDate) dateMutation.mutate(dateDraft)
            }}
            onKeyDown={(event) => commitOnEnter(
              event,
              () => dateMutation.mutate(dateDraft),
              () => setDateDraft(application.currentStageDate),
            )}
            className={CELL_INPUT}
          />
        </td>
        <td className="min-w-0 px-2 py-1">
          <label className="sr-only" htmlFor={`notes-${application.id}`}>Notes</label>
          <textarea
            id={`notes-${application.id}`}
            rows={1}
            value={notesDraft}
            onChange={(event) => setNotesDraft(event.target.value)}
            onBlur={() => {
              if (notesDraft !== application.notes) notesMutation.mutate(notesDraft)
            }}
            onKeyDown={(event) => commitOnEnter(
              event,
              () => notesMutation.mutate(notesDraft),
              () => setNotesDraft(application.notes),
            )}
            className={`${CELL_INPUT} resize-none`}
          />
          <span className="sr-only">{notesPreview(notesDraft)}</span>
        </td>
        <td className="min-w-0 px-2 py-1 text-right">
          <div className="flex items-center justify-end gap-1.5">
            {lastSaveMutation ? (
              <SaveFeedback
                pending={lastSaveMutation.isPending}
                saved={lastSaveMutation.isSuccess}
                failed={lastSaveMutation.isError}
                onRetry={retryLastSave}
              />
            ) : (
              <span className="text-xs text-zinc-500">—</span>
            )}
            <button
              type="button"
              onClick={onRequestDelete}
              className="min-h-9 rounded-md px-2 text-xs font-semibold text-red-700 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-red-700 dark:text-red-400"
            >
              Delete
            </button>
          </div>
        </td>
      </tr>
      {expanded ? (
        <TrackerDetailRow
          application={application}
          expanded={expanded}
          detailId={detailId}
        />
      ) : null}
    </>
  )
}

interface TrackerDetailRowProps {
  application: TrackerApplicationListItem
  expanded: boolean
  detailId: string
}

function TrackerDetailRow({
  application,
  expanded,
  detailId,
}: TrackerDetailRowProps) {
  const queryClient = useQueryClient()
  const detailQuery = useQuery({
    queryKey: ['tracker-application', application.id],
    queryFn: () => getTrackerApplication(application.id),
    enabled: expanded,
  })
  const resumesQuery = useQuery({
    queryKey: ['resumes'],
    queryFn: listResumes,
    enabled: expanded,
  })

  async function invalidateDetail(includeDashboard = false) {
    await queryClient.invalidateQueries({
      queryKey: ['tracker-application', application.id],
    })
    await queryClient.invalidateQueries({ queryKey: ['tracker-applications'] })
    if (includeDashboard) {
      await queryClient.invalidateQueries({
        queryKey: ['dashboard-applied-applications'],
      })
    }
  }

  const eventUpdateMutation = useMutation({
    mutationFn: ({
      eventId,
      stage,
      occurredOn,
    }: {
      eventId: string
      stage: TrackerStage
      occurredOn: string
    }) => updateApplicationStageEvent(eventId, stage, occurredOn),
    scope: { id: `${application.id}:timeline` },
    retry: false,
    onSuccess: () => invalidateDetail(true),
  })
  const eventDeleteMutation = useMutation({
    mutationFn: deleteApplicationStageEvent,
    scope: { id: `${application.id}:timeline-delete` },
    retry: false,
    onSuccess: () => invalidateDetail(true),
  })
  const resumeMutation = useMutation({
    mutationFn: (resumeId: string | null) => setApplicationResume(
      application.id,
      resumeId,
    ),
    scope: { id: `${application.id}:resume` },
    retry: false,
    onSuccess: () => invalidateDetail(),
  })
  const detailNotesMutation = useMutation({
    mutationFn: (value: string) => updateApplicationTextField(
      application.id,
      application.origin,
      'notes',
      value,
    ),
    scope: { id: `${application.id}:notes` },
    retry: false,
    onSuccess: () => invalidateDetail(),
  })
  const detailTextMutation = useMutation({
    mutationFn: ({
      field,
      value,
    }: {
      field: TrackerEditableTextField
      value: string
    }) => updateApplicationTextField(
      application.id,
      application.origin,
      field,
      value,
    ),
    scope: { id: `${application.id}:details` },
    retry: false,
    onSuccess: () => invalidateDetail(true),
  })

  const detail = detailQuery.data
  const [detailNotes, setDetailNotes] = useState(application.notes)
  const [locationDraft, setLocationDraft] = useState(application.location ?? '')
  const [urlDraft, setUrlDraft] = useState(application.applyUrl ?? '')
  const [descriptionDraft, setDescriptionDraft] = useState('')

  useEffect(() => {
    if (!detail) return
    setDetailNotes(detail.notes)
    setLocationDraft(detail.location ?? '')
    setUrlDraft(detail.applyUrl ?? '')
    setDescriptionDraft(detail.descriptionText ?? '')
  }, [detail])

  const sanitizedDescription = useMemo(() => (
    detail?.origin === 'system' && detail.descriptionHtml
      ? DOMPurify.sanitize(detail.descriptionHtml, { FORBID_TAGS: ['style', 'form'] })
      : null
  ), [detail])

  return (
    <tr id={detailId}>
      <td colSpan={9} className="bg-white p-8 dark:bg-zinc-900">
        {detailQuery.isPending ? (
          <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">
            Loading details…
          </p>
        ) : detailQuery.error || !detail ? (
          <div>
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              Couldn’t load this application’s details. Retry without leaving the table.
            </p>
            <button
              type="button"
              onClick={() => void detailQuery.refetch()}
              className={`mt-3 ${OUTLINE_BUTTON}`}
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            <ApplicationTimeline
              applicationTitle={detail.title}
              events={detail.events}
              onSave={(eventId, stage, occurredOn) => (
                eventUpdateMutation.mutateAsync({ eventId, stage, occurredOn })
              )}
              onDelete={(eventId) => eventDeleteMutation.mutateAsync(eventId)}
            />

            <div className="mt-8 grid gap-8 min-[900px]:grid-cols-2">
              <section>
                <h3 className="text-sm font-semibold">Notes</h3>
                <label className="sr-only" htmlFor={`detail-notes-${application.id}`}>
                  Full application notes
                </label>
                <textarea
                  id={`detail-notes-${application.id}`}
                  rows={7}
                  value={detailNotes}
                  onChange={(event) => setDetailNotes(event.target.value)}
                  onBlur={() => {
                    if (detailNotes !== detail.notes) {
                      detailNotesMutation.mutate(detailNotes)
                    }
                  }}
                  className={`mt-3 min-h-40 resize-y ${CELL_INPUT}`}
                />
                <SaveFeedback
                  pending={detailNotesMutation.isPending}
                  saved={detailNotesMutation.isSuccess}
                  failed={detailNotesMutation.isError}
                  onRetry={() => {
                    if (detailNotesMutation.variables !== undefined) {
                      detailNotesMutation.mutate(detailNotesMutation.variables)
                    }
                  }}
                />
              </section>

              <section>
                <h3 className="text-sm font-semibold">Position details</h3>
                {application.origin === 'manual' ? (
                  <div className="mt-3 grid gap-3">
                    <label className="grid gap-1 text-xs font-medium">
                      Location (optional)
                      <input
                        value={locationDraft}
                        onChange={(event) => setLocationDraft(event.target.value)}
                        onBlur={() => {
                          if (locationDraft !== (detail.location ?? '')) {
                            detailTextMutation.mutate({
                              field: 'location',
                              value: locationDraft,
                            })
                          }
                        }}
                        className={CELL_INPUT}
                      />
                    </label>
                    <label className="grid gap-1 text-xs font-medium">
                      Job URL
                      <input
                        type="url"
                        value={urlDraft}
                        onChange={(event) => setUrlDraft(event.target.value)}
                        onBlur={() => {
                          if (urlDraft !== (detail.applyUrl ?? '')) {
                            detailTextMutation.mutate({
                              field: 'apply_url',
                              value: urlDraft,
                            })
                          }
                        }}
                        className={CELL_INPUT}
                      />
                    </label>
                    <label className="grid gap-1 text-xs font-medium">
                      Job description (optional)
                      <textarea
                        rows={7}
                        value={descriptionDraft}
                        onChange={(event) => setDescriptionDraft(event.target.value)}
                        onBlur={() => {
                          if (descriptionDraft !== (detail.descriptionText ?? '')) {
                            detailTextMutation.mutate({
                              field: 'description_text',
                              value: descriptionDraft,
                            })
                          }
                        }}
                        className={`min-h-40 resize-y whitespace-pre-wrap ${CELL_INPUT}`}
                      />
                    </label>
                  </div>
                ) : (
                  <dl className="mt-3 grid gap-2 text-sm">
                    <div>
                      <dt className="font-medium">Company</dt>
                      <dd className="text-zinc-600 dark:text-zinc-400">{detail.company}</dd>
                    </div>
                    <div>
                      <dt className="font-medium">Location</dt>
                      <dd className="text-zinc-600 dark:text-zinc-400">
                        {detail.location ?? '—'}
                      </dd>
                    </div>
                  </dl>
                )}
              </section>

              <section className="min-[900px]:col-span-2">
                <h3 className="text-sm font-semibold">Job description</h3>
                {sanitizedDescription !== null ? (
                  <div
                    className="mt-3 max-w-none text-sm [&_a]:underline [&_li]:my-1 [&_ul]:list-disc [&_ul]:pl-5"
                    dangerouslySetInnerHTML={{ __html: sanitizedDescription }}
                  />
                ) : detail.descriptionText ? (
                  <pre className="mt-3 font-sans whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
                    {detail.descriptionText}
                  </pre>
                ) : (
                  <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                    No job description was saved for this position.
                  </p>
                )}
              </section>

              <section className="min-[900px]:col-span-2">
                <h3 className="text-sm font-semibold">Resume</h3>
                <label
                  className="mt-3 grid max-w-md gap-1 text-xs font-medium"
                  htmlFor={`resume-${application.id}`}
                >
                  Linked resume (optional)
                  <select
                    id={`resume-${application.id}`}
                    value={detail.resume?.id ?? ''}
                    disabled={resumeMutation.isPending || resumesQuery.isPending}
                    onChange={(event) => {
                      resumeMutation.mutate(event.target.value || null)
                    }}
                    className={CELL_INPUT}
                  >
                    <option value="">No linked resume</option>
                    {(resumesQuery.data ?? []).map((resume) => (
                      <option key={resume.id} value={resume.id}>{resumeLabel(resume)}</option>
                    ))}
                  </select>
                </label>
                {detail.resume ? (
                  <Link
                    to="/resumes"
                    className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4"
                  >
                    Open resume
                  </Link>
                ) : null}
                <SaveFeedback
                  pending={resumeMutation.isPending}
                  saved={resumeMutation.isSuccess}
                  failed={resumeMutation.isError}
                  onRetry={() => {
                    if (resumeMutation.variables !== undefined) {
                      resumeMutation.mutate(resumeMutation.variables)
                    }
                  }}
                />
              </section>
            </div>
          </>
        )}
      </td>
    </tr>
  )
}

interface ManualDraftRowProps {
  applications: readonly TrackerApplicationListItem[]
  onDiscard: () => void
  onCreated: (message: string) => void
}

function ManualDraftRow({
  applications,
  onDiscard,
  onCreated,
}: ManualDraftRowProps) {
  const queryClient = useQueryClient()
  const companyInput = useRef<HTMLInputElement>(null)
  const titleInput = useRef<HTMLInputElement>(null)
  const urlInput = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<ManualApplicationCreateInput>({
    company: '',
    title: '',
    applyUrl: '',
    notes: '',
    stage: 'ready_to_apply',
  })
  const [errors, setErrors] = useState<ManualApplicationValidation>({})
  const duplicateWarning = manualDuplicateWarning(draft, applications)

  useEffect(() => companyInput.current?.focus(), [])

  const createMutation = useMutation({
    mutationFn: createManualApplication,
    retry: false,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['tracker-applications'] })
      onCreated(result.duplicateWarning && duplicateWarning
        ? `${duplicateWarning} Position added.`
        : 'Position added.')
    },
  })

  function updateDraft<Key extends keyof ManualApplicationCreateInput>(
    key: Key,
    value: ManualApplicationCreateInput[Key],
  ) {
    setDraft((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [
      key === 'applyUrl' ? 'applyUrl' : key
    ]: undefined }))
  }

  function submitDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextErrors = validateManualApplicationDraft(draft)
    setErrors(nextErrors)
    if (nextErrors.company) {
      companyInput.current?.focus()
      return
    }
    if (nextErrors.title) {
      titleInput.current?.focus()
      return
    }
    if (nextErrors.applyUrl) {
      urlInput.current?.focus()
      return
    }
    createMutation.mutate({
      company: draft.company,
      title: draft.title,
      applyUrl: draft.applyUrl,
      notes: draft.notes,
      stage: draft.stage,
    })
  }

  return (
    <tr className="border-l-4 border-l-zinc-300 bg-zinc-50/40 align-top dark:border-l-zinc-600 dark:bg-zinc-950/20">
      <td className="px-1 py-3 text-center text-base font-bold text-zinc-600 dark:text-zinc-300">
        New
      </td>
      <td className="px-1 py-3" />
      <td className="px-1 py-3" />
      <td className="px-2 py-3">
        <label className="grid gap-1 text-xs font-medium" htmlFor="draft-company">
          Company
          <input
            ref={companyInput}
            id="draft-company"
            value={draft.company}
            aria-invalid={Boolean(errors.company)}
            aria-describedby={errors.company ? 'draft-company-error' : undefined}
            onChange={(event) => updateDraft('company', event.target.value)}
            className={CELL_INPUT}
          />
        </label>
        {errors.company ? (
          <p id="draft-company-error" role="alert" className="mt-1 text-xs text-red-700 dark:text-red-400">
            {errors.company}
          </p>
        ) : null}
      </td>
      <td className="px-2 py-3">
        <label className="grid gap-1 text-xs font-medium" htmlFor="draft-title">
          Job title
          <input
            ref={titleInput}
            id="draft-title"
            value={draft.title}
            aria-invalid={Boolean(errors.title)}
            aria-describedby={errors.title ? 'draft-title-error' : undefined}
            onChange={(event) => updateDraft('title', event.target.value)}
            className={CELL_INPUT}
          />
        </label>
        {errors.title ? (
          <p id="draft-title-error" role="alert" className="mt-1 text-xs text-red-700 dark:text-red-400">
            {errors.title}
          </p>
        ) : null}
        <label className="mt-2 grid gap-1 text-xs font-medium" htmlFor="draft-url">
          Job URL
          <input
            ref={urlInput}
            id="draft-url"
            type="url"
            value={draft.applyUrl}
            aria-invalid={Boolean(errors.applyUrl)}
            aria-describedby={errors.applyUrl ? 'draft-url-error' : undefined}
            onChange={(event) => updateDraft('applyUrl', event.target.value)}
            className={CELL_INPUT}
          />
        </label>
        {errors.applyUrl ? (
          <p id="draft-url-error" role="alert" className="mt-1 text-xs text-red-700 dark:text-red-400">
            {errors.applyUrl}
          </p>
        ) : null}
      </td>
      <td className="px-2 py-3">
        <label className="sr-only" htmlFor="draft-stage">Stage</label>
        <select
          id="draft-stage"
          value={draft.stage}
          onChange={(event) => updateDraft('stage', event.target.value as TrackerStage)}
          className={`min-h-11 w-full rounded-full border px-2 py-1 text-xs font-semibold ${TRACKER_STAGE_PRESENTATION[draft.stage].badgeClass}`}
        >
          {TRACKER_STAGES.map((stage) => (
            <option key={stage.slug} value={stage.slug}>{stage.label}</option>
          ))}
        </select>
      </td>
      <td className="px-2 py-3">
        <label className="sr-only" htmlFor="draft-date">Stage date</label>
        <input
          id="draft-date"
          type="date"
          value={localDate()}
          readOnly
          className={CELL_INPUT}
        />
      </td>
      <td className="px-2 py-3">
        <label className="sr-only" htmlFor="draft-notes">Notes</label>
        <textarea
          id="draft-notes"
          rows={3}
          value={draft.notes}
          onChange={(event) => updateDraft('notes', event.target.value)}
          className={`${CELL_INPUT} resize-none`}
        />
        {duplicateWarning ? (
          <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {duplicateWarning}
          </p>
        ) : null}
        {createMutation.error ? (
          <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-400">
            {MANUAL_CREATE_ERROR}
          </p>
        ) : null}
      </td>
      <td className="px-2 py-3">
        <form onSubmit={submitDraft} className="grid gap-2">
          <button type="submit" disabled={createMutation.isPending} className={PRIMARY_BUTTON}>
            {createMutation.isPending ? 'Adding…' : 'Add position'}
          </button>
          <button type="button" onClick={onDiscard} className={OUTLINE_BUTTON}>
            Discard draft
          </button>
        </form>
      </td>
    </tr>
  )
}

export function Tracker() {
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const requestedApplicationId = searchParams.get('application')
  const focusApplicationId = requestedApplicationId
    && TRACKER_APPLICATION_ID_PATTERN.test(requestedApplicationId)
    ? requestedApplicationId.toLowerCase()
    : null
  const [selectedStages, setSelectedStages] = useState<TrackerStage[]>([
    ...TRACKER_ACTIVE_STAGES,
  ])
  const [draftVisible, setDraftVisible] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [deleteCandidate, setDeleteCandidate] =
    useState<TrackerApplicationListItem | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const expandButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const preparedFocusId = useRef<string | null>(null)
  const completedFocusId = useRef<string | null>(null)

  const applicationsQuery = useQuery({
    queryKey: ['tracker-applications', selectedStages],
    queryFn: () => listTrackerApplications(selectedStages),
  })
  const applications = applicationsQuery.data ?? EMPTY_TRACKER_APPLICATIONS
  const focusApplicationsQuery = useQuery({
    queryKey: ['tracker-focus-applications'],
    queryFn: () => listTrackerApplications(TRACKER_STAGES.map(({ slug }) => slug)),
    enabled: focusApplicationId !== null && !applicationsQuery.isPending,
  })
  const deleteMutation = useMutation({
    mutationFn: deleteTrackerApplication,
    retry: false,
    onSuccess: async (_result, applicationId) => {
      const deleted = deleteCandidate
      setExpandedIds((current) => {
        const next = new Set(current)
        next.delete(applicationId)
        return next
      })
      expandButtonRefs.current.delete(applicationId)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tracker-applications'] }),
        queryClient.invalidateQueries({
          queryKey: ['tracker-application', applicationId],
        }),
        queryClient.invalidateQueries({
          queryKey: ['dashboard-applied-applications'],
        }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-feed'] }),
      ])
      setAnnouncement(`${deleted?.title ?? 'Application'} deleted from Tracker.`)
      setDeleteCandidate(null)
    },
  })

  useEffect(() => {
    if (
      focusApplicationId === null
      || focusApplicationsQuery.isPending
      || focusApplicationsQuery.error
      || preparedFocusId.current === focusApplicationId
    ) return
    const ownedApplication = focusApplicationsQuery.data?.find(
      (application) => application.id === focusApplicationId,
    )
    preparedFocusId.current = focusApplicationId
    if (!ownedApplication) return
    setSelectedStages(TRACKER_STAGES.map(({ slug }) => slug))
    setExpandedIds((current) => new Set(current).add(focusApplicationId))
  }, [
    focusApplicationId,
    focusApplicationsQuery.data,
    focusApplicationsQuery.error,
    focusApplicationsQuery.isPending,
  ])

  useEffect(() => {
    if (
      focusApplicationId === null
      || completedFocusId.current === focusApplicationId
      || !applications.some((application) => application.id === focusApplicationId)
      || !expandedIds.has(focusApplicationId)
    ) return
    const expandButton = expandButtonRefs.current.get(focusApplicationId)
    if (!expandButton) return
    completedFocusId.current = focusApplicationId
    queueMicrotask(() => {
      expandButton.scrollIntoView({ block: 'center', inline: 'nearest' })
      expandButton.focus()
    })
  }, [applications, expandedIds, focusApplicationId])

  const defaultSelection = sameStages(selectedStages, TRACKER_ACTIVE_STAGES)
  const stageGroupValue = sameStages(selectedStages, TRACKER_ACTIVE_STAGES)
    ? 'active'
    : sameStages(selectedStages, TRACKER_TERMINAL_STAGES)
      ? 'terminal'
      : selectedStages.length === TRACKER_STAGES.length
        ? 'all'
        : 'custom'
  const individualStageValue = selectedStages.length === 1 ? selectedStages[0] : ''

  return (
    <section>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Tracker</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Track applications, update stages, and keep every follow-up in one place.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDraftVisible(true)}
          className={PRIMARY_BUTTON}
        >
          Add position
        </button>
      </header>

      <div className="mt-6 flex flex-wrap items-end gap-3" aria-label="Stage filters">
        <label className="grid gap-1 text-sm font-semibold" htmlFor="stage-group-filter">
          Stage group
          <select
            id="stage-group-filter"
            value={stageGroupValue}
            onChange={(event) => {
              const next = event.target.value
              if (next === 'active') setSelectedStages([...TRACKER_ACTIVE_STAGES])
              else if (next === 'terminal') setSelectedStages([...TRACKER_TERMINAL_STAGES])
              else if (next === 'all') {
                setSelectedStages(TRACKER_STAGES.map(({ slug }) => slug))
              }
            }}
            className={`${CELL_INPUT} min-w-44`}
          >
            <option value="active">Active stages</option>
            <option value="terminal">Terminal stages</option>
            <option value="all">All stages</option>
            {stageGroupValue === 'custom' ? (
              <option value="custom">Individual stage</option>
            ) : null}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold" htmlFor="individual-stage-filter">
          Stage
          <select
            id="individual-stage-filter"
            value={individualStageValue}
            onChange={(event) => {
              const next = event.target.value as TrackerStage | ''
              if (next) setSelectedStages([next])
            }}
            className={`${CELL_INPUT} min-w-48`}
          >
            <option value="">Choose a stage</option>
            {TRACKER_STAGES.map((stage) => (
              <option key={stage.slug} value={stage.slug}>{stage.label}</option>
            ))}
          </select>
        </label>
      </div>

      <p role="status" aria-live="polite" className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">
        {announcement}
      </p>

      <div
        role="region"
        aria-label="Applications"
        tabIndex={0}
        className="mt-4 overflow-hidden rounded-lg border border-zinc-200 bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:focus-visible:outline-zinc-100"
      >
        {applicationsQuery.isPending ? (
          <p role="status" className="p-4 text-sm text-zinc-600 dark:text-zinc-400">
            Loading applications…
          </p>
        ) : applicationsQuery.error ? (
          <div className="p-4">
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              Couldn’t load your applications. Check your connection and retry.
            </p>
            <button
              type="button"
              aria-label="Retry loading applications"
              onClick={() => void applicationsQuery.refetch()}
              className={`mt-3 ${OUTLINE_BUTTON}`}
            >
              Retry
            </button>
          </div>
        ) : applications.length > 0 || draftVisible ? (
          <table className="w-full table-fixed border-collapse text-left text-xs">
            <colgroup>
              <col style={{ width: '3%' }} />
              <col style={{ width: '3%' }} />
              <col style={{ width: '4%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '19%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '19%' }} />
              <col style={{ width: '10%' }} />
            </colgroup>
            <thead className="sticky top-0 z-20 border-b border-zinc-200 bg-zinc-50 text-xs font-semibold tracking-wide text-zinc-600 uppercase dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
              <tr>
                <th scope="col" className="px-1 py-2 text-center text-base">#</th>
                <th scope="col" aria-label="Expand" className="px-1 py-2" />
                <th scope="col" aria-label="Pin" className="px-1 py-2" />
                <th scope="col" className="px-2 py-2">Company</th>
                <th scope="col" className="px-2 py-2">Position</th>
                <th scope="col" className="px-2 py-2">Stage</th>
                <th scope="col" className="px-2 py-2">Stage date</th>
                <th scope="col" className="px-2 py-2">Notes</th>
                <th scope="col" className="px-2 py-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {draftVisible ? (
                <ManualDraftRow
                  applications={applications}
                  onDiscard={() => setDraftVisible(false)}
                  onCreated={(message) => {
                    setDraftVisible(false)
                    setAnnouncement(message)
                  }}
                />
              ) : null}
              {applications.map((application, index) => (
                <TrackerRow
                  key={application.id}
                  application={application}
                  rowNumber={index + 1}
                  expanded={expandedIds.has(application.id)}
                  onToggleExpanded={() => {
                    setExpandedIds((current) => {
                      const next = new Set(current)
                      if (next.has(application.id)) next.delete(application.id)
                      else next.add(application.id)
                      return next
                    })
                  }}
                  onRequestDelete={() => {
                    deleteMutation.reset()
                    setDeleteCandidate(application)
                  }}
                  registerExpandButton={(node) => {
                    if (node) expandButtonRefs.current.set(application.id, node)
                    else expandButtonRefs.current.delete(application.id)
                  }}
                />
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-8">
            <h2 className="text-base font-semibold">
              {defaultSelection ? 'No applications yet' : 'No applications match these stages'}
            </h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {defaultSelection
                ? 'Add a position here, or mark a Dashboard job applied to start tracking.'
                : 'Choose more stages or select Active stages.'}
            </p>
            {defaultSelection ? (
              <button
                type="button"
                onClick={() => setDraftVisible(true)}
                className={`mt-4 ${PRIMARY_BUTTON}`}
              >
                Add position
              </button>
            ) : null}
          </div>
        )}
      </div>
      {deleteCandidate ? (
        <ConfirmDialog
          title="Delete application?"
          message={
            deleteCandidate.origin === 'system'
              ? `Delete ${deleteCandidate.title} at ${deleteCandidate.company} and its timeline? The job stays marked applied and will not return to Active.`
              : `Delete ${deleteCandidate.title} at ${deleteCandidate.company} and its timeline? This cannot be undone.`
          }
          confirmLabel="Delete application"
          cancelLabel="Keep application"
          pendingLabel="Deleting…"
          initialFocus="cancel"
          errorMessage={deleteMutation.isError
            ? 'Couldn’t delete this application. Check your connection and retry.'
            : undefined}
          onConfirm={() => deleteMutation.mutateAsync(deleteCandidate.id)}
          onCancel={() => {
            deleteMutation.reset()
            setDeleteCandidate(null)
          }}
        />
      ) : null}
    </section>
  )
}

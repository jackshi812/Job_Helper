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
import { listResumes, resumeLabel } from '../lib/resumes'
import {
  appendApplicationStage,
  createManualApplication,
  deleteApplicationStageEvent,
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

const FILTER_BUTTON =
  'min-h-11 rounded-full border px-3 py-2 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-zinc-100'
const CELL_INPUT =
  'min-h-11 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus-visible:outline-zinc-100'
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

function updatedLabel(value: string): string {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(parsed)
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
      <span role="status" aria-live="polite" className="mt-1 block text-xs text-zinc-500">
        Saving…
      </span>
    )
  }
  if (failed) {
    return (
      <span className="mt-1 block text-xs text-red-700 dark:text-red-400">
        <span role="alert">Couldn’t save. </span>
        <button
          type="button"
          aria-label="Retry saving"
          onClick={onRetry}
          className="min-h-11 font-semibold underline underline-offset-4"
        >
          Retry
        </button>
      </span>
    )
  }
  if (saved) {
    return (
      <span role="status" aria-live="polite" className="mt-1 block text-xs text-emerald-700 dark:text-emerald-400">
        ✓ Saved
      </span>
    )
  }
  return null
}

interface TrackerRowProps {
  application: TrackerApplicationListItem
  expanded: boolean
  onToggleExpanded: () => void
  registerExpandButton: (node: HTMLButtonElement | null) => void
}

function TrackerRow({
  application,
  expanded,
  onToggleExpanded,
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
    onSuccess: () => invalidateApplication(),
  })
  const stageMutation = useMutation({
    mutationFn: (stage: TrackerStage) => appendApplicationStage(application.id, stage),
    scope: { id: `${application.id}:stage` },
    retry: false,
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
    onSuccess: () => invalidateApplication(),
  })

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
        className={`min-h-11 border-l-4 ${presentation.accentClass} ${presentation.tintClass} hover:bg-zinc-50 focus-within:bg-zinc-50 dark:hover:bg-zinc-800/50 dark:focus-within:bg-zinc-800/50`}
      >
        <td className="w-12 px-1 py-2 text-center">
          <button
            ref={registerExpandButton}
            type="button"
            aria-expanded={expanded}
            aria-controls={detailId}
            aria-label={`${expanded ? 'Hide' : 'Show'} details for ${application.title}`}
            onClick={onToggleExpanded}
            className="min-h-11 min-w-11 rounded-md text-lg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900 dark:focus-visible:outline-zinc-100"
          >
            <span aria-hidden="true">{expanded ? '⌄' : '›'}</span>
          </button>
        </td>
        <td className="w-12 px-1 py-2 text-center">
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
            className="min-h-11 min-w-11 rounded-md text-lg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900 disabled:opacity-60 dark:focus-visible:outline-zinc-100"
          >
            <span aria-hidden="true">{pinDraft ? '★' : '☆'}</span>
          </button>
          <SaveFeedback
            pending={pinMutation.isPending}
            saved={pinMutation.isSuccess}
            failed={pinMutation.isError}
            onRetry={() => {
              if (pinMutation.variables !== undefined) {
                pinMutation.mutate(pinMutation.variables)
              }
            }}
          />
        </td>
        <td className="w-44 px-2 py-2">
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
              <SaveFeedback
                pending={companyMutation.isPending}
                saved={companyMutation.isSuccess}
                failed={companyMutation.isError}
                onRetry={() => {
                  if (companyMutation.variables !== undefined) {
                    companyMutation.mutate(companyMutation.variables)
                  }
                }}
              />
            </>
          ) : (
            application.company
          )}
        </td>
        <td className="w-62 px-2 py-2">
          <div className="flex items-center gap-1.5">
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
                <SaveFeedback
                  pending={titleMutation.isPending}
                  saved={titleMutation.isSuccess}
                  failed={titleMutation.isError}
                  onRetry={() => {
                    if (titleMutation.variables !== undefined) {
                      titleMutation.mutate(titleMutation.variables)
                    }
                  }}
                />
              </div>
            ) : application.applyUrl ? (
              <a
                href={application.applyUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={`${application.title}, new tab`}
                className="font-semibold underline decoration-1 underline-offset-4"
              >
                {application.title} <span aria-hidden="true">↗</span>
              </a>
            ) : (
              <span className="font-semibold">{application.title}</span>
            )}
          </div>
        </td>
        <td className="w-42 px-2 py-2">
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
            className={`min-h-11 w-full rounded-full border px-2 py-1 text-xs font-semibold ${TRACKER_STAGE_PRESENTATION[stageDraft].badgeClass}`}
          >
            {TRACKER_STAGES.map((stage) => (
              <option key={stage.slug} value={stage.slug}>{stage.label}</option>
            ))}
          </select>
          <SaveFeedback
            pending={stageMutation.isPending}
            saved={stageMutation.isSuccess}
            failed={stageMutation.isError}
            onRetry={() => {
              if (stageMutation.variables !== undefined) {
                stageMutation.mutate(stageMutation.variables)
              }
            }}
          />
        </td>
        <td className="w-34 px-2 py-2">
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
          <SaveFeedback
            pending={dateMutation.isPending}
            saved={dateMutation.isSuccess}
            failed={dateMutation.isError}
            onRetry={() => {
              if (dateMutation.variables !== undefined) {
                dateMutation.mutate(dateMutation.variables)
              }
            }}
          />
        </td>
        <td className="w-72 px-2 py-2">
          <label className="sr-only" htmlFor={`notes-${application.id}`}>Notes</label>
          <textarea
            id={`notes-${application.id}`}
            rows={2}
            value={notesDraft}
            placeholder="Add contacts, follow-ups, interview details, or next steps."
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
          <SaveFeedback
            pending={notesMutation.isPending}
            saved={notesMutation.isSuccess}
            failed={notesMutation.isError}
            onRetry={() => {
              if (notesMutation.variables !== undefined) {
                notesMutation.mutate(notesMutation.variables)
              }
            }}
          />
        </td>
        <td className="w-28 px-2 py-2 text-xs text-zinc-600 dark:text-zinc-400">
          <time dateTime={application.updatedAt} title={new Date(application.updatedAt).toLocaleString()}>
            {updatedLabel(application.updatedAt)}
          </time>
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
      <td colSpan={8} className="bg-white p-8 dark:bg-zinc-900">
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
                  placeholder="Add contacts, follow-ups, interview details, or next steps."
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
          placeholder="Add contacts, follow-ups, interview details, or next steps."
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

  function toggleStage(stage: TrackerStage) {
    if (selectedStages.includes(stage) && selectedStages.length === 1) {
      setSelectedStages([])
      return
    }
    setSelectedStages((current) => (
      current.includes(stage)
        ? current.filter((candidate) => candidate !== stage)
        : TRACKER_STAGES
          .map(({ slug }) => slug)
          .filter((candidate) => candidate === stage || current.includes(candidate))
    ))
  }

  const defaultSelection = sameStages(selectedStages, TRACKER_ACTIVE_STAGES)

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

      <div
        role="group"
        aria-label="Stage filters"
        className="mt-6 flex flex-wrap items-center gap-2"
      >
        <span className="mr-1 text-sm font-semibold">Stage filters</span>
        <button
          type="button"
          aria-pressed={sameStages(selectedStages, TRACKER_ACTIVE_STAGES)}
          onClick={() => setSelectedStages([...TRACKER_ACTIVE_STAGES])}
          className={`${FILTER_BUTTON} ${sameStages(selectedStages, TRACKER_ACTIVE_STAGES) ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900' : 'border-zinc-300 dark:border-zinc-700'}`}
        >
          Active stages
        </button>
        <button
          type="button"
          aria-pressed={sameStages(selectedStages, TRACKER_TERMINAL_STAGES)}
          onClick={() => setSelectedStages([...TRACKER_TERMINAL_STAGES])}
          className={`${FILTER_BUTTON} ${sameStages(selectedStages, TRACKER_TERMINAL_STAGES) ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900' : 'border-zinc-300 dark:border-zinc-700'}`}
        >
          Terminal stages
        </button>
        <button
          type="button"
          aria-pressed={selectedStages.length === TRACKER_STAGES.length}
          onClick={() => setSelectedStages(TRACKER_STAGES.map(({ slug }) => slug))}
          className={`${FILTER_BUTTON} ${selectedStages.length === TRACKER_STAGES.length ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900' : 'border-zinc-300 dark:border-zinc-700'}`}
        >
          All stages
        </button>
        {TRACKER_STAGES.map((stage) => (
          <button
            key={stage.slug}
            type="button"
            aria-pressed={selectedStages.includes(stage.slug)}
            onClick={() => toggleStage(stage.slug)}
            className={`${FILTER_BUTTON} ${selectedStages.includes(stage.slug) ? TRACKER_STAGE_PRESENTATION[stage.slug].badgeClass : 'border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400'}`}
          >
            {stage.label}
          </button>
        ))}
      </div>

      <p className="mt-4 text-xs text-zinc-600 sm:hidden dark:text-zinc-400">
        Swipe horizontally to view and edit all columns.
      </p>
      <p role="status" aria-live="polite" className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">
        {announcement}
      </p>

      <div
        role="region"
        aria-label="Applications; scroll horizontally to view all columns"
        tabIndex={0}
        className="mt-4 overflow-x-auto rounded-lg border border-zinc-200 bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:focus-visible:outline-zinc-100"
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
          <table className="w-full min-w-[1224px] table-fixed border-collapse text-left text-sm">
            <colgroup>
              <col className="w-12" />
              <col className="w-12" />
              <col className="w-44" />
              <col className="w-62" />
              <col className="w-42" />
              <col className="w-34" />
              <col className="w-72" />
              <col className="w-28" />
            </colgroup>
            <thead className="sticky top-0 z-20 border-b border-zinc-200 bg-zinc-50 text-xs font-semibold tracking-wide text-zinc-600 uppercase dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
              <tr>
                <th scope="col" aria-label="Expand" className="px-1 py-2" />
                <th scope="col" aria-label="Pin" className="px-1 py-2" />
                <th scope="col" className="px-2 py-2">Company</th>
                <th scope="col" className="px-2 py-2">Position</th>
                <th scope="col" className="px-2 py-2">Stage</th>
                <th scope="col" className="px-2 py-2">Stage date</th>
                <th scope="col" className="px-2 py-2">Notes</th>
                <th scope="col" className="px-2 py-2">Updated</th>
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
              {applications.map((application) => (
                <TrackerRow
                  key={application.id}
                  application={application}
                  expanded={expandedIds.has(application.id)}
                  onToggleExpanded={() => {
                    setExpandedIds((current) => {
                      const next = new Set(current)
                      if (next.has(application.id)) next.delete(application.id)
                      else next.add(application.id)
                      return next
                    })
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
    </section>
  )
}

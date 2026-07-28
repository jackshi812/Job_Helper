import { safeApplyUrl } from './feed'
import { supabase } from './supabase'

export type TrackerStage =
  | 'ready_to_apply'
  | 'applied'
  | 'outreach_sent'
  | 'interview'
  | 'offer'
  | 'rejected'

export type TrackerOrigin = 'system' | 'manual'

export const TRACKER_STAGES: readonly {
  slug: TrackerStage
  label: string
}[] = [
  { slug: 'ready_to_apply', label: 'Ready to Apply' },
  { slug: 'applied', label: 'Applied' },
  { slug: 'outreach_sent', label: 'Outreach Sent' },
  { slug: 'interview', label: 'Interview' },
  { slug: 'offer', label: 'Offer' },
  { slug: 'rejected', label: 'Rejected' },
]

export const TRACKER_LIST_COLUMNS =
  'id, origin, company, title, location, apply_url, notes, pinned, resume_id, ' +
  'current_stage, current_stage_date, updated_at'

export const TRACKER_DETAIL_COLUMNS =
  `${TRACKER_LIST_COLUMNS}, description_html, description_text, snapshot_partial, ` +
  'created_at, resumes ( id, filename, display_name ), ' +
  'application_stage_events ( id, application_id, stage, occurred_on, created_at )'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u
const STAGE_SET = new Set<TrackerStage>(TRACKER_STAGES.map(({ slug }) => slug))

export interface TrackerStageEvent {
  id: string
  applicationId: string
  stage: TrackerStage
  occurredOn: string
  createdAt: string
}

export interface TrackerApplicationListItem {
  id: string
  origin: TrackerOrigin
  company: string
  title: string
  location: string | null
  applyUrl: string | null
  notes: string
  pinned: boolean
  resumeId: string | null
  currentStage: TrackerStage
  currentStageDate: string
  updatedAt: string
}

export interface TrackerApplicationDetail extends TrackerApplicationListItem {
  descriptionHtml: string | null
  descriptionText: string | null
  snapshotPartial: boolean
  createdAt: string
  resume: {
    id: string
    filename: string
    displayName: string | null
  } | null
  events: TrackerStageEvent[]
}

export interface DashboardAppliedApplication {
  applicationId: string
  company: string
  title: string
  location: string | null
  applyUrl: string | null
  appliedOn: string
  currentStage: TrackerStage
  currentStageDate: string
}

export interface ManualApplicationCreateInput {
  company: string
  title: string
  applyUrl: string
  notes: string
  stage: TrackerStage
}

export interface ManualApplicationCreateResult {
  applicationId: string
  duplicateWarning: boolean
}

export type TrackerEditableTextField =
  | 'company'
  | 'title'
  | 'apply_url'
  | 'location'
  | 'description_text'
  | 'notes'

function record(value: unknown, errorCode: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(errorCode)
  }
  return value as Record<string, unknown>
}

function uuid(value: unknown, errorCode: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new Error(errorCode)
  return value
}

function nonblank(value: unknown, errorCode: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(errorCode)
  return value
}

function nullableText(value: unknown, errorCode: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string') throw new Error(errorCode)
  return value
}

function timestamp(value: unknown, errorCode: string): string {
  if (
    typeof value !== 'string'
    || !/(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
    || !Number.isFinite(new Date(value).getTime())
  ) {
    throw new Error(errorCode)
  }
  return value
}

function dateOnly(value: unknown, errorCode: string): string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) throw new Error(errorCode)
  const parsed = new Date(`${value}T00:00:00Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(errorCode)
  }
  return value
}

function stage(value: unknown, errorCode: string): TrackerStage {
  if (typeof value !== 'string' || !STAGE_SET.has(value as TrackerStage)) {
    throw new Error(errorCode)
  }
  return value as TrackerStage
}

function origin(value: unknown, errorCode: string): TrackerOrigin {
  if (value !== 'system' && value !== 'manual') throw new Error(errorCode)
  return value
}

function currentDate(): string {
  return new Date().toISOString().slice(0, 10)
}

export function parseTrackerApplicationListItem(
  value: unknown,
): TrackerApplicationListItem {
  const row = record(value, 'invalid_tracker_application')
  if (
    typeof row.notes !== 'string'
    || typeof row.pinned !== 'boolean'
    || (row.resume_id !== null && !UUID_PATTERN.test(String(row.resume_id)))
  ) {
    throw new Error('invalid_tracker_application')
  }
  const rawApplyUrl = nullableText(row.apply_url, 'invalid_tracker_application')
  const parsedApplyUrl = rawApplyUrl === null ? null : safeApplyUrl(rawApplyUrl)
  if (rawApplyUrl !== null && parsedApplyUrl === null) {
    throw new Error('invalid_tracker_application')
  }
  return {
    id: uuid(row.id, 'invalid_tracker_application'),
    origin: origin(row.origin, 'invalid_tracker_application'),
    company: nonblank(row.company, 'invalid_tracker_application'),
    title: nonblank(row.title, 'invalid_tracker_application'),
    location: nullableText(row.location, 'invalid_tracker_application'),
    applyUrl: parsedApplyUrl,
    notes: row.notes,
    pinned: row.pinned,
    resumeId: row.resume_id as string | null,
    currentStage: stage(row.current_stage, 'invalid_tracker_application'),
    currentStageDate: dateOnly(row.current_stage_date, 'invalid_tracker_application'),
    updatedAt: timestamp(row.updated_at, 'invalid_tracker_application'),
  }
}

function parseStageEvent(value: unknown): TrackerStageEvent {
  const row = record(value, 'invalid_tracker_stage_event')
  return {
    id: uuid(row.id, 'invalid_tracker_stage_event'),
    applicationId: uuid(row.application_id, 'invalid_tracker_stage_event'),
    stage: stage(row.stage, 'invalid_tracker_stage_event'),
    occurredOn: dateOnly(row.occurred_on, 'invalid_tracker_stage_event'),
    createdAt: timestamp(row.created_at, 'invalid_tracker_stage_event'),
  }
}

export function parseTrackerApplicationDetail(
  value: unknown,
): TrackerApplicationDetail {
  const row = record(value, 'invalid_tracker_application_detail')
  const base = parseTrackerApplicationListItem(row)
  if (
    typeof row.snapshot_partial !== 'boolean'
    || !Array.isArray(row.application_stage_events)
  ) {
    throw new Error('invalid_tracker_application_detail')
  }
  let resume: TrackerApplicationDetail['resume'] = null
  if (row.resumes !== null) {
    const linked = record(row.resumes, 'invalid_tracker_application_detail')
    resume = {
      id: uuid(linked.id, 'invalid_tracker_application_detail'),
      filename: nonblank(linked.filename, 'invalid_tracker_application_detail'),
      displayName: nullableText(
        linked.display_name,
        'invalid_tracker_application_detail',
      ),
    }
  }
  const events = row.application_stage_events.map(parseStageEvent).sort((left, right) => (
    left.occurredOn.localeCompare(right.occurredOn)
    || left.createdAt.localeCompare(right.createdAt)
    || left.id.localeCompare(right.id)
  ))
  if (events.length < 1 || events.some(({ applicationId }) => applicationId !== base.id)) {
    throw new Error('invalid_tracker_application_detail')
  }
  return {
    ...base,
    descriptionHtml: nullableText(
      row.description_html,
      'invalid_tracker_application_detail',
    ),
    descriptionText: nullableText(
      row.description_text,
      'invalid_tracker_application_detail',
    ),
    snapshotPartial: row.snapshot_partial,
    createdAt: timestamp(row.created_at, 'invalid_tracker_application_detail'),
    resume,
    events,
  }
}

export function parseDashboardAppliedApplication(
  value: unknown,
): DashboardAppliedApplication {
  const row = record(value, 'invalid_dashboard_applied_application')
  const expectedKeys = [
    'application_id',
    'applied_on',
    'apply_url',
    'company',
    'current_stage',
    'current_stage_date',
    'location',
    'title',
  ]
  if (JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(expectedKeys)) {
    throw new Error('invalid_dashboard_applied_application')
  }
  const rawApplyUrl = nullableText(row.apply_url, 'invalid_dashboard_applied_application')
  const parsedApplyUrl = rawApplyUrl === null ? null : safeApplyUrl(rawApplyUrl)
  if (rawApplyUrl !== null && parsedApplyUrl === null) {
    throw new Error('invalid_dashboard_applied_application')
  }
  return {
    applicationId: uuid(row.application_id, 'invalid_dashboard_applied_application'),
    company: nonblank(row.company, 'invalid_dashboard_applied_application'),
    title: nonblank(row.title, 'invalid_dashboard_applied_application'),
    location: nullableText(row.location, 'invalid_dashboard_applied_application'),
    applyUrl: parsedApplyUrl,
    appliedOn: dateOnly(row.applied_on, 'invalid_dashboard_applied_application'),
    currentStage: stage(row.current_stage, 'invalid_dashboard_applied_application'),
    currentStageDate: dateOnly(
      row.current_stage_date,
      'invalid_dashboard_applied_application',
    ),
  }
}

export function parseManualApplicationCreateResult(
  value: unknown,
): ManualApplicationCreateResult {
  const row = record(value, 'invalid_manual_application_result')
  if (
    JSON.stringify(Object.keys(row).sort())
      !== JSON.stringify(['application_id', 'duplicate_warning'])
    || typeof row.duplicate_warning !== 'boolean'
  ) {
    throw new Error('invalid_manual_application_result')
  }
  return {
    applicationId: uuid(row.application_id, 'invalid_manual_application_result'),
    duplicateWarning: row.duplicate_warning,
  }
}

export async function listTrackerApplications(): Promise<TrackerApplicationListItem[]> {
  const { data, error } = await supabase
    .from('applications')
    .select(TRACKER_LIST_COLUMNS)
    .order('pinned', { ascending: false })
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false })
  if (error) throw error
  return (data ?? []).map(parseTrackerApplicationListItem)
}

export async function getTrackerApplication(
  applicationId: string,
): Promise<TrackerApplicationDetail> {
  const { data, error } = await supabase
    .from('applications')
    .select(TRACKER_DETAIL_COLUMNS)
    .eq('id', applicationId)
    .order('occurred_on', {
      referencedTable: 'application_stage_events',
      ascending: true,
    })
    .order('created_at', {
      referencedTable: 'application_stage_events',
      ascending: true,
    })
    .order('id', {
      referencedTable: 'application_stage_events',
      ascending: true,
    })
    .single()
  if (error) throw error
  return parseTrackerApplicationDetail(data)
}

export async function listDashboardAppliedApplications():
Promise<DashboardAppliedApplication[]> {
  const { data, error } = await supabase.rpc('dashboard_applied_applications')
  if (error) throw error
  if (!Array.isArray(data)) throw new Error('invalid_dashboard_applied_application')
  return data.map(parseDashboardAppliedApplication)
}

export async function createManualApplication(
  input: ManualApplicationCreateInput,
): Promise<ManualApplicationCreateResult> {
  const { data, error } = await supabase.rpc('create_manual_application', {
    p_company: input.company,
    p_title: input.title,
    p_apply_url: input.applyUrl,
    p_notes: input.notes,
    p_stage: input.stage,
    p_occurred_on: currentDate(),
  })
  if (error) throw error
  if (!Array.isArray(data) || data.length !== 1) {
    throw new Error('invalid_manual_application_result')
  }
  return parseManualApplicationCreateResult(data[0])
}

async function requireTrueRpc(
  name: string,
  args: Record<string, unknown>,
): Promise<void> {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw error
  if (data !== true) throw new Error('invalid_tracker_mutation_result')
}

export async function setApplicationPin(
  applicationId: string,
  pinned: boolean,
): Promise<void> {
  await requireTrueRpc('set_application_pin', {
    p_application_id: applicationId,
    p_pinned: pinned,
  })
}

export async function updateApplicationTextField(
  applicationId: string,
  field: TrackerEditableTextField,
  value: string,
): Promise<void> {
  await requireTrueRpc('update_application_text_field', {
    p_application_id: applicationId,
    p_field: field,
    p_value: value,
  })
}

export async function setApplicationResume(
  applicationId: string,
  resumeId: string | null,
): Promise<void> {
  await requireTrueRpc('set_application_resume', {
    p_application_id: applicationId,
    p_resume_id: resumeId,
  })
}

export async function appendApplicationStage(
  applicationId: string,
  nextStage: TrackerStage,
): Promise<string> {
  const { data, error } = await supabase.rpc('append_application_stage', {
    p_application_id: applicationId,
    p_stage: nextStage,
    p_occurred_on: currentDate(),
  })
  if (error) throw error
  return uuid(data, 'invalid_tracker_stage_event_id')
}

export async function updateApplicationStageEvent(
  eventId: string,
  nextStage: TrackerStage,
  occurredOn: string,
): Promise<void> {
  await requireTrueRpc('update_application_stage_event', {
    p_event_id: eventId,
    p_stage: nextStage,
    p_occurred_on: occurredOn,
  })
}

export async function deleteApplicationStageEvent(eventId: string): Promise<void> {
  await requireTrueRpc('delete_application_stage_event', { p_event_id: eventId })
}

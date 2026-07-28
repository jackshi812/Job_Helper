import { beforeEach, describe, expect, it, vi } from 'vitest'
import { supabase } from './supabase'
import {
  appendApplicationStage,
  createManualApplication,
  decorateRepeatedStageOrdinals,
  deleteApplicationStageEvent,
  getTrackerApplication,
  listTrackerApplications,
  manualDuplicateWarning,
  normalizeManualDuplicateKey,
  notesPreview,
  parseDateOnly,
  setApplicationPin,
  setApplicationResume,
  sortTrackerApplications,
  sortTrackerEvents,
  TRACKER_ACTIVE_STAGES,
  TRACKER_STAGE_PRESENTATION,
  TRACKER_STAGES,
  TRACKER_TERMINAL_STAGES,
  updateApplicationStageEvent,
  updateApplicationTextField,
  validateManualApplicationDraft,
  type TrackerApplicationListItem,
  type TrackerStageEvent,
} from './tracker'

vi.mock('./supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}))

const APP_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_APP_ID = '22222222-2222-4222-8222-222222222222'
const EVENT_ID = '33333333-3333-4333-8333-333333333333'
const RESUME_ID = '44444444-4444-4444-8444-444444444444'

function application(
  overrides: Partial<TrackerApplicationListItem> = {},
): TrackerApplicationListItem {
  return {
    id: APP_ID,
    origin: 'manual',
    company: 'Acme',
    title: 'Data Analyst',
    location: null,
    applyUrl: 'https://example.com/jobs/1',
    notes: '',
    pinned: false,
    resumeId: null,
    currentStage: 'ready_to_apply',
    currentStageDate: '2026-07-28',
    updatedAt: '2026-07-28T12:00:00.000Z',
    ...overrides,
  }
}

function event(overrides: Partial<TrackerStageEvent> = {}): TrackerStageEvent {
  return {
    id: EVENT_ID,
    applicationId: APP_ID,
    stage: 'applied',
    occurredOn: '2026-07-28',
    createdAt: '2026-07-28T12:00:00.000Z',
    ...overrides,
  }
}

describe('tracker lifecycle presentation', () => {
  it('defines exactly the approved six stages and filter groups', () => {
    expect(TRACKER_STAGES).toEqual([
      { slug: 'ready_to_apply', label: 'Ready to Apply' },
      { slug: 'applied', label: 'Applied' },
      { slug: 'outreach_sent', label: 'Outreach Sent' },
      { slug: 'interview', label: 'Interview' },
      { slug: 'offer', label: 'Offer' },
      { slug: 'rejected', label: 'Rejected' },
    ])
    expect(TRACKER_ACTIVE_STAGES).toEqual([
      'ready_to_apply',
      'applied',
      'outreach_sent',
      'interview',
    ])
    expect(TRACKER_TERMINAL_STAGES).toEqual(['offer', 'rejected'])
    expect(Object.keys(TRACKER_STAGE_PRESENTATION)).toEqual(
      TRACKER_STAGES.map(({ slug }) => slug),
    )
  })

  it('locks each written badge, 4px accent, and subtle row tint treatment', () => {
    expect(TRACKER_STAGE_PRESENTATION).toEqual({
      ready_to_apply: {
        label: 'Ready to Apply',
        badgeClass:
          'border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300',
        accentClass: 'border-l-zinc-300 dark:border-l-zinc-600',
        tintClass: 'bg-zinc-50/40 dark:bg-zinc-950/20',
      },
      applied: {
        label: 'Applied',
        badgeClass:
          'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300',
        accentClass: 'border-l-blue-400 dark:border-l-blue-700',
        tintClass: 'bg-blue-50/35 dark:bg-blue-950/15',
      },
      outreach_sent: {
        label: 'Outreach Sent',
        badgeClass:
          'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-900 dark:bg-cyan-950 dark:text-cyan-300',
        accentClass: 'border-l-cyan-400 dark:border-l-cyan-700',
        tintClass: 'bg-cyan-50/35 dark:bg-cyan-950/15',
      },
      interview: {
        label: 'Interview',
        badgeClass:
          'border-lime-200 bg-lime-50 text-lime-800 dark:border-lime-900 dark:bg-lime-950 dark:text-lime-300',
        accentClass: 'border-l-lime-400 dark:border-l-lime-700',
        tintClass: 'bg-lime-50/40 dark:bg-lime-950/15',
      },
      offer: {
        label: 'Offer',
        badgeClass:
          'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
        accentClass: 'border-l-emerald-400 dark:border-l-emerald-700',
        tintClass: 'bg-emerald-50/40 dark:bg-emerald-950/15',
      },
      rejected: {
        label: 'Rejected',
        badgeClass:
          'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300',
        accentClass: 'border-l-red-400 dark:border-l-red-700',
        tintClass: 'bg-red-50/35 dark:bg-red-950/15',
      },
    })
  })
})

describe('tracker pure helpers', () => {
  it('sorts pinned first, then updated descending, then stable ID descending', () => {
    const rows = [
      application({ id: APP_ID, updatedAt: '2026-07-28T12:00:00.000Z' }),
      application({
        id: OTHER_APP_ID,
        updatedAt: '2026-07-28T13:00:00.000Z',
      }),
      application({
        id: '55555555-5555-4555-8555-555555555555',
        pinned: true,
        updatedAt: '2026-07-20T12:00:00.000Z',
      }),
      application({
        id: '66666666-6666-4666-8666-666666666666',
        updatedAt: '2026-07-28T13:00:00.000Z',
      }),
    ]

    expect(sortTrackerApplications(rows).map(({ id }) => id)).toEqual([
      '55555555-5555-4555-8555-555555555555',
      '66666666-6666-4666-8666-666666666666',
      OTHER_APP_ID,
      APP_ID,
    ])
    expect(rows[0].id).toBe(APP_ID)
  })

  it('sorts events chronologically with created time and ID tie-breakers', () => {
    const events = [
      event({ id: '66666666-6666-4666-8666-666666666666' }),
      event({
        id: '55555555-5555-4555-8555-555555555555',
        occurredOn: '2026-07-27',
      }),
      event({
        id: '44444444-4444-4444-8444-444444444444',
        createdAt: '2026-07-28T11:00:00.000Z',
      }),
    ]

    expect(sortTrackerEvents(events).map(({ id }) => id)).toEqual([
      '55555555-5555-4555-8555-555555555555',
      '44444444-4444-4444-8444-444444444444',
      '66666666-6666-4666-8666-666666666666',
    ])
  })

  it('adds ordinals only when a stage repeats, after chronological sorting', () => {
    const decorated = decorateRepeatedStageOrdinals([
      event({ id: EVENT_ID, stage: 'interview', occurredOn: '2026-07-30' }),
      event({
        id: '44444444-4444-4444-8444-444444444444',
        stage: 'applied',
        occurredOn: '2026-07-27',
      }),
      event({
        id: '55555555-5555-4555-8555-555555555555',
        stage: 'interview',
        occurredOn: '2026-07-29',
      }),
    ])

    expect(decorated.map(({ label }) => label)).toEqual([
      'Applied',
      'Interview 1',
      'Interview 2',
    ])
  })

  it('validates real calendar dates without accepting timestamps or rollover', () => {
    expect(parseDateOnly('2026-02-28')).toBe('2026-02-28')
    expect(parseDateOnly('2026-02-29')).toBeNull()
    expect(parseDateOnly('2024-02-29')).toBe('2024-02-29')
    expect(parseDateOnly('2026-7-28')).toBeNull()
    expect(parseDateOnly('2026-07-28T00:00:00Z')).toBeNull()
    expect(parseDateOnly(null)).toBeNull()
  })

  it('limits notes previews to two lines and 120 characters with one ellipsis', () => {
    expect(notesPreview('First line\nSecond line\nThird line')).toBe(
      'First line\nSecond line…',
    )
    expect(notesPreview('x'.repeat(120))).toBe('x'.repeat(120))
    expect(notesPreview('x'.repeat(121))).toBe(`${'x'.repeat(120)}…`)
    expect(notesPreview('')).toBe('')
  })

  it('normalizes duplicate identity by trimming, folding case, and collapsing spaces', () => {
    expect(normalizeManualDuplicateKey('  ACME   Corp ', ' Data\t Analyst  ')).toBe(
      'acme corp\u0000data analyst',
    )
    expect(normalizeManualDuplicateKey('Acme Corp', 'Data Analyst')).toBe(
      'acme corp\u0000data analyst',
    )
  })

  it('returns exact required-field and safe HTTPS validation messages', () => {
    expect(validateManualApplicationDraft({
      company: ' ',
      title: '',
      applyUrl: '',
      notes: '',
      stage: 'ready_to_apply',
    })).toEqual({
      company: 'Enter a company.',
      title: 'Enter a job title.',
      applyUrl: 'Enter a job URL.',
    })
    expect(validateManualApplicationDraft({
      company: 'Acme',
      title: 'Analyst',
      applyUrl: 'http://example.com/job',
      notes: '',
      stage: 'ready_to_apply',
    })).toEqual({ applyUrl: 'Enter a valid HTTPS job URL.' })
    expect(validateManualApplicationDraft({
      company: 'Acme',
      title: 'Analyst',
      applyUrl: 'https://user:secret@example.com/job',
      notes: '',
      stage: 'ready_to_apply',
    })).toEqual({ applyUrl: 'Enter a valid HTTPS job URL.' })
    expect(validateManualApplicationDraft({
      company: ' Acme ',
      title: ' Analyst ',
      applyUrl: 'https://example.com/job',
      notes: '',
      stage: 'interview',
    })).toEqual({})
  })

  it('returns a nonblocking duplicate warning with the draft display values', () => {
    const existing = [
      application({ company: 'ACME  Corp', title: 'Data Analyst' }),
    ]
    expect(manualDuplicateWarning({
      company: ' Acme Corp ',
      title: ' Data  Analyst ',
      applyUrl: 'https://example.com/other',
      notes: '',
      stage: 'ready_to_apply',
    }, existing)).toBe(
      'Possible duplicate: Acme Corp — Data  Analyst. You can add it anyway.',
    )
    expect(manualDuplicateWarning({
      company: 'Acme Corp',
      title: 'Engineer',
      applyUrl: 'https://example.com/other',
      notes: '',
      stage: 'ready_to_apply',
    }, existing)).toBeNull()
  })
})

describe('tracker Supabase contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('filters list rows by the exact selected stages and keeps bodies out of the list', async () => {
    const rows = [{
      id: APP_ID,
      origin: 'manual',
      company: 'Acme',
      title: 'Analyst',
      location: null,
      apply_url: 'https://example.com/job',
      notes: '',
      pinned: false,
      resume_id: null,
      current_stage: 'applied',
      current_stage_date: '2026-07-28',
      updated_at: '2026-07-28T12:00:00.000Z',
    }]
    const finalOrder = vi.fn().mockResolvedValue({ data: rows, error: null })
    const secondOrder = vi.fn().mockReturnValue({ order: finalOrder })
    const firstOrder = vi.fn().mockReturnValue({ order: secondOrder })
    const inStages = vi.fn().mockReturnValue({ order: firstOrder })
    const select = vi.fn().mockReturnValue({ in: inStages })
    vi.mocked(supabase.from).mockReturnValue({ select } as never)

    await expect(listTrackerApplications(['applied', 'interview'])).resolves.toEqual([
      application({
        currentStage: 'applied',
        applyUrl: 'https://example.com/job',
      }),
    ])
    expect(supabase.from).toHaveBeenCalledWith('applications')
    expect(select).toHaveBeenCalledWith(expect.not.stringContaining('description_'))
    expect(select).toHaveBeenCalledWith(expect.not.stringContaining('application_stage_events'))
    expect(inStages).toHaveBeenCalledWith('current_stage', ['applied', 'interview'])
    expect(firstOrder).toHaveBeenCalledWith('pinned', { ascending: false })
    expect(secondOrder).toHaveBeenCalledWith('updated_at', { ascending: false })
    expect(finalOrder).toHaveBeenCalledWith('id', { ascending: false })
  })

  it('returns no list rows and performs no query when zero stages are selected', async () => {
    await expect(listTrackerApplications([])).resolves.toEqual([])
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('loads snapshots, resume label, and ordered events only for one expanded ID', async () => {
    const detail = {
      id: APP_ID,
      origin: 'system',
      company: 'Acme',
      title: 'Analyst',
      location: 'Chicago, IL',
      apply_url: 'https://example.com/job',
      notes: 'Follow up',
      pinned: false,
      resume_id: RESUME_ID,
      current_stage: 'interview',
      current_stage_date: '2026-07-28',
      updated_at: '2026-07-28T12:00:00.000Z',
      description_html: '<p>Saved</p>',
      description_text: null,
      snapshot_partial: false,
      created_at: '2026-07-27T12:00:00.000Z',
      resumes: { id: RESUME_ID, filename: 'resume.docx', display_name: 'Primary' },
      application_stage_events: [
        {
          id: EVENT_ID,
          application_id: APP_ID,
          stage: 'interview',
          occurred_on: '2026-07-28',
          created_at: '2026-07-28T12:00:00.000Z',
        },
      ],
    }
    const single = vi.fn().mockResolvedValue({ data: detail, error: null })
    const thirdOrder = vi.fn().mockReturnValue({ single })
    const secondOrder = vi.fn().mockReturnValue({ order: thirdOrder })
    const firstOrder = vi.fn().mockReturnValue({ order: secondOrder })
    const eq = vi.fn().mockReturnValue({ order: firstOrder })
    const select = vi.fn().mockReturnValue({ eq })
    vi.mocked(supabase.from).mockReturnValue({ select } as never)

    await expect(getTrackerApplication(APP_ID)).resolves.toMatchObject({
      id: APP_ID,
      descriptionHtml: '<p>Saved</p>',
      resume: { id: RESUME_ID, displayName: 'Primary' },
      events: [{ id: EVENT_ID }],
    })
    expect(eq).toHaveBeenCalledWith('id', APP_ID)
    expect(firstOrder).toHaveBeenCalledWith('occurred_on', {
      referencedTable: 'application_stage_events',
      ascending: true,
    })
  })

  it('creates a manual application with exactly six server inputs and strict output', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-28T18:00:00.000Z'))
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: [{ application_id: APP_ID, duplicate_warning: true }],
      error: null,
    } as never)

    await expect(createManualApplication({
      company: 'Acme',
      title: 'Analyst',
      applyUrl: 'https://example.com/job',
      notes: 'Follow up',
      stage: 'interview',
    })).resolves.toEqual({ applicationId: APP_ID, duplicateWarning: true })
    expect(supabase.rpc).toHaveBeenCalledWith('create_manual_application', {
      p_company: 'Acme',
      p_title: 'Analyst',
      p_apply_url: 'https://example.com/job',
      p_notes: 'Follow up',
      p_stage: 'interview',
      p_occurred_on: '2026-07-28',
    })
    vi.useRealTimers()
  })

  it.each([
    [],
    [{ application_id: APP_ID, duplicate_warning: false }, {
      application_id: OTHER_APP_ID,
      duplicate_warning: false,
    }],
    [{ application_id: APP_ID, duplicate_warning: false, location: 'Chicago' }],
    [{ application_id: 'not-a-uuid', duplicate_warning: false }],
    [{ application_id: APP_ID, duplicate_warning: 'false' }],
  ])('rejects malformed manual-create result %#', async (data) => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data, error: null } as never)
    await expect(createManualApplication({
      company: 'Acme',
      title: 'Analyst',
      applyUrl: 'https://example.com/job',
      notes: '',
      stage: 'ready_to_apply',
    })).rejects.toThrow('invalid_manual_application_result')
  })

  it('uses exact field-specific mutation payloads and guards results', async () => {
    vi.mocked(supabase.rpc)
      .mockResolvedValueOnce({ data: true, error: null } as never)
      .mockResolvedValueOnce({ data: true, error: null } as never)
      .mockResolvedValueOnce({ data: true, error: null } as never)
      .mockResolvedValueOnce({ data: EVENT_ID, error: null } as never)
      .mockResolvedValueOnce({ data: true, error: null } as never)
      .mockResolvedValueOnce({ data: true, error: null } as never)

    await setApplicationPin(APP_ID, true)
    await updateApplicationTextField(APP_ID, 'system', 'notes', 'Follow up')
    await setApplicationResume(APP_ID, RESUME_ID)
    await appendApplicationStage(APP_ID, 'interview')
    await updateApplicationStageEvent(EVENT_ID, 'interview', '2026-07-28')
    await deleteApplicationStageEvent(EVENT_ID)

    expect(supabase.rpc).toHaveBeenNthCalledWith(1, 'set_application_pin', {
      p_application_id: APP_ID,
      p_pinned: true,
    })
    expect(supabase.rpc).toHaveBeenNthCalledWith(2, 'update_application_text_field', {
      p_application_id: APP_ID,
      p_field: 'notes',
      p_value: 'Follow up',
    })
    expect(supabase.rpc).toHaveBeenNthCalledWith(3, 'set_application_resume', {
      p_application_id: APP_ID,
      p_resume_id: RESUME_ID,
    })
    expect(supabase.rpc).toHaveBeenNthCalledWith(4, 'append_application_stage', {
      p_application_id: APP_ID,
      p_stage: 'interview',
      p_occurred_on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    })
    expect(supabase.rpc).toHaveBeenNthCalledWith(
      5,
      'update_application_stage_event',
      {
        p_event_id: EVENT_ID,
        p_stage: 'interview',
        p_occurred_on: '2026-07-28',
      },
    )
    expect(supabase.rpc).toHaveBeenNthCalledWith(6, 'delete_application_stage_event', {
      p_event_id: EVENT_ID,
    })
  })

  it('rejects manual-only field edits for system applications before RPC', async () => {
    await expect(
      updateApplicationTextField(APP_ID, 'system', 'company', 'Other'),
    ).rejects.toThrow('application_field_not_editable')
    await expect(
      updateApplicationTextField(APP_ID, 'system', 'description_text', '<script>'),
    ).rejects.toThrow('application_field_not_editable')
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('allows manual-only fields for manual applications and keeps the RPC narrow', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: true, error: null } as never)
    await updateApplicationTextField(APP_ID, 'manual', 'location', 'Chicago, IL')
    expect(supabase.rpc).toHaveBeenCalledWith('update_application_text_field', {
      p_application_id: APP_ID,
      p_field: 'location',
      p_value: 'Chicago, IL',
    })
  })

  it('propagates server errors and rejects false or malformed mutation results', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: null,
      error: new Error('denied'),
    } as never)
    await expect(setApplicationPin(APP_ID, true)).rejects.toThrow('denied')

    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: false, error: null } as never)
    await expect(setApplicationResume(APP_ID, null))
      .rejects.toThrow('invalid_tracker_mutation_result')

    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: 'not-a-uuid',
      error: null,
    } as never)
    await expect(appendApplicationStage(APP_ID, 'offer'))
      .rejects.toThrow('invalid_tracker_stage_event_id')
  })
})

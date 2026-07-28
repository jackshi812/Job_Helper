import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  ApplicationTimeline,
  type ApplicationTimelineProps,
} from './ApplicationTimeline'
import timelineSource from './ApplicationTimeline.tsx?raw'

const events: ApplicationTimelineProps['events'] = [
  {
    id: '33333333-3333-4333-8333-333333333333',
    applicationId: '11111111-1111-4111-8111-111111111111',
    stage: 'interview',
    occurredOn: '2026-07-28',
    createdAt: '2026-07-28T12:00:00.000Z',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    applicationId: '11111111-1111-4111-8111-111111111111',
    stage: 'applied',
    occurredOn: '2026-07-25',
    createdAt: '2026-07-25T12:00:00.000Z',
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    applicationId: '11111111-1111-4111-8111-111111111111',
    stage: 'interview',
    occurredOn: '2026-07-30',
    createdAt: '2026-07-30T12:00:00.000Z',
  },
]

function renderTimeline(overrides: Partial<ApplicationTimelineProps> = {}) {
  return renderToStaticMarkup(createElement(ApplicationTimeline, {
    applicationTitle: 'Data Analyst',
    events,
    onSave: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  }))
}

describe('ApplicationTimeline', () => {
  it('renders chronological ordered-list nodes with dates above and labels below', () => {
    const markup = renderTimeline()

    expect(markup).toContain('aria-label="Stage history for Data Analyst"')
    expect(markup).toContain('<ol')
    expect(markup).toContain('<time dateTime="2026-07-25"')
    expect(markup.indexOf('Applied')).toBeLessThan(markup.indexOf('Interview 1'))
    expect(markup.indexOf('Interview 1')).toBeLessThan(markup.indexOf('Interview 2'))
    expect(markup).toContain('Edit Applied from')
    expect(markup).toContain('Edit Interview 2 from')
  })

  it('locks the approved horizontal geometry and independent scrolling', () => {
    expect(timelineSource).toContain('overflow-x-auto')
    expect(timelineSource).toContain('px-8')
    expect(timelineSource).toContain('min-w-36')
    expect(timelineSource).toContain('h-1')
    expect(timelineSource).toContain('h-5')
    expect(timelineSource).toContain('w-5')
    expect(timelineSource).toContain('border-4')
    expect(timelineSource).toContain('min-h-11')
    expect(timelineSource).toContain('min-w-11')
    expect(timelineSource).not.toMatch(/\btransition-|animate-/)
  })

  it('uses the existing cancel-first confirmation and exact deletion copy', () => {
    expect(timelineSource).toContain('title="Delete timeline event?"')
    expect(timelineSource).toContain(
      '`Delete ${selectedEvent.label} from ${formatDateOnly(selectedEvent.occurredOn)}? The current stage may change.`',
    )
    expect(timelineSource).toContain('confirmLabel="Delete event"')
    expect(timelineSource).toContain('cancelLabel="Keep event"')
    expect(timelineSource).toContain('initialFocus="cancel"')
    expect(timelineSource).toContain('Retry deleting event')
    expect(timelineSource).toContain(
      'Couldn’t delete this event. Refresh the timeline and retry.',
    )
  })

  it('protects the final event and exposes stage/date correction controls', () => {
    const markup = renderTimeline({ events: [events[0]] })

    expect(markup).toContain(
      'Every application needs one timeline event. Edit this event instead.',
    )
    expect(markup).not.toContain('Delete timeline event?')
    expect(timelineSource).toContain('Edit {selectedEvent.label}')
    expect(timelineSource).toContain('type="date"')
    expect(timelineSource).toContain('TRACKER_STAGES.map')
  })
})

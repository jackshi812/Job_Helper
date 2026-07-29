import { describe, expect, it } from 'vitest'
import migration0061 from '../../supabase/migrations/0061_tracker_chicago_dates.sql?raw'

describe('migration 0061 tracker Chicago dates', () => {
  it('pins every tracker today boundary to America/Chicago', () => {
    expect(migration0061.trim().toLowerCase()).toMatch(/^begin;/)
    expect(migration0061.trim().toLowerCase()).toMatch(/commit;$/)

    const signatures = [
      'mark_job_applied\\(uuid\\)',
      'create_manual_application\\(text, text, text, text, text, date\\)',
      'append_application_stage\\(uuid, text, date\\)',
      'update_application_stage_event\\(uuid, text, date\\)',
    ]
    for (const signature of signatures) {
      expect(migration0061).toMatch(new RegExp(
        `alter function public\\.${signature}\\s+set timezone to 'America/Chicago'`,
        'i',
      ))
    }
    expect(migration0061.match(/America\/Chicago/gu)).toHaveLength(5)
  })
})

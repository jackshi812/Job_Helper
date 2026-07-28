import { describe, expect, it } from 'vitest'
import migration0055 from '../../supabase/migrations/0055_tracker_behavior_and_cleanup.sql?raw'

describe('migration 0055 tracker behavior and cleanup repair', () => {
  it('keeps the Dashboard RPC invoker-safe without helper execute privilege', () => {
    const dashboard = migration0055.match(
      /create or replace function public\.dashboard_applied_applications\(\)([\s\S]*?)\$\$;/i,
    )?.[0]
    expect(dashboard).toBeDefined()
    expect(dashboard).toMatch(/security invoker/i)
    expect(dashboard).toMatch(/set search_path = ''/i)
    expect(dashboard).toMatch(/\^https:\/\//i)
    expect(dashboard).not.toMatch(/tracker_https_url_valid/i)
    expect(migration0055).not.toMatch(
      /grant execute on function public\.tracker_https_url_valid/i,
    )
  })

  it('allows only parent-cascade final-event deletion', () => {
    const projection = migration0055.match(
      /create or replace function public\.sync_application_stage_projection\(\)([\s\S]*?)\$\$;/i,
    )?.[0]
    expect(projection).toBeDefined()
    expect(projection).toMatch(
      /tg_op\s*=\s*'DELETE'[\s\S]*not exists[\s\S]*public\.applications/i,
    )
    expect(projection).toMatch(/return old/i)
    expect(projection).toMatch(
      /final_application_event: every application needs one timeline event/i,
    )
  })

  it('removes only the audited fake-job projection lineage', () => {
    expect(migration0055).toContain(
      '04020000-0000-4000-8000-000000000020',
    )
    expect(migration0055).toContain(
      '04020000-0000-4000-8000-000000000010',
    )
    expect(migration0055).toMatch(/unexpected_projection_count|projection_count/i)
    expect(migration0055).toMatch(/ranking_item_count/i)
    expect(migration0055).toMatch(/ranking_item_count\s*<>\s*3/i)
    expect(migration0055).toMatch(/ranking_pending_count\s*<>\s*1/i)
    expect(migration0055).toMatch(/ranking_completed_count\s*<>\s*2/i)
    expect(migration0055).toMatch(/delete from public\.user_jobs/i)
    expect(migration0055).toMatch(/deleted_projection_count\s*<>\s*1/i)
    expect(migration0055).toMatch(/delete from public\.jobs/i)
    expect(migration0055).toMatch(/delete from public\.companies/i)
  })

  it('replaces exactly the two defective functions and preserves ACLs', () => {
    const replacements = [
      ...migration0055.matchAll(
        /create or replace function public\.([a-z0-9_]+)\s*\(/gi,
      ),
    ].map(([, name]) => name)
    expect(replacements).toEqual([
      'sync_application_stage_projection',
      'dashboard_applied_applications',
    ])
    expect(migration0055).toMatch(
      /revoke all on function public\.sync_application_stage_projection\(\)\s+from public, anon, authenticated/i,
    )
    expect(migration0055).toMatch(
      /grant execute on function public\.dashboard_applied_applications\(\)\s+to authenticated/i,
    )
  })
})

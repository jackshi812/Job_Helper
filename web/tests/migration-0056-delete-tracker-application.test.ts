import { describe, expect, it } from 'vitest'
import migration0056 from '../../supabase/migrations/0056_delete_tracker_application.sql?raw'

describe('migration 0056 delete tracker application', () => {
  it('deletes exactly one authenticated owner application', () => {
    expect(migration0056).toMatch(
      /create function public\.delete_tracker_application\(p_application_id uuid\)/i,
    )
    expect(migration0056).toMatch(/returns boolean/i)
    expect(migration0056).toMatch(/security definer/i)
    expect(migration0056).toMatch(/set search_path = ''/i)
    expect(migration0056).toMatch(/owner_id uuid := \(select auth\.uid\(\)\)/i)
    expect(migration0056).toMatch(
      /delete from public\.applications as application[\s\S]*application\.id = p_application_id[\s\S]*application\.user_id = owner_id/i,
    )
    expect(migration0056).toMatch(/changed <> 1/i)
    expect(migration0056).toMatch(/application_not_found/i)
  })

  it('keeps applied history immutable outside the tracker record', () => {
    expect(migration0056).not.toMatch(/delete from public\.user_jobs/i)
    expect(migration0056).not.toMatch(/update public\.user_jobs/i)
    expect(migration0056).not.toMatch(/applied_at\s*=/i)
  })

  it('exposes only the narrow authenticated RPC', () => {
    expect(migration0056).toMatch(
      /revoke all on function public\.delete_tracker_application\(uuid\)\s+from public, anon, authenticated/i,
    )
    expect(migration0056).toMatch(
      /grant execute on function public\.delete_tracker_application\(uuid\)\s+to authenticated/i,
    )
    expect(migration0056).toMatch(
      /alter function public\.delete_tracker_application\(uuid\) owner to postgres/i,
    )
  })
})

import { describe, expect, it } from 'vitest'
import migration0054 from '../../supabase/migrations/0054_mark_job_applied_ambiguity.sql?raw'

describe('migration 0054 tracker RPC repair', () => {
  it('replaces only mark_job_applied with an unambiguous application identifier', () => {
    expect(migration0054).toMatch(
      /create or replace function public\.mark_job_applied\(p_user_job_id uuid\)/i,
    )
    expect(migration0054).toMatch(/target_application_id uuid/i)
    expect(migration0054).not.toMatch(/^\s*application_id uuid;\s*$/im)
    expect(migration0054).toMatch(
      /returning id into target_application_id/i,
    )
    expect(migration0054).toMatch(
      /event\.application_id = target_application_id/i,
    )
    expect(migration0054).toMatch(
      /values \(target_application_id, owner_id, 'applied', current_date\)/i,
    )
    expect(migration0054).toMatch(/return target_application_id/i)

    const replacedFunctions = [
      ...migration0054.matchAll(
        /create or replace function public\.([a-z0-9_]+)\s*\(/gi,
      ),
    ].map(([, name]) => name)
    expect(replacedFunctions).toEqual(['mark_job_applied'])
  })

  it('preserves the RPC security and authenticated-only ACL contract', () => {
    expect(migration0054).toMatch(/language plpgsql/i)
    expect(migration0054).toMatch(/security definer/i)
    expect(migration0054).toMatch(/set search_path = ''/i)
    expect(migration0054).toMatch(
      /revoke execute on function public\.mark_job_applied\(uuid\)\s+from public, anon/i,
    )
    expect(migration0054).toMatch(
      /grant execute on function public\.mark_job_applied\(uuid\)\s+to authenticated/i,
    )
    expect(migration0054).toMatch(
      /alter function public\.mark_job_applied\(uuid\) owner to postgres/i,
    )
  })
})

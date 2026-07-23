import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(
    process.cwd(),
    '../supabase/migrations/0034_repair_deterministic_ranking_retry.sql',
  ),
  'utf8',
)

describe('deterministic ranking retry repair migration', () => {
  it('replaces only the owner-scoped authenticated retry RPC', () => {
    expect(migration).toMatch(
      /create or replace function public\.retry_deterministic_ranking_run\(\)/i,
    )
    expect(migration).toMatch(/security definer/i)
    expect(migration).toMatch(/set search_path = ''/i)
    expect(migration).toMatch(/owner_id uuid := \(select auth\.uid\(\)\)/i)
    expect(migration).toMatch(/for update of state, run/i)
    expect(migration).not.toMatch(/\bp_user_id\b/i)
    expect(migration).not.toMatch(/\b(?:alter|drop|create)\s+table\b/i)
  })

  it('uses the named item constraint instead of the ambiguous run_id target', () => {
    expect(migration).toMatch(
      /on conflict on constraint\s+deterministic_ranking_items_run_id_user_job_id_key\s+do nothing/i,
    )
    expect(migration).not.toMatch(/on conflict\s*\(\s*run_id\s*,\s*user_job_id\s*\)/i)
  })

  it('preserves unique replay protection and least-privilege execution', () => {
    expect(migration).toMatch(
      /on conflict\s*\(\s*retry_of_run_id\s*\)\s*where retry_of_run_id is not null\s*do nothing/i,
    )
    expect(migration).toMatch(
      /revoke execute on function public\.retry_deterministic_ranking_run\(\)\s+from public, anon/i,
    )
    expect(migration).toMatch(
      /grant execute on function public\.retry_deterministic_ranking_run\(\)\s+to authenticated/i,
    )
  })
})

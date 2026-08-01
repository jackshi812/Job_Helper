import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migrationPath = fileURLToPath(new URL(
  '../../supabase/migrations/0063_dismissal_tombstone_ranking_containment.sql',
  import.meta.url,
))
const migration = readFileSync(migrationPath, 'utf8')

function enqueueFunction(): string {
  const match = migration.match(
    /create or replace function public\.enqueue_deterministic_new_jobs\([\s\S]*?\n\$\$;/i,
  )
  expect(match, 'enqueue_deterministic_new_jobs must be replaced').not.toBeNull()
  return match?.[0] ?? ''
}

describe('migration 0063 dismissal-tombstone ranking containment', () => {
  it('is one bounded forward transaction', () => {
    expect(migration.trimStart()).toMatch(/^begin;/i)
    expect(migration.trimEnd()).toMatch(/commit;$/i)
    expect(migration).toContain("set local lock_timeout = '5s'")
    expect(migration).toContain("set local statement_timeout = '60s'")
    expect(migration).not.toMatch(
      /\b(drop|alter|update|delete|insert into)\s+supabase_migrations\./i,
    )
  })

  it('replaces only the existing enqueue RPC', () => {
    const definitions = [...migration.matchAll(
      /\bcreate(?:\s+or\s+replace)?\s+function\s+public\.([a-z0-9_]+)/gi,
    )].map((match) => match[1])

    expect(definitions).toEqual(['enqueue_deterministic_new_jobs'])
    expect(migration).not.toMatch(
      /create(?:\s+or\s+replace)?\s+function\s+public\.finalize_deterministic_ranking_run/i,
    )
    expect(migration).not.toMatch(
      /\b(?:create|drop|alter)\s+(?:table|index|trigger)\b/i,
    )
    expect(migration).not.toMatch(/\b(?:delete\s+from|truncate|vacuum|analyze|reindex|cluster)\b/i)
    expect(migration).not.toMatch(/dashboard_feed|score_tick|paid_ai/i)
  })

  it('keeps the bounded full-snapshot enqueue contract', () => {
    const source = enqueueFunction()

    expect(source).toMatch(/batch_size integer default 25/i)
    expect(source).toMatch(
      /returns table \(initialized_count integer, seeded_count integer\)/i,
    )
    expect(source).toMatch(/security definer/i)
    expect(source).toMatch(/set search_path = ''/i)
    expect(source).toMatch(/batch_size < 1 or batch_size > 25/i)
    expect(source).toMatch(/state\.status = 'idle'/i)
    expect(source).toMatch(/state\.active_revision > 0/i)
    expect(source).toMatch(/order by state\.updated_at, state\.user_id/i)
    expect(source).toMatch(/limit batch_size/i)
    expect(source).toMatch(/for update skip locked/i)
    expect(source).toMatch(/source_run\.captured_titles/i)
    expect(source).toMatch(/source_run\.captured_rubric/i)
    expect(source).toMatch(/clock_timestamp\(\), count\(\*\)::integer/i)
    expect(source).toMatch(
      /insert into public\.deterministic_ranking_items[\s\S]*from public\.user_jobs as user_job[\s\S]*job\.status = 'open'/i,
    )
    expect(source).toMatch(/perform public\.finalize_deterministic_ranking_run\(new_run_id\)/i)
    expect(source).not.toMatch(/trigger_job_ids|delta|changed_job/i)
  })

  it('uses the same owner and provider identity in qualification and projection seeding', () => {
    const source = enqueueFunction()
    const dismissalReferences = source.match(/public\.user_job_dismissals/gi) ?? []

    expect(dismissalReferences).toHaveLength(2)
    expect(source).toMatch(
      /exists \([\s\S]*?from public\.jobs as job[\s\S]*?not exists \([\s\S]*?from public\.user_job_dismissals as dismissal[\s\S]*?dismissal\.user_id = state\.user_id[\s\S]*?dismissal\.source = job\.source[\s\S]*?dismissal\.external_id = job\.external_id/i,
    )
    expect(source).toMatch(
      /insert into public\.user_jobs[\s\S]*?select owner_state\.user_id, job\.id[\s\S]*?from public\.jobs as job[\s\S]*?not exists \([\s\S]*?from public\.user_job_dismissals as dismissal[\s\S]*?dismissal\.user_id = owner_state\.user_id[\s\S]*?dismissal\.source = job\.source[\s\S]*?dismissal\.external_id = job\.external_id/i,
    )
  })

  it('reasserts postgres ownership and service-role-only execution', () => {
    expect(migration).toMatch(
      /alter function public\.enqueue_deterministic_new_jobs\(integer\)\s+owner to postgres/i,
    )
    expect(migration).toMatch(
      /revoke execute on function public\.enqueue_deterministic_new_jobs\(integer\)\s+from public, anon, authenticated/i,
    )
    expect(migration).toMatch(
      /grant execute on function public\.enqueue_deterministic_new_jobs\(integer\)\s+to service_role/i,
    )
    expect(migration).not.toMatch(
      /grant execute on function public\.enqueue_deterministic_new_jobs\(integer\)\s+to (?:public|anon|authenticated)/i,
    )
  })
})

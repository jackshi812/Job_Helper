import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(
    process.cwd(),
    '../supabase/migrations/0032_deterministic_ranking.sql',
  ),
  'utf8',
)

function sqlFunction(name: string): string {
  const start = migration.indexOf(`function public.${name}`)
  expect(start, `${name} must exist`).toBeGreaterThanOrEqual(0)
  const next = migration.indexOf('\ncreate ', start + 1)
  return migration.slice(start, next === -1 ? migration.length : next)
}

describe('deterministic ranking migration', () => {
  it('adds a separate constrained deterministic data plane without rewriting AI evidence', () => {
    expect(migration).toMatch(/add column ranking_rubric jsonb/i)
    expect(migration).toMatch(/create table public\.deterministic_ranking_state/i)
    expect(migration).toMatch(/create table public\.deterministic_ranking_runs/i)
    expect(migration).toMatch(/create table public\.deterministic_ranking_items/i)
    expect(migration).toMatch(/add column deterministic_revision bigint/i)
    expect(migration).toMatch(/add column deterministic_breakdown jsonb/i)
    expect(migration).toMatch(/deterministic_tier.*Strong.*Good.*Weak/is)
    expect(migration).toMatch(/cardinality\(.*\) <= 50/is)
    expect(migration).toMatch(/octet_length\(.*4096/is)
    expect(migration).not.toMatch(/\bdrop\s+(?:column|table)\b/i)
    expect(migration).not.toMatch(
      /\b(?:update|set)\s+(?:score|tier|reasons|gaps|covered|scoring_input_hash)\b/i,
    )
  })

  it('keeps state and runs owner-readable while items and active columns stay service-owned', () => {
    expect(migration).toMatch(
      /alter table public\.deterministic_ranking_(?:state|runs|items) enable row level security/gi,
    )
    expect(migration).toMatch(/deterministic_ranking_state_select_own/)
    expect(migration).toMatch(/deterministic_ranking_runs_select_own/)
    expect(migration).not.toMatch(/deterministic_ranking_items_select_own/)
    expect(migration).toMatch(
      /grant update \(seen_at, dismissed_at\) on table public\.user_jobs to authenticated/i,
    )
    expect(migration).toMatch(
      /revoke all on table public\.deterministic_ranking_items from public, anon, authenticated/i,
    )
  })

  it('validates and captures an authenticated save before seeding work', () => {
    const source = sqlFunction('save_preferences_and_start_ranking')
    expect(source).toMatch(/security definer/)
    expect(source).toMatch(/set search_path = ''/)
    expect(source).toMatch(/auth\.uid\(\)/)
    expect(source).not.toMatch(/p_user_id/)
    expect(source).toMatch(/invalid_ranking_rubric/)
    expect(source).toMatch(/invalid_ranking_thresholds/)
    expect(source).toMatch(/invalid_ranking_preferences/)

    const validateAt = source.indexOf('invalid_ranking_rubric')
    const preferenceWriteAt = source.indexOf('insert into public.preferences')
    const runWriteAt = source.indexOf('insert into public.deterministic_ranking_runs')
    const itemWriteAt = source.indexOf('insert into public.deterministic_ranking_items')
    expect(validateAt).toBeLessThan(preferenceWriteAt)
    expect(preferenceWriteAt).toBeLessThan(runWriteAt)
    expect(runWriteAt).toBeLessThan(itemWriteAt)
  })

  it('claims with SKIP LOCKED, stages by revision CAS, and promotes atomically', () => {
    const claim = sqlFunction('claim_deterministic_ranking_work')
    const stage = sqlFunction('stage_deterministic_ranking_result')
    const finalize = sqlFunction('finalize_deterministic_ranking_run')

    expect(claim).toMatch(/for update skip locked/i)
    expect(claim).toMatch(/limit batch_size/i)
    expect(stage).toMatch(/claimed_revision\s*=\s*p_revision/i)
    expect(stage).toMatch(/run\.status\s*=\s*'building'|r\.status\s*=\s*'building'/i)

    const stateLockAt = finalize.indexOf('for update')
    const missingSeedAt = finalize.indexOf(
      'insert into public.deterministic_ranking_items',
    )
    const promotionAt = finalize.indexOf('update public.user_jobs')
    const stateSwitchAt = finalize.indexOf(
      'update public.deterministic_ranking_state',
    )
    expect(stateLockAt).toBeGreaterThanOrEqual(0)
    expect(missingSeedAt).toBeGreaterThan(stateLockAt)
    expect(promotionAt).toBeGreaterThan(missingSeedAt)
    expect(stateSwitchAt).toBeGreaterThan(promotionAt)
    expect(finalize).toMatch(/status = 'failed'/)
    expect(finalize).toMatch(/status = 'stale'/)
  })

  it('makes retry owner-scoped and unique for one captured failed revision', () => {
    const retry = sqlFunction('retry_deterministic_ranking_run')
    expect(retry).toMatch(/auth\.uid\(\)/)
    expect(retry).not.toMatch(/p_user_id/)
    expect(retry).toMatch(/retry_of_run_id/)
    expect(migration).toMatch(
      /unique index .*retry.* on public\.deterministic_ranking_runs \(retry_of_run_id\)/i,
    )
    expect(retry).toMatch(/on conflict.*do nothing/is)
  })

  it('provides one bounded idempotent service-only initializer for every real owner', () => {
    const initializer = sqlFunction(
      'initialize_deterministic_ranking_backfill',
    )
    expect(initializer).toMatch(/batch_size integer default 25/)
    expect(initializer).toMatch(/batch_size < 1 or batch_size > 25/)
    expect(initializer).toMatch(/from auth\.users/)
    expect(initializer).toMatch(/from public\.preferences/)
    expect(initializer).toMatch(/from public\.user_jobs/)
    expect(initializer).toMatch(/for update skip locked/i)
    expect(initializer).toMatch(/on conflict.*do nothing/is)
    expect(initializer).toMatch(/initialized_count/)
    expect(initializer).toMatch(/seeded_count/)
    expect(initializer).toMatch(/remaining_count/)
    expect(migration).toMatch(
      /unique index .*initial.* on public\.deterministic_ranking_runs \(user_id\).*where is_initial/is,
    )
    expect(migration).toMatch(
      /alter function public\.initialize_deterministic_ranking_backfill\(integer\) owner to postgres/i,
    )
    expect(migration).toMatch(
      /revoke execute on function public\.initialize_deterministic_ranking_backfill\(integer\) from public, anon, authenticated/i,
    )
    expect(migration).toMatch(
      /grant execute on function public\.initialize_deterministic_ranking_backfill\(integer\) to service_role/i,
    )
  })

  it('revokes every RPC before granting only its intended role', () => {
    const authenticated = [
      'save_preferences_and_start_ranking',
      'get_deterministic_ranking_state',
      'retry_deterministic_ranking_run',
      'request_deterministic_route_refresh',
    ]
    const service = [
      'initialize_deterministic_ranking_backfill',
      'claim_deterministic_ranking_work',
      'stage_deterministic_ranking_result',
      'finalize_deterministic_ranking_run',
      'enqueue_deterministic_new_jobs',
      'enqueue_deterministic_recency_refresh',
      'request_deterministic_route_refresh_for_user',
    ]

    for (const name of [...authenticated, ...service]) {
      expect(migration).toMatch(
        new RegExp(
          `revoke execute on function public\\.${name}\\([^;]*\\) from public, anon(?:, authenticated)?`,
          'i',
        ),
      )
    }
    for (const name of authenticated) {
      expect(migration).toMatch(
        new RegExp(
          `grant execute on function public\\.${name}\\([^;]*\\) to authenticated`,
          'i',
        ),
      )
    }
    for (const name of service) {
      expect(migration).toMatch(
        new RegExp(
          `grant execute on function public\\.${name}\\([^;]*\\) to service_role`,
          'i',
        ),
      )
    }
  })
})

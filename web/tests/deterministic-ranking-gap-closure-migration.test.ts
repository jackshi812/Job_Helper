import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  '../supabase/migrations/0033_deterministic_ranking_gap_closure.sql',
)

function readMigration(): string {
  return readFileSync(migrationPath, 'utf8')
}

function sqlFunction(migration: string, name: string): string {
  const start = migration.indexOf(`function public.${name}`)
  expect(start, `${name} must exist`).toBeGreaterThanOrEqual(0)
  const next = migration.indexOf('\ncreate ', start + 1)
  return migration.slice(start, next === -1 ? migration.length : next)
}

describe('deterministic ranking gap-closure migration', () => {
  it('adds one terminal superseded item state without destructive history changes', () => {
    const migration = readMigration()

    expect(migration).toMatch(
      /deterministic_ranking_items_status_check[\s\S]*'superseded'/i,
    )
    expect(migration).not.toMatch(/\bdrop\s+(?:column|table)\b/i)
    expect(migration).not.toMatch(
      /\b(?:update|set)\s+(?:score|tier|reasons|gaps|covered|scoring_input_hash)\b/i,
    )
  })

  it('reaps terminal expired leases before claiming more work', () => {
    const migration = readMigration()
    const reaper = sqlFunction(
      migration,
      'reap_expired_deterministic_ranking_leases',
    )
    const claim = sqlFunction(migration, 'claim_deterministic_ranking_work')

    expect(reaper).toMatch(/attempts\s*>=\s*3/i)
    expect(reaper).toMatch(/interval '5 minutes'/i)
    expect(reaper).toMatch(/status\s*=\s*'failed'/i)
    expect(reaper).toMatch(/retry_available\s*=/i)
    expect(reaper).toMatch(/for update(?: of item)? skip locked/i)
    expect(claim.indexOf('reap_expired_deterministic_ranking_leases'))
      .toBeLessThan(claim.indexOf('with claimable'))
  })

  it('terminalizes old work while superseding a preference run', () => {
    const migration = readMigration()
    const save = sqlFunction(
      migration,
      'save_preferences_and_start_ranking',
    )

    expect(save).toMatch(/for update of state/i)
    expect(save).toMatch(
      /update public\.deterministic_ranking_items[\s\S]*status = 'superseded'/i,
    )
    expect(save).toMatch(/status in \('pending', 'claimed'\)/i)
    expect(save).toMatch(
      /on conflict on constraint\s+deterministic_ranking_items_run_id_user_job_id_key/i,
    )
    expect(save).not.toMatch(/on conflict \(run_id,\s*user_job_id\)/i)
    expect(save.indexOf("status = 'superseded'"))
      .toBeLessThan(save.indexOf("status = 'stale'"))
  })

  it('does not let generic finalization acknowledge route refresh demand', () => {
    const migration = readMigration()
    const finalize = sqlFunction(
      migration,
      'finalize_deterministic_ranking_run',
    )

    expect(finalize).not.toMatch(/route_refresh_requested_at\s*=\s*null/i)
  })

  it('acknowledges only the observed route request when enqueue succeeds', () => {
    const migration = readMigration()
    const enqueue = sqlFunction(
      migration,
      'enqueue_deterministic_route_refreshes',
    )

    expect(enqueue).toMatch(/observed_route_refresh_requested_at/i)
    expect(enqueue).toMatch(
      /route_refresh_requested_at\s*=\s*null[\s\S]*route_refresh_requested_at\s*=\s*observed_route_refresh_requested_at/i,
    )
    expect(enqueue.indexOf('insert into public.deterministic_ranking_runs'))
      .toBeLessThan(enqueue.indexOf('route_refresh_requested_at = null'))
  })

  it('records resume insert and delete demand in the metadata transaction', () => {
    const migration = readMigration()
    const trigger = sqlFunction(
      migration,
      'signal_deterministic_route_refresh_from_resume',
    )

    expect(trigger).toMatch(/security definer/i)
    expect(trigger).toMatch(/set search_path = ''/i)
    expect(trigger).toMatch(/coalesce\(new\.user_id, old\.user_id\)/i)
    expect(migration).toMatch(
      /after insert or delete on public\.resumes[\s\S]*signal_deterministic_route_refresh_from_resume/i,
    )
    expect(migration).toMatch(
      /revoke all on function public\.signal_deterministic_route_refresh_from_resume\(\)\s+from public, anon, authenticated/i,
    )
  })

  it('keeps protected RPCs service-role-only and replay-safe', () => {
    const migration = readMigration()

    for (const name of [
      'reap_expired_deterministic_ranking_leases',
      'claim_deterministic_ranking_work',
      'stage_deterministic_ranking_result',
      'finalize_deterministic_ranking_run',
      'enqueue_deterministic_route_refreshes',
    ]) {
      expect(migration).toMatch(
        new RegExp(
          `revoke execute on function public\\.${name}\\([^;]*\\)\\s+from public, anon, authenticated`,
          'is',
        ),
      )
      expect(migration).toMatch(
        new RegExp(
          `grant execute on function public\\.${name}\\([^;]*\\)\\s+to service_role`,
          'is',
        ),
      )
    }
  })
})

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migrationPath = fileURLToPath(new URL(
  '../../supabase/migrations/0065_incremental_preference_ranking.sql',
  import.meta.url,
))
const migration = readFileSync(migrationPath, 'utf8')

function functionSource(name: string): string {
  const match = migration.match(new RegExp(
    `create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
    'i',
  ))
  expect(match, `${name} must be defined by migration 0065`).not.toBeNull()
  return match?.[0] ?? ''
}

describe('migration 0065 incremental preference ranking', () => {
  it('is a forward-only bounded transaction without deployment or AI work', () => {
    expect(migration.trimStart()).toMatch(/^begin;/i)
    expect(migration.trimEnd()).toMatch(/commit;$/i)
    expect(migration).toContain("set local lock_timeout = '5s'")
    expect(migration).toContain("set local statement_timeout = '60s'")
    expect(migration).not.toMatch(
      /\b(?:truncate|vacuum|analyze|reindex|cluster)\b|pg_cron|net\.http|openai|paid_ai|score_request_budget/i,
    )
  })

  it('adds explicit bounded selection state while leaving historical runs eager', () => {
    expect(migration).toMatch(
      /add column selection_mode text not null default 'eager'/i,
    )
    expect(migration).toMatch(
      /selection_mode in \('eager', 'all_open', 'added_titles'\)/i,
    )
    expect(migration).toMatch(/add column selection_cursor uuid/i)
    expect(migration).toMatch(
      /add column selection_complete boolean not null default true/i,
    )
    expect(migration).toMatch(
      /selection_mode = 'eager'[\s\S]*selection_complete/i,
    )
  })

  it('persists only a run descriptor on Save and compares additions to the active snapshot', () => {
    const save = functionSource('save_preferences_and_start_ranking')

    expect(save).toContain('payload_matches_prior')
    expect(save).toContain("owner_state.status in ('idle', 'building')")
    expect(save).toContain('payload_matches_active')
    expect(save).toMatch(/active_run\.captured_titles[\s\S]*p_titles\[1:cardinality/i)
    expect(save).toContain("selection_kind := 'added_titles'")
    expect(save).toContain("selection_kind text := 'all_open'")
    expect(save).toMatch(/evaluation_at, 0,[\s\S]*selection_kind, added_titles, null, false/i)
    expect(save).toMatch(/return query select new_run_id, next_revision, 0/i)
    expect(save).not.toMatch(/insert into public\.user_jobs/i)
    expect(save).not.toMatch(/insert into public\.deterministic_ranking_items/i)
    expect(save).not.toMatch(/from public\.jobs as job/i)
  })

  it('selects additive title matches only and bounds global fallback materialization', () => {
    const enqueue = functionSource('enqueue_deterministic_preference_refreshes')

    expect(enqueue).toMatch(/scan_limit integer := batch_size \* 10/i)
    expect(enqueue).toMatch(/batch_size < 1 or batch_size > 25/i)
    expect(enqueue).toMatch(/limit scan_limit/i)
    expect(enqueue).toMatch(/preference_run\.selection_mode = 'all_open'/i)
    expect(enqueue).toMatch(
      /deterministic_title_concepts_match\([\s\S]*job\.title,[\s\S]*added_title/i,
    )
    expect(enqueue).toMatch(/job\.id = any\(affected_job_ids\)/i)
    expect(enqueue).toMatch(/job_input_revision/i)
    expect(enqueue).toMatch(/selection_complete = scan_finished/i)
  })

  it('reuses the existing delta worker entry point and preserves regular job changes', () => {
    expect(migration).toMatch(
      /alter function public\.enqueue_deterministic_new_jobs\(integer\)\s+rename to enqueue_deterministic_job_changes/i,
    )
    const wrapper = functionSource('enqueue_deterministic_new_jobs')
    expect(wrapper).toContain('enqueue_deterministic_preference_refreshes(batch_size)')
    expect(wrapper).toContain('enqueue_deterministic_job_changes(batch_size)')
  })

  it('keeps the active revision visible until complete atomic publication', () => {
    const finalize = functionSource('finalize_deterministic_ranking_run')

    expect(finalize).toMatch(
      /is_bounded_preference_run and not run\.selection_complete[\s\S]*'building'/i,
    )
    expect(finalize).toMatch(
      /if not is_delta_run and not is_bounded_preference_run then[\s\S]*insert into public\.user_jobs/i,
    )
    expect(finalize).toMatch(
      /if is_bounded_preference_run then[\s\S]*user_job\.deterministic_revision = state\.active_revision/i,
    )
    expect(finalize).toMatch(
      /set active_revision = run\.revision,[\s\S]*active_run_id = run\.id/i,
    )
    expect(finalize).toMatch(
      /if is_delta_run or is_bounded_preference_run then[\s\S]*deterministic_ranking_job_changes/i,
    )
  })

  it('keeps browser and service privileges narrow', () => {
    expect(migration).toMatch(
      /grant execute on function public\.save_preferences_and_start_ranking\([\s\S]*to authenticated/i,
    )
    expect(migration).toMatch(
      /revoke execute on function public\.enqueue_deterministic_preference_refreshes\(integer\)[\s\S]*from public, anon, authenticated/i,
    )
    expect(migration).toMatch(
      /grant execute on function public\.enqueue_deterministic_preference_refreshes\(integer\)[\s\S]*to service_role/i,
    )
  })
})

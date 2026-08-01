import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migrationPath = fileURLToPath(new URL(
  '../../supabase/migrations/0064_delta_deterministic_ranking_and_batch_staging.sql',
  import.meta.url,
))
const migration = readFileSync(migrationPath, 'utf8')

function functionSource(name: string): string {
  const match = migration.match(new RegExp(
    `create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
    'i',
  ))
  expect(match, `${name} must be defined by migration 0064`).not.toBeNull()
  return match?.[0] ?? ''
}

function initialAlterTableSource(
  table: 'jobs' | 'deterministic_ranking_items',
): string {
  const match = migration.match(new RegExp(
    `alter table public\\.${table}\\s+[\\s\\S]*?;`,
    'i',
  ))
  expect(match, `initial ${table} ALTER TABLE must be present`).not.toBeNull()
  return match?.[0] ?? ''
}

describe('migration 0064 bounded delta ranking and batch staging', () => {
  it('is a forward-only bounded transaction with no retention or provider work', () => {
    expect(migration.trimStart()).toMatch(/^begin;/i)
    expect(migration.trimEnd()).toMatch(/commit;$/i)
    expect(migration).toContain("set local lock_timeout = '5s'")
    expect(migration).toContain("set local statement_timeout = '60s'")
    expect(migration).not.toMatch(
      /\b(?:truncate|vacuum|analyze|reindex|cluster)\b|supabase_migrations|pg_cron|openai|paid_ai|ai_usage|score_request_budget|retention/i,
    )
    expect(migration).not.toMatch(
      /delete\s+from\s+public\.(?:deterministic_ranking_items|deterministic_ranking_runs|user_jobs|jobs)/i,
    )
  })

  it('defers historical validation only for the ranking-item revision check', () => {
    const jobsAlter = initialAlterTableSource('jobs')
    const rankingItemsAlter = initialAlterTableSource(
      'deterministic_ranking_items',
    )

    expect(rankingItemsAlter).toMatch(
      /add constraint deterministic_ranking_items_job_input_revision_valid\s+check \(job_input_revision is null or job_input_revision >= 0\)\s+not valid\s*;/i,
    )
    expect(rankingItemsAlter.match(/\bnot valid\b/gi) ?? []).toHaveLength(1)
    expect(jobsAlter).toMatch(
      /add constraint jobs_deterministic_input_revision_valid\s+check \(deterministic_input_revision >= 0\)\s*;/i,
    )
    expect(jobsAlter).not.toMatch(/\bnot valid\b/i)
    expect(migration.match(/\bnot valid\b/gi) ?? []).toHaveLength(1)
  })

  it('adds a private deduplicating change queue and monotonic input revisions', () => {
    expect(migration).toMatch(
      /alter table public\.jobs\s+add column deterministic_input_revision bigint not null default 0/i,
    )
    expect(migration).toMatch(
      /alter table public\.deterministic_ranking_items\s+add column job_input_revision bigint/i,
    )
    expect(migration).toMatch(
      /create table public\.deterministic_ranking_job_changes[\s\S]*primary key \(user_id, job_id\)/i,
    )
    expect(migration).toMatch(
      /user_id uuid not null references auth\.users \(id\) on delete cascade/i,
    )
    expect(migration).toMatch(
      /job_id uuid not null references public\.jobs \(id\)[\s\S]*on delete cascade[\s\S]*deferrable initially deferred/i,
    )
    expect(migration).toMatch(
      /create index deterministic_ranking_job_changes_bounded_idx[\s\S]*\(queued_at, user_id, job_id\)/i,
    )
    expect(migration).toMatch(
      /alter table public\.deterministic_ranking_job_changes enable row level security/i,
    )
    expect(migration).toMatch(
      /revoke all on table public\.deterministic_ranking_job_changes\s+from public, anon, authenticated/i,
    )
    expect(migration).not.toMatch(
      /grant\s+(?:select|insert|update|delete|all)[\s\S]*deterministic_ranking_job_changes[\s\S]*to\s+(?:public|anon|authenticated)/i,
    )
  })

  it('queues only inserted or ranking-relevant changed jobs without a catalog backfill', () => {
    const trigger = functionSource('capture_deterministic_ranking_job_change')

    for (const field of [
      'title',
      'location',
      'description_text',
      'posted_at',
      'company_id',
      'status',
      'source',
      'external_id',
    ]) {
      expect(trigger).toContain(`old.${field} is distinct from new.${field}`)
    }
    expect(trigger).toMatch(
      /new\.deterministic_input_revision :=[\s\S]*old\.deterministic_input_revision \+ 1/i,
    )
    expect(trigger).toMatch(
      /insert into public\.deterministic_ranking_job_changes[\s\S]*from public\.deterministic_ranking_state as state[\s\S]*state\.active_revision > 0/i,
    )
    expect(trigger).toMatch(/on conflict \(user_id, job_id\) do update/i)
    expect(migration).toMatch(
      /create trigger jobs_capture_deterministic_ranking_change\s+before insert or update of[\s\S]*on public\.jobs/i,
    )
    const beforeTriggerFunction = migration.slice(
      0,
      migration.indexOf(
        'create or replace function public.capture_deterministic_ranking_job_change',
      ),
    )
    expect(beforeTriggerFunction).not.toContain(
      'insert into public.deterministic_ranking_job_changes',
    )
  })

  it('enqueues only the bounded queued membership and rechecks dismissal identity', () => {
    const enqueue = functionSource('enqueue_deterministic_new_jobs')

    expect(enqueue).toMatch(/batch_size integer default 25/i)
    expect(enqueue).toMatch(/batch_size < 1 or batch_size > 25/i)
    expect(enqueue).toMatch(/remaining integer := batch_size/i)
    expect(enqueue).toContain('public.deterministic_ranking_job_changes')
    expect(enqueue).toMatch(/limit remaining/i)
    expect(enqueue).toMatch(/for update of change skip locked/i)
    expect(enqueue).toMatch(/job\.status = 'open'/i)
    expect(enqueue).toMatch(/state\.status = 'idle'/i)
    expect(enqueue).toMatch(/state\.active_revision > 0/i)
    expect(enqueue).toMatch(/dismissal\.user_id = owner_state\.user_id/i)
    expect(enqueue).toMatch(/dismissal\.source = job\.source/i)
    expect(enqueue).toMatch(/dismissal\.external_id = job\.external_id/i)
    expect(enqueue).toMatch(
      /insert into public\.deterministic_ranking_items[\s\S]*job_input_revision/i,
    )
    expect(enqueue).toMatch(/user_job\.job_id = any\(qualified_job_ids\)/i)
    expect(enqueue).not.toMatch(/user_job\.deterministic_revision\s*(?:is|=)/i)
  })

  it('stages one exact-key 1-25 record payload atomically', () => {
    const stage = functionSource('stage_deterministic_ranking_results')

    expect(stage).toMatch(/p_results jsonb/i)
    expect(stage).toMatch(/returns integer/i)
    expect(stage).toMatch(/security definer/i)
    expect(stage).toMatch(/set search_path = ''/i)
    expect(stage).toMatch(/jsonb_typeof\(p_results\) <> 'array'/i)
    expect(stage).toMatch(/jsonb_array_length\(p_results\) not between 1 and 25/i)
    expect(stage).toContain("'job_input_revision'")
    expect(stage).toContain("'item_id'")
    expect(stage).toContain("'revision'")
    expect(stage).toContain("'error_code'")
    expect(stage).toMatch(/duplicate_ranking_stage_item/i)
    expect(stage).toContain('public.is_valid_ranking_breakdown')
    expect(stage).toMatch(/item\.status = 'claimed'/i)
    expect(stage).toMatch(/item\.claimed_revision = payload\.revision/i)
    expect(stage).toMatch(/run\.status = 'building'/i)
    expect(stage).toMatch(/get diagnostics staged_count = row_count/i)
    expect(stage).toMatch(/if staged_count <> payload_count/i)
    expect(stage).not.toMatch(/\bloop\b/i)
  })

  it('keeps delta retries scoped and delta publication complete-only', () => {
    const retry = functionSource('retry_deterministic_ranking_run')
    const finalize = functionSource('finalize_deterministic_ranking_run')

    expect(retry).toMatch(
      /select[\s\S]*item\.job_input_revision[\s\S]*where item\.run_id = failed_run\.id/i,
    )
    expect(finalize).toMatch(/is_delta_run boolean/i)
    expect(finalize).toMatch(/source_run_kind = 'new_job'/i)
    expect(finalize).toMatch(
      /if not is_delta_run then[\s\S]*insert into public\.user_jobs[\s\S]*insert into public\.deterministic_ranking_items/i,
    )
    expect(finalize).toMatch(
      /if exists \([\s\S]*item\.status <> 'completed'[\s\S]*return query select 'building'/i,
    )
    expect(finalize).toMatch(
      /delete from public\.deterministic_ranking_job_changes as change[\s\S]*change\.captured_job_revision = item\.job_input_revision/i,
    )
    expect(finalize).toMatch(/public\.user_job_dismissals/i)
  })

  it('reasserts service-role-only ownership for every write-capable RPC', () => {
    const normalized = migration
      .replace(/\s+/g, ' ')
      .replace(/\(\s+/g, '(')
      .replace(/\s+\)/g, ')')
    for (const signature of [
      'enqueue_deterministic_new_jobs(integer)',
      'stage_deterministic_ranking_results(jsonb)',
      'stage_deterministic_ranking_result(uuid, bigint, boolean, integer, text, jsonb, text, text, uuid, uuid, text)',
      'finalize_deterministic_ranking_run(uuid)',
    ]) {
      const escaped = signature.replace(/[()]/g, '\\$&')
      expect(normalized).toMatch(new RegExp(
        `alter function public\\.${escaped}\\s+owner to postgres`,
        'i',
      ))
      expect(normalized).toMatch(new RegExp(
        `revoke execute on function public\\.${escaped}\\s+from public, anon, authenticated`,
        'i',
      ))
      expect(normalized).toMatch(new RegExp(
        `grant execute on function public\\.${escaped}\\s+to service_role`,
        'i',
      ))
    }
  })
})

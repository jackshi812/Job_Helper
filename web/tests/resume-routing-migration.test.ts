import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../..', import.meta.url))
const migrationPath = `${root}/supabase/migrations/0052_decouple_resume_routing.sql`
const sql = () => readFileSync(migrationPath, 'utf8')

describe('resume route revision migration', () => {
  it('adds stale-by-default row revisions and current owner revisions', () => {
    expect(sql()).toMatch(/deterministic_ranking_state[\s\S]*resume_route_revision\s+bigint\s+not null\s+default\s+1/i)
    expect(sql()).toMatch(/user_jobs[\s\S]*resume_route_revision\s+bigint\s+not null\s+default\s+0/i)
    expect(sql()).toMatch(/resume_routed_at\s+timestamptz/i)
  })

  it('turns legacy route work into revision-only compatibility paths', () => {
    const source = sql()
    expect(source).toMatch(/request_deterministic_route_refresh\(\)[\s\S]*resume_route_revision\s*=\s*state\.resume_route_revision\s*\+\s*1/i)
    expect(source).toMatch(/enqueue_deterministic_route_refreshes[\s\S]*return query select 0,\s*0/i)
    expect(source).toMatch(/route_refresh_requested_at\s*=\s*null/i)
  })

  it('invalidates on resume metadata changes and ready extraction transitions', () => {
    const source = sql()
    expect(source).toContain('signal_deterministic_route_refresh_from_resume')
    expect(source).toContain('signal_resume_route_from_ready_extract')
    expect(source).toMatch(/old\.status is distinct from 'ready'[\s\S]*new\.status = 'ready'/i)
    expect(source).toMatch(/revoke all on function public\.signal_resume_route_from_ready_extract\(\)[\s\S]*from public, anon, authenticated/i)
  })

  it('publishes one validated page under a locked expected revision', () => {
    const source = sql()
    const publish = source.slice(source.indexOf('publish_resume_route_page'))
    expect(publish).toMatch(/jsonb_array_length\(p_routes\)\s+not between 1 and 200/i)
    expect(publish).toMatch(/for update[\s\S]*expected_revision/i)
    expect(publish).toMatch(/count\(distinct \(route ->> 'user_job_id'\)\)/i)
    expect(publish).toMatch(/deterministic_best_fit_resume_id[\s\S]*deterministic_runner_up_resume_id[\s\S]*resume_route_revision[\s\S]*resume_routed_at/i)
    expect(publish).toMatch(/grant execute on function public\.publish_resume_route_page[\s\S]*to service_role/i)
  })

  it('preserves routes during ranking finalization and exposes route freshness', () => {
    const source = sql()
    const finalizer = source.slice(
      source.indexOf('create or replace function public.finalize_deterministic_ranking_run'),
      source.indexOf('create or replace function public.publish_resume_route_page'),
    )
    expect(finalizer).not.toMatch(/set[\s\S]*deterministic_best_fit_resume_id\s*=/i)
    expect(source).toContain("'current_resume_route_revision'")
    expect(source).toContain("'resume_route_revision'")
    expect(source).toMatch(/p_limit is null or p_limit < 1 or p_limit > 200/i)
  })
})

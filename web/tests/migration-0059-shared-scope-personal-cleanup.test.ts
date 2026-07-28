import { describe, expect, it } from 'vitest'
import migration0053 from '../../supabase/migrations/0053_application_tracker.sql?raw'
import migration0055 from '../../supabase/migrations/0055_tracker_behavior_and_cleanup.sql?raw'
import migration0059 from '../../supabase/migrations/0059_shared_scope_and_personal_data_cleanup.sql?raw'

function functionBody(name: string) {
  return migration0059.match(
    new RegExp(
      `create(?: or replace)? function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
      'i',
    ),
  )?.[0] ?? ''
}

describe('migration 0059 — shared source scope and personal cleanup', () => {
  it('is transactional and adds rolling-release-safe versioned Dashboard RPCs', () => {
    expect(migration0059).toMatch(/^\s*begin\s*;/i)
    expect(migration0059).toMatch(/\bcommit\s*;\s*$/i)
    expect(migration0059).toMatch(
      /create function public\.dashboard_feed_page_v2\(/i,
    )
    expect(migration0059).toMatch(
      /create function public\.dashboard_company_options_v2\(/i,
    )
    expect(migration0059).not.toMatch(
      /drop function public\.dashboard_feed_page\(/i,
    )
    expect(migration0059).not.toMatch(
      /drop function public\.dashboard_company_options\(/i,
    )
  })

  it('applies source and tracker scope while scanning before the outward limit', () => {
    const body = functionBody('dashboard_feed_page_v2')
    const baseCall = body.indexOf('public.dashboard_feed_page_v0052(')
    const sourceFilter = body.indexOf("p_source_scope = 'all'")
    const trackerFilter = body.indexOf('from public.applications as application')
    const accumulation = body.indexOf(
      'accepted_rows := array_append(accepted_rows, candidate.row_data)',
    )
    const outwardLimit = body.indexOf('least(accepted_count, p_limit)')

    expect(body).toMatch(/while accepted_count < target_count and base_has_more loop/i)
    expect(body).toMatch(
      /p_source_scope is null[\s\S]*p_source_scope not in \('watchlist', 'all'\)/i,
    )
    expect(body).toMatch(/candidate\.row_data #> '\{jobs,companies\}' <> 'null'::jsonb/i)
    expect(body).toMatch(
      /application\.user_id = owner_id[\s\S]*application\.origin = 'system'[\s\S]*application\.source_job_id = user_job\.job_id/i,
    )
    expect(baseCall).toBeGreaterThan(-1)
    expect(sourceFilter).toBeGreaterThan(baseCall)
    expect(trackerFilter).toBeGreaterThan(sourceFilter)
    expect(accumulation).toBeGreaterThan(trackerFilter)
    expect(outwardLimit).toBeGreaterThan(accumulation)
  })

  it('builds complete company options under the same source boundary', () => {
    const body = functionBody('dashboard_company_options_v2')
    expect(body).toMatch(
      /p_source_scope = 'all' or company\.id is not null/i,
    )
    expect(body).toMatch(
      /p_lifecycle <> 'active'[\s\S]*job\.source <> 'goldman_higher'[\s\S]*job\.posted_at >= clock_timestamp\(\) - interval '168 hours'/i,
    )
    expect(body).toMatch(
      /p_source_scope is null[\s\S]*p_source_scope not in \('watchlist', 'all'\)/i,
    )
    expect(body).toMatch(
      /join public\.deterministic_ranking_state as ranking_state[\s\S]*ranking_state\.active_revision = user_job\.deterministic_revision/i,
    )
    expect(body).toMatch(
      /not exists \([\s\S]*from public\.applications as application[\s\S]*application\.user_id = owner_id/i,
    )
    expect(body.indexOf('group by 1')).toBeLessThan(
      body.indexOf('order by min('),
    )
  })

  it('deletes every current personal-data table but preserves identity and shared data', () => {
    const body = functionBody('delete_my_data')
    const personalTables = [
      'applications',
      'user_job_dismissals',
      'deterministic_ranking_state',
      'deterministic_ranking_items',
      'deterministic_ranking_runs',
      'ai_usage',
      'resume_extracts',
      'resumes',
      'preferences',
      'user_jobs',
    ]

    for (const table of personalTables) {
      expect(body).toMatch(
        new RegExp(`delete from public\\.${table}\\s+where user_id = owner_id`, 'i'),
      )
    }
    expect(body).toMatch(
      /update public\.deterministic_ranking_runs\s+set retry_of_run_id = null\s+where user_id = owner_id/i,
    )
    expect(body).not.toMatch(/delete from public\.application_stage_events/i)
    expect(migration0053).toMatch(
      /foreign key \(application_id, user_id\)[\s\S]*references public\.applications \(id, user_id\)[\s\S]*on delete cascade/i,
    )
    expect(migration0055).toMatch(
      /if tg_op = 'DELETE' and not exists \([\s\S]*from public\.applications as application[\s\S]*return old/i,
    )
    expect(body).not.toMatch(/delete from public\.profiles/i)
    expect(body).not.toMatch(/delete from public\.companies/i)
    expect(body).not.toMatch(/delete from public\.jobs/i)
    expect(body).toMatch(/security definer/i)
    expect(body).toMatch(/set search_path = ''/i)
    expect(body).toMatch(/if owner_id is null then[\s\S]*authentication_required/i)
  })

  it('exposes only narrow authenticated execution grants', () => {
    expect(migration0059).toMatch(
      /revoke all on function public\.dashboard_feed_page_v2\([\s\S]*?\)\s*from public, anon, authenticated/i,
    )
    expect(migration0059).toMatch(
      /grant execute on function public\.dashboard_feed_page_v2\([\s\S]*?\)\s*to authenticated/i,
    )
    expect(migration0059).toMatch(
      /revoke all on function public\.dashboard_company_options_v2\(text, text\[\], text\)\s*from public, anon, authenticated/i,
    )
    expect(migration0059).toMatch(
      /revoke all on function public\.delete_my_data\(\)\s*from public, anon, authenticated/i,
    )
    expect(migration0059).toMatch(
      /grant execute on function public\.delete_my_data\(\)\s*to authenticated/i,
    )
  })
})

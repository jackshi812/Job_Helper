import { describe, expect, it } from 'vitest'

import migration0038 from '../../supabase/migrations/0038_dashboard_feed_page_repair.sql?raw'

function pageFunction() {
  return migration0038.match(
    /create or replace function public\.dashboard_feed_page[\s\S]*?\$\$;/i,
  )?.[0] ?? ''
}

describe('migration 0038 — hosted Dashboard feed repair', () => {
  it('is forward-only and adds the two missing ranking foreign-key indexes', () => {
    expect(migration0038).toMatch(/^\s*begin\s*;/i)
    expect(migration0038).toMatch(/\bcommit\s*;\s*$/i)
    expect(migration0038).toMatch(
      /create index deterministic_ranking_items_user_job_id_idx\s+on public\.deterministic_ranking_items \(user_job_id\)/i,
    )
    expect(migration0038).toMatch(
      /create index deterministic_ranking_items_job_id_idx\s+on public\.deterministic_ranking_items \(job_id\)/i,
    )
    expect(migration0038).not.toMatch(/\b(?:drop|truncate)\s+table\b/i)
  })

  it('uses valid PostgreSQL composite-field dereferences throughout the page CTE', () => {
    const body = pageFunction()

    expect(body).not.toBe('')
    for (const composite of [
      'candidate.user_job',
      'candidate.job',
      'page.user_job',
      'page.job',
      'page.company',
    ]) {
      expect(body).not.toContain(`${composite}.`)
      expect(body).toContain(`(${composite}).`)
    }
  })

  it('preserves the authenticated invoker boundary and bounded page contract', () => {
    const body = pageFunction()

    expect(body).toMatch(/security invoker/i)
    expect(body).toMatch(/set search_path = ''/i)
    expect(body).toMatch(/p_limit\s*<\s*1[\s\S]*p_limit\s*>\s*200/i)
    expect(migration0038).toMatch(
      /revoke execute on function public\.dashboard_feed_page[\s\S]*from public, anon/i,
    )
    expect(migration0038).toMatch(
      /grant execute on function public\.dashboard_feed_page[\s\S]*to authenticated/i,
    )
  })
})

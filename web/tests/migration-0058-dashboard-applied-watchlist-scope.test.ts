import { describe, expect, it } from 'vitest'
import migration0058 from '../../supabase/migrations/0058_dashboard_applied_watchlist_scope.sql?raw'

function projectionBody() {
  return migration0058.match(
    /create function public\.dashboard_applied_applications\(\)([\s\S]*?)\$\$;/i,
  )?.[0] ?? ''
}

describe('migration 0058 — Dashboard applied watchlist scope', () => {
  it('atomically extends the existing RPC with normalized membership', () => {
    expect(migration0058).toMatch(/^\s*begin\s*;/i)
    expect(migration0058).toMatch(/\bcommit\s*;\s*$/i)
    expect(migration0058).toMatch(
      /drop function public\.dashboard_applied_applications\(\)/i,
    )
    expect(migration0058).toMatch(
      /returns table \([\s\S]*current_stage_date date,\s*has_watched_company boolean\s*\)/i,
    )
  })

  it('distinguishes watched from external snapshots only through jobs to companies', () => {
    const projection = projectionBody()
    expect(projection).toMatch(
      /exists \(\s*select 1\s*from public\.jobs as job\s*join public\.companies as company\s*on company\.id = job\.company_id\s*where job\.id = application\.source_job_id\s*\) as has_watched_company/i,
    )
    expect(projection).not.toMatch(/source_company_name/i)
    expect(projection).not.toMatch(
      /lower\s*\(|application\.company\s*=|company\.name\s*=/i,
    )
  })

  it('preserves owner, origin, stored snapshots, HTTPS safety, and exact ordering', () => {
    const projection = projectionBody()
    expect(projection).toMatch(
      /application\.id as application_id,\s*application\.company,\s*application\.title,\s*application\.location/i,
    )
    expect(projection).toMatch(/\^https:\/\//i)
    expect(projection).toMatch(
      /application\.user_id = \(select auth\.uid\(\)\)\s*and application\.origin = 'system'/i,
    )
    expect(projection).toMatch(
      /event\.stage = 'applied'[\s\S]*order by event\.occurred_on asc, event\.created_at asc, event\.id asc\s*limit 1/i,
    )
    expect(projection).toMatch(
      /order by first_applied\.occurred_on desc, application\.id desc/i,
    )
  })

  it('remains security-invoker with the same narrow authenticated grant', () => {
    const projection = projectionBody()
    expect(projection).toMatch(/security invoker/i)
    expect(projection).toMatch(/set search_path = ''/i)
    expect(migration0058).toMatch(
      /revoke all on function public\.dashboard_applied_applications\(\)\s*from public, anon, authenticated/i,
    )
    expect(migration0058).toMatch(
      /grant execute on function public\.dashboard_applied_applications\(\)\s*to authenticated/i,
    )
    expect(migration0058).toMatch(
      /alter function public\.dashboard_applied_applications\(\) owner to postgres/i,
    )
  })
})

import { describe, expect, it } from 'vitest'

import migration0039 from '../../supabase/migrations/0039_ranking_breakdown_validator_grant.sql?raw'

describe('migration 0039 — authenticated lifecycle validator access', () => {
  it('grants only the immutable breakdown validator needed by user_jobs checks', () => {
    expect(migration0039).toMatch(/^\s*begin\s*;/i)
    expect(migration0039).toMatch(
      /revoke execute on function public\.is_valid_ranking_breakdown\(jsonb\)\s+from public, anon/i,
    )
    expect(migration0039).toMatch(
      /grant execute on function public\.is_valid_ranking_breakdown\(jsonb\)\s+to authenticated/i,
    )
    expect(migration0039).not.toMatch(
      /grant\s+(?:insert|update|delete|truncate|references|trigger|all)[^;]*on (?:table )/i,
    )
    expect(migration0039).toMatch(/\bcommit\s*;\s*$/i)
  })

  it('fails closed unless authenticated has execute and anon does not', () => {
    expect(migration0039).toMatch(
      /has_function_privilege\(\s*'authenticated',[\s\S]*?'execute'\s*\)/i,
    )
    expect(migration0039).toMatch(
      /has_function_privilege\(\s*'anon',[\s\S]*?'execute'\s*\)/i,
    )
    expect(migration0039).toMatch(/raise exception 'ranking breakdown validator grant parity failed'/i)
  })
})

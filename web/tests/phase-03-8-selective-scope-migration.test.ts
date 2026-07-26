import { describe, expect, it } from 'vitest'
import migrationSql from '../../supabase/migrations/0044_phase_03_8_selective_workday_scope_evidence.sql?raw'

describe('Phase 03.8 selective Workday scope evidence migration', () => {
  it('is a forward-only bounded transaction that replaces only the evidence constraint', () => {
    expect(migrationSql.trimStart()).toMatch(/^begin;/)
    expect(migrationSql.trimEnd()).toMatch(/commit;$/)
    expect(migrationSql).toContain("set local lock_timeout = '5s'")
    expect(migrationSql).toContain("set local statement_timeout = '60s'")
    expect(migrationSql).toMatch(
      /alter table public\.jobs\s+drop constraint jobs_scope_evidence_check,\s+add constraint jobs_scope_evidence_check check/,
    )
    expect(migrationSql).not.toMatch(/\b(delete|truncate|update|insert)\b/i)
  })

  it('preserves null evidence for established Workday and non-branded sources', () => {
    expect(migrationSql).toMatch(
      /source = 'workday'\s+and scope_evidence is null/,
    )
    expect(migrationSql).toContain(
      "source not in (\n        'workday', 'eightfold', 'oracle_recruiting', 'goldman_higher'",
    )
  })

  it('accepts only the exact four selective source keys and evidence fields', () => {
    for (const sourceKey of [
      'workday:wd5:ms:External',
      'workday:wd1:ghr:Lateral-US',
      'workday:wd1:blackrock:BlackRock_Professional',
      'workday:wd3:barclays:External_Career_Site_Barclays',
    ]) {
      expect(migrationSql).toContain(`'${sourceKey}'`)
    }
    expect(migrationSql).toContain(
      "'sourceKey', 'detailCountryCode', 'selectionMode', 'recentDays',",
    )
    expect(migrationSql).toContain(
      "'titleKeywords', 'providerFacetLabels'",
    )
    expect(migrationSql).toContain(
      "scope_evidence ->> 'selectionMode' = 'recent_exact_us'",
    )
    expect(migrationSql).toContain(
      "scope_evidence -> 'recentDays' = '7'::jsonb",
    )
  })

  it('binds BOA keywords and Barclays facets while retaining branded digest proof', () => {
    expect(migrationSql).toContain(
      '\'["finance", "analytics", "data", "research"]\'::jsonb',
    )
    expect(migrationSql).toContain(
      '\'["Data & Analytics", "Finance", "Investment Banking", "Research", "Risk", "Technology"]\'::jsonb',
    )
    expect(migrationSql).toContain(
      "source in ('eightfold', 'oracle_recruiting', 'goldman_higher')",
    )
    expect(migrationSql).toContain(
      "scope_evidence ->> 'externalIdDigest' = pg_catalog.encode(",
    )
  })
})

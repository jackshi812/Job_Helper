import { describe, expect, it } from 'vitest'

import workdayIdentities from '../../supabase/functions/_shared/workday-identities.ts?raw'
import migration0037 from '../../supabase/migrations/0037_us_workday_dashboard_queue.sql?raw'

const EXPECTED_IDENTITIES = [
  {
    sourceKey: 'workday:wd1:nasdaq:Global_External_Site',
    tenant: 'nasdaq',
    region: 'wd1',
    site: 'Global_External_Site',
    publicBoard: 'https://nasdaq.wd1.myworkdayjobs.com/Global_External_Site',
  },
  {
    sourceKey: 'workday:wd5:spgi:SPGI_Careers',
    tenant: 'spgi',
    region: 'wd5',
    site: 'SPGI_Careers',
    publicBoard: 'https://spgi.wd5.myworkdayjobs.com/SPGI_Careers',
  },
  {
    sourceKey: 'workday:wd5:morningstar:morningstar',
    tenant: 'morningstar',
    region: 'wd5',
    site: 'morningstar',
    publicBoard: 'https://morningstar.wd5.myworkdayjobs.com/morningstar',
  },
  {
    sourceKey: 'workday:wd1:statestreet:Global',
    tenant: 'statestreet',
    region: 'wd1',
    site: 'Global',
    publicBoard: 'https://statestreet.wd1.myworkdayjobs.com/Global',
  },
] as const

const ALL_WORKDAY_KEYS = [
  'workday:wd12:capitalone:Capital_One',
  'workday:wd1:fmr:FidelityCareers',
  ...EXPECTED_IDENTITIES.map(({ sourceKey }) => sourceKey),
]

function literalObject(source: string, sourceKey: string) {
  const escaped = sourceKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return source.match(
    new RegExp(`Object\\.freeze\\(\\{([\\s\\S]*?sourceKey:\\s*[^\\n]*${escaped}[\\s\\S]*?)\\n\\}\\)`, 'i'),
  )?.[1] ?? ''
}

function readLiteral(block: string, field: string) {
  return block.match(new RegExp(`${field}:\\s*'([^']+)'`))?.[1] ?? ''
}

function serializedIdentity(
  value: Pick<(typeof EXPECTED_IDENTITIES)[number], 'sourceKey' | 'tenant' | 'region' | 'site'>,
) {
  return [value.sourceKey, value.tenant, value.region, value.site].join('\u0000')
}

function identityConstraint() {
  return migration0037.match(
    /add constraint companies_workday_identity_check check \(([\s\S]*?)\n {2}\);/i,
  )?.[1] ?? ''
}

function constraintIdentity(sourceKey: string) {
  const escaped = sourceKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const branch = identityConstraint().match(
    new RegExp(`\\(([\\s\\S]*?source_key\\s*=\\s*'${escaped}'[\\s\\S]*?)\\)`, 'i'),
  )?.[1] ?? ''
  return {
    sourceKey: branch.match(/source_key\s*=\s*'([^']+)'/i)?.[1] ?? '',
    tenant: branch.match(/board_token\s*=\s*'([^']+)'/i)?.[1] ?? '',
    region: branch.match(/region\s*=\s*'([^']+)'/i)?.[1] ?? '',
    site: branch.match(/site_token\s*=\s*'([^']+)'/i)?.[1] ?? '',
  }
}

function catalogIdentity(sourceKey: string) {
  const escaped = sourceKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const row = migration0037.match(
    new RegExp(
      `\\(\\s*'([^']+)'\\s*,\\s*'Workday'\\s*,\\s*'([^']+)'\\s*,\\s*'experimental'\\s*,\\s*'${escaped}'`,
      'i',
    ),
  )
  return {
    sourceKey,
    publicBoard: row?.[2] ?? '',
  }
}

describe('migration 0037 — exact Workday admission and Dashboard queue', () => {
  it('is a forward-only transaction and never seeds shared companies or jobs', () => {
    expect(migration0037).toMatch(/^\s*begin\s*;/i)
    expect(migration0037).toMatch(/\bcommit\s*;\s*$/i)
    expect(migration0037).not.toMatch(/\binsert into public\.(?:companies|jobs)\b/i)
    expect(migration0037).not.toMatch(/\b(?:drop|truncate)\s+table\b/i)
  })

  it('keeps registry, constraint, catalog, and scheduler identity bytes in exact parity', () => {
    const expectedBytes = EXPECTED_IDENTITIES.map(serializedIdentity)
    const registryBytes = EXPECTED_IDENTITIES.map((expected) => {
      const block = literalObject(workdayIdentities, expected.sourceKey)
      return serializedIdentity({
        sourceKey: expected.sourceKey,
        tenant: readLiteral(block, 'tenant'),
        region: readLiteral(block, 'region'),
        site: readLiteral(block, 'site'),
      })
    })
    const constraintBytes = EXPECTED_IDENTITIES.map((expected) => (
      serializedIdentity(constraintIdentity(expected.sourceKey))
    ))
    const catalogUrls = EXPECTED_IDENTITIES.map(({ sourceKey }) => (
      catalogIdentity(sourceKey).publicBoard
    ))
    const registryUrls = EXPECTED_IDENTITIES.map((expected) => (
      readLiteral(literalObject(workdayIdentities, expected.sourceKey), 'publicBoard')
    ))
    const claimBody = migration0037.match(
      /create or replace function public\.claim_due_companies[\s\S]*?\$\$;/i,
    )?.[0] ?? ''

    expect(registryBytes).toEqual(expectedBytes)
    expect(constraintBytes).toEqual(expectedBytes)
    expect(registryUrls).toEqual(EXPECTED_IDENTITIES.map(({ publicBoard }) => publicBoard))
    expect(catalogUrls).toEqual(registryUrls)
    for (const key of ALL_WORKDAY_KEYS) {
      expect(identityConstraint()).toContain(`source_key = '${key}'`)
      expect(claimBody).toContain(`'${key}'`)
    }
    expect((claimBody.match(/workday:wd\d+:[^']+/g) ?? []).sort())
      .toEqual([...ALL_WORKDAY_KEYS].sort())
  })

  it('creates four truthful read-only experimental catalog rows without aliases', () => {
    for (const identity of EXPECTED_IDENTITIES) {
      const row = catalogIdentity(identity.sourceKey)
      expect(row.publicBoard).toBe(identity.publicBoard)
    }
    expect(migration0037).toMatch(
      /insert into public\.source_coverage_catalog[\s\S]*on conflict \(company_name\) do update/i,
    )
    expect(migration0037).toMatch(/unsupported_reason\s*=\s*excluded\.unsupported_reason/i)
    expect(migration0037).toMatch(/access_evidence\s*=\s*excluded\.access_evidence/i)
  })

  it('installs the NULL-safe six-entry constraint and transactional negative probes', () => {
    expect(identityConstraint()).toMatch(/\)\s+is true\s*$/i)
    expect(migration0037).toMatch(/set region = null/i)
    expect(migration0037).toMatch(/set site_token = null/i)
    expect(migration0037).toMatch(/unknown Workday tuple unexpectedly passed/i)
    expect(migration0037).toMatch(/lookalike Workday tuple unexpectedly passed/i)
    expect((migration0037.match(/when check_violation then/gi) ?? []).length)
      .toBeGreaterThanOrEqual(4)
  })

  it('adds mutually exclusive per-user applied state with exact authenticated grants', () => {
    expect(migration0037).toMatch(
      /alter table public\.user_jobs[\s\S]*add column applied_at timestamptz/i,
    )
    expect(migration0037).toMatch(
      /add constraint user_jobs_lifecycle_mutual_exclusion[\s\S]*applied_at is null[\s\S]*dismissed_at is null/i,
    )
    expect(migration0037).toMatch(
      /grant update \(seen_at, dismissed_at, applied_at\) on (?:table )?public\.user_jobs to authenticated/i,
    )
    expect(migration0037).toMatch(/policy "user_jobs_update_own"/i)
    expect(migration0037).not.toMatch(
      /grant (?:update|delete)[^;]*on (?:table )?public\.jobs to authenticated/i,
    )
  })

  it('defines invoker-only authenticated dashboard RPCs with bounded inputs', () => {
    for (const name of ['dashboard_feed_page', 'dashboard_company_options']) {
      const body = migration0037.match(
        new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\$\\$;`, 'i'),
      )?.[0] ?? ''
      expect(body).toMatch(/security invoker/i)
      expect(body).toMatch(/set search_path = ''/i)
      expect(migration0037).toMatch(
        new RegExp(`revoke execute on function public\\.${name}[\\s\\S]*from public, anon`, 'i'),
      )
      expect(migration0037).toMatch(
        new RegExp(`grant execute on function public\\.${name}[\\s\\S]*to authenticated`, 'i'),
      )
    }
    expect(migration0037).toMatch(/p_limit\s*<\s*1[\s\S]*p_limit\s*>\s*200/i)
    expect(migration0037).toMatch(/invalid_dashboard_lifecycle/i)
    expect(migration0037).toMatch(/invalid_dashboard_order/i)
    expect(migration0037).toMatch(/invalid_dashboard_cursor/i)
    expect(migration0037).toMatch(/dashboard_cursor_signature_mismatch/i)
  })

  it('applies authorization, lifecycle, eligibility, tier, and company predicates before LIMIT', () => {
    const pageBody = migration0037.match(
      /create or replace function public\.dashboard_feed_page[\s\S]*?\$\$;/i,
    )?.[0] ?? ''
    const limitIndex = pageBody.search(/\blimit\s+p_limit\s*\+\s*1/i)
    expect(limitIndex).toBeGreaterThan(0)
    for (const predicate of [
      /user_job\.user_id\s*=\s*\(select auth\.uid\(\)\)/i,
      /job\.status\s*=\s*'open'/i,
      /user_job\.deterministic_eligible\s+is true/i,
      /user_job\.deterministic_revision\s+is not null/i,
      /user_job\.deterministic_score\s+is not null/i,
      /user_job\.deterministic_tier\s+is not null/i,
      /p_lifecycle\s*=\s*'active'/i,
      /p_tiers/i,
      /p_hidden_company_keys/i,
    ]) {
      const predicateIndex = pageBody.search(predicate)
      expect(predicateIndex).toBeGreaterThan(0)
      expect(predicateIndex).toBeLessThan(limitIndex)
    }
  })

  it('uses lifecycle-specific stable keyset orderings ending in user_jobs.id', () => {
    const pageBody = migration0037.match(
      /create or replace function public\.dashboard_feed_page[\s\S]*?\$\$;/i,
    )?.[0] ?? ''
    expect(pageBody).toMatch(
      /p_lifecycle = 'applied'[\s\S]*user_job\.applied_at desc[\s\S]*user_job\.id desc/i,
    )
    expect(pageBody).toMatch(
      /p_lifecycle = 'dismissed'[\s\S]*user_job\.dismissed_at desc[\s\S]*user_job\.id desc/i,
    )
    expect(pageBody).toMatch(
      /p_order = 'score_desc'[\s\S]*user_job\.deterministic_score desc[\s\S]*user_job\.id desc/i,
    )
    expect(pageBody).toMatch(
      /p_order = 'score_asc'[\s\S]*user_job\.deterministic_score asc[\s\S]*user_job\.id desc/i,
    )
    expect(pageBody).toMatch(
      /p_order = 'newest'[\s\S]*job\.posted_at desc nulls last[\s\S]*job\.first_seen_at desc[\s\S]*user_job\.id desc/i,
    )
  })

  it('derives company options from the complete authorized scope without a page limit', () => {
    const optionsBody = migration0037.match(
      /create or replace function public\.dashboard_company_options[\s\S]*?\$\$;/i,
    )?.[0] ?? ''
    expect(optionsBody).toMatch(/user_job\.user_id\s*=\s*\(select auth\.uid\(\)\)/i)
    expect(optionsBody).toMatch(/job\.status\s*=\s*'open'/i)
    expect(optionsBody).toMatch(/user_job\.deterministic_eligible\s+is true/i)
    expect(optionsBody).not.toMatch(/\blimit\b/i)
  })
})
